/**
 * AFP (Apple Filing Protocol) Worker Handler
 *
 * Implements AFP over DSI (Data Stream Interface).
 * AFP is Apple's file sharing protocol on port 548 (TCP).
 *
 * DSI Header (16 bytes):
 *   Byte 0:    Flags (0x00 = request, 0x01 = reply)
 *   Byte 1:    Command (DSIOpenSession=4, DSICommand=2, DSIGetStatus=3, etc.)
 *   Byte 2-3:  Request ID (uint16 BE)
 *   Byte 4-7:  Error Code / Data Offset (int32 BE)
 *   Byte 8-11: Total Data Length (uint32 BE)
 *   Byte 12-15: Reserved (zeros)
 *
 * DSIGetStatus returns server info (FPGetSrvrInfo) without authentication.
 * Full sessions: DSIOpenSession → FPLogin → AFP commands → FPLogout → DSICloseSession
 */

import { connect } from 'cloudflare:sockets';

// ─── DSI Layer Constants ──────────────────────────────────────────────────────

const DSI_FLAG_REQUEST = 0x00;
const DSI_FLAG_REPLY = 0x01;
const DSI_OPEN_SESSION = 0x04;
const DSI_CLOSE_SESSION = 0x01;
const DSI_COMMAND = 0x02;
const DSI_GET_STATUS = 0x03;
const DSI_TICKLE = 0x05;
const DSI_ATTENTION = 0x08;
const DSI_HEADER_SIZE = 16;

// ─── AFP Command Codes ────────────────────────────────────────────────────────

const FP_CLOSE_VOL = 2;
const FP_CLOSE_FORK = 4;
const FP_CREATE_DIR = 6;
const FP_CREATE_FILE = 8;
const FP_DELETE = 9;
const FP_ENUMERATE_EXT2 = 68;
const FP_GET_FILE_DIR_PARMS = 34;
const FP_GET_SRVR_PARMS = 16;
const FP_LOGIN = 18;
const FP_LOGOUT = 20;
const FP_OPEN_FORK = 26;
const FP_OPEN_VOL = 27;
const FP_READ_EXT = 60;
const FP_WRITE_EXT = 65;
const FP_RENAME = 28;

// ─── AFP Path Types ───────────────────────────────────────────────────────────

const kFPLongName = 2;

// ─── AFP Bitmap Bits ──────────────────────────────────────────────────────────

const kFPAttributeBit = 0x0001;
const kFPParentDirIDBit = 0x0002;
const kFPCreateDateBit = 0x0004;
const kFPModDateBit = 0x0008;
const kFPFinderInfoBit = 0x0020;
const kFPLongNameBit = 0x0040;
const kFPNodeIDBit = 0x0100;
const kFPDataForkLenBit = 0x0200; // files: data fork length; dirs: offspring count (same bit)

// File entry bitmap: attrs + modDate + longName + nodeID + dataForkLen
const FILE_BITMAP = kFPAttributeBit | kFPModDateBit | kFPLongNameBit | kFPNodeIDBit | kFPDataForkLenBit;
// Dir entry bitmap: attrs + modDate + longName + nodeID
const DIR_BITMAP = kFPAttributeBit | kFPModDateBit | kFPLongNameBit | kFPNodeIDBit;

// FPOpenVol bitmap: request just volumeID
const VOL_BITMAP = 0x0001; // VolumeAttributes (includes VolumeID in response)

// ─── AFP Error Codes ──────────────────────────────────────────────────────────

const AFP_NO_ERR = 0;

function getAFPErrorMessage(code: number): string {
  const errors: Record<number, string> = {
    0: 'Success',
    '-5019': 'Access denied',
    '-5023': 'Authentication in progress',
    '-5028': 'Unsupported UAM',
    '-5030': 'Bitmap error',
    '-5031': 'Cannot move',
    '-5033': 'Directory not empty',
    '-5034': 'Disk full',
    '-5035': 'End of file',
    '-5036': 'File busy',
    '-5038': 'Item not found',
    '-5039': 'Lock error',
    '-5040': 'Miscellaneous error',
    '-5043': 'Object already exists',
    '-5044': 'Object not found',
    '-5045': 'Parameter error',
    '-5046': 'Range not locked',
    '-5047': 'Range overlap',
    '-5048': 'Too many sessions',
    '-5050': 'Too many files',
    '-5051': 'Volume locked',
    '-5055': 'Authentication failed',
  };
  return errors[code] ?? `AFP error ${code}`;
}

// ─── DSI Helpers ─────────────────────────────────────────────────────────────

function getDSICommandName(cmd: number): string {
  switch (cmd) {
    case DSI_CLOSE_SESSION: return 'DSICloseSession';
    case DSI_COMMAND: return 'DSICommand';
    case DSI_GET_STATUS: return 'DSIGetStatus';
    case DSI_OPEN_SESSION: return 'DSIOpenSession';
    case DSI_TICKLE: return 'DSITickle';
    case DSI_ATTENTION: return 'DSIAttention';
    default: return `DSI_0x${cmd.toString(16).padStart(2, '0')}`;
  }
}

function buildDSIHeader(flags: number, command: number, requestId: number, errorCodeOrOffset: number, dataLength: number): Uint8Array {
  const header = new Uint8Array(DSI_HEADER_SIZE);
  const view = new DataView(header.buffer);
  header[0] = flags;
  header[1] = command;
  view.setUint16(2, requestId, false);
  view.setInt32(4, errorCodeOrOffset, false);
  view.setUint32(8, dataLength, false);
  return header;
}

export function buildDSIOpenSession(requestId: number): Uint8Array {
  const optionData = new Uint8Array([0x01, 0x04, 0x00, 0x00, 0x04, 0x00]); // Attention Quantum = 1024
  const header = buildDSIHeader(DSI_FLAG_REQUEST, DSI_OPEN_SESSION, requestId, 0, optionData.length);
  const message = new Uint8Array(DSI_HEADER_SIZE + optionData.length);
  message.set(header, 0);
  message.set(optionData, DSI_HEADER_SIZE);
  return message;
}

function buildDSIGetStatus(requestId: number): Uint8Array {
  return buildDSIHeader(DSI_FLAG_REQUEST, DSI_GET_STATUS, requestId, 0, 0);
}

function buildDSICommand(requestId: number, afpPayload: Uint8Array): Uint8Array {
  const header = buildDSIHeader(DSI_FLAG_REQUEST, DSI_COMMAND, requestId, 0, afpPayload.length);
  const msg = new Uint8Array(DSI_HEADER_SIZE + afpPayload.length);
  msg.set(header, 0);
  msg.set(afpPayload, DSI_HEADER_SIZE);
  return msg;
}

function buildDSICloseSession(requestId: number): Uint8Array {
  return buildDSIHeader(DSI_FLAG_REQUEST, DSI_CLOSE_SESSION, requestId, 0, 0);
}

function parseDSIHeader(data: Uint8Array): {
  flags: number; command: number; requestId: number;
  errorCode: number; dataLength: number;
} | null {
  if (data.length < DSI_HEADER_SIZE) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    flags: data[0],
    command: data[1],
    requestId: view.getUint16(2, false),
    errorCode: view.getInt32(4, false),
    dataLength: view.getUint32(8, false),
  };
}

