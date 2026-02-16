/**
 * DNP3 (Distributed Network Protocol 3) Support for Cloudflare Workers
 * Implements DNP3 over TCP (port 20000) for SCADA/ICS communication
 *
 * IEEE 1815-2012 / IEC 62351
 *
 * Frame: Data Link Header (10 bytes) + User Data Blocks (16 bytes + 2 CRC each)
 * Header: Start (0x0564) + Length + Control + Dest Addr + Src Addr + CRC
 *
 * WARNING: DNP3 controls critical infrastructure (power grids, water systems).
 * This implementation supports READ-ONLY and probe operations only.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/** DNP3 CRC-16 lookup table (polynomial 0x3D65, reflected as 0xA6BC) */
const CRC_TABLE = new Uint16Array(256);
(function initCRC() {
  const POLY = 0xA6BC;
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? ((crc >> 1) ^ POLY) : (crc >> 1);
    }
    CRC_TABLE[i] = crc;
  }
})();

function computeCRC(data: Uint8Array, start: number, length: number): number {
  let crc = 0x0000;
  for (let i = start; i < start + length; i++) {
    crc = (crc >> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xFF];
  }
  return (~crc) & 0xFFFF;
}

/** Data Link Control byte constants */
const DL_DIR = 0x80;  // Direction: 1 = from master
const DL_PRM = 0x40;  // Primary message

/** Primary function codes (Master → Outstation) */
const PFC_UNCONFIRMED_USER_DATA = 0x04;
const PFC_REQUEST_LINK_STATUS = 0x09;

/** Secondary function codes (Outstation → Master) */
const SFC_ACK = 0x00;
const SFC_NACK = 0x01;
const SFC_LINK_STATUS = 0x0B;
const SFC_NOT_SUPPORTED = 0x0F;

/** Application function codes */
const AFC_READ = 0x01;

/** DNP3 object group/variation constants */
const GROUP_CLASS_0 = 60;   // Class 0 data
const VARIATION_CLASS_0 = 1;
const VARIATION_CLASS_1 = 2;
const QUALIFIER_ALL = 0x06; // All points, no range

/** Secondary function code descriptions */
const SEC_FUNC_NAMES: Record<number, string> = {
  [SFC_ACK]: 'ACK',
  [SFC_NACK]: 'NACK',
  [SFC_LINK_STATUS]: 'LINK_STATUS',
  [SFC_NOT_SUPPORTED]: 'NOT_SUPPORTED',
};

/** Internal Indication (IIN) bit descriptions */
const IIN_BITS: Record<number, string> = {
  0x0001: 'All Stations',
  0x0002: 'Class 1 Events',
  0x0004: 'Class 2 Events',
  0x0008: 'Class 3 Events',
  0x0010: 'Need Time',
  0x0020: 'Local Control',
  0x0040: 'Device Trouble',
  0x0080: 'Device Restart',
  0x0100: 'No Function Code Support',
  0x0200: 'Object Unknown',
  0x0400: 'Parameter Error',
  0x0800: 'Event Buffer Overflow',
  0x1000: 'Already Executing',
  0x2000: 'Config Corrupt',
  0x4000: 'Reserved (2)',
  0x8000: 'Reserved (1)',
};

/**
 * Build a DNP3 Data Link Layer frame
 */
