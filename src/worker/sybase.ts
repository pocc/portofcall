/**
 * Sybase Protocol Implementation (TDS - Tabular Data Stream)
 *
 * Sybase Adaptive Server Enterprise (ASE) is a relational database management
 * system developed by Sybase Inc. (now part of SAP). It uses the Tabular Data
 * Stream (TDS) protocol, which was later adopted by Microsoft for SQL Server.
 *
 * Protocol Overview:
 * - Port: 5000 (default, configurable)
 * - Transport: TCP
 * - Format: TDS (Tabular Data Stream) binary protocol
 * - Versions: TDS 4.x, 5.0 (Sybase), 7.x+ (Microsoft SQL Server)
 *
 * TDS Protocol Structure:
 * - Packet Header (8 bytes):
 *   - Type (1 byte): Packet type (Login, Query, Response, etc.)
 *   - Status (1 byte): Status flags (EOM, Ignore, etc.)
 *   - Length (2 bytes): Total packet length (big-endian)
 *   - SPID (2 bytes): Server Process ID (big-endian)
 *   - Packet Number (1 byte): Sequence number
 *   - Window (1 byte): Window size (unused)
 *
 * TDS 5.0 Login Packet:
 * - Fixed-length fields for hostname[30], username[30], password[30] (space-padded)
 * - Followed by length bytes for each field
 * - App name, server name, library name
 *
 * TDS Token Types (response):
 * - 0xAD: LOGINACK - login accepted
 * - 0xD1: ROW - result row data
 * - 0xFD: DONE - end of result set
 * - 0xAA: ERROR - error message
 * - 0xE3: ENVCHANGE - environment change (e.g. USE database)
 * - 0xA5: COLNAME - column names
 *
 * Reference:
 * - http://www.freetds.org/tds.html
 * - Sybase ASE documentation
 */

import { connect } from 'cloudflare:sockets';

interface SybaseRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface SybaseLoginRequest {
  host: string;
  port?: number;
  timeout?: number;
  username: string;
  password: string;
  database?: string;
  query?: string;
}

interface SybaseResponse {
  success: boolean;
  host: string;
  port: number;
  packetType?: number;
  packetTypeName?: string;
  status?: number;
  length?: number;
  isSybase?: boolean;
  rtt?: number;
  error?: string;
}

// TDS Packet Types
enum TDSPacketType {
  Query = 0x01,
  Login = 0x02,
  RPC = 0x03,
  Response = 0x04,
  Attention = 0x05,
  BulkLoad = 0x06,
  TransactionManager = 0x07,
  Login7 = 0x10,
  SSPI = 0x11,
  Prelogin = 0x12,
}

// TDS 5.0 token types
const TDS_TOKEN_LOGINACK = 0xAD;
const TDS_TOKEN_ROW = 0xD1;
const TDS_TOKEN_DONE = 0xFD;
const TDS_TOKEN_ERROR = 0xAA;
const TDS_TOKEN_ENVCHANGE = 0xE3;
const TDS_TOKEN_COLNAME = 0xA5;
const TDS_TOKEN_COLFMT = 0xA7;

/**
 * Write a fixed-length space-padded ASCII field into a buffer at the given offset.
 */
function writeFixedField(buf: Uint8Array, offset: number, value: string, fieldLen: number): number {
  const bytes = new TextEncoder().encode(value.substring(0, fieldLen));
  for (let i = 0; i < fieldLen; i++) {
    buf[offset + i] = i < bytes.length ? bytes[i] : 0x20; // space pad
  }
  return offset + fieldLen;
}

/**
 * XOR-obfuscate a password per TDS convention (XOR each byte with 0xA5).
 */
function obfuscatePassword(password: string): Uint8Array {
  const bytes = new TextEncoder().encode(password);
  const result = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    result[i] = bytes[i] ^ 0xA5;
  }
  return result;
}

/**
 * Build a TDS 5.0 Login packet (type 0x02).
 *
 * Fixed-size structure: 512-byte body following the 8-byte TDS header.
 * Fields: hostname[30]+len[1], username[30]+len[1], password[30]+len[1] (XOR 0xA5)
 * Followed by: hostprocess[30]+len[1], various flags, appname[30]+len[1],
 *              servername[30]+len[1], remotepwd[256], tds_version[4], etc.
 */