// ─── AFP Payload Builders ─────────────────────────────────────────────────────

function buildPascalString(str: string): Uint8Array {
  const bytes = new TextEncoder().encode(str);
  const out = new Uint8Array(1 + bytes.length);
  out[0] = bytes.length;
  out.set(bytes, 1);
  return out;
}

/** Build an AFP long-name path segment (type byte + pascal string). */
function buildAFPLongPath(name: string): Uint8Array {
  const pascal = buildPascalString(name);
  const out = new Uint8Array(1 + pascal.length);
  out[0] = kFPLongName;
  out.set(pascal, 1);
  return out;
}

/** Build an empty AFP path (type byte + 0-length name — means "current dir"). */
function buildAFPEmptyPath(): Uint8Array {
  return new Uint8Array([kFPLongName, 0]);
}

function buildFPLogin(afpVersion: string, uam: string, username: string, password: string): Uint8Array {
  const verPascal = buildPascalString(afpVersion);
  const uamPascal = buildPascalString(uam);

  if (uam === 'No User Authent') {
    const payload = new Uint8Array(1 + verPascal.length + uamPascal.length);
    let o = 0;
    payload[o++] = FP_LOGIN;
    payload.set(verPascal, o); o += verPascal.length;
    payload.set(uamPascal, o);
    return payload;
  }

  if (uam === 'Cleartxt Passwrd') {
    // 8-byte fixed fields for username and password (null-padded)
    const userBytes = new Uint8Array(8);
    const passBytes = new Uint8Array(8);
    const enc = new TextEncoder();
    const userEnc = enc.encode(username.substring(0, 8));
    const passEnc = enc.encode(password.substring(0, 8));
    userBytes.set(userEnc);
    passBytes.set(passEnc);
    const payload = new Uint8Array(1 + verPascal.length + uamPascal.length + 16);
    let o = 0;
    payload[o++] = FP_LOGIN;
    payload.set(verPascal, o); o += verPascal.length;
    payload.set(uamPascal, o); o += uamPascal.length;
    payload.set(userBytes, o); o += 8;
    payload.set(passBytes, o);
    return payload;
  }

  throw new Error(`Unsupported UAM: ${uam}. Supported: "No User Authent", "Cleartxt Passwrd"`);
}

function buildFPLogout(): Uint8Array {
  return new Uint8Array([FP_LOGOUT]);
}

function buildFPGetSrvrParms(): Uint8Array {
  return new Uint8Array([FP_GET_SRVR_PARMS]);
}

function buildFPOpenVol(bitmap: number, volumeName: string): Uint8Array {
  const namePascal = buildPascalString(volumeName);
  const payload = new Uint8Array(1 + 1 + 2 + namePascal.length);
  const view = new DataView(payload.buffer);
  let o = 0;
  payload[o++] = FP_OPEN_VOL;
  payload[o++] = 0; // pad
  view.setUint16(o, bitmap, false); o += 2;
  payload.set(namePascal, o);
  return payload;
}

function buildFPCloseVol(volumeId: number): Uint8Array {
  const payload = new Uint8Array(1 + 1 + 2);
  const view = new DataView(payload.buffer);
  payload[0] = FP_CLOSE_VOL;
  payload[1] = 0; // pad
  view.setInt16(2, volumeId, false);
  return payload;
}

function buildFPEnumerateExt2(
  volumeId: number, dirId: number,
  fileBitmap: number, dirBitmap: number,
  startIndex = 1, maxCount = 200
): Uint8Array {
  // cmd(1) + pad(1) + volID(2) + dirID(4) + fileBM(2) + dirBM(2) +
  // reqCount(2) + startIndex(4) + maxReplySize(4) + path
  const path = buildAFPEmptyPath(); // enumerate this dir
  const payload = new Uint8Array(1 + 1 + 2 + 4 + 2 + 2 + 2 + 4 + 4 + path.length);
  const view = new DataView(payload.buffer);
  let o = 0;
  payload[o++] = FP_ENUMERATE_EXT2;
  payload[o++] = 0; // pad
  view.setInt16(o, volumeId, false); o += 2;
  view.setInt32(o, dirId, false); o += 4;
  view.setUint16(o, fileBitmap, false); o += 2;
  view.setUint16(o, dirBitmap, false); o += 2;
  view.setUint16(o, maxCount, false); o += 2;
  view.setUint32(o, startIndex, false); o += 4;
  view.setUint32(o, 65536, false); o += 4; // maxReplySize
  payload.set(path, o);
  return payload;
}

function buildFPGetFileDirParms(
  volumeId: number, dirId: number,
  fileBitmap: number, dirBitmap: number,
  name: string
): Uint8Array {
  // cmd(1) + pad(1) + volID(2) + dirID(4) + fileBM(2) + dirBM(2) + path
  const path = buildAFPLongPath(name);
  const payload = new Uint8Array(1 + 1 + 2 + 4 + 2 + 2 + path.length);
  const view = new DataView(payload.buffer);
  let o = 0;
  payload[o++] = FP_GET_FILE_DIR_PARMS;
  payload[o++] = 0;
  view.setInt16(o, volumeId, false); o += 2;
  view.setInt32(o, dirId, false); o += 4;
  view.setUint16(o, fileBitmap, false); o += 2;
  view.setUint16(o, dirBitmap, false); o += 2;
  payload.set(path, o);
  return payload;
}

function buildFPCreateDir(volumeId: number, parentDirId: number, name: string): Uint8Array {
  // cmd(1) + pad(1) + volID(2) + dirID(4) + path
  const path = buildAFPLongPath(name);
  const payload = new Uint8Array(1 + 1 + 2 + 4 + path.length);
  const view = new DataView(payload.buffer);
  let o = 0;
  payload[o++] = FP_CREATE_DIR;
  payload[o++] = 0;
  view.setInt16(o, volumeId, false); o += 2;
  view.setInt32(o, parentDirId, false); o += 4;
  payload.set(path, o);
  return payload;
}

function buildFPCreateFile(volumeId: number, parentDirId: number, name: string, softCreate = false): Uint8Array {
  // cmd(1) + flags(1) + volID(2) + dirID(4) + path
  const path = buildAFPLongPath(name);
  const payload = new Uint8Array(1 + 1 + 2 + 4 + path.length);
  const view = new DataView(payload.buffer);
  let o = 0;
  payload[o++] = FP_CREATE_FILE;
  payload[o++] = softCreate ? 0x80 : 0x00; // SoftCreate flag
  view.setInt16(o, volumeId, false); o += 2;
  view.setInt32(o, parentDirId, false); o += 4;
  payload.set(path, o);
  return payload;
}

function buildFPDelete(volumeId: number, dirId: number, name: string): Uint8Array {
  // cmd(1) + pad(1) + volID(2) + dirID(4) + path
  const path = buildAFPLongPath(name);
  const payload = new Uint8Array(1 + 1 + 2 + 4 + path.length);
  const view = new DataView(payload.buffer);
  let o = 0;
  payload[o++] = FP_DELETE;
  payload[o++] = 0;
  view.setInt16(o, volumeId, false); o += 2;
  view.setInt32(o, dirId, false); o += 4;
  payload.set(path, o);
  return payload;
}

