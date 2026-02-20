/**
 * Oracle TNS (Transparent Network Substrate) Protocol Support for Cloudflare Workers
 * Implements TNS Connect handshake for Oracle Database connectivity testing
 *
 * Connection flow:
 * 1. Client sends TNS Connect packet (type 0x01) with service descriptor string
 * 2. Server responds with Accept (0x02), Refuse (0x04), or Redirect (0x05)
 *
 * TNS Packet Header (8 bytes):
 *   [0-1] Packet Length (big-endian, total including header)
 *   [2-3] Packet Checksum (0x0000)
 *   [4]   Packet Type
 *   [5]   Reserved (0x00)
 *   [6-7] Header Checksum (0x0000)
 *
 * TNS Packet Types:
 *   0x01 CONNECT  0x02 ACCEPT  0x04 REFUSE  0x05 REDIRECT
 *   0x06 DATA     0x0B RESEND  0x0C MARKER
 *
 * TNS Connect Body (50 bytes after header, before connect data):
 *   [8-9]   Version           (0x013C = 316, Oracle 12c+)
 *   [10-11] Compatible Version (0x012C = 300, Oracle 10g+)
 *   [12-13] Service Options   (0x0C41)
 *   [14-15] SDU Size          (8192 = 0x2000)
 *   [16-17] Max TDU Size      (32767 = 0x7FFF)
 *   [18-19] NT Proto Chars    (0x7F08)
 *   [20-21] Line Turnaround   (0)
 *   [22-23] Value of 1 (BE)   (0x0001)
 *   [24-25] Connect Data Len
 *   [26-27] Connect Data Offset (58 = header + body)
 *   [28-31] Max Receivable CD (0)
 *   [32]    Connect Flags 0   (0x41)
 *   [33]    Connect Flags 1   (0x41)
 *   [34-57] Reserved zeros (24 bytes)
 *   [58+]   Connect Data String (ASCII)
 *
 * Spec: Oracle Database Net Services Reference
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// TNS Packet Types
const TNS_CONNECT  = 0x01;
const TNS_ACCEPT   = 0x02;
const TNS_REFUSE   = 0x04;
const TNS_REDIRECT = 0x05;
const TNS_DATA     = 0x06;
const TNS_RESEND   = 0x0b;
const TNS_MARKER   = 0x0c;

function getPacketTypeName(type: number): string {
  switch (type) {
    case TNS_CONNECT:  return 'Connect';
    case TNS_ACCEPT:   return 'Accept';
    case TNS_REFUSE:   return 'Refuse';
    case TNS_REDIRECT: return 'Redirect';
    case TNS_DATA:     return 'Data';
    case TNS_RESEND:   return 'Resend';
    case TNS_MARKER:   return 'Marker';
    default: return `Unknown (0x${type.toString(16).padStart(2, '0')})`;
  }
}

/**
 * Build a TNS Connect packet for the given host, port, and service name.
 */
function buildTNSConnectPacket(host: string, port: number, serviceName: string): Uint8Array {
  const connectData =
    `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${host})(PORT=${port}))` +
    `(CONNECT_DATA=(SERVICE_NAME=${serviceName})` +
    `(CID=(PROGRAM=portofcall)(HOST=cloudflare-worker)(USER=probe))))`;
  const connectDataBytes = new TextEncoder().encode(connectData);

  const headerLen = 8;
  const connectBodyLen = 50;
  const connectDataOffset = headerLen + connectBodyLen;
  const totalLen = connectDataOffset + connectDataBytes.length;

  const packet = new Uint8Array(totalLen);
  const view = new DataView(packet.buffer);

  view.setUint16(0, totalLen, false);
  view.setUint16(2, 0, false);
  packet[4] = TNS_CONNECT;
  packet[5] = 0x00;
  view.setUint16(6, 0, false);

  view.setUint16(8, 316, false);
  view.setUint16(10, 300, false);
  view.setUint16(12, 0x0C41, false);
  view.setUint16(14, 8192, false);
  view.setUint16(16, 32767, false);
  view.setUint16(18, 0x7F08, false);
  view.setUint16(20, 0, false);
  view.setUint16(22, 0x0001, false);
  view.setUint16(24, connectDataBytes.length, false);
  view.setUint16(26, connectDataOffset, false);
  view.setUint32(28, 0, false);
  packet[32] = 0x41;
  packet[33] = 0x41;
  // [34-57] already zero-initialized

  packet.set(connectDataBytes, connectDataOffset);
  return packet;
}

