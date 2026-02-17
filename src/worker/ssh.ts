/**
 * SSH Protocol Support for Cloudflare Workers
 * Uses WebSocket tunnel approach for SSH connections
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';
export { handleSSHTerminal } from './ssh2-impl';

/**
 * SSH Authentication Methods
 */
export type SSHAuthMethod = 'password' | 'publickey' | 'keyboard-interactive' | 'hostbased';

/**
 * SSH Connection Options
 *
 * Note: Port of Call provides TCP tunneling. The actual SSH protocol negotiation
 * and authentication happens browser-side. These options are metadata that can
 * be used by browser-side SSH clients (like xterm.js + ssh2).
 */
export interface SSHConnectionOptions {
  // Required
  host: string;
  port?: number;

  // Authentication
  username?: string;
  password?: string;
  privateKey?: string;        // PEM-encoded private key
  passphrase?: string;        // Passphrase for encrypted private key
  authMethod?: SSHAuthMethod; // Preferred auth method

  // Connection options
  timeout?: number;           // Connection timeout in ms (default: 30000)
  keepaliveInterval?: number; // Keepalive interval in ms (default: 0 = disabled)
  readyTimeout?: number;      // Time to wait for handshake in ms (default: 20000)

  // Security options
  hostHash?: 'md5' | 'sha1' | 'sha256'; // Host key hash algorithm
  algorithms?: {
    kex?: string[];           // Key exchange algorithms
    cipher?: string[];        // Cipher algorithms
    serverHostKey?: string[]; // Server host key algorithms
    hmac?: string[];          // MAC algorithms
    compress?: string[];      // Compression algorithms
  };

  // Advanced options
  strictHostKeyChecking?: boolean; // Verify host key (default: false for web clients)
  debug?: boolean;                 // Enable debug output
}

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
      // HTTP mode: Test connectivity and return SSH banner
      const url = new URL(request.url);
      let options: Partial<SSHConnectionOptions>;

      if (request.method === 'POST') {
        options = await request.json() as Partial<SSHConnectionOptions>;
      } else {
        options = {
          host: url.searchParams.get('host') || '',
          port: parseInt(url.searchParams.get('port') || '22'),
          username: url.searchParams.get('username') || undefined,
        };
      }

      // Validate required fields
      if (!options.host) {
        return new Response(JSON.stringify({
          error: 'Missing required parameter: host',
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const host = options.host;
      const port = options.port || 22;

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
        host,
        port,
        banner: banner.trim(),
        connectionOptions: {
          username: options.username,
          authMethod: options.authMethod || 'password',
          hasPrivateKey: !!options.privateKey,
          hasPassword: !!options.password,
        },
        note: 'This is a connectivity test only. For full SSH authentication (password/privateKey), use WebSocket upgrade.',
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // WebSocket upgrade - create tunnel with SSH options
    const url = new URL(request.url);

    // Parse SSH connection options from query parameters
    const options: SSHConnectionOptions = {
      host: url.searchParams.get('host') || '',
      port: parseInt(url.searchParams.get('port') || '22'),
      username: url.searchParams.get('username') || undefined,
      password: url.searchParams.get('password') || undefined,
      privateKey: url.searchParams.get('privateKey') || undefined,
      passphrase: url.searchParams.get('passphrase') || undefined,
      authMethod: (url.searchParams.get('authMethod') as SSHAuthMethod) || undefined,
      timeout: parseInt(url.searchParams.get('timeout') || '30000'),
      keepaliveInterval: parseInt(url.searchParams.get('keepaliveInterval') || '0'),
      readyTimeout: parseInt(url.searchParams.get('readyTimeout') || '20000'),
      strictHostKeyChecking: url.searchParams.get('strictHostKeyChecking') === 'true',
      debug: url.searchParams.get('debug') === 'true',
    };

    if (!options.host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if the target is behind Cloudflare
    const cfCheckWs = await checkIfCloudflare(options.host);
    if (cfCheckWs.isCloudflare && cfCheckWs.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(options.host, cfCheckWs.ip),
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
    const socket = connect(`${options.host}:${options.port}`);
    await socket.opened;

    // Send SSH connection options to browser client as first message
    // The browser-side SSH client (e.g., xterm.js + ssh2) will use these for authentication
    server.send(JSON.stringify({
      type: 'ssh-options',
      options: {
        host: options.host,
        port: options.port,
        username: options.username,
        password: options.password,
        privateKey: options.privateKey,
        passphrase: options.passphrase,
        authMethod: options.authMethod,
        timeout: options.timeout,
        keepaliveInterval: options.keepaliveInterval,
        readyTimeout: options.readyTimeout,
        algorithms: options.algorithms,
        strictHostKeyChecking: options.strictHostKeyChecking,
        debug: options.debug,
      },
    }));

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
