/**
 * Cassandra CQL Native Protocol Implementation
 *
 * Implements connectivity testing for Apache Cassandra using the
 * CQL Binary Protocol v4 (native_protocol_v4).
 *
 * Protocol Flow:
 * 1. Client connects to server port 9042
 * 2. Client sends OPTIONS frame (opcode 0x05) to discover capabilities
 * 3. Server responds with SUPPORTED frame listing CQL versions & compression
 * 4. Client sends STARTUP frame (opcode 0x01) with CQL_VERSION
 * 5. Server responds with READY (0x02) or AUTHENTICATE (0x03)
 *
 * Frame Format (9 bytes header):
 *   version(1) | flags(1) | stream(2) | opcode(1) | length(4)
 *
 * Use Cases:
 * - Cassandra cluster connectivity testing
 * - CQL protocol version detection
 * - Supported compression discovery
 * - Authentication requirement detection
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// CQL Protocol v4 constants
const CQL_VERSION_REQUEST = 0x04;  // Client request version byte

// Opcodes (client -> server)
const OPCODE_STARTUP = 0x01;
const OPCODE_OPTIONS = 0x05;

// Opcodes (server -> client)
const OPCODE_ERROR = 0x00;
const OPCODE_READY = 0x02;
const OPCODE_AUTHENTICATE = 0x03;
const OPCODE_SUPPORTED = 0x06;

const FRAME_HEADER_SIZE = 9;

/**
 * Build a CQL protocol frame
 */
function buildFrame(opcode: number, body: Uint8Array, stream: number = 0): Uint8Array {
  const frame = new Uint8Array(FRAME_HEADER_SIZE + body.length);
  const view = new DataView(frame.buffer);

  view.setUint8(0, CQL_VERSION_REQUEST); // version
  view.setUint8(1, 0x00);               // flags (no compression, no tracing)
  view.setInt16(2, stream, false);       // stream (big-endian)
  view.setUint8(4, opcode);             // opcode
  view.setInt32(5, body.length, false);  // length (big-endian)

  frame.set(body, FRAME_HEADER_SIZE);
  return frame;
}

/**
 * Build an OPTIONS frame (empty body)
 */
function buildOptionsFrame(): Uint8Array {
  return buildFrame(OPCODE_OPTIONS, new Uint8Array(0));
}

/**
 * Build a STARTUP frame with CQL_VERSION string map
 */
function buildStartupFrame(): Uint8Array {
  // String map: { "CQL_VERSION": "3.0.0" }
  const key = new TextEncoder().encode('CQL_VERSION');
  const value = new TextEncoder().encode('3.0.0');

  // string map = n(2 bytes) + [key_len(2) + key + value_len(2) + value]*
  const bodySize = 2 + 2 + key.length + 2 + value.length;
  const body = new Uint8Array(bodySize);
  const view = new DataView(body.buffer);

  let offset = 0;
  view.setInt16(offset, 1, false); // 1 entry
  offset += 2;

  view.setInt16(offset, key.length, false);
  offset += 2;
  body.set(key, offset);
  offset += key.length;

  view.setInt16(offset, value.length, false);
  offset += 2;
  body.set(value, offset);

  return buildFrame(OPCODE_STARTUP, body);
}

/**
 * Parse a CQL string map from a SUPPORTED response body
 * Format: n(2 bytes) + [key_len(2) + key + value_list_len(2) + [str_len(2) + str]*]*
 */
function parseStringMultimap(data: Uint8Array): Record<string, string[]> {
  const view = new DataView(data.buffer, data.byteOffset);
  const result: Record<string, string[]> = {};
  let offset = 0;

  const count = view.getInt16(offset, false);
  offset += 2;

  for (let i = 0; i < count; i++) {
    // Read key
    const keyLen = view.getInt16(offset, false);
    offset += 2;
    const key = new TextDecoder().decode(data.slice(offset, offset + keyLen));
    offset += keyLen;

    // Read value list
    const listLen = view.getInt16(offset, false);
    offset += 2;
    const values: string[] = [];

    for (let j = 0; j < listLen; j++) {
      const valLen = view.getInt16(offset, false);
      offset += 2;
      const val = new TextDecoder().decode(data.slice(offset, offset + valLen));
      offset += valLen;
      values.push(val);
    }

    result[key] = values;
  }

  return result;
}

