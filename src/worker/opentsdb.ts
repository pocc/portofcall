/**
 * OpenTSDB Telnet Protocol Support for Cloudflare Workers
 * Implements the OpenTSDB telnet-style text protocol (port 4242)
 *
 * OpenTSDB is a distributed, scalable Time Series Database built on HBase.
 * Its telnet interface accepts text commands terminated by newlines:
 *   - version: Returns server version
 *   - stats: Returns server statistics
 *   - suggest type=metrics [q=prefix]: Suggests metric names
 *   - put <metric> <timestamp> <value> [tags]: Write data points
 *
 * Spec: http://opentsdb.net/docs/build/html/api_telnet/
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Read response lines from an OpenTSDB server until timeout or connection close
 * OpenTSDB responses are newline-delimited text
 */
async function readTelnetResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<string> {
  const chunks: string[] = [];

  const timeoutPromise = new Promise<string>((resolve) =>
    setTimeout(() => resolve(chunks.join('')), timeoutMs)
  );

  const readPromise = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value, { stream: true }));
    }
    return chunks.join('');
  })();

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Handle OpenTSDB version command
 * POST /api/opentsdb/version
 *
 * Connects to an OpenTSDB server and sends the 'version' command
 * to retrieve the server version string.
 */
export async function handleOpenTSDBVersion(request: Request): Promise<Response> {
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
    const port = options.port || 4242;
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
        // Send version command
        const sendTime = Date.now();
        await writer.write(encoder.encode('version\n'));

        // Read response (version string comes back as a single line)
        const response = await readTelnetResponse(reader, 3000);
        const rtt = Date.now() - sendTime;

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        const versionLine = response.trim();

        return {
          success: true,
          message: 'OpenTSDB version retrieved',
          host,
          port,
          rtt,
          connectTime,
          version: versionLine || '(empty response)',
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
 * Handle OpenTSDB stats command
 * POST /api/opentsdb/stats
 *
 * Sends the 'stats' command and returns server statistics.
 * Each stat line is in format: metric timestamp value tag=val
 */
export async function handleOpenTSDBStats(request: Request): Promise<Response> {
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
    const port = options.port || 4242;
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
        const sendTime = Date.now();
        await writer.write(encoder.encode('stats\n'));

        // Stats returns multiple lines
        const response = await readTelnetResponse(reader, 3000);
        const rtt = Date.now() - sendTime;

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        const lines = response.trim().split('\n').filter(l => l.trim());

        // Parse stat lines into structured data
        const stats: { metric: string; value: string; tags: string }[] = [];
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 3) {
            const metric = parts[0];
            // parts[1] is timestamp, parts[2] is value, rest are tags
            const value = parts[2];
            const tags = parts.slice(3).join(' ');
            stats.push({ metric, value, tags });
          }
        }

        return {
          success: true,
          message: `Retrieved ${stats.length} statistics`,
          host,
          port,
          rtt,
          connectTime,
          statCount: stats.length,
          stats,
          raw: response.trim(),
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
 * Handle OpenTSDB suggest command
 * POST /api/opentsdb/suggest
 *
 * Sends the 'suggest' command to discover metric names, tag keys, or tag values.
 * Format: suggest type=<metrics|tagk|tagv> [q=<prefix>] [max=<count>]
 */
export async function handleOpenTSDBSuggest(request: Request): Promise<Response> {
  try {
    const options = await request.json() as {
      host: string;
      port?: number;
      type?: 'metrics' | 'tagk' | 'tagv';
      query?: string;
      max?: number;
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
    const port = options.port || 4242;
    const suggestType = options.type || 'metrics';
    const query = options.query || '';
    const max = options.max || 25;
    const timeoutMs = options.timeout || 10000;

    // Validate suggest type
    if (!['metrics', 'tagk', 'tagv'].includes(suggestType)) {
      return new Response(JSON.stringify({
        error: 'Invalid type. Must be: metrics, tagk, or tagv',
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
        // Build suggest command
        let cmd = `suggest type=${suggestType}`;
        if (query) cmd += ` q=${query}`;
        cmd += ` max=${max}`;
        cmd += '\n';

        const sendTime = Date.now();
        await writer.write(encoder.encode(cmd));

        const response = await readTelnetResponse(reader, 3000);
        const rtt = Date.now() - sendTime;

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        const suggestions = response.trim().split('\n').filter(l => l.trim());

        return {
          success: true,
          message: `Found ${suggestions.length} suggestion(s)`,
          host,
          port,
          rtt,
          connectTime,
          type: suggestType,
          query: query || '(all)',
          count: suggestions.length,
          suggestions,
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
