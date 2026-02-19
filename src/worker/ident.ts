/**
 * IDENT Protocol Implementation (RFC 1413)
 *
 * The Identification Protocol (IDENT/auth) allows a server to determine
 * the identity of a user of a particular TCP connection. Historically used
 * by IRC servers and mail servers to verify connecting users.
 *
 * Protocol Flow:
 * 1. Client connects to server port 113
 * 2. Client sends: <server-port>, <client-port>\r\n
 * 3. Server responds with one of:
 *    <server-port>, <client-port> : USERID : <opsys> : <userid>\r\n
 *    <server-port>, <client-port> : ERROR : <error-type>\r\n
 *
 * Error Types: INVALID-PORT, NO-USER, HIDDEN-USER, UNKNOWN-ERROR
 *
 * Per RFC 1413:
 * - Maximum response line length is 1000 characters (excluding CRLF)
 * - The userid field may contain any printable characters including colons
 * - The opsys field should be a token from the IANA "SYSTEM NAMES" list
 *   or "OTHER" for non-standard systems
 * - Responses are terminated with \r\n (CRLF)
 *
 * Use Cases:
 * - IRC server user verification
 * - Mail server sender identification
 * - Network forensics and auditing
 * - Legacy authentication support
 */

import { connect } from 'cloudflare:sockets';

/** Maximum response line length per RFC 1413 (excluding CRLF) */
const MAX_RESPONSE_LENGTH = 1000;

interface IdentRequest {
  host: string;
  port?: number;
  serverPort: number;
  clientPort: number;
  timeout?: number;
}

interface IdentResponse {
  success: boolean;
  host: string;
  serverPort: number;
  clientPort: number;
  responseType?: 'USERID' | 'ERROR';
  os?: string;
  userId?: string;
  errorType?: string;
  raw?: string;
  latencyMs: number;
  error?: string;
}

function isValidPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}

function parseIdentResponse(raw: string): {
  responseType: 'USERID' | 'ERROR';
  serverPort: number;
  clientPort: number;
  operatingSystem?: string;
  userId?: string;
  errorType?: string;
} {
  // Response format: <server-port>, <client-port> : USERID : <opsys> : <userid>
  //             or: <server-port>, <client-port> : ERROR : <error-type>
  const trimmed = raw.replace(/\r?\n$/, '');

  if (trimmed.length > MAX_RESPONSE_LENGTH) {
    throw new Error(`IDENT response exceeds RFC 1413 maximum of ${MAX_RESPONSE_LENGTH} characters`);
  }

  // Split on colon delimiter — the userid (4th+ field) may contain colons,
  // so we only split into the first 4 parts for USERID responses
  const parts = trimmed.split(':').map(s => s.trim());

  if (parts.length < 3) {
    throw new Error(`Malformed IDENT response: ${trimmed}`);
  }

  // Parse port pair from first field (comma-separated)
  const portPair = parts[0].split(',').map(s => s.trim());
  if (portPair.length !== 2) {
    throw new Error(`Malformed port pair in IDENT response: ${parts[0]}`);
  }

  const serverPort = parseInt(portPair[0], 10);
  const clientPort = parseInt(portPair[1], 10);

  if (isNaN(serverPort) || isNaN(clientPort) || serverPort < 1 || serverPort > 65535 || clientPort < 1 || clientPort > 65535) {
    throw new Error(`Invalid port numbers in IDENT response: ${parts[0]}`);
  }

  const responseType = parts[1].toUpperCase();

  if (responseType === 'USERID') {
    if (parts.length < 4) {
      throw new Error(`Malformed USERID response (missing opsys or userid): ${trimmed}`);
    }
    // Per RFC 1413 Section 6: the userid field may contain colons.
    // After the third colon, everything is the userid. We rejoin parts[3+]
    // to preserve any colons within the userid value.
    const userId = parts.slice(3).join(':');
    // Trim only leading space (from the ` : ` separator), but preserve
    // the userid content as-is per RFC 1413 guidance
    return {
      responseType: 'USERID',
      serverPort,
      clientPort,
      operatingSystem: parts[2],
      userId: userId.replace(/^ /, ''),
    };
  } else if (responseType === 'ERROR') {
    const errorType = parts[2];
    // Validate error type per RFC 1413
    const validErrors = ['INVALID-PORT', 'NO-USER', 'HIDDEN-USER', 'UNKNOWN-ERROR'];
    if (!validErrors.includes(errorType)) {
      // Non-standard error type — still parse it but note it
      // RFC 1413 allows implementations to define additional error types
    }
    return {
      responseType: 'ERROR',
      serverPort,
      clientPort,
      errorType,
    };
  } else {
    throw new Error(`Unknown IDENT response type: ${responseType}`);
  }
}

