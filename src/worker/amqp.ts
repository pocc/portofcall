/**
 * AMQP 0-9-1 Protocol Support for Cloudflare Workers
 * Implements AMQP connectivity testing via the RabbitMQ-style handshake
 *
 * Connection flow:
 * 1. Client sends protocol header: "AMQP\x00\x00\x09\x01"
 * 2. Server responds with Connection.Start METHOD frame
 * 3. We parse server-properties, mechanisms, and version info
 *
 * Spec: https://www.rabbitmq.com/amqp-0-9-1-reference.html
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// const encoder = new TextEncoder(); // Reserved for future use
const decoder = new TextDecoder();

/** AMQP 0-9-1 protocol header */
const AMQP_PROTOCOL_HEADER = new Uint8Array([
  0x41, 0x4d, 0x51, 0x50, // "AMQP"
  0x00,                     // Protocol ID
  0x00,                     // Major version 0
  0x09,                     // Minor version 9
  0x01,                     // Revision 1
]);

const FRAME_METHOD = 1;
const FRAME_END = 0xce;

// Connection class = 10, Start method = 10
const CONNECTION_START_CLASS = 10;
const CONNECTION_START_METHOD = 10;

/** Read exactly N bytes from a socket */
async function readExact(reader: ReadableStreamDefaultReader<Uint8Array>, n: number): Promise<Uint8Array> {
  const buffer = new Uint8Array(n);
  let offset = 0;
  while (offset < n) {
    const { value, done } = await reader.read();
    if (done || !value) throw new Error('Connection closed unexpectedly');
    const toCopy = Math.min(n - offset, value.length);
    buffer.set(value.subarray(0, toCopy), offset);
    offset += toCopy;
    // If we got more than needed, we lose the extra bytes — acceptable for a one-shot handshake
  }
  return buffer;
}

/** Parse an AMQP short string (1-byte length prefix) */
function readShortString(data: Uint8Array, offset: number): { value: string; bytesRead: number } {
  const len = data[offset];
  const value = decoder.decode(data.subarray(offset + 1, offset + 1 + len));
  return { value, bytesRead: 1 + len };
}

/** Parse an AMQP long string (4-byte length prefix) */
function readLongString(data: Uint8Array, offset: number): { value: string; bytesRead: number } {
  const view = new DataView(data.buffer, data.byteOffset + offset, 4);
  const len = view.getUint32(0, false);
  const value = decoder.decode(data.subarray(offset + 4, offset + 4 + len));
  return { value, bytesRead: 4 + len };
}

/** Parse an AMQP field table into a Record<string, string> (simplified — extracts string values) */
function readFieldTable(data: Uint8Array, offset: number): { value: Record<string, string>; bytesRead: number } {
  const view = new DataView(data.buffer, data.byteOffset + offset, 4);
  const tableLen = view.getUint32(0, false);
  const table: Record<string, string> = {};
  let pos = offset + 4;
  const end = offset + 4 + tableLen;

  while (pos < end) {
    // Field name is a short string
    const nameResult = readShortString(data, pos);
    pos += nameResult.bytesRead;

    // Field value type
    const type = String.fromCharCode(data[pos]);
    pos += 1;

    switch (type) {
      case 'S': { // long string
        const strResult = readLongString(data, pos);
        table[nameResult.value] = strResult.value;
        pos += strResult.bytesRead;
        break;
      }
      case 's': { // short string
        const strResult = readShortString(data, pos);
        table[nameResult.value] = strResult.value;
        pos += strResult.bytesRead;
        break;
      }
      case 'F': { // nested table
        const nestedResult = readFieldTable(data, pos);
        table[nameResult.value] = JSON.stringify(nestedResult.value);
        pos += nestedResult.bytesRead;
        break;
      }
      case 't': { // boolean
        table[nameResult.value] = data[pos] !== 0 ? 'true' : 'false';
        pos += 1;
        break;
      }
      case 'I': { // signed 32-bit int
        const intView = new DataView(data.buffer, data.byteOffset + pos, 4);
        table[nameResult.value] = intView.getInt32(0, false).toString();
        pos += 4;
        break;
      }
      case 'l': { // signed 64-bit int
        const longView = new DataView(data.buffer, data.byteOffset + pos, 8);
        table[nameResult.value] = longView.getBigInt64(0, false).toString();
        pos += 8;
        break;
      }
      default: {
        // Skip unknown types — bail out of table parsing
        table[nameResult.value] = `<type:${type}>`;
        pos = end; // break out
        break;
      }
    }
  }

  return { value: table, bytesRead: 4 + tableLen };
}

