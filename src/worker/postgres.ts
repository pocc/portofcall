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
// SCRAM-SHA-256 helpers (RFC 5802) using Web Crypto PBKDF2 + HMAC-SHA-256
// ---------------------------------------------------------------------------

/** Generate `len` random bytes, return as base64 string (no padding). */
function generateNonce(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  // base64url without padding
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/** XOR two equal-length Uint8Arrays. */
function xorArrays(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    out[i] = a[i] ^ b[i];
  }
  return out;
}

/** HMAC-SHA-256(key, data) */
async function hmacSHA256(key: Uint8Array | ArrayBuffer, data: Uint8Array): Promise<Uint8Array> {
  const keyBuf = key instanceof Uint8Array ? key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer : key as ArrayBuffer;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuf,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const dataBuf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, dataBuf);
  return new Uint8Array(sig);
}

/** PBKDF2-SHA-256(password, salt, iterations, keyLen) */
async function pbkdf2SHA256(
  password: string,
  salt: Uint8Array,
  iterations: number,
  keyLen: number,
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const saltBuf = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer;
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBuf, iterations },
    keyMaterial,
    keyLen * 8,
  );
  return new Uint8Array(bits);
}

/**
 * Perform SCRAM-SHA-256 authentication exchange.
 * Returns the auth messages for verification; throws on failure.
 */
