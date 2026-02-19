/**
 * Hazelcast IMDG Client Protocol Implementation
 *
 * Hazelcast is an in-memory data grid (IMDG) platform for distributed caching,
 * computing, and messaging. It uses a binary open client protocol over TCP.
 *
 * Hazelcast Open Binary Client Protocol v2 (Hazelcast 4.x / 5.x) uses a
 * multi-frame message model. Each frame has a 6-byte header:
 *   [frame_length: int32 LE] [flags: uint16 LE]
 *
 * The initial frame of every request/response carries a fixed preamble in
 * its content area (immediately after the 6-byte frame header):
 *   [message_type: int32 LE] [correlation_id: int64 LE] [partition_id: int32 LE]
 *
 * For this implementation we treat the initial frame as a single "request
 * header" of 22 bytes (6 frame-header + 16 content-preamble), followed by
 * the operation-specific payload.
 *
 * Frame flags (bit positions):
 *   0x8000 = BEGIN_FRAME     (first frame of a message fragment)
 *   0x4000 = END_FRAME       (last frame of a message fragment)
 *   0x2000 = IS_FINAL        (last frame of the entire message)
 *   0x1000 = BEGIN_DATA_STRUCTURE
 *   0x0800 = END_DATA_STRUCTURE
 *   0x0400 = IS_NULL
 *   0x0200 = IS_EVENT
 *   0x0100 = BACKUP_AWARE
 *   0x0080 = BACKUP_EVENT
 *
 * For single-frame request messages the flags are typically:
 *   0xE000 = BEGIN_FRAME | END_FRAME | IS_FINAL
 *
 * Key message types (request IDs):
 *   0x000100 = CLIENT_AUTHENTICATION
 *   0x000D00 = CLIENT_PING
 *   0x012E00 = MAP_SIZE           (service 1, method 0x2E)
 *   0x010100 = MAP_PUT            (service 1, method 0x01)
 *   0x010200 = MAP_GET            (service 1, method 0x02)
 *   0x010300 = MAP_REMOVE         (service 1, method 0x03)
 *   0x030200 = QUEUE_OFFER        (service 3, method 0x02)
 *   0x030400 = QUEUE_POLL         (service 3, method 0x04)
 *   0x030800 = QUEUE_SIZE         (service 3, method 0x08)
 *   0x040100 = TOPIC_PUBLISH      (service 4, method 0x01)
 *   0x060100 = SET_ADD            (service 6, method 0x01)
 *   0x060200 = SET_CONTAINS       (service 6, method 0x02)
 *   0x060300 = SET_REMOVE         (service 6, method 0x03)
 *
 * Default Port: 5701
 *
 * References:
 *   https://github.com/hazelcast/hazelcast-client-protocol
 *   https://docs.hazelcast.com/hazelcast/latest/clients/java
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// ---- protocol constants -------------------------------------------------------

// Frame header: 6 bytes (length + flags).  The initial frame's content starts
// with a 16-byte preamble (message_type + correlation_id + partition_id), so the
// minimum initial-frame size is 6 + 16 = 22 bytes.
const FRAME_HEADER_SIZE = 6;
const INITIAL_FRAME_PREAMBLE = 16; // message_type(4) + correlation_id(8) + partition_id(4)
const MIN_INITIAL_FRAME_SIZE = FRAME_HEADER_SIZE + INITIAL_FRAME_PREAMBLE; // 22

// Frame flags
const FLAG_BEGIN_FRAME = 0x8000;
const FLAG_END_FRAME   = 0x4000;
const FLAG_IS_FINAL    = 0x2000;
// Single-frame request: BEGIN + END + FINAL
const FLAG_UNFRAGMENTED = FLAG_BEGIN_FRAME | FLAG_END_FRAME | FLAG_IS_FINAL; // 0xE000

// Message type codes (protocol v2 encoding)
const MSG_AUTHENTICATION = 0x000100;
const MSG_PING           = 0x000D00;
const MSG_MAP_PUT        = 0x010100;
const MSG_MAP_GET        = 0x010200;
const MSG_MAP_REMOVE     = 0x010300;
const MSG_MAP_SIZE       = 0x012E00;
const MSG_QUEUE_OFFER    = 0x030200;
const MSG_QUEUE_POLL     = 0x030400;
const MSG_QUEUE_SIZE     = 0x030800;
const MSG_TOPIC_PUBLISH  = 0x040100;
const MSG_SET_ADD        = 0x060100;
const MSG_SET_CONTAINS   = 0x060200;
const MSG_SET_REMOVE     = 0x060300;

// Authentication status
const AUTH_STATUS_AUTHENTICATED        = 0;
const AUTH_STATUS_CREDENTIALS_FAILED   = 1;
const AUTH_STATUS_SERIALIZATION_VERSION_MISMATCH = 2;
const AUTH_STATUS_NOT_ALLOWED_IN_CLUSTER = 3;

// ---- interfaces ---------------------------------------------------------------

interface HazelcastRequest {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  clusterName?: string;
  timeout?: number;
}

interface HazelcastMapRequest extends HazelcastRequest {
  mapName: string;
  key: string;
}

interface HazelcastMapSetRequest extends HazelcastMapRequest {
  value: string;
  ttl?: number;
}

interface HazelcastMapDeleteRequest extends HazelcastMapRequest {}

interface HazelcastMapSetResponse {
  success: boolean;
  mapName?: string;
  key?: string;
  set?: boolean;
  previousValue?: string | null;
  error?: string;
  isCloudflare?: boolean;
  rtt?: number;
}

interface HazelcastMapDeleteResponse {
  success: boolean;
  mapName?: string;
  key?: string;
  deleted?: boolean;
  removedValue?: string | null;
  error?: string;
  isCloudflare?: boolean;
  rtt?: number;
}

interface HazelcastResponse {
  success: boolean;
  rtt?: number;
  isHazelcast?: boolean;
  version?: string;
  clusterName?: string;
  memberCount?: number;
  serverVersion?: string;
  authStatus?: number;
  authStatusLabel?: string;
  statusCode?: number;
  error?: string;
  isCloudflare?: boolean;
}

interface HazelcastMapResponse {
  success: boolean;
  mapName?: string;
  key?: string;
  size?: number;
  value?: string | null;
  error?: string;
  isCloudflare?: boolean;
}

// ---- frame construction -------------------------------------------------------

function mergeChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/**
 * Write a length-prefixed UTF-8 string into `buf` at `offset`.
 * Returns new offset after writing.
 * Format: [length: uint32 LE] [bytes...]
 */
