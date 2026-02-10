/**
 * Time Protocol Implementation (RFC 868)
 *
 * The Time protocol provides binary time synchronization.
 * Server sends a 32-bit timestamp representing seconds since 1900-01-01.
 *
 * Protocol Flow:
 * 1. Client connects to server port 37
 * 2. Server immediately sends 4-byte time value (big-endian)
 * 3. Server closes connection
 * 4. No commands needed!
 *
 * Use Cases:
 * - Simple time synchronization
 * - Network connectivity testing
 * - Educational protocol demonstration
 * - Legacy system integration
 */

import { connect } from 'cloudflare:sockets';

interface TimeRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface TimeResponse {
  success: boolean;
  raw?: number;
  unixTimestamp?: number;
  date?: string;
  localTime?: string;
  localTimestamp?: number;
  offsetMs?: number;
  error?: string;
}

// Time protocol epoch offset (seconds from 1900-01-01 to 1970-01-01)
const TIME_EPOCH_OFFSET = 2208988800;

/**
 * Get time from Time protocol server
 * Server sends 4 bytes immediately upon connection - no request needed
 */
export async function handleTimeGet(request: Request): Promise<Response> {
  try {
    const body = await request.json() as TimeRequest;
    const { host, port = 37, timeout = 10000 } = body;

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

    // Record local time before connection
    const localTimeBefore = Date.now();

    // Connect to Time server
    const socket = connect(`${host}:${port}`);

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      // Wait for connection with timeout
      await Promise.race([
        socket.opened,
        timeoutPromise,
      ]);

      const reader = socket.readable.getReader();

      // Server sends 4 bytes immediately - just read them
      const { value: responseBytes } = await Promise.race([
        reader.read(),
        timeoutPromise,
      ]);

      if (!responseBytes || responseBytes.length < 4) {
        throw new Error('Invalid response: expected 4 bytes');
      }

      // Parse 32-bit big-endian unsigned integer
      // Using DataView to ensure correct endianness
      const dataView = new DataView(responseBytes.buffer, responseBytes.byteOffset, responseBytes.byteLength);
      const raw = dataView.getUint32(0, false); // false = big-endian (network byte order)

      // Convert to Unix timestamp (subtract 70 years in seconds)
      const unixTimestamp = raw - TIME_EPOCH_OFFSET;

      // Convert to JavaScript Date
      const remoteDate = new Date(unixTimestamp * 1000);

      // Clean up
      reader.releaseLock();
      socket.close();

      // Record local time after receiving response
      const localTimeAfter = Date.now();
      const localTime = new Date(localTimeAfter).toISOString();

      // Calculate offset (accounting for network delay)
      const networkDelay = (localTimeAfter - localTimeBefore) / 2;
      const remoteTimestamp = unixTimestamp * 1000; // Convert to milliseconds
      const offsetMs = remoteTimestamp - (localTimeBefore + networkDelay);

      const result: TimeResponse = {
        success: true,
        raw,
        unixTimestamp,
        date: remoteDate.toISOString(),
        localTime,
        localTimestamp: localTimeAfter,
        offsetMs,
      };

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      // Connection or read error
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
