/**
 * MQTT Protocol Support for Cloudflare Workers
 * Implements MQTT 3.1.1 — connect, publish, subscribe, QoS 0/1, retained messages
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

export interface MQTTConnectionOptions {
  host: string;
  port?: number;
  clientId?: string;
  username?: string;
  password?: string;
  timeout?: number;
  /** Last Will and Testament */
  will?: {
    topic: string;
    payload: string;
    qos?: number;
    retain?: boolean;
  };
  cleanSession?: boolean;
  keepAlive?: number;
}

// ─── Crypto helpers ──────────────────────────────────────────────────────────

/** Generate a cryptographically random hex string of the given byte length */
function cryptoRandomHex(byteLen: number): string {
  const randomBytes = crypto.getRandomValues(new Uint8Array(byteLen));
  return Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Wire-level helpers ───────────────────────────────────────────────────────

/**
 * Encode MQTT remaining length (variable-length encoding, MQTT 3.1.1 §2.2.3)
 */
function encodeRemainingLength(length: number): number[] {
  const result: number[] = [];
  do {
    let byte = length % 128;
    length = Math.floor(length / 128);
    if (length > 0) byte |= 0x80;
    result.push(byte);
  } while (length > 0);
  return result;
}

/**
 * Decode MQTT remaining length from buffer at offset.
 * Returns { value, bytesConsumed } or null if buffer too short.
 */
function decodeRemainingLength(data: Uint8Array, offset: number): { value: number; bytesConsumed: number } | null {
  let multiplier = 1;
  let value = 0;
  let bytesConsumed = 0;
  while (true) {
    if (offset + bytesConsumed >= data.length) return null;
    const b = data[offset + bytesConsumed++];
    value += (b & 0x7f) * multiplier;
    multiplier *= 128;
    if ((b & 0x80) === 0) break;
    if (multiplier > 128 * 128 * 128) throw new Error('Malformed remaining length');
  }
  return { value, bytesConsumed };
}

/** Encode a UTF-8 string with 2-byte big-endian length prefix (MQTT string) */
function mqttStr(s: string): number[] {
  const bytes = [...new TextEncoder().encode(s)];
  return [bytes.length >> 8, bytes.length & 0xff, ...bytes];
}

/** Build a complete MQTT packet: fixed header byte, remaining length, payload */
function buildPacket(typeAndFlags: number, payload: number[]): Uint8Array {
  return new Uint8Array([typeAndFlags, ...encodeRemainingLength(payload.length), ...payload]);
}

// ─── Packet encoders ──────────────────────────────────────────────────────────

function encodeCONNECT(opts: {
  clientId: string;
  username?: string;
  password?: string;
  will?: { topic: string; payload: string; qos?: number; retain?: boolean };
  cleanSession?: boolean;
  keepAlive?: number;
}): Uint8Array {
  const keepAlive = opts.keepAlive ?? 60;
  let connectFlags = opts.cleanSession !== false ? 0x02 : 0x00;
  if (opts.will) {
    connectFlags |= 0x04;
    connectFlags |= ((opts.will.qos ?? 0) & 0x03) << 3;
    if (opts.will.retain) connectFlags |= 0x20;
  }
  if (opts.username) connectFlags |= 0x80;
  if (opts.password) connectFlags |= 0x40;

  const varHeader: number[] = [
    0x00, 0x04, // Protocol name length = 4
    0x4d, 0x51, 0x54, 0x54, // "MQTT"
    0x04, // Protocol level = 4 (MQTT 3.1.1)
    connectFlags,
    keepAlive >> 8, keepAlive & 0xff,
  ];

  const payload: number[] = [...mqttStr(opts.clientId)];
  if (opts.will) {
    payload.push(...mqttStr(opts.will.topic));
    payload.push(...mqttStr(opts.will.payload));
  }
  if (opts.username) payload.push(...mqttStr(opts.username));
  if (opts.password) payload.push(...mqttStr(opts.password));

  return buildPacket(0x10, [...varHeader, ...payload]);
}

function encodePUBLISH(opts: {
  topic: string;
  payload: string | Uint8Array;
  qos?: number;
  retain?: boolean;
  dup?: boolean;
  messageId?: number;
}): Uint8Array {
  const qos = opts.qos ?? 0;
  const flagByte =
    0x30 |
    (opts.dup ? 0x08 : 0) |
    ((qos & 0x03) << 1) |
    (opts.retain ? 0x01 : 0);

  const topicBytes = mqttStr(opts.topic);
  const body: number[] = [...topicBytes];
  if (qos > 0) {
    const mid = opts.messageId ?? 1;
    body.push(mid >> 8, mid & 0xff);
  }
  const payloadBytes =
    opts.payload instanceof Uint8Array
      ? [...opts.payload]
      : [...new TextEncoder().encode(opts.payload)];
  body.push(...payloadBytes);

  return buildPacket(flagByte, body);
}

function encodeSUBSCRIBE(messageId: number, topics: Array<{ topic: string; qos?: number }>): Uint8Array {
  const payload: number[] = [messageId >> 8, messageId & 0xff];
  for (const { topic, qos } of topics) {
    payload.push(...mqttStr(topic));
    payload.push(qos ?? 0);
  }
  return buildPacket(0x82, payload); // SUBSCRIBE, reserved flags = 0b0010
}

function encodeUNSUBSCRIBE(messageId: number, topics: string[]): Uint8Array {
  const payload: number[] = [messageId >> 8, messageId & 0xff];
  for (const t of topics) payload.push(...mqttStr(t));
  return buildPacket(0xa2, payload); // UNSUBSCRIBE, reserved flags = 0b0010
}

function encodePUBACK(messageId: number): Uint8Array {
  return buildPacket(0x40, [messageId >> 8, messageId & 0xff]);
}

const PINGREQ = new Uint8Array([0xc0, 0x00]);
const DISCONNECT = new Uint8Array([0xe0, 0x00]);

// ─── Packet parser ────────────────────────────────────────────────────────────

interface MQTTPacket {
  type: number;       // packet type (1–14)
  typeName: string;
  flags: number;      // lower 4 bits of first byte
  payload: Uint8Array;
  /** Parsed fields for known packet types */
  parsed?: Record<string, unknown>;
}

const PKT_NAMES: Record<number, string> = {
  1: 'CONNECT', 2: 'CONNACK', 3: 'PUBLISH', 4: 'PUBACK', 5: 'PUBREC',
  6: 'PUBREL', 7: 'PUBCOMP', 8: 'SUBSCRIBE', 9: 'SUBACK', 10: 'UNSUBSCRIBE',
  11: 'UNSUBACK', 12: 'PINGREQ', 13: 'PINGRESP', 14: 'DISCONNECT',
};

function parseMQTTPacket(data: Uint8Array): MQTTPacket | null {
  if (data.length < 2) return null;
  const firstByte = data[0];
  const type = firstByte >> 4;
  const flags = firstByte & 0x0f;

  const rl = decodeRemainingLength(data, 1);
  if (!rl) return null;
  const headerLen = 1 + rl.bytesConsumed;
  if (data.length < headerLen + rl.value) return null;

  const payload = data.slice(headerLen, headerLen + rl.value);
  const pkt: MQTTPacket = { type, typeName: PKT_NAMES[type] ?? `UNKNOWN(${type})`, flags, payload };

  if (type === 2) {
    // CONNACK: sessionPresent + returnCode
    pkt.parsed = { sessionPresent: !!(payload[0] & 0x01), returnCode: payload[1] };
  } else if (type === 3) {
    // PUBLISH: topic (2-byte len), optional messageId (QoS>0), payload
    const qos = (flags >> 1) & 0x03;
    if (qos === 3) throw new Error('Invalid QoS value 3 (reserved by MQTT spec)');
    const retain = !!(flags & 0x01);
    const dup = !!(flags & 0x08);
    let pos = 0;
    const topicLen = (payload[pos++] << 8) | payload[pos++];
    const topic = new TextDecoder().decode(payload.slice(pos, pos + topicLen));
    pos += topicLen;
    let messageId: number | undefined;
    if (qos > 0) {
      messageId = (payload[pos++] << 8) | payload[pos++];
    }
    const msgPayload = new TextDecoder().decode(payload.slice(pos));
    pkt.parsed = { topic, payload: msgPayload, qos, retain, dup, messageId };
  } else if (type === 4 || type === 9 || type === 11) {
    // PUBACK / SUBACK / UNSUBACK: first two bytes = messageId
    const messageId = (payload[0] << 8) | payload[1];
    if (type === 9) {
      // SUBACK: remaining bytes = granted QoS per subscription
      const grantedQoS = [...payload.slice(2)];
      pkt.parsed = { messageId, grantedQoS };
    } else {
      pkt.parsed = { messageId };
    }
  }

  return pkt;
}

/**
 * Accumulate raw socket bytes into complete MQTT packets.
 * Returns [completedPackets, leftoverBytes]
 */
function extractPackets(buf: Uint8Array): [MQTTPacket[], Uint8Array<ArrayBuffer>] {
  const packets: MQTTPacket[] = [];
  let offset = 0;
  while (offset < buf.length) {
    if (offset + 1 >= buf.length) break; // need at least 2 bytes
    const rl = decodeRemainingLength(buf, offset + 1);
    if (!rl) break;
    const totalLen = 1 + rl.bytesConsumed + rl.value;
    if (offset + totalLen > buf.length) break;
    const pkt = parseMQTTPacket(buf.slice(offset, offset + totalLen));
    if (pkt) packets.push(pkt);
    offset += totalLen;
  }
  const leftover = new Uint8Array(buf.length - offset);
  leftover.set(buf.subarray(offset));
  return [packets, leftover];
}

// ─── Shared connect helper ────────────────────────────────────────────────────

async function mqttConnect(opts: {
  host: string;
  port: number;
  clientId: string;
  username?: string;
  password?: string;
  will?: { topic: string; payload: string; qos?: number; retain?: boolean };
  cleanSession?: boolean;
  keepAlive?: number;
  timeoutMs: number;
}): Promise<{
  socket: Socket;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  sessionPresent: boolean;
}> {
  const socket = connect(`${opts.host}:${opts.port}`);
  await socket.opened;
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();

  await writer.write(encodeCONNECT(opts));

  // Read CONNACK
  const connackBuf = await Promise.race([
    reader.read().then(r => r.value!),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('CONNACK timeout')), opts.timeoutMs)),
  ]);

  const connack = parseMQTTPacket(connackBuf);
  if (!connack || connack.type !== 2) throw new Error('Expected CONNACK');
  const rc = (connack.parsed as { returnCode: number; sessionPresent: boolean }).returnCode;
  if (rc !== 0) {
    const messages: Record<number, string> = {
      1: 'Unacceptable protocol version',
      2: 'Identifier rejected',
      3: 'Server unavailable',
      4: 'Bad username or password',
      5: 'Not authorized',
    };
    throw new Error(`CONNACK refused: ${messages[rc] ?? `code ${rc}`}`);
  }
  const sessionPresent = (connack.parsed as { sessionPresent: boolean }).sessionPresent;
  return { socket, reader, writer, sessionPresent };
}

