/**
 * LDP (Label Distribution Protocol) Implementation
 *
 * Implements LDP peer detection via the RFC 5036 wire protocol on port 646.
 * LDP is used in MPLS networks for distributing label-to-FEC (Forwarding
 * Equivalence Class) bindings between Label Switching Routers (LSRs).
 *
 * Protocol Structure:
 * LDP PDU Header (10 bytes):
 * - Version (2 bytes, big-endian): Protocol version (1)
 * - PDU Length (2 bytes, big-endian): Length of rest of PDU (excluding version+length)
 * - LDP Identifier (6 bytes): LSR ID (4 bytes IP) + Label Space ID (2 bytes)
 *
 * LDP Message Header:
 * - U-bit (1 bit) + Message Type (15 bits)
 * - Message Length (2 bytes, big-endian)
 * - Message ID (4 bytes, big-endian)
 * - Mandatory/Optional Parameters (TLVs)
 *
 * Message Types:
 * - 0x0001: Notification
 * - 0x0100: Hello
 * - 0x0200: Initialization
 * - 0x0201: KeepAlive
 * - 0x0300: Address
 * - 0x0301: Address Withdraw
 * - 0x0400: Label Mapping
 * - 0x0401: Label Request
 * - 0x0402: Label Withdraw
 * - 0x0403: Label Release
 * - 0x0404: Label Abort Request
 *
 * TCP Session Handshake:
 * 1. TCP connection on port 646 (after Hello discovery)
 * 2. Both peers send Initialization messages
 * 3. Both respond with KeepAlive to confirm
 *
 * Common Session Parameters TLV (0x0500):
 * - Protocol Version (2 bytes)
 * - KeepAlive Time (2 bytes)
 * - A/D bits + Path Vector Limit (2 bytes)
 * - Max PDU Length (2 bytes)
 * - Receiver LDP Identifier (6 bytes)
 *
 * Use Cases:
 * - MPLS LSR discovery and capability probing
 * - LDP session parameter fingerprinting
 * - Service provider network infrastructure verification
 * - MPLS label distribution health checking
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// LDP Protocol version
const LDP_VERSION = 1;

// LDP Message Types
const MSG_NOTIFICATION = 0x0001;
const MSG_INITIALIZATION = 0x0200;
const MSG_KEEPALIVE = 0x0201;
const MSG_ADDRESS = 0x0300;
const MSG_LABEL_MAPPING = 0x0400;
const MSG_LABEL_WITHDRAW = 0x0402;
const MSG_LABEL_RELEASE = 0x0403;

// TLV Types for Label Mapping
const TLV_FEC = 0x0100;
const TLV_GENERIC_LABEL = 0x0200;
const TLV_ADDRESS_LIST = 0x0101;

// FEC element types
const FEC_WILDCARD = 0x01;
const FEC_PREFIX = 0x02;

// Address families
const AF_IPV4 = 0x0001;

// TLV Types
const TLV_COMMON_SESSION = 0x0500;

// Message type names
const MSG_TYPE_NAMES: Record<number, string> = {
  [MSG_NOTIFICATION]: 'Notification',
  0x0100: 'Hello',
  [MSG_INITIALIZATION]: 'Initialization',
  [MSG_KEEPALIVE]: 'KeepAlive',
  [MSG_ADDRESS]: 'Address',
  0x0301: 'Address Withdraw',
  [MSG_LABEL_MAPPING]: 'Label Mapping',
  0x0401: 'Label Request',
  [MSG_LABEL_WITHDRAW]: 'Label Withdraw',
  [MSG_LABEL_RELEASE]: 'Label Release',
  0x0404: 'Label Abort Request',
};

/**
 * Format an IPv4 address from 4 bytes.
 */
function formatIPv4(data: Uint8Array, offset: number): string {
  return `${data[offset]}.${data[offset + 1]}.${data[offset + 2]}.${data[offset + 3]}`;
}

/**
 * Build an LDP Initialization message.
 * PDU Header (10) + Message Header (8) + Common Session TLV (18) = 36 bytes
 */
