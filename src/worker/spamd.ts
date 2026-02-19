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
  username?: string;
  timeout?: number;
}

interface SpamdCheckRequest {
  host: string;
  port?: number;
  message: string;
  command?: 'CHECK' | 'SYMBOLS' | 'REPORT';
  username?: string;
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

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('Read timeout')), timeout);
  });

  try {
    while (totalBytes < maxBytes) {
      const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
      if (done || !value) break;
      chunks.push(value);
      totalBytes += value.length;

      // Combine all chunks to check completion
      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      const text = new TextDecoder().decode(combined);

      // For PING, response should be "SPAMD/x.x 0 PONG\r\n"
      if (text.includes('PONG')) {
        const firstLine = text.split('\r\n')[0];
        if (firstLine && firstLine.includes('PONG')) break;
      }

      // For other commands, check Content-length header
      const headerEnd = text.indexOf('\r\n\r\n');
      if (headerEnd !== -1) {
        const headers = text.substring(0, headerEnd);
        const contentLengthMatch = headers.match(/Content-length:\s*(\d+)/i);
        if (contentLengthMatch) {
          const contentLength = parseInt(contentLengthMatch[1]);
          // Calculate body bytes: total bytes minus header section (including \r\n\r\n)
          const headerBytes = new TextEncoder().encode(text.substring(0, headerEnd + 4)).length;
          const bodyReceived = totalBytes - headerBytes;
          if (bodyReceived >= contentLength) break;
        } else {
          // No Content-length, response may be header-only
          break;
        }
      }
    }
  } catch (error) {
    if (chunks.length === 0) throw error;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
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
  let socket: ReturnType<typeof connect> | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    const body = await request.json() as SpamdPingRequest;
    const { host, port = 783, username, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate host format (domain or IPv4/IPv6)
    const hostRegex = /^(?:[a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+$|^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$|^\[?[0-9a-fA-F:]+\]?$/;
    if (!hostRegex.test(host)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid host format',
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

    if (timeout < 1 || timeout > 300000) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Timeout must be between 1 and 300000 ms',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();
    socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Send PING command with optional User header
        let pingCmd = `PING SPAMC/${SPAMC_VERSION}\r\n`;
        if (username) {
          pingCmd += `User: ${username}\r\n`;
        }
        pingCmd += `\r\n`;
        await writer.write(new TextEncoder().encode(pingCmd));

        // Read response
        const responseText = await readSpamdResponse(reader, timeout);
        const rtt = Date.now() - startTime;

        // Parse response
        const firstLine = responseText.split('\r\n')[0];
        const parsed = parseResponseLine(firstLine);

        if (!parsed) {
          return new Response(JSON.stringify({
            success: false,
            error: `Invalid spamd response: ${firstLine}`,
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (parsed.message !== 'PONG') {
          return new Response(JSON.stringify({
            success: false,
            error: `Expected PONG, got: ${parsed.message}`,
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }

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

      } finally {
        try { writer.releaseLock(); } catch {}
        try { reader.releaseLock(); } catch {}
      }

    } finally {
      if (socket) {
        try { socket.close(); } catch {}
      }
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

/**
 * CHECK/SYMBOLS/REPORT - Analyze a message for spam
 * Sends the email content and receives spam analysis results
 */
export async function handleSpamdCheck(request: Request): Promise<Response> {
  let socket: ReturnType<typeof connect> | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    const body = await request.json() as SpamdCheckRequest;
    const { host, port = 783, message, command = 'SYMBOLS', username, timeout = 30000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate host format
    const hostRegex = /^(?:[a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+$|^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$|^\[?[0-9a-fA-F:]+\]?$/;
    if (!hostRegex.test(host)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid host format',
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

    if (timeout < 1 || timeout > 300000) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Timeout must be between 1 and 300000 ms',
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

    // Size limit: 512KB for message content (check string length before encoding)
    if (message.length > 524288 || message.length < 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Message too large (max 512KB)',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();
    socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Build request with User header if provided
        const messageBytes = new TextEncoder().encode(message);
        let requestText = `${cmd} SPAMC/${SPAMC_VERSION}\r\nContent-length: ${messageBytes.length}\r\n`;
        if (username) {
          requestText += `User: ${username}\r\n`;
        }
        requestText += `\r\n`;

        // Send command + headers
        await writer.write(new TextEncoder().encode(requestText));
        // Send message body
        await writer.write(messageBytes);

        // Read response
        const responseText = await readSpamdResponse(reader, timeout);
        const rtt = Date.now() - startTime;

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
        // SpamAssassin symbols are comma-separated, but individual symbols do not contain commas
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

      } finally {
        try { writer.releaseLock(); } catch {}
        try { reader.releaseLock(); } catch {}
      }

    } finally {
      if (socket) {
        try { socket.close(); } catch {}
      }
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

interface SpamdTellRequest {
  host: string;
  port?: number;
  message: string;
  messageType?: 'spam' | 'ham';
  action?: 'learn' | 'forget';
  username?: string;
  timeout?: number;
}

interface SpamdTellResponse {
  success: boolean;
  host?: string;
  port?: number;
  messageType?: string;
  action?: string;
  didSet?: boolean;
  didRemove?: boolean;
  rtt?: number;
  error?: string;
}

/**
 * TELL — Teach SpamAssassin to recognize spam or ham (learn/forget)
 * Uses the SPAMD TELL command to update Bayes database
 */
export async function handleSpamdTell(request: Request): Promise<Response> {
  let socket: ReturnType<typeof connect> | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    const body = await request.json() as SpamdTellRequest;
    const { host, port = 783, message, messageType = 'spam', action = 'learn', username, timeout = 30000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      } satisfies SpamdTellResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate host format
    const hostRegex = /^(?:[a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+$|^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$|^\[?[0-9a-fA-F:]+\]?$/;
    if (!hostRegex.test(host)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid host format',
      } satisfies SpamdTellResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!message) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Message content is required',
      } satisfies SpamdTellResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535',
      } satisfies SpamdTellResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (timeout < 1 || timeout > 300000) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Timeout must be between 1 and 300000 ms',
      } satisfies SpamdTellResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (messageType !== 'spam' && messageType !== 'ham') {
      return new Response(JSON.stringify({
        success: false,
        error: 'messageType must be "spam" or "ham"',
      } satisfies SpamdTellResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action !== 'learn' && action !== 'forget') {
      return new Response(JSON.stringify({
        success: false,
        error: 'action must be "learn" or "forget"',
      } satisfies SpamdTellResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Size limit: 512KB
    if (message.length > 524288 || message.length < 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Message too large (max 512KB)',
      } satisfies SpamdTellResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();
    socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Build TELL request with User header if provided
        const messageBytes = new TextEncoder().encode(message);
        const actionHeader = action === 'learn' ? 'Set: local\r\n' : 'Remove: local\r\n';
        let requestText =
          `TELL SPAMC/${SPAMC_VERSION}\r\n` +
          `Content-length: ${messageBytes.length}\r\n` +
          `Message-class: ${messageType}\r\n` +
          actionHeader;
        if (username) {
          requestText += `User: ${username}\r\n`;
        }
        requestText += `\r\n`;

        await writer.write(new TextEncoder().encode(requestText));
        await writer.write(messageBytes);

        // Read response
        const responseText = await readSpamdResponse(reader, timeout);
        const rtt = Date.now() - startTime;

        // Parse response status line
        const firstLine = responseText.split('\r\n')[0];
        const parsed = parseResponseLine(firstLine);

        if (!parsed || parsed.code !== 0) {
          return new Response(JSON.stringify({
            success: false,
            host,
            port,
            messageType,
            action,
            error: `TELL failed: ${firstLine}`,
            rtt,
          } satisfies SpamdTellResponse), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Parse DidSet/DidRemove from response headers
        const didSet = /DidSet:\s*local/i.test(responseText);
        const didRemove = /DidRemove:\s*local/i.test(responseText);

        const result: SpamdTellResponse = {
          success: true,
          host,
          port,
          messageType,
          action,
          didSet,
          didRemove,
          rtt,
        };

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });

      } finally {
        try { writer.releaseLock(); } catch {}
        try { reader.releaseLock(); } catch {}
      }

    } finally {
      if (socket) {
        try { socket.close(); } catch {}
      }
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies SpamdTellResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
