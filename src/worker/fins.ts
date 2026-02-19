/**
 * Omron FINS/TCP Protocol Implementation
 *
 * FINS (Factory Interface Network Service) is Omron's proprietary protocol for
 * communication with CJ, CS, CP, and NX-series PLCs. Default port is 9600.
 *
 * FINS/TCP Framing (all big-endian):
 *   Header: "FINS" (4 bytes magic: 0x46494E53)
 *   Length: (4 bytes) byte count from Command field onward (total frame size - 8)
 *   Command: (4 bytes) FINS/TCP command code
 *   Error Code: (4 bytes) 0 = success
 *   [Data payload]
 *
 * FINS/TCP Commands:
 *   0x00000000 - Client Node Address Data Send (initial handshake)
 *   0x00000001 - Server Node Address Data Send (handshake response)
 *   0x00000002 - FINS Frame Send (carries FINS command frames)
 *
 * FINS Command Frame (inside FINS/TCP frame):
 *   ICF (1) | RSV (1) | GCT (1) | DNA (1) | DA1 (1) | DA2 (1)
 *   SNA (1) | SA1 (1) | SA2 (1) | SID (1) | MRC (1) | SRC (1) | [Data]
 *
 * Use Cases:
 * - Omron PLC discovery and identification
 * - ICS/SCADA network inventory
 * - Industrial device connectivity testing
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// FINS/TCP magic bytes: "FINS"
const FINS_MAGIC = new Uint8Array([0x46, 0x49, 0x4E, 0x53]);

// FINS/TCP commands
const CMD_CLIENT_NODE_ADDR = 0x00000000; // Client → Server: node address request
const CMD_FINS_FRAME = 0x00000002;       // Carries a FINS command frame

// FINS command codes (MRC + SRC)
const MRC_CONTROLLER_DATA_READ = 0x05;   // Read controller data
const SRC_CONTROLLER_MODEL = 0x01;       // Sub: read controller model
const SRC_CONTROLLER_STATUS = 0x02;      // Sub: read controller status

// Memory Area Read/Write commands (MRC 0x01 is shared; SRC differentiates read vs write)
const MRC_MEMORY_AREA = 0x01;            // Main: Memory Area operations
const SRC_MEMORY_AREA_READ = 0x01;       // Sub: Memory Area Read
const SRC_MEMORY_AREA_WRITE = 0x02;      // Sub: Memory Area Write

// Memory area codes (from FINS command reference)
const MEMORY_AREAS: Record<string, number> = {
  DM:  0x82,  // Data Memory (word access)
  CIO: 0xB0,  // Core I/O (word access)
  W:   0xB1,  // Work Area (word access)
  H:   0xB2,  // Holding Area (word access)
  AR:  0xB3,  // Auxiliary Relay Area (word access)
};

// FINS ICF flags
const ICF_COMMAND = 0x80;  // Command (not response)
const ICF_NEEDS_RESPONSE = 0x00; // Response required

interface FINSRequest {
  host: string;
  port?: number;
  timeout?: number;
  clientNode?: number;
}

interface FINSControllerInfo {
  model?: string;
  version?: string;
  cpuType?: string;
  status?: string;
  fatalError?: boolean;
  nonFatalError?: boolean;
  mode?: string;
}

interface FINSResponse {
  success: boolean;
  host: string;
  port: number;
  rtt: number;
  connectTime?: number;
  serverNode?: number;
  clientNode?: number;
  controllerInfo?: FINSControllerInfo;
  error?: string;
}

/**
 * Build a FINS/TCP header frame
 */
function buildFINSTCPFrame(command: number, errorCode: number, data: Uint8Array): Uint8Array {
  const totalLength = 16 + data.length; // 16-byte header + data
  const frame = new Uint8Array(totalLength);
  const view = new DataView(frame.buffer);

  // Magic: "FINS"
  frame.set(FINS_MAGIC, 0);
  // Length: bytes from Command field onward (totalLength minus the 8-byte prefix of magic + length)
  view.setUint32(4, totalLength - 8, false); // big-endian
  // Command
  view.setUint32(8, command, false);
  // Error Code
  view.setUint32(12, errorCode, false);
  // Data
  if (data.length > 0) {
    frame.set(data, 16);
  }

  return frame;
}

