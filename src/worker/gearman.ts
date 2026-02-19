/**
 * Gearman Protocol Implementation
 *
 * Gearman is a distributed job queue system that uses:
 *   1. A text-based admin protocol for monitoring/management
 *   2. A binary protocol for job submission and worker communication
 *
 * Default port: 4730
 *
 * Text Admin Protocol:
 *   Commands are ASCII text terminated by \n
 *   version\n                - Server version string (single-line response)
 *   status\n                 - Tab-delimited: FUNCTION\tTOTAL\tRUNNING\tAVAILABLE_WORKERS
 *   workers\n                - Connected worker info: FD IP CLIENT-ID : FUNCTION ...
 *   maxqueue FUNC [MAX]\n   - Query (1 arg) or set (2 args) max queue size for a function
 *   shutdown\n               - Graceful server shutdown (BLOCKED in this implementation)
 *   shutdown graceful\n      - Graceful server shutdown (BLOCKED in this implementation)
 *
 *   Response format:
 *     version: single line "X.Y\n"
 *     status/workers: multi-line, terminated by ".\n"
 *     maxqueue: "OK\n"
 *
 * Binary Protocol:
 *   Header: 12 bytes
 *     Bytes 0-3:  Magic code (\0REQ for requests, \0RES for responses)
 *     Bytes 4-7:  Packet type (uint32 big-endian)
 *     Bytes 8-11: Data length (uint32 big-endian, does NOT include the 12-byte header)
 *   Data: variable length, fields separated by NULL bytes (\0)
 *
 *   Key packet types (client-relevant):
 *     SUBMIT_JOB        = 7  (REQ: functionName\0uniqueId\0payload)
 *     JOB_CREATED       = 8  (RES: jobHandle)
 *     SUBMIT_JOB_BG     = 18 (REQ: functionName\0uniqueId\0payload)
 *     WORK_DATA         = 28 (RES: jobHandle\0data)
 *     WORK_WARNING      = 29 (RES: jobHandle\0warning)
 *     WORK_STATUS       = 12 (RES: jobHandle\0numerator\0denominator)
 *     WORK_COMPLETE     = 13 (RES: jobHandle\0data)
 *     WORK_FAIL         = 14 (RES: jobHandle)
 *     WORK_EXCEPTION    = 25 (RES: jobHandle\0data)
 *     ERROR             = 19 (RES: errorCode\0errorText)
 *
 * Security: Read-only admin commands only. No shutdown.
 *   maxqueue with a second argument is blocked to prevent mutation.
 *   Job submission is via a separate endpoint.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// ── Binary protocol constants ──────────────────────────────────────────────

/** Magic bytes for client-to-server requests: \0REQ */
const MAGIC_REQ = new Uint8Array([0x00, 0x52, 0x45, 0x51]);

/** Magic bytes for server-to-client responses: \0RES */
const MAGIC_RES = new Uint8Array([0x00, 0x52, 0x45, 0x53]);

/** Binary protocol packet types */
const PacketType = {
  // Client requests
  SUBMIT_JOB: 7,
  SUBMIT_JOB_BG: 18,
  SUBMIT_JOB_HIGH: 21,
  SUBMIT_JOB_HIGH_BG: 32,
  SUBMIT_JOB_LOW: 33,
  SUBMIT_JOB_LOW_BG: 34,
  GET_STATUS: 15,

  // Server responses
  JOB_CREATED: 8,
  WORK_DATA: 28,
  WORK_WARNING: 29,
  WORK_STATUS: 12,
  WORK_COMPLETE: 13,
  WORK_FAIL: 14,
  WORK_EXCEPTION: 25,
  ERROR: 19,
  STATUS_RES: 20,
} as const;

