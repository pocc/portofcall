/**
 * Apache Ignite Thin Client Protocol Support for Cloudflare Workers
 *
 * Apache Ignite is a distributed in-memory computing platform for caching,
 * computing, SQL, and streaming workloads. The thin client protocol provides
 * lightweight binary access over TCP.
 *
 * Thin Client Handshake (Port 10800):
 *   Client -> Server:
 *     [length: 4 bytes LE][version_major: 2 LE][version_minor: 2 LE]
 *     [version_patch: 2 LE][client_code: 1 byte (2 = thin client)]
 *
 *   Server -> Client (success):
 *     [length: 4 LE][success: 1 byte (1)][node_uuid: 16 bytes][features...]
 *
 *   Server -> Client (failure):
 *     [length: 4 LE][success: 1 byte (0)]
 *     [server_major: 2 LE][server_minor: 2 LE][server_patch: 2 LE]
 *     [error_msg_length: 4 LE][error_msg: UTF-8]
 *
 * Request/Response Format:
 *   Request:  [length: 4 LE][op_code: 2 LE][request_id: 8 LE][data...]
 *   Response: [length: 4 LE][request_id: 8 LE][status: 4 LE][data...]
 *
 * Operation Codes:
 *   OP_CACHE_GET_NAMES             = 1050  (0x041A)
 *   OP_CACHE_GET_OR_CREATE_WITH_NAME = 1052 (0x041C)
 *   OP_CACHE_GET                   = 1001  (0x03E9)
 *   OP_CACHE_PUT                   = 1001  ... note: varies by version
 *
 * Ignite type codes (for values in GET/PUT):
 *   1  = byte
 *   3  = short
 *   4  = int
 *   6  = float
 *   8  = double
 *   9  = char
 *   10 = bool
 *   9  = String (UTF-8, length-prefixed as int32 LE)
 *   13 = String type code in some contexts
 *
 * String encoding in Ignite thin client:
 *   [type_code: 1 byte (9 for String)] [length: int32 LE] [UTF-8 bytes...]
 *
 * Default port: 10800 (TCP)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// ---- protocol constants -------------------------------------------------------

const CLIENT_CODE_THIN = 2;

// Operation codes
const OP_CACHE_GET_NAMES              = 1050; // 0x041A
const OP_CACHE_GET_OR_CREATE_WITH_NAME = 1052; // 0x041C
const OP_CACHE_GET                    = 1001; // 0x03E9

// Ignite type codes
const TYPE_STRING = 9;
const TYPE_NULL   = 101;

// ---- interfaces ---------------------------------------------------------------

interface IgniteBaseRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface IgniteCacheGetRequest extends IgniteBaseRequest {
  cacheName: string;
  key: string;
}

// ---- handshake builders -------------------------------------------------------

/** Build thin client handshake packet */
function buildHandshake(major: number, minor: number, patch: number): Uint8Array {
  const packet = new Uint8Array(4 + 7);
  const view   = new DataView(packet.buffer);
  view.setInt32(0, 7, true);        // payload length
  view.setInt16(4, major, true);
  view.setInt16(6, minor, true);
  view.setInt16(8, patch, true);
  packet[10] = CLIENT_CODE_THIN;
  return packet;
}

// ---- request builders --------------------------------------------------------

/**
 * Build an Ignite thin client operation request.
 * Format: [length: 4 LE][op_code: 2 LE][request_id: 8 LE][payload...]
 */
function buildRequest(opCode: number, requestId: bigint, payload: Uint8Array): Uint8Array {
  const payloadSize = 2 + 8 + payload.length; // op_code + request_id + payload
  const packet = new Uint8Array(4 + payloadSize);
  const view   = new DataView(packet.buffer);

  view.setInt32(0, payloadSize, true);
  view.setInt16(4, opCode, true);
  view.setBigInt64(6, requestId, true);
  packet.set(payload, 14);

  return packet;
}

/**
 * Encode a string as an Ignite thin client typed value.
 * [type_code: 1 byte (9)] [length: int32 LE] [UTF-8 bytes]
 */
