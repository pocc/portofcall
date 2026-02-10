/**
 * CHARGEN Protocol Implementation (RFC 864)
 *
 * Character Generator Protocol - sends continuous stream of ASCII characters.
 *
 * Protocol Flow:
 * 1. Client connects to server port 19
 * 2. Server immediately starts sending continuous character stream
 * 3. Standard pattern: 72-character rotating lines of printable ASCII
 * 4. Stream continues until client disconnects
 *
 * Use Cases:
 * - Network bandwidth testing
 * - Buffer overflow testing
 * - Educational protocol demonstration
 * - TCP streaming demonstration
 *
 * Security Warning:
 * - No authentication or encryption
 * - Can be used for amplification attacks
 * - Most modern systems have CHARGEN disabled
 * - Educational use only
 */

import { connect } from 'cloudflare:sockets';

interface ChargenRequest {
  host: string;
  port?: number;
  maxBytes?: number;
  timeout?: number;
}

interface ChargenResponse {
  success: boolean;
  data?: string;
  bytes?: number;
  lines?: number;
  duration?: number;
  bandwidth?: string;
  error?: string;
}

/**
 * Calculate bandwidth from bytes and duration
 */
function calculateBandwidth(bytes: number, durationMs: number): string {
  const bps = (bytes * 8) / (durationMs / 1000);

  if (bps < 1024) {
    return `${bps.toFixed(2)} bps`;
  } else if (bps < 1024 * 1024) {
    return `${(bps / 1024).toFixed(2)} Kbps`;
  } else {
    return `${(bps / (1024 * 1024)).toFixed(2)} Mbps`;
  }
}

/**
 * Handle CHARGEN stream request
 */
export async function handleChargenStream(request: Request): Promise<Response> {
  try {
    const body = await request.json() as ChargenRequest;
    const { host, port = 19, maxBytes = 10240, timeout = 10000 } = body;

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

    // Enforce safety limit - max 1MB
    const safeMaxBytes = Math.min(maxBytes, 1048576);

    const startTime = Date.now();

    // Connect to CHARGEN server
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

      // Read character stream until maxBytes reached
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      try {
        while (totalBytes < safeMaxBytes) {
          const readPromise = reader.read();
          const { value, done } = await Promise.race([
            readPromise,
            timeoutPromise,
          ]);

          if (done) break;

          if (value) {
            chunks.push(value);
            totalBytes += value.length;

            // Stop if we've exceeded maxBytes
            if (totalBytes >= safeMaxBytes) {
              break;
            }
          }
        }
      } catch (error) {
        // Read error or timeout
        if (chunks.length === 0) {
          throw error;
        }
        // If we got some data, continue with what we have
      }

      // Combine chunks
      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      // Decode response
      const dataText = new TextDecoder().decode(combined);

      // Calculate statistics
      const duration = Date.now() - startTime;
      const lines = dataText.split('\r\n').filter(line => line.length > 0).length;
      const bandwidth = calculateBandwidth(totalBytes, duration);

      // Clean up
      reader.releaseLock();
      socket.close();

      const result: ChargenResponse = {
        success: true,
        data: dataText,
        bytes: totalBytes,
        lines,
        duration,
        bandwidth,
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
