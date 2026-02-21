/**
 * uWSGI Binary Wire Protocol Support for Cloudflare Workers
 * Implements the uwsgi protocol (default port 3031)
 *
 * The uWSGI protocol is a binary wire protocol used for communication between
 * web servers (nginx, Apache) and Python/WSGI application servers. It's designed
 * as a faster alternative to HTTP proxying and FastCGI.
 *
 * Packet structure:
 *   Header (4 bytes):
 *     - modifier1 (1 byte): packet type (0=WSGI request, 5=raw)
 *     - datasize (2 bytes LE): size of the body
 *     - modifier2 (1 byte): sub-type
 *
 *   Body (datasize bytes):
 *     Key-value pairs, each encoded as:
 *       - key_size (2 bytes LE)
 *       - key (key_size bytes)
 *       - val_size (2 bytes LE)
 *       - val (val_size bytes)
 *
 * The server responds with raw HTTP response data.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const decoder = new TextDecoder();

/**
 * Build a uWSGI request packet
 */
function buildUwsgiPacket(
  vars: Record<string, string>,
  modifier1: number = 0,
  modifier2: number = 0
): Uint8Array {
  // Calculate body size
  let bodySize = 0;
  for (const [key, val] of Object.entries(vars)) {
    bodySize += 2 + key.length + 2 + val.length;
  }

  // Build the packet
  const packet = new Uint8Array(4 + bodySize);
  const view = new DataView(packet.buffer);

  // Header
  packet[0] = modifier1;
  view.setUint16(1, bodySize, true); // little-endian
  packet[3] = modifier2;

  // Body: key-value pairs
  let offset = 4;
  for (const [key, val] of Object.entries(vars)) {
    view.setUint16(offset, key.length, true);
    offset += 2;
    for (let i = 0; i < key.length; i++) {
      packet[offset++] = key.charCodeAt(i);
    }
    view.setUint16(offset, val.length, true);
    offset += 2;
    for (let i = 0; i < val.length; i++) {
      packet[offset++] = val.charCodeAt(i);
    }
  }

  return packet;
}

/**
 * Read the HTTP response from uWSGI server
 */
async function readUwsgiResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalSize = 0;
  const maxSize = 64 * 1024; // 64KB limit

  const timeoutPromise = new Promise<Uint8Array>((resolve) =>
    setTimeout(() => {
      const result = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      resolve(result);
    }, timeoutMs)
  );

  const readPromise = (async () => {
    while (totalSize < maxSize) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalSize += value.length;
    }
    const result = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  })();

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Parse an HTTP response from the raw bytes
 */
function parseHttpResponse(data: Uint8Array): {
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  raw: string;
} {
  const raw = decoder.decode(data);

  // Split headers and body
  const headerEnd = raw.indexOf('\r\n\r\n');
  if (headerEnd === -1) {
    return {
      statusCode: 0,
      statusText: 'Unknown',
      headers: {},
      body: raw,
      raw,
    };
  }

  const headerSection = raw.substring(0, headerEnd);
  const body = raw.substring(headerEnd + 4);

  const headerLines = headerSection.split('\r\n');
  let statusCode = 200;
  let statusText = 'OK';

  // Parse status line (may be "HTTP/1.x NNN Text" or "Status: NNN Text")
  if (headerLines.length > 0) {
    const statusLine = headerLines[0];
    const httpMatch = statusLine.match(/^HTTP\/[\d.]+\s+(\d+)\s*(.*)/);
    if (httpMatch) {
      statusCode = parseInt(httpMatch[1], 10);
      statusText = httpMatch[2] || '';
    }
  }

  // Parse headers
  const headers: Record<string, string> = {};
  for (let i = 1; i < headerLines.length; i++) {
    const colonIdx = headerLines[i].indexOf(':');
    if (colonIdx > 0) {
      const key = headerLines[i].substring(0, colonIdx).trim();
      const val = headerLines[i].substring(colonIdx + 1).trim();
      headers[key] = val;
    }
  }

  // Also check for "Status:" header pattern (CGI-style)
  if (headers['Status']) {
    const statusMatch = headers['Status'].match(/(\d+)\s*(.*)/);
    if (statusMatch) {
      statusCode = parseInt(statusMatch[1], 10);
      statusText = statusMatch[2] || '';
    }
  }

  return { statusCode, statusText, headers, body, raw };
}

