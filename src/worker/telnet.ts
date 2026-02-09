/**
 * Telnet Protocol Support for Cloudflare Workers
 * Simple text-based terminal protocol
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

export interface TelnetConnectionOptions {
  host: string;
  port?: number;
  timeout?: number;
}

// Telnet IAC (Interpret As Command) constants
const IAC = 255;  // Interpret as command
const DONT = 254; // Don't perform option
const DO = 253;   // Perform option
const WONT = 252; // Won't perform option
const WILL = 251; // Will perform option
const SB = 250;   // Subnegotiation begin
const SE = 240;   // Subnegotiation end

// Telnet options (reserved for future IAC negotiation)
// const ECHO = 1;
// const SUPPRESS_GO_AHEAD = 3;
// const TERMINAL_TYPE = 24;
// const WINDOW_SIZE = 31;
// const TERMINAL_SPEED = 32;
// const NEW_ENVIRON = 39;

/**
 * Handle Telnet connection test (HTTP mode)
 */
export async function handleTelnetConnect(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let options: Partial<TelnetConnectionOptions>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<TelnetConnectionOptions>;
    } else {
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '23'),
        timeout: parseInt(url.searchParams.get('timeout') || '30000'),
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
    const port = options.port || 23;

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

    // Set timeout for entire connection attempt
    const timeoutMs = options.timeout || 30000;

    // Wrap entire connection in timeout
    const connectionPromise = (async () => {
      // Test connection
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      // Read initial banner/prompt
      const reader = socket.readable.getReader();
      const readPromise = reader.read();
      const readTimeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Read timeout')), 5000) // 5s for banner
      );

      try {
        const { value } = await Promise.race([readPromise, readTimeoutPromise]);
        const banner = value ? new TextDecoder().decode(value) : '';

        await socket.close();

        return {
          success: true,
          message: 'Telnet server reachable',
          host,
          port,
          banner: banner.trim(),
          note: 'This is a connectivity test. For interactive sessions, use WebSocket mode.',
        };
      } catch (error) {
        await socket.close();

        // If read timeout, server is reachable but not responding
        return {
          success: true,
          message: 'Telnet server reachable (no banner)',
          host,
          port,
          banner: '',
          note: 'Server connected but did not send initial banner.',
        };
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (timeoutError) {
      // Connection timed out
      return new Response(JSON.stringify({
        success: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'Connection timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
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
 * Handle Telnet WebSocket connection (interactive mode)
 */
export async function handleTelnetWebSocket(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);

    const host = url.searchParams.get('host');
    const port = parseInt(url.searchParams.get('port') || '23');

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

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the WebSocket
    server.accept();

    // Connect to Telnet server
    const socket = connect(`${host}:${port}`);
    await socket.opened;

    // Send connection info to client
    server.send(JSON.stringify({
      type: 'telnet-connected',
      host,
      port,
      message: 'Connected to Telnet server',
    }));

    // Pipe data bidirectionally with Telnet protocol handling
    pipeWebSocketToTelnet(server, socket);
    pipeTelnetToWebSocket(socket, server);

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
 * Pipe WebSocket messages to Telnet server
 */
function pipeWebSocketToTelnet(ws: WebSocket, socket: Socket): void {
  const writer = socket.writable.getWriter();

  ws.addEventListener('message', async (event) => {
    try {
      if (typeof event.data === 'string') {
        await writer.write(new TextEncoder().encode(event.data));
      } else if (event.data instanceof ArrayBuffer) {
        await writer.write(new Uint8Array(event.data));
      }
    } catch (error) {
      console.error('Error writing to Telnet socket:', error);
      ws.close();
    }
  });

  ws.addEventListener('close', () => {
    writer.close().catch(() => {});
  });
}

/**
 * Pipe Telnet server data to WebSocket
 * Handles Telnet IAC commands transparently
 */
async function pipeTelnetToWebSocket(socket: Socket, ws: WebSocket): Promise<void> {
  const reader = socket.readable.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        ws.close();
        break;
      }

      // For now, pass data through as-is
      // Could add IAC command parsing here if needed
      ws.send(value);
    }
  } catch (error) {
    console.error('Error reading from Telnet socket:', error);
    ws.close();
  }
}

/**
 * Parse Telnet IAC commands from buffer
 * Returns { data: cleaned data, commands: IAC commands }
 */
export function parseTelnetIAC(buffer: Uint8Array): { data: Uint8Array; commands: number[][] } {
  const commands: number[][] = [];
  const cleaned: number[] = [];

  let i = 0;
  while (i < buffer.length) {
    if (buffer[i] === IAC) {
      // IAC command sequence
      const command: number[] = [IAC];
      i++;

      if (i >= buffer.length) break;

      const cmd = buffer[i];
      command.push(cmd);
      i++;

      // Commands that take an option byte
      if (cmd === DO || cmd === DONT || cmd === WILL || cmd === WONT) {
        if (i < buffer.length) {
          command.push(buffer[i]);
          i++;
        }
      } else if (cmd === SB) {
        // Subnegotiation - read until SE
        while (i < buffer.length) {
          command.push(buffer[i]);
          if (buffer[i] === IAC && i + 1 < buffer.length && buffer[i + 1] === SE) {
            command.push(buffer[i + 1]);
            i += 2;
            break;
          }
          i++;
        }
      }

      commands.push(command);
    } else {
      // Regular data
      cleaned.push(buffer[i]);
      i++;
    }
  }

  return {
    data: new Uint8Array(cleaned),
    commands,
  };
}
