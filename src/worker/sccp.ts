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

// ─── Line State and Capabilities ─────────────────────────────────────────────

// Additional message IDs for line/button/capabilities queries
const LINE_MSG = {
  BUTTON_TEMPLATE_REQ: 0x000E,  // Station → CallManager
  BUTTON_TEMPLATE_RES: 0x0097,  // CallManager → Station (reused id in some impls)
  CAPABILITIES_REQ_OUT: 0x0021, // Station → CallManager (CapabilitiesRequest)
  // Responses
  BUTTON_TEMPLATE_ACK: 0x0086,  // CallManager → Station
  CAPABILITIES_ACK: 0x0098,     // CallManager → Station
} as const;


// Known SCCP codec IDs (CapabilitiesAck payload)
const CODEC_NAMES: Record<number, string> = {
  1:  'G.711 u-law',
  2:  'G.711 a-law',
  3:  'G.722',
  4:  'G.723.1',
  6:  'G.728',
  7:  'G.729',
  8:  'G.729 Annex A',
  9:  'G.729 Annex B',
  10: 'G.729 Annex A+B',
  11: 'GSM Full Rate',
  12: 'GSM Half Rate',
  16: 'Wideband 256k',
  20: 'G.722.1',
  25: 'iSAC',
  40: 'ILBC',
  82: 'H.261',
  86: 'H.263',
  100: 'Transparent',
};

// Ring mode names
const RING_MODE_NAMES: Record<number, string> = {
  0: 'Off',
  1: 'Inside',
  2: 'Outside',
  3: 'Feature',
};

// Button types
const BUTTON_TYPE_NAMES: Record<number, string> = {
  0x00: 'Unused',
  0x09: 'Line',
  0x15: 'SpeedDial',
  0x21: 'FeatureButton',
  0x26: 'Conference',
  0x27: 'ForwardAll',
  0x28: 'ForwardBusy',
  0x29: 'ForwardNoAnswer',
  0x2A: 'Display',
  0x2B: 'Line(alt)',
  0xFF: 'Unknown',
};

interface SCCPLineRequest {
  host: string;
  port?: number;
  timeout?: number;
  deviceName?: string;
  lineNumber?: number;
}

interface SCCPLineInfo {
  number: number;
  buttonType: string;
  label?: string;
  ringMode?: string;
}

interface SCCPLineStateResponse {
  success: boolean;
  lines: SCCPLineInfo[];
  capabilities: string[];
  connectMs?: number;
  latencyMs?: number;
  error?: string;
}

/**
 * Build a ButtonTemplateRequest message (type 0x000E, no payload).
 */
function buildButtonTemplateRequest(): Uint8Array {
  return encodeMessage(LINE_MSG.BUTTON_TEMPLATE_REQ, new Uint8Array(0));
}

/**
 * Build a CapabilitiesRequest message (type 0x0021, no payload).
 */
function buildCapabilitiesRequest(): Uint8Array {
  return encodeMessage(LINE_MSG.CAPABILITIES_REQ_OUT, new Uint8Array(0));
}

/**
 * Parse a ButtonTemplateResponse payload.
 *
 * Layout (SCCP ButtonTemplateMessage):
 *   Bytes 0-3:  ButtonOffset (uint32 LE) — starting button index
 *   Bytes 4-7:  ButtonCount  (uint32 LE) — count in this message
 *   Bytes 8-11: TotalButtonCount (uint32 LE) — total buttons on device
 *   Bytes 12+:  ButtonDefinition[] — each = { instanceNumber(uint8), buttonDefinition(uint8) }
 *               Some impls include a label (null-terminated string) after each pair.
 */
function parseButtonTemplateResponse(
  data: Uint8Array,
  targetLine?: number,
): SCCPLineInfo[] {
  if (data.length < 12) return [];

  const view = new DataView(data.buffer, data.byteOffset);
  const buttonCount = view.getUint32(4, true);
  const lines: SCCPLineInfo[] = [];

  let offset = 12;
  for (let i = 0; i < buttonCount && offset + 2 <= data.length; i++) {
    const instanceNumber = view.getUint8(offset);
    const buttonDef = view.getUint8(offset + 1);
    offset += 2;

    // Some implementations include a 40-byte label field
    let label: string | undefined;
    if (offset + 40 <= data.length) {
      // Check if next bytes look like a string (printable ASCII or null)
      const peek = data.slice(offset, offset + 40);
      const isLabel = peek.some(b => b >= 0x20 && b <= 0x7E);
      if (isLabel) {
        const nullIdx = peek.indexOf(0);
        label = new TextDecoder().decode(nullIdx !== -1 ? peek.slice(0, nullIdx) : peek).trim();
        if (!label) label = undefined;
        offset += 40;
      }
    }

    const buttonTypeName = BUTTON_TYPE_NAMES[buttonDef] || `0x${buttonDef.toString(16).padStart(2, '0')}`;
    const ringModeName = RING_MODE_NAMES[0]; // default Off for ButtonTemplate

    const lineNumber = instanceNumber;
    if (targetLine === undefined || lineNumber === targetLine) {
      lines.push({
        number: lineNumber,
        buttonType: buttonTypeName,
        label,
        ringMode: ringModeName,
      });
    }
  }

  return lines;
}

