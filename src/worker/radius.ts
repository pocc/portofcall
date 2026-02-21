/**
 * RADIUS Protocol Implementation (RFC 2865 / RFC 6613)
 * Remote Authentication Dial-In User Service
 * Port: 1812 (Authentication), 1813 (Accounting)
 *
 * RADIUS is the dominant AAA protocol for network access:
 * - ISP subscriber authentication (PPPoE, DSL, Cable)
 * - Enterprise Wi-Fi (WPA2/WPA3-Enterprise via 802.1X)
 * - VPN authentication (IPsec, OpenVPN, WireGuard)
 * - Network device login (routers, switches, firewalls)
 *
 * This implementation uses RADIUS over TCP (RFC 6613) since
 * Cloudflare Workers Sockets API provides TCP connections.
 *
 * Packet format:
 *   Code (1) | Identifier (1) | Length (2) | Authenticator (16) | Attributes...
 *
 * Password encryption: XOR with MD5(secret + Request-Authenticator)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// RADIUS Codes
const RADIUS_ACCESS_REQUEST = 1;
const RADIUS_ACCESS_ACCEPT = 2;
const RADIUS_ACCESS_REJECT = 3;
const RADIUS_ACCOUNTING_REQUEST = 4;
const RADIUS_ACCOUNTING_RESPONSE = 5;
const RADIUS_ACCESS_CHALLENGE = 11;
const RADIUS_STATUS_SERVER = 12;
const RADIUS_STATUS_CLIENT = 13;

// RADIUS Attribute Types
const ATTR_USER_NAME = 1;
const ATTR_USER_PASSWORD = 2;
const ATTR_NAS_IP_ADDRESS = 4;
const ATTR_NAS_PORT = 5;
const ATTR_SERVICE_TYPE = 6;
const ATTR_REPLY_MESSAGE = 18;
const ATTR_STATE = 24;
const ATTR_VENDOR_SPECIFIC = 26;
const ATTR_CALLED_STATION_ID = 30;
const ATTR_CALLING_STATION_ID = 31;
const ATTR_NAS_IDENTIFIER = 32;
const ATTR_NAS_PORT_TYPE = 61;
const ATTR_MESSAGE_AUTHENTICATOR = 80;

// Service Types
const SERVICE_TYPE_LOGIN = 1;

// NAS Port Types
const NAS_PORT_TYPE_VIRTUAL = 5;

// Code names
const CODE_NAMES: Record<number, string> = {
  [RADIUS_ACCESS_REQUEST]: 'Access-Request',
  [RADIUS_ACCESS_ACCEPT]: 'Access-Accept',
  [RADIUS_ACCESS_REJECT]: 'Access-Reject',
  [RADIUS_ACCOUNTING_REQUEST]: 'Accounting-Request',
  [RADIUS_ACCOUNTING_RESPONSE]: 'Accounting-Response',
  [RADIUS_ACCESS_CHALLENGE]: 'Access-Challenge',
  [RADIUS_STATUS_SERVER]: 'Status-Server',
  [RADIUS_STATUS_CLIENT]: 'Status-Client',
};

// Attribute type names
const ATTR_NAMES: Record<number, string> = {
  [ATTR_USER_NAME]: 'User-Name',
  [ATTR_USER_PASSWORD]: 'User-Password',
  [ATTR_NAS_IP_ADDRESS]: 'NAS-IP-Address',
  [ATTR_NAS_PORT]: 'NAS-Port',
  [ATTR_SERVICE_TYPE]: 'Service-Type',
  [ATTR_REPLY_MESSAGE]: 'Reply-Message',
  [ATTR_STATE]: 'State',
  [ATTR_VENDOR_SPECIFIC]: 'Vendor-Specific',
  [ATTR_CALLED_STATION_ID]: 'Called-Station-Id',
  [ATTR_CALLING_STATION_ID]: 'Calling-Station-Id',
  [ATTR_NAS_IDENTIFIER]: 'NAS-Identifier',
  [ATTR_NAS_PORT_TYPE]: 'NAS-Port-Type',
  [ATTR_MESSAGE_AUTHENTICATOR]: 'Message-Authenticator',
};

/**
 * Minimal MD5 implementation for RADIUS authenticator and password encryption.
 */
