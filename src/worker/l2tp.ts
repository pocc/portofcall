/**
 * L2TP Protocol Implementation (RFC 2661 - L2TPv2)
 *
 * Layer 2 Tunneling Protocol is a VPN tunneling protocol that allows the creation
 * of virtual private networks (VPNs) over IP networks. L2TP is commonly used with
 * IPsec for secure remote access.
 *
 * Protocol Overview:
 * - Port: 1701 (UDP primarily, TCP for this implementation due to Workers API)
 * - Control Messages: Use AVPs (Attribute-Value Pairs)
 * - Tunnel Establishment: SCCRQ -> SCCRP -> SCCCN handshake
 * - Session Management: ICRQ -> ICRP -> ICCN for incoming calls
 *
 * Control Message Types:
 * - SCCRQ (1) - Start-Control-Connection-Request
 * - SCCRP (2) - Start-Control-Connection-Reply
 * - SCCCN (3) - Start-Control-Connection-Connected
 * - StopCCN (4) - Stop-Control-Connection-Notification
 * - Hello (6) - Hello keepalive
 * - ICRQ (10) - Incoming-Call-Request
 * - ICRP (11) - Incoming-Call-Reply
 * - ICCN (12) - Incoming-Call-Connected
 * - ZLB - Zero Length Body (ACK)
 *
 * AVP Types (Attribute-Value Pairs):
 * - Message Type (0): Control message type
 * - Protocol Version (2): L2TP version
 * - Host Name (7): LAC/LNS hostname
 * - Framing Capabilities (3): Sync/Async framing
 * - Assigned Tunnel ID (9): Tunnel identifier
 * - Assigned Connection ID (14): Session identifier
 * - Vendor Name (8): Vendor identification
 *
 * Use Cases:
 * - VPN connectivity testing
 * - L2TP/IPsec gateway probing
 * - Network tunnel establishment
 * - Remote access VPN diagnostics
 */

import { connect } from 'cloudflare:sockets';

interface L2TPRequest {
  host: string;
  port?: number;
  timeout?: number;
  hostname?: string;
}

interface L2TPResponse {
  success: boolean;
  host: string;
  port: number;
  tunnelId?: number;
  assignedTunnelId?: number;
  peerHostname?: string;
  vendorName?: string;
  protocolVersion?: string;
  rtt?: number;
  error?: string;
}

// L2TP Message Types
enum L2TPMessageType {
  SCCRQ = 1,  // Start-Control-Connection-Request
  SCCRP = 2,  // Start-Control-Connection-Reply
  SCCCN = 3,  // Start-Control-Connection-Connected
  StopCCN = 4, // Stop-Control-Connection-Notification
  Hello = 6,   // Hello
  ICRQ = 10,   // Incoming-Call-Request
  ICRP = 11,   // Incoming-Call-Reply
  ICCN = 12,   // Incoming-Call-Connected
}

// AVP Attribute Types
enum AVPType {
  MessageType = 0,
  ProtocolVersion = 2,
  FramingCapabilities = 3,
  BearerCapabilities = 4,
  HostName = 7,
  VendorName = 8,
  AssignedTunnelID = 9,
  ReceiveWindowSize = 10,
  AssignedConnectionID = 14,
}

/**
 * Build an L2TP control message with AVPs
 */
