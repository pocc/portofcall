/**
 * JSON-RPC 2.0 Protocol Implementation (over HTTP/TCP)
 *
 * JSON-RPC is a lightweight remote procedure call protocol using JSON
 * encoding. It's widely used by blockchain nodes (Ethereum port 8545,
 * Bitcoin port 8332) and many other services.
 *
 * Protocol Flow:
 * 1. Client connects to server via TCP
 * 2. Client sends HTTP POST with JSON-RPC request body
 * 3. Server responds with JSON-RPC response
 * 4. Connection closes
 *
 * JSON-RPC 2.0 Request:
 * {"jsonrpc": "2.0", "method": "...", "params": [...], "id": 1}
 *
 * JSON-RPC 2.0 Response:
 * {"jsonrpc": "2.0", "result": ..., "id": 1}
 * or
 * {"jsonrpc": "2.0", "error": {"code": -32601, "message": "..."}, "id": 1}
 *
 * Spec: https://www.jsonrpc.org/specification
 */

import { connect } from 'cloudflare:sockets';

interface JsonRpcWorkerRequest {
  host: string;
  port?: number;
  path?: string;
  method: string;
  params?: unknown;
  username?: string;
  password?: string;
  timeout?: number;
}

interface JsonRpcResponse {
  success: boolean;
  statusCode?: number;
  jsonrpc?: {
    jsonrpc: string;
    result?: unknown;
    error?: {
      code: number;
      message: string;
      data?: unknown;
    };
    id: number | string | null;
  };
  error?: string;
  latencyMs?: number;
}

/**
 * Send a raw HTTP/1.1 POST request over a TCP socket.
 */
