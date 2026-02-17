/**
 * HashiCorp Vault Protocol Implementation (HTTP API over TCP)
 *
 * Vault provides a RESTful HTTP API on port 8200 for secret management,
 * encryption as a service, and identity-based access. This implementation
 * uses raw TCP sockets to construct HTTP/1.1 requests.
 *
 * Protocol Flow:
 * 1. Client connects to Vault HTTP API port (default 8200)
 * 2. Client sends HTTP/1.1 GET requests
 * 3. Server responds with JSON data
 *
 * Endpoints tested:
 * - GET /v1/sys/health          → Seal status, version, cluster info
 * - GET /v1/sys/seal-status     → Detailed seal/unseal information
 *
 * Authentication: Optional Vault token via X-Vault-Token header.
 * The /v1/sys/health endpoint is unauthenticated by default.
 *
 * Docs: https://developer.hashicorp.com/vault/api-docs
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
    request += `X-Vault-Token: ${token}\r\n`;
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
  const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;

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
 * Handle Vault health check and server info request.
 * POST /api/vault/health
 *
 * Connects to Vault's HTTP API and retrieves:
 * - Health status (GET /v1/sys/health) → version, sealed status, cluster info
 * - Seal status (GET /v1/sys/seal-status) → threshold, shares, progress
 */
