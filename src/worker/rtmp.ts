/**
 * RTMP (Real-Time Messaging Protocol) Implementation
 *
 * Implements RTMP connectivity testing, stream publishing, and stream playing
 * over raw TCP using the full RTMP protocol including:
 *   - Handshake (C0/C1/S0/S1/S2/C2)
 *   - AMF0 command encoding/decoding
 *   - RTMP chunk framing
 *   - connect, createStream, publish, play commands
 *
 * Protocol Flow:
 * 1. Client sends C0 (1 byte: version 0x03) + C1 (1536 bytes: timestamp + zero + random)
 * 2. Server sends S0 (1 byte: version) + S1 (1536 bytes) + S2 (1536 bytes: echo of C1)
 * 3. Client sends C2 (1536 bytes: echo of S1)
 * 4. After handshake: RTMP chunk-framed AMF0 commands
 *
 * RTMP Chunk Format:
 *   Basic Header (1-3 bytes): chunk stream ID + fmt
 *   Message Header (0-11 bytes depending on fmt)
 *   Extended Timestamp (0 or 4 bytes)
 *   Payload
 *
 * AMF0 Types used here:
 *   0x00 = Number (8 bytes IEEE 754 double)
 *   0x01 = Boolean (1 byte)
 *   0x02 = String (2-byte length prefix + UTF-8)
 *   0x03 = Object (key-value pairs ending with 0x00 0x00 0x09)
 *   0x05 = Null
 *   0x06 = Undefined
 *   0x08 = ECMA Array (4-byte count + key-value pairs ending with 0x00 0x00 0x09)
 *   0x0A = Strict Array (4-byte count + sequential typed values)
 *   0x0C = Long String (4-byte length prefix + UTF-8)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const RTMP_VERSION = 0x03;
const HANDSHAKE_SIZE = 1536;

// RTMP message types
const MSG_SET_CHUNK_SIZE   = 1;
const MSG_ACK              = 3;
const MSG_USER_CONTROL     = 4;
const MSG_WINDOW_ACK_SIZE  = 5;
const MSG_SET_PEER_BW      = 6;
const MSG_AUDIO            = 8;
const MSG_VIDEO            = 9;
const MSG_AMF3_CMD         = 17;
const MSG_AMF0_DATA        = 18;
const MSG_AMF0_CMD         = 20;

// Standard RTMP chunk stream IDs
const CSID_PROTOCOL  = 2;   // Protocol control messages
const CSID_CMD       = 3;   // AMF command channel
const CSID_DATA      = 4;   // Audio/video/data

// RTMP default chunk size (before negotiation)
let remoteChunkSize = 128;

// ─── AMF0 Encoding ────────────────────────────────────────────────────────────

function amf0EncodeNumber(value: number): Uint8Array {
  const buf = new Uint8Array(9);
  buf[0] = 0x00; // AMF0 Number type
  const view = new DataView(buf.buffer);
  view.setFloat64(1, value, false); // big-endian IEEE 754
  return buf;
}

function amf0EncodeBoolean(value: boolean): Uint8Array {
  return new Uint8Array([0x01, value ? 0x01 : 0x00]);
}

function amf0EncodeString(value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  const buf = new Uint8Array(3 + encoded.length);
  buf[0] = 0x02; // AMF0 String type
  const view = new DataView(buf.buffer);
  view.setUint16(1, encoded.length, false);
  buf.set(encoded, 3);
  return buf;
}

function amf0EncodeNull(): Uint8Array {
  return new Uint8Array([0x05]);
}

/** Encode a plain key for an AMF0 object (no type byte, just length-prefixed string) */
function amf0EncodeKey(key: string): Uint8Array {
  const encoded = new TextEncoder().encode(key);
  const buf = new Uint8Array(2 + encoded.length);
  const view = new DataView(buf.buffer);
  view.setUint16(0, encoded.length, false);
  buf.set(encoded, 2);
  return buf;
}

