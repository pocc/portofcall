/**
 * Consul Protocol Implementation (HTTP API over TCP)
 *
 * Consul provides a RESTful HTTP API on port 8500 for service discovery,
 * health checking, and key-value configuration. This implementation uses
 * raw TCP sockets to construct HTTP/1.1 requests.
 *
 * Protocol Flow:
 * 1. Client connects to Consul HTTP API port (default 8500)
 * 2. Client sends HTTP/1.1 GET requests
 * 3. Server responds with JSON data
 *
 * Endpoints tested:
 * - GET /v1/agent/self         → Agent info, version, datacenter
 * - GET /v1/catalog/services   → Service catalog listing
 *
 * Docs: https://www.consul.io/api-docs
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Send a raw HTTP/1.1 GET request over a TCP socket and parse the response.
 */
async function sendHttpGet(
  host: string,
  port: number,
  path: string,
  token?: string,
  timeout = 15000,
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  await Promise.race([socket.opened, timeoutPromise]);

  const writer = socket.writable.getWriter();

  // Build HTTP/1.1 request
  let request = `GET ${path} HTTP/1.1\r\n`;
  request += `Host: ${host}:${port}\r\n`;
  request += `Accept: application/json\r\n`;
  request += `Connection: close\r\n`;
  request += `User-Agent: PortOfCall/1.0\r\n`;

  if (token) {
    request += `X-Consul-Token: ${token}\r\n`;
  }

  request += `\r\n`;
  await writer.write(encoder.encode(request));
  writer.releaseLock();

  // Read response
  const reader = socket.readable.getReader();
  let response = '';
  const maxSize = 512000; // 512KB limit

  while (response.length < maxSize) {
    const readResult = await Promise.race([reader.read(), timeoutPromise]) as ReadableStreamReadResult<Uint8Array>;
    if (readResult.done) break;
    if (readResult.value) {
      response += decoder.decode(readResult.value, { stream: true });
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
      result += remaining.substring(chunkStart);
      break;
    }

    result += remaining.substring(chunkStart, chunkEnd);
    remaining = remaining.substring(chunkEnd + 2);
  }

  return result;
}

/**
 * Handle Consul connectivity and info request.
 * POST /api/consul/health
 *
 * Connects to Consul's HTTP API and retrieves:
 * - Agent info (GET /v1/agent/self) → version, datacenter, node name
 * - Service catalog (GET /v1/catalog/services) → registered services
 */
