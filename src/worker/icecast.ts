/**
 * Icecast Streaming Server Protocol Implementation
 *
 * Icecast is an open-source streaming media server that supports
 * Ogg, MP3, and other audio formats. It uses HTTP for both control
 * and streaming, with JSON/XML status endpoints.
 *
 * Protocol: HTTP over TCP
 * Default port: 8000
 *
 * Key Endpoints:
 *   GET /status-json.xsl   - Server status in JSON format
 *   GET /admin/stats        - Full server stats (requires auth)
 *   GET /                   - Mount point listing page
 *
 * Probe Strategy:
 *   1. Connect to port 8000
 *   2. Send HTTP GET to /status-json.xsl
 *   3. Parse JSON response for mount points, listeners, server info
 *
 * Security: Read-only status queries. No stream manipulation.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/**
 * Send an HTTP request over a raw TCP socket and read the response
 */
async function httpRequest(
  host: string,
  port: number,
  path: string,
  timeoutMs: number,
  auth?: { username: string; password: string }
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeoutMs);
  });

  try {
    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // Build HTTP request
    let request = `GET ${path} HTTP/1.1\r\nHost: ${host}:${port}\r\nAccept: application/json, text/xml, */*\r\nConnection: close\r\nUser-Agent: PortOfCall/1.0\r\n`;

    if (auth) {
      const credentials = btoa(`${auth.username}:${auth.password}`);
      request += `Authorization: Basic ${credentials}\r\n`;
    }

    request += '\r\n';

    await writer.write(new TextEncoder().encode(request));

    // Read response
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const maxBytes = 64 * 1024; // 64KB limit
    const deadline = Date.now() + timeoutMs;

    while (totalBytes < maxBytes) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      const readTimeout = new Promise<{ done: true; value: undefined }>((resolve) => {
        setTimeout(() => resolve({ done: true, value: undefined }), Math.min(remaining, 3000));
      });

      const result = await Promise.race([reader.read(), readTimeout]);
      if (result.done || !result.value) break;

      chunks.push(result.value);
      totalBytes += result.value.length;
    }

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    // Combine chunks
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    const raw = new TextDecoder().decode(combined);

    // Parse HTTP response
    const headerEnd = raw.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      return { statusCode: 0, headers: {}, body: raw };
    }

    const headerSection = raw.substring(0, headerEnd);
    const body = raw.substring(headerEnd + 4);

    // Parse status line
    const statusMatch = headerSection.match(/^HTTP\/[\d.]+ (\d+)/);
    const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;

    // Parse headers
    const headers: Record<string, string> = {};
    const headerLines = headerSection.split('\r\n').slice(1);
    for (const line of headerLines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.substring(0, colonIdx).trim().toLowerCase();
        const value = line.substring(colonIdx + 1).trim();
        headers[key] = value;
      }
    }

    // Handle chunked transfer encoding
    let finalBody = body;
    if (headers['transfer-encoding']?.includes('chunked')) {
      finalBody = decodeChunked(body);
    }

    return { statusCode, headers, body: finalBody };
  } catch (error) {
    socket.close();
    throw error;
  }
}

/**
 * Decode chunked transfer encoding
 */
function decodeChunked(body: string): string {
  const parts: string[] = [];
  let pos = 0;

  while (pos < body.length) {
    const lineEnd = body.indexOf('\r\n', pos);
    if (lineEnd === -1) break;

    const chunkSizeStr = body.substring(pos, lineEnd).trim();
    const chunkSize = parseInt(chunkSizeStr, 16);
    if (isNaN(chunkSize) || chunkSize === 0) break;

    const chunkStart = lineEnd + 2;
    const chunkData = body.substring(chunkStart, chunkStart + chunkSize);
    parts.push(chunkData);

    pos = chunkStart + chunkSize + 2; // skip \r\n after chunk data
  }

  return parts.join('');
}

interface MountPoint {
  name: string;
  listeners: number;
  peakListeners?: number;
  genre?: string;
  title?: string;
  description?: string;
  contentType?: string;
  bitrate?: number;
  samplerate?: number;
  channels?: number;
  serverUrl?: string;
}

/**
 * Parse Icecast JSON status response
 */
