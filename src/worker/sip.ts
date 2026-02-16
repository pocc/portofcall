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