/**
 * Handle uWSGI probe - send a minimal request and check if server responds
 * POST /api/uwsgi/probe
 */
export async function handleUwsgiProbe(request: Request): Promise<Response> {
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
    const port = options.port || 3031;
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
        // Build a minimal WSGI request (GET /)
        const vars: Record<string, string> = {
          'REQUEST_METHOD': 'GET',
          'REQUEST_URI': '/',
          'PATH_INFO': '/',
          'QUERY_STRING': '',
          'SERVER_PROTOCOL': 'HTTP/1.1',
          'HTTP_HOST': host,
          'SERVER_NAME': host,
          'SERVER_PORT': String(port),
          'SCRIPT_NAME': '',
        };

        const packet = buildUwsgiPacket(vars, 0, 0);

        const sendTime = Date.now();
        await writer.write(packet);

        // Read response
        const responseData = await readUwsgiResponse(reader, 5000);
        const rtt = Date.now() - sendTime;

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        const responseText = decoder.decode(responseData);
        const isUwsgi = responseData.length > 0 && (
          responseText.includes('HTTP/') ||
          responseText.includes('Status:') ||
          responseText.includes('Content-Type') ||
          responseText.includes('uWSGI') ||
          responseText.includes('uwsgi')
        );

        // Try to parse as HTTP
        const parsed = parseHttpResponse(responseData);

        return {
          success: true,
          message: isUwsgi ? 'uWSGI server detected' : 'Connected, response received',
          host,
          port,
          connectTime,
          rtt,
          isUwsgi,
          responseSize: responseData.length,
          statusCode: parsed.statusCode,
          statusText: parsed.statusText,
          serverHeader: parsed.headers['Server'] || parsed.headers['server'] || undefined,
          contentType: parsed.headers['Content-Type'] || parsed.headers['content-type'] || undefined,
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
 * Handle uWSGI request - send a custom WSGI request
 * POST /api/uwsgi/request
 */
export async function handleUwsgiRequest(request: Request): Promise<Response> {
  try {
    const options = await request.json() as {
      host: string;
      port?: number;
      method?: string;
      path?: string;
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
    const port = options.port || 3031;
    const method = (options.method || 'GET').toUpperCase();
    const path = options.path || '/';
    const timeoutMs = options.timeout || 10000;

    // Validate method
    if (!/^[A-Z]+$/.test(method)) {
      return new Response(JSON.stringify({
        error: 'Invalid HTTP method',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate path
    if (!path.startsWith('/')) {
      return new Response(JSON.stringify({
        error: 'Path must start with /',
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
        // Split path and query string
        const qIdx = path.indexOf('?');
        const pathInfo = qIdx >= 0 ? path.substring(0, qIdx) : path;
        const queryString = qIdx >= 0 ? path.substring(qIdx + 1) : '';

        const vars: Record<string, string> = {
          'REQUEST_METHOD': method,
          'REQUEST_URI': path,
          'PATH_INFO': pathInfo,
          'QUERY_STRING': queryString,
          'SERVER_PROTOCOL': 'HTTP/1.1',
          'HTTP_HOST': host,
          'SERVER_NAME': host,
          'SERVER_PORT': String(port),
          'SCRIPT_NAME': '',
          'HTTP_USER_AGENT': 'PortOfCall/1.0 uWSGI-Client',
          'HTTP_ACCEPT': '*/*',
        };

        const packet = buildUwsgiPacket(vars, 0, 0);

        const sendTime = Date.now();
        await writer.write(packet);

        // Read response
        const responseData = await readUwsgiResponse(reader, 5000);
        const rtt = Date.now() - sendTime;

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        // Parse HTTP response
        const parsed = parseHttpResponse(responseData);

        return {
          success: true,
          message: `${method} ${path} => ${parsed.statusCode} ${parsed.statusText}`,
          host,
          port,
          method,
          path,
          connectTime,
          rtt,
          statusCode: parsed.statusCode,
          statusText: parsed.statusText,
          headers: parsed.headers,
          body: parsed.body.substring(0, 8192), // Limit body size
          bodySize: parsed.body.length,
          responseSize: responseData.length,
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