function buildDataLinkFrame(
  ctrl: number,
  destination: number,
  source: number,
  userData?: Uint8Array,
): Uint8Array {
  const dataLength = userData ? userData.length : 0;
  const length = 5 + dataLength; // ctrl(1) + dest(2) + src(2) + userData

  // Build header (first 8 bytes, before header CRC)
  const header = new Uint8Array(8);
  header[0] = 0x05; // Start byte 1
  header[1] = 0x64; // Start byte 2
  header[2] = length;
  header[3] = ctrl;
  header[4] = destination & 0xFF;
  header[5] = (destination >> 8) & 0xFF;
  header[6] = source & 0xFF;
  header[7] = (source >> 8) & 0xFF;

  const headerCRC = computeCRC(header, 0, 8);

  // Calculate data blocks: each block is up to 16 bytes + 2 byte CRC
  const numDataBlocks = userData ? Math.ceil(userData.length / 16) : 0;
  const dataCRCBytes = numDataBlocks * 2;
  const totalSize = 10 + dataLength + dataCRCBytes;

  const frame = new Uint8Array(totalSize);
  frame.set(header);
  frame[8] = headerCRC & 0xFF;
  frame[9] = (headerCRC >> 8) & 0xFF;

  if (userData && userData.length > 0) {
    let offset = 10;
    for (let i = 0; i < userData.length; i += 16) {
      const blockSize = Math.min(16, userData.length - i);
      frame.set(userData.subarray(i, i + blockSize), offset);
      const blockCRC = computeCRC(frame, offset, blockSize);
      offset += blockSize;
      frame[offset] = blockCRC & 0xFF;
      frame[offset + 1] = (blockCRC >> 8) & 0xFF;
      offset += 2;
    }
  }

  return frame;
}

/**
 * Build a DNP3 Read request (Class 0 integrity poll)
 */
function buildReadRequest(
  destination: number,
  source: number,
  classNum: number,
): Uint8Array {
  const variation = classNum === 0 ? VARIATION_CLASS_0 : VARIATION_CLASS_1 + classNum - 1;

  // Transport header: FIR=1, FIN=1, SEQ=0
  const transportHeader = 0xC0;

  // Application layer: Control (FIR=1, FIN=1, SEQ=0) + Function Code + Object Header
  const appControl = 0xC0;
  const appFunction = AFC_READ;

  // Object header: Group 60, Variation, Qualifier 0x06 (all points)
  const userData = new Uint8Array([
    transportHeader,
    appControl,
    appFunction,
    GROUP_CLASS_0,
    variation,
    QUALIFIER_ALL,
  ]);

  const ctrl = DL_DIR | DL_PRM | PFC_UNCONFIRMED_USER_DATA;
  return buildDataLinkFrame(ctrl, destination, source, userData);
}

/**
 * Parse a DNP3 Data Link Layer response
 */
function parseDataLinkResponse(data: Uint8Array): {
  valid: boolean;
  length: number;
  control: number;
  destination: number;
  source: number;
  direction: string;
  primary: boolean;
  functionCode: number;
  functionName: string;
  userData?: Uint8Array;
  headerCrcValid: boolean;
} | null {
  if (data.length < 10) return null;

  // Verify start bytes
  if (data[0] !== 0x05 || data[1] !== 0x64) return null;

  const length = data[2];
  const control = data[3];
  const destination = data[4] | (data[5] << 8);
  const source = data[6] | (data[7] << 8);

  // Verify header CRC
  const expectedCRC = computeCRC(data, 0, 8);
  const actualCRC = data[8] | (data[9] << 8);
  const headerCrcValid = expectedCRC === actualCRC;

  const direction = (control & DL_DIR) ? 'From Master' : 'From Outstation';
  const primary = !!(control & DL_PRM);
  const functionCode = control & 0x0F;

  const funcNames = primary
    ? { 0: 'RESET_LINK', 2: 'TEST_LINK', 3: 'CONFIRMED_USER_DATA', 4: 'UNCONFIRMED_USER_DATA', 9: 'REQUEST_LINK_STATUS' }
    : SEC_FUNC_NAMES;
  const functionName = funcNames[functionCode] || `UNKNOWN(0x${functionCode.toString(16)})`;

  // Extract user data (remove CRC blocks)
  let userData: Uint8Array | undefined;
  const userDataLength = length - 5;

  if (userDataLength > 0 && data.length > 10) {
    const rawData: number[] = [];
    let offset = 10;
    let remaining = userDataLength;

    while (remaining > 0 && offset < data.length) {
      const blockSize = Math.min(16, remaining);
      if (offset + blockSize + 2 > data.length) break;

      for (let i = 0; i < blockSize; i++) {
        rawData.push(data[offset + i]);
      }
      offset += blockSize + 2; // skip CRC
      remaining -= blockSize;
    }

    userData = new Uint8Array(rawData);
  }

  return {
    valid: headerCrcValid,
    length,
    control,
    destination,
    source,
    direction,
    primary,
    functionCode,
    functionName,
    userData,
    headerCrcValid,
  };
}

