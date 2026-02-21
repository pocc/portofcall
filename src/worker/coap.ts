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

// ─────────────────────────────────────────────────────────────────────────────
// Block-wise option constants (RFC 7959)
// ─────────────────────────────────────────────────────────────────────────────

const COAP_BLOCK2_OPTION = 27; // Block2: server→client block transfer
const COAP_BLOCK1_OPTION = 23; // Block1: client→server (reference only)

/** Block SZX → byte size: 2^(SZX+4) */
const SZX_TO_SIZE: Record<number, number> = {
  0: 16, 1: 32, 2: 64, 3: 128, 4: 256, 5: 512, 6: 1024,
};

/**
 * Decode a Block1/Block2 option value into NUM, M (more), SZX fields.
 * The option value is 1, 2, or 3 bytes:
 *   1 byte:  NNNNMSSS  (NUM in top 4 bits, M=bit 3, SZX=bits 2-0)
 *   2 bytes: NNNNNNNNNNNNMSSS (big-endian 16-bit, bottom 4 bits = M+SZX)
 *   3 bytes: NNNNNNNNNNNNNNNNNNNNMSSS (big-endian 24-bit)
 */
function decodeBlockOption(data: Uint8Array): { num: number; more: boolean; szx: number; blockSize: number } {
  let raw = 0;
  for (let i = 0; i < data.length; i++) {
    raw = (raw << 8) | data[i];
  }
  const szx  = raw & 0x07;
  const more = (raw & 0x08) !== 0;
  const num  = raw >> 4;
  return { num, more, szx, blockSize: SZX_TO_SIZE[szx] ?? 1024 };
}

/**
 * Encode a Block2 option value for a request (NUM, M=0, SZX).
 * NUM < 16  → 1 byte
 * NUM < 4096 → 2 bytes
 * else      → 3 bytes
 */
function encodeBlockOption(num: number, more: boolean, szx: number): Uint8Array {
  const raw = (num << 4) | (more ? 0x08 : 0) | (szx & 0x07);
  if (raw <= 0xFF) return new Uint8Array([raw]);
  if (raw <= 0xFFFF) return new Uint8Array([(raw >> 8) & 0xFF, raw & 0xFF]);
  return new Uint8Array([(raw >> 16) & 0xFF, (raw >> 8) & 0xFF, raw & 0xFF]);
}

/**
 * Build a CoAP GET with a Block2 option requesting a specific block number.
 * Used during block-wise transfer to fetch subsequent blocks.
 */
