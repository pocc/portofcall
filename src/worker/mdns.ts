/**
 * mDNS Protocol Implementation (RFC 6762)
 *
 * Multicast DNS (mDNS) is a protocol that resolves hostnames to IP addresses within
 * small networks that do not include a local name server. It's the foundation of
 * Apple's Bonjour/Zeroconf and Avahi on Linux.
 *
 * Protocol Overview:
 * - Port: 5353 (UDP multicast, TCP for this implementation)
 * - Multicast: 224.0.0.251 (IPv4), FF02::FB (IPv6)
 * - Domain: .local (reserved for mDNS)
 * - Message Format: Same as DNS (RFC 1035)
 * - TTL: Typically 120 seconds for most records
 *
 * Query Types:
 * - PTR: Service browsing (_services._dns-sd._udp.local)
 * - SRV: Service details (instance, port, target)
 * - TXT: Service metadata (key=value pairs)
 * - A/AAAA: IP addresses
 *
 * Service Discovery (DNS-SD):
 * - Browse: PTR query for _http._tcp.local
 * - Resolve: SRV + TXT queries for specific service instance
 * - Enumerate: _services._dns-sd._udp.local lists all service types
 *
 * Special Features:
 * - Known-Answer Suppression: Include known answers to suppress duplicate responses
 * - Continuous Querying: Repeat queries to discover new services
 * - QU (Unicast): Bit 15 set in QCLASS requests a unicast response
 * - QM (Multicast): Default mode — bit 15 clear, responses sent to multicast group
 *
 * Use Cases:
 * - Local network service discovery (printers, AirPlay, etc.)
 * - Device enumeration (IoT, smart home)
 * - Zero-configuration networking
 * - Bonjour service detection (macOS/iOS)
 * - Avahi service discovery (Linux)
 */

import { connect } from 'cloudflare:sockets';

interface MDNSRequest {
  host: string;
  port?: number;
  timeout?: number;
  service?: string; // e.g., "_http._tcp.local", "_airplay._tcp.local"
  queryType?: string; // PTR, SRV, TXT, A, AAAA
  unicastResponse?: boolean; // QU bit: request unicast response (RFC 6762 Section 5.4)
}

interface MDNSRecord {
  name: string;
  type: string;
  class: string;
  ttl: number;
  data: string | {
    priority?: number;
    weight?: number;
    port?: number;
    target?: string;
    txt?: string[];
  };
}

interface MDNSResponse {
  success: boolean;
  host: string;
  port: number;
  service?: string;
  answers?: MDNSRecord[];
  additionals?: MDNSRecord[];
  answerCount?: number;
  rtt?: number;
  error?: string;
}

// DNS/mDNS Record Types
enum RecordType {
  A = 1,      // IPv4 address
  NS = 2,     // Name server
  CNAME = 5,  // Canonical name
  SOA = 6,    // Start of authority
  PTR = 12,   // Pointer (service instance)
  MX = 15,    // Mail exchange
  TXT = 16,   // Text record
  AAAA = 28,  // IPv6 address
  SRV = 33,   // Service record
  ANY = 255,  // Any record
}

// DNS/mDNS Class
enum RecordClass {
  IN = 1,     // Internet
  FLUSH = 0x8001, // Cache flush (mDNS specific, high bit set)
}

/**
 * Build DNS/mDNS query message
 * RFC 6762 Section 18.1: Transaction ID SHOULD be zero for multicast queries
 * RFC 6762 Section 5.4: QU bit (unicast response) in QCLASS
 */
function buildMDNSQuery(queryName: string, queryType: RecordType, unicastResponse: boolean = false): Buffer {
  // DNS Header (12 bytes)
  const header = Buffer.allocUnsafe(12);

  // RFC 6762 Section 18.1: "In multicast query messages, the Query
  // Identifier SHOULD be set to zero on transmission."
  header.writeUInt16BE(0, 0); // Transaction ID (0 for mDNS)
  header.writeUInt16BE(0x0000, 2); // Flags (standard query)
  header.writeUInt16BE(1, 4); // Questions count
  header.writeUInt16BE(0, 6); // Answer RRs
  header.writeUInt16BE(0, 8); // Authority RRs
  header.writeUInt16BE(0, 10); // Additional RRs

  // RFC 6762 Section 5.4: QU bit requests unicast response
  const qclass = unicastResponse ? 0x8001 : RecordClass.IN;

  // Question section
  const question = buildDNSQuestion(queryName, queryType, qclass);

  return Buffer.concat([header, question]);
}

