/**
 * CoAP Protocol Implementation (RFC 7252, RFC 8323)
 *
 * Constrained Application Protocol - A lightweight RESTful protocol for IoT.
 * Designed for resource-constrained devices and low-bandwidth networks.
 *
 * Protocol Overview:
 * - Port 5683 (CoAP), 5684 (CoAPS with DTLS)
 * - Binary protocol with 4-byte header minimum
 * - RESTful methods: GET, POST, PUT, DELETE
 * - UDP primary, TCP supported (RFC 8323)
 *
 * Message Format:
 * - Version (2 bits): Always 1
 * - Type (2 bits): CON, NON, ACK, RST
 * - Token Length (4 bits): 0-8 bytes
 * - Code (8 bits): Method or Response code
 * - Message ID (16 bits): For matching requests/responses
 * - Token (0-8 bytes): For matching requests/responses
 * - Options (variable): Uri-Path, Content-Format, etc.
 * - Payload (variable): Optional data
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// CoAP Message Types
const COAP_TYPE = {
  CONFIRMABLE: 0,    // CON - requires acknowledgment
  NON_CONFIRMABLE: 1, // NON - does not require acknowledgment
  ACKNOWLEDGMENT: 2,  // ACK - acknowledges CON message
  RESET: 3,          // RST - indicates error in received message
} as const;

// CoAP Method Codes (0.XX)
const COAP_METHOD = {
  GET: 0x01,    // 0.01
  POST: 0x02,   // 0.02
  PUT: 0x03,    // 0.03
  DELETE: 0x04, // 0.04
} as const;

// CoAP Response Codes (X.XX) - for reference
// const COAP_RESPONSE = {
//   // Success 2.XX
//   CREATED: 0x41,              // 2.01
//   DELETED: 0x42,              // 2.02
//   VALID: 0x43,                // 2.03
//   CHANGED: 0x44,              // 2.04
//   CONTENT: 0x45,              // 2.05
//
//   // Client Error 4.XX
//   BAD_REQUEST: 0x80,          // 4.00
//   UNAUTHORIZED: 0x81,         // 4.01
//   BAD_OPTION: 0x82,           // 4.02
//   FORBIDDEN: 0x83,            // 4.03
//   NOT_FOUND: 0x84,            // 4.04
//   METHOD_NOT_ALLOWED: 0x85,   // 4.05
//   NOT_ACCEPTABLE: 0x86,       // 4.06
//   PRECONDITION_FAILED: 0x8c,  // 4.12
//   REQUEST_ENTITY_TOO_LARGE: 0x8d, // 4.13
//   UNSUPPORTED_CONTENT_FORMAT: 0x8f, // 4.15
//
//   // Server Error 5.XX
//   INTERNAL_SERVER_ERROR: 0xa0, // 5.00
//   NOT_IMPLEMENTED: 0xa1,       // 5.01
//   BAD_GATEWAY: 0xa2,           // 5.02
//   SERVICE_UNAVAILABLE: 0xa3,   // 5.03
//   GATEWAY_TIMEOUT: 0xa4,       // 5.04
//   PROXYING_NOT_SUPPORTED: 0xa5, // 5.05
// } as const;

// CoAP Option Numbers
const COAP_OPTION = {
  IF_MATCH: 1,
  URI_HOST: 3,
  ETAG: 4,
  IF_NONE_MATCH: 5,
  URI_PORT: 7,
  LOCATION_PATH: 8,
  URI_PATH: 11,
  CONTENT_FORMAT: 12,
  MAX_AGE: 14,
  URI_QUERY: 15,
  ACCEPT: 17,
  LOCATION_QUERY: 20,
  PROXY_URI: 35,
  PROXY_SCHEME: 39,
  SIZE1: 60,
} as const;

// CoAP Content Formats
const CONTENT_FORMAT = {
  TEXT_PLAIN: 0,
  APPLICATION_LINK_FORMAT: 40,
  APPLICATION_XML: 41,
  APPLICATION_OCTET_STREAM: 42,
  APPLICATION_EXI: 47,
  APPLICATION_JSON: 50,
  APPLICATION_CBOR: 60,
} as const;

interface CoAPRequest {
  host: string;
  port?: number;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  payload?: string;
  contentFormat?: number;
  confirmable?: boolean;
  timeout?: number;
}

interface CoAPResponse {
  success: boolean;
  code?: number;
  codeClass?: number;
  codeDetail?: number;
  codeName?: string;
  payload?: string;
  contentFormat?: number;
  options?: Record<string, unknown>;
  error?: string;
}

/**
 * Encode CoAP message code (class.detail format)
 */
function formatCode(code: number): string {
  const codeClass = (code >> 5) & 0x7;
  const codeDetail = code & 0x1f;
  return `${codeClass}.${codeDetail.toString().padStart(2, '0')}`;
}

