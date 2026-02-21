/**
 * ClickHouse Protocol Implementation
 *
 * Supports two interfaces:
 *
 * 1. HTTP Interface (port 8123) — Used for health checks and SQL queries.
 *    Queries are sent as HTTP/1.1 requests with SQL in the body or query param.
 *
 * 2. Native TCP Protocol (port 9000) — Binary wire protocol used by
 *    clickhouse-client and native drivers. Implements VarUInt/String encoding,
 *    Client Hello / Server Hello handshake, and basic query execution.
 *
 * HTTP Protocol Flow:
 *   Client → GET /ping                → "Ok.\n"
 *   Client → GET /?query=SQL          → TabSeparated result
 *   Client → POST / (body=SQL)        → Result in requested format
 *
 * Native Protocol Flow:
 *   Client → ClientHello (packet type 0)
 *   Server → ServerHello (packet type 0) | ServerException (packet type 2)
 *   Client → ClientQuery (packet type 1) + ClientData (packet type 2, empty)
 *   Server → ServerData (packet type 1) with column info
 *   Server → ServerData (packet type 1) with row data
 *   Server → ServerEndOfStream (packet type 5)
 *
 * Default Ports: 8123 (HTTP), 9000 (Native TCP), 9440 (Native TCP + TLS)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// ─── Shared Types ────────────────────────────────────────────────────────────

interface ClickHouseRequest {
  host: string;
  port?: number;
  user?: string;
  password?: string;
  timeout?: number;
}

interface ClickHouseQueryRequest extends ClickHouseRequest {
  query: string;
  database?: string;
  format?: string;
}

interface ClickHouseNativeRequest extends ClickHouseRequest {
  database?: string;
  query?: string;
}

interface ClickHouseResponse {
  success: boolean;
  statusCode?: number;
  version?: string;
  serverInfo?: unknown;
  databases?: string[];
  latencyMs?: number;
  error?: string;
  isCloudflare?: boolean;
}

interface ClickHouseNativeResponse {
  success: boolean;
  serverName?: string;
  serverVersion?: string;
  serverRevision?: number;
  serverTimezone?: string;
  serverDisplayName?: string;
  latencyMs?: number;
  queryResult?: {
    columns?: Array<{ name: string; type: string }>;
    rows?: string[][];
    rowCount?: number;
  };
  error?: string;
  isCloudflare?: boolean;
}

// ─── Native Protocol Constants ───────────────────────────────────────────────

/** Client packet types (client → server) */
const ClientPacketType = {
  Hello: 0,
  Query: 1,
  Data: 2,
  Cancel: 3,
  Ping: 4,
} as const;

/** Server packet types (server → client) */
const ServerPacketType = {
  Hello: 0,
  Data: 1,
  Exception: 2,
  Progress: 3,
  Pong: 4,
  EndOfStream: 5,
  ProfileInfo: 6,
  Totals: 7,
  Extremes: 8,
  TablesStatusResponse: 9,
  Log: 10,
  TableColumns: 11,
  ProfileEvents: 14,
} as const;

/** Query processing stages */
const QueryStage = {
  FetchColumns: 0,
  WithMergeableState: 1,
  Complete: 2,
} as const;

/** Compression method identifiers */
const CompressionMethod = {
  None: 0,
} as const;

// ─── VarUInt Encoding (ClickHouse Native Protocol) ──────────────────────────
//
// ClickHouse uses unsigned LEB128 (same as Protocol Buffers varint).
// Each byte stores 7 data bits + 1 continuation bit (MSB).
// Values 0-127 fit in 1 byte, 128-16383 in 2 bytes, etc.
//
// Example: 300 (0x12C)
//   Byte 1: 0xAC  (0b10101100) → bits 6..0 = 0x2C, continuation=1
//   Byte 2: 0x02  (0b00000010) → bits 13..7 = 0x02, continuation=0
//   Result: (0x02 << 7) | 0x2C = 256 + 44 = 300

/**
 * Encode a non-negative integer as a VarUInt (unsigned LEB128).
 * Produces 1-9 bytes for values up to 2^63-1.
 */
function encodeVarUInt(value: number): Uint8Array {
  const bytes: number[] = [];
  let v = value;
  while (v >= 0x80) {
    bytes.push((v & 0x7F) | 0x80);
    v = Math.floor(v / 128); // avoid bitwise for values > 2^31
  }
  bytes.push(v & 0x7F);
  return new Uint8Array(bytes);
}

/**
 * Decode a VarUInt from a buffer at the given offset.
 * Returns [value, bytesConsumed].
 */
