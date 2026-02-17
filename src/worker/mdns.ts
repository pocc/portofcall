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
 * - Legacy Unicast: QU (QM=0) bit for unicast responses
 * - Multicast Responses: Share responses with all listeners
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
 */
function buildMDNSQuery(queryName: string, queryType: RecordType): Buffer {
  // DNS Header (12 bytes)
  const header = Buffer.allocUnsafe(12);
  const transactionId = Math.floor(Math.random() * 65536);

  header.writeUInt16BE(transactionId, 0); // Transaction ID
  header.writeUInt16BE(0x0000, 2); // Flags (standard query)
  header.writeUInt16BE(1, 4); // Questions count
  header.writeUInt16BE(0, 6); // Answer RRs
  header.writeUInt16BE(0, 8); // Authority RRs
  header.writeUInt16BE(0, 10); // Additional RRs

  // Question section
  const question = buildDNSQuestion(queryName, queryType, RecordClass.IN);

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

    const labelBuffer = Buffer.allocUnsafe(1 + label.length);
    labelBuffer.writeUInt8(label.length, 0);
    labelBuffer.write(label, 1, 'ascii');
    buffers.push(labelBuffer);
  }

  // Null terminator
  buffers.push(Buffer.from([0]));

  return Buffer.concat(buffers);
}

/**
 * Decode DNS name from message
 */
function decodeDNSName(data: Buffer, offset: number): { name: string; newOffset: number } {
  const labels: string[] = [];
  let currentOffset = offset;
  const maxJumps = 20; // Prevent infinite loops
  let jumps = 0;

  while (true) {
    if (currentOffset >= data.length) break;

    const length = data.readUInt8(currentOffset);

    if (length === 0) {
      currentOffset++;
      break;
    }

    // Check for compression (pointer)
    if ((length & 0xC0) === 0xC0) {
      if (currentOffset + 1 >= data.length) break;

      const pointer = ((length & 0x3F) << 8) | data.readUInt8(currentOffset + 1);

      if (jumps === 0) {
        currentOffset += 2; // Move past pointer for return value
      }

      jumps++;
      if (jumps > maxJumps) break;

      const result = decodeDNSName(data, pointer);
      labels.push(result.name);
      break;
    }

    // Regular label
    if (currentOffset + 1 + length > data.length) break;

    const label = data.toString('ascii', currentOffset + 1, currentOffset + 1 + length);
    labels.push(label);
    currentOffset += 1 + length;
  }

  return {
    name: labels.join('.'),
    newOffset: currentOffset,
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
  // const flags = data.readUInt16BE(2);
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
  let recordData: string | object = '';

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
    [RecordType.PTR]: 'PTR',
    [RecordType.TXT]: 'TXT',
    [RecordType.AAAA]: 'AAAA',
    [RecordType.SRV]: 'SRV',
  };

  const record: MDNSRecord = {
    name,
    type: typeNames[rtype] || `TYPE${rtype}`,
    class: (rclass & 0x7FFF) === RecordClass.IN ? 'IN' : `CLASS${rclass}`,
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
      const query = buildMDNSQuery(service, qtype);

      // Send query
      const writer = socket.writable.getWriter();
      await writer.write(query);
      writer.releaseLock();

      // Read response
      const reader = socket.readable.getReader();

      const { value, done } = await Promise.race([
        reader.read(),
        timeoutPromise,
      ]);

      if (done || !value) {
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

      const response = parseMDNSResponse(Buffer.from(value));

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
  function buildRR(name: string, rtype: number, rttl: number, rdata: Uint8Array): Uint8Array {
    const nameBytes = encodeName(name);
    // NAME + TYPE(2) + CLASS(2) + TTL(4) + RDLENGTH(2) + RDATA
    const rec = new Uint8Array(nameBytes.length + 10 + rdata.length);
    const view = new DataView(rec.buffer);
    rec.set(nameBytes, 0);
    let o = nameBytes.length;
    view.setUint16(o, rtype);    o += 2;
    view.setUint16(o, 0x8001);   o += 2; // IN class + flush bit
    view.setUint32(o, rttl);     o += 4;
    view.setUint16(o, rdata.length); o += 2;
    rec.set(rdata, o);
    return rec;
  }

  // PTR record: serviceType → instanceName
  const ptrRdata = encodeName(instanceName);
  const ptrRR = buildRR(serviceType, 12 /* PTR */, ttl, ptrRdata);

  // SRV record: instanceName → priority(0) + weight(0) + port + hostname
  const hostnameBytes = encodeName(hostname);
  const srvRdata = new Uint8Array(6 + hostnameBytes.length);
  const srvView = new DataView(srvRdata.buffer);
  srvView.setUint16(0, 0);    // priority
  srvView.setUint16(2, 0);    // weight
  srvView.setUint16(4, port); // port
  srvRdata.set(hostnameBytes, 6);
  const srvRR = buildRR(instanceName, 33 /* SRV */, ttl, srvRdata);

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
  const txtRR = buildRR(instanceName, 16 /* TXT */, ttl, txtRdata);

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

    const packet = buildMDNSAnnouncement(
      serviceType, resolvedInstance, resolvedHostname, servicePort, txtRecords, ttl,
    );

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
        serviceType: resolvedInstance,
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
