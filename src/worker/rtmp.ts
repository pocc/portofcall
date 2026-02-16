/**
 * RTMP (Real-Time Messaging Protocol) Implementation
 *
 * Implements connectivity testing for RTMP servers by performing
 * the RTMP handshake (C0/C1/S0/S1/C2/S2).
 *
 * Protocol Flow:
 * 1. Client sends C0 (1 byte: version 0x03) + C1 (1536 bytes: timestamp + zero + random)
 * 2. Server sends S0 (1 byte: version) + S1 (1536 bytes) + S2 (1536 bytes: echo of C1)
 * 3. Client sends C2 (1536 bytes: echo of S1)
 *
 * C1/S1 Format (1536 bytes):
 *   time(4) + zero(4) + random_data(1528)
 *
 * C2/S2 Format (1536 bytes):
 *   time(4) + time2(4) + random_echo(1528)
 *
 * Use Cases:
 * - RTMP streaming server connectivity testing
 * - Protocol version detection
 * - Streaming infrastructure validation
 * - Live video platform testing (Twitch, YouTube Live, etc.)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const RTMP_VERSION = 0x03;
const HANDSHAKE_SIZE = 1536;

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
 * Handle RTMP connection test
 * Performs the RTMP handshake (C0/C1 + S0/S1/S2 + C2) and reports server info
 */
export async function handleRTMPConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 1935, timeout = 10000 } = body;

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
        // Build C0 + C1 (send together for efficiency)
        const c0c1 = new Uint8Array(1 + HANDSHAKE_SIZE);
        c0c1[0] = RTMP_VERSION; // C0: version

        // C1: timestamp(4) + zero(4) + random(1528)
        const c1View = new DataView(c0c1.buffer, 1);
        const clientTime = Date.now() & 0xFFFFFFFF;
        c1View.setUint32(0, clientTime, false); // timestamp (big-endian)
        c1View.setUint32(4, 0, false);          // zero

        // Fill random bytes for C1
        for (let i = 9; i < 1 + HANDSHAKE_SIZE; i++) {
          c0c1[i] = Math.floor(Math.random() * 256);
        }

        // Send C0 + C1
        await writer.write(c0c1);

        // Read S0 (1 byte: version)
        const s0 = await readExact(reader, 1);
        const serverVersion = s0[0];

        // Read S1 (1536 bytes)
        const s1 = await readExact(reader, HANDSHAKE_SIZE);
        const s1View = new DataView(s1.buffer);
        const serverTime = s1View.getUint32(0, false);

        // Read S2 (1536 bytes: echo of C1)
        const s2 = await readExact(reader, HANDSHAKE_SIZE);
        const s2View = new DataView(s2.buffer);
        const echoTime = s2View.getUint32(0, false);

        // Send C2 (echo of S1)
        const c2 = new Uint8Array(HANDSHAKE_SIZE);
        c2.set(s1.subarray(0, 4), 0);  // Copy S1 timestamp
        const c2View = new DataView(c2.buffer);
        c2View.setUint32(4, Date.now() & 0xFFFFFFFF, false); // Our timestamp
        c2.set(s1.subarray(8), 8);     // Echo S1 random data

        await writer.write(c2);

        const rtt = Date.now() - startTime;

        // Check if server echoed our C1 timestamp correctly
        const handshakeValid = echoTime === clientTime;

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return {
          success: true,
          host,
          port,
          connectTime,
          rtt,
          serverVersion,
          serverTime,
          handshakeValid,
          handshakeComplete: true,
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