/**
 * Build the initial node address request.
 * Client sends its desired node (0 = auto-assign).
 */
function buildNodeAddressRequest(clientNode: number): Uint8Array {
  const data = new Uint8Array(4);
  const view = new DataView(data.buffer);
  // Client node address (4 bytes, 0 = request auto-assignment)
  view.setUint32(0, clientNode, false);

  return buildFINSTCPFrame(CMD_CLIENT_NODE_ADDR, 0, data);
}

/**
 * Build a FINS command frame for Controller Data Read (0501)
 * This reads the controller model/type info.
 */
function buildControllerReadCommand(
  destNode: number,
  srcNode: number,
  mrc: number,
  src: number,
): Uint8Array {
  // FINS command header (10 bytes) + command code (2 bytes) = 12 bytes
  const finsCmd = new Uint8Array(12);

  // ICF: Command, response required
  finsCmd[0] = ICF_COMMAND | ICF_NEEDS_RESPONSE;
  // RSV: Reserved
  finsCmd[1] = 0x00;
  // GCT: Gateway count (2 = default, max hops)
  finsCmd[2] = 0x02;
  // DNA: Destination network address (0 = local)
  finsCmd[3] = 0x00;
  // DA1: Destination node address
  finsCmd[4] = destNode & 0xFF;
  // DA2: Destination unit address (0 = CPU)
  finsCmd[5] = 0x00;
  // SNA: Source network address (0 = local)
  finsCmd[6] = 0x00;
  // SA1: Source node address
  finsCmd[7] = srcNode & 0xFF;
  // SA2: Source unit address (0 = CPU)
  finsCmd[8] = 0x00;
  // SID: Service ID (arbitrary)
  finsCmd[9] = 0x01;
  // MRC: Main Request Code
  finsCmd[10] = mrc;
  // SRC: Sub Request Code
  finsCmd[11] = src;

  return buildFINSTCPFrame(CMD_FINS_FRAME, 0, finsCmd);
}

/**
 * Parse a FINS/TCP frame from raw data
 */
function parseFINSTCPFrame(data: Uint8Array): {
  command: number;
  errorCode: number;
  payload: Uint8Array;
} | null {
  if (data.length < 16) return null;

  // Verify magic
  if (data[0] !== 0x46 || data[1] !== 0x49 || data[2] !== 0x4E || data[3] !== 0x53) {
    return null;
  }

  const view = new DataView(data.buffer, data.byteOffset, data.length);
  const lengthField = view.getUint32(4, false); // bytes from Command field onward
  const totalFrameSize = lengthField + 8;        // add magic(4) + length(4)
  const command = view.getUint32(8, false);
  const errorCode = view.getUint32(12, false);

  if (data.length < totalFrameSize) return null;

  const payload = data.slice(16, totalFrameSize);
  return { command, errorCode, payload };
}

/**
 * Parse node address response
 */
function parseNodeAddressResponse(payload: Uint8Array): {
  clientNode: number;
  serverNode: number;
} | null {
  if (payload.length < 8) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.length);
  // Server response payload: client node (4 bytes) + server node (4 bytes)
  return {
    clientNode: view.getUint32(0, false),
    serverNode: view.getUint32(4, false),
  };
}

/**
 * Parse FINS command response for Controller Data Read
 */
