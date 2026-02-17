/**
 * HTTP/1.1 Protocol Implementation (RFC 9110 / RFC 9112) — Port 80/TCP
 *
 * HTTP/1.1 is a text-based request/response protocol that runs directly over
 * TCP. This implementation sends raw HTTP/1.1 messages over a TCP socket,
 * demonstrating the wire-level protocol that browsers and HTTP libraries
 * abstract away.
 *
 * HTTP/1.1 Request Format:
 *   {METHOD} {path} HTTP/1.1\r\n
 *   Host: {host}\r\n
 *   {header}: {value}\r\n
 *   ...
 *   \r\n
 *   {optional body}
 *
 * HTTP/1.1 Response Format:
 *   HTTP/1.1 {status-code} {reason-phrase}\r\n
 *   {header}: {value}\r\n
 *   ...
 *   \r\n
 *   {body}
 *
 * Key HTTP/1.1 features implemented:
 *   - All standard methods: GET, POST, HEAD, PUT, DELETE, OPTIONS, PATCH
 *   - Required Host header (distinguishes HTTP/1.1 from 1.0)
 *   - Transfer-Encoding: chunked decoding
 *   - Content-Length body reading
 *   - Custom request headers and body
 *   - Connection timing (TCP connect + TTFB + total)
 *
 * Note: For HTTPS (port 443), the same protocol runs over TLS.
 * Use the secureTransport option or target a HTTPS-aware endpoint.
 *
 * Default Port: 80/TCP
 *
 * References:
 *   RFC 9110 — HTTP Semantics
 *   RFC 9112 — HTTP/1.1
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// HTTP methods we allow
const ALLOWED_METHODS = new Set(['GET', 'POST', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'TRACE']);

// Maximum body size to return (64 KiB)
const MAX_BODY_BYTES = 65536;

interface HTTPRequestOptions {
  host: string;
  port?: number;
  tls?: boolean;
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
  followRedirects?: boolean;
  timeout?: number;
  maxBodyBytes?: number;
}

interface HTTPResponse {
  success: boolean;
  host?: string;
  port?: number;
  tls?: boolean;

  // Timing
  tcpLatency?: number;   // Time to TCP connect (ms)
  ttfb?: number;         // Time to first byte of response (ms)
  totalTime?: number;    // Total time including body read (ms)

  // Request echo
  requestLine?: string;
  requestHeaders?: Record<string, string>;

  // Response
  httpVersion?: string;
  statusCode?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  body?: string;
  bodyBytes?: number;
  bodyTruncated?: boolean;
  transferEncoding?: string;

  error?: string;
  isCloudflare?: boolean;
}

function validateInput(host: string, port: number, method: string): string | null {
  if (!host || host.trim().length === 0) return 'Host is required';
  if (!/^[a-zA-Z0-9._:-]+$/.test(host)) return 'Host contains invalid characters';
  if (port < 1 || port > 65535) return 'Port must be between 1 and 65535';
  if (!ALLOWED_METHODS.has(method)) {
    return `Method must be one of: ${[...ALLOWED_METHODS].join(', ')}`;
  }
  return null;
}

/**
 * Decode a chunked Transfer-Encoding body.
 *
 * Chunked format:
 *   {hex-size}\r\n
 *   {data}\r\n
 *   ...
 *   0\r\n
 *   \r\n
 */
function decodeChunked(data: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const decoder = new TextDecoder('utf-8', { fatal: false });

  while (offset < data.length) {
    // Find the \r\n after the hex size
    let lineEnd = -1;
    for (let i = offset; i < data.length - 1; i++) {
      if (data[i] === 0x0D && data[i + 1] === 0x0A) {
        lineEnd = i;
        break;
      }
    }
    if (lineEnd === -1) break;

    // Parse hex size (may have chunk extensions after ';')
    const sizeLine = decoder.decode(data.slice(offset, lineEnd));
    const chunkSize = parseInt(sizeLine.split(';')[0].trim(), 16);
    if (isNaN(chunkSize)) break;

    offset = lineEnd + 2; // skip \r\n

    // Terminal chunk
    if (chunkSize === 0) break;

    // Extract chunk data
    if (offset + chunkSize > data.length) {
      // Incomplete chunk — take what we have
      chunks.push(data.slice(offset));
      break;
    }
    chunks.push(data.slice(offset, offset + chunkSize));
    offset += chunkSize + 2; // skip data + trailing \r\n
  }

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const result = new Uint8Array(total);
  let off = 0;
  for (const chunk of chunks) {
    result.set(chunk, off);
    off += chunk.length;
  }
  return result;
}

