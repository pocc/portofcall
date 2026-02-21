/**
 * Apache Solr Protocol Implementation (HTTP REST API over TCP)
 *
 * Apache Solr is an open-source search platform built on Apache Lucene.
 * It exposes an HTTP REST API on port 8983 for indexing, querying,
 * and administering search cores/collections.
 *
 * Protocol Flow:
 * 1. Client connects to Solr HTTP port (default 8983)
 * 2. Client sends HTTP/1.1 requests (GET/POST)
 * 3. Server responds with JSON (or XML, CSV, etc.)
 *
 * Key Endpoints:
 * - GET /solr/admin/info/system     → System info (version, JVM, OS)
 * - GET /solr/admin/cores?action=STATUS → Core listing and status
 * - GET /solr/{core}/select?q=*:*   → Search query
 * - GET /solr/{core}/admin/ping     → Core health check
 *
 * Authentication: Optional Basic Auth or Kerberos
 * Default Port: 8983
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface SolrRequest {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  timeout?: number;
}

interface SolrQueryRequest extends SolrRequest {
  core: string;
  query?: string;
  handler?: string;
  params?: Record<string, string>;
}

interface SolrResponse {
  success: boolean;
  statusCode?: number;
  version?: string;
  systemInfo?: unknown;
  cores?: string[];
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

  const timeoutHandle = setTimeout(() => {}, 0);
  clearTimeout(timeoutHandle);

  const timeoutPromise = new Promise<never>((_, reject) => {
    const handle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    (timeoutPromise as unknown as { handle: ReturnType<typeof setTimeout> }).handle = handle;
  });

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

  try {
    await Promise.race([socket.opened, timeoutPromise]);

    writer = socket.writable.getWriter();
    const encoder = new TextEncoder();

    let request = `${method} ${path} HTTP/1.1\r\n`;
    request += `Host: ${host}${port !== 80 && port !== 443 ? `:${port}` : ''}\r\n`;
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

    try {
      writer.releaseLock();
    } catch {
      // ignore
    }
    writer = null;

    reader = socket.readable.getReader();
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

    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
    reader = null;

    const headerEnd = response.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      throw new Error('Invalid HTTP response: no header terminator found');
    }

    const headerSection = response.substring(0, headerEnd);
    let bodySection = response.substring(headerEnd + 4);

    const statusLine = headerSection.split('\r\n')[0];
    const statusMatch = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/);
    const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;

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
  } finally {
    clearTimeout((timeoutPromise as unknown as { handle: ReturnType<typeof setTimeout> }).handle);
    if (writer) {
      try {
        writer.releaseLock();
      } catch {
        // ignore
      }
    }
    if (reader) {
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }
    try {
      socket.close();
    } catch {
      // ignore
    }
  }
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

    let sizeStr = remaining.substring(0, lineEnd).trim();

    // Remove chunk extensions (;name=value)
    const semicolonIdx = sizeStr.indexOf(';');
    if (semicolonIdx > 0) {
      sizeStr = sizeStr.substring(0, semicolonIdx);
    }

    const chunkSize = parseInt(sizeStr, 16);
    if (isNaN(chunkSize) || chunkSize === 0) break;

    const chunkStart = lineEnd + 2;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > remaining.length) {
      result += remaining.substring(chunkStart);
      break;
    }

    // Validate CRLF after chunk data
    if (chunkEnd + 2 <= remaining.length) {
      const afterChunk = remaining.substring(chunkEnd, chunkEnd + 2);
      if (afterChunk !== '\r\n') {
        // Malformed chunked encoding, but continue anyway
      }
    }

    result += remaining.substring(chunkStart, chunkEnd);
    remaining = remaining.substring(chunkEnd + 2);
  }

  return result;
}

/**
 * Build Basic Auth header
 */
function buildAuthHeader(username?: string, password?: string): string | undefined {
  if (username) {
    const pass = password || '';
    const bytes = new TextEncoder().encode(`${username}:${pass}`);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `Basic ${btoa(binary)}`;
  }
  return undefined;
}

/**
 * Validate Solr input
 */
