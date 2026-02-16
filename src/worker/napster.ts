/**
 * Napster Protocol Implementation (Historical/Educational)
 *
 * Napster was a pioneering peer-to-peer file sharing service that revolutionized
 * music distribution from 1999-2001. The original service was shut down due to
 * copyright lawsuits, but the protocol lives on in OpenNap servers.
 *
 * Protocol Flow:
 * 1. Client connects to Napster server on port 6699 (TCP)
 * 2. Client sends login command with username/password
 * 3. Server responds with login acknowledgment
 * 4. Client can search, browse users, query stats
 * 5. File transfers happen directly between clients (P2P)
 *
 * Protocol Format (Text-based):
 * - Commands are newline-terminated strings
 * - Format: COMMAND param1 param2 ... \n
 * - Responses vary by command
 *
 * Common Commands:
 * - LOGIN <user> <pass> <port> "<client>" <speed>
 * - SEARCH <query>
 * - GET_SERVER_STATS
 * - WHOIS <username>
 * - BROWSE <username>
 *
 * Historical Context:
 * - Launched June 1999 by Shawn Fanning
 * - Peaked at 80 million users
 * - Shut down July 2001 by court order
 * - Legacy: Inspired BitTorrent, Kazaa, Gnutella
 *
 * Modern Use Cases:
 * - Historical protocol research
 * - Educational demonstrations
 * - OpenNap server compatibility testing
 * - Legacy system maintenance
 *
 * Legal Note: This implementation is for educational purposes only.
 * Do not use for copyright infringement.
 */

import { connect } from 'cloudflare:sockets';

interface NapsterRequest {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  email?: string;
  timeout?: number;
}

interface NapsterResponse {
  success: boolean;
  host: string;
  port: number;
  message?: string;
  users?: number;
  files?: number;
  gigabytes?: number;
  serverVersion?: string;
  motd?: string;
  error?: string;
  rtt?: number;
}

/**
 * Encode Napster LOGIN command.
 */
function encodeLoginCommand(params: {
  username: string;
  password: string;
  email?: string;
}): string {
  const { username, password, email } = params;

  // LOGIN format: LOGIN <username> <password> <port> "<client-info>" <link-speed> [<email>]
  // Port is the client's listening port (0 if not sharing)
  // Client info is the client software name/version
  // Link speed: 0=Unknown, 1=14.4, 2=28.8, 3=33.6, 4=57.6, 5=64K ISDN, 6=128K ISDN, 7=Cable, 8=DSL, 9=T1, 10=T3+

  const port = 0; // Not sharing files (read-only client)
  const clientInfo = 'PortOfCall/1.0';
  const linkSpeed = 8; // DSL (typical modern connection)

  let command = `LOGIN ${username} ${password} ${port} "${clientInfo}" ${linkSpeed}`;

  if (email) {
    command += ` ${email}`;
  }

  return command + '\n';
}

/**
 * Encode Napster STATS command.
 */
function encodeStatsCommand(): string {
  // Some servers use GET_SERVER_STATS, others use STATS
  return 'GET_SERVER_STATS\n';
}

/**
 * Parse Napster server response.
 */
function parseNapsterResponse(data: string): {
  message?: string;
  users?: number;
  files?: number;
  gigabytes?: number;
  serverVersion?: string;
  motd?: string;
} {
  const result: {
    message?: string;
    users?: number;
    files?: number;
    gigabytes?: number;
    serverVersion?: string;
    motd?: string;
  } = {};

  // Napster responses vary, but typically include:
  // - Server version/MOTD
  // - User count
  // - File count
  // - Data size

  const lines = data.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Look for common response patterns
    if (trimmed.match(/users?[\s:]/i)) {
      const match = trimmed.match(/(\d+)\s*users?/i);
      if (match) {
        result.users = parseInt(match[1], 10);
      }
    }

    if (trimmed.match(/files?[\s:]/i)) {
      const match = trimmed.match(/(\d+)\s*files?/i);
      if (match) {
        result.files = parseInt(match[1], 10);
      }
    }

    if (trimmed.match(/GB|gigabytes?/i)) {
      const match = trimmed.match(/([\d.]+)\s*(GB|gigabytes?)/i);
      if (match) {
        result.gigabytes = parseFloat(match[1]);
      }
    }

    if (trimmed.match(/version/i)) {
      result.serverVersion = trimmed;
    }

    if (trimmed.match(/welcome|motd/i)) {
      result.motd = trimmed;
    }

    // Store first non-empty line as message
    if (!result.message && trimmed.length > 0) {
      result.message = trimmed;
    }
  }

  return result;
}