function parseControllerDataResponse(payload: Uint8Array): FINSControllerInfo {
  const info: FINSControllerInfo = {};

  if (payload.length < 14) return info;

  // FINS response layout after 10-byte header:
  //   Offset 10-11: MRC/SRC echo (command code)
  //   Offset 12-13: MRES/SRES (end codes, 0x0000 = success)
  const mrc = payload[10]; // Main Request Code (echoed back)
  const src = payload[11]; // Sub Request Code (echoed back)
  const endCode1 = payload[12]; // End code main (MRES)
  const endCode2 = payload[13]; // End code sub (SRES)

  if (endCode1 !== 0x00 || endCode2 !== 0x00) {
    info.status = `Error: end code ${endCode1.toString(16).padStart(2, '0')}${endCode2.toString(16).padStart(2, '0')}`;
    return info;
  }

  // For 0501 (Controller Model Read), response data starts at offset 14
  if (mrc === MRC_CONTROLLER_DATA_READ && src === SRC_CONTROLLER_MODEL) {
    const responseData = payload.slice(14);
    // Controller model is ASCII string, null-padded
    const modelEnd = responseData.indexOf(0);
    const modelStr = new TextDecoder().decode(
      modelEnd >= 0 ? responseData.slice(0, modelEnd) : responseData
    );
    info.model = modelStr.trim();
  }

  // For 0502 (Controller Status Read)
  if (mrc === MRC_CONTROLLER_DATA_READ && src === SRC_CONTROLLER_STATUS) {
    const responseData = payload.slice(14);
    if (responseData.length >= 1) {
      const status = responseData[0];
      info.fatalError = !!(status & 0x01);
      info.nonFatalError = !!(status & 0x02);
      const modeVal = (status >> 4) & 0x0F;
      switch (modeVal) {
        case 0x00: info.mode = 'Program'; break;
        case 0x02: info.mode = 'Monitor'; break;
        case 0x04: info.mode = 'Run'; break;
        default: info.mode = `Unknown (0x${modeVal.toString(16)})`;
      }
    }
  }

  return info;
}

/**
 * Read a complete FINS/TCP frame from the socket
 */
async function readFINSFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
  maxSize: number = 4096,
): Promise<Uint8Array | null> {
  let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

  while (buffer.length < maxSize) {
    const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
    if (done || !value) return buffer.length > 0 ? new Uint8Array(buffer) : null;

    const newBuffer = new Uint8Array(buffer.length + value.length);
    newBuffer.set(buffer);
    newBuffer.set(value, buffer.length);
    buffer = newBuffer;

    // Check if we have a complete FINS/TCP frame
    if (buffer.length >= 8) {
      // Verify magic
      if (buffer[0] !== 0x46 || buffer[1] !== 0x49 || buffer[2] !== 0x4E || buffer[3] !== 0x53) {
        // Not a FINS frame - return what we have
        return new Uint8Array(buffer);
      }
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);
      const lengthField = view.getUint32(4, false);  // bytes from Command field onward
      const totalFrameSize = lengthField + 8;          // add magic(4) + length(4)
      if (buffer.length >= totalFrameSize) {
        return new Uint8Array(buffer.slice(0, totalFrameSize));
      }
    }
  }

  return buffer.length > 0 ? new Uint8Array(buffer) : null;
}

/**
 * Probe an Omron FINS device — performs node address exchange and reads controller info
 * POST /api/fins/connect
 */
