/**
 * AMQP 0-9-1 Protocol Support for Cloudflare Workers
 * Implements AMQP connectivity testing and message publishing
 *
 * Connection flow (connect):
 * 1. Client sends protocol header: "AMQP\x00\x00\x09\x01"
 * 2. Server responds with Connection.Start METHOD frame
 * 3. We parse server-properties, mechanisms, and version info
 *
 * Connection flow (publish):
 * 1. Full handshake: Start -> StartOk -> Tune -> TuneOk -> Open -> OpenOk
 * 2. Channel: Open -> OpenOk
 * 3. Optional Exchange.Declare -> DeclareOk
 * 4. Basic.Publish + Content Header + Content Body
 * 5. Channel.Close + Connection.Close
 *
 * Spec: https://www.rabbitmq.com/amqp-0-9-1-reference.html
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const encoder = new TextEncoder();
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
const FRAME_HEADER = 2;
const FRAME_BODY   = 3;
const FRAME_END    = 0xce;

// Connection class = 10
const CLASS_CONNECTION           = 10;
const METHOD_CONNECTION_START    = 10;
const METHOD_CONNECTION_START_OK = 11;
const METHOD_CONNECTION_TUNE     = 30;
const METHOD_CONNECTION_TUNE_OK  = 31;
const METHOD_CONNECTION_OPEN     = 40;
const METHOD_CONNECTION_OPEN_OK  = 41;
const METHOD_CONNECTION_CLOSE    = 50;
const METHOD_CONNECTION_CLOSE_OK = 51;

// Channel class = 20
const CLASS_CHANNEL           = 20;
const METHOD_CHANNEL_OPEN     = 10;
const METHOD_CHANNEL_OPEN_OK  = 11;
const METHOD_CHANNEL_CLOSE    = 40;
const METHOD_CHANNEL_CLOSE_OK = 41;

// Exchange class = 40
const CLASS_EXCHANGE             = 40;
const METHOD_EXCHANGE_DECLARE    = 10;
const METHOD_EXCHANGE_DECLARE_OK = 11;

// Basic class = 60
const CLASS_BASIC          = 60;
const METHOD_BASIC_PUBLISH = 40;
const METHOD_BASIC_GET       = 70;
const METHOD_BASIC_GET_OK    = 71;
const METHOD_BASIC_GET_EMPTY = 72;
const METHOD_BASIC_ACK       = 29;
const METHOD_BASIC_NACK      = 120;

// Confirm class = 85 (publisher confirms, RabbitMQ extension — de-facto standard)
const CLASS_CONFIRM            = 85;
const METHOD_CONFIRM_SELECT    = 10;
const METHOD_CONFIRM_SELECT_OK = 11;

// ---- Frame Building Helpers --------------------------------------------------

/** Wrap a payload in an AMQP frame: [type][channel 2B][size 4B][payload][0xCE] */
function buildFrame(frameType: number, channel: number, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(7 + payload.length + 1);
  const view = new DataView(frame.buffer);
  frame[0] = frameType;
  view.setUint16(1, channel, false);
  view.setUint32(3, payload.length, false);
  frame.set(payload, 7);
  frame[7 + payload.length] = FRAME_END;
  return frame;
}

/** Prepend 2-byte class-id + 2-byte method-id to args */
function buildMethodPayload(classId: number, methodId: number, args: Uint8Array): Uint8Array {
  const payload = new Uint8Array(4 + args.length);
  const view = new DataView(payload.buffer);
  view.setUint16(0, classId, false);
  view.setUint16(2, methodId, false);
  payload.set(args, 4);
  return payload;
}

/** Encode a short string (1-byte length + UTF-8 bytes) */
function encodeShortString(s: string): Uint8Array {
  const bytes = encoder.encode(s);
  if (bytes.length > 255) throw new Error(`Short string too long: ${bytes.length} bytes`);
  const out = new Uint8Array(1 + bytes.length);
  out[0] = bytes.length;
  out.set(bytes, 1);
  return out;
}

/** Encode a field table from a flat string->string map (values as AMQP long strings) */
function encodeFieldTable(fields: Record<string, string>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [key, val] of Object.entries(fields)) {
    const keyBytes = encodeShortString(key);
    const valBytes = encoder.encode(val);
    // Type 'S' = long string
    const entry = new Uint8Array(keyBytes.length + 1 + 4 + valBytes.length);
    let pos = 0;
    entry.set(keyBytes, pos);
    pos += keyBytes.length;
    entry[pos++] = 0x53; // 'S'
    new DataView(entry.buffer).setUint32(pos, valBytes.length, false);
    pos += 4;
    entry.set(valBytes, pos);
    parts.push(entry);
  }
  const totalLen = parts.reduce((acc, p) => acc + p.length, 0);
  const out = new Uint8Array(4 + totalLen);
  new DataView(out.buffer).setUint32(0, totalLen, false);
  let pos = 4;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/** Concatenate multiple Uint8Arrays */
function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((acc, a) => acc + a.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const a of arrays) {
    out.set(a, pos);
    pos += a.length;
  }
  return out;
}

// ---- Read Helpers ------------------------------------------------------------

/** Read exactly N bytes from a socket reader */
async function readExact(reader: ReadableStreamDefaultReader<Uint8Array>, n: number): Promise<Uint8Array> {
  const buffer = new Uint8Array(n);
  let offset = 0;
  while (offset < n) {
    const { value, done } = await reader.read();
    if (done || !value) throw new Error('Connection closed unexpectedly');
    const toCopy = Math.min(n - offset, value.length);
    buffer.set(value.subarray(0, toCopy), offset);
    offset += toCopy;
    // If we got more than needed, we lose the extra bytes -- acceptable for a one-shot handshake
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

/** Parse an AMQP field table into a Record<string, string> (simplified -- extracts string values) */
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
        // Skip unknown types -- bail out of table parsing
        table[nameResult.value] = `<type:${type}>`;
        pos = end;
        break;
      }
    }
  }

  return { value: table, bytesRead: 4 + tableLen };
}

