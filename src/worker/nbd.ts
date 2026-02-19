/**
 * NBD (Network Block Device) Protocol Implementation
 *
 * Implements NBD server detection, export listing, and block read operations
 * via the NBD wire protocol on port 10809. NBD is a Linux protocol for
 * accessing remote block devices over TCP, commonly used by QEMU/KVM,
 * nbd-server, and various storage systems.
 *
 * Protocol Structure (Newstyle Negotiation):
 * Server sends on connect:
 * - NBDMAGIC: 8 bytes (0x4e42444d41474943 = "NBDMAGIC")
 * - IHAVEOPT: 8 bytes (0x49484156454F5054 = "IHAVEOPT")
 * - Handshake flags: 2 bytes (big-endian)
 *   - Bit 0: NBD_FLAG_FIXED_NEWSTYLE
 *   - Bit 1: NBD_FLAG_NO_ZEROES
 *
 * Client sends:
 * - Client flags: 4 bytes (big-endian)
 * - Option requests: IHAVEOPT magic + option type + data length + data
 *
 * NBD_OPT_EXPORT_NAME (0x1):
 * - Client sends export name, server responds with export info
 * - Export info: size[8B] + transmission_flags[2B] + 124 zero bytes
 *
 * Transmission phase:
 * - READ command: [NBD_REQUEST_MAGIC 4B][flags 2B][type 2B][handle 8B][offset 8B][length 4B]
 * - Response: [NBD_REPLY_MAGIC 4B][error 4B][handle 8B][data...]
 * - DISCONNECT: same structure with type=0x0002
 *
 * Use Cases:
 * - NBD server detection and capability fingerprinting
 * - Export listing (available block devices)
 * - Block data reading (sector-level access)
 * - Storage infrastructure discovery
 * - QEMU/KVM storage backend verification
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// NBD Magic constants
const NBDMAGIC = new Uint8Array([0x4e, 0x42, 0x44, 0x4d, 0x41, 0x47, 0x49, 0x43]); // "NBDMAGIC"
const IHAVEOPT = new Uint8Array([0x49, 0x48, 0x41, 0x56, 0x45, 0x4f, 0x50, 0x54]); // "IHAVEOPT"

// Option reply magic: 0x0003e889045565a9 (8 bytes big-endian)
const REPLY_MAGIC = new Uint8Array([0x00, 0x03, 0xe8, 0x89, 0x04, 0x55, 0x65, 0xa9]);

// Handshake flags (server)
const NBD_FLAG_FIXED_NEWSTYLE = 1 << 0;
const NBD_FLAG_NO_ZEROES = 1 << 1;

// Option types
const NBD_OPT_EXPORT_NAME = 1;
const NBD_OPT_LIST = 3;
const NBD_OPT_ABORT = 2;

// Transmission request/reply magic
const NBD_REQUEST_MAGIC = 0x25609513;
const NBD_REPLY_MAGIC = 0x67446698;

// Command types
const NBD_CMD_READ = 0x0000;
const NBD_CMD_DISCONNECT = 0x0002;

// Reply types
const NBD_REP_ACK = 1;
const NBD_REP_SERVER = 2;
const NBD_REP_ERR_UNSUP = (1 << 31) | 1;

/**
 * Compare two Uint8Arrays for equality.
 */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Read exactly `needed` bytes from a reader with timeout.
 * Returns exactly the requested number of bytes, no more, no less.
 */
async function readExact(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  needed: number,
  timeoutPromise: Promise<never>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (total < needed) {
    const result = await Promise.race([reader.read(), timeoutPromise]);
    if (result.done || !result.value) {
      throw new Error(`Connection closed after ${total} bytes (expected ${needed})`);
    }
    chunks.push(result.value);
    total += result.value.length;
  }

  // Combine chunks and return exactly `needed` bytes (trim overshoot)
  const combined = new Uint8Array(needed);
  let offset = 0;
  for (const chunk of chunks) {
    const toCopy = Math.min(chunk.length, needed - offset);
    combined.set(chunk.subarray(0, toCopy), offset);
    offset += toCopy;
    if (offset >= needed) break;
  }
  return combined;
}

