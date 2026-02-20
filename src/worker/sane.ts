/**
 * SANE (Scanner Access Now Easy) Network Protocol Implementation
 *
 * SANE is the standard scanner access framework on Linux/Unix systems.
 * The network daemon (saned) listens on port 6566 and allows remote
 * scanner access over TCP.
 *
 * Protocol Details:
 * - All "words" are 4 bytes, big-endian (network byte order)
 * - Strings are length-prefixed: word(length) + bytes including null terminator
 * - Operations are request/response pairs
 *
 * SANE_NET_INIT (opcode 0):
 *   Request:  word(0) + word(version) + string(username)
 *   Response: word(status) + word(version)
 *
 * SANE_NET_GET_DEVICES (opcode 1):
 *   Request:  word(1)
 *   Response: word(status) + pointer-array of device descriptors
 *             Each device: 4 strings (name, vendor, model, type)
 *
 * SANE_NET_OPEN (opcode 2):
 *   Request:  word(2) + string(deviceName)
 *   Response: word(status) + word(handle) + string(resource)
 *
 * Use Cases:
 * - Network scanner discovery on Linux systems
 * - SANE daemon availability monitoring
 * - Verifying scanner sharing configuration
 *
 * Endpoints:
 *   POST /api/sane/probe    — INIT handshake, confirm daemon is alive
 *   POST /api/sane/devices  — INIT + GET_DEVICES, enumerate scanners
 *   POST /api/sane/open     — INIT + OPEN(deviceName), obtain a device handle
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SANERequest {
  host: string;
  port?: number;
  username?: string;
  timeout?: number;
}

interface SANEDevice {
  name: string;
  vendor: string;
  model: string;
  type: string;
}

// ─── SANE status codes ────────────────────────────────────────────────────────

const SANE_STATUS: Record<number, string> = {
  0: 'SANE_STATUS_GOOD',
  1: 'SANE_STATUS_UNSUPPORTED',
  2: 'SANE_STATUS_CANCELLED',
  3: 'SANE_STATUS_DEVICE_BUSY',
  4: 'SANE_STATUS_INVAL',
  5: 'SANE_STATUS_EOF',
  6: 'SANE_STATUS_JAMMED',
  7: 'SANE_STATUS_NO_DOCS',
  8: 'SANE_STATUS_COVER_OPEN',
  9: 'SANE_STATUS_IO_ERROR',
  10: 'SANE_STATUS_NO_MEM',
  11: 'SANE_STATUS_ACCESS_DENIED',
};

// ─── Encoding helpers ─────────────────────────────────────────────────────────

function encodeWord(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  buf[0] = (value >> 24) & 0xFF;
  buf[1] = (value >> 16) & 0xFF;
  buf[2] = (value >> 8) & 0xFF;
  buf[3] = value & 0xFF;
  return buf;
}

function decodeWord(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0
  );
}

/**
 * Encode a SANE length-prefixed string.
 * The length word includes the null terminator byte.
 */
function encodeString(str: string): Uint8Array {
  const encoded = new TextEncoder().encode(str);
  const length = encoded.length + 1; // +1 for null terminator
  const buf = new Uint8Array(4 + length);
  buf[0] = (length >> 24) & 0xFF;
  buf[1] = (length >> 16) & 0xFF;
  buf[2] = (length >> 8) & 0xFF;
  buf[3] = length & 0xFF;
  buf.set(encoded, 4);
  // last byte stays 0 (null terminator)
  return buf;
}

/**
 * Decode a SANE length-prefixed string at `offset`.
 * Returns the decoded string and the offset after the string data.
 */
function decodeString(data: Uint8Array, offset: number): { value: string; nextOffset: number } {
  if (offset + 4 > data.length) return { value: '', nextOffset: offset + 4 };
  const length = decodeWord(data, offset);
  offset += 4;
  if (length === 0) return { value: '', nextOffset: offset };
  // Validate length is reasonable and doesn't exceed buffer.
  // A length > 65535 almost certainly indicates a malformed or malicious response.
  if (length < 0 || length > 65535) return { value: '', nextOffset: offset };
  if (offset + length > data.length) return { value: '', nextOffset: offset };
  const bytes = data.slice(offset, offset + length);
  // Strip null terminator if present
  const nullIdx = bytes.indexOf(0);
  const strBytes = nullIdx >= 0 ? bytes.slice(0, nullIdx) : bytes;
  const value = new TextDecoder().decode(strBytes);
  return { value, nextOffset: offset + length };
}

