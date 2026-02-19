/**
 * Rserve Protocol Implementation (R Statistical Computing Server)
 *
 * Rserve is a TCP/IP server that allows programs to use R computing
 * facilities from various languages. It uses the QAP1 protocol.
 *
 * Protocol: Binary with ASCII identification header
 * Default port: 6311
 *
 * Connection flow:
 *   Server sends 32-byte ID string on connect:
 *     Bytes 0-3:   "Rsrv" (magic identifier)
 *     Bytes 4-7:   Protocol version (e.g., "0103" = version 1.3)
 *     Bytes 8-11:  Protocol type (e.g., "QAP1")
 *     Bytes 12-15: Additional attributes (e.g., "----" or "ARpt")
 *     Bytes 16-31: Reserved / additional capabilities
 *
 * After ID string, client can send QAP1 commands:
 *   Header: command(4) + length(4) + offset(4) + length2(4) = 16 bytes
 *   Commands:
 *     CMD_login   = 0x001 (authenticate with username/password)
 *     CMD_eval    = 0x003 (evaluate R expression)
 *     CMD_shutdown = 0x004
 *     CMD_setEncoding = 0x008
 *
 * Response format:
 *   Header: response_cmd(4) + length(4) + offset(4) + length2(4)
 *   Response codes:
 *     RESP_OK = 0x10001
 *     RESP_ERR = 0x10002
 *     ERR_auth_failed = 0x41
 *     ERR_conn_broken = 0x42
 *
 * Security: Read-only probing. We connect and read the server banner,
 * optionally send a version query to detect R capabilities.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const RSERVE_MAGIC = 'Rsrv';
const ID_STRING_LENGTH = 32;

// QAP1 command codes
const CMD_eval = 0x003;
// const CMD_login = 0x001;

// QAP1 data types
const DT_STRING = 4;  // null-terminated string
const DT_SEXP = 10;   // R SEXP (S-expression)

// Response codes
const RESP_OK = 0x10001;
// const RESP_ERR = 0x10002;

/**
 * Parse the 32-byte Rserve identification string
 */
function parseRserveID(data: Uint8Array): {
  valid: boolean;
  magic: string;
  version: string;
  protocol: string;
  attributes: string;
  extra: string;
  requiresAuth: boolean;
  supportsTLS: boolean;
} {
  if (data.length < ID_STRING_LENGTH) {
    return {
      valid: false,
      magic: '',
      version: '',
      protocol: '',
      attributes: '',
      extra: '',
      requiresAuth: false,
      supportsTLS: false,
    };
  }

  const decoder = new TextDecoder('ascii');
  const magic = decoder.decode(data.slice(0, 4));
  const version = decoder.decode(data.slice(4, 8));
  const protocol = decoder.decode(data.slice(8, 12));
  const attributes = decoder.decode(data.slice(12, 16));
  const extra = decoder.decode(data.slice(16, 32)).replace(/\0/g, '');

  // Check for auth requirement ("ARpt" = auth required, plain text)
  // and TLS support
  const fullStr = decoder.decode(data);
  const requiresAuth = fullStr.includes('AR') || fullStr.includes('ARpt') || fullStr.includes('ARuc');
  const supportsTLS = fullStr.includes('TLS');

  return {
    valid: magic === RSERVE_MAGIC,
    magic,
    version,
    protocol,
    attributes,
    extra,
    requiresAuth,
    supportsTLS,
  };
}

/**
 * Build a QAP1 command packet
 * Header: cmd(4LE) + length(4LE) + offset(4LE) + length2(4LE) = 16 bytes
 */
function buildQAP1Command(cmd: number, data?: Uint8Array): Uint8Array {
  const dataLen = data ? data.length : 0;
  const packet = new Uint8Array(16 + dataLen);
  const view = new DataView(packet.buffer);

  view.setUint32(0, cmd, true);       // command (LE)
  view.setUint32(4, dataLen, true);    // length (LE)
  view.setUint32(8, 0, true);         // offset
  view.setUint32(12, 0, true);        // length high bits

  if (data) {
    packet.set(data, 16);
  }

  return packet;
}

