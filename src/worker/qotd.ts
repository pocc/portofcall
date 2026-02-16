/**
 * QOTD Protocol Implementation (RFC 865)
 *
 * Quote of the Day is one of the original "simple service" protocols.
 * The server sends a short quote immediately upon TCP connection,
 * then closes the connection. No request is needed.
 *
 * Protocol Flow:
 * 1. Client connects to QOTD server port 17
 * 2. Server immediately sends a quote as ASCII text
 * 3. Server closes connection
 * 4. No commands needed!
 *
 * RFC 865 specifies:
 * - Quote should be limited to 512 characters
 * - One quote per connection
 * - Server may select quote at random
 *
 * This completes the set of classic "simple service" RFCs:
 * - Echo (RFC 862, port 7)
 * - Discard (RFC 863, port 9)
 * - Chargen (RFC 864, port 19)
 * - QOTD (RFC 865, port 17)   <-- this one
 * - Daytime (RFC 867, port 13)
 * - Time (RFC 868, port 37)
 *
 * Use Cases:
 * - Educational protocol demonstration
 * - Network connectivity testing
 * - Internet archaeology
 * - Random inspiration
 */

import { connect } from 'cloudflare:sockets';

interface QotdRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface QotdResponse {
  success: boolean;
  host: string;
  port: number;
  quote?: string;
  byteLength?: number;
  rtt?: number;
  error?: string;
}

/**
 * Fetch a Quote of the Day from a QOTD server.
 * Server sends the quote immediately upon connection - no request needed.
 */
export async function handleQotdFetch(request: Request): Promise<Response> {
  try {
    const body = await request.json() as QotdRequest;
    const { host, port = 17, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies QotdResponse), {
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
      } satisfies QotdResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const reader = socket.readable.getReader();

      // Server sends quote immediately - just read it
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const maxResponseSize = 2000; // RFC says 512 chars, but be generous

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
        // Connection closed by server (expected behavior for QOTD)
        if (chunks.length === 0) {
          throw new Error('Server closed connection without sending a quote');
        }
      }

      const rtt = Date.now() - start;

      // Combine chunks
      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      const quote = new TextDecoder().decode(combined).trim();

      reader.releaseLock();
      socket.close();

      if (!quote) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Empty response from server',
        } satisfies QotdResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        quote,
        byteLength: totalBytes,
        rtt,
      } satisfies QotdResponse), {
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
      host: '',
      port: 17,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies QotdResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
