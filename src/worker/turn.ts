/**
 * TURN Protocol Implementation (RFC 8656 / RFC 5766)
 *
 * Traversal Using Relays around NAT (TURN) is a protocol that allows a client
 * behind a NAT to receive incoming data over TCP or UDP connections. TURN is
 * used by WebRTC and VoIP applications when direct peer-to-peer connections fail.
 *
 * Protocol Overview:
 * - Port: 3478 (TCP/UDP), 5349 (TLS)
 * - Message Format: STUN-compatible (20-byte header + TLV attributes)
 * - Allocate: Client requests relay address from TURN server
 * - Permissions: Client authorizes peers to send data through relay
 * - Channel Binding: Efficient data transfer using channel numbers
 *
 * Message Types:
 * - Allocate Request (0x0003): Request relay allocation
 * - Allocate Success Response (0x0103): Allocation granted
 * - Allocate Error Response (0x0113): Allocation failed
 * - Refresh Request (0x0004): Refresh allocation lifetime
 * - CreatePermission Request (0x0008): Authorize peer
 * - ChannelBind Request (0x0009): Bind channel number to peer
 *
 * Attributes (STUN + TURN specific):
 * - XOR-RELAYED-ADDRESS (0x0016): Allocated relay address
 * - LIFETIME (0x000D): Allocation lifetime in seconds
 * - REQUESTED-TRANSPORT (0x0019): Transport protocol (UDP=17)
 * - USERNAME (0x0006): Authentication username
 * - MESSAGE-INTEGRITY (0x0008): HMAC-SHA1 authentication
 * - NONCE (0x0015): Server nonce for authentication
 * - REALM (0x0014): Authentication realm
 *
 * Use Cases:
 * - WebRTC NAT traversal testing
 * - VoIP relay connectivity
 * - P2P connection fallback testing
 * - TURN server availability checking
 */

import { connect } from 'cloudflare:sockets';
// import { createHmac } from 'node:crypto'; // For future HMAC-based authentication

interface TURNRequest {
  host: string;
  port?: number;
  timeout?: number;
  username?: string;
  password?: string;
  requestedTransport?: number; // 17 for UDP, 6 for TCP
}

interface TURNResponse {
  success: boolean;
  host: string;
  port: number;
  relayAddress?: string;
  relayPort?: number;
  lifetime?: number;
  responseType?: string;
  realm?: string;
  nonce?: string;
  rtt?: number;
  error?: string;
  errorCode?: number;
}

// TURN Message Types (inherits STUN types)
enum TURNMessageType {
  AllocateRequest = 0x0003,
  AllocateResponse = 0x0103,
  AllocateErrorResponse = 0x0113,
  RefreshRequest = 0x0004,
  RefreshResponse = 0x0104,
  CreatePermissionRequest = 0x0008,
  ChannelBindRequest = 0x0009,
}

// TURN/STUN Attribute Types
enum TURNAttributeType {
  MappedAddress = 0x0001,
  Username = 0x0006,
  MessageIntegrity = 0x0008,
  ErrorCode = 0x0009,
  UnknownAttributes = 0x000A,
  Realm = 0x0014,
  Nonce = 0x0015,
  XorRelayedAddress = 0x0016,
  RequestedTransport = 0x0019,
  Lifetime = 0x000D,
  XorMappedAddress = 0x0020,
  Software = 0x8022,
  AlternateServer = 0x8023,
  Fingerprint = 0x8028,
}

/**
 * Build TURN/STUN message
 */
