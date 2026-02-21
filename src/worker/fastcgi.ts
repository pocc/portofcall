/**
 * FastCGI Protocol Implementation
 * Binary protocol for web server ↔ application server communication
 * Port: 9000 (TCP, common default)
 *
 * FastCGI keeps application processes alive between requests,
 * widely used with PHP-FPM, Python, Ruby, and other languages.
 *
 * Two endpoints:
 * - /api/fastcgi/probe - Send FCGI_GET_VALUES to discover server capabilities
 * - /api/fastcgi/request - Send a simple HTTP GET request through FastCGI
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// FastCGI protocol version
const FCGI_VERSION_1 = 1;

// Record types
const FCGI_BEGIN_REQUEST = 1;
const FCGI_END_REQUEST = 3;
const FCGI_PARAMS = 4;
const FCGI_STDIN = 5;
const FCGI_STDOUT = 6;
const FCGI_STDERR = 7;
const FCGI_GET_VALUES = 9;
const FCGI_GET_VALUES_RESULT = 10;

// Roles
const FCGI_RESPONDER = 1;

// Protocol status codes
const FCGI_REQUEST_COMPLETE = 0;
const FCGI_CANT_MPX_CONN = 1;
const FCGI_OVERLOADED = 2;
const FCGI_UNKNOWN_ROLE = 3;

const PROTOCOL_STATUS_NAMES: Record<number, string> = {
  [FCGI_REQUEST_COMPLETE]: 'Request Complete',
  [FCGI_CANT_MPX_CONN]: 'Cannot Multiplex',
  [FCGI_OVERLOADED]: 'Overloaded',
  [FCGI_UNKNOWN_ROLE]: 'Unknown Role',
};

const RECORD_TYPE_NAMES: Record<number, string> = {
  [FCGI_BEGIN_REQUEST]: 'BEGIN_REQUEST',
  [FCGI_END_REQUEST]: 'END_REQUEST',
  [FCGI_PARAMS]: 'PARAMS',
  [FCGI_STDIN]: 'STDIN',
  [FCGI_STDOUT]: 'STDOUT',
  [FCGI_STDERR]: 'STDERR',
  [FCGI_GET_VALUES]: 'GET_VALUES',
  [FCGI_GET_VALUES_RESULT]: 'GET_VALUES_RESULT',
};

/**
 * Build a FastCGI record
 * Header: version(1) + type(1) + requestId(2) + contentLength(2) + paddingLength(1) + reserved(1) = 8 bytes
 */
function buildRecord(type: number, requestId: number, content: Uint8Array): Uint8Array {
  const paddingLength = (8 - (content.length % 8)) % 8;
  const record = new Uint8Array(8 + content.length + paddingLength);

  record[0] = FCGI_VERSION_1;
  record[1] = type;
  record[2] = (requestId >> 8) & 0xff;
  record[3] = requestId & 0xff;
  record[4] = (content.length >> 8) & 0xff;
  record[5] = content.length & 0xff;
  record[6] = paddingLength;
  record[7] = 0; // reserved

  record.set(content, 8);
  // padding bytes are already 0

  return record;
}

/**
 * Encode a FastCGI name-value pair
 * Length encoding: if < 128, use 1 byte; otherwise 4 bytes with high bit set
 */
function encodeNameValuePair(name: string, value: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const valueBytes = new TextEncoder().encode(value);

  const nameLenBytes = nameBytes.length < 128 ? 1 : 4;
  const valueLenBytes = valueBytes.length < 128 ? 1 : 4;

  const pair = new Uint8Array(nameLenBytes + valueLenBytes + nameBytes.length + valueBytes.length);
  let offset = 0;

  // Name length
  if (nameBytes.length < 128) {
    pair[offset++] = nameBytes.length;
  } else {
    pair[offset++] = ((nameBytes.length >> 24) & 0x7f) | 0x80;
    pair[offset++] = (nameBytes.length >> 16) & 0xff;
    pair[offset++] = (nameBytes.length >> 8) & 0xff;
    pair[offset++] = nameBytes.length & 0xff;
  }

  // Value length
  if (valueBytes.length < 128) {
    pair[offset++] = valueBytes.length;
  } else {
    pair[offset++] = ((valueBytes.length >> 24) & 0x7f) | 0x80;
    pair[offset++] = (valueBytes.length >> 16) & 0xff;
    pair[offset++] = (valueBytes.length >> 8) & 0xff;
    pair[offset++] = valueBytes.length & 0xff;
  }

  pair.set(nameBytes, offset);
  offset += nameBytes.length;
  pair.set(valueBytes, offset);

  return pair;
}

