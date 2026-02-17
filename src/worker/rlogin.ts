/**
 * Rlogin Protocol Implementation (RFC 1282)
 *
 * BSD Remote Login — the predecessor to SSH. Provides interactive terminal
 * sessions with automatic user identity passing. Unlike Telnet, Rlogin
 * sends user credentials in the initial handshake rather than interactively.
 *
 * Protocol Flow:
 * 1. Client connects to server port 513
 * 2. Client sends: \0
 * 3. Client sends: local_user\0remote_user\0terminal_type/speed\0
 * 4. Server responds with \0 (success) or error text
 * 5. Interactive terminal session begins (raw bytes, no Telnet escapes)
 *
 * Security: NONE — cleartext passwords, .rhosts trust. Replaced by SSH.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface RloginConnectRequest {
  host: string;
  port?: number;
  localUser?: string;
  remoteUser?: string;
  terminalType?: string;
  terminalSpeed?: string;
  timeout?: number;
}

/**
 * Handle Rlogin connection probe
 * Performs the Rlogin handshake and reports the server response
 */
export async function handleRloginConnect(request: Request): Promise<Response> {
  try {
    let options: Partial<RloginConnectRequest>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<RloginConnectRequest>;
    } else {
      const url = new URL(request.url);
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '513'),
        localUser: url.searchParams.get('localUser') || 'guest',
        remoteUser: url.searchParams.get('remoteUser') || 'guest',
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
    const port = options.port || 513;
    const localUser = options.localUser || 'guest';
    const remoteUser = options.remoteUser || 'guest';
    const terminalType = options.terminalType || 'xterm';
    const terminalSpeed = options.terminalSpeed || '38400';
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

      try {
        // Step 1: Send initial null byte
        await writer.write(new Uint8Array([0]));

        // Step 2: Send client-user-name\0server-user-name\0terminal-type/speed\0
        const handshake = `${localUser}\0${remoteUser}\0${terminalType}/${terminalSpeed}\0`;
        await writer.write(new TextEncoder().encode(handshake));

        // Step 3: Read server response
        const readTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Rlogin handshake timeout')), 5000)
        );

        const { value, done } = await Promise.race([reader.read(), readTimeout]);
        const rtt = Date.now() - startTime;

        if (done || !value) {
          throw new Error('Connection closed before server response');
        }

        // Check first byte — \0 means success, anything else is an error
        const firstByte = value[0];
        const responseText = new TextDecoder().decode(value);

        let serverAccepted = false;
        let serverMessage = '';

        if (firstByte === 0) {
          serverAccepted = true;
          // Remaining bytes after \0 may be the login prompt or banner
          serverMessage = responseText.substring(1).trim();
        } else {
          serverAccepted = false;
          serverMessage = responseText.trim();
        }

        // Read any additional banner text
        let banner = '';
        try {
          const bannerTimeout = new Promise<{ value: undefined; done: true }>((resolve) =>
            setTimeout(() => resolve({ value: undefined, done: true }), 1000)
          );
          const bannerResult = await Promise.race([reader.read(), bannerTimeout]);
          if (!bannerResult.done && bannerResult.value) {
            banner = new TextDecoder().decode(bannerResult.value).trim();
          }
        } catch {
          // No additional data — that's fine
        }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return {
          success: true,
          host,
          port,
          protocol: 'Rlogin',
          rtt,
          serverAccepted,
          serverMessage: serverMessage || (serverAccepted ? 'Connection accepted' : 'Unknown error'),
          banner: banner || undefined,
          handshake: {
            localUser,
            remoteUser,
            terminalType,
            terminalSpeed,
          },
          security: 'NONE — Rlogin transmits credentials in cleartext. Use SSH instead.',
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

interface RloginBannerResult {
  success: boolean;
  connected: boolean;
  banner: string;
  raw: string;
  latencyMs: number;
  error?: string;
}

/**
 * Connect to an Rlogin server, send the initial preamble, and return the
 * server banner / terminal prompt without starting an interactive session.
 *
 * POST /api/rlogin/banner
 * Body: { host, port?, localUser?, remoteUser?, terminalType?, terminalSpeed?, timeout? }
 */
export async function handleRloginBanner(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      host: string;
      port?: number;
      localUser?: string;
      remoteUser?: string;
      terminalType?: string;
      terminalSpeed?: string;
      timeout?: number;
    };
    const {
      host,
      port = 513,
      localUser = 'guest',
      remoteUser = 'guest',
      terminalType = 'xterm',
      terminalSpeed = '38400',
      timeout: timeoutMs = 10000,
    } = body;

    if (!host) {
      return new Response(
        JSON.stringify({ success: false, connected: false, banner: '', raw: '', latencyMs: 0, error: 'Host is required' } satisfies RloginBannerResult),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs),
    );

    const socket = connect(`${host}:${port}`);

    const connectionPromise = (async (): Promise<RloginBannerResult> => {
      const startTime = Date.now();
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Rlogin preamble: null byte + localUser + null + remoteUser + null + term/speed + null
        const preamble = new TextEncoder().encode(
          `\0${localUser}\0${remoteUser}\0${terminalType}/${terminalSpeed}\0`,
        );
        await writer.write(preamble);

        // Read the server's response (banner / prompt)
        const readTimeout = new Promise<{ value: undefined; done: true }>((resolve) =>
          setTimeout(() => resolve({ value: undefined, done: true as const }), 4000),
        );
        const { value, done } = await Promise.race([reader.read(), readTimeout]);

        const latencyMs = Date.now() - startTime;
        const rawBytes = !done && value ? value : new Uint8Array(0);
        const raw = new TextDecoder('utf-8', { fatal: false }).decode(rawBytes);
        // Strip control chars for display except newline/tab
        const banner = raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return { success: true, connected: true, banner: banner || '(no banner)', raw, latencyMs };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* already released */ }
        try { reader.releaseLock(); } catch { /* already released */ }
        socket.close(); throw err;
      }
    })();

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
      return new Response(
        JSON.stringify({ success: false, connected: false, banner: '', raw: '', latencyMs: 0, error: error instanceof Error ? error.message : 'Connection timeout' } satisfies RloginBannerResult),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, connected: false, banner: '', raw: '', latencyMs: 0, error: error instanceof Error ? error.message : 'Connection failed' } satisfies RloginBannerResult),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Open a persistent WebSocket tunnel for interactive Rlogin sessions
 */
export async function handleRloginWebSocket(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const host = url.searchParams.get('host');
    const port = parseInt(url.searchParams.get('port') || '513');
    const localUser = url.searchParams.get('localUser') || 'guest';
    const remoteUser = url.searchParams.get('remoteUser') || 'guest';
    const terminalType = url.searchParams.get('terminalType') || 'xterm';
    const terminalSpeed = url.searchParams.get('terminalSpeed') || '38400';

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

        // Perform Rlogin handshake
        await writer.write(new Uint8Array([0]));
        const handshake = `${localUser}\0${remoteUser}\0${terminalType}/${terminalSpeed}\0`;
        await writer.write(new TextEncoder().encode(handshake));

        // Forward TCP -> WebSocket
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

        // Forward WebSocket -> TCP
        server.addEventListener('message', async (event) => {
          if (typeof event.data === 'string') {
            await writer.write(new TextEncoder().encode(event.data));
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
        console.error('Rlogin WebSocket tunnel error:', error);
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
