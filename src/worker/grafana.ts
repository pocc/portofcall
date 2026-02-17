/**
 * Grafana HTTP API Worker
 *
 * Grafana is an open-source analytics and monitoring platform. This worker
 * communicates with Grafana's REST API over raw TCP (bypassing TLS on typical
 * internal deployments) using HTTP/1.1 GET and POST requests.
 *
 * Authentication:
 *   - Bearer token:   Authorization: Bearer <token>
 *   - API key:        X-Grafana-API-Key: <key>  (legacy)
 *   - Both are passed in the request body as `token` or `apiKey`
 *
 * Endpoints implemented:
 *   GET /api/health                         - server liveness + version
 *   GET /api/frontend/settings              - Grafana version, features
 *   GET /api/search?type=dash-db            - list dashboards
 *   GET /api/datasources                    - list datasources
 *   GET /api/folders                        - list folders
 *   GET /api/v1/provisioning/alert-rules    - alert rules (Grafana 9+)
 *   GET /api/org                            - current organisation
 *   GET /api/org/users                      - organisation users
 *
 * Default port: 3000
 */

import { connect } from 'cloudflare:sockets';

// ---- shared types ----------------------------------------------------------

interface GrafanaBaseRequest {
  host: string;
  port?: number;
  timeout?: number;
  token?: string;   // Bearer token (service account or API token)
  apiKey?: string;  // Legacy X-Grafana-API-Key header
}

interface GrafanaSearchRequest extends GrafanaBaseRequest {
  query?: string;
  limit?: number;
}

interface GrafanaCacheGetRequest extends GrafanaBaseRequest {
  uid: string;
}

// ---- low-level HTTP helpers -------------------------------------------------

/**
 * Build HTTP/1.1 GET headers, with optional Grafana auth.
 */
function buildGetRequest(
  hostname: string,
  path: string,
  token?: string,
  apiKey?: string,
): string {
  const lines = [
    `GET ${path} HTTP/1.1`,
    `Host: ${hostname}`,
    'Connection: close',
    'Accept: application/json',
    'User-Agent: PortOfCall/1.0',
  ];

  if (token) {
    lines.push(`Authorization: Bearer ${token}`);
  } else if (apiKey) {
    lines.push(`X-Grafana-API-Key: ${apiKey}`);
  }

  lines.push('', '');
  return lines.join('\r\n');
}

type Socket = ReturnType<typeof connect>;

/**
 * Send an HTTP GET request over an open socket and return the parsed response.
 */
async function httpGet(
  socket: Socket,
  hostname: string,
  path: string,
  token?: string,
  apiKey?: string,
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  try {
    await writer.write(new TextEncoder().encode(buildGetRequest(hostname, path, token, apiKey)));

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const maxBytes = 10 * 1024 * 1024; // 10 MB safety cap

    while (totalBytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        totalBytes += value.length;
      }
    }

    const raw = new TextDecoder().decode(mergeU8(chunks, totalBytes));
    return parseHttpResponse(raw);

  } finally {
    reader.releaseLock();
    writer.releaseLock();
  }
}

function mergeU8(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function parseHttpResponse(raw: string): {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
} {
  const headerEnd = raw.indexOf('\r\n\r\n');
  if (headerEnd === -1) return { statusCode: 0, headers: {}, body: raw };

  const headerSection = raw.substring(0, headerEnd);
  const rawBody = raw.substring(headerEnd + 4);
  const lines = headerSection.split('\r\n');

  const statusLine = lines[0] ?? '';
  const statusMatch = statusLine.match(/HTTP\/[\d.]+ (\d{3})/);
  const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;

  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    if (colon !== -1) {
      headers[line.substring(0, colon).trim().toLowerCase()] = line.substring(colon + 1).trim();
    }
  }

  // Decode chunked transfer encoding
  let body = rawBody;
  if (headers['transfer-encoding']?.includes('chunked')) {
    body = decodeChunked(rawBody);
  }

  return { statusCode, headers, body };
}

