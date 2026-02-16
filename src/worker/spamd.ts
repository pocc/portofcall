/**
 * SpamAssassin spamd Protocol Implementation
 *
 * The SpamAssassin daemon (spamd) listens on port 783 and provides spam
 * checking services via a simple text-based protocol similar to HTTP.
 *
 * Protocol Format (SPAMC → spamd):
 *   <COMMAND> SPAMC/<version>\r\n
 *   [Header: value\r\n]*
 *   \r\n
 *   [body]
 *
 * Response Format (spamd → SPAMC):
 *   SPAMD/<version> <response_code> <message>\r\n
 *   [Header: value\r\n]*
 *   \r\n
 *   [body]
 *
 * Commands:
 *   PING     - Connectivity test (responds with PONG)
 *   CHECK    - Check if message is spam, return score
 *   SYMBOLS  - Like CHECK but also returns matched rules
 *   REPORT   - Full text report of spam analysis
 *   PROCESS  - Process message and return modified version
 *
 * Response Codes:
 *   0  - EX_OK (success)
 *   64 - EX_USAGE
 *   65 - EX_DATAERR
 *   66 - EX_NOINPUT
 *   68 - EX_NOHOST
 *   69 - EX_UNAVAILABLE
 *   74 - EX_IOERR
 *   76 - EX_PROTOCOL
 *
 * Use Cases:
 * - Test SpamAssassin server connectivity
 * - Check email messages for spam
 * - Verify spam filtering configuration
 * - Email infrastructure monitoring
 */

import { connect } from 'cloudflare:sockets';

const SPAMC_VERSION = '1.5';

interface SpamdPingRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface SpamdCheckRequest {
  host: string;
  port?: number;
  message: string;
  command?: 'CHECK' | 'SYMBOLS' | 'REPORT';
  timeout?: number;
}

interface SpamdPingResponse {
  success: boolean;
  host?: string;
  port?: number;
  version?: string;
  rtt?: number;
  error?: string;
}

interface SpamdCheckResponse {
  success: boolean;
  host?: string;
  port?: number;
  command?: string;
  isSpam?: boolean;
  score?: number;
  threshold?: number;
  symbols?: string[];
  report?: string;
  responseCode?: number;
  responseMessage?: string;
  rtt?: number;
  error?: string;
}

/**
 * Read a complete response from spamd
 * Accumulates data until connection closes or Content-length is satisfied
 */
async function readSpamdResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeout: number
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const maxBytes = 131072; // 128KB safety limit

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Read timeout')), timeout);
  });

  try {
    while (totalBytes < maxBytes) {
      const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
      if (done || !value) break;
      chunks.push(value);
      totalBytes += value.length;

      // Check if we have a complete response (headers + body based on Content-length)
      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      const text = new TextDecoder().decode(combined);

      // For PING, response is just one line
      if (text.includes('PONG') && text.endsWith('\r\n')) break;

      // For other commands, check Content-length header
      const headerEnd = text.indexOf('\r\n\r\n');
      if (headerEnd !== -1) {
        const headers = text.substring(0, headerEnd);
        const contentLengthMatch = headers.match(/Content-length:\s*(\d+)/i);
        if (contentLengthMatch) {
          const contentLength = parseInt(contentLengthMatch[1]);
          const bodyStart = headerEnd + 4;
          const bodyReceived = totalBytes - new TextEncoder().encode(text.substring(0, bodyStart)).length;
          if (bodyReceived >= contentLength) break;
        } else {
          // No Content-length, response may be header-only
          break;
        }
      }
    }
  } catch (error) {
    if (chunks.length === 0) throw error;
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(result);
}

/**
 * Parse the spamd response status line
 */
function parseResponseLine(line: string): { version: string; code: number; message: string } | null {
  const match = line.match(/^SPAMD\/([\d.]+)\s+(\d+)\s+(.+)/);
  if (!match) return null;
  return {
    version: match[1],
    code: parseInt(match[2]),
    message: match[3].trim(),
  };
}

