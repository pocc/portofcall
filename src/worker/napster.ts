/**
 * OpenNap Protocol Implementation (Historical/Educational)
 *
 * Napster was a pioneering peer-to-peer file sharing service that revolutionized
 * music distribution from 1999-2001. The original service was shut down due to
 * copyright lawsuits, but the protocol lives on in OpenNap servers.
 *
 * Protocol Flow:
 * 1. Client connects to OpenNap server on port 8888 (TCP)
 * 2. Client sends LOGIN message (type 2) with binary framing
 * 3. Server responds with LOGIN_ACK (type 3) or LOGIN_ERROR (type 5)
 * 4. Client can search, browse users, query stats
 * 5. File transfers happen directly between clients (P2P)
 *
 * Wire Format (Binary):
 * - Each message: 2-byte length (LE) + 2-byte type (LE) + payload
 * - Length field = number of payload bytes (excludes the 4-byte header)
 * - All integers are little-endian unsigned 16-bit
 *
 * Message Types Used:
 * -   2: LOGIN       — "nick password port \"clientinfo\" speed [email]"
 * -   3: LOGIN_ACK   — server confirms login
 * -   5: LOGIN_ERROR — server rejects login
 * -   6: EMAIL       — server sends email (informational, ignored)
 * -   7: USER_COUNT  — "users files size" (online user/file/GB counts)
 * - 200: SEARCH      — "FILENAME CONTAINS \"query\" MAX_RESULTS n ..."
 * - 201: SEARCH_RESULT — one result per message
 * - 202: SEARCH_END  — signals end of search results
 * - 211: BROWSE      — "targetUser"
 * - 212: BROWSE_RESULT — one file per message
 * - 213: BROWSE_END  — signals end of browse results
 * - 214: STATS       — request server statistics (empty payload)
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

// Default OpenNap port (Napster's original was 8875/6699, OpenNap standardized on 8888)
// Using 6699 as default since it's the more common historical Napster port
const DEFAULT_OPENNAP_PORT = 6699;

// OpenNap binary protocol message types
const OPENNAP_MSG = {
  LOGIN: 2,
  LOGIN_ACK: 3,
  LOGIN_ERROR: 5,
  EMAIL: 6,
  USER_COUNT: 7,
  STATS: 214,
  STATS_RESPONSE: 214,
  SEARCH: 200,
  SEARCH_RESULT: 201,
  SEARCH_END: 202,
  BROWSE: 211,
  BROWSE_RESULT: 212,
  BROWSE_END: 213,
} as const;

// OpenNap link speed codes
// 0=Unknown, 1=14.4, 2=28.8, 3=33.6, 4=57.6, 5=64K ISDN,
// 6=128K ISDN, 7=Cable, 8=DSL, 9=T1, 10=T3+
const LINK_SPEED_DSL = 8;

// OpenNap file type codes for search filtering
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

// ─── OpenNap Binary Wire Format ──────────────────────────────────────────────

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
    // Create a fresh DataView to avoid issues with buffer slices
    const headerBytes = buf.slice(offset, offset + 4);
    const view = new DataView(headerBytes.buffer, headerBytes.byteOffset, 4);
    const len = view.getUint16(0, true);
    const type = view.getUint16(2, true);

    // Protect against malicious servers sending massive length values
    if (len > 1024 * 1024) {
      throw new Error(`OpenNap message length ${len} exceeds 1MB safety limit`);
    }

    if (offset + 4 + len > buf.length) break; // incomplete message

    const dataBytes = buf.slice(offset + 4, offset + 4 + len);
    const data = new TextDecoder().decode(dataBytes);
    messages.push({ type, data });
    offset += 4 + len;
  }

  return { messages, remaining: buf.slice(offset) };
}

/**
 * Build the OpenNap LOGIN payload string.
 *
 * Format: nick password port "clientinfo" speed [email]
 * - port: client's listening port for incoming transfers (0 = not sharing)
 * - clientinfo: quoted client software identifier
 * - speed: link speed code (see LINK_SPEED constants)
 * - email: optional, some servers require it for new account registration
 */
function buildLoginPayload(params: {
  username: string;
  password: string;
  email?: string;
}): string {
  const { username, password, email } = params;
  const clientPort = 0; // Not sharing files (read-only client)
  const clientInfo = 'PortOfCall/1.0';

  let payload = `${username} ${password} ${clientPort} "${clientInfo}" ${LINK_SPEED_DSL}`;

  if (email) {
    payload += ` ${email}`;
  }

  return payload;
}

