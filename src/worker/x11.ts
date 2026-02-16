/**
 * X11 Protocol Implementation (X Window System)
 *
 * X11 is the network-transparent windowing protocol used by Unix/Linux systems.
 * This implements a connection probe that performs the X11 setup handshake
 * and reports server information.
 *
 * Protocol Flow:
 * 1. Client connects to port 6000 + display_number
 * 2. Client sends connection setup request (byte order, protocol version, auth)
 * 3. Server responds with success (1), failure (0), or authenticate (2)
 * 4. On success: server info includes vendor, root window, screen dimensions
 *
 * Use Cases:
 * - X11 server discovery and connectivity testing
 * - Display server fingerprinting (vendor, version)
 * - Screen configuration detection
 * - Security auditing (open X11 servers)
 */

import { connect } from 'cloudflare:sockets';

interface X11ConnectRequest {
  host: string;
  port?: number;
  display?: number;
  authName?: string;
  authData?: string; // hex-encoded
  timeout?: number;
}

/**
 * Read exactly N bytes from a socket reader
 */
async function readExact(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  length: number,
  timeoutPromise: Promise<never>,
): Promise<Uint8Array> {
  const buffer = new Uint8Array(length);
  let offset = 0;

  while (offset < length) {
    const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
    if (done || !value) throw new Error('Connection closed unexpectedly');

    const toCopy = Math.min(length - offset, value.length);
    buffer.set(value.subarray(0, toCopy), offset);
    offset += toCopy;

    // If we got more data than needed, we can't push it back easily,
    // but for the setup flow we read in exact chunks so this is fine
  }

  return buffer;
}

/**
 * Build X11 connection setup request
 * Byte order: 'l' (little-endian, 0x6C)
 * Protocol: version 11.0
 * Auth: optional MIT-MAGIC-COOKIE-1
 */
function buildSetupRequest(authName?: string, authData?: Uint8Array): Uint8Array {
  const authNameBytes = authName ? new TextEncoder().encode(authName) : new Uint8Array(0);
  const authDataBytes = authData || new Uint8Array(0);

  const authNamePad = (4 - (authNameBytes.length % 4)) % 4;
  const authDataPad = (4 - (authDataBytes.length % 4)) % 4;

  const totalLength = 12 + authNameBytes.length + authNamePad + authDataBytes.length + authDataPad;
  const buffer = new Uint8Array(totalLength);
  const view = new DataView(buffer.buffer);

  let offset = 0;

  // Byte order: little-endian
  buffer[offset++] = 0x6C; // 'l'

  // Unused padding
  buffer[offset++] = 0x00;

  // Protocol major version: 11
  view.setUint16(offset, 11, true);
  offset += 2;

  // Protocol minor version: 0
  view.setUint16(offset, 0, true);
  offset += 2;

  // Authorization protocol name length
  view.setUint16(offset, authNameBytes.length, true);
  offset += 2;

  // Authorization protocol data length
  view.setUint16(offset, authDataBytes.length, true);
  offset += 2;

  // Unused
  view.setUint16(offset, 0, true);
  offset += 2;

  // Auth name + padding
  if (authNameBytes.length > 0) {
    buffer.set(authNameBytes, offset);
    offset += authNameBytes.length + authNamePad;
  }

  // Auth data + padding
  if (authDataBytes.length > 0) {
    buffer.set(authDataBytes, offset);
  }

  return buffer;
}

/**
 * Parse hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const cleaned = hex.replace(/\s/g, '');
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleaned.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Parse X11 setup success response
 */
