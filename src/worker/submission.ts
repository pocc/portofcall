/**
 * Message Submission Protocol Support for Cloudflare Workers
 * RFC 6409 - Port 587 (SMTP with mandatory STARTTLS for authenticated mail submission)
 *
 * STARTTLS upgrade uses Cloudflare Workers' socket.startTls() API:
 *   1. Connect with secureTransport: 'starttls'
 *   2. Plain SMTP exchange until STARTTLS command is issued
 *   3. Call socket.startTls() -- returns a new TLS Socket
 *   4. Continue SMTP exchange on the new socket's readable/writable
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

function parseSMTPResponse(data: string): { code: number; message: string } {
  const lines = data.trim().split('\n');
  const lastLine = lines[lines.length - 1];
  const match = lastLine.match(/^(\d{3})\s/);
  return {
    code: match ? parseInt(match[1]) : 0,
    message: data.trim(),
  };
}

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
      if (response.match(/\d{3}\s.*\r\n$/)) break;
    }
    return response;
  })();
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('SMTP read timeout')), timeoutMs)
  );
  return Promise.race([readPromise, timeoutPromise]);
}

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

function parseCapabilities(ehloResponse: string): string[] {
  return ehloResponse
    .split('\n')
    .filter(line => line.match(/^250[- ]/))
    .map(line => line.replace(/^250[- ]/, '').trim().toUpperCase());
}

async function doAuth(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  capabilities: string[],
  username: string,
  password: string
): Promise<void> {
  const authCap = capabilities.find(c => c.startsWith('AUTH'));
  const supportsPlain = authCap ? authCap.includes('PLAIN') : false;
  const supportsLogin = authCap ? authCap.includes('LOGIN') : false;

  if (supportsPlain) {
    // AUTH PLAIN: base64('\0username\0password')
    const combined = '\0' + username + '\0' + password;
    const encoded = btoa(combined);
    const authResp = await sendSMTPCommand(reader, writer, `AUTH PLAIN ${encoded}`, 5000);
    if (authResp.code !== 235) {
      throw new Error(`AUTH PLAIN failed: ${authResp.message}`);
    }
  } else if (supportsLogin) {
    const authResp = await sendSMTPCommand(reader, writer, 'AUTH LOGIN', 5000);
    if (authResp.code !== 334) {
      throw new Error(`AUTH LOGIN failed: ${authResp.message}`);
    }
    const usernameResp = await sendSMTPCommand(reader, writer, btoa(username), 5000);
    if (usernameResp.code !== 334) {
      throw new Error(`AUTH LOGIN username rejected: ${usernameResp.message}`);
    }
    const passwordResp = await sendSMTPCommand(reader, writer, btoa(password), 5000);
    if (passwordResp.code !== 235) {
      throw new Error(`AUTH LOGIN password rejected: ${passwordResp.message}`);
    }
  } else {
    throw new Error('Server does not advertise AUTH PLAIN or AUTH LOGIN');
  }
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

    if (!options.host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 587;
    const timeoutMs = options.timeout || 30000;

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`, { secureTransport: 'starttls', allowHalfOpen: false });
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        const greeting = await readSMTPResponse(reader, 5000);
        const greetingResp = parseSMTPResponse(greeting);
        if (greetingResp.code !== 220) {
          throw new Error(`Invalid SMTP greeting: ${greetingResp.message}`);
        }

        const ehloResp = await sendSMTPCommand(reader, writer, 'EHLO portofcall', 5000);
        if (ehloResp.code !== 250) {
          throw new Error(`EHLO failed: ${ehloResp.message}`);
        }

        const capabilities = parseCapabilities(ehloResp.message);
        const starttlsSupported = capabilities.includes('STARTTLS');

        await sendSMTPCommand(reader, writer, 'QUIT', 5000);
        reader.releaseLock();
        writer.releaseLock();
        await socket.close();

        return {
          success: true,
          message: 'Submission server reachable',
          host,
          port,
          protocol: 'Message Submission (RFC 6409)',
          greeting: greetingResp.message,
          capabilities,
          starttlsSupported,
          note: starttlsSupported
            ? 'STARTTLS is supported. Use /api/submission/send to send authenticated email over TLS.'
            : 'WARNING: STARTTLS not advertised. RFC 6409 requires STARTTLS on port 587.',
        };
      } catch (error) {
        try { reader.releaseLock(); } catch (_) { /* ignore */ }
        try { writer.releaseLock(); } catch (_) { /* ignore */ }
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
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Invalid request',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle Submission email send with full STARTTLS upgrade (HTTP mode)
 *
 * Protocol flow:
 *   1. TCP connect with secureTransport: 'starttls'
 *   2. Read 220 banner
 *   3. EHLO -- parse capabilities
 *   4. STARTTLS command -> 220 -> socket.startTls() returns a new TLS Socket
 *   5. Re-EHLO on TLS socket -- parse new capabilities
 *   6. AUTH PLAIN or AUTH LOGIN
 *   7. MAIL FROM, RCPT TO, DATA, message body, QUIT
 */