function buildCoAPBlockRequest(
  path: string,
  blockNum: number,
  szx: number,
  msgId: number
): Uint8Array {
  const tokenBytes = new Uint8Array([0xB1, 0x0C, 0xCA, 0xFE]); // fixed token for block session
  const parts: Uint8Array[] = [];

  // Header
  const header = new Uint8Array(4);
  header[0] = (1 << 6) | (COAP_TYPE.CONFIRMABLE << 4) | tokenBytes.length;
  header[1] = COAP_METHOD.GET;
  header[2] = (msgId >> 8) & 0xFF;
  header[3] = msgId & 0xFF;
  parts.push(header);
  parts.push(tokenBytes);

  // Uri-Path options
  const pathSegments = path.split('/').filter(s => s.length > 0);
  let prevOpt = 0;
  const enc = new TextEncoder();
  for (const seg of pathSegments) {
    parts.push(encodeOption(COAP_OPTION.URI_PATH - prevOpt, enc.encode(seg)));
    prevOpt = COAP_OPTION.URI_PATH;
  }

  // Block2 option (27) requesting specific block
  const block2Val = encodeBlockOption(blockNum, false, szx);
  parts.push(encodeOption(COAP_BLOCK2_OPTION - prevOpt, block2Val));

  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const msg = new Uint8Array(totalLen);
  let off = 0;
  for (const p of parts) { msg.set(p, off); off += p.length; }
  return msg;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * CoAP Block-wise GET — RFC 7959 §2.
 *
 * Standard CoAP payloads are limited to ~1KB on constrained networks. For
 * firmware images, configuration blobs, or large sensor logs, the Block2
 * option negotiates a sequence of smaller responses that the client reassembles.
 *
 * Protocol flow:
 *   Client → GET /resource (no Block2 option)
 *   Server ← 2.05 Content + Block2(NUM=0, M=1, SZX=6) + payload[0..1023]
 *   Client → GET /resource + Block2(NUM=1, SZX=6)
 *   Server ← 2.05 Content + Block2(NUM=1, M=1, SZX=6) + payload[1024..2047]
 *   ...
 *   Client → GET /resource + Block2(NUM=N, SZX=6)
 *   Server ← 2.05 Content + Block2(NUM=N, M=0, SZX=6) + payload[N*1024..end]
 *
 * POST /api/coap/block-get
 * Body: { host, port?, path, szx?, maxBlocks?, timeout? }
 *   szx: block size exponent 0-6 (default 6 = 1024 bytes per block)
 *   maxBlocks: safety cap (default 64 = up to 64 KB at szx=6)
 *   timeout: per-block timeout in ms (default 10000)
 *
 * Returns: { success, path, blocks, totalBytes, contentFormat, payload }
 */
export async function handleCoAPBlockGet(request: Request): Promise<Response> {
  try {
    const {
      host,
      port = 5683,
      path,
      szx = 6,
      maxBlocks = 64,
      timeout = 10000,
    } = await request.json<{
      host: string;
      port?: number;
      path: string;
      szx?: number;
      maxBlocks?: number;
      timeout?: number;
    }>();

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!path) {
      return new Response(JSON.stringify({ success: false, error: 'path is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const szxClamped = Math.max(0, Math.min(6, szx));
    const blockSize  = SZX_TO_SIZE[szxClamped] ?? 1024;

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const startTime = Date.now();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Block transfer timeout')), timeout)
    );

    const socket = connect(`${host}:${port}`);
    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    const payloadChunks: Uint8Array[] = [];
    let totalBytes = 0;
    let contentFormat: number | undefined;
    let blocksReceived = 0;
    let nextBlockNum = 0;

    // ── RFC 7959 §2.4 block-wise exchange helper ──────────────────────────────
    // For each CON request we must:
    //   1. Send the CON request.
    //   2. Receive the response.  It may be:
    //      a. A piggybacked ACK (type=2, code≠0.00) → this IS the response.
    //      b. A separate empty ACK (type=2, code=0.00) → discard; wait for a
    //         separate CON/NON response that carries the payload.
    //      c. A non-confirmable (type=1) response → treat as final response.
    //   3. Check the code:
    //      - 2.05 (0x45) Content  → this is either the only block or the last.
    //      - 2.31 (0x5F) Continue → more blocks to request.
    //      - anything else        → error; abort.
    //
    // Response codes:
    //   CONTENT  = 0x45  (class 2, detail 5)
    //   CONTINUE = 0x5F  (class 2, detail 31) — used for Block1 upload; for
    //              Block2 download the server always returns CONTENT (2.05).
    //              We keep the CONTINUE check for completeness.
    const COAP_CODE_CONTENT  = 0x45; // 2.05
    const COAP_CODE_CONTINUE = 0x5F; // 2.31
    const COAP_TYPE_ACK      = 2;

    /**
     * Read one CoAP PDU, skipping empty ACKs (piggybacked-ACK acknowledgement
     * without a response code) per RFC 7252 §4.2.
     * Returns the first PDU that carries actual response data.
     */
    async function readBlockResponse(): Promise<Uint8Array> {
      while (true) {
        const result = await Promise.race([reader.read(), timeoutPromise]);
        if (result.done || !result.value) throw new Error('Connection closed during block transfer');
        const pdu = result.value;
        if (pdu.length < 4) continue;
        const pduType = (pdu[0] >> 4) & 0x3;
        const pduCode = pdu[1];
        // Empty ACK (type=ACK, code=0.00) — server is still preparing the response.
        // RFC 7252 §4.2: discard and keep reading for the separate response.
        if (pduType === COAP_TYPE_ACK && pduCode === 0x00) continue;
        return pdu;
      }
    }

    // Phase 1: initial GET with no Block2 option (let server choose block size)
    const initMsg = buildCoAPRequest(COAP_METHOD.GET, path, undefined, true);
    let msgId = (initMsg[2] << 8) | initMsg[3];
    await writer.write(initMsg);

    try {
      while (blocksReceived < maxBlocks) {
        // RFC 7959 §2.4: wait for response to the CON request we just sent.
        const pdu = await readBlockResponse();

        const resp = parseCoAPResponse(pdu);

        // Verify the response carries an expected code before accepting payload.
        if (resp.code !== COAP_CODE_CONTENT && resp.code !== COAP_CODE_CONTINUE) {
          // Server returned an error (4.xx / 5.xx) or unexpected code — stop.
          break;
        }

        // Content-Format from first response
        if (contentFormat === undefined && resp.contentFormat !== undefined) {
          contentFormat = resp.contentFormat;
        }

        // Check response for Block2 option in raw options
        const { block2, rawPayload } = extractBlock2AndPayload(pdu);

        // RFC 7959 §2.4: validate the received block number matches what we requested.
        // A mismatch indicates a server bug or a response belonging to a different
        // request — accepting out-of-order blocks would corrupt the assembled payload.
        if (block2 && block2.num !== nextBlockNum) {
          throw new Error(
            `CoAP block sequence error: expected block ${nextBlockNum}, received block ${block2.num}`
          );
        }

        if (rawPayload) {
          payloadChunks.push(rawPayload);
          totalBytes += rawPayload.length;
        }
        blocksReceived++;

        if (!block2 || !block2.more) {
          // No Block2 option (server returned everything in one go) or M=0 (last block)
          break;
        }

        // More blocks to fetch — send next CON request, then loop back to read.
        nextBlockNum = block2.num + 1;
        msgId = (msgId + 1) & 0xFFFF;
        const blockReq = buildCoAPBlockRequest(path, nextBlockNum, block2.szx, msgId);
        // Send the next block request AFTER receiving the previous response (RFC 7959 §2.4)
        await writer.write(blockReq);
      }
    } finally {
      writer.releaseLock();
      reader.releaseLock();
      socket.close();
    }

    // Assemble full payload
    const combined = new Uint8Array(totalBytes);
    let off = 0;
    for (const chunk of payloadChunks) { combined.set(chunk, off); off += chunk.length; }

    let payloadStr: string;
    try {
      payloadStr = new TextDecoder('utf-8', { fatal: true }).decode(combined);
    } catch {
      let binaryStr = '';
      for (let i = 0; i < combined.length; i++) binaryStr += String.fromCharCode(combined[i]);
      payloadStr = btoa(binaryStr);
    }

    return new Response(JSON.stringify({
      success: true,
      host, port, path,
      szx: szxClamped,
      blockSize,
      blocks: blocksReceived,
      totalBytes,
      contentFormat,
      payload: payloadStr,
      latencyMs: Date.now() - startTime,
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Block GET failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Parse raw CoAP response bytes to extract Block2 option value and raw payload.
 * We need the raw option bytes, not the decoded string, to access Block2.
 */
function extractBlock2AndPayload(data: Uint8Array): {
  block2?: { num: number; more: boolean; szx: number };
  rawPayload?: Uint8Array;
} {
  if (data.length < 4) return {};

  const tokenLength = data[0] & 0x0F;
  let offset = 4 + tokenLength;
  let prevOpt = 0;
  let block2: { num: number; more: boolean; szx: number } | undefined;
  let rawPayload: Uint8Array | undefined;

  while (offset < data.length) {
    const byte = data[offset];
    if (byte === 0xFF) {
      rawPayload = data.slice(offset + 1);
      break;
    }
    const deltaNibble  = (byte >> 4) & 0xF;
    const lengthNibble = byte & 0xF;
    offset++;

    const deltaResult  = decodeOptionDeltaLength(deltaNibble,  data, offset);
    offset += deltaResult.bytesRead;
    const lenResult    = decodeOptionDeltaLength(lengthNibble, data, offset);
    offset += lenResult.bytesRead;

    const optNum  = prevOpt + deltaResult.value;
    const optData = data.slice(offset, offset + lenResult.value);
    offset += lenResult.value;
    prevOpt = optNum;

    if (optNum === COAP_BLOCK2_OPTION) {
      block2 = decodeBlockOption(optData);
    }
  }

  return { block2, rawPayload };
}

// ─────────────────────────────────────────────────────────────────────────────
// Observe option (RFC 7641)
// ─────────────────────────────────────────────────────────────────────────────

const COAP_OBSERVE_OPTION = 6;

/**
 * CoAP Observe — RFC 7641.
 *
 * Observe allows a CoAP client to register interest in a resource and receive
 * notifications whenever it changes, without polling. It is the cornerstone
 * of real-time IoT monitoring (temperature sensors, door states, motion detectors).
 *
 * Protocol flow (subscribe):
 *   Client → GET /resource + Observe=0 (register)
 *   Server ← 2.05 Content + Observe=N + payload    (current value, CON or NON)
 *   Server ← 2.05 Content + Observe=N+k + payload  (on change, unsolicited)
 *   ...
 *   Client → GET /resource + Observe=1 (deregister) OR RST to any notification
 *
 * Observe sequence numbers are monotonically increasing mod 2^24. A receiver
 * should reject notifications with a stale sequence (with modular comparison).
 *
 * This endpoint:
 *   1. Sends GET with Observe=0 to subscribe.
 *   2. Returns the first notification received (the current resource value).
 *   3. Waits up to `observeMs` for a second notification (a change event).
 *   4. Sends RST to cancel the subscription before closing.
 *
 * POST /api/coap/observe
 * Body: { host, port?, path, observeMs?, timeout? }
 *   observeMs: how long to wait for a second notification (default 5000)
 *   timeout:   connection + first notification timeout (default 10000)
 *
 * Returns: {
 *   success, path,
 *   initial: { observeSeq, contentFormat, payload },
 *   update?:  { observeSeq, contentFormat, payload },  -- if a change arrived in observeMs
 *   latencyMs
 * }
 */
export async function handleCoAPObserve(request: Request): Promise<Response> {
  try {
    const {
      host,
      port = 5683,
      path,
      observeMs = 5000,
      timeout = 10000,
    } = await request.json<{
      host: string;
      port?: number;
      path: string;
      observeMs?: number;
      timeout?: number;
    }>();

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!path) {
      return new Response(JSON.stringify({ success: false, error: 'path is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const startTime = Date.now();
    const connTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const socket = connect(`${host}:${port}`);
    await Promise.race([socket.opened, connTimeout]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // Build GET + Observe=0 (register)
    const enc = new TextEncoder();
    const parts: Uint8Array[] = [];

    const msgId   = Math.floor(Math.random() * 0x10000);
    const token   = new Uint8Array([0x4F, 0xB5, 0xE1, 0x33]); // fixed token for observe session
    const header  = new Uint8Array(4);
    header[0] = (1 << 6) | (COAP_TYPE.CONFIRMABLE << 4) | token.length;
    header[1] = COAP_METHOD.GET;
    header[2] = (msgId >> 8) & 0xFF;
    header[3] = msgId & 0xFF;
    parts.push(header);
    parts.push(token);

    // Observe option = 0 (register), option number 6
    let prevOpt = 0;
    parts.push(encodeOption(COAP_OBSERVE_OPTION - prevOpt, new Uint8Array([0])));
    prevOpt = COAP_OBSERVE_OPTION;

    // Uri-Path
    for (const seg of path.split('/').filter(s => s.length > 0)) {
      parts.push(encodeOption(COAP_OPTION.URI_PATH - prevOpt, enc.encode(seg)));
      prevOpt = COAP_OPTION.URI_PATH;
    }

    const observeMsg = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let off = 0;
    for (const p of parts) { observeMsg.set(p, off); off += p.length; }

    await writer.write(observeMsg);

    /**
     * Parse an Observe notification: extract the Observe sequence number,
     * Content-Format, and payload from a raw CoAP response.
     */
    function parseObserveNotification(data: Uint8Array): {
      observeSeq?: number;
      contentFormat?: number;
      payload?: string;
      messageId: number;
      type: number;
    } {
      if (data.length < 4) return { messageId: 0, type: 0 };
      const msgType    = (data[0] >> 4) & 0x3;
      const tokenLen   = data[0] & 0x0F;
      const messageId  = (data[2] << 8) | data[3];
      let pos = 4 + tokenLen;
      let prev = 0;
      let observeSeq: number | undefined;
      let contentFormat: number | undefined;
      let rawPayload: Uint8Array | undefined;

      while (pos < data.length) {
        if (data[pos] === 0xFF) { rawPayload = data.slice(pos + 1); break; }
        const dNib = (data[pos] >> 4) & 0xF;
        const lNib = data[pos] & 0xF;
        pos++;
        const dRes = decodeOptionDeltaLength(dNib, data, pos); pos += dRes.bytesRead;
        const lRes = decodeOptionDeltaLength(lNib, data, pos); pos += lRes.bytesRead;
        const optN = prev + dRes.value;
        const optD = data.slice(pos, pos + lRes.value);
        pos += lRes.value;
        prev = optN;

        if (optN === COAP_OBSERVE_OPTION) {
          let seq = 0;
          for (let i = 0; i < optD.length; i++) seq = (seq << 8) | optD[i];
          observeSeq = seq;
        } else if (optN === COAP_OPTION.CONTENT_FORMAT) {
          let cf = 0;
          for (let i = 0; i < optD.length; i++) cf = (cf << 8) | optD[i];
          contentFormat = cf;
        }
      }

      let payload: string | undefined;
      if (rawPayload) {
        try {
          payload = new TextDecoder('utf-8', { fatal: true }).decode(rawPayload);
        } catch {
          payload = btoa(String.fromCharCode(...rawPayload));
        }
      }
      return { observeSeq, contentFormat, payload, messageId, type: msgType };
    }

    // Wait for first notification (current resource value)
    const firstResult = await Promise.race([reader.read(), connTimeout]);
    if (firstResult.done || !firstResult.value) {
      writer.releaseLock(); reader.releaseLock(); socket.close();
      return new Response(JSON.stringify({
        success: false,
        error: 'No response to Observe registration',
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const initial = parseObserveNotification(firstResult.value);

    // Wait up to observeMs for a second notification (a state change)
    let update: ReturnType<typeof parseObserveNotification> | undefined;
    try {
      const updateTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('observe_timeout')), observeMs)
      );
      const secondResult = await Promise.race([reader.read(), updateTimeout]);
      if (!secondResult.done && secondResult.value) {
        update = parseObserveNotification(secondResult.value);
      }
    } catch {
      // No second notification arrived within observeMs — normal
    }

    // Send RST to deregister (cancel subscription)
    const rstMsg = new Uint8Array([
      (1 << 6) | (COAP_TYPE.RESET << 4) | token.length,
      0x00,
      (initial.messageId >> 8) & 0xFF,
      initial.messageId & 0xFF,
      ...token,
    ]);
    try { await writer.write(rstMsg); } catch { /* ignore if socket closing */ }

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return new Response(JSON.stringify({
      success: true,
      host, port, path,
      subscribed: true,
      initial: {
        observeSeq: initial.observeSeq,
        contentFormat: initial.contentFormat,
        payload: initial.payload,
      },
      ...(update !== undefined && {
        update: {
          observeSeq: update.observeSeq,
          contentFormat: update.contentFormat,
          payload: update.payload,
        },
      }),
      latencyMs: Date.now() - startTime,
      note: update === undefined
        ? `No change notification arrived within ${observeMs}ms. Resource may be static or change interval exceeds observeMs.`
        : 'Received initial value and one change notification.',
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Observe failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// Suppress unused import warning — COAP_BLOCK1_OPTION is defined for reference
void COAP_BLOCK1_OPTION;
