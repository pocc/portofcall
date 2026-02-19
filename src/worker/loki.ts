/**
 * Grafana Loki Protocol Implementation (HTTP API over TCP)
 *
 * Grafana Loki is a horizontally-scalable, multi-tenant log aggregation
 * system inspired by Prometheus. It indexes log streams by labels and
 * provides a powerful query language (LogQL) for filtering and aggregating.
 *
 * Protocol Flow:
 * 1. Client connects to Loki HTTP API port (default 3100)
 * 2. Client sends HTTP/1.1 GET/POST requests
 * 3. Server responds with JSON data
 *
 * Endpoints:
 * - GET /ready                      → Readiness check (returns 200)
 * - GET /loki/api/v1/status/buildinfo → Version and build info
 * - GET /loki/api/v1/labels         → Available label names
 * - GET /loki/api/v1/query?query=... → LogQL instant query
 * - GET /metrics                    → Prometheus-format metrics
 *
 * Docs: https://grafana.com/docs/loki/latest/reference/loki-http-api/
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
      const chunkSize = parseInt(remaining.substring(0, lineEnd), 16);
      if (isNaN(chunkSize) || chunkSize === 0) break;
      decoded += remaining.substring(lineEnd + 2, lineEnd + 2 + chunkSize);
      remaining = remaining.substring(lineEnd + 2 + chunkSize + 2);
    }
    body = decoded;
  }

  return { statusCode, headers, body };
}

/**
 * Health & Info probe: checks readiness, build info, and labels
 */
