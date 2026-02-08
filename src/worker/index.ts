/**
 * Port of Call - Cloudflare Worker
 *
 * A worker that leverages Cloudflare's Sockets API (released May 16, 2023)
 * to enable browser-based access to TCP protocols like SSH.
 *
 * The name "Port of Call" is a nautical pun:
 * - Literal: You're calling a port (like 22 for SSH) from the browser
 * - Metaphorical: A transitional stop where data moves between worlds
 */

import { connect } from 'cloudflare:sockets';
import {
  handleFTPConnect,
  handleFTPList,
  handleFTPUpload,
  handleFTPDownload,
  handleFTPDelete,
  handleFTPMkdir,
  handleFTPRename,
} from './ftp';
import { handleSSHConnect, handleSSHExecute, handleSSHDisconnect } from './ssh';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

export interface Env {
  ENVIRONMENT: string;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // API endpoint for TCP ping
    if (url.pathname === '/api/ping') {
      return handleTcpPing(request);
    }

    // API endpoint for socket connections
    if (url.pathname === '/api/connect') {
      return handleSocketConnection(request);
    }

    // FTP API endpoints
    if (url.pathname === '/api/ftp/connect') {
      return handleFTPConnect(request);
    }

    if (url.pathname === '/api/ftp/list') {
      return handleFTPList(request);
    }

    if (url.pathname === '/api/ftp/upload') {
      return handleFTPUpload(request);
    }

    if (url.pathname === '/api/ftp/download') {
      return handleFTPDownload(request);
    }

    if (url.pathname === '/api/ftp/delete') {
      return handleFTPDelete(request);
    }

    if (url.pathname === '/api/ftp/mkdir') {
      return handleFTPMkdir(request);
    }

    if (url.pathname === '/api/ftp/rename') {
      return handleFTPRename(request);
    }

    // SSH API endpoints
    if (url.pathname === '/api/ssh/connect') {
      return handleSSHConnect(request);
    }

    if (url.pathname === '/api/ssh/execute') {
      return handleSSHExecute(request);
    }

    if (url.pathname === '/api/ssh/disconnect') {
      return handleSSHDisconnect(request);
    }

    // Serve static assets (built React app)
    return env.ASSETS.fetch(request);
  },
};

/**
 * TCP Ping Handler
 *
 * Performs a "TCP ping" by opening a connection and measuring round-trip time.
 * Note: This is NOT an ICMP ping - it's a TCP handshake check.
 */
async function handleTcpPing(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { host, port } = await request.json<{ host: string; port: number }>();

    if (!host || !port) {
      return new Response('Missing host or port', { status: 400 });
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

    const start = Date.now();
    const socket = connect(`${host}:${port}`);

    await socket.opened;
    const rtt = Date.now() - start;

    await socket.close();

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
  }
}

/**
 * Socket Connection Handler
 *
 * Establishes a WebSocket tunnel to a TCP socket.
 * This enables browser-based SSH and other TCP protocol access.
 */
async function handleSocketConnection(request: Request): Promise<Response> {
  // Check if this is a WebSocket upgrade request
  const upgradeHeader = request.headers.get('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  try {
    const { host, port } = await request.json<{ host: string; port: number }>();

    if (!host || !port) {
      return new Response('Missing host or port', { status: 400 });
    }

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the WebSocket connection
    server.accept();

    // Connect to TCP socket
    const socket = connect(`${host}:${port}`);

    // Pipe data between WebSocket and TCP socket
    await Promise.all([
      pipeWebSocketToSocket(server, socket),
      pipeSocketToWebSocket(socket, server),
    ]);

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
 * Pipe data from WebSocket to TCP socket
 */
async function pipeWebSocketToSocket(ws: WebSocket, socket: Socket): Promise<void> {
  const writer = socket.writable.getWriter();

  ws.addEventListener('message', async (event) => {
    if (typeof event.data === 'string') {
      await writer.write(new TextEncoder().encode(event.data));
    } else if (event.data instanceof ArrayBuffer) {
      await writer.write(new Uint8Array(event.data));
    }
  });

  ws.addEventListener('close', () => {
    writer.close();
  });
}

/**
 * Pipe data from TCP socket to WebSocket
 */
async function pipeSocketToWebSocket(socket: Socket, ws: WebSocket): Promise<void> {
  const reader = socket.readable.getReader();

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      ws.close();
      break;
    }

    ws.send(value);
  }
}
