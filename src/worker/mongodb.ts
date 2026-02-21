/**
 * MongoDB Wire Protocol Implementation
 *
 * Implements connectivity testing for MongoDB servers using the
 * MongoDB Wire Protocol (OP_MSG, opcode 2013).
 *
 * Protocol Flow:
 * 1. Client connects to server port 27017
 * 2. Client sends OP_MSG with { hello: 1, $db: "admin" }
 * 3. Server responds with OP_MSG containing server info
 * 4. Client parses BSON response for version/status
 *
 * Use Cases:
 * - MongoDB server connectivity testing
 * - Server version and wire protocol detection
 * - Replica set status checking
 * - Authentication verification
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// MongoDB Wire Protocol OpCodes
const OP_MSG = 2013;
const OP_REPLY = 1;

// BSON Type IDs
const BSON_DOUBLE = 0x01;
const BSON_STRING = 0x02;
const BSON_DOCUMENT = 0x03;
const BSON_ARRAY = 0x04;
const BSON_OBJECTID = 0x07;
const BSON_BOOLEAN = 0x08;
const BSON_DATETIME = 0x09;
const BSON_NULL = 0x0a;
const BSON_INT32 = 0x10;
const BSON_TIMESTAMP = 0x11;
const BSON_INT64 = 0x12;

/**
 * Minimal BSON encoder for small command documents.
 * Supports: int32, string, boolean, double
 */
function encodeBSON(doc: Record<string, unknown>): Uint8Array {
  const parts: number[] = [];

  for (const [key, value] of Object.entries(doc)) {
    const keyBytes = new TextEncoder().encode(key);

    if (typeof value === 'number' && Number.isInteger(value)) {
      parts.push(BSON_INT32);
      parts.push(...keyBytes, 0); // cstring
      const buf = new ArrayBuffer(4);
      new DataView(buf).setInt32(0, value, true);
      parts.push(...new Uint8Array(buf));
    } else if (typeof value === 'number') {
      parts.push(BSON_DOUBLE);
      parts.push(...keyBytes, 0);
      const buf = new ArrayBuffer(8);
      new DataView(buf).setFloat64(0, value, true);
      parts.push(...new Uint8Array(buf));
    } else if (typeof value === 'string') {
      const strBytes = new TextEncoder().encode(value);
      parts.push(BSON_STRING);
      parts.push(...keyBytes, 0);
      const lenBuf = new ArrayBuffer(4);
      new DataView(lenBuf).setInt32(0, strBytes.length + 1, true); // +1 for null terminator
      parts.push(...new Uint8Array(lenBuf));
      parts.push(...strBytes, 0);
    } else if (typeof value === 'boolean') {
      parts.push(BSON_BOOLEAN);
      parts.push(...keyBytes, 0);
      parts.push(value ? 1 : 0);
    }
  }

  // Document = int32 length + fields + 0x00 terminator
  const totalSize = 4 + parts.length + 1;
  const result = new Uint8Array(totalSize);
  new DataView(result.buffer).setInt32(0, totalSize, true);
  result.set(new Uint8Array(parts), 4);
  result[totalSize - 1] = 0; // terminator
  return result;
}

/**
 * BSON decoder - parses a BSON document into a JS object.
 * Handles all common types returned by MongoDB server responses.
 */
