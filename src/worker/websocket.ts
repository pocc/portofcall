/**
 * WebSocket Protocol Implementation (RFC 6455)
 * Port: 80 (ws://), 443 (wss://)
 *
 * Performs WebSocket handshake probe via raw TCP:
 * 1. Sends HTTP/1.1 Upgrade request
 * 2. Validates 101 Switching Protocols response
 * 3. Verifies Sec-WebSocket-Accept hash
 * 4. Optionally sends a ping frame and checks for pong
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/**
 * Generate a random 16-byte WebSocket key, base64-encoded
 */
function generateWebSocketKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Manual base64 encoding
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    result += chars[(b0 >> 2) & 0x3f];
    result += chars[((b0 << 4) | (b1 >> 4)) & 0x3f];
    if (i + 1 < bytes.length) {
      result += chars[((b1 << 2) | (b2 >> 6)) & 0x3f];
    } else {
      result += '=';
    }
    if (i + 2 < bytes.length) {
      result += chars[b2 & 0x3f];
    } else {
      result += '=';
    }
  }
  return result;
}

/**
 * Compute expected Sec-WebSocket-Accept value per RFC 6455
 * Accept = base64(SHA-1(key + GUID))
 */
async function computeAcceptKey(wsKey: string): Promise<string> {
  const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
  const combined = wsKey + GUID;
  const encoded = new TextEncoder().encode(combined);
  const hash = await crypto.subtle.digest('SHA-1', encoded);
  const hashBytes = new Uint8Array(hash);

  // Base64 encode
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < hashBytes.length; i += 3) {
    const b0 = hashBytes[i];
    const b1 = i + 1 < hashBytes.length ? hashBytes[i + 1] : 0;
    const b2 = i + 2 < hashBytes.length ? hashBytes[i + 2] : 0;
    result += chars[(b0 >> 2) & 0x3f];
    result += chars[((b0 << 4) | (b1 >> 4)) & 0x3f];
    if (i + 1 < hashBytes.length) {
      result += chars[((b1 << 2) | (b2 >> 6)) & 0x3f];
    } else {
      result += '=';
    }
    if (i + 2 < hashBytes.length) {
      result += chars[b2 & 0x3f];
    } else {
      result += '=';
    }
  }
  return result;
}

/**
 * Parse HTTP response headers from raw bytes
 */
function parseHTTPResponse(data: string): {
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
} {
  const lines = data.split('\r\n');
  const statusLine = lines[0];
  const match = statusLine.match(/^HTTP\/(\d\.\d)\s+(\d+)\s+(.*)/);

  if (!match) {
    throw new Error('Invalid HTTP response');
  }

  const statusCode = parseInt(match[2]);
  const statusText = match[3];

  const headers: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '') break;
    const colonIdx = lines[i].indexOf(':');
    if (colonIdx > 0) {
      const key = lines[i].substring(0, colonIdx).trim().toLowerCase();
      const value = lines[i].substring(colonIdx + 1).trim();
      headers[key] = value;
    }
  }

  return { statusCode, statusText, headers };
}

/**
 * Build a WebSocket ping frame (masked, as required for client-to-server)
 */
function buildPingFrame(payload: string): Uint8Array {
  const payloadBytes = new TextEncoder().encode(payload);
  const maskKey = new Uint8Array(4);
  crypto.getRandomValues(maskKey);

  const frame: number[] = [];

  // FIN=1, RSV=0, opcode=0x9 (ping)
  frame.push(0x89);

  // MASK=1 (client must mask), payload length
  if (payloadBytes.length < 126) {
    frame.push(0x80 | payloadBytes.length);
  } else {
    frame.push(0x80 | 126);
    frame.push((payloadBytes.length >> 8) & 0xff);
    frame.push(payloadBytes.length & 0xff);
  }

  // Masking key
  frame.push(maskKey[0], maskKey[1], maskKey[2], maskKey[3]);

  // Masked payload
  for (let i = 0; i < payloadBytes.length; i++) {
    frame.push(payloadBytes[i] ^ maskKey[i % 4]);
  }

  return new Uint8Array(frame);
}

/**
 * Parse a WebSocket frame header
 */
function parseFrameHeader(data: Uint8Array): {
  fin: boolean;
  opcode: number;
  masked: boolean;
  payloadLength: number;
  headerLength: number;
} | null {
  if (data.length < 2) return null;

  const fin = (data[0] & 0x80) !== 0;
  const opcode = data[0] & 0x0f;
  const masked = (data[1] & 0x80) !== 0;
  let payloadLength = data[1] & 0x7f;
  let headerLength = 2;

  if (payloadLength === 126) {
    if (data.length < 4) return null;
    payloadLength = (data[2] << 8) | data[3];
    headerLength = 4;
  } else if (payloadLength === 127) {
    if (data.length < 10) return null;
    const hi = (data[2] << 24) | (data[3] << 16) | (data[4] << 8) | data[5];
    const lo = (data[6] << 24) | (data[7] << 16) | (data[8] << 8) | data[9];
    if (hi !== 0) throw new Error('WebSocket frame payload exceeds 4GB');
    payloadLength = lo >>> 0;
    headerLength = 10;
  }

  if (masked) {
    headerLength += 4; // masking key
  }

  return { fin, opcode, masked, payloadLength, headerLength };
}

const OPCODE_NAMES: Record<number, string> = {
  0x0: 'Continuation',
  0x1: 'Text',
  0x2: 'Binary',
  0x8: 'Close',
  0x9: 'Ping',
  0xa: 'Pong',
};