/**
 * Parse the NBD newstyle handshake (18 bytes from server).
 */
function parseHandshake(data: Uint8Array): {
  isNBD: boolean;
  isNewstyle: boolean;
  fixedNewstyle: boolean;
  noZeroes: boolean;
  flags: number;
} {
  const result = {
    isNBD: false,
    isNewstyle: false,
    fixedNewstyle: false,
    noZeroes: false,
    flags: 0,
  };

  if (data.length < 18) return result;

  if (!bytesEqual(data.slice(0, 8), NBDMAGIC)) return result;
  result.isNBD = true;

  if (bytesEqual(data.slice(8, 16), IHAVEOPT)) {
    result.isNewstyle = true;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    result.flags = view.getUint16(16, false);
    result.fixedNewstyle = (result.flags & NBD_FLAG_FIXED_NEWSTYLE) !== 0;
    result.noZeroes = (result.flags & NBD_FLAG_NO_ZEROES) !== 0;
  }

  return result;
}

/**
 * Build client flags response (4 bytes).
 */
function buildClientFlags(fixedNewstyle: boolean, noZeroes: boolean): Uint8Array {
  const buf = new Uint8Array(4);
  const view = new DataView(buf.buffer);
  let flags = 0;
  if (fixedNewstyle) flags |= 1;
  if (noZeroes) flags |= 2;
  view.setUint32(0, flags, false);
  return buf;
}

/**
 * Build an NBD option request.
 */
function buildOptionRequest(optionType: number, data?: Uint8Array): Uint8Array {
  const dataLen = data ? data.length : 0;
  const buf = new Uint8Array(16 + dataLen);
  buf.set(IHAVEOPT, 0);
  const view = new DataView(buf.buffer);
  view.setUint32(8, optionType, false);
  view.setUint32(12, dataLen, false);
  if (data) buf.set(data, 16);
  return buf;
}

/**
 * Build NBD_OPT_EXPORT_NAME option request to enter transmission mode.
 * This tells the server which export to open.
 */
function buildExportNameRequest(exportName: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(exportName);
  return buildOptionRequest(NBD_OPT_EXPORT_NAME, nameBytes);
}

/**
 * Build an NBD transmission READ request.
 * Format: [NBD_REQUEST_MAGIC 4B][flags 2B][type 2B][handle 8B][offset 8B][length 4B]
 */
function buildReadRequest(handle: bigint, offset: bigint, length: number): Uint8Array {
  const buf = new Uint8Array(28);
  const view = new DataView(buf.buffer);
  view.setUint32(0, NBD_REQUEST_MAGIC, false);  // magic
  view.setUint16(4, 0, false);                   // flags
  view.setUint16(6, NBD_CMD_READ, false);        // command type
  view.setBigUint64(8, handle, false);           // handle
  view.setBigUint64(16, offset, false);          // offset
  view.setUint32(24, length, false);             // length
  return buf;
}

/**
 * Build an NBD DISCONNECT request.
 */
function buildDisconnectRequest(): Uint8Array {
  const buf = new Uint8Array(28);
  const view = new DataView(buf.buffer);
  view.setUint32(0, NBD_REQUEST_MAGIC, false);
  view.setUint16(4, 0, false);
  view.setUint16(6, NBD_CMD_DISCONNECT, false);
  view.setBigUint64(8, BigInt(0), false);
  view.setBigUint64(16, BigInt(0), false);
  view.setUint32(24, 0, false);
  return buf;
}

/**
 * Parse an option reply from the server.
 */
function parseOptionReply(data: Uint8Array): {
  valid: boolean;
  optionType: number;
  replyType: number;
  replyData: Uint8Array;
  totalLength: number;
} | null {
  if (data.length < 20) return null;

  if (!bytesEqual(data.slice(0, 8), REPLY_MAGIC)) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const optionType = view.getUint32(8, false);
  const replyType = view.getUint32(12, false);
  const dataLen = view.getUint32(16, false);

  if (data.length < 20 + dataLen) return null;

  return {
    valid: true,
    optionType,
    replyType,
    replyData: data.slice(20, 20 + dataLen),
    totalLength: 20 + dataLen,
  };
}

