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

/** Known irregular plurals for Kubernetes resource kinds */
const KIND_PLURALS: Record<string, string> = {
  endpoints: 'endpoints',
  ingress: 'ingresses',
  networkpolicy: 'networkpolicies',
  resourcequota: 'resourcequotas',
  limitrange: 'limitranges',
  storageclass: 'storageclasses',
  ingressclass: 'ingressclasses',
  runtimeclass: 'runtimeclasses',
  priorityclass: 'priorityclasses',
};

/**
 * Cluster-scoped resource kinds — these have no namespace segment in their
 * API paths (e.g. /apis/rbac.authorization.k8s.io/v1/clusterroles, not
 * /namespaces/{ns}/clusterroles).
 *
 * FIX: was missing; handleKubernetesApply was routing all resources to
 * namespaced paths, causing 404s for cluster-scoped kinds.
 */
const CLUSTER_SCOPED_KINDS = new Set([
  'namespace',
  'node',
  'persistentvolume',
  'clusterrole',
  'clusterrolebinding',
  'storageclass',
  'ingressclass',
  'runtimeclass',
  'priorityclass',
  'customresourcedefinition',
  'mutatingwebhookconfiguration',
  'validatingwebhookconfiguration',
  'validatingadmissionpolicy',
  'validatingadmissionpolicybinding',
  'apiservice',
  'certificatesigningrequest',
  'flowschema',
  'prioritylevelconfiguration',
  'volumeattachment',
]);

/** Pluralize a Kubernetes Kind to its REST resource name */
function pluralizeKind(kind: string): string {
  const lower = kind.toLowerCase();
  if (KIND_PLURALS[lower]) return KIND_PLURALS[lower];
  // Standard English pluralization rules.
  // NOTE: do NOT short-circuit on endsWith('s') — Kubernetes Kinds are always
  // singular, so a Kind ending in 's' still needs a proper plural form. The
  // only real exception (Endpoints) is already handled in KIND_PLURALS above.
  if (lower.endsWith('y') && !/[aeiou]y$/.test(lower)) {
    return lower.slice(0, -1) + 'ies';
  }
  return lower + 's';
}

/**
 * Build the API base path from an apiVersion string.
 * Core resources use apiVersion "v1" -> path "/api/v1".
 * Grouped resources use apiVersion "group/version" -> path "/apis/group/version".
 */
