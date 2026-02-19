/**
 * Grafana HTTP API Worker
 *
 * Grafana is an open-source analytics and monitoring platform. This worker
 * communicates with Grafana's REST API over raw TCP (bypassing TLS on typical
 * internal deployments) using HTTP/1.1 GET and POST requests.
 *
 * Authentication (all sent as Authorization header):
 *   - Service account token: Authorization: Bearer <sa-token>
 *   - API key (legacy):      Authorization: Bearer <api-key>
 *   - Basic auth:            Authorization: Basic base64(user:pass)
 *
 * Request body fields:
 *   - `token`    → sent as Authorization: Bearer <token>
 *   - `apiKey`   → also sent as Authorization: Bearer <apiKey> (Grafana API
 *                   keys use the same Bearer scheme as service account tokens)
 *   - `username` + `password` → sent as Authorization: Basic base64(user:pass)
 *
 * Endpoints implemented:
 *   GET /api/health                         - server liveness + version (unauthenticated)
 *   GET /api/frontend/settings              - Grafana version, features
 *   GET /api/search?type=dash-db            - list dashboards
 *   GET /api/datasources                    - list datasources
 *   GET /api/folders                        - list folders
 *   GET /api/v1/provisioning/alert-rules    - alert rules (Grafana 9+)
 *   GET /api/org                            - current organisation
 *   GET /api/org/users                      - organisation users
 *   GET /api/dashboards/uid/:uid             - fetch dashboard by UID
 *   POST /api/dashboards/db                  - create/update a dashboard
 *   POST /api/annotations                    - create an annotation
 *
 * Default port: 3000
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// ---- shared types ----------------------------------------------------------

interface GrafanaBaseRequest {
  host: string;
  port?: number;
  timeout?: number;
  token?: string;    // Bearer token (service account or API token)
  apiKey?: string;   // Legacy API key (also sent as Bearer token)
  username?: string; // Basic auth username
  password?: string; // Basic auth password
}

interface GrafanaSearchRequest extends GrafanaBaseRequest {
  query?: string;
  limit?: number;
}

interface GrafanaCacheGetRequest extends GrafanaBaseRequest {
  uid: string;
}

// ---- low-level HTTP helpers -------------------------------------------------

/** Build the Authorization header value from the available credentials */
function buildAuthHeader(token?: string, apiKey?: string, username?: string, password?: string): string | null {
  if (token) return `Bearer ${token}`;
  if (apiKey) return `Bearer ${apiKey}`;
  if (username && password) return `Basic ${btoa(`${username}:${password}`)}`;
  return null;
}

/**
 * Build HTTP/1.1 GET headers, with optional Grafana auth.
 */
