/**
 * SFTP Protocol Support for Cloudflare Workers
 * Secure File Transfer over SSH subsystem
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/**
 * SFTP File Information
 */
export interface SFTPFileInfo {
  name: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  modifyTime: number;
  accessTime: number;
  permissions: number;
  uid: number;
  gid: number;
}

/**
 * SFTP Connection Options
 */
export interface SFTPConnectionOptions {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  timeout?: number;
}

/**
 * SFTP Request Types
 */
export enum SFTPRequestType {
  LIST = 'list',
  DOWNLOAD = 'download',
  UPLOAD = 'upload',
  DELETE = 'delete',
  MKDIR = 'mkdir',
  RMDIR = 'rmdir',
  RENAME = 'rename',
  STAT = 'stat',
}

/**
 * SFTP Protocol Packet Types (from draft-ietf-secsh-filexfer-02)
 */
export enum SFTPPacketType {
  SSH_FXP_INIT = 1,
  SSH_FXP_VERSION = 2,
  SSH_FXP_OPEN = 3,
  SSH_FXP_CLOSE = 4,
  SSH_FXP_READ = 5,
  SSH_FXP_WRITE = 6,
  SSH_FXP_LSTAT = 7,
  SSH_FXP_FSTAT = 8,
  SSH_FXP_SETSTAT = 9,
  SSH_FXP_FSETSTAT = 10,
  SSH_FXP_OPENDIR = 11,
  SSH_FXP_READDIR = 12,
  SSH_FXP_REMOVE = 13,
  SSH_FXP_MKDIR = 14,
  SSH_FXP_RMDIR = 15,
  SSH_FXP_REALPATH = 16,
  SSH_FXP_STAT = 17,
  SSH_FXP_RENAME = 18,
  SSH_FXP_READLINK = 19,
  SSH_FXP_SYMLINK = 20,
  SSH_FXP_STATUS = 101,
  SSH_FXP_HANDLE = 102,
  SSH_FXP_DATA = 103,
  SSH_FXP_NAME = 104,
  SSH_FXP_ATTRS = 105,
  SSH_FXP_EXTENDED = 200,
  SSH_FXP_EXTENDED_REPLY = 201,
}

/**
 * Handle SFTP connection test (HTTP mode)
 */
export async function handleSFTPConnect(request: Request): Promise<Response> {
  try {
    const upgradeHeader = request.headers.get('Upgrade');

    if (upgradeHeader !== 'websocket') {
      // HTTP mode: Test SSH connectivity
      let options: Partial<SFTPConnectionOptions>;

      if (request.method === 'POST') {
        options = await request.json() as Partial<SFTPConnectionOptions>;
      } else {
        const url = new URL(request.url);
        options = {
          host: url.searchParams.get('host') || '',
          port: parseInt(url.searchParams.get('port') || '22'),
          username: url.searchParams.get('username') || '',
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

      if (!options.username) {
        return new Response(JSON.stringify({
          error: 'Missing required parameter: username',
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

      // Test SSH connection (SFTP runs over SSH)
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      // Read SSH banner
      const reader = socket.readable.getReader();
      const { value } = await reader.read();
      const banner = new TextDecoder().decode(value);

      await socket.close();

      return new Response(JSON.stringify({
        success: true,
        message: 'SSH server reachable (SFTP requires WebSocket for file operations)',
        host,
        port,
        username: options.username,
        sshBanner: banner.trim(),
        note: 'SFTP subsystem available. Use WebSocket connection for file operations.',
        requiresAuth: true,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // WebSocket mode - Create SFTP tunnel
    return handleSFTPWebSocket(request);
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
 * Handle SFTP WebSocket tunnel
 * This creates a WebSocket that tunnels SFTP protocol over SSH
 */
async function handleSFTPWebSocket(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // Parse connection options
  const options: SFTPConnectionOptions = {
    host: url.searchParams.get('host') || '',
    port: parseInt(url.searchParams.get('port') || '22'),
    username: url.searchParams.get('username') || '',
    password: url.searchParams.get('password') || undefined,
    privateKey: url.searchParams.get('privateKey') || undefined,
    passphrase: url.searchParams.get('passphrase') || undefined,
    timeout: parseInt(url.searchParams.get('timeout') || '30000'),
  };

  if (!options.host || !options.username) {
    return new Response(JSON.stringify({
      error: 'Missing required parameters: host and username',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if the target is behind Cloudflare
  const cfCheck = await checkIfCloudflare(options.host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    return new Response(JSON.stringify({
      success: false,
      error: getCloudflareErrorMessage(options.host, cfCheck.ip),
      isCloudflare: true,
    }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create WebSocket pair
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();

  // Connect to SSH server
  const socket = connect(`${options.host}:${options.port}`);

  (async () => {
    try {
      await socket.opened;

      // Send connection options to client
      server.send(JSON.stringify({
        type: 'sftp-ready',
        options: {
          host: options.host,
          port: options.port,
          username: options.username,
          hasPassword: !!options.password,
          hasPrivateKey: !!options.privateKey,
        },
        note: 'SFTP subsystem ready. SSH authentication and SFTP protocol handling must be done client-side.',
      }));

      // Pipe data bidirectionally
      pipeWebSocketToSocket(server, socket);
      pipeSocketToWebSocket(socket, server);

    } catch (error) {
      server.send(JSON.stringify({
        type: 'error',
        error: error instanceof Error ? error.message : 'Connection failed',
      }));
      server.close();
    }
  })();

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

/**
 * Handle SFTP list directory (requires active SSH/SFTP connection)
 */
export async function handleSFTPList(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({
    error: 'SFTP list requires WebSocket tunnel',
    message: 'Use WebSocket connection with SFTP protocol for file operations.',
  }), {
    status: 501,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handle SFTP file download (requires active SSH/SFTP connection)
 */
export async function handleSFTPDownload(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({
    error: 'SFTP download requires WebSocket tunnel',
    message: 'Use WebSocket connection with SFTP protocol for file operations.',
  }), {
    status: 501,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handle SFTP file upload (requires active SSH/SFTP connection)
 */
export async function handleSFTPUpload(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({
    error: 'SFTP upload requires WebSocket tunnel',
    message: 'Use WebSocket connection with SFTP protocol for file operations.',
  }), {
    status: 501,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handle SFTP file delete (requires active SSH/SFTP connection)
 */
export async function handleSFTPDelete(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({
    error: 'SFTP delete requires WebSocket tunnel',
    message: 'Use WebSocket connection with SFTP protocol for file operations.',
  }), {
    status: 501,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handle SFTP mkdir (requires active SSH/SFTP connection)
 */
export async function handleSFTPMkdir(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({
    error: 'SFTP mkdir requires WebSocket tunnel',
    message: 'Use WebSocket connection with SFTP protocol for file operations.',
  }), {
    status: 501,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handle SFTP rename (requires active SSH/SFTP connection)
 */
export async function handleSFTPRename(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({
    error: 'SFTP rename requires WebSocket tunnel',
    message: 'Use WebSocket connection with SFTP protocol for file operations.',
  }), {
    status: 501,
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
        // Handle JSON commands from client
        const msg = JSON.parse(event.data);

        if (msg.type === 'sftp-data') {
          // Forward SFTP protocol data
          const data = new Uint8Array(msg.data);
          await writer.write(data);
        }
      } else if (event.data instanceof ArrayBuffer) {
        // Forward raw binary data (SFTP packets)
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

      // Forward SSH/SFTP protocol data to client
      ws.send(value);
    }
  } catch (error) {
    console.error('Error reading from socket:', error);
    ws.close();
  }
}
