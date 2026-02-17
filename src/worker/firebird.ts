/**
 * Firebird SQL Database Protocol Handler (Port 3050)
 *
 * Firebird uses a custom binary wire protocol for client-server communication.
 * All values are big-endian.  After the initial op_connect / op_accept handshake,
 * the client sends op_attach (19) with a Database Parameter Block (DPB) carrying
 * credentials, then can allocate statements, begin transactions, and execute SQL.
 *
 * Handshake flow:
 *   Client → op_connect (1)  [database path, protocol list]
 *   Server → op_accept  (2)  [agreed protocol, architecture, type]
 *   Client → op_attach  (19) [database path, DPB with username/password]
 *   Server → op_response(9)  [db handle; empty status vector = success]
 *   Client → op_transaction (29) [db handle, TPB]
 *   Server → op_response (9) [tr handle]
 *   Client → op_allocate_statement (62) [db handle]
 *   Server → op_response (9) [stmt handle]
 *   Client → op_prepare_statement (64) [tr handle, stmt handle, dialect, SQL]
 *   Server → op_response (9)
 *   Client → op_execute (63)
 *   Server → op_response (9)
 *   Client → op_fetch (65) [stmt handle, count]
 *   Server → op_fetch_response (66) / op_response (9)
 *
 * Default Port: 3050
 * Reference: Firebird source src/remote/protocol.h
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// ─── Opcodes ─────────────────────────────────────────────────────────────────
const OP_CONNECT             = 1;
const OP_ACCEPT              = 2;
const OP_REJECT              = 3;
const OP_RESPONSE            = 9;
const OP_DETACH              = 21;
const OP_TRANSACTION         = 29;
const OP_COMMIT              = 31;
const OP_ATTACH              = 19;
const OP_ALLOCATE_STATEMENT  = 62;
const OP_EXECUTE             = 63;
const OP_PREPARE_STATEMENT   = 64;
const OP_FETCH               = 65;
const OP_FETCH_RESPONSE      = 66;

// ─── DPB item codes ──────────────────────────────────────────────────────────
const isc_dpb_version1  = 1;
const isc_dpb_user_name = 28;
const isc_dpb_password  = 29;
const isc_dpb_lc_ctype  = 48;

// ─── TPB item codes ──────────────────────────────────────────────────────────
const isc_tpb_version3     = 3;
const isc_tpb_read         = 9;
const isc_tpb_concurrency  = 5;
const isc_tpb_wait         = 6;

const PROTOCOL_VERSION13   = 13;
const ARCHITECTURE_GENERIC = 1;

const enc = new TextEncoder();
const dec = new TextDecoder();

// ─── Packet helpers ──────────────────────────────────────────────────────────

function u32BE(v: number): number[] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

/** Firebird "counted string": [u32BE length][bytes][null][pad to 4-byte boundary] */
function cstring(s: string): number[] {
  const bytes = enc.encode(s);
  const len = bytes.length + 1;
  const pad = (4 - (len % 4)) % 4;
  return [...u32BE(len), ...bytes, 0, ...new Array(pad).fill(0)];
}

/** Pad a byte array to 4-byte boundary */
function pad4(data: number[]): number[] {
  const r = data.length % 4;
  return r === 0 ? data : [...data, ...new Array(4 - r).fill(0)];
}

/**
 * Build Firebird Database Parameter Block (DPB)
 * isc_dpb_version1 [username] [password] [charset]
 */
function buildDPB(username: string, password: string): Uint8Array {
  const items: number[] = [isc_dpb_version1];
  const addItem = (code: number, value: string) => {
    const b = enc.encode(value);
    items.push(code, b.length, ...b);
  };
  addItem(isc_dpb_user_name, username);
  addItem(isc_dpb_password, password);
  addItem(isc_dpb_lc_ctype, 'UTF8');
  return new Uint8Array(items);
}

