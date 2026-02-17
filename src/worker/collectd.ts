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
const PART_TIME_HR     = 0x0008;
const PART_INTERVAL_HR = 0x0009;

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


// ─── collectd Put (clean public interface for sending a single metric) ────────

interface CollectdPutRequest {
  host: string;
  port?: number;
  metricHost?: string;
  plugin?: string;
  pluginInstance?: string;
  type?: string;
  typeInstance?: string;
  value?: number;
  timeout?: number;
}

/**
 * Send a single gauge metric to a collectd server using the binary protocol.
 *
 * POST /api/collectd/put
 * Body: {
 *   host, port?,
 *   metricHost?, plugin?, pluginInstance?,
 *   type?, typeInstance?, value?, timeout?
 * }
 *
 * Connects via TCP to port 25826 (collectd uses UDP by default, but also
 * accepts TCP connections with the network plugin), builds a binary TLV
 * ValueList packet, and writes it to the socket.
 *
 * Returns the hex-encoded packet along with connection result.
 */
export async function handleCollectdPut(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as CollectdPutRequest;
    const {
      host,
      port = 25826,
      metricHost = 'cloudflare-worker',
      plugin = 'test',
      pluginInstance = '',
      type = 'gauge',
      typeInstance = 'value',
      value = 42.0,
      timeout = 5000,
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

      const writer = socket.writable.getWriter();

      const timestamp = Math.floor(Date.now() / 1000);
      const interval = 10;
      const packet = buildValueList(
        metricHost,
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
      const latencyMs = Date.now() - startTime;

      // Convert packet bytes to hex string for diagnostics
      const packetHex = Array.from(packet).map(b => b.toString(16).padStart(2, '0')).join('');

      writer.releaseLock();
      socket.close();

      return new Response(
        JSON.stringify({
          success: true,
          packet: packetHex,
          bytesSent: packet.length,
          latencyMs,
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

// ─── Value type names (used by /receive) ─────────────────────────────────────

const VALUE_TYPE_NAMES: Record<number, string> = {
  0: 'COUNTER',
  1: 'GAUGE',
  2: 'DERIVE',
  3: 'ABSOLUTE',
};

interface CollectdMetric {
  host: string;
  plugin: string;
  pluginInstance: string;
  type: string;
  typeInstance: string;
  timestamp: number;
  interval: number;
  values: Array<{ type: string; value: number }>;
}

/**
 * Decode a collectd binary payload into an array of metric records.
 * Each network packet may embed multiple ValueList parts. State (host/plugin/type)
 * accumulates across consecutive parts just like the collectd C source does.
 */
function decodeBinaryPacket(data: Uint8Array): CollectdMetric[] {
  const metrics: CollectdMetric[] = [];
  let offset = 0;

  let host = '';
  let plugin = '';
  let pluginInstance = '';
  let metricType = '';
  let typeInstance = '';
  let timestamp = 0;
  let metricInterval = 0;

  const dec = new TextDecoder();

  while (offset + 4 <= data.length) {
    const view = new DataView(data.buffer, data.byteOffset + offset);
    const partType = view.getUint16(0, false);
    const partLen  = view.getUint16(2, false);

    if (partLen < 4 || offset + partLen > data.length) break;

    const bodyStart = data.byteOffset + offset + 4;
    const bodyLen   = partLen - 4;

    // String parts
    if (
      partType === PART_HOST || partType === PART_PLUGIN ||
      partType === PART_PLUGIN_INSTANCE || partType === PART_TYPE ||
      partType === PART_TYPE_INSTANCE
    ) {
      const str = dec.decode(data.slice(offset + 4, offset + partLen));
      if (partType === PART_HOST)            host = str;
      else if (partType === PART_PLUGIN)     plugin = str;
      else if (partType === PART_PLUGIN_INSTANCE) pluginInstance = str;
      else if (partType === PART_TYPE)       metricType = str;
      else if (partType === PART_TYPE_INSTANCE)   typeInstance = str;
    }

    // Timestamp (seconds, uint64 BE)
    else if (partType === PART_TIME && bodyLen >= 8) {
      const v = new DataView(data.buffer, bodyStart, bodyLen);
      timestamp = Number(v.getBigUint64(0, false));
    }

    // Timestamp (high-res, 2^-30 s units, uint64 BE)
    else if (partType === PART_TIME_HR && bodyLen >= 8) {
      const v = new DataView(data.buffer, bodyStart, bodyLen);
      timestamp = Number(v.getBigUint64(0, false)) / (1 << 30);
    }

    // Interval (seconds, uint64 BE)
    else if (partType === PART_INTERVAL && bodyLen >= 8) {
      const v = new DataView(data.buffer, bodyStart, bodyLen);
      metricInterval = Number(v.getBigUint64(0, false));
    }

    // Interval (high-res)
    else if (partType === PART_INTERVAL_HR && bodyLen >= 8) {
      const v = new DataView(data.buffer, bodyStart, bodyLen);
      metricInterval = Number(v.getBigUint64(0, false)) / (1 << 30);
    }

    // Values part — emits one metric record
    else if (partType === PART_VALUES && bodyLen >= 2) {
      const v = new DataView(data.buffer, bodyStart, bodyLen);
      const numValues = v.getUint16(0, false);
      const typeCodesOff = 2;
      const valuesOff    = typeCodesOff + numValues;

      if (bodyLen >= valuesOff + numValues * 8) {
        const values: Array<{ type: string; value: number }> = [];
        for (let i = 0; i < numValues; i++) {
          const vtCode = v.getUint8(typeCodesOff + i);
          const vtName = VALUE_TYPE_NAMES[vtCode] ?? `UNKNOWN(${vtCode})`;
          const val    = v.getFloat64(valuesOff + i * 8, false);
          values.push({ type: vtName, value: val });
        }
        metrics.push({
          host, plugin, pluginInstance,
          type: metricType, typeInstance,
          timestamp: Math.round(timestamp),
          interval: Math.round(metricInterval),
          values,
        });
      }
    }

    offset += partLen;
  }

  return metrics;
}

interface CollectdReceiveRequest {
  host: string;
  port?: number;
  durationMs?: number;
  timeout?: number;
  maxMetrics?: number;
}

/**
 * Receive metrics pushed by a collectd server in server-mode.
 *
 * collectd's network plugin (server mode) forwards every locally collected
 * ValueList to all connected TCP clients. This endpoint connects, accumulates
 * data for up to `durationMs` milliseconds, and decodes every binary-protocol
 * metric packet into structured JSON — giving full read-back of whatever
 * plugins the remote collectd is running (cpu, memory, df, interface, etc.).
 *
 * POST /api/collectd/receive
 * Body: {
 *   host, port?,
 *   durationMs?  — collection window in ms (default 5000, max 15000)
 *   maxMetrics?  — stop early once this many metrics are decoded (default 200)
 *   timeout?     — TCP connect timeout (default 10000)
 * }
 */
export async function handleCollectdReceive(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as CollectdReceiveRequest;
    const {
      host,
      port        = 25826,
      durationMs  = 5000,
      timeout     = 10000,
      maxMetrics  = 200,
    } = body;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const clampedDuration = Math.min(Math.max(durationMs, 500), 15000);
    const clampedMax      = Math.min(Math.max(maxMetrics, 1), 500);

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

    const connectTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    const socket = connect(`${host}:${port}`);

    try {
      const startTime = Date.now();
      await Promise.race([socket.opened, connectTimeout]);
      const tcpLatency = Date.now() - startTime;

      const reader          = socket.readable.getReader();
      const allMetrics: CollectdMetric[] = [];
      let bytesReceived     = 0;
      let packetsDecoded    = 0;
      const collectDeadline = Date.now() + clampedDuration;

      while (allMetrics.length < clampedMax && Date.now() < collectDeadline) {
        const remaining = collectDeadline - Date.now();
        if (remaining <= 0) break;

        const readTimer = new Promise<{ done: true; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), remaining),
        );

        const { value, done } = await Promise.race([reader.read(), readTimer]);
        if (done || !value) break;

        bytesReceived += value.length;
        const decoded = decodeBinaryPacket(value);
        if (decoded.length > 0) {
          packetsDecoded++;
          for (const m of decoded) {
            allMetrics.push(m);
            if (allMetrics.length >= clampedMax) break;
          }
        }
      }

      reader.releaseLock();
      socket.close();

      const elapsed     = Date.now() - startTime - tcpLatency;
      const pluginsSeen = [...new Set(allMetrics.map(m => m.plugin))].sort();

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          tcpLatency,
          collectionMs: elapsed,
          bytesReceived,
          packetsDecoded,
          metricsReceived: allMetrics.length,
          pluginsSeen,
          metrics: allMetrics,
          note: allMetrics.length === 0
            ? 'No metrics received. Ensure collectd network plugin is in server mode with TCP on this port.'
            : `Received ${allMetrics.length} metric(s) from plugin(s): ${pluginsSeen.join(', ')}.`,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (err) {
      socket.close();
      throw err;
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