function buildL2TPMessage(
  _messageType: L2TPMessageType,
  tunnelId: number,
  sessionId: number,
  ns: number,
  nr: number,
  avps: Array<{ type: number; value: Buffer }>
): Buffer {
  // L2TP header structure:
  // 0                   1                   2                   3
  // 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
  // +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
  // |T|L|x|x|S|x|O|P|x|x|x|x|  Ver  |          Length (opt)         |
  // +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
  // |           Tunnel ID           |           Session ID          |
  // +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
  // |             Ns (opt)          |             Nr (opt)          |
  // +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+

  const avpBuffers: Buffer[] = [];
  let avpTotalLength = 0;

  // Build AVPs
  for (const avp of avps) {
    // AVP Header: M bit (1) + H bit (0) + reserved (4 bits) + length (10 bits) = 2 bytes
    // Vendor ID (2 bytes) - 0 for IETF
    // Attribute Type (2 bytes)
    // Value (variable)
    const avpLength = 6 + avp.value.length;
    const avpHeader = Buffer.allocUnsafe(6);

    // Set M (mandatory) bit and length (10 bits)
    avpHeader.writeUInt16BE(0x8000 | avpLength, 0); // M=1, H=0, length
    avpHeader.writeUInt16BE(0, 2); // Vendor ID = 0 (IETF)
    avpHeader.writeUInt16BE(avp.type, 4); // Attribute Type

    const avpBuffer = Buffer.concat([avpHeader, avp.value]);
    avpBuffers.push(avpBuffer);
    avpTotalLength += avpBuffer.length;
  }

  // L2TP header with sequence numbers
  const headerLength = 12; // With Ns/Nr
  const totalLength = headerLength + avpTotalLength;

  const header = Buffer.allocUnsafe(headerLength);

  // Flags: T=1 (control), L=1 (length), S=1 (sequence), Ver=2
  header.writeUInt16BE(0xC802, 0); // 1100 1000 0000 0010
  header.writeUInt16BE(totalLength, 2); // Length
  header.writeUInt16BE(tunnelId, 4); // Tunnel ID
  header.writeUInt16BE(sessionId, 6); // Session ID (0 for control)
  header.writeUInt16BE(ns, 8); // Ns (sequence number)
  header.writeUInt16BE(nr, 10); // Nr (next expected sequence)

  return Buffer.concat([header, ...avpBuffers]);
}

/**
 * Parse L2TP control message and extract AVPs
 */
function parseL2TPMessage(data: Buffer): {
  tunnelId: number;
  sessionId: number;
  ns: number;
  nr: number;
  avps: Array<{ type: number; value: Buffer }>;
} | null {
  if (data.length < 12) {
    return null;
  }

  const flags = data.readUInt16BE(0);
  const isControl = (flags & 0x8000) !== 0;
  const hasLength = (flags & 0x4000) !== 0;
  const hasSequence = (flags & 0x0800) !== 0;

  if (!isControl) {
    return null; // Data packet, not control
  }

  let offset = 2;

  if (hasLength) {
    offset += 2; // Skip length field
  }

  const tunnelId = data.readUInt16BE(offset);
  const sessionId = data.readUInt16BE(offset + 2);
  offset += 4;

  let ns = 0;
  let nr = 0;
  if (hasSequence) {
    ns = data.readUInt16BE(offset);
    nr = data.readUInt16BE(offset + 2);
    offset += 4;
  }

  const avps: Array<{ type: number; value: Buffer }> = [];

  while (offset < data.length) {
    if (offset + 6 > data.length) break;

    const avpHeader = data.readUInt16BE(offset);
    const avpLength = avpHeader & 0x03FF; // Lower 10 bits

    if (avpLength < 6 || offset + avpLength > data.length) break;

    const vendorId = data.readUInt16BE(offset + 2);
    const attrType = data.readUInt16BE(offset + 4);

    if (vendorId === 0) { // IETF AVP
      const value = data.subarray(offset + 6, offset + avpLength);
      avps.push({ type: attrType, value: Buffer.from(value) });
    }

    offset += avpLength;
  }

  return { tunnelId, sessionId, ns, nr, avps };
}

/**
 * Connect to an L2TP server and perform tunnel establishment handshake.
 * Sends SCCRQ and waits for SCCRP.
 */
