/**
 * JDWP Protocol Implementation (Java Debug Wire Protocol)
 *
 * JDWP is the protocol used for communication between a debugger and
 * the Java Virtual Machine (JVM) being debugged. It's defined as part
 * of the JPDA (Java Platform Debugger Architecture).
 *
 * Protocol: Binary with ASCII handshake
 * Default port: 8000 (also commonly 5005)
 *
 * Handshake:
 *   Client sends: "JDWP-Handshake" (14 bytes ASCII)
 *   Server replies: "JDWP-Handshake" (14 bytes ASCII)
 *
 * After handshake, binary command/reply packets:
 *   Length (4 bytes BE, includes header)
 *   ID (4 bytes BE)
 *   Flags (1 byte: 0x00=command, 0x80=reply)
 *   For commands: CommandSet(1) + Command(1)
 *   For replies:  ErrorCode(2)
 *   Data (variable)
 *
 * Command Sets:
 *   1 = VirtualMachine (Version=1, ClassesBySignature=2, IDSizes=7, etc.)
 *   2 = ReferenceType
 *   3 = ClassType
 *   15 = Event
 *   64 = EventRequest
 *
 * Security: Exposed JDWP ports allow arbitrary code execution on the JVM.
 * This implementation is read-only: probe handshake and query VM version.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const JDWP_HANDSHAKE = 'JDWP-Handshake'; // 14 bytes ASCII
const HEADER_SIZE = 11; // length(4) + id(4) + flags(1) + commandSet(1) + command(1)

/**
 * Build a JDWP command packet
 */
function buildCommand(id: number, commandSet: number, command: number, data?: Uint8Array): Uint8Array {
  const dataLen = data ? data.length : 0;
  const length = HEADER_SIZE + dataLen;
  const packet = new Uint8Array(length);

  // Length (4 bytes BE)
  packet[0] = (length >> 24) & 0xff;
  packet[1] = (length >> 16) & 0xff;
  packet[2] = (length >> 8) & 0xff;
  packet[3] = length & 0xff;

  // ID (4 bytes BE)
  packet[4] = (id >> 24) & 0xff;
  packet[5] = (id >> 16) & 0xff;
  packet[6] = (id >> 8) & 0xff;
  packet[7] = id & 0xff;

  // Flags: 0x00 = command
  packet[8] = 0x00;

  // CommandSet
  packet[9] = commandSet;

  // Command
  packet[10] = command;

  if (data) {
    packet.set(data, HEADER_SIZE);
  }

  return packet;
}

/**
 * Parse a JDWP reply packet header
 */
function parseReplyHeader(data: Uint8Array): {
  length: number;
  id: number;
  flags: number;
  errorCode: number;
  isReply: boolean;
} | null {
  if (data.length < HEADER_SIZE) return null;

  const length = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
  const id = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];
  const flags = data[8];
  const isReply = (flags & 0x80) !== 0;
  const errorCode = isReply ? (data[9] << 8) | data[10] : 0;

  return { length, id, flags, errorCode, isReply };
}

/**
 * Read a UTF-8 string from JDWP data (4-byte length prefix BE + string bytes)
 */
function readJDWPString(data: Uint8Array, offset: number): { value: string; nextOffset: number } | null {
  if (offset + 4 > data.length) return null;
  const len = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
  offset += 4;
  if (len < 0 || offset + len > data.length) return null;
  const value = new TextDecoder().decode(data.slice(offset, offset + len));
  return { value, nextOffset: offset + len };
}

/**
 * Parse VirtualMachine.Version reply data
 * Returns: description(string), jdwpMajor(int), jdwpMinor(int), vmVersion(string), vmName(string)
 */
function parseVersionReply(data: Uint8Array): {
  description: string;
  jdwpMajor: number;
  jdwpMinor: number;
  vmVersion: string;
  vmName: string;
} | null {
  let offset = HEADER_SIZE;

  const desc = readJDWPString(data, offset);
  if (!desc) return null;
  offset = desc.nextOffset;

  if (offset + 8 > data.length) return null;
  const jdwpMajor = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
  offset += 4;
  const jdwpMinor = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
  offset += 4;

  const vmVer = readJDWPString(data, offset);
  if (!vmVer) return null;
  offset = vmVer.nextOffset;

  const vmName = readJDWPString(data, offset);
  if (!vmName) return null;

  return {
    description: desc.value,
    jdwpMajor,
    jdwpMinor,
    vmVersion: vmVer.value,
    vmName: vmName.value,
  };
}

/**
 * Parse VirtualMachine.IDSizes reply data
 * Returns sizes of various ID types in bytes
 */
