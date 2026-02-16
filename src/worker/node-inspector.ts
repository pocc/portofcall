/**
 * Node.js Inspector Protocol Implementation
 *
 * The V8 Inspector Protocol is used by Node.js for remote debugging.
 * It provides access to Node.js internals, JavaScript execution, profiling,
 * heap snapshots, and more.
 *
 * Port: 9229 (default)
 * Protocol: HTTP JSON API + WebSocket JSON-RPC (same as Chrome DevTools Protocol)
 * 
 * Protocol Flow:
 * 1. Node.js launches with --inspect or --inspect=9229
 * 2. Client queries HTTP endpoint /json for available sessions
 * 3. Client opens WebSocket to specific session UUID
 * 4. Client sends JSON-RPC commands
 * 5. Node.js responds with results or events
 *
 * Use Cases:
 * - Remote Node.js debugging
 * - CPU and memory profiling
 * - Heap snapshots and analysis
 * - JavaScript execution and REPL
 * - Performance monitoring
 * - Code coverage analysis
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface NodeInspectorRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface NodeInspectorQueryRequest extends NodeInspectorRequest {
  endpoint?: string;
}

interface NodeInspectorResponse {
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

  let request = `GET ${path} HTTP/1.1\r\n`;
  request += `Host: ${host}:${port}\r\n`;
  request += `Accept: application/json\r\n`;
  request += `Connection: close\r\n`;
  request += `User-Agent: PortOfCall/1.0\r\n`;
  request += `\r\n`;

  await writer.write(encoder.encode(request));
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
 * Handle Node Inspector health check - probes /json endpoint
 * GET /json or /json/list returns available debug sessions
 */