/**
 * Build DNS question section
 */
function buildDNSQuestion(name: string, qtype: RecordType, qclass: number): Buffer {
  const nameBuffer = encodeDNSName(name);
  const question = Buffer.allocUnsafe(4);

  question.writeUInt16BE(qtype, 0);
  question.writeUInt16BE(qclass, 2);

  return Buffer.concat([nameBuffer, question]);
}

/**
 * Encode DNS name with length-prefixed labels
 */
function encodeDNSName(name: string): Buffer {
  const labels = name.split('.');
  const buffers: Buffer[] = [];

  for (const label of labels) {
    if (label.length === 0) continue;

    // RFC 1035 Section 2.3.1: Labels must be 63 octets or less (byte length, not char count)
    const labelBytes = Buffer.from(label, 'utf8');
    if (labelBytes.length > 63) {
      throw new Error(`DNS label too long: ${labelBytes.length} bytes (max 63)`);
    }

    const labelBuffer = Buffer.allocUnsafe(1 + labelBytes.length);
    labelBuffer.writeUInt8(labelBytes.length, 0);
    labelBytes.copy(labelBuffer, 1);
    buffers.push(labelBuffer);
  }

  // Null terminator
  buffers.push(Buffer.from([0]));

  return Buffer.concat(buffers);
}

/**
 * Decode DNS name from message
 * RFC 1035 Section 4.1.4: Message compression via pointers
 */
function decodeDNSName(data: Buffer, offset: number): { name: string; newOffset: number } {
  const labels: string[] = [];
  let currentOffset = offset;
  let jumped = false;
  let finalOffset = offset;
  const visited = new Set<number>(); // Detect compression loops

  while (true) {
    // Bounds check before reading
    if (currentOffset >= data.length) break;

    const length = data.readUInt8(currentOffset);

    if (length === 0) {
      // End of name
      if (!jumped) finalOffset = currentOffset + 1;
      break;
    }

    // Check for compression (pointer): top 2 bits set (0xC0)
    if ((length & 0xC0) === 0xC0) {
      // Bounds check for pointer
      if (currentOffset + 1 >= data.length) break;

      const pointer = ((length & 0x3F) << 8) | data.readUInt8(currentOffset + 1);

      // Validate pointer doesn't point forward or to itself
      if (pointer >= currentOffset) {
        throw new Error(`Invalid DNS compression pointer: ${pointer} >= ${currentOffset}`);
      }

      // Detect compression loops
      if (visited.has(pointer)) {
        throw new Error(`DNS compression loop detected at offset ${pointer}`);
      }
      visited.add(pointer);

      // Save position after pointer on first jump
      if (!jumped) {
        finalOffset = currentOffset + 2;
        jumped = true;
      }

      // Follow pointer
      currentOffset = pointer;
      continue;
    }

    // Regular label (0-63 bytes)
    if (length > 63) {
      throw new Error(`Invalid DNS label length: ${length} (max 63)`);
    }

    // Bounds check for label data
    if (currentOffset + 1 + length > data.length) break;

    const label = data.toString('utf8', currentOffset + 1, currentOffset + 1 + length);
    labels.push(label);
    currentOffset += 1 + length;

    // Update final offset if we haven't jumped
    if (!jumped) finalOffset = currentOffset;
  }

  return {
    name: labels.join('.'),
    newOffset: finalOffset,
  };
}

/**
 * Parse DNS/mDNS response message
 */