/**
 * Get human-readable code name
 */
function getCodeName(code: number): string {
  const codeMap: Record<number, string> = {
    0x01: 'GET',
    0x02: 'POST',
    0x03: 'PUT',
    0x04: 'DELETE',
    0x41: 'Created',
    0x42: 'Deleted',
    0x43: 'Valid',
    0x44: 'Changed',
    0x45: 'Content',
    0x80: 'Bad Request',
    0x81: 'Unauthorized',
    0x82: 'Bad Option',
    0x83: 'Forbidden',
    0x84: 'Not Found',
    0x85: 'Method Not Allowed',
    0x86: 'Not Acceptable',
    0x8c: 'Precondition Failed',
    0x8d: 'Request Entity Too Large',
    0x8f: 'Unsupported Content Format',
    0xa0: 'Internal Server Error',
    0xa1: 'Not Implemented',
    0xa2: 'Bad Gateway',
    0xa3: 'Service Unavailable',
    0xa4: 'Gateway Timeout',
    0xa5: 'Proxying Not Supported',
  };

  return codeMap[code] || `Unknown (${formatCode(code)})`;
}

/**
 * Encode CoAP option delta/length using extended format
 */
function encodeOptionDeltaLength(value: number): { byte: number; extended: number[] } {
  if (value < 13) {
    return { byte: value, extended: [] };
  } else if (value < 269) {
    return { byte: 13, extended: [value - 13] };
  } else {
    const extValue = value - 269;
    return { byte: 14, extended: [(extValue >> 8) & 0xff, extValue & 0xff] };
  }
}

/**
 * Encode a single CoAP option
 */
function encodeOption(delta: number, value: Uint8Array): Uint8Array {
  const deltaEncoded = encodeOptionDeltaLength(delta);
  const lengthEncoded = encodeOptionDeltaLength(value.length);

  const header = (deltaEncoded.byte << 4) | lengthEncoded.byte;

  const result = new Uint8Array(
    1 + deltaEncoded.extended.length + lengthEncoded.extended.length + value.length
  );

  let offset = 0;
  result[offset++] = header;

  for (const byte of deltaEncoded.extended) {
    result[offset++] = byte;
  }

  for (const byte of lengthEncoded.extended) {
    result[offset++] = byte;
  }

  result.set(value, offset);

  return result;
}

/**
 * Build CoAP request message
 */
function buildCoAPRequest(
  method: number,
  path: string,
  payload: string | undefined,
  confirmable: boolean,
  contentFormat?: number
): Uint8Array {
  const parts: Uint8Array[] = [];

  // Generate random message ID and token
  const messageId = Math.floor(Math.random() * 0x10000);
  const token = Math.floor(Math.random() * 0x100000000);
  const tokenBytes = new Uint8Array([
    (token >> 24) & 0xff,
    (token >> 16) & 0xff,
    (token >> 8) & 0xff,
    token & 0xff,
  ]);

  // Header (4 bytes)
  const version = 1;
  const type = confirmable ? COAP_TYPE.CONFIRMABLE : COAP_TYPE.NON_CONFIRMABLE;
  const tokenLength = tokenBytes.length;

  const header = new Uint8Array(4);
  header[0] = (version << 6) | (type << 4) | tokenLength;
  header[1] = method;
  header[2] = (messageId >> 8) & 0xff;
  header[3] = messageId & 0xff;

  parts.push(header);
  parts.push(tokenBytes);

  // Options
  const pathSegments = path.split('/').filter((s) => s.length > 0);
  let previousOptionNumber = 0;

  // Uri-Path options
  for (const segment of pathSegments) {
    const delta = COAP_OPTION.URI_PATH - previousOptionNumber;
    const value = new TextEncoder().encode(segment);
    parts.push(encodeOption(delta, value));
    previousOptionNumber = COAP_OPTION.URI_PATH;
  }

  // Content-Format option
  if (contentFormat !== undefined && payload) {
    const delta = COAP_OPTION.CONTENT_FORMAT - previousOptionNumber;
    const value = new Uint8Array([contentFormat]);
    parts.push(encodeOption(delta, value));
    previousOptionNumber = COAP_OPTION.CONTENT_FORMAT;
  }

  // Payload
  if (payload) {
    // Payload marker (0xFF)
    parts.push(new Uint8Array([0xff]));
    parts.push(new TextEncoder().encode(payload));
  }

  // Combine all parts
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const message = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    message.set(part, offset);
    offset += part.length;
  }

  return message;
}

/**
 * Decode option delta/length extended format
 */