function encodeString(str: string): Uint8Array {
  const encoded = new TextEncoder().encode(str);
  const out     = new Uint8Array(1 + 4 + encoded.length);
  const view    = new DataView(out.buffer);
  out[0] = TYPE_STRING;
  view.setInt32(1, encoded.length, true);
  out.set(encoded, 5);
  return out;
}

/**
 * Encode a cache name string for OP_CACHE_GET_OR_CREATE_WITH_NAME / OP_CACHE_GET_NAMES.
 * These operations use a plain length-prefixed string (no type byte).
 */
function encodeCacheName(name: string): Uint8Array {
  const encoded = new TextEncoder().encode(name);
  const out     = new Uint8Array(4 + encoded.length);
  new DataView(out.buffer).setInt32(0, encoded.length, true);
  out.set(encoded, 4);
  return out;
}

// ---- response readers --------------------------------------------------------

/**
 * Read a complete response from the Ignite server.
 * The 4-byte length prefix declares how many more bytes follow.
 */
async function readResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    let result: ReadableStreamReadResult<Uint8Array>;
    try {
      result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Read timeout')), remaining)
        ),
      ]) as ReadableStreamReadResult<Uint8Array>;
    } catch {
      break;
    }

    if (result.done || !result.value) break;
    chunks.push(result.value);
    total += result.value.length;

    if (total >= 4) {
      const combined = mergeChunks(chunks, total);
      const view     = new DataView(combined.buffer, combined.byteOffset);
      const declared = view.getInt32(0, true);
      if (declared < 0 || declared > 1024 * 1024) throw new Error(`Invalid response length: ${declared}`);
      if (total >= 4 + declared) return combined;
    }
  }

  return mergeChunks(chunks, total);
}

function mergeChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/**
 * Parse the response header.
 * Response: [length: 4 LE][request_id: 8 LE][status: 4 LE][payload...]
 */
function parseResponseHeader(data: Uint8Array): {
  length: number;
  requestId: bigint;
  status: number;
  payload: Uint8Array;
} {
  if (data.length < 4) throw new Error('Response too short');
  const view   = new DataView(data.buffer, data.byteOffset);
  const length = view.getInt32(0, true);
  if (data.length < 4 + length) throw new Error('Incomplete response');

  const requestId = view.getBigInt64(4, true);
  const status    = view.getInt32(12, true);
  const payload   = data.slice(16, 4 + length);

  return { length, requestId, status, payload };
}

/**
 * Parse UUID bytes (16 bytes) at offset.
 * Ignite uses a specific mixed-endian byte order.
 */
function parseUUID(data: Uint8Array, offset: number): string {
  const h = (i: number) => data[offset + i].toString(16).padStart(2, '0');
  return `${h(3)}${h(2)}${h(1)}${h(0)}-${h(5)}${h(4)}-${h(7)}${h(6)}-${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}`;
}

/**
 * Parse the handshake response.
 */
function parseHandshakeResponse(response: Uint8Array): {
  success: boolean;
  nodeId?: string;
  serverVersion?: string;
  errorMessage?: string;
  requestedVersion?: string;
} {
  if (response.length < 5) throw new Error('Response too short');
  const view    = new DataView(response.buffer, response.byteOffset);
  const _length = view.getInt32(0, true);
  const ok      = response[4];

  void _length; // used only for framing

  if (ok === 1) {
    const result: ReturnType<typeof parseHandshakeResponse> = {
      success: true, requestedVersion: '1.7.0',
    };
    if (response.length >= 21) result.nodeId = parseUUID(response, 5);
    return result;
  }

  // Failure
  const result: ReturnType<typeof parseHandshakeResponse> = { success: false };
  if (response.length >= 11) {
    const maj   = view.getInt16(5, true);
    const min   = view.getInt16(7, true);
    const patch = view.getInt16(9, true);
    result.serverVersion = `${maj}.${min}.${patch}`;
  }
  if (response.length >= 15) {
    const errLen = view.getInt32(11, true);
    if (errLen > 0 && response.length >= 15 + errLen) {
      result.errorMessage = new TextDecoder().decode(response.slice(15, 15 + errLen));
    }
  }
  return result;
}

