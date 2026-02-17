/**
 * WHOIS Protocol Implementation (RFC 3912)
 *
 * The WHOIS protocol provides domain registration information.
 * It's a simple text-based query-response protocol.
 *
 * Protocol Flow:
 * 1. Client connects to WHOIS server port 43
 * 2. Client sends query followed by CRLF
 * 3. Server responds with registration information
 * 4. Server closes connection
 *
 * Power-user features:
 *   - Automatic TLD→server routing (20+ registries)
 *   - Referral chasing: follows "Refer:" / "WHOIS Server:" redirects to get full registrar data
 *   - Structured field parsing: extracts registrar, dates, nameservers, status, contacts
 *   - IP address WHOIS: routes to ARIN/RIPE/APNIC/LACNIC/AFRINIC + ReferralServer chasing
 *   - ASN WHOIS: ASxxx format routed to the correct RIR
 *   - CIDR / netblock queries
 *
 * Endpoints:
 *   POST /api/whois/lookup — domain WHOIS with optional referral chasing + parsed fields
 *   POST /api/whois/ip     — IP address / ASN / CIDR WHOIS with RIR routing + parsed fields
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: false });

// ─────────────────────────────────────────────────────────────────────────────
// WHOIS server tables
// ─────────────────────────────────────────────────────────────────────────────

/** TLD → WHOIS server */
const WHOIS_SERVERS: Record<string, string> = {
  com: 'whois.verisign-grs.com',
  net: 'whois.verisign-grs.com',
  org: 'whois.pir.org',
  edu: 'whois.educause.edu',
  gov: 'whois.dotgov.gov',
  mil: 'whois.nic.mil',
  int: 'whois.iana.org',
  info: 'whois.afilias.net',
  biz: 'whois.biz',
  us:  'whois.nic.us',
  uk:  'whois.nic.uk',
  co:  'whois.iana.org',
  io:  'whois.nic.io',
  ai:  'whois.nic.ai',
  app: 'whois.nic.google',
  dev: 'whois.nic.google',
  ca:  'whois.cira.ca',
  au:  'whois.auda.org.au',
  de:  'whois.denic.de',
  fr:  'whois.nic.fr',
  jp:  'whois.jprs.jp',
  cn:  'whois.cnnic.cn',
  ru:  'whois.tcinet.ru',
  br:  'whois.registro.br',
  in:  'whois.registry.in',
  nl:  'whois.domain-registry.nl',
  it:  'whois.nic.it',
  es:  'whois.nic.es',
  pl:  'whois.dns.pl',
  ch:  'whois.nic.ch',
  se:  'whois.iis.se',
  no:  'whois.norid.no',
  fi:  'whois.fi',
  dk:  'whois.dk-hostmaster.dk',
  eu:  'whois.eu',
  asia: 'whois.nic.asia',
  mobi: 'whois.dotmobiregistry.net',
  tel:  'whois.nic.tel',
  name: 'whois.nic.name',
  pro:  'whois.registrypro.pro',
};

/** Regional Internet Registries for IP WHOIS */
const RIR_SERVERS: Record<string, string> = {
  ARIN:    'whois.arin.net',
  RIPE:    'whois.ripe.net',
  APNIC:   'whois.apnic.net',
  LACNIC:  'whois.lacnic.net',
  AFRINIC: 'whois.afrinic.net',
};

// ─────────────────────────────────────────────────────────────────────────────
// Query type detection
// ─────────────────────────────────────────────────────────────────────────────

function isIPv4(s: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(s);
}

function isIPv6(s: string): boolean {
  return /^[0-9a-fA-F:]+(?:\/\d{1,3})?$/.test(s) && s.includes(':');
}

function isASN(s: string): boolean {
  return /^AS\d+$/i.test(s) || /^\d+$/.test(s) && parseInt(s, 10) < 400000;
}