function validateInput(host: string, port: number, core?: string, handler?: string): string | null {
  if (!host || host.trim().length === 0) {
    return 'Host is required';
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(host)) {
    return 'Host contains invalid characters';
  }
  if (port < 1 || port > 65535) {
    return 'Port must be between 1 and 65535';
  }
  if (core !== undefined) {
    if (!core || core.trim().length === 0) {
      return 'Core name is required';
    }
    if (core.includes('..') || core.includes('/') || core.includes('\\')) {
      return 'Core name contains invalid path characters';
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(core)) {
      return 'Core name contains invalid characters';
    }
  }
  if (handler !== undefined && handler.length > 0) {
    if (handler.includes('..')) {
      return 'Handler path contains invalid path traversal';
    }
  }
  return null;
}

/**
 * Handle Solr health/info request
 *
 * POST /api/solr/health
 * Body: { host, port?, username?, password?, timeout? }
 *
 * Returns system info and core listing
 */
export async function handleSolrHealth(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as SolrRequest;
    const { host, port = 8983, username, password, timeout = 15000 } = body;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError } satisfies SolrResponse),
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
        } satisfies SolrResponse),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const authHeader = buildAuthHeader(username, password);
    const start = Date.now();

    // GET /solr/admin/info/system - System info
    const sysResult = await sendHttpRequest(
      host, port, 'GET', '/solr/admin/info/system?wt=json',
      undefined, authHeader, timeout,
    );

    let systemInfo: unknown;
    let version = 'Unknown';
    try {
      const parsed = JSON.parse(sysResult.body) as Record<string, unknown>;
      systemInfo = parsed;
      const lucene = parsed.lucene as Record<string, string> | undefined;
      if (lucene?.['solr-spec-version']) {
        version = lucene['solr-spec-version'];
      }
    } catch {
      systemInfo = sysResult.body;
    }

    // GET /solr/admin/cores?action=STATUS - Core listing
    let cores: string[] | undefined;
    try {
      const coresResult = await sendHttpRequest(
        host, port, 'GET', '/solr/admin/cores?action=STATUS&wt=json',
        undefined, authHeader, timeout,
      );
      if (coresResult.statusCode === 200) {
        const parsed = JSON.parse(coresResult.body) as { status?: Record<string, unknown> };
        if (parsed.status) {
          cores = Object.keys(parsed.status);
        }
      }
    } catch {
      // Core listing might require auth
    }

    const latencyMs = Date.now() - start;

    const result: SolrResponse = {
      success: sysResult.statusCode >= 200 && sysResult.statusCode < 400,
      statusCode: sysResult.statusCode,
      version,
      systemInfo,
      cores,
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
      } satisfies SolrResponse),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Handle Solr query request
 *
 * POST /api/solr/query
 * Body: { host, port?, core, query?, handler?, params?, username?, password?, timeout? }
 *
 * Executes a search query against a specific Solr core
 */