// AMF0Value: recursive type for AMF0 encoded values.
// Using interface + type alias mutual reference (both must be declared in the same scope).
// TypeScript allows this pattern as interfaces are hoisted.
type AMF0Value = string | number | boolean | null | AMF0Value[] | { [key: string]: AMF0Value };

function amf0EncodeValue(value: AMF0Value): Uint8Array {
  if (value === null || value === undefined) return amf0EncodeNull();
  if (typeof value === 'number') return amf0EncodeNumber(value);
  if (typeof value === 'boolean') return amf0EncodeBoolean(value);
  if (typeof value === 'string') return amf0EncodeString(value);
  if (Array.isArray(value)) return amf0EncodeStrictArray(value);
  if (typeof value === 'object') return amf0EncodeObject(value);
  return amf0EncodeNull();
}

function amf0EncodeObject(obj: Record<string, AMF0Value>): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0x03])]; // Object type marker
  for (const [key, val] of Object.entries(obj)) {
    parts.push(amf0EncodeKey(key));
    parts.push(amf0EncodeValue(val));
  }
  // Object end marker: 0x00 0x00 0x09
  parts.push(new Uint8Array([0x00, 0x00, 0x09]));
  return concatBuffers(parts);
}

function amf0EncodeStrictArray(arr: AMF0Value[]): Uint8Array {
  const header = new Uint8Array(5);
  header[0] = 0x0A; // Strict Array type marker
  const view = new DataView(header.buffer);
  view.setUint32(1, arr.length, false);
  const parts: Uint8Array[] = [header];
  for (const item of arr) {
    parts.push(amf0EncodeValue(item));
  }
  return concatBuffers(parts);
}

