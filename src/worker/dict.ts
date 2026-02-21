/**
 * DICT Protocol Implementation (RFC 2229)
 *
 * The DICT protocol provides access to dictionary databases over TCP.
 * It's a text-based protocol for looking up word definitions and
 * finding matching words across multiple dictionaries.
 *
 * Protocol Flow:
 * 1. Client connects to DICT server on port 2628
 * 2. Server sends 220 banner with capabilities
 * 3. Client sends CLIENT identification
 * 4. Client sends commands: DEFINE, MATCH, SHOW DB, SHOW STRAT
 * 5. Server responds with status codes and data
 * 6. Client sends QUIT
 *
 * Response Codes:
 * - 110: n databases present (SHOW DB)
 * - 111: n strategies available (SHOW STRAT)
 * - 150: n definitions retrieved (DEFINE)
 * - 151: definition follows — word db "desc" (DEFINE)
 * - 152: n matches found (MATCH)
 * - 210: (optional) — timing/stat info after command
 * - 220: banner/greeting (connect)
 * - 221: closing connection (QUIT)
 * - 250: ok (command completed)
 * - 330: SASL challenge follows
 * - 420: server temporarily unavailable
 * - 421: server shutting down
 * - 530: access denied
 * - 531: access denied — auth required
 * - 532: access denied — auth mechanism rejected
 * - 550: invalid database
 * - 551: invalid strategy
 * - 552: no match
 * - 554: no databases present
 * - 555: no strategies available
 *
 * Use Cases:
 * - Word definition lookup
 * - Thesaurus queries
 * - Spelling suggestions
 * - Multi-dictionary search
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface DictDefineRequest {
  host?: string;
  port?: number;
  word: string;
  database?: string;
  timeout?: number;
}

interface DictMatchRequest {
  host?: string;
  port?: number;
  word: string;
  database?: string;
  strategy?: string;
  timeout?: number;
}

interface DictDatabasesRequest {
  host?: string;
  port?: number;
  timeout?: number;
}

interface DictDefinition {
  word: string;
  database: string;
  databaseDesc: string;
  text: string;
}

interface DictDefineResponse {
  success: boolean;
  word: string;
  server: string;
  banner?: string;
  definitions: DictDefinition[];
  count: number;
  error?: string;
}

interface DictMatchResponse {
  success: boolean;
  word: string;
  server: string;
  strategy: string;
  matches: { database: string; word: string }[];
  count: number;
  error?: string;
}

interface DictDatabasesResponse {
  success: boolean;
  server: string;
  banner?: string;
  databases: { name: string; description: string }[];
  count: number;
  error?: string;
}

const DEFAULT_HOST = 'dict.org';
const DEFAULT_PORT = 2628;
const MAX_RESPONSE_SIZE = 500000; // 500KB

/**
 * Tracks leftover bytes from TCP reads that arrived in the same chunk as
 * a previous logical message.  Shared across reads within a single session
 * so that data is never silently dropped.
 */
interface ReadBuffer {
  leftover: Uint8Array | null;
}

/**
 * Send a command and read the full response until a terminal status line.
 *
 * Terminal status codes are 2xx, 3xx, 4xx, and 5xx — but NOT the
 * intermediate 1xx codes (110, 111, 150, 151, 152) which precede
 * dot-terminated text bodies.
 */
