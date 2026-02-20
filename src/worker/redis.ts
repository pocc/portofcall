/**
 * Redis Protocol Support for Cloudflare Workers
 * Implements RESP (Redis Serialization Protocol)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

export interface RedisConnectionOptions {
  host: string;
  port?: number;
  password?: string;
  database?: number;
  timeout?: number;
}

/**
 * Encode a RESP array command
 * Example: ['PING'] -> "*1\r\n$4\r\nPING\r\n"
 */
function encodeRESPArray(args: string[]): Uint8Array {
  let resp = `*${args.length}\r\n`;
  for (const arg of args) {
    const bytes = new TextEncoder().encode(arg);
    resp += `$${bytes.length}\r\n${arg}\r\n`;
  }
  return new TextEncoder().encode(resp);
}

/**
 * Read raw bytes from the socket into a growing buffer until a predicate is
 * satisfied, then return the accumulated string.
 */
async function readUntilComplete(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<string> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Read timeout')), timeoutMs)
  );

  const readPromise = (async () => {
    let buffer = '';
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += new TextDecoder().decode(value);
      // Stop accumulating once we have a complete top-level RESP value
      if (isCompleteRESP(buffer)) break;
    }
    return buffer;
  })();

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Heuristic check: does `buf` contain a complete top-level RESP value?
 * This avoids returning partial arrays or bulk strings.
 */
function isCompleteRESP(buf: string): boolean {
  if (!buf.includes('\r\n')) return false;
  const firstCrlf = buf.indexOf('\r\n');
  const firstLine = buf.slice(0, firstCrlf);
  const type = firstLine[0];

  if (type === '+' || type === '-' || type === ':') {
    // Simple string / error / integer — one line
    return true;
  }

  if (type === '$') {
    const len = parseInt(firstLine.slice(1), 10);
    if (len === -1) return true; // null bulk string
    // Need: $N\r\n + N bytes + \r\n
    const needed = firstCrlf + 2 + len + 2;
    return buf.length >= needed;
  }

  if (type === '*') {
    const count = parseInt(firstLine.slice(1), 10);
    if (count <= 0) return true; // empty or null array
    // Parse the full array to see if we have all elements
    try {
      const [, consumed] = parseRESPValue(buf, 0);
      return consumed > 0;
    } catch {
      return false;
    }
  }

  return buf.includes('\r\n');
}

/**
 * Parse a single RESP value starting at `pos` in `buf`.
 * Returns [serialisedValue, endPosition].
 * Throws if the buffer does not yet contain a complete value.
 */
function parseRESPValue(buf: string, pos: number): [string, number] {
  if (pos >= buf.length) throw new Error('incomplete');
  const type = buf[pos];
  const crlf = buf.indexOf('\r\n', pos);
  if (crlf === -1) throw new Error('incomplete');
  const firstLine = buf.slice(pos, crlf);
  const afterLine = crlf + 2;

  if (type === '+' || type === '-' || type === ':') {
    return [buf.slice(pos, afterLine), afterLine];
  }

  if (type === '$') {
    const len = parseInt(firstLine.slice(1), 10);
    if (len === -1) return [buf.slice(pos, afterLine), afterLine];
    const dataEnd = afterLine + len + 2; // +2 for trailing \r\n
    if (buf.length < dataEnd) throw new Error('incomplete');
    return [buf.slice(pos, dataEnd), dataEnd];
  }

  if (type === '*') {
    const count = parseInt(firstLine.slice(1), 10);
    if (count <= 0) return [buf.slice(pos, afterLine), afterLine];
    let cur = afterLine;
    for (let i = 0; i < count; i++) {
      const [, next] = parseRESPValue(buf, cur);
      cur = next;
    }
    return [buf.slice(pos, cur), cur];
  }

  // Unknown type — treat as single line
  return [buf.slice(pos, afterLine), afterLine];
}

/**
 * Read a complete RESP response from the socket.
 *
 * Handles all RESP types correctly:
 *   +OK\r\n                        → simple string
 *   -ERR message\r\n               → error
 *   :42\r\n                        → integer
 *   $6\r\nfoobar\r\n               → bulk string
 *   *2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n → array
 */
