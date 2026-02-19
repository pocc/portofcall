/**
 * RADSEC Protocol Implementation (RFC 6614)
 *
 * RADSEC (RADIUS over TLS) provides secure transport for RADIUS protocol.
 * It uses TLS to protect RADIUS packets, eliminating the need for shared
 * secrets and providing strong encryption for AAA (Authentication,
 * Authorization, and Accounting) traffic.
 *
 * Protocol Flow:
 * 1. Client establishes TLS connection to RADSEC server on port 2083
 * 2. Client sends RADIUS Access-Request packet
 * 3. Server responds with Access-Accept, Access-Reject, or Access-Challenge
 * 4. TLS ensures confidentiality and integrity
 *
 * RFC 6614 specifies RADSEC
 * RFC 2865 specifies RADIUS protocol
 *
 * RADIUS Packet Format:
 * - Code (1 byte): Packet type (1=Access-Request, 2=Access-Accept, 3=Access-Reject)
 * - Identifier (1 byte): Matches requests with responses
 * - Length (2 bytes): Packet length in bytes
 * - Authenticator (16 bytes): Request/Response authenticator
 * - Attributes (variable): TLV-encoded attributes
 *
 * Common Attributes:
 * - Type 1: User-Name
 * - Type 2: User-Password
 * - Type 4: NAS-IP-Address
 * - Type 31: Calling-Station-Id
 * - Type 32: NAS-Identifier
 *
 * Use Cases:
 * - Secure wireless (WPA2-Enterprise, eduroam)
 * - VPN authentication
 * - Network access control (802.1X)
 * - Enterprise authentication proxying
 */

import { connect } from 'cloudflare:sockets';

interface RadsecRequest {
  host: string;
  port?: number;
  username: string;
  password: string;
  nasIdentifier?: string;
  nasIpAddress?: string;
  timeout?: number;
}

interface RadsecResponse {
  success: boolean;
  host: string;
  port: number;
  code?: number;
  codeText?: string;
  identifier?: number;
  attributes?: Record<string, string>;
  rtt?: number;
  error?: string;
}

// RADIUS Packet Codes
const RADIUS_CODE = {
  ACCESS_REQUEST: 1,
  ACCESS_ACCEPT: 2,
  ACCESS_REJECT: 3,
  ACCOUNTING_REQUEST: 4,
  ACCOUNTING_RESPONSE: 5,
  ACCESS_CHALLENGE: 11,
} as const;

// RADIUS Attribute Types
const RADIUS_ATTR = {
  USER_NAME: 1,
  USER_PASSWORD: 2,
  CHAP_PASSWORD: 3,
  NAS_IP_ADDRESS: 4,
  NAS_PORT: 5,
  SERVICE_TYPE: 6,
  FRAMED_PROTOCOL: 7,
  FRAMED_IP_ADDRESS: 8,
  CALLING_STATION_ID: 31,
  NAS_IDENTIFIER: 32,
  ACCT_STATUS_TYPE: 40,
  MESSAGE_AUTHENTICATOR: 80,
} as const;

/**
 * Get human-readable code text.
 */
function getCodeText(code: number): string {
  const codeMap: Record<number, string> = {
    1: 'Access-Request',
    2: 'Access-Accept',
    3: 'Access-Reject',
    4: 'Accounting-Request',
    5: 'Accounting-Response',
    11: 'Access-Challenge',
  };
  return codeMap[code] || `Unknown (${code})`;
}

/**
 * Generate a random RADIUS identifier.
 */
function generateIdentifier(): number {
  const randomValues = new Uint8Array(1);
  crypto.getRandomValues(randomValues);
  return randomValues[0];
}

/**
 * Generate a random Request Authenticator (16 bytes).
 * Uses cryptographically secure random number generation.
 */
function generateAuthenticator(): Uint8Array {
  const authenticator = new Uint8Array(16);
  crypto.getRandomValues(authenticator);
  return authenticator;
}

/**
 * Encode RADIUS attribute.
 */