function decodeVarUInt(data: Uint8Array, offset: number): [number, number] {
  let result = 0n; // Use BigInt to avoid precision loss for shift >= 53
  let shift = 0n;
  let bytesRead = 0;

  for (let i = 0; i < 9; i++) { // max 9 bytes for 64-bit
    if (offset + bytesRead >= data.length) {
      throw new Error('VarUInt: unexpected end of data');
    }
    const byte = data[offset + bytesRead];
    bytesRead++;
    result |= BigInt(byte & 0x7F) << shift;
    shift += 7n;
    if ((byte & 0x80) === 0) {
      return [Number(result), bytesRead]; // Safe for values < 2^53
    }
  }
  throw new Error('VarUInt: too many bytes (max 9)');
}

// ─── Native Protocol String Encoding ────────────────────────────────────────
//
// Strings are encoded as: [VarUInt length][UTF-8 bytes]
// The length is the byte count of the UTF-8 encoding, NOT the character count.

/**
 * Encode a string in ClickHouse native format: VarUInt length + UTF-8 bytes
 */
function encodeNativeString(str: string): Uint8Array {
  const encoder = new TextEncoder();
  const strBytes = encoder.encode(str);
  const lenBytes = encodeVarUInt(strBytes.length);
  const result = new Uint8Array(lenBytes.length + strBytes.length);
  result.set(lenBytes, 0);
  result.set(strBytes, lenBytes.length);
  return result;
}

/**
 * Decode a string from ClickHouse native format at the given offset.
 * Returns [string, bytesConsumed].
 */
function decodeNativeString(data: Uint8Array, offset: number): [string, number] {
  const [strLen, lenBytes] = decodeVarUInt(data, offset);
  const strStart = offset + lenBytes;
  const strEnd = strStart + strLen;
  if (strEnd > data.length) {
    throw new Error(`String: need ${strLen} bytes but only ${data.length - strStart} available`);
  }
  const decoder = new TextDecoder();
  const str = decoder.decode(data.slice(strStart, strEnd));
  return [str, lenBytes + strLen];
}

// ─── Native Protocol Packet Building ────────────────────────────────────────

/**
 * Concatenate multiple Uint8Arrays into one
 */