function buildTURNMessage(
  messageType: number,
  transactionId: Buffer,
  attributes: Array<{ type: number; value: Buffer }>
): Buffer {
  // STUN/TURN message format:
  // 0                   1                   2                   3
  // 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
  // +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
  // |0 0|     STUN Message Type     |         Message Length        |
  // +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
  // |                         Magic Cookie                          |
  // +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
  // |                                                               |
  // |                     Transaction ID (96 bits)                  |
  // |                                                               |
  // +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+

  const attributeBuffers: Buffer[] = [];
  let totalAttributeLength = 0;

  for (const attr of attributes) {
    // Attribute format: Type (2) + Length (2) + Value (variable) + Padding
    const length = attr.value.length;
    const padding = (4 - (length % 4)) % 4; // Pad to 4-byte boundary

    const attrBuffer = Buffer.allocUnsafe(4 + length + padding);
    attrBuffer.writeUInt16BE(attr.type, 0);
    attrBuffer.writeUInt16BE(length, 2);
    attr.value.copy(attrBuffer, 4);

    // Fill padding with zeros
    for (let i = 0; i < padding; i++) {
      attrBuffer[4 + length + i] = 0;
    }

    attributeBuffers.push(attrBuffer);
    totalAttributeLength += attrBuffer.length;
  }

  const header = Buffer.allocUnsafe(20);
  const magicCookie = 0x2112A442;

  header.writeUInt16BE(messageType, 0);
  header.writeUInt16BE(totalAttributeLength, 2);
  header.writeUInt32BE(magicCookie, 4);
  transactionId.copy(header, 8);

  return Buffer.concat([header, ...attributeBuffers]);
}

/**
 * Parse TURN/STUN message
 */
function parseTURNMessage(data: Buffer): {
  messageType: number;
  length: number;
  transactionId: Buffer;
  attributes: Array<{ type: number; value: Buffer }>;
} | null {
  if (data.length < 20) {
    return null;
  }

  const messageType = data.readUInt16BE(0);
  const length = data.readUInt16BE(2);
  const magicCookie = data.readUInt32BE(4);
  const transactionId = data.subarray(8, 20);

  if (magicCookie !== 0x2112A442) {
    return null; // Invalid STUN/TURN message
  }

  const attributes: Array<{ type: number; value: Buffer }> = [];
  let offset = 20;

  while (offset < data.length && offset < 20 + length) {
    if (offset + 4 > data.length) break;

    const attrType = data.readUInt16BE(offset);
    const attrLength = data.readUInt16BE(offset + 2);
    const padding = (4 - (attrLength % 4)) % 4;

    if (offset + 4 + attrLength > data.length) break;

    const attrValue = data.subarray(offset + 4, offset + 4 + attrLength);
    attributes.push({ type: attrType, value: Buffer.from(attrValue) });

    offset += 4 + attrLength + padding;
  }

  return { messageType, length, transactionId, attributes };
}

/**
 * XOR decode address (TURN uses XOR-RELAYED-ADDRESS / XOR-MAPPED-ADDRESS)
 */
function xorDecodeAddress(value: Buffer, transactionId: Buffer): { address: string; port: number } | null {
  if (value.length < 4) return null;

  const family = value.readUInt8(1);
  const xorPort = value.readUInt16BE(2);

  const magicCookie = 0x2112A442;
  const port = xorPort ^ (magicCookie >> 16);

  if (family === 0x01) {
    // IPv4
    if (value.length < 8) return null;

    const xorAddr = value.readUInt32BE(4);
    const addr = xorAddr ^ magicCookie;

    const octet1 = (addr >> 24) & 0xFF;
    const octet2 = (addr >> 16) & 0xFF;
    const octet3 = (addr >> 8) & 0xFF;
    const octet4 = addr & 0xFF;

    return { address: `${octet1}.${octet2}.${octet3}.${octet4}`, port };
  } else if (family === 0x02) {
    // IPv6
    if (value.length < 20) return null;

    const xorBytes = Buffer.allocUnsafe(16);
    const xorKey = Buffer.concat([Buffer.from([0x21, 0x12, 0xA4, 0x42]), transactionId]);

    for (let i = 0; i < 16; i++) {
      xorBytes[i] = value[4 + i] ^ xorKey[i];
    }

    const parts: string[] = [];
    for (let i = 0; i < 16; i += 2) {
      parts.push(xorBytes.readUInt16BE(i).toString(16));
    }

    return { address: parts.join(':'), port };
  }

  return null;
}

/**
 * Allocate a relay address from TURN server.
 * Sends Allocate Request and parses XOR-RELAYED-ADDRESS from response.
 */