/** Build op_connect packet */
function buildConnectPacket(database: string): Uint8Array {
  const parts: number[] = [
    ...u32BE(OP_CONNECT),
    ...u32BE(0),               // operation type: attach(0)
    ...cstring(database),
    ...u32BE(1),               // 1 protocol offered
    ...u32BE(0),               // user-id buffer length (none for probe)
    // Protocol description: version, architecture, min, max, weight
    ...u32BE(PROTOCOL_VERSION13),
    ...u32BE(ARCHITECTURE_GENERIC),
    ...u32BE(2),               // ptype_rpc
    ...u32BE(PROTOCOL_VERSION13),
    ...u32BE(2),               // weight
  ];
  return new Uint8Array(parts);
}

/** Build op_attach packet */
function buildAttachPacket(database: string, dpb: Uint8Array): Uint8Array {
  const parts: number[] = [
    ...u32BE(OP_ATTACH),
    ...u32BE(0),               // db_handle (0 = new)
    ...cstring(database),
    ...u32BE(dpb.length),
    ...pad4([...dpb]),
  ];
  return new Uint8Array(parts);
}

/** Build op_transaction packet with a read-only TPB */
function buildTransactionPacket(dbHandle: number): Uint8Array {
  const tpb = [isc_tpb_version3, isc_tpb_read, isc_tpb_concurrency, isc_tpb_wait];
  return new Uint8Array([
    ...u32BE(OP_TRANSACTION),
    ...u32BE(dbHandle),
    ...u32BE(tpb.length),
    ...pad4(tpb),
  ]);
}

/** Build op_allocate_statement */
function buildAllocateStatement(dbHandle: number): Uint8Array {
  return new Uint8Array([...u32BE(OP_ALLOCATE_STATEMENT), ...u32BE(dbHandle)]);
}

/** Build op_prepare_statement */
function buildPrepareStatement(trHandle: number, stmtHandle: number, sql: string): Uint8Array {
  // dialect=3; describe_items is empty; max describe length = 65535
  const sqlBytes = enc.encode(sql);
  return new Uint8Array([
    ...u32BE(OP_PREPARE_STATEMENT),
    ...u32BE(trHandle),
    ...u32BE(stmtHandle),
    ...u32BE(3),              // SQL dialect
    ...u32BE(sqlBytes.length),
    ...pad4([...sqlBytes]),
    ...u32BE(0),              // describe_items length (none)
    ...u32BE(65535),          // max describe length
  ]);
}

/** Build op_execute */
function buildExecute(trHandle: number, stmtHandle: number): Uint8Array {
  return new Uint8Array([
    ...u32BE(OP_EXECUTE),
    ...u32BE(stmtHandle),
    ...u32BE(trHandle),
    ...u32BE(0), ...u32BE(0), // blr (none)
    ...u32BE(0),              // message_number
    ...u32BE(0),              // message_count
  ]);
}

/** Build op_fetch */
function buildFetch(stmtHandle: number): Uint8Array {
  return new Uint8Array([
    ...u32BE(OP_FETCH),
    ...u32BE(stmtHandle),
    ...u32BE(0), ...u32BE(0), // blr (none)
    ...u32BE(0),              // message_number
    ...u32BE(200),            // fetch count (max rows to return)
  ]);
}

/** Build op_commit */
function buildCommit(trHandle: number): Uint8Array {
  return new Uint8Array([...u32BE(OP_COMMIT), ...u32BE(trHandle)]);
}

/** Build op_detach */
function buildDetach(dbHandle: number): Uint8Array {
  return new Uint8Array([...u32BE(OP_DETACH), ...u32BE(dbHandle)]);
}

// ─── Socket I/O ──────────────────────────────────────────────────────────────

type FirebirdSocket = {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  socket: { close(): Promise<void> };
  buf: Uint8Array;
};

