/**
 * ActiveMQ OpenWire Protocol Probe + STOMP Messaging (Port 61616 / 61613 / TCP)
 *
 * Apache ActiveMQ's native binary protocol is OpenWire on port 61616.
 * ActiveMQ also supports STOMP (Simple Text Oriented Messaging Protocol)
 * on port 61613, which this implementation uses for message send/receive
 * because STOMP is interoperable and text-based.
 *
 * Supported endpoints:
 *   POST /api/activemq/probe       — OpenWire handshake, detect broker version
 *   POST /api/activemq/connect     — STOMP connect, verify credentials
 *   POST /api/activemq/send        — STOMP send message to queue or topic
 *   POST /api/activemq/subscribe   — STOMP subscribe and collect messages
 *   POST /api/activemq/admin       — Jolokia REST API: list queues/topics, stats
 *
 * ActiveMQ Default Ports:
 *   61616 — OpenWire (native binary)
 *   61613 — STOMP (text)
 *     5672 — AMQP 0-9-1
 *     1883 — MQTT
 *    61614 — WebSocket/STOMP
 *     8161 — Web Admin Console + Jolokia REST API
 *
 * Destination naming:
 *   /queue/myqueue    — Point-to-point queue
 *   /topic/mytopic    — Publish-subscribe topic
 *   queue://myqueue   — Alternative ActiveMQ format (normalised to /queue/...)
 *   topic://mytopic   — Alternative ActiveMQ format (normalised to /topic/...)
 *
 * References:
 *   https://activemq.apache.org/openwire
 *   https://activemq.apache.org/stomp
 *   https://activemq.apache.org/rest
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// ─── Constants ───────────────────────────────────────────────────────────────

const WIREFORMAT_INFO_TYPE = 0x01;
const BROKER_INFO_TYPE = 0x02;
const ACTIVEMQ_MAGIC = new TextEncoder().encode('ActiveMQ');
const NULL_BYTE = '\x00';

// ─── Shared validation ────────────────────────────────────────────────────────

function validateInput(host: string, port: number): string | null {
  if (!host || host.trim().length === 0) return 'Host is required';
  if (!/^[a-zA-Z0-9._:-]+$/.test(host)) return 'Host contains invalid characters';
  if (port < 1 || port > 65535) return 'Port must be between 1 and 65535';
  return null;
}

/**
 * Normalise ActiveMQ destination strings.
 * Accepts both STOMP (/queue/foo, /topic/foo) and URI (queue://foo, topic://foo) forms.
 * Returns the STOMP form (/queue/foo).
 */
