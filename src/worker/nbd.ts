/**
 * NBD (Network Block Device) Protocol Implementation
 *
 * Implements NBD server detection and export listing via the NBD wire protocol
 * on port 10809. NBD is a Linux protocol for accessing remote block devices
 * over TCP, commonly used by QEMU/KVM, nbd-server, and various storage systems.
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
 * - Option requests:
 *   - IHAVEOPT magic (8 bytes)
 *   - Option type (4 bytes BE)
 *   - Data length (4 bytes BE)
 *   - Data (variable)
 *
 * Option Reply:
 * - Reply magic: 0x3e889045565a9 (8 bytes)
 * - Option type (4 bytes BE)
 * - Reply type (4 bytes BE)
 * - Data length (4 bytes BE)
 * - Data (variable)
 *
 * Use Cases:
 * - NBD server detection and capability fingerprinting
 * - Export listing (available block devices)
 * - Storage infrastructure discovery
 * - QEMU/KVM storage backend verification
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// NBD Magic constants
const NBDMAGIC = new Uint8Array([0x4e, 0x42, 0x44, 0x4d, 0x41, 0x47, 0x49, 0x43]); // "NBDMAGIC"
const IHAVEOPT = new Uint8Array([0x49, 0x48, 0x41, 0x56, 0x45, 0x4f, 0x50, 0x54]); // "IHAVEOPT"

// Reply magic: 0x3e889045565a9 (stored as 8 bytes big-endian)
const REPLY_MAGIC = new Uint8Array([0x00, 0x03, 0xe8, 0x89, 0x04, 0x55, 0x65, 0xa9]);

// Handshake flags (server)
const NBD_FLAG_FIXED_NEWSTYLE = 1 << 0;
const NBD_FLAG_NO_ZEROES = 1 << 1;

// Option types
const NBD_OPT_LIST = 3;
const NBD_OPT_ABORT = 2;

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

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
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

  // Check NBDMAGIC
  if (!bytesEqual(data.slice(0, 8), NBDMAGIC)) return result;
  result.isNBD = true;

  // Check IHAVEOPT (newstyle)
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
  if (fixedNewstyle) flags |= 1; // NBD_FLAG_C_FIXED_NEWSTYLE
  if (noZeroes) flags |= 2; // NBD_FLAG_C_NO_ZEROES
  view.setUint32(0, flags, false);
  return buf;
}

/**
 * Build an NBD option request.
 */
function buildOptionRequest(optionType: number, data?: Uint8Array): Uint8Array {
  const dataLen = data ? data.length : 0;
  const buf = new Uint8Array(16 + dataLen);
  buf.set(IHAVEOPT, 0); // Magic
  const view = new DataView(buf.buffer);
  view.setUint32(8, optionType, false); // Option type
  view.setUint32(12, dataLen, false); // Data length
  if (data) buf.set(data, 16);
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

  // Check reply magic
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
 * Format: name_length (4 bytes BE) + name (variable)
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

  try {
    // Read replies until we get NBD_REP_ACK or an error
    let buffer = new Uint8Array(0);

    for (let i = 0; i < maxExports + 1; i++) {
      // Read more data if needed
      while (buffer.length < 20) {
        const result = await Promise.race([reader.read(), timeoutPromise]);
        if (result.done || !result.value) return { exports };
        const newBuf = new Uint8Array(buffer.length + result.value.length);
        newBuf.set(buffer, 0);
        newBuf.set(result.value, buffer.length);
        buffer = newBuf;
      }

      // Try to parse the reply header to get data length
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const dataLen = view.getUint32(16, false);
      const totalNeeded = 20 + dataLen;

      // Read more if needed
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
        break; // Done listing
      } else if (reply.replyType === NBD_REP_ERR_UNSUP) {
        return { exports, error: 'Server does not support export listing' };
      } else if ((reply.replyType & (1 << 31)) !== 0) {
        return { exports, error: `Server error: reply type 0x${reply.replyType.toString(16)}` };
      }

      // Advance buffer past this reply
      buffer = buffer.slice(reply.totalLength);
    }
  } catch {
    // Timeout or read error during listing is OK, return what we have
  }

  return { exports };
}

/**
 * Handle NBD connection test — performs newstyle handshake and lists exports.
 */
export async function handleNBDConnect(request: Request): Promise<Response> {
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

    // Check if the target is behind Cloudflare
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
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);
    const connectTime = Date.now() - startTime;

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // Read newstyle handshake (18 bytes: 8 NBDMAGIC + 8 IHAVEOPT + 2 flags)
    const handshakeData = await readExact(reader, 18, timeoutPromise);
    const handshake = parseHandshake(handshakeData);

    let exports: string[] = [];
    let listError: string | undefined;

    if (handshake.isNBD && handshake.isNewstyle && handshake.fixedNewstyle) {
      // Send client flags
      const clientFlags = buildClientFlags(true, handshake.noZeroes);
      await writer.write(clientFlags);

      // Send NBD_OPT_LIST to get export names
      const listRequest = buildOptionRequest(NBD_OPT_LIST);
      await writer.write(listRequest);

      // Read export list
      const listResult = await readExportList(reader, timeoutPromise);
      exports = listResult.exports;
      listError = listResult.error;

      // Send NBD_OPT_ABORT to cleanly disconnect
      try {
        const abortRequest = buildOptionRequest(NBD_OPT_ABORT);
        await writer.write(abortRequest);
      } catch {
        // Ignore write errors during cleanup
      }
    }

    const rtt = Date.now() - startTime;

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

    // Check if the target is behind Cloudflare
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
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);

    const reader = socket.readable.getReader();

    // Read handshake (18 bytes)
    const handshakeData = await readExact(reader, 18, timeoutPromise);
    const rtt = Date.now() - startTime;

    const handshake = parseHandshake(handshakeData);

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
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
