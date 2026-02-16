/**
 * ClickHouse Protocol Implementation (HTTP Interface over TCP)
 *
 * ClickHouse is a columnar OLAP database that exposes an HTTP interface
 * on port 8123. Queries are sent as HTTP requests with SQL in the body
 * or query parameter.
 *
 * Protocol Flow:
 * 1. Client connects to ClickHouse HTTP port (default 8123)
 * 2. Client sends HTTP/1.1 requests
 * 3. Server responds with query results (TabSeparated, JSON, etc.)
 *
 * Key Endpoints:
 * - GET /ping         → "Ok.\n" (health check, no auth required)
 * - GET /?query=SQL   → Execute read query via query param
 * - POST /            → Execute query via request body
 * - GET /replicas_status → Replica health check
 *
 * Authentication: Via query params (?user=&password=) or headers
 * Default Port: 8123
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface ClickHouseRequest {
  host: string;
  port?: number;
  user?: string;
  password?: string;
  timeout?: number;
}

interface ClickHouseQueryRequest extends ClickHouseRequest {
  query: string;
  database?: string;
  format?: string;
}

interface ClickHouseResponse {
  success: boolean;
  statusCode?: number;
  version?: string;
  serverInfo?: unknown;
  databases?: string[];
  latencyMs?: number;
  error?: string;
  isCloudflare?: boolean;
}

/**
 * Send a raw HTTP/1.1 request over a TCP socket
 */
async function sendHttpRequest(
  host: string,
  port: number,
  method: string,
  path: string,
  body?: string,
  headers?: Record<string, string>,
  timeout = 15000,
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  await Promise.race([socket.opened, timeoutPromise]);

  const writer = socket.writable.getWriter();
  const encoder = new TextEncoder();

  let request = `${method} ${path} HTTP/1.1\r\n`;
  request += `Host: ${host}:${port}\r\n`;
  request += `Connection: close\r\n`;
  request += `User-Agent: PortOfCall/1.0\r\n`;

  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      request += `${key}: ${value}\r\n`;
    }
  }

  if (body) {
    const bodyBytes = encoder.encode(body);
    request += `Content-Type: text/plain\r\n`;
    request += `Content-Length: ${bodyBytes.length}\r\n`;
    request += `\r\n`;
    await writer.write(encoder.encode(request));
    await writer.write(bodyBytes);
  } else {
    request += `\r\n`;
    await writer.write(encoder.encode(request));
  }

  writer.releaseLock();

  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  let response = '';
  const maxSize = 512000;

  while (response.length < maxSize) {
    const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
    if (done) break;
    if (value) {
      response += decoder.decode(value, { stream: true });
    }
  }

  reader.releaseLock();
  socket.close();

  const headerEnd = response.indexOf('\r\n\r\n');
  if (headerEnd === -1) {
    throw new Error('Invalid HTTP response: no header terminator found');
  }

  const headerSection = response.substring(0, headerEnd);
  let bodySection = response.substring(headerEnd + 4);

  const statusLine = headerSection.split('\r\n')[0];
  const statusMatch = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/);
  const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;

  const respHeaders: Record<string, string> = {};
  const headerLines = headerSection.split('\r\n').slice(1);
  for (const line of headerLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim().toLowerCase();
      const value = line.substring(colonIdx + 1).trim();
      respHeaders[key] = value;
    }
  }

  if (respHeaders['transfer-encoding']?.includes('chunked')) {
    bodySection = decodeChunked(bodySection);
  }

  return { statusCode, headers: respHeaders, body: bodySection };
}

/**
 * Decode chunked transfer encoding
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
      result += remaining.substring(chunkStart);
      break;
    }

    result += remaining.substring(chunkStart, chunkEnd);
    remaining = remaining.substring(chunkEnd + 2);
  }

  return result;
}

/**
 * Build auth query params for ClickHouse
 */
function buildAuthParams(user?: string, password?: string): string {
  const params: string[] = [];
  if (user) {
    params.push(`user=${encodeURIComponent(user)}`);
  }
  if (password) {
    params.push(`password=${encodeURIComponent(password)}`);
  }
  return params.length > 0 ? params.join('&') : '';
}

/**
 * Validate ClickHouse input
 */