export async function handleSolrQuery(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const reqBody = (await request.json()) as SolrQueryRequest;
    const {
      host,
      port = 8983,
      core,
      query = '*:*',
      handler = '/select',
      params = {},
      username,
      password,
      timeout = 15000,
    } = reqBody;

    const validationError = validateInput(host, port, core, handler);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
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

    // Build query path
    const queryParams = new URLSearchParams();
    queryParams.set('q', query);
    queryParams.set('wt', 'json');
    for (const [key, value] of Object.entries(params)) {
      // Validate param keys and values don't contain control characters
      // eslint-disable-next-line no-control-regex
      if (/[\x00-\x1F\x7F]/.test(key) || /[\x00-\x1F\x7F]/.test(value)) {
        return new Response(
          JSON.stringify({ success: false, error: 'Parameter keys or values contain invalid control characters' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
      queryParams.set(key, value);
    }

    const normalizedHandler = handler.startsWith('/') ? handler : `/${handler}`;
    const path = `/solr/${encodeURIComponent(core)}${normalizedHandler}?${queryParams.toString()}`;
    const authHeader = buildAuthHeader(username, password);
    const start = Date.now();

    const result = await sendHttpRequest(
      host, port, 'GET', path,
      undefined, authHeader, timeout,
    );

    const latencyMs = Date.now() - start;

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      // Not JSON
    }

    return new Response(
      JSON.stringify({
        success: result.statusCode >= 200 && result.statusCode < 400,
        statusCode: result.statusCode,
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

/**
 * Handle Solr document index
 * POST /api/solr/index
 * Adds or updates documents in a Solr core/collection.
 * Sends JSON documents to /solr/{core}/update/json/docs?commit=true
 */
export async function handleSolrIndex(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number; core: string;
      documents: Record<string, unknown>[];
      username?: string; password?: string;
      commit?: boolean; timeout?: number;
    };
    if (!body.host || !body.core || !Array.isArray(body.documents) || body.documents.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required: host, core, documents[]' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    const host = body.host;
    const port = body.port || 8983;
    const timeout = body.timeout || 15000;
    const commit = body.commit !== false;

    const validationError = validateInput(host, port, body.core);
    if (validationError) {
      return new Response(JSON.stringify({ success: false, error: validationError }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
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

    const authHeader = buildAuthHeader(body.username, body.password);

    const payload = JSON.stringify(body.documents);
    const path = '/solr/' + encodeURIComponent(body.core) + '/update/json/docs' + (commit ? '?commit=true' : '?commit=false');

    const result = await sendHttpRequest(host, port, 'POST', path, payload, authHeader, timeout);
    const ok = result.statusCode >= 200 && result.statusCode < 300;

    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(result.body) as Record<string, unknown>; } catch { /* raw */ }

    const responseHeader = parsed.responseHeader as Record<string, unknown> | undefined;
    const status = responseHeader?.status as number | undefined;
    const qtime = responseHeader?.QTime as number | undefined;

    return new Response(JSON.stringify({
      success: ok && status === 0,
      host, port, core: body.core,
      documentsIndexed: body.documents.length,
      committed: commit,
      status,
      qtime,
      httpStatus: result.statusCode,
      ...((!ok || status !== 0)
        ? { error: (parsed.error as Record<string, unknown>)?.msg || 'HTTP ' + result.statusCode }
        : { message: body.documents.length + ' document(s) indexed successfully' }),
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Index failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle Solr document delete
 * POST /api/solr/delete
 * Deletes documents by query or by ID list.
 */
export async function handleSolrDelete(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number; core: string;
      ids?: string[]; query?: string;
      username?: string; password?: string;
      commit?: boolean; timeout?: number;
    };
    if (!body.host || !body.core || (!body.ids?.length && !body.query)) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required: host, core, and either ids[] or query' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    const host = body.host;
    const port = body.port || 8983;
    const timeout = body.timeout || 10000;
    const commit = body.commit !== false;

    const validationError = validateInput(host, port, body.core);
    if (validationError) {
      return new Response(JSON.stringify({ success: false, error: validationError }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
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

    const authHeader = buildAuthHeader(body.username, body.password);

    const deleteCmd = body.ids
      ? { delete: body.ids.map((id: string) => ({ id })) }
      : { delete: { query: body.query } };
    const payload = JSON.stringify(deleteCmd);
    const path = '/solr/' + encodeURIComponent(body.core) + '/update' + (commit ? '?commit=true' : '?commit=false');

    const result = await sendHttpRequest(host, port, 'POST', path, payload, authHeader, timeout);
    const ok = result.statusCode >= 200 && result.statusCode < 300;

    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(result.body) as Record<string, unknown>; } catch { /* raw */ }

    const responseHeader = parsed.responseHeader as Record<string, unknown> | undefined;
    const status = responseHeader?.status as number | undefined;

    return new Response(JSON.stringify({
      success: ok && status === 0,
      host, port, core: body.core,
      deleteMode: body.ids ? 'by-id' : 'by-query',
      count: body.ids?.length,
      query: body.query,
      committed: commit, status, httpStatus: result.statusCode,
      ...((!ok || status !== 0) ? { error: 'HTTP ' + result.statusCode } : { message: 'Delete successful' }),
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Delete failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
