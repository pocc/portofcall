/**
 * TDS (Tabular Data Stream) Protocol Support for Cloudflare Workers
 * Implements TDS Pre-Login handshake, Login7 authentication, and SQL query execution
 * for MS SQL Server connectivity.
 *
 * Connection flow:
 * 1. Client sends Pre-Login packet (type 0x12) with version/encryption options
 * 2. Server responds with Pre-Login response containing server version and encryption support
 * 3. Client sends Login7 packet (type 0x10) with credentials
 * 4. Server responds with LOGINACK, ENVCHANGE, INFO/ERROR, and DONE tokens
 * 5. Client sends SQL Batch packet (type 0x01) with query text
 * 6. Server responds with COLMETADATA, ROW, and DONE tokens
 *
 * Spec: https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-tds/
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// ---------------------------------------------------------------------------
// TDS packet types
// ---------------------------------------------------------------------------
const TDS_SQL_BATCH   = 0x01;
const TDS_LOGIN7      = 0x10;
const TDS_PRELOGIN    = 0x12;

// TDS packet status
const STATUS_EOM      = 0x01; // End of message

// Pre-Login option tokens
const PL_OPTION_VERSION    = 0x00;
const PL_OPTION_ENCRYPTION = 0x01;
const PL_OPTION_INSTOPT    = 0x02;
const PL_OPTION_THREADID   = 0x03;
const PL_OPTION_MARS       = 0x04;
const PL_OPTION_TERMINATOR = 0xff;

// Encryption values
const ENCRYPT_OFF     = 0x00;
const ENCRYPT_ON      = 0x01;
const ENCRYPT_NOT_SUP = 0x02;
const ENCRYPT_REQ     = 0x03;

// TDS token types
const TOKEN_COLMETADATA = 0x81;
const TOKEN_INFO        = 0xAB;
const TOKEN_LOGINACK    = 0xAD;
const TOKEN_ROW         = 0xD1;
const TOKEN_ENVCHANGE   = 0xE3;
const TOKEN_DONE        = 0xFD;
const TOKEN_DONEPROC    = 0xFE;
const TOKEN_DONEINPROC  = 0xFF;

// TDS 7.4 version little-endian
const TDS_VERSION_74    = 0x04000074;

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

function getEncryptionLabel(value: number): string {
  switch (value) {
    case ENCRYPT_OFF:     return 'Off';
    case ENCRYPT_ON:      return 'On';
    case ENCRYPT_NOT_SUP: return 'Not Supported';
    case ENCRYPT_REQ:     return 'Required';
    default:              return `Unknown (0x${value.toString(16)})`;
  }
}

function getTdsVersionLabel(major: number, minor: number): string {
  if (major === 0x74 && minor === 0x00) return 'TDS 7.4 (SQL Server 2012-2019)';
  if (major === 0x73 && minor === 0x0b) return 'TDS 7.3B (SQL Server 2008 R2)';
  if (major === 0x73 && minor === 0x0a) return 'TDS 7.3A (SQL Server 2008)';
  if (major === 0x72 && minor === 0x09) return 'TDS 7.2 (SQL Server 2005)';
  if (major === 0x71 && minor === 0x00) return 'TDS 7.1 (SQL Server 2000)';
  if (major === 0x70 && minor === 0x00) return 'TDS 7.0 (SQL Server 7.0)';
  return `TDS ${major}.${minor}`;
}

// ---------------------------------------------------------------------------
// Low-level I/O helpers
// ---------------------------------------------------------------------------

/** Read exactly N bytes from a socket reader, buffering partial chunks */
async function readExact(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  buf: { data: Uint8Array },
  n: number
): Promise<Uint8Array> {
  while (buf.data.length < n) {
    const { value, done } = await reader.read();
    if (done || !value) throw new Error('Connection closed unexpectedly');
    const merged = new Uint8Array(buf.data.length + value.length);
    merged.set(buf.data);
    merged.set(value, buf.data.length);
    buf.data = merged;
  }
  const result = buf.data.slice(0, n);
  buf.data = buf.data.slice(n);
  return result;
}

/** Read one complete TDS packet, returning header fields + payload */
async function readTDSPacket(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  buf: { data: Uint8Array }
): Promise<{ type: number; status: number; payload: Uint8Array }> {
  const header = await readExact(reader, buf, 8);
  const type   = header[0];
  const status = header[1];
  const length = (header[2] << 8) | header[3]; // big-endian total length including header

  const payloadLen = length - 8;
  if (payloadLen < 0 || payloadLen > 65536) {
    throw new Error(`Invalid TDS packet length: ${length}`);
  }

  const payload = payloadLen > 0
    ? await readExact(reader, buf, payloadLen)
    : new Uint8Array(0);

  return { type, status, payload };
}

/**
 * Read all TDS packets belonging to one response message (until EOM status bit is set).
 * Concatenates payloads from multi-packet responses.
 */
async function readTDSMessage(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  buf: { data: Uint8Array }
): Promise<{ type: number; payload: Uint8Array }> {
  const chunks: Uint8Array[] = [];
  let messageType: number;

  while (true) {
    const pkt = await readTDSPacket(reader, buf);
    messageType = pkt.type;
    chunks.push(pkt.payload);
    if (pkt.status & STATUS_EOM) break;
  }

  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const combined = new Uint8Array(totalLen);
  let off = 0;
  for (const c of chunks) { combined.set(c, off); off += c.length; }

  return { type: messageType, payload: combined };
}

/** Build a TDS packet with 8-byte header */
function buildTDSPacket(type: number, payload: Uint8Array): Uint8Array {
  const totalLen = 8 + payload.length;
  const packet = new Uint8Array(totalLen);
  const view = new DataView(packet.buffer);
  packet[0] = type;
  packet[1] = STATUS_EOM;
  view.setUint16(2, totalLen, false); // big-endian
  view.setUint16(4, 0, false);        // SPID
  packet[6] = 1;                       // PacketID
  packet[7] = 0;                       // Window
  packet.set(payload, 8);
  return packet;
}