function parseSetupSuccess(data: Uint8Array): {
  protocolMajor: number;
  protocolMinor: number;
  vendor: string;
  releaseNumber: number;
  resourceIdBase: number;
  resourceIdMask: number;
  maxRequestLength: number;
  numScreens: number;
  numFormats: number;
  imageByteOrder: string;
  bitmapBitOrder: string;
  minKeycode: number;
  maxKeycode: number;
  screens: Array<{
    rootWindow: number;
    defaultColormap: number;
    whitePixel: number;
    blackPixel: number;
    widthPixels: number;
    heightPixels: number;
    widthMM: number;
    heightMM: number;
    rootDepth: number;
    numDepths: number;
  }>;
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder();

  // The first byte (success=1) and padding byte have already been consumed
  // data starts at the "additional data" portion after the 8-byte header

  // Parse the additional data length first (it's in 4-byte units)
  // Layout after status byte:
  // [0] = unused padding (already skipped in header read)
  // Header was: status(1) + unused(1) + major(2) + minor(2) + additionalDataLen(2) = 8 bytes
  // data starts at the additional data

  const protocolMajor = view.getUint16(0, true);
  const protocolMinor = view.getUint16(2, true);
  // skip additional data length at offset 4 (2 bytes)
  const releaseNumber = view.getUint32(6, true);
  const resourceIdBase = view.getUint32(10, true);
  const resourceIdMask = view.getUint32(14, true);
  // skip motion buffer size at offset 18 (4 bytes)
  const vendorLength = view.getUint16(22, true);
  const maxRequestLength = view.getUint16(24, true);
  const numScreens = data[26];
  const numFormats = data[27];
  const imageByteOrder = data[28] === 0 ? 'LSBFirst' : 'MSBFirst';
  const bitmapBitOrder = data[29] === 0 ? 'LeastSignificant' : 'MostSignificant';
  // skip bitmap scanline unit(1) + bitmap scanline pad(1) at 30-31
  const minKeycode = data[32];
  const maxKeycode = data[33];
  // skip 4 bytes unused at 34

  // Vendor string starts at offset 38 (after 32 bytes fixed + 4 unused + 2 unused? let me recalculate)
  // Actually the fixed portion is 32 bytes, vendor starts at byte 38
  // Wait, let me recount. The additional data layout:
  // Bytes 0-1: protocol version major
  // Bytes 2-3: protocol version minor
  // Bytes 4-5: additional data length in 4-byte units
  // Bytes 6-9: release number
  // Bytes 10-13: resource-id-base
  // Bytes 14-17: resource-id-mask
  // Bytes 18-21: motion-buffer-size
  // Bytes 22-23: vendor length
  // Bytes 24-25: maximum-request-length
  // Byte 26: number of screens
  // Byte 27: number of pixmap formats
  // Byte 28: image-byte-order
  // Byte 29: bitmap-format-bit-order
  // Byte 30: bitmap-format-scanline-unit
  // Byte 31: bitmap-format-scanline-pad
  // Byte 32: min-keycode
  // Byte 33: max-keycode
  // Bytes 34-37: unused (4 bytes)
  // Bytes 38+: vendor string (vendorLength bytes, padded to 4)

  const vendorStart = 38;
  const vendor = decoder.decode(data.subarray(vendorStart, vendorStart + vendorLength)).trim();
  const vendorPad = (4 - (vendorLength % 4)) % 4;

  // Pixmap formats start after vendor
  const formatsStart = vendorStart + vendorLength + vendorPad;
  // Each format is 8 bytes: depth(1) + bits-per-pixel(1) + scanline-pad(1) + unused(5)
  const screensStart = formatsStart + numFormats * 8;

  // Parse screens
  const screens: Array<{
    rootWindow: number;
    defaultColormap: number;
    whitePixel: number;
    blackPixel: number;
    widthPixels: number;
    heightPixels: number;
    widthMM: number;
    heightMM: number;
    rootDepth: number;
    numDepths: number;
  }> = [];

  let screenOffset = screensStart;
  for (let i = 0; i < numScreens && screenOffset + 40 <= data.length; i++) {
    const sv = new DataView(data.buffer, data.byteOffset + screenOffset);
    const rootWindow = sv.getUint32(0, true);
    const defaultColormap = sv.getUint32(4, true);
    const whitePixel = sv.getUint32(8, true);
    const blackPixel = sv.getUint32(12, true);
    // skip current-input-masks(4) at 16
    const widthPixels = sv.getUint16(20, true);
    const heightPixels = sv.getUint16(22, true);
    const widthMM = sv.getUint16(24, true);
    const heightMM = sv.getUint16(26, true);
    // skip min-installed-maps(2) + max-installed-maps(2) at 28-31
    // skip root-visual(4) at 32
    // skip backing-stores(1) + save-unders(1) at 36-37
    const rootDepth = data[screenOffset + 38];
    const numDepths = data[screenOffset + 39];

    screens.push({
      rootWindow, defaultColormap, whitePixel, blackPixel,
      widthPixels, heightPixels, widthMM, heightMM,
      rootDepth, numDepths,
    });

    // Each screen is 40 bytes fixed + depth info (variable)
    // For simplicity, only parse the first screen's fixed data
    // Skip remaining depth data
    screenOffset += 40;
    for (let d = 0; d < numDepths && screenOffset + 4 <= data.length; d++) {
      // depth: depth(1) + unused(1) + numVisuals(2) + unused(4) + visuals(numVisuals*24)
      const numVisuals = new DataView(data.buffer, data.byteOffset + screenOffset + 2).getUint16(0, true);
      screenOffset += 8 + numVisuals * 24;
    }
  }

  return {
    protocolMajor, protocolMinor, vendor, releaseNumber,
    resourceIdBase, resourceIdMask, maxRequestLength,
    numScreens, numFormats, imageByteOrder, bitmapBitOrder,
    minKeycode, maxKeycode, screens,
  };
}