/**
 * Parse a CapabilitiesAck payload.
 *
 * Layout:
 *   Bytes 0-3: Count (uint32 LE) — number of capability entries
 *   Each entry (8 bytes):
 *     Bytes 0-3: PayloadCapability (codec ID, uint32 LE)
 *     Bytes 4-7: MaxFramesPerPacket (uint32 LE)
 */
function parseCapabilitiesAck(data: Uint8Array): string[] {
  if (data.length < 4) return [];

  const view = new DataView(data.buffer, data.byteOffset);
  const count = view.getUint32(0, true);
  const capabilities: string[] = [];

  for (let i = 0; i < count; i++) {
    const offset = 4 + i * 8;
    if (offset + 4 > data.length) break;
    const codecId = view.getUint32(offset, true);
    const name = CODEC_NAMES[codecId] || `Codec(${codecId})`;
    if (!capabilities.includes(name)) capabilities.push(name);
  }

  return capabilities;
}

/**
 * Query line state and capabilities from a SCCP/CUCM device.
 *
 * POST /api/sccp/linestate
 * Body: { host, port?, timeout?, deviceName?, lineNumber? }
 *
 * Flow:
 *   1. Connect and send Register (like handleSCCPRegister)
 *   2. Wait for RegisterAck
 *   3. Send ButtonTemplateRequest (0x000E)
 *   4. Parse ButtonTemplateResponse (0x0086 or 0x0097)
 *   5. Send CapabilitiesRequest (0x0021)
 *   6. Parse CapabilitiesAck (0x0098)
 *   7. Return { lines, capabilities, rtt }
 */
