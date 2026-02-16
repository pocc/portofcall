/**
 * PPTP (Point-to-Point Tunneling Protocol) Implementation
 *
 * Implements connectivity testing for PPTP VPN servers using the
 * control channel on TCP port 1723 (RFC 2637).
 *
 * Protocol Flow:
 * 1. Client sends Start-Control-Connection-Request (SCCRQ)
 * 2. Server responds with Start-Control-Connection-Reply (SCCRP)
 * 3. We parse version, framing/bearer capabilities, hostname, vendor
 *
 * Control Message Format:
 *   Length (2 bytes) | PPTP Message Type (2 bytes, always 1) |
 *   Magic Cookie (4 bytes: 0x1A2B3C4D) | Control Type (2 bytes) |
 *   Reserved (2 bytes) | Message-specific fields...
 *
 * SCCRQ/SCCRP Message Body (144 bytes):
 *   Protocol Version (2 bytes) | Result Code (1 byte, reply only) |
 *   Error Code (1 byte, reply only) | Framing Capabilities (4 bytes) |
 *   Bearer Capabilities (4 bytes) | Max Channels (2 bytes) |
 *   Firmware Revision (2 bytes) | Hostname (64 bytes) | Vendor (64 bytes)
 *
 * Use Cases:
 * - PPTP VPN server discovery and fingerprinting
 * - Protocol version detection
 * - Server capability enumeration
 * - Legacy VPN infrastructure auditing
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/** PPTP Magic Cookie */
const PPTP_MAGIC_COOKIE = 0x1a2b3c4d;

/** PPTP Control Message Types */
const PPTP_CTRL_START_REQUEST = 1;
const PPTP_CTRL_START_REPLY = 2;

/** Total SCCRQ message size: 12-byte header + 144-byte body = 156 bytes */
const SCCRQ_LENGTH = 156;

/** Result code descriptions */
function getResultCodeName(code: number): string {
  const names: Record<number, string> = {
    1: 'Successful channel establishment',
    2: 'General error',
    3: 'Command channel already exists',
    4: 'Requester is not authorized',
    5: 'Protocol version not supported',
  };
  return names[code] || `Unknown(${code})`;
}

/** Framing capability flags */
function getFramingCapabilities(flags: number): string[] {
  const caps: string[] = [];
  if (flags & 0x00000001) caps.push('Asynchronous framing');
  if (flags & 0x00000002) caps.push('Synchronous framing');
  if (caps.length === 0) caps.push('None');
  return caps;
}

/** Bearer capability flags */
function getBearerCapabilities(flags: number): string[] {
  const caps: string[] = [];
  if (flags & 0x00000001) caps.push('Analog access');
  if (flags & 0x00000002) caps.push('Digital access');
  if (caps.length === 0) caps.push('None');
  return caps;
}

/**
 * Build a Start-Control-Connection-Request (SCCRQ) message
 */
function buildSCCRQ(): Uint8Array {
  const buffer = new ArrayBuffer(SCCRQ_LENGTH);
  const view = new DataView(buffer);
  let offset = 0;

  // Header (12 bytes)
  view.setUint16(offset, SCCRQ_LENGTH, false); offset += 2;     // Length
  view.setUint16(offset, 1, false); offset += 2;                 // PPTP Message Type (1 = Control)
  view.setUint32(offset, PPTP_MAGIC_COOKIE, false); offset += 4; // Magic Cookie
  view.setUint16(offset, PPTP_CTRL_START_REQUEST, false); offset += 2; // Control Message Type
  view.setUint16(offset, 0, false); offset += 2;                 // Reserved0

  // Body
  view.setUint16(offset, 0x0100, false); offset += 2;            // Protocol Version (1.0)
  view.setUint16(offset, 0, false); offset += 2;                 // Reserved1
  view.setUint32(offset, 0x00000003, false); offset += 4;        // Framing Capabilities (async + sync)
  view.setUint32(offset, 0x00000003, false); offset += 4;        // Bearer Capabilities (analog + digital)
  view.setUint16(offset, 0, false); offset += 2;                 // Maximum Channels
  view.setUint16(offset, 0, false); offset += 2;                 // Firmware Revision

  // Hostname (64 bytes, zero-padded)
  const hostname = new TextEncoder().encode('PortOfCall-Probe');
  const hostBytes = new Uint8Array(buffer, offset, 64);
  hostBytes.set(hostname.subarray(0, Math.min(hostname.length, 63)));
  offset += 64;

  // Vendor Name (64 bytes, zero-padded)
  const vendor = new TextEncoder().encode('PortOfCall');
  const vendorBytes = new Uint8Array(buffer, offset, 64);
  vendorBytes.set(vendor.subarray(0, Math.min(vendor.length, 63)));

  return new Uint8Array(buffer);
}