/**
 * Parse an export name from NBD_REP_SERVER reply data.
 */
function parseExportName(data: Uint8Array): string {
  if (data.length < 4) return '';
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const nameLen = view.getUint32(0, false);
  if (data.length < 4 + nameLen) return '';
  return new TextDecoder().decode(data.slice(4, 4 + nameLen));
}

/**
 * Read option replies and collect export names.
 */
async function readExportList(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
): Promise<{ exports: string[]; error?: string }> {
  const exports: string[] = [];
  const maxExports = 100;
  const maxDataLen = 1024 * 1024; // 1MB limit for reply data

  try {
    let buffer = new Uint8Array(0);

    for (let i = 0; i < maxExports + 1; i++) {
      // Read header (20 bytes minimum)
      while (buffer.length < 20) {
        const result = await Promise.race([reader.read(), timeoutPromise]);
        if (result.done || !result.value) return { exports };
        const newBuf = new Uint8Array(buffer.length + result.value.length);
        newBuf.set(buffer, 0);
        newBuf.set(result.value, buffer.length);
        buffer = newBuf;
      }

      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const dataLen = view.getUint32(16, false); // network byte order (big-endian)

      // Validate dataLen to prevent memory exhaustion
      if (dataLen > maxDataLen) {
        return { exports, error: `Reply data length ${dataLen} exceeds maximum ${maxDataLen}` };
      }

      const totalNeeded = 20 + dataLen;

      // Read data segment
      while (buffer.length < totalNeeded) {
        const result = await Promise.race([reader.read(), timeoutPromise]);
        if (result.done || !result.value) return { exports };
        const newBuf = new Uint8Array(buffer.length + result.value.length);
        newBuf.set(buffer, 0);
        newBuf.set(result.value, buffer.length);
        buffer = newBuf;
      }

      const reply = parseOptionReply(buffer);
      if (!reply) return { exports, error: 'Invalid reply format' };

      if (reply.replyType === NBD_REP_SERVER) {
        const name = parseExportName(reply.replyData);
        exports.push(name || '(default)');
      } else if (reply.replyType === NBD_REP_ACK) {
        break;
      } else if (reply.replyType === NBD_REP_ERR_UNSUP) {
        return { exports, error: 'Server does not support export listing' };
      } else if ((reply.replyType & (1 << 31)) !== 0) {
        return { exports, error: `Server error: reply type 0x${reply.replyType.toString(16)}` };
      }

      buffer = buffer.slice(reply.totalLength);
    }
  } catch {
    // Timeout or read error — return what we have
  }

  return { exports };
}

/**
 * Format raw bytes as a hex dump string with ASCII sidebar.
 * Produces output like: "0000  4e 42 44 4d  |NBDM|"
 * Non-printable bytes (< 0x20 or >= 0x7F) are shown as '.'
 */
function formatHexDump(data: Uint8Array, maxBytes = 512): string {
  const lines: string[] = [];
  const limit = Math.min(data.length, maxBytes);

  for (let i = 0; i < limit; i += 16) {
    const rowBytes = data.slice(i, Math.min(i + 16, limit));
    const hex = Array.from(rowBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join(' ')
      .padEnd(47, ' ');
    // Only ASCII printable characters (0x20-0x7E); everything else is '.'
    const ascii = Array.from(rowBytes)
      .map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : '.')
      .join('');
    lines.push(`${i.toString(16).padStart(4, '0')}  ${hex}  |${ascii}|`);
  }

  return lines.join('\n');
}

/**
 * Handle NBD connection test — performs newstyle handshake and lists exports.
 */
