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
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Read timeout');

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error('Read timeout')), remaining);
      });

      const { value, done } = await Promise.race([reader.read(), timeoutPromise]);

      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }

      if (done) {
        // Finalize decoder to flush any partial multi-byte sequences
        const final = decoder.decode(new Uint8Array(0), { stream: false });
        if (final) buffer += final;
        if (buffer.length > 0) return buffer;
        throw new Error('Connection closed by server');
      }

      if (value) {
        buffer += decoder.decode(value, { stream: true });

        // For simple responses (+OK, +PONG, -ERR, :integer)
        if (buffer.match(/^[+\-:].*\r\n/)) {
          // Finalize decoder
          buffer += decoder.decode(new Uint8Array(0), { stream: false });
          return buffer;
        }

        // For bulk strings ($len\r\n...\r\n) — check if complete
        if (buffer.startsWith('$')) {
          const lenEnd = buffer.indexOf('\r\n');
          if (lenEnd !== -1) {
            const len = parseInt(buffer.substring(1, lenEnd), 10);
            if (isNaN(len)) throw new Error('Invalid bulk string length');
            if (len === -1) {
              buffer += decoder.decode(new Uint8Array(0), { stream: false });
              return buffer;
            }
            const dataStart = lenEnd + 2;
            if (buffer.length >= dataStart + len + 2) {
              buffer += decoder.decode(new Uint8Array(0), { stream: false });
              return buffer;
            }
          }
        }

        // For arrays (*count\r\n...) — use heuristic: enough \r\n sequences
        if (buffer.startsWith('*')) {
          const countEnd = buffer.indexOf('\r\n');
          if (countEnd !== -1) {
            const count = parseInt(buffer.substring(1, countEnd), 10);
            if (isNaN(count)) throw new Error('Invalid array count');
            if (count <= 0) {
              buffer += decoder.decode(new Uint8Array(0), { stream: false });
              return buffer;
            }
            // For SENTINEL responses, wait for enough data
            // Each array element has at least 2 \r\n (length line + data line)
            const lines = buffer.split('\r\n');
            // Rough check: for a flat array of count bulk strings, we need 1 + count*2 lines
            // For nested arrays (SENTINEL masters), need more: 1 + count*(1+N*2) lines
            // Conservative check: wait for at least 1 + count*4 lines for nested arrays
            if (lines.length >= 1 + count * 4) {
              buffer += decoder.decode(new Uint8Array(0), { stream: false });
              return buffer;
            }
          }
        }
      }
    }
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
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

    if (!line || line.length === 0) return null;

    const type = line[0];
    if (!['+', '-', ':', '$', '*'].includes(type)) {
      throw new Error(`Invalid RESP type marker: ${type}`);
    }

    if (type === '+') return line.substring(1);
    if (type === '-') return { error: line.substring(1) };
    if (type === ':') {
      const num = parseInt(line.substring(1), 10);
      if (isNaN(num)) throw new Error('Invalid RESP integer');
      return num;
    }

    if (type === '$') {
      const len = parseInt(line.substring(1), 10);
      if (isNaN(len)) throw new Error('Invalid RESP bulk string length');
      if (len === -1) return null;
      const data = lines[idx++];
      return data;
    }

    if (type === '*') {
      const count = parseInt(line.substring(1), 10);
      if (isNaN(count)) throw new Error('Invalid RESP array count');
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
  // Warn if odd-length array (last element dropped)
  if (arr.length % 2 !== 0) {
    console.warn(`flatArrayToObject: odd-length array (${arr.length} elements), last element dropped:`, arr[arr.length - 1]);
  }
  return obj;
}

// ─── Additional Request/Response Types ───────────────────────────────────

interface SentinelGetRequest {
  host: string;
  port?: number;
  timeout?: number;
  masterName: string;
}

interface ReplicaInfo {
  ip: string;
  port: string;
  flags: string;
  lag: string;
  linkStatus: string;
}

interface SentinelInfo {
  ip: string;
  port: string;
  flags: string;
}

interface SentinelGetResponse {
  success: boolean;
  host: string;
  port: number;
  masterName: string;
  replicas?: ReplicaInfo[];
  sentinels?: SentinelInfo[];
  rtt?: number;
  error?: string;
}

