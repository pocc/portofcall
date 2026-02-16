/**
 * Munin Node Protocol Support for Cloudflare Workers
 * Implements the Munin node text protocol (port 4949)
 *
 * Munin is a monitoring tool that uses a simple text-based protocol.
 * The node sends a banner on connect: "# munin node at <hostname>"
 * Commands are newline-delimited; multi-line responses end with "." alone.
 *
 * Commands:
 *   list         - List available plugins
 *   config <p>   - Get plugin configuration (graph metadata)
 *   fetch <p>    - Fetch current values from a plugin
 *   version      - Get munin-node version
 *   cap          - List capabilities
 *   quit         - Close connection
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Read lines from the socket until we see the dot terminator or timeout
 * Munin multi-line responses end with a line containing only "."
 */
async function readMuninResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  expectDotTerminator: boolean = true
): Promise<string> {
  const chunks: string[] = [];
  let buffer = '';

  const timeoutPromise = new Promise<string>((resolve) =>
    setTimeout(() => resolve(buffer + chunks.join('')), timeoutMs)
  );

  const readPromise = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      if (expectDotTerminator) {
        // Check if response is complete (line with just ".")
        if (buffer.includes('\n.\n') || buffer.endsWith('\n.\n') || buffer.endsWith('\n.')) {
          break;
        }
      } else {
        // Single-line response (like banner, list, version)
        if (buffer.includes('\n')) {
          break;
        }
      }
    }
    return buffer;
  })();

  return Promise.race([readPromise, timeoutPromise]);
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
    const port = options.port || 4949;
    const timeoutMs = options.timeout || 10000;

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

        // Get capabilities
        const capResp = (await sendCommand(writer, reader, 'cap', 3000, true)).trim();
        const capabilities = capResp
          .split('\n')
          .filter(l => l.trim() && l.trim() !== '.')
          .map(l => l.replace(/^cap\s+/, '').trim());

        // List available plugins
        const listResp = (await sendCommand(writer, reader, 'list', 3000, false)).trim();
        const plugins = listResp.split(/\s+/).filter(p => p.trim());

        // Send quit
        await writer.write(encoder.encode('quit\n'));

        writer.releaseLock();
        reader.releaseLock();
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
          pluginCount: plugins.length,
          plugins,
        };
      } catch (error) {
        reader.releaseLock();
        writer.releaseLock();
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
    const port = options.port || 4949;
    const plugin = options.plugin;
    const timeoutMs = options.timeout || 10000;

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

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        // Parse fetch response: "field.value VALUE\n" lines, terminated by "."
        const lines = fetchResp.trim().split('\n').filter(l => l.trim() && l.trim() !== '.');
        const values: { field: string; value: string }[] = [];

        // Check for error
        const isError = lines.some(l => l.startsWith('# Unknown') || l.startsWith('# Bad'));

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
          message: isError ? `Plugin error: ${lines[0]}` : `Fetched ${values.length} value(s) from ${plugin}`,
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
        reader.releaseLock();
        writer.releaseLock();
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
