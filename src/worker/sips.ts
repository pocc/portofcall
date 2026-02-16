/**
 * SIPS Protocol Implementation (RFC 3261 with TLS)
 *
 * SIPS (SIP Secure) is the secure version of the Session Initiation Protocol,
 * using TLS (Transport Layer Security) to encrypt signaling messages.
 * It's used for secure VoIP, video calling, and instant messaging.
 *
 * Protocol Flow:
 * 1. Client establishes TLS connection to SIPS server on port 5061
 * 2. Client sends SIP request (OPTIONS, REGISTER, INVITE, etc.)
 * 3. Server responds with SIP status code (1xx-6xx)
 * 4. TLS ensures privacy and integrity of signaling
 *
 * RFC 3261 specifies SIP
 * RFC 5630 specifies the SIPS URI scheme
 * RFC 5246 specifies TLS 1.2
 *
 * SIPS Request Format:
 * <METHOD> <Request-URI> SIP/2.0
 * Via: SIP/2.0/TLS <client-address>;branch=<branch-id>
 * From: <from-uri>;tag=<from-tag>
 * To: <to-uri>
 * Call-ID: <call-id>
 * CSeq: <sequence> <METHOD>
 * Max-Forwards: 70
 * User-Agent: <agent-string>
 * Content-Length: 0
 *
 * SIP Response Format:
 * SIP/2.0 <status-code> <reason-phrase>
 * Via: <via-from-request>
 * From: <from-from-request>
 * To: <to-from-request>;tag=<to-tag>
 * Call-ID: <call-id-from-request>
 * CSeq: <cseq-from-request>
 * Content-Length: <length>
 *
 * Status Codes:
 * - 1xx: Informational (100 Trying, 180 Ringing)
 * - 2xx: Success (200 OK)
 * - 3xx: Redirection (301 Moved Permanently)
 * - 4xx: Client Error (401 Unauthorized, 404 Not Found)
 * - 5xx: Server Error (500 Internal Server Error)
 * - 6xx: Global Failure (603 Decline)
 *
 * Use Cases:
 * - Secure VoIP signaling
 * - Private video conferencing
 * - Encrypted instant messaging setup
 * - Enterprise communications
 */

import { connect } from 'cloudflare:sockets';

interface SipsRequest {
  host: string;
  port?: number;
  method: 'OPTIONS' | 'REGISTER' | 'INVITE';
  fromUri: string;
  toUri?: string;
  username?: string;
  password?: string;
  timeout?: number;
}

interface SipsResponse {
  success: boolean;
  host: string;
  port: number;
  statusCode?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  callId?: string;
  rtt?: number;
  error?: string;
}

/**
 * Generate a random Call-ID for SIP.
 */
function generateCallId(): string {
  const random = Math.random().toString(36).substring(2, 15);
  return `${random}@portofcall`;
}

/**
 * Generate a random branch ID for Via header.
 */
function generateBranch(): string {
  const random = Math.random().toString(36).substring(2, 15);
  return `z9hG4bK${random}`;
}

/**
 * Generate a random tag for From/To headers.
 */
function generateTag(): string {
  return Math.random().toString(36).substring(2, 11);
}

/**
 * Encode a SIPS request.
 */
function encodeSipsRequest(params: {
  method: string;
  requestUri: string;
  fromUri: string;
  toUri: string;
  callId: string;
  branch: string;
  fromTag: string;
  localAddress: string;
}): string {
  const { method, requestUri, fromUri, toUri, callId, branch, fromTag, localAddress } = params;

  const request = [
    `${method} ${requestUri} SIP/2.0`,
    `Via: SIP/2.0/TLS ${localAddress};branch=${branch}`,
    `From: <${fromUri}>;tag=${fromTag}`,
    `To: <${toUri}>`,
    `Call-ID: ${callId}`,
    `CSeq: 1 ${method}`,
    `Max-Forwards: 70`,
    `User-Agent: PortOfCall/1.0`,
    `Content-Length: 0`,
    '',
    '',
  ].join('\r\n');

  return request;
}

/**
 * Parse a SIPS response.
 */
function parseSipsResponse(data: string): {
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
} | null {
  const lines = data.split('\r\n');

  if (lines.length < 1) {
    return null;
  }

  // Parse status line: SIP/2.0 <code> <text>
  const statusLine = lines[0];
  const statusMatch = statusLine.match(/^SIP\/2\.0\s+(\d+)\s+(.*)$/);

  if (!statusMatch) {
    return null;
  }

  const statusCode = parseInt(statusMatch[1], 10);
  const statusText = statusMatch[2];

  // Parse headers
  const headers: Record<string, string> = {};
  let i = 1;

  for (; i < lines.length; i++) {
    const line = lines[i];

    // Empty line marks end of headers
    if (line.trim() === '') {
      i++;
      break;
    }

    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const headerName = line.substring(0, colonIndex).trim();
      const headerValue = line.substring(colonIndex + 1).trim();
      headers[headerName] = headerValue;
    }
  }

  // Rest is body
  const body = lines.slice(i).join('\r\n').trim();

  return {
    statusCode,
    statusText,
    headers,
    body,
  };
}

/**
 * Send a SIPS OPTIONS request to probe server capabilities.
 */