interface SentinelGetMasterAddrRequest {
  host: string;
  port?: number;
  timeout?: number;
  masterName: string;
}

interface MasterAddr {
  ip: string;
  port: string;
}

interface SentinelGetMasterAddrResponse {
  success: boolean;
  host: string;
  port: number;
  masterName: string;
  masterAddr?: MasterAddr;
  quorumOk?: boolean;
  quorumMessage?: string;
  rtt?: number;
  error?: string;
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

  if (!/^[a-zA-Z0-9._:-]+$/.test(host)) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Invalid host format',
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
      host,
      port,
      error: 'Port must be between 1 and 65535',
    } satisfies Partial<SentinelProbeResponse>), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Cloudflare detection
  if (host.endsWith('.workers.dev') || host.includes('cloudflare')) {
    return new Response(JSON.stringify({
      success: false,
      host,
      port,
      error: 'Cannot connect to Cloudflare-protected hosts',
      isCloudflare: true,
    }), {
      status: 403,
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
      // Authenticate if password provided (check !== undefined to allow empty string)
      if (password !== undefined) {
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
    } finally {
      try { reader.releaseLock(); } catch { /* ignored */ }
      try { writer.releaseLock(); } catch { /* ignored */ }
      try { await socket.close(); } catch { /* ignored */ }
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
      host,
      port,
      transcript: [],
      error: 'Port must be between 1 and 65535',
    } satisfies Partial<SentinelQueryResponse>), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate masterName if provided
  if (masterName && !/^[a-zA-Z0-9_-]+$/.test(masterName)) {
    return new Response(JSON.stringify({
      success: false,
      host,
      port,
      transcript: [],
      error: 'Invalid masterName format (use alphanumeric, hyphen, underscore only)',
    } satisfies Partial<SentinelQueryResponse>), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Cloudflare detection
  if (host.endsWith('.workers.dev') || host.includes('cloudflare')) {
    return new Response(JSON.stringify({
      success: false,
      host,
      port,
      transcript: [],
      error: 'Cannot connect to Cloudflare-protected hosts',
      isCloudflare: true,
    }), {
      status: 403,
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
      // Authenticate if password provided (check !== undefined to allow empty string)
      if (password !== undefined) {
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
    } finally {
      try { reader.releaseLock(); } catch { /* ignored */ }
      try { writer.releaseLock(); } catch { /* ignored */ }
      try { await socket.close(); } catch { /* ignored */ }
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

/**
 * Query a Sentinel for replicas and other sentinels for a given master.
 *
 * Sends:
 *   SENTINEL replicas {masterName}  — list of replicas
 *   SENTINEL sentinels {masterName} — list of other sentinels in the quorum
 *
 * Returns structured replica/sentinel info including replication lag and
 * link status so callers can assess cluster health without a separate
 * SENTINEL masters probe.
 */
export async function handleSentinelGet(request: Request): Promise<Response> {
  const body = await request.json() as SentinelGetRequest;
  const { host, port: rawPort, timeout: rawTimeout, masterName } = body;

  if (!host || !host.trim()) {
    return new Response(JSON.stringify({
      success: false,
      host: host || '',
      port: rawPort || DEFAULT_PORT,
      masterName: masterName || '',
      error: 'Host is required',
    } satisfies SentinelGetResponse), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!/^[a-zA-Z0-9._:-]+$/.test(host)) {
    return new Response(JSON.stringify({
      success: false,
      host,
      port: rawPort || DEFAULT_PORT,
      masterName: masterName || '',
      error: 'Invalid host format',
    } satisfies SentinelGetResponse), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!masterName || !masterName.trim()) {
    return new Response(JSON.stringify({
      success: false,
      host,
      port: rawPort || DEFAULT_PORT,
      masterName: masterName || '',
      error: 'masterName is required',
    } satisfies SentinelGetResponse), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(masterName)) {
    return new Response(JSON.stringify({
      success: false,
      host,
      port: rawPort || DEFAULT_PORT,
      masterName,
      error: 'Invalid masterName format (use alphanumeric, hyphen, underscore only)',
    } satisfies SentinelGetResponse), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const port = rawPort || DEFAULT_PORT;
  const timeout = Math.min(rawTimeout || 10000, 30000);

  if (port < 1 || port > 65535) {
    return new Response(JSON.stringify({
      success: false,
      host,
      port,
      masterName,
      error: 'Port must be between 1 and 65535',
    } satisfies SentinelGetResponse), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Cloudflare detection
  if (host.endsWith('.workers.dev') || host.includes('cloudflare')) {
    return new Response(JSON.stringify({
      success: false,
      host,
      port,
      masterName,
      error: 'Cannot connect to Cloudflare-protected hosts',
      isCloudflare: true,
    }), {
      status: 403,
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
      // SENTINEL replicas {masterName}
      await writer.write(encodeRESPArray(['SENTINEL', 'replicas', masterName]));
      const replicasRaw = await readRESPFull(reader, timeout);
      const replicasParsed = parseRESP(replicasRaw);

      const replicas: ReplicaInfo[] = [];
      if (Array.isArray(replicasParsed)) {
        for (const entry of replicasParsed) {
          if (Array.isArray(entry)) {
            const obj = flatArrayToObject(entry);
            replicas.push({
              ip: obj['ip'] || obj['addr'] || '',
              port: obj['port'] || '',
              flags: obj['flags'] || '',
              lag: obj['slave-repl-offset'] || obj['lag'] || '0',
              linkStatus: obj['master-link-status'] || '',
            });
          }
        }
      }

      // SENTINEL sentinels {masterName}
      await writer.write(encodeRESPArray(['SENTINEL', 'sentinels', masterName]));
      const sentinelsRaw = await readRESPFull(reader, timeout);
      const sentinelsParsed = parseRESP(sentinelsRaw);

      const sentinels: SentinelInfo[] = [];
      if (Array.isArray(sentinelsParsed)) {
        for (const entry of sentinelsParsed) {
          if (Array.isArray(entry)) {
            const obj = flatArrayToObject(entry);
            sentinels.push({
              ip: obj['ip'] || '',
              port: obj['port'] || '',
              flags: obj['flags'] || '',
            });
          }
        }
      }

      const rtt = Date.now() - startTime;

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        masterName,
        replicas,
        sentinels,
        rtt,
      } satisfies SentinelGetResponse), {
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      try { reader.releaseLock(); } catch { /* ignored */ }
      try { writer.releaseLock(); } catch { /* ignored */ }
      try { await socket.close(); } catch { /* ignored */ }
    }
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      host,
      port,
      masterName,
      error: err instanceof Error ? err.message : 'Sentinel get failed',
    } satisfies SentinelGetResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Resolve the current master address for a Sentinel-monitored group and
 * verify quorum health.
 *
 * Sends:
 *   SENTINEL get-master-addr-by-name {masterName}  — returns [ip, port]
 *   SENTINEL ckquorum {masterName}                 — returns OK or error
 *
 * Useful for service-discovery clients that need to know which Redis
 * instance is currently the master and whether a failover would succeed.
 */
export async function handleSentinelGetMasterAddr(request: Request): Promise<Response> {
  const body = await request.json() as SentinelGetMasterAddrRequest;
  const { host, port: rawPort, timeout: rawTimeout, masterName } = body;

  if (!host || !host.trim()) {
    return new Response(JSON.stringify({
      success: false,
      host: host || '',
      port: rawPort || DEFAULT_PORT,
      masterName: masterName || '',
      error: 'Host is required',
    } satisfies SentinelGetMasterAddrResponse), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!/^[a-zA-Z0-9._:-]+$/.test(host)) {
    return new Response(JSON.stringify({
      success: false,
      host,
      port: rawPort || DEFAULT_PORT,
      masterName: masterName || '',
      error: 'Invalid host format',
    } satisfies SentinelGetMasterAddrResponse), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!masterName || !masterName.trim()) {
    return new Response(JSON.stringify({
      success: false,
      host,
      port: rawPort || DEFAULT_PORT,
      masterName: masterName || '',
      error: 'masterName is required',
    } satisfies SentinelGetMasterAddrResponse), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(masterName)) {
    return new Response(JSON.stringify({
      success: false,
      host,
      port: rawPort || DEFAULT_PORT,
      masterName,
      error: 'Invalid masterName format (use alphanumeric, hyphen, underscore only)',
    } satisfies SentinelGetMasterAddrResponse), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const port = rawPort || DEFAULT_PORT;
  const timeout = Math.min(rawTimeout || 10000, 30000);

  if (port < 1 || port > 65535) {
    return new Response(JSON.stringify({
      success: false,
      host,
      port,
      masterName,
      error: 'Port must be between 1 and 65535',
    } satisfies SentinelGetMasterAddrResponse), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Cloudflare detection
  if (host.endsWith('.workers.dev') || host.includes('cloudflare')) {
    return new Response(JSON.stringify({
      success: false,
      host,
      port,
      masterName,
      error: 'Cannot connect to Cloudflare-protected hosts',
      isCloudflare: true,
    }), {
      status: 403,
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
      // SENTINEL get-master-addr-by-name {masterName}
      await writer.write(encodeRESPArray(['SENTINEL', 'get-master-addr-by-name', masterName]));
      const addrRaw = await readRESPFull(reader, timeout);
      const addrParsed = parseRESP(addrRaw);

      let masterAddr: MasterAddr | undefined;
      if (Array.isArray(addrParsed) && addrParsed.length >= 2) {
        masterAddr = {
          ip: String(addrParsed[0]),
          port: String(addrParsed[1]),
        };
      }

      // SENTINEL ckquorum {masterName}
      await writer.write(encodeRESPArray(['SENTINEL', 'ckquorum', masterName]));
      const ckquorumRaw = await readRESPFull(reader, timeout);
      const ckquorumParsed = parseRESP(ckquorumRaw);

      // ckquorum returns "+OK N usable Sentinels..." on success or an error
      let quorumOk = false;
      let quorumMessage = '';
      if (typeof ckquorumParsed === 'string') {
        quorumOk = true;
        quorumMessage = ckquorumParsed;
      } else if (
        ckquorumParsed !== null &&
        typeof ckquorumParsed === 'object' &&
        'error' in (ckquorumParsed as Record<string, unknown>)
      ) {
        quorumOk = false;
        quorumMessage = (ckquorumParsed as Record<string, string>).error;
      }

      const rtt = Date.now() - startTime;

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        masterName,
        masterAddr,
        quorumOk,
        quorumMessage,
        rtt,
      } satisfies SentinelGetMasterAddrResponse), {
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      try { reader.releaseLock(); } catch { /* ignored */ }
      try { writer.releaseLock(); } catch { /* ignored */ }
      try { await socket.close(); } catch { /* ignored */ }
    }
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      host,
      port,
      masterName,
      error: err instanceof Error ? err.message : 'Sentinel get-master-addr failed',
    } satisfies SentinelGetMasterAddrResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── Sentinel Write Commands ─────────────────────────────────────────────────

interface SentinelWriteRequest {
  host: string;
  port?: number;
  password?: string;
  timeout?: number;
  masterName: string;
  /** For sentinel-set: key and value to configure on the master */
  key?: string;
  value?: string;
}

interface SentinelWriteResponse {
  success: boolean;
  host: string;
  port: number;
  command: string;
  masterName: string;
  result?: unknown;
  rtt?: number;
  error?: string;
}

async function sentinelWriteCommand(
  host: string,
  port: number,
  password: string | undefined,
  timeout: number,
  args: string[],
): Promise<{ result: unknown; rtt: number }> {
  const startTime = Date.now();
  const socket = connect(`${host}:${port}`);
  await socket.opened;

  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();

  try {
    if (password !== undefined) {
      await writer.write(encodeRESPArray(['AUTH', password]));
      const authResp = await readRESPFull(reader, timeout);
      if (!authResp.startsWith('+OK')) {
        throw new Error('Authentication failed');
      }
    }

    await writer.write(encodeRESPArray(args));
    const resp = await readRESPFull(reader, timeout);
    const result = parseRESP(resp);
    const rtt = Date.now() - startTime;

    return { result, rtt };
  } finally {
    try { reader.releaseLock(); } catch { /* ignored */ }
    try { writer.releaseLock(); } catch { /* ignored */ }
    try { await socket.close(); } catch { /* ignored */ }
  }
}

/**
 * Initiate a Sentinel failover for the given master.
 *
 * Sends: SENTINEL failover <masterName>
 * This forces a failover even if the master is reachable. Requires that
 * the Sentinel is configured to monitor the named master.
 *
 * POST /api/sentinel/failover
 */
export async function handleSentinelFailover(request: Request): Promise<Response> {
  const body = await request.json() as SentinelWriteRequest;
  const { host, port: rawPort, password, timeout: rawTimeout, masterName } = body;

  if (!host?.trim()) {
    return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!masterName?.trim()) {
    return new Response(JSON.stringify({ success: false, error: 'masterName is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const port = rawPort || DEFAULT_PORT;
  const timeout = Math.min(rawTimeout || 15000, 30000);

  try {
    const { result, rtt } = await sentinelWriteCommand(host, port, password, timeout, [
      'SENTINEL', 'failover', masterName,
    ]);

    return new Response(JSON.stringify({
      success: true,
      host, port,
      command: `SENTINEL failover ${masterName}`,
      masterName,
      result,
      rtt,
    } satisfies SentinelWriteResponse), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      host, port,
      command: `SENTINEL failover ${masterName}`,
      masterName,
      error: err instanceof Error ? err.message : 'Sentinel failover failed',
    } satisfies SentinelWriteResponse), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Reset all Sentinels monitoring the named master.
 *
 * Sends: SENTINEL reset <pattern>
 * Resets the state of all masters matching pattern (glob). Each Sentinel
 * re-discovers replicas and other sentinels from scratch.
 *
 * POST /api/sentinel/reset
 */
export async function handleSentinelReset(request: Request): Promise<Response> {
  const body = await request.json() as SentinelWriteRequest;
  const { host, port: rawPort, password, timeout: rawTimeout, masterName } = body;

  if (!host?.trim()) {
    return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!masterName?.trim()) {
    return new Response(JSON.stringify({ success: false, error: 'masterName (pattern) is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const port = rawPort || DEFAULT_PORT;
  const timeout = Math.min(rawTimeout || 10000, 30000);

  try {
    const { result, rtt } = await sentinelWriteCommand(host, port, password, timeout, [
      'SENTINEL', 'reset', masterName,
    ]);

    return new Response(JSON.stringify({
      success: true,
      host, port,
      command: `SENTINEL reset ${masterName}`,
      masterName,
      result,
      rtt,
    } satisfies SentinelWriteResponse), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      host, port,
      command: `SENTINEL reset ${masterName}`,
      masterName,
      error: err instanceof Error ? err.message : 'Sentinel reset failed',
    } satisfies SentinelWriteResponse), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Set a configuration parameter on a Sentinel-monitored master.
 *
 * Sends: SENTINEL set <masterName> <key> <value>
 * Commonly used to adjust quorum, down-after-milliseconds, failover-timeout, etc.
 *
 * POST /api/sentinel/set
 */
export async function handleSentinelSet(request: Request): Promise<Response> {
  const body = await request.json() as SentinelWriteRequest;
  const { host, port: rawPort, password, timeout: rawTimeout, masterName, key, value } = body;

  if (!host?.trim()) {
    return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!masterName?.trim()) {
    return new Response(JSON.stringify({ success: false, error: 'masterName is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!key?.trim()) {
    return new Response(JSON.stringify({ success: false, error: 'key is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (value === undefined || value === null) {
    return new Response(JSON.stringify({ success: false, error: 'value is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const port = rawPort || DEFAULT_PORT;
  const timeout = Math.min(rawTimeout || 10000, 30000);

  try {
    const { result, rtt } = await sentinelWriteCommand(host, port, password, timeout, [
      'SENTINEL', 'set', masterName, key, value,
    ]);

    return new Response(JSON.stringify({
      success: true,
      host, port,
      command: `SENTINEL set ${masterName} ${key} ${value}`,
      masterName,
      result,
      rtt,
    } satisfies SentinelWriteResponse), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      host, port,
      command: `SENTINEL set ${masterName} ${key} ${value}`,
      masterName,
      error: err instanceof Error ? err.message : 'Sentinel set failed',
    } satisfies SentinelWriteResponse), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