/**
 * Parse a TNS response packet: header + body fields appropriate for each packet type.
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
    result.version = view.getUint16(8, false);
    result.compatibleVersion = view.getUint16(10, false);
    result.serviceOptions = view.getUint16(12, false);
    result.sduSize = view.getUint16(14, false);
    result.tduSize = view.getUint16(16, false);
    result.connectFlags0 = data[26];
    result.connectFlags1 = data[27];
  } else if (packetType === TNS_REFUSE && data.length >= 12) {
    result.refuseReasonUser = data[8];
    result.refuseReasonSystem = data[9];
    const refuseDataLen = view.getUint16(10, false);
    if (refuseDataLen > 0 && data.length >= 12 + refuseDataLen) {
      result.refuseData = new TextDecoder().decode(data.subarray(12, 12 + refuseDataLen));
    }
  } else if (packetType === TNS_REDIRECT && data.length >= 12) {
    const redirectDataLen = view.getUint16(8, false);
    if (redirectDataLen > 0 && data.length >= 10 + redirectDataLen) {
      result.redirectData = new TextDecoder().decode(data.subarray(10, 10 + redirectDataLen));
    }
  }

  return result;
}

/** Extract Oracle version string from TNS refuse/redirect message text */
function extractOracleVersion(text: string): string | null {
  const vsnMatch = text.match(/VSNNUM=(\d+)/);
  if (vsnMatch) {
    const vsnnum = parseInt(vsnMatch[1], 10);
    const major = (vsnnum >> 24) & 0xFF;
    const minor = (vsnnum >> 20) & 0x0F;
    const patch = (vsnnum >> 12) & 0xFF;
    const component = (vsnnum >> 8) & 0x0F;
    const build = vsnnum & 0xFF;
    return `${major}.${minor}.${patch}.${component}.${build}`;
  }
  const verMatch = text.match(/(?:Oracle|version)\s+([\d.]+)/i);
  if (verMatch) return verMatch[1];
  return null;
}

/** Extract Oracle error code (ORA-XXXXX) from TNS refuse data */
function extractErrorCode(text: string): string | null {
  const match = text.match(/\(ERR=(\d+)\)/);
  if (match) return `ORA-${match[1]}`;
  const oraMatch = text.match(/(ORA-\d+)/);
  if (oraMatch) return oraMatch[1];
  return null;
}

/**
 * BufferedReader wraps a ReadableStreamDefaultReader and maintains an internal
 * byte buffer so that read(n) always returns exactly n bytes, even when the
 * underlying stream delivers them in larger chunks. This fixes the hung-connection
 * bug where readBytes(reader, 8) consumed an entire TCP packet and the subsequent
 * readBytes(reader, packetLength - 8) stalled forever waiting for bytes that had
 * already been discarded.
 *
 * readChunk() reads one logical chunk: returns buffered data immediately if any
 * is available, otherwise waits for the next stream chunk. Used for phase 2+
 * reads where the exact response size is unknown.
 */
class BufferedReader {
  private buf = new Uint8Array(0);
  constructor(private reader: ReadableStreamDefaultReader<Uint8Array>) {}

  async read(n: number): Promise<Uint8Array> {
    while (this.buf.length < n) {
      const { value, done } = await this.reader.read();
      if (done || !value) throw new Error('Connection closed before full TNS response received');
      const merged = new Uint8Array(this.buf.length + value.length);
      merged.set(this.buf);
      merged.set(value, this.buf.length);
      this.buf = merged;
    }
    const result = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return result;
  }