function encodeAttribute(type: number, value: string | Uint8Array): Uint8Array {
  const valueBytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const length = 2 + valueBytes.length; // Type (1) + Length (1) + Value

  const attr = new Uint8Array(length);
  attr[0] = type;
  attr[1] = length;
  attr.set(valueBytes, 2);

  return attr;
}

/**
 * Encode User-Password attribute per RFC 2865 §5.2 with RFC 6614 shared secret.
 * RFC 6614 §2.3: The shared secret MUST be "radsec" for RADIUS/TLS.
 * Password is padded to 16-byte boundary and XORed with MD5(secret + authenticator).
 */
async function encodePasswordAttribute(password: string, authenticator: Uint8Array): Promise<Uint8Array> {
  const RADSEC_SECRET = 'radsec'; // RFC 6614 mandated shared secret
  const passwordBytes = new TextEncoder().encode(password);

  // Pad password to multiple of 16 bytes (RFC 2865 §5.2)
  const paddedLength = Math.ceil(passwordBytes.length / 16) * 16;
  const paddedPassword = new Uint8Array(paddedLength);
  paddedPassword.set(passwordBytes);
  // Remaining bytes are zero-filled by default

  const secretBytes = new TextEncoder().encode(RADSEC_SECRET);
  const encrypted = new Uint8Array(paddedLength);

  // Encrypt password chunks: c(i) = p(i) XOR MD5(secret + b(i-1))
  // where b(0) = Request Authenticator, b(i) = c(i)
  let prevBlock = authenticator;

  for (let i = 0; i < paddedLength; i += 16) {
    // Compute MD5(secret + prevBlock)
    const hashInput = new Uint8Array(secretBytes.length + 16);
    hashInput.set(secretBytes);
    hashInput.set(prevBlock, secretBytes.length);

    const hashBuffer = await crypto.subtle.digest('MD5', hashInput.buffer as ArrayBuffer);
    const hash = new Uint8Array(hashBuffer);

    // XOR password chunk with hash
    for (let j = 0; j < 16; j++) {
      encrypted[i + j] = paddedPassword[i + j] ^ hash[j];
    }

    // Next iteration uses this encrypted block
    prevBlock = encrypted.slice(i, i + 16);
  }

  return encodeAttribute(RADIUS_ATTR.USER_PASSWORD, encrypted);
}

/**
 * Encode NAS-IP-Address attribute (4 bytes).
 */
function encodeNasIpAddress(ipAddress: string): Uint8Array {
  const parts = ipAddress.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    throw new Error('Invalid IP address format');
  }
  return encodeAttribute(RADIUS_ATTR.NAS_IP_ADDRESS, new Uint8Array(parts));
}

/**
 * Compute Message-Authenticator (RFC 3579 §3.2) using HMAC-MD5.
 * Message-Authenticator protects against insertion, deletion, and modification attacks.
 */
async function computeMessageAuthenticator(packet: Uint8Array, secret: string): Promise<Uint8Array> {
  const secretBytes = new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'MD5' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, packet.buffer as ArrayBuffer);
  return new Uint8Array(signature);
}

/**
 * Encode RADIUS Access-Request packet.
 */
