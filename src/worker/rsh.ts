/**
 * RSH Protocol Implementation (Port 514/TCP)
 *
 * BSD Remote Shell — executes a single command on a remote host using
 * .rhosts trust rather than password authentication (unlike Rexec which
 * uses passwords). Part of the BSD r-commands family alongside Rlogin (513)
 * and Rexec (512).
 *
 * Protocol Flow (RFC 1282):
 * 1. Client connects to server port 514/tcp
 * 2. Client sends: stderrPort\0  (ASCII decimal stderr port, or \0 for none)
 * 3. Client sends: localUser\0   (client-side username)
 * 4. Client sends: remoteUser\0  (server-side username to run as)
 * 5. Client sends: command\0     (shell command to execute)
 * 6. Server responds with \0 (accepted) or error text
 * 7. Command stdout streams on primary connection
 * 8. Command stderr streams on secondary connection (if stderrPort given)
 *
 * Note: Traditionally RSH requires the client to connect from a privileged
 * source port (< 1024). Cloudflare Workers cannot bind privileged ports, so
 * many strict RSH servers will reject the connection with "permission denied".
 * This is expected behaviour and correctly detected.
 *
 * Security: NONE — relies entirely on .rhosts trust. No encryption.
 * Superseded by SSH (RFC 4251+).
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface RshRequest {
  host: string;
  port?: number;
  localUser?: string;
  remoteUser?: string;
  command?: string;
  timeout?: number;
}

/**
 * Handle RSH command execution probe
 * Performs the RSH handshake, optionally executes a command, and returns output
 */
export async function handleRshExecute(request: Request): Promise<Response> {
  try {
    let options: Partial<RshRequest>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<RshRequest>;
    } else {
      const url = new URL(request.url);
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '514'),
        localUser: url.searchParams.get('localUser') || 'guest',
        remoteUser: url.searchParams.get('remoteUser') || 'guest',
        command: url.searchParams.get('command') || '',
        timeout: parseInt(url.searchParams.get('timeout') || '10000'),
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
    const port = options.port || 514;
    const localUser = options.localUser || 'guest';
    const remoteUser = options.remoteUser || 'guest';
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
        // Workers cannot listen for incoming connections, so always send \0
        await writer.write(encoder.encode('\0'));

        // Step 2: Send localUser\0 (the client-side username)
        await writer.write(encoder.encode(`${localUser}\0`));

        // Step 3: Send remoteUser\0 (the server-side username to run as)
        await writer.write(encoder.encode(`${remoteUser}\0`));

        // Step 4: Send command\0
        await writer.write(encoder.encode(`${command}\0`));

        // Step 5: Read server response
        const readTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('RSH handshake timeout')), 5000)
        );

        const { value, done } = await Promise.race([reader.read(), readTimeout]);
        const rtt = Date.now() - startTime;

        if (done || !value) {
          throw new Error('Connection closed before server response');
        }

        // First byte: \0 = success, anything else = error message
        const firstByte = value[0];
        const responseText = decoder.decode(value);
        let serverAccepted = false;
        let serverMessage = '';
        let output = '';
        let privilegedPortRejection = false;

        if (firstByte === 0) {
          serverAccepted = true;
          // Remaining bytes after \0 may be initial command output
          output = responseText.substring(1);
        } else {
          serverAccepted = false;
          serverMessage = responseText.trim();
          // Many servers reject non-privileged source ports with this message
          if (serverMessage.toLowerCase().includes('permission') ||
              serverMessage.toLowerCase().includes('privileged') ||
              serverMessage.toLowerCase().includes('reserved') ||
              serverMessage.toLowerCase().includes('not superuser')) {
            privilegedPortRejection = true;
          }
        }

        // Read remaining output if command was accepted
        if (serverAccepted) {
          try {
            const outputTimeout = new Promise<{ value: undefined; done: true }>((resolve) =>
              setTimeout(() => resolve({ value: undefined, done: true }), 2000)
            );

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
          protocol: 'RSH',
          rtt,
          serverAccepted,
          localUser,
          remoteUser,
          command,
          output: output.trim() || undefined,
          serverMessage: serverMessage || undefined,
          privilegedPortRejection,
          note: privilegedPortRejection
            ? 'RSH server rejected the connection because it originated from an unprivileged port (> 1023). This is expected — Cloudflare Workers cannot bind privileged source ports. The server is active and running RSH.'
            : 'RSH (port 514) uses .rhosts trust for authentication — no password is sent. The server checks /etc/hosts.equiv and ~/.rhosts to decide if the client host/user is trusted.',
          security: 'NONE — RSH relies on .rhosts trust with no encryption. Use SSH instead.',
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
 * Open a persistent WebSocket tunnel for RSH sessions
 * Performs the RSH handshake, then pipes command output to the WebSocket
 */
export async function handleRshWebSocket(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const host = url.searchParams.get('host');
    const port = parseInt(url.searchParams.get('port') || '514');
    const localUser = url.searchParams.get('localUser') || 'guest';
    const remoteUser = url.searchParams.get('remoteUser') || 'guest';
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

        // Perform RSH handshake
        await writer.write(encoder.encode('\0'));
        await writer.write(encoder.encode(`${localUser}\0`));
        await writer.write(encoder.encode(`${remoteUser}\0`));
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
        console.error('RSH WebSocket tunnel error:', error);
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
