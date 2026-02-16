/**
 * Oracle TNS (Transparent Network Substrate) Protocol Support for Cloudflare Workers
 * Implements TNS Connect handshake for Oracle Database connectivity testing
 *
 * Connection flow:
 * 1. Client sends TNS Connect packet (type 0x01) with service descriptor string
 * 2. Server responds with Accept (0x02), Refuse (0x04), or Redirect (0x05)
 *
 * The TNS protocol is Oracle's native wire protocol for client-server communication.
 * This implementation performs the initial handshake to detect:
 * - Oracle listener presence and version
 * - Service name availability
 * - Connection refusal reasons
 * - Redirect targets
 *
 * Spec: Oracle Database Net Services Reference
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// TNS Packet Types
const TNS_CONNECT = 0x01;
const TNS_ACCEPT = 0x02;
const TNS_REFUSE = 0x04;
const TNS_REDIRECT = 0x05;
const TNS_DATA = 0x06;
const TNS_RESEND = 0x0b;
const TNS_MARKER = 0x0c;

function getPacketTypeName(type: number): string {
  switch (type) {
    case TNS_CONNECT: return 'Connect';
    case TNS_ACCEPT: return 'Accept';
    case TNS_REFUSE: return 'Refuse';
    case TNS_REDIRECT: return 'Redirect';
    case TNS_DATA: return 'Data';
    case TNS_RESEND: return 'Resend';
    case TNS_MARKER: return 'Marker';
    default: return `Unknown (0x${type.toString(16).padStart(2, '0')})`;
  }
}

/**
 * Build a TNS Connect packet
 *
 * TNS Packet Header (8 bytes):
 *   [0-1] Packet Length (big-endian)
 *   [2-3] Packet Checksum (0x0000)
 *   [4]   Packet Type (0x01 = Connect)
 *   [5]   Reserved (0x00)
 *   [6-7] Header Checksum (0x0000)
 *
 * TNS Connect Body (variable):
 *   [8-9]   Version (e.g., 0x013C = 316 for modern clients)
 *   [10-11] Compatible Version (0x012C = 300)
 *   [12-13] Service Options (0x0C41)
 *   [14-15] Session Data Unit Size (0x2000 = 8192)
 *   [16-17] Maximum TDU Size (0x7FFF = 32767)
 *   [18-19] NT Protocol Characteristics (0x7F08)
 *   [20-21] Line Turnaround Value (0x0000)
 *   [22-23] Value of 1 in Hardware (0x0001, big-endian)
 *   [24-25] Length of Connect Data
 *   [26-27] Offset of Connect Data (from packet start)
 *   [28-31] Maximum Receivable Connect Data (0x00000000)
 *   [32]    Connect Flags 0 (0x41)
 *   [33]    Connect Flags 1 (0x41)
 *   [34-57] Reserved/cross-facility/unique ID (24 bytes, zeros)
 *   [58+]   Connect Data String
 */
function buildTNSConnectPacket(host: string, port: number, serviceName: string): Uint8Array {
  const connectData = `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${host})(PORT=${port}))(CONNECT_DATA=(SERVICE_NAME=${serviceName})(CID=(PROGRAM=portofcall)(HOST=cloudflare-worker)(USER=probe))))`;
  const connectDataBytes = new TextEncoder().encode(connectData);

  const headerLen = 8;
  const connectBodyLen = 50; // Fixed connect body before connect data
  const connectDataOffset = headerLen + connectBodyLen;
  const totalLen = connectDataOffset + connectDataBytes.length;

  const packet = new Uint8Array(totalLen);
  const view = new DataView(packet.buffer);

  // TNS Header (8 bytes)
  view.setUint16(0, totalLen, false);     // Packet length
  view.setUint16(2, 0, false);            // Packet checksum
  packet[4] = TNS_CONNECT;                // Packet type
  packet[5] = 0x00;                       // Reserved
  view.setUint16(6, 0, false);            // Header checksum

  // Connect Body
  view.setUint16(8, 316, false);          // Version (316 = Oracle 12c+)
  view.setUint16(10, 300, false);         // Compatible version (300 = Oracle 10g+)
  view.setUint16(12, 0x0C41, false);      // Service options
  view.setUint16(14, 8192, false);        // Session Data Unit size
  view.setUint16(16, 32767, false);       // Maximum TDU size
  view.setUint16(18, 0x7F08, false);      // NT protocol characteristics
  view.setUint16(20, 0, false);           // Line turnaround
  view.setUint16(22, 0x0001, false);      // Value of 1 in hardware (big-endian = big-endian host)
  view.setUint16(24, connectDataBytes.length, false); // Connect data length
  view.setUint16(26, connectDataOffset, false);       // Connect data offset
  view.setUint32(28, 0, false);           // Max receivable connect data
  packet[32] = 0x41;                      // Connect flags 0
  packet[33] = 0x41;                      // Connect flags 1
  // [34-57] Reserved/zeros (already initialized)

  // Connect data string
  packet.set(connectDataBytes, connectDataOffset);

  return packet;
}

/**
 * Parse the TNS response header and extract useful information
 */
