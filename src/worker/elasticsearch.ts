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
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

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

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  try {
    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const encoder = new TextEncoder();

    // Sanitize inputs to prevent CRLF injection / request smuggling
    const safePath = path.replace(/[\r\n]/g, '');
    const safeHost = host.replace(/[\r\n]/g, '');
    const safeMethod = method.replace(/[\r\n]/g, '');

    // Build HTTP/1.1 request
    let request = `${safeMethod} ${safePath} HTTP/1.1\r\n`;
    request += `Host: ${safeHost}:${port}\r\n`;
    request += `Accept: application/json\r\n`;
    request += `Connection: close\r\n`;
    request += `User-Agent: PortOfCall/1.0\r\n`;

    if (authHeader) {
      request += `Authorization: ${authHeader.replace(/[\r\n]/g, '')}\r\n`;
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
        const chunk = decoder.decode(value, { stream: true });
        if (response.length + chunk.length > maxSize) {
          response += chunk.substring(0, maxSize - response.length);
          break;
        }
        response += chunk;
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
    const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;

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
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    try { socket.close(); } catch { /* ignore */ }
  }
}

/**
 * Decode chunked transfer encoding.
 */
function decodeChunked(data: string): string {
  let result = '';
  let remaining = data;
  let lastChunkSize = -1;

  while (remaining.length > 0) {
    const lineEnd = remaining.indexOf('\r\n');
    if (lineEnd === -1) break;

    const sizeStr = remaining.substring(0, lineEnd).trim();
    const chunkSize = parseInt(sizeStr, 16);
    lastChunkSize = isNaN(chunkSize) ? -1 : chunkSize;
    if (isNaN(chunkSize) || chunkSize === 0) break;

    const chunkStart = lineEnd + 2;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > remaining.length) {
      // Incomplete chunk, take what we have
      result += remaining.substring(chunkStart);
      lastChunkSize = -1; // truncated — terminator not reached
      break;
    }

    result += remaining.substring(chunkStart, chunkEnd);
    remaining = remaining.substring(chunkEnd + 2); // skip trailing \r\n
  }

  // RFC 7230 §4.1: a chunked response MUST be terminated by a zero-length chunk.
  // If the last processed chunk size was not 0, the response was truncated.
  if (lastChunkSize !== 0) {
    console.warn('Incomplete chunked response: missing zero-length terminator chunk');
  }

  return result;
}

/**
 * Build Basic Auth header from username/password.
 */
function buildAuthHeader(username?: string, password?: string): string | undefined {
  if (username != null && username !== '') {
    const bytes = new TextEncoder().encode(`${username}:${password ?? ''}`);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `Basic ${btoa(binary)}`;
  }
  return undefined;
}

/**
 * Handle Elasticsearch health/info request.
 * GET / returns cluster name, version, etc.
 * GET /_cluster/health returns cluster health status.
 */
