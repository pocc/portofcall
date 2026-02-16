/**
 * Tarantool IPROTO Protocol Implementation
 *
 * Implements Tarantool connectivity testing via the IPROTO binary protocol (port 3301).
 * Tarantool is a high-performance in-memory database and application server.
 *
 * Protocol Flow:
 * 1. Client connects, server immediately sends 128-byte greeting:
 *    - Bytes 0-63: "Tarantool <version>\n" + instance info
 *    - Bytes 64-107: Base64-encoded 44-byte salt for CHAP-SHA1 auth
 *    - Bytes 108-127: Padding (newline + zeros)
 * 2. Client sends IPROTO requests (MessagePack-encoded)
 * 3. Server responds with IPROTO responses (MessagePack-encoded)
 *
 * IPROTO Message Format:
 * - 5-byte size header (MessagePack uint32)
 * - Header map: {IPROTO_REQUEST_TYPE: type, IPROTO_SYNC: sync_id}
 * - Body map: request-specific fields
 *
 * Use Cases:
 * - Tarantool server detection via greeting banner
 * - Version and instance UUID discovery
 * - IPROTO_PING connectivity verification
 * - Authentication requirement detection
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// IPROTO constants
const IPROTO_REQUEST_TYPE = 0x00;
const IPROTO_SYNC = 0x01;
const IPROTO_SCHEMA_VERSION = 0x05;
const IPROTO_STATUS = 0x00;
const IPROTO_ERROR = 0x31;

// Request types
const IPROTO_PING = 0x40;
export const IPROTO_ID = 0x49;

// Greeting is always exactly 128 bytes
const GREETING_SIZE = 128;

/**
 * Read exactly `needed` bytes from the socket.
 */
async function readExact(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  needed: number,
  timeoutPromise: Promise<never>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (total < needed) {
    const result = await Promise.race([reader.read(), timeoutPromise]);
    if (result.done || !result.value) break;
    chunks.push(result.value);
    total += result.value.length;
  }

  if (chunks.length === 1) return chunks[0].slice(0, needed);
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined.slice(0, needed);
}

/**
 * Parse the Tarantool greeting (128 bytes).
 * Line 1: "Tarantool <version>" (e.g., "Tarantool 2.11.0 (Binary) <uuid>")
 * Line 2: Base64-encoded salt (44 chars)
 */
function parseGreeting(data: Uint8Array): {
  isTarantool: boolean;
  version: string;
  instanceInfo: string;
  salt: string;
  rawLine1: string;
  rawLine2: string;
} {
  const text = new TextDecoder().decode(data);
  const lines = text.split('\n');
  const line1 = lines[0] || '';
  const line2 = lines[1] || '';

  const isTarantool = line1.startsWith('Tarantool ');

  let version = 'Unknown';
  let instanceInfo = '';
  if (isTarantool) {
    // Parse version from "Tarantool X.Y.Z ..."
    const parts = line1.split(' ');
    if (parts.length >= 2) {
      version = parts[1];
    }
    // Everything after version is instance info (UUID, binary type, etc.)
    if (parts.length >= 3) {
      instanceInfo = parts.slice(2).join(' ').trim();
    }
  }

  return {
    isTarantool,
    version,
    instanceInfo,
    salt: line2.trim(),
    rawLine1: line1.trim(),
    rawLine2: line2.trim(),
  };
}

/**
 * Encode a simple MessagePack uint value.
 * Supports positive fixint (0-127), uint8, uint16, uint32.
 */
function mpEncodeUint(value: number): Uint8Array {
  if (value >= 0 && value <= 0x7F) {
    return new Uint8Array([value]);
  }
  if (value <= 0xFF) {
    return new Uint8Array([0xCC, value]);
  }
  if (value <= 0xFFFF) {
    const buf = new Uint8Array(3);
    buf[0] = 0xCD;
    buf[1] = (value >> 8) & 0xFF;
    buf[2] = value & 0xFF;
    return buf;
  }
  const buf = new Uint8Array(5);
  buf[0] = 0xCE;
  buf[1] = (value >> 24) & 0xFF;
  buf[2] = (value >> 16) & 0xFF;
  buf[3] = (value >> 8) & 0xFF;
  buf[4] = value & 0xFF;
  return buf;
}

