/**
 * AMQPS Protocol Handler (AMQP 0-9-1 over TLS)
 * Port: 5671
 *
 * AMQPS is AMQP 0-9-1 with implicit TLS/SSL encryption.
 * Used by RabbitMQ, Azure Service Bus, Amazon MQ for secure message broker connections.
 *
 * Connection flow (connect):
 * 1. TLS handshake (implicit on connection)
 * 2. Client sends protocol header: "AMQP\x00\x00\x09\x01"
 * 3. Server responds with Connection.Start METHOD frame
 * 4. We parse server-properties, mechanisms, and version info
 *
 * Connection flow (publish):
 * 1. TLS + full handshake: Start -> StartOk -> Tune -> TuneOk -> Open -> OpenOk
 * 2. Channel: Open -> OpenOk
 * 3. Optional Exchange.Declare -> DeclareOk
 * 4. Basic.Publish + Content Header + Content Body
 * 5. Channel.Close + Connection.Close
 *
 * Spec: https://www.rabbitmq.com/amqp-0-9-1-reference.html
 * RFC 5672: AMQP over TLS
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';
import { doAMQPPublish, doAMQPConsume, type AMQPPublishParams, type AMQPPublishResult, type AMQPConsumeResult } from './amqp';

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
const FRAME_END    = 0xce;

// Connection class = 10, Start method = 10
const CONNECTION_START_CLASS  = 10;
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

/** Parse an AMQP field table into a Record<string, string> */
function readFieldTable(data: Uint8Array, offset: number): { value: Record<string, string>; bytesRead: number } {
  const view = new DataView(data.buffer, data.byteOffset + offset, 4);
  const tableLen = view.getUint32(0, false);
  const table: Record<string, string> = {};
  let pos = offset + 4;
  const end = offset + 4 + tableLen;

  while (pos < end) {
    const nameResult = readShortString(data, pos);
    pos += nameResult.bytesRead;

    const type = String.fromCharCode(data[pos]);
    pos += 1;

    switch (type) {
      case 'S': {
        const strResult = readLongString(data, pos);
        table[nameResult.value] = strResult.value;
        pos += strResult.bytesRead;
        break;
      }
      case 's': {
        const strResult = readShortString(data, pos);
        table[nameResult.value] = strResult.value;
        pos += strResult.bytesRead;
        break;
      }
      case 'F': {
        const nestedResult = readFieldTable(data, pos);
        table[nameResult.value] = JSON.stringify(nestedResult.value);
        pos += nestedResult.bytesRead;
        break;
      }
      case 'I': {
        const intView = new DataView(data.buffer, data.byteOffset + pos, 4);
        table[nameResult.value] = intView.getInt32(0, false).toString();
        pos += 4;
        break;
      }
      case 't': {
        table[nameResult.value] = data[pos] === 1 ? 'true' : 'false';
        pos += 1;
        break;
      }
      default:
        // Skip unknown type - just advance 1 byte (not robust but works for probing)
        pos += 1;
    }
  }

  return { value: table, bytesRead: 4 + tableLen };
}

/**
 * AMQPS Connect Handler
 * POST /api/amqps/connect
 *
 * Establishes a TLS connection and performs the AMQP 0-9-1 handshake to extract
 * server product, version, platform, and auth mechanisms.
 */
