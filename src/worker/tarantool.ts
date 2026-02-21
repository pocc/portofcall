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

  // Size header: always a 5-byte MessagePack uint32 (0xCE prefix).
  // Tarantool decodes the size with mp_decode_uint and accepts any msgpack
  // uint encoding, but using a fixed 5-byte uint32 is conventional and
  // avoids parser edge cases in strict server implementations.
  const sizeHeader = new Uint8Array(5);
  sizeHeader[0] = 0xCE;
  sizeHeader[1] = (payloadLen >> 24) & 0xFF;
  sizeHeader[2] = (payloadLen >> 16) & 0xFF;
  sizeHeader[3] = (payloadLen >> 8) & 0xFF;
  sizeHeader[4] = payloadLen & 0xFF;

  const packet = new Uint8Array(5 + payloadLen);
  packet.set(sizeHeader, 0);
  packet.set(headerMap, 5);
  packet.set(bodyMap, 5 + headerMap.length);

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
      new DataView(data.buffer, data.byteOffset + offset + 1).getUint32(0, false),
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
 * Skip a single MessagePack value at offset and return the new offset.
 * Used to advance past body fields that are not of interest without
 * corrupting the parse position. Handles the types Tarantool commonly
 * returns: nil, bool, uint, int, fixstr, str8/16, fixarray, fixmap, bin8.
 */
function mpSkipValue(data: Uint8Array, offset: number): number {
  if (offset >= data.length) return offset;
  const b = data[offset];
  // nil, bool
  if (b === 0xC0 || b === 0xC2 || b === 0xC3) return offset + 1;
  // positive fixint
  if (b <= 0x7F) return offset + 1;
  // negative fixint
  if (b >= 0xE0) return offset + 1;
  // fixstr
  if ((b & 0xE0) === 0xA0) return offset + 1 + (b & 0x1F);
  // fixarray
  if ((b & 0xF0) === 0x90) {
    const len = b & 0x0F;
    let off = offset + 1;
    for (let i = 0; i < len; i++) off = mpSkipValue(data, off);
    return off;
  }
  // fixmap
  if ((b & 0xF0) === 0x80) {
    const len = b & 0x0F;
    let off = offset + 1;
    for (let i = 0; i < len; i++) { off = mpSkipValue(data, off); off = mpSkipValue(data, off); }
    return off;
  }
  // uint8 / int8
  if (b === 0xCC || b === 0xD0) return offset + 2;
  // uint16 / int16
  if (b === 0xCD || b === 0xD1) return offset + 3;
  // uint32 / int32 / float32
  if (b === 0xCE || b === 0xD2 || b === 0xCA) return offset + 5;
  // uint64 / int64 / float64
  if (b === 0xCF || b === 0xD3 || b === 0xCB) return offset + 9;
  // str8 / bin8
  if (b === 0xD9 || b === 0xC4) {
    if (offset + 2 > data.length) return data.length;
    return offset + 2 + data[offset + 1];
  }
  // str16 / bin16
  if (b === 0xDA || b === 0xC5) {
    if (offset + 3 > data.length) return data.length;
    return offset + 3 + ((data[offset + 1] << 8) | data[offset + 2]);
  }
  // str32 / bin32
  if (b === 0xDB || b === 0xC6) {
    if (offset + 5 > data.length) return data.length; // Can't read length prefix
    const len = new DataView(data.buffer, data.byteOffset + offset + 1).getUint32(0, false);
    if (offset + 5 + len > data.length) return data.length; // Would go out of bounds
    return offset + 5 + len;
  }
  // array16
  if (b === 0xDC) {
    const len = (data[offset + 1] << 8) | data[offset + 2];
    let off = offset + 3;
    for (let i = 0; i < len; i++) off = mpSkipValue(data, off);
    return off;
  }
  // map16
  if (b === 0xDE) {
    const len = (data[offset + 1] << 8) | data[offset + 2];
    let off = offset + 3;
    for (let i = 0; i < len; i++) { off = mpSkipValue(data, off); off = mpSkipValue(data, off); }
    return off;
  }
  // Unknown — advance by 1 to avoid infinite loop
  return offset + 1;
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
        // Skip value using a generic single-value skip so that non-uint
        // body fields (arrays, strings, maps) do not corrupt the offset.
        // mpDecodeUint only advances past uint types; for all other types
        // it returns [0, offset+1], leaving subsequent parses wrong.
        offset = mpSkipValue(data, keyEnd);
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


// ============================================================
// Tarantool IPROTO_EVAL and IPROTO_EXECUTE
// ============================================================

// Request type codes
const IPROTO_EVAL_CODE  = 0x29;
const IPROTO_EXEC_CODE  = 0x0b;

// Field keys
const IPROTO_TUPLE_KEY   = 0x21;
const IPROTO_EXPR_KEY    = 0x27;
const IPROTO_SQL_TEXT    = 0x40;
const IPROTO_SQL_BIND    = 0x41;
const IPROTO_DATA_KEY    = 0x30;
const IPROTO_METADATA    = 0x32;

/**
 * Encode a MessagePack string (fixstr or str8).
 */
function mpEncodeString(s: string): Uint8Array {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length <= 31) {
    // fixstr
    const buf = new Uint8Array(1 + bytes.length);
    buf[0] = 0xA0 | bytes.length;
    buf.set(bytes, 1);
    return buf;
  }
  if (bytes.length <= 255) {
    // str8
    const buf = new Uint8Array(2 + bytes.length);
    buf[0] = 0xD9;
    buf[1] = bytes.length;
    buf.set(bytes, 2);
    return buf;
  }
  // str16
  const buf = new Uint8Array(3 + bytes.length);
  buf[0] = 0xDA;
  buf[1] = (bytes.length >> 8) & 0xFF;
  buf[2] = bytes.length & 0xFF;
  buf.set(bytes, 3);
  return buf;
}

