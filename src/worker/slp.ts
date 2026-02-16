/**
 * SLP Protocol Implementation (RFC 2608)
 * Service Location Protocol
 * Port: 427 (TCP/UDP)
 *
 * SLP provides automatic service discovery on networks.
 * Three agent types: User Agent (UA), Service Agent (SA), Directory Agent (DA).
 *
 * Supports:
 * - Service Type Request (SrvTypeRqst) → discover available service types
 * - Service Request (SrvRqst) → find services of a given type
 * - Attribute Request (AttrRqst) → get attributes of a service URL
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// SLP version 2
const SLP_VERSION = 2;

// Message function IDs
const SLP_FUNC_SRVRQST = 1;
const SLP_FUNC_SRVRPLY = 2;
const SLP_FUNC_ATTRRQST = 6;
const SLP_FUNC_ATTRRPLY = 7;
const SLP_FUNC_SRVTYPERQST = 9;
const SLP_FUNC_SRVTYPERPLY = 10;

// Error codes
const SLP_ERROR_NAMES: Record<number, string> = {
  0: 'OK',
  1: 'LANGUAGE_NOT_SUPPORTED',
  2: 'PARSE_ERROR',
  3: 'INVALID_REGISTRATION',
  4: 'SCOPE_NOT_SUPPORTED',
  5: 'AUTHENTICATION_UNKNOWN',
  6: 'AUTHENTICATION_ABSENT',
  7: 'AUTHENTICATION_FAILED',
  9: 'VERSION_NOT_SUPPORTED',
  10: 'INTERNAL_ERROR',
  11: 'DA_BUSY',
  12: 'OPTION_NOT_UNDERSTOOD',
  13: 'INVALID_UPDATE',
  15: 'REFRESH_REJECTED',
};

// Function ID names
const SLP_FUNC_NAMES: Record<number, string> = {
  1: 'SrvRqst',
  2: 'SrvRply',
  3: 'SrvReg',
  4: 'SrvDeReg',
  5: 'SrvAck',
  6: 'AttrRqst',
  7: 'AttrRply',
  8: 'DAAdvert',
  9: 'SrvTypeRqst',
  10: 'SrvTypeRply',
  11: 'SAAdvert',
};

/**
 * Build SLP header (14 bytes + language tag)
 */
function buildSLPHeader(functionId: number, xid: number, language: string): number[] {
  const langBytes = new TextEncoder().encode(language);
  const buf: number[] = [];

  // Version (1 byte)
  buf.push(SLP_VERSION);

  // Function-ID (1 byte)
  buf.push(functionId);

  // Length (3 bytes) - placeholder, updated later
  buf.push(0, 0, 0);

  // Flags (2 bytes) - O=0, F=0, R=0
  buf.push(0, 0);

  // Next Extension Offset (3 bytes) - 0 = no extensions
  buf.push(0, 0, 0);

  // XID (2 bytes)
  buf.push((xid >> 8) & 0xff, xid & 0xff);

  // Language Tag Length (2 bytes) + Language Tag
  buf.push((langBytes.length >> 8) & 0xff, langBytes.length & 0xff);
  for (const b of langBytes) {
    buf.push(b);
  }

  return buf;
}

/**
 * Write a length-prefixed string (2-byte length + UTF-8 data)
 */
function writeString(buf: number[], str: string): void {
  const bytes = new TextEncoder().encode(str);
  buf.push((bytes.length >> 8) & 0xff, bytes.length & 0xff);
  for (const b of bytes) {
    buf.push(b);
  }
}

/**
 * Finalize an SLP message by setting the length field
 */
function finalizeMessage(buf: number[]): Uint8Array {
  const length = buf.length;
  buf[2] = (length >> 16) & 0xff;
  buf[3] = (length >> 8) & 0xff;
  buf[4] = length & 0xff;
  return new Uint8Array(buf);
}

/**
 * Build a Service Type Request (SrvTypeRqst)
 *
 * Format:
 *   <Header>
 *   <Previous Responder List Length> <Previous Responder List>
 *   <Naming Authority Length> <Naming Authority>
 *   <Scope List Length> <Scope List>
 */
