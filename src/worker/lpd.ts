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
 * Handle LPD print job submission (RFC 1179 Receive Job flow)
 */
export async function handleLPDPrint(request: Request): Promise<Response> {
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
      queue?: string;
      content?: string;
      jobName?: string;
      user?: string;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (!body.queue) {
      return new Response(
        JSON.stringify({ success: false, error: 'Queue is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (body.content === undefined || body.content === null) {
      return new Response(
        JSON.stringify({ success: false, error: 'Content is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 515;
    const timeout = body.timeout || 15000;
    const queue = body.queue;
    const content = body.content;
    const jobName = body.jobName || 'portofcall-job';
    const user = body.user || 'portofcall';

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
    const encoder = new TextEncoder();

    // Hostname to embed in file/job names (max 31 chars per RFC 1179)
    const localHostname = 'portofcall';

    // Data file name and control file name (RFC 1179 §7.2)
    // dfA{job_number}{hostname} for data, cfA{job_number}{hostname} for control
    const jobNumber = String(Math.floor(1 + Math.random() * 998)).padStart(3, '0');
    const dataFileName = `dfA${jobNumber}${localHostname}`;
    const ctrlFileName = `cfA${jobNumber}${localHostname}`;

    const dataBytes = encoder.encode(content);
    const dataSize = dataBytes.length;

    // Build control file content per RFC 1179 §7.2
    // H = hostname, P = username, N = job name, l = data file (raw/pass-through)
    const controlContent =
      `H${localHostname}\n` +
      `P${user}\n` +
      `N${jobName}\n` +
      `l${dataFileName}\n`;
    const controlBytes = encoder.encode(controlContent);
    const controlSize = controlBytes.length;

    // Helper: read one byte ack (0x00 = OK) from reader with timeout
    async function readAck(
      reader: ReadableStreamDefaultReader<Uint8Array>,
      timeoutMs: number
    ): Promise<number> {
      const deadline = new Promise<{ value: undefined; done: true }>((resolve) =>
        setTimeout(() => resolve({ value: undefined, done: true }), timeoutMs)
      );
      const result = await Promise.race([reader.read(), deadline]);
      if (result.done || !result.value || result.value.length === 0) return -1;
      return result.value[0];
    }

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // Step 1: Send "Receive Job" command: \x02{queue}\n
    await writer.write(encoder.encode(`\x02${queue}\n`));

    // Ack for Receive Job
    const receiveJobAck = await readAck(reader, 5000);
    const accepted = receiveJobAck === 0;

    let controlFileAck = -1;
    let dataFileAck = -1;
    // Generate a simple job ID for the response
    const jobId = `${jobNumber}`;

    if (accepted) {
      // Step 2: Send data file subcommand: \x03{size} {dataFileName}\n
      await writer.write(encoder.encode(`\x03${dataSize} ${dataFileName}\n`));

      // Ack for data file header
      const dataHeaderAck = await readAck(reader, 5000);

      if (dataHeaderAck === 0) {
        // Step 3: Send data file bytes followed by a null byte
        await writer.write(dataBytes);
        await writer.write(new Uint8Array([0x00]));

        dataFileAck = await readAck(reader, 5000);
      } else {
        dataFileAck = dataHeaderAck;
      }

      // Step 4: Send control file subcommand: \x02{size} {ctrlFileName}\n
      await writer.write(encoder.encode(`\x02${controlSize} ${ctrlFileName}\n`));

      // Ack for control file header
      const ctrlHeaderAck = await readAck(reader, 5000);

      if (ctrlHeaderAck === 0) {
        // Step 5: Send control file bytes followed by a null byte
        await writer.write(controlBytes);
        await writer.write(new Uint8Array([0x00]));

        controlFileAck = await readAck(reader, 5000);
      } else {
        controlFileAck = ctrlHeaderAck;
      }
    }

    const rtt = Date.now() - startTime;

    writer.releaseLock();
    reader.releaseLock();
    try { await socket.close(); } catch { /* ignore */ }

    return new Response(
      JSON.stringify({
        success: true,
        queue,
        jobId,
        accepted,
        controlFileAck,
        dataFileAck,
        rtt,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'LPD print failed',
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

/**
 * Handle LPD job removal (RFC 1179 Remove Jobs, command 0x05)
 *
 * The Remove Jobs command lets a client delete print jobs from a queue.
 * The agent (user/host) must match the job owner for removal to succeed.
 *
 * Command format: \x05<queue> <agent> [job-id ...]\n
 *   queue  — printer/queue name
 *   agent  — username that submitted the jobs (used for authorization)
 *   job-id — optional list of numeric job IDs; omit to remove all jobs for agent
 */
export async function handleLPDRemove(request: Request): Promise<Response> {
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
      queue?: string;
      agent?: string;
      jobIds?: (string | number)[];
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (!body.queue) {
      return new Response(
        JSON.stringify({ success: false, error: 'Queue is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 515;
    const timeout = body.timeout || 10000;
    const queue = body.queue;
    const agent = body.agent || 'root';
    const jobIds = (body.jobIds || []).map(String);

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

    // RFC 1179 §6.5: \x05<queue> <agent> [job-id ...]\n
    let command = `\x05${queue} ${agent}`;
    if (jobIds.length > 0) {
      command += ` ${jobIds.join(' ')}`;
    }
    command += '\n';

    const writer = socket.writable.getWriter();
    await writer.write(new TextEncoder().encode(command));
    writer.releaseLock();

    // LPD servers may respond with an acknowledgement byte (0x00 = success)
    // or close the connection immediately. Read what we can.
    const reader = socket.readable.getReader();
    const chunks: Uint8Array[] = [];

    const readPromise = (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done || !value) break;
          chunks.push(value);
          if (chunks.reduce((s, c) => s + c.length, 0) > 1024) break;
        }
      } catch { /* closed by server */ }
    })();

    await Promise.race([readPromise, new Promise<void>((r) => setTimeout(r, Math.min(timeout, 5000)))]);

    const rtt = Date.now() - startTime;

    try {
      reader.releaseLock();
      await socket.close();
    } catch { /* ignore */ }

    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    const responseBuffer = new Uint8Array(totalLen);
    let off = 0;
    for (const c of chunks) { responseBuffer.set(c, off); off += c.length; }

    const ackByte = totalLen > 0 ? responseBuffer[0] : -1;
    const responseText = new TextDecoder().decode(responseBuffer).trim();

    return new Response(
      JSON.stringify({
        success: true,
        host,
        port,
        queue,
        agent,
        jobIds,
        ackByte,
        accepted: ackByte === 0,
        response: responseText || undefined,
        rtt,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'LPD remove failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
