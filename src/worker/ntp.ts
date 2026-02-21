/**
 * NTP Protocol Implementation (RFC 5905)
 *
 * Network Time Protocol for time synchronization across networks.
 * Provides high-precision time with accuracy metrics.
 *
 * Protocol Overview:
 * - Port 123 (UDP standard, TCP supported)
 * - 48-byte minimum packet size
 * - 64-bit timestamps (seconds since 1900-01-01)
 * - Stratum levels (distance from reference clock)
 *
 * NTP Timestamp Format:
 * - 32 bits: seconds since 1900-01-01 00:00:00 UTC
 * - 32 bits: fractional seconds (1/2^32 resolution)
 * - Range: 1900 to 2036 (then rolls over)
 *
 * Stratum Levels:
 * - 0: Unspecified/invalid
 * - 1: Primary reference (atomic clock, GPS)
 * - 2-15: Secondary reference (synced from stratum N-1)
 * - 16: Unsynchronized
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// NTP Constants
const NTP_EPOCH_OFFSET = 2208988800; // Seconds between 1900 and 1970
const NTP_PACKET_SIZE = 48;

// Leap Indicator values (for reference)
// const LEAP_INDICATOR = {
//   NO_WARNING: 0,
//   LAST_MINUTE_61: 1,
//   LAST_MINUTE_59: 2,
//   ALARM: 3,
// } as const;

// NTP Mode values
const NTP_MODE = {
  RESERVED: 0,
  SYMMETRIC_ACTIVE: 1,
  SYMMETRIC_PASSIVE: 2,
  CLIENT: 3,
  SERVER: 4,
  BROADCAST: 5,
  NTP_CONTROL: 6,
  PRIVATE: 7,
} as const;

interface NTPRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface NTPResponse {
  success: boolean;
  time?: string; // ISO 8601 timestamp
  offset?: number; // Clock offset in milliseconds
  delay?: number; // Round-trip delay in milliseconds
  stratum?: number; // Distance from reference clock
  precision?: number; // Clock precision (log2 seconds)
  referenceId?: string; // Reference clock identifier
  rootDelay?: number; // Total delay to primary source
  rootDispersion?: number; // Total dispersion to primary source
  leapIndicator?: string;
  error?: string;
}

/**
 * Create an NTP client request packet
 */
function createNTPRequest(): Uint8Array {
  const packet = new Uint8Array(NTP_PACKET_SIZE);

  // Byte 0: LI (2 bits) + Version (3 bits) + Mode (3 bits)
  // LI = 0 (no warning), Version = 4, Mode = 3 (client)
  packet[0] = (0 << 6) | (4 << 3) | 3;

  // Stratum (1 byte): 0 = unspecified
  packet[1] = 0;

  // Poll interval (1 byte): 6 = 64 seconds (2^6)
  packet[2] = 6;

  // Precision (1 byte): -6 = ~15ms (2^-6)
  packet[3] = 0xfa; // -6 in two's complement

  // Root delay (4 bytes): 0
  packet.fill(0, 4, 8);

  // Root dispersion (4 bytes): 0
  packet.fill(0, 8, 12);

  // Reference identifier (4 bytes): 0
  packet.fill(0, 12, 16);

  // Reference timestamp (8 bytes): 0
  packet.fill(0, 16, 24);

  // Origin timestamp (8 bytes): 0
  packet.fill(0, 24, 32);

  // Receive timestamp (8 bytes): 0
  packet.fill(0, 32, 40);

  // Transmit timestamp (8 bytes): current time
  const now = Date.now();
  const ntpTime = (now / 1000) + NTP_EPOCH_OFFSET;
  const ntpSeconds = Math.floor(ntpTime);
  const ntpFraction = Math.floor((ntpTime % 1) * 0x100000000);

  // Write transmit timestamp (big-endian)
  packet[40] = (ntpSeconds >>> 24) & 0xff;
  packet[41] = (ntpSeconds >>> 16) & 0xff;
  packet[42] = (ntpSeconds >>> 8) & 0xff;
  packet[43] = ntpSeconds & 0xff;

  packet[44] = (ntpFraction >>> 24) & 0xff;
  packet[45] = (ntpFraction >>> 16) & 0xff;
  packet[46] = (ntpFraction >>> 8) & 0xff;
  packet[47] = ntpFraction & 0xff;

  return packet;
}

/**
 * Read a 32-bit unsigned integer from buffer (big-endian)
 */
function readUInt32BE(buffer: Uint8Array, offset: number): number {
  return (
    (buffer[offset] << 24) |
    (buffer[offset + 1] << 16) |
    (buffer[offset + 2] << 8) |
    buffer[offset + 3]
  ) >>> 0; // Force unsigned
}