// ─── HTTP handlers ────────────────────────────────────────────────────────────

/**
 * POST /api/mqtt/connect — test connectivity + CONNACK
 */
export async function handleMQTTConnect(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: { 'Allow': 'POST', 'Content-Type': 'application/json' } });
    }
    const options = await request.json() as Partial<MQTTConnectionOptions>;

    if (!options.host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 1883;
    const timeoutMs = options.timeout || 10000;
    const clientId = options.clientId || `poc-${cryptoRandomHex(8)}`;

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const { socket, sessionPresent } = await Promise.race([
      mqttConnect({ host, port, clientId, username: options.username, password: options.password, timeoutMs }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)),
    ]);

    // Send DISCONNECT gracefully
    const writer = socket.writable.getWriter();
    await writer.write(DISCONNECT).catch(() => {});
    await socket.close().catch(() => {});

    return new Response(JSON.stringify({
      success: true,
      message: 'MQTT connection successful',
      host, port, clientId, sessionPresent,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * POST /api/mqtt/publish — connect, publish one message (QoS 0 or 1), disconnect
 *
 * Body: { host, port?, clientId?, username?, password?, topic, payload, qos?, retain?, timeout? }
 */
export async function handleMQTTPublish(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
    }

    const body = await request.json() as {
      host: string;
      port?: number;
      clientId?: string;
      username?: string;
      password?: string;
      topic: string;
      payload: string;
      qos?: number;
      retain?: boolean;
      timeout?: number;
    };

    if (!body.host || !body.topic || body.payload === undefined) {
      return new Response(JSON.stringify({ error: 'Missing required fields: host, topic, payload' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = body.host;
    const port = body.port || 1883;
    const timeoutMs = body.timeout || 10000;
    const qos = Math.min(body.qos ?? 0, 1); // we support QoS 0 and 1
    const clientId = body.clientId || `poc-pub-${cryptoRandomHex(8)}`;

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const { socket, reader, writer } = await Promise.race([
      mqttConnect({ host, port, clientId, username: body.username, password: body.password, timeoutMs }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connect timeout')), timeoutMs)),
    ]);

    const messageId = 1;
    await writer.write(encodePUBLISH({
      topic: body.topic,
      payload: body.payload,
      qos,
      retain: body.retain ?? false,
      messageId,
    }));

    if (qos === 1) {
      // Wait for PUBACK
      let leftover = new Uint8Array(0);
      await Promise.race([
        (async () => {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const combined = new Uint8Array(leftover.length + value.length);
            combined.set(leftover);
            combined.set(new Uint8Array(value), leftover.length);
            const [pkts, remaining] = extractPackets(combined);
            leftover = remaining;
            const puback = pkts.find(p => p.type === 4);
            if (puback) break;
          }
        })(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('PUBACK timeout')), timeoutMs)),
      ]);
    }

    await writer.write(DISCONNECT).catch(() => {});
    await socket.close().catch(() => {});

    return new Response(JSON.stringify({
      success: true,
      message: `Published to "${body.topic}"`,
      topic: body.topic,
      payload: body.payload,
      qos,
      retain: body.retain ?? false,
      messageId: qos > 0 ? messageId : undefined,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Publish failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * GET /api/mqtt/session — interactive WebSocket session
 * Query params: host, port, clientId, username, password, willTopic, willPayload, cleanSession
 *
 * WebSocket protocol:
 *   Client → Worker:
 *     { type: 'publish', topic: string, payload: string, qos?: 0|1, retain?: boolean }
 *     { type: 'subscribe', topics: Array<{ topic: string, qos?: 0|1 }> }
 *     { type: 'unsubscribe', topics: string[] }
 *     { type: 'ping' }
 *     { type: 'disconnect' }
 *
 *   Worker → Client:
 *     { type: 'connected', host, port, clientId, sessionPresent }
 *     { type: 'subscribed', messageId, topics, grantedQoS }
 *     { type: 'unsubscribed', messageId, topics }
 *     { type: 'published', topic, qos, messageId? }
 *     { type: 'message', topic, payload, qos, retain, dup }
 *     { type: 'pong' }
 *     { type: 'error', message }
 */
export async function handleMQTTSession(request: Request): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('WebSocket upgrade required', { status: 426 });
  }

  const url = new URL(request.url);
  const host = url.searchParams.get('host') || '';
  const port = parseInt(url.searchParams.get('port') || '1883');
  const clientId = url.searchParams.get('clientId') || `poc-${cryptoRandomHex(8)}`;
  const username = url.searchParams.get('username') || undefined;
  const password = url.searchParams.get('password') || undefined;
  const willTopic = url.searchParams.get('willTopic') || undefined;
  const willPayload = url.searchParams.get('willPayload') || undefined;
  const cleanSession = url.searchParams.get('cleanSession') !== 'false';

  if (!host) {
    return new Response(JSON.stringify({ error: 'Missing host' }), { status: 400 });
  }

  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    return new Response(JSON.stringify({ error: getCloudflareErrorMessage(host, cfCheck.ip) }), { status: 403 });
  }

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();

  (async () => {
    let mqttSocket: Socket | null = null;
    let msgIdCounter = 1;
    const nextMsgId = () => (msgIdCounter++ & 0xffff) || 1;

    try {
      const will = willTopic && willPayload ? { topic: willTopic, payload: willPayload } : undefined;
      const { socket, reader, writer, sessionPresent } = await mqttConnect({
        host, port, clientId, username, password, will, cleanSession, timeoutMs: 10000,
      });
      mqttSocket = socket;

      server.send(JSON.stringify({ type: 'connected', host, port, clientId, sessionPresent }));

      // Background loop: read inbound MQTT packets from broker and forward to browser
      let leftover = new Uint8Array(0);
      const readLoop = (async () => {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const combined = new Uint8Array(leftover.length + value.length);
          combined.set(leftover);
          combined.set(value, leftover.length);
          const [pkts, remaining] = extractPackets(combined);
          leftover = remaining;
          for (const pkt of pkts) {
            if (pkt.type === 3) {
              // PUBLISH from broker — send ACK if QoS 1
              const pub = pkt.parsed as { topic: string; payload: string; qos: number; retain: boolean; dup: boolean; messageId?: number };
              if (pub.qos === 1 && pub.messageId !== undefined) {
                await writer.write(encodePUBACK(pub.messageId)).catch(() => {});
              }
              server.send(JSON.stringify({
                type: 'message',
                topic: pub.topic,
                payload: pub.payload,
                qos: pub.qos,
                retain: pub.retain,
                dup: pub.dup,
              }));
            } else if (pkt.type === 9) {
              // SUBACK
              const sub = pkt.parsed as { messageId: number; grantedQoS: number[] };
              server.send(JSON.stringify({ type: 'subscribed', messageId: sub.messageId, grantedQoS: sub.grantedQoS }));
            } else if (pkt.type === 11) {
              // UNSUBACK
              const unsub = pkt.parsed as { messageId: number };
              server.send(JSON.stringify({ type: 'unsubscribed', messageId: unsub.messageId }));
            } else if (pkt.type === 4) {
              // PUBACK — just forward
              const puback = pkt.parsed as { messageId: number };
              server.send(JSON.stringify({ type: 'puback', messageId: puback.messageId }));
            } else if (pkt.type === 13) {
              // PINGRESP
              server.send(JSON.stringify({ type: 'pong' }));
            }
          }
        }
      })();

      // Handle browser → worker commands
      server.addEventListener('message', async (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type: string;
            topic?: string;
            payload?: string;
            qos?: number;
            retain?: boolean;
            topics?: Array<{ topic: string; qos?: number }> | string[];
          };

          if (msg.type === 'publish') {
            const qos = Math.min(msg.qos ?? 0, 1);
            const mid = qos > 0 ? nextMsgId() : undefined;
            await writer.write(encodePUBLISH({
              topic: msg.topic!,
              payload: msg.payload ?? '',
              qos,
              retain: msg.retain ?? false,
              messageId: mid,
            }));
            server.send(JSON.stringify({ type: 'published', topic: msg.topic, qos, messageId: mid }));

          } else if (msg.type === 'subscribe') {
            const mid = nextMsgId();
            const topics = (msg.topics as Array<{ topic: string; qos?: number }>).map(t =>
              typeof t === 'string' ? { topic: t, qos: 0 } : t
            );
            await writer.write(encodeSUBSCRIBE(mid, topics));

          } else if (msg.type === 'unsubscribe') {
            const mid = nextMsgId();
            const topics = (msg.topics as string[]).map(t => typeof t === 'string' ? t : (t as { topic: string }).topic);
            await writer.write(encodeUNSUBSCRIBE(mid, topics));

          } else if (msg.type === 'ping') {
            await writer.write(PINGREQ);

          } else if (msg.type === 'disconnect') {
            await writer.write(DISCONNECT).catch(() => {});
            server.close();
          }
        } catch (e) {
          server.send(JSON.stringify({ type: 'error', message: String(e) }));
        }
      });

      server.addEventListener('close', async () => {
        try { await writer.write(DISCONNECT); } catch { /* ignore */ }
        mqttSocket?.close().catch(() => {});
      });

      // If readLoop exits (broker closed), close the WS
      readLoop.then(() => server.close()).catch(() => server.close());

    } catch (e) {
      server.send(JSON.stringify({ type: 'error', message: String(e) }));
      server.close();
      mqttSocket?.close().catch(() => {});
    }
  })();

  return new Response(null, { status: 101, webSocket: client });
}
