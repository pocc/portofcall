/**
 * Fluentd Forward Protocol Implementation
 *
 * Fluentd is a popular open-source log aggregation system. The Forward
 * protocol is its native transport, used for forwarding logs between
 * Fluentd/Fluent Bit instances over TCP (port 24224).
 *
 * Protocol: MessagePack-encoded arrays over TCP
 * Default port: 24224
 *
 * Message Types:
 *   Forward mode:  [tag, [[time, record], ...], options]
 *   Message mode:  [tag, time, record, options]
 *   PackedForward: [tag, msgpack-binary-stream, options]
 *
 * Acknowledgment (when chunk option is set):
 *   Server responds with: {"ack": "<chunk-id>"}
 *
 * Probe Strategy:
 *   1. Connect to port 24224
 *   2. Send a minimal forward message with a chunk ID for acknowledgment
 *   3. Read the ack response to confirm it's a Fluentd-compatible server
 *   4. Parse the response for protocol version info
 *
 * Security: Read-only probe with minimal test message. No sensitive data sent.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// ============================================================
// Minimal MessagePack Encoder (subset needed for Fluentd probe)
// ============================================================

function encodeMsgpackString(str: string): Uint8Array {
  const encoded = new TextEncoder().encode(str);
  const len = encoded.length;

  if (len < 32) {
    // fixstr: 0xa0 | len
    const buf = new Uint8Array(1 + len);
    buf[0] = 0xa0 | len;
    buf.set(encoded, 1);
    return buf;
  } else if (len < 256) {
    // str 8: 0xd9
    const buf = new Uint8Array(2 + len);
    buf[0] = 0xd9;
    buf[1] = len;
    buf.set(encoded, 2);
    return buf;
  } else {
    // str 16: 0xda
    const buf = new Uint8Array(3 + len);
    buf[0] = 0xda;
    buf[1] = (len >> 8) & 0xff;
    buf[2] = len & 0xff;
    buf.set(encoded, 3);
    return buf;
  }
}

function encodeMsgpackUint32(val: number): Uint8Array {
  if (val < 128) {
    // positive fixint
    return new Uint8Array([val]);
  } else if (val < 256) {
    // uint 8
    return new Uint8Array([0xcc, val]);
  } else if (val < 65536) {
    // uint 16
    return new Uint8Array([0xcd, (val >> 8) & 0xff, val & 0xff]);
  } else {
    // uint 32
    return new Uint8Array([0xce, (val >> 24) & 0xff, (val >> 16) & 0xff, (val >> 8) & 0xff, val & 0xff]);
  }
}

function encodeMsgpackMap(entries: [string, string | number][]): Uint8Array {
  const count = entries.length;
  const parts: Uint8Array[] = [];

  if (count < 16) {
    parts.push(new Uint8Array([0x80 | count])); // fixmap
  } else {
    parts.push(new Uint8Array([0xde, (count >> 8) & 0xff, count & 0xff])); // map 16
  }

  for (const [key, value] of entries) {
    parts.push(encodeMsgpackString(key));
    if (typeof value === 'string') {
      parts.push(encodeMsgpackString(value));
    } else {
      parts.push(encodeMsgpackUint32(value));
    }
  }

  return concatUint8Arrays(parts);
}

function encodeMsgpackArray(items: Uint8Array[]): Uint8Array {
  const count = items.length;
  const parts: Uint8Array[] = [];

  if (count < 16) {
    parts.push(new Uint8Array([0x90 | count])); // fixarray
  } else {
    parts.push(new Uint8Array([0xdc, (count >> 8) & 0xff, count & 0xff])); // array 16
  }

  parts.push(...items);
  return concatUint8Arrays(parts);
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// ============================================================
// Minimal MessagePack Decoder (subset needed for ack parsing)
// ============================================================

interface DecodeResult {
  value: unknown;
  bytesRead: number;
}

function decodeMsgpack(data: Uint8Array, offset = 0): DecodeResult {
  if (offset >= data.length) {
    return { value: null, bytesRead: 0 };
  }

  const byte = data[offset];

  // positive fixint (0x00 - 0x7f)
  if (byte < 0x80) {
    return { value: byte, bytesRead: 1 };
  }

  // negative fixint (0xe0 - 0xff)
  if (byte >= 0xe0) {
    return { value: byte - 256, bytesRead: 1 };
  }

  // fixmap (0x80 - 0x8f)
  if ((byte & 0xf0) === 0x80) {
    return decodeMap(data, offset + 1, byte & 0x0f);
  }

  // fixarray (0x90 - 0x9f)
  if ((byte & 0xf0) === 0x90) {
    return decodeArray(data, offset + 1, byte & 0x0f);
  }

  // fixstr (0xa0 - 0xbf)
  if ((byte & 0xe0) === 0xa0) {
    const len = byte & 0x1f;
    const str = new TextDecoder().decode(data.subarray(offset + 1, offset + 1 + len));
    return { value: str, bytesRead: 1 + len };
  }

  switch (byte) {
    case 0xc0: return { value: null, bytesRead: 1 }; // nil
    case 0xc2: return { value: false, bytesRead: 1 }; // false
    case 0xc3: return { value: true, bytesRead: 1 }; // true

    case 0xcc: return { value: data[offset + 1], bytesRead: 2 }; // uint 8
    case 0xcd: return { value: (data[offset + 1] << 8) | data[offset + 2], bytesRead: 3 }; // uint 16
    case 0xce: return { // uint 32
      value: ((data[offset + 1] << 24) | (data[offset + 2] << 16) | (data[offset + 3] << 8) | data[offset + 4]) >>> 0,
      bytesRead: 5,
    };

    case 0xd9: { // str 8
      const len = data[offset + 1];
      const str = new TextDecoder().decode(data.subarray(offset + 2, offset + 2 + len));
      return { value: str, bytesRead: 2 + len };
    }
    case 0xda: { // str 16
      const len = (data[offset + 1] << 8) | data[offset + 2];
      const str = new TextDecoder().decode(data.subarray(offset + 3, offset + 3 + len));
      return { value: str, bytesRead: 3 + len };
    }
    case 0xdb: { // str 32
      const len = ((data[offset + 1] << 24) | (data[offset + 2] << 16) | (data[offset + 3] << 8) | data[offset + 4]) >>> 0;
      const str = new TextDecoder().decode(data.subarray(offset + 5, offset + 5 + len));
      return { value: str, bytesRead: 5 + len };
    }

    case 0xde: { // map 16
      const count = (data[offset + 1] << 8) | data[offset + 2];
      const result = decodeMap(data, offset + 3, count);
      return { value: result.value, bytesRead: 3 + result.bytesRead - 0 };
    }

    case 0xdf: { // map 32
      const count = ((data[offset + 1] << 24) | (data[offset + 2] << 16) | (data[offset + 3] << 8) | data[offset + 4]) >>> 0;
      const result = decodeMap(data, offset + 5, count);
      return { value: result.value, bytesRead: 5 + result.bytesRead };
    }

    default:
      return { value: null, bytesRead: 1 };
  }
}

function decodeMap(data: Uint8Array, startOffset: number, count: number): DecodeResult {
  const map: Record<string, unknown> = {};
  let pos = startOffset;

  for (let i = 0; i < count; i++) {
    const keyResult = decodeMsgpack(data, pos);
    pos += keyResult.bytesRead;
    const valResult = decodeMsgpack(data, pos);
    pos += valResult.bytesRead;
    map[String(keyResult.value)] = valResult.value;
  }

  return { value: map, bytesRead: pos - startOffset };
}

function decodeArray(data: Uint8Array, startOffset: number, count: number): DecodeResult {
  const arr: unknown[] = [];
  let pos = startOffset;

  for (let i = 0; i < count; i++) {
    const result = decodeMsgpack(data, pos);
    pos += result.bytesRead;
    arr.push(result.value);
  }

  return { value: arr, bytesRead: pos - startOffset };
}

// ============================================================
// Fluentd Forward Protocol Handlers
// ============================================================

/**
 * Build a Fluentd forward-mode message with ack request.
 *
 * Format: [tag, [[timestamp, record]], {"chunk": chunkId}]
 */
