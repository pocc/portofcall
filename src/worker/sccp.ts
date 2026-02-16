/**
 * SCCP (Skinny Client Control Protocol) Implementation
 *
 * SCCP (Skinny) is Cisco's proprietary VoIP signaling protocol used by
 * Cisco IP phones to communicate with Cisco Unified Communications Manager (CUCM).
 *
 * Protocol Flow:
 * 1. Client connects to CUCM on TCP port 2000
 * 2. Client sends binary messages (12-byte header + payload)
 * 3. Server responds with acknowledgment or rejection
 *
 * Message Format:
 * - Bytes 0-3: Message Length (LE uint32, includes reserved + message ID + data)
 * - Bytes 4-7: Reserved (always 0x00000000)
 * - Bytes 8-11: Message ID (LE uint32)
 * - Bytes 12+: Message Data (variable)
 */

import { connect } from 'cloudflare:sockets';

// Message IDs
const MSG = {
  // Station -> CallManager
  KEEP_ALIVE: 0x0000,
  REGISTER: 0x0001,
  IP_PORT: 0x0002,
  CAPABILITIES_RES: 0x0020,

  // CallManager -> Station
  KEEP_ALIVE_ACK: 0x0100,
  REGISTER_ACK: 0x0081,
  REGISTER_REJECT: 0x0082,
  CAPABILITIES_REQ: 0x0097,
} as const;

// Known device types
const DEVICE_TYPES: Record<number, string> = {
  1: 'Cisco 30 SP+',
  2: 'Cisco 12 SP+',
  3: 'Cisco 12 SP',
  4: 'Cisco 12 S',
  5: 'Cisco 30 VIP',
  6: 'Cisco Telecaster',
  7: 'Cisco 7910',
  8: 'Cisco 7960',
  9: 'Cisco 7940',
  12: 'Cisco 7935',
  20: 'Cisco 7920',
  30007: 'Cisco 7961',
  30008: 'Cisco 7941',
};

// Known message names for display
const MSG_NAMES: Record<number, string> = {
  0x0000: 'KeepAlive',
  0x0001: 'Register',
  0x0002: 'IpPort',
  0x0020: 'CapabilitiesResponse',
  0x0081: 'RegisterAck',
  0x0082: 'RegisterReject',
  0x0088: 'SetLamp',
  0x0089: 'SetRinger',
  0x008A: 'SetSpeakerMode',
  0x008F: 'CallState',
  0x0091: 'DisplayText',
  0x0095: 'ClearDisplay',
  0x0097: 'CapabilitiesRequest',
  0x0100: 'KeepAliveAck',
  0x0105: 'StartMediaTransmission',
  0x0106: 'StopMediaTransmission',
  0x0110: 'OpenReceiveChannel',
  0x0111: 'CloseReceiveChannel',
  0x0113: 'StartTone',
};

interface SCCPRequest {
  host: string;
  port?: number;
  deviceName?: string;
  deviceType?: number;
  timeout?: number;
}

/**
 * Encode an SCCP message with the 12-byte header.
 * Length field = reserved(4) + messageId(4) + data.length
 */
function encodeMessage(messageId: number, data: Uint8Array): Uint8Array {
  const dataLen = data.length;
  const messageLength = 4 + 4 + dataLen; // reserved + msgId + data
  const total = 4 + messageLength; // length field + rest

  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const arr = new Uint8Array(buf);

  view.setUint32(0, messageLength, true); // Message Length (LE)
  view.setUint32(4, 0, true);            // Reserved
  view.setUint32(8, messageId, true);     // Message ID (LE)
  arr.set(data, 12);                      // Payload

  return arr;
}

/**
 * Build a KeepAlive message (no payload).
 */
function buildKeepAlive(): Uint8Array {
  return encodeMessage(MSG.KEEP_ALIVE, new Uint8Array(0));
}

/**
 * Build a Station Register message.
 *
 * Layout (28 bytes):
 * - Bytes 0-15: Device Name (16 bytes, null-terminated)
 * - Bytes 16-19: User ID (uint32 LE)
 * - Bytes 20-23: Instance (uint32 LE)
 * - Bytes 24-27: Device Type (uint32 LE)
 */
function buildRegister(deviceName: string, deviceType: number): Uint8Array {
  const data = new ArrayBuffer(28);
  const view = new DataView(data);
  const arr = new Uint8Array(data);

  // Device Name (16 bytes, null-terminated)
  const name = deviceName.substring(0, 15);
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(name);
  arr.set(nameBytes, 0);

  // User ID
  view.setUint32(16, 0, true);

  // Instance
  view.setUint32(20, 1, true);

  // Device Type
  view.setUint32(24, deviceType, true);

  return encodeMessage(MSG.REGISTER, arr);
}

