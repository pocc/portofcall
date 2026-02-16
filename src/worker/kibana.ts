/**
 * Kibana Protocol Implementation (HTTP API over TCP)
 *
 * Kibana is the visualization and dashboarding layer for Elasticsearch
 * and OpenSearch. It provides an HTTP REST API for querying server status,
 * managing saved objects (dashboards, visualizations), and checking features.
 *
 * Protocol Flow:
 * 1. Client connects to Kibana HTTP API port (default 5601)
 * 2. Client sends HTTP/1.1 GET requests with kbn-xsrf header
 * 3. Server responds with JSON data
 *
 * Endpoints:
 * - GET /api/status              → Server health, version, and plugin status
 * - GET /api/features            → Available features and capabilities
 * - GET /api/saved_objects/_find → Search saved objects (dashboards, etc.)
 * - GET /api/spaces/_get_shareable_references → Space configuration
 *
 * Docs: https://www.elastic.co/guide/en/kibana/current/api.html
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
  request += `Accept: application/json\r\n`;
  request += `kbn-xsrf: true\r\n`;
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
 * Status & Health probe: checks server status, version, and overall health
 */
export async function handleKibanaStatus(request: Request): Promise<Response> {
  try {
    const { host, port = 5601 } = await request.json() as { host: string; port?: number };
    if (!host) {
      return new Response(JSON.stringify({ error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const isCloudflare = await checkIfCloudflare(host);
    if (isCloudflare) {
      return new Response(JSON.stringify({ error: getCloudflareErrorMessage('Kibana', host) }), {
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
 */
export async function handleKibanaSavedObjects(request: Request): Promise<Response> {
  try {
    const { host, port = 5601, type = 'dashboard', perPage = 20 } = await request.json() as {
      host: string; port?: number; type?: string; perPage?: number;
    };
    if (!host) {
      return new Response(JSON.stringify({ error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const isCloudflare = await checkIfCloudflare(host);
    if (isCloudflare) {
      return new Response(JSON.stringify({ error: getCloudflareErrorMessage('Kibana', host) }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();
    const path = `/api/saved_objects/_find?type=${encodeURIComponent(type)}&per_page=${perPage}`;
    const resp = await sendHttpGet(host, port, path);
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
