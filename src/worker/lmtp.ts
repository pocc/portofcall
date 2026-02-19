/**
 * LMTP Protocol Implementation (RFC 2033)
 *
 * Local Mail Transfer Protocol — designed for final mail delivery to mailboxes.
 * Nearly identical to SMTP but with key differences:
 * - Uses LHLO instead of EHLO/HELO
 * - Returns per-recipient status codes after DATA (one per RCPT TO)
 * - Does not queue mail for later delivery (immediate acceptance or rejection)
 *
 * Protocol Flow:
 * 1. Client connects (usually port 24 or Unix socket)
 * 2. Server sends greeting (220)
 * 3. Client sends LHLO
 * 4. Server responds with capabilities (250)
 * 5. MAIL FROM / RCPT TO / DATA as per SMTP
 * 6. After DATA terminator (<CRLF>.<CRLF>), server sends one status per RCPT TO
 *
 * Used by: Dovecot, Cyrus IMAP, Postfix (for local delivery)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface LMTPConnectRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface LMTPSendRequest {
  host: string;
  port?: number;
  from: string;
  to: string[];
  subject: string;
  body: string;
  timeout?: number;
}

/**
 * Parse an LMTP/SMTP-style response.
 *
 * Multi-line responses use "code-text" on continuation lines and "code text"
 * on the final line (RFC 5321 Section 4.2). We find the final line to extract
 * the status code.
 */
function parseLMTPResponse(data: string): { code: number; message: string } {
  const trimmed = data.replace(/\r\n$/, '');
  const lines = trimmed.split('\r\n');
  const lastLine = lines[lines.length - 1];
  const match = lastLine.match(/^(\d{3})\s/);
  return {
    code: match ? parseInt(match[1]) : 0,
    message: trimmed,
  };
}

/**
 * Read LMTP response with timeout.
 *
 * A complete response ends when the last line matches "code SP text CRLF"
 * (i.e., the final line uses a space after the code, not a hyphen).
 * Multi-line responses have "code-text" continuation lines.
 */
async function readLMTPResponse(
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
      // Complete response: final line has "code SP text CRLF" (anchored to line start)
      if (/(?:^|\r\n)\d{3}\s[^\r]*\r\n$/.test(response)) {
        break;
      }
    }
    return response;
  })();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('LMTP read timeout')), timeoutMs)
  );

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Read multiple LMTP responses (one per recipient after DATA).
 *
 * Each per-recipient response may itself be multi-line (continuation lines
 * use "code-text", final line uses "code SP text"). We accumulate lines for
 * each response and only count it complete when we see the final line.
 */
async function readLMTPMultiResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  count: number,
  timeoutMs: number
): Promise<Array<{ code: number; message: string }>> {
  const results: Array<{ code: number; message: string }> = [];

  const readPromise = (async () => {
    let buffer = '';
    let currentResponseLines: string[] = [];
    while (results.length < count) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += new TextDecoder().decode(value);

      // Parse complete lines from buffer
      while (results.length < count) {
        const lineEnd = buffer.indexOf('\r\n');
        if (lineEnd === -1) break;
        const line = buffer.substring(0, lineEnd);
        buffer = buffer.substring(lineEnd + 2);

        // Final line of a response: "code SP text"
        const finalMatch = line.match(/^(\d{3})\s(.*)/);
        // Continuation line: "code-text"
        const contMatch = line.match(/^(\d{3})-(.*)/);

        if (finalMatch) {
          currentResponseLines.push(line);
          results.push({
            code: parseInt(finalMatch[1]),
            message: currentResponseLines.join('\r\n'),
          });
          currentResponseLines = [];
        } else if (contMatch) {
          currentResponseLines.push(line);
        }
      }
    }
    return results;
  })();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('LMTP multi-response timeout')), timeoutMs)
  );

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Send LMTP command and read single response
 */
async function sendLMTPCommand(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  command: string,
  timeoutMs: number
): Promise<{ code: number; message: string }> {
  await writer.write(new TextEncoder().encode(command + '\r\n'));
  const response = await readLMTPResponse(reader, timeoutMs);
  return parseLMTPResponse(response);
}

/**
 * Handle LMTP connection test
 * Connects, reads greeting, sends LHLO, reports capabilities, then QUIT
 */
