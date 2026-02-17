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

// OpenNap binary protocol message types
const OPENNAP_MSG = {
  LOGIN: 2,
  LOGIN_ACK: 3,
  LOGIN_ERROR: 5,
  EMAIL: 6,
  USER_COUNT: 7,
  SEARCH: 200,
  SEARCH_RESULT: 201,
  SEARCH_END: 202,
} as const;

// OpenNap file type codes
const OPENNAP_FILE_TYPES: Record<string, number> = {
  mp3: 0,
  wav: 1,
  mov: 2,
  avi: 3,
  jpeg: 4,
  jpg: 4,
};

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

// ─── OpenNap Browse Protocol ─────────────────────────────────────────────────

interface OpenNapBrowseRequest {
  host: string;
  port?: number;
  timeout?: number;
  username: string;
  password: string;
  targetUser: string;
}

interface OpenNapBrowseResult {
  filename: string;
  size: number;
  bitrate: number;
  freq: number;
  lengthSecs: number;
}

interface OpenNapBrowseResponse {
  success: boolean;
  host: string;
  port: number;
  targetUser: string;
  count: number;
  files: OpenNapBrowseResult[];
  rtt?: number;
  error?: string;
}

// OpenNap message types for BROWSE
const OPENNAP_BROWSE_MSG = {
  BROWSE: 211,
  BROWSE_RESULT: 212,
  BROWSE_END: 213,
} as const;

/**
 * Browse files shared by a specific user on an OpenNap server.
 *
 * POST /api/napster/browse
 * Body: { host, port?, timeout?, username, password, targetUser }
 *
 * Protocol:
 *   Login (type 2) → ack (type 3)
 *   Browse (type 211): targetUser
 *   Results (type 212): one per file (same format as search result)
 *   End (type 213): signals end of browse results
 */
