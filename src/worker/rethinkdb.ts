/**
 * RethinkDB Wire Protocol Implementation
 *
 * Implements RethinkDB connectivity testing via the ReQL wire protocol (port 28015).
 *
 * Protocol Flow (V0.4 - legacy):
 * 1. Client sends magic 0xd3ccaa08 (4 bytes LE) + auth_key_length + auth_key
 * 2. Client sends protocol 0x7e6970c7 (4 bytes LE)
 * 3. Server responds with null-terminated ASCII string
 *
 * Protocol Flow (V1.0 - current, SCRAM-SHA-256):
 * 1. Client sends magic 0x400c2d20 (4 bytes LE)
 * 2. SCRAM-SHA-256 JSON message exchange (null-terminated strings)
 * 3. After auth, send binary ReQL queries over the same TCP connection
 *
 * Query Wire Format (post-auth):
 *   [token: 8 bytes LE][length: 4 bytes LE][query_json: length bytes]
 * Response:
 *   [token: 8 bytes LE][length: 4 bytes LE][response_json: length bytes]
 *
 * Query JSON: [query_type, query_term, options]
 *   query_type: 1=START, 2=CONTINUE, 3=STOP, 4=NOREPLY_WAIT, 5=SERVER_INFO
 *
 * Response JSON: {"t": type, "r": [results...]}
 *   1=SUCCESS_ATOM  2=SUCCESS_SEQUENCE  3=SUCCESS_PARTIAL
 *   4=WAIT_COMPLETE 16=SERVER_INFO      17=CLIENT_ERROR
 *   18=COMPILE_ERROR 19=RUNTIME_ERROR
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const MAGIC_V0_4 = 0xD3CCAA08;
const MAGIC_V1_0 = 0x400C2D20;
const PROTOCOL_JSON = 0x7E6970C7;

// ReQL term opcodes
const TERM_DB = 14;
const TERM_TABLE_LIST = 15;

// Response type IDs
const RESPONSE_CLIENT_ERROR = 17;
const RESPONSE_COMPILE_ERROR = 18;
const RESPONSE_RUNTIME_ERROR = 19;

const RESPONSE_TYPE_NAMES: Record<number, string> = {
  1: 'SUCCESS_ATOM',
  2: 'SUCCESS_SEQUENCE',
  3: 'SUCCESS_PARTIAL',
  4: 'WAIT_COMPLETE',
  16: 'SERVER_INFO',
  17: 'CLIENT_ERROR',
  18: 'COMPILE_ERROR',
  19: 'RUNTIME_ERROR',
};

// ---------------------------------------------------------------------------
// Low-level I/O helpers
// ---------------------------------------------------------------------------

async function readNullTerminatedString(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
  maxBytes = 4096,
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const result = await Promise.race([reader.read(), timeoutPromise]);
    if (result.done || !result.value) break;
    chunks.push(result.value);
    total += result.value.length;
    if (result.value.includes(0)) break;
  }
  const combined = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { combined.set(c, off); off += c.length; }
  const nullIdx = combined.indexOf(0);
  return new TextDecoder().decode(combined.slice(0, nullIdx >= 0 ? nullIdx : combined.length));
}

async function readExact(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  length: number,
  timeoutPromise: Promise<never>,
): Promise<Uint8Array> {
  if (length > 16 * 1024 * 1024) throw new Error('Response too large (max 16MB)');
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < length) {
    const result = await Promise.race([reader.read(), timeoutPromise]);
    if (result.done || !result.value) throw new Error('Connection closed while reading');
    const needed = length - total;
    if (result.value.length <= needed) {
      chunks.push(result.value);
      total += result.value.length;
    } else {
      chunks.push(result.value.subarray(0, needed));
      total += needed;
    }
  }
  const buf = new Uint8Array(length);
  let off = 0;
  for (let i = 0; i < chunks.length; i++) {
    buf.set(chunks[i], off);
    off += chunks[i].length;
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Handshake builders
// ---------------------------------------------------------------------------

function buildV04Handshake(authKey: string): Uint8Array {
  const authBytes = new TextEncoder().encode(authKey);
  const pkt = new Uint8Array(4 + 4 + authBytes.length + 4);
  const v = new DataView(pkt.buffer);
  v.setUint32(0, MAGIC_V0_4, true);
  v.setUint32(4, authBytes.length, true);
  if (authBytes.length > 0) pkt.set(authBytes, 8);
  v.setUint32(8 + authBytes.length, PROTOCOL_JSON, true);
  return pkt;
}

function buildV10ScramInit(): Uint8Array {
  const msg = JSON.stringify({
    protocol_version: 0,
    authentication_method: 'SCRAM-SHA-256',
    authentication: 'n,,n=admin,r=portofcall000000000000',
  });
  const msgBytes = new TextEncoder().encode(msg + '\0');
  const pkt = new Uint8Array(4 + msgBytes.length);
  new DataView(pkt.buffer).setUint32(0, MAGIC_V1_0, true);
  pkt.set(msgBytes, 4);
  return pkt;
}

// ---------------------------------------------------------------------------
// SCRAM-SHA-256 authentication (full implementation using WebCrypto)
// ---------------------------------------------------------------------------

async function performScramAuth(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  password: string,
  timeoutPromise: Promise<never>,
): Promise<{ success: boolean; error?: string }> {
  const enc = new TextEncoder();

  // Send V1.0 magic + client-first message
  const clientNonce = 'portofcall' + Math.random().toString(36).slice(2);
  const clientFirstBare = `n=admin,r=${clientNonce}`;
  const clientFirstMsg = JSON.stringify({
    protocol_version: 0,
    authentication_method: 'SCRAM-SHA-256',
    authentication: `n,,${clientFirstBare}`,
  });
  const initBytes = enc.encode(clientFirstMsg + '\0');
  const pkt = new Uint8Array(4 + initBytes.length);
  new DataView(pkt.buffer).setUint32(0, MAGIC_V1_0, true);
  pkt.set(initBytes, 4);
  await writer.write(pkt);

  // Read server-first response (null-terminated JSON)
  const serverFirstStr = await readNullTerminatedString(reader, timeoutPromise);
  let serverFirst: { success?: boolean; authentication?: string; error?: string };
  try {
    serverFirst = JSON.parse(serverFirstStr) as typeof serverFirst;
  } catch {
    return { success: false, error: `Invalid server response: ${serverFirstStr.slice(0, 200)}` };
  }
  if (serverFirst.success === false) {
    return { success: false, error: serverFirst.error ?? 'Auth rejected by server' };
  }
  // Server accepted without SCRAM (no-auth mode)
  if (!serverFirst.authentication) {
    return { success: true };
  }

  // Parse server-first-message fields: r=<snonce>, s=<salt_b64>, i=<iterations>
  const fields: Record<string, string> = {};
  for (const part of serverFirst.authentication.split(',')) {
    const idx = part.indexOf('=');
    if (idx > 0) fields[part.slice(0, idx)] = part.slice(idx + 1);
  }
  const serverNonce = fields['r'] ?? '';
  const saltB64 = fields['s'] ?? '';
  const iterations = parseInt(fields['i'] ?? '4096', 10);

  if (!serverNonce.startsWith(clientNonce)) {
    return { success: false, error: 'Server nonce does not start with client nonce' };
  }

  // PBKDF2 key derivation via WebCrypto
  const saltBytes = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const km = await crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' }, km, 256,
  );
  const saltedPassword = new Uint8Array(derived);

  const hmac = async (key: Uint8Array, data: Uint8Array): Promise<Uint8Array> => {
    const k = await crypto.subtle.importKey(
      'raw', key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer,
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    return new Uint8Array(await crypto.subtle.sign('HMAC', k, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer));
  };

  const clientKey = await hmac(saltedPassword, enc.encode('Client Key'));
  const storedKey = new Uint8Array(await crypto.subtle.digest('SHA-256', clientKey.buffer.slice(clientKey.byteOffset, clientKey.byteOffset + clientKey.byteLength) as ArrayBuffer));
  const serverKey = await hmac(saltedPassword, enc.encode('Server Key'));

  const clientFinalWithoutProof = `c=biws,r=${serverNonce}`;
  const authMessage = `${clientFirstBare},${serverFirst.authentication},${clientFinalWithoutProof}`;

  const clientSignature = await hmac(storedKey, enc.encode(authMessage));
  const clientProof = new Uint8Array(clientKey.length);
  for (let i = 0; i < clientKey.length; i++) clientProof[i] = clientKey[i] ^ clientSignature[i];

  const serverSignature = await hmac(serverKey, enc.encode(authMessage));
  const serverSigB64 = btoa(String.fromCharCode(...serverSignature));

  const clientFinal = JSON.stringify({
    authentication: `${clientFinalWithoutProof},p=${btoa(String.fromCharCode(...clientProof))}`,
  });
  await writer.write(enc.encode(clientFinal + '\0'));

  // Read server-final response
  const serverFinalStr = await readNullTerminatedString(reader, timeoutPromise);
  let serverFinal: { success?: boolean; authentication?: string; error?: string };
  try {
    serverFinal = JSON.parse(serverFinalStr) as typeof serverFinal;
  } catch {
    return { success: false, error: `Invalid server-final: ${serverFinalStr.slice(0, 200)}` };
  }
  if (!serverFinal.success) {
    return { success: false, error: serverFinal.error ?? 'Authentication failed' };
  }

  // Verify server signature (v= field) if present
  if (serverFinal.authentication) {
    const parts: Record<string, string> = {};
    for (const part of serverFinal.authentication.split(',')) {
      const idx = part.indexOf('=');
      if (idx > 0) parts[part.slice(0, idx)] = part.slice(idx + 1);
    }
    if (parts['v'] && parts['v'] !== serverSigB64) {
      return { success: false, error: 'Server signature verification failed' };
    }
  }
  return { success: true };
}

// ---------------------------------------------------------------------------
// ReQL query wire format helpers
// ---------------------------------------------------------------------------

/** Build a ReQL query packet: [token:8LE][length:4LE][json] */
function buildQueryPacket(token: number, queryJson: string): Uint8Array {
  const body = new TextEncoder().encode(queryJson);
  const pkt = new Uint8Array(8 + 4 + body.length);
  const v = new DataView(pkt.buffer);
  v.setUint32(0, token, true); // token lo-word
  v.setUint32(4, 0, true);     // token hi-word
  v.setUint32(8, body.length, true);
  pkt.set(body, 12);
  return pkt;
}