function concat(...arrays: Uint8Array[]): Uint8Array {
  let totalLen = 0;
  for (const a of arrays) totalLen += a.length;
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

/**
 * Build a ClientHello packet.
 *
 * Wire format:
 *   [VarUInt packet_type=0]
 *   [String client_name]
 *   [VarUInt client_version_major]
 *   [VarUInt client_version_minor]
 *   [VarUInt client_tcp_protocol_version]
 *   [String database]
 *   [String user]
 *   [String password]
 */
function buildClientHello(
  database: string,
  user: string,
  password: string,
): Uint8Array {
  return concat(
    encodeVarUInt(ClientPacketType.Hello),
    encodeNativeString('PortOfCall'),       // client_name
    encodeVarUInt(1),                        // client_version_major
    encodeVarUInt(0),                        // client_version_minor
    encodeVarUInt(54046),                    // tcp_protocol_version (CH 21.3+)
    encodeNativeString(database),            // database
    encodeNativeString(user),                // user
    encodeNativeString(password),            // password
  );
}

/**
 * Build a ClientQuery packet.
 *
 * Wire format:
 *   [VarUInt packet_type=1]
 *   [String query_id]           — empty for auto-assigned
 *   --- Client Info block ---
 *   [UInt8 query_kind]          — 1 = InitialQuery
 *   [String initial_user]       — empty for non-distributed
 *   [String initial_query_id]   — empty for non-distributed
 *   [String initial_address]    — "[::ffff:127.0.0.1]:0"
 *   [UInt8 interface]           — 1 = TCP
 *   [String os_user]
 *   [String client_hostname]
 *   [String client_name]
 *   [VarUInt client_version_major]
 *   [VarUInt client_version_minor]
 *   [VarUInt client_tcp_protocol_version]
 *   [String quota_key]          — empty
 *   [VarUInt client_write_info] — 0 (no interserver secret since rev >= DBMS_MIN_PROTOCOL_VERSION_WITH_INTERSERVER_SECRET)
 *   --- End Client Info ---
 *   [String settings]           — empty (serialized as empty)
 *   [String interserver_secret] — empty
 *   [VarUInt query_stage]       — 2 = Complete
 *   [VarUInt compression]       — 0 = None
 *   [String query_text]
 */
function buildClientQuery(
  query: string,
  user: string,
): Uint8Array {
  // Note: database selection happens in the ClientHello packet, not here.
  // The initial_user field is for distributed query tracking.
  return concat(
    encodeVarUInt(ClientPacketType.Query),
    encodeNativeString(''),                   // query_id (auto-assign)

    // Client Info
    new Uint8Array([1]),                       // query_kind = InitialQuery
    encodeNativeString(user),                  // initial_user
    encodeNativeString(''),                    // initial_query_id
    encodeNativeString('[::ffff:127.0.0.1]:0'),// initial_address
    new Uint8Array([1]),                       // interface = TCP

    encodeNativeString('portofcall'),          // os_user
    encodeNativeString('portofcall'),          // client_hostname
    encodeNativeString('PortOfCall'),          // client_name
    encodeVarUInt(1),                          // client_version_major
    encodeVarUInt(0),                          // client_version_minor
    encodeVarUInt(54046),                      // tcp_protocol_version
    encodeNativeString(''),                    // quota_key
    encodeVarUInt(0),                          // client_write_info count (settings serialized as pair count)

    // Settings (serialized as empty string = end of settings)
    encodeNativeString(''),                    // empty string = no more settings

    // Interserver secret (empty for non-cluster queries)
    encodeNativeString(''),                    // interserver_secret

    encodeVarUInt(QueryStage.Complete),        // stage
    encodeVarUInt(CompressionMethod.None),     // compression
    encodeNativeString(query),                 // query text
  );
}

/**
 * Build an empty ClientData packet (signals end of client data for SELECT queries).
 *
 * Wire format:
 *   [VarUInt packet_type=2]
 *   [String table_name]         — empty
 *   --- Block header ---
 *   [VarUInt num_columns=0]
 *   [VarUInt num_rows=0]
 */
function buildEmptyClientData(): Uint8Array {
  return concat(
    encodeVarUInt(ClientPacketType.Data),
    encodeNativeString(''),                    // table_name (empty for non-insert)

    // Block info (required since protocol version 51302+)
    // Field 1: is_overflows (VarUInt field_num=1, UInt8 value=0)
    encodeVarUInt(1),                          // field_num = 1 (is_overflows)
    new Uint8Array([0]),                       // is_overflows = false
    // Field 2: bucket_num (VarUInt field_num=2, Int32 value=-1)
    encodeVarUInt(2),                          // field_num = 2 (bucket_num)
    new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]),  // bucket_num = -1 (little-endian)
    // End of block info
    encodeVarUInt(0),                          // field_num = 0 (end of block info)

    encodeVarUInt(0),                          // num_columns
    encodeVarUInt(0),                          // num_rows
  );
}

// ─── Native Protocol Response Parsing ───────────────────────────────────────

interface ParsedServerHello {
  serverName: string;
  versionMajor: number;
  versionMinor: number;
  revision: number;
  timezone?: string;
  displayName?: string;
}

interface ParsedServerException {
  code: number;
  name: string;
  message: string;
  stackTrace: string;
  hasNested: boolean;
}

interface ParsedDataBlock {
  numColumns: number;
  numRows: number;
  columns: Array<{ name: string; type: string }>;
  data: string[][]; // rows of string values
}

/**
 * Parse a ServerHello response from the buffer.
 */
function parseServerHello(data: Uint8Array, offset: number): [ParsedServerHello, number] {
  const startOffset = offset;

  const [serverName, nameLen] = decodeNativeString(data, offset);
  offset += nameLen;

  const [versionMajor, majLen] = decodeVarUInt(data, offset);
  offset += majLen;

  const [versionMinor, minLen] = decodeVarUInt(data, offset);
  offset += minLen;

  const [revision, revLen] = decodeVarUInt(data, offset);
  offset += revLen;

  const result: ParsedServerHello = {
    serverName,
    versionMajor,
    versionMinor,
    revision,
  };

  // Timezone field added in revision 54423
  if (revision >= 54423 && offset < data.length) {
    try {
      const [timezone, tzLen] = decodeNativeString(data, offset);
      offset += tzLen;
      result.timezone = timezone;
    } catch {
      // Timezone not available
    }
  }

  // Display name added in revision 54372
  if (revision >= 54372 && offset < data.length) {
    try {
      const [displayName, dnLen] = decodeNativeString(data, offset);
      offset += dnLen;
      result.displayName = displayName;
    } catch {
      // Display name not available
    }
  }

  return [result, offset - startOffset];
}

/**
 * Parse a ServerException response from the buffer.
 */
