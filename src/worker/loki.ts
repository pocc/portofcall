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

    const isCloudflare = await checkIfCloudflare(host);
    if (isCloudflare) {
      return new Response(JSON.stringify({ error: getCloudflareErrorMessage('Loki', host) }), {
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

    const isCloudflare = await checkIfCloudflare(host);
    if (isCloudflare) {
      return new Response(JSON.stringify({ error: getCloudflareErrorMessage('Loki', host) }), {
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

    const isCloudflare = await checkIfCloudflare(host);
    if (isCloudflare) {
      return new Response(JSON.stringify({ error: getCloudflareErrorMessage('Loki', host) }), {
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
