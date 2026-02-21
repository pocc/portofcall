/**
 * Rexec Protocol Implementation (Port 512)
 *
 * BSD Remote Execution — executes a single command on a remote host
 * with explicit username/password authentication (unlike Rlogin which
 * uses .rhosts trust). The companion to Rlogin (Port 513).
 *
 * Protocol Flow:
 * 1. Client connects to server port 512
 * 2. Client sends: stderrPort\0  (port for stderr, or \0 for none)
 * 3. Client sends: username\0
 * 4. Client sends: password\0
 * 5. Client sends: command\0
 * 6. Server responds with \0 (success) or \1 + error text
 * 7. Server sends command stdout on primary connection
 * 8. Server sends command stderr on secondary connection (if stderrPort given)
 *
 * Security: NONE — cleartext username/password. Superseded by SSH.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface RexecRequest {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  command?: string;
  timeout?: number;
}

/**
 * Handle Rexec connection probe or command execution
 * Performs the Rexec handshake, optionally executes a command, and returns output
 */
export async function handleRexecExecute(request: Request): Promise<Response> {
  try {
    let options: Partial<RexecRequest>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<RexecRequest>;
    } else {
      const url = new URL(request.url);
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '512', 10),
        username: url.searchParams.get('username') || 'guest',
        command: url.searchParams.get('command') || '',
        timeout: parseInt(url.searchParams.get('timeout') || '10000', 10),
      };
    }

    if (!options.host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 512;
    const username = options.username || 'guest';
    const password = options.password || '';
    const command = options.command || 'id';
    const timeoutMs = options.timeout || 10000;

    // Check Cloudflare
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

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      try {
        // Step 1: Send stderr port (empty = no separate stderr channel)
        // We send \0 meaning no stderr port (Workers can't listen for incoming connections)
        await writer.write(encoder.encode('\0'));

        // Step 2: Send username\0
        await writer.write(encoder.encode(`${username}\0`));

        // Step 3: Send password\0
        await writer.write(encoder.encode(`${password}\0`));

        // Step 4: Send command\0
        await writer.write(encoder.encode(`${command}\0`));

        // Step 5: Read server response
        const readTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Rexec handshake timeout')), 5000)
        );

        const { value, done } = await Promise.race([reader.read(), readTimeout]);
        const rtt = Date.now() - startTime;

        if (done || !value) {
          throw new Error('Connection closed before server response');
        }

        // First byte: \0 = success, \1 = error (followed by error message)
        const firstByte = value[0];
        const responseText = decoder.decode(value);
        let serverAccepted = false;
        let serverMessage = '';
        let output = '';

        if (firstByte === 0) {
          serverAccepted = true;
          // Rest of the response is initial command output
          output = responseText.substring(1);
        } else if (firstByte === 1) {
          serverAccepted = false;
          serverMessage = responseText.substring(1).trim();
        } else {
          // Some servers send the error without the \1 prefix
          serverAccepted = false;
          serverMessage = responseText.trim();
        }

        // Read remaining output if command was accepted
        if (serverAccepted) {
          try {
            const outputTimeout = new Promise<{ value: undefined; done: true }>((resolve) =>
              setTimeout(() => resolve({ value: undefined, done: true }), 2000)
            );

            // Read up to a few chunks of output
            for (let i = 0; i < 10; i++) {
              const result = await Promise.race([reader.read(), outputTimeout]);
              if (result.done || !result.value) break;
              output += decoder.decode(result.value);
            }
          } catch {
            // No more data — that's fine
          }
        }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return {
          success: true,
          host,
          port,
          protocol: 'Rexec',
          rtt,
          serverAccepted,
          username,
          command,
          output: output.trim() || undefined,
          serverMessage: serverMessage || undefined,
          note: 'Rexec (port 512) is the BSD remote execution protocol. Unlike Rlogin (port 513) which uses .rhosts trust, Rexec requires explicit username/password authentication. Both transmit credentials in cleartext — use SSH instead for production systems.',
          security: 'NONE — Rexec transmits username and password in cleartext. Use SSH instead.',
        };
      } catch (error) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
        throw error;
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
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Connection timeout',
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
 * Open a persistent WebSocket tunnel for interactive Rexec sessions
 * Performs the Rexec handshake, then pipes command output to the WebSocket
 */
export async function handleRexecWebSocket(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const host = url.searchParams.get('host');
    const port = parseInt(url.searchParams.get('port') || '512', 10);
    const username = url.searchParams.get('username') || 'guest';
    const password = url.searchParams.get('password') || '';
    const command = url.searchParams.get('command') || 'id';

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
        const reader = socket.readable.getReader();
        const encoder = new TextEncoder();

        // Perform Rexec handshake
        await writer.write(encoder.encode('\0'));
        await writer.write(encoder.encode(`${username}\0`));
        await writer.write(encoder.encode(`${password}\0`));
        await writer.write(encoder.encode(`${command}\0`));

        // Forward TCP -> WebSocket (command output)
        (async () => {
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              server.send(value);
            }
          } catch {
            // Connection closed
          } finally {
            server.close();
          }
        })();

        // Forward WebSocket -> TCP (stdin to running command)
        server.addEventListener('message', async (event) => {
          if (typeof event.data === 'string') {
            await writer.write(encoder.encode(event.data));
          } else if (event.data instanceof ArrayBuffer) {
            await writer.write(new Uint8Array(event.data));
          }
        });

        server.addEventListener('close', () => {
          writer.releaseLock();
          reader.releaseLock();
          socket.close();
        });
      } catch (error) {
        console.error('Rexec WebSocket tunnel error:', error);
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
