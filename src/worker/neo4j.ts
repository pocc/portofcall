/**
 * Neo4j Bolt Protocol Implementation
 *
 * Implements Neo4j connectivity testing via the Bolt protocol (port 7687).
 * The Bolt protocol uses a binary handshake followed by PackStream-encoded
 * messages for graph database operations.
 *
 * Protocol Flow:
 * 1. Client sends magic number 0x6060B017 + 4 supported versions
 * 2. Server responds with chosen version (uint32)
 * 3. Client sends HELLO message with auth credentials
 * 4. Server responds with SUCCESS containing server info
 *
 * Use Cases:
 * - Neo4j server connectivity testing
 * - Bolt protocol version detection
 * - Server version and edition discovery
 * - Authentication verification
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// Bolt protocol magic number
const BOLT_MAGIC = 0x6060B017;

// PackStream encoding helpers
function packString(str: string): Uint8Array {
  const bytes = new TextEncoder().encode(str);
  const length = bytes.length;

  if (length < 16) {
    const result = new Uint8Array(1 + length);
    result[0] = 0x80 | length;
    result.set(bytes, 1);
    return result;
  } else if (length < 256) {
    const result = new Uint8Array(2 + length);
    result[0] = 0xD0;
    result[1] = length;
    result.set(bytes, 2);
    return result;
  } else {
    const result = new Uint8Array(3 + length);
    result[0] = 0xD1;
    result[1] = (length >> 8) & 0xFF;
    result[2] = length & 0xFF;
    result.set(bytes, 3);
    return result;
  }
}

function packMap(entries: [string, Uint8Array][]): Uint8Array {
  const count = entries.length;
  const parts: Uint8Array[] = [];

  if (count < 16) {
    parts.push(new Uint8Array([0xA0 | count]));
  } else {
    parts.push(new Uint8Array([0xD8, count]));
  }

  for (const [key, value] of entries) {
    parts.push(packString(key));
    parts.push(value);
  }

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function packStruct(tag: number, fields: Uint8Array[]): Uint8Array {
  const fieldCount = fields.length;
  const parts: Uint8Array[] = [];

  // Struct marker: 0xB0 | fieldCount (tiny struct)
  parts.push(new Uint8Array([0xB0 | fieldCount, tag]));

  for (const field of fields) {
    parts.push(field);
  }

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/**
 * Build a chunked Bolt message from PackStream-encoded data
 */
function buildChunkedMessage(data: Uint8Array): Uint8Array {
  // Chunk header (2 bytes big-endian length) + data + end marker (0x0000)
  const result = new Uint8Array(2 + data.length + 2);
  result[0] = (data.length >> 8) & 0xFF;
  result[1] = data.length & 0xFF;
  result.set(data, 2);
  // End marker already zero-filled
  return result;
}

/**
 * Parse a PackStream value from a buffer
 */