/**
 * Encode multiple name-value pairs into a single content block
 */
function encodeNameValuePairs(pairs: Array<[string, string]>): Uint8Array {
  const encoded = pairs.map(([name, value]) => encodeNameValuePair(name, value));
  const totalLength = encoded.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const p of encoded) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
}

/**
 * Decode FastCGI name-value pairs from content
 */
function decodeNameValuePairs(data: Uint8Array): Array<{ name: string; value: string }> {
  const pairs: Array<{ name: string; value: string }> = [];
  let offset = 0;

  while (offset < data.length) {
    // Name length
    let nameLength: number;
    if ((data[offset] & 0x80) === 0) {
      nameLength = data[offset];
      offset += 1;
    } else {
      nameLength = ((data[offset] & 0x7f) << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
      offset += 4;
    }

    // Value length
    let valueLength: number;
    if ((data[offset] & 0x80) === 0) {
      valueLength = data[offset];
      offset += 1;
    } else {
      valueLength = ((data[offset] & 0x7f) << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
      offset += 4;
    }

    if (offset + nameLength + valueLength > data.length) break;

    const name = new TextDecoder().decode(data.slice(offset, offset + nameLength));
    offset += nameLength;
    const value = new TextDecoder().decode(data.slice(offset, offset + valueLength));
    offset += valueLength;

    pairs.push({ name, value });
  }

  return pairs;
}

/**
 * Parse a FastCGI record from data
 */
function parseRecord(data: Uint8Array): {
  version: number;
  type: number;
  requestId: number;
  contentLength: number;
  paddingLength: number;
  content: Uint8Array;
  totalLength: number;
} | null {
  if (data.length < 8) return null;

  const version = data[0];
  const type = data[1];
  const requestId = (data[2] << 8) | data[3];
  const contentLength = (data[4] << 8) | data[5];
  const paddingLength = data[6];

  const totalLength = 8 + contentLength + paddingLength;
  if (data.length < totalLength) return null;

  const content = data.slice(8, 8 + contentLength);

  return { version, type, requestId, contentLength, paddingLength, content, totalLength };
}

/**
 * Read all available data from socket with timeout
 */
async function readAllRecords(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeout: number
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  const timeoutPromise = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), timeout)
  );

  while (true) {
    const readPromise = reader.read();
    const result = await Promise.race([readPromise, timeoutPromise]);

    if (result === null) break; // timeout
    const { value, done } = result as ReadableStreamReadResult<Uint8Array>;
    if (done || !value) break;

    chunks.push(value);
    totalLength += value.length;
  }

  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return combined;
}

/**
 * Handle FastCGI probe - send FCGI_GET_VALUES to discover server capabilities
 */
