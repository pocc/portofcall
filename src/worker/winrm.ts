/**
 * WinRM (Windows Remote Management) Protocol Implementation
 *
 * WinRM is Microsoft's implementation of WS-Management (DMTF standard)
 * for remote management of Windows systems over HTTP/HTTPS.
 *
 * Protocol Flow:
 * 1. Client connects to WinRM HTTP port (default 5985) or HTTPS (5986)
 * 2. Client sends HTTP POST with SOAP XML envelope
 * 3. Server responds with SOAP XML containing management data
 *
 * Key Operations:
 * - WSMAN Identify    → Discover server vendor, version, protocol
 * - Enumerate shells  → List available shell types
 * - Auth detection    → Detect supported authentication methods via 401 response
 *
 * Authentication: Basic, Negotiate (NTLM/Kerberos), CredSSP
 * Default Ports: 5985 (HTTP), 5986 (HTTPS)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface WinRMRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface WinRMIdentifyResponse {
  success: boolean;
  rtt?: number;
  server?: string;
  isWinRM?: boolean;
  productVendor?: string;
  productVersion?: string;
  protocolVersion?: string;
  securityProfiles?: string[];
  authMethods?: string[];
  statusCode?: number;
  error?: string;
  isCloudflare?: boolean;
}

/**
 * Send a raw HTTP/1.1 request over a TCP socket
 */
async function sendHttpRequest(
  host: string,
  port: number,
  method: string,
  path: string,
  body?: string,
  headers?: Record<string, string>,
  timeout = 15000,
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  await Promise.race([socket.opened, timeoutPromise]);

  const writer = socket.writable.getWriter();
  const encoder = new TextEncoder();

  let request = `${method} ${path} HTTP/1.1\r\n`;
  request += `Host: ${host}:${port}\r\n`;
  request += `Connection: close\r\n`;
  request += `User-Agent: PortOfCall/1.0\r\n`;

  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      request += `${key}: ${value}\r\n`;
    }
  }

  if (body) {
    const bodyBytes = encoder.encode(body);
    request += `Content-Type: application/soap+xml;charset=UTF-8\r\n`;
    request += `Content-Length: ${bodyBytes.length}\r\n`;
    request += `\r\n`;
    await writer.write(encoder.encode(request));
    await writer.write(bodyBytes);
  } else {
    request += `\r\n`;
    await writer.write(encoder.encode(request));
  }

  writer.releaseLock();

  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  let response = '';
  const maxSize = 512000;

  while (response.length < maxSize) {
    const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
    if (done) break;
    if (value) {
      response += decoder.decode(value, { stream: true });
    }
  }

  reader.releaseLock();
  socket.close();

  const headerEnd = response.indexOf('\r\n\r\n');
  if (headerEnd === -1) {
    throw new Error('Invalid HTTP response: no header terminator found');
  }

  const headerSection = response.substring(0, headerEnd);
  let bodySection = response.substring(headerEnd + 4);

  const statusLine = headerSection.split('\r\n')[0];
  const statusMatch = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/);
  const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;

  const respHeaders: Record<string, string> = {};
  const headerLines = headerSection.split('\r\n').slice(1);
  for (const line of headerLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim().toLowerCase();
      const value = line.substring(colonIdx + 1).trim();
      respHeaders[key] = value;
    }
  }

  if (respHeaders['transfer-encoding']?.includes('chunked')) {
    bodySection = decodeChunked(bodySection);
  }

  return { statusCode, headers: respHeaders, body: bodySection };
}

/**
 * Decode chunked transfer encoding
 */
function decodeChunked(data: string): string {
  let result = '';
  let remaining = data;

  while (remaining.length > 0) {
    const lineEnd = remaining.indexOf('\r\n');
    if (lineEnd === -1) break;

    const sizeStr = remaining.substring(0, lineEnd).trim();
    const chunkSize = parseInt(sizeStr, 16);
    if (isNaN(chunkSize) || chunkSize === 0) break;

    const chunkStart = lineEnd + 2;
    result += remaining.substring(chunkStart, chunkStart + chunkSize);
    remaining = remaining.substring(chunkStart + chunkSize + 2);
  }

  return result;
}