function buildInitializationMessage(): Uint8Array {
  const keepaliveTime = 30; // seconds
  const maxPduLength = 4096;

  // Common Session Parameters TLV:
  // TLV header (4 bytes) + body (14 bytes) = 18 bytes
  const tlvBodyLen = 14; // version(2) + keepalive(2) + flags(2) + maxPdu(2) + receiverLdpId(6)
  const tlvLen = 4 + tlvBodyLen;

  // Message: header(8) + TLV(18) = 26 bytes
  const msgContentLen = 4 + tlvLen; // msgId(4) + TLV
  const msgLen = 4 + msgContentLen; // type+length(4) + content

  // PDU: header fields after version+length(6) = ldpId(6) + message
  const pduContentLen = 6 + msgLen; // ldpId(6) + message

  const totalLen = 4 + pduContentLen; // version(2) + pduLength(2) + content
  const pdu = new Uint8Array(totalLen);
  const view = new DataView(pdu.buffer);

  // PDU Header
  view.setUint16(0, LDP_VERSION, false); // Version
  view.setUint16(2, pduContentLen, false); // PDU Length (after this field)

  // LDP Identifier: 10.0.0.1:0 (our simulated LSR ID)
  pdu[4] = 10; pdu[5] = 0; pdu[6] = 0; pdu[7] = 1;
  view.setUint16(8, 0, false); // Label Space ID

  // Message Header
  let offset = 10;
  view.setUint16(offset, MSG_INITIALIZATION, false); // Message Type (no U-bit)
  view.setUint16(offset + 2, msgContentLen, false); // Message Length
  view.setUint32(offset + 4, 1, false); // Message ID
  offset += 8;

  // Common Session Parameters TLV
  view.setUint16(offset, TLV_COMMON_SESSION, false); // TLV Type
  view.setUint16(offset + 2, tlvBodyLen, false); // TLV Length
  offset += 4;

  view.setUint16(offset, LDP_VERSION, false); // Protocol Version
  view.setUint16(offset + 2, keepaliveTime, false); // KeepAlive Time
  pdu[offset + 4] = 0; // A=0, D=0
  pdu[offset + 5] = 0; // Path Vector Limit = 0
  view.setUint16(offset + 6, maxPduLength, false); // Max PDU Length

  // Receiver LDP Identifier (set to 0.0.0.0:0 since we don't know it yet)
  // bytes offset+8 through offset+13 are already 0

  return pdu;
}

/**
 * Build a simple LDP KeepAlive message.
 */
function buildKeepaliveMessage(): Uint8Array {
  // PDU header(10) + message header(8) = 18 bytes
  const msgContentLen = 4; // just msgId
  const msgLen = 4 + msgContentLen;
  const pduContentLen = 6 + msgLen;

  const pdu = new Uint8Array(4 + pduContentLen);
  const view = new DataView(pdu.buffer);

  view.setUint16(0, LDP_VERSION, false);
  view.setUint16(2, pduContentLen, false);
  pdu[4] = 10; pdu[5] = 0; pdu[6] = 0; pdu[7] = 1;
  view.setUint16(8, 0, false);

  view.setUint16(10, MSG_KEEPALIVE, false);
  view.setUint16(12, msgContentLen, false);
  view.setUint32(14, 2, false); // Message ID

  return pdu;
}

/**
 * Read enough data from the socket for an LDP PDU.
 */
