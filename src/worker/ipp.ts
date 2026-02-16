/**
 * IPP (Internet Printing Protocol) Implementation - RFC 8011
 *
 * IPP is an HTTP-based protocol for managing print jobs and printers.
 * It runs on port 631 and is used by CUPS on macOS/Linux.
 *
 * Protocol Flow:
 * 1. Client sends HTTP POST to printer URI with IPP binary payload
 * 2. IPP payload uses big-endian binary encoding
 * 3. Server responds with HTTP 200 and IPP binary response
 *
 * IPP Operations:
 * - Get-Printer-Attributes (0x000B) - Discover printer capabilities
 * - Get-Jobs (0x000A) - List print jobs
 * - Print-Job (0x0002) - Submit a print job
 *
 * Use Cases:
 * - CUPS printer discovery and health checking
 * - Network printer capability detection
 * - Print queue monitoring
 */

import { connect } from 'cloudflare:sockets';

interface IPPRequest {
  host: string;
  port?: number;
  printerUri?: string;
  timeout?: number;
}

interface IPPAttribute {
  name: string;
  value: string;
}

interface IPPResponse {
  success: boolean;
  host: string;
  port: number;
  statusCode?: number;
  statusMessage?: string;
  version?: string;
  attributes?: IPPAttribute[];
  rawHttpStatus?: string;
  rtt: number;
  error?: string;
}

// IPP status codes
const IPP_STATUS_CODES: Record<number, string> = {
  0x0000: 'successful-ok',
  0x0001: 'successful-ok-ignored-or-substituted-attributes',
  0x0002: 'successful-ok-conflicting-attributes',
  0x0400: 'client-error-bad-request',
  0x0401: 'client-error-forbidden',
  0x0402: 'client-error-not-authenticated',
  0x0403: 'client-error-not-authorized',
  0x0404: 'client-error-not-possible',
  0x0405: 'client-error-timeout',
  0x0406: 'client-error-not-found',
  0x0407: 'client-error-gone',
  0x0408: 'client-error-request-entity-too-large',
  0x0409: 'client-error-request-value-too-long',
  0x040A: 'client-error-document-format-not-supported',
  0x040B: 'client-error-attributes-or-values-not-supported',
  0x0500: 'server-error-internal-error',
  0x0501: 'server-error-operation-not-supported',
  0x0502: 'server-error-service-unavailable',
  0x0503: 'server-error-version-not-supported',
  0x0504: 'server-error-device-error',
  0x0505: 'server-error-temporary-error',
  0x0506: 'server-error-not-accepting-jobs',
  0x0507: 'server-error-busy',
  0x0508: 'server-error-job-canceled',
};

// IPP value tags (used for response parsing)
export const VALUE_TAG_NAMES: Record<number, string> = {
  0x21: 'integer',
  0x22: 'boolean',
  0x23: 'enum',
  0x30: 'octetString',
  0x31: 'dateTime',
  0x32: 'resolution',
  0x33: 'rangeOfInteger',
  0x35: 'textWithLanguage',
  0x36: 'nameWithLanguage',
  0x41: 'textWithoutLanguage',
  0x42: 'nameWithoutLanguage',
  0x44: 'keyword',
  0x45: 'uri',
  0x46: 'uriScheme',
  0x47: 'charset',
  0x48: 'naturalLanguage',
  0x49: 'mimeMediaType',
  0x4A: 'memberAttrName',
};

/**
 * Build an IPP Get-Printer-Attributes request payload
 */
