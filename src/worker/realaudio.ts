/**
 * RealAudio/RealMedia Protocol Implementation
 *
 * RealAudio and RealMedia were proprietary streaming protocols developed by
 * RealNetworks in the 1990s and 2000s. Before Flash and HTML5 video, Real
 * was one of the dominant streaming media platforms on the internet.
 *
 * Protocol Overview:
 * - Port: 7070 (RTSP control), 6970-7170 (RTP/RDT data)
 * - Transport: TCP (RTSP), UDP (RTP/RDT)
 * - Format: RTSP-based with RealAudio extensions
 * - Protocols: RTSP, PNA (Progressive Networks Audio), RDT (Real Data Transport)
 *
 * Protocol Variants:
 * - PNA (Progressive Networks Audio): Legacy proprietary protocol (ports 7070/7171)
 * - RTSP: Standard RTSP with RealMedia extensions
 * - RDT: Real Data Transport (proprietary alternative to RTP)
 * - HTTP: RealMedia can also stream over HTTP
 *
 * RTSP Commands (RealMedia-specific):
 * - OPTIONS: Query server capabilities
 * - DESCRIBE: Get stream metadata (SDP with RealMedia extensions)
 * - SETUP: Configure streaming session
 * - PLAY: Start playback
 * - PAUSE: Pause playback
 * - TEARDOWN: End session
 *
 * RealMedia RTSP Extensions:
 * - User-Agent: RealMedia Player/Helix
 * - x-Real-UsePreBuffer: Buffer control
 * - x-Real-Proxy: Proxy configuration
 * - DataType: RDT for Real Data Transport
 *
 * SDP Extensions (RealMedia):
 * - a=mimetype: RealAudio MIME type
 * - a=AvgBitRate: Average bitrate
 * - a=MaxBitRate: Maximum bitrate
 * - a=StreamName: Stream name
 *
 * Common MIME Types:
 * - audio/x-pn-realaudio
 * - audio/x-pn-realaudio-plugin
 * - video/x-pn-realvideo
 * - application/x-pn-realmedia
 * - application/vnd.rn-realmedia
 *
 * Connection Flow:
 * 1. Client → Server: OPTIONS rtsp://server:7070/ RTSP/1.0
 * 2. Server → Client: RTSP/1.0 200 OK (with Server: Helix...)
 * 3. Client → Server: DESCRIBE rtsp://server:7070/stream.rm
 * 4. Server → Client: 200 OK with SDP (RealMedia format)
 * 5. Client → Server: SETUP (configure transport)
 * 6. Server → Client: 200 OK (with Session ID)
 * 7. Client → Server: PLAY
 * 8. Server → Client: 200 OK, starts streaming RDT/RTP
 *
 * Use Cases:
 * - Legacy streaming server detection
 * - Network archaeology and forensics
 * - Historical protocol research
 * - Enterprise legacy system inventory
 *
 * Modern Alternatives:
 * - HTTP Live Streaming (HLS)
 * - MPEG-DASH
 * - WebRTC
 * - Standard RTSP with H.264/H.265
 *
 * Note: RealNetworks discontinued RealPlayer in 2018. Helix Server is still
 * available but rarely used. Most RealAudio content has been migrated to
 * modern formats.
 */

import { connect } from 'cloudflare:sockets';

interface RealAudioRequest {
  host: string;
  port?: number;
  timeout?: number;
  streamPath?: string;
}

interface RealAudioResponse {
  success: boolean;
  host: string;
  port: number;
  server?: string;
  cseq?: number;
  contentType?: string;
  contentBase?: string;
  streamInfo?: string;
  isRealServer?: boolean;
  rtt?: number;
  error?: string;
}

/**
 * Build RTSP OPTIONS request for RealAudio server
 */
function buildRTSPOptions(host: string, port: number, streamPath: string = '/'): string {
  return [
    `OPTIONS rtsp://${host}:${port}${streamPath} RTSP/1.0`,
    'CSeq: 1',
    'User-Agent: RealMedia Player',
    'ClientChallenge: 9e26d33f2984236010ef6253fb1887f7',
    '\r\n',
  ].join('\r\n');
}

/**
 * Build RTSP DESCRIBE request for RealAudio stream
 */
function buildRTSPDescribe(host: string, port: number, streamPath: string): string {
  return [
    `DESCRIBE rtsp://${host}:${port}${streamPath} RTSP/1.0`,
    'CSeq: 2',
    'User-Agent: RealMedia Player',
    'Accept: application/sdp',
    '\r\n',
  ].join('\r\n');
}

/**
 * Parse RTSP response
 */
