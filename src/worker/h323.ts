/**
 * H.323 Protocol Worker Handler
 *
 * Implements H.225 call signaling probe based on Q.931 (ITU-T).
 * H.323 is a legacy VoIP/multimedia standard on port 1720 (TCP).
 *
 * Message structure:
 * - Protocol Discriminator: 0x08 (Q.931)
 * - Call Reference Length: 2 bytes
 * - Call Reference: unique call ID
 * - Message Type: Setup (0x05), Release Complete (0x5A), etc.
 * - Information Elements: Bearer Capability, User-User (H.323), etc.
 *
 * The probe sends a minimal SETUP message and parses the response
 * (Call Proceeding, Release Complete, or other Q.931 messages).
 *
 * handleH323Connect — send Q.931 SETUP, parse full response exchange
 * handleH323Register — send H.225 Setup UUIE (GRQ-style discovery)
 * handleH323Info — lightweight port probe returning connection metadata
 */

import { connect } from 'cloudflare:sockets';

// Q.931 Message Types
const Q931_PROTOCOL_DISCRIMINATOR = 0x08;
const Q931_SETUP = 0x05;
const Q931_CALL_PROCEEDING = 0x02;
const Q931_ALERTING = 0x01;
const Q931_CONNECT = 0x07;
const Q931_RELEASE_COMPLETE = 0x5a;
const Q931_FACILITY = 0x62;
const Q931_PROGRESS = 0x03;
const Q931_STATUS = 0x7d;

// Information Element identifiers
const IE_BEARER_CAPABILITY = 0x04;
const IE_DISPLAY = 0x28;
const IE_CALLED_PARTY_NUMBER = 0x70;
const IE_CALLING_PARTY_NUMBER = 0x6c;
const IE_USER_USER = 0x7e;

// H.323 User-User IE protocol discriminator
const H323_UU_PROTOCOL_DISCRIMINATOR = 0x05;

function getMessageTypeName(type: number): string {
  switch (type) {
    case Q931_SETUP: return 'SETUP';
    case Q931_CALL_PROCEEDING: return 'CALL PROCEEDING';
    case Q931_ALERTING: return 'ALERTING';
    case Q931_CONNECT: return 'CONNECT';
    case Q931_RELEASE_COMPLETE: return 'RELEASE COMPLETE';
    case Q931_FACILITY: return 'FACILITY';
    case Q931_PROGRESS: return 'PROGRESS';
    case Q931_STATUS: return 'STATUS';
    default: return `UNKNOWN (0x${type.toString(16).padStart(2, '0')})`;
  }
}

function getCauseDescription(causeValue: number): string {
  const cause = causeValue & 0x7f; // Mask out extension bit
  switch (cause) {
    case 1: return 'Unallocated number';
    case 2: return 'No route to transit network';
    case 3: return 'No route to destination';
    case 6: return 'Channel unacceptable';
    case 16: return 'Normal call clearing';
    case 17: return 'User busy';
    case 18: return 'No user responding';
    case 19: return 'No answer from user';
    case 21: return 'Call rejected';
    case 22: return 'Number changed';
    case 27: return 'Destination out of order';
    case 28: return 'Invalid number format';
    case 29: return 'Facility rejected';
    case 31: return 'Normal, unspecified';
    case 34: return 'No circuit/channel available';
    case 38: return 'Network out of order';
    case 41: return 'Temporary failure';
    case 42: return 'Switching equipment congestion';
    case 47: return 'Resource unavailable, unspecified';
    case 55: return 'Incompatible destination';
    case 57: return 'Bearer capability not authorized';
    case 58: return 'Bearer capability not presently available';
    case 63: return 'Service/option not available';
    case 65: return 'Bearer capability not implemented';
    case 79: return 'Service/option not implemented';
    case 81: return 'Invalid call reference';
    case 88: return 'Incompatible destination';
    case 95: return 'Invalid message, unspecified';
    case 96: return 'Mandatory IE missing';
    case 97: return 'Message type non-existent';
    case 98: return 'Message not compatible';
    case 99: return 'IE non-existent';
    case 100: return 'Invalid IE contents';
    case 102: return 'Recovery on timer expiry';
    case 111: return 'Protocol error, unspecified';
    case 127: return 'Interworking, unspecified';
    default: return `Cause ${cause}`;
  }
}