function parseIDSizesReply(data: Uint8Array): {
  fieldIDSize: number;
  methodIDSize: number;
  objectIDSize: number;
  referenceTypeIDSize: number;
  frameIDSize: number;
} | null {
  const offset = HEADER_SIZE;
  if (offset + 20 > data.length) return null;

  return {
    fieldIDSize: (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3],
    methodIDSize: (data[offset + 4] << 24) | (data[offset + 5] << 16) | (data[offset + 6] << 8) | data[offset + 7],
    objectIDSize: (data[offset + 8] << 24) | (data[offset + 9] << 16) | (data[offset + 10] << 8) | data[offset + 11],
    referenceTypeIDSize: (data[offset + 12] << 24) | (data[offset + 13] << 16) | (data[offset + 14] << 8) | data[offset + 15],
    frameIDSize: (data[offset + 16] << 24) | (data[offset + 17] << 16) | (data[offset + 18] << 8) | data[offset + 19],
  };
}

/**
 * JDWP error code names
 */
function errorCodeName(code: number): string {
  const errors: Record<number, string> = {
    0: 'NONE',
    10: 'INVALID_THREAD',
    11: 'INVALID_THREAD_GROUP',
    12: 'INVALID_PRIORITY',
    13: 'THREAD_NOT_SUSPENDED',
    14: 'THREAD_NOT_ALIVE',
    20: 'INVALID_OBJECT',
    21: 'INVALID_CLASS',
    22: 'CLASS_NOT_PREPARED',
    23: 'INVALID_METHODID',
    24: 'INVALID_LOCATION',
    25: 'INVALID_FIELDID',
    30: 'INVALID_FRAMEID',
    31: 'NO_MORE_FRAMES',
    32: 'OPAQUE_FRAME',
    33: 'NOT_CURRENT_FRAME',
    34: 'TYPE_MISMATCH',
    35: 'INVALID_SLOT',
    40: 'DUPLICATE',
    41: 'NOT_FOUND',
    50: 'INVALID_MONITOR',
    51: 'NOT_MONITOR_OWNER',
    52: 'INTERRUPT',
    60: 'INVALID_CLASS_FORMAT',
    61: 'CIRCULAR_CLASS_DEFINITION',
    62: 'FAILS_VERIFICATION',
    63: 'ADD_METHOD_NOT_IMPLEMENTED',
    64: 'SCHEMA_CHANGE_NOT_IMPLEMENTED',
    65: 'INVALID_TYPESTATE',
    66: 'HIERARCHY_CHANGE_NOT_IMPLEMENTED',
    67: 'DELETE_METHOD_NOT_IMPLEMENTED',
    68: 'UNSUPPORTED_VERSION',
    69: 'NAMES_DONT_MATCH',
    70: 'CLASS_MODIFIERS_CHANGE_NOT_IMPLEMENTED',
    71: 'METHOD_MODIFIERS_CHANGE_NOT_IMPLEMENTED',
    99: 'NOT_IMPLEMENTED',
    100: 'NULL_POINTER',
    101: 'ABSENT_INFORMATION',
    102: 'INVALID_EVENT_TYPE',
    110: 'ILLEGAL_ARGUMENT',
    111: 'OUT_OF_MEMORY',
    112: 'ACCESS_DENIED',
    113: 'VM_DEAD',
    500: 'INTERNAL',
    502: 'UNATTACHED_THREAD',
    503: 'INVALID_TAG',
    504: 'ALREADY_INVOKING',
    506: 'INVALID_INDEX',
    507: 'INVALID_LENGTH',
    508: 'INVALID_STRING',
    509: 'INVALID_CLASS_LOADER',
    510: 'INVALID_ARRAY',
    511: 'TRANSPORT_LOAD',
    512: 'TRANSPORT_INIT',
    514: 'NATIVE_METHOD',
    515: 'INVALID_COUNT',
  };
  return errors[code] || `UNKNOWN(${code})`;
}

/**
 * Format bytes as hex string
 */
function toHex(data: Uint8Array, maxBytes = 64): string {
  const slice = data.slice(0, maxBytes);
  return Array.from(slice)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}

/**
 * Read TCP response data with timeout
 */
async function readResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  expectedBytes: number
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const maxBytes = 64 * 1024;
  const deadline = Date.now() + timeoutMs;

  while (totalBytes < expectedBytes) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    const timeoutPromise = new Promise<{ done: true; value: undefined }>((resolve) => {
      setTimeout(() => resolve({ done: true, value: undefined }), Math.min(remaining, 3000));
    });

    const result = await Promise.race([reader.read(), timeoutPromise]);
    if (result.done || !result.value) break;

    chunks.push(result.value);
    totalBytes += result.value.length;
    if (totalBytes >= maxBytes) break;
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

