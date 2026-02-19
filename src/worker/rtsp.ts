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
 * 4. Client sends PLAY to start streaming
 * 5. Client receives interleaved RTP/RTCP frames
 * 6. Client sends TEARDOWN to end session
 *
 * RTSP is text-based and HTTP-like:
 *   OPTIONS rtsp://server/path RTSP/1.0\r\n
 *   CSeq: 1\r\n
 *   \r\n
 *
 * Interleaved binary data (TCP transport):
 *   [0x24 '$'][channel 1B][length 2B][RTP/RTCP data]
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
  url?: string;
  timeout?: number;
  timeout_ms?: number;
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

  const statusMatch = statusLine.match(/^RTSP\/[\d.]+\s+(\d+)\s+(.*)/);
  const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;
  const statusText = statusMatch ? statusMatch[2] : 'Unknown';

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
 * Read an RTSP text response from the socket.
 * Reads until the complete headers (and optional body) are received.
 */
async function readRtspTextResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  timeoutPromise: Promise<never>,
): Promise<string> {
  let responseText = '';
  let headersComplete = false;
  let contentLength = 0;

  while (true) {
    const result = await Promise.race([reader.read(), timeoutPromise]);
    if (result.done || !result.value) break;
    responseText += decoder.decode(result.value, { stream: true });

    if (!headersComplete && responseText.includes('\r\n\r\n')) {
      headersComplete = true;
      const headerSection = responseText.substring(0, responseText.indexOf('\r\n\r\n'));
      const clMatch = headerSection.match(/Content-Length:\s*(\d+)/i);
      contentLength = clMatch ? parseInt(clMatch[1], 10) : 0;
    }

    if (headersComplete) {
      const bodyStart = responseText.indexOf('\r\n\r\n') + 4;
      const currentBodyLength = responseText.length - bodyStart;
      if (currentBodyLength >= contentLength) break;
    }
  }

  return responseText;
}

/**
 * Parse SDP body to extract track control URLs.
 * Returns array of track control paths.
 */
function parseSdpTracks(sdpBody: string): string[] {
  const tracks: string[] = [];
  const lines = sdpBody.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('a=control:')) {
      const ctrl = line.substring(10).trim();
      if (ctrl && ctrl !== '*') {
        tracks.push(ctrl);
      }
    }
  }
  return tracks;
}

/**
 * Collect interleaved RTP/RTCP frames for a brief window.
 * Interleaved frame: [0x24 '$'][channel 1B][length 2B][data]
 * Returns packet count and total bytes received.
 */
