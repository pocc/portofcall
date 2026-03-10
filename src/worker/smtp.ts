/**
 * SMTP Protocol Support for Cloudflare Workers
 * Simple Mail Transfer Protocol for email sending
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';
import { raceWithTimeout } from './timeout-utils';

export interface SMTPConnectionOptions {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  useTLS?: boolean;
  timeout?: number;
}

export interface SMTPSendOptions extends SMTPConnectionOptions {
  from: string;
  to: string;
  subject: string;
  body: string;
}

/**
 * SMTP response parser
 */
function parseSMTPResponse(data: string): { code: number; message: string } {
  const lines = data.trim().split('\n');
  const lastLine = lines[lines.length - 1];
  const match = lastLine.match(/^(\d{3})\s/);

  return {
    code: match ? parseInt(match[1], 10) : 0,
    message: data.trim(),
  };
}

/**
 * Read SMTP response with timeout
 */
async function readSMTPResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<string> {
  const readPromise = (async () => {
    const decoder = new TextDecoder();
    const MAX_RESPONSE_SIZE = 512 * 1024; // 512 KB
    let response = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      response += chunk;

      if (response.length > MAX_RESPONSE_SIZE) {
        throw new Error('SMTP response too large (exceeds 512 KB)');
      }

      // Check if we have a complete response (ends with \r\n and has a code)
      if (response.match(/\d{3}\s.*\r\n$/)) {
        break;
      }
    }
    // Flush any remaining bytes in the TextDecoder's internal buffer
    response += decoder.decode();
    return response;
  })();

  return raceWithTimeout(readPromise, timeoutMs, 'SMTP read timeout');
}

/**
 * Send SMTP command and read response
 */
async function sendSMTPCommand(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  command: string,
  timeoutMs: number
): Promise<{ code: number; message: string }> {
  const safeCommand = command.replace(/[\r\n]/g, '');
  await writer.write(new TextEncoder().encode(safeCommand + '\r\n'));
  const response = await readSMTPResponse(reader, timeoutMs);
  return parseSMTPResponse(response);
}

/**
 * Handle SMTP connection test (HTTP mode)
 */
