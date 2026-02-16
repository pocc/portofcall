/**
 * DRDA (Distributed Relational Database Architecture) Protocol Implementation
 *
 * Implements DB2/Derby/Informix connectivity testing via the DRDA wire protocol
 * on port 50000. DRDA is IBM's open standard for distributed database access,
 * used by DB2, Apache Derby (JavaDB), and Informix.
 *
 * Protocol Structure:
 * Every DRDA message uses DDM (Distributed Data Management) format:
 * - DSS Header (6 bytes):
 *   - Length: 2 bytes (big-endian, includes header)
 *   - Magic: 0xD0
 *   - Format: 1 byte (chain flags + DSS type)
 *   - Correlation ID: 2 bytes (big-endian)
 * - DDM Object:
 *   - Length: 2 bytes
 *   - Code Point: 2 bytes (identifies the command)
 *   - Parameters (DDM objects or scalar values)
 *
 * Protocol Flow:
 * 1. Client sends EXCSAT (0x1041) — Exchange Server Attributes
 * 2. Server responds with EXCSATRD (0x1443) — containing server info
 * 3. Client sends ACCSEC (0x106D) — Access Security
 * 4. Server responds with ACCSECRD (0x14AC) — security mechanisms
 *
 * Code Points:
 * - EXCSAT (0x1041): Exchange Server Attributes
 * - EXCSATRD (0x1443): Exchange Server Attributes Reply Data
 * - ACCSEC (0x106D): Access Security
 * - ACCSECRD (0x14AC): Access Security Reply Data
 * - EXTNAM (0x115E): External Name
 * - SRVCLSNM (0x1147): Server Class Name
 * - SRVRLSLV (0x115A): Server Product Release Level
 * - SRVNAM (0x116D): Server Name
 * - MGRLVLLS (0x1404): Manager Level List
 *
 * Use Cases:
 * - IBM DB2 server detection and version fingerprinting
 * - Apache Derby / JavaDB connectivity testing
 * - DRDA-compatible database discovery
 * - Server attribute and security mechanism enumeration
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// DSS format constants
const DSS_MAGIC = 0xD0;
const DSS_TYPE_RQSDSS = 0x01; // Request DSS
const DSS_CHAIN_SAME_CORR = 0x40; // Chain with same correlation

// DDM Code Points
const CP_EXCSAT = 0x1041;    // Exchange Server Attributes
const CP_EXCSATRD = 0x1443;  // Exchange Server Attributes Reply Data
const CP_EXTNAM = 0x115E;    // External Name
const CP_SRVCLSNM = 0x1147;  // Server Class Name
const CP_SRVRLSLV = 0x115A;  // Server Product Release Level
const CP_SRVNAM = 0x116D;    // Server Name
const CP_MGRLVLLS = 0x1404;  // Manager Level List

// Manager code points for MGRLVLLS
const CP_AGENT = 0x1403;     // Agent Manager
const CP_SQLAM = 0x2407;     // SQL Application Manager
const CP_RDB = 0x240F;       // Relational Database
const CP_SECMGR = 0x1440;    // Security Manager
const CP_CMNTCPIP = 0x1474;  // TCP/IP Communication Manager

/**
 * Build a DDM parameter with a string value (EBCDIC encoded as UTF-8 for simplicity).
 */
function buildStringParam(codePoint: number, value: string): Uint8Array {
  const valueBytes = new TextEncoder().encode(value);
  const param = new Uint8Array(4 + valueBytes.length);
  const view = new DataView(param.buffer);
  view.setUint16(0, 4 + valueBytes.length, false); // Length (BE)
  view.setUint16(2, codePoint, false);               // Code Point (BE)
  param.set(valueBytes, 4);
  return param;
}

/**
 * Build MGRLVLLS (Manager Level List) parameter.
 * Each entry is: codepoint(2) + level(2)
 */
