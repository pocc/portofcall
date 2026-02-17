/**
 * Memcached Protocol Support for Cloudflare Workers
 * Implements the Memcached text protocol (port 11211)
 *
 * Commands: get, set, add, replace, delete, incr, decr, stats, flush_all, version
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Read a complete Memcached text protocol response from the socket.
 * Handles multi-line responses (VALUE blocks ending with END, STAT blocks ending with END).
 */
async function readMemcachedResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<string> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Read timeout')), timeoutMs)
  );

  const readPromise = (async () => {
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Single-line terminal responses
      if (
        buffer.endsWith('STORED\r\n') ||
        buffer.endsWith('NOT_STORED\r\n') ||
        buffer.endsWith('EXISTS\r\n') ||
        buffer.endsWith('NOT_FOUND\r\n') ||
        buffer.endsWith('DELETED\r\n') ||
        buffer.endsWith('TOUCHED\r\n') ||
        buffer.endsWith('OK\r\n') ||
        buffer.endsWith('END\r\n') ||
        buffer.endsWith('ERROR\r\n') ||
        buffer.match(/^CLIENT_ERROR .+\r\n$/) ||
        buffer.match(/^SERVER_ERROR .+\r\n$/) ||
        buffer.match(/^VERSION .+\r\n$/) ||
        buffer.match(/^\d+\r\n$/)
      ) {
        return buffer;
      }
    }
    return buffer;
  })();

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Handle Memcached connection test
 * POST /api/memcached/connect
 */