async function collectRtpFrames(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  durationMs: number,
): Promise<{ packetCount: number; rtpBytes: number; rtcpPackets: number }> {
  let packetCount = 0;
  let rtpBytes = 0;
  let rtcpPackets = 0;

  const deadline = Date.now() + durationMs;
  let buffer = new Uint8Array(0);

  const appendBuf = (d: Uint8Array) => {
    const m = new Uint8Array(buffer.length + d.length);
    m.set(buffer, 0);
    m.set(d, buffer.length);
    buffer = m;
  };

  try {
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      const timeoutPromise = new Promise<{ done: boolean; value?: Uint8Array }>((resolve) =>
        setTimeout(() => resolve({ done: true }), remaining)
      );

      const result = await Promise.race([reader.read(), timeoutPromise]);
      if (result.done || !result.value) break;

      appendBuf(result.value);

      // Parse as many complete interleaved frames as possible
      while (buffer.length >= 4) {
        if (buffer[0] !== 0x24) {
          // Not an interleaved frame - skip one byte and try again
          buffer = buffer.slice(1);
          continue;
        }
        const channel = buffer[1];
        const frameLen = (buffer[2] << 8) | buffer[3];
        if (buffer.length < 4 + frameLen) break;

        packetCount++;
        rtpBytes += frameLen;
        if (channel === 1 || channel === 3) rtcpPackets++; // odd channels = RTCP

        buffer = buffer.slice(4 + frameLen);
      }
    }
  } catch {
    // Timeout or read error — return what we have
  }

  return { packetCount, rtpBytes, rtcpPackets };
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
        const rtspUrl = `rtsp://${host}:${port}${path}`;
        let requestStr = `OPTIONS ${rtspUrl} RTSP/1.0\r\n`;
        requestStr += `CSeq: 1\r\n`;
        requestStr += `User-Agent: PortOfCall/1.0\r\n`;
        if (username && password) {
          requestStr += `Authorization: ${buildBasicAuth(username, password)}\r\n`;
        }
        requestStr += `\r\n`;

        await writer.write(encoder.encode(requestStr));

        const responseText = await readRtspTextResponse(reader, decoder, timeoutPromise);
        const rtt = Date.now() - startTime;
        const rtspResponse = parseRtspResponse(responseText);

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

        const responseText = await readRtspTextResponse(reader, decoder, timeoutPromise);
        const rtspResponse = parseRtspResponse(responseText);

        const sdpInfo: Record<string, string | string[]> = {};
        if (rtspResponse.body) {
          const sdpLines = rtspResponse.body.split('\r\n');
          const controlUrls: string[] = [];
          for (const line of sdpLines) {
            if (line.startsWith('s=')) sdpInfo.sessionName = line.substring(2);
            if (line.startsWith('i=')) sdpInfo.sessionInfo = line.substring(2);
            if (line.startsWith('m=')) {
              if (!sdpInfo.mediaTypes) sdpInfo.mediaTypes = '';
              sdpInfo.mediaTypes += ((sdpInfo.mediaTypes as string) ? ', ' : '') + line.substring(2);
            }
            if (line.startsWith('a=control:')) {
              const ctrl = line.substring(10).trim();
              if (ctrl && ctrl !== '*') {
                controlUrls.push(ctrl);
              }
            }
            if (line.startsWith('a=rtpmap:')) {
              if (!sdpInfo.codecs) sdpInfo.codecs = '';
              sdpInfo.codecs += ((sdpInfo.codecs as string) ? ', ' : '') + line.substring(9);
            }
          }
          // Keep first track's control URL as primary (usually video)
          if (controlUrls.length > 0) {
            sdpInfo.controlUrl = controlUrls[0];
          }
          // Expose all track control URLs
          sdpInfo.controlUrls = controlUrls;
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

/**
 * Handle a full RTSP session: OPTIONS -> DESCRIBE -> SETUP -> PLAY -> collect frames -> TEARDOWN
 * POST /api/rtsp/session
 *
 * Performs the complete RTSP session lifecycle over TCP with interleaved RTP/RTCP.
 * Collects RTP frames for 500ms after PLAY, then tears down gracefully.
 *
 * Request body JSON: { host, port?, path?, url?, username?, password?, timeout_ms? }
 */
export async function handleRTSPSession(request: Request): Promise<Response> {
  try {
    const body = await request.json() as RtspOptionsRequest;
    const {
      host,
      port = 554,
      path = '/',
      url: explicitUrl,
      username,
      password,
      timeout_ms = 15000,
    } = body;

    const timeout = timeout_ms;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
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

    const overallTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Session timeout')), timeout)
    );

    const sessionPromise = (async () => {
      const startTime = Date.now();
      const rtspUrl = explicitUrl || `rtsp://${host}:${port}${path}`;

      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      const steps: string[] = [];
      let cseq = 1;
      let sessionId: string | null = null;
      let trackUrl: string | null = null;
      let rtpFrames = { packetCount: 0, rtpBytes: 0, rtcpPackets: 0 };

      const sendRequest = async (method: string, url: string, extraHeaders: string = ''): Promise<RtspResponse> => {
        let req = `${method} ${url} RTSP/1.0\r\n`;
        req += `CSeq: ${cseq++}\r\n`;
        req += `User-Agent: PortOfCall/1.0\r\n`;
        if (username && password) {
          req += `Authorization: ${buildBasicAuth(username, password)}\r\n`;
        }
        if (sessionId) {
          req += `Session: ${sessionId}\r\n`;
        }
        req += extraHeaders;
        req += `\r\n`;

        await writer.write(encoder.encode(req));

        const stepTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`${method} response timeout`)), 5000)
        );
        const responseText = await readRtspTextResponse(reader, decoder, stepTimeout);
        return parseRtspResponse(responseText);
      };

      try {
        // Step 1: OPTIONS
        const optionsResp = await sendRequest('OPTIONS', rtspUrl);
        steps.push(`OPTIONS: ${optionsResp.statusCode} ${optionsResp.statusText}`);
        const methods = (optionsResp.headers['public'] || '').split(',').map(m => m.trim()).filter(Boolean);

        // Step 2: DESCRIBE
        let describeResp: RtspResponse | null = null;
        let sdpBody = '';
        if (optionsResp.statusCode >= 200 && optionsResp.statusCode < 400) {
          let descReq = `Accept: application/sdp\r\n`;
          describeResp = await sendRequest('DESCRIBE', rtspUrl, descReq);
          steps.push(`DESCRIBE: ${describeResp.statusCode} ${describeResp.statusText}`);
          sdpBody = describeResp.body || '';

          // Parse track control URLs from SDP
          const tracks = parseSdpTracks(sdpBody);
          if (tracks.length > 0) {
            const firstTrack = tracks[0];
            // Build full track URL
            if (firstTrack.startsWith('rtsp://')) {
              trackUrl = firstTrack;
            } else {
              trackUrl = rtspUrl.replace(/\/$/, '') + '/' + firstTrack.replace(/^\//, '');
            }
          } else {
            trackUrl = rtspUrl;
          }
        }

        // Step 3: SETUP (if DESCRIBE succeeded)
        let setupResp: RtspResponse | null = null;
        if (describeResp && describeResp.statusCode >= 200 && describeResp.statusCode < 400 && trackUrl) {
          const setupHeaders = `Transport: RTP/AVP/TCP;unicast;interleaved=0-1\r\n`;
          setupResp = await sendRequest('SETUP', trackUrl, setupHeaders);
          steps.push(`SETUP: ${setupResp.statusCode} ${setupResp.statusText}`);

          // Extract Session ID from SETUP response
          if (setupResp.headers['session']) {
            // Session header may contain timeout: "1234abcd;timeout=60"
            sessionId = setupResp.headers['session'].split(';')[0].trim();
          }
        }

        // Step 4: PLAY (if SETUP succeeded)
        let playResp: RtspResponse | null = null;
        if (setupResp && setupResp.statusCode >= 200 && setupResp.statusCode < 400 && sessionId) {
          const playHeaders = `Range: npt=0-\r\n`;
          playResp = await sendRequest('PLAY', rtspUrl, playHeaders);
          steps.push(`PLAY: ${playResp.statusCode} ${playResp.statusText}`);

          // Step 5: Collect interleaved RTP/RTCP frames for 500ms
          if (playResp.statusCode >= 200 && playResp.statusCode < 400) {
            rtpFrames = await collectRtpFrames(reader, 500);
            steps.push(`RTP collection: ${rtpFrames.packetCount} packets, ${rtpFrames.rtpBytes} bytes`);
          }
        }

        // Step 6: TEARDOWN
        if (sessionId) {
          try {
            const teardownResp = await sendRequest('TEARDOWN', rtspUrl);
            steps.push(`TEARDOWN: ${teardownResp.statusCode} ${teardownResp.statusText}`);
          } catch {
            steps.push('TEARDOWN: failed (ignored)');
          }
        }

        await socket.close();

        const rtt = Date.now() - startTime;
        const sessionEstablished = !!(playResp && playResp.statusCode >= 200 && playResp.statusCode < 400);

        return {
          success: sessionEstablished || (describeResp !== null && describeResp.statusCode >= 200 && describeResp.statusCode < 400),
          host,
          port,
          url: rtspUrl,
          rtt,
          sessionId,
          steps,
          methods,
          sessionEstablished,
          rtpFrames: rtpFrames.packetCount,
          rtpBytes: rtpFrames.rtpBytes,
          rtcpPackets: rtpFrames.rtcpPackets,
          trackUrl,
          sdpSummary: sdpBody ? sdpBody.substring(0, 1000) : null,
          serverHeader: optionsResp.headers['server'] || describeResp?.headers['server'] || 'Unknown',
          message: sessionEstablished
            ? `RTSP session established. Received ${rtpFrames.packetCount} RTP/RTCP packet(s) in 500ms.`
            : `RTSP probe completed (${steps.length} steps). Full session not established.`,
        };
      } catch (error) {
        try { await socket.close(); } catch { /* ignore */ }
        throw error;
      }
    })();

    const result = await Promise.race([sessionPromise, overallTimeout]);
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 502,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'RTSP session failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