async function sendHttpPost(
  host: string,
  port: number,
  path: string,
  body: string,
  authHeader?: string,
  timeout = 15000,
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  await Promise.race([socket.opened, timeoutPromise]);

  const writer = socket.writable.getWriter();
  const encoder = new TextEncoder();
  const bodyBytes = encoder.encode(body);

  // Build HTTP/1.1 POST request
  let request = `POST ${path} HTTP/1.1\r\n`;
  request += `Host: ${host}:${port}\r\n`;
  request += `Content-Type: application/json\r\n`;
  request += `Content-Length: ${bodyBytes.length}\r\n`;
  request += `Accept: application/json\r\n`;
  request += `Connection: close\r\n`;
  request += `User-Agent: PortOfCall/1.0\r\n`;

  if (authHeader) {
    request += `Authorization: ${authHeader}\r\n`;
  }

  request += `\r\n`;
  await writer.write(encoder.encode(request));
  await writer.write(bodyBytes);

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
      const val = line.substring(colonIdx + 1).trim();
      headers[key] = val;
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
 * Build Basic Auth header.
 */
function buildAuthHeader(username?: string, password?: string): string | undefined {
  if (username && password) {
    return `Basic ${btoa(`${username}:${password}`)}`;
  }
  return undefined;
}

/**
 * Build a JSON-RPC 2.0 request object.
 */
function buildJsonRpcRequest(method: string, params?: unknown, id: number = 1): string {
  const request: Record<string, unknown> = {
    jsonrpc: '2.0',
    method,
    id,
  };

  if (params !== undefined) {
    request.params = params;
  }

  return JSON.stringify(request);
}

/**
 * Handle JSON-RPC call - send a method call and return the response.
 */
export async function handleJsonRpcCall(request: Request): Promise<Response> {
  try {
    const body = await request.json() as JsonRpcWorkerRequest;
    const {
      host,
      port = 8545,
      path = '/',
      method,
      params,
      username,
      password,
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

    if (!method) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Method is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const authHeader = buildAuthHeader(username, password);
    const rpcBody = buildJsonRpcRequest(method, params);

    const start = Date.now();

    const result = await sendHttpPost(
      host,
      port,
      normalizedPath,
      rpcBody,
      authHeader,
      timeout,
    );

    const latencyMs = Date.now() - start;

    let parsed;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      parsed = null;
    }

    const response: JsonRpcResponse = {
      success: result.statusCode >= 200 && result.statusCode < 400,
      statusCode: result.statusCode,
      jsonrpc: parsed,
      latencyMs,
    };

    // Check for JSON-RPC level errors
    if (parsed?.error) {
      response.error = `JSON-RPC Error ${parsed.error.code}: ${parsed.error.message}`;
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'JSON-RPC call failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle JSON-RPC batch call - send multiple method calls at once.
 */
export async function handleJsonRpcBatch(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      path?: string;
      calls: Array<{ method: string; params?: unknown }>;
      username?: string;
      password?: string;
      timeout?: number;
    };

    const {
      host,
      port = 8545,
      path = '/',
      calls,
      username,
      password,
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

    if (!calls || !Array.isArray(calls) || calls.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'At least one call is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const authHeader = buildAuthHeader(username, password);

    // Build batch request
    const batchRequest = calls.map((call, idx) => ({
      jsonrpc: '2.0' as const,
      method: call.method,
      params: call.params,
      id: idx + 1,
    }));

    const start = Date.now();

    const result = await sendHttpPost(
      host,
      port,
      normalizedPath,
      JSON.stringify(batchRequest),
      authHeader,
      timeout,
    );

    const latencyMs = Date.now() - start;

    let parsed;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      parsed = null;
    }

    return new Response(JSON.stringify({
      success: result.statusCode >= 200 && result.statusCode < 400,
      statusCode: result.statusCode,
      responses: parsed,
      latencyMs,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Batch call failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Send a JSON-RPC 2.0 call over WebSocket transport.
 *
 * Used by Ethereum (port 8545), Bitcoin (port 8332), and other blockchain/RPC
 * nodes that prefer WebSocket connections over HTTP.
 *
 * WebSocket upgrade: HTTP/1.1 101 + Sec-WebSocket-Key SHA-1 handshake.
 * Messages are WebSocket text frames (opcode 0x1), client frames are masked.
 *
 * Body: { host, port?, path?, method, params?, username?, password?, timeout? }
 */
export async function handleJsonRpcWs(request: Request): Promise<Response> {
  try {
    const body = await request.json() as JsonRpcWorkerRequest;
    const {
      host,
      port = 8546,    // default WebSocket port for Ethereum
      path = '/',
      method,
      params,
      username,
      password,
      timeout = 15000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!method) {
      return new Response(JSON.stringify({ success: false, error: 'method is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    const socket = connect(`${host}:${port}`);
    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // Generate WebSocket key
    const keyBytes = new Uint8Array(16);
    crypto.getRandomValues(keyBytes);
    const wsKey = btoa(String.fromCharCode(...keyBytes));

    // Build WebSocket upgrade request
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    let upgradeReq = `GET ${normalizedPath} HTTP/1.1\r\n`;
    upgradeReq += `Host: ${host}:${port}\r\n`;
    upgradeReq += `Upgrade: websocket\r\n`;
    upgradeReq += `Connection: Upgrade\r\n`;
    upgradeReq += `Sec-WebSocket-Key: ${wsKey}\r\n`;
    upgradeReq += `Sec-WebSocket-Version: 13\r\n`;
    if (username && password) {
      upgradeReq += `Authorization: ${buildAuthHeader(username, password)}\r\n`;
    }
    upgradeReq += `\r\n`;

    await writer.write(encoder.encode(upgradeReq));

    // Read upgrade response
    let upgradeResp = '';
    while (!upgradeResp.includes('\r\n\r\n')) {
      const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
      if (done || !value) break;
      upgradeResp += decoder.decode(value, { stream: true });
    }

    if (!upgradeResp.includes('101')) {
      writer.releaseLock();
      reader.releaseLock();
      socket.close();
      return new Response(JSON.stringify({
        success: false,
        error: `WebSocket upgrade failed: ${upgradeResp.split('\r\n')[0]}`,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Build JSON-RPC payload
    const rpcRequest = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const msgBytes = encoder.encode(rpcRequest);

    // Encode as masked WebSocket text frame
    const mask = new Uint8Array(4);
    crypto.getRandomValues(mask);
    const payloadLen = msgBytes.length;
    let headerLen = 2;
    if (payloadLen > 65535) headerLen += 8;
    else if (payloadLen > 125) headerLen += 2;
    const frame = new Uint8Array(headerLen + 4 + payloadLen);
    frame[0] = 0x81; // FIN + text opcode
    if (payloadLen > 65535) {
      frame[1] = 0x80 | 127;
      const dv = new DataView(frame.buffer, 2);
      dv.setBigUint64(0, BigInt(payloadLen), false);
    } else if (payloadLen > 125) {
      frame[1] = 0x80 | 126;
      frame[2] = (payloadLen >> 8) & 0xff;
      frame[3] = payloadLen & 0xff;
    } else {
      frame[1] = 0x80 | payloadLen;
    }
    frame.set(mask, headerLen);
    for (let i = 0; i < payloadLen; i++) {
      frame[headerLen + 4 + i] = msgBytes[i] ^ mask[i % 4];
    }

    const start = Date.now();
    await writer.write(frame);

    // Read WebSocket frames until we get a complete JSON response
    let responseText = '';
    const deadline = Date.now() + Math.min(timeout, 10000);
    while (Date.now() < deadline) {
      let chunk: Uint8Array | undefined;
      try {
        const { value, done } = await Promise.race([
          reader.read(),
          new Promise<{ value: undefined; done: true }>(resolve =>
            setTimeout(() => resolve({ value: undefined, done: true }), deadline - Date.now()),
          ),
        ]);
        if (done || !value) break;
        chunk = value;
      } catch { break; }

      if (!chunk || chunk.length < 2) continue;

      // Parse WebSocket frame header
      const opcode = chunk[0] & 0x0f;
      if (opcode === 0x8) break; // close frame
      const masked = (chunk[1] & 0x80) !== 0;
      let len = chunk[1] & 0x7f;
      let dataOffset = 2;
      if (len === 126) { len = (chunk[2] << 8) | chunk[3]; dataOffset = 4; }
      else if (len === 127) { dataOffset = 10; }
      if (masked) dataOffset += 4;

      const payload = chunk.slice(dataOffset, dataOffset + len);
      responseText += decoder.decode(payload);

      // Check if we have a complete JSON object
      try { JSON.parse(responseText); break; } catch { /* incomplete */ }
    }

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    const latencyMs = Date.now() - start;
    let parsed;
    try { parsed = JSON.parse(responseText); } catch { parsed = null; }

    return new Response(JSON.stringify({
      success: parsed !== null,
      transport: 'websocket',
      jsonrpc: parsed,
      rawResponse: parsed ? undefined : responseText.slice(0, 512),
      latencyMs,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'JSON-RPC WS failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