/**
 * Parse DNP3 Application Layer response
 */
function parseApplicationResponse(userData: Uint8Array): {
  transportFIR: boolean;
  transportFIN: boolean;
  transportSeq: number;
  appControl: number;
  appFIR: boolean;
  appFIN: boolean;
  appCON: boolean;
  appUNS: boolean;
  appSeq: number;
  functionCode: number;
  functionName: string;
  iin: number;
  iinFlags: string[];
  objects: Uint8Array;
} | null {
  if (userData.length < 5) return null; // transport(1) + app_ctrl(1) + func(1) + iin(2) minimum

  // Transport header
  const transportFIR = !!(userData[0] & 0x40);
  const transportFIN = !!(userData[0] & 0x80);
  const transportSeq = userData[0] & 0x3F;

  // Application Control
  const appControl = userData[1];
  const appFIR = !!(appControl & 0x80);
  const appFIN = !!(appControl & 0x40);
  const appCON = !!(appControl & 0x20);
  const appUNS = !!(appControl & 0x10);
  const appSeq = appControl & 0x0F;

  // Function code
  const functionCode = userData[2];
  const functionNames: Record<number, string> = {
    0x00: 'CONFIRM',
    0x01: 'READ',
    0x02: 'WRITE',
    0x81: 'RESPONSE',
    0x82: 'UNSOLICITED_RESPONSE',
    0x83: 'AUTHENTICATE_RESPONSE',
  };
  const functionName = functionNames[functionCode] || `UNKNOWN(0x${functionCode.toString(16)})`;

  // Internal Indications (2 bytes)
  const iin = (userData[3] | (userData[4] << 8));
  const iinFlags: string[] = [];
  for (const [bit, name] of Object.entries(IIN_BITS)) {
    if (iin & parseInt(bit)) {
      iinFlags.push(name);
    }
  }

  // Remaining bytes are object data
  const objects = userData.slice(5);

  return {
    transportFIR,
    transportFIN,
    transportSeq,
    appControl,
    appFIR,
    appFIN,
    appCON,
    appUNS,
    appSeq,
    functionCode,
    functionName,
    iin,
    iinFlags,
    objects,
  };
}

/**
 * Read a DNP3 response from the socket
 */
async function readDNP3Response(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<Uint8Array> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Read timeout')), timeoutMs),
  );

  const readPromise = (async () => {
    let buffer = new Uint8Array(0);

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const newBuffer = new Uint8Array(buffer.length + value.length);
      newBuffer.set(buffer);
      newBuffer.set(value, buffer.length);
      buffer = newBuffer;

      // Need at least 10 bytes (header with CRC)
      if (buffer.length >= 10) {
        // Verify start bytes
        if (buffer[0] === 0x05 && buffer[1] === 0x64) {
          const length = buffer[2];
          const userDataLength = length - 5;

          if (userDataLength <= 0) {
            // No user data, header-only frame
            return buffer;
          }

          // Calculate expected total frame size including data block CRCs
          const numBlocks = Math.ceil(userDataLength / 16);
          const expectedSize = 10 + userDataLength + (numBlocks * 2);

          if (buffer.length >= expectedSize) {
            return buffer;
          }
        } else {
          // Not a valid DNP3 frame, return what we have
          return buffer;
        }
      }
    }
    return buffer;
  })();

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Format raw bytes as hex string
 */
