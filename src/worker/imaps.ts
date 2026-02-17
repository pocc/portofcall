/**
 * IMAPS Protocol Support for Cloudflare Workers
 * IMAP over TLS (RFC 8314) — port 993
 *
 * Identical to IMAP but the entire connection is wrapped in TLS
 * using Cloudflare Workers' secureTransport: 'on' option.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface IMAPSConnectionOptions {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  timeout?: number;
}

/**
 * Read IMAP response with timeout
 */
async function readIMAPResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  tag: string,
  timeoutMs: number
): Promise<string> {
  const readPromise = (async () => {
    let response = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = new TextDecoder().decode(value);
      response += chunk;

      if (response.includes(`${tag} OK`) || response.includes(`${tag} NO`) || response.includes(`${tag} BAD`)) {
        break;
      }
    }
    return response;
  })();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('IMAPS read timeout')), timeoutMs)
  );

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Send IMAP command and read response
 */
async function sendIMAPCommand(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  tag: string,
  command: string,
  timeoutMs: number
): Promise<string> {
  await writer.write(new TextEncoder().encode(`${tag} ${command}\r\n`));
  return await readIMAPResponse(reader, tag, timeoutMs);
}

/**
 * Handle IMAPS connection test (HTTP mode)
 */
export async function handleIMAPSConnect(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let options: Partial<IMAPSConnectionOptions>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<IMAPSConnectionOptions>;
    } else {
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '993'),
        username: url.searchParams.get('username') || undefined,
        password: url.searchParams.get('password') || undefined,
        timeout: parseInt(url.searchParams.get('timeout') || '30000'),
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
    const port = options.port || 993;
    const timeoutMs = options.timeout || 30000;

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

    const connectionPromise = (async () => {
      const startTime = Date.now();

      // Connect with TLS using secureTransport: 'on'
      const socket = connect(`${host}:${port}`, {
        secureTransport: 'on',
        allowHalfOpen: false,
      });
      await socket.opened;

      const rtt = Date.now() - startTime;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Read server greeting (* OK ...)
        const greetingPromise = (async () => {
          let greeting = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = new TextDecoder().decode(value);
            greeting += chunk;

            if (greeting.includes('\r\n')) {
              break;
            }
          }
          return greeting;
        })();

        const greetingTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Greeting timeout')), 5000)
        );

        const greeting = await Promise.race([greetingPromise, greetingTimeout]);

        if (!greeting.includes('* OK')) {
          throw new Error(`Invalid IMAPS greeting: ${greeting.trim()}`);
        }

        // Extract server capabilities from greeting if available
        let capabilities = '';
        const capMatch = greeting.match(/\[CAPABILITY ([^\]]+)\]/);
        if (capMatch) {
          capabilities = capMatch[1];
        }

        let authenticated = false;

        // Try authentication if credentials provided
        if (options.username && options.password) {
          const loginResp = await sendIMAPCommand(
            reader, writer, 'A001',
            `LOGIN ${options.username} ${options.password}`,
            10000
          );

          if (loginResp.includes('A001 OK')) {
            authenticated = true;

            // Get capabilities after authentication (they may differ)
            const capResp = await sendIMAPCommand(
              reader, writer, 'A002', 'CAPABILITY', 5000
            );

            if (capResp.includes('A002 OK')) {
              const postCapMatch = capResp.match(/\* CAPABILITY ([^\r\n]+)/);
              if (postCapMatch) {
                capabilities = postCapMatch[1];
              }
            }
          } else {
            throw new Error(`Authentication failed: ${loginResp.trim()}`);
          }
        } else {
          // Just request capabilities without login
          const capResp = await sendIMAPCommand(
            reader, writer, 'A001', 'CAPABILITY', 5000
          );
          if (capResp.includes('A001 OK')) {
            const capLine = capResp.match(/\* CAPABILITY ([^\r\n]+)/);
            if (capLine) {
              capabilities = capLine[1];
            }
          }
        }

        // Send LOGOUT
        await sendIMAPCommand(reader, writer, 'A099', 'LOGOUT', 5000);
        await socket.close();

        return {
          success: true,
          host,
          port,
          protocol: 'IMAPS',
          tls: true,
          rtt,
          greeting: greeting.trim(),
          capabilities: capabilities || undefined,
          authenticated,
          note: authenticated
            ? 'Successfully authenticated over TLS'
            : 'IMAPS connection test only (no authentication). Provide credentials to test login.',
        };
      } catch (error) {
        await socket.close();
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
    } catch (timeoutError) {
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
 * Handle IMAPS LIST command (list mailboxes over TLS)
 */
export async function handleIMAPSList(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        error: 'Method not allowed',
      }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const options = await request.json() as Partial<IMAPSConnectionOptions>;

    if (!options.host || !options.username || !options.password) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameters: host, username, password',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 993;
    const timeoutMs = options.timeout || 30000;

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

    const listPromise = (async () => {
      const socket = connect(`${host}:${port}`, {
        secureTransport: 'on',
        allowHalfOpen: false,
      });
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Read greeting
        let greeting = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          greeting += new TextDecoder().decode(value);
          if (greeting.includes('\r\n')) break;
        }

        // Authenticate
        const loginResp = await sendIMAPCommand(
          reader, writer, 'A001',
          `LOGIN ${options.username} ${options.password}`,
          10000
        );

        if (!loginResp.includes('A001 OK')) {
          throw new Error(`Authentication failed: ${loginResp.trim()}`);
        }

        // List mailboxes
        const listResp = await sendIMAPCommand(
          reader, writer, 'A002', 'LIST "" "*"', 10000
        );

        // Parse mailbox list
        const mailboxes: string[] = [];
        const lines = listResp.split('\n');

        for (const line of lines) {
          const match = line.match(/\* LIST \([^)]*\) "([^"]*)" "([^"]*)"/);
          if (match) {
            mailboxes.push(match[2]);
          }
        }

        // Send LOGOUT
        await sendIMAPCommand(reader, writer, 'A003', 'LOGOUT', 5000);
        await socket.close();

        return {
          success: true,
          mailboxes,
          count: mailboxes.length,
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('List timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([listPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (timeoutError) {
      return new Response(JSON.stringify({
        success: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'List timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'List failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle IMAPS SELECT command (select mailbox and get message count over TLS)
 */
export async function handleIMAPSSelect(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        error: 'Method not allowed',
      }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const options = await request.json() as Partial<IMAPSConnectionOptions & { mailbox: string }>;

    if (!options.host || !options.username || !options.password || !options.mailbox) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameters: host, username, password, mailbox',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 993;
    const mailbox = options.mailbox;
    const timeoutMs = options.timeout || 30000;

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

    const selectPromise = (async () => {
      const socket = connect(`${host}:${port}`, {
        secureTransport: 'on',
        allowHalfOpen: false,
      });
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Read greeting
        let greeting = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          greeting += new TextDecoder().decode(value);
          if (greeting.includes('\r\n')) break;
        }

        // Authenticate
        const loginResp = await sendIMAPCommand(
          reader, writer, 'A001',
          `LOGIN ${options.username} ${options.password}`,
          10000
        );

        if (!loginResp.includes('A001 OK')) {
          throw new Error(`Authentication failed: ${loginResp.trim()}`);
        }

        // Select mailbox
        const selectResp = await sendIMAPCommand(
          reader, writer, 'A002', `SELECT ${mailbox}`, 10000
        );

        if (!selectResp.includes('A002 OK')) {
          throw new Error(`SELECT failed: ${selectResp.trim()}`);
        }

        // Parse SELECT response for message count
        let exists = 0;
        let recent = 0;

        const lines = selectResp.split('\n');
        for (const line of lines) {
          const existsMatch = line.match(/\* (\d+) EXISTS/);
          if (existsMatch) exists = parseInt(existsMatch[1]);

          const recentMatch = line.match(/\* (\d+) RECENT/);
          if (recentMatch) recent = parseInt(recentMatch[1]);
        }

        // Send LOGOUT
        await sendIMAPCommand(reader, writer, 'A003', 'LOGOUT', 5000);
        await socket.close();

        return {
          success: true,
          mailbox,
          exists,
          recent,
          message: `Selected mailbox "${mailbox}" with ${exists} message(s)`,
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Select timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([selectPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (timeoutError) {
      return new Response(JSON.stringify({
        success: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'Select timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Select failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle IMAPS interactive WebSocket session
 * GET /api/imaps/session?host=...&port=...&username=...&password=...
 *
 * Connects over TLS, authenticates with LOGIN, then allows the browser
 * to issue raw IMAP commands and receive responses.
 *
 * WebSocket message protocol:
 *   Browser → Worker: JSON { type: 'command', command: string }
 *   Worker → Browser: JSON { type: 'connected', greeting: string, capabilities: string }
 *                          { type: 'response', tag: string, response: string, command: string }
 *                          { type: 'error', message: string }
 */
export async function handleIMAPSSession(request: Request): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('WebSocket upgrade required', { status: 426 });
  }

  const url = new URL(request.url);
  const host = url.searchParams.get('host') || '';
  const port = parseInt(url.searchParams.get('port') || '993');
  const username = url.searchParams.get('username') || '';
  const password = url.searchParams.get('password') || '';

  if (!host || !username || !password) {
    return new Response(JSON.stringify({ error: 'Missing host, username, or password' }), { status: 400 });
  }

  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    return new Response(JSON.stringify({
      error: getCloudflareErrorMessage(host, cfCheck.ip),
    }), { status: 403 });
  }

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();

  (async () => {
    try {
      // Connect with TLS
      const socket = connect(`${host}:${port}`, { secureTransport: 'on', allowHalfOpen: false });
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      // Read server greeting
      let greeting = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        greeting += new TextDecoder().decode(value);
        if (greeting.includes('* OK')) break;
      }

      if (!greeting.includes('* OK')) {
        server.send(JSON.stringify({ type: 'error', message: 'No IMAPS greeting received' }));
        server.close();
        return;
      }

      // LOGIN
      const loginResp = await sendIMAPCommand(reader, writer, 'A001', `LOGIN ${username} ${password}`, 10000);
      if (!loginResp.includes('A001 OK')) {
        server.send(JSON.stringify({ type: 'error', message: 'Authentication failed: ' + loginResp.trim() }));
        server.close();
        return;
      }

      // Get CAPABILITY
      const capResp = await sendIMAPCommand(reader, writer, 'A002', 'CAPABILITY', 5000);
      const capLine = capResp.split('\r\n').find(l => l.startsWith('* CAPABILITY')) ?? '';

      server.send(JSON.stringify({
        type: 'connected',
        greeting: greeting.trim(),
        capabilities: capLine.replace('* CAPABILITY ', '').trim(),
        host,
        port,
        username,
        tls: true,
      }));

      // Auto-increment tag counter (start from A003 since A001/A002 used above)
      let tagCounter = 3;

      server.addEventListener('message', async (event) => {
        try {
          const msg = JSON.parse(event.data as string) as { type: string; command?: string };
          if (msg.type === 'command' && msg.command) {
            const tag = `A${String(tagCounter++).padStart(3, '0')}`;
            const response = await sendIMAPCommand(reader, writer, tag, msg.command.trim(), 30000);
            server.send(JSON.stringify({
              type: 'response',
              tag,
              response,
              command: msg.command.trim(),
            }));
          }
        } catch (e) {
          server.send(JSON.stringify({ type: 'error', message: String(e) }));
        }
      });

      server.addEventListener('close', async () => {
        try {
          const tag = `A${String(tagCounter++).padStart(3, '0')}`;
          await sendIMAPCommand(reader, writer, tag, 'LOGOUT', 3000);
        } catch { /* ignore */ }
        socket.close().catch(() => {});
      });
    } catch (e) {
      server.send(JSON.stringify({ type: 'error', message: String(e) }));
      server.close();
    }
  })();

  return new Response(null, { status: 101, webSocket: client });
}