function parseMDNSResponse(data: Buffer): {
  transactionId: number;
  answers: MDNSRecord[];
  additionals: MDNSRecord[];
} | null {
  if (data.length < 12) {
    return null;
  }

  const transactionId = data.readUInt16BE(0);
  const flags = data.readUInt16BE(2);

  // RFC 1035 Section 4.1.1: Validate response flags
  const qr = (flags >> 15) & 0x1;        // Query/Response bit
  const opcode = (flags >> 11) & 0xF;    // Operation code
  const rcode = flags & 0xF;              // Response code

  // Must be a response (QR=1)
  if (qr !== 1) {
    throw new Error(`Invalid DNS response: QR bit not set (flags: 0x${flags.toString(16)})`);
  }

  // Must be standard query (OPCODE=0)
  if (opcode !== 0) {
    throw new Error(`Unsupported DNS OPCODE: ${opcode}`);
  }

  // Check for errors
  if (rcode !== 0) {
    const rcodeNames: { [key: number]: string } = {
      1: 'Format error',
      2: 'Server failure',
      3: 'Name error (NXDOMAIN)',
      4: 'Not implemented',
      5: 'Refused',
    };
    throw new Error(`DNS error: ${rcodeNames[rcode] || `RCODE ${rcode}`}`);
  }

  const questionCount = data.readUInt16BE(4);
  const answerCount = data.readUInt16BE(6);
  const authorityCount = data.readUInt16BE(8);
  const additionalCount = data.readUInt16BE(10);

  let offset = 12;

  // Skip questions
  for (let i = 0; i < questionCount; i++) {
    const { newOffset: nameOffset } = decodeDNSName(data, offset);
    offset = nameOffset + 4; // Skip QTYPE and QCLASS
  }

  // Parse answers
  const answers: MDNSRecord[] = [];
  for (let i = 0; i < answerCount; i++) {
    const record = parseResourceRecord(data, offset);
    if (record) {
      answers.push(record.record);
      offset = record.newOffset;
    } else {
      break;
    }
  }

  // Skip authority records
  for (let i = 0; i < authorityCount; i++) {
    const record = parseResourceRecord(data, offset);
    if (record) {
      offset = record.newOffset;
    } else {
      break;
    }
  }

  // Parse additional records
  const additionals: MDNSRecord[] = [];
  for (let i = 0; i < additionalCount; i++) {
    const record = parseResourceRecord(data, offset);
    if (record) {
      additionals.push(record.record);
      offset = record.newOffset;
    } else {
      break;
    }
  }

  return { transactionId, answers, additionals };
}

/**
 * Parse DNS resource record
 */
function parseResourceRecord(data: Buffer, offset: number): {
  record: MDNSRecord;
  newOffset: number;
} | null {
  if (offset >= data.length) return null;

  const { name, newOffset: nameEnd } = decodeDNSName(data, offset);

  if (nameEnd + 10 > data.length) return null;

  const rtype = data.readUInt16BE(nameEnd);
  const rclass = data.readUInt16BE(nameEnd + 2);
  const ttl = data.readUInt32BE(nameEnd + 4);
  const rdlength = data.readUInt16BE(nameEnd + 8);

  if (nameEnd + 10 + rdlength > data.length) return null;

  const rdataOffset = nameEnd + 10;
  let recordData: string | object;

  // Parse based on record type
  if (rtype === RecordType.A && rdlength === 4) {
    // IPv4 address
    recordData = `${data.readUInt8(rdataOffset)}.${data.readUInt8(rdataOffset + 1)}.${data.readUInt8(rdataOffset + 2)}.${data.readUInt8(rdataOffset + 3)}`;
  } else if (rtype === RecordType.AAAA && rdlength === 16) {
    // IPv6 address
    const parts: string[] = [];
    for (let i = 0; i < 16; i += 2) {
      parts.push(data.readUInt16BE(rdataOffset + i).toString(16));
    }
    recordData = parts.join(':');
  } else if (rtype === RecordType.PTR || rtype === RecordType.CNAME || rtype === RecordType.NS) {
    // Domain name
    const { name: targetName } = decodeDNSName(data, rdataOffset);
    recordData = targetName;
  } else if (rtype === RecordType.SRV && rdlength >= 6) {
    // Service record
    const priority = data.readUInt16BE(rdataOffset);
    const weight = data.readUInt16BE(rdataOffset + 2);
    const port = data.readUInt16BE(rdataOffset + 4);
    const { name: target } = decodeDNSName(data, rdataOffset + 6);
    recordData = { priority, weight, port, target };
  } else if (rtype === RecordType.TXT) {
    // Text record
    const txt: string[] = [];
    let txtOffset = rdataOffset;
    const txtEnd = rdataOffset + rdlength;

    while (txtOffset < txtEnd) {
      const txtLen = data.readUInt8(txtOffset);
      if (txtOffset + 1 + txtLen > txtEnd) break;
      txt.push(data.toString('utf8', txtOffset + 1, txtOffset + 1 + txtLen));
      txtOffset += 1 + txtLen;
    }

    recordData = { txt };
  } else {
    // Unknown type, store as hex
    recordData = data.subarray(rdataOffset, rdataOffset + rdlength).toString('hex');
  }

  const typeNames: { [key: number]: string } = {
    [RecordType.A]: 'A',
    [RecordType.NS]: 'NS',
    [RecordType.CNAME]: 'CNAME',
    [RecordType.SOA]: 'SOA',
    [RecordType.PTR]: 'PTR',
    [RecordType.MX]: 'MX',
    [RecordType.TXT]: 'TXT',
    [RecordType.AAAA]: 'AAAA',
    [RecordType.SRV]: 'SRV',
    [RecordType.ANY]: 'ANY',
  };

  // RFC 6762 Section 10.2: Bit 15 of the class field is the cache-flush bit.
  // Mask it off to get the actual DNS class, but note it for mDNS awareness.
  const cacheFlush = (rclass & 0x8000) !== 0;
  const actualClass = rclass & 0x7FFF;
  const classStr = actualClass === RecordClass.IN
    ? (cacheFlush ? 'IN (cache-flush)' : 'IN')
    : `CLASS${actualClass}`;

  const record: MDNSRecord = {
    name,
    type: typeNames[rtype] || `TYPE${rtype}`,
    class: classStr,
    ttl,
    data: recordData,
  };

  return {
    record,
    newOffset: rdataOffset + rdlength,
  };
}