function unpackValue(data: Uint8Array, offset: number): [unknown, number] {
  if (offset >= data.length) return [null, offset];

  const marker = data[offset];

  // Tiny int (0x00-0x7F)
  if (marker >= 0x00 && marker <= 0x7F) {
    return [marker, offset + 1];
  }

  // Negative tiny int (0xF0-0xFF = -16 to -1)
  if (marker >= 0xF0 && marker <= 0xFF) {
    return [marker - 256, offset + 1];
  }

  // Tiny string (0x80-0x8F)
  if (marker >= 0x80 && marker <= 0x8F) {
    const length = marker & 0x0F;
    const str = new TextDecoder().decode(data.slice(offset + 1, offset + 1 + length));
    return [str, offset + 1 + length];
  }

  // Tiny list (0x90-0x9F)
  if (marker >= 0x90 && marker <= 0x9F) {
    const count = marker & 0x0F;
    const list: unknown[] = [];
    let pos = offset + 1;
    for (let i = 0; i < count; i++) {
      const [val, newPos] = unpackValue(data, pos);
      list.push(val);
      pos = newPos;
    }
    return [list, pos];
  }

  // Tiny map (0xA0-0xAF)
  if (marker >= 0xA0 && marker <= 0xAF) {
    const count = marker & 0x0F;
    const map: Record<string, unknown> = {};
    let pos = offset + 1;
    for (let i = 0; i < count; i++) {
      const [key, keyPos] = unpackValue(data, pos);
      const [val, valPos] = unpackValue(data, keyPos);
      map[String(key)] = val;
      pos = valPos;
    }
    return [map, pos];
  }

  // Tiny struct (0xB0-0xBF)
  if (marker >= 0xB0 && marker <= 0xBF) {
    const fieldCount = marker & 0x0F;
    const tag = data[offset + 1];
    const fields: unknown[] = [];
    let pos = offset + 2;
    for (let i = 0; i < fieldCount; i++) {
      const [val, newPos] = unpackValue(data, pos);
      fields.push(val);
      pos = newPos;
    }
    return [{ _tag: tag, _fields: fields }, pos];
  }

  // Null (0xC0)
  if (marker === 0xC0) return [null, offset + 1];

  // Float64 (0xC1)
  if (marker === 0xC1) {
    const view = new DataView(data.buffer, data.byteOffset + offset + 1, 8);
    return [view.getFloat64(0), offset + 9];
  }

  // Boolean false (0xC2)
  if (marker === 0xC2) return [false, offset + 1];

  // Boolean true (0xC3)
  if (marker === 0xC3) return [true, offset + 1];

  // Int8 (0xC8)
  if (marker === 0xC8) {
    const val = data[offset + 1];
    return [val > 127 ? val - 256 : val, offset + 2];
  }

  // Int16 (0xC9)
  if (marker === 0xC9) {
    const view = new DataView(data.buffer, data.byteOffset + offset + 1, 2);
    return [view.getInt16(0), offset + 3];
  }

  // Int32 (0xCA)
  if (marker === 0xCA) {
    const view = new DataView(data.buffer, data.byteOffset + offset + 1, 4);
    return [view.getInt32(0), offset + 5];
  }

  // Int64 (0xCB)
  if (marker === 0xCB) {
    const view = new DataView(data.buffer, data.byteOffset + offset + 1, 8);
    const bigVal = view.getBigInt64(0);
    // Use Number when the value fits safely, otherwise keep as BigInt
    // (BigInt serializes as a string in JSON.stringify via default behavior)
    if (bigVal >= BigInt(Number.MIN_SAFE_INTEGER) && bigVal <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return [Number(bigVal), offset + 9];
    }
    return [bigVal, offset + 9];
  }

  // String8 (0xD0)
  if (marker === 0xD0) {
    const length = data[offset + 1];
    const str = new TextDecoder().decode(data.slice(offset + 2, offset + 2 + length));
    return [str, offset + 2 + length];
  }

  // String16 (0xD1)
  if (marker === 0xD1) {
    const view = new DataView(data.buffer, data.byteOffset + offset + 1, 2);
    const length = view.getUint16(0);
    const str = new TextDecoder().decode(data.slice(offset + 3, offset + 3 + length));
    return [str, offset + 3 + length];
  }

  // Map8 (0xD8)
  if (marker === 0xD8) {
    const count = data[offset + 1];
    const map: Record<string, unknown> = {};
    let pos = offset + 2;
    for (let i = 0; i < count; i++) {
      const [key, keyPos] = unpackValue(data, pos);
      const [val, valPos] = unpackValue(data, keyPos);
      map[String(key)] = val;
      pos = valPos;
    }
    return [map, pos];
  }

  // Skip unknown marker
  return [null, offset + 1];
}

/**
 * Parse a Bolt response message from chunked data
 */
function parseResponse(data: Uint8Array): { tag: number; metadata: Record<string, unknown> } | null {
  if (data.length < 4) return null;

  // Read chunk size (first 2 bytes, big-endian)
  const chunkSize = (data[0] << 8) | data[1];
  if (chunkSize === 0) return null;

  // The chunk data starts at offset 2
  const chunkData = data.slice(2, 2 + chunkSize);

  // Parse the struct
  const [value] = unpackValue(chunkData, 0);

  if (value && typeof value === 'object' && '_tag' in (value as Record<string, unknown>)) {
    const struct = value as { _tag: number; _fields: unknown[] };
    const metadata = (struct._fields[0] as Record<string, unknown>) || {};
    return { tag: struct._tag, metadata };
  }

  return null;
}

