/**
 * Chrome DevTools Protocol (CDP) Implementation
 *
 * CDP is the protocol used by Chrome/Chromium browsers for remote debugging.
 * It provides access to browser internals, DOM manipulation, JavaScript execution,
 * network monitoring, performance profiling, and more.
 *
 * Port: 9222 (default)
 * Protocol: HTTP JSON API + WebSocket JSON-RPC 2.0
 * 
 * Protocol Flow:
 * 1. Browser launches with --remote-debugging-port=9222
 * 2. Client queries HTTP endpoints for available targets
 * 3. Client opens WebSocket to specific target
 * 4. Client sends JSON-RPC commands
 * 5. Browser responds with results or events
 *
 * Use Cases:
 * - Remote browser automation and testing
 * - Screenshot and PDF generation
 * - Performance profiling and monitoring
 * - Network traffic inspection
 * - JavaScript execution and debugging
 * - DOM inspection and manipulation
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface CDPRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface CDPQueryRequest extends CDPRequest {
  endpoint?: string;
}

interface CDPResponse {
  success: boolean;
  statusCode?: number;
  parsed?: unknown;
  body?: string;
  error?: string;
  latencyMs?: number;
}

/**
 * Send raw HTTP/1.1 GET request over TCP socket
 */
async function sendHttpRequest(
  host: string,
  port: number,
  path: string,
  timeout = 10000,
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  await Promise.race([socket.opened, timeoutPromise]);

  const writer = socket.writable.getWriter();
  const encoder = new TextEncoder();

  const safeHost = host.replace(/[\r\n]/g, '');
  const safePath = path.replace(/[\r\n]/g, '');
  let request = `GET ${safePath} HTTP/1.1\r\n`;
  request += `Host: ${safeHost}:${port}\r\n`;
  request += `Accept: application/json\r\n`;
  request += `Connection: close\r\n`;
  request += `User-Agent: PortOfCall/1.0\r\n`;
  request += `\r\n`;

  try {
    await writer.write(encoder.encode(request));
  } finally {
    try { writer.releaseLock(); } catch { /* ignored */ }
  }

  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  let response = '';
  const maxSize = 512000; // 512KB max response

  try {
    while (response.length < maxSize) {
      const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
      if (done) break;
      if (value) {
        const chunk = decoder.decode(value, { stream: true });
        if (response.length + chunk.length > maxSize) {
          response += chunk.substring(0, maxSize - response.length);
          break;
        }
        response += chunk;
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignored */ }
    try { socket.close(); } catch { /* ignored */ }
  }

  const headerEnd = response.indexOf('\r\n\r\n');
  if (headerEnd === -1) {
    throw new Error('Invalid HTTP response: no header terminator found');
  }

  const headerSection = response.substring(0, headerEnd);
  let bodySection = response.substring(headerEnd + 4);

  const statusLine = headerSection.split('\r\n')[0];
  const statusMatch = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/);
  const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;

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
 * Decode HTTP chunked transfer encoding
 */
function decodeChunked(data: string): string {
  let result = '';
  let remaining = data;
  let lastChunkSize = -1;

  while (remaining.length > 0) {
    const lineEnd = remaining.indexOf('\r\n');
    if (lineEnd === -1) break;

    const sizeStr = remaining.substring(0, lineEnd).trim();
    const chunkSize = parseInt(sizeStr, 16);
    lastChunkSize = isNaN(chunkSize) ? -1 : chunkSize;
    if (isNaN(chunkSize) || chunkSize === 0) break;

    const chunkStart = lineEnd + 2;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > remaining.length) {
      result += remaining.substring(chunkStart);
      lastChunkSize = -1; // truncated — terminator not reached
      break;
    }

    result += remaining.substring(chunkStart, chunkEnd);
    remaining = remaining.substring(chunkEnd + 2);
  }

  // RFC 7230 §4.1: a chunked response MUST be terminated by a zero-length chunk.
  // If the last processed chunk size was not 0, the response was truncated.
  if (lastChunkSize !== 0) {
    console.warn('Incomplete chunked response: missing zero-length terminator chunk');
  }

  return result;
}

/**
 * Handle CDP health check - probes /json/version endpoint
 * GET /json/version returns browser version info
 */
