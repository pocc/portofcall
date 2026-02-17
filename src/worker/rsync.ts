/**
 * Rsync Daemon Protocol Implementation
 *
 * Implements rsync connectivity testing via the rsync daemon protocol (port 873).
 * The daemon protocol uses a simple text-based handshake for version exchange
 * and module listing.
 *
 * Protocol Flow:
 * 1. Client connects to port 873
 * 2. Server sends "@RSYNCD: <version>\n"
 * 3. Client sends "@RSYNCD: <version>\n"
 * 4. Client sends module name (or empty for module list)
 * 5. Server responds with module list or module greeting
 *
 * Use Cases:
 * - Rsync daemon connectivity testing
 * - Protocol version detection
 * - Available module discovery
 * - Server health checking
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/**
 * Read all available data from socket as text, line by line
 */
async function readAllLines(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeout: number,
): Promise<string[]> {
  const decoder = new TextDecoder();
  let buffer = '';
  const lines: string[] = [];
  const maxSize = 64 * 1024;
  let totalBytes = 0;

  const timeoutPromise = new Promise<{ value: undefined; done: true }>((resolve) => {
    setTimeout(() => resolve({ value: undefined, done: true }), timeout);
  });

  try {
    while (totalBytes < maxSize) {
      const result = await Promise.race([reader.read(), timeoutPromise]);

      if (result.done || !result.value) break;

      totalBytes += result.value.length;
      buffer += decoder.decode(result.value, { stream: true });

      // Extract complete lines
      while (buffer.includes('\n')) {
        const idx = buffer.indexOf('\n');
        lines.push(buffer.substring(0, idx));
        buffer = buffer.substring(idx + 1);
      }
    }
  } catch {
    // Connection closed or timeout - expected
  }

  // Add any remaining data as a line
  if (buffer.length > 0) {
    lines.push(buffer);
  }

  return lines;
}

/**
 * Handle rsync daemon connect - version exchange and module listing
 */
export async function handleRsyncConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 873, timeout = 10000 } = body;

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

    // Check if the target is behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);
    const connectTime = Date.now() - startTime;

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // Read server greeting: "@RSYNCD: <version>\n"
    const decoder = new TextDecoder();
    let greeting = '';

    const greetingResult = await Promise.race([reader.read(), timeoutPromise]);
    if (greetingResult.done || !greetingResult.value) {
      throw new Error('Server closed connection without greeting');
    }
    greeting = decoder.decode(greetingResult.value).trim();

    // Parse server version from "@RSYNCD: 31.0"
    let serverVersion = '';
    if (greeting.startsWith('@RSYNCD:')) {
      serverVersion = greeting.replace('@RSYNCD:', '').trim();
    } else {
      throw new Error(`Unexpected server greeting: ${greeting.substring(0, 100)}`);
    }

    // Send our protocol version
    const clientVersion = '30.0';
    await writer.write(new TextEncoder().encode(`@RSYNCD: ${clientVersion}\n`));

    // Send empty line to request module listing
    await writer.write(new TextEncoder().encode('\n'));

    // Read module list — server sends lines of "modulename\tdescription"
    // terminated by "@RSYNCD: EXIT"
    const lines = await readAllLines(reader, Math.min(timeout, 5000));

    const modules: Array<{ name: string; description: string }> = [];
    let motd = '';

    for (const line of lines) {
      if (line.startsWith('@RSYNCD: EXIT')) {
        break;
      } else if (line.startsWith('@ERROR')) {
        // Some servers return errors for anonymous module listing
        break;
      } else if (line.startsWith('@RSYNCD:')) {
        // Skip protocol lines
        continue;
      } else if (line.includes('\t')) {
        const tabIdx = line.indexOf('\t');
        const name = line.substring(0, tabIdx).trim();
        const description = line.substring(tabIdx + 1).trim();
        if (name) {
          modules.push({ name, description });
        }
      } else if (line.trim()) {
        // Lines without tabs before modules are MOTD
        if (modules.length === 0) {
          motd += (motd ? '\n' : '') + line;
        }
      }
    }

    const rtt = Date.now() - startTime;

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      connectTime,
      serverVersion,
      clientVersion,
      greeting,
      motd: motd || undefined,
      modules,
      moduleCount: modules.length,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

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

/**
 * Pure-TypeScript MD4 implementation (RFC 1320).
 *
 * Used for rsync challenge-response authentication. The rsync daemon uses
 * MD4(concat("\0", password, challenge)) to derive the auth token.
 * MD4 is not available in the Web Crypto API, so it is implemented here.
 */