/**
 * Build a DT_STRING payload for QAP1
 */
function buildDTString(str: string): Uint8Array {
  const encoded = new TextEncoder().encode(str + '\0');
  // Pad to 4-byte boundary
  const remainder = encoded.length % 4;
  const padded = remainder === 0 ? encoded.length : encoded.length + (4 - remainder);
  const payload = new Uint8Array(4 + padded);

  // Type header: type(1) + length(3) in LE
  payload[0] = DT_STRING;
  payload[1] = padded & 0xff;
  payload[2] = (padded >> 8) & 0xff;
  payload[3] = (padded >> 16) & 0xff;

  payload.set(encoded, 4);
  return payload;
}

/**
 * Parse a QAP1 response header
 */
function parseQAP1Response(data: Uint8Array): {
  cmd: number;
  length: number;
  isOK: boolean;
  isError: boolean;
  errorCode: number;
} | null {
  if (data.length < 16) return null;

  const view = new DataView(data.buffer, data.byteOffset);
  const cmd = view.getUint32(0, true);
  const length = view.getUint32(4, true);

  const isError = cmd === 0x10002;
  const isOK = cmd === RESP_OK;
  const errorCode = isError && data.length >= 20 ? view.getUint32(16, true) : 0;

  return {
    cmd,
    length,
    isOK,
    isError,
    errorCode,
  };
}

// QAP1 SEXP XT type codes
const XT_NULL          = 0;
const XT_INT           = 1;
const XT_DOUBLE        = 2;
const XT_STR_SINGLE    = 3;
const XT_VECTOR        = 16;
const XT_ARRAY_INT     = 32;
const XT_ARRAY_DOUBLE  = 33;
const XT_ARRAY_STR     = 34;
const XT_ARRAY_BOOL    = 36;
const XT_HAS_ATTR      = 0x80;
const XT_IS_LONG       = 0x40;

type SexpValue =
  | { type: 'null' }
  | { type: 'string'; value: string }
  | { type: 'strings'; values: string[] }
  | { type: 'integer'; values: number[] }
  | { type: 'double'; values: number[] }
  | { type: 'logical'; values: boolean[] }
  | { type: 'vector'; elements: SexpValue[] }
  | { type: 'raw'; hex: string };

/**
 * Parse a QAP1 SEXP starting at `offset` within `data`.
 * Returns the parsed value and the number of bytes consumed.
 */
