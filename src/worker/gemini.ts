/**
 * Gemini Protocol Implementation
 *
 * Gemini is a modern internet protocol that is heavier than Gopher but lighter than the Web.
 * It emphasizes privacy, simplicity, and user agency.
 *
 * Protocol Flow:
 * 1. Client connects to server on port 1965 via TLS
 * 2. Client sends single-line URL request: "gemini://host/path\r\n"
 * 3. Server responds with: "<STATUS> <META>\r\n" + optional body
 * 4. Connection closes
 *
 * Status Codes:
 * - 1x: INPUT (prompt user for input)
 * - 2x: SUCCESS (body contains gemtext)
 * - 3x: REDIRECT
 * - 4x: TEMPORARY FAILURE
 * - 5x: PERMANENT FAILURE
 * - 6x: CLIENT CERTIFICATE REQUIRED
 *
 * Use Cases:
 * - Alternative web browsing
 * - Privacy-focused content delivery
 * - Lightweight content distribution
 * - Educational protocol demonstration
 */

import { connect } from 'cloudflare:sockets';

interface GeminiRequest {
  url: string;
  timeout?: number;
}

interface GeminiResponse {
  success: boolean;
  status?: number;
  meta?: string;
  body?: string;
  error?: string;
}

/**
 * Parse Gemini URL
 */
function parseGeminiUrl(url: string): { host: string; port: number; path: string } | null {
  // Support both gemini:// and plain host/path
  let cleanUrl = url.trim();

  if (cleanUrl.startsWith('gemini://')) {
    cleanUrl = cleanUrl.substring(9); // Remove 'gemini://'
  }

  // Split host and path
  const slashIndex = cleanUrl.indexOf('/');
  let host: string;
  let path: string;

  if (slashIndex === -1) {
    host = cleanUrl;
    path = '/';
  } else {
    host = cleanUrl.substring(0, slashIndex);
    path = cleanUrl.substring(slashIndex);
  }

  // Extract port if specified
  let port = 1965;
  const colonIndex = host.indexOf(':');
  if (colonIndex !== -1) {
    port = parseInt(host.substring(colonIndex + 1));
    host = host.substring(0, colonIndex);
  }

  if (!host) {
    return null;
  }

  return { host, port, path };
}

/**
 * Handle Gemini fetch request
 */
export async function handleGeminiFetch(request: Request): Promise<Response> {
  try {
    const body = await request.json() as GeminiRequest;
    const { url, timeout = 10000 } = body;

    // Validation
    if (!url) {
      return new Response(JSON.stringify({
        success: false,
        error: 'URL is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Parse URL
    const parsed = parseGeminiUrl(url);
    if (!parsed) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid Gemini URL format',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { host, port, path } = parsed;

    // Build full Gemini URL for request
    const geminiUrl = `gemini://${host}${path}`;

    // Connect to Gemini server with TLS
    const socket = connect(`${host}:${port}`, {
      secureTransport: 'on', // Enable TLS
      allowHalfOpen: false,
    });

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      // Wait for connection with timeout
      await Promise.race([
        socket.opened,
        timeoutPromise,
      ]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send Gemini request: URL + \r\n
      const requestLine = geminiUrl + '\r\n';
      const requestBytes = new TextEncoder().encode(requestLine);
      try {
        await writer.write(requestBytes);
      } finally {
        writer.releaseLock();
      }

      // Read response
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const maxResponseSize = 5242880; // 5MB limit

      try {
        while (true) {
          const { value, done } = await Promise.race([
            reader.read(),
            timeoutPromise,
          ]);

          if (done) break;

          if (value) {
            // Prevent excessive data (check before accumulating)
            if (totalBytes + value.length > maxResponseSize) {
              throw new Error('Response too large (max 5MB)');
            }
            chunks.push(value);
            totalBytes += value.length;
          }
        }
      } catch (error) {
        // Connection closed or error
        if (chunks.length === 0 && error instanceof Error && error.message !== 'Connection timeout') {
          throw new Error('No response from server');
        } else if (error instanceof Error && error.message === 'Connection timeout') {
          throw error;
        }
      }

      // Combine chunks
      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      // Decode response
      const responseText = new TextDecoder().decode(combined);

      // Parse Gemini response
      // Format: <STATUS><SPACE><META><CR><LF>[BODY]
      const crlfIndex = responseText.indexOf('\r\n');
      if (crlfIndex === -1) {
        throw new Error('Invalid Gemini response format');
      }

      const headerLine = responseText.substring(0, crlfIndex);
      const body = responseText.substring(crlfIndex + 2);

      // Parse status and meta
      const spaceIndex = headerLine.indexOf(' ');
      if (spaceIndex === -1) {
        throw new Error('Invalid Gemini header format');
      }

      const statusStr = headerLine.substring(0, spaceIndex);
      const meta = headerLine.substring(spaceIndex + 1);

      const status = parseInt(statusStr);
      if (isNaN(status)) {
        throw new Error('Invalid status code');
      }

      // Clean up
      reader.releaseLock();
      socket.close();

      const result: GeminiResponse = {
        success: true,
        status,
        meta,
        body,
      };

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      // Connection or read error
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