function normaliseDestination(raw: string): string {
  if (/^queue:\/\//i.test(raw)) return '/queue/' + raw.replace(/^queue:\/\//i, '');
  if (/^topic:\/\//i.test(raw)) return '/topic/' + raw.replace(/^topic:\/\//i, '');
  return raw; // already in STOMP form or unknown
}

// ─── OpenWire helpers (used by probe) ─────────────────────────────────────────

/**
 * Build a valid OpenWire WireFormatInfo command.
 *
 * OpenWire frame layout (with default size-prefix enabled):
 *   [4-byte frame length (big-endian)]
 *   [1-byte data type]               — 0x01 for WireFormatInfo
 *   [8-byte magic]                   — literal "ActiveMQ" (no length prefix)
 *   [4-byte version (big-endian)]    — protocol version we support
 *   [4-byte marshalledProperties length, or 0xFFFFFFFF for null]
 *   [marshalledProperties bytes ...]
 *
 * Note: WireFormatInfo does NOT include commandId / responseRequired /
 * correlationId — those are part of the BaseCommand marshalling used by
 * other command types but WireFormatInfo has its own special marshalling.
 *
 * We send an empty options map (length 0) which tells the broker we
 * accept its defaults.  The broker will respond with its own
 * WireFormatInfo containing its negotiated settings.
 */
function buildWireFormatInfo(): Uint8Array {
  const body = new Uint8Array([
    WIREFORMAT_INFO_TYPE,             // data type = 0x01
    // Magic — 8 raw bytes, no length prefix
    0x41, 0x63, 0x74, 0x69,          // "Acti"
    0x76, 0x65, 0x4D, 0x51,          // "veMQ"
    // Version — int32 big-endian (request version 1, broker will negotiate)
    0x00, 0x00, 0x00, 0x01,
    // Marshalled properties length = 0 (empty map, accept defaults)
    0x00, 0x00, 0x00, 0x00,
  ]);
  const frame = new Uint8Array(4 + body.length);
  new DataView(frame.buffer).setUint32(0, body.length, false);
  frame.set(body, 4);
  return frame;
}

function findMagic(data: Uint8Array): number {
  outer: for (let i = 0; i <= data.length - ACTIVEMQ_MAGIC.length; i++) {
    for (let j = 0; j < ACTIVEMQ_MAGIC.length; j++) {
      if (data[i + j] !== ACTIVEMQ_MAGIC[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function parseVersion(data: Uint8Array, magicOffset: number): number | null {
  const off = magicOffset + ACTIVEMQ_MAGIC.length;
  if (off + 4 > data.length) return null;
  const v = new DataView(data.buffer, data.byteOffset + off).getInt32(0, false);
  return (v > 0 && v < 100) ? v : null;
}

/**
 * Parse the OpenWire marshalled properties map from a WireFormatInfo response.
 *
 * Layout after magic(8) + version(4):
 *   [4-byte map-bytes length, or -1 for null]
 *   [map bytes ...]
 *
 * Map bytes layout:
 *   [4-byte entry count]
 *   For each entry:
 *     [2-byte key length (unsigned)] [key UTF-8 bytes]
 *     [1-byte value type tag]
 *     [value bytes — type-dependent]
 *
 * Value type tags (from OpenWire MarshallingSupport):
 *   0x01 = boolean  (1 byte: 0x00/0x01)
 *   0x05 = int      (4 bytes big-endian)
 *   0x06 = long     (8 bytes big-endian)
 *   0x09 = string   (2-byte length + UTF-8)
 *
 * Returns a simple string→(boolean|number|string) map.  Unknown types
 * cause the parser to bail and return what it has so far.
 */
function parseWireFormatOptions(
  data: Uint8Array,
  magicOffset: number,
): Record<string, boolean | number | string> {
  const result: Record<string, boolean | number | string> = {};
  const dv = new DataView(data.buffer, data.byteOffset);
  const dec = new TextDecoder();

  // Map bytes start after magic(8) + version(4)
  let pos = magicOffset + ACTIVEMQ_MAGIC.length + 4;
  if (pos + 4 > data.length) return result;

  const mapLen = dv.getInt32(pos, false);
  pos += 4;
  if (mapLen <= 0) return result;   // null (-1) or empty (0)
  if (pos + mapLen > data.length) return result;

  const mapEnd = pos + mapLen;
  if (pos + 4 > mapEnd) return result;

  const entryCount = dv.getInt32(pos, false);
  pos += 4;

  for (let i = 0; i < entryCount && pos < mapEnd; i++) {
    // Key: 2-byte length + UTF-8
    if (pos + 2 > mapEnd) break;
    const keyLen = dv.getUint16(pos, false);
    pos += 2;
    if (pos + keyLen > mapEnd) break;
    const key = dec.decode(data.slice(pos, pos + keyLen));
    pos += keyLen;

    // Value type tag
    if (pos >= mapEnd) break;
    const tag = data[pos++];

    switch (tag) {
      case 0x01: // boolean
        if (pos >= mapEnd) break;
        result[key] = data[pos++] !== 0;
        break;
      case 0x05: // int
        if (pos + 4 > mapEnd) break;
        result[key] = dv.getInt32(pos, false);
        pos += 4;
        break;
      case 0x06: // long
        if (pos + 8 > mapEnd) break;
        // Read as two 32-bit ints (avoid BigInt for simplicity)
        result[key] = dv.getInt32(pos, false) * 0x100000000 + dv.getUint32(pos + 4, false);
        pos += 8;
        break;
      case 0x09: { // string
        if (pos + 2 > mapEnd) break;
        const sLen = dv.getUint16(pos, false);
        pos += 2;
        if (pos + sLen > mapEnd) break;
        result[key] = dec.decode(data.slice(pos, pos + sLen));
        pos += sLen;
        break;
      }
      default:
        // Unknown type — bail out, return what we have
        return result;
    }
  }

  return result;
}

function parseBrokerName(data: Uint8Array, commandTypeOffset: number): string | undefined {
  if (data.length <= commandTypeOffset) return undefined;
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const body = decoder.decode(data.slice(commandTypeOffset));
  const match = body.match(/[a-zA-Z0-9][\w\-./]{3,63}/);
  return match?.[0];
}

async function readBytes(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  waitMs: number,
  maxBytes = 512,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline && total < maxBytes) {
    try {
      const remaining = deadline - Date.now();
      const t = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), Math.min(remaining, 500)),
      );
      const { value, done } = await Promise.race([reader.read(), t]);
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
    } catch {
      break;
    }
  }
  const combined = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { combined.set(c, off); off += c.length; }
  return combined;
}

// ─── STOMP helpers (used by connect / send / subscribe) ───────────────────────

/**
 * Escape a STOMP 1.1+ header value.
 * Per the STOMP spec, header values must escape: \\ → \\\\, \n → \\n, \r → \\r, : → \\c
 * The CONNECT frame is exempt from escaping in STOMP 1.0, but since we negotiate
 * 1.0-1.2 and the broker may reply with 1.2, we escape conservatively on all frames.
 */
function escapeStompHeaderValue(val: string): string {
  return val
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/:/g, '\\c');
}

function buildStompFrame(
  command: string,
  headers: Record<string, string>,
  body = '',
): string {
  let frame = command + '\n';
  // CONNECT and CONNECTED frames are exempt from escaping in STOMP 1.0,
  // and most brokers tolerate unescaped values in CONNECT frames even in 1.2.
  // We only escape non-CONNECT frames to be safe.
  const shouldEscape = command !== 'CONNECT';
  for (const [k, v] of Object.entries(headers)) {
    frame += shouldEscape ? `${k}:${escapeStompHeaderValue(v)}\n` : `${k}:${v}\n`;
  }
  frame += '\n' + body + NULL_BYTE;
  return frame;
}

interface StompFrame {
  command: string;
  headers: Record<string, string>;
  body: string;
}

function parseStompFrame(raw: string): StompFrame {
  // Strip trailing NULL byte, leading heartbeat newlines, and normalise \r\n to \n
  const cleaned = raw.replace(/\x00$/, '').replace(/\r\n/g, '\n').replace(/^\n+/, '');
  const lines = cleaned.split('\n');
  const command = lines[0] ?? '';
  const headers: Record<string, string> = {};
  let bodyStart = 1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '') { bodyStart = i + 1; break; }
    const colon = lines[i].indexOf(':');
    if (colon > 0) headers[lines[i].substring(0, colon)] = lines[i].substring(colon + 1);
  }
  return { command, headers, body: lines.slice(bodyStart).join('\n') };
}

/**
 * Open a STOMP session, call `work(writer, reader, connFrame)`, then cleanly DISCONNECT.
 * Returns whatever `work` returns. Closes the socket on both success and error.
 */