export async function handleSMTPConnect(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let options: Partial<SMTPConnectionOptions>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<SMTPConnectionOptions>;
    } else {
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '25', 10),
        timeout: parseInt(url.searchParams.get('timeout') || '30000', 10),
      };
    }

    // Validate required fields
    if (!options.host) {
      return new Response(JSON.stringify({
        success: false, error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 25;
    const timeoutMs = options.timeout || 30000;

    if (typeof port !== 'number' || isNaN(port) || port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if the target is behind Cloudflare
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

    // Wrap entire connection in timeout
    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Read server greeting (220)
        const greeting = await readSMTPResponse(reader, 5000);
        const greetingResp = parseSMTPResponse(greeting);

        if (greetingResp.code !== 220) {
          throw new Error(`Invalid SMTP greeting: ${greetingResp.message}`);
        }

        // Send EHLO command
        const ehloResp = await sendSMTPCommand(reader, writer, 'EHLO portofcall', 5000);

        if (ehloResp.code !== 250) {
          throw new Error(`EHLO failed: ${ehloResp.message}`);
        }

        // Send QUIT
        await sendSMTPCommand(reader, writer, 'QUIT', 5000);

        return {
          success: true,
          message: 'SMTP server reachable',
          host,
          port,
          greeting: greetingResp.message,
          capabilities: ehloResp.message,
          note: 'This is a connectivity test. Use the send feature to send emails.',
        };
      } finally {
        try { reader.releaseLock(); } catch { /* already released */ }
        try { writer.releaseLock(); } catch { /* already released */ }
        await socket.close().catch(() => {});
      }
    })();

    try {
      const result = await raceWithTimeout(connectionPromise, timeoutMs, 'Connection timeout');
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (timeoutError) {
      return new Response(JSON.stringify({
        success: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'Connection timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle SMTP send email (HTTP mode)
 */
export async function handleSMTPSend(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        success: false, error: 'Method not allowed',
      }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const options = await request.json() as Partial<SMTPSendOptions>;

    // Validate required fields
    if (!options.host || !options.from || !options.to || !options.subject || !options.body) {
      return new Response(JSON.stringify({
        success: false, error: 'Missing required parameters: host, from, to, subject, body',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 25;
    const timeoutMs = options.timeout || 30000;

    if (typeof port !== 'number' || isNaN(port) || port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate email addresses — reject angle brackets and CRLF to prevent command injection
    const EMAIL_RE = /^[^\s<>\r\n@]+@[^\s<>\r\n@]+\.[^\s<>\r\n@]+$/;
    if (!EMAIL_RE.test(options.from!) || !EMAIL_RE.test(options.to!)) {
      return new Response(JSON.stringify({
        success: false, error: 'Invalid email address format (from/to must not contain <, >, or whitespace)',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Require authentication to prevent open relay abuse
    if (!options.username || !options.password) {
      return new Response(JSON.stringify({
        success: false, error: 'Authentication required: username and password must be provided',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Check if the target is behind Cloudflare
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

    // Wrap entire send operation in timeout
    const sendPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Read server greeting (220)
        const greeting = await readSMTPResponse(reader, 5000);
        const greetingResp = parseSMTPResponse(greeting);

        if (greetingResp.code !== 220) {
          throw new Error(`Invalid SMTP greeting: ${greetingResp.message}`);
        }

        // Send EHLO
        const ehloResp = await sendSMTPCommand(reader, writer, 'EHLO portofcall', 5000);
        if (ehloResp.code !== 250) {
          throw new Error(`EHLO failed: ${ehloResp.message}`);
        }

        // Send AUTH LOGIN if credentials provided
        if (options.username && options.password) {
          const authResp = await sendSMTPCommand(reader, writer, 'AUTH LOGIN', 5000);
          if (authResp.code !== 334) {
            throw new Error(`AUTH LOGIN failed: ${authResp.message}`);
          }

          // Send username (base64)
          const usernameB64 = btoa(options.username);
          const userResp = await sendSMTPCommand(reader, writer, usernameB64, 5000);
          if (userResp.code !== 334) {
            throw new Error(`Username authentication failed: ${userResp.message}`);
          }

          // Send password (base64)
          const passwordB64 = btoa(options.password);
          const passResp = await sendSMTPCommand(reader, writer, passwordB64, 5000);
          if (passResp.code !== 235) {
            throw new Error(`Password authentication failed: ${passResp.message}`);
          }
        }

        // Send MAIL FROM
        const mailFromResp = await sendSMTPCommand(
          reader,
          writer,
          `MAIL FROM:<${options.from}>`,
          5000
        );
        if (mailFromResp.code !== 250) {
          throw new Error(`MAIL FROM failed: ${mailFromResp.message}`);
        }

        // Send RCPT TO
        const rcptToResp = await sendSMTPCommand(
          reader,
          writer,
          `RCPT TO:<${options.to}>`,
          5000
        );
        if (rcptToResp.code !== 250) {
          throw new Error(`RCPT TO failed: ${rcptToResp.message}`);
        }

        // Send DATA command
        const dataResp = await sendSMTPCommand(reader, writer, 'DATA', 5000);
        if (dataResp.code !== 354) {
          throw new Error(`DATA command failed: ${dataResp.message}`);
        }

        // Send email content
        // RFC 5321 §4.5.2: Dot-stuff the body — any line starting with "."
        // must have an extra "." prepended to avoid being interpreted as the
        // end-of-data marker (".\r\n").
        // Sanitize header field values to prevent CRLF injection
        const safeFrom = (options.from ?? '').replace(/[\r\n]/g, ' ');
        const safeTo = (options.to ?? '').replace(/[\r\n]/g, ' ');
        const safeSubject = (options.subject ?? '').replace(/[\r\n]/g, ' ');
        // Normalize body line endings to CRLF before dot-stuffing (M-1)
        const normalizedBody = (options.body ?? '').replace(/\r?\n/g, '\r\n');
        const emailContent = [
          `From: ${safeFrom}`,
          `To: ${safeTo}`,
          `Subject: ${safeSubject}`,
          `Date: ${new Date().toUTCString()}`,
          `MIME-Version: 1.0`,
          `Content-Type: text/plain; charset=UTF-8`,
          '',
          normalizedBody,
        ].join('\r\n');

        const dotStuffedBody = emailContent.replace(/(^|\r\n)\./gm, '$1..');
        const finalContent = dotStuffedBody + '\r\n.\r\n';

        // Write DATA content directly — do NOT use sendSMTPCommand which strips CRLF
        await writer.write(new TextEncoder().encode(finalContent));
        const sendRaw = await readSMTPResponse(reader, 10000);
        const sendResp = parseSMTPResponse(sendRaw);
        if (sendResp.code !== 250) {
          throw new Error(`Email sending failed: ${sendResp.message}`);
        }

        // Send QUIT
        await sendSMTPCommand(reader, writer, 'QUIT', 5000);

        return {
          success: true,
          message: 'Email sent successfully',
          host,
          port,
          from: options.from,
          to: options.to,
        };
      } finally {
        try { reader.releaseLock(); } catch { /* already released */ }
        try { writer.releaseLock(); } catch { /* already released */ }
        await socket.close().catch(() => {});
      }
    })();

    try {
      const result = await raceWithTimeout(sendPromise, timeoutMs, 'Send timeout');
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (timeoutError) {
      return new Response(JSON.stringify({
        success: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'Send timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Send failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