function parseTNSResponse(data: Uint8Array): {
  packetType: number;
  packetTypeName: string;
  packetLength: number;
  version?: number;
  compatibleVersion?: number;
  serviceOptions?: number;
  sduSize?: number;
  tduSize?: number;
  connectFlags0?: number;
  connectFlags1?: number;
  refuseReasonUser?: number;
  refuseReasonSystem?: number;
  refuseData?: string;
  redirectData?: string;
  rawHex?: string;
} {
  if (data.length < 8) {
    throw new Error('TNS response too short (< 8 bytes)');
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const packetLength = view.getUint16(0, false);
  const packetType = data[4];

  const result: ReturnType<typeof parseTNSResponse> = {
    packetType,
    packetTypeName: getPacketTypeName(packetType),
    packetLength,
    rawHex: Array.from(data.subarray(0, Math.min(64, data.length)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join(' '),
  };

  if (packetType === TNS_ACCEPT && data.length >= 32) {
    // Accept packet body
    result.version = view.getUint16(8, false);
    result.compatibleVersion = view.getUint16(10, false);
    result.serviceOptions = view.getUint16(12, false);
    result.sduSize = view.getUint16(14, false);
    result.tduSize = view.getUint16(16, false);
    // Byte order is at offset 22-23
    result.connectFlags0 = data[26];
    result.connectFlags1 = data[27];
  } else if (packetType === TNS_REFUSE && data.length >= 12) {
    // Refuse packet body
    result.refuseReasonUser = data[8];
    result.refuseReasonSystem = data[9];
    const refuseDataLen = view.getUint16(10, false);
    if (refuseDataLen > 0 && data.length >= 12 + refuseDataLen) {
      result.refuseData = new TextDecoder().decode(data.subarray(12, 12 + refuseDataLen));
    }
  } else if (packetType === TNS_REDIRECT && data.length >= 12) {
    // Redirect packet body
    const redirectDataLen = view.getUint16(8, false);
    if (redirectDataLen > 0 && data.length >= 10 + redirectDataLen) {
      result.redirectData = new TextDecoder().decode(data.subarray(10, 10 + redirectDataLen));
    }
  }

  return result;
}

/** Extract Oracle version from a refuse/redirect message */
function extractOracleVersion(text: string): string | null {
  // Look for patterns like "Version 19.0.0.0.0" or "VSNNUM=..." in TNS responses
  const vsnMatch = text.match(/VSNNUM=(\d+)/);
  if (vsnMatch) {
    const vsnnum = parseInt(vsnMatch[1], 10);
    // VSNNUM encoding: major*0x01000000 + minor*0x00100000 + ...
    const major = (vsnnum >> 24) & 0xFF;
    const minor = (vsnnum >> 20) & 0x0F;
    const patch = (vsnnum >> 12) & 0xFF;
    const component = (vsnnum >> 8) & 0x0F;
    const build = vsnnum & 0xFF;
    return `${major}.${minor}.${patch}.${component}.${build}`;
  }

  // Look for error text with version info
  const verMatch = text.match(/(?:Oracle|version)\s+(\d+[\d.]+)/i);
  if (verMatch) return verMatch[1];

  return null;
}

/** Extract error code from TNS refuse data */
function extractErrorCode(text: string): string | null {
  const match = text.match(/\(ERR=(\d+)\)/);
  if (match) return `ORA-${match[1]}`;

  const oraMatch = text.match(/(ORA-\d+)/);
  if (oraMatch) return oraMatch[1];

  return null;
}

/** Read at least N bytes from a socket with buffering */
async function readBytes(reader: ReadableStreamDefaultReader<Uint8Array>, n: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalRead = 0;
  while (totalRead < n) {
    const { value, done } = await reader.read();
    if (done || !value) throw new Error('Connection closed before full TNS response received');
    chunks.push(value);
    totalRead += value.length;
  }
  if (chunks.length === 1) return chunks[0];
  const result = new Uint8Array(totalRead);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Handle Oracle TNS connectivity test
 * POST /api/oracle-tns/connect
 *
 * Sends a TNS Connect packet and parses the server response to detect
 * Oracle listener presence, version info, and service availability.
 */
export async function handleOracleTNSConnect(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { host, port = 1521, serviceName = 'ORCL', timeout = 10000 } = await request.json<{
      host: string;
      port?: number;
      serviceName?: string;
      timeout?: number;
    }>();

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Step 1: Send TNS Connect packet
        const connectPacket = buildTNSConnectPacket(host, port, serviceName);
        await writer.write(connectPacket);

        // Step 2: Read the TNS response
        // First read enough for the header to determine packet length
        const headerData = await readBytes(reader, 8);
        const packetLength = (headerData[0] << 8) | headerData[1];

        // Read remaining payload if needed
        let fullPacket: Uint8Array;
        if (packetLength > 8) {
          const remaining = await readBytes(reader, packetLength - 8);
          fullPacket = new Uint8Array(packetLength);
          fullPacket.set(headerData, 0);
          fullPacket.set(remaining, 8);
        } else {
          fullPacket = headerData;
        }

        await socket.close();

        // Step 3: Parse the response
        const parsed = parseTNSResponse(fullPacket);

        // Build result based on response type
        const result: Record<string, unknown> = {
          success: true,
          host,
          port,
          serviceName,
          protocol: 'Oracle TNS',
          responseType: parsed.packetTypeName,
        };

        if (parsed.packetType === TNS_ACCEPT) {
          result.accepted = true;
          if (parsed.version) result.tnsVersion = parsed.version;
          if (parsed.compatibleVersion) result.compatibleVersion = parsed.compatibleVersion;
          if (parsed.sduSize) result.sduSize = parsed.sduSize;
          if (parsed.tduSize) result.tduSize = parsed.tduSize;
          result.message = `Oracle listener accepted connection for service "${serviceName}"`;
        } else if (parsed.packetType === TNS_REFUSE) {
          result.accepted = false;
          result.refuseReasonUser = parsed.refuseReasonUser;
          result.refuseReasonSystem = parsed.refuseReasonSystem;
          if (parsed.refuseData) {
            result.refuseData = parsed.refuseData;
            const version = extractOracleVersion(parsed.refuseData);
            if (version) result.oracleVersion = version;
            const errCode = extractErrorCode(parsed.refuseData);
            if (errCode) result.errorCode = errCode;
          }
          result.message = `Oracle listener refused connection: ${parsed.refuseData || 'unknown reason'}`;
          // A refuse response still means the listener is there — mark as success for detection
          result.listenerDetected = true;
        } else if (parsed.packetType === TNS_REDIRECT) {
          result.accepted = false;
          result.redirected = true;
          if (parsed.redirectData) {
            result.redirectData = parsed.redirectData;
            const version = extractOracleVersion(parsed.redirectData);
            if (version) result.oracleVersion = version;
          }
          result.message = `Oracle listener redirected to: ${parsed.redirectData || 'unknown target'}`;
          result.listenerDetected = true;
        } else if (parsed.packetType === TNS_RESEND) {
          result.accepted = false;
          result.message = 'Oracle listener requested packet resend (protocol version mismatch)';
          result.listenerDetected = true;
        } else {
          result.accepted = false;
          result.message = `Oracle listener responded with unexpected packet type: ${parsed.packetTypeName}`;
          result.listenerDetected = true;
        }

        result.rawHeader = parsed.rawHex;

        return result;
      } catch (error) {
        await socket.close();
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
      error: error instanceof Error ? error.message : 'Connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle Oracle TNS listener probe
 * POST /api/oracle-tns/probe
 *
 * Simplified probe that just checks if a TNS listener is present
 * by attempting a connect with a dummy service name and checking
 * if we get any TNS response (even a refusal means it's Oracle).
 */
export async function handleOracleTNSProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { host, port = 1521, timeout = 10000 } = await request.json<{
      host: string;
      port?: number;
      timeout?: number;
    }>();

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Send a probe with a dummy service name
        const connectPacket = buildTNSConnectPacket(host, port, '__PROBE__');
        await writer.write(connectPacket);

        // Read response header
        const headerData = await readBytes(reader, 8);
        const packetLength = (headerData[0] << 8) | headerData[1];
        const packetType = headerData[4];

        // Read remaining data if needed
        let refuseData = '';
        let oracleVersion: string | null = null;

        if (packetLength > 8) {
          const remaining = await readBytes(reader, packetLength - 8);
          const fullPacket = new Uint8Array(packetLength);
          fullPacket.set(headerData, 0);
          fullPacket.set(remaining, 8);

          if (packetType === TNS_REFUSE && fullPacket.length >= 12) {
            const refuseDataLen = (fullPacket[10] << 8) | fullPacket[11];
            if (refuseDataLen > 0 && fullPacket.length >= 12 + refuseDataLen) {
              refuseData = new TextDecoder().decode(fullPacket.subarray(12, 12 + refuseDataLen));
              oracleVersion = extractOracleVersion(refuseData);
            }
          } else if (packetType === TNS_REDIRECT && fullPacket.length >= 10) {
            const redirectDataLen = (fullPacket[8] << 8) | fullPacket[9];
            if (redirectDataLen > 0 && fullPacket.length >= 10 + redirectDataLen) {
              refuseData = new TextDecoder().decode(fullPacket.subarray(10, 10 + redirectDataLen));
              oracleVersion = extractOracleVersion(refuseData);
            }
          }
        }

        await socket.close();

        // Any TNS response means Oracle listener is present
        const isOracle = [TNS_ACCEPT, TNS_REFUSE, TNS_REDIRECT, TNS_RESEND].includes(packetType);

        return {
          success: true,
          host,
          port,
          protocol: 'Oracle TNS',
          isOracle,
          responseType: getPacketTypeName(packetType),
          ...(oracleVersion && { oracleVersion }),
          message: isOracle
            ? `Oracle TNS listener detected on ${host}:${port}${oracleVersion ? ` (Oracle ${oracleVersion})` : ''}`
            : `Non-Oracle response on ${host}:${port} (type: ${getPacketTypeName(packetType)})`,
        };
      } catch (error) {
        await socket.close();
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
      error: error instanceof Error ? error.message : 'Connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
