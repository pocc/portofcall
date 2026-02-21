/**
 * Prometheus Protocol Implementation (HTTP API over TCP)
 *
 * Prometheus is the dominant open-source monitoring and alerting toolkit
 * in cloud-native environments (CNCF graduated project). It provides a
 * powerful HTTP API for querying time-series metrics via PromQL.
 *
 * Protocol Flow:
 * 1. Client connects to Prometheus HTTP API port (default 9090)
 * 2. Client sends HTTP/1.1 GET/POST requests
 * 3. Server responds with JSON or text/plain data
 *
 * Endpoints:
 * - GET /-/healthy            → Health check (returns 200 if healthy)
 * - GET /-/ready              → Readiness check
 * - GET /api/v1/status/buildinfo → Version and build info
 * - GET /api/v1/query?query=... → PromQL instant query
 * - GET /metrics              → Self-scrape metrics endpoint
 * - GET /api/v1/targets       → Active scrape targets
 *
 * Docs: https://prometheus.io/docs/prometheus/latest/querying/api/
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
  request += `Accept: application/json, text/plain\r\n`;
  request += `Connection: close\r\n`;
  request += `User-Agent: PortOfCall/1.0\r\n`;
  request += `\r\n`;

  await writer.write(encoder.encode(request));
  writer.releaseLock();

  const reader = socket.readable.getReader();
  let response = '';
  const maxSize = 512000;

  while (response.length < maxSize) {
    const readResult = await Promise.race([reader.read(), timeoutPromise]) as ReadableStreamReadResult<Uint8Array>;
    if (readResult.done) break;
    if (readResult.value) {
      response += decoder.decode(readResult.value, { stream: true });
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
  if (!statusMatch) throw new Error('Invalid HTTP response: no status line');
  const statusCode = parseInt(statusMatch[1], 10);

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
 * Handle Prometheus health check and build info.
 * POST /api/prometheus/health
 *
 * Checks Prometheus health endpoints and retrieves build info:
 * - GET /-/healthy → "Prometheus Server is Healthy."
 * - GET /-/ready → "Prometheus Server is Ready."
 * - GET /api/v1/status/buildinfo → Version, revision, Go version
 */
