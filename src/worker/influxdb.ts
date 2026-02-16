/**
 * InfluxDB Protocol Implementation (HTTP API over TCP)
 *
 * InfluxDB exposes an HTTP API on port 8086. This implementation
 * uses raw TCP sockets to construct HTTP/1.1 requests, accessing
 * InfluxDB's time-series database capabilities via Cloudflare Sockets API.
 *
 * Protocol Flow:
 * 1. Client connects to InfluxDB server port 8086
 * 2. Client sends HTTP/1.1 request (GET /health, POST /api/v2/write, POST /api/v2/query)
 * 3. Server responds with JSON or CSV (Flux query results)
 * 4. Connection closes
 *
 * Use Cases:
 * - InfluxDB health monitoring
 * - Time-series data writing (Line Protocol)
 * - Flux query execution
 * - Connectivity testing for monitoring infrastructure
 */

import { connect } from 'cloudflare:sockets';

interface InfluxDBHealthRequest {
  host: string;
  port?: number;
  token?: string;
  timeout?: number;
}

interface InfluxDBWriteRequest {
  host: string;
  port?: number;
  token?: string;
  org: string;
  bucket: string;
  lineProtocol: string;
  timeout?: number;
}

interface InfluxDBQueryRequest {
  host: string;
  port?: number;
  token?: string;
  org: string;
  query: string;
  timeout?: number;
}

interface InfluxDBResponse {
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
 * Reusable for all InfluxDB HTTP endpoints.
 */
async function sendHttpRequest(
  host: string,
  port: number,
  method: string,
  path: string,
  body?: string,
  contentType?: string,
  authToken?: string,
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

  if (authToken) {
    request += `Authorization: Token ${authToken}\r\n`;
  }

  if (body) {
    const bodyBytes = encoder.encode(body);
    request += `Content-Type: ${contentType || 'application/json'}\r\n`;
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
 * Handle InfluxDB health check.
 * GET /health returns server status.
 * GET /api/v2/ready returns readiness info.
 */
export async function handleInfluxDBHealth(request: Request): Promise<Response> {
  try {
    const body = await request.json() as InfluxDBHealthRequest;
    const { host, port = 8086, token, timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    // Health check (GET /health)
    const healthResult = await sendHttpRequest(
      host, port, 'GET', '/health', undefined, undefined, token, timeout,
    );

    // Try to get ready status (GET /api/v2/ready)
    let readyResult;
    try {
      readyResult = await sendHttpRequest(
        host, port, 'GET', '/api/v2/ready', undefined, undefined, token, timeout,
      );
    } catch {
      readyResult = null;
    }

    const latencyMs = Date.now() - start;

    let healthInfo;
    try {
      healthInfo = JSON.parse(healthResult.body);
    } catch {
      healthInfo = healthResult.body;
    }

    let readyInfo;
    if (readyResult) {
      try {
        readyInfo = JSON.parse(readyResult.body);
      } catch {
        readyInfo = readyResult.body;
      }
    }

    const result: InfluxDBResponse = {
      success: healthResult.statusCode >= 200 && healthResult.statusCode < 400,
      statusCode: healthResult.statusCode,
      parsed: {
        health: healthInfo,
        ready: readyInfo || null,
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
 * Handle InfluxDB write request.
 * POST /api/v2/write with Line Protocol data.
 */
export async function handleInfluxDBWrite(request: Request): Promise<Response> {
  try {
    const body = await request.json() as InfluxDBWriteRequest;
    const { host, port = 8086, token, org, bucket, lineProtocol, timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!org || !bucket) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Organization and bucket are required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!lineProtocol || lineProtocol.trim().length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Line protocol data is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    const path = `/api/v2/write?org=${encodeURIComponent(org)}&bucket=${encodeURIComponent(bucket)}&precision=ns`;

    const result = await sendHttpRequest(
      host, port, 'POST', path, lineProtocol, 'text/plain; charset=utf-8', token, timeout,
    );

    const latencyMs = Date.now() - start;

    // 204 No Content means success for writes
    const success = result.statusCode === 204 || (result.statusCode >= 200 && result.statusCode < 300);

    let errorInfo;
    if (!success && result.body) {
      try {
        errorInfo = JSON.parse(result.body);
      } catch {
        errorInfo = result.body;
      }
    }

    const response: InfluxDBResponse = {
      success,
      statusCode: result.statusCode,
      body: result.body || undefined,
      parsed: errorInfo || null,
      latencyMs,
      error: !success ? `Write failed with status ${result.statusCode}` : undefined,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Write failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle InfluxDB Flux query request.
 * POST /api/v2/query with Flux query.
 */
export async function handleInfluxDBQuery(request: Request): Promise<Response> {
  try {
    const body = await request.json() as InfluxDBQueryRequest;
    const { host, port = 8086, token, org, query, timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!org) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Organization is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!query || query.trim().length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Flux query is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    const path = `/api/v2/query?org=${encodeURIComponent(org)}`;
    const queryBody = JSON.stringify({
      query,
      type: 'flux',
    });

    const result = await sendHttpRequest(
      host, port, 'POST', path, queryBody, 'application/json', token, timeout,
    );

    const latencyMs = Date.now() - start;

    const success = result.statusCode >= 200 && result.statusCode < 400;

    let parsed;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      // Flux query results are CSV, not JSON
      parsed = null;
    }

    const response: InfluxDBResponse = {
      success,
      statusCode: result.statusCode,
      body: result.body,
      parsed,
      latencyMs,
      error: !success ? `Query failed with status ${result.statusCode}` : undefined,
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
