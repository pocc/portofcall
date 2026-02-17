/**
 * PostgreSQL Protocol Support for Cloudflare Workers
 * Full authentication (cleartext + MD5) and query execution.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PostgreSQLConnectionOptions {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  timeout?: number;
}

export interface PostgreSQLQueryOptions {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  query: string;
  timeout?: number;
}

export interface QueryResult {
  columns: string[];
  rows: (string | null)[][];
  commandTag: string;
  rowCount: number;
}

// ---------------------------------------------------------------------------
// Pure-JS MD5 (RFC 1321) — Web Crypto does not support MD5
// ---------------------------------------------------------------------------

function md5(input: string | Uint8Array): string {
  const msg: Uint8Array =
    typeof input === 'string' ? new TextEncoder().encode(input) : input;

  // Initial hash values
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  // Pre-processing: adding padding bits
  const origLen = msg.length;
  const paddedLen = Math.ceil((origLen + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(msg);
  padded[origLen] = 0x80;
  // Append original length in bits as 64-bit LE
  const bitLen = origLen * 8;
  padded[paddedLen - 8] = bitLen & 0xff;
  padded[paddedLen - 7] = (bitLen >>> 8) & 0xff;
  padded[paddedLen - 6] = (bitLen >>> 16) & 0xff;
  padded[paddedLen - 5] = (bitLen >>> 24) & 0xff;
  // upper 32 bits always 0 for inputs < 512 MB

  // Per-round shift amounts
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  // Precomputed table: K[i] = floor(abs(sin(i+1)) * 2^32)
  const K = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
    0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
    0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
    0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
    0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
    0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ];

  const view = new DataView(padded.buffer);

  for (let i = 0; i < paddedLen; i += 64) {
    const M: number[] = [];
    for (let j = 0; j < 16; j++) {
      M.push(view.getUint32(i + j * 4, true /* little-endian */));
    }

    let A = a0, B = b0, C = c0, D = d0;

    for (let j = 0; j < 64; j++) {
      let F: number;
      let g: number;
      if (j < 16) {
        F = (B & C) | (~B & D);
        g = j;
      } else if (j < 32) {
        F = (D & B) | (~D & C);
        g = (5 * j + 1) % 16;
      } else if (j < 48) {
        F = B ^ C ^ D;
        g = (3 * j + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * j) % 16;
      }
      F = (F + A + K[j] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      const rot = S[j];
      B = (((F << rot) | (F >>> (32 - rot))) + B) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  // Output as lowercase hex string (little-endian per word)
  const toLE = (n: number) => {
    const b = new Uint8Array(4);
    b[0] = n & 0xff;
    b[1] = (n >>> 8) & 0xff;
    b[2] = (n >>> 16) & 0xff;
    b[3] = (n >>> 24) & 0xff;
    return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
  };

  return toLE(a0) + toLE(b0) + toLE(c0) + toLE(d0);
}

// ---------------------------------------------------------------------------
// PGReader — buffers TCP chunks, reads complete PostgreSQL messages
// ---------------------------------------------------------------------------

class PGReader {
  private buffer: Uint8Array = new Uint8Array(0);
  private reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(readable: ReadableStream<Uint8Array>) {
    this.reader = readable.getReader();
  }

  /** Append incoming bytes to the internal buffer. */
  private append(chunk: Uint8Array): void {
    const next = new Uint8Array(this.buffer.length + chunk.length);
    next.set(this.buffer);
    next.set(chunk, this.buffer.length);
    this.buffer = next;
  }

  /** Ensure at least `n` bytes are available, reading from the socket as needed. */
  private async ensure(n: number): Promise<void> {
    while (this.buffer.length < n) {
      const { done, value } = await this.reader.read();
      if (done) throw new Error('Connection closed unexpectedly');
      this.append(value);
    }
  }

  /**
   * Read one complete PostgreSQL message.
   * Returns { type, payload } where type is the single-byte message code
   * and payload is the body (everything after the 5-byte header).
   */
  async readMessage(): Promise<{ type: string; payload: Uint8Array }> {
    // Every backend message: [type 1B][length 4B BE]
    await this.ensure(5);
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset);
    const type = String.fromCharCode(this.buffer[0]);
    const length = view.getUint32(1, false /* big-endian */);
    // length includes the 4-byte length field itself but not the type byte
    const total = 1 + length;
    await this.ensure(total);
    const payload = this.buffer.slice(5, total);
    this.buffer = this.buffer.slice(total);
    return { type, payload };
  }

  release(): void {
    this.reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Message builders
// ---------------------------------------------------------------------------

/** Startup message (no type byte — it's the very first message). */
function buildStartupMessage(username: string, database: string): Uint8Array {
  const enc = new TextEncoder();
  const params: Uint8Array[] = [
    enc.encode('user\0'),
    enc.encode(username + '\0'),
    enc.encode('database\0'),
    enc.encode(database + '\0'),
  ];
  const paramTotal = params.reduce((s, p) => s + p.length, 0);
  // 4 (length) + 4 (protocol) + params + 1 (trailing NUL)
  const total = 4 + 4 + paramTotal + 1;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  view.setUint32(0, total, false);           // length (includes itself)
  view.setUint32(4, 0x00030000, false);       // protocol 3.0
  let offset = 8;
  for (const p of params) {
    buf.set(p, offset);
    offset += p.length;
  }
  buf[offset] = 0x00; // terminating NUL
  return buf;
}

/** Generic backend message: [type 1B][length 4B BE][payload]. */
function buildMessage(type: string, payload: Uint8Array): Uint8Array {
  const buf = new Uint8Array(1 + 4 + payload.length);
  const view = new DataView(buf.buffer);
  buf[0] = type.charCodeAt(0);
  view.setUint32(1, 4 + payload.length, false); // length includes itself
  buf.set(payload, 5);
  return buf;
}

/** PasswordMessage for cleartext auth (type 3). */
function buildPasswordMessage(password: string): Uint8Array {
  const enc = new TextEncoder();
  const pw = enc.encode(password + '\0');
  return buildMessage('p', pw);
}

/**
 * PasswordMessage for MD5 auth (type 5).
 * Formula: "md5" + md5( md5(password + username) + salt )
 * The salt is 4 raw bytes (not hex-encoded).
 */
function buildMD5PasswordMessage(
  password: string,
  username: string,
  salt: Uint8Array,
): Uint8Array {
  const inner = md5(password + username);          // hex string
  // Concatenate the hex string with the raw salt bytes
  const enc = new TextEncoder();
  const innerBytes = enc.encode(inner);
  const toHash = new Uint8Array(innerBytes.length + salt.length);
  toHash.set(innerBytes);
  toHash.set(salt, innerBytes.length);
  const outer = md5(toHash);                       // hex string
  const response = enc.encode('md5' + outer + '\0');
  return buildMessage('p', response);
}

/** Simple Query message ('Q'). */
function buildQueryMessage(query: string): Uint8Array {
  const enc = new TextEncoder();
  const q = enc.encode(query + '\0');
  return buildMessage('Q', q);
}

// ---------------------------------------------------------------------------
// Error response parser
// ---------------------------------------------------------------------------

function parseErrorResponse(payload: Uint8Array): { message: string; detail: string } {
  let message = '';
  let detail = '';
  const dec = new TextDecoder();
  let i = 0;
  while (i < payload.length) {
    const fieldType = String.fromCharCode(payload[i]);
    i++;
    if (fieldType === '\0') break;
    // Find the NUL terminator for the value
    let end = i;
    while (end < payload.length && payload[end] !== 0) end++;
    const value = dec.decode(payload.slice(i, end));
    i = end + 1;
    if (fieldType === 'M') message = value;
    if (fieldType === 'D') detail = value;
  }
  return { message, detail };
}

// ---------------------------------------------------------------------------
// connectAndAuthenticate
// ---------------------------------------------------------------------------

interface AuthResult {
  socket: ReturnType<typeof connect>;
  reader: PGReader;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  serverVersion: string;
}

async function connectAndAuthenticate(
  host: string,
  port: number,
  username: string,
  password: string,
  database: string,
): Promise<AuthResult> {
  const socket = connect(`${host}:${port}`);
  await socket.opened;

  const writer = socket.writable.getWriter();
  const reader = new PGReader(socket.readable);

  try {
    // Send startup message
    await writer.write(buildStartupMessage(username, database));

    // Authentication exchange
    const authMsg = await reader.readMessage();
    if (authMsg.type !== 'R') {
      const err = authMsg.type === 'E'
        ? parseErrorResponse(authMsg.payload)
        : { message: `Unexpected message type: ${authMsg.type}`, detail: '' };
      throw new Error(`Auth failed: ${err.message}${err.detail ? ` — ${err.detail}` : ''}`);
    }

    const authView = new DataView(authMsg.payload.buffer, authMsg.payload.byteOffset);
    const authType = authView.getInt32(0, false);

    if (authType === 0) {
      // AuthenticationOk — no password needed
    } else if (authType === 3) {
      // CleartextPassword
      await writer.write(buildPasswordMessage(password));
      const ok = await reader.readMessage();
      if (ok.type !== 'R') {
        if (ok.type === 'E') {
          const err = parseErrorResponse(ok.payload);
          throw new Error(`Auth failed: ${err.message}${err.detail ? ` — ${err.detail}` : ''}`);
        }
        throw new Error(`Unexpected message after cleartext password: ${ok.type}`);
      }
      const okView = new DataView(ok.payload.buffer, ok.payload.byteOffset);
      if (okView.getInt32(0, false) !== 0) {
        throw new Error('Expected AuthenticationOk after password');
      }
    } else if (authType === 5) {
      // MD5Password — 4-byte salt immediately follows the auth type
      const salt = authMsg.payload.slice(4, 8);
      await writer.write(buildMD5PasswordMessage(password, username, salt));
      const ok = await reader.readMessage();
      if (ok.type !== 'R') {
        if (ok.type === 'E') {
          const err = parseErrorResponse(ok.payload);
          throw new Error(`Auth failed: ${err.message}${err.detail ? ` — ${err.detail}` : ''}`);
        }
        throw new Error(`Unexpected message after MD5 password: ${ok.type}`);
      }
      const okView = new DataView(ok.payload.buffer, ok.payload.byteOffset);
      if (okView.getInt32(0, false) !== 0) {
        throw new Error('Expected AuthenticationOk after MD5 password');
      }
    } else {
      throw new Error(`Unsupported authentication type: ${authType}`);
    }

    // Drain ParameterStatus (S), BackendKeyData (K), ReadyForQuery (Z)
    const dec = new TextDecoder();
    let serverVersion = '';

    while (true) {
      const msg = await reader.readMessage();
      if (msg.type === 'S') {
        // ParameterStatus: key\0value\0
        let i = 0;
        while (i < msg.payload.length && msg.payload[i] !== 0) i++;
        const key = dec.decode(msg.payload.slice(0, i));
        i++; // skip NUL
        let j = i;
        while (j < msg.payload.length && msg.payload[j] !== 0) j++;
        const value = dec.decode(msg.payload.slice(i, j));
        if (key === 'server_version') serverVersion = value;
      } else if (msg.type === 'K') {
        // BackendKeyData (process ID + secret key) — ignore
      } else if (msg.type === 'Z') {
        // ReadyForQuery — auth complete
        break;
      } else if (msg.type === 'E') {
        const err = parseErrorResponse(msg.payload);
        throw new Error(`Server error during startup: ${err.message}${err.detail ? ` — ${err.detail}` : ''}`);
      }
      // Any other message types during startup are silently ignored
    }

    return { socket, reader, writer, serverVersion };
  } catch (err) {
    reader.release();
    writer.releaseLock();
    try { await socket.close(); } catch { /* ignore */ }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// executeQuery
// ---------------------------------------------------------------------------

async function executeQuery(
  reader: PGReader,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  query: string,
): Promise<QueryResult> {
  await writer.write(buildQueryMessage(query));

  const dec = new TextDecoder();
  let columns: string[] = [];
  const rows: (string | null)[][] = [];
  let commandTag = '';

  while (true) {
    const msg = await reader.readMessage();

    if (msg.type === 'T') {
      // RowDescription
      const view = new DataView(msg.payload.buffer, msg.payload.byteOffset);
      const colCount = view.getInt16(0, false);
      let offset = 2;
      columns = [];
      for (let i = 0; i < colCount; i++) {
        // Column name is NUL-terminated
        let end = offset;
        while (end < msg.payload.length && msg.payload[end] !== 0) end++;
        columns.push(dec.decode(msg.payload.slice(offset, end)));
        // Skip past NUL + 18 bytes of metadata (tableOID 4, colAttr 2, typeOID 4, typeSize 2, typeMod 4, format 2)
        offset = end + 1 + 18;
      }
    } else if (msg.type === 'D') {
      // DataRow
      const view = new DataView(msg.payload.buffer, msg.payload.byteOffset);
      const colCount = view.getInt16(0, false);
      let offset = 2;
      const row: (string | null)[] = [];
      for (let i = 0; i < colCount; i++) {
        const colLen = view.getInt32(offset, false);
        offset += 4;
        if (colLen === -1) {
          row.push(null);
        } else {
          row.push(dec.decode(msg.payload.slice(offset, offset + colLen)));
          offset += colLen;
        }
      }
      rows.push(row);
    } else if (msg.type === 'C') {
      // CommandComplete: NUL-terminated command tag
      let end = 0;
      while (end < msg.payload.length && msg.payload[end] !== 0) end++;
      commandTag = dec.decode(msg.payload.slice(0, end));
    } else if (msg.type === 'Z') {
      // ReadyForQuery — query cycle complete
      break;
    } else if (msg.type === 'E') {
      const err = parseErrorResponse(msg.payload);
      throw new Error(`Query error: ${err.message}${err.detail ? ` — ${err.detail}` : ''}`);
    } else if (msg.type === 'I') {
      // EmptyQueryResponse — treat as CommandComplete with empty tag
      commandTag = '';
    }
    // NoticeResponse ('N') and others are silently ignored
  }

  return { columns, rows, commandTag, rowCount: rows.length };
}

// ---------------------------------------------------------------------------
// handlePostgreSQLConnect — existing public API, now does real auth
// ---------------------------------------------------------------------------

export async function handlePostgreSQLConnect(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let options: Partial<PostgreSQLConnectionOptions>;

    if (request.method === 'POST') {
      options = (await request.json()) as Partial<PostgreSQLConnectionOptions>;
    } else {
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '5432'),
        username: url.searchParams.get('username') || undefined,
        password: url.searchParams.get('password') || undefined,
        database: url.searchParams.get('database') || undefined,
        timeout: parseInt(url.searchParams.get('timeout') || '30000'),
      };
    }

    if (!options.host) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameter: host' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const host = options.host;
    const port = options.port || 5432;
    const username = options.username || 'postgres';
    const password = options.password || '';
    const database = options.database || username;
    const timeoutMs = options.timeout || 30000;

    // Cloudflare-behind-Cloudflare guard
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const connectionPromise = (async () => {
      const { socket, reader, writer, serverVersion } = await connectAndAuthenticate(
        host, port, username, password, database,
      );

      // Clean disconnect
      reader.release();
      writer.releaseLock();
      try { await socket.close(); } catch { /* ignore */ }

      return {
        success: true,
        message: 'PostgreSQL authentication successful',
        host,
        port,
        username,
        database,
        serverVersion,
      };
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs),
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          success: false,
          error: err instanceof Error ? err.message : 'Connection failed',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

// ---------------------------------------------------------------------------
// handlePostgreSQLQuery — new export
// ---------------------------------------------------------------------------

export async function handlePostgreSQLQuery(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let options: Partial<PostgreSQLQueryOptions>;

    if (request.method === 'POST') {
      options = (await request.json()) as Partial<PostgreSQLQueryOptions>;
    } else {
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '5432'),
        username: url.searchParams.get('username') || undefined,
        password: url.searchParams.get('password') || undefined,
        database: url.searchParams.get('database') || undefined,
        query: url.searchParams.get('query') || '',
        timeout: parseInt(url.searchParams.get('timeout') || '30000'),
      };
    }

    if (!options.host) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameter: host' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (!options.query) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameter: query' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const host = options.host;
    const port = options.port || 5432;
    const username = options.username || 'postgres';
    const password = options.password || '';
    const database = options.database || username;
    const query = options.query;
    const timeoutMs = options.timeout || 30000;

    // Cloudflare-behind-Cloudflare guard
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const queryPromise = (async () => {
      const { socket, reader, writer, serverVersion } = await connectAndAuthenticate(
        host, port, username, password, database,
      );

      let result: QueryResult;
      try {
        result = await executeQuery(reader, writer, query);
      } finally {
        reader.release();
        writer.releaseLock();
        try { await socket.close(); } catch { /* ignore */ }
      }

      return {
        success: true,
        host,
        port,
        username,
        database,
        serverVersion,
        ...result,
      };
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs),
    );

    try {
      const result = await Promise.race([queryPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          success: false,
          error: err instanceof Error ? err.message : 'Query failed',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Query failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