function buildFPRename(volumeId: number, dirId: number, oldName: string, newName: string): Uint8Array {
  // cmd(1) + pad(1) + volID(2) + dirID(4) + oldPath + newPath
  const oldPath = buildAFPLongPath(oldName);
  const newPath = buildAFPLongPath(newName);
  const payload = new Uint8Array(1 + 1 + 2 + 4 + oldPath.length + newPath.length);
  const view = new DataView(payload.buffer);
  let o = 0;
  payload[o++] = FP_RENAME;
  payload[o++] = 0;
  view.setInt16(o, volumeId, false); o += 2;
  view.setInt32(o, dirId, false); o += 4;
  payload.set(oldPath, o); o += oldPath.length;
  payload.set(newPath, o);
  return payload;
}

function buildFPOpenFork(volumeId: number, dirId: number, name: string, bitmap: number): Uint8Array {
  // cmd(1) + isResource(1) + volID(2) + dirID(4) + bitmap(2) + accessMode(2) + path
  const path = buildAFPLongPath(name);
  const payload = new Uint8Array(1 + 1 + 2 + 4 + 2 + 2 + path.length);
  const view = new DataView(payload.buffer);
  let o = 0;
  payload[o++] = FP_OPEN_FORK;
  payload[o++] = 0; // 0 = data fork
  view.setInt16(o, volumeId, false); o += 2;
  view.setInt32(o, dirId, false); o += 4;
  view.setUint16(o, bitmap, false); o += 2; // returned params bitmap
  view.setUint16(o, 0x0001, false); o += 2; // access mode: read
  payload.set(path, o);
  return payload;
}

/**
 * Open a fork with write access.
 * @param forkType 0 = data fork, 1 = resource fork
 * @param accessMode 0x0001=read, 0x0002=write, 0x0003=read+write
 */
function buildFPOpenForkEx(
  volumeId: number,
  dirId: number,
  name: string,
  bitmap: number,
  forkType: 0 | 1,
  accessMode: number,
): Uint8Array {
  const path = buildAFPLongPath(name);
  const payload = new Uint8Array(1 + 1 + 2 + 4 + 2 + 2 + path.length);
  const view = new DataView(payload.buffer);
  let o = 0;
  payload[o++] = FP_OPEN_FORK;
  payload[o++] = forkType; // 0 = data fork, 1 = resource fork
  view.setInt16(o, volumeId, false); o += 2;
  view.setInt32(o, dirId, false); o += 4;
  view.setUint16(o, bitmap, false); o += 2;
  view.setUint16(o, accessMode, false); o += 2;
  payload.set(path, o);
  return payload;
}

/**
 * FPWriteExt — write data to an open fork.
 * @param startEndFlag 0 = offset from beginning, 1 = offset from end-of-fork
 */
function buildFPWriteExt(forkRefNum: number, offset: bigint, data: Uint8Array, startEndFlag = 0): Uint8Array {
  // cmd(1) + startEndFlag(1) + forkRefNum(2) + offset(8) + count(8) + data
  const header = new Uint8Array(1 + 1 + 2 + 8 + 8);
  const view = new DataView(header.buffer);
  let o = 0;
  header[o++] = FP_WRITE_EXT;
  header[o++] = startEndFlag;
  view.setInt16(o, forkRefNum, false); o += 2;
  view.setBigInt64(o, offset, false); o += 8;
  view.setBigInt64(o, BigInt(data.length), false);
  const payload = new Uint8Array(header.length + data.length);
  payload.set(header, 0);
  payload.set(data, header.length);
  return payload;
}

function buildFPCloseFork(forkRefNum: number): Uint8Array {
  const payload = new Uint8Array(1 + 1 + 2);
  const view = new DataView(payload.buffer);
  payload[0] = FP_CLOSE_FORK;
  payload[1] = 0;
  view.setInt16(2, forkRefNum, false);
  return payload;
}

function buildFPReadExt(forkRefNum: number, offset: bigint, requestCount: bigint): Uint8Array {
  // cmd(1) + pad(1) + forkRefNum(2) + offset(8) + requestCount(8)
  const payload = new Uint8Array(1 + 1 + 2 + 8 + 8);
  const view = new DataView(payload.buffer);
  let o = 0;
  payload[o++] = FP_READ_EXT;
  payload[o++] = 0;
  view.setInt16(o, forkRefNum, false); o += 2;
  view.setBigInt64(o, offset, false); o += 8;
  view.setBigInt64(o, requestCount, false);
  return payload;
}

// ─── AFP Response Parsers ─────────────────────────────────────────────────────

function parseFPGetSrvrParms(data: Uint8Array): {
  volumes: Array<{ name: string; hasPassword: boolean }>;
} {
  const decoder = new TextDecoder();
  const numVolumes = data[4] ?? 0;
  const volumes: Array<{ name: string; hasPassword: boolean }> = [];
  let offset = 5;
  for (let i = 0; i < numVolumes && offset < data.length; i++) {
    if (offset + 2 > data.length) break;
    const flags = data[offset++];
    const hasPassword = (flags & 0x80) !== 0;
    const nameLen = data[offset++];
    if (offset + nameLen > data.length) break;
    const name = decoder.decode(data.subarray(offset, offset + nameLen));
    offset += nameLen;
    volumes.push({ name, hasPassword });
  }
  return { volumes };
}

function parseFPOpenVol(data: Uint8Array): { volumeId: number } {
  if (data.length < 4) throw new Error('FPOpenVol response too short');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // Reply: Bitmap (2 bytes) + VolumeID (2 bytes) + ...
  const volumeId = view.getInt16(2, false);
  return { volumeId };
}

export interface AFPDirEntry {
  name: string;
  isDir: boolean;
  nodeId?: number;
  modDate?: number;
  size?: number;
  attributes?: number;
}

/**
 * Parse a single entry from FPEnumerateExt2 response.
 * Entry data starts after the 2-byte EntryLength field.
 * Fields are packed in bitmap bit-order (bit 0 first).
 */
function parseEnumerateEntry(data: Uint8Array, fileBitmap: number, dirBitmap: number): AFPDirEntry | null {
  if (data.length < 2) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder();

  // First field is always Attributes (if kFPAttributeBit is set in BOTH bitmaps)
  // Bit 15 of Attributes = isDir
  let isDir = false;
  if ((fileBitmap & kFPAttributeBit) && (dirBitmap & kFPAttributeBit)) {
    const attrs = view.getUint16(0, false);
    isDir = (attrs & 0x8000) !== 0;
  }

  const bitmap = isDir ? dirBitmap : fileBitmap;
  const entry: AFPDirEntry = { name: '', isDir };
  let o = 0;

  if (bitmap & kFPAttributeBit) {
    entry.attributes = view.getUint16(o, false);
    o += 2;
  }
  if (bitmap & kFPParentDirIDBit) {
    o += 4; // skip parent dir ID
  }
  if (bitmap & kFPCreateDateBit) {
    o += 4; // skip create date
  }
  if (bitmap & kFPModDateBit) {
    if (o + 4 <= data.length) {
      entry.modDate = view.getUint32(o, false);
    }
    o += 4;
  }
  if (bitmap & 0x0010) {
    o += 4; // BackupDate
  }
  if (bitmap & kFPFinderInfoBit) {
    o += 32; // FinderInfo
  }
  if (bitmap & kFPLongNameBit) {
    if (o < data.length) {
      const nameLen = data[o++];
      if (o + nameLen <= data.length) {
        entry.name = decoder.decode(data.subarray(o, o + nameLen));
        o += nameLen;
        // Align to even byte boundary
        if ((1 + nameLen) % 2 !== 0) o++;
      }
    }
  }
  if (bitmap & 0x0080) {
    // ShortName (Pascal string)
    if (o < data.length) {
      const len = data[o++];
      o += len;
      if ((1 + len) % 2 !== 0) o++;
    }
  }
  if (bitmap & kFPNodeIDBit) {
    if (o + 4 <= data.length) {
      entry.nodeId = view.getUint32(o, false);
    }
    o += 4;
  }
  // For files: DataForkLen (4 bytes); for dirs: OffspringCount (2 bytes)
  if (bitmap & kFPDataForkLenBit) {
    if (isDir) {
      if (o + 2 <= data.length) entry.size = view.getUint16(o, false);
      o += 2;
    } else {
      if (o + 4 <= data.length) entry.size = view.getUint32(o, false);
      o += 4;
    }
  }

  return entry;
}

