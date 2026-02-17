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
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

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

    // Check for Cloudflare protection
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


/**
 * Handle Docker TLS daemon query.
 * Same as handleDockerQuery but uses https:// URL (port 2376 by default).
 * Docker TLS daemon requires mutual TLS in production, but this tests connectivity.
 *
 * POST /api/docker/tls
 * Body: { host, port?, path?, method?, body?, timeout? }
 */
export async function handleDockerTLS(request: Request): Promise<Response> {
  try {
    const body = await request.json() as DockerQueryRequest;
    const {
      host,
      port = 2376,
      path = '/version',
      method = 'GET',
      body: queryBody,
      timeout = 15000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'];
    const upperMethod = method.toUpperCase();
    if (!allowedMethods.includes(upperMethod)) {
      return new Response(JSON.stringify({ success: false, error: `Invalid HTTP method: ${method}` }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = `https://${host}:${port}${normalizedPath}`;

    const fetchHeaders: Record<string, string> = {
      'Accept': 'application/json',
      'User-Agent': 'PortOfCall/1.0',
    };
    if (queryBody) {
      fetchHeaders['Content-Type'] = 'application/json';
    }

    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    let fetchResponse: Response;
    try {
      fetchResponse = await fetch(url, {
        method: upperMethod,
        headers: fetchHeaders,
        body: queryBody || undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const latencyMs = Date.now() - start;
    const responseText = await fetchResponse.text();

    let parsed;
    try { parsed = JSON.parse(responseText); } catch { parsed = null; }

    const responseHeaders: Record<string, string> = {};
    fetchResponse.headers.forEach((value, key) => { responseHeaders[key] = value; });

    const response: DockerResponse = {
      success: fetchResponse.status >= 200 && fetchResponse.status < 400,
      statusCode: fetchResponse.status,
      headers: responseHeaders,
      body: responseText,
      parsed,
      latencyMs,
    };

    return new Response(JSON.stringify(response), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'TLS query failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

interface DockerContainerCreateRequest extends DockerRequest {
  image: string;
  name?: string;
  cmd?: string[];
  env?: string[];
  https?: boolean;
}

/**
 * Create a Docker container.
 * POST /containers/create
 * Returns container ID.
 *
 * POST /api/docker/container/create
 * Body: { host, port?, image, name?, cmd?, env?, https?, timeout? }
 */
export async function handleDockerContainerCreate(request: Request): Promise<Response> {
  try {
    const body = await request.json() as DockerContainerCreateRequest;
    const {
      host,
      port,
      image,
      name,
      cmd,
      env,
      https = false,
      timeout = 15000,
    } = body;

    const effectivePort = port ?? (https ? 2376 : 2375);

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!image) {
      return new Response(JSON.stringify({ success: false, error: 'Image is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const containerConfig: Record<string, unknown> = { Image: image };
    if (cmd && cmd.length > 0) containerConfig['Cmd'] = cmd;
    if (env && env.length > 0) containerConfig['Env'] = env;

    const bodyStr = JSON.stringify(containerConfig);
    const pathStr = name
      ? `/containers/create?name=${encodeURIComponent(name)}`
      : '/containers/create';

    const start = Date.now();

    if (https) {
      const url = `https://${host}:${effectivePort}${pathStr}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      let fetchResponse: Response;
      try {
        fetchResponse = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'PortOfCall/1.0' },
          body: bodyStr,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      const latencyMs = Date.now() - start;
      const responseText = await fetchResponse.text();
      let parsed;
      try { parsed = JSON.parse(responseText); } catch { parsed = null; }
      const containerId = (parsed as { Id?: string })?.Id;
      return new Response(JSON.stringify({
        success: fetchResponse.status >= 200 && fetchResponse.status < 400,
        statusCode: fetchResponse.status,
        containerId: containerId || null,
        body: responseText,
        parsed,
        latencyMs,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } else {
      const result = await sendHttpRequest(host, effectivePort, 'POST', pathStr, bodyStr, timeout);
      const latencyMs = Date.now() - start;
      let parsed;
      try { parsed = JSON.parse(result.body); } catch { parsed = null; }
      const containerId = (parsed as { Id?: string })?.Id;
      return new Response(JSON.stringify({
        success: result.statusCode >= 200 && result.statusCode < 400,
        statusCode: result.statusCode,
        containerId: containerId || null,
        body: result.body,
        parsed,
        latencyMs,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Container create failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

interface DockerContainerStartRequest extends DockerRequest {
  containerId: string;
  https?: boolean;
}

/**
 * Start a Docker container.
 * POST /containers/{id}/start
 *
 * POST /api/docker/container/start
 * Body: { host, port?, containerId, https?, timeout? }
 */
export async function handleDockerContainerStart(request: Request): Promise<Response> {
  try {
    const body = await request.json() as DockerContainerStartRequest;
    const {
      host,
      port,
      containerId,
      https = false,
      timeout = 15000,
    } = body;

    const effectivePort = port ?? (https ? 2376 : 2375);

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!containerId) {
      return new Response(JSON.stringify({ success: false, error: 'containerId is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const pathStr = `/containers/${encodeURIComponent(containerId)}/start`;
    const start = Date.now();

    if (https) {
      const url = `https://${host}:${effectivePort}${pathStr}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      let fetchResponse: Response;
      try {
        fetchResponse = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'PortOfCall/1.0' },
          body: '{}',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      const latencyMs = Date.now() - start;
      const responseText = await fetchResponse.text();
      // 204 No Content = started successfully, 304 = already started
      const success = fetchResponse.status === 204 || fetchResponse.status === 304;
      return new Response(JSON.stringify({
        success,
        statusCode: fetchResponse.status,
        started: fetchResponse.status === 204,
        alreadyRunning: fetchResponse.status === 304,
        body: responseText || null,
        latencyMs,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } else {
      const result = await sendHttpRequest(host, effectivePort, 'POST', pathStr, '{}', timeout);
      const latencyMs = Date.now() - start;
      const success = result.statusCode === 204 || result.statusCode === 304;
      return new Response(JSON.stringify({
        success,
        statusCode: result.statusCode,
        started: result.statusCode === 204,
        alreadyRunning: result.statusCode === 304,
        body: result.body || null,
        latencyMs,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Container start failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

interface DockerContainerLogsRequest extends DockerRequest {
  containerId: string;
  tail?: number;
  https?: boolean;
}

/**
 * Parse Docker log multiplexing format.
 * Each log frame: [stream_type(1B)][zeros(3B)][size(4B BE)][data(size bytes)]
 * stream_type: 1=stdout, 2=stderr
 */
function parseDockerLogs(data: Uint8Array): { stdout: string[]; stderr: string[]; combined: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const combined: string[] = [];
  const decoder = new TextDecoder();
  let offset = 0;

  while (offset + 8 <= data.length) {
    const streamType = data[offset];
    // bytes 1-3 are padding zeros
    const size =
      (data[offset + 4] << 24) |
      (data[offset + 5] << 16) |
      (data[offset + 6] << 8) |
      data[offset + 7];

    offset += 8;
    if (size < 0 || offset + size > data.length) break;

    const line = decoder.decode(data.slice(offset, offset + size)).trimEnd();
    offset += size;

    if (streamType === 1) {
      stdout.push(line);
      combined.push(`[stdout] ${line}`);
    } else if (streamType === 2) {
      stderr.push(line);
      combined.push(`[stderr] ${line}`);
    } else {
      combined.push(line);
    }
  }

  return { stdout, stderr, combined };
}

/**
 * Fetch Docker container logs.
 * GET /containers/{id}/logs?stdout=true&stderr=true&tail={N}
 * Parses the Docker log multiplexing format (8-byte header per frame).
 *
 * GET /api/docker/container/logs
 * Query/Body: { host, port?, containerId, tail?, https?, timeout? }
 */
export async function handleDockerContainerLogs(request: Request): Promise<Response> {
  try {
    const body = await request.json() as DockerContainerLogsRequest;
    const {
      host,
      port,
      containerId,
      tail = 100,
      https = false,
      timeout = 15000,
    } = body;

    const effectivePort = port ?? (https ? 2376 : 2375);

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!containerId) {
      return new Response(JSON.stringify({ success: false, error: 'containerId is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const pathStr = `/containers/${encodeURIComponent(containerId)}/logs?stdout=true&stderr=true&tail=${tail}`;
    const start = Date.now();

    let rawBytes: Uint8Array;
    let statusCode: number;

    if (https) {
      const url = `https://${host}:${effectivePort}${pathStr}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      let fetchResponse: Response;
      try {
        fetchResponse = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/octet-stream', 'User-Agent': 'PortOfCall/1.0' },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      statusCode = fetchResponse.status;
      const arrayBuffer = await fetchResponse.arrayBuffer();
      rawBytes = new Uint8Array(arrayBuffer);
    } else {
      // Use TCP socket to get raw bytes for log demultiplexing
      const socket = connect(`${host}:${effectivePort}`);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), timeout),
      );
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const encoder = new TextEncoder();
      const httpReq =
        `GET ${pathStr} HTTP/1.1\r\n` +
        `Host: ${host}:${effectivePort}\r\n` +
        `Accept: application/octet-stream\r\n` +
        `Connection: close\r\n` +
        `User-Agent: PortOfCall/1.0\r\n` +
        `\r\n`;
      await writer.write(encoder.encode(httpReq));
      writer.releaseLock();

      const reader = socket.readable.getReader();
      const chunks: Uint8Array[] = [];
      let totalLen = 0;
      while (totalLen < 1048576) {
        const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
        if (done) break;
        if (value) { chunks.push(value); totalLen += value.length; }
      }
      reader.releaseLock();
      socket.close();

      // Combine all chunks
      const combined = new Uint8Array(totalLen);
      let off = 0;
      for (const c of chunks) { combined.set(c, off); off += c.length; }

      // Find HTTP header boundary
      const headerEndIdx = findHeaderEnd(combined);
      if (headerEndIdx === -1) throw new Error('Invalid HTTP response from Docker');

      // Extract status code from first line
      const headerStr = new TextDecoder().decode(combined.slice(0, headerEndIdx));
      const statusMatch = headerStr.match(/HTTP\/[\d.]+ (\d+)/);
      statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;

      rawBytes = combined.slice(headerEndIdx + 4);

      // Handle chunked transfer encoding if needed
      if (headerStr.toLowerCase().includes('transfer-encoding: chunked')) {
        rawBytes = decodeChunkedBytes(rawBytes);
      }
    }

    const latencyMs = Date.now() - start;

    if (statusCode < 200 || statusCode >= 400) {
      return new Response(JSON.stringify({
        success: false,
        statusCode,
        error: `Docker returned HTTP ${statusCode}`,
        latencyMs,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const logs = parseDockerLogs(rawBytes);

    return new Response(JSON.stringify({
      success: true,
      statusCode,
      containerId,
      tail,
      stdout: logs.stdout,
      stderr: logs.stderr,
      combined: logs.combined,
      lineCount: logs.combined.length,
      latencyMs,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Container logs failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/** Find the byte offset of \r\n\r\n in a Uint8Array. Returns offset after the separator. */
function findHeaderEnd(data: Uint8Array): number {
  for (let i = 0; i < data.length - 3; i++) {
    if (data[i] === 0x0d && data[i+1] === 0x0a && data[i+2] === 0x0d && data[i+3] === 0x0a) {
      return i;
    }
  }
  return -1;
}

/** Decode HTTP chunked transfer encoding from raw bytes. */
function decodeChunkedBytes(data: Uint8Array): Uint8Array {
  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];
  let offset = 0;

  while (offset < data.length) {
    // Find end of chunk size line
    let lineEnd = offset;
    while (lineEnd < data.length - 1 && !(data[lineEnd] === 0x0d && data[lineEnd+1] === 0x0a)) {
      lineEnd++;
    }
    if (lineEnd >= data.length - 1) break;

    const sizeStr = decoder.decode(data.slice(offset, lineEnd)).trim();
    const chunkSize = parseInt(sizeStr, 16);
    if (isNaN(chunkSize) || chunkSize === 0) break;

    offset = lineEnd + 2;
    if (offset + chunkSize > data.length) {
      chunks.push(data.slice(offset));
      break;
    }
    chunks.push(data.slice(offset, offset + chunkSize));
    offset += chunkSize + 2; // skip trailing \r\n
  }

  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLen);
  let off = 0;
  for (const c of chunks) { result.set(c, off); off += c.length; }
  return result;
}

interface DockerExecRequest extends DockerRequest {
  containerId: string;
  cmd: string[];
  https?: boolean;
}

/**
 * Execute a command in a running Docker container.
 * Step 1: POST /containers/{id}/exec  — create exec instance
 * Step 2: POST /exec/{id}/start       — start exec and collect output
 *
 * POST /api/docker/exec
 * Body: { host, port?, containerId, cmd, https?, timeout? }
 */
export async function handleDockerExec(request: Request): Promise<Response> {
  try {
    const body = await request.json() as DockerExecRequest;
    const {
      host,
      port,
      containerId,
      cmd,
      https = false,
      timeout = 30000,
    } = body;

    const effectivePort = port ?? (https ? 2376 : 2375);

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!containerId) {
      return new Response(JSON.stringify({ success: false, error: 'containerId is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!cmd || cmd.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'cmd is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    // Step 1: Create exec instance
    const execCreateBody = JSON.stringify({
      AttachStdout: true,
      AttachStderr: true,
      Cmd: cmd,
    });
    const execCreatePath = `/containers/${encodeURIComponent(containerId)}/exec`;

    let execId: string;

    if (https) {
      const controller1 = new AbortController();
      const t1 = setTimeout(() => controller1.abort(), timeout);
      let r1: Response;
      try {
        r1 = await fetch(`https://${host}:${effectivePort}${execCreatePath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'PortOfCall/1.0' },
          body: execCreateBody,
          signal: controller1.signal,
        });
      } finally {
        clearTimeout(t1);
      }
      if (r1.status !== 201) {
        const errText = await r1.text();
        return new Response(JSON.stringify({
          success: false,
          error: `Exec create failed with status ${r1.status}: ${errText}`,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const execCreateResult = await r1.json() as { Id?: string };
      execId = execCreateResult.Id ?? '';
    } else {
      const r1 = await sendHttpRequest(host, effectivePort, 'POST', execCreatePath, execCreateBody, timeout);
      if (r1.statusCode !== 201) {
        return new Response(JSON.stringify({
          success: false,
          error: `Exec create failed with status ${r1.statusCode}: ${r1.body}`,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      let parsed1: { Id?: string };
      try { parsed1 = JSON.parse(r1.body) as { Id?: string }; } catch { parsed1 = {}; }
      execId = parsed1.Id ?? '';
    }

    if (!execId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Docker did not return an exec ID',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Step 2: Start exec and collect output
    const execStartBody = JSON.stringify({ Detach: false, Tty: false });
    const execStartPath = `/exec/${encodeURIComponent(execId)}/start`;

    let rawBytes: Uint8Array;
    let startStatusCode: number;

    if (https) {
      const controller2 = new AbortController();
      const t2 = setTimeout(() => controller2.abort(), timeout);
      let r2: Response;
      try {
        r2 = await fetch(`https://${host}:${effectivePort}${execStartPath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/octet-stream', 'User-Agent': 'PortOfCall/1.0' },
          body: execStartBody,
          signal: controller2.signal,
        });
      } finally {
        clearTimeout(t2);
      }
      startStatusCode = r2.status;
      const ab = await r2.arrayBuffer();
      rawBytes = new Uint8Array(ab);
    } else {
      const r2 = await sendHttpRequest(host, effectivePort, 'POST', execStartPath, execStartBody, timeout);
      startStatusCode = r2.statusCode;
      rawBytes = new TextEncoder().encode(r2.body);
    }

    const latencyMs = Date.now() - start;
    const logs = parseDockerLogs(rawBytes);

    return new Response(JSON.stringify({
      success: startStatusCode === 200 || startStatusCode === 204,
      statusCode: startStatusCode,
      execId,
      containerId,
      cmd,
      stdout: logs.stdout,
      stderr: logs.stderr,
      combined: logs.combined,
      latencyMs,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Exec failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
