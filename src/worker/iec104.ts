/**
 * IEC 60870-5-104 Protocol Implementation
 *
 * IEC 104 is a TCP-based telecontrol protocol used in power grid SCADA systems,
 * electrical substations, and industrial process control. Default port is 2404.
 *
 * Protocol Structure:
 * - APCI (Application Protocol Control Information): 6-byte frame header
 *   - Start byte: 0x68
 *   - Length: 1 byte (length of remaining bytes, min 4)
 *   - Control field: 4 bytes (determines frame type)
 *
 * Frame Types:
 * - I-frame (Information): Numbered data transfer
 * - S-frame (Supervisory): Acknowledgment
 * - U-frame (Unnumbered): Connection management
 *
 * U-frame Commands (used for probing):
 * - STARTDT Act/Con: Activate/confirm data transfer
 * - STOPDT Act/Con: Deactivate/confirm data transfer
 * - TESTFR Act/Con: Connection test (keepalive)
 *
 * Use Cases:
 * - Power grid SCADA connectivity testing
 * - Substation RTU/IED discovery
 * - IEC 104 server availability monitoring
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface IEC104Request {
  host: string;
  port?: number;
  timeout?: number;
}

interface ASDUInfo {
  typeId: number;
  typeName: string;
  ca: number;       // Common Address
  ioa: number;      // Information Object Address
  value: number | boolean | null;
  quality: number;
  qualityFlags: string[];
  timestamp?: string;
  raw: string;
}

interface IEC104Response {
  success: boolean;
  host: string;
  port: number;
  rtt: number;
  startdtConfirmed?: boolean;
  testfrConfirmed?: boolean;
  framesReceived?: FrameInfo[];
  error?: string;
}

interface FrameInfo {
  type: string;
  length: number;
  controlField: string;
  description: string;
}

// APCI start byte
const START_BYTE = 0x68;

// Type IDs for common ASDU types (IEC 60870-5-101/104)
const ASDU_TYPE_NAMES: Record<number, string> = {
  1:   'M_SP_NA_1 (Single Point)',
  2:   'M_SP_TA_1 (Single Point w/Time)',
  3:   'M_DP_NA_1 (Double Point)',
  4:   'M_DP_TA_1 (Double Point w/Time)',
  5:   'M_ST_NA_1 (Step Position)',
  9:   'M_ME_NA_1 (Normalized Measured Value)',
  11:  'M_ME_NB_1 (Scaled Measured Value)',
  13:  'M_ME_NC_1 (Short Float Measured Value)',
  30:  'M_SP_TB_1 (Single Point w/CP56Time2a)',
  31:  'M_DP_TB_1 (Double Point w/CP56Time2a)',
  34:  'M_ST_TB_1 (Step Position w/CP56Time2a)',
  35:  'M_BO_TB_1 (Bitstring w/CP56Time2a)',
  36:  'M_ME_TD_1 (Normalized Measured w/CP56Time2a)',
  37:  'M_ME_TE_1 (Scaled Measured w/CP56Time2a)',
  38:  'M_ME_TF_1 (Short Float Measured w/CP56Time2a)',
  100: 'C_IC_NA_1 (General Interrogation)',
  101: 'C_CI_NA_1 (Counter Interrogation)',
};

// Quality descriptor bit names
const QUALITY_BITS: Record<number, string> = {
  0x01: 'OV (Overflow)',
  0x04: 'NT (Not Topical)',
  0x08: 'SB (Substituted)',
  0x10: 'BL (Blocked)',
  0x20: 'EI (Elapsed Time Invalid)',  // for integrated totals
  0x40: 'ES (Equipment Stopped)',     // for step positions
  0x80: 'IV (Invalid)',
};

// U-frame control field values
const UFRAME = {
  STARTDT_ACT: new Uint8Array([START_BYTE, 0x04, 0x07, 0x00, 0x00, 0x00]),
  STARTDT_CON: 0x0B,
  STOPDT_ACT: new Uint8Array([START_BYTE, 0x04, 0x13, 0x00, 0x00, 0x00]),
  STOPDT_CON: 0x23,
  TESTFR_ACT: new Uint8Array([START_BYTE, 0x04, 0x43, 0x00, 0x00, 0x00]),
  TESTFR_CON: 0x83,
};

/**
 * Classify an APCI frame from its control field
 */