/** Read one ReQL response packet: [token:8LE][length:4LE][json:length] */
async function readQueryResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
): Promise<{ token: number; json: string }> {
  const header = await readExact(reader, 12, timeoutPromise);
  const v = new DataView(header.buffer);
  const token = v.getUint32(0, true);
  const length = v.getUint32(8, true);
  const body = await readExact(reader, length, timeoutPromise);
  return { token, json: new TextDecoder().decode(body) };
}

function parseReQLResponse(json: string): {
  type: number;
  typeName: string;
  results: unknown[];
  error?: string;
} {
  try {
    const resp = JSON.parse(json) as { t: number; r: unknown[] };
    const type = resp.t;
    const results = resp.r ?? [];
    const typeName = RESPONSE_TYPE_NAMES[type] ?? `UNKNOWN(${type})`;
    if (type === RESPONSE_CLIENT_ERROR || type === RESPONSE_COMPILE_ERROR || type === RESPONSE_RUNTIME_ERROR) {
      return { type, typeName, results, error: String(results[0] ?? 'Query error') };
    }
    return { type, typeName, results };
  } catch {
    return { type: 0, typeName: 'PARSE_ERROR', results: [], error: `Failed to parse: ${json.slice(0, 200)}` };
  }
}

// ---------------------------------------------------------------------------
// Protocol detection helper (for V0.4 null-terminated response)
// ---------------------------------------------------------------------------