/** Route an IP to its RIR's WHOIS server. Uses ARIN as default; ARIN will redirect via ReferralServer. */
function getRIRServer(query: string): string {
  // RIPE ranges (rough heuristics; ARIN will redirect for everything else)
  if (isIPv4(query)) {
    const first = parseInt(query.split('.')[0], 10);
    if (first >= 77 && first <= 95) return RIR_SERVERS.RIPE;
    if (first >= 151 && first <= 185) return RIR_SERVERS.RIPE;
    if (first >= 193 && first <= 212) return RIR_SERVERS.RIPE;
    if (first >= 213 && first <= 217) return RIR_SERVERS.RIPE;
    if ([1, 27, 36, 42, 49, 58, 59, 60, 61, 101, 103, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 150, 153, 163, 175, 180, 182, 183, 202, 203, 210, 211, 218, 219, 220, 221, 222, 223].includes(first)) return RIR_SERVERS.APNIC;
    if (first >= 177 && first <= 191 && first !== 185) return RIR_SERVERS.LACNIC;
    if ([41, 102, 105, 154, 196, 197, 198].includes(first)) return RIR_SERVERS.AFRINIC;
  }
  if (isIPv6(query)) {
    const prefix = query.toLowerCase().slice(0, 4);
    if (prefix === '2001') {
      const block = parseInt(query.slice(5, 9), 16);
      if (block >= 0x0400 && block <= 0x04ff) return RIR_SERVERS.ARIN;
      if (block >= 0x0600 && block <= 0x07ff) return RIR_SERVERS.APNIC;
      if (block >= 0x0800 && block <= 0x09ff) return RIR_SERVERS.RIPE;
    }
    if (prefix.startsWith('2a0') || prefix.startsWith('2001')) return RIR_SERVERS.RIPE;
  }
  return RIR_SERVERS.ARIN; // Default: ARIN, which provides ReferralServer for non-ARIN resources
}

function getWhoisServer(domain: string): string {
  const parts = domain.toLowerCase().split('.');
  // Try 2-part TLD first (e.g. co.uk)
  if (parts.length >= 3) {
    const twopart = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
    if (WHOIS_SERVERS[twopart]) return WHOIS_SERVERS[twopart];
  }
  const tld = parts[parts.length - 1];
  return WHOIS_SERVERS[tld] || 'whois.iana.org';
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw WHOIS query
// ─────────────────────────────────────────────────────────────────────────────

async function doWhoisQuery(server: string, query: string, timeout: number): Promise<string> {
  const socket = connect(`${server}:43`);

  const tp = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`WHOIS timeout querying ${server}`)), timeout));

  await Promise.race([socket.opened, tp]);

  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  try {
    await writer.write(enc.encode(`${query}\r\n`));

    const chunks: Uint8Array[] = [];
    let total = 0;
    const limit = 200_000;

    while (total < limit) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await Promise.race([reader.read(), tp]);
      } catch {
        break;
      }
      if (result.done || !result.value) break;
      chunks.push(result.value);
      total += result.value.length;
    }

    const combined = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { combined.set(c, off); off += c.length; }
    return dec.decode(combined);
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
    try { writer.releaseLock(); } catch { /* ignore */ }
    try { socket.close(); } catch { /* ignore */ }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Structured field parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract structured fields from WHOIS text.
 * Returns the most useful fields a power user would want at a glance.
 */