/**
 * Query mDNS for services on the local network.
 * Can query for specific services or enumerate all services.
 */
export async function handleMDNSQuery(request: Request): Promise<Response> {
  try {
    const body = await request.json() as MDNSRequest;
    const {
      host,
      port = 5353,
      timeout = 15000,
      service = '_services._dns-sd._udp.local',
      queryType = 'PTR',
      unicastResponse = false,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies MDNSResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        error: 'Port must be between 1 and 65535',
      } satisfies MDNSResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Map query type string to enum
    const typeMap: { [key: string]: RecordType } = {
      'A': RecordType.A,
      'AAAA': RecordType.AAAA,
      'PTR': RecordType.PTR,
      'SRV': RecordType.SRV,
      'TXT': RecordType.TXT,
      'ANY': RecordType.ANY,
    };

    const qtype = typeMap[queryType.toUpperCase()] || RecordType.PTR;

    const start = Date.now();

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      // Build mDNS query
      const query = buildMDNSQuery(service, qtype, unicastResponse);

      // DNS over TCP requires a 2-byte length prefix (RFC 1035 Section 4.2.2)
      const tcpQuery = Buffer.allocUnsafe(2 + query.length);
      tcpQuery.writeUInt16BE(query.length, 0);
      query.copy(tcpQuery, 2);

      // Send query with TCP framing
      const writer = socket.writable.getWriter();
      await writer.write(tcpQuery);
      writer.releaseLock();

      // Read response — accumulate bytes until we have the full TCP-framed message
      // RFC 1035 Section 4.2.2: DNS over TCP uses 2-byte length prefix
      const reader = socket.readable.getReader();
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let expectedLength = -1;

      while (true) {
        const { value, done } = await Promise.race([
          reader.read(),
          timeoutPromise,
        ]);

        if (done || !value) break;

        const chunk = Buffer.from(value);
        chunks.push(chunk);
        totalBytes += chunk.length;

        // Once we have at least 2 bytes, read the expected DNS message length
        if (expectedLength < 0 && totalBytes >= 2) {
          const first = Buffer.concat(chunks);
          expectedLength = first.readUInt16BE(0);

          // Validate length is reasonable (max DNS message size is 65535 bytes)
          if (expectedLength > 65535) {
            throw new Error(`Invalid TCP DNS message length: ${expectedLength}`);
          }
        }

        // We have the full message when total >= 2 (length prefix) + expectedLength
        if (expectedLength >= 0 && totalBytes >= 2 + expectedLength) {
          break;
        }
      }

      if (totalBytes < 2) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'No response from mDNS responder',
        } satisfies MDNSResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Strip the 2-byte TCP length prefix before parsing
      const fullBuffer = Buffer.concat(chunks);
      const dnsMessage = fullBuffer.subarray(2, 2 + (expectedLength >= 0 ? expectedLength : fullBuffer.length - 2));

      const response = parseMDNSResponse(dnsMessage);

      if (!response) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Invalid mDNS response format',
        } satisfies MDNSResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const rtt = Date.now() - start;

      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        service,
        answers: response.answers,
        additionals: response.additionals,
        answerCount: response.answers.length,
        rtt,
      } satisfies MDNSResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      socket.close();
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      host: '',
      port: 5353,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies MDNSResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Build a DNS/mDNS response packet (QR=1, AA=1) with PTR+SRV+TXT records.
 * Used by handleMDNSAnnounce to simulate a service announcement.
 */
