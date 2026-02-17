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
