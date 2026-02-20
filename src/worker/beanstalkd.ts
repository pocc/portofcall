/**
 * Beanstalkd Protocol Implementation
 *
 * Beanstalkd is a simple, fast work queue with a text-based protocol.
 * It's used for distributing time-consuming tasks among workers.
 *
 * Protocol: ASCII text commands terminated by \r\n
 * Default port: 11300
 *
 * Endpoints:
 *   /api/beanstalkd/connect    — stats probe (read-only)
 *   /api/beanstalkd/command    — execute whitelisted commands
 *   /api/beanstalkd/put        — enqueue a job into a tube
 *   /api/beanstalkd/reserve    — dequeue the next ready job
 *
 * Response formats handled:
 *   Single-line:  INSERTED <id>\r\n, USING <tube>\r\n, NOT_FOUND\r\n, etc.
 *   Multi-line:   OK <bytes>\r\n<data>\r\n          (stats, list-tubes)
 *                 RESERVED <id> <bytes>\r\n<data>\r\n (reserve)
 *                 FOUND <id> <bytes>\r\n<data>\r\n    (peek)
 *
 * Job lifecycle: ready -> reserved -> deleted
 *                          \-> released -> ready  (re-queue)
 *                          \-> buried             (held aside)
 *                delayed -> ready                 (after delay expires)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/**
 * Check if a response line indicates a multi-line body with a byte count.
 *
 * Beanstalkd has several response formats with trailing data:
 *   OK <bytes>\r\n<data>\r\n          — stats, list-tubes, etc.
 *   RESERVED <id> <bytes>\r\n<data>\r\n — reserve/reserve-with-timeout
 *   FOUND <id> <bytes>\r\n<data>\r\n   — peek, peek-ready, peek-delayed, peek-buried
 *
 * Returns the byte count if the header indicates a body, or -1 for single-line responses.
 */
function parseBodyByteCount(headerLine: string): number {
  if (headerLine.startsWith('OK ')) {
    return parseInt(headerLine.substring(3));
  }
  if (headerLine.startsWith('RESERVED ') || headerLine.startsWith('FOUND ')) {
    // "RESERVED <id> <bytes>" or "FOUND <id> <bytes>"
    const parts = headerLine.split(' ');
    if (parts.length >= 3) {
      return parseInt(parts[parts.length - 1]);
    }
  }
  return -1;
}

/**
 * Read a beanstalkd response.
 *
 * Responses are either:
 *   Single-line: "USING default\r\n", "INSERTED 42\r\n", "NOT_FOUND\r\n"
 *   Multi-line:  "OK <bytes>\r\n<data>\r\n"
 *                "RESERVED <id> <bytes>\r\n<data>\r\n"
 *                "FOUND <id> <bytes>\r\n<data>\r\n"
 *
 * The reader accumulates bytes until a complete response is detected.
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

    // Check for a complete response by decoding only the new chunk for a quick
    // terminator scan, then doing a single full decode only when needed.
    const tail = new TextDecoder().decode(result.value);
    if (!tail.includes('\r\n')) continue; // No line ending in this chunk yet

    // We have at least one \r\n somewhere — do a single full reassembly to parse
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    const text = new TextDecoder().decode(combined);

    const headerEnd = text.indexOf('\r\n');
    if (headerEnd === -1) continue; // No complete line yet

    const headerLine = text.substring(0, headerEnd);
    const byteCount = parseBodyByteCount(headerLine);

    if (byteCount >= 0) {
      // Multi-line response: header\r\n + <byteCount bytes of data> + \r\n
      if (totalBytes >= headerEnd + 2 + byteCount + 2) break;
    } else {
      // Single-line response — we have the first \r\n, that's enough
      break;
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
 * Parse a beanstalkd response into status line and body.
 *
 * Handles all multi-line formats:
 *   OK <bytes>\r\n<yaml data>\r\n     — stats, list-tubes, etc.
 *   FOUND <id> <bytes>\r\n<data>\r\n  — peek commands
 *   RESERVED <id> <bytes>\r\n<data>\r\n — reserve (handled separately)
 *
 * Single-line responses have no body: INSERTED, USING, NOT_FOUND, etc.
 */
