/**
 * Redis Sentinel Protocol Implementation
 *
 * Redis Sentinel provides high availability for Redis by monitoring master
 * and replica instances, performing automatic failover, and serving as a
 * configuration provider. It runs on port 26379 by default and uses the
 * same RESP (Redis Serialization Protocol) as Redis.
 *
 * Protocol Flow:
 * 1. Client connects → Sentinel accepts (no banner)
 * 2. Client sends RESP-encoded commands
 * 3. Sentinel responds with RESP-encoded data
 *
 * Key Sentinel Commands:
 * - PING: Health check (responds +PONG)
 * - SENTINEL masters: List all monitored masters
 * - SENTINEL master <name>: Get info about a specific master
 * - SENTINEL replicas <name>: List replicas of a master
 * - SENTINEL sentinels <name>: List other Sentinels for a master
 * - SENTINEL get-master-addr-by-name <name>: Get master address
 * - SENTINEL ckquorum <name>: Check quorum for failover
 * - INFO: Get Sentinel server info
 *
 * Use Cases:
 * - Redis high availability monitoring
 * - Automatic failover management
 * - Service discovery for Redis clusters
 * - Health checking Redis topology
 */

import { connect } from 'cloudflare:sockets';

// ─── RESP Protocol Helpers ───────────────────────────────────────────────

function encodeRESPArray(args: string[]): Uint8Array {
  let resp = `*${args.length}\r\n`;
  for (const arg of args) {
    const bytes = new TextEncoder().encode(arg);
    resp += `$${bytes.length}\r\n${arg}\r\n`;
  }
  return new TextEncoder().encode(resp);
}

async function readRESPFull(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Read timeout');

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Read timeout')), Math.min(remaining, 5000));
    });

    const { value, done } = await Promise.race([reader.read(), timeoutPromise]);

    if (done) {
      if (buffer.length > 0) return buffer;
      throw new Error('Connection closed by server');
    }

    if (value) {
      buffer += decoder.decode(value, { stream: true });

      // For simple responses (+OK, +PONG, -ERR, :integer)
      if (buffer.match(/^[+\-:].*\r\n/)) return buffer;

      // For bulk strings ($len\r\n...\r\n) — check if complete
      if (buffer.startsWith('$')) {
        const lenEnd = buffer.indexOf('\r\n');
        if (lenEnd !== -1) {
          const len = parseInt(buffer.substring(1, lenEnd));
          if (len === -1) return buffer; // null bulk string
          const dataStart = lenEnd + 2;
          if (buffer.length >= dataStart + len + 2) return buffer;
        }
      }

      // For arrays (*count\r\n...) — use heuristic: enough \r\n sequences
      if (buffer.startsWith('*')) {
        const countEnd = buffer.indexOf('\r\n');
        if (countEnd !== -1) {
          const count = parseInt(buffer.substring(1, countEnd));
          if (count <= 0) return buffer;
          // For SENTINEL responses, wait for enough data
          // Each array element has at least 2 \r\n (length line + data line)
          const lines = buffer.split('\r\n');
          // Rough check: for a flat array of count bulk strings, we need 1 + count*2 lines
          if (lines.length >= 1 + count * 2) return buffer;
          // For nested arrays (SENTINEL masters), need more lines — wait for more data
          // But also check if we've been waiting a while
          if (buffer.length > 4096) return buffer; // Return what we have for large responses
        }
      }
    }
  }
}

/**
 * Parse a RESP response into structured data.
 */
function parseRESP(raw: string): unknown {
  const lines = raw.split('\r\n');
  let idx = 0;

  function parse(): unknown {
    if (idx >= lines.length) return null;
    const line = lines[idx++];

    if (line.startsWith('+')) return line.substring(1);
    if (line.startsWith('-')) return { error: line.substring(1) };
    if (line.startsWith(':')) return parseInt(line.substring(1));

    if (line.startsWith('$')) {
      const len = parseInt(line.substring(1));
      if (len === -1) return null;
      const data = lines[idx++];
      return data;
    }

    if (line.startsWith('*')) {
      const count = parseInt(line.substring(1));
      if (count === -1) return null;
      const arr: unknown[] = [];
      for (let i = 0; i < count; i++) {
        arr.push(parse());
      }
      return arr;
    }

    return line;
  }

  return parse();
}

/**
 * Convert flat RESP array [key, value, key, value, ...] to object.
 */
