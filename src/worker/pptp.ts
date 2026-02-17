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

/**
 * Handle PPTP Start-Control-Connection handshake with detailed result codes.
 * Sends SCCRQ and parses SCCRP, returning resultCode, errorCode, and vendor info.
 * Request body: { host, port=1723, timeout=10000 }
 */
export async function handlePPTPStartControl(request: Request): Promise<Response> {
  try {
    const body = await request.json() as { host: string; port?: number; timeout?: number };
    const { host, port = 1723, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout));

    const work = (async () => {
      const start = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        await writer.write(buildSCCRQ());
        writer.releaseLock();
        const data = await readExact(reader, SCCRQ_LENGTH);
        const latencyMs = Date.now() - start;
        reader.releaseLock();
        socket.close();

        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const ctrlType = view.getUint16(8, false);
        const cookie   = view.getUint32(4, false);
        if (cookie !== PPTP_MAGIC_COOKIE) throw new Error(`Bad magic cookie: 0x${cookie.toString(16)}`);
        if (ctrlType !== PPTP_CTRL_START_REPLY) throw new Error(`Expected SCCRP (type 2), got ${ctrlType}`);

        // Body starts at offset 12
        const protoVer  = view.getUint16(12, false);
        const resultCode = view.getUint8(14);
        const errorCode  = view.getUint8(15);
        const maxChannels = view.getUint16(24, false);
        const dec = new TextDecoder();
        const hostName   = dec.decode(data.subarray(28, 92)).replace(/\0+$/, '').trim();
        const vendorName = dec.decode(data.subarray(92, 156)).replace(/\0+$/, '').trim();

        return {
          success: resultCode === 1,
          resultCode,
          resultText: getResultCodeName(resultCode),
          errorCode,
          protocolVersion: `${(protoVer >> 8) & 0xff}.${protoVer & 0xff}`,
          maxChannels,
          hostName,
          vendorName,
          latencyMs,
        };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        socket.close();
        throw err;
      }
    })();

    const result = await Promise.race([work, timeoutPromise]);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false, error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/** PPTP Outgoing Call message types (RFC 2637 §9.1) */
const PPTP_CTRL_OUTGOING_CALL_REQUEST = 7;
const PPTP_CTRL_OUTGOING_CALL_REPLY   = 8;

/** OCRQ total length: 12-byte header + 156-byte body = 168 bytes */
const OCRQ_LENGTH = 168;

/** OCRP result codes (RFC 2637 §9.1.2) */
const OCRP_RESULT_CODES: Record<number, string> = {
  1: 'Connected',
  2: 'General error',
  3: 'No carrier',
  4: 'Busy',
  5: 'No dial tone',
  6: 'Time out',
  7: 'Do not accept',
};

/**
 * Build an Outgoing-Call-Request (OCRQ) message.
 * RFC 2637 §9.1.1 — Initiates an outgoing call from client to server.
 *
 * Header (12 bytes):
 *   Length(2) | PPTP-Type(2)=1 | Cookie(4) | Ctrl-Type(2)=7 | Reserved(2)
 * Body (156 bytes):
 *   Call ID(2) | Call Serial(2) | Min BPS(4) | Max BPS(4)
 *   Bearer Type(4) | Framing Type(4) | Recv Window(2) | Proc Delay(2)
 *   Phone Len(2) | Reserved(2) | Phone(64) | Subaddress(64)
 */
function buildOCRQ(callId: number): Uint8Array {
  const buf = new ArrayBuffer(OCRQ_LENGTH);
  const v = new DataView(buf);
  let off = 0;

  // Header
  v.setUint16(off, OCRQ_LENGTH, false);          off += 2;  // Length
  v.setUint16(off, 1, false);                    off += 2;  // PPTP Message Type
  v.setUint32(off, PPTP_MAGIC_COOKIE, false);    off += 4;  // Magic Cookie
  v.setUint16(off, PPTP_CTRL_OUTGOING_CALL_REQUEST, false); off += 2;
  v.setUint16(off, 0, false);                    off += 2;  // Reserved

  // Body
  v.setUint16(off, callId & 0xFFFF, false);      off += 2;  // Call ID
  v.setUint16(off, 1, false);                    off += 2;  // Call Serial Number
  v.setUint32(off, 300, false);                  off += 4;  // Minimum BPS
  v.setUint32(off, 100000000, false);            off += 4;  // Maximum BPS (100 Mbps)
  v.setUint32(off, 0x00000001, false);           off += 4;  // Bearer Type (analog)
  v.setUint32(off, 0x00000001, false);           off += 4;  // Framing Type (async)
  v.setUint16(off, 64, false);                   off += 2;  // Receive Window Size
  v.setUint16(off, 0, false);                    off += 2;  // Processing Delay
  v.setUint16(off, 0, false);                    off += 2;  // Phone Number Length (0 = no number)
  v.setUint16(off, 0, false);                    off += 2;  // Reserved
  // Phone Number (64 bytes, zeros) + Subaddress (64 bytes, zeros) — left zeroed by ArrayBuffer

  return new Uint8Array(buf);
}