function writeString(buf: Uint8Array, view: DataView, offset: number, str: string): number {
  const encoded = new TextEncoder().encode(str);
  view.setUint32(offset, encoded.length, true); offset += 4;
  buf.set(encoded, offset); offset += encoded.length;
  return offset;
}

/**
 * Read a length-prefixed string from `data` at `offset`.
 * Returns { value, nextOffset }.
 */
function readString(data: Uint8Array, offset: number): { value: string; nextOffset: number } {
  if (offset + 4 > data.length) return { value: '', nextOffset: offset };
  const len = new DataView(data.buffer, data.byteOffset).getUint32(offset, true);
  offset += 4;
  if (offset + len > data.length) return { value: '', nextOffset: offset };
  return {
    value: new TextDecoder().decode(data.slice(offset, offset + len)),
    nextOffset: offset + len,
  };
}

/**
 * Build a Hazelcast initial frame (single-frame message).
 *
 * Wire layout (protocol v2):
 *   [frame_length: int32 LE]      offset 0   (includes the 6-byte header)
 *   [flags:        uint16 LE]     offset 4
 *   --- content area (initial-frame preamble) ---
 *   [message_type:  int32 LE]     offset 6
 *   [correlation_id: int64 LE]    offset 10
 *   [partition_id:   int32 LE]    offset 18
 *   --- operation-specific payload ---          offset 22
 */
function buildFrame(
  messageType: number,
  correlationId: bigint,
  partitionId: number,
  payload: Uint8Array,
): Uint8Array {
  const totalLen = MIN_INITIAL_FRAME_SIZE + payload.length;
  const buf  = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);

  // Frame header (6 bytes)
  view.setUint32(0, totalLen, true);            // frame_length
  view.setUint16(4, FLAG_UNFRAGMENTED, true);   // flags (BEGIN + END + FINAL)

  // Initial-frame preamble (16 bytes of content)
  view.setInt32(6, messageType, true);          // message_type   at offset 6
  view.setBigInt64(10, correlationId, true);    // correlation_id at offset 10
  view.setInt32(18, partitionId, true);         // partition_id   at offset 18

  // Operation-specific payload
  buf.set(payload, MIN_INITIAL_FRAME_SIZE);

  return buf;
}

/** Build PING frame (empty payload, message_type=0) */
function buildPingFrame(correlationId: bigint): Uint8Array {
  return buildFrame(MSG_PING, correlationId, -1, new Uint8Array(0));
}

/**
 * Build CLIENT_AUTHENTICATION frame.
 * Payload: clusterName(string) + username(string) + password(string) +
 *          clientUUID(16 bytes = zeros) + clientType(string) + clientVersion(string) +
 *          serializationVersion(uint8) + clientName(string)
 */
function buildAuthFrame(
  clusterName: string,
  username: string,
  password: string,
  correlationId: bigint,
): Uint8Array {
  const enc = new TextEncoder();
  const cn = enc.encode(clusterName);
  const un = enc.encode(username);
  const pw = enc.encode(password);
  const ct = enc.encode('Hazelcast.CSharpClient'); // client type string
  const cv = enc.encode('5.0.0');
  const nm = enc.encode('PortOfCall');

  // Sizes: 4+len per string, 16 (UUID zeros), 1 (serializationVersion)
  const payloadLen = (4 + cn.length) + (4 + un.length) + (4 + pw.length) +
                     16 + (4 + ct.length) + (4 + cv.length) + 1 + (4 + nm.length);

  const payload = new Uint8Array(payloadLen);
  const view    = new DataView(payload.buffer);
  let off = 0;

  off = writeString(payload, view, off, clusterName);
  off = writeString(payload, view, off, username);
  off = writeString(payload, view, off, password);
  // Client UUID (16 zero bytes)
  off += 16;
  off = writeString(payload, view, off, 'Hazelcast.CSharpClient');
  off = writeString(payload, view, off, '5.0.0');
  payload[off++] = 1; // serialization version
  writeString(payload, view, off, 'PortOfCall');

  return buildFrame(MSG_AUTHENTICATION, correlationId, -1, payload);
}

/**
 * Build MAP_SIZE frame.
 * Payload: mapName(string)
 */
function buildMapSizeFrame(mapName: string, correlationId: bigint): Uint8Array {
  const enc = new TextEncoder().encode(mapName);
  const payload = new Uint8Array(4 + enc.length);
  new DataView(payload.buffer).setUint32(0, enc.length, true);
  payload.set(enc, 4);
  return buildFrame(MSG_MAP_SIZE, correlationId, -1, payload);
}

/**
 * Build MAP_GET frame.
 * Payload: mapName(string) + key(string)
 */