async function encodeAccessRequest(params: {
  identifier: number;
  authenticator: Uint8Array;
  username: string;
  password: string;
  nasIdentifier?: string;
  nasIpAddress?: string;
}): Promise<Uint8Array> {
  const { identifier, authenticator, username, password, nasIdentifier, nasIpAddress } = params;

  // Build attributes
  const attributes: Uint8Array[] = [];

  // User-Name attribute
  attributes.push(encodeAttribute(RADIUS_ATTR.USER_NAME, username));

  // User-Password attribute (encrypted with shared secret "radsec")
  attributes.push(await encodePasswordAttribute(password, authenticator));

  // NAS-Identifier attribute (optional)
  if (nasIdentifier) {
    attributes.push(encodeAttribute(RADIUS_ATTR.NAS_IDENTIFIER, nasIdentifier));
  }

  // NAS-IP-Address attribute (optional)
  if (nasIpAddress) {
    attributes.push(encodeNasIpAddress(nasIpAddress));
  }

  // Message-Authenticator placeholder (will be computed after packet construction)
  // RFC 3579 §3.2: Must be zeroed when computing HMAC-MD5
  const msgAuthPlaceholder = new Uint8Array(18); // Type(1) + Length(1) + Value(16)
  msgAuthPlaceholder[0] = RADIUS_ATTR.MESSAGE_AUTHENTICATOR;
  msgAuthPlaceholder[1] = 18;
  // bytes 2-17 are zero
  attributes.push(msgAuthPlaceholder);

  // Calculate total length
  const attributesLength = attributes.reduce((sum, attr) => sum + attr.length, 0);
  const totalLength = 20 + attributesLength; // Header (20 bytes) + Attributes

  // Build packet with zeroed Message-Authenticator
  const packet = new Uint8Array(totalLength);

  // Code (1 byte)
  packet[0] = RADIUS_CODE.ACCESS_REQUEST;

  // Identifier (1 byte)
  packet[1] = identifier;

  // Length (2 bytes, big-endian)
  packet[2] = (totalLength >> 8) & 0xFF;
  packet[3] = totalLength & 0xFF;

  // Authenticator (16 bytes)
  packet.set(authenticator, 4);

  // Attributes
  let offset = 20;
  for (const attr of attributes) {
    packet.set(attr, offset);
    offset += attr.length;
  }

  // Compute Message-Authenticator over entire packet (RFC 3579 §3.2)
  const RADSEC_SECRET = 'radsec';
  const msgAuth = await computeMessageAuthenticator(packet, RADSEC_SECRET);

  // Replace zeroed Message-Authenticator with computed value
  // Find Message-Authenticator attribute (last 18 bytes)
  const msgAuthOffset = totalLength - 18;
  packet.set(msgAuth, msgAuthOffset + 2); // +2 to skip Type and Length

  return packet;
}

/**
 * Parse RADIUS attribute.
 */
function parseAttribute(data: Uint8Array, offset: number): {
  type: number;
  length: number;
  value: Uint8Array;
} | null {
  if (offset + 2 > data.length) {
    return null;
  }

  const type = data[offset];
  const length = data[offset + 1];

  if (offset + length > data.length || length < 2) {
    return null;
  }

  const value = data.slice(offset + 2, offset + length);

  return { type, length, value };
}

/**
 * Validate Response Authenticator per RFC 2865 §3.
 * Response Authenticator = MD5(Code+ID+Length+RequestAuth+Attributes+Secret)
 */