/**
 * Parse raw HTTP response bytes into structured parts.
 * Returns headers section and body bytes separately.
 */
function parseRawResponse(data: Uint8Array): {
  httpVersion: string;
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  bodyBytes: Uint8Array;
  headerLength: number;
} {
  const decoder = new TextDecoder('utf-8', { fatal: false });

  // Find the header/body separator: \r\n\r\n
  let headerEnd = -1;
  for (let i = 0; i < data.length - 3; i++) {
    if (data[i] === 0x0D && data[i + 1] === 0x0A &&
        data[i + 2] === 0x0D && data[i + 3] === 0x0A) {
      headerEnd = i;
      break;
    }
  }

  const headerSection = headerEnd >= 0
    ? decoder.decode(data.slice(0, headerEnd))
    : decoder.decode(data);
  const bodyBytes = headerEnd >= 0 ? data.slice(headerEnd + 4) : new Uint8Array(0);

  const lines = headerSection.split('\r\n');
  const statusLine = lines[0] ?? '';

  // Parse status line: HTTP/1.1 200 OK
  const statusMatch = statusLine.match(/^(HTTP\/[\d.]+)\s+(\d+)\s*(.*)/);
  const httpVersion = statusMatch?.[1] ?? 'HTTP/?';
  const statusCode = statusMatch ? parseInt(statusMatch[2], 10) : 0;
  const statusText = statusMatch?.[3] ?? '';

  // Parse headers
  const headers: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const colonIdx = lines[i].indexOf(':');
    if (colonIdx > 0) {
      const key = lines[i].slice(0, colonIdx).trim().toLowerCase();
      const value = lines[i].slice(colonIdx + 1).trim();
      // Handle duplicate headers by joining with comma
      headers[key] = headers[key] ? `${headers[key]}, ${value}` : value;
    }
  }

  return { httpVersion, statusCode, statusText, headers, bodyBytes, headerLength: headerEnd + 4 };
}

/**
 * Read the full HTTP response from the socket.
 * Handles both Content-Length and chunked responses.
 */