/**
 * Build a minimal Q.931 SETUP message for H.323 probing.
 * Includes Bearer Capability, Display, Called/Calling Party Number, and H.323 User-User IE.
 */
function buildSetupMessage(callRef: number, callingNumber: string, calledNumber: string): Uint8Array {
  const parts: Uint8Array[] = [];
  const encoder = new TextEncoder();

  // --- Q.931 Header ---
  parts.push(new Uint8Array([Q931_PROTOCOL_DISCRIMINATOR]));
  parts.push(new Uint8Array([0x02]));  // Call Reference Length = 2
  // Call Reference value (originating side: bit 7 of first byte = 0)
  parts.push(new Uint8Array([(callRef >> 8) & 0x7f, callRef & 0xff]));
  parts.push(new Uint8Array([Q931_SETUP]));

  // --- Bearer Capability IE ---
  parts.push(new Uint8Array([
    IE_BEARER_CAPABILITY,
    0x03,  // Length
    0x80,  // Coding: ITU-T, Information Transfer Capability: speech
    0x90,  // Transfer rate: 64 kbps
    0xa3,  // Layer 1 protocol: H.221 and H.242
  ]));

  // --- Display IE ---
  const displayText = `Probe from ${callingNumber}`;
  const displayBytes = encoder.encode(displayText);
  parts.push(new Uint8Array([IE_DISPLAY, displayBytes.length]));
  parts.push(displayBytes);

  // --- Called Party Number IE ---
  if (calledNumber) {
    const calledBytes = encoder.encode(calledNumber);
    parts.push(new Uint8Array([
      IE_CALLED_PARTY_NUMBER,
      calledBytes.length + 1,
      0x80,  // Type: unknown, Plan: unknown
    ]));
    parts.push(calledBytes);
  }

  // --- Calling Party Number IE ---
  if (callingNumber) {
    const callingBytes = encoder.encode(callingNumber);
    parts.push(new Uint8Array([
      IE_CALLING_PARTY_NUMBER,
      callingBytes.length + 2,
      0x00,  // Type: unknown, Plan: unknown
      0x80,  // Screening: user-provided, not screened
    ]));
    parts.push(callingBytes);
  }

  // --- User-User IE (H.323-specific H.225 Setup-UUIE stub) ---
  // Per H.225.0: H.323 endpoint identification uses ASN.1 PER.
  // This is a minimal stub that signals H.323 identity to the gatekeeper.
  // H.225 Protocol Identifier OID: 0.0.8.2250.0.4 (H.225 v4) encoded as 6 bytes.
  const uuData = new Uint8Array([
    H323_UU_PROTOCOL_DISCRIMINATOR,  // H.323 UU protocol discriminator
    // H.225.0 v4 protocol identifier (simplified OID encoding)
    0x00, 0x08, 0x91, 0x4a, 0x00, 0x04,
    // sourceAddress: empty (omitted)
    0x00,
    // activeMC: false
    0x00,
  ]);
  parts.push(new Uint8Array([IE_USER_USER, uuData.length]));
  parts.push(uuData);

  // Concatenate all parts
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const message = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    message.set(part, offset);
    offset += part.length;
  }

  return message;
}

/**
 * Build a Q.931 RELEASE COMPLETE message to cleanly terminate a call.
 */
function buildReleaseComplete(callRef: number): Uint8Array {
  return new Uint8Array([
    Q931_PROTOCOL_DISCRIMINATOR,
    0x02,                              // Call Reference Length
    ((callRef >> 8) & 0x7f) | 0x80,   // Call ref with response flag (bit 7 = 1)
    callRef & 0xff,
    Q931_RELEASE_COMPLETE,
    // Cause IE: Normal call clearing (cause 16)
    0x08, // Cause IE identifier
    0x02, // Length
    0x80, // Coding: ITU-T, Location: user
    0x90, // Cause value: Normal call clearing (16) + extension bit
  ]);
}

interface ParsedQ931Message {
  protocolDiscriminator: number;
  callRefLength: number;
  callRef: number;
  messageType: number;
  messageTypeName: string;
  informationElements: ParsedIE[];
  cause?: { value: number; description: string };
  display?: string;
  raw: Uint8Array;
}

