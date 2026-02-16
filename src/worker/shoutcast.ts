/**
 * SHOUTcast Protocol Implementation
 *
 * SHOUTcast is a streaming audio server protocol developed by Nullsoft (creators
 * of Winamp) in the late 1990s. It enables internet radio broadcasting and is
 * based on HTTP with proprietary "ICY" protocol extensions for metadata.
 *
 * Protocol Overview:
 * - Port: 8000 (default, configurable)
 * - Transport: TCP (HTTP-based)
 * - Format: HTTP/1.0 with ICY extensions
 * - Audio: MP3, AAC, OGG Vorbis
 *
 * Protocol Variants:
 * - SHOUTcast v1: ICY protocol (non-standard HTTP)
 * - SHOUTcast v2: Standard HTTP with additional features
 * - Icecast: Open-source compatible alternative
 *
 * ICY Protocol (SHOUTcast Specific):
 * - Response: "ICY 200 OK" instead of "HTTP/1.0 200 OK"
 * - Headers: icy-name, icy-genre, icy-url, icy-br (bitrate)
 * - Metadata: In-stream metadata for song titles (every icy-metaint bytes)
 *
 * Connection Flow:
 * 1. Client → Server: GET /stream HTTP/1.0
 *                     Icy-MetaData: 1
 *                     User-Agent: Winamp/5.0
 * 2. Server → Client: ICY 200 OK
 *                     icy-name: Station Name
 *                     icy-genre: Genre
 *                     icy-br: 128
 *                     icy-metaint: 16000
 * 3. Server → Client: Audio stream + metadata chunks
 *
 * ICY Headers:
 * - icy-name: Station name
 * - icy-genre: Music genre
 * - icy-url: Station website
 * - icy-br: Bitrate in kbps
 * - icy-sr: Sample rate in Hz
 * - icy-metaint: Metadata interval (bytes between metadata blocks)
 * - icy-pub: Public listing (0=private, 1=public)
 *
 * Metadata Format:
 * - Sent every `icy-metaint` bytes
 * - Length byte: metadata length / 16
 * - Metadata: Length * 16 bytes of metadata
 * - Format: StreamTitle='Artist - Song';StreamUrl='http://...';
 *
 * Example Request:
 * GET / HTTP/1.0
 * Icy-MetaData: 1
 * User-Agent: WinampMPEG/5.0
 * Host: radio.example.com:8000
 *
 * Example Response:
 * ICY 200 OK
 * icy-name: My Radio Station
 * icy-genre: Rock
 * icy-url: http://myradio.com
 * icy-br: 128
 * icy-metaint: 16000
 * content-type: audio/mpeg
 *
 * [Audio stream data...]
 *
 * Use Cases:
 * - Internet radio server detection
 * - Stream metadata extraction
 * - Network media inventory
 * - Radio station discovery
 * - Streaming server forensics
 *
 * Modern Usage:
 * - Still widely used for internet radio
 * - Winamp officially discontinued but community-maintained
 * - Icecast is the open-source alternative
 * - Many mobile radio apps support SHOUTcast
 *
 * Reference:
 * - https://cast.readme.io/docs/shoutcast
 * - https://www.shoutcast.com/
 */

import { connect } from 'cloudflare:sockets';

interface ShoutCastRequest {
  host: string;
  port?: number;
  timeout?: number;
  stream?: string;
}

interface ShoutCastResponse {
  success: boolean;
  host: string;
  port: number;
  isShoutCast?: boolean;
  stationName?: string;
  genre?: string;
  bitrate?: number;
  url?: string;
  metaInt?: number;
  sampleRate?: number;
  contentType?: string;
  isPublic?: boolean;
  rtt?: number;
  error?: string;
}

/**
 * Build SHOUTcast/ICY protocol request
 */
function buildShoutCastRequest(host: string, port: number, stream: string = '/'): string {
  return [
    `GET ${stream} HTTP/1.0`,
    `Host: ${host}:${port}`,
    'Icy-MetaData: 1',
    'User-Agent: WinampMPEG/5.0',
    '\r\n',
  ].join('\r\n');
}

/**
 * Parse SHOUTcast/ICY response
 */