/** Human-readable names for packet types */
const PACKET_TYPE_NAMES: Record<number, string> = {
  [PacketType.SUBMIT_JOB]: 'SUBMIT_JOB',
  [PacketType.SUBMIT_JOB_BG]: 'SUBMIT_JOB_BG',
  [PacketType.SUBMIT_JOB_HIGH]: 'SUBMIT_JOB_HIGH',
  [PacketType.SUBMIT_JOB_HIGH_BG]: 'SUBMIT_JOB_HIGH_BG',
  [PacketType.SUBMIT_JOB_LOW]: 'SUBMIT_JOB_LOW',
  [PacketType.SUBMIT_JOB_LOW_BG]: 'SUBMIT_JOB_LOW_BG',
  [PacketType.GET_STATUS]: 'GET_STATUS',
  [PacketType.JOB_CREATED]: 'JOB_CREATED',
  [PacketType.WORK_DATA]: 'WORK_DATA',
  [PacketType.WORK_WARNING]: 'WORK_WARNING',
  [PacketType.WORK_STATUS]: 'WORK_STATUS',
  [PacketType.WORK_COMPLETE]: 'WORK_COMPLETE',
  [PacketType.WORK_FAIL]: 'WORK_FAIL',
  [PacketType.WORK_EXCEPTION]: 'WORK_EXCEPTION',
  [PacketType.ERROR]: 'ERROR',
  [PacketType.STATUS_RES]: 'STATUS_RES',
};

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Validate that 4 bytes match the expected \0RES magic.
 */
function isValidResponseMagic(buf: Uint8Array): boolean {
  return (
    buf[0] === MAGIC_RES[0] &&
    buf[1] === MAGIC_RES[1] &&
    buf[2] === MAGIC_RES[2] &&
    buf[3] === MAGIC_RES[3]
  );
}

/**
 * Build a binary protocol request packet.
 *
 * Header (12 bytes): \0REQ + type (uint32 BE) + dataLen (uint32 BE)
 * Data: concatenated fields separated by NULL bytes.
 */
function buildRequestPacket(type: number, fields: Uint8Array[]): Uint8Array {
  // Calculate total data length: sum of field lengths + (fields.length - 1) null separators
  let dataLen = 0;
  for (const f of fields) dataLen += f.length;
  if (fields.length > 1) dataLen += fields.length - 1; // null separators between fields

  const packet = new Uint8Array(12 + dataLen);
  const view = new DataView(packet.buffer);

  // Magic: \0REQ
  packet.set(MAGIC_REQ, 0);
  view.setUint32(4, type, false);  // big-endian
  view.setUint32(8, dataLen, false); // big-endian

  let offset = 12;
  for (let i = 0; i < fields.length; i++) {
    packet.set(fields[i], offset);
    offset += fields[i].length;
    if (i < fields.length - 1) {
      packet[offset++] = 0x00; // null separator
    }
  }

  return packet;
}

/**
 * Read a single binary protocol response packet from the stream.
 * Returns parsed packet type, data bytes, and any extra bytes read past the packet.
 */