export async function handlePrometheusHealth(request: Request): Promise<Response> {
  try {
    const { host, port = 9090, timeout = 15000 } = await request.json<{
      host: string;
      port?: number;
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

    // Health check
    const healthResult = await sendHttpGet(host, port, '/-/healthy', timeout);
    const latencyMs = Date.now() - start;

    const isHealthy = healthResult.statusCode === 200;

    // Try to get build info
    let buildInfo = null;
    try {
      const buildResult = await sendHttpGet(host, port, '/api/v1/status/buildinfo', timeout);
      if (buildResult.statusCode === 200) {
        const parsed = JSON.parse(buildResult.body);
        if (parsed.status === 'success' && parsed.data) {
          buildInfo = parsed.data;
        }
      }
    } catch {
      // Build info might not be available
    }

    // Try readiness check
    let isReady = false;
    try {
      const readyResult = await sendHttpGet(host, port, '/-/ready', timeout);
      isReady = readyResult.statusCode === 200;
    } catch {
      // Readiness check might fail
    }

    // Try to get target count
    let targetCount = null;
    try {
      const targetsResult = await sendHttpGet(host, port, '/api/v1/targets?state=active', timeout);
      if (targetsResult.statusCode === 200) {
        const parsed = JSON.parse(targetsResult.body);
        if (parsed.status === 'success' && parsed.data?.activeTargets) {
          targetCount = parsed.data.activeTargets.length;
        }
      }
    } catch {
      // Targets endpoint might not be available
    }

    return new Response(JSON.stringify({
      success: isHealthy,
      host,
      port,
      healthy: isHealthy,
      ready: isReady,
      healthMessage: healthResult.body.trim(),
      statusCode: healthResult.statusCode,
      latencyMs,
      version: buildInfo?.version || null,
      revision: buildInfo?.revision ? buildInfo.revision.substring(0, 12) : null,
      goVersion: buildInfo?.goVersion || null,
      branch: buildInfo?.branch || null,
      activeTargets: targetCount,
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
 * Handle Prometheus PromQL query.
 * POST /api/prometheus/query
 *
 * Executes a PromQL instant query via GET /api/v1/query?query=...
 */
export async function handlePrometheusQuery(request: Request): Promise<Response> {
  try {
    const { host, port = 9090, query, timeout = 15000 } = await request.json<{
      host: string;
      port?: number;
      query: string;
      timeout?: number;
    }>();

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!query) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: query' }), {
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
    const encodedQuery = encodeURIComponent(query);
    const result = await sendHttpGet(host, port, `/api/v1/query?query=${encodedQuery}`, timeout);
    const latencyMs = Date.now() - start;

    let parsed;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      parsed = null;
    }

    const isSuccess = parsed?.status === 'success';
    const resultType = parsed?.data?.resultType || null;
    const results = parsed?.data?.result || [];

    // Format results for display
    const formattedResults = results.slice(0, 50).map((r: {
      metric?: Record<string, string>;
      value?: [number, string];
      values?: [number, string][];
    }) => ({
      metric: r.metric || {},
      value: r.value ? { timestamp: r.value[0], value: r.value[1] } : null,
      values: r.values ? r.values.map((v: [number, string]) => ({ timestamp: v[0], value: v[1] })) : null,
    }));

    return new Response(JSON.stringify({
      success: isSuccess,
      host,
      port,
      query,
      statusCode: result.statusCode,
      latencyMs,
      status: parsed?.status || 'error',
      resultType,
      resultCount: results.length,
      results: formattedResults,
      warnings: parsed?.warnings || null,
      error: parsed?.error || null,
      errorType: parsed?.errorType || null,
    }), {
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
 * Handle Prometheus metrics scrape.
 * POST /api/prometheus/metrics
 *
 * Scrapes the /metrics endpoint to retrieve Prometheus' own metrics
 * in the OpenMetrics/Prometheus exposition format.
 */
export async function handlePrometheusMetrics(request: Request): Promise<Response> {
  try {
    const { host, port = 9090, timeout = 15000 } = await request.json<{
      host: string;
      port?: number;
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
    const result = await sendHttpGet(host, port, '/metrics', timeout);
    const latencyMs = Date.now() - start;

    const isSuccess = result.statusCode >= 200 && result.statusCode < 400;

    // Parse metrics to count and categorize
    const lines = result.body.split('\n');
    const metricFamilies = new Set<string>();
    const metricTypes: Record<string, string> = {};
    let sampleCount = 0;

    for (const line of lines) {
      if (line.startsWith('# TYPE ')) {
        const parts = line.substring(7).split(' ');
        if (parts.length >= 2) {
          metricFamilies.add(parts[0]);
          metricTypes[parts[0]] = parts[1];
        }
      } else if (line && !line.startsWith('#')) {
        sampleCount++;
      }
    }

    // Count by type
    const typeCounts: Record<string, number> = {};
    for (const type of Object.values(metricTypes)) {
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    }

    // Get first 30 lines of metrics as preview
    const preview = lines
      .filter(l => l && !l.startsWith('#'))
      .slice(0, 30)
      .map(line => {
        const match = line.match(/^([^\s{]+)/);
        const name = match ? match[1] : line;
        const valueMatch = line.match(/\s+([\d.eE+-]+)$/);
        const value = valueMatch ? valueMatch[1] : null;
        return { name, value, raw: line };
      });

    return new Response(JSON.stringify({
      success: isSuccess,
      host,
      port,
      statusCode: result.statusCode,
      latencyMs,
      metricFamilyCount: metricFamilies.size,
      sampleCount,
      typeCounts,
      preview,
      contentType: result.headers['content-type'] || null,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Metrics scrape failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}


/**
 * Handle Prometheus range query
 * POST /api/prometheus/range
 * Executes a PromQL range query against /api/v1/query_range.
 * Returns time series with values at each step.
 */
export async function handlePrometheusRangeQuery(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number; query: string;
      start?: string; end?: string; step?: string; timeout?: number;
    };
    if (!body.host || !body.query) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required: host, query' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    const host = body.host;
    const port = body.port || 9090;
    const timeout = body.timeout || 15000;

    // Bug fix: added missing Cloudflare detection (all other handlers had this check)
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const now = Math.floor(Date.now() / 1000);
    const start = body.start || String(now - 3600);
    const end = body.end || String(now);
    const step = body.step || '60';
    const params = new URLSearchParams({ query: body.query, start, end, step });
    const path = `/api/v1/query_range?${params.toString()}`;

    const result = await sendHttpGet(host, port, path, timeout);
    const httpOk = result.statusCode >= 200 && result.statusCode < 300;

    if (!httpOk) {
      return new Response(JSON.stringify({ success: false, host, port, httpStatus: result.statusCode, error: result.body || `HTTP ${result.statusCode}` }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    interface RangeResult {
      data?: { resultType?: string; result?: Array<{ metric: Record<string,string>; values: [number, string][] }> };
      status?: string; warnings?: string[]; error?: string; errorType?: string;
    }
    let parsed: RangeResult = {};
    try { parsed = JSON.parse(result.body) as RangeResult; } catch { /* raw */ }

    const series = parsed?.data?.result ?? [];
    const resultType = parsed?.data?.resultType ?? 'unknown';
    // Bug fix: derive success from parsed.status — Prometheus returns HTTP 200 with status:"error" for bad PromQL
    const isSuccess = parsed?.status === 'success';

    const formattedSeries = series.map(s => ({
      metric: s.metric,
      valueCount: s.values?.length ?? 0,
      firstValue: s.values?.[0],
      lastValue: s.values?.[s.values.length - 1],
      // Bug fix: keep values as strings — parseFloat("NaN")/parseFloat("+Inf") → null after JSON.stringify
      sampleValues: s.values?.slice(0, 5).map(([ts, v]) => ({ ts, value: v })),
    }));

    return new Response(JSON.stringify({
      success: isSuccess,
      host, port, query: body.query, start, end, step,
      status: parsed?.status || 'error',
      resultType,
      seriesCount: series.length,
      series: formattedSeries,
      warnings: parsed?.warnings || null,
      error: parsed?.error || null,
      errorType: parsed?.errorType || null,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Range query failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