/**
 * PPTP Call Setup Handler
 * POST /api/pptp/call-setup
 * Body: { host, port=1723, timeout=10000 }
 *
 * Full PPTP call establishment flow (RFC 2637):
 *   1. SCCRQ → SCCRP  (tunnel setup)
 *   2. OCRQ → OCRP    (outgoing call setup)
 *
 * Returns server hostname, vendor, protocol version, call ID, connect speed.
 */
export async function handlePPTPCallSetup(request: Request): Promise<Response> {
  try {
    const body = await request.json() as { host: string; port?: number; timeout?: number };
    const { host, port = 1723, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout));

    const work = (async () => {
      const start = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Step 1: SCCRQ → SCCRP (control tunnel)
        await writer.write(buildSCCRQ());
        const sccrpData = await readExact(reader, SCCRQ_LENGTH);

        const dv = new DataView(sccrpData.buffer, sccrpData.byteOffset, sccrpData.byteLength);
        if (dv.getUint32(4, false) !== PPTP_MAGIC_COOKIE) throw new Error('Bad SCCRP magic cookie');
        if (dv.getUint16(8, false) !== PPTP_CTRL_START_REPLY) throw new Error('Expected SCCRP');

        const protocolVersion = `${(dv.getUint16(12, false) >> 8) & 0xFF}.${dv.getUint16(12, false) & 0xFF}`;
        const sccrpResult    = dv.getUint8(14);
        const maxChannels    = dv.getUint16(24, false);
        const dec            = new TextDecoder();
        const serverHostname = dec.decode(sccrpData.subarray(28, 92)).replace(/\0+$/, '').trim();
        const serverVendor   = dec.decode(sccrpData.subarray(92, 156)).replace(/\0+$/, '').trim();

        const tunnelEstablished = sccrpResult === 1;

        // Step 2: OCRQ → OCRP (outgoing call)
        const localCallId = Math.floor(Math.random() * 0xFFFF) + 1;
        await writer.write(buildOCRQ(localCallId));

        // OCRP is 32 bytes: 12 header + 18 body + 2 padding
        const ocrpData = await readExact(reader, 32);
        const ocrpDv = new DataView(ocrpData.buffer, ocrpData.byteOffset, ocrpData.byteLength);

        if (ocrpDv.getUint32(4, false) !== PPTP_MAGIC_COOKIE) throw new Error('Bad OCRP magic cookie');
        const ocrpCtrlType = ocrpDv.getUint16(8, false);
        if (ocrpCtrlType !== PPTP_CTRL_OUTGOING_CALL_REPLY) {
          throw new Error(`Expected OCRP (type 8), got ${ocrpCtrlType}`);
        }

        // OCRP body (starts at offset 12):
        // peerCallId(2) + reserved(1) + resultCode(1) + errorCode(1) + causeCode(2) + connectSpeed(4)
        // + recvWindowSize(2) + procDelay(2) + physChannelId(4)
        const peerCallId    = ocrpDv.getUint16(12, false);
        const ocrpResult    = ocrpDv.getUint8(15);
        const ocrpError     = ocrpDv.getUint8(16);
        const connectSpeed  = ocrpDv.getUint32(19, false);

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return {
          success: tunnelEstablished && ocrpResult === 1,
          tunnelEstablished,
          serverHostname,
          serverVendor,
          protocolVersion,
          maxChannels,
          localCallId,
          peerCallId,
          callResult: ocrpResult,
          callResultText: OCRP_RESULT_CODES[ocrpResult] ?? `Unknown(${ocrpResult})`,
          callErrorCode: ocrpError,
          connectSpeed,
          latencyMs: Date.now() - start,
          note: ocrpResult !== 1
            ? 'OCRP rejected call — server may require PPP authentication before allowing outgoing calls'
            : undefined,
        };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        socket.close();
        throw err;
      }
    })();

    const result = await Promise.race([work, timeoutPromise]);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false, error: error instanceof Error ? error.message : 'PPTP call setup failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
