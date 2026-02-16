/**
 * RDP (Remote Desktop Protocol) Implementation
 *
 * Implements connectivity testing for RDP servers using the
 * X.224 Connection Request / Connection Confirm handshake (MS-RDPBCGR).
 *
 * Protocol Flow:
 * 1. Client sends TPKT header + X.224 Connection Request + RDP Negotiation Request
 * 2. Server sends TPKT header + X.224 Connection Confirm + RDP Negotiation Response
 *
 * TPKT Header (4 bytes):
 *   version(1) = 3 | reserved(1) = 0 | length(2, big-endian)
 *
 * X.224 Connection Request:
 *   length(1) | type(1) = 0xE0 | dst-ref(2) | src-ref(2) | class(1)
 *
 * RDP Negotiation Request (8 bytes):
 *   type(1) = 0x01 | flags(1) | length(2) = 8 | requestedProtocols(4)
 *
 * Requested Protocols:
 *   0x00000000 = Standard RDP Security
 *   0x00000001 = TLS 1.0/1.1/1.2
 *   0x00000002 = CredSSP (NLA)
 *   0x00000008 = RDSTLS
 *
 * Use Cases:
 * - RDP server discovery and connectivity testing
 * - Security protocol detection (Standard/TLS/NLA)
 * - Remote desktop infrastructure validation
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// RDP Negotiation Protocol constants
const PROTOCOL_RDP = 0x00000000;
const PROTOCOL_SSL = 0x00000001;
const PROTOCOL_HYBRID = 0x00000002; // CredSSP / NLA
const PROTOCOL_RDSTLS = 0x00000008;

// Negotiation response types
const TYPE_RDP_NEG_RSP = 0x02;
const TYPE_RDP_NEG_FAILURE = 0x03;

// Failure codes
const FAILURE_CODES: Record<number, string> = {
  0x01: 'SSL_REQUIRED_BY_SERVER',
  0x02: 'SSL_NOT_ALLOWED_BY_SERVER',
  0x03: 'SSL_CERT_NOT_ON_SERVER',
  0x04: 'INCONSISTENT_FLAGS',
  0x05: 'HYBRID_REQUIRED_BY_SERVER',
  0x06: 'SSL_WITH_USER_AUTH_REQUIRED_BY_SERVER',
};

/**
 * Build the X.224 Connection Request with RDP Negotiation
 */
function buildConnectionRequest(): Uint8Array {
  // Request all protocols we want to detect
  const requestedProtocols = PROTOCOL_SSL | PROTOCOL_HYBRID | PROTOCOL_RDSTLS;

  // RDP Negotiation Request (8 bytes)
  const negReq = new Uint8Array(8);
  negReq[0] = 0x01; // TYPE_RDP_NEG_REQ
  negReq[1] = 0x00; // flags
  new DataView(negReq.buffer).setUint16(2, 8, true); // length (little-endian)
  new DataView(negReq.buffer).setUint32(4, requestedProtocols, true); // protocols (little-endian)

  // X.224 Connection Request PDU
  const x224Length = 6 + negReq.length; // 6 bytes X.224 header + negotiation
  const x224 = new Uint8Array(1 + x224Length);
  x224[0] = x224Length; // length indicator
  x224[1] = 0xE0;      // Connection Request (CR)
  // dst-ref(2) = 0x0000, src-ref(2) = 0x0000, class(1) = 0x00
  x224[2] = 0x00; x224[3] = 0x00; // dst-ref
  x224[4] = 0x00; x224[5] = 0x00; // src-ref
  x224[6] = 0x00; // class options
  x224.set(negReq, 7);

  // TPKT Header (4 bytes)
  const totalLength = 4 + x224.length;
  const tpkt = new Uint8Array(totalLength);
  tpkt[0] = 0x03; // version
  tpkt[1] = 0x00; // reserved
  new DataView(tpkt.buffer).setUint16(2, totalLength, false); // length (big-endian)
  tpkt.set(x224, 4);

  return tpkt;
}