async function readBinaryPacket(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  deadlineMs: number,
  prefetchedBytes?: Uint8Array | null
): Promise<{
  type: number;
  typeName: string;
  data: Uint8Array;
  extra: Uint8Array | null;
} | null> {
  // Phase 1: Read header (12 bytes)
  const headerChunks: Uint8Array[] = [];
  let headerTotal = 0;

  if (prefetchedBytes && prefetchedBytes.length > 0) {
    headerChunks.push(prefetchedBytes);
    headerTotal = prefetchedBytes.length;
  }

  while (headerTotal < 12) {
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) return null;

    const timeoutPromise = new Promise<{ done: true; value: undefined }>((resolve) => {
      setTimeout(() => resolve({ done: true, value: undefined }), Math.min(remaining, 3000));
    });

    const result = await Promise.race([reader.read(), timeoutPromise]);
    if (result.done || !result.value) return null;

    headerChunks.push(result.value);
    headerTotal += result.value.length;
  }

  // Combine all header chunks
  const headerBuf = new Uint8Array(headerTotal);
  let hOff = 0;
  for (const c of headerChunks) {
    headerBuf.set(c, hOff);
    hOff += c.length;
  }

  // Validate magic
  if (!isValidResponseMagic(headerBuf)) {
    const magicHex = Array.from(headerBuf.slice(0, 4))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
    throw new Error(
      `Invalid Gearman response magic: got [${magicHex}], expected [00 52 45 53] (\\0RES)`
    );
  }

  const headerView = new DataView(headerBuf.buffer, headerBuf.byteOffset, headerBuf.byteLength);
  const packetType = headerView.getUint32(4, false);
  const dataSize = headerView.getUint32(8, false);

  // Safety: reject absurdly large packets (>16 MB)
  if (dataSize > 16 * 1024 * 1024) {
    throw new Error(`Gearman response data size too large: ${dataSize} bytes`);
  }

  // We may have read more than 12 bytes in the header phase
  const extraFromHeader = headerTotal > 12 ? headerBuf.slice(12) : null;

  // Phase 2: Read data bytes
  const dataChunks: Uint8Array[] = [];
  let dataTotal = 0;

  if (extraFromHeader && extraFromHeader.length > 0) {
    dataChunks.push(extraFromHeader);
    dataTotal = extraFromHeader.length;
  }

  while (dataTotal < dataSize) {
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) return null;

    const timeoutPromise = new Promise<{ done: true; value: undefined }>((resolve) => {
      setTimeout(() => resolve({ done: true, value: undefined }), Math.min(remaining, 3000));
    });

    const result = await Promise.race([reader.read(), timeoutPromise]);
    if (result.done || !result.value) return null;

    dataChunks.push(result.value);
    dataTotal += result.value.length;
  }

  const dataBuf = new Uint8Array(dataTotal);
  let dOff = 0;
  for (const c of dataChunks) {
    dataBuf.set(c, dOff);
    dOff += c.length;
  }

  return {
    type: packetType,
    typeName: PACKET_TYPE_NAMES[packetType] || `UNKNOWN(${packetType})`,
    data: dataBuf.slice(0, dataSize),
    extra: dataTotal > dataSize ? dataBuf.slice(dataSize) : null,
  };
}

// ── Text Admin Protocol ────────────────────────────────────────────────────

/**
 * Read a Gearman admin (text protocol) response.
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

    const cmdParts = command.split(/\s+/);
    const cmdName = cmdParts[0].toLowerCase();
    if (!allowedCommands.includes(cmdName)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Command "${cmdName}" is not allowed. Allowed read-only commands: ${allowedCommands.join(', ')}`,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Block maxqueue with a MAX argument (that would mutate server state)
    // maxqueue FUNC       -> query (read-only, allowed)
    // maxqueue FUNC MAX   -> set (mutation, blocked)
    if (cmdName === 'maxqueue' && cmdParts.length > 2) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Setting maxqueue is not allowed (read-only mode). Use "maxqueue <function>" to query the current value.',
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

// ── Binary Protocol: Job Submission ────────────────────────────────────────

/**
 * Handle Gearman job submission using the binary protocol.
 * POST /api/gearman/submit
 *
 * For background jobs (SUBMIT_JOB_BG), returns after JOB_CREATED.
 * For foreground jobs (SUBMIT_JOB), waits for the terminal response
 * (WORK_COMPLETE, WORK_FAIL, or WORK_EXCEPTION) and returns the result.
 */
