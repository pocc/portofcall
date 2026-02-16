/**
 * NNTPS Protocol Support for Cloudflare Workers
 * NNTP over TLS (RFC 4642) — port 563
 *
 * Identical to NNTP (RFC 3977) but the entire connection is wrapped in TLS
 * using Cloudflare Workers' secureTransport: 'on' option.
 * Unlike STARTTLS on port 119, NNTPS uses implicit TLS from the first byte.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface NNTPSConnectRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface NNTPSGroupRequest {
  host: string;
  port?: number;
  group: string;
  timeout?: number;
}

interface NNTPSArticleRequest {
  host: string;
  port?: number;
  group: string;
  articleNumber: number;
  timeout?: number;
}

/**
 * Read a single response line from the socket
 */
async function readLine(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  buffer: { data: string },
  timeoutPromise: Promise<never>
): Promise<string> {
  while (!buffer.data.includes('\r\n')) {
    const { value, done } = await Promise.race([
      reader.read(),
      timeoutPromise,
    ]);
    if (done) throw new Error('Connection closed unexpectedly');
    buffer.data += decoder.decode(value, { stream: true });
  }

  const newlineIndex = buffer.data.indexOf('\r\n');
  const line = buffer.data.substring(0, newlineIndex);
  buffer.data = buffer.data.substring(newlineIndex + 2);
  return line;
}

/**
 * Read a multiline response (terminated by ".\r\n" on its own line)
 */
async function readMultiline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  buffer: { data: string },
  timeoutPromise: Promise<never>,
  maxSize: number = 500000
): Promise<string[]> {
  const lines: string[] = [];
  let totalSize = 0;

  while (true) {
    const line = await readLine(reader, decoder, buffer, timeoutPromise);

    if (line === '.') break;

    // Dot-stuffing: lines starting with ".." have one dot removed
    const unstuffed = line.startsWith('..') ? line.substring(1) : line;
    lines.push(unstuffed);

    totalSize += unstuffed.length;
    if (totalSize > maxSize) {
      throw new Error('Response too large (max 500KB)');
    }
  }

  return lines;
}

/**
 * Send a command to the NNTP server
 */
async function sendCommand(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
  command: string
): Promise<void> {
  await writer.write(encoder.encode(command + '\r\n'));
}

/**
 * Handle NNTPS connection test (probe)
 */
