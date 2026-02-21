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

// ─── Protocol versions & connection constants ──────────────────────────────
// CONNECT_VERSION2 (2) is for protocol 10-12; CONNECT_VERSION3 (3) is for protocol 13+
const CONNECT_VERSION3     = 3;
// PROTOCOL_VERSION10 (10) is the base wire protocol; 13 is the current widely-supported version
const PROTOCOL_VERSION13   = 13;
const ARCHITECTURE_GENERIC = 1;    // arch_generic (XDR, big-endian)

// Connection types (ptype): PTYPE_RPC=2, PTYPE_BATCH_SEND=3, PTYPE_LAZY_SEND=4
const PTYPE_RPC            = 2;    // Remote procedure call
const PTYPE_LAZY_SEND      = 4;    // Lazy send (protocol 11+)

// User identification tags for p_cnct_user_id
const CNCT_user            = 1;    // User name
const CNCT_host            = 4;    // Client hostname

const enc = new TextEncoder();
const dec = new TextDecoder();

// ─── Packet helpers ──────────────────────────────────────────────────────────

function u32BE(v: number): number[] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

/**
 * XDR-style opaque/string encoding: [u32BE length][bytes][pad to 4-byte boundary]
 *
 * The Firebird wire protocol uses standard XDR encoding for strings.
 * The length field is the actual byte count of the string (no null terminator).
 * The data is padded with zero bytes to the next 4-byte boundary.
 *
 * Previous bug: included a null terminator in the length and data, which is
 * a C convention only and not part of the XDR wire encoding.
 */
function xdrString(s: string): number[] {
  const bytes = enc.encode(s);
  const len = bytes.length;
  const pad = (4 - (len % 4)) % 4;
  return [...u32BE(len), ...bytes, ...new Array(pad).fill(0)];
}

/**
 * XDR-style opaque encoding for raw byte arrays: [u32BE length][bytes][pad to 4-byte boundary]
 */
function xdrOpaque(data: Uint8Array | number[]): number[] {
  const bytes = data instanceof Uint8Array ? [...data] : data;
  const len = bytes.length;
  const pad = (4 - (len % 4)) % 4;
  return [...u32BE(len), ...bytes, ...new Array(pad).fill(0)];
}

