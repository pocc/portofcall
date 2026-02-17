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
      // Send a complete (but intentionally wrong) auth request to trigger server response.
      // CVS pserver responds after receiving END AUTH REQUEST or EOF.
      const authRequest = [
        'BEGIN AUTH REQUEST',
        '/cvsroot',
        'anonymous',
        'A',
        'END AUTH REQUEST',
        '',
      ].join('\n');
      await writer.write(new TextEncoder().encode(authRequest));
      await writer.close();

      // Read server response (I LOVE YOU, I HATE YOU, or error message)
      const lines = await readLines(reader, 10000);

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
 * Read lines from socket with a configurable maximum line count and timeout.
 * Unlike readLines(), this does not stop early — it collects until timeout or done.
 */
async function readAllLines(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number = 10000,
  maxLines: number = 200
): Promise<string[]> {
  const decoder = new TextDecoder();
  const lines: string[] = [];
  let buffer = '';
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs && lines.length < maxLines) {
    const remaining = timeoutMs - (Date.now() - startTime);
    const { done, value } = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), remaining)
      ),
    ]);

    if (done || !value) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n');
    buffer = parts.pop() || '';
    lines.push(...parts);
  }

  if (buffer) lines.push(buffer);
  return lines.filter((line) => line.trim().length > 0);
}

/**
 * CVS pserver List Handler
 * Authenticates with a CVS repository and retrieves module/version information
 */