function decodeVersion(versionCode: number): string {
  const major = (versionCode >> 24) & 0xFF;
  const minor = (versionCode >> 16) & 0xFF;
  const build = versionCode & 0xFFFF;
  return `${major}.${minor}.${build}`;
}

// ─── Request builders ─────────────────────────────────────────────────────────

/** SANE_NET_INIT (opcode 0): word(0) + word(version_code) + string(username) */
function buildInitRequest(username: string): Uint8Array {
  const opcode = encodeWord(0);
  const version = encodeWord((1 << 24) | (0 << 16) | 3); // SANE v1.0.3
  const usernameStr = encodeString(username);
  const out = new Uint8Array(opcode.length + version.length + usernameStr.length);
  out.set(opcode, 0);
  out.set(version, opcode.length);
  out.set(usernameStr, opcode.length + version.length);
  return out;
}

/** SANE_NET_GET_DEVICES (opcode 1): just the opcode word */
function buildGetDevicesRequest(): Uint8Array {
  return encodeWord(1);
}

/** SANE_NET_OPEN (opcode 2): word(2) + string(deviceName) */
function buildOpenRequest(deviceName: string): Uint8Array {
  // Validate device name to prevent path traversal and injection
  if (deviceName.length > 255) {
    throw new Error('Device name too long (max 255 characters)');
  }
  if (deviceName.includes('\0') || deviceName.includes('..')) {
    throw new Error('Invalid device name (contains null bytes or path traversal)');
  }
  if (deviceName === '.' || deviceName.startsWith('/') || deviceName.includes('\\') || deviceName.includes('./')) {
    throw new Error('Invalid device name');
  }
  const opcode = encodeWord(2);
  const nameStr = encodeString(deviceName);
  const out = new Uint8Array(opcode.length + nameStr.length);
  out.set(opcode, 0);
  out.set(nameStr, opcode.length);
  return out;
}

// ─── Socket read helper ───────────────────────────────────────────────────────

/**
 * Read from `reader` accumulating bytes until either `minBytes` are received,
 * the timeout elapses, or `maxBytes` total are buffered.
 */
async function readAtLeast(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  minBytes: number,
  timeoutMs: number,
  maxBytes = 8192,
): Promise<Uint8Array> {
  // Enforce absolute maximum to prevent memory exhaustion
  const absoluteMax = 10485760; // 10 MB
  if (maxBytes > absoluteMax) maxBytes = absoluteMax;

  const chunks: Uint8Array[] = [];
  let total = 0;
  const deadline = Date.now() + timeoutMs;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    while (total < minBytes && Date.now() < deadline) {
      const remaining = Math.max(deadline - Date.now(), 0);
      const timer = new Promise<{ value: undefined; done: true }>((resolve) => {
        timeoutHandle = setTimeout(() => resolve({ value: undefined, done: true }), remaining);
      });
      const { value, done } = await Promise.race([reader.read(), timer]);
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
        timeoutHandle = undefined;
      }
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
      if (total >= maxBytes) break;
    }

    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function guardCloudflare(host: string): Promise<Response | null> {
  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    return new Response(JSON.stringify({
      success: false,
      error: getCloudflareErrorMessage(host, cfCheck.ip),
      isCloudflare: true,
    }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  return null;
}

function badRequest(error: string): Response {
  return new Response(JSON.stringify({ success: false, error }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}

function errorResponse(error: unknown): Response {
  return new Response(JSON.stringify({
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
  }), { status: 500, headers: { 'Content-Type': 'application/json' } });
}

// ─── POST /api/sane/probe ─────────────────────────────────────────────────────

/**
 * Send SANE_NET_INIT and confirm the daemon responds with a valid status + version.
 * This is the lightest-weight check — just confirms saned is running.
 */
export async function handleSANEProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SANERequest;
    const { host, port = 6566, timeout = 10000 } = body;
    const username = body.username ?? 'anonymous';

    if (!host) return badRequest('Host is required');
    if (port < 1 || port > 65535) return badRequest('Port must be between 1 and 65535');

    const guard = await guardCloudflare(host);
    if (guard) return guard;

    const startTime = Date.now();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const work = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        await writer.write(buildInitRequest(username));
        const data = await readAtLeast(reader, 8, 5000);

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        const latencyMs = Date.now() - startTime;

        if (data.length < 8) {
          return { success: false, host, port, latencyMs, error: 'Incomplete response from SANE daemon' };
        }

        const statusCode = decodeWord(data, 0);
        const versionCode = decodeWord(data, 4);

        if (statusCode !== 0) {
          return {
            success: false,
            host,
            port,
            latencyMs,
            error: `INIT failed: ${SANE_STATUS[statusCode] ?? `status ${statusCode}`}`,
          };
        }

        return {
          success: true,
          host,
          port,
          latencyMs,
          statusCode,
          statusMessage: SANE_STATUS[statusCode] ?? `Unknown (${statusCode})`,
          versionCode,
          version: decodeVersion(versionCode),
        };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        socket.close();
        throw err;
      }
    })();

    try {
      const result = await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
        }),
      ]);
      return jsonResponse(result);
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  } catch (error) {
    return errorResponse(error);
  }
}