interface ParsedIE {
  id: number;
  name: string;
  length: number;
  data: Uint8Array;
}

function getIEName(id: number): string {
  switch (id) {
    case IE_BEARER_CAPABILITY: return 'Bearer Capability';
    case IE_DISPLAY: return 'Display';
    case IE_CALLED_PARTY_NUMBER: return 'Called Party Number';
    case IE_CALLING_PARTY_NUMBER: return 'Calling Party Number';
    case IE_USER_USER: return 'User-User';
    case 0x08: return 'Cause';
    case 0x14: return 'Call State';
    case 0x1c: return 'Facility';
    case 0x1e: return 'Progress Indicator';
    case 0x27: return 'Notification Indicator';
    case 0x34: return 'Signal';
    case 0x4c: return 'Connected Number';
    default: return `IE 0x${id.toString(16).padStart(2, '0')}`;
  }
}

/**
 * Parse a Q.931 message from raw bytes.
 */
function parseQ931Message(data: Uint8Array): ParsedQ931Message | null {
  if (data.length < 5) return null;

  let offset = 0;
  const protocolDiscriminator = data[offset++];
  const callRefLength = data[offset++];

  let callRef = 0;
  for (let i = 0; i < callRefLength && offset < data.length; i++) {
    callRef = (callRef << 8) | data[offset++];
  }

  if (offset >= data.length) return null;
  const messageType = data[offset++];

  const informationElements: ParsedIE[] = [];
  let cause: { value: number; description: string } | undefined;
  let display: string | undefined;
  const decoder = new TextDecoder('utf-8', { fatal: false });

  // Parse Information Elements
  while (offset < data.length) {
    const ieId = data[offset++];

    // Single-octet IEs (bit 7 = 1 for some codeset 0 IEs)
    if ((ieId & 0x80) !== 0 && ieId !== IE_USER_USER && ieId !== IE_CALLED_PARTY_NUMBER && ieId !== IE_CALLING_PARTY_NUMBER) {
      if (ieId >= 0x90 && ieId <= 0x9f) continue; // Sending complete
      if (ieId >= 0xa0 && ieId <= 0xaf) continue; // Congestion level
      if (ieId >= 0xb0 && ieId <= 0xbf) continue; // Repeat indicator
    }

    if (offset >= data.length) break;
    const ieLength = data[offset++];
    if (offset + ieLength > data.length) break;

    const ieData = data.slice(offset, offset + ieLength);
    offset += ieLength;

    informationElements.push({
      id: ieId,
      name: getIEName(ieId),
      length: ieLength,
      data: ieData,
    });

    // Extract cause value
    if (ieId === 0x08 && ieLength >= 2) {
      const causeValue = ieData[ieLength - 1];
      cause = {
        value: causeValue & 0x7f,
        description: getCauseDescription(causeValue),
      };
    }

    // Extract display text
    if (ieId === IE_DISPLAY && ieLength > 0) {
      display = decoder.decode(ieData);
    }
  }

  return {
    protocolDiscriminator,
    callRefLength,
    callRef,
    messageType,
    messageTypeName: getMessageTypeName(messageType),
    informationElements,
    cause,
    display,
    raw: data,
  };
}

/**
 * Read exact number of bytes from the socket with a deadline.
 */
export async function readExact(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  length: number,
  timeoutMs: number,
): Promise<Uint8Array> {
  const buffer = new Uint8Array(length);
  let offset = 0;

  const deadline = Date.now() + timeoutMs;

  while (offset < length) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Read timeout');

    const readPromise = reader.read();
    const timeoutPromise = new Promise<{ done: true; value: undefined }>((resolve) =>
      setTimeout(() => resolve({ done: true, value: undefined }), remaining)
    );

    const { done, value } = await Promise.race([readPromise, timeoutPromise]);
    if (done || !value) throw new Error('Connection closed');

    const toCopy = Math.min(value.length, length - offset);
    buffer.set(value.subarray(0, toCopy), offset);
    offset += toCopy;
  }

  return buffer;
}