async function readFullResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  maxBytes: number,
): Promise<{ data: Uint8Array; timedOut: boolean }> {
  const chunks: Uint8Array[] = [];
  let totalLen = 0;
  let timedOut = false;

  const deadline = Date.now() + timeoutMs;

  const readNext = async (): Promise<{ value: Uint8Array | undefined; done: boolean }> => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      timedOut = true;
      return { value: undefined, done: true };
    }
    const t = new Promise<{ value: undefined; done: true }>((resolve) =>
      setTimeout(() => { timedOut = true; resolve({ value: undefined, done: true }); }, remaining),
    );
    return Promise.race([reader.read(), t]);
  };

  // Read first chunk (blocks until data arrives)
  const first = await readNext();
  if (first.done || !first.value) {
    return { data: new Uint8Array(0), timedOut };
  }
  chunks.push(first.value);
  totalLen += first.value.length;

  // Helper: assemble what we have so far
  const assembled = (): Uint8Array => {
    const buf = new Uint8Array(totalLen);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.length; }
    return buf;
  };

  // Keep reading until we have the complete response
  while (true) {
    // Check if we've reached the body limit
    if (totalLen >= maxBytes + 8192) break; // 8192 slack for headers

    // Parse what we have to check for completion
    const current = assembled();
    const headerEndIdx = (() => {
      for (let i = 0; i < current.length - 3; i++) {
        if (current[i] === 0x0D && current[i + 1] === 0x0A &&
            current[i + 2] === 0x0D && current[i + 3] === 0x0A) return i;
      }
      return -1;
    })();

    if (headerEndIdx >= 0) {
      const decoder = new TextDecoder('utf-8', { fatal: false });
      const headerStr = decoder.decode(current.slice(0, headerEndIdx));
      const bodyStart = headerEndIdx + 4;
      const bodyLen = totalLen - bodyStart;

      // Check Transfer-Encoding: chunked
      if (/transfer-encoding:\s*chunked/i.test(headerStr)) {
        const body = current.slice(bodyStart);
        // Chunked body ends with "0\r\n\r\n"
        if (body.length >= 5) {
          const tail = decoder.decode(body.slice(-7));
          if (tail.includes('0\r\n\r\n')) break;
        }
      } else {
        // Check Content-Length
        const clMatch = headerStr.match(/content-length:\s*(\d+)/i);
        if (clMatch) {
          const expectedLen = parseInt(clMatch[1], 10);
          if (bodyLen >= expectedLen) break;
        } else {
          // No Content-Length, no chunked — read until connection close
          // Use a short drain timeout
        }
      }

      // Check for HEAD / 1xx / 204 / 304 (no body)
      const statusMatch = headerStr.match(/^HTTP\/[\d.]+ (\d+)/);
      if (statusMatch) {
        const code = parseInt(statusMatch[1], 10);
        if (code < 200 || code === 204 || code === 304) break;
      }
    }

    // Read more data (short timeout to drain)
    const remaining = deadline - Date.now();
    if (remaining <= 0) { timedOut = true; break; }
    const drainTimeout = new Promise<{ value: undefined; done: true }>((resolve) =>
      setTimeout(() => resolve({ value: undefined, done: true }), Math.min(remaining, 1000)),
    );
    const next = await Promise.race([reader.read(), drainTimeout]);
    if (next.done || !next.value) break;
    chunks.push(next.value);
    totalLen += next.value.length;
  }

  return { data: assembled(), timedOut };
}

/**
 * Make a raw HTTP/1.1 request over TCP.
 *
 * POST /api/http/request
 * Body: {
 *   host,
 *   port?,           — default 80 (or 443 if tls: true)
 *   tls?,            — use TLS (HTTPS), default false
 *   method?,         — HTTP method, default "GET"
 *   path?,           — request path, default "/"
 *   headers?,        — additional request headers
 *   body?,           — request body (for POST/PUT/PATCH)
 *   timeout?,        — ms, default 15000
 *   maxBodyBytes?    — cap response body size, default 65536
 * }
 *
 * Returns: timing info, status, response headers, and body.
 */
