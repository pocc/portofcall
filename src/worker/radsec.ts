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
  return Math.floor(Math.random() * 256);
}

/**
 * Generate a random Request Authenticator (16 bytes).
 */
function generateAuthenticator(): Uint8Array {
  const authenticator = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    authenticator[i] = Math.floor(Math.random() * 256);
  }
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
 * Encode User-Password attribute (simplified - no MD5 hashing for demo).
 * In production, password should be XORed with MD5(shared-secret + authenticator).
 * Since RADSEC uses TLS, the password can be sent as-is (TLS provides encryption).
 */
function encodePasswordAttribute(password: string): Uint8Array {
  // For RADSEC over TLS, we can send password as cleartext attribute
  // since TLS encrypts the entire packet
  return encodeAttribute(RADIUS_ATTR.USER_PASSWORD, password);
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
 * Encode RADIUS Access-Request packet.
 */
function encodeAccessRequest(params: {
  identifier: number;
  authenticator: Uint8Array;
  username: string;
  password: string;
  nasIdentifier?: string;
  nasIpAddress?: string;
}): Uint8Array {
  const { identifier, authenticator, username, password, nasIdentifier, nasIpAddress } = params;

  // Build attributes
  const attributes: Uint8Array[] = [];

  // User-Name attribute
  attributes.push(encodeAttribute(RADIUS_ATTR.USER_NAME, username));

  // User-Password attribute
  attributes.push(encodePasswordAttribute(password));

  // NAS-Identifier attribute (optional)
  if (nasIdentifier) {
    attributes.push(encodeAttribute(RADIUS_ATTR.NAS_IDENTIFIER, nasIdentifier));
  }

  // NAS-IP-Address attribute (optional)
  if (nasIpAddress) {
    attributes.push(encodeNasIpAddress(nasIpAddress));
  }

  // Calculate total length
  const attributesLength = attributes.reduce((sum, attr) => sum + attr.length, 0);
  const totalLength = 20 + attributesLength; // Header (20 bytes) + Attributes

  // Build packet
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

    // Encode RADIUS Access-Request
    const radiusRequest = encodeAccessRequest({
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