/**
 * Encode a MessagePack array header.
 */
function mpEncodeArrayHeader(len: number): Uint8Array {
  if (len <= 15) return new Uint8Array([0x90 | len]);
  if (len <= 65535) return new Uint8Array([0xDC, (len >> 8) & 0xFF, len & 0xFF]);
  return new Uint8Array([0xDD, (len >> 24) & 0xFF, (len >> 16) & 0xFF, (len >> 8) & 0xFF, len & 0xFF]);
}

/**
 * Encode a MessagePack map with mixed key/value types.
 */
function mpEncodeFullMap(entries: Array<[Uint8Array, Uint8Array]>): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(new Uint8Array([0x80 | entries.length])); // fixmap
  for (const [k, v] of entries) {
    parts.push(k);
    parts.push(v);
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { result.set(p, off); off += p.length; }
  return result;
}

/**
 * Build a 5-byte msgpack uint32 size header.
 */
function buildSizeHeader(payloadLen: number): Uint8Array {
  const buf = new Uint8Array(5);
  buf[0] = 0xCE;
  buf[1] = (payloadLen >> 24) & 0xFF;
  buf[2] = (payloadLen >> 16) & 0xFF;
  buf[3] = (payloadLen >> 8) & 0xFF;
  buf[4] = payloadLen & 0xFF;
  return buf;
}

/**
 * Encode a uint value as msgpack.
 */
