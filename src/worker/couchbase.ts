/**
 * Couchbase / Memcached Binary Protocol Implementation
 *
 * Couchbase Server uses the memcached binary protocol (also called the
 * Key-Value Engine protocol) over TCP port 11210 for data operations.
 * Standard memcached servers also support this binary protocol on port 11211.
 *
 * Binary Protocol Header (24 bytes for both request and response):
 *
 * Request:
 * - Byte 0:     Magic (0x80 = request)
 * - Byte 1:     Opcode (command type)
 * - Bytes 2-3:  Key length (big-endian uint16)
 * - Byte 4:     Extras length (uint8)
 * - Byte 5:     Data type (0x00 = raw bytes)
 * - Bytes 6-7:  vBucket ID (big-endian uint16) [Reserved in memcached]
 * - Bytes 8-11: Total body length (big-endian uint32)
 * - Bytes 12-15: Opaque (big-endian uint32, echoed in response)
 * - Bytes 16-23: CAS (big-endian uint64)
 *
 * Response:
 * - Byte 0:     Magic (0x81 = response)
 * - Byte 1:     Opcode (echoed from request)
 * - Bytes 2-3:  Key length
 * - Byte 4:     Extras length
 * - Byte 5:     Data type
 * - Bytes 6-7:  Status (big-endian uint16: 0x0000=success)
 * - Bytes 8-11: Total body length (big-endian uint32)
 * - Bytes 12-15: Opaque (echoed)
 * - Bytes 16-23: CAS
 *
 * Key Opcodes:
 * - 0x00: GET          — Retrieve a key
 * - 0x01: SET          — Store a key
 * - 0x07: QUIT         — Close connection
 * - 0x0a: NOOP         — No operation (ping)
 * - 0x0b: VERSION      — Get server version string
 * - 0x10: STAT         — Get server statistics
 *
 * Use Cases:
 * - Health check Couchbase/memcached nodes via NOOP ping
 * - Detect server version and capabilities
 * - Test memcached binary protocol port accessibility
 * - Monitor Couchbase KV engine status
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// Memcached binary protocol constants
const MAGIC_REQUEST = 0x80;
const MAGIC_RESPONSE = 0x81;

const OPCODE_NOOP = 0x0a;
const OPCODE_VERSION = 0x0b;
const OPCODE_STAT = 0x10;

const STATUS_SUCCESS = 0x0000;

const HEADER_SIZE = 24;

const STATUS_NAMES: Record<number, string> = {
  0x0000: 'Success',
  0x0001: 'Key not found',
  0x0002: 'Key exists',
  0x0003: 'Value too large',
  0x0004: 'Invalid arguments',
  0x0005: 'Item not stored',
  0x0006: 'Non-numeric value',
  0x0007: 'Wrong vBucket',
  0x0020: 'Authentication error',
  0x0021: 'Authentication continue',
  0x0081: 'Unknown command',
  0x0082: 'Out of memory',
  0x0083: 'Not supported',
  0x0084: 'Internal error',
  0x0085: 'Busy',
  0x0086: 'Temporary failure',
};

interface CouchbaseRequest {
  host: string;
  port?: number;
  timeout?: number;
}

/**
 * Build a memcached binary protocol request header (24 bytes).
 */
function buildRequest(opcode: number, opaque: number = 0): Uint8Array {
  const header = new Uint8Array(HEADER_SIZE);
  const view = new DataView(header.buffer);

  header[0] = MAGIC_REQUEST;
  header[1] = opcode;
  // Bytes 2-7: key length, extras length, data type, vbucket — all 0
  // Bytes 8-11: total body length — 0 (no key/extras/value)
  view.setUint32(12, opaque); // Opaque
  // Bytes 16-23: CAS — 0

  return header;
}

/**
 * Parse a memcached binary response header.
 */