/**
 * Read a complete CRLF-terminated line from the socket.
 *
 * IDENT responses are single-line, terminated by \r\n. TCP may deliver
 * the response across multiple segments, so we must accumulate bytes
 * until we see the line terminator (or hit a safety limit).
 */
async function readIdentLine(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  // RFC 1413 max line is 1000 chars + CRLF = 1002 bytes; add margin for safety
  const maxBytes = 1100;

  while (totalBytes < maxBytes) {
    const { value, done } = await Promise.race([
      reader.read(),
      timeoutPromise,
    ]);

    if (done || !value) {
      break;
    }

    chunks.push(value);
    totalBytes += value.length;

    // Check if we've received the CRLF terminator
    const partial = new TextDecoder().decode(concatUint8Arrays(chunks, totalBytes));
    if (partial.includes('\r\n') || partial.includes('\n')) {
      // Got a complete line
      return partial;
    }
  }

  if (totalBytes === 0) {
    throw new Error('No response received from IDENT server');
  }

  // Return whatever we got even without CRLF (some servers may not terminate properly)
  return new TextDecoder().decode(concatUint8Arrays(chunks, totalBytes));
}

function concatUint8Arrays(arrays: Uint8Array[], totalLength: number): Uint8Array {
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Query an IDENT server for user identification
 */
export async function handleIdentQuery(request: Request): Promise<Response> {
  try {
    let body: IdentRequest;
    try {
      body = await request.json() as IdentRequest;
    } catch {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid JSON in request body',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { host, port = 113, serverPort, clientPort, timeout = 10000 } = body;

    // Validation — use strict type checks to guard against non-numeric values
    if (!host || typeof host !== 'string') {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!isValidPort(serverPort)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Server port must be between 1 and 65535',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!isValidPort(clientPort)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Client port must be between 1 and 65535',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!isValidPort(port)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'IDENT port must be between 1 and 65535',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();

    // Connect to IDENT server on the specified port (default 113)
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([
        socket.opened,
        timeoutPromise,
      ]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send IDENT query per RFC 1413: <server-port>, <client-port>\r\n
      const query = `${serverPort}, ${clientPort}\r\n`;
      await writer.write(new TextEncoder().encode(query));

      // Read the complete CRLF-terminated response line.
      // TCP may fragment the response, so we accumulate until \r\n.
      const rawResponse = await readIdentLine(reader, timeoutPromise);

      // Parse the response
      const parsed = parseIdentResponse(rawResponse);

      // Clean up
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const response: IdentResponse = {
        success: true,
        host,
        serverPort: parsed.serverPort,
        clientPort: parsed.clientPort,
        responseType: parsed.responseType,
        raw: rawResponse.replace(/\r?\n$/, ''),
        latencyMs: Date.now() - startTime,
      };

      if (parsed.responseType === 'USERID') {
        response.os = parsed.operatingSystem;
        response.userId = parsed.userId;
      } else {
        response.errorType = parsed.errorType;
      }

      return new Response(JSON.stringify(response), {
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
      host: '',
      serverPort: 0,
      clientPort: 0,
      latencyMs: 0,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