export async function handleMemcachedConnect(request: Request): Promise<Response> {
  try {
    const { host, port = 11211, timeout = 10000 } = await request.json<{
      host: string;
      port?: number;
      timeout?: number;
    }>();

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Send VERSION command to verify connectivity
        await writer.write(encoder.encode('version\r\n'));
        const versionResponse = await readMemcachedResponse(reader, 5000);

        let version = 'Unknown';
        const versionMatch = versionResponse.match(/^VERSION (.+)\r\n$/);
        if (versionMatch) {
          version = versionMatch[1];
        }

        await socket.close();

        return {
          success: true,
          message: 'Memcached server reachable',
          host,
          port,
          version,
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
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
 * Handle Memcached command execution
 * POST /api/memcached/command
 *
 * For storage commands (set/add/replace/append/prepend), the worker constructs
 * the proper two-line request: command header + data block.
 */
export async function handleMemcachedCommand(request: Request): Promise<Response> {
  try {
    const { host, port = 11211, command, timeout = 10000 } = await request.json<{
      host: string;
      port?: number;
      command: string;
      timeout?: number;
    }>();

    if (!host || !command) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: host and command',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Parse the command to detect storage commands that need a data block
        const trimmed = command.trim();
        const parts = trimmed.split(/\s+/);
        const cmd = parts[0].toLowerCase();

        const storageCommands = ['set', 'add', 'replace', 'append', 'prepend'];

        if (storageCommands.includes(cmd)) {
          // Storage command format: <cmd> <key> <flags> <exptime> <bytes> [noreply]\r\n<data>\r\n
          // We expect the user to provide: set <key> <flags> <exptime> <data>
          // We calculate <bytes> automatically from <data>
          if (parts.length < 5) {
            throw new Error(
              `Storage command format: ${cmd} <key> <flags> <exptime> <value>\n` +
              `Example: set mykey 0 3600 hello world`
            );
          }

          const key = parts[1];
          const flags = parts[2];
          const exptime = parts[3];
          const dataValue = parts.slice(4).join(' ');
          const dataBytes = encoder.encode(dataValue);

          const header = `${cmd} ${key} ${flags} ${exptime} ${dataBytes.length}\r\n`;
          await writer.write(encoder.encode(header));
          await writer.write(encoder.encode(dataValue + '\r\n'));
        } else if (cmd === 'cas') {
          // CAS (Check-And-Set) format: cas <key> <flags> <exptime> <cas_unique> <value>
          // The cas_unique token comes from a prior 'gets' response VALUE header.
          if (parts.length < 6) {
            throw new Error(
              `CAS format: cas <key> <flags> <exptime> <cas_unique> <value>\n` +
              `Example: cas mykey 0 3600 12345 hello world\n` +
              `Get the cas_unique from a 'gets' command response.`
            );
          }
          const key = parts[1];
          const flags = parts[2];
          const exptime = parts[3];
          const casUnique = parts[4];
          const dataValue = parts.slice(5).join(' ');
          const dataBytes = encoder.encode(dataValue);
          const header = `cas ${key} ${flags} ${exptime} ${casUnique} ${dataBytes.length}\r\n`;
          await writer.write(encoder.encode(header));
          await writer.write(encoder.encode(dataValue + '\r\n'));
        } else {
          // Non-storage command — send as-is
          await writer.write(encoder.encode(trimmed + '\r\n'));
        }

        const response = await readMemcachedResponse(reader, timeout);
        await socket.close();

        return {
          success: true,
          command: trimmed,
          response: response.trimEnd(),
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Command failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle Memcached interactive WebSocket session
 * GET /api/memcached/session?host=...&port=...
 *
 * WebSocket message protocol:
 *   Browser → Worker: JSON { type: 'command', command: string }  (raw text command)
 *   Worker → Browser: JSON { type: 'connected', version: string }
 *                          { type: 'response', response: string, command: string }
 *                          { type: 'error', message: string }
 */
export async function handleMemcachedSession(request: Request): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('WebSocket upgrade required', { status: 426 });
  }

  const url = new URL(request.url);
  const host = url.searchParams.get('host') || '';
  const port = parseInt(url.searchParams.get('port') || '11211');

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

      // Get version to confirm connectivity
      await writer.write(encoder.encode('version\r\n'));
      const versionResp = await readMemcachedResponse(reader, 5000);
      const versionMatch = versionResp.match(/^VERSION (.+)\r\n$/);
      const version = versionMatch ? versionMatch[1] : 'unknown';

      server.send(JSON.stringify({ type: 'connected', version, host, port }));

      // Handle incoming commands
      server.addEventListener('message', async (event) => {
        try {
          const msg = JSON.parse(event.data as string) as { type: string; command?: string };
          if (msg.type === 'command' && msg.command) {
            const trimmed = msg.command.trim();
            const parts = trimmed.split(/\s+/);
            const cmd = parts[0].toLowerCase();
            const storageCommands = ['set', 'add', 'replace', 'append', 'prepend'];

            if (storageCommands.includes(cmd)) {
              if (parts.length < 5) {
                server.send(JSON.stringify({
                  type: 'error',
                  message: `Storage format: ${cmd} <key> <flags> <exptime> <value>`,
                }));
                return;
              }
              const key = parts[1];
              const flags = parts[2];
              const exptime = parts[3];
              const dataValue = parts.slice(4).join(' ');
              const dataBytes = encoder.encode(dataValue);
              const header = `${cmd} ${key} ${flags} ${exptime} ${dataBytes.length}\r\n`;
              await writer.write(encoder.encode(header));
              await writer.write(encoder.encode(dataValue + '\r\n'));
            } else if (cmd === 'cas') {
              if (parts.length < 6) {
                server.send(JSON.stringify({
                  type: 'error',
                  message: 'CAS format: cas <key> <flags> <exptime> <cas_unique> <value>',
                }));
                return;
              }
              const key = parts[1];
              const flags = parts[2];
              const exptime = parts[3];
              const casUnique = parts[4];
              const dataValue = parts.slice(5).join(' ');
              const dataBytes = encoder.encode(dataValue);
              const header = `cas ${key} ${flags} ${exptime} ${casUnique} ${dataBytes.length}\r\n`;
              await writer.write(encoder.encode(header));
              await writer.write(encoder.encode(dataValue + '\r\n'));
            } else {
              await writer.write(encoder.encode(trimmed + '\r\n'));
            }

            const response = await readMemcachedResponse(reader, 30000);
            server.send(JSON.stringify({
              type: 'response',
              response: response.trimEnd(),
              command: trimmed,
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
 * Handle Memcached stats retrieval
 * POST /api/memcached/stats
 */
export async function handleMemcachedStats(request: Request): Promise<Response> {
  try {
    const { host, port = 11211, timeout = 10000, subcommand = '' } = await request.json<{
      host: string;
      port?: number;
      timeout?: number;
      subcommand?: string;
    }>();

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const allowed = ['', 'items', 'slabs', 'sizes', 'conns', 'reset'];
    if (!allowed.includes(subcommand)) {
      return new Response(JSON.stringify({
        error: `Invalid subcommand. Allowed: ${allowed.filter(Boolean).join(', ')}`,
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        const statsCmd = subcommand ? `stats ${subcommand}\r\n` : 'stats\r\n';
        await writer.write(encoder.encode(statsCmd));
        const response = await readMemcachedResponse(reader, 5000);

        // Parse STAT lines into key-value pairs
        const stats: Record<string, string> = {};
        const lines = response.split('\r\n');
        for (const line of lines) {
          if (line.startsWith('STAT ')) {
            const spaceIdx = line.indexOf(' ', 5);
            if (spaceIdx !== -1) {
              stats[line.substring(5, spaceIdx)] = line.substring(spaceIdx + 1);
            }
          }
        }

        await socket.close();

        return {
          success: true,
          host,
          port,
          subcommand: subcommand || 'general',
          stats,
          raw: response.trimEnd(),
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Stats retrieval failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Parse VALUE blocks from a Memcached multi-get (get/gets) response.
 * Handles both plain VALUE (flags bytes) and VALUE+CAS (flags bytes casUnique).
 */
function parseValueBlocks(raw: string): Array<{
  key: string;
  flags: number;
  bytes: number;
  value: string;
  cas?: string;
}> {
  const items: Array<{ key: string; flags: number; bytes: number; value: string; cas?: string }> = [];
  const lines = raw.split('\r\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('VALUE ')) {
      // VALUE <key> <flags> <bytes> [<cas_unique>]
      const parts = line.substring(6).split(' ');
      const key = parts[0];
      const flags = parseInt(parts[1], 10);
      const bytes = parseInt(parts[2], 10);
      const cas = parts[3]; // only present in 'gets' responses
      i++;
      const value = lines[i] ?? '';
      items.push({ key, flags, bytes, value, ...(cas !== undefined ? { cas } : {}) });
    }
    i++;
  }
  return items;
}

/**
 * Handle Memcached multi-get with CAS token (gets command)
 * POST /api/memcached/gets
 *
 * Returns structured VALUE objects including CAS unique tokens for use with CAS writes.
 */
export async function handleMemcachedGets(request: Request): Promise<Response> {
  try {
    const { host, port = 11211, keys, timeout = 10000 } = await request.json<{
      host: string;
      port?: number;
      keys: string[];
      timeout?: number;
    }>();

    if (!host || !keys || keys.length === 0) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: host and keys (non-empty array)',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (keys.length > 100) {
      return new Response(JSON.stringify({ error: 'keys array may not exceed 100 entries' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // 'gets' returns the same VALUE header as 'get' but appends the CAS unique token
        const getsCmd = `gets ${keys.join(' ')}\r\n`;
        await writer.write(encoder.encode(getsCmd));
        const response = await readMemcachedResponse(reader, timeout);
        await socket.close();

        const items = parseValueBlocks(response);
        const found = items.map(i => i.key);
        const missing = keys.filter(k => !found.includes(k));

        return {
          success: true,
          host,
          port,
          requested: keys.length,
          found: items.length,
          missing,
          items,
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Gets failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