export async function handleLMTPConnect(request: Request): Promise<Response> {
  try {
    let options: Partial<LMTPConnectRequest>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<LMTPConnectRequest>;
    } else {
      const url = new URL(request.url);
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '24'),
        timeout: parseInt(url.searchParams.get('timeout') || '10000'),
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
    const port = options.port || 24;
    const timeoutMs = options.timeout || 10000;

    // Check Cloudflare
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
        const greeting = await readLMTPResponse(reader, 5000);
        const greetingResp = parseLMTPResponse(greeting);

        if (greetingResp.code !== 220) {
          throw new Error(`Invalid LMTP greeting: ${greetingResp.message}`);
        }

        // Send LHLO (LMTP's version of EHLO)
        const lhloResp = await sendLMTPCommand(reader, writer, 'LHLO portofcall', 5000);

        if (lhloResp.code !== 250) {
          throw new Error(`LHLO failed: ${lhloResp.message}`);
        }

        // Parse capabilities from LHLO response
        const capabilities = lhloResp.message
          .split('\r\n')
          .map(line => line.replace(/^250[-\s]/, '').trim())
          .filter(line => line.length > 0);

        // Send QUIT
        await sendLMTPCommand(reader, writer, 'QUIT', 5000);
        await socket.close();

        return {
          success: true,
          host,
          port,
          protocol: 'LMTP',
          greeting: greetingResp.message,
          capabilities,
          note: 'LMTP server reachable. Uses LHLO instead of EHLO; per-recipient delivery status.',
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
        error: error instanceof Error ? error.message : 'Connection timeout',
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
 * Handle LMTP message delivery
 * Performs full LHLO -> MAIL FROM -> RCPT TO (multiple) -> DATA -> per-recipient status
 */
export async function handleLMTPSend(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({
      error: 'Method not allowed',
    }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const options = await request.json() as Partial<LMTPSendRequest>;

    if (!options.host || !options.from || !options.to || !options.subject || !options.body) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameters: host, from, to (array), subject, body',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const recipients = Array.isArray(options.to) ? options.to : [options.to];
    if (recipients.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'At least one recipient is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 24;
    const timeoutMs = options.timeout || 15000;

    // Check Cloudflare
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
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Greeting
        const greeting = await readLMTPResponse(reader, 5000);
        const greetingResp = parseLMTPResponse(greeting);
        if (greetingResp.code !== 220) {
          throw new Error(`Invalid LMTP greeting: ${greetingResp.message}`);
        }

        // LHLO
        const lhloResp = await sendLMTPCommand(reader, writer, 'LHLO portofcall', 5000);
        if (lhloResp.code !== 250) {
          throw new Error(`LHLO failed: ${lhloResp.message}`);
        }

        // MAIL FROM
        const mailFromResp = await sendLMTPCommand(
          reader, writer, `MAIL FROM:<${options.from}>`, 5000
        );
        if (mailFromResp.code !== 250) {
          throw new Error(`MAIL FROM failed: ${mailFromResp.message}`);
        }

        // RCPT TO (one per recipient)
        const rcptResults: Array<{ recipient: string; code: number; message: string }> = [];
        let acceptedCount = 0;
        for (const recipient of recipients) {
          const rcptResp = await sendLMTPCommand(
            reader, writer, `RCPT TO:<${recipient}>`, 5000
          );
          rcptResults.push({
            recipient,
            code: rcptResp.code,
            message: rcptResp.message,
          });
          // 250 = OK, 251 = user not local but will forward (both are success)
          if (rcptResp.code === 250 || rcptResp.code === 251) acceptedCount++;
        }

        if (acceptedCount === 0) {
          throw new Error('All recipients were rejected');
        }

        // DATA
        const dataResp = await sendLMTPCommand(reader, writer, 'DATA', 5000);
        if (dataResp.code !== 354) {
          throw new Error(`DATA command failed: ${dataResp.message}`);
        }

        // Build message content with proper MIME headers
        const emailContent = [
          `From: ${options.from}`,
          `To: ${recipients.join(', ')}`,
          `Subject: ${options.subject}`,
          `Date: ${new Date().toUTCString()}`,
          `MIME-Version: 1.0`,
          `Content-Type: text/plain; charset=UTF-8`,
          '',
          options.body,
        ].join('\r\n');

        // Dot-stuffing (RFC 5321 Section 4.5.2): any line in the message that
        // begins with a period must be prefixed with an additional period so the
        // server does not interpret it as the end-of-data marker.
        // Match start of string OR \r\n followed by a period
        const dotStuffed = emailContent.replace(/(^|\r\n)\./g, '$1..');

        await writer.write(new TextEncoder().encode(dotStuffed + '\r\n.\r\n'));

        // LMTP key difference: read one status per accepted RCPT TO
        const deliveryResults = await readLMTPMultiResponse(reader, acceptedCount, 10000);

        const deliveryStatus = deliveryResults.map((result, index) => ({
          recipient: rcptResults.filter(r => r.code === 250 || r.code === 251)[index]?.recipient || 'unknown',
          code: result.code,
          message: result.message,
          delivered: result.code >= 200 && result.code < 300,
        }));

        // QUIT
        await sendLMTPCommand(reader, writer, 'QUIT', 5000);
        await socket.close();

        const allDelivered = deliveryStatus.every(s => s.delivered);

        return {
          success: true,
          host,
          port,
          from: options.from,
          recipientCount: recipients.length,
          acceptedCount,
          deliveryStatus,
          allDelivered,
          note: 'LMTP provides per-recipient delivery status (unlike SMTP which gives one status for all).',
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
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Send timeout',
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