function buildGetRequest(
  hostname: string,
  port: number,
  path: string,
  token?: string,
  apiKey?: string,
  username?: string,
  password?: string,
): string {
  const hostHeader = port === 80 ? hostname : `${hostname}:${port}`;
  const lines = [
    `GET ${path} HTTP/1.1`,
    `Host: ${hostHeader}`,
    'Connection: close',
    'Accept: application/json',
    'User-Agent: PortOfCall/1.0',
  ];

  const auth = buildAuthHeader(token, apiKey, username, password);
  if (auth) lines.push(`Authorization: ${auth}`);

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
  port: number,
  path: string,
  token?: string,
  apiKey?: string,
  username?: string,
  password?: string,
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  try {
    await writer.write(new TextEncoder().encode(buildGetRequest(hostname, port, path, token, apiKey, username, password)));

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
  username?: string,
  password?: string,
): Promise<{ statusCode: number; data: unknown; headers: Record<string, string> }> {
  const start = Date.now();
  const socket = await openSocket(host, port, timeout);
  const elapsed = Date.now() - start;
  const remaining = Math.max(timeout - elapsed, 1000);
  try {
    const resp = await Promise.race([
      httpGet(socket, host, port, path, token, apiKey, username, password),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), remaining)
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
 *
 * Note: /api/health is unauthenticated — it always returns 200 regardless of
 * credentials. To detect whether auth is required, we probe /api/org which
 * returns 401/403 when anonymous access is disabled.
 *
 * Body: { host, port?, timeout?, token?, apiKey?, username?, password? }
 */
export async function handleGrafanaHealth(request: Request): Promise<Response> {
  if (request.method === 'GET') {
    // Legacy query-param support
    const url = new URL(request.url);
    const hostname = url.searchParams.get('hostname');
    const port = parseInt(url.searchParams.get('port') || '3000', 10);
    if (!hostname) return jsonError('Missing hostname parameter', 400);

    const cfCheck = await checkIfCloudflare(hostname);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(hostname, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

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

  const { host, port = 3000, timeout = 10000, token, apiKey, username, password } = body;
  if (!host) return jsonError('host is required', 400);

  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    return new Response(JSON.stringify({
      success: false,
      error: getCloudflareErrorMessage(host, cfCheck.ip),
      isCloudflare: true,
    }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    // /api/health is unauthenticated — always returns 200.
    // Probe /api/org (which requires auth) to determine auth state.
    const [health, settings, orgProbe] = await Promise.all([
      fetchJson(host, port, '/api/health', timeout, token, apiKey, username, password),
      fetchJson(host, port, '/api/frontend/settings', timeout, token, apiKey, username, password),
      fetchJson(host, port, '/api/org', timeout, token, apiKey, username, password),
    ]);

    const isAuthenticated = orgProbe.statusCode === 200;
    const authRequired = orgProbe.statusCode === 401 || orgProbe.statusCode === 403;

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
 * Body: { host, port?, timeout?, token?, apiKey?, username?, password? }
 */
export async function handleGrafanaDatasources(request: Request): Promise<Response> {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const hostname = url.searchParams.get('hostname');
    const port = parseInt(url.searchParams.get('port') || '3000', 10);
    if (!hostname) return jsonError('Missing hostname parameter', 400);

    const cfCheck = await checkIfCloudflare(hostname);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(hostname, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

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

  const { host, port = 3000, timeout = 10000, token, apiKey, username, password } = body;
  if (!host) return jsonError('host is required', 400);

  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    return new Response(JSON.stringify({
      success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
    }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const result = await fetchJson(host, port, '/api/datasources', timeout, token, apiKey, username, password);

    if (result.statusCode === 401 || result.statusCode === 403) {
      return jsonOk({
        success: false,
        statusCode: result.statusCode,
        error: 'Authentication required — provide token, apiKey, or username/password',
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
 * Body: { host, port?, timeout?, token?, apiKey?, username?, password?, query?, limit? }
 */
export async function handleGrafanaDashboards(request: Request): Promise<Response> {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const hostname = url.searchParams.get('hostname');
    const port = parseInt(url.searchParams.get('port') || '3000', 10);
    const query = url.searchParams.get('query') || '';
    const limit = url.searchParams.get('limit') || '50';
    if (!hostname) return jsonError('Missing hostname parameter', 400);

    const cfCheck = await checkIfCloudflare(hostname);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(hostname, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

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

  const { host, port = 3000, timeout = 10000, token, apiKey, username, password, query = '', limit = 50 } = body;
  if (!host) return jsonError('host is required', 400);

  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    return new Response(JSON.stringify({
      success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
    }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const path = `/api/search?type=dash-db&query=${encodeURIComponent(query)}&limit=${limit}`;
    const result = await fetchJson(host, port, path, timeout, token, apiKey, username, password);

    if (result.statusCode === 401 || result.statusCode === 403) {
      return jsonOk({
        success: false,
        statusCode: result.statusCode,
        error: 'Authentication required — provide token, apiKey, or username/password',
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
 * Body: { host, port?, timeout?, token?, apiKey?, username?, password? }
 */
export async function handleGrafanaFolders(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body: GrafanaBaseRequest;
  try { body = await request.json() as GrafanaBaseRequest; }
  catch { return jsonError('Invalid JSON body', 400); }

  const { host, port = 3000, timeout = 10000, token, apiKey, username, password } = body;
  if (!host) return jsonError('host is required', 400);

  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    return new Response(JSON.stringify({
      success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
    }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const result = await fetchJson(host, port, '/api/folders', timeout, token, apiKey, username, password);

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
 * Body: { host, port?, timeout?, token?, apiKey?, username?, password? }
 */
export async function handleGrafanaAlertRules(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body: GrafanaBaseRequest;
  try { body = await request.json() as GrafanaBaseRequest; }
  catch { return jsonError('Invalid JSON body', 400); }

  const { host, port = 3000, timeout = 10000, token, apiKey, username, password } = body;
  if (!host) return jsonError('host is required', 400);

  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    return new Response(JSON.stringify({
      success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
    }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const result = await fetchJson(host, port, '/api/v1/provisioning/alert-rules', timeout, token, apiKey, username, password);

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
 * Body: { host, port?, timeout?, token?, apiKey?, username?, password? }
 */
export async function handleGrafanaOrg(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body: GrafanaBaseRequest;
  try { body = await request.json() as GrafanaBaseRequest; }
  catch { return jsonError('Invalid JSON body', 400); }

  const { host, port = 3000, timeout = 10000, token, apiKey, username, password } = body;
  if (!host) return jsonError('host is required', 400);

  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    return new Response(JSON.stringify({
      success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
    }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const [orgResult, usersResult] = await Promise.all([
      fetchJson(host, port, '/api/org', timeout, token, apiKey, username, password),
      fetchJson(host, port, '/api/org/users', timeout, token, apiKey, username, password),
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
 * Body: { host, port?, timeout?, token?, apiKey?, username?, password?, uid }
 */
export async function handleGrafanaDashboard(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body: GrafanaCacheGetRequest;
  try { body = await request.json() as GrafanaCacheGetRequest; }
  catch { return jsonError('Invalid JSON body', 400); }

  const { host, port = 3000, timeout = 10000, token, apiKey, username, password, uid } = body;
  if (!host) return jsonError('host is required', 400);
  if (!uid)  return jsonError('uid is required', 400);

  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    return new Response(JSON.stringify({
      success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
    }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const result = await fetchJson(host, port, `/api/dashboards/uid/${encodeURIComponent(uid)}`, timeout, token, apiKey, username, password);

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

// ---- write helpers ----------------------------------------------------------

/**
 * Build HTTP/1.1 POST headers with JSON body, with optional Grafana auth.
 */
function buildPostRequest(
  hostname: string,
  port: number,
  path: string,
  body: string,
  token?: string,
  apiKey?: string,
  username?: string,
  password?: string,
): string {
  const bodyBytes = new TextEncoder().encode(body).length;
  const hostHeader = port === 80 ? hostname : `${hostname}:${port}`;
  const lines = [
    `POST ${path} HTTP/1.1`,
    `Host: ${hostHeader}`,
    'Connection: close',
    'Content-Type: application/json',
    'Accept: application/json',
    'User-Agent: PortOfCall/1.0',
    `Content-Length: ${bodyBytes}`,
  ];
  const auth = buildAuthHeader(token, apiKey, username, password);
  if (auth) lines.push(`Authorization: ${auth}`);
  lines.push('', body);
  return lines.join('\r\n');
}

/** Send an HTTP POST request over an open socket and return the parsed response. */
async function httpPost(
  socket: Socket,
  hostname: string,
  port: number,
  path: string,
  body: string,
  token?: string,
  apiKey?: string,
  username?: string,
  password?: string,
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  try {
    await writer.write(new TextEncoder().encode(buildPostRequest(hostname, port, path, body, token, apiKey, username, password)));
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (totalBytes < 10 * 1024 * 1024) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) { chunks.push(value); totalBytes += value.length; }
    }
    return parseHttpResponse(new TextDecoder().decode(mergeU8(chunks, totalBytes)));
  } finally {
    reader.releaseLock();
    writer.releaseLock();
  }
}

// ---- write endpoint handlers ------------------------------------------------

/**
 * Create a new Grafana dashboard.
 * POST /api/dashboards/db
 *
 * Request: { host, port?, timeout?, token?, apiKey?, username?, password?, title?, tags?, folderId?, folderUid? }
 * Response: { success, statusCode, dashboard, endpoint }
 */
export async function handleGrafanaDashboardCreate(request: Request): Promise<Response> {
  try {
    const body = await request.json() as GrafanaBaseRequest & {
      title?: string;
      tags?: string[];
      folderId?: number;   // Grafana <9: numeric folder ID (deprecated)
      folderUid?: string;  // Grafana 9+: folder UID (preferred)
    };
    const { host, port = 3000, timeout = 10000, token, apiKey, username, password } = body;
    if (!host) return jsonError('host is required', 400);

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const title = body.title ?? 'PortOfCall Test Dashboard';
    const tags = body.tags ?? ['portofcall'];
    // Grafana 9+ prefers folderUid; folderId kept for backward compat with Grafana <9.
    const folderUid = body.folderUid;
    const folderId = body.folderId ?? 0;

    const dashboardPayload = JSON.stringify({
      dashboard: { title, tags, timezone: 'browser', schemaVersion: 36, version: 0, panels: [] },
      folderId,
      ...(folderUid !== undefined ? { folderUid } : {}),
      overwrite: false,
    });

    const socket = await openSocket(host, port, timeout);
    try {
      const result = await httpPost(socket, host, port, '/api/dashboards/db', dashboardPayload, token, apiKey, username, password);
      if (result.statusCode === 401 || result.statusCode === 403) {
        return jsonOk({ success: false, statusCode: result.statusCode, error: 'Authentication required', endpoint: `${host}:${port}` });
      }
      return jsonOk({ success: result.statusCode === 200, statusCode: result.statusCode, dashboard: parseJsonBody(result.body), endpoint: `${host}:${port}` });
    } finally {
      socket.close();
    }
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'Failed to create dashboard', 500);
  }
}

/**
 * Create a Grafana annotation.
 * POST /api/annotations
 *
 * Request: { host, port?, timeout?, token?, apiKey?, username?, password?, text?, tags?, time?, timeEnd?, dashboardId?, panelId? }
 * Response: { success, statusCode, annotation, endpoint }
 */
export async function handleGrafanaAnnotationCreate(request: Request): Promise<Response> {
  try {
    const body = await request.json() as GrafanaBaseRequest & {
      text?: string;
      tags?: string[];
      time?: number;
      timeEnd?: number;
      dashboardId?: number;
      panelId?: number;
    };
    const { host, port = 3000, timeout = 10000, token, apiKey, username, password } = body;
    if (!host) return jsonError('host is required', 400);

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const annotation: Record<string, unknown> = {
      text: body.text ?? 'PortOfCall annotation',
      tags: body.tags ?? ['portofcall'],
      time: body.time ?? Date.now(),
    };
    if (body.timeEnd !== undefined) annotation.timeEnd = body.timeEnd;
    if (body.dashboardId !== undefined) annotation.dashboardId = body.dashboardId;
    if (body.panelId !== undefined) annotation.panelId = body.panelId;

    const socket = await openSocket(host, port, timeout);
    try {
      const result = await httpPost(socket, host, port, '/api/annotations', JSON.stringify(annotation), token, apiKey, username, password);
      if (result.statusCode === 401 || result.statusCode === 403) {
        return jsonOk({ success: false, statusCode: result.statusCode, error: 'Authentication required', endpoint: `${host}:${port}` });
      }
      return jsonOk({ success: result.statusCode === 200, statusCode: result.statusCode, annotation: parseJsonBody(result.body), endpoint: `${host}:${port}` });
    } finally {
      socket.close();
    }
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'Failed to create annotation', 500);
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
