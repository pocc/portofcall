/**
 * SSH Protocol Support for Cloudflare Workers
 * Uses WebSocket tunnel approach for SSH connections
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/**
 * Handle SSH connection via WebSocket tunnel
 *
 * This creates a WebSocket that tunnels raw TCP to an SSH server.
 * The browser-side SSH client handles the SSH protocol.
 */
export async function handleSSHConnect(request: Request): Promise<Response> {
  try {
    // Check for WebSocket upgrade
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      // If not WebSocket, try to handle as HTTP for testing
      const url = new URL(request.url);
      let host: string, port: number;

      if (request.method === 'POST') {
        const body = await request.json() as { host: string; port: number; username?: string; password?: string };
        ({ host, port } = body);
      } else {
        host = url.searchParams.get('host') || '';
        port = parseInt(url.searchParams.get('port') || '22');
      }

      if (!host) {
        return new Response(JSON.stringify({
          error: 'Missing required parameter: host',
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
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

      // Test connection
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      // Read SSH banner
      const reader = socket.readable.getReader();
      const { value } = await reader.read();
      const banner = new TextDecoder().decode(value);

      await socket.close();

      return new Response(JSON.stringify({
        success: true,
        message: 'SSH server reachable',
        banner: banner.trim(),
        note: 'Full SSH requires WebSocket connection. Use WebSocket upgrade for interactive sessions.',
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // WebSocket upgrade - create tunnel
    const url = new URL(request.url);
    const host = url.searchParams.get('host');
    const port = parseInt(url.searchParams.get('port') || '22');

    if (!host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if the target is behind Cloudflare
    const cfCheckWs = await checkIfCloudflare(host);
    if (cfCheckWs.isCloudflare && cfCheckWs.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheckWs.ip),
        isCloudflare: true,
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the WebSocket
    server.accept();

    // Connect to SSH server
    const socket = connect(`${host}:${port}`);
    await socket.opened;

    // Pipe data bidirectionally
    pipeWebSocketToSocket(server, socket);
    pipeSocketToWebSocket(socket, server);

    return new Response(null, {
      status: 101,
      webSocket: client,
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
 * Handle SSH command execution (simplified for testing)
 */
export async function handleSSHExecute(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({
    error: 'SSH command execution requires WebSocket tunnel',
    message: 'Use WebSocket connection for interactive SSH sessions. This endpoint is for testing connectivity only.',
  }), {
    status: 501,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handle SSH disconnect
 */
export async function handleSSHDisconnect(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({
    success: true,
    message: 'Close WebSocket connection to disconnect SSH session',
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Pipe WebSocket messages to TCP socket
 */
function pipeWebSocketToSocket(ws: WebSocket, socket: Socket): void {
  const writer = socket.writable.getWriter();

  ws.addEventListener('message', async (event) => {
    try {
      if (typeof event.data === 'string') {
        await writer.write(new TextEncoder().encode(event.data));
      } else if (event.data instanceof ArrayBuffer) {
        await writer.write(new Uint8Array(event.data));
      }
    } catch (error) {
      console.error('Error writing to socket:', error);
      ws.close();
    }
  });

  ws.addEventListener('close', () => {
    writer.close().catch(() => {});
  });
}

/**
 * Pipe TCP socket data to WebSocket
 */
async function pipeSocketToWebSocket(socket: Socket, ws: WebSocket): Promise<void> {
  const reader = socket.readable.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        ws.close();
        break;
      }

      ws.send(value);
    }
  } catch (error) {
    console.error('Error reading from socket:', error);
    ws.close();
  }
}
