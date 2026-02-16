/**
 * FTPS (FTP over TLS) Protocol Implementation
 *
 * Implements implicit FTPS connectivity testing (RFC 4217).
 * Connects via TLS to port 990 and reads the server banner,
 * then optionally sends FEAT to discover supported features.
 *
 * Protocol:
 * - Implicit FTPS: TLS from the start on port 990
 * - Same FTP commands but over encrypted channel
 * - Server sends 220 welcome banner after TLS handshake
 *
 * Use Cases:
 * - Secure file transfer server discovery
 * - FTPS server version fingerprinting
 * - TLS certificate and cipher verification
 * - Feature detection (FEAT command)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/**
 * Read a complete FTP response (may be multi-line)
 */
function parseFTPResponse(text: string): { code: number; message: string; lines: string[] } {
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  const code = parseInt(lines[0]?.substring(0, 3) || '0', 10);
  const message = lines[0]?.substring(4) || '';
  return { code, message, lines };
}

/**
 * Handle FTPS connection test
 */
export async function handleFTPSConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 990, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535',
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

    const startTime = Date.now();

    // Connect with implicit TLS
    const socket = connect(`${host}:${port}`, {
      secureTransport: 'on',
      allowHalfOpen: false,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);
    const connectTime = Date.now() - startTime;

    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    // Helper to read response with timeout
    const readResponse = async (): Promise<string> => {
      let responseText = '';
      const readTimeout = new Promise<{ value: undefined; done: true }>((resolve) => {
        setTimeout(() => resolve({ value: undefined, done: true }), Math.min(timeout, 5000));
      });

      while (true) {
        const result = await Promise.race([reader.read(), readTimeout]);
        if (result.done || !result.value) break;
        responseText += decoder.decode(result.value, { stream: true });
        // Check if we have a complete FTP response (ends with \r\n and has 3-digit code)
        if (/^\d{3} .+\r?\n$/m.test(responseText)) break;
        if (/^\d{3}-.+\r?\n\d{3} .+\r?\n$/ms.test(responseText)) break;
      }

      return responseText.trim();
    };

    // Read welcome banner
    const bannerText = await Promise.race([readResponse(), timeoutPromise]) as string;
    const banner = parseFTPResponse(bannerText);

    if (banner.code < 200 || banner.code >= 300) {
      writer.releaseLock();
      reader.releaseLock();
      socket.close();
      return new Response(JSON.stringify({
        success: false,
        error: `FTPS server error: ${bannerText}`,
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Send FEAT to discover features
    let features: string[] = [];
    let featRaw = '';
    try {
      await writer.write(encoder.encode('FEAT\r\n'));
      featRaw = await Promise.race([readResponse(), timeoutPromise]) as string;
      const featParsed = parseFTPResponse(featRaw);
      if (featParsed.code === 211) {
        // Extract feature lines (lines between 211- and 211 End)
        features = featParsed.lines
          .slice(1) // skip first "211-" line
          .filter(l => !l.startsWith('211 '))
          .map(l => l.trim());
      }
    } catch {
      // FEAT not supported - that's ok
    }

    // Send SYST to get system type
    let systemType = '';
    try {
      await writer.write(encoder.encode('SYST\r\n'));
      const systRaw = await Promise.race([readResponse(), timeoutPromise]) as string;
      const systParsed = parseFTPResponse(systRaw);
      if (systParsed.code === 215) {
        systemType = systParsed.message;
      }
    } catch {
      // SYST not supported
    }

    // Send QUIT
    try {
      await writer.write(encoder.encode('QUIT\r\n'));
    } catch {
      // Ignore quit errors
    }

    const rtt = Date.now() - startTime;

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      connectTime,
      encrypted: true,
      protocol: 'FTPS (Implicit TLS)',
      banner: {
        code: banner.code,
        message: banner.message,
        raw: bannerText,
      },
      systemType: systemType || undefined,
      features: features.length > 0 ? features : undefined,
      tlsFeatures: {
        authTls: features.some(f => f.toUpperCase().includes('AUTH TLS')),
        pbsz: features.some(f => f.toUpperCase().includes('PBSZ')),
        prot: features.some(f => f.toUpperCase().includes('PROT')),
        utf8: features.some(f => f.toUpperCase().includes('UTF8')),
        mlst: features.some(f => f.toUpperCase().includes('MLST')),
        epsv: features.some(f => f.toUpperCase().includes('EPSV')),
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

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