function md5(input: Uint8Array): Uint8Array {
  function F(x: number, y: number, z: number) { return (x & y) | (~x & z); }
  function G(x: number, y: number, z: number) { return (x & z) | (y & ~z); }
  function H(x: number, y: number, z: number) { return x ^ y ^ z; }
  function I(x: number, y: number, z: number) { return y ^ (x | ~z); }
  function rotl(x: number, n: number) { return (x << n) | (x >>> (32 - n)); }
  function add32(a: number, b: number) { return (a + b) & 0xffffffff; }

  const msgLen = input.length;
  const bitLen = msgLen * 8;
  const padLen = ((56 - (msgLen + 1) % 64) + 64) % 64;
  const totalLen = msgLen + 1 + padLen + 8;
  const msg = new Uint8Array(totalLen);
  msg.set(input);
  msg[msgLen] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(totalLen - 8, bitLen & 0xffffffff, true);
  view.setUint32(totalLen - 4, Math.floor(bitLen / 0x100000000) & 0xffffffff, true);

  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  const T = [
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

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let blockStart = 0; blockStart < totalLen; blockStart += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) {
      M[j] = view.getUint32(blockStart + j * 4, true);
    }

    let A = a0, B = b0, C = c0, D = d0;

    for (let i = 0; i < 64; i++) {
      let f: number, g: number;

      if (i < 16) { f = F(B, C, D); g = i; }
      else if (i < 32) { f = G(B, C, D); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = H(B, C, D); g = (3 * i + 5) % 16; }
      else { f = I(B, C, D); g = (7 * i) % 16; }

      const temp = D;
      D = C;
      C = B;
      B = add32(B, rotl(add32(add32(A, f), add32(T[i], M[g])), s[i]));
      A = temp;
    }

    a0 = add32(a0, A);
    b0 = add32(b0, B);
    c0 = add32(c0, C);
    d0 = add32(d0, D);
  }

  const result = new Uint8Array(16);
  const rv = new DataView(result.buffer);
  rv.setUint32(0, a0, true);
  rv.setUint32(4, b0, true);
  rv.setUint32(8, c0, true);
  rv.setUint32(12, d0, true);

  return result;
}

/**
 * HMAC-MD5 for Message-Authenticator attribute
 */
function hmacMd5(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockSize = 64;

  // If key is longer than block size, hash it
  let k = key;
  if (k.length > blockSize) {
    k = md5(k);
  }

  // Pad key to block size
  const paddedKey = new Uint8Array(blockSize);
  paddedKey.set(k);

  // Create inner and outer pads
  const ipad = new Uint8Array(blockSize);
  const opad = new Uint8Array(blockSize);

  for (let i = 0; i < blockSize; i++) {
    ipad[i] = paddedKey[i] ^ 0x36;
    opad[i] = paddedKey[i] ^ 0x5c;
  }

  // Inner hash: MD5(ipad + message)
  const innerInput = new Uint8Array(blockSize + message.length);
  innerInput.set(ipad);
  innerInput.set(message, blockSize);
  const innerHash = md5(innerInput);

  // Outer hash: MD5(opad + innerHash)
  const outerInput = new Uint8Array(blockSize + 16);
  outerInput.set(opad);
  outerInput.set(innerHash, blockSize);

  return md5(outerInput);
}

/**
 * Generate 16 random bytes for the Request Authenticator
 */
function randomAuthenticator(): Uint8Array {
  const auth = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    auth[i] = Math.floor(Math.random() * 256);
  }
  return auth;
}

/**
 * Encrypt a RADIUS User-Password attribute.
 * RFC 2865 Section 5.2:
 *   b1 = MD5(secret + Request-Authenticator)
 *   c(1) = p1 XOR b1
 *   b2 = MD5(secret + c(1))
 *   c(2) = p2 XOR b2
 *   ...
 */
