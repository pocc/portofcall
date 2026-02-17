/**
 * SIP Protocol Implementation (RFC 3261)
 *
 * The Session Initiation Protocol is the signaling standard for VoIP,
 * video conferencing, and multimedia sessions. It uses an HTTP-like
 * text format with requests and responses.
 *
 * Protocol Flow (OPTIONS probe):
 * 1. Client connects to SIP server on port 5060 (TCP)
 * 2. Client sends OPTIONS request with Via, From, To, Call-ID, CSeq
 * 3. Server responds with 200 OK + Allow header listing capabilities
 *
 * Key SIP Methods:
 * - OPTIONS: Query server capabilities (our primary probe)
 * - REGISTER: Register a SIP URI (auth probe)
 * - INVITE: Initiate a session (not implemented - requires full UA)
 * - BYE: Terminate a session
 * - ACK: Confirm INVITE response
 *
 * Response Codes (subset):
 * - 100 Trying
 * - 180 Ringing
 * - 200 OK
 * - 401 Unauthorized (requires authentication)
 * - 403 Forbidden
 * - 404 Not Found
 * - 407 Proxy Authentication Required
 * - 408 Request Timeout
 * - 503 Service Unavailable
 *
 * Use Cases:
 * - VoIP server discovery and probing
 * - SIP proxy/registrar capability detection
 * - Authentication requirement discovery
 * - Supported methods and extensions enumeration
 */

import { connect } from 'cloudflare:sockets';

interface SipOptionsRequest {
  host: string;
  port?: number;
  uri?: string;
  timeout?: number;
}

interface SipRegisterRequest {
  host: string;
  port?: number;
  uri?: string;
  username?: string;
  domain?: string;
  timeout?: number;
}

interface SipHeader {
  name: string;
  value: string;
}

interface SipResponse {
  statusCode: number;
  statusText: string;
  headers: SipHeader[];
  raw: string;
}

interface SipOptionsResponse {
  success: boolean;
  server: string;
  statusCode?: number;
  statusText?: string;
  allowedMethods?: string[];
  supportedExtensions?: string[];
  serverAgent?: string;
  contentTypes?: string[];
  headers?: SipHeader[];
  raw?: string;
  error?: string;
}

interface SipRegisterResponse {
  success: boolean;
  server: string;
  statusCode?: number;
  statusText?: string;
  requiresAuth: boolean;
  authScheme?: string;
  authRealm?: string;
  serverAgent?: string;
  contactExpires?: number;
  headers?: SipHeader[];
  raw?: string;
  error?: string;
}

const DEFAULT_PORT = 5060;
const MAX_RESPONSE_SIZE = 100000; // 100KB

/**
 * Generate a random Call-ID for SIP transactions
 */
function generateCallId(host: string): string {
  const random = Math.random().toString(36).substring(2, 14);
  return `${random}@${host}`;
}

/**
 * Generate a random branch parameter for Via header
 */
function generateBranch(): string {
  const random = Math.random().toString(36).substring(2, 14);
  return `z9hG4bK${random}`;
}

/**
 * Generate a random tag for From/To headers
 */
function generateTag(): string {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Parse a SIP response from raw text
 */
function parseSipResponse(raw: string): SipResponse | null {
  const lines = raw.split('\r\n');
  if (lines.length === 0) return null;

  // Parse status line: SIP/2.0 200 OK
  const statusMatch = lines[0].match(/^SIP\/2\.0\s+(\d{3})\s+(.+)$/);
  if (!statusMatch) return null;

  const statusCode = parseInt(statusMatch[1]);
  const statusText = statusMatch[2];

  // Parse headers
  const headers: SipHeader[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') break; // End of headers

    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      headers.push({
        name: line.substring(0, colonIdx).trim(),
        value: line.substring(colonIdx + 1).trim(),
      });
    }
  }

  return { statusCode, statusText, headers, raw };
}

/**
 * Get a header value from parsed SIP headers (case-insensitive)
 */
function getHeader(headers: SipHeader[], name: string): string | undefined {
  const lower = name.toLowerCase();
  const found = headers.find(h => h.name.toLowerCase() === lower);
  return found?.value;
}

/**
 * Read SIP response from socket with timeout
 */
