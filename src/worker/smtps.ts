/**
 * SMTPS Protocol Support for Cloudflare Workers
 * SMTP over TLS (RFC 8314) — port 465
 *
 * Identical to SMTP but the entire connection is wrapped in TLS
 * using Cloudflare Workers' secureTransport: 'on' option.
 * Unlike STARTTLS on port 587, SMTPS uses implicit TLS from the first byte.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface SMTPSConnectionOptions {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  timeout?: number;
}

interface SMTPSSendOptions extends SMTPSConnectionOptions {
  from: string;
  to: string;
  subject: string;
  body: string;
}

/**
 * Parse SMTP response into code and message
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

      // Check for a complete response (final line has code followed by space)
      if (response.match(/\d{3}\s.*\r\n$/)) {
        break;
      }
    }
    return response;
  })();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('SMTPS read timeout')), timeoutMs)
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
 * Handle SMTPS connection test (probe)
 */
export async function handleSMTPSConnect(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let options: Partial<SMTPSConnectionOptions>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<SMTPSConnectionOptions>;
    } else {
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '465'),
        username: url.searchParams.get('username') || undefined,
        password: url.searchParams.get('password') || undefined,
        timeout: parseInt(url.searchParams.get('timeout') || '30000'),
      };
    }

    if (!options.host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 465;
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
      const startTime = Date.now();

      // Connect with implicit TLS using secureTransport: 'on'
      const socket = connect(`${host}:${port}`, {
        secureTransport: 'on',
        allowHalfOpen: false,
      });
      await socket.opened;

      const rtt = Date.now() - startTime;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Read server greeting (220)
        const greeting = await readSMTPResponse(reader, 5000);
        const greetingResp = parseSMTPResponse(greeting);

        if (greetingResp.code !== 220) {
          throw new Error(`Invalid SMTPS greeting: ${greetingResp.message}`);
        }

        // Send EHLO command
        const ehloResp = await sendSMTPCommand(reader, writer, 'EHLO portofcall', 5000);

        if (ehloResp.code !== 250) {
          throw new Error(`EHLO failed: ${ehloResp.message}`);
        }

        // Extract capabilities
        const capabilities = ehloResp.message
          .split('\n')
          .filter(l => l.match(/^250[- ]/))
          .map(l => l.replace(/^250[- ]/, '').trim());

        let authenticated = false;

        // Try authentication if credentials provided
        if (options.username && options.password) {
          const authResp = await sendSMTPCommand(reader, writer, 'AUTH LOGIN', 5000);
          if (authResp.code === 334) {
            const usernameB64 = btoa(options.username);
            const userResp = await sendSMTPCommand(reader, writer, usernameB64, 5000);
            if (userResp.code === 334) {
              const passwordB64 = btoa(options.password);
              const passResp = await sendSMTPCommand(reader, writer, passwordB64, 5000);
              if (passResp.code === 235) {
                authenticated = true;
              } else {
                throw new Error(`Authentication failed: ${passResp.message}`);
              }
            } else {
              throw new Error(`Username rejected: ${userResp.message}`);
            }
          } else {
            throw new Error(`AUTH LOGIN not supported: ${authResp.message}`);
          }
        }

        // Send QUIT
        await sendSMTPCommand(reader, writer, 'QUIT', 5000);
        await socket.close();

        return {
          success: true,
          host,
          port,
          protocol: 'SMTPS',
          tls: true,
          rtt,
          greeting: greetingResp.message,
          capabilities,
          authenticated,
          note: authenticated
            ? 'Successfully authenticated over implicit TLS'
            : 'SMTPS connection test only (no authentication). Provide credentials to test login.',
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
 * Handle SMTPS send email
 */
export async function handleSMTPSSend(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        error: 'Method not allowed',
      }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const options = await request.json() as Partial<SMTPSSendOptions>;

    if (!options.host || !options.from || !options.to || !options.subject || !options.body) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameters: host, from, to, subject, body',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 465;
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

    const sendPromise = (async () => {
      const startTime = Date.now();

      // Connect with implicit TLS
      const socket = connect(`${host}:${port}`, {
        secureTransport: 'on',
        allowHalfOpen: false,
      });
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Read server greeting (220)
        const greeting = await readSMTPResponse(reader, 5000);
        const greetingResp = parseSMTPResponse(greeting);

        if (greetingResp.code !== 220) {
          throw new Error(`Invalid SMTPS greeting: ${greetingResp.message}`);
        }

        // Send EHLO
        const ehloResp = await sendSMTPCommand(reader, writer, 'EHLO portofcall', 5000);
        if (ehloResp.code !== 250) {
          throw new Error(`EHLO failed: ${ehloResp.message}`);
        }

        // Authenticate if credentials provided
        if (options.username && options.password) {
          const authResp = await sendSMTPCommand(reader, writer, 'AUTH LOGIN', 5000);
          if (authResp.code !== 334) {
            throw new Error(`AUTH LOGIN failed: ${authResp.message}`);
          }

          const usernameB64 = btoa(options.username);
          const userResp = await sendSMTPCommand(reader, writer, usernameB64, 5000);
          if (userResp.code !== 334) {
            throw new Error(`Username authentication failed: ${userResp.message}`);
          }

          const passwordB64 = btoa(options.password);
          const passResp = await sendSMTPCommand(reader, writer, passwordB64, 5000);
          if (passResp.code !== 235) {
            throw new Error(`Password authentication failed: ${passResp.message}`);
          }
        }

        // Send MAIL FROM
        const mailFromResp = await sendSMTPCommand(
          reader, writer,
          `MAIL FROM:<${options.from}>`,
          5000
        );
        if (mailFromResp.code !== 250) {
          throw new Error(`MAIL FROM failed: ${mailFromResp.message}`);
        }

        // Send RCPT TO
        const rcptToResp = await sendSMTPCommand(
          reader, writer,
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
        const emailContent = [
          `From: ${options.from}`,
          `To: ${options.to}`,
          `Subject: ${options.subject}`,
          `Date: ${new Date().toUTCString()}`,
          `MIME-Version: 1.0`,
          `Content-Type: text/plain; charset=UTF-8`,
          '',
          options.body,
          '.',
        ].join('\r\n');

        const sendResp = await sendSMTPCommand(reader, writer, emailContent, 10000);
        if (sendResp.code !== 250) {
          throw new Error(`Email sending failed: ${sendResp.message}`);
        }

        const rtt = Date.now() - startTime;

        // Send QUIT
        await sendSMTPCommand(reader, writer, 'QUIT', 5000);
        await socket.close();

        return {
          success: true,
          message: 'Email sent successfully over TLS',
          host,
          port,
          tls: true,
          from: options.from,
          to: options.to,
          subject: options.subject,
          rtt,
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