function buildMDNSAnnouncement(
  serviceType: string,   // e.g. "_http._tcp.local"
  instanceName: string,  // e.g. "MyService._http._tcp.local"
  hostname: string,      // e.g. "mydevice.local"
  port: number,
  txtRecords: string[],  // e.g. ["path=/", "version=1"]
  ttl: number = 120,
): Uint8Array {
  // We build all sections in memory using DataView helpers.
  const enc = new TextEncoder();

  // --- Helper: encode DNS name as length-prefixed labels ---
  function encodeName(name: string): Uint8Array {
    const labels = name.split('.').filter(l => l.length > 0);
    const parts: Uint8Array[] = [];
    for (const lbl of labels) {
      const b = enc.encode(lbl);
      const chunk = new Uint8Array(1 + b.length);
      chunk[0] = b.length;
      chunk.set(b, 1);
      parts.push(chunk);
    }
    parts.push(new Uint8Array([0])); // root
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }

  // --- Helper: build a resource record ---
  // RFC 6762 Section 10.2: The cache-flush bit MUST NOT be set on shared
  // records. PTR is a shared record (multiple instances per service type).
  // SRV, TXT, A, AAAA are unique records and MAY have the cache-flush bit set.
  function buildRR(name: string, rtype: number, rttl: number, rdata: Uint8Array, cacheFlush: boolean = false): Uint8Array {
    const nameBytes = encodeName(name);
    // NAME + TYPE(2) + CLASS(2) + TTL(4) + RDLENGTH(2) + RDATA
    const rec = new Uint8Array(nameBytes.length + 10 + rdata.length);
    const view = new DataView(rec.buffer);
    rec.set(nameBytes, 0);
    let o = nameBytes.length;
    view.setUint16(o, rtype);    o += 2;
    view.setUint16(o, cacheFlush ? 0x8001 : 0x0001);   o += 2; // IN class, cache-flush if unique record
    view.setUint32(o, rttl);     o += 4;
    view.setUint16(o, rdata.length); o += 2;
    rec.set(rdata, o);
    return rec;
  }

  // PTR record: serviceType → instanceName (shared record — no cache-flush)
  const ptrRdata = encodeName(instanceName);
  const ptrRR = buildRR(serviceType, 12 /* PTR */, ttl, ptrRdata, false);

  // SRV record: instanceName → priority(0) + weight(0) + port + hostname (unique record)
  const hostnameBytes = encodeName(hostname);
  const srvRdata = new Uint8Array(6 + hostnameBytes.length);
  const srvView = new DataView(srvRdata.buffer);
  srvView.setUint16(0, 0);    // priority
  srvView.setUint16(2, 0);    // weight
  srvView.setUint16(4, port); // port
  srvRdata.set(hostnameBytes, 6);
  const srvRR = buildRR(instanceName, 33 /* SRV */, ttl, srvRdata, true);

  // TXT record: key=value pairs
  const txtParts: Uint8Array[] = [];
  for (const kv of (txtRecords.length > 0 ? txtRecords : ['path=/'])) {
    const b = enc.encode(kv);
    const chunk = new Uint8Array(1 + b.length);
    chunk[0] = b.length;
    chunk.set(b, 1);
    txtParts.push(chunk);
  }
  let txtLen = 0;
  for (const p of txtParts) txtLen += p.length;
  const txtRdata = new Uint8Array(txtLen);
  let toff = 0;
  for (const p of txtParts) { txtRdata.set(p, toff); toff += p.length; }
  const txtRR = buildRR(instanceName, 16 /* TXT */, ttl, txtRdata, true);

  // DNS header: QR=1, AA=1, ANCOUNT=3
  const header = new Uint8Array(12);
  const hview = new DataView(header.buffer);
  hview.setUint16(0, 0x0000); // Transaction ID (0 for mDNS)
  hview.setUint16(2, 0x8400); // Flags: QR=1, Opcode=0, AA=1
  hview.setUint16(4, 0);      // QDCOUNT
  hview.setUint16(6, 3);      // ANCOUNT
  hview.setUint16(8, 0);      // NSCOUNT
  hview.setUint16(10, 0);     // ARCOUNT

  // Concatenate all sections
  const totalLen = header.length + ptrRR.length + srvRR.length + txtRR.length;
  const packet = new Uint8Array(totalLen);
  let pos = 0;
  packet.set(header, pos); pos += header.length;
  packet.set(ptrRR, pos);  pos += ptrRR.length;
  packet.set(srvRR, pos);  pos += srvRR.length;
  packet.set(txtRR, pos);
  return packet;
}

