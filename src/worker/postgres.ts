/**
 * PostgreSQL Protocol Support for Cloudflare Workers
 * Basic PostgreSQL connectivity testing
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

export interface PostgreSQLConnectionOptions {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  timeout?: number;
}

/**
 * Handle PostgreSQL connection test (HTTP mode)
 * Tests basic connectivity to PostgreSQL server
 */
export async function handlePostgreSQLConnect(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let options: Partial<PostgreSQLConnectionOptions>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<PostgreSQLConnectionOptions>;
    } else {
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '5432'),
        username: url.searchParams.get('username') || undefined,
        password: url.searchParams.get('password') || undefined,
        database: url.searchParams.get('database') || undefined,
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
    const port = options.port || 5432;
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

      try {
        // PostgreSQL startup message
        // Protocol 3.0: Send startup message
        const startupMessage = new Uint8Array([
          0, 0, 0, 0, // Length placeholder
          0, 3, 0, 0, // Protocol version 3.0
          // Parameters: user, database, etc. (null-terminated key-value pairs)
          ...new TextEncoder().encode('user\0'),
          ...new TextEncoder().encode((options.username || 'postgres') + '\0'),
          ...new TextEncoder().encode('database\0'),
          ...new TextEncoder().encode((options.database || 'postgres') + '\0'),
          0, // End of parameters
        ]);

        // Set correct length
        const length = startupMessage.length;
        startupMessage[0] = (length >> 24) & 0xFF;
        startupMessage[1] = (length >> 16) & 0xFF;
        startupMessage[2] = (length >> 8) & 0xFF;
        startupMessage[3] = length & 0xFF;

        // Note: Full authentication would require password hashing and challenge-response
        // For now, just test connectivity by reading server response

        // Read server response
        const { value } = await reader.read();

        if (!value || value.length < 1) {
          throw new Error('Invalid PostgreSQL response');
        }

        // PostgreSQL message type is first byte
        const messageType = String.fromCharCode(value[0]);

        // Common message types:
        // 'R' = Authentication request
        // 'E' = Error response
        // 'N' = Notice response

        let serverInfo = `Message type: ${messageType}`;

        if (messageType === 'E') {
          // Error response - extract error message
          serverInfo = 'Server responded with error (likely auth required)';
        } else if (messageType === 'R') {
          serverInfo = 'Server ready for authentication';
        }

        await socket.close();

        return {
          success: true,
          message: 'PostgreSQL server reachable',
          host,
          port,
          serverInfo,
          note: 'Basic connectivity test. Full authentication requires password hashing.',
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
