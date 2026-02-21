/**
 * Raw TCP Send/Receive
 *
 * A generic TCP probe: connect to any host:port, optionally send data,
 * and capture whatever the server sends back.
 *
 * Complements /api/ping (handshake-only) and /api/echo/test (echo verification).
 * Useful for banner grabbing, probing unknown services, or testing protocols
 * that speak first (SMTP, FTP, SSH, etc.).
 *
 * Endpoints:
 *   POST /api/tcp/send  — connect, send (optional), receive response
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface TcpSendRequest {
  host: string;
  port: number;
  /** Data to send after connecting. Omit or leave empty to just capture the server's banner. */
  data?: string;
  /** Encoding of `data` and the returned `received` string. Default: "utf8" */
  encoding?: 'utf8' | 'hex';
  /** How long to wait for data (ms). Default: 10000 */
  timeout?: number;
  /** Maximum bytes to read. Default: 4096 */
  maxBytes?: number;
}

/**
 * POST /api/tcp/send
 *
 * Connect to host:port, optionally write `data`, then read whatever the server
 * sends back within `timeout` ms.
 *
 * Request body:
 *   { host, port, data?, encoding?, timeout?, maxBytes? }
 *
 * Response:
 *   { success, host, port, sent, received, receivedHex, bytesReceived, rtt, connectMs }
 */
export async function handleTcpSend(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const start = Date.now();

  try {
    const body = (await request.json()) as TcpSendRequest;
    const {
      host,
      port,
      data = '',
      encoding = 'utf8',
      timeout = 10000,
      maxBytes = 4096,
    } = body;

    // Validation
    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!port || port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (encoding !== 'utf8' && encoding !== 'hex') {
      return new Response(
        JSON.stringify({ success: false, error: 'Encoding must be "utf8" or "hex"' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (maxBytes < 1 || maxBytes > 65536) {
      return new Response(
        JSON.stringify({ success: false, error: 'maxBytes must be between 1 and 65536' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Cloudflare protection check
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Connect
    const connectStart = Date.now();
    const socket = connect(`${host}:${port}`);

    const connectTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Connection timeout after ${timeout}ms`)), timeout),
    );
    await Promise.race([socket.opened, connectTimeout]);
    const connectMs = Date.now() - connectStart;

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // Decode and send data if provided
    let sentBytes = 0;
    let sentDisplay = '';
    if (data) {
      let sendBuf: Uint8Array;
      if (encoding === 'hex') {
        const hex = data.replace(/\s/g, '');
        sendBuf = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
          sendBuf[i / 2] = parseInt(hex.slice(i, i + 2), 16);
        }
        sentDisplay = data;
      } else {
        sendBuf = new TextEncoder().encode(data);
        sentDisplay = data;
      }
      await writer.write(sendBuf);
      sentBytes = sendBuf.length;
    }

    // Read response until timeout or maxBytes
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      const readTimeout = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), timeout),
      );

      while (totalBytes < maxBytes) {
        if (totalBytes >= maxBytes) break;
        const remaining = maxBytes - totalBytes;
        const readResult = await Promise.race([
          reader.read(),
          readTimeout.then(() => ({ done: true as const, value: undefined })),
        ]);

        if (readResult.done || !readResult.value) break;

        const chunk = readResult.value.slice(0, remaining);
        chunks.push(chunk);
        totalBytes += chunk.length;
      }
    } catch {
      // Partial read is fine
    }

    await writer.close().catch(() => {});
    await socket.close().catch(() => {});

    // Combine chunks
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    const receivedHex = Array.from(combined)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const receivedUtf8 = new TextDecoder('utf-8', { fatal: false }).decode(combined);

    return new Response(
      JSON.stringify({
        success: true,
        host,
        port,
        sent: sentDisplay,
        sentBytes,
        received: encoding === 'hex' ? receivedHex : receivedUtf8,
        receivedHex,
        receivedUtf8,
        bytesReceived: totalBytes,
        rtt: Date.now() - start,
        connectMs,
        encoding,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'TCP connection failed',
        rtt: Date.now() - start,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