/**
 * Send an mDNS service announcement to a host.
 *
 * Builds a DNS response packet with PTR + SRV + TXT records for the given
 * service type/instance/hostname and sends it to the target host. This
 * simulates a Zeroconf/Bonjour service announcement over TCP.
 *
 * POST /api/mdns/announce
 * Body: { host, port?, serviceType?, instanceName?, hostname?, servicePort?, txtRecords?, ttl?, timeout? }
 */
export async function handleMDNSAnnounce(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      serviceType?: string;
      instanceName?: string;
      hostname?: string;
      servicePort?: number;
      txtRecords?: string[];
      ttl?: number;
      timeout?: number;
    };

    const {
      host,
      port = 5353,
      serviceType = '_http._tcp.local',
      instanceName,
      hostname,
      servicePort = 80,
      txtRecords = ['path=/'],
      ttl = 120,
      timeout = 8000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Default instanceName: "portofcall.<serviceType>"
    const resolvedInstance = instanceName || `portofcall.${serviceType}`;
    const resolvedHostname = hostname || `${host}.local`;

    const dnsPacket = buildMDNSAnnouncement(
      serviceType, resolvedInstance, resolvedHostname, servicePort, txtRecords, ttl,
    );

    // DNS over TCP requires a 2-byte length prefix (RFC 1035 Section 4.2.2)
    const packet = new Uint8Array(2 + dnsPacket.length);
    new DataView(packet.buffer).setUint16(0, dnsPacket.length);
    packet.set(dnsPacket, 2);

    const toHex = (arr: Uint8Array) =>
      Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join(' ');

    const start = Date.now();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    let portOpen = false;
    let latencyMs = 0;
    let serverResponse: string | undefined;

    try {
      const socket = connect(`${host}:${port}`);
      await Promise.race([socket.opened, timeoutPromise]);
      portOpen = true;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      await writer.write(packet);
      latencyMs = Date.now() - start;

      // Attempt to read any response (e.g., if the peer acknowledges)
      try {
        const readTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('read_timeout')), 2000)
        );
        const result = await Promise.race([reader.read(), readTimeout]);
        if (!result.done && result.value && result.value.length >= 2) {
          serverResponse = `Received ${result.value.length} bytes: ${toHex(result.value.slice(0, 12))}...`;
        }
      } catch {
        // No response — typical for mDNS (multicast protocol, TCP is uncommon)
      }

      try { reader.releaseLock(); } catch { /* ok */ }
      try { writer.releaseLock(); } catch { /* ok */ }
      socket.close();
    } catch (err) {
      latencyMs = Date.now() - start;
      return new Response(JSON.stringify({
        success: false, host, port, portOpen: false, latencyMs,
        error: err instanceof Error ? err.message : 'Connection failed',
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      success: portOpen,
      host, port,
      portOpen,
      announcement: {
        serviceType,
        instanceName: resolvedInstance,
        srvTarget: resolvedHostname,
        srvPort: servicePort,
        txtRecords,
        ttl,
        records: ['PTR', 'SRV', 'TXT'],
      },
      packetBytes: packet.length,
      packetHex: toHex(packet.slice(0, 32)) + (packet.length > 32 ? '...' : ''),
      serverResponse,
      latencyMs,
      note: 'mDNS announcement sent as DNS response packet (QR=1, AA=1) with PTR+SRV+TXT records. ' +
            'Standard mDNS uses UDP multicast; this sends via TCP to the target host.',
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Discover all mDNS services on the local network.
 * Queries _services._dns-sd._udp.local to enumerate service types.
 */
export async function handleMDNSDiscover(request: Request): Promise<Response> {
  try {
    const body = await request.json() as MDNSRequest;
    const { host, port = 5353, timeout = 10000 } = body;

    // Query for service enumeration
    const discoverRequest = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({
        host,
        port,
        timeout,
        service: '_services._dns-sd._udp.local',
        queryType: 'PTR',
      }),
    });

    return handleMDNSQuery(discoverRequest);

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
