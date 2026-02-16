/**
 * LPD (Line Printer Daemon) Protocol Support for Cloudflare Workers
 * RFC 1179 - Line Printer Daemon Protocol
 * Port: 515
 *
 * LPD is a classic TCP protocol for submitting print jobs and querying
 * printer queue status. Commands are single-byte opcodes followed by
 * an operand string and a newline character.
 *
 * Command bytes:
 *   \x01 - Print any waiting jobs (daemon command)
 *   \x02 - Receive a printer job
 *   \x03 - Send queue state (short format)
 *   \x04 - Send queue state (long format)
 *   \x05 - Remove jobs
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/**
 * Handle LPD probe - test connectivity and retrieve short queue state
 */
export async function handleLPDProbe(request: Request): Promise<Response> {
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
      printer?: string;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 515;
    const printer = body.printer || 'lp';
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

    // Connect to LPD server
    const socket = connect(`${host}:${port}`);
    await socket.opened;

    const connectTime = Date.now() - startTime;

    // Send short queue state command: \x03<printer>\n
    // Command 0x03 = "Send queue state (short)"
    const command = `\x03${printer}\n`;
    const writer = socket.writable.getWriter();
    await writer.write(new TextEncoder().encode(command));
    writer.releaseLock();

    // Read response with timeout
    const reader = socket.readable.getReader();
    const responseChunks: Uint8Array[] = [];

    const readPromise = (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done || !value) break;
          responseChunks.push(value);
          // LPD responses are typically short, break after reasonable data
          const totalLength = responseChunks.reduce((sum, chunk) => sum + chunk.length, 0);
          if (totalLength > 4096) break;
        }
      } catch {
        // Connection closed by server - normal for LPD
      }
    })();

    const timeoutPromise = new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(timeout, 5000))
    );

    await Promise.race([readPromise, timeoutPromise]);

    const totalTime = Date.now() - startTime;

    // Close socket
    try {
      reader.releaseLock();
      await socket.close();
    } catch {
      // Ignore close errors
    }

    // Decode response
    const totalLength = responseChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const responseBuffer = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of responseChunks) {
      responseBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    const responseText = new TextDecoder().decode(responseBuffer).trim();

    return new Response(
      JSON.stringify({
        success: true,
        host,
        port,
        printer,
        connectTimeMs: connectTime,
        totalTimeMs: totalTime,
        queueState: responseText || '(empty response - server accepted connection)',
        responseBytes: totalLength,
        protocol: 'LPD',
        rfc: 'RFC 1179',
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'LPD connection failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle LPD queue listing - retrieve long-format queue state
 */
export async function handleLPDQueue(request: Request): Promise<Response> {
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
      printer?: string;
      users?: string[];
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 515;
    const printer = body.printer || 'lp';
    const users = body.users || [];
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

    // Connect to LPD server
    const socket = connect(`${host}:${port}`);
    await socket.opened;

    // Send long queue state command: \x04<printer> [user1 user2 ...]\n
    // Command 0x04 = "Send queue state (long)"
    let command = `\x04${printer}`;
    if (users.length > 0) {
      command += ` ${users.join(' ')}`;
    }
    command += '\n';

    const writer = socket.writable.getWriter();
    await writer.write(new TextEncoder().encode(command));
    writer.releaseLock();

    // Read response with timeout
    const reader = socket.readable.getReader();
    const responseChunks: Uint8Array[] = [];

    const readPromise = (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done || !value) break;
          responseChunks.push(value);
          const totalLength = responseChunks.reduce((sum, chunk) => sum + chunk.length, 0);
          if (totalLength > 16384) break;
        }
      } catch {
        // Connection closed by server - normal for LPD
      }
    })();

    const timeoutPromise = new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(timeout, 10000))
    );

    await Promise.race([readPromise, timeoutPromise]);

    const totalTime = Date.now() - startTime;

    // Close socket
    try {
      reader.releaseLock();
      await socket.close();
    } catch {
      // Ignore close errors
    }

    // Decode response
    const totalLength = responseChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const responseBuffer = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of responseChunks) {
      responseBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    const responseText = new TextDecoder().decode(responseBuffer).trim();

    // Parse queue entries from the response
    const lines = responseText.split('\n').filter((l) => l.trim().length > 0);
    const jobs: Array<{ rank?: string; owner?: string; jobId?: string; files?: string; size?: string; raw: string }> =
      [];

    for (const line of lines) {
      // Long-format LPD queue lines typically look like:
      // "1st  root  123  myfile.txt  1024 bytes"
      // or just header/status lines
      const match = line.match(
        /^\s*(\d+\w+|\w+)\s+(\S+)\s+(\d+)\s+(.+?)\s+(\d+\s*bytes?)\s*$/i
      );
      if (match) {
        jobs.push({
          rank: match[1],
          owner: match[2],
          jobId: match[3],
          files: match[4].trim(),
          size: match[5],
          raw: line,
        });
      } else {
        jobs.push({ raw: line });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        host,
        port,
        printer,
        totalTimeMs: totalTime,
        queueListing: responseText || '(empty queue)',
        jobs,
        jobCount: jobs.filter((j) => j.jobId).length,
        responseBytes: totalLength,
        format: 'long',
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'LPD queue listing failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
