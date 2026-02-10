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
