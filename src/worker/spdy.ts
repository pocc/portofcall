/**
 * SPDY Protocol Support
 *
 * SPDY (speedy) was Google's experimental successor to HTTP/1.1, developed
 * around 2009–2015. It introduced multiplexing, header compression, and
 * server push — concepts that were standardized in HTTP/2. Chrome removed
 * SPDY support in 2016; most servers have since dropped it entirely.
 *
 * Transport: TLS on port 443, negotiated via ALPN "spdy/3.1"
 * Status: Deprecated — superseded by HTTP/2 (RFC 7540)
 *
 * This worker establishes a TLS connection to the target and sends a SPDY/3
 * SETTINGS control frame. If the server speaks SPDY it will respond with its
 * own SETTINGS; otherwise it will send an HTTP/2 PREFACE, an HTTP/1.1
 * response, or close the connection.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

export interface SPDYConnectionOptions {
  host: string;
  port?: number;
  timeout?: number;
}

/**
 * Build a SPDY/3 SETTINGS control frame with 0 settings entries.
 *
 * Control Frame layout (SPDY/3 spec §2.6):
 *   Bit 0      : 1 (control frame)
 *   Bits 1-15  : version = 3
 *   Bits 16-31 : type = 4 (SETTINGS)
 *   Bits 32-39 : flags = 0
 *   Bits 40-63 : length = 4 (just the count field)
 *   Bits 64-95 : Number-of-entries = 0
 */
function buildSPDYSettings(): Uint8Array {
  const frame = new Uint8Array(12);
  const view = new DataView(frame.buffer);
  view.setUint16(0, 0x8003, false); // Control bit=1, version=3
  view.setUint16(2, 0x0004, false); // Type = SETTINGS (4)
  view.setUint8(4, 0x00);           // Flags = 0
  // 3-byte length field = 4 (number-of-entries uint32)
  frame[5] = 0x00;
  frame[6] = 0x00;
  frame[7] = 0x04;
  view.setUint32(8, 0, false);      // Number of entries = 0
  return frame;
}

/**
 * Interpret the first bytes of a server response to identify the protocol
 */