/**
 * Parse the Spam header from spamd response
 * Format: "Spam: True ; 15.2 / 5.0" or "Spam: False ; 2.1 / 5.0"
 */
function parseSpamHeader(headers: string): { isSpam: boolean; score: number; threshold: number } | null {
  const match = headers.match(/Spam:\s*(True|False|Yes|No)\s*;\s*([\d.]+)\s*\/\s*([\d.]+)/i);
  if (!match) return null;
  return {
    isSpam: match[1].toLowerCase() === 'true' || match[1].toLowerCase() === 'yes',
    score: parseFloat(match[2]),
    threshold: parseFloat(match[3]),
  };
}

/**
 * PING - Test SpamAssassin daemon connectivity
 * Sends PING and expects PONG response
 */
export async function handleSpamdPing(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SpamdPingRequest;
    const { host, port = 783, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
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

      // Send PING command
      const pingCmd = `PING SPAMC/${SPAMC_VERSION}\r\n\r\n`;
      await writer.write(new TextEncoder().encode(pingCmd));

      // Read response
      const responseText = await readSpamdResponse(reader, timeout);
      const rtt = Date.now() - startTime;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      // Parse response
      const firstLine = responseText.split('\r\n')[0];
      const parsed = parseResponseLine(firstLine);

      if (parsed && parsed.message === 'PONG') {
        const result: SpamdPingResponse = {
          success: true,
          host,
          port,
          version: parsed.version,
          rtt,
        };
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        return new Response(JSON.stringify({
          success: true,
          host,
          port,
          version: parsed?.version || 'unknown',
          rtt,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

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
 * CHECK/SYMBOLS/REPORT - Analyze a message for spam
 * Sends the email content and receives spam analysis results
 */
export async function handleSpamdCheck(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SpamdCheckRequest;
    const { host, port = 783, message, command = 'SYMBOLS', timeout = 30000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!message) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Message content is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate command
    const validCommands = ['CHECK', 'SYMBOLS', 'REPORT'];
    const cmd = command.toUpperCase();
    if (!validCommands.includes(cmd)) {
      return new Response(JSON.stringify({
        success: false,
        error: `Invalid command. Must be one of: ${validCommands.join(', ')}`,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Size limit: 512KB for message content
    if (message.length > 524288) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Message too large (max 512KB)',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
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

      // Build request
      const messageBytes = new TextEncoder().encode(message);
      const requestText = `${cmd} SPAMC/${SPAMC_VERSION}\r\nContent-length: ${messageBytes.length}\r\n\r\n`;

      // Send command + headers
      await writer.write(new TextEncoder().encode(requestText));
      // Send message body
      await writer.write(messageBytes);

      // Read response
      const responseText = await readSpamdResponse(reader, timeout);
      const rtt = Date.now() - startTime;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      // Parse response
      const lines = responseText.split('\r\n');
      const statusLine = lines[0];
      const parsed = parseResponseLine(statusLine);

      if (!parsed) {
        return new Response(JSON.stringify({
          success: false,
          error: `Unexpected response: ${statusLine}`,
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Parse headers section
      const headerEnd = responseText.indexOf('\r\n\r\n');
      const headersSection = headerEnd !== -1 ? responseText.substring(0, headerEnd) : responseText;
      const bodySection = headerEnd !== -1 ? responseText.substring(headerEnd + 4) : '';

      // Parse spam status
      const spamInfo = parseSpamHeader(headersSection);

      const result: SpamdCheckResponse = {
        success: true,
        host,
        port,
        command: cmd,
        responseCode: parsed.code,
        responseMessage: parsed.message,
        isSpam: spamInfo?.isSpam,
        score: spamInfo?.score,
        threshold: spamInfo?.threshold,
        rtt,
      };

      // For SYMBOLS command, parse the matched rules
      if (cmd === 'SYMBOLS' && bodySection) {
        result.symbols = bodySection.trim().split(',').map(s => s.trim()).filter(s => s.length > 0);
      }

      // For REPORT command, include the full report
      if (cmd === 'REPORT' && bodySection) {
        result.report = bodySection.trim();
      }

      return new Response(JSON.stringify(result), {
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