/**
 * Format Bolt protocol version from uint32
 */
function formatVersion(version: number): string {
  const major = (version >> 8) & 0xFF;
  const minor = version & 0xFF;
  return `${major}.${minor}`;
}

/**
 * Handle Neo4j Bolt connection test
 */
export async function handleNeo4jConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 7687, timeout = 10000 } = body;

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

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);
    const connectTime = Date.now() - startTime;

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // === Phase 1: Bolt Handshake ===
    // Send magic number + 4 protocol versions
    const handshake = new Uint8Array(20);
    const view = new DataView(handshake.buffer);
    view.setUint32(0, BOLT_MAGIC); // Magic preamble
    // Offer versions 5.4, 5.3, 4.4, 4.3 (newest first)
    view.setUint32(4, 0x00000504);  // v5.4
    view.setUint32(8, 0x00000503);  // v5.3
    view.setUint32(12, 0x00000404); // v4.4
    view.setUint32(16, 0x00000403); // v4.3

    await writer.write(handshake);

    // Read server's chosen version (4 bytes)
    const versionResult = await Promise.race([reader.read(), timeoutPromise]);
    if (versionResult.done || !versionResult.value) {
      throw new Error('Server closed connection during handshake');
    }

    const versionData = versionResult.value;
    if (versionData.length < 4) {
      throw new Error('Invalid handshake response');
    }

    const versionView = new DataView(versionData.buffer, versionData.byteOffset, 4);
    const selectedVersion = versionView.getUint32(0);

    if (selectedVersion === 0) {
      throw new Error('Server does not support any offered Bolt protocol versions');
    }

    const boltVersion = formatVersion(selectedVersion);

    // === Phase 2: HELLO message ===
    // Build HELLO with user_agent
    const helloMap = packMap([
      ['user_agent', packString('PortOfCall/1.0')],
      ['scheme', packString('none')],
    ]);

    const helloMessage = packStruct(0x01, [helloMap]); // HELLO = 0x01
    const chunkedHello = buildChunkedMessage(helloMessage);

    await writer.write(chunkedHello);

    // Read HELLO response
    let serverInfo: Record<string, unknown> = {};
    let helloSuccess = false;
    let authRequired = false;
    let errorMessage = '';

    try {
      const responseResult = await Promise.race([reader.read(), timeoutPromise]);
      if (responseResult.value && responseResult.value.length > 0) {
        const parsed = parseResponse(responseResult.value);
        if (parsed) {
          if (parsed.tag === 0x70) { // SUCCESS
            helloSuccess = true;
            serverInfo = parsed.metadata;
          } else if (parsed.tag === 0x7F) { // FAILURE
            authRequired = true;
            errorMessage = String(parsed.metadata.message || 'Authentication required');
          }
        }
      }
    } catch {
      // HELLO response timeout or error - still have handshake data
    }

    const rtt = Date.now() - startTime;

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      connectTime,
      boltVersion,
      selectedVersion,
      helloSuccess,
      authRequired,
      errorMessage: errorMessage || undefined,
      serverInfo: {
        server: serverInfo.server || undefined,
        connection_id: serverInfo.connection_id || undefined,
        hints: serverInfo.hints || undefined,
      },
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
 * Open a Bolt socket, perform the handshake, and authenticate.
 * Returns the socket handles, negotiated bolt version number, and server info.
 */
