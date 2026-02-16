/**
 * SANE (Scanner Access Now Easy) Network Protocol Implementation
 *
 * SANE is the standard scanner access framework on Linux/Unix systems.
 * The network daemon (saned) listens on port 6566 and allows remote
 * scanner access over TCP.
 *
 * Protocol Details:
 * - All "words" are 4 bytes, big-endian (network byte order)
 * - Strings are length-prefixed: word(length) + bytes
 * - Operations are request/response pairs
 *
 * SANE_NET_INIT (opcode 0):
 *   Request:  word(0) + word(version) + string(username)
 *   Response: word(status) + word(version)
 *
 * SANE_NET_GET_DEVICES (opcode 1):
 *   Request:  word(1)
 *   Response: array of device descriptors
 *
 * Use Cases:
 * - Network scanner discovery on Linux systems
 * - SANE daemon availability monitoring
 * - Verifying scanner sharing configuration
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface SANERequest {
  host: string;
  port?: number;
  username?: string;
  timeout?: number;
}

interface SANEResponse {
  success: boolean;
  host: string;
  port: number;
  rtt: number;
  version?: string;
  versionCode?: number;
  statusCode?: number;
  statusMessage?: string;
  error?: string;
}

// SANE network opcodes
const SANE_NET_INIT = 0;

// SANE status codes
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

/**
 * Encode a 4-byte big-endian word
 */
function encodeWord(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  buf[0] = (value >> 24) & 0xFF;
  buf[1] = (value >> 16) & 0xFF;
  buf[2] = (value >> 8) & 0xFF;
  buf[3] = value & 0xFF;
  return buf;
}

/**
 * Decode a 4-byte big-endian word
 */
function decodeWord(data: Uint8Array, offset: number): number {
  return (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
}

/**
 * Encode a SANE string (length-prefixed)
 */
function encodeString(str: string): Uint8Array {
  const encoded = new TextEncoder().encode(str);
  // SANE strings include null terminator in the length
  const length = encoded.length + 1;
  const buf = new Uint8Array(4 + length);
  // Length word
  buf[0] = (length >> 24) & 0xFF;
  buf[1] = (length >> 16) & 0xFF;
  buf[2] = (length >> 8) & 0xFF;
  buf[3] = length & 0xFF;
  // String data
  buf.set(encoded, 4);
  // Null terminator is already 0
  return buf;
}

/**
 * Decode SANE version code to major.minor.build string
 */
function decodeVersion(versionCode: number): string {
  const major = (versionCode >> 24) & 0xFF;
  const minor = (versionCode >> 16) & 0xFF;
  const build = versionCode & 0xFFFF;
  return `${major}.${minor}.${build}`;
}

/**
 * Build a SANE_NET_INIT request
 * Format: word(opcode=0) + word(version) + string(username)
 */
function buildInitRequest(username: string): Uint8Array {
  const opcode = encodeWord(SANE_NET_INIT);
  // SANE version code: major=1, minor=0, build=3 (common client version)
  const version = encodeWord((1 << 24) | (0 << 16) | 3);
  const usernameStr = encodeString(username);

  const request = new Uint8Array(opcode.length + version.length + usernameStr.length);
  request.set(opcode, 0);
  request.set(version, opcode.length);
  request.set(usernameStr, opcode.length + version.length);

  return request;
}

/**
 * Probe a SANE daemon by sending SANE_NET_INIT
 * POST /api/sane/probe
 */
export async function handleSANEProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SANERequest;
    const { host, port = 6566, timeout = 10000 } = body;
    const username = body.username || 'anonymous';

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Send SANE_NET_INIT
        const initRequest = buildInitRequest(username);
        await writer.write(initRequest);

        // Read response: word(status) + word(version) = 8 bytes
        let buffer = new Uint8Array(0);
        const maxSize = 256;

        const readTimeout = new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), 5000)
        );

        const readLoop = (async () => {
          while (buffer.length < maxSize) {
            const { value, done } = await reader.read();
            if (done || !value) break;

            const newBuf = new Uint8Array(buffer.length + value.length);
            newBuf.set(buffer);
            newBuf.set(value, buffer.length);
            buffer = newBuf;

            // We need at least 8 bytes (status word + version word)
            if (buffer.length >= 8) return buffer;
          }
          return buffer.length > 0 ? buffer : null;
        })();

        const responseData = await Promise.race([readLoop, readTimeout]);

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        const rtt = Date.now() - startTime;

        if (!responseData || responseData.length < 8) {
          return {
            success: false,
            host,
            port,
            rtt,
            error: 'No valid response from SANE daemon',
          } as SANEResponse;
        }

        const statusCode = decodeWord(responseData, 0);
        const versionCode = decodeWord(responseData, 4);
        const version = decodeVersion(versionCode);

        const response: SANEResponse = {
          success: true,
          host,
          port,
          rtt,
          statusCode,
          statusMessage: SANE_STATUS[statusCode] || `Unknown (${statusCode})`,
          versionCode,
          version,
        };

        return response;
      } catch (error) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
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
      error: error instanceof Error ? error.message : 'Unknown error',
      host: '',
      port: 0,
      rtt: 0,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
