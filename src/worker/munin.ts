/**
 * Munin Node Protocol Support for Cloudflare Workers
 * Implements the Munin node text protocol (port 4949)
 *
 * Munin is a monitoring tool that uses a simple text-based protocol.
 * The node sends a banner on connect: "# munin node at <hostname>"
 * Commands are newline-delimited; multi-line responses end with "." alone on a line.
 *
 * Commands:
 *   list [node]  - List available plugins (optionally for a specific virtual node)
 *   nodes        - List virtual nodes served by this munin-node (dot-terminated)
 *   config <p>   - Get plugin configuration / graph metadata (dot-terminated)
 *   fetch <p>    - Fetch current values from a plugin (dot-terminated)
 *   version      - Get munin-node version (single line)
 *   cap <caps>   - Negotiate capabilities (single line response)
 *   quit         - Close connection
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Read lines from the socket until we see the dot terminator or timeout.
 * Munin multi-line responses end with a line containing only "."
 *
 * The dot terminator patterns we must detect:
 *   - "\n.\n"  (dot on its own line, more data follows — shouldn't happen but be safe)
 *   - "\n.\n" at end of buffer
 *   - "\n."   at end of buffer (no trailing newline yet)
 *   - ".\n"   when the entire response is just the terminator (empty result)
 *   - ".\r\n"  some implementations use CRLF
 */
async function readMuninResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  expectDotTerminator: boolean = true
): Promise<string> {
  let buffer = '';
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  // Fix: clear timeout to prevent resource leak
  const timeoutPromise = new Promise<string>((resolve) => {
    timeoutId = setTimeout(() => {
      timeoutId = null;
      resolve(buffer);
    }, timeoutMs);
  });

  const readPromise = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      if (expectDotTerminator) {
        // Check if response is complete (line with just ".")
        // Handle both LF and CRLF line endings
        // Fix: \n.\r was incorrect — should be \r\n. for CRLF-then-dot
        if (
          buffer.includes('\n.\n') ||
          buffer.includes('\n.\r\n') ||
          buffer.endsWith('\n.') ||
          buffer.endsWith('\r\n.') ||
          buffer === '.\n' ||
          buffer === '.\r\n'
        ) {
          break;
        }
      } else {
        // Single-line response (like banner, list, version, cap)
        if (buffer.includes('\n')) {
          break;
        }
      }
    }
    return buffer;
  })();

  const result = await Promise.race([readPromise, timeoutPromise]);

  // Clear timeout if still active
  if (timeoutId !== null) {
    clearTimeout(timeoutId);
  }

  return result;
}

/**
 * Read just the banner line on connect
 */