function flatArrayToObject(arr: unknown[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (let i = 0; i < arr.length - 1; i += 2) {
    obj[String(arr[i])] = String(arr[i + 1]);
  }
  return obj;
}

// ─── Request/Response Types ──────────────────────────────────────────────

interface SentinelProbeRequest {
  host: string;
  port?: number;
  password?: string;
  timeout?: number;
}

interface SentinelProbeResponse {
  success: boolean;
  host: string;
  port: number;
  version?: string;
  sentinelInfo?: Record<string, string>;
  masters?: Array<Record<string, string>>;
  rtt?: number;
  error?: string;
}

interface SentinelQueryRequest {
  host: string;
  port?: number;
  password?: string;
  command: string;
  masterName?: string;
  timeout?: number;
}

interface SentinelQueryResponse {
  success: boolean;
  host: string;
  port: number;
  command: string;
  masterName?: string;
  result?: unknown;
  parsed?: Record<string, string> | Array<Record<string, string>>;
  transcript: string[];
  rtt?: number;
  error?: string;
}

// ─── Safe Commands ───────────────────────────────────────────────────────

const SAFE_COMMANDS = new Set([
  'ping',
  'info',
  'sentinel masters',
  'sentinel master',
  'sentinel replicas',
  'sentinel slaves',
  'sentinel sentinels',
  'sentinel get-master-addr-by-name',
  'sentinel ckquorum',
  'sentinel pending-scripts',
  'sentinel myid',
]);

const DEFAULT_PORT = 26379;

// ─── Handlers ────────────────────────────────────────────────────────────

export async function handleSentinelProbe(request: Request): Promise<Response> {
  const body = await request.json() as SentinelProbeRequest;
  const { host, port: rawPort, password, timeout: rawTimeout } = body;

  // Validation
  if (!host || !host.trim()) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Host is required',
    } satisfies Partial<SentinelProbeResponse>), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const port = rawPort || DEFAULT_PORT;
  const timeout = Math.min(rawTimeout || 10000, 30000);

  if (port < 1 || port > 65535) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Port must be between 1 and 65535',
    } satisfies Partial<SentinelProbeResponse>), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!/^[a-zA-Z0-9._:-]+$/.test(host)) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Invalid host format',
    } satisfies Partial<SentinelProbeResponse>), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);
    await socket.opened;

    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();

    try {
      // Authenticate if password provided
      if (password) {
        await writer.write(encodeRESPArray(['AUTH', password]));
        const authResp = await readRESPFull(reader, timeout);
        if (!authResp.startsWith('+OK')) {
          const parsed = parseRESP(authResp);
          const errMsg = parsed && typeof parsed === 'object' && 'error' in (parsed as Record<string, unknown>)
            ? (parsed as Record<string, string>).error
            : 'Authentication failed';
          throw new Error(errMsg);
        }
      }

      // PING
      await writer.write(encodeRESPArray(['PING']));
      const pingResp = await readRESPFull(reader, timeout);
      if (!pingResp.includes('PONG')) {
        throw new Error('PING failed: ' + pingResp.trim());
      }

      // INFO sentinel
      await writer.write(encodeRESPArray(['INFO', 'sentinel']));
      const infoResp = await readRESPFull(reader, timeout);

      const sentinelInfo: Record<string, string> = {};
      let version = 'Unknown';
      const infoData = parseRESP(infoResp);
      if (typeof infoData === 'string') {
        for (const line of infoData.split('\r\n')) {
          if (line.startsWith('#') || !line.includes(':')) continue;
          const [k, ...vParts] = line.split(':');
          sentinelInfo[k] = vParts.join(':');
        }
      }

      // Also get version from INFO server
      await writer.write(encodeRESPArray(['INFO', 'server']));
      const serverResp = await readRESPFull(reader, timeout);
      const serverData = parseRESP(serverResp);
      if (typeof serverData === 'string') {
        const vMatch = serverData.match(/redis_version:([^\r\n]+)/);
        if (vMatch) version = vMatch[1];
      }

      // SENTINEL masters
      await writer.write(encodeRESPArray(['SENTINEL', 'masters']));
      const mastersResp = await readRESPFull(reader, timeout);

      const mastersRaw = parseRESP(mastersResp);
      const masters: Array<Record<string, string>> = [];
      if (Array.isArray(mastersRaw)) {
        for (const entry of mastersRaw) {
          if (Array.isArray(entry)) {
            masters.push(flatArrayToObject(entry));
          }
        }
      }

      const rtt = Date.now() - startTime;

      await socket.close();

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        version,
        sentinelInfo,
        masters,
        rtt,
      } satisfies SentinelProbeResponse), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      try { await socket.close(); } catch {}
      throw err;
    }
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      host,
      port,
      error: err instanceof Error ? err.message : 'Failed to probe Sentinel',
    } satisfies SentinelProbeResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function handleSentinelQuery(request: Request): Promise<Response> {
  const body = await request.json() as SentinelQueryRequest;
  const { host, port: rawPort, password, command, masterName, timeout: rawTimeout } = body;

  // Validation
  if (!host || !host.trim()) {
    return new Response(JSON.stringify({
      success: false,
      transcript: [],
      error: 'Host is required',
    } satisfies Partial<SentinelQueryResponse>), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!command || !command.trim()) {
    return new Response(JSON.stringify({
      success: false,
      transcript: [],
      error: 'Command is required',
    } satisfies Partial<SentinelQueryResponse>), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const port = rawPort || DEFAULT_PORT;
  const timeout = Math.min(rawTimeout || 10000, 30000);

  if (port < 1 || port > 65535) {
    return new Response(JSON.stringify({
      success: false,
      transcript: [],
      error: 'Port must be between 1 and 65535',
    } satisfies Partial<SentinelQueryResponse>), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!/^[a-zA-Z0-9._:-]+$/.test(host)) {
    return new Response(JSON.stringify({
      success: false,
      transcript: [],
      error: 'Invalid host format',
    } satisfies Partial<SentinelQueryResponse>), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Build full command string and check safety
  const normalizedCmd = command.trim().toLowerCase();
  const fullCmd = masterName ? `${normalizedCmd} ${masterName}` : normalizedCmd;

  // Check if the base command (without master name) is safe
  const baseCmd = normalizedCmd;
  const isSafe = SAFE_COMMANDS.has(baseCmd) || SAFE_COMMANDS.has(fullCmd);

  if (!isSafe) {
    return new Response(JSON.stringify({
      success: false,
      transcript: [],
      error: `Command "${command}" is not allowed. Only read-only Sentinel commands are permitted.`,
    } satisfies Partial<SentinelQueryResponse>), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const transcript: string[] = [];

  try {
    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);
    await socket.opened;
    transcript.push(`Connected to ${host}:${port}`);

    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();

    try {
      // Authenticate if password provided
      if (password) {
        await writer.write(encodeRESPArray(['AUTH', password]));
        const authResp = await readRESPFull(reader, timeout);
        if (authResp.startsWith('+OK')) {
          transcript.push('AUTH: OK');
        } else {
          throw new Error('Authentication failed');
        }
      }

      // Build command array
      const cmdParts = command.trim().split(/\s+/);
      if (masterName && !fullCmd.includes(masterName.toLowerCase())) {
        cmdParts.push(masterName);
      }

      transcript.push(`> ${cmdParts.join(' ')}`);
      await writer.write(encodeRESPArray(cmdParts));
      const resp = await readRESPFull(reader, timeout);

      const result = parseRESP(resp);
      transcript.push(`< ${typeof result === 'string' ? result.substring(0, 200) : JSON.stringify(result).substring(0, 200)}`);

      // Try to structure the result
      let parsed: Record<string, string> | Array<Record<string, string>> | undefined;

      if (Array.isArray(result)) {
        // Check if it's a flat key-value array or array of arrays
        if (result.length > 0 && Array.isArray(result[0])) {
          // Array of arrays (e.g., SENTINEL masters, SENTINEL replicas)
          parsed = result.map((entry) =>
            Array.isArray(entry) ? flatArrayToObject(entry) : { value: String(entry) }
          );
        } else if (result.length > 0 && typeof result[0] === 'string') {
          // Flat key-value array (e.g., SENTINEL master <name>)
          parsed = flatArrayToObject(result);
        }
      } else if (typeof result === 'string' && result.includes(':')) {
        // INFO-style response
        const obj: Record<string, string> = {};
        for (const line of result.split('\r\n')) {
          if (line.startsWith('#') || !line.includes(':')) continue;
          const [k, ...vParts] = line.split(':');
          obj[k] = vParts.join(':');
        }
        if (Object.keys(obj).length > 0) parsed = obj;
      }

      const rtt = Date.now() - startTime;

      await socket.close();

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        command: cmdParts.join(' '),
        masterName,
        result,
        parsed,
        transcript,
        rtt,
      } satisfies SentinelQueryResponse), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      try { await socket.close(); } catch {}
      throw err;
    }
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      host,
      port,
      command,
      masterName,
      transcript,
      error: err instanceof Error ? err.message : 'Sentinel query failed',
    } satisfies SentinelQueryResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
