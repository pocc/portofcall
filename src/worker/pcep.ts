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
const MSG_PCREQ = 3;
const MSG_PCREP = 4;
const MSG_PCERR = 6;
const MSG_CLOSE = 7;

// PCEP Object Classes
const OBJ_CLASS_OPEN = 1;
const OBJ_CLASS_RP = 2;
const OBJ_CLASS_NOPATH = 3;
const OBJ_CLASS_ENDPOINTS = 4;
const OBJ_CLASS_BANDWIDTH = 5;
const OBJ_CLASS_METRIC = 6;
const OBJ_CLASS_ERO = 7;
const OBJ_CLASS_LSPA = 9;

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
 * The timeoutHandle parameter is unused but kept for API compatibility.
 */
async function readExact(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  needed: number,
  _timeoutHandle: { id: ReturnType<typeof setTimeout> | null },
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (total < needed) {
    const result = await reader.read();
    if (result.done || !result.value) {
      throw new Error(`Connection closed after ${total} bytes (expected ${needed})`);
    }
    chunks.push(result.value);
    total += result.value.length;
  }

  // Combine chunks and return exactly `needed` bytes
  const combined = new Uint8Array(needed);
  let offset = 0;
  for (const chunk of chunks) {
    const toCopy = Math.min(chunk.length, needed - offset);
    combined.set(chunk.subarray(0, toCopy), offset);
    offset += toCopy;
    if (offset >= needed) break;
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
    // TLV = 4-byte header + value (padded to 4-byte boundary)
    const paddedValueLen = Math.ceil(tlvLength / 4) * 4;
    tlvOffset += 4 + paddedValueLen;
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

    const timeoutHandle = { id: null as ReturnType<typeof setTimeout> | null };
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle.id = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);
    } catch (error) {
      if (timeoutHandle.id) clearTimeout(timeoutHandle.id);
      socket.close();
      throw error;
    }
    const connectTime = Date.now() - startTime;

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      // Send OPEN message
      const openMsg = buildOpenMessage();
      await writer.write(openMsg);

      // Read response header (4 bytes minimum)
      const headerData = await readExact(reader, 4, timeoutHandle);
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
          const bodyData = await readExact(reader, header.messageLength - 4, timeoutHandle);
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

    } finally {
      if (timeoutHandle.id) clearTimeout(timeoutHandle.id);
      writer.releaseLock();
      reader.releaseLock();
      socket.close();
    }

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

    const timeoutHandle = { id: null as ReturnType<typeof setTimeout> | null };
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle.id = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);
    } catch (error) {
      if (timeoutHandle.id) clearTimeout(timeoutHandle.id);
      socket.close();
      throw error;
    }

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      // Send OPEN
      const openMsg = buildOpenMessage();
      await writer.write(openMsg);

      // Read response header only
      const headerData = await readExact(reader, 4, timeoutHandle);
      const rtt = Date.now() - startTime;
      const header = parsePCEPHeader(headerData);

      const isPCEP = header !== null && header.version === 1;

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

    } finally {
      if (timeoutHandle.id) clearTimeout(timeoutHandle.id);
      writer.releaseLock();
      reader.releaseLock();
      socket.close();
    }

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
 * Build a PCEP PCReq message with RP, END-POINTS, and optional BANDWIDTH objects.
 */
