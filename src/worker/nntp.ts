/**
 * NNTP Protocol Implementation (RFC 3977)
 *
 * NNTP (Network News Transfer Protocol) enables Usenet newsgroup access.
 * It is a text-based protocol similar to SMTP/POP3, using command/response
 * pairs with numeric status codes.
 *
 * Protocol Flow:
 * 1. Client connects to server port 119
 * 2. Server sends welcome banner (200/201)
 * 3. Client sends MODE READER
 * 4. Client can LIST groups, GROUP select, ARTICLE retrieve, etc.
 * 5. Multiline responses end with ".\r\n" on its own line
 *
 * Use Cases:
 * - Usenet newsgroup browsing
 * - Article reading and posting
 * - News server connectivity testing
 * - Educational protocol demonstration
 */

import { connect } from 'cloudflare:sockets';

interface NNTPConnectRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface NNTPGroupRequest {
  host: string;
  port?: number;
  group: string;
  timeout?: number;
}

interface NNTPArticleRequest {
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
 * Connect to NNTP server and retrieve welcome + capabilities
 */
export async function handleNNTPConnect(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as NNTPConnectRequest;
    const { host, port = 119, timeout = 10000 } = body;

    if (!host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Port must be between 1 and 65535',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const socket = connect(`${host}:${port}`);

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      const buffer = { data: '' };

      // Read welcome banner
      const welcome = await readLine(reader, decoder, buffer, timeoutPromise);
      const welcomeCode = parseInt(welcome.substring(0, 3), 10);

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
          capabilities = await readMultiline(
            reader,
            decoder,
            buffer,
            timeoutPromise
          );
        }
      } catch {
        // Some servers don't support CAPABILITIES
      }