function buildTDS50Login(username: string, password: string, _database: string, hostname: string): Uint8Array {
  const body = new Uint8Array(512);
  body.fill(0x20); // Space-fill all fields

  let pos = 0;

  // hostname[30] + hostnameLen[1]
  const hostnameTrunc = hostname.substring(0, 30);
  writeFixedField(body, pos, hostnameTrunc, 30);
  pos += 30;
  body[pos++] = hostnameTrunc.length;

  // username[30] + usernameLen[1]
  const usernameTrunc = username.substring(0, 30);
  writeFixedField(body, pos, usernameTrunc, 30);
  pos += 30;
  body[pos++] = usernameTrunc.length;

  // password[30] + passwordLen[1] (XOR 0xA5 obfuscation)
  const obfPass = obfuscatePassword(password.substring(0, 30));
  for (let i = 0; i < 30; i++) {
    body[pos + i] = i < obfPass.length ? obfPass[i] : 0x20;
  }
  pos += 30;
  body[pos++] = Math.min(password.length, 30);

  // hostprocess[30] + len[1] (use PID-like value "1")
  writeFixedField(body, pos, '1', 30);
  pos += 30;
  body[pos++] = 1;

  // bulk copy flags (9 bytes)
  body[pos++] = 0x03; // int2type
  body[pos++] = 0x01; // int4type
  body[pos++] = 0x06; // flt4type
  body[pos++] = 0x06; // flt8type
  body[pos++] = 0x0A; // datetime4type
  body[pos++] = 0x09; // datetime8type
  body[pos++] = 0x00; // money4type
  body[pos++] = 0x00; // money8type
  body[pos++] = 0x00; // capabilitytype

  // appname[30] + len[1]
  const appName = 'portofcall';
  writeFixedField(body, pos, appName, 30);
  pos += 30;
  body[pos++] = appName.length;

  // servername[30] + len[1]
  const serverNameTrunc = hostname.substring(0, 30);
  writeFixedField(body, pos, serverNameTrunc, 30);
  pos += 30;
  body[pos++] = serverNameTrunc.length;

  // remotepwd[255+1]: unused, skip
  pos += 256;

  // tds_version[4]: TDS 5.0 = 0x05 0x00 0x00 0x00
  body[pos++] = 0x05;
  body[pos++] = 0x00;
  body[pos++] = 0x00;
  body[pos++] = 0x00;

  // progname[10] + progverLen[1]
  writeFixedField(body, pos, 'portofcall', 10);
  pos += 10;
  body[pos++] = 10;

  // progversion[4]: 1.0.0.0
  body[pos++] = 0x01;
  body[pos++] = 0x00;
  body[pos++] = 0x00;
  body[pos++] = 0x00;

  // noshort, flt4type, date4type
  body[pos++] = 0x00;
  body[pos++] = 0x00;
  body[pos++] = 0x00;

  // language[30] + len[1] + notchangelanguage[1]
  writeFixedField(body, pos, 'us_english', 30);
  pos += 30;
  body[pos++] = 10;
  body[pos++] = 0x01;

  // charset[30] + len[1] + charconvert[1]
  writeFixedField(body, pos, 'iso_1', 30);
  pos += 30;
  body[pos++] = 5;
  body[pos++] = 0x00;

  // packetsize[6]
  writeFixedField(body, pos, '512   ', 6);

  // dummy[8]: zeros (already zero from fill)

  // Build TDS packet header: type=0x02, status=0x01 (EOM), length BE
  const totalLen = 8 + 512;
  const packet = new Uint8Array(totalLen);
  const pView = new DataView(packet.buffer);
  packet[0] = TDSPacketType.Login; // 0x02
  packet[1] = 0x01; // EOM
  pView.setUint16(2, totalLen, false); // big-endian length
  pView.setUint16(4, 0, false);        // SPID
  packet[6] = 0x01;  // packet number
  packet[7] = 0x00;  // window
  packet.set(body, 8);

  return packet;
}

/**
 * Build a TDS SQL query packet (type 0x01).
 */