export async function handleSubmissionSend(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed. Use POST.' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const options = await request.json() as Partial<SubmissionSendOptions>;

    const missing: string[] = [];
    if (!options.host) missing.push('host');
    if (!options.from) missing.push('from');
    if (!options.to) missing.push('to');
    if (!options.subject) missing.push('subject');
    if (!options.body) missing.push('body');

    if (missing.length > 0) {
      return new Response(JSON.stringify({
        error: `Missing required parameters: ${missing.join(', ')}`,
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const host = options.host!;
    const port = options.port || 587;
    const timeoutMs = options.timeout || 30000;

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const connectionPromise = (async () => {
      // Must use secureTransport: 'starttls' to allow mid-stream TLS upgrade via startTls()
      const socket = connect(`${host}:${port}`, { secureTransport: 'starttls', allowHalfOpen: false });
      await socket.opened;

      // Start with plain socket's reader/writer; replaced after TLS upgrade
      let reader = socket.readable.getReader();
      let writer = socket.writable.getWriter();
      let usedTls = false;

      try {
        // Step 1: Read 220 banner
        const greeting = await readSMTPResponse(reader, 5000);
        const greetingResp = parseSMTPResponse(greeting);
        if (greetingResp.code !== 220) {
          throw new Error(`Invalid greeting: ${greetingResp.message}`);
        }

        // Step 2: EHLO on plain connection
        const ehloResp = await sendSMTPCommand(reader, writer, 'EHLO portofcall', 5000);
        if (ehloResp.code !== 250) {
          throw new Error(`EHLO failed: ${ehloResp.message}`);
        }
        const capabilities = parseCapabilities(ehloResp.message);

        // Step 3: STARTTLS upgrade if advertised
        if (capabilities.includes('STARTTLS')) {
          const starttlsResp = await sendSMTPCommand(reader, writer, 'STARTTLS', 5000);
          if (starttlsResp.code !== 220) {
            throw new Error(`STARTTLS command rejected: ${starttlsResp.message}`);
          }

          // Release plain-socket locks before upgrading
          reader.releaseLock();
          writer.releaseLock();

          // Upgrade to TLS: startTls() returns a NEW Socket with encrypted streams
          const tlsSocket = socket.startTls();
          reader = tlsSocket.readable.getReader();
          writer = tlsSocket.writable.getWriter();
          usedTls = true;

          // Step 4: Re-EHLO on TLS socket
          const tlsEhloResp = await sendSMTPCommand(reader, writer, 'EHLO portofcall', 5000);
          if (tlsEhloResp.code !== 250) {
            throw new Error(`EHLO (post-TLS) failed: ${tlsEhloResp.message}`);
          }
          const tlsCaps = parseCapabilities(tlsEhloResp.message);

          // Step 5: Authenticate over TLS
          if (options.username && options.password) {
            await doAuth(reader, writer, tlsCaps, options.username, options.password);
          }
        } else {
          // No STARTTLS available -- attempt auth on plaintext if server allows it
          if (options.username && options.password) {
            await doAuth(reader, writer, capabilities, options.username, options.password);
          }
        }

        // Step 6: MAIL FROM
        const mailFromResp = await sendSMTPCommand(
          reader, writer, `MAIL FROM:<${options.from}>`, 5000
        );
        if (mailFromResp.code !== 250) {
          throw new Error(`MAIL FROM rejected: ${mailFromResp.message}`);
        }

        // Step 7: RCPT TO
        const rcptToResp = await sendSMTPCommand(
          reader, writer, `RCPT TO:<${options.to}>`, 5000
        );
        if (rcptToResp.code !== 250) {
          throw new Error(`RCPT TO rejected: ${rcptToResp.message}`);
        }

        // Step 8: DATA
        const dataResp = await sendSMTPCommand(reader, writer, 'DATA', 5000);
        if (dataResp.code !== 354) {
          throw new Error(`DATA command rejected: ${dataResp.message}`);
        }

        // Step 9: Message with dot-stuffing per RFC 5321 section 4.5.2
        // Sanitize header field values to prevent CRLF injection
        const safeFrom = (options.from ?? '').replace(/[\r\n]/g, ' ');
        const safeTo = (options.to ?? '').replace(/[\r\n]/g, ' ');
        const safeSubject = (options.subject ?? '').replace(/[\r\n]/g, ' ');
        const messageBody = [
          `From: ${safeFrom}`,
          `To: ${safeTo}`,
          `Subject: ${safeSubject}`,
          `Date: ${new Date().toUTCString()}`,
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset=UTF-8',
          '',
          options.body,
        ].join('\r\n');

        // RFC 5321 §4.5.2: Dot-stuff the body — any line starting with "."
        // must have an extra "." prepended to avoid being interpreted as the
        // end-of-data marker (".\r\n").
        const dotStuffedBody = messageBody.replace(/(^|\r\n)\./g, '$1..');
        const finalContent = dotStuffedBody + '\r\n.\r\n';

        await writer.write(new TextEncoder().encode(finalContent));
        const sendResp = await readSMTPResponse(reader, 10000);
        const sendResult = parseSMTPResponse(sendResp);
        if (sendResult.code !== 250) {
          throw new Error(`Message rejected: ${sendResult.message}`);
        }

        // Step 10: QUIT
        await sendSMTPCommand(reader, writer, 'QUIT', 5000);
        reader.releaseLock();
        writer.releaseLock();
        await socket.close();

        return {
          success: true,
          message: 'Email sent successfully via Message Submission Protocol',
          host,
          port,
          tls: usedTls,
          from: options.from,
          to: options.to,
          subject: options.subject,
          serverResponse: sendResult.message,
        };
      } catch (error) {
        try { reader.releaseLock(); } catch (_) { /* already released */ }
        try { writer.releaseLock(); } catch (_) { /* already released */ }
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
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Invalid request',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}
