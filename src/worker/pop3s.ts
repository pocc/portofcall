/**
 * POP3S Protocol Implementation
 *
 * POP3 over TLS (RFC 8314) — port 995
 * Identical to POP3 but the entire connection is wrapped in TLS
 * using Cloudflare Workers' secureTransport: 'on' option.
 *
 * Protocol: POP3 commands over implicit TLS
 * Default port: 995
 *
 * Commands:
 *   USER <name>\r\n         - Identify user
 *   PASS <password>\r\n     - Authenticate
 *   STAT\r\n                - Mailbox status (count and size)
 *   LIST\r\n                - List messages with sizes
 *   RETR <msg>\r\n          - Retrieve a message
 *   QUIT\r\n                - Close session
 *
 * Responses:
 *   +OK ...                 - Success
 *   -ERR ...                - Error
 *   Multi-line ends with ".\r\n"
 *
 * Security: Full TLS encryption. Credentials sent over encrypted channel.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/**
 * Read POP3 single-line response with timeout
 */
async function readPOP3Response(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<string> {
  const readPromise = (async () => {
    let response = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      response += new TextDecoder().decode(value);
      if (response.includes('\r\n')) break;
    }
    return response;
  })();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('POP3S read timeout')), timeoutMs)
  );

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Read POP3 multi-line response (ends with ".\r\n")
 *
 * Per RFC 1939 §3, POP3 servers "byte-stuff" lines beginning with "."
 * by prepending an extra ".". After receiving the full response, we
 * reverse this by removing the leading dot from any line that starts
 * with ".." (dot-unstuffing).
 */
async function readPOP3MultiLine(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<string> {
  const readPromise = (async () => {
    let response = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      response += new TextDecoder().decode(value);
      if (response.includes('\r\n.\r\n')) break;
    }

    // RFC 1939 §3: Dot-unstuffing — remove the extra leading "." from
    // any line that was byte-stuffed by the server.
    response = response.replace(/^\.\./gm, '.');

    return response;
  })();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('POP3S read timeout')), timeoutMs)
  );

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Send POP3 command and read single-line response
 */
async function sendPOP3Command(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  command: string,
  timeoutMs: number
): Promise<string> {
  await writer.write(new TextEncoder().encode(command + '\r\n'));
  return await readPOP3Response(reader, timeoutMs);
}

/**
 * Handle POP3S connection test
 */
