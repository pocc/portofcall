/**
 * Kibana Protocol Implementation (HTTP API over TCP)
 *
 * Kibana is the visualization and dashboarding layer for Elasticsearch
 * and OpenSearch. It provides an HTTP REST API for querying server status,
 * managing saved objects (dashboards, visualizations), and checking features.
 *
 * Protocol Flow:
 * 1. Client connects to Kibana HTTP API port (default 5601)
 * 2. Client sends HTTP/1.1 requests
 * 3. Mutating requests (POST/PUT/DELETE) require the kbn-xsrf header
 * 4. Server responds with JSON data
 *
 * Authentication:
 * - Basic auth: Authorization: Basic base64(user:pass)
 * - API key: Authorization: ApiKey <encoded_key>
 * - /api/status is unauthenticated by default
 *
 * Endpoints:
 * - GET /api/status              -> Server health, version, and plugin status (unauthenticated)
 * - GET /api/saved_objects/_find -> Search saved objects (dashboards, etc.)
 * - GET /api/data_views          -> List data views / index patterns (v8+)
 * - GET /api/alerting/rules/_find -> List alerting rules (v8+)
 * - POST /api/console/proxy      -> Proxy queries to Elasticsearch
 *
 * Docs: https://www.elastic.co/guide/en/kibana/current/api.html
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Send a raw HTTP/1.1 GET request over a TCP socket and parse the response.
 * Does not include kbn-xsrf (not required for GET requests) or auth headers.
 */
async function sendHttpGet(
  host: string,
  port: number,
  path: string,
  timeout = 15000,
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  await Promise.race([socket.opened, timeoutPromise]);

  const writer = socket.writable.getWriter();

  let request = `GET ${path} HTTP/1.1\r\n`;
  request += `Host: ${host}:${port}\r\n`;
  request += `Accept: application/json\r\n`;
  request += `Connection: close\r\n`;
  request += `User-Agent: PortOfCall/1.0\r\n`;
  request += `\r\n`;

  await writer.write(encoder.encode(request));
  writer.releaseLock();

  const reader = socket.readable.getReader();
  let response = '';
  const startTime = Date.now();

  try {
    while (true) {
      const { value, done } = await Promise.race([
        reader.read(),
        timeoutPromise.then(() => ({ value: undefined, done: true as const })),
      ]);
      if (done || !value) break;
      response += decoder.decode(value, { stream: true });
      if (response.length > 512_000) break;
    }
  } catch {
    // Connection closed or timeout
  } finally {
    reader.releaseLock();
    socket.close();
  }

  const elapsed = Date.now() - startTime;

  // Parse HTTP response
  const headerEnd = response.indexOf('\r\n\r\n');
  if (headerEnd === -1) {
    throw new Error(`Invalid HTTP response (no header terminator) after ${elapsed}ms`);
  }

  const headerSection = response.substring(0, headerEnd);
  let body = response.substring(headerEnd + 4);

  const headerLines = headerSection.split('\r\n');
  const statusLine = headerLines[0];
  const statusMatch = statusLine.match(/HTTP\/[\d.]+\s+(\d+)/);
  const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;

  const headers: Record<string, string> = {};
  for (let i = 1; i < headerLines.length; i++) {
    const colonIdx = headerLines[i].indexOf(':');
    if (colonIdx > 0) {
      const key = headerLines[i].substring(0, colonIdx).trim().toLowerCase();
      const val = headerLines[i].substring(colonIdx + 1).trim();
      headers[key] = val;
    }
  }

  // Handle chunked transfer encoding
  if (headers['transfer-encoding']?.includes('chunked')) {
    let decoded = '';
    let remaining = body;
    while (remaining.length > 0) {
      const lineEnd = remaining.indexOf('\r\n');
      if (lineEnd === -1) break;
      // Strip chunk extensions (;extension=value) per RFC 7230 §4.1
      const chunkSizeLine = remaining.substring(0, lineEnd);
      const semiIdx = chunkSizeLine.indexOf(';');
      const chunkSizeHex = semiIdx > 0 ? chunkSizeLine.substring(0, semiIdx) : chunkSizeLine;
      const chunkSize = parseInt(chunkSizeHex, 16);
      if (isNaN(chunkSize)) break;
      if (chunkSize === 0) {
        // Last chunk - remaining contains optional trailer headers and final CRLF
        break;
      }
      decoded += remaining.substring(lineEnd + 2, lineEnd + 2 + chunkSize);
      remaining = remaining.substring(lineEnd + 2 + chunkSize + 2);
    }
    body = decoded;
  }

  return { statusCode, headers, body };
}

