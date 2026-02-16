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
    const url = new URL(request.url);
    let options: {
      host?: string;
      port?: number;
      username?: string;
      password?: string;
      timeout?: number;
    };

    if (request.method === 'POST') {
      options = await request.json() as typeof options;
    } else {
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '995'),
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