async function readBanner(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<string> {
  return readMuninResponse(reader, timeoutMs, false);
}

/**
 * Send a command and read the response
 */
async function sendCommand(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  command: string,
  timeoutMs: number,
  multiLine: boolean = true
): Promise<string> {
  await writer.write(encoder.encode(command + '\n'));
  return readMuninResponse(reader, timeoutMs, multiLine);
}

/**
 * Handle Munin connect - connects, reads banner, lists plugins
 * POST /api/munin/connect
 */
export async function handleMuninConnect(request: Request): Promise<Response> {
  try {
    const options = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    if (!options.host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port ?? 4949;
    const timeoutMs = options.timeout || 10000;

    // Fix: validate port range
    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        error: 'Port must be between 1 and 65535',
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
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const connectTime = Date.now() - startTime;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Read welcome banner
        const banner = (await readBanner(reader, 3000)).trim();

        // Get version
        const versionResp = (await sendCommand(writer, reader, 'version', 3000, false)).trim();

        // Get capabilities — cap response is a single line: "cap <cap1> <cap2> ..."
        const capResp = (await sendCommand(writer, reader, 'cap multigraph', 3000, false)).trim();
        const capabilities = capResp
          .replace(/^cap\s+/, '')
          .split(/\s+/)
          .filter(c => c.length > 0);

        // Get virtual nodes — nodes response is dot-terminated, one node name per line
        const nodesResp = (await sendCommand(writer, reader, 'nodes', 3000, true)).trim();
        const nodes = nodesResp
          .split('\n')
          .map(l => l.trim())
          .filter(l => l && l !== '.');

        // List available plugins — response is space-separated on single line, but some plugins have no space
        // Fix: remove leading "list: " if present, and filter out empty strings after splitting
        const listResp = (await sendCommand(writer, reader, 'list', 3000, false)).trim();
        const cleanedList = listResp.replace(/^list:\s*/i, '');
        const plugins = cleanedList.split(/\s+/).filter(p => p.length > 0);

        // Send quit
        await writer.write(encoder.encode('quit\n'));

        // Fix: wait for socket write to flush before closing
        try {
          await writer.close();
        } catch {
          // Ignore close errors
        }

        reader.releaseLock();
        writer.releaseLock();
        await socket.close();

        // Parse banner for hostname
        const bannerMatch = banner.match(/# munin node at (.+)/);
        const nodeName = bannerMatch ? bannerMatch[1] : banner;

        return {
          success: true,
          message: 'Munin node connected',
          host,
          port,
          connectTime,
          banner,
          nodeName,
          version: versionResp,
          capabilities,
          nodes,
          pluginCount: plugins.length,
          plugins,
        };
      } catch (error) {
        // Fix: ensure locks are released even if already released
        try { reader.releaseLock(); } catch { /* ignored */ }
        try { writer.releaseLock(); } catch { /* ignored */ }
        try { await socket.close(); } catch { /* ignored */ }
        throw error;
      }
    })();

    // Fix: track timeout ID to clear on success
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timeoutId = null;
        reject(new Error('Connection timeout'));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);

      // Clear timeout if still active
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }

      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (timeoutError) {
      // Timeout already cleared itself
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

/**
 * Handle Munin fetch - retrieves current values from a specific plugin
 * POST /api/munin/fetch
 */
export async function handleMuninFetch(request: Request): Promise<Response> {
  try {
    const options = await request.json() as {
      host: string;
      port?: number;
      plugin: string;
      timeout?: number;
    };

    if (!options.host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!options.plugin) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: plugin',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate plugin name (alphanumeric, underscores, hyphens, dots only)
    if (!/^[a-zA-Z0-9._-]+$/.test(options.plugin)) {
      return new Response(JSON.stringify({
        error: 'Invalid plugin name. Use alphanumeric, dots, underscores, hyphens only.',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port ?? 4949;
    const plugin = options.plugin;
    const timeoutMs = options.timeout || 10000;

    // Fix: validate port range
    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        error: 'Port must be between 1 and 65535',
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
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const connectTime = Date.now() - startTime;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Read banner
        await readBanner(reader, 3000);

        // Fetch plugin values
        const sendTime = Date.now();
        const fetchResp = await sendCommand(writer, reader, `fetch ${plugin}`, 3000, true);
        const rtt = Date.now() - sendTime;

        // Send quit
        await writer.write(encoder.encode('quit\n'));

        // Fix: wait for socket write to flush before closing
        try {
          await writer.close();
        } catch {
          // Ignore close errors
        }

        reader.releaseLock();
        writer.releaseLock();
        await socket.close();

        // Parse fetch response: "field.value VALUE\n" lines, terminated by "."
        const lines = fetchResp.trim().split('\n').filter(l => l.trim() && l.trim() !== '.');
        const values: { field: string; value: string }[] = [];

        // Check for error — munin-node error responses start with "# "
        // Common patterns: "# Unknown service", "# Bad exit", "# Error", "# Timeout"
        const errorLine = lines.find(l =>
          l.startsWith('# Unknown') ||
          l.startsWith('# Bad') ||
          l.startsWith('# Error') ||
          l.startsWith('# Timeout') ||
          l.startsWith('# Not')
        );
        const isError = !!errorLine;

        if (!isError) {
          for (const line of lines) {
            const match = line.match(/^(\S+)\.value\s+(.+)$/);
            if (match) {
              values.push({ field: match[1], value: match[2].trim() });
            }
          }
        }

        return {
          success: !isError,
          message: isError ? `Plugin error: ${errorLine || lines[0]}` : `Fetched ${values.length} value(s) from ${plugin}`,
          host,
          port,
          plugin,
          rtt,
          connectTime,
          valueCount: values.length,
          values,
          raw: fetchResp.trim(),
        };
      } catch (error) {
        // Fix: ensure locks are released even if already released
        try { reader.releaseLock(); } catch { /* ignored */ }
        try { writer.releaseLock(); } catch { /* ignored */ }
        try { await socket.close(); } catch { /* ignored */ }
        throw error;
      }
    })();

    // Fix: track timeout ID to clear on success
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timeoutId = null;
        reject(new Error('Connection timeout'));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);

      // Clear timeout if still active
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }

      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (timeoutError) {
      // Timeout already cleared itself
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