function buildMapGetFrame(mapName: string, key: string, correlationId: bigint): Uint8Array {
  const enc = new TextEncoder();
  const mn = enc.encode(mapName);
  const ky = enc.encode(key);
  const payload = new Uint8Array((4 + mn.length) + (4 + ky.length));
  const view = new DataView(payload.buffer);
  let off = 0;
  view.setUint32(off, mn.length, true); off += 4;
  payload.set(mn, off);                 off += mn.length;
  view.setUint32(off, ky.length, true); off += 4;
  payload.set(ky, off);
  return buildFrame(MSG_MAP_GET, correlationId, -1, payload);
}

// ---- socket helpers ----------------------------------------------------------

/** Read until we have a complete Hazelcast frame or timeout */
async function readFrame(
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

    // Once we have at least 4 bytes we can read the declared frame length
    if (total >= 4) {
      const combined = mergeChunks(chunks, total);
      const declared = new DataView(combined.buffer, combined.byteOffset).getUint32(0, true);
      if (declared < FRAME_HEADER_SIZE || declared > 4 * 1024 * 1024) break; // sanity
      // For response frames, the initial frame must be at least 22 bytes
      if (total >= declared) return combined;
    }
  }
  return mergeChunks(chunks, total);
}

/** Parse the correlation ID from an initial frame (offset 10, 8 bytes) */
function frameCorrelation(data: Uint8Array): bigint {
  if (data.length < MIN_INITIAL_FRAME_SIZE) return BigInt(0);
  return new DataView(data.buffer, data.byteOffset).getBigInt64(10, true);
}

/** Parse message type from an initial frame (offset 6, 4 bytes) */
function frameMessageType(data: Uint8Array): number {
  if (data.length < 10) return -1;
  return new DataView(data.buffer, data.byteOffset).getInt32(6, true);
}

/** Return payload slice (after the 22-byte initial-frame preamble) */
function framePayload(data: Uint8Array): Uint8Array {
  return data.slice(MIN_INITIAL_FRAME_SIZE);
}

/** Parse authentication response */
function parseAuthResponse(payload: Uint8Array): {
  status: number;
  statusLabel: string;
  serverVersion?: string;
  clusterName?: string;
} {
  if (payload.length < 1) return { status: 255, statusLabel: 'Empty response' };
  const status = payload[0];
  const labels: Record<number, string> = {
    [AUTH_STATUS_AUTHENTICATED]: 'authenticated',
    [AUTH_STATUS_CREDENTIALS_FAILED]: 'credentials failed',
    [AUTH_STATUS_SERIALIZATION_VERSION_MISMATCH]: 'serialization version mismatch',
    [AUTH_STATUS_NOT_ALLOWED_IN_CLUSTER]: 'not allowed in cluster',
  };

  let off = 1;
  let serverVersion: string | undefined;
  let clusterName: string | undefined;

  if (status === AUTH_STATUS_AUTHENTICATED && payload.length > 1) {
    const sv = readString(payload, off);
    serverVersion = sv.value || undefined;
    off = sv.nextOffset;
    if (off < payload.length) {
      const cn = readString(payload, off);
      clusterName = cn.value || undefined;
    }
  }

  return { status, statusLabel: labels[status] ?? `Unknown (${status})`, serverVersion, clusterName };
}

// ---- exported handlers -------------------------------------------------------

/**
 * POST /api/hazelcast/probe
 * Performs the Hazelcast authentication handshake and reports cluster info.
 * Body: { host, port?, username?, password?, clusterName?, timeout? }
 */