/** Accumulate enough bytes for a complete packet */
async function recvBytes(s: FirebirdSocket, n: number, timeoutMs = 8000): Promise<Uint8Array> {
  const deadline = Date.now() + timeoutMs;
  while (s.buf.length < n) {
    if (Date.now() >= deadline) throw new Error('Read timeout');
    const remaining = deadline - Date.now();
    const result = await Promise.race([
      s.reader.read(),
      new Promise<{ done: true; value: undefined }>(resolve =>
        setTimeout(() => resolve({ done: true, value: undefined }), remaining),
      ),
    ]);
    if (result.done || !result.value) throw new Error('Connection closed');
    const merged = new Uint8Array(s.buf.length + result.value.length);
    merged.set(s.buf);
    merged.set(result.value, s.buf.length);
    s.buf = merged;
  }
  const out = s.buf.slice(0, n);
  s.buf = s.buf.slice(n);
  return out;
}

// ─── Response parsing ────────────────────────────────────────────────────────

interface FBResponse {
  opcode: number;
  handle?: number;        // for op_response
  statusError?: string;   // decoded status vector error
  fetchStatus?: number;   // for op_fetch_response
  data?: Uint8Array;      // raw response body after opcode
}

/**
 * Read and parse the next Firebird server packet.
 * Handles op_response (9) and op_fetch_response (66).
 * Other opcodes (op_accept=2) return with data for caller to parse.
 */
async function recvPacket(s: FirebirdSocket, timeoutMs = 8000): Promise<FBResponse> {
  const opcodeBytes = await recvBytes(s, 4, timeoutMs);
  const opcode = new DataView(opcodeBytes.buffer).getUint32(0);

  if (opcode === OP_ACCEPT) {
    // op_accept: [version 4][architecture 4][type 4]
    const body = await recvBytes(s, 12, timeoutMs);
    return { opcode, data: body };
  }

  if (opcode === OP_REJECT) {
    return { opcode };
  }

  if (opcode === OP_RESPONSE) {
    // [handle 4][blob_id 8][status_vector_length 4][status_vector ...]
    const header = await recvBytes(s, 16, timeoutMs);
    const dv = new DataView(header.buffer);
    const handle = dv.getUint32(0);
    const svLen  = dv.getUint32(12);

    let statusError: string | undefined;
    if (svLen > 0) {
      const sv = await recvBytes(s, svLen, timeoutMs);
      // Scan for isc_arg_string (2) items which carry human-readable errors
      const msgs: string[] = [];
      let i = 0;
      while (i < sv.length) {
        const code = sv[i++];
        if (code === 0) break;           // isc_arg_end
        if (code === 1) { i += 4; continue; } // isc_arg_gds: skip 4-byte error number
        if (code === 2) {
          // isc_arg_string: null-terminated string
          let end = i;
          while (end < sv.length && sv[end] !== 0) end++;
          msgs.push(dec.decode(sv.subarray(i, end)));
          i = end + 1;
        } else {
          i += 4; // unknown arg type: skip 4 bytes
        }
      }
      statusError = msgs.join('; ') || `status vector length=${svLen}`;
    }

    return { opcode, handle, statusError };
  }

  if (opcode === OP_FETCH_RESPONSE) {
    // [fetch_status 4][count 4]
    const body = await recvBytes(s, 8, timeoutMs);
    const fetchStatus = new DataView(body.buffer).getUint32(0);
    return { opcode, fetchStatus, data: body };
  }

  // Unknown opcode — read nothing more, just return
  return { opcode };
}

// ─── Shared connect + accept logic ───────────────────────────────────────────

interface FirebirdConn {
  fs: FirebirdSocket;
  protocol: number;
  architecture: number;
}