function buildTDSQuery(sql: string): Uint8Array {
  const sqlBytes = new TextEncoder().encode(sql);
  const totalLen = 8 + sqlBytes.length;
  const packet = new Uint8Array(totalLen);
  const pView = new DataView(packet.buffer);
  packet[0] = TDSPacketType.Query; // 0x01
  packet[1] = 0x01; // EOM
  pView.setUint16(2, totalLen, false);
  pView.setUint16(4, 0, false);
  packet[6] = 0x01;
  packet[7] = 0x00;
  packet.set(sqlBytes, 8);
  return packet;
}

/**
 * Build TDS Prelogin packet (Type 0x12)
 * Used in newer TDS versions (7.x+) for initial handshake
 */
function buildTDSPrelogin(): Uint8Array {
  // Option list: VERSION (5B) + ENCRYPTION (5B) + TERMINATOR (1B) = 11 bytes
  // Data section: VERSION data (6B) + ENCRYPTION data (1B) = 7 bytes
  // Total payload: 11 + 7 = 18 bytes
  const optListLen = 11; // 2 options * 5 bytes + 1 terminator
  const dataLen    = 7;  // 6 (version) + 1 (encryption)
  const payloadLen = optListLen + dataLen;

  const preloginData = new Uint8Array(payloadLen);
  let offset = 0;

  // VERSION option (token=0x00): data starts at byte optListLen (11), length 6
  preloginData[offset++] = 0x00; // Token: VERSION
  preloginData[offset++] = (optListLen >> 8) & 0xFF;        // Offset high byte
  preloginData[offset++] = optListLen & 0xFF;                // Offset low byte
  preloginData[offset++] = 0x00;                             // Length high byte
  preloginData[offset++] = 0x06;                             // Length low byte (6)

  // ENCRYPTION option (token=0x01): data starts at byte optListLen+6 (17), length 1
  preloginData[offset++] = 0x01; // Token: ENCRYPTION
  preloginData[offset++] = ((optListLen + 6) >> 8) & 0xFF;  // Offset high byte
  preloginData[offset++] = (optListLen + 6) & 0xFF;          // Offset low byte
  preloginData[offset++] = 0x00;                             // Length high byte
  preloginData[offset++] = 0x01;                             // Length low byte (1)

  preloginData[offset++] = 0xFF; // Terminator

  // VERSION data: 9.0.0.0 (major=9, minor=0, build_hi=0, build_lo=0, subBuild=0)
  preloginData[offset++] = 9;    // major
  preloginData[offset++] = 0;    // minor
  preloginData[offset++] = 0;    // build high
  preloginData[offset++] = 0;    // build low
  preloginData[offset++] = 0;    // sub-build high
  preloginData[offset++] = 0;    // sub-build low

  // ENCRYPTION data: 0x00 = ENCRYPT_OFF (no TLS)
  preloginData[offset] = 0x00;

  const totalLen = 8 + preloginData.length;
  const packet = new Uint8Array(totalLen);
  const pView = new DataView(packet.buffer);
  packet[0] = TDSPacketType.Prelogin; // 0x12
  packet[1] = 0x01; // EOM
  pView.setUint16(2, totalLen, false); // big-endian total length
  pView.setUint16(4, 0, false);        // SPID
  packet[6] = 0x01; // packet number
  packet[7] = 0x00; // window
  packet.set(preloginData, 8);

  return packet;
}

/**
 * Parse TDS packet header
 */
function parseTDSPacket(data: Uint8Array): {
  type: number;
  status: number;
  length: number;
  spid: number;
  packetNumber: number;
  window: number;
  payload: Uint8Array;
} | null {
  if (data.length < 8) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const type = data[0];
  const status = data[1];
  const length = view.getUint16(2, false);
  const spid = view.getUint16(4, false);
  const packetNumber = data[6];
  const window = data[7];
  // Slice exactly to the declared packet length so callers see only one packet's payload.
  // If the buffer contains more data than this packet, the extra bytes are NOT included here
  // (they belong to the next packet). readAtLeast may return oversized buffers, so always
  // use the declared length as the upper bound, not data.length.
  const payloadEnd = Math.min(length, data.length);
  const payload = data.slice(8, payloadEnd);

  return { type, status, length, spid, packetNumber, window, payload };
}

