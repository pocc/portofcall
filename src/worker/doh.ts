/**
 * DNS over HTTPS (DoH) Protocol Support — RFC 8484
 *
 * DoH encrypts DNS queries inside HTTPS, making them indistinguishable from
 * regular web traffic. Uses fetch() (not TCP sockets) to POST binary DNS
 * wire-format queries to a DoH resolver endpoint.
 *
 * Well-known resolvers:
 *   Cloudflare: https://cloudflare-dns.com/dns-query
 *   Google:     https://dns.google/dns-query
 *   Quad9:      https://dns.quad9.net/dns-query
 *
 * Port: 443 (HTTPS)
 */

/** DNS record type codes */
const DNS_RECORD_TYPES: Record<string, number> = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  PTR: 12,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  SRV: 33,
  ANY: 255,
};

const RECORD_TYPE_NAMES: Record<number, string> = {};
for (const [name, code] of Object.entries(DNS_RECORD_TYPES)) {
  RECORD_TYPE_NAMES[code] = name;
}

const RCODE_NAMES: Record<number, string> = {
  0: 'NOERROR',
  1: 'FORMERR',
  2: 'SERVFAIL',
  3: 'NXDOMAIN',
  4: 'NOTIMP',
  5: 'REFUSED',
};

export interface DOHRecord {
  name: string;
  type: string;
  ttl: number;
  data: string;
}

export interface DOHQueryResult {
  success: boolean;
  domain: string;
  resolver: string;
  queryType: string;
  rcode: string;
  answers: DOHRecord[];
  authority: DOHRecord[];
  additional: DOHRecord[];
  queryTimeMs: number;
  error?: string;
}

/**
 * Encode a domain name into DNS wire format labels
 */
function encodeDomainName(domain: string): Uint8Array {
  const labels = domain.replace(/\.$/, '').split('.');
  const bytes: number[] = [];
  for (const label of labels) {
    bytes.push(label.length);
    for (let i = 0; i < label.length; i++) {
      bytes.push(label.charCodeAt(i));
    }
  }
  bytes.push(0); // root label
  return new Uint8Array(bytes);
}

/**
 * Build a DNS query packet (wire format, no TCP length prefix)
 */
function buildDNSQuery(domain: string, qtype: number): Uint8Array {
  const id = Math.floor(Math.random() * 65536);
  const qname = encodeDomainName(domain);

  const header = new Uint8Array(12);
  const view = new DataView(header.buffer);
  view.setUint16(0, id, false);
  view.setUint16(2, 0x0100, false); // Flags: RD=1
  view.setUint16(4, 1, false);      // QDCOUNT
  view.setUint16(6, 0, false);
  view.setUint16(8, 0, false);
  view.setUint16(10, 0, false);

  const question = new Uint8Array(qname.length + 4);
  question.set(qname, 0);
  const qview = new DataView(question.buffer);
  qview.setUint16(qname.length, qtype, false);
  qview.setUint16(qname.length + 2, 1, false); // QCLASS IN

  const packet = new Uint8Array(header.length + question.length);
  packet.set(header, 0);
  packet.set(question, header.length);
  return packet;
}

/**
 * Decode a domain name from DNS wire format, handling compression pointers
 */
function decodeDomainName(data: Uint8Array, offset: number): { name: string; bytesRead: number } {
  const labels: string[] = [];
  let pos = offset;
  let jumped = false;
  let bytesRead = 0;
  const decoder = new TextDecoder();

  let safetyCounter = 0;
  while (pos < data.length && safetyCounter++ < 128) {
    const len = data[pos];
    if (len === 0) {
      if (!jumped) bytesRead = pos - offset + 1;
      break;
    }
    // Compression pointer (top 2 bits = 11)
    if ((len & 0xC0) === 0xC0) {
      if (pos + 1 >= data.length) break;
      if (!jumped) bytesRead = pos - offset + 2;
      pos = ((len & 0x3F) << 8) | data[pos + 1];
      jumped = true;
      continue;
    }
    pos++;
    if (pos + len > data.length) break;
    labels.push(decoder.decode(data.slice(pos, pos + len)));
    pos += len;
  }

  return { name: labels.join('.') || '.', bytesRead };
}

/**
 * Parse a DNS resource record
 */