function decodeBSON(data: Uint8Array, startOffset: number = 0, depth: number = 0): Record<string, unknown> {
  if (depth > 10) throw new Error('BSON nesting too deep');
  const view = new DataView(data.buffer, data.byteOffset + startOffset);
  const docLength = view.getInt32(0, true);
  const result: Record<string, unknown> = {};

  let offset = 4;

  while (offset < docLength - 1) {
    const type = data[startOffset + offset];
    offset++;

    if (type === 0) break;

    // Read key (cstring - null terminated)
    let keyEnd = offset;
    while (data[startOffset + keyEnd] !== 0 && keyEnd < docLength) keyEnd++;
    const key = new TextDecoder().decode(data.slice(startOffset + offset, startOffset + keyEnd));
    offset = keyEnd + 1;

    switch (type) {
      case BSON_DOUBLE: {
        result[key] = new DataView(data.buffer, data.byteOffset + startOffset + offset).getFloat64(0, true);
        offset += 8;
        break;
      }
      case BSON_STRING: {
        const strLen = new DataView(data.buffer, data.byteOffset + startOffset + offset).getInt32(0, true);
        offset += 4;
        result[key] = new TextDecoder().decode(data.slice(startOffset + offset, startOffset + offset + strLen - 1));
        offset += strLen;
        break;
      }
      case BSON_DOCUMENT: {
        const subDocLen = new DataView(data.buffer, data.byteOffset + startOffset + offset).getInt32(0, true);
        result[key] = decodeBSON(data, startOffset + offset, depth + 1);
        offset += subDocLen;
        break;
      }
      case BSON_ARRAY: {
        const arrDocLen = new DataView(data.buffer, data.byteOffset + startOffset + offset).getInt32(0, true);
        const arrDoc = decodeBSON(data, startOffset + offset, depth + 1);
        // Convert document with numeric keys to array
        const arr: unknown[] = [];
        for (let i = 0; arrDoc[String(i)] !== undefined; i++) {
          arr.push(arrDoc[String(i)]);
        }
        result[key] = arr;
        offset += arrDocLen;
        break;
      }
      case BSON_OBJECTID: {
        // ObjectId is 12 bytes - represent as hex string
        const oidBytes = data.slice(startOffset + offset, startOffset + offset + 12);
        result[key] = Array.from(oidBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        offset += 12;
        break;
      }
      case BSON_BOOLEAN: {
        result[key] = data[startOffset + offset] !== 0;
        offset += 1;
        break;
      }
      case BSON_DATETIME: {
        const lo = new DataView(data.buffer, data.byteOffset + startOffset + offset).getUint32(0, true);
        const hi = new DataView(data.buffer, data.byteOffset + startOffset + offset).getInt32(4, true);
        const combined = BigInt(hi) * BigInt(0x100000000) + BigInt(lo);
        result[key] = new Date(Number(combined)).toISOString();
        offset += 8;
        break;
      }
      case BSON_NULL: {
        result[key] = null;
        break;
      }
      case BSON_INT32: {
        result[key] = new DataView(data.buffer, data.byteOffset + startOffset + offset).getInt32(0, true);
        offset += 4;
        break;
      }
      case BSON_TIMESTAMP: {
        // Timestamp is 8 bytes (increment + timestamp)
        const increment = new DataView(data.buffer, data.byteOffset + startOffset + offset).getUint32(0, true);
        const timestamp = new DataView(data.buffer, data.byteOffset + startOffset + offset).getUint32(4, true);
        const combined64 = BigInt(timestamp) * BigInt(0x100000000) + BigInt(increment);
        result[key] = { timestamp, increment, combined: combined64.toString() };
        offset += 8;
        break;
      }
      case BSON_INT64: {
        const lo64 = new DataView(data.buffer, data.byteOffset + startOffset + offset).getUint32(0, true);
        const hi64 = new DataView(data.buffer, data.byteOffset + startOffset + offset).getInt32(4, true);
        const combined64 = BigInt(hi64) * BigInt(0x100000000) + BigInt(lo64);
        result[key] = combined64.toString();
        offset += 8;
        break;
      }
      default: {
        // Unknown BSON type - cannot determine size, stop parsing
        offset = docLength;
        break;
      }
    }
  }

  return result;
}

/**
 * Recursive BSON field encoder supporting null, nested objects, and arrays.
 * Used by encodeBSONFull for user-supplied documents.
 */
function encodeField(parts: number[], keyBytes: Uint8Array, value: unknown): void {
  if (value === null || value === undefined) {
    parts.push(BSON_NULL);
    parts.push(...keyBytes, 0);
  } else if (typeof value === 'boolean') {
    parts.push(BSON_BOOLEAN);
    parts.push(...keyBytes, 0);
    parts.push(value ? 1 : 0);
  } else if (typeof value === 'number' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647) {
    parts.push(BSON_INT32);
    parts.push(...keyBytes, 0);
    const buf = new ArrayBuffer(4);
    new DataView(buf).setInt32(0, value, true);
    parts.push(...new Uint8Array(buf));
  } else if (typeof value === 'number') {
    parts.push(BSON_DOUBLE);
    parts.push(...keyBytes, 0);
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, value, true);
    parts.push(...new Uint8Array(buf));
  } else if (typeof value === 'string') {
    const strBytes = new TextEncoder().encode(value);
    parts.push(BSON_STRING);
    parts.push(...keyBytes, 0);
    const lenBuf = new ArrayBuffer(4);
    new DataView(lenBuf).setInt32(0, strBytes.length + 1, true);
    parts.push(...new Uint8Array(lenBuf));
    parts.push(...strBytes, 0);
  } else if (Array.isArray(value)) {
    parts.push(BSON_ARRAY);
    parts.push(...keyBytes, 0);
    const arrDoc = encodeBSONFull(Object.fromEntries(value.map((v, i) => [String(i), v])));
    parts.push(...arrDoc);
  } else if (typeof value === 'object') {
    parts.push(BSON_DOCUMENT);
    parts.push(...keyBytes, 0);
    const subdoc = encodeBSONFull(value as Record<string, unknown>);
    parts.push(...subdoc);
  }
}