function parseFPEnumerateExt2(data: Uint8Array): AFPDirEntry[] {
  if (data.length < 2) return [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const actualCount = view.getUint16(0, false);
  const entries: AFPDirEntry[] = [];
  let offset = 2;

  for (let i = 0; i < actualCount && offset < data.length; i++) {
    if (offset + 2 > data.length) break;
    const entryLength = view.getUint16(offset, false);
    if (entryLength < 2) break;
    const entryData = data.subarray(offset + 2, offset + entryLength);
    const entry = parseEnumerateEntry(entryData, FILE_BITMAP, DIR_BITMAP);
    if (entry) entries.push(entry);
    offset += entryLength;
    // Align to even byte
    if (offset % 2 !== 0) offset++;
  }

  return entries;
}

interface AFPFileInfo {
  name: string;
  isDir: boolean;
  nodeId?: number;
  modDate?: number;
  size?: number;
  attributes?: number;
}

function parseFPGetFileDirParms(data: Uint8Array): AFPFileInfo {
  if (data.length < 4) return { name: '', isDir: false };
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // Reply: FileBitmap (2) + DirBitmap (2) + IsDir(1) + Pad(1) + attributes per bitmap
  const fileBitmap = view.getUint16(0, false);
  const dirBitmap = view.getUint16(2, false);
  // IsDir flag in byte 4
  const isDir = data[4] !== 0;
  const bitmapData = data.subarray(6);
  const entry = parseEnumerateEntry(bitmapData, fileBitmap, dirBitmap);
  if (!entry) return { name: '', isDir };
  entry.isDir = isDir;
  return entry;
}

function parseFPCreateDir(data: Uint8Array): number {
  if (data.length < 4) return 0;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getInt32(0, false);
}

function parseFPOpenFork(data: Uint8Array): number {
  if (data.length < 4) return 0;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // Reply: FileBitmap (2) + ForkRefNum (2) + ...
  return view.getInt16(2, false);
}

// ─── Low-Level I/O ───────────────────────────────────────────────────────────

async function readExact(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  length: number,
  timeoutMs: number
): Promise<Uint8Array> {
  const buffer = new Uint8Array(length);
  let offset = 0;
  const deadline = Date.now() + timeoutMs;

  while (offset < length) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Read timeout');

    const readPromise = reader.read();
    const timeoutPromise = new Promise<{ done: true; value: undefined }>((resolve) =>
      setTimeout(() => resolve({ done: true, value: undefined }), remaining)
    );

    const { done, value } = await Promise.race([readPromise, timeoutPromise]);
    if (done || !value) throw new Error('Connection closed by server');

    const toCopy = Math.min(value.length, length - offset);
    buffer.set(value.subarray(0, toCopy), offset);
    offset += toCopy;
  }

  return buffer;
}

/** Read a full DSI response (header + optional payload). */
async function readDSIResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<{ header: ReturnType<typeof parseDSIHeader>; payload: Uint8Array }> {
  const headerBytes = await readExact(reader, DSI_HEADER_SIZE, timeoutMs);
  const header = parseDSIHeader(headerBytes);
  if (!header) throw new Error('Invalid DSI header');

  // eslint-disable-next-line prefer-const
  let payload: Uint8Array = new Uint8Array(0);
  if (header.dataLength > 0 && header.dataLength < 1024 * 1024) {
    // Cast needed due to Uint8Array<ArrayBufferLike> vs Uint8Array<ArrayBuffer> variance
    payload = await readExact(reader, header.dataLength, timeoutMs) as unknown as Uint8Array;
  }

  return { header, payload };
}

// ─── AFP Session Class ────────────────────────────────────────────────────────

class AFPSession {
  private socket!: ReturnType<typeof connect>;
  private reader!: ReadableStreamDefaultReader<Uint8Array>;
  private writer!: WritableStreamDefaultWriter<Uint8Array>;
  private requestId = 0;
  private timeoutMs: number;

  constructor(timeoutMs = 15000) {
    this.timeoutMs = timeoutMs;
  }

  async connect(host: string, port: number): Promise<void> {
    this.socket = connect({ hostname: host, port });
    await this.socket.opened;
    this.reader = this.socket.readable.getReader();
    this.writer = this.socket.writable.getWriter();
  }

  private nextId(): number {
    return ++this.requestId;
  }

  /** Send DSIOpenSession and wait for server's reply. */
  async openSession(): Promise<void> {
    const msg = buildDSIOpenSession(this.nextId());
    await this.writer.write(msg);
    const { header } = await readDSIResponse(this.reader, this.timeoutMs);
    if (header!.errorCode !== AFP_NO_ERR) {
      throw new Error(`DSIOpenSession failed: ${getAFPErrorMessage(header!.errorCode)}`);
    }
  }

  /** Send an AFP command via DSICommand and return the reply payload. */
  async sendCommand(afpPayload: Uint8Array): Promise<Uint8Array> {
    const msg = buildDSICommand(this.nextId(), afpPayload);
    await this.writer.write(msg);

    // Drain any DSITickle or DSIAttention frames before the real reply
    while (true) {
      const { header, payload } = await readDSIResponse(this.reader, this.timeoutMs);
      if (header!.command === DSI_TICKLE || header!.command === DSI_ATTENTION) continue;
      if (header!.errorCode !== AFP_NO_ERR) {
        throw new Error(getAFPErrorMessage(header!.errorCode));
      }
      return payload;
    }
  }

  async login(username: string, password: string, uam: string, afpVersion = 'AFP3.4'): Promise<void> {
    const payload = buildFPLogin(afpVersion, uam, username, password);
    await this.sendCommand(payload);
  }

  async logout(): Promise<void> {
    try {
      await this.sendCommand(buildFPLogout());
    } catch {
      // Ignore logout errors
    }
  }

  async listVolumes(): Promise<Array<{ name: string; hasPassword: boolean }>> {
    const payload = await this.sendCommand(buildFPGetSrvrParms());
    const { volumes } = parseFPGetSrvrParms(payload);
    return volumes;
  }

  async openVolume(volumeName: string): Promise<number> {
    const payload = await this.sendCommand(buildFPOpenVol(VOL_BITMAP, volumeName));
    const { volumeId } = parseFPOpenVol(payload);
    return volumeId;
  }

