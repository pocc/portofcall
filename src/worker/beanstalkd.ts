/**
 * Beanstalkd Protocol Implementation
 *
 * Beanstalkd is a simple, fast work queue with a text-based protocol.
 * It's used for distributing time-consuming tasks among workers.
 *
 * Protocol: ASCII text commands terminated by \r\n
 * Default port: 11300
 *
 * Key commands:
 *   stats\r\n                    - Server-wide statistics
 *   list-tubes\r\n               - List all tube names
 *   stats-tube <name>\r\n        - Statistics for a specific tube
 *   use <tube>\r\n               - Select a tube for producing
 *   peek-ready\r\n               - Peek at the next ready job
 *   peek-delayed\r\n             - Peek at the next delayed job
 *   peek-buried\r\n              - Peek at the next buried job
 *
 * Response format:
 *   OK <bytes>\r\n<data>\r\n     - Success with YAML body
 *   INSERTED <id>\r\n            - Job inserted
 *   NOT_FOUND\r\n                - No matching job
 *   USING <tube>\r\n             - Tube selected
 *
 * Security: Read-only operations only. No job put/delete/bury.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/**
 * Read a beanstalkd response.
 * Responses are either single-line (e.g. "USING default\r\n")
 * or multi-line with a byte count (e.g. "OK 256\r\n<yaml data>\r\n")
 */
async function readBeanstalkdResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const maxBytes = 64 * 1024; // 64KB limit
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    const timeoutPromise = new Promise<{ done: true; value: undefined }>((resolve) => {
      setTimeout(() => resolve({ done: true, value: undefined }), Math.min(remaining, 3000));
    });

    const result = await Promise.race([reader.read(), timeoutPromise]);
    if (result.done || !result.value) break;

    chunks.push(result.value);
    totalBytes += result.value.length;
    if (totalBytes >= maxBytes) break;

    // Check if we have a complete response
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    const text = new TextDecoder().decode(combined);

    // Single-line responses end with \r\n and don't start with OK
    if (!text.startsWith('OK ') && text.includes('\r\n')) break;

    // Multi-line OK response: "OK <bytes>\r\n<data>\r\n"
    if (text.startsWith('OK ')) {
      const headerEnd = text.indexOf('\r\n');
      if (headerEnd !== -1) {
        const byteCount = parseInt(text.substring(3, headerEnd));
        // header + \r\n + data + \r\n
        if (!isNaN(byteCount) && totalBytes >= headerEnd + 2 + byteCount + 2) break;
      }
    }
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(combined).trim();
}

/**
 * Parse a beanstalkd OK response into the YAML body
 */
function parseOKResponse(raw: string): { status: string; body: string } {
  if (raw.startsWith('OK ')) {
    const headerEnd = raw.indexOf('\r\n');
    if (headerEnd !== -1) {
      return {
        status: 'OK',
        body: raw.substring(headerEnd + 2).trim(),
      };
    }
  }
  return { status: raw.split('\r\n')[0] || raw, body: '' };
}

/**
 * Test beanstalkd connectivity via the stats command
 */
export async function handleBeanstalkdConnect(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
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
    const port = body.port || 11300;
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

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send stats command
      await writer.write(new TextEncoder().encode('stats\r\n'));

      const rawResponse = await readBeanstalkdResponse(reader, Math.min(timeout, 5000));
      const rtt = Date.now() - startTime;

      const parsed = parseOKResponse(rawResponse);

      // Parse key stats from the YAML body
      const stats: Record<string, string> = {};
      if (parsed.body) {
        for (const line of parsed.body.split('\n')) {
          const match = line.match(/^(\S+):\s*(.+)$/);
          if (match) {
            stats[match[1]] = match[2].trim();
          }
        }
      }

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          rtt,
          status: parsed.status,
          version: stats['version'] || null,
          currentJobsReady: stats['current-jobs-ready'] || null,
          currentJobsReserved: stats['current-jobs-reserved'] || null,
          currentJobsDelayed: stats['current-jobs-delayed'] || null,
          currentJobsBuried: stats['current-jobs-buried'] || null,
          totalJobs: stats['total-jobs'] || null,
          currentTubes: stats['current-tubes'] || null,
          currentConnections: stats['current-connections'] || null,
          uptime: stats['uptime'] || null,
          pid: stats['pid'] || null,
          rawStats: parsed.body || rawResponse,
          protocol: 'Beanstalkd',
          message: `Beanstalkd connected in ${rtt}ms`,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Beanstalkd connection failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Execute a beanstalkd command (read-only commands only)
 */
export async function handleBeanstalkdCommand(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as {
      host?: string;
      port?: number;
      command?: string;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!body.command) {
      return new Response(
        JSON.stringify({ success: false, error: 'Command is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 11300;
    const command = body.command.trim();
    const timeout = body.timeout || 10000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Whitelist read-only commands to prevent destructive operations
    const allowedCommands = [
      'stats',
      'list-tubes',
      'list-tubes-watched',
      'list-tube-used',
      'stats-tube',
      'stats-job',
      'peek-ready',
      'peek-delayed',
      'peek-buried',
      'peek',
      'use',
    ];

    const cmdName = command.split(/\s+/)[0].toLowerCase();
    if (!allowedCommands.includes(cmdName)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Command "${cmdName}" is not allowed. Allowed read-only commands: ${allowedCommands.join(', ')}`,
        }),
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

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      await writer.write(new TextEncoder().encode(`${command}\r\n`));

      const rawResponse = await readBeanstalkdResponse(reader, Math.min(timeout, 5000));
      const rtt = Date.now() - startTime;

      const parsed = parseOKResponse(rawResponse);

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          command,
          rtt,
          status: parsed.status,
          response: parsed.body || rawResponse,
          message: `Command executed in ${rtt}ms`,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Beanstalkd command failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