export async function handleVaultHealth(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as {
      host?: string;
      port?: number;
      token?: string;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 8200;
    const token = body.token;
    const timeout = body.timeout || 15000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
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
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const startTime = Date.now();

    // Health endpoint (unauthenticated)
    const healthResult = await sendHttpGet(host, port, '/v1/sys/health', token, timeout);
    const rtt = Date.now() - startTime;

    let healthInfo: Record<string, unknown> | null = null;
    try {
      healthInfo = JSON.parse(healthResult.body);
    } catch {
      healthInfo = null;
    }

    // Seal status (may require authentication)
    let sealInfo: Record<string, unknown> | null = null;
    try {
      const sealResult = await sendHttpGet(host, port, '/v1/sys/seal-status', token, timeout);
      sealInfo = JSON.parse(sealResult.body);
    } catch {
      // Seal status might fail without auth, that's OK
    }

    return new Response(
      JSON.stringify({
        success: true,
        host,
        port,
        rtt,
        statusCode: healthResult.statusCode,
        version: healthInfo?.version || null,
        initialized: healthInfo?.initialized ?? null,
        sealed: healthInfo?.sealed ?? null,
        standby: healthInfo?.standby ?? null,
        clusterName: healthInfo?.cluster_name || null,
        clusterId: healthInfo?.cluster_id || null,
        performanceStandby: healthInfo?.performance_standby ?? null,
        replicationPerfMode: healthInfo?.replication_perf_mode || null,
        replicationDrMode: healthInfo?.replication_dr_mode || null,
        sealType: sealInfo?.type || null,
        sealThreshold: sealInfo?.t ?? null,
        sealShares: sealInfo?.n ?? null,
        sealProgress: sealInfo?.progress ?? null,
        protocol: 'Vault',
        message: `Vault connected in ${rtt}ms`,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Vault connection failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle Vault API query request.
 * POST /api/vault/query
 *
 * Executes a GET request against any Vault API path.
 * Paths are restricted to /v1/sys/ for safety (read-only system endpoints).
 */
export async function handleVaultQuery(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as {
      host?: string;
      port?: number;
      path?: string;
      token?: string;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!body.path) {
      return new Response(
        JSON.stringify({ success: false, error: 'Path is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 8200;
    const path = body.path;
    const token = body.token;
    const timeout = body.timeout || 15000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Restrict to safe read-only system endpoints
    const allowedPrefixes = ['/v1/sys/'];
    const isAllowed = allowedPrefixes.some((prefix) => path.startsWith(prefix));
    if (!isAllowed) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Path "${path}" is not allowed. Only /v1/sys/* paths are permitted for safety.`,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
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
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const startTime = Date.now();
    const result = await sendHttpGet(host, port, path, token, timeout);
    const rtt = Date.now() - startTime;

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      parsed = null;
    }

    return new Response(
      JSON.stringify({
        success: result.statusCode >= 200 && result.statusCode < 400,
        host,
        port,
        path,
        rtt,
        statusCode: result.statusCode,
        response: parsed || result.body,
        message: `Query completed in ${rtt}ms`,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Vault query failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}


/**
 * Handle Vault KV secret read
 * POST /api/vault/secret/read
 * Reads a KV secret from Vault. Supports both KV v1 (/v1/secret/{path})
 * and KV v2 (/v1/secret/data/{path}). Auto-detects version from response shape.
 */
export async function handleVaultSecretRead(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number; path: string; token: string;
      kv_version?: 1 | 2; mount?: string; timeout?: number;
    };
    if (!body.host || !body.path || !body.token) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required: host, path, token' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    const host = body.host;
    const port = body.port || 8200;
    const timeout = body.timeout || 10000;
    const mount = body.mount || 'secret';
    const kvVersion = body.kv_version || 2;
    const apiPath = kvVersion === 2
      ? `/v1/${mount}/data/${body.path}`
      : `/v1/${mount}/${body.path}`;

    const result = await sendHttpGet(host, port, apiPath, body.token, timeout);
    const httpOk = result.statusCode >= 200 && result.statusCode < 300;

    if (!httpOk) {
      return new Response(JSON.stringify({ success: false, host, port, httpStatus: result.statusCode, path: body.path, error: result.body || `HTTP ${result.statusCode}` }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(result.body) as Record<string, unknown>; } catch { /* raw */ }

    // KV v2 wraps data under .data.data; KV v1 is under .data
    const kvv2 = parsed as { data?: { data?: Record<string, unknown>; metadata?: Record<string, unknown> } };
    const secretData = kvVersion === 2
      ? (kvv2?.data?.data ?? {})
      : ((parsed as { data?: Record<string, unknown> })?.data ?? {});
    const metadata = kvVersion === 2 ? (kvv2?.data?.metadata ?? {}) : {};

    return new Response(JSON.stringify({
      success: true,
      host, port, path: body.path, mount, kvVersion,
      data: secretData,
      metadata,
      keys: Object.keys(secretData as object),
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Read failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle Vault KV secret write
 * POST /api/vault/secret/write
 * Writes a KV secret. KV v2: POST /v1/{mount}/data/{path} with {"data":{...}}.
 * KV v1: POST /v1/{mount}/{path} with the data directly.
 */
export async function handleVaultSecretWrite(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number; path: string; token: string;
      data: Record<string, unknown>; kv_version?: 1 | 2; mount?: string; timeout?: number;
    };
    if (!body.host || !body.path || !body.token || !body.data) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required: host, path, token, data' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    const host = body.host;
    const port = body.port || 8200;
    const timeout = body.timeout || 10000;
    const mount = body.mount || 'secret';
    const kvVersion = body.kv_version || 2;
    const apiPath = kvVersion === 2
      ? `/v1/${mount}/data/${body.path}`
      : `/v1/${mount}/${body.path}`;
    const payload = kvVersion === 2
      ? JSON.stringify({ data: body.data })
      : JSON.stringify(body.data);

    // Build raw HTTP POST over TCP socket
    const { connect } = await import('cloudflare:sockets');
    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);
    await socket.opened;
    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();

    try {
      const payloadBytes = new TextEncoder().encode(payload);
      const headers = [
        `POST ${apiPath} HTTP/1.1`,
        `Host: ${host}:${port}`,
        `X-Vault-Token: ${body.token}`,
        'Content-Type: application/json',
        `Content-Length: ${payloadBytes.length}`,
        'Connection: close',
        '',
        '',
      ].join('\r\n');
      await writer.write(new TextEncoder().encode(headers));
      await writer.write(payloadBytes);

      // Read response
      const chunks: Uint8Array[] = [];
      const tp = new Promise<void>((_, rej) => setTimeout(() => rej(new Error('Timeout')), timeout));
      const rp = (async () => {
        while (true) {
          const { value, done } = await reader.read();
          if (done || !value) break;
          chunks.push(value);
        }
      })();
      await Promise.race([rp, tp]).catch(() => {});

      writer.releaseLock(); reader.releaseLock();
      await socket.close();

      const rtt = Date.now() - startTime;
      const combined = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
      let off = 0;
      for (const c of chunks) { combined.set(c, off); off += c.length; }
      const text = new TextDecoder().decode(combined);
      const headerEnd = text.indexOf('\r\n\r\n');
      const statusLine = text.split('\r\n')[0];
      const statusCode = parseInt(statusLine.split(' ')[1] || '0');
      const respBody = headerEnd >= 0 ? text.slice(headerEnd + 4) : '';

      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(respBody) as Record<string, unknown>; } catch { /* raw */ }

      const success = statusCode >= 200 && statusCode < 300;
      return new Response(JSON.stringify({
        success,
        host, port, path: body.path, mount, kvVersion, rtt,
        httpStatus: statusCode,
        ...(success
          ? { version: (parsed as { data?: { version?: number } })?.data?.version, keys: Object.keys(body.data) }
          : { error: (parsed as { errors?: string[] })?.errors?.[0] || `HTTP ${statusCode}` }),
      }), { headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      writer.releaseLock(); reader.releaseLock();
      await socket.close();
      throw err;
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Write failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