function buildServiceTypeRequest(xid: number, scope: string, namingAuthority: string, language: string): Uint8Array {
  const buf = buildSLPHeader(SLP_FUNC_SRVTYPERQST, xid, language);

  // Previous Responder List (empty)
  writeString(buf, '');

  // Naming Authority
  if (namingAuthority === '*' || namingAuthority === '') {
    // 0xFFFF means "all naming authorities"
    buf.push(0xff, 0xff);
  } else {
    writeString(buf, namingAuthority);
  }

  // Scope List
  writeString(buf, scope);

  return finalizeMessage(buf);
}

/**
 * Build a Service Request (SrvRqst)
 *
 * Format:
 *   <Header>
 *   <Previous Responder List Length> <Previous Responder List>
 *   <Service Type Length> <Service Type>
 *   <Scope List Length> <Scope List>
 *   <Predicate Length> <Predicate>
 *   <SLP SPI Length> <SLP SPI>
 */
function buildServiceRequest(xid: number, serviceType: string, scope: string, predicate: string, language: string): Uint8Array {
  const buf = buildSLPHeader(SLP_FUNC_SRVRQST, xid, language);

  // Previous Responder List (empty)
  writeString(buf, '');

  // Service Type
  writeString(buf, serviceType);

  // Scope List
  writeString(buf, scope);

  // Predicate (LDAP filter)
  writeString(buf, predicate);

  // SLP SPI (empty)
  writeString(buf, '');

  return finalizeMessage(buf);
}

/**
 * Build an Attribute Request (AttrRqst)
 *
 * Format:
 *   <Header>
 *   <Previous Responder List Length> <Previous Responder List>
 *   <URL Length> <URL>
 *   <Scope List Length> <Scope List>
 *   <Tag List Length> <Tag List>
 *   <SLP SPI Length> <SLP SPI>
 */
function buildAttributeRequest(xid: number, url: string, scope: string, tags: string, language: string): Uint8Array {
  const buf = buildSLPHeader(SLP_FUNC_ATTRRQST, xid, language);

  // Previous Responder List (empty)
  writeString(buf, '');

  // URL
  writeString(buf, url);

  // Scope List
  writeString(buf, scope);

  // Tag List
  writeString(buf, tags);

  // SLP SPI (empty)
  writeString(buf, '');

  return finalizeMessage(buf);
}

/**
 * Parse SLP header from response data
 */
function parseSLPHeader(data: Uint8Array): {
  version: number;
  functionId: number;
  length: number;
  flags: number;
  xid: number;
  langTag: string;
  headerLength: number;
} {
  if (data.length < 14) {
    throw new Error('SLP response too short for header');
  }

  const version = data[0];
  const functionId = data[1];
  const length = (data[2] << 16) | (data[3] << 8) | data[4];
  const flags = (data[5] << 8) | data[6];
  const xid = (data[12] << 8) | data[13];

  // Language tag
  const langLen = (data[14] << 8) | data[15];
  const langTag = new TextDecoder().decode(data.slice(16, 16 + langLen));
  const headerLength = 16 + langLen;

  return { version, functionId, length, flags, xid, langTag, headerLength };
}

/**
 * Parse a Service Type Reply (SrvTypeRply)
 */
function parseServiceTypeReply(data: Uint8Array, offset: number): {
  errorCode: number;
  serviceTypes: string[];
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const errorCode = view.getUint16(offset, false);
  offset += 2;

  if (errorCode !== 0) {
    return { errorCode, serviceTypes: [] };
  }

  const listLength = view.getUint16(offset, false);
  offset += 2;

  if (listLength === 0) {
    return { errorCode, serviceTypes: [] };
  }

  const listStr = new TextDecoder().decode(data.slice(offset, offset + listLength));
  const serviceTypes = listStr.split(',').map(s => s.trim()).filter(s => s.length > 0);

  return { errorCode, serviceTypes };
}

/**
 * Parse a Service Reply (SrvRply)
 */
