/**
 * Elasticsearch Protocol Implementation (REST API over TCP)
 *
 * Elasticsearch exposes a REST API on port 9200. This implementation
 * uses raw TCP sockets to construct HTTP/1.1 requests, demonstrating
 * that HTTP-based services can be accessed via the Cloudflare Sockets API.
 *
 * Protocol Flow:
 * 1. Client connects to ES server port 9200
 * 2. Client sends HTTP/1.1 request (GET/POST/PUT/DELETE)
 * 3. Server responds with JSON
 * 4. Connection closes (or keep-alive)
 *
 * Use Cases:
 * - Cluster health monitoring
 * - Index listing and management
 * - Full-text search via Query DSL
 * - Server info and version detection
 */

import { connect } from 'cloudflare:sockets';

interface ElasticsearchRequest {
  host: string;
  port?: number;
  path?: string;
  method?: string;
  body?: string;
  username?: string;
  password?: string;
  timeout?: number;
}

interface ElasticsearchResponse {
  success: boolean;
  statusCode?: number;
  headers?: Record<string, string>;
  body?: string;
  parsed?: unknown;
  error?: string;
  latencyMs?: number;
}

/**
 * Send a raw HTTP/1.1 request over a TCP socket and parse the response.
 */
async function sendHttpRequest(
  host: string,
  port: number,
  method: string,
  path: string,
  body?: string,
  authHeader?: string,
  timeout = 15000,
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  await Promise.race([socket.opened, timeoutPromise]);

  const writer = socket.writable.getWriter();
  const encoder = new TextEncoder();

  // Build HTTP/1.1 request
  let request = `${method} ${path} HTTP/1.1\r\n`;
  request += `Host: ${host}:${port}\r\n`;
  request += `Accept: application/json\r\n`;
  request += `Connection: close\r\n`;
  request += `User-Agent: PortOfCall/1.0\r\n`;

  if (authHeader) {
    request += `Authorization: ${authHeader}\r\n`;
  }

  if (body) {
    const bodyBytes = encoder.encode(body);
    request += `Content-Type: application/json\r\n`;
    request += `Content-Length: ${bodyBytes.length}\r\n`;
    request += `\r\n`;
    await writer.write(encoder.encode(request));
    await writer.write(bodyBytes);
  } else {
    request += `\r\n`;
    await writer.write(encoder.encode(request));
  }

  writer.releaseLock();

  // Read response
  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  let response = '';
  const maxSize = 512000; // 512KB limit

  while (response.length < maxSize) {
    const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
    if (done) break;
    if (value) {
      response += decoder.decode(value, { stream: true });
    }
  }

  reader.releaseLock();
  socket.close();

  // Parse HTTP response
  const headerEnd = response.indexOf('\r\n\r\n');
  if (headerEnd === -1) {
    throw new Error('Invalid HTTP response: no header terminator found');
  }

  const headerSection = response.substring(0, headerEnd);
  let bodySection = response.substring(headerEnd + 4);

  // Parse status line
  const statusLine = headerSection.split('\r\n')[0];
  const statusMatch = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/);
  const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;

  // Parse headers
  const headers: Record<string, string> = {};
  const headerLines = headerSection.split('\r\n').slice(1);
  for (const line of headerLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim().toLowerCase();
      const value = line.substring(colonIdx + 1).trim();
      headers[key] = value;
    }
  }

  // Handle chunked transfer encoding
  if (headers['transfer-encoding']?.includes('chunked')) {
    bodySection = decodeChunked(bodySection);
  }

  return { statusCode, headers, body: bodySection };
}

/**
 * Decode chunked transfer encoding.
 */
function decodeChunked(data: string): string {
  let result = '';
  let remaining = data;

  while (remaining.length > 0) {
    const lineEnd = remaining.indexOf('\r\n');
    if (lineEnd === -1) break;

    const sizeStr = remaining.substring(0, lineEnd).trim();
    const chunkSize = parseInt(sizeStr, 16);
    if (isNaN(chunkSize) || chunkSize === 0) break;

    const chunkStart = lineEnd + 2;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > remaining.length) {
      // Incomplete chunk, take what we have
      result += remaining.substring(chunkStart);
      break;
    }

    result += remaining.substring(chunkStart, chunkEnd);
    remaining = remaining.substring(chunkEnd + 2); // skip trailing \r\n
  }

  return result;
}

/**
 * Build Basic Auth header from username/password.
 */
function buildAuthHeader(username?: string, password?: string): string | undefined {
  if (username && password) {
    return `Basic ${btoa(`${username}:${password}`)}`;
  }
  return undefined;
}

/**
 * Handle Elasticsearch health/info request.
 * GET / returns cluster name, version, etc.
 * GET /_cluster/health returns cluster health status.
 */
export async function handleElasticsearchHealth(request: Request): Promise<Response> {
  try {
    const body = await request.json() as ElasticsearchRequest;
    const { host, port = 9200, username, password, timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const authHeader = buildAuthHeader(username, password);
    const start = Date.now();

    // Get server info (GET /)
    const infoResult = await sendHttpRequest(host, port, 'GET', '/', undefined, authHeader, timeout);

    // Get cluster health (GET /_cluster/health)
    let healthResult;
    try {
      healthResult = await sendHttpRequest(host, port, 'GET', '/_cluster/health', undefined, authHeader, timeout);
    } catch {
      // Health endpoint might fail, that's OK
      healthResult = null;
    }

    const latencyMs = Date.now() - start;

    let serverInfo;
    try {
      serverInfo = JSON.parse(infoResult.body);
    } catch {
      serverInfo = infoResult.body;
    }

    let healthInfo;
    if (healthResult) {
      try {
        healthInfo = JSON.parse(healthResult.body);
      } catch {
        healthInfo = healthResult.body;
      }
    }

    const result: ElasticsearchResponse = {
      success: infoResult.statusCode >= 200 && infoResult.statusCode < 400,
      statusCode: infoResult.statusCode,
      parsed: {
        serverInfo,
        clusterHealth: healthInfo || null,
      },
      latencyMs,
    };

    return new Response(JSON.stringify(result), {
      status: 200,
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
 * Handle Elasticsearch query/search request.
 * Sends an arbitrary HTTP request to the ES server.
 */
export async function handleElasticsearchQuery(request: Request): Promise<Response> {
  try {
    const body = await request.json() as ElasticsearchRequest;
    const {
      host,
      port = 9200,
      path = '/',
      method = 'GET',
      body: queryBody,
      username,
      password,
      timeout = 15000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate method
    const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'];
    const upperMethod = method.toUpperCase();
    if (!allowedMethods.includes(upperMethod)) {
      return new Response(JSON.stringify({
        success: false,
        error: `Invalid HTTP method: ${method}. Allowed: ${allowedMethods.join(', ')}`,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Ensure path starts with /
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    const authHeader = buildAuthHeader(username, password);
    const start = Date.now();

    const result = await sendHttpRequest(
      host,
      port,
      upperMethod,
      normalizedPath,
      queryBody,
      authHeader,
      timeout,
    );

    const latencyMs = Date.now() - start;

    let parsed;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      parsed = null;
    }

    const response: ElasticsearchResponse = {
      success: result.statusCode >= 200 && result.statusCode < 400,
      statusCode: result.statusCode,
      headers: result.headers,
      body: result.body,
      parsed,
      latencyMs,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Query failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