export async function handleNBDConnect(request: Request): Promise<Response> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 10809, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameter: host',
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

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);
    } catch (error) {
      if (timeoutId !== null) clearTimeout(timeoutId);
      socket.close();
      throw error;
    }
    const connectTime = Date.now() - startTime;

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    const handshakeData = await readExact(reader, 18, timeoutPromise);
    const handshake = parseHandshake(handshakeData);

    let exports: string[] = [];
    let listError: string | undefined;

    if (handshake.isNBD && handshake.isNewstyle && handshake.fixedNewstyle) {
      const clientFlags = buildClientFlags(true, handshake.noZeroes);
      await writer.write(clientFlags);

      const listRequest = buildOptionRequest(NBD_OPT_LIST);
      await writer.write(listRequest);

      const listResult = await readExportList(reader, timeoutPromise);
      exports = listResult.exports;
      listError = listResult.error;

      try {
        const abortRequest = buildOptionRequest(NBD_OPT_ABORT);
        await writer.write(abortRequest);
      } catch {
        // Ignore write errors during cleanup
      }
    }

    const rtt = Date.now() - startTime;

    if (timeoutId !== null) clearTimeout(timeoutId);
    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      connectTime,
      isNBD: handshake.isNBD,
      isNewstyle: handshake.isNewstyle,
      fixedNewstyle: handshake.fixedNewstyle,
      noZeroes: handshake.noZeroes,
      handshakeFlags: handshake.flags,
      exports,
      ...(listError ? { listError } : {}),
      rawBytesReceived: handshakeData.length,
      message: handshake.isNBD
        ? `NBD server detected (${handshake.isNewstyle ? 'newstyle' : 'oldstyle'}${handshake.fixedNewstyle ? ', fixed' : ''}). ${exports.length > 0 ? `${exports.length} export(s) found.` : ''}`
        : 'Server responded but does not appear to be an NBD server.',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    // Ensure timeout is cleared on error path
    if (timeoutId !== null) clearTimeout(timeoutId);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle NBD probe — lightweight check for NBD magic bytes.
 */