function parseServiceReply(data: Uint8Array, offset: number): {
  errorCode: number;
  services: Array<{ url: string; lifetime: number }>;
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const errorCode = view.getUint16(offset, false);
  offset += 2;

  if (errorCode !== 0) {
    return { errorCode, services: [] };
  }

  const urlCount = view.getUint16(offset, false);
  offset += 2;

  const services: Array<{ url: string; lifetime: number }> = [];

  for (let i = 0; i < urlCount && offset < data.length; i++) {
    // Reserved (1 byte)
    offset += 1;

    // Lifetime (2 bytes)
    const lifetime = view.getUint16(offset, false);
    offset += 2;

    // URL Length (2 bytes)
    const urlLength = view.getUint16(offset, false);
    offset += 2;

    // URL
    const url = new TextDecoder().decode(data.slice(offset, offset + urlLength));
    offset += urlLength;

    // Number of URL auths (1 byte)
    const authCount = data[offset++];

    // Skip authentication blocks
    for (let j = 0; j < authCount && offset < data.length; j++) {
      // Block Structure Descriptor (2 bytes) + Authentication Block Length (2 bytes)
      const blockLen = view.getUint16(offset + 2, false);
      offset += 2 + blockLen;
    }

    services.push({ url, lifetime });
  }

  return { errorCode, services };
}

/**
 * Parse an Attribute Reply (AttrRply)
 */
function parseAttributeReply(data: Uint8Array, offset: number): {
  errorCode: number;
  attributes: Record<string, string>;
  rawAttributeList: string;
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const errorCode = view.getUint16(offset, false);
  offset += 2;

  if (errorCode !== 0) {
    return { errorCode, attributes: {}, rawAttributeList: '' };
  }

  const listLength = view.getUint16(offset, false);
  offset += 2;

  const rawAttributeList = new TextDecoder().decode(data.slice(offset, offset + listLength));

  // Parse SLP attribute list format: (tag=value),(tag=value)
  const attributes: Record<string, string> = {};

  // SLP attributes are in the form (tag=value),(tag=value) or tag=value
  const parts = rawAttributeList.split(/,(?=\()|,(?=[^)]*$)/);
  for (const part of parts) {
    const cleaned = part.replace(/^\(|\)$/g, '').trim();
    const eqIdx = cleaned.indexOf('=');
    if (eqIdx > 0) {
      const tag = cleaned.substring(0, eqIdx).trim();
      const value = cleaned.substring(eqIdx + 1).trim();
      attributes[tag] = value;
    } else if (cleaned.length > 0) {
      // Boolean attribute (tag only, no value)
      attributes[cleaned] = 'true';
    }
  }

  return { errorCode, attributes, rawAttributeList };
}

/**
 * Read response data with timeout
 */
async function readResponse(reader: ReadableStreamDefaultReader<Uint8Array>, timeout: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout));

  // Read first chunk to get header
  const firstRead = await Promise.race([reader.read(), timeoutPromise]);
  if (!firstRead || (firstRead as ReadableStreamReadResult<Uint8Array>).done) {
    throw new Error('Connection closed before response');
  }

  const firstChunk = (firstRead as ReadableStreamReadResult<Uint8Array>).value!;
  chunks.push(firstChunk);
  totalLength += firstChunk.length;

  // Parse expected length from header
  if (totalLength >= 5) {
    const expectedLength = (firstChunk[2] << 16) | (firstChunk[3] << 8) | firstChunk[4];

    // Read remaining data
    while (totalLength < expectedLength) {
      const result = await Promise.race([reader.read(), timeoutPromise]);
      if (!result || (result as ReadableStreamReadResult<Uint8Array>).done) {
        break;
      }
      const chunk = (result as ReadableStreamReadResult<Uint8Array>).value!;
      chunks.push(chunk);
      totalLength += chunk.length;
    }
  }

  // Combine chunks
  const response = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    response.set(chunk, offset);
    offset += chunk.length;
  }

  return response;
}

/**
 * Handle SLP Service Type Request - discover available service types
 * POST /api/slp/types
 */