  async readChunk(): Promise<{ value: Uint8Array; done: false } | { value: undefined; done: true }> {
    if (this.buf.length > 0) {
      const chunk = this.buf;
      this.buf = new Uint8Array(0);
      return { value: chunk, done: false };
    }
    const { value, done } = await this.reader.read();
    if (done || !value) return { value: undefined, done: true };
    return { value, done: false };
  }
}

/**
 * Perform the TNS connect handshake and return the parsed response.
 * Internal helper shared by multiple handlers.
 */
async function doTNSConnect(
  host: string,
  port: number,
  serviceName: string,
): Promise<{
  parsedResponse: ReturnType<typeof parseTNSResponse>;
  oracleVersion: string | null;
  errorCode: string | null;
}> {
  const socket = connect(`${host}:${port}`);
  await socket.opened;

  const writer = socket.writable.getWriter();
  const buffered = new BufferedReader(socket.readable.getReader());

  try {
    const connectPacket = buildTNSConnectPacket(host, port, serviceName);
    await writer.write(connectPacket);

    // Read header first to learn total packet length
    const headerData = await buffered.read(8);
    const packetLength = (headerData[0] << 8) | headerData[1];

    let fullPacket: Uint8Array;
    if (packetLength > 8) {
      const remaining = await buffered.read(packetLength - 8);
      fullPacket = new Uint8Array(packetLength);
      fullPacket.set(headerData, 0);
      fullPacket.set(remaining, 8);
    } else {
      fullPacket = headerData;
    }

    await socket.close();

    const parsedResponse = parseTNSResponse(fullPacket);
    const textData = parsedResponse.refuseData ?? parsedResponse.redirectData ?? '';
    const oracleVersion = extractOracleVersion(textData);
    const errorCode = extractErrorCode(textData);

    return { parsedResponse, oracleVersion, errorCode };
  } catch (error) {
    await socket.close();
    throw error;
  }
}

// =============================================================================
// Exported Handlers
// =============================================================================

/**
 * Handle Oracle TNS connectivity test.
 * POST /api/oracle-tns/connect
 * Body: { host, port?, serviceName?, timeout? }
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
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const { parsedResponse, oracleVersion, errorCode } =
        await doTNSConnect(host, port, serviceName);
      const latencyMs = Date.now() - startTime;
      const parsed = parsedResponse;

      const result: Record<string, unknown> = {
        success: true,
        host,
        port,
        serviceName,
        protocol: 'Oracle TNS',
        responseType: parsed.packetTypeName,
        latencyMs,
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
        result.listenerDetected = true;
        result.refuseReasonUser = parsed.refuseReasonUser;
        result.refuseReasonSystem = parsed.refuseReasonSystem;
        if (parsed.refuseData) result.refuseData = parsed.refuseData;
        if (oracleVersion) result.oracleVersion = oracleVersion;
        if (errorCode) result.errorCode = errorCode;
        result.message = `Oracle listener refused: ${parsed.refuseData ?? 'unknown reason'}`;
      } else if (parsed.packetType === TNS_REDIRECT) {
        result.accepted = false;
        result.redirected = true;
        result.listenerDetected = true;
        if (parsed.redirectData) result.redirectData = parsed.redirectData;
        if (oracleVersion) result.oracleVersion = oracleVersion;
        result.message = `Oracle listener redirected to: ${parsed.redirectData ?? 'unknown target'}`;
      } else if (parsed.packetType === TNS_RESEND) {
        result.accepted = false;
        result.listenerDetected = true;
        result.message = 'Oracle listener requested packet resend (protocol version mismatch)';
      } else {
        result.accepted = false;
        result.listenerDetected = true;
        result.message = `Unexpected packet type: ${parsed.packetTypeName}`;
      }

      result.rawHeader = parsed.rawHex;
      return result;
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
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle Oracle TNS listener probe.
 * POST /api/oracle-tns/probe
 * Body: { host, port?, timeout? }
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
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const { parsedResponse, oracleVersion } = await doTNSConnect(host, port, '__PROBE__');
      const latencyMs = Date.now() - startTime;
      const packetType = parsedResponse.packetType;
      const isOracle = [TNS_ACCEPT, TNS_REFUSE, TNS_REDIRECT, TNS_RESEND].includes(packetType);

      return {
        success: true,
        host,
        port,
        protocol: 'Oracle TNS',
        isOracle,
        responseType: getPacketTypeName(packetType),
        ...(oracleVersion && { oracleVersion }),
        latencyMs,
        message: isOracle
          ? `Oracle TNS listener detected on ${host}:${port}` +
            (oracleVersion ? ` (Oracle ${oracleVersion})` : '')
          : `Non-Oracle response on ${host}:${port} (type: ${getPacketTypeName(packetType)})`,
      };
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
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle Oracle TNS Query -- connect and parse ACCEPT response for version
 * and capability info, then attempt a minimal ANO negotiation probe.
 *
 * Protocol phases:
 *   1. TNS Connect + parse ACCEPT/REFUSE/REDIRECT
 *   2. If ACCEPT: send minimal ANO Data packet, read server's capabilities response
 *
 * POST /api/oracle-tns/query
 * Body: { host, port?, service?, timeout? }
 *
 * Returns: {
 *   success,
 *   responseType,      -- ACCEPT | REFUSE | REDIRECT | Resend
 *   responseTypeName,
 *   tnsVersion?,       -- negotiated TNS version
 *   sduSize?,          -- accepted Session Data Unit size
 *   dbVersion?,        -- Oracle version string if extractable
 *   serviceName?,
 *   instanceName?,
 *   redirectTo?,       -- redirect address if REDIRECT
 *   refuseReason?,     -- refusal text if REFUSE
 *   latencyMs
 * }
 */