/**
 * Full BSON encoder supporting null, nested objects, and arrays.
 * Use this for user-supplied documents (filter, insert docs, etc.).
 */
function encodeBSONFull(doc: Record<string, unknown>): Uint8Array {
  const parts: number[] = [];
  for (const [key, value] of Object.entries(doc)) {
    encodeField(parts, new TextEncoder().encode(key), value);
  }
  const totalSize = 4 + parts.length + 1;
  const result = new Uint8Array(totalSize);
  new DataView(result.buffer).setInt32(0, totalSize, true);
  result.set(new Uint8Array(parts), 4);
  result[totalSize - 1] = 0;
  return result;
}

/**
 * Build a MongoDB OP_MSG using the full recursive BSON encoder.
 */
function buildOpMsgFull(document: Record<string, unknown>, requestId: number): Uint8Array {
  const bsonDoc = encodeBSONFull(document);
  const messageLength = 16 + 4 + 1 + bsonDoc.length;
  const message = new Uint8Array(messageLength);
  const view = new DataView(message.buffer);
  view.setInt32(0, messageLength, true);
  view.setInt32(4, requestId, true);
  view.setInt32(8, 0, true);
  view.setInt32(12, OP_MSG, true);
  view.setUint32(16, 0, true);
  message[20] = 0;
  message.set(bsonDoc, 21);
  return message;
}

/**
 * Build a MongoDB OP_MSG message
 */
function buildOpMsg(document: Record<string, unknown>, requestId: number): Uint8Array {
  const bsonDoc = encodeBSON(document);

  // OP_MSG structure: header(16) + flagBits(4) + sectionKind(1) + BSON
  const messageLength = 16 + 4 + 1 + bsonDoc.length;

  const message = new Uint8Array(messageLength);
  const view = new DataView(message.buffer);

  // Header
  view.setInt32(0, messageLength, true);  // messageLength
  view.setInt32(4, requestId, true);       // requestID
  view.setInt32(8, 0, true);               // responseTo
  view.setInt32(12, OP_MSG, true);         // opCode = 2013

  // Flags
  view.setUint32(16, 0, true);

  // Section kind 0 = body
  message[20] = 0;

  // BSON document
  message.set(bsonDoc, 21);

  return message;
}

/**
 * Read a complete MongoDB response from the socket
 */
async function readFullResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<Uint8Array> {
  // Read initial chunk
  const { value: firstChunk, done } = await reader.read();
  if (done || !firstChunk || firstChunk.length < 4) {
    throw new Error('No response from server');
  }

  const expectedLength = new DataView(firstChunk.buffer, firstChunk.byteOffset).getInt32(0, true);

  if (firstChunk.length >= expectedLength) {
    return firstChunk.slice(0, expectedLength);
  }

  // Need more data
  const chunks: Uint8Array[] = [firstChunk];
  let totalRead = firstChunk.length;

  while (totalRead < expectedLength) {
    const { value, done: readDone } = await reader.read();
    if (readDone || !value) break;
    chunks.push(value);
    totalRead += value.length;
  }

  const fullResponse = new Uint8Array(totalRead);
  let offset = 0;
  for (const chunk of chunks) {
    fullResponse.set(chunk, offset);
    offset += chunk.length;
  }

  return fullResponse;
}

