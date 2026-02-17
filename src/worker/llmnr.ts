/**
 * LLMNR Protocol Implementation (RFC 4795)
 *
 * Link-Local Multicast Name Resolution - Windows' equivalent of mDNS.
 * Used for local network name resolution without DNS server.
 *
 * Protocol Overview:
 * - Port 5355 (UDP multicast 224.0.0.252, or TCP unicast)
 * - DNS-like binary packet format
 * - Primarily for A and AAAA record queries; TCP fallback for large responses
 * - No service discovery (simpler than mDNS)
 *
 * TCP Framing (RFC 4795 §2.5, RFC 1035 §4.2.2):
 *   TCP messages MUST be preceded by a 2-octet network-byte-order message length.
 *
 * Use Cases:
 * - Windows workgroup name resolution
 * - Local network device discovery
 * - Reverse lookup (PTR) to resolve IPs to hostnames
 * - Fallback when DNS fails
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const DNS_TYPE = {
  A:    1,
  PTR:  12,
  AAAA: 28,
  ANY:  255,
} as const;

const DNS_CLASS = {
  IN: 1,
} as const;

interface LLMNRForwardRequest {
  host: string;
  port?: number;
  name: string;
  type?: number;
  timeout?: number;
}

interface LLMNRReverseRequest {
  host: string;
  port?: number;
  ip: string;
  timeout?: number;
}

interface LLMNRRecord {
  name: string;
  type: number;
  typeName: string;
  class: number;
  ttl: number;
  value: string;
}

function dnsTypeName(type: number): string {
  switch (type) {
    case 1:   return 'A';
    case 12:  return 'PTR';
    case 28:  return 'AAAA';
    case 255: return 'ANY';
    default:  return `TYPE${type}`;
  }
}

function encodeDomainName(name: string): Uint8Array {
  const labels = name.split('.');
  const bytes: number[] = [];
  for (const label of labels) {
    if (!label) continue;
    const b = new TextEncoder().encode(label);
    bytes.push(b.length, ...b);
  }
  bytes.push(0);
  return new Uint8Array(bytes);
}

function decodeDomainName(data: Uint8Array, offset: number): { name: string; nextOffset: number } {
  const labels: string[] = [];
  let cur = offset;
  let jumped = false;
  let endOffset = offset;

  while (cur < data.length) {
    const len = data[cur];
    if (len === 0) {
      if (!jumped) endOffset = cur + 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (!jumped) endOffset = cur + 2;
      jumped = true;
      cur = ((len & 0x3f) << 8) | data[cur + 1];
      continue;
    }
    labels.push(new TextDecoder().decode(data.slice(cur + 1, cur + 1 + len)));
    cur += 1 + len;
    if (!jumped) endOffset = cur;
  }

  return { name: labels.join('.'), nextOffset: jumped ? endOffset : cur + 1 };
}

function buildLLMNRQuery(name: string, type: number): Uint8Array {
  const id = Math.floor(Math.random() * 0x10000);
  const nameBytes = encodeDomainName(name);
  const pkt = new Uint8Array(12 + nameBytes.length + 4);
  const dv = new DataView(pkt.buffer);
  dv.setUint16(0, id, false);
  dv.setUint16(2, 0,  false);
  dv.setUint16(4, 1,  false);
  pkt.set(nameBytes, 12);
  dv.setUint16(12 + nameBytes.length,     type,         false);
  dv.setUint16(12 + nameBytes.length + 2, DNS_CLASS.IN, false);
  return pkt;
}

/** Prepend 2-byte TCP length prefix per RFC 1035 §4.2.2. */
function wrapTCP(pkt: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 + pkt.length);
  new DataView(out.buffer).setUint16(0, pkt.length, false);
  out.set(pkt, 2);
  return out;
}