function concatBuffers(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

// ─── AMF0 Decoding ────────────────────────────────────────────────────────────

interface AMF0Decoded {
  value: AMF0Value;
  bytesRead: number;
}

function amf0Decode(data: Uint8Array, offset = 0): AMF0Decoded {
  const type = data[offset];
  switch (type) {
    case 0x00: { // Number
      const view = new DataView(data.buffer, data.byteOffset + offset + 1);
      return { value: view.getFloat64(0, false), bytesRead: 9 };
    }
    case 0x01: { // Boolean
      return { value: data[offset + 1] !== 0, bytesRead: 2 };
    }
    case 0x02: { // String
      const view = new DataView(data.buffer, data.byteOffset + offset + 1);
      const len = view.getUint16(0, false);
      const str = new TextDecoder().decode(data.slice(offset + 3, offset + 3 + len));
      return { value: str, bytesRead: 3 + len };
    }
    case 0x03: { // Object
      const obj: Record<string, AMF0Value> = {};
      let pos = offset + 1;
      while (pos + 2 < data.length) {
        // Check for end marker (0x00 0x00 0x09)
        if (data[pos] === 0x00 && data[pos + 1] === 0x00 && data[pos + 2] === 0x09) {
          pos += 3;
          break;
        }
        const keyView = new DataView(data.buffer, data.byteOffset + pos);
        const keyLen = keyView.getUint16(0, false);
        const key = new TextDecoder().decode(data.slice(pos + 2, pos + 2 + keyLen));
        pos += 2 + keyLen;
        const decoded = amf0Decode(data, pos);
        obj[key] = decoded.value;
        pos += decoded.bytesRead;
      }
      return { value: obj, bytesRead: pos - offset };
    }
    case 0x05: { // Null
      return { value: null, bytesRead: 1 };
    }
    case 0x06: { // Undefined
      return { value: null, bytesRead: 1 };
    }
    case 0x08: { // ECMA Array
      const obj: Record<string, AMF0Value> = {};
      let pos = offset + 5; // skip type + 4-byte count
      while (pos + 2 < data.length) {
        // Check for end marker (0x00 0x00 0x09)
        if (data[pos] === 0x00 && data[pos + 1] === 0x00 && data[pos + 2] === 0x09) {
          pos += 3;
          break;
        }
        const keyView = new DataView(data.buffer, data.byteOffset + pos);
        const keyLen = keyView.getUint16(0, false);
        const key = new TextDecoder().decode(data.slice(pos + 2, pos + 2 + keyLen));
        pos += 2 + keyLen;
        const decoded = amf0Decode(data, pos);
        obj[key] = decoded.value;
        pos += decoded.bytesRead;
      }
      return { value: obj, bytesRead: pos - offset };
    }
    case 0x0A: { // Strict Array
      const view = new DataView(data.buffer, data.byteOffset + offset + 1);
      const count = view.getUint32(0, false);
      const arr: AMF0Value[] = [];
      let pos = offset + 5; // skip type + 4-byte count
      for (let i = 0; i < count && pos < data.length; i++) {
        const decoded = amf0Decode(data, pos);
        arr.push(decoded.value);
        pos += decoded.bytesRead;
      }
      return { value: arr, bytesRead: pos - offset };
    }
    case 0x0C: { // Long String (4-byte length prefix)
      const view = new DataView(data.buffer, data.byteOffset + offset + 1);
      const len = view.getUint32(0, false);
      const str = new TextDecoder().decode(data.slice(offset + 5, offset + 5 + len));
      return { value: str, bytesRead: 5 + len };
    }
    default:
      return { value: null, bytesRead: 1 };
  }
}

/** Decode a sequence of AMF0 values from a buffer */
function amf0DecodeAll(data: Uint8Array): AMF0Value[] {
  const values: AMF0Value[] = [];
  let offset = 0;
  while (offset < data.length) {
    const { value, bytesRead } = amf0Decode(data, offset);
    values.push(value);
    offset += bytesRead;
    if (bytesRead === 0) break; // safety
  }
  return values;
}

// ─── RTMP Chunk Framing ───────────────────────────────────────────────────────

interface RTMPMessage {
  csid: number;
  timestamp: number;
  typeId: number;
  streamId: number;
  payload: Uint8Array;
}

/**
 * Encode an RTMP message as a sequence of chunks (fmt=0 for first, fmt=3 for continuation)
 * Uses a fixed chunk size of 128 bytes to match RTMP default.
 */
function encodeChunks(msg: RTMPMessage, chunkSize = 128): Uint8Array {
  const { csid, timestamp, typeId, streamId, payload } = msg;

  // Basic header for csid <= 63: 1 byte = (fmt << 6) | csid
  // For fmt=0 (full header): 11-byte message header
  const msgHeader = new Uint8Array(11);
  const mhView = new DataView(msgHeader.buffer);
  // Timestamp: 3 bytes big-endian (capped at 0xFFFFFF; extended timestamp not used here)
  const ts = Math.min(timestamp, 0xFFFFFF);
  mhView.setUint8(0, (ts >> 16) & 0xFF);
  mhView.setUint8(1, (ts >> 8) & 0xFF);
  mhView.setUint8(2, ts & 0xFF);
  // Message length: 3 bytes
  mhView.setUint8(3, (payload.length >> 16) & 0xFF);
  mhView.setUint8(4, (payload.length >> 8) & 0xFF);
  mhView.setUint8(5, payload.length & 0xFF);
  // Message type ID: 1 byte
  mhView.setUint8(6, typeId);
  // Message stream ID: 4 bytes little-endian
  mhView.setUint32(7, streamId, true);

  const chunks: Uint8Array[] = [];
  let offset = 0;
  let first = true;

  while (offset < payload.length || first) {
    const end = Math.min(offset + chunkSize, payload.length);
    const chunkPayload = payload.slice(offset, end);

    if (first) {
      const basicHeader = new Uint8Array([csid & 0x3F]); // fmt=0, csid
      chunks.push(basicHeader);
      chunks.push(msgHeader);
    } else {
      const basicHeader = new Uint8Array([0xC0 | (csid & 0x3F)]); // fmt=3, csid
      chunks.push(basicHeader);
    }

    chunks.push(chunkPayload);
    offset = end;
    first = false;

    if (offset >= payload.length) break;
  }

  return concatBuffers(chunks);
}

/**
 * Build an AMF0 command message payload
 */
function buildAMF0Command(name: string, txId: number, ...args: AMF0Value[]): Uint8Array {
  const parts: Uint8Array[] = [
    amf0EncodeString(name),
    amf0EncodeNumber(txId),
  ];
  for (const arg of args) {
    parts.push(amf0EncodeValue(arg));
  }
  return concatBuffers(parts);
}

// ─── Socket I/O Helpers ───────────────────────────────────────────────────────

async function readExact(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  length: number
): Promise<Uint8Array> {
  const buffer = new Uint8Array(length);
  let offset = 0;
  while (offset < length) {
    const { value, done } = await reader.read();
    if (done || !value) throw new Error('Connection closed while reading');
    const toCopy = Math.min(length - offset, value.length);
    buffer.set(value.subarray(0, toCopy), offset);
    offset += toCopy;
  }
  return buffer;
}

/** Read incoming RTMP chunks and reassemble a complete message */
async function readRTMPMessage(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<RTMPMessage> {
  // Read chunks until a complete message is assembled
  // Track per-CSID state for chunk header continuation (fmt 1/2/3)
  let csid = 0;
  let fmt = 0;
  let timestamp = 0;
  let msgLength = 0;
  let typeId = 0;
  let streamId = 0;

  // Read basic header (byte 0)
  const bh = await readExact(reader, 1);
  fmt = (bh[0] >> 6) & 0x3;
  csid = bh[0] & 0x3F;

  if (csid === 0) {
    // 2-byte basic header
    const bh2 = await readExact(reader, 1);
    csid = bh2[0] + 64;
  } else if (csid === 1) {
    // 3-byte basic header
    const bh3 = await readExact(reader, 2);
    csid = (bh3[1] * 256 + bh3[0]) + 64;
  }

  // Read message header based on fmt
  if (fmt === 0) {
    const mh = await readExact(reader, 11);
    const mhv = new DataView(mh.buffer);
    timestamp = (mhv.getUint8(0) << 16) | (mhv.getUint8(1) << 8) | mhv.getUint8(2);
    msgLength = (mhv.getUint8(3) << 16) | (mhv.getUint8(4) << 8) | mhv.getUint8(5);
    typeId = mhv.getUint8(6);
    streamId = mhv.getUint32(7, true);
    if (timestamp === 0xFFFFFF) {
      await readExact(reader, 4); // extended timestamp (skip)
    }
  } else if (fmt === 1) {
    const mh = await readExact(reader, 7);
    const mhv = new DataView(mh.buffer);
    timestamp = (mhv.getUint8(0) << 16) | (mhv.getUint8(1) << 8) | mhv.getUint8(2);
    msgLength = (mhv.getUint8(3) << 16) | (mhv.getUint8(4) << 8) | mhv.getUint8(5);
    typeId = mhv.getUint8(6);
  } else if (fmt === 2) {
    const mh = await readExact(reader, 3);
    const mhv = new DataView(mh.buffer);
    timestamp = (mhv.getUint8(0) << 16) | (mhv.getUint8(1) << 8) | mhv.getUint8(2);
  }
  // fmt === 3: no header, reuse previous values (simplified: use msgLength from previous)

  // Accumulate payload across chunks
  const payloadParts: Uint8Array[] = [];
  let payloadRead = 0;

  while (payloadRead < msgLength) {
    const toRead = Math.min(remoteChunkSize, msgLength - payloadRead);
    const chunk = await readExact(reader, toRead);
    payloadParts.push(chunk);
    payloadRead += toRead;

    if (payloadRead < msgLength) {
      // Read continuation chunk header (fmt=3, 1 byte basic header)
      const contBh = await readExact(reader, 1);
      const contFmt = (contBh[0] >> 6) & 0x3;
      // For fmt=3, no additional header bytes
      if (contFmt !== 3) {
        // Unexpected: fmt should be 3 for continuation
        // Re-parse would be complex; treat as fmt=3 for simplicity
      }
    }
  }

  return {
    csid,
    timestamp,
    typeId,
    streamId,
    payload: concatBuffers(payloadParts),
  };
}

/** Parse AMF0 response command fields from a message payload.
 *  AMF3 command messages (typeId 17) have a leading 0x00 byte before the AMF0 data. */
function parseAMF0Response(payload: Uint8Array, typeId: number = MSG_AMF0_CMD): { name: string; txId: number; args: AMF0Value[] } {
  // AMF3 command messages prefix the payload with a single 0x00 byte
  const data = typeId === MSG_AMF3_CMD ? payload.subarray(1) : payload;
  const values = amf0DecodeAll(data);
  const name = (values[0] as string) || '';
  const txId = (values[1] as number) || 0;
  const args = values.slice(2);
  return { name, txId, args };
}

// ─── RTMP Connect ─────────────────────────────────────────────────────────────

/**
 * Perform full RTMP handshake + connect command
 * Returns reader/writer and the server's _result to the connect command
 */
async function rtmpHandshakeAndConnect(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  host: string,
  port: number,
  app: string
): Promise<{ connectResult: AMF0Value[] }> {
  // ── Handshake ──
  const c0c1 = new Uint8Array(1 + HANDSHAKE_SIZE);
  c0c1[0] = RTMP_VERSION;
  const c1View = new DataView(c0c1.buffer, 1);
  const clientTime = Date.now() & 0xFFFFFFFF;
  c1View.setUint32(0, clientTime, false);
  c1View.setUint32(4, 0, false);
  for (let i = 9; i < 1 + HANDSHAKE_SIZE; i++) {
    c0c1[i] = Math.floor(Math.random() * 256);
  }
  await writer.write(c0c1);

  const s0 = await readExact(reader, 1);
  if (s0[0] !== RTMP_VERSION) {
    throw new Error(`Unexpected RTMP version: ${s0[0]}`);
  }
  const s1 = await readExact(reader, HANDSHAKE_SIZE);
  const s2 = await readExact(reader, HANDSHAKE_SIZE);
  void s2; // S2 is an echo of C1 -- we don't verify here

  // Send C2 (echo of S1)
  const c2 = new Uint8Array(HANDSHAKE_SIZE);
  c2.set(s1.subarray(0, 4), 0);
  const c2View = new DataView(c2.buffer);
  c2View.setUint32(4, Date.now() & 0xFFFFFFFF, false);
  c2.set(s1.subarray(8), 8);
  await writer.write(c2);

  // ── Protocol control messages ──
  // Window Acknowledgement Size: 2500000
  const windowAck = new Uint8Array(4);
  new DataView(windowAck.buffer).setUint32(0, 2500000, false);
  await writer.write(encodeChunks({
    csid: CSID_PROTOCOL, timestamp: 0, typeId: MSG_WINDOW_ACK_SIZE, streamId: 0, payload: windowAck,
  }));

  // ── connect command ──
  const connectArgs: Record<string, AMF0Value> = {
    app,
    type: 'nonprivate',
    flashVer: 'FMLE/3.0 (compatible; portofcall)',
    tcUrl: `rtmp://${host}:${port}/${app}`,
  };
  const connectPayload = buildAMF0Command('connect', 1, connectArgs);
  await writer.write(encodeChunks({
    csid: CSID_CMD, timestamp: 0, typeId: MSG_AMF0_CMD, streamId: 0, payload: connectPayload,
  }));

  // ── Read server responses until we get _result for txId=1 ──
  for (let i = 0; i < 20; i++) {
    const msg = await readRTMPMessage(reader);

    if (msg.typeId === MSG_SET_CHUNK_SIZE) {
      const view = new DataView(msg.payload.buffer);
      remoteChunkSize = view.getUint32(0, false) & 0x7FFFFFFF;
      continue;
    }
    if (msg.typeId === MSG_WINDOW_ACK_SIZE || msg.typeId === MSG_SET_PEER_BW ||
        msg.typeId === MSG_USER_CONTROL || msg.typeId === MSG_ACK) {
      continue;
    }
    if (msg.typeId === MSG_AMF0_CMD || msg.typeId === MSG_AMF3_CMD) {
      const resp = parseAMF0Response(msg.payload, msg.typeId);
      if (resp.name === '_result' && resp.txId === 1) {
        return { connectResult: resp.args };
      }
      if (resp.name === '_error') {
        const errInfo = resp.args[1] as Record<string, AMF0Value> | null;
        const errMsg = errInfo ? (errInfo['description'] as string) : 'Unknown error';
        throw new Error(`RTMP connect error: ${errMsg}`);
      }
    }
  }
  throw new Error('Did not receive _result for connect command');
}

/** Send createStream and return the stream ID */
async function rtmpCreateStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  txId: number
): Promise<number> {
  const payload = buildAMF0Command('createStream', txId, null);
  await writer.write(encodeChunks({
    csid: CSID_CMD, timestamp: 0, typeId: MSG_AMF0_CMD, streamId: 0, payload,
  }));

  for (let i = 0; i < 20; i++) {
    const msg = await readRTMPMessage(reader);
    if (msg.typeId === MSG_SET_CHUNK_SIZE) {
      const view = new DataView(msg.payload.buffer);
      remoteChunkSize = view.getUint32(0, false) & 0x7FFFFFFF;
      continue;
    }
    if (msg.typeId === MSG_WINDOW_ACK_SIZE || msg.typeId === MSG_SET_PEER_BW ||
        msg.typeId === MSG_USER_CONTROL || msg.typeId === MSG_ACK) {
      continue;
    }
    if (msg.typeId === MSG_AMF0_CMD || msg.typeId === MSG_AMF3_CMD) {
      const resp = parseAMF0Response(msg.payload, msg.typeId);
      if (resp.name === '_result' && resp.txId === txId) {
        const streamId = resp.args[1];
        if (typeof streamId === 'number') return streamId;
        throw new Error(`createStream returned non-numeric stream ID: ${JSON.stringify(streamId)}`);
      }
      if (resp.name === '_error') {
        throw new Error(`createStream failed: ${JSON.stringify(resp.args)}`);
      }
    }
  }
  throw new Error('Did not receive _result for createStream');
}

// ─── Handle RTMP Connect (handshake test) ─────────────────────────────────────

export async function handleRTMPConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      app?: string;
      timeout?: number;
    };

    const { host, port = 1935, app = 'live', timeout = 10000 } = body;

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
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const connectionPromise = (async () => {
      remoteChunkSize = 128; // reset per-connection
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const connectTime = Date.now() - startTime;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        const { connectResult } = await rtmpHandshakeAndConnect(reader, writer, host, port, app);
        const rtt = Date.now() - startTime;

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return {
          success: true,
          host,
          port,
          app,
          connectTime,
          rtt,
          handshakeComplete: true,
          connectResult,
        };
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        throw error;
      }
    })();

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ─── Handle RTMP Publish ──────────────────────────────────────────────────────