function parseSEXP(data: Uint8Array, offset: number): { value: SexpValue; consumed: number } {
  if (offset + 4 > data.length) return { value: { type: 'null' }, consumed: 0 };

  const dv = new DataView(data.buffer, data.byteOffset);

  const typeRaw = data[offset];
  const xtType  = typeRaw & 0x3f;
  const hasAttr = (typeRaw & XT_HAS_ATTR) !== 0;
  const isLong  = (typeRaw & XT_IS_LONG) !== 0;

  let len: number;
  let headerLen: number;

  if (isLong) {
    // 8-byte length (low 32 bits at offset+4, then next 4 = high bits — usually 0)
    len = dv.getUint32(offset + 4, true);
    headerLen = 8;
  } else {
    len = data[offset + 1] | (data[offset + 2] << 8) | (data[offset + 3] << 16);
    headerLen = 4;
  }

  let dataStart = offset + headerLen;
  const consumed = headerLen + len;

  // Skip attribute SEXP if present (we only care about the data)
  if (hasAttr) {
    const attr = parseSEXP(data, dataStart);
    if (attr.consumed === 0 || dataStart + attr.consumed > offset + consumed) {
      // Invalid attribute - don't advance
      return { value: { type: 'null' }, consumed: 0 };
    }
    dataStart += attr.consumed;
  }

  const end = offset + consumed;

  switch (xtType) {
    case XT_NULL:
      return { value: { type: 'null' }, consumed };

    case XT_INT: {
      if (dataStart + 4 > data.length) break;
      const v = dv.getInt32(dataStart, true);
      return { value: { type: 'integer', values: [v] }, consumed };
    }

    case XT_DOUBLE: {
      if (dataStart + 8 > data.length) break;
      const v = dv.getFloat64(dataStart, true);
      return { value: { type: 'double', values: [v] }, consumed };
    }

    case XT_STR_SINGLE: {
      const nullIdx = data.indexOf(0, dataStart);
      const strEnd = (nullIdx === -1 || nullIdx >= end) ? end : nullIdx;
      const v = new TextDecoder().decode(data.slice(dataStart, strEnd));
      return { value: { type: 'string', value: v }, consumed };
    }

    case XT_ARRAY_INT: {
      const count = Math.floor((end - dataStart) / 4);
      const values: number[] = [];
      for (let i = 0; i < count; i++) {
        values.push(dv.getInt32(dataStart + i * 4, true));
      }
      return { value: { type: 'integer', values }, consumed };
    }

    case XT_ARRAY_DOUBLE: {
      const count = Math.floor((end - dataStart) / 8);
      const values: number[] = [];
      for (let i = 0; i < count; i++) {
        values.push(dv.getFloat64(dataStart + i * 8, true));
      }
      return { value: { type: 'double', values }, consumed };
    }

    case XT_ARRAY_STR: {
      // Null-separated strings
      const values: string[] = [];
      let pos = dataStart;
      while (pos < end) {
        const nullIdx = data.indexOf(0, pos);
        const strEnd = (nullIdx === -1 || nullIdx >= end) ? end : nullIdx;
        if (strEnd > pos) {
          values.push(new TextDecoder().decode(data.slice(pos, strEnd)));
        }
        pos = strEnd + 1;
      }
      return { value: { type: 'strings', values }, consumed };
    }

    case XT_ARRAY_BOOL: {
      const count = Math.floor((end - dataStart) / 1);
      const values: boolean[] = [];
      for (let i = 0; i < count; i++) {
        values.push(data[dataStart + i] !== 0);
      }
      return { value: { type: 'logical', values }, consumed };
    }

    case XT_VECTOR: {
      const elements: SexpValue[] = [];
      let pos = dataStart;
      while (pos < end) {
        const child = parseSEXP(data, pos);
        if (child.consumed === 0) break;
        elements.push(child.value);
        pos += child.consumed;
      }
      return { value: { type: 'vector', elements }, consumed };
    }

    default: {
      // Unknown/unsupported type — return raw hex
      const slice = data.slice(dataStart, Math.min(end, dataStart + 64));
      const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
      return { value: { type: 'raw', hex }, consumed };
    }
  }

  return { value: { type: 'null' }, consumed };
}

/**
 * Extract a structured result from the QAP1 response payload.
 * Walks the DT_SEXP wrapper to reach the inner SEXP value.
 */
function extractSEXPResult(data: Uint8Array): SexpValue | null {
  // Skip 16-byte QAP1 response header
  let offset = 16;
  if (offset >= data.length) return null;

  // DT_SEXP (10) header: type(1) + len(3)
  while (offset < data.length - 4) {
    const type = data[offset] & 0x3f;
    let len: number;
    let headerLen: number;
    if ((data[offset] & XT_IS_LONG) !== 0) {
      if (offset + 8 > data.length) break;
      len = new DataView(data.buffer, data.byteOffset).getUint32(offset + 4, true);
      headerLen = 8;
    } else {
      len = data[offset + 1] | (data[offset + 2] << 8) | (data[offset + 3] << 16);
      headerLen = 4;
    }

    if (type === DT_SEXP) {
      const inner = parseSEXP(data, offset + headerLen);
      return inner.value;
    }
    offset += headerLen + len;
  }
  return null;
}

/**
 * Try to extract string data from a QAP1 SEXP response
 */