async function readLDPResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
  maxBytes: number = 4096,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  // Read at least 4 bytes for the PDU header (version + length)
  while (total < 4) {
    const result = await Promise.race([reader.read(), timeoutPromise]);
    if (result.done || !result.value) {
      throw new Error(`Connection closed after ${total} bytes (expected >= 4)`);
    }
    chunks.push(result.value);
    total += result.value.length;
  }

  // Parse PDU length from first 4 bytes
  const first = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { first.set(c, off); off += c.length; }
  const pduLen = (first[2] << 8) | first[3];
  const needed = 4 + pduLen; // version(2) + length(2) + pduLen

  while (total < needed && total < maxBytes) {
    const result = await Promise.race([reader.read(), timeoutPromise]);
    if (result.done || !result.value) break;
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
 * Parse an LDP PDU header and extract messages.
 */
function parseLDPResponse(data: Uint8Array): {
  isLDP: boolean;
  version: number;
  pduLength: number;
  lsrId: string;
  labelSpace: number;
  messages: Array<{
    type: number;
    typeName: string;
    length: number;
    messageId: number;
  }>;
  sessionParams?: {
    protocolVersion: number;
    keepaliveTime: number;
    maxPduLength: number;
    receiverLsrId: string;
    receiverLabelSpace: number;
  };
} {
  const result = {
    isLDP: false,
    version: 0,
    pduLength: 0,
    lsrId: '',
    labelSpace: 0,
    messages: [] as Array<{
      type: number;
      typeName: string;
      length: number;
      messageId: number;
    }>,
    sessionParams: undefined as {
      protocolVersion: number;
      keepaliveTime: number;
      maxPduLength: number;
      receiverLsrId: string;
      receiverLabelSpace: number;
    } | undefined,
  };

  if (data.length < 10) return result;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // PDU Header
  result.version = view.getUint16(0, false);
  if (result.version !== LDP_VERSION) return result;

  result.isLDP = true;
  result.pduLength = view.getUint16(2, false);
  result.lsrId = formatIPv4(data, 4);
  result.labelSpace = view.getUint16(8, false);

  // Parse messages
  let offset = 10;
  const pduEnd = 4 + result.pduLength;

  while (offset + 8 <= pduEnd && offset + 8 <= data.length) {
    const msgTypeRaw = view.getUint16(offset, false);
    const msgType = msgTypeRaw & 0x7fff; // Remove U-bit
    const msgLength = view.getUint16(offset + 2, false);
    const msgId = view.getUint32(offset + 4, false);

    result.messages.push({
      type: msgType,
      typeName: MSG_TYPE_NAMES[msgType] || `Unknown(0x${msgType.toString(16)})`,
      length: msgLength,
      messageId: msgId,
    });

    // If this is an Initialization message, parse Common Session Parameters
    if (msgType === MSG_INITIALIZATION && offset + 8 + 4 <= data.length) {
      // Look for Common Session Parameters TLV
      let tlvOffset = offset + 8; // After message header (type+len+msgId)
      const msgEnd = offset + 4 + msgLength;

      while (tlvOffset + 4 <= msgEnd && tlvOffset + 4 <= data.length) {
        const tlvType = view.getUint16(tlvOffset, false) & 0x3fff; // Remove U+F bits
        const tlvLength = view.getUint16(tlvOffset + 2, false);

        if (tlvType === (TLV_COMMON_SESSION & 0x3fff) && tlvLength >= 14 && tlvOffset + 4 + tlvLength <= data.length) {
          const tlvBody = tlvOffset + 4;
          result.sessionParams = {
            protocolVersion: view.getUint16(tlvBody, false),
            keepaliveTime: view.getUint16(tlvBody + 2, false),
            maxPduLength: view.getUint16(tlvBody + 6, false),
            receiverLsrId: formatIPv4(data, tlvBody + 8),
            receiverLabelSpace: view.getUint16(tlvBody + 12, false),
          };
        }

        tlvOffset += 4 + tlvLength;
        // TLVs are padded to 4-byte boundaries in some implementations
        if (tlvLength % 4 !== 0) {
          tlvOffset += 4 - (tlvLength % 4);
        }
      }
    }

    offset += 4 + msgLength;
  }

  return result;
}

/**
 * Handle LDP connection test — sends Initialization and parses response.
 */
export async function handleLDPConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 646, timeout = 10000 } = body;

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

    // Send Initialization message
    const initMsg = buildInitializationMessage();
    await writer.write(initMsg);

    // Read response
    const response = await readLDPResponse(reader, timeoutPromise);
    const rtt = Date.now() - startTime;

    const parsed = parseLDPResponse(response);

    // If we got a valid Init back, send KeepAlive to complete handshake
    if (parsed.isLDP && parsed.messages.some(m => m.type === MSG_INITIALIZATION)) {
      try {
        const keepalive = buildKeepaliveMessage();
        await writer.write(keepalive);
      } catch {
        // Ignore write errors during handshake completion
      }
    }

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      connectTime,
      isLDP: parsed.isLDP,
      version: parsed.version,
      lsrId: parsed.lsrId,
      labelSpace: parsed.labelSpace,
      messages: parsed.messages,
      ...(parsed.sessionParams ? {
        sessionParams: parsed.sessionParams,
      } : {}),
      rawBytesReceived: response.length,
      message: parsed.isLDP
        ? `LDP peer detected. LSR-ID: ${parsed.lsrId}:${parsed.labelSpace}. ${parsed.messages.length} message(s): ${parsed.messages.map(m => m.typeName).join(', ')}.${parsed.sessionParams ? ` Keepalive=${parsed.sessionParams.keepaliveTime}s, MaxPDU=${parsed.sessionParams.maxPduLength}.` : ''}`
        : 'Server responded but does not appear to be an LDP peer.',
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
 * Handle LDP probe — lightweight check for LDP protocol response.
 */