function parseWhoisFields(text: string): Record<string, string | string[]> {
  const fields: Record<string, string | string[]> = {};

  // Key field mappings — WHOIS formats vary wildly between registrars/RIRs
  const fieldMap: Record<string, string[]> = {
    registrar:       ['Registrar:', 'Registrar Name:', 'registrar:'],
    registrarUrl:    ['Registrar URL:', 'Registrar Website:'],
    creationDate:    ['Creation Date:', 'Created Date:', 'Domain Registration Date:', 'created:', 'registered:'],
    updatedDate:     ['Updated Date:', 'Last Updated:', 'last-modified:', 'changed:', 'Last Modified:'],
    expiryDate:      ['Registry Expiry Date:', 'Expiration Date:', 'Expiry Date:', 'expires:', 'paid-till:'],
    status:          ['Domain Status:', 'Status:', 'status:'],
    registrant:      ['Registrant Name:', 'Registrant Organization:', 'Registrant:', 'holder:'],
    registrantEmail: ['Registrant Email:', 'Registrant Contact Email:'],
    adminEmail:      ['Admin Email:'],
    techEmail:       ['Tech Email:'],
    abuseEmail:      ['Abuse Contact Email:'],
    abusePhone:      ['Abuse Contact Phone:'],
    nameServers:     ['Name Server:', 'Nameserver:', 'nserver:'],
    dnssec:          ['DNSSEC:', 'dnssec:'],
    // IP-specific
    netRange:        ['NetRange:', 'inetnum:', 'inet6num:'],
    cidr:            ['CIDR:', 'route:', 'route6:'],
    netName:         ['NetName:', 'netname:', 'net-name:'],
    orgName:         ['OrgName:', 'org-name:', 'Organization:'],
    country:         ['Country:', 'country:'],
    rir:             ['WhoisServer:', 'source:'],
    asnNumber:       ['OriginAS:', 'origin:'],
    asnName:         ['ASName:', 'as-name:'],
    asnRange:        ['ASNumber:', 'aut-num:'],
  };

  const lines = text.split('\n');
  const multiFields = new Set(['status', 'nameServers', 'asnNumber']);

  for (const [key, prefixes] of Object.entries(fieldMap)) {
    const values: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      for (const prefix of prefixes) {
        if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
          const value = trimmed.slice(prefix.length).trim();
          if (value && value !== 'REDACTED FOR PRIVACY' && !value.startsWith('https://icann.org')) {
            values.push(value);
          }
          break;
        }
      }
    }
    if (values.length > 0) {
      if (multiFields.has(key) || values.length > 1) {
        fields[key] = [...new Set(values)]; // deduplicate
      } else {
        fields[key] = values[0];
      }
    }
  }

  return fields;
}

/**
 * Extract a referral WHOIS server from the response text.
 * Handles both IANA-style "refer:" and ARIN/Verisign "Registrar WHOIS Server:".
 */