function mpUint(v: number): Uint8Array {
  if (v <= 0x7F) return new Uint8Array([v]);
  if (v <= 0xFF) return new Uint8Array([0xCC, v]);
  if (v <= 0xFFFF) return new Uint8Array([0xCD, (v >> 8) & 0xFF, v & 0xFF]);
  return new Uint8Array([0xCE, (v >> 24) & 0xFF, (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF]);
}

/**
 * Build IPROTO_EVAL request packet.
 * Header: {0x00: IPROTO_EVAL_CODE, 0x01: sync}
 * Body: {IPROTO_EXPR: lua_expression, IPROTO_TUPLE: args_array}
 */
function buildEvalPacket(expr: string, _args: unknown[], syncId: number): Uint8Array {
  const headerMap = mpEncodeFullMap([
    [mpUint(IPROTO_REQUEST_TYPE), mpUint(IPROTO_EVAL_CODE)],
    [mpUint(IPROTO_SYNC), mpUint(syncId)],
  ]);

  // args array (empty if none)
  const argsArray = mpEncodeArrayHeader(0); // empty tuple for now

  const bodyMap = mpEncodeFullMap([
    [mpUint(IPROTO_EXPR_KEY), mpEncodeString(expr)],
    [mpUint(IPROTO_TUPLE_KEY), argsArray],
  ]);

  const payload = new Uint8Array(headerMap.length + bodyMap.length);
  payload.set(headerMap, 0);
  payload.set(bodyMap, headerMap.length);

  const sizeHeader = buildSizeHeader(payload.length);
  const packet = new Uint8Array(sizeHeader.length + payload.length);
  packet.set(sizeHeader, 0);
  packet.set(payload, sizeHeader.length);
  return packet;
}

/**
 * Build IPROTO_EXECUTE request packet.
 * Header: {0x00: IPROTO_EXEC_CODE, 0x01: sync}
 * Body: {IPROTO_SQL_TEXT: sql_string, IPROTO_SQL_BIND: []}
 */
function buildExecutePacket(sql: string, syncId: number): Uint8Array {
  const headerMap = mpEncodeFullMap([
    [mpUint(IPROTO_REQUEST_TYPE), mpUint(IPROTO_EXEC_CODE)],
    [mpUint(IPROTO_SYNC), mpUint(syncId)],
  ]);

  const bodyMap = mpEncodeFullMap([
    [mpUint(IPROTO_SQL_TEXT), mpEncodeString(sql)],
    [mpUint(IPROTO_SQL_BIND), mpEncodeArrayHeader(0)],
  ]);

  const payload = new Uint8Array(headerMap.length + bodyMap.length);
  payload.set(headerMap, 0);
  payload.set(bodyMap, headerMap.length);

  const sizeHeader = buildSizeHeader(payload.length);
  const packet = new Uint8Array(sizeHeader.length + payload.length);
  packet.set(sizeHeader, 0);
  packet.set(payload, sizeHeader.length);
  return packet;
}

/**
 * Decode msgpack value at offset, returns [value, newOffset].
 * Handles: nil, bool, uint, int, fixstr, str8/16, fixarray, fixmap.
 */
function mpDecode(data: Uint8Array, off: number): [unknown, number] {
  if (off >= data.length) return [null, off];
  const b = data[off];

  if (b === 0xC0) return [null, off + 1];                  // nil
  if (b === 0xC2) return [false, off + 1];                 // false
  if (b === 0xC3) return [true, off + 1];                  // true
  if (b <= 0x7F) return [b, off + 1];                      // positive fixint
  if (b >= 0xE0) return [b - 256, off + 1];               // negative fixint

  // fixstr
  if ((b & 0xE0) === 0xA0) {
    const len = b & 0x1F;
    return [new TextDecoder().decode(data.slice(off + 1, off + 1 + len)), off + 1 + len];
  }

  // str8
  if (b === 0xD9) {
    const len = data[off + 1];
    return [new TextDecoder().decode(data.slice(off + 2, off + 2 + len)), off + 2 + len];
  }

  // str16
  if (b === 0xDA) {
    const len = (data[off + 1] << 8) | data[off + 2];
    return [new TextDecoder().decode(data.slice(off + 3, off + 3 + len)), off + 3 + len];
  }

  // uint8
  if (b === 0xCC) return [data[off + 1], off + 2];
  // uint16
  if (b === 0xCD) return [((data[off + 1] << 8) | data[off + 2]), off + 3];
  // uint32
  if (b === 0xCE) {
    const v = new DataView(data.buffer, data.byteOffset + off + 1).getUint32(0, false);
    return [v, off + 5];
  }

  // int8
  if (b === 0xD0) return [data[off + 1] > 127 ? data[off + 1] - 256 : data[off + 1], off + 2];

  // fixarray
  if ((b & 0xF0) === 0x90) {
    const len = b & 0x0F;
    const arr: unknown[] = [];
    let cur = off + 1;
    for (let i = 0; i < len; i++) {
      const [v, next] = mpDecode(data, cur);
      arr.push(v); cur = next;
    }
    return [arr, cur];
  }

  // array16
  if (b === 0xDC) {
    const len = (data[off + 1] << 8) | data[off + 2];
    const arr: unknown[] = [];
    let cur = off + 3;
    for (let i = 0; i < len; i++) {
      const [v, next] = mpDecode(data, cur);
      arr.push(v); cur = next;
    }
    return [arr, cur];
  }

  // fixmap
  if ((b & 0xF0) === 0x80) {
    const len = b & 0x0F;
    const obj: Record<string, unknown> = {};
    let cur = off + 1;
    for (let i = 0; i < len; i++) {
      const [k, kEnd] = mpDecode(data, cur);
      const [v, vEnd] = mpDecode(data, kEnd);
      obj[String(k)] = v; cur = vEnd;
    }
    return [obj, cur];
  }

  // bin8 (skip)
  if (b === 0xC4) {
    const len = data[off + 1];
    return [null, off + 2 + len];
  }

  // float32
  if (b === 0xCA) {
    const dv = new DataView(data.buffer, data.byteOffset + off + 1, 4);
    return [dv.getFloat32(0, false), off + 5];
  }

  // float64
  if (b === 0xCB) {
    const dv = new DataView(data.buffer, data.byteOffset + off + 1, 8);
    return [dv.getFloat64(0, false), off + 9];
  }

  // Skip unknown
  return [null, off + 1];
}

/**
 * Parse a full IPROTO response frame.
 * Returns status code, sync, and decoded body.
 */
function parseFullIprotoResponse(data: Uint8Array): {
  status: number;
  sync: number;
  body: Record<string, unknown>;
  raw: Uint8Array;
} {
  let off = 0;
  // Skip size prefix (5 bytes, msgpack uint32)
  if (data[0] === 0xCE) off = 5;
  else if (data[0] === 0xCD) off = 3;
  else if (data[0] <= 0x7F) off = 1;

  // Parse header map
  let status = 0;
  let sync = 0;
  if (off < data.length && (data[off] & 0xF0) === 0x80) {
    const mapLen = data[off] & 0x0F;
    off++;
    for (let i = 0; i < mapLen; i++) {
      const [k, kEnd] = mpDecode(data, off);
      const [v, vEnd] = mpDecode(data, kEnd);
      if (k === 0x00) status = Number(v);
      else if (k === 0x01) sync = Number(v);
      off = vEnd;
    }
  }

  // Parse body map
  const body: Record<string, unknown> = {};
  if (off < data.length && ((data[off] & 0xF0) === 0x80)) {
    const [decoded] = mpDecode(data, off);
    if (decoded && typeof decoded === 'object') {
      Object.assign(body, decoded as Record<string, unknown>);
    }
  }

  return { status, sync, body, raw: data };
}

/**
 * Read a complete IPROTO response: first reads size prefix, then the full payload.
 */
async function readIprotoResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
): Promise<Uint8Array> {
  // Read 5 bytes. For 0xCE (uint32) all 5 bytes are the size prefix.
  // For 0xCD (uint16) only bytes 0-2 are the size prefix; bytes 3-4 are
  // the first 2 bytes of the message payload (over-read during the 5-byte
  // read). For fixint (byte 0 <= 0x7F) only byte 0 is the size prefix;
  // bytes 1-4 are the first 4 bytes of the message payload.
  const sizeBytes = await readExact(reader, 5, timeoutPromise);
  let msgLen: number;

  if (sizeBytes[0] === 0xCE) {
    // 5-byte uint32: no over-read
    msgLen = new DataView(sizeBytes.buffer, sizeBytes.byteOffset + 1).getUint32(0, false);
    if (msgLen > 1_048_576) throw new Error('IPROTO payload too large: ' + msgLen + ' bytes');
    const payload = await readExact(reader, msgLen, timeoutPromise);
    const full = new Uint8Array(5 + msgLen);
    full.set(sizeBytes, 0);
    full.set(payload, 5);
    return full;
  } else if (sizeBytes[0] === 0xCD) {
    // 3-byte uint16: bytes 3-4 of sizeBytes are first 2 payload bytes
    msgLen = ((sizeBytes[1] << 8) | sizeBytes[2]);
    const overRead = sizeBytes.slice(3, 5); // first 2 payload bytes already consumed
    const remaining = msgLen > 2 ? await readExact(reader, msgLen - 2, timeoutPromise) : new Uint8Array(0);
    const full = new Uint8Array(3 + msgLen);
    full.set(sizeBytes.slice(0, 3), 0); // 0xCD hi lo
    full.set(overRead, 3);              // first 2 payload bytes
    full.set(remaining, 5);             // remainder
    return full;
  } else if (sizeBytes[0] <= 0x7F) {
    // 1-byte fixint: bytes 1-4 of sizeBytes are first 4 payload bytes
    msgLen = sizeBytes[0];
    const overReadCount = Math.min(4, msgLen); // how many payload bytes are in sizeBytes[1..4]
    const overRead = sizeBytes.slice(1, 1 + overReadCount);
    const remaining = msgLen > 4 ? await readExact(reader, msgLen - 4, timeoutPromise) : new Uint8Array(0);
    const full = new Uint8Array(1 + msgLen);
    full[0] = sizeBytes[0];             // fixint size byte
    full.set(overRead, 1);              // first up-to-4 payload bytes
    if (remaining.length > 0) full.set(remaining, 1 + overReadCount);
    return full;
  } else {
    // Unknown size prefix format — return raw bytes and let caller handle
    return sizeBytes;
  }
}

