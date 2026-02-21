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
  requiresAuth?: boolean;
  message?: string;
  raw?: string;
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
 * Extract the To-tag from a raw SIP response.
 * The server adds a tag parameter to the To header in its responses,
 * which must be included in subsequent ACK and BYE requests.
 */
function extractToTag(rawResponse: string): string | undefined {
  for (const line of rawResponse.split('\r\n')) {
    if (/^To\s*:/i.test(line)) {
      const tagMatch = line.match(/;tag=([^\s;,]+)/i);
      return tagMatch ? tagMatch[1] : undefined;
    }
  }
  return undefined;
}

/**
 * Build the To header value, including the server's to-tag when available.
 * RFC 3261 requires the ACK/BYE To header to mirror the response's To header.
 */
function buildToHeaderWithTag(toUri: string, toTag?: string): string {
  return toTag ? `<${toUri}>;tag=${toTag}` : `<${toUri}>`;
}

/**
 * Handle SIPS INVITE — initiate a secure SIP session and observe server response
 *
 * Cleanup per RFC 3261 §13.2.2.4:
 * - No final response received: send CANCEL to abort the pending transaction
 * - 2xx response: send ACK (establishes dialog), then BYE (tears it down)
 * - Other non-2xx (3xx-6xx): send ACK to complete the transaction
 */