export async function handleNapsterBrowse(request: Request): Promise<Response> {
  try {
    const body = await request.json() as OpenNapBrowseRequest;
    const {
      host,
      port = 6699,
      timeout = 20000,
      username,
      password,
      targetUser,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false, host: '', port, targetUser: '', count: 0, files: [],
        error: 'Host is required',
      } satisfies OpenNapBrowseResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!username || !password) {
      return new Response(JSON.stringify({
        success: false, host, port, targetUser: '', count: 0, files: [],
        error: 'username and password are required',
      } satisfies OpenNapBrowseResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!targetUser || targetUser.trim().length === 0) {
      return new Response(JSON.stringify({
        success: false, host, port, targetUser: '', count: 0, files: [],
        error: 'targetUser is required',
      } satisfies OpenNapBrowseResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false, host, port, targetUser, count: 0, files: [],
        error: 'Port must be between 1 and 65535',
      } satisfies OpenNapBrowseResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

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

      // Login
      const loginData = `${username} ${password} PortOfCall/1.0 0 user@example.com 1`;
      await writer.write(encodeOpenNapMessage(OPENNAP_MSG.LOGIN, loginData));

      let buf = new Uint8Array(0);
      let loginOk = false;
      let loginError = '';
      const loginDeadline = Date.now() + 8000;

      while (Date.now() < loginDeadline) {
        const remaining = loginDeadline - Date.now();
        if (remaining <= 0) break;

        const shortTimeout = new Promise<{ value: undefined; done: true }>((resolve) => {
          setTimeout(() => resolve({ value: undefined, done: true }), remaining);
        });

        const { value, done } = await Promise.race([reader.read(), shortTimeout]);
        if (done || !value) break;

        const newBuf = new Uint8Array(buf.length + value.length);
        newBuf.set(buf, 0);
        newBuf.set(value, buf.length);
        buf = newBuf;

        const { messages, remaining: rest } = decodeOpenNapMessages(buf);
        buf = new Uint8Array(rest);

        for (const msg of messages) {
          if (msg.type === OPENNAP_MSG.LOGIN_ACK) {
            loginOk = true;
          } else if (msg.type === OPENNAP_MSG.LOGIN_ERROR) {
            loginError = msg.data;
          }
        }

        if (loginOk || loginError) break;
      }

      if (!loginOk) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false, host, port, targetUser, count: 0, files: [],
          rtt: Date.now() - start,
          error: loginError ? `Login failed: ${loginError}` : 'Login timed out or was not acknowledged',
        } satisfies OpenNapBrowseResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Send BROWSE command (type 211): data = targetUser
      await writer.write(encodeOpenNapMessage(OPENNAP_BROWSE_MSG.BROWSE, targetUser.trim()));

      // Collect results (type 212) until type 213 or timeout
      const files: OpenNapBrowseResult[] = [];
      const browseDeadline = Date.now() + Math.min(timeout - (Date.now() - start), 12000);

      while (Date.now() < browseDeadline) {
        const remaining = browseDeadline - Date.now();
        if (remaining <= 0) break;

        const shortTimeout = new Promise<{ value: undefined; done: true }>((resolve) => {
          setTimeout(() => resolve({ value: undefined, done: true }), remaining);
        });

        const { value, done } = await Promise.race([reader.read(), shortTimeout]);
        if (done || !value) break;

        const newBuf = new Uint8Array(buf.length + value.length);
        newBuf.set(buf, 0);
        newBuf.set(value, buf.length);
        buf = newBuf;

        const { messages, remaining: rest } = decodeOpenNapMessages(buf);
        buf = new Uint8Array(rest);

        let browseDone = false;
        for (const msg of messages) {
          if (msg.type === OPENNAP_BROWSE_MSG.BROWSE_RESULT) {
            const parsed = parseSearchResult(msg.data);
            if (parsed) files.push(parsed);
          } else if (msg.type === OPENNAP_BROWSE_MSG.BROWSE_END) {
            browseDone = true;
          }
        }

        if (browseDone) break;
      }

      const rtt = Date.now() - start;
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        targetUser,
        count: files.length,
        files,
        rtt,
      } satisfies OpenNapBrowseResponse), {
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
      targetUser: '',
      count: 0,
      files: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies OpenNapBrowseResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── OpenNap Binary Protocol ────────────────────────────────────────────────

interface OpenNapSearchRequest {
  host: string;
  port?: number;
  timeout?: number;
  username: string;
  password: string;
  query: string;
  fileType?: string;
}

interface OpenNapSearchResult {
  filename: string;
  size: number;
  bitrate: number;
  freq: number;
  lengthSecs: number;
}

interface OpenNapSearchResponse {
  success: boolean;
  host: string;
  port: number;
  count: number;
  results: OpenNapSearchResult[];
  serverUserCount?: number;
  rtt?: number;
  error?: string;
}

/**
 * Encode an OpenNap binary protocol message.
 * Each message: length(2 LE) + type(2 LE) + data bytes
 */
function encodeOpenNapMessage(type: number, data: string): Uint8Array {
  const dataBytes = new TextEncoder().encode(data);
  const buf = new ArrayBuffer(4 + dataBytes.length);
  const view = new DataView(buf);
  view.setUint16(0, dataBytes.length, true); // length LE
  view.setUint16(2, type, true);              // type LE
  new Uint8Array(buf).set(dataBytes, 4);
  return new Uint8Array(buf);
}

/**
 * Decode all complete OpenNap messages from a buffer.
 * Returns array of { type, data } and remaining unconsumed bytes.
 */
function decodeOpenNapMessages(buf: Uint8Array): {
  messages: Array<{ type: number; data: string }>;
  remaining: Uint8Array;
} {
  const messages: Array<{ type: number; data: string }> = [];
  let offset = 0;

  while (offset + 4 <= buf.length) {
    const view = new DataView(buf.buffer, buf.byteOffset + offset, 4);
    const len = view.getUint16(0, true);
    const type = view.getUint16(2, true);

    if (offset + 4 + len > buf.length) break; // incomplete message

    const dataBytes = buf.slice(offset + 4, offset + 4 + len);
    const data = new TextDecoder().decode(dataBytes);
    messages.push({ type, data });
    offset += 4 + len;
  }

  return { messages, remaining: buf.slice(offset) };
}

/**
 * Parse a single SEARCH_RESULT (type 201) data string.
 * NUL-separated: filename, nick, address, port, filesize, md5, bitrate, freq, duration
 * Falls back to space-separated: "filename md5 size bitrate freq length"
 */
function parseSearchResult(data: string): OpenNapSearchResult | null {
  // Try NUL-separated fields first (original OpenNap spec)
  const nulParts = data.split('\x00').filter(Boolean);
  if (nulParts.length >= 8) {
    return {
      filename: nulParts[0] || '',
      size: parseInt(nulParts[4], 10) || 0,
      bitrate: parseInt(nulParts[6], 10) || 0,
      freq: parseInt(nulParts[7], 10) || 0,
      lengthSecs: parseInt(nulParts[8] || '0', 10) || 0,
    };
  }

  // Fall back to space-separated: "filename md5 size bitrate freq length"
  const parts = data.trim().split(/\s+/);
  if (parts.length >= 4) {
    return {
      filename: parts[0] || '',
      size: parseInt(parts[2], 10) || 0,
      bitrate: parseInt(parts[3], 10) || 0,
      freq: parseInt(parts[4] || '0', 10) || 0,
      lengthSecs: parseInt(parts[5] || '0', 10) || 0,
    };
  }

  return null;
}

/**
 * Search an OpenNap server for files using the binary OpenNap protocol.
 *
 * POST /api/napster/search
 * Body: { host, port?, timeout?, username, password, query, fileType? }
 *
 * Protocol:
 *   Login (type 2): "username password clientname 0 email build"
 *   Server ack (type 3=OK, 5=error, 6=email, 7=user count)
 *   Search (type 200): FILENAME CONTAINS "query" MAX_RESULTS 20 ...
 *   Results (type 201): one per file
 *   End (type 202): signals end of search results
 */
export async function handleNapsterSearch(request: Request): Promise<Response> {
  try {
    const body = await request.json() as OpenNapSearchRequest;
    const {
      host,
      port = 6699,
      timeout = 20000,
      username,
      password,
      query,
      fileType,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false, host: '', port, count: 0, results: [],
        error: 'Host is required',
      } satisfies OpenNapSearchResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!username || !password) {
      return new Response(JSON.stringify({
        success: false, host, port, count: 0, results: [],
        error: 'username and password are required',
      } satisfies OpenNapSearchResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!query || query.trim().length === 0) {
      return new Response(JSON.stringify({
        success: false, host, port, count: 0, results: [],
        error: 'query is required',
      } satisfies OpenNapSearchResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false, host, port, count: 0, results: [],
        error: 'Port must be between 1 and 65535',
      } satisfies OpenNapSearchResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

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

      // Send login: type 2
      const loginData = `${username} ${password} PortOfCall/1.0 0 user@example.com 1`;
      await writer.write(encodeOpenNapMessage(OPENNAP_MSG.LOGIN, loginData));

      // Collect login response messages
      let serverUserCount: number | undefined;
      let loginOk = false;
      let loginError = '';
      let buf = new Uint8Array(0);

      const loginDeadline = Date.now() + 8000;

      while (Date.now() < loginDeadline) {
        const remaining = loginDeadline - Date.now();
        if (remaining <= 0) break;

        const shortTimeout = new Promise<{ value: undefined; done: true }>((resolve) => {
          setTimeout(() => resolve({ value: undefined, done: true }), remaining);
        });

        const { value, done } = await Promise.race([reader.read(), shortTimeout]);
        if (done || !value) break;

        const newBuf = new Uint8Array(buf.length + value.length);
        newBuf.set(buf, 0);
        newBuf.set(value, buf.length);
        buf = newBuf;

        const { messages, remaining: rest } = decodeOpenNapMessages(buf);
        buf = new Uint8Array(rest);

        for (const msg of messages) {
          if (msg.type === OPENNAP_MSG.LOGIN_ACK) {
            loginOk = true;
          } else if (msg.type === OPENNAP_MSG.LOGIN_ERROR) {
            loginError = msg.data;
          } else if (msg.type === OPENNAP_MSG.USER_COUNT) {
            const parts = msg.data.trim().split(/\s+/);
            serverUserCount = parseInt(parts[0], 10) || undefined;
          }
          // EMAIL (type 6) is ignored
        }

        if (loginOk || loginError) break;
      }

      if (!loginOk) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          count: 0,
          results: [],
          serverUserCount,
          rtt: Date.now() - start,
          error: loginError
            ? `Login failed: ${loginError}`
            : 'Login timed out or was not acknowledged',
        } satisfies OpenNapSearchResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Build SEARCH command (type 200)
      let searchData =
        `FILENAME CONTAINS "${query}" MAX_RESULTS 20 LINESPEED >= 0 BITRATE >= 0 FREQ >= 0`;

      if (fileType) {
        const ftCode = OPENNAP_FILE_TYPES[fileType.toLowerCase()];
        if (ftCode !== undefined) {
          searchData += ` TYPE ${ftCode}`;
        }
      }

      await writer.write(encodeOpenNapMessage(OPENNAP_MSG.SEARCH, searchData));

      // Collect search results (type 201) until type 202 or timeout
      const results: OpenNapSearchResult[] = [];
      const searchDeadline = Date.now() + Math.min(timeout - (Date.now() - start), 12000);

      while (Date.now() < searchDeadline) {
        const remaining = searchDeadline - Date.now();
        if (remaining <= 0) break;

        const shortTimeout = new Promise<{ value: undefined; done: true }>((resolve) => {
          setTimeout(() => resolve({ value: undefined, done: true }), remaining);
        });

        const { value, done } = await Promise.race([reader.read(), shortTimeout]);
        if (done || !value) break;

        const newBuf = new Uint8Array(buf.length + value.length);
        newBuf.set(buf, 0);
        newBuf.set(value, buf.length);
        buf = newBuf;

        const { messages, remaining: rest } = decodeOpenNapMessages(buf);
        buf = new Uint8Array(rest);

        let searchDone = false;
        for (const msg of messages) {
          if (msg.type === OPENNAP_MSG.SEARCH_RESULT) {
            const parsed = parseSearchResult(msg.data);
            if (parsed) results.push(parsed);
          } else if (msg.type === OPENNAP_MSG.SEARCH_END) {
            searchDone = true;
          } else if (msg.type === OPENNAP_MSG.USER_COUNT) {
            const parts = msg.data.trim().split(/\s+/);
            serverUserCount = parseInt(parts[0], 10) || serverUserCount;
          }
        }

        if (searchDone) break;
      }

      const rtt = Date.now() - start;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        count: results.length,
        results,
        serverUserCount,
        rtt,
      } satisfies OpenNapSearchResponse), {
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
      count: 0,
      results: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies OpenNapSearchResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