export async function handleLokiHealth(request: Request): Promise<Response> {
  try {
    const { host, port = 3100 } = await request.json() as { host: string; port?: number };
    if (!host) {
      return new Response(JSON.stringify({ error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare) {
      return new Response(JSON.stringify({ error: getCloudflareErrorMessage(host, cfCheck.ip ?? host) }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }

    const results: Record<string, unknown> = {};
    const startTime = Date.now();

    // Check readiness
    try {
      const ready = await sendHttpGet(host, port, '/ready');
      results.ready = {
        statusCode: ready.statusCode,
        healthy: ready.statusCode === 200,
        body: ready.body.trim().substring(0, 200),
      };
    } catch (e: unknown) {
      results.ready = { error: e instanceof Error ? e.message : String(e) };
    }

    // Get build info
    try {
      const buildInfo = await sendHttpGet(host, port, '/loki/api/v1/status/buildinfo');
      if (buildInfo.statusCode === 200) {
        try {
          results.buildInfo = JSON.parse(buildInfo.body);
        } catch {
          results.buildInfo = { raw: buildInfo.body.substring(0, 500) };
        }
      } else {
        results.buildInfo = { statusCode: buildInfo.statusCode, body: buildInfo.body.substring(0, 200) };
      }
    } catch (e: unknown) {
      results.buildInfo = { error: e instanceof Error ? e.message : String(e) };
    }

    // Get available labels
    try {
      const labels = await sendHttpGet(host, port, '/loki/api/v1/labels');
      if (labels.statusCode === 200) {
        try {
          const parsed = JSON.parse(labels.body);
          results.labels = {
            status: parsed.status,
            data: parsed.data,
            count: Array.isArray(parsed.data) ? parsed.data.length : 0,
          };
        } catch {
          results.labels = { raw: labels.body.substring(0, 500) };
        }
      } else {
        results.labels = { statusCode: labels.statusCode };
      }
    } catch (e: unknown) {
      results.labels = { error: e instanceof Error ? e.message : String(e) };
    }

    const elapsed = Date.now() - startTime;

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      results,
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
 * LogQL query execution
 */
export async function handleLokiQuery(request: Request): Promise<Response> {
  try {
    const { host, port = 3100, query, limit = 100 } = await request.json() as {
      host: string; port?: number; query: string; limit?: number;
    };
    if (!host || !query) {
      return new Response(JSON.stringify({ error: 'Host and query are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare) {
      return new Response(JSON.stringify({ error: getCloudflareErrorMessage(host, cfCheck.ip ?? host) }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();
    const encodedQuery = encodeURIComponent(query);
    const path = `/loki/api/v1/query?query=${encodedQuery}&limit=${limit}`;

    const resp = await sendHttpGet(host, port, path);
    const elapsed = Date.now() - startTime;

    let parsed: unknown = null;
    if (resp.statusCode === 200) {
      try {
        parsed = JSON.parse(resp.body);
      } catch {
        parsed = { raw: resp.body.substring(0, 2000) };
      }
    }

    return new Response(JSON.stringify({
      success: resp.statusCode === 200,
      host,
      port,
      query,
      statusCode: resp.statusCode,
      result: parsed ?? { error: resp.body.substring(0, 500) },
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
 * Metrics scrape - fetch Prometheus-format metrics from Loki
 */
export async function handleLokiMetrics(request: Request): Promise<Response> {
  try {
    const { host, port = 3100 } = await request.json() as { host: string; port?: number };
    if (!host) {
      return new Response(JSON.stringify({ error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare) {
      return new Response(JSON.stringify({ error: getCloudflareErrorMessage(host, cfCheck.ip ?? host) }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();
    const resp = await sendHttpGet(host, port, '/metrics');
    const elapsed = Date.now() - startTime;

    if (resp.statusCode !== 200) {
      return new Response(JSON.stringify({
        success: false,
        statusCode: resp.statusCode,
        error: resp.body.substring(0, 500),
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Parse Prometheus exposition format
    const lines = resp.body.split('\n');
    const metrics: { name: string; type: string; help: string; samples: number }[] = [];
    let currentName = '';
    let currentType = '';
    let currentHelp = '';
    let currentSamples = 0;

    for (const line of lines) {
      if (line.startsWith('# HELP ')) {
        if (currentName) {
          metrics.push({ name: currentName, type: currentType, help: currentHelp, samples: currentSamples });
        }
        const parts = line.substring(7).split(' ');
        currentName = parts[0];
        currentHelp = parts.slice(1).join(' ');
        currentType = '';
        currentSamples = 0;
      } else if (line.startsWith('# TYPE ')) {
        const parts = line.substring(7).split(' ');
        currentType = parts[1] || 'unknown';
      } else if (line && !line.startsWith('#')) {
        currentSamples++;
      }
    }
    if (currentName) {
      metrics.push({ name: currentName, type: currentType, help: currentHelp, samples: currentSamples });
    }

    // Compute type distribution
    const typeDistribution: Record<string, number> = {};
    for (const m of metrics) {
      typeDistribution[m.type || 'unknown'] = (typeDistribution[m.type || 'unknown'] || 0) + 1;
    }

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      totalMetrics: metrics.length,
      totalSamples: metrics.reduce((sum, m) => sum + m.samples, 0),
      typeDistribution,
      metrics: metrics.slice(0, 50),
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
 * Handle Loki log push
 * POST /api/loki/push
 * Pushes log entries to Loki via POST /loki/api/v1/push.
 * Accepts an array of log lines with optional labels and timestamps.
 */
export async function handleLokiPush(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number;
      labels?: Record<string, string>;
      lines: string[];
      timestamp?: number;
      timeout?: number;
    };
    if (!body.host || !Array.isArray(body.lines) || body.lines.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required: host, lines[]' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    const host = body.host;
    const port = body.port || 3100;
    const timeout = body.timeout || 10000;

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare) {
      return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip ?? host) }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }

    const labels = body.labels || { job: 'portofcall' };
    // Loki push API requires nanosecond-precision timestamps.
    // Use string concatenation to avoid JavaScript Number precision loss
    // (nanosecond timestamps exceed Number.MAX_SAFE_INTEGER).
    const tsNs = body.timestamp
      ? String(body.timestamp) + '000000000'
      : String(Date.now()) + '000000';

    const labelsStr = '{' + Object.entries(labels).map(([k, v]) => k + '="' + v + '"').join(', ') + '}';
    const entries = body.lines.map(line => [tsNs, line]);
    const payload = JSON.stringify({
      streams: [{ stream: labels, values: entries }],
    });

    // Use fetch() since we're sending JSON POST
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const startTime = Date.now();

    try {
      const resp = await fetch('http://' + host + ':' + port + '/loki/api/v1/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: controller.signal,
      });
      clearTimeout(timer);
      const rtt = Date.now() - startTime;
      const respText = await resp.text();

      return new Response(JSON.stringify({
        success: resp.status === 204 || resp.status === 200,
        host, port, rtt,
        httpStatus: resp.status,
        linesSubmitted: body.lines.length,
        labels: labelsStr,
        ...(resp.status !== 204 && resp.status !== 200
          ? { error: respText || 'HTTP ' + resp.status }
          : { message: body.lines.length + ' log line(s) pushed successfully' }),
      }), { headers: { 'Content-Type': 'application/json' } });
    } catch (fetchError) {
      clearTimeout(timer);
      return new Response(JSON.stringify({ success: false, error: fetchError instanceof Error ? fetchError.message : 'Push failed' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle Loki range query
 * POST /api/loki/range
 * Queries log entries over a time range using LogQL.
 * Uses /loki/api/v1/query_range.
 */
export async function handleLokiRangeQuery(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number; query: string;
      start?: string; end?: string; limit?: number; direction?: 'forward' | 'backward';
      timeout?: number;
    };
    if (!body.host || !body.query) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required: host, query' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    const host = body.host;
    const port = body.port || 3100;
    const timeout = body.timeout || 15000;
    const now = Date.now();
    // Loki accepts nanosecond Unix epoch for start/end.
    // Use string concatenation to avoid JavaScript Number precision loss
    // (nanosecond timestamps exceed Number.MAX_SAFE_INTEGER).
    const start = body.start || String(now - 3600000) + '000000'; // 1hr ago in ns
    const end = body.end || String(now) + '000000';
    const limit = body.limit || 100;
    const direction = body.direction || 'backward';

    const params = new URLSearchParams({ query: body.query, start, end, limit: String(limit), direction });
    const path = '/loki/api/v1/query_range?' + params.toString();

    const result = await sendHttpGet(host, port, path, timeout);
    const httpOk = result.statusCode >= 200 && result.statusCode < 300;

    if (!httpOk) {
      return new Response(JSON.stringify({ success: false, host, port, httpStatus: result.statusCode, error: result.body || 'HTTP ' + result.statusCode }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    interface LokiRangeResult {
      data?: {
        resultType?: string;
        result?: Array<{ stream: Record<string,string>; values: [string, string][] }>;
        stats?: Record<string, unknown>;
      };
      status?: string;
    }
    let parsed: LokiRangeResult = {};
    try { parsed = JSON.parse(result.body) as LokiRangeResult; } catch { /* raw */ }

    const streams = parsed?.data?.result ?? [];
    const totalEntries = streams.reduce((sum, s) => sum + (s.values?.length ?? 0), 0);

    const formattedStreams = streams.map(s => ({
      stream: s.stream,
      entryCount: s.values?.length ?? 0,
      entries: s.values?.slice(0, 10).map(([ts, line]) => ({
        timestamp: new Date(parseInt(ts) / 1e6).toISOString(),
        line,
      })),
    }));

    return new Response(JSON.stringify({
      success: true,
      host, port, query: body.query, start, end, limit, direction,
      streamCount: streams.length,
      totalEntries,
      streams: formattedStreams,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Range query failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