async function openBoltSession(
  host: string,
  port: number,
  username: string,
  password: string,
  timeout: number,
): Promise<{
  writer: WritableStreamDefaultWriter<Uint8Array>;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  socket: ReturnType<typeof connect>;
  boltVersion: string;
  majorVersion: number;
  serverInfo: Record<string, unknown>;
}> {
  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  await Promise.race([socket.opened, timeoutPromise]);

  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  // === Phase 1: Bolt Handshake ===
  const handshake = new Uint8Array(20);
  const view = new DataView(handshake.buffer);
  view.setUint32(0, BOLT_MAGIC);
  view.setUint32(4, 0x00000504);  // v5.4
  view.setUint32(8, 0x00000503);  // v5.3
  view.setUint32(12, 0x00000404); // v4.4
  view.setUint32(16, 0x00000403); // v4.3

  await writer.write(handshake);

  const versionResult = await Promise.race([reader.read(), timeoutPromise]);
  if (versionResult.done || !versionResult.value) {
    throw new Error('Server closed connection during handshake');
  }

  const versionData = versionResult.value;
  if (versionData.length < 4) {
    throw new Error('Invalid handshake response');
  }

  const versionView = new DataView(versionData.buffer, versionData.byteOffset, 4);
  const selectedVersion = versionView.getUint32(0);

  if (selectedVersion === 0) {
    throw new Error('Server does not support any offered Bolt protocol versions');
  }

  const boltVersion = formatVersion(selectedVersion);
  const majorVersion = (selectedVersion >> 8) & 0xFF;

  // === Phase 2: HELLO / auth ===
  let helloMessage: Uint8Array;

  if (majorVersion >= 4) {
    // Bolt 4+: auth fields go in HELLO
    const helloMap = packMap([
      ['user_agent', packString('PortOfCall/1.0')],
      ['scheme', packString('basic')],
      ['principal', packString(username)],
      ['credentials', packString(password)],
    ]);
    helloMessage = packStruct(0x01, [helloMap]);
  } else {
    // Bolt 3: same structure
    const helloMap = packMap([
      ['user_agent', packString('PortOfCall/1.0')],
      ['scheme', packString('basic')],
      ['principal', packString(username)],
      ['credentials', packString(password)],
    ]);
    helloMessage = packStruct(0x01, [helloMap]);
  }

  await writer.write(buildChunkedMessage(helloMessage));

  const helloResult = await Promise.race([reader.read(), timeoutPromise]);
  if (!helloResult.value || helloResult.value.length === 0) {
    throw new Error('No response to HELLO');
  }

  const helloParsed = parseResponse(helloResult.value);
  if (!helloParsed) {
    throw new Error('Could not parse HELLO response');
  }

  if (helloParsed.tag === 0x7F) { // FAILURE
    const msg = String(helloParsed.metadata.message || 'Authentication failed');
    throw new Error(msg);
  }

  if (helloParsed.tag !== 0x70) { // not SUCCESS
    throw new Error(`Unexpected HELLO response tag: 0x${helloParsed.tag.toString(16)}`);
  }

  const serverInfo = helloParsed.metadata;

  return { writer, reader, socket, boltVersion, majorVersion, serverInfo };
}

/**
 * Read all available chunked Bolt response messages from the reader,
 * assembling across multiple TCP reads until we get the final SUCCESS or FAILURE.
 */
async function readBoltMessages(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<Array<{ tag: number; fields: unknown[] }>> {
  const messages: Array<{ tag: number; fields: unknown[] }> = [];
  const deadline = Date.now() + timeoutMs;

  // Accumulate raw bytes across reads
  let buf = new Uint8Array(0);

  function append(chunk: Uint8Array) {
    const next = new Uint8Array(buf.length + chunk.length);
    next.set(buf, 0);
    next.set(chunk, buf.length);
    buf = next;
  }

  // Parse and consume all complete messages from buf
  function consumeMessages() {
    while (true) {
      if (buf.length < 2) break;
      const chunkSize = (buf[0] << 8) | buf[1];
      if (chunkSize === 0) {
        // End-of-message marker — consume it and keep going
        buf = buf.slice(2);
        continue;
      }
      if (buf.length < 2 + chunkSize) break; // incomplete chunk

      const chunkData = buf.slice(2, 2 + chunkSize);
      buf = buf.slice(2 + chunkSize);

      const [value] = unpackValue(chunkData, 0);
      if (value && typeof value === 'object' && '_tag' in (value as Record<string, unknown>)) {
        const struct = value as { _tag: number; _fields: unknown[] };
        messages.push({ tag: struct._tag, fields: struct._fields });
      }
    }
  }

  // We need at least one SUCCESS/FAILURE to finish
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const readPromise = reader.read();
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Read timeout')), remaining);
    });

    const result = await Promise.race([readPromise, timeoutPromise]);
    if (result.done) break;
    if (result.value && result.value.length > 0) {
      append(result.value);
      consumeMessages();
    }

    // Stop once we have a terminal message (SUCCESS=0x70 or FAILURE=0x7F)
    const last = messages[messages.length - 1];
    if (last && (last.tag === 0x70 || last.tag === 0x7F)) break;
  }

  return messages;
}