function parseServerException(data: Uint8Array, offset: number): [ParsedServerException, number] {
  const startOffset = offset;

  // code (UInt32 LE)
  if (offset + 4 > data.length) {
    throw new Error('ServerException: not enough data for error code');
  }
  const code = data[offset] | (data[offset + 1] << 8) |
               (data[offset + 2] << 16) | (data[offset + 3] << 24);
  offset += 4;

  const [name, nameLen] = decodeNativeString(data, offset);
  offset += nameLen;

  const [message, msgLen] = decodeNativeString(data, offset);
  offset += msgLen;

  const [stackTrace, stLen] = decodeNativeString(data, offset);
  offset += stLen;

  // hasNested (UInt8)
  const hasNested = offset < data.length ? data[offset] !== 0 : false;
  if (offset < data.length) offset += 1;

  return [{ code, name, message, stackTrace, hasNested }, offset - startOffset];
}

/**
 * Parse a Data block (simplified — handles String and common integer types).
 * For the native probe we only need to read column names, types, and basic values.
 */
function parseDataBlock(data: Uint8Array, offset: number): [ParsedDataBlock, number] {
  const startOffset = offset;

  // Block info (field_num loop)
  while (offset < data.length) {
    const [fieldNum, fnLen] = decodeVarUInt(data, offset);
    offset += fnLen;
    if (fieldNum === 0) break; // end of block info
    if (fieldNum === 1) {
      // is_overflows: UInt8
      offset += 1;
    } else if (fieldNum === 2) {
      // bucket_num: Int32
      offset += 4;
    } else {
      // Unknown field — skip safely
      break;
    }
  }

  const [numColumns, ncLen] = decodeVarUInt(data, offset);
  offset += ncLen;

  const [numRows, nrLen] = decodeVarUInt(data, offset);
  offset += nrLen;

  const columns: Array<{ name: string; type: string }> = [];
  const rows: string[][] = [];

  // Read column names and types
  for (let col = 0; col < numColumns; col++) {
    const [colName, cnLen] = decodeNativeString(data, offset);
    offset += cnLen;

    const [colType, ctLen] = decodeNativeString(data, offset);
    offset += ctLen;

    columns.push({ name: colName, type: colType });

    // Read column data (all values for this column, then next column)
    // We do a best-effort parse for common types
    const colValues: string[] = [];
    for (let row = 0; row < numRows; row++) {
      try {
        const [val, valLen] = readColumnValue(data, offset, colType);
        offset += valLen;
        colValues.push(val);
      } catch {
        colValues.push('<parse error>');
        break; // stop trying to read more rows for this column
      }
    }

    // Store column values; we'll transpose later
    for (let row = 0; row < colValues.length; row++) {
      if (!rows[row]) rows[row] = [];
      rows[row][col] = colValues[row];
    }
  }

  return [{ numColumns, numRows, columns, data: rows }, offset - startOffset];
}

/**
 * Read a single column value based on ClickHouse type.
 * Returns [stringRepresentation, bytesConsumed].
 */