/**
 * Parse a MongoDB wire protocol response (handles both OP_MSG and OP_REPLY)
 */
function parseResponse(data: Uint8Array): Record<string, unknown> {
  const view = new DataView(data.buffer, data.byteOffset);
  const opCode = view.getInt32(12, true);

  if (opCode === OP_MSG) {
    // OP_MSG: header(16) + flagBits(4) + sectionKind(1) + BSON
    return decodeBSON(data, 21);
  }

  if (opCode === OP_REPLY) {
    // OP_REPLY: header(16) + responseFlags(4) + cursorID(8) + startingFrom(4) + numberReturned(4) + documents
    return decodeBSON(data, 36);
  }

  throw new Error(`Unsupported opCode: ${opCode}`);
}

/**
 * Handle MongoDB connection test
 * Sends hello command and returns server information
 */
export async function handleMongoDBConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 27017, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
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

    // Check if the target is behind Cloudflare
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

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const connectTime = Date.now() - startTime;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Send hello command via OP_MSG
        const helloMsg = buildOpMsg({
          hello: 1,
          $db: 'admin',
        }, 1);

        await writer.write(helloMsg);

        // Read full response
        const responseData = await readFullResponse(reader);
        const rtt = Date.now() - startTime;

        // Parse the response
        const doc = parseResponse(responseData);

        // Also send buildInfo to get server version
        const buildInfoMsg = buildOpMsg({
          buildInfo: 1,
          $db: 'admin',
        }, 2);

        await writer.write(buildInfoMsg);
        const buildInfoData = await readFullResponse(reader);
        const buildInfoDoc = parseResponse(buildInfoData);

        // Clean up
        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return {
          success: true,
          host,
          port,
          connectTime,
          rtt,
          serverInfo: {
            version: buildInfoDoc.version || 'Unknown',
            gitVersion: buildInfoDoc.gitVersion,
            isWritablePrimary: doc.isWritablePrimary ?? doc.ismaster,
            maxBsonObjectSize: doc.maxBsonObjectSize,
            maxMessageSizeBytes: doc.maxMessageSizeBytes,
            maxWriteBatchSize: doc.maxWriteBatchSize,
            minWireVersion: doc.minWireVersion,
            maxWireVersion: doc.maxWireVersion,
            readOnly: doc.readOnly,
            localTime: doc.localTime,
            ok: doc.ok,
          },
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
 * Handle MongoDB ping command
 * Simple latency check using the ping command
 */
export async function handleMongoDBPing(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 27017, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Send ping command
        const pingMsg = buildOpMsg({
          ping: 1,
          $db: 'admin',
        }, 1);

        await writer.write(pingMsg);
        const responseData = await readFullResponse(reader);
        const rtt = Date.now() - startTime;

        const doc = parseResponse(responseData);

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return {
          success: true,
          host,
          port,
          rtt,
          ok: doc.ok,
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
 * Handle MongoDB find — query documents from a collection
 * POST /api/mongodb/find
 */
export async function handleMongoDBFind(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number;
      database: string; collection: string;
      filter?: Record<string, unknown>;
      projection?: Record<string, unknown>;
      limit?: number;
      skip?: number;
      timeout?: number;
    };
    const { host, port = 27017, database, collection, timeout = 10000 } = body;
    const filter = body.filter ?? {};
    const limit = Math.min(body.limit ?? 20, 100);
    const skip = body.skip ?? 0;

    if (!host || !database || !collection) {
      return new Response(JSON.stringify({
        success: false, error: 'Missing required: host, database, collection',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('Timeout')), timeout)
    );
    try {
      await Promise.race([socket.opened, timeoutPromise]);
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        const startTime = Date.now();

        await writer.write(buildOpMsg({ hello: 1, $db: database }, 1));
        const helloRaw = await Promise.race([readFullResponse(reader), timeoutPromise]);
        const helloResp = parseResponse(helloRaw);
        if (!helloResp.ok) throw new Error('MongoDB hello failed');

        const findCmd: Record<string, unknown> = {
          find: collection, filter, limit, skip, $db: database,
        };
        if (body.projection) findCmd['projection'] = body.projection;

        await writer.write(buildOpMsgFull(findCmd, 2));
        const findRaw = await Promise.race([readFullResponse(reader), timeoutPromise]);
        const rtt = Date.now() - startTime;
        const findResp = parseResponse(findRaw);

        if (!findResp.ok) {
          return new Response(JSON.stringify({
            success: false, host, port, database, collection,
            error: findResp.errmsg || 'Find failed', code: findResp.code,
          }), { headers: { 'Content-Type': 'application/json' } });
        }

        const cursor = findResp.cursor as { firstBatch?: unknown[]; id?: unknown } | undefined;
        const documents = cursor?.firstBatch ?? [];

        return new Response(JSON.stringify({
          success: true, host, port, rtt, database, collection,
          documentCount: documents.length, documents,
          hasMore: cursor?.id !== undefined && cursor.id !== 0,
        }), { headers: { 'Content-Type': 'application/json' } });
      } finally {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
      }
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'MongoDB find failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle MongoDB insert — insert documents into a collection
 * POST /api/mongodb/insert
 */
export async function handleMongoDBInsert(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number;
      database: string; collection: string;
      documents: Record<string, unknown>[];
      ordered?: boolean;
      timeout?: number;
    };
    const { host, port = 27017, database, collection, timeout = 10000 } = body;
    const ordered = body.ordered !== false;

    if (!host || !database || !collection || !Array.isArray(body.documents) || body.documents.length === 0) {
      return new Response(JSON.stringify({
        success: false, error: 'Missing required: host, database, collection, documents[]',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (body.documents.length > 100) {
      return new Response(JSON.stringify({
        success: false, error: 'Maximum 100 documents per insert',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('Timeout')), timeout)
    );
    try {
      await Promise.race([socket.opened, timeoutPromise]);
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        const startTime = Date.now();

        await writer.write(buildOpMsg({ hello: 1, $db: database }, 1));
        const helloRaw = await Promise.race([readFullResponse(reader), timeoutPromise]);
        const helloResp = parseResponse(helloRaw);
        if (!helloResp.ok) throw new Error('MongoDB hello failed');

        const insertCmd: Record<string, unknown> = {
          insert: collection, documents: body.documents, ordered, $db: database,
        };

        await writer.write(buildOpMsgFull(insertCmd, 2));
        const insertRaw = await Promise.race([readFullResponse(reader), timeoutPromise]);
        const rtt = Date.now() - startTime;
        const insertResp = parseResponse(insertRaw);

        if (!insertResp.ok) {
          return new Response(JSON.stringify({
            success: false, host, port, database, collection,
            error: insertResp.errmsg || 'Insert failed',
            code: insertResp.code,
            writeErrors: insertResp.writeErrors,
          }), { headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({
          success: true, host, port, rtt, database, collection,
          inserted: insertResp.n ?? body.documents.length,
          message: `${String(insertResp.n ?? body.documents.length)} document(s) inserted`,
        }), { headers: { 'Content-Type': 'application/json' } });
      } finally {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
      }
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'MongoDB insert failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle MongoDB update (updateOne / updateMany).
 *
 * Body: { host, port=27017, database, collection, filter, update, multi=false, upsert=false, timeout=10000 }
 * - filter: query filter (e.g. { "status": "active" })
 * - update: update operators (e.g. { "$set": { "status": "inactive" } })
 * - multi=false → updateOne; multi=true → updateMany
 * Returns: { success, matched, modified, upsertedId }
 */
export async function handleMongoDBUpdate(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number;
      database: string; collection: string;
      filter: Record<string, unknown>;
      update: Record<string, unknown>;
      multi?: boolean;
      upsert?: boolean;
      timeout?: number;
    };
    const { host, port = 27017, database, collection, timeout = 10000 } = body;
    const multi = body.multi === true;
    const upsert = body.upsert === true;

    if (!host || !database || !collection || !body.filter || !body.update) {
      return new Response(JSON.stringify({
        success: false, error: 'Missing required: host, database, collection, filter, update',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('Timeout')), timeout)
    );
    try {
      await Promise.race([socket.opened, timeoutPromise]);
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        const startTime = Date.now();

        await writer.write(buildOpMsg({ hello: 1, $db: database }, 1));
        const helloRaw = await Promise.race([readFullResponse(reader), timeoutPromise]);
        const helloResp = parseResponse(helloRaw);
        if (!helloResp.ok) throw new Error('MongoDB hello failed');

        const updateCmd: Record<string, unknown> = {
          update: collection,
          updates: [{ q: body.filter, u: body.update, multi, upsert }],
          $db: database,
        };

        await writer.write(buildOpMsgFull(updateCmd, 2));
        const updateRaw = await Promise.race([readFullResponse(reader), timeoutPromise]);
        const rtt = Date.now() - startTime;
        const updateResp = parseResponse(updateRaw);

        if (!updateResp.ok) {
          return new Response(JSON.stringify({
            success: false, host, port, database, collection,
            error: updateResp.errmsg || 'Update failed',
            code: updateResp.code,
            writeErrors: updateResp.writeErrors,
          }), { headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({
          success: true, host, port, rtt, database, collection,
          matched: updateResp.n ?? 0,
          modified: updateResp.nModified ?? 0,
          upsertedId: updateResp.upserted
            ? (updateResp.upserted as Array<{ _id: unknown }>)[0]?._id ?? null
            : null,
          message: `${String(updateResp.nModified ?? 0)} document(s) modified`,
        }), { headers: { 'Content-Type': 'application/json' } });
      } finally {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
      }
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'MongoDB update failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle MongoDB delete (deleteOne / deleteMany).
 *
 * Body: { host, port=27017, database, collection, filter, many=false, timeout=10000 }
 * - filter: query filter (e.g. { "status": "inactive" })
 * - many=false → deleteOne (limit=1); many=true → deleteMany (limit=0)
 * Returns: { success, deleted }
 */
export async function handleMongoDBDelete(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number;
      database: string; collection: string;
      filter: Record<string, unknown>;
      many?: boolean;
      timeout?: number;
    };
    const { host, port = 27017, database, collection, timeout = 10000 } = body;
    const limit = body.many === true ? 0 : 1; // 0 = deleteMany, 1 = deleteOne

    if (!host || !database || !collection || !body.filter) {
      return new Response(JSON.stringify({
        success: false, error: 'Missing required: host, database, collection, filter',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('Timeout')), timeout)
    );
    try {
      await Promise.race([socket.opened, timeoutPromise]);
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        const startTime = Date.now();

        await writer.write(buildOpMsg({ hello: 1, $db: database }, 1));
        const helloRaw = await Promise.race([readFullResponse(reader), timeoutPromise]);
        const helloResp = parseResponse(helloRaw);
        if (!helloResp.ok) throw new Error('MongoDB hello failed');

        const deleteCmd: Record<string, unknown> = {
          delete: collection,
          deletes: [{ q: body.filter, limit }],
          $db: database,
        };

        await writer.write(buildOpMsgFull(deleteCmd, 2));
        const deleteRaw = await Promise.race([readFullResponse(reader), timeoutPromise]);
        const rtt = Date.now() - startTime;
        const deleteResp = parseResponse(deleteRaw);

        if (!deleteResp.ok) {
          return new Response(JSON.stringify({
            success: false, host, port, database, collection,
            error: deleteResp.errmsg || 'Delete failed',
            code: deleteResp.code,
            writeErrors: deleteResp.writeErrors,
          }), { headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({
          success: true, host, port, rtt, database, collection,
          deleted: deleteResp.n ?? 0,
          message: `${String(deleteResp.n ?? 0)} document(s) deleted`,
        }), { headers: { 'Content-Type': 'application/json' } });
      } finally {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
      }
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'MongoDB delete failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