// ─── POST /api/sane/devices ───────────────────────────────────────────────────

/**
 * Send SANE_NET_INIT then SANE_NET_GET_DEVICES to enumerate available scanners.
 *
 * GET_DEVICES response wire format after the status word:
 *   Pointer array terminated by a null-pointer word (0).
 *   Each non-zero pointer word is followed by 4 length-prefixed strings:
 *     name, vendor, model, type
 */
export async function handleSANEGetDevices(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as SANERequest;
    const { host, port = 6566, timeout = 10000 } = body;
    const username = body.username ?? 'anonymous';

    if (!host) return badRequest('Host is required');
    if (port < 1 || port > 65535) return badRequest('Port must be between 1 and 65535');

    const guard = await guardCloudflare(host);
    if (guard) return guard;

    const startTime = Date.now();
    const remaining = () => Math.max(timeout - (Date.now() - startTime), 500);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const work = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // ── Step 1: INIT ──────────────────────────────────────────────────────
        await writer.write(buildInitRequest(username));
        const initData = await readAtLeast(reader, 8, Math.min(5000, remaining()));

        if (initData.length < 8) {
          throw new Error('Incomplete INIT response from SANE daemon');
        }

        const initStatus = decodeWord(initData, 0);
        const versionCode = decodeWord(initData, 4);

        if (initStatus !== 0) {
          writer.releaseLock();
          reader.releaseLock();
          socket.close();
          return {
            success: false,
            latencyMs: Date.now() - startTime,
            error: `INIT failed: ${SANE_STATUS[initStatus] ?? `status ${initStatus}`}`,
          };
        }

        // ── Step 2: GET_DEVICES ───────────────────────────────────────────────
        await writer.write(buildGetDevicesRequest());
        const devData = await readAtLeast(reader, 8, Math.min(8000, remaining()), 65536);

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        const latencyMs = Date.now() - startTime;

        if (devData.length < 4) {
          return { success: false, latencyMs, error: 'No GET_DEVICES response received' };
        }

        const devStatus = decodeWord(devData, 0);
        const devices: SANEDevice[] = [];

        if (devStatus === 0 && devData.length > 4) {
          // Pointer array: each entry is word(0=null) or word(non-zero=present)
          // followed by 4 strings per present entry
          let offset = 4;
          while (offset + 4 <= devData.length) {
            const pointer = decodeWord(devData, offset);
            offset += 4;
            if (pointer === 0) break; // null pointer terminates array

            const fields: string[] = [];
            for (let i = 0; i < 4; i++) {
              if (offset + 4 > devData.length) { fields.push(''); continue; }
              const { value, nextOffset } = decodeString(devData, offset);
              fields.push(value);
              offset = nextOffset;
            }

            devices.push({
              name: fields[0] ?? '',
              vendor: fields[1] ?? '',
              model: fields[2] ?? '',
              type: fields[3] ?? '',
            });
          }
        }

        return {
          success: true,
          latencyMs,
          status: devStatus,
          statusMessage: SANE_STATUS[devStatus] ?? `Unknown (${devStatus})`,
          version: decodeVersion(versionCode),
          initStatus,
          initStatusMessage: SANE_STATUS[initStatus] ?? `Unknown (${initStatus})`,
          devices,
          deviceCount: devices.length,
        };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        socket.close();
        throw err;
      }
    })();

    try {
      const result = await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
        }),
      ]);
      return jsonResponse(result);
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  } catch (error) {
    return errorResponse(error);
  }
}