function buildPCReqMessage(requestId: number, srcAddr: string, dstAddr: string, bandwidth?: number): Uint8Array {
  function ipToBytes(ip: string): Uint8Array {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4) throw new Error(`Invalid IPv4 address: ${ip}`);
    if (parts.some(p => p < 0 || p > 255 || !Number.isInteger(p))) {
      throw new Error(`Invalid IPv4 address octets: ${ip}`);
    }
    return new Uint8Array(parts);
  }

  // RP object (class 2, type 1): 4-byte header + 8-byte body (4 flags + 4 request-id)
  const rpObjLen = 4 + 8;
  const rpObj = new Uint8Array(rpObjLen);
  const rpView = new DataView(rpObj.buffer);
  rpObj[0] = OBJ_CLASS_RP;
  rpObj[1] = (1 << 4); // type=1, P=0, I=0
  rpView.setUint16(2, rpObjLen, false);
  rpView.setUint32(4, 0, false); // RP flags: all zero
  rpView.setUint32(8, requestId, false);

  // END-POINTS object (class 4, type 1 = IPv4): 4-byte header + 8-byte body (src 4 + dst 4)
  const epObjLen = 4 + 8;
  const epObj = new Uint8Array(epObjLen);
  const epView = new DataView(epObj.buffer);
  epObj[0] = OBJ_CLASS_ENDPOINTS;
  epObj[1] = (1 << 4); // type=1 IPv4
  epView.setUint16(2, epObjLen, false);
  epObj.set(ipToBytes(srcAddr), 4);
  epObj.set(ipToBytes(dstAddr), 8);

  const objects: Uint8Array[] = [rpObj, epObj];

  // BANDWIDTH object (class 5, type 1): 4-byte header + 4-byte IEEE 754 float32
  if (bandwidth !== undefined) {
    const bwObjLen = 4 + 4;
    const bwObj = new Uint8Array(bwObjLen);
    const bwView = new DataView(bwObj.buffer);
    bwObj[0] = OBJ_CLASS_BANDWIDTH;
    bwObj[1] = (1 << 4);
    bwView.setUint16(2, bwObjLen, false);
    bwView.setFloat32(4, bandwidth, false);
    objects.push(bwObj);
  }

  const totalObjLen = objects.reduce((s, o) => s + o.length, 0);
  const msgLen = 4 + totalObjLen;
  const msg = new Uint8Array(msgLen);
  const msgView = new DataView(msg.buffer);
  msg[0] = (PCEP_VERSION << 5);
  msg[1] = MSG_PCREQ;
  msgView.setUint16(2, msgLen, false);

  let offset = 4;
  for (const obj of objects) {
    msg.set(obj, offset);
    offset += obj.length;
  }

  return msg;
}

/**
 * Parse a PCRep message body extracting RP, ERO, NO-PATH, LSPA, and METRIC objects.
 */
function parsePCRepBody(data: Uint8Array, bodyOffset: number): {
  pathFound: boolean;
  requestId: number;
  noPathReason: number | null;
  hops: Array<{ type: number; addr: string; prefix: number; loose: boolean }>;
  igpCost: number | null;
  teCost: number | null;
  setupPriority: number | null;
  holdingPriority: number | null;
} {
  let offset = bodyOffset;
  let pathFound = false;
  let requestId = 0;
  let noPathReason: number | null = null;
  const hops: Array<{ type: number; addr: string; prefix: number; loose: boolean }> = [];
  let igpCost: number | null = null;
  let teCost: number | null = null;
  let setupPriority: number | null = null;
  let holdingPriority: number | null = null;

  while (offset + 4 <= data.length) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const objClass = data[offset];
    const objLen = view.getUint16(offset + 2, false);

    if (objLen < 4 || objLen > 65535 || offset + objLen > data.length) break;

    if (objClass === OBJ_CLASS_RP && objLen >= 12) {
      requestId = view.getUint32(offset + 8, false);
    } else if (objClass === OBJ_CLASS_NOPATH) {
      pathFound = false;
      noPathReason = data[offset + 4] & 0xff;
    } else if (objClass === OBJ_CLASS_ERO) {
      pathFound = true;
      let soOffset = offset + 4;
      while (soOffset + 2 <= offset + objLen) {
        const soType = data[soOffset] & 0x7f;
        const loose = (data[soOffset] & 0x80) !== 0;
        const soLen = data[soOffset + 1];
        if (soLen < 2 || soOffset + soLen > offset + objLen) break;
        if (soType === 1 && soLen >= 8) {
          // IPv4 prefix subobject
          const addrBytes = data.slice(soOffset + 2, soOffset + 6);
          const addr = Array.from(addrBytes).join('.');
          const prefix = data[soOffset + 6];
          hops.push({ type: soType, addr, prefix, loose });
        }
        soOffset += soLen;
      }
    } else if (objClass === OBJ_CLASS_LSPA && objLen >= 20) {
      setupPriority = data[offset + 16];
      holdingPriority = data[offset + 17];
    } else if (objClass === OBJ_CLASS_METRIC && objLen >= 12) {
      // METRIC: 2 reserved + 1 flags + 1 metric-type + 4 float32 value
      const metricType = data[offset + 7];
      const metricValue = view.getFloat32(offset + 8, false);
      if (metricType === 1) igpCost = metricValue;
      else if (metricType === 2) teCost = metricValue;
    }

    // Objects are padded to 4-byte boundaries per RFC 5440 §7.2
    const paddedObjLen = Math.ceil(objLen / 4) * 4;
    offset += paddedObjLen;
  }

  return { pathFound, requestId, noPathReason, hops, igpCost, teCost, setupPriority, holdingPriority };
}