// ---------------------------------------------------------------------------
// UTF-16LE helpers
// ---------------------------------------------------------------------------

function encodeUtf16LE(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    out[i * 2]     = code & 0xff;
    out[i * 2 + 1] = (code >> 8) & 0xff;
  }
  return out;
}

function decodeUtf16LE(data: Uint8Array, byteOffset: number, byteLen: number): string {
  let s = '';
  for (let i = 0; i < byteLen; i += 2) {
    const lo = data[byteOffset + i];
    const hi = data[byteOffset + i + 1];
    s += String.fromCharCode((hi << 8) | lo);
  }
  return s;
}

/**
 * TDS password obfuscation per MS-TDS spec:
 * For each byte of the UTF-16LE password: XOR with 0xA5, then swap nibbles.
 */
function obfuscatePassword(password: string): Uint8Array {
  const raw = encodeUtf16LE(password);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i] ^ 0xA5;
    out[i] = ((b & 0x0F) << 4) | ((b >> 4) & 0x0F);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pre-Login packet builder
// ---------------------------------------------------------------------------

function buildPreLoginPacket(): Uint8Array {
  const optionListLen = 5 * 5 + 1; // 5 options * 5 bytes + 1 terminator = 26 bytes

  const versionData    = 6;
  const encryptionData = 1;
  const instoptData    = 1;
  const threadidData   = 4;
  const marsData       = 1;

  const totalDataLen = versionData + encryptionData + instoptData + threadidData + marsData;
  const payloadLen   = optionListLen + totalDataLen;
  const packetLen    = 8 + payloadLen;

  const packet = new Uint8Array(packetLen);
  const view   = new DataView(packet.buffer);

  packet[0] = TDS_PRELOGIN;
  packet[1] = STATUS_EOM;
  view.setUint16(2, packetLen, false);
  view.setUint16(4, 0, false);
  packet[6] = 1;
  packet[7] = 0;

  let optOffset  = 8;
  const dataOffset = optionListLen;

  packet[optOffset] = PL_OPTION_VERSION;
  view.setUint16(optOffset + 1, dataOffset, false);
  view.setUint16(optOffset + 3, versionData, false);
  optOffset += 5;

  packet[optOffset] = PL_OPTION_ENCRYPTION;
  view.setUint16(optOffset + 1, dataOffset + versionData, false);
  view.setUint16(optOffset + 3, encryptionData, false);
  optOffset += 5;

  packet[optOffset] = PL_OPTION_INSTOPT;
  view.setUint16(optOffset + 1, dataOffset + versionData + encryptionData, false);
  view.setUint16(optOffset + 3, instoptData, false);
  optOffset += 5;

  packet[optOffset] = PL_OPTION_THREADID;
  view.setUint16(optOffset + 1, dataOffset + versionData + encryptionData + instoptData, false);
  view.setUint16(optOffset + 3, threadidData, false);
  optOffset += 5;

  packet[optOffset] = PL_OPTION_MARS;
  view.setUint16(optOffset + 1, dataOffset + versionData + encryptionData + instoptData + threadidData, false);
  view.setUint16(optOffset + 3, marsData, false);
  optOffset += 5;

  packet[optOffset] = PL_OPTION_TERMINATOR;

  const dataStart = 8 + optionListLen;
  // VERSION data: leave as zeros (client version 0.0.0.0)
  // ENCRYPTION: ENCRYPT_OFF
  packet[dataStart + versionData] = ENCRYPT_OFF;
  // INSTOPT: null terminator
  packet[dataStart + versionData + encryptionData] = 0x00;
  // THREADID: zeros
  // MARS: 0x00 (off)
  packet[dataStart + versionData + encryptionData + instoptData + threadidData] = 0x00;

  return packet;
}

// ---------------------------------------------------------------------------
// Pre-Login response parser
// ---------------------------------------------------------------------------