function parseResponseHeader(data: Uint8Array): {
  magic: number;
  opcode: number;
  keyLength: number;
  extrasLength: number;
  dataType: number;
  status: number;
  bodyLength: number;
  opaque: number;
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    magic: data[0],
    opcode: data[1],
    keyLength: view.getUint16(2),
    extrasLength: data[4],
    dataType: data[5],
    status: view.getUint16(6),
    bodyLength: view.getUint32(8),
    opaque: view.getUint32(12),
  };
}

/**
 * Read exactly `n` bytes from the reader, with timeout.
 */
async function readBytes(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  n: number,
  timeoutPromise: Promise<never>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (total < n) {
    const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }

  if (total < n) {
    throw new Error(`Expected ${n} bytes but got ${total}`);
  }

  // Fast path: single chunk with exact size
  if (chunks.length === 1 && chunks[0].length === n) {
    return chunks[0];
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result.slice(0, n);
}

/**
 * Read a complete memcached binary response (header + body).
 */
async function readResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
): Promise<{ header: ReturnType<typeof parseResponseHeader>; body: Uint8Array }> {
  const headerBytes = await readBytes(reader, HEADER_SIZE, timeoutPromise);
  const header = parseResponseHeader(headerBytes);

  let body: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  if (header.bodyLength > 0) {
    body = await readBytes(reader, header.bodyLength, timeoutPromise);
  }

  return { header, body };
}

/**
 * Handle Couchbase NOOP ping — send a NOOP request and expect success.
 */