/**
 * Handle X11 connection probe
 */
export async function handleX11Connect(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as X11ConnectRequest;
    const { host, display = 0, timeout = 10000 } = body;
    let { port } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Calculate port: 6000 + display number, or use explicit port
    if (!port) {
      port = 6000 + display;
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (display < 0 || display > 63) {
      return new Response(JSON.stringify({ success: false, error: 'Display number must be between 0 and 63' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Parse optional auth
    let authName: string | undefined;
    let authData: Uint8Array | undefined;
    if (body.authName) {
      authName = body.authName;
      if (body.authData) {
        try {
          authData = hexToBytes(body.authData);
        } catch {
          return new Response(JSON.stringify({ success: false, error: 'Invalid auth data (must be hex-encoded)' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const socket = connect(`${host}:${port}`);

    try {
      const startTime = Date.now();
      await Promise.race([socket.opened, timeoutPromise]);
      const connectTime = Date.now() - startTime;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      // Send setup request
      const setupReq = buildSetupRequest(authName, authData);
      await writer.write(setupReq);

      // Read response header: status(1) + padding/reason-length(1) + major(2) + minor(2) + additional-data-length(2) = 8 bytes
      const header = await readExact(reader, 8, timeoutPromise);
      const status = header[0];
      const rtt = Date.now() - startTime;

      if (status === 1) {
        // Success
        const additionalDataLength = new DataView(header.buffer).getUint16(6, true) * 4;

        if (additionalDataLength > 65536) {
          throw new Error('Setup response too large');
        }

        // Read additional data
        // The header already contains version info, so we combine
        const fullData = new Uint8Array(6 + additionalDataLength);
        // Copy version fields from header (bytes 2-7 = major(2) + minor(2) + addl_len(2))
        fullData.set(header.subarray(2), 0);
        if (additionalDataLength > 0) {
          const additionalData = await readExact(reader, additionalDataLength, timeoutPromise);
          fullData.set(additionalData, 6);
        }

        const info = parseSetupSuccess(fullData);

        reader.releaseLock();
        writer.releaseLock();
        socket.close();

        return new Response(JSON.stringify({
          success: true,
          host,
          port,
          display,
          connectTime,
          rtt,
          status: 'connected',
          protocolVersion: `${info.protocolMajor}.${info.protocolMinor}`,
          vendor: info.vendor,
          releaseNumber: info.releaseNumber,
          maxRequestLength: info.maxRequestLength,
          imageByteOrder: info.imageByteOrder,
          bitmapBitOrder: info.bitmapBitOrder,
          minKeycode: info.minKeycode,
          maxKeycode: info.maxKeycode,
          numScreens: info.numScreens,
          numFormats: info.numFormats,
          screens: info.screens.map((s, i) => ({
            screen: i,
            rootWindow: `0x${s.rootWindow.toString(16)}`,
            resolution: `${s.widthPixels}x${s.heightPixels}`,
            physicalSize: `${s.widthMM}x${s.heightMM}mm`,
            rootDepth: s.rootDepth,
            whitePixel: `0x${s.whitePixel.toString(16)}`,
            blackPixel: `0x${s.blackPixel.toString(16)}`,
          })),
        }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      } else if (status === 0) {
        // Failed
        const reasonLength = header[1];
        const protocolMajor = new DataView(header.buffer).getUint16(2, true);
        const protocolMinor = new DataView(header.buffer).getUint16(4, true);
        const additionalDataLength = new DataView(header.buffer).getUint16(6, true) * 4;

        let reason = 'Unknown';
        if (additionalDataLength > 0 && additionalDataLength < 4096) {
          const reasonData = await readExact(reader, additionalDataLength, timeoutPromise);
          reason = new TextDecoder().decode(reasonData.subarray(0, reasonLength)).trim();
        }

        reader.releaseLock();
        writer.releaseLock();
        socket.close();

        return new Response(JSON.stringify({
          success: true,
          host,
          port,
          display,
          connectTime,
          rtt,
          status: 'rejected',
          protocolVersion: `${protocolMajor}.${protocolMinor}`,
          reason,
        }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      } else if (status === 2) {
        // Authenticate - server needs more auth data
        reader.releaseLock();
        writer.releaseLock();
        socket.close();

        return new Response(JSON.stringify({
          success: true,
          host,
          port,
          display,
          connectTime,
          rtt,
          status: 'authenticate',
          message: 'Server requires additional authentication',
        }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      } else {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();

        return new Response(JSON.stringify({
          success: false,
          error: `Unexpected status byte: ${status}`,
        }), {
          status: 502, headers: { 'Content-Type': 'application/json' },
        });
      }
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