/** Read a u32 big-endian from a Uint8Array at offset */
function readU32(buf: Uint8Array, offset: number): number {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(offset);
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

/**
 * Build op_connect packet.
 *
 * Wire format (from Firebird protocol.h P_CNCT struct):
 *   op_connect          u32   opcode (1)
 *   p_cnct_operation    u32   intended follow-up operation (op_attach=19)
 *   p_cnct_cversion     u32   connect version (CONNECT_VERSION2=2 for protocol 10-12,
 *                              CONNECT_VERSION3=3 for protocol 13+)
 *   p_cnct_client       u32   client architecture (arch_generic=1)
 *   p_cnct_file         xdr_string   database file path
 *   p_cnct_count        u32   number of protocol versions offered
 *   p_cnct_user_id      xdr_opaque   user identification (CNCT_user + CNCT_host tags)
 *   [protocol versions]  count * 5 u32s each:
 *     p_cnct_version      u32   protocol version number
 *     p_cnct_architecture u32   architecture type
 *     p_cnct_min_type     u32   minimum connection type (ptype)
 *     p_cnct_max_type     u32   maximum connection type (ptype)
 *     p_cnct_weight       u32   preference weight
 *
 * Previous bugs fixed:
 *   - p_cnct_operation was 0 (no-op); should be OP_ATTACH (19)
 *   - Missing p_cnct_cversion and p_cnct_client fields
 *   - Protocol array field 4 was the version again instead of max_type
 */
function buildConnectPacket(database: string, username = 'portofcall'): Uint8Array {
  // Build user identification buffer: CNCT_user tag + CNCT_host tag
  const userBytes = enc.encode(username);
  const hostBytes = enc.encode('portofcall');
  const userId: number[] = [
    CNCT_user, userBytes.length, ...userBytes,
    CNCT_host, hostBytes.length, ...hostBytes,
  ];

  const parts: number[] = [
    ...u32BE(OP_CONNECT),
    ...u32BE(OP_ATTACH),               // p_cnct_operation: intended next op
    ...u32BE(CONNECT_VERSION3),        // p_cnct_cversion: connect version 3 for protocol 13
    ...u32BE(ARCHITECTURE_GENERIC),    // p_cnct_client: client architecture
    ...xdrString(database),            // p_cnct_file: database path (XDR string)
    ...u32BE(1),                       // p_cnct_count: 1 protocol version offered
    ...xdrOpaque(new Uint8Array(userId)), // p_cnct_user_id: user identification
    // Protocol version entry (5 x u32):
    ...u32BE(PROTOCOL_VERSION13),      // p_cnct_version: version 13
    ...u32BE(ARCHITECTURE_GENERIC),    // p_cnct_architecture: generic (XDR)
    ...u32BE(PTYPE_RPC),               // p_cnct_min_type: minimum ptype
    ...u32BE(PTYPE_LAZY_SEND),         // p_cnct_max_type: maximum ptype
    ...u32BE(2),                       // p_cnct_weight: preference weight
  ];
  return new Uint8Array(parts);
}

/**
 * Build op_attach packet.
 *
 * Wire format (from Firebird protocol.h P_ATCH struct):
 *   op_attach           u32          opcode (19)
 *   p_atch_file         xdr_string   database file path
 *   p_atch_dpb          xdr_opaque   Database Parameter Block (DPB)
 *
 * Previous bug: had a spurious u32(0) between the opcode and the database
 * path string.  No such field exists in the P_ATCH struct; the opcode is
 * immediately followed by the XDR-encoded path string.  That extra 4-byte
 * word shifted every subsequent field by 4 bytes, causing every op_attach
 * to be rejected by the server with a protocol framing error.
 */
function buildAttachPacket(database: string, dpb: Uint8Array): Uint8Array {
  const parts: number[] = [
    ...u32BE(OP_ATTACH),
    ...xdrString(database),    // database path (XDR string encoding)
    ...xdrOpaque(dpb),         // DPB (XDR opaque encoding)
  ];
  return new Uint8Array(parts);
}

/**
 * Build op_transaction packet with a read-only TPB.
 *
 * Wire format:
 *   op_transaction  u32         opcode (29)
 *   p_sttr_database u32         database handle
 *   p_sttr_tpb      xdr_opaque  Transaction Parameter Block
 */
function buildTransactionPacket(dbHandle: number): Uint8Array {
  const tpb = new Uint8Array([isc_tpb_version3, isc_tpb_read, isc_tpb_concurrency, isc_tpb_wait]);
  return new Uint8Array([
    ...u32BE(OP_TRANSACTION),
    ...u32BE(dbHandle),
    ...xdrOpaque(tpb),
  ]);
}

/** Build op_allocate_statement */
function buildAllocateStatement(dbHandle: number): Uint8Array {
  return new Uint8Array([...u32BE(OP_ALLOCATE_STATEMENT), ...u32BE(dbHandle)]);
}

/**
 * Build op_prepare_statement packet.
 *
 * Wire format (from Firebird protocol.h P_SQLST struct):
 *   op_prepare_statement  u32         opcode (64)
 *   p_sqlst_transaction   u32         transaction handle
 *   p_sqlst_statement     u32         statement handle
 *   p_sqlst_SQL_dialect   u32         SQL dialect (3 = current)
 *   p_sqlst_SQL_str       xdr_string  SQL text
 *   p_sqlst_items         xdr_opaque  describe items buffer
 *   p_sqlst_buffer_length u32         max length for describe output
 */
function buildPrepareStatement(trHandle: number, stmtHandle: number, sql: string): Uint8Array {
  return new Uint8Array([
    ...u32BE(OP_PREPARE_STATEMENT),
    ...u32BE(trHandle),
    ...u32BE(stmtHandle),
    ...u32BE(3),                             // SQL dialect 3
    ...xdrString(sql),                       // SQL text (XDR string)
    ...xdrOpaque(new Uint8Array(0)),         // describe_items (empty)
    ...u32BE(65535),                         // max describe buffer length
  ]);
}

/**
 * Build op_execute packet (no input parameters).
 *
 * Wire format (from Firebird protocol.h P_SQLDATA struct):
 *   op_execute          u32         opcode (63)
 *   p_sqldata_statement u32         statement handle
 *   p_sqldata_transaction u32       transaction handle
 *   p_sqldata_blr       xdr_opaque  BLR descriptor for input message (empty = no params)
 *   p_sqldata_message_number u32    message number (0)
 *   p_sqldata_messages  u32         message count (0 = no input data)
 */
function buildExecute(trHandle: number, stmtHandle: number): Uint8Array {
  return new Uint8Array([
    ...u32BE(OP_EXECUTE),
    ...u32BE(stmtHandle),
    ...u32BE(trHandle),
    ...xdrOpaque(new Uint8Array(0)),  // BLR descriptor (empty = no input params)
    ...u32BE(0),                      // message_number
    ...u32BE(0),                      // message_count (0 = no input message follows)
  ]);
}

/**
 * Build op_fetch packet.
 *
 * Wire format (from Firebird protocol.h P_SQLDATA struct):
 *   op_fetch            u32         opcode (65)
 *   p_sqldata_statement u32         statement handle
 *   p_sqldata_blr       xdr_opaque  BLR output message descriptor
 *   p_sqldata_message_number u32    message number (0)
 *   p_sqldata_messages  u32         fetch count (rows to retrieve per call)
 *
 * Note: With an empty BLR descriptor, the server returns raw data in
 * the response. For proper row parsing you would need a BLR that
 * describes the output columns. This implementation fetches raw data
 * and does best-effort text extraction.
 */
function buildFetch(stmtHandle: number): Uint8Array {
  return new Uint8Array([
    ...u32BE(OP_FETCH),
    ...u32BE(stmtHandle),
    ...xdrOpaque(new Uint8Array(0)),  // BLR descriptor (empty)
    ...u32BE(0),                      // message_number
    ...u32BE(200),                    // fetch count
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
  const opcode = new DataView(opcodeBytes.buffer, opcodeBytes.byteOffset, opcodeBytes.byteLength).getUint32(0);

  if (opcode === OP_ACCEPT) {
    // op_accept: [version 4][architecture 4][type 4]
    const body = await recvBytes(s, 12, timeoutMs);
    return { opcode, data: body };
  }

  if (opcode === OP_REJECT) {
    return { opcode };
  }

  if (opcode === OP_RESPONSE) {
    // op_response wire format (from Firebird protocol.h P_RESP struct):
    //   p_resp_object     u32         handle / object ID
    //   p_resp_blob_id    u64         blob ID (8 bytes)
    //   p_resp_data       xdr_opaque  response data buffer [u32 len][data][pad]
    //   p_resp_status_vector           ISC status vector (sequence of typed u32 entries)

    // Read fixed header: handle (4) + blob_id (8) = 12 bytes
    const header = await recvBytes(s, 12, timeoutMs);
    const handle = readU32(header, 0);
    // blob_id at offset 4..11 (unused here)

    // Read response data (XDR opaque: u32 length + data + padding)
    const dataLenBuf = await recvBytes(s, 4, timeoutMs);
    const dataLen = readU32(dataLenBuf, 0);
    if (dataLen > 0) {
      const dataPad = (4 - (dataLen % 4)) % 4;
      await recvBytes(s, dataLen + dataPad, timeoutMs); // consume response data + padding
    }

    // Read ISC status vector: sequence of u32-typed entries terminated by isc_arg_end (0)
    // Each entry starts with a u32 argument type:
    //   0 = isc_arg_end (terminates vector)
    //   1 = isc_arg_gds: followed by u32 error code
    //   2 = isc_arg_string: followed by XDR string
    //   4 = isc_arg_number: followed by u32 number
    //   5 = isc_arg_interpreted: followed by XDR string (interpreted message)
    //  19 = isc_arg_sql_state: followed by XDR string (SQLSTATE code)
    const msgs: string[] = [];
    let statusError: string | undefined;

     
    while (true) {
      const typeBuf = await recvBytes(s, 4, timeoutMs);
      const argType = readU32(typeBuf, 0);

      if (argType === 0) break; // isc_arg_end

      if (argType === 1) {
        // isc_arg_gds: u32 ISC error code
        await recvBytes(s, 4, timeoutMs); // consume error code
        continue;
      }

      if (argType === 2 || argType === 5 || argType === 19) {
        // isc_arg_string / isc_arg_interpreted / isc_arg_sql_state: XDR string
        const strLenBuf = await recvBytes(s, 4, timeoutMs);
        const strLen = readU32(strLenBuf, 0);
        const strPad = (4 - (strLen % 4)) % 4;
        if (strLen > 0) {
          const strData = await recvBytes(s, strLen + strPad, timeoutMs);
          const text = dec.decode(strData.subarray(0, strLen));
          if (argType === 19) {
            msgs.push(`SQLSTATE ${text}`);
          } else {
            msgs.push(text);
          }
        }
        continue;
      }

      if (argType === 4) {
        // isc_arg_number: u32 value
        await recvBytes(s, 4, timeoutMs);
        continue;
      }

      // Unknown arg type: assume u32 value and skip
      await recvBytes(s, 4, timeoutMs);
    }

    if (msgs.length > 0) {
      statusError = msgs.join('; ');
    }

    return { opcode, handle, statusError };
  }

  if (opcode === OP_FETCH_RESPONSE) {
    // [fetch_status 4][count 4]
    const body = await recvBytes(s, 8, timeoutMs);
    const fetchStatus = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0);
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

  const dv = new DataView(resp.data.buffer, resp.data.byteOffset, resp.data.byteLength);
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

    if (typeof port !== 'number' || port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
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

    if (typeof port !== 'number' || port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
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

    if (typeof port !== 'number' || port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
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