/**
 * Status & Health probe: checks server status, version, and overall health.
 * Uses GET /api/status which is unauthenticated by default in Kibana.
 */
export async function handleKibanaStatus(request: Request): Promise<Response> {
  try {
    const { host, port = 5601 } = await request.json() as { host: string; port?: number };
    if (!host) {
      return new Response(JSON.stringify({ error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ error: getCloudflareErrorMessage(host, cfCheck.ip) }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();
    const resp = await sendHttpGet(host, port, '/api/status');
    const elapsed = Date.now() - startTime;

    let parsed: Record<string, unknown> | null = null;
    if (resp.statusCode === 200) {
      try {
        parsed = JSON.parse(resp.body);
      } catch {
        parsed = { raw: resp.body.substring(0, 2000) };
      }
    }

    // Extract key info from status response
    const status = parsed as Record<string, unknown> | null;
    const version = status?.version as Record<string, string> | undefined;
    const overallStatus = status?.status as Record<string, unknown> | undefined;
    const overall = overallStatus?.overall as Record<string, string> | undefined;

    return new Response(JSON.stringify({
      success: resp.statusCode === 200,
      host,
      port,
      statusCode: resp.statusCode,
      version: version ? {
        number: version.number,
        buildHash: version.build_hash?.substring(0, 12),
        buildNumber: version.build_number,
        buildSnapshot: version.build_snapshot,
      } : null,
      health: overall ? {
        state: overall.state || overall.level,
        title: overall.title,
        nickname: overall.nickname,
      } : null,
      pluginCount: status?.status ? Object.keys((status.status as Record<string, unknown>).statuses || {}).length : 0,
      responseTime: elapsed,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (e: unknown) {
    return new Response(JSON.stringify({
      error: e instanceof Error ? e.message : String(e),
    }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Saved objects search - find dashboards, visualizations, index patterns, etc.
 * Uses GET /api/saved_objects/_find which requires authentication on secured deployments.
 */
export async function handleKibanaSavedObjects(request: Request): Promise<Response> {
  try {
    const {
      host, port = 5601, type = 'dashboard', perPage = 20,
      username, password, api_key, space, timeout = 15000,
    } = await request.json() as {
      host: string; port?: number; type?: string; perPage?: number;
      username?: string; password?: string; api_key?: string;
      space?: string; timeout?: number;
    };
    if (!host) {
      return new Response(JSON.stringify({ error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ error: getCloudflareErrorMessage(host, cfCheck.ip) }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }

    const prefix = space ? `/s/${space}` : '';
    const startTime = Date.now();
    const path = `${prefix}/api/saved_objects/_find?type=${encodeURIComponent(type)}&per_page=${perPage}`;
    const resp = await sendHttpWithAuth(host, port, 'GET', path, undefined, username, password, api_key, timeout);
    const elapsed = Date.now() - startTime;

    let parsed: Record<string, unknown> | null = null;
    if (resp.statusCode === 200) {
      try {
        parsed = JSON.parse(resp.body);
      } catch {
        parsed = { raw: resp.body.substring(0, 2000) };
      }
    }

    const savedObjects = parsed?.saved_objects as Array<Record<string, unknown>> | undefined;

    return new Response(JSON.stringify({
      success: resp.statusCode === 200,
      host,
      port,
      type,
      statusCode: resp.statusCode,
      total: parsed?.total ?? 0,
      perPage: parsed?.per_page ?? perPage,
      objects: savedObjects?.map(obj => ({
        id: obj.id,
        type: obj.type,
        title: (obj.attributes as Record<string, string>)?.title || 'Untitled',
        description: (obj.attributes as Record<string, string>)?.description || '',
        updated: obj.updated_at,
      })) ?? [],
      responseTime: elapsed,
      error: resp.statusCode !== 200 ? resp.body.substring(0, 500) : undefined,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (e: unknown) {
    return new Response(JSON.stringify({
      error: e instanceof Error ? e.message : String(e),
    }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Send an HTTP request with optional Basic/API key auth, supporting any method.
 * The kbn-xsrf header is only included for mutating methods (POST, PUT, DELETE)
 * as required by the Kibana API.
 */
async function sendHttpWithAuth(
  host: string,
  port: number,
  method: string,
  path: string,
  body?: string,
  username?: string,
  password?: string,
  apiKey?: string,
  timeout = 15000,
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const socket = connect(`${host}:${port}`);
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  await Promise.race([socket.opened, timeoutPromise]);
  const writer = socket.writable.getWriter();

  let req = `${method} ${path} HTTP/1.1\r\n`;
  req += `Host: ${host}:${port}\r\n`;
  req += `Accept: application/json\r\n`;

  // kbn-xsrf is required only for mutating requests (POST, PUT, DELETE)
  const upperMethod = method.toUpperCase();
  if (upperMethod === 'POST' || upperMethod === 'PUT' || upperMethod === 'DELETE') {
    req += `kbn-xsrf: true\r\n`;
  }

  req += `Connection: close\r\n`;
  req += `User-Agent: PortOfCall/1.0\r\n`;

  if (apiKey) {
    req += `Authorization: ApiKey ${apiKey}\r\n`;
  } else if (username && password) {
    const authBytes = new TextEncoder().encode(`${username}:${password}`);
    let authBinary = '';
    for (const byte of authBytes) authBinary += String.fromCharCode(byte);
    req += `Authorization: Basic ${btoa(authBinary)}\r\n`;
  }

  if (body) {
    const bodyBytes = encoder.encode(body);
    req += `Content-Type: application/json\r\n`;
    req += `Content-Length: ${bodyBytes.length}\r\n\r\n`;
    await writer.write(encoder.encode(req));
    await writer.write(bodyBytes);
  } else {
    req += `\r\n`;
    await writer.write(encoder.encode(req));
  }
  writer.releaseLock();

  const reader = socket.readable.getReader();
  let response = '';
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
      if (done || !value) break;
      response += decoder.decode(value, { stream: true });
      if (response.length > 512_000) break;
    }
  } catch { /* timeout or close */ } finally {
    reader.releaseLock();
    socket.close();
  }

  const headerEnd = response.indexOf('\r\n\r\n');
  if (headerEnd === -1) throw new Error('Invalid HTTP response');

  const headerSection = response.substring(0, headerEnd);
  let bodySection = response.substring(headerEnd + 4);
  const statusMatch = headerSection.split('\r\n')[0].match(/HTTP\/[\d.]+\s+(\d+)/);
  const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;

  const respHeaders: Record<string, string> = {};
  for (const line of headerSection.split('\r\n').slice(1)) {
    const ci = line.indexOf(':');
    if (ci > 0) respHeaders[line.substring(0, ci).trim().toLowerCase()] = line.substring(ci + 1).trim();
  }

  if (respHeaders['transfer-encoding']?.includes('chunked')) {
    let decoded = '';
    let remaining = bodySection;
    while (remaining.length > 0) {
      const le = remaining.indexOf('\r\n');
      if (le === -1) break;
      // Strip chunk extensions (;extension=value) per RFC 7230 §4.1
      const chunkLine = remaining.substring(0, le);
      const semiIdx = chunkLine.indexOf(';');
      const chunkHex = semiIdx > 0 ? chunkLine.substring(0, semiIdx) : chunkLine;
      const cs = parseInt(chunkHex, 16);
      if (isNaN(cs)) break;
      if (cs === 0) {
        // Last chunk - remaining contains optional trailer headers and final CRLF
        break;
      }
      decoded += remaining.substring(le + 2, le + 2 + cs);
      remaining = remaining.substring(le + 2 + cs + 2);
    }
    bodySection = decoded;
  }

  return { statusCode, headers: respHeaders, body: bodySection };
}

/**
 * List Kibana data views / index patterns.
 * GET /api/data_views (v8+) or /api/index_patterns (v7)
 *
 * Accept JSON: {host, port?, username?, password?, api_key?, space?, timeout?}
 */
export async function handleKibanaIndexPatterns(request: Request): Promise<Response> {
  try {
    const {
      host, port = 5601, username, password, api_key, space, timeout = 15000,
    } = await request.json() as {
      host: string; port?: number; username?: string; password?: string;
      api_key?: string; space?: string; timeout?: number;
    };

    if (!host) {
      return new Response(JSON.stringify({ error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ error: getCloudflareErrorMessage(host, cfCheck.ip) }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }

    const prefix = space ? `/s/${space}` : '';
    const start = Date.now();

    let resp = await sendHttpWithAuth(host, port, 'GET', `${prefix}/api/data_views`, undefined, username, password, api_key, timeout);
    if (resp.statusCode === 404) {
      resp = await sendHttpWithAuth(host, port, 'GET', `${prefix}/api/index_patterns`, undefined, username, password, api_key, timeout);
    }

    const elapsed = Date.now() - start;
    let parsed: Record<string, unknown> | null = null;
    try { parsed = JSON.parse(resp.body); } catch { parsed = null; }

    const dataViews = ((parsed?.data_views || parsed?.index_patterns) as Array<Record<string, unknown>>) ?? [];

    return new Response(JSON.stringify({
      success: resp.statusCode === 200, host, port, statusCode: resp.statusCode, responseTime: elapsed,
      total: dataViews.length,
      dataViews: dataViews.map(dv => ({
        id: dv.id, name: dv.name || dv.title, title: dv.title,
        timeFieldName: dv.timeFieldName, namespaces: dv.namespaces,
      })),
      error: resp.statusCode !== 200 ? resp.body.substring(0, 500) : undefined,
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * List Kibana alerting rules.
 * GET /api/alerting/rules/_find (v8+) with fallback to GET /api/alerts/_find (v7).
 *
 * Accept JSON: {host, port?, username?, password?, api_key?, space?, timeout?}
 */
export async function handleKibanaAlerts(request: Request): Promise<Response> {
  try {
    const {
      host, port = 5601, username, password, api_key, space, timeout = 15000,
    } = await request.json() as {
      host: string; port?: number; username?: string; password?: string;
      api_key?: string; space?: string; timeout?: number;
    };

    if (!host) {
      return new Response(JSON.stringify({ error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ error: getCloudflareErrorMessage(host, cfCheck.ip) }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }

    const prefix = space ? `/s/${space}` : '';
    const start = Date.now();

    let resp = await sendHttpWithAuth(
      host, port, 'GET', `${prefix}/api/alerting/rules/_find?per_page=50`,
      undefined, username, password, api_key, timeout,
    );
    if (resp.statusCode === 404) {
      resp = await sendHttpWithAuth(
        host, port, 'GET', `${prefix}/api/alerts/_find?per_page=50`,
        undefined, username, password, api_key, timeout,
      );
    }

    const elapsed = Date.now() - start;
    let parsed: Record<string, unknown> | null = null;
    try { parsed = JSON.parse(resp.body); } catch { parsed = null; }

    const rules = (parsed?.data as Array<Record<string, unknown>>) ?? [];

    return new Response(JSON.stringify({
      success: resp.statusCode === 200, host, port, statusCode: resp.statusCode, responseTime: elapsed,
      total: parsed?.total ?? rules.length,
      rules: rules.map(r => ({
        id: r.id, name: r.name, enabled: r.enabled,
        ruleTypeId: r.rule_type_id || r.alertTypeId, schedule: r.schedule,
        tags: r.tags, executionStatus: r.execution_status,
        lastRun: r.last_run, nextRun: r.next_run,
      })),
      error: resp.statusCode !== 200 ? resp.body.substring(0, 500) : undefined,
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Proxy a query through the Kibana console API to Elasticsearch.
 * POST /api/console/proxy?path=<es_path>&method=GET
 *
 * The path parameter should contain the Elasticsearch path with literal slashes
 * (e.g., path=/_cat/indices), not percent-encoded slashes.
 *
 * Accept JSON: {host, port?, username?, password?, api_key?, query?, body?, space?, timeout?}
 */
export async function handleKibanaQuery(request: Request): Promise<Response> {
  try {
    const {
      host, port = 5601, username, password, api_key, space,
      query = '_cat/indices?v', body: esBody, timeout = 15000,
    } = await request.json() as {
      host: string; port?: number; username?: string; password?: string;
      api_key?: string; space?: string; query?: string; body?: string; timeout?: number;
    };

    if (!host) {
      return new Response(JSON.stringify({ error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ error: getCloudflareErrorMessage(host, cfCheck.ip) }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }

    const prefix = space ? `/s/${space}` : '';
    // Ensure the ES path starts with /
    const esPath = query.startsWith('/') ? query : `/${query}`;
    const esMethod = esBody ? 'POST' : 'GET';
    // Kibana console proxy expects literal slashes in the path parameter,
    // so we only encode characters that are not valid in a URL query value
    // while preserving / and other path-safe characters.
    const encodedPath = esPath.replace(/ /g, '%20');
    const proxyPath = `${prefix}/api/console/proxy?path=${encodedPath}&method=${esMethod}`;
    const start = Date.now();

    const resp = await sendHttpWithAuth(
      host, port, 'POST', proxyPath, esBody || undefined,
      username, password, api_key, timeout,
    );

    const elapsed = Date.now() - start;
    let parsedResult: unknown = null;
    try { parsedResult = JSON.parse(resp.body); } catch { parsedResult = null; }

    return new Response(JSON.stringify({
      success: resp.statusCode >= 200 && resp.statusCode < 300,
      host, port, statusCode: resp.statusCode, responseTime: elapsed,
      esPath: query, result: parsedResult || resp.body.substring(0, 2000),
      error: resp.statusCode >= 400 ? resp.body.substring(0, 500) : undefined,
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
