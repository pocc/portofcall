/**
 * SMTP Protocol Support for Cloudflare Workers
 * Simple Mail Transfer Protocol for email sending
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

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
    code: match ? parseInt(match[1]) : 0,
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
    let response = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = new TextDecoder().decode(value);
      response += chunk;

      // Check if we have a complete response (ends with \r\n and has a code)
      if (response.match(/\d{3}\s.*\r\n$/)) {
        break;
      }
    }
    return response;
  })();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('SMTP read timeout')), timeoutMs)
  );

  return Promise.race([readPromise, timeoutPromise]);
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
  await writer.write(new TextEncoder().encode(command + '\r\n'));
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
        port: parseInt(url.searchParams.get('port') || '25'),
        timeout: parseInt(url.searchParams.get('timeout') || '30000'),
      };
    }

    // Validate required fields
    if (!options.host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 25;
    const timeoutMs = options.timeout || 30000;

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
        await socket.close();

        return {
          success: true,
          message: 'SMTP server reachable',
          host,
          port,
          greeting: greetingResp.message,
          capabilities: ehloResp.message,
          note: 'This is a connectivity test. Use the send feature to send emails.',
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
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
        error: 'Method not allowed',
      }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const options = await request.json() as Partial<SMTPSendOptions>;

    // Validate required fields
    if (!options.host || !options.from || !options.to || !options.subject || !options.body) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: host, from, to, subject, body',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 25;
    const timeoutMs = options.timeout || 30000;

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
        const dotStuffedBody = options.body!.replace(/^\./gm, '..');
        const emailContent = [
          `From: ${options.from}`,
          `To: ${options.to}`,
          `Subject: ${options.subject}`,
          '',
          dotStuffedBody,
          '.',
        ].join('\r\n');

        const sendResp = await sendSMTPCommand(reader, writer, emailContent, 10000);
        if (sendResp.code !== 250) {
          throw new Error(`Email sending failed: ${sendResp.message}`);
        }

        // Send QUIT
        await sendSMTPCommand(reader, writer, 'QUIT', 5000);
        await socket.close();

        return {
          success: true,
          message: 'Email sent successfully',
          host,
          port,
          from: options.from,
          to: options.to,
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Send timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([sendPromise, timeoutPromise]);
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