export async function handleNBDProbe(request: Request): Promise<Response> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 10809, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameter: host',
      }), {
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

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const reader = socket.readable.getReader();
      const handshakeData = await readExact(reader, 18, timeoutPromise);
      const rtt = Date.now() - startTime;

      const handshake = parseHandshake(handshakeData);

      if (timeoutId !== null) clearTimeout(timeoutId);
      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      isNBD: handshake.isNBD,
      isNewstyle: handshake.isNewstyle,
      fixedNewstyle: handshake.fixedNewstyle,
      noZeroes: handshake.noZeroes,
        message: handshake.isNBD
          ? `NBD server detected (${handshake.isNewstyle ? 'newstyle' : 'oldstyle'}).`
          : 'Not an NBD server.',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      if (timeoutId !== null) clearTimeout(timeoutId);
      throw error;
    }

  } catch (error) {
    if (timeoutId !== null) clearTimeout(timeoutId);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle NBD block read operation.
 * POST /api/nbd/read
 *
 * Performs the full NBD newstyle negotiation, selects an export by name,
 * enters transmission mode, reads a block of data at the given offset,
 * then disconnects cleanly. Returns a hex dump of the block data.
 *
 * Request body JSON: { host, port?, export_name?, offset?, read_size?, timeout? }
 *
 * Default read_size is 512 bytes (one sector). Offset defaults to 0.
 */
export async function handleNBDRead(request: Request): Promise<Response> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      export_name?: string;
      offset?: number;
      length?: number;
      read_size?: number;
      timeout?: number;
    };

    const {
      host,
      port = 10809,
      export_name: exportName = '',
      offset = 0,
      read_size,
      length,
      timeout = 15000,
    } = body;

    const readSize = read_size ?? length ?? 512;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (readSize < 1 || readSize > 65536) {
      return new Response(JSON.stringify({
        success: false,
        error: 'read_size must be between 1 and 65536 bytes',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (offset < 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'offset must be non-negative',
      }), {
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

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Step 1: Read handshake (18 bytes)
      const handshakeData = await readExact(reader, 18, timeoutPromise);
      const handshake = parseHandshake(handshakeData);

      if (!handshake.isNBD) {
        if (timeoutId !== null) clearTimeout(timeoutId);
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          error: 'Server does not speak the NBD protocol',
          rawHex: Array.from(handshakeData).map(b => b.toString(16).padStart(2, '0')).join(' '),
        }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!handshake.isNewstyle || !handshake.fixedNewstyle) {
        if (timeoutId !== null) clearTimeout(timeoutId);
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          error: 'NBD server does not support fixed newstyle negotiation required for export selection',
          isNBD: true,
          isNewstyle: handshake.isNewstyle,
          fixedNewstyle: handshake.fixedNewstyle,
        }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Step 2: Send client flags
      const clientFlags = buildClientFlags(true, handshake.noZeroes);
      await writer.write(clientFlags);

      // Step 3: Send NBD_OPT_EXPORT_NAME to select the export and enter transmission mode
      // After NBD_OPT_EXPORT_NAME, if server accepts, it sends:
      // export_size[8B] + transmission_flags[2B] + (if not NO_ZEROES: 124 zero bytes)
      const exportNameReq = buildExportNameRequest(exportName);
      await writer.write(exportNameReq);

      // Read export info: 8B size + 2B flags (+ optionally 124 zero bytes)
      const exportInfoSize = handshake.noZeroes ? 10 : 10 + 124;
      const exportInfo = await readExact(reader, exportInfoSize, timeoutPromise);
      const exportView = new DataView(exportInfo.buffer, exportInfo.byteOffset, exportInfo.byteLength);
      const exportSize = exportView.getBigUint64(0, false); // big-endian per NBD spec
      const transmissionFlags = exportView.getUint16(8, false);

      // Step 4: Send READ request
      const handle = BigInt(0x1234567890ABCDEF);
      const readReq = buildReadRequest(handle, BigInt(offset), readSize);
      await writer.write(readReq);

      // Step 5: Read reply header: [NBD_REPLY_MAGIC 4B][error 4B][handle 8B]
      const replyHeader = await readExact(reader, 16, timeoutPromise);
      const replyView = new DataView(replyHeader.buffer, replyHeader.byteOffset, replyHeader.byteLength);
      const replyMagic = replyView.getUint32(0, false); // big-endian
      const replyError = replyView.getUint32(4, false);
      const replyHandle = replyView.getBigUint64(8, false);

      if (replyMagic !== NBD_REPLY_MAGIC) {
        if (timeoutId !== null) clearTimeout(timeoutId);
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          error: `Invalid NBD reply magic: 0x${replyMagic.toString(16)} (expected 0x${NBD_REPLY_MAGIC.toString(16)})`,
        }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Validate handle matches request (RFC 7143 §2.6.2)
      if (replyHandle !== handle) {
        if (timeoutId !== null) clearTimeout(timeoutId);
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          error: `Handle mismatch: received 0x${replyHandle.toString(16)}, expected 0x${handle.toString(16)}`,
        }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (replyError !== 0) {
        if (timeoutId !== null) clearTimeout(timeoutId);
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
        success: false,
        error: `NBD server returned error code: ${replyError} (errno ${replyError})`,
        exportSize: exportSize.toString(),
        transmissionFlags,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

      // Step 6: Read block data
      const blockData = await readExact(reader, readSize, timeoutPromise);
      const rtt = Date.now() - startTime;

      // Step 7: Send DISCONNECT
      try {
        const disconnectReq = buildDisconnectRequest();
        await writer.write(disconnectReq);
      } catch {
        // Ignore write errors during cleanup
      }

      if (timeoutId !== null) clearTimeout(timeoutId);
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      // Format hex dump
      const hexDump = formatHexDump(blockData);
      const rawHex = Array.from(blockData).map(b => b.toString(16).padStart(2, '0')).join(' ');

      // Basic analysis of block data
      const isAllZero = blockData.every(b => b === 0);
      const uniqueBytes = new Set(blockData).size;

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        rtt,
        exportName: exportName || '(default)',
        exportSize: exportSize.toString(),
        transmissionFlags,
        offset,
        readSize,
        bytesRead: blockData.length,
        isAllZero,
        uniqueByteValues: uniqueBytes,
        hexDump,
        rawHex: rawHex.substring(0, 1024), // first 512 bytes in hex
        message: `Read ${blockData.length} bytes at offset ${offset} from export '${exportName || 'default'}'`,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      if (timeoutId !== null) clearTimeout(timeoutId);
      throw error;
    }

  } catch (error) {
    if (timeoutId !== null) clearTimeout(timeoutId);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}


/**
 * Build an NBD transmission WRITE request.
 * Format: [NBD_REQUEST_MAGIC 4B][flags 2B][type=1 2B][handle 8B][offset 8B][length 4B][data...]
 */
function buildWriteRequest(handle: bigint, offset: bigint, data: Uint8Array): Uint8Array {
  const buf = new Uint8Array(28 + data.length);
  const view = new DataView(buf.buffer);
  view.setUint32(0, NBD_REQUEST_MAGIC, false);  // magic
  view.setUint16(4, 0, false);                   // flags
  view.setUint16(6, 1, false);                   // command type: NBD_CMD_WRITE = 1
  view.setBigUint64(8, handle, false);           // handle
  view.setBigUint64(16, offset, false);          // offset
  view.setUint32(24, data.length, false);        // length
  buf.set(data, 28);                             // data
  return buf;
}

/**
 * Handle NBD block write operation.
 * POST /api/nbd/write
 *
 * Performs the full NBD newstyle negotiation, selects an export by name,
 * enters transmission mode, writes data at the given offset, then disconnects.
 *
 * NBD_CMD_WRITE request:
 *   magic(0x25609513, 4BE) + type(1, 2BE) + handle(8B) + offset(8BE) + length(4BE) + data
 * Reply:
 *   magic(0x67446698, 4BE) + error(4BE) + handle(8B)
 *   If error != 0, throws with the error code.
 *
 * Request body JSON: { host, port?, export_name?, offset?, data, timeout? }
 *   data: hex string (e.g. "deadbeef") or array of byte values
 */
export async function handleNBDWrite(request: Request): Promise<Response> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      export_name?: string;
      offset?: number;
      data: string | number[];
      timeout?: number;
    };

    const {
      host,
      port = 10809,
      export_name: exportName = '',
      offset = 0,
      data,
      timeout = 15000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (data === undefined || data === null) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameter: data (hex string or byte array)',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Parse data: accept hex string or array of byte values
    let writeData: Uint8Array;
    if (typeof data === 'string') {
      const hex = data.replace(/\s+/g, '').replace(/^0x/i, '');
      if (hex.length === 0 || hex.length % 2 !== 0) {
        return new Response(JSON.stringify({
          success: false,
          error: 'data hex string must have an even number of hex digits',
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Validate hex characters
      if (!/^[0-9a-fA-F]+$/.test(hex)) {
        return new Response(JSON.stringify({
          success: false,
          error: 'data hex string contains invalid characters',
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      writeData = new Uint8Array(hex.length / 2);
      for (let i = 0; i < writeData.length; i++) {
        const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        if (isNaN(byte)) {
          return new Response(JSON.stringify({
            success: false,
            error: `Invalid hex byte at position ${i * 2}: ${hex.slice(i * 2, i * 2 + 2)}`,
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        writeData[i] = byte;
      }
    } else if (Array.isArray(data)) {
      writeData = new Uint8Array(data);
    } else {
      return new Response(JSON.stringify({
        success: false,
        error: 'data must be a hex string or array of byte values',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (writeData.length === 0 || writeData.length > 65536) {
      return new Response(JSON.stringify({
        success: false,
        error: 'data length must be between 1 and 65536 bytes',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (offset < 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'offset must be non-negative',
      }), {
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

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Step 1: Read handshake (18 bytes)
      const handshakeData = await readExact(reader, 18, timeoutPromise);
      const handshake = parseHandshake(handshakeData);

      if (!handshake.isNBD) {
        if (timeoutId !== null) clearTimeout(timeoutId);
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          error: 'Server does not speak the NBD protocol',
          rawHex: Array.from(handshakeData).map(b => b.toString(16).padStart(2, '0')).join(' '),
        }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!handshake.isNewstyle || !handshake.fixedNewstyle) {
        if (timeoutId !== null) clearTimeout(timeoutId);
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          error: 'NBD server does not support fixed newstyle negotiation required for export selection',
          isNBD: true,
          isNewstyle: handshake.isNewstyle,
          fixedNewstyle: handshake.fixedNewstyle,
        }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Step 2: Send client flags
      const clientFlags = buildClientFlags(true, handshake.noZeroes);
      await writer.write(clientFlags);

      // Step 3: Send NBD_OPT_EXPORT_NAME to select the export and enter transmission mode
      const exportNameReq = buildExportNameRequest(exportName);
      await writer.write(exportNameReq);

      // Read export info: 8B size + 2B flags (+ optionally 124 zero bytes)
      const exportInfoSize = handshake.noZeroes ? 10 : 10 + 124;
      const exportInfo = await readExact(reader, exportInfoSize, timeoutPromise);
      const exportView = new DataView(exportInfo.buffer, exportInfo.byteOffset, exportInfo.byteLength);
      const exportSize = exportView.getBigUint64(0, false); // big-endian per NBD spec
      const transmissionFlags = exportView.getUint16(8, false);

      // Check that write is not prohibited (NBD_FLAG_READ_ONLY = bit 1)
      const NBD_FLAG_READ_ONLY = 1 << 1;
      if (transmissionFlags & NBD_FLAG_READ_ONLY) {
        if (timeoutId !== null) clearTimeout(timeoutId);
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          error: 'NBD export is read-only (NBD_FLAG_READ_ONLY is set)',
          exportSize: exportSize.toString(),
          transmissionFlags,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Step 4: Send WRITE request (type=1, NBD_CMD_WRITE)
      const handle = BigInt(0xABCDEF1234567890);
      const writeReq = buildWriteRequest(handle, BigInt(offset), writeData);
      await writer.write(writeReq);

      // Step 5: Read reply header: [NBD_REPLY_MAGIC 4B][error 4B][handle 8B]
      const replyHeader = await readExact(reader, 16, timeoutPromise);
      const replyView = new DataView(replyHeader.buffer, replyHeader.byteOffset, replyHeader.byteLength);
      const replyMagic = replyView.getUint32(0, false); // big-endian
      const replyError = replyView.getUint32(4, false);
      const replyHandle = replyView.getBigUint64(8, false);

      if (replyMagic !== NBD_REPLY_MAGIC) {
        if (timeoutId !== null) clearTimeout(timeoutId);
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          error: `Invalid NBD reply magic: 0x${replyMagic.toString(16)} (expected 0x${NBD_REPLY_MAGIC.toString(16)})`,
        }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Validate handle matches request (RFC 7143 §2.6.2)
      if (replyHandle !== handle) {
        if (timeoutId !== null) clearTimeout(timeoutId);
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          error: `Handle mismatch: received 0x${replyHandle.toString(16)}, expected 0x${handle.toString(16)}`,
        }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (replyError !== 0) {
        if (timeoutId !== null) clearTimeout(timeoutId);
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          error: `NBD server returned write error code: ${replyError} (errno ${replyError})`,
          exportSize: exportSize.toString(),
          transmissionFlags,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const rtt = Date.now() - startTime;

      // Step 6: Send DISCONNECT
      try {
        const disconnectReq = buildDisconnectRequest();
        await writer.write(disconnectReq);
      } catch {
        // Ignore write errors during cleanup
      }

      if (timeoutId !== null) clearTimeout(timeoutId);
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        rtt,
        exportName: exportName || '(default)',
        exportSize: exportSize.toString(),
        transmissionFlags,
        offset,
        bytesWritten: writeData.length,
        message: `Successfully wrote ${writeData.length} bytes at offset ${offset} to export '${exportName || 'default'}'`,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      if (timeoutId !== null) clearTimeout(timeoutId);
      throw error;
    }

  } catch (error) {
    if (timeoutId !== null) clearTimeout(timeoutId);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