async function validateResponseAuthenticator(
  responsePacket: Uint8Array,
  requestAuthenticator: Uint8Array,
  secret: string
): Promise<boolean> {
  if (responsePacket.length < 20) {
    return false;
  }

  // Extract Response Authenticator from packet
  const responseAuth = responsePacket.slice(4, 20);

  // Build validation packet: replace Response Authenticator with Request Authenticator
  const validationPacket = new Uint8Array(responsePacket.length);
  validationPacket.set(responsePacket);
  validationPacket.set(requestAuthenticator, 4); // Replace authenticator field

  // Append shared secret
  const secretBytes = new TextEncoder().encode(secret);
  const hashInput = new Uint8Array(validationPacket.length + secretBytes.length);
  hashInput.set(validationPacket);
  hashInput.set(secretBytes, validationPacket.length);

  // Compute MD5
  const hashBuffer = await crypto.subtle.digest('MD5', hashInput.buffer as ArrayBuffer);
  const computedAuth = new Uint8Array(hashBuffer);

  // Compare authenticators
  if (computedAuth.length !== responseAuth.length) {
    return false;
  }

  for (let i = 0; i < computedAuth.length; i++) {
    if (computedAuth[i] !== responseAuth[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Parse RADIUS response packet.
 */
function parseRadiusResponse(data: Uint8Array): {
  code: number;
  identifier: number;
  authenticator: Uint8Array;
  attributes: Record<number, Uint8Array>;
} | null {
  if (data.length < 20) {
    return null;
  }

  // Parse header
  const code = data[0];
  const identifier = data[1];
  const length = (data[2] << 8) | data[3];
  const authenticator = data.slice(4, 20);

  if (data.length < length) {
    return null;
  }

  // Parse attributes
  const attributes: Record<number, Uint8Array> = {};
  let offset = 20;

  while (offset < length) {
    const attr = parseAttribute(data, offset);
    if (!attr) {
      break;
    }

    attributes[attr.type] = attr.value;
    offset += attr.length;
  }

  return {
    code,
    identifier,
    authenticator,
    attributes,
  };
}

/**
 * Send RADSEC authentication request.
 */
export async function handleRadsecAuth(request: Request): Promise<Response> {
  try {
    const body = await request.json() as RadsecRequest;
    const {
      host,
      port = 2083,
      username,
      password,
      nasIdentifier,
      nasIpAddress,
      timeout = 15000,
    } = body;

    // Validation
    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies RadsecResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!username || !password) {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        error: 'Username and password are required',
      } satisfies RadsecResponse), {
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
      } satisfies RadsecResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    // Generate RADIUS identifiers
    const identifier = generateIdentifier();
    const authenticator = generateAuthenticator();

    // Encode RADIUS Access-Request (async due to crypto operations)
    const radiusRequest = await encodeAccessRequest({
      identifier,
      authenticator,
      username,
      password,
      nasIdentifier,
      nasIpAddress,
    });

    // Connect to RADSEC server with TLS
    const socket = connect(`${host}:${port}`, {
      secureTransport: 'on',
      allowHalfOpen: false,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send RADIUS request
      await writer.write(radiusRequest);
      writer.releaseLock();

      // Read response
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const maxResponseSize = 4096; // RADIUS packets are typically small

      const readTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Response timeout')), timeout);
      });

      try {
        while (true) {
          const { value, done } = await Promise.race([
            reader.read(),
            readTimeout,
          ]);

          if (done) break;

          if (value) {
            chunks.push(value);
            totalBytes += value.length;

            if (totalBytes > maxResponseSize) {
              break;
            }

            // Check if we have complete packet (length is in header)
            if (totalBytes >= 4) {
              const combined = new Uint8Array(totalBytes);
              let offset = 0;
              for (const chunk of chunks) {
                combined.set(chunk, offset);
                offset += chunk.length;
              }

              const packetLength = (combined[2] << 8) | combined[3];
              if (totalBytes >= packetLength) {
                break; // Complete packet received
              }
            }
          }
        }
      } catch (error) {
        // Socket might close after response
        if (chunks.length === 0) {
          throw error;
        }
      }

      const rtt = Date.now() - start;

      // Combine chunks
      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      reader.releaseLock();
      socket.close();

      if (combined.length === 0) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Empty response from server',
        } satisfies RadsecResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Parse RADIUS response
      const parsed = parseRadiusResponse(combined);

      if (!parsed) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Invalid RADIUS response format',
        } satisfies RadsecResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Check identifier matches
      if (parsed.identifier !== identifier) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: `Identifier mismatch (expected ${identifier}, got ${parsed.identifier})`,
        } satisfies RadsecResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Validate Response Authenticator (RFC 2865 §3)
      const RADSEC_SECRET = 'radsec';
      const isAuthenticatorValid = await validateResponseAuthenticator(
        combined,
        authenticator,
        RADSEC_SECRET
      );

      if (!isAuthenticatorValid) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Response Authenticator validation failed (possible spoofing or corruption)',
        } satisfies RadsecResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const isSuccess = parsed.code === RADIUS_CODE.ACCESS_ACCEPT;

      // Decode attributes
      const decodedAttributes: Record<string, string> = {};
      for (const [typeStr, value] of Object.entries(parsed.attributes)) {
        const type = parseInt(typeStr, 10);
        if (type === RADIUS_ATTR.USER_NAME || type === RADIUS_ATTR.NAS_IDENTIFIER) {
          decodedAttributes[typeStr] = new TextDecoder().decode(value);
        } else {
          decodedAttributes[typeStr] = Array.from(value)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
        }
      }

      return new Response(JSON.stringify({
        success: isSuccess,
        host,
        port,
        code: parsed.code,
        codeText: getCodeText(parsed.code),
        identifier: parsed.identifier,
        attributes: decodedAttributes,
        rtt,
      } satisfies RadsecResponse), {
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
      port: 2083,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies RadsecResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Test RADSEC connection.
 */
export async function handleRadsecConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 2083, timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    // Connect to RADSEC server with TLS
    const socket = connect(`${host}:${port}`, {
      secureTransport: 'on',
      allowHalfOpen: false,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const rtt = Date.now() - start;

      socket.close();

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        rtt,
        message: 'RADSEC connection successful (TLS established)',
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

/**
 * Encode a RADIUS Accounting-Request packet (RFC 2866).
 * RFC 2866 §3: Request Authenticator = MD5(Code+ID+Length+16zero+Attributes+Secret)
 * acctStatusType: 1=Start, 2=Stop, 3=Interim-Update
 */
async function encodeAccountingRequest(params: {
  identifier: number;
  username: string;
  nasIdentifier?: string;
  nasIpAddress?: string;
  acctStatusType?: number;
  acctSessionId?: string;
  acctInputOctets?: number;
  acctOutputOctets?: number;
  acctSessionTime?: number;
}): Promise<Uint8Array> {
  const { identifier, username, nasIdentifier, nasIpAddress,
          acctStatusType = 1, acctSessionId, acctInputOctets = 0,
          acctOutputOctets = 0, acctSessionTime = 0 } = params;

  const attributes: Uint8Array[] = [];
  attributes.push(encodeAttribute(RADIUS_ATTR.USER_NAME, username));
  attributes.push(encodeAttribute(RADIUS_ATTR.ACCT_STATUS_TYPE, new Uint8Array([0, 0, 0, acctStatusType])));
  if (acctSessionId) attributes.push(encodeAttribute(44, acctSessionId)); // Acct-Session-Id = 44
  // Acct-Input-Octets = 42, Acct-Output-Octets = 43
  const ioBytes = new Uint8Array(4);
  new DataView(ioBytes.buffer).setUint32(0, acctInputOctets, false);
  attributes.push(encodeAttribute(42, ioBytes));
  const ooBytes = new Uint8Array(4);
  new DataView(ooBytes.buffer).setUint32(0, acctOutputOctets, false);
  attributes.push(encodeAttribute(43, ooBytes));
  // Acct-Session-Time = 46
  const stBytes = new Uint8Array(4);
  new DataView(stBytes.buffer).setUint32(0, acctSessionTime, false);
  attributes.push(encodeAttribute(46, stBytes));
  if (nasIdentifier) attributes.push(encodeAttribute(RADIUS_ATTR.NAS_IDENTIFIER, nasIdentifier));
  if (nasIpAddress) {
    try { attributes.push(encodeNasIpAddress(nasIpAddress)); } catch { /* skip invalid IP */ }
  }

  const attrLen = attributes.reduce((s, a) => s + a.length, 0);
  const totalLen = 20 + attrLen;

  // Build packet with zeroed authenticator field (RFC 2866 §3)
  const packet = new Uint8Array(totalLen);
  packet[0] = RADIUS_CODE.ACCOUNTING_REQUEST;
  packet[1] = identifier;
  packet[2] = (totalLen >> 8) & 0xFF;
  packet[3] = totalLen & 0xFF;
  // Authenticator field (offset 4-19) left as zeros
  let off = 20;
  for (const attr of attributes) { packet.set(attr, off); off += attr.length; }

  // Compute Request Authenticator: MD5(Code+ID+Length+16zero+Attributes+Secret)
  const RADSEC_SECRET = 'radsec';
  const secretBytes = new TextEncoder().encode(RADSEC_SECRET);
  const hashInput = new Uint8Array(totalLen + secretBytes.length);
  hashInput.set(packet);
  hashInput.set(secretBytes, totalLen);

  const hashBuffer = await crypto.subtle.digest('MD5', hashInput.buffer as ArrayBuffer);
  const authenticator = new Uint8Array(hashBuffer);

  // Set computed authenticator in packet
  packet.set(authenticator, 4);

  return packet;
}

/**
 * POST /api/radsec/accounting
 * Send a RADIUS Accounting-Request over TLS (RADSEC).
 * Body: { host, port?, username, nasIdentifier?, nasIpAddress?, timeout?,
 *         acctStatusType? (1=Start|2=Stop|3=Interim), acctSessionId?,
 *         acctInputOctets?, acctOutputOctets?, acctSessionTime? }
 * Response: { success, code, codeText, rtt }
 */
export async function handleRadsecAccounting(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    interface AcctRequest extends RadsecRequest {
      acctStatusType?: number;
      acctSessionId?: string;
      acctInputOctets?: number;
      acctOutputOctets?: number;
      acctSessionTime?: number;
    }
    const body = await request.json() as AcctRequest;
    const { host, port = 2083, username, nasIdentifier, nasIpAddress, timeout = 15000,
            acctStatusType = 1, acctSessionId, acctInputOctets = 0,
            acctOutputOctets = 0, acctSessionTime = 0 } = body;

    if (!host) return new Response(JSON.stringify({ success: false, host: '', port, error: 'Host is required' } satisfies RadsecResponse), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (!username) return new Response(JSON.stringify({ success: false, host, port, error: 'Username is required' } satisfies RadsecResponse), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const identifier = generateIdentifier();
    const radiusRequest = await encodeAccountingRequest({
      identifier, username, nasIdentifier, nasIpAddress,
      acctStatusType, acctSessionId, acctInputOctets, acctOutputOctets, acctSessionTime,
    });

    const socket = connect(`${host}:${port}`, { secureTransport: 'on', allowHalfOpen: false });
    const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout));
    const start = Date.now();

    try {
      await Promise.race([socket.opened, timeoutPromise]);
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();
      await writer.write(radiusRequest);
      writer.releaseLock();

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const readTimeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Response timeout')), timeout));
      try {
        while (true) {
          const { value, done } = await Promise.race([reader.read(), readTimeout]);
          if (done) break;
          if (value) {
            chunks.push(value); totalBytes += value.length;
            if (totalBytes >= 4) {
              const combined2 = new Uint8Array(totalBytes);
              let off2 = 0;
              for (const c of chunks) { combined2.set(c, off2); off2 += c.length; }
              const pktLen = (combined2[2] << 8) | combined2[3];
              if (totalBytes >= pktLen) break;
            }
          }
        }
      } catch { if (chunks.length === 0) throw new Error('No response received'); }

      const rtt = Date.now() - start;
      const combined = new Uint8Array(totalBytes);
      let off = 0;
      for (const c of chunks) { combined.set(c, off); off += c.length; }
      reader.releaseLock();
      socket.close();

      const parsed = parseRadiusResponse(combined);
      if (!parsed) {
        return new Response(JSON.stringify({ success: false, host, port, rtt, error: 'Invalid RADIUS response' } satisfies RadsecResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      const statusLabels: Record<number, string> = { 1: 'Start', 2: 'Stop', 3: 'Interim-Update' };
      return new Response(JSON.stringify({
        success: parsed.code === RADIUS_CODE.ACCOUNTING_RESPONSE,
        host, port,
        code: parsed.code,
        codeText: getCodeText(parsed.code),
        acctStatusType,
        acctStatusLabel: statusLabels[acctStatusType] ?? 'Unknown',
        rtt,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      socket.close();
      throw err;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      host: '',
      port: 2083,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies RadsecResponse), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