export async function handleSCCPLineState(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SCCPLineRequest;
    const {
      host,
      port = 2000,
      timeout = 10000,
      deviceName = 'SEP001122334455',
      lineNumber,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        lines: [],
        capabilities: [],
        error: 'Host is required',
      } satisfies SCCPLineStateResponse), {
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

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // --- Step 1: Register device (type 0x0001) ---
    await writer.write(buildRegister(deviceName, 8 /* Cisco 7960 */));

    // --- Step 2: Wait for RegisterAck (0x0081) or timeout ---
    let buf = await readWithTimeout(reader, 3000);
    let registered = false;
    let capabilitiesRequested = false;

    if (buf.length >= 12) {
      const msgs = parseMessages(buf);
      for (const m of msgs) {
        if (m.messageId === MSG.REGISTER_ACK) registered = true;
        if (m.messageId === MSG.CAPABILITIES_REQ) capabilitiesRequested = true;
      }
    }

    // Even without an explicit ack, attempt the button template query
    // (some servers skip the ack and go straight to capabilities)

    // --- Step 3: Send ButtonTemplateRequest (0x000E) ---
    await writer.write(buildButtonTemplateRequest());

    // --- Step 4: Send CapabilitiesRequest (0x0021) ---
    await writer.write(buildCapabilitiesRequest());

    // --- Step 5: Collect responses ---
    const lines: SCCPLineInfo[] = [];
    const capabilities: string[] = [];

    const readDeadline = Date.now() + Math.min(timeout - (Date.now() - start), 6000);

    // Accumulate all incoming messages until deadline
    const allChunks: Uint8Array[] = buf.length > 0 ? [buf] : [];

    while (Date.now() < readDeadline) {
      const remaining = readDeadline - Date.now();
      if (remaining <= 0) break;

      const st = new Promise<{ value: undefined; done: true }>((resolve) =>
        setTimeout(() => resolve({ value: undefined, done: true }), remaining),
      );

      const { value, done } = await Promise.race([reader.read(), st]);
      if (done || !value) break;
      allChunks.push(value);
    }

    // Combine all chunks
    const totalLen = allChunks.reduce((s, c) => s + c.length, 0);
    const combined = new Uint8Array(totalLen);
    let off = 0;
    for (const c of allChunks) { combined.set(c, off); off += c.length; }

    if (combined.length >= 12) {
      const allMsgs = parseMessages(combined);
      for (const m of allMsgs) {
        if (m.messageId === MSG.REGISTER_ACK) registered = true;
        if (m.messageId === MSG.CAPABILITIES_REQ) capabilitiesRequested = true;

        if (
          m.messageId === LINE_MSG.BUTTON_TEMPLATE_ACK ||
          m.messageId === LINE_MSG.BUTTON_TEMPLATE_RES
        ) {
          const parsed = parseButtonTemplateResponse(m.data, lineNumber);
          lines.push(...parsed);
        }

        if (m.messageId === LINE_MSG.CAPABILITIES_ACK) {
          const caps = parseCapabilitiesAck(m.data);
          capabilities.push(...caps.filter(c => !capabilities.includes(c)));
        }
      }
    }

    const latencyMs = Date.now() - start;

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    // Even if the server didn't send back button/capability data, report
    // what we know about the registration state.
    return new Response(JSON.stringify({
      success: true,
      registered,
      capabilitiesRequested,
      lines,
      capabilities,
      connectMs,
      latencyMs,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      lines: [],
      capabilities: [],
      error: error instanceof Error ? error.message : 'SCCP line state query failed',
    } satisfies SCCPLineStateResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Additional message IDs for call setup
const CALL_MSG = {
  OFF_HOOK:        0x0006, // Station → CM: go off-hook (ready to dial)
  ON_HOOK:         0x0007, // Station → CM: hang up
  KEYPAD_BUTTON:   0x0003, // Station → CM: digit pressed
  CAP_RESPONSE:    0x0020, // Station → CM: list supported codecs (CapabilitiesRes)

  // CM → Station
  START_TONE:      0x0082, // start dial-tone / ring-back / busy
  STOP_TONE:       0x0083,
  CALL_STATE:      0x008F, // call state change
  CALL_INFO:       0x008B, // caller/callee display info
  DISPLAY_TEXT:    0x0091, // text on screen
  DISPLAY_NOTIFY:  0x0024, // notification banner
  OPEN_RCV_CH:     0x0110, // open RTP receive channel
} as const;

const CALL_STATE_NAMES: Record<number, string> = {
  1: 'OffHook', 2: 'OnHook', 3: 'RingOut', 4: 'RingIn',
  5: 'Connected', 6: 'Busy', 7: 'Congestion', 8: 'Hold',
  9: 'CallWaiting', 10: 'CallTransfer', 12: 'Park',
};

/**
 * Build CapabilitiesResponse (0x0020): advertise G.711 u-law + G.729a codecs.
 * Payload: count(4LE) + [codecId(4LE) + maxFrames(4LE)] * n
 */
function buildCapabilitiesResponse(): Uint8Array {
  const codecs = [
    { id: 4, frames: 20 }, // G.711 u-law
    { id: 2, frames: 20 }, // G.711 a-law
    { id: 8, frames: 20 }, // G.729 Annex A
  ];
  const buf = new ArrayBuffer(4 + codecs.length * 8);
  const v = new DataView(buf);
  v.setUint32(0, codecs.length, true);
  for (let i = 0; i < codecs.length; i++) {
    v.setUint32(4 + i * 8,     codecs[i].id,     true);
    v.setUint32(4 + i * 8 + 4, codecs[i].frames, true);
  }
  return encodeMessage(CALL_MSG.CAP_RESPONSE, new Uint8Array(buf));
}

/**
 * Build OffHookMessage (0x0006): 8-byte payload (lineInstance + callRef both 0).
 */
function buildOffHook(): Uint8Array {
  const data = new Uint8Array(8); // all zeros = line 0, call 0
  return encodeMessage(CALL_MSG.OFF_HOOK, data);
}

/**
 * Build KeypadButtonMessage (0x0003) for a single digit character.
 * Payload: button(1) + lineInstance(1) + callRef(1) + pad(1)
 */
function buildKeypadDigit(digit: string): Uint8Array {
  const data = new Uint8Array(4);
  data[0] = digit.charCodeAt(0);
  return encodeMessage(CALL_MSG.KEYPAD_BUTTON, data);
}

/**
 * SCCP Call Setup Handler
 * POST /api/sccp/call-setup
 * Body: { host, port=2000, deviceName='SEP001122334455', dialNumber='1000', timeout=15000 }
 *
 * Flow:
 *  1. Register device → wait for RegisterAck / CapabilitiesReq
 *  2. Send CapabilitiesResponse (codec list)
 *  3. Send OffHook → server should respond with StartTone (dial tone)
 *  4. Dial digits (KeypadButton per digit)
 *  5. Collect server responses (CallState, CallInfo, OpenReceiveChannel)
 */
export async function handleSCCPCallSetup(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number; timeout?: number;
      deviceName?: string; dialNumber?: string;
    };
    const {
      host,
      port = 2000,
      timeout = 15000,
      deviceName = 'SEP001122334455',
      dialNumber = '1000',
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();
    const socket = connect(`${host}:${port}`);

    const tOut = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout));
    await Promise.race([socket.opened, tOut]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      // 1. Register
      await writer.write(buildRegister(deviceName, 8 /* Cisco 7960 */));

      let buf = await readWithTimeout(reader, 3000);
      let registered = false;
      let capRequested = false;

      const checkMsgs = (data: Uint8Array) => {
        if (data.length < 12) return;
        for (const m of parseMessages(data)) {
          if (m.messageId === MSG.REGISTER_ACK)    registered = true;
          if (m.messageId === MSG.CAPABILITIES_REQ) capRequested = true;
        }
      };
      checkMsgs(buf);

      // 2. Send CapabilitiesResponse (whether or not server explicitly asked)
      await writer.write(buildCapabilitiesResponse());

      // 3. Send OffHook
      await writer.write(buildOffHook());

      buf = await readWithTimeout(reader, 3000);
      checkMsgs(buf);

      // 4. Dial digits
      const digits = dialNumber.replace(/[^0-9*#]/g, '');
      for (const ch of digits) {
        await writer.write(buildKeypadDigit(ch));
        await new Promise(r => setTimeout(r, 100));
      }

      // 5. Collect remaining server messages
      const deadline = Date.now() + Math.min(timeout - (Date.now() - start), 6000);
      const allChunks: Uint8Array[] = buf.length > 0 ? [buf] : [];

      while (Date.now() < deadline) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        const st = new Promise<{ value: undefined; done: true }>(r =>
          setTimeout(() => r({ value: undefined, done: true }), remaining));
        const { value, done } = await Promise.race([reader.read(), st]);
        if (done || !value) break;
        allChunks.push(value);
      }

      const totalLen = allChunks.reduce((s, c) => s + c.length, 0);
      const combined = new Uint8Array(totalLen);
      let off = 0;
      for (const c of allChunks) { combined.set(c, off); off += c.length; }

      // Parse all collected messages
      const serverMessages: Array<{ id: string; name: string }> = [];
      let toneStarted = false;
      let callState: string | undefined;
      let displayText: string | undefined;
      let openReceiveChannel = false;

      if (combined.length >= 12) {
        checkMsgs(combined);
        for (const m of parseMessages(combined)) {
          serverMessages.push({
            id: `0x${m.messageId.toString(16).padStart(4, '0')}`,
            name: m.name,
          });
          if (m.messageId === CALL_MSG.START_TONE) toneStarted = true;
          if (m.messageId === CALL_MSG.CALL_STATE && m.data.length >= 4) {
            const stateCode = new DataView(m.data.buffer, m.data.byteOffset).getUint32(0, true);
            callState = CALL_STATE_NAMES[stateCode] ?? `Unknown(${stateCode})`;
          }
          if (m.messageId === CALL_MSG.DISPLAY_TEXT && m.data.length > 0) {
            displayText = new TextDecoder().decode(m.data).replace(/\0.*$/, '').trim();
          }
          if (m.messageId === CALL_MSG.OPEN_RCV_CH) openReceiveChannel = true;
        }
      }

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: true,
        registered,
        capabilitiesRequested: capRequested,
        offHookSent: true,
        digitsSent: digits,
        toneStarted,
        callState,
        displayText,
        openReceiveChannel,
        serverMessages,
        latencyMs: Date.now() - start,
        note: !registered
          ? 'Server did not send RegisterAck — may require authorized device name/MAC'
          : undefined,
      }), { headers: { 'Content-Type': 'application/json' } });

    } finally {
      try { writer.releaseLock(); } catch { /* ignore */ }
      try { reader.releaseLock(); } catch { /* ignore */ }
      try { socket.close(); }       catch { /* ignore */ }
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'SCCP call setup failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
