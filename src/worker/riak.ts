/**
 * Riak KV Protocol Buffers Binary Protocol Implementation
 *
 * Riak KV is a distributed NoSQL key-value database by Basho Technologies.
 * It uses a binary Protocol Buffers-based wire protocol over TCP port 8087.
 *
 * Message Format:
 * - Bytes 0-3:  Message length (uint32 big-endian, includes msg code but not length itself)
 * - Byte 4:     Message code (uint8)
 * - Bytes 5+:   Optional Protocol Buffers payload
 *
 * Key Message Codes:
 * - 1:  RpbPingReq      — Ping request (no payload)
 * - 2:  RpbPingResp     — Ping response (no payload)
 * - 7:  RpbGetServerInfoReq  — Server info request (no payload)
 * - 8:  RpbGetServerInfoResp — Server info response (protobuf with node/version)
 * - 9:  RpbGetReq       — Get key request
 * - 10: RpbGetResp      — Get key response
 * - 15: RpbListBucketsReq   — List buckets request
 * - 16: RpbListBucketsResp  — List buckets response
 *
 * Protocol Flow:
 * 1. Client connects to Riak on port 8087
 * 2. Client sends length-prefixed message
 * 3. Server responds with length-prefixed response
 * 4. Connection can be reused for multiple requests
 *
 * Use Cases:
 * - Verify Riak node connectivity and health
 * - Detect Riak version and node name
 * - Test PBC (Protocol Buffers Client) port accessibility
 * - Distributed systems monitoring
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// Riak PBC message codes
const MSG_PING_REQ = 1;
const MSG_PING_RESP = 2;
const MSG_GET_SERVER_INFO_REQ = 7;
const MSG_GET_SERVER_INFO_RESP = 8;
const MSG_GET_REQ = 9;
const MSG_GET_RESP = 10;
const MSG_PUT_REQ = 11;
const MSG_PUT_RESP = 12;
const MSG_ERROR_RESP = 0;

interface RiakRequest {
  host: string;
  port?: number;
  timeout?: number;
}

/**
 * Build a Riak PBC message: 4-byte length (big-endian) + 1-byte message code + optional payload
 */
function buildRiakMessage(msgCode: number, payload?: Uint8Array): Uint8Array {
  const payloadLen = payload ? payload.length : 0;
  const msgLen = 1 + payloadLen; // msg code + payload
  const packet = new Uint8Array(4 + msgLen);
  const view = new DataView(packet.buffer);

  view.setUint32(0, msgLen, false); // Length (big-endian, explicit)
  packet[4] = msgCode;

  if (payload && payloadLen > 0) {
    packet.set(payload, 5);
  }

  return packet;
}

/**
 * Read a complete Riak PBC response message.
 * Returns the message code and payload bytes.
 */
async function readRiakResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
): Promise<{ msgCode: number; payload: Uint8Array; rawLength: number }> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  // Read at least 5 bytes (4 length + 1 msg code)
  while (totalBytes < 5) {
    const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
    if (done || !value) break;
    chunks.push(value);
    totalBytes += value.length;
  }

  if (totalBytes < 5) {
    return { msgCode: -1, payload: new Uint8Array(0), rawLength: totalBytes };
  }

  // Combine initial chunks
  const headerBuf = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    headerBuf.set(chunk, offset);
    offset += chunk.length;
  }

  const view = new DataView(headerBuf.buffer);
  const msgLen = view.getUint32(0, false); // includes msg code (big-endian)
  const msgCode = headerBuf[4];
  const totalNeeded = 4 + msgLen;

  // Read remaining bytes if needed
  while (totalBytes < totalNeeded) {
    const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
    if (done || !value) break;
    chunks.push(value);
    totalBytes += value.length;
  }

  // Combine all chunks
  const fullBuf = new Uint8Array(totalBytes);
  offset = 0;
  for (const chunk of chunks) {
    fullBuf.set(chunk, offset);
    offset += chunk.length;
  }

  const payloadStart = 5;
  const payloadEnd = Math.min(totalBytes, totalNeeded);
  const payload = fullBuf.slice(payloadStart, payloadEnd);

  return { msgCode, payload, rawLength: totalBytes };
}

/**
 * Parse a simple protobuf-like response for RpbGetServerInfoResp.
 * The protobuf has: field 1 (string) = node, field 2 (string) = server_version
 * We do a minimal hand-parse since we can't import protobuf in Workers easily.
 */
