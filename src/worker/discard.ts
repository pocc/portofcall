/**
 * DISCARD Protocol Implementation (RFC 863)
 *
 * The DISCARD service accepts connections, reads incoming data, and silently
 * discards everything. No response is ever sent back to the client.
 * It is the complement to ECHO (RFC 862).
 *
 * Protocol Flow:
 * 1. Client connects to server port 9
 * 2. Client sends arbitrary data
 * 3. Server reads and discards all data — sends nothing back
 * 4. Connection stays open until client closes it
 *
 * Use Cases:
 * - Bandwidth/throughput testing (measure send rate to a black hole)
 * - Connection verification (can I reach this host?)
 * - Firewall rule testing (is outbound port 9 open?)
 * - Load testing (stress-test a server's ability to accept data)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface DiscardRequest {
  host: string;
  port: number;
  message: string;
  repeatCount?: number;
  timeout?: number;
}

interface DiscardResponse {
  success: boolean;
  host: string;
  port: number;
  bytesSent: number;
  sendCount: number;
  elapsed: number;
  throughputBps: number;
  noResponse: boolean;
  error?: string;
}

/**
 * Test DISCARD protocol connectivity.
 * Sends data to a Discard server and verifies that no response comes back,
 * measuring throughput and connection health.
 */
export async function handleDiscardTest(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.json() as DiscardRequest;
    const { host, port = 9, message, repeatCount = 1, timeout = 10000 } = body;

    // Validation
    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!message || message.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Message is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const safeRepeat = Math.min(Math.max(1, repeatCount), 1000);

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

    // Connect
    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const messageBytes = new TextEncoder().encode(message);

      // Send data repeatedly
      let totalBytesSent = 0;
      for (let i = 0; i < safeRepeat; i++) {
        await writer.write(messageBytes);
        totalBytesSent += messageBytes.byteLength;
      }

      // After sending, briefly listen for a response (there should be none)
      const reader = socket.readable.getReader();
      let gotResponse = false;

      try {
        const readTimeout = new Promise<{ value: undefined; done: true }>((resolve) => {
          setTimeout(() => resolve({ value: undefined, done: true }), 500);
        });
        const readResult = await Promise.race([reader.read(), readTimeout]);
        if (!readResult.done && readResult.value && readResult.value.byteLength > 0) {
          gotResponse = true;
        }
      } catch {
        // Read error or timeout — expected for Discard
      }

      const elapsed = Date.now() - startTime;
      const throughputBps = elapsed > 0 ? Math.round((totalBytesSent * 1000) / elapsed) : 0;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const response: DiscardResponse = {
        success: true,
        host,
        port,
        bytesSent: totalBytesSent,
        sendCount: safeRepeat,
        elapsed,
        throughputBps,
        noResponse: !gotResponse,
      };

      if (gotResponse) {
        response.error = 'Warning: Server sent data back — this is not a compliant Discard server';
      }

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      bytesSent: 0,
      sendCount: 0,
      elapsed: 0,
      throughputBps: 0,
      noResponse: false,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Open a persistent WebSocket tunnel for interactive DISCARD sessions.
 * Data sent through the WebSocket is forwarded to the Discard server.
 * The server side of the WebSocket reports byte counts back to the client.
 */
export async function handleDiscardWebSocket(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const host = url.searchParams.get('host');
    const port = parseInt(url.searchParams.get('port') || '9');

    if (!host) {
      return new Response('Host parameter required', { status: 400 });
    }

    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    server.accept();

    const socket = connect(`${host}:${port}`);

    (async () => {
      try {
        await socket.opened;

        const writer = socket.writable.getWriter();
        let totalSent = 0;

        // Forward WebSocket -> TCP (discard server)
        server.addEventListener('message', async (event) => {
          let bytes: Uint8Array;
          if (typeof event.data === 'string') {
            bytes = new TextEncoder().encode(event.data);
          } else if (event.data instanceof ArrayBuffer) {
            bytes = new Uint8Array(event.data);
          } else {
            return;
          }
          await writer.write(bytes);
          totalSent += bytes.byteLength;
          // Report back to the browser how many bytes have been discarded
          server.send(JSON.stringify({ discarded: bytes.byteLength, totalSent }));
        });

        // Read from TCP (shouldn't get anything, but drain to avoid backpressure)
        const reader = socket.readable.getReader();
        (async () => {
          try {
            while (true) {
              const { done } = await reader.read();
              if (done) break;
            }
          } catch {
            // Expected — discard servers don't send data
          } finally {
            server.close();
          }
        })();

        server.addEventListener('close', () => {
          writer.releaseLock();
          reader.releaseLock();
          socket.close();
        });
      } catch (error) {
        console.error('Discard WebSocket tunnel error:', error);
        server.close();
        socket.close();
      }
    })();

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