export async function handleGearmanSubmit(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json() as {
      host: string; port?: number;
      functionName: string;
      payload?: string;
      uniqueId?: string;
      priority?: 'normal' | 'high' | 'low';
      background?: boolean;
      timeout?: number;
    };
    const {
      host, port = 4730, functionName, payload = '', uniqueId = '',
      priority = 'normal', background = false, timeout = 8000,
    } = body;

    if (!host || !functionName) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required: host, functionName' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Determine packet type based on priority and background flags
    let jobType: number;
    if (background) {
      switch (priority) {
        case 'high': jobType = PacketType.SUBMIT_JOB_HIGH_BG; break;
        case 'low':  jobType = PacketType.SUBMIT_JOB_LOW_BG; break;
        default:     jobType = PacketType.SUBMIT_JOB_BG; break;
      }
    } else {
      switch (priority) {
        case 'high': jobType = PacketType.SUBMIT_JOB_HIGH; break;
        case 'low':  jobType = PacketType.SUBMIT_JOB_LOW; break;
        default:     jobType = PacketType.SUBMIT_JOB; break;
      }
    }

    const enc = new TextEncoder();
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

    const socket = connect(`${host}:${port}`);
    try {
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        const startTime = Date.now();
        const deadline = Date.now() + timeout;

        // Build and send SUBMIT_JOB packet
        // Data format: functionName\0uniqueId\0payload
        const packet = buildRequestPacket(jobType, [
          enc.encode(functionName),
          enc.encode(uniqueId),
          enc.encode(payload),
        ]);

        await writer.write(packet);

        // Read JOB_CREATED response
        const createdPacket = await readBinaryPacket(reader, deadline);
        if (!createdPacket) {
          return new Response(JSON.stringify({
            success: false, host, port,
            error: 'Timeout or incomplete response waiting for JOB_CREATED',
          }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }

        // Handle ERROR response
        if (createdPacket.type === PacketType.ERROR) {
          const errorStr = new TextDecoder().decode(createdPacket.data);
          const nullIdx = errorStr.indexOf('\0');
          const errorCode = nullIdx >= 0 ? errorStr.slice(0, nullIdx) : errorStr;
          const errorText = nullIdx >= 0 ? errorStr.slice(nullIdx + 1) : '';
          const rtt = Date.now() - startTime;
          return new Response(JSON.stringify({
            success: false, host, port, rtt,
            functionName, background,
            responseType: createdPacket.type,
            responseTypeName: createdPacket.typeName,
            error: `Gearman ERROR: ${errorCode} - ${errorText}`,
          }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }

        // Expect JOB_CREATED
        if (createdPacket.type !== PacketType.JOB_CREATED) {
          const rtt = Date.now() - startTime;
          const dataStr = new TextDecoder().decode(createdPacket.data);
          return new Response(JSON.stringify({
            success: false, host, port, rtt,
            functionName, background,
            responseType: createdPacket.type,
            responseTypeName: createdPacket.typeName,
            error: `Expected JOB_CREATED (8), got ${createdPacket.typeName}: ${dataStr}`,
          }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }

        const jobHandle = new TextDecoder().decode(createdPacket.data);

        // For background jobs, we're done after JOB_CREATED
        if (background) {
          const rtt = Date.now() - startTime;
          return new Response(JSON.stringify({
            success: true,
            host, port, rtt,
            functionName, background,
            priority,
            responseType: createdPacket.type,
            responseTypeName: createdPacket.typeName,
            jobHandle,
            message: `Background job submitted, handle: ${jobHandle}`,
          }), { headers: { 'Content-Type': 'application/json' } });
        }

        // For foreground jobs, wait for terminal response (WORK_COMPLETE, WORK_FAIL, WORK_EXCEPTION)
        const workDataChunks: string[] = [];
        const workWarnings: string[] = [];
        let lastStatus: { numerator: string; denominator: string } | null = null;
        let extraBytes = createdPacket.extra;

        while (true) {
          const pkt = await readBinaryPacket(reader, deadline, extraBytes);
          extraBytes = null; // Only use prefetched bytes for the first iteration
          if (!pkt) {
            // Timeout waiting for work result
            const rtt = Date.now() - startTime;
            return new Response(JSON.stringify({
              success: false, host, port, rtt,
              functionName, background,
              jobHandle,
              workData: workDataChunks.length > 0 ? workDataChunks.join('') : undefined,
              workWarnings: workWarnings.length > 0 ? workWarnings : undefined,
              lastStatus,
              error: 'Timeout waiting for job result',
            }), { status: 500, headers: { 'Content-Type': 'application/json' } });
          }

          extraBytes = pkt.extra;

          const pktData = new TextDecoder().decode(pkt.data);
          // Data fields are: jobHandle\0data (for most work packets)
          const nullIdx = pktData.indexOf('\0');
          const pktPayload = nullIdx >= 0 ? pktData.slice(nullIdx + 1) : '';

          switch (pkt.type) {
            case PacketType.WORK_DATA:
              workDataChunks.push(pktPayload);
              break;

            case PacketType.WORK_WARNING:
              workWarnings.push(pktPayload);
              break;

            case PacketType.WORK_STATUS: {
              // jobHandle\0numerator\0denominator
              const parts = pktData.split('\0');
              if (parts.length >= 3) {
                lastStatus = { numerator: parts[1], denominator: parts[2] };
              }
              break;
            }

            case PacketType.WORK_COMPLETE: {
              const rtt = Date.now() - startTime;
              return new Response(JSON.stringify({
                success: true,
                host, port, rtt,
                functionName, background,
                priority,
                responseType: pkt.type,
                responseTypeName: pkt.typeName,
                jobHandle,
                result: pktPayload,
                workData: workDataChunks.length > 0 ? workDataChunks.join('') : undefined,
                workWarnings: workWarnings.length > 0 ? workWarnings : undefined,
                lastStatus,
                message: `Job completed, handle: ${jobHandle}`,
              }), { headers: { 'Content-Type': 'application/json' } });
            }

            case PacketType.WORK_FAIL: {
              const rtt = Date.now() - startTime;
              return new Response(JSON.stringify({
                success: false,
                host, port, rtt,
                functionName, background,
                responseType: pkt.type,
                responseTypeName: pkt.typeName,
                jobHandle,
                workData: workDataChunks.length > 0 ? workDataChunks.join('') : undefined,
                workWarnings: workWarnings.length > 0 ? workWarnings : undefined,
                lastStatus,
                error: `Job failed (WORK_FAIL), handle: ${jobHandle}`,
              }), { status: 500, headers: { 'Content-Type': 'application/json' } });
            }

            case PacketType.WORK_EXCEPTION: {
              const rtt = Date.now() - startTime;
              return new Response(JSON.stringify({
                success: false,
                host, port, rtt,
                functionName, background,
                responseType: pkt.type,
                responseTypeName: pkt.typeName,
                jobHandle,
                exception: pktPayload,
                workData: workDataChunks.length > 0 ? workDataChunks.join('') : undefined,
                workWarnings: workWarnings.length > 0 ? workWarnings : undefined,
                lastStatus,
                error: `Job exception: ${pktPayload}`,
              }), { status: 500, headers: { 'Content-Type': 'application/json' } });
            }

            case PacketType.ERROR: {
              const rtt = Date.now() - startTime;
              const errNullIdx = pktData.indexOf('\0');
              const errorCode = errNullIdx >= 0 ? pktData.slice(0, errNullIdx) : pktData;
              const errorText = errNullIdx >= 0 ? pktData.slice(errNullIdx + 1) : '';
              return new Response(JSON.stringify({
                success: false, host, port, rtt,
                functionName, background,
                responseType: pkt.type,
                responseTypeName: pkt.typeName,
                jobHandle,
                error: `Gearman ERROR: ${errorCode} - ${errorText}`,
              }), { status: 500, headers: { 'Content-Type': 'application/json' } });
            }

            default:
              // Unknown or unexpected packet type -- skip and continue waiting
              break;
          }
        }
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
      error: error instanceof Error ? error.message : 'Gearman submit failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
