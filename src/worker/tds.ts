/**
 * TDS (Tabular Data Stream) Protocol Support for Cloudflare Workers
 * Implements TDS Pre-Login handshake for MS SQL Server connectivity testing
 *
 * Connection flow:
 * 1. Client sends Pre-Login packet (type 0x12) with version/encryption options
 * 2. Server responds with Pre-Login response containing server version and encryption support
 *
 * Spec: https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-tds/
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// TDS packet types
const TDS_PRELOGIN = 0x12;

// TDS packet status
const STATUS_EOM = 0x01; // End of message

// Pre-Login option tokens
const PL_OPTION_VERSION = 0x00;
const PL_OPTION_ENCRYPTION = 0x01;
const PL_OPTION_INSTOPT = 0x02;
const PL_OPTION_THREADID = 0x03;
const PL_OPTION_MARS = 0x04;
const PL_OPTION_TERMINATOR = 0xff;

// Encryption values
const ENCRYPT_OFF = 0x00;
const ENCRYPT_ON = 0x01;
const ENCRYPT_NOT_SUP = 0x02;
const ENCRYPT_REQ = 0x03;

function getEncryptionLabel(value: number): string {
  switch (value) {
    case ENCRYPT_OFF: return 'Off';
    case ENCRYPT_ON: return 'On';
    case ENCRYPT_NOT_SUP: return 'Not Supported';
    case ENCRYPT_REQ: return 'Required';
    default: return `Unknown (0x${value.toString(16)})`;
  }
}

function getTdsVersionLabel(major: number, minor: number): string {
  if (major === 0x74 && minor === 0x00) return 'TDS 7.4 (SQL Server 2012-2019)';
  if (major === 0x73 && minor === 0x0b) return 'TDS 7.3B (SQL Server 2008 R2)';
  if (major === 0x73 && minor === 0x0a) return 'TDS 7.3A (SQL Server 2008)';
  if (major === 0x72 && minor === 0x09) return 'TDS 7.2 (SQL Server 2005)';
  if (major === 0x71 && minor === 0x00) return 'TDS 7.1 (SQL Server 2000)';
  if (major === 0x70 && minor === 0x00) return 'TDS 7.0 (SQL Server 7.0)';
  return `TDS ${major}.${minor}`;
}

/** Build a TDS Pre-Login packet */
function buildPreLoginPacket(): Uint8Array {
  // Option entries: 5 options × 5 bytes each + 1 terminator = 26 bytes
  const optionListLen = 5 * 5 + 1; // 26 bytes

  // Data section
  const versionData = 6;      // UL_VERSION (4) + US_SUBBUILD (2)
  const encryptionData = 1;
  const instoptData = 1;      // Just null terminator
  const threadidData = 4;
  const marsData = 1;

  const totalDataLen = versionData + encryptionData + instoptData + threadidData + marsData;
  const payloadLen = optionListLen + totalDataLen; // 26 + 13 = 39
  const packetLen = 8 + payloadLen; // 8 header + 39 payload = 47

  const packet = new Uint8Array(packetLen);
  const view = new DataView(packet.buffer);

  // TDS Header (8 bytes)
  packet[0] = TDS_PRELOGIN;   // Type
  packet[1] = STATUS_EOM;     // Status: End of message
  view.setUint16(2, packetLen, false); // Length (big-endian)
  view.setUint16(4, 0, false); // SPID
  packet[6] = 1;               // Packet ID
  packet[7] = 0;               // Window

  // Pre-Login options (starting at offset 8)
  let optOffset = 8;
  let dataOffset = optionListLen; // Data starts after option list (relative to payload start)

  // VERSION option
  packet[optOffset] = PL_OPTION_VERSION;
  view.setUint16(optOffset + 1, dataOffset, false);
  view.setUint16(optOffset + 3, versionData, false);
  optOffset += 5;

  // ENCRYPTION option
  packet[optOffset] = PL_OPTION_ENCRYPTION;
  view.setUint16(optOffset + 1, dataOffset + versionData, false);
  view.setUint16(optOffset + 3, encryptionData, false);
  optOffset += 5;

  // INSTOPT option
  packet[optOffset] = PL_OPTION_INSTOPT;
  view.setUint16(optOffset + 1, dataOffset + versionData + encryptionData, false);
  view.setUint16(optOffset + 3, instoptData, false);
  optOffset += 5;

  // THREADID option
  packet[optOffset] = PL_OPTION_THREADID;
  view.setUint16(optOffset + 1, dataOffset + versionData + encryptionData + instoptData, false);
  view.setUint16(optOffset + 3, threadidData, false);
  optOffset += 5;

  // MARS option
  packet[optOffset] = PL_OPTION_MARS;
  view.setUint16(optOffset + 1, dataOffset + versionData + encryptionData + instoptData + threadidData, false);
  view.setUint16(optOffset + 3, marsData, false);
  optOffset += 5;

  // Terminator
  packet[optOffset] = PL_OPTION_TERMINATOR;

  // Data section (starting at offset 8 + optionListLen)
  const dataStart = 8 + optionListLen;

  // VERSION data: client version (we'll say 0.0.0.0)
  // UL_VERSION = 0x00000000, US_SUBBUILD = 0x0000
  // Leave as zeros (already initialized)

  // ENCRYPTION data: ENCRYPT_OFF (request no encryption)
  packet[dataStart + versionData] = ENCRYPT_OFF;

  // INSTOPT data: empty instance (null terminator)
  packet[dataStart + versionData + encryptionData] = 0x00;

  // THREADID data: 0x00000000
  // Leave as zeros

  // MARS data: 0x00 (off)
  packet[dataStart + versionData + encryptionData + instoptData + threadidData] = 0x00;

  return packet;
}