function parseBeanstalkdResponse(raw: string): { status: string; body: string } {
  const headerEnd = raw.indexOf('\r\n');
  const headerLine = headerEnd !== -1 ? raw.substring(0, headerEnd) : raw;

  // Check if this is a response type that carries a body
  if (headerLine.startsWith('OK ') || headerLine.startsWith('FOUND ') || headerLine.startsWith('RESERVED ')) {
    if (headerEnd !== -1) {
      return {
        status: headerLine.split(' ')[0],
        body: raw.substring(headerEnd + 2).trim(),
      };
    }
  }

  return { status: headerLine, body: '' };
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

      const parsed = parseBeanstalkdResponse(rawResponse);

      // Parse key stats from the YAML body.
      // Beanstalkd stats YAML format: "---\nkey: value\nkey: value\n"
      // List YAML format: "---\n- item1\n- item2\n"
      const stats: Record<string, string> = {};
      if (parsed.body) {
        for (const line of parsed.body.split('\n')) {
          if (line === '---' || line.trim() === '') continue;
          const match = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
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

    // Whitelist non-destructive commands. Destructive commands (put, delete,
    // release, bury, kick, pause-tube, quit) are blocked. Commands like use,
    // watch, and ignore only affect per-connection state and are harmless since
    // the connection is closed immediately after the response.
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
      'watch',
      'ignore',
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

      const parsed = parseBeanstalkdResponse(rawResponse);

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      // For peek commands (FOUND <id> <bytes>\r\n<data>\r\n), extract the job ID
      const headerLine = rawResponse.split('\r\n')[0] || rawResponse;
      let jobId: number | undefined;
      if (headerLine.startsWith('FOUND ')) {
        const parts = headerLine.split(' ');
        jobId = parseInt(parts[1] || '0');
      }

      // Detect error responses that are technically "successful" TCP exchanges
      // but indicate protocol-level failures
      const errorStatuses = ['NOT_FOUND', 'BAD_FORMAT', 'UNKNOWN_COMMAND', 'OUT_OF_MEMORY', 'INTERNAL_ERROR', 'DRAINING', 'NOT_IGNORED'];
      const isProtocolError = errorStatuses.some(s => parsed.status.startsWith(s));

      return new Response(
        JSON.stringify({
          success: !isProtocolError,
          host,
          port,
          command,
          rtt,
          status: parsed.status,
          ...(jobId !== undefined && { jobId }),
          response: parsed.body || rawResponse,
          message: isProtocolError
            ? `Server returned: ${parsed.status}`
            : `Command executed in ${rtt}ms`,
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

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Per protocol: priority is 0..4294967295 (uint32), delay and ttr are integers >= 0
    if (priority < 0 || priority > 4294967295) {
      return new Response(
        JSON.stringify({ success: false, error: 'Priority must be 0-4294967295 (0 = most urgent)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (delay < 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Delay must be >= 0 seconds' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (ttr < 1) {
      return new Response(
        JSON.stringify({ success: false, error: 'TTR (time-to-run) must be >= 1 second' }),
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

    const enc = new TextEncoder();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);
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

        // Beanstalkd put format: "put <pri> <delay> <ttr> <bytes>\r\n<data>\r\n"
        const jobData = enc.encode(payload);
        await writer.write(enc.encode(`put ${priority} ${delay} ${ttr} ${jobData.length}\r\n`));
        await writer.write(jobData);
        await writer.write(enc.encode('\r\n'));
        const putResp = await readBeanstalkdResponse(reader, timeout);
        const rtt = Date.now() - startTime;

        const inserted = putResp.startsWith('INSERTED ');
        const buried = putResp.startsWith('BURIED');
        const idPart = putResp.split(/\s+/)[1];
        const jobId = (inserted || buried) && idPart ? parseInt(idPart) : undefined;

        // Per the protocol, BURIED means the server ran out of memory trying to
        // grow the priority queue. The job is stored but in the "buried" state --
        // it will NOT be processed until explicitly kicked. We report this as a
        // failure so callers know the job needs attention.
        return new Response(JSON.stringify({
          success: inserted,
          host, port, tube, rtt, jobId,
          status: putResp.split('\r\n')[0] || putResp,
          message: inserted
            ? `Job ${jobId} inserted into tube '${tube}'`
            : buried
              ? `Job ${jobId} buried — server out of memory (use 'kick' to recover)`
              : putResp,
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

    const enc = new TextEncoder();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        const startTime = Date.now();

        if (tube !== 'default') {
          // Watch the requested tube
          await writer.write(enc.encode(`watch ${tube}\r\n`));
          const watchResp = await readBeanstalkdResponse(reader, timeout);
          if (!watchResp.startsWith('WATCHING')) {
            return new Response(JSON.stringify({
              success: false, host, port, error: `WATCH failed: ${watchResp}`,
            }), { status: 500, headers: { 'Content-Type': 'application/json' } });
          }

          // Ignore the default tube so we only reserve from the requested tube.
          // New connections watch "default" automatically; without this, reserve
          // would pull jobs from both "default" and the requested tube.
          await writer.write(enc.encode('ignore default\r\n'));
          const ignoreResp = await readBeanstalkdResponse(reader, timeout);
          if (!ignoreResp.startsWith('WATCHING')) {
            return new Response(JSON.stringify({
              success: false, host, port, error: `IGNORE default failed: ${ignoreResp}`,
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
