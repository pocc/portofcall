/**
 * MySQL Protocol Support for Cloudflare Workers
 * Basic MySQL connectivity and query execution
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

export interface MySQLConnectionOptions {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  timeout?: number;
}

/**
 * Handle MySQL connection test (HTTP mode)
 * Tests basic connectivity to MySQL server
 */
export async function handleMySQLConnect(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let options: Partial<MySQLConnectionOptions>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<MySQLConnectionOptions>;
    } else {
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '3306'),
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
    const port = options.port || 3306;
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
        // Read MySQL handshake packet
        const { value } = await reader.read();

        if (!value || value.length < 5) {
          throw new Error('Invalid MySQL handshake');
        }

        // MySQL handshake starts with packet length + sequence + protocol version
        const protocolVersion = value[4];

        // Extract server version string (null-terminated)
        let serverVersion = '';
        let i = 5;
        while (i < value.length && value[i] !== 0) {
          serverVersion += String.fromCharCode(value[i]);
          i++;
        }

        await socket.close();

        return {
          success: true,
          message: 'MySQL server reachable',
          host,
          port,
          protocolVersion,
          serverVersion,
          note: 'Basic connectivity test. Use query endpoint for database operations.',
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
 * Handle MySQL query execution (simplified)
 * Note: Full MySQL protocol implementation is complex
 * This provides basic connectivity validation
 */
export async function handleMySQLQuery(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        error: 'Method not allowed',
      }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const options = await request.json() as Partial<MySQLConnectionOptions & { query: string }>;

    // Validate required fields
    if (!options.host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    // const port = options.port || 3306; // Not used in current implementation

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

    // For now, return info message about protocol complexity
    return new Response(JSON.stringify({
      success: false,
      error: 'Full MySQL protocol implementation requires complex binary protocol handling. Use connection test for connectivity validation.',
      note: 'MySQL protocol authentication and query execution requires implementing the full MySQL binary protocol, which is beyond basic connectivity testing.',
    }), {
      status: 501,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Query failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
