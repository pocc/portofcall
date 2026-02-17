/**
 * collectd Network Protocol Implementation (Port 25826/TCP)
 *
 * collectd is a Unix daemon that collects system performance metrics
 * (CPU, memory, network I/O, etc.) and forwards them to a server.
 * The network plugin can use either UDP (default) or TCP.
 *
 * Binary Protocol Format (per collectd source: src/network.c):
 * Each "part" is a type-length-value structure:
 *   [type: uint16][length: uint16][data: variable]
 *
 * Part Types:
 *   0x0000  HOST            — hostname string
 *   0x0001  TIME            — timestamp uint64 (seconds)
 *   0x0002  PLUGIN          — plugin name string
 *   0x0003  PLUGIN_INSTANCE — plugin instance string
 *   0x0004  TYPE            — metric type string
 *   0x0005  TYPE_INSTANCE   — type instance string
 *   0x0006  VALUES          — array of metric values
 *   0x0007  INTERVAL        — collection interval uint64 (seconds)
 *   0x0008  TIME_HR         — high-resolution timestamp uint64 (2^-30 sec units)
 *   0x0009  INTERVAL_HR     — high-resolution interval uint64
 *   0x0100  MESSAGE         — notification message string
 *   0x0101  SEVERITY        — notification severity uint64
 *   0x0200  SIGN_SHA256     — message signing
 *   0x0210  ENCRYPT_AES256  — message encryption
 *
 * Values Part (0x0006):
 *   [num_values: uint16][type_codes: num_values × uint8][values: num_values × float64]
 *   Value types: 0=COUNTER, 1=GAUGE, 2=DERIVE, 3=ABSOLUTE
 *
 * All integers are big-endian. Floats are IEEE 754 double-precision.
 *
 * Default Port: 25826/TCP (UDP is more common)
 *
 * Reference: https://collectd.org/wiki/index.php/Binary_protocol
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// Part type constants
const PART_HOST = 0x0000;
const PART_TIME = 0x0001;
const PART_PLUGIN = 0x0002;
const PART_PLUGIN_INSTANCE = 0x0003;
const PART_TYPE = 0x0004;
const PART_TYPE_INSTANCE = 0x0005;
const PART_VALUES = 0x0006;
const PART_INTERVAL = 0x0007;

// Value type constants
const VALUE_GAUGE = 1;

interface CollectdProbeRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface CollectdSendRequest {
  host: string;
  port?: number;
  plugin?: string;
  pluginInstance?: string;
  type?: string;
  typeInstance?: string;
  hostname?: string;
  value?: number;
  timeout?: number;
}

function validateInput(host: string, port: number): string | null {
  if (!host || host.trim().length === 0) return 'Host is required';
  if (!/^[a-zA-Z0-9._-]+$/.test(host)) return 'Host contains invalid characters';
  if (port < 1 || port > 65535) return 'Port must be between 1 and 65535';
  return null;
}

/**
 * Build a collectd "string part": [type: u16][length: u16][string (no null terminator)]
 */
function buildStringPart(partType: number, value: string): Uint8Array {
  const strBytes = new TextEncoder().encode(value);
  const length = 4 + strBytes.length; // 4-byte header + string bytes
  const buf = new Uint8Array(length);
  const view = new DataView(buf.buffer);
  view.setUint16(0, partType, false);  // big-endian
  view.setUint16(2, length, false);
  buf.set(strBytes, 4);
  return buf;
}

/**
 * Build a collectd "uint64 part": [type: u16][length: u16][value: u64 big-endian]
 * Used for TIME and INTERVAL parts.
 */
function buildUint64Part(partType: number, value: number): Uint8Array {
  const length = 12; // 4-byte header + 8-byte u64
  const buf = new Uint8Array(length);
  const view = new DataView(buf.buffer);
  view.setUint16(0, partType, false);
  view.setUint16(2, length, false);
  // Write as two 32-bit halves (JavaScript safe for large numbers)
  view.setUint32(4, Math.floor(value / 0x100000000), false);
  view.setUint32(8, value >>> 0, false);
  return buf;
}

/**
 * Build a collectd "values part": [type: u16][length: u16][num: u16][types: u8×n][values: f64×n]
 */
function buildValuesPart(valueTypes: number[], values: number[]): Uint8Array {
  const n = values.length;
  // Header (4) + num_values (2) + type_codes (n) + values (n × 8)
  const length = 4 + 2 + n + n * 8;
  const buf = new Uint8Array(length);
  const view = new DataView(buf.buffer);
  view.setUint16(0, PART_VALUES, false);
  view.setUint16(2, length, false);
  view.setUint16(4, n, false);
  for (let i = 0; i < n; i++) {
    view.setUint8(6 + i, valueTypes[i]);
  }
  for (let i = 0; i < n; i++) {
    view.setFloat64(6 + n + i * 8, values[i], false); // big-endian double
  }
  return buf;
}

/**
 * Build a complete collectd ValueList (metric packet).
 * Assembles all parts into one buffer.
 */