export async function handleNodeInspectorHealth(request: Request): Promise<Response> {
  try {
    const body = await request.json() as NodeInspectorRequest;
    const { host, port = 9229, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    // Query /json endpoint for available sessions
    const sessionsResult = await sendHttpRequest(host, port, '/json', timeout);

    // Try /json/version endpoint
    let versionResult;
    try {
      versionResult = await sendHttpRequest(host, port, '/json/version', timeout);
    } catch {
      versionResult = null;
    }

    const latencyMs = Date.now() - start;

    let sessions;
    try {
      sessions = JSON.parse(sessionsResult.body);
    } catch {
      sessions = sessionsResult.body;
    }

    let version;
    if (versionResult) {
      try {
        version = JSON.parse(versionResult.body);
      } catch {
        version = null;
      }
    }

    const result: NodeInspectorResponse = {
      success: sessionsResult.statusCode >= 200 && sessionsResult.statusCode < 400,
      statusCode: sessionsResult.statusCode,
      parsed: {
        sessions,
        sessionCount: Array.isArray(sessions) ? sessions.length : 0,
        version: version || null,
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
 * Handle Node Inspector query - arbitrary HTTP endpoint query
 */
export async function handleNodeInspectorQuery(request: Request): Promise<Response> {
  try {
    const body = await request.json() as NodeInspectorQueryRequest;
    const {
      host,
      port = 9229,
      endpoint = '/json',
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

    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const start = Date.now();

    const result = await sendHttpRequest(host, port, normalizedEndpoint, timeout);
    const latencyMs = Date.now() - start;

    let parsed;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      parsed = null;
    }

    const response: NodeInspectorResponse = {
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
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Create a WebSocket tunnel to Node.js Inspector
 * Reuses CDP WebSocket tunnel code since protocols are identical
 */
export async function handleNodeInspectorTunnel(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const host = url.searchParams.get('host');
  const port = url.searchParams.get('port') || '9229';
  const sessionId = url.searchParams.get('sessionId');

  if (!host) {
    return new Response('Host parameter is required', { status: 400 });
  }

  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    return new Response(getCloudflareErrorMessage(host, cfCheck.ip), { status: 403 });
  }

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();

  (async () => {
    let inspectorSocket: Socket | null = null;

    try {
      inspectorSocket = connect(`${host}:${port}`);
      await inspectorSocket.opened;

      // Determine WebSocket path (UUID-based)
      const wsPath = sessionId ? `/${sessionId}` : '/';

      // Perform WebSocket handshake
      const wsKey = generateWebSocketKey();
      const handshakeRequest = buildWebSocketHandshake(host, parseInt(port), wsPath, wsKey);

      const writer = inspectorSocket.writable.getWriter();
      await writer.write(new TextEncoder().encode(handshakeRequest));
      writer.releaseLock();

      // Read handshake response
      const reader = inspectorSocket.readable.getReader();
      const handshakeResponse = await readUntilDoubleNewline(reader);
      reader.releaseLock();

      if (!handshakeResponse.includes('101 Switching Protocols')) {
        throw new Error('WebSocket handshake failed');
      }

      server.send(JSON.stringify({
        type: 'connected',
        message: 'Node Inspector WebSocket tunnel established',
        sessionId,
      }));

      // Bidirectional proxying
      const decoder = new TextDecoder();

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

          const frame = buildWebSocketTextFrame(data);
          const writer = inspectorSocket!.writable.getWriter();
          await writer.write(frame);
          writer.releaseLock();
        } catch (error) {
          console.error('Error forwarding to Inspector:', error);
        }
      });

      (async () => {
        try {
          while (true) {
            const reader = inspectorSocket!.readable.getReader();
            const { value, done } = await reader.read();
            reader.releaseLock();

            if (done) break;
            if (!value) continue;

            const frames = parseWebSocketFrames(value);
            for (const frame of frames) {
              if (frame.opcode === 0x1 || frame.opcode === 0x2) {
                const payload = decoder.decode(frame.payload);
                server.send(payload);
              } else if (frame.opcode === 0x8) {
                server.close(1000, 'Inspector connection closed');
                break;
              } else if (frame.opcode === 0x9) {
                const pongFrame = buildWebSocketPongFrame(frame.payload);
                const writer = inspectorSocket!.writable.getWriter();
                await writer.write(pongFrame);
                writer.releaseLock();
              }
            }
          }
        } catch (error) {
          console.error('Error reading from Inspector:', error);
          server.close(1011, 'Inspector read error');
        }
      })();

      server.addEventListener('close', () => {
        if (inspectorSocket) {
          inspectorSocket.close().catch(() => {});
        }
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Inspector tunnel failed';
      server.send(JSON.stringify({
        type: 'error',
        error: errorMessage,
      }));
      server.close(1011, errorMessage);

      if (inspectorSocket) {
        inspectorSocket.close().catch(() => {});
      }
    }
  })();

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

// WebSocket utility functions (same as CDP)
function generateWebSocketKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

function buildWebSocketHandshake(host: string, port: number, path: string, wsKey: string): string {
  let request = `GET ${path} HTTP/1.1\r\n`;
  request += `Host: ${host}:${port}\r\n`;
  request += `Upgrade: websocket\r\n`;
  request += `Connection: Upgrade\r\n`;
  request += `Sec-WebSocket-Key: ${wsKey}\r\n`;
  request += `Sec-WebSocket-Version: 13\r\n`;
  request += `\r\n`;
  return request;
}

async function readUntilDoubleNewline(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let data = '';

  while (!data.includes('\r\n\r\n')) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      data += decoder.decode(value, { stream: true });
    }
  }

  return data;
}

function buildWebSocketTextFrame(text: string): Uint8Array {
  const payload = new TextEncoder().encode(text);
  const maskKey = new Uint8Array(4);
  crypto.getRandomValues(maskKey);

  const frame: number[] = [];
  frame.push(0x81);

  if (payload.length < 126) {
    frame.push(0x80 | payload.length);
  } else if (payload.length < 65536) {
    frame.push(0x80 | 126);
    frame.push((payload.length >> 8) & 0xff);
    frame.push(payload.length & 0xff);
  } else {
    frame.push(0x80 | 127);
    frame.push(0, 0, 0, 0);
    frame.push((payload.length >> 24) & 0xff);
    frame.push((payload.length >> 16) & 0xff);
    frame.push((payload.length >> 8) & 0xff);
    frame.push(payload.length & 0xff);
  }

  frame.push(maskKey[0], maskKey[1], maskKey[2], maskKey[3]);

  for (let i = 0; i < payload.length; i++) {
    frame.push(payload[i] ^ maskKey[i % 4]);
  }

  return new Uint8Array(frame);
}

function buildWebSocketPongFrame(payload: Uint8Array): Uint8Array {
  const maskKey = new Uint8Array(4);
  crypto.getRandomValues(maskKey);

  const frame: number[] = [];
  frame.push(0x8A);

  if (payload.length < 126) {
    frame.push(0x80 | payload.length);
  } else {
    frame.push(0x80 | 126);
    frame.push((payload.length >> 8) & 0xff);
    frame.push(payload.length & 0xff);
  }

  frame.push(maskKey[0], maskKey[1], maskKey[2], maskKey[3]);

  for (let i = 0; i < payload.length; i++) {
    frame.push(payload[i] ^ maskKey[i % 4]);
  }

  return new Uint8Array(frame);
}

interface WebSocketFrame {
  fin: boolean;
  opcode: number;
  masked: boolean;
  payload: Uint8Array;
}

function parseWebSocketFrames(data: Uint8Array): WebSocketFrame[] {
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

  return frames;
}