async function readRESPResponse(reader: ReadableStreamDefaultReader<Uint8Array>, timeoutMs: number): Promise<string> {
  const raw = await readUntilComplete(reader, timeoutMs);
  // Return the fully-parsed slice (drops any trailing buffered bytes)
  try {
    const [value] = parseRESPValue(raw, 0);
    return value;
  } catch {
    // Parsing failed (incomplete data) — return what we have
    return raw;
  }
}

/**
 * Handle Redis connection test (HTTP mode)
 */
export async function handleRedisConnect(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let options: Partial<RedisConnectionOptions>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<RedisConnectionOptions>;
    } else {
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '6379'),
        password: url.searchParams.get('password') || undefined,
        database: url.searchParams.get('database') ? parseInt(url.searchParams.get('database')!) : undefined,
        timeout: parseInt(url.searchParams.get('timeout') || '30000'),
      };
    }

    // Validate required fields
    if (!options.host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 6379;
    const timeoutMs = options.timeout || 30000;

    // Check if the target is behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Wrap entire connection in timeout
    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        let serverInfo = '';

        // Authenticate if password provided
        if (options.password) {
          const authCommand = encodeRESPArray(['AUTH', options.password]);
          await writer.write(authCommand);
          const authResponse = await readRESPResponse(reader, 5000);

          if (!authResponse.startsWith('+OK')) {
            throw new Error('Authentication failed: ' + authResponse);
          }
          serverInfo += 'Authenticated. ';
        }

        // Select database if specified
        if (options.database !== undefined) {
          const selectCommand = encodeRESPArray(['SELECT', options.database.toString()]);
          await writer.write(selectCommand);
          const selectResponse = await readRESPResponse(reader, 5000);

          if (!selectResponse.startsWith('+OK')) {
            throw new Error('Database selection failed: ' + selectResponse);
          }
          serverInfo += `Database ${options.database} selected. `;
        }

        // Send PING command to test connectivity
        const pingCommand = encodeRESPArray(['PING']);
        await writer.write(pingCommand);
        const pingResponse = await readRESPResponse(reader, 5000);

        if (!pingResponse.includes('PONG')) {
          throw new Error('Invalid PING response: ' + pingResponse);
        }

        serverInfo += 'PING successful.';

        // Get server info using INFO command
        const infoCommand = encodeRESPArray(['INFO', 'server']);
        await writer.write(infoCommand);
        const infoResponse = await readRESPResponse(reader, 5000);

        // Parse version from INFO response
        let version = 'Unknown';
        const versionMatch = infoResponse.match(/redis_version:([^\r\n]+)/);
        if (versionMatch) {
          version = versionMatch[1];
        }

        await socket.close();

        return {
          success: true,
          message: 'Redis server reachable',
          host,
          port,
          serverInfo,
          version,
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (timeoutError) {
      return new Response(JSON.stringify({
        success: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'Connection timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Format a raw RESP response into a human-readable string (redis-cli style)
 */
function formatRESPResponse(resp: string): string {
  const trimmed = resp.trim();
  if (!trimmed) return '(empty)';

  // Error
  if (trimmed.startsWith('-')) return '(error) ' + trimmed.slice(1);
  // Simple string
  if (trimmed.startsWith('+')) return trimmed.slice(1);
  // Integer
  if (trimmed.startsWith(':')) return '(integer) ' + trimmed.slice(1);
  // Null bulk string
  if (trimmed === '$-1') return '(nil)';
  // Bulk string: $N\r\ndata\r\n
  if (trimmed.startsWith('$')) {
    const lines = trimmed.split('\r\n');
    if (lines.length >= 2) return '"' + lines[1] + '"';
  }
  // Array: *N\r\n...
  if (trimmed.startsWith('*')) {
    const lines = trimmed.split('\r\n');
    const count = parseInt(lines[0].slice(1));
    if (count === 0) return '(empty array)';
    if (count === -1) return '(nil)';
    const items: string[] = [];
    let i = 1;
    for (let n = 0; n < count && i < lines.length; n++) {
      if (lines[i].startsWith('$')) {
        i++;
        items.push(`${n + 1}) "${lines[i] ?? ''}"` );
        i++;
      } else if (lines[i].startsWith(':')) {
        items.push(`${n + 1}) (integer) ${lines[i].slice(1)}`);
        i++;
      } else {
        items.push(`${n + 1}) ${lines[i]}`);
        i++;
      }
    }
    return items.join('\n');
  }
  return trimmed;
}

/**
 * Handle Redis interactive WebSocket session
 * GET /api/redis/session?host=...&port=...&password=...&database=...
 *
 * WebSocket message protocol:
 *   Browser → Worker: JSON { type: 'command', command: string[] }
 *   Worker → Browser: JSON { type: 'connected', version: string }
 *                          { type: 'response', response: string, raw: string, command: string[] }
 *                          { type: 'error', message: string }
 */
export async function handleRedisSession(request: Request): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('WebSocket upgrade required', { status: 426 });
  }

  const url = new URL(request.url);
  const host = url.searchParams.get('host') || '';
  const port = parseInt(url.searchParams.get('port') || '6379');
  const password = url.searchParams.get('password') || undefined;
  const database = url.searchParams.get('database') ? parseInt(url.searchParams.get('database')!) : undefined;

  if (!host) {
    return new Response(JSON.stringify({ error: 'Missing host' }), { status: 400 });
  }

  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    return new Response(JSON.stringify({
      error: getCloudflareErrorMessage(host, cfCheck.ip),
    }), { status: 403 });
  }

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();

  (async () => {
    try {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      // AUTH
      if (password) {
        await writer.write(encodeRESPArray(['AUTH', password]));
        const authResp = await readRESPResponse(reader, 5000);
        if (!authResp.startsWith('+OK')) {
          server.send(JSON.stringify({ type: 'error', message: 'Authentication failed: ' + authResp.trim() }));
          server.close();
          return;
        }
      }

      // SELECT database
      if (database !== undefined) {
        await writer.write(encodeRESPArray(['SELECT', database.toString()]));
        const selResp = await readRESPResponse(reader, 5000);
        if (!selResp.startsWith('+OK')) {
          server.send(JSON.stringify({ type: 'error', message: 'Database selection failed: ' + selResp.trim() }));
          server.close();
          return;
        }
      }

      // Get version
      await writer.write(encodeRESPArray(['INFO', 'server']));
      const infoResp = await readRESPResponse(reader, 5000);
      const versionMatch = infoResp.match(/redis_version:([^\r\n]+)/);
      const version = versionMatch ? versionMatch[1] : 'unknown';

      server.send(JSON.stringify({ type: 'connected', version, host, port }));

      // Handle incoming commands
      server.addEventListener('message', async (event) => {
        try {
          const msg = JSON.parse(event.data as string) as { type: string; command?: string[] };
          if (msg.type === 'command' && msg.command && msg.command.length > 0) {
            await writer.write(encodeRESPArray(msg.command));
            const raw = await readRESPResponse(reader, 30000);
            server.send(JSON.stringify({
              type: 'response',
              response: formatRESPResponse(raw),
              raw,
              command: msg.command,
            }));
          }
        } catch (e) {
          server.send(JSON.stringify({ type: 'error', message: String(e) }));
        }
      });

      server.addEventListener('close', () => {
        socket.close().catch(() => {});
      });
    } catch (e) {
      server.send(JSON.stringify({ type: 'error', message: String(e) }));
      server.close();
    }
  })();

  return new Response(null, { status: 101, webSocket: client });
}

/**
 * Handle Redis command execution
 */
export async function handleRedisCommand(request: Request): Promise<Response> {
  try {
    const options = await request.json() as {
      host: string;
      port?: number;
      password?: string;
      database?: number;
      command: string[];
      timeout?: number;
    };

    if (!options.host || !options.command || options.command.length === 0) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: host and command',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 6379;
    const timeoutMs = options.timeout || 30000;

    // Check if the target is behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Wrap entire connection in timeout
    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Authenticate if password provided
        if (options.password) {
          const authCommand = encodeRESPArray(['AUTH', options.password]);
          await writer.write(authCommand);
          await readRESPResponse(reader, 5000);
        }

        // Select database if specified
        if (options.database !== undefined) {
          const selectCommand = encodeRESPArray(['SELECT', options.database.toString()]);
          await writer.write(selectCommand);
          await readRESPResponse(reader, 5000);
        }

        // Execute the user's command
        const command = encodeRESPArray(options.command);
        await writer.write(command);
        const response = await readRESPResponse(reader, timeoutMs);

        await socket.close();

        return {
          success: true,
          response,
          command: options.command,
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (timeoutError) {
      return new Response(JSON.stringify({
        success: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'Connection timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Request failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