/**
 * Encode a MessagePack fixmap with uint key-value pairs.
 */
function mpEncodeMap(entries: [number, number][]): Uint8Array {
  const parts: Uint8Array[] = [];
  // fixmap header (up to 15 entries)
  parts.push(new Uint8Array([0x80 | entries.length]));

  for (const [key, value] of entries) {
    parts.push(mpEncodeUint(key));
    parts.push(mpEncodeUint(value));
  }

  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/**
 * Build an IPROTO request packet.
 * Format: [size_header (5 bytes)] [header_map] [body_map]
 */
function buildIprotoRequest(requestType: number, syncId: number): Uint8Array {
  // Header map: {IPROTO_REQUEST_TYPE: type, IPROTO_SYNC: syncId}
  const headerMap = mpEncodeMap([
    [IPROTO_REQUEST_TYPE, requestType],
    [IPROTO_SYNC, syncId],
  ]);

  // Empty body map for PING
  const bodyMap = new Uint8Array([0x80]); // fixmap(0)

  const payloadLen = headerMap.length + bodyMap.length;

  // Size header: MessagePack uint32 encoding of payload length
  const sizeHeader = mpEncodeUint(payloadLen);

  const packet = new Uint8Array(sizeHeader.length + payloadLen);
  packet.set(sizeHeader, 0);
  packet.set(headerMap, sizeHeader.length);
  packet.set(bodyMap, sizeHeader.length + headerMap.length);

  return packet;
}

/**
 * Decode a MessagePack uint from data at offset.
 * Returns [value, newOffset].
 */
function mpDecodeUint(data: Uint8Array, offset: number): [number, number] {
  if (offset >= data.length) return [0, offset];

  const byte = data[offset];

  // positive fixint
  if (byte >= 0x00 && byte <= 0x7F) {
    return [byte, offset + 1];
  }

  // uint8
  if (byte === 0xCC) {
    return [data[offset + 1], offset + 2];
  }

  // uint16
  if (byte === 0xCD) {
    return [
      (data[offset + 1] << 8) | data[offset + 2],
      offset + 3,
    ];
  }

  // uint32
  if (byte === 0xCE) {
    return [
      ((data[offset + 1] << 24) | (data[offset + 2] << 16) | (data[offset + 3] << 8) | data[offset + 4]) >>> 0,
      offset + 5,
    ];
  }

  // negative fixint (treat as error code)
  if (byte >= 0xE0) {
    return [byte - 256, offset + 1];
  }

  return [0, offset + 1];
}

/**
 * Parse a simple IPROTO response.
 * Returns status code and any error message.
 */
function parseIprotoResponse(data: Uint8Array): {
  status: number;
  schemaVersion: number;
  error: string;
} {
  let offset = 0;

  // Read size header
  const [, sizeEnd] = mpDecodeUint(data, offset);
  offset = sizeEnd;

  // Parse header map
  let status = -1;
  let schemaVersion = 0;

  if (offset < data.length && (data[offset] & 0xF0) === 0x80) {
    const mapLen = data[offset] & 0x0F;
    offset++;

    for (let i = 0; i < mapLen; i++) {
      const [key, keyEnd] = mpDecodeUint(data, offset);
      const [value, valueEnd] = mpDecodeUint(data, keyEnd);
      offset = valueEnd;

      if (key === IPROTO_STATUS) {
        status = value;
      } else if (key === IPROTO_SCHEMA_VERSION) {
        schemaVersion = value;
      }
    }
  }

  // Parse body map for error message
  let error = '';
  if (offset < data.length && (data[offset] & 0xF0) === 0x80) {
    const mapLen = data[offset] & 0x0F;
    offset++;

    for (let i = 0; i < mapLen; i++) {
      const [key, keyEnd] = mpDecodeUint(data, offset);

      if (key === IPROTO_ERROR) {
        // Read string
        if (keyEnd < data.length) {
          const strMarker = data[keyEnd];
          if ((strMarker & 0xE0) === 0xA0) {
            // fixstr
            const strLen = strMarker & 0x1F;
            error = new TextDecoder().decode(data.slice(keyEnd + 1, keyEnd + 1 + strLen));
            offset = keyEnd + 1 + strLen;
          } else if (strMarker === 0xD9) {
            // str8
            const strLen = data[keyEnd + 1];
            error = new TextDecoder().decode(data.slice(keyEnd + 2, keyEnd + 2 + strLen));
            offset = keyEnd + 2 + strLen;
          } else {
            offset = keyEnd + 1;
          }
        } else {
          offset = keyEnd;
        }
      } else {
        // Skip value
        offset = keyEnd;
        const [, vEnd] = mpDecodeUint(data, offset);
        offset = vEnd;
      }
    }
  }

  return { status, schemaVersion, error };
}

/**
 * Handle Tarantool connection test with IPROTO_PING.
 */
export async function handleTarantoolConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 3301, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);
    const connectTime = Date.now() - startTime;

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // Phase 1: Read the 128-byte greeting
    const greetingData = await readExact(reader, GREETING_SIZE, timeoutPromise);
    const greeting = parseGreeting(greetingData);

    // Phase 2: Send IPROTO_PING
    let pingSuccess = false;
    let pingStatus = -1;
    let schemaVersion = 0;
    let pingError = '';

    if (greeting.isTarantool) {
      const pingPacket = buildIprotoRequest(IPROTO_PING, 1);
      await writer.write(pingPacket);

      // Read response (size varies, read enough)
      const responseData = await readExact(reader, 64, timeoutPromise);
      const parsed = parseIprotoResponse(responseData);
      pingStatus = parsed.status;
      schemaVersion = parsed.schemaVersion;
      pingError = parsed.error;
      pingSuccess = parsed.status === 0;
    }

    const rtt = Date.now() - startTime;

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    let message = '';
    if (greeting.isTarantool) {
      message = `Tarantool server detected. Version: ${greeting.version}.`;
      if (pingSuccess) {
        message += ' IPROTO_PING succeeded — server is responsive.';
      } else if (pingError) {
        message += ` PING failed: ${pingError}`;
      }
    } else {
      message = 'Connected but server does not appear to be Tarantool.';
    }

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      connectTime,
      isTarantool: greeting.isTarantool,
      version: greeting.version,
      instanceInfo: greeting.instanceInfo,
      salt: greeting.salt ? greeting.salt.substring(0, 20) + '...' : undefined,
      pingSuccess,
      pingStatus,
      schemaVersion: schemaVersion || undefined,
      pingError: pingError || undefined,
      greetingLine1: greeting.rawLine1,
      message,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

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
 * Handle Tarantool probe — just reads the greeting banner for detection.
 */
export async function handleTarantoolProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 3301, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);

    const reader = socket.readable.getReader();

    // Read 128-byte greeting
    const greetingData = await readExact(reader, GREETING_SIZE, timeoutPromise);
    const greeting = parseGreeting(greetingData);
    const rtt = Date.now() - startTime;

    reader.releaseLock();
    socket.close();

    let message = '';
    if (greeting.isTarantool) {
      message = `Tarantool server detected. Version: ${greeting.version}.`;
      if (greeting.instanceInfo) {
        message += ` Instance: ${greeting.instanceInfo}`;
      }
    } else {
      message = 'Server responded but does not appear to be Tarantool.';
    }

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      isTarantool: greeting.isTarantool,
      version: greeting.version,
      instanceInfo: greeting.instanceInfo,
      greetingLine1: greeting.rawLine1,
      message,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

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