export async function handleElasticsearchHealth(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }
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

    if (typeof port !== 'number' || isNaN(port) || port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
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
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }
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

    if (typeof port !== 'number' || isNaN(port) || port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
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

    // Validate method — only allow read-safe methods
    const allowedMethods = ['GET', 'POST', 'HEAD'];
    const upperMethod = method.toUpperCase().replace(/[\r\n]/g, '');
    if (!allowedMethods.includes(upperMethod)) {
      return new Response(JSON.stringify({
        success: false,
        error: `Invalid HTTP method: ${method}. Allowed: ${allowedMethods.join(', ')}. PUT/DELETE are blocked for safety.`,
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


/**
 * Handle Elasticsearch HTTPS query request.
 * Same as handleElasticsearchQuery but uses https:// URL for TLS connections.
 * Used for Elastic Cloud, port 443, or any ES cluster with TLS enabled.
 *
 * POST /api/elasticsearch/https
 * Body: { host, port?, path?, method?, body?, username?, password?, timeout? }
 */
export async function handleElasticsearchHTTPS(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }
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

    if (typeof port !== 'number' || isNaN(port) || port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
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

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = `https://${host}:${port}${normalizedPath}`;

    const fetchHeaders: Record<string, string> = {
      'Accept': 'application/json',
      'User-Agent': 'PortOfCall/1.0',
    };

    if (username && password) {
      fetchHeaders['Authorization'] = buildAuthHeader(username, password)!;
    }

    if (queryBody) {
      fetchHeaders['Content-Type'] = 'application/json';
    }

    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    let fetchResponse: Response;
    try {
      fetchResponse = await fetch(url, {
        method: upperMethod,
        headers: fetchHeaders,
        body: queryBody || undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const latencyMs = Date.now() - start;
    const responseText = await fetchResponse.text();

    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      parsed = null;
    }

    const responseHeaders: Record<string, string> = {};
    fetchResponse.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const result: ElasticsearchResponse = {
      success: fetchResponse.status >= 200 && fetchResponse.status < 400,
      statusCode: fetchResponse.status,
      headers: responseHeaders,
      body: responseText,
      parsed,
      latencyMs,
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'HTTPS query failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

interface ElasticsearchIndexRequest {
  host: string;
  port?: number;
  index: string;
  id?: string;
  doc: unknown;
  username?: string;
  password?: string;
  https?: boolean;
  timeout?: number;
}

/**
 * Index a document into Elasticsearch.
 * PUT /{index}/_doc/{id}  (with id)
 * POST /{index}/_doc      (without id, auto-generates id)
 *
 * POST /api/elasticsearch/index
 * Body: { host, port?, index, id?, doc, username?, password?, https?, timeout? }
 */
export async function handleElasticsearchIndex(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const body = await request.json() as ElasticsearchIndexRequest;
    const {
      host,
      port = 9200,
      index,
      id,
      doc,
      username,
      password,
      https = false,
      timeout = 15000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!index) {
      return new Response(JSON.stringify({ success: false, error: 'Index is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (doc === undefined || doc === null) {
      return new Response(JSON.stringify({ success: false, error: 'doc is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (typeof port !== 'number' || isNaN(port) || port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
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

    const docPath = id ? `/${encodeURIComponent(index)}/_doc/${encodeURIComponent(id)}` : `/${encodeURIComponent(index)}/_doc`;
    const httpMethod = id ? 'PUT' : 'POST';
    const docBody = JSON.stringify(doc);

    if (https) {
      const url = `https://${host}:${port}${docPath}`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'PortOfCall/1.0',
      };
      if (username && password) {
        headers['Authorization'] = buildAuthHeader(username, password)!;
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      const start = Date.now();
      let fetchResponse: Response;
      try {
        fetchResponse = await fetch(url, { method: httpMethod, headers, body: docBody, signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
      const latencyMs = Date.now() - start;
      const responseText = await fetchResponse.text();
      let parsed;
      try { parsed = JSON.parse(responseText); } catch { parsed = null; }
      return new Response(JSON.stringify({
        success: fetchResponse.status >= 200 && fetchResponse.status < 400,
        statusCode: fetchResponse.status,
        body: responseText,
        parsed,
        latencyMs,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } else {
      const authHeader = buildAuthHeader(username, password);
      const start = Date.now();
      const result = await sendHttpRequest(host, port, httpMethod, docPath, docBody, authHeader, timeout);
      const latencyMs = Date.now() - start;
      let parsed;
      try { parsed = JSON.parse(result.body); } catch { parsed = null; }
      return new Response(JSON.stringify({
        success: result.statusCode >= 200 && result.statusCode < 400,
        statusCode: result.statusCode,
        body: result.body,
        parsed,
        latencyMs,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Index failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

interface ElasticsearchDeleteDocRequest {
  host: string;
  port?: number;
  index: string;
  id: string;
  username?: string;
  password?: string;
  https?: boolean;
  timeout?: number;
}

/**
 * Delete a document from Elasticsearch.
 * DELETE /{index}/_doc/{id}
 *
 * DELETE /api/elasticsearch/document
 * Body: { host, port?, index, id, username?, password?, https?, timeout? }
 */
export async function handleElasticsearchDelete(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const body = await request.json() as ElasticsearchDeleteDocRequest;
    const {
      host,
      port = 9200,
      index,
      id,
      username,
      password,
      https = false,
      timeout = 15000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!index) {
      return new Response(JSON.stringify({ success: false, error: 'Index is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!id) {
      return new Response(JSON.stringify({ success: false, error: 'Document id is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (typeof port !== 'number' || isNaN(port) || port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
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

    const docPath = `/${encodeURIComponent(index)}/_doc/${encodeURIComponent(id)}`;

    if (https) {
      const url = `https://${host}:${port}${docPath}`;
      const headers: Record<string, string> = {
        'Accept': 'application/json',
        'User-Agent': 'PortOfCall/1.0',
      };
      if (username && password) {
        headers['Authorization'] = buildAuthHeader(username, password)!;
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      const start = Date.now();
      let fetchResponse: Response;
      try {
        fetchResponse = await fetch(url, { method: 'DELETE', headers, signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
      const latencyMs = Date.now() - start;
      const responseText = await fetchResponse.text();
      let parsed;
      try { parsed = JSON.parse(responseText); } catch { parsed = null; }
      return new Response(JSON.stringify({
        success: fetchResponse.status >= 200 && fetchResponse.status < 400,
        statusCode: fetchResponse.status,
        body: responseText,
        parsed,
        latencyMs,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } else {
      const authHeader = buildAuthHeader(username, password);
      const start = Date.now();
      const result = await sendHttpRequest(host, port, 'DELETE', docPath, undefined, authHeader, timeout);
      const latencyMs = Date.now() - start;
      let parsed;
      try { parsed = JSON.parse(result.body); } catch { parsed = null; }
      return new Response(JSON.stringify({
        success: result.statusCode >= 200 && result.statusCode < 400,
        statusCode: result.statusCode,
        body: result.body,
        parsed,
        latencyMs,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Delete failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

interface ElasticsearchCreateIndexRequest {
  host: string;
  port?: number;
  index: string;
  username?: string;
  password?: string;
  https?: boolean;
  shards?: number;
  replicas?: number;
  timeout?: number;
}

/**
 * Create an Elasticsearch index with optional shard/replica settings.
 * PUT /{index}  with body { settings: { number_of_shards, number_of_replicas } }
 *
 * PUT /api/elasticsearch/create-index
 * Body: { host, port?, index, username?, password?, https?, shards?, replicas?, timeout? }
 */
export async function handleElasticsearchCreate(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const body = await request.json() as ElasticsearchCreateIndexRequest;
    const {
      host,
      port = 9200,
      index,
      username,
      password,
      https = false,
      shards = 1,
      replicas = 1,
      timeout = 15000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!index) {
      return new Response(JSON.stringify({ success: false, error: 'Index name is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (typeof port !== 'number' || isNaN(port) || port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
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

    const indexPath = `/${encodeURIComponent(index)}`;
    const settingsBody = JSON.stringify({
      settings: {
        number_of_shards: shards,
        number_of_replicas: replicas,
      },
    });

    if (https) {
      const url = `https://${host}:${port}${indexPath}`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'PortOfCall/1.0',
      };
      if (username && password) {
        headers['Authorization'] = buildAuthHeader(username, password)!;
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      const start = Date.now();
      let fetchResponse: Response;
      try {
        fetchResponse = await fetch(url, { method: 'PUT', headers, body: settingsBody, signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
      const latencyMs = Date.now() - start;
      const responseText = await fetchResponse.text();
      let parsed;
      try { parsed = JSON.parse(responseText); } catch { parsed = null; }
      return new Response(JSON.stringify({
        success: fetchResponse.status >= 200 && fetchResponse.status < 400,
        statusCode: fetchResponse.status,
        index,
        shards,
        replicas,
        body: responseText,
        parsed,
        latencyMs,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } else {
      const authHeader = buildAuthHeader(username, password);
      const start = Date.now();
      const result = await sendHttpRequest(host, port, 'PUT', indexPath, settingsBody, authHeader, timeout);
      const latencyMs = Date.now() - start;
      let parsed;
      try { parsed = JSON.parse(result.body); } catch { parsed = null; }
      return new Response(JSON.stringify({
        success: result.statusCode >= 200 && result.statusCode < 400,
        statusCode: result.statusCode,
        index,
        shards,
        replicas,
        body: result.body,
        parsed,
        latencyMs,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Create index failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
