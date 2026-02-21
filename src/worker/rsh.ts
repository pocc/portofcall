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
        port: parseInt(url.searchParams.get('port') || '514', 10),
        localUser: url.searchParams.get('localUser') || 'guest',
        remoteUser: url.searchParams.get('remoteUser') || 'guest',
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
 * Probe RSH port — test connectivity and read the server's initial response.
 * POST /api/rsh/probe
 * Body: { host, port?, localUser?, remoteUser?, timeout? }
 * Returns whether the port is open and whether it responds to the RSH handshake.
 */
export async function handleRshProbe(request: Request): Promise<Response> {
  try {
    const body = request.method === 'POST'
      ? await request.json() as Partial<RshRequest>
      : {} as Partial<RshRequest>;

    const host = body.host || new URL(request.url).searchParams.get('host') || '';
    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const port = body.port || 514;
    const localUser = body.localUser || 'probe';
    const remoteUser = body.remoteUser || 'probe';
    const timeoutMs = body.timeout || 8000;
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const start = Date.now();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    );

    try {
      const socket = connect(`${host}:${port}`);
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send minimal RSH handshake: stderrPort=0, localUser, remoteUser, empty command
      await writer.write(encoder.encode('\0'));
      await writer.write(encoder.encode(`${localUser}\0`));
      await writer.write(encoder.encode(`${remoteUser}\0`));
      await writer.write(encoder.encode('\0')); // empty command

      const latencyMs = Date.now() - start;

      // Read the server's initial byte (0x00 = accepted, else error text)
      let serverByte: number | null = null;
      let serverText = '';
      let privilegedPortRejection = false;

      try {
        const readTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('read_timeout')), 3000)
        );
        const result = await Promise.race([reader.read(), readTimeout]);
        if (!result.done && result.value && result.value.length > 0) {
          serverByte = result.value[0];
          serverText = decoder.decode(result.value).replace(/\0/g, '').trim();
          if (serverByte !== 0) {
            const lower = serverText.toLowerCase();
            privilegedPortRejection = lower.includes('permiss') || lower.includes('privileged')
              || lower.includes('reserved') || lower.includes('superuser');
          }
        }
      } catch {
        // No response is expected from many servers before command
      }

      reader.releaseLock();
      writer.releaseLock();
      socket.close();

      const accepted = serverByte === 0;
      return new Response(JSON.stringify({
        success: true,
        host, port,
        portOpen: true,
        accepted,
        serverByte,
        serverText: serverText || undefined,
        privilegedPortRejection,
        latencyMs,
        note: privilegedPortRejection
          ? 'RSH server rejected the unprivileged source port (>1023). This is expected in Workers. The server is running RSH.'
          : accepted
            ? 'RSH server accepted the handshake (null command, guest user).'
            : serverText
              ? `RSH server rejected with: "${serverText}"`
              : 'RSH port open. Server did not immediately respond to probe handshake.',
        security: 'RSH relies on .rhosts trust with no encryption. Use SSH instead.',
      }), { headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
      const latencyMs = Date.now() - start;
      return new Response(JSON.stringify({
        success: false,
        host, port,
        portOpen: false,
        latencyMs,
        error: err instanceof Error ? err.message : 'Connection failed',
      }), { headers: { 'Content-Type': 'application/json' } });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
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
    const port = parseInt(url.searchParams.get('port') || '514', 10);
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

/**
 * RSH trusted-user probe: test multiple localUser→remoteUser combinations
 * to discover which .rhosts trust relationships exist on the server.
 *
 * Each pair is tested concurrently via a fresh RSH connection. Pairs that
 * are accepted by the server confirm a .rhosts trust entry; the command
 * output (default "id") reveals what uid/gid the session runs as.
 *
 * This is the standard RSH security audit technique — discovering which
 * host/user pairs are trusted without needing credentials.
 *
 * POST /api/rsh/trust-scan
 * Body: {
 *   host: string,
 *   port?: number,                    // default 514
 *   localUsers?: string[],            // defaults: root, bin, daemon, guest, nobody, anonymous
 *   remoteUsers?: string[],           // defaults: same as localUsers
 *   command?: string,                 // default "id"
 *   maxPairs?: number,                // cap on combinations tested (default 25)
 *   timeout?: number,                 // overall timeout ms (default 20000)
 * }
 * Returns: {
 *   results: [{localUser, remoteUser, command, accepted, output, error, privilegedPortRejection, rttMs}],
 *   summary: {total, accepted, rejected, privilegedPortRejections, trustedPairs}
 * }
 */
export async function handleRshTrustScan(request: Request): Promise<Response> {
  const start = Date.now();
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      localUsers?: string[];
      remoteUsers?: string[];
      command?: string;
      maxPairs?: number;
      timeout?: number;
    };

    const {
      host,
      port = 514,
      localUsers  = ['root', 'bin', 'daemon', 'guest', 'nobody', 'anonymous'],
      remoteUsers,
      command = 'id',
      maxPairs = 25,
      timeout = 20000,
    } = body;

    const remoteList = remoteUsers ?? localUsers;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    // Build test pairs (all combinations, capped)
    const pairs: { localUser: string; remoteUser: string }[] = [];
    outer: for (const lu of localUsers) {
      for (const ru of remoteList) {
        pairs.push({ localUser: lu, remoteUser: ru });
        if (pairs.length >= maxPairs) break outer;
      }
    }

    const enc = new TextEncoder();
    const dec = new TextDecoder();

    /** Try a single localUser→remoteUser pair via a fresh RSH connection. */
    const tryPair = async (localUser: string, remoteUser: string) => {
      const t0 = Date.now();
      try {
        const socket = connect(`${host}:${port}`);
        await Promise.race([
          socket.opened,
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('connect timeout')), 5000)),
        ]);

        const reader = socket.readable.getReader();
        const writer = socket.writable.getWriter();

        try {
          await writer.write(enc.encode('\0'));
          await writer.write(enc.encode(`${localUser}\0`));
          await writer.write(enc.encode(`${remoteUser}\0`));
          await writer.write(enc.encode(`${command}\0`));

          const { value, done } = await Promise.race([
            reader.read(),
            new Promise<{ value: undefined; done: true }>(res =>
              setTimeout(() => res({ value: undefined, done: true }), 4000)),
          ]);

          const rttMs = Date.now() - t0;

          if (done || !value) {
            return { localUser, remoteUser, command, accepted: false, error: 'No response', privilegedPortRejection: false, rttMs };
          }

          if (value[0] === 0) {
            // \0 = accepted — collect remaining output
            let output = dec.decode(value).slice(1);
            const deadline = Date.now() + 1500;
            for (let i = 0; i < 6; i++) {
              const { value: v, done: d } = await Promise.race([
                reader.read(),
                new Promise<{ value: undefined; done: true }>(res =>
                  setTimeout(() => res({ value: undefined, done: true }), Math.max(50, deadline - Date.now()))),
              ]);
              if (d || !v) break;
              output += dec.decode(v);
            }
            return { localUser, remoteUser, command, accepted: true, output: output.trim() || undefined, privilegedPortRejection: false, rttMs };
          } else {
            const msg = dec.decode(value).trim();
            const isPriv = /permission denied|privileged port|reserved port|not superuser/i.test(msg);
            return { localUser, remoteUser, command, accepted: false, error: msg || undefined, privilegedPortRejection: isPriv, rttMs };
          }
        } finally {
          try { reader.releaseLock(); } catch { /* ignore */ }
          try { writer.releaseLock(); } catch { /* ignore */ }
          try { socket.close(); } catch { /* ignore */ }
        }
      } catch (e) {
        return {
          localUser, remoteUser, command, accepted: false,
          error: e instanceof Error ? e.message : 'Connection failed',
          privilegedPortRejection: false,
          rttMs: Date.now() - t0,
        };
      }
    };

    const tp = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Probe timeout')), timeout));
    const results = await Promise.race([
      Promise.all(pairs.map(p => tryPair(p.localUser, p.remoteUser))),
      tp,
    ]);

    const accepted  = results.filter(r => r.accepted);
    const privRej   = results.filter(r => r.privilegedPortRejection);
    const trustedPairs = accepted.map(r => `${r.localUser}→${r.remoteUser}`);

    let note: string;
    if (accepted.length > 0) {
      note = `SECURITY: ${accepted.length} trusted pair(s) confirmed. Server has .rhosts entries for this host.`;
    } else if (privRej.length > 0) {
      note = `RSH active. All ${privRej.length} connection(s) rejected due to unprivileged source port (Cloudflare Workers cannot bind ports < 1024) — server is running RSH but requires privileged source ports.`;
    } else {
      note = 'No trusted pairs found. Server may require specific .rhosts entries for this source IP, or RSH is not listening.';
    }

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      command,
      pairsTestedCount: pairs.length,
      results,
      summary: {
        total: results.length,
        accepted: accepted.length,
        rejected: results.length - accepted.length,
        privilegedPortRejections: privRej.length,
        trustedPairs,
      },
      note,
      latencyMs: Date.now() - start,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      latencyMs: Date.now() - start,
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
