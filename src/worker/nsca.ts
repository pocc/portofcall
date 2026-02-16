/**
 * Nagios NSCA (Service Check Acceptor) Protocol Implementation
 *
 * NSCA receives passive check results from Nagios clients. It listens on
 * port 5667 and uses a simple binary protocol with optional encryption.
 *
 * Protocol Flow:
 *   1. Client connects to NSCA server (port 5667)
 *   2. Server sends 132-byte initialization packet:
 *      - 128 bytes: random IV (initialization vector)
 *      - 4 bytes: Unix timestamp (network byte order)
 *   3. Client sends encrypted check result packet:
 *      - NSCAv2: 720 bytes (16 + 64 + 128 + 512)
 *      - NSCAv3: 4304 bytes (16 + 64 + 128 + 4096)
 *   4. Server processes and closes connection
 *
 * Check Result Packet Structure (v2, 720 bytes):
 *   - int16:  packet_version (3)
 *   - uint32: crc32 (0 during calculation, then filled in)
 *   - uint32: timestamp
 *   - int16:  return_code (0=OK, 1=WARNING, 2=CRITICAL, 3=UNKNOWN)
 *   - char[64]: host_name (null-terminated)
 *   - char[128]: service_description (null-terminated)
 *   - char[512]: plugin_output (null-terminated)
 *
 * Encryption Methods:
 *   0  = None (XOR with timestamp only)
 *   1  = Simple XOR
 *   2  = DES (deprecated)
 *   3  = 3DES
 *   14 = AES-256
 *   15 = AES-192
 *   16 = AES-128
 *
 * Use Cases:
 *   - Detect NSCA servers in monitoring infrastructure
 *   - Verify NSCA connectivity alongside NRPE (port 5666)
 *   - Submit passive check results to Nagios
 *   - Monitor monitoring infrastructure health
 */

import { connect } from 'cloudflare:sockets';

const NSCA_INIT_PACKET_SIZE = 132;
const NSCA_IV_SIZE = 128;
const NSCA_TIMESTAMP_SIZE = 4;

// NSCA v3 packet structure sizes
const NSCA_V3_PACKET_SIZE = 4304;
const HOST_NAME_SIZE = 64;
const SERVICE_DESC_SIZE = 128;
const PLUGIN_OUTPUT_V3_SIZE = 4096;

interface NSCAProbeRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface NSCASendRequest {
  host: string;
  port?: number;
  hostName: string;
  service: string;
  returnCode: number;
  output: string;
  encryption?: number;
  password?: string;
  timeout?: number;
}

interface NSCAProbeResponse {
  success: boolean;
  host?: string;
  port?: number;
  ivHex?: string;
  timestamp?: number;
  timestampDate?: string;
  rtt?: number;
  error?: string;
}

interface NSCASendResponse {
  success: boolean;
  host?: string;
  port?: number;
  hostName?: string;
  service?: string;
  returnCode?: number;
  encryption?: string;
  rtt?: number;
  error?: string;
}

/**
 * CRC32 lookup table (standard CRC-32/ISO-HDLC)
 */
const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      if (c & 1) {
        c = 0xEDB88320 ^ (c >>> 1);
      } else {
        c = c >>> 1;
      }
    }
    table[i] = c;
  }
  return table;
})();

/**
 * Compute CRC32 checksum
 */
function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * XOR encrypt/decrypt using IV and optional password
 * This implements NSCA's simple XOR encryption (method 1)
 */
function xorEncrypt(data: Uint8Array, iv: Uint8Array, password?: string): Uint8Array {
  const result = new Uint8Array(data.length);
  const pwBytes = password ? new TextEncoder().encode(password) : new Uint8Array(0);

  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ iv[i % iv.length];
    if (pwBytes.length > 0) {
      result[i] = result[i] ^ pwBytes[i % pwBytes.length];
    }
  }

  return result;
}

/**
 * Build an NSCA v3 check result packet
 */
function buildCheckPacket(
  hostName: string,
  service: string,
  returnCode: number,
  output: string,
  timestamp: number
): Uint8Array {
  const packet = new Uint8Array(NSCA_V3_PACKET_SIZE);
  const view = new DataView(packet.buffer);

  let offset = 0;

  // Packet version (int16) = 3
  view.setInt16(offset, 3);
  offset += 2;

  // Padding (2 bytes to align)
  offset += 2;

  // CRC32 placeholder (uint32) - will be filled in after
  const crcOffset = offset;
  view.setUint32(offset, 0);
  offset += 4;

  // Timestamp (uint32)
  view.setUint32(offset, timestamp);
  offset += 4;

  // Return code (int16)
  view.setInt16(offset, returnCode);
  offset += 2;

  // Host name (64 bytes, null-terminated)
  const hostBytes = new TextEncoder().encode(hostName.substring(0, HOST_NAME_SIZE - 1));
  packet.set(hostBytes, offset);
  offset += HOST_NAME_SIZE;

  // Service description (128 bytes, null-terminated)
  const serviceBytes = new TextEncoder().encode(service.substring(0, SERVICE_DESC_SIZE - 1));
  packet.set(serviceBytes, offset);
  offset += SERVICE_DESC_SIZE;

  // Plugin output (4096 bytes, null-terminated)
  const outputBytes = new TextEncoder().encode(output.substring(0, PLUGIN_OUTPUT_V3_SIZE - 1));
  packet.set(outputBytes, offset);

  // Calculate and set CRC32
  const checksum = crc32(packet);
  view.setUint32(crcOffset, checksum);

  return packet;
}

