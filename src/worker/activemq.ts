/**
 * ActiveMQ OpenWire Protocol Probe (Port 61616/TCP)
 *
 * Apache ActiveMQ's native binary protocol. When a client connects, both sides
 * immediately exchange a WireFormatInfo command to negotiate protocol version
 * and capabilities. The broker's WireFormatInfo contains the magic string
 * "ActiveMQ" and the OpenWire protocol version number.
 *
 * OpenWire Frame Format (size-prefixed):
 *   [4 bytes: data length, big-endian — does NOT include these 4 bytes]
 *   [1 byte:  command type = 0x01 for WIREFORMAT_INFO]
 *   [4 bytes: command ID, big-endian]
 *   [1 byte:  response required flag]
 *   [4 bytes: correlation ID, big-endian]
 *   [N bytes: marshalled command body]
 *
 * WireFormatInfo Body (loose/untight encoding):
 *   [2 bytes: magic string length = 8]
 *   [8 bytes: "ActiveMQ" magic string]
 *   [4 bytes: OpenWire protocol version (big-endian int32)]
 *   [1 byte:  stackTraceEnabled boolean]
 *   [1 byte:  cacheEnabled boolean]
 *   [1 byte:  tcpNoDelayEnabled boolean]
 *   [1 byte:  tightEncodingEnabled boolean]
 *   [1 byte:  sizePrefixDisabled boolean]
 *
 * After WireFormatInfo exchange the broker typically sends a BrokerInfo command
 * (type 0x02) with the broker's name, ID, and URL.
 *
 * Default Port: 61616/TCP
 *
 * ActiveMQ also listens on multiple other ports by default:
 *   61613 — STOMP
 *   5672  — AMQP 0-9-1
 *   1883  — MQTT
 *   61614 — WebSocket (STOMP over WS)
 *   8161  — Web Admin Console (HTTP)
 *
 * Reference: https://activemq.apache.org/openwire
 * Reference: https://activemq.apache.org/configuring-transports
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const WIREFORMAT_INFO_TYPE = 0x01;
const BROKER_INFO_TYPE = 0x02;
const ACTIVEMQ_MAGIC = new TextEncoder().encode('ActiveMQ');

interface ActiveMQRequest {
  host: string;
  port?: number;
  timeout?: number;
}

function validateInput(host: string, port: number): string | null {
  if (!host || host.trim().length === 0) return 'Host is required';
  if (!/^[a-zA-Z0-9._:-]+$/.test(host)) return 'Host contains invalid characters';
  if (port < 1 || port > 65535) return 'Port must be between 1 and 65535';
  return null;
}

/**
 * Build a minimal OpenWire WireFormatInfo frame.
 * Both client and broker exchange this on connect to negotiate capabilities.
 *
 * Frame: [4-byte length][1-byte type=0x01][4-byte cmdId][1-byte respRequired]
 *        [4-byte corrId][2-byte magicLen][8-byte "ActiveMQ"][4-byte version]
 *        [5 boolean option bytes]
 */
function buildWireFormatInfo(): Uint8Array {
  const body = new Uint8Array([
    WIREFORMAT_INFO_TYPE,       // command type = 0x01
    0x00, 0x00, 0x00, 0x01,     // commandId = 1
    0x00,                       // responseRequired = false
    0x00, 0x00, 0x00, 0x00,     // correlationId = 0
    0x00, 0x08,                 // magic string length = 8
    0x41, 0x63, 0x74, 0x69,     // "Acti"
    0x76, 0x65, 0x4D, 0x51,     // "veMQ"
    0x00, 0x00, 0x00, 0x01,     // version = 1 (minimal — avoids compat mismatches)
    0x00,                       // stackTraceEnabled = false
    0x00,                       // cacheEnabled = false
    0x01,                       // tcpNoDelayEnabled = true
    0x00,                       // tightEncodingEnabled = false
    0x00,                       // sizePrefixDisabled = false
  ]);

  // Prepend 4-byte big-endian length (length of body, not including these 4 bytes)
  const frame = new Uint8Array(4 + body.length);
  new DataView(frame.buffer).setUint32(0, body.length, false);
  frame.set(body, 4);
  return frame;
}

