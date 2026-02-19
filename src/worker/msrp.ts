/**
 * MSRP Protocol Implementation (RFC 4975)
 *
 * Message Session Relay Protocol is a text-based protocol for transmitting
 * instant messages and file transfers in SIP sessions. MSRP operates over TCP
 * and provides reliable, ordered delivery of messages with chunking support.
 *
 * Protocol Flow:
 * 1. Client establishes TCP connection to MSRP relay
 * 2. Client sends MSRP SEND request with message content
 * 3. Server responds with 200 OK or error code
 * 4. Connection may be persistent for multiple messages
 *
 * RFC 4975 specifies:
 * - Text-based request/response protocol
 * - Transaction identifiers for matching requests/responses
 * - Message chunking for large content
 * - MIME content type support
 * - Path-based routing via MSRP URIs
 *
 * MSRP Request Format:
 * MSRP <transaction-id> <method>
 * To-Path: <msrp-uri>
 * From-Path: <msrp-uri>
 * Message-ID: <message-id>
 * Byte-Range: <start>-<end>/<total>
 * Content-Type: <mime-type>
 *
 * <content>
 * -------<transaction-id><flag>
 *
 * Response codes:
 * - 200: OK (success)
 * - 400: Bad Request
 * - 403: Forbidden
 * - 408: Request Timeout
 * - 413: Message Too Large
 * - 415: Unsupported Media Type
 * - 481: No Such Session
 * - 501: Not Implemented
 *
 * Use Cases:
 * - SIP-based instant messaging
 * - WebRTC data channel messaging
 * - Real-time chat applications
 * - File transfer in communication apps
 */

import { connect } from 'cloudflare:sockets';

interface MsrpSendRequest {
  host: string;
  port?: number;
  fromPath: string;
  toPath: string;
  content: string;
  contentType?: string;
  messageId?: string;
  timeout?: number;
}

interface MsrpResponse {
  success: boolean;
  host: string;
  port: number;
  statusCode?: number;
  statusText?: string;
  transactionId?: string;
  messageId?: string;
  byteRange?: string;
  rtt?: number;
  error?: string;
}

/**
 * Generate a random MSRP transaction ID.
 * Format: alphanumeric string, typically 8-32 characters.
 */
function generateTransactionId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate a random MSRP Message-ID.
 */
function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Encode an MSRP SEND request.
 */
function encodeMsrpSend(params: {
  transactionId: string;
  fromPath: string;
  toPath: string;
  messageId: string;
  content: string;
  contentType: string;
}): string {
  const { transactionId, fromPath, toPath, messageId, content, contentType } = params;
  const contentBytes = new TextEncoder().encode(content).length;

  // Build MSRP request
  const request = [
    `MSRP ${transactionId} SEND`,
    `To-Path: ${toPath}`,
    `From-Path: ${fromPath}`,
    `Message-ID: ${messageId}`,
    `Byte-Range: 1-${contentBytes}/${contentBytes}`,
    `Content-Type: ${contentType}`,
    '',
    content,
    `-------${transactionId}$`, // End-line with continuation flag '$' (complete message)
  ].join('\r\n');

  return request;
}

/**
 * Parse an MSRP response.
 */
function parseMsrpResponse(data: string): {
  statusCode: number;
  statusText: string;
  transactionId: string;
  headers: Record<string, string>;
} | null {
  const lines = data.split('\r\n');

  if (lines.length < 2) {
    return null;
  }

  // Parse status line: MSRP <transaction-id> <status-code> <status-text>
  const statusLine = lines[0];
  const statusMatch = statusLine.match(/^MSRP\s+(\S+)\s+(\d+)\s*(.*)$/);

  if (!statusMatch) {
    return null;
  }

  const transactionId = statusMatch[1];
  const statusCode = parseInt(statusMatch[2], 10);
  const statusText = statusMatch[3] || '';

  // Parse headers
  const headers: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    // Empty line marks end of headers
    if (line.trim() === '') {
      break;
    }

    // End-line
    if (line.startsWith('-------')) {
      break;
    }

    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const headerName = line.substring(0, colonIndex).trim();
      const headerValue = line.substring(colonIndex + 1).trim();
      headers[headerName] = headerValue;
    }
  }

  return {
    statusCode,
    statusText,
    transactionId,
    headers,
  };
}