  async closeVolume(volumeId: number): Promise<void> {
    try {
      await this.sendCommand(buildFPCloseVol(volumeId));
    } catch {
      // Ignore close errors
    }
  }

  /** List a directory. dirId=2 is the volume root. */
  async listDir(volumeId: number, dirId: number): Promise<AFPDirEntry[]> {
    const payload = await this.sendCommand(
      buildFPEnumerateExt2(volumeId, dirId, FILE_BITMAP, DIR_BITMAP)
    );
    return parseFPEnumerateExt2(payload);
  }

  async getInfo(volumeId: number, dirId: number, name: string): Promise<AFPFileInfo> {
    const payload = await this.sendCommand(
      buildFPGetFileDirParms(volumeId, dirId, FILE_BITMAP, DIR_BITMAP, name)
    );
    return parseFPGetFileDirParms(payload);
  }

  /** Create a new directory. Returns the new directory's ID. */
  async createDir(volumeId: number, parentDirId: number, name: string): Promise<number> {
    const payload = await this.sendCommand(buildFPCreateDir(volumeId, parentDirId, name));
    return parseFPCreateDir(payload);
  }

  async createFile(volumeId: number, parentDirId: number, name: string): Promise<void> {
    await this.sendCommand(buildFPCreateFile(volumeId, parentDirId, name, false));
  }

  async delete(volumeId: number, dirId: number, name: string): Promise<void> {
    await this.sendCommand(buildFPDelete(volumeId, dirId, name));
  }

  async rename(volumeId: number, dirId: number, oldName: string, newName: string): Promise<void> {
    await this.sendCommand(buildFPRename(volumeId, dirId, oldName, newName));
  }

  /**
   * Write data to a file's data fork.
   * Creates the file first if it does not already exist.
   * @param offset byte offset to write at (0 = beginning)
   * @param create true = create file if missing; false = fail if missing
   */
  async writeFile(
    volumeId: number,
    dirId: number,
    name: string,
    data: Uint8Array,
    offset = 0n,
    create = true,
  ): Promise<{ bytesWritten: number; endOffset: bigint }> {
    if (create) {
      // Attempt to create the file; ignore "file exists" errors (kFPObjectExists = -5001)
      try {
        await this.sendCommand(buildFPCreateFile(volumeId, dirId, name, false));
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (!msg.includes('-5001') && !msg.includes('Object Exists') && !msg.includes('ObjectExists')) {
          throw err;
        }
      }
    }

    // Open data fork with write access (accessMode = 0x0002)
    const openPayload = await this.sendCommand(
      buildFPOpenForkEx(volumeId, dirId, name, 0x0000, 0, 0x0002),
    );
    const forkRef = parseFPOpenFork(openPayload);

    try {
      const writeCmd = buildFPWriteExt(forkRef, offset, data);
      const reply = await this.sendCommand(writeCmd);
      // FPWriteExt reply: lastWrittenOffset (8 bytes BE)
      let endOffset = offset + BigInt(data.length);
      if (reply.length >= 8) {
        endOffset = new DataView(reply.buffer, reply.byteOffset).getBigInt64(0, false);
      }
      return { bytesWritten: data.length, endOffset };
    } finally {
      try { await this.sendCommand(buildFPCloseFork(forkRef)); } catch { /* ignore */ }
    }
  }

  /**
   * Read a file's resource fork. Returns raw bytes.
   * Resource forks hold classic Mac OS metadata (icons, code, etc.)
   */
  async readResourceFork(volumeId: number, dirId: number, name: string, maxBytes = 65536): Promise<Uint8Array> {
    // Open resource fork (forkType=1) with read access
    const openPayload = await this.sendCommand(
      buildFPOpenForkEx(volumeId, dirId, name, 0x0000, 1, 0x0001),
    );
    const forkRef = parseFPOpenFork(openPayload);

    try {
      const readCmd = buildFPReadExt(forkRef, 0n, BigInt(maxBytes));
      const data = await this.sendCommand(readCmd);
      return data;
    } finally {
      try { await this.sendCommand(buildFPCloseFork(forkRef)); } catch { /* ignore */ }
    }
  }

  /** Read file data fork. Returns raw bytes. */
  async readFile(volumeId: number, dirId: number, name: string, maxBytes = 65536): Promise<Uint8Array> {
    // Open the data fork
    const openPayload = await this.sendCommand(buildFPOpenFork(volumeId, dirId, name, 0x0001));
    const forkRef = parseFPOpenFork(openPayload);

    try {
      // Read data
      const readCmd = buildFPReadExt(forkRef, 0n, BigInt(maxBytes));
      const data = await this.sendCommand(readCmd);
      return data;
    } finally {
      // Always close the fork
      try {
        await this.sendCommand(buildFPCloseFork(forkRef));
      } catch { /* ignore */ }
    }
  }

  async close(): Promise<void> {
    try {
      const msg = buildDSICloseSession(this.nextId());
      await this.writer.write(msg);
    } catch { /* ignore */ }
    try { this.reader.releaseLock(); } catch { /* ignore */ }
    try { this.writer.releaseLock(); } catch { /* ignore */ }
    try { await this.socket.close(); } catch { /* ignore */ }
  }
}

// ─── Validation Helpers ───────────────────────────────────────────────────────

interface AFPBaseParams {
  host?: string;
  port?: number;
  timeout?: number;
  username?: string;
  password?: string;
  uam?: string;
}