function parseRTSPResponse(data: string): {
  statusCode: number;
  statusMessage: string;
  server?: string;
  cseq?: number;
  contentType?: string;
  contentBase?: string;
  contentLength?: number;
  isRealServer: boolean;
} | null {
  const lines = data.split('\r\n').filter(line => line.length > 0);

  if (lines.length === 0) {
    return null;
  }

  // Parse status line: RTSP/1.0 200 OK
  const statusMatch = lines[0].match(/RTSP\/\d\.\d\s+(\d+)\s+(.*)/);
  if (!statusMatch) {
    return null;
  }

  const statusCode = parseInt(statusMatch[1], 10);
  const statusMessage = statusMatch[2];

  const result: {
    statusCode: number;
    statusMessage: string;
    server?: string;
    cseq?: number;
    contentType?: string;
    contentBase?: string;
    contentLength?: number;
    isRealServer: boolean;
  } = {
    statusCode,
    statusMessage,
    isRealServer: false,
  };

  // Parse headers
  for (const line of lines.slice(1)) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const headerName = line.substring(0, colonIndex).trim().toLowerCase();
    const headerValue = line.substring(colonIndex + 1).trim();

    if (headerName === 'server') {
      result.server = headerValue;
      // Check if it's a RealNetworks server
      if (headerValue.toLowerCase().includes('helix') ||
          headerValue.toLowerCase().includes('realserver') ||
          headerValue.toLowerCase().includes('real')) {
        result.isRealServer = true;
      }
    } else if (headerName === 'cseq') {
      result.cseq = parseInt(headerValue, 10);
    } else if (headerName === 'content-type') {
      result.contentType = headerValue;
    } else if (headerName === 'content-base') {
      result.contentBase = headerValue;
    } else if (headerName === 'content-length') {
      result.contentLength = parseInt(headerValue, 10);
    }
  }

  return result;
}

/**
 * Probe RealAudio server by sending RTSP OPTIONS request.
 * Detects RealNetworks Helix Server and RealMedia support.
 */
export async function handleRealAudioProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as RealAudioRequest;
    const { host, port = 7070, timeout = 15000, streamPath = '/' } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies RealAudioResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        error: 'Port must be between 1 and 65535',
      } satisfies RealAudioResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      // Send RTSP OPTIONS request
      const optionsRequest = buildRTSPOptions(host, port, streamPath);

      const writer = socket.writable.getWriter();
      await writer.write(new TextEncoder().encode(optionsRequest));
      writer.releaseLock();

      // Read server response
      const reader = socket.readable.getReader();

      const { value, done } = await Promise.race([
        reader.read(),
        timeoutPromise,
      ]);

      if (done || !value) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'No response from RealAudio server',
        } satisfies RealAudioResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const responseText = new TextDecoder().decode(value);
      const parsed = parseRTSPResponse(responseText);

      if (!parsed) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Invalid RTSP response format',
        } satisfies RealAudioResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const rtt = Date.now() - start;

      reader.releaseLock();
      socket.close();

      // Check if server responded successfully
      if (parsed.statusCode === 200) {
        return new Response(JSON.stringify({
          success: true,
          host,
          port,
          server: parsed.server,
          cseq: parsed.cseq,
          isRealServer: parsed.isRealServer,
          rtt,
        } satisfies RealAudioResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          server: parsed.server,
          error: `RTSP ${parsed.statusCode} ${parsed.statusMessage}`,
          rtt,
        } satisfies RealAudioResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

    } catch (error) {
      socket.close();
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      host: '',
      port: 7070,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies RealAudioResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Request stream description from RealAudio server.
 * Sends RTSP DESCRIBE to get SDP metadata.
 */
export async function handleRealAudioDescribe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as RealAudioRequest;
    const {
      host,
      port = 7070,
      timeout = 15000,
      streamPath = '/stream.rm',
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      // Send DESCRIBE request
      const describeRequest = buildRTSPDescribe(host, port, streamPath);

      const writer = socket.writable.getWriter();
      await writer.write(new TextEncoder().encode(describeRequest));
      writer.releaseLock();

      // Read response
      const reader = socket.readable.getReader();

      const chunks: string[] = [];
      let totalBytes = 0;
      const maxResponseSize = 5000;

      try {
        while (totalBytes < maxResponseSize) {
          const { value, done } = await Promise.race([
            reader.read(),
            timeoutPromise,
          ]);

          if (done) break;

          if (value) {
            const text = new TextDecoder().decode(value);
            chunks.push(text);
            totalBytes += value.length;

            // Stop after getting complete SDP (ends with blank line)
            if (text.includes('\r\n\r\n')) {
              break;
            }
          }
        }
      } catch {
        // Connection closed or timeout (expected)
      }

      const responseText = chunks.join('');
      const parsed = parseRTSPResponse(responseText);

      reader.releaseLock();
      socket.close();

      if (parsed && parsed.statusCode === 200) {
        // Extract SDP body if present
        const sdpMatch = responseText.match(/\r\n\r\n([\s\S]+)$/);
        const sdpBody = sdpMatch ? sdpMatch[1].trim() : undefined;

        return new Response(JSON.stringify({
          success: true,
          host,
          port,
          server: parsed.server,
          contentType: parsed.contentType,
          contentBase: parsed.contentBase,
          streamInfo: sdpBody,
          isRealServer: parsed.isRealServer,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: parsed ? `RTSP ${parsed.statusCode} ${parsed.statusMessage}` : 'Invalid response',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

    } catch (error) {
      socket.close();
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