export async function handleFastCGIProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { host, port = 9000, timeout = 10000 } = (await request.json()) as {
      host: string;
      port?: number;
      timeout?: number;
    };

    if (!host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check Cloudflare
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

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const probePromise = (async () => {
      const startTime = Date.now();

      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const connectTime = Date.now() - startTime;

      try {
        const writer = socket.writable.getWriter();
        const reader = socket.readable.getReader();

        // Build FCGI_GET_VALUES request
        // Query for standard FastCGI management variables
        const queryPairs = encodeNameValuePairs([
          ['FCGI_MAX_CONNS', ''],
          ['FCGI_MAX_REQS', ''],
          ['FCGI_MPXS_CONNS', ''],
        ]);

        const getValuesRecord = buildRecord(FCGI_GET_VALUES, 0, queryPairs);
        await writer.write(getValuesRecord);

        // Read response with a short timeout for the read phase
        const responseData = await readAllRecords(reader, Math.min(5000, timeout - (Date.now() - startTime)));

        // Parse response records
        const records: Array<{
          type: string;
          typeCode: number;
          requestId: number;
          contentLength: number;
          pairs?: Array<{ name: string; value: string }>;
        }> = [];

        let offset = 0;
        const serverValues: Record<string, string> = {};

        while (offset < responseData.length) {
          const record = parseRecord(responseData.slice(offset));
          if (!record) break;

          const recordInfo: {
            type: string;
            typeCode: number;
            requestId: number;
            contentLength: number;
            pairs?: Array<{ name: string; value: string }>;
          } = {
            type: RECORD_TYPE_NAMES[record.type] || `UNKNOWN(${record.type})`,
            typeCode: record.type,
            requestId: record.requestId,
            contentLength: record.contentLength,
          };

          if (record.type === FCGI_GET_VALUES_RESULT) {
            const pairs = decodeNameValuePairs(record.content);
            recordInfo.pairs = pairs;
            for (const pair of pairs) {
              serverValues[pair.name] = pair.value;
            }
          }

          records.push(recordInfo);
          offset += record.totalLength;
        }

        const totalTime = Date.now() - startTime;

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return {
          success: true,
          host,
          port,
          protocolVersion: FCGI_VERSION_1,
          serverValues,
          maxConns: serverValues['FCGI_MAX_CONNS'] ? parseInt(serverValues['FCGI_MAX_CONNS']) : null,
          maxReqs: serverValues['FCGI_MAX_REQS'] ? parseInt(serverValues['FCGI_MAX_REQS']) : null,
          multiplexing: serverValues['FCGI_MPXS_CONNS'] === '1',
          records,
          connectTimeMs: connectTime,
          totalTimeMs: totalTime,
        };
      } catch (error) {
        try { await socket.close(); } catch { /* ignore */ }
        throw error;
      }
    })();

    const result = await Promise.race([probePromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Probe failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle FastCGI request - send a simple HTTP request through FastCGI
 */
export async function handleFastCGIRequest(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const {
      host,
      port = 9000,
      scriptFilename = '/index.php',
      requestUri = '/',
      serverName = 'localhost',
      timeout = 15000,
    } = (await request.json()) as {
      host: string;
      port?: number;
      scriptFilename?: string;
      requestUri?: string;
      serverName?: string;
      timeout?: number;
    };

    if (!host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check Cloudflare
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

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const requestPromise = (async () => {
      const startTime = Date.now();
      const requestId = 1;

      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const connectTime = Date.now() - startTime;

      try {
        const writer = socket.writable.getWriter();
        const reader = socket.readable.getReader();

        // 1. Send FCGI_BEGIN_REQUEST
        const beginBody = new Uint8Array(8);
        beginBody[0] = (FCGI_RESPONDER >> 8) & 0xff;
        beginBody[1] = FCGI_RESPONDER & 0xff;
        beginBody[2] = 0; // flags (0 = close connection after request)
        // bytes 3-7 are reserved (already 0)

        const beginRecord = buildRecord(FCGI_BEGIN_REQUEST, requestId, beginBody);
        await writer.write(beginRecord);

        // 2. Send FCGI_PARAMS (CGI environment variables)
        const params = encodeNameValuePairs([
          ['SCRIPT_FILENAME', scriptFilename],
          ['SCRIPT_NAME', scriptFilename],
          ['REQUEST_URI', requestUri],
          ['DOCUMENT_URI', requestUri],
          ['QUERY_STRING', ''],
          ['REQUEST_METHOD', 'GET'],
          ['SERVER_SOFTWARE', 'PortOfCall/1.0'],
          ['SERVER_NAME', serverName],
          ['SERVER_PORT', '80'],
          ['SERVER_PROTOCOL', 'HTTP/1.1'],
          ['GATEWAY_INTERFACE', 'CGI/1.1'],
          ['REMOTE_ADDR', '127.0.0.1'],
          ['REMOTE_PORT', '0'],
          ['CONTENT_TYPE', ''],
          ['CONTENT_LENGTH', '0'],
        ]);

        const paramsRecord = buildRecord(FCGI_PARAMS, requestId, params);
        await writer.write(paramsRecord);

        // Empty PARAMS record to signal end of params
        const emptyParams = buildRecord(FCGI_PARAMS, requestId, new Uint8Array(0));
        await writer.write(emptyParams);

        // 3. Send empty FCGI_STDIN to signal end of input
        const emptyStdin = buildRecord(FCGI_STDIN, requestId, new Uint8Array(0));
        await writer.write(emptyStdin);

        // 4. Read response
        const responseData = await readAllRecords(reader, Math.min(10000, timeout - (Date.now() - startTime)));

        // Parse response records
        let stdout = '';
        let stderr = '';
        let endStatus = -1;
        let protocolStatus = -1;
        let endRequestReceived = false;
        const responseRecords: Array<{
          type: string;
          contentLength: number;
        }> = [];

        let offset = 0;
        while (offset < responseData.length) {
          const record = parseRecord(responseData.slice(offset));
          if (!record) break;

          responseRecords.push({
            type: RECORD_TYPE_NAMES[record.type] || `UNKNOWN(${record.type})`,
            contentLength: record.contentLength,
          });

          if (record.type === FCGI_STDOUT && record.contentLength > 0) {
            stdout += new TextDecoder().decode(record.content);
          } else if (record.type === FCGI_STDERR && record.contentLength > 0) {
            stderr += new TextDecoder().decode(record.content);
          } else if (record.type === FCGI_END_REQUEST && record.contentLength >= 8) {
            endStatus = (record.content[0] << 24) | (record.content[1] << 16) | (record.content[2] << 8) | record.content[3];
            protocolStatus = record.content[4];
            endRequestReceived = true;
          }

          offset += record.totalLength;
        }

        // FastCGI spec allows FCGI_STDERR records to arrive after FCGI_END_REQUEST
        // due to OS-level buffering. If we received END_REQUEST, do a short drain
        // read to collect any trailing STDERR that was buffered in-flight.
        if (endRequestReceived) {
          const trailingData = await readAllRecords(reader, 500);
          let trailingOffset = 0;
          while (trailingOffset < trailingData.length) {
            const record = parseRecord(trailingData.slice(trailingOffset));
            if (!record) break;
            if (record.type === FCGI_STDERR && record.contentLength > 0) {
              stderr += new TextDecoder().decode(record.content);
              responseRecords.push({
                type: RECORD_TYPE_NAMES[record.type] || `UNKNOWN(${record.type})`,
                contentLength: record.contentLength,
              });
            }
            trailingOffset += record.totalLength;
          }
        }

        // Parse HTTP headers from stdout
        let headers: Record<string, string> = {};
        let body = stdout;

        const headerEnd = stdout.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
          const headerPart = stdout.substring(0, headerEnd);
          body = stdout.substring(headerEnd + 4);
          for (const line of headerPart.split('\r\n')) {
            const colonIdx = line.indexOf(':');
            if (colonIdx !== -1) {
              headers[line.substring(0, colonIdx).trim()] = line.substring(colonIdx + 1).trim();
            }
          }
        }

        const totalTime = Date.now() - startTime;

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return {
          success: true,
          host,
          port,
          scriptFilename,
          requestUri,
          exitStatus: endStatus,
          protocolStatus: protocolStatus >= 0
            ? PROTOCOL_STATUS_NAMES[protocolStatus] || `Unknown(${protocolStatus})`
            : null,
          headers,
          body: body.substring(0, 10000), // Limit body size
          stderr: stderr || null,
          records: responseRecords,
          connectTimeMs: connectTime,
          totalTimeMs: totalTime,
        };
      } catch (error) {
        try { await socket.close(); } catch { /* ignore */ }
        throw error;
      }
    })();

    const result = await Promise.race([requestPromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Request failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
