/**
 * Meilisearch Protocol Implementation (HTTP REST API over TCP)
 *
 * Meilisearch is a modern full-text search engine with a RESTful HTTP API.
 * All operations are performed via HTTP methods against JSON endpoints.
 *
 * Key Endpoints:
 * - GET /health        → Health check (status: "available")
 * - GET /version       → Server version info
 * - GET /stats         → Global stats (indexes, db size)
 * - GET /indexes       → List all indexes
 * - POST /indexes/{uid}/search → Search an index
 *
 * Authentication: Bearer token (API key) via Authorization header
 * Default Port: 7700
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/**
 * Send a raw HTTP/1.1 request over a TCP socket
 */
async function sendHttpRequest(
  host: string,
  port: number,
  method: string,
  path: string,
  body?: string,
  apiKey?: string,
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

  if (apiKey) {
    request += `Authorization: Bearer ${apiKey}\r\n`;
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
  const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;

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
 * Handle Meilisearch health/info check
 *
 * POST /api/meilisearch/health
 * Body: { host, port?, apiKey?, timeout? }
 *
 * Returns health status, version info, and global stats
 */
export async function handleMeilisearchHealth(request: Request): Promise<Response> {
  try {
    const { host, port = 7700, apiKey, timeout = 15000 } = await request.json<{
      host: string;
      port?: number;
      apiKey?: string;
      timeout?: number;
    }>();

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required parameter: host' }), {
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

    const start = Date.now();

    // GET /health
    const healthResult = await sendHttpRequest(host, port, 'GET', '/health', undefined, apiKey, timeout);
    let health: unknown;
    try {
      health = JSON.parse(healthResult.body);
    } catch {
      health = healthResult.body;
    }

    // GET /version
    let version: unknown;
    try {
      const versionResult = await sendHttpRequest(host, port, 'GET', '/version', undefined, apiKey, timeout);
      if (versionResult.statusCode === 200) {
        version = JSON.parse(versionResult.body);
      }
    } catch {
      // Version endpoint might require auth
    }

    // GET /stats
    let stats: unknown;
    try {
      const statsResult = await sendHttpRequest(host, port, 'GET', '/stats', undefined, apiKey, timeout);
      if (statsResult.statusCode === 200) {
        stats = JSON.parse(statsResult.body);
      }
    } catch {
      // Stats endpoint might require auth
    }

    // GET /indexes
    let indexes: unknown;
    try {
      const indexesResult = await sendHttpRequest(host, port, 'GET', '/indexes', undefined, apiKey, timeout);
      if (indexesResult.statusCode === 200) {
        indexes = JSON.parse(indexesResult.body);
      }
    } catch {
      // Indexes endpoint might require auth
    }

    const latencyMs = Date.now() - start;

    return new Response(JSON.stringify({
      success: healthResult.statusCode >= 200 && healthResult.statusCode < 400,
      statusCode: healthResult.statusCode,
      health,
      version,
      stats,
      indexes,
      latencyMs,
      host,
      port,
    }), {
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
 * Handle Meilisearch search query
 *
 * POST /api/meilisearch/search
 * Body: { host, port?, apiKey?, index, query, limit?, offset?, timeout? }
 *
 * Searches a specific index
 */
export async function handleMeilisearchSearch(request: Request): Promise<Response> {
  try {
    const {
      host,
      port = 7700,
      apiKey,
      index,
      query,
      limit = 20,
      offset = 0,
      timeout = 15000,
    } = await request.json<{
      host: string;
      port?: number;
      apiKey?: string;
      index: string;
      query: string;
      limit?: number;
      offset?: number;
      timeout?: number;
    }>();

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!index) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required parameter: index' }), {
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

    const start = Date.now();

    const searchBody = JSON.stringify({
      q: query || '',
      limit,
      offset,
    });

    const encodedIndex = encodeURIComponent(index);
    const searchResult = await sendHttpRequest(
      host, port, 'POST', `/indexes/${encodedIndex}/search`, searchBody, apiKey, timeout,
    );

    const latencyMs = Date.now() - start;

    let parsed: unknown;
    try {
      parsed = JSON.parse(searchResult.body);
    } catch {
      parsed = null;
    }

    return new Response(JSON.stringify({
      success: searchResult.statusCode >= 200 && searchResult.statusCode < 400,
      statusCode: searchResult.statusCode,
      results: parsed,
      latencyMs,
      host,
      port,
      index,
      query,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Search failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle Meilisearch document add/update
 * POST /api/meilisearch/documents
 * Adds or updates documents in a Meilisearch index.
 * POST /indexes/{uid}/documents (upsert by primary key)
 */
export async function handleMeilisearchDocuments(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number; index: string;
      documents: Record<string, unknown>[];
      primary_key?: string; api_key?: string; timeout?: number;
    };
    if (!body.host || !body.index || !Array.isArray(body.documents) || body.documents.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required: host, index, documents[]' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    const host = body.host;
    const port = body.port || 7700;
    const timeout = body.timeout || 15000;
    const qs = body.primary_key ? ('?primaryKey=' + body.primary_key) : '';
    const path = '/indexes/' + body.index + '/documents' + qs;

    const result = await sendHttpRequest(host, port, 'POST', path, JSON.stringify(body.documents), body.api_key, timeout);
    const ok = result.statusCode >= 200 && result.statusCode < 300;

    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(result.body) as Record<string, unknown>; } catch { /* raw */ }

    return new Response(JSON.stringify({
      success: ok,
      host, port, index: body.index,
      documentsSubmitted: body.documents.length,
      httpStatus: result.statusCode,
      taskUid: parsed.taskUid,
      status: parsed.status,
      ...(ok
        ? { message: body.documents.length + ' document(s) submitted (task ' + parsed.taskUid + ')' }
        : { error: (parsed as { message?: string }).message || ('HTTP ' + result.statusCode) }),
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Document add failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle Meilisearch document delete
 * POST /api/meilisearch/delete
 * Deletes documents by ID list or deletes all documents.
 */
export async function handleMeilisearchDelete(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number; index: string;
      ids?: (string | number)[]; all?: boolean;
      api_key?: string; timeout?: number;
    };
    if (!body.host || !body.index || (!body.ids?.length && !body.all)) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required: host, index, and either ids[] or all:true' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    const host = body.host;
    const port = body.port || 7700;
    const timeout = body.timeout || 10000;

    let path: string;
    let method: string;
    let reqBody: string | undefined;

    if (body.all) {
      path = '/indexes/' + body.index + '/documents';
      method = 'DELETE';
    } else {
      path = '/indexes/' + body.index + '/documents/delete-batch';
      method = 'POST';
      reqBody = JSON.stringify(body.ids);
    }

    const result = await sendHttpRequest(host, port, method, path, reqBody, body.api_key, timeout);
    const ok = result.statusCode >= 200 && result.statusCode < 300;

    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(result.body) as Record<string, unknown>; } catch { /* raw */ }

    return new Response(JSON.stringify({
      success: ok,
      host, port, index: body.index,
      mode: body.all ? 'all' : 'by-ids',
      count: body.ids?.length,
      httpStatus: result.statusCode,
      taskUid: parsed.taskUid,
      ...(ok
        ? { message: body.all ? 'All documents deleted' : (body.ids?.length + ' document(s) deleted') }
        : { error: (parsed as { message?: string }).message || ('HTTP ' + result.statusCode) }),
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Delete failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