export async function handleCVSList(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const {
      host,
      port = 2401,
      timeout = 15000,
      username,
      password,
      cvsroot,
      module,
    } = await request.json<{
      host: string;
      port?: number;
      timeout?: number;
      username: string;
      password: string;
      cvsroot: string;
      module?: string;
    }>();

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

    if (!cvsroot || typeof cvsroot !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'CVS root is required' }),
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

    const startTime = Date.now();
    const socket = connect({ hostname: host, port });
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      // Step 1: Authenticate
      const scrambledPassword = scrambleCVSPassword(password);
      const authRequest = [
        'BEGIN AUTH REQUEST',
        cvsroot,
        username,
        scrambledPassword,
        'END AUTH REQUEST',
        '',
      ].join('\n');

      await writer.write(new TextEncoder().encode(authRequest));

      // Read auth response (I LOVE YOU or I HATE YOU)
      const authLines = await readLines(reader, Math.min(timeout, 8000));
      const authResponse = authLines.join('\n');
      const authenticated = authResponse.includes('I LOVE YOU');

      if (!authenticated) {
        try { await writer.close(); } catch { /* ignore */ }
        try { await reader.cancel(); } catch { /* ignore */ }
        try { await socket.close(); } catch { /* ignore */ }

        return new Response(
          JSON.stringify({
            success: true,
            authenticated: false,
            error: authResponse.includes('I HATE YOU')
              ? 'Authentication rejected by server'
              : 'Unexpected auth response',
            authResponse,
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Step 2: Send CVS protocol commands over the same authenticated socket
      const targetModule = module || '.';
      const encoder = new TextEncoder();

      // Announce root
      await writer.write(encoder.encode(`Root ${cvsroot}\n`));

      // Announce valid-responses we can handle
      const validResponses = [
        'ok', 'error', 'Valid-requests', 'Checked-in', 'New-entry', 'Checksum',
        'Copy-file', 'Updated', 'Created', 'Merged', 'Patched', 'Rcs-diff',
        'Mode', 'Mod-time', 'Removed', 'Remove-entry', 'Set-static-directory',
        'Clear-static-directory', 'Set-sticky', 'Clear-sticky', 'Template',
        'Set-checkin-prog', 'Set-update-prog', 'Notified', 'Module-expansion',
        'wrapper-rcsOptions', 'M', 'Mbinary', 'E', 'F', 'MT',
      ].join(' ');
      await writer.write(encoder.encode(`Valid-responses ${validResponses}\n`));

      // Request list of valid server requests
      await writer.write(encoder.encode('valid-requests\n'));

      // Also request server version
      await writer.write(encoder.encode('version\n'));

      // Send rlog to list repository info for the module
      await writer.write(encoder.encode(`rlog ${targetModule}\n`));

      // Read all server output until timeout
      const remainingTimeout = Math.max(1000, timeout - (Date.now() - startTime));
      const responseLines = await readAllLines(reader, remainingTimeout, 300);

      const rtt = Date.now() - startTime;

      try { await writer.close(); } catch { /* ignore */ }
      try { await reader.cancel(); } catch { /* ignore */ }
      try { await socket.close(); } catch { /* ignore */ }

      // Parse valid-requests line
      let validRequests: string[] = [];
      const validReqLine = responseLines.find((l) => l.startsWith('Valid-requests:'));
      if (validReqLine) {
        validRequests = validReqLine
          .replace(/^Valid-requests:\s*/, '')
          .split(/\s+/)
          .filter(Boolean);
      }

      // Parse server version
      let serverVersion: string | undefined;
      const versionLine = responseLines.find(
        (l) => l.startsWith('M ') && (l.includes('CVS') || l.includes('version') || l.includes('Version'))
      );
      if (versionLine) {
        serverVersion = versionLine.replace(/^M\s+/, '').trim();
      }

      return new Response(
        JSON.stringify({
          success: true,
          authenticated,
          validRequests,
          serverVersion,
          module: targetModule,
          rtt,
          rawLines: responseLines,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } finally {
      try { await writer.close(); } catch { /* ignore */ }
      try { await reader.cancel(); } catch { /* ignore */ }
      try { await socket.close(); } catch { /* ignore */ }
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'CVS list failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * CVS pserver Checkout Handler
 * Authenticates with a CVS repository and checks out a module (lists files/entries)
 *
 * CVS pserver checkout flow:
 * 1. Authenticate (BEGIN AUTH REQUEST … END AUTH REQUEST → I LOVE YOU)
 * 2. Send: Root {cvsroot}
 * 3. Send: Valid-responses {list}
 * 4. Send: valid-requests
 * 5. Send: Directory . / {cvsroot}
 * 6. Send: Argument {module}
 * 7. Send: co  (checkout command)
 * Server replies with Checked-in / Updated / Created / error / ok
 */
export async function handleCVSCheckout(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const {
      host,
      port = 2401,
      timeout = 20000,
      username,
      password,
      cvsroot,
      module: moduleName = '.',
    } = await request.json<{
      host: string;
      port?: number;
      timeout?: number;
      username: string;
      password: string;
      cvsroot: string;
      module?: string;
    }>();

    if (!host || typeof host !== 'string' || host.trim() === '') {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!username || typeof username !== 'string') {
      return new Response(JSON.stringify({ success: false, error: 'Username is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!password || typeof password !== 'string') {
      return new Response(JSON.stringify({ success: false, error: 'Password is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!cvsroot || typeof cvsroot !== 'string') {
      return new Response(JSON.stringify({ success: false, error: 'cvsroot is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const startTime = Date.now();
    const socket = connect({ hostname: host, port });
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      const enc = new TextEncoder();

      // Step 1: Authenticate
      const scrambledPassword = scrambleCVSPassword(password);
      const authRequest = [
        'BEGIN AUTH REQUEST',
        cvsroot,
        username,
        scrambledPassword,
        'END AUTH REQUEST',
        '',
      ].join('\n');
      await writer.write(enc.encode(authRequest));

      const authLines = await readLines(reader, Math.min(timeout, 8000));
      const authenticated = authLines.join('\n').includes('I LOVE YOU');

      if (!authenticated) {
        return new Response(JSON.stringify({
          success: true,
          authenticated: false,
          error: 'Authentication rejected by server',
          authResponse: authLines.join('\n'),
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      // Step 2: Issue checkout command
      const validResponses = [
        'ok', 'error', 'Valid-requests', 'Checked-in', 'New-entry', 'Checksum',
        'Copy-file', 'Updated', 'Created', 'Merged', 'Patched', 'Rcs-diff',
        'Mode', 'Mod-time', 'Removed', 'Remove-entry', 'Set-static-directory',
        'Clear-static-directory', 'Set-sticky', 'Clear-sticky', 'Template',
        'Set-checkin-prog', 'Set-update-prog', 'Notified', 'Module-expansion',
        'wrapper-rcsOptions', 'M', 'Mbinary', 'E', 'F', 'MT',
      ].join(' ');

      const commands = [
        `Root ${cvsroot}`,
        `Valid-responses ${validResponses}`,
        'valid-requests',
        `Directory ${moduleName === '.' ? '.' : moduleName}`,
        cvsroot,
        `Argument -N`,          // don't shorten module paths
        `Argument ${moduleName}`,
        'co',                   // checkout command
        '',
      ].join('\n');
      await writer.write(enc.encode(commands));

      // Step 3: Collect server output
      const remainingTimeout = Math.max(2000, timeout - (Date.now() - startTime));
      const responseLines = await readAllLines(reader, remainingTimeout, 500);

      const rtt = Date.now() - startTime;

      try { await writer.close(); } catch { /* ignore */ }
      try { await reader.cancel(); } catch { /* ignore */ }
      try { await socket.close(); } catch { /* ignore */ }

      // Parse results: extract file entries (Checked-in / Updated / Created / Module-expansion)
      const entries: string[] = [];
      const modules: string[] = [];
      let serverOk = false;
      let serverError: string | undefined;

      for (const line of responseLines) {
        if (line === 'ok') { serverOk = true; }
        else if (line.startsWith('error ') || line === 'error') {
          serverError = line.replace(/^error\s*/, '').trim();
        } else if (line.startsWith('Checked-in ') || line.startsWith('Updated ') || line.startsWith('Created ')) {
          entries.push(line.trim());
        } else if (line.startsWith('Module-expansion ')) {
          modules.push(line.replace(/^Module-expansion\s+/, '').trim());
        }
      }

      return new Response(JSON.stringify({
        success: true,
        authenticated: true,
        serverOk,
        serverError,
        module: moduleName,
        entries,
        modules,
        entryCount: entries.length,
        rtt,
        rawLines: responseLines,
      }), { headers: { 'Content-Type': 'application/json' } });

    } finally {
      try { await writer.close(); } catch { /* ignore */ }
      try { await reader.cancel(); } catch { /* ignore */ }
      try { await socket.close(); } catch { /* ignore */ }
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'CVS checkout failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
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
