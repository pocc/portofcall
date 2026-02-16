/**
 * Ventrilo Protocol Implementation
 *
 * Ventrilo is a proprietary VoIP software for gaming voice chat.
 * It uses TCP for control/status and UDP for voice transmission.
 * This implementation focuses on the TCP control protocol for
 * server status queries and connection testing.
 *
 * Protocol Flow:
 * 1. Client connects to server on port 3784 (TCP)
 * 2. Client sends status request packet
 * 3. Server responds with server information
 * 4. Connection can remain open for authentication/sessions
 *
 * Packet Format (Simplified):
 * - Different versions (v2.1, v2.2, v2.3, v3.0) have different formats
 * - Status request is typically a small packet
 * - Response contains server name, version, user count, etc.
 *
 * Note: Ventrilo protocol is proprietary and not publicly documented.
 * This implementation is based on reverse engineering and community knowledge.
 *
 * Status Query Packet (v3.0):
 * - Simple UDP or TCP query packet
 * - Server responds with status information
 *
 * Use Cases:
 * - Gaming clan server monitoring
 * - Ventrilo server browser
 * - Server status dashboards
 * - Retro gaming communities
 */

import { connect } from 'cloudflare:sockets';

interface VentriloRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface VentriloResponse {
  success: boolean;
  host: string;
  port: number;
  serverName?: string;
  version?: string;
  platform?: string;
  users?: number;
  maxUsers?: number;
  channels?: number;
  uptime?: number;
  error?: string;
  rtt?: number;
  rawResponse?: string;
}

/**
 * Encode Ventrilo status request (v3.0 format).
 * This is a simplified request that works with many Ventrilo servers.
 */
function encodeVentriloStatusRequest(): Uint8Array {
  // Ventrilo status request (simple version)
  // This varies by server version, but a common approach
  // is to send a short packet that triggers a status response

  // Simple status query packet structure:
  // Some servers respond to a simple connection with status
  // Others require specific packet formats

  // V3 status request (simplified - actual format is proprietary)
  const packet = new Uint8Array([
    0x01, 0x00, // Request type
    0x00, 0x00, // Flags
  ]);

  return packet;
}

/**
 * Parse Ventrilo status response.
 * Note: Response format varies by version and is not publicly documented.
 */
function parseVentriloStatus(data: Uint8Array): {
  serverName?: string;
  version?: string;
  platform?: string;
  users?: number;
  maxUsers?: number;
  channels?: number;
} | null {
  try {
    // Ventrilo responses are complex and version-dependent
    // This is a best-effort parser for common response patterns

    const text = new TextDecoder().decode(data);

    // Try to extract readable strings
    const result: {
      serverName?: string;
      version?: string;
      platform?: string;
      users?: number;
      maxUsers?: number;
      channels?: number;
    } = {};

    // Look for null-terminated strings
    const strings: string[] = [];
    let currentString = '';
    for (const byte of data) {
      if (byte === 0) {
        if (currentString.length > 0) {
          strings.push(currentString);
          currentString = '';
        }
      } else if (byte >= 32 && byte <= 126) {
        currentString += String.fromCharCode(byte);
      } else {
        if (currentString.length > 0) {
          strings.push(currentString);
          currentString = '';
        }
      }
    }
    if (currentString.length > 0) {
      strings.push(currentString);
    }

    // First readable string is often the server name
    if (strings.length > 0) {
      result.serverName = strings[0];
    }

    // Look for version patterns
    const versionMatch = text.match(/v?(\d+\.\d+(\.\d+)?)/i);
    if (versionMatch) {
      result.version = versionMatch[1];
    }

    // Try to extract user count (often in response)
    // Format varies, but might be in the data
    if (data.length >= 8) {
      // Some servers send user count as 16-bit integers
      const possibleUsers = data[4] | (data[5] << 8);
      const possibleMaxUsers = data[6] | (data[7] << 8);

      if (possibleUsers <= 999 && possibleMaxUsers <= 999) {
        result.users = possibleUsers;
        result.maxUsers = possibleMaxUsers;
      }
    }

    return result;
  } catch {
    return null;
  }
}

/**
 * Test Ventrilo server connectivity.
 */
export async function handleVentriloConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as VentriloRequest;
    const {
      host,
      port = 3784,
      timeout = 15000,
    } = body;

    // Validation
    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies VentriloResponse), {
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
      } satisfies VentriloResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    // Connect to Ventrilo server
    const socket = connect(`${host}:${port}`, {
      secureTransport: 'off',
      allowHalfOpen: false,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const rtt = Date.now() - start;

      socket.close();

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        rtt,
      } satisfies VentriloResponse), {
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
      port: 3784,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies VentriloResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Query Ventrilo server status.
 */
export async function handleVentriloStatus(request: Request): Promise<Response> {
  try {
    const body = await request.json() as VentriloRequest;
    const {
      host,
      port = 3784,
      timeout = 15000,
    } = body;

    // Validation
    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies VentriloResponse), {
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
      } satisfies VentriloResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    // Connect to Ventrilo server
    const socket = connect(`${host}:${port}`, {
      secureTransport: 'off',
      allowHalfOpen: false,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send status request
      const statusRequest = encodeVentriloStatusRequest();
      await writer.write(statusRequest);
      writer.releaseLock();

      // Read response
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const maxResponseSize = 4096;

      const readTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Response timeout')), timeout);
      });

      try {
        // Give server time to respond
        await new Promise((resolve) => setTimeout(resolve, 500));

        while (true) {
          const { value, done } = await Promise.race([
            reader.read(),
            readTimeout,
          ]);

          if (done) break;

          if (value) {
            chunks.push(value);
            totalBytes += value.length;

            if (totalBytes > maxResponseSize) {
              break;
            }

            // Give server a moment to send all data
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Check if more data is coming
            const peek = await Promise.race([
              reader.read(),
              new Promise<{ value?: Uint8Array; done: boolean }>((resolve) =>
                setTimeout(() => resolve({ done: false }), 200)
              ),
            ]);

            if (peek.value) {
              chunks.push(peek.value);
              totalBytes += peek.value.length;
            }

            if (peek.done || !peek.value) {
              break;
            }
          }
        }
      } catch (error) {
        // Socket might close after response
        if (chunks.length === 0) {
          throw error;
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

      reader.releaseLock();
      socket.close();

      if (combined.length === 0) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Empty response from server (server may not support TCP status queries)',
        } satisfies VentriloResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Parse status response
      const status = parseVentriloStatus(combined);

      // Raw response for debugging
      const rawResponse = Array.from(combined.slice(0, Math.min(100, combined.length)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ');

      if (!status || Object.keys(status).length === 0) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Could not parse server response (unsupported version or format)',
          rawResponse,
          rtt,
        } satisfies VentriloResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        serverName: status.serverName,
        version: status.version,
        platform: status.platform,
        users: status.users,
        maxUsers: status.maxUsers,
        channels: status.channels,
        rawResponse,
        rtt,
      } satisfies VentriloResponse), {
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
      port: 3784,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies VentriloResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