/**
 * Send an MSRP message to a relay server.
 */
export async function handleMsrpSend(request: Request): Promise<Response> {
  try {
    const body = await request.json() as MsrpSendRequest;
    const {
      host,
      port = 2855,
      fromPath,
      toPath,
      content,
      contentType = 'text/plain',
      messageId,
      timeout = 15000,
    } = body;

    // Validation
    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies MsrpResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!fromPath) {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        error: 'fromPath is required (e.g., "msrp://client.example.com:2855/session123;tcp")',
      } satisfies MsrpResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!toPath) {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        error: 'toPath is required (e.g., "msrp://relay.example.com:2855/session456;tcp")',
      } satisfies MsrpResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!content) {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        error: 'content is required',
      } satisfies MsrpResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        error: 'Port must be between 1 and 65535',
      } satisfies MsrpResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    // Generate transaction ID and message ID
    const transactionId = generateTransactionId();
    const msgId = messageId || generateMessageId();

    // Encode MSRP SEND request
    const msrpRequest = encodeMsrpSend({
      transactionId,
      fromPath,
      toPath,
      messageId: msgId,
      content,
      contentType,
    });

    // Connect to MSRP relay
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send MSRP request
      const requestBytes = new TextEncoder().encode(msrpRequest);
      await writer.write(requestBytes);
      writer.releaseLock();

      // Read response
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const maxResponseSize = 8192; // Reasonable limit for response

      const readTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Response timeout')), timeout);
      });

      try {
        while (true) {
          const { value, done } = await Promise.race([
            reader.read(),
            readTimeout,
          ]);

          if (done) break;

          if (value) {
            chunks.push(value);
            totalBytes += value.length;

            if (totalBytes > maxResponseSize) {
              break;
            }

            // Check if we have a complete response (end-line present)
            const responseText = new TextDecoder().decode(
              new Uint8Array(chunks.flatMap((c) => Array.from(c)))
            );

            if (responseText.includes(`-------${transactionId}`)) {
              break; // Complete response received
            }
          }
        }
      } catch (error) {
        // Socket might close after response
        if (chunks.length === 0) {
          throw error;
        }
      }

      const rtt = Date.now() - start;

      // Combine chunks
      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      const responseText = new TextDecoder().decode(combined);

      reader.releaseLock();
      socket.close();

      // Parse MSRP response
      const parsed = parseMsrpResponse(responseText);

      if (!parsed) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Invalid MSRP response format',
        } satisfies MsrpResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const isSuccess = parsed.statusCode >= 200 && parsed.statusCode < 300;

      return new Response(JSON.stringify({
        success: isSuccess,
        host,
        port,
        statusCode: parsed.statusCode,
        statusText: parsed.statusText,
        transactionId: parsed.transactionId,
        messageId: msgId,
        byteRange: parsed.headers['Byte-Range'],
        rtt,
      } satisfies MsrpResponse), {
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
      host: '',
      port: 2855,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies MsrpResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Build an MSRP REPORT request (receipt notification).
 *
 * Per RFC 4975 Section 7.1.2, REPORT requests are sent by the *recipient*
 * of a SEND request back to the original sender to indicate delivery status.
 * REPORT requests MUST NOT be responded to with a 200 OK or any other
 * transaction response — they are end-to-end notifications, not hop-by-hop
 * transactions.
 */
export function encodeMsrpReport(params: {
  transactionId: string;
  toPath: string;
  fromPath: string;
  messageId: string;
  byteRange: string;
  statusCode: number;
}): string {
  const { transactionId, toPath, fromPath, messageId, byteRange, statusCode } = params;
  const statusText = statusCode === 200 ? 'OK' : 'Error';
  const report = [
    `MSRP ${transactionId} REPORT`,
    `To-Path: ${toPath}`,
    `From-Path: ${fromPath}`,
    `Message-ID: ${messageId}`,
    `Byte-Range: ${byteRange}`,
    `Status: 000 ${statusCode} ${statusText}`,
    `-------${transactionId}$`,
  ].join('\r\n');
  return report;
}

/**
 * Send multiple MSRP SEND messages over a single TCP connection,
 * collecting 200 OK responses for each.
 */
export async function handleMsrpSession(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
      fromPath: string;
      toPath: string;
      messages: string[];
    };

    const {
      host,
      port = 2855,
      fromPath,
      toPath,
      timeout = 15000,
    } = body;
    const messages = body.messages || [];

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!fromPath || !toPath) {
      return new Response(JSON.stringify({
        success: false,
        error: 'fromPath and toPath are required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'messages array must be non-empty',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      const reports: Array<{ tid: string; status: number; messageId: string }> = [];
      let sent = 0;
      let acknowledged = 0;

      /**
       * Read the next complete MSRP message from the stream.
       * A message ends with the end-line: -------<tid>[$|+|#]
       */
      async function readNextMsrpMessage(tid: string): Promise<string> {
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        const endMarkerPrefix = `-------${tid}`;

        const readTimeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Response timeout')), timeout);
        });

        try {
          while (true) {
            const { value, done } = await Promise.race([reader.read(), readTimeoutPromise]);
            if (done) break;
            if (value) {
              chunks.push(value);
              totalBytes += value.length;
              if (totalBytes > 16384) break;
              const combined = new Uint8Array(totalBytes);
              let off = 0;
              for (const c of chunks) { combined.set(c, off); off += c.length; }
              const text = new TextDecoder().decode(combined);
              if (text.includes(endMarkerPrefix)) return text;
            }
          }
        } catch {
          // timeout or stream closed — return what we have
        }

        const combined = new Uint8Array(totalBytes);
        let off = 0;
        for (const c of chunks) { combined.set(c, off); off += c.length; }
        return new TextDecoder().decode(combined);
      }

      for (let i = 0; i < messages.length; i++) {
        const content = messages[i];
        // Padded transaction ID: tid001, tid002, ...
        const tid = `tid${String(i + 1).padStart(3, '0')}`;
        const msgId = generateMessageId();
        const contentBytes = new TextEncoder().encode(content).length;

        // Last message uses '$' (end of message), intermediate could use '+' for chunking
        // For simplicity all messages are sent as complete (single-chunk, '$')
        const msrpRequest = [
          `MSRP ${tid} SEND`,
          `To-Path: ${toPath}`,
          `From-Path: ${fromPath}`,
          `Message-ID: ${msgId}`,
          `Byte-Range: 1-${contentBytes}/${contentBytes}`,
          `Content-Type: text/plain`,
          '',
          content,
          `-------${tid}$`,
        ].join('\r\n');

        const requestBytes = new TextEncoder().encode(msrpRequest);
        await writer.write(requestBytes);
        sent++;

        // Read the 200 OK response for this SEND
        const responseText = await readNextMsrpMessage(tid);
        const parsed = parseMsrpResponse(responseText);

        const statusCode = parsed?.statusCode ?? 0;
        reports.push({ tid, status: statusCode, messageId: msgId });

        if (statusCode >= 200 && statusCode < 300) {
          acknowledged++;
          // Per RFC 4975 Section 7.1.2, REPORT requests are sent by the
          // *recipient* of a message back to the sender to indicate delivery
          // status.  The sender (us) must NOT generate REPORTs for its own
          // SEND transactions — the 200 OK response already confirms the
          // hop-by-hop transaction succeeded.
        }
      }

      const rtt = Date.now() - start;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        rtt,
        sent,
        acknowledged,
        reports,
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
 * Establish a persistent MSRP connection for interactive messaging.
 * This would use WebSocket upgrade for bidirectional communication.
 */
export async function handleMsrpConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      fromPath: string;
      toPath: string;
      timeout?: number;
    };

    const { host, port = 2855, fromPath, toPath, timeout = 15000 } = body;

    // Validation
    if (!host || !fromPath || !toPath) {
      return new Response(JSON.stringify({
        success: false,
        error: 'host, fromPath, and toPath are required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    // Connect to MSRP relay
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const rtt = Date.now() - start;

      socket.close();

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        fromPath,
        toPath,
        rtt,
        message: 'MSRP connection successful',
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
