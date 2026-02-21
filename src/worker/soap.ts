/**
 * SOAP (Simple Object Access Protocol) Implementation
 *
 * SOAP is a protocol for exchanging structured XML data in web services.
 * This implementation sends HTTP POST requests with XML/SOAP envelopes
 * over raw TCP sockets via the Cloudflare Sockets API.
 *
 * Protocol Flow:
 * 1. Client connects to server on HTTP port (80, 8080, etc.)
 * 2. Client sends HTTP POST with Content-Type: text/xml and SOAPAction header
 * 3. Server responds with SOAP XML envelope
 *
 * Use Cases:
 * - Enterprise web services (banking, healthcare, government)
 * - WSDL endpoint probing
 * - Legacy system integration testing
 */

import { connect } from 'cloudflare:sockets';

interface SOAPRequest {
  host: string;
  port?: number;
  path?: string;
  soapAction?: string;
  body?: string;
  timeout?: number;
  soapVersion?: '1.1' | '1.2'; // Auto-detect if not specified
}

interface SOAPResponse {
  success: boolean;
  statusCode?: number;
  headers?: Record<string, string>;
  body?: string;
  parsed?: {
    isSoap?: boolean;
    hasFault?: boolean;
    faultCode?: string;
    faultString?: string;
    soapVersion?: string;
  };
  error?: string;
  latencyMs?: number;
}

/**
 * Detect SOAP version from envelope namespace.
 */
function detectSoapVersion(envelope: string): '1.1' | '1.2' | undefined {
  if (envelope.includes('http://www.w3.org/2003/05/soap-envelope')) {
    return '1.2';
  } else if (envelope.includes('http://schemas.xmlsoap.org/soap/envelope/')) {
    return '1.1';
  }
  return undefined;
}

/**
 * Send raw HTTP/1.1 POST with SOAP payload over a TCP socket.
 */
async function sendSoapRequest(
  host: string,
  port: number,
  path: string,
  soapBody: string,
  soapAction?: string,
  timeout = 15000,
  soapVersion?: '1.1' | '1.2',
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  await Promise.race([socket.opened, timeoutPromise]);

  const writer = socket.writable.getWriter();
  const encoder = new TextEncoder();

  const bodyBytes = encoder.encode(soapBody);

  // Auto-detect SOAP version if not specified
  const detectedVersion = soapVersion || detectSoapVersion(soapBody);

  let request = `POST ${path} HTTP/1.1\r\n`;
  request += `Host: ${host}:${port}\r\n`;

  // SOAP 1.1 vs 1.2 Content-Type difference per W3C specs
  if (detectedVersion === '1.2') {
    // RFC 3902: SOAP 1.2 uses application/soap+xml
    // Action parameter replaces SOAPAction header
    let contentType = 'application/soap+xml; charset=utf-8';
    if (soapAction) {
      contentType += `; action="${soapAction}"`;
    }
    request += `Content-Type: ${contentType}\r\n`;
  } else {
    // SOAP 1.1 uses text/xml and separate SOAPAction header
    request += `Content-Type: text/xml; charset=utf-8\r\n`;
    if (soapAction !== undefined) {
      // SOAPAction header is required in SOAP 1.1, even if empty
      request += `SOAPAction: "${soapAction}"\r\n`;
    }
  }

  request += `Content-Length: ${bodyBytes.length}\r\n`;
  request += `Connection: close\r\n`;
  request += `User-Agent: PortOfCall/1.0\r\n`;
  request += `\r\n`;

  await writer.write(encoder.encode(request));
  await writer.write(bodyBytes);
  writer.releaseLock();

  // Read response
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

  // Parse HTTP response
  const headerEnd = response.indexOf('\r\n\r\n');
  if (headerEnd === -1) {
    throw new Error('Invalid HTTP response: no header terminator found');
  }

  const headerSection = response.substring(0, headerEnd);
  let bodySection = response.substring(headerEnd + 4);

  // Parse status line
  const statusLine = headerSection.split('\r\n')[0];
  const statusMatch = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/);
  if (!statusMatch) {
    throw new Error('Invalid HTTP response: no status code found');
  }
  const statusCode = parseInt(statusMatch[1], 10);

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
  if (headers['transfer-encoding']?.includes('chunked')) {
    bodySection = decodeChunked(bodySection);
  }

  return { statusCode, headers, body: bodySection };
}

/**
 * Decode chunked transfer encoding.
 * Handles chunk extensions per RFC 9112 §7.1.1
 */
function decodeChunked(data: string): string {
  let result = '';
  let remaining = data;

  while (remaining.length > 0) {
    const lineEnd = remaining.indexOf('\r\n');
    if (lineEnd === -1) break;

    let sizeLine = remaining.substring(0, lineEnd).trim();

    // Strip chunk extensions (e.g., "1a;name=value")
    const semiIdx = sizeLine.indexOf(';');
    if (semiIdx !== -1) {
      sizeLine = sizeLine.substring(0, semiIdx).trim();
    }

    const chunkSize = parseInt(sizeLine, 16);
    if (isNaN(chunkSize) || chunkSize === 0) break;

    const chunkStart = lineEnd + 2;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > remaining.length) {
      result += remaining.substring(chunkStart);
      break;
    }

    result += remaining.substring(chunkStart, chunkEnd);
    remaining = remaining.substring(chunkEnd + 2);
  }

  return result;
}