async function readSipResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let fullText = '';

  const deadline = Date.now() + timeoutMs;

  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Response timeout');

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Read timeout')), remaining);
    });

    const { value, done } = await Promise.race([
      reader.read(),
      timeoutPromise,
    ]);

    if (done) break;

    if (value) {
      chunks.push(value);
      totalBytes += value.length;

      if (totalBytes > MAX_RESPONSE_SIZE) {
        throw new Error('Response too large');
      }

      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      fullText = new TextDecoder().decode(combined);

      // SIP response ends with \r\n\r\n (after headers, and Content-Length: 0)
      // Check if we've received a complete response
      if (fullText.includes('\r\n\r\n')) {
        // Check Content-Length to see if we need to read body
        const clMatch = fullText.match(/Content-Length:\s*(\d+)/i);
        const contentLength = clMatch ? parseInt(clMatch[1]) : 0;

        if (contentLength === 0) {
          break; // No body expected
        }

        // Check if we've received the full body
        const headerEnd = fullText.indexOf('\r\n\r\n') + 4;
        const bodyReceived = fullText.length - headerEnd;
        if (bodyReceived >= contentLength) {
          break;
        }
      }
    }
  }

  return fullText;
}

/**
 * Handle SIP OPTIONS request - probe server capabilities
 */
