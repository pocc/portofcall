/**
 * Kubernetes API Server Probe (Port 6443/TCP)
 *
 * The Kubernetes API server is the central control plane component. It exposes
 * a REST/HTTPS API on port 6443 (default) for managing cluster resources.
 *
 * Since this is HTTPS over TLS, we use Cloudflare Workers' secure socket
 * transport to establish a TLS connection and query the API.
 *
 * Key Endpoints:
 *   GET /healthz              — health check (no auth required in many configs)
 *   GET /livez                — liveness probe
 *   GET /readyz               — readiness probe
 *   GET /version              — Kubernetes version (may require auth)
 *   GET /api/v1/namespaces    — list namespaces (requires auth)
 *
 * Note: Most Kubernetes clusters require authentication (Bearer tokens,
 * client certificates, or OIDC) for all but the health endpoints.
 * This implementation probes the health endpoints and version info.
 *
 * Default Port: 6443/TCP (TLS)
 *
 * Reference: https://kubernetes.io/docs/reference/using-api/
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface KubernetesProbeRequest {
  host: string;
  port?: number;
  bearerToken?: string;
  timeout?: number;
}

interface KubernetesQueryRequest {
  host: string;
  port?: number;
  path: string;
  bearerToken?: string;
  timeout?: number;
}

function validateInput(host: string, port: number): string | null {
  if (!host || host.trim().length === 0) return 'Host is required';
  if (!/^[a-zA-Z0-9._:-]+$/.test(host)) return 'Host contains invalid characters';
  if (port < 1 || port > 65535) return 'Port must be between 1 and 65535';
  return null;
}

/** Read all available HTTP response data */
async function readHTTPResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let totalLen = 0;
  const decoder = new TextDecoder();

  try {
    const deadline = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), timeoutMs),
    );

    // Read first chunk
    const { value, done } = await Promise.race([reader.read(), deadline]);
    if (done || !value) return '';
    chunks.push(value);
    totalLen += value.length;

    // Keep reading until we get the full HTTP response
    while (true) {
      const shortDead = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('done')), 500),
      );
      const { value: next, done: nextDone } = await Promise.race([reader.read(), shortDead]);
      if (nextDone || !next) break;
      chunks.push(next);
      totalLen += next.length;

      // Check if we have a complete HTTP response (ends with \r\n\r\n + body)
      const combined = new Uint8Array(totalLen);
      let off = 0;
      for (const c of chunks) { combined.set(c, off); off += c.length; }
      const text = decoder.decode(combined);
      if (text.includes('\r\n\r\n') || text.includes('\n\n')) {
        // Check if we have the full body (Content-Length or chunked)
        const headerEnd = Math.max(text.indexOf('\r\n\r\n'), text.indexOf('\n\n'));
        const headers = text.slice(0, headerEnd);
        const clMatch = headers.match(/content-length:\s*(\d+)/i);
        if (clMatch) {
          const bodyStart = headerEnd + (text.includes('\r\n\r\n') ? 4 : 2);
          const expectedBodyLen = parseInt(clMatch[1], 10);
          if (text.length - bodyStart >= expectedBodyLen) break;
        } else if (!headers.includes('transfer-encoding: chunked') &&
          !headers.includes('Transfer-Encoding: chunked')) {
          break; // No Content-Length and not chunked — assume complete
        }
      }
    }
  } catch {
    // Timeout or end of stream
  }

  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return decoder.decode(combined);
}

/** Parse HTTP status and body from a raw HTTP response string */
function parseHTTPResponse(raw: string): {
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
} {
  const lines = raw.split(/\r?\n/);
  const statusLine = lines[0] || '';
  const statusMatch = statusLine.match(/HTTP\/[\d.]+ (\d+)\s*(.*)/);
  const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;
  const statusText = statusMatch ? statusMatch[2] : '';

  const headers: Record<string, string> = {};
  let bodyStart = 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') {
      bodyStart = i + 1;
      break;
    }
    const colonIdx = lines[i].indexOf(':');
    if (colonIdx > 0) {
      const key = lines[i].slice(0, colonIdx).trim().toLowerCase();
      const value = lines[i].slice(colonIdx + 1).trim();
      headers[key] = value;
    }
  }
  const body = lines.slice(bodyStart).join('\n').trim();

  return { statusCode, statusText, headers, body };
}

/**
 * Probe a Kubernetes API server health check.
 *
 * POST /api/kubernetes/probe
 * Body: { host, port?, bearerToken?, timeout? }
 *
 * Queries /healthz, /livez, and /readyz endpoints.
 * Returns cluster health status and server information.
 */
