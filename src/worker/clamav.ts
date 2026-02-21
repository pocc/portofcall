/**
 * ClamAV Daemon Protocol Support for Cloudflare Workers
 * ClamAV clamd TCP Protocol — Default Port: 3310
 *
 * ClamAV is an open-source antivirus engine. The clamd daemon listens
 * on TCP port 3310 and accepts text commands in three formats:
 *
 *   Plain:    "COMMAND\n"   — newline-terminated, single command per connection
 *   n-prefix: "nCOMMAND\n"  — newline-delimited, supports session/keep-alive
 *   z-prefix: "zCOMMAND\0"  — null-delimited, supports session/keep-alive
 *
 * Supported commands:
 *   PING        — Response: "PONG"
 *   VERSION     — Response: "ClamAV <ver>/<db-ver>/<db-date>"
 *   STATS       — Response: multi-line daemon statistics, ending with "END"
 *   RELOAD      — Reload virus signature database
 *   SHUTDOWN    — Shut down the daemon
 *   INSTREAM    — Stream data for scanning using chunked protocol
 *
 * INSTREAM chunked protocol:
 *   1. Send command: "zINSTREAM\0" (or "INSTREAM\n")
 *   2. Send data in chunks: [4-byte big-endian length][data bytes]
 *   3. Terminate with a zero-length chunk: [0x00 0x00 0x00 0x00]
 *   4. Read response: "stream: OK\0" or "stream: <name> FOUND\0"
 *
 * This module uses n-prefix for simple commands and z-prefix for INSTREAM.
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

          // Check for null terminator in current chunk
          if (value.includes(0)) break;

          // STATS response ends with "END" on its own line.
          // Check accumulated text to handle "END" split across chunks,
          // and use a regex anchored to line start to avoid false positives
          // on words like "PENDING", "BACKEND", etc.
          const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
          if (totalLength > 65536) break;

          const accumulated = new Uint8Array(totalLength);
          let pos = 0;
          for (const c of chunks) {
            accumulated.set(c, pos);
            pos += c.length;
          }
          const text = new TextDecoder().decode(accumulated);
          if (/^END\s*$/m.test(text)) break;
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
          pools: pools ? parseInt(pools, 10) : undefined,
          threads,
          queueLength: queue ? parseInt(queue, 10) : undefined,
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

/**
 * Handle ClamAV INSTREAM scan — scan base64-encoded data for viruses
 * POST /api/clamav/scan
 */
export async function handleClamAVScan(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json() as {
      host: string; port?: number;
      data: string; // base64-encoded data to scan
      timeout?: number;
    };
    const { host, port = 3310, data, timeout = 15000 } = body;

    if (!host || !data) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required: host, data (base64)' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

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

    // Decode base64 data
    let scanData: Uint8Array;
    try {
      const binaryStr = atob(data);
      scanData = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        scanData[i] = binaryStr.charCodeAt(i);
      }
    } catch {
      return new Response(JSON.stringify({ success: false, error: 'Invalid base64 data' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (scanData.length > 10 * 1024 * 1024) {
      return new Response(JSON.stringify({ success: false, error: 'Data too large (max 10MB)' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const socket = connect(`${host}:${port}`);
    try {
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        const startTime = Date.now();

        // Send "zINSTREAM\0" command (z-prefix = null-terminated response)
        await writer.write(new TextEncoder().encode('zINSTREAM\x00'));

        // Send data as chunks: 4-byte big-endian size + data
        const CHUNK_SIZE = 65536;
        for (let i = 0; i < scanData.length; i += CHUNK_SIZE) {
          const chunk = scanData.slice(i, i + CHUNK_SIZE);
          const header = new Uint8Array(4);
          new DataView(header.buffer).setUint32(0, chunk.length, false);
          const chunkPacket = new Uint8Array(4 + chunk.length);
          chunkPacket.set(header, 0);
          chunkPacket.set(chunk, 4);
          await writer.write(chunkPacket);
        }

        // Terminate with 4 zero bytes
        await writer.write(new Uint8Array(4));

        // Read response
        const response = await readClamdResponse(reader, timeout);
        const rtt = Date.now() - startTime;

        // Parse: "stream: OK" / "stream: VIRUSNAME FOUND" / "stream: ERROR ..."
        const virusFound = response.includes('FOUND');
        const isError = response.includes('ERROR');
        let virusName: string | undefined;
        if (virusFound) {
          const match = response.match(/stream:\s+(.+)\s+FOUND/);
          virusName = match?.[1];
        }

        return new Response(JSON.stringify({
          success: !isError,
          host, port, rtt,
          clean: !virusFound && !isError,
          virusFound,
          virusName,
          response,
          dataSize: scanData.length,
          message: isError
            ? `Scan error: ${response}`
            : virusFound ? `Virus detected: ${virusName}` : 'No threats found',
        }), { headers: { 'Content-Type': 'application/json' } });
      } finally {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
      }
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'ClamAV scan failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
