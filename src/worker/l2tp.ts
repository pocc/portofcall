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