async function withStompSession<T>(
  host: string,
  port: number,
  username: string | undefined,
  password: string | undefined,
  vhost: string | undefined,
  timeoutMs: number,
  work: (
    writer: WritableStreamDefaultWriter<Uint8Array>,
    reader: ReadableStreamDefaultReader<Uint8Array>,
    connFrame: StompFrame,
    readNextFrame: () => Promise<StompFrame>,
  ) => Promise<T>,
  /** Optional client-id header for durable subscriptions (ActiveMQ extension). */
  clientId?: string,
): Promise<T> {
  const socket = connect(`${host}:${port}`);
  const deadline = Date.now() + timeoutMs;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Connection timeout')), timeoutMs),
  );

  try {
    await Promise.race([socket.opened, timeoutPromise]);
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    const enc = new TextEncoder();
    const dec = new TextDecoder();

    /** Accumulate bytes until a NULL byte is found, return the frame string. */
    async function readUntilNull(): Promise<string> {
      let buf = '';
      while (!buf.includes(NULL_BYTE)) {
        if (Date.now() > deadline) throw new Error('Connection timeout');
        const remaining = deadline - Date.now();
        const t = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), remaining),
        );
        const { value, done } = await Promise.race([reader.read(), t]);
        if (done) break;
        if (value) buf += dec.decode(value, { stream: true });
      }
      return buf;
    }

    // ── CONNECT ──
    const connectHeaders: Record<string, string> = {
      'accept-version': '1.0,1.1,1.2',
      'host': vhost ?? host,
      'heart-beat': '0,0',
    };
    if (username) connectHeaders['login'] = username;
    if (password) connectHeaders['passcode'] = password;
    if (clientId) connectHeaders['client-id'] = clientId;

    await writer.write(enc.encode(buildStompFrame('CONNECT', connectHeaders)));

    const connRaw = await readUntilNull();
    const connFrame = parseStompFrame(connRaw.split(NULL_BYTE)[0]);

    if (connFrame.command !== 'CONNECTED') {
      writer.releaseLock();
      reader.releaseLock();
      socket.close();
      const msg = connFrame.command === 'ERROR'
        ? (connFrame.body.trim() || connFrame.headers['message'] || 'Connection rejected')
        : `Unexpected response: ${connFrame.command}`;
      throw new Error(msg);
    }

    let remainingBuf = connRaw.split(NULL_BYTE).slice(1).join(NULL_BYTE);

    /** Read the next full STOMP frame, pulling more bytes if needed. */
    async function readNextFrame(): Promise<StompFrame> {
      while (!remainingBuf.includes(NULL_BYTE)) {
        if (Date.now() > deadline) throw new Error('Connection timeout');
        const remaining = deadline - Date.now();
        const t = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), remaining),
        );
        const { value, done } = await Promise.race([reader.read(), t]);
        if (done) break;
        if (value) remainingBuf += dec.decode(value, { stream: true });
      }
      const nullIdx = remainingBuf.indexOf(NULL_BYTE);
      const rawFrame = nullIdx >= 0 ? remainingBuf.substring(0, nullIdx) : remainingBuf;
      remainingBuf = nullIdx >= 0 ? remainingBuf.substring(nullIdx + 1) : '';
      return parseStompFrame(rawFrame);
    }

    // ── User work ──
    const result = await work(writer, reader, connFrame, readNextFrame);

    // ── DISCONNECT ──
    try {
      await writer.write(enc.encode(buildStompFrame('DISCONNECT', { receipt: 'disc-1' })));
    } catch { /* ignore */ }
    writer.releaseLock();
    reader.releaseLock();
    socket.close();
    return result;
  } catch (err) {
    try { socket.close(); } catch { /* ignore */ }
    throw err;
  }
}

// ─── Endpoint types ───────────────────────────────────────────────────────────

interface ActiveMQRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface ActiveMQConnectRequest extends ActiveMQRequest {
  username?: string;
  password?: string;
  vhost?: string;
}

interface ActiveMQSendRequest extends ActiveMQConnectRequest {
  destination: string;        // /queue/foo or /topic/bar or queue://foo
  body: string;
  contentType?: string;
  persistent?: boolean;
  priority?: number;          // 0-9, default 4
  ttl?: number;               // ms, 0 = unlimited
  headers?: Record<string, string>;
}

interface ActiveMQSubscribeRequest extends ActiveMQConnectRequest {
  destination: string;
  ackMode?: 'auto' | 'client' | 'client-individual';
  maxMessages?: number;       // max to collect before disconnecting
  selector?: string;          // JMS selector expression
}

// ─── POST /api/activemq/probe ─────────────────────────────────────────────────

/**
 * OpenWire handshake probe — detect broker, version, capabilities.
 */