function toHex(data: Uint8Array, maxBytes = 64): string {
  const hex = Array.from(data.subarray(0, maxBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ');
  return data.length > maxBytes ? hex + '...' : hex;
}

/**
 * Handle DNP3 connection probe
 * POST /api/dnp3/connect
 *
 * Sends a REQUEST_LINK_STATUS to check if a DNP3 outstation is reachable
 */
export async function handleDNP3Connect(request: Request): Promise<Response> {
  try {
    const {
      host,
      port = 20000,
      destination = 1,
      source = 3,
      timeout = 10000,
    } = await request.json<{
      host: string;
      port?: number;
      destination?: number;
      source?: number;
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

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Send REQUEST_LINK_STATUS (safe probe)
        const ctrl = DL_DIR | DL_PRM | PFC_REQUEST_LINK_STATUS;
        const frame = buildDataLinkFrame(ctrl, destination, source);
        await writer.write(frame);

        const responseBytes = await readDNP3Response(reader, 5000);
        await socket.close();

        if (responseBytes.length === 0) {
          return {
            success: false,
            error: 'No response from outstation (empty response)',
          };
        }

        const parsed = parseDataLinkResponse(responseBytes);

        if (!parsed) {
          return {
            success: true,
            message: 'Received data but could not parse as DNP3 frame',
            host,
            port,
            rawHex: toHex(responseBytes),
            rawLength: responseBytes.length,
          };
        }

        return {
          success: true,
          message: `DNP3 outstation reachable at ${host}:${port}`,
          host,
          port,
          dataLink: {
            valid: parsed.valid,
            headerCrcValid: parsed.headerCrcValid,
            direction: parsed.direction,
            primary: parsed.primary,
            functionCode: parsed.functionCode,
            functionName: parsed.functionName,
            sourceAddress: parsed.source,
            destinationAddress: parsed.destination,
            length: parsed.length,
          },
          rawHex: toHex(responseBytes),
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'DNP3 connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle DNP3 Class Data Read (integrity poll)
 * POST /api/dnp3/read
 *
 * Sends a READ request for Class 0 (static) data
 * This is a read-only operation safe for critical infrastructure
 */
export async function handleDNP3Read(request: Request): Promise<Response> {
  try {
    const {
      host,
      port = 20000,
      destination = 1,
      source = 3,
      classNum = 0,
      timeout = 10000,
    } = await request.json<{
      host: string;
      port?: number;
      destination?: number;
      source?: number;
      classNum?: number;
      timeout?: number;
    }>();

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (classNum < 0 || classNum > 3) {
      return new Response(JSON.stringify({
        error: 'classNum must be 0 (static data), 1, 2, or 3 (event classes)',
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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        const frame = buildReadRequest(destination, source, classNum);
        await writer.write(frame);

        const responseBytes = await readDNP3Response(reader, 5000);
        await socket.close();

        if (responseBytes.length === 0) {
          return {
            success: false,
            error: 'No response from outstation',
          };
        }

        const dlParsed = parseDataLinkResponse(responseBytes);

        if (!dlParsed) {
          return {
            success: true,
            message: 'Received data but could not parse as DNP3',
            host,
            port,
            rawHex: toHex(responseBytes),
          };
        }

        const result: Record<string, unknown> = {
          success: true,
          host,
          port,
          classNum,
          dataLink: {
            valid: dlParsed.valid,
            direction: dlParsed.direction,
            functionCode: dlParsed.functionCode,
            functionName: dlParsed.functionName,
            sourceAddress: dlParsed.source,
            destinationAddress: dlParsed.destination,
          },
          rawHex: toHex(responseBytes),
        };

        // Parse application layer if user data present
        if (dlParsed.userData && dlParsed.userData.length >= 5) {
          const appParsed = parseApplicationResponse(dlParsed.userData);
          if (appParsed) {
            result.application = {
              functionCode: appParsed.functionCode,
              functionName: appParsed.functionName,
              sequence: appParsed.appSeq,
              firstFragment: appParsed.appFIR,
              finalFragment: appParsed.appFIN,
              confirmation: appParsed.appCON,
              unsolicited: appParsed.appUNS,
              iin: `0x${appParsed.iin.toString(16).padStart(4, '0')}`,
              iinFlags: appParsed.iinFlags,
              objectDataLength: appParsed.objects.length,
              objectDataHex: toHex(appParsed.objects, 128),
            };
          }
        }

        return result;
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'DNP3 read failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