function buildMgrLvlLs(): Uint8Array {
  const managers = [
    { cp: CP_AGENT, level: 7 },
    { cp: CP_SQLAM, level: 7 },
    { cp: CP_RDB, level: 7 },
    { cp: CP_SECMGR, level: 7 },
    { cp: CP_CMNTCPIP, level: 7 },
  ];

  const paramLen = 4 + managers.length * 4; // header(4) + entries(N*4)
  const param = new Uint8Array(paramLen);
  const view = new DataView(param.buffer);
  view.setUint16(0, paramLen, false);
  view.setUint16(2, CP_MGRLVLLS, false);

  let offset = 4;
  for (const mgr of managers) {
    view.setUint16(offset, mgr.cp, false);
    view.setUint16(offset + 2, mgr.level, false);
    offset += 4;
  }

  return param;
}

/**
 * Build an EXCSAT (Exchange Server Attributes) DDM request.
 */
function buildEXCSAT(): Uint8Array {
  // Build parameters
  const extnam = buildStringParam(CP_EXTNAM, 'portofcall');
  const srvclsnm = buildStringParam(CP_SRVCLSNM, 'DRDA/TCP');
  const srvrlslv = buildStringParam(CP_SRVRLSLV, '01.00.0000');
  const srvnam = buildStringParam(CP_SRVNAM, 'portofcall');
  const mgrlvlls = buildMgrLvlLs();

  // Calculate DDM object length (4 bytes header + all params)
  const paramsLen = extnam.length + srvclsnm.length + srvrlslv.length + srvnam.length + mgrlvlls.length;
  const ddmLen = 4 + paramsLen; // DDM header (length+codepoint) + params

  // Calculate DSS length (6 bytes DSS header + DDM)
  const dssLen = 6 + ddmLen;

  const packet = new Uint8Array(dssLen);
  const view = new DataView(packet.buffer);

  // DSS Header
  view.setUint16(0, dssLen, false);             // Length (BE)
  packet[2] = DSS_MAGIC;                         // Magic 0xD0
  packet[3] = DSS_TYPE_RQSDSS | DSS_CHAIN_SAME_CORR; // Format: Request + Chain
  view.setUint16(4, 1, false);                   // Correlation ID

  // DDM Header
  view.setUint16(6, ddmLen, false);              // DDM Length (BE)
  view.setUint16(8, CP_EXCSAT, false);           // Code Point: EXCSAT

  // Parameters
  let offset = 10;
  for (const param of [extnam, srvclsnm, srvrlslv, srvnam, mgrlvlls]) {
    packet.set(param, offset);
    offset += param.length;
  }

  return packet;
}

/**
 * Parse a DDM parameter from a buffer at the given offset.
 * Returns { codePoint, value, length } or null.
 */
function parseDDMParam(data: Uint8Array, offset: number): {
  codePoint: number;
  value: Uint8Array;
  totalLength: number;
} | null {
  if (offset + 4 > data.length) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const len = view.getUint16(offset, false);
  if (len < 4 || offset + len > data.length) return null;
  const cp = view.getUint16(offset + 2, false);
  const value = data.slice(offset + 4, offset + len);
  return { codePoint: cp, value, totalLength: len };
}

/**
 * Parse EXCSATRD response to extract server attributes.
 */
