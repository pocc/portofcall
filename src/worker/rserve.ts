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
  const padded = encoded.length + (4 - (encoded.length % 4)) % 4;
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

  const isResponse = (cmd & 0x10000) !== 0;
  const isError = cmd === 0x10002;
  const isOK = cmd === RESP_OK;
  const errorCode = isError && data.length >= 20 ? view.getUint32(16, true) : 0;

  return {
    cmd: isResponse ? cmd : cmd,
    length,
    isOK,
    isError,
    errorCode,
  };
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

  while (totalBytes < expectedBytes) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    const timeoutPromise = new Promise<{ done: true; value: undefined }>((resolve) => {
      setTimeout(() => resolve({ done: true, value: undefined }), Math.min(remaining, 3000));
    });

    const result = await Promise.race([reader.read(), timeoutPromise]);
    if (result.done || !result.value) break;

    chunks.push(result.value);
    totalBytes += result.value.length;
    if (totalBytes >= maxBytes) break;
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

    if (!body.host) {
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

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const reader = socket.readable.getReader();

      // Rserve sends 32-byte ID string immediately on connect
      const responseData = await readResponse(reader, Math.min(timeout, 5000), ID_STRING_LENGTH);
      const rtt = Date.now() - startTime;

      reader.releaseLock();
      socket.close();

      if (responseData.length === 0) {
        return new Response(
          JSON.stringify({
            success: true,
            host,
            port,
            rtt,
            isRserve: false,
            protocol: 'Rserve',
            message: `TCP connected but no Rserve banner received (${rtt}ms)`,
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      const parsed = parseRserveID(responseData);

      return new Response(
        JSON.stringify({
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
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      socket.close();
      throw error;
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

    if (!body.host) {
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

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Step 1: Read server ID string
      const idData = await readResponse(reader, Math.min(timeout, 3000), ID_STRING_LENGTH);
      const idParsed = parseRserveID(idData);

      if (!idParsed.valid) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();

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
        writer.releaseLock();
        reader.releaseLock();
        socket.close();

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
      let resultStr = null;

      if (respHeader && respHeader.isOK && evalResponse.length > 16) {
        resultStr = extractStringFromSEXP(evalResponse);
      }

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

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
          result: resultStr,
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
    } catch (error) {
      socket.close();
      throw error;
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