export async function handleL2TPConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as L2TPRequest;
    const { host, port = 1701, timeout = 15000, hostname = 'portofcall-worker' } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies L2TPResponse), {
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
      } satisfies L2TPResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      // Generate tunnel ID (random 16-bit value)
      const localTunnelId = Math.floor(Math.random() * 65535) + 1;

      // Build SCCRQ (Start-Control-Connection-Request) message
      const avps = [
        // Message Type AVP
        {
          type: AVPType.MessageType,
          value: Buffer.from([0x00, L2TPMessageType.SCCRQ]),
        },
        // Protocol Version AVP (version 1.0)
        {
          type: AVPType.ProtocolVersion,
          value: Buffer.from([0x01, 0x00]),
        },
        // Host Name AVP
        {
          type: AVPType.HostName,
          value: Buffer.from(hostname, 'ascii'),
        },
        // Framing Capabilities (both sync and async)
        {
          type: AVPType.FramingCapabilities,
          value: Buffer.from([0x00, 0x00, 0x00, 0x03]),
        },
        // Assigned Tunnel ID
        {
          type: AVPType.AssignedTunnelID,
          value: Buffer.alloc(2), // Will be filled below
        },
        // Receive Window Size
        {
          type: AVPType.ReceiveWindowSize,
          value: Buffer.from([0x00, 0x04]), // Window size = 4
        },
      ];

      // Fix the Assigned Tunnel ID AVP value
      const tunnelIdBuffer = Buffer.allocUnsafe(2);
      tunnelIdBuffer.writeUInt16BE(localTunnelId, 0);
      avps[4].value = tunnelIdBuffer;

      const sccrq = buildL2TPMessage(
        L2TPMessageType.SCCRQ,
        0, // Tunnel ID = 0 (not assigned yet)
        0, // Session ID = 0 (control connection)
        0, // Ns = 0 (first message)
        0  // Nr = 0
      , avps);

      // Send SCCRQ
      const writer = socket.writable.getWriter();
      await writer.write(sccrq);
      writer.releaseLock();

      // Read SCCRP response
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
          error: 'No response from L2TP server',
        } satisfies L2TPResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const response = parseL2TPMessage(Buffer.from(value));

      if (!response) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Invalid L2TP response format',
        } satisfies L2TPResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Extract AVPs from SCCRP
      let messageType = 0;
      let assignedTunnelId = 0;
      let peerHostname = '';
      let vendorName = '';
      let protocolVersion = '';

      for (const avp of response.avps) {
        if (avp.type === AVPType.MessageType && avp.value.length >= 2) {
          messageType = avp.value.readUInt16BE(0);
        } else if (avp.type === AVPType.AssignedTunnelID && avp.value.length >= 2) {
          assignedTunnelId = avp.value.readUInt16BE(0);
        } else if (avp.type === AVPType.HostName) {
          peerHostname = avp.value.toString('ascii');
        } else if (avp.type === AVPType.VendorName) {
          vendorName = avp.value.toString('ascii');
        } else if (avp.type === AVPType.ProtocolVersion && avp.value.length >= 2) {
          const major = avp.value[0];
          const minor = avp.value[1];
          protocolVersion = `${major}.${minor}`;
        }
      }

      const rtt = Date.now() - start;

      reader.releaseLock();
      socket.close();

      if (messageType !== L2TPMessageType.SCCRP) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: `Unexpected message type: ${messageType} (expected SCCRP)`,
        } satisfies L2TPResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        tunnelId: localTunnelId,
        assignedTunnelId,
        peerHostname,
        vendorName,
        protocolVersion,
        rtt,
      } satisfies L2TPResponse), {
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
      port: 1701,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies L2TPResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Send L2TP Hello keepalive message to maintain tunnel
 */
export async function handleL2TPHello(request: Request): Promise<Response> {
  try {
    const body = await request.json() as L2TPRequest & { tunnelId: number };
    const { host, port = 1701, timeout = 10000, tunnelId } = body;

    if (!host || tunnelId === undefined) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host and tunnelId are required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      // Build Hello message
      const avps = [
        {
          type: AVPType.MessageType,
          value: Buffer.from([0x00, L2TPMessageType.Hello]),
        },
      ];

      const hello = buildL2TPMessage(
        L2TPMessageType.Hello,
        tunnelId,
        0, // Session ID = 0 (control)
        1, // Ns
        0  // Nr
      , avps);

      const writer = socket.writable.getWriter();
      await writer.write(hello);
      writer.releaseLock();

      // Read ZLB ACK response
      const reader = socket.readable.getReader();
      const { value } = await Promise.race([
        reader.read(),
        timeoutPromise,
      ]);

      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: !!value,
        message: value ? 'Hello ACK received' : 'No response',
      }), {
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
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── POST /api/l2tp/session (pure Uint8Array, no Buffer) ─────────────────────

/**
 * Establish a full L2TP tunnel + PPP session:
 *   SCCRQ → SCCRP → SCCCN → ICRQ → ICRP → ICCN
 *
 * All frames built with DataView/Uint8Array (no Node.js Buffer).
 *
 * POST /api/l2tp/session
 * Body: { host, port?, hostname?, timeout? }
 */
export async function handleL2TPSession(request: Request): Promise<Response> {
  try {
    const body = await request.json() as { host?: string; port?: number; hostname?: string; timeout?: number };
    const { host, port = 1701, hostname = 'portofcall', timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // ── Helpers (Uint8Array, no Buffer) ──────────────────────────────────────

    /** Encode a uint16 big-endian as a 2-byte Uint8Array */
    function u16(v: number): Uint8Array {
      const b = new Uint8Array(2);
      new DataView(b.buffer).setUint16(0, v, false);
      return b;
    }

    /** Encode a uint32 big-endian as a 4-byte Uint8Array */
    function u32(v: number): Uint8Array {
      const b = new Uint8Array(4);
      new DataView(b.buffer).setUint32(0, v, false);
      return b;
    }

    /** Build an L2TP AVP: [M|len(2)] [vendorId(2)] [type(2)] [value...] */
    function avp(type: number, value: Uint8Array): Uint8Array {
      const len = 6 + value.length;
      const buf = new Uint8Array(len);
      const dv = new DataView(buf.buffer);
      dv.setUint16(0, 0x8000 | len, false); // M=1 (mandatory)
      dv.setUint16(2, 0, false);             // vendor ID = 0 (IETF)
      dv.setUint16(4, type, false);          // attribute type
      buf.set(value, 6);
      return buf;
    }

    /** Build an L2TP control packet (T=1, L=1, S=1, ver=2) */
    function buildControl(
      tunnelId: number, sessionId: number, ns: number, nr: number,
      avps: Uint8Array[],
    ): Uint8Array {
      const avpTotal = avps.reduce((s, a) => s + a.length, 0);
      const total = 12 + avpTotal;
      const buf = new Uint8Array(total);
      const dv = new DataView(buf.buffer);
      dv.setUint16(0, 0xC802, false); // flags: T=1,L=1,S=1,ver=2
      dv.setUint16(2, total, false);  // length
      dv.setUint16(4, tunnelId, false);
      dv.setUint16(6, sessionId, false);
      dv.setUint16(8, ns, false);     // Ns
      dv.setUint16(10, nr, false);    // Nr
      let off = 12;
      for (const a of avps) { buf.set(a, off); off += a.length; }
      return buf;
    }

    /** Parse an L2TP control packet — returns key fields or null on error */
    function parseControl(data: Uint8Array): {
      tunnelId: number; sessionId: number; ns: number; nr: number;
      msgType: number; assignedTunnelId?: number; assignedSessionId?: number;
      hostName?: string; protocolVersion?: string;
    } | null {
      if (data.length < 12) return null;
      const dv = new DataView(data.buffer, data.byteOffset);
      const flags = dv.getUint16(0, false);
      if (!(flags & 0x8000)) return null; // must be control (T=1)
      let off = 2;
      if (flags & 0x4000) off += 2; // skip optional length field
      const tunnelId  = dv.getUint16(off, false); off += 2;
      const sessionId = dv.getUint16(off, false); off += 2;
      let ns = 0, nr = 0;
      if (flags & 0x0800) {
        ns = dv.getUint16(off, false);
        nr = dv.getUint16(off + 2, false);
        off += 4;
      }
      // Read AVPs
      let msgType = 0;
      let assignedTunnelId: number | undefined;
      let assignedSessionId: number | undefined;
      let hostName: string | undefined;
      let protocolVersion: string | undefined;
      const dec = new TextDecoder();
      while (off + 6 <= data.length) {
        const avpDv = new DataView(data.buffer, data.byteOffset + off);
        const avpLen = avpDv.getUint16(0, false) & 0x03FF;
        if (avpLen < 6 || off + avpLen > data.length) break;
        const vendorId = avpDv.getUint16(2, false);
        const attrType = avpDv.getUint16(4, false);
        if (vendorId === 0 && avpLen > 6) {
          const val = data.slice(data.byteOffset + off + 6, data.byteOffset + off + avpLen);
          if (attrType === 0  && val.length >= 2) msgType           = new DataView(val.buffer, val.byteOffset).getUint16(0, false);
          if (attrType === 9  && val.length >= 2) assignedTunnelId  = new DataView(val.buffer, val.byteOffset).getUint16(0, false);
          if (attrType === 14 && val.length >= 2) assignedSessionId = new DataView(val.buffer, val.byteOffset).getUint16(0, false);
          if (attrType === 7) hostName       = dec.decode(val);
          if (attrType === 2 && val.length >= 2) protocolVersion   = `${val[0]}.${val[1]}`;
        }
        off += avpLen;
      }
      return { tunnelId, sessionId, ns, nr, msgType, assignedTunnelId, assignedSessionId, hostName, protocolVersion };
    }

    /** Read bytes from reader until we have a complete L2TP control message */
    async function readMsg(reader: ReadableStreamDefaultReader<Uint8Array>, waitMs: number): Promise<Uint8Array> {
      const chunks: Uint8Array[] = [];
      let total = 0;
      let expected = 0; // 0 = don't yet know the length
      const dl = new Promise<never>((_, r) => setTimeout(() => r(new Error('Read timeout')), waitMs));
      while (true) {
        const { value, done } = await Promise.race([reader.read(), dl.then(() => ({ value: undefined as Uint8Array | undefined, done: true }))]);
        if (done || !value) throw new Error('Stream ended before complete L2TP message');
        chunks.push(value);
        total += value.length;
        if (expected === 0 && total >= 4) {
          // Reconstruct enough to read length
          const combined = new Uint8Array(total);
          let o = 0; for (const c of chunks) { combined.set(c, o); o += c.length; }
          const dv = new DataView(combined.buffer);
          const flags = dv.getUint16(0, false);
          if (flags & 0x4000) expected = dv.getUint16(2, false);
          else break; // no L bit — variable length, just use what we have
        }
        if (expected > 0 && total >= expected) break;
      }
      const out = new Uint8Array(total);
      let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
      return out;
    }

    // ── Main session flow ─────────────────────────────────────────────────────

    const startTime = Date.now();
    const deadline = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );
    const enc = new TextEncoder();

    const work = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      let ns = 0;
      const localTunnelId = 1;
      const localSessionId = 1;

      try {
        // ── 1. SCCRQ ───────────────────────────────────────────────────────
        await writer.write(buildControl(0, 0, ns++, 0, [
          avp(0,  u16(1)),                    // MessageType = SCCRQ (1)
          avp(2,  new Uint8Array([1, 0])),    // ProtocolVersion 1.0
          avp(7,  enc.encode(hostname)),      // HostName
          avp(3,  u32(0x00000003)),           // FramingCapabilities: sync+async
          avp(4,  u32(0x00000003)),           // BearerCapabilities: analog+digital
          avp(9,  u16(localTunnelId)),        // AssignedTunnelID
          avp(10, u16(4)),                    // ReceiveWindowSize
        ]));

        // ── 2. SCCRP ───────────────────────────────────────────────────────
        const sccrpData = await readMsg(reader, 8000);
        const sccrp = parseControl(sccrpData);
        if (!sccrp || sccrp.msgType !== 2) {
          throw new Error(`Expected SCCRP (2), got msgType=${sccrp?.msgType ?? '?'}`);
        }
        const peerTunnelId = sccrp.assignedTunnelId ?? sccrp.tunnelId;

        // ── 3. SCCCN ───────────────────────────────────────────────────────
        await writer.write(buildControl(peerTunnelId, 0, ns++, sccrp.ns + 1, [
          avp(0, u16(3)),  // MessageType = SCCCN (3)
        ]));

        // ── 4. ICRQ (Incoming-Call-Request) ────────────────────────────────
        await writer.write(buildControl(peerTunnelId, 0, ns++, sccrp.ns + 1, [
          avp(0,  u16(10)),             // MessageType = ICRQ (10)
          avp(14, u16(localSessionId)), // AssignedSessionID
          avp(15, u32(1)),              // CallSerialNumber
          avp(16, u32(0)),              // MinimumBPS
          avp(17, u32(0xFFFFFFFF)),     // MaximumBPS
          avp(18, u32(0x00000003)),     // BearerType: analog+digital
          avp(19, u32(0x00000003)),     // FramingType: sync+async
        ]));

        // ── 5. ICRP ────────────────────────────────────────────────────────
        const icrpData = await readMsg(reader, 8000);
        const icrp = parseControl(icrpData);
        if (!icrp || icrp.msgType !== 11) {
          throw new Error(`Expected ICRP (11), got msgType=${icrp?.msgType ?? '?'}`);
        }
        const peerSessionId = icrp.assignedSessionId ?? icrp.sessionId;

        // ── 6. ICCN ────────────────────────────────────────────────────────
        await writer.write(buildControl(peerTunnelId, peerSessionId, ns++, icrp.ns + 1, [
          avp(0,  u16(12)),         // MessageType = ICCN (12)
          avp(19, u32(0x00000001)), // FramingType: async
          avp(24, u32(115200)),     // TxConnectSpeedBPS
        ]));

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return {
          success: true,
          host,
          port,
          localTunnelId,
          peerTunnelId,
          localSessionId,
          peerSessionId,
          peerHostname: sccrp.hostName,
          protocolVersion: sccrp.protocolVersion,
          latencyMs: Date.now() - startTime,
          note: 'L2TP tunnel (SCCRQ→SCCRP→SCCCN) + session (ICRQ→ICRP→ICCN) established. PPP LCP negotiation would follow over the L2TP data channel.',
        };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        socket.close();
        throw err;
      }
    })();

    const result = await Promise.race([work, deadline]);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle L2TP Start-Control-Connection handshake (SCCRQ → SCCRP).
 * Sends a full SCCRQ with protocol/framing/bearer/tunnelId AVPs and parses the SCCRP.
 * Request body: { host, port=1701, timeout=10000 }
 */
export async function handleL2TPStartControl(request: Request): Promise<Response> {
  try {
    const body = await request.json() as { host: string; port?: number; timeout?: number };
    const { host, port = 1701, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout));

    const work = (async () => {
      const start = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        // Build SCCRQ with required AVPs
        const avps = [
          { type: AVPType.MessageType,          value: Buffer.from([0x00, L2TPMessageType.SCCRQ]) },
          { type: AVPType.ProtocolVersion,      value: Buffer.from([0x01, 0x00]) },
          { type: AVPType.HostName,             value: Buffer.from('cloudflare-worker', 'ascii') },
          { type: AVPType.FramingCapabilities,  value: Buffer.from([0x00, 0x00, 0x00, 0x03]) },
          { type: AVPType.BearerCapabilities,   value: Buffer.from([0x00, 0x00, 0x00, 0x03]) },
          { type: AVPType.AssignedTunnelID,     value: Buffer.from([0x00, 0x01]) },
        ];
        const sccrq = buildL2TPMessage(L2TPMessageType.SCCRQ, 0, 0, 0, 0, avps);
        await writer.write(sccrq);
        writer.releaseLock();

        // Read SCCRP — accumulate until we have a full message
        const chunks: Uint8Array[] = [];
        let totalLen = 0;
        let expectedLen = 0;
        const deadline = Date.now() + timeout;

        while (Date.now() < deadline) {
          const { value, done } = await reader.read();
          if (done || !value) break;
          chunks.push(value);
          totalLen += value.length;
          if (expectedLen === 0 && totalLen >= 4) {
            const combined = Buffer.concat(chunks.map(c => Buffer.from(c)));
            const flags = combined.readUInt16BE(0);
            if (flags & 0x4000) expectedLen = combined.readUInt16BE(2);
            else break;
          }
          if (expectedLen > 0 && totalLen >= expectedLen) break;
        }

        const latencyMs = Date.now() - start;
        reader.releaseLock();
        socket.close();

        if (totalLen === 0) throw new Error('No response from L2TP server');

        const combined = Buffer.concat(chunks.map(c => Buffer.from(c)));
        const parsed = parseL2TPMessage(combined);
        if (!parsed) throw new Error('Invalid L2TP response');

        let messageType = 0, assignedTunnelId = 0, hostName = '', protocolVersion = '';
        let resultCode: number | undefined;
        for (const avp of parsed.avps) {
          if (avp.type === AVPType.MessageType && avp.value.length >= 2)
            messageType = avp.value.readUInt16BE(0);
          else if (avp.type === AVPType.AssignedTunnelID && avp.value.length >= 2)
            assignedTunnelId = avp.value.readUInt16BE(0);
          else if (avp.type === AVPType.HostName)
            hostName = avp.value.toString('ascii');
          else if (avp.type === AVPType.ProtocolVersion && avp.value.length >= 2)
            protocolVersion = `${avp.value[0]}.${avp.value[1]}`;
          else if (avp.type === 1 && avp.value.length >= 2)
            resultCode = avp.value.readUInt16BE(0);
        }

        const result: Record<string, unknown> = {
          success: messageType === L2TPMessageType.SCCRP,
          messageType,
          tunnelId: assignedTunnelId,
          protocolVersion,
          hostName,
          latencyMs,
        };
        if (resultCode !== undefined) result.resultCode = resultCode;
        return result;
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        socket.close();
        throw err;
      }
    })();

    const result = await Promise.race([work, timeoutPromise]);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false, error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