function decodeOptionDeltaLength(
  nibble: number,
  data: Uint8Array,
  offset: number
): { value: number; bytesRead: number } {
  if (nibble < 13) {
    return { value: nibble, bytesRead: 0 };
  } else if (nibble === 13) {
    return { value: data[offset] + 13, bytesRead: 1 };
  } else if (nibble === 14) {
    return { value: ((data[offset] << 8) | data[offset + 1]) + 269, bytesRead: 2 };
  } else {
    throw new Error('Reserved option delta/length value (15)');
  }
}

/**
 * Parse CoAP response message
 */
function parseCoAPResponse(data: Uint8Array): Omit<CoAPResponse, 'success'> {
  if (data.length < 4) {
    throw new Error('CoAP message too short');
  }

  // Parse header
  const version = (data[0] >> 6) & 0x3;
  // const _type = (data[0] >> 4) & 0x3;
  const tokenLength = data[0] & 0xf;
  const code = data[1];
  // const _messageId = (data[2] << 8) | data[3];

  if (version !== 1) {
    throw new Error(`Unsupported CoAP version: ${version}`);
  }

  // Parse token
  if (data.length < 4 + tokenLength) {
    throw new Error('CoAP message truncated (token)');
  }

  // const _token = data.slice(4, 4 + tokenLength);

  // Parse options and payload
  let offset = 4 + tokenLength;
  const options: Record<string, unknown> = {};
  let previousOptionNumber = 0;
  let payload: Uint8Array | undefined;

  while (offset < data.length) {
    const byte = data[offset];

    // Payload marker
    if (byte === 0xff) {
      payload = data.slice(offset + 1);
      break;
    }

    // Parse option
    const deltaNibble = (byte >> 4) & 0xf;
    const lengthNibble = byte & 0xf;

    offset++;

    const deltaDecoded = decodeOptionDeltaLength(deltaNibble, data, offset);
    offset += deltaDecoded.bytesRead;

    const lengthDecoded = decodeOptionDeltaLength(lengthNibble, data, offset);
    offset += lengthDecoded.bytesRead;

    const optionNumber = previousOptionNumber + deltaDecoded.value;
    const optionValue = data.slice(offset, offset + lengthDecoded.value);
    offset += lengthDecoded.value;

    // Store option (simplified - just store the last value for each option number)
    options[optionNumber] = optionValue;
    previousOptionNumber = optionNumber;
  }

  // Extract content format
  let contentFormat: number | undefined;
  if (options[COAP_OPTION.CONTENT_FORMAT]) {
    const cf = options[COAP_OPTION.CONTENT_FORMAT] as Uint8Array;
    contentFormat = cf[0];
  }

  // Decode payload based on content format
  let payloadStr: string | undefined;
  if (payload) {
    if (contentFormat === CONTENT_FORMAT.APPLICATION_JSON || contentFormat === CONTENT_FORMAT.TEXT_PLAIN) {
      payloadStr = new TextDecoder().decode(payload);
    } else {
      // For binary formats, return base64
      payloadStr = btoa(String.fromCharCode(...payload));
    }
  }

  const codeClass = (code >> 5) & 0x7;
  const codeDetail = code & 0x1f;

  return {
    code,
    codeClass,
    codeDetail,
    codeName: getCodeName(code),
    payload: payloadStr,
    contentFormat,
    options,
  };
}

/**
 * Handle CoAP request
 */
export async function handleCoAPRequest(request: Request): Promise<Response> {
  try {
    const body = await request.json() as CoAPRequest;
    const {
      host,
      port = 5683,
      method,
      path,
      payload,
      contentFormat,
      confirmable = true,
      timeout = 10000,
    } = body;

    // Validation
    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!method || !['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Valid method required (GET, POST, PUT, DELETE)',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!path) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Path is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    // Map method name to code
    const methodCode = COAP_METHOD[method as keyof typeof COAP_METHOD];

    // Build CoAP request
    const requestMessage = buildCoAPRequest(
      methodCode,
      path,
      payload,
      confirmable,
      contentFormat
    );

    // Connect to CoAP server
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send CoAP request
      await writer.write(requestMessage);

      // Read CoAP response
      const { value: responseData } = await Promise.race([
        reader.read(),
        timeoutPromise,
      ]);

      if (!responseData) {
        throw new Error('No response from CoAP server');
      }

      // Parse response
      const result = parseCoAPResponse(responseData);

      // Cleanup
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: true,
        ...result,
      }), {
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
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle CoAP resource discovery (.well-known/core)
 */
export async function handleCoAPDiscover(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const host = url.searchParams.get('host');
    const port = parseInt(url.searchParams.get('port') || '5683');

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host parameter required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Perform GET request to /.well-known/core
    return handleCoAPRequest(new Request(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host,
        port,
        method: 'GET',
        path: '/.well-known/core',
        confirmable: true,
        timeout: 10000,
      }),
    }));
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