function detectProtocolVersion(response: string): {
  isRethinkDB: boolean;
  version: string;
  authenticated: boolean;
  message: string;
} {
  if (response === 'SUCCESS') {
    return { isRethinkDB: true, version: 'V0.4 (Legacy)', authenticated: true,
      message: 'RethinkDB server detected. V0.4 handshake succeeded — authenticated.' };
  }
  if (response.startsWith('ERROR:')) {
    return { isRethinkDB: true, version: 'V0.4 (Legacy)', authenticated: false,
      message: `RethinkDB server detected. ${response}` };
  }
  if (response.startsWith('{')) {
    try {
      const json = JSON.parse(response) as {
        success?: boolean; authentication?: string;
        max_protocol_version?: number; min_protocol_version?: number; error?: string;
      };
      if (json.authentication !== undefined || json.max_protocol_version !== undefined) {
        return { isRethinkDB: true, version: 'V1.0 (SCRAM-SHA-256)', authenticated: false,
          message: `RethinkDB server detected. V1.0 SCRAM authentication available. Protocol versions: ${json.min_protocol_version ?? 0}-${json.max_protocol_version ?? 0}.` };
      }
      if (json.error) {
        return { isRethinkDB: true, version: 'V1.0 (SCRAM-SHA-256)', authenticated: false,
          message: `RethinkDB server detected. ${json.error}` };
      }
      if (json.success !== undefined) {
        return { isRethinkDB: true, version: 'V1.0 (SCRAM-SHA-256)', authenticated: json.success === true,
          message: `RethinkDB server detected. Auth ${json.success ? 'succeeded' : 'failed'}.` };
      }
    } catch { /* fall through */ }
  }
  if (response.toLowerCase().includes('rethinkdb') || response.toLowerCase().includes('reql')) {
    return { isRethinkDB: true, version: 'Unknown', authenticated: false,
      message: `RethinkDB server detected. Response: ${response.substring(0, 200)}` };
  }
  return { isRethinkDB: false, version: 'Unknown', authenticated: false,
    message: `Server responded but does not appear to be RethinkDB. Response: ${response.substring(0, 200)}` };
}