/**
 * Execute a Lua expression via IPROTO_EVAL.
 *
 * POST /api/tarantool/eval
 * Body: { host, port?, timeout?, expression, args?, username?, password? }
 */
export async function handleTarantoolEval(request: Request, _env: unknown): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
      expression: string;
      args?: unknown[];
      username?: string;
      password?: string;
    };
    const { host, port = 3301, timeout = 15000, expression, args = [] } = body;

    if (!host) return new Response(JSON.stringify({ success: false, error: 'Host is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (!expression) return new Response(JSON.stringify({ success: false, error: 'Lua expression is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout));

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);
    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      // Read Tarantool greeting (128 bytes)
      const greetingData = await readExact(reader, GREETING_SIZE, timeoutPromise);
      const greeting = parseGreeting(greetingData);

      if (!greeting.isTarantool) {
        writer.releaseLock(); reader.releaseLock(); socket.close();
        return new Response(JSON.stringify({ success: false, host, port, error: 'Server is not Tarantool' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // Send IPROTO_EVAL
      const evalPacket = buildEvalPacket(expression, args, 1);
      await writer.write(evalPacket);

      const rawResp = await readIprotoResponse(reader, timeoutPromise);
      const parsed = parseFullIprotoResponse(rawResp);
      const rtt = Date.now() - startTime;

      writer.releaseLock(); reader.releaseLock(); socket.close();

      if (parsed.status !== 0) {
        const errMsg = (parsed.body[String(IPROTO_ERROR)] as string) || `IPROTO error code: ${parsed.status}`;
        return new Response(JSON.stringify({ success: false, host, port, rtt, error: errMsg, iprotoStatus: parsed.status }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      const data = parsed.body[String(IPROTO_DATA_KEY)];
      return new Response(JSON.stringify({
        success: true, host, port, rtt,
        version: greeting.version,
        expression,
        result: data,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      writer.releaseLock(); reader.releaseLock(); socket.close();
      throw err;
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Execute a SQL statement via IPROTO_EXECUTE.
 *
 * POST /api/tarantool/sql
 * Body: { host, port?, timeout?, sql, username?, password? }
 */
export async function handleTarantoolSQL(request: Request, _env: unknown): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
      sql: string;
      username?: string;
      password?: string;
    };
    const { host, port = 3301, timeout = 15000, sql } = body;

    if (!host) return new Response(JSON.stringify({ success: false, error: 'Host is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (!sql) return new Response(JSON.stringify({ success: false, error: 'SQL statement is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout));

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);
    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      // Read Tarantool greeting (128 bytes)
      const greetingData = await readExact(reader, GREETING_SIZE, timeoutPromise);
      const greeting = parseGreeting(greetingData);

      if (!greeting.isTarantool) {
        writer.releaseLock(); reader.releaseLock(); socket.close();
        return new Response(JSON.stringify({ success: false, host, port, error: 'Server is not Tarantool' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // Send IPROTO_EXECUTE
      const execPacket = buildExecutePacket(sql, 2);
      await writer.write(execPacket);

      const rawResp = await readIprotoResponse(reader, timeoutPromise);
      const parsed = parseFullIprotoResponse(rawResp);
      const rtt = Date.now() - startTime;

      writer.releaseLock(); reader.releaseLock(); socket.close();

      if (parsed.status !== 0) {
        const errMsg = (parsed.body[String(IPROTO_ERROR)] as string) || `IPROTO error code: ${parsed.status}`;
        return new Response(JSON.stringify({ success: false, host, port, rtt, error: errMsg, iprotoStatus: parsed.status }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // Extract metadata (column info) and data (rows)
      const metadata = parsed.body[String(IPROTO_METADATA)];
      const data = parsed.body[String(IPROTO_DATA_KEY)];

      // Build column names from metadata if available
      let columns: string[] = [];
      if (Array.isArray(metadata)) {
        columns = metadata.map((col: unknown) => {
          if (col && typeof col === 'object') {
            const c = col as Record<string, unknown>;
            return String(c['name'] ?? c['0'] ?? 'col');
          }
          return String(col);
        });
      }

      // Map rows to objects using column names
      let rows: unknown[] = [];
      if (Array.isArray(data)) {
        if (columns.length > 0) {
          rows = data.map((row: unknown) => {
            if (!Array.isArray(row)) return row;
            const obj: Record<string, unknown> = {};
            columns.forEach((col, i) => { obj[col] = row[i]; });
            return obj;
          });
        } else {
          rows = data;
        }
      }

      return new Response(JSON.stringify({
        success: true, host, port, rtt,
        version: greeting.version,
        sql, columns, rows, rowCount: rows.length,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      writer.releaseLock(); reader.releaseLock(); socket.close();
      throw err;
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
