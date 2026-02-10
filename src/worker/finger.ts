/**
 * Finger Protocol Implementation (RFC 1288)
 *
 * Finger is a legacy protocol for user information lookup.
 * While rarely used today, it demonstrates simple TCP query/response protocols.
 *
 * Protocol Flow:
 * 1. Client connects to server port 79
 * 2. Client sends query: "[username][@hostname]\r\n"
 * 3. Server responds with user information as plain text
 * 4. Server closes connection
 *
 * Use Cases:
 * - Educational protocol demonstration
 * - Retro computing
 * - Legacy system integration
 * - Internet archaeology
 */

import { connect } from 'cloudflare:sockets';

interface FingerRequest {
  host: string;
  port?: number;
  username?: string;
  remoteHost?: string;
  timeout?: number;
}

interface FingerResponse {
  success: boolean;
  query?: string;
  response?: string;
  error?: string;
}

/**
 * Validate Finger query inputs
 */
function validateFingerQuery(username?: string, remoteHost?: string): string | null {
  // Username should only contain alphanumeric, underscore, hyphen, dot
  if (username && !/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return 'Username contains invalid characters';
  }

  // Remote host should be a valid hostname pattern
  if (remoteHost && !/^[a-zA-Z0-9.-]+$/.test(remoteHost)) {
    return 'Remote host contains invalid characters';
  }

  return null;
}

/**
 * Perform Finger query
 */
export async function handleFingerQuery(request: Request): Promise<Response> {
  try {
    const body = await request.json() as FingerRequest;
    const { host, port = 79, username, remoteHost, timeout = 10000 } = body;

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

    // Validate query inputs
    const validationError = validateFingerQuery(username, remoteHost);
    if (validationError) {
      return new Response(JSON.stringify({
        success: false,
        error: validationError,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Build Finger query
    // Format: [username][@remote_host]\r\n
    let queryString = '';
    if (username) {
      queryString += username;
    }
    if (remoteHost) {
      queryString += `@${remoteHost}`;
    }
    queryString += '\r\n';

    // Connect to Finger server
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

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send query
      const queryBytes = new TextEncoder().encode(queryString);
      await writer.write(queryBytes);
      writer.releaseLock();

      // Read response (server may send multiple chunks)
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const maxResponseSize = 100000; // 100KB limit for safety

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

            // Prevent excessive data
            if (totalBytes > maxResponseSize) {
              throw new Error('Response too large (max 100KB)');
            }
          }
        }
      } catch (error) {
        // Connection closed by server (expected behavior)
        if (chunks.length === 0 && error instanceof Error && error.message !== 'Connection timeout') {
          // Server closed without sending data - this might be normal for some queries
        } else if (error instanceof Error && error.message === 'Connection timeout') {
          throw error;
        }
      }

      // Combine chunks
      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      // Decode response
      const responseText = new TextDecoder().decode(combined).trim();

      // Clean up
      reader.releaseLock();
      socket.close();

      const result: FingerResponse = {
        success: true,
        query: queryString.trim(),
        response: responseText || '(No response from server)',
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
