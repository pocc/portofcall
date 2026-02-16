/**
 * NetBIOS Session Service Protocol Support for Cloudflare Workers
 *
 * NetBIOS Session Service (RFC 1002) is a transport-layer protocol
 * used primarily for SMB/CIFS file sharing over NetBIOS. Port 139
 * provides session-oriented communication between NetBIOS nodes.
 *
 * Session Service Packets:
 *   0x00 = Session Message (data transfer)
 *   0x81 = Session Request
 *   0x82 = Positive Session Response
 *   0x83 = Negative Session Response
 *   0x84 = Retarget Session Response
 *   0x85 = Session Keepalive
 *
 * Packet Format:
 *   [type:1][flags:1][length:2 big-endian]
 *   For Session Request: [called_name:34][calling_name:34]
 *
 * NetBIOS Name Encoding (First-Level):
 *   Each byte -> two bytes: ((byte >> 4) + 0x41), ((byte & 0x0F) + 0x41)
 *   Padded to 16 chars with spaces (0x20), scope ID appended
 *
 * Default port: 139 (TCP)
 *
 * Use Cases:
 *   - Windows networking service detection
 *   - SMB-over-NetBIOS availability testing
 *   - Legacy network service discovery
 *   - NetBIOS name resolution verification
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// Session Service packet types
const SESSION_MESSAGE = 0x00;
const SESSION_REQUEST = 0x81;
const POSITIVE_RESPONSE = 0x82;
const NEGATIVE_RESPONSE = 0x83;
const RETARGET_RESPONSE = 0x84;
const SESSION_KEEPALIVE = 0x85;

const PACKET_TYPE_NAMES: Record<number, string> = {
  [SESSION_MESSAGE]: 'Session Message',
  [SESSION_REQUEST]: 'Session Request',
  [POSITIVE_RESPONSE]: 'Positive Session Response',
  [NEGATIVE_RESPONSE]: 'Negative Session Response',
  [RETARGET_RESPONSE]: 'Retarget Session Response',
  [SESSION_KEEPALIVE]: 'Session Keepalive',
};

// Negative response error codes
const NEGATIVE_REASONS: Record<number, string> = {
  0x80: 'Not listening on called name',
  0x81: 'Not listening for calling process',
  0x82: 'Called name not present',
  0x83: 'Called name present, but insufficient resources',
  0x8f: 'Unspecified error',
};

/**
 * Encode a NetBIOS name using first-level encoding (RFC 1002 Section 4.1)
 * Each character is split into two nibbles, each + 0x41
 * Name is padded to 16 characters with spaces
 */
function encodeNetBIOSName(name: string, suffix: number = 0x20): Uint8Array {
  // Pad or truncate name to 15 characters
  const paddedName = name.toUpperCase().padEnd(15, ' ').slice(0, 15);

  // 34 bytes: 1 length byte + 32 encoded bytes + 1 null scope
  const encoded = new Uint8Array(34);
  encoded[0] = 32; // Length of encoded name (32 bytes)

  for (let i = 0; i < 15; i++) {
    const byte = paddedName.charCodeAt(i);
    encoded[1 + i * 2] = ((byte >> 4) & 0x0f) + 0x41;
    encoded[2 + i * 2] = (byte & 0x0f) + 0x41;
  }

  // 16th character is the suffix byte (service type)
  encoded[31] = ((suffix >> 4) & 0x0f) + 0x41;
  encoded[32] = (suffix & 0x0f) + 0x41;

  // Null scope ID terminator
  encoded[33] = 0x00;

  return encoded;
}

/**
 * Decode a first-level encoded NetBIOS name back to readable form
 */
// @ts-expect-error - referenced by future NetBIOS response decoder
function decodeNetBIOSName(data: Uint8Array, offset: number): { name: string; suffix: number } {
  if (data.length < offset + 34) return { name: '', suffix: 0 };

  const nameLen = data[offset];
  if (nameLen !== 32) return { name: '', suffix: 0 };

  let name = '';
  for (let i = 0; i < 15; i++) {
    const hi = (data[offset + 1 + i * 2] - 0x41) & 0x0f;
    const lo = (data[offset + 2 + i * 2] - 0x41) & 0x0f;
    name += String.fromCharCode((hi << 4) | lo);
  }

  // Last character pair is the suffix
  const suffixHi = (data[offset + 31] - 0x41) & 0x0f;
  const suffixLo = (data[offset + 32] - 0x41) & 0x0f;
  const suffix = (suffixHi << 4) | suffixLo;

  return { name: name.trimEnd(), suffix };
}

// Well-known NetBIOS suffix types
const SUFFIX_NAMES: Record<number, string> = {
  0x00: 'Workstation',
  0x03: 'Messenger',
  0x06: 'RAS Server',
  0x1b: 'Domain Master Browser',
  0x1c: 'Domain Controller',
  0x1d: 'Master Browser',
  0x1e: 'Browser Service Election',
  0x1f: 'NetDDE',
  0x20: 'File Server',
  0x21: 'RAS Client',
  0xbe: 'Network Monitor Agent',
  0xbf: 'Network Monitor Application',
};

/**
 * Build a Session Request packet
 */
function buildSessionRequest(calledName: string, calledSuffix: number, callingName: string): Uint8Array {
  const called = encodeNetBIOSName(calledName, calledSuffix);
  const calling = encodeNetBIOSName(callingName, 0x00);

  const dataLen = called.length + calling.length;
  const packet = new Uint8Array(4 + dataLen);

  packet[0] = SESSION_REQUEST; // Type
  packet[1] = 0x00;            // Flags
  packet[2] = (dataLen >> 8) & 0xff; // Length high
  packet[3] = dataLen & 0xff;        // Length low

  packet.set(called, 4);
  packet.set(calling, 4 + called.length);

  return packet;
}