function readColumnValue(data: Uint8Array, offset: number, type: string): [string, number] {
  // String type
  if (type === 'String' || type === 'FixedString' || type.startsWith('LowCardinality(String')) {
    const [val, len] = decodeNativeString(data, offset);
    return [val, len];
  }

  // UInt8
  if (type === 'UInt8') {
    return [String(data[offset]), 1];
  }

  // UInt16
  if (type === 'UInt16') {
    const val = data[offset] | (data[offset + 1] << 8);
    return [String(val), 2];
  }

  // UInt32
  if (type === 'UInt32') {
    const val = (data[offset] | (data[offset + 1] << 8) |
                 (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
    return [String(val), 4];
  }

  // UInt64
  if (type === 'UInt64') {
    const lo = (data[offset] | (data[offset + 1] << 8) |
                (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
    const hi = (data[offset + 4] | (data[offset + 5] << 8) |
                (data[offset + 6] << 16) | (data[offset + 7] << 24)) >>> 0;
    const val = BigInt(hi) * BigInt(0x100000000) + BigInt(lo);
    return [val.toString(), 8];
  }

  // Int8
  if (type === 'Int8') {
    const val = data[offset] > 127 ? data[offset] - 256 : data[offset];
    return [String(val), 1];
  }

  // Int16
  if (type === 'Int16') {
    const val = data[offset] | (data[offset + 1] << 8);
    return [String(val > 32767 ? val - 65536 : val), 2];
  }

  // Int32
  if (type === 'Int32') {
    const val = data[offset] | (data[offset + 1] << 8) |
                (data[offset + 2] << 16) | (data[offset + 3] << 24);
    return [String(val), 4];
  }

  // Int64
  if (type === 'Int64') {
    // Read as unsigned first, then interpret as signed
    const lo = (data[offset] | (data[offset + 1] << 8) |
                (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
    const hi = (data[offset + 4] | (data[offset + 5] << 8) |
                (data[offset + 6] << 16) | (data[offset + 7] << 24)) >>> 0;
    const val = (BigInt(hi) << BigInt(32)) | BigInt(lo);
    return [val.toString(), 8];
  }

  // Float32
  if (type === 'Float32') {
    const view = new DataView(data.buffer, data.byteOffset + offset, 4);
    return [String(view.getFloat32(0, true)), 4];
  }

  // Float64
  if (type === 'Float64') {
    const view = new DataView(data.buffer, data.byteOffset + offset, 8);
    return [String(view.getFloat64(0, true)), 8];
  }

  // DateTime (UInt32 unix timestamp)
  if (type === 'DateTime' || type.startsWith('DateTime(')) {
    const val = (data[offset] | (data[offset + 1] << 8) |
                 (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
    return [new Date(val * 1000).toISOString(), 4];
  }

  // Date (UInt16, days since 1970-01-01)
  if (type === 'Date') {
    const days = data[offset] | (data[offset + 1] << 8);
    const d = new Date(days * 86400000);
    return [d.toISOString().split('T')[0], 2];
  }

  // Nullable wrapper — has a 1-byte null indicator before the value
  if (type.startsWith('Nullable(')) {
    const innerType = type.slice(9, -1);
    const isNull = data[offset] !== 0;
    if (isNull) {
      const [, innerLen] = readColumnValue(data, offset + 1, innerType);
      return ['NULL', 1 + innerLen];
    }
    const [val, innerLen] = readColumnValue(data, offset + 1, innerType);
    return [val, 1 + innerLen];
  }

  // Fallback: try to read as a native string (many types serialize this way)
  try {
    const [val, len] = decodeNativeString(data, offset);
    return [val, len];
  } catch {
    return ['<unknown type: ' + type + '>', 0];
  }
}

// ─── Native Protocol Socket I/O ─────────────────────────────────────────────

/**
 * Read data from socket into a buffer, accumulating until we have enough
 * or the connection closes.
 */
async function readNativeResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
  maxBytes = 262144,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLen = 0;

  // Read the first chunk (blocking with timeout)
  const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
  if (done || !value) return new Uint8Array(0);
  chunks.push(value);
  totalLen += value.length;

  // Continue reading with a short timeout for additional data
  try {
    const shortTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('read_done')), 1000),
    );
    while (totalLen < maxBytes) {
      const { value: next, done: nextDone } = await Promise.race([reader.read(), shortTimeout]);
      if (nextDone || !next) break;
      chunks.push(next);
      totalLen += next.length;
    }
  } catch {
    // Short timeout expired — we have all available data
  }

  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

// ─── HTTP Interface Helpers ─────────────────────────────────────────────────

/**
 * Send a raw HTTP/1.1 request over a TCP socket
 */
async function sendHttpRequest(
  host: string,
  port: number,
  method: string,
  path: string,
  body?: string,
  headers?: Record<string, string>,
  timeout = 15000,
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  await Promise.race([socket.opened, timeoutPromise]);

  const writer = socket.writable.getWriter();
  const encoder = new TextEncoder();

  // Build the full HTTP request as a single buffer to avoid split-write issues
  let requestStr = `${method} ${path} HTTP/1.1\r\n`;
  requestStr += `Host: ${host}:${port}\r\n`;
  requestStr += `Connection: close\r\n`;
  requestStr += `User-Agent: PortOfCall/1.0\r\n`;

  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      requestStr += `${key}: ${value}\r\n`;
    }
  }

  if (body) {
    const bodyBytes = encoder.encode(body);
    requestStr += `Content-Type: text/plain\r\n`;
    requestStr += `Content-Length: ${bodyBytes.length}\r\n`;
    requestStr += `\r\n`;
    // Write headers + body as a single combined buffer to avoid TCP fragmentation issues
    const headerBytes = encoder.encode(requestStr);
    const combined = new Uint8Array(headerBytes.length + bodyBytes.length);
    combined.set(headerBytes, 0);
    combined.set(bodyBytes, headerBytes.length);
    await writer.write(combined);
  } else {
    requestStr += `\r\n`;
    await writer.write(encoder.encode(requestStr));
  }

  writer.releaseLock();

  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  let response = '';
  const maxSize = 512000;

  while (response.length < maxSize) {
    const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
    if (done) break;
    if (value) {
      response += decoder.decode(value, { stream: true });
    }
  }

  // Flush the streaming decoder to handle any remaining bytes
  response += decoder.decode(new Uint8Array(0), { stream: false });

  reader.releaseLock();
  socket.close();

  const headerEnd = response.indexOf('\r\n\r\n');
  if (headerEnd === -1) {
    throw new Error('Invalid HTTP response: no header terminator found');
  }

  const headerSection = response.substring(0, headerEnd);
  let bodySection = response.substring(headerEnd + 4);

  const statusLine = headerSection.split('\r\n')[0];
  const statusMatch = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/);
  const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;

  const respHeaders: Record<string, string> = {};
  const headerLines = headerSection.split('\r\n').slice(1);
  for (const line of headerLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim().toLowerCase();
      const value = line.substring(colonIdx + 1).trim();
      respHeaders[key] = value;
    }
  }

  if (respHeaders['transfer-encoding']?.includes('chunked')) {
    bodySection = decodeChunked(bodySection);
  }

  return { statusCode, headers: respHeaders, body: bodySection };
}

/**
 * Decode chunked transfer encoding.
 *
 * Chunked format: [hex-size]\r\n[chunk-data]\r\n ... 0\r\n\r\n
 * Each chunk has its size in hex, followed by CRLF, followed by that many bytes,
 * followed by CRLF. A chunk of size 0 terminates the body.
 */
function decodeChunked(data: string): string {
  let result = '';
  let remaining = data;

  while (remaining.length > 0) {
    const lineEnd = remaining.indexOf('\r\n');
    if (lineEnd === -1) break;

    const sizeStr = remaining.substring(0, lineEnd).trim();
    // Handle chunk extensions (rare): size may be followed by ";ext=value"
    const semicolonIdx = sizeStr.indexOf(';');
    const cleanSize = semicolonIdx >= 0 ? sizeStr.substring(0, semicolonIdx).trim() : sizeStr;
    const chunkSize = parseInt(cleanSize, 16);
    if (isNaN(chunkSize) || chunkSize === 0) break;

    const chunkStart = lineEnd + 2;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > remaining.length) {
      // Partial chunk — take what we have
      result += remaining.substring(chunkStart);
      break;
    }

    result += remaining.substring(chunkStart, chunkEnd);
    // Skip the trailing CRLF after the chunk data
    remaining = remaining.substring(chunkEnd + 2);
  }

  return result;
}