function parsePreLoginResponse(payload: Uint8Array): {
  version?: string;
  tdsVersion?: string;
  encryption?: string;
  encryptionValue?: number;
  instanceName?: string;
  threadId?: number;
  mars?: boolean;
} {
  const result: {
    version?: string;
    tdsVersion?: string;
    encryption?: string;
    encryptionValue?: number;
    instanceName?: string;
    threadId?: number;
    mars?: boolean;
  } = {};

  let offset = 0;
  const options: Array<{ token: number; dataOffset: number; dataLength: number }> = [];

  while (offset < payload.length) {
    const token = payload[offset];
    if (token === PL_OPTION_TERMINATOR) break;
    if (offset + 5 > payload.length) break;
    const dataOffset = (payload[offset + 1] << 8) | payload[offset + 2];
    const dataLength = (payload[offset + 3] << 8) | payload[offset + 4];
    options.push({ token, dataOffset, dataLength });
    offset += 5;
  }

  for (const opt of options) {
    const data = payload.subarray(opt.dataOffset, opt.dataOffset + opt.dataLength);

    switch (opt.token) {
      case PL_OPTION_VERSION: {
        if (data.length >= 6) {
          const major    = data[0];
          const minor    = data[1];
          const buildHi  = data[2];
          const buildLo  = data[3];
          const subBuild = (data[4] << 8) | data[5];
          const build    = (buildHi << 8) | buildLo;
          result.version    = `${major}.${minor}.${build}.${subBuild}`;
          result.tdsVersion = getTdsVersionLabel(major, minor);
        }
        break;
      }
      case PL_OPTION_ENCRYPTION: {
        if (data.length >= 1) {
          result.encryptionValue = data[0];
          result.encryption      = getEncryptionLabel(data[0]);
        }
        break;
      }
      case PL_OPTION_INSTOPT: {
        let end = 0;
        while (end < data.length && data[end] !== 0) end++;
        if (end > 0) result.instanceName = new TextDecoder().decode(data.subarray(0, end));
        break;
      }
      case PL_OPTION_THREADID: {
        if (data.length >= 4) {
          const view = new DataView(data.buffer, data.byteOffset, 4);
          result.threadId = view.getUint32(0, false);
        }
        break;
      }
      case PL_OPTION_MARS: {
        if (data.length >= 1) result.mars = data[0] !== 0;
        break;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Login7 packet builder
// ---------------------------------------------------------------------------

function buildLogin7Packet(
  host: string,
  username: string,
  password: string,
  database?: string
): Uint8Array {
  const appName    = 'portofcall';
  const hostName   = 'portofcall';
  const libName    = 'portofcall';
  const serverName = host;
  const dbName     = database || 'master';

  // Encode strings as UTF-16LE
  const hostNameBytes   = encodeUtf16LE(hostName);
  const userNameBytes   = encodeUtf16LE(username);
  const passwordBytes   = obfuscatePassword(password);
  const appNameBytes    = encodeUtf16LE(appName);
  const serverNameBytes = encodeUtf16LE(serverName);
  const libNameBytes    = encodeUtf16LE(libName);
  const dbNameBytes     = encodeUtf16LE(dbName);

  // Fixed portion of Login7 payload = 94 bytes:
  //   4  Length
  //   4  TDSVersion
  //   4  PacketSize
  //   4  ClientProgVer
  //   4  ClientPID
  //   4  ConnectionID
  //   1  OptionFlags1
  //   1  OptionFlags2
  //   1  TypeFlags
  //   1  OptionFlags3
  //   4  ClientTimeZone
  //   4  ClientLCID
  //  13 * 4 = 52 bytes of offset/length pairs (13 pairs, each 2+2 bytes)
  //   6  ClientID
  //   4  SSPILong
  // Total = 4+4+4+4+4+4+1+1+1+1+4+4 = 36 scalar bytes
  //       + 13*4 = 52 offset/len bytes
  //       + 6 clientID
  //       = 94 bytes
  const fixedLen = 94;

  // Data offsets are relative to the start of the Login7 payload (byte 0 = length DWORD)
  let currentOffset = fixedLen;

  const hostNameOff   = currentOffset; currentOffset += hostNameBytes.length;
  const userNameOff   = currentOffset; currentOffset += userNameBytes.length;
  const passwordOff   = currentOffset; currentOffset += passwordBytes.length;
  const appNameOff    = currentOffset; currentOffset += appNameBytes.length;
  const serverNameOff = currentOffset; currentOffset += serverNameBytes.length;
  const libNameOff    = currentOffset; currentOffset += libNameBytes.length;
  const dbNameOff     = currentOffset; currentOffset += dbNameBytes.length;

  const loginLength = currentOffset; // total Login7 payload length

  const payload = new Uint8Array(loginLength);
  const view    = new DataView(payload.buffer);

  let pos = 0;

  // Length (4LE)
  view.setUint32(pos, loginLength, true); pos += 4;

  // TDSVersion (4LE): 0x04000074 = TDS 7.4
  view.setUint32(pos, TDS_VERSION_74, true); pos += 4;

  // PacketSize (4LE): 4096
  view.setUint32(pos, 4096, true); pos += 4;

  // ClientProgVer (4LE)
  view.setUint32(pos, 0x07000000, true); pos += 4;

  // ClientPID (4LE)
  view.setUint32(pos, 1234, true); pos += 4;

  // ConnectionID (4LE)
  view.setUint32(pos, 0, true); pos += 4;

  // OptionFlags1, OptionFlags2, TypeFlags, OptionFlags3
  payload[pos++] = 0x00;
  payload[pos++] = 0x00;
  payload[pos++] = 0x00;
  payload[pos++] = 0x00;

  // ClientTimeZone (4LE)
  view.setInt32(pos, 0, true); pos += 4;

  // ClientLCID (4LE): 0x0409 = en-US
  view.setUint32(pos, 0x0409, true); pos += 4;

  // --- Offset/length pairs (2LE offset in bytes + 2LE char count) ---

  // HostName
  view.setUint16(pos, hostNameOff, true);       pos += 2;
  view.setUint16(pos, hostName.length, true);   pos += 2;

  // UserName
  view.setUint16(pos, userNameOff, true);       pos += 2;
  view.setUint16(pos, username.length, true);   pos += 2;

  // Password
  view.setUint16(pos, passwordOff, true);       pos += 2;
  view.setUint16(pos, password.length, true);   pos += 2;

  // AppName
  view.setUint16(pos, appNameOff, true);        pos += 2;
  view.setUint16(pos, appName.length, true);    pos += 2;

  // ServerName
  view.setUint16(pos, serverNameOff, true);     pos += 2;
  view.setUint16(pos, serverName.length, true); pos += 2;

  // Unused / Extension (0, 0)
  view.setUint16(pos, 0, true); pos += 2;
  view.setUint16(pos, 0, true); pos += 2;

  // LibraryName
  view.setUint16(pos, libNameOff, true);        pos += 2;
  view.setUint16(pos, libName.length, true);    pos += 2;

  // Locale (0, 0)
  view.setUint16(pos, 0, true); pos += 2;
  view.setUint16(pos, 0, true); pos += 2;

  // Database
  view.setUint16(pos, dbNameOff, true);         pos += 2;
  view.setUint16(pos, dbName.length, true);     pos += 2;

  // ClientID (6 bytes: MAC address — zeros)
  pos += 6;

  // SSPI (0, 0)
  view.setUint16(pos, 0, true); pos += 2;
  view.setUint16(pos, 0, true); pos += 2;

  // AtchDBFile (0, 0)
  view.setUint16(pos, 0, true); pos += 2;
  view.setUint16(pos, 0, true); pos += 2;

  // ChangePassword (0, 0)
  view.setUint16(pos, 0, true); pos += 2;
  view.setUint16(pos, 0, true); pos += 2;

  // SSPILong (4LE)
  view.setUint32(pos, 0, true);

  // === Data section ===
  payload.set(hostNameBytes,   hostNameOff);
  payload.set(userNameBytes,   userNameOff);
  payload.set(passwordBytes,   passwordOff);
  payload.set(appNameBytes,    appNameOff);
  payload.set(serverNameBytes, serverNameOff);
  payload.set(libNameBytes,    libNameOff);
  payload.set(dbNameBytes,     dbNameOff);

  return buildTDSPacket(TDS_LOGIN7, payload);
}

// ---------------------------------------------------------------------------
// Token stream types
// ---------------------------------------------------------------------------

interface LoginAckToken {
  serverName: string;
  tdsVersion: string;
  serverVersion: string;
}

interface InfoToken {
  number: number;
  state: number;
  severity: number;
  message: string;
  server: string;
  proc: string;
  line: number;
}

interface EnvChangeToken {
  type: number;
  newValue: string;
  oldValue: string;
}

interface DoneToken {
  status: number;
  curCmd: number;
  rowCount: number;
}

interface ColumnMetadata {
  name: string;
  type: number;
  maxLen?: number;
}

interface ParsedTokenStream {
  loginAck?: LoginAckToken;
  envChanges: EnvChangeToken[];
  infos: InfoToken[];
  done?: DoneToken;
  columns?: ColumnMetadata[];
  rows?: (string | number | null)[][];
}

// ---------------------------------------------------------------------------
// Token stream helper readers
// ---------------------------------------------------------------------------

function readU16LE(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

function readU32LE(data: Uint8Array, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

/** Read a B_VARCHAR: 1-byte char count followed by UTF-16LE characters */
function readBVarchar(data: Uint8Array, offset: number): { value: string; nextOffset: number } {
  const charCount = data[offset];
  const str = decodeUtf16LE(data, offset + 1, charCount * 2);
  return { value: str, nextOffset: offset + 1 + charCount * 2 };
}

/** Read a US_VARCHAR: 2-byte char count followed by UTF-16LE characters */
function readUSVarchar(data: Uint8Array, offset: number): { value: string; nextOffset: number } {
  const charCount = readU16LE(data, offset);
  const str = decodeUtf16LE(data, offset + 2, charCount * 2);
  return { value: str, nextOffset: offset + 2 + charCount * 2 };
}

// ---------------------------------------------------------------------------
// Individual token parsers
// ---------------------------------------------------------------------------

/** Parse LOGINACK token body (token byte already consumed, offset points at length field) */
function parseLoginAck(data: Uint8Array, offset: number): { token: LoginAckToken; nextOffset: number } {
  const len = readU16LE(data, offset); offset += 2;
  const end = offset + len;

  // Interface (1 byte)
  offset += 1;

  // TDSVersion (4 bytes, big-endian in LOGINACK)
  const tdsV0 = data[offset]; const tdsV1 = data[offset + 1];
  offset += 4;
  const tdsVersionStr = getTdsVersionLabel(tdsV0, tdsV1);

  // ProgName: B_VARCHAR
  const { value: serverName, nextOffset: afterName } = readBVarchar(data, offset);
  offset = afterName;

  // ProgVersion: 4 bytes
  const major = data[offset]; const minor = data[offset + 1];
  const build = data[offset + 2]; const sub = data[offset + 3];
  const serverVersion = `${major}.${minor}.${build}.${sub}`;

  offset = end;
  return {
    token: { serverName, tdsVersion: tdsVersionStr, serverVersion },
    nextOffset: offset,
  };
}

/** Parse INFO/ERROR token body (token byte already consumed) */
function parseInfo(data: Uint8Array, offset: number): { token: InfoToken; nextOffset: number } {
  const len = readU16LE(data, offset); offset += 2;
  const end = offset + len;

  const number   = readU32LE(data, offset); offset += 4;
  const state    = data[offset++];
  const severity = data[offset++];

  // MsgText: US_VARCHAR (2-byte char count)
  const { value: message, nextOffset: a1 } = readUSVarchar(data, offset); offset = a1;

  // ServerName: B_VARCHAR (1-byte char count)
  const { value: server, nextOffset: a2 } = readBVarchar(data, offset); offset = a2;

  // ProcName: B_VARCHAR
  const { value: proc, nextOffset: a3 } = readBVarchar(data, offset); offset = a3;

  // LineNumber: 4LE (TDS 7.2+)
  const line = readU32LE(data, offset);
  offset = end;

  return {
    token: { number, state, severity, message, server, proc, line },
    nextOffset: offset,
  };
}

/** Parse ENVCHANGE token body (token byte already consumed) */
function parseEnvChange(data: Uint8Array, offset: number): { token: EnvChangeToken; nextOffset: number } {
  const len = readU16LE(data, offset); offset += 2;
  const end = offset + len;

  const type = data[offset++];

  let newValue = '';
  let oldValue = '';

  // Most common subtypes (1=database, 2=language, 3=charset, etc.) use B_VARCHAR for new+old
  if (type >= 1 && type <= 6 || type === 13) {
    const nNew = data[offset++];
    newValue = decodeUtf16LE(data, offset, nNew * 2); offset += nNew * 2;
    const nOld = data[offset++];
    oldValue = decodeUtf16LE(data, offset, nOld * 2);
  }

  offset = end;
  return { token: { type, newValue, oldValue }, nextOffset: offset };
}

/** Parse DONE/DONEPROC/DONEINPROC token body (token byte already consumed) */
function parseDone(data: Uint8Array, offset: number): { token: DoneToken; nextOffset: number } {
  const status  = readU16LE(data, offset); offset += 2;
  const curCmd  = readU16LE(data, offset); offset += 2;
  // RowCount: 8 bytes in TDS 7.2+; read low 32 bits
  const rowCountLo = readU32LE(data, offset); offset += 8;
  return { token: { status, curCmd, rowCount: rowCountLo }, nextOffset: offset };
}

// ---------------------------------------------------------------------------
// Column type constants
// ---------------------------------------------------------------------------

// Fixed-length types
const TYPE_NULL      = 0x1F;
const TYPE_BIT       = 0x32;
const TYPE_INT1      = 0x30;
const TYPE_INT2      = 0x34;
const TYPE_INT4      = 0x38;
const TYPE_INT8      = 0x7F;
const TYPE_FLOAT4    = 0x3B;
const TYPE_FLOAT8    = 0x3D;
const TYPE_MONEY4    = 0x7A;
const TYPE_MONEY8    = 0x3C;
const TYPE_UNIQUEID  = 0x24;
const TYPE_DATE      = 0x28;

// Variable-length nullable types with 1-byte length prefix in data
const TYPE_INTN      = 0x26;
const TYPE_FLOATN    = 0x6D;
const TYPE_BITN      = 0x68;
const TYPE_MONEYN    = 0x6E;
const TYPE_DATETIMEN = 0x6F;

// Variable-length with 2LE length in data (maxLen + 5-byte collation in metadata)
const TYPE_VARCHAR   = 0xA7;
const TYPE_NVARCHAR  = 0xE7;
const TYPE_CHAR      = 0xAF;
const TYPE_NCHAR     = 0xEF;
const TYPE_VARBINARY = 0xA5;
const TYPE_BINARY    = 0xAD;

// Long types
const TYPE_TEXT      = 0x23;
const TYPE_NTEXT     = 0x63;
const TYPE_IMAGE     = 0x22;

// Decimal/Numeric
const TYPE_DECIMALN  = 0x6A;
const TYPE_NUMERICN  = 0x6C;

// Temporal
const TYPE_TIME              = 0x29;
const TYPE_DATETIME2         = 0x2A;
const TYPE_DATETIMEOFFSET    = 0x2B;

// XML / UDT
const TYPE_XML       = 0xF1;
const TYPE_UDT       = 0xF0;

function isFixedType(type: number): boolean {
  return [
    TYPE_NULL, TYPE_BIT, TYPE_INT1, TYPE_INT2, TYPE_INT4, TYPE_INT8,
    TYPE_FLOAT4, TYPE_FLOAT8, TYPE_MONEY4, TYPE_MONEY8, TYPE_UNIQUEID, TYPE_DATE,
  ].includes(type);
}


// ---------------------------------------------------------------------------
// COLMETADATA token parser
// ---------------------------------------------------------------------------

function parseColMetadata(
  data: Uint8Array,
  offset: number
): { columns: ColumnMetadata[]; nextOffset: number } {
  const colCount = readU16LE(data, offset); offset += 2;

  if (colCount === 0xFFFF) {
    // No metadata
    return { columns: [], nextOffset: offset };
  }

  const columns: ColumnMetadata[] = [];

  for (let i = 0; i < colCount; i++) {
    // UserType (4LE in TDS 7.2+)
    offset += 4;
    // Flags (2LE)
    offset += 2;
    // Type (1 byte)
    const type = data[offset++];
    let maxLen: number | undefined;

    if (isFixedType(type)) {
      // No additional type info
    } else if (
      type === TYPE_INTN || type === TYPE_FLOATN || type === TYPE_BITN ||
      type === TYPE_MONEYN || type === TYPE_DATETIMEN
    ) {
      maxLen = data[offset++];
    } else if (
      type === TYPE_VARCHAR || type === TYPE_NVARCHAR ||
      type === TYPE_CHAR || type === TYPE_NCHAR ||
      type === TYPE_VARBINARY || type === TYPE_BINARY
    ) {
      maxLen = readU16LE(data, offset); offset += 2;
      offset += 5; // collation
    } else if (type === TYPE_TEXT || type === TYPE_NTEXT || type === TYPE_IMAGE) {
      offset += 4; // maxLen (ignored)
      if (type === TYPE_TEXT || type === TYPE_NTEXT) {
        offset += 5; // collation
      }
      // TableName: US_VARCHAR
      const tnChars = readU16LE(data, offset); offset += 2;
      offset += tnChars * 2;
    } else if (type === TYPE_DECIMALN || type === TYPE_NUMERICN) {
      maxLen = data[offset++];
      offset += 2; // precision + scale
    } else if (
      type === TYPE_TIME || type === TYPE_DATETIME2 || type === TYPE_DATETIMEOFFSET
    ) {
      offset += 1; // scale
    } else if (type === TYPE_XML) {
      const schemaPresent = data[offset++];
      if (schemaPresent) {
        const dbLen = data[offset++]; offset += dbLen * 2;
        const ownerLen = data[offset++]; offset += ownerLen * 2;
        const collLen = readU16LE(data, offset); offset += 2 + collLen * 2;
      }
    } else if (type === TYPE_UDT) {
      for (let j = 0; j < 4; j++) {
        const partLen = readU16LE(data, offset); offset += 2 + partLen * 2;
      }
    }

    // ColName: B_VARCHAR
    const nameChars = data[offset++];
    const name = decodeUtf16LE(data, offset, nameChars * 2);
    offset += nameChars * 2;

    columns.push({ name, type, maxLen });
  }

  return { columns, nextOffset: offset };
}

// ---------------------------------------------------------------------------
// Row value parser
// ---------------------------------------------------------------------------

function parseColumnValue(
  data: Uint8Array,
  offset: number,
  col: ColumnMetadata
): { value: string | number | null; nextOffset: number } {
  const type = col.type;

  if (type === TYPE_NULL) return { value: null, nextOffset: offset };

  // Fixed types
  if (type === TYPE_BIT || type === TYPE_INT1) {
    return { value: data[offset], nextOffset: offset + 1 };
  }
  if (type === TYPE_INT2) {
    return { value: data[offset] | (data[offset + 1] << 8), nextOffset: offset + 2 };
  }
  if (type === TYPE_INT4) {
    return { value: readU32LE(data, offset), nextOffset: offset + 4 };
  }
  if (type === TYPE_INT8) {
    const lo = readU32LE(data, offset);
    const hi = readU32LE(data, offset + 4);
    const val: string | number = hi === 0 ? lo : `${hi * 4294967296 + lo}`;
    return { value: val, nextOffset: offset + 8 };
  }
  if (type === TYPE_FLOAT4) {
    const v = new DataView(data.buffer, data.byteOffset + offset, 4).getFloat32(0, true);
    return { value: v, nextOffset: offset + 4 };
  }
  if (type === TYPE_FLOAT8) {
    const v = new DataView(data.buffer, data.byteOffset + offset, 8).getFloat64(0, true);
    return { value: v, nextOffset: offset + 8 };
  }
  if (type === TYPE_UNIQUEID) {
    const hex = Array.from(data.slice(offset, offset + 16))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    return { value: hex, nextOffset: offset + 16 };
  }
  if (type === TYPE_DATE) {
    const days = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);
    return { value: `date:${days}`, nextOffset: offset + 3 };
  }
  if (type === TYPE_MONEY4) {
    return { value: readU32LE(data, offset) / 10000, nextOffset: offset + 4 };
  }
  if (type === TYPE_MONEY8) {
    const hi = readU32LE(data, offset + 4);
    const lo = readU32LE(data, offset);
    return { value: (hi * 4294967296 + lo) / 10000, nextOffset: offset + 8 };
  }

  // Nullable variable-length with 1-byte length prefix
  if (type === TYPE_INTN) {
    const len = data[offset++];
    if (len === 0) return { value: null, nextOffset: offset };
    if (len === 1) return { value: data[offset], nextOffset: offset + 1 };
    if (len === 2) return { value: data[offset] | (data[offset + 1] << 8), nextOffset: offset + 2 };
    if (len === 4) return { value: readU32LE(data, offset), nextOffset: offset + 4 };
    if (len === 8) {
      const lo = readU32LE(data, offset);
      const hi = readU32LE(data, offset + 4);
      const val: string | number = hi === 0 ? lo : `${hi * 4294967296 + lo}`;
      return { value: val, nextOffset: offset + 8 };
    }
    return { value: null, nextOffset: offset + len };
  }
  if (type === TYPE_FLOATN) {
    const len = data[offset++];
    if (len === 0) return { value: null, nextOffset: offset };
    if (len === 4) return { value: new DataView(data.buffer, data.byteOffset + offset, 4).getFloat32(0, true), nextOffset: offset + 4 };
    if (len === 8) return { value: new DataView(data.buffer, data.byteOffset + offset, 8).getFloat64(0, true), nextOffset: offset + 8 };
    return { value: null, nextOffset: offset + len };
  }
  if (type === TYPE_BITN) {
    if (offset >= data.length) return { value: null, nextOffset: offset };
    const len = data[offset++];
    if (len === 0) return { value: null, nextOffset: offset };
    return { value: data[offset], nextOffset: offset + 1 };
  }
  if (type === TYPE_MONEYN) {
    const len = data[offset++];
    if (len === 0) return { value: null, nextOffset: offset };
    if (len === 4) return { value: readU32LE(data, offset) / 10000, nextOffset: offset + 4 };
    if (len === 8) {
      const hi = readU32LE(data, offset + 4);
      const lo = readU32LE(data, offset);
      return { value: (hi * 4294967296 + lo) / 10000, nextOffset: offset + 8 };
    }
    return { value: null, nextOffset: offset + len };
  }
  if (type === TYPE_DATETIMEN) {
    const len = data[offset++];
    if (len === 0) return { value: null, nextOffset: offset };
    return { value: `datetime:${len}bytes`, nextOffset: offset + len };
  }

  // Variable-length with 2LE length in data
  if (type === TYPE_VARCHAR || type === TYPE_CHAR || type === TYPE_BINARY) {
    const len = readU16LE(data, offset); offset += 2;
    if (len === 0xFFFF) return { value: null, nextOffset: offset };
    return { value: new TextDecoder().decode(data.slice(offset, offset + len)), nextOffset: offset + len };
  }
  if (type === TYPE_NVARCHAR || type === TYPE_NCHAR) {
    const len = readU16LE(data, offset); offset += 2;
    if (len === 0xFFFF) return { value: null, nextOffset: offset };
    return { value: decodeUtf16LE(data, offset, len), nextOffset: offset + len };
  }
  if (type === TYPE_VARBINARY) {
    const len = readU16LE(data, offset); offset += 2;
    if (len === 0xFFFF) return { value: null, nextOffset: offset };
    return { value: `binary:${len}bytes`, nextOffset: offset + len };
  }

  // Long types (TEXT, NTEXT, IMAGE)
  if (type === TYPE_TEXT || type === TYPE_NTEXT || type === TYPE_IMAGE) {
    const tpLen = data[offset++];
    if (tpLen === 0) return { value: null, nextOffset: offset };
    offset += tpLen + 8; // skip text pointer + timestamp
    const dataLen = readU32LE(data, offset); offset += 4;
    if (offset + dataLen > data.length) return { value: null, nextOffset: data.length };
    if (type === TYPE_NTEXT) {
      return { value: decodeUtf16LE(data, offset, dataLen), nextOffset: offset + dataLen };
    }
    return { value: new TextDecoder().decode(data.slice(offset, offset + dataLen)), nextOffset: offset + dataLen };
  }

  // Decimal/Numeric
  if (type === TYPE_DECIMALN || type === TYPE_NUMERICN) {
    const len = data[offset++];
    if (len === 0) return { value: null, nextOffset: offset };
    const sign = data[offset++]; // 1=positive, 0=negative
    let mag = 0;
    for (let i = 0; i < len - 1; i++) mag += data[offset + i] * Math.pow(256, i);
    return { value: sign ? mag : -mag, nextOffset: offset + len - 1 };
  }

  // Temporal types (TIME, DATETIME2, DATETIMEOFFSET) — return as string
  if (type === TYPE_TIME || type === TYPE_DATETIME2 || type === TYPE_DATETIMEOFFSET) {
    const len = data[offset++];
    if (len === 0) return { value: null, nextOffset: offset };
    return { value: `temporal:${len}bytes`, nextOffset: offset + len };
  }

  // XML
  if (type === TYPE_XML) {
    const len = readU32LE(data, offset); offset += 4;
    if (len === 0xFFFFFFFF) return { value: null, nextOffset: offset };
    return { value: new TextDecoder().decode(data.slice(offset, offset + len)), nextOffset: offset + len };
  }

  // Fallback: unknown/unrecognized type — choose skip strategy based on type class.
  // Fixed-length types have no length prefix in the data stream; variable-length
  // types carry a 1-byte or 2-byte length prefix.  Using the wrong strategy for
  // fixed-length types would misparse subsequent columns.

  // Fixed-length types and their sizes (bytes consumed after the type byte).
  const FIXED_SIZES: Record<number, number> = {
    [TYPE_NULL]:  0,  // 0x1F — no data bytes
    [TYPE_BIT]:   1,  // 0x32
    [TYPE_INT1]:  1,  // 0x30
    [TYPE_INT2]:  2,  // 0x34
    [TYPE_INT4]:  4,  // 0x38
    [TYPE_INT8]:  8,  // 0x7F
    [TYPE_FLOAT4]:4,  // 0x3B
    [TYPE_FLOAT8]:8,  // 0x3D
    [TYPE_MONEY4]:4,  // 0x7A
    [TYPE_MONEY8]:8,  // 0x3C
    [TYPE_UNIQUEID]:16, // 0x24
    [TYPE_DATE]:  3,  // 0x28 — 3-byte day count, no length prefix
  };
  if (Object.prototype.hasOwnProperty.call(FIXED_SIZES, type)) {
    return { value: null, nextOffset: offset + FIXED_SIZES[type] };
  }

  // Nullable variable-length types that carry a 1-byte length prefix in data.
  const ONE_BYTE_PREFIX_TYPES = new Set([
    TYPE_INTN,      // 0x26
    TYPE_FLOATN,    // 0x6D
    TYPE_BITN,      // 0x68
    TYPE_MONEYN,    // 0x6E
    TYPE_DATETIMEN, // 0x6F
    TYPE_DECIMALN,  // 0x6A
    TYPE_NUMERICN,  // 0x6C
    TYPE_TIME,      // 0x29
    TYPE_DATETIME2, // 0x2A
    TYPE_DATETIMEOFFSET, // 0x2B
  ]);
  if (ONE_BYTE_PREFIX_TYPES.has(type)) {
    const len = data[offset++];
    if (len === 0) return { value: null, nextOffset: offset };
    return { value: null, nextOffset: offset + len };
  }

  // Variable-length types that carry a 2-byte LE length prefix in data.
  const TWO_BYTE_PREFIX_TYPES = new Set([
    TYPE_VARCHAR,   // 0xA7
    TYPE_NVARCHAR,  // 0xE7
    TYPE_CHAR,      // 0xAF
    TYPE_NCHAR,     // 0xEF
    TYPE_VARBINARY, // 0xA5
    TYPE_BINARY,    // 0xAD
  ]);
  if (TWO_BYTE_PREFIX_TYPES.has(type)) {
    const len = readU16LE(data, offset); offset += 2;
    if (len === 0xFFFF) return { value: null, nextOffset: offset };
    return { value: null, nextOffset: offset + len };
  }

  // Final unknown fallback: advance 1 byte to avoid an infinite loop.
  return { value: null, nextOffset: offset + 1 };
}

// ---------------------------------------------------------------------------
// Full token-stream parser
// ---------------------------------------------------------------------------

function parseTokenStream(payload: Uint8Array): ParsedTokenStream {
  const result: ParsedTokenStream = {
    envChanges: [],
    infos: [],
    rows: [],
  };

  let offset = 0;

  while (offset < payload.length) {
    const tokenType = payload[offset++];

    switch (tokenType) {
      case TOKEN_LOGINACK: {
        const { token, nextOffset } = parseLoginAck(payload, offset);
        result.loginAck = token;
        offset = nextOffset;
        break;
      }

      case TOKEN_ENVCHANGE: {
        const { token, nextOffset } = parseEnvChange(payload, offset);
        result.envChanges.push(token);
        offset = nextOffset;
        break;
      }

      case TOKEN_INFO:
      case 0xAE: { // ERROR token — identical structure to INFO
        const { token, nextOffset } = parseInfo(payload, offset);
        result.infos.push(token);
        offset = nextOffset;
        break;
      }

      case TOKEN_COLMETADATA: {
        const { columns, nextOffset } = parseColMetadata(payload, offset);
        result.columns = columns;
        offset = nextOffset;
        break;
      }

      case TOKEN_ROW: {
        if (!result.columns) return result;
        const row: (string | number | null)[] = [];
        for (const col of result.columns) {
          const { value, nextOffset } = parseColumnValue(payload, offset, col);
          row.push(value);
          offset = nextOffset;
        }
        result.rows!.push(row);
        break;
      }

      case TOKEN_DONE:
      case TOKEN_DONEPROC:
      case TOKEN_DONEINPROC: {
        const { token, nextOffset } = parseDone(payload, offset);
        result.done = token;
        offset = nextOffset;
        break;
      }

      default: {
        // Unknown token: attempt to skip by reading 2LE length
        if (offset + 2 > payload.length) return result;
        const skipLen = readU16LE(payload, offset);
        offset += 2 + skipLen;
        break;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Core TDS connection function
// ---------------------------------------------------------------------------

interface TDSConnectOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  database?: string;
  sql?: string;
}

interface TDSConnectResult {
  loginAck: LoginAckToken;
  database: string;
  resultSet?: { columns: ColumnMetadata[]; rows: (string | number | null)[][] };
}

async function tdsConnect(opts: TDSConnectOptions): Promise<TDSConnectResult> {
  const { host, port, username, password, database, sql } = opts;

  const socket = connect(`${host}:${port}`);
  await socket.opened;

  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const buf: { data: Uint8Array } = { data: new Uint8Array(0) };

  try {
    // Step 1: Send Pre-Login
    await writer.write(buildPreLoginPacket());

    // Step 2: Read Pre-Login response (discarded — we always proceed without TLS)
    await readTDSMessage(reader, buf);

    // Step 3: Send Login7
    await writer.write(buildLogin7Packet(host, username, password, database));

    // Step 4: Read login response token stream
    const loginResp = await readTDSMessage(reader, buf);
    const loginTokens = parseTokenStream(loginResp.payload);

    if (!loginTokens.loginAck) {
      const errors = loginTokens.infos.filter(i => i.severity >= 14);
      const errorMsg = errors.length > 0
        ? `${errors[0].message} (error ${errors[0].number})`
        : 'Login failed: no LOGINACK received';
      throw new Error(errorMsg);
    }

    // Extract current database from ENVCHANGE tokens (type 1 = database change)
    let currentDatabase = database || 'master';
    for (const env of loginTokens.envChanges) {
      if (env.type === 1 && env.newValue) {
        currentDatabase = env.newValue;
      }
    }

    if (!sql) {
      await socket.close();
      return { loginAck: loginTokens.loginAck, database: currentDatabase };
    }

    // Step 5: Send SQL Batch (type 0x01), query encoded as UTF-16LE
    const sqlBytes  = encodeUtf16LE(sql);
    await writer.write(buildTDSPacket(TDS_SQL_BATCH, sqlBytes));

    // Step 6: Read query response token stream
    const queryResp = await readTDSMessage(reader, buf);
    const queryTokens = parseTokenStream(queryResp.payload);

    await socket.close();

    return {
      loginAck: loginTokens.loginAck,
      database: currentDatabase,
      resultSet: queryTokens.columns
        ? { columns: queryTokens.columns, rows: queryTokens.rows || [] }
        : undefined,
    };
  } catch (err) {
    try { await socket.close(); } catch { /* ignore */ }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * POST /api/tds/login
 * Authenticates against a SQL Server using TDS Login7 and returns server metadata.
 */
export async function handleTDSLogin(request: Request): Promise<Response> {
  try {
    const {
      host,
      port = 1433,
      username,
      password,
      database,
      timeout = 30000,
    } = await request.json<{
      host: string;
      port?: number;
      username: string;
      password: string;
      database?: string;
      timeout?: number;
    }>();

    if (!host)                              return jsonError('Missing required parameter: host', 400);
    if (!username)                          return jsonError('Missing required parameter: username', 400);
    if (password === undefined || password === null) return jsonError('Missing required parameter: password', 400);

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const promise = (async () => {
      const result = await tdsConnect({ host, port, username, password, database });
      return new Response(JSON.stringify({
        success: true,
        serverName: result.loginAck.serverName,
        serverVersion: result.loginAck.serverVersion,
        tdsVersion: result.loginAck.tdsVersion,
        database: result.database,
      }), { headers: { 'Content-Type': 'application/json' } });
    })();

    const timeoutP = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    try {
      return await Promise.race([promise, timeoutP]);
    } catch (err) {
      return new Response(JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'Login failed',
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Login failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * POST /api/tds/query
 * Authenticates and executes a SQL query, returning columns + rows.
 */
export async function handleTDSQuery(request: Request): Promise<Response> {
  try {
    const {
      host,
      port = 1433,
      username,
      password,
      database = 'master',
      sql,
      timeout = 30000,
    } = await request.json<{
      host: string;
      port?: number;
      username: string;
      password: string;
      database?: string;
      sql: string;
      timeout?: number;
    }>();

    if (!host)     return jsonError('Missing required parameter: host', 400);
    if (!username) return jsonError('Missing required parameter: username', 400);
    if (!sql)      return jsonError('Missing required parameter: sql', 400);

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const promise = (async () => {
      const result = await tdsConnect({
        host, port, username, password: password ?? '', database, sql,
      });

      const columns  = result.resultSet?.columns.map(c => c.name) ?? [];
      const rows     = result.resultSet?.rows ?? [];

      return new Response(JSON.stringify({
        success: true,
        columns,
        rows,
        rowCount: rows.length,
        database: result.database,
        serverVersion: result.loginAck.serverVersion,
      }), { headers: { 'Content-Type': 'application/json' } });
    })();

    const timeoutP = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Query timeout')), timeout)
    );

    try {
      return await Promise.race([promise, timeoutP]);
    } catch (err) {
      return new Response(JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'Query failed',
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Query failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * POST /api/tds/connect
 * Pre-Login probe — no credentials required. Extracts SQL Server version, encryption, and MARS info.
 */
export async function handleTDSConnect(request: Request): Promise<Response> {
  try {
    const { host, port = 1433, timeout = 10000 } = await request.json<{
      host: string;
      port?: number;
      timeout?: number;
    }>();

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();
      const buf: { data: Uint8Array } = { data: new Uint8Array(0) };

      try {
        await writer.write(buildPreLoginPacket());

        // Read header to get total length
        const header = await readExact(reader, buf, 8);
        const responseType   = header[0];
        const responseLength = (header[2] << 8) | header[3];
        const payloadLength  = responseLength - 8;

        if (payloadLength <= 0 || payloadLength > 65536) {
          throw new Error(`Invalid response length: ${responseLength}`);
        }

        const payload = await readExact(reader, buf, payloadLength);
        await socket.close();

        const preLoginInfo = parsePreLoginResponse(payload);
        return {
          success: true,
          host,
          port,
          protocol: 'TDS',
          responseType: `0x${responseType.toString(16).padStart(2, '0')}`,
          ...preLoginInfo,
          message: preLoginInfo.version
            ? `SQL Server ${preLoginInfo.version} detected`
            : 'TDS-compatible server detected',
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
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