async function readAtLeast(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  need: number,
  timeoutMs: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const deadline = Date.now() + timeoutMs;

  while (total < need && Date.now() < deadline) {
    const ms = Math.max(1, deadline - Date.now());
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: true }>(res => setTimeout(() => res({ value: undefined, done: true }), ms)),
    ]);
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }

  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function parseLLMNRResponse(data: Uint8Array): { answers: LLMNRRecord[]; flags: number } {
  if (data.length < 12) throw new Error('Response too short');
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const flags   = dv.getUint16(2, false);
  const ancount = dv.getUint16(6, false);
  let offset = 12;

  // Skip question section
  const q = decodeDomainName(data, offset);
  offset = q.nextOffset + 4;

  const answers: LLMNRRecord[] = [];
  for (let i = 0; i < ancount && offset + 10 <= data.length; i++) {
    const { name, nextOffset: nameEnd } = decodeDomainName(data, offset);
    if (nameEnd + 10 > data.length) break;
    const type     = dv.getUint16(nameEnd,     false);
    const rclass   = dv.getUint16(nameEnd + 2, false);
    const ttl      = dv.getUint32(nameEnd + 4, false);
    const rdlen    = dv.getUint16(nameEnd + 8, false);
    const rdataOff = nameEnd + 10;
    const rdata    = data.slice(rdataOff, rdataOff + rdlen);
    offset = rdataOff + rdlen;

    let value = '';
    if (type === DNS_TYPE.A && rdata.length === 4) {
      value = `${rdata[0]}.${rdata[1]}.${rdata[2]}.${rdata[3]}`;
    } else if (type === DNS_TYPE.AAAA && rdata.length === 16) {
      const parts: string[] = [];
      for (let j = 0; j < 16; j += 2) parts.push(((rdata[j] << 8) | rdata[j + 1]).toString(16));
      value = parts.join(':');
    } else if (type === DNS_TYPE.PTR) {
      value = decodeDomainName(data, rdataOff).name;
    }

    answers.push({ name, type, typeName: dnsTypeName(type), class: rclass, ttl, value });
  }

  return { answers, flags };
}

function ipv4ToPTRName(ip: string): string {
  const parts = ip.split('.');
  if (parts.length !== 4) throw new Error(`Invalid IPv4: ${ip}`);
  return parts.reverse().join('.') + '.in-addr.arpa';
}

function ipv6ToPTRName(ip: string): string {
  const halves = ip.split('::');
  let left  = halves[0] ? halves[0].split(':') : [];
  const right = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  for (let i = 0; i < missing; i++) left.push('0');
  const groups = left.concat(right);
  const nibbles: string[] = [];
  for (const g of groups) nibbles.push(...g.padStart(4, '0').split(''));
  return nibbles.reverse().join('.') + '.ip6.arpa';
}

/**
 * LLMNR forward lookup (A/AAAA/PTR/ANY) over TCP with RFC-correct framing.
 *
 * POST /api/llmnr/query
 * Body: { host, port=5355, name, type=1, timeout=10000 }
 */