/**
 * Read data from socket with timeout
 */
async function readWithTimeout(reader: ReadableStreamDefaultReader<Uint8Array>, timeout: number): Promise<Uint8Array | null> {
  const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout));
  const readPromise = reader.read().then(({ value, done }) => {
    if (done) return null;
    return value || null;
  });

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Handle WebSocket Probe - test WebSocket upgrade handshake
 * POST /api/websocket/probe
 */
export async function handleWebSocketProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.json<{
      host?: string;
      port?: number;
      path?: string;
      protocols?: string;
      sendPing?: boolean;
      timeout?: number;
    }>();

    if (!body.host) {
      return Response.json({ success: false, error: 'Host is required' }, { status: 400 });
    }

    const port = body.port || 80;
    if (port < 1 || port > 65535) {
      return Response.json({ success: false, error: 'Port must be between 1 and 65535' }, { status: 400 });
    }

    const path = body.path || '/';
    const timeout = body.timeout || 10000;

    // Check for Cloudflare
    const cfCheck = await checkIfCloudflare(body.host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return Response.json({
        success: false,
        error: getCloudflareErrorMessage(body.host, cfCheck.ip),
        isCloudflare: true,
      }, { status: 403 });
    }

    const connectStart = Date.now();
    const socket = connect(`${body.host}:${port}`);
    await socket.opened;
    const connectTimeMs = Date.now() - connectStart;

    try {
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Generate WebSocket key
        const wsKey = generateWebSocketKey();

        // Build HTTP Upgrade request
        let httpRequest = `GET ${path} HTTP/1.1\r\n`;
        httpRequest += `Host: ${body.host}${port !== 80 && port !== 443 ? ':' + port : ''}\r\n`;
        httpRequest += `Upgrade: websocket\r\n`;
        httpRequest += `Connection: Upgrade\r\n`;
        httpRequest += `Sec-WebSocket-Key: ${wsKey}\r\n`;
        httpRequest += `Sec-WebSocket-Version: 13\r\n`;
        httpRequest += `Origin: http://${body.host}\r\n`;
        if (body.protocols) {
          httpRequest += `Sec-WebSocket-Protocol: ${body.protocols}\r\n`;
        }
        httpRequest += `\r\n`;

        // Send upgrade request
        await writer.write(new TextEncoder().encode(httpRequest));

        // Read response
        const responseData = await readWithTimeout(reader, timeout);
        const totalTimeMs = Date.now() - connectStart;

        if (!responseData) {
          return Response.json({
            success: false,
            error: 'No response from server (timeout)',
            connectTimeMs,
            totalTimeMs,
          });
        }

        const responseText = new TextDecoder().decode(responseData);

        // Check if it looks like HTTP
        if (!responseText.startsWith('HTTP/')) {
          return Response.json({
            success: false,
            error: 'Non-HTTP response received - server may not support WebSocket',
            rawResponse: responseText.substring(0, 200),
            connectTimeMs,
            totalTimeMs,
          });
        }

        // Parse HTTP response
        const httpResponse = parseHTTPResponse(responseText);

        // Compute expected accept key
        const expectedAccept = await computeAcceptKey(wsKey);
        const actualAccept = httpResponse.headers['sec-websocket-accept'] || '';
        const acceptValid = actualAccept === expectedAccept;

        const upgradeOk = httpResponse.statusCode === 101;
        const upgradeHeader = httpResponse.headers['upgrade']?.toLowerCase() === 'websocket';
        const connectionHeader = httpResponse.headers['connection']?.toLowerCase().includes('upgrade');

        const result: Record<string, unknown> = {
          success: upgradeOk,
          host: body.host,
          port,
          path,
          statusCode: httpResponse.statusCode,
          statusText: httpResponse.statusText,
          websocketUpgrade: upgradeOk && upgradeHeader && connectionHeader,
          acceptKeyValid: acceptValid,
          serverHeaders: httpResponse.headers,
          negotiatedProtocol: httpResponse.headers['sec-websocket-protocol'] || null,
          negotiatedExtensions: httpResponse.headers['sec-websocket-extensions'] || null,
          server: httpResponse.headers['server'] || null,
          connectTimeMs,
          totalTimeMs,
        };

        // Optionally send a ping after successful upgrade
        if (upgradeOk && body.sendPing) {
          try {
            const pingPayload = 'portofcall-ping';
            const pingFrame = buildPingFrame(pingPayload);
            await writer.write(pingFrame);

            const pongData = await readWithTimeout(reader, 5000);

            if (pongData) {
              const frameHeader = parseFrameHeader(pongData);
              if (frameHeader) {
                result.pingResponse = {
                  received: true,
                  opcode: frameHeader.opcode,
                  opcodeName: OPCODE_NAMES[frameHeader.opcode] || `Unknown (0x${frameHeader.opcode.toString(16)})`,
                  fin: frameHeader.fin,
                  payloadLength: frameHeader.payloadLength,
                  isPong: frameHeader.opcode === 0xa,
                };
              } else {
                result.pingResponse = { received: true, parseError: 'Could not parse frame' };
              }
            } else {
              result.pingResponse = { received: false, error: 'No pong response (timeout)' };
            }
          } catch {
            result.pingResponse = { received: false, error: 'Ping failed' };
          }
        }

        return Response.json(result);
      } finally {
        reader.releaseLock();
        writer.releaseLock();
      }
    } finally {
      await socket.close().catch(() => {});
    }
  } catch (error) {
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'WebSocket probe failed',
    }, { status: 500 });
  }
}