export async function handleCouchbasePing(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as CouchbaseRequest;
    const { host, port = 11210, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send NOOP request
      const noopReq = buildRequest(OPCODE_NOOP, 0xDEADBEEF);
      await writer.write(noopReq);

      // Read response
      const { header } = await readResponse(reader, timeoutPromise);
      const rtt = Date.now() - startTime;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      if (header.magic !== MAGIC_RESPONSE) {
        return new Response(JSON.stringify({
          success: false, host, port,
          error: `Invalid response magic: 0x${header.magic.toString(16).padStart(2, '0')} (expected 0x81)`,
          rtt,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (header.status === STATUS_SUCCESS) {
        return new Response(JSON.stringify({
          success: true, host, port,
          message: 'NOOP ping successful',
          opaque: header.opaque === 0xDEADBEEF ? 'matched' : 'mismatched',
          rtt,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      } else {
        return new Response(JSON.stringify({
          success: false, host, port,
          error: `NOOP failed with status: 0x${header.status.toString(16).padStart(4, '0')} (${STATUS_NAMES[header.status] || 'Unknown'})`,
          rtt,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle Couchbase VERSION — send VERSION request and parse the version string.
 */
export async function handleCouchbaseVersion(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as CouchbaseRequest;
    const { host, port = 11210, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send VERSION request
      const versionReq = buildRequest(OPCODE_VERSION, 0x12345678);
      await writer.write(versionReq);

      // Read response
      const { header, body: respBody } = await readResponse(reader, timeoutPromise);
      const rtt = Date.now() - startTime;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      if (header.magic !== MAGIC_RESPONSE) {
        return new Response(JSON.stringify({
          success: false, host, port,
          error: `Invalid response magic: 0x${header.magic.toString(16).padStart(2, '0')}`,
          rtt,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (header.status === STATUS_SUCCESS) {
        const version = new TextDecoder().decode(respBody);
        return new Response(JSON.stringify({
          success: true, host, port,
          version,
          rtt,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      } else {
        return new Response(JSON.stringify({
          success: false, host, port,
          error: `VERSION failed with status: 0x${header.status.toString(16).padStart(4, '0')} (${STATUS_NAMES[header.status] || 'Unknown'})`,
          statusCode: header.status,
          rtt,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle Couchbase STAT — send STAT request and parse key-value statistics.
 * The STAT response is a series of response packets, each with a key-value pair,
 * terminated by a response with an empty key.
 */
export async function handleCouchbaseStats(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as CouchbaseRequest;
    const { host, port = 11210, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send STAT request (no key = get all stats)
      const statReq = buildRequest(OPCODE_STAT, 0xAAAAAAAA);
      await writer.write(statReq);

      // Read stat responses until we get one with empty key
      const stats: Record<string, string> = {};
      const decoder = new TextDecoder();
      let statCount = 0;
      const maxStats = 500; // Safety limit

      while (statCount < maxStats) {
        const { header, body: respBody } = await readResponse(reader, timeoutPromise);

        if (header.magic !== MAGIC_RESPONSE) {
          break;
        }

        if (header.status !== STATUS_SUCCESS) {
          writer.releaseLock();
          reader.releaseLock();
          socket.close();
          return new Response(JSON.stringify({
            success: false, host, port,
            error: `STAT failed with status: 0x${header.status.toString(16).padStart(4, '0')} (${STATUS_NAMES[header.status] || 'Unknown'})`,
            rtt: Date.now() - startTime,
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        // Empty key signals end of stats
        if (header.keyLength === 0) {
          break;
        }

        const key = decoder.decode(respBody.slice(0, header.keyLength));
        const value = decoder.decode(respBody.slice(header.keyLength));
        stats[key] = value;
        statCount++;
      }

      const rtt = Date.now() - startTime;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: true, host, port,
        stats,
        statCount: Object.keys(stats).length,
        rtt,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}


// ============================================================
// Couchbase / Memcached Binary Protocol: GET and SET
// ============================================================

const OPCODE_GET = 0x00;
const OPCODE_SET = 0x01;

const STATUS_NOT_FOUND = 0x0001;

interface CouchbaseKVRequest {
  host: string;
  port?: number;
  timeout?: number;
  bucket?: string;
  username?: string;
  password?: string;
  key: string;
  value?: string;
}

/**
 * Build a memcached binary GET request.
 * Header: magic(1) + opcode(1) + key_len(2) + extras_len(1) + data_type(1) + vbucket(2) + total_body(4) + opaque(4) + cas(8)
 * GET has no extras (0 bytes), total_body = key_len.
 */
function buildGetRequest(key: string, opaque = 0x11111111): Uint8Array {
  const keyBytes = new TextEncoder().encode(key);
  const packet = new Uint8Array(HEADER_SIZE + keyBytes.length);
  const view = new DataView(packet.buffer);
  packet[0] = MAGIC_REQUEST;
  packet[1] = OPCODE_GET;
  view.setUint16(2, keyBytes.length);       // key length
  packet[4] = 0;                            // extras length (none for GET)
  packet[5] = 0;                            // data type
  view.setUint16(6, 0);                     // vbucket
  view.setUint32(8, keyBytes.length);       // total body = key only
  view.setUint32(12, opaque);               // opaque
  // CAS = 0 (bytes 16-23)
  packet.set(keyBytes, HEADER_SIZE);
  return packet;
}

/**
 * Build a memcached binary SET request.
 * SET extras: [flags 4B][expiry 4B] = 8 bytes
 * total_body = extras(8) + key_len + value_len
 */
function buildSetRequest(key: string, value: string, flags = 0, expiry = 0, opaque = 0x22222222): Uint8Array {
  const keyBytes = new TextEncoder().encode(key);
  const valBytes = new TextEncoder().encode(value);
  const extrasLen = 8;
  const totalBody = extrasLen + keyBytes.length + valBytes.length;
  const packet = new Uint8Array(HEADER_SIZE + totalBody);
  const view = new DataView(packet.buffer);
  packet[0] = MAGIC_REQUEST;
  packet[1] = OPCODE_SET;
  view.setUint16(2, keyBytes.length);       // key length
  packet[4] = extrasLen;                    // extras length = 8
  packet[5] = 0;                            // data type
  view.setUint16(6, 0);                     // vbucket
  view.setUint32(8, totalBody);             // total body length
  view.setUint32(12, opaque);               // opaque
  // Extras: flags(4) + expiry(4)
  view.setUint32(HEADER_SIZE, flags);
  view.setUint32(HEADER_SIZE + 4, expiry);
  // Key
  packet.set(keyBytes, HEADER_SIZE + extrasLen);
  // Value
  packet.set(valBytes, HEADER_SIZE + extrasLen + keyBytes.length);
  return packet;
}

/**
 * GET a document by key from Couchbase/memcached.
 *
 * POST /api/couchbase/get
 * Body: { host, port?, timeout?, key, bucket?, username?, password? }
 */
export async function handleCouchbaseGet(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const body = await request.json() as CouchbaseKVRequest;
    const { host, port = 11210, timeout = 10000, key } = body;
    if (!host) return new Response(JSON.stringify({ success: false, error: 'Host is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (!key) return new Response(JSON.stringify({ success: false, error: 'Key is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (port < 1 || port > 65535) return new Response(JSON.stringify({ success: false, error: 'Port must be 1-65535' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout));

    try {
      await Promise.race([socket.opened, timeoutPromise]);
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      await writer.write(buildGetRequest(key));
      const { header, body: respBody } = await readResponse(reader, timeoutPromise);
      const rtt = Date.now() - startTime;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      if (header.magic !== MAGIC_RESPONSE) {
        return new Response(JSON.stringify({ success: false, host, port, key, rtt, error: `Invalid response magic: 0x${header.magic.toString(16)}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (header.status === STATUS_NOT_FOUND) {
        return new Response(JSON.stringify({ success: false, host, port, key, rtt, error: 'Key not found', statusCode: STATUS_NOT_FOUND }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (header.status !== STATUS_SUCCESS) {
        return new Response(JSON.stringify({ success: false, host, port, key, rtt, error: `GET failed: ${STATUS_NAMES[header.status] ?? 'Unknown'} (0x${header.status.toString(16)})`, statusCode: header.status }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // Response body: extras(flags 4B) + value
      const extrasLen = header.extrasLength;
      const flags = extrasLen >= 4 ? new DataView(respBody.buffer, respBody.byteOffset).getUint32(0) : 0;
      const value = new TextDecoder().decode(respBody.slice(extrasLen));

      return new Response(JSON.stringify({ success: true, host, port, key, rtt, value, flags }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * SET a document by key in Couchbase/memcached.
 *
 * POST /api/couchbase/set
 * Body: { host, port?, timeout?, key, value, bucket?, username?, password? }
 */
export async function handleCouchbaseSet(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const body = await request.json() as CouchbaseKVRequest;
    const { host, port = 11210, timeout = 10000, key, value = '' } = body;
    if (!host) return new Response(JSON.stringify({ success: false, error: 'Host is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (!key) return new Response(JSON.stringify({ success: false, error: 'Key is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (port < 1 || port > 65535) return new Response(JSON.stringify({ success: false, error: 'Port must be 1-65535' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout));

    try {
      await Promise.race([socket.opened, timeoutPromise]);
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      await writer.write(buildSetRequest(key, value));
      const { header } = await readResponse(reader, timeoutPromise);
      const rtt = Date.now() - startTime;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      if (header.magic !== MAGIC_RESPONSE) {
        return new Response(JSON.stringify({ success: false, host, port, key, rtt, error: `Invalid response magic: 0x${header.magic.toString(16)}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (header.status === STATUS_SUCCESS) {
        return new Response(JSON.stringify({ success: true, host, port, key, rtt, message: 'Key stored successfully', valueLength: value.length }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      } else {
        return new Response(JSON.stringify({ success: false, host, port, key, rtt, error: `SET failed: ${STATUS_NAMES[header.status] ?? 'Unknown'} (0x${header.status.toString(16)})`, statusCode: header.status }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