function extractReferralServer(text: string): string | null {
  const patterns = [
    /^Registrar WHOIS Server:\s*(.+)$/im,
    /^WHOIS Server:\s*(.+)$/im,
    /^Refer:\s*(.+)$/im,
    /^ReferralServer:\s*whois:\/\/(.+)$/im,
    /^ReferralServer:\s*(.+)$/im,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const server = m[1].trim().replace(/^whois:\/\//, '');
      // Avoid self-referral and obviously bad values
      if (server && !server.startsWith('http') && server.includes('.')) return server;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle WHOIS lookup for domain names.
 *
 * POST /api/whois/lookup
 * Body: { domain, server?, port?, timeout?, followReferral? }
 *
 * followReferral (default true): follow the "WHOIS Server:" / "Refer:" line to get
 * the registrar's WHOIS data, which contains the full registrant details.
 */
export async function handleWhoisLookup(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      domain?: string;
      server?: string;
      port?: number;
      timeout?: number;
      followReferral?: boolean;
    };

    const { domain, timeout = 10000 } = body;
    const followReferral = body.followReferral !== false; // default true

    if (!domain) {
      return new Response(JSON.stringify({ success: false, error: 'domain is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const server = body.server || getWhoisServer(domain);

    const cfCheck = await checkIfCloudflare(server);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(server, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const start = Date.now();
    const registryResponse = await doWhoisQuery(server, domain, timeout);
    const registryTimeMs = Date.now() - start;

    // Try to follow referral to get full registrar data
    let registrarServer: string | null = null;
    let registrarResponse: string | null = null;
    let registrarTimeMs: number | undefined;

    if (followReferral) {
      registrarServer = extractReferralServer(registryResponse);
      if (registrarServer && registrarServer !== server) {
        try {
          const t0 = Date.now();
          registrarResponse = await doWhoisQuery(registrarServer, domain, timeout);
          registrarTimeMs = Date.now() - t0;
        } catch {
          registrarResponse = null;
        }
      }
    }

    // Parse structured fields from the most informative response
    const primaryText = registrarResponse || registryResponse;
    const parsed = parseWhoisFields(primaryText);

    const result: Record<string, unknown> = {
      success: true,
      domain,
      server,
      response: registryResponse,
      parsed,
      queryTimeMs: registryTimeMs,
    };

    if (registrarServer) {
      result.referral = {
        server: registrarServer,
        response: registrarResponse,
        queryTimeMs: registrarTimeMs,
      };
    }

    return new Response(JSON.stringify(result), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'WHOIS lookup failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle WHOIS lookup for IP addresses, ASNs, and CIDR blocks.
 *
 * POST /api/whois/ip
 * Body: { query, server?, timeout?, followReferral? }
 *
 * query: IPv4 (1.2.3.4), IPv6 (2001:db8::1), CIDR (192.0.2.0/24), ASN (AS15169 or 15169)
 *
 * Automatically routes to ARIN/RIPE/APNIC/LACNIC/AFRINIC based on address.
 * Follows ReferralServer: lines (ARIN includes these for non-ARIN resources).
 */
export async function handleWhoisIP(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      query?: string;
      server?: string;
      timeout?: number;
      followReferral?: boolean;
    };

    const { query, timeout = 15000 } = body;
    const followReferral = body.followReferral !== false;

    if (!query) {
      return new Response(JSON.stringify({ success: false, error: 'query is required (IPv4, IPv6, CIDR, or AS number)' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const q = query.trim();

    // Determine query type and route
    let server: string;
    let whoisQuery: string;
    let queryType: string;

    const isAsn = isASN(q);

    if (isIPv4(q) || isIPv6(q)) {
      queryType = isIPv4(q) ? (q.includes('/') ? 'cidr' : 'ipv4') : (q.includes('/') ? 'cidr6' : 'ipv6');
      server = body.server || getRIRServer(q);
      // ARIN accepts `-h whois.arin.net <IP>` but raw IP also works
      whoisQuery = q;
    } else if (isAsn) {
      queryType = 'asn';
      const asnNum = q.toUpperCase().startsWith('AS') ? q : `AS${q}`;
      server = body.server || RIR_SERVERS.ARIN; // ARIN handles all ASN lookups + redirects
      whoisQuery = asnNum;
    } else {
      return new Response(JSON.stringify({
        success: false, error: `Cannot parse query "${q}" — expected IPv4, IPv6, CIDR, or ASN (AS12345)`,
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const cfCheck = await checkIfCloudflare(server);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(server, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const start = Date.now();
    const primaryResponse = await doWhoisQuery(server, whoisQuery, timeout);
    const primaryTimeMs = Date.now() - start;

    // ARIN often returns ReferralServer: whois://whois.ripe.net for non-ARIN IPs
    let referralServer: string | null = null;
    let referralResponse: string | null = null;
    let referralTimeMs: number | undefined;

    if (followReferral) {
      referralServer = extractReferralServer(primaryResponse);
      if (referralServer && referralServer !== server) {
        try {
          const t0 = Date.now();
          referralResponse = await doWhoisQuery(referralServer, whoisQuery, timeout);
          referralTimeMs = Date.now() - t0;
        } catch {
          referralResponse = null;
        }
      }
    }

    const primaryText = referralResponse || primaryResponse;
    const parsed = parseWhoisFields(primaryText);

    const result: Record<string, unknown> = {
      success: true,
      query: q,
      queryType,
      server,
      response: primaryResponse,
      parsed,
      queryTimeMs: primaryTimeMs,
    };

    if (referralServer) {
      result.referral = {
        server: referralServer,
        response: referralResponse,
        queryTimeMs: referralTimeMs,
      };
    }

    return new Response(JSON.stringify(result), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'WHOIS lookup failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