/**
 * PROBE - Detect NSCA server by reading the initialization packet
 * Connects and reads the 132-byte IV + timestamp response
 */
export async function handleNSCAProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as NSCAProbeRequest;
    const { host, port = 5667, timeout = 10000 } = body;

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

    const startTime = Date.now();

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const reader = socket.readable.getReader();

      // Read the 132-byte initialization packet
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      while (totalBytes < NSCA_INIT_PACKET_SIZE) {
        const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
        if (done || !value) break;
        chunks.push(value);
        totalBytes += value.length;
      }

      const rtt = Date.now() - startTime;

      reader.releaseLock();
      socket.close();

      if (totalBytes < NSCA_INIT_PACKET_SIZE) {
        return new Response(JSON.stringify({
          success: false,
          error: `Incomplete init packet: received ${totalBytes} of ${NSCA_INIT_PACKET_SIZE} bytes`,
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Combine chunks
      const initPacket = new Uint8Array(NSCA_INIT_PACKET_SIZE);
      let offset = 0;
      for (const chunk of chunks) {
        const toCopy = Math.min(chunk.length, NSCA_INIT_PACKET_SIZE - offset);
        initPacket.set(chunk.subarray(0, toCopy), offset);
        offset += toCopy;
      }

      // Parse: first 128 bytes = IV, last 4 bytes = timestamp
      const iv = initPacket.subarray(0, NSCA_IV_SIZE);
      const timestampView = new DataView(initPacket.buffer, NSCA_IV_SIZE, NSCA_TIMESTAMP_SIZE);
      const timestamp = timestampView.getUint32(0);

      // Convert IV to hex (first 32 bytes for display)
      const ivHex = Array.from(iv.subarray(0, 32))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('') + '...';

      const result: NSCAProbeResponse = {
        success: true,
        host,
        port,
        ivHex,
        timestamp,
        timestampDate: new Date(timestamp * 1000).toISOString(),
        rtt,
      };

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      socket.close();
      throw error;
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
 * SEND - Submit a passive check result to NSCA
 * Reads init packet, builds check result, encrypts, and sends
 */
export async function handleNSCASend(request: Request): Promise<Response> {
  try {
    const body = await request.json() as NSCASendRequest;
    const {
      host,
      port = 5667,
      hostName,
      service,
      returnCode,
      output,
      encryption = 1,
      password,
      timeout = 15000,
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

    if (!hostName) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host name (Nagios host) is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (service === undefined || service === null) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Service description is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (returnCode === undefined || returnCode < 0 || returnCode > 3) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Return code must be 0 (OK), 1 (WARNING), 2 (CRITICAL), or 3 (UNKNOWN)',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!output) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Plugin output is required',
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

    // Only support no encryption (0) and XOR (1) for now
    if (encryption !== 0 && encryption !== 1) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Only encryption methods 0 (none) and 1 (XOR) are supported',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      // Read the 132-byte initialization packet
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      while (totalBytes < NSCA_INIT_PACKET_SIZE) {
        const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
        if (done || !value) break;
        chunks.push(value);
        totalBytes += value.length;
      }

      if (totalBytes < NSCA_INIT_PACKET_SIZE) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          error: `Incomplete init packet: received ${totalBytes} of ${NSCA_INIT_PACKET_SIZE} bytes`,
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Combine chunks into init packet
      const initPacket = new Uint8Array(NSCA_INIT_PACKET_SIZE);
      let offset = 0;
      for (const chunk of chunks) {
        const toCopy = Math.min(chunk.length, NSCA_INIT_PACKET_SIZE - offset);
        initPacket.set(chunk.subarray(0, toCopy), offset);
        offset += toCopy;
      }

      // Parse IV and timestamp
      const iv = initPacket.subarray(0, NSCA_IV_SIZE);
      const timestampView = new DataView(initPacket.buffer, NSCA_IV_SIZE, NSCA_TIMESTAMP_SIZE);
      const timestamp = timestampView.getUint32(0);

      // Build check result packet
      let packet = buildCheckPacket(hostName, service, returnCode, output, timestamp);

      // Encrypt if needed
      const encryptionNames: Record<number, string> = { 0: 'None', 1: 'XOR' };
      if (encryption === 1) {
        packet = xorEncrypt(packet, iv, password);
      }

      // Send the encrypted packet
      await writer.write(packet);

      const rtt = Date.now() - startTime;

      reader.releaseLock();
      writer.releaseLock();
      socket.close();

      const result: NSCASendResponse = {
        success: true,
        host,
        port,
        hostName,
        service,
        returnCode,
        encryption: encryptionNames[encryption] || `Method ${encryption}`,
        rtt,
      };

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      socket.close();
      throw error;
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
