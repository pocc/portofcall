/**
 * Matrix Protocol Implementation (HTTP/JSON over TCP)
 *
 * Matrix is an open standard for decentralized real-time communication.
 * It uses HTTP JSON APIs on port 8448 (federation) or 443 (client-server).
 * This implementation uses raw TCP sockets to construct HTTP/1.1 requests.
 *
 * Protocol Flow:
 * 1. Client connects to Matrix homeserver (port 8448 or 443)
 * 2. Client sends HTTP/1.1 requests to Matrix API endpoints
 * 3. Server responds with JSON
 * 4. Connection closes
 *
 * Use Cases:
 * - Matrix homeserver discovery and version detection
 * - Federation health checking
 * - Login flow enumeration
 * - Room directory browsing (public rooms)
 */

import { connect } from 'cloudflare:sockets';

interface MatrixRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface MatrixQueryRequest extends MatrixRequest {
  method?: string;
  path?: string;
  body?: string;
  accessToken?: string;
}

interface MatrixResponse {
  success: boolean;
  statusCode?: number;
  headers?: Record<string, string>;
  body?: string;
  parsed?: unknown;
  error?: string;
  latencyMs?: number;
}

/**
 * Send a raw HTTP/1.1 request over a TCP socket to a Matrix homeserver.
 */
async function sendHttpRequest(
  host: string,
  port: number,
  method: string,
  path: string,
  body?: string,
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

  let request = `${method} ${path} HTTP/1.1\r\n`;
  request += `Host: ${host}:${port}\r\n`;
  request += `Accept: application/json\r\n`;
  request += `Connection: close\r\n`;
  request += `User-Agent: PortOfCall/1.0\r\n`;

  if (authToken) {
    request += `Authorization: Bearer ${authToken}\r\n`;
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

  const headerEnd = response.indexOf('\r\n\r\n');
  if (headerEnd === -1) {
    throw new Error('Invalid HTTP response: no header terminator found');
  }

  const headerSection = response.substring(0, headerEnd);
  let bodySection = response.substring(headerEnd + 4);

  const statusLine = headerSection.split('\r\n')[0];
  const statusMatch = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/);
  const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;

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
 * Handle Matrix homeserver health/discovery check.
 * GET /_matrix/client/versions - Supported spec versions
 * GET /_matrix/client/v3/login - Available login flows
 * GET /_matrix/federation/v1/version - Server software version (federation port)
 */
export async function handleMatrixHealth(request: Request): Promise<Response> {
  try {
    const body = await request.json() as MatrixRequest;
    const { host, port = 8448, timeout = 15000 } = body;

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

    // Get supported client versions
    const versionsResult = await sendHttpRequest(
      host, port, 'GET', '/_matrix/client/versions', undefined, undefined, timeout,
    );

    // Get login flows
    let loginResult;
    try {
      loginResult = await sendHttpRequest(
        host, port, 'GET', '/_matrix/client/v3/login', undefined, undefined, timeout,
      );
    } catch {
      // Try older endpoint
      try {
        loginResult = await sendHttpRequest(
          host, port, 'GET', '/_matrix/client/r0/login', undefined, undefined, timeout,
        );
      } catch {
        loginResult = null;
      }
    }

    // Get federation version (may fail if not on federation port)
    let federationResult;
    try {
      federationResult = await sendHttpRequest(
        host, port, 'GET', '/_matrix/federation/v1/version', undefined, undefined, timeout,
      );
    } catch {
      federationResult = null;
    }

    const latencyMs = Date.now() - start;

    let versions;
    try {
      versions = JSON.parse(versionsResult.body);
    } catch {
      versions = versionsResult.body;
    }

    let loginFlows;
    if (loginResult) {
      try {
        loginFlows = JSON.parse(loginResult.body);
      } catch {
        loginFlows = loginResult.body;
      }
    }

    let federationVersion;
    if (federationResult) {
      try {
        federationVersion = JSON.parse(federationResult.body);
      } catch {
        federationVersion = null;
      }
    }

    const result: MatrixResponse = {
      success: versionsResult.statusCode >= 200 && versionsResult.statusCode < 400,
      statusCode: versionsResult.statusCode,
      parsed: {
        versions,
        loginFlows: loginFlows || null,
        federation: federationVersion || null,
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
 * Handle Matrix API query request.
 * Sends an arbitrary HTTP request to the Matrix homeserver.
 */
export async function handleMatrixQuery(request: Request): Promise<Response> {
  try {
    const body = await request.json() as MatrixQueryRequest;
    const {
      host,
      port = 8448,
      path = '/_matrix/client/versions',
      method = 'GET',
      body: queryBody,
      accessToken,
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

    const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE'];
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

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const start = Date.now();

    const result = await sendHttpRequest(
      host, port, upperMethod, normalizedPath, queryBody, accessToken, timeout,
    );

    const latencyMs = Date.now() - start;

    let parsed;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      parsed = null;
    }

    const response: MatrixResponse = {
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