function md4(input: Uint8Array): Uint8Array {
  function rotl(x: number, n: number): number {
    return ((x << n) | (x >>> (32 - n))) >>> 0;
  }

  function F(x: number, y: number, z: number): number { return ((x & y) | (~x & z)) >>> 0; }
  function G(x: number, y: number, z: number): number { return ((x & y) | (x & z) | (y & z)) >>> 0; }
  function H(x: number, y: number, z: number): number { return (x ^ y ^ z) >>> 0; }

  const msg = [...input, 0x80];
  while (msg.length % 64 !== 56) msg.push(0);
  const bitLen = input.length * 8;
  for (let i = 0; i < 8; i++) msg.push((bitLen / Math.pow(2, i * 8)) & 0xff);

  let A = 0x67452301, B = 0xefcdab89, C = 0x98badcfe, D = 0x10325476;

  for (let i = 0; i < msg.length; i += 64) {
    const X: number[] = [];
    for (let j = 0; j < 16; j++) {
      X[j] = (msg[i + j * 4] |
        (msg[i + j * 4 + 1] << 8) |
        (msg[i + j * 4 + 2] << 16) |
        (msg[i + j * 4 + 3] << 24)) >>> 0;
    }

    let a = A, b = B, c = C, d = D;

    // Round 1
    for (const [k, s] of [[0,3],[1,7],[2,11],[3,19],[4,3],[5,7],[6,11],[7,19],[8,3],[9,7],[10,11],[11,19],[12,3],[13,7],[14,11],[15,19]] as [number,number][]) {
      a = rotl((a + F(b, c, d) + X[k]) >>> 0, s);
      [a, b, c, d] = [d, a, b, c];
    }

    // Round 2
    for (const [k, s] of [[0,3],[4,5],[8,9],[12,13],[1,3],[5,5],[9,9],[13,13],[2,3],[6,5],[10,9],[14,13],[3,3],[7,5],[11,9],[15,13]] as [number,number][]) {
      a = rotl((a + G(b, c, d) + X[k] + 0x5A827999) >>> 0, s);
      [a, b, c, d] = [d, a, b, c];
    }

    // Round 3
    for (const [k, s] of [[0,3],[8,9],[4,11],[12,15],[2,3],[10,9],[6,11],[14,15],[1,3],[9,9],[5,11],[13,15],[3,3],[11,9],[7,11],[15,15]] as [number,number][]) {
      a = rotl((a + H(b, c, d) + X[k] + 0x6ED9EBA1) >>> 0, s);
      [a, b, c, d] = [d, a, b, c];
    }

    A = (A + a) >>> 0;
    B = (B + b) >>> 0;
    C = (C + c) >>> 0;
    D = (D + d) >>> 0;
  }

  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, A, true);
  dv.setUint32(4, B, true);
  dv.setUint32(8, C, true);
  dv.setUint32(12, D, true);
  return out;
}

/**
 * Compute rsync challenge-response token.
 * Protocol: MD4("\0" + password + challenge)
 * The result is returned as lowercase hex.
 */