function parseIcecastStatus(body: string): {
  serverInfo?: {
    admin?: string;
    host?: string;
    location?: string;
    serverId?: string;
    serverStart?: string;
  };
  mountPoints: MountPoint[];
  totalListeners: number;
} {
  try {
    const data = JSON.parse(body);
    const icestats = data.icestats || data;

    const serverInfo = {
      admin: icestats.admin,
      host: icestats.host,
      location: icestats.location,
      serverId: icestats.server_id,
      serverStart: icestats.server_start || icestats.server_start_iso8601,
    };

    const mountPoints: MountPoint[] = [];
    let totalListeners = 0;

    // Mount points can be a single object or array
    const sources = icestats.source;
    if (sources) {
      const sourceArray = Array.isArray(sources) ? sources : [sources];
      for (const src of sourceArray) {
        const mp: MountPoint = {
          name: src.listenurl || src.server_name || 'unknown',
          listeners: src.listeners || 0,
          peakListeners: src.listener_peak,
          genre: src.genre,
          title: src.title || src.server_name,
          description: src.server_description,
          contentType: src.server_type || src.content_type,
          bitrate: src.bitrate || src.ice_bitrate,
          samplerate: src.samplerate,
          channels: src.channels,
          serverUrl: src.server_url,
        };
        mountPoints.push(mp);
        totalListeners += mp.listeners;
      }
    }

    return { serverInfo, mountPoints, totalListeners };
  } catch {
    return { mountPoints: [], totalListeners: 0 };
  }
}

/**
 * Probe an Icecast server for status information
 */
export async function handleIcecastStatus(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as {
      host?: string;
      port?: number;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 8000;
    const timeout = body.timeout || 10000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const startTime = Date.now();

    const response = await httpRequest(host, port, '/status-json.xsl', timeout);
    const rtt = Date.now() - startTime;

    if (response.statusCode === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No valid HTTP response received - server may not be Icecast',
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check for Icecast server header
    const serverHeader = response.headers['server'] || '';
    const isIcecast = serverHeader.toLowerCase().includes('icecast');

    if (response.statusCode !== 200) {
      return new Response(
        JSON.stringify({
          success: false,
          host,
          port,
          rtt,
          httpStatus: response.statusCode,
          server: serverHeader || null,
          isIcecast,
          error: `HTTP ${response.statusCode} - ${response.statusCode === 403 ? 'Forbidden' : response.statusCode === 404 ? 'Status endpoint not found' : 'Request failed'}`,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const parsed = parseIcecastStatus(response.body);

    return new Response(
      JSON.stringify({
        success: true,
        host,
        port,
        rtt,
        httpStatus: response.statusCode,
        server: serverHeader || null,
        isIcecast,
        serverInfo: parsed.serverInfo,
        mountPoints: parsed.mountPoints,
        totalListeners: parsed.totalListeners,
        mountCount: parsed.mountPoints.length,
        protocol: 'Icecast',
        message: `Icecast server responded in ${rtt}ms - ${parsed.mountPoints.length} mount(s), ${parsed.totalListeners} listener(s)`,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Icecast connection failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Get admin stats from Icecast (requires authentication)
 */
export async function handleIcecastAdmin(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as {
      host?: string;
      port?: number;
      username?: string;
      password?: string;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 8000;
    const username = body.username || 'admin';
    const password = body.password || '';
    const timeout = body.timeout || 10000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!password) {
      return new Response(
        JSON.stringify({ success: false, error: 'Admin password is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const startTime = Date.now();

    const response = await httpRequest(
      host, port, '/admin/stats?mount=/',
      timeout,
      { username, password }
    );
    const rtt = Date.now() - startTime;

    const serverHeader = response.headers['server'] || '';

    if (response.statusCode === 401) {
      return new Response(
        JSON.stringify({
          success: false,
          host,
          port,
          rtt,
          server: serverHeader || null,
          error: 'Authentication failed - check admin credentials',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: response.statusCode === 200,
        host,
        port,
        rtt,
        httpStatus: response.statusCode,
        server: serverHeader || null,
        contentType: response.headers['content-type'] || null,
        adminStats: response.body.substring(0, 8192), // Cap at 8KB
        protocol: 'Icecast Admin',
        message: response.statusCode === 200
          ? `Admin stats retrieved in ${rtt}ms`
          : `HTTP ${response.statusCode}`,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Icecast admin query failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