/**
 * Read and validate one complete AMQP frame.
 * Returns { frameType, channel, payload } with the frame-end byte consumed.
 */
async function readFrame(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<{
  frameType: number;
  channel: number;
  payload: Uint8Array;
}> {
  const header    = await readExact(reader, 7);
  const frameType = header[0];
  const channel   = (header[1] << 8) | header[2];
  const frameSize = new DataView(header.buffer, 3, 4).getUint32(0, false);
  const payload   = await readExact(reader, frameSize);
  const end       = await readExact(reader, 1);
  if (end[0] !== FRAME_END) {
    throw new Error(`Invalid frame-end marker: 0x${end[0].toString(16)}`);
  }
  return { frameType, channel, payload };
}

/**
 * Read a METHOD frame and assert class/method IDs.
 * Returns the argument bytes (payload after the 4-byte class+method header).
 */
async function expectMethod(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  expectedClass: number,
  expectedMethod: number,
): Promise<Uint8Array> {
  const { frameType, payload } = await readFrame(reader);
  if (frameType !== FRAME_METHOD) {
    throw new Error(`Expected METHOD frame, got type ${frameType}`);
  }
  const classId  = (payload[0] << 8) | payload[1];
  const methodId = (payload[2] << 8) | payload[3];
  if (classId !== expectedClass || methodId !== expectedMethod) {
    throw new Error(
      `Expected method (${expectedClass}, ${expectedMethod}), got (${classId}, ${methodId})`
    );
  }
  return payload.subarray(4);
}

// ---- Per-method Frame Builders -----------------------------------------------

function buildConnectionStartOk(username: string, password: string): Uint8Array {
  const clientProps = encodeFieldTable({ product: 'PortOfCall', version: '1.0' });
  const mechanism   = encodeShortString('PLAIN');

  // PLAIN response: NUL + username + NUL + password (raw bytes, not a string)
  const userBytes = encoder.encode(username);
  const passBytes = encoder.encode(password);
  const saslBytes = new Uint8Array(1 + userBytes.length + 1 + passBytes.length);
  saslBytes[0] = 0x00;
  saslBytes.set(userBytes, 1);
  saslBytes[1 + userBytes.length] = 0x00;
  saslBytes.set(passBytes, 2 + userBytes.length);

  // Encode as AMQP long string (4-byte length prefix + raw bytes)
  const responseLong = new Uint8Array(4 + saslBytes.length);
  new DataView(responseLong.buffer).setUint32(0, saslBytes.length, false);
  responseLong.set(saslBytes, 4);

  const locale = encodeShortString('en_US');
  const args   = concat(clientProps, mechanism, responseLong, locale);
  return buildFrame(FRAME_METHOD, 0, buildMethodPayload(CLASS_CONNECTION, METHOD_CONNECTION_START_OK, args));
}

function buildConnectionTuneOk(channelMax: number, frameMax: number, heartbeat: number): Uint8Array {
  // channel_max (uint16) + frame_max (uint32) + heartbeat (uint16) = 8 bytes
  const args = new Uint8Array(8);
  const view = new DataView(args.buffer);
  view.setUint16(0, channelMax, false);
  view.setUint32(2, frameMax,   false);
  view.setUint16(6, heartbeat,  false);
  return buildFrame(FRAME_METHOD, 0, buildMethodPayload(CLASS_CONNECTION, METHOD_CONNECTION_TUNE_OK, args));
}

function buildConnectionOpen(vhost: string): Uint8Array {
  const args = concat(
    encodeShortString(vhost),
    encodeShortString(''),  // reserved1
    new Uint8Array([0x00]), // reserved2 (boolean)
  );
  return buildFrame(FRAME_METHOD, 0, buildMethodPayload(CLASS_CONNECTION, METHOD_CONNECTION_OPEN, args));
}

function buildChannelOpen(): Uint8Array {
  // reserved1: long string "" = 4 zero bytes
  const reserved1 = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
  return buildFrame(FRAME_METHOD, 1, buildMethodPayload(CLASS_CHANNEL, METHOD_CHANNEL_OPEN, reserved1));
}

function buildExchangeDeclare(exchange: string, type = 'direct', durable = false): Uint8Array {
  // flags byte: bit0=passive, bit1=durable, bit2=auto-delete, bit3=internal, bit4=no-wait
  const flags = (durable ? 0x02 : 0x00);
  const args = concat(
    new Uint8Array([0x00, 0x00]),  // reserved1 (uint16)
    encodeShortString(exchange),
    encodeShortString(type),
    new Uint8Array([flags]),
    encodeFieldTable({}),          // arguments (empty table)
  );
  return buildFrame(FRAME_METHOD, 1, buildMethodPayload(CLASS_EXCHANGE, METHOD_EXCHANGE_DECLARE, args));
}

function buildBasicPublish(exchange: string, routingKey: string): Uint8Array {
  const args = concat(
    new Uint8Array([0x00, 0x00]),  // reserved1 (uint16)
    encodeShortString(exchange),
    encodeShortString(routingKey),
    new Uint8Array([0x00]),         // mandatory (boolean)
    new Uint8Array([0x00]),         // immediate (boolean)
  );
  return buildFrame(FRAME_METHOD, 1, buildMethodPayload(CLASS_BASIC, METHOD_BASIC_PUBLISH, args));
}

function buildContentHeader(bodySize: number): Uint8Array {
  // Payload: class-id (2) + weight (2) + body-size (8) + property-flags (2) + content-type short string
  const contentType   = encodeShortString('text/plain');
  const propertyFlags = 0x8000; // bit 15 set = content-type present
  const headerPayload = new Uint8Array(2 + 2 + 8 + 2 + contentType.length);
  const view = new DataView(headerPayload.buffer);
  view.setUint16(0, CLASS_BASIC, false);   // class-id = 60
  view.setUint16(2, 0, false);              // weight (always 0)
  view.setUint32(4, 0, false);              // body-size high 32 bits
  view.setUint32(8, bodySize, false);       // body-size low 32 bits
  view.setUint16(12, propertyFlags, false);
  headerPayload.set(contentType, 14);
  return buildFrame(FRAME_HEADER, 1, headerPayload);
}

function buildContentBody(message: string): Uint8Array {
  return buildFrame(FRAME_BODY, 1, encoder.encode(message));
}

function buildChannelClose(): Uint8Array {
  // reply-code (uint16) + reply-text (short string) + class-id (uint16) + method-id (uint16)
  const args = concat(
    new Uint8Array([0x00, 0xc8]),   // reply-code 200
    encodeShortString('Normal shutdown'),
    new Uint8Array([0x00, 0x00]),   // class-id 0
    new Uint8Array([0x00, 0x00]),   // method-id 0
  );
  return buildFrame(FRAME_METHOD, 1, buildMethodPayload(CLASS_CHANNEL, METHOD_CHANNEL_CLOSE, args));
}

function buildConnectionClose(): Uint8Array {
  const args = concat(
    new Uint8Array([0x00, 0xc8]),   // reply-code 200
    encodeShortString('Normal shutdown'),
    new Uint8Array([0x00, 0x00]),   // class-id 0
    new Uint8Array([0x00, 0x00]),   // method-id 0
  );
  return buildFrame(FRAME_METHOD, 0, buildMethodPayload(CLASS_CONNECTION, METHOD_CONNECTION_CLOSE, args));
}

function buildConfirmSelect(): Uint8Array {
  // Confirm.Select: nowait=false (1 byte)
  return buildFrame(FRAME_METHOD, 1, buildMethodPayload(CLASS_CONFIRM, METHOD_CONFIRM_SELECT, new Uint8Array([0x00])));
}

function buildBasicAck(deliveryTag: bigint, multiple: boolean): Uint8Array {
  const args = new Uint8Array(9);
  const view = new DataView(args.buffer);
  view.setBigUint64(0, deliveryTag, false);
  args[8] = multiple ? 1 : 0;
  return buildFrame(FRAME_METHOD, 1, buildMethodPayload(CLASS_BASIC, METHOD_BASIC_ACK, args));
}

function buildBasicGet(queue: string, noAck: boolean): Uint8Array {
  const args = concat(
    new Uint8Array([0x00, 0x00]),  // reserved1 (uint16)
    encodeShortString(queue),
    new Uint8Array([noAck ? 0x01 : 0x00]),
  );
  return buildFrame(FRAME_METHOD, 1, buildMethodPayload(CLASS_BASIC, METHOD_BASIC_GET, args));
}

function buildQueueBind(queue: string, exchange: string, routingKey: string): Uint8Array {
  const args = concat(
    new Uint8Array([0x00, 0x00]),  // reserved1 (uint16)
    encodeShortString(queue),
    encodeShortString(exchange),
    encodeShortString(routingKey),
    new Uint8Array([0x00]),        // no-wait = false
    encodeFieldTable({}),          // arguments
  );
  return buildFrame(FRAME_METHOD, 1, buildMethodPayload(CLASS_QUEUE, 20 /* Queue.Bind */, args));
}

// ---- Core Publish Logic (shared with amqps.ts) -------------------------------

export interface AMQPPublishParams {
  host: string;
  port: number;
  username: string;
  password: string;
  vhost: string;
  exchange: string;
  routingKey: string;
  message: string;
  timeout: number;
  secureTransport?: 'on' | 'off';
  exchangeType?: string;  // 'direct' | 'fanout' | 'topic' | 'headers'
  durable?: boolean;
}

export interface AMQPPublishResult {
  success: boolean;
  host: string;
  port: number;
  exchange: string;
  routingKey: string;
  messageSize: number;
  message: string;
}

export async function doAMQPPublish(params: AMQPPublishParams): Promise<AMQPPublishResult> {
  const {
    host, port, username, password, vhost,
    exchange, routingKey, message: msgText,
    secureTransport = 'off',
    exchangeType = 'direct',
    durable = false,
  } = params;

  const connectOptions = secureTransport === 'on'
    ? { secureTransport: 'on' as const, allowHalfOpen: false }
    : { allowHalfOpen: false };

  const socket = connect(`${host}:${port}`, connectOptions);
  await socket.opened;

  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  try {
    // Step 1: Send protocol header
    await writer.write(AMQP_PROTOCOL_HEADER);

    // Step 2: Receive Connection.Start (ignore version/properties)
    await expectMethod(reader, CLASS_CONNECTION, METHOD_CONNECTION_START);

    // Step 3: Send Connection.StartOk
    await writer.write(buildConnectionStartOk(username, password));

    // Step 4: Receive Connection.Tune -- echo back the same values
    const tuneArgs   = await expectMethod(reader, CLASS_CONNECTION, METHOD_CONNECTION_TUNE);
    const tuneView   = new DataView(tuneArgs.buffer, tuneArgs.byteOffset);
    const channelMax = tuneView.getUint16(0, false);
    const frameMax   = tuneView.getUint32(2, false);
    const heartbeat  = tuneView.getUint16(6, false);

    // Step 5: Send Connection.TuneOk
    await writer.write(buildConnectionTuneOk(channelMax, frameMax, heartbeat));

    // Step 6: Send Connection.Open
    await writer.write(buildConnectionOpen(vhost));

    // Step 7: Receive Connection.OpenOk
    await expectMethod(reader, CLASS_CONNECTION, METHOD_CONNECTION_OPEN_OK);

    // Step 8: Send Channel.Open on channel 1
    await writer.write(buildChannelOpen());

    // Step 9: Receive Channel.OpenOk
    await expectMethod(reader, CLASS_CHANNEL, METHOD_CHANNEL_OPEN_OK);

    // Step 10: Optionally declare exchange (skip for default "")
    if (exchange !== '') {
      await writer.write(buildExchangeDeclare(exchange, exchangeType, durable));
      await expectMethod(reader, CLASS_EXCHANGE, METHOD_EXCHANGE_DECLARE_OK);
    }

    // Step 11: Publish message (Basic.Publish + Content Header + Content Body)
    const bodyBytes = encoder.encode(msgText);
    await writer.write(buildBasicPublish(exchange, routingKey));
    await writer.write(buildContentHeader(bodyBytes.length));
    await writer.write(buildContentBody(msgText));

    // Step 12: Graceful close
    await writer.write(buildChannelClose());
    try {
      await expectMethod(reader, CLASS_CHANNEL, METHOD_CHANNEL_CLOSE_OK);
    } catch {
      // Server may close immediately; not fatal
    }

    await writer.write(buildConnectionClose());
    try {
      await expectMethod(reader, CLASS_CONNECTION, METHOD_CONNECTION_CLOSE_OK);
    } catch {
      // Server may close immediately; not fatal
    }

    return {
      success: true,
      host,
      port,
      exchange,
      routingKey,
      messageSize: bodyBytes.length,
      message: 'Message published successfully',
    };
  } finally {
    try { await writer.close();  } catch { /* ignore */ }
    try { await reader.cancel(); } catch { /* ignore */ }
    try { await socket.close();  } catch { /* ignore */ }
  }
}

// ---- Public Handlers --------------------------------------------------------

/**
 * Handle AMQP connectivity test
 * POST /api/amqp/connect
 *
 * Sends the AMQP 0-9-1 protocol header and parses the Connection.Start
 * response to extract server product, version, platform, and auth mechanisms.
 */
export async function handleAMQPConnect(request: Request): Promise<Response> {
  try {
    const { host, port = 5672, timeout = 10000 } = await request.json<{
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
        const frameType   = frameHeader[0];
        const frameSize   = new DataView(frameHeader.buffer, 3, 4).getUint32(0, false);

        if (frameType !== FRAME_METHOD) {
          // Server may have rejected with its own protocol header (version mismatch)
          if (frameHeader[0] === 0x41 && frameHeader[1] === 0x4d) {
            // "AM" -- server sent back AMQP header with different version
            const rest           = await readExact(reader, 1);
            const serverMajor    = frameHeader[5];
            const serverMinor    = frameHeader[6];
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
        const classId  = (payload[0] << 8) | payload[1];
        const methodId = (payload[2] << 8) | payload[3];

        if (classId !== CLASS_CONNECTION || methodId !== METHOD_CONNECTION_START) {
          throw new Error(`Unexpected method: class=${classId} method=${methodId}`);
        }

        const versionMajor = payload[4];
        const versionMinor = payload[5];

        let offset = 6;
        const propsResult  = readFieldTable(payload, offset);
        offset += propsResult.bytesRead;

        const mechResult   = readLongString(payload, offset);
        offset += mechResult.bytesRead;

        const localeResult = readLongString(payload, offset);

        await socket.close();

        return {
          success: true,
          host,
          port,
          protocol:         `AMQP ${versionMajor}-${versionMinor}`,
          serverProperties: propsResult.value,
          mechanisms:       mechResult.value.trim().split(/\s+/),
          locales:          localeResult.value.trim().split(/\s+/),
          product:          propsResult.value['product']  || 'Unknown',
          version:          propsResult.value['version']  || 'Unknown',
          platform:         propsResult.value['platform'] || 'Unknown',
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

/**
 * Handle AMQP message publishing
 * POST /api/amqp/publish
 *
 * Performs a full AMQP 0-9-1 connection, opens a channel, optionally declares
 * an exchange, publishes a message, then closes cleanly.
 *
 * Request body: { host, port, username, password, vhost, exchange, routingKey, message, timeout }
 */
export async function handleAMQPPublish(request: Request): Promise<Response> {
  try {
    const body = await request.json<{
      host: string;
      port?: number;
      username?: string;
      password?: string;
      vhost?: string;
      exchange?: string;
      exchangeType?: string;
      durable?: boolean;
      routingKey?: string;
      message?: string;
      timeout?: number;
    }>();

    const {
      host,
      port         = 5672,
      username     = 'guest',
      password     = 'guest',
      vhost        = '/',
      exchange     = '',
      exchangeType = 'direct',
      durable      = false,
      routingKey   = '',
      message      = '',
      timeout      = 15000,
    } = body;

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

    const publishPromise = doAMQPPublish({
      host, port, username, password, vhost,
      exchange, exchangeType, durable, routingKey, message, timeout,
      secureTransport: 'off',
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Publish timeout')), timeout)
    );

    const result = await Promise.race([publishPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Publish failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}


// ---- AMQP Consume Support ---------------------------------------------------

// Queue class = 50
const CLASS_QUEUE             = 50;
const METHOD_QUEUE_DECLARE    = 10;
const METHOD_QUEUE_DECLARE_OK = 11;

// Additional Basic methods
const METHOD_BASIC_CONSUME    = 20;
const METHOD_BASIC_CONSUME_OK = 21;
const METHOD_BASIC_DELIVER    = 60;

export interface AMQPConsumedMessage {
  exchange: string;
  routing_key: string;
  body_text: string;
}

export interface AMQPConsumeResult {
  success: boolean;
  host: string;
  port: number;
  queue: string;
  messages: AMQPConsumedMessage[];
  messageCount: number;
}

function buildQueueDeclare(queue: string): Uint8Array {
  const args = concat(
    new Uint8Array([0x00, 0x00]),  // reserved1 (uint16)
    encodeShortString(queue),
    new Uint8Array([0x00]),        // flags byte: passive|durable|exclusive|auto-delete|no-wait = all 0
    encodeFieldTable({}),          // arguments (empty table)
  );
  return buildFrame(FRAME_METHOD, 1, buildMethodPayload(CLASS_QUEUE, METHOD_QUEUE_DECLARE, args));
}

function buildBasicConsume(queue: string): Uint8Array {
  // flags byte: no-local=bit0=0, no-ack=bit1=1, exclusive=bit2=0, no-wait=bit3=0 => 0x02
  const args = concat(
    new Uint8Array([0x00, 0x00]),  // reserved1 (uint16)
    encodeShortString(queue),
    encodeShortString(''),         // consumer-tag (empty = server-assigned)
    new Uint8Array([0x02]),        // flags: no-ack=true
    encodeFieldTable({}),          // arguments (empty table)
  );
  return buildFrame(FRAME_METHOD, 1, buildMethodPayload(CLASS_BASIC, METHOD_BASIC_CONSUME, args));
}

/** Read a frame with a timeout; returns null if timeout elapses first. */
async function readFrameWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<{ frameType: number; channel: number; payload: Uint8Array } | null> {
  const framePromise = readFrame(reader);
  const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  return Promise.race([framePromise, timeoutPromise]);
}

/**
 * Core AMQP consume logic (shared between plain and TLS connections).
 * Full 0-9-1 flow: handshake → Channel.Open → Queue.Declare → Basic.Consume →
 * collect Basic.Deliver+ContentHeader+ContentBody frames.
 */
export async function doAMQPConsume(
  host: string,
  port: number,
  username: string,
  password: string,
  vhost: string,
  queue: string,
  maxMessages: number,
  timeoutMs: number,
  secureTransport: 'on' | 'off',
): Promise<AMQPConsumeResult> {
  const connectOptions = secureTransport === 'on'
    ? { secureTransport: 'on' as const, allowHalfOpen: false }
    : { allowHalfOpen: false };

  const socket = connect(`${host}:${port}`, connectOptions);
  await socket.opened;

  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  try {
    // Full AMQP handshake
    await writer.write(AMQP_PROTOCOL_HEADER);
    await expectMethod(reader, CLASS_CONNECTION, METHOD_CONNECTION_START);
    await writer.write(buildConnectionStartOk(username, password));

    const tuneArgs   = await expectMethod(reader, CLASS_CONNECTION, METHOD_CONNECTION_TUNE);
    const tuneView   = new DataView(tuneArgs.buffer, tuneArgs.byteOffset);
    const channelMax = tuneView.getUint16(0, false);
    const frameMax   = tuneView.getUint32(2, false);
    const heartbeat  = tuneView.getUint16(6, false);

    await writer.write(buildConnectionTuneOk(channelMax, frameMax, heartbeat));
    await writer.write(buildConnectionOpen(vhost));
    await expectMethod(reader, CLASS_CONNECTION, METHOD_CONNECTION_OPEN_OK);

    // Open channel 1
    await writer.write(buildChannelOpen());
    await expectMethod(reader, CLASS_CHANNEL, METHOD_CHANNEL_OPEN_OK);

    // Queue.Declare
    await writer.write(buildQueueDeclare(queue));
    await expectMethod(reader, CLASS_QUEUE, METHOD_QUEUE_DECLARE_OK);

    // Basic.Consume
    await writer.write(buildBasicConsume(queue));
    await expectMethod(reader, CLASS_BASIC, METHOD_BASIC_CONSUME_OK);

    // Collect Basic.Deliver frames until timeout or maxMessages reached
    const messages: AMQPConsumedMessage[] = [];
    const deadline = Date.now() + timeoutMs;

    while (messages.length < maxMessages) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      const frame = await readFrameWithTimeout(reader, remaining);
      if (frame === null) break; // timed out

      // Only process METHOD frames
      if (frame.frameType !== FRAME_METHOD) continue;

      const classId  = (frame.payload[0] << 8) | frame.payload[1];
      const methodId = (frame.payload[2] << 8) | frame.payload[3];

      if (classId !== CLASS_BASIC || methodId !== METHOD_BASIC_DELIVER) continue;

      // Parse Basic.Deliver arguments (after the 4-byte class+method header)
      const args = frame.payload.subarray(4);
      let pos = 0;

      // consumer-tag (short string)
      const consumerTagR = readShortString(args, pos);
      pos += consumerTagR.bytesRead;

      // delivery-tag (uint64, 8 bytes)
      pos += 8;

      // redelivered (boolean, 1 byte)
      pos += 1;

      // exchange (short string)
      const exchangeR = readShortString(args, pos);
      pos += exchangeR.bytesRead;

      // routing-key (short string)
      const routingKeyR = readShortString(args, pos);

      // Read Content-Header frame
      const headerFrame = await readFrame(reader);
      if (headerFrame.frameType !== FRAME_HEADER) {
        throw new Error(`Expected Content-Header frame, got type ${headerFrame.frameType}`);
      }

      // class-id(2B) + weight(2B) + body-size(8B BE) = 12 bytes before properties
      const hv = new DataView(headerFrame.payload.buffer, headerFrame.payload.byteOffset);
      const bodySizeHi = hv.getUint32(4, false);
      const bodySizeLo = hv.getUint32(8, false);
      // Combine as a JS number (safe up to 2^53 bytes)
      const bodySize = bodySizeHi * 0x100000000 + bodySizeLo;

      // Collect Content-Body frames until we have bodySize bytes
      let collected = new Uint8Array(0);
      while (collected.length < bodySize) {
        const bodyFrame = await readFrame(reader);
        if (bodyFrame.frameType !== FRAME_BODY) {
          throw new Error(`Expected Content-Body frame, got type ${bodyFrame.frameType}`);
        }
        const merged = new Uint8Array(collected.length + bodyFrame.payload.length);
        merged.set(collected);
        merged.set(bodyFrame.payload, collected.length);
        collected = merged;
      }

      messages.push({
        exchange:    exchangeR.value,
        routing_key: routingKeyR.value,
        body_text:   decoder.decode(collected),
      });
    }

    // Graceful close
    await writer.write(buildChannelClose());
    try { await expectMethod(reader, CLASS_CHANNEL, METHOD_CHANNEL_CLOSE_OK); } catch { /* ignore */ }
    await writer.write(buildConnectionClose());
    try { await expectMethod(reader, CLASS_CONNECTION, METHOD_CONNECTION_CLOSE_OK); } catch { /* ignore */ }

    return {
      success: true,
      host,
      port,
      queue,
      messages,
      messageCount: messages.length,
    };
  } finally {
    try { await writer.close();  } catch { /* ignore */ }
    try { await reader.cancel(); } catch { /* ignore */ }
    try { await socket.close();  } catch { /* ignore */ }
  }
}

/**
 * Handle AMQP message consuming
 * POST /api/amqp/consume
 *
 * Performs a full AMQP 0-9-1 connection, declares the queue, starts consuming,
 * collects messages for up to timeoutMs ms, then closes cleanly.
 *
 * Request body: { host, port, username, password, vhost, queue, maxMessages?, timeoutMs? }
 */
export async function handleAMQPConsume(request: Request): Promise<Response> {
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
      port        = 5672,
      username    = 'guest',
      password    = 'guest',
      vhost       = '/',
      queue,
      maxMessages = 10,
      timeoutMs   = 3000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!queue) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: queue' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await doAMQPConsume(
      host, port, username, password, vhost, queue, maxMessages, timeoutMs, 'off',
    );

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Consume failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ---- Publisher Confirms -----------------------------------------------------

/**
 * Handle AMQP publisher confirms (guaranteed delivery).
 * POST /api/amqp/confirm-publish
 *
 * Activates RabbitMQ publisher confirms (Confirm.Select), publishes a message,
 * and waits for Basic.Ack or Basic.Nack from the broker.
 * Returns { acked, deliveryTag, multiple } so callers know if the message
 * was durably stored.
 *
 * Request body: { host, port, username, password, vhost, exchange, exchangeType,
 *                 durable, routingKey, message, timeout }
 */
export async function handleAMQPConfirmPublish(request: Request): Promise<Response> {
  const start = Date.now();
  try {
    const body = await request.json<{
      host: string;
      port?: number;
      username?: string;
      password?: string;
      vhost?: string;
      exchange?: string;
      exchangeType?: string;
      durable?: boolean;
      routingKey?: string;
      message?: string;
      timeout?: number;
    }>();

    const {
      host,
      port         = 5672,
      username     = 'guest',
      password     = 'guest',
      vhost        = '/',
      exchange     = '',
      exchangeType = 'direct',
      durable      = false,
      routingKey   = '',
      message      = '',
      timeout      = 15000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const doIt = async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();
      try {
        // Full handshake
        await writer.write(AMQP_PROTOCOL_HEADER);
        await expectMethod(reader, CLASS_CONNECTION, METHOD_CONNECTION_START);
        await writer.write(buildConnectionStartOk(username, password));
        const tuneArgs = await expectMethod(reader, CLASS_CONNECTION, METHOD_CONNECTION_TUNE);
        const tv = new DataView(tuneArgs.buffer, tuneArgs.byteOffset);
        await writer.write(buildConnectionTuneOk(tv.getUint16(0, false), tv.getUint32(2, false), tv.getUint16(6, false)));
        await writer.write(buildConnectionOpen(vhost));
        await expectMethod(reader, CLASS_CONNECTION, METHOD_CONNECTION_OPEN_OK);
        await writer.write(buildChannelOpen());
        await expectMethod(reader, CLASS_CHANNEL, METHOD_CHANNEL_OPEN_OK);

        // Activate publisher confirms
        await writer.write(buildConfirmSelect());
        await expectMethod(reader, CLASS_CONFIRM, METHOD_CONFIRM_SELECT_OK);

        // Optionally declare exchange
        if (exchange !== '') {
          await writer.write(buildExchangeDeclare(exchange, exchangeType, durable));
          await expectMethod(reader, CLASS_EXCHANGE, METHOD_EXCHANGE_DECLARE_OK);
        }

        // Publish
        const bodyBytes = encoder.encode(message);
        await writer.write(buildBasicPublish(exchange, routingKey));
        await writer.write(buildContentHeader(bodyBytes.length));
        await writer.write(buildContentBody(message));

        // Wait for Basic.Ack or Basic.Nack (delivery tag 1)
        let acked = false;
        let deliveryTag = 0n;
        let multiple = false;

        for (let attempt = 0; attempt < 10; attempt++) {
          const frame = await readFrame(reader);
          if (frame.frameType !== FRAME_METHOD) continue;
          const classId  = (frame.payload[0] << 8) | frame.payload[1];
          const methodId = (frame.payload[2] << 8) | frame.payload[3];
          if (classId !== CLASS_BASIC) continue;
          if (methodId === METHOD_BASIC_ACK || methodId === METHOD_BASIC_NACK) {
            const args = frame.payload.subarray(4);
            const dv = new DataView(args.buffer, args.byteOffset);
            deliveryTag = dv.getBigUint64(0, false);
            multiple = args[8] !== 0;
            acked = (methodId === METHOD_BASIC_ACK);
            break;
          }
        }

        // Graceful close
        await writer.write(buildChannelClose());
        try { await expectMethod(reader, CLASS_CHANNEL, METHOD_CHANNEL_CLOSE_OK); } catch { /* ignore */ }
        await writer.write(buildConnectionClose());
        try { await expectMethod(reader, CLASS_CONNECTION, METHOD_CONNECTION_CLOSE_OK); } catch { /* ignore */ }

        return {
          success: true,
          host, port, exchange, routingKey,
          messageSize: bodyBytes.length,
          acked,
          deliveryTag: deliveryTag.toString(),
          multiple,
          latencyMs: Date.now() - start,
        };
      } finally {
        try { await writer.close(); } catch { /* ignore */ }
        try { await reader.cancel(); } catch { /* ignore */ }
        try { await socket.close(); } catch { /* ignore */ }
      }
    };

    const result = await Promise.race([
      doIt(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Confirm-publish timeout')), timeout)),
    ]);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Confirm-publish failed',
      latencyMs: Date.now() - start,
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ---- Queue Bind --------------------------------------------------------------

/**
 * Bind a queue to an exchange with a routing key.
 * POST /api/amqp/bind
 *
 * Use after declaring an exchange and queue to set up routing.
 * For fanout exchanges the routingKey is ignored by the broker but must be present.
 *
 * Request body: { host, port, username, password, vhost, queue, exchange, routingKey, timeout }
 */
export async function handleAMQPBind(request: Request): Promise<Response> {
  const start = Date.now();
  try {
    const body = await request.json<{
      host: string;
      port?: number;
      username?: string;
      password?: string;
      vhost?: string;
      queue: string;
      exchange: string;
      routingKey?: string;
      timeout?: number;
    }>();

    const {
      host,
      port       = 5672,
      username   = 'guest',
      password   = 'guest',
      vhost      = '/',
      queue,
      exchange,
      routingKey = '',
      timeout    = 10000,
    } = body;

    if (!host || !queue || !exchange) {
      return new Response(JSON.stringify({ error: 'host, queue, and exchange are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const doIt = async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();
      try {
        // Full handshake
        await writer.write(AMQP_PROTOCOL_HEADER);
        await expectMethod(reader, CLASS_CONNECTION, METHOD_CONNECTION_START);
        await writer.write(buildConnectionStartOk(username, password));
        const tuneArgs = await expectMethod(reader, CLASS_CONNECTION, METHOD_CONNECTION_TUNE);
        const tv = new DataView(tuneArgs.buffer, tuneArgs.byteOffset);
        await writer.write(buildConnectionTuneOk(tv.getUint16(0, false), tv.getUint32(2, false), tv.getUint16(6, false)));
        await writer.write(buildConnectionOpen(vhost));
        await expectMethod(reader, CLASS_CONNECTION, METHOD_CONNECTION_OPEN_OK);
        await writer.write(buildChannelOpen());
        await expectMethod(reader, CLASS_CHANNEL, METHOD_CHANNEL_OPEN_OK);

        // Queue.Bind
        await writer.write(buildQueueBind(queue, exchange, routingKey));
        await expectMethod(reader, CLASS_QUEUE, 21 /* Queue.BindOk */);

        // Graceful close
        await writer.write(buildChannelClose());
        try { await expectMethod(reader, CLASS_CHANNEL, METHOD_CHANNEL_CLOSE_OK); } catch { /* ignore */ }
        await writer.write(buildConnectionClose());
        try { await expectMethod(reader, CLASS_CONNECTION, METHOD_CONNECTION_CLOSE_OK); } catch { /* ignore */ }

        return {
          success: true,
          host, port, queue, exchange, routingKey, vhost,
          latencyMs: Date.now() - start,
        };
      } finally {
        try { await writer.close(); } catch { /* ignore */ }
        try { await reader.cancel(); } catch { /* ignore */ }
        try { await socket.close(); } catch { /* ignore */ }
      }
    };

    const result = await Promise.race([
      doIt(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Bind timeout')), timeout)),
    ]);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Bind failed',
      latencyMs: Date.now() - start,
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ---- Basic.Get (synchronous pull) -------------------------------------------

/**
 * Pull a single message from a queue (Basic.Get).
 * POST /api/amqp/get
 *
 * Unlike Basic.Consume (which is push-based and requires a timeout), Basic.Get
 * is a synchronous pull — the server responds with either Basic.GetOk (with
 * the message content) or Basic.GetEmpty.
 *
 * Request body: { host, port, username, password, vhost, queue, ack?, timeout }
 *   ack: false (default) = no-ack mode (message is auto-acked); true = explicit ack
 */
export async function handleAMQPGet(request: Request): Promise<Response> {
  const start = Date.now();
  try {
    const body = await request.json<{
      host: string;
      port?: number;
      username?: string;
      password?: string;
      vhost?: string;
      queue: string;
      ack?: boolean;
      timeout?: number;
    }>();

    const {
      host,
      port     = 5672,
      username = 'guest',
      password = 'guest',
      vhost    = '/',
      queue,
      ack      = false,
      timeout  = 10000,
    } = body;

    if (!host || !queue) {
      return new Response(JSON.stringify({ error: 'host and queue are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const doIt = async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();
      try {
        // Full handshake
        await writer.write(AMQP_PROTOCOL_HEADER);
        await expectMethod(reader, CLASS_CONNECTION, METHOD_CONNECTION_START);
        await writer.write(buildConnectionStartOk(username, password));
        const tuneArgs = await expectMethod(reader, CLASS_CONNECTION, METHOD_CONNECTION_TUNE);
        const tv = new DataView(tuneArgs.buffer, tuneArgs.byteOffset);
        await writer.write(buildConnectionTuneOk(tv.getUint16(0, false), tv.getUint32(2, false), tv.getUint16(6, false)));
        await writer.write(buildConnectionOpen(vhost));
        await expectMethod(reader, CLASS_CONNECTION, METHOD_CONNECTION_OPEN_OK);
        await writer.write(buildChannelOpen());
        await expectMethod(reader, CLASS_CHANNEL, METHOD_CHANNEL_OPEN_OK);

        // Queue.Declare (passive=true so we don't accidentally create it)
        await writer.write(buildQueueDeclare(queue));
        const declareOkArgs = await expectMethod(reader, CLASS_QUEUE, METHOD_QUEUE_DECLARE_OK);
        const dv = new DataView(declareOkArgs.buffer, declareOkArgs.byteOffset);
        // Queue.DeclareOk: message-count(uint32) + consumer-count(uint32)
        const queueMessageCount  = dv.getUint32(0, false);
        const queueConsumerCount = dv.getUint32(4, false);

        // Basic.Get
        await writer.write(buildBasicGet(queue, !ack));
        const getFrame = await readFrame(reader);
        if (getFrame.frameType !== FRAME_METHOD) throw new Error(`Expected METHOD, got frame type ${getFrame.frameType}`);

        const classId  = (getFrame.payload[0] << 8) | getFrame.payload[1];
        const methodId = (getFrame.payload[2] << 8) | getFrame.payload[3];

        let result: Record<string, unknown>;

        if (classId === CLASS_BASIC && methodId === METHOD_BASIC_GET_EMPTY) {
          result = {
            success: true, host, port, queue,
            empty: true, message: null,
            queueMessageCount, queueConsumerCount,
            latencyMs: Date.now() - start,
          };
        } else if (classId === CLASS_BASIC && methodId === METHOD_BASIC_GET_OK) {
          const args = getFrame.payload.subarray(4);
          let pos = 0;
          const adv = new DataView(args.buffer, args.byteOffset);
          const deliveryTag = adv.getBigUint64(pos, false); pos += 8;
          const redelivered = args[pos] !== 0;             pos += 1;
          const exR = readShortString(args, pos); pos += exR.bytesRead;
          const rkR = readShortString(args, pos); pos += rkR.bytesRead;
          const msgCount = adv.getUint32(pos, false);

          // Read content header
          const headerFrame = await readFrame(reader);
          const hdv = new DataView(headerFrame.payload.buffer, headerFrame.payload.byteOffset);
          const bodySizeHi = hdv.getUint32(4, false);
          const bodySizeLo = hdv.getUint32(8, false);
          const bodySize = bodySizeHi * 0x100000000 + bodySizeLo;

          // Read body
          let collected = new Uint8Array(0);
          while (collected.length < bodySize) {
            const bodyFrame = await readFrame(reader);
            const merged = new Uint8Array(collected.length + bodyFrame.payload.length);
            merged.set(collected);
            merged.set(bodyFrame.payload, collected.length);
            collected = merged;
          }

          // Ack if requested
          if (ack) {
            await writer.write(buildBasicAck(deliveryTag, false));
          }

          result = {
            success: true, host, port, queue,
            empty: false,
            message: {
              deliveryTag: deliveryTag.toString(),
              redelivered,
              exchange: exR.value,
              routingKey: rkR.value,
              body: decoder.decode(collected),
              bodySize,
            },
            remainingMessages: msgCount,
            queueMessageCount, queueConsumerCount,
            latencyMs: Date.now() - start,
          };
        } else {
          throw new Error(`Unexpected method: class=${classId} method=${methodId}`);
        }

        // Graceful close
        await writer.write(buildChannelClose());
        try { await expectMethod(reader, CLASS_CHANNEL, METHOD_CHANNEL_CLOSE_OK); } catch { /* ignore */ }
        await writer.write(buildConnectionClose());
        try { await expectMethod(reader, CLASS_CONNECTION, METHOD_CONNECTION_CLOSE_OK); } catch { /* ignore */ }

        return result;
      } finally {
        try { await writer.close(); } catch { /* ignore */ }
        try { await reader.cancel(); } catch { /* ignore */ }
        try { await socket.close(); } catch { /* ignore */ }
      }
    };

    const result = await Promise.race([
      doIt(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Get timeout')), timeout)),
    ]);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Get failed',
      latencyMs: Date.now() - start,
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
