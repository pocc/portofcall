/**
 * Daytime Protocol Implementation (RFC 867)
 *
 * The Daytime protocol provides human-readable time from a remote server.
 * It's the simplest possible network protocol.
 *
 * Protocol Flow:
 * 1. Client connects to server port 13
 * 2. Server immediately sends current date/time as ASCII text
 * 3. Server closes connection
 * 4. No commands needed!
 *
 * Use Cases:
 * - Educational protocol demonstration
 * - Simple time synchronization
 * - Network connectivity testing
 * - Legacy system integration
 */

import { connect } from 'cloudflare:sockets';

interface DaytimeRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface DaytimeResponse {
  success: boolean;
  host: string;
  port: number;
  time?: string;
  localTime?: string;
  remoteTimestamp?: number;
  localTimestamp?: number;
  offsetMs?: number;
  rtt?: number;
  error?: string;
}

/**
 * Get time from Daytime server
 * Server sends time immediately upon connection - no request needed
 */
export async function handleDaytimeGet(request: Request): Promise<Response> {
  try {
    const body = await request.json() as DaytimeRequest;
    const { host, port = 13, timeout = 10000 } = body;

    // Validation
    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies DaytimeResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        error: 'Port must be between 1 and 65535',
      } satisfies DaytimeResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Record local time before connection
    const localTimeBefore = Date.now();

    // Connect to Daytime server
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

      // RFC 867: Server sends time immediately and closes connection.
      // Read all chunks until the server closes or we hit the size limit.
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const maxResponseSize = 1000; // Daytime responses are typically < 100 bytes

      try {
        while (true) {
          const { value, done } = await Promise.race([
            reader.read(),
            timeoutPromise,
          ]);

          if (done) break;

          if (value) {
            chunks.push(value);
            totalBytes += value.length;

            if (totalBytes > maxResponseSize) {
              break;
            }
          }
        }
      } catch {
        // Connection closed by server (expected behavior for Daytime)
        if (chunks.length === 0) {
          throw new Error('Server closed connection without sending time');
        }
      }

      // Combine chunks
      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      // Decode time string
      const timeString = new TextDecoder().decode(combined).trim();

      if (!timeString) {
        throw new Error('Empty response from server');
      }

      // Clean up
      reader.releaseLock();
      socket.close();

      // Record local time after receiving response
      const localTimeAfter = Date.now();
      const localTime = new Date(localTimeAfter).toISOString();

      // Try to parse remote time
      let remoteTimestamp: number | undefined;
      let offsetMs: number | undefined;

      try {
        const remoteDate = new Date(timeString);
        if (!isNaN(remoteDate.getTime())) {
          remoteTimestamp = remoteDate.getTime();
          // Calculate offset (accounting for network delay)
          const networkDelay = (localTimeAfter - localTimeBefore) / 2;
          offsetMs = remoteTimestamp - (localTimeBefore + networkDelay);
        }
      } catch {
        // Can't parse as standard date - server may use custom format
        // This is OK, just won't calculate offset
      }

      const rtt = localTimeAfter - localTimeBefore;

      const result: DaytimeResponse = {
        success: true,
        host,
        port,
        time: timeString,
        localTime,
        remoteTimestamp,
        localTimestamp: localTimeAfter,
        offsetMs,
        rtt,
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
      host: '',
      port: 13,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies DaytimeResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