function validateBase(body: AFPBaseParams): { host: string; port: number; timeout: number } | Response {
  const host = (body.host || '').trim();
  const port = body.port ?? 548;
  const timeout = Math.min(body.timeout ?? 15000, 30000);

  if (!host) {
    return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (port < 1 || port > 65535) {
    return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  return { host, port, timeout };
}

function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}

function jsonErr(error: unknown, status = 500): Response {
  const msg = error instanceof Error ? error.message : String(error);
  return new Response(JSON.stringify({ success: false, error: msg }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

/**
 * POST /api/afp/connect — Probe server info via DSIGetStatus (no auth).
 * Returns server name, AFP versions, supported UAMs, and capabilities.
 */
export async function handleAFPConnect(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as AFPBaseParams;
    const validated = validateBase(body);
    if (validated instanceof Response) return validated;
    const { host, port, timeout } = validated;

    const startTime = Date.now();
    const socket = connect({ hostname: host, port });
    await socket.opened;
    const connectTime = Date.now() - startTime;

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      let requestId = 0;

      const getStatusMsg = buildDSIGetStatus(requestId++);
      await writer.write(getStatusMsg);

      const replyHeader = await readExact(reader, DSI_HEADER_SIZE, timeout - connectTime);
      const header = parseDSIHeader(replyHeader);

      if (!header) {
        return new Response(JSON.stringify({ success: false, error: 'Invalid DSI reply header' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
      if (header.flags !== DSI_FLAG_REPLY) {
        return new Response(JSON.stringify({
          success: false,
          error: `Unexpected DSI flags: 0x${header.flags.toString(16)}`,
          dsiCommand: getDSICommandName(header.command),
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
      if (header.errorCode !== 0) {
        return jsonOk({ success: true, host, port, status: 'error', errorCode: header.errorCode, connectTime, rtt: Date.now() - startTime });
      }

      let serverInfo = null;
      if (header.dataLength > 0 && header.dataLength < 65536) {
        const payload = await readExact(reader, header.dataLength, timeout - (Date.now() - startTime));
        serverInfo = parseServerInfo(payload);
      }

      try { await writer.write(buildDSICloseSession(requestId++)); } catch { /* ignore */ }

      return jsonOk({
        success: true, host, port, status: 'connected',
        dsiCommand: getDSICommandName(header.command),
        serverName: serverInfo?.serverName,
        machineType: serverInfo?.machineType,
        afpVersions: serverInfo?.afpVersions,
        uams: serverInfo?.uams,
        flags: serverInfo?.flags,
        flagDescriptions: serverInfo?.flagDescriptions,
        connectTime,
        rtt: Date.now() - startTime,
      });
    } finally {
      reader.releaseLock();
      writer.releaseLock();
      await socket.close();
    }
  } catch (error) {
    return jsonErr(error);
  }
}

/**
 * POST /api/afp/login — Authenticate and return available volumes.
 * Body: { host, port, username, password, uam, afpVersion? }
 * Returns: { success, serverName, volumes }
 */
export async function handleAFPLogin(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as AFPBaseParams & { afpVersion?: string };
    const validated = validateBase(body);
    if (validated instanceof Response) return validated;
    const { host, port, timeout } = validated;

    const uam = body.uam ?? 'No User Authent';
    const username = body.username ?? '';
    const password = body.password ?? '';
    const afpVersion = body.afpVersion ?? 'AFP3.4';

    const session = new AFPSession(timeout);
    try {
      await session.connect(host, port);
      await session.openSession();
      await session.login(username, password, uam, afpVersion);
      const volumes = await session.listVolumes();
      await session.logout();
      return jsonOk({ success: true, volumes });
    } finally {
      await session.close();
    }
  } catch (error) {
    return jsonErr(error);
  }
}

/**
 * POST /api/afp/list-dir — List a directory's contents.
 * Body: { host, port, username, password, uam, volumeName, dirId? }
 * Returns: { success, entries }
 */
export async function handleAFPListDir(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as AFPBaseParams & { volumeName?: string; dirId?: number };
    const validated = validateBase(body);
    if (validated instanceof Response) return validated;
    const { host, port, timeout } = validated;

    if (!body.volumeName) {
      return new Response(JSON.stringify({ success: false, error: 'volumeName is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const uam = body.uam ?? 'No User Authent';
    const username = body.username ?? '';
    const password = body.password ?? '';
    const dirId = body.dirId ?? 2; // 2 = volume root

    const session = new AFPSession(timeout);
    try {
      await session.connect(host, port);
      await session.openSession();
      await session.login(username, password, uam);
      const volumeId = await session.openVolume(body.volumeName);
      const entries = await session.listDir(volumeId, dirId);
      await session.closeVolume(volumeId);
      await session.logout();
      return jsonOk({ success: true, entries });
    } finally {
      await session.close();
    }
  } catch (error) {
    return jsonErr(error);
  }
}

/**
 * POST /api/afp/get-info — Get file or directory metadata.
 * Body: { host, port, username, password, uam, volumeName, dirId, name }
 * Returns: { success, info }
 */
export async function handleAFPGetInfo(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as AFPBaseParams & { volumeName?: string; dirId?: number; name?: string };
    const validated = validateBase(body);
    if (validated instanceof Response) return validated;
    const { host, port, timeout } = validated;

    if (!body.volumeName || !body.name) {
      return new Response(JSON.stringify({ success: false, error: 'volumeName and name are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const session = new AFPSession(timeout);
    try {
      await session.connect(host, port);
      await session.openSession();
      await session.login(body.username ?? '', body.password ?? '', body.uam ?? 'No User Authent');
      const volumeId = await session.openVolume(body.volumeName);
      const info = await session.getInfo(volumeId, body.dirId ?? 2, body.name);
      await session.closeVolume(volumeId);
      await session.logout();
      return jsonOk({ success: true, info });
    } finally {
      await session.close();
    }
  } catch (error) {
    return jsonErr(error);
  }
}

/**
 * POST /api/afp/create-dir — Create a new directory.
 * Body: { host, port, username, password, uam, volumeName, parentDirId?, name }
 * Returns: { success, dirId }
 */
export async function handleAFPCreateDir(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as AFPBaseParams & { volumeName?: string; parentDirId?: number; name?: string };
    const validated = validateBase(body);
    if (validated instanceof Response) return validated;
    const { host, port, timeout } = validated;

    if (!body.volumeName || !body.name) {
      return new Response(JSON.stringify({ success: false, error: 'volumeName and name are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const session = new AFPSession(timeout);
    try {
      await session.connect(host, port);
      await session.openSession();
      await session.login(body.username ?? '', body.password ?? '', body.uam ?? 'No User Authent');
      const volumeId = await session.openVolume(body.volumeName);
      const dirId = await session.createDir(volumeId, body.parentDirId ?? 2, body.name);
      await session.closeVolume(volumeId);
      await session.logout();
      return jsonOk({ success: true, dirId });
    } finally {
      await session.close();
    }
  } catch (error) {
    return jsonErr(error);
  }
}

/**
 * POST /api/afp/create-file — Create a new empty file.
 * Body: { host, port, username, password, uam, volumeName, parentDirId?, name }
 * Returns: { success }
 */
export async function handleAFPCreateFile(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as AFPBaseParams & { volumeName?: string; parentDirId?: number; name?: string };
    const validated = validateBase(body);
    if (validated instanceof Response) return validated;
    const { host, port, timeout } = validated;

    if (!body.volumeName || !body.name) {
      return new Response(JSON.stringify({ success: false, error: 'volumeName and name are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const session = new AFPSession(timeout);
    try {
      await session.connect(host, port);
      await session.openSession();
      await session.login(body.username ?? '', body.password ?? '', body.uam ?? 'No User Authent');
      const volumeId = await session.openVolume(body.volumeName);
      await session.createFile(volumeId, body.parentDirId ?? 2, body.name);
      await session.closeVolume(volumeId);
      await session.logout();
      return jsonOk({ success: true });
    } finally {
      await session.close();
    }
  } catch (error) {
    return jsonErr(error);
  }
}

/**
 * POST /api/afp/delete — Delete a file or directory.
 * Body: { host, port, username, password, uam, volumeName, dirId?, name }
 * Returns: { success }
 */
export async function handleAFPDelete(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as AFPBaseParams & { volumeName?: string; dirId?: number; name?: string };
    const validated = validateBase(body);
    if (validated instanceof Response) return validated;
    const { host, port, timeout } = validated;

    if (!body.volumeName || !body.name) {
      return new Response(JSON.stringify({ success: false, error: 'volumeName and name are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const session = new AFPSession(timeout);
    try {
      await session.connect(host, port);
      await session.openSession();
      await session.login(body.username ?? '', body.password ?? '', body.uam ?? 'No User Authent');
      const volumeId = await session.openVolume(body.volumeName);
      await session.delete(volumeId, body.dirId ?? 2, body.name);
      await session.closeVolume(volumeId);
      await session.logout();
      return jsonOk({ success: true });
    } finally {
      await session.close();
    }
  } catch (error) {
    return jsonErr(error);
  }
}

/**
 * POST /api/afp/rename — Rename a file or directory within the same parent directory.
 * Body: { host, port, username, password, uam, volumeName, dirId?, oldName, newName }
 * Returns: { success }
 */
export async function handleAFPRename(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as AFPBaseParams & {
      volumeName?: string; dirId?: number;
      oldName?: string; newName?: string;
    };
    const validated = validateBase(body);
    if (validated instanceof Response) return validated;
    const { host, port, timeout } = validated;

    if (!body.volumeName || !body.oldName || !body.newName) {
      return new Response(JSON.stringify({ success: false, error: 'volumeName, oldName, and newName are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const session = new AFPSession(timeout);
    try {
      await session.connect(host, port);
      await session.openSession();
      await session.login(body.username ?? '', body.password ?? '', body.uam ?? 'No User Authent');
      const volumeId = await session.openVolume(body.volumeName);
      await session.rename(volumeId, body.dirId ?? 2, body.oldName, body.newName);
      await session.closeVolume(volumeId);
      await session.logout();
      return jsonOk({ success: true });
    } finally {
      await session.close();
    }
  } catch (error) {
    return jsonErr(error);
  }
}

/**
 * POST /api/afp/read-file — Read a file's data fork (up to 64 KB).
 * Body: { host, port, username, password, uam, volumeName, dirId?, name }
 * Returns: { success, data (base64), size }
 */
export async function handleAFPReadFile(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as AFPBaseParams & { volumeName?: string; dirId?: number; name?: string };
    const validated = validateBase(body);
    if (validated instanceof Response) return validated;
    const { host, port, timeout } = validated;

    if (!body.volumeName || !body.name) {
      return new Response(JSON.stringify({ success: false, error: 'volumeName and name are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const session = new AFPSession(timeout);
    try {
      await session.connect(host, port);
      await session.openSession();
      await session.login(body.username ?? '', body.password ?? '', body.uam ?? 'No User Authent');
      const volumeId = await session.openVolume(body.volumeName);
      const data = await session.readFile(volumeId, body.dirId ?? 2, body.name);
      await session.closeVolume(volumeId);
      await session.logout();

      // Encode as base64
      let binary = '';
      for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
      const base64 = btoa(binary);

      return jsonOk({ success: true, data: base64, size: data.length });
    } finally {
      await session.close();
    }
  } catch (error) {
    return jsonErr(error);
  }
}

// ─── Server Info Parser (for DSIGetStatus / FPGetSrvrInfo) ──────────────────

function parseServerInfo(data: Uint8Array): {
  serverName: string;
  machineType: string;
  afpVersions: string[];
  uams: string[];
  flags: number;
  flagDescriptions: string[];
  utf8ServerName?: string;
  serverSignature?: string;
  directoryNames?: string[];
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder('utf-8', { fatal: false });

  const machineTypeOffset = view.getUint16(0, false);
  const afpVersionsOffset = view.getUint16(2, false);
  const uamsOffset = view.getUint16(4, false);
  const flags = view.getUint16(8, false);

  const serverNameLen = data[10];
  const serverName = decoder.decode(data.subarray(11, 11 + serverNameLen));

  const flagDescriptions: string[] = [];
  if (flags & 0x01) flagDescriptions.push('CopyFile');
  if (flags & 0x02) flagDescriptions.push('ChangeablePasswords');
  if (flags & 0x04) flagDescriptions.push('NoSavePassword');
  if (flags & 0x08) flagDescriptions.push('ServerMessages');
  if (flags & 0x10) flagDescriptions.push('ServerSignature');
  if (flags & 0x20) flagDescriptions.push('TCPoverIP');
  if (flags & 0x40) flagDescriptions.push('ServerNotifications');
  if (flags & 0x80) flagDescriptions.push('Reconnect');
  if (flags & 0x100) flagDescriptions.push('DirectoryServices');
  if (flags & 0x200) flagDescriptions.push('UTF8ServerName');
  if (flags & 0x400) flagDescriptions.push('UUIDs');
  if (flags & 0x800) flagDescriptions.push('SuperClient');

  let machineType = '';
  if (machineTypeOffset > 0 && machineTypeOffset < data.length) {
    const mtLen = data[machineTypeOffset];
    if (machineTypeOffset + 1 + mtLen <= data.length) {
      machineType = decoder.decode(data.subarray(machineTypeOffset + 1, machineTypeOffset + 1 + mtLen));
    }
  }

  const afpVersions: string[] = [];
  if (afpVersionsOffset > 0 && afpVersionsOffset < data.length) {
    const count = data[afpVersionsOffset];
    let offset = afpVersionsOffset + 1;
    for (let i = 0; i < count && offset < data.length; i++) {
      const len = data[offset++];
      if (offset + len <= data.length) {
        afpVersions.push(decoder.decode(data.subarray(offset, offset + len)));
      }
      offset += len;
    }
  }

  const uams: string[] = [];
  if (uamsOffset > 0 && uamsOffset < data.length) {
    const count = data[uamsOffset];
    let offset = uamsOffset + 1;
    for (let i = 0; i < count && offset < data.length; i++) {
      const len = data[offset++];
      if (offset + len <= data.length) {
        uams.push(decoder.decode(data.subarray(offset, offset + len)));
      }
      offset += len;
    }
  }

  return {
    serverName, machineType, afpVersions, uams, flags, flagDescriptions,
    utf8ServerName: undefined, serverSignature: undefined, directoryNames: undefined,
  };
}


// ─── handleAFPGetServerInfo ──────────────────────────────────────────────────

interface AFPGetServerInfoResponse {
  success: boolean;
  serverName?: string;
  machineType?: string;
  afpVersions?: string[];
  uams?: string[];
  flags?: number;
  latencyMs: number;
  error?: string;
}

/**
 * POST /api/afp/serverinfo
 *
 * Sends a DSI GetStatus request (command 3) and parses the FPGetSrvrInfo
 * response to retrieve server metadata without authenticating.
 *
 * Body: { host, port?, timeout? }
 */
export async function handleAFPGetServerInfo(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const startTime = Date.now();

  try {
    const body = await request.json() as AFPBaseParams;
    const validated = validateBase(body);
    if (validated instanceof Response) return validated;
    const { host, port, timeout } = validated;

    const socket = connect({ hostname: host, port });
    await socket.opened;

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      // Send DSI GetStatus (command 3, no body)
      const getStatusMsg = buildDSIGetStatus(1);
      await writer.write(getStatusMsg);

      // Read reply
      const headerBytes = await readExact(reader, DSI_HEADER_SIZE, timeout - (Date.now() - startTime));
      const header = parseDSIHeader(headerBytes);

      if (!header) throw new Error('Invalid DSI reply header');
      if (header.flags !== DSI_FLAG_REPLY) {
        throw new Error(`Unexpected DSI flags: 0x${header.flags.toString(16)}`);
      }
      if (header.errorCode !== 0) {
        throw new Error(`DSI error: ${getAFPErrorMessage(header.errorCode)}`);
      }

      let serverInfo: ReturnType<typeof parseServerInfo> | null = null;
      if (header.dataLength > 0 && header.dataLength < 65536) {
        const payload = await readExact(reader, header.dataLength, timeout - (Date.now() - startTime)) as unknown as Uint8Array;
        serverInfo = parseServerInfo(payload);
      }

      const result: AFPGetServerInfoResponse = {
        success: true,
        serverName: serverInfo?.serverName,
        machineType: serverInfo?.machineType,
        afpVersions: serverInfo?.afpVersions,
        uams: serverInfo?.uams,
        flags: serverInfo?.flags,
        latencyMs: Date.now() - startTime,
      };

      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });

    } finally {
      reader.releaseLock();
      writer.releaseLock();
      await socket.close();
    }

  } catch (error) {
    const result: AFPGetServerInfoResponse = {
      success: false,
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── handleAFPOpenSession ─────────────────────────────────────────────────────

interface AFPOpenSessionResponse {
  success: boolean;
  sessionToken?: string;
  latencyMs: number;
  error?: string;
}

/**
 * Build a DSI OpenSession request with AFP Option 0 (attnQuant = 4096).
 *
 * The option block format is:
 *   option-type  (1 byte)  = 0x00 (attnQuant)
 *   option-length (1 byte) = 0x04 (4 bytes)
 *   option-value  (4 bytes) = 0x00001000 (4096)
 */
function buildDSIOpenSessionAFP0(requestId: number): Uint8Array {
  const optionData = new Uint8Array(6);
  const ov = new DataView(optionData.buffer);
  optionData[0] = 0x00; // option type: attnQuant
  optionData[1] = 0x04; // option length: 4 bytes
  ov.setUint32(2, 4096, false); // value: 4096

  const header = buildDSIHeader(DSI_FLAG_REQUEST, DSI_OPEN_SESSION, requestId, 0, optionData.length);
  const msg = new Uint8Array(DSI_HEADER_SIZE + optionData.length);
  msg.set(header, 0);
  msg.set(optionData, DSI_HEADER_SIZE);
  return msg;
}

/**
 * POST /api/afp/opensession
 *
 * Sends a DSI OpenSession request and parses the response to establish
 * an AFP session. Returns the server-assigned session token (request ID
 * echoed back) as a hex string.
 *
 * Body: { host, port?, timeout? }
 */
export async function handleAFPOpenSession(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const startTime = Date.now();

  try {
    const body = await request.json() as AFPBaseParams;
    const validated = validateBase(body);
    if (validated instanceof Response) return validated;
    const { host, port, timeout } = validated;

    const socket = connect({ hostname: host, port });
    await socket.opened;

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      const requestId = 1;
      const openSessionMsg = buildDSIOpenSessionAFP0(requestId);
      await writer.write(openSessionMsg);

      const { header, payload } = await readDSIResponse(reader, timeout - (Date.now() - startTime));

      if (!header) throw new Error('Invalid DSI reply header');
      if (header.flags !== DSI_FLAG_REPLY) {
        throw new Error(`Unexpected DSI flags: 0x${header.flags.toString(16)}`);
      }
      if (header.errorCode !== 0) {
        throw new Error(`DSI OpenSession error: ${getAFPErrorMessage(header.errorCode)}`);
      }

      // The session token is derived from the echoed request ID; encode any
      // option data in the reply as hex for the caller to inspect.
      const sessionToken = Array.from(payload)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const result: AFPOpenSessionResponse = {
        success: true,
        // If server returned no option data, use the echoed request ID as a token
        sessionToken: sessionToken || requestId.toString(16).padStart(4, '0'),
        latencyMs: Date.now() - startTime,
      };

      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });

    } finally {
      reader.releaseLock();
      writer.releaseLock();
      await socket.close();
    }

  } catch (error) {
    const result: AFPOpenSessionResponse = {
      success: false,
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── handleAFPWriteFile ───────────────────────────────────────────────────────

/**
 * POST /api/afp/writefile
 *
 * Write data to a file's data fork on an AFP share.
 * The file is created if it does not exist (pass create=false to suppress).
 * Data is provided as a base64-encoded string.
 *
 * Body: { host, port=548, timeout=15000,
 *         username, password, uam='No User Authent',
 *         volumeName, dirId=2, name, data, offset=0, create=true }
 */
export async function handleAFPWriteFile(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as AFPBaseParams & {
      volumeName?: string;
      dirId?: number;
      name?: string;
      data?: string;
      offset?: number;
      create?: boolean;
    };

    const validated = validateBase(body);
    if (validated instanceof Response) return validated;
    const { host, port, timeout } = validated;

    if (!body.volumeName || !body.name) {
      return new Response(JSON.stringify({ success: false, error: 'volumeName and name are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (typeof body.data !== 'string') {
      return new Response(JSON.stringify({ success: false, error: 'data is required (base64-encoded string)' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Decode base64 data
    let bytes: Uint8Array;
    try {
      const binary = atob(body.data);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    } catch {
      return new Response(JSON.stringify({ success: false, error: 'data must be valid base64' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const session = new AFPSession(timeout);
    try {
      await session.connect(host, port);
      await session.openSession();
      await session.login(body.username ?? '', body.password ?? '', body.uam ?? 'No User Authent');
      const volumeId = await session.openVolume(body.volumeName);
      const result = await session.writeFile(
        volumeId,
        body.dirId ?? 2,
        body.name,
        bytes,
        BigInt(body.offset ?? 0),
        body.create !== false,
      );
      await session.closeVolume(volumeId);
      await session.logout();

      return jsonOk({
        success: true,
        volumeName: body.volumeName,
        name: body.name,
        dirId: body.dirId ?? 2,
        bytesWritten: result.bytesWritten,
        endOffset: result.endOffset.toString(),
      });
    } finally {
      await session.close();
    }
  } catch (error) {
    return jsonErr(error);
  }
}

// ─── handleAFPReadResourceFork ────────────────────────────────────────────────

/**
 * POST /api/afp/resource-fork
 *
 * Read a file's resource fork from an AFP share.
 * Resource forks contain classic Mac OS metadata: icons, CODE resources, etc.
 * Returns base64-encoded fork data.
 *
 * Body: { host, port=548, timeout=15000,
 *         username, password, uam='No User Authent',
 *         volumeName, dirId=2, name, maxBytes=65536 }
 */
export async function handleAFPReadResourceFork(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as AFPBaseParams & {
      volumeName?: string;
      dirId?: number;
      name?: string;
      maxBytes?: number;
    };

    const validated = validateBase(body);
    if (validated instanceof Response) return validated;
    const { host, port, timeout } = validated;

    if (!body.volumeName || !body.name) {
      return new Response(JSON.stringify({ success: false, error: 'volumeName and name are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const session = new AFPSession(timeout);
    try {
      await session.connect(host, port);
      await session.openSession();
      await session.login(body.username ?? '', body.password ?? '', body.uam ?? 'No User Authent');
      const volumeId = await session.openVolume(body.volumeName);
      const data = await session.readResourceFork(volumeId, body.dirId ?? 2, body.name, body.maxBytes ?? 65536);
      await session.closeVolume(volumeId);
      await session.logout();

      // Encode as base64
      let binary = '';
      for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
      const base64 = btoa(binary);

      return jsonOk({
        success: true,
        volumeName: body.volumeName,
        name: body.name,
        dirId: body.dirId ?? 2,
        size: data.length,
        data: base64,
        note: 'Resource fork data. Parse with a resource fork reader for classic Mac OS resources.',
      });
    } finally {
      await session.close();
    }
  } catch (error) {
    return jsonErr(error);
  }
}
