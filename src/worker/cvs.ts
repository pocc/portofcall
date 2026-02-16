/**
 * CVS pserver Protocol Handler (RFC not assigned, documented in CVS manual)
 * Port: 2401
 *
 * CVS (Concurrent Versions System) pserver is a text-based protocol for
 * accessing CVS repositories over the network with password authentication.
 *
 * Protocol Flow:
 * 1. Client connects and sends "BEGIN AUTH REQUEST"
 * 2. Server responds with greeting and version info
 * 3. Client sends repository path, username, scrambled password
 * 4. Server responds with "I LOVE YOU" (success) or "I HATE YOU" (failure)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/**
 * CVS password descrambling lookup table
 * CVS uses a simple substitution cipher for "security"
 */
const CVS_DESCRAMBLE_MAP: Record<string, string> = {
  t: 'A', r: 'B', v: 'C', w: 'D', n: 'E', q: 'F', x: 'G', m: 'H',
  k: 'I', l: 'J', z: 'K', o: 'L', p: 'M', y: 'N', u: 'O', i: 'P',
  a: 'Q', h: 'R', g: 'S', j: 'T', f: 'U', e: 'V', d: 'W', s: 'X',
  c: 'Y', b: 'Z', T: 'a', R: 'b', V: 'c', W: 'd', N: 'e', Q: 'f',
  X: 'g', M: 'h', K: 'i', L: 'j', Z: 'k', O: 'l', P: 'm', Y: 'n',
  U: 'o', I: 'p', A: 'q', H: 'r', G: 's', J: 't', F: 'u', E: 'v',
  D: 'w', S: 'x', C: 'y', B: 'z',
};

/**
 * Scramble a password using CVS's scrambling algorithm
 */
function scrambleCVSPassword(password: string): string {
  const scrambleMap: Record<string, string> = {};
  for (const [scrambled, clear] of Object.entries(CVS_DESCRAMBLE_MAP)) {
    scrambleMap[clear] = scrambled;
  }

  let result = 'A'; // CVS scrambled passwords always start with 'A'
  for (let i = 0; i < password.length; i++) {
    const char = password[i];
    result += scrambleMap[char] || char; // Pass through unmapped characters
  }
  return result;
}

/**
 * Read lines from socket until a specific terminator or timeout
 */
async function readLines(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number = 10000
): Promise<string[]> {
  const decoder = new TextDecoder();
  const lines: string[] = [];
  let buffer = '';
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const { done, value } = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), timeoutMs)
      ),
    ]);

    if (done || !value) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n');
    buffer = parts.pop() || '';
    lines.push(...parts);

    // Stop reading after we get a few lines for connect probe
    if (lines.length >= 3) break;
  }

  if (buffer) lines.push(buffer);
  return lines.filter((line) => line.trim().length > 0);
}

/**
 * CVS pserver Connect Handler
 * Probes a CVS server to check availability and get version info
 */
export async function handleCVSConnect(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { host, port = 2401 } = await request.json<{
      host: string;
      port?: number;
    }>();

    // Validate inputs
    if (!host || typeof host !== 'string' || host.trim() === '') {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (typeof port !== 'number' || port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid port number' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if target is behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Connect to CVS server
    const socket = connect({ hostname: host, port });
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      // Send BEGIN AUTH REQUEST
      const authRequest = 'BEGIN AUTH REQUEST\n';
      await writer.write(new TextEncoder().encode(authRequest));

      // Read server response (greeting, version, etc.)
      const lines = await readLines(reader, 10000);

      await writer.close();
      await reader.cancel();
      await socket.close();

      if (lines.length === 0) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'No response from server',
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Parse server response
      const greeting = lines.join('\n');

      return new Response(
        JSON.stringify({
          success: true,
          greeting,
          lines,
          message: 'Successfully connected to CVS pserver',
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } finally {
      try {
        await writer.close();
        await reader.cancel();
        await socket.close();
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * CVS pserver Login Handler
 * Attempts to authenticate with a CVS repository
 */
export async function handleCVSLogin(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const {
      host,
      port = 2401,
      repository,
      username,
      password,
    } = await request.json<{
      host: string;
      port?: number;
      repository: string;
      username: string;
      password: string;
    }>();

    // Validate inputs
    if (!host || typeof host !== 'string' || host.trim() === '') {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (typeof port !== 'number' || port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid port number' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!repository || typeof repository !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'Repository path is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!username || typeof username !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'Username is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!password || typeof password !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'Password is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if target is behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Connect to CVS server
    const socket = connect({ hostname: host, port });
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      // Send authentication sequence
      const scrambledPassword = scrambleCVSPassword(password);
      const authSequence = [
        'BEGIN AUTH REQUEST',
        repository,
        username,
        scrambledPassword,
        'END AUTH REQUEST',
        '',
      ].join('\n');

      await writer.write(new TextEncoder().encode(authSequence));

      // Read server response
      const lines = await readLines(reader, 10000);

      await writer.close();
      await reader.cancel();
      await socket.close();

      // Parse authentication result
      const response = lines.join('\n');
      const success = response.includes('I LOVE YOU');
      const failure = response.includes('I HATE YOU');

      if (success) {
        return new Response(
          JSON.stringify({
            success: true,
            authenticated: true,
            message: 'Authentication successful',
            response,
            lines,
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      } else if (failure) {
        return new Response(
          JSON.stringify({
            success: true,
            authenticated: false,
            message: 'Authentication failed',
            response,
            lines,
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      } else {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Unexpected server response',
            response,
            lines,
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } finally {
      try {
        await writer.close();
        await reader.cancel();
        await socket.close();
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Login failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