function extractStringFromSEXP(data: Uint8Array): string | null {
  // Skip the 16-byte response header
  let offset = 16;
  if (offset >= data.length) return null;

  // Look for DT_SEXP (10) or DT_STRING (4)
  while (offset < data.length - 4) {
    const type = data[offset];
    const len = data[offset + 1] | (data[offset + 2] << 8) | (data[offset + 3] << 16);
    offset += 4;

    if (type === DT_STRING || type === DT_SEXP) {
      // For SEXP, skip the inner type byte
      if (type === DT_SEXP && offset < data.length) {
        const innerType = data[offset];
        // XT_STR = 3, XT_ARRAY_STR = 34
        if (innerType === 3 || innerType === 34) {
          offset += 4; // skip inner header
          const end = data.indexOf(0, offset);
          if (end > offset) {
            return new TextDecoder().decode(data.slice(offset, end));
          }
        }
      } else if (type === DT_STRING) {
        const end = data.indexOf(0, offset);
        if (end > offset) {
          return new TextDecoder().decode(data.slice(offset, end));
        }
      }
    }

    if (len > 0) offset += len;
    else break;
  }

  // Fallback: scan for printable ASCII strings
  for (let i = 16; i < data.length - 4; i++) {
    if (data[i] >= 0x20 && data[i] <= 0x7e) {
      let end = i;
      while (end < data.length && data[end] >= 0x20 && data[end] <= 0x7e) end++;
      if (end - i >= 5) {
        return new TextDecoder().decode(data.slice(i, end));
      }
    }
  }

  return null;
}

/**
 * Format bytes as hex string
 */
function toHex(data: Uint8Array, maxBytes = 64): string {
  const slice = data.slice(0, maxBytes);
  return Array.from(slice)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}

/**
 * Read TCP response data with timeout
 */
async function readResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  expectedBytes: number
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const maxBytes = 64 * 1024;
  const deadline = Date.now() + timeoutMs;

  while (totalBytes < expectedBytes && totalBytes < maxBytes) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<{ done: true; value: undefined }>((resolve) => {
      timeoutHandle = setTimeout(() => resolve({ done: true, value: undefined }), Math.min(remaining, 3000));
    });

    try {
      const result = await Promise.race([reader.read(), timeoutPromise]);
      if (result.done || !result.value) break;

      chunks.push(result.value);
      totalBytes += result.value.length;
    } finally {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    }
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

/**
 * Probe an Rserve endpoint by reading the server identification string
 */