export async function handleFINSConnect(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const body = await request.json() as FINSRequest;
    const { host, port = 9600, timeout = 10000, clientNode = 0 } = body;

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
      const connectTime = Date.now() - startTime;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), timeout)
      );

      try {
        // Step 1: Send node address request
        const nodeReq = buildNodeAddressRequest(clientNode);
        await writer.write(nodeReq);

        // Read node address response
        const nodeResp = await readFINSFrame(reader, timeoutPromise);
        if (!nodeResp) {
          throw new Error('No response to node address request');
        }

        const nodeFrame = parseFINSTCPFrame(nodeResp);
        if (!nodeFrame) {
          throw new Error('Invalid FINS/TCP frame in node address response');
        }

        if (nodeFrame.errorCode !== 0) {
          throw new Error(`FINS/TCP error: 0x${nodeFrame.errorCode.toString(16).padStart(8, '0')}`);
        }

        const nodeAddrs = parseNodeAddressResponse(nodeFrame.payload);
        if (!nodeAddrs) {
          throw new Error('Failed to parse node address response');
        }

        const result: FINSResponse = {
          success: true,
          host,
          port,
          rtt: Date.now() - startTime,
          connectTime,
          serverNode: nodeAddrs.serverNode,
          clientNode: nodeAddrs.clientNode,
        };

        // Step 2: Try to read controller model (0501)
        try {
          const modelCmd = buildControllerReadCommand(
            nodeAddrs.serverNode,
            nodeAddrs.clientNode,
            MRC_CONTROLLER_DATA_READ,
            SRC_CONTROLLER_MODEL,
          );
          await writer.write(modelCmd);

          const modelResp = await readFINSFrame(reader, timeoutPromise);
          if (modelResp) {
            const modelFrame = parseFINSTCPFrame(modelResp);
            if (modelFrame && modelFrame.errorCode === 0) {
              result.controllerInfo = parseControllerDataResponse(modelFrame.payload);
            }
          }
        } catch {
          // Controller read failed, but handshake succeeded
        }

        // Step 3: Try to read controller status (0502)
        try {
          const statusCmd = buildControllerReadCommand(
            nodeAddrs.serverNode,
            nodeAddrs.clientNode,
            MRC_CONTROLLER_DATA_READ,
            SRC_CONTROLLER_STATUS,
          );
          await writer.write(statusCmd);

          const statusResp = await readFINSFrame(reader, timeoutPromise);
          if (statusResp) {
            const statusFrame = parseFINSTCPFrame(statusResp);
            if (statusFrame && statusFrame.errorCode === 0) {
              const statusInfo = parseControllerDataResponse(statusFrame.payload);
              if (result.controllerInfo) {
                result.controllerInfo.mode = statusInfo.mode;
                result.controllerInfo.fatalError = statusInfo.fatalError;
                result.controllerInfo.nonFatalError = statusInfo.nonFatalError;
              } else {
                result.controllerInfo = statusInfo;
              }
            }
          }
        } catch {
          // Status read failed, but handshake succeeded
        }

        result.rtt = Date.now() - startTime;

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return result;
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        throw error;
      }
    })();

    const globalTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const result = await Promise.race([connectionPromise, globalTimeout]);
    return new Response(JSON.stringify(result), {
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
 * Build a FINS Memory Area Read command frame (MRC=0x01, SRC=0x01)
 *
 * Command data layout (after 12-byte FINS header):
 *   Memory Area Code (1) | Begin Address (2 BE) | Bit Position (1) | Item Count (2 BE)
 */
function buildMemoryAreaReadCommand(
  destNode: number,
  srcNode: number,
  memoryAreaCode: number,
  address: number,
  bitPosition: number,
  itemCount: number,
): Uint8Array {
  // FINS header (10 bytes) + MRC/SRC (2 bytes) + command data (6 bytes) = 18 bytes
  const finsCmd = new Uint8Array(18);

  // FINS command header
  finsCmd[0] = ICF_COMMAND | ICF_NEEDS_RESPONSE;
  finsCmd[1] = 0x00; // RSV
  finsCmd[2] = 0x02; // GCT
  finsCmd[3] = 0x00; // DNA (local network)
  finsCmd[4] = destNode & 0xFF; // DA1
  finsCmd[5] = 0x00; // DA2 (CPU unit)
  finsCmd[6] = 0x00; // SNA
  finsCmd[7] = srcNode & 0xFF; // SA1
  finsCmd[8] = 0x00; // SA2
  finsCmd[9] = 0x02; // SID
  finsCmd[10] = MRC_MEMORY_AREA; // MRC = 0x01
  finsCmd[11] = SRC_MEMORY_AREA_READ; // SRC = 0x01

  // Memory area code
  finsCmd[12] = memoryAreaCode & 0xFF;
  // Begin address (2 bytes, big-endian)
  finsCmd[13] = (address >> 8) & 0xFF;
  finsCmd[14] = address & 0xFF;
  // Bit/element position (0x00 for word access)
  finsCmd[15] = bitPosition & 0xFF;
  // Item count (2 bytes, big-endian)
  finsCmd[16] = (itemCount >> 8) & 0xFF;
  finsCmd[17] = itemCount & 0xFF;

  return buildFINSTCPFrame(CMD_FINS_FRAME, 0, finsCmd);
}

/**
 * Parse a FINS Memory Area Read response payload.
 *
 * After the 10-byte FINS header + MRC/SRC + 2 end-code bytes (offset 14),
 * the remaining data is word values (2 bytes each, big-endian).
 */
function parseMemoryAreaReadResponse(payload: Uint8Array): {
  endCode: string;
  data: number[];
  hex: string[];
} {
  // payload starts at FINS header byte 0
  if (payload.length < 14) {
    return { endCode: 'PAYLOAD_TOO_SHORT', data: [], hex: [] };
  }

  const endCode1 = payload[12];
  const endCode2 = payload[13];
  const endCodeStr = `${endCode1.toString(16).padStart(2, '0')}${endCode2.toString(16).padStart(2, '0')}`.toUpperCase();

  if (endCode1 !== 0x00 || endCode2 !== 0x00) {
    return { endCode: endCodeStr, data: [], hex: [] };
  }

  // Words start at offset 14
  const wordData = payload.slice(14);
  const data: number[] = [];
  const hex: string[] = [];

  for (let i = 0; i + 1 < wordData.length; i += 2) {
    const word = (wordData[i] << 8) | wordData[i + 1];
    data.push(word);
    hex.push(`0x${word.toString(16).padStart(4, '0').toUpperCase()}`);
  }

  return { endCode: endCodeStr, data, hex };
}

/**
 * Build a FINS Memory Area Write command frame (MRC=0x01, SRC=0x02)
 *
 * Command data layout (after 12-byte FINS header):
 *   Memory Area Code (1) | Begin Address (2 BE) | Bit Position (1) | Item Count (2 BE) | Data (itemCount * 2 bytes)
 */
function buildMemoryAreaWriteCommand(
  destNode: number,
  srcNode: number,
  memoryAreaCode: number,
  address: number,
  bitPosition: number,
  words: number[],
): Uint8Array {
  const itemCount = words.length;
  // FINS header (10) + MRC/SRC (2) + area(1) + addr(2) + bit(1) + count(2) + data(itemCount*2)
  const finsCmd = new Uint8Array(18 + itemCount * 2);

  finsCmd[0] = ICF_COMMAND | ICF_NEEDS_RESPONSE;
  finsCmd[1] = 0x00; // RSV
  finsCmd[2] = 0x02; // GCT
  finsCmd[3] = 0x00; // DNA
  finsCmd[4] = destNode & 0xFF; // DA1
  finsCmd[5] = 0x00; // DA2
  finsCmd[6] = 0x00; // SNA
  finsCmd[7] = srcNode & 0xFF; // SA1
  finsCmd[8] = 0x00; // SA2
  finsCmd[9] = 0x03; // SID
  finsCmd[10] = MRC_MEMORY_AREA;  // MRC = 0x01
  finsCmd[11] = SRC_MEMORY_AREA_WRITE; // SRC = 0x02

  finsCmd[12] = memoryAreaCode & 0xFF;
  finsCmd[13] = (address >> 8) & 0xFF;
  finsCmd[14] = address & 0xFF;
  finsCmd[15] = bitPosition & 0xFF;
  finsCmd[16] = (itemCount >> 8) & 0xFF;
  finsCmd[17] = itemCount & 0xFF;

  for (let i = 0; i < itemCount; i++) {
    finsCmd[18 + i * 2] = (words[i] >> 8) & 0xFF;
    finsCmd[18 + i * 2 + 1] = words[i] & 0xFF;
  }

  return buildFINSTCPFrame(CMD_FINS_FRAME, 0, finsCmd);
}

/**
 * Parse a FINS Memory Area Write response payload.
 * Success: end code 0000. Failure: non-zero end code.
 */
function parseMemoryAreaWriteResponse(payload: Uint8Array): { endCode: string; success: boolean } {
  if (payload.length < 14) return { endCode: 'PAYLOAD_TOO_SHORT', success: false };
  const endCode1 = payload[12];
  const endCode2 = payload[13];
  const endCodeStr = `${endCode1.toString(16).padStart(2, '0')}${endCode2.toString(16).padStart(2, '0')}`.toUpperCase();
  return { endCode: endCodeStr, success: endCode1 === 0x00 && endCode2 === 0x00 };
}

/**
 * Write to a memory area on an Omron FINS PLC
 * POST /api/fins/memory-write
 *
 * Body: { host, port?, timeout?, memoryArea, address, bitPosition?, words }
 *   memoryArea — one of: DM, CIO, W, H, AR
 *   address    — starting word address (0–65535)
 *   bitPosition — 0x00 for word access
 *   words      — array of 16-bit word values to write (1–500 words)
 */
export async function handleFINSMemoryWrite(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
      memoryArea: string;
      address: number;
      bitPosition?: number;
      words: number[];
    };

    const {
      host,
      port = 9600,
      timeout = 10000,
      memoryArea,
      address,
      bitPosition = 0x00,
      words,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!memoryArea || !(memoryArea.toUpperCase() in MEMORY_AREAS)) {
      return new Response(JSON.stringify({
        success: false,
        error: `memoryArea must be one of: ${Object.keys(MEMORY_AREAS).join(', ')}`,
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (typeof address !== 'number' || address < 0 || address > 65535) {
      return new Response(JSON.stringify({
        success: false, error: 'address must be a number between 0 and 65535',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (!Array.isArray(words) || words.length < 1 || words.length > 500) {
      return new Response(JSON.stringify({
        success: false, error: 'words must be an array of 1–500 16-bit values',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    for (const w of words) {
      if (typeof w !== 'number' || w < 0 || w > 0xFFFF) {
        return new Response(JSON.stringify({
          success: false, error: 'Each word value must be a number between 0 and 65535',
        }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const memoryAreaCode = MEMORY_AREAS[memoryArea.toUpperCase()];
    const startTime = Date.now();

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), timeout)
      );

      try {
        // Step 1: Node address handshake
        const nodeReq = buildNodeAddressRequest(0);
        await writer.write(nodeReq);

        const nodeResp = await readFINSFrame(reader, timeoutPromise);
        if (!nodeResp) throw new Error('No response to node address request');

        const nodeFrame = parseFINSTCPFrame(nodeResp);
        if (!nodeFrame) throw new Error('Invalid FINS/TCP frame in node address response');
        if (nodeFrame.errorCode !== 0) {
          throw new Error(`FINS/TCP error: 0x${nodeFrame.errorCode.toString(16).padStart(8, '0')}`);
        }

        const nodeAddrs = parseNodeAddressResponse(nodeFrame.payload);
        if (!nodeAddrs) throw new Error('Failed to parse node address response');

        // Step 2: Send Memory Area Write command
        const memWriteCmd = buildMemoryAreaWriteCommand(
          nodeAddrs.serverNode,
          nodeAddrs.clientNode,
          memoryAreaCode,
          address,
          bitPosition,
          words,
        );
        await writer.write(memWriteCmd);

        const memWriteResp = await readFINSFrame(reader, timeoutPromise);
        if (!memWriteResp) throw new Error('No response to Memory Area Write command');

        const memFrame = parseFINSTCPFrame(memWriteResp);
        if (!memFrame) throw new Error('Invalid FINS/TCP frame in memory write response');
        if (memFrame.errorCode !== 0) {
          throw new Error(`FINS/TCP transport error: 0x${memFrame.errorCode.toString(16).padStart(8, '0')}`);
        }

        const { endCode, success } = parseMemoryAreaWriteResponse(memFrame.payload);
        const rtt = Date.now() - startTime;

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return {
          success,
          host,
          port,
          memoryArea: memoryArea.toUpperCase(),
          memoryAreaCode: `0x${memoryAreaCode.toString(16).padStart(2, '0').toUpperCase()}`,
          address,
          bitPosition,
          wordCount: words.length,
          words: words.map(w => `0x${w.toString(16).padStart(4, '0').toUpperCase()}`),
          endCode,
          rtt,
          ...(success ? {} : { error: `FINS end code error: ${endCode}` }),
        };
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        throw error;
      }
    })();

    const globalTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const result = await Promise.race([connectionPromise, globalTimeout]);
    return new Response(JSON.stringify(result), {
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
 * Read a memory area from an Omron FINS PLC
 * POST /api/fins/memory-read
 *
 * Performs the FINS/TCP handshake then issues a Memory Area Read (0101) command.
 * Returns the word values at the requested address range.
 */
export async function handleFINSMemoryRead(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
      memoryArea: string;
      address: number;
      bitPosition?: number;
      itemCount?: number;
    };

    const {
      host,
      port = 9600,
      timeout = 10000,
      memoryArea,
      address,
      bitPosition = 0x00,
      itemCount = 1,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!memoryArea || !(memoryArea.toUpperCase() in MEMORY_AREAS)) {
      return new Response(JSON.stringify({
        success: false,
        error: `memoryArea must be one of: ${Object.keys(MEMORY_AREAS).join(', ')}`,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (typeof address !== 'number' || address < 0 || address > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'address must be a number between 0 and 65535',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (itemCount < 1 || itemCount > 500) {
      return new Response(JSON.stringify({
        success: false,
        error: 'itemCount must be between 1 and 500',
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

    const memoryAreaCode = MEMORY_AREAS[memoryArea.toUpperCase()];
    const startTime = Date.now();

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), timeout)
      );

      try {
        // Step 1: Node address handshake
        const nodeReq = buildNodeAddressRequest(0);
        await writer.write(nodeReq);

        const nodeResp = await readFINSFrame(reader, timeoutPromise);
        if (!nodeResp) throw new Error('No response to node address request');

        const nodeFrame = parseFINSTCPFrame(nodeResp);
        if (!nodeFrame) throw new Error('Invalid FINS/TCP frame in node address response');
        if (nodeFrame.errorCode !== 0) {
          throw new Error(`FINS/TCP error: 0x${nodeFrame.errorCode.toString(16).padStart(8, '0')}`);
        }

        const nodeAddrs = parseNodeAddressResponse(nodeFrame.payload);
        if (!nodeAddrs) throw new Error('Failed to parse node address response');

        // Step 2: Send Memory Area Read command
        const memReadCmd = buildMemoryAreaReadCommand(
          nodeAddrs.serverNode,
          nodeAddrs.clientNode,
          memoryAreaCode,
          address,
          bitPosition,
          itemCount,
        );
        await writer.write(memReadCmd);

        const memReadResp = await readFINSFrame(reader, timeoutPromise);
        if (!memReadResp) throw new Error('No response to Memory Area Read command');

        const memFrame = parseFINSTCPFrame(memReadResp);
        if (!memFrame) throw new Error('Invalid FINS/TCP frame in memory read response');
        if (memFrame.errorCode !== 0) {
          throw new Error(`FINS/TCP transport error: 0x${memFrame.errorCode.toString(16).padStart(8, '0')}`);
        }

        const { endCode, data, hex } = parseMemoryAreaReadResponse(memFrame.payload);

        const rtt = Date.now() - startTime;

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        if (endCode !== '0000') {
          return {
            success: false,
            host,
            port,
            memoryArea: memoryArea.toUpperCase(),
            address,
            itemCount,
            rtt,
            endCode,
            error: `FINS end code error: ${endCode}`,
          };
        }

        return {
          success: true,
          host,
          port,
          memoryArea: memoryArea.toUpperCase(),
          memoryAreaCode: `0x${memoryAreaCode.toString(16).padStart(2, '0').toUpperCase()}`,
          address,
          bitPosition,
          itemCount,
          data,
          hex,
          rtt,
        };
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        throw error;
      }
    })();

    const globalTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const result = await Promise.race([connectionPromise, globalTimeout]);
    return new Response(JSON.stringify(result), {
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