/**
 * Test Napster server connectivity.
 */
export async function handleNapsterConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as NapsterRequest;
    const {
      host,
      port = 6699,
      timeout = 15000,
    } = body;

    // Validation
    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies NapsterResponse), {
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
      } satisfies NapsterResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    // Connect to Napster server
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
        message: 'TCP connection established',
        rtt,
      } satisfies NapsterResponse), {
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
      port: 6699,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies NapsterResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Send Napster LOGIN command.
 */
export async function handleNapsterLogin(request: Request): Promise<Response> {
  try {
    const body = await request.json() as NapsterRequest;
    const {
      host,
      port = 6699,
      username,
      password,
      email,
      timeout = 15000,
    } = body;

    // Validation
    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies NapsterResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!username || !password) {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        error: 'Username and password are required',
      } satisfies NapsterResponse), {
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
      } satisfies NapsterResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    // Connect to Napster server
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

      // Send LOGIN command
      const loginCommand = encodeLoginCommand({ username, password, email });
      await writer.write(new TextEncoder().encode(loginCommand));
      writer.releaseLock();

      // Read response
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const maxResponseSize = 8192;

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

            // Wait for more data
            await new Promise((resolve) => setTimeout(resolve, 200));

            // Check if more data available
            const peek = await Promise.race([
              reader.read(),
              new Promise<{ value?: Uint8Array; done: boolean }>((resolve) =>
                setTimeout(() => resolve({ done: false }), 100)
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

      const responseText = new TextDecoder().decode(combined);

      reader.releaseLock();
      socket.close();

      if (!responseText) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Empty response from server (server may not be a Napster server)',
        } satisfies NapsterResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Parse response
      const parsed = parseNapsterResponse(responseText);

      // Check for login success indicators
      const isSuccess = responseText.toLowerCase().includes('welcome') ||
                        responseText.toLowerCase().includes('logged in') ||
                        responseText.toLowerCase().includes('success') ||
                        parsed.users !== undefined;

      return new Response(JSON.stringify({
        success: isSuccess,
        host,
        port,
        message: parsed.message || responseText.substring(0, 200),
        motd: parsed.motd,
        serverVersion: parsed.serverVersion,
        users: parsed.users,
        files: parsed.files,
        gigabytes: parsed.gigabytes,
        rtt,
      } satisfies NapsterResponse), {
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
      port: 6699,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies NapsterResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Query Napster server statistics.
 */
export async function handleNapsterStats(request: Request): Promise<Response> {
  try {
    const body = await request.json() as NapsterRequest;
    const {
      host,
      port = 6699,
      timeout = 15000,
    } = body;

    // Validation
    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies NapsterResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    // Connect to Napster server
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

      // Send STATS command
      const statsCommand = encodeStatsCommand();
      await writer.write(new TextEncoder().encode(statsCommand));
      writer.releaseLock();

      // Read response
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const maxResponseSize = 8192;

      const readTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Response timeout')), timeout);
      });

      try {
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

            if (totalBytes > maxResponseSize || totalBytes > 100) {
              await new Promise((resolve) => setTimeout(resolve, 200));
              const peek = await Promise.race([
                reader.read(),
                new Promise<{ value?: Uint8Array; done: boolean }>((resolve) =>
                  setTimeout(() => resolve({ done: false }), 100)
                ),
              ]);
              if (peek.value) {
                chunks.push(peek.value);
                totalBytes += peek.value.length;
              }
              break;
            }
          }
        }
      } catch (error) {
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

      const responseText = new TextDecoder().decode(combined);

      reader.releaseLock();
      socket.close();

      if (!responseText) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Empty response from server',
        } satisfies NapsterResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Parse response
      const parsed = parseNapsterResponse(responseText);

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        message: parsed.message || responseText.substring(0, 200),
        users: parsed.users,
        files: parsed.files,
        gigabytes: parsed.gigabytes,
        serverVersion: parsed.serverVersion,
        motd: parsed.motd,
        rtt,
      } satisfies NapsterResponse), {
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
      port: 6699,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies NapsterResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