function validateInput(host: string, port: number): string | null {
  if (!host || host.trim().length === 0) {
    return 'Host is required';
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(host)) {
    return 'Host contains invalid characters';
  }
  if (port < 1 || port > 65535) {
    return 'Port must be between 1 and 65535';
  }
  return null;
}

/**
 * Handle ClickHouse health/info request
 *
 * POST /api/clickhouse/health
 * Body: { host, port?, user?, password?, timeout? }
 *
 * Returns ping status, server version, and database list
 */
export async function handleClickHouseHealth(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as ClickHouseRequest;
    const { host, port = 8123, user, password, timeout = 15000 } = body;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError } satisfies ClickHouseResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        } satisfies ClickHouseResponse),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const authParams = buildAuthParams(user, password);
    const start = Date.now();

    // GET /ping - Health check (no auth required)
    const pingResult = await sendHttpRequest(host, port, 'GET', '/ping', undefined, undefined, timeout);

    // SELECT version() - Server version
    let version = 'Unknown';
    try {
      const queryParam = encodeURIComponent('SELECT version()');
      const authSuffix = authParams ? `&${authParams}` : '';
      const versionResult = await sendHttpRequest(
        host, port, 'GET',
        `/?query=${queryParam}${authSuffix}`,
        undefined, undefined, timeout,
      );
      if (versionResult.statusCode === 200) {
        version = versionResult.body.trim();
      }
    } catch {
      // Version query might fail without auth
    }

    // SHOW DATABASES - Database listing
    let databases: string[] | undefined;
    try {
      const queryParam = encodeURIComponent('SHOW DATABASES');
      const authSuffix = authParams ? `&${authParams}` : '';
      const dbsResult = await sendHttpRequest(
        host, port, 'GET',
        `/?query=${queryParam}${authSuffix}`,
        undefined, undefined, timeout,
      );
      if (dbsResult.statusCode === 200) {
        databases = dbsResult.body.trim().split('\n').filter(Boolean);
      }
    } catch {
      // Database listing might require auth
    }

    // SELECT uptime(), currentDatabase(), hostName()
    let serverInfo: Record<string, string> = {};
    try {
      const queryParam = encodeURIComponent(
        "SELECT uptime() AS uptime, currentDatabase() AS current_db, hostName() AS hostname FORMAT JSONEachRow"
      );
      const authSuffix = authParams ? `&${authParams}` : '';
      const infoResult = await sendHttpRequest(
        host, port, 'GET',
        `/?query=${queryParam}${authSuffix}`,
        undefined, undefined, timeout,
      );
      if (infoResult.statusCode === 200) {
        try {
          serverInfo = JSON.parse(infoResult.body.trim()) as Record<string, string>;
        } catch {
          // Not JSON
        }
      }
    } catch {
      // Info query might fail
    }

    const latencyMs = Date.now() - start;

    const result: ClickHouseResponse = {
      success: pingResult.statusCode === 200,
      statusCode: pingResult.statusCode,
      version,
      serverInfo,
      databases,
      latencyMs,
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      } satisfies ClickHouseResponse),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Handle ClickHouse query request
 *
 * POST /api/clickhouse/query
 * Body: { host, port?, query, database?, format?, user?, password?, timeout? }
 *
 * Executes an arbitrary SQL query against the ClickHouse server
 */
export async function handleClickHouseQuery(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const reqBody = (await request.json()) as ClickHouseQueryRequest;
    const {
      host,
      port = 8123,
      query,
      database,
      format = 'JSONCompact',
      user,
      password,
      timeout = 15000,
    } = reqBody;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!query || query.trim().length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Query is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Build query path with params
    const params: string[] = [];
    params.push(`default_format=${encodeURIComponent(format)}`);
    if (database) {
      params.push(`database=${encodeURIComponent(database)}`);
    }
    const authParams = buildAuthParams(user, password);
    if (authParams) {
      params.push(authParams);
    }

    const queryPath = `/?${params.join('&')}`;
    const start = Date.now();

    const result = await sendHttpRequest(
      host,
      port,
      'POST',
      queryPath,
      query,
      undefined,
      timeout,
    );

    const latencyMs = Date.now() - start;

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      // Not JSON (TabSeparated or other format)
    }

    return new Response(
      JSON.stringify({
        success: result.statusCode >= 200 && result.statusCode < 400,
        statusCode: result.statusCode,
        body: result.body,
        parsed,
        latencyMs,
        format,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Query failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
