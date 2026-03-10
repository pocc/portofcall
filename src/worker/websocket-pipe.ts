/**
 * WebSocket ↔ TCP pipe utilities.
 *
 * handleTcpPing        — TCP handshake latency check (not ICMP)
 * handleSocketConnection — WebSocket-to-TCP tunnel for SSH and other protocols
 * pipeWebSocketToSocket — WS→TCP with serialized writes and backpressure
 * pipeSocketToWebSocket — TCP→WS with backpressure and message chunking
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/**
 * TCP Ping Handler
 *
 * Performs a "TCP ping" by opening a connection and measuring round-trip time.
 * Note: This is NOT an ICMP ping - it's a TCP handshake check.
 */
export async function handleTcpPing(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let socket: ReturnType<typeof connect> | null = null;

  try {
    const { host, port, timeout: rawTimeout = 10000 } = await request.json<{ host: string; port: number; timeout?: number }>();
    const timeout = Math.min(Math.max(rawTimeout, 1000), 30000); // Cap between 1s and 30s

    if (!host || !port) {
      return new Response('Missing host or port', { status: 400 });
    }

    if (typeof port !== 'number' || isNaN(port) || port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if the target is behind Cloudflare
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

    const start = performance.now();
    socket = connect(`${host}:${port}`);
    let timeoutHandle: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`Connection timeout after ${timeout}ms`)), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);
    } finally {
      clearTimeout(timeoutHandle!);
    }
    const rtt = Math.round((performance.now() - start) * 100) / 100;

    await socket.close();
    socket = null;

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      message: `TCP Ping Success: ${rtt}ms`,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'TCP Ping Failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    if (socket) {
      await socket.close().catch(() => {});
    }
  }
}

/**
 * Socket Connection Handler
 *
 * Establishes a WebSocket tunnel to a TCP socket.
 * This enables browser-based SSH and other TCP protocol access.
 *
 * IMPORTANT: The pipe functions are fire-and-forget — they must NOT be awaited
 * before returning the 101 response, or the WebSocket upgrade deadlocks.
 */
export async function handleSocketConnection(request: Request): Promise<Response> {
  // Check if this is a WebSocket upgrade request (case-insensitive per RFC 6455)
  const upgradeHeader = request.headers.get('Upgrade');
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  try {
    // Parse host/port from query params (WebSocket upgrades cannot have a JSON body)
    const url = new URL(request.url);
    const host = url.searchParams.get('host');
    const portStr = url.searchParams.get('port');
    const port = portStr ? Number(portStr) : NaN;

    if (!host || !portStr) {
      return new Response('Missing host or port', { status: 400 });
    }

    if (isNaN(port) || port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the WebSocket connection
    server.accept();

    // Connect to TCP socket (with timeout to avoid blocking the 101 upgrade)
    const socket = connect(`${host}:${port}`);
    let openTimeoutHandle: ReturnType<typeof setTimeout>;
    const openTimeout = new Promise<never>((_, reject) => {
      openTimeoutHandle = setTimeout(() => reject(new Error('TCP connect timeout')), 10000);
    });
    try {
      await Promise.race([socket.opened, openTimeout]);
    } finally {
      clearTimeout(openTimeoutHandle!);
    }

    // Start piping — fire-and-forget, do NOT await before returning 101
    pipeWebSocketToSocket(server, socket);
    pipeSocketToWebSocket(socket, server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Pipe data from WebSocket to TCP socket.
 *
 * Registers event listeners (returns synchronously). Handles cleanup of
 * the writer lock and TCP socket on close or error.
 *
 * Writes are serialized via a promise chain to guarantee ordering even
 * if multiple message events fire before a slow writer.write() resolves.
 */
function pipeWebSocketToSocket(ws: WebSocket, socket: Socket): void {
  const writer = socket.writable.getWriter();
  let writeChain = Promise.resolve();
  let queuedBytes = 0;
  const INBOUND_HIGH_WATER_MARK = 4 * 1024 * 1024; // 4 MiB

  const encoder = new TextEncoder();
  ws.addEventListener('message', (event) => {
    // Encode text once and reuse the buffer for both size tracking and writing
    const encoded = typeof event.data === 'string'
      ? encoder.encode(event.data)
      : new Uint8Array(event.data as ArrayBuffer);
    const size = encoded.byteLength;
    queuedBytes += size;

    // Backpressure: if the write queue is too deep, close the connection
    if (queuedBytes > INBOUND_HIGH_WATER_MARK) {
      try { ws.close(1013, 'Write queue backpressure exceeded'); } catch { /* already closed */ }
      writer.close().catch(() => {}).finally(() => {
        try { writer.releaseLock(); } catch { /* already released */ }
      });
      socket.close().catch(() => {});
      return;
    }

    writeChain = writeChain.then(async () => {
      try {
        await writer.write(encoded);
        queuedBytes -= size;
      } catch {
        try { writer.releaseLock(); } catch { /* already released */ }
        try { await socket.close(); } catch { /* already closed */ }
        try { ws.close(); } catch { /* already closed */ }
      }
    });
  });

  ws.addEventListener('close', () => {
    const cleanup = () => {
      writer.close().catch(() => {}).finally(() => {
        try { writer.releaseLock(); } catch { /* already released */ }
      });
      socket.close().catch(() => {});
    };
    writeChain.then(cleanup, cleanup);
  });

  ws.addEventListener('error', () => {
    writer.close().catch(() => {}).finally(() => {
      try { writer.releaseLock(); } catch { /* already released */ }
    });
    socket.close().catch(() => {});
  });
}

/**
 * Pipe data from TCP socket to WebSocket.
 *
 * Runs a reader loop (async, fire-and-forget). Releases the reader lock
 * and closes both sides in all exit paths via finally.
 *
 * Backpressure: pauses TCP reads when the WebSocket send buffer exceeds
 * HIGH_WATER_MARK, preventing OOM on slow clients with fast backends.
 *
 * Chunking: splits payloads exceeding the 1 MiB WebSocket message limit
 * to avoid RangeError on ws.send().
 */
async function pipeSocketToWebSocket(socket: Socket, ws: WebSocket): Promise<void> {
  const reader = socket.readable.getReader();
  const HIGH_WATER_MARK = 1024 * 1024; // 1 MiB
  const WS_MAX_MESSAGE = 1024 * 1024; // 1 MiB
  const DRAIN_INTERVAL_MS = 50;

  try {
    while (true) {
      // Backpressure: pause reading if WebSocket send buffer is full
      while (ws.bufferedAmount > HIGH_WATER_MARK) {
        // Break out if WebSocket is closed — buffer will never drain
        if (ws.readyState >= 2) break; // CLOSING or CLOSED
        await new Promise((r) => setTimeout(r, DRAIN_INTERVAL_MS));
      }
      if (ws.readyState >= 2) break;

      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      // Chunk oversized payloads to stay within WebSocket message limit
      if (value.length > WS_MAX_MESSAGE) {
        for (let i = 0; i < value.length; i += WS_MAX_MESSAGE) {
          ws.send(value.subarray(i, Math.min(i + WS_MAX_MESSAGE, value.length)));
        }
      } else {
        ws.send(value);
      }
    }
  } catch {
    // Socket read error or WebSocket send error — fall through to cleanup
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
    try { ws.close(); } catch { /* already closed */ }
    try { await socket.close(); } catch { /* already closed */ }
  }
}