/**
 * Read at least N bytes from a socket reader with timeout.
 */
async function readAtLeast(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  n: number,
  timeoutMs: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Read timeout')), timeoutMs)
  );

  while (total < n) {
    const result = await Promise.race([reader.read(), timeoutPromise]);
    if (result.done || !result.value) throw new Error(`Connection closed after ${total}/${n} bytes`);
    chunks.push(result.value);
    total += result.value.length;
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    combined.set(c, offset);
    offset += c.length;
  }
  return combined;
}

/**
 * Parse a TDS 5.0 token stream from a response payload.
 * Returns login success/failure, error messages, column names, and row indicators.
 */
function parseTDSTokenStream(payload: Uint8Array): {
  loginAck: boolean;
  loginVersion?: string;
  serverName?: string;
  errorMessages: string[];
  rows: string[][];
  columnNames: string[];
  doneStatus?: number;
} {
  const decoder = new TextDecoder('ascii');
  let pos = 0;
  const errorMessages: string[] = [];
  const rows: string[][] = [];
  const columnNames: string[] = [];
  let loginAck = false;
  let loginVersion: string | undefined;
  let serverName: string | undefined;
  let doneStatus: number | undefined;

  while (pos < payload.length) {
    const tokenType = payload[pos];
    pos++;

    if (tokenType === TDS_TOKEN_LOGINACK) {
      // LOGINACK: length[2B] ack_type[1B] tds_version[4B] server_name_len[1B] server_name[...]
      if (pos + 2 > payload.length) break;
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const tokenLen = view.getUint16(pos, true);  // TDS 5.0: little-endian
      pos += 2;
      if (pos + tokenLen > payload.length) break;
      const ackType = payload[pos];
      loginAck = ackType === 5;
      const tdsVerBytes = payload.slice(pos + 1, pos + 5);
      loginVersion = `${tdsVerBytes[0]}.${tdsVerBytes[1]}`;
      const svrNameLen = payload[pos + 5];
      serverName = decoder.decode(payload.slice(pos + 6, pos + 6 + svrNameLen));
      pos += tokenLen;

    } else if (tokenType === TDS_TOKEN_ERROR) {
      // ERROR: length[2B] msg_number[4B] state[1B] severity[1B] msg_len[2B] msg[...]
      if (pos + 2 > payload.length) break;
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const tokenLen = view.getUint16(pos, true);  // TDS 5.0: little-endian
      pos += 2;
      if (pos + tokenLen > payload.length) break;
      const msgLen = view.getUint16(pos + 6, true);  // TDS 5.0: little-endian
      const msg = decoder.decode(payload.slice(pos + 8, pos + 8 + msgLen));
      errorMessages.push(msg);
      pos += tokenLen;

    } else if (tokenType === TDS_TOKEN_ENVCHANGE) {
      // ENVCHANGE: length[2B LE] type[1B] newval[...] oldval[...]
      if (pos + 2 > payload.length) break;
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const tokenLen = view.getUint16(pos, true);  // TDS 5.0: little-endian
      pos += 2;
      pos += tokenLen;

    } else if (tokenType === TDS_TOKEN_COLNAME) {
      // COLNAME: length[2B LE] then for each column: col_name_len[1B] col_name[...]
      if (pos + 2 > payload.length) break;
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const tokenLen = view.getUint16(pos, true);  // TDS 5.0: little-endian
      pos += 2;
      const endPos = pos + tokenLen;
      while (pos < endPos) {
        const nameLen = payload[pos++];
        if (nameLen > 0) {
          columnNames.push(decoder.decode(payload.slice(pos, pos + nameLen)));
          pos += nameLen;
        }
      }

    } else if (tokenType === TDS_TOKEN_COLFMT) {
      // COLFMT: length[2B LE] column format info — skip
      if (pos + 2 > payload.length) break;
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const tokenLen = view.getUint16(pos, true);  // TDS 5.0: little-endian
      pos += 2;
      pos += tokenLen;

    } else if (tokenType === TDS_TOKEN_ROW) {
      // ROW: variable length — without full COLFMT we can't parse, just count
      rows.push(['<row>']);
      pos = payload.length; // skip rest of stream

    } else if (tokenType === TDS_TOKEN_DONE) {
      // DONE: status[2B] curcmd[2B] count[4B]
      if (pos + 8 > payload.length) break;
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      doneStatus = view.getUint16(pos, true);  // TDS 5.0: little-endian
      pos += 8;

    } else {
      // Unknown token — stop parsing
      break;
    }
  }

  return { loginAck, loginVersion, serverName, errorMessages, rows, columnNames, doneStatus };
}

