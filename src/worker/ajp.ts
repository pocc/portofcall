/**
 * AJP (Apache JServ Protocol) Support for Cloudflare Workers
 * Implements AJP/1.3 CPing/CPong connectivity testing
 *
 * AJP is a binary protocol used to proxy requests from a web server
 * (Apache, Nginx) to an application server (Tomcat, Jetty).
 *
 * CPing/CPong handshake:
 * 1. Client sends CPing: 0x1234 (magic) + 0x0001 (length) + 0x0A (CPing type)
 * 2. Server responds CPong: 0x4142 (magic "AB") + 0x0001 (length) + 0x09 (CPong type)
 *
 * Spec: https://tomcat.apache.org/connectors-doc/ajp/ajpv13a.html
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/**
 * AJP CPing packet (Server → Container)
 * Magic: 0x1234, Length: 0x0001, Type: 0x0A (CPing)
 */
const AJP_CPING = new Uint8Array([0x12, 0x34, 0x00, 0x01, 0x0A]);

/**
 * Expected CPong response (Container → Server)
 * Magic: 0x4142 ("AB"), Length: 0x0001, Type: 0x09 (CPong)
 */
const AJP_CPONG_EXPECTED = new Uint8Array([0x41, 0x42, 0x00, 0x01, 0x09]);

/** Read exactly N bytes from a socket */
async function readExact(reader: ReadableStreamDefaultReader<Uint8Array>, n: number): Promise<Uint8Array> {
  const buffer = new Uint8Array(n);
  let offset = 0;
  while (offset < n) {
    const { value, done } = await reader.read();
    if (done || !value) throw new Error('Connection closed unexpectedly');
    const toCopy = Math.min(n - offset, value.length);
    buffer.set(value.subarray(0, toCopy), offset);
    offset += toCopy;
  }
  return buffer;
}

/**
 * Handle AJP CPing/CPong connectivity test
 * POST /api/ajp/connect
 *
 * Sends a CPing packet and validates the CPong response to confirm
 * that an AJP connector (e.g., Tomcat) is listening and responsive.
 */
export async function handleAJPConnect(request: Request): Promise<Response> {
  try {
    const { host, port = 8009, timeout = 10000 } = await request.json<{
      host: string;
      port?: number;
      timeout?: number;
    }>();

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
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        const start = Date.now();

        // Step 1: Send CPing packet
        await writer.write(AJP_CPING);

        // Step 2: Read CPong response (5 bytes)
        const response = await readExact(reader, 5);
        const rtt = Date.now() - start;

        // Step 3: Validate CPong
        const magic = (response[0] << 8) | response[1];
        const length = (response[2] << 8) | response[3];
        const messageType = response[4];

        const isValidCPong =
          response[0] === AJP_CPONG_EXPECTED[0] &&
          response[1] === AJP_CPONG_EXPECTED[1] &&
          response[2] === AJP_CPONG_EXPECTED[2] &&
          response[3] === AJP_CPONG_EXPECTED[3] &&
          response[4] === AJP_CPONG_EXPECTED[4];

        await socket.close();

        if (isValidCPong) {
          return {
            success: true,
            host,
            port,
            protocol: 'AJP/1.3',
            rtt,
            cpong: true,
            message: `AJP connector responded with valid CPong in ${rtt}ms`,
          };
        }

        // Invalid response — still report what we got
        return {
          success: false,
          host,
          port,
          rtt,
          error: `Unexpected response: magic=0x${magic.toString(16).padStart(4, '0')}, length=${length}, type=0x${messageType.toString(16).padStart(2, '0')}`,
          rawHex: Array.from(response).map(b => b.toString(16).padStart(2, '0')).join(' '),
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
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