async function connectAndAccept(
  host: string,
  port: number,
  database: string,
  timeoutMs: number,
): Promise<FirebirdConn> {
  const socket = connect({ hostname: host, port });
  await Promise.race([
    socket.opened,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs),
    ),
  ]);

  const fs: FirebirdSocket = {
    reader: socket.readable.getReader(),
    writer: socket.writable.getWriter(),
    socket,
    buf: new Uint8Array(0),
  };

  await fs.writer.write(buildConnectPacket(database));

  const resp = await recvPacket(fs, timeoutMs);
  if (resp.opcode === OP_REJECT) throw new Error('Connection rejected by server');
  if (resp.opcode !== OP_ACCEPT || !resp.data) {
    throw new Error(`Expected op_accept (2), got opcode ${resp.opcode}`);
  }

  const dv = new DataView(resp.data.buffer);
  const protocol     = dv.getUint32(0);
  const architecture = dv.getUint32(4);

  return { fs, protocol, architecture };
}

// ─── Handlers ────────────────────────────────────────────────────────────────

interface FirebirdProbeResult {
  success: boolean;
  version?: string;
  protocol?: number;
  architecture?: number;
  accepted?: boolean;
  error?: string;
  rawOpcode?: number;
}

/**
 * Handle Firebird probe — send op_connect and report whether the server
 * responds with op_accept (2).  No credentials required.
 */