export async function handleHTTPRequest(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const opts = (await request.json()) as HTTPRequestOptions;
    const {
      host,
      tls = false,
      method = 'GET',
      path = '/',
      headers: extraHeaders = {},
      body: requestBody,
      timeout = 15000,
      maxBodyBytes = MAX_BODY_BYTES,
    } = opts;

    const port = opts.port ?? (tls ? 443 : 80);
    const upperMethod = method.toUpperCase();

    const validationError = validateInput(host, port, upperMethod);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError } satisfies HTTPResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Sanitize path — must start with /
    const safePath = path.startsWith('/') ? path : `/${path}`;

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        } satisfies HTTPResponse),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    const socketOptions = tls
      ? { secureTransport: 'on' as const, allowHalfOpen: false }
      : undefined;
    const socket = connect(`${host}:${port}`, socketOptions);

    try {
      const connectStart = Date.now();
      await Promise.race([socket.opened, timeoutPromise]);
      const tcpLatency = Date.now() - connectStart;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Build the request headers map (lowercase keys, our defaults first)
      const reqHeaders: Record<string, string> = {
        'Host': host,
        'User-Agent': 'portofcall/1.0 (HTTP/1.1 TCP explorer)',
        'Accept': '*/*',
        'Connection': 'close',
        // Merge caller-supplied headers (these win over defaults)
        ...extraHeaders,
      };

      // Add Content-Length if there's a body
      if (requestBody !== undefined && requestBody !== '') {
        const bodyBytes = new TextEncoder().encode(requestBody);
        reqHeaders['Content-Length'] = String(bodyBytes.length);
        if (!reqHeaders['Content-Type'] && !reqHeaders['content-type']) {
          reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
        }
      }

      // Assemble the raw HTTP/1.1 request
      const requestLine = `${upperMethod} ${safePath} HTTP/1.1`;
      const headerLines = Object.entries(reqHeaders)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\r\n');
      const rawRequest = `${requestLine}\r\n${headerLines}\r\n\r\n${requestBody ?? ''}`;

      await writer.write(new TextEncoder().encode(rawRequest));
      const sendTime = Date.now();

      // Read the full response
      const effectiveTimeout = Math.max(timeout - tcpLatency - (Date.now() - connectStart), 2000);
      const { data: responseData, timedOut } = await readFullResponse(reader, effectiveTimeout, maxBodyBytes);
      const ttfb = Date.now() - sendTime; // crude TTFB — time until we got all data back

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      if (responseData.length === 0) {
        return new Response(
          JSON.stringify({
            success: false,
            host,
            port,
            tls,
            tcpLatency,
            requestLine,
            requestHeaders: reqHeaders,
            error: 'No response received from server',
          } satisfies HTTPResponse),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const parsed = parseRawResponse(responseData);
      const decoder = new TextDecoder('utf-8', { fatal: false });

      // Determine transfer encoding
      const transferEncoding = parsed.headers['transfer-encoding'] ?? '';
      const isChunked = transferEncoding.toLowerCase().includes('chunked');

      // Decode body
      let bodyData = parsed.bodyBytes;
      if (isChunked) {
        bodyData = decodeChunked(bodyData);
      }

      // Truncate body if over limit
      const bodyTruncated = bodyData.length > maxBodyBytes;
      const finalBodyBytes = bodyTruncated ? bodyData.slice(0, maxBodyBytes) : bodyData;

      // Determine content type for body decoding hint
      const contentType = parsed.headers['content-type'] ?? '';
      const isBinary = /image|audio|video|octet-stream|font|zip|gzip|pdf/.test(contentType);

      const bodyStr = isBinary
        ? `[binary content: ${bodyData.length} bytes, content-type: ${contentType}]`
        : decoder.decode(finalBodyBytes);

      const totalTime = Date.now() - connectStart;

      return new Response(
        JSON.stringify({
          success: parsed.statusCode >= 100,
          host,
          port,
          tls,
          tcpLatency,
          ttfb,
          totalTime,
          requestLine,
          requestHeaders: reqHeaders,
          httpVersion: parsed.httpVersion,
          statusCode: parsed.statusCode,
          statusText: parsed.statusText,
          responseHeaders: parsed.headers,
          transferEncoding: transferEncoding || undefined,
          body: upperMethod === 'HEAD' ? undefined : bodyStr,
          bodyBytes: bodyData.length,
          bodyTruncated: bodyTruncated || timedOut || undefined,
        } satisfies HTTPResponse),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      } satisfies HTTPResponse),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Send an HTTP HEAD request — retrieves only headers, no body.
 * Useful for checking server identity, cache headers, and content metadata.
 *
 * POST /api/http/head
 * Body: { host, port?, tls?, path?, headers?, timeout? }
 */
export async function handleHTTPHead(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  const body = (await request.json()) as HTTPRequestOptions;
  return handleHTTPRequest(new Request(request.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, method: 'HEAD' }),
  }));
}

/**
 * HTTP/1.1 OPTIONS probe — discovers server capabilities.
 * Many servers respond to OPTIONS * HTTP/1.1 with an Allow header
 * listing the methods they support.
 *
 * POST /api/http/options
 * Body: { host, port?, tls?, timeout? }
 */
export async function handleHTTPOptions(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  const body = (await request.json()) as HTTPRequestOptions;
  return handleHTTPRequest(new Request(request.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, method: 'OPTIONS', path: body.path ?? '*' }),
  }));
}
