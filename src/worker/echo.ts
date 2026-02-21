/**
 * ECHO Protocol Implementation (RFC 862)
 *
 * The ECHO service simply echoes back any data it receives.
 * This is the simplest TCP protocol, primarily used for network testing.
 *
 * Protocol Flow:
 * 1. Client connects to server port 7
 * 2. Client sends arbitrary data
 * 3. Server echoes the exact same data back
 * 4. Connection can remain open for multiple exchanges
 *
 * Use Cases:
 * - Network connectivity testing
 * - Latency measurement
 * - Firewall/routing verification
 * - Protocol implementation testing
 */

import { connect } from 'cloudflare:sockets';

interface EchoRequest {
  host: string;
  port: number;
  message: string;
  timeout?: number;
}

interface EchoResponse {
  success: boolean;
  sent: string;
  received: string;
  match: boolean;
  rtt: number;
  error?: string;
}

/**
 * Test ECHO protocol connectivity
 * Sends a message and verifies it's echoed back correctly
 */
export async function handleEchoTest(request: Request): Promise<Response> {
  try {
    const body = await request.json() as EchoRequest;
    const { host, port = 7, message, timeout = 10000 } = body;

    // Validation
    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!message || message.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Message is required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Start timer for RTT measurement
    const startTime = Date.now();

    // Connect to ECHO server
    const socket = connect(`${host}:${port}`);

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      // Wait for connection with timeout
      await Promise.race([
        socket.opened,
        timeoutPromise
      ]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send message
      const messageBytes = new TextEncoder().encode(message);
      await writer.write(messageBytes);

      // Read response
      const { value: responseBytes } = await Promise.race([
        reader.read(),
        timeoutPromise
      ]);

      if (!responseBytes) {
        throw new Error('No response received from server');
      }

      // Decode response
      const receivedMessage = new TextDecoder().decode(responseBytes);
      const rtt = Date.now() - startTime;

      // Clean up
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      // Verify echo
      const match = message === receivedMessage;

      const response: EchoResponse = {
        success: true,
        sent: message,
        received: receivedMessage,
        match: match,
        rtt: rtt,
      };

      if (!match) {
        response.error = `Echo mismatch: sent "${message}" but received "${receivedMessage}"`;
      }

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      // Connection or read error
      socket.close();
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      sent: '',
      received: '',
      match: false,
      rtt: 0
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Open a persistent WebSocket tunnel for interactive ECHO sessions
 * Useful for testing multiple messages without reconnecting
 */
export async function handleEchoWebSocket(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const host = url.searchParams.get('host');
    const port = parseInt(url.searchParams.get('port') || '7', 10);

    if (!host) {
      return new Response('Host parameter required', { status: 400 });
    }

    // Upgrade to WebSocket
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // Accept the WebSocket connection
    server.accept();

    // Connect to ECHO server
    const socket = connect(`${host}:${port}`);

    // Set up bidirectional forwarding
    (async () => {
      try {
        await socket.opened;

        const writer = socket.writable.getWriter();
        const reader = socket.readable.getReader();

        // Forward WebSocket → TCP
        server.addEventListener('message', async (event) => {
          if (typeof event.data === 'string') {
            await writer.write(new TextEncoder().encode(event.data));
          } else if (event.data instanceof ArrayBuffer) {
            await writer.write(new Uint8Array(event.data));
          }
        });

        // Forward TCP → WebSocket
        (async () => {
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              server.send(new TextDecoder().decode(value));
            }
          } catch (error) {
            console.error('Error reading from TCP socket:', error);
          } finally {
            server.close();
          }
        })();

        // Handle WebSocket close
        server.addEventListener('close', () => {
          writer.releaseLock();
          reader.releaseLock();
          socket.close();
        });

      } catch (error) {
        console.error('WebSocket tunnel error:', error);
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
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