// ---------------------------------------------------------------------------
// Shared response helpers
// ---------------------------------------------------------------------------

function badRequest(msg: string): Response {
  return new Response(JSON.stringify({ success: false, error: msg }), {
    status: 400, headers: { 'Content-Type': 'application/json' },
  });
}

async function cfBlock(host: string): Promise<Response | null> {
  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    return new Response(JSON.stringify({
      success: false,
      error: getCloudflareErrorMessage(host, cfCheck.ip),
      isCloudflare: true,
    }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public handlers
// ---------------------------------------------------------------------------

/**
 * V0.4 connection test with optional auth key.
 * POST { host, port?, authKey?, timeout? }
 */
export async function handleRethinkDBConnect(request: Request): Promise<Response> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = await request.json() as {
      host: string; port?: number; authKey?: string; timeout?: number;
    };
    const { host, port = 28015, authKey = '', timeout = 10000 } = body;

    if (!host) return badRequest('Missing required parameter: host');
    if (port < 1 || port > 65535) return badRequest('Port must be between 1 and 65535');

    const block = await cfBlock(host);
    if (block) return block;

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, r) => {
      timeoutHandle = setTimeout(() => r(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);
    const connectTime = Date.now() - startTime;

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      await writer.write(buildV04Handshake(authKey));
      const response = await readNullTerminatedString(reader, timeoutPromise);
      const rtt = Date.now() - startTime;
      const detection = detectProtocolVersion(response);

      return new Response(JSON.stringify({
        success: true, host, port, rtt, connectTime,
        protocolVersion: 'V0.4',
        isRethinkDB: detection.isRethinkDB,
        authenticated: detection.authenticated,
        serverVersion: detection.version,
        rawResponse: response.substring(0, 500),
        message: detection.message,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      try { writer.releaseLock(); } catch { /* ignore */ }
      try { reader.releaseLock(); } catch { /* ignore */ }
      try { socket.close(); } catch { /* ignore */ }
    }

  } catch (error) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * V1.0 SCRAM probe — detects modern RethinkDB without completing full auth.
 * POST { host, port?, timeout? }
 */
export async function handleRethinkDBProbe(request: Request): Promise<Response> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = await request.json() as { host: string; port?: number; timeout?: number; };
    const { host, port = 28015, timeout = 10000 } = body;

    if (!host) return badRequest('Missing required parameter: host');
    if (port < 1 || port > 65535) return badRequest('Port must be between 1 and 65535');

    const block = await cfBlock(host);
    if (block) return block;

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, r) => {
      timeoutHandle = setTimeout(() => r(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      await writer.write(buildV10ScramInit());
      const response = await readNullTerminatedString(reader, timeoutPromise);
      const rtt = Date.now() - startTime;
      const detection = detectProtocolVersion(response);

      return new Response(JSON.stringify({
        success: true, host, port, rtt,
        isRethinkDB: detection.isRethinkDB,
        serverVersion: detection.version,
        rawResponse: response.substring(0, 500),
        message: detection.message,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      try { writer.releaseLock(); } catch { /* ignore */ }
      try { reader.releaseLock(); } catch { /* ignore */ }
      try { socket.close(); } catch { /* ignore */ }
    }

  } catch (error) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Run an arbitrary ReQL JSON query after SCRAM authentication.
 * POST { host, port?, password?, query, timeout? }
 *
 * query — raw ReQL JSON string, e.g.:
 *   "[1,[39],{}]"                        → r.tableList()
 *   "[1,[15,[[14,[["test"]]]]], {}]"     → r.db("test").tableList()
 *   "[5]"                                → SERVER_INFO (no auth needed for query format)
 */
export async function handleRethinkDBQuery(request: Request): Promise<Response> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = await request.json() as {
      host: string; port?: number; password?: string; query: string; timeout?: number;
    };
    const { host, port = 28015, password = '', query, timeout = 15000 } = body;

    if (!host) return badRequest('Missing required parameter: host');
    if (!query) return badRequest('Missing required parameter: query');
    if (port < 1 || port > 65535) return badRequest('Port must be between 1 and 65535');

    const block = await cfBlock(host);
    if (block) return block;

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, r) => {
      timeoutHandle = setTimeout(() => r(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      const authResult = await performScramAuth(writer, reader, password, timeoutPromise);
      if (!authResult.success) {
        return new Response(
          JSON.stringify({ success: false, error: `Authentication failed: ${authResult.error}` }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      await writer.write(buildQueryPacket(1, query));
      const { json: responseJson } = await readQueryResponse(reader, timeoutPromise);
      const rtt = Date.now() - startTime;

      const parsed = parseReQLResponse(responseJson);
      return new Response(JSON.stringify({
        success: !parsed.error, host, port, rtt,
        responseType: parsed.typeName,
        results: parsed.results,
        error: parsed.error,
        rawResponse: responseJson.slice(0, 1000),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      try { writer.releaseLock(); } catch { /* ignore */ }
      try { reader.releaseLock(); } catch { /* ignore */ }
      try { socket.close(); } catch { /* ignore */ }
    }

  } catch (error) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * List tables in a RethinkDB database via SCRAM auth + TABLE_LIST query.
 * POST { host, port?, password?, db?, timeout? }
 *
 * Executes: r.db(db).tableList()
 * ReQL AST: [1, [TABLE_LIST, [[DB, [[db_name]]]]], {}]
 */
export async function handleRethinkDBListTables(request: Request): Promise<Response> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = await request.json() as {
      host: string; port?: number; password?: string; db?: string; timeout?: number;
    };
    const { host, port = 28015, password = '', db = 'rethinkdb', timeout = 15000 } = body;

    if (!host) return badRequest('Missing required parameter: host');
    if (port < 1 || port > 65535) return badRequest('Port must be between 1 and 65535');

    const block = await cfBlock(host);
    if (block) return block;

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, r) => {
      timeoutHandle = setTimeout(() => r(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      const authResult = await performScramAuth(writer, reader, password, timeoutPromise);
      if (!authResult.success) {
        return new Response(
          JSON.stringify({ success: false, error: `Authentication failed: ${authResult.error}` }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // r.db(db).tableList()  →  [1, [TABLE_LIST, [[DB, [[db]]]]], {}]
      const tableListQuery = JSON.stringify([1, [TERM_TABLE_LIST, [[TERM_DB, [[db]]]]], {}]);
      await writer.write(buildQueryPacket(1, tableListQuery));

      const { json: responseJson } = await readQueryResponse(reader, timeoutPromise);
      const rtt = Date.now() - startTime;

      const parsed = parseReQLResponse(responseJson);
      return new Response(JSON.stringify({
        success: !parsed.error, host, port, db, rtt,
        tables: parsed.error ? undefined : parsed.results,
        responseType: parsed.typeName,
        error: parsed.error,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      try { writer.releaseLock(); } catch { /* ignore */ }
      try { reader.releaseLock(); } catch { /* ignore */ }
      try { socket.close(); } catch { /* ignore */ }
    }

  } catch (error) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Get server information via the SERVER_INFO ReQL query (query_type=5).
 * POST { host, port?, password?, timeout? }
 *
 * Sends binary query [5] and returns server id, name, and version string.
 */
export async function handleRethinkDBServerInfo(request: Request): Promise<Response> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = await request.json() as {
      host: string; port?: number; password?: string; timeout?: number;
    };
    const { host, port = 28015, password = '', timeout = 15000 } = body;

    if (!host) return badRequest('Missing required parameter: host');
    if (port < 1 || port > 65535) return badRequest('Port must be between 1 and 65535');

    const block = await cfBlock(host);
    if (block) return block;

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, r) => {
      timeoutHandle = setTimeout(() => r(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      const authResult = await performScramAuth(writer, reader, password, timeoutPromise);
      if (!authResult.success) {
        return new Response(
          JSON.stringify({ success: false, error: `Authentication failed: ${authResult.error}` }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // SERVER_INFO: query type=5, no term → [5]
      await writer.write(buildQueryPacket(1, '[5]'));
      const { json: responseJson } = await readQueryResponse(reader, timeoutPromise);
      const rtt = Date.now() - startTime;

      const parsed = parseReQLResponse(responseJson);
      const info = parsed.results[0] as Record<string, string> | undefined;

      return new Response(JSON.stringify({
        success: !parsed.error, host, port, rtt,
        serverId: info?.id,
        serverName: info?.name,
        serverVersion: info?.version,
        responseType: parsed.typeName,
        error: parsed.error,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      try { writer.releaseLock(); } catch { /* ignore */ }
      try { reader.releaseLock(); } catch { /* ignore */ }
      try { socket.close(); } catch { /* ignore */ }
    }

  } catch (error) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

// ReQL term opcodes for write operations
const TERM_TABLE_CREATE = 60;
const TERM_INSERT = 56;
const TERM_TABLE = 15;

/**
 * Create a RethinkDB table.
 * POST /api/rethinkdb/table-create
 *
 * Executes: r.db(db).tableCreate(name)
 * ReQL AST:  [1, [TABLE_CREATE, [[DB, [[db]]], [name]]], {}]
 *
 * Request: { host, port?, password?, db?, name?, timeout? }
 * Response: { success, host, port, rtt, created, responseType, error? }
 */
export async function handleRethinkDBTableCreate(request: Request): Promise<Response> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = await request.json() as {
      host: string; port?: number; password?: string; db?: string; name?: string; timeout?: number;
    };
    const { host, port = 28015, password = '', db = 'test', timeout = 15000 } = body;
    const name = body.name ?? `portofcall_${Date.now()}`;
    if (!host) return badRequest('Missing required parameter: host');
    if (port < 1 || port > 65535) return badRequest('Port must be between 1 and 65535');

    const block = await cfBlock(host);
    if (block) return block;

    const startTime = Date.now();
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`Connection timeout after ${timeout}ms`)), timeout);
    });

    const socket = connect(`${host}:${port}`);
    await Promise.race([socket.opened, timeoutPromise]);
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      const authResult = await performScramAuth(writer, reader, password, timeoutPromise);
      if (!authResult.success) {
        return new Response(
          JSON.stringify({ success: false, error: `Authentication failed: ${authResult.error}` }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // r.db(db).tableCreate(name) → [1, [TABLE_CREATE, [[DB, [[db]]], [name]]], {}]
      const query = JSON.stringify([1, [TERM_TABLE_CREATE, [[TERM_DB, [[db]]], [name]]], {}]);
      await writer.write(buildQueryPacket(1, query));
      const { json: responseJson } = await readQueryResponse(reader, timeoutPromise);
      const rtt = Date.now() - startTime;

      const parsed = parseReQLResponse(responseJson);
      const result = parsed.results[0] as Record<string, unknown> | undefined;

      return new Response(JSON.stringify({
        success: !parsed.error, host, port, rtt,
        tableName: name, db,
        created: (result?.tables_created as number | undefined) ?? (parsed.error ? 0 : 1),
        responseType: parsed.typeName,
        error: parsed.error,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      try { writer.releaseLock(); } catch { /* ignore */ }
      try { reader.releaseLock(); } catch { /* ignore */ }
      try { socket.close(); } catch { /* ignore */ }
    }

  } catch (error) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Insert documents into a RethinkDB table.
 * POST /api/rethinkdb/insert
 *
 * Executes: r.db(db).table(name).insert(docs)
 * ReQL AST:  [1, [INSERT, [[TABLE, [[DB, [[db]]], [name]]], [docs...]]], {}]
 *
 * Request: { host, port?, password?, db?, table?, docs?, timeout? }
 *   docs: array of JSON objects (default: [{ source: 'portofcall', ts: Date.now() }])
 * Response: { success, host, port, rtt, inserted, errors, responseType, error? }
 */
export async function handleRethinkDBInsert(request: Request): Promise<Response> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = await request.json() as {
      host: string; port?: number; password?: string;
      db?: string; table?: string;
      docs?: Record<string, unknown>[]; timeout?: number;
    };
    const { host, port = 28015, password = '', db = 'test', timeout = 15000 } = body;
    const table = body.table ?? 'portofcall';
    const docs = body.docs ?? [{ source: 'portofcall', ts: Date.now() }];
    if (!host) return badRequest('Missing required parameter: host');
    if (port < 1 || port > 65535) return badRequest('Port must be between 1 and 65535');

    const block = await cfBlock(host);
    if (block) return block;

    const startTime = Date.now();
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`Connection timeout after ${timeout}ms`)), timeout);
    });

    const socket = connect(`${host}:${port}`);
    await Promise.race([socket.opened, timeoutPromise]);
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      const authResult = await performScramAuth(writer, reader, password, timeoutPromise);
      if (!authResult.success) {
        return new Response(
          JSON.stringify({ success: false, error: `Authentication failed: ${authResult.error}` }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // r.db(db).table(name).insert(docs) →
      //   [1, [INSERT, [[TABLE, [[DB, [[db]]], [name]]], [docs...]]], {}]
      const query = JSON.stringify([1, [TERM_INSERT, [[TERM_TABLE, [[TERM_DB, [[db]]], [table]]], docs]], {}]);
      await writer.write(buildQueryPacket(1, query));
      const { json: responseJson } = await readQueryResponse(reader, timeoutPromise);
      const rtt = Date.now() - startTime;

      const parsed = parseReQLResponse(responseJson);
      const result = parsed.results[0] as Record<string, unknown> | undefined;

      return new Response(JSON.stringify({
        success: !parsed.error, host, port, rtt,
        db, table,
        inserted: result?.inserted ?? 0,
        errors: result?.errors ?? 0,
        generatedKeys: result?.generated_keys ?? [],
        responseType: parsed.typeName,
        error: parsed.error,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      try { writer.releaseLock(); } catch { /* ignore */ }
      try { reader.releaseLock(); } catch { /* ignore */ }
      try { socket.close(); } catch { /* ignore */ }
    }

  } catch (error) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