/**
 * Shared login-and-wait helper. Sends LOGIN (type 2) and waits for
 * LOGIN_ACK (type 3) or LOGIN_ERROR (type 5), collecting any USER_COUNT
 * messages along the way.
 *
 * Returns the leftover buffer (may contain messages after login ack)
 * and the login result.
 */
async function performLogin(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  params: { username: string; password: string; email?: string },
  loginTimeoutMs: number,
): Promise<{
  ok: boolean;
  error: string;
  serverUserCount?: number;
  loginAckData?: string;
  buf: Uint8Array;
}> {
  const loginPayload = buildLoginPayload(params);
  await writer.write(encodeOpenNapMessage(OPENNAP_MSG.LOGIN, loginPayload));

  let buf = new Uint8Array(0);
  let loginOk = false;
  let loginError = '';
  let loginAckData: string | undefined;
  let serverUserCount: number | undefined;
  const deadline = Date.now() + loginTimeoutMs;

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
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

    const decoded = decodeOpenNapMessages(buf);
    buf = decoded.remaining as Uint8Array<ArrayBuffer>;

    for (const msg of decoded.messages) {
      if (msg.type === OPENNAP_MSG.LOGIN_ACK) {
        loginOk = true;
        loginAckData = msg.data;
      } else if (msg.type === OPENNAP_MSG.LOGIN_ERROR) {
        loginError = msg.data;
      } else if (msg.type === OPENNAP_MSG.USER_COUNT) {
        const parts = msg.data.trim().split(/\s+/);
        serverUserCount = parseInt(parts[0], 10) || undefined;
      }
      // EMAIL (type 6) is informational, ignored
    }

    if (loginOk || loginError) break;
  }

  return { ok: loginOk, error: loginError, serverUserCount, loginAckData, buf };
}

/**
 * Parse a single SEARCH_RESULT / BROWSE_RESULT (type 201/212) data string.
 *
 * OpenNap search result format (space-separated, filename is quoted):
 *   "filename" md5 size bitrate freq length nick ip speed
 *
 * Some servers use a slightly different order. We try the quoted-filename
 * format first, then fall back to a simple space-split.
 */
function parseSearchResult(data: string): { filename: string; size: number; bitrate: number; freq: number; lengthSecs: number } | null {
  // Try quoted filename format: "filename" md5 size bitrate freq length nick ip speed
  const quotedMatch = data.match(/^"([^"]*)"(?:\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+))?/);
  if (quotedMatch) {
    return {
      filename: quotedMatch[1] || '',
      size: parseInt(quotedMatch[3] || '0', 10) || 0,
      bitrate: parseInt(quotedMatch[4] || '0', 10) || 0,
      freq: parseInt(quotedMatch[5] || '0', 10) || 0,
      lengthSecs: parseInt(quotedMatch[6] || '0', 10) || 0,
    };
  }

  // Fallback: simple space-separated fields
  // filename md5 size bitrate freq length nick ip speed
  const parts = data.trim().split(/\s+/);
  if (parts.length >= 6) {
    return {
      filename: parts[0] || '',
      size: parseInt(parts[2], 10) || 0,
      bitrate: parseInt(parts[3], 10) || 0,
      freq: parseInt(parts[4], 10) || 0,
      lengthSecs: parseInt(parts[5], 10) || 0,
    };
  }

  return null;
}

/**
 * Parse a USER_COUNT (type 7) or STATS response (type 214) data string.
 * Format: "users files size" where size is in gigabytes.
 */
function parseStatsData(data: string): { users?: number; files?: number; gigabytes?: number } {
  const parts = data.trim().split(/\s+/);
  return {
    users: parts[0] ? (parseInt(parts[0], 10) || undefined) : undefined,
    files: parts[1] ? (parseInt(parts[1], 10) || undefined) : undefined,
    gigabytes: parts[2] ? (parseInt(parts[2], 10) || undefined) : undefined,
  };
}


// ─── HTTP Handlers ───────────────────────────────────────────────────────────

/**
 * Test Napster/OpenNap server connectivity (TCP probe only, no protocol).
 *
 * POST /api/napster/connect
 * Body: { host, port?, timeout? }
 */