/**
 * Probe Sybase server by sending TDS prelogin packet.
 * Detects Sybase ASE and TDS protocol support.
 */
export async function handleSybaseProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SybaseRequest;
    const { host, port = 5000, timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies SybaseResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        error: 'Port must be between 1 and 65535',
      } satisfies SybaseResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const prelogin = buildTDSPrelogin();
      const writer = socket.writable.getWriter();
      await writer.write(prelogin);
      writer.releaseLock();

      const reader = socket.readable.getReader();
      const { value, done } = await Promise.race([reader.read(), timeoutPromise]);

      if (done || !value) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'No response from Sybase server',
        } satisfies SybaseResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const parsed = parseTDSPacket(value);
      if (!parsed) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Invalid TDS packet format',
        } satisfies SybaseResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const rtt = Date.now() - start;
      reader.releaseLock();
      socket.close();

      const packetTypeNames: Record<number, string> = {
        [TDSPacketType.Query]: 'Query',
        [TDSPacketType.Login]: 'Login',
        [TDSPacketType.RPC]: 'RPC',
        [TDSPacketType.Response]: 'Response',
        [TDSPacketType.Attention]: 'Attention',
        [TDSPacketType.BulkLoad]: 'Bulk Load',
        [TDSPacketType.TransactionManager]: 'Transaction Manager',
        [TDSPacketType.Login7]: 'Login7',
        [TDSPacketType.SSPI]: 'SSPI',
        [TDSPacketType.Prelogin]: 'Prelogin',
      };

      // A Sybase ASE server responds to Pre-Login with a Tabular Result packet (type 0x04).
      // Type 0x12 (Prelogin) in a server response would be atypical; the definitive
      // indicator is type 0x04 (Response/Tabular Result).
      const isSybase = parsed.type === TDSPacketType.Response;

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        packetType: parsed.type,
        packetTypeName: packetTypeNames[parsed.type] || `Unknown (0x${parsed.type.toString(16)})`,
        status: parsed.status,
        length: parsed.length,
        isSybase,
        rtt,
      } satisfies SybaseResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      socket.close();
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      host: '',
      port: 5000,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies SybaseResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Get Sybase server version information.
 * Same as probe but with focus on version extraction.
 */
export async function handleSybaseVersion(request: Request): Promise<Response> {
  return handleSybaseProbe(request);
}

/**
 * Attempt TDS 5.0 login to a Sybase ASE server.
 * POST /api/sybase/login
 *
 * Sends a TDS 5.0 login packet and reports whether authentication succeeded.
 * Request body JSON: { host, port?, username, password, database?, timeout? }
 */