// ─── POST /api/sane/open ──────────────────────────────────────────────────────

/**
 * Send SANE_NET_INIT then SANE_NET_OPEN for a specific device name.
 *
 * OPEN response wire format:
 *   word(status) + word(handle) + string(resource)
 *
 * `resource` is non-empty when the server needs authorisation before granting
 * access (it contains the resource string to pass to SANE_NET_AUTHORIZE).
 *
 * Request body: { host, port=6566, deviceName='', username='anonymous', timeout=10000 }
 */
// ─── SANE option / scan types ─────────────────────────────────────────────────

const SANE_TYPE_NAMES: string[] = ['BOOL', 'INT', 'FIXED', 'STRING', 'BUTTON', 'GROUP'];
const SANE_UNIT_NAMES: string[] = ['NONE', 'PIXEL', 'BIT', 'MM', 'DPI', 'PERCENT', 'MICROSECOND'];
const SANE_FRAME_NAMES: string[] = ['GRAY', 'RGB', 'RED', 'GREEN', 'BLUE'];

function decodeCap(cap: number): string[] {
  const bits: Array<[number, string]> = [
    [0x01, 'SOFT_SELECT'], [0x02, 'HARD_SELECT'], [0x04, 'SOFT_DETECT'],
    [0x08, 'EMULATED'], [0x10, 'AUTOMATIC'], [0x20, 'INACTIVE'], [0x40, 'ADVANCED'],
  ];
  return bits.filter(([b]) => (cap & b) !== 0).map(([, n]) => n);
}

interface SANEOption {
  index: number;
  name: string;
  title: string;
  desc: string;
  type: number;
  typeName: string;
  unit: number;
  unitName: string;
  size: number;
  cap: number;
  capFlags: string[];
  active: boolean;
  settable: boolean;
  constraintType: number;
  range?: { min: number; max: number; quant: number };
  wordList?: number[];
  stringList?: string[];
}

interface SANEParameters {
  format: number;
  formatName: string;
  lastFrame: boolean;
  bytesPerLine: number;
  pixelsPerLine: number;
  lines: number;
  depth: number;
  estimatedBytes: number;
}

/** Build an opcode + handle request (8 bytes): used for GET_OPTION_DESCRIPTORS, GET_PARAMETERS, START, CANCEL */
function buildOpHandleRequest(opcode: number, handle: number): Uint8Array {
  const req = new Uint8Array(8);
  const dv = new DataView(req.buffer);
  dv.setUint32(0, opcode, false);
  dv.setUint32(4, handle, false);
  return req;
}

/**
 * Build SANE_NET_SET_OPTION request (opcode 8).
 * action: SET_VALUE=0, AUTO=1, SET_DEFAULT=2
 * valueType: BOOL=0, INT=1, FIXED=2, STRING=3
 */
function buildSetOptionRequest(
  handle: number,
  optionIndex: number,
  action: number,
  valueType: number,
  value: Uint8Array,
): Uint8Array {
  const req = new Uint8Array(24 + value.length);
  const dv = new DataView(req.buffer);
  dv.setUint32(0, 8, false);
  dv.setUint32(4, handle, false);
  dv.setUint32(8, optionIndex, false);
  dv.setUint32(12, action, false);
  dv.setUint32(16, valueType, false);
  dv.setUint32(20, value.length, false);
  req.set(value, 24);
  return req;
}

/**
 * Parse SANE_NET_GET_OPTION_DESCRIPTORS response.
 * Wire format: pointer-array of option descriptors (non-zero ptr → descriptor follows).
 * Each descriptor: string(name) + string(title) + string(desc) +
 *   word(type) + word(unit) + word(size) + word(cap) + word(constraintType) + constraint
 */