/**
 * Parse a response message from the server.
 * Returns an array of parsed messages (there may be multiple in a single read).
 */
function parseMessages(data: Uint8Array): Array<{ messageId: number; name: string; data: Uint8Array }> {
  const messages: Array<{ messageId: number; name: string; data: Uint8Array }> = [];
  let offset = 0;

  while (offset + 12 <= data.length) {
    const view = new DataView(data.buffer, data.byteOffset + offset, Math.min(12, data.length - offset));
    const messageLength = view.getUint32(0, true);
    const messageId = view.getUint32(8, true);

    const totalSize = 4 + messageLength; // length field + payload
    const msgData = data.slice(offset + 12, offset + totalSize);

    messages.push({
      messageId,
      name: MSG_NAMES[messageId] || `Unknown(0x${messageId.toString(16).padStart(4, '0')})`,
      data: msgData,
    });

    offset += totalSize;
    if (totalSize < 12) break; // safety guard
  }

  return messages;
}

/**
 * Read from socket with timeout, collecting all available data.
 */
async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeout: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLen = 0;

  const timeoutPromise = new Promise<{ value: undefined; done: true }>((resolve) => {
    setTimeout(() => resolve({ value: undefined, done: true }), timeout);
  });

  // Read for up to 2 iterations or until done
  for (let i = 0; i < 3; i++) {
    const result = await Promise.race([reader.read(), timeoutPromise]);
    if (result.done || !result.value) break;
    chunks.push(result.value);
    totalLen += result.value.length;
  }

  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return combined;
}

/**
 * Handle SCCP probe - send KeepAlive and check for response.
 * This is the lightest way to detect a SCCP/CUCM server.
 */
export async function handleSCCPProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SCCPRequest;
    const { host, port = 2000, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);
    const connectMs = Date.now() - start;

    // Send KeepAlive
    const writer = socket.writable.getWriter();
    await writer.write(buildKeepAlive());
    writer.releaseLock();

    // Read response
    const reader = socket.readable.getReader();
    const responseData = await readWithTimeout(reader, 5000);
    reader.releaseLock();

    const latencyMs = Date.now() - start;
    socket.close();

    const messages = responseData.length >= 12 ? parseMessages(responseData) : [];

    const hasKeepAliveAck = messages.some(m => m.messageId === MSG.KEEP_ALIVE_ACK);

    return new Response(JSON.stringify({
      success: true,
      probe: 'keepalive',
      connected: true,
      keepAliveAck: hasKeepAliveAck,
      connectMs,
      latencyMs,
      responseBytes: responseData.length,
      messages: messages.map(m => ({
        id: `0x${m.messageId.toString(16).padStart(4, '0')}`,
        name: m.name,
        dataLength: m.data.length,
      })),
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'SCCP probe failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle SCCP register - attempt device registration with CUCM.
 * Sends a Station Register message and parses the response.
 */
export async function handleSCCPRegister(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SCCPRequest;
    const {
      host,
      port = 2000,
      deviceName = 'SEP001122334455',
      deviceType = 8,
      timeout = 10000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const deviceTypeName = DEVICE_TYPES[deviceType] || `Unknown (${deviceType})`;

    const start = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);
    const connectMs = Date.now() - start;

    // Send Register message
    const writer = socket.writable.getWriter();
    await writer.write(buildRegister(deviceName, deviceType));
    writer.releaseLock();

    // Read response(s)
    const reader = socket.readable.getReader();
    const responseData = await readWithTimeout(reader, 5000);
    reader.releaseLock();

    const latencyMs = Date.now() - start;
    socket.close();

    const messages = responseData.length >= 12 ? parseMessages(responseData) : [];

    const registered = messages.some(m => m.messageId === MSG.REGISTER_ACK);
    const rejected = messages.some(m => m.messageId === MSG.REGISTER_REJECT);
    const capReq = messages.some(m => m.messageId === MSG.CAPABILITIES_REQ);

    let status = 'unknown';
    if (registered) status = 'registered';
    else if (rejected) status = 'rejected';
    else if (messages.length === 0) status = 'no_response';

    return new Response(JSON.stringify({
      success: true,
      registration: {
        status,
        deviceName,
        deviceType,
        deviceTypeName,
        registered,
        rejected,
        capabilitiesRequested: capReq,
      },
      connectMs,
      latencyMs,
      responseBytes: responseData.length,
      messages: messages.map(m => ({
        id: `0x${m.messageId.toString(16).padStart(4, '0')}`,
        name: m.name,
        dataLength: m.data.length,
      })),
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'SCCP registration failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