export async function handleOracleQuery(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const {
      host,
      port = 1521,
      service = 'XE',
      timeout = 10000,
    } = await request.json<{
      host: string;
      port?: number;
      service?: string;
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
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const writer = socket.writable.getWriter();
      const buffered = new BufferedReader(socket.readable.getReader());

      try {
        // Phase 1: TNS Connect
        const connectPacket = buildTNSConnectPacket(host, port, service);
        await writer.write(connectPacket);

        const headerData = await buffered.read(8);
        const packetLength = (headerData[0] << 8) | headerData[1];

        let fullPacket: Uint8Array;
        if (packetLength > 8) {
          const remaining = await buffered.read(packetLength - 8);
          fullPacket = new Uint8Array(packetLength);
          fullPacket.set(headerData, 0);
          fullPacket.set(remaining, 8);
        } else {
          fullPacket = headerData;
        }

        const parsed = parseTNSResponse(fullPacket);
        const textData = parsed.refuseData ?? parsed.redirectData ?? '';
        const dbVersion = extractOracleVersion(textData);
        const latencyMs = Date.now() - startTime;

        const result: Record<string, unknown> = {
          success: true,
          host,
          port,
          responseType: parsed.packetType,
          responseTypeName: parsed.packetTypeName,
          latencyMs,
        };

        if (parsed.packetType === TNS_REFUSE) {
          result.success = false;
          if (parsed.refuseData) result.refuseReason = parsed.refuseData;
          if (dbVersion) result.dbVersion = dbVersion;
          await socket.close();
          return result;
        }

        if (parsed.packetType === TNS_REDIRECT) {
          result.success = false;
          if (parsed.redirectData) result.redirectTo = parsed.redirectData;
          if (dbVersion) result.dbVersion = dbVersion;
          await socket.close();
          return result;
        }

        if (parsed.packetType !== TNS_ACCEPT) {
          result.success = false;
          result.note = `Unexpected packet type: ${parsed.packetTypeName}`;
          await socket.close();
          return result;
        }

        // ACCEPT received
        if (parsed.version) result.tnsVersion = parsed.version;
        if (parsed.sduSize) result.sduSize = parsed.sduSize;
        result.serviceName = service;

        // Phase 2: Minimal ANO negotiation Data packet
        // ANO (Advanced Networking Option) negotiation is Oracle's post-ACCEPT
        // service negotiation. We send a minimal request; the server responds
        // with its supported service list and versions.
        const anoPayload = new Uint8Array([
          0x00, 0x28,        // ANO total length: 40 bytes (8-byte ANO header + 4x8-byte service entries); was 0xDE=222 (protocol violation)
          0x00, 0x02,        // version
          0x00, 0x00,        // flags
          0x04,              // service count
          0x00,              // reserved
          // service 0: Authentication
          0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          // service 1: Encryption
          0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          // service 2: Data Integrity
          0x00, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          // service 3: Supervisor
          0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ]);

        const dataTotalLen = 8 + 2 + anoPayload.length;
        const dataPacket = new Uint8Array(dataTotalLen);
        const dataView = new DataView(dataPacket.buffer);
        dataView.setUint16(0, dataTotalLen, false);
        dataView.setUint16(2, 0, false);
        dataPacket[4] = TNS_DATA;
        dataPacket[5] = 0x00;
        dataView.setUint16(6, 0, false);
        dataView.setUint16(8, 0x0000, false);
        dataPacket.set(anoPayload, 10);

        await writer.write(dataPacket);

        let instanceName: string | undefined;
        let responseDbVersion: string | undefined;

        try {
          const dataReadTimeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('data_timeout')), 3000)
          );
          const dataResult = await Promise.race([buffered.readChunk(), dataReadTimeout]);
          if (!dataResult.done && dataResult.value && dataResult.value.length > 10) {
            const dataRespType = dataResult.value[4];
            if (dataRespType === TNS_DATA) {
              const responseText = new TextDecoder('utf-8', { fatal: false })
                .decode(dataResult.value.slice(10));
              responseDbVersion = extractOracleVersion(responseText) ?? undefined;
              const instMatch = responseText.match(/INSTANCE_NAME[=\x00]([A-Za-z0-9_]+)/i);
              if (instMatch) instanceName = instMatch[1];
            }
          }
        } catch {
          // Data response timeout -- ACCEPT alone is sufficient
        }

        if (responseDbVersion) result.dbVersion = responseDbVersion;
        if (instanceName) result.instanceName = instanceName;

        await socket.close();
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
      error: error instanceof Error ? error.message : 'Query failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle Oracle SQL Query attempt.
 *
 * Attempts a staged Oracle login using TNS + minimal TTC (Two-Task Common) protocol:
 *
 *   Phase "connect":   TNS Connect + parse ACCEPT/REFUSE/REDIRECT
 *   Phase "negotiate": Send minimal ANO negotiation packet, read server response
 *   Phase "login":     Send TTI_LOGON (function 0x76) with username/password
 *                      (simplified -- triggers auth challenge or rejection)
 *   Phase "query":     Send TTI_QUERY (function 0x03) with SQL text
 *
 * Full Oracle authentication requires O5LOGON (Diffie-Hellman password exchange)
 * or older O3LOGON, both of which are undocumented and proprietary. This
 * implementation sends minimal well-formed packets; the server will typically
 * respond with an auth challenge or error that reveals capability information.
 *
 * POST /api/oracle-tns/sql
 * Body: { host, port?, username?, password?, service?, query?, timeout? }
 *
 * Returns: {
 *   success,
 *   phase,          -- highest completed: "connect" | "negotiate" | "login" | "query"
 *   tnsVersion?,
 *   sduSize?,
 *   dbVersion?,
 *   loginAccepted?,
 *   queryResult?,
 *   errorCode?,
 *   errorMessage?,
 *   latencyMs
 * }
 */