function parseOptionDescriptors(data: Uint8Array, startOffset: number): SANEOption[] {
  const options: SANEOption[] = [];
  let offset = startOffset;
  let idx = 0;

  while (offset + 4 <= data.length) {
    const pointer = decodeWord(data, offset); offset += 4;
    if (pointer === 0) break;

    const nameR = decodeString(data, offset);  offset = nameR.nextOffset;
    const titleR = decodeString(data, offset); offset = titleR.nextOffset;
    const descR = decodeString(data, offset);  offset = descR.nextOffset;
    if (offset + 20 > data.length) break;

    const type           = decodeWord(data, offset); offset += 4;
    const unit           = decodeWord(data, offset); offset += 4;
    const size           = decodeWord(data, offset); offset += 4;
    const cap            = decodeWord(data, offset); offset += 4;
    const constraintType = decodeWord(data, offset); offset += 4;

    const option: SANEOption = {
      index: idx++,
      name: nameR.value, title: titleR.value, desc: descR.value,
      type,  typeName:  SANE_TYPE_NAMES[type]  ?? `type${type}`,
      unit,  unitName:  SANE_UNIT_NAMES[unit]  ?? `unit${unit}`,
      size, cap,
      capFlags:  decodeCap(cap),
      active:    (cap & 0x20) === 0,   // INACTIVE bit clear → active
      settable:  (cap & 0x01) !== 0,   // SOFT_SELECT → user-settable
      constraintType,
    };

    if (constraintType === 1 && offset + 12 <= data.length) {
      // RANGE: min, max, quant (signed 32-bit words, FIXED type uses 16.16 format)
      const dv = new DataView(data.buffer, data.byteOffset + offset);
      const minRaw = dv.getInt32(0, false);
      const maxRaw = dv.getInt32(4, false);
      const quantRaw = dv.getInt32(8, false);
      // For FIXED type (type=2), convert 16.16 fixed-point to float
      if (type === 2) {
        option.range = {
          min: minRaw / 65536,
          max: maxRaw / 65536,
          quant: quantRaw / 65536,
        };
      } else {
        option.range = { min: minRaw, max: maxRaw, quant: quantRaw };
      }
      offset += 12;
    } else if (constraintType === 2 && offset + 4 <= data.length) {
      // WORD_LIST: word(count) + count signed words
      const count = decodeWord(data, offset); offset += 4;
      const dv = new DataView(data.buffer, data.byteOffset);
      option.wordList = [];
      for (let i = 0; i < count && offset + 4 <= data.length; i++) {
        const raw = dv.getInt32(offset, false);
        // For FIXED type, convert from 16.16 to float
        option.wordList.push(type === 2 ? raw / 65536 : raw);
        offset += 4;
      }
    } else if (constraintType === 3) {
      // STRING_LIST: pointer-array of strings
      option.stringList = [];
      while (offset + 4 <= data.length) {
        const ptr = decodeWord(data, offset); offset += 4;
        if (ptr === 0) break;
        const strR = decodeString(data, offset); offset = strR.nextOffset;
        option.stringList.push(strR.value);
      }
    }

    options.push(option);
  }

  return options;
}

function parseParameters(data: Uint8Array, offset: number): SANEParameters | null {
  if (offset + 24 > data.length) return null;
  const dv = new DataView(data.buffer, data.byteOffset + offset);
  const format        = dv.getUint32(0, false);
  const lastFrame     = dv.getUint32(4, false) !== 0;
  const bytesPerLine  = dv.getUint32(8, false);
  const pixelsPerLine = dv.getUint32(12, false);
  const linesRaw      = dv.getUint32(16, false);
  const lines         = linesRaw > 0x7FFFFFFF ? -1 : linesRaw;
  const depth         = dv.getUint32(20, false);
  return {
    format, formatName: SANE_FRAME_NAMES[format] ?? `format${format}`,
    lastFrame, bytesPerLine, pixelsPerLine, lines, depth,
    estimatedBytes: lines < 0 ? -1 : bytesPerLine * lines,
  };
}

// ─── POST /api/sane/options ───────────────────────────────────────────────────

/**
 * INIT + OPEN + GET_OPTION_DESCRIPTORS (opcode 6).
 * Returns all scanner options with names, types, units, and constraints.
 *
 * This is what you'd call before a scan to discover resolution choices,
 * color mode options, paper size, etc.
 *
 * Request body: { host, port=6566, deviceName='', username='anonymous', timeout=15000 }
 */