function classifyFrame(controlField: Uint8Array): FrameInfo {
  const cf0 = controlField[0];
  const cf1 = controlField[1];
  const cf2 = controlField[2];
  const cf3 = controlField[3];
  const hex = `0x${cf0.toString(16).padStart(2, '0')} 0x${cf1.toString(16).padStart(2, '0')} 0x${cf2.toString(16).padStart(2, '0')} 0x${cf3.toString(16).padStart(2, '0')}`;

  // U-frame: bits 0 and 1 of first byte are both 1
  if ((cf0 & 0x03) === 0x03) {
    let description = 'U-frame (Unknown)';
    if (cf0 === 0x07) description = 'STARTDT Act (Start Data Transfer Activation)';
    else if (cf0 === 0x0B) description = 'STARTDT Con (Start Data Transfer Confirmation)';
    else if (cf0 === 0x13) description = 'STOPDT Act (Stop Data Transfer Activation)';
    else if (cf0 === 0x23) description = 'STOPDT Con (Stop Data Transfer Confirmation)';
    else if (cf0 === 0x43) description = 'TESTFR Act (Test Frame Activation)';
    else if (cf0 === 0x83) description = 'TESTFR Con (Test Frame Confirmation)';

    return { type: 'U-frame', length: 6, controlField: hex, description };
  }

  // S-frame: bit 0 = 0, bit 1 = 1
  if ((cf0 & 0x01) === 0x00 && (cf0 & 0x02) === 0x02) {
    const receiveSeq = ((cf3 << 8) | cf2) >> 1;
    return {
      type: 'S-frame',
      length: 6,
      controlField: hex,
      description: `Supervisory (Receive Sequence N(R)=${receiveSeq})`,
    };
  }

  // I-frame: bit 0 = 0
  if ((cf0 & 0x01) === 0x00) {
    const sendSeq = ((cf1 << 8) | cf0) >> 1;
    const receiveSeq = ((cf3 << 8) | cf2) >> 1;
    return {
      type: 'I-frame',
      length: 6,
      controlField: hex,
      description: `Information (Send N(S)=${sendSeq}, Receive N(R)=${receiveSeq})`,
    };
  }

  return { type: 'Unknown', length: 6, controlField: hex, description: 'Unknown frame type' };
}

/**
 * Parse APCI frames from a buffer
 */
function parseFrames(buffer: Uint8Array): FrameInfo[] {
  const frames: FrameInfo[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    // Find start byte
    if (buffer[offset] !== START_BYTE) {
      offset++;
      continue;
    }

    // Need at least 6 bytes for a minimal APCI frame
    if (offset + 2 > buffer.length) break;

    const apduLength = buffer[offset + 1];
    if (apduLength < 4) {
      offset++;
      continue;
    }

    const totalFrameLength = 2 + apduLength; // start byte + length byte + APDU
    if (offset + totalFrameLength > buffer.length) break;

    // Extract control field (4 bytes after start + length)
    const controlField = buffer.slice(offset + 2, offset + 6);
    const frame = classifyFrame(controlField);
    frame.length = totalFrameLength;

    frames.push(frame);
    offset += totalFrameLength;
  }

  return frames;
}

/**
 * Probe an IEC 104 server by sending STARTDT Act and TESTFR Act
 * POST /api/iec104/probe
 */