export async function handleLDPProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 646, timeout = 10000 } = body;

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

    // Send Initialization
    const initMsg = buildInitializationMessage();
    await writer.write(initMsg);

    // Read response
    const response = await readLDPResponse(reader, timeoutPromise);
    const rtt = Date.now() - startTime;

    const parsed = parseLDPResponse(response);

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      isLDP: parsed.isLDP,
      lsrId: parsed.lsrId,
      labelSpace: parsed.labelSpace,
      messages: parsed.messages.map(m => m.typeName),
      message: parsed.isLDP
        ? `LDP peer detected. LSR-ID: ${parsed.lsrId}:${parsed.labelSpace}.`
        : 'Not an LDP peer.',
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
 * Read multiple LDP PDUs from the stream, accumulating into a growing buffer.
 * Returns all bytes read until EOF or the timeoutPromise rejects.
 */
async function readLDPBuffer(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
  maxBytes: number = 65536,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (total < maxBytes) {
    const result = await Promise.race([
      reader.read(),
      timeoutPromise,
    ]).catch(() => ({ done: true as const, value: undefined }));

    if (result.done || !result.value) break;
    chunks.push(result.value);
    total += result.value.length;
  }

  const combined = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { combined.set(c, off); off += c.length; }
  return combined;
}

/**
 * Parse all LDP PDUs from a byte buffer, extracting label mapping and address info.
 */
function parseLDPLabelData(data: Uint8Array): {
  labels: Array<{ prefix: string; maskLen: number; label: number }>;
  addresses: string[];
  msgTypes: Array<{ type: number; typeName: string }>;
} {
  const labels: Array<{ prefix: string; maskLen: number; label: number }> = [];
  const addresses: string[] = [];
  const msgTypes: Array<{ type: number; typeName: string }> = [];

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pduStart = 0;

  while (pduStart + 10 <= data.length) {
    const version = view.getUint16(pduStart, false);
    if (version !== LDP_VERSION) {
      pduStart++;
      continue;
    }

    const pduContentLen = view.getUint16(pduStart + 2, false);
    const pduEnd = pduStart + 4 + pduContentLen;
    if (pduEnd > data.length) break;

    let offset = pduStart + 10; // skip 10-byte PDU header

    while (offset + 8 <= pduEnd) {
      const msgTypeRaw = view.getUint16(offset, false);
      const msgType = msgTypeRaw & 0x7fff;
      const msgLength = view.getUint16(offset + 2, false);
      const msgEnd = offset + 4 + msgLength;

      if (msgEnd > pduEnd || msgEnd > data.length) break;

      const typeName = MSG_TYPE_NAMES[msgType] || `Unknown(0x${msgType.toString(16)})`;
      msgTypes.push({ type: msgType, typeName });

      if (msgType === MSG_LABEL_MAPPING || msgType === MSG_LABEL_WITHDRAW || msgType === MSG_LABEL_RELEASE) {
        // Parse TLVs: FEC TLV (0x0100) + Generic Label TLV (0x0200)
        let tlvOffset = offset + 8; // skip type(2)+len(2)+msgId(4)
        let currentPrefix = '';
        let currentMaskLen = 0;
        let currentLabel = -1;

        while (tlvOffset + 4 <= msgEnd) {
          const tlvTypeRaw = view.getUint16(tlvOffset, false);
          const tlvType = tlvTypeRaw & 0x3fff;
          const tlvLen = view.getUint16(tlvOffset + 2, false);
          const tlvBody = tlvOffset + 4;
          const tlvEnd = tlvBody + tlvLen;

          if (tlvEnd > msgEnd || tlvEnd > data.length) break;

          if (tlvType === (TLV_FEC & 0x3fff)) {
            let fecOff = tlvBody;
            while (fecOff < tlvEnd) {
              const elemType = data[fecOff];
              if (elemType === FEC_WILDCARD) {
                fecOff += 1;
              } else if (elemType === FEC_PREFIX) {
                if (fecOff + 4 > tlvEnd) break;
                const addrFamily = view.getUint16(fecOff + 1, false);
                const prefixLen = data[fecOff + 3];
                if (addrFamily === AF_IPV4) {
                  const prefixBytes = Math.ceil(prefixLen / 8);
                  if (fecOff + 4 + prefixBytes > tlvEnd) break;
                  const octets = [0, 0, 0, 0];
                  for (let i = 0; i < prefixBytes && i < 4; i++) {
                    octets[i] = data[fecOff + 4 + i];
                  }
                  currentPrefix = octets.join('.');
                  currentMaskLen = prefixLen;
                  fecOff += 4 + prefixBytes;
                } else {
                  break;
                }
              } else {
                break;
              }
            }
          } else if (tlvType === (TLV_GENERIC_LABEL & 0x3fff)) {
            // Generic Label: 4 bytes — label value occupies bits [31:12] (upper 20 bits)
            if (tlvLen >= 4) {
              currentLabel = (view.getUint32(tlvBody, false) & 0xfffff000) >>> 12;
            }
          }

          tlvOffset = tlvEnd;
        }

        if (currentPrefix && currentLabel >= 0) {
          labels.push({ prefix: currentPrefix, maskLen: currentMaskLen, label: currentLabel });
        }
      } else if (msgType === MSG_ADDRESS) {
        // Parse Address List TLV (0x0101)
        let tlvOffset = offset + 8;
        while (tlvOffset + 4 <= msgEnd) {
          const tlvTypeRaw = view.getUint16(tlvOffset, false);
          const tlvType = tlvTypeRaw & 0x3fff;
          const tlvLen = view.getUint16(tlvOffset + 2, false);
          const tlvBody = tlvOffset + 4;
          const tlvEnd = tlvBody + tlvLen;

          if (tlvEnd > msgEnd || tlvEnd > data.length) break;

          if (tlvType === (TLV_ADDRESS_LIST & 0x3fff) && tlvLen >= 2) {
            const addrFamily = view.getUint16(tlvBody, false);
            if (addrFamily === AF_IPV4) {
              let addrOff = tlvBody + 2;
              while (addrOff + 4 <= tlvEnd) {
                addresses.push(formatIPv4(data, addrOff));
                addrOff += 4;
              }
            }
          }

          tlvOffset = tlvEnd;
        }
      }

      offset = msgEnd;
    }

    pduStart = pduEnd;
  }

  return { labels, addresses, msgTypes };
}