export async function handleSANEOptions(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as SANERequest & { deviceName?: string };
    const { host, port = 6566, timeout = 15000 } = body;
    const username   = body.username   ?? 'anonymous';
    const deviceName = body.deviceName ?? '';

    if (!host) return badRequest('Host is required');
    if (port < 1 || port > 65535) return badRequest('Port must be between 1 and 65535');

    const guard = await guardCloudflare(host);
    if (guard) return guard;

    const startTime = Date.now();
    const remaining = () => Math.max(timeout - (Date.now() - startTime), 500);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const work = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        await writer.write(buildInitRequest(username));
        const initData = await readAtLeast(reader, 8, Math.min(5000, remaining()));
        if (initData.length < 8) throw new Error('Incomplete INIT response');
        const initStatus = decodeWord(initData, 0);
        const versionCode = decodeWord(initData, 4);

        if (initStatus !== 0) {
          writer.releaseLock();
          reader.releaseLock();
          socket.close();
          return {
            success: false,
            latencyMs: Date.now() - startTime,
            error: `INIT failed: ${SANE_STATUS[initStatus] ?? `status ${initStatus}`}`,
          };
        }

        await writer.write(buildOpenRequest(deviceName));
        const openData = await readAtLeast(reader, 12, Math.min(5000, remaining()), 4096);
        if (openData.length < 8) throw new Error('Incomplete OPEN response');
        const openStatus = decodeWord(openData, 0);
        if (openStatus !== 0) {
          writer.releaseLock(); reader.releaseLock(); socket.close();
          return {
            success: false,
            latencyMs: Date.now() - startTime,
            error: `OPEN failed: ${SANE_STATUS[openStatus] ?? `status ${openStatus}`}`,
          };
        }
        const handle = decodeWord(openData, 4);

        // GET_OPTION_DESCRIPTORS (opcode 6)
        await writer.write(buildOpHandleRequest(6, handle));
        const optData = await readAtLeast(reader, 8, Math.min(10000, remaining()), 131072);

        writer.releaseLock(); reader.releaseLock(); socket.close();

        const latencyMs = Date.now() - startTime;
        const options = parseOptionDescriptors(optData, 0);
        return {
          success: true,
          latencyMs,
          version: decodeVersion(versionCode),
          deviceName, handle,
          optionCount: options.length,
          options,
        };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        socket.close(); throw err;
      }
    })();

    try {
      const result = await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
        }),
      ]);
      return jsonResponse(result);
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  } catch (error) { return errorResponse(error); }
}

// ─── POST /api/sane/scan ──────────────────────────────────────────────────────

/**
 * Full SANE scan workflow:
 *   INIT → OPEN → optional SET_OPTION(s) → GET_PARAMETERS → START → read data port
 *
 * SANE uses a separate TCP data connection for image bytes.  START returns a port
 * number; we connect there, read the raw bytes (PNM/TIFF stream), and return up
 * to maxDataBytes as base64 in the response along with scan parameters.
 *
 * Request body: {
 *   host, port=6566, deviceName='', username='anonymous', timeout=30000,
 *   maxDataBytes=65536,
 *   setOptions?: Array<{ index: number; valueType: 0|1|2|3; value: number | string }>
 *     (valueType: 0=BOOL, 1=INT, 2=FIXED, 3=STRING; index from /api/sane/options)
 * }
 */
