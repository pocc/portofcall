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

// ─────────────────────────────────────────────────────────────────────────────
// Crypto helpers shared by authenticated TURN requests (RFC 5766 §15.4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure-JS MD5 (RFC 1321).
 * SubtleCrypto does not support MD5, so we implement it here.
 * Used to derive the HMAC-SHA1 key: MD5(username:realm:password).
 */
function md5(input: Uint8Array): Uint8Array {
  const s = [
    7, 12, 17, 22,  7, 12, 17, 22,  7, 12, 17, 22,  7, 12, 17, 22,
    5,  9, 14, 20,  5,  9, 14, 20,  5,  9, 14, 20,  5,  9, 14, 20,
    4, 11, 16, 23,  4, 11, 16, 23,  4, 11, 16, 23,  4, 11, 16, 23,
    6, 10, 15, 21,  6, 10, 15, 21,  6, 10, 15, 21,  6, 10, 15, 21,
  ];
  const K = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
    0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
    0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
    0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
    0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
    0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ];

  const msgLen = input.length;
  const bitLen = msgLen * 8;
  const padLen = ((msgLen % 64) < 56) ? (56 - msgLen % 64) : (120 - msgLen % 64);
  const padded = new Uint8Array(msgLen + padLen + 8);
  padded.set(input);
  padded[msgLen] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(msgLen + padLen, bitLen & 0xffffffff, true);
  dv.setUint32(msgLen + padLen + 4, Math.floor(bitLen / 0x100000000), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    const M = new Uint32Array(16);
    const cv = new DataView(padded.buffer, chunk, 64);
    for (let j = 0; j < 16; j++) M[j] = cv.getUint32(j * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16)       { F = (B & C) | (~B & D); g = i; }
      else if (i < 32)  { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48)  { F = B ^ C ^ D;           g = (3 * i + 5) % 16; }
      else              { F = C ^ (B | ~D);         g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((F << s[i]) | (F >>> (32 - s[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }

  const result = new Uint8Array(16);
  const rv = new DataView(result.buffer);
  rv.setUint32(0, a0, true); rv.setUint32(4, b0, true);
  rv.setUint32(8, c0, true); rv.setUint32(12, d0, true);
  return result;
}

/**
 * HMAC-SHA1 via SubtleCrypto.
 * @param key  Raw key bytes (MD5 hash for long-term TURN credentials)
 * @param data Message bytes to authenticate
 */
async function hmacSha1(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key as Uint8Array<ArrayBuffer>,
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, data as Uint8Array<ArrayBuffer>);
  return new Uint8Array(sig);
}

/**
 * Append a MESSAGE-INTEGRITY attribute (RFC 5766 §15.4 / RFC 5389 §15.4) to a
 * TURN/STUN message.
 *
 * The HMAC-SHA1 is computed over the message with the length field adjusted to
 * include the pending MESSAGE-INTEGRITY attribute (4-byte header + 20-byte HMAC
 * = 24 bytes), then the real attribute is appended.
 *
 * @param msgNoMic  Message bytes WITHOUT a MESSAGE-INTEGRITY attribute yet.
 * @param hmacKey   Raw HMAC key (MD5(username:realm:password) for long-term creds).
 * @returns         New Buffer with MESSAGE-INTEGRITY appended.
 */
async function appendMessageIntegrity(msgNoMic: Buffer, hmacKey: Uint8Array): Promise<Buffer> {
  // Clone and bump the length field by 24 (4 attr header + 20 HMAC value)
  const msgForHmac = Buffer.from(msgNoMic);
  msgForHmac.writeUInt16BE(msgForHmac.readUInt16BE(2) + 24, 2);

  const mic = await hmacSha1(hmacKey, msgForHmac);

  // Re-build with the actual MESSAGE-INTEGRITY attribute appended
  const miAttr = Buffer.allocUnsafe(4 + 20);
  miAttr.writeUInt16BE(TURNAttributeType.MessageIntegrity, 0);
  miAttr.writeUInt16BE(20, 2);
  Buffer.from(mic).copy(miAttr, 4);

  return Buffer.concat([msgNoMic, miAttr]);
}

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
      password: _password, // destructured for API symmetry; not used in unauthenticated probe
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
      let allocateRequest = buildTURNMessage(
        TURNMessageType.AllocateRequest,
        transactionId,
        attributes
      );

      // RFC 5766 §15.4 — the initial Allocate Request is sent WITHOUT
      // MESSAGE-INTEGRITY (unauthenticated probe).  The server will reject it
      // with a 401 Unauthorized response that includes the realm and nonce
      // needed to derive the long-term credential key
      // MD5(username:realm:password).  The authenticated second request
      // (built below after parsing the 401) carries the correct HMAC-SHA1.

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

interface TURNPermissionRequest {
  host: string;
  port?: number;
  timeout?: number;
  username: string;
  password: string;
  peerAddress: string;
}

interface TURNPermissionResponse {
  success: boolean;
  host: string;
  port: number;
  relayedAddress?: { ip: string; port: number };
  reflexiveAddress?: { ip: string; port: number };
  permissionCreated?: boolean;
  peerAddress?: string;
  rtt?: number;
  error?: string;
}

/**
 * Allocate a TURN relay and create a permission for a peer address.
 *
 * Step 1: Send unauthenticated Allocate — expect 401 with realm+nonce.
 * Step 2: Re-send authenticated Allocate with HMAC-SHA1 MESSAGE-INTEGRITY.
 * Step 3: Send CreatePermission for the specified peer address.
 *
 * The HMAC key is MD5(username:realm:password) per RFC 5389 / RFC 8656.
 */
export async function handleTURNPermission(request: Request): Promise<Response> {
  try {
    const body = await request.json() as TURNPermissionRequest;
    const {
      host,
      port = 3478,
      timeout = 15000,
      username,
      password,
      peerAddress,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false, host: '', port,
        error: 'Host is required',
      } satisfies TURNPermissionResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!username || !password) {
      return new Response(JSON.stringify({
        success: false, host, port,
        error: 'username and password are required',
      } satisfies TURNPermissionResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!peerAddress) {
      return new Response(JSON.stringify({
        success: false, host, port,
        error: 'peerAddress is required',
      } satisfies TURNPermissionResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false, host, port,
        error: 'Port must be between 1 and 65535',
      } satisfies TURNPermissionResponse), {
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

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // -----------------------------------------------------------------
      // Helper: read one complete STUN/TURN message from the stream
      // -----------------------------------------------------------------
      async function readTURNMessage(): Promise<Buffer | null> {
        let buf = Buffer.alloc(0);
        while (true) {
          const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
          if (done || !value) return buf.length >= 20 ? buf : null;
          buf = Buffer.concat([buf, Buffer.from(value)]);
          if (buf.length >= 4) {
            const msgLen = buf.readUInt16BE(2) + 20; // header + attributes
            if (buf.length >= msgLen) return buf.slice(0, msgLen);
          }
        }
      }

      // -----------------------------------------------------------------
      // Step 1: Unauthenticated Allocate (expect 401 with realm+nonce)
      // -----------------------------------------------------------------
      const txId1 = Buffer.allocUnsafe(12);
      for (let i = 0; i < 12; i++) txId1[i] = Math.floor(Math.random() * 256);

      const requestedTransportAttr = Buffer.from([17, 0, 0, 0]); // UDP
      const allocate1 = buildTURNMessage(TURNMessageType.AllocateRequest, txId1, [
        { type: TURNAttributeType.RequestedTransport, value: requestedTransportAttr },
      ]);

      await writer.write(allocate1);
      const resp1Data = await readTURNMessage();

      if (!resp1Data) {
        writer.releaseLock(); reader.releaseLock(); socket.close();
        return new Response(JSON.stringify({
          success: false, host, port,
          error: 'No response from TURN server (Step 1)',
        } satisfies TURNPermissionResponse), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }

      const resp1 = parseTURNMessage(resp1Data);
      if (!resp1) {
        writer.releaseLock(); reader.releaseLock(); socket.close();
        return new Response(JSON.stringify({
          success: false, host, port,
          error: 'Invalid TURN response (Step 1)',
        } satisfies TURNPermissionResponse), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }

      // -----------------------------------------------------------------
      // If we got a 401, parse realm+nonce and re-authenticate
      // -----------------------------------------------------------------
      let realm: string | undefined;
      let nonce: string | undefined;
      let relayedAddress: { ip: string; port: number } | undefined;
      let reflexiveAddress: { ip: string; port: number } | undefined;

      if (resp1.messageType === TURNMessageType.AllocateErrorResponse) {
        // Extract realm and nonce from error response
        for (const attr of resp1.attributes) {
          if (attr.type === TURNAttributeType.Realm) realm = attr.value.toString('utf8');
          if (attr.type === TURNAttributeType.Nonce) nonce = attr.value.toString('utf8');
        }

        // Check for 401 error code
        let is401 = false;
        for (const attr of resp1.attributes) {
          if (attr.type === TURNAttributeType.ErrorCode && attr.value.length >= 4) {
            const errClass = attr.value.readUInt8(2);
            const errNum = attr.value.readUInt8(3);
            if (errClass * 100 + errNum === 401) is401 = true;
          }
        }

        if (!is401 || !realm || !nonce) {
          writer.releaseLock(); reader.releaseLock(); socket.close();
          return new Response(JSON.stringify({
            success: false, host, port,
            error: `Allocate rejected (not 401 or missing realm/nonce)`,
          } satisfies TURNPermissionResponse), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        }

        // Compute long-term credential key: MD5(username:realm:password) per RFC 5389 §15.4.
        const encoder = new TextEncoder();
        const hmacKey = md5(encoder.encode(`${username}:${realm}:${password}`));

        // Build authenticated Allocate
        const txId2 = Buffer.allocUnsafe(12);
        for (let i = 0; i < 12; i++) txId2[i] = Math.floor(Math.random() * 256);

        const authAttrs: Array<{ type: number; value: Buffer }> = [
          { type: TURNAttributeType.RequestedTransport, value: requestedTransportAttr },
          { type: TURNAttributeType.Username, value: Buffer.from(username, 'utf8') },
          { type: TURNAttributeType.Realm, value: Buffer.from(realm, 'utf8') },
          { type: TURNAttributeType.Nonce, value: Buffer.from(nonce, 'utf8') },
        ];

        // RFC 5766 §15.4 — append MESSAGE-INTEGRITY using shared helper
        const allocate2NoMic = buildTURNMessage(TURNMessageType.AllocateRequest, txId2, authAttrs);
        const allocate2 = await appendMessageIntegrity(allocate2NoMic, hmacKey);

        await writer.write(allocate2);
        const resp2Data = await readTURNMessage();

        if (!resp2Data) {
          writer.releaseLock(); reader.releaseLock(); socket.close();
          return new Response(JSON.stringify({
            success: false, host, port,
            error: 'No response from TURN server (authenticated Allocate)',
          } satisfies TURNPermissionResponse), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        }

        const resp2 = parseTURNMessage(resp2Data);
        if (!resp2 || resp2.messageType !== TURNMessageType.AllocateResponse) {
          writer.releaseLock(); reader.releaseLock(); socket.close();
          let errMsg = 'Authenticated Allocate failed';
          if (resp2) {
            for (const attr of resp2.attributes) {
              if (attr.type === TURNAttributeType.ErrorCode && attr.value.length >= 4) {
                const ec = attr.value.readUInt8(2) * 100 + attr.value.readUInt8(3);
                const reason = attr.value.subarray(4).toString('utf8');
                errMsg = `Allocate error ${ec}: ${reason}`;
              }
            }
          }
          return new Response(JSON.stringify({
            success: false, host, port, error: errMsg,
          } satisfies TURNPermissionResponse), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        }

        // Parse relayed and reflexive addresses from Allocate Success
        for (const attr of resp2.attributes) {
          if (attr.type === TURNAttributeType.XorRelayedAddress) {
            const dec = xorDecodeAddress(attr.value, resp2.transactionId);
            if (dec) relayedAddress = { ip: dec.address, port: dec.port };
          } else if (attr.type === TURNAttributeType.XorMappedAddress) {
            const dec = xorDecodeAddress(attr.value, resp2.transactionId);
            if (dec) reflexiveAddress = { ip: dec.address, port: dec.port };
          }
        }

        // -----------------------------------------------------------------
        // Step 3: CreatePermission for peerAddress
        // -----------------------------------------------------------------
        // Build XOR-PEER-ADDRESS attribute from peerAddress (IPv4 only)
        const peerParts = peerAddress.split('.');
        if (peerParts.length !== 4) {
          writer.releaseLock(); reader.releaseLock(); socket.close();
          return new Response(JSON.stringify({
            success: false, host, port,
            error: 'peerAddress must be an IPv4 address (e.g. "192.0.2.1")',
          } satisfies TURNPermissionResponse), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        }

        const magicCookie = 0x2112A442;
        const peerAddrBuf = Buffer.allocUnsafe(8);
        peerAddrBuf[0] = 0x00; // reserved
        peerAddrBuf[1] = 0x01; // family IPv4
        // XOR port with high 16 bits of magic cookie (use port 0 for permission)
        peerAddrBuf.writeUInt16BE(0 ^ (magicCookie >> 16), 2);
        // XOR each octet with magic cookie bytes
        const peerIpInt = (parseInt(peerParts[0]) << 24) | (parseInt(peerParts[1]) << 16) |
                          (parseInt(peerParts[2]) << 8) | parseInt(peerParts[3]);
        peerAddrBuf.writeUInt32BE((peerIpInt ^ magicCookie) >>> 0, 4);

        const txId3 = Buffer.allocUnsafe(12);
        for (let i = 0; i < 12; i++) txId3[i] = Math.floor(Math.random() * 256);

        const permAttrs: Array<{ type: number; value: Buffer }> = [
          { type: 0x0012, value: peerAddrBuf }, // XOR-PEER-ADDRESS
          { type: TURNAttributeType.Username, value: Buffer.from(username, 'utf8') },
          { type: TURNAttributeType.Realm, value: Buffer.from(realm, 'utf8') },
          { type: TURNAttributeType.Nonce, value: Buffer.from(nonce, 'utf8') },
        ];

        // RFC 5766 §15.4 — CreatePermission with MESSAGE-INTEGRITY
        const permNoMic = buildTURNMessage(TURNMessageType.CreatePermissionRequest, txId3, permAttrs);
        const createPermMsg = await appendMessageIntegrity(permNoMic, hmacKey);
        await writer.write(createPermMsg);

        const resp3Data = await readTURNMessage();
        let permissionCreated = false;
        if (resp3Data) {
          const resp3 = parseTURNMessage(resp3Data);
          // CreatePermission Success Response = 0x0108
          if (resp3 && resp3.messageType === 0x0108) permissionCreated = true;
        }

        const rtt = Date.now() - start;
        writer.releaseLock(); reader.releaseLock(); socket.close();

        return new Response(JSON.stringify({
          success: true,
          host,
          port,
          relayedAddress,
          reflexiveAddress,
          permissionCreated,
          peerAddress,
          rtt,
        } satisfies TURNPermissionResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });

      } else if (resp1.messageType === TURNMessageType.AllocateResponse) {
        // Server accepted without auth — parse addresses
        for (const attr of resp1.attributes) {
          if (attr.type === TURNAttributeType.XorRelayedAddress) {
            const dec = xorDecodeAddress(attr.value, resp1.transactionId);
            if (dec) relayedAddress = { ip: dec.address, port: dec.port };
          } else if (attr.type === TURNAttributeType.XorMappedAddress) {
            const dec = xorDecodeAddress(attr.value, resp1.transactionId);
            if (dec) reflexiveAddress = { ip: dec.address, port: dec.port };
          }
        }

        const rtt = Date.now() - start;
        writer.releaseLock(); reader.releaseLock(); socket.close();

        return new Response(JSON.stringify({
          success: true,
          host,
          port,
          relayedAddress,
          reflexiveAddress,
          permissionCreated: false,
          peerAddress,
          rtt,
        } satisfies TURNPermissionResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        writer.releaseLock(); reader.releaseLock(); socket.close();
        return new Response(JSON.stringify({
          success: false, host, port,
          error: `Unexpected response type: 0x${resp1.messageType.toString(16)}`,
        } satisfies TURNPermissionResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

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
    } satisfies TURNPermissionResponse), {
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