/** Scan bytes for the "ActiveMQ" magic string. Returns offset or -1. */
function findMagic(data: Uint8Array): number {
  outer: for (let i = 0; i <= data.length - ACTIVEMQ_MAGIC.length; i++) {
    for (let j = 0; j < ACTIVEMQ_MAGIC.length; j++) {
      if (data[i + j] !== ACTIVEMQ_MAGIC[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** Parse 4-byte big-endian OpenWire version immediately following the magic. */
function parseVersion(data: Uint8Array, magicOffset: number): number | null {
  const off = magicOffset + ACTIVEMQ_MAGIC.length;
  if (off + 4 > data.length) return null;
  const v = new DataView(data.buffer, data.byteOffset + off).getInt32(0, false);
  return (v > 0 && v < 100) ? v : null;
}

/**
 * Try to extract broker name from a BrokerInfo frame body.
 * BrokerInfo is a complex marshalled object; we do a best-effort text scan.
 */
function parseBrokerName(data: Uint8Array, commandTypeOffset: number): string | undefined {
  if (data.length <= commandTypeOffset) return undefined;
  // BrokerInfo body contains marshalled strings — scan for printable ASCII sequences
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const body = decoder.decode(data.slice(commandTypeOffset));
  // Look for a run of printable ASCII ≥ 4 chars that looks like a broker name
  const match = body.match(/[a-zA-Z0-9][\w\-./]{3,63}/);
  return match?.[0];
}

/** Read bytes from stream with a deadline, collecting up to maxBytes. */
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

/**
 * Probe an Apache ActiveMQ broker.
 *
 * POST /api/activemq/probe
 * Body: { host, port?, timeout? }
 *
 * Sends a WireFormatInfo handshake and parses the broker's response
 * to detect ActiveMQ, OpenWire version, and capability flags.
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

      // Send our WireFormatInfo — triggers the broker to also send its WireFormatInfo
      await writer.write(buildWireFormatInfo());

      // Collect broker's response: WireFormatInfo + possibly BrokerInfo
      const data = await readBytes(reader, 5000, 512);

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      // Parse broker's WireFormatInfo
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

        // Boolean flags after magic + version (5 bytes: stack, cache, tcpNoDelay, tight, sizePrefix)
        const flagsOff = magicOffset + ACTIVEMQ_MAGIC.length + 4;
        if (flagsOff + 3 < data.length) {
          stackTraceEnabled    = data[flagsOff] !== 0;
          cacheEnabled         = data[flagsOff + 1] !== 0;
          // flagsOff+2 = tcpNoDelayEnabled (usually true, skip)
          tightEncodingEnabled = data[flagsOff + 3] !== 0;
        }

        // Look for a BrokerInfo frame (type 0x02) after the first frame
        // The first frame's length is in bytes [0..3]; skip past it to find second frame
        if (data.length >= 4) {
          const firstFrameLen = new DataView(data.buffer, data.byteOffset).getUint32(0, false);
          const secondFrameStart = 4 + firstFrameLen;
          if (secondFrameStart + 5 < data.length) {
            const secondType = data[secondFrameStart + 4]; // type byte after the 4-byte length
            if (secondType === BROKER_INFO_TYPE) {
              hasBrokerInfo = true;
              // Try to extract a broker name string from the BrokerInfo body
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
            ? `Apache ActiveMQ broker detected. OpenWire v${openWireVersion ?? '?'} — ` +
              `the broker's native binary protocol.`
            : `Port ${port} is open but the ActiveMQ OpenWire magic was not detected ` +
              `(${data.length} bytes received). ` +
              `ActiveMQ also accepts STOMP on :61613, AMQP on :5672, MQTT on :1883.`,
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
