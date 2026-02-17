/**
 * Jupyter Notebook/JupyterLab REST API Protocol Implementation (HTTP over TCP)
 *
 * Jupyter exposes a REST API on port 8888 (default) for managing notebooks,
 * kernels, sessions, and file contents. This implementation uses raw TCP
 * sockets to construct HTTP/1.1 requests, enabling Jupyter management
 * through the Cloudflare Sockets API.
 *
 * Protocol Flow:
 * 1. Client connects to Jupyter server on port 8888
 * 2. Client sends HTTP/1.1 request (GET/POST/DELETE)
 * 3. Server responds with JSON (authenticated via token if required)
 * 4. Connection closes
 *
 * Use Cases:
 * - Jupyter server health checking
 * - Kernel enumeration and management
 * - Session inspection
 * - Notebook file listing
 * - Server version and status detection
 *
 * Authentication:
 * Jupyter supports token-based auth via Authorization: token TOKEN header.
 * When no token is configured, the server accepts unauthenticated requests.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface JupyterRequest {
  host: string;
  port?: number;
  token?: string;
  timeout?: number;
}

interface JupyterQueryRequest extends JupyterRequest {
  method?: string;
  path?: string;
  body?: string;
}

interface JupyterResponse {
  success: boolean;
  statusCode?: number;
  headers?: Record<string, string>;
  body?: string;
  parsed?: unknown;
  error?: string;
  latencyMs?: number;
}

/**
 * Send a raw HTTP/1.1 request over a TCP socket to a Jupyter server.
 */
async function sendHttpRequest(
  host: string,
  port: number,
  method: string,
  path: string,
  token?: string,
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

  if (token) {
    request += `Authorization: token ${token}\r\n`;
  }

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
 * Handle Jupyter server health/version check.
 * GET /api returns API version
 * GET /api/status returns server status
 * GET /api/kernelspecs returns available kernels
 */
export async function handleJupyterHealth(request: Request): Promise<Response> {
  try {
    const body = await request.json() as JupyterRequest;
    const { host, port = 8888, token, timeout = 15000 } = body;

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

    // GET /api — returns version info
    const apiResult = await sendHttpRequest(host, port, 'GET', '/api', token, undefined, timeout);

    // GET /api/status — server status and activity metrics
    let statusResult;
    try {
      statusResult = await sendHttpRequest(host, port, 'GET', '/api/status', token, undefined, timeout);
    } catch {
      statusResult = null;
    }

    // GET /api/kernelspecs — available kernel specifications
    let kernelspecsResult;
    try {
      kernelspecsResult = await sendHttpRequest(host, port, 'GET', '/api/kernelspecs', token, undefined, timeout);
    } catch {
      kernelspecsResult = null;
    }

    const latencyMs = Date.now() - start;

    // Detect authentication requirement
    const requiresAuth = apiResult.statusCode === 401 || apiResult.statusCode === 403;

    let apiInfo;
    if (apiResult.statusCode === 200) {
      try {
        apiInfo = JSON.parse(apiResult.body);
      } catch {
        apiInfo = { raw: apiResult.body };
      }
    }

    let statusInfo;
    if (statusResult?.statusCode === 200) {
      try {
        statusInfo = JSON.parse(statusResult.body);
      } catch {
        statusInfo = null;
      }
    }

    let kernelspecsInfo;
    if (kernelspecsResult?.statusCode === 200) {
      try {
        const parsed = JSON.parse(kernelspecsResult.body);
        kernelspecsInfo = {
          default: parsed.default,
          kernelNames: Object.keys(parsed.kernelspecs || {}),
        };
      } catch {
        kernelspecsInfo = null;
      }
    }

    const result: JupyterResponse = {
      success: apiResult.statusCode >= 200 && apiResult.statusCode < 400,
      statusCode: apiResult.statusCode,
      parsed: {
        api: apiInfo || null,
        status: statusInfo || null,
        kernelspecs: kernelspecsInfo || null,
        requiresAuth,
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
 * Handle Jupyter API query request.
 * Sends an arbitrary HTTP request to the Jupyter REST API.
 */
export async function handleJupyterQuery(request: Request): Promise<Response> {
  try {
    const body = await request.json() as JupyterQueryRequest;
    const {
      host,
      port = 8888,
      token,
      path = '/api',
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

    // Validate method
    const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
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
      token,
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

    const response: JupyterResponse = {
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