/**
 * Probe a JDWP endpoint by performing the handshake
 */
export async function handleJDWPProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as {
      host?: string;
      port?: number;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 8000;
    const timeout = body.timeout || 10000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
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
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send JDWP handshake: "JDWP-Handshake" (14 bytes ASCII)
      const handshakeBytes = new TextEncoder().encode(JDWP_HANDSHAKE);
      await writer.write(handshakeBytes);

      // Read server handshake response (should be "JDWP-Handshake")
      const responseData = await readResponse(reader, Math.min(timeout, 5000), 14);
      const rtt = Date.now() - startTime;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      if (responseData.length === 0) {
        return new Response(
          JSON.stringify({
            success: true,
            host,
            port,
            rtt,
            isJDWP: false,
            protocol: 'JDWP',
            message: `TCP connected but no JDWP handshake response (${rtt}ms)`,
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      const responseStr = new TextDecoder().decode(responseData);
      const isJDWP = responseStr === JDWP_HANDSHAKE;

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          rtt,
          isJDWP,
          handshakeResponse: responseStr,
          responseBytes: responseData.length,
          responseHex: toHex(responseData),
          protocol: 'JDWP',
          message: isJDWP
            ? `JDWP endpoint detected! Handshake successful in ${rtt}ms`
            : `Non-JDWP response received in ${rtt}ms`,
          securityWarning: isJDWP
            ? 'WARNING: Exposed JDWP allows remote code execution on the JVM'
            : undefined,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'JDWP probe failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Query JDWP VM version info via handshake + VirtualMachine.Version command
 */
export async function handleJDWPVersion(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as {
      host?: string;
      port?: number;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 8000;
    const timeout = body.timeout || 10000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
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
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Step 1: JDWP handshake
      const handshakeBytes = new TextEncoder().encode(JDWP_HANDSHAKE);
      await writer.write(handshakeBytes);

      const handshakeResponse = await readResponse(reader, Math.min(timeout, 3000), 14);
      const handshakeStr = new TextDecoder().decode(handshakeResponse);

      if (handshakeStr !== JDWP_HANDSHAKE) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return new Response(
          JSON.stringify({
            success: false,
            error: 'Not a JDWP endpoint (handshake failed)',
            responseHex: toHex(handshakeResponse),
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Step 2: Send VirtualMachine.Version command (CommandSet=1, Command=1)
      const versionCmd = buildCommand(1, 1, 1);
      await writer.write(versionCmd);

      // Read version reply
      const versionReply = await readResponse(reader, Math.min(timeout, 3000), 256);
      const versionHeader = parseReplyHeader(versionReply);

      let versionInfo = null;
      let idSizesInfo = null;

      if (versionHeader && versionHeader.isReply && versionHeader.errorCode === 0) {
        versionInfo = parseVersionReply(versionReply);

        // Step 3: Send VirtualMachine.IDSizes command (CommandSet=1, Command=7)
        const idSizesCmd = buildCommand(2, 1, 7);
        await writer.write(idSizesCmd);

        const idSizesReply = await readResponse(reader, Math.min(timeout, 3000), 64);
        const idSizesHeader = parseReplyHeader(idSizesReply);

        if (idSizesHeader && idSizesHeader.isReply && idSizesHeader.errorCode === 0) {
          idSizesInfo = parseIDSizesReply(idSizesReply);
        }
      }

      const rtt = Date.now() - startTime;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          rtt,
          isJDWP: true,
          protocol: 'JDWP',
          handshake: 'OK',
          version: versionInfo
            ? {
                description: versionInfo.description,
                jdwpMajor: versionInfo.jdwpMajor,
                jdwpMinor: versionInfo.jdwpMinor,
                vmVersion: versionInfo.vmVersion,
                vmName: versionInfo.vmName,
              }
            : null,
          versionError: versionHeader && versionHeader.errorCode !== 0
            ? errorCodeName(versionHeader.errorCode)
            : null,
          idSizes: idSizesInfo,
          versionReplyHex: toHex(versionReply),
          securityWarning: 'WARNING: Exposed JDWP allows remote code execution on the JVM',
          message: versionInfo
            ? `JVM: ${versionInfo.vmName} ${versionInfo.vmVersion} (JDWP ${versionInfo.jdwpMajor}.${versionInfo.jdwpMinor}) in ${rtt}ms`
            : `JDWP handshake OK but version query failed in ${rtt}ms`,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'JDWP version query failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