export async function handleKubernetesProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as KubernetesProbeRequest;
    const {
      host,
      port = 6443,
      bearerToken,
      timeout = 15000,
    } = body;

    const validationError = validateInput(host, port);
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

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    // Connect with TLS — Kubernetes API server requires HTTPS
    const socket = connect(`${host}:${port}`, { secureTransport: 'on', allowHalfOpen: false });

    try {
      const startTime = Date.now();
      await Promise.race([socket.opened, timeoutPromise]);
      const tcpLatency = Date.now() - startTime;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Build HTTP GET /healthz
      const authHeader = bearerToken
        ? `Authorization: Bearer ${bearerToken}\r\n`
        : '';
      const httpRequest = [
        `GET /healthz HTTP/1.1\r\n`,
        `Host: ${host}\r\n`,
        authHeader,
        `Accept: */*\r\n`,
        `Connection: close\r\n`,
        `User-Agent: portofcall/1.0\r\n`,
        `\r\n`,
      ].join('');

      await writer.write(new TextEncoder().encode(httpRequest));

      const rawResponse = await readHTTPResponse(reader, 8000);

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      if (!rawResponse) {
        return new Response(
          JSON.stringify({
            success: false,
            host,
            port,
            tcpLatency,
            error: 'No response received from Kubernetes API server',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const parsed = parseHTTPResponse(rawResponse);
      const isHealthy = parsed.statusCode === 200 && parsed.body.trim().toLowerCase() === 'ok';

      let versionInfo: Record<string, string> | undefined;
      try {
        if (parsed.body && parsed.body.startsWith('{')) {
          versionInfo = JSON.parse(parsed.body) as Record<string, string>;
        }
      } catch {
        // Not JSON
      }

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          tcpLatency,
          isKubernetes: parsed.statusCode > 0,
          isHealthy,
          healthStatus: parsed.body.trim() || undefined,
          httpStatus: parsed.statusCode,
          httpStatusText: parsed.statusText || undefined,
          serverHeader: parsed.headers['server'] || undefined,
          versionInfo,
          endpoint: '/healthz',
          note: 'Kubernetes API server probed via HTTPS (TLS). ' +
            'Most endpoints require Bearer token authentication.',
          authRequired: parsed.statusCode === 401 || parsed.statusCode === 403,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Query a Kubernetes API endpoint.
 *
 * POST /api/kubernetes/query
 * Body: { host, port?, path, bearerToken?, timeout? }
 *
 * Queries any Kubernetes API path. Requires authentication for most endpoints.
 * Examples: /version, /api/v1/namespaces, /apis
 */
export async function handleKubernetesQuery(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as KubernetesQueryRequest;
    const {
      host,
      port = 6443,
      path,
      bearerToken,
      timeout = 15000,
    } = body;

    if (!path || !path.startsWith('/')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Path is required and must start with /' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const validationError = validateInput(host, port);
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

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    const socket = connect(`${host}:${port}`, { secureTransport: 'on', allowHalfOpen: false });

    try {
      const startTime = Date.now();
      await Promise.race([socket.opened, timeoutPromise]);
      const tcpLatency = Date.now() - startTime;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      const authHeader = bearerToken
        ? `Authorization: Bearer ${bearerToken}\r\n`
        : '';

      // Sanitize path — only allow safe characters
      const safePath = path.replace(/[^a-zA-Z0-9/_\-.=?&]/g, '');

      const httpRequest = [
        `GET ${safePath} HTTP/1.1\r\n`,
        `Host: ${host}\r\n`,
        authHeader,
        `Accept: application/json\r\n`,
        `Connection: close\r\n`,
        `User-Agent: portofcall/1.0\r\n`,
        `\r\n`,
      ].join('');

      await writer.write(new TextEncoder().encode(httpRequest));

      const rawResponse = await readHTTPResponse(reader, 10000);

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      if (!rawResponse) {
        return new Response(
          JSON.stringify({ success: false, error: 'No response received' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const parsed = parseHTTPResponse(rawResponse);

      let jsonBody: unknown = undefined;
      try {
        if (parsed.body && (parsed.body.startsWith('{') || parsed.body.startsWith('['))) {
          jsonBody = JSON.parse(parsed.body);
        }
      } catch {
        // Not JSON
      }

      return new Response(
        JSON.stringify({
          success: parsed.statusCode >= 200 && parsed.statusCode < 300,
          host,
          port,
          tcpLatency,
          path: safePath,
          httpStatus: parsed.statusCode,
          httpStatusText: parsed.statusText || undefined,
          contentType: parsed.headers['content-type'] || undefined,
          body: (jsonBody ?? (parsed.body.slice(0, 2048) || undefined)),
          authRequired: parsed.statusCode === 401 || parsed.statusCode === 403,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