/**
 * Parse a CQL ERROR response body
 * Format: error_code(4 bytes) + message_len(2) + message
 */
function parseError(data: Uint8Array): { code: number; message: string } {
  const view = new DataView(data.buffer, data.byteOffset);
  const code = view.getInt32(0, false);
  const msgLen = view.getInt16(4, false);
  const message = new TextDecoder().decode(data.slice(6, 6 + msgLen));
  return { code, message };
}

/**
 * Get human-readable name for a CQL opcode
 */
function getOpcodeName(opcode: number): string {
  const names: Record<number, string> = {
    0x00: 'ERROR',
    0x01: 'STARTUP',
    0x02: 'READY',
    0x03: 'AUTHENTICATE',
    0x05: 'OPTIONS',
    0x06: 'SUPPORTED',
    0x07: 'QUERY',
    0x08: 'RESULT',
    0x09: 'PREPARE',
    0x0A: 'EXECUTE',
    0x0B: 'REGISTER',
    0x0C: 'EVENT',
    0x0D: 'BATCH',
    0x0E: 'AUTH_CHALLENGE',
    0x0F: 'AUTH_RESPONSE',
    0x10: 'AUTH_SUCCESS',
  };
  return names[opcode] || `UNKNOWN(0x${opcode.toString(16)})`;
}

/**
 * Read exactly `length` bytes from a reader, accumulating chunks
 */
