/**
 * DNS Protocol Support for Cloudflare Workers
 * DNS over TCP (RFC 1035) - Domain Name Resolution
 * Port: 53
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/** DNS record type codes */
export const DNS_RECORD_TYPES: Record<string, number> = {
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

/** Reverse lookup: code -> name */
const RECORD_TYPE_NAMES: Record<number, string> = {};
for (const [name, code] of Object.entries(DNS_RECORD_TYPES)) {
  RECORD_TYPE_NAMES[code] = name;
}

/** DNS response codes */
const RCODE_NAMES: Record<number, string> = {
  0: 'NOERROR',
  1: 'FORMERR',
  2: 'SERVFAIL',
  3: 'NXDOMAIN',
  4: 'NOTIMP',
  5: 'REFUSED',
};

export interface DNSRecord {
  name: string;
  type: string;
  typeCode: number;
  class: number;
  ttl: number;
  data: string;
}

export interface DNSQueryResult {
  success: boolean;
  domain: string;
  server: string;
  port: number;
  queryType: string;
  rcode: string;
  flags: {
    qr: boolean;
    aa: boolean;
    tc: boolean;
    rd: boolean;
    ra: boolean;
  };
  questions: number;
  answers: DNSRecord[];
  authority: DNSRecord[];
  additional: DNSRecord[];
  queryTimeMs: number;
}

/**
 * Encode a domain name into DNS wire format
 */
function encodeDomainName(domain: string): number[] {
  const result: number[] = [];
  const labels = domain.split('.');
  for (const label of labels) {
    if (label.length > 63) throw new Error(`Label "${label}" exceeds 63 characters`);
    result.push(label.length);
    for (let i = 0; i < label.length; i++) {
      result.push(label.charCodeAt(i));
    }
  }
  result.push(0); // null terminator
  return result;
}

/**
 * Build a DNS query packet
 */
function buildDNSQuery(domain: string, typeCode: number): Uint8Array {
  const buffer: number[] = [];

  // Transaction ID (random)
  const id = Math.floor(Math.random() * 65536);
  buffer.push((id >> 8) & 0xff, id & 0xff);

  // Flags: standard query, recursion desired (0x0100)
  buffer.push(0x01, 0x00);

  // Question count = 1
  buffer.push(0x00, 0x01);
  // Answer count = 0
  buffer.push(0x00, 0x00);
  // Authority count = 0
  buffer.push(0x00, 0x00);
  // Additional count = 0
  buffer.push(0x00, 0x00);

  // Question section
  buffer.push(...encodeDomainName(domain));

  // Type
  buffer.push((typeCode >> 8) & 0xff, typeCode & 0xff);
  // Class IN = 1
  buffer.push(0x00, 0x01);

  return new Uint8Array(buffer);
}

/**
 * Parse a DNS name from wire format with compression pointer support
 */
function parseDNSName(data: Uint8Array, offset: number): { name: string; newOffset: number } {
  const labels: string[] = [];
  let jumped = false;
  let jumpReturn = -1;
  let currentOffset = offset;
  let safetyCounter = 0;

  while (safetyCounter++ < 128) {
    if (currentOffset >= data.length) break;

    const length = data[currentOffset];

    if (length === 0) {
      currentOffset++;
      break;
    }

    // Compression pointer
    if ((length & 0xc0) === 0xc0) {
      if (!jumped) {
        jumpReturn = currentOffset + 2;
      }
      const pointer = ((length & 0x3f) << 8) | data[currentOffset + 1];
      currentOffset = pointer;
      jumped = true;
      continue;
    }

    currentOffset++;
    if (currentOffset + length > data.length) break;

    let label = '';
    for (let i = 0; i < length; i++) {
      label += String.fromCharCode(data[currentOffset + i]);
    }
    labels.push(label);
    currentOffset += length;
  }

  return {
    name: labels.join('.') || '.',
    newOffset: jumped ? jumpReturn : currentOffset,
  };
}

/**
 * Parse a DNS resource record
 */
function parseDNSRecord(data: Uint8Array, offset: number): { record: DNSRecord; newOffset: number } {
  const nameResult = parseDNSName(data, offset);
  offset = nameResult.newOffset;

  if (offset + 10 > data.length) {
    throw new Error('Truncated DNS record');
  }

  const typeCode = (data[offset] << 8) | data[offset + 1];
  const cls = (data[offset + 2] << 8) | data[offset + 3];
  const ttl =
    ((data[offset + 4] << 24) >>> 0) +
    (data[offset + 5] << 16) +
    (data[offset + 6] << 8) +
    data[offset + 7];
  const rdlength = (data[offset + 8] << 8) | data[offset + 9];
  offset += 10;

  if (offset + rdlength > data.length) {
    throw new Error('Truncated DNS record data');
  }

  const rdataStart = offset;
  let dataStr = '';

  switch (typeCode) {
    case DNS_RECORD_TYPES.A: {
      if (rdlength >= 4) {
        dataStr = `${data[offset]}.${data[offset + 1]}.${data[offset + 2]}.${data[offset + 3]}`;
      }
      break;
    }
    case DNS_RECORD_TYPES.AAAA: {
      if (rdlength >= 16) {
        const parts: string[] = [];
        for (let i = 0; i < 8; i++) {
          const val = (data[offset + i * 2] << 8) | data[offset + i * 2 + 1];
          parts.push(val.toString(16));
        }
        dataStr = parts.join(':');
      }
      break;
    }
    case DNS_RECORD_TYPES.CNAME:
    case DNS_RECORD_TYPES.NS:
    case DNS_RECORD_TYPES.PTR: {
      const result = parseDNSName(data, offset);
      dataStr = result.name;
      break;
    }
    case DNS_RECORD_TYPES.MX: {
      if (rdlength >= 3) {
        const priority = (data[offset] << 8) | data[offset + 1];
        const result = parseDNSName(data, offset + 2);
        dataStr = `${priority} ${result.name}`;
      }
      break;
    }
    case DNS_RECORD_TYPES.TXT: {
      const texts: string[] = [];
      let txtOffset = offset;
      const txtEnd = offset + rdlength;
      while (txtOffset < txtEnd) {
        const txtLen = data[txtOffset];
        txtOffset++;
        if (txtOffset + txtLen > txtEnd) break;
        let txt = '';
        for (let i = 0; i < txtLen; i++) {
          txt += String.fromCharCode(data[txtOffset + i]);
        }
        texts.push(txt);
        txtOffset += txtLen;
      }
      dataStr = texts.join('');
      break;
    }
    case DNS_RECORD_TYPES.SOA: {
      const mname = parseDNSName(data, offset);
      const rname = parseDNSName(data, mname.newOffset);
      let soaOffset = rname.newOffset;
      if (soaOffset + 20 <= data.length) {
        const serial = ((data[soaOffset] << 24) >>> 0) + (data[soaOffset + 1] << 16) + (data[soaOffset + 2] << 8) + data[soaOffset + 3];
        dataStr = `${mname.name} ${rname.name} ${serial}`;
      } else {
        dataStr = `${mname.name} ${rname.name}`;
      }
      break;
    }
    case DNS_RECORD_TYPES.SRV: {
      if (rdlength >= 7) {
        const priority = (data[offset] << 8) | data[offset + 1];
        const weight = (data[offset + 2] << 8) | data[offset + 3];
        const srvPort = (data[offset + 4] << 8) | data[offset + 5];
        const target = parseDNSName(data, offset + 6);
        dataStr = `${priority} ${weight} ${srvPort} ${target.name}`;
      }
      break;
    }
    default: {
      // Raw hex for unknown types
      const bytes: string[] = [];
      for (let i = 0; i < rdlength && i < 64; i++) {
        bytes.push(data[offset + i].toString(16).padStart(2, '0'));
      }
      dataStr = bytes.join(' ');
      if (rdlength > 64) dataStr += '...';
      break;
    }
  }

  offset = rdataStart + rdlength;

  return {
    record: {
      name: nameResult.name,
      type: RECORD_TYPE_NAMES[typeCode] || `TYPE${typeCode}`,
      typeCode,
      class: cls,
      ttl,
      data: dataStr,
    },
    newOffset: offset,
  };
}

/**
 * Parse a full DNS response
 */
function parseDNSResponse(data: Uint8Array): Omit<DNSQueryResult, 'success' | 'domain' | 'server' | 'port' | 'queryType' | 'queryTimeMs'> {
  if (data.length < 12) {
    throw new Error('DNS response too short');
  }

  // Parse header
  const flags = (data[2] << 8) | data[3];
  const qdcount = (data[4] << 8) | data[5];
  const ancount = (data[6] << 8) | data[7];
  const nscount = (data[8] << 8) | data[9];
  const arcount = (data[10] << 8) | data[11];

  const rcode = flags & 0x0f;

  // Skip question section
  let offset = 12;
  for (let i = 0; i < qdcount; i++) {
    const nameResult = parseDNSName(data, offset);
    offset = nameResult.newOffset + 4; // skip type + class
  }

  // Parse answer section
  const answers: DNSRecord[] = [];
  for (let i = 0; i < ancount; i++) {
    try {
      const result = parseDNSRecord(data, offset);
      answers.push(result.record);
      offset = result.newOffset;
    } catch {
      break;
    }
  }

  // Parse authority section
  const authority: DNSRecord[] = [];
  for (let i = 0; i < nscount; i++) {
    try {
      const result = parseDNSRecord(data, offset);
      authority.push(result.record);
      offset = result.newOffset;
    } catch {
      break;
    }
  }

  // Parse additional section
  const additional: DNSRecord[] = [];
  for (let i = 0; i < arcount; i++) {
    try {
      const result = parseDNSRecord(data, offset);
      additional.push(result.record);
      offset = result.newOffset;
    } catch {
      break;
    }
  }

  return {
    rcode: RCODE_NAMES[rcode] || `RCODE${rcode}`,
    flags: {
      qr: !!(flags & 0x8000),
      aa: !!(flags & 0x0400),
      tc: !!(flags & 0x0200),
      rd: !!(flags & 0x0100),
      ra: !!(flags & 0x0080),
    },
    questions: qdcount,
    answers,
    authority,
    additional,
  };
}

/**
 * Handle DNS query (HTTP POST)
 */
export async function handleDNSQuery(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = (await request.json()) as {
      domain?: string;
      type?: string;
      server?: string;
      port?: number;
    };

    if (!body.domain) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameter: domain' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const domain = body.domain.replace(/\.$/, ''); // Strip trailing dot
    const queryTypeName = (body.type || 'A').toUpperCase();
    const typeCode = DNS_RECORD_TYPES[queryTypeName];

    if (typeCode === undefined) {
      return new Response(
        JSON.stringify({
          error: `Unknown record type: ${queryTypeName}. Supported: ${Object.keys(DNS_RECORD_TYPES).join(', ')}`,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const server = body.server || '8.8.8.8';
    const port = body.port || 53;

    // Check if the DNS server is behind Cloudflare
    const cfCheck = await checkIfCloudflare(server);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(server, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const startTime = Date.now();

    // Build DNS query
    const queryPacket = buildDNSQuery(domain, typeCode);

    // DNS over TCP: prepend 2-byte length
    const tcpPacket = new Uint8Array(2 + queryPacket.length);
    tcpPacket[0] = (queryPacket.length >> 8) & 0xff;
    tcpPacket[1] = queryPacket.length & 0xff;
    tcpPacket.set(queryPacket, 2);

    // Connect to DNS server
    const socket = connect(`${server}:${port}`);
    await socket.opened;

    // Send query
    const writer = socket.writable.getWriter();
    await writer.write(tcpPacket);
    writer.releaseLock();

    // Read response with timeout
    const reader = socket.readable.getReader();
    const responseData: number[] = [];

    const readPromise = (async () => {
      // First read: get length prefix + possibly some data
      const { value: firstChunk, done: firstDone } = await reader.read();
      if (firstDone || !firstChunk) throw new Error('No response from DNS server');

      for (const b of firstChunk) responseData.push(b);

      // Parse expected length from TCP prefix
      if (responseData.length >= 2) {
        const expectedLength = (responseData[0] << 8) | responseData[1];
        const totalExpected = expectedLength + 2;

        // Read remaining data if needed
        while (responseData.length < totalExpected) {
          const { value, done } = await reader.read();
          if (done || !value) break;
          for (const b of value) responseData.push(b);
        }
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('DNS query timeout')), 10000)
    );

    await Promise.race([readPromise, timeoutPromise]);

    const queryTimeMs = Date.now() - startTime;

    // Close socket
    try {
      reader.releaseLock();
      await socket.close();
    } catch {
      // Ignore close errors
    }

    if (responseData.length < 14) {
      return new Response(
        JSON.stringify({ success: false, error: 'DNS response too short' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Strip TCP length prefix (first 2 bytes)
    const dnsResponse = new Uint8Array(responseData.slice(2));

    // Parse DNS response
    const parsed = parseDNSResponse(dnsResponse);

    const result: DNSQueryResult = {
      success: true,
      domain,
      server,
      port,
      queryType: queryTypeName,
      queryTimeMs,
      ...parsed,
    };

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'DNS query failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
