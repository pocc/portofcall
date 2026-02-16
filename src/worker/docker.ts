/**
 * Docker Engine API Protocol Implementation (HTTP over TCP)
 *
 * Docker exposes a REST API on port 2375 (HTTP) or 2376 (HTTPS).
 * This implementation uses raw TCP sockets to construct HTTP/1.1
 * requests, enabling Docker management through Cloudflare Sockets API.
 *
 * Protocol Flow:
 * 1. Client connects to Docker daemon on port 2375
 * 2. Client sends HTTP/1.1 request (GET/POST/DELETE)
 * 3. Server responds with JSON
 * 4. Connection closes
 *
 * Use Cases:
 * - Docker daemon health checking
 * - Container listing and inspection
 * - Image listing
 * - System info and version detection
 *
 * Security Note:
 * Docker API without TLS is extremely dangerous - it grants full
 * container management access. This client is intended for testing
 * and educational purposes with read-only operations.
 */

import { connect } from 'cloudflare:sockets';

interface DockerRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface DockerQueryRequest extends DockerRequest {
  method?: string;
  path?: string;
  body?: string;
}

interface DockerResponse {
  success: boolean;
  statusCode?: number;
  headers?: Record<string, string>;
  body?: string;
  parsed?: unknown;
  error?: string;
  latencyMs?: number;
}

/**
 * Send a raw HTTP/1.1 request over a TCP socket to the Docker daemon.
 */
async function sendHttpRequest(
  host: string,
  port: number,
  method: string,
  path: string,
  body?: string,
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
  const maxSize = 512000;

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
 * Handle Docker health/version check.
 * GET /_ping returns "OK"
 * GET /version returns Docker version info
 * GET /info returns system-wide information
 */
export async function handleDockerHealth(request: Request): Promise<Response> {
  try {
    const body = await request.json() as DockerRequest;
    const { host, port = 2375, timeout = 15000 } = body;

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

    // Ping check (GET /_ping)
    const pingResult = await sendHttpRequest(host, port, 'GET', '/_ping', undefined, timeout);

    // Get version info (GET /version)
    let versionResult;
    try {
      versionResult = await sendHttpRequest(host, port, 'GET', '/version', undefined, timeout);
    } catch {
      versionResult = null;
    }

    // Get system info (GET /info) - can be large, skip if version failed
    let infoResult;
    if (versionResult) {
      try {
        infoResult = await sendHttpRequest(host, port, 'GET', '/info', undefined, timeout);
      } catch {
        infoResult = null;
      }
    }

    const latencyMs = Date.now() - start;

    let versionInfo;
    if (versionResult) {
      try {
        versionInfo = JSON.parse(versionResult.body);
      } catch {
        versionInfo = versionResult.body;
      }
    }

    let systemInfo;
    if (infoResult) {
      try {
        const fullInfo = JSON.parse(infoResult.body);
        // Extract key system info fields to keep response manageable
        systemInfo = {
          Containers: fullInfo.Containers,
          ContainersRunning: fullInfo.ContainersRunning,
          ContainersPaused: fullInfo.ContainersPaused,
          ContainersStopped: fullInfo.ContainersStopped,
          Images: fullInfo.Images,
          ServerVersion: fullInfo.ServerVersion,
          OperatingSystem: fullInfo.OperatingSystem,
          OSType: fullInfo.OSType,
          Architecture: fullInfo.Architecture,
          NCPU: fullInfo.NCPU,
          MemTotal: fullInfo.MemTotal,
          Name: fullInfo.Name,
          KernelVersion: fullInfo.KernelVersion,
          Driver: fullInfo.Driver,
        };
      } catch {
        systemInfo = null;
      }
    }

    const result: DockerResponse = {
      success: pingResult.statusCode === 200,
      statusCode: pingResult.statusCode,
      parsed: {
        ping: pingResult.body.trim(),
        version: versionInfo || null,
        system: systemInfo || null,
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
 * Handle Docker API query request.
 * Sends an arbitrary HTTP request to the Docker daemon.
 */
export async function handleDockerQuery(request: Request): Promise<Response> {
  try {
    const body = await request.json() as DockerQueryRequest;
    const {
      host,
      port = 2375,
      path = '/version',
      method = 'GET',
      body: queryBody,
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

    // Validate method - restrict to safe methods by default
    const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'];
    const upperMethod = method.toUpperCase();
    if (!allowedMethods.includes(upperMethod)) {
      return new Response(JSON.stringify({
        success: false,
        error: `Invalid HTTP method: ${method}`,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Ensure path starts with /
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    const start = Date.now();

    const result = await sendHttpRequest(
      host,
      port,
      upperMethod,
      normalizedPath,
      queryBody,
      timeout,
    );

    const latencyMs = Date.now() - start;

    let parsed;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      parsed = null;
    }

    const response: DockerResponse = {
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
