/**
 * IMAP Protocol Support for Cloudflare Workers
 * Internet Message Access Protocol for advanced email retrieval
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

export interface IMAPConnectionOptions {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  timeout?: number;
}

export interface IMAPMailbox {
  name: string;
  flags: string[];
  exists: number;
  recent: number;
}

export interface IMAPMessage {
  uid: number;
  flags: string[];
  size: number;
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

      // IMAP responses are tagged: "A001 OK" or "* OK" for untagged
      // Look for completion tag
      if (response.includes(`${tag} OK`) || response.includes(`${tag} NO`) || response.includes(`${tag} BAD`)) {
        break;
      }
    }
    return response;
  })();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('IMAP read timeout')), timeoutMs)
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
 * Handle IMAP connection test (HTTP mode)
 */
export async function handleIMAPConnect(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let options: Partial<IMAPConnectionOptions>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<IMAPConnectionOptions>;
    } else {
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '143'),
        username: url.searchParams.get('username') || undefined,
        password: url.searchParams.get('password') || undefined,
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
    const port = options.port || 143;
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

    // Wrap entire connection in timeout
    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Read server greeting (* OK)
        const greetingPromise = (async () => {
          let greeting = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = new TextDecoder().decode(value);
            greeting += chunk;

            if (greeting.includes('* OK')) {
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
          throw new Error(`Invalid IMAP greeting: ${greeting}`);
        }

        let authenticated = false;
        let capabilities = '';

        // Try authentication if credentials provided
        if (options.username && options.password) {
          // Send LOGIN command
          const loginResp = await sendIMAPCommand(
            reader,
            writer,
            'A001',
            `LOGIN ${options.username} ${options.password}`,
            10000
          );

          if (loginResp.includes('A001 OK')) {
            authenticated = true;

            // Get capabilities after authentication
            const capResp = await sendIMAPCommand(
              reader,
              writer,
              'A002',
              'CAPABILITY',
              5000
            );

            if (capResp.includes('A002 OK')) {
              capabilities = capResp;
            }
          } else {
            throw new Error(`Authentication failed: ${loginResp}`);
          }
        }

        // Send LOGOUT
        await sendIMAPCommand(reader, writer, 'A003', 'LOGOUT', 5000);
        await socket.close();

        return {
          success: true,
          message: 'IMAP server reachable',
          host,
          port,
          greeting: greeting.trim(),
          authenticated,
          capabilities: authenticated ? capabilities.trim() : undefined,
          note: authenticated
            ? 'Successfully authenticated'
            : 'Connection test only (no authentication)',
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
 * Handle IMAP LIST command (list mailboxes)
 */
export async function handleIMAPList(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        error: 'Method not allowed',
      }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const options = await request.json() as Partial<IMAPConnectionOptions>;

    // Validate required fields
    if (!options.host || !options.username || !options.password) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: host, username, password',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 143;
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

    // Wrap entire operation in timeout
    const listPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Read greeting
        let greeting = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = new TextDecoder().decode(value);
          greeting += chunk;

          if (greeting.includes('* OK')) {
            break;
          }
        }

        // Authenticate
        const loginResp = await sendIMAPCommand(
          reader,
          writer,
          'A001',
          `LOGIN ${options.username} ${options.password}`,
          10000
        );

        if (!loginResp.includes('A001 OK')) {
          throw new Error(`Authentication failed: ${loginResp}`);
        }

        // List mailboxes
        const listResp = await sendIMAPCommand(
          reader,
          writer,
          'A002',
          'LIST "" "*"',
          10000
        );

        // Parse mailbox list
        const mailboxes: string[] = [];
        const lines = listResp.split('\r\n');

        for (const line of lines) {
          // RFC 3501 LIST response format:
          //   * LIST (\Flags) "delimiter" "mailbox name"
          //   * LIST (\Flags) "delimiter" mailbox (unquoted)
          //   * LIST (\Flags) NIL "mailbox name"
          //   * LIST (\Flags) NIL mailbox
          const listMatch = line.match(/^\* LIST \([^)]*\)\s+(NIL|"(?:[^"\\]|\\.)*")\s+(.+)$/);
          if (listMatch) {
            let name = listMatch[2].trim();
            // Remove surrounding quotes and unescape if quoted
            if (name.startsWith('"') && name.endsWith('"')) {
              name = name.slice(1, -1).replace(/\\(.)/g, '$1');
            }
            mailboxes.push(name);
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
 * Handle IMAP SELECT command (select mailbox and list messages)
 */
export async function handleIMAPSelect(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        error: 'Method not allowed',
      }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const options = await request.json() as Partial<IMAPConnectionOptions & { mailbox: string }>;

    // Validate required fields
    if (!options.host || !options.username || !options.password || !options.mailbox) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: host, username, password, mailbox',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 143;
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

    // Wrap entire operation in timeout
    const selectPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Read greeting
        let greeting = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = new TextDecoder().decode(value);
          greeting += chunk;

          if (greeting.includes('* OK')) {
            break;
          }
        }

        // Authenticate
        const loginResp = await sendIMAPCommand(
          reader,
          writer,
          'A001',
          `LOGIN ${options.username} ${options.password}`,
          10000
        );

        if (!loginResp.includes('A001 OK')) {
          throw new Error(`Authentication failed: ${loginResp}`);
        }

        // Select mailbox
        const selectResp = await sendIMAPCommand(
          reader,
          writer,
          'A002',
          `SELECT ${mailbox}`,
          10000
        );

        if (!selectResp.includes('A002 OK')) {
          throw new Error(`SELECT failed: ${selectResp}`);
        }

        // Parse SELECT response for message count
        let exists = 0;
        let recent = 0;

        const lines = selectResp.split('\n');
        for (const line of lines) {
          const existsMatch = line.match(/\* (\d+) EXISTS/);
          if (existsMatch) {
            exists = parseInt(existsMatch[1]);
          }

          const recentMatch = line.match(/\* (\d+) RECENT/);
          if (recentMatch) {
            recent = parseInt(recentMatch[1]);
          }
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
 * Handle IMAP interactive WebSocket session
 * GET /api/imap/session?host=...&port=...&username=...&password=...
 *
 * Connects, authenticates with LOGIN, then allows the browser to issue
 * raw IMAP commands (without tags) — the worker assigns tags automatically.
 *
 * WebSocket message protocol:
 *   Browser → Worker: JSON { type: 'command', command: string }  (e.g. 'LIST "" *')
 *   Worker → Browser: JSON { type: 'connected', greeting: string, capabilities: string }
 *                          { type: 'response', tag: string, response: string, command: string }
 *                          { type: 'error', message: string }
 */
export async function handleIMAPSession(request: Request): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('WebSocket upgrade required', { status: 426 });
  }

  const url = new URL(request.url);
  const host = url.searchParams.get('host') || '';
  const port = parseInt(url.searchParams.get('port') || '143');
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
      const socket = connect(`${host}:${port}`);
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
        server.send(JSON.stringify({ type: 'error', message: 'No IMAP greeting received' }));
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
      const capLine = capResp.split('\n').find(l => l.startsWith('* CAPABILITY')) ?? '';

      server.send(JSON.stringify({
        type: 'connected',
        greeting: greeting.trim(),
        capabilities: capLine.replace('* CAPABILITY ', '').trim(),
        host,
        port,
        username,
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