export async function handleSipsOptions(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SipsRequest;
    const {
      host,
      port = 5061,
      fromUri,
      toUri,
      timeout = 15000,
    } = body;

    // Validation
    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies SipsResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!fromUri) {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        error: 'fromUri is required (e.g., "sips:alice@example.com")',
      } satisfies SipsResponse), {
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
      } satisfies SipsResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    // Generate SIP identifiers
    const callId = generateCallId();
    const branch = generateBranch();
    const fromTag = generateTag();

    const requestUri = toUri || `sips:${host}`;
    const finalToUri = toUri || requestUri;

    // Encode SIPS OPTIONS request
    const sipsRequest = encodeSipsRequest({
      method: 'OPTIONS',
      requestUri,
      fromUri,
      toUri: finalToUri,
      callId,
      branch,
      fromTag,
      localAddress: 'portofcall.invalid:5061',
    });

    // Connect to SIPS server with TLS
    const socket = connect(`${host}:${port}`, {
      secureTransport: 'on',
      allowHalfOpen: false,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send SIPS request
      const requestBytes = new TextEncoder().encode(sipsRequest);
      await writer.write(requestBytes);
      writer.releaseLock();

      // Read response
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const maxResponseSize = 16384; // 16KB

      const readTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Response timeout')), timeout);
      });

      try {
        while (true) {
          const { value, done } = await Promise.race([
            reader.read(),
            readTimeout,
          ]);

          if (done) break;

          if (value) {
            chunks.push(value);
            totalBytes += value.length;

            if (totalBytes > maxResponseSize) {
              break;
            }

            // Check if we have complete response (double CRLF after headers)
            const responseText = new TextDecoder().decode(
              new Uint8Array(chunks.flatMap((c) => Array.from(c)))
            );

            if (responseText.includes('\r\n\r\n')) {
              // Got complete response (or at least headers)
              const contentLengthMatch = responseText.match(/Content-Length:\s*(\d+)/i);
              if (contentLengthMatch) {
                const contentLength = parseInt(contentLengthMatch[1], 10);
                const headersEnd = responseText.indexOf('\r\n\r\n') + 4;
                const bodyLength = responseText.length - headersEnd;

                if (bodyLength >= contentLength) {
                  break; // Complete response received
                }
              } else {
                break; // No body expected
              }
            }
          }
        }
      } catch (error) {
        // Socket might close after response
        if (chunks.length === 0) {
          throw error;
        }
      }

      const rtt = Date.now() - start;

      // Combine chunks
      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      const responseText = new TextDecoder().decode(combined);

      reader.releaseLock();
      socket.close();

      if (!responseText) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Empty response from server',
        } satisfies SipsResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Parse SIPS response
      const parsed = parseSipsResponse(responseText);

      if (!parsed) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Invalid SIPS response format',
        } satisfies SipsResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const isSuccess = parsed.statusCode >= 200 && parsed.statusCode < 300;

      return new Response(JSON.stringify({
        success: isSuccess,
        host,
        port,
        statusCode: parsed.statusCode,
        statusText: parsed.statusText,
        headers: parsed.headers,
        body: parsed.body || undefined,
        callId,
        rtt,
      } satisfies SipsResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      socket.close();
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      host: '',
      port: 5061,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies SipsResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Send a SIPS REGISTER request.
 */
export async function handleSipsRegister(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SipsRequest;
    const {
      host,
      port = 5061,
      fromUri,
      username: _username,
      password: _password,
      timeout = 15000,
    } = body;

    // Validation
    if (!host || !fromUri) {
      return new Response(JSON.stringify({
        success: false,
        host: host || '',
        port,
        error: 'host and fromUri are required',
      } satisfies SipsResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    // Generate SIP identifiers
    const callId = generateCallId();
    const branch = generateBranch();
    const fromTag = generateTag();

    const requestUri = `sips:${host}`;

    // Build REGISTER request
    const registerLines = [
      `REGISTER ${requestUri} SIP/2.0`,
      `Via: SIP/2.0/TLS portofcall.invalid:5061;branch=${branch}`,
      `From: <${fromUri}>;tag=${fromTag}`,
      `To: <${fromUri}>`,
      `Call-ID: ${callId}`,
      `CSeq: 1 REGISTER`,
      `Max-Forwards: 70`,
      `Contact: <${fromUri}>`,
      `Expires: 3600`,
      `User-Agent: PortOfCall/1.0`,
      `Content-Length: 0`,
      '',
      '',
    ];

    const sipsRequest = registerLines.join('\r\n');

    // Connect to SIPS server with TLS
    const socket = connect(`${host}:${port}`, {
      secureTransport: 'on',
      allowHalfOpen: false,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send SIPS REGISTER request
      const requestBytes = new TextEncoder().encode(sipsRequest);
      await writer.write(requestBytes);
      writer.releaseLock();

      // Read response
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const maxResponseSize = 16384; // 16KB

      const readTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Response timeout')), timeout);
      });

      try {
        while (true) {
          const { value, done } = await Promise.race([
            reader.read(),
            readTimeout,
          ]);

          if (done) break;

          if (value) {
            chunks.push(value);
            totalBytes += value.length;

            if (totalBytes > maxResponseSize) {
              break;
            }

            // Check for complete response
            const responseText = new TextDecoder().decode(
              new Uint8Array(chunks.flatMap((c) => Array.from(c)))
            );

            if (responseText.includes('\r\n\r\n')) {
              break;
            }
          }
        }
      } catch (error) {
        if (chunks.length === 0) {
          throw error;
        }
      }

      const rtt = Date.now() - start;

      // Combine chunks
      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      const responseText = new TextDecoder().decode(combined);

      reader.releaseLock();
      socket.close();

      // Parse response
      const parsed = parseSipsResponse(responseText);

      if (!parsed) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Invalid SIPS response format',
        } satisfies SipsResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const isSuccess = parsed.statusCode >= 200 && parsed.statusCode < 300;

      return new Response(JSON.stringify({
        success: isSuccess,
        host,
        port,
        statusCode: parsed.statusCode,
        statusText: parsed.statusText,
        headers: parsed.headers,
        body: parsed.body || undefined,
        callId,
        rtt,
      } satisfies SipsResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      socket.close();
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      host: '',
      port: 5061,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies SipsResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