function detectProtocol(data: Uint8Array): {
  protocol: 'spdy3' | 'http2' | 'http1' | 'tls-alert' | 'unknown';
  detail: string;
} {
  if (data.length === 0) return { protocol: 'unknown', detail: 'Empty response' };

  const decoder = new TextDecoder();
  const text = decoder.decode(data.slice(0, Math.min(32, data.length)));

  // HTTP/2 client preface sentinel (server echoes it or sends SETTINGS)
  // HTTP/2 SETTINGS frame starts with 0x00 0x00 (length hi), type 0x04
  if (data[0] === 0x00 && data.length >= 9 && data[3] === 0x04) {
    return { protocol: 'http2', detail: 'Server responded with HTTP/2 SETTINGS frame — SPDY not supported, HTTP/2 active' };
  }

  // HTTP/1.x response
  if (text.startsWith('HTTP/1')) {
    return { protocol: 'http1', detail: `HTTP/1.x response: ${text.split('\r\n')[0]}` };
  }

  // SPDY/3 SETTINGS (control bit + version=3 + type=4)
  if (data[0] === 0x80 && data[1] === 0x03 && data[2] === 0x00 && data[3] === 0x04) {
    return { protocol: 'spdy3', detail: 'SPDY/3 SETTINGS frame received — server supports SPDY!' };
  }

  // TLS alert (starts with 0x15 = alert record type)
  if (data[0] === 0x15) {
    return { protocol: 'tls-alert', detail: `TLS alert received (level=${data[1]}, desc=${data[2]}) — server rejected the connection` };
  }

  const hex = Array.from(data.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  return { protocol: 'unknown', detail: `Unknown response: ${hex}` };
}

/**
 * Handle SPDY connectivity probe
 */
export async function handleSPDYConnect(request: Request): Promise<Response> {
  try {
    let options: Partial<SPDYConnectionOptions>;
    if (request.method === 'POST') {
      options = await request.json() as Partial<SPDYConnectionOptions>;
    } else {
      const url = new URL(request.url);
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '443'),
        timeout: parseInt(url.searchParams.get('timeout') || '10000'),
      };
    }

    if (!options.host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 443;
    const timeoutMs = options.timeout || 10000;

    // Check if behind Cloudflare
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
      // Connect with TLS — Cloudflare Workers negotiates TLS but ALPN cannot
      // be explicitly set to "spdy/3.1" from the Sockets API, so the server
      // will negotiate its preferred protocol (typically h2 or http/1.1).
      const socket = connect(`${host}:${port}`, {
        secureTransport: 'on',
        allowHalfOpen: false,
      });
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Send a SPDY/3 SETTINGS frame
        const settingsFrame = buildSPDYSettings();
        await writer.write(settingsFrame);
        writer.releaseLock();

        // Read server response (may be immediate close or protocol mismatch)
        const { value } = await Promise.race([
          reader.read(),
          new Promise<{ value: undefined; done: true }>((_, reject) =>
            setTimeout(() => reject(new Error('No response from server')), 5000),
          ),
        ]);

        reader.releaseLock();
        await socket.close();

        if (!value || value.length === 0) {
          return {
            success: false,
            host,
            port,
            tlsConnected: true,
            spdyDetected: false,
            protocol: 'unknown',
            message: 'TLS connected but server sent no response to SPDY SETTINGS',
            note: 'SPDY is deprecated (2016). Most servers have dropped support in favor of HTTP/2.',
          };
        }

        const detected = detectProtocol(value);

        return {
          success: true,
          host,
          port,
          tlsConnected: true,
          spdyDetected: detected.protocol === 'spdy3',
          protocol: detected.protocol,
          message: detected.detail,
          note: 'SPDY is deprecated (2016). Most servers have dropped support in favor of HTTP/2. Note: ALPN "spdy/3.1" cannot be explicitly set via the Cloudflare Sockets API, so TLS negotiation uses the server\'s default (h2/http1.1).',
        };
      } catch (err) {
        try { reader.releaseLock(); } catch (_) { /* ignore */ }
        try { await socket.close(); } catch (_) { /* ignore */ }

        // If we got here after socket.opened, TLS connected but read timed out
        return {
          success: true,
          host,
          port,
          tlsConnected: true,
          spdyDetected: false,
          protocol: 'unknown',
          message: err instanceof Error ? err.message : 'TLS connected; SPDY probe timed out',
          note: 'SPDY is deprecated (2016). Most servers have dropped support in favor of HTTP/2.',
        };
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs),
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({
        success: false,
        tlsConnected: false,
        error: err instanceof Error ? err.message : 'Connection failed',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : 'Unexpected error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ── HTTP/2 probe ──────────────────────────────────────────────────────────────

const H2_PREFACE = new Uint8Array([
  0x50, 0x52, 0x49, 0x20, 0x2a, 0x20, 0x48, 0x54, // PRI * HT
  0x54, 0x50, 0x2f, 0x32, 0x2e, 0x30, 0x0d, 0x0a, // TP/2.0\r\n
  0x0d, 0x0a, 0x53, 0x4d, 0x0d, 0x0a, 0x0d, 0x0a, // \r\nSM\r\n\r\n
]);

const H2_SETTINGS_IDS: Record<number, string> = {
  1: 'HEADER_TABLE_SIZE',
  2: 'ENABLE_PUSH',
  3: 'MAX_CONCURRENT_STREAMS',
  4: 'INITIAL_WINDOW_SIZE',
  5: 'MAX_FRAME_SIZE',
  6: 'MAX_HEADER_LIST_SIZE',
};

/** Build an HTTP/2 frame (9-byte header + payload). */
function buildH2Frame(type: number, flags: number, streamId: number, payload: Uint8Array): Uint8Array {
  const len = payload.length;
  const frame = new Uint8Array(9 + len);
  const dv = new DataView(frame.buffer);
  // 24-bit length
  frame[0] = (len >> 16) & 0xff;
  frame[1] = (len >> 8) & 0xff;
  frame[2] = len & 0xff;
  frame[3] = type;
  frame[4] = flags;
  dv.setUint32(5, streamId & 0x7fffffff, false);
  frame.set(payload, 9);
  return frame;
}

/** SETTINGS frame with 0 entries (client preface settings). */
function buildH2Settings(): Uint8Array {
  return buildH2Frame(0x04, 0x00, 0, new Uint8Array(0));
}

/** SETTINGS ACK frame. */
function buildH2SettingsAck(): Uint8Array {
  return buildH2Frame(0x04, 0x01, 0, new Uint8Array(0));
}

/** WINDOW_UPDATE frame for connection (stream 0). */
function buildH2WindowUpdate(increment: number): Uint8Array {
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setUint32(0, increment & 0x7fffffff, false);
  return buildH2Frame(0x08, 0x00, 0, payload);
}

/**
 * Build HPACK-encoded HEADERS for GET / on stream 1.
 *
 * Uses static table indices (RFC 7541 Appendix A) with no Huffman encoding:
 *   :method GET      → indexed 0x82 (static index 2)
 *   :path /          → indexed 0x84 (static index 4)
 *   :scheme https    → indexed 0x87 (static index 7)
 *   :authority <host>→ literal incremental, name index 1 (0x41) + value
 */
function buildH2Headers(host: string, path = '/'): Uint8Array {
  const enc = new TextEncoder();
  const hostBytes = enc.encode(host);
  const pathBytes = enc.encode(path);

  const parts: Uint8Array[] = [];

  // :method GET (index 2 in static table = 0x82)
  parts.push(new Uint8Array([0x82]));

  // :path (literal, incremental index, name index 4 = 0x44) + value
  parts.push(new Uint8Array([0x44]));
  parts.push(new Uint8Array([pathBytes.length]));
  parts.push(pathBytes);

  // :scheme https (index 7 = 0x87)
  parts.push(new Uint8Array([0x87]));

  // :authority (literal, incremental index, name index 1 = 0x41) + value
  parts.push(new Uint8Array([0x41]));
  parts.push(new Uint8Array([hostBytes.length]));
  parts.push(hostBytes);

  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const hpack = new Uint8Array(totalLen);
  let off = 0;
  for (const p of parts) { hpack.set(p, off); off += p.length; }

  // END_HEADERS (0x04) | END_STREAM (0x01) = 0x05, stream 1
  return buildH2Frame(0x01, 0x05, 1, hpack);
}

/** Concat Uint8Arrays. */
function h2Concat(...arrs: Uint8Array[]): Uint8Array {
  const n = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(n);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

/** Parse HTTP/2 frames from a buffer. Returns array of parsed frames. */
function parseH2Frames(buf: Uint8Array): Array<{ type: number; flags: number; streamId: number; payload: Uint8Array }> {
  const frames = [];
  let off = 0;
  while (off + 9 <= buf.length) {
    const len = (buf[off] << 16) | (buf[off + 1] << 8) | buf[off + 2];
    const type = buf[off + 3];
    const flags = buf[off + 4];
    const streamId = new DataView(buf.buffer, buf.byteOffset + off + 5, 4).getUint32(0, false) & 0x7fffffff;
    const payloadEnd = off + 9 + len;
    if (payloadEnd > buf.length) break;
    frames.push({ type, flags, streamId, payload: buf.slice(off + 9, payloadEnd) });
    off = payloadEnd;
  }
  return frames;
}

/** Parse SETTINGS payload into a record of id→value. */
function parseH2SettingsPayload(payload: Uint8Array): Record<string, number> {
  const settings: Record<string, number> = {};
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  for (let i = 0; i + 6 <= payload.length; i += 6) {
    const id = dv.getUint16(i, false);
    const val = dv.getUint32(i + 2, false);
    const name = H2_SETTINGS_IDS[id] ?? `UNKNOWN_${id}`;
    settings[name] = val;
  }
  return settings;
}

/**
 * Parse HPACK-encoded response HEADERS (simplified, no Huffman decoding).
 * Handles indexed header fields and literal header fields (with/without indexing).
 * Returns a flat object of header name → value pairs.
 */
function parseHPACK(payload: Uint8Array): Record<string, string> {
  // Static HPACK table (RFC 7541 Appendix A) — entries we care about
  const staticTable: [string, string][] = [
    ['', ''],                     // index 0 unused
    [':authority', ''],           // 1
    [':method', 'GET'],           // 2
    [':method', 'POST'],          // 3
    [':path', '/'],               // 4
    [':path', '/index.html'],     // 5
    [':scheme', 'http'],          // 6
    [':scheme', 'https'],         // 7
    [':status', '200'],           // 8
    [':status', '204'],           // 9
    [':status', '206'],           // 10
    [':status', '304'],           // 11
    [':status', '400'],           // 12
    [':status', '404'],           // 13
    [':status', '500'],           // 14
    ['accept-charset', ''],       // 15
    ['accept-encoding', 'gzip, deflate'], // 16
    ['accept-language', ''],      // 17
    ['accept-ranges', ''],        // 18
    ['accept', ''],               // 19
    ['access-control-allow-origin', ''], // 20
    ['age', ''],                  // 21
    ['allow', ''],                // 22
    ['authorization', ''],        // 23
    ['cache-control', ''],        // 24
    ['content-disposition', ''],  // 25
    ['content-encoding', ''],     // 26
    ['content-language', ''],     // 27
    ['content-length', ''],       // 28
    ['content-location', ''],     // 29
    ['content-range', ''],        // 30
    ['content-type', ''],         // 31
    ['cookie', ''],               // 32
    ['date', ''],                 // 33
    ['etag', ''],                 // 34
    ['expect', ''],               // 35
    ['expires', ''],              // 36
    ['from', ''],                 // 37
    ['host', ''],                 // 38
    ['if-match', ''],             // 39
    ['if-modified-since', ''],    // 40
    ['if-none-match', ''],        // 41
    ['if-range', ''],             // 42
    ['if-unmodified-since', ''],  // 43
    ['last-modified', ''],        // 44
    ['link', ''],                 // 45
    ['location', ''],             // 46
    ['max-forwards', ''],         // 47
    ['proxy-authenticate', ''],   // 48
    ['proxy-authorization', ''],  // 49
    ['range', ''],                // 50
    ['referer', ''],              // 51
    ['refresh', ''],              // 52
    ['retry-after', ''],          // 53
    ['server', ''],               // 54
    ['set-cookie', ''],           // 55
    ['strict-transport-security', ''], // 56
    ['transfer-encoding', ''],    // 57
    ['user-agent', ''],           // 58
    ['vary', ''],                 // 59
    ['via', ''],                  // 60
    ['www-authenticate', ''],     // 61
  ];

  const headers: Record<string, string> = {};
  const dec = new TextDecoder();
  let i = 0;

  const readString = (): string => {
    if (i >= payload.length) return '';
    const firstByte = payload[i++];
    const huffman = (firstByte & 0x80) !== 0;
    // Length encoded in 7 bits
    let len = firstByte & 0x7f;
    if (len === 0x7f) {
      // Multi-byte length (simplified: read one more byte only)
      len = 0x7f + (payload[i++] || 0);
    }
    const raw = payload.slice(i, i + len);
    i += len;
    if (huffman) return '(huffman-encoded)';
    return dec.decode(raw);
  };

  while (i < payload.length) {
    const b = payload[i];

    if (b & 0x80) {
      // Indexed header field (RFC 7541 §6.1)
      const idx = b & 0x7f;
      i++;
      if (idx > 0 && idx < staticTable.length) {
        const [name, val] = staticTable[idx];
        if (name) headers[name] = val;
      }
    } else if ((b & 0xc0) === 0x40) {
      // Literal with incremental indexing (RFC 7541 §6.2.1)
      const nameIdx = b & 0x3f;
      i++;
      let name: string;
      if (nameIdx > 0 && nameIdx < staticTable.length) {
        name = staticTable[nameIdx][0];
      } else {
        name = readString();
      }
      const val = readString();
      if (name) headers[name] = val;
    } else if ((b & 0xf0) === 0x00 || (b & 0xf0) === 0x10) {
      // Literal without indexing / never indexed (RFC 7541 §6.2.2/§6.2.3)
      const nameIdx = b & 0x0f;
      i++;
      let name: string;
      if (nameIdx > 0 && nameIdx < staticTable.length) {
        name = staticTable[nameIdx][0];
      } else {
        name = readString();
      }
      const val = readString();
      if (name) headers[name] = val;
    } else {
      i++; // Skip unknown byte
    }
  }

  return headers;
}

/**
 * Full HTTP/2 probe over TLS.
 *
 * Flow:
 *  1. TLS connect
 *  2. Send: H2 client preface (24 bytes) + SETTINGS (9 bytes) + WINDOW_UPDATE (13 bytes)
 *  3. Read server frames until SETTINGS + SETTINGS ACK received
 *  4. Send SETTINGS ACK + HEADERS GET /
 *  5. Read response HEADERS (status, server banner, content-type, etc.)
 *  6. Close and return: h2Settings, statusCode, responseHeaders, latencyMs
 *
 * POST /api/spdy/h2-probe
 * Body: { host, port=443, path="/", timeout=15000 }
 * Returns: { h2Settings, statusCode, statusText, responseHeaders, serverBanner, latencyMs }
 */
export async function handleSPDYH2Probe(request: Request): Promise<Response> {
  const startMs = Date.now();
  try {
    const body = await request.json() as { host?: string; port?: number; path?: string; timeout?: number };
    const { host, port = 443, path = '/', timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const tp = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), timeout));

    const probePromise = (async () => {
      const socket = connect(`${host}:${port}`, { secureTransport: 'on', allowHalfOpen: false });
      await Promise.race([socket.opened, tp]);

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Step 1: Send HTTP/2 client preface + SETTINGS + WINDOW_UPDATE
        const opening = h2Concat(
          H2_PREFACE,
          buildH2Settings(),
          buildH2WindowUpdate(65535),
        );
        await writer.write(opening);

        // Step 2: Collect server frames (SETTINGS, SETTINGS ACK, possibly HEADERS)
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        let serverSettingsSeen = false;
        let settingsAckSeen = false;
        let responseHeadersSeen = false;
        const deadline = Date.now() + Math.min(timeout - 500, 8000);

        while (Date.now() < deadline && totalBytes < 65536) {
          const { value, done } = await Promise.race([
            reader.read(),
            new Promise<{ value: undefined; done: true }>(res =>
              setTimeout(() => res({ value: undefined, done: true }), Math.max(200, deadline - Date.now()))),
          ]);
          if (done || !value) break;
          chunks.push(value);
          totalBytes += value.length;

          // Quick scan for SETTINGS (type 4) and HEADERS (type 1)
          const partial = h2Concat(...chunks);
          const frames = parseH2Frames(partial);
          for (const f of frames) {
            if (f.type === 0x04 && (f.flags & 0x01) === 0) serverSettingsSeen = true;
            if (f.type === 0x04 && (f.flags & 0x01) !== 0) settingsAckSeen = true;
            if (f.type === 0x01) responseHeadersSeen = true;
          }

          if (serverSettingsSeen && !settingsAckSeen) {
            // Send SETTINGS ACK + HEADERS GET /
            const ackAndHeaders = h2Concat(
              buildH2SettingsAck(),
              buildH2Headers(host, path),
            );
            await writer.write(ackAndHeaders);
            settingsAckSeen = true;
          }

          if (responseHeadersSeen) break;
        }

        reader.releaseLock();
        writer.releaseLock();
        try { socket.close(); } catch { /* ignore */ }

        const buf = h2Concat(...chunks);
        const frames = parseH2Frames(buf);

        // Extract server SETTINGS
        let h2Settings: Record<string, number> = {};
        for (const f of frames) {
          if (f.type === 0x04 && (f.flags & 0x01) === 0 && f.streamId === 0) {
            h2Settings = parseH2SettingsPayload(f.payload);
            break;
          }
        }

        // Extract response HEADERS (stream 1)
        let statusCode: number | undefined;
        let responseHeaders: Record<string, string> = {};
        for (const f of frames) {
          if (f.type === 0x01 && f.streamId === 1) {
            responseHeaders = parseHPACK(f.payload);
            const status = responseHeaders[':status'];
            if (status) statusCode = parseInt(status);
            break;
          }
        }

        const serverBanner = responseHeaders['server'] ?? responseHeaders['via'] ?? undefined;
        const framesReceived = frames.map(f => ({
          type: f.type,
          typeName: ['DATA','HEADERS','PRIORITY','RST_STREAM','SETTINGS','PUSH_PROMISE','PING','GOAWAY','WINDOW_UPDATE','CONTINUATION'][f.type] ?? `0x${f.type.toString(16)}`,
          flags: f.flags,
          streamId: f.streamId,
          payloadLen: f.payload.length,
        }));

        return {
          success: true,
          host,
          port,
          path,
          protocol: 'HTTP/2',
          tlsConnected: true,
          h2Handshake: serverSettingsSeen,
          h2Settings,
          statusCode,
          responseHeaders: Object.fromEntries(
            Object.entries(responseHeaders).filter(([k]) => !k.startsWith(':'))
          ),
          requestHeaders: { ':status': statusCode?.toString() ?? '' },
          serverBanner,
          framesReceived,
          bytesReceived: totalBytes,
          latencyMs: Date.now() - startMs,
        };
      } catch (err) {
        try { reader.releaseLock(); } catch { /* ignore */ }
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { socket.close(); } catch { /* ignore */ }
        throw err;
      }
    })();

    const result = await Promise.race([probePromise, tp]);
    return new Response(JSON.stringify(result), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      latencyMs: Date.now() - startMs,
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
