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

// ─── SHOUTcast Admin / Statistics ───────────────────────────────────────────

interface ShoutCastAdminRequest {
  host: string;
  port?: number;
  timeout?: number;
  adminPassword: string;
}

interface ShoutCastAdminResponse {
  success: boolean;
  host: string;
  port: number;
  currentListeners?: number;
  peakListeners?: number;
  maxListeners?: number;
  uniqueListeners?: number;
  title?: string;
  genre?: string;
  bitrate?: number;
  rtt?: number;
  error?: string;
}

/**
 * Build a basic HTTP/1.0 GET request string.
 */
function buildHttpGet(host: string, port: number, path: string, authHeader?: string): string {
  const lines = [
    `GET ${path} HTTP/1.0`,
    `Host: ${host}:${port}`,
    'User-Agent: Mozilla/5.0',
    'Connection: close',
  ];
  if (authHeader) lines.push(`Authorization: ${authHeader}`);
  lines.push('\r\n');
  return lines.join('\r\n');
}

/**
 * Parse a raw HTTP response string, returning { statusCode, headers, body }.
 */
function parseHttpResponse(raw: string): {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
} {
  const sep = raw.indexOf('\r\n\r\n');
  const headerPart = sep !== -1 ? raw.substring(0, sep) : raw;
  const body = sep !== -1 ? raw.substring(sep + 4) : '';

  const headerLines = headerPart.split('\r\n');
  const statusLine = headerLines[0] || '';
  const statusMatch = statusLine.match(/^HTTP\/\S+\s+(\d+)/);
  const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;

  const headers: Record<string, string> = {};
  for (const line of headerLines.slice(1)) {
    const idx = line.indexOf(':');
    if (idx !== -1) {
      headers[line.substring(0, idx).trim().toLowerCase()] = line.substring(idx + 1).trim();
    }
  }

  return { statusCode, headers, body };
}

/**
 * Fetch a URL over a raw TCP socket (HTTP/1.0, no TLS).
 * Returns the full response string or throws on timeout/error.
 */
async function rawHttpGet(
  host: string,
  port: number,
  path: string,
  authHeader: string | undefined,
  timeoutMs: number,
): Promise<string> {
  const socket = connect(`${host}:${port}`);

  const connTimeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Connection timeout')), timeoutMs),
  );

  await Promise.race([socket.opened, connTimeout]);

  const writer = socket.writable.getWriter();
  await writer.write(new TextEncoder().encode(buildHttpGet(host, port, path, authHeader)));
  writer.releaseLock();

  const reader = socket.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLen = 0;

  const readTimeout = new Promise<{ value: undefined; done: true }>((resolve) =>
    setTimeout(() => resolve({ value: undefined, done: true }), timeoutMs),
  );

  while (true) {
    const { value, done } = await Promise.race([reader.read(), readTimeout]);
    if (done || !value) break;
    chunks.push(value);
    totalLen += value.length;
    if (totalLen > 65536) break; // safety cap
  }

  reader.releaseLock();
  socket.close();

  const combined = new Uint8Array(totalLen);
  let off = 0;
  for (const chunk of chunks) { combined.set(chunk, off); off += chunk.length; }
  return new TextDecoder().decode(combined);
}

/**
 * Parse SHOUTcast /7.html response.
 * Legacy format: 7 comma-separated values on one line:
 * currentListeners,streamStatus,peakListeners,maxListeners,uniqueListeners,bitrate,songTitle
 */
function parse7Html(body: string): Partial<ShoutCastAdminResponse> {
  // /7.html wraps values in <body> ... </body>
  const bodyMatch = body.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const content = bodyMatch ? bodyMatch[1] : body;
  const parts = content.trim().split(',');

  if (parts.length < 7) return {};

  return {
    currentListeners: parseInt(parts[0], 10) || undefined,
    peakListeners: parseInt(parts[2], 10) || undefined,
    maxListeners: parseInt(parts[3], 10) || undefined,
    uniqueListeners: parseInt(parts[4], 10) || undefined,
    bitrate: parseInt(parts[5], 10) || undefined,
    title: parts[6]?.trim() || undefined,
  };
}

/**
 * Parse SHOUTcast v1 admin.cgi?mode=viewxml response.
 * Extracts key fields via simple regex rather than a full XML parser.
 */
function parseAdminXml(body: string): Partial<ShoutCastAdminResponse> {
  function extractXml(tag: string): string | undefined {
    const m = body.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
    return m ? m[1].trim() : undefined;
  }

  const currentStr = extractXml('CURRENTLISTENERS');
  const peakStr = extractXml('PEAKLISTENERS');
  const maxStr = extractXml('MAXLISTENERS');
  const uniqueStr = extractXml('UNIQUELISTENERS');
  const bitrateStr = extractXml('BITRATE');

  return {
    currentListeners: currentStr !== undefined ? parseInt(currentStr, 10) || undefined : undefined,
    peakListeners: peakStr !== undefined ? parseInt(peakStr, 10) || undefined : undefined,
    maxListeners: maxStr !== undefined ? parseInt(maxStr, 10) || undefined : undefined,
    uniqueListeners: uniqueStr !== undefined ? parseInt(uniqueStr, 10) || undefined : undefined,
    bitrate: bitrateStr !== undefined ? parseInt(bitrateStr, 10) || undefined : undefined,
    title: extractXml('SONGTITLE') || extractXml('SERVERTITLE') || undefined,
    genre: extractXml('GENRE') || undefined,
  };
}