export async function handleCDPHealth(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }
  const start = Date.now();
  try {
    const body = await request.json() as CDPRequest;
    const { host, port = 9222, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (typeof port !== 'number' || isNaN(port) || port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
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

    // Query /json/version endpoint
    const versionResult = await sendHttpRequest(host, port, '/json/version', timeout);

    // Query /json/list endpoint to get targets
    let targetsResult;
    try {
      targetsResult = await sendHttpRequest(host, port, '/json/list', timeout);
    } catch {
      targetsResult = null;
    }

    const latencyMs = Date.now() - start;

    let versionInfo;
    try {
      versionInfo = JSON.parse(versionResult.body);
    } catch {
      versionInfo = versionResult.body;
    }

    let targets;
    if (targetsResult) {
      try {
        targets = JSON.parse(targetsResult.body);
      } catch {
        targets = null;
      }
    }

    const result: CDPResponse = {
      success: versionResult.statusCode >= 200 && versionResult.statusCode < 400,
      statusCode: versionResult.statusCode,
      parsed: {
        version: versionInfo,
        targets: targets || null,
        targetCount: Array.isArray(targets) ? targets.length : 0,
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
      latencyMs: Date.now() - start,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle CDP query - arbitrary HTTP endpoint query
 * Supports /json/version, /json/list, /json/protocol, /json/new, /json/close/<id>
 */
export async function handleCDPQuery(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }
  const start = Date.now();
  try {
    const body = await request.json() as CDPQueryRequest;
    const {
      host,
      port = 9222,
      endpoint = '/json/version',
      timeout = 10000,
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

    if (typeof port !== 'number' || isNaN(port) || port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check for Cloudflare protection
    const cfCheckQuery = await checkIfCloudflare(host);
    if (cfCheckQuery.isCloudflare && cfCheckQuery.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheckQuery.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    // Validate endpoint starts with /
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

    const result = await sendHttpRequest(host, port, normalizedEndpoint, timeout);
    const latencyMs = Date.now() - start;

    let parsed;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      parsed = null;
    }

    const response: CDPResponse = {
      success: result.statusCode >= 200 && result.statusCode < 400,
      statusCode: result.statusCode,
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
      statusCode: 0,
      latencyMs: Date.now() - start,
      body: '',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Create a WebSocket tunnel to Chrome DevTools Protocol
 * This establishes a bidirectional WebSocket connection between the browser client
 * and Chrome's CDP WebSocket endpoint, allowing full JSON-RPC 2.0 command execution.
 */
export async function handleCDPTunnel(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const host = url.searchParams.get('host');
  const port = url.searchParams.get('port') || '9222';
  const targetId = url.searchParams.get('targetId');

  if (!host) {
    return new Response('Host parameter is required', { status: 400 });
  }

  const portNum = parseInt(port, 10);
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    return new Response('Port must be between 1 and 65535', { status: 400 });
  }

  // Check for Cloudflare protection
  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    return new Response(getCloudflareErrorMessage(host, cfCheck.ip), { status: 403 });
  }

  // Create WebSocket pair for client connection
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();

  // Handle the WebSocket tunnel asynchronously
  (async () => {
    let cdpSocket: Socket | null = null;
    let cdpWriter: WritableStreamDefaultWriter | null;
    let cdpReader: ReadableStreamDefaultReader<Uint8Array> | null;

    try {
      // Connect to Chrome's CDP port
      cdpSocket = connect(`${host}:${portNum}`);
      await cdpSocket.opened;

      // Determine WebSocket path
      let wsPath = '/devtools/browser';
      if (targetId) {
        wsPath = `/devtools/page/${targetId}`;
      }

      // Perform WebSocket handshake with Chrome
      const wsKey = generateWebSocketKey();
      const handshakeRequest = buildWebSocketHandshake(host, portNum, wsPath, wsKey);

      cdpWriter = cdpSocket.writable.getWriter();
      await cdpWriter.write(new TextEncoder().encode(handshakeRequest));
      cdpWriter.releaseLock();

      // Read handshake response (binary-safe to preserve leftover frame data)
      cdpReader = cdpSocket.readable.getReader();
      const { response: handshakeResponse, leftover: handshakeLeftover } =
        await readHttpHeaders(cdpReader);

      if (!handshakeResponse.includes('101 Switching Protocols')) {
        throw new Error('WebSocket handshake failed');
      }

      server.send(JSON.stringify({
        type: 'connected',
        message: 'CDP WebSocket tunnel established',
        targetId,
      }));

      // Start bidirectional proxying
      const decoder = new TextDecoder();

      // Client -> CDP (browser commands to Chrome)
      server.addEventListener('message', async (event) => {
        try {
          const message = event.data;
          let data: string;

          if (typeof message === 'string') {
            data = message;
          } else if (message instanceof ArrayBuffer) {
            data = decoder.decode(message);
          } else {
            return;
          }

          // Wrap in WebSocket frame and send to CDP
          const frame = buildWebSocketTextFrame(data);
          const writer = cdpSocket!.writable.getWriter();
          try {
            await writer.write(frame);
          } finally {
            try { writer.releaseLock(); } catch { /* ignored */ }
          }
        } catch (error) {
          console.error('Error forwarding to CDP:', error);
        }
      });

      // CDP -> Client (Chrome responses/events to browser)
      // Reuse cdpReader (already holds the readable lock from handshake).
      // Seed the buffer with any leftover bytes from the handshake response
      // that may contain the start of the first WebSocket frame.
      let cdpLoopStopped = false;
      server.addEventListener('close', () => { cdpLoopStopped = true; });

      (async () => {
        let wsBuffer = handshakeLeftover;
        try {
          while (!cdpLoopStopped) {
            // Parse all complete frames from the accumulated buffer
            const { frames, consumed } = parseWebSocketFrames(wsBuffer);
            wsBuffer = wsBuffer.slice(consumed);

            let shouldBreak = false;
            for (const frame of frames) {
              if (frame.opcode === 0x1 || frame.opcode === 0x2) {
                // Text or binary frame - forward payload to client
                const payload = decoder.decode(frame.payload);
                server.send(payload);
              } else if (frame.opcode === 0x8) {
                // Close frame
                server.close(1000, 'CDP connection closed');
                cdpLoopStopped = true;
                shouldBreak = true;
                break;
              } else if (frame.opcode === 0x9) {
                // Ping frame - respond with pong
                const pongFrame = buildWebSocketPongFrame(frame.payload);
                const writer = cdpSocket!.writable.getWriter();
                try {
                  await writer.write(pongFrame);
                } finally {
                  try { writer.releaseLock(); } catch { /* ignored */ }
                }
              }
            }
            if (shouldBreak) break;

            // Read more data from CDP
            const { value, done } = await cdpReader!.read();
            if (done) break;
            if (value) {
              const merged = new Uint8Array(wsBuffer.length + value.length);
              merged.set(wsBuffer);
              merged.set(value, wsBuffer.length);
              wsBuffer = merged;
            }
          }
        } catch (error) {
          console.error('Error reading from CDP:', error);
          server.close(1011, 'CDP read error');
        } finally {
          try { cdpReader!.releaseLock(); } catch { /* ignored */ }
        }
      })();

      // Handle client disconnect
      server.addEventListener('close', () => {
        if (cdpSocket) {
          cdpSocket.close().catch(() => {});
        }
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'CDP tunnel failed';
      server.send(JSON.stringify({
        type: 'error',
        error: errorMessage,
      }));
      server.close(1011, errorMessage);

      if (cdpSocket) {
        cdpSocket.close().catch(() => {});
      }
    }
  })();

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

/**
 * Generate a random WebSocket key
 */
function generateWebSocketKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Build WebSocket handshake request
 */
function buildWebSocketHandshake(host: string, port: number, path: string, wsKey: string): string {
  const safeHost = host.replace(/[\r\n]/g, '');
  const safePath = path.replace(/[\r\n]/g, '');
  let request = `GET ${safePath} HTTP/1.1\r\n`;
  request += `Host: ${safeHost}:${port}\r\n`;
  request += `Upgrade: websocket\r\n`;
  request += `Connection: Upgrade\r\n`;
  request += `Sec-WebSocket-Key: ${wsKey}\r\n`;
  request += `Sec-WebSocket-Version: 13\r\n`;
  request += `\r\n`;
  return request;
}

/**
 * Read from socket until \r\n\r\n (end of HTTP headers).
 * Works with raw bytes so that any data after the header terminator
 * (e.g. a WebSocket frame that arrived in the same TCP segment)
 * is preserved as binary leftover instead of being decoded to string and lost.
 */
async function readHttpHeaders(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<{ response: string; leftover: Uint8Array }> {
  let buf = new Uint8Array(0);

  while (true) {
    // Search for \r\n\r\n in accumulated buffer
    for (let i = 0; i <= buf.length - 4; i++) {
      if (
        buf[i] === 0x0d &&
        buf[i + 1] === 0x0a &&
        buf[i + 2] === 0x0d &&
        buf[i + 3] === 0x0a
      ) {
        const headerEnd = i + 4;
        const response = new TextDecoder().decode(buf.slice(0, headerEnd));
        const leftover = buf.slice(headerEnd);
        return { response, leftover };
      }
    }

    const { value, done } = await reader.read();
    if (done || !value) throw new Error('Connection closed during HTTP handshake');
    const merged = new Uint8Array(buf.length + value.length);
    merged.set(buf);
    merged.set(value, buf.length);
    buf = merged;
  }
}

/**
 * Build a WebSocket text frame (masked, for client-to-server)
 */
function buildWebSocketTextFrame(text: string): Uint8Array {
  const payload = new TextEncoder().encode(text);
  const maskKey = new Uint8Array(4);
  crypto.getRandomValues(maskKey);

  const frame: number[] = [];

  // FIN=1, RSV=0, opcode=0x1 (text)
  frame.push(0x81);

  // MASK=1, payload length
  if (payload.length < 126) {
    frame.push(0x80 | payload.length);
  } else if (payload.length < 65536) {
    frame.push(0x80 | 126);
    frame.push((payload.length >> 8) & 0xff);
    frame.push(payload.length & 0xff);
  } else {
    frame.push(0x80 | 127);
    // 64-bit length (we only use lower 32 bits)
    frame.push(0, 0, 0, 0);
    frame.push((payload.length >> 24) & 0xff);
    frame.push((payload.length >> 16) & 0xff);
    frame.push((payload.length >> 8) & 0xff);
    frame.push(payload.length & 0xff);
  }

  // Masking key
  frame.push(maskKey[0], maskKey[1], maskKey[2], maskKey[3]);

  // Masked payload
  for (let i = 0; i < payload.length; i++) {
    frame.push(payload[i] ^ maskKey[i % 4]);
  }

  return new Uint8Array(frame);
}

/**
 * Build a WebSocket pong frame (response to ping)
 */
function buildWebSocketPongFrame(payload: Uint8Array): Uint8Array {
  const maskKey = new Uint8Array(4);
  crypto.getRandomValues(maskKey);

  const frame: number[] = [];

  // FIN=1, RSV=0, opcode=0xA (pong)
  frame.push(0x8A);

  // MASK=1, payload length
  if (payload.length < 126) {
    frame.push(0x80 | payload.length);
  } else {
    frame.push(0x80 | 126);
    frame.push((payload.length >> 8) & 0xff);
    frame.push(payload.length & 0xff);
  }

  // Masking key
  frame.push(maskKey[0], maskKey[1], maskKey[2], maskKey[3]);

  // Masked payload
  for (let i = 0; i < payload.length; i++) {
    frame.push(payload[i] ^ maskKey[i % 4]);
  }

  return new Uint8Array(frame);
}

/**
 * Parse WebSocket frames from raw bytes
 */
interface WebSocketFrame {
  fin: boolean;
  opcode: number;
  masked: boolean;
  payload: Uint8Array;
}

function parseWebSocketFrames(data: Uint8Array): { frames: WebSocketFrame[]; consumed: number } {
  const frames: WebSocketFrame[] = [];
  let offset = 0;

  while (offset < data.length) {
    if (offset + 2 > data.length) break;

    const fin = (data[offset] & 0x80) !== 0;
    const opcode = data[offset] & 0x0f;
    const masked = (data[offset + 1] & 0x80) !== 0;
    let payloadLength = data[offset + 1] & 0x7f;
    let headerLength = 2;

    if (payloadLength === 126) {
      if (offset + 4 > data.length) break;
      payloadLength = (data[offset + 2] << 8) | data[offset + 3];
      headerLength = 4;
    } else if (payloadLength === 127) {
      if (offset + 10 > data.length) break;
      // Only handle up to 32-bit lengths
      payloadLength =
        (data[offset + 6] << 24) |
        (data[offset + 7] << 16) |
        (data[offset + 8] << 8) |
        data[offset + 9];
      headerLength = 10;
    }

    let maskKey: Uint8Array | null = null;
    if (masked) {
      if (offset + headerLength + 4 > data.length) break;
      maskKey = data.slice(offset + headerLength, offset + headerLength + 4);
      headerLength += 4;
    }

    if (offset + headerLength + payloadLength > data.length) break;

    let payload = data.slice(offset + headerLength, offset + headerLength + payloadLength);

    // Unmask payload if masked
    if (masked && maskKey) {
      const unmasked = new Uint8Array(payload.length);
      for (let i = 0; i < payload.length; i++) {
        unmasked[i] = payload[i] ^ maskKey[i % 4];
      }
      payload = unmasked;
    }

    frames.push({ fin, opcode, masked, payload });
    offset += headerLength + payloadLength;
  }

  return { frames, consumed: offset };
}