      // Try MODE READER
      let modeReaderResponse = '';
      try {
        await sendCommand(writer, encoder, 'MODE READER');
        modeReaderResponse = await readLine(
          reader,
          decoder,
          buffer,
          timeoutPromise
        );
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
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Select a newsgroup and return its info + recent article headers
 */
export async function handleNNTPGroup(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as NNTPGroupRequest;
    const { host, port = 119, group, timeout = 15000 } = body;

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

    // Validate group name (alphanumeric, dots, hyphens, plus)
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.+-]*$/.test(group)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Group name contains invalid characters',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Port must be between 1 and 65535',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const socket = connect(`${host}:${port}`);

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
      const groupResponse = await readLine(
        reader,
        decoder,
        buffer,
        timeoutPromise
      );

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
      const count = parseInt(parts[1], 10) || 0;
      const first = parseInt(parts[2], 10) || 0;
      const last = parseInt(parts[3], 10) || 0;

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

        // Use OVER for efficient header retrieval
        await sendCommand(
          writer,
          encoder,
          `OVER ${fetchStart}-${last}`
        );
        const overResponse = await readLine(
          reader,
          decoder,
          buffer,
          timeoutPromise
        );

        if (overResponse.startsWith('224')) {
          const overLines = await readMultiline(
            reader,
            decoder,
            buffer,
            timeoutPromise
          );

          for (const line of overLines) {
            // OVER format: number\tsubject\tfrom\tdate\tmessage-id\treferences\tbytes\tlines
            const fields = line.split('\t');
            if (fields.length >= 6) {
              articles.push({
                number: parseInt(fields[0], 10) || 0,
                subject: fields[1] || '(no subject)',
                from: fields[2] || '(unknown)',
                date: fields[3] || '',
                messageId: fields[4] || '',
                lines: parseInt(fields[7], 10) || 0,
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
          articles: articles.reverse(), // Most recent first
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
 * Optionally authenticate with AUTHINFO USER/PASS
 */
async function nntpAuth(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  encoder: TextEncoder,
  buffer: { data: string },
  username: string,
  password: string,
  timeoutPromise: Promise<never>,
): Promise<void> {
  await sendCommand(writer, encoder, `AUTHINFO USER ${username}`);
  const userResponse = await readLine(reader, decoder, buffer, timeoutPromise);
  if (!userResponse.startsWith('381')) {
    throw new Error(`AUTHINFO USER failed: ${userResponse}`);
  }
  await sendCommand(writer, encoder, `AUTHINFO PASS ${password}`);
  const passResponse = await readLine(reader, decoder, buffer, timeoutPromise);
  if (!passResponse.startsWith('281')) {
    throw new Error(`AUTHINFO PASS failed: ${passResponse}`);
  }
}

/**
 * Retrieve a full article by number from a newsgroup
 */
export async function handleNNTPArticle(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as NNTPArticleRequest;
    const { host, port = 119, group, articleNumber, timeout = 15000 } = body;

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
        JSON.stringify({
          success: false,
          error: 'Valid article number is required',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate group name
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.+-]*$/.test(group)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Group name contains invalid characters',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Port must be between 1 and 65535',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const socket = connect(`${host}:${port}`);

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
      const groupResponse = await readLine(
        reader,
        decoder,
        buffer,
        timeoutPromise
      );

      if (!groupResponse.startsWith('211')) {
        throw new Error(`Newsgroup "${group}" not found`);
      }

      // ARTICLE
      await sendCommand(writer, encoder, `ARTICLE ${articleNumber}`);
      const articleResponse = await readLine(
        reader,
        decoder,
        buffer,
        timeoutPromise
      );

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
      const articleLines = await readMultiline(
        reader,
        decoder,
        buffer,
        timeoutPromise
      );

      // Split into headers and body at the first blank line
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

      const body = articleLines.slice(bodyStartIndex).join('\n');

      // Parse message-id from the response line
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
          body,
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

interface NNTPListRequest {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  variant?: 'ACTIVE' | 'NEWSGROUPS' | 'OVERVIEW.FMT';
  timeout?: number;
}

interface NNTPPostRequest {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  from: string;
  newsgroups: string;
  subject: string;
  body: string;
  timeout?: number;
}

interface NNTPAuthRequest {
  host: string;
  port?: number;
  username: string;
  password: string;
  timeout?: number;
}

/**
 * List newsgroups on a server (LIST ACTIVE / LIST NEWSGROUPS / LIST OVERVIEW.FMT)
 */
export async function handleNNTPList(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as NNTPListRequest;
    const { host, port = 119, username, password, variant = 'ACTIVE', timeout = 15000 } = body;

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

    const validVariants = ['ACTIVE', 'NEWSGROUPS', 'OVERVIEW.FMT'];
    if (!validVariants.includes(variant)) {
      return new Response(
        JSON.stringify({ success: false, error: `variant must be one of: ${validVariants.join(', ')}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

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

      // Optionally authenticate
      if (username && password) {
        await nntpAuth(writer, reader, decoder, encoder, buffer, username, password, timeoutPromise);
      }

      // Send LIST command
      await sendCommand(writer, encoder, `LIST ${variant}`);
      const listResponseLine = await readLine(reader, decoder, buffer, timeoutPromise);

      if (!listResponseLine.startsWith('215')) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
        return new Response(
          JSON.stringify({ success: false, error: `LIST failed: ${listResponseLine}` }),
          { status: 502, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const allLines = await readMultiline(reader, decoder, buffer, timeoutPromise);
      const rtt = Date.now() - startTime;

      try {
        await sendCommand(writer, encoder, 'QUIT');
      } catch { /* ignore */ }
      reader.releaseLock();
      writer.releaseLock();
      socket.close();

      const truncated = allLines.length > 500;
      const lines = truncated ? allLines.slice(0, 500) : allLines;

      type GroupEntry = { name: string; first?: number; last?: number; flag?: string; description?: string };
      const groups: GroupEntry[] = lines.map((line) => {
        if (variant === 'ACTIVE') {
          // <group> <last> <first> <flag>
          const parts = line.split(' ');
          return {
            name: parts[0] || line,
            last: parts[1] ? parseInt(parts[1], 10) : undefined,
            first: parts[2] ? parseInt(parts[2], 10) : undefined,
            flag: parts[3] || undefined,
          };
        } else if (variant === 'NEWSGROUPS') {
          // <group> <description>
          const spaceIdx = line.indexOf(' ');
          return {
            name: spaceIdx > 0 ? line.substring(0, spaceIdx) : line,
            description: spaceIdx > 0 ? line.substring(spaceIdx + 1).trim() : '',
          };
        } else {
          // OVERVIEW.FMT — just field names
          return { name: line };
        }
      });

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          variant,
          groupCount: groups.length,
          groups,
          truncated,
          rtt,
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
 * Post an article to a newsgroup
 */
export async function handleNNTPPost(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as NNTPPostRequest;
    const { host, port = 119, username, password, from, newsgroups, subject, body: articleBody, timeout = 15000 } = body;

    if (!host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!from || !newsgroups || !subject || !articleBody) {
      return new Response(
        JSON.stringify({ success: false, error: 'from, newsgroups, subject, and body are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

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

      // Optionally authenticate
      if (username && password) {
        await nntpAuth(writer, reader, decoder, encoder, buffer, username, password, timeoutPromise);
      }

      // Send POST command
      await sendCommand(writer, encoder, 'POST');
      const postResponseLine = await readLine(reader, decoder, buffer, timeoutPromise);

      if (postResponseLine.startsWith('440')) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
        return new Response(
          JSON.stringify({ success: false, host, port, message: 'Posting not allowed on this server' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (!postResponseLine.startsWith('340')) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
        return new Response(
          JSON.stringify({ success: false, host, port, message: `POST command failed: ${postResponseLine}` }),
          { status: 502, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Dot-stuffing (RFC 3977 §3.1.1): any line in the body starting
      // with "." must have an extra "." prepended so the server doesn't
      // mistake it for the end-of-data marker ".\r\n".
      const stuffedBody = articleBody.replace(/^\./gm, '..');

      // Send article headers + body terminated by "\r\n.\r\n"
      const article = `From: ${from}\r\nNewsgroups: ${newsgroups}\r\nSubject: ${subject}\r\n\r\n${stuffedBody}\r\n.\r\n`;
      await writer.write(encoder.encode(article));

      const articleResponseLine = await readLine(reader, decoder, buffer, timeoutPromise);
      const rtt = Date.now() - startTime;

      try {
        await sendCommand(writer, encoder, 'QUIT');
      } catch { /* ignore */ }
      reader.releaseLock();
      writer.releaseLock();
      socket.close();

      if (!articleResponseLine.startsWith('240')) {
        return new Response(
          JSON.stringify({ success: false, host, port, message: articleResponseLine, rtt }),
          { status: 502, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Try to extract article-id from the 240 response line
      const articleIdMatch = articleResponseLine.match(/<([^>]+)>/);
      const articleId = articleIdMatch ? articleIdMatch[1] : undefined;

      return new Response(
        JSON.stringify({ success: true, host, port, articleId, message: articleResponseLine, rtt }),
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
 * Test AUTHINFO USER/PASS authentication against an NNTP server
 */
export async function handleNNTPAuth(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as NNTPAuthRequest;
    const { host, port = 119, username, password, timeout = 10000 } = body;

    if (!host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!username || !password) {
      return new Response(
        JSON.stringify({ success: false, error: 'username and password are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

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

      // Send AUTHINFO USER
      await sendCommand(writer, encoder, `AUTHINFO USER ${username}`);
      const userResponse = await readLine(reader, decoder, buffer, timeoutPromise);

      if (!userResponse.startsWith('381')) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
        return new Response(
          JSON.stringify({ success: false, host, port, authenticated: false, message: userResponse }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Send AUTHINFO PASS
      await sendCommand(writer, encoder, `AUTHINFO PASS ${password}`);
      const passResponse = await readLine(reader, decoder, buffer, timeoutPromise);
      const rtt = Date.now() - startTime;

      const authenticated = passResponse.startsWith('281');

      try {
        await sendCommand(writer, encoder, 'QUIT');
      } catch { /* ignore */ }
      reader.releaseLock();
      writer.releaseLock();
      socket.close();

      return new Response(
        JSON.stringify({ success: true, host, port, authenticated, message: passResponse, rtt }),
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