/**
 * Build WSMAN Identify SOAP envelope
 */
function buildIdentifyEnvelope(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:wsmid="http://schemas.dmtf.org/wbem/wsman/identity/1/wsmanidentity.xsd">
  <s:Header/>
  <s:Body>
    <wsmid:Identify/>
  </s:Body>
</s:Envelope>`;
}

/**
 * Extract text content from an XML tag (simple regex-based parser)
 */
function extractXmlValue(xml: string, tagName: string): string | undefined {
  // Handle namespaced tags like wsmid:ProductVendor
  const patterns = [
    new RegExp(`<(?:[\\w-]+:)?${tagName}[^>]*>([^<]+)</(?:[\\w-]+:)?${tagName}>`, 'i'),
    new RegExp(`<${tagName}[^>]*>([^<]+)</${tagName}>`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = xml.match(pattern);
    if (match) return match[1].trim();
  }
  return undefined;
}

/**
 * Extract all values from repeating XML tags
 */
function extractXmlValues(xml: string, tagName: string): string[] {
  const results: string[] = [];
  const pattern = new RegExp(`<(?:[\\w-]+:)?${tagName}[^>]*>([^<]+)</(?:[\\w-]+:)?${tagName}>`, 'gi');
  let match;
  while ((match = pattern.exec(xml)) !== null) {
    results.push(match[1].trim());
  }
  return results;
}

/**
 * Parse authentication methods from WWW-Authenticate headers
 */
function parseAuthMethods(headerValue: string): string[] {
  const methods: string[] = [];
  const parts = headerValue.split(',').map(s => s.trim());

  for (const part of parts) {
    const method = part.split(/\s/)[0].trim();
    if (method && !methods.includes(method)) {
      methods.push(method);
    }
  }

  return methods;
}

/**
 * Handle WinRM Identify probe
 * POST /api/winrm/identify
 */
export async function handleWinRMIdentify(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: WinRMRequest;
  try {
    body = await request.json() as WinRMRequest;
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { host, port = 5985, timeout = 10000 } = body;

  if (!host) {
    return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (port < 1 || port > 65535) {
    return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result: WinRMIdentifyResponse = { success: false };
  const startTime = Date.now();

  try {
    // Check if the target is behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Step 1: Send WSMAN Identify request (anonymous, no auth required)
    const identifyEnvelope = buildIdentifyEnvelope();

    const response = await sendHttpRequest(
      host,
      port,
      'POST',
      '/wsman-anon/identify',
      identifyEnvelope,
      {
        'Content-Type': 'application/soap+xml;charset=UTF-8',
      },
      timeout,
    );

    result.rtt = Date.now() - startTime;
    result.statusCode = response.statusCode;
    result.server = response.headers['server'] || undefined;

    if (response.statusCode === 200) {
      // Parse SOAP XML response for identity info
      const xml = response.body;
      result.productVendor = extractXmlValue(xml, 'ProductVendor');
      result.productVersion = extractXmlValue(xml, 'ProductVersion');
      result.protocolVersion = extractXmlValue(xml, 'ProtocolVersion');
      result.securityProfiles = extractXmlValues(xml, 'SecurityProfilName');

      // Also try the alternate tag name
      if (result.securityProfiles.length === 0) {
        result.securityProfiles = extractXmlValues(xml, 'SecurityProfile');
      }

      result.isWinRM = !!(result.productVendor || result.productVersion);
      result.success = true;
    } else if (response.statusCode === 401) {
      // Server requires auth - still WinRM, extract auth methods
      result.isWinRM = true;

      const wwwAuth = response.headers['www-authenticate'];
      if (wwwAuth) {
        result.authMethods = parseAuthMethods(wwwAuth);
      }

      // Try the /wsman endpoint as well
      try {
        const wsmanResponse = await sendHttpRequest(
          host,
          port,
          'POST',
          '/wsman',
          identifyEnvelope,
          {
            'Content-Type': 'application/soap+xml;charset=UTF-8',
          },
          timeout,
        );

        if (wsmanResponse.statusCode === 401) {
          const wsmanAuth = wsmanResponse.headers['www-authenticate'];
          if (wsmanAuth) {
            const additionalMethods = parseAuthMethods(wsmanAuth);
            const allMethods = [...(result.authMethods || [])];
            for (const m of additionalMethods) {
              if (!allMethods.includes(m)) {
                allMethods.push(m);
              }
            }
            result.authMethods = allMethods;
          }
        }
      } catch {
        // Ignore secondary probe failure
      }

      result.success = true;
    } else if (response.statusCode === 404) {
      // Try /wsman endpoint (some configurations only expose this)
      try {
        const wsmanResponse = await sendHttpRequest(
          host,
          port,
          'POST',
          '/wsman',
          identifyEnvelope,
          {
            'Content-Type': 'application/soap+xml;charset=UTF-8',
          },
          timeout,
        );

        result.statusCode = wsmanResponse.statusCode;

        if (wsmanResponse.statusCode === 200) {
          const xml = wsmanResponse.body;
          result.productVendor = extractXmlValue(xml, 'ProductVendor');
          result.productVersion = extractXmlValue(xml, 'ProductVersion');
          result.protocolVersion = extractXmlValue(xml, 'ProtocolVersion');
          result.securityProfiles = extractXmlValues(xml, 'SecurityProfilName');
          if (result.securityProfiles.length === 0) {
            result.securityProfiles = extractXmlValues(xml, 'SecurityProfile');
          }
          result.isWinRM = true;
          result.success = true;
        } else if (wsmanResponse.statusCode === 401) {
          result.isWinRM = true;
          const wwwAuth = wsmanResponse.headers['www-authenticate'];
          if (wwwAuth) {
            result.authMethods = parseAuthMethods(wwwAuth);
          }
          result.success = true;
        } else {
          result.isWinRM = false;
          result.error = `HTTP ${wsmanResponse.statusCode}: Not a WinRM endpoint`;
        }
      } catch {
        result.isWinRM = false;
        result.error = `HTTP ${response.statusCode}: Not a WinRM endpoint`;
      }
    } else {
      result.isWinRM = false;
      result.error = `HTTP ${response.statusCode}: Unexpected response`;
    }
  } catch (err) {
    result.rtt = Date.now() - startTime;
    result.error = err instanceof Error ? err.message : 'Connection failed';
  }

  return new Response(JSON.stringify(result), {
    status: result.success ? 200 : result.statusCode === 400 ? 400 : 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handle WinRM auth probe (just checks auth methods without SOAP)
 * POST /api/winrm/auth
 */
export async function handleWinRMAuth(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: WinRMRequest;
  try {
    body = await request.json() as WinRMRequest;
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { host, port = 5985, timeout = 10000 } = body;

  if (!host) {
    return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (port < 1 || port > 65535) {
    return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const startTime = Date.now();

  try {
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Send a simple GET to /wsman to trigger 401 and see auth methods
    const response = await sendHttpRequest(
      host,
      port,
      'GET',
      '/wsman',
      undefined,
      undefined,
      timeout,
    );

    const rtt = Date.now() - startTime;
    const authMethods: string[] = [];

    if (response.headers['www-authenticate']) {
      authMethods.push(...parseAuthMethods(response.headers['www-authenticate']));
    }

    return new Response(JSON.stringify({
      success: true,
      rtt,
      statusCode: response.statusCode,
      server: response.headers['server'] || undefined,
      authMethods,
      requiresAuth: response.statusCode === 401,
      isWinRM: response.statusCode === 401 || response.statusCode === 200,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      rtt: Date.now() - startTime,
      error: err instanceof Error ? err.message : 'Connection failed',
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