export async function handleHazelcastProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: HazelcastRequest;
  try { body = await request.json() as HazelcastRequest; }
  catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { host, port = 5701, username = '', password = '', clusterName = 'dev', timeout = 10000 } = body;

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
      success: false,
      error: getCloudflareErrorMessage(host, cfCheck.ip),
      isCloudflare: true,
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const result: HazelcastResponse = { success: false };
  const startTime = Date.now();

  try {
    const socket = connect(`${host}:${port}`);
    await Promise.race([
      socket.opened,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout)),
    ]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      // Send PING first (correlation ID 1)
      await writer.write(buildPingFrame(BigInt(1)));

      // Read PING response
      const pingResp = await readFrame(reader, Math.min(timeout, 4000));
      const pingType = frameMessageType(pingResp);

      // Regardless of ping response, send AUTH
      await writer.write(buildAuthFrame(clusterName, username, password, BigInt(2)));

      // Read AUTH response
      const authResp = await readFrame(reader, Math.min(timeout, 6000));
      result.rtt = Date.now() - startTime;

      const authType = frameMessageType(authResp);

      // If we got a valid Hazelcast frame back from ping, it's a Hazelcast server
      if (pingResp.length >= MIN_INITIAL_FRAME_SIZE || authResp.length >= MIN_INITIAL_FRAME_SIZE) {
        result.isHazelcast = true;
      }

      if (authResp.length >= MIN_INITIAL_FRAME_SIZE) {
        const correlation = frameCorrelation(authResp);
        if (correlation === BigInt(2) || authType === MSG_AUTHENTICATION || authResp.length > MIN_INITIAL_FRAME_SIZE) {
          const payload = framePayload(authResp);
          const parsed  = parseAuthResponse(payload);
          result.authStatus = parsed.status;
          result.authStatusLabel = parsed.statusLabel;

          if (parsed.status === AUTH_STATUS_AUTHENTICATED) {
            result.success = true;
            result.serverVersion = parsed.serverVersion;
            result.clusterName   = parsed.clusterName ?? clusterName;
            result.isHazelcast   = true;
          } else if (parsed.status === AUTH_STATUS_CREDENTIALS_FAILED) {
            // Wrong password, but server is Hazelcast
            result.success     = false;
            result.isHazelcast = true;
            result.error       = 'Authentication failed — check username/password';
          } else {
            result.isHazelcast = true;
            result.error       = `Auth status: ${parsed.statusLabel}`;
          }
        }
      } else if (pingResp.length >= MIN_INITIAL_FRAME_SIZE) {
        // Got a ping response but no auth — server is reachable
        result.isHazelcast = true;
        result.success     = true;
        result.clusterName = clusterName;
      }

      if (!result.success && !result.error && result.isHazelcast) {
        result.success = true; // reachable, even if auth details unclear
      }

      // Suppress unused variable warning
      void pingType;
      void authType;

    } finally {
      reader.releaseLock();
      writer.releaseLock();
    }

    socket.close();

  } catch (err) {
    result.rtt   = Date.now() - startTime;
    result.error = err instanceof Error ? err.message : 'Connection failed';
  }

  return new Response(JSON.stringify(result), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * POST /api/hazelcast/map-get
 *
 * After an authenticated handshake, queries the size of a named IMap and
 * attempts to GET a key from it. String keys and string/byte values are
 * supported.
 *
 * Body: { host, port?, username?, password?, clusterName?, timeout?, mapName, key }
 */
export async function handleHazelcastMapGet(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: HazelcastMapRequest;
  try { body = await request.json() as HazelcastMapRequest; }
  catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const {
    host,
    port = 5701,
    username = '',
    password = '',
    clusterName = 'dev',
    timeout = 12000,
    mapName,
    key,
  } = body;

  if (!host) return mapError('host is required');
  if (!mapName) return mapError('mapName is required');
  if (!key)     return mapError('key is required');
  if (port < 1 || port > 65535) return mapError('Port must be between 1 and 65535');

  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    return new Response(JSON.stringify({
      success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const result: HazelcastMapResponse = { success: false, mapName, key };

  try {
    const socket = connect(`${host}:${port}`);
    await Promise.race([
      socket.opened,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout)),
    ]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      // Step 1: Authenticate
      await writer.write(buildAuthFrame(clusterName, username, password, BigInt(1)));
      const authResp = await readFrame(reader, Math.min(timeout, 6000));

      if (authResp.length >= MIN_INITIAL_FRAME_SIZE) {
        const authPayload = framePayload(authResp);
        const authParsed  = parseAuthResponse(authPayload);

        if (authParsed.status !== AUTH_STATUS_AUTHENTICATED) {
          result.error = `Authentication failed: ${authParsed.statusLabel}`;
          return new Response(JSON.stringify(result), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      // Step 2: MAP_SIZE to confirm map is accessible
      await writer.write(buildMapSizeFrame(mapName, BigInt(2)));
      const sizeResp = await readFrame(reader, Math.min(timeout, 5000));

      if (sizeResp.length >= MIN_INITIAL_FRAME_SIZE + 4) {
        const sizePayload = framePayload(sizeResp);
        if (sizePayload.length >= 4) {
          result.size = new DataView(sizePayload.buffer, sizePayload.byteOffset).getInt32(0, true);
        }
      }

      // Step 3: MAP_GET
      await writer.write(buildMapGetFrame(mapName, key, BigInt(3)));
      const getResp = await readFrame(reader, Math.min(timeout, 5000));

      if (getResp.length >= MIN_INITIAL_FRAME_SIZE) {
        const getPayload = framePayload(getResp);
        if (getPayload.length === 0) {
          result.value = null; // key not found
        } else {
          // Value is a length-prefixed byte array
          if (getPayload.length >= 4) {
            const valLen = new DataView(getPayload.buffer, getPayload.byteOffset).getUint32(0, true);
            if (valLen > 0 && getPayload.length >= 4 + valLen) {
              result.value = new TextDecoder().decode(getPayload.slice(4, 4 + valLen));
            } else if (valLen === 0) {
              result.value = null;
            } else {
              // Return raw hex if not clearly UTF-8 decodable
              result.value = Array.from(getPayload.slice(0, Math.min(64, getPayload.length)))
                .map(b => b.toString(16).padStart(2, '0')).join(' ');
            }
          } else {
            result.value = Array.from(getPayload)
              .map(b => b.toString(16).padStart(2, '0')).join(' ');
          }
        }
        result.success = true;
      } else {
        result.error = 'No MAP_GET response received';
      }

    } finally {
      reader.releaseLock();
      writer.releaseLock();
    }

    socket.close();

  } catch (err) {
    result.error = err instanceof Error ? err.message : 'Operation failed';
  }

  return new Response(JSON.stringify(result), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

function mapError(msg: string): Response {
  return new Response(JSON.stringify({ success: false, error: msg } as HazelcastMapResponse), {
    status: 400, headers: { 'Content-Type': 'application/json' },
  });
}

// ---- MAP_PUT / MAP_REMOVE helpers --------------------------------------------

/**
 * Build MAP_PUT frame.
 * Payload: mapName(string) + key(string) + value(string) + threadId(int64 LE) + ttl(int64 LE)
 * All strings are length-prefixed (uint32 LE + bytes). threadId=1, ttl in ms (0=no expiry).
 */
function buildMapPutFrame(
  mapName: string,
  key: string,
  value: string,
  ttl: number,
  correlationId: bigint,
): Uint8Array {
  const enc = new TextEncoder();
  const mn = enc.encode(mapName);
  const ky = enc.encode(key);
  const vl = enc.encode(value);
  const payloadLen = (4 + mn.length) + (4 + ky.length) + (4 + vl.length) + 8 + 8;
  const payload = new Uint8Array(payloadLen);
  const view = new DataView(payload.buffer);
  let off = 0;
  view.setUint32(off, mn.length, true); off += 4;
  payload.set(mn, off);                 off += mn.length;
  view.setUint32(off, ky.length, true); off += 4;
  payload.set(ky, off);                 off += ky.length;
  view.setUint32(off, vl.length, true); off += 4;
  payload.set(vl, off);                 off += vl.length;
  view.setBigInt64(off, BigInt(1), true);       off += 8; // threadId = 1
  view.setBigInt64(off, BigInt(ttl), true);               // ttl in ms
  return buildFrame(MSG_MAP_PUT, correlationId, -1, payload);
}

/**
 * Build MAP_REMOVE frame.
 * Payload: mapName(string) + key(string) + threadId(int64 LE)
 */
function buildMapRemoveFrame(
  mapName: string,
  key: string,
  correlationId: bigint,
): Uint8Array {
  const enc = new TextEncoder();
  const mn = enc.encode(mapName);
  const ky = enc.encode(key);
  const payloadLen = (4 + mn.length) + (4 + ky.length) + 8;
  const payload = new Uint8Array(payloadLen);
  const view = new DataView(payload.buffer);
  let off = 0;
  view.setUint32(off, mn.length, true); off += 4;
  payload.set(mn, off);                 off += mn.length;
  view.setUint32(off, ky.length, true); off += 4;
  payload.set(ky, off);                 off += ky.length;
  view.setBigInt64(off, BigInt(1), true); // threadId = 1
  return buildFrame(MSG_MAP_REMOVE, correlationId, -1, payload);
}

/**
 * Decode a Hazelcast value payload into a string (or null if empty).
 * Values are length-prefixed byte arrays: uint32 LE length + bytes.
 */
function decodeValuePayload(payload: Uint8Array): string | null {
  if (payload.length === 0) return null;
  if (payload.length < 4) {
    return Array.from(payload).map(b => b.toString(16).padStart(2, '0')).join(' ');
  }
  const valLen = new DataView(payload.buffer, payload.byteOffset).getUint32(0, true);
  if (valLen === 0) return null;
  if (valLen > 0 && payload.length >= 4 + valLen) {
    return new TextDecoder().decode(payload.slice(4, 4 + valLen));
  }
  return Array.from(payload.slice(0, Math.min(64, payload.length)))
    .map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// ---- exported handlers -------------------------------------------------------

/**
 * POST /api/hazelcast/map-set
 *
 * Authenticates with Hazelcast and puts a key/value pair into a named IMap.
 * Optionally sets a TTL in milliseconds.
 *
 * Body: { host, port?, username?, password?, clusterName?, timeout?,
 *         mapName, key, value, ttl? }
 * Response: { mapName, key, set, previousValue, rtt }
 */
export async function handleHazelcastMapSet(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: HazelcastMapSetRequest;
  try { body = await request.json() as HazelcastMapSetRequest; }
  catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const {
    host,
    port = 5701,
    username = '',
    password = '',
    clusterName = 'dev',
    timeout = 12000,
    mapName,
    key,
    value,
    ttl = 0,
  } = body;

  if (!host) return new Response(JSON.stringify({ success: false, error: 'host is required' } as HazelcastMapSetResponse), { status: 400, headers: { 'Content-Type': 'application/json' } });
  if (!mapName) return new Response(JSON.stringify({ success: false, error: 'mapName is required' } as HazelcastMapSetResponse), { status: 400, headers: { 'Content-Type': 'application/json' } });
  if (!key) return new Response(JSON.stringify({ success: false, error: 'key is required' } as HazelcastMapSetResponse), { status: 400, headers: { 'Content-Type': 'application/json' } });
  if (value === undefined || value === null) return new Response(JSON.stringify({ success: false, error: 'value is required' } as HazelcastMapSetResponse), { status: 400, headers: { 'Content-Type': 'application/json' } });
  if (port < 1 || port > 65535) return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' } as HazelcastMapSetResponse), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    return new Response(JSON.stringify({
      success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
    } as HazelcastMapSetResponse), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const result: HazelcastMapSetResponse = { success: false, mapName, key };
  const startTime = Date.now();

  try {
    const socket = connect(`${host}:${port}`);
    await Promise.race([
      socket.opened,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout)),
    ]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      // Step 1: Authenticate
      await writer.write(buildAuthFrame(clusterName, username, password, BigInt(1)));
      const authResp = await readFrame(reader, Math.min(timeout, 6000));

      if (authResp.length >= MIN_INITIAL_FRAME_SIZE) {
        const authParsed = parseAuthResponse(framePayload(authResp));
        if (authParsed.status !== AUTH_STATUS_AUTHENTICATED) {
          result.error = `Authentication failed: ${authParsed.statusLabel}`;
          return new Response(JSON.stringify(result), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      // Step 2: MAP_PUT
      await writer.write(buildMapPutFrame(mapName, key, value, ttl, BigInt(2)));
      const putResp = await readFrame(reader, Math.min(timeout, 5000));

      result.rtt = Date.now() - startTime;

      if (putResp.length >= MIN_INITIAL_FRAME_SIZE) {
        const putPayload = framePayload(putResp);
        // MAP_PUT returns the previous value (or empty payload if key didn't exist)
        result.previousValue = decodeValuePayload(putPayload);
        result.set = true;
        result.success = true;
      } else {
        result.error = 'No MAP_PUT response received';
      }

    } finally {
      reader.releaseLock();
      writer.releaseLock();
    }

    socket.close();

  } catch (err) {
    result.rtt = Date.now() - startTime;
    result.error = err instanceof Error ? err.message : 'Operation failed';
  }

  return new Response(JSON.stringify(result), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * POST /api/hazelcast/map-delete
 *
 * Authenticates with Hazelcast and removes a key from a named IMap.
 *
 * Body: { host, port?, username?, password?, clusterName?, timeout?,
 *         mapName, key }
 * Response: { mapName, key, deleted, removedValue, rtt }
 */
export async function handleHazelcastMapDelete(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: HazelcastMapDeleteRequest;
  try { body = await request.json() as HazelcastMapDeleteRequest; }
  catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const {
    host,
    port = 5701,
    username = '',
    password = '',
    clusterName = 'dev',
    timeout = 12000,
    mapName,
    key,
  } = body;

  if (!host) return new Response(JSON.stringify({ success: false, error: 'host is required' } as HazelcastMapDeleteResponse), { status: 400, headers: { 'Content-Type': 'application/json' } });
  if (!mapName) return new Response(JSON.stringify({ success: false, error: 'mapName is required' } as HazelcastMapDeleteResponse), { status: 400, headers: { 'Content-Type': 'application/json' } });
  if (!key) return new Response(JSON.stringify({ success: false, error: 'key is required' } as HazelcastMapDeleteResponse), { status: 400, headers: { 'Content-Type': 'application/json' } });
  if (port < 1 || port > 65535) return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' } as HazelcastMapDeleteResponse), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    return new Response(JSON.stringify({
      success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
    } as HazelcastMapDeleteResponse), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const result: HazelcastMapDeleteResponse = { success: false, mapName, key };
  const startTime = Date.now();

  try {
    const socket = connect(`${host}:${port}`);
    await Promise.race([
      socket.opened,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout)),
    ]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      // Step 1: Authenticate
      await writer.write(buildAuthFrame(clusterName, username, password, BigInt(1)));
      const authResp = await readFrame(reader, Math.min(timeout, 6000));

      if (authResp.length >= MIN_INITIAL_FRAME_SIZE) {
        const authParsed = parseAuthResponse(framePayload(authResp));
        if (authParsed.status !== AUTH_STATUS_AUTHENTICATED) {
          result.error = `Authentication failed: ${authParsed.statusLabel}`;
          return new Response(JSON.stringify(result), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      // Step 2: MAP_REMOVE
      await writer.write(buildMapRemoveFrame(mapName, key, BigInt(2)));
      const removeResp = await readFrame(reader, Math.min(timeout, 5000));

      result.rtt = Date.now() - startTime;

      if (removeResp.length >= MIN_INITIAL_FRAME_SIZE) {
        const removePayload = framePayload(removeResp);
        // MAP_REMOVE returns the removed value (or empty payload if key didn't exist)
        result.removedValue = decodeValuePayload(removePayload);
        result.deleted = true;
        result.success = true;
      } else {
        result.error = 'No MAP_REMOVE response received';
      }

    } finally {
      reader.releaseLock();
      writer.releaseLock();
    }

    socket.close();

  } catch (err) {
    result.rtt = Date.now() - startTime;
    result.error = err instanceof Error ? err.message : 'Operation failed';
  }

  return new Response(JSON.stringify(result), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

// ---- queue helpers -----------------------------------------------------------

function buildQueueOfferFrame(queueName: string, value: string, timeoutMs: bigint, correlationId: bigint): Uint8Array {
  const enc = new TextEncoder();
  const qn = enc.encode(queueName);
  const vl = enc.encode(value);
  // Payload: queueName(string) + value(string) + timeoutMs(int64 LE)
  const payload = new Uint8Array((4 + qn.length) + (4 + vl.length) + 8);
  const view = new DataView(payload.buffer);
  let off = 0;
  view.setUint32(off, qn.length, true); off += 4; payload.set(qn, off); off += qn.length;
  view.setUint32(off, vl.length, true); off += 4; payload.set(vl, off); off += vl.length;
  view.setBigInt64(off, timeoutMs, true);
  return buildFrame(MSG_QUEUE_OFFER, correlationId, -1, payload);
}

function buildQueuePollFrame(queueName: string, timeoutMs: bigint, correlationId: bigint): Uint8Array {
  const enc = new TextEncoder().encode(queueName);
  const payload = new Uint8Array((4 + enc.length) + 8);
  const view = new DataView(payload.buffer);
  let off = 0;
  view.setUint32(off, enc.length, true); off += 4; payload.set(enc, off); off += enc.length;
  view.setBigInt64(off, timeoutMs, true);
  return buildFrame(MSG_QUEUE_POLL, correlationId, -1, payload);
}

function buildSetFrame(msgType: number, setName: string, value: string, correlationId: bigint): Uint8Array {
  const enc = new TextEncoder();
  const sn = enc.encode(setName);
  const vl = enc.encode(value);
  const payload = new Uint8Array((4 + sn.length) + (4 + vl.length));
  const view = new DataView(payload.buffer);
  let off = 0;
  view.setUint32(off, sn.length, true); off += 4; payload.set(sn, off); off += sn.length;
  view.setUint32(off, vl.length, true); off += 4; payload.set(vl, off);
  return buildFrame(msgType, correlationId, -1, payload);
}

// ---- queue handler -----------------------------------------------------------

/**
 * Offer a value to a Hazelcast distributed queue (IQueue.offer)
 *
 * POST /api/hazelcast/queue-offer
 * Body: { host, port?, username?, password?, clusterName?, timeout?, queueName, value, offerTimeoutMs? }
 */
export async function handleHazelcastQueueOffer(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  interface HazelcastQueueRequest extends HazelcastRequest {
    queueName: string;
    value: string;
    offerTimeoutMs?: number;
  }

  let body: HazelcastQueueRequest;
  try { body = await request.json() as HazelcastQueueRequest; }
  catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { host, port = 5701, username = '', password = '', clusterName = 'dev', timeout = 12000, queueName, value, offerTimeoutMs = 5000 } = body;
  if (!host || !queueName || value === undefined) {
    return new Response(JSON.stringify({ success: false, error: 'host, queueName, and value are required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const result: { success: boolean; queueName?: string; value?: string; offered?: boolean; sizeBefore?: number; sizeAfter?: number; error?: string; rtt?: number } = {
    success: false, queueName, value,
  };
  const startTime = Date.now();

  try {
    const socket = connect(`${host}:${port}`);
    await Promise.race([socket.opened, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout))]);
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    try {
      await writer.write(buildAuthFrame(clusterName, username, password, BigInt(1)));
      const authResp = await readFrame(reader, Math.min(timeout, 6000));
      if (authResp.length >= MIN_INITIAL_FRAME_SIZE) {
        const parsed = parseAuthResponse(framePayload(authResp));
        if (parsed.status !== AUTH_STATUS_AUTHENTICATED) {
          result.error = `Authentication failed: ${parsed.statusLabel}`;
          return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      }

      // Get queue size before offer
      await writer.write(buildQueueSizeFrame(queueName, BigInt(2)));
      const sizeResp = await readFrame(reader, 4000);
      if (sizeResp.length >= MIN_INITIAL_FRAME_SIZE + 4) {
        const sp = framePayload(sizeResp);
        if (sp.length >= 4) result.sizeBefore = new DataView(sp.buffer, sp.byteOffset).getInt32(0, true);
      }

      await writer.write(buildQueueOfferFrame(queueName, value, BigInt(offerTimeoutMs), BigInt(3)));
      const offerResp = await readFrame(reader, Math.min(timeout, 6000));
      // QUEUE_OFFER response payload: boolean (1 byte) indicating success
      const payload = framePayload(offerResp);
      result.offered = payload.length > 0 && payload[0] !== 0;
      result.success = true;

      // Get queue size after offer
      await writer.write(buildQueueSizeFrame(queueName, BigInt(4)));
      const sizeResp2 = await readFrame(reader, 4000);
      if (sizeResp2.length >= MIN_INITIAL_FRAME_SIZE + 4) {
        const sp2 = framePayload(sizeResp2);
        if (sp2.length >= 4) result.sizeAfter = new DataView(sp2.buffer, sp2.byteOffset).getInt32(0, true);
      }
    } finally {
      reader.releaseLock();
      writer.releaseLock();
    }
    socket.close();
  } catch (err) {
    result.error = err instanceof Error ? err.message : 'Queue offer failed';
  }

  result.rtt = Date.now() - startTime;
  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Poll a value from a Hazelcast distributed queue (IQueue.poll)
 *
 * POST /api/hazelcast/queue-poll
 * Body: { host, port?, username?, password?, clusterName?, timeout?, queueName, pollTimeoutMs? }
 */
export async function handleHazelcastQueuePoll(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  interface HazelcastQueuePollRequest extends HazelcastRequest {
    queueName: string;
    pollTimeoutMs?: number;
  }

  let body: HazelcastQueuePollRequest;
  try { body = await request.json() as HazelcastQueuePollRequest; }
  catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { host, port = 5701, username = '', password = '', clusterName = 'dev', timeout = 12000, queueName, pollTimeoutMs = 1000 } = body;
  if (!host || !queueName) {
    return new Response(JSON.stringify({ success: false, error: 'host and queueName are required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const result: { success: boolean; queueName?: string; value?: string | null; error?: string; rtt?: number } = {
    success: false, queueName,
  };
  const startTime = Date.now();

  try {
    const socket = connect(`${host}:${port}`);
    await Promise.race([socket.opened, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout))]);
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    try {
      await writer.write(buildAuthFrame(clusterName, username, password, BigInt(1)));
      const authResp = await readFrame(reader, Math.min(timeout, 6000));
      if (authResp.length >= MIN_INITIAL_FRAME_SIZE) {
        const parsed = parseAuthResponse(framePayload(authResp));
        if (parsed.status !== AUTH_STATUS_AUTHENTICATED) {
          result.error = `Authentication failed: ${parsed.statusLabel}`;
          return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      }

      await writer.write(buildQueuePollFrame(queueName, BigInt(pollTimeoutMs), BigInt(2)));
      const pollResp = await readFrame(reader, Math.min(timeout + pollTimeoutMs, 15000));
      const payload = framePayload(pollResp);
      if (payload.length === 0) {
        result.value = null; // queue was empty
      } else if (payload.length >= 4) {
        const valLen = new DataView(payload.buffer, payload.byteOffset).getUint32(0, true);
        result.value = valLen > 0 && payload.length >= 4 + valLen
          ? new TextDecoder().decode(payload.slice(4, 4 + valLen))
          : null;
      }
      result.success = true;
    } finally {
      reader.releaseLock();
      writer.releaseLock();
    }
    socket.close();
  } catch (err) {
    result.error = err instanceof Error ? err.message : 'Queue poll failed';
  }

  result.rtt = Date.now() - startTime;
  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Add/contains/remove on a Hazelcast distributed ISet
 *
 * POST /api/hazelcast/set-add       — add a value to the set
 * POST /api/hazelcast/set-contains  — check if value is in the set
 * POST /api/hazelcast/set-remove    — remove a value from the set
 * Body: { host, port?, username?, password?, clusterName?, timeout?, setName, value }
 */
async function handleHazelcastSetOp(
  request: Request,
  msgType: number,
  opName: string,
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  interface HazelcastSetRequest extends HazelcastRequest {
    setName: string;
    value: string;
  }

  let body: HazelcastSetRequest;
  try { body = await request.json() as HazelcastSetRequest; }
  catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { host, port = 5701, username = '', password = '', clusterName = 'dev', timeout = 12000, setName, value } = body;
  if (!host || !setName || value === undefined) {
    return new Response(JSON.stringify({ success: false, error: 'host, setName, and value are required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const result: { success: boolean; setName?: string; value?: string; result?: boolean; operation?: string; error?: string; rtt?: number } = {
    success: false, setName, value, operation: opName,
  };
  const startTime = Date.now();

  try {
    const socket = connect(`${host}:${port}`);
    await Promise.race([socket.opened, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout))]);
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    try {
      await writer.write(buildAuthFrame(clusterName, username, password, BigInt(1)));
      const authResp = await readFrame(reader, Math.min(timeout, 6000));
      if (authResp.length >= MIN_INITIAL_FRAME_SIZE) {
        const parsed = parseAuthResponse(framePayload(authResp));
        if (parsed.status !== AUTH_STATUS_AUTHENTICATED) {
          result.error = `Authentication failed: ${parsed.statusLabel}`;
          return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      }

      await writer.write(buildSetFrame(msgType, setName, value, BigInt(2)));
      const opResp = await readFrame(reader, Math.min(timeout, 6000));
      const payload = framePayload(opResp);
      // Response is a boolean (1 byte)
      result.result = payload.length > 0 && payload[0] !== 0;
      result.success = true;
    } finally {
      reader.releaseLock();
      writer.releaseLock();
    }
    socket.close();
  } catch (err) {
    result.error = err instanceof Error ? err.message : `Set ${opName} failed`;
  }

  result.rtt = Date.now() - startTime;
  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function handleHazelcastSetAdd(request: Request): Promise<Response> {
  return handleHazelcastSetOp(request, MSG_SET_ADD, 'add');
}

export async function handleHazelcastSetContains(request: Request): Promise<Response> {
  return handleHazelcastSetOp(request, MSG_SET_CONTAINS, 'contains');
}

export async function handleHazelcastSetRemove(request: Request): Promise<Response> {
  return handleHazelcastSetOp(request, MSG_SET_REMOVE, 'remove');
}


// ---- Topic helpers + handler ------------------------------------------


/** Build QUEUE_SIZE frame: name(string) */
function buildQueueSizeFrame(name: string, cid: bigint): Uint8Array {
  const nm = new TextEncoder().encode(name);
  const payload = new Uint8Array(4 + nm.length);
  new DataView(payload.buffer).setUint32(0, nm.length, true);
  payload.set(nm, 4);
  return buildFrame(MSG_QUEUE_SIZE, cid, -1, payload);
}

/** Build TOPIC_PUBLISH frame: name(string) + message(string) */
function buildTopicPublishFrame(name: string, message: string, cid: bigint): Uint8Array {
  const enc = new TextEncoder();
  const nm = enc.encode(name);
  const mg = enc.encode(message);
  const len = (4 + nm.length) + (4 + mg.length);
  const payload = new Uint8Array(len);
  const view = new DataView(payload.buffer);
  let off = 0;
  view.setUint32(off, nm.length, true); off += 4;
  payload.set(nm, off);                 off += nm.length;
  view.setUint32(off, mg.length, true); off += 4;
  payload.set(mg, off);
  return buildFrame(MSG_TOPIC_PUBLISH, cid, -1, payload);
}


interface HzSession {
  socket: ReturnType<typeof connect>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  reader: ReadableStreamDefaultReader<Uint8Array>;
}

async function hazelcastConnect(
  host: string, port: number,
  username: string, password: string,
  clusterName: string, timeout: number,
): Promise<{ session: HzSession } | { error: string }> {
  const socket = connect(`${host}:${port}`);
  await Promise.race([
    socket.opened,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout)),
  ]);
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  await writer.write(buildAuthFrame(clusterName, username, password, BigInt(1)));
  const authResp = await readFrame(reader, Math.min(timeout, 6000));
  if (authResp.length >= MIN_INITIAL_FRAME_SIZE) {
    const parsed = parseAuthResponse(framePayload(authResp));
    if (parsed.status !== AUTH_STATUS_AUTHENTICATED) {
      reader.releaseLock(); writer.releaseLock(); socket.close();
      return { error: `Authentication failed: ${parsed.statusLabel}` };
    }
  }
  return { session: { socket, writer, reader } };
}

export async function handleHazelcastTopicPublish(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  interface TopicPublishReq extends HazelcastRequest { topicName: string; message: string; }
  let body: TopicPublishReq;
  try { body = await request.json() as TopicPublishReq; }
  catch { return new Response(JSON.stringify({ success: false, error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { host, port = 5701, username = '', password = '', clusterName = 'dev', timeout = 12000, topicName, message } = body;
  if (!host || !topicName || message === undefined || message === null) {
    return new Response(JSON.stringify({ success: false, error: 'host, topicName, and message are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const startTime = Date.now();
  const result: Record<string, unknown> = { success: false, topicName, message };
  try {
    const conn = await hazelcastConnect(host, port, username, password, clusterName, timeout);
    if ('error' in conn) { result.error = conn.error; return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    const { socket, writer, reader } = conn.session;
    try {
      await writer.write(buildTopicPublishFrame(topicName, message, BigInt(2)));
      const pubResp = await readFrame(reader, Math.min(timeout, 6000));
      result.success = pubResp.length >= MIN_INITIAL_FRAME_SIZE;
      if (!result.success) result.error = 'No ack received';
    } finally { reader.releaseLock(); writer.releaseLock(); }
    socket.close();
  } catch (err) { result.error = err instanceof Error ? err.message : 'Operation failed'; }
  result.rtt = Date.now() - startTime;
  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

