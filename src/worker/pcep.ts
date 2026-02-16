/**
 * PCEP (Path Computation Element Protocol) Implementation
 *
 * Implements PCEP server detection via the RFC 5440 wire protocol on port 4189.
 * PCEP is used in SDN/MPLS/Segment Routing networks for requesting and computing
 * network paths between Path Computation Clients (PCC) and Path Computation
 * Elements (PCE).
 *
 * Protocol Structure:
 * Every PCEP message has a common header (4 bytes):
 * - Version (3 bits): Protocol version (currently 1)
 * - Flags (5 bits): Reserved
 * - Message Type (1 byte):
 *   1 = Open, 2 = Keepalive, 3 = PCReq, 4 = PCRep,
 *   5 = PCNtf, 6 = PCErr, 7 = Close
 * - Message Length (2 bytes, big-endian): Total including header
 *
 * PCEP Objects have a common header (4 bytes):
 * - Object Class (1 byte)
 * - Object Type (4 bits) + Flags (4 bits: P, I, reserved)
 * - Object Length (2 bytes, big-endian)
 *
 * Handshake:
 * 1. Client sends OPEN message with OPEN object (deadtimer, keepalive, SID)
 * 2. Server responds with OPEN message (its parameters)
 * 3. Both send Keepalive to confirm session establishment
 *
 * Object Classes:
 * - 1: OPEN (session parameters, capabilities)
 * - 5: BANDWIDTH
 * - 6: METRIC
 * - 7: ERO (Explicit Route Object)
 * - 21: SPEAKER-ENTITY-ID (RFC 7752)
 *
 * Use Cases:
 * - PCE server detection in service provider networks
 * - SDN controller discovery and capability probing
 * - MPLS/SR-MPLS path computation infrastructure verification
 * - Network orchestration system health checking
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// PCEP version
const PCEP_VERSION = 1;

// PCEP message types
const MSG_OPEN = 1;
const MSG_KEEPALIVE = 2;
const MSG_PCERR = 6;
const MSG_CLOSE = 7;

// PCEP Object Classes
const OBJ_CLASS_OPEN = 1;

// OPEN Object Type
const OBJ_TYPE_OPEN = 1;

// Message type names
const MSG_TYPE_NAMES: Record<number, string> = {
  [MSG_OPEN]: 'Open',
  [MSG_KEEPALIVE]: 'Keepalive',
  3: 'PCReq',
  4: 'PCRep',
  5: 'PCNtf',
  [MSG_PCERR]: 'PCErr',
  [MSG_CLOSE]: 'Close',
  10: 'PCMonReq',
  11: 'PCMonRep',
  12: 'StartTLS',
};

/**
 * Build a PCEP OPEN message.
 * Contains an OPEN object with session parameters.
 */
function buildOpenMessage(): Uint8Array {
  // OPEN object:
  // Object header (4 bytes) + Open object body (4 bytes) = 8 bytes
  // Body: Ver(3)|Flags(5) | Keepalive(1) | DeadTimer(1) | SID(1)
  const keepalive = 30; // seconds
  const deadtimer = 120; // seconds (4x keepalive)
  const sid = 1; // Session ID

  const openObjLen = 4 + 4; // object header + body
  const msgLen = 4 + openObjLen; // message header + open object

  const msg = new Uint8Array(msgLen);
  const view = new DataView(msg.buffer);

  // PCEP Common Header
  msg[0] = (PCEP_VERSION << 5); // Version=1, Flags=0
  msg[1] = MSG_OPEN; // Message Type: Open
  view.setUint16(2, msgLen, false); // Message Length

  // OPEN Object Header
  msg[4] = OBJ_CLASS_OPEN; // Object Class: OPEN
  msg[5] = (OBJ_TYPE_OPEN << 4); // Object Type: 1, Flags: P=0, I=0
  view.setUint16(6, openObjLen, false); // Object Length

  // OPEN Object Body
  msg[8] = (PCEP_VERSION << 5); // Ver=1, Flags=0
  msg[9] = keepalive;
  msg[10] = deadtimer;
  msg[11] = sid;

  return msg;
}

/**
 * Build a PCEP Keepalive message (just the 4-byte common header).
 */
function buildKeepaliveMessage(): Uint8Array {
  const msg = new Uint8Array(4);
  msg[0] = (PCEP_VERSION << 5);
  msg[1] = MSG_KEEPALIVE;
  const view = new DataView(msg.buffer);
  view.setUint16(2, 4, false); // Length = 4 (header only)
  return msg;
}

/**
 * Read exactly `needed` bytes from a reader with timeout.
 */