/**
 * Read a Session Service response packet
 */
async function readSessionPacket(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeout: number,
): Promise<{ type: number; flags: number; data: Uint8Array }> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Read timeout')), timeout)
  );

  const readPromise = (async () => {
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    // Read at least 4 bytes (packet header)
    while (totalBytes < 4) {
      const { value, done } = await reader.read();
      if (done || !value) throw new Error('Connection closed before packet header');
      chunks.push(value);
      totalBytes += value.length;
    }

    // Combine chunks
    const headerBuf = new Uint8Array(totalBytes);
    let off = 0;
    for (const chunk of chunks) {
      headerBuf.set(chunk, off);
      off += chunk.length;
    }

    const type = headerBuf[0];
    const flags = headerBuf[1];
    const length = (headerBuf[2] << 8) | headerBuf[3];

    // Read remaining data if any
    while (totalBytes < 4 + length) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      totalBytes += value.length;
    }

    // Combine all
    const fullBuf = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      fullBuf.set(chunk, offset);
      offset += chunk.length;
    }

    return {
      type,
      flags,
      data: fullBuf.slice(4, 4 + length),
    };
  })();

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Handle NetBIOS Session Service connection test
 * Sends a Session Request and reads the response
 */
export async function handleNetBIOSConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      calledName?: string;
      calledSuffix?: number;
      timeout?: number;
    };

    const { host, port = 139, timeout = 10000 } = body;
    const calledName = body.calledName || '*SMBSERVER';
    const calledSuffix = body.calledSuffix ?? 0x20;

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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Send Session Request
        const sessionRequest = buildSessionRequest(calledName, calledSuffix, 'PORTOFCALL');
        await writer.write(sessionRequest);

        // Read response
        const response = await readSessionPacket(reader, 5000);
        const rtt = Date.now() - startTime;

        const result: Record<string, unknown> = {
          success: true,
          host,
          port,
          rtt,
          calledName,
          calledSuffix,
          calledSuffixName: SUFFIX_NAMES[calledSuffix] || `Unknown (0x${calledSuffix.toString(16)})`,
          responseType: response.type,
          responseTypeName: PACKET_TYPE_NAMES[response.type] || `Unknown (0x${response.type.toString(16)})`,
        };

        if (response.type === POSITIVE_RESPONSE) {
          result.sessionEstablished = true;
          result.message = 'NetBIOS session established successfully';
        } else if (response.type === NEGATIVE_RESPONSE) {
          result.sessionEstablished = false;
          const errorCode = response.data.length > 0 ? response.data[0] : 0xff;
          result.errorCode = `0x${errorCode.toString(16)}`;
          result.errorReason = NEGATIVE_REASONS[errorCode] || 'Unknown error';
        } else if (response.type === RETARGET_RESPONSE) {
          result.sessionEstablished = false;
          result.message = 'Session retarget';
          if (response.data.length >= 6) {
            const retargetIP = `${response.data[0]}.${response.data[1]}.${response.data[2]}.${response.data[3]}`;
            const retargetPort = (response.data[4] << 8) | response.data[5];
            result.retargetIP = retargetIP;
            result.retargetPort = retargetPort;
          }
        } else {
          result.sessionEstablished = false;
          result.message = `Unexpected response type: 0x${response.type.toString(16)}`;
        }

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return result;
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'Connection timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
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
 * Handle NetBIOS service probe
 * Tests multiple well-known NetBIOS suffixes to discover services
 */
export async function handleNetBIOSProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = body.host;
    const port = body.port || 139;
    const timeout = body.timeout || 10000;

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

    // Probe key service suffixes
    const suffixesToProbe = [
      { suffix: 0x00, name: 'Workstation' },
      { suffix: 0x20, name: 'File Server' },
      { suffix: 0x1b, name: 'Domain Master Browser' },
      { suffix: 0x1c, name: 'Domain Controller' },
      { suffix: 0x1d, name: 'Master Browser' },
      { suffix: 0x03, name: 'Messenger' },
    ];

    const results: Array<{
      suffix: string;
      suffixName: string;
      available: boolean;
      error?: string;
    }> = [];

    for (const { suffix, name } of suffixesToProbe) {
      try {
        const socket = connect(`${host}:${port}`);
        await socket.opened;

        const reader = socket.readable.getReader();
        const writer = socket.writable.getWriter();

        try {
          const sessionRequest = buildSessionRequest('*SMBSERVER', suffix, 'PORTOFCALL');
          await writer.write(sessionRequest);

          const probeTimeout = Math.min(3000, timeout);
          const response = await readSessionPacket(reader, probeTimeout);

          results.push({
            suffix: `0x${suffix.toString(16).padStart(2, '0')}`,
            suffixName: name,
            available: response.type === POSITIVE_RESPONSE,
            error: response.type === NEGATIVE_RESPONSE
              ? NEGATIVE_REASONS[response.data.length > 0 ? response.data[0] : 0xff] || 'Rejected'
              : undefined,
          });

          writer.releaseLock();
          reader.releaseLock();
          await socket.close();
        } catch (err) {
          writer.releaseLock();
          reader.releaseLock();
          await socket.close();

          results.push({
            suffix: `0x${suffix.toString(16).padStart(2, '0')}`,
            suffixName: name,
            available: false,
            error: err instanceof Error ? err.message : 'Probe failed',
          });
        }
      } catch {
        results.push({
          suffix: `0x${suffix.toString(16).padStart(2, '0')}`,
          suffixName: name,
          available: false,
          error: 'Connection failed',
        });
      }
    }

    const rtt = Date.now() - startTime;

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      servicesFound: results.filter(r => r.available).length,
      totalProbed: results.length,
      services: results,
    }), {
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
