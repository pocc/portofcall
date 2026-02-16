/**
 * H.323 Protocol Worker Handler
 *
 * Implements H.225 call signaling probe based on Q.931 (ITU-T).
 * H.323 is a legacy VoIP standard on port 1720 (TCP).
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
 * Includes Bearer Capability, Display, and User-User (H.323) IEs.
 */
function buildSetupMessage(callRef: number, callingNumber: string, calledNumber: string): Uint8Array {
  const parts: Uint8Array[] = [];
  const encoder = new TextEncoder();

  // --- Header ---
  // Protocol Discriminator
  parts.push(new Uint8Array([Q931_PROTOCOL_DISCRIMINATOR]));
  // Call Reference Length = 2
  parts.push(new Uint8Array([0x02]));
  // Call Reference (2 bytes, originating side has bit 7 of first byte = 0)
  parts.push(new Uint8Array([(callRef >> 8) & 0x7f, callRef & 0xff]));
  // Message Type: SETUP
  parts.push(new Uint8Array([Q931_SETUP]));

  // --- Bearer Capability IE ---
  parts.push(new Uint8Array([
    IE_BEARER_CAPABILITY,
    0x03,  // Length
    0x80,  // Coding: ITU-T, speech
    0x90,  // Transfer capability: unrestricted digital
    0xa3,  // Transfer rate: packet mode, layer 1 = H.221/H.242
  ]));

  // --- Display IE (optional, identifies caller) ---
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
      0x80,  // Type of number: unknown, Numbering plan: unknown
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

  // --- User-User IE (H.323 specific - minimal H225 Setup UUIE) ---
  // This is a simplified H.323 User-User Information Element
  // Real implementations use ASN.1 PER encoding for H225-Setup-UUIE
  const uuData = new Uint8Array([
    H323_UU_PROTOCOL_DISCRIMINATOR,
    // Minimal H225 Setup-UUIE stub (not fully ASN.1 PER encoded)
    // Protocol identifier for H.225.0v4
    0x00, 0x08, 0x91, 0x4a, 0x00, 0x04,
    // sourceAddress (empty)
    0x00,
    // activeMC = false
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
 * Build a Q.931 RELEASE COMPLETE message to cleanly end the call.
 */
function buildReleaseComplete(callRef: number): Uint8Array {
  return new Uint8Array([
    Q931_PROTOCOL_DISCRIMINATOR,
    0x02, // Call Reference Length
    ((callRef >> 8) & 0x7f) | 0x80, // Call ref with response flag (bit 7 = 1)
    callRef & 0xff,
    Q931_RELEASE_COMPLETE,
    // Cause IE: Normal call clearing
    0x08, // Cause IE identifier
    0x02, // Length
    0x80, // Coding: ITU-T, Location: user
    0x90, // Cause: Normal call clearing (16) with extension bit
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
      // Shift/locking shift or single-octet IE
      // Skip if it looks like a single-byte IE
      if (ieId >= 0x90 && ieId <= 0x9f) continue; // Sending complete
      if (ieId >= 0xa0 && ieId <= 0xaf) continue; // Congestion level
      if (ieId >= 0xb0 && ieId <= 0xbf) continue; // Repeat indicator
      // Otherwise treat as variable-length
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

    // Extract cause
    if (ieId === 0x08 && ieLength >= 2) {
      const causeValue = ieData[ieLength - 1];
      cause = {
        value: causeValue & 0x7f,
        description: getCauseDescription(causeValue),
      };
    }

    // Extract display
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
 * Read exact number of bytes from the socket with timeout.
 */
export async function readExact(reader: ReadableStreamDefaultReader<Uint8Array>, length: number, timeoutMs: number): Promise<Uint8Array> {
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
 * Read whatever bytes are available from the socket with timeout.
 */
async function readAvailable(reader: ReadableStreamDefaultReader<Uint8Array>, timeoutMs: number): Promise<Uint8Array | null> {
  const readPromise = reader.read();
  const timeoutPromise = new Promise<{ done: true; value: undefined }>((resolve) =>
    setTimeout(() => resolve({ done: true, value: undefined }), timeoutMs)
  );

  const { done, value } = await Promise.race([readPromise, timeoutPromise]);
  if (done || !value) return null;
  return value;
}

/**
 * Handle H.323 call signaling probe.
 * Sends a Q.931 SETUP message and parses the response.
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

      // Build and send SETUP message
      const setupMsg = buildSetupMessage(callRef, callingNumber, calledNumber);
      await writer.write(setupMsg);

      const messages: Array<{
        type: string;
        messageType: number;
        messageTypeName: string;
        cause?: { value: number; description: string };
        display?: string;
        ieCount: number;
        timestamp: number;
      }> = [];

      // Read response(s) - may get Call Proceeding, Alerting, Connect, or Release Complete
      let gotFinalResponse = false;
      let responseStatus = 'no_response';
      const readStart = Date.now();
      const maxReadTime = Math.min(timeout - connectTime, 8000);

      while (!gotFinalResponse && (Date.now() - readStart) < maxReadTime) {
        const responseData = await readAvailable(reader, Math.min(3000, maxReadTime - (Date.now() - readStart)));
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
            // Send Release Complete to clean up
            const releaseMsg = buildReleaseComplete(callRef);
            await writer.write(releaseMsg);
            break;
          case Q931_CALL_PROCEEDING:
            responseStatus = 'call_proceeding';
            // Keep reading for more messages
            break;
          case Q931_ALERTING:
            responseStatus = 'alerting';
            // Keep reading for Connect or Release Complete
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

      // If we got intermediate responses but no final, send Release Complete
      if (!gotFinalResponse && messages.length > 0) {
        try {
          const releaseMsg = buildReleaseComplete(callRef);
          await writer.write(releaseMsg);
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