function buildGetPrinterAttributesRequest(printerUri: string, requestId: number = 1): Uint8Array {
  const parts: number[] = [];

  // Version: IPP/1.1
  parts.push(0x01, 0x01);

  // Operation: Get-Printer-Attributes (0x000B)
  parts.push(0x00, 0x0B);

  // Request ID
  parts.push((requestId >> 24) & 0xFF, (requestId >> 16) & 0xFF, (requestId >> 8) & 0xFF, requestId & 0xFF);

  // Operation attributes tag
  parts.push(0x01);

  // attributes-charset = utf-8
  parts.push(0x47); // charset value tag
  const charsetName = new TextEncoder().encode('attributes-charset');
  parts.push((charsetName.length >> 8) & 0xFF, charsetName.length & 0xFF);
  for (const b of charsetName) parts.push(b);
  const charsetValue = new TextEncoder().encode('utf-8');
  parts.push((charsetValue.length >> 8) & 0xFF, charsetValue.length & 0xFF);
  for (const b of charsetValue) parts.push(b);

  // attributes-natural-language = en
  parts.push(0x48); // naturalLanguage value tag
  const langName = new TextEncoder().encode('attributes-natural-language');
  parts.push((langName.length >> 8) & 0xFF, langName.length & 0xFF);
  for (const b of langName) parts.push(b);
  const langValue = new TextEncoder().encode('en');
  parts.push((langValue.length >> 8) & 0xFF, langValue.length & 0xFF);
  for (const b of langValue) parts.push(b);

  // printer-uri
  parts.push(0x45); // uri value tag
  const uriName = new TextEncoder().encode('printer-uri');
  parts.push((uriName.length >> 8) & 0xFF, uriName.length & 0xFF);
  for (const b of uriName) parts.push(b);
  const uriValue = new TextEncoder().encode(printerUri);
  parts.push((uriValue.length >> 8) & 0xFF, uriValue.length & 0xFF);
  for (const b of uriValue) parts.push(b);

  // End of attributes
  parts.push(0x03);

  return new Uint8Array(parts);
}

/**
 * Parse IPP response attributes from binary data
 */
function parseIPPResponse(data: Uint8Array): {
  version: string;
  statusCode: number;
  requestId: number;
  attributes: IPPAttribute[];
} {
  if (data.length < 8) {
    throw new Error('IPP response too short');
  }

  const version = `${data[0]}.${data[1]}`;
  const statusCode = (data[2] << 8) | data[3];
  const requestId = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];

  const attributes: IPPAttribute[] = [];
  let offset = 8;
  const decoder = new TextDecoder();

  while (offset < data.length) {
    const tag = data[offset];
    offset++;

    // Delimiter tags (0x00-0x0F)
    if (tag <= 0x0F) {
      if (tag === 0x03) break; // end-of-attributes-tag
      continue; // other group tags
    }

    // Value tag - read attribute
    if (offset + 2 > data.length) break;
    const nameLength = (data[offset] << 8) | data[offset + 1];
    offset += 2;

    if (offset + nameLength > data.length) break;
    const name = nameLength > 0 ? decoder.decode(data.slice(offset, offset + nameLength)) : '';
    offset += nameLength;

    if (offset + 2 > data.length) break;
    const valueLength = (data[offset] << 8) | data[offset + 1];
    offset += 2;

    if (offset + valueLength > data.length) break;
    const valueBytes = data.slice(offset, offset + valueLength);
    offset += valueLength;

    // Decode value based on tag type
    let value: string;
    if (tag === 0x21 && valueLength === 4) {
      // integer
      value = String((valueBytes[0] << 24) | (valueBytes[1] << 16) | (valueBytes[2] << 8) | valueBytes[3]);
    } else if (tag === 0x22 && valueLength === 1) {
      // boolean
      value = valueBytes[0] ? 'true' : 'false';
    } else if (tag === 0x23 && valueLength === 4) {
      // enum
      value = String((valueBytes[0] << 24) | (valueBytes[1] << 16) | (valueBytes[2] << 8) | valueBytes[3]);
    } else if (tag >= 0x40 && tag <= 0x4A) {
      // text/keyword/uri/charset/language/mime
      value = decoder.decode(valueBytes);
    } else {
      // fallback: hex
      value = Array.from(valueBytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
    }

    if (name) {
      attributes.push({ name, value });
    }
  }

  return { version, statusCode, requestId, attributes };
}

