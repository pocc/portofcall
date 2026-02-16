/**
 * Message Submission Protocol Support for Cloudflare Workers
 * RFC 6409 - Port 587 (SMTP with mandatory STARTTLS for authenticated mail submission)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

export interface SubmissionConnectionOptions {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  timeout?: number;
}

export interface SubmissionSendOptions extends SubmissionConnectionOptions {
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
 * Handle Submission protocol connection test (HTTP mode)
 * Tests STARTTLS capability on port 587
 */
export async function handleSubmissionConnect(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let options: Partial<SubmissionConnectionOptions>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<SubmissionConnectionOptions>;
    } else {
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '587'),
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

    const host = options.host!; // Checked above
    const port = options.port || 587;
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

        // Check for STARTTLS support
        const starttlsSupported = ehloResp.message.toUpperCase().includes('STARTTLS');

        // Send QUIT
        await sendSMTPCommand(reader, writer, 'QUIT', 5000);
        await socket.close();

        return {
          success: true,
          message: 'Submission server reachable',
          host,
          port,
          protocol: 'Message Submission (RFC 6409)',
          greeting: greetingResp.message,
          capabilities: ehloResp.message,
          starttlsSupported,
          note: starttlsSupported
            ? 'STARTTLS is supported. Clients should upgrade to TLS before authentication.'
            : 'WARNING: STARTTLS not advertised. RFC 6409 requires STARTTLS on port 587.',
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
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Invalid request',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle Submission email send (HTTP mode)
 * Demonstrates STARTTLS upgrade pattern (note: actual TLS upgrade not implemented in Workers)
 */
export async function handleSubmissionSend(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        error: 'Method not allowed. Use POST.',
      }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const options = await request.json() as Partial<SubmissionSendOptions>;

    // Validate required fields
    const missing: string[] = [];
    if (!options.host) missing.push('host');
    if (!options.from) missing.push('from');
    if (!options.to) missing.push('to');
    if (!options.subject) missing.push('subject');
    if (!options.body) missing.push('body');

    if (missing.length > 0) {
      return new Response(JSON.stringify({
        error: `Missing required parameters: ${missing.join(', ')}`,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host!; // Checked above
    const port = options.port || 587;
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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Read greeting (220)
        const greeting = await readSMTPResponse(reader, 5000);
        const greetingResp = parseSMTPResponse(greeting);

        if (greetingResp.code !== 220) {
          throw new Error(`Invalid greeting: ${greetingResp.message}`);
        }

        // Send EHLO
        const ehloResp = await sendSMTPCommand(reader, writer, 'EHLO portofcall', 5000);
        if (ehloResp.code !== 250) {
          throw new Error(`EHLO failed: ${ehloResp.message}`);
        }

        // Note: STARTTLS upgrade would happen here in a real implementation
        // Cloudflare Workers sockets don't support upgrading plaintext to TLS mid-stream
        // This is a demonstration of the protocol flow

        // AUTH LOGIN (simplified, would follow STARTTLS in production)
        if (options.username && options.password) {
          const username = options.username;
          const password = options.password;

          const authResp = await sendSMTPCommand(reader, writer, 'AUTH LOGIN', 5000);
          if (authResp.code !== 334) {
            throw new Error(`AUTH LOGIN failed: ${authResp.message}`);
          }

          // Send base64-encoded username
          const usernameResp = await sendSMTPCommand(
            reader,
            writer,
            btoa(username),
            5000
          );
          if (usernameResp.code !== 334) {
            throw new Error(`Username rejected: ${usernameResp.message}`);
          }

          // Send base64-encoded password
          const passwordResp = await sendSMTPCommand(
            reader,
            writer,
            btoa(password),
            5000
          );
          if (passwordResp.code !== 235) {
            throw new Error(`Authentication failed: ${passwordResp.message}`);
          }
        }

        // MAIL FROM
        const mailFromResp = await sendSMTPCommand(
          reader,
          writer,
          `MAIL FROM:<${options.from}>`,
          5000
        );
        if (mailFromResp.code !== 250) {
          throw new Error(`MAIL FROM rejected: ${mailFromResp.message}`);
        }

        // RCPT TO
        const rcptToResp = await sendSMTPCommand(
          reader,
          writer,
          `RCPT TO:<${options.to}>`,
          5000
        );
        if (rcptToResp.code !== 250) {
          throw new Error(`RCPT TO rejected: ${rcptToResp.message}`);
        }

        // DATA
        const dataResp = await sendSMTPCommand(reader, writer, 'DATA', 5000);
        if (dataResp.code !== 354) {
          throw new Error(`DATA command rejected: ${dataResp.message}`);
        }

        // Send message content
        const messageBody = [
          `From: ${options.from}`,
          `To: ${options.to}`,
          `Subject: ${options.subject}`,
          '',
          options.body,
          '.',
        ].join('\r\n');

        const sendResp = await sendSMTPCommand(reader, writer, messageBody, 10000);
        if (sendResp.code !== 250) {
          throw new Error(`Message rejected: ${sendResp.message}`);
        }

        // QUIT
        await sendSMTPCommand(reader, writer, 'QUIT', 5000);
        await socket.close();

        return {
          success: true,
          message: 'Email sent successfully via Message Submission Protocol',
          host,
          port,
          from: options.from,
          to: options.to,
          subject: options.subject,
          serverResponse: sendResp.message,
          note: 'In production, STARTTLS upgrade would occur before authentication.',
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
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Send failed',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Invalid request',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