export async function handleRTMPPublish(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      app?: string;
      streamKey: string;
      metaData?: Record<string, AMF0Value>;
      timeout?: number;
    };

    const { host, port = 1935, app = 'live', streamKey, metaData, timeout = 15000 } = body;

    if (!host || !streamKey) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameters: host, streamKey',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Publish timeout')), timeout)
    );

    const publishPromise = (async () => {
      remoteChunkSize = 128;
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Step 1: Handshake + connect
        const { connectResult } = await rtmpHandshakeAndConnect(reader, writer, host, port, app);

        // Step 2: createStream
        const streamId = await rtmpCreateStream(reader, writer, 2);

        // Step 3: publish command
        // publish(txId=0, null, streamKey, publishType)
        const publishPayload = buildAMF0Command('publish', 0, null, streamKey, 'live');
        await writer.write(encodeChunks({
          csid: CSID_CMD,
          timestamp: 0,
          typeId: MSG_AMF0_CMD,
          streamId,
          payload: publishPayload,
        }));

        // Step 4: Read server response (onStatus with code "NetStream.Publish.Start")
        const serverResponses: { name: string; info: AMF0Value }[] = [];
        let publishStarted = false;

        for (let i = 0; i < 20 && !publishStarted; i++) {
          const msg = await readRTMPMessage(reader);
          if (msg.typeId === MSG_SET_CHUNK_SIZE) {
            const view = new DataView(msg.payload.buffer);
            remoteChunkSize = view.getUint32(0, false) & 0x7FFFFFFF;
            continue;
          }
          if (msg.typeId === MSG_WINDOW_ACK_SIZE || msg.typeId === MSG_SET_PEER_BW ||
              msg.typeId === MSG_USER_CONTROL || msg.typeId === MSG_ACK) {
            continue;
          }
          if (msg.typeId === MSG_AMF0_CMD || msg.typeId === MSG_AMF3_CMD) {
            const resp = parseAMF0Response(msg.payload, msg.typeId);
            serverResponses.push({ name: resp.name, info: resp.args[1] ?? null });

            if (resp.name === 'onStatus') {
              const info = resp.args[1] as Record<string, AMF0Value> | null;
              if (info) {
                const code = info['code'] as string;
                if (code === 'NetStream.Publish.Start') {
                  publishStarted = true;
                } else if (code && code.includes('.Error')) {
                  throw new Error(`Publish error: ${info['description'] ?? code}`);
                }
              }
            }
            if (resp.name === '_error') {
              throw new Error(`RTMP error: ${JSON.stringify(resp.args)}`);
            }
          }
        }

        // Step 5: Send @setDataFrame with onMetaData if provided
        if (metaData && Object.keys(metaData).length > 0) {
          const metaParts: Uint8Array[] = [
            amf0EncodeString('@setDataFrame'),
            amf0EncodeString('onMetaData'),
            amf0EncodeObject(metaData),
          ];
          const metaPayload = concatBuffers(metaParts);
          await writer.write(encodeChunks({
            csid: CSID_DATA,
            timestamp: 0,
            typeId: MSG_AMF0_DATA,
            streamId,
            payload: metaPayload,
          }));
        }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return {
          success: true,
          host,
          port,
          app,
          streamKey,
          streamId,
          publishStarted,
          connectResult,
          serverResponses,
        };
      } catch (error) {
        try { writer.releaseLock(); } catch (_) { /* ignore */ }
        try { reader.releaseLock(); } catch (_) { /* ignore */ }
        socket.close();
        throw error;
      }
    })();

    const result = await Promise.race([publishPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Publish failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ─── Handle RTMP Play ─────────────────────────────────────────────────────────

export async function handleRTMPPlay(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      app?: string;
      streamName: string;
      timeout?: number;
    };

    const { host, port = 1935, app = 'live', streamName, timeout = 15000 } = body;

    if (!host || !streamName) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameters: host, streamName',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Play timeout')), timeout)
    );

    const playPromise = (async () => {
      remoteChunkSize = 128;
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Step 1: Handshake + connect
        const { connectResult } = await rtmpHandshakeAndConnect(reader, writer, host, port, app);

        // Step 2: Set buffer length user control message (optional but good practice)
        // User Control: SetBufferLength (event 3), stream 1, buffer 3000ms
        const bufLen = new Uint8Array(10);
        const bufView = new DataView(bufLen.buffer);
        bufView.setUint16(0, 3, false);    // event type: SetBufferLength
        bufView.setUint32(2, 1, false);    // stream ID
        bufView.setUint32(6, 3000, false); // buffer length in ms
        await writer.write(encodeChunks({
          csid: CSID_PROTOCOL, timestamp: 0, typeId: MSG_USER_CONTROL, streamId: 0, payload: bufLen,
        }));

        // Step 3: createStream
        const streamId = await rtmpCreateStream(reader, writer, 2);

        // Step 4: play command
        // play(txId=0, null, streamName, start=-1 for live)
        const playPayload = buildAMF0Command('play', 0, null, streamName, -1);
        await writer.write(encodeChunks({
          csid: CSID_CMD,
          timestamp: 0,
          typeId: MSG_AMF0_CMD,
          streamId,
          payload: playPayload,
        }));

        // Step 5: Read server responses
        // Expect: onStatus NetStream.Play.Start, |RtmpSampleAccess, onMetaData
        const serverResponses: { name: string; txId: number; info: AMF0Value }[] = [];
        let playStarted = false;
        let streamMetaData: AMF0Value = null;

        for (let i = 0; i < 30 && !playStarted; i++) {
          const msg = await readRTMPMessage(reader);

          if (msg.typeId === MSG_SET_CHUNK_SIZE) {
            const view = new DataView(msg.payload.buffer);
            remoteChunkSize = view.getUint32(0, false) & 0x7FFFFFFF;
            continue;
          }
          if (msg.typeId === MSG_WINDOW_ACK_SIZE || msg.typeId === MSG_SET_PEER_BW ||
              msg.typeId === MSG_USER_CONTROL || msg.typeId === MSG_ACK) {
            continue;
          }
          if (msg.typeId === MSG_AMF0_CMD || msg.typeId === MSG_AMF3_CMD) {
            const resp = parseAMF0Response(msg.payload, msg.typeId);
            serverResponses.push({ name: resp.name, txId: resp.txId, info: resp.args[1] ?? null });

            if (resp.name === 'onStatus') {
              const info = resp.args[1] as Record<string, AMF0Value> | null;
              if (info) {
                const code = info['code'] as string;
                if (code === 'NetStream.Play.Start' || code === 'NetStream.Play.Reset') {
                  playStarted = true;
                } else if (code && code.includes('.Error')) {
                  throw new Error(`Play error: ${info['description'] ?? code}`);
                } else if (code === 'NetStream.Play.StreamNotFound') {
                  throw new Error(`Stream not found: ${streamName}`);
                }
              }
            }
            if (resp.name === '_error') {
              throw new Error(`RTMP error: ${JSON.stringify(resp.args)}`);
            }
          }
          if (msg.typeId === MSG_AMF0_DATA) {
            // May contain |RtmpSampleAccess or onMetaData
            const values = amf0DecodeAll(msg.payload);
            const dataName = values[0] as string;
            if (dataName === 'onMetaData') {
              streamMetaData = values[1] ?? null;
            }
          }
          // Audio/video frames arriving means play is active
          if (msg.typeId === MSG_AUDIO || msg.typeId === MSG_VIDEO) {
            playStarted = true;
          }
        }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return {
          success: true,
          host,
          port,
          app,
          streamName,
          streamId,
          playStarted,
          connectResult,
          streamMetaData,
          serverResponses,
        };
      } catch (error) {
        try { writer.releaseLock(); } catch (_) { /* ignore */ }
        try { reader.releaseLock(); } catch (_) { /* ignore */ }
        socket.close();
        throw error;
      }
    })();

    const result = await Promise.race([playPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Play failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