/**
 * Send a GET request for WSDL discovery.
 */
async function sendWsdlRequest(
  host: string,
  port: number,
  path: string,
  timeout = 15000,
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  await Promise.race([socket.opened, timeoutPromise]);

  const writer = socket.writable.getWriter();
  const encoder = new TextEncoder();

  // Append ?wsdl if not already present
  const wsdlPath = path.includes('?') ? path : `${path}?wsdl`;

  let request = `GET ${wsdlPath} HTTP/1.1\r\n`;
  request += `Host: ${host}:${port}\r\n`;
  request += `Accept: text/xml, application/xml\r\n`;
  request += `Connection: close\r\n`;
  request += `User-Agent: PortOfCall/1.0\r\n`;
  request += `\r\n`;

  await writer.write(encoder.encode(request));
  writer.releaseLock();

  // Read response
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
  if (!statusMatch) {
    throw new Error('Invalid HTTP response: no status code found');
  }
  const statusCode = parseInt(statusMatch[1], 10);

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

  if (headers['transfer-encoding']?.includes('chunked')) {
    bodySection = decodeChunked(bodySection);
  }

  return { statusCode, headers, body: bodySection };
}

/**
 * Parse a SOAP XML response to extract key information.
 */
function parseSoapResponse(xml: string): SOAPResponse['parsed'] {
  const result: SOAPResponse['parsed'] = {
    isSoap: false,
    hasFault: false,
    soapVersion: undefined,
  };

  // Detect SOAP version
  if (xml.includes('http://schemas.xmlsoap.org/soap/envelope/')) {
    result.isSoap = true;
    result.soapVersion = '1.1';
  } else if (xml.includes('http://www.w3.org/2003/05/soap-envelope')) {
    result.isSoap = true;
    result.soapVersion = '1.2';
  } else if (xml.includes('<soap:Envelope') || xml.includes('<SOAP-ENV:Envelope') || xml.includes('<soapenv:Envelope')) {
    result.isSoap = true;
    result.soapVersion = 'unknown';
  }

  // Detect SOAP fault
  if (xml.includes('<soap:Fault') || xml.includes('<SOAP-ENV:Fault') || xml.includes('<soapenv:Fault') || xml.includes('<Fault')) {
    result.hasFault = true;

    // Extract faultcode
    const codeMatch = xml.match(/<faultcode[^>]*>([^<]+)<\/faultcode>/i)
      || xml.match(/<Code[^>]*>.*?<Value[^>]*>([^<]+)<\/Value>/is);
    if (codeMatch) result.faultCode = codeMatch[1].trim();

    // Extract faultstring
    const stringMatch = xml.match(/<faultstring[^>]*>([^<]+)<\/faultstring>/i)
      || xml.match(/<Reason[^>]*>.*?<Text[^>]*>([^<]+)<\/Text>/is);
    if (stringMatch) result.faultString = stringMatch[1].trim();
  }

  return result;
}

/**
 * Handle SOAP call - send a SOAP envelope and parse the response.
 */
export async function handleSoapCall(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SOAPRequest;
    const {
      host,
      port = 80,
      path = '/',
      soapAction,
      body: soapBody,
      timeout = 15000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!soapBody) {
      return new Response(JSON.stringify({
        success: false,
        error: 'SOAP body (XML envelope) is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const start = Date.now();

    const result = await sendSoapRequest(
      host,
      port,
      normalizedPath,
      soapBody,
      soapAction,
      timeout,
      body.soapVersion,
    );

    const latencyMs = Date.now() - start;
    const parsed = parseSoapResponse(result.body);

    const response: SOAPResponse = {
      success: result.statusCode >= 200 && result.statusCode < 400,
      statusCode: result.statusCode,
      headers: result.headers,
      body: result.body,
      parsed,
      latencyMs,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'SOAP call failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle WSDL discovery - fetch the WSDL document from a service endpoint.
 */
export async function handleSoapWsdl(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SOAPRequest;
    const { host, port = 80, path = '/', timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const start = Date.now();

    const result = await sendWsdlRequest(host, port, normalizedPath, timeout);
    const latencyMs = Date.now() - start;

    const isWsdl = result.body.includes('<wsdl:') || result.body.includes('<definitions')
      || result.body.includes('schemas.xmlsoap.org/wsdl');

    // Extract service info from WSDL
    let serviceName: string | undefined;
    let operations: string[] = [];

    if (isWsdl) {
      const nameMatch = result.body.match(/<wsdl:service\s+name="([^"]+)"/i)
        || result.body.match(/<service\s+name="([^"]+)"/i);
      if (nameMatch) serviceName = nameMatch[1];

      const opMatches = result.body.matchAll(/<wsdl:operation\s+name="([^"]+)"/gi);
      const opSet = new Set<string>();
      for (const match of opMatches) {
        opSet.add(match[1]);
      }
      // Also try without namespace prefix
      const opMatches2 = result.body.matchAll(/<operation\s+name="([^"]+)"/gi);
      for (const match of opMatches2) {
        opSet.add(match[1]);
      }
      operations = Array.from(opSet);
    }

    return new Response(JSON.stringify({
      success: result.statusCode >= 200 && result.statusCode < 400,
      statusCode: result.statusCode,
      isWsdl,
      serviceName,
      operations,
      body: result.body,
      latencyMs,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'WSDL fetch failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