/** Parse the server's Pre-Login response */
function parsePreLoginResponse(payload: Uint8Array): {
  version?: string;
  tdsVersion?: string;
  encryption?: string;
  encryptionValue?: number;
  instanceName?: string;
  threadId?: number;
  mars?: boolean;
} {
  const result: {
    version?: string;
    tdsVersion?: string;
    encryption?: string;
    encryptionValue?: number;
    instanceName?: string;
    threadId?: number;
    mars?: boolean;
  } = {};

  // Parse option tokens
  let offset = 0;
  const options: Array<{ token: number; dataOffset: number; dataLength: number }> = [];

  while (offset < payload.length) {
    const token = payload[offset];
    if (token === PL_OPTION_TERMINATOR) break;

    const dataOffset = (payload[offset + 1] << 8) | payload[offset + 2];
    const dataLength = (payload[offset + 3] << 8) | payload[offset + 4];
    options.push({ token, dataOffset, dataLength });
    offset += 5;
  }

  for (const opt of options) {
    const data = payload.subarray(opt.dataOffset, opt.dataOffset + opt.dataLength);

    switch (opt.token) {
      case PL_OPTION_VERSION: {
        if (data.length >= 6) {
          const major = data[0];
          const minor = data[1];
          const buildHi = data[2];
          const buildLo = data[3];
          const subBuildHi = data[4];
          const subBuildLo = data[5];
          const build = (buildHi << 8) | buildLo;
          const subBuild = (subBuildHi << 8) | subBuildLo;
          result.version = `${major}.${minor}.${build}.${subBuild}`;
          result.tdsVersion = getTdsVersionLabel(major, minor);
        }
        break;
      }
      case PL_OPTION_ENCRYPTION: {
        if (data.length >= 1) {
          result.encryptionValue = data[0];
          result.encryption = getEncryptionLabel(data[0]);
        }
        break;
      }
      case PL_OPTION_INSTOPT: {
        // Null-terminated string
        let end = 0;
        while (end < data.length && data[end] !== 0) end++;
        if (end > 0) {
          result.instanceName = new TextDecoder().decode(data.subarray(0, end));
        }
        break;
      }
      case PL_OPTION_THREADID: {
        if (data.length >= 4) {
          const view = new DataView(data.buffer, data.byteOffset, 4);
          result.threadId = view.getUint32(0, false);
        }
        break;
      }
      case PL_OPTION_MARS: {
        if (data.length >= 1) {
          result.mars = data[0] !== 0;
        }
        break;
      }
    }
  }

  return result;
}

/** Read exactly N bytes from a socket */
async function readExact(reader: ReadableStreamDefaultReader<Uint8Array>, n: number): Promise<Uint8Array> {
  const buffer = new Uint8Array(n);
  let offset = 0;
  while (offset < n) {
    const { value, done } = await reader.read();
    if (done || !value) throw new Error('Connection closed unexpectedly');
    const toCopy = Math.min(n - offset, value.length);
    buffer.set(value.subarray(0, toCopy), offset);
    offset += toCopy;
  }
  return buffer;
}

/**
 * Handle TDS connectivity test
 * POST /api/tds/connect
 *
 * Sends a TDS Pre-Login packet and parses the server response
 * to extract SQL Server version, encryption support, and MARS capability.
 */
export async function handleTDSConnect(request: Request): Promise<Response> {
  try {
    const { host, port = 1433, timeout = 10000 } = await request.json<{
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
        // Step 1: Send Pre-Login packet
        const preLoginPacket = buildPreLoginPacket();
        await writer.write(preLoginPacket);

        // Step 2: Read TDS response header (8 bytes)
        const header = await readExact(reader, 8);
        const responseType = header[0];
        const responseLength = (header[2] << 8) | header[3];

        if (responseType !== 0x04) {
          // Not a tabular result — might still be a pre-login response
          // Some servers respond with type 0x04 wrapping the pre-login response
        }

        // Step 3: Read the response payload
        const payloadLength = responseLength - 8;
        if (payloadLength <= 0 || payloadLength > 65536) {
          throw new Error(`Invalid response length: ${responseLength}`);
        }
        const payload = await readExact(reader, payloadLength);

        await socket.close();

        // Step 4: Parse the Pre-Login response
        const preLoginInfo = parsePreLoginResponse(payload);

        return {
          success: true,
          host,
          port,
          protocol: 'TDS',
          responseType: `0x${responseType.toString(16).padStart(2, '0')}`,
          ...preLoginInfo,
          message: preLoginInfo.version
            ? `SQL Server ${preLoginInfo.version} detected`
            : 'TDS-compatible server detected',
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