export async function handleActiveMQProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as ActiveMQRequest;
    const { host, port = 61616, timeout = 10000 } = body;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
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

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    const socket = connect(`${host}:${port}`);

    try {
      const startTime = Date.now();
      await Promise.race([socket.opened, timeoutPromise]);
      const tcpLatency = Date.now() - startTime;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      await writer.write(buildWireFormatInfo());
      const data = await readBytes(reader, 5000, 512);

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const magicOffset = findMagic(data);
      const isActiveMQ = magicOffset >= 0;
      let openWireVersion: number | undefined;
      let stackTraceEnabled: boolean | undefined;
      let cacheEnabled: boolean | undefined;
      let tightEncodingEnabled: boolean | undefined;
      let brokerName: string | undefined;
      let hasBrokerInfo = false;

      if (isActiveMQ) {
        openWireVersion = parseVersion(data, magicOffset) ?? undefined;

        // Parse the marshalled options map from the WireFormatInfo response.
        // Options are key/value pairs like StackTraceEnabled, CacheEnabled, etc.
        const opts = parseWireFormatOptions(data, magicOffset);
        if ('StackTraceEnabled' in opts) stackTraceEnabled = opts['StackTraceEnabled'] as boolean;
        if ('CacheEnabled' in opts) cacheEnabled = opts['CacheEnabled'] as boolean;
        if ('TightEncodingEnabled' in opts) tightEncodingEnabled = opts['TightEncodingEnabled'] as boolean;

        // Check for a BrokerInfo command following the WireFormatInfo frame
        if (data.length >= 4) {
          const firstFrameLen = new DataView(data.buffer, data.byteOffset).getUint32(0, false);
          const secondFrameStart = 4 + firstFrameLen;
          if (secondFrameStart + 5 < data.length) {
            const secondType = data[secondFrameStart + 4];
            if (secondType === BROKER_INFO_TYPE) {
              hasBrokerInfo = true;
              brokerName = parseBrokerName(data, secondFrameStart + 4 + 1);
            }
          }
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          tcpLatency,
          isActiveMQ,
          openWireVersion,
          stackTraceEnabled,
          cacheEnabled,
          tightEncodingEnabled,
          hasBrokerInfo,
          brokerName,
          receivedBytes: data.length,
          note: isActiveMQ
            ? `Apache ActiveMQ broker detected. OpenWire v${openWireVersion ?? '?'}.`
            : `Port ${port} is open but the ActiveMQ OpenWire magic was not detected ` +
              `(${data.length} bytes received). ` +
              `Try STOMP on :61613, AMQP on :5672, MQTT on :1883.`,
          references: [
            'https://activemq.apache.org/openwire',
            'https://activemq.apache.org/configuring-transports',
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

// ─── POST /api/activemq/connect ───────────────────────────────────────────────

/**
 * STOMP connect to ActiveMQ — verify credentials and return broker metadata.
 *
 * Uses port 61613 (STOMP) by default.
 */
export async function handleActiveMQConnect(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as ActiveMQConnectRequest;
    const { host, port = 61613, username, password, vhost, timeout = 10000 } = body;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
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

    const startTime = Date.now();
    const connFrame = await withStompSession(
      host, port, username, password, vhost, timeout,
      async (_writer, _reader, frame) => frame,
    );
    const latency = Date.now() - startTime;

    return new Response(
      JSON.stringify({
        success: true,
        host,
        port,
        latency,
        stompVersion: connFrame.headers['version'] ?? '1.0',
        server: connFrame.headers['server'] ?? 'Unknown',
        heartBeat: connFrame.headers['heart-beat'] ?? '0,0',
        session: connFrame.headers['session'] ?? '',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

// ─── POST /api/activemq/send ──────────────────────────────────────────────────

/**
 * Send one message to an ActiveMQ queue or topic via STOMP.
 *
 * Destination formats:
 *   /queue/myqueue      STOMP form
 *   queue://myqueue     ActiveMQ URI form (auto-normalised)
 *   /topic/mytopic
 *   topic://mytopic
 */
export async function handleActiveMQSend(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const req = (await request.json()) as ActiveMQSendRequest;
    const {
      host,
      port = 61613,
      username,
      password,
      vhost,
      destination: rawDest,
      body: messageBody,
      contentType = 'text/plain',
      persistent = true,
      priority = 4,
      ttl = 0,
      headers: extraHeaders = {},
      timeout = 10000,
    } = req;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!rawDest) {
      return new Response(
        JSON.stringify({ success: false, error: 'Destination is required (e.g. /queue/test or /topic/alerts)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const destination = normaliseDestination(rawDest);

    if (!/^\/(queue|topic|temp-queue|temp-topic)\/.+/.test(destination)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid destination — use /queue/name, /topic/name, queue://name, or topic://name',
        }),
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

    const enc = new TextEncoder();
    const startTime = Date.now();

    const result = await withStompSession(
      host, port, username, password, vhost, timeout,
      async (writer, _reader, connFrame, readNextFrame) => {
        const sendHeaders: Record<string, string> = {
          destination,
          'content-type': contentType,
          'content-length': String(enc.encode(messageBody ?? '').length),
          'persistent': persistent ? 'true' : 'false',
          'priority': String(Math.min(9, Math.max(0, priority))),
          receipt: 'send-1',
          ...extraHeaders,
        };
        if (ttl > 0) sendHeaders['expires'] = String(Date.now() + ttl);

        await writer.write(enc.encode(buildStompFrame('SEND', sendHeaders, messageBody ?? '')));

        // Wait for RECEIPT (or ERROR)
        let receiptReceived = false;
        try {
          const f = await Promise.race([
            readNextFrame(),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error('receipt timeout')), 5000)),
          ]);
          if (f.command === 'RECEIPT') receiptReceived = true;
          if (f.command === 'ERROR') {
            throw new Error(f.body.trim() || f.headers['message'] || 'Broker returned ERROR');
          }
        } catch (e) {
          if (e instanceof Error && e.message !== 'receipt timeout') throw e;
        }

        return {
          destination,
          bodyLength: enc.encode(messageBody ?? '').length,
          receiptReceived,
          persistent,
          priority,
          stompVersion: connFrame.headers['version'] ?? '1.0',
          server: connFrame.headers['server'] ?? 'Unknown',
        };
      },
    );

    const elapsed = Date.now() - startTime;

    return new Response(
      JSON.stringify({ success: true, elapsed, ...result }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

// ─── POST /api/activemq/subscribe ─────────────────────────────────────────────

/**
 * Subscribe to an ActiveMQ queue or topic via STOMP and collect incoming messages.
 *
 * Collects up to `maxMessages` (default 10) messages or until `timeout` ms elapses.
 */
export async function handleActiveMQSubscribe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const req = (await request.json()) as ActiveMQSubscribeRequest;
    const {
      host,
      port = 61613,
      username,
      password,
      vhost,
      destination: rawDest,
      ackMode = 'auto',
      maxMessages = 10,
      selector,
      timeout = 10000,
    } = req;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!rawDest) {
      return new Response(
        JSON.stringify({ success: false, error: 'Destination is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const destination = normaliseDestination(rawDest);

    if (!/^\/(queue|topic|temp-queue|temp-topic)\/.+/.test(destination)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid destination — use /queue/name, /topic/name, queue://name, or topic://name',
        }),
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

    const enc = new TextEncoder();
    const startTime = Date.now();

    const result = await withStompSession(
      host, port, username, password, vhost, timeout,
      async (writer, _reader, connFrame, readNextFrame) => {
        const subId = 'sub-0';
        const subHeaders: Record<string, string> = {
          id: subId,
          destination,
          ack: ackMode,
        };
        if (selector) subHeaders['selector'] = selector;

        await writer.write(enc.encode(buildStompFrame('SUBSCRIBE', subHeaders)));

        const messages: Array<{
          messageId: string;
          destination: string;
          contentType: string;
          body: string;
          headers: Record<string, string>;
        }> = [];

        const safeMax = Math.min(Math.max(1, maxMessages), 100);
        const collectUntil = Date.now() + Math.max(timeout - 1000, 2000);

        while (messages.length < safeMax) {
          if (Date.now() > collectUntil) break;
          const remaining = collectUntil - Date.now();
          let frame: StompFrame;
          try {
            frame = await Promise.race([
              readNextFrame(),
              new Promise<never>((_, rej) => setTimeout(() => rej(new Error('collect timeout')), remaining)),
            ]);
          } catch {
            break;
          }

          if (frame.command === 'MESSAGE') {
            if (ackMode === 'client' || ackMode === 'client-individual') {
              const ackId = frame.headers['ack'] ?? frame.headers['message-id'];
              if (ackId) {
                await writer.write(enc.encode(buildStompFrame('ACK', { id: ackId })));
              }
            }
            messages.push({
              messageId: frame.headers['message-id'] ?? '',
              destination: frame.headers['destination'] ?? destination,
              contentType: frame.headers['content-type'] ?? 'text/plain',
              body: frame.body,
              headers: frame.headers,
            });
          } else if (frame.command === 'ERROR') {
            throw new Error(frame.body.trim() || frame.headers['message'] || 'Broker returned ERROR');
          }
        }

        // UNSUBSCRIBE
        await writer.write(enc.encode(buildStompFrame('UNSUBSCRIBE', { id: subId })));

        return {
          destination,
          messageCount: messages.length,
          messages,
          stompVersion: connFrame.headers['version'] ?? '1.0',
          server: connFrame.headers['server'] ?? 'Unknown',
        };
      },
    );

    const elapsed = Date.now() - startTime;

    return new Response(
      JSON.stringify({ success: true, elapsed, ...result }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

// ─── POST /api/activemq/admin ─────────────────────────────────────────────────

/**
 * Query the ActiveMQ Jolokia REST API for broker stats, queues, and topics.
 *
 * Uses http://host:8161/api/jolokia by default.
 * Requires admin credentials (default: admin/admin).
 */
export async function handleActiveMQAdmin(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const req = (await request.json()) as {
      host: string;
      port?: number;
      username?: string;
      password?: string;
      brokerName?: string;
      action?: 'brokerInfo' | 'listQueues' | 'listTopics' | 'queueStats';
      queueName?: string;
      timeout?: number;
    };

    const {
      host,
      port = 8161,
      username = 'admin',
      password = 'admin',
      brokerName = 'localhost',
      action = 'brokerInfo',
      queueName,
      timeout = 10000,
    } = req;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const base64Creds = btoa(`${username}:${password}`);
    const headers: Record<string, string> = {
      'Authorization': `Basic ${base64Creds}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    const jolokiaBase = `http://${host}:${port}/api/jolokia`;

    let jolokiaUrl: string;

    switch (action) {
      case 'listQueues':
        jolokiaUrl = `${jolokiaBase}/read/org.apache.activemq:type=Broker,brokerName=${encodeURIComponent(brokerName)},destinationType=Queue,destinationName=*`;
        break;

      case 'listTopics':
        jolokiaUrl = `${jolokiaBase}/read/org.apache.activemq:type=Broker,brokerName=${encodeURIComponent(brokerName)},destinationType=Topic,destinationName=*`;
        break;

      case 'queueStats':
        if (!queueName) {
          return new Response(
            JSON.stringify({ success: false, error: 'queueName is required for queueStats action' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          );
        }
        jolokiaUrl = `${jolokiaBase}/read/org.apache.activemq:type=Broker,brokerName=${encodeURIComponent(brokerName)},destinationType=Queue,destinationName=${encodeURIComponent(queueName)}`;
        break;

      case 'brokerInfo':
      default:
        jolokiaUrl = `${jolokiaBase}/read/org.apache.activemq:type=Broker,brokerName=${encodeURIComponent(brokerName)}`;
        break;
    }

    const fetchPromise = fetch(jolokiaUrl, {
      method: 'GET',
      headers,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Admin API request timeout')), timeout),
    );

    const response = await Promise.race([fetchPromise, timeoutPromise]);

    if (!response.ok) {
      // Try to get error details
      const errText = await response.text().catch(() => '');
      return new Response(
        JSON.stringify({
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          detail: errText.substring(0, 500),
          hint: response.status === 401
            ? 'Authentication failed — check username/password (default: admin/admin)'
            : response.status === 404
              ? 'Jolokia API not found — ensure ActiveMQ admin console is running on this port'
              : undefined,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const data = await response.json() as {
      status?: number;
      value?: unknown;
      error?: string;
      error_type?: string;
    };

    if (data.status !== 200) {
      return new Response(
        JSON.stringify({
          success: false,
          error: data.error ?? 'Jolokia returned non-200 status',
          errorType: data.error_type,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ── Format the response based on action ──
    let formatted: unknown;

    if (action === 'brokerInfo' && data.value && typeof data.value === 'object') {
      const v = data.value as Record<string, unknown>;
      formatted = {
        brokerName: v['BrokerName'],
        brokerId: v['BrokerId'],
        brokerVersion: v['BrokerVersion'],
        uptime: v['Uptime'],
        memoryPercentUsage: v['MemoryPercentUsage'],
        storePercentUsage: v['StorePercentUsage'],
        tempPercentUsage: v['TempPercentUsage'],
        totalEnqueueCount: v['TotalEnqueueCount'],
        totalDequeueCount: v['TotalDequeueCount'],
        totalConsumerCount: v['TotalConsumerCount'],
        totalProducerCount: v['TotalProducerCount'],
        totalMessageCount: v['TotalMessageCount'],
        dataDirectory: v['DataDirectory'],
        transportConnectors: v['TransportConnectors'],
      };
    } else if ((action === 'listQueues' || action === 'listTopics') && data.value && typeof data.value === 'object') {
      const entries = Object.entries(data.value as Record<string, Record<string, unknown>>);
      formatted = entries.map(([name, attrs]) => ({
        name,
        queueSize: attrs['QueueSize'],
        consumerCount: attrs['ConsumerCount'],
        producerCount: attrs['ProducerCount'],
        enqueueCount: attrs['EnqueueCount'],
        dequeueCount: attrs['DequeueCount'],
        expiredCount: attrs['ExpiredCount'],
        memoryUsage: attrs['MemoryUsageByteCount'],
      }));
    } else if (action === 'queueStats' && data.value && typeof data.value === 'object') {
      const v = data.value as Record<string, unknown>;
      formatted = {
        name: v['Name'],
        queueSize: v['QueueSize'],
        consumerCount: v['ConsumerCount'],
        producerCount: v['ProducerCount'],
        enqueueCount: v['EnqueueCount'],
        dequeueCount: v['DequeueCount'],
        expiredCount: v['ExpiredCount'],
        memoryUsage: v['MemoryUsageByteCount'],
        memoryPercentUsage: v['MemoryPercentUsage'],
        averageMessageSize: v['AverageMessageSize'],
        maxPageSize: v['MaxPageSize'],
        blockedSends: v['BlockedSends'],
      };
    } else {
      formatted = data.value;
    }

    return new Response(
      JSON.stringify({ success: true, action, data: formatted }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

// ─── POST /api/activemq/info ──────────────────────────────────────────────────

/**
 * Query the ActiveMQ web console Jolokia API for broker-level statistics.
 *
 * The Jolokia REST endpoint (default port 8161) exposes the ActiveMQ JMX
 * MBeans over HTTP/JSON without requiring a JMX client.
 *
 * Uses a wildcard broker name (%2A) so it works regardless of the configured
 * broker name.  If the wildcard query returns a map, the first value is used.
 *
 * Request body: { host, port=8161, username='admin', password='admin', timeout=10000 }
 * Return: { success, brokerId, brokerName, brokerVersion, uptime,
 *           memoryUsage, storeUsage, tempUsage, queues, topics, latencyMs }
 */
export async function handleActiveMQInfo(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const req = (await request.json()) as {
      host: string;
      port?: number;
      username?: string;
      password?: string;
      timeout?: number;
    };

    const {
      host,
      port = 8161,
      username = 'admin',
      password = 'admin',
      timeout = 10000,
    } = req;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const startTime = Date.now();
    const creds = btoa(`${username}:${password}`);
    const authHeaders = {
      'Authorization': `Basic ${creds}`,
      'Accept': 'application/json',
    };

    // Try wildcard broker name — works for any broker name configuration
    const jolokiaUrl =
      `http://${host}:${port}/api/jolokia/read/org.apache.activemq:type=Broker,brokerName=%2A`;

    const fetchPromise = fetch(jolokiaUrl, { method: 'GET', headers: authHeaders });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), timeout),
    );

    const response = await Promise.race([fetchPromise, timeoutPromise]);
    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return new Response(JSON.stringify({
        success: false,
        latencyMs,
        error: `HTTP ${response.status}: ${response.statusText}`,
        detail: errText.substring(0, 400),
        hint: response.status === 401
          ? 'Authentication failed — default credentials are admin/admin'
          : response.status === 404
            ? 'Jolokia not found — ensure ActiveMQ admin console is enabled on this port'
            : undefined,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const data = await response.json() as {
      status?: number;
      value?: unknown;
      error?: string;
      error_type?: string;
    };

    if (data.status !== 200) {
      return new Response(JSON.stringify({
        success: false,
        latencyMs,
        error: data.error ?? 'Jolokia returned non-200 status',
        errorType: data.error_type,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // The wildcard query returns { "brokerName": { ...attrs } }
    // Extract the first (and usually only) broker entry
    let brokerAttrs: Record<string, unknown> = {};
    if (data.value && typeof data.value === 'object') {
      const val = data.value as Record<string, unknown>;
      const firstKey = Object.keys(val)[0];
      if (firstKey) {
        const entry = val[firstKey];
        brokerAttrs = (entry && typeof entry === 'object')
          ? (entry as Record<string, unknown>)
          : {};
      } else {
        brokerAttrs = val;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      latencyMs,
      brokerId:           brokerAttrs['BrokerId'],
      brokerName:         brokerAttrs['BrokerName'],
      brokerVersion:      brokerAttrs['BrokerVersion'],
      uptime:             brokerAttrs['Uptime'],
      memoryUsage:        brokerAttrs['MemoryPercentUsage'],
      storeUsage:         brokerAttrs['StorePercentUsage'],
      tempUsage:          brokerAttrs['TempPercentUsage'],
      totalEnqueueCount:  brokerAttrs['TotalEnqueueCount'],
      totalDequeueCount:  brokerAttrs['TotalDequeueCount'],
      totalConsumerCount: brokerAttrs['TotalConsumerCount'],
      totalProducerCount: brokerAttrs['TotalProducerCount'],
      totalMessages:      brokerAttrs['TotalMessageCount'],
      dataDirectory:      brokerAttrs['DataDirectory'],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ─── POST /api/activemq/durable-subscribe ────────────────────────────────────

/**
 * Create a durable topic subscription via STOMP.
 *
 * A durable subscription persists messages for the named subscriber even while
 * the client is offline, unlike an ephemeral subscription.  Requires a topic
 * destination (not a queue) and a `clientId` + `subscriptionName`.
 *
 * STOMP headers used:
 *   - CONNECT:   `client-id`              (uniquely identifies this durable client)
 *   - SUBSCRIBE: `activemq.subscriptionName` (subscription name, persists on broker)
 *                `ack: client-individual`  (reliable delivery; each message ACKed)
 *                `durable: true`
 *
 * To unsubscribe/delete a durable subscription later use /api/activemq/durable-unsubscribe.
 *
 * Request body:
 *   { host, port=61613, username?, password?, vhost?,
 *     destination='/topic/alerts', clientId, subscriptionName,
 *     maxMessages=10, timeout=15000 }
 */
export async function handleActiveMQDurableSubscribe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const req = await request.json() as {
      host: string;
      port?: number;
      username?: string;
      password?: string;
      vhost?: string;
      destination: string;
      clientId: string;
      subscriptionName: string;
      maxMessages?: number;
      selector?: string;
      timeout?: number;
    };

    const {
      host,
      port = 61613,
      username,
      password,
      vhost,
      destination: rawDest,
      clientId,
      subscriptionName,
      maxMessages = 10,
      selector,
      timeout = 15000,
    } = req;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(JSON.stringify({ success: false, error: validationError }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!clientId) {
      return new Response(JSON.stringify({ success: false, error: 'clientId is required for durable subscriptions' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!subscriptionName) {
      return new Response(JSON.stringify({ success: false, error: 'subscriptionName is required for durable subscriptions' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!rawDest) {
      return new Response(JSON.stringify({ success: false, error: 'destination is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const destination = normaliseDestination(rawDest);
    if (!/^\/topic\/.+/.test(destination)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Durable subscriptions require a topic destination (/topic/name or topic://name)',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const enc = new TextEncoder();
    const startTime = Date.now();

    // Open the STOMP session manually so we can inject client-id into CONNECT
    const socket = connect(`${host}:${port}`);
    const deadline = Date.now() + timeout;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Connection timeout')), timeout);
      socket.opened.then(() => { clearTimeout(timer); resolve(); }).catch(reject);
    });

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    const dec = new TextDecoder();

    let remainingBuf = '';

    async function readUntilNull(): Promise<string> {
      while (!remainingBuf.includes(NULL_BYTE)) {
        if (Date.now() > deadline) throw new Error('Connection timeout');
        const rem = deadline - Date.now();
        const t = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), rem),
        );
        const { value, done } = await Promise.race([reader.read(), t]);
        if (done) break;
        if (value) remainingBuf += dec.decode(value, { stream: true });
      }
      const raw = remainingBuf.split(NULL_BYTE)[0];
      remainingBuf = remainingBuf.split(NULL_BYTE).slice(1).join(NULL_BYTE);
      return raw;
    }

    async function readNextFrame(): Promise<StompFrame> {
      while (!remainingBuf.includes(NULL_BYTE)) {
        if (Date.now() > deadline) throw new Error('Connection timeout');
        const rem = deadline - Date.now();
        const t = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), rem),
        );
        const { value, done } = await Promise.race([reader.read(), t]);
        if (done) break;
        if (value) remainingBuf += dec.decode(value, { stream: true });
      }
      const nullIdx = remainingBuf.indexOf(NULL_BYTE);
      const rawFrame = nullIdx >= 0 ? remainingBuf.substring(0, nullIdx) : remainingBuf;
      remainingBuf = nullIdx >= 0 ? remainingBuf.substring(nullIdx + 1) : '';
      return parseStompFrame(rawFrame);
    }

    try {
      // CONNECT with client-id for durable subscriptions
      const connectHeaders: Record<string, string> = {
        'accept-version': '1.0,1.1,1.2',
        'host': vhost ?? host,
        'heart-beat': '0,0',
        'client-id': clientId,
      };
      if (username) connectHeaders['login'] = username;
      if (password) connectHeaders['passcode'] = password;

      await writer.write(enc.encode(buildStompFrame('CONNECT', connectHeaders)));
      const connRaw = await readUntilNull();
      const connFrame = parseStompFrame(connRaw);

      if (connFrame.command !== 'CONNECTED') {
        throw new Error(
          connFrame.command === 'ERROR'
            ? (connFrame.body.trim() || connFrame.headers['message'] || 'Connection rejected')
            : `Unexpected: ${connFrame.command}`,
        );
      }

      // SUBSCRIBE with durable subscription headers
      const subHeaders: Record<string, string> = {
        id: 'durable-sub-0',
        destination,
        ack: 'client-individual',
        durable: 'true',
        'activemq.subscriptionName': subscriptionName,
      };
      if (selector) subHeaders['selector'] = selector;

      await writer.write(enc.encode(buildStompFrame('SUBSCRIBE', subHeaders)));

      // Collect messages
      const messages: Array<{
        messageId: string;
        body: string;
        contentType: string;
        headers: Record<string, string>;
        ackedAt?: number;
      }> = [];

      const safeMax = Math.min(Math.max(1, maxMessages), 100);
      const collectUntil = Date.now() + Math.max(timeout - 1500, 2000);

      while (messages.length < safeMax) {
        if (Date.now() > collectUntil) break;
        const remaining = collectUntil - Date.now();
        let frame: StompFrame;
        try {
          frame = await Promise.race([
            readNextFrame(),
            new Promise<never>((_, rej) =>
              setTimeout(() => rej(new Error('collect timeout')), remaining),
            ),
          ]);
        } catch {
          break;
        }

        if (frame.command === 'MESSAGE') {
          // ACK each message individually (client-individual mode)
          const ackId = frame.headers['ack'] ?? frame.headers['message-id'];
          if (ackId) {
            await writer.write(enc.encode(buildStompFrame('ACK', { id: ackId })));
          }
          messages.push({
            messageId: frame.headers['message-id'] ?? '',
            body: frame.body,
            contentType: frame.headers['content-type'] ?? 'text/plain',
            headers: frame.headers,
            ackedAt: Date.now(),
          });
        } else if (frame.command === 'ERROR') {
          throw new Error(frame.body.trim() || frame.headers['message'] || 'Broker returned ERROR');
        }
      }

      // DISCONNECT cleanly (subscription persists on broker)
      try {
        await writer.write(enc.encode(buildStompFrame('DISCONNECT', { receipt: 'disc-durable' })));
      } catch { /* ignore */ }

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const elapsed = Date.now() - startTime;

      return new Response(JSON.stringify({
        success: true,
        elapsed,
        host, port, destination,
        clientId,
        subscriptionName,
        stompVersion: connFrame.headers['version'] ?? '1.0',
        server: connFrame.headers['server'] ?? 'Unknown',
        messageCount: messages.length,
        messages,
        note: `Durable subscription '${subscriptionName}' for client '${clientId}' active on broker. Messages will queue while client is offline. Use /api/activemq/durable-unsubscribe to delete the subscription.`,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
      try { writer.releaseLock(); } catch { /* ignore */ }
      try { reader.releaseLock(); } catch { /* ignore */ }
      socket.close();
      throw err;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ─── POST /api/activemq/durable-unsubscribe ───────────────────────────────────

/**
 * Delete a durable topic subscription from the ActiveMQ broker.
 *
 * Connects with the same clientId and subscriptionName, then sends UNSUBSCRIBE
 * with durable: true, which removes the subscription and any queued messages.
 *
 * Request body:
 *   { host, port=61613, username?, password?, vhost?,
 *     clientId, subscriptionName, timeout=10000 }
 */
export async function handleActiveMQDurableUnsubscribe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const req = await request.json() as {
      host: string;
      port?: number;
      username?: string;
      password?: string;
      vhost?: string;
      clientId: string;
      subscriptionName: string;
      timeout?: number;
    };

    const {
      host,
      port = 61613,
      username,
      password,
      vhost,
      clientId,
      subscriptionName,
      timeout = 10000,
    } = req;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(JSON.stringify({ success: false, error: validationError }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!clientId || !subscriptionName) {
      return new Response(JSON.stringify({ success: false, error: 'clientId and subscriptionName are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const startTime = Date.now();
    const enc = new TextEncoder();

    // Must pass clientId to withStompSession so the CONNECT frame includes
    // the client-id header — ActiveMQ requires this to identify the durable
    // subscription owner when removing it.
    const result = await withStompSession(
      host, port, username, password, vhost, timeout,
      async (writer, _reader, connFrame) => {
        // Send UNSUBSCRIBE with durable headers to delete the subscription
        await writer.write(enc.encode(buildStompFrame('UNSUBSCRIBE', {
          id: 'durable-sub-0',
          'activemq.subscriptionName': subscriptionName,
          durable: 'true',
          receipt: 'unsub-durable',
        })));

        return {
          stompVersion: connFrame.headers['version'] ?? '1.0',
          server: connFrame.headers['server'] ?? 'Unknown',
        };
      },
      clientId,
    );

    return new Response(JSON.stringify({
      success: true,
      elapsed: Date.now() - startTime,
      host, port, clientId, subscriptionName,
      ...result,
      message: `Durable subscription '${subscriptionName}' for client '${clientId}' has been removed from the broker.`,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ─── POST /api/activemq/queues ────────────────────────────────────────────────

/**
 * Connect via STOMP (default port 61613), subscribe to a queue, send a test
 * message, and attempt to receive it.  Reports STOMP session metadata.
 *
 * Flow:
 *   CONNECT  → confirm CONNECTED frame (session-id, server version, heart-beat)
 *   SUBSCRIBE id:sub-1, destination, ack:auto
 *   SEND destination with the given message body
 *   Wait briefly for a MESSAGE frame
 *   DISCONNECT
 *
 * Request body:
 *   { host, port=61613, username='admin', password='admin',
 *     destination='/queue/TEST', message='hello', timeout=10000 }
 *
 * Return:
 *   { success, sessionId, serverVersion, heartBeat,
 *     subscribeAck, messageReceived, latencyMs }
 */
export async function handleActiveMQQueues(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const req = (await request.json()) as {
      host: string;
      port?: number;
      username?: string;
      password?: string;
      destination?: string;
      message?: string;
      timeout?: number;
    };

    const {
      host,
      port = 61613,
      username = 'admin',
      password = 'admin',
      destination = '/queue/TEST',
      message = 'hello',
      timeout = 10000,
    } = req;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const dest = normaliseDestination(destination);
    const startTime = Date.now();

    // Reuse the withStompSession helper already defined in this file
    const result = await Promise.race([
      withStompSession(
        host, port, username, password,
        undefined, // vhost — not needed for ActiveMQ
        timeout,
        async (writer, _reader, connFrame, readNextFrame) => {
          const enc = new TextEncoder();
          const sessionId = connFrame.headers['session'] ?? connFrame.headers['session-id'] ?? '';
          const serverVersion = connFrame.headers['version'] ?? connFrame.headers['server'] ?? '';
          const heartBeat = connFrame.headers['heart-beat'] ?? '';

          // ── SUBSCRIBE ──────────────────────────────────────────────────────
          const subFrame = buildStompFrame('SUBSCRIBE', {
            id: 'sub-1',
            destination: dest,
            ack: 'auto',
            receipt: 'sub-receipt-1',
          });
          await writer.write(enc.encode(subFrame));

          // ── SEND ───────────────────────────────────────────────────────────
          const sendFrame = buildStompFrame(
            'SEND',
            {
              destination: dest,
              'content-type': 'text/plain',
              'content-length': String(new TextEncoder().encode(message).length),
            },
            message,
          );
          await writer.write(enc.encode(sendFrame));

          // ── Wait for RECEIPT (subscribe ack) or MESSAGE ────────────────────
          let subscribeAck = false;
          let messageReceived = false;

          // Read up to 3 frames with a 3-second window
          const frameDeadline = Date.now() + Math.min(3000, timeout - (Date.now() - startTime));
          let framesRead = 0;

          while (framesRead < 3 && Date.now() < frameDeadline) {
            try {
              const remaining = Math.max(frameDeadline - Date.now(), 0);
              const frame = await Promise.race([
                readNextFrame(),
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error('frame timeout')), remaining)),
              ]);
              framesRead++;
              if (frame.command === 'RECEIPT' && frame.headers['receipt-id'] === 'sub-receipt-1') {
                subscribeAck = true;
              }
              if (frame.command === 'MESSAGE') {
                messageReceived = true;
              }
            } catch {
              break;
            }
          }

          return {
            success: true,
            latencyMs: Date.now() - startTime,
            sessionId,
            serverVersion,
            heartBeat,
            subscribeAck,
            messageReceived,
            destination: dest,
          };
        },
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), timeout),
      ),
    ]);

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