/**
 * Probe an IPP server by sending Get-Printer-Attributes
 */
export async function handleIPPProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as IPPRequest;
    const { host, port = 631, timeout = 10000 } = body;
    const printerUri = body.printerUri || `ipp://${host}:${port}/ipp/print`;

    // Validation
    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const startTime = Date.now();

    // Build IPP request
    const ippPayload = buildGetPrinterAttributesRequest(printerUri);

    // Build HTTP request wrapping the IPP payload
    const httpRequest =
      `POST /ipp/print HTTP/1.1\r\n` +
      `Host: ${host}:${port}\r\n` +
      `Content-Type: application/ipp\r\n` +
      `Content-Length: ${ippPayload.length}\r\n` +
      `Connection: close\r\n` +
      `\r\n`;

    const httpBytes = new TextEncoder().encode(httpRequest);
    const fullRequest = new Uint8Array(httpBytes.length + ippPayload.length);
    fullRequest.set(httpBytes);
    fullRequest.set(ippPayload, httpBytes.length);

    // Connect
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send HTTP+IPP request
      await writer.write(fullRequest);

      // Read response (may come in multiple chunks)
      const chunks: Uint8Array[] = [];
      let totalLength = 0;
      const maxSize = 64 * 1024; // 64KB limit

      while (totalLength < maxSize) {
        const readResult = await Promise.race([
          reader.read(),
          timeoutPromise
        ]);

        if (readResult.done || !readResult.value) break;

        chunks.push(readResult.value);
        totalLength += readResult.value.length;

        // Check if we've received the full HTTP response
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }

        const text = new TextDecoder().decode(combined);
        // Check for end of HTTP response with content
        if (text.includes('\r\n\r\n')) {
          const headerEnd = text.indexOf('\r\n\r\n');
          const headers = text.substring(0, headerEnd);
          const contentLengthMatch = headers.match(/Content-Length:\s*(\d+)/i);
          if (contentLengthMatch) {
            const contentLength = parseInt(contentLengthMatch[1]);
            const bodyStart = headerEnd + 4;
            if (totalLength >= bodyStart + contentLength) break;
          } else {
            // No content-length, try to read a bit more then stop
            if (chunks.length > 3) break;
          }
        }
      }

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const rtt = Date.now() - startTime;

      // Combine all chunks
      const fullResponse = new Uint8Array(totalLength);
      let off = 0;
      for (const chunk of chunks) {
        fullResponse.set(chunk, off);
        off += chunk.length;
      }

      const responseText = new TextDecoder().decode(fullResponse);

      // Parse HTTP response
      const headerEnd = responseText.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        throw new Error('Invalid HTTP response from IPP server');
      }

      const httpHeaders = responseText.substring(0, headerEnd);
      const statusLine = httpHeaders.split('\r\n')[0];
      const bodyStart = headerEnd + 4;
      const bodyBytes = fullResponse.slice(new TextEncoder().encode(responseText.substring(0, bodyStart)).length);

      const response: IPPResponse = {
        success: true,
        host,
        port,
        rawHttpStatus: statusLine,
        rtt,
      };

      // Try to parse IPP binary response
      if (bodyBytes.length >= 8) {
        try {
          const parsed = parseIPPResponse(bodyBytes);
          response.version = parsed.version;
          response.statusCode = parsed.statusCode;
          response.statusMessage = IPP_STATUS_CODES[parsed.statusCode] || `unknown (0x${parsed.statusCode.toString(16).padStart(4, '0')})`;
          response.attributes = parsed.attributes.slice(0, 50); // Limit to 50 attributes
        } catch {
          // IPP parsing failed but HTTP succeeded
          response.attributes = [];
        }
      }

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      socket.close();
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      host: '',
      port: 0,
      rtt: 0
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