export async function handleSANEScan(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as SANERequest & {
      deviceName?: string;
      maxDataBytes?: number;
      setOptions?: Array<{ index: number; valueType: number; value: number | string }>;
    };
    const { host, port = 6566, timeout = 30000 } = body;
    const username     = body.username     ?? 'anonymous';
    const deviceName   = body.deviceName   ?? '';
    const maxDataBytes = Math.min(body.maxDataBytes ?? 65536, 4194304);
    const setOptions   = body.setOptions   ?? [];

    if (!host) return badRequest('Host is required');
    if (port < 1 || port > 65535) return badRequest('Port must be between 1 and 65535');

    const guard = await guardCloudflare(host);
    if (guard) return guard;

    const startTime = Date.now();
    const remaining = () => Math.max(timeout - (Date.now() - startTime), 500);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let dataTimeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const work = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // 1. INIT
        await writer.write(buildInitRequest(username));
        const initData = await readAtLeast(reader, 8, Math.min(5000, remaining()));
        if (initData.length < 8) throw new Error('Incomplete INIT response');
        const initStatus = decodeWord(initData, 0);
        const versionCode = decodeWord(initData, 4);

        if (initStatus !== 0) {
          writer.releaseLock();
          reader.releaseLock();
          socket.close();
          return {
            success: false,
            latencyMs: Date.now() - startTime,
            error: `INIT failed: ${SANE_STATUS[initStatus] ?? `status ${initStatus}`}`,
          };
        }

        // 2. OPEN
        await writer.write(buildOpenRequest(deviceName));
        const openData = await readAtLeast(reader, 12, Math.min(5000, remaining()), 4096);
        if (openData.length < 8) throw new Error('Incomplete OPEN response');
        const openStatus = decodeWord(openData, 0);
        if (openStatus !== 0) {
          writer.releaseLock(); reader.releaseLock(); socket.close();
          return {
            success: false,
            latencyMs: Date.now() - startTime,
            error: `OPEN failed: ${SANE_STATUS[openStatus] ?? `status ${openStatus}`}`,
          };
        }
        const handle = decodeWord(openData, 4);

        // 3. SET_OPTION(s) (opcode 8)
        const optionResults: Array<{ index: number; status: number; info: number }> = [];
        for (const opt of setOptions) {
          let valueBytes: Uint8Array;
          if (opt.valueType === 3) {
            // STRING
            const enc = new TextEncoder().encode(String(opt.value));
            valueBytes = new Uint8Array(enc.length + 1); // null-terminated
            valueBytes.set(enc);
          } else if (opt.valueType === 2) {
            // FIXED (16.16 fixed-point)
            const floatVal = Number(opt.value);
            const fixedVal = Math.round(floatVal * 65536);
            valueBytes = new Uint8Array(4);
            new DataView(valueBytes.buffer).setInt32(0, fixedVal, false);
          } else {
            // BOOL, INT
            valueBytes = new Uint8Array(4);
            new DataView(valueBytes.buffer).setInt32(0, Number(opt.value), false);
          }
          await writer.write(buildSetOptionRequest(handle, opt.index, 0, opt.valueType, valueBytes));
          const setResp = await readAtLeast(reader, 8, Math.min(3000, remaining()), 1024);
          if (setResp.length >= 8) {
            // SET_OPTION response: word(status) + word(info) + word(valueType) + word(valueSize) + value
            optionResults.push({
              index: opt.index,
              status: decodeWord(setResp, 0),
              info:   decodeWord(setResp, 4),
            });
          }
        }

        // 4. GET_PARAMETERS (opcode 9)
        await writer.write(buildOpHandleRequest(9, handle));
        const paramData = await readAtLeast(reader, 28, Math.min(5000, remaining()));
        let parameters: SANEParameters | null = null;
        if (paramData.length >= 28 && decodeWord(paramData, 0) === 0) {
          parameters = parseParameters(paramData, 4);
        }

        // 5. START (opcode 3)
        await writer.write(buildOpHandleRequest(3, handle));
        const startResp = await readAtLeast(reader, 16, Math.min(5000, remaining()), 4096);
        writer.releaseLock(); reader.releaseLock(); socket.close();

        if (startResp.length < 4) throw new Error('Incomplete START response');
        const startStatus = decodeWord(startResp, 0);

        if (startStatus !== 0) {
          return {
            success: false,
            latencyMs: Date.now() - startTime,
            version: decodeVersion(versionCode),
            error: `START failed: ${SANE_STATUS[startStatus] ?? `status ${startStatus}`}`,
            parameters, optionResults,
          };
        }

        const dataPort = startResp.length >= 8 ? decodeWord(startResp, 4) : 0;

        // 6. Connect to data port and read image bytes
        let dataBytesRead = 0;
        let imageDataBase64 = '';
        let imageDataHex = '';
        let dataPortError: string | undefined;

        if (dataPort > 0 && dataPort <= 65535) {
          try {
            const dataSocket = connect(`${host}:${dataPort}`);
            await Promise.race([
              dataSocket.opened,
              new Promise<never>((_, rej) => {
                dataTimeoutHandle = setTimeout(() => rej(new Error('data port timeout')), 5000);
              }),
            ]);
            if (dataTimeoutHandle !== undefined) {
              clearTimeout(dataTimeoutHandle);
              dataTimeoutHandle = undefined;
            }
            const dataReader = dataSocket.readable.getReader();

            const chunks: Uint8Array[] = [];
            let totalRead = 0;
            const deadline = Date.now() + Math.min(remaining(), 15000);

            while (totalRead < maxDataBytes && Date.now() < deadline) {
              const timeLeft = Math.max(deadline - Date.now(), 0);
              const timer = new Promise<{ value: undefined; done: true }>((res) => {
                dataTimeoutHandle = setTimeout(() => res({ value: undefined, done: true }), timeLeft);
              });
              const { value, done } = await Promise.race([dataReader.read(), timer]);
              if (dataTimeoutHandle !== undefined) {
                clearTimeout(dataTimeoutHandle);
                dataTimeoutHandle = undefined;
              }
              if (done || !value || value.length === 0) break;
              const take = Math.min(value.length, maxDataBytes - totalRead);
              chunks.push(value.slice(0, take));
              totalRead += take;
            }

            dataReader.releaseLock();
            dataSocket.close();

            if (totalRead > 0) {
              const combined = new Uint8Array(totalRead);
              let off = 0;
              for (const c of chunks) { combined.set(c, off); off += c.length; }
              dataBytesRead = totalRead;
              imageDataHex = Array.from(combined.slice(0, 32))
                .map(b => b.toString(16).padStart(2, '0')).join(' ');
              const b64chunk = combined.slice(0, Math.min(65536, totalRead));
              imageDataBase64 = btoa(Array.from(b64chunk).map(b => String.fromCharCode(b)).join(''));
            }
          } catch (dataErr) {
            dataPortError = dataErr instanceof Error ? dataErr.message : String(dataErr);
          } finally {
            if (dataTimeoutHandle !== undefined) clearTimeout(dataTimeoutHandle);
          }
        }

        return {
          success: true,
          latencyMs: Date.now() - startTime,
          version: decodeVersion(versionCode),
          deviceName, handle, parameters, optionResults,
          scan: {
            dataPort, dataBytesRead,
            imageDataHex:    imageDataHex    || undefined,
            imageDataBase64: imageDataBase64 || undefined,
            dataPortError,
            note: dataPort === 0 ? 'No data port in START response' : undefined,
          },
        };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        socket.close(); throw err;
      }
    })();

    try {
      const result = await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
        }),
      ]);
      return jsonResponse(result);
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  } catch (error) { return errorResponse(error); }
}

