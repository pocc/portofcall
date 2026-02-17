/**
 * Hazelcast IMDG Client Protocol Implementation
 *
 * Hazelcast is an in-memory data grid (IMDG) platform for distributed caching,
 * computing, and messaging. It uses a binary open client protocol over TCP.
 *
 * Hazelcast Open Binary Client Protocol v2 frame format:
 *   [frame_length: uint32 LE] [flags: uint16 LE] [message_type: uint32 LE]
 *   [correlation_id: uint64 LE] [partition_id: int32 LE] [payload...]
 *
 * Frame flags:
 *   0x0080 = IS_FINAL        (last frame of a multi-frame message)
 *   0x2000 = BEGIN_FRAGMENT  (first frame)
 *   0x4000 = END_FRAGMENT    (last fragment)
 *   0x8000 = UNFRAGMENTED    (single-frame message)
 *   0xC000 = BEGIN + END     (common for single-packet messages)
 *
 * Key message types:
 *   0x00000 = PING
 *   0x000C8 = CLIENT_AUTHENTICATION
 *   0x00130 = MAP_SIZE
 *   0x00134 = MAP_GET
 *   0x00138 = MAP_PUT
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

// Frame header size (fixed 18 bytes)
const FRAME_HEADER_SIZE = 18;

// Frame flags
const FLAG_UNFRAGMENTED = 0xC000; // BEGIN_FRAGMENT | END_FRAGMENT

// Message type codes
const MSG_AUTHENTICATION = 0x000C8;
const MSG_PING           = 0x00000;
const MSG_MAP_SIZE       = 0x00130;
const MSG_MAP_GET        = 0x00134;

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
 * Build a Hazelcast frame.
 * Frame header: [frame_length 4][flags 2][message_type 4][correlation_id 8][partition_id 4]
 */
function buildFrame(
  messageType: number,
  correlationId: bigint,
  partitionId: number,
  payload: Uint8Array,
): Uint8Array {
  const totalLen = FRAME_HEADER_SIZE + payload.length;
  const buf  = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);

  view.setUint32(0, totalLen, true);            // frame_length
  view.setUint16(4, FLAG_UNFRAGMENTED, true);   // flags
  view.setUint32(6, messageType, true);         // message_type
  view.setBigUint64(10, correlationId, true);   // correlation_id
  view.setInt32(18 - 4, partitionId, true);     // partition_id (last 4 bytes of header)
  buf.set(payload, FRAME_HEADER_SIZE);

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
      if (total >= declared) return combined;
    }
  }
  return mergeChunks(chunks, total);
}

/** Parse the correlation ID from a frame */
function frameCorrelation(data: Uint8Array): bigint {
  if (data.length < 18) return BigInt(0);
  return new DataView(data.buffer, data.byteOffset).getBigUint64(10, true);
}

/** Parse message type from a frame */
function frameMessageType(data: Uint8Array): number {
  if (data.length < 10) return -1;
  return new DataView(data.buffer, data.byteOffset).getUint32(6, true);
}

/** Return payload slice (after 18-byte header) */
function framePayload(data: Uint8Array): Uint8Array {
  return data.slice(FRAME_HEADER_SIZE);
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
      if (pingResp.length >= FRAME_HEADER_SIZE || authResp.length >= FRAME_HEADER_SIZE) {
        result.isHazelcast = true;
      }

      if (authResp.length >= FRAME_HEADER_SIZE) {
        const correlation = frameCorrelation(authResp);
        if (correlation === BigInt(2) || authType === MSG_AUTHENTICATION || authResp.length > FRAME_HEADER_SIZE) {
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
      } else if (pingResp.length >= FRAME_HEADER_SIZE) {
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

      if (authResp.length >= FRAME_HEADER_SIZE) {
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

      if (sizeResp.length >= FRAME_HEADER_SIZE + 4) {
        const sizePayload = framePayload(sizeResp);
        if (sizePayload.length >= 4) {
          result.size = new DataView(sizePayload.buffer, sizePayload.byteOffset).getInt32(0, true);
        }
      }

      // Step 3: MAP_GET
      await writer.write(buildMapGetFrame(mapName, key, BigInt(3)));
      const getResp = await readFrame(reader, Math.min(timeout, 5000));

      if (getResp.length >= FRAME_HEADER_SIZE) {
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
