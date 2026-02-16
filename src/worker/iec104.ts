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