/**
 * Wrap a PDU in a TPKT header (RFC 1006).
 * TPKT: version (1 byte, always 3), reserved (1 byte, 0), length (2 bytes big-endian).
 * The length field includes the 4-byte TPKT header itself.
 */
function wrapTPKT(payload: Uint8Array): Uint8Array {
  const totalLength = payload.length + 4;
  const frame = new Uint8Array(totalLength);
  frame[0] = 3;   // TPKT version
  frame[1] = 0;   // Reserved
  frame[2] = (totalLength >> 8) & 0xff;
  frame[3] = totalLength & 0xff;
  frame.set(payload, 4);
  return frame;
}

/**
 * Read a single TPKT-framed PDU from the socket.
 * Reads the 4-byte TPKT header, validates version=3, extracts payload length,
 * then reads exactly (length - 4) bytes of payload.
 * Returns the payload (without the TPKT header) or null on timeout/close.
 */
async function readTPKTFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<Uint8Array | null> {
  let header: Uint8Array;
  try {
    header = await readExact(reader, 4, timeoutMs);
  } catch {
    return null; // timeout or connection closed
  }

  // Validate TPKT version byte
  if (header[0] !== 3) {
    return null;
  }

  const totalLength = (header[2] << 8) | header[3];
  if (totalLength < 4) {
    return null; // invalid: length must be at least 4 (the header itself)
  }

  const payloadLength = totalLength - 4;
  if (payloadLength === 0) {
    return new Uint8Array(0);
  }

  try {
    return await readExact(reader, payloadLength, timeoutMs);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// handleH323Register
// ---------------------------------------------------------------------------

interface H323RegisterResult {
  success: boolean;
  messageType: number;
  messageTypeName: string;
  h225Version: string;
  destinationAddress?: string;
  latencyMs: number;
  raw: number[];
  cause?: { value: number; description: string };
  display?: string;
  error?: string;
}

/**
 * Send an H.225 Setup message (GRQ-style gatekeeper discovery over TCP port 1720).
 *
 * Background: H.225 RAS uses UDP port 1719 for GatekeeperRequest (GRQ) messages.
 * Because Cloudflare Workers expose TCP-only via connect(), we instead connect to
 * TCP port 1720 (Q.931 call signaling) and send an H.225 Setup-UUIE that announces
 * H.323 capability.  Responses like CALL PROCEEDING, ALERTING, CONNECT, or
 * RELEASE COMPLETE reveal gatekeeper/gateway presence and capability.
 *
 * Q.931 SETUP message contents:
 *   - Protocol Discriminator: 0x08
 *   - Call Reference: 2-byte random ID
 *   - Message Type: 0x05 (SETUP)
 *   - Bearer Capability IE
 *   - Display IE
 *   - Called Party Number IE
 *   - Calling Party Number IE
 *   - User-User IE with H.225 UUIE stub (H.225 v4 protocol ID)
 *
 * Parsed response fields:
 *   messageType / messageTypeName  — Q.931 message code
 *   h225Version                    — extracted from User-User IE if present
 *   destinationAddress             — Connected Number IE if present
 *   cause                          — Q.931 Cause IE (Release Complete)
 *   latencyMs                      — round-trip time
 *   raw                            — first response packet bytes
 *
 * POST /api/h323/register
 * Body: { host, port=1720, calledNumber='100', callingNumber='200', timeout=10000 }
 */
export async function handleH323Register(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.json() as {
      host?: string;
      port?: number;
      calledNumber?: string;
      callingNumber?: string;
      timeout?: number;
    };

    const host = (body.host ?? '').trim();
    const port = body.port ?? 1720;
    const calledNumber = (body.calledNumber ?? '100').trim();
    const callingNumber = (body.callingNumber ?? '200').trim();
    const timeout = Math.min(body.timeout ?? 10000, 30000);

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const phoneRegex = /^[0-9*#+]+$/;
    if (callingNumber && !phoneRegex.test(callingNumber)) {
      return new Response(JSON.stringify({ success: false, error: 'Calling number contains invalid characters' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (calledNumber && !phoneRegex.test(calledNumber)) {
      return new Response(JSON.stringify({ success: false, error: 'Called number contains invalid characters' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const registerPromise = (async (): Promise<H323RegisterResult> => {
      const startTime = Date.now();
      const socket = connect({ hostname: host, port });
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Generate a random call reference (1–0x7FFF)
        const callRef = (Math.floor(Math.random() * 0x7ffe) + 1);

        // Build and send H.225 Setup UUIE over Q.931, wrapped in TPKT
        const setupMsg = buildSetupMessage(callRef, callingNumber, calledNumber);
        await writer.write(wrapTPKT(setupMsg));

        // Read the first TPKT-framed response
        const readTimeout = Math.max(timeout - (Date.now() - startTime) - 200, 1000);
        const responseData = await readTPKTFrame(reader, readTimeout);
        const latencyMs = Date.now() - startTime;

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        if (!responseData) {
          return {
            success: false,
            messageType: 0,
            messageTypeName: 'NO RESPONSE',
            h225Version: 'Unknown',
            latencyMs,
            raw: [],
            error: 'No response received from server',
          };
        }

        const parsed = parseQ931Message(responseData);

        if (!parsed) {
          return {
            success: true,
            messageType: responseData[0] ?? 0,
            messageTypeName: 'UNPARSEABLE',
            h225Version: 'Unknown',
            latencyMs,
            raw: Array.from(responseData.slice(0, 64)),
            error: 'Could not parse Q.931 response',
          };
        }

        // Extract H.225 version from User-User IE if present
        let h225Version = 'Unknown';
        let destinationAddress: string | undefined;

        for (const ie of parsed.informationElements) {
          if (ie.id === IE_USER_USER && ie.length >= 7) {
            // User-User IE: first byte = protocol discriminator (0x05 for H.323)
            // Bytes 1–6: H.225 OID (protocol version info)
            if (ie.data[0] === H323_UU_PROTOCOL_DISCRIMINATOR) {
              // Derive version from byte 5 of the OID field (byte 6 overall)
              const versionByte = ie.data[5] ?? 0;
              h225Version = `H.225 v${versionByte === 0 ? 1 : versionByte}`;
            }
          }
          // Connected Number IE (0x4c) carries the destination address post-connect
          if (ie.id === 0x4c && ie.length > 1) {
            const decoder = new TextDecoder('utf-8', { fatal: false });
            destinationAddress = decoder.decode(ie.data.slice(1));
          }
        }

        // Determine success: any response except parse failure is a successful probe
        const success = parsed.messageType !== 0;

        return {
          success,
          messageType: parsed.messageType,
          messageTypeName: parsed.messageTypeName,
          h225Version,
          destinationAddress,
          latencyMs,
          raw: Array.from(responseData.slice(0, 64)),
          cause: parsed.cause,
          display: parsed.display,
        };
      } catch (err) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        throw err;
      }
    })();

    const result = await Promise.race([registerPromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'H.323 register failed',
      messageType: 0,
      messageTypeName: 'ERROR',
      h225Version: 'Unknown',
      latencyMs: 0,
      raw: [],
    } satisfies H323RegisterResult), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ---------------------------------------------------------------------------
// handleH323Info
// ---------------------------------------------------------------------------

/**
 * Lightweight H.323 port probe.
 * Connects to the H.323 signaling port, sends a minimal SETUP, and returns
 * connection metadata — server responsiveness, latency, and any Q.931 details
 * gleaned from the connection attempt — without committing to a full call flow.
 *
 * This is useful for:
 * - Verifying an H.323 endpoint or gatekeeper is live
 * - Measuring connect latency
 * - Detecting whether the port speaks Q.931 at all
 *
 * POST /api/h323/info
 * Body: { host, port=1720, timeout=10000 }
 */
export async function handleH323Info(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.json() as {
      host?: string;
      port?: number;
      timeout?: number;
    };

    const host = (body.host ?? '').trim();
    const port = body.port ?? 1720;
    const timeout = Math.min(body.timeout ?? 10000, 30000);

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const infoPromise = (async () => {
      const startTime = Date.now();
      const socket = connect({ hostname: host, port });
      await socket.opened;
      const connectTime = Date.now() - startTime;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Send a minimal SETUP to provoke any Q.931 response, wrapped in TPKT
        const callRef = (Math.floor(Math.random() * 0x7ffe) + 1);
        const setupMsg = buildSetupMessage(callRef, '200', '100');
        await writer.write(wrapTPKT(setupMsg));

        const readTimeout = Math.max(timeout - connectTime - 200, 1000);
        const responseData = await readTPKTFrame(reader, readTimeout);
        const rtt = Date.now() - startTime;

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        let q931 = false;
        let messageTypeName = 'No response';
        let messageType = -1;
        let cause: { value: number; description: string } | undefined;
        let display: string | undefined;

        if (responseData) {
          const parsed = parseQ931Message(responseData);
          if (parsed && parsed.protocolDiscriminator === Q931_PROTOCOL_DISCRIMINATOR) {
            q931 = true;
            messageType = parsed.messageType;
            messageTypeName = parsed.messageTypeName;
            cause = parsed.cause;
            display = parsed.display;
          } else if (responseData.length > 0) {
            messageTypeName = `Non-Q.931 data (${responseData.length} bytes)`;
          }
        }

        return {
          success: true,
          host,
          port,
          connectTime,
          rtt,
          protocol: 'H.323/Q.931',
          q931Detected: q931,
          messageType: messageType >= 0 ? messageType : undefined,
          messageTypeName,
          cause,
          display,
        };
      } catch (err) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        throw err;
      }
    })();

    const result = await Promise.race([infoPromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'H.323 info probe failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ---------------------------------------------------------------------------
// handleH323Connect  (original, unchanged)
// ---------------------------------------------------------------------------

/**
 * Handle H.323 call signaling probe.
 * Sends a Q.931 SETUP message and parses the full response exchange
 * (Call Proceeding → Alerting → Connect/Release Complete).
 *
 * POST /api/h323/connect
 * Body: { host, port=1720, callingNumber='1000', calledNumber='2000', timeout=10000 }
 */
export async function handleH323Connect(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.json() as {
      host?: string;
      port?: number;
      callingNumber?: string;
      calledNumber?: string;
      timeout?: number;
    };

    const host = (body.host || '').trim();
    const port = body.port ?? 1720;
    const callingNumber = (body.callingNumber || '1000').trim();
    const calledNumber = (body.calledNumber || '2000').trim();
    const timeout = Math.min(body.timeout || 10000, 30000);

    // Validation
    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate phone numbers (allow digits, *, #, +)
    const phoneRegex = /^[0-9*#+]+$/;
    if (callingNumber && !phoneRegex.test(callingNumber)) {
      return new Response(JSON.stringify({ success: false, error: 'Calling number contains invalid characters' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (calledNumber && !phoneRegex.test(calledNumber)) {
      return new Response(JSON.stringify({ success: false, error: 'Called number contains invalid characters' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();

    // Connect to the H.323 gateway/terminal
    const socket = connect({ hostname: host, port });
    await socket.opened;
    const connectTime = Date.now() - startTime;

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      // Generate random call reference
      const callRef = Math.floor(Math.random() * 0x7fff) + 1;

      // Build and send SETUP message, wrapped in TPKT
      const setupMsg = buildSetupMessage(callRef, callingNumber, calledNumber);
      await writer.write(wrapTPKT(setupMsg));

      const messages: Array<{
        type: string;
        messageType: number;
        messageTypeName: string;
        cause?: { value: number; description: string };
        display?: string;
        ieCount: number;
        timestamp: number;
      }> = [];

      // Read response(s) — may get Call Proceeding, Alerting, Connect, or Release Complete
      let gotFinalResponse = false;
      let responseStatus = 'no_response';
      const readStart = Date.now();
      const maxReadTime = Math.min(timeout - connectTime, 8000);

      while (!gotFinalResponse && (Date.now() - readStart) < maxReadTime) {
        const responseData = await readTPKTFrame(reader, Math.min(3000, maxReadTime - (Date.now() - readStart)));
        if (!responseData) break;

        const parsed = parseQ931Message(responseData);
        if (!parsed) {
          // Got data but couldn't parse as Q.931
          messages.push({
            type: 'raw',
            messageType: responseData[0] || 0,
            messageTypeName: `Raw data (${responseData.length} bytes)`,
            ieCount: 0,
            timestamp: Date.now() - startTime,
          });
          break;
        }

        messages.push({
          type: 'q931',
          messageType: parsed.messageType,
          messageTypeName: parsed.messageTypeName,
          cause: parsed.cause,
          display: parsed.display,
          ieCount: parsed.informationElements.length,
          timestamp: Date.now() - startTime,
        });

        // Check for final responses
        switch (parsed.messageType) {
          case Q931_RELEASE_COMPLETE:
            responseStatus = 'release_complete';
            gotFinalResponse = true;
            break;
          case Q931_CONNECT:
            responseStatus = 'connected';
            gotFinalResponse = true;
            // Send Release Complete to clean up, wrapped in TPKT
            await writer.write(wrapTPKT(buildReleaseComplete(callRef)));
            break;
          case Q931_CALL_PROCEEDING:
            responseStatus = 'call_proceeding';
            break;
          case Q931_ALERTING:
            responseStatus = 'alerting';
            break;
          case Q931_PROGRESS:
            responseStatus = 'progress';
            break;
          case Q931_STATUS:
            responseStatus = 'status';
            gotFinalResponse = true;
            break;
          case Q931_FACILITY:
            responseStatus = 'facility';
            break;
          default:
            responseStatus = 'unknown_response';
            gotFinalResponse = true;
            break;
        }
      }

      // Send Release Complete if we got intermediate responses but no final
      if (!gotFinalResponse && messages.length > 0) {
        try {
          await writer.write(wrapTPKT(buildReleaseComplete(callRef)));
        } catch {
          // Ignore cleanup errors
        }
      }

      const rtt = Date.now() - startTime;

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        callingNumber,
        calledNumber,
        status: responseStatus,
        messages,
        protocol: 'H.225/Q.931',
        protocolVersion: 'H.323v4',
        connectTime,
        rtt,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      reader.releaseLock();
      writer.releaseLock();
      await socket.close();
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'H.323 connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// H.245 message type tags (first byte of PER-encoded MultimediaSystemControlMessage)
// H.245 uses ASN.1 PER encoding. The outer CHOICE is:
//   0 = request, 1 = response, 2 = command, 3 = indication
// TerminalCapabilitySet is request[2], MasterSlaveDetermination is request[0]
// We encode minimal but valid H.245 PDUs for capability negotiation.

function buildTerminalCapabilitySet(sequenceNumber: number): Uint8Array {
  // Minimal H.245 TerminalCapabilitySet ASN.1 PER encoding
  // MultimediaSystemControlMessage CHOICE[0] = request
  // request CHOICE[2] = terminalCapabilitySet
  //
  // TerminalCapabilitySet fields:
  //   sequenceNumber     INTEGER(0..255)  — 1 byte
  //   protocolIdentifier OBJECT IDENTIFIER — encoded as H.245 v13 OID
  //   multiplexCapability — h2250Capability (CHOICE[0])
  //   capabilityTable    — SET SIZE(0..256), here 0 entries
  //   capabilityDescriptors — SET SIZE(0..256), here 0 entries
  //
  // This minimal TCS announces "we exist" so the remote sends TCSAck.
  const buf = new Uint8Array([
    0x00,             // CHOICE: request (0)
    0x02,             // request CHOICE: terminalCapabilitySet (2)
    sequenceNumber & 0xff,
    // protocolIdentifier: OID 0.0.8.245.0.13 (H.245 v13) in DER then PER
    0x06, 0x04, 0x00, 0x08, 0xf5, 0x00, // OID encoding
    // multiplexCapability: CHOICE[0] = nonStandard, skip -> use h2250Capability
    // Minimal: just indicate h2250Capability present
    0x00,             // h2250Capability CHOICE
    // capabilityTable: 0 entries (length 0)
    0x00,
    // capabilityDescriptors: 0 entries
    0x00,
  ]);
  return buf;
}

function buildMasterSlaveDetermination(): Uint8Array {
  // MultimediaSystemControlMessage CHOICE[0] = request
  // request CHOICE[0] = masterSlaveDetermination
  // terminalType: INTEGER(0..255) = 50 (terminal)
  // statusDeterminationNumber: INTEGER(0..16777215) — 3 bytes, use 0x123456
  return new Uint8Array([
    0x00,             // CHOICE: request (0)
    0x00,             // request CHOICE: masterSlaveDetermination (0)
    50,               // terminalType = 50 (terminal, per H.245 Table 2)
    0x12, 0x34, 0x56, // statusDeterminationNumber (random)
  ]);
}

interface H245CapabilityResponse {
  success: boolean;
  host: string;
  port: number;
  tcsAckReceived: boolean;
  msdAckReceived: boolean;
  masterOrSlave?: string;
  rawResponseBytes?: number;
  messages: string[];
  rtt: number;
  error?: string;
}

interface H323CapabilitiesRequest {
  host: string;
  port: number;
  timeout?: number;
}

export async function handleH323Capabilities(request: Request): Promise<Response> {
  let body: H323CapabilitiesRequest;
  try {
    body = await request.json() as H323CapabilitiesRequest;
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { host, port, timeout = 10000 } = body;
  if (!host || !port) {
    return new Response(JSON.stringify({ success: false, error: 'host and port are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const messages: string[] = [];
  const startTime = Date.now();

  try {
    const socket = connect({ hostname: host, port }, { secureTransport: 'off', allowHalfOpen: false });
    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();

    try {
      // Send TerminalCapabilitySet, wrapped in TPKT
      const tcs = buildTerminalCapabilitySet(1);
      await writer.write(wrapTPKT(tcs));
      messages.push(`Sent TerminalCapabilitySet (${tcs.length} bytes, sequenceNumber=1)`);

      // Send MasterSlaveDetermination, wrapped in TPKT
      const msd = buildMasterSlaveDetermination();
      await writer.write(wrapTPKT(msd));
      messages.push(`Sent MasterSlaveDetermination (${msd.length} bytes, terminalType=50)`);

      // Read responses with timeout
      let tcsAckReceived = false;
      let msdAckReceived = false;
      let masterOrSlave: string | undefined;
      let totalBytes = 0;

      const timeoutAt = Date.now() + Math.min(timeout, 10000);

      while (Date.now() < timeoutAt && (!tcsAckReceived || !msdAckReceived)) {
        const remaining = timeoutAt - Date.now();
        if (remaining <= 0) break;

        const chunk = await readTPKTFrame(reader, remaining);
        if (!chunk) break;

        totalBytes += chunk.length;

        // Parse H.245 PER response — first two bytes are CHOICE selectors
        // response CHOICE[0] = masterSlaveDeterminationAck
        // response CHOICE[1] = masterSlaveDeterminationReject
        // response CHOICE[2] = terminalCapabilitySetAck
        // response CHOICE[3] = terminalCapabilitySetReject
        for (let i = 0; i < chunk.length - 1; i++) {
          const outerChoice = chunk[i];
          const innerChoice = chunk[i + 1];

          if (outerChoice === 0x01) {
            // response
            if (innerChoice === 0x02) {
              tcsAckReceived = true;
              messages.push('Received TerminalCapabilitySetAck');
            } else if (innerChoice === 0x03) {
              messages.push('Received TerminalCapabilitySetReject');
              tcsAckReceived = true; // treat as answered
            } else if (innerChoice === 0x00) {
              msdAckReceived = true;
              // masterOrSlave: next byte after the 2-byte header
              if (i + 2 < chunk.length) {
                masterOrSlave = chunk[i + 2] === 0x00 ? 'master' : 'slave';
              }
              messages.push(`Received MasterSlaveDeterminationAck (${masterOrSlave ?? 'unknown'})`);
            } else if (innerChoice === 0x01) {
              msdAckReceived = true;
              messages.push('Received MasterSlaveDeterminationReject');
            }
          }
        }
      }

      const rtt = Date.now() - startTime;
      const result: H245CapabilityResponse = {
        success: true,
        host,
        port,
        tcsAckReceived,
        msdAckReceived,
        masterOrSlave,
        rawResponseBytes: totalBytes,
        messages,
        rtt,
      };

      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      reader.releaseLock();
      writer.releaseLock();
      await socket.close();
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      host,
      port,
      error: error instanceof Error ? error.message : 'H.245 connection failed',
      messages,
      rtt: Date.now() - startTime,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
