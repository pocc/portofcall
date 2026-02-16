/**
 * ClamAV Daemon Protocol Support for Cloudflare Workers
 * ClamAV clamd TCP Protocol
 * Port: 3310
 *
 * ClamAV is an open-source antivirus engine. The clamd daemon listens
 * on TCP port 3310 and accepts simple text commands:
 *
 *   PING        - Check if daemon is alive (response: PONG)
 *   VERSION     - Get ClamAV version info
 *   STATS       - Get scanning statistics
 *   RELOAD      - Reload virus database
 *
 * Responses are null-byte (\0) terminated.
 * The "n" prefix variants (nPING, nVERSION, etc.) use newline termination.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/**
 * Read a null-terminated or newline-terminated response from clamd
 */
async function readClamdResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeout: number
): Promise<string> {
  const chunks: Uint8Array[] = [];

  const readPromise = (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done || !value) break;
        chunks.push(value);

        // Check for null terminator or newline indicating end of response
        for (const byte of value) {
          if (byte === 0 || byte === 0x0a) {
            return;
          }
        }

        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        if (totalLength > 65536) break; // Safety limit
      }
    } catch {
      // Connection closed
    }
  })();

  const timeoutPromise = new Promise<void>((resolve) =>
    setTimeout(resolve, Math.min(timeout, 10000))
  );

  await Promise.race([readPromise, timeoutPromise]);

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const buffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }

  // Strip null terminators and trim
  return new TextDecoder()
    .decode(buffer)
    .replace(/\0/g, '')
    .trim();
}

/**
 * Handle ClamAV PING - test if daemon is alive
 */
export async function handleClamAVPing(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = (await request.json()) as {
      host?: string;
      port?: number;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 3310;
    const timeout = body.timeout || 10000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if the target is behind Cloudflare
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

    const socket = connect(`${host}:${port}`);
    await socket.opened;

    const connectTime = Date.now() - startTime;

    // Send PING command (newline-terminated variant)
    const writer = socket.writable.getWriter();
    await writer.write(new TextEncoder().encode('nPING\n'));
    writer.releaseLock();

    // Read response
    const reader = socket.readable.getReader();
    const response = await readClamdResponse(reader, timeout);
    const totalTime = Date.now() - startTime;

    // Close socket
    try {
      reader.releaseLock();
      await socket.close();
    } catch {
      // Ignore close errors
    }

    const alive = response.toUpperCase().includes('PONG');

    return new Response(
      JSON.stringify({
        success: true,
        host,
        port,
        alive,
        response,
        connectTimeMs: connectTime,
        totalTimeMs: totalTime,
        protocol: 'ClamAV',
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'ClamAV connection failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle ClamAV VERSION - get version information
 */
export async function handleClamAVVersion(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = (await request.json()) as {
      host?: string;
      port?: number;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 3310;
    const timeout = body.timeout || 10000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

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

    const socket = connect(`${host}:${port}`);
    await socket.opened;

    // Send VERSION command
    const writer = socket.writable.getWriter();
    await writer.write(new TextEncoder().encode('nVERSION\n'));
    writer.releaseLock();

    // Read response
    const reader = socket.readable.getReader();
    const response = await readClamdResponse(reader, timeout);
    const totalTime = Date.now() - startTime;

    try {
      reader.releaseLock();
      await socket.close();
    } catch {
      // Ignore
    }

    // Parse version string (typically: "ClamAV 0.103.8/26958/Wed Jul 12 09:05:02 2023")
    let version = '';
    let dbVersion = '';
    let dbDate = '';

    const parts = response.split('/');
    if (parts.length >= 1) {
      version = parts[0].trim();
    }
    if (parts.length >= 2) {
      dbVersion = parts[1].trim();
    }
    if (parts.length >= 3) {
      dbDate = parts.slice(2).join('/').trim();
    }

    return new Response(
      JSON.stringify({
        success: true,
        host,
        port,
        raw: response,
        version,
        databaseVersion: dbVersion,
        databaseDate: dbDate,
        totalTimeMs: totalTime,
        protocol: 'ClamAV',
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'ClamAV version query failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle ClamAV STATS - get scanning statistics
 */
export async function handleClamAVStats(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = (await request.json()) as {
      host?: string;
      port?: number;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 3310;
    const timeout = body.timeout || 10000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

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

    const socket = connect(`${host}:${port}`);
    await socket.opened;

    // Send STATS command
    const writer = socket.writable.getWriter();
    await writer.write(new TextEncoder().encode('nSTATS\n'));
    writer.releaseLock();

    // Read response (STATS can return multi-line output)
    const reader = socket.readable.getReader();
    const chunks: Uint8Array[] = [];

    const readPromise = (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done || !value) break;
          chunks.push(value);

          // STATS response ends with "END\n" or null byte
          const text = new TextDecoder().decode(value);
          if (text.includes('END') || value.includes(0)) break;

          const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
          if (totalLength > 65536) break;
        }
      } catch {
        // Connection closed
      }
    })();

    const timeoutPromise = new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(timeout, 10000))
    );

    await Promise.race([readPromise, timeoutPromise]);

    const totalTime = Date.now() - startTime;

    try {
      reader.releaseLock();
      await socket.close();
    } catch {
      // Ignore
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const buffer = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }

    const statsText = new TextDecoder()
      .decode(buffer)
      .replace(/\0/g, '')
      .trim();

    // Parse key stats from the output
    const pools = statsText.match(/POOLS:\s*(\d+)/i)?.[1];
    const threads = statsText.match(/THREADS:\s*(\w[^\n]*)/i)?.[1]?.trim();
    const queue = statsText.match(/QUEUE:\s*(\d+)/i)?.[1];
    const memUsed = statsText.match(/MEMSTATS:.*?([\d.]+\s*[KMG]?B?)/i)?.[1];

    return new Response(
      JSON.stringify({
        success: true,
        host,
        port,
        stats: statsText,
        parsed: {
          pools: pools ? parseInt(pools) : undefined,
          threads,
          queueLength: queue ? parseInt(queue) : undefined,
          memoryUsed: memUsed,
        },
        totalTimeMs: totalTime,
        responseBytes: totalLength,
        protocol: 'ClamAV',
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'ClamAV stats query failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