function encryptPassword(
  password: string,
  secret: string,
  authenticator: Uint8Array
): Uint8Array {
  const secretBytes = new TextEncoder().encode(secret);
  const passBytes = new TextEncoder().encode(password);

  // Pad password to multiple of 16 bytes
  const paddedLen = Math.max(16, Math.ceil(passBytes.length / 16) * 16);
  const padded = new Uint8Array(paddedLen);
  padded.set(passBytes);

  const result = new Uint8Array(paddedLen);
  let prevCipher = authenticator;

  for (let i = 0; i < paddedLen; i += 16) {
    // b(n) = MD5(secret + prev_cipher_block)
    const hashInput = new Uint8Array(secretBytes.length + 16);
    hashInput.set(secretBytes);
    hashInput.set(prevCipher, secretBytes.length);
    const b = md5(hashInput);

    // c(n) = p(n) XOR b(n)
    for (let j = 0; j < 16; j++) {
      result[i + j] = padded[i + j] ^ b[j];
    }

    prevCipher = result.slice(i, i + 16);
  }

  return result;
}

/**
 * Build a RADIUS attribute (TLV)
 */
function buildAttribute(type: number, value: Uint8Array): Uint8Array {
  const attr = new Uint8Array(2 + value.length);
  attr[0] = type;
  attr[1] = 2 + value.length;
  attr.set(value, 2);
  return attr;
}

/**
 * Build a string attribute
 */
function buildStringAttribute(type: number, value: string): Uint8Array {
  return buildAttribute(type, new TextEncoder().encode(value));
}

/**
 * Build a 32-bit integer attribute
 */
function buildIntAttribute(type: number, value: number): Uint8Array {
  const data = new Uint8Array(4);
  const view = new DataView(data.buffer);
  view.setUint32(0, value, false);
  return buildAttribute(type, data);
}

/**
 * Build a RADIUS packet
 */
function buildPacket(
  code: number,
  identifier: number,
  authenticator: Uint8Array,
  attributes: Uint8Array[]
): Uint8Array {
  let attrLen = 0;
  for (const attr of attributes) {
    attrLen += attr.length;
  }

  const length = 20 + attrLen;
  const packet = new Uint8Array(length);
  const view = new DataView(packet.buffer);

  packet[0] = code;
  packet[1] = identifier;
  view.setUint16(2, length, false);
  packet.set(authenticator, 4);

  let offset = 20;
  for (const attr of attributes) {
    packet.set(attr, offset);
    offset += attr.length;
  }

  return packet;
}

/**
 * Parse RADIUS response packet
 */
function parsePacket(data: Uint8Array): {
  code: number;
  codeName: string;
  identifier: number;
  length: number;
  authenticator: Uint8Array;
  attributes: Array<{
    type: number;
    typeName: string;
    length: number;
    value: Uint8Array;
    stringValue?: string;
    intValue?: number;
  }>;
} {
  if (data.length < 20) {
    throw new Error('Packet too short (minimum 20 bytes)');
  }

  const view = new DataView(data.buffer, data.byteOffset);
  const code = data[0];
  const identifier = data[1];
  const length = view.getUint16(2, false);
  const authenticator = data.slice(4, 20);

  if (data.length < length) {
    throw new Error(`Packet truncated: expected ${length} bytes, got ${data.length}`);
  }

  const attributes: Array<{
    type: number;
    typeName: string;
    length: number;
    value: Uint8Array;
    stringValue?: string;
    intValue?: number;
  }> = [];

  let offset = 20;
  while (offset < length) {
    if (offset + 2 > length) break;

    const attrType = data[offset];
    const attrLen = data[offset + 1];

    if (attrLen < 2 || offset + attrLen > length) break;

    const value = data.slice(offset + 2, offset + attrLen);

    const attr: {
      type: number;
      typeName: string;
      length: number;
      value: Uint8Array;
      stringValue?: string;
      intValue?: number;
    } = {
      type: attrType,
      typeName: ATTR_NAMES[attrType] || `Unknown(${attrType})`,
      length: attrLen,
      value,
    };

    // Try to decode as string for text-based attributes
    if ([ATTR_USER_NAME, ATTR_REPLY_MESSAGE, ATTR_CALLED_STATION_ID,
         ATTR_CALLING_STATION_ID, ATTR_NAS_IDENTIFIER].includes(attrType)) {
      try {
        attr.stringValue = new TextDecoder().decode(value);
      } catch { /* binary data */ }
    }

    // Decode 4-byte integer attributes
    if (value.length === 4 && [ATTR_NAS_PORT, ATTR_SERVICE_TYPE, ATTR_NAS_PORT_TYPE].includes(attrType)) {
      const iv = new DataView(value.buffer, value.byteOffset);
      attr.intValue = iv.getUint32(0, false);
    }

    // NAS-IP-Address is a 4-byte IP
    if (attrType === ATTR_NAS_IP_ADDRESS && value.length === 4) {
      attr.stringValue = `${value[0]}.${value[1]}.${value[2]}.${value[3]}`;
    }

    attributes.push(attr);
    offset += attrLen;
  }

  return {
    code,
    codeName: CODE_NAMES[code] || `Unknown(${code})`,
    identifier,
    length,
    authenticator,
    attributes,
  };
}