// ---- high-level session helper -----------------------------------------------

/**
 * Open a socket, perform the handshake, return writer+reader.
 * Throws on failure.
 */
async function openIgniteSession(
  host: string,
  port: number,
  timeout: number,
): Promise<{
  socket: ReturnType<typeof connect>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  nodeId?: string;
}> {
  const socket = connect(`${host}:${port}`);
  await Promise.race([
    socket.opened,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout)),
  ]);

  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  await writer.write(buildHandshake(1, 7, 0));
  const hsResp = await readResponse(reader, Math.min(timeout, 5000));
  const hsParsed = parseHandshakeResponse(hsResp);

  if (!hsParsed.success) {
    // Try fallback version that server advertised
    reader.releaseLock();
    writer.releaseLock();
    socket.close();
    throw new Error(`Handshake rejected by server (supports ${hsParsed.serverVersion ?? 'unknown'}): ${hsParsed.errorMessage ?? ''}`);
  }

  return { socket, writer, reader, nodeId: hsParsed.nodeId };
}

// ---- exported handlers -------------------------------------------------------

/**
 * POST /api/ignite/connect
 * Performs the thin client handshake and reports server info.
 * Body: { host, port?, timeout? }
 */
export async function handleIgniteConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as IgniteBaseRequest;
    const { host, port = 10800, timeout = 10000 } = body;

    if (!host) return igniteError('Host is required', 400);
    if (port < 1 || port > 65535) return igniteError('Port must be between 1 and 65535', 400);

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const wtr = socket.writable.getWriter();
      const rdr = socket.readable.getReader();

      try {
        await wtr.write(buildHandshake(1, 7, 0));
        const response = await readResponse(rdr, 5000);

        if (response.length < 5) throw new Error('Response too short');

        const view         = new DataView(response.buffer, response.byteOffset);
        const payloadLength = view.getInt32(0, true);
        const success      = response[4];

        const result: Record<string, unknown> = {
          success: true, host, port, rtt: Date.now() - startTime,
        };

        if (success === 1) {
          result.handshake = 'accepted';
          result.requestedVersion = '1.7.0';
          if (response.length >= 21) result.nodeId = parseUUID(response, 5);
          if (payloadLength > 17) { result.featuresPresent = true; result.payloadSize = payloadLength; }
        } else {
          result.handshake = 'rejected';
          if (response.length >= 11) {
            result.serverVersion = `${view.getInt16(5, true)}.${view.getInt16(7, true)}.${view.getInt16(9, true)}`;
          }
          if (response.length >= 15) {
            const errLen = view.getInt32(11, true);
            if (errLen > 0 && response.length >= 15 + errLen) {
              result.errorMessage = new TextDecoder().decode(response.slice(15, 15 + errLen));
            }
          }
        }

        wtr.releaseLock();
        rdr.releaseLock();
        await socket.close();
        return result;

      } catch (e) {
        wtr.releaseLock();
        rdr.releaseLock();
        await socket.close();
        throw e;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * POST /api/ignite/probe
 * Tests multiple protocol versions to find server-supported version.
 * Body: { host, port?, timeout? }
 */
export async function handleIgniteProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as IgniteBaseRequest;
    if (!body.host) return igniteError('Missing required parameter: host', 400);

    const host    = body.host;
    const port    = body.port || 10800;
    const timeout = body.timeout || 10000;

    if (port < 1 || port > 65535) return igniteError('Port must be between 1 and 65535', 400);

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();
    const versions  = [
      { major: 1, minor: 7, patch: 0 },
      { major: 1, minor: 6, patch: 0 },
      { major: 1, minor: 4, patch: 0 },
      { major: 1, minor: 1, patch: 0 },
      { major: 1, minor: 0, patch: 0 },
    ];

    const results: Array<{ version: string; accepted: boolean; nodeId?: string; serverVersion?: string; error?: string }> = [];

    for (const ver of versions) {
      try {
        const socket = connect(`${host}:${port}`);
        await socket.opened;

        const writer = socket.writable.getWriter();
        const reader = socket.readable.getReader();

        try {
          await writer.write(buildHandshake(ver.major, ver.minor, ver.patch));
          const response = await readResponse(reader, Math.min(3000, timeout));

          if (response.length >= 5) {
            const view    = new DataView(response.buffer, response.byteOffset);
            const success = response[4];

            if (success === 1) {
              const entry: typeof results[0] = { version: `${ver.major}.${ver.minor}.${ver.patch}`, accepted: true };
              if (response.length >= 21) entry.nodeId = parseUUID(response, 5);
              results.push(entry);
            } else {
              const entry: typeof results[0] = { version: `${ver.major}.${ver.minor}.${ver.patch}`, accepted: false };
              if (response.length >= 11) {
                entry.serverVersion = `${view.getInt16(5, true)}.${view.getInt16(7, true)}.${view.getInt16(9, true)}`;
              }
              results.push(entry);
            }
          }
        } finally {
          writer.releaseLock();
          reader.releaseLock();
          await socket.close();
        }
      } catch {
        results.push({ version: `${ver.major}.${ver.minor}.${ver.patch}`, accepted: false, error: 'Connection failed' });
      }
    }

    const accepted = results.filter(r => r.accepted);
    return new Response(JSON.stringify({
      success: true, host, port, rtt: Date.now() - startTime,
      acceptedVersions: accepted.length, totalProbed: results.length,
      highestAccepted: accepted.length > 0 ? accepted[0].version : null,
      nodeId: accepted.length > 0 ? accepted[0].nodeId : undefined,
      versions: results,
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * POST /api/ignite/list-caches
 *
 * After handshake, sends OP_CACHE_GET_NAMES (1050) to retrieve the names of
 * all caches in the cluster.
 *
 * Body: { host, port?, timeout? }
 */
export async function handleIgniteListCaches(request: Request): Promise<Response> {
  if (request.method !== 'POST') return igniteError('Method not allowed', 405);

  let body: IgniteBaseRequest;
  try { body = await request.json() as IgniteBaseRequest; }
  catch { return igniteError('Invalid JSON body', 400); }

  const { host, port = 10800, timeout = 12000 } = body;
  if (!host) return igniteError('host is required', 400);
  if (port < 1 || port > 65535) return igniteError('Port must be between 1 and 65535', 400);

  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { socket, writer, reader } = await openIgniteSession(host, port, timeout);

    try {
      // OP_CACHE_GET_NAMES: no payload
      await writer.write(buildRequest(OP_CACHE_GET_NAMES, BigInt(1), new Uint8Array(0)));
      const resp = await readResponse(reader, Math.min(timeout, 6000));

      const header = parseResponseHeader(resp);

      if (header.status !== 0) {
        return new Response(JSON.stringify({
          success: false,
          error: `Server returned status ${header.status}`,
          host,
          port,
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      // Response payload: [count: int32 LE] [name1: length-prefixed string] ...
      const payload = header.payload;
      const caches: string[] = [];

      if (payload.length >= 4) {
        const view  = new DataView(payload.buffer, payload.byteOffset);
        const count = view.getInt32(0, true);
        let off = 4;

        for (let i = 0; i < count; i++) {
          if (off + 4 > payload.length) break;
          const nameLen = view.getInt32(off, true);
          off += 4;
          if (nameLen > 0 && off + nameLen <= payload.length) {
            caches.push(new TextDecoder().decode(payload.slice(off, off + nameLen)));
            off += nameLen;
          }
        }
      }

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        caches,
        count: caches.length,
      }), { headers: { 'Content-Type': 'application/json' } });

    } finally {
      reader.releaseLock();
      writer.releaseLock();
      socket.close();
    }

  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      host,
      port,
      error: err instanceof Error ? err.message : 'Operation failed',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * POST /api/ignite/cache-get
 *
 * After handshake, optionally creates the named cache
 * (OP_CACHE_GET_OR_CREATE_WITH_NAME), then retrieves a key from it
 * (OP_CACHE_GET). Both key and value are treated as strings.
 *
 * Body: { host, port?, timeout?, cacheName, key }
 */
export async function handleIgniteCacheGet(request: Request): Promise<Response> {
  if (request.method !== 'POST') return igniteError('Method not allowed', 405);

  let body: IgniteCacheGetRequest;
  try { body = await request.json() as IgniteCacheGetRequest; }
  catch { return igniteError('Invalid JSON body', 400); }

  const { host, port = 10800, timeout = 12000, cacheName, key } = body;
  if (!host)      return igniteError('host is required', 400);
  if (!cacheName) return igniteError('cacheName is required', 400);
  if (!key)       return igniteError('key is required', 400);
  if (port < 1 || port > 65535) return igniteError('Port must be between 1 and 65535', 400);

  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { socket, writer, reader } = await openIgniteSession(host, port, timeout);

    try {
      // Step 1: OP_CACHE_GET_OR_CREATE_WITH_NAME to ensure cache exists
      const cacheNamePayload = encodeCacheName(cacheName);
      await writer.write(buildRequest(OP_CACHE_GET_OR_CREATE_WITH_NAME, BigInt(1), cacheNamePayload));
      const createResp = await readResponse(reader, Math.min(timeout, 5000));

      const createHeader = parseResponseHeader(createResp);
      if (createHeader.status !== 0) {
        return new Response(JSON.stringify({
          success: false,
          error: `Failed to access cache '${cacheName}': status ${createHeader.status}`,
          host, port, cacheName, key,
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      // The cache ID is in the create response (int32 LE at payload offset 0)
      let cacheId = 0;
      if (createHeader.payload.length >= 4) {
        cacheId = new DataView(createHeader.payload.buffer, createHeader.payload.byteOffset).getInt32(0, true);
      }

      // Step 2: OP_CACHE_GET
      // Payload: [cache_id: int32 LE] [flags: 1 byte (0)] [key: typed value]
      const keyEncoded = encodeString(key);
      const getPayload = new Uint8Array(4 + 1 + keyEncoded.length);
      const getView    = new DataView(getPayload.buffer);
      getView.setInt32(0, cacheId, true);
      getPayload[4] = 0; // flags
      getPayload.set(keyEncoded, 5);

      await writer.write(buildRequest(OP_CACHE_GET, BigInt(2), getPayload));
      const getResp   = await readResponse(reader, Math.min(timeout, 5000));
      const getHeader = parseResponseHeader(getResp);

      if (getHeader.status !== 0) {
        return new Response(JSON.stringify({
          success: false,
          error: `Cache GET failed: status ${getHeader.status}`,
          host, port, cacheName, key, cacheId,
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      // Parse the typed value in the response payload
      const valPayload = getHeader.payload;
      let value: string | null = null;

      if (valPayload.length > 0) {
        const typeCode = valPayload[0];
        if (typeCode === TYPE_NULL || typeCode === 0) {
          value = null; // key not found
        } else if (typeCode === TYPE_STRING && valPayload.length >= 5) {
          const strLen = new DataView(valPayload.buffer, valPayload.byteOffset).getInt32(1, true);
          if (strLen > 0 && valPayload.length >= 5 + strLen) {
            value = new TextDecoder().decode(valPayload.slice(5, 5 + strLen));
          } else {
            value = '';
          }
        } else {
          // Unknown type — return hex representation
          value = Array.from(valPayload.slice(0, Math.min(64, valPayload.length)))
            .map(b => b.toString(16).padStart(2, '0')).join(' ');
        }
      }

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        cacheName,
        cacheId,
        key,
        value,
        found: value !== null,
      }), { headers: { 'Content-Type': 'application/json' } });

    } finally {
      reader.releaseLock();
      writer.releaseLock();
      socket.close();
    }

  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      host, port, cacheName, key,
      error: err instanceof Error ? err.message : 'Operation failed',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
}

// ---- helpers -----------------------------------------------------------------

function igniteError(message: string, status: number): Response {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