/**
 * Read a 64-bit NTP timestamp and convert to Unix timestamp (milliseconds)
 */
function readNTPTimestamp(buffer: Uint8Array, offset: number): number {
  const seconds = readUInt32BE(buffer, offset);
  const fraction = readUInt32BE(buffer, offset + 4);

  // Convert NTP timestamp to Unix timestamp
  const unixSeconds = seconds - NTP_EPOCH_OFFSET;
  const milliseconds = Math.floor((fraction / 0x100000000) * 1000);

  return unixSeconds * 1000 + milliseconds;
}

/**
 * Read a 32-bit signed fixed-point number (16.16 format)
 */
function readFixedPoint(buffer: Uint8Array, offset: number): number {
  const value = readUInt32BE(buffer, offset);
  // Convert from 16.16 fixed point to floating point (seconds)
  return value / 65536;
}

/**
 * Parse NTP response packet
 */
function parseNTPResponse(buffer: Uint8Array, t1: number, t4: number): Omit<NTPResponse, 'success'> {
  if (buffer.length < NTP_PACKET_SIZE) {
    throw new Error('Invalid NTP packet: too short');
  }

  // Byte 0: LI (2 bits) + Version (3 bits) + Mode (3 bits)
  const byte0 = buffer[0];
  const leapIndicator = (byte0 >>> 6) & 0x3;
  // const _version = (byte0 >>> 3) & 0x7;
  const mode = byte0 & 0x7;

  // Verify this is a server response
  if (mode !== NTP_MODE.SERVER) {
    throw new Error(`Invalid NTP mode: expected ${NTP_MODE.SERVER}, got ${mode}`);
  }

  // Stratum
  const stratum = buffer[1];

  // Poll interval (log2 seconds)
  // const _poll = buffer[2];

  // Precision (log2 seconds, signed)
  const precision = buffer[3] > 127 ? buffer[3] - 256 : buffer[3];

  // Root delay (16.16 fixed point, seconds)
  const rootDelay = readFixedPoint(buffer, 4) * 1000; // Convert to ms

  // Root dispersion (16.16 fixed point, seconds)
  const rootDispersion = readFixedPoint(buffer, 8) * 1000; // Convert to ms

  // Reference identifier (4 bytes)
  let referenceId: string;
  if (stratum === 0 || stratum === 1) {
    // ASCII identifier (e.g., "GPS", "ATOM")
    referenceId = String.fromCharCode(buffer[12], buffer[13], buffer[14], buffer[15]).replace(/\0/g, '');
  } else {
    // IPv4 address for stratum 2+
    referenceId = `${buffer[12]}.${buffer[13]}.${buffer[14]}.${buffer[15]}`;
  }

  // Timestamps
  // const _referenceTimestamp = readNTPTimestamp(buffer, 16);
  // const _originTimestamp = readNTPTimestamp(buffer, 24); // t1 (our original transmit time)
  const receiveTimestamp = readNTPTimestamp(buffer, 32); // t2 (server receive time)
  const transmitTimestamp = readNTPTimestamp(buffer, 40); // t3 (server transmit time)

  // t1 = client transmit timestamp (from our request)
  // t2 = server receive timestamp (from response)
  // t3 = server transmit timestamp (from response)
  // t4 = client receive timestamp (current time)

  const t2 = receiveTimestamp;
  const t3 = transmitTimestamp;

  // Calculate offset and delay
  // offset = ((t2 - t1) + (t3 - t4)) / 2
  // delay = (t4 - t1) - (t3 - t2)
  const offset = ((t2 - t1) + (t3 - t4)) / 2;
  const delay = (t4 - t1) - (t3 - t2);

  // Server time adjusted by offset
  const serverTime = t4 + offset;

  // Leap indicator string
  const leapIndicatorStr = ['no warning', '61 seconds', '59 seconds', 'alarm (clock unsynchronized)'][leapIndicator];

  return {
    time: new Date(serverTime).toISOString(),
    offset: Math.round(offset),
    delay: Math.round(delay),
    stratum,
    precision,
    referenceId,
    rootDelay: Math.round(rootDelay * 100) / 100, // Round to 2 decimals
    rootDispersion: Math.round(rootDispersion * 100) / 100,
    leapIndicator: leapIndicatorStr,
  };
}

/**
 * Handle NTP query request
 */