/**
 * Handle AMQP connectivity test
 * POST /api/amqp/connect
 *
 * Sends the AMQP 0-9-1 protocol header and parses the Connection.Start
 * response to extract server product, version, platform, and auth mechanisms.
 */
export async function handleAMQPConnect(request: Request): Promise<Response> {
  try {
    const { host, port = 5672, timeout = 10000 } = await request.json<{ // eslint-disable-line @typescript-eslint/no-unused-vars
      host: string;
      port?: number;
      timeout?: number;
      vhost?: string;
    }>();

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Step 1: Send AMQP protocol header
        await writer.write(AMQP_PROTOCOL_HEADER);

        // Step 2: Read the response frame header (7 bytes)
        const frameHeader = await readExact(reader, 7);
        const frameType = frameHeader[0];
        // const frameChannel = (frameHeader[1] << 8) | frameHeader[2]; // Reserved for future use
        const frameSize = new DataView(frameHeader.buffer, 3, 4).getUint32(0, false);

        if (frameType !== FRAME_METHOD) {
          // Server may have rejected with its own protocol header (version mismatch)
          if (frameHeader[0] === 0x41 && frameHeader[1] === 0x4d) {
            // "AM" — server sent back AMQP header with different version
            const rest = await readExact(reader, 1); // read remaining byte
            const serverMajor = frameHeader[5];
            const serverMinor = frameHeader[6];
            const serverRevision = rest[0];
            throw new Error(
              `Version mismatch: server supports AMQP ${serverMajor}.${serverMinor}.${serverRevision}`
            );
          }
          throw new Error(`Unexpected frame type: ${frameType} (expected METHOD)`);
        }

        // Step 3: Read the frame payload
        const payload = await readExact(reader, frameSize);

        // Read frame-end byte
        const frameEndBuf = await readExact(reader, 1);
        if (frameEndBuf[0] !== FRAME_END) {
          throw new Error(`Invalid frame-end marker: 0x${frameEndBuf[0].toString(16)}`);
        }

        // Step 4: Parse Connection.Start method
        const classId = (payload[0] << 8) | payload[1];
        const methodId = (payload[2] << 8) | payload[3];

        if (classId !== CONNECTION_START_CLASS || methodId !== CONNECTION_START_METHOD) {
          throw new Error(`Unexpected method: class=${classId} method=${methodId}`);
        }

        const versionMajor = payload[4];
        const versionMinor = payload[5];

        // Server properties (field table)
        let offset = 6;
        const propsResult = readFieldTable(payload, offset);
        offset += propsResult.bytesRead;

        // Mechanisms (long string)
        const mechResult = readLongString(payload, offset);
        offset += mechResult.bytesRead;

        // Locales (long string)
        const localeResult = readLongString(payload, offset);

        await socket.close();

        return {
          success: true,
          host,
          port,
          protocol: `AMQP ${versionMajor}-${versionMinor}`,
          serverProperties: propsResult.value,
          mechanisms: mechResult.value.trim().split(/\s+/),
          locales: localeResult.value.trim().split(/\s+/),
          product: propsResult.value['product'] || 'Unknown',
          version: propsResult.value['version'] || 'Unknown',
          platform: propsResult.value['platform'] || 'Unknown',
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
