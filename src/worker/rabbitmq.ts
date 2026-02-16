/**
 * RabbitMQ Management API Implementation (HTTP REST over TCP)
 *
 * RabbitMQ exposes a Management HTTP API on port 15672 for monitoring
 * and managing the message broker. This implementation uses raw TCP
 * sockets to construct HTTP/1.1 requests with Basic authentication.
 *
 * Protocol Flow:
 * 1. Client connects to RabbitMQ Management port (default 15672)
 * 2. Client sends HTTP/1.1 GET requests with Basic auth
 * 3. Server responds with JSON data
 *
 * Endpoints probed:
 * - GET /api/overview     → Cluster overview, version, Erlang info
 * - GET /api/nodes        → Node list with memory, disk, uptime
 * - GET /api/queues       → Queue list with message counts
 * - GET /api/exchanges    → Exchange list with types
 * - GET /api/connections  → Connection list
 * - GET /api/channels     → Channel list
 *
 * Authentication: HTTP Basic Auth (default: guest/guest)
 *
 * Docs: https://www.rabbitmq.com/docs/management
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Base64 encode for Basic auth (Workers-compatible)
 */
function base64Encode(str: string): string {
  const bytes = encoder.encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Send a raw HTTP/1.1 GET request over a TCP socket and parse the response.
 */
async function sendHttpGet(
  host: string,
  port: number,
  path: string,
  username: string,
  password: string,
  timeout = 15000,
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  await Promise.race([socket.opened, timeoutPromise]);

  const writer = socket.writable.getWriter();

  // Build HTTP/1.1 request with Basic auth
  const auth = base64Encode(`${username}:${password}`);
  let request = `GET ${path} HTTP/1.1\r\n`;
  request += `Host: ${host}:${port}\r\n`;
  request += `Authorization: Basic ${auth}\r\n`;
  request += `Accept: application/json\r\n`;
  request += `Connection: close\r\n`;
  request += `User-Agent: PortOfCall/1.0\r\n`;
  request += `\r\n`;

  await writer.write(encoder.encode(request));
  writer.releaseLock();

  // Read response
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
 * Decode chunked transfer encoding
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
 * Handle RabbitMQ overview / health check
 * POST /api/rabbitmq/health
 *
 * Connects to the Management API and retrieves cluster overview
 * including version, Erlang version, node info, and stats.
 */
export async function handleRabbitMQHealth(request: Request): Promise<Response> {
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
      username?: string;
      password?: string;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const host = body.host;
    const port = body.port || 15672;
    const username = body.username || 'guest';
    const password = body.password || 'guest';
    const timeout = body.timeout || 15000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
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

    const startTime = Date.now();

    // Get overview
    const overviewResult = await sendHttpGet(host, port, '/api/overview', username, password, timeout);
    const rtt = Date.now() - startTime;

    if (overviewResult.statusCode === 401) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Authentication failed (401). Check username and password.',
          host,
          port,
          rtt,
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    }

    let overview: Record<string, unknown> | null = null;
    try {
      overview = JSON.parse(overviewResult.body);
    } catch {
      overview = null;
    }

    // Try to get node info
    let nodes: Array<Record<string, unknown>> | null = null;
    try {
      const nodesResult = await sendHttpGet(host, port, '/api/nodes', username, password, timeout);
      if (nodesResult.statusCode === 200) {
        nodes = JSON.parse(nodesResult.body);
      }
    } catch {
      // Node info may fail, that's OK
    }

    const firstNode = nodes && nodes.length > 0 ? nodes[0] : null;

    return new Response(
      JSON.stringify({
        success: overviewResult.statusCode === 200,
        host,
        port,
        rtt,
        statusCode: overviewResult.statusCode,
        protocol: 'RabbitMQ',
        version: (overview?.rabbitmq_version as string) || null,
        erlangVersion: (overview?.erlang_version as string) || null,
        clusterName: (overview?.cluster_name as string) || null,
        managementVersion: (overview?.management_version as string) || null,
        messageStats: overview?.message_stats || null,
        queueTotals: overview?.queue_totals || null,
        objectTotals: overview?.object_totals || null,
        listeners: overview?.listeners || null,
        node: firstNode
          ? {
              name: firstNode.name,
              type: firstNode.type,
              running: firstNode.running,
              memUsed: firstNode.mem_used,
              memLimit: firstNode.mem_limit,
              diskFree: firstNode.disk_free,
              diskFreeLimit: firstNode.disk_free_limit,
              fdUsed: firstNode.fd_used,
              fdTotal: firstNode.fd_total,
              socketsUsed: firstNode.sockets_used,
              socketsTotal: firstNode.sockets_total,
              procUsed: firstNode.proc_used,
              procTotal: firstNode.proc_total,
              uptime: firstNode.uptime,
            }
          : null,
        message: `RabbitMQ connected in ${rtt}ms`,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'RabbitMQ connection failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Handle RabbitMQ API query
 * POST /api/rabbitmq/query
 *
 * Executes a GET request against any /api/* management endpoint.
 * Restricted to read-only GET endpoints for safety.
 */
export async function handleRabbitMQQuery(request: Request): Promise<Response> {
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
      username?: string;
      password?: string;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!body.path) {
      return new Response(
        JSON.stringify({ success: false, error: 'Path is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const host = body.host;
    const port = body.port || 15672;
    const path = body.path;
    const username = body.username || 'guest';
    const password = body.password || 'guest';
    const timeout = body.timeout || 15000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Restrict to /api/ paths for safety (read-only management endpoints)
    if (!path.startsWith('/api/')) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Path "${path}" is not allowed. Only /api/* paths are permitted.`,
        }),
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

    const startTime = Date.now();
    const result = await sendHttpGet(host, port, path, username, password, timeout);
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
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'RabbitMQ query failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