export async function handleAMQPSConnect(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { host, port = 5671 } = await request.json<{
      host: string;
      port?: number;
    }>();

    if (!host || typeof host !== 'string' || host.trim() === '') {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (typeof port !== 'number' || port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid port number' }),
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

    const socket = connect(`${host}:${port}`, {
      secureTransport: 'on',
      allowHalfOpen: false,
    });

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      // Send AMQP protocol header
      await writer.write(AMQP_PROTOCOL_HEADER);

      // Read frame header (7 bytes: type + channel + size)
      const frameHeader = await readExact(reader, 7);
      const frameType   = frameHeader[0];
      const frameSize   = (frameHeader[3] << 24) | (frameHeader[4] << 16) | (frameHeader[5] << 8) | frameHeader[6];

      if (frameType !== FRAME_METHOD) {
        throw new Error(`Expected METHOD frame (1), got ${frameType}`);
      }

      // Read frame payload + frame-end byte
      const framePayload = await readExact(reader, frameSize + 1);
      const frameEnd     = framePayload[frameSize];

      if (frameEnd !== FRAME_END) {
        throw new Error(`Expected frame-end marker (0xCE), got 0x${frameEnd.toString(16)}`);
      }

      // Parse method class-id and method-id
      const view     = new DataView(framePayload.buffer, framePayload.byteOffset, 4);
      const classId  = view.getUint16(0, false);
      const methodId = view.getUint16(2, false);

      if (classId !== CONNECTION_START_CLASS || methodId !== CONNECTION_START_METHOD) {
        throw new Error(`Expected Connection.Start (10, 10), got (${classId}, ${methodId})`);
      }

      // Parse Connection.Start arguments
      let offset = 4;

      const versionMajor = framePayload[offset];
      offset += 1;

      const versionMinor = framePayload[offset];
      offset += 1;

      const serverPropsResult = readFieldTable(framePayload, offset);
      offset += serverPropsResult.bytesRead;

      const mechanismsResult = readLongString(framePayload, offset);
      offset += mechanismsResult.bytesRead;

      const localesResult = readLongString(framePayload, offset);

      await writer.close();
      await reader.cancel();
      await socket.close();

      return new Response(
        JSON.stringify({
          success: true,
          secure: true,
          protocol:         `AMQP ${versionMajor}.${versionMinor}`,
          serverProperties: serverPropsResult.value,
          mechanisms:       mechanismsResult.value,
          locales:          localesResult.value,
          product:          serverPropsResult.value['product']  || 'Unknown',
          version:          serverPropsResult.value['version']  || 'Unknown',
          platform:         serverPropsResult.value['platform'] || 'Unknown',
          message:          'Successfully connected to AMQPS broker over TLS',
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } finally {
      try { await writer.close();  } catch { /* ignore */ }
      try { await reader.cancel(); } catch { /* ignore */ }
      try { await socket.close();  } catch { /* ignore */ }
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * AMQPS Publish Handler
 * POST /api/amqps/publish
 *
 * Performs a full AMQP 0-9-1 connection over TLS, opens a channel, optionally
 * declares an exchange, publishes a message, then closes cleanly.
 *
 * Request body: { host, port, username, password, vhost, exchange, routingKey, message, timeout }
 */
export async function handleAMQPSPublish(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.json<{
      host: string;
      port?: number;
      username?: string;
      password?: string;
      vhost?: string;
      exchange?: string;
      routingKey?: string;
      message?: string;
      timeout?: number;
    }>();

    const {
      host,
      port       = 5671,
      username   = 'guest',
      password   = 'guest',
      vhost      = '/',
      exchange   = '',
      routingKey = '',
      message    = '',
      timeout    = 15000,
    } = body;

    if (!host || typeof host !== 'string' || host.trim() === '') {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
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

    const params: AMQPPublishParams = {
      host, port, username, password, vhost,
      exchange, routingKey, message, timeout,
      secureTransport: 'on',
    };

    const publishPromise = doAMQPPublish(params);

    const timeoutPromise = new Promise<AMQPPublishResult>((_, reject) =>
      setTimeout(() => reject(new Error('Publish timeout')), timeout)
    );

    const result = await Promise.race([publishPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Publish failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * AMQPS Consume Handler
 * POST /api/amqps/consume
 *
 * Identical to handleAMQPConsume but over TLS (secureTransport='on').
 * Performs a full AMQP 0-9-1 handshake over TLS, declares the queue,
 * starts consuming, collects messages for up to timeoutMs ms, then closes.
 *
 * Request body: { host, port, username, password, vhost, queue, maxMessages?, timeoutMs? }
 */
export async function handleAMQPSConsume(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.json<{
      host: string;
      port?: number;
      username?: string;
      password?: string;
      vhost?: string;
      queue: string;
      maxMessages?: number;
      timeoutMs?: number;
    }>();

    const {
      host,
      port        = 5671,
      username    = 'guest',
      password    = 'guest',
      vhost       = '/',
      queue,
      maxMessages = 10,
      timeoutMs   = 3000,
    } = body;

    if (!host || typeof host !== 'string' || host.trim() === '') {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!queue) {
      return new Response(
        JSON.stringify({ success: false, error: 'Queue is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { checkIfCloudflare, getCloudflareErrorMessage } = await import('./cloudflare-detector');
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

    const result: AMQPConsumeResult = await doAMQPConsume(
      host, port, username, password, vhost, queue, maxMessages, timeoutMs, 'on',
    );

    return new Response(JSON.stringify({ ...result, secure: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Consume failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