/**
 * Get human-readable protocol names
 */
function getProtocolNames(protocols: number): string[] {
  const names: string[] = [];
  if (protocols === PROTOCOL_RDP) names.push('Standard RDP Security');
  if (protocols & PROTOCOL_SSL) names.push('TLS');
  if (protocols & PROTOCOL_HYBRID) names.push('CredSSP/NLA');
  if (protocols & PROTOCOL_RDSTLS) names.push('RDSTLS');
  return names.length > 0 ? names : ['Standard RDP Security'];
}

/**
 * Read exactly `length` bytes from a reader
 */
async function readExact(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  length: number,
): Promise<Uint8Array> {
  const buffer = new Uint8Array(length);
  let offset = 0;

  while (offset < length) {
    const { value, done } = await reader.read();
    if (done || !value) throw new Error('Connection closed while reading');

    const toCopy = Math.min(length - offset, value.length);
    buffer.set(value.subarray(0, toCopy), offset);
    offset += toCopy;
  }

  return buffer;
}

/**
 * Handle RDP connection test
 * Sends X.224 Connection Request and parses the response
 */
export async function handleRDPConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 3389, timeout = 10000 } = body;

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

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const connectTime = Date.now() - startTime;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Send X.224 Connection Request
        await writer.write(buildConnectionRequest());

        // Read TPKT header (4 bytes)
        const tpktHeader = await readExact(reader, 4);
        const tpktVersion = tpktHeader[0];
        const tpktLength = new DataView(tpktHeader.buffer).getUint16(2, false);

        if (tpktVersion !== 3) {
          throw new Error(`Invalid TPKT version: ${tpktVersion} (expected 3)`);
        }

        // Read the rest of the packet
        const remaining = tpktLength - 4;
        const responseData = await readExact(reader, remaining);

        const rtt = Date.now() - startTime;

        // Parse X.224 header
        const x224Length = responseData[0];
        const x224Type = responseData[1];

        // Connection Confirm = 0xD0
        if (x224Type !== 0xD0) {
          throw new Error(`Unexpected X.224 type: 0x${x224Type.toString(16)} (expected 0xD0 Connection Confirm)`);
        }

        // Parse RDP Negotiation Response (if present)
        // X.224 CC header is 7 bytes (length indicator + 6 bytes)
        let selectedProtocol = PROTOCOL_RDP;
        let negotiationType = 0;
        let negotiationFlags = 0;
        let failureCode = 0;
        let failureMessage = '';
        let hasNegotiation = false;

        const negOffset = x224Length; // negotiation starts after x224 header
        if (remaining > negOffset) {
          hasNegotiation = true;
          negotiationType = responseData[negOffset];
          negotiationFlags = responseData[negOffset + 1];

          if (negotiationType === TYPE_RDP_NEG_RSP) {
            selectedProtocol = new DataView(
              responseData.buffer, responseData.byteOffset + negOffset + 4
            ).getUint32(0, true);
          } else if (negotiationType === TYPE_RDP_NEG_FAILURE) {
            failureCode = new DataView(
              responseData.buffer, responseData.byteOffset + negOffset + 4
            ).getUint32(0, true);
            failureMessage = FAILURE_CODES[failureCode] || `Unknown failure (${failureCode})`;
          }
        }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        const nlaRequired = (negotiationFlags & 0x02) !== 0; // EXTENDED_CLIENT_DATA_SUPPORTED implies NLA may be needed

        return {
          success: true,
          host,
          port,
          connectTime,
          rtt,
          tpktVersion,
          x224Type: '0xD0 (Connection Confirm)',
          hasNegotiation,
          selectedProtocol,
          selectedProtocolNames: getProtocolNames(selectedProtocol),
          negotiationFlags,
          nlaRequired,
          failureCode: failureCode || undefined,
          failureMessage: failureMessage || undefined,
        };
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        throw error;
      }
    })();

    const result = await Promise.race([connectionPromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
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