/**
 * Read exactly N bytes from a socket reader
 */
async function readExactBytes(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  n: number,
  existingBuffer?: Uint8Array
): Promise<{ data: Uint8Array; leftover: Uint8Array }> {
  const chunks: Uint8Array[] = [];
  let totalRead = 0;

  if (existingBuffer && existingBuffer.length > 0) {
    if (existingBuffer.length >= n) {
      return {
        data: existingBuffer.slice(0, n),
        leftover: existingBuffer.slice(n),
      };
    }
    chunks.push(existingBuffer);
    totalRead = existingBuffer.length;
  }

  while (totalRead < n) {
    const { value, done } = await reader.read();
    if (done || !value) throw new Error('Connection closed while reading');
    chunks.push(value);
    totalRead += value.length;
  }

  const combined = new Uint8Array(totalRead);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return {
    data: combined.slice(0, n),
    leftover: combined.slice(n),
  };
}

/**
 * Handle RADIUS Status-Server probe - detect if a RADIUS server is running
 */
export async function handleRadiusProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { host, port = 1812, secret = 'testing123', timeout = 10000 } = (await request.json()) as {
      host: string;
      port?: number;
      secret?: string;
      timeout?: number;
    };

    if (!host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if host is behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const probePromise = (async () => {
      const startTime = Date.now();

      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const connectTime = Date.now() - startTime;

      try {
        const writer = socket.writable.getWriter();
        const reader = socket.readable.getReader();

        const identifier = Math.floor(Math.random() * 256);
        const authenticator = randomAuthenticator();
        const secretBytes = new TextEncoder().encode(secret);

        // Build Status-Server packet with Message-Authenticator
        const attributes: Uint8Array[] = [
          buildStringAttribute(ATTR_NAS_IDENTIFIER, 'portofcall-probe'),
        ];

        // Add a placeholder Message-Authenticator (16 zero bytes)
        // We'll compute the real HMAC after building the packet
        const msgAuthPlaceholder = buildAttribute(ATTR_MESSAGE_AUTHENTICATOR, new Uint8Array(16));
        attributes.push(msgAuthPlaceholder);

        // Build the packet with placeholder
        const packet = buildPacket(RADIUS_STATUS_SERVER, identifier, authenticator, attributes);

        // Now compute the real Message-Authenticator HMAC-MD5 over the entire packet
        // with the Message-Authenticator field set to all zeros
        const hmac = hmacMd5(secretBytes, packet);

        // Find the Message-Authenticator value offset and replace
        // It's the last 16 bytes before the end (since it was the last attribute)
        const msgAuthOffset = packet.length - 16;
        packet.set(hmac, msgAuthOffset);

        await writer.write(packet);

        // Read response header (first 4 bytes to get length)
        const { data: headerData, leftover: headerLeftover } = await readExactBytes(reader, 20);
        const respView = new DataView(headerData.buffer, headerData.byteOffset);
        const respLength = respView.getUint16(2, false);

        // Read remaining data if any
        let fullPacket: Uint8Array;
        if (respLength > 20) {
          const { data: bodyData } = await readExactBytes(reader, respLength - 20, headerLeftover);
          fullPacket = new Uint8Array(respLength);
          fullPacket.set(headerData);
          fullPacket.set(bodyData, 20);
        } else {
          fullPacket = headerData;
        }

        const response = parsePacket(fullPacket);

        // Validate response authenticator per RFC 2865 §3:
        // MD5(Code + ID + Length + RequestAuth + ResponseAttributes + Secret)
        {
          const verifyPacket = new Uint8Array(fullPacket);
          verifyPacket.set(authenticator, 4); // replace response auth with request auth
          const hashInput = new Uint8Array(verifyPacket.length + secretBytes.length);
          hashInput.set(verifyPacket);
          hashInput.set(secretBytes, verifyPacket.length);
          const expectedAuth = md5(hashInput);
          const actualAuth = fullPacket.slice(4, 20);
          const authValid = expectedAuth.every((b, i) => b === actualAuth[i]);
          if (!authValid) {
            throw new Error('RADIUS response authenticator validation failed');
          }
        }

        const totalTime = Date.now() - startTime;

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        // Extract reply messages
        const replyMessages = response.attributes
          .filter(a => a.type === ATTR_REPLY_MESSAGE && a.stringValue)
          .map(a => a.stringValue!);

        return {
          success: true,
          host,
          port,
          responseCode: response.code,
          responseCodeName: response.codeName,
          identifier: response.identifier,
          authenticator: Array.from(response.authenticator)
            .map(b => b.toString(16).padStart(2, '0'))
            .join(''),
          attributes: response.attributes.map(a => ({
            type: a.type,
            typeName: a.typeName,
            length: a.length,
            stringValue: a.stringValue || null,
            intValue: a.intValue ?? null,
            hex: Array.from(a.value).map(b => b.toString(16).padStart(2, '0')).join(' '),
          })),
          replyMessages,
          connectTimeMs: connectTime,
          totalTimeMs: totalTime,
        };
      } catch (error) {
        try { await socket.close(); } catch { /* ignore */ }
        throw error;
      }
    })();

    const result = await Promise.race([probePromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Probe failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle RADIUS Access-Request authentication test
 */
export async function handleRadiusAuth(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const {
      host,
      port = 1812,
      secret = 'testing123',
      username,
      password,
      nasIdentifier = 'portofcall',
      timeout = 15000,
    } = (await request.json()) as {
      host: string;
      port?: number;
      secret?: string;
      username: string;
      password: string;
      nasIdentifier?: string;
      timeout?: number;
    };

    if (!host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!username) {
      return new Response(
        JSON.stringify({ success: false, error: 'Username is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const authPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const connectTime = Date.now() - startTime;

      try {
        const writer = socket.writable.getWriter();
        const reader = socket.readable.getReader();

        const identifier = Math.floor(Math.random() * 256);
        const authenticator = randomAuthenticator();
        const secretBytes = new TextEncoder().encode(secret);

        // Encrypt the password per RFC 2865 Section 5.2
        const encryptedPassword = encryptPassword(password || '', secret, authenticator);

        // Build Access-Request attributes
        const attributes: Uint8Array[] = [
          buildStringAttribute(ATTR_USER_NAME, username),
          buildAttribute(ATTR_USER_PASSWORD, encryptedPassword),
          buildStringAttribute(ATTR_NAS_IDENTIFIER, nasIdentifier),
          buildIntAttribute(ATTR_NAS_PORT_TYPE, NAS_PORT_TYPE_VIRTUAL),
          buildIntAttribute(ATTR_SERVICE_TYPE, SERVICE_TYPE_LOGIN),
        ];

        // Add Message-Authenticator placeholder
        const msgAuthPlaceholder = buildAttribute(ATTR_MESSAGE_AUTHENTICATOR, new Uint8Array(16));
        attributes.push(msgAuthPlaceholder);

        // Build packet
        const packet = buildPacket(RADIUS_ACCESS_REQUEST, identifier, authenticator, attributes);

        // Compute and set Message-Authenticator
        const hmac = hmacMd5(secretBytes, packet);
        const msgAuthOffset = packet.length - 16;
        packet.set(hmac, msgAuthOffset);

        await writer.write(packet);

        // Read response
        const { data: headerData, leftover: headerLeftover } = await readExactBytes(reader, 20);
        const respView = new DataView(headerData.buffer, headerData.byteOffset);
        const respLength = respView.getUint16(2, false);

        let fullPacket: Uint8Array;
        if (respLength > 20) {
          const { data: bodyData } = await readExactBytes(reader, respLength - 20, headerLeftover);
          fullPacket = new Uint8Array(respLength);
          fullPacket.set(headerData);
          fullPacket.set(bodyData, 20);
        } else {
          fullPacket = headerData;
        }

        const response = parsePacket(fullPacket);

        // Validate response authenticator per RFC 2865 §3:
        // MD5(Code + ID + Length + RequestAuth + ResponseAttributes + Secret)
        {
          const verifyPacket = new Uint8Array(fullPacket);
          verifyPacket.set(authenticator, 4); // replace response auth with request auth
          const hashInput = new Uint8Array(verifyPacket.length + secretBytes.length);
          hashInput.set(verifyPacket);
          hashInput.set(secretBytes, verifyPacket.length);
          const expectedAuth = md5(hashInput);
          const actualAuth = fullPacket.slice(4, 20);
          const authValid = expectedAuth.every((b, i) => b === actualAuth[i]);
          if (!authValid) {
            throw new Error('RADIUS response authenticator validation failed');
          }
        }

        const totalTime = Date.now() - startTime;

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        // Extract reply messages and state
        const replyMessages = response.attributes
          .filter(a => a.type === ATTR_REPLY_MESSAGE && a.stringValue)
          .map(a => a.stringValue!);

        const hasState = response.attributes.some(a => a.type === ATTR_STATE);

        return {
          success: true,
          authenticated: response.code === RADIUS_ACCESS_ACCEPT,
          host,
          port,
          username,
          responseCode: response.code,
          responseCodeName: response.codeName,
          replyMessages,
          hasChallenge: response.code === RADIUS_ACCESS_CHALLENGE,
          hasState,
          attributes: response.attributes.map(a => ({
            type: a.type,
            typeName: a.typeName,
            length: a.length,
            stringValue: a.stringValue || null,
            intValue: a.intValue ?? null,
          })),
          connectTimeMs: connectTime,
          totalTimeMs: totalTime,
        };
      } catch (error) {
        try { await socket.close(); } catch { /* ignore */ }
        throw error;
      }
    })();

    const result = await Promise.race([authPromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Authentication failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ─── RADIUS Accounting ────────────────────────────────────────────────────────

const ATTR_ACCT_STATUS_TYPE     = 40;  // Acct-Status-Type
const ATTR_ACCT_INPUT_OCTETS    = 42;  // Acct-Input-Octets
const ATTR_ACCT_OUTPUT_OCTETS   = 43;  // Acct-Output-Octets
const ATTR_ACCT_SESSION_ID      = 44;  // Acct-Session-Id
const ATTR_ACCT_SESSION_TIME    = 46;  // Acct-Session-Time
const ATTR_ACCT_TERMINATE_CAUSE = 49;  // Acct-Terminate-Cause

/**
 * POST /api/radius/accounting
 *
 * Send a RADIUS Accounting-Request packet (RFC 2866) to an accounting server.
 *
 * Supports Start, Stop, and Interim-Update Acct-Status-Type values with
 * configurable session statistics.  The Accounting Authenticator is computed per
 * RFC 2866 §3:
 *   MD5(Code + ID + Length + 16*0x00 + RequestAttributes + SharedSecret)
 *
 * Request body:
 *   { host, port=1813, secret, username='test', sessionId?,
 *     statusType='Start' | 'Stop' | 'Interim-Update',
 *     nasIdentifier='portofcall', sessionTime?, inputOctets?, outputOctets?,
 *     terminateCause?, timeout=10000 }
 *
 * Response:
 *   { success, responseCode, responseCodeName, sessionId, statusType,
 *     attributes, connectTimeMs, totalTimeMs }
 */
export async function handleRadiusAccounting(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const body = await request.json() as {
      host: string; port?: number; secret: string; timeout?: number;
      username?: string; sessionId?: string; nasIdentifier?: string;
      statusType?: string; sessionTime?: number;
      inputOctets?: number; outputOctets?: number; terminateCause?: number;
    };

    const { host, port = 1813, secret, timeout = 10000 } = body;
    const username      = body.username      ?? 'test';
    const nasIdentifier = body.nasIdentifier ?? 'portofcall';
    const statusTypeName = body.statusType   ?? 'Start';
    const sessionId = body.sessionId
      ?? `sess-${Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0')}`;
    const statusTypeCode = statusTypeName === 'Stop'           ? 2
                         : statusTypeName === 'Interim-Update' ? 3
                         : 1; // Start

    if (!host) return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
    if (!secret) return new Response(JSON.stringify({ success: false, error: 'Secret is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, isCloudflare: true,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const startTime = Date.now();

    const work = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const connectTime = Date.now() - startTime;

      try {
        const writer    = socket.writable.getWriter();
        const reader    = socket.readable.getReader();
        const identifier  = Math.floor(Math.random() * 256);
        const secretBytes = new TextEncoder().encode(secret);

        const attributes: Uint8Array[] = [
          buildStringAttribute(ATTR_USER_NAME,       username),
          buildStringAttribute(ATTR_NAS_IDENTIFIER,  nasIdentifier),
          buildIntAttribute(ATTR_ACCT_STATUS_TYPE,   statusTypeCode),
          buildStringAttribute(ATTR_ACCT_SESSION_ID, sessionId),
          buildIntAttribute(ATTR_NAS_PORT_TYPE,      NAS_PORT_TYPE_VIRTUAL),
          buildIntAttribute(ATTR_SERVICE_TYPE,       SERVICE_TYPE_LOGIN),
        ];

        if (body.sessionTime  !== undefined) attributes.push(buildIntAttribute(ATTR_ACCT_SESSION_TIME,    body.sessionTime));
        if (body.inputOctets  !== undefined) attributes.push(buildIntAttribute(ATTR_ACCT_INPUT_OCTETS,    body.inputOctets));
        if (body.outputOctets !== undefined) attributes.push(buildIntAttribute(ATTR_ACCT_OUTPUT_OCTETS,   body.outputOctets));
        if (statusTypeCode === 2 && body.terminateCause !== undefined) {
          attributes.push(buildIntAttribute(ATTR_ACCT_TERMINATE_CAUSE, body.terminateCause));
        }

        // Build packet with zero authenticator (RFC 2866 §3)
        const packet = buildPacket(RADIUS_ACCOUNTING_REQUEST, identifier, new Uint8Array(16), attributes);

        // RequestAuthenticator = MD5(packet-with-zeros + secret)
        const md5Input = new Uint8Array(packet.length + secretBytes.length);
        md5Input.set(packet);
        md5Input.set(secretBytes, packet.length);
        packet.set(md5(md5Input), 4); // overwrite bytes 4–19

        await writer.write(packet);

        const { data: hdr, leftover } = await readExactBytes(reader, 20);
        const respLen = new DataView(hdr.buffer, hdr.byteOffset).getUint16(2, false);

        let full: Uint8Array;
        if (respLen > 20) {
          const { data: tail } = await readExactBytes(reader, respLen - 20, leftover);
          full = new Uint8Array(respLen);
          full.set(hdr); full.set(tail, 20);
        } else {
          full = hdr;
        }

        const resp = parsePacket(full);
        const totalTime = Date.now() - startTime;

        writer.releaseLock(); reader.releaseLock(); await socket.close();

        return {
          success: resp.code === RADIUS_ACCOUNTING_RESPONSE,
          host, port, username, sessionId, statusType: statusTypeName,
          responseCode:     resp.code,
          responseCodeName: resp.codeName,
          attributes: resp.attributes.map(a => ({
            type: a.type, typeName: a.typeName, length: a.length,
            stringValue: a.stringValue ?? null, intValue: a.intValue ?? null,
          })),
          connectTimeMs: connectTime,
          totalTimeMs:   totalTime,
        };
      } catch (err) {
        try { await socket.close(); } catch { /* ignore */ }
        throw err;
      }
    })();

    const result = await Promise.race([
      work,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Connection timeout')), timeout)),
    ]);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Accounting failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