export async function handlePOP3SConnect(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: { 'Allow': 'POST', 'Content-Type': 'application/json' } });
    }
    const options = await request.json() as {
      host?: string;
      port?: number;
      username?: string;
      password?: string;
      timeout?: number;
    };

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
    const port = options.port || 995;
    const timeoutMs = options.timeout || 30000;

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
        // Read server greeting (+OK ...)
        const greeting = await readPOP3Response(reader, 5000);

        if (!greeting.startsWith('+OK')) {
          throw new Error(`Invalid POP3S greeting: ${greeting.trim()}`);
        }

        let authenticated = false;
        let messageCount: number | null = null;
        let mailboxSize: number | null = null;

        // Try authentication if credentials provided
        if (options.username && options.password) {
          const userResp = await sendPOP3Command(
            reader, writer, `USER ${options.username}`, 5000
          );

          if (!userResp.startsWith('+OK')) {
            throw new Error(`USER command failed: ${userResp.trim()}`);
          }

          const passResp = await sendPOP3Command(
            reader, writer, `PASS ${options.password}`, 5000
          );

          if (passResp.startsWith('+OK')) {
            authenticated = true;

            // Get mailbox status
            const statResp = await sendPOP3Command(reader, writer, 'STAT', 5000);
            if (statResp.startsWith('+OK')) {
              const statMatch = statResp.match(/\+OK (\d+) (\d+)/);
              if (statMatch) {
                messageCount = parseInt(statMatch[1]);
                mailboxSize = parseInt(statMatch[2]);
              }
            }
          } else {
            throw new Error(`Authentication failed: ${passResp.trim()}`);
          }
        }

        // Send QUIT
        await sendPOP3Command(reader, writer, 'QUIT', 5000);
        await socket.close();

        return {
          success: true,
          host,
          port,
          protocol: 'POP3S',
          tls: true,
          rtt,
          greeting: greeting.trim(),
          authenticated,
          messageCount,
          mailboxSize,
          note: authenticated
            ? `Authenticated over TLS. ${messageCount} message(s), ${mailboxSize} bytes`
            : 'POP3S connection test only. Provide credentials to test login.',
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
      error: error instanceof Error ? error.message : 'POP3S connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle POP3S LIST command (list messages over TLS)
 */
export async function handlePOP3SList(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const options = await request.json() as {
      host?: string;
      port?: number;
      username?: string;
      password?: string;
      timeout?: number;
    };

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
    const port = options.port || 995;
    const timeoutMs = options.timeout || 30000;

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
        const greeting = await readPOP3Response(reader, 5000);
        if (!greeting.startsWith('+OK')) {
          throw new Error(`Invalid POP3S greeting: ${greeting.trim()}`);
        }

        // Authenticate
        const userResp = await sendPOP3Command(
          reader, writer, `USER ${options.username}`, 5000
        );
        if (!userResp.startsWith('+OK')) {
          throw new Error(`USER command failed: ${userResp.trim()}`);
        }

        const passResp = await sendPOP3Command(
          reader, writer, `PASS ${options.password}`, 5000
        );
        if (!passResp.startsWith('+OK')) {
          throw new Error(`Authentication failed: ${passResp.trim()}`);
        }

        // Get mailbox status
        const statResp = await sendPOP3Command(reader, writer, 'STAT', 5000);
        if (!statResp.startsWith('+OK')) {
          throw new Error(`STAT command failed: ${statResp.trim()}`);
        }
        const statMatch = statResp.match(/\+OK (\d+) (\d+)/);
        const totalMessages = statMatch ? parseInt(statMatch[1]) : 0;
        const totalSize = statMatch ? parseInt(statMatch[2]) : 0;

        // Get message list
        await writer.write(new TextEncoder().encode('LIST\r\n'));
        const listResp = await readPOP3MultiLine(reader, 10000);

        // Parse LIST response
        const messages: Array<{ id: number; size: number }> = [];
        const lines = listResp.split('\r\n');
        for (const line of lines) {
          if (line === '.' || line.startsWith('+OK')) continue;
          const match = line.match(/^(\d+)\s+(\d+)/);
          if (match) {
            messages.push({
              id: parseInt(match[1]),
              size: parseInt(match[2]),
            });
          }
        }

        // Send QUIT
        await sendPOP3Command(reader, writer, 'QUIT', 5000);
        await socket.close();

        return {
          success: true,
          host,
          port,
          tls: true,
          messages,
          totalMessages,
          totalSize,
          message: `${totalMessages} message(s), ${totalSize} bytes total`,
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
      error: error instanceof Error ? error.message : 'POP3S list failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle POP3S RETR command (retrieve message over TLS)
 */
export async function handlePOP3SRetrieve(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const options = await request.json() as {
      host?: string;
      port?: number;
      username?: string;
      password?: string;
      messageId?: number;
      timeout?: number;
    };

    if (!options.host || !options.username || !options.password || !options.messageId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameters: host, username, password, messageId',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 995;
    const timeoutMs = options.timeout || 30000;

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

    const retrievePromise = (async () => {
      const socket = connect(`${host}:${port}`, {
        secureTransport: 'on',
        allowHalfOpen: false,
      });
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Read greeting
        const greeting = await readPOP3Response(reader, 5000);
        if (!greeting.startsWith('+OK')) {
          throw new Error(`Invalid POP3S greeting: ${greeting.trim()}`);
        }

        // Authenticate
        const userResp = await sendPOP3Command(
          reader, writer, `USER ${options.username}`, 5000
        );
        if (!userResp.startsWith('+OK')) {
          throw new Error(`USER command failed: ${userResp.trim()}`);
        }

        const passResp = await sendPOP3Command(
          reader, writer, `PASS ${options.password}`, 5000
        );
        if (!passResp.startsWith('+OK')) {
          throw new Error(`Authentication failed: ${passResp.trim()}`);
        }

        // Retrieve message
        await writer.write(new TextEncoder().encode(`RETR ${options.messageId}\r\n`));
        const messageResp = await readPOP3MultiLine(reader, 30000);

        // Parse message — remove +OK line and terminating .
        const lines = messageResp.split('\r\n');
        const messageLines = lines.slice(1, -2);
        const message = messageLines.join('\r\n');

        // Send QUIT
        await sendPOP3Command(reader, writer, 'QUIT', 5000);
        await socket.close();

        return {
          success: true,
          messageId: options.messageId,
          message,
          tls: true,
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Retrieve timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([retrievePromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (timeoutError) {
      return new Response(JSON.stringify({
        success: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'Retrieve timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'POP3S retrieve failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle POP3S DELE command (mark message for deletion over TLS)
 */
export async function handlePOP3SDele(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const options = await request.json() as {
      host?: string; port?: number; username?: string; password?: string; msgnum?: number; timeout?: number;
    };
    if (!options.host || !options.username || !options.password || options.msgnum == null) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: host, username, password, msgnum',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const host = options.host;
    const port = options.port || 995;
    const timeoutMs = options.timeout || 30000;
    const msgnum = options.msgnum;
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    const delePromise = (async () => {
      const socket = connect(`${host}:${port}`, { secureTransport: 'on', allowHalfOpen: false });
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        const greeting = await readPOP3Response(reader, 5000);
        if (!greeting.startsWith('+OK')) throw new Error(`Invalid POP3S greeting: ${greeting.trim()}`);
        const userResp = await sendPOP3Command(reader, writer, `USER ${options.username}`, 5000);
        if (!userResp.startsWith('+OK')) throw new Error(`USER command failed: ${userResp.trim()}`);
        const passResp = await sendPOP3Command(reader, writer, `PASS ${options.password}`, 5000);
        if (!passResp.startsWith('+OK')) throw new Error(`Authentication failed: ${passResp.trim()}`);
        const deleResp = await sendPOP3Command(reader, writer, `DELE ${msgnum}`, 5000);
        if (!deleResp.startsWith('+OK')) throw new Error(`DELE command failed: ${deleResp.trim()}`);
        await sendPOP3Command(reader, writer, 'QUIT', 5000);
        await socket.close();
        return { success: true, msgnum, message: deleResp.trim(), tls: true };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('DELE timeout')), timeoutMs)
    );
    try {
      const result = await Promise.race([delePromise, timeoutPromise]);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    } catch (timeoutError) {
      return new Response(JSON.stringify({ success: false, error: timeoutError instanceof Error ? timeoutError.message : 'DELE timeout' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'POP3S DELE failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle POP3S UIDL command (list unique message IDs over TLS)
 */
export async function handlePOP3SUidl(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const options = await request.json() as {
      host?: string; port?: number; username?: string; password?: string; timeout?: number;
    };
    if (!options.host || !options.username || !options.password) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: host, username, password',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const host = options.host;
    const port = options.port || 995;
    const timeoutMs = options.timeout || 30000;
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    const uidlPromise = (async () => {
      const socket = connect(`${host}:${port}`, { secureTransport: 'on', allowHalfOpen: false });
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        const greeting = await readPOP3Response(reader, 5000);
        if (!greeting.startsWith('+OK')) throw new Error(`Invalid POP3S greeting: ${greeting.trim()}`);
        const userResp = await sendPOP3Command(reader, writer, `USER ${options.username}`, 5000);
        if (!userResp.startsWith('+OK')) throw new Error(`USER command failed: ${userResp.trim()}`);
        const passResp = await sendPOP3Command(reader, writer, `PASS ${options.password}`, 5000);
        if (!passResp.startsWith('+OK')) throw new Error(`Authentication failed: ${passResp.trim()}`);
        await writer.write(new TextEncoder().encode('UIDL\r\n'));
        const uidlResp = await readPOP3MultiLine(reader, 10000);
        const messages: Array<{ msgnum: number; uid: string }> = [];
        const lines = uidlResp.split('\r\n');
        for (const line of lines) {
          if (line === '.' || line.startsWith('+OK') || line === '') continue;
          const match = line.match(/^(\d+)\s+(\S+)/);
          if (match) messages.push({ msgnum: parseInt(match[1]), uid: match[2] });
        }
        await sendPOP3Command(reader, writer, 'QUIT', 5000);
        await socket.close();
        return { success: true, messages, count: messages.length, tls: true };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('UIDL timeout')), timeoutMs)
    );
    try {
      const result = await Promise.race([uidlPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    } catch (timeoutError) {
      return new Response(JSON.stringify({ success: false, error: timeoutError instanceof Error ? timeoutError.message : 'UIDL timeout' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'POP3S UIDL failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle POP3S TOP command (retrieve headers + first N body lines over TLS)
 */
export async function handlePOP3STop(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const options = await request.json() as {
      host?: string; port?: number; username?: string; password?: string;
      msgnum?: number; lines?: number; timeout?: number;
    };
    if (!options.host || !options.username || !options.password || options.msgnum == null) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: host, username, password, msgnum',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const host = options.host;
    const port = options.port || 995;
    const timeoutMs = options.timeout || 30000;
    const msgnum = options.msgnum;
    const lines = options.lines ?? 0;
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    const topPromise = (async () => {
      const socket = connect(`${host}:${port}`, { secureTransport: 'on', allowHalfOpen: false });
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        const greeting = await readPOP3Response(reader, 5000);
        if (!greeting.startsWith('+OK')) throw new Error(`Invalid POP3S greeting: ${greeting.trim()}`);
        const userResp = await sendPOP3Command(reader, writer, `USER ${options.username}`, 5000);
        if (!userResp.startsWith('+OK')) throw new Error(`USER command failed: ${userResp.trim()}`);
        const passResp = await sendPOP3Command(reader, writer, `PASS ${options.password}`, 5000);
        if (!passResp.startsWith('+OK')) throw new Error(`Authentication failed: ${passResp.trim()}`);
        await writer.write(new TextEncoder().encode(`TOP ${msgnum} ${lines}\r\n`));
        const topResp = await readPOP3MultiLine(reader, 30000);
        if (!topResp.startsWith('+OK')) throw new Error(`TOP command failed: ${topResp.trim()}`);
        const respLines = topResp.split('\r\n');
        const contentLines = respLines.slice(1, -2);
        const content = contentLines.join('\r\n');
        await sendPOP3Command(reader, writer, 'QUIT', 5000);
        await socket.close();
        return { success: true, msgnum, lines, content, tls: true };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('TOP timeout')), timeoutMs)
    );
    try {
      const result = await Promise.race([topPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    } catch (timeoutError) {
      return new Response(JSON.stringify({ success: false, error: timeoutError instanceof Error ? timeoutError.message : 'TOP timeout' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'POP3S TOP failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle POP3S CAPA command (server capabilities over TLS, no auth required)
 */
export async function handlePOP3SCapa(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let host = '';
    let port = 995;
    if (request.method === 'POST') {
      const body = await request.json() as { host?: string; port?: number };
      host = body.host || '';
      port = body.port || 995;
    } else {
      host = url.searchParams.get('host') || '';
      port = parseInt(url.searchParams.get('port') || '995');
    }
    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    const capaPromise = (async () => {
      const socket = connect(`${host}:${port}`, { secureTransport: 'on', allowHalfOpen: false });
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        const greeting = await readPOP3Response(reader, 5000);
        if (!greeting.startsWith('+OK')) throw new Error(`Invalid POP3S greeting: ${greeting.trim()}`);
        await writer.write(new TextEncoder().encode('CAPA\r\n'));
        const capaResp = await readPOP3Response(reader, 10000);
        if (!capaResp.startsWith('+OK')) {
          // Server does not support CAPA (RFC 2449 §5 — optional command)
          await writer.write(new TextEncoder().encode('QUIT\r\n'));
          await socket.close();
          return { success: true, host, port, capabilities: [], tls: true, note: 'Server returned -ERR to CAPA — CAPA not supported' };
        }
        // Read the rest of the multi-line CAPA response
        const capaBody = await readPOP3MultiLine(reader, 10000);
        const capabilities: string[] = [];
        const lines = capaBody.split('\r\n');
        for (const line of lines) {
          if (line === '.' || line.startsWith('+OK') || line === '') continue;
          capabilities.push(line);
        }
        await writer.write(new TextEncoder().encode('QUIT\r\n'));
        await socket.close();
        return { success: true, host, port, capabilities, tls: true };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('CAPA timeout')), 30000)
    );
    try {
      const result = await Promise.race([capaPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    } catch (timeoutError) {
      return new Response(JSON.stringify({ success: false, error: timeoutError instanceof Error ? timeoutError.message : 'CAPA timeout' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'POP3S CAPA failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
