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

interface RealAudioSetupRequest {
  host: string;
  port?: number;
  path?: string;
  timeout?: number;
}

interface SdpTrack {
  type: string;
  codec: string;
}

interface RealAudioSetupResult {
  success: boolean;
  serverBanner?: string;
  methods: string[];
  describeStatus?: number;
  contentType?: string;
  sdp?: string;
  sessionId?: string;
  tracks: SdpTrack[];
  latencyMs: number;
  error?: string;
}

function parsePublicMethods(response: string): string[] {
  const match = response.match(/^Public:\s*(.+)$/im);
  if (!match) return [];
  return match[1].split(',').map((m) => m.trim()).filter(Boolean);
}

function extractHeaderValue(response: string, name: string): string | undefined {
  const re = new RegExp(`^${name}:\\s*(.+)$`, 'im');
  const match = response.match(re);
  return match ? match[1].trim() : undefined;
}

function extractRTSPStatusCode(response: string): number {
  const match = response.match(/RTSP\/\d\.\d\s+(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

function parseSdpTracks(sdp: string): SdpTrack[] {
  const tracks: SdpTrack[] = [];
  for (const line of sdp.split(/\r?\n/)) {
    const mMatch = line.match(/^m=(\w+)\s/);
    if (mMatch) tracks.push({ type: mMatch[1], codec: 'unknown' });
    const rtpMatch = line.match(/^a=rtpmap:\d+\s+([^/\s]+)/);
    if (rtpMatch && tracks.length > 0) tracks[tracks.length - 1].codec = rtpMatch[1];
  }
  return tracks;
}

/**
 * Perform a full RTSP session setup: OPTIONS → DESCRIBE → SETUP (first track).
 * Returns server capabilities, SDP metadata, parsed tracks, and session ID.
 *
 * POST /api/realaudio/setup
 * Body: { host, port?, path?, timeout? }
 */
export async function handleRealAudioSetup(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as RealAudioSetupRequest;
    const { host, port = 554, path = '/testclip.rm', timeout = 10000 } = body;

    if (!host) {
      return new Response(
        JSON.stringify({ success: false, methods: [], tracks: [], latencyMs: 0, error: 'Host is required' } satisfies RealAudioSetupResult),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const baseUrl = `rtsp://${host}:${port}${path}`;
    const startTime = Date.now();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    const socket = connect(`${host}:${port}`);

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      async function readRTSPResp(ms: number): Promise<string> {
        const chunks: string[] = [];
        const dl = Date.now() + ms;
        let contentLength = 0;
        let headersDone = false;
        let bodyRead = 0;
        while (Date.now() < dl) {
          const rem = dl - Date.now();
          if (rem <= 0) break;
          try {
            const ct = new Promise<{ value: undefined; done: true }>((r) =>
              setTimeout(() => r({ value: undefined, done: true as const }), rem),
            );
            const { value, done } = await Promise.race([reader.read(), ct]);
            if (done || !value) break;
            chunks.push(new TextDecoder().decode(value));
            const full = chunks.join('');
            if (!headersDone && full.includes('\r\n\r\n')) {
              headersDone = true;
              const clMatch = full.match(/Content-Length:\s*(\d+)/i);
              contentLength = clMatch ? parseInt(clMatch[1], 10) : 0;
              bodyRead = full.length - full.indexOf('\r\n\r\n') - 4;
            }
            if (headersDone && bodyRead >= contentLength) break;
          } catch { break; }
        }
        return chunks.join('');
      }

      // OPTIONS
      await writer.write(new TextEncoder().encode(`OPTIONS * RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: RealPlayer\r\n\r\n`));
      const optionsResp = await readRTSPResp(4000);
      const serverBanner = extractHeaderValue(optionsResp, 'Server');
      const methods = parsePublicMethods(optionsResp);

      // DESCRIBE
      await writer.write(new TextEncoder().encode(
        `DESCRIBE ${baseUrl} RTSP/1.0\r\nCSeq: 2\r\nUser-Agent: RealPlayer\r\nAccept: application/sdp\r\n\r\n`,
      ));
      const describeResp = await readRTSPResp(5000);
      const describeStatus = extractRTSPStatusCode(describeResp);
      const contentType = extractHeaderValue(describeResp, 'Content-Type');
      let sdp: string | undefined;
      let tracks: SdpTrack[] = [];
      if (describeStatus === 200) {
        const bodyIdx = describeResp.indexOf('\r\n\r\n');
        if (bodyIdx !== -1) {
          sdp = describeResp.slice(bodyIdx + 4).trim();
          if (sdp) tracks = parseSdpTracks(sdp);
        }
      }

      // SETUP (first track)
      let sessionId: string | undefined;
      if (describeStatus === 200) {
        await writer.write(new TextEncoder().encode(
          `SETUP ${baseUrl}/streamid=0 RTSP/1.0\r\nCSeq: 3\r\nUser-Agent: RealPlayer\r\nTransport: RTP/AVP;unicast;client_port=6970-6971\r\n\r\n`,
        ));
        const setupResp = await readRTSPResp(4000);
        const sessionHeader = extractHeaderValue(setupResp, 'Session');
        if (sessionHeader) sessionId = sessionHeader.split(';')[0].trim();
      }

      const latencyMs = Date.now() - startTime;
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(
        JSON.stringify({
          success: true,
          ...(serverBanner ? { serverBanner } : {}),
          methods,
          describeStatus,
          ...(contentType ? { contentType } : {}),
          ...(sdp ? { sdp } : {}),
          ...(sessionId ? { sessionId } : {}),
          tracks,
          latencyMs,
        } satisfies RealAudioSetupResult),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, methods: [], tracks: [], latencyMs: 0, error: error instanceof Error ? error.message : 'Unknown error' } satisfies RealAudioSetupResult),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

interface RealAudioSessionResult {
  success: boolean;
  serverBanner?: string;
  methods: string[];
  sessionId?: string;
  tracks: SdpTrack[];
  playStatus?: number;
  rtpInfo?: string;
  framesReceived?: number;
  teardownStatus?: number;
  latencyMs: number;
  error?: string;
}

/**
 * Perform a complete RTSP session: OPTIONS → DESCRIBE → SETUP → PLAY → collect frames → TEARDOWN.
 * This is the full workflow needed to actually stream media from an RTSP server.
 *
 * POST /api/realaudio/session
 * Body: { host, port?, path?, collectMs?, timeout? }
 *   collectMs — how many ms to collect RTP interleaved frames after PLAY (default: 2000, max: 8000)
 */
export async function handleRealAudioSession(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  try {
    const body = (await request.json()) as {
      host?: string; port?: number; path?: string; collectMs?: number; timeout?: number;
    };
    const host = (body.host ?? '').trim();
    const port = body.port ?? 554;
    const path = (body.path ?? '/').replace(/^([^/])/, '/$1');
    const collectMs = Math.min(body.collectMs ?? 2000, 8000);
    const timeout = Math.min(body.timeout ?? 15000, 30000);

    if (!host) {
      return new Response(
        JSON.stringify({ success: false, methods: [], tracks: [], latencyMs: 0, error: 'Host is required' } satisfies RealAudioSessionResult),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const baseUrl = `rtsp://${host}:${port}${path}`;
    const startTime = Date.now();

    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    try {
      await Promise.race([socket.opened, timeoutPromise]);
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      async function readRTSP(ms: number): Promise<string> {
        const chunks: string[] = [];
        const dl = Date.now() + ms;
        let contentLength = 0;
        let headersDone = false;
        let bodyRead = 0;
        while (Date.now() < dl) {
          const rem = dl - Date.now();
          if (rem <= 0) break;
          try {
            const ct = new Promise<{ value: undefined; done: true }>((r) =>
              setTimeout(() => r({ value: undefined, done: true as const }), rem),
            );
            const { value, done } = await Promise.race([reader.read(), ct]);
            if (done || !value) break;
            chunks.push(new TextDecoder().decode(value));
            const full = chunks.join('');
            if (!headersDone && full.includes('\r\n\r\n')) {
              headersDone = true;
              const clMatch = full.match(/Content-Length:\s*(\d+)/i);
              contentLength = clMatch ? parseInt(clMatch[1], 10) : 0;
              bodyRead = full.length - full.indexOf('\r\n\r\n') - 4;
            }
            if (headersDone && bodyRead >= contentLength) break;
          } catch { break; }
        }
        return chunks.join('');
      }

      // CSeq counter
      let cseq = 0;
      const ua = 'RealPlayer';

      // OPTIONS
      cseq++;
      await writer.write(new TextEncoder().encode(
        `OPTIONS * RTSP/1.0\r\nCSeq: ${cseq}\r\nUser-Agent: ${ua}\r\n\r\n`,
      ));
      const optResp = await readRTSP(4000);
      const serverBanner = extractHeaderValue(optResp, 'Server');
      const methods = parsePublicMethods(optResp);

      // DESCRIBE
      cseq++;
      await writer.write(new TextEncoder().encode(
        `DESCRIBE ${baseUrl} RTSP/1.0\r\nCSeq: ${cseq}\r\nUser-Agent: ${ua}\r\nAccept: application/sdp\r\n\r\n`,
      ));
      const descResp = await readRTSP(5000);
      const descStatus = extractRTSPStatusCode(descResp);
      let tracks: SdpTrack[] = [];
      let sessionId: string | undefined;
      let playStatus: number | undefined;
      let rtpInfo: string | undefined;
      let framesReceived = 0;
      let teardownStatus: number | undefined;

      if (descStatus === 200) {
        const bodyIdx = descResp.indexOf('\r\n\r\n');
        if (bodyIdx !== -1) {
          const sdp = descResp.slice(bodyIdx + 4).trim();
          if (sdp) tracks = parseSdpTracks(sdp);
        }

        // SETUP (first track, interleaved TCP so PLAY data comes back on same connection)
        cseq++;
        const trackUrl = tracks.length > 0
          ? `${baseUrl}/trackID=1`
          : `${baseUrl}/streamid=0`;
        await writer.write(new TextEncoder().encode(
          `SETUP ${trackUrl} RTSP/1.0\r\nCSeq: ${cseq}\r\nUser-Agent: ${ua}\r\nTransport: RTP/AVP/TCP;unicast;interleaved=0-1\r\n\r\n`,
        ));
        const setupResp = await readRTSP(4000);
        const sessionHdr = extractHeaderValue(setupResp, 'Session');
        if (sessionHdr) sessionId = sessionHdr.split(';')[0].trim();

        if (sessionId) {
          // PLAY
          cseq++;
          await writer.write(new TextEncoder().encode(
            `PLAY ${baseUrl} RTSP/1.0\r\nCSeq: ${cseq}\r\nUser-Agent: ${ua}\r\nSession: ${sessionId}\r\nRange: npt=0.000-\r\n\r\n`,
          ));
          const playResp = await readRTSP(4000);
          playStatus = extractRTSPStatusCode(playResp);
          rtpInfo = extractHeaderValue(playResp, 'RTP-Info');

          // Collect interleaved RTP frames for collectMs ms
          if (playStatus === 200) {
            const frameDeadline = Date.now() + collectMs;
            const buf: Uint8Array[] = [];
            let bufLen = 0;
            while (Date.now() < frameDeadline) {
              const rem = frameDeadline - Date.now();
              try {
                const ct = new Promise<{ value: undefined; done: true }>((r) =>
                  setTimeout(() => r({ value: undefined, done: true as const }), rem),
                );
                const { value, done } = await Promise.race([reader.read(), ct]);
                if (done || !value) break;
                buf.push(value);
                bufLen += value.length;
                // Count interleaved frames: each starts with '$' (0x24) + channel(1) + length(2)
                for (const chunk of buf) {
                  for (let i = 0; i < chunk.length - 3; i++) {
                    if (chunk[i] === 0x24) framesReceived++;
                  }
                }
                buf.length = 0; // clear processed chunks
                if (bufLen > 65536) break; // safety
              } catch { break; }
            }

            // TEARDOWN
            cseq++;
            try {
              await writer.write(new TextEncoder().encode(
                `TEARDOWN ${baseUrl} RTSP/1.0\r\nCSeq: ${cseq}\r\nUser-Agent: ${ua}\r\nSession: ${sessionId}\r\n\r\n`,
              ));
              const tearResp = await readRTSP(3000);
              teardownStatus = extractRTSPStatusCode(tearResp);
            } catch { /* teardown is best-effort */ }
          }
        }
      }

      const latencyMs = Date.now() - startTime;
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(
        JSON.stringify({
          success: (playStatus ?? 0) >= 200 && (playStatus ?? 0) < 300 || descStatus === 200,
          ...(serverBanner ? { serverBanner } : {}),
          methods,
          ...(sessionId ? { sessionId } : {}),
          tracks,
          ...(playStatus !== undefined ? { playStatus } : {}),
          ...(rtpInfo ? { rtpInfo } : {}),
          ...(playStatus === 200 ? { framesReceived } : {}),
          ...(teardownStatus !== undefined ? { teardownStatus } : {}),
          latencyMs,
        } satisfies RealAudioSessionResult),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, methods: [], tracks: [], latencyMs: 0, error: error instanceof Error ? error.message : 'Unknown error' } satisfies RealAudioSessionResult),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