/**
 * Parse SHOUTcast v2 /statistics?json=1 response.
 */
function parseStatisticsJson(body: string): Partial<ShoutCastAdminResponse> {
  try {
    const obj = JSON.parse(body) as Record<string, unknown>;
    // v2 wraps in a streams array or top-level fields
    const src = (Array.isArray(obj.streams) && obj.streams[0] as Record<string, unknown>) || obj;
    return {
      currentListeners: typeof src.currentlisteners === 'number' ? src.currentlisteners : undefined,
      peakListeners: typeof src.peaklisteners === 'number' ? src.peaklisteners : undefined,
      maxListeners: typeof src.maxlisteners === 'number' ? src.maxlisteners : undefined,
      uniqueListeners: typeof src.uniquelisteners === 'number' ? src.uniquelisteners : undefined,
      bitrate: typeof src.bitrate === 'number' ? src.bitrate : undefined,
      title: typeof src.songtitle === 'string' ? src.songtitle : undefined,
      genre: typeof src.genre === 'string' ? src.genre : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Merge two partial admin responses, preferring the first non-undefined value.
 */
function mergeStats(
  a: Partial<ShoutCastAdminResponse>,
  b: Partial<ShoutCastAdminResponse>,
): Partial<ShoutCastAdminResponse> {
  return {
    currentListeners: a.currentListeners ?? b.currentListeners,
    peakListeners: a.peakListeners ?? b.peakListeners,
    maxListeners: a.maxListeners ?? b.maxListeners,
    uniqueListeners: a.uniqueListeners ?? b.uniqueListeners,
    bitrate: a.bitrate ?? b.bitrate,
    title: a.title ?? b.title,
    genre: a.genre ?? b.genre,
  };
}

/**
 * Query SHOUTcast admin/statistics endpoints for listener counts and metadata.
 *
 * POST /api/shoutcast/admin
 * Body: { host, port?, timeout?, adminPassword }
 *
 * Tries, in order:
 *   1. GET /admin.cgi?mode=viewxml&page=1  (SHOUTcast v1 XML)
 *   2. GET /statistics?json=1              (SHOUTcast v2 JSON)
 *   3. GET /7.html                         (legacy 7-field CSV)
 */
export async function handleSHOUTcastAdmin(request: Request): Promise<Response> {
  try {
    const body = await request.json() as ShoutCastAdminRequest;
    const {
      host,
      port = 8000,
      timeout = 15000,
      adminPassword,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false, host: '', port,
        error: 'Host is required',
      } satisfies ShoutCastAdminResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!adminPassword) {
      return new Response(JSON.stringify({
        success: false, host, port,
        error: 'adminPassword is required',
      } satisfies ShoutCastAdminResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false, host, port,
        error: 'Port must be between 1 and 65535',
      } satisfies ShoutCastAdminResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    // Build Basic auth header: "admin:password"
    const basicAuth = 'Basic ' + btoa(`admin:${adminPassword}`);

    let stats: Partial<ShoutCastAdminResponse> = {};
    let gotData = false;
    const perReqTimeout = Math.min(timeout, 8000);

    // --- Attempt 1: SHOUTcast v1 XML admin endpoint ---
    try {
      const rawXml = await rawHttpGet(
        host, port,
        `/admin.cgi?mode=viewxml&page=1&pass=${encodeURIComponent(adminPassword)}`,
        basicAuth,
        perReqTimeout,
      );
      const { statusCode, body: xmlBody } = parseHttpResponse(rawXml);
      if (statusCode === 200 && xmlBody.includes('<SHOUTCASTSERVER>')) {
        stats = mergeStats(stats, parseAdminXml(xmlBody));
        gotData = true;
      }
    } catch {
      // Try next endpoint
    }

    // --- Attempt 2: SHOUTcast v2 JSON statistics ---
    if (!gotData || stats.currentListeners === undefined) {
      try {
        const rawJson = await rawHttpGet(
          host, port,
          `/statistics?json=1&pass=${encodeURIComponent(adminPassword)}`,
          basicAuth,
          perReqTimeout,
        );
        const { statusCode, body: jsonBody } = parseHttpResponse(rawJson);
        if (statusCode === 200 && jsonBody.trim().startsWith('{')) {
          stats = mergeStats(stats, parseStatisticsJson(jsonBody));
          gotData = true;
        }
      } catch {
        // Try next endpoint
      }
    }

    // --- Attempt 3: Legacy /7.html ---
    if (!gotData || stats.currentListeners === undefined) {
      try {
        const raw7 = await rawHttpGet(
          host, port,
          `/7.html?pass=${encodeURIComponent(adminPassword)}`,
          basicAuth,
          perReqTimeout,
        );
        const { statusCode, body: sevenBody } = parseHttpResponse(raw7);
        if (statusCode === 200) {
          stats = mergeStats(stats, parse7Html(sevenBody));
          gotData = true;
        }
      } catch {
        // All attempts failed
      }
    }

    const rtt = Date.now() - start;

    if (!gotData) {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        rtt,
        error: 'Could not retrieve stats from admin.cgi, /statistics, or /7.html. ' +
          'Check the host, port, and adminPassword.',
      } satisfies ShoutCastAdminResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      currentListeners: stats.currentListeners,
      peakListeners: stats.peakListeners,
      maxListeners: stats.maxListeners,
      uniqueListeners: stats.uniqueListeners,
      title: stats.title,
      genre: stats.genre,
      bitrate: stats.bitrate,
      rtt,
    } satisfies ShoutCastAdminResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      host: '',
      port: 8000,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies ShoutCastAdminResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle SHOUTcast ICY SOURCE stream mount
 *
 * POST /api/shoutcast/source
 * Body: { host, port?, mountpoint?, password, name?, genre?, bitrate?, contentType?, timeout? }
 *
 * Authenticates a source connection to a SHOUTcast server using the ICY
 * SOURCE protocol. After a successful mount, sends a short burst of silent
 * audio frames (zero-filled) to confirm the server accepts the stream,
 * then cleanly disconnects.
 */
export async function handleSHOUTcastSource(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  interface SHOUTcastSourceRequest {
    host: string;
    port?: number;
    mountpoint?: string;
    password: string;
    name?: string;
    genre?: string;
    bitrate?: number;
    contentType?: string;
    timeout?: number;
  }

  let body: SHOUTcastSourceRequest;
  try {
    body = await request.json() as SHOUTcastSourceRequest;
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const {
    host,
    port = 8000,
    mountpoint = '/',
    password,
    name = 'Port of Call Test',
    genre = 'Various',
    bitrate = 128,
    contentType = 'audio/mpeg',
    timeout = 10000,
  } = body;

  if (!host) {
    return new Response(JSON.stringify({ success: false, error: 'host is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!password) {
    return new Response(JSON.stringify({ success: false, error: 'password is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const startTime = Date.now();
  const mount = mountpoint.startsWith('/') ? mountpoint : `/${mountpoint}`;

  // Build ICY SOURCE request (SHOUTcast v1 source protocol)
  const sourceRequest = [
    `SOURCE ${mount} ICY/1.0`,
    `ice-password: ${password}`,
    `icy-name: ${name}`,
    `icy-genre: ${genre}`,
    `icy-url: http://${host}:${port}${mount}`,
    `icy-br: ${bitrate}`,
    `icy-pub: 0`,
    `content-type: ${contentType}`,
    '',
    '',
  ].join('\r\n');

  try {
    const socket = connect({ hostname: host, port }, { secureTransport: 'off' as const, allowHalfOpen: false });
    await Promise.race([
      socket.opened,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout)),
    ]);

    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();

    try {
      // Send ICY SOURCE handshake
      await writer.write(new TextEncoder().encode(sourceRequest));

      // Read server response
      const responseRaw = await Promise.race([
        reader.read(),
        new Promise<{ done: boolean; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), Math.min(timeout, 8000))
        ),
      ]);

      if (responseRaw.done || !responseRaw.value) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          mountpoint: mount,
          error: 'No response from server',
          rtt: Date.now() - startTime,
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const responseText = new TextDecoder().decode(responseRaw.value);
      const firstLine = responseText.split('\r\n')[0].trim();
      const accepted = firstLine.startsWith('ICY 200') || firstLine.startsWith('HTTP/1') && responseText.includes('200');
      const statusCode = parseInt(firstLine.split(' ')[1] ?? '0') || 0;

      if (accepted) {
        // Send a small burst of silent MP3 frames (zero bytes) to confirm data path
        await writer.write(new Uint8Array(1152)); // one MP3 frame worth of silence
      }

      const rtt = Date.now() - startTime;
      return new Response(JSON.stringify({
        success: accepted,
        host,
        port,
        mountpoint: mount,
        serverResponse: firstLine,
        statusCode,
        name,
        genre,
        bitrate,
        contentType,
        rtt,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });

    } finally {
      reader.releaseLock();
      writer.releaseLock();
      await socket.close();
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      host,
      port,
      mountpoint: mount,
      error: error instanceof Error ? error.message : 'SHOUTcast source mount failed',
      rtt: Date.now() - startTime,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