export async function handleConsulHealth(request: Request): Promise<Response> {
  try {
    const { host, port = 8500, token, timeout = 15000 } = await request.json<{
      host: string;
      port?: number;
      token?: string;
      timeout?: number;
    }>();

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
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

    // Get agent info
    const agentResult = await sendHttpGet(host, port, '/v1/agent/self', token, timeout);
    const latencyMs = Date.now() - start;

    let agentInfo;
    try {
      agentInfo = JSON.parse(agentResult.body);
    } catch {
      agentInfo = null;
    }

    // Try to get service catalog
    let services = null;
    try {
      const servicesResult = await sendHttpGet(host, port, '/v1/catalog/services', token, timeout);
      services = JSON.parse(servicesResult.body);
    } catch {
      // Service catalog might fail, that's OK
    }

    const config = agentInfo?.Config || agentInfo?.DebugConfig || {};
    const member = agentInfo?.Member || {};

    return new Response(JSON.stringify({
      success: agentResult.statusCode >= 200 && agentResult.statusCode < 400,
      host,
      port,
      statusCode: agentResult.statusCode,
      latencyMs,
      version: config.Version || 'Unknown',
      datacenter: config.Datacenter || 'Unknown',
      nodeName: config.NodeName || member.Name || 'Unknown',
      server: config.Server !== undefined ? config.Server : null,
      services: services ? Object.keys(services) : [],
      serviceCount: services ? Object.keys(services).length : 0,
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
 * Handle Consul service listing request.
 * POST /api/consul/services
 *
 * Lists all registered services with their tags.
 */
export async function handleConsulServices(request: Request): Promise<Response> {
  try {
    const { host, port = 8500, token, timeout = 15000 } = await request.json<{
      host: string;
      port?: number;
      token?: string;
      timeout?: number;
    }>();

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
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
    const result = await sendHttpGet(host, port, '/v1/catalog/services', token, timeout);
    const latencyMs = Date.now() - start;

    let parsed;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      parsed = null;
    }

    return new Response(JSON.stringify({
      success: result.statusCode >= 200 && result.statusCode < 400,
      host,
      port,
      statusCode: result.statusCode,
      latencyMs,
      services: parsed,
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


// ============================================================
// Consul KV Store Operations
// ============================================================

/**
 * Send a raw HTTP request (GET/PUT/DELETE) over TCP to Consul's HTTP API.
 * Reuses the existing sendHttpGet infrastructure pattern but supports all methods.
 */
async function sendConsulHttpRequest(
  host: string,
  port: number,
  method: string,
  path: string,
  token: string | undefined,
  body: string | null,
  timeout = 15000,
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const { connect: tcpConnect } = await import('cloudflare:sockets' as string);
  const socket = tcpConnect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  await Promise.race([socket.opened, timeoutPromise]);

  const writer = socket.writable.getWriter();
  let req = `${method} ${path} HTTP/1.1\r\n`;
  req += `Host: ${host}:${port}\r\n`;
  req += `Accept: application/json\r\n`;
  req += `Connection: close\r\n`;
  req += `User-Agent: PortOfCall/1.0\r\n`;
  if (token) req += `X-Consul-Token: ${token}\r\n`;
  if (body !== null) {
    const bodyBytes = new TextEncoder().encode(body);
    req += `Content-Type: application/json\r\n`;
    req += `Content-Length: ${bodyBytes.length}\r\n`;
    req += `\r\n`;
    await writer.write(new TextEncoder().encode(req));
    await writer.write(bodyBytes);
  } else {
    req += `\r\n`;
    await writer.write(new TextEncoder().encode(req));
  }
  writer.releaseLock();

  const reader = socket.readable.getReader();
  let response = '';
  const maxSize = 512000;
  while (response.length < maxSize) {
    const res = await Promise.race([reader.read(), timeoutPromise]) as ReadableStreamReadResult<Uint8Array>;
    if (res.done) break;
    if (res.value) response += new TextDecoder().decode(res.value, { stream: true });
  }
  reader.releaseLock();
  socket.close();

  const headerEnd = response.indexOf('\r\n\r\n');
  if (headerEnd === -1) throw new Error('Invalid HTTP response');
  const headerSection = response.substring(0, headerEnd);
  let bodySection = response.substring(headerEnd + 4);
  const statusLine = headerSection.split('\r\n')[0];
  const statusMatch = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/);
  const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;
  const headers: Record<string, string> = {};
  for (const line of headerSection.split('\r\n').slice(1)) {
    const idx = line.indexOf(':');
    if (idx > 0) headers[line.substring(0, idx).trim().toLowerCase()] = line.substring(idx + 1).trim();
  }
  if (headers['transfer-encoding']?.includes('chunked')) {
    bodySection = decodeChunked(bodySection);
  }
  return { statusCode, headers, body: bodySection };
}

/**
 * GET a key from the Consul KV store.
 *
 * POST /api/consul/kv/:key
 * Body: { host, port?, key, token?, dc? }
 */
export async function handleConsulKVGet(request: Request): Promise<Response> {
  try {
    const data = await request.json<{
      host: string; port?: number; key: string; token?: string; dc?: string; timeout?: number;
    }>();
    const { host, port = 8500, key, token, dc, timeout = 15000 } = data;
    if (!host || !key) {
      return new Response(JSON.stringify({ error: 'Missing required parameters: host, key' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    let path = `/v1/kv/${encodeURIComponent(key)}`;
    if (dc) path += `?dc=${encodeURIComponent(dc)}`;

    const result = await sendConsulHttpRequest(host, port, 'GET', path, token, null, timeout);
    let parsed = null;
    let value: string | null = null;
    if (result.statusCode === 200) {
      try {
        const arr = JSON.parse(result.body);
        if (Array.isArray(arr) && arr.length > 0) {
          parsed = arr[0];
          if (parsed.Value) {
            value = atob(parsed.Value);
          }
        }
      } catch { /* ignore */ }
    }
    return new Response(JSON.stringify({
      success: result.statusCode === 200,
      host, port, key,
      statusCode: result.statusCode,
      value,
      metadata: parsed ? {
        createIndex: parsed.CreateIndex,
        modifyIndex: parsed.ModifyIndex,
        lockIndex: parsed.LockIndex,
        flags: parsed.Flags,
        session: parsed.Session,
      } : null,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false, error: error instanceof Error ? error.message : 'Connection failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * PUT a value into the Consul KV store.
 *
 * POST /api/consul/kv/:key (with method PUT)
 * Body: { host, port?, key, value, token?, dc? }
 */
export async function handleConsulKVPut(request: Request): Promise<Response> {
  try {
    const data = await request.json<{
      host: string; port?: number; key: string; value: string; token?: string; dc?: string; timeout?: number;
    }>();
    const { host, port = 8500, key, value = '', token, dc, timeout = 15000 } = data;
    if (!host || !key) {
      return new Response(JSON.stringify({ error: 'Missing required parameters: host, key' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    let path = `/v1/kv/${encodeURIComponent(key)}`;
    if (dc) path += `?dc=${encodeURIComponent(dc)}`;

    const result = await sendConsulHttpRequest(host, port, 'PUT', path, token, value, timeout);
    const success = result.statusCode === 200 && result.body.trim() === 'true';
    return new Response(JSON.stringify({
      success,
      host, port, key,
      statusCode: result.statusCode,
      message: success ? 'Key written successfully' : 'Write failed',
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false, error: error instanceof Error ? error.message : 'Connection failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * LIST keys under a prefix in the Consul KV store.
 *
 * POST /api/consul/kv-list
 * Body: { host, port?, prefix, token?, dc? }
 */
export async function handleConsulKVList(request: Request): Promise<Response> {
  try {
    const data = await request.json<{
      host: string; port?: number; prefix?: string; token?: string; dc?: string; timeout?: number;
    }>();
    const { host, port = 8500, prefix = '', token, dc, timeout = 15000 } = data;
    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    let path = `/v1/kv/${encodeURIComponent(prefix)}?keys=true&separator=/`;
    if (dc) path += `&dc=${encodeURIComponent(dc)}`;

    const result = await sendConsulHttpRequest(host, port, 'GET', path, token, null, timeout);
    let keys: string[] = [];
    if (result.statusCode === 200) {
      try { keys = JSON.parse(result.body); } catch { /* ignore */ }
    }
    return new Response(JSON.stringify({
      success: result.statusCode === 200,
      host, port, prefix,
      statusCode: result.statusCode,
      keys,
      count: keys.length,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false, error: error instanceof Error ? error.message : 'Connection failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * DELETE a key from the Consul KV store.
 *
 * POST /api/consul/kv/:key (with method DELETE)
 * Body: { host, port?, key, token?, dc? }
 */
export async function handleConsulKVDelete(request: Request): Promise<Response> {
  try {
    const data = await request.json<{
      host: string; port?: number; key: string; token?: string; dc?: string; timeout?: number;
    }>();
    const { host, port = 8500, key, token, dc, timeout = 15000 } = data;
    if (!host || !key) {
      return new Response(JSON.stringify({ error: 'Missing required parameters: host, key' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    let path = `/v1/kv/${encodeURIComponent(key)}`;
    if (dc) path += `?dc=${encodeURIComponent(dc)}`;

    const result = await sendConsulHttpRequest(host, port, 'DELETE', path, token, null, timeout);
    const success = result.statusCode === 200;
    return new Response(JSON.stringify({
      success,
      host, port, key,
      statusCode: result.statusCode,
      message: success ? 'Key deleted successfully' : `Delete failed with status ${result.statusCode}`,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false, error: error instanceof Error ? error.message : 'Connection failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle Consul service health check request.
 * POST /api/consul/service/health
 *
 * Returns health status for all instances of a named service.
 */
export async function handleConsulServiceHealth(request: Request): Promise<Response> {
  try {
    const data = await request.json<{
      host: string;
      port?: number;
      serviceName: string;
      token?: string;
      passing?: boolean;
      dc?: string;
      timeout?: number;
    }>();
    const { host, port = 8500, serviceName, token, passing, dc, timeout = 10000 } = data;

    if (!host || !serviceName) {
      return new Response(JSON.stringify({ error: 'Missing required parameters: host, serviceName' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    let path = `/v1/health/service/${encodeURIComponent(serviceName)}`;
    const queryParams: string[] = [];
    if (passing) queryParams.push('passing=true');
    if (dc) queryParams.push(`dc=${encodeURIComponent(dc)}`);
    if (queryParams.length > 0) path += `?${queryParams.join('&')}`;

    const result = await sendConsulHttpRequest(host, port, 'GET', path, token, null, timeout);

    let entries: unknown[] = [];
    try {
      entries = JSON.parse(result.body) as unknown[];
    } catch {
      entries = [];
    }

    const instances = Array.isArray(entries) ? entries.map((entry: unknown) => {
      const e = entry as Record<string, unknown>;
      const node = e.Node as Record<string, unknown> | undefined;
      const service = e.Service as Record<string, unknown> | undefined;
      const checks = e.Checks as unknown[] | undefined;
      return {
        node: node?.Node || null,
        address: node?.Address || null,
        serviceId: service?.ID || null,
        serviceAddress: service?.Address || null,
        servicePort: service?.Port || null,
        checks: Array.isArray(checks) ? checks.map((c: unknown) => {
          const chk = c as Record<string, unknown>;
          return {
            name: chk.Name || chk.CheckID || null,
            status: chk.Status || null,
            output: chk.Output || null,
          };
        }) : [],
      };
    }) : [];

    return new Response(JSON.stringify({
      success: result.statusCode >= 200 && result.statusCode < 400,
      host,
      port,
      serviceName,
      instanceCount: instances.length,
      passing: !!passing,
      instances,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false, error: error instanceof Error ? error.message : 'Connection failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle Consul session creation request.
 * POST /api/consul/session/create
 *
 * Creates a new Consul session for distributed locking.
 */
export async function handleConsulSessionCreate(request: Request): Promise<Response> {
  try {
    const data = await request.json<{
      host: string;
      port?: number;
      token?: string;
      name?: string;
      ttl?: string;
      behavior?: string;
      timeout?: number;
    }>();
    const { host, port = 8500, token, name, ttl, behavior = 'release', timeout = 10000 } = data;

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const sessionBody: Record<string, unknown> = { Behavior: behavior };
    if (name) sessionBody.Name = name;
    if (ttl) sessionBody.TTL = ttl;

    const startTime = Date.now();
    const result = await sendConsulHttpRequest(
      host, port, 'PUT', '/v1/session/create', token, JSON.stringify(sessionBody), timeout
    );
    const rtt = Date.now() - startTime;

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(result.body) as Record<string, unknown>;
    } catch {
      parsed = null;
    }

    return new Response(JSON.stringify({
      success: result.statusCode === 200,
      host,
      port,
      rtt,
      sessionId: parsed?.ID || null,
      name: name || null,
      ttl: ttl || null,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false, error: error instanceof Error ? error.message : 'Connection failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