function buildValueList(
  hostname: string,
  plugin: string,
  pluginInstance: string,
  type: string,
  typeInstance: string,
  values: number[],
  valueTypes: number[],
  timestamp: number,
  interval: number,
): Uint8Array {
  const parts: Uint8Array[] = [
    buildStringPart(PART_HOST, hostname),
    buildUint64Part(PART_TIME, timestamp),
    buildUint64Part(PART_INTERVAL, interval),
    buildStringPart(PART_PLUGIN, plugin),
    buildStringPart(PART_PLUGIN_INSTANCE, pluginInstance),
    buildStringPart(PART_TYPE, type),
    buildStringPart(PART_TYPE_INSTANCE, typeInstance),
    buildValuesPart(valueTypes, values),
  ];

  const totalLen = parts.reduce((acc, p) => acc + p.length, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }
  return combined;
}

/**
 * Attempt to parse part headers from received data (for diagnostics).
 */
function parseReceivedParts(data: Uint8Array): Array<{ type: number; typeName: string; length: number }> {
  const typeNames: Record<number, string> = {
    0x0000: 'HOST', 0x0001: 'TIME', 0x0002: 'PLUGIN', 0x0003: 'PLUGIN_INSTANCE',
    0x0004: 'TYPE', 0x0005: 'TYPE_INSTANCE', 0x0006: 'VALUES', 0x0007: 'INTERVAL',
    0x0008: 'TIME_HR', 0x0009: 'INTERVAL_HR', 0x0100: 'MESSAGE', 0x0101: 'SEVERITY',
    0x0200: 'SIGN_SHA256', 0x0210: 'ENCRYPT_AES256',
  };

  const parts: Array<{ type: number; typeName: string; length: number }> = [];
  let offset = 0;
  while (offset + 4 <= data.length) {
    const view = new DataView(data.buffer, data.byteOffset + offset);
    const partType = view.getUint16(0, false);
    const partLength = view.getUint16(2, false);
    if (partLength < 4 || offset + partLength > data.length) break;
    parts.push({
      type: partType,
      typeName: typeNames[partType] ?? `0x${partType.toString(16).toUpperCase().padStart(4, '0')}`,
      length: partLength,
    });
    offset += partLength;
  }
  return parts;
}

/**
 * Probe a collectd server — connect and check if it's reachable.
 * collectd in server mode may push metrics, or simply accept metric writes.
 *
 * POST /api/collectd/probe
 * Body: { host, port?, timeout? }
 */
export async function handleCollectdProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as CollectdProbeRequest;
    const {
      host,
      port = 25826,
      timeout = 10000,
    } = body;

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

      const reader = socket.readable.getReader();

      // collectd may push data immediately; try to read for 2 seconds
      let receivedParts: Array<{ type: number; typeName: string; length: number }> = [];
      let bytesReceived = 0;

      try {
        const readTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('read_timeout')), 2000),
        );
        const { value, done } = await Promise.race([reader.read(), readTimeout]);
        if (!done && value) {
          bytesReceived = value.length;
          receivedParts = parseReceivedParts(value);
        }
      } catch {
        // No data pushed by server — normal for client-only mode
      }

      reader.releaseLock();
      socket.close();

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          tcpLatency,
          bytesReceived,
          receivedParts: receivedParts.length > 0 ? receivedParts : undefined,
          serverPushesData: bytesReceived > 0,
          note: 'collectd binary protocol — uses binary TLV parts. ' +
            'Server mode pushes metrics; client mode accepts writes.',
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

/**
 * Send a single gauge metric to a collectd server.
 *
 * POST /api/collectd/send
 * Body: {
 *   host, port?,
 *   plugin?, pluginInstance?, type?, typeInstance?,
 *   hostname?, value?, timeout?
 * }
 *
 * Example: send CPU gauge metric
 */
export async function handleCollectdSend(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as CollectdSendRequest;
    const {
      host,
      port = 25826,
      plugin = 'portofcall',
      pluginInstance = '',
      type = 'gauge',
      typeInstance = 'probe',
      hostname = 'portofcall.dev',
      value = 42.0,
      timeout = 10000,
    } = body;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Validate metric fields
    if (!/^[a-zA-Z0-9_.-]+$/.test(plugin)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Plugin name contains invalid characters' }),
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

      // Build and send the metric
      const timestamp = Math.floor(Date.now() / 1000);
      const interval = 10; // 10 second interval
      const packet = buildValueList(
        hostname,
        plugin,
        pluginInstance,
        type,
        typeInstance,
        [value],
        [VALUE_GAUGE],
        timestamp,
        interval,
      );

      await writer.write(packet);
      const sendLatency = Date.now() - startTime - tcpLatency;

      writer.releaseLock();
      socket.close();

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          tcpLatency,
          sendLatency,
          bytesWritten: packet.length,
          metric: {
            hostname,
            plugin,
            pluginInstance: pluginInstance || undefined,
            type,
            typeInstance: typeInstance || undefined,
            value,
            timestamp,
            interval,
          },
          note: 'Metric sent using collectd binary protocol (GAUGE type). ' +
            'collectd server must have the network plugin enabled in "server" mode.',
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
