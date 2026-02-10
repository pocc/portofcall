/**
 * RTSP Protocol Implementation (RFC 2326)
 *
 * Real Time Streaming Protocol - an application-level protocol for
 * controlling streaming media servers. Provides VCR-like controls
 * (play, pause, stop, seek) for multimedia streams.
 *
 * Protocol Flow:
 * 1. Client sends OPTIONS to discover server capabilities
 * 2. Client sends DESCRIBE to get stream information (SDP)
 * 3. Client sends SETUP to configure transport
 * 4. Client sends PLAY/PAUSE/TEARDOWN to control playback
 *
 * RTSP is text-based and HTTP-like:
 *   OPTIONS rtsp://server/path RTSP/1.0\r\n
 *   CSeq: 1\r\n
 *   \r\n
 *
 * Use Cases:
 * - IP camera connectivity testing
 * - Video surveillance system probing
 * - Streaming server capability discovery
 * - ONVIF device discovery
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface RtspOptionsRequest {
  host: string;
  port?: number;
  path?: string;
  timeout?: number;
  username?: string;
  password?: string;
}

interface RtspResponse {
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * Parse an RTSP response (HTTP-like format)
 */
function parseRtspResponse(raw: string): RtspResponse {
  const lines = raw.split('\r\n');
  const statusLine = lines[0] || '';

  // Parse status line: RTSP/1.0 200 OK
  const statusMatch = statusLine.match(/^RTSP\/[\d.]+\s+(\d+)\s+(.*)/);
  const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;
  const statusText = statusMatch ? statusMatch[2] : 'Unknown';

  // Parse headers
  const headers: Record<string, string> = {};
  let bodyStartIndex = -1;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') {
      bodyStartIndex = i + 1;
      break;
    }
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim().toLowerCase();
      const value = line.substring(colonIndex + 1).trim();
      headers[key] = value;
    }
  }

  const body = bodyStartIndex >= 0 ? lines.slice(bodyStartIndex).join('\r\n') : '';

  return { statusCode, statusText, headers, body };
}

/**
 * Build a Basic auth header value
 */
function buildBasicAuth(username: string, password: string): string {
  const encoded = btoa(`${username}:${password}`);
  return `Basic ${encoded}`;
}

/**
 * Handle RTSP OPTIONS request - discover server capabilities
 */
export async function handleRtspOptions(request: Request): Promise<Response> {
  try {
    const body = await request.json() as RtspOptionsRequest;
    const { host, port = 554, path = '/', timeout = 10000, username, password } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
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

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      try {
        // Build OPTIONS request
        const rtspUrl = `rtsp://${host}:${port}${path}`;
        let requestStr = `OPTIONS ${rtspUrl} RTSP/1.0\r\n`;
        requestStr += `CSeq: 1\r\n`;
        requestStr += `User-Agent: PortOfCall/1.0\r\n`;

        if (username && password) {
          requestStr += `Authorization: ${buildBasicAuth(username, password)}\r\n`;
        }

        requestStr += `\r\n`;

        await writer.write(encoder.encode(requestStr));

        // Read response
        let responseText = '';
        const readWithTimeout = async (): Promise<string> => {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            responseText += decoder.decode(value, { stream: true });

            // Check if we have a complete response (ends with \r\n\r\n for headers)
            if (responseText.includes('\r\n\r\n')) {
              break;
            }
          }
          return responseText;
        };

        responseText = await readWithTimeout();
        const rtt = Date.now() - startTime;

        // Parse response
        const rtspResponse = parseRtspResponse(responseText);

        // Extract supported methods from Public header
        const publicHeader = rtspResponse.headers['public'] || '';
        const methods = publicHeader.split(',').map((m: string) => m.trim()).filter(Boolean);

        await socket.close();

        return {
          success: rtspResponse.statusCode >= 200 && rtspResponse.statusCode < 400,
          host,
          port,
          path,
          rtt,
          statusCode: rtspResponse.statusCode,
          statusText: rtspResponse.statusText,
          methods,
          serverHeader: rtspResponse.headers['server'] || 'Unknown',
          rawResponse: responseText.substring(0, 2000),
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);

      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 502,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (timeoutError) {
      return new Response(JSON.stringify({
        success: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'Connection timeout',
      }), {
        status: 504,
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
 * Handle RTSP DESCRIBE request - get stream information (SDP)
 */
export async function handleRtspDescribe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as RtspOptionsRequest;
    const { host, port = 554, path = '/', timeout = 10000, username, password } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
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

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      try {
        // Build DESCRIBE request
        const rtspUrl = `rtsp://${host}:${port}${path}`;
        let requestStr = `DESCRIBE ${rtspUrl} RTSP/1.0\r\n`;
        requestStr += `CSeq: 1\r\n`;
        requestStr += `Accept: application/sdp\r\n`;
        requestStr += `User-Agent: PortOfCall/1.0\r\n`;

        if (username && password) {
          requestStr += `Authorization: ${buildBasicAuth(username, password)}\r\n`;
        }

        requestStr += `\r\n`;

        await writer.write(encoder.encode(requestStr));

        // Read response (may include SDP body)
        let responseText = '';
        let headersComplete = false;
        let contentLength = 0;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          responseText += decoder.decode(value, { stream: true });

          // Parse headers to find Content-Length
          if (!headersComplete && responseText.includes('\r\n\r\n')) {
            headersComplete = true;
            const headerSection = responseText.substring(0, responseText.indexOf('\r\n\r\n'));
            const clMatch = headerSection.match(/Content-Length:\s*(\d+)/i);
            contentLength = clMatch ? parseInt(clMatch[1], 10) : 0;
          }

          // Check if we have the full response
          if (headersComplete) {
            const bodyStart = responseText.indexOf('\r\n\r\n') + 4;
            const currentBodyLength = responseText.length - bodyStart;
            if (currentBodyLength >= contentLength) {
              break;
            }
          }
        }

        const rtspResponse = parseRtspResponse(responseText);

        // Parse basic SDP info from body
        const sdpInfo: Record<string, string> = {};
        if (rtspResponse.body) {
          const sdpLines = rtspResponse.body.split('\r\n');
          for (const line of sdpLines) {
            if (line.startsWith('s=')) sdpInfo.sessionName = line.substring(2);
            if (line.startsWith('i=')) sdpInfo.sessionInfo = line.substring(2);
            if (line.startsWith('m=')) {
              if (!sdpInfo.mediaTypes) sdpInfo.mediaTypes = '';
              sdpInfo.mediaTypes += (sdpInfo.mediaTypes ? ', ' : '') + line.substring(2);
            }
            if (line.startsWith('a=control:')) sdpInfo.controlUrl = line.substring(10);
            if (line.startsWith('a=rtpmap:')) {
              if (!sdpInfo.codecs) sdpInfo.codecs = '';
              sdpInfo.codecs += (sdpInfo.codecs ? ', ' : '') + line.substring(9);
            }
          }
        }

        await socket.close();

        return {
          success: rtspResponse.statusCode >= 200 && rtspResponse.statusCode < 400,
          host,
          port,
          path,
          statusCode: rtspResponse.statusCode,
          statusText: rtspResponse.statusText,
          contentType: rtspResponse.headers['content-type'] || '',
          serverHeader: rtspResponse.headers['server'] || 'Unknown',
          sdpInfo,
          sdpRaw: rtspResponse.body.substring(0, 4000),
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);

      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 502,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (timeoutError) {
      return new Response(JSON.stringify({
        success: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'Connection timeout',
      }), {
        status: 504,
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