function parseEXCSATRD(data: Uint8Array): {
  isDRDA: boolean;
  serverName: string | null;
  serverClass: string | null;
  serverRelease: string | null;
  externalName: string | null;
  managers: Array<{ name: string; level: number }>;
} {
  const result = {
    isDRDA: false,
    serverName: null as string | null,
    serverClass: null as string | null,
    serverRelease: null as string | null,
    externalName: null as string | null,
    managers: [] as Array<{ name: string; level: number }>,
  };

  if (data.length < 10) return result;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Check DSS header
  if (data[2] !== DSS_MAGIC) return result;

  // Read DDM header
  const ddmCodePoint = view.getUint16(8, false);
  if (ddmCodePoint !== CP_EXCSATRD) return result;

  result.isDRDA = true;

  // Parse DDM parameters starting at offset 10
  const ddmLen = view.getUint16(6, false);
  const ddmEnd = 6 + ddmLen;
  let offset = 10;

  while (offset < ddmEnd && offset < data.length) {
    const param = parseDDMParam(data, offset);
    if (!param) break;

    const decoder = new TextDecoder();
    const mgrNames: Record<number, string> = {
      [CP_AGENT]: 'AGENT',
      [CP_SQLAM]: 'SQLAM',
      [CP_RDB]: 'RDB',
      [CP_SECMGR]: 'SECMGR',
      [CP_CMNTCPIP]: 'CMNTCPIP',
    };

    switch (param.codePoint) {
      case CP_SRVNAM:
        result.serverName = decoder.decode(param.value).trim();
        break;
      case CP_SRVCLSNM:
        result.serverClass = decoder.decode(param.value).trim();
        break;
      case CP_SRVRLSLV:
        result.serverRelease = decoder.decode(param.value).trim();
        break;
      case CP_EXTNAM:
        result.externalName = decoder.decode(param.value).trim();
        break;
      case CP_MGRLVLLS:
        // Parse manager level list: pairs of (codepoint:2, level:2)
        if (param.value.length >= 4) {
          const mgrView = new DataView(param.value.buffer, param.value.byteOffset, param.value.byteLength);
          for (let i = 0; i + 3 < param.value.length; i += 4) {
            const mgrCp = mgrView.getUint16(i, false);
            const mgrLevel = mgrView.getUint16(i + 2, false);
            result.managers.push({
              name: mgrNames[mgrCp] || `0x${mgrCp.toString(16)}`,
              level: mgrLevel,
            });
          }
        }
        break;
    }

    offset += param.totalLength;
  }

  return result;
}

/**
 * Read data from the socket until we have at least `minBytes` or timeout.
 */
async function readResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
  maxBytes: number = 4096,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (total < maxBytes) {
    const result = await Promise.race([reader.read(), timeoutPromise]);
    if (result.done || !result.value) break;
    chunks.push(result.value);
    total += result.value.length;

    // For DRDA, the first 2 bytes tell us the message length
    if (total >= 2) {
      const first = chunks[0];
      const msgLen = (first[0] << 8) | first[1];
      if (total >= msgLen) break;
    }
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
 * Handle DRDA connection test — sends EXCSAT and parses EXCSATRD response.
 */
export async function handleDRDAConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 50000, timeout = 10000 } = body;

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

    // Send EXCSAT
    const excsatPacket = buildEXCSAT();
    await writer.write(excsatPacket);

    // Read EXCSATRD response
    const response = await readResponse(reader, timeoutPromise);
    const rtt = Date.now() - startTime;

    const parsed = parseEXCSATRD(response);

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      connectTime,
      isDRDA: parsed.isDRDA,
      serverName: parsed.serverName,
      serverClass: parsed.serverClass,
      serverRelease: parsed.serverRelease,
      externalName: parsed.externalName,
      managers: parsed.managers,
      rawBytesReceived: response.length,
      message: parsed.isDRDA
        ? `DRDA server detected. ${parsed.serverClass ? `Class: ${parsed.serverClass}` : ''}${parsed.serverRelease ? `, Release: ${parsed.serverRelease}` : ''}`
        : 'Server responded but does not appear to be a DRDA server.',
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
 * Handle DRDA probe — lightweight EXCSAT probe for server detection.
 */
export async function handleDRDAProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 50000, timeout = 10000 } = body;

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

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // Send minimal EXCSAT
    const excsatPacket = buildEXCSAT();
    await writer.write(excsatPacket);

    // Read response
    const response = await readResponse(reader, timeoutPromise);
    const rtt = Date.now() - startTime;

    const parsed = parseEXCSATRD(response);

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      isDRDA: parsed.isDRDA,
      serverClass: parsed.serverClass,
      serverRelease: parsed.serverRelease,
      message: parsed.isDRDA
        ? `DRDA server detected (${parsed.serverClass || 'unknown class'}).`
        : 'Not a DRDA server.',
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