export async function handleTURNAllocate(request: Request): Promise<Response> {
  try {
    const body = await request.json() as TURNRequest;
    const {
      host,
      port = 3478,
      timeout = 15000,
      username,
      password: _password,
      requestedTransport = 17, // UDP
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies TURNResponse), {
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
      } satisfies TURNResponse), {
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

      // Generate random 96-bit transaction ID
      const transactionId = Buffer.allocUnsafe(12);
      for (let i = 0; i < 12; i++) {
        transactionId[i] = Math.floor(Math.random() * 256);
      }

      // Build REQUESTED-TRANSPORT attribute (UDP = 17)
      const requestedTransportAttr = Buffer.allocUnsafe(4);
      requestedTransportAttr.writeUInt8(requestedTransport, 0);
      requestedTransportAttr.writeUInt8(0, 1); // RFFU (Reserved)
      requestedTransportAttr.writeUInt16BE(0, 2); // RFFU

      const attributes: Array<{ type: number; value: Buffer }> = [
        {
          type: TURNAttributeType.RequestedTransport,
          value: requestedTransportAttr,
        },
      ];

      // Add username if provided (for authentication)
      if (username) {
        attributes.push({
          type: TURNAttributeType.Username,
          value: Buffer.from(username, 'utf8'),
        });
      }

      // Build Allocate Request
      const allocateRequest = buildTURNMessage(
        TURNMessageType.AllocateRequest,
        transactionId,
        attributes
      );

      // Send Allocate Request
      const writer = socket.writable.getWriter();
      await writer.write(allocateRequest);
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
          error: 'No response from TURN server',
        } satisfies TURNResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const response = parseTURNMessage(Buffer.from(value));

      if (!response) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Invalid TURN response format',
        } satisfies TURNResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const rtt = Date.now() - start;

      // Parse attributes
      let relayAddress: string | undefined;
      let relayPort: number | undefined;
      let lifetime: number | undefined;
      let realm: string | undefined;
      let nonce: string | undefined;
      let errorCode: number | undefined;
      let errorReason: string | undefined;

      for (const attr of response.attributes) {
        if (attr.type === TURNAttributeType.XorRelayedAddress) {
          const decoded = xorDecodeAddress(attr.value, response.transactionId);
          if (decoded) {
            relayAddress = decoded.address;
            relayPort = decoded.port;
          }
        } else if (attr.type === TURNAttributeType.Lifetime && attr.value.length >= 4) {
          lifetime = attr.value.readUInt32BE(0);
        } else if (attr.type === TURNAttributeType.Realm) {
          realm = attr.value.toString('utf8');
        } else if (attr.type === TURNAttributeType.Nonce) {
          nonce = attr.value.toString('utf8');
        } else if (attr.type === TURNAttributeType.ErrorCode && attr.value.length >= 4) {
          const errorClass = attr.value.readUInt8(2);
          const errorNumber = attr.value.readUInt8(3);
          errorCode = errorClass * 100 + errorNumber;
          errorReason = attr.value.subarray(4).toString('utf8');
        } else if (attr.type === TURNAttributeType.XorMappedAddress) {
          // Client's reflexive address (useful for debugging)
          // const _decoded = xorDecodeAddress(attr.value, response.transactionId);
          // Could add to response if needed
        }
      }

      reader.releaseLock();
      socket.close();

      const responseTypeName =
        response.messageType === TURNMessageType.AllocateResponse
          ? 'Allocate Success'
          : response.messageType === TURNMessageType.AllocateErrorResponse
          ? 'Allocate Error'
          : `Unknown (0x${response.messageType.toString(16)})`;

      if (response.messageType === TURNMessageType.AllocateErrorResponse) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          responseType: responseTypeName,
          errorCode,
          error: errorReason || `TURN allocation failed with error ${errorCode}`,
          realm,
          nonce,
          rtt,
        } satisfies TURNResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (response.messageType === TURNMessageType.AllocateResponse) {
        return new Response(JSON.stringify({
          success: true,
          host,
          port,
          relayAddress,
          relayPort,
          lifetime,
          responseType: responseTypeName,
          rtt,
        } satisfies TURNResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        responseType: responseTypeName,
        error: 'Unexpected TURN response type',
        rtt,
      } satisfies TURNResponse), {
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
      port: 3478,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies TURNResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Probe TURN server with basic Allocate request (no authentication).
 * Useful for checking if a TURN server is running and responsive.
 */
export async function handleTURNProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as TURNRequest;
    const { host, port = 3478, timeout = 10000 } = body;

    // Call allocate without credentials - expect 401 Unauthorized with realm/nonce
    const allocateRequest = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({ host, port, timeout }),
    });

    return handleTURNAllocate(allocateRequest);

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