export async function handleFirebirdProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const { host, port = 3050, database = '/tmp/test.fdb' } = await request.json<{
      host: string; port?: number; database?: string;
    }>();

    if (!host || typeof host !== 'string') {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    let conn: FirebirdConn;
    try {
      conn = await connectAndAccept(host, port, database, 8000);
    } catch (e) {
      return new Response(JSON.stringify({
        success: false,
        error: e instanceof Error ? e.message : 'Connect failed',
      } satisfies FirebirdProbeResult), { headers: { 'Content-Type': 'application/json' } });
    }

    conn.fs.reader.releaseLock();
    conn.fs.writer.releaseLock();
    conn.fs.socket.close();

    return new Response(JSON.stringify({
      success: true,
      accepted: true,
      protocol: conn.protocol,
      architecture: conn.architecture,
      version: `Firebird (protocol ${conn.protocol}, arch ${conn.architecture})`,
    } satisfies FirebirdProbeResult), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Firebird probe failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Attempt authentication against a Firebird server.
 * Body: { host, port?, database?, username, password }
 * Sends op_connect → op_attach (with DPB credentials) → parses op_response.
 */
export async function handleFirebirdAuth(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const { host, port = 3050, database = '/tmp/test.fdb', username = 'SYSDBA', password = 'masterkey' }
      = await request.json<{
        host: string; port?: number; database?: string;
        username?: string; password?: string;
      }>();

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const conn = await connectAndAccept(host, port, database, 8000);
    const { fs } = conn;

    const dpb = buildDPB(username, password);
    await fs.writer.write(buildAttachPacket(database, dpb));

    const authResp = await recvPacket(fs, 8000);

    fs.reader.releaseLock();
    fs.writer.releaseLock();
    fs.socket.close();

    if (authResp.opcode !== OP_RESPONSE) {
      return new Response(JSON.stringify({
        success: false,
        error: `Unexpected opcode ${authResp.opcode} after op_attach`,
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (authResp.statusError) {
      return new Response(JSON.stringify({
        success: false,
        authenticated: false,
        protocol: conn.protocol,
        error: authResp.statusError,
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      success: true,
      authenticated: true,
      dbHandle: authResp.handle,
      protocol: conn.protocol,
      architecture: conn.architecture,
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Auth failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Execute a SQL query against a Firebird database.
 * Body: { host, port?, database?, username, password, query? }
 * Default query: SELECT RDB$RELATION_NAME FROM RDB$RELATIONS WHERE RDB$SYSTEM_FLAG=1
 */
export async function handleFirebirdQuery(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const {
      host, port = 3050,
      database = '/tmp/test.fdb',
      username = 'SYSDBA', password = 'masterkey',
      query = "SELECT RDB$RELATION_NAME FROM RDB$RELATIONS WHERE RDB$SYSTEM_FLAG = 1",
    } = await request.json<{
      host: string; port?: number; database?: string;
      username?: string; password?: string; query?: string;
    }>();

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const conn = await connectAndAccept(host, port, database, 8000);
    const { fs } = conn;

    // ── Step 1: Attach ──
    const dpb = buildDPB(username, password);
    await fs.writer.write(buildAttachPacket(database, dpb));
    const attachResp = await recvPacket(fs, 8000);
    if (attachResp.opcode !== OP_RESPONSE || attachResp.statusError) {
      fs.reader.releaseLock(); fs.writer.releaseLock(); fs.socket.close();
      return new Response(JSON.stringify({
        success: false,
        error: attachResp.statusError ?? `Attach failed: opcode ${attachResp.opcode}`,
      }), { headers: { 'Content-Type': 'application/json' } });
    }
    const dbHandle = attachResp.handle ?? 0;

    // ── Step 2: Start read-only transaction ──
    await fs.writer.write(buildTransactionPacket(dbHandle));
    const trResp = await recvPacket(fs, 8000);
    if (trResp.opcode !== OP_RESPONSE || trResp.statusError) {
      fs.reader.releaseLock(); fs.writer.releaseLock(); fs.socket.close();
      return new Response(JSON.stringify({
        success: false,
        error: trResp.statusError ?? `Transaction failed: opcode ${trResp.opcode}`,
      }), { headers: { 'Content-Type': 'application/json' } });
    }
    const trHandle = trResp.handle ?? 0;

    // ── Step 3: Allocate statement ──
    await fs.writer.write(buildAllocateStatement(dbHandle));
    const allocResp = await recvPacket(fs, 8000);
    if (allocResp.opcode !== OP_RESPONSE || allocResp.statusError) {
      fs.reader.releaseLock(); fs.writer.releaseLock(); fs.socket.close();
      return new Response(JSON.stringify({
        success: false,
        error: allocResp.statusError ?? 'Statement allocation failed',
      }), { headers: { 'Content-Type': 'application/json' } });
    }
    const stmtHandle = allocResp.handle ?? 0;

    // ── Step 4: Prepare SQL ──
    await fs.writer.write(buildPrepareStatement(trHandle, stmtHandle, query));
    const prepResp = await recvPacket(fs, 8000);
    if (prepResp.opcode !== OP_RESPONSE || prepResp.statusError) {
      fs.reader.releaseLock(); fs.writer.releaseLock(); fs.socket.close();
      return new Response(JSON.stringify({
        success: false,
        error: prepResp.statusError ?? 'Prepare failed',
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // ── Step 5: Execute ──
    await fs.writer.write(buildExecute(trHandle, stmtHandle));
    const execResp = await recvPacket(fs, 8000);
    if (execResp.opcode !== OP_RESPONSE || execResp.statusError) {
      fs.reader.releaseLock(); fs.writer.releaseLock(); fs.socket.close();
      return new Response(JSON.stringify({
        success: false,
        error: execResp.statusError ?? 'Execute failed',
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // ── Step 6: Fetch rows ──
    await fs.writer.write(buildFetch(stmtHandle));
    const fetchResp = await recvPacket(fs, 8000);

    // Collect raw fetch data as printable strings
    const rows: string[] = [];
    if (fetchResp.data) {
      const text = dec.decode(fetchResp.data);
      const parts = text.split('\0').map(s => s.trim()).filter(s => s.length > 0);
      rows.push(...parts);
    }

    // ── Cleanup ──
    await fs.writer.write(buildCommit(trHandle));
    await fs.writer.write(buildDetach(dbHandle));
    fs.reader.releaseLock();
    fs.writer.releaseLock();
    fs.socket.close();

    return new Response(JSON.stringify({
      success: true,
      protocol: conn.protocol,
      architecture: conn.architecture,
      query,
      rows,
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Query failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle Firebird version query (alias for probe)
 */
export async function handleFirebirdVersion(request: Request): Promise<Response> {
  return handleFirebirdProbe(request);
}