function parseRR(data: Uint8Array, offset: number): { record: DOHRecord; bytesRead: number } | null {
  const { name, bytesRead: nameLen } = decodeDomainName(data, offset);
  let pos = offset + nameLen;

  if (pos + 10 > data.length) return null;
  const view = new DataView(data.buffer, data.byteOffset);
  const type = view.getUint16(pos, false);
  // const rdclass = view.getUint16(pos + 2, false);
  const ttl = view.getUint32(pos + 4, false);
  const rdlength = view.getUint16(pos + 8, false);
  pos += 10;

  if (pos + rdlength > data.length) return null;
  const rdata = data.slice(pos, pos + rdlength);

  let dataStr: string;
  const typeName = RECORD_TYPE_NAMES[type] ?? `TYPE${type}`;

  if (type === 1 && rdlength === 4) {
    // A record
    dataStr = Array.from(rdata).join('.');
  } else if (type === 28 && rdlength === 16) {
    // AAAA record
    const parts: string[] = [];
    for (let i = 0; i < 16; i += 2) {
      parts.push(((rdata[i] << 8) | rdata[i + 1]).toString(16));
    }
    dataStr = parts.join(':');
  } else if (type === 5 || type === 2 || type === 12) {
    // CNAME, NS, PTR
    dataStr = decodeDomainName(data, pos).name;
  } else if (type === 15) {
    // MX
    const pref = (rdata[0] << 8) | rdata[1];
    dataStr = `${pref} ${decodeDomainName(data, pos + 2).name}`;
  } else if (type === 16) {
    // TXT
    let txtPos = 0;
    const parts: string[] = [];
    const decoder = new TextDecoder();
    while (txtPos < rdata.length) {
      const len = rdata[txtPos++];
      parts.push(decoder.decode(rdata.slice(txtPos, txtPos + len)));
      txtPos += len;
    }
    dataStr = parts.join(' ');
  } else if (type === 6) {
    // SOA — MNAME and RNAME are compressed domain names, followed by 5 x 32-bit integers
    const mname = decodeDomainName(data, pos);
    const rname = decodeDomainName(data, pos + mname.bytesRead);
    const soaIntOffset = pos + mname.bytesRead + rname.bytesRead;
    const soaView = new DataView(data.buffer, data.byteOffset);
    const serial = soaView.getUint32(soaIntOffset, false);
    const refresh = soaView.getUint32(soaIntOffset + 4, false);
    const retry = soaView.getUint32(soaIntOffset + 8, false);
    const expire = soaView.getUint32(soaIntOffset + 12, false);
    const minimum = soaView.getUint32(soaIntOffset + 16, false);
    dataStr = `${mname.name} ${rname.name} ${serial} ${refresh} ${retry} ${expire} ${minimum}`;
  } else if (type === 33) {
    // SRV — priority (2), weight (2), port (2), target (uncompressed domain name)
    const priority = (rdata[0] << 8) | rdata[1];
    const weight = (rdata[2] << 8) | rdata[3];
    const port = (rdata[4] << 8) | rdata[5];
    const target = decodeDomainName(data, pos + 6);
    dataStr = `${priority} ${weight} ${port} ${target.name}`;
  } else {
    dataStr = Array.from(rdata).map(b => b.toString(16).padStart(2, '0')).join(' ');
  }

  return {
    record: { name, type: typeName, ttl, data: dataStr },
    bytesRead: nameLen + 10 + rdlength,
  };
}

/**
 * Parse a full DNS response packet
 */
function parseDNSResponse(data: Uint8Array, domain: string, queryType: string): DOHQueryResult {
  const resolver = '';
  if (data.length < 12) {
    return { success: false, domain, resolver, queryType, rcode: 'FORMERR', answers: [], authority: [], additional: [], queryTimeMs: 0, error: 'Response too short' };
  }

  const view = new DataView(data.buffer, data.byteOffset);
  const flags = view.getUint16(2, false);
  const rcode = flags & 0x0F;
  const qdcount = view.getUint16(4, false);
  const ancount = view.getUint16(6, false);
  const nscount = view.getUint16(8, false);
  const arcount = view.getUint16(10, false);

  let pos = 12;

  // Skip question section
  for (let i = 0; i < qdcount; i++) {
    const { bytesRead } = decodeDomainName(data, pos);
    pos += bytesRead + 4; // name + qtype + qclass
  }

  const answers: DOHRecord[] = [];
  const authority: DOHRecord[] = [];
  const additional: DOHRecord[] = [];

  const parseSection = (count: number, target: DOHRecord[]) => {
    for (let i = 0; i < count; i++) {
      const result = parseRR(data, pos);
      if (!result) break;
      target.push(result.record);
      pos += result.bytesRead;
    }
  };

  parseSection(ancount, answers);
  parseSection(nscount, authority);
  parseSection(arcount, additional);

  return {
    success: rcode === 0,
    domain,
    resolver,
    queryType,
    rcode: RCODE_NAMES[rcode] ?? `RCODE${rcode}`,
    answers,
    authority,
    additional,
    queryTimeMs: 0,
    error: rcode !== 0 ? (RCODE_NAMES[rcode] ?? `DNS error code ${rcode}`) : undefined,
  };
}

/**
 * Handle DoH DNS query via HTTPS fetch
 */
export async function handleDOHQuery(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      domain?: string;
      type?: string;
      resolver?: string;
      timeout?: number;
    };

    const { domain, type = 'A', resolver = 'https://cloudflare-dns.com/dns-query', timeout = 10000 } = body;

    if (!domain) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required parameter: domain' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const qtypeCode = DNS_RECORD_TYPES[type.toUpperCase()] ?? 1;

    const queryPacket = buildDNSQuery(domain, qtypeCode);
    const startTime = Date.now();

    const fetchPromise = fetch(resolver, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/dns-message',
        'Accept': 'application/dns-message',
      },
      body: queryPacket.buffer as ArrayBuffer,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('DoH request timeout')), timeout),
    );

    const response = await Promise.race([fetchPromise, timeoutPromise]);
    const queryTimeMs = Date.now() - startTime;

    if (!response.ok) {
      return new Response(JSON.stringify({
        success: false,
        error: `DoH resolver returned HTTP ${response.status}: ${response.statusText}`,
        domain,
        resolver,
        queryType: type.toUpperCase(),
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const responseBuffer = await response.arrayBuffer();
    const responseData = new Uint8Array(responseBuffer);

    const result = parseDNSResponse(responseData, domain, type.toUpperCase());
    result.resolver = resolver;
    result.queryTimeMs = queryTimeMs;

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : 'DoH query failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