export async function handleSLPServiceTypes(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.json<{
      host?: string;
      port?: number;
      scope?: string;
      namingAuthority?: string;
      language?: string;
      timeout?: number;
    }>();

    if (!body.host) {
      return Response.json({ success: false, error: 'Host is required' }, { status: 400 });
    }

    const port = body.port || 427;
    if (port < 1 || port > 65535) {
      return Response.json({ success: false, error: 'Port must be between 1 and 65535' }, { status: 400 });
    }

    const scope = body.scope || 'DEFAULT';
    const namingAuthority = body.namingAuthority || '*';
    const language = body.language || 'en';
    const timeout = body.timeout || 10000;

    // Check for Cloudflare
    const cfCheck = await checkIfCloudflare(body.host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return Response.json({
        success: false,
        error: getCloudflareErrorMessage(body.host, cfCheck.ip),
        isCloudflare: true,
      }, { status: 403 });
    }

    const connectStart = Date.now();
    const socket = connect(`${body.host}:${port}`);
    await socket.opened;
    const connectTimeMs = Date.now() - connectStart;

    try {
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Build and send SrvTypeRqst
        const xid = Math.floor(Math.random() * 65536);
        const request_msg = buildServiceTypeRequest(xid, scope, namingAuthority, language);
        await writer.write(request_msg);

        // Read response
        const response = await readResponse(reader, timeout);
        const totalTimeMs = Date.now() - connectStart;

        // Parse header
        const header = parseSLPHeader(response);

        if (header.functionId !== SLP_FUNC_SRVTYPERPLY) {
          return Response.json({
            success: false,
            error: `Unexpected response: got ${SLP_FUNC_NAMES[header.functionId] || `function ${header.functionId}`}, expected SrvTypeRply`,
            responseFunction: SLP_FUNC_NAMES[header.functionId] || header.functionId,
            connectTimeMs,
            totalTimeMs,
          });
        }

        // Parse service type reply
        const reply = parseServiceTypeReply(response, header.headerLength);

        if (reply.errorCode !== 0) {
          return Response.json({
            success: false,
            error: `SLP error: ${SLP_ERROR_NAMES[reply.errorCode] || `code ${reply.errorCode}`}`,
            errorCode: reply.errorCode,
            errorName: SLP_ERROR_NAMES[reply.errorCode],
            connectTimeMs,
            totalTimeMs,
          });
        }

        return Response.json({
          success: true,
          host: body.host,
          port,
          version: header.version,
          xid: header.xid,
          languageTag: header.langTag,
          scope,
          serviceTypes: reply.serviceTypes,
          serviceTypeCount: reply.serviceTypes.length,
          connectTimeMs,
          totalTimeMs,
        });
      } finally {
        reader.releaseLock();
        writer.releaseLock();
      }
    } finally {
      await socket.close().catch(() => {});
    }
  } catch (error) {
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'SLP service type request failed',
    }, { status: 500 });
  }
}

/**
 * Handle SLP Service Find - find services of a given type
 * POST /api/slp/find
 */
export async function handleSLPServiceFind(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.json<{
      host?: string;
      port?: number;
      serviceType?: string;
      scope?: string;
      predicate?: string;
      language?: string;
      timeout?: number;
    }>();

    if (!body.host) {
      return Response.json({ success: false, error: 'Host is required' }, { status: 400 });
    }

    if (!body.serviceType) {
      return Response.json({ success: false, error: 'Service type is required' }, { status: 400 });
    }

    const port = body.port || 427;
    if (port < 1 || port > 65535) {
      return Response.json({ success: false, error: 'Port must be between 1 and 65535' }, { status: 400 });
    }

    const scope = body.scope || 'DEFAULT';
    const predicate = body.predicate || '';
    const language = body.language || 'en';
    const timeout = body.timeout || 10000;

    // Check for Cloudflare
    const cfCheck = await checkIfCloudflare(body.host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return Response.json({
        success: false,
        error: getCloudflareErrorMessage(body.host, cfCheck.ip),
        isCloudflare: true,
      }, { status: 403 });
    }

    const connectStart = Date.now();
    const socket = connect(`${body.host}:${port}`);
    await socket.opened;
    const connectTimeMs = Date.now() - connectStart;

    try {
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Build and send SrvRqst
        const xid = Math.floor(Math.random() * 65536);
        const request_msg = buildServiceRequest(xid, body.serviceType, scope, predicate, language);
        await writer.write(request_msg);

        // Read response
        const response = await readResponse(reader, timeout);
        const totalTimeMs = Date.now() - connectStart;

        // Parse header
        const header = parseSLPHeader(response);

        if (header.functionId !== SLP_FUNC_SRVRPLY) {
          return Response.json({
            success: false,
            error: `Unexpected response: got ${SLP_FUNC_NAMES[header.functionId] || `function ${header.functionId}`}, expected SrvRply`,
            responseFunction: SLP_FUNC_NAMES[header.functionId] || header.functionId,
            connectTimeMs,
            totalTimeMs,
          });
        }

        // Parse service reply
        const reply = parseServiceReply(response, header.headerLength);

        if (reply.errorCode !== 0) {
          return Response.json({
            success: false,
            error: `SLP error: ${SLP_ERROR_NAMES[reply.errorCode] || `code ${reply.errorCode}`}`,
            errorCode: reply.errorCode,
            errorName: SLP_ERROR_NAMES[reply.errorCode],
            connectTimeMs,
            totalTimeMs,
          });
        }

        return Response.json({
          success: true,
          host: body.host,
          port,
          version: header.version,
          xid: header.xid,
          serviceType: body.serviceType,
          scope,
          services: reply.services,
          serviceCount: reply.services.length,
          connectTimeMs,
          totalTimeMs,
        });
      } finally {
        reader.releaseLock();
        writer.releaseLock();
      }
    } finally {
      await socket.close().catch(() => {});
    }
  } catch (error) {
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'SLP service find failed',
    }, { status: 500 });
  }
}