function parseServerInfo(payload: Uint8Array): { node: string; serverVersion: string } {
  let node = '';
  let serverVersion = '';
  const decoder = new TextDecoder();

  let i = 0;
  while (i < payload.length) {
    const tag = payload[i];
    i++;

    const fieldNumber = tag >> 3;
    const wireType = tag & 0x07;

    if (wireType === 2) {
      // Length-delimited (string/bytes)
      let strLen = 0;
      let shift = 0;
      while (i < payload.length) {
        const b = payload[i];
        i++;
        strLen |= (b & 0x7f) << shift;
        shift += 7;
        if ((b & 0x80) === 0) break;
      }
      strLen >>>= 0; // Ensure unsigned for values > 2^31

      const strBytes = payload.slice(i, i + strLen);
      const str = decoder.decode(strBytes);
      i += strLen;

      if (fieldNumber === 1) node = str;
      if (fieldNumber === 2) serverVersion = str;
    } else if (wireType === 0) {
      // Varint — skip
      while (i < payload.length && (payload[i] & 0x80) !== 0) i++;
      i++;
    } else {
      break; // Unknown wire type
    }
  }

  return { node, serverVersion };
}

/**
 * Parse an RpbErrorResp protobuf (field 1 = errmsg bytes, field 2 = errcode uint32)
 */
function parseErrorResp(payload: Uint8Array): { errmsg: string; errcode: number } {
  let errmsg = '';
  let errcode = 0;
  const decoder = new TextDecoder();

  let i = 0;
  while (i < payload.length) {
    const tag = payload[i];
    i++;
    const fieldNumber = tag >> 3;
    const wireType = tag & 0x07;

    if (wireType === 2) {
      let strLen = 0;
      let shift = 0;
      while (i < payload.length) {
        const b = payload[i]; i++;
        strLen |= (b & 0x7f) << shift; shift += 7;
        if ((b & 0x80) === 0) break;
      }
      strLen >>>= 0; // Ensure unsigned for values > 2^31
      const strBytes = payload.slice(i, i + strLen);
      i += strLen;
      if (fieldNumber === 1) errmsg = decoder.decode(strBytes);
    } else if (wireType === 0) {
      let val = 0;
      let shift = 0;
      while (i < payload.length) {
        const b = payload[i]; i++;
        val |= (b & 0x7f) << shift; shift += 7;
        if ((b & 0x80) === 0) break;
      }
      val >>>= 0; // Ensure unsigned for values > 2^31
      if (fieldNumber === 2) errcode = val;
    } else {
      break;
    }
  }

  return { errmsg, errcode };
}

/**
 * Encode a protobuf varint.
 */
function encodeVarint(n: number): number[] {
  const out: number[] = [];
  while (n > 127) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n & 0x7f);
  return out;
}

/**
 * Encode a length-delimited (bytes/string) protobuf field.
 * wire type 2: tag = (fieldNum << 3) | 2
 */
function pbBytesField(fieldNum: number, value: Uint8Array): number[] {
  const tag = (fieldNum << 3) | 2;
  return [...encodeVarint(tag), ...encodeVarint(value.length), ...value];
}

/**
 * Decode a length-delimited bytes field from a protobuf payload.
 * Returns the first occurrence of the given field number or undefined.
 */
function pbDecodeBytes(data: Uint8Array, fieldNum: number): Uint8Array | undefined {
  let i = 0;
  while (i < data.length) {
    let tag = 0; let shift = 0;
    while (i < data.length) {
      const b = data[i]; i++;
      tag |= (b & 0x7f) << shift; shift += 7;
      if ((b & 0x80) === 0) break;
    }
    const fNum = tag >> 3;
    const wireType = tag & 0x07;

    if (wireType === 2) {
      let len = 0; shift = 0;
      while (i < data.length) {
        const b = data[i]; i++;
        len |= (b & 0x7f) << shift; shift += 7;
        if ((b & 0x80) === 0) break;
      }
      len >>>= 0; // Ensure unsigned for values > 2^31
      if (fNum === fieldNum) return data.slice(i, i + len);
      i += len;
    } else if (wireType === 0) {
      while (i < data.length && (data[i] & 0x80) !== 0) i++;
      i++;
    } else {
      break;
    }
  }
  return undefined;
}

/**
 * Handle Riak ping — send RpbPingReq and expect RpbPingResp.
 */
