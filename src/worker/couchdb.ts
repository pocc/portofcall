/**
 * Apache CouchDB Protocol Implementation (HTTP REST API over TCP)
 *
 * CouchDB is a NoSQL document database that uses HTTP as its native protocol.
 * All operations (CRUD, replication, views) are performed via standard HTTP
 * methods against JSON endpoints. CouchDB also supports the non-standard
 * COPY method for document duplication.
 *
 * Protocol Flow:
 * 1. Client connects to CouchDB port (default 5984, 6984 for HTTPS)
 * 2. Client sends HTTP/1.1 requests (GET/PUT/POST/DELETE/COPY)
 * 3. Server responds with JSON (Content-Type: application/json)
 *
 * Key Endpoints:
 * - GET /                     → Server info (version, features, vendor, uuid)
 * - GET /_all_dbs             → List all databases
 * - GET /_up                  → Health check ({"status":"ok"} if operational)
 * - GET /_active_tasks        → List running tasks (replication, compaction, etc.)
 * - GET /_membership          → Cluster nodes list
 * - GET /_node/_local/_stats  → Per-node statistics
 * - GET /dbname               → Database info (doc_count, disk_size, etc.)
 * - GET/POST /_session        → Session info / Cookie authentication
 *
 * Authentication: Basic Auth (Authorization header) or Cookie sessions (/_session)
 * Default Port: 5984
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface CouchDBRequest {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  timeout?: number;
}

interface CouchDBQueryRequest extends CouchDBRequest {
  path?: string;
  method?: string;
  body?: string;
}

interface CouchDBResponse {
  success: boolean;
  statusCode?: number;
  serverInfo?: unknown;
  databases?: string[];
  dbInfo?: unknown;
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
  const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;

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

  if (headers['transfer-encoding']?.includes('chunked')) {
    bodySection = decodeChunked(bodySection);
  }

  return { statusCode, headers, body: bodySection };
}

/**
 * Decode chunked transfer encoding
 *
 * Per RFC 7230 Section 4.1, each chunk is:
 *   chunk-size [ chunk-ext ] CRLF
 *   chunk-data CRLF
 *
 * Chunk extensions (;name=value) after the size are stripped.
 * The final chunk has size 0 and may be followed by trailers.
 */
function decodeChunked(data: string): string {
  let result = '';
  let remaining = data;

  while (remaining.length > 0) {
    const lineEnd = remaining.indexOf('\r\n');
    if (lineEnd === -1) break;

    // Strip any chunk extensions (e.g., "a;ext=val" -> "a")
    let sizeStr = remaining.substring(0, lineEnd).trim();
    const semiIdx = sizeStr.indexOf(';');
    if (semiIdx !== -1) {
      sizeStr = sizeStr.substring(0, semiIdx).trim();
    }

    const chunkSize = parseInt(sizeStr, 16);
    if (isNaN(chunkSize) || chunkSize === 0) break;

    const chunkStart = lineEnd + 2;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > remaining.length) {
      // Partial chunk: take what we have
      result += remaining.substring(chunkStart);
      break;
    }

    result += remaining.substring(chunkStart, chunkEnd);
    // Skip past chunk data + trailing CRLF
    remaining = remaining.substring(chunkEnd + 2);
  }

  return result;
}

/**
 * Build Basic Auth header
 *
 * CouchDB supports Basic Auth with username:password.
 * Per RFC 7617, the password may be empty (username-only auth),
 * so we send the header whenever a username is provided.
 */
function buildAuthHeader(username?: string, password?: string): string | undefined {
  if (username) {
    const bytes = new TextEncoder().encode(`${username}:${password ?? ''}`);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `Basic ${btoa(binary)}`;
  }
  return undefined;
}

/**
 * Validate CouchDB input
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
 * Handle CouchDB health/info request
 *
 * POST /api/couchdb/health
 * Body: { host, port?, username?, password?, timeout? }
 *
 * Returns server info (GET /) and database list (GET /_all_dbs)
 */
export async function handleCouchDBHealth(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as CouchDBRequest;
    const { host, port = 5984, username, password, timeout = 15000 } = body;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError } satisfies CouchDBResponse),
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
        } satisfies CouchDBResponse),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const authHeader = buildAuthHeader(username, password);
    const start = Date.now();

    // GET / - Server info
    const infoResult = await sendHttpRequest(host, port, 'GET', '/', undefined, authHeader, timeout);
    let serverInfo: unknown;
    try {
      serverInfo = JSON.parse(infoResult.body);
    } catch {
      serverInfo = infoResult.body;
    }

    // GET /_all_dbs - Database listing
    let databases: string[] | undefined;
    try {
      const dbsResult = await sendHttpRequest(host, port, 'GET', '/_all_dbs', undefined, authHeader, timeout);
      if (dbsResult.statusCode === 200) {
        databases = JSON.parse(dbsResult.body) as string[];
      }
    } catch {
      // Database listing might require auth
    }

    const latencyMs = Date.now() - start;

    const result: CouchDBResponse = {
      success: infoResult.statusCode >= 200 && infoResult.statusCode < 400,
      statusCode: infoResult.statusCode,
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
      } satisfies CouchDBResponse),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Handle CouchDB query request
 *
 * POST /api/couchdb/query
 * Body: { host, port?, path?, method?, body?, username?, password?, timeout? }
 *
 * Sends an arbitrary HTTP request to the CouchDB server
 */
export async function handleCouchDBQuery(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const reqBody = (await request.json()) as CouchDBQueryRequest;
    const {
      host,
      port = 5984,
      path = '/',
      method = 'GET',
      body: queryBody,
      username,
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

    // CouchDB supports COPY in addition to standard HTTP methods
    // (used for document copying with a Destination header)
    const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'COPY'];
    const upperMethod = method.toUpperCase();
    if (!allowedMethods.includes(upperMethod)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Invalid HTTP method: ${method}. Allowed: ${allowedMethods.join(', ')}`,
        }),
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

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      parsed = null;
    }

    return new Response(
      JSON.stringify({
        success: result.statusCode >= 200 && result.statusCode < 400,
        statusCode: result.statusCode,
        headers: result.headers,
        body: result.body,
        parsed,
        latencyMs,
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
