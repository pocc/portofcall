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

/**
 * Handle Beanstalkd put — enqueue a job into a tube
 * POST /api/beanstalkd/put
 */
export async function handleBeanstalkdPut(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json() as {
      host: string; port?: number; tube?: string;
      payload: string; priority?: number; delay?: number; ttr?: number;
      timeout?: number;
    };
    const { host, port = 11300, tube = 'default', payload, timeout = 8000 } = body;
    const priority = body.priority ?? 1024;
    const delay = body.delay ?? 0;
    const ttr = body.ttr ?? 60;

    if (!host || !payload) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required: host, payload' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const enc = new TextEncoder();
    const socket = connect(`${host}:${port}`);
    try {
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        const startTime = Date.now();

        if (tube !== 'default') {
          await writer.write(enc.encode(`use ${tube}\r\n`));
          const useResp = await readBeanstalkdResponse(reader, timeout);
          if (!useResp.startsWith(`USING ${tube}`)) {
            return new Response(JSON.stringify({
              success: false, host, port, error: `USE failed: ${useResp}`,
            }), { status: 500, headers: { 'Content-Type': 'application/json' } });
          }
        }

        const jobData = enc.encode(payload);
        await writer.write(enc.encode(`put ${priority} ${delay} ${ttr} ${jobData.length}\r\n`));
        await writer.write(jobData);
        await writer.write(enc.encode('\r\n'));
        const putResp = await readBeanstalkdResponse(reader, timeout);
        const rtt = Date.now() - startTime;

        const inserted = putResp.startsWith('INSERTED ');
        const buried = putResp.startsWith('BURIED ');
        const idPart = putResp.split(/\s+/)[1];
        const jobId = (inserted || buried) && idPart ? parseInt(idPart) : undefined;

        return new Response(JSON.stringify({
          success: inserted || buried,
          host, port, tube, rtt, jobId,
          status: putResp.split('\r\n')[0] || putResp,
          message: inserted
            ? `Job ${jobId} inserted into tube '${tube}'`
            : buried ? `Job ${jobId} buried (tube full)` : putResp,
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
      error: error instanceof Error ? error.message : 'Beanstalkd put failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle Beanstalkd reserve — dequeue the next ready job from a tube
 * POST /api/beanstalkd/reserve
 */
export async function handleBeanstalkdReserve(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json() as {
      host: string; port?: number; tube?: string;
      reserveTimeout?: number; timeout?: number;
    };
    const { host, port = 11300, tube = 'default', timeout = 12000 } = body;
    const reserveTimeout = body.reserveTimeout ?? 2;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required: host' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const enc = new TextEncoder();
    const socket = connect(`${host}:${port}`);
    try {
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        const startTime = Date.now();

        if (tube !== 'default') {
          await writer.write(enc.encode(`watch ${tube}\r\n`));
          const watchResp = await readBeanstalkdResponse(reader, timeout);
          if (!watchResp.startsWith('WATCHING')) {
            return new Response(JSON.stringify({
              success: false, host, port, error: `WATCH failed: ${watchResp}`,
            }), { status: 500, headers: { 'Content-Type': 'application/json' } });
          }
        }

        await writer.write(enc.encode(`reserve-with-timeout ${reserveTimeout}\r\n`));
        const resp = await readBeanstalkdResponse(reader, timeout);
        const rtt = Date.now() - startTime;

        if (resp.startsWith('TIMED_OUT')) {
          return new Response(JSON.stringify({
            success: true, host, port, tube, rtt,
            status: 'TIMED_OUT', message: 'No jobs ready in tube within timeout',
          }), { headers: { 'Content-Type': 'application/json' } });
        }

        if (resp.startsWith('RESERVED ')) {
          const headerEnd = resp.indexOf('\r\n');
          const header = headerEnd >= 0 ? resp.substring(0, headerEnd) : resp;
          const parts = header.split(' ');
          const jobId = parseInt(parts[1] || '0');
          const jobBytes = parseInt(parts[2] || '0');
          const jobData = headerEnd >= 0 ? resp.substring(headerEnd + 2).trim() : '';
          return new Response(JSON.stringify({
            success: true, host, port, tube, rtt,
            status: 'RESERVED', jobId, jobBytes,
            payload: jobData,
            message: `Reserved job ${jobId} (${jobBytes} bytes) from tube '${tube}'`,
          }), { headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({
          success: false, host, port, tube, rtt,
          status: resp, message: `Unexpected response: ${resp}`,
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
      error: error instanceof Error ? error.message : 'Beanstalkd reserve failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
