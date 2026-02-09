/**
 * POP3 Protocol Support for Cloudflare Workers
 * Post Office Protocol v3 for email retrieval
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

export interface POP3ConnectionOptions {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  timeout?: number;
}

export interface POP3Message {
  id: number;
  size: number;
}

export interface POP3ListResponse {
  messages: POP3Message[];
  totalMessages: number;
  totalSize: number;
}

/**
 * Read POP3 response with timeout
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

      const chunk = new TextDecoder().decode(value);
      response += chunk;

      // POP3 responses end with \r\n
      if (response.includes('\r\n')) {
        break;
      }
    }
    return response;
  })();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('POP3 read timeout')), timeoutMs)
  );

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Read multi-line POP3 response (ends with ".\r\n")
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

      const chunk = new TextDecoder().decode(value);
      response += chunk;

      // Multi-line responses end with \r\n.\r\n
      if (response.includes('\r\n.\r\n')) {
        break;
      }
    }
    return response;
  })();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('POP3 read timeout')), timeoutMs)
  );

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Send POP3 command and read response
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
 * Handle POP3 connection test (HTTP mode)
 */
export async function handlePOP3Connect(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let options: Partial<POP3ConnectionOptions>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<POP3ConnectionOptions>;
    } else {
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '110'),
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
    const port = options.port || 110;
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
        // Read server greeting (+OK)
        const greeting = await readPOP3Response(reader, 5000);

        if (!greeting.startsWith('+OK')) {
          throw new Error(`Invalid POP3 greeting: ${greeting}`);
        }

        let authenticated = false;
        let capabilities = '';

        // Try authentication if credentials provided
        if (options.username && options.password) {
          // Send USER command
          const userResp = await sendPOP3Command(
            reader,
            writer,
            `USER ${options.username}`,
            5000
          );

          if (!userResp.startsWith('+OK')) {
            throw new Error(`USER command failed: ${userResp}`);
          }

          // Send PASS command
          const passResp = await sendPOP3Command(
            reader,
            writer,
            `PASS ${options.password}`,
            5000
          );

          if (passResp.startsWith('+OK')) {
            authenticated = true;
            capabilities = passResp;
          } else {
            throw new Error(`Authentication failed: ${passResp}`);
          }
        }

        // Send QUIT
        await sendPOP3Command(reader, writer, 'QUIT', 5000);
        await socket.close();

        return {
          success: true,
          message: 'POP3 server reachable',
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
 * Handle POP3 LIST command (list messages)
 */
export async function handlePOP3List(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        error: 'Method not allowed',
      }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const options = await request.json() as Partial<POP3ConnectionOptions>;

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
    const port = options.port || 110;
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
        const greeting = await readPOP3Response(reader, 5000);
        if (!greeting.startsWith('+OK')) {
          throw new Error(`Invalid POP3 greeting: ${greeting}`);
        }

        // Authenticate
        const userResp = await sendPOP3Command(
          reader,
          writer,
          `USER ${options.username}`,
          5000
        );
        if (!userResp.startsWith('+OK')) {
          throw new Error(`USER command failed: ${userResp}`);
        }

        const passResp = await sendPOP3Command(
          reader,
          writer,
          `PASS ${options.password}`,
          5000
        );
        if (!passResp.startsWith('+OK')) {
          throw new Error(`Authentication failed: ${passResp}`);
        }

        // Get mailbox status (STAT)
        const statResp = await sendPOP3Command(reader, writer, 'STAT', 5000);
        if (!statResp.startsWith('+OK')) {
          throw new Error(`STAT command failed: ${statResp}`);
        }

        // Parse STAT response: +OK count size
        const statMatch = statResp.match(/\+OK (\d+) (\d+)/);
        const totalMessages = statMatch ? parseInt(statMatch[1]) : 0;
        const totalSize = statMatch ? parseInt(statMatch[2]) : 0;

        // Get message list (LIST)
        await writer.write(new TextEncoder().encode('LIST\r\n'));
        const listResp = await readPOP3MultiLine(reader, 10000);

        // Parse LIST response
        const messages: POP3Message[] = [];
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
          messages,
          totalMessages,
          totalSize,
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
 * Handle POP3 RETR command (retrieve message)
 */
export async function handlePOP3Retrieve(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        error: 'Method not allowed',
      }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const options = await request.json() as Partial<POP3ConnectionOptions & { messageId: number }>;

    // Validate required fields
    if (!options.host || !options.username || !options.password || !options.messageId) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: host, username, password, messageId',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 110;
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
    const retrievePromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Read greeting
        const greeting = await readPOP3Response(reader, 5000);
        if (!greeting.startsWith('+OK')) {
          throw new Error(`Invalid POP3 greeting: ${greeting}`);
        }

        // Authenticate
        const userResp = await sendPOP3Command(
          reader,
          writer,
          `USER ${options.username}`,
          5000
        );
        if (!userResp.startsWith('+OK')) {
          throw new Error(`USER command failed: ${userResp}`);
        }

        const passResp = await sendPOP3Command(
          reader,
          writer,
          `PASS ${options.password}`,
          5000
        );
        if (!passResp.startsWith('+OK')) {
          throw new Error(`Authentication failed: ${passResp}`);
        }

        // Retrieve message (RETR)
        await writer.write(new TextEncoder().encode(`RETR ${options.messageId}\r\n`));
        const messageResp = await readPOP3MultiLine(reader, 30000);

        // Parse message (remove +OK line and terminating .\r\n)
        const lines = messageResp.split('\r\n');
        const messageLines = lines.slice(1, -2); // Remove +OK and .
        const message = messageLines.join('\r\n');

        // Send QUIT
        await sendPOP3Command(reader, writer, 'QUIT', 5000);
        await socket.close();

        return {
          success: true,
          messageId: options.messageId,
          message,
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
      error: error instanceof Error ? error.message : 'Retrieve failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