async function readExact(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  needed: number,
  timeoutPromise: Promise<never>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (total < needed) {
    const result = await Promise.race([reader.read(), timeoutPromise]);
    if (result.done || !result.value) {
      throw new Error(`Connection closed after ${total} bytes (expected ${needed})`);
    }
    chunks.push(result.value);
    total += result.value.length;
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
 * Parse a PCEP message header.
 */
function parsePCEPHeader(data: Uint8Array): {
  version: number;
  flags: number;
  messageType: number;
  messageLength: number;
  messageTypeName: string;
} | null {
  if (data.length < 4) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const versionFlags = data[0];
  const version = (versionFlags >> 5) & 0x07;
  const flags = versionFlags & 0x1f;
  const messageType = data[1];
  const messageLength = view.getUint16(2, false);

  return {
    version,
    flags,
    messageType,
    messageLength,
    messageTypeName: MSG_TYPE_NAMES[messageType] || `Unknown(${messageType})`,
  };
}

/**
 * Parse a PCEP OPEN object from a message body.
 */
function parseOpenObject(data: Uint8Array, offset: number): {
  objectClass: number;
  objectType: number;
  objectLength: number;
  keepalive: number;
  deadtimer: number;
  sid: number;
  version: number;
  tlvs: Array<{ type: number; length: number }>;
} | null {
  if (offset + 8 > data.length) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const objectClass = data[offset];
  const objectType = (data[offset + 1] >> 4) & 0x0f;
  const objectLength = view.getUint16(offset + 2, false);

  if (objectClass !== OBJ_CLASS_OPEN) return null;
  if (offset + objectLength > data.length) return null;

  const versionFlags = data[offset + 4];
  const version = (versionFlags >> 5) & 0x07;
  const keepalive = data[offset + 5];
  const deadtimer = data[offset + 6];
  const sid = data[offset + 7];

  // Parse optional TLVs after the 4-byte open body
  const tlvs: Array<{ type: number; length: number }> = [];
  let tlvOffset = offset + 8;
  while (tlvOffset + 4 <= offset + objectLength) {
    const tlvType = view.getUint16(tlvOffset, false);
    const tlvLength = view.getUint16(tlvOffset + 2, false);
    tlvs.push({ type: tlvType, length: tlvLength });
    // TLV values are padded to 4-byte boundaries
    tlvOffset += 4 + Math.ceil(tlvLength / 4) * 4;
  }

  return {
    objectClass,
    objectType,
    objectLength,
    keepalive,
    deadtimer,
    sid,
    version,
    tlvs,
  };
}

// Known TLV type names
const TLV_TYPE_NAMES: Record<number, string> = {
  16: 'STATEFUL-PCE-CAPABILITY',
  17: 'SYMBOLIC-PATH-NAME',
  26: 'SR-PCE-CAPABILITY',
  34: 'PATH-SETUP-TYPE-CAPABILITY',
  65505: 'VENDOR-INFORMATION',
};

/**
 * Handle PCEP connection test — performs OPEN handshake.
 */
export async function handlePCEPConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 4189, timeout = 10000 } = body;

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

    // Send OPEN message
    const openMsg = buildOpenMessage();
    await writer.write(openMsg);

    // Read response header (4 bytes minimum)
    const headerData = await readExact(reader, 4, timeoutPromise);
    const header = parsePCEPHeader(headerData);

    let isPCEP = false;
    let openParams: ReturnType<typeof parseOpenObject> = null;
    let responseType = 'Unknown';
    let rawBytesReceived = headerData.length;

    if (header && header.version === 1) {
      isPCEP = true;
      responseType = header.messageTypeName;

      // If the response is an OPEN message, read the rest and parse
      if (header.messageType === MSG_OPEN && header.messageLength > 4) {
        const bodyData = await readExact(reader, header.messageLength - 4, timeoutPromise);
        rawBytesReceived += bodyData.length;

        // Combine header + body for parsing
        const fullMsg = new Uint8Array(header.messageLength);
        fullMsg.set(headerData, 0);
        fullMsg.set(bodyData, 4);

        openParams = parseOpenObject(fullMsg, 4);

        // Send Keepalive to acknowledge
        try {
          const keepalive = buildKeepaliveMessage();
          await writer.write(keepalive);
        } catch {
          // Ignore write errors during handshake completion
        }
      }
    }

    const rtt = Date.now() - startTime;

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      connectTime,
      isPCEP,
      responseType,
      ...(header ? {
        protocolVersion: header.version,
        messageFlags: header.flags,
      } : {}),
      ...(openParams ? {
        peerKeepalive: openParams.keepalive,
        peerDeadtimer: openParams.deadtimer,
        peerSessionId: openParams.sid,
        peerVersion: openParams.version,
        capabilities: openParams.tlvs.map(t => ({
          type: t.type,
          name: TLV_TYPE_NAMES[t.type] || `TLV-${t.type}`,
          length: t.length,
        })),
      } : {}),
      rawBytesReceived,
      message: isPCEP
        ? `PCEP server detected (v${header?.version}). Response: ${responseType}.${openParams ? ` Keepalive=${openParams.keepalive}s, DeadTimer=${openParams.deadtimer}s, ${openParams.tlvs.length} TLV(s).` : ''}`
        : 'Server responded but does not appear to be a PCEP server.',
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
 * Handle PCEP probe — lightweight check for PCEP protocol response.
 */
export async function handlePCEPProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 4189, timeout = 10000 } = body;

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

    // Send OPEN
    const openMsg = buildOpenMessage();
    await writer.write(openMsg);

    // Read response header only
    const headerData = await readExact(reader, 4, timeoutPromise);
    const rtt = Date.now() - startTime;
    const header = parsePCEPHeader(headerData);

    const isPCEP = header !== null && header.version === 1;

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      isPCEP,
      responseType: header?.messageTypeName || 'Unknown',
      message: isPCEP
        ? `PCEP server detected (response: ${header?.messageTypeName}).`
        : 'Not a PCEP server.',
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