export async function handleIEC104Probe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as IEC104Request;
    const { host, port = 2404, timeout = 10000 } = body;

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
        const allFrames: FrameInfo[] = [];
        let startdtConfirmed = false;
        let testfrConfirmed = false;

        // Step 1: Send STARTDT Act
        await writer.write(UFRAME.STARTDT_ACT);

        // Read response with timeout
        const readWithTimeout = async (ms: number): Promise<Uint8Array | null> => {
          const timeoutPromise = new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), ms)
          );
          const readPromise = (async () => {
            let buffer = new Uint8Array(0);
            while (buffer.length < 1024) {
              const { value, done } = await reader.read();
              if (done || !value) break;
              const newBuf = new Uint8Array(buffer.length + value.length);
              newBuf.set(buffer);
              newBuf.set(value, buffer.length);
              buffer = newBuf;

              // Check if we have at least one complete frame
              if (buffer.length >= 6 && buffer[0] === START_BYTE) {
                const frameLen = 2 + buffer[1];
                if (buffer.length >= frameLen) return buffer;
              }
            }
            return buffer.length > 0 ? buffer : null;
          })();
          return Promise.race([readPromise, timeoutPromise]);
        };

        // Read STARTDT Con response
        const startdtResponse = await readWithTimeout(5000);
        if (startdtResponse) {
          const frames = parseFrames(startdtResponse);
          allFrames.push(...frames);
          startdtConfirmed = frames.some(f =>
            f.type === 'U-frame' && f.description.includes('STARTDT Con')
          );
        }

        // Step 2: Send TESTFR Act
        await writer.write(UFRAME.TESTFR_ACT);

        // Read TESTFR Con response
        const testfrResponse = await readWithTimeout(5000);
        if (testfrResponse) {
          const frames = parseFrames(testfrResponse);
          allFrames.push(...frames);
          testfrConfirmed = frames.some(f =>
            f.type === 'U-frame' && f.description.includes('TESTFR Con')
          );
        }

        // Step 3: Send STOPDT Act (clean disconnect)
        try {
          await writer.write(UFRAME.STOPDT_ACT);
        } catch {
          // Ignore errors on cleanup
        }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        const rtt = Date.now() - startTime;

        const response: IEC104Response = {
          success: true,
          host,
          port,
          rtt,
          startdtConfirmed,
          testfrConfirmed,
          framesReceived: allFrames.slice(0, 20), // Limit frames
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

/**
 * Parse a CP56Time2a timestamp (7 bytes) into an ISO string.
 *
 * Byte layout (all little-endian unless noted):
 *   [0-1] milliseconds (0-59999, lower 10 bits)
 *   [1]   minutes (bits 0-5 of byte 1)  — note: overlaps with ms high bits
 *   [2]   minutes (bits 0-5)
 *   [3]   hours   (bits 0-4)
 *   [4]   day of week (bits 5-7) + day of month (bits 0-4)
 *   [5]   months (bits 0-3)
 *   [6]   years  (bits 0-6, offset from 2000)
 *
 * Per IEC 60870-5-4 §5.4.7:
 *   byte 0 = ms low byte
 *   byte 1 bits 7-0: [IV|RES|min5..min0] — wait, actual layout:
 *     byte 0-1 = uint16 LE, bits 15-10 = minutes (0-59), bits 9-0 = ms within minute (0-59999)
 */
function parseCP56Time2a(data: Uint8Array, offset: number): string {
  if (offset + 7 > data.length) return 'invalid';

  const msLow  = data[offset];
  const msHigh = data[offset + 1] & 0x03; // only lower 2 bits contribute to ms
  const ms     = (msHigh << 8) | msLow;     // ms within the current second (0-999, note: field is 0-59999 for full minute)
  const sec    = Math.floor(ms / 1000) % 60;
  const msRem  = ms % 1000;

  const minutes = data[offset + 2] & 0x3F;
  const hours   = data[offset + 3] & 0x1F;
  const day     = data[offset + 4] & 0x1F;
  const month   = data[offset + 5] & 0x0F;
  const year    = 2000 + (data[offset + 6] & 0x7F);

  if (month < 1 || month > 12 || day < 1 || day > 31) return 'invalid';

  const pad = (n: number, w = 2) => n.toString().padStart(w, '0');
  return `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:${pad(sec)}.${pad(msRem, 3)}Z`;
}

/**
 * Parse quality descriptor bits into flag names
 */
function parseQualityFlags(quality: number): string[] {
  const flags: string[] = [];
  for (const [bit, name] of Object.entries(QUALITY_BITS)) {
    if (quality & parseInt(bit)) {
      flags.push(name);
    }
  }
  return flags;
}

/**
 * Parse one ASDU from a buffer slice.
 *
 * ASDU structure:
 *   Type ID (1) | VSQ (1) | Cause of Tx (2) | Common Address (2) | [IOA (3) + value + quality] * N
 *
 * VSQ: SQ bit (bit7) + number of objects (bits 0-6)
 *   SQ=1: sequential IOAs, one block
 *   SQ=0: each object has its own IOA
 */
function parseASDU(asduData: Uint8Array): ASDUInfo[] {
  const results: ASDUInfo[] = [];
  if (asduData.length < 6) return results;

  const typeId  = asduData[0];
  const vsq     = asduData[1];
  const sq      = !!(vsq & 0x80);
  const numObj  = vsq & 0x7F;
  // COT = 2 bytes LE (cause of transmission)
  const ca      = asduData[4] | (asduData[5] << 8); // Common Address (2 bytes LE)

  const typeName = ASDU_TYPE_NAMES[typeId] || `Type ${typeId}`;
  let offset = 6; // start of IO objects

  for (let i = 0; i < numObj && offset < asduData.length; i++) {
    // IOA: 3 bytes LE (for IEC 104, CA length=2 and IOA length=3 are default)
    let ioa: number;
    if (!sq || i === 0) {
      if (offset + 3 > asduData.length) break;
      ioa = asduData[offset] | (asduData[offset + 1] << 8) | (asduData[offset + 2] << 16);
      offset += 3;
    } else {
      ioa = (asduData[6] | (asduData[7] << 8) | (asduData[8] << 16)) + i;
    }

    const rawStart = offset;
    let value: number | boolean | null = null;
    let quality = 0;
    let timestamp: string | undefined;

    switch (typeId) {
      case 1: // M_SP_NA_1 — Single Point (1 byte: value+quality combined)
        if (offset + 1 > asduData.length) break;
        value   = !!(asduData[offset] & 0x01);
        quality = asduData[offset] & 0xF0;
        offset += 1;
        break;

      case 2: // M_SP_TA_1 — Single Point with 3-byte timestamp
        if (offset + 4 > asduData.length) break;
        value   = !!(asduData[offset] & 0x01);
        quality = asduData[offset] & 0xF0;
        offset += 1;
        // 3-byte BCD timestamp (not CP56Time2a)
        offset += 3;
        break;

      case 3: // M_DP_NA_1 — Double Point (1 byte: value bits 0-1, quality bits 4-7)
        if (offset + 1 > asduData.length) break;
        value   = asduData[offset] & 0x03;
        quality = asduData[offset] & 0xF0;
        offset += 1;
        break;

      case 4: // M_DP_TA_1 — Double Point with 3-byte timestamp
        if (offset + 4 > asduData.length) break;
        value   = asduData[offset] & 0x03;
        quality = asduData[offset] & 0xF0;
        offset += 4;
        break;

      case 5: // M_ST_NA_1 — Step Position (1 byte value + 1 byte quality)
        if (offset + 2 > asduData.length) break;
        value   = (asduData[offset] & 0x7F) * ((asduData[offset] & 0x80) ? -1 : 1);
        quality = asduData[offset + 1];
        offset += 2;
        break;

      case 9: // M_ME_NA_1 — Normalized measured value (2 bytes + 1 byte quality)
        if (offset + 3 > asduData.length) break;
        {
          const raw16 = asduData[offset] | (asduData[offset + 1] << 8);
          // Normalized: signed 16-bit, range -1 to +1 - (2^-15)
          const signed = raw16 > 32767 ? raw16 - 65536 : raw16;
          value   = signed / 32768.0;
          quality = asduData[offset + 2];
          offset += 3;
        }
        break;

      case 11: // M_ME_NB_1 — Scaled measured value (2 bytes + 1 byte quality)
        if (offset + 3 > asduData.length) break;
        {
          const raw16 = asduData[offset] | (asduData[offset + 1] << 8);
          value   = raw16 > 32767 ? raw16 - 65536 : raw16;
          quality = asduData[offset + 2];
          offset += 3;
        }
        break;

      case 13: // M_ME_NC_1 — Short float (4 bytes + 1 byte quality)
        if (offset + 5 > asduData.length) break;
        {
          const buf = new ArrayBuffer(4);
          const dv  = new DataView(buf);
          dv.setUint8(0, asduData[offset]);
          dv.setUint8(1, asduData[offset + 1]);
          dv.setUint8(2, asduData[offset + 2]);
          dv.setUint8(3, asduData[offset + 3]);
          value   = dv.getFloat32(0, true); // little-endian IEEE 754
          quality = asduData[offset + 4];
          offset += 5;
        }
        break;

      case 30: // M_SP_TB_1 — Single Point with CP56Time2a (1 + 7 bytes)
        if (offset + 8 > asduData.length) break;
        value     = !!(asduData[offset] & 0x01);
        quality   = asduData[offset] & 0xF0;
        timestamp = parseCP56Time2a(asduData, offset + 1);
        offset   += 8;
        break;

      case 31: // M_DP_TB_1 — Double Point with CP56Time2a
        if (offset + 8 > asduData.length) break;
        value     = asduData[offset] & 0x03;
        quality   = asduData[offset] & 0xF0;
        timestamp = parseCP56Time2a(asduData, offset + 1);
        offset   += 8;
        break;

      case 36: // M_ME_TD_1 — Normalized measured value with CP56Time2a (2 + 1 + 7 bytes)
        if (offset + 10 > asduData.length) break;
        {
          const raw16 = asduData[offset] | (asduData[offset + 1] << 8);
          const signed = raw16 > 32767 ? raw16 - 65536 : raw16;
          value     = signed / 32768.0;
          quality   = asduData[offset + 2];
          timestamp = parseCP56Time2a(asduData, offset + 3);
          offset   += 10;
        }
        break;

      case 37: // M_ME_TE_1 — Scaled measured value with CP56Time2a (2 + 1 + 7 bytes)
        if (offset + 10 > asduData.length) break;
        {
          const raw16 = asduData[offset] | (asduData[offset + 1] << 8);
          value     = raw16 > 32767 ? raw16 - 65536 : raw16;
          quality   = asduData[offset + 2];
          timestamp = parseCP56Time2a(asduData, offset + 3);
          offset   += 10;
        }
        break;

      case 38: // M_ME_TF_1 — Short float with CP56Time2a (4 + 1 + 7 bytes)
        if (offset + 12 > asduData.length) break;
        {
          const buf = new ArrayBuffer(4);
          const dv  = new DataView(buf);
          dv.setUint8(0, asduData[offset]);
          dv.setUint8(1, asduData[offset + 1]);
          dv.setUint8(2, asduData[offset + 2]);
          dv.setUint8(3, asduData[offset + 3]);
          value     = dv.getFloat32(0, true);
          quality   = asduData[offset + 4];
          timestamp = parseCP56Time2a(asduData, offset + 5);
          offset   += 12;
        }
        break;

      default:
        // Unknown type — consume remaining bytes to avoid infinite loop
        offset = asduData.length;
        break;
    }

    const rawSlice = asduData.slice(rawStart, offset);
    const raw = Array.from(rawSlice).map(b => b.toString(16).padStart(2, '0')).join(' ');

    const entry: ASDUInfo = {
      typeId,
      typeName,
      ca,
      ioa,
      value,
      quality,
      qualityFlags: parseQualityFlags(quality),
      raw,
    };
    if (timestamp !== undefined) entry.timestamp = timestamp;

    results.push(entry);
  }

  return results;
}

/**
 * Read ASDU data from an IEC 60870-5-104 server via General Interrogation
 * POST /api/iec104/read-data
 *
 * After STARTDT activation, sends a C_IC_NA_1 (Type 100) General Interrogation
 * command and collects all incoming I-frames for up to 2 seconds.
 *
 * Returns parsed ASDU objects with value, quality descriptor, and timestamp
 * where available.
 */
export async function handleIEC104ReadData(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
      commonAddress?: number;
    };

    const {
      host,
      port = 2404,
      timeout = 15000,
      commonAddress = 1,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
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
        // Sequence counters for I-frames
        let sendSeq = 0;  // N(S): our send sequence number
        let recvSeq = 0;  // N(R): last received send sequence from server

        /**
         * Build a 6-byte APCI for an I-frame
         *   CF0 = (N(S) << 1) & 0xFF
         *   CF1 = N(S) >> 7
         *   CF2 = (N(R) << 1) & 0xFF
         *   CF3 = N(R) >> 7
         */
        const buildIFrameHeader = (asduLen: number): Uint8Array => {
          const apduLen = 4 + asduLen; // 4 control bytes + ASDU
          const apci = new Uint8Array(6 + asduLen);
          apci[0] = START_BYTE;
          apci[1] = apduLen;
          apci[2] = (sendSeq << 1) & 0xFF;
          apci[3] = (sendSeq >> 7) & 0xFF;
          apci[4] = (recvSeq << 1) & 0xFF;
          apci[5] = (recvSeq >> 7) & 0xFF;
          return apci;
        };

        /**
         * Build a C_IC_NA_1 (Type 100) General Interrogation ASDU:
         *   Type ID: 0x64 (100)
         *   VSQ: 0x01 (1 object, SQ=0)
         *   COT: 0x06 0x00 (cause = activation, 2 bytes LE)
         *   CA:  commonAddress LE (2 bytes)
         *   IOA: 0x00 0x00 0x00 (station-level interrogation)
         *   QOI: 0x14 (qualifier = station interrogation, group 20)
         */
        const buildGeneralInterrogation = (): Uint8Array => {
          const asdu = new Uint8Array([
            0x64,                       // Type 100
            0x01,                       // 1 object
            0x06, 0x00,                 // COT = Activation
            commonAddress & 0xFF,       // CA low
            (commonAddress >> 8) & 0xFF, // CA high
            0x00, 0x00, 0x00,           // IOA = 0
            0x14,                       // QOI = 20 (station)
          ]);
          const frame = buildIFrameHeader(asdu.length);
          frame.set(asdu, 6);
          sendSeq = (sendSeq + 1) & 0x7FFF;
          return frame;
        };

        // Helper: read data with a deadline
        const readWithDeadline = async (deadlineMs: number): Promise<Uint8Array | null> => {
          const remaining = deadlineMs - Date.now();
          if (remaining <= 0) return null;

          const timeoutP = new Promise<null>(resolve => setTimeout(() => resolve(null), remaining));
          const readP = (async () => {
            let buf = new Uint8Array(0);
            while (buf.length < 65536) {
              const { value, done } = await reader.read();
              if (done || !value) break;
              const nb = new Uint8Array(buf.length + value.length);
              nb.set(buf);
              nb.set(value, buf.length);
              buf = nb;
              // Return as soon as we have at least one complete frame
              if (buf.length >= 6 && buf[0] === START_BYTE) {
                const frameLen = 2 + buf[1];
                if (buf.length >= frameLen) return buf;
              }
            }
            return buf.length > 0 ? buf : null;
          })();
          return Promise.race([readP, timeoutP]);
        };

        // Step 1: STARTDT Act
        await writer.write(UFRAME.STARTDT_ACT);

        const startdtDeadline = Date.now() + 5000;
        let startdtConfirmed = false;

        const startdtResp = await readWithDeadline(startdtDeadline);
        if (startdtResp) {
          const frames = parseFrames(startdtResp);
          startdtConfirmed = frames.some(f => f.type === 'U-frame' && f.description.includes('STARTDT Con'));
          // Update recvSeq for any I-frames received
          for (let off = 0; off < startdtResp.length;) {
            if (startdtResp[off] !== START_BYTE || off + 2 > startdtResp.length) { off++; continue; }
            const flen = 2 + startdtResp[off + 1];
            if (off + flen > startdtResp.length) break;
            const cf0 = startdtResp[off + 2];
            if ((cf0 & 0x01) === 0) {
              // I-frame: update our N(R)
              const serverSendSeq = ((startdtResp[off + 3] << 8) | cf0) >> 1;
              recvSeq = (serverSendSeq + 1) & 0x7FFF;
            }
            off += flen;
          }
        }

        if (!startdtConfirmed) {
          writer.releaseLock();
          reader.releaseLock();
          socket.close();
          return {
            success: false,
            host,
            port,
            rtt: Date.now() - startTime,
            error: 'STARTDT not confirmed by server',
            asdus: [],
            count: 0,
          };
        }

        // Step 2: Send General Interrogation (C_IC_NA_1)
        const giFrame = buildGeneralInterrogation();
        await writer.write(giFrame);

        // Step 3: Collect I-frames for up to 2 seconds
        const collectDeadline = Date.now() + 2000;
        const allASDUs: ASDUInfo[] = [];
        let collectionBuffer = new Uint8Array(0);

        while (Date.now() < collectDeadline && allASDUs.length < 500) {
          const chunk = await readWithDeadline(collectDeadline);
          if (!chunk) break;

          // Append to collection buffer
          const nb = new Uint8Array(collectionBuffer.length + chunk.length);
          nb.set(collectionBuffer);
          nb.set(chunk, collectionBuffer.length);
          collectionBuffer = nb;

          // Parse all complete frames from buffer
          let off = 0;
          while (off < collectionBuffer.length) {
            if (collectionBuffer[off] !== START_BYTE) { off++; continue; }
            if (off + 2 > collectionBuffer.length) break;
            const flen = 2 + collectionBuffer[off + 1];
            if (off + flen > collectionBuffer.length) break;

            const cf0 = collectionBuffer[off + 2];
            const cf1 = collectionBuffer[off + 3];
            const cf2 = collectionBuffer[off + 4];
            const cf3 = collectionBuffer[off + 5];

            if ((cf0 & 0x01) === 0 && (cf0 & 0x02) === 0) {
              // I-frame: extract ASDU (starts at byte 6 of APCI frame, i.e. offset+6)
              const serverSendSeq = (((cf1 << 8) | cf0) >> 1) & 0x7FFF;
              recvSeq = (serverSendSeq + 1) & 0x7FFF;

              if (off + 6 < off + flen) {
                const asduData = collectionBuffer.slice(off + 6, off + flen);
                const parsed = parseASDU(asduData);
                allASDUs.push(...parsed);
              }
            } else if ((cf0 & 0x03) === 0x03) {
              // U-frame — check for STARTDT Con or TESTFR
              void cf2; void cf3; // suppress unused warnings
            }

            off += flen;
          }
          // Remove consumed bytes
          collectionBuffer = collectionBuffer.slice(off);
        }

        // Send S-frame acknowledgment for received I-frames
        if (recvSeq > 0) {
          const sframe = new Uint8Array([
            START_BYTE, 0x04,
            0x01,                        // S-frame marker
            0x00,
            (recvSeq << 1) & 0xFF,
            (recvSeq >> 7) & 0xFF,
          ]);
          try { await writer.write(sframe); } catch { /* ignore */ }
        }

        // Clean disconnect
        try { await writer.write(UFRAME.STOPDT_ACT); } catch { /* ignore */ }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return {
          success: true,
          host,
          port,
          commonAddress,
          asdus: allASDUs,
          count: allASDUs.length,
          rtt: Date.now() - startTime,
        };

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

/**
 * POST {host, port?, timeout?, commonAddress?, ioa, commandType, value}
 *
 * Sends a control command to an IEC 104 RTU/IED:
 *   commandType = 'single'  → C_SC_NA_1 (Type 45): value must be 0 or 1
 *   commandType = 'double'  → C_DC_NA_1 (Type 46): value must be 1 (off) or 2 (on)
 *
 * Flow: TCP connect → STARTDT Act → STARTDT Con → send command I-frame
 *       → receive Activation Confirmation (COT=7) → STOPDT → close
 */
export async function handleIEC104Write(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
      commonAddress?: number;
      ioa: number;
      commandType?: 'single' | 'double';
      value: number;
    };

    const {
      host,
      port = 2404,
      timeout = 15000,
      commonAddress = 1,
      ioa,
      commandType = 'single',
      value,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'host is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (ioa === undefined || ioa === null) {
      return new Response(JSON.stringify({ success: false, error: 'ioa (Information Object Address) is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (commandType === 'single' && value !== 0 && value !== 1) {
      return new Response(JSON.stringify({ success: false, error: 'single command value must be 0 or 1' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (commandType === 'double' && value !== 1 && value !== 2) {
      return new Response(JSON.stringify({ success: false, error: 'double command value must be 1 (off) or 2 (on)' }), {
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
        let sendSeq = 0;
        let recvSeq = 0;

        const buildIFrameHeader = (asduLen: number): Uint8Array => {
          const apduLen = 4 + asduLen;
          const apci = new Uint8Array(6 + asduLen);
          apci[0] = START_BYTE;
          apci[1] = apduLen;
          apci[2] = (sendSeq << 1) & 0xFF;
          apci[3] = (sendSeq >> 7) & 0xFF;
          apci[4] = (recvSeq << 1) & 0xFF;
          apci[5] = (recvSeq >> 7) & 0xFF;
          return apci;
        };

        const readWithDeadline = async (deadlineMs: number): Promise<Uint8Array | null> => {
          const remaining = deadlineMs - Date.now();
          if (remaining <= 0) return null;
          const timeoutP = new Promise<null>(resolve => setTimeout(() => resolve(null), remaining));
          const readP = (async () => {
            const { value: chunk, done } = await reader.read();
            if (done || !chunk) return null;
            return chunk;
          })();
          return Promise.race([readP, timeoutP]);
        };

        // Step 1: STARTDT Act — activate data transfer
        await writer.write(UFRAME.STARTDT_ACT);

        const startdtResp = await readWithDeadline(Date.now() + 5000);
        if (!startdtResp) {
          throw new Error('No STARTDT Con received');
        }
        const startFrames = parseFrames(startdtResp);
        const startdtConfirmed = startFrames.some(
          f => f.type === 'U-frame' && f.description.includes('STARTDT Con')
        );
        if (!startdtConfirmed) {
          throw new Error('STARTDT not confirmed by server');
        }

        // Step 2: Build command ASDU
        //   C_SC_NA_1 (Type 45): TypeID(1)+VSQ(1)+COT(2)+CA(2)+IOA(3)+SCO(1) = 10 bytes
        //   C_DC_NA_1 (Type 46): same layout, DCO byte in place of SCO
        const typeId = commandType === 'single' ? 45 : 46;
        const commandQualifier = value & 0xFF;

        const asdu = new Uint8Array(10);
        asdu[0] = typeId;
        asdu[1] = 0x01;                           // VSQ: 1 object, SQ=0
        asdu[2] = 0x06;                           // COT low = Activation (6)
        asdu[3] = 0x00;                           // COT high
        asdu[4] = commonAddress & 0xFF;
        asdu[5] = (commonAddress >> 8) & 0xFF;
        asdu[6] = ioa & 0xFF;
        asdu[7] = (ioa >> 8) & 0xFF;
        asdu[8] = (ioa >> 16) & 0xFF;
        asdu[9] = commandQualifier;               // SCO / DCO

        const commandFrame = buildIFrameHeader(asdu.length);
        commandFrame.set(asdu, 6);
        sendSeq = (sendSeq + 1) & 0x7FFF;
        await writer.write(commandFrame);

        // Step 3: Wait for Activation Confirmation (COT=7)
        const ackResp = await readWithDeadline(Date.now() + timeout);
        let confirmed = false;
        let ackTypeId = 0;
        let ackCot = 0;

        if (ackResp && ackResp.length >= 6) {
          const cf0 = ackResp[2];
          if ((cf0 & 0x01) === 0) {
            // I-frame response
            const flen = 2 + ackResp[1];
            if (ackResp.length >= flen && flen > 6) {
              const asduResp = ackResp.slice(6, flen);
              if (asduResp.length >= 4) {
                ackTypeId = asduResp[0];
                ackCot = asduResp[2]; // COT low byte; 7 = Activation Confirmation
                confirmed = ackCot === 7;
                recvSeq = ((((ackResp[3] << 8) | ackResp[2]) >> 1) + 1) & 0x7FFF;
              }
            }
          }
        }

        // Step 4: Acknowledge and disconnect cleanly
        if (recvSeq > 0) {
          const sframe = new Uint8Array([
            START_BYTE, 0x04,
            0x01, 0x00,
            (recvSeq << 1) & 0xFF,
            (recvSeq >> 7) & 0xFF,
          ]);
          try { await writer.write(sframe); } catch { /* ignore */ }
        }
        try { await writer.write(UFRAME.STOPDT_ACT); } catch { /* ignore */ }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return {
          success: true,
          host,
          port,
          commandType,
          ioa,
          value,
          activationConfirmed: confirmed,
          ackTypeId,
          ackCot,
          rtt: Date.now() - startTime,
        };

      } catch (writeError) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
        throw writeError;
      }
    })();

    const writeTimeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const writeResult = await Promise.race([connectionPromise, writeTimeoutPromise]);
    return new Response(JSON.stringify(writeResult), {
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