function buildForwardMessage(tag: string, chunkId: string): Uint8Array {
  const timestamp = encodeMsgpackUint32(Math.floor(Date.now() / 1000));
  const record = encodeMsgpackMap([
    ['message', 'portofcall-probe'],
    ['source', 'portofcall'],
  ]);
  const entry = encodeMsgpackArray([timestamp, record]);
  const entries = encodeMsgpackArray([entry]);

  const options = encodeMsgpackMap([
    ['chunk', chunkId],
  ]);

  return encodeMsgpackArray([
    encodeMsgpackString(tag),
    entries,
    options,
  ]);
}

/**
 * Generate a random chunk ID for ack tracking
 */
function generateChunkId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * Read response from Fluentd server
 */
async function readFluentdResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const maxBytes = 8192;
  const deadline = Date.now() + timeoutMs;

  while (totalBytes < maxBytes) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    const timeoutPromise = new Promise<{ done: true; value: undefined }>((resolve) => {
      setTimeout(() => resolve({ done: true, value: undefined }), Math.min(remaining, 3000));
    });

    const result = await Promise.race([reader.read(), timeoutPromise]);
    if (result.done || !result.value) break;

    chunks.push(result.value);
    totalBytes += result.value.length;

    // Try to decode — if successful, we have a complete message
    const combined = concatUint8Arrays(chunks);
    try {
      const decoded = decodeMsgpack(combined);
      if (decoded.bytesRead > 0) break;
    } catch {
      // Incomplete, keep reading
    }
  }

  return concatUint8Arrays(chunks);
}