export async function handleNTPQuery(request: Request): Promise<Response> {
  try {
    const body = await request.json() as NTPRequest;
    const {
      host,
      port = 123,
      timeout = 10000,
    } = body;

    // Validation
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

    // Check if behind Cloudflare
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

    // Create NTP request packet
    const requestPacket = createNTPRequest();

    // Record client transmit time (t1)
    const t1 = Date.now();

    // Connect to NTP server
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send NTP request
      await writer.write(requestPacket);

      // Read NTP response
      const { value: responseData } = await Promise.race([
        reader.read(),
        timeoutPromise,
      ]);

      if (!responseData) {
        throw new Error('No response from NTP server');
      }

      // Record client receive time (t4)
      const t4 = Date.now();

      // Parse NTP response
      const result = parseNTPResponse(responseData, t1, t4);

      // Cleanup
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: true,
        ...result,
      }), {
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
 * Handle NTP sync request (alias for query, returns additional sync info)
 */
export async function handleNTPSync(request: Request): Promise<Response> {
  // For now, this is identical to handleNTPQuery
  // In the future, could add multiple server queries for better accuracy
  return handleNTPQuery(request);
}

/**
 * Handle NTP poll — send multiple requests and compute statistics
 * POST /api/ntp/poll
 * Body: { host, port?, count?, intervalMs?, timeout? }
 *
 * Returns min/max/avg offset, jitter (std dev of offsets), and all samples
 */
export async function handleNTPPoll(request: Request): Promise<Response> {
  try {
    const body = await request.json() as NTPRequest & { count?: number; intervalMs?: number };
    const { host, port = 123, timeout = 10000 } = body;
    const count = Math.min(Math.max(body.count ?? 4, 1), 10);
    const intervalMs = Math.min(Math.max(body.intervalMs ?? 1000, 100), 5000);

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const samples: Array<{ offset: number; rtt: number; stratum: number; timestamp: string }> = [];
    const errors: string[] = [];

    for (let i = 0; i < count; i++) {
      if (i > 0) {
        await new Promise(r => setTimeout(r, intervalMs));
      }

      try {
        const requestPacket = createNTPRequest();
        const t1 = Date.now();
        const socket = connect(`${host}:${port}`);
        const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout));

        await Promise.race([socket.opened, timeoutPromise]);
        const writer = socket.writable.getWriter();
        const reader = socket.readable.getReader();

        await writer.write(requestPacket);

        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        const deadline = Date.now() + Math.min(timeout, 5000);

        while (totalBytes < NTP_PACKET_SIZE) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) break;
          const t = new Promise<{ done: true; value: undefined }>(r => setTimeout(() => r({ done: true, value: undefined }), remaining));
          const result = await Promise.race([reader.read(), t]);
          if (result.done || !result.value) break;
          chunks.push(result.value);
          totalBytes += result.value.length;
        }

        const t4 = Date.now();
        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        if (totalBytes >= NTP_PACKET_SIZE) {
          const combined = new Uint8Array(totalBytes);
          let off = 0;
          for (const c of chunks) { combined.set(c, off); off += c.length; }
          const parsed = parseNTPResponse(combined, t1, t4);
          samples.push({
            offset: parsed.offset ?? 0,
            rtt: parsed.delay ?? 0,
            stratum: parsed.stratum ?? 0,
            timestamp: new Date().toISOString(),
          });
        } else {
          errors.push(`Sample ${i + 1}: insufficient data (${totalBytes} bytes)`);
        }
      } catch (err) {
        errors.push(`Sample ${i + 1}: ${err instanceof Error ? err.message : 'error'}`);
      }
    }

    if (samples.length === 0) {
      return new Response(JSON.stringify({ success: false, host, port, errors, error: 'All samples failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const offsets = samples.map(s => s.offset);
    const rtts = samples.map(s => s.rtt);
    const avgOffset = offsets.reduce((a, b) => a + b, 0) / offsets.length;
    const variance = offsets.reduce((a, b) => a + (b - avgOffset) ** 2, 0) / offsets.length;
    const jitter = Math.sqrt(variance);

    return new Response(JSON.stringify({
      success: true,
      host, port,
      count: samples.length,
      requested: count,
      intervalMs,
      offsetMs: {
        min: Math.min(...offsets),
        max: Math.max(...offsets),
        avg: avgOffset,
        jitter,
      },
      rttMs: {
        min: Math.min(...rtts),
        max: Math.max(...rtts),
        avg: rtts.reduce((a, b) => a + b, 0) / rtts.length,
      },
      samples,
      errors: errors.length > 0 ? errors : undefined,
      message: `${samples.length}/${count} samples: avg offset ${avgOffset.toFixed(2)}ms, jitter ${jitter.toFixed(2)}ms`,
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'NTP poll failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