/**
 * Handle SLP Attribute Request - get attributes of a service URL
 * POST /api/slp/attributes
 */
export async function handleSLPAttributes(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.json<{
      host?: string;
      port?: number;
      url?: string;
      scope?: string;
      tags?: string;
      language?: string;
      timeout?: number;
    }>();

    if (!body.host) {
      return Response.json({ success: false, error: 'Host is required' }, { status: 400 });
    }

    if (!body.url) {
      return Response.json({ success: false, error: 'Service URL is required' }, { status: 400 });
    }

    const port = body.port || 427;
    if (port < 1 || port > 65535) {
      return Response.json({ success: false, error: 'Port must be between 1 and 65535' }, { status: 400 });
    }

    const scope = body.scope || 'DEFAULT';
    const tags = body.tags || '';
    const language = body.language || 'en';
    const timeout = body.timeout || 10000;

    // Check for Cloudflare
    const cfCheck = await checkIfCloudflare(body.host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return Response.json({
        success: false,
        error: getCloudflareErrorMessage(body.host, cfCheck.ip),
        isCloudflare: true,
      }, { status: 403 });
    }

    const connectStart = Date.now();
    const socket = connect(`${body.host}:${port}`);
    await socket.opened;
    const connectTimeMs = Date.now() - connectStart;

    try {
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Build and send AttrRqst
        const xid = Math.floor(Math.random() * 65536);
        const request_msg = buildAttributeRequest(xid, body.url, scope, tags, language);
        await writer.write(request_msg);

        // Read response
        const response = await readResponse(reader, timeout);
        const totalTimeMs = Date.now() - connectStart;

        // Parse header
        const header = parseSLPHeader(response);

        if (header.functionId !== SLP_FUNC_ATTRRPLY) {
          return Response.json({
            success: false,
            error: `Unexpected response: got ${SLP_FUNC_NAMES[header.functionId] || `function ${header.functionId}`}, expected AttrRply`,
            responseFunction: SLP_FUNC_NAMES[header.functionId] || header.functionId,
            connectTimeMs,
            totalTimeMs,
          });
        }

        // Parse attribute reply
        const reply = parseAttributeReply(response, header.headerLength);

        if (reply.errorCode !== 0) {
          return Response.json({
            success: false,
            error: `SLP error: ${SLP_ERROR_NAMES[reply.errorCode] || `code ${reply.errorCode}`}`,
            errorCode: reply.errorCode,
            errorName: SLP_ERROR_NAMES[reply.errorCode],
            connectTimeMs,
            totalTimeMs,
          });
        }

        return Response.json({
          success: true,
          host: body.host,
          port,
          version: header.version,
          xid: header.xid,
          serviceUrl: body.url,
          scope,
          attributes: reply.attributes,
          attributeCount: Object.keys(reply.attributes).length,
          rawAttributeList: reply.rawAttributeList,
          connectTimeMs,
          totalTimeMs,
        });
      } finally {
        reader.releaseLock();
        writer.releaseLock();
      }
    } finally {
      await socket.close().catch(() => {});
    }
  } catch (error) {
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'SLP attribute request failed',
    }, { status: 500 });
  }
}
