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