async function readExact(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  length: number,
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

/**
 * Read a complete CQL frame (header + body)
 */
async function readFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<{ version: number; flags: number; stream: number; opcode: number; body: Uint8Array }> {
  const header = await readExact(reader, FRAME_HEADER_SIZE);
  const view = new DataView(header.buffer);

  const version = view.getUint8(0);
  const flags = view.getUint8(1);
  const stream = view.getInt16(2, false);
  const opcode = view.getUint8(4);
  const length = view.getInt32(5, false);

  const body = length > 0 ? await readExact(reader, length) : new Uint8Array(0);

  return { version, flags, stream, opcode, body };
}

/**
 * Handle Cassandra connection test
 * Sends OPTIONS + STARTUP and returns server capabilities
 */
export async function handleCassandraConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 9042, timeout = 10000 } = body;

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
        // Step 1: Send OPTIONS to discover supported features
        await writer.write(buildOptionsFrame());
        const optionsResponse = await readFrame(reader);

        let supportedOptions: Record<string, string[]> = {};
        if (optionsResponse.opcode === OPCODE_SUPPORTED) {
          supportedOptions = parseStringMultimap(optionsResponse.body);
        } else if (optionsResponse.opcode === OPCODE_ERROR) {
          const err = parseError(optionsResponse.body);
          throw new Error(`Server error on OPTIONS: ${err.message} (code ${err.code})`);
        }

        // Step 2: Send STARTUP to initialize connection
        await writer.write(buildStartupFrame());
        const startupResponse = await readFrame(reader);
        const rtt = Date.now() - startTime;

        let authRequired = false;
        let authenticator = '';
        let startupError = '';

        if (startupResponse.opcode === OPCODE_READY) {
          // Connection accepted, no auth needed
        } else if (startupResponse.opcode === OPCODE_AUTHENTICATE) {
          authRequired = true;
          // Parse authenticator class name
          const view = new DataView(startupResponse.body.buffer, startupResponse.body.byteOffset);
          const authLen = view.getInt16(0, false);
          authenticator = new TextDecoder().decode(
            startupResponse.body.slice(2, 2 + authLen),
          );
        } else if (startupResponse.opcode === OPCODE_ERROR) {
          const err = parseError(startupResponse.body);
          startupError = `${err.message} (code ${err.code})`;
        }

        // Determine protocol version from response
        const protocolVersion = optionsResponse.version & 0x7F; // mask off response bit

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return {
          success: true,
          host,
          port,
          connectTime,
          rtt,
          protocolVersion,
          cqlVersions: supportedOptions['CQL_VERSION'] || [],
          compression: supportedOptions['COMPRESSION'] || [],
          authRequired,
          authenticator: authenticator || undefined,
          startupError: startupError || undefined,
          startupResponse: getOpcodeName(startupResponse.opcode),
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


// ============================================================
// CQL Query Execution (handleCassandraQuery)
// ============================================================

// Extra opcodes for query path
const OPCODE_QUERY_EXEC = 0x07;
const OPCODE_AUTH_RESPONSE_FRAME = 0x0F;
const OPCODE_AUTH_SUCCESS_RESP = 0x10;
const OPCODE_RESULT  = 0x08;
const OPCODE_PREPARE = 0x09;
const OPCODE_EXECUTE = 0x0A;

/** RESULT kind = Rows */
const RESULT_KIND_ROWS = 0x0002;

const CQL_TYPE_NAMES: Record<number, string> = {
  0x0001: 'ascii',     0x0002: 'bigint',     0x0003: 'blob',
  0x0004: 'boolean',   0x0005: 'counter',    0x0006: 'decimal',
  0x0007: 'double',    0x0008: 'float',      0x0009: 'int',
  0x000A: 'text',      0x000B: 'timestamp',  0x000C: 'uuid',
  0x000D: 'varchar',   0x000E: 'varint',     0x000F: 'timeuuid',
  0x0010: 'inet',      0x0011: 'date',       0x0012: 'time',
  0x0013: 'smallint',  0x0014: 'tinyint',
  0x0020: 'list',      0x0021: 'map',        0x0022: 'set',
  0x0030: 'udt',       0x0031: 'tuple',
};

/** Read a CQL short string (2-byte big-endian length prefix). */
function readCqlShortString(data: Uint8Array, offset: number): [string, number] {
  const view = new DataView(data.buffer, data.byteOffset);
  const len = view.getInt16(offset, false);
  const str = new TextDecoder().decode(data.slice(offset + 2, offset + 2 + len));
  return [str, offset + 2 + len];
}

/** Build AUTH_RESPONSE frame using SASL PLAIN: \0username\0password */
function buildAuthResponseFrame(username: string, password: string): Uint8Array {
  const enc = new TextEncoder();
  const u = enc.encode(username);
  const p = enc.encode(password);
  const sasl = new Uint8Array(1 + u.length + 1 + p.length);
  sasl[0] = 0x00;
  sasl.set(u, 1);
  sasl[1 + u.length] = 0x00;
  sasl.set(p, 2 + u.length);
  const body = new Uint8Array(4 + sasl.length);
  new DataView(body.buffer).setInt32(0, sasl.length, false);
  body.set(sasl, 4);
  return buildFrame(OPCODE_AUTH_RESPONSE_FRAME, body, 2);
}

/**
 * Build a QUERY frame.
 * Body: [query_len 4B][query bytes][consistency 2B=ONE][flags 1B=0x00][page_size 4B=100]
 */
function buildQueryFrame(cql: string, stream = 3): Uint8Array {
  const qBytes = new TextEncoder().encode(cql);
  const body = new Uint8Array(4 + qBytes.length + 7);
  const view = new DataView(body.buffer);
  let off = 0;
  view.setInt32(off, qBytes.length, false); off += 4;
  body.set(qBytes, off); off += qBytes.length;
  view.setInt16(off, 0x0001, false); off += 2;  // consistency ONE
  body[off] = 0x00; off += 1;                   // flags none
  view.setInt32(off, 100, false); off += 4;      // page_size 100
  return buildFrame(OPCODE_QUERY_EXEC, body.slice(0, off), stream);
}

/**
 * Parse a RESULT body with kind=Rows (0x0002).
 * Returns column metadata and decoded row data.
 */
function parseResultRows(body: Uint8Array): {
  columns: Array<{ keyspace: string; table: string; name: string; type: string }>;
  rows: Array<Record<string, string | null>>;
} {
  const view = new DataView(body.buffer, body.byteOffset);
  let off = 0;
  const kind = view.getInt32(off, false); off += 4;
  if (kind !== RESULT_KIND_ROWS) return { columns: [], rows: [] };
  const flags = view.getInt32(off, false); off += 4;
  const colCount = view.getInt32(off, false); off += 4;
  const hasGlobal = (flags & 0x0001) !== 0;
  let gKs = '', gTbl = '';
  if (hasGlobal) {
    [gKs, off] = readCqlShortString(body, off);
    [gTbl, off] = readCqlShortString(body, off);
  }
  const columns: Array<{ keyspace: string; table: string; name: string; type: string }> = [];
  for (let i = 0; i < colCount; i++) {
    let ks = gKs, tbl = gTbl;
    if (!hasGlobal) {
      [ks, off] = readCqlShortString(body, off);
      [tbl, off] = readCqlShortString(body, off);
    }
    let name: string;
    [name, off] = readCqlShortString(body, off);
    const typeId = view.getInt16(off, false); off += 2;
    if (typeId === 0x0020 || typeId === 0x0022) off += 2;  // list/set: skip element type
    else if (typeId === 0x0021) off += 4;                   // map: skip key+val types
    columns.push({
      keyspace: ks, table: tbl, name,
      type: CQL_TYPE_NAMES[typeId] ?? ('0x' + typeId.toString(16)),
    });
  }
  const rowCount = view.getInt32(off, false); off += 4;
  const rows: Array<Record<string, string | null>> = [];
  for (let r = 0; r < rowCount; r++) {
    const row: Record<string, string | null> = {};
    for (let c = 0; c < columns.length; c++) {
      const cellLen = view.getInt32(off, false); off += 4;
      if (cellLen === -1) {
        row[columns[c].name] = null;
      } else {
        row[columns[c].name] = new TextDecoder().decode(body.slice(off, off + cellLen));
        off += cellLen;
      }
    }
    rows.push(row);
  }
  return { columns, rows };
}

/**
 * Execute a CQL query and return parsed column/row results.
 *
 * POST /api/cassandra/query
 * Body: { host, port?, timeout?, cql, username?, password? }
 *
 * Protocol flow: OPTIONS -> STARTUP -> (AUTH_RESPONSE if needed) -> QUERY -> parse RESULT
 */
export async function handleCassandraQuery(request: Request, _env: unknown): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
      cql: string;
      username?: string;
      password?: string;
    };
    const { host, port = 9042, timeout = 15000, cql, username = '', password = '' } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!cql) {
      return new Response(JSON.stringify({ success: false, error: 'CQL query is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        // Step 1: OPTIONS - discover server capabilities
        await writer.write(buildOptionsFrame());
        const optResp = await readFrame(reader);
        let supported: Record<string, string[]> = {};
        if (optResp.opcode === OPCODE_SUPPORTED) {
          supported = parseStringMultimap(optResp.body);
        }

        // Step 2: STARTUP - negotiate CQL version
        await writer.write(buildStartupFrame());
        const startResp = await readFrame(reader);

        if (startResp.opcode === OPCODE_AUTHENTICATE) {
          // Server requires auth - send SASL PLAIN credentials
          await writer.write(buildAuthResponseFrame(username, password));
          const authResp = await readFrame(reader);
          if (authResp.opcode !== OPCODE_AUTH_SUCCESS_RESP && authResp.opcode !== OPCODE_READY) {
            const msg = authResp.opcode === OPCODE_ERROR
              ? parseError(authResp.body).message
              : getOpcodeName(authResp.opcode);
            throw new Error(`Authentication failed: ${msg}`);
          }
        } else if (startResp.opcode === OPCODE_ERROR) {
          const err = parseError(startResp.body);
          throw new Error(`STARTUP failed: ${err.message} (code ${err.code})`);
        } else if (startResp.opcode !== OPCODE_READY) {
          throw new Error(`Unexpected STARTUP response: ${getOpcodeName(startResp.opcode)}`);
        }

        // Step 3: QUERY - execute CQL and parse result
        await writer.write(buildQueryFrame(cql));
        const queryResp = await readFrame(reader);
        const rtt = Date.now() - startTime;

        if (queryResp.opcode === OPCODE_ERROR) {
          const err = parseError(queryResp.body);
          writer.releaseLock(); reader.releaseLock(); socket.close();
          return {
            success: false, host, port, rtt,
            error: `Query error: ${err.message} (code ${err.code})`,
            cqlVersions: supported['CQL_VERSION'] ?? [],
          };
        }

        let columns: Array<{ keyspace: string; table: string; name: string; type: string }> = [];
        let rows: Array<Record<string, string | null>> = [];
        if (queryResp.opcode === 0x08) { // RESULT opcode
          ({ columns, rows } = parseResultRows(queryResp.body));
        }

        writer.releaseLock(); reader.releaseLock(); socket.close();
        return {
          success: true, host, port, rtt,
          cqlVersions: supported['CQL_VERSION'] ?? [],
          columns, rows, rowCount: rows.length,
        };
      } catch (err) {
        writer.releaseLock(); reader.releaseLock(); socket.close();
        throw err;
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

// ============================================================
// CQL Prepared Statement Execution (handleCassandraPrepare)
// ============================================================

/** Build a PREPARE frame (opcode 0x09): long-string encoded CQL. */
function buildPrepareFrame(cql: string, stream = 3): Uint8Array {
  const qBytes = new TextEncoder().encode(cql);
  const body = new Uint8Array(4 + qBytes.length);
  new DataView(body.buffer).setInt32(0, qBytes.length, false);
  body.set(qBytes, 4);
  return buildFrame(OPCODE_PREPARE, body, stream);
}

/** Extract the prepared_id bytes from a PREPARED RESULT body (kind=0x0004). */
function parsePreparedId(body: Uint8Array): Uint8Array | null {
  if (body.length < 6) return null;
  const view = new DataView(body.buffer, body.byteOffset);
  const kind = view.getInt32(0, false);
  if (kind !== 0x0004) return null; // not PREPARED
  const idLen = view.getInt16(4, false);
  if (idLen <= 0 || 6 + idLen > body.length) return null;
  return body.slice(6, 6 + idLen);
}

/**
 * Build an EXECUTE frame (opcode 0x0A) with string-valued bound parameters.
 * Values are serialized as UTF-8 bytes.
 */
function buildExecuteFrame(
  preparedId: Uint8Array,
  values: string[],
  stream = 4,
): Uint8Array {
  // Header: short_bytes(preparedId) + consistency(2) + flags(1)
  // If values present, flags=0x01, then 2-byte count + [4-byte len + bytes]*
  const hasValues = values.length > 0;
  const encodedValues = values.map(v => new TextEncoder().encode(v));
  const valuesLen = hasValues
    ? 2 + encodedValues.reduce((n, b) => n + 4 + b.length, 0)
    : 0;
  const body = new Uint8Array(2 + preparedId.length + 2 + 1 + valuesLen);
  const view = new DataView(body.buffer);
  let off = 0;
  view.setInt16(off, preparedId.length, false); off += 2;
  body.set(preparedId, off); off += preparedId.length;
  view.setInt16(off, 0x0001, false); off += 2; // consistency ONE
  body[off] = hasValues ? 0x01 : 0x00; off += 1; // flags
  if (hasValues) {
    view.setInt16(off, values.length, false); off += 2;
    for (const b of encodedValues) {
      view.setInt32(off, b.length, false); off += 4;
      body.set(b, off); off += b.length;
    }
  }
  return buildFrame(OPCODE_EXECUTE, body, stream);
}

/**
 * POST /api/cassandra/prepare
 * Body: { host, port?, timeout?, cql, values?: string[], username?, password? }
 *
 * PREPARE a parameterized CQL query, then EXECUTE it with bound string values.
 * Returns the prepared statement metadata + query result rows.
 */
export async function handleCassandraPrepare(request: Request, _env: unknown): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number; timeout?: number;
      cql: string; values?: string[];
      username?: string; password?: string;
    };
    const { host, port = 9042, timeout = 15000, cql, values = [], username = '', password = '' } = body;

    if (!host) return new Response(JSON.stringify({ success: false, error: 'Host is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (!cql)  return new Response(JSON.stringify({ success: false, error: 'CQL is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout));

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        // OPTIONS + STARTUP + optional AUTH
        await writer.write(buildOptionsFrame());
        const optResp = await readFrame(reader);
        const supported: Record<string, string[]> = optResp.opcode === OPCODE_SUPPORTED ? parseStringMultimap(optResp.body) : {};

        await writer.write(buildStartupFrame());
        const startResp = await readFrame(reader);
        if (startResp.opcode === OPCODE_AUTHENTICATE) {
          await writer.write(buildAuthResponseFrame(username, password));
          const authResp = await readFrame(reader);
          if (authResp.opcode !== OPCODE_AUTH_SUCCESS_RESP && authResp.opcode !== OPCODE_READY) {
            throw new Error(`Authentication failed: ${authResp.opcode === OPCODE_ERROR ? parseError(authResp.body).message : getOpcodeName(authResp.opcode)}`);
          }
        } else if (startResp.opcode === OPCODE_ERROR) {
          throw new Error(`STARTUP failed: ${parseError(startResp.body).message}`);
        } else if (startResp.opcode !== OPCODE_READY) {
          throw new Error(`Unexpected STARTUP response: ${getOpcodeName(startResp.opcode)}`);
        }

        // PREPARE
        await writer.write(buildPrepareFrame(cql));
        const prepResp = await readFrame(reader);
        if (prepResp.opcode === OPCODE_ERROR) throw new Error(`PREPARE error: ${parseError(prepResp.body).message}`);
        if (prepResp.opcode !== OPCODE_RESULT) throw new Error(`Unexpected PREPARE response: ${getOpcodeName(prepResp.opcode)}`);
        const preparedId = parsePreparedId(prepResp.body);
        if (!preparedId) throw new Error('Could not parse prepared statement ID');

        // EXECUTE with bound values
        await writer.write(buildExecuteFrame(preparedId, values));
        const execResp = await readFrame(reader);
        const rtt = Date.now() - startTime;

        if (execResp.opcode === OPCODE_ERROR) {
          const err = parseError(execResp.body);
          writer.releaseLock(); reader.releaseLock(); socket.close();
          return { success: false, host, port, rtt, error: `EXECUTE error: ${err.message} (code ${err.code})`, cqlVersions: supported['CQL_VERSION'] ?? [] };
        }

        let columns: Array<{ keyspace: string; table: string; name: string; type: string }> = [];
        let rows: Array<Record<string, string | null>> = [];
        if (execResp.opcode === OPCODE_RESULT) {
          ({ columns, rows } = parseResultRows(execResp.body));
        }

        writer.releaseLock(); reader.releaseLock(); socket.close();
        return {
          success: true, host, port, rtt,
          preparedIdHex: Array.from(preparedId).map(b => b.toString(16).padStart(2, '0')).join(''),
          cqlVersions: supported['CQL_VERSION'] ?? [],
          columns, rows, rowCount: rows.length,
        };
      } catch (err) {
        writer.releaseLock(); reader.releaseLock(); socket.close();
        throw err;
      }
    })();

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