/**
 * Handle LDP Label Map collection — performs the full Init+KeepAlive handshake,
 * then listens for Label Mapping, Address, Label Withdraw, and Label Release messages.
 */
export async function handleLDPLabelMap(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 646, timeout = 10000 } = body;

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

    // Step 1: Send Initialization
    const initMsg = buildInitializationMessage();
    await writer.write(initMsg);

    // Step 2: Read Initialization response
    const initResponse = await readLDPResponse(reader, timeoutPromise);
    const initParsed = parseLDPResponse(initResponse);

    if (!initParsed.isLDP) {
      writer.releaseLock();
      reader.releaseLock();
      socket.close();
      return new Response(JSON.stringify({
        success: false,
        error: 'Server did not respond with a valid LDP PDU',
        rawBytesReceived: initResponse.length,
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const lsrId = initParsed.lsrId;
    const labelSpace = initParsed.labelSpace;

    // Step 3: Send KeepAlive to complete the handshake
    const keepalive = buildKeepaliveMessage();
    await writer.write(keepalive);

    // Step 4: Collect label mapping / address messages for up to 2 seconds
    const collectMs = Math.min(2000, Math.max(500, timeout - (Date.now() - startTime) - 500));
    const collectDeadline = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('collect timeout')), collectMs)
    );

    const labelBuffer = await readLDPBuffer(reader, collectDeadline, 65536);
    const rtt = Date.now() - startTime;

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    const { labels, addresses, msgTypes } = parseLDPLabelData(labelBuffer);

    // Deduplicate message type names for the summary
    const seenTypes = new Set<number>();
    const uniqueMsgTypes: string[] = [];
    for (const mt of msgTypes) {
      if (!seenTypes.has(mt.type)) {
        seenTypes.add(mt.type);
        uniqueMsgTypes.push(mt.typeName);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      connectTime,
      lsrId,
      labelSpace,
      labels,
      addresses,
      labelCount: labels.length,
      addressCount: addresses.length,
      messagesObserved: uniqueMsgTypes,
      rawBytesReceived: initResponse.length + labelBuffer.length,
      message: `LDP peer ${lsrId}:${labelSpace}. Collected ${labels.length} label mapping(s) and ${addresses.length} address(es) in ${rtt}ms.`,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({
      success: false,
      error: msg,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