export async function handleOracleSQLQuery(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const {
      host,
      port = 1521,
      username,
      password,
      service = 'XE',
      query = 'SELECT 1 FROM DUAL',
      timeout = 15000,
    } = await request.json<{
      host: string;
      port?: number;
      username?: string;
      password?: string;
      service?: string;
      query?: string;
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
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const writer = socket.writable.getWriter();
      const buffered = new BufferedReader(socket.readable.getReader());

      const result: Record<string, unknown> = {
        success: false,
        host,
        port,
        service,
        query,
        phase: 'connect',
      };

      try {
        // ── Phase 1: TNS Connect ───────────────────────────────────────────────
        const connectPacket = buildTNSConnectPacket(host, port, service);
        await writer.write(connectPacket);

        const headerData = await buffered.read(8);
        const packetLength = (headerData[0] << 8) | headerData[1];

        let fullPacket: Uint8Array;
        if (packetLength > 8) {
          const remaining = await buffered.read(packetLength - 8);
          fullPacket = new Uint8Array(packetLength);
          fullPacket.set(headerData, 0);
          fullPacket.set(remaining, 8);
        } else {
          fullPacket = headerData;
        }

        const parsed = parseTNSResponse(fullPacket);
        const textData = parsed.refuseData ?? parsed.redirectData ?? '';
        const dbVersion = extractOracleVersion(textData);

        if (parsed.packetType === TNS_REFUSE) {
          result.errorCode = extractErrorCode(textData);
          result.errorMessage = parsed.refuseData ?? 'Connection refused';
          if (dbVersion) result.dbVersion = dbVersion;
          result.latencyMs = Date.now() - startTime;
          await socket.close();
          return result;
        }

        if (parsed.packetType === TNS_REDIRECT) {
          result.errorMessage = `Redirected: ${parsed.redirectData ?? 'unknown'}`;
          if (dbVersion) result.dbVersion = dbVersion;
          result.latencyMs = Date.now() - startTime;
          await socket.close();
          return result;
        }

        if (parsed.packetType !== TNS_ACCEPT) {
          result.errorMessage = `Unexpected packet: ${parsed.packetTypeName}`;
          result.latencyMs = Date.now() - startTime;
          await socket.close();
          return result;
        }

        if (parsed.version) result.tnsVersion = parsed.version;
        if (parsed.sduSize) result.sduSize = parsed.sduSize;

        // ── Phase 2: ANO Negotiation ───────────────────────────────────────────
        const anoPayload = new Uint8Array([
          0x00, 0x28, 0x00, 0x02, 0x00, 0x00, 0x04, 0x00, // ANO length: 40 bytes (was 0xDE=222, protocol violation)
          0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ]);

        const negTotal = 8 + 2 + anoPayload.length;
        const negPacket = new Uint8Array(negTotal);
        const negView = new DataView(negPacket.buffer);
        negView.setUint16(0, negTotal, false);
        negView.setUint16(2, 0, false);
        negPacket[4] = TNS_DATA;
        negPacket[5] = 0x00;
        negView.setUint16(6, 0, false);
        negView.setUint16(8, 0x0000, false);
        negPacket.set(anoPayload, 10);

        await writer.write(negPacket);

        let negDbVersion: string | undefined;
        try {
          const negTimeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('neg_timeout')), 3000)
          );
          const negResult = await Promise.race([buffered.readChunk(), negTimeout]);
          if (!negResult.done && negResult.value && negResult.value.length > 8) {
            const negText = new TextDecoder('utf-8', { fatal: false })
              .decode(negResult.value.slice(8));
            negDbVersion = extractOracleVersion(negText) ?? undefined;
          }
        } catch {
          // Negotiation response timeout -- proceed
        }

        result.phase = 'negotiate';
        if (negDbVersion) result.dbVersion = negDbVersion;

        if (!username || !password) {
          result.success = true;
          result.note = 'Connect and negotiate phases completed. Provide username/password for login.';
          result.latencyMs = Date.now() - startTime;
          await socket.close();
          return result;
        }

        // ── Phase 3: Login Probe ───────────────────────────────────────────────
        const enc = new TextEncoder();
        const userBytes = enc.encode(username);
        const passBytes = enc.encode(password);
        const svcBytes = enc.encode(service);

        // Minimal TTI_LOGON packet (function 0x76):
        //   [0]    function code 0x76
        //   [1]    username length
        //   [2..n] username bytes
        //   [n+1]  password length
        //   [n+2..m] password bytes
        //   [m+1]  service length
        //   [m+2..] service bytes
        const loginPayload = new Uint8Array(
          1 + 1 + userBytes.length + 1 + passBytes.length + 1 + svcBytes.length
        );
        let lOff = 0;
        loginPayload[lOff++] = 0x76;
        loginPayload[lOff++] = userBytes.length & 0xff;
        loginPayload.set(userBytes, lOff); lOff += userBytes.length;
        loginPayload[lOff++] = passBytes.length & 0xff;
        loginPayload.set(passBytes, lOff); lOff += passBytes.length;
        loginPayload[lOff++] = svcBytes.length & 0xff;
        loginPayload.set(svcBytes, lOff);

        const loginTotalLen = 8 + 2 + loginPayload.length;
        const loginPacket = new Uint8Array(loginTotalLen);
        const loginView = new DataView(loginPacket.buffer);
        loginView.setUint16(0, loginTotalLen, false);
        loginView.setUint16(2, 0, false);
        loginPacket[4] = TNS_DATA;
        loginPacket[5] = 0x00;
        loginView.setUint16(6, 0, false);
        loginView.setUint16(8, 0x0000, false);
        loginPacket.set(loginPayload, 10);

        await writer.write(loginPacket);

        let loginAccepted = false;
        let loginError: string | undefined;

        try {
          const loginTimeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('login_timeout')), 5000)
          );
          const loginResult = await Promise.race([buffered.readChunk(), loginTimeout]);
          if (!loginResult.done && loginResult.value && loginResult.value.length >= 8) {
            const respType = loginResult.value[4];
            if (respType === TNS_DATA) {
              loginAccepted = true;
              result.phase = 'login';
              if (loginResult.value.length > 10) {
                const respText = new TextDecoder('utf-8', { fatal: false })
                  .decode(loginResult.value.slice(10));
                const errCode = extractErrorCode(respText);
                if (errCode) {
                  loginError = errCode;
                  loginAccepted = false;
                }
              }
            } else if (respType === TNS_MARKER) {
              loginError = 'Login rejected (TNS Marker received)';
            } else {
              loginError = `Unexpected response: ${getPacketTypeName(respType)}`;
            }
          }
        } catch {
          loginError = 'Timeout waiting for login response';
        }

        result.loginAccepted = loginAccepted;
        if (loginError) result.errorMessage = loginError;

        if (!loginAccepted) {
          result.latencyMs = Date.now() - startTime;
          await socket.close();
          return result;
        }

        // ── Phase 4: Query ─────────────────────────────────────────────────────
        const queryEnc = enc.encode(query);
        const queryPayload = new Uint8Array(1 + 1 + queryEnc.length);
        queryPayload[0] = 0x03;  // TTI_QUERY
        queryPayload[1] = queryEnc.length & 0xff;
        queryPayload.set(queryEnc, 2);

        const queryTotalLen = 8 + 2 + queryPayload.length;
        const queryPacket = new Uint8Array(queryTotalLen);
        const queryView = new DataView(queryPacket.buffer);
        queryView.setUint16(0, queryTotalLen, false);
        queryView.setUint16(2, 0, false);
        queryPacket[4] = TNS_DATA;
        queryPacket[5] = 0x00;
        queryView.setUint16(6, 0, false);
        queryView.setUint16(8, 0x0000, false);
        queryPacket.set(queryPayload, 10);

        await writer.write(queryPacket);

        try {
          const queryTimeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('query_timeout')), 5000)
          );
          const queryResult = await Promise.race([buffered.readChunk(), queryTimeout]);
          if (!queryResult.done && queryResult.value && queryResult.value.length > 10) {
            const qRespText = new TextDecoder('utf-8', { fatal: false })
              .decode(queryResult.value.slice(10));
            result.queryResult = qRespText.replace(/\x00/g, '').trim().slice(0, 512);
            result.phase = 'query';
            result.success = true;
          }
        } catch {
          result.note = 'Query phase timed out -- login may have succeeded but query was not executed';
        }

        result.latencyMs = Date.now() - startTime;
        await socket.close();
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
      error: error instanceof Error ? error.message : 'SQL query failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