// ─── POST /api/sane/open ──────────────────────────────────────────────────────

export async function handleSANEOpen(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as SANERequest & { deviceName?: string };
    const { host, port = 6566, timeout = 10000 } = body;
    const username = body.username ?? 'anonymous';
    const deviceName = body.deviceName ?? '';

    if (!host) return badRequest('Host is required');
    if (port < 1 || port > 65535) return badRequest('Port must be between 1 and 65535');

    const guard = await guardCloudflare(host);
    if (guard) return guard;

    const startTime = Date.now();
    const remaining = () => Math.max(timeout - (Date.now() - startTime), 500);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const work = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // ── Step 1: INIT ──────────────────────────────────────────────────────
        await writer.write(buildInitRequest(username));
        const initData = await readAtLeast(reader, 8, Math.min(5000, remaining()));

        if (initData.length < 8) {
          throw new Error('Incomplete INIT response from SANE daemon');
        }

        const initStatus = decodeWord(initData, 0);
        const versionCode = decodeWord(initData, 4);

        if (initStatus !== 0) {
          writer.releaseLock();
          reader.releaseLock();
          socket.close();
          return {
            success: false,
            latencyMs: Date.now() - startTime,
            error: `INIT failed: ${SANE_STATUS[initStatus] ?? `status ${initStatus}`}`,
          };
        }

        // ── Step 2: OPEN ──────────────────────────────────────────────────────
        await writer.write(buildOpenRequest(deviceName));
        // Response: word(status) + word(handle) + string(resource) ≥ 12 bytes
        const openData = await readAtLeast(reader, 12, Math.min(5000, remaining()), 4096);

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        const latencyMs = Date.now() - startTime;

        if (openData.length < 8) {
          return { success: false, latencyMs, error: 'Incomplete OPEN response' };
        }

        const openStatus = decodeWord(openData, 0);
        const handle = decodeWord(openData, 4);

        let resource = '';
        if (openData.length >= 12) {
          const { value } = decodeString(openData, 8);
          resource = value;
        }

        return {
          success: openStatus === 0,
          latencyMs,
          status: openStatus,
          statusMessage: SANE_STATUS[openStatus] ?? `Unknown (${openStatus})`,
          version: decodeVersion(versionCode),
          handle,
          resource,
          deviceName,
        };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        socket.close();
        throw err;
      }
    })();

    try {
      const result = await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
        }),
      ]);
      return jsonResponse(result);
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  } catch (error) {
    return errorResponse(error);
  }
}