function decodeChunked(raw: string): string {
  const parts: string[] = [];
  let pos = 0;
  while (pos < raw.length) {
    const crlf = raw.indexOf('\r\n', pos);
    if (crlf === -1) break;
    const sizeHex = raw.substring(pos, crlf).trim();
    const size = parseInt(sizeHex, 16);
    if (isNaN(size) || size === 0) break;
    const start = crlf + 2;
    parts.push(raw.substring(start, start + size));
    pos = start + size + 2;
  }
  return parts.join('');
}

/** Parse JSON body; return the raw string on failure */
function parseJsonBody(body: string): unknown {
  try { return JSON.parse(body); } catch { return { raw: body.substring(0, 2000) }; }
}

/** Open a fresh TCP socket with a timeout race */
async function openSocket(host: string, port: number, timeout: number): Promise<Socket> {
  const socket = connect({ hostname: host, port });
  await Promise.race([
    socket.opened,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Connection timeout to ${host}:${port}`)), timeout)
    ),
  ]);
  return socket;
}

/** Wrap an HTTP GET call in a fresh socket, close when done */
async function fetchJson(
  host: string,
  port: number,
  path: string,
  timeout: number,
  token?: string,
  apiKey?: string,
): Promise<{ statusCode: number; data: unknown; headers: Record<string, string> }> {
  const socket = await openSocket(host, port, timeout);
  try {
    const resp = await Promise.race([
      httpGet(socket, host, path, token, apiKey),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), timeout)
      ),
    ]);
    return { statusCode: resp.statusCode, data: parseJsonBody(resp.body), headers: resp.headers };
  } finally {
    try { socket.close(); } catch { /* ignore */ }
  }
}

// ---- exported handlers ------------------------------------------------------

/**
 * POST /api/grafana/health
 * Returns Grafana liveness status and front-end settings.
 * Body: { host, port?, timeout?, token?, apiKey? }
 */
export async function handleGrafanaHealth(request: Request): Promise<Response> {
  if (request.method === 'GET') {
    // Legacy query-param support
    const url = new URL(request.url);
    const hostname = url.searchParams.get('hostname');
    const port = parseInt(url.searchParams.get('port') || '3000', 10);
    if (!hostname) return jsonError('Missing hostname parameter', 400);

    try {
      const [health, settings] = await Promise.all([
        fetchJson(hostname, port, '/api/health', 10000),
        fetchJson(hostname, port, '/api/frontend/settings', 10000),
      ]);
      return jsonOk({
        success: true,
        endpoint: `${hostname}:${port}`,
        health: health.data,
        settings: settings.data,
      });
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : 'Unknown error', 500);
    }
  }

  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body: GrafanaBaseRequest;
  try { body = await request.json() as GrafanaBaseRequest; }
  catch { return jsonError('Invalid JSON body', 400); }

  const { host, port = 3000, timeout = 10000, token, apiKey } = body;
  if (!host) return jsonError('host is required', 400);

  try {
    const [health, settings] = await Promise.all([
      fetchJson(host, port, '/api/health', timeout, token, apiKey),
      fetchJson(host, port, '/api/frontend/settings', timeout, token, apiKey),
    ]);

    const isAuthenticated = health.statusCode === 200;
    const authRequired = health.statusCode === 401 || health.statusCode === 403;

    return jsonOk({
      success: true,
      endpoint: `${host}:${port}`,
      statusCode: health.statusCode,
      authenticated: isAuthenticated,
      authRequired,
      health: health.data,
      settings: settings.data,
    });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'Unknown error', 500);
  }
}

/**
 * POST /api/grafana/datasources
 * Returns the list of configured datasources.
 * Body: { host, port?, timeout?, token?, apiKey? }
 */
export async function handleGrafanaDatasources(request: Request): Promise<Response> {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const hostname = url.searchParams.get('hostname');
    const port = parseInt(url.searchParams.get('port') || '3000', 10);
    if (!hostname) return jsonError('Missing hostname parameter', 400);
    try {
      const result = await fetchJson(hostname, port, '/api/datasources', 10000);
      const ds = Array.isArray(result.data) ? result.data : [];
      return jsonOk({ success: true, datasources: ds, count: ds.length, endpoint: `${hostname}:${port}` });
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : 'Unknown error', 500);
    }
  }

  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body: GrafanaBaseRequest;
  try { body = await request.json() as GrafanaBaseRequest; }
  catch { return jsonError('Invalid JSON body', 400); }

  const { host, port = 3000, timeout = 10000, token, apiKey } = body;
  if (!host) return jsonError('host is required', 400);

  try {
    const result = await fetchJson(host, port, '/api/datasources', timeout, token, apiKey);

    if (result.statusCode === 401 || result.statusCode === 403) {
      return jsonOk({
        success: false,
        statusCode: result.statusCode,
        error: 'Authentication required — provide token or apiKey',
        endpoint: `${host}:${port}`,
      });
    }

    const datasources = Array.isArray(result.data) ? result.data : [];
    return jsonOk({
      success: true,
      statusCode: result.statusCode,
      datasources,
      count: datasources.length,
      endpoint: `${host}:${port}`,
    });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'Failed to fetch datasources', 500);
  }
}

/**
 * POST /api/grafana/dashboards
 * Searches dashboards via /api/search?type=dash-db.
 * Body: { host, port?, timeout?, token?, apiKey?, query?, limit? }
 */
export async function handleGrafanaDashboards(request: Request): Promise<Response> {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const hostname = url.searchParams.get('hostname');
    const port = parseInt(url.searchParams.get('port') || '3000', 10);
    const query = url.searchParams.get('query') || '';
    const limit = url.searchParams.get('limit') || '50';
    if (!hostname) return jsonError('Missing hostname parameter', 400);
    try {
      const path = `/api/search?type=dash-db&query=${encodeURIComponent(query)}&limit=${limit}`;
      const result = await fetchJson(hostname, port, path, 10000);
      const dbs = Array.isArray(result.data) ? result.data : [];
      return jsonOk({ success: true, dashboards: dbs, count: dbs.length, query, endpoint: `${hostname}:${port}` });
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : 'Unknown error', 500);
    }
  }

  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body: GrafanaSearchRequest;
  try { body = await request.json() as GrafanaSearchRequest; }
  catch { return jsonError('Invalid JSON body', 400); }

  const { host, port = 3000, timeout = 10000, token, apiKey, query = '', limit = 50 } = body;
  if (!host) return jsonError('host is required', 400);

  try {
    const path = `/api/search?type=dash-db&query=${encodeURIComponent(query)}&limit=${limit}`;
    const result = await fetchJson(host, port, path, timeout, token, apiKey);

    if (result.statusCode === 401 || result.statusCode === 403) {
      return jsonOk({
        success: false,
        statusCode: result.statusCode,
        error: 'Authentication required — provide token or apiKey',
        endpoint: `${host}:${port}`,
      });
    }

    const dashboards = Array.isArray(result.data) ? result.data : [];
    return jsonOk({
      success: true,
      statusCode: result.statusCode,
      dashboards,
      count: dashboards.length,
      query,
      endpoint: `${host}:${port}`,
    });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'Failed to search dashboards', 500);
  }
}

/**
 * POST /api/grafana/folders
 * Returns the list of Grafana folders.
 * Body: { host, port?, timeout?, token?, apiKey? }
 */
export async function handleGrafanaFolders(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body: GrafanaBaseRequest;
  try { body = await request.json() as GrafanaBaseRequest; }
  catch { return jsonError('Invalid JSON body', 400); }

  const { host, port = 3000, timeout = 10000, token, apiKey } = body;
  if (!host) return jsonError('host is required', 400);

  try {
    const result = await fetchJson(host, port, '/api/folders', timeout, token, apiKey);

    if (result.statusCode === 401 || result.statusCode === 403) {
      return jsonOk({
        success: false,
        statusCode: result.statusCode,
        error: 'Authentication required',
        endpoint: `${host}:${port}`,
      });
    }

    const folders = Array.isArray(result.data) ? result.data : [];
    return jsonOk({
      success: true,
      statusCode: result.statusCode,
      folders,
      count: folders.length,
      endpoint: `${host}:${port}`,
    });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'Failed to fetch folders', 500);
  }
}

/**
 * POST /api/grafana/alert-rules
 * Returns provisioned alert rules (Grafana Alerting, v9+).
 * Body: { host, port?, timeout?, token?, apiKey? }
 */
export async function handleGrafanaAlertRules(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body: GrafanaBaseRequest;
  try { body = await request.json() as GrafanaBaseRequest; }
  catch { return jsonError('Invalid JSON body', 400); }

  const { host, port = 3000, timeout = 10000, token, apiKey } = body;
  if (!host) return jsonError('host is required', 400);

  try {
    const result = await fetchJson(host, port, '/api/v1/provisioning/alert-rules', timeout, token, apiKey);

    if (result.statusCode === 401 || result.statusCode === 403) {
      return jsonOk({
        success: false,
        statusCode: result.statusCode,
        error: 'Authentication required',
        endpoint: `${host}:${port}`,
      });
    }

    if (result.statusCode === 404) {
      return jsonOk({
        success: false,
        statusCode: 404,
        error: 'Provisioning API not available (requires Grafana 9+)',
        endpoint: `${host}:${port}`,
      });
    }

    const rules = Array.isArray(result.data) ? result.data : [];
    return jsonOk({
      success: true,
      statusCode: result.statusCode,
      alertRules: rules,
      count: rules.length,
      endpoint: `${host}:${port}`,
    });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'Failed to fetch alert rules', 500);
  }
}

/**
 * POST /api/grafana/org
 * Returns the current organisation and its users.
 * Body: { host, port?, timeout?, token?, apiKey? }
 */
export async function handleGrafanaOrg(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body: GrafanaBaseRequest;
  try { body = await request.json() as GrafanaBaseRequest; }
  catch { return jsonError('Invalid JSON body', 400); }

  const { host, port = 3000, timeout = 10000, token, apiKey } = body;
  if (!host) return jsonError('host is required', 400);

  try {
    const [orgResult, usersResult] = await Promise.all([
      fetchJson(host, port, '/api/org', timeout, token, apiKey),
      fetchJson(host, port, '/api/org/users', timeout, token, apiKey),
    ]);

    if (orgResult.statusCode === 401 || orgResult.statusCode === 403) {
      return jsonOk({
        success: false,
        statusCode: orgResult.statusCode,
        error: 'Authentication required',
        endpoint: `${host}:${port}`,
      });
    }

    const users = Array.isArray(usersResult.data) ? usersResult.data : [];
    return jsonOk({
      success: true,
      statusCode: orgResult.statusCode,
      org: orgResult.data,
      users,
      userCount: users.length,
      endpoint: `${host}:${port}`,
    });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'Failed to fetch org info', 500);
  }
}

/**
 * POST /api/grafana/dashboard
 * Fetch a specific dashboard by UID.
 * Body: { host, port?, timeout?, token?, apiKey?, uid }
 */
export async function handleGrafanaDashboard(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body: GrafanaCacheGetRequest;
  try { body = await request.json() as GrafanaCacheGetRequest; }
  catch { return jsonError('Invalid JSON body', 400); }

  const { host, port = 3000, timeout = 10000, token, apiKey, uid } = body;
  if (!host) return jsonError('host is required', 400);
  if (!uid)  return jsonError('uid is required', 400);

  try {
    const result = await fetchJson(host, port, `/api/dashboards/uid/${encodeURIComponent(uid)}`, timeout, token, apiKey);

    if (result.statusCode === 401 || result.statusCode === 403) {
      return jsonOk({ success: false, statusCode: result.statusCode, error: 'Authentication required', endpoint: `${host}:${port}` });
    }
    if (result.statusCode === 404) {
      return jsonOk({ success: false, statusCode: 404, error: `Dashboard UID not found: ${uid}`, endpoint: `${host}:${port}` });
    }

    return jsonOk({ success: true, statusCode: result.statusCode, dashboard: result.data, endpoint: `${host}:${port}` });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'Failed to fetch dashboard', 500);
  }
}

// ---- helpers ----------------------------------------------------------------

function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