export async function handleLLMNRQuery(request: Request): Promise<Response> {
  try {
    const body = await request.json() as LLMNRForwardRequest;
    const { host, port = 5355, name, type = DNS_TYPE.A, timeout = 10000 } = body;

    if (!host || !name) {
      return new Response(JSON.stringify({ success: false, error: 'Host and name required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip),
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const socket = connect(`${host}:${port}`);
    const tp = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout));

    try {
      await Promise.race([socket.opened, tp]);
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      await writer.write(wrapTCP(buildLLMNRQuery(name, type)));
      const raw = await Promise.race([readAtLeast(reader, 14, timeout), tp]);

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      if (raw.length < 2) throw new Error('No response');
      const msgLen = (raw[0] << 8) | raw[1];
      const dns = raw.slice(2, 2 + msgLen);
      if (dns.length < 12) throw new Error('Response too short');

      return new Response(JSON.stringify({
        success: true,
        query: { name, type, typeName: dnsTypeName(type) },
        ...parseLLMNRResponse(dns),
      }), { headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
      try { socket.close(); } catch { /* ignore */ }
      throw err;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * LLMNR reverse lookup — PTR query to resolve an IP to a hostname.
 * Converts IPv4/IPv6 to the appropriate .arpa reverse DNS name.
 *
 * POST /api/llmnr/reverse
 * Body: { host, port=5355, ip, timeout=10000 }
 * Returns: { success, ip, ptrName, hostnames, answers, flags }
 */
export async function handleLLMNRReverse(request: Request): Promise<Response> {
  try {
    const body = await request.json() as LLMNRReverseRequest;
    const { host, port = 5355, ip, timeout = 10000 } = body;

    if (!host || !ip) {
      return new Response(JSON.stringify({ success: false, error: 'Host and ip required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip),
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const ptrName = ip.includes(':') ? ipv6ToPTRName(ip) : ipv4ToPTRName(ip);
    const socket = connect(`${host}:${port}`);
    const tp = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout));

    try {
      await Promise.race([socket.opened, tp]);
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      await writer.write(wrapTCP(buildLLMNRQuery(ptrName, DNS_TYPE.PTR)));
      const raw = await Promise.race([readAtLeast(reader, 14, timeout), tp]);

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      if (raw.length < 2) throw new Error('No response');
      const msgLen = (raw[0] << 8) | raw[1];
      const dns = raw.slice(2, 2 + msgLen);
      if (dns.length < 12) throw new Error('Response too short');

      const result = parseLLMNRResponse(dns);
      const hostnames = result.answers
        .filter(a => a.type === DNS_TYPE.PTR)
        .map(a => a.value);

      return new Response(JSON.stringify({
        success: true,
        ip,
        ptrName,
        hostnames,
        ...result,
      }), { headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
      try { socket.close(); } catch { /* ignore */ }
      throw err;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * LLMNR parallel hostname scan — probe multiple hostnames concurrently.
 *
 * Sends LLMNR A/AAAA queries for multiple hostnames in parallel and returns
 * which ones responded. Useful for enumerating Windows machines by hostname
 * pattern (e.g. "DC01", "FILESERVER", "WORKSTATION01..20", etc.).
 *
 * POST /api/llmnr/scan
 * Body: { host, port?, names?, prefix?, rangeStart?, rangeEnd?, type?, perQueryTimeout?, timeout? }
 * Returns: { success, responded: [{name, answers}], noResponse: [name], total, respondedCount }
 */
export async function handleLLMNRScan(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      names?: string[];
      prefix?: string;
      rangeStart?: number;
      rangeEnd?: number;
      type?: number;
      perQueryTimeout?: number;
      timeout?: number;
    };

    const {
      host,
      port = 5355,
      names,
      prefix,
      rangeStart = 1,
      rangeEnd = 20,
      type = DNS_TYPE.A,
      perQueryTimeout = 3000,
      timeout = 30000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Build the list of names to probe
    const queryNames: string[] = names ? [...names] : [];

    if (prefix) {
      const digits = String(rangeEnd).length;
      for (let i = rangeStart; i <= rangeEnd; i++) {
        queryNames.push(`${prefix}${String(i).padStart(digits, '0')}`);
      }
    }

    if (queryNames.length === 0) {
      // Default: common Windows hostname patterns
      queryNames.push(
        'DC', 'DC01', 'DC02', 'PDC', 'BDC',
        'FILESERVER', 'FS01', 'FS02',
        'EXCHANGE', 'MAIL', 'SMTP',
        'WORKSTATION', 'DESKTOP', 'LAPTOP',
        'ADMIN', 'SERVER', 'NAS',
        'PRINTER', 'PRINT', 'SCAN',
        'ROUTER', 'GATEWAY', 'FIREWALL',
      );
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip),
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const overallDeadline = Date.now() + timeout;

    const queryOneName = async (name: string): Promise<{ name: string; answers: LLMNRRecord[] } | null> => {
      if (Date.now() >= overallDeadline) return null;
      try {
        const socket = connect(`${host}:${port}`);
        const tp = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), perQueryTimeout)
        );
        await Promise.race([socket.opened, tp]);
        const writer = socket.writable.getWriter();
        const reader = socket.readable.getReader();
        await writer.write(wrapTCP(buildLLMNRQuery(name, type)));
        let answered: { name: string; answers: LLMNRRecord[] } | null = null;
        try {
          const raw = await Promise.race([readAtLeast(reader, 14, perQueryTimeout), tp]);
          if (raw.length >= 4) {
            const msgLen = (raw[0] << 8) | raw[1];
            const dns = raw.slice(2, 2 + msgLen);
            if (dns.length >= 12) {
              const parsed = parseLLMNRResponse(dns);
              if (parsed.answers.length > 0) {
                answered = { name, answers: parsed.answers };
              }
            }
          }
        } catch { /* no response */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { socket.close(); } catch { /* ignore */ }
        return answered;
      } catch {
        return null;
      }
    };

    const results = await Promise.all(queryNames.map(n => queryOneName(n)));
    const responded = results.filter((r): r is { name: string; answers: LLMNRRecord[] } => r !== null);
    const noResponse = queryNames.filter((_, i) => results[i] === null);

    return new Response(JSON.stringify({
      success: true,
      host, port,
      total: queryNames.length,
      respondedCount: responded.length,
      responded,
      noResponse,
      note: responded.length > 0
        ? `${responded.length} LLMNR host(s) responded. LLMNR resolves link-local names on Windows networks.`
        : 'No LLMNR responses received. Host may not be running LLMNR or names not registered.',
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
