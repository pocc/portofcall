/**
 * Redis Protocol Support for Cloudflare Workers
 * Implements RESP (Redis Serialization Protocol)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

export interface RedisConnectionOptions {
  host: string;
  port?: number;
  password?: string;
  database?: number;
  timeout?: number;
}

/**
 * Encode a RESP array command
 * Example: ['PING'] -> "*1\r\n$4\r\nPING\r\n"
 */
function encodeRESPArray(args: string[]): Uint8Array {
  let resp = `*${args.length}\r\n`;
  for (const arg of args) {
    const bytes = new TextEncoder().encode(arg);
    resp += `$${bytes.length}\r\n${arg}\r\n`;
  }
  return new TextEncoder().encode(resp);
}

/**
 * Read a RESP response from the socket
 */
async function readRESPResponse(reader: ReadableStreamDefaultReader<Uint8Array>, timeoutMs: number): Promise<string> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Read timeout')), timeoutMs)
  );

  const readPromise = (async () => {
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += new TextDecoder().decode(value);

      // Check if we have a complete response
      if (buffer.includes('\r\n')) {
        return buffer;
      }
    }
    return buffer;
  })();

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Handle Redis connection test (HTTP mode)
 */
export async function handleRedisConnect(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let options: Partial<RedisConnectionOptions>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<RedisConnectionOptions>;
    } else {
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '6379'),
        password: url.searchParams.get('password') || undefined,
        database: url.searchParams.get('database') ? parseInt(url.searchParams.get('database')!) : undefined,
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
    const port = options.port || 6379;
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
        let serverInfo = '';

        // Authenticate if password provided
        if (options.password) {
          const authCommand = encodeRESPArray(['AUTH', options.password]);
          await writer.write(authCommand);
          const authResponse = await readRESPResponse(reader, 5000);

          if (!authResponse.startsWith('+OK')) {
            throw new Error('Authentication failed: ' + authResponse);
          }
          serverInfo += 'Authenticated. ';
        }

        // Select database if specified
        if (options.database !== undefined) {
          const selectCommand = encodeRESPArray(['SELECT', options.database.toString()]);
          await writer.write(selectCommand);
          const selectResponse = await readRESPResponse(reader, 5000);

          if (!selectResponse.startsWith('+OK')) {
            throw new Error('Database selection failed: ' + selectResponse);
          }
          serverInfo += `Database ${options.database} selected. `;
        }

        // Send PING command to test connectivity
        const pingCommand = encodeRESPArray(['PING']);
        await writer.write(pingCommand);
        const pingResponse = await readRESPResponse(reader, 5000);

        if (!pingResponse.includes('PONG')) {
          throw new Error('Invalid PING response: ' + pingResponse);
        }

        serverInfo += 'PING successful.';

        // Get server info using INFO command
        const infoCommand = encodeRESPArray(['INFO', 'server']);
        await writer.write(infoCommand);
        const infoResponse = await readRESPResponse(reader, 5000);

        // Parse version from INFO response
        let version = 'Unknown';
        const versionMatch = infoResponse.match(/redis_version:([^\r\n]+)/);
        if (versionMatch) {
          version = versionMatch[1];
        }

        await socket.close();

        return {
          success: true,
          message: 'Redis server reachable',
          host,
          port,
          serverInfo,
          version,
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
 * Handle Redis command execution
 */
export async function handleRedisCommand(request: Request): Promise<Response> {
  try {
    const options = await request.json() as {
      host: string;
      port?: number;
      password?: string;
      database?: number;
      command: string[];
      timeout?: number;
    };

    if (!options.host || !options.command || options.command.length === 0) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: host and command',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 6379;
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
        // Authenticate if password provided
        if (options.password) {
          const authCommand = encodeRESPArray(['AUTH', options.password]);
          await writer.write(authCommand);
          await readRESPResponse(reader, 5000);
        }

        // Select database if specified
        if (options.database !== undefined) {
          const selectCommand = encodeRESPArray(['SELECT', options.database.toString()]);
          await writer.write(selectCommand);
          await readRESPResponse(reader, 5000);
        }

        // Execute the user's command
        const command = encodeRESPArray(options.command);
        await writer.write(command);
        const response = await readRESPResponse(reader, timeoutMs);

        await socket.close();

        return {
          success: true,
          response,
          command: options.command,
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
      error: error instanceof Error ? error.message : 'Request failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