function parseShoutCastResponse(data: string): {
  isShoutCast: boolean;
  statusCode: number;
  statusMessage: string;
  stationName?: string;
  genre?: string;
  bitrate?: number;
  url?: string;
  metaInt?: number;
  sampleRate?: number;
  contentType?: string;
  isPublic?: boolean;
} | null {
  const lines = data.split('\r\n').filter(line => line.length > 0);

  if (lines.length === 0) {
    return null;
  }

  // Parse status line: ICY 200 OK or HTTP/1.0 200 OK
  const statusMatch = lines[0].match(/(ICY|HTTP\/\d\.\d)\s+(\d+)\s+(.*)/);
  if (!statusMatch) {
    return null;
  }

  const protocol = statusMatch[1];
  const statusCode = parseInt(statusMatch[2], 10);
  const statusMessage = statusMatch[3];

  const result: {
    isShoutCast: boolean;
    statusCode: number;
    statusMessage: string;
    stationName?: string;
    genre?: string;
    bitrate?: number;
    url?: string;
    metaInt?: number;
    sampleRate?: number;
    contentType?: string;
    isPublic?: boolean;
  } = {
    isShoutCast: protocol === 'ICY',
    statusCode,
    statusMessage,
  };

  // Parse ICY headers
  for (const line of lines.slice(1)) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const headerName = line.substring(0, colonIndex).trim().toLowerCase();
    const headerValue = line.substring(colonIndex + 1).trim();

    switch (headerName) {
      case 'icy-name':
        result.stationName = headerValue;
        result.isShoutCast = true; // Has ICY headers
        break;
      case 'icy-genre':
        result.genre = headerValue;
        break;
      case 'icy-br':
        result.bitrate = parseInt(headerValue, 10);
        break;
      case 'icy-url':
        result.url = headerValue;
        break;
      case 'icy-metaint':
        result.metaInt = parseInt(headerValue, 10);
        break;
      case 'icy-sr':
        result.sampleRate = parseInt(headerValue, 10);
        break;
      case 'icy-pub':
        result.isPublic = headerValue === '1';
        break;
      case 'content-type':
        result.contentType = headerValue;
        break;
    }
  }

  return result;
}

/**
 * Probe SHOUTcast server by sending ICY request.
 * Detects SHOUTcast/Icecast servers and basic stream info.
 */
export async function handleShoutCastProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as ShoutCastRequest;
    const { host, port = 8000, timeout = 15000, stream = '/' } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies ShoutCastResponse), {
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
      } satisfies ShoutCastResponse), {
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

      // Send SHOUTcast request
      const shoutcastRequest = buildShoutCastRequest(host, port, stream);

      const writer = socket.writable.getWriter();
      await writer.write(new TextEncoder().encode(shoutcastRequest));
      writer.releaseLock();

      // Read server response (headers only, stop before audio stream)
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
          error: 'No response from SHOUTcast server',
        } satisfies ShoutCastResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Decode response (only headers, before audio stream starts)
      const responseText = new TextDecoder().decode(value);

      // Extract just the headers (before double CRLF)
      const headersEnd = responseText.indexOf('\r\n\r\n');
      const headers = headersEnd !== -1 ? responseText.substring(0, headersEnd) : responseText;

      const parsed = parseShoutCastResponse(headers);

      if (!parsed) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Invalid SHOUTcast response format',
        } satisfies ShoutCastResponse), {
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
          isShoutCast: parsed.isShoutCast,
          stationName: parsed.stationName,
          genre: parsed.genre,
          bitrate: parsed.bitrate,
          url: parsed.url,
          metaInt: parsed.metaInt,
          sampleRate: parsed.sampleRate,
          contentType: parsed.contentType,
          isPublic: parsed.isPublic,
          rtt,
        } satisfies ShoutCastResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          isShoutCast: parsed.isShoutCast,
          error: `${parsed.isShoutCast ? 'ICY' : 'HTTP'} ${parsed.statusCode} ${parsed.statusMessage}`,
          rtt,
        } satisfies ShoutCastResponse), {
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
      port: 8000,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies ShoutCastResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Get detailed stream information from SHOUTcast server.
 * Same as probe but with additional error handling.
 */
export async function handleShoutCastInfo(request: Request): Promise<Response> {
  // Reuse probe logic
  return handleShoutCastProbe(request);
}