/**
 * Handle PCEP path computation — performs OPEN/Keepalive session establishment,
 * then sends PCReq (type 3) and parses the PCRep (type 4) response.
 */
export async function handlePCEPCompute(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
      requestId?: number;
      srcAddr: string;
      dstAddr: string;
      bandwidth?: number;
    };

    const { host, port = 4189, timeout = 15000, srcAddr, dstAddr, bandwidth } = body;
    const requestId = body.requestId ?? (Math.floor(Math.random() * 0xffffff) + 1);

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!srcAddr || !dstAddr) {
      return new Response(JSON.stringify({
        success: false,
        error: 'srcAddr and dstAddr are required',
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

    const timeoutHandle = { id: null as ReturnType<typeof setTimeout> | null };
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle.id = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);
    } catch (error) {
      if (timeoutHandle.id) clearTimeout(timeoutHandle.id);
      socket.close();
      throw error;
    }

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      // Step 1: Send client OPEN
      await writer.write(buildOpenMessage());

      // Step 2: Read server OPEN
      const openHdrData = await readExact(reader, 4, timeoutHandle);
      const openHdr = parsePCEPHeader(openHdrData);

      if (!openHdr || openHdr.version !== 1) {
        throw new Error('Server did not respond with a valid PCEP OPEN');
      }

      if (openHdr.messageType === MSG_OPEN && openHdr.messageLength > 4) {
        await readExact(reader, openHdr.messageLength - 4, timeoutHandle);
      }

      // Step 3: Send Keepalive to confirm session
      await writer.write(buildKeepaliveMessage());

      // Step 4: Send PCReq
      await writer.write(buildPCReqMessage(requestId, srcAddr, dstAddr, bandwidth));

      // Step 5: Read response, skipping any intervening Keepalives
      let pcrepData: Uint8Array | null = null;
      for (let attempts = 0; attempts < 4; attempts++) {
        const hdrBytes = await readExact(reader, 4, timeoutHandle);
        const hdrParsed = parsePCEPHeader(hdrBytes);
        if (!hdrParsed) break;

        if (hdrParsed.messageLength > 4) {
          const bodyBytes = await readExact(reader, hdrParsed.messageLength - 4, timeoutHandle);
          if (hdrParsed.messageType === MSG_PCREP) {
            pcrepData = new Uint8Array(hdrParsed.messageLength);
            pcrepData.set(hdrBytes, 0);
            pcrepData.set(bodyBytes, 4);
            break;
          }
        } else if (hdrParsed.messageType === MSG_PCREP) {
          pcrepData = hdrBytes;
          break;
        }
        // Was a Keepalive or other — continue reading
      }

      const rtt = Date.now() - startTime;

      if (!pcrepData) {
        return new Response(JSON.stringify({
          success: true,
          host,
          port,
          rtt,
          requestId,
          pathFound: false,
          hops: [],
          igpCost: null,
          teCost: null,
          message: 'No PCRep received from server',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const parsed = parsePCRepBody(pcrepData, 4);

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        rtt,
        requestId: parsed.requestId || requestId,
        pathFound: parsed.pathFound,
        hops: parsed.hops,
        igpCost: parsed.igpCost,
        teCost: parsed.teCost,
        ...(parsed.noPathReason !== null ? { noPathReason: parsed.noPathReason } : {}),
        ...(parsed.setupPriority !== null ? { setupPriority: parsed.setupPriority } : {}),
        ...(parsed.holdingPriority !== null ? { holdingPriority: parsed.holdingPriority } : {}),
        message: parsed.pathFound
          ? `Path computed: ${parsed.hops.length} hop(s)`
          : `No path found${parsed.noPathReason !== null ? ` (reason: ${parsed.noPathReason})` : ''}`,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } finally {
      if (timeoutHandle.id) clearTimeout(timeoutHandle.id);
      writer.releaseLock();
      reader.releaseLock();
      socket.close();
    }

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