export async function handleNNTPSConnect(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as NNTPSConnectRequest;
    const { host, port = 563, timeout = 15000 } = body;

    if (!host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
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

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const startTime = Date.now();

    // Connect with implicit TLS
    const socket = connect(`${host}:${port}`, {
      secureTransport: 'on',
      allowHalfOpen: false,
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const rtt = Date.now() - startTime;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      const buffer = { data: '' };

      // Read welcome banner (200 = posting allowed, 201 = read-only)
      const welcome = await readLine(reader, decoder, buffer, timeoutPromise);
      const welcomeCode = parseInt(welcome.substring(0, 3));

      if (welcomeCode !== 200 && welcomeCode !== 201) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
        return new Response(
          JSON.stringify({
            success: false,
            error: `Server rejected connection: ${welcome}`,
          }),
          { status: 502, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const postingAllowed = welcomeCode === 200;

      // Request capabilities
      let capabilities: string[] = [];
      try {
        await sendCommand(writer, encoder, 'CAPABILITIES');
        const capLine = await readLine(reader, decoder, buffer, timeoutPromise);
        if (capLine.startsWith('101')) {
          capabilities = await readMultiline(reader, decoder, buffer, timeoutPromise);
        }
      } catch {
        // Some servers don't support CAPABILITIES
      }

      // Try MODE READER
      let modeReaderResponse = '';
      try {
        await sendCommand(writer, encoder, 'MODE READER');
        modeReaderResponse = await readLine(reader, decoder, buffer, timeoutPromise);
      } catch {
        // Some servers don't require MODE READER
      }

      // Send QUIT
      try {
        await sendCommand(writer, encoder, 'QUIT');
      } catch {
        // Ignore quit errors
      }

      reader.releaseLock();
      writer.releaseLock();
      socket.close();

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          protocol: 'NNTPS',
          tls: true,
          rtt,
          welcome,
          postingAllowed,
          capabilities,
          modeReader: modeReaderResponse,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle NNTPS GROUP command (select group and list articles over TLS)
 */
export async function handleNNTPSGroup(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as NNTPSGroupRequest;
    const { host, port = 563, group, timeout = 15000 } = body;

    if (!host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!group) {
      return new Response(
        JSON.stringify({ success: false, error: 'Group name is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate group name
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.+-]*$/.test(group)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Group name contains invalid characters' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
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

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    // Connect with implicit TLS
    const socket = connect(`${host}:${port}`, {
      secureTransport: 'on',
      allowHalfOpen: false,
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      const buffer = { data: '' };

      // Read welcome
      const welcome = await readLine(reader, decoder, buffer, timeoutPromise);
      if (!welcome.startsWith('200') && !welcome.startsWith('201')) {
        throw new Error(`Server rejected connection: ${welcome}`);
      }

      // MODE READER
      await sendCommand(writer, encoder, 'MODE READER');
      await readLine(reader, decoder, buffer, timeoutPromise);

      // SELECT GROUP
      await sendCommand(writer, encoder, `GROUP ${group}`);
      const groupResponse = await readLine(reader, decoder, buffer, timeoutPromise);

      if (!groupResponse.startsWith('211')) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();

        const errorMsg = groupResponse.startsWith('411')
          ? `Newsgroup "${group}" not found`
          : `GROUP command failed: ${groupResponse}`;

        return new Response(
          JSON.stringify({ success: false, error: errorMsg }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Parse: 211 count first last group
      const parts = groupResponse.split(' ');
      const count = parseInt(parts[1]) || 0;
      const first = parseInt(parts[2]) || 0;
      const last = parseInt(parts[3]) || 0;

      // Fetch headers for the most recent articles (up to 20)
      const articles: Array<{
        number: number;
        subject: string;
        from: string;
        date: string;
        messageId: string;
        lines: number;
      }> = [];

      if (count > 0) {
        const fetchStart = Math.max(first, last - 19);

        await sendCommand(writer, encoder, `OVER ${fetchStart}-${last}`);
        const overResponse = await readLine(reader, decoder, buffer, timeoutPromise);

        if (overResponse.startsWith('224')) {
          const overLines = await readMultiline(reader, decoder, buffer, timeoutPromise);

          for (const line of overLines) {
            const fields = line.split('\t');
            if (fields.length >= 6) {
              articles.push({
                number: parseInt(fields[0]) || 0,
                subject: fields[1] || '(no subject)',
                from: fields[2] || '(unknown)',
                date: fields[3] || '',
                messageId: fields[4] || '',
                lines: parseInt(fields[7]) || 0,
              });
            }
          }
        }
      }

      // QUIT
      try {
        await sendCommand(writer, encoder, 'QUIT');
      } catch {
        // Ignore
      }

      reader.releaseLock();
      writer.releaseLock();
      socket.close();

      return new Response(
        JSON.stringify({
          success: true,
          group,
          count,
          first,
          last,
          articles: articles.reverse(),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle NNTPS ARTICLE command (retrieve article over TLS)
 */
export async function handleNNTPSArticle(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as NNTPSArticleRequest;
    const { host, port = 563, group, articleNumber, timeout = 15000 } = body;

    if (!host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!group) {
      return new Response(
        JSON.stringify({ success: false, error: 'Group name is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!articleNumber || articleNumber < 1) {
      return new Response(
        JSON.stringify({ success: false, error: 'Valid article number is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate group name
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.+-]*$/.test(group)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Group name contains invalid characters' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
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

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    // Connect with implicit TLS
    const socket = connect(`${host}:${port}`, {
      secureTransport: 'on',
      allowHalfOpen: false,
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      const buffer = { data: '' };

      // Read welcome
      const welcome = await readLine(reader, decoder, buffer, timeoutPromise);
      if (!welcome.startsWith('200') && !welcome.startsWith('201')) {
        throw new Error(`Server rejected connection: ${welcome}`);
      }

      // MODE READER
      await sendCommand(writer, encoder, 'MODE READER');
      await readLine(reader, decoder, buffer, timeoutPromise);

      // SELECT GROUP
      await sendCommand(writer, encoder, `GROUP ${group}`);
      const groupResponse = await readLine(reader, decoder, buffer, timeoutPromise);

      if (!groupResponse.startsWith('211')) {
        throw new Error(`Newsgroup "${group}" not found`);
      }

      // ARTICLE
      await sendCommand(writer, encoder, `ARTICLE ${articleNumber}`);
      const articleResponse = await readLine(reader, decoder, buffer, timeoutPromise);

      if (!articleResponse.startsWith('220')) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();

        const errorMsg = articleResponse.startsWith('423')
          ? `Article ${articleNumber} not found in ${group}`
          : `ARTICLE command failed: ${articleResponse}`;

        return new Response(
          JSON.stringify({ success: false, error: errorMsg }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Read article content (headers + blank line + body)
      const articleLines = await readMultiline(reader, decoder, buffer, timeoutPromise);

      // Split into headers and body
      const headers: Record<string, string> = {};
      let bodyStartIndex = 0;

      for (let i = 0; i < articleLines.length; i++) {
        if (articleLines[i] === '') {
          bodyStartIndex = i + 1;
          break;
        }

        const colonIndex = articleLines[i].indexOf(':');
        if (colonIndex > 0) {
          const key = articleLines[i].substring(0, colonIndex).trim();
          const value = articleLines[i].substring(colonIndex + 1).trim();
          headers[key] = value;
        }
      }

      const articleBody = articleLines.slice(bodyStartIndex).join('\n');

      // Parse message-id
      const msgIdMatch = articleResponse.match(/<([^>]+)>/);
      const messageId = msgIdMatch ? msgIdMatch[1] : '';

      // QUIT
      try {
        await sendCommand(writer, encoder, 'QUIT');
      } catch {
        // Ignore
      }

      reader.releaseLock();
      writer.releaseLock();
      socket.close();

      return new Response(
        JSON.stringify({
          success: true,
          articleNumber,
          messageId,
          headers,
          body: articleBody,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