export async function handleNapsterConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as NapsterRequest;
    const {
      host,
      port = DEFAULT_OPENNAP_PORT,
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

    // Connect to server
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
      try {
        socket.close();
      } catch {
        // Ignore close errors
      }
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      host: '',
      port: DEFAULT_OPENNAP_PORT,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies NapsterResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Send OpenNap LOGIN (type 2) and return the server's response.
 *
 * POST /api/napster/login
 * Body: { host, port?, username, password, email?, timeout? }
 *
 * Protocol:
 *   Client sends LOGIN (type 2): "nick password port \"clientinfo\" speed [email]"
 *   Server responds with:
 *     LOGIN_ACK (type 3): email address on success
 *     LOGIN_ERROR (type 5): error message on failure
 *     EMAIL (type 6): informational (ignored)
 *     USER_COUNT (type 7): "users files gigabytes"
 */
export async function handleNapsterLogin(request: Request): Promise<Response> {
  try {
    const body = await request.json() as NapsterRequest;
    const {
      host,
      port = DEFAULT_OPENNAP_PORT,
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

    // Connect to server
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

      // Perform binary OpenNap login
      const loginResult = await performLogin(writer, reader, { username, password, email }, Math.min(timeout, 10000));

      const rtt = Date.now() - start;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      if (!loginResult.ok) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          users: loginResult.serverUserCount,
          error: loginResult.error
            ? `Login failed: ${loginResult.error}`
            : 'Login timed out or was not acknowledged',
          rtt,
        } satisfies NapsterResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        message: loginResult.loginAckData || 'Login successful',
        users: loginResult.serverUserCount,
        rtt,
      } satisfies NapsterResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      try {
        socket.close();
      } catch {
        // Ignore close errors
      }
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      host: '',
      port: DEFAULT_OPENNAP_PORT,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies NapsterResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Query OpenNap server statistics.
 *
 * POST /api/napster/stats
 * Body: { host, port?, username?, password?, timeout? }
 *
 * Protocol:
 *   Login (type 2) first if credentials provided, then:
 *   Client sends STATS request (type 214, empty payload)
 *   Server responds with STATS (type 214): "users files gigabytes"
 *
 *   If no credentials, we attempt a TCP connect and read any initial
 *   USER_COUNT (type 7) messages the server may send after connection.
 *   Most OpenNap servers require login before they respond to stats.
 */
export async function handleNapsterStats(request: Request): Promise<Response> {
  try {
    const body = await request.json() as NapsterRequest;
    const {
      host,
      port = DEFAULT_OPENNAP_PORT,
      username,
      password,
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

    // Connect to server
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

      let users: number | undefined;
      let files: number | undefined;
      let gigabytes: number | undefined;
      let buf = new Uint8Array(0);

      // If credentials provided, login first (required by most servers)
      if (username && password) {
        const loginResult = await performLogin(writer, reader, { username, password }, Math.min(timeout, 8000));
        buf = loginResult.buf as Uint8Array<ArrayBuffer>;

        if (!loginResult.ok) {
          writer.releaseLock();
          reader.releaseLock();
          socket.close();
          return new Response(JSON.stringify({
            success: false,
            host,
            port,
            error: loginResult.error
              ? `Login failed: ${loginResult.error}`
              : 'Login timed out (credentials may be required for stats)',
            rtt: Date.now() - start,
          } satisfies NapsterResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // We may have gotten USER_COUNT during login
        if (loginResult.serverUserCount !== undefined) {
          users = loginResult.serverUserCount;
        }

        // Send STATS request (type 214, empty payload)
        await writer.write(encodeOpenNapMessage(OPENNAP_MSG.STATS, ''));
      } else {
        // Without credentials, send STATS anyway and hope the server responds.
        // Most OpenNap servers will reject this, but some may respond.
        await writer.write(encodeOpenNapMessage(OPENNAP_MSG.STATS, ''));
      }

      // Read stats response
      const statsDeadline = Date.now() + Math.min(timeout - (Date.now() - start), 5000);

      while (Date.now() < statsDeadline) {
        const remaining = statsDeadline - Date.now();
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

        const decoded = decodeOpenNapMessages(buf);
        buf = decoded.remaining as Uint8Array<ArrayBuffer>;

        let gotStats = false;
        for (const msg of decoded.messages) {
          if (msg.type === OPENNAP_MSG.STATS_RESPONSE || msg.type === OPENNAP_MSG.USER_COUNT) {
            const parsed = parseStatsData(msg.data);
            if (parsed.users !== undefined) users = parsed.users;
            if (parsed.files !== undefined) files = parsed.files;
            if (parsed.gigabytes !== undefined) gigabytes = parsed.gigabytes;
            gotStats = true;
          }
        }

        if (gotStats) break;
      }

      const rtt = Date.now() - start;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const hasData = users !== undefined || files !== undefined || gigabytes !== undefined;

      return new Response(JSON.stringify({
        success: hasData,
        host,
        port,
        message: hasData ? 'Server statistics retrieved' : 'No stats received (server may require login)',
        users,
        files,
        gigabytes,
        rtt,
      } satisfies NapsterResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      try {
        socket.close();
      } catch {
        // Ignore close errors
      }
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      host: '',
      port: DEFAULT_OPENNAP_PORT,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies NapsterResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── OpenNap Browse ──────────────────────────────────────────────────────────

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

/**
 * Browse files shared by a specific user on an OpenNap server.
 *
 * POST /api/napster/browse
 * Body: { host, port?, timeout?, username, password, targetUser }
 *
 * Protocol:
 *   Login (type 2) -> ack (type 3)
 *   Browse (type 211): targetUser
 *   Results (type 212): one per file (same format as search result)
 *   End (type 213): signals end of browse results
 */
export async function handleNapsterBrowse(request: Request): Promise<Response> {
  try {
    const body = await request.json() as OpenNapBrowseRequest;
    const {
      host,
      port = DEFAULT_OPENNAP_PORT,
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

      // Login first
      const loginResult = await performLogin(writer, reader, { username, password }, Math.min(timeout, 8000));
      let buf = loginResult.buf;

      if (!loginResult.ok) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false, host, port, targetUser, count: 0, files: [],
          rtt: Date.now() - start,
          error: loginResult.error ? `Login failed: ${loginResult.error}` : 'Login timed out or was not acknowledged',
        } satisfies OpenNapBrowseResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Send BROWSE command (type 211): data = targetUser
      await writer.write(encodeOpenNapMessage(OPENNAP_MSG.BROWSE, targetUser.trim()));

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

        const decoded = decodeOpenNapMessages(buf);
        buf = decoded.remaining;

        let browseDone = false;
        for (const msg of decoded.messages) {
          if (msg.type === OPENNAP_MSG.BROWSE_RESULT) {
            const parsed = parseSearchResult(msg.data);
            if (parsed) files.push(parsed);
          } else if (msg.type === OPENNAP_MSG.BROWSE_END) {
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
      try {
        socket.close();
      } catch {
        // Ignore close errors
      }
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      host: '',
      port: DEFAULT_OPENNAP_PORT,
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

// ─── OpenNap Search ──────────────────────────────────────────────────────────

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
 * Search an OpenNap server for files using the binary OpenNap protocol.
 *
 * POST /api/napster/search
 * Body: { host, port?, timeout?, username, password, query, fileType? }
 *
 * Protocol:
 *   Login (type 2): "nick password port \"clientinfo\" speed [email]"
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
      port = DEFAULT_OPENNAP_PORT,
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

      // Login first
      const loginResult = await performLogin(writer, reader, { username, password }, Math.min(timeout, 8000));
      let buf = loginResult.buf;
      let serverUserCount = loginResult.serverUserCount;

      if (!loginResult.ok) {
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
          error: loginResult.error
            ? `Login failed: ${loginResult.error}`
            : 'Login timed out or was not acknowledged',
        } satisfies OpenNapSearchResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Build SEARCH command (type 200)
      // Format: FILENAME CONTAINS "query" MAX_RESULTS n LINESPEED "EQUAL TO" speed BITRATE "EQUAL TO" rate FREQ "EQUAL TO" freq
      // Using >= 0 for optional constraints to accept all results

      // Escape quotes in query to prevent OpenNap command injection
      const escapedQuery = query.replace(/"/g, '\\"');

      let searchData =
        `FILENAME CONTAINS "${escapedQuery}" MAX_RESULTS 20 LINESPEED "EQUAL TO" 0 BITRATE "EQUAL TO" 0 FREQ "EQUAL TO" 0`;

      if (fileType) {
        const ftCode = OPENNAP_FILE_TYPES[fileType.toLowerCase()];
        if (ftCode !== undefined) {
          searchData += ` TYPE "EQUAL TO" ${ftCode}`;
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

        const decoded = decodeOpenNapMessages(buf);
        buf = decoded.remaining;

        let searchDone = false;
        for (const msg of decoded.messages) {
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
      try {
        socket.close();
      } catch {
        // Ignore close errors
      }
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      host: '',
      port: DEFAULT_OPENNAP_PORT,
      count: 0,
      results: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies OpenNapSearchResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