/**
 * Probe a Fluentd server by sending a minimal forward message
 */
export async function handleFluentdConnect(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as {
      host?: string;
      port?: number;
      tag?: string;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 24224;
    const tag = body.tag || 'portofcall.probe';
    const timeout = body.timeout || 10000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate tag format (dotted notation, alphanumeric + dots/hyphens/underscores)
    if (!/^[a-zA-Z0-9._-]+$/.test(tag) || tag.length > 128) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid tag format (alphanumeric, dots, hyphens, underscores; max 128 chars)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

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

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      const chunkId = generateChunkId();
      const message = buildForwardMessage(tag, chunkId);

      // Send the forward message
      await writer.write(message);

      // Read ack response
      let ackReceived = false;
      let ackChunkId: string | null = null;
      let responseData: Record<string, unknown> = {};

      try {
        const responseBytes = await readFluentdResponse(reader, Math.min(timeout, 5000));
        if (responseBytes.length > 0) {
          const decoded = decodeMsgpack(responseBytes);
          if (decoded.value && typeof decoded.value === 'object') {
            responseData = decoded.value as Record<string, unknown>;
            if ('ack' in responseData) {
              ackReceived = true;
              ackChunkId = String(responseData.ack);
            }
          }
        }
      } catch {
        // No ack — server may not support ack or connection was one-way
      }

      const rtt = Date.now() - startTime;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          rtt,
          tag,
          chunkId,
          ackReceived,
          ackChunkId,
          ackMatch: ackReceived && ackChunkId === chunkId,
          responseData: Object.keys(responseData).length > 0 ? responseData : null,
          messageSizeBytes: message.length,
          protocol: 'Fluentd Forward',
          message: ackReceived
            ? `Fluentd server acknowledged message in ${rtt}ms`
            : `Connected to Fluentd server in ${rtt}ms (no ack - server may not require acknowledgment)`,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Fluentd connection failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Send a test log entry to a Fluentd server
 */
export async function handleFluentdSend(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as {
      host?: string;
      port?: number;
      tag?: string;
      record?: Record<string, string>;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 24224;
    const tag = body.tag || 'portofcall.test';
    const timeout = body.timeout || 10000;
    const record = body.record || { message: 'Hello from Port of Call' };

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(tag) || tag.length > 128) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid tag format' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Limit record to reasonable size
    const recordEntries = Object.entries(record).slice(0, 20);
    const totalLength = recordEntries.reduce((sum, [k, v]) => sum + k.length + String(v).length, 0);
    if (totalLength > 8192) {
      return new Response(
        JSON.stringify({ success: false, error: 'Record too large (max ~8KB)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

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

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      const chunkId = generateChunkId();

      // Build message-mode payload: [tag, time, record, options]
      const timestamp = encodeMsgpackUint32(Math.floor(Date.now() / 1000));
      const recordMap = encodeMsgpackMap(
        recordEntries.map(([k, v]) => [k, String(v)] as [string, string])
      );
      const options = encodeMsgpackMap([['chunk', chunkId]]);

      const message = encodeMsgpackArray([
        encodeMsgpackString(tag),
        timestamp,
        recordMap,
        options,
      ]);

      await writer.write(message);

      // Read ack
      let ackReceived = false;
      try {
        const responseBytes = await readFluentdResponse(reader, Math.min(timeout, 5000));
        if (responseBytes.length > 0) {
          const decoded = decodeMsgpack(responseBytes);
          if (decoded.value && typeof decoded.value === 'object') {
            const resp = decoded.value as Record<string, unknown>;
            ackReceived = 'ack' in resp && String(resp.ack) === chunkId;
          }
        }
      } catch {
        // No ack
      }

      const rtt = Date.now() - startTime;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          rtt,
          tag,
          chunkId,
          ackReceived,
          recordKeys: recordEntries.map(([k]) => k),
          messageSizeBytes: message.length,
          protocol: 'Fluentd Forward',
          message: ackReceived
            ? `Log entry sent and acknowledged in ${rtt}ms`
            : `Log entry sent in ${rtt}ms (no ack received)`,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Fluentd send failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