/**
 * Build auth query params for ClickHouse HTTP interface
 */
function buildAuthParams(user?: string, password?: string): string {
  const params: string[] = [];
  if (user) {
    params.push(`user=${encodeURIComponent(user)}`);
  }
  if (password) {
    params.push(`password=${encodeURIComponent(password)}`);
  }
  return params.length > 0 ? params.join('&') : '';
}

// ─── Input Validation ───────────────────────────────────────────────────────

function validateInput(host: string, port: number): string | null {
  if (!host || host.trim().length === 0) {
    return 'Host is required';
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(host)) {
    return 'Host contains invalid characters';
  }
  if (port < 1 || port > 65535) {
    return 'Port must be between 1 and 65535';
  }
  return null;
}

// ─── Handler: Native Protocol Probe ─────────────────────────────────────────

/**
 * Handle ClickHouse native protocol probe
 *
 * POST /api/clickhouse/native
 * Body: { host, port?, user?, password?, database?, query?, timeout? }
 *
 * Performs a Client Hello / Server Hello handshake on port 9000 (native TCP).
 * Optionally executes a query using the native binary protocol.
 *
 * Returns server name, version, revision, timezone, and optional query results.
 */
export async function handleClickHouseNative(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as ClickHouseNativeRequest;
    const {
      host,
      port = 9000,
      user = 'default',
      password = '',
      database = 'default',
      query,
      timeout = 15000,
    } = body;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError } satisfies ClickHouseNativeResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        } satisfies ClickHouseNativeResponse),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const start = Date.now();
    const socket = connect(`${host}:${port}`);

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Step 1: Send ClientHello
      const clientHello = buildClientHello(database, user, password);
      await writer.write(clientHello);

      // Step 2: Read ServerHello or ServerException
      const helloResponse = await readNativeResponse(reader, timeoutPromise);

      if (helloResponse.length === 0) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(
          JSON.stringify({
            success: false,
            error: 'No response from server (is this a ClickHouse native port?)',
          } satisfies ClickHouseNativeResponse),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Parse server response packet type
      const [packetType, ptLen] = decodeVarUInt(helloResponse, 0);
      const offset = ptLen;

      if (packetType === ServerPacketType.Exception) {
        // Server rejected us
        const [exception] = parseServerException(helloResponse, offset);
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(
          JSON.stringify({
            success: false,
            error: `ClickHouse error ${exception.code}: ${exception.name} — ${exception.message}`,
          } satisfies ClickHouseNativeResponse),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (packetType !== ServerPacketType.Hello) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(
          JSON.stringify({
            success: false,
            error: `Unexpected server packet type: ${packetType} (expected ServerHello=0)`,
          } satisfies ClickHouseNativeResponse),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Parse ServerHello
      const [serverHello] = parseServerHello(helloResponse, offset);
      const serverVersion = `${serverHello.versionMajor}.${serverHello.versionMinor}`;

      const result: ClickHouseNativeResponse = {
        success: true,
        serverName: serverHello.serverName,
        serverVersion,
        serverRevision: serverHello.revision,
        serverTimezone: serverHello.timezone,
        serverDisplayName: serverHello.displayName,
        latencyMs: Date.now() - start,
      };

      // Step 3: Optionally execute a query
      if (query && query.trim().length > 0) {
        try {
          // Send Query + empty Data block
          const queryPacket = buildClientQuery(query, user);
          const emptyData = buildEmptyClientData();
          const combined = concat(queryPacket, emptyData);
          await writer.write(combined);

          // Read response packets
          const queryResponse = await readNativeResponse(reader, timeoutPromise, 524288);

          if (queryResponse.length > 0) {
            let qOffset = 0;
            const allColumns: Array<{ name: string; type: string }> = [];
            const allRows: string[][] = [];

            // Parse all response packets
            while (qOffset < queryResponse.length) {
              const [qPacketType, qptLen] = decodeVarUInt(queryResponse, qOffset);
              qOffset += qptLen;

              if (qPacketType === ServerPacketType.Data) {
                try {
                  const [block, blockLen] = parseDataBlock(queryResponse, qOffset);
                  qOffset += blockLen;
                  if (block.columns.length > 0 && allColumns.length === 0) {
                    allColumns.push(...block.columns);
                  }
                  if (block.data.length > 0) {
                    allRows.push(...block.data);
                  }
                } catch {
                  break; // Stop parsing on error
                }
              } else if (qPacketType === ServerPacketType.Exception) {
                const [exception] = parseServerException(queryResponse, qOffset);
                result.queryResult = {
                  columns: [],
                  rows: [],
                  rowCount: 0,
                };
                result.error = `Query error ${exception.code}: ${exception.message}`;
                break;
              } else if (qPacketType === ServerPacketType.EndOfStream) {
                break;
              } else if (qPacketType === ServerPacketType.Progress) {
                // Progress: 3 VarUInts (rows, bytes, total_rows) + optionally more
                try {
                  const [, r1] = decodeVarUInt(queryResponse, qOffset); qOffset += r1;
                  const [, r2] = decodeVarUInt(queryResponse, qOffset); qOffset += r2;
                  const [, r3] = decodeVarUInt(queryResponse, qOffset); qOffset += r3;
                  // written_rows, written_bytes added in later revisions
                  if (serverHello.revision >= 54460 && qOffset < queryResponse.length) {
                    const [, r4] = decodeVarUInt(queryResponse, qOffset); qOffset += r4;
                    const [, r5] = decodeVarUInt(queryResponse, qOffset); qOffset += r5;
                  }
                } catch {
                  break;
                }
              } else if (qPacketType === ServerPacketType.ProfileInfo) {
                // ProfileInfo: skip over 7 VarUInts + 3 UInt8s
                try {
                  for (let i = 0; i < 7; i++) {
                    const [, len] = decodeVarUInt(queryResponse, qOffset);
                    qOffset += len;
                  }
                  qOffset += 3; // 3 boolean UInt8 fields
                } catch {
                  break;
                }
              } else if (qPacketType === ServerPacketType.ProfileEvents) {
                // ProfileEvents: another data block — skip it
                try {
                  const [, blockLen] = parseDataBlock(queryResponse, qOffset);
                  qOffset += blockLen;
                } catch {
                  break;
                }
              } else {
                // Unknown packet type — stop parsing
                break;
              }
            }

            if (!result.error) {
              result.queryResult = {
                columns: allColumns,
                rows: allRows,
                rowCount: allRows.length,
              };
            }
          }
        } catch (queryErr) {
          result.error = `Query execution error: ${queryErr instanceof Error ? queryErr.message : 'Unknown'}`;
        }
      }

      result.latencyMs = Date.now() - start;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Native protocol connection failed',
      } satisfies ClickHouseNativeResponse),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

// ─── Handler: HTTP Health Check ─────────────────────────────────────────────

/**
 * Handle ClickHouse health/info request (HTTP interface)
 *
 * POST /api/clickhouse/health
 * Body: { host, port?, user?, password?, timeout? }
 *
 * Returns ping status, server version, and database list
 */
export async function handleClickHouseHealth(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as ClickHouseRequest;
    const { host, port = 8123, user, password, timeout = 15000 } = body;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError } satisfies ClickHouseResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        } satisfies ClickHouseResponse),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const authParams = buildAuthParams(user, password);
    const start = Date.now();

    // GET /ping - Health check (no auth required)
    const pingResult = await sendHttpRequest(host, port, 'GET', '/ping', undefined, undefined, timeout);

    // SELECT version() - Server version
    let version = 'Unknown';
    try {
      const queryParam = encodeURIComponent('SELECT version()');
      const authSuffix = authParams ? `&${authParams}` : '';
      const versionResult = await sendHttpRequest(
        host, port, 'GET',
        `/?query=${queryParam}${authSuffix}`,
        undefined, undefined, timeout,
      );
      if (versionResult.statusCode === 200) {
        version = versionResult.body.trim();
      }
    } catch {
      // Version query might fail without auth
    }

    // SHOW DATABASES - Database listing
    let databases: string[] | undefined;
    try {
      const queryParam = encodeURIComponent('SHOW DATABASES');
      const authSuffix = authParams ? `&${authParams}` : '';
      const dbsResult = await sendHttpRequest(
        host, port, 'GET',
        `/?query=${queryParam}${authSuffix}`,
        undefined, undefined, timeout,
      );
      if (dbsResult.statusCode === 200) {
        databases = dbsResult.body.trim().split('\n').filter(Boolean);
      }
    } catch {
      // Database listing might require auth
    }

    // SELECT uptime(), currentDatabase(), hostName()
    let serverInfo: Record<string, string> = {};
    try {
      const queryParam = encodeURIComponent(
        "SELECT uptime() AS uptime, currentDatabase() AS current_db, hostName() AS hostname FORMAT JSONEachRow"
      );
      const authSuffix = authParams ? `&${authParams}` : '';
      const infoResult = await sendHttpRequest(
        host, port, 'GET',
        `/?query=${queryParam}${authSuffix}`,
        undefined, undefined, timeout,
      );
      if (infoResult.statusCode === 200) {
        try {
          serverInfo = JSON.parse(infoResult.body.trim()) as Record<string, string>;
        } catch {
          // Not JSON
        }
      }
    } catch {
      // Info query might fail
    }

    const latencyMs = Date.now() - start;

    const result: ClickHouseResponse = {
      success: pingResult.statusCode === 200,
      statusCode: pingResult.statusCode,
      version,
      serverInfo,
      databases,
      latencyMs,
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      } satisfies ClickHouseResponse),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