export async function handleRserveProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as {
      host?: string;
      port?: number;
      timeout?: number;
    };

    if (!body.host || body.host.trim() === '') {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 6311;
    const timeout = body.timeout || 10000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (timeout < 1 || timeout > 300000) {
      return new Response(
        JSON.stringify({ success: false, error: 'Timeout must be between 1 and 300000 ms' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const reader = socket.readable.getReader();

      try {
        // Rserve sends 32-byte ID string immediately on connect
        const responseData = await readResponse(reader, Math.min(timeout, 5000), ID_STRING_LENGTH);
        const rtt = Date.now() - startTime;

        return new Response(
          JSON.stringify(
            responseData.length === 0
              ? {
                  success: true,
                  host,
                  port,
                  rtt,
                  isRserve: false,
                  protocol: 'Rserve',
                  message: `TCP connected but no Rserve banner received (${rtt}ms)`,
                }
              : (() => {
                  const parsed = parseRserveID(responseData);
                  return {
                    success: true,
                    host,
                    port,
                    rtt,
                    isRserve: parsed.valid,
                    magic: parsed.magic,
                    version: parsed.version,
                    protocolType: parsed.protocol,
                    attributes: parsed.attributes,
                    extra: parsed.extra || null,
                    requiresAuth: parsed.requiresAuth,
                    supportsTLS: parsed.supportsTLS,
                    bannerBytes: responseData.length,
                    bannerHex: toHex(responseData),
                    protocol: 'Rserve',
                    message: parsed.valid
                      ? `Rserve ${parsed.version} (${parsed.protocol}) detected${parsed.requiresAuth ? ' [auth required]' : ''} in ${rtt}ms`
                      : `Non-Rserve response received in ${rtt}ms`,
                  };
                })()
          ),
          { headers: { 'Content-Type': 'application/json' } }
        );
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // Ignore lock release errors
        }
      }
    } finally {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      try {
        socket.close();
      } catch {
        // Ignore socket close errors
      }
    }

  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Rserve probe failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Evaluate a simple R expression on an Rserve endpoint
 * Only works if authentication is not required
 */
export async function handleRserveEval(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as {
      host?: string;
      port?: number;
      expression?: string;
      timeout?: number;
    };

    if (!body.host || body.host.trim() === '') {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 6311;
    const expression = body.expression || 'R.version.string';
    const timeout = body.timeout || 10000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (timeout < 1 || timeout > 300000) {
      return new Response(
        JSON.stringify({ success: false, error: 'Timeout must be between 1 and 300000 ms' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Limit expression length for safety
    if (expression.length > 256) {
      return new Response(
        JSON.stringify({ success: false, error: 'Expression too long (max 256 characters)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Step 1: Read server ID string
        const idData = await readResponse(reader, Math.min(timeout, 3000), ID_STRING_LENGTH);
        const idParsed = parseRserveID(idData);

        if (!idParsed.valid) {
          return new Response(
            JSON.stringify({
              success: false,
              error: 'Not an Rserve endpoint',
              bannerHex: toHex(idData),
            }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (idParsed.requiresAuth) {
          return new Response(
            JSON.stringify({
              success: true,
              host,
              port,
              rtt: Date.now() - startTime,
              isRserve: true,
              version: idParsed.version,
              requiresAuth: true,
              protocol: 'Rserve',
              message: `Rserve ${idParsed.version} requires authentication — cannot evaluate expressions`,
            }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Step 2: Send CMD_eval with expression
        const exprPayload = buildDTString(expression);
        const evalCmd = buildQAP1Command(CMD_eval, exprPayload);
        await writer.write(evalCmd);

        // Step 3: Read response
        const evalResponse = await readResponse(reader, Math.min(timeout, 5000), 4096);
        const rtt = Date.now() - startTime;

        const respHeader = parseQAP1Response(evalResponse);
        let resultStr: string | null = null;
        let resultValue: SexpValue | null = null;

        if (respHeader && respHeader.isOK && evalResponse.length > 16) {
          resultValue = extractSEXPResult(evalResponse);
          // Also keep legacy string extraction for the message field
          if (resultValue?.type === 'string') resultStr = resultValue.value;
          else if (resultValue?.type === 'strings') resultStr = resultValue.values.join(', ');
          else resultStr = extractStringFromSEXP(evalResponse);
        }

        return new Response(
          JSON.stringify({
            success: true,
            host,
            port,
            rtt,
            isRserve: true,
            version: idParsed.version,
            protocolType: idParsed.protocol,
            expression,
            evalSuccess: respHeader ? respHeader.isOK : false,
            evalError: respHeader && respHeader.isError ? `Error code: ${respHeader.errorCode}` : null,
            result: resultValue ?? resultStr,
            resultString: resultStr,
            responseBytes: evalResponse.length,
            responseHex: toHex(evalResponse),
            protocol: 'Rserve',
            message: resultStr
              ? `Eval OK: ${resultStr} (${rtt}ms)`
              : respHeader && respHeader.isOK
              ? `Eval OK (binary result, ${evalResponse.length} bytes) in ${rtt}ms`
              : `Eval failed in ${rtt}ms`,
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      } finally {
        try {
          writer.releaseLock();
        } catch {
          // Ignore lock release errors
        }
        try {
          reader.releaseLock();
        } catch {
          // Ignore lock release errors
        }
      }
    } finally {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      try {
        socket.close();
      } catch {
        // Ignore socket close errors
      }
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Rserve eval failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