async function sendCommand(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  command: string,
  timeoutMs: number,
  buf: ReadBuffer
): Promise<string> {
  const encoder = new TextEncoder();
  await writer.write(encoder.encode(`${command}\r\n`));

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let fullText = '';

  // Prepend any leftover bytes from a previous read
  if (buf.leftover) {
    chunks.push(buf.leftover);
    totalBytes += buf.leftover.length;
    buf.leftover = null;
  }

  const deadline = Date.now() + timeoutMs;

  while (true) {
    // Check what we already have before blocking on a read
    if (totalBytes > 0) {
      const combined = new Uint8Array(totalBytes);
      let off = 0;
      for (const chunk of chunks) {
        combined.set(chunk, off);
        off += chunk.length;
      }
      fullText = new TextDecoder().decode(combined);

      // Check if we have a terminal status code line at the end
      // Status codes: 2xx (positive completion), 3xx (positive intermediate
      // for AUTH), 4xx (transient negative), 5xx (permanent negative).
      // 1xx codes (110, 111, 150, 151, 152) are informational/intermediate
      // and precede text bodies — they are NOT terminal.
      const lines = fullText.split('\r\n');
      const lastNonEmpty = lines.filter(l => l.length > 0).pop() || '';

      if (/^[2345]\d\d /.test(lastNonEmpty)) {
        const code = parseInt(lastNonEmpty.substring(0, 3), 10);
        if (code >= 200) {
          break;
        }
      }
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Command timeout');

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Read timeout')), remaining);
    });

    const { value, done } = await Promise.race([
      reader.read(),
      timeoutPromise,
    ]);

    if (done) break;

    if (value) {
      chunks.push(value);
      totalBytes += value.length;

      if (totalBytes > MAX_RESPONSE_SIZE) {
        throw new Error('Response too large');
      }
    }
  }

  return fullText;
}

/**
 * Reverse dot-stuffing per RFC 2229 Section 2.4.1.
 *
 * The DICT protocol uses "dot-stuffing" in text responses: any line that
 * naturally begins with a period has an extra period prepended by the server.
 * The client must strip that leading period when reading.  A lone "." on a
 * line signals end-of-text and is handled separately by callers.
 */
function dotUnstuff(line: string): string {
  if (line.startsWith('..')) {
    return line.substring(1);
  }
  return line;
}

/**
 * Parse definitions from DEFINE response
 *
 * Format:
 * 150 n definitions retrieved
 * 151 "word" dbname "Database Description"
 *   definition text...
 *   .
 * 250 ok
 */
function parseDefinitions(response: string): DictDefinition[] {
  const definitions: DictDefinition[] = [];
  const lines = response.split('\r\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Look for 151 header lines
    if (line.startsWith('151 ')) {
      // Parse: 151 "word" dbname "Database Description"
      const match151 = line.match(/^151\s+"([^"]+)"\s+(\S+)\s+"([^"]*)"/) ||
                        line.match(/^151\s+(\S+)\s+(\S+)\s+"([^"]*)"/);

      const word = match151 ? match151[1] : '';
      const database = match151 ? match151[2] : '';
      const databaseDesc = match151 ? match151[3] : '';

      // Collect definition text until we hit a line that is just "."
      const textLines: string[] = [];
      i++;
      while (i < lines.length) {
        if (lines[i] === '.') {
          i++;
          break;
        }
        // Reverse dot-stuffing (RFC 2229 Section 2.4.1)
        textLines.push(dotUnstuff(lines[i]));
        i++;
      }

      definitions.push({
        word,
        database,
        databaseDesc,
        text: textLines.join('\n'),
      });
    } else {
      i++;
    }
  }

  return definitions;
}

/**
 * Parse matches from MATCH response
 *
 * Format:
 * 152 n matches found
 * dbname "word1"
 * dbname "word2"
 * .
 * 250 ok
 */
function parseMatches(response: string): { database: string; word: string }[] {
  const matches: { database: string; word: string }[] = [];
  const lines = response.split('\r\n');

  let inResults = false;
  for (const rawLine of lines) {
    if (rawLine.startsWith('152 ')) {
      inResults = true;
      continue;
    }

    if (inResults) {
      if (rawLine === '.') {
        inResults = false;
        continue;
      }

      // Reverse dot-stuffing (RFC 2229 Section 2.4.1)
      const line = dotUnstuff(rawLine);

      // Parse: dbname "word" or dbname word
      const matchLine = line.match(/^(\S+)\s+"([^"]+)"/) ||
                         line.match(/^(\S+)\s+(\S+)/);
      if (matchLine) {
        matches.push({
          database: matchLine[1],
          word: matchLine[2],
        });
      }
    }
  }

  return matches;
}

/**
 * Parse databases from SHOW DB response
 *
 * Format:
 * 110 n databases present
 * dbname "Database Description"
 * .
 * 250 ok
 */