export async function handleSipOptions(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SipOptionsRequest;
    const {
      host,
      port = DEFAULT_PORT,
      timeout = 10000,
    } = body;
    const uri = body.uri || `sip:${host}`;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: 'Host is required',
      } satisfies SipOptionsResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: 'Port must be between 1 and 65535',
      } satisfies SipOptionsResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate host - basic hostname/IP check
    if (!/^[a-zA-Z0-9._:-]+$/.test(host)) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: 'Invalid host format',
      } satisfies SipOptionsResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const callId = generateCallId(host);
    const branch = generateBranch();
    const fromTag = generateTag();

    // Build SIP OPTIONS request
    const sipRequest = [
      `OPTIONS ${uri} SIP/2.0`,
      `Via: SIP/2.0/TCP ${host}:${port};branch=${branch}`,
      `Max-Forwards: 70`,
      `From: <sip:probe@portofcall.workers.dev>;tag=${fromTag}`,
      `To: <${uri}>`,
      `Call-ID: ${callId}`,
      `CSeq: 1 OPTIONS`,
      `Accept: application/sdp`,
      `User-Agent: PortOfCall/1.0`,
      `Content-Length: 0`,
      ``,
      ``,
    ].join('\r\n');

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send OPTIONS request
      await writer.write(new TextEncoder().encode(sipRequest));

      // Read response
      const responseText = await readSipResponse(reader, timeout);

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const parsed = parseSipResponse(responseText);

      if (!parsed) {
        return new Response(JSON.stringify({
          success: false,
          server: `${host}:${port}`,
          raw: responseText.substring(0, 2000),
          error: 'Failed to parse SIP response',
        } satisfies SipOptionsResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Extract useful information
      const allow = getHeader(parsed.headers, 'Allow');
      const supported = getHeader(parsed.headers, 'Supported');
      const server = getHeader(parsed.headers, 'Server') || getHeader(parsed.headers, 'User-Agent');
      const accept = getHeader(parsed.headers, 'Accept');

      return new Response(JSON.stringify({
        success: true,
        server: `${host}:${port}`,
        statusCode: parsed.statusCode,
        statusText: parsed.statusText,
        allowedMethods: allow ? allow.split(',').map(m => m.trim()) : undefined,
        supportedExtensions: supported ? supported.split(',').map(e => e.trim()) : undefined,
        serverAgent: server || undefined,
        contentTypes: accept ? accept.split(',').map(t => t.trim()) : undefined,
        headers: parsed.headers,
        raw: responseText.substring(0, 5000),
      } satisfies SipOptionsResponse), {
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
      server: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies SipOptionsResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle SIP INVITE - initiate a session and observe server response
 * Sends an INVITE with a minimal SDP offer. The server will respond with
 * 100 Trying, 180 Ringing, 200 OK, or a 4xx challenge/rejection.
 * We send BYE or CANCEL to clean up after receiving the response.
 */
export async function handleSipInvite(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      from?: string;
      to?: string;
      timeout?: number;
    };
    const { host, port = DEFAULT_PORT, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, server: '', error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const sipDomain = host;
    const fromUser = body.from || 'probe';
    const toUser = body.to || 'probe';
    const fromUri = `sip:${fromUser}@${sipDomain}`;
    const toUri = `sip:${toUser}@${sipDomain}`;
    const callId = generateCallId(host);
    const branch = generateBranch();
    const fromTag = generateTag();

    // Minimal SDP offer (audio only)
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

    const invite = [
      `INVITE ${toUri} SIP/2.0`,
      `Via: SIP/2.0/TCP ${host};branch=${branch};rport`,
      `From: <${fromUri}>;tag=${fromTag}`,
      `To: <${toUri}>`,
      `Call-ID: ${callId}`,
      `CSeq: 1 INVITE`,
      `Contact: <${fromUri}>`,
      `Content-Type: application/sdp`,
      `Max-Forwards: 70`,
      `Content-Length: ${sdpBytes}`,
      '',
      sdp,
    ].join('\r\n');

    const socket = connect(`${host}:${port}`);
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    const start = Date.now();
    await writer.write(new TextEncoder().encode(invite));

    // Collect responses — may get multiple 1xx before a final response
    let rawResponse = '';
    let finalCode = 0;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline && finalCode < 200) {
      const remaining = deadline - Date.now();
      const t = new Promise<{ done: true; value: undefined }>(r =>
        setTimeout(() => r({ done: true, value: undefined }), Math.min(remaining, 3000))
      );
      const result = await Promise.race([reader.read(), t]);
      if (result.done || !result.value) break;
      rawResponse += new TextDecoder().decode(result.value);
      if (rawResponse.length > MAX_RESPONSE_SIZE) break;
      // Check for final response
      for (const line of rawResponse.split('\r\n')) {
        const m = line.match(/^SIP\/2\.0 (\d+)/);
        if (m) {
          const code = parseInt(m[1]);
          if (code >= 200) { finalCode = code; break; }
        }
      }
    }

    const rtt = Date.now() - start;

    // Send CANCEL or ACK to clean up
    try {
      const cancelBranch = branch;
      const cancel = [
        `CANCEL ${toUri} SIP/2.0`,
        `Via: SIP/2.0/TCP ${host};branch=${cancelBranch}`,
        `From: <${fromUri}>;tag=${fromTag}`,
        `To: <${toUri}>`,
        `Call-ID: ${callId}`,
        `CSeq: 1 CANCEL`,
        `Max-Forwards: 70`,
        `Content-Length: 0`,
        '',
        '',
      ].join('\r\n');
      await writer.write(new TextEncoder().encode(cancel));
    } catch { /* ignore cleanup errors */ }

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    const parsed = parseSipResponse(rawResponse);
    const statusCode = parsed?.statusCode ?? finalCode;
    const statusText = parsed?.statusText ?? '';

    return new Response(JSON.stringify({
      success: statusCode > 0,
      server: `${host}:${port}`,
      statusCode,
      statusText,
      requiresAuth: statusCode === 401 || statusCode === 407,
      authScheme: statusCode === 401 ? getHeader(parsed?.headers ?? [], 'www-authenticate')?.split(' ')[0]
                : statusCode === 407 ? getHeader(parsed?.headers ?? [], 'proxy-authenticate')?.split(' ')[0]
                : undefined,
      serverAgent: getHeader(parsed?.headers ?? [], 'server') || getHeader(parsed?.headers ?? [], 'user-agent'),
      allow: getHeader(parsed?.headers ?? [], 'allow'),
      rtt,
      raw: rawResponse.substring(0, 2000),
      message: statusCode > 0 ? `INVITE ${statusCode} ${statusText} in ${rtt}ms` : `INVITE sent, no valid SIP response in ${rtt}ms`,
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      server: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle SIP REGISTER probe - test registration and auth requirements
 */
export async function handleSipRegister(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SipRegisterRequest;
    const {
      host,
      port = DEFAULT_PORT,
      username = 'probe',
      domain,
      timeout = 10000,
    } = body;

    const sipDomain = domain || host;
    const uri = body.uri || `sip:${sipDomain}`;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        requiresAuth: false,
        error: 'Host is required',
      } satisfies SipRegisterResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        requiresAuth: false,
        error: 'Port must be between 1 and 65535',
      } satisfies SipRegisterResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!/^[a-zA-Z0-9._:-]+$/.test(host)) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        requiresAuth: false,
        error: 'Invalid host format',
      } satisfies SipRegisterResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Sanitize username
    if (!/^[a-zA-Z0-9._@+-]+$/.test(username)) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        requiresAuth: false,
        error: 'Invalid username format',
      } satisfies SipRegisterResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const callId = generateCallId(host);
    const branch = generateBranch();
    const fromTag = generateTag();

    // Build SIP REGISTER request
    const sipRequest = [
      `REGISTER ${uri} SIP/2.0`,
      `Via: SIP/2.0/TCP ${host}:${port};branch=${branch}`,
      `Max-Forwards: 70`,
      `From: <sip:${username}@${sipDomain}>;tag=${fromTag}`,
      `To: <sip:${username}@${sipDomain}>`,
      `Call-ID: ${callId}`,
      `CSeq: 1 REGISTER`,
      `Contact: <sip:${username}@portofcall.workers.dev>`,
      `Expires: 0`,
      `User-Agent: PortOfCall/1.0`,
      `Content-Length: 0`,
      ``,
      ``,
    ].join('\r\n');

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send REGISTER request
      await writer.write(new TextEncoder().encode(sipRequest));

      // Read response
      const responseText = await readSipResponse(reader, timeout);

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const parsed = parseSipResponse(responseText);

      if (!parsed) {
        return new Response(JSON.stringify({
          success: false,
          server: `${host}:${port}`,
          requiresAuth: false,
          raw: responseText.substring(0, 2000),
          error: 'Failed to parse SIP response',
        } satisfies SipRegisterResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Check for authentication requirements
      const requiresAuth = parsed.statusCode === 401 || parsed.statusCode === 407;
      let authScheme: string | undefined;
      let authRealm: string | undefined;

      if (requiresAuth) {
        const wwwAuth = getHeader(parsed.headers, 'WWW-Authenticate') ||
                        getHeader(parsed.headers, 'Proxy-Authenticate');

        if (wwwAuth) {
          const schemeMatch = wwwAuth.match(/^(\w+)/);
          authScheme = schemeMatch ? schemeMatch[1] : undefined;

          const realmMatch = wwwAuth.match(/realm="([^"]+)"/);
          authRealm = realmMatch ? realmMatch[1] : undefined;
        }
      }

      const server = getHeader(parsed.headers, 'Server') || getHeader(parsed.headers, 'User-Agent');
      const contact = getHeader(parsed.headers, 'Contact');
      let contactExpires: number | undefined;

      if (contact) {
        const expiresMatch = contact.match(/expires=(\d+)/i);
        contactExpires = expiresMatch ? parseInt(expiresMatch[1]) : undefined;
      }

      // Also check Expires header
      if (contactExpires === undefined) {
        const expiresHeader = getHeader(parsed.headers, 'Expires');
        if (expiresHeader) {
          contactExpires = parseInt(expiresHeader);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        server: `${host}:${port}`,
        statusCode: parsed.statusCode,
        statusText: parsed.statusText,
        requiresAuth,
        authScheme,
        authRealm,
        serverAgent: server || undefined,
        contactExpires,
        headers: parsed.headers,
        raw: responseText.substring(0, 5000),
      } satisfies SipRegisterResponse), {
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
      server: '',
      requiresAuth: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies SipRegisterResponse), {
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

/**
 * Handle SIP digest auth challenge-response (RFC 2617 / RFC 3261 §22).
 *
 * Flow:
 *  1. Send REGISTER (no credentials) → 401 with WWW-Authenticate: Digest challenge
 *  2. Parse realm, nonce, algorithm, qop from challenge
 *  3. Compute: HA1=MD5(user:realm:pass), HA2=MD5("REGISTER":uri),
 *              response=MD5(HA1:nonce[:nc:cnonce:qop]:HA2)
 *  4. Send authenticated REGISTER with Authorization header
 *  5. Return final status + auth result
 *
 * Request body: { host, port?, username, password, domain?, timeout? }
 */
export async function handleSIPDigestAuth(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      username: string;
      password: string;
      domain?: string;
      timeout?: number;
    };

    const { host, port = DEFAULT_PORT, username, password, timeout = 10000 } = body;
    const sipDomain = body.domain || host;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!username) {
      return new Response(JSON.stringify({ success: false, error: 'username is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!password && password !== '') {
      return new Response(JSON.stringify({ success: false, error: 'password is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!/^[a-zA-Z0-9._:-]+$/.test(host)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid host format' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();
    const registerUri = `sip:${sipDomain}`;
    const digestUri = registerUri;
    const callId = generateCallId(host);
    const branch1 = generateBranch();
    const fromTag = generateTag();

    // Step 1: initial REGISTER with no credentials to get 401 challenge
    const reg1 = [
      `REGISTER ${registerUri} SIP/2.0`,
      `Via: SIP/2.0/TCP ${host}:${port};branch=${branch1}`,
      `Max-Forwards: 70`,
      `From: <sip:${username}@${sipDomain}>;tag=${fromTag}`,
      `To: <sip:${username}@${sipDomain}>`,
      `Call-ID: ${callId}`,
      `CSeq: 1 REGISTER`,
      `Contact: <sip:${username}@portofcall.workers.dev>`,
      `Expires: 60`,
      `User-Agent: PortOfCall/1.0`,
      `Content-Length: 0`,
      '', '',
    ].join('\r\n');

    const socket = connect(`${host}:${port}`);
    const tPromise = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('Connection timeout')), timeout));
    await Promise.race([socket.opened, tPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    await writer.write(new TextEncoder().encode(reg1));
    const raw1 = await readSipResponse(reader, timeout);
    const parsed1 = parseSipResponse(raw1);

    if (!parsed1) {
      writer.releaseLock(); reader.releaseLock(); socket.close();
      return new Response(JSON.stringify({
        success: false,
        error: 'No valid SIP response to initial REGISTER',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (parsed1.statusCode === 200) {
      writer.releaseLock(); reader.releaseLock(); socket.close();
      return new Response(JSON.stringify({
        success: true, authenticated: true, noAuthRequired: true,
        statusCode: 200, statusText: parsed1.statusText, rtt: Date.now() - startTime,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const authHeaderValue = getHeader(parsed1.headers, 'WWW-Authenticate')
                         || getHeader(parsed1.headers, 'Proxy-Authenticate');

    if ((parsed1.statusCode !== 401 && parsed1.statusCode !== 407) || !authHeaderValue) {
      writer.releaseLock(); reader.releaseLock(); socket.close();
      return new Response(JSON.stringify({
        success: false,
        error: `Expected 401/407 challenge, got ${parsed1.statusCode} ${parsed1.statusText}`,
        statusCode: parsed1.statusCode, rtt: Date.now() - startTime,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Parse challenge
    const realm = (authHeaderValue.match(/realm="([^"]+)"/i) ?? [])[1] ?? sipDomain;
    const nonce = (authHeaderValue.match(/nonce="([^"]+)"/i) ?? [])[1] ?? '';
    const algorithm = ((authHeaderValue.match(/algorithm=([^\s,]+)/i) ?? [])[1] ?? 'MD5').toUpperCase();
    const qopOffered = (authHeaderValue.match(/qop="([^"]+)"/i) ?? [])[1] ?? '';
    const useQop = qopOffered.split(',').map(q => q.trim()).includes('auth') ? 'auth' : '';

    // Compute MD5 digest response
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
      `Via: SIP/2.0/TCP ${host}:${port};branch=${branch2}`,
      `Max-Forwards: 70`,
      `From: <sip:${username}@${sipDomain}>;tag=${fromTag}`,
      `To: <sip:${username}@${sipDomain}>`,
      `Call-ID: ${callId}`,
      `CSeq: 2 REGISTER`,
      `Contact: <sip:${username}@portofcall.workers.dev>`,
      `Expires: 60`,
      `${authHeaderName}: ${authVal}`,
      `User-Agent: PortOfCall/1.0`,
      `Content-Length: 0`,
      '', '',
    ].join('\r\n');

    await writer.write(new TextEncoder().encode(reg2));
    const raw2 = await readSipResponse(reader, timeout);
    const parsed2 = parseSipResponse(raw2);

    writer.releaseLock(); reader.releaseLock(); socket.close();

    const rtt = Date.now() - startTime;
    const finalCode = parsed2?.statusCode ?? 0;

    return new Response(JSON.stringify({
      success: finalCode > 0,
      authenticated: finalCode === 200,
      statusCode: finalCode,
      statusText: parsed2?.statusText ?? '',
      challengeCode: parsed1.statusCode,
      realm,
      nonce: nonce.substring(0, 16) + (nonce.length > 16 ? '...' : ''),
      algorithm,
      qop: useQop || null,
      serverAgent: getHeader(parsed2?.headers ?? [], 'Server')
                || getHeader(parsed2?.headers ?? [], 'User-Agent'),
      rtt,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
