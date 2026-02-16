/**
 * IDENT Protocol Implementation (RFC 1413)
 *
 * The Identification Protocol (IDENT/auth) allows a server to determine
 * the identity of a user of a particular TCP connection. Historically used
 * by IRC servers and mail servers to verify connecting users.
 *
 * Protocol Flow:
 * 1. Client connects to server port 113
 * 2. Client sends: <server-port>, <client-port>\r\n
 * 3. Server responds with one of:
 *    <server-port>, <client-port> : USERID : <opsys> : <userid>\r\n
 *    <server-port>, <client-port> : ERROR : <error-type>\r\n
 *
 * Error Types: INVALID-PORT, NO-USER, HIDDEN-USER, UNKNOWN-ERROR
 *
 * Use Cases:
 * - IRC server user verification
 * - Mail server sender identification
 * - Network forensics and auditing
 * - Legacy authentication support
 */

import { connect } from 'cloudflare:sockets';

interface IdentRequest {
  host: string;
  port?: number;
  serverPort: number;
  clientPort: number;
  timeout?: number;
}

interface IdentResponse {
  success: boolean;
  host: string;
  serverPort: number;
  clientPort: number;
  responseType?: 'USERID' | 'ERROR';
  operatingSystem?: string;
  userId?: string;
  errorType?: string;
  rawResponse?: string;
  rtt: number;
  error?: string;
}

function parseIdentResponse(raw: string): {
  responseType: 'USERID' | 'ERROR';
  serverPort: number;
  clientPort: number;
  operatingSystem?: string;
  userId?: string;
  errorType?: string;
} {
  // Response format: <server-port>, <client-port> : USERID : <opsys> : <userid>
  //             or: <server-port>, <client-port> : ERROR : <error-type>
  const trimmed = raw.trim();
  const parts = trimmed.split(':').map(s => s.trim());

  if (parts.length < 3) {
    throw new Error(`Malformed IDENT response: ${trimmed}`);
  }

  // Parse port pair
  const portPair = parts[0].split(',').map(s => s.trim());
  if (portPair.length !== 2) {
    throw new Error(`Malformed port pair in IDENT response: ${parts[0]}`);
  }

  const serverPort = parseInt(portPair[0], 10);
  const clientPort = parseInt(portPair[1], 10);

  if (isNaN(serverPort) || isNaN(clientPort)) {
    throw new Error(`Invalid port numbers in IDENT response: ${parts[0]}`);
  }

  const responseType = parts[1].toUpperCase();

  if (responseType === 'USERID') {
    if (parts.length < 4) {
      throw new Error(`Malformed USERID response: ${trimmed}`);
    }
    return {
      responseType: 'USERID',
      serverPort,
      clientPort,
      operatingSystem: parts[2],
      // userId may contain colons, so join remaining parts
      userId: parts.slice(3).join(':').trim(),
    };
  } else if (responseType === 'ERROR') {
    return {
      responseType: 'ERROR',
      serverPort,
      clientPort,
      errorType: parts[2],
    };
  } else {
    throw new Error(`Unknown IDENT response type: ${responseType}`);
  }
}

/**
 * Query an IDENT server for user identification
 */
export async function handleIdentQuery(request: Request): Promise<Response> {
  try {
    const body = await request.json() as IdentRequest;
    const { host, port = 113, serverPort, clientPort, timeout = 10000 } = body;

    // Validation
    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!serverPort || serverPort < 1 || serverPort > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Server port must be between 1 and 65535'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!clientPort || clientPort < 1 || clientPort > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Client port must be between 1 and 65535'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'IDENT port must be between 1 and 65535'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const startTime = Date.now();

    // Connect to IDENT server
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([
        socket.opened,
        timeoutPromise
      ]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send IDENT query: <server-port>, <client-port>\r\n
      const query = `${serverPort}, ${clientPort}\r\n`;
      await writer.write(new TextEncoder().encode(query));

      // Read response
      const { value: responseBytes } = await Promise.race([
        reader.read(),
        timeoutPromise
      ]);

      if (!responseBytes) {
        throw new Error('No response received from IDENT server');
      }

      const rawResponse = new TextDecoder().decode(responseBytes);
      const rtt = Date.now() - startTime;

      // Parse the response
      const parsed = parseIdentResponse(rawResponse);

      // Clean up
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const response: IdentResponse = {
        success: true,
        host,
        serverPort: parsed.serverPort,
        clientPort: parsed.clientPort,
        responseType: parsed.responseType,
        rawResponse: rawResponse.trim(),
        rtt,
      };

      if (parsed.responseType === 'USERID') {
        response.operatingSystem = parsed.operatingSystem;
        response.userId = parsed.userId;
      } else {
        response.errorType = parsed.errorType;
      }

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      socket.close();
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      host: '',
      serverPort: 0,
      clientPort: 0,
      rtt: 0
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
