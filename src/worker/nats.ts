/**
 * NATS Protocol Support for Cloudflare Workers
 * Implements the NATS text-based messaging protocol
 *
 * NATS is an ultra-fast pub/sub messaging system.
 * Protocol: text-based, newline-delimited commands (\r\n)
 * Default port: 4222
 *
 * Connection flow:
 *   Server -> Client: INFO {...}\r\n
 *   Client -> Server: CONNECT {...}\r\n
 *   Server -> Client: +OK\r\n (if verbose)
 *   Client <-> Server: PUB/SUB/MSG/PING/PONG
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/**
 * Read data from socket with timeout
 */
async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<string> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Read timeout')), timeoutMs)
  );

  const readPromise = (async () => {
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += new TextDecoder().decode(value);
      if (buffer.includes('\r\n')) {
        return buffer;
      }
    }
    return buffer;
  })();

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Handle NATS connection test (HTTP mode)
 * Connects, reads INFO, sends CONNECT + PING, verifies PONG
 */
export async function handleNATSConnect(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let host: string;
    let port: number;
    let user: string | undefined;
    let pass: string | undefined;
    let token: string | undefined;
    let timeoutMs: number;

    if (request.method === 'POST') {
      const body = await request.json() as {
        host?: string;
        port?: number;
        user?: string;
        pass?: string;
        token?: string;
        timeout?: number;
      };
      host = body.host || '';
      port = body.port || 4222;
      user = body.user || undefined;
      pass = body.pass || undefined;
      token = body.token || undefined;
      timeoutMs = body.timeout || 30000;
    } else {
      host = url.searchParams.get('host') || '';
      port = parseInt(url.searchParams.get('port') || '4222');
      user = url.searchParams.get('user') || undefined;
      pass = url.searchParams.get('pass') || undefined;
      token = url.searchParams.get('token') || undefined;
      timeoutMs = parseInt(url.searchParams.get('timeout') || '30000');
    }

    if (!host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Step 1: Read INFO from server
        const infoLine = await readWithTimeout(reader, 5000);

        if (!infoLine.startsWith('INFO ')) {
          throw new Error('Expected INFO from server, got: ' + infoLine.substring(0, 100));
        }

        // Parse the INFO JSON
        const infoJsonStr = infoLine.substring(5, infoLine.indexOf('\r\n'));
        let serverInfo: Record<string, unknown>;
        try {
          serverInfo = JSON.parse(infoJsonStr);
        } catch {
          throw new Error('Invalid INFO JSON from server');
        }

        // Step 2: Send CONNECT
        const connectInfo: Record<string, unknown> = {
          verbose: true,
          pedantic: false,
          tls_required: false,
          name: 'portofcall',
          lang: 'javascript',
          version: '1.0.0',
          protocol: 1,
        };

        if (token) {
          connectInfo.auth_token = token;
        } else if (user && pass) {
          connectInfo.user = user;
          connectInfo.pass = pass;
        }

        const connectCmd = `CONNECT ${JSON.stringify(connectInfo)}\r\n`;
        await writer.write(new TextEncoder().encode(connectCmd));

        // Step 3: Read +OK response (verbose mode)
        const connectResponse = await readWithTimeout(reader, 5000);

        if (connectResponse.includes('-ERR')) {
          const errMatch = connectResponse.match(/-ERR\s+'?([^'\r\n]+)'?/);
          throw new Error('NATS error: ' + (errMatch ? errMatch[1] : connectResponse));
        }

        // Step 4: Send PING to verify connection
        await writer.write(new TextEncoder().encode('PING\r\n'));
        const pingResponse = await readWithTimeout(reader, 5000);

        if (!pingResponse.includes('PONG')) {
          throw new Error('Expected PONG, got: ' + pingResponse.substring(0, 100));
        }

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return {
          success: true,
          message: 'NATS server reachable',
          host,
          port,
          serverInfo: {
            server_id: serverInfo.server_id,
            version: serverInfo.version,
            go: serverInfo.go,
            max_payload: serverInfo.max_payload,
            proto: serverInfo.proto,
            host: serverInfo.host,
            port: serverInfo.port,
            auth_required: serverInfo.auth_required || false,
            tls_required: serverInfo.tls_required || false,
            jetstream: serverInfo.jetstream || false,
          },
        };
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
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
 * Handle NATS publish (HTTP mode)
 * Connects, authenticates, publishes a message, then disconnects
 */
export async function handleNATSPublish(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      user?: string;
      pass?: string;
      token?: string;
      subject: string;
      payload?: string;
      timeout?: number;
    };

    if (!body.host || !body.subject) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: host and subject',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = body.host;
    const port = body.port || 4222;
    const timeoutMs = body.timeout || 30000;

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
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Read INFO
        const infoLine = await readWithTimeout(reader, 5000);
        if (!infoLine.startsWith('INFO ')) {
          throw new Error('Expected INFO from server');
        }

        // Send CONNECT (non-verbose for publish)
        const connectInfo: Record<string, unknown> = {
          verbose: false,
          pedantic: false,
          tls_required: false,
          name: 'portofcall',
          lang: 'javascript',
          version: '1.0.0',
          protocol: 1,
        };

        if (body.token) {
          connectInfo.auth_token = body.token;
        } else if (body.user && body.pass) {
          connectInfo.user = body.user;
          connectInfo.pass = body.pass;
        }

        await writer.write(new TextEncoder().encode(`CONNECT ${JSON.stringify(connectInfo)}\r\n`));

        // Build and send PUB command
        const payloadBytes = new TextEncoder().encode(body.payload || '');
        const pubCmd = `PUB ${body.subject} ${payloadBytes.length}\r\n`;
        const pubHeader = new TextEncoder().encode(pubCmd);
        const trailer = new TextEncoder().encode('\r\n');

        const frame = new Uint8Array(pubHeader.length + payloadBytes.length + trailer.length);
        frame.set(pubHeader);
        frame.set(payloadBytes, pubHeader.length);
        frame.set(trailer, pubHeader.length + payloadBytes.length);
        await writer.write(frame);

        // Send PING to flush and verify
        await writer.write(new TextEncoder().encode('PING\r\n'));
        const pingResponse = await readWithTimeout(reader, 5000);

        if (pingResponse.includes('-ERR')) {
          const errMatch = pingResponse.match(/-ERR\s+'?([^'\r\n]+)'?/);
          throw new Error('NATS error: ' + (errMatch ? errMatch[1] : pingResponse));
        }

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return {
          success: true,
          message: `Published to ${body.subject}`,
          subject: body.subject,
          payloadSize: payloadBytes.length,
        };
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
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
      error: error instanceof Error ? error.message : 'Publish failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
