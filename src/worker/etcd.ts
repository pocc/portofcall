/**
 * etcd Protocol Implementation (HTTP/JSON Gateway over TCP)
 *
 * etcd exposes a gRPC API on port 2379, but also provides an HTTP/JSON
 * gateway for easier client access. This implementation uses raw TCP
 * sockets to construct HTTP/1.1 requests to the v3 HTTP/JSON gateway.
 *
 * Protocol Flow:
 * 1. Client connects to etcd server port 2379
 * 2. Client sends HTTP/1.1 POST request with JSON body
 * 3. Server responds with JSON
 * 4. Connection closes
 *
 * Key endpoints:
 * - POST /v3/kv/range   - Get key(s)
 * - POST /v3/kv/put     - Store key-value
 * - POST /v3/kv/deleterange - Delete key(s)
 * - POST /v3/lease/grant - Grant a lease (TTL)
 * - POST /v3/lease/revoke - Revoke a lease
 * - POST /v3/maintenance/status - Server status
 *
 * Note: etcd v3 uses base64-encoded keys and values in HTTP/JSON API.
 */

import { connect } from 'cloudflare:sockets';

interface EtcdRequest {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  timeout?: number;
}

interface EtcdHealthRequest extends EtcdRequest {}

interface EtcdQueryRequest extends EtcdRequest {
  path: string;
  body?: string;
}

interface EtcdResponse {
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
      const val = line.substring(colonIdx + 1).trim();
      headers[key] = val;
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
 * Build Basic Auth header from username/password.
 */
function buildAuthHeader(username?: string, password?: string): string | undefined {
  if (username && password) {
    return `Basic ${btoa(`${username}:${password}`)}`;
  }
  return undefined;
}

/**
 * Handle etcd health/status request.
 * GET /version returns etcd + cluster version.
 * POST /v3/maintenance/status returns server status with leader/raft info.
 */
export async function handleEtcdHealth(request: Request): Promise<Response> {
  try {
    const body = await request.json() as EtcdHealthRequest;
    const { host, port = 2379, username, password, timeout = 15000 } = body;

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

    // Get version info (GET /version)
    const versionResult = await sendHttpRequest(host, port, 'GET', '/version', undefined, authHeader, timeout);

    // Get server status (POST /v3/maintenance/status with empty body)
    let statusResult;
    try {
      statusResult = await sendHttpRequest(host, port, 'POST', '/v3/maintenance/status', '{}', authHeader, timeout);
    } catch {
      statusResult = null;
    }

    // Get cluster health (GET /health)
    let healthResult;
    try {
      healthResult = await sendHttpRequest(host, port, 'GET', '/health', undefined, authHeader, timeout);
    } catch {
      healthResult = null;
    }

    const latencyMs = Date.now() - start;

    let versionInfo;
    try {
      versionInfo = JSON.parse(versionResult.body);
    } catch {
      versionInfo = versionResult.body;
    }

    let statusInfo;
    if (statusResult) {
      try {
        statusInfo = JSON.parse(statusResult.body);
      } catch {
        statusInfo = statusResult.body;
      }
    }

    let healthInfo;
    if (healthResult) {
      try {
        healthInfo = JSON.parse(healthResult.body);
      } catch {
        healthInfo = healthResult.body;
      }
    }

    const result: EtcdResponse = {
      success: versionResult.statusCode >= 200 && versionResult.statusCode < 400,
      statusCode: versionResult.statusCode,
      parsed: {
        version: versionInfo,
        status: statusInfo || null,
        health: healthInfo || null,
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
 * Handle etcd query request.
 * Sends an arbitrary POST request to the etcd v3 HTTP/JSON API.
 */
export async function handleEtcdQuery(request: Request): Promise<Response> {
  try {
    const body = await request.json() as EtcdQueryRequest;
    const {
      host,
      port = 2379,
      path,
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

    if (!path) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Path is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Ensure path starts with /
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    const authHeader = buildAuthHeader(username, password);
    const start = Date.now();

    // etcd v3 API uses POST for most operations
    const result = await sendHttpRequest(
      host,
      port,
      'POST',
      normalizedPath,
      queryBody || '{}',
      authHeader,
      timeout,
    );

    const latencyMs = Date.now() - start;

    let parsed;
    try {
      parsed = JSON.parse(result.body);
      // Decode base64 keys/values in response if present
      if (parsed && typeof parsed === 'object') {
        parsed = decodeEtcdResponse(parsed);
      }
    } catch {
      parsed = null;
    }

    const response: EtcdResponse = {
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
 * Decode base64 keys and values in etcd v3 API responses.
 * etcd v3 HTTP/JSON API encodes keys/values as base64 strings.
 */
function decodeEtcdResponse(obj: Record<string, unknown>): Record<string, unknown> {
  const result = { ...obj };

  // Decode kvs array (from range/get responses)
  if (Array.isArray(result.kvs)) {
    result.kvs = result.kvs.map((kv: Record<string, unknown>) => decodeKV(kv));
  }

  // Decode prev_kv (from put/delete responses)
  if (result.prev_kv && typeof result.prev_kv === 'object') {
    result.prev_kv = decodeKV(result.prev_kv as Record<string, unknown>);
  }

  // Decode header info
  if (result.header && typeof result.header === 'object') {
    const header = result.header as Record<string, unknown>;
    result.header = {
      ...header,
      cluster_id: header.cluster_id?.toString(),
      member_id: header.member_id?.toString(),
      raft_term: header.raft_term?.toString(),
      revision: header.revision?.toString(),
    };
  }

  return result;
}

/**
 * Decode a single key-value pair from base64.
 */
function decodeKV(kv: Record<string, unknown>): Record<string, unknown> {
  const decoded = { ...kv };

  if (typeof decoded.key === 'string') {
    try {
      decoded.key_decoded = atob(decoded.key);
    } catch {
      decoded.key_decoded = decoded.key;
    }
  }

  if (typeof decoded.value === 'string') {
    try {
      decoded.value_decoded = atob(decoded.value);
    } catch {
      decoded.value_decoded = decoded.value;
    }
  }

  return decoded;
}