function getApiBasePath(apiVersion: string): string {
  if (apiVersion === 'v1') return '/api/v1';
  return `/apis/${apiVersion}`;
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
        const crlfIdx = text.indexOf('\r\n\r\n');
        const lfIdx = text.indexOf('\n\n');
        // Use the earliest header terminator found (not Math.max)
        const headerEnd = crlfIdx >= 0 && lfIdx >= 0
          ? Math.min(crlfIdx, lfIdx)
          : crlfIdx >= 0 ? crlfIdx : lfIdx;
        const headers = text.slice(0, headerEnd);
        const clMatch = headers.match(/content-length:\s*(\d+)/i);
        if (clMatch) {
          const bodyStart = headerEnd + (crlfIdx >= 0 && crlfIdx === headerEnd ? 4 : 2);
          const expectedBodyLen = parseInt(clMatch[1], 10);
          // Compare byte length, not character length, for Content-Length accuracy
          const bodyBytes = new TextEncoder().encode(text.slice(bodyStart));
          if (bodyBytes.length >= expectedBodyLen) break;
        } else if (!/transfer-encoding:\s*chunked/i.test(headers)) {
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
 * Detect Kubernetes-specific indicators in an HTTP response.
 * A plain HTTP server returning any non-zero status code would otherwise pass
 * the old `statusCode > 0` check. We look for known Kubernetes signals:
 * - Server header containing "kube-apiserver"
 * - Response body of exactly "ok" (healthz)
 * - Www-Authenticate header using Kubernetes auth schemes
 * - Content-Type of application/json with apiVersion field (status objects)
 *
 * FIX: replaces `parsed.statusCode > 0` which flagged any HTTP server as Kubernetes.
 */
function detectKubernetes(
  statusCode: number,
  headers: Record<string, string>,
  body: string,
): boolean {
  if (statusCode === 0) return false;
  const server = (headers['server'] || '').toLowerCase();
  if (server.includes('kube-apiserver')) return true;
  if (body.trim().toLowerCase() === 'ok') return true;
  const wwwAuth = headers['www-authenticate'] || '';
  if (wwwAuth.includes('Bearer realm=\"kubernetes')) return true;
  // Status objects and version objects carry apiVersion
  if (body.includes('\"apiVersion\"') && body.includes('\"kind\"')) return true;
  return false;
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
          isKubernetes: detectKubernetes(parsed.statusCode, parsed.headers, parsed.body),
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

      // Sanitize path — allow characters valid in Kubernetes API paths and query strings
      const safePath = path.replace(/[^a-zA-Z0-9/_\-.=?&:,%+()~]/g, '');

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


/**
 * Fetch Kubernetes pod logs.
 * GET /api/v1/namespaces/{ns}/pods/{pod}/log?container={container}&tailLines={N}&timestamps=true
 *
 * POST /api/kubernetes/logs
 * Body: { host, port?, token?, namespace, pod, container?, tailLines?, timeout? }
 */
export async function handleKubernetesLogs(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as {
      host: string;
      port?: number;
      token?: string;
      namespace: string;
      pod: string;
      container?: string;
      tailLines?: number;
      timeout?: number;
    };

    const {
      host,
      port = 6443,
      token,
      namespace,
      pod,
      container,
      tailLines = 100,
      timeout = 20000,
    } = body;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!namespace) {
      return new Response(
        JSON.stringify({ success: false, error: 'namespace is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (!pod) {
      return new Response(
        JSON.stringify({ success: false, error: 'pod name is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const params = new URLSearchParams({ tailLines: String(tailLines), timestamps: 'true' });
    if (container) params.set('container', container);
    const logPath = `/api/v1/namespaces/${namespace}/pods/${pod}/log?${params.toString()}`;

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    const socket = connect(`${host}:${port}`, { secureTransport: 'on', allowHalfOpen: false });

    try {
      const startTime = Date.now();
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      const authHeader = token ? `Authorization: Bearer ${token}\r\n` : '';
      const safePath = logPath.replace(/[^a-zA-Z0-9/_\-.=?&:,%+()~]/g, '');

      const httpRequest = [
        `GET ${safePath} HTTP/1.1\r\n`,
        `Host: ${host}\r\n`,
        authHeader,
        `Accept: text/plain\r\n`,
        `Connection: close\r\n`,
        `User-Agent: portofcall/1.0\r\n`,
        `\r\n`,
      ].join('');

      await writer.write(new TextEncoder().encode(httpRequest));
      const rawResponse = await readHTTPResponse(reader, timeout - (Date.now() - startTime));

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const latencyMs = Date.now() - startTime;

      if (!rawResponse) {
        return new Response(
          JSON.stringify({ success: false, error: 'No response received' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const parsed = parseHTTPResponse(rawResponse);

      const lines = parsed.body
        ? parsed.body.split('\n').filter(l => l.trim().length > 0)
        : [];

      return new Response(
        JSON.stringify({
          success: parsed.statusCode >= 200 && parsed.statusCode < 300,
          host,
          port,
          namespace,
          pod,
          container: container || null,
          tailLines,
          httpStatus: parsed.statusCode,
          lines,
          lineCount: lines.length,
          latencyMs,
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
 * List Kubernetes pods in a namespace with optional label selector.
 * GET /api/v1/namespaces/{ns}/pods  or  GET /api/v1/pods (all namespaces)
 * Returns pod names, status, and node.
 *
 * POST /api/kubernetes/pod-list
 * Body: { host, port?, token?, namespace?, labelSelector?, timeout? }
 */
export async function handleKubernetesPodList(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as {
      host: string;
      port?: number;
      token?: string;
      namespace?: string;
      labelSelector?: string;
      timeout?: number;
    };

    const {
      host,
      port = 6443,
      token,
      namespace,
      labelSelector,
      timeout = 20000,
    } = body;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const basePath = namespace
      ? `/api/v1/namespaces/${namespace}/pods`
      : '/api/v1/pods';

    const params = new URLSearchParams();
    if (labelSelector) params.set('labelSelector', labelSelector);
    const fullPath = params.toString() ? `${basePath}?${params.toString()}` : basePath;

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    const socket = connect(`${host}:${port}`, { secureTransport: 'on', allowHalfOpen: false });

    try {
      const startTime = Date.now();
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      const authHeader = token ? `Authorization: Bearer ${token}\r\n` : '';
      const safePath = fullPath.replace(/[^a-zA-Z0-9/_\-.=?&,:,%+()~!]/g, '');

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
      const rawResponse = await readHTTPResponse(reader, timeout - (Date.now() - startTime));

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const latencyMs = Date.now() - startTime;

      if (!rawResponse) {
        return new Response(
          JSON.stringify({ success: false, error: 'No response received' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const parsed = parseHTTPResponse(rawResponse);

      interface PodItem {
        metadata?: { name?: string; namespace?: string; labels?: Record<string, string> };
        status?: { phase?: string; podIP?: string };
        spec?: { nodeName?: string };
      }

      interface PodList {
        items?: PodItem[];
      }

      let pods: Array<{ name: string; namespace: string; phase: string; ip: string; node: string; labels: Record<string, string> }> = [];
      let rawBody: unknown = undefined;

      if (parsed.body) {
        try {
          const podList = JSON.parse(parsed.body) as PodList;
          rawBody = podList;
          if (podList.items) {
            pods = podList.items.map((item) => ({
              name: item.metadata?.name || '',
              namespace: item.metadata?.namespace || namespace || '',
              phase: item.status?.phase || 'Unknown',
              ip: item.status?.podIP || '',
              node: item.spec?.nodeName || '',
              labels: item.metadata?.labels || {},
            }));
          }
        } catch {
          rawBody = parsed.body.slice(0, 2048);
        }
      }

      return new Response(
        JSON.stringify({
          success: parsed.statusCode >= 200 && parsed.statusCode < 300,
          host,
          port,
          namespace: namespace || '(all)',
          labelSelector: labelSelector || null,
          httpStatus: parsed.statusCode,
          pods,
          podCount: pods.length,
          body: parsed.statusCode < 200 || parsed.statusCode >= 300 ? rawBody : undefined,
          latencyMs,
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
 * Apply a Kubernetes resource manifest via server-side apply.
 * Detects kind, apiVersion + name from the manifest, then:
 * PATCH {apiBasePath}/namespaces/{ns}/{resource}/{name}?fieldManager=portofcall&force=true
 * Content-Type: application/apply-patch+json
 *
 * POST /api/kubernetes/apply
 * Body: { host, port?, token?, namespace, manifest, timeout? }
 */
export async function handleKubernetesApply(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as {
      host: string;
      port?: number;
      token?: string;
      namespace: string;
      manifest: Record<string, unknown>;
      timeout?: number;
    };

    const {
      host,
      port = 6443,
      token,
      namespace,
      manifest,
      timeout = 20000,
    } = body;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!manifest || typeof manifest !== 'object') {
      return new Response(
        JSON.stringify({ success: false, error: 'manifest must be a JSON object' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Extract kind and name from the manifest
    const kind = (manifest['kind'] as string | undefined) || '';
    const name = (manifest['metadata'] as Record<string, unknown> | undefined)?.['name'] as string | undefined || '';

    if (!kind) {
      return new Response(
        JSON.stringify({ success: false, error: 'manifest.kind is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (!name) {
      return new Response(
        JSON.stringify({ success: false, error: 'manifest.metadata.name is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Determine scope and validate namespace requirement
    const isClusterScopedKind = CLUSTER_SCOPED_KINDS.has(kind.toLowerCase());
    if (!isClusterScopedKind && !namespace) {
      return new Response(
        JSON.stringify({ success: false, error: 'namespace is required for namespaced resources' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Map kind to its plural resource name and API group path
    const kindPlural = pluralizeKind(kind);
    const apiVersion = (manifest['apiVersion'] as string | undefined) || 'v1';
    const apiBasePath = getApiBasePath(apiVersion);

    // FIX: cluster-scoped resources must NOT include /namespaces/{ns}/ in
    // their path. Previously all resources were routed through the namespaced
    // path, causing 404s for ClusterRole, Node, Namespace, StorageClass, etc.
    const isClusterScoped = isClusterScopedKind;
    const applyPath = isClusterScoped
      ? `${apiBasePath}/${kindPlural}/${name}?fieldManager=portofcall&force=true`
      : `${apiBasePath}/namespaces/${namespace}/${kindPlural}/${name}?fieldManager=portofcall&force=true`;

    const manifestBody = JSON.stringify(manifest);
    const bodyBytes = new TextEncoder().encode(manifestBody);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    const socket = connect(`${host}:${port}`, { secureTransport: 'on', allowHalfOpen: false });

    try {
      const startTime = Date.now();
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      const authHeader = token ? `Authorization: Bearer ${token}\r\n` : '';
      const safePath = applyPath.replace(/[^a-zA-Z0-9/_\-.=?&:,%+()~]/g, '');

      const requestLine =
        `PATCH ${safePath} HTTP/1.1\r\n` +
        `Host: ${host}\r\n` +
        authHeader +
        `Content-Type: application/apply-patch+json\r\n` +
        `Accept: application/json\r\n` +
        `Content-Length: ${bodyBytes.length}\r\n` +
        `Connection: close\r\n` +
        `User-Agent: portofcall/1.0\r\n` +
        `\r\n`;

      await writer.write(new TextEncoder().encode(requestLine));
      await writer.write(bodyBytes);

      const rawResponse = await readHTTPResponse(reader, timeout - (Date.now() - startTime));

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const latencyMs = Date.now() - startTime;

      if (!rawResponse) {
        return new Response(
          JSON.stringify({ success: false, error: 'No response received' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const parsed = parseHTTPResponse(rawResponse);

      let jsonBody: unknown = undefined;
      if (parsed.body) {
        try {
          jsonBody = JSON.parse(parsed.body);
        } catch {
          jsonBody = parsed.body.slice(0, 2048);
        }
      }

      return new Response(
        JSON.stringify({
          success: parsed.statusCode >= 200 && parsed.statusCode < 300,
          host,
          port,
          namespace: isClusterScoped ? null : namespace,
          kind,
          name,
          clusterScoped: isClusterScoped,
          httpStatus: parsed.statusCode,
          httpStatusText: parsed.statusText || undefined,
          body: jsonBody,
          latencyMs,
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
