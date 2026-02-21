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
    if (offset + 2 > data.length) break;
    const keyLen = view.getInt16(offset, false);
    offset += 2;
    if (offset + keyLen > data.length) break;
    const key = new TextDecoder().decode(data.slice(offset, offset + keyLen));
    offset += keyLen;

    // Read value list
    if (offset + 2 > data.length) break;
    const listLen = view.getInt16(offset, false);
    offset += 2;
    const values: string[] = [];

    for (let j = 0; j < listLen; j++) {
      if (offset + 2 > data.length) break;
      const valLen = view.getInt16(offset, false);
      offset += 2;
      if (offset + valLen > data.length) break;
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
      } finally {
        try { writer.releaseLock(); } catch { /* ignored */ }
        try { reader.releaseLock(); } catch { /* ignored */ }
        try { socket.close(); } catch { /* ignored */ }
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

/** Type info for CQL column types, supporting nested collections. */
interface CqlTypeInfo {
  id: number;
  name: string;
  elementType?: CqlTypeInfo;       // for list, set
  keyType?: CqlTypeInfo;           // for map
  valueType?: CqlTypeInfo;         // for map
  fieldTypes?: CqlTypeInfo[];      // for tuple
}

/** Read a CQL short string (2-byte big-endian length prefix). */
function readCqlShortString(data: Uint8Array, offset: number): [string, number] {
  const view = new DataView(data.buffer, data.byteOffset);
  const len = view.getInt16(offset, false);
  const str = new TextDecoder().decode(data.slice(offset + 2, offset + 2 + len));
  return [str, offset + 2 + len];
}

/**
 * Parse a CQL type option (recursive) from column metadata.
 * Returns the parsed type info and the new offset.
 */
function readCqlTypeOption(data: Uint8Array, offset: number): [CqlTypeInfo, number] {
  const view = new DataView(data.buffer, data.byteOffset);
  const typeId = view.getInt16(offset, false);
  offset += 2;
  const name = CQL_TYPE_NAMES[typeId] ?? ('0x' + typeId.toString(16));
  const info: CqlTypeInfo = { id: typeId, name };

  if (typeId === 0x0020 || typeId === 0x0022) {
    // list or set: one sub-type option
    let elementType: CqlTypeInfo;
    [elementType, offset] = readCqlTypeOption(data, offset);
    info.elementType = elementType;
  } else if (typeId === 0x0021) {
    // map: key type option + value type option
    let keyType: CqlTypeInfo, valueType: CqlTypeInfo;
    [keyType, offset] = readCqlTypeOption(data, offset);
    [valueType, offset] = readCqlTypeOption(data, offset);
    info.keyType = keyType;
    info.valueType = valueType;
  } else if (typeId === 0x0030) {
    // UDT: keyspace string + name string + n fields
    // Skip keyspace and name
    const ksLen = view.getInt16(offset, false); offset += 2 + ksLen;
    const nameLen = view.getInt16(offset, false); offset += 2 + nameLen;
    const fieldCount = view.getInt16(offset, false); offset += 2;
    info.fieldTypes = [];
    for (let f = 0; f < fieldCount; f++) {
      // skip field name
      const fNameLen = view.getInt16(offset, false); offset += 2 + fNameLen;
      let ft: CqlTypeInfo;
      [ft, offset] = readCqlTypeOption(data, offset);
      info.fieldTypes.push(ft);
    }
  } else if (typeId === 0x0031) {
    // tuple: n sub-types
    const n = view.getInt16(offset, false); offset += 2;
    info.fieldTypes = [];
    for (let t = 0; t < n; t++) {
      let ft: CqlTypeInfo;
      [ft, offset] = readCqlTypeOption(data, offset);
      info.fieldTypes.push(ft);
    }
  }

  return [info, offset];
}

/**
 * Format a UUID from 16 raw bytes into the standard 8-4-4-4-12 hex format.
 */
function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Decode a CQL cell value based on its type.
 * Returns a string representation suitable for JSON output.
 */
function decodeCqlValue(cellBytes: Uint8Array, typeInfo: CqlTypeInfo): string {
  const view = new DataView(cellBytes.buffer, cellBytes.byteOffset, cellBytes.length);
  const len = cellBytes.length;

  switch (typeInfo.id) {
    // --- Text types: UTF-8 encoded ---
    case 0x0001: // ascii
    case 0x000A: // text
    case 0x000D: // varchar
      return new TextDecoder().decode(cellBytes);

    // --- Integer types ---
    case 0x0014: // tinyint (1 byte)
      return view.getInt8(0).toString();
    case 0x0013: // smallint (2 bytes)
      return view.getInt16(0, false).toString();
    case 0x0009: // int (4 bytes)
      return view.getInt32(0, false).toString();
    case 0x0002: // bigint (8 bytes)
    case 0x0005: // counter (8 bytes)
      return view.getBigInt64(0, false).toString();

    // --- Floating-point ---
    case 0x0008: // float (4 bytes)
      return view.getFloat32(0, false).toString();
    case 0x0007: // double (8 bytes)
      return view.getFloat64(0, false).toString();

    // --- Boolean (1 byte) ---
    case 0x0004:
      return view.getUint8(0) !== 0 ? 'true' : 'false';

    // --- UUID / TimeUUID (16 bytes) ---
    case 0x000C: // uuid
    case 0x000F: // timeuuid
      return formatUuid(cellBytes);

    // --- Timestamp: 64-bit millis since epoch ---
    case 0x000B: {
      const ms = view.getBigInt64(0, false);
      return new Date(Number(ms)).toISOString();
    }

    // --- Date: unsigned 32-bit, days since epoch (Jan 1, 1970) with center at 2^31 ---
    case 0x0011: {
      const raw = view.getUint32(0, false);
      const daysSinceEpoch = raw - 2147483648; // 2^31 offset
      const d = new Date(daysSinceEpoch * 86400000);
      return d.toISOString().slice(0, 10);
    }

    // --- Time: 64-bit nanoseconds since midnight ---
    case 0x0012: {
      const nanos = view.getBigInt64(0, false);
      const totalMs = Number(nanos / BigInt(1000000));
      const hrs = Math.floor(totalMs / 3600000);
      const mins = Math.floor((totalMs % 3600000) / 60000);
      const secs = Math.floor((totalMs % 60000) / 1000);
      const ms = totalMs % 1000;
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
    }

    // --- Inet: 4 bytes (IPv4) or 16 bytes (IPv6) ---
    case 0x0010:
      if (len === 4) {
        return `${view.getUint8(0)}.${view.getUint8(1)}.${view.getUint8(2)}.${view.getUint8(3)}`;
      } else {
        // IPv6: 8 groups of 2-byte hex
        const groups: string[] = [];
        for (let i = 0; i < 16; i += 2) {
          groups.push(view.getUint16(i, false).toString(16));
        }
        return groups.join(':');
      }

    // --- Varint: arbitrary-precision signed integer (big-endian two's complement) ---
    case 0x000E: {
      if (len === 0) return '0';
      let val = BigInt(0);
      for (let i = 0; i < len; i++) {
        val = (val << BigInt(8)) | BigInt(cellBytes[i]);
      }
      // Handle sign: if high bit is set, it's negative
      if (cellBytes[0] & 0x80) {
        val -= BigInt(1) << BigInt(len * 8);
      }
      return val.toString();
    }

    // --- Decimal: 4-byte scale (int32) + varint unscaled value ---
    case 0x0006: {
      if (len < 4) return '0';
      const scale = view.getInt32(0, false);
      const varintBytes = cellBytes.slice(4);
      if (varintBytes.length === 0) return '0';
      let unscaled = BigInt(0);
      for (let i = 0; i < varintBytes.length; i++) {
        unscaled = (unscaled << BigInt(8)) | BigInt(varintBytes[i]);
      }
      if (varintBytes[0] & 0x80) {
        unscaled -= BigInt(1) << BigInt(varintBytes.length * 8);
      }
      if (scale === 0) return unscaled.toString();
      const str = unscaled.toString();
      const isNeg = str.startsWith('-');
      const digits = isNeg ? str.slice(1) : str;
      if (scale >= digits.length) {
        const padded = digits.padStart(scale + 1, '0');
        return (isNeg ? '-' : '') + padded.slice(0, padded.length - scale) + '.' + padded.slice(padded.length - scale);
      }
      return (isNeg ? '-' : '') + digits.slice(0, digits.length - scale) + '.' + digits.slice(digits.length - scale);
    }

    // --- Blob: hex-encode raw bytes ---
    case 0x0003:
      return '0x' + Array.from(cellBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    // --- List / Set: [int n][n * [int len][bytes]] ---
    case 0x0020: // list
    case 0x0022: { // set
      const elemType = typeInfo.elementType ?? { id: 0x0003, name: 'blob' };
      const n = view.getInt32(0, false);
      let eOff = 4;
      const elements: string[] = [];
      for (let i = 0; i < n; i++) {
        const eLen = new DataView(cellBytes.buffer, cellBytes.byteOffset + eOff).getInt32(0, false);
        eOff += 4;
        if (eLen === -1) {
          elements.push('null');
        } else {
          elements.push(decodeCqlValue(cellBytes.slice(eOff, eOff + eLen), elemType));
          eOff += eLen;
        }
      }
      return '[' + elements.join(', ') + ']';
    }

    // --- Map: [int n][n * [int kLen][kBytes][int vLen][vBytes]] ---
    case 0x0021: {
      const kType = typeInfo.keyType ?? { id: 0x0003, name: 'blob' };
      const vType = typeInfo.valueType ?? { id: 0x0003, name: 'blob' };
      const n = view.getInt32(0, false);
      let mOff = 4;
      const entries: string[] = [];
      for (let i = 0; i < n; i++) {
        const kLen = new DataView(cellBytes.buffer, cellBytes.byteOffset + mOff).getInt32(0, false);
        mOff += 4;
        const kVal = kLen === -1 ? 'null' : decodeCqlValue(cellBytes.slice(mOff, mOff + kLen), kType);
        if (kLen !== -1) mOff += kLen;
        const vLen = new DataView(cellBytes.buffer, cellBytes.byteOffset + mOff).getInt32(0, false);
        mOff += 4;
        const vVal = vLen === -1 ? 'null' : decodeCqlValue(cellBytes.slice(mOff, mOff + vLen), vType);
        if (vLen !== -1) mOff += vLen;
        entries.push(`${kVal}: ${vVal}`);
      }
      return '{' + entries.join(', ') + '}';
    }

    // --- Tuple: [n * [int len][bytes]] (field count known from type metadata) ---
    case 0x0031: {
      const fields = typeInfo.fieldTypes ?? [];
      let tOff = 0;
      const parts: string[] = [];
      for (let i = 0; i < fields.length; i++) {
        const fLen = new DataView(cellBytes.buffer, cellBytes.byteOffset + tOff).getInt32(0, false);
        tOff += 4;
        if (fLen === -1) {
          parts.push('null');
        } else {
          parts.push(decodeCqlValue(cellBytes.slice(tOff, tOff + fLen), fields[i]));
          tOff += fLen;
        }
      }
      return '(' + parts.join(', ') + ')';
    }

    // --- Fallback: hex-encode unknown types ---
    default:
      return '0x' + Array.from(cellBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }
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

// Per-call stream ID generator (range 1-127, wraps around)
let _nextStreamId = 1;
const nextStreamId = (): number => {
  const id = _nextStreamId;
  _nextStreamId = (_nextStreamId % 127) + 1;
  return id;
};

/**
 * Build a QUERY frame.
 * Body: [query_len 4B][query bytes][consistency 2B=ONE][flags 1B=0x00][page_size 4B=100]
 */
function buildQueryFrame(cql: string, stream = nextStreamId()): Uint8Array {
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
  const typeInfos: CqlTypeInfo[] = [];
  for (let i = 0; i < colCount; i++) {
    let ks = gKs, tbl = gTbl;
    if (!hasGlobal) {
      [ks, off] = readCqlShortString(body, off);
      [tbl, off] = readCqlShortString(body, off);
    }
    let name: string;
    [name, off] = readCqlShortString(body, off);
    let typeInfo: CqlTypeInfo;
    [typeInfo, off] = readCqlTypeOption(body, off);
    typeInfos.push(typeInfo);
    columns.push({
      keyspace: ks, table: tbl, name,
      type: typeInfo.name,
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
        const cellBytes = body.slice(off, off + cellLen);
        row[columns[c].name] = decodeCqlValue(cellBytes, typeInfos[c]);
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
        } else if (startResp.opcode === OPCODE_AUTH_SUCCESS_RESP) {
          // Server sent AUTH_SUCCESS directly after STARTUP — consume and proceed
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

        return {
          success: true, host, port, rtt,
          cqlVersions: supported['CQL_VERSION'] ?? [],
          columns, rows, rowCount: rows.length,
        };
      } finally {
        try { writer.releaseLock(); } catch { /* ignored */ }
        try { reader.releaseLock(); } catch { /* ignored */ }
        try { socket.close(); } catch { /* ignored */ }
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
function buildPrepareFrame(cql: string, stream = nextStreamId()): Uint8Array {
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
  stream = nextStreamId(),
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
        } else if (startResp.opcode === OPCODE_AUTH_SUCCESS_RESP) {
          // Server sent AUTH_SUCCESS directly after STARTUP — consume and proceed
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
          return { success: false, host, port, rtt, error: `EXECUTE error: ${err.message} (code ${err.code})`, cqlVersions: supported['CQL_VERSION'] ?? [] };
        }

        let columns: Array<{ keyspace: string; table: string; name: string; type: string }> = [];
        let rows: Array<Record<string, string | null>> = [];
        if (execResp.opcode === OPCODE_RESULT) {
          ({ columns, rows } = parseResultRows(execResp.body));
        }

        return {
          success: true, host, port, rtt,
          preparedIdHex: Array.from(preparedId).map(b => b.toString(16).padStart(2, '0')).join(''),
          cqlVersions: supported['CQL_VERSION'] ?? [],
          columns, rows, rowCount: rows.length,
        };
      } finally {
        try { writer.releaseLock(); } catch { /* ignored */ }
        try { reader.releaseLock(); } catch { /* ignored */ }
        try { socket.close(); } catch { /* ignored */ }
      }
    })();

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