export async function handleSybaseLogin(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SybaseLoginRequest;
    const { host, port = 5000, username, password, timeout = 15000 } = body;

    if (!host || !username || !password) {
      return new Response(JSON.stringify({
        success: false,
        error: 'host, username, and password are required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      const loginPacket = buildTDS50Login(username, password, body.database || 'master', host);
      await writer.write(loginPacket);

      let allPayload = new Uint8Array(0);
      let loginAck = false;
      let errorMessages: string[] = [];
      let serverName: string | undefined;
      let loginVersion: string | undefined;

      for (let i = 0; i < 5; i++) {
        const chunk = await readAtLeast(reader, 8, 5000);
        const parsed = parseTDSPacket(chunk);
        if (!parsed) break;

        const merged = new Uint8Array(allPayload.length + parsed.payload.length);
        merged.set(allPayload, 0);
        merged.set(parsed.payload, allPayload.length);
        allPayload = merged;

        const tokenInfo = parseTDSTokenStream(allPayload);
        loginAck = tokenInfo.loginAck;
        errorMessages = tokenInfo.errorMessages;
        serverName = tokenInfo.serverName;
        loginVersion = tokenInfo.loginVersion;

        if (loginAck || errorMessages.length > 0) break;
        if (parsed.status & 0x01) break;
      }

      const rtt = Date.now() - start;
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: loginAck,
        host,
        port,
        rtt,
        loginAccepted: loginAck,
        serverName: serverName || null,
        tdsVersion: loginVersion || null,
        errors: errorMessages,
        message: loginAck
          ? `Login succeeded for user '${username}'`
          : `Login failed: ${errorMessages.join('; ') || 'Unknown reason'}`,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Execute a SQL query on a Sybase ASE server via TDS 5.0.
 * POST /api/sybase/query
 *
 * Authenticates with TDS 5.0 login, sends a SQL batch, and parses the token stream.
 * Best suited for simple queries like SELECT @@version or SELECT 1.
 *
 * Request body JSON: { host, port?, username, password, database?, query? }
 */
export async function handleSybaseQuery(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SybaseLoginRequest;
    const {
      host,
      port = 5000,
      username,
      password,
      database = 'master',
      query = 'SELECT @@version',
      timeout = 20000,
    } = body;

    if (!host || !username || !password) {
      return new Response(JSON.stringify({
        success: false,
        error: 'host, username, and password are required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Step 1: Login
      const loginPacket = buildTDS50Login(username, password, database, host);
      await writer.write(loginPacket);

      let allPayload = new Uint8Array(0);
      let loginAck = false;
      let errorMessages: string[] = [];
      let serverName: string | undefined;

      for (let i = 0; i < 5; i++) {
        const chunk = await readAtLeast(reader, 8, 8000);
        const parsed = parseTDSPacket(chunk);
        if (!parsed) break;

        const merged = new Uint8Array(allPayload.length + parsed.payload.length);
        merged.set(allPayload, 0);
        merged.set(parsed.payload, allPayload.length);
        allPayload = merged;

        const tokenInfo = parseTDSTokenStream(allPayload);
        loginAck = tokenInfo.loginAck;
        errorMessages = tokenInfo.errorMessages;
        serverName = tokenInfo.serverName;

        if (loginAck || errorMessages.length > 0) break;
        if (parsed.status & 0x01) break;
      }

      if (!loginAck) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          error: `Login failed: ${errorMessages.join('; ') || 'Unknown reason'}`,
          loginAck: false,
          errors: errorMessages,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Step 2: Send SQL query
      let actualQuery = query;
      if (database && database !== 'master') {
        actualQuery = `USE ${database}\n${query}`;
      }

      const queryPacket = buildTDSQuery(actualQuery);
      await writer.write(queryPacket);

      // Step 3: Read query response
      let queryPayload = new Uint8Array(0);
      let queryErrorMessages: string[] = [];
      let columnNames: string[] = [];
      let rowCount = 0;

      for (let i = 0; i < 10; i++) {
        let chunk: Uint8Array;
        try {
          chunk = await readAtLeast(reader, 8, 8000);
        } catch {
          break;
        }
        const parsed = parseTDSPacket(chunk);
        if (!parsed) break;

        const merged = new Uint8Array(queryPayload.length + parsed.payload.length);
        merged.set(queryPayload, 0);
        merged.set(parsed.payload, queryPayload.length);
        queryPayload = merged;

        const tokenInfo = parseTDSTokenStream(queryPayload);
        queryErrorMessages = tokenInfo.errorMessages;
        columnNames = tokenInfo.columnNames;
        rowCount = tokenInfo.rows.length;

        if (tokenInfo.doneStatus !== undefined) break;
        if (parsed.status & 0x01) break;
      }

      const rtt = Date.now() - start;
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const rawHex = Array.from(queryPayload.slice(0, 256))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' ');

      return new Response(JSON.stringify({
        success: queryErrorMessages.length === 0,
        host,
        port,
        rtt,
        loginAck,
        serverName: serverName || null,
        query: actualQuery,
        columnNames,
        rowCount,
        errors: queryErrorMessages,
        rawPayloadHex: rawHex,
        message: queryErrorMessages.length === 0
          ? `Query executed. Columns: ${columnNames.join(', ') || '(none)'}, rows: ${rowCount}`
          : `Query error: ${queryErrorMessages.join('; ')}`,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Execute a Sybase stored procedure via TDS 5.0 EXECUTE statement.
 *
 * Sybase ASE executes stored procs via the TDS language packet with the
 * EXECUTE statement — `EXEC[UTE] procname param1, param2, ...`.
 * String params are single-quoted and escaped; numeric params are unquoted.
 *
 * Body: { host, port?, username, password, database?, procname, params?, timeout? }
 */
export async function handleSybaseProc(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number; timeout?: number;
      username: string; password: string;
      database?: string; procname: string;
      params?: Array<string | number | null>;
    };
    const {
      host, port = 5000, timeout = 20000,
      username, password, database = 'master', procname,
    } = body;
    const params = body.params ?? [];

    if (!host || !username || !password) {
      return new Response(JSON.stringify({ success: false, error: 'host, username, and password are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!procname) {
      return new Response(JSON.stringify({ success: false, error: 'procname is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Format parameters for EXECUTE statement
    const formattedParams = params.map(p => {
      if (p === null || p === undefined) return 'NULL';
      if (typeof p === 'number') return String(p);
      // Escape single quotes
      return `'${String(p).replace(/'/g, "''")}'`;
    });
    const execSql = formattedParams.length > 0
      ? `EXECUTE ${procname} ${formattedParams.join(', ')}`
      : `EXECUTE ${procname}`;

    const start = Date.now();
    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    try {
      await Promise.race([socket.opened, timeoutPromise]);
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Login
      await writer.write(buildTDS50Login(username, password, database, host));

      let allPayload = new Uint8Array(0);
      let loginAck = false;
      let serverName: string | undefined;

      for (let i = 0; i < 5; i++) {
        const chunk = await readAtLeast(reader, 8, 8000);
        const parsed = parseTDSPacket(chunk);
        if (!parsed) break;

        const merged = new Uint8Array(allPayload.length + parsed.payload.length);
        merged.set(allPayload, 0);
        merged.set(parsed.payload, allPayload.length);
        allPayload = merged;

        const tokenInfo = parseTDSTokenStream(allPayload);
        if (tokenInfo.loginAck) { loginAck = true; serverName = tokenInfo.serverName; }
        if (tokenInfo.doneStatus !== undefined) break;
        if (parsed.status & 0x01) break;
      }

      if (!loginAck) {
        writer.releaseLock(); reader.releaseLock(); socket.close();
        return new Response(JSON.stringify({ success: false, host, port, error: 'Login failed' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }

      // Execute stored procedure via EXECUTE statement
      await writer.write(buildTDSQuery(execSql));

      let resultPayload = new Uint8Array(0);
      let errorMessages: string[] = [];
      let columnNames: string[] = [];
      let rowCount = 0;

      for (let i = 0; i < 10; i++) {
        let chunk: Uint8Array;
        try { chunk = await readAtLeast(reader, 8, 8000); } catch { break; }
        const parsed = parseTDSPacket(chunk);
        if (!parsed) break;

        const merged = new Uint8Array(resultPayload.length + parsed.payload.length);
        merged.set(resultPayload, 0);
        merged.set(parsed.payload, resultPayload.length);
        resultPayload = merged;

        const tokenInfo = parseTDSTokenStream(resultPayload);
        errorMessages = tokenInfo.errorMessages;
        columnNames = tokenInfo.columnNames;
        rowCount = tokenInfo.rows.length;

        if (tokenInfo.doneStatus !== undefined) break;
        if (parsed.status & 0x01) break;
      }

      const rtt = Date.now() - start;
      writer.releaseLock(); reader.releaseLock(); socket.close();

      const rawHex = Array.from(resultPayload.slice(0, 256))
        .map(b => b.toString(16).padStart(2, '0')).join(' ');

      return new Response(JSON.stringify({
        success: errorMessages.length === 0,
        host, port, rtt, loginAck,
        serverName: serverName || null,
        procname, params,
        execSql,
        columnNames, rowCount,
        errors: errorMessages,
        rawPayloadHex: rawHex,
        message: errorMessages.length === 0
          ? `Proc executed. Columns: ${columnNames.join(', ') || '(none)'}, rows: ${rowCount}`
          : `Proc error: ${errorMessages.join('; ')}`,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