export async function handleRiakPing(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as RiakRequest;
    const { host, port = 8087, timeout = 10000 } = body;

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

    if (timeout < 0 || timeout > 600000) {
      return new Response(JSON.stringify({ success: false, error: 'Timeout must be between 0 and 600000 ms' }), {
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

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Send RpbPingReq
        const pingMsg = buildRiakMessage(MSG_PING_REQ);
        await writer.write(pingMsg);

        // Read response
        const resp = await readRiakResponse(reader, timeoutPromise);
        const rtt = Date.now() - startTime;

        if (resp.msgCode === MSG_PING_RESP) {
          return new Response(JSON.stringify({
            success: true,
            host,
            port,
            message: 'Riak node is alive (pong)',
            rtt,
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } else if (resp.msgCode === MSG_ERROR_RESP) {
          const err = parseErrorResp(resp.payload);
          return new Response(JSON.stringify({
            success: false,
            host,
            port,
            error: err.errmsg || 'Riak error response',
            errorCode: err.errcode,
            rtt,
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } else {
          return new Response(JSON.stringify({
            success: false,
            host,
            port,
            error: `Unexpected response code: ${resp.msgCode}`,
            rtt,
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      } finally {
        writer.releaseLock();
        reader.releaseLock();
      }
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      socket.close();
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle Riak server info — send RpbGetServerInfoReq and parse the response.
 */
export async function handleRiakInfo(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as RiakRequest;
    const { host, port = 8087, timeout = 10000 } = body;

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

    if (timeout < 0 || timeout > 600000) {
      return new Response(JSON.stringify({ success: false, error: 'Timeout must be between 0 and 600000 ms' }), {
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

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Send RpbGetServerInfoReq
        const infoMsg = buildRiakMessage(MSG_GET_SERVER_INFO_REQ);
        await writer.write(infoMsg);

        // Read response
        const resp = await readRiakResponse(reader, timeoutPromise);
        const rtt = Date.now() - startTime;

        if (resp.rawLength === 0) {
          return new Response(JSON.stringify({
            success: false,
            host,
            port,
            error: 'No response — Riak PBC port may not be accessible',
            rtt,
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        if (resp.msgCode === MSG_GET_SERVER_INFO_RESP) {
          const info = parseServerInfo(resp.payload);
          return new Response(JSON.stringify({
            success: true,
            host,
            port,
            node: info.node,
            serverVersion: info.serverVersion,
            rtt,
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } else if (resp.msgCode === MSG_ERROR_RESP) {
          const err = parseErrorResp(resp.payload);
          return new Response(JSON.stringify({
            success: false,
            host,
            port,
            error: err.errmsg || 'Riak error response',
            errorCode: err.errcode,
            rtt,
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } else {
          return new Response(JSON.stringify({
            success: false,
            host,
            port,
            error: `Unexpected response code: ${resp.msgCode}`,
            responseCode: resp.msgCode,
            rtt,
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      } finally {
        writer.releaseLock();
        reader.releaseLock();
      }
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      socket.close();
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle Riak get — fetch a value by bucket and key
 * POST /api/riak/get
 */
export async function handleRiakGet(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json() as {
      host: string; port?: number;
      bucket: string; key: string;
      bucketType?: string;
      timeout?: number;
    };
    const { host, port = 8087, bucket, key, timeout = 8000 } = body;

    if (!host || !bucket || !key) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required: host, bucket, key' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (timeout < 0 || timeout > 600000) {
      return new Response(JSON.stringify({ success: false, error: 'Timeout must be between 0 and 600000 ms' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const enc = new TextEncoder();
    const reqFields: number[] = [
      ...pbBytesField(1, enc.encode(bucket)),
      ...pbBytesField(2, enc.encode(key)),
    ];
    if (body.bucketType) reqFields.push(...pbBytesField(5, enc.encode(body.bucketType)));
    const reqPayload = new Uint8Array(reqFields);

    const socket = connect(`${host}:${port}`);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, rej) => {
      timeoutHandle = setTimeout(() => rej(new Error('Timeout')), timeout);
    });
    try {
      await Promise.race([socket.opened, timeoutPromise]);
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        const startTime = Date.now();

        await writer.write(buildRiakMessage(MSG_GET_REQ, reqPayload));
        const resp = await readRiakResponse(reader, timeoutPromise);
        const rtt = Date.now() - startTime;

        if (resp.msgCode === MSG_ERROR_RESP) {
          const err = parseErrorResp(resp.payload);
          return new Response(JSON.stringify({
            success: false, host, port, bucket, key, rtt,
            error: err.errmsg || 'Riak error', errorCode: err.errcode,
          }), { headers: { 'Content-Type': 'application/json' } });
        }

        if (resp.msgCode !== MSG_GET_RESP) {
          return new Response(JSON.stringify({
            success: false, host, port, bucket, key, rtt,
            error: `Unexpected response code: ${resp.msgCode}`,
          }), { headers: { 'Content-Type': 'application/json' } });
        }

        // Parse RpbGetResp: field 1 = content (RpbContent), field 3 = vclock
        const contentBytes = pbDecodeBytes(resp.payload, 1);
        let value: string | undefined;
        let contentType: string | undefined;
        if (contentBytes) {
          const valBytes = pbDecodeBytes(contentBytes, 1);
          const ctBytes = pbDecodeBytes(contentBytes, 2);
          if (valBytes) value = new TextDecoder().decode(valBytes);
          if (ctBytes) contentType = new TextDecoder().decode(ctBytes);
        }

        const found = contentBytes !== undefined;
        return new Response(JSON.stringify({
          success: true, host, port, rtt, bucket, key,
          found, value, contentType,
          message: found ? `Key '${key}' found in bucket '${bucket}'` : `Key '${key}' not found`,
        }), { headers: { 'Content-Type': 'application/json' } });
      } finally {
        reader.releaseLock();
        writer.releaseLock();
      }
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      socket.close();
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Riak get failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle Riak put — store a value by bucket and key
 * POST /api/riak/put
 */
export async function handleRiakPut(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json() as {
      host: string; port?: number;
      bucket: string; key: string;
      value: string;
      contentType?: string;
      bucketType?: string;
      timeout?: number;
    };
    const { host, port = 8087, bucket, key, value, timeout = 8000 } = body;
    const contentType = body.contentType ?? 'text/plain';

    if (!host || !bucket || !key || value === undefined) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required: host, bucket, key, value' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (timeout < 0 || timeout > 600000) {
      return new Response(JSON.stringify({ success: false, error: 'Timeout must be between 0 and 600000 ms' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const enc = new TextEncoder();
    // RpbContent: field 1 = value, field 2 = content_type
    const contentFields = new Uint8Array([
      ...pbBytesField(1, enc.encode(value)),
      ...pbBytesField(2, enc.encode(contentType)),
    ]);

    // RpbPutReq: field 1 = bucket, field 2 = key, field 3 = content
    const reqFields: number[] = [
      ...pbBytesField(1, enc.encode(bucket)),
      ...pbBytesField(2, enc.encode(key)),
      ...pbBytesField(3, contentFields),
    ];
    if (body.bucketType) reqFields.push(...pbBytesField(5, enc.encode(body.bucketType)));
    const reqPayload = new Uint8Array(reqFields);

    const socket = connect(`${host}:${port}`);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, rej) => {
      timeoutHandle = setTimeout(() => rej(new Error('Timeout')), timeout);
    });
    try {
      await Promise.race([socket.opened, timeoutPromise]);
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        const startTime = Date.now();

        await writer.write(buildRiakMessage(MSG_PUT_REQ, reqPayload));
        const resp = await readRiakResponse(reader, timeoutPromise);
        const rtt = Date.now() - startTime;

        if (resp.msgCode === MSG_ERROR_RESP) {
          const err = parseErrorResp(resp.payload);
          return new Response(JSON.stringify({
            success: false, host, port, bucket, key, rtt,
            error: err.errmsg || 'Riak error', errorCode: err.errcode,
          }), { headers: { 'Content-Type': 'application/json' } });
        }

        if (resp.msgCode !== MSG_PUT_RESP) {
          return new Response(JSON.stringify({
            success: false, host, port, bucket, key, rtt,
            error: `Unexpected response code: ${resp.msgCode}`,
          }), { headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({
          success: true, host, port, rtt, bucket, key, contentType,
          valueSize: enc.encode(value).length,
          message: `Value stored at '${bucket}/${key}'`,
        }), { headers: { 'Content-Type': 'application/json' } });
      } finally {
        reader.releaseLock();
        writer.releaseLock();
      }
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      socket.close();
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Riak put failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