function parseDatabases(response: string): { name: string; description: string }[] {
  const databases: { name: string; description: string }[] = [];
  const lines = response.split('\r\n');

  let inResults = false;
  for (const rawLine of lines) {
    if (rawLine.startsWith('110 ') || rawLine.startsWith('111 ')) {
      inResults = true;
      continue;
    }

    if (inResults) {
      if (rawLine === '.') {
        inResults = false;
        continue;
      }

      // Reverse dot-stuffing (RFC 2229 Section 2.4.1)
      const line = dotUnstuff(rawLine);

      const matchLine = line.match(/^(\S+)\s+"([^"]*)"/) ||
                         line.match(/^(\S+)\s+(.*)/);
      if (matchLine) {
        databases.push({
          name: matchLine[1],
          description: matchLine[2],
        });
      }
    }
  }

  return databases;
}

/**
 * Execute a DICT session: connect, send CLIENT, run command, QUIT
 */
async function dictSession(
  host: string,
  port: number,
  command: string,
  timeout: number
): Promise<{ banner: string; response: string }> {
  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  try {
    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // Shared buffer for leftover bytes between reads
    const buf: ReadBuffer = { leftover: null };

    // Read server banner (220 greeting)
    let banner = '';
    const bannerDeadline = Date.now() + timeout;
    const bannerChunks: Uint8Array[] = [];
    let bannerBytes = 0;

    while (true) {
      const remaining = bannerDeadline - Date.now();
      if (remaining <= 0) throw new Error('Banner timeout');

      const bannerTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Banner timeout')), remaining);
      });

      const { value, done } = await Promise.race([
        reader.read(),
        bannerTimeout,
      ]);

      if (done) throw new Error('Connection closed before banner');

      if (value) {
        bannerChunks.push(value);
        bannerBytes += value.length;

        // Combine chunks and check for the first complete line
        const combined = new Uint8Array(bannerBytes);
        let off = 0;
        for (const chunk of bannerChunks) {
          combined.set(chunk, off);
          off += chunk.length;
        }
        const bannerText = new TextDecoder().decode(combined);

        if (bannerText.includes('\r\n')) {
          const crlfIdx = bannerText.indexOf('\r\n');
          const firstLine = bannerText.substring(0, crlfIdx);
          if (firstLine.startsWith('220 ')) {
            banner = firstLine;
            // Preserve any bytes received after the banner line
            const consumed = new TextEncoder().encode(firstLine + '\r\n').length;
            if (consumed < bannerBytes) {
              buf.leftover = combined.slice(consumed);
            }
            break;
          } else {
            throw new Error(`Unexpected server response: ${firstLine.substring(0, 100)}`);
          }
        }
      }
    }

    // Send CLIENT identification (RFC 2229 Section 3.1: CLIENT text — no quotes)
    await sendCommand(writer, reader, 'CLIENT Port of Call DICT Client', timeout, buf);

    // Send the actual command
    const response = await sendCommand(writer, reader, command, timeout, buf);

    // Send QUIT (fire and forget)
    const encoder = new TextEncoder();
    await writer.write(encoder.encode('QUIT\r\n'));

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return { banner, response };
  } catch (error) {
    socket.close();
    throw error;
  }
}

/**
 * Handle DICT DEFINE request - look up word definitions
 */