export async function handleSipsInvite(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SipsRequest & { to?: string };
    const { host, port = 5061, fromUri, timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, host: '', port, error: 'Host is required' } satisfies SipsResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (!fromUri) {
      return new Response(JSON.stringify({ success: false, host, port, error: 'fromUri is required' } satisfies SipsResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const callId = generateCallId();
    const branch = generateBranch();
    const fromTag = generateTag();
    const toUri = body.toUri || `sips:${host}`;

    // Minimal SDP offer for audio
    const sdp = [
      'v=0',
      `o=portofcall 0 0 IN IP4 0.0.0.0`,
      's=Port of Call probe',
      'c=IN IP4 0.0.0.0',
      't=0 0',
      'm=audio 0 RTP/AVP 0',
      'a=sendrecv',
    ].join('\r\n') + '\r\n';
    const sdpBytes = new TextEncoder().encode(sdp).length;

    const inviteLines = [
      `INVITE ${toUri} SIP/2.0`,
      `Via: SIP/2.0/TLS ${host}:${port};branch=${branch}`,
      `From: <${fromUri}>;tag=${fromTag}`,
      `To: <${toUri}>`,
      `Call-ID: ${callId}`,
      `CSeq: 1 INVITE`,
      `Max-Forwards: 70`,
      `Contact: <${fromUri}>`,
      `Content-Type: application/sdp`,
      `Content-Length: ${sdpBytes}`,
      '',
      sdp,
    ].join('\r\n');

    const start = Date.now();
    const socket = connect(`${host}:${port}`, { secureTransport: 'on', allowHalfOpen: false });
    const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout));

    try {
      await Promise.race([socket.opened, timeoutPromise]);
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      await writer.write(new TextEncoder().encode(inviteLines));

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      let responseText = '';
      let finalCode = 0;

      const readTimeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Response timeout')), timeout));

      try {
        while (finalCode < 200) {
          const { value, done } = await Promise.race([reader.read(), readTimeout]);
          if (done) break;
          if (value) {
            chunks.push(value);
            totalBytes += value.length;
            if (totalBytes > 16384) break;
            responseText = new TextDecoder().decode(new Uint8Array(chunks.flatMap(c => Array.from(c))));
            for (const line of responseText.split('\r\n')) {
              const m = line.match(/^SIP\/2\.0 (\d+)/);
              if (m && parseInt(m[1], 10) >= 200) { finalCode = parseInt(m[1], 10); break; }
            }
          }
        }
      } catch { /* timeout */ }

      const rtt = Date.now() - start;
      const parsed = parseSipsResponse(responseText);
      const toTag = extractToTag(responseText);

      // --- Dialog / transaction cleanup per RFC 3261 ---
      try {
        if (finalCode === 0) {
          // No final response yet -- send CANCEL to abort the pending INVITE
          const cancel = [
            `CANCEL ${toUri} SIP/2.0`,
            `Via: SIP/2.0/TLS ${host}:${port};branch=${branch}`,
            `From: <${fromUri}>;tag=${fromTag}`,
            `To: ${buildToHeaderWithTag(toUri, toTag)}`,
            `Call-ID: ${callId}`,
            `CSeq: 1 CANCEL`,
            `Max-Forwards: 70`,
            `Content-Length: 0`,
            '', '',
          ].join('\r\n');
          await writer.write(new TextEncoder().encode(cancel));
        } else if (finalCode >= 200 && finalCode < 300) {
          // 2xx success -- send ACK to confirm, then BYE to tear down
          const ackBranch = generateBranch();
          const ack = [
            `ACK ${toUri} SIP/2.0`,
            `Via: SIP/2.0/TLS ${host}:${port};branch=${ackBranch}`,
            `From: <${fromUri}>;tag=${fromTag}`,
            `To: ${buildToHeaderWithTag(toUri, toTag)}`,
            `Call-ID: ${callId}`,
            `CSeq: 1 ACK`,
            `Max-Forwards: 70`,
            `Content-Length: 0`,
            '', '',
          ].join('\r\n');
          await writer.write(new TextEncoder().encode(ack));

          // BYE to tear down the established dialog
          const byeBranch = generateBranch();
          const bye = [
            `BYE ${toUri} SIP/2.0`,
            `Via: SIP/2.0/TLS ${host}:${port};branch=${byeBranch}`,
            `From: <${fromUri}>;tag=${fromTag}`,
            `To: ${buildToHeaderWithTag(toUri, toTag)}`,
            `Call-ID: ${callId}`,
            `CSeq: 2 BYE`,
            `Max-Forwards: 70`,
            `Content-Length: 0`,
            '', '',
          ].join('\r\n');
          await writer.write(new TextEncoder().encode(bye));
        } else {
          // Non-2xx final response (3xx-6xx) -- send ACK to complete transaction
          // Per RFC 3261 Section 17.1.1.3, ACK for non-2xx uses the same branch
          const ack = [
            `ACK ${toUri} SIP/2.0`,
            `Via: SIP/2.0/TLS ${host}:${port};branch=${branch}`,
            `From: <${fromUri}>;tag=${fromTag}`,
            `To: ${buildToHeaderWithTag(toUri, toTag)}`,
            `Call-ID: ${callId}`,
            `CSeq: 1 ACK`,
            `Max-Forwards: 70`,
            `Content-Length: 0`,
            '', '',
          ].join('\r\n');
          await writer.write(new TextEncoder().encode(ack));
        }
      } catch { /* ignore cleanup errors -- best effort */ }

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const statusCode = parsed?.statusCode ?? 0;
      const statusText = parsed?.statusText ?? '';
      return new Response(JSON.stringify({
        success: statusCode > 0,
        host, port,
        statusCode,
        statusText,
        requiresAuth: statusCode === 401 || statusCode === 407,
        rtt,
        message: statusCode > 0 ? `INVITE ${statusCode} ${statusText} in ${rtt}ms` : `INVITE sent, no valid response in ${rtt}ms`,
        raw: responseText.substring(0, 2000),
      } satisfies SipsResponse), { headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, host: '', port: 5061, error: error instanceof Error ? error.message : 'Unknown error' } satisfies SipsResponse),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle SIPS REGISTER probe - test registration and auth requirements
 */
export async function handleSipsRegister(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SipsRequest;
    const {
      host,
      port = 5061,
      fromUri,
      username,
      password,
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

      // Send initial SIPS REGISTER request
      const requestBytes = new TextEncoder().encode(sipsRequest);
      await writer.write(requestBytes);

      // Read response using shared helper
      const responseText = await readSipsResponseText(reader, timeout);

      const rtt = Date.now() - start;

      // Parse response
      const parsed = parseSipsResponse(responseText);

      if (!parsed) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
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

      // Handle 401/407 Digest authentication challenge when credentials are provided
      if ((parsed.statusCode === 401 || parsed.statusCode === 407) && username && password) {
        const wwwAuth = parsed.headers['www-authenticate'] || parsed.headers['WWW-Authenticate']
                     || parsed.headers['proxy-authenticate'] || parsed.headers['Proxy-Authenticate'];

        if (wwwAuth) {
          // Extract the SIP domain from the fromUri for digest computation
          const domainMatch = fromUri.match(/@(.+)$/);
          const sipDomain = domainMatch ? domainMatch[1] : host;
          const digestUri = `sips:${sipDomain}`;

          // Parse digest challenge parameters
          const realm = (wwwAuth.match(/realm="([^"]+)"/i) ?? [])[1] ?? sipDomain;
          const nonce = (wwwAuth.match(/nonce="([^"]+)"/i) ?? [])[1] ?? '';
          const algorithm = ((wwwAuth.match(/algorithm=([^\s,]+)/i) ?? [])[1] ?? 'MD5').toUpperCase();
          const qopOffered = (wwwAuth.match(/qop="([^"]+)"/i) ?? [])[1] ?? '';
          const useQop = qopOffered.split(',').map((q: string) => q.trim()).includes('auth') ? 'auth' : '';

          // RFC 2617 digest computation
          const ha1 = md5(`${username}:${realm}:${password}`);
          const ha2 = md5(`REGISTER:${digestUri}`);
          const nc = '00000001';
          const cnonce = Math.random().toString(36).substring(2, 10);
          const digestResp = useQop === 'auth'
            ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`)
            : md5(`${ha1}:${nonce}:${ha2}`);

          // Build authenticated REGISTER
          const branch2 = generateBranch();
          const authHeaderName = parsed.statusCode === 407 ? 'Proxy-Authorization' : 'Authorization';
          let authVal = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${digestUri}", algorithm=${algorithm}, response="${digestResp}"`;
          if (useQop === 'auth') authVal += `, qop=auth, nc=${nc}, cnonce="${cnonce}"`;

          const reg2 = [
            `REGISTER ${requestUri} SIP/2.0`,
            `Via: SIP/2.0/TLS portofcall.invalid:5061;branch=${branch2}`,
            `From: <${fromUri}>;tag=${fromTag}`,
            `To: <${fromUri}>`,
            `Call-ID: ${callId}`,
            `CSeq: 2 REGISTER`,
            `Max-Forwards: 70`,
            `Contact: <${fromUri}>`,
            `Expires: 3600`,
            `${authHeaderName}: ${authVal}`,
            `User-Agent: PortOfCall/1.0`,
            `Content-Length: 0`,
            '', '',
          ].join('\r\n');

          await writer.write(new TextEncoder().encode(reg2));
          const raw2 = await readSipsResponseText(reader, timeout);
          const parsed2 = parseSipsResponse(raw2);

          writer.releaseLock();
          reader.releaseLock();
          socket.close();

          const finalRtt = Date.now() - start;
          const finalCode = parsed2?.statusCode ?? 0;
          const isSuccess = finalCode >= 200 && finalCode < 300;

          return new Response(JSON.stringify({
            success: isSuccess,
            host,
            port,
            statusCode: finalCode,
            statusText: parsed2?.statusText ?? '',
            headers: parsed2?.headers,
            body: parsed2?.body || undefined,
            callId,
            rtt: finalRtt,
            requiresAuth: !isSuccess && (finalCode === 401 || finalCode === 407),
          } satisfies SipsResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      // No auth challenge or no credentials — return initial response as-is
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

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
        requiresAuth: parsed.statusCode === 401 || parsed.statusCode === 407,
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

/** Compact MD5 (RFC 1321) — returns hex digest string */
function md5(input: string): string {
  const msg = new TextEncoder().encode(input);
  const len = msg.length;
  const s = [
    7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
    5, 9,14,20,5, 9,14,20,5, 9,14,20,5, 9,14,20,
    4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
    6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21,
  ];
  const K = [
    0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,
    0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,0x6b901122,0xfd987193,0xa679438e,0x49b40821,
    0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,
    0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,
    0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,
    0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,
    0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,
    0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391,
  ];
  const padLen = (len % 64 < 56) ? (56 - len % 64) : (120 - len % 64);
  const padded = new Uint8Array(len + padLen + 8);
  padded.set(msg);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(len + padLen, (len * 8) >>> 0, true);
  dv.setUint32(len + padLen + 4, Math.floor(len * 8 / 0x100000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let i = 0; i < padded.length; i += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) M[j] = dv.getUint32(i + j * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let j = 0; j < 64; j++) {
      let F: number, g: number;
      if (j < 16)      { F = (B & C) | (~B & D); g = j; }
      else if (j < 32) { F = (D & B) | (~D & C); g = (5 * j + 1) % 16; }
      else if (j < 48) { F = B ^ C ^ D;           g = (3 * j + 5) % 16; }
      else             { F = C ^ (B | ~D);         g = (7 * j) % 16; }
      F = (F + A + K[j] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((F << s[j]) | (F >>> (32 - s[j])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, a0, true); odv.setUint32(4, b0, true);
  odv.setUint32(8, c0, true); odv.setUint32(12, d0, true);
  return Array.from(out).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Read bytes from a TLS socket reader until we have a complete SIP response header block */
async function readSipsResponseText(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const timeoutP = new Promise<{ value: undefined; done: true }>(resolve =>
      setTimeout(() => resolve({ value: undefined, done: true }), remaining)
    );
    const { value, done } = await Promise.race([reader.read(), timeoutP]);
    if (done || !value) break;
    chunks.push(value);
    totalBytes += value.length;
    const text = new TextDecoder().decode(new Uint8Array(chunks.flatMap(c => Array.from(c))));
    if (text.includes('\r\n\r\n')) break;
    if (totalBytes > 16384) break;
  }

  const combined = new Uint8Array(totalBytes);
  let off = 0;
  for (const c of chunks) { combined.set(c, off); off += c.length; }
  return new TextDecoder().decode(combined);
}

/**
 * POST {host, port?, username, password, domain?, timeout?}
 *
 * Performs SIP Digest Authentication (RFC 2617) over TLS (SIPS):
 * 1. Send REGISTER with no credentials → server returns 401 with WWW-Authenticate: Digest
 * 2. Parse realm, nonce, algorithm, qop from challenge
 * 3. Compute HA1=MD5(user:realm:pass), HA2=MD5("REGISTER":uri), response=MD5(HA1:nonce[:nc:cnonce:qop]:HA2)
 * 4. Send authenticated REGISTER with Authorization header
 * 5. Return final status + auth result
 */
export async function handleSipsDigestAuth(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      username: string;
      password: string;
      domain?: string;
      timeout?: number;
    };

    const { host, port = 5061, username, password, timeout = 15000 } = body;
    const sipDomain = body.domain || host;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!username || password === undefined) {
      return new Response(JSON.stringify({ success: false, error: 'username and password are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();
    const registerUri = `sips:${sipDomain}`;
    const digestUri = `sips:${sipDomain}`;
    const callId = generateCallId();
    const branch1 = generateBranch();
    const fromTag = generateTag();
    const fromUri = `sips:${username}@${sipDomain}`;

    // Step 1: initial REGISTER with no credentials to get 401 challenge
    const reg1 = [
      `REGISTER ${registerUri} SIP/2.0`,
      `Via: SIP/2.0/TLS portofcall.invalid:5061;branch=${branch1}`,
      `Max-Forwards: 70`,
      `From: <${fromUri}>;tag=${fromTag}`,
      `To: <${fromUri}>`,
      `Call-ID: ${callId}`,
      `CSeq: 1 REGISTER`,
      `Contact: <${fromUri}>`,
      `Expires: 60`,
      `User-Agent: PortOfCall/1.0`,
      `Content-Length: 0`,
      '', '',
    ].join('\r\n');

    // Connect via TLS
    const socket = connect(`${host}:${port}`, { secureTransport: 'on', allowHalfOpen: false });
    const connectTimeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('Connection timeout')), timeout));
    await Promise.race([socket.opened, connectTimeout]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    await writer.write(new TextEncoder().encode(reg1));
    const raw1 = await readSipsResponseText(reader, timeout);
    const parsed1 = parseSipsResponse(raw1);

    if (!parsed1) {
      writer.releaseLock(); reader.releaseLock(); socket.close();
      return new Response(JSON.stringify({
        success: false, host, port,
        error: 'No valid SIPS response to initial REGISTER',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (parsed1.statusCode === 200) {
      writer.releaseLock(); reader.releaseLock(); socket.close();
      return new Response(JSON.stringify({
        success: true, authenticated: true, noAuthRequired: true,
        host, port, statusCode: 200, statusText: parsed1.statusText,
        rtt: Date.now() - startTime,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const wwwAuth = parsed1.headers['www-authenticate'] || parsed1.headers['WWW-Authenticate']
                 || parsed1.headers['proxy-authenticate'] || parsed1.headers['Proxy-Authenticate'];

    if ((parsed1.statusCode !== 401 && parsed1.statusCode !== 407) || !wwwAuth) {
      writer.releaseLock(); reader.releaseLock(); socket.close();
      return new Response(JSON.stringify({
        success: false, host, port,
        error: `Expected 401/407 challenge, got ${parsed1.statusCode} ${parsed1.statusText}`,
        statusCode: parsed1.statusCode, rtt: Date.now() - startTime,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Parse digest challenge
    const realm = (wwwAuth.match(/realm="([^"]+)"/i) ?? [])[1] ?? sipDomain;
    const nonce = (wwwAuth.match(/nonce="([^"]+)"/i) ?? [])[1] ?? '';
    const algorithm = ((wwwAuth.match(/algorithm=([^\s,]+)/i) ?? [])[1] ?? 'MD5').toUpperCase();
    const qopOffered = (wwwAuth.match(/qop="([^"]+)"/i) ?? [])[1] ?? '';
    const useQop = qopOffered.split(',').map((q: string) => q.trim()).includes('auth') ? 'auth' : '';

    // RFC 2617 digest computation
    const ha1 = md5(`${username}:${realm}:${password}`);
    const ha2 = md5(`REGISTER:${digestUri}`);
    const nc = '00000001';
    const cnonce = Math.random().toString(36).substring(2, 10);
    const digestResp = useQop === 'auth'
      ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`)
      : md5(`${ha1}:${nonce}:${ha2}`);

    // Step 2: authenticated REGISTER
    const branch2 = generateBranch();
    const authHeaderName = parsed1.statusCode === 407 ? 'Proxy-Authorization' : 'Authorization';
    let authVal = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${digestUri}", algorithm=${algorithm}, response="${digestResp}"`;
    if (useQop === 'auth') authVal += `, qop=auth, nc=${nc}, cnonce="${cnonce}"`;

    const reg2 = [
      `REGISTER ${registerUri} SIP/2.0`,
      `Via: SIP/2.0/TLS portofcall.invalid:5061;branch=${branch2}`,
      `Max-Forwards: 70`,
      `From: <${fromUri}>;tag=${fromTag}`,
      `To: <${fromUri}>`,
      `Call-ID: ${callId}`,
      `CSeq: 2 REGISTER`,
      `Contact: <${fromUri}>`,
      `Expires: 60`,
      `${authHeaderName}: ${authVal}`,
      `User-Agent: PortOfCall/1.0`,
      `Content-Length: 0`,
      '', '',
    ].join('\r\n');

    await writer.write(new TextEncoder().encode(reg2));
    const raw2 = await readSipsResponseText(reader, timeout);
    const parsed2 = parseSipsResponse(raw2);

    writer.releaseLock(); reader.releaseLock(); socket.close();

    const rtt = Date.now() - startTime;
    const finalCode = parsed2?.statusCode ?? 0;

    return new Response(JSON.stringify({
      success: finalCode > 0,
      authenticated: finalCode === 200,
      host,
      port,
      statusCode: finalCode,
      statusText: parsed2?.statusText ?? '',
      challengeCode: parsed1.statusCode,
      realm,
      nonce: nonce.substring(0, 16) + (nonce.length > 16 ? '...' : ''),
      algorithm,
      qop: useQop || null,
      rtt,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

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