function rsyncChallengeResponse(password: string, challenge: string): string {
  const enc = new TextEncoder();
  const buf = new Uint8Array([0, ...enc.encode(password), ...enc.encode(challenge)]);
  const hash = md4(buf);
  return Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Authenticate to a specific rsync module and read file list preamble.
 *
 * Protocol flow:
 *   1. Read server banner  (@RSYNCD: <version>)
 *   2. Send client version (@RSYNCD: 30.0)
 *   3. Send module name
 *   4. If server responds with @RSYNCD: AUTHREQD <challenge>:
 *      a. Compute MD4("\0" + password + challenge) as hex
 *      b. Send "username hexhash\n"
 *      c. Read @RSYNCD: OK or @RSYNCD: EXIT (auth failure)
 *   5. Return { authenticated, challenge, module, username, fileCount?, rtt }
 */
export async function handleRsyncAuth(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
      module: string;
      username: string;
      password: string;
    };

    const { host, port = 873, timeout = 10000, module: moduleName, username, password } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!moduleName) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Module name is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!username || !password) {
      return new Response(JSON.stringify({
        success: false,
        error: 'username and password are required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    const decoder = new TextDecoder();

    // Helper: read the next line from the socket
    let lineBuffer = '';
    async function readLine(): Promise<string> {
      while (true) {
        const nl = lineBuffer.indexOf('\n');
        if (nl !== -1) {
          const line = lineBuffer.substring(0, nl);
          lineBuffer = lineBuffer.substring(nl + 1);
          return line;
        }
        const result = await Promise.race([reader.read(), timeoutPromise]);
        if (result.done || !result.value) throw new Error('Connection closed');
        lineBuffer += decoder.decode(result.value, { stream: true });
      }
    }

    try {
      // Step 1: Read server banner
      const banner = await readLine();
      let serverVersion = '';
      if (banner.startsWith('@RSYNCD:')) {
        serverVersion = banner.replace('@RSYNCD:', '').trim();
      } else {
        throw new Error(`Unexpected server greeting: ${banner.substring(0, 100)}`);
      }

      // Step 2: Send client version
      await writer.write(new TextEncoder().encode('@RSYNCD: 30.0\n'));

      // Step 3: Request module
      await writer.write(new TextEncoder().encode(`${moduleName}\n`));

      // Step 4: Read module response lines until we hit a decisive line
      let authenticated = false;
      let challenge = '';
      let authRequired = false;
      let errorMessage = '';
      const motdLines: string[] = [];

      // Drain MOTD / greeting lines until we see an @RSYNCD: directive
      outer: while (true) {
        const line = await readLine();
        if (line.startsWith('@RSYNCD: AUTHREQD')) {
          authRequired = true;
          // Extract challenge: "@RSYNCD: AUTHREQD <challenge>"
          const parts = line.split(' ');
          challenge = parts.length >= 3 ? parts.slice(2).join(' ').trim() : '';
          break;
        } else if (line.startsWith('@RSYNCD: OK')) {
          // Module accessible without auth — unusual but handle it
          authenticated = true;
          break outer;
        } else if (line.startsWith('@RSYNCD: EXIT')) {
          errorMessage = 'Server closed connection';
          break;
        } else if (line.startsWith('@ERROR')) {
          errorMessage = line.replace('@ERROR:', '').replace('@ERROR', '').trim();
          break;
        } else if (line.startsWith('@RSYNCD:')) {
          // Unknown directive — skip
          continue;
        } else {
          motdLines.push(line);
        }
      }

      if (authRequired && challenge) {
        // Step 4a: Compute response
        const responseHex = rsyncChallengeResponse(password, challenge);

        // Step 4b: Send credentials
        await writer.write(new TextEncoder().encode(`${username} ${responseHex}\n`));

        // Step 4c: Read outcome
        const authLine = await readLine();
        if (authLine.startsWith('@RSYNCD: OK')) {
          authenticated = true;
        } else if (authLine.startsWith('@RSYNCD: EXIT') || authLine.startsWith('@ERROR')) {
          authenticated = false;
          errorMessage = authLine.includes('@ERROR')
            ? authLine.replace('@ERROR:', '').replace('@ERROR', '').trim()
            : 'Authentication rejected by server';
        }
      }

      const rtt = Date.now() - startTime;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: authenticated,
        host,
        port,
        module: moduleName,
        username,
        serverVersion,
        authenticated,
        authRequired,
        challenge: challenge || undefined,
        motd: motdLines.length > 0 ? motdLines.join('\n') : undefined,
        error: errorMessage || undefined,
        rtt,
      }), {
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
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle rsync module info - connect to a specific module
 */
export async function handleRsyncModule(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      module: string;
      timeout?: number;
    };

    const { host, port = 873, module: moduleName, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!moduleName) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Module name is required',
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

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    const decoder = new TextDecoder();

    // Read server greeting
    const greetingResult = await Promise.race([reader.read(), timeoutPromise]);
    if (greetingResult.done || !greetingResult.value) {
      throw new Error('Server closed connection without greeting');
    }
    const greeting = decoder.decode(greetingResult.value).trim();

    let serverVersion = '';
    if (greeting.startsWith('@RSYNCD:')) {
      serverVersion = greeting.replace('@RSYNCD:', '').trim();
    } else {
      throw new Error(`Unexpected server greeting: ${greeting.substring(0, 100)}`);
    }

    // Send our protocol version
    await writer.write(new TextEncoder().encode(`@RSYNCD: 30.0\n`));

    // Request specific module
    await writer.write(new TextEncoder().encode(`${moduleName}\n`));

    // Read module response
    const lines = await readAllLines(reader, Math.min(timeout, 5000));

    const rtt = Date.now() - startTime;

    let authRequired = false;
    let moduleOk = false;
    let errorMessage = '';
    const responseLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('@RSYNCD: OK')) {
        moduleOk = true;
        break;
      } else if (line.startsWith('@RSYNCD: AUTHREQD')) {
        authRequired = true;
        break;
      } else if (line.startsWith('@RSYNCD: EXIT')) {
        break;
      } else if (line.startsWith('@ERROR')) {
        errorMessage = line.replace('@ERROR:', '').replace('@ERROR', '').trim();
        break;
      } else {
        responseLines.push(line);
      }
    }

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      module: moduleName,
      rtt,
      serverVersion,
      moduleOk,
      authRequired,
      error: errorMessage || undefined,
      response: responseLines.length > 0 ? responseLines.join('\n') : undefined,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

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