/**
 * Handle a Neo4j Cypher query via the Bolt protocol
 */
export async function handleNeo4jQuery(request: Request): Promise<Response> {
  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let socket: ReturnType<typeof connect> | null = null;

  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      username?: string;
      password?: string;
      query: string;
      database?: string;
      timeout?: number;
    };

    const {
      host,
      port = 7687,
      username = 'neo4j',
      password = '',
      query,
      database,
      timeout = 15000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!query) {
      return new Response(JSON.stringify({ success: false, error: 'Query is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
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

    // Open Bolt session and authenticate
    const session = await openBoltSession(host, port, username, password, timeout);
    writer = session.writer;
    reader = session.reader;
    socket = session.socket;
    const { boltVersion, majorVersion, serverInfo } = session;

    // === Phase 3: BEGIN (optional, for database selection on Bolt 4+) ===
    if (majorVersion >= 4 && database) {
      const beginMeta = packMap([['db', packString(database)]]);
      const beginMsg = packStruct(0x11, [beginMeta]); // BEGIN = 0x11
      await writer.write(buildChunkedMessage(beginMsg));

      const beginMsgs = await readBoltMessages(reader, 5000);
      const beginResult = beginMsgs.find(m => m.tag === 0x70 || m.tag === 0x7F);
      if (beginResult && beginResult.tag === 0x7F) {
        const meta = (beginResult.fields[0] as Record<string, unknown>) || {};
        throw new Error(String(meta.message || 'BEGIN failed'));
      }
    }

    // === Phase 4: RUN message ===
    let runMessage: Uint8Array;
    const emptyMap = packMap([]);

    if (majorVersion >= 4) {
      // Bolt 4+: RUN has extra metadata field (db routing info etc.)
      const runMeta = database
        ? packMap([['db', packString(database)]])
        : emptyMap;
      runMessage = packStruct(0x10, [packString(query), emptyMap, runMeta]);
    } else {
      // Bolt 3: RUN has only query + parameters
      runMessage = packStruct(0x10, [packString(query), emptyMap]);
    }

    // === Phase 5: PULL message ===
    let pullMessage: Uint8Array;
    if (majorVersion >= 4) {
      // Bolt 4+: PULL with n=-1 (fetch all)
      pullMessage = packStruct(0x3F, [packMap([['n', packInteger(-1)]])]);
    } else {
      // Bolt 3: PULL_ALL = 0xB0 0x3F (struct with 0 fields, tag 0x3F)
      pullMessage = packStruct(0x3F, []);
    }

    // Send RUN and PULL as separate chunked messages
    await writer.write(buildChunkedMessage(runMessage));
    await writer.write(buildChunkedMessage(pullMessage));

    // === Phase 6: Read responses ===
    // Expected: SUCCESS(fields) → RECORD* → SUCCESS(summary)  OR  FAILURE
    const allMessages = await readBoltMessages(reader, timeout);

    // Find the first SUCCESS (RUN response with fields list)
    let columns: string[] = [];
    const rows: unknown[][] = [];
    let serverVersion = String(serverInfo.server || '');
    let queryError: string | null = null;

    let foundRunSuccess = false;
    for (const msg of allMessages) {
      if (msg.tag === 0x7F) { // FAILURE
        const meta = (msg.fields[0] as Record<string, unknown>) || {};
        queryError = String(meta.message || 'Query failed');
        break;
      }

      if (msg.tag === 0x70 && !foundRunSuccess) { // First SUCCESS = RUN response
        const meta = (msg.fields[0] as Record<string, unknown>) || {};
        const fieldsList = meta.fields as unknown[] | undefined;
        if (Array.isArray(fieldsList)) {
          columns = fieldsList.map(f => String(f));
        }
        foundRunSuccess = true;
        continue;
      }

      if (msg.tag === 0x71) { // RECORD
        const recordData = msg.fields[0];
        if (Array.isArray(recordData)) {
          rows.push(recordData);
        }
        continue;
      }

      if (msg.tag === 0x70 && foundRunSuccess) { // Second SUCCESS = PULL response (summary)
        const meta = (msg.fields[0] as Record<string, unknown>) || {};
        if (meta.server) serverVersion = String(meta.server);
        break;
      }
    }

    // Close the socket
    try {
      writer.releaseLock();
      reader.releaseLock();
      socket.close();
    } catch {
      // ignore close errors
    }
    writer = null;
    reader = null;
    socket = null;

    if (queryError) {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        boltVersion,
        error: queryError,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      boltVersion,
      serverVersion,
      columns,
      rows,
      rowCount: rows.length,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    try {
      if (writer) writer.releaseLock();
      if (reader) reader.releaseLock();
      if (socket) socket.close();
    } catch {
      // ignore
    }

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
 * Pack an integer value using PackStream encoding
 */
function packInteger(value: number): Uint8Array {
  if (value >= -16 && value <= 127) {
    // Tiny int or positive tiny int
    return new Uint8Array([value & 0xFF]);
  } else if (value >= -128 && value <= 127) {
    return new Uint8Array([0xC8, value & 0xFF]);
  } else if (value >= -32768 && value <= 32767) {
    return new Uint8Array([0xC9, (value >> 8) & 0xFF, value & 0xFF]);
  } else {
    return new Uint8Array([
      0xCA,
      (value >> 24) & 0xFF,
      (value >> 16) & 0xFF,
      (value >> 8) & 0xFF,
      value & 0xFF,
    ]);
  }
}

/**
 * Handle a Neo4j Cypher query with parameters via the Bolt protocol.
 * Same as handleNeo4jQuery but accepts a `params` map passed as the second
 * argument to the Bolt RUN message.
 */
export async function handleNeo4jQueryParams(request: Request): Promise<Response> {
  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let socket: ReturnType<typeof connect> | null = null;

  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      username?: string;
      password?: string;
      query: string;
      params?: Record<string, unknown>;
      database?: string;
      timeout?: number;
    };

    const {
      host,
      port = 7687,
      username = 'neo4j',
      password = '',
      query,
      params = {},
      database,
      timeout = 15000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!query) {
      return new Response(JSON.stringify({ success: false, error: 'Query is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    const session = await openBoltSession(host, port, username, password, timeout);
    writer = session.writer;
    reader = session.reader;
    socket = session.socket;
    const { boltVersion, majorVersion, serverInfo } = session;

    // Encode params as a PackStream Map
    const packedParams = packValueMap(params);

    const emptyMap = packMap([]);

    // RUN with params
    let runMessage: Uint8Array;
    if (majorVersion >= 4) {
      const runMeta = database ? packMap([['db', packString(database)]]) : emptyMap;
      runMessage = packStruct(0x10, [packString(query), packedParams, runMeta]);
    } else {
      runMessage = packStruct(0x10, [packString(query), packedParams]);
    }

    // PULL
    let pullMessage: Uint8Array;
    if (majorVersion >= 4) {
      pullMessage = packStruct(0x3F, [packMap([['n', packInteger(-1)]])]);
    } else {
      pullMessage = packStruct(0x3F, []);
    }

    await writer.write(buildChunkedMessage(runMessage));
    await writer.write(buildChunkedMessage(pullMessage));

    const allMessages = await readBoltMessages(reader, timeout);

    let columns: string[] = [];
    const rows: unknown[][] = [];
    let serverVersion = String(serverInfo.server || '');
    let queryError: string | null = null;
    let foundRunSuccess = false;

    for (const msg of allMessages) {
      if (msg.tag === 0x7F) {
        const meta = (msg.fields[0] as Record<string, unknown>) || {};
        queryError = String(meta.message || 'Query failed');
        break;
      }
      if (msg.tag === 0x70 && !foundRunSuccess) {
        const meta = (msg.fields[0] as Record<string, unknown>) || {};
        const fieldsList = meta.fields as unknown[] | undefined;
        if (Array.isArray(fieldsList)) {
          columns = fieldsList.map(f => String(f));
        }
        foundRunSuccess = true;
        continue;
      }
      if (msg.tag === 0x71) {
        const recordData = msg.fields[0];
        if (Array.isArray(recordData)) rows.push(recordData);
        continue;
      }
      if (msg.tag === 0x70 && foundRunSuccess) {
        const meta = (msg.fields[0] as Record<string, unknown>) || {};
        if (meta.server) serverVersion = String(meta.server);
        break;
      }
    }

    try {
      writer.releaseLock();
      reader.releaseLock();
      socket.close();
    } catch { /* ignore */ }
    writer = null;
    reader = null;
    socket = null;

    if (queryError) {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        boltVersion,
        error: queryError,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      boltVersion,
      serverVersion,
      columns,
      rows,
      rowCount: rows.length,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    try {
      if (writer) writer.releaseLock();
      if (reader) reader.releaseLock();
      if (socket) socket.close();
    } catch { /* ignore */ }

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
 * Encode a plain JS object as a PackStream Map.
 * Supports string, number, boolean, and null values.
 */
function packValueMap(obj: Record<string, unknown>): Uint8Array {
  const entries: [string, Uint8Array][] = [];
  for (const [key, value] of Object.entries(obj)) {
    entries.push([key, packAnyValue(value)]);
  }
  return packMap(entries);
}

/**
 * Encode a JS value as PackStream bytes.
 */
function packAnyValue(value: unknown): Uint8Array {
  if (value === null || value === undefined) {
    return new Uint8Array([0xC0]); // null
  }
  if (typeof value === 'boolean') {
    return new Uint8Array([value ? 0xC3 : 0xC2]);
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return packInteger(value);
    }
    // Float64
    const buf = new Uint8Array(9);
    buf[0] = 0xC1;
    new DataView(buf.buffer).setFloat64(1, value, false);
    return buf;
  }
  if (typeof value === 'string') {
    return packString(value);
  }
  if (Array.isArray(value)) {
    const count = value.length;
    const parts: Uint8Array[] = [];
    if (count < 16) {
      parts.push(new Uint8Array([0x90 | count]));
    } else {
      parts.push(new Uint8Array([0xD4, count]));
    }
    for (const item of value) parts.push(packAnyValue(item));
    const total = parts.reduce((s, p) => s + p.length, 0);
    const result = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { result.set(p, off); off += p.length; }
    return result;
  }
  if (typeof value === 'object') {
    return packValueMap(value as Record<string, unknown>);
  }
  // Fallback: encode as string
  return packString(String(value));
}

/**
 * Handle Neo4j schema discovery.
 * Runs CALL db.labels(), CALL db.relationshipTypes(), and CALL db.propertyKeys()
 * and returns the results.
 */
export async function handleNeo4jSchema(request: Request): Promise<Response> {
  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let socket: ReturnType<typeof connect> | null = null;

  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: { 'Allow': 'POST', 'Content-Type': 'application/json' } });
    }
    const body = await request.json() as { host?: string; port?: number; username?: string; password?: string };
    const host = body.host || '';
    const port = body.port || 7687;
    const username = body.username || 'neo4j';
    const password = body.password || '';
    const timeout = 15000;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (isNaN(port) || port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Valid port required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    const session = await openBoltSession(host, port, username, password, timeout);
    writer = session.writer;
    reader = session.reader;
    socket = session.socket;
    const { boltVersion, majorVersion } = session;

    const emptyMap = packMap([]);

    async function runQuery(q: string): Promise<string[]> {
      let run: Uint8Array;
      let pull: Uint8Array;

      if (majorVersion >= 4) {
        run = packStruct(0x10, [packString(q), emptyMap, emptyMap]);
        pull = packStruct(0x3F, [packMap([['n', packInteger(-1)]])]);
      } else {
        run = packStruct(0x10, [packString(q), emptyMap]);
        pull = packStruct(0x3F, []);
      }

      await writer!.write(buildChunkedMessage(run));
      await writer!.write(buildChunkedMessage(pull));

      const msgs = await readBoltMessages(reader!, 10000);
      const results: string[] = [];

      for (const msg of msgs) {
        if (msg.tag === 0x7F) {
          // Query failed — return empty
          return [];
        }
        if (msg.tag === 0x71) {
          // RECORD — first field is the value
          const row = msg.fields[0];
          if (Array.isArray(row) && row.length > 0) {
            results.push(String(row[0]));
          }
        }
      }
      return results;
    }

    const labels = await runQuery('CALL db.labels()');
    const relTypes = await runQuery('CALL db.relationshipTypes()');
    const propKeys = await runQuery('CALL db.propertyKeys()');

    try {
      writer.releaseLock();
      reader.releaseLock();
      socket.close();
    } catch { /* ignore */ }
    writer = null;
    reader = null;
    socket = null;

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      boltVersion,
      schema: {
        labels,
        relationshipTypes: relTypes,
        propertyKeys: propKeys,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    try {
      if (writer) writer.releaseLock();
      if (reader) reader.releaseLock();
      if (socket) socket.close();
    } catch { /* ignore */ }

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
 * Handle Neo4j node creation.
 * Runs CREATE (n:{label} $props) RETURN n with the provided properties as params.
 * Returns the created node data.
 */
export async function handleNeo4jCreate(request: Request): Promise<Response> {
  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let socket: ReturnType<typeof connect> | null = null;

  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      username?: string;
      password?: string;
      label: string;
      properties?: Record<string, unknown>;
      database?: string;
      timeout?: number;
    };

    const {
      host,
      port = 7687,
      username = 'neo4j',
      password = '',
      label,
      properties = {},
      database,
      timeout = 15000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!label) {
      return new Response(JSON.stringify({ success: false, error: 'Label is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate label (letters, digits, underscore — no spaces or special chars)
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(label)) {
      return new Response(JSON.stringify({ success: false, error: 'Label must be a valid identifier' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    const session = await openBoltSession(host, port, username, password, timeout);
    writer = session.writer;
    reader = session.reader;
    socket = session.socket;
    const { boltVersion, majorVersion } = session;

    const query = `CREATE (n:\`${label}\` $props) RETURN n`;
    const packedParams = packMap([['props', packValueMap(properties)]]);

    const emptyMap = packMap([]);
    let runMessage: Uint8Array;
    let pullMessage: Uint8Array;

    if (majorVersion >= 4) {
      const runMeta = database ? packMap([['db', packString(database)]]) : emptyMap;
      runMessage = packStruct(0x10, [packString(query), packedParams, runMeta]);
      pullMessage = packStruct(0x3F, [packMap([['n', packInteger(-1)]])]);
    } else {
      runMessage = packStruct(0x10, [packString(query), packedParams]);
      pullMessage = packStruct(0x3F, []);
    }

    await writer.write(buildChunkedMessage(runMessage));
    await writer.write(buildChunkedMessage(pullMessage));

    const allMessages = await readBoltMessages(reader, timeout);

    let createdNode: unknown = null;
    let queryError: string | null = null;
    let foundRunSuccess = false;

    for (const msg of allMessages) {
      if (msg.tag === 0x7F) {
        const meta = (msg.fields[0] as Record<string, unknown>) || {};
        queryError = String(meta.message || 'Create failed');
        break;
      }
      if (msg.tag === 0x70 && !foundRunSuccess) {
        foundRunSuccess = true;
        continue;
      }
      if (msg.tag === 0x71) {
        // RECORD — the first element is the returned node
        const row = msg.fields[0];
        if (Array.isArray(row) && row.length > 0) {
          createdNode = row[0];
        }
        continue;
      }
      if (msg.tag === 0x70 && foundRunSuccess) {
        break;
      }
    }

    try {
      writer.releaseLock();
      reader.releaseLock();
      socket.close();
    } catch { /* ignore */ }
    writer = null;
    reader = null;
    socket = null;

    if (queryError) {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        boltVersion,
        error: queryError,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      boltVersion,
      label,
      node: createdNode,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    try {
      if (writer) writer.releaseLock();
      if (reader) reader.releaseLock();
      if (socket) socket.close();
    } catch { /* ignore */ }

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
