/**
 * Apache Thrift Protocol Support for Cloudflare Workers
 * Implements Thrift Binary Protocol with Framed Transport
 *
 * Thrift uses a binary RPC protocol with:
 * - Binary Protocol: version + type + method name + seq ID + struct
 * - Framed Transport: 4-byte length prefix per message
 * - Type system: bool, byte, i16, i32, i64, double, string, struct, list, map, set
 *
 * Default port: 9090
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// Thrift Binary Protocol constants
const THRIFT_VERSION_1 = 0x80010000;
const THRIFT_VERSION_MASK = 0xffff0000;
const THRIFT_TYPE_MASK = 0x000000ff;

// Message types
const MESSAGE_TYPE_CALL = 1;
const MESSAGE_TYPE_REPLY = 2;
const MESSAGE_TYPE_EXCEPTION = 3;
// const MESSAGE_TYPE_ONEWAY = 4;

// Type IDs
const T_STOP = 0;
const T_BOOL = 2;
const T_BYTE = 3;
const T_DOUBLE = 4;
const T_I16 = 6;
const T_I32 = 8;
const T_I64 = 10;
const T_STRING = 11;
const T_STRUCT = 12;
const T_MAP = 13;
const T_SET = 14;
const T_LIST = 15;

const TYPE_NAMES: Record<number, string> = {
  [T_STOP]: 'STOP',
  [T_BOOL]: 'BOOL',
  [T_BYTE]: 'BYTE',
  [T_DOUBLE]: 'DOUBLE',
  [T_I16]: 'I16',
  [T_I32]: 'I32',
  [T_I64]: 'I64',
  [T_STRING]: 'STRING',
  [T_STRUCT]: 'STRUCT',
  [T_MAP]: 'MAP',
  [T_SET]: 'SET',
  [T_LIST]: 'LIST',
};

const MESSAGE_TYPE_NAMES: Record<number, string> = {
  [MESSAGE_TYPE_CALL]: 'CALL',
  [MESSAGE_TYPE_REPLY]: 'REPLY',
  [MESSAGE_TYPE_EXCEPTION]: 'EXCEPTION',
  4: 'ONEWAY',
};

// ─── Binary encoding helpers ──────────────────────────────────────

function writeI16(value: number): Uint8Array {
  const buf = new ArrayBuffer(2);
  new DataView(buf).setInt16(0, value, false);
  return new Uint8Array(buf);
}

function writeI32(value: number): Uint8Array {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setInt32(0, value, false);
  return new Uint8Array(buf);
}

function writeString(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  const lenBuf = writeI32(bytes.length);
  const result = new Uint8Array(lenBuf.length + bytes.length);
  result.set(lenBuf, 0);
  result.set(bytes, lenBuf.length);
  return result;
}

function combineBuffers(buffers: Uint8Array[]): Uint8Array {
  const total = buffers.reduce((sum, b) => sum + b.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const b of buffers) {
    result.set(b, offset);
    offset += b.length;
  }
  return result;
}

// ─── Thrift struct encoding ───────────────────────────────────────

interface ThriftField {
  id: number;
  type: number;
  value: Uint8Array;
}

function encodeStruct(fields: ThriftField[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const field of fields) {
    parts.push(new Uint8Array([field.type]));
    parts.push(writeI16(field.id));
    parts.push(field.value);
  }
  parts.push(new Uint8Array([T_STOP]));
  return combineBuffers(parts);
}

// ─── Build a Thrift CALL message ─────────────────────────────────

function buildCallMessage(methodName: string, seqId: number, argsStruct: Uint8Array): Uint8Array {
  const versionAndType = THRIFT_VERSION_1 | MESSAGE_TYPE_CALL;
  const parts: Uint8Array[] = [
    writeI32(versionAndType),
    writeString(methodName),
    writeI32(seqId),
    argsStruct,
  ];
  return combineBuffers(parts);
}

// ─── Frame a message (4-byte length prefix) ─────────────────────

function frameMessage(message: Uint8Array): Uint8Array {
  const lenBuf = writeI32(message.length);
  const result = new Uint8Array(lenBuf.length + message.length);
  result.set(lenBuf, 0);
  result.set(message, lenBuf.length);
  return result;
}

// ─── Parse Thrift response ──────────────────────────────────────

interface ParsedMessage {
  version: number;
  messageType: number;
  messageTypeName: string;
  methodName: string;
  seqId: number;
  fields: ParsedField[];
  isException: boolean;
  exceptionMessage?: string;
}

interface ParsedField {
  id: number;
  type: number;
  typeName: string;
  value: string;
}

function readI32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset + offset, 4).getInt32(0, false);
}

function readI16(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset + offset, 2).getInt16(0, false);
}

function readString(data: Uint8Array, offset: number): { value: string; newOffset: number } {
  const len = readI32(data, offset);
  offset += 4;
  if (len < 0 || len > data.length - offset) {
    return { value: '<invalid>', newOffset: offset };
  }
  const value = new TextDecoder().decode(data.slice(offset, offset + len));
  return { value, newOffset: offset + len };
}

function readFieldValue(data: Uint8Array, offset: number, type: number): { value: string; newOffset: number } {
  switch (type) {
    case T_BOOL: {
      const val = data[offset] !== 0;
      return { value: String(val), newOffset: offset + 1 };
    }
    case T_BYTE: {
      const val = data[offset];
      return { value: String(val), newOffset: offset + 1 };
    }
    case T_I16: {
      const val = readI16(data, offset);
      return { value: String(val), newOffset: offset + 2 };
    }
    case T_I32: {
      const val = readI32(data, offset);
      return { value: String(val), newOffset: offset + 4 };
    }
    case T_I64: {
      const val = new DataView(data.buffer, data.byteOffset + offset, 8).getBigInt64(0, false);
      return { value: String(val), newOffset: offset + 8 };
    }
    case T_DOUBLE: {
      const val = new DataView(data.buffer, data.byteOffset + offset, 8).getFloat64(0, false);
      return { value: String(val), newOffset: offset + 8 };
    }
    case T_STRING: {
      return readString(data, offset);
    }
    case T_STRUCT: {
      // Parse nested struct fields
      const nestedFields: string[] = [];
      while (offset < data.length) {
        const fieldType = data[offset++];
        if (fieldType === T_STOP) break;
        const fieldId = readI16(data, offset);
        offset += 2;
        const nested = readFieldValue(data, offset, fieldType);
        nestedFields.push(`${fieldId}:${nested.value}`);
        offset = nested.newOffset;
      }
      return { value: `{${nestedFields.join(', ')}}`, newOffset: offset };
    }
    case T_LIST: {
      const elemType = data[offset++];
      const size = Math.min(readI32(data, offset), 10000);
      offset += 4;
      const items: string[] = [];
      const displayLimit = 20;
      for (let i = 0; i < size; i++) {
        const item = readFieldValue(data, offset, elemType);
        if (i < displayLimit) {
          items.push(item.value);
        }
        offset = item.newOffset;
      }
      const suffix = size > displayLimit ? `, ...(${size - displayLimit} more)` : '';
      return { value: `[${items.join(', ')}${suffix}]`, newOffset: offset };
    }
    case T_MAP: {
      const keyType = data[offset++];
      const valType = data[offset++];
      const size = Math.min(readI32(data, offset), 10000);
      offset += 4;
      const entries: string[] = [];
      const displayLimit = 20;
      for (let i = 0; i < size; i++) {
        const key = readFieldValue(data, offset, keyType);
        offset = key.newOffset;
        const val = readFieldValue(data, offset, valType);
        offset = val.newOffset;
        if (i < displayLimit) {
          entries.push(`${key.value}=${val.value}`);
        }
      }
      const suffix = size > displayLimit ? `, ...(${size - displayLimit} more)` : '';
      return { value: `{${entries.join(', ')}${suffix}}`, newOffset: offset };
    }
    case T_SET: {
      const elemType = data[offset++];
      const size = readI32(data, offset);
      offset += 4;
      const items: string[] = [];
      const displayLimit = 20;
      for (let i = 0; i < size; i++) {
        const item = readFieldValue(data, offset, elemType);
        if (i < displayLimit) {
          items.push(item.value);
        }
        offset = item.newOffset;
      }
      const suffix = size > displayLimit ? `, ...(${size - displayLimit} more)` : '';
      return { value: `(${items.join(', ')}${suffix})`, newOffset: offset };
    }
    default:
      // Skip 1 byte for unknown types to avoid infinite loops in struct parsing
      return { value: `<unknown type ${type}>`, newOffset: offset + 1 };
  }
}

function parseThriftResponse(data: Uint8Array): ParsedMessage {
  let offset = 0;

  // Read version + message type
  const versionAndType = readI32(data, offset);
  offset += 4;

  const version = versionAndType & THRIFT_VERSION_MASK;
  const messageType = versionAndType & THRIFT_TYPE_MASK;

  if (version !== THRIFT_VERSION_1) {
    throw new Error(`Unsupported Thrift protocol version: 0x${version.toString(16)}`);
  }

  // Read method name
  const methodResult = readString(data, offset);
  offset = methodResult.newOffset;

  // Read sequence ID
  const seqId = readI32(data, offset);
  offset += 4;

  // Read result struct fields
  const fields: ParsedField[] = [];
  while (offset < data.length) {
    const fieldType = data[offset++];
    if (fieldType === T_STOP) break;

    const fieldId = readI16(data, offset);
    offset += 2;

    const fieldValue = readFieldValue(data, offset, fieldType);
    offset = fieldValue.newOffset;

    fields.push({
      id: fieldId,
      type: fieldType,
      typeName: TYPE_NAMES[fieldType] || `UNKNOWN(${fieldType})`,
      value: fieldValue.value,
    });
  }

  // Check if it's a Thrift application exception (messageType == EXCEPTION)
  const isException = messageType === MESSAGE_TYPE_EXCEPTION;
  let exceptionMessage: string | undefined;
  if (isException && fields.length > 0) {
    // Exception struct: field 1 = message (string), field 2 = type (i32)
    const msgField = fields.find(f => f.id === 1);
    exceptionMessage = msgField?.value || 'Unknown exception';
  }

  return {
    version: 1,
    messageType,
    messageTypeName: MESSAGE_TYPE_NAMES[messageType] || `UNKNOWN(${messageType})`,
    methodName: methodResult.value,
    seqId,
    fields,
    isException,
    exceptionMessage,
  };
}

// ─── Read framed response from socket ───────────────────────────

async function readFramedResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLen = 0;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Read timeout')), timeoutMs)
  );

  const readPromise = (async () => {
    // Read until we have at least 4 bytes for the frame length
    while (totalLen < 4) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Connection closed before frame header');
      chunks.push(value);
      totalLen += value.length;
    }

    // Combine chunks to read frame length
    const headerBuf = combineBuffers(chunks);
    const frameLen = readI32(headerBuf, 0);

    if (frameLen < 0 || frameLen > 1048576) {
      throw new Error(`Invalid frame length: ${frameLen}`);
    }

    // Read remaining frame data
    const totalNeeded = 4 + frameLen;
    while (totalLen < totalNeeded) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Connection closed mid-frame');
      chunks.push(value);
      totalLen += value.length;
    }

    const fullBuf = combineBuffers(chunks);
    return fullBuf.slice(4, 4 + frameLen);
  })();

  return Promise.race([readPromise, timeoutPromise]);
}

// ─── Handle Thrift probe (connect + call getName) ───────────────

export async function handleThriftProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host?: string;
      port?: number;
      method?: string;
      timeout?: number;
      transport?: 'framed' | 'buffered';
    };

    if (!body.host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = body.host;
    const port = body.port || 9090;
    const method = body.method || 'getName';
    const timeoutMs = body.timeout || 15000;
    const useFramed = body.transport !== 'buffered';

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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Build a simple RPC call with empty args struct
        const argsStruct = encodeStruct([]);
        const message = buildCallMessage(method, 1, argsStruct);

        // Send with or without framing
        if (useFramed) {
          await writer.write(frameMessage(message));
        } else {
          await writer.write(message);
        }

        // Read response
        let responseData: Uint8Array;
        if (useFramed) {
          responseData = await readFramedResponse(reader, timeoutMs);
        } else {
          // Non-framed: just read whatever comes back
          const readTimeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Read timeout')), timeoutMs)
          );
          const readData = (async () => {
            const { value, done } = await reader.read();
            if (done || !value) throw new Error('No response');
            return value;
          })();
          responseData = await Promise.race([readData, readTimeout]);
        }

        const parsed = parseThriftResponse(responseData);

        reader.releaseLock();
        writer.releaseLock();
        await socket.close();

        return {
          success: true,
          message: `Thrift RPC call to ${method}() completed`,
          host,
          port,
          transport: useFramed ? 'framed' : 'buffered',
          protocol: 'binary',
          response: {
            messageType: parsed.messageTypeName,
            method: parsed.methodName,
            seqId: parsed.seqId,
            isException: parsed.isException,
            exceptionMessage: parsed.exceptionMessage,
            fieldCount: parsed.fields.length,
            fields: parsed.fields,
          },
        };
      } catch (error) {
        reader.releaseLock();
        writer.releaseLock();
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'Connection failed',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Request failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── Handle Thrift RPC call with custom args ────────────────────

export async function handleThriftCall(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host?: string;
      port?: number;
      method?: string;
      args?: Array<{ id: number; type: string; value: string }>;
      timeout?: number;
      transport?: 'framed' | 'buffered';
    };

    if (!body.host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!body.method) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: method',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = body.host;
    const port = body.port || 9090;
    const method = body.method;
    const timeoutMs = body.timeout || 15000;
    const useFramed = body.transport !== 'buffered';

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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Build args struct from user-provided fields
        const fields: ThriftField[] = [];
        if (body.args) {
          for (const arg of body.args) {
            const typeCode = getTypeCode(arg.type);
            const encoded = encodeValue(typeCode, arg.value);
            fields.push({ id: arg.id, type: typeCode, value: encoded });
          }
        }

        const argsStruct = encodeStruct(fields);
        const message = buildCallMessage(method, 1, argsStruct);

        if (useFramed) {
          await writer.write(frameMessage(message));
        } else {
          await writer.write(message);
        }

        let responseData: Uint8Array;
        if (useFramed) {
          responseData = await readFramedResponse(reader, timeoutMs);
        } else {
          const readTimeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Read timeout')), timeoutMs)
          );
          const readData = (async () => {
            const { value, done } = await reader.read();
            if (done || !value) throw new Error('No response');
            return value;
          })();
          responseData = await Promise.race([readData, readTimeout]);
        }

        const parsed = parseThriftResponse(responseData);

        reader.releaseLock();
        writer.releaseLock();
        await socket.close();

        return {
          success: true,
          message: `Thrift RPC: ${method}() returned ${parsed.messageTypeName}`,
          host,
          port,
          response: {
            messageType: parsed.messageTypeName,
            method: parsed.methodName,
            seqId: parsed.seqId,
            isException: parsed.isException,
            exceptionMessage: parsed.exceptionMessage,
            fieldCount: parsed.fields.length,
            fields: parsed.fields,
          },
        };
      } catch (error) {
        reader.releaseLock();
        writer.releaseLock();
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'Connection failed',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Request failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── Type encoding helpers ──────────────────────────────────────

function getTypeCode(typeName: string): number {
  switch (typeName.toUpperCase()) {
    case 'BOOL': return T_BOOL;
    case 'BYTE': case 'I8': return T_BYTE;
    case 'I16': return T_I16;
    case 'I32': return T_I32;
    case 'I64': return T_I64;
    case 'DOUBLE': return T_DOUBLE;
    case 'STRING': return T_STRING;
    default: return T_STRING;
  }
}

function encodeValue(type: number, value: string): Uint8Array {
  switch (type) {
    case T_BOOL:
      return new Uint8Array([value === 'true' || value === '1' ? 1 : 0]);
    case T_BYTE:
      return new Uint8Array([parseInt(value) & 0xff]);
    case T_I16:
      return writeI16(parseInt(value));
    case T_I32:
      return writeI32(parseInt(value));
    case T_I64: {
      const buf = new ArrayBuffer(8);
      new DataView(buf).setBigInt64(0, BigInt(value), false);
      return new Uint8Array(buf);
    }
    case T_DOUBLE: {
      const buf = new ArrayBuffer(8);
      new DataView(buf).setFloat64(0, parseFloat(value), false);
      return new Uint8Array(buf);
    }
    case T_STRING:
      return writeString(value);
    default:
      return writeString(value);
  }
}