export async function handleDictDefine(request: Request): Promise<Response> {
  try {
    const body = await request.json() as DictDefineRequest;
    const {
      host = DEFAULT_HOST,
      port = DEFAULT_PORT,
      word,
      database = '*',
      timeout = 15000,
    } = body;

    if (!word) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Word is required',
        word: '',
        server: '',
        definitions: [],
        count: 0,
      } satisfies DictDefineResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate word - only allow safe characters
    if (!/^[a-zA-Z0-9 .'-]+$/.test(word)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Word contains invalid characters',
        word,
        server: '',
        definitions: [],
        count: 0,
      } satisfies DictDefineResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate database name
    if (!/^[a-zA-Z0-9_*!-]+$/.test(database)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid database name',
        word,
        server: '',
        definitions: [],
        count: 0,
      } satisfies DictDefineResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535',
        word,
        server: '',
        definitions: [],
        count: 0,
      } satisfies DictDefineResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
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

    const { banner, response } = await dictSession(
      host, port,
      `DEFINE ${database} "${word}"`,
      timeout
    );

    // Check for error responses
    if (response.startsWith('552 ')) {
      return new Response(JSON.stringify({
        success: true,
        word,
        server: `${host}:${port}`,
        banner,
        definitions: [],
        count: 0,
        error: 'No definitions found',
      } satisfies DictDefineResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (response.startsWith('550 ')) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid database',
        word,
        server: `${host}:${port}`,
        definitions: [],
        count: 0,
      } satisfies DictDefineResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const definitions = parseDefinitions(response);

    return new Response(JSON.stringify({
      success: true,
      word,
      server: `${host}:${port}`,
      banner,
      definitions,
      count: definitions.length,
    } satisfies DictDefineResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      word: '',
      server: '',
      definitions: [],
      count: 0,
    } satisfies DictDefineResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle DICT MATCH request - find matching words
 */
export async function handleDictMatch(request: Request): Promise<Response> {
  try {
    const body = await request.json() as DictMatchRequest;
    const {
      host = DEFAULT_HOST,
      port = DEFAULT_PORT,
      word,
      database = '*',
      strategy = '.',
      timeout = 15000,
    } = body;

    if (!word) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Word is required',
        word: '',
        server: '',
        strategy,
        matches: [],
        count: 0,
      } satisfies DictMatchResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!/^[a-zA-Z0-9 .'-]+$/.test(word)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Word contains invalid characters',
        word,
        server: '',
        strategy,
        matches: [],
        count: 0,
      } satisfies DictMatchResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!/^[a-zA-Z0-9_*!.-]+$/.test(database)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid database name',
        word,
        server: '',
        strategy,
        matches: [],
        count: 0,
      } satisfies DictMatchResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!/^[a-zA-Z0-9_.-]+$/.test(strategy)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid strategy name',
        word,
        server: '',
        strategy,
        matches: [],
        count: 0,
      } satisfies DictMatchResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535',
        word,
        server: '',
        strategy,
        matches: [],
        count: 0,
      } satisfies DictMatchResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
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

    const { response } = await dictSession(
      host, port,
      `MATCH ${database} ${strategy} "${word}"`,
      timeout
    );

    if (response.startsWith('552 ')) {
      return new Response(JSON.stringify({
        success: true,
        word,
        server: `${host}:${port}`,
        strategy,
        matches: [],
        count: 0,
      } satisfies DictMatchResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (response.startsWith('551 ')) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid matching strategy',
        word,
        server: `${host}:${port}`,
        strategy,
        matches: [],
        count: 0,
      } satisfies DictMatchResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const matches = parseMatches(response);

    return new Response(JSON.stringify({
      success: true,
      word,
      server: `${host}:${port}`,
      strategy,
      matches,
      count: matches.length,
    } satisfies DictMatchResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      word: '',
      server: '',
      strategy: '',
      matches: [],
      count: 0,
    } satisfies DictMatchResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle DICT SHOW DB request - list available databases
 */
export async function handleDictDatabases(request: Request): Promise<Response> {
  try {
    const body = await request.json() as DictDatabasesRequest;
    const {
      host = DEFAULT_HOST,
      port = DEFAULT_PORT,
      timeout = 15000,
    } = body;

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535',
        server: '',
        databases: [],
        count: 0,
      } satisfies DictDatabasesResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
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

    const { banner, response } = await dictSession(
      host, port,
      'SHOW DB',
      timeout
    );

    if (response.startsWith('554 ')) {
      return new Response(JSON.stringify({
        success: true,
        server: `${host}:${port}`,
        banner,
        databases: [],
        count: 0,
        error: 'No databases present on server',
      } satisfies DictDatabasesResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const databases = parseDatabases(response);

    return new Response(JSON.stringify({
      success: true,
      server: `${host}:${port}`,
      banner,
      databases,
      count: databases.length,
    } satisfies DictDatabasesResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      server: '',
      databases: [],
      count: 0,
    } satisfies DictDatabasesResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
