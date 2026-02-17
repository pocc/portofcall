/**
 * Active Users Protocol Implementation (RFC 866)
 *
 * The Active Users service returns the number of users currently logged into a system.
 * This is a very simple protocol from 1983, primarily used for system monitoring.
 *
 * Protocol Flow:
 * 1. Client connects to server port 11
 * 2. Server responds with a line containing the number of users
 * 3. Server closes connection
 *
 * Response Format:
 * - Can be a simple number: "42\r\n"
 * - Or descriptive: "There are 42 users\r\n"
 * - Format varies by implementation
 *
 * Use Cases:
 * - Legacy Unix system monitoring
 * - Historical protocol demonstration
 * - Network service testing
 *
 * Note: This protocol is largely obsolete. Modern systems rarely run
 * this service, but it remains a valid Internet Standard.
 */

import { connect } from 'cloudflare:sockets';

interface ActiveUsersRequest {
  host: string;
  port: number;
  timeout?: number;
}

interface ActiveUsersResponse {
  success: boolean;
  response: string;
  userCount?: number;
  rtt: number;
  error?: string;
}

/**
 * Query Active Users protocol
 * Connects to a server and retrieves the number of active users
 */
export async function handleActiveUsersTest(request: Request): Promise<Response> {
  try {
    const body = await request.json() as ActiveUsersRequest;
    const { host, port = 11, timeout = 10000 } = body;

    // Validation
    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Start timer for RTT measurement
    const startTime = Date.now();

    // Connect to Active Users server
    const socket = connect(`${host}:${port}`);

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      // Wait for connection with timeout
      await Promise.race([
        socket.opened,
        timeoutPromise
      ]);

      const reader = socket.readable.getReader();

      // Read response (server sends data immediately)
      const { value: responseBytes } = await Promise.race([
        reader.read(),
        timeoutPromise
      ]);

      if (!responseBytes) {
        throw new Error('No response received from server');
      }

      // Decode response
      const responseText = new TextDecoder().decode(responseBytes).trim();
      const rtt = Date.now() - startTime;

      // Try to extract user count from response
      // Common formats:
      // - "42"
      // - "42 users"
      // - "There are 42 users"
      // - "42 users logged in"
      let userCount: number | undefined;
      const numberMatch = responseText.match(/\d+/);
      if (numberMatch) {
        userCount = parseInt(numberMatch[0], 10);
      }

      // Clean up
      reader.releaseLock();
      socket.close();

      const response: ActiveUsersResponse = {
        success: true,
        response: responseText,
        userCount: userCount,
        rtt: rtt,
      };

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
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
      response: '',
      rtt: 0
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Read all bytes until connection closes or timeout
async function readAllBytes(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const ct = new Promise<{ value: undefined; done: true }>(r => setTimeout(() => r({ value: undefined, done: true }), remaining));
      const { value, done } = await Promise.race([reader.read(), ct]);
      if (done || !value) break;
      chunks.push(value);
    } catch { break; }
  }
  if (chunks.length === 0) return new Uint8Array(0);
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

interface ActiveUser { username: string; tty: string; loginTime: string; idle?: string; }

function parseUserLine(line: string): ActiveUser | null {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const [username, tty, ...rest] = parts;
  if (!username || !tty) return null;
  const last = rest[rest.length - 1] ?? '';
  const isIdle = /^(\d+:\d+|\.|old)$/.test(last) && rest.length > 1;
  const loginTime = isIdle ? rest.slice(0, -1).join(' ') : rest.join(' ');
  const idle = isIdle ? last : undefined;
  return { username, tty, loginTime: loginTime || '(unknown)', ...(idle ? { idle } : {}) };
}

/**
 * Query Active Users service (RFC 866) and return structured per-user data.
 * Request body: { host, port=11, timeout=10000 }
 */
export async function handleActiveUsersQuery(request: Request): Promise<Response> {
  try {
    const body = await request.json() as { host: string; port?: number; timeout?: number };
    const { host, port = 11, timeout = 10000 } = body;
    if (!host) return new Response(JSON.stringify({ success: false, users: [], rawCount: 0, raw: '', latencyMs: 0, error: 'Host is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout));
    try {
      await Promise.race([socket.opened, timeoutPromise]);
      const reader = socket.readable.getReader();
      const allBytes = await Promise.race([readAllBytes(reader, timeout - (Date.now() - startTime)), timeoutPromise]);
      const latencyMs = Date.now() - startTime;
      reader.releaseLock(); socket.close();
      const raw = new TextDecoder().decode(allBytes);
      const lines = raw.split(/\r?\n/);
      const users: ActiveUser[] = lines.map(parseUserLine).filter((u): u is ActiveUser => u !== null);
      return new Response(JSON.stringify({ success: true, users, rawCount: lines.filter(l => l.trim()).length, raw, latencyMs }), { headers: { 'Content-Type': 'application/json' } });
    } catch (err) { socket.close(); throw err; }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, users: [], rawCount: 0, raw: '', latencyMs: 0, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Query Active Users service and return the raw unparsed server output.
 * Request body: { host, port=11, timeout=10000 }
 */
export async function handleActiveUsersRaw(request: Request): Promise<Response> {
  try {
    const body = await request.json() as { host: string; port?: number; timeout?: number };
    const { host, port = 11, timeout = 10000 } = body;
    if (!host) return new Response(JSON.stringify({ success: false, raw: '', latencyMs: 0, error: 'Host is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout));
    try {
      await Promise.race([socket.opened, timeoutPromise]);
      const reader = socket.readable.getReader();
      const allBytes = await Promise.race([readAllBytes(reader, timeout - (Date.now() - startTime)), timeoutPromise]);
      const latencyMs = Date.now() - startTime;
      reader.releaseLock(); socket.close();
      return new Response(JSON.stringify({ success: true, raw: new TextDecoder().decode(allBytes), latencyMs }), { headers: { 'Content-Type': 'application/json' } });
    } catch (err) { socket.close(); throw err; }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, raw: '', latencyMs: 0, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