// ─── Handler: HTTP Query ────────────────────────────────────────────────────

/**
 * Handle ClickHouse query request (HTTP interface)
 *
 * POST /api/clickhouse/query
 * Body: { host, port?, query, database?, format?, user?, password?, timeout? }
 *
 * Executes an arbitrary SQL query against the ClickHouse server
 */
export async function handleClickHouseQuery(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const reqBody = (await request.json()) as ClickHouseQueryRequest;
    const {
      host,
      port = 8123,
      query,
      database,
      format = 'JSONCompact',
      user,
      password,
      timeout = 15000,
    } = reqBody;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!query || query.trim().length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Query is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
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
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Build query path with params
    const params: string[] = [];
    params.push(`default_format=${encodeURIComponent(format)}`);
    if (database) {
      params.push(`database=${encodeURIComponent(database)}`);
    }
    const authParams = buildAuthParams(user, password);
    if (authParams) {
      params.push(authParams);
    }

    const queryPath = `/?${params.join('&')}`;
    const start = Date.now();

    const result = await sendHttpRequest(
      host,
      port,
      'POST',
      queryPath,
      query,
      undefined,
      timeout,
    );

    const latencyMs = Date.now() - start;

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      // Not JSON (TabSeparated or other format)
    }

    return new Response(
      JSON.stringify({
        success: result.statusCode >= 200 && result.statusCode < 400,
        statusCode: result.statusCode,
        body: result.body,
        parsed,
        latencyMs,
        format,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Query failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
