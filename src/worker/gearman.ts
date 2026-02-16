/**
 * Gearman Protocol Implementation
 *
 * Gearman is a distributed job queue system with a text-based admin protocol.
 * It distributes work across machines, allowing applications to perform tasks
 * in parallel, load balance processing, and call functions between languages.
 *
 * Protocol: ASCII text commands terminated by \n
 * Default port: 4730
 *
 * Admin commands:
 *   version\n                - Server version string
 *   status\n                 - Tab-delimited: FUNCTION\tTOTAL\tRUNNING\tAVAILABLE_WORKERS
 *   workers\n                - Connected worker info: FD IP CLIENT-ID : FUNCTION ...
 *   maxqueue FUNC [MAX]\n   - Show/set max queue size for a function
 *   shutdown\n               - Graceful server shutdown (BLOCKED)
 *   shutdown graceful\n      - Graceful server shutdown (BLOCKED)
 *
 * Response format:
 *   version: single line "X.Y\n"
 *   status/workers: multi-line, terminated by ".\n"
 *   maxqueue: "OK\n"
 *
 * Security: Read-only operations only. No shutdown or job submission.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/**
 * Read a Gearman admin response.
 * - `version` returns a single line ending with \n
 * - `status` and `workers` return multiple lines terminated by ".\n"
 */
async function readGearmanResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  multiLine: boolean
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

    // Combine chunks to check for response completion
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    const text = new TextDecoder().decode(combined);

    if (multiLine) {
      // Multi-line responses (status, workers) end with ".\n"
      if (text.endsWith('.\n') || text.endsWith('\n.\n')) break;
    } else {
      // Single-line responses (version, maxqueue OK) end with \n
      if (text.includes('\n')) break;
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
 * Commands that return multi-line responses terminated by ".\n"
 */
const MULTILINE_COMMANDS = ['status', 'workers'];

/**
 * Test Gearman connectivity via version and status commands
 */
export async function handleGearmanConnect(request: Request): Promise<Response> {
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
    const port = body.port || 4730;
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

      // Get version
      await writer.write(new TextEncoder().encode('version\n'));
      const versionResponse = await readGearmanResponse(reader, Math.min(timeout, 5000), false);
      const rtt = Date.now() - startTime;

      // Get status (function queue info)
      await writer.write(new TextEncoder().encode('status\n'));
      const statusResponse = await readGearmanResponse(reader, Math.min(timeout, 5000), true);

      // Parse status lines: FUNCTION\tTOTAL\tRUNNING\tAVAILABLE_WORKERS
      const functions: Array<{
        name: string;
        total: number;
        running: number;
        availableWorkers: number;
      }> = [];

      if (statusResponse && statusResponse !== '.') {
        for (const line of statusResponse.split('\n')) {
          if (line === '.' || line.trim() === '') continue;
          const parts = line.split('\t');
          if (parts.length >= 4) {
            functions.push({
              name: parts[0],
              total: parseInt(parts[1]) || 0,
              running: parseInt(parts[2]) || 0,
              availableWorkers: parseInt(parts[3]) || 0,
            });
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
          version: versionResponse || null,
          functions,
          totalFunctions: functions.length,
          totalQueuedJobs: functions.reduce((sum, f) => sum + f.total, 0),
          totalRunningJobs: functions.reduce((sum, f) => sum + f.running, 0),
          totalWorkers: functions.reduce((sum, f) => sum + f.availableWorkers, 0),
          rawStatus: statusResponse || null,
          protocol: 'Gearman',
          message: `Gearman connected in ${rtt}ms`,
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
        error: error instanceof Error ? error.message : 'Gearman connection failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Execute a Gearman admin command (read-only commands only)
 */
export async function handleGearmanCommand(request: Request): Promise<Response> {
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
    const port = body.port || 4730;
    const command = body.command.trim();
    const timeout = body.timeout || 10000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Whitelist read-only commands
    const allowedCommands = ['version', 'status', 'workers', 'maxqueue'];

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

      const isMultiLine = MULTILINE_COMMANDS.includes(cmdName);
      await writer.write(new TextEncoder().encode(`${command}\n`));

      const rawResponse = await readGearmanResponse(reader, Math.min(timeout, 5000), isMultiLine);
      const rtt = Date.now() - startTime;

      // Strip trailing "." from multi-line responses
      let cleanResponse = rawResponse;
      if (isMultiLine && cleanResponse.endsWith('\n.')) {
        cleanResponse = cleanResponse.slice(0, -2);
      } else if (isMultiLine && cleanResponse === '.') {
        cleanResponse = '(empty)';
      }

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
          response: cleanResponse,
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
        error: error instanceof Error ? error.message : 'Gearman command failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