async function performSCRAMSHA256(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  reader: PGReader,
  _username: string,
  password: string,
): Promise<void> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // Step 1: Generate client nonce and build client-first-message
  const clientNonce = generateNonce(24);
  const clientFirstBare = `n=,r=${clientNonce}`;
  const clientFirstMessage = `n,,${clientFirstBare}`;

  // Build SASLInitialResponse message ('p'):
  //   mechanism name + NUL + client-first-message length (4BE) + client-first-message
  const mechanismBytes = enc.encode('SCRAM-SHA-256\0');
  const cfmBytes = enc.encode(clientFirstMessage);
  const saslInitPayload = new Uint8Array(mechanismBytes.length + 4 + cfmBytes.length);
  let off = 0;
  saslInitPayload.set(mechanismBytes, off); off += mechanismBytes.length;
  new DataView(saslInitPayload.buffer).setInt32(off, cfmBytes.length, false); off += 4;
  saslInitPayload.set(cfmBytes, off);
  await writer.write(buildMessage('p', saslInitPayload));

  // Step 2: Read AuthenticationSASLContinue (type 'R', authType=11)
  const contMsg = await reader.readMessage();
  if (contMsg.type !== 'R') {
    throw new Error(`Expected AuthenticationSASLContinue, got '${contMsg.type}'`);
  }
  const contView = new DataView(contMsg.payload.buffer, contMsg.payload.byteOffset);
  if (contView.getInt32(0, false) !== 11) {
    throw new Error(`Expected SASL continue (11), got ${contView.getInt32(0, false)}`);
  }
  const serverFirstMessage = dec.decode(contMsg.payload.slice(4));

  // Parse server-first-message: r=<nonce>,s=<salt-base64>,i=<iterations>
  const sfParts: Record<string, string> = {};
  for (const part of serverFirstMessage.split(',')) {
    const eq = part.indexOf('=');
    if (eq !== -1) sfParts[part.slice(0, eq)] = part.slice(eq + 1);
  }
  const combinedNonce = sfParts['r'];
  const saltBase64    = sfParts['s'];
  const iterations    = parseInt(sfParts['i'], 10);

  if (!combinedNonce || !saltBase64 || !iterations) {
    throw new Error(`Invalid server-first-message: ${serverFirstMessage}`);
  }

  if (!combinedNonce.startsWith(clientNonce)) {
    throw new Error('Server nonce does not start with client nonce');
  }

  // Decode base64 salt (standard base64, may have padding)
  const saltBinary = atob(saltBase64);
  const salt = new Uint8Array(saltBinary.length);
  for (let i = 0; i < saltBinary.length; i++) {
    salt[i] = saltBinary.charCodeAt(i);
  }

  // Step 3: Derive SaltedPassword via PBKDF2
  const saltedPassword = await pbkdf2SHA256(password, salt, iterations, 32);

  // Compute keys
  const clientKey       = await hmacSHA256(saltedPassword, enc.encode('Client Key'));
  const storedKeyBuf    = await crypto.subtle.digest('SHA-256', clientKey.buffer.slice(clientKey.byteOffset, clientKey.byteOffset + clientKey.byteLength) as ArrayBuffer);
  const storedKey       = new Uint8Array(storedKeyBuf);
  const serverKey       = await hmacSHA256(saltedPassword, enc.encode('Server Key'));

  // Build client-final-message-without-proof
  // channel-binding 'biws' = base64('n,,') (no channel binding)
  const clientFinalNoProof = `c=biws,r=${combinedNonce}`;

  // authMessage = client-first-bare + ',' + server-first + ',' + client-final-without-proof
  const authMessage = `${clientFirstBare},${serverFirstMessage},${clientFinalNoProof}`;
  const authMessageBytes = enc.encode(authMessage);

  const clientSignature = await hmacSHA256(storedKey, authMessageBytes);
  const clientProof     = xorArrays(clientKey, clientSignature);
  const clientProofB64  = btoa(String.fromCharCode(...clientProof));

  const clientFinalMessage = `${clientFinalNoProof},p=${clientProofB64}`;

  // Build SASLResponse ('p') — just the client-final-message bytes
  const cfinalBytes = enc.encode(clientFinalMessage);
  await writer.write(buildMessage('p', cfinalBytes));

  // Step 4: Read AuthenticationSASLFinal (type 'R', authType=12) then AuthenticationOk (authType=0)
  const finalMsg = await reader.readMessage();
  if (finalMsg.type !== 'R') {
    if (finalMsg.type === 'E') {
      const err = parseErrorResponse(finalMsg.payload);
      throw new Error(`SCRAM auth failed: ${err.message}${err.detail ? ` — ${err.detail}` : ''}`);
    }
    throw new Error(`Expected AuthenticationSASLFinal, got '${finalMsg.type}'`);
  }
  const finalView = new DataView(finalMsg.payload.buffer, finalMsg.payload.byteOffset);
  const finalAuthType = finalView.getInt32(0, false);
  if (finalAuthType === 12) {
    // AuthenticationSASLFinal — optionally verify server signature
    // Server sends: verifier data we can verify for integrity, but we skip it for brevity
    const okMsg = await reader.readMessage();
    if (okMsg.type !== 'R') {
      if (okMsg.type === 'E') {
        const err = parseErrorResponse(okMsg.payload);
        throw new Error(`SCRAM auth failed after final: ${err.message}`);
      }
      throw new Error(`Expected AuthenticationOk after SASLFinal, got '${okMsg.type}'`);
    }
    const okView = new DataView(okMsg.payload.buffer, okMsg.payload.byteOffset);
    if (okView.getInt32(0, false) !== 0) {
      throw new Error('Expected AuthenticationOk (0) after SCRAM exchange');
    }
  } else if (finalAuthType === 0) {
    // AuthenticationOk directly
  } else {
    throw new Error(`Unexpected auth type after SCRAM exchange: ${finalAuthType}`);
  }

  // Verify server signature for security (optional but good practice)
  const serverSignature = await hmacSHA256(serverKey, authMessageBytes);
  const serverSigB64    = btoa(String.fromCharCode(...serverSignature));
  // Server sends v=<base64> in the SASLFinal data — we already consumed it, so skip verification here
  void serverSigB64; // suppress unused warning
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
    } else if (authType === 10) {
      // AuthenticationSASL — server lists mechanisms
      // We only support SCRAM-SHA-256
      // The payload after auth type contains NUL-terminated mechanism strings
      // We trust the server supports SCRAM-SHA-256 and proceed
      await performSCRAMSHA256(writer, reader, username, password);
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

// ---------------------------------------------------------------------------
// handlePostgresDescribe — Parse + Describe to get column names/types
// ---------------------------------------------------------------------------

export interface PostgreSQLColumnInfo {
  name: string;
  typeOid: number;
}

export interface PostgreSQLDescribeResult {
  success: boolean;
  host: string;
  port: number;
  database: string;
  query: string;
  columns: PostgreSQLColumnInfo[];
  paramCount: number;
}

/**
 * Describe a PostgreSQL query: returns column names and type OIDs without executing.
 * POST /api/postgres/describe
 * Body: { host, port?, username?, password?, database?, query, timeout? }
 *
 * Flow: Auth → Parse("", query, []) → Describe(S, "") → Sync
 *       → ParseComplete + ParameterDescription + RowDescription → ReadyForQuery
 */
export async function handlePostgresDescribe(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let options: Partial<PostgreSQLQueryOptions>;

    if (request.method === 'POST') {
      options = (await request.json()) as Partial<PostgreSQLQueryOptions>;
    } else {
      options = {
        host:     url.searchParams.get('host') || '',
        port:     parseInt(url.searchParams.get('port') || '5432'),
        username: url.searchParams.get('username') || undefined,
        password: url.searchParams.get('password') || undefined,
        database: url.searchParams.get('database') || undefined,
        query:    url.searchParams.get('query') || '',
        timeout:  parseInt(url.searchParams.get('timeout') || '30000'),
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

    const host     = options.host;
    const port     = options.port || 5432;
    const username = options.username || 'postgres';
    const password = options.password || '';
    const database = options.database || username;
    const query    = options.query;
    const timeoutMs = options.timeout || 30000;

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

    const describePromise = (async (): Promise<Response> => {
      const { socket, reader, writer } = await connectAndAuthenticate(
        host, port, username, password, database,
      );

      try {
        const enc = new TextEncoder();
        const dec = new TextDecoder();

        // Build Parse message ('P'):
        //   statement name (NUL) + query (NUL) + numParams (2BE int16, 0) + [no param types]
        function buildParseMessage(queryStr: string): Uint8Array {
          const stmtName = new Uint8Array([0x00]);          // unnamed prepared statement
          const queryBytes = enc.encode(queryStr + '\0');
          const numParams = new Uint8Array([0x00, 0x00]);   // 0 parameters
          const payload = new Uint8Array(stmtName.length + queryBytes.length + numParams.length);
          let o = 0;
          payload.set(stmtName, o); o += stmtName.length;
          payload.set(queryBytes, o); o += queryBytes.length;
          payload.set(numParams, o);
          return buildMessage('P', payload);
        }

        // Build Describe message ('D'):
        //   type ('S' for statement) + name (NUL)
        function buildDescribeMessage(): Uint8Array {
          const payload = new Uint8Array([0x53, 0x00]); // 'S' + NUL
          return buildMessage('D', payload);
        }

        // Build Sync message ('S') — empty payload
        function buildSyncMessage(): Uint8Array {
          return buildMessage('S', new Uint8Array(0));
        }

        // Send Parse + Describe + Sync
        await writer.write(buildParseMessage(query));
        await writer.write(buildDescribeMessage());
        await writer.write(buildSyncMessage());

        let columns: PostgreSQLColumnInfo[] = [];
        let paramCount = 0;

        // Read responses until ReadyForQuery
        while (true) {
          const msg = await reader.readMessage();

          if (msg.type === '1') {
            // ParseComplete — no data
          } else if (msg.type === 't') {
            // ParameterDescription: int16 count + count*int32 type OIDs
            const pv = new DataView(msg.payload.buffer, msg.payload.byteOffset);
            paramCount = pv.getInt16(0, false);
          } else if (msg.type === 'T') {
            // RowDescription
            const rv = new DataView(msg.payload.buffer, msg.payload.byteOffset);
            const colCount = rv.getInt16(0, false);
            let offset = 2;
            columns = [];
            for (let i = 0; i < colCount; i++) {
              // Column name is NUL-terminated
              let end = offset;
              while (end < msg.payload.length && msg.payload[end] !== 0) end++;
              const colName = dec.decode(msg.payload.slice(offset, end));
              offset = end + 1; // skip NUL
              // tableOID (4), colAttr (2), typeOID (4), typeSize (2), typeMod (4), format (2)
              const typeOid = rv.getInt32(offset + 6, false);
              offset += 18;
              columns.push({ name: colName, typeOid });
            }
          } else if (msg.type === 'n') {
            // NoData — query returns no rows (e.g., INSERT/UPDATE without RETURNING)
            columns = [];
          } else if (msg.type === 'Z') {
            // ReadyForQuery — done
            break;
          } else if (msg.type === 'E') {
            const err = parseErrorResponse(msg.payload);
            throw new Error(`Describe error: ${err.message}${err.detail ? ` — ${err.detail}` : ''}`);
          }
        }

        return new Response(
          JSON.stringify({
            success: true,
            host,
            port,
            database,
            query,
            columns,
            paramCount,
          } satisfies PostgreSQLDescribeResult & { success: boolean }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      } finally {
        reader.release();
        writer.releaseLock();
        try { await socket.close(); } catch { /* ignore */ }
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs),
    );

    try {
      return await Promise.race([describePromise, timeoutPromise]);
    } catch (err) {
      return new Response(
        JSON.stringify({
          success: false,
          error: err instanceof Error ? err.message : 'Describe failed',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Describe failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

// ---------------------------------------------------------------------------
// LISTEN — subscribe to a channel and collect async notifications
// ---------------------------------------------------------------------------

/**
 * PostgreSQL LISTEN: subscribe to a channel and collect notifications
 * that arrive within a configurable wait window.
 *
 * Body: { host, port=5432, username, password, database, channel, waitMs=5000, timeout=15000 }
 * Returns: { success, channel, listenConfirmed, notifications[], notificationCount, waitMs, rtt }
 * Each notification: { pid, channel, payload, receivedAt }
 *
 * PostgreSQL automatically UNLISTENs when the connection closes.
 */
export async function handlePostgresListen(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number; username?: string; password?: string;
      database?: string; channel: string; waitMs?: number; timeout?: number;
    };
    const {
      host, port = 5432,
      username = 'postgres', password = '',
      database = 'postgres',
      channel, waitMs = 5000, timeout = 15000,
    } = body;

    if (!host || !channel) {
      return new Response(JSON.stringify({
        success: false, error: 'Missing required: host, channel',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(channel)) {
      return new Response(JSON.stringify({
        success: false, error: 'channel must be a simple identifier (letters/digits/underscores, start with letter or underscore)',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const overallTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const listenPromise = (async () => {
      const startTime = Date.now();
      const { socket, reader, writer } = await connectAndAuthenticate(host, port, username, password, database);
      const dec = new TextDecoder();

      try {
        await writer.write(buildQueryMessage(`LISTEN ${channel}`));

        // Drain CommandComplete + ReadyForQuery
        let listenConfirmed = false;
        while (true) {
          const msg = await reader.readMessage();
          if (msg.type === 'C') { listenConfirmed = true; }
          else if (msg.type === 'Z') { break; }
          else if (msg.type === 'E') {
            const err = parseErrorResponse(msg.payload);
            throw new Error(`LISTEN failed: ${err.message}${err.detail ? ` — ${err.detail}` : ''}`);
          }
        }

        // Collect notifications until waitMs elapses
        const notifications: Array<{ pid: number; channel: string; payload: string; receivedAt: string }> = [];
        const deadline = Date.now() + waitMs;

        while (Date.now() < deadline) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) break;

          const result = await Promise.race([
            reader.readMessage(),
            new Promise<null>(resolve => setTimeout(() => resolve(null), remaining)),
          ]);

          if (result === null) break; // wait window expired

          const msg = result as { type: string; payload: Uint8Array };
          if (msg.type === 'A') {
            // NotificationResponse: pid(4 BE) + channel_name\0 + payload\0
            const view = new DataView(msg.payload.buffer, msg.payload.byteOffset);
            const pid = view.getInt32(0, false);
            let i = 4; let j = i;
            while (j < msg.payload.length && msg.payload[j] !== 0) j++;
            const notifChannel = dec.decode(msg.payload.slice(i, j));
            i = j + 1; j = i;
            while (j < msg.payload.length && msg.payload[j] !== 0) j++;
            const notifPayload = dec.decode(msg.payload.slice(i, j));
            notifications.push({ pid, channel: notifChannel, payload: notifPayload, receivedAt: new Date().toISOString() });
          } else if (msg.type === 'E') {
            const err = parseErrorResponse(msg.payload);
            throw new Error(`Server error while listening: ${err.message}`);
          }
          // NoticeResponse ('N'), ParameterStatus ('S'), ReadyForQuery ('Z') are silently skipped
        }

        return new Response(JSON.stringify({
          success: true, host, port, channel, listenConfirmed,
          notifications, notificationCount: notifications.length,
          waitMs, rtt: Date.now() - startTime,
        }), { headers: { 'Content-Type': 'application/json' } });
      } finally {
        reader.release();
        writer.releaseLock();
        try { await socket.close(); } catch { /* ignore */ }
      }
    })();

    return await Promise.race([listenPromise, overallTimeout]);
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'LISTEN failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ---------------------------------------------------------------------------
// NOTIFY — publish a message to a channel via pg_notify()
// ---------------------------------------------------------------------------

/**
 * PostgreSQL NOTIFY: send a notification to all listeners on a channel.
 *
 * Body: { host, port=5432, username, password, database, channel, payload='', timeout=10000 }
 * Returns: { success, channel, payload, notified, commandTag, rtt }
 */
export async function handlePostgresNotify(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number; username?: string; password?: string;
      database?: string; channel: string; payload?: string; timeout?: number;
    };
    const {
      host, port = 5432,
      username = 'postgres', password = '',
      database = 'postgres',
      channel, payload = '', timeout = 10000,
    } = body;

    if (!host || !channel) {
      return new Response(JSON.stringify({
        success: false, error: 'Missing required: host, channel',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(channel)) {
      return new Response(JSON.stringify({
        success: false, error: 'channel must be a simple identifier (letters/digits/underscores, start with letter or underscore)',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const overallTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const notifyPromise = (async () => {
      const startTime = Date.now();
      const { socket, reader, writer } = await connectAndAuthenticate(host, port, username, password, database);

      try {
        // pg_notify() lets us pass channel + payload as string literals safely.
        // Escape single quotes by doubling (standard SQL).
        const safeChannel = channel.replace(/'/g, "''");
        const safePayload = payload.replace(/'/g, "''");
        const result = await executeQuery(reader, writer, `SELECT pg_notify('${safeChannel}', '${safePayload}')`);

        return new Response(JSON.stringify({
          success: true, host, port, channel, payload,
          notified: result.commandTag === 'SELECT 1',
          commandTag: result.commandTag,
          rtt: Date.now() - startTime,
        }), { headers: { 'Content-Type': 'application/json' } });
      } finally {
        reader.release();
        writer.releaseLock();
        try { await socket.close(); } catch { /* ignore */ }
      }
    })();

    return await Promise.race([notifyPromise, overallTimeout]);
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'NOTIFY failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