/**
 * Read exactly `length` bytes from a reader, accumulating chunks
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
 * Parse a Start-Control-Connection-Reply (SCCRP) message
 */
function parseSCCRP(data: Uint8Array): {
  protocolVersion: string;
  resultCode: number;
  resultCodeName: string;
  errorCode: number;
  framingCapabilities: string[];
  bearerCapabilities: string[];
  maxChannels: number;
  firmwareRevision: string;
  hostname: string;
  vendor: string;
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  // Validate header
  view.getUint16(offset, false); offset += 2; // Length (consumed but not needed)
  const messageType = view.getUint16(offset, false); offset += 2;
  const magicCookie = view.getUint32(offset, false); offset += 4;
  const controlType = view.getUint16(offset, false); offset += 2;
  offset += 2; // Reserved0

  if (messageType !== 1) {
    throw new Error(`Not a PPTP control message (type: ${messageType})`);
  }

  if (magicCookie !== PPTP_MAGIC_COOKIE) {
    throw new Error(`Invalid PPTP magic cookie: 0x${magicCookie.toString(16)}`);
  }

  if (controlType !== PPTP_CTRL_START_REPLY) {
    throw new Error(`Unexpected control type: ${controlType} (expected Start-Control-Connection-Reply)`);
  }

  // Parse body
  const protocolVersionRaw = view.getUint16(offset, false); offset += 2;
  const protocolMajor = (protocolVersionRaw >> 8) & 0xff;
  const protocolMinor = protocolVersionRaw & 0xff;

  const resultCode = view.getUint8(offset); offset += 1;
  const errorCode = view.getUint8(offset); offset += 1;

  const framingFlags = view.getUint32(offset, false); offset += 4;
  const bearerFlags = view.getUint32(offset, false); offset += 4;
  const maxChannels = view.getUint16(offset, false); offset += 2;
  const firmwareRaw = view.getUint16(offset, false); offset += 2;

  // Hostname (64 bytes, null-terminated)
  const hostnameBytes = data.subarray(offset, offset + 64);
  const hostname = new TextDecoder().decode(hostnameBytes).replace(/\0+$/, '').trim();
  offset += 64;

  // Vendor (64 bytes, null-terminated)
  const vendorBytes = data.subarray(offset, offset + 64);
  const vendor = new TextDecoder().decode(vendorBytes).replace(/\0+$/, '').trim();

  return {
    protocolVersion: `${protocolMajor}.${protocolMinor}`,
    resultCode,
    resultCodeName: getResultCodeName(resultCode),
    errorCode,
    framingCapabilities: getFramingCapabilities(framingFlags),
    bearerCapabilities: getBearerCapabilities(bearerFlags),
    maxChannels,
    firmwareRevision: `${(firmwareRaw >> 8) & 0xff}.${firmwareRaw & 0xff}`,
    hostname,
    vendor,
  };
}

/**
 * Handle PPTP connection probe
 * Sends SCCRQ and parses SCCRP to discover server capabilities
 */
export async function handlePPTPConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 1723, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required (host parameter missing)',
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
        // Step 1: Send Start-Control-Connection-Request
        const sccrq = buildSCCRQ();
        await writer.write(sccrq);

        // Step 2: Read Start-Control-Connection-Reply (156 bytes)
        const sccrp = await readExact(reader, SCCRQ_LENGTH);
        const rtt = Date.now() - startTime;

        // Step 3: Parse response
        const parsed = parseSCCRP(sccrp);

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return {
          success: true,
          host,
          port,
          connectTime,
          rtt,
          ...parsed,
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
