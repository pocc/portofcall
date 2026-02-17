/**
 * CIFS / SMB2 Protocol Implementation
 *
 * Supports authentication (NTLMv2), directory listing, file reads, and server
 * probing against any SMB2 server (Windows, Samba, NAS devices, etc.).
 *
 * Protocol reference:
 *   [MS-SMB2]  https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-smb2/
 *   [MS-NLMP]  https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-nlmp/
 *   [MS-SPNG]  SPNEGO / GSS-API token wrapping
 *
 * Endpoints:
 *   POST /api/cifs/negotiate  — probe server: dialect, GUID, capabilities
 *   POST /api/cifs/auth       — test credentials (NTLMv2 session setup)
 *   POST /api/cifs/ls         — list directory contents in a share
 *   POST /api/cifs/read       — read a file from a share (first 64 KB)
 *   POST /api/cifs/stat       — get metadata for a file or directory
 *   POST /api/cifs/connect    — backward-compat alias for /negotiate
 *
 * Default port: 445 (SMB2 direct TCP)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// ─── Byte helpers ──────────────────────────────────────────────────────────────

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

/** Encode string as UTF-16LE. */
function utf16le(s: string): Uint8Array {
  const b = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    b[i * 2] = c & 0xFF;
    b[i * 2 + 1] = (c >> 8) & 0xFF;
  }
  return b;
}

/** Decode UTF-16LE bytes to a JS string. */
function fromUtf16le(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) {
    s += String.fromCharCode(b[i] | (b[i + 1] << 8));
  }
  return s;
}

/** DER length encoding for ASN.1/SPNEGO. */
function derLen(n: number): Uint8Array {
  if (n < 128) return new Uint8Array([n]);
  if (n < 256) return new Uint8Array([0x81, n]);
  return new Uint8Array([0x82, (n >> 8) & 0xFF, n & 0xFF]);
}

function derTag(tag: number, body: Uint8Array): Uint8Array {
  return concat(new Uint8Array([tag]), derLen(body.length), body);
}

// ─── MD4 (needed for NT hash) ─────────────────────────────────────────────────

function md4(data: Uint8Array): Uint8Array {
  const add = (a: number, b: number) => (a + b) >>> 0;
  const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;
  const F = (x: number, y: number, z: number) => ((x & y) | (~x & z)) >>> 0;
  const G = (x: number, y: number, z: number) => ((x & y) | (x & z) | (y & z)) >>> 0;
  const H = (x: number, y: number, z: number) => (x ^ y ^ z) >>> 0;

  const len = data.length;
  const bitLen = len * 8;
  // Pad to 56 mod 64 bytes, then append 8-byte LE bit length
  const padLen = ((55 - len % 64 + 64) % 64) + 1;
  const msg = new Uint8Array(len + padLen + 8);
  msg.set(data);
  msg[len] = 0x80;
  const dv = new DataView(msg.buffer);
  dv.setUint32(msg.length - 8, bitLen >>> 0, true);
  dv.setUint32(msg.length - 4, Math.floor(bitLen / 0x100000000) >>> 0, true);

  let A = 0x67452301, B = 0xEFCDAB89, C = 0x98BADCFE, D = 0x10325476;

  for (let i = 0; i < msg.length; i += 64) {
    const dv2 = new DataView(msg.buffer, i);
    const M: number[] = Array.from({ length: 16 }, (_, j) => dv2.getUint32(j * 4, true));
    let a = A, b = B, c = C, d = D;

    // Round 1
    const s1 = [3,7,11,19, 3,7,11,19, 3,7,11,19, 3,7,11,19];
    const r1 = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15];
    for (let k = 0; k < 16; k++) {
      const t = add(([a,d,c,b][k&3]), add(F(b,c,d), M[r1[k]]));
      const r = rotl(t, s1[k]);
      [a, d, c, b] = k%4===0?[r,a,b,c] : k%4===1?[b,r,a,c] : k%4===2?[b,c,r,a] : [b,c,d,r];
    }
    // Simpler rewrite of Round 1:
    a = A; b = B; c = C; d = D;
    for (const [x, s, ki] of [
      [0,3,0],[1,7,1],[2,11,2],[3,19,3],
      [0,3,4],[1,7,5],[2,11,6],[3,19,7],
      [0,3,8],[1,7,9],[2,11,10],[3,19,11],
      [0,3,12],[1,7,13],[2,11,14],[3,19,15],
    ] as [number,number,number][]) {
      const tmp = ([a,d,c,b][x]);
      const res = rotl(add(tmp, add(F(b,c,d), M[ki])), s);
      if (x===0){a=res;} else if (x===1){d=res;} else if (x===2){c=res;} else {b=res;}
    }

    // Round 2
    const C2 = 0x5A827999;
    for (const [x, s, ki] of [
      [0,3,0],[1,5,4],[2,9,8],[3,13,12],
      [0,3,1],[1,5,5],[2,9,9],[3,13,13],
      [0,3,2],[1,5,6],[2,9,10],[3,13,14],
      [0,3,3],[1,5,7],[2,9,11],[3,13,15],
    ] as [number,number,number][]) {
      const tmp = ([a,d,c,b][x]);
      const res = rotl(add(tmp, add(G(b,c,d), add(M[ki], C2))), s);
      if (x===0){a=res;} else if (x===1){d=res;} else if (x===2){c=res;} else {b=res;}
    }

    // Round 3
    const C3 = 0x6ED9EBA1;
    for (const [x, s, ki] of [
      [0,3,0],[1,9,8],[2,11,4],[3,15,12],
      [0,3,2],[1,9,10],[2,11,6],[3,15,14],
      [0,3,1],[1,9,9],[2,11,5],[3,15,13],
      [0,3,3],[1,9,11],[2,11,7],[3,15,15],
    ] as [number,number,number][]) {
      const tmp = ([a,d,c,b][x]);
      const res = rotl(add(tmp, add(H(b,c,d), add(M[ki], C3))), s);
      if (x===0){a=res;} else if (x===1){d=res;} else if (x===2){c=res;} else {b=res;}
    }

    A = add(A,a); B = add(B,b); C = add(C,c); D = add(D,d);
  }

  const out = new Uint8Array(16);
  const o = new DataView(out.buffer);
  o.setUint32(0, A, true); o.setUint32(4, B, true);
  o.setUint32(8, C, true); o.setUint32(12, D, true);
  return out;
}

// ─── MD5 (needed for HMAC-MD5 in NTLMv2) ─────────────────────────────────────

function md5(data: Uint8Array): Uint8Array {
  const add = (a: number, b: number) => (a + b) >>> 0;
  const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;

  const T = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0);
  const S = [7,12,17,22, 7,12,17,22, 7,12,17,22, 7,12,17,22,
             5, 9,14,20, 5, 9,14,20, 5, 9,14,20, 5, 9,14,20,
             4,11,16,23, 4,11,16,23, 4,11,16,23, 4,11,16,23,
             6,10,15,21, 6,10,15,21, 6,10,15,21, 6,10,15,21];

  const len = data.length;
  const bitLen = len * 8;
  const padLen = ((55 - len % 64 + 64) % 64) + 1;
  const msg = new Uint8Array(len + padLen + 8);
  msg.set(data);
  msg[len] = 0x80;
  const dv = new DataView(msg.buffer);
  dv.setUint32(msg.length - 8, bitLen >>> 0, true);
  dv.setUint32(msg.length - 4, Math.floor(bitLen / 0x100000000) >>> 0, true);

  let A = 0x67452301, B = 0xEFCDAB89, C = 0x98BADCFE, D = 0x10325476;

  for (let i = 0; i < msg.length; i += 64) {
    const dv2 = new DataView(msg.buffer, i);
    const M: number[] = Array.from({ length: 16 }, (_, j) => dv2.getUint32(j * 4, true));
    let a = A, b = B, c = C, d = D;

    for (let j = 0; j < 64; j++) {
      let f: number, g: number;
      if (j < 16) { f = (b & c) | (~b & d); g = j; }
      else if (j < 32) { f = (d & b) | (~d & c); g = (5*j+1) % 16; }
      else if (j < 48) { f = b ^ c ^ d; g = (3*j+5) % 16; }
      else { f = c ^ (b | ~d); g = (7*j) % 16; }
      const tmp = add(add(a, f), add(M[g], T[j]));
      a = d; d = c; c = b;
      b = add(b, rotl(tmp, S[j]));
    }

    A = add(A,a); B = add(B,b); C = add(C,c); D = add(D,d);
  }

  const out = new Uint8Array(16);
  const o = new DataView(out.buffer);
  o.setUint32(0, A, true); o.setUint32(4, B, true);
  o.setUint32(8, C, true); o.setUint32(12, D, true);
  return out;
}

function hmacMd5(key: Uint8Array, data: Uint8Array): Uint8Array {
  const blockSize = 64;
  let k = key.length > blockSize ? md5(key) : key;
  if (k.length < blockSize) { const pad = new Uint8Array(blockSize); pad.set(k); k = pad; }
  const ipad = new Uint8Array(blockSize).map((_, i) => k[i] ^ 0x36);
  const opad = new Uint8Array(blockSize).map((_, i) => k[i] ^ 0x5C);
  return md5(concat(opad, md5(concat(ipad, data))));
}

// ─── NTLM ─────────────────────────────────────────────────────────────────────

const NTLMSSP_SIGNATURE = new TextEncoder().encode('NTLMSSP\x00');
const NTLM_FLAGS_NEGOTIATE = 0xA0880205; // UNICODE|REQUEST_TARGET|NTLM|EXTENDED|TARGET_INFO|128|KEY_EXCHANGE|56

/** Build NTLMSSP Type 1 (Negotiate) message. */
function buildNtlmNegotiate(domain = '', workstation = ''): Uint8Array {
  const domB = utf16le(domain.toUpperCase());
  const wsB  = utf16le(workstation.toUpperCase());
  const flags = NTLM_FLAGS_NEGOTIATE | (domain ? 0x00001000 : 0) | (workstation ? 0x00002000 : 0);

  // Fields are: 2-byte length, 2-byte maxLength, 4-byte offset
  const domOffset = 40; // after fixed header (32 bytes) + version (8 bytes)
  const wsOffset  = domOffset + domB.length;

  const hdr = new Uint8Array(40);
  hdr.set(NTLMSSP_SIGNATURE, 0);
  const dv = new DataView(hdr.buffer);
  dv.setUint32(8, 0x00000001, true); // MessageType = 1
  dv.setUint32(12, flags, true);
  // DomainName fields
  dv.setUint16(16, domB.length, true); dv.setUint16(18, domB.length, true);
  dv.setUint32(20, domOffset, true);
  // Workstation fields
  dv.setUint16(24, wsB.length, true); dv.setUint16(26, wsB.length, true);
  dv.setUint32(28, wsOffset, true);
  // Version (8 bytes): Windows 10, major 10 minor 0 build 19041, NTLM revision 15
  hdr[32]=10; hdr[33]=0; hdr[34]=0; hdr[35]=0; // major.minor.0.0
  dv.setUint16(36, 19041, true); hdr[38]=0; hdr[39]=15;

  return concat(hdr, domB, wsB);
}

interface NtlmChallenge {
  serverChallenge: Uint8Array;
  targetInfo: Uint8Array;
  targetName: string;
  flags: number;
}

/** Parse NTLMSSP Type 2 (Challenge) message.  Finds the NTLMSSP bytes within a SPNEGO blob. */
function parseNtlmChallenge(blob: Uint8Array): NtlmChallenge | null {
  // Find NTLMSSP signature anywhere in the blob
  const sig = NTLMSSP_SIGNATURE;
  let start = -1;
  outer: for (let i = 0; i <= blob.length - sig.length; i++) {
    for (let j = 0; j < sig.length; j++) {
      if (blob[i+j] !== sig[j]) continue outer;
    }
    start = i; break;
  }
  if (start < 0) return null;

  const b = blob.slice(start);
  if (b.length < 56) return null;
  const dv = new DataView(b.buffer, b.byteOffset);

  const msgType = dv.getUint32(8, true);
  if (msgType !== 2) return null;

  // TargetName fields
  const tnLen = dv.getUint16(12, true);
  const tnOff = dv.getUint32(16, true);
  const flags  = dv.getUint32(20, true);
  const serverChallenge = b.slice(24, 32);

  // TargetInfo fields
  let targetInfo = new Uint8Array(0);
  if (b.length >= 48) {
    const tiLen = dv.getUint16(40, true);
    const tiOff = dv.getUint32(44, true);
    if (tiOff + tiLen <= b.length) targetInfo = b.slice(tiOff, tiOff + tiLen);
  }

  const targetName = tnOff + tnLen <= b.length ? fromUtf16le(b.slice(tnOff, tnOff + tnLen)) : '';
  return { serverChallenge, targetInfo, targetName, flags };
}

/** Compute NT hash (MD4 of UTF-16LE password). */
function ntHash(password: string): Uint8Array {
  return md4(utf16le(password));
}

/** Build NTLMSSP Type 3 (Authenticate) message with NTLMv2. */
function buildNtlmAuthenticate(
  username: string,
  password: string,
  domain: string,
  workstation: string,
  challenge: NtlmChallenge,
): Uint8Array {
  // NTLMv2 hash
  const ntH = ntHash(password);
  const ntlmv2Key = hmacMd5(ntH, utf16le(username.toUpperCase() + domain.toUpperCase()));

  // Client challenge (8 random bytes)
  const clientChallenge = new Uint8Array(8);
  crypto.getRandomValues(clientChallenge);

  // Timestamp: current FILETIME (100-nanosecond intervals since Jan 1, 1601)
  const now = BigInt(Date.now()) * 10000n + 116444736000000000n;
  const ts = new Uint8Array(8);
  const tsDV = new DataView(ts.buffer);
  tsDV.setUint32(0, Number(now & 0xFFFFFFFFn), true);
  tsDV.setUint32(4, Number(now >> 32n), true);

  // NTLMv2 blob
  const blobHeader = new Uint8Array([0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const blob = concat(blobHeader, ts, clientChallenge, new Uint8Array(4), challenge.targetInfo, new Uint8Array(4));

  // NTProofStr = HMAC-MD5(NTLMv2Key, ServerChallenge + blob)
  const ntProofStr = hmacMd5(ntlmv2Key, concat(challenge.serverChallenge, blob));

  // NT response = NTProofStr + blob
  const ntResponse = concat(ntProofStr, blob);

  // LM response: all zeros (LMv2 not needed for NTLMv2)
  const lmResponse = new Uint8Array(24);

  // Encrypted random session key (simplified: zeros for now, since we're not doing signing)
  const sessionKey = new Uint8Array(16);

  // Encode string fields as UTF-16LE
  const domB  = utf16le(domain);
  const userB = utf16le(username);
  const wsB   = utf16le(workstation);

  // Calculate field offsets (after 72-byte fixed header + 8 version)
  const base = 80;
  const lmOff    = base;
  const ntOff    = lmOff + lmResponse.length;
  const domOff   = ntOff + ntResponse.length;
  const userOff  = domOff + domB.length;
  const wsOff    = userOff + userB.length;
  const skOff    = wsOff + wsB.length;
  const totalLen = skOff + sessionKey.length;

  const hdr = new Uint8Array(80);
  hdr.set(NTLMSSP_SIGNATURE, 0);
  const dv = new DataView(hdr.buffer);
  dv.setUint32(8, 0x00000003, true); // MessageType = 3

  // LmChallengeResponse fields
  dv.setUint16(12, lmResponse.length, true); dv.setUint16(14, lmResponse.length, true);
  dv.setUint32(16, lmOff, true);
  // NtChallengeResponse fields
  dv.setUint16(20, ntResponse.length, true); dv.setUint16(22, ntResponse.length, true);
  dv.setUint32(24, ntOff, true);
  // DomainName fields
  dv.setUint16(28, domB.length, true); dv.setUint16(30, domB.length, true);
  dv.setUint32(32, domOff, true);
  // UserName fields
  dv.setUint16(36, userB.length, true); dv.setUint16(38, userB.length, true);
  dv.setUint32(40, userOff, true);
  // Workstation fields
  dv.setUint16(44, wsB.length, true); dv.setUint16(46, wsB.length, true);
  dv.setUint32(48, wsOff, true);
  // EncryptedRandomSessionKey fields
  dv.setUint16(52, sessionKey.length, true); dv.setUint16(54, sessionKey.length, true);
  dv.setUint32(56, skOff, true);
  // NegotiateFlags
  dv.setUint32(60, challenge.flags & ~0x00000800, true); // clear ANONYMOUS
  // Version
  hdr[64]=10; hdr[65]=0; dv.setUint16(68, 19041, true); hdr[72]=15;
  // MIC: all zeros (we don't compute it — requires session key, omitted here)

  return new Uint8Array(concat(hdr, lmResponse, ntResponse, domB, userB, wsB, sessionKey)
    .buffer, 0, totalLen);
}

// ─── SPNEGO wrappers ──────────────────────────────────────────────────────────

// OID for NTLMSSP: 1.3.6.1.4.1.311.2.2.10 = 0x2b 0x06 0x01 0x04 0x01 0x82 0x37 0x02 0x02 0x0a
const NTLMSSP_OID = new Uint8Array([0x2b,0x06,0x01,0x04,0x01,0x82,0x37,0x02,0x02,0x0a]);

/** Wrap NTLM Type 1 in SPNEGO NegTokenInit. */
function spnegoWrapNegotiate(ntlmMsg: Uint8Array): Uint8Array {
  // mechToken: [0x04 || len || ntlmMsg]
  const mechToken = derTag(0x04, ntlmMsg);
  // [2] mechToken
  const mechTokenCtx = derTag(0xa2, mechToken);
  // mechTypes SEQUENCE [ OID ]
  const oid = derTag(0x06, NTLMSSP_OID);
  const mechSeq = derTag(0x30, oid);
  // [0] mechTypes
  const mechTypesCtx = derTag(0xa0, mechSeq);
  // NegTokenInit SEQUENCE
  const negInit = derTag(0x30, concat(mechTypesCtx, mechTokenCtx));
  // [0] APPLICATION
  return derTag(0x60, negInit);
}

/** Wrap NTLM Type 3 in SPNEGO NegTokenResp. */
function spnegoWrapAuthenticate(ntlmMsg: Uint8Array): Uint8Array {
  // responseToken: [0x04 || len || ntlmMsg]
  const respToken = derTag(0xa2, derTag(0x04, ntlmMsg));
  // NegTokenResp SEQUENCE
  const negResp = derTag(0x30, respToken);
  // [1]
  return derTag(0xa1, negResp);
}

// ─── SMB2 ─────────────────────────────────────────────────────────────────────

const SMB2_MAGIC = new Uint8Array([0xFE, 0x53, 0x4D, 0x42]);
const SMB2_CMD_NEGOTIATE     = 0x0000;
const SMB2_CMD_SESSION_SETUP  = 0x0001;
const SMB2_CMD_LOGOFF         = 0x0002;
const SMB2_CMD_TREE_CONNECT   = 0x0003;
const SMB2_CMD_TREE_DISCONNECT = 0x0004;
const SMB2_CMD_CREATE         = 0x0005;
const SMB2_CMD_CLOSE          = 0x0006;
const SMB2_CMD_READ           = 0x0008;
const SMB2_CMD_WRITE          = 0x0009;
const SMB2_CMD_QUERY_DIRECTORY = 0x000E;
const _SMB2_CMD_QUERY_INFO     = 0x0010; void _SMB2_CMD_QUERY_INFO;

const STATUS_SUCCESS = 0x00000000;
const STATUS_MORE_PROCESSING = 0xC0000016;
const STATUS_NO_MORE_FILES = 0x80000006;

// Client GUID (fixed — identifies our SMB2 client)
const CLIENT_GUID = new Uint8Array([
  0x4f, 0x72, 0x74, 0x43, 0x61, 0x6c, 0x6c, 0x53,
  0x4d, 0x42, 0x32, 0x43, 0x6c, 0x69, 0x65, 0x6e,
]); // "OrtCallSMB2Clien"

/** Build SMB2 64-byte header. */
function smb2Header(
  cmd: number,
  msgId: number,
  treeId: number,
  sessionId: Uint8Array, // 8 bytes
  creditCharge = 1,
  creditRequest = 64,
  flags = 0,
): Uint8Array {
  const h = new Uint8Array(64);
  h.set(SMB2_MAGIC, 0);
  const dv = new DataView(h.buffer);
  dv.setUint16(4, 64, true);          // StructureSize
  dv.setUint16(6, creditCharge, true); // CreditCharge
  dv.setUint32(8, 0, true);           // Status = 0
  dv.setUint16(12, cmd, true);         // Command
  dv.setUint16(14, creditRequest, true);
  dv.setUint32(16, flags, true);
  dv.setUint32(20, 0, true);          // NextCommand
  dv.setUint32(24, msgId, true);       // MessageId lo
  dv.setUint32(28, 0, true);           // MessageId hi
  dv.setUint32(32, 0, true);           // Reserved (SYNC) / AsyncId lo
  dv.setUint32(36, treeId, true);      // TreeId
  h.set(sessionId, 40);               // SessionId (8 bytes)
  // Signature: 16 zeros at offset 48
  return h;
}

function netbiosWrap(smb2: Uint8Array): Uint8Array {
  const len = smb2.length;
  return concat(
    new Uint8Array([0x00, (len >> 16) & 0xFF, (len >> 8) & 0xFF, len & 0xFF]),
    smb2,
  );
}

/** Build full SMB2 message (NetBIOS header + SMB2 header + body). */
function smb2Msg(hdr: Uint8Array, body: Uint8Array): Uint8Array {
  return netbiosWrap(concat(hdr, body));
}

// ─── Individual request builders ──────────────────────────────────────────────

const SESSION_ZERO = new Uint8Array(8);

function buildNegotiate(msgId = 0): Uint8Array {
  const hdr = smb2Header(SMB2_CMD_NEGOTIATE, msgId, 0, SESSION_ZERO, 1, 1);
  const dialects = new Uint8Array([0x02,0x02, 0x10,0x02, 0x00,0x03, 0x02,0x03, 0x11,0x03]);
  const body = new Uint8Array(36);
  const dv = new DataView(body.buffer);
  dv.setUint16(0, 36, true);           // StructureSize
  dv.setUint16(2, 5, true);            // DialectCount = 5
  dv.setUint16(4, 0x0001, true);       // SecurityMode = SIGNING_ENABLED
  dv.setUint32(8, 0x7F, true);         // Capabilities
  body.set(CLIENT_GUID, 12);           // ClientGuid
  // NegotiateContextOffset / Count = 0 (no contexts for compat)
  return smb2Msg(hdr, concat(body, dialects));
}

function buildSessionSetup(secBuf: Uint8Array, msgId: number, sessionId = SESSION_ZERO): Uint8Array {
  const hdr = smb2Header(SMB2_CMD_SESSION_SETUP, msgId, 0, sessionId);
  const secOffset = 64 + 24; // SMB2 header + SessionSetup fixed fields
  const body = new Uint8Array(24);
  const dv = new DataView(body.buffer);
  dv.setUint16(0, 25, true);          // StructureSize = 25
  // Flags: 0; SecurityMode: 1; Capabilities: 0x7F; Channel: 0
  body[2] = 0; body[3] = 1;
  dv.setUint32(4, 0x7F, true);         // Capabilities
  dv.setUint16(12, secOffset, true);   // SecurityBufferOffset
  dv.setUint16(14, secBuf.length, true); // SecurityBufferLength
  return smb2Msg(hdr, concat(body, secBuf));
}

function buildTreeConnect(path: string, msgId: number, sessionId: Uint8Array, treeId = 0): Uint8Array {
  const hdr = smb2Header(SMB2_CMD_TREE_CONNECT, msgId, treeId, sessionId);
  const pathB = utf16le(path);
  const pathOffset = 64 + 8; // SMB2 header + TreeConnect fixed fields
  const body = new Uint8Array(8);
  const dv = new DataView(body.buffer);
  dv.setUint16(0, 9, true);           // StructureSize = 9
  dv.setUint16(4, pathOffset, true);  // PathOffset
  dv.setUint16(6, pathB.length, true); // PathLength
  return smb2Msg(hdr, concat(body, pathB));
}

function buildCreate(
  filePath: string,
  msgId: number,
  sessionId: Uint8Array,
  treeId: number,
  isDir: boolean,
): Uint8Array {
  const hdr = smb2Header(SMB2_CMD_CREATE, msgId, treeId, sessionId);
  const nameB = utf16le(filePath);
  const nameOffset = 64 + 56; // SMB2 header + Create fixed body
  const body = new Uint8Array(56);
  const dv = new DataView(body.buffer);
  dv.setUint16(0, 57, true);     // StructureSize = 57
  // SecurityFlags: 0, RequestedOplockLevel: 0, ImpersonationLevel: 2
  body[3] = 2;
  // DesiredAccess
  const access = isDir ? 0x00100001 : 0x00120089; // LIST_DIR+SYNC or READ+SYNC
  dv.setUint32(12, access, true);
  // FileAttributes
  dv.setUint32(16, isDir ? 0x10 : 0x20, true);
  // ShareAccess: READ|WRITE|DELETE
  dv.setUint32(20, 7, true);
  // CreateDisposition: FILE_OPEN = 1
  dv.setUint32(24, 1, true);
  // CreateOptions: DIR_FILE | SYNC_IO_NONALERT (0x21) or SYNC (0x20) for file
  dv.setUint32(28, isDir ? 0x21 : 0x20, true);
  dv.setUint16(32, nameOffset, true); // NameOffset
  dv.setUint16(34, nameB.length, true); // NameLength
  return smb2Msg(hdr, concat(body, nameB));
}

function buildQueryDirectory(fileId: Uint8Array, pattern: string, msgId: number, sessionId: Uint8Array, treeId: number): Uint8Array {
  const hdr = smb2Header(SMB2_CMD_QUERY_DIRECTORY, msgId, treeId, sessionId);
  const patB = utf16le(pattern);
  const patOffset = 64 + 32; // SMB2 header + QDir fixed body
  const body = new Uint8Array(32);
  const dv = new DataView(body.buffer);
  dv.setUint16(0, 33, true);         // StructureSize = 33
  body[2] = 0x01;                    // FileInformationClass: FileDirectoryInformation
  body[3] = 0x00;                    // Flags: 0
  // FileIndex: 0
  body.set(fileId, 8);               // FileId (16 bytes)
  dv.setUint16(24, patOffset, true); // FileNameOffset
  dv.setUint16(26, patB.length, true); // FileNameLength
  dv.setUint32(28, 65536, true);     // OutputBufferLength
  return smb2Msg(hdr, concat(body, patB));
}

function buildRead(fileId: Uint8Array, offset: number, length: number, msgId: number, sessionId: Uint8Array, treeId: number): Uint8Array {
  const hdr = smb2Header(SMB2_CMD_READ, msgId, treeId, sessionId, 1, 64);
  const body = new Uint8Array(48);
  const dv = new DataView(body.buffer);
  dv.setUint16(0, 49, true);     // StructureSize = 49
  // Padding: 0, Reserved: 0
  dv.setUint32(4, length, true); // Length
  dv.setUint32(8, offset, true); // Offset lo
  body.set(fileId, 16);          // FileId (16 bytes)
  dv.setUint32(32, 65536, true); // MinimumCount
  // Channel: 0, RemainingBytes: 0
  dv.setUint16(44, 0, true);     // ReadChannelInfoOffset
  return smb2Msg(hdr, body);
}

function buildCreateForWrite(
  filePath: string,
  msgId: number,
  sessionId: Uint8Array,
  treeId: number,
): Uint8Array {
  const hdr = smb2Header(SMB2_CMD_CREATE, msgId, treeId, sessionId);
  const nameB = utf16le(filePath);
  const nameOffset = 64 + 56;
  const body = new Uint8Array(56);
  const dv = new DataView(body.buffer);
  dv.setUint16(0, 57, true);       // StructureSize = 57
  body[3] = 2;                      // ImpersonationLevel = 2
  dv.setUint32(12, 0x40120116, true); // DesiredAccess: WRITE_DATA|APPEND|WRITE_ATTR|WRITE_EA|READ_CONTROL|SYNC
  dv.setUint32(16, 0x20, true);    // FileAttributes: FILE_ATTRIBUTE_ARCHIVE
  dv.setUint32(20, 1, true);       // ShareAccess: FILE_SHARE_READ
  dv.setUint32(24, 5, true);       // CreateDisposition: FILE_OVERWRITE_IF
  dv.setUint32(28, 0x20, true);    // CreateOptions: FILE_SYNCHRONOUS_IO_NONALERT
  dv.setUint16(32, nameOffset, true);
  dv.setUint16(34, nameB.length, true);
  return smb2Msg(hdr, concat(body, nameB));
}

function buildWrite(
  fileId: Uint8Array,
  data: Uint8Array,
  msgId: number,
  sessionId: Uint8Array,
  treeId: number,
): Uint8Array {
  const hdr = smb2Header(SMB2_CMD_WRITE, msgId, treeId, sessionId);
  const body = new Uint8Array(48);
  const dv = new DataView(body.buffer);
  dv.setUint16(0, 49, true);        // StructureSize = 49
  dv.setUint16(2, 0x70, true);      // DataOffset: SMB2 header (64) + body (48) = 112 = 0x70
  dv.setUint32(4, data.length, true); // Length
  // Offset (8 bytes at offset 8): 0 (write at start)
  body.set(fileId, 16);             // FileId (16 bytes)
  // Channel (4 bytes at offset 32): 0, RemainingBytes: 0, WriteChannelInfoOffset/Length: 0, Flags: 0
  return smb2Msg(hdr, concat(body, data));
}

function buildClose(fileId: Uint8Array, msgId: number, sessionId: Uint8Array, treeId: number): Uint8Array {
  const hdr = smb2Header(SMB2_CMD_CLOSE, msgId, treeId, sessionId);
  const body = new Uint8Array(24);
  const dv = new DataView(body.buffer);
  dv.setUint16(0, 24, true); // StructureSize = 24
  body.set(fileId, 8);       // FileId
  return smb2Msg(hdr, body);
}

function buildTreeDisconnect(msgId: number, sessionId: Uint8Array, treeId: number): Uint8Array {
  const hdr = smb2Header(SMB2_CMD_TREE_DISCONNECT, msgId, treeId, sessionId);
  const body = new Uint8Array([0x04, 0x00, 0x00, 0x00]); // StructureSize=4, Reserved=0
  return smb2Msg(hdr, body);
}

function buildLogoff(msgId: number, sessionId: Uint8Array): Uint8Array {
  const hdr = smb2Header(SMB2_CMD_LOGOFF, msgId, 0, sessionId);
  const body = new Uint8Array([0x04, 0x00, 0x00, 0x00]); // StructureSize=4
  return smb2Msg(hdr, body);
}

// ─── Response parsing ─────────────────────────────────────────────────────────

interface Smb2Response {
  status: number;
  command: number;
  sessionId: Uint8Array;
  treeId: number;
  body: Uint8Array; // payload after the 64-byte SMB2 header
}

function parseSmb2Response(data: Uint8Array): Smb2Response | null {
  if (data.length < 68) return null; // 4 NetBIOS + 64 SMB2 header
  const smb = data.slice(4); // skip NetBIOS header
  if (smb[0] !== 0xFE || smb[1] !== 0x53 || smb[2] !== 0x4D || smb[3] !== 0x42) return null;
  const dv = new DataView(smb.buffer, smb.byteOffset);
  const status  = dv.getUint32(8, true);
  const command = dv.getUint16(12, true);
  const treeId  = dv.getUint32(36, true);
  const sessionId = smb.slice(40, 48);
  const body = smb.slice(64);
  return { status, command, treeId, sessionId, body };
}

interface NegotiateInfo {
  dialect: string;
  dialectRevision: number;
  serverGuid: string;
  capabilities: number;
  maxTransact: number;
  maxRead: number;
  maxWrite: number;
  securityBlob: Uint8Array;
  serverTime: Date;
}

function parseNegotiateBody(body: Uint8Array): NegotiateInfo | null {
  if (body.length < 64) return null;
  const dv = new DataView(body.buffer, body.byteOffset);
  const dialectRevision = dv.getUint16(4, true);
  const serverGuidB = body.slice(8, 24);
  const capabilities = dv.getUint32(24, true);
  const maxTransact = dv.getUint32(28, true);
  const maxRead  = dv.getUint32(32, true);
  const maxWrite = dv.getUint32(36, true);
  // SystemTime at offset 40 (8 bytes FILETIME)
  const ftLo = dv.getUint32(40, true);
  const ftHi = dv.getUint32(44, true);
  const ft = (BigInt(ftHi) * 0x100000000n + BigInt(ftLo));
  const msEpoch = Number((ft - 116444736000000000n) / 10000n);
  const serverTime = new Date(msEpoch);

  const secOff = dv.getUint16(56, true);
  const secLen = dv.getUint16(58, true);
  const securityBlob = (secOff > 0 && secLen > 0 && secOff - 64 + secLen <= body.length)
    ? body.slice(secOff - 64, secOff - 64 + secLen)
    : new Uint8Array(0);

  const dialectNames: Record<number, string> = {
    0x0202: 'SMB 2.0.2', 0x0210: 'SMB 2.1',
    0x0300: 'SMB 3.0',   0x0302: 'SMB 3.0.2', 0x0311: 'SMB 3.1.1',
  };
  const dialect = dialectNames[dialectRevision] ?? `Unknown (0x${dialectRevision.toString(16)})`;
  const serverGuid = Array.from(serverGuidB).map(b => b.toString(16).padStart(2,'0')).join('');

  return { dialect, dialectRevision, serverGuid, capabilities, maxTransact, maxRead, maxWrite, securityBlob, serverTime };
}

function parseSessionSetupBody(body: Uint8Array): { sessionFlags: number; securityBlob: Uint8Array } {
  if (body.length < 8) return { sessionFlags: 0, securityBlob: new Uint8Array(0) };
  const dv = new DataView(body.buffer, body.byteOffset);
  const sessionFlags = dv.getUint16(2, true);
  const secOff = dv.getUint16(4, true);
  const secLen = dv.getUint16(6, true);
  const securityBlob = (secOff > 0 && secLen > 0 && secOff - 64 + secLen <= body.length)
    ? body.slice(secOff - 64, secOff - 64 + secLen)
    : new Uint8Array(0);
  return { sessionFlags, securityBlob };
}

function parseCreateBody(body: Uint8Array): { fileId: Uint8Array; endOfFile: number; fileAttributes: number } | null {
  if (body.length < 88) return null;
  const dv = new DataView(body.buffer, body.byteOffset);
  const endOfFile = dv.getUint32(56, true); // low 32 bits of EndOfFile
  const fileAttributes = dv.getUint32(64, true);
  return { fileId: body.slice(80, 96), endOfFile, fileAttributes };
}

interface DirEntry {
  name: string;
  isDir: boolean;
  size: number;
  created: string;
  modified: string;
  attributes: number;
}

function parseQueryDirectoryBody(body: Uint8Array): DirEntry[] {
  const entries: DirEntry[] = [];
  if (body.length < 8) return entries;
  const dv = new DataView(body.buffer, body.byteOffset);
  // Response: StructureSize(2), OutputBufferOffset(2), OutputBufferLength(4), Buffer[...]
  const bufOff = dv.getUint16(2, true) - 64; // offset from SMB2 header start
  const bufLen = dv.getUint32(4, true);
  if (bufOff < 0 || bufOff + bufLen > body.length) return entries;

  let pos = bufOff;
  while (pos < bufOff + bufLen) {
    const entry = body.slice(pos);
    if (entry.length < 64) break;
    const entDV = new DataView(entry.buffer, entry.byteOffset);
    const nextOffset = entDV.getUint32(0, true);
    const fileAttrs = entDV.getUint32(56, true);
    const eofLo = entDV.getUint32(40, true);
    const nameLen = entDV.getUint32(60, true);

    // Timestamps (FILETIME) at offsets 8, 16, 24, 32
    const readFT = (off: number): string => {
      const lo = entDV.getUint32(off, true);
      const hi = entDV.getUint32(off + 4, true);
      const ft = (BigInt(hi) * 0x100000000n + BigInt(lo));
      const ms = Number((ft - 116444736000000000n) / 10000n);
      return ms > 0 ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : '';
    };

    const created  = readFT(8);
    const modified = readFT(24);
    const name = entry.length >= 64 + nameLen ? fromUtf16le(entry.slice(64, 64 + nameLen)) : '';

    if (name && name !== '.' && name !== '..') {
      entries.push({
        name,
        isDir: !!(fileAttrs & 0x10),
        size: eofLo,
        created,
        modified,
        attributes: fileAttrs,
      });
    }

    if (nextOffset === 0) break;
    pos += nextOffset;
  }
  return entries;
}

// ─── Network I/O helpers ──────────────────────────────────────────────────────

function combineBuffers(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/** Read exactly one NetBIOS-framed SMB2 message. */
async function readSmb2Msg(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  deadline: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let received = 0;
  let needed = 4; // start by reading the 4-byte NetBIOS header

  while (received < needed) {
    if (Date.now() > deadline) throw new Error('SMB2 read timeout');
    const remaining = deadline - Date.now();
    const t = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('SMB2 read timeout')), remaining));
    const { value, done } = await Promise.race([reader.read(), t]);
    if (done || !value) throw new Error('Connection closed unexpectedly');
    chunks.push(value);
    received += value.length;

    if (needed === 4 && received >= 4) {
      const buf = combineBuffers(chunks);
      const msgLen = (buf[1] << 16) | (buf[2] << 8) | buf[3];
      needed = 4 + msgLen;
    }
  }

  return combineBuffers(chunks).slice(0, needed);
}

// NT status name lookup for user-friendly errors
function ntStatusName(status: number): string {
  const names: Record<number, string> = {
    0x00000000: 'SUCCESS',
    0xC0000016: 'STATUS_MORE_PROCESSING_REQUIRED',
    0xC000006D: 'STATUS_LOGON_FAILURE (bad credentials)',
    0xC000006E: 'STATUS_ACCOUNT_RESTRICTION',
    0xC000006F: 'STATUS_INVALID_LOGON_HOURS',
    0xC0000022: 'STATUS_ACCESS_DENIED',
    0xC0000034: 'STATUS_OBJECT_NAME_NOT_FOUND',
    0xC0000035: 'STATUS_OBJECT_NAME_COLLISION',
    0xC000003A: 'STATUS_OBJECT_PATH_NOT_FOUND',
    0xC0000056: 'STATUS_DELETE_PENDING',
    0xC00000BA: 'STATUS_FILE_IS_A_DIRECTORY',
    0xC0000101: 'STATUS_NOT_EMPTY (directory not empty)',
    0x80000006: 'STATUS_NO_MORE_FILES',
    0xC0000185: 'STATUS_IO_DEVICE_ERROR',
  };
  return names[status >>> 0] ?? `0x${(status >>> 0).toString(16).padStart(8,'0')}`;
}

// ─── High-level SMB2 session ──────────────────────────────────────────────────

interface CifsBaseRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface CifsAuthRequest extends CifsBaseRequest {
  username?: string;
  password?: string;
  domain?: string;
}

interface CifsFsRequest extends CifsAuthRequest {
  share: string; // e.g. "share" (will become \\host\share)
  path?: string; // relative path within share
}

function validateHost(host: string): string | null {
  if (!host || !host.trim()) return 'Host is required';
  if (!/^[a-zA-Z0-9._:-]+$/.test(host)) return 'Host contains invalid characters';
  return null;
}

function validatePort(port: number): string | null {
  if (port < 1 || port > 65535) return 'Port must be 1–65535';
  return null;
}

// ─── POST /api/cifs/negotiate  (also aliased as /api/cifs/connect) ─────────────

/**
 * Probe the SMB2 server — dialect negotiation only, no authentication.
 * Returns: dialect, server GUID, capabilities, timestamps.
 */
export async function handleCIFSNegotiate(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    let body: Partial<CifsBaseRequest>;
    if (request.method === 'POST') body = await request.json() as Partial<CifsBaseRequest>;
    else body = {};

    const host = (body.host ?? '').trim();
    const port = body.port ?? 445;
    const timeout = body.timeout ?? 10000;

    const hostErr = validateHost(host);
    if (hostErr) return new Response(JSON.stringify({ success: false, error: hostErr }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    const portErr = validatePort(port);
    if (portErr) return new Response(JSON.stringify({ success: false, error: portErr }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const deadline = Date.now() + timeout;
    const socket = connect(`${host}:${port}`);
    const timeoutP = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Connection timeout')), timeout));

    try {
      const start = Date.now();
      await Promise.race([socket.opened, timeoutP]);
      const tcpLatency = Date.now() - start;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      await writer.write(buildNegotiate(0));
      const raw = await readSmb2Msg(reader, deadline);
      writer.releaseLock(); reader.releaseLock();
      socket.close();

      const resp = parseSmb2Response(raw);
      if (!resp || resp.status !== STATUS_SUCCESS) {
        return new Response(JSON.stringify({
          success: false,
          error: resp ? `NEGOTIATE failed: ${ntStatusName(resp.status)}` : 'Invalid SMB2 response',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      const info = parseNegotiateBody(resp.body);
      if (!info) return new Response(JSON.stringify({ success: false, error: 'Could not parse NEGOTIATE response' }), { status: 200, headers: { 'Content-Type': 'application/json' } });

      const capNames: string[] = [];
      if (info.capabilities & 0x01) capNames.push('DFS');
      if (info.capabilities & 0x02) capNames.push('LEASING');
      if (info.capabilities & 0x04) capNames.push('LARGE_MTU');
      if (info.capabilities & 0x08) capNames.push('MULTI_CHANNEL');
      if (info.capabilities & 0x10) capNames.push('PERSISTENT_HANDLES');
      if (info.capabilities & 0x20) capNames.push('DIR_LEASING');
      if (info.capabilities & 0x40) capNames.push('ENCRYPTION');

      return new Response(JSON.stringify({
        success: true,
        host, port, tcpLatency,
        dialect: info.dialect,
        serverGuid: info.serverGuid,
        capabilities: capNames,
        maxTransactSize: info.maxTransact,
        maxReadSize: info.maxRead,
        maxWriteSize: info.maxWrite,
        serverTime: info.serverTime.toISOString(),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
      try { socket.close(); } catch { /* ignore */ }
      throw err;
    }
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// Alias kept for backward compatibility
export { handleCIFSNegotiate as handleCIFSConnect };

// ─── POST /api/cifs/auth ──────────────────────────────────────────────────────

/**
 * Test credentials via full SMB2 + NTLMv2 session setup.
 * Returns: success/failure, session info, server info.
 */
export async function handleCIFSAuth(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as CifsAuthRequest;
    const host = (body.host ?? '').trim();
    const port = body.port ?? 445;
    const timeout = body.timeout ?? 15000;
    const username  = body.username  ?? '';
    const password  = body.password  ?? '';
    const domain    = body.domain    ?? '';

    const hostErr = validateHost(host);
    if (hostErr) return new Response(JSON.stringify({ success: false, error: hostErr }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    const portErr = validatePort(port);
    if (portErr) return new Response(JSON.stringify({ success: false, error: portErr }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const deadline = Date.now() + timeout;
    const socket = connect(`${host}:${port}`);
    const timeoutP = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Connection timeout')), timeout));

    try {
      await Promise.race([socket.opened, timeoutP]);
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();
      let msgId = 0;

      // 1. NEGOTIATE
      await writer.write(buildNegotiate(msgId++));
      const negRaw = await readSmb2Msg(reader, deadline);
      const negResp = parseSmb2Response(negRaw);
      if (!negResp || negResp.status !== STATUS_SUCCESS) throw new Error('NEGOTIATE failed');
      const negInfo = parseNegotiateBody(negResp.body);
      if (!negInfo) throw new Error('Could not parse NEGOTIATE response');

      // 2. SESSION_SETUP round 1 — NTLM Type 1
      const ntlmNeg = buildNtlmNegotiate(domain, 'PORTOFCALL');
      const spnego1 = spnegoWrapNegotiate(ntlmNeg);
      await writer.write(buildSessionSetup(spnego1, msgId++));
      const ss1Raw = await readSmb2Msg(reader, deadline);
      const ss1Resp = parseSmb2Response(ss1Raw);
      if (!ss1Resp || ss1Resp.status !== STATUS_MORE_PROCESSING) {
        throw new Error(`SESSION_SETUP step 1 failed: ${ntStatusName(ss1Resp?.status ?? 0)}`);
      }
      const { securityBlob: secBlob1 } = parseSessionSetupBody(ss1Resp.body);

      // 3. Parse NTLM Type 2 (challenge)
      const challenge = parseNtlmChallenge(secBlob1);
      if (!challenge) throw new Error('Could not parse NTLM challenge');

      // 4. SESSION_SETUP round 2 — NTLM Type 3
      const ntlmAuth = buildNtlmAuthenticate(username, password, domain || challenge.targetName, 'PORTOFCALL', challenge);
      const spnego2 = spnegoWrapAuthenticate(ntlmAuth);
      await writer.write(buildSessionSetup(spnego2, msgId++, ss1Resp.sessionId as Uint8Array<ArrayBuffer>));
      const ss2Raw = await readSmb2Msg(reader, deadline);
      const ss2Resp = parseSmb2Response(ss2Raw);

      // 5. LOGOFF (cleanup)
      try {
        await writer.write(buildLogoff(msgId++, ss2Resp?.sessionId ?? ss1Resp.sessionId));
        await readSmb2Msg(reader, Math.min(deadline, Date.now() + 2000));
      } catch { /* ignore */ }

      writer.releaseLock(); reader.releaseLock();
      socket.close();

      if (!ss2Resp || ss2Resp.status !== STATUS_SUCCESS) {
        return new Response(JSON.stringify({
          success: false,
          error: `Authentication failed: ${ntStatusName(ss2Resp?.status ?? 0)}`,
          dialect: negInfo.dialect,
          serverGuid: negInfo.serverGuid,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      const { sessionFlags } = parseSessionSetupBody(ss2Resp.body);
      const sessionIdHex = Array.from(ss2Resp.sessionId).map(b => b.toString(16).padStart(2,'0')).join('');

      return new Response(JSON.stringify({
        success: true,
        host, port,
        dialect: negInfo.dialect,
        serverGuid: negInfo.serverGuid,
        serverTime: negInfo.serverTime.toISOString(),
        targetDomain: challenge.targetName,
        sessionId: sessionIdHex,
        sessionFlags: sessionFlags === 1 ? 'GUEST' : sessionFlags === 2 ? 'ENCRYPT' : 'NORMAL',
        maxReadSize: negInfo.maxRead,
        maxWriteSize: negInfo.maxWrite,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
      try { socket.close(); } catch { /* ignore */ }
      throw err;
    }
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ─── Shared session-aware SMB2 call sequence ──────────────────────────────────

/** Open a full SMB2 session (negotiate → session setup → tree connect) and invoke work(). */
async function withSmbShare<T>(
  host: string, port: number, timeout: number,
  username: string, password: string, domain: string,
  share: string,
  work: (
    writer: WritableStreamDefaultWriter<Uint8Array>,
    reader: ReadableStreamDefaultReader<Uint8Array>,
    sessionId: Uint8Array,
    treeId: number,
    getMsgId: () => number,
    deadline: number,
  ) => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + timeout;
  const socket = connect(`${host}:${port}`);
  const timeoutP = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Connection timeout')), timeout));

  try {
    await Promise.race([socket.opened, timeoutP]);
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    let _msgId = 0;
    const getMsgId = () => _msgId++;

    // NEGOTIATE
    await writer.write(buildNegotiate(getMsgId()));
    const negRaw = await readSmb2Msg(reader, deadline);
    const negResp = parseSmb2Response(negRaw);
    if (!negResp || negResp.status !== STATUS_SUCCESS) throw new Error(`NEGOTIATE failed: ${ntStatusName(negResp?.status ?? 0)}`);

    // SESSION SETUP round 1
    const ntlmNeg = buildNtlmNegotiate(domain, 'PORTOFCALL');
    await writer.write(buildSessionSetup(spnegoWrapNegotiate(ntlmNeg), getMsgId()));
    const ss1Raw = await readSmb2Msg(reader, deadline);
    const ss1Resp = parseSmb2Response(ss1Raw);
    if (!ss1Resp || ss1Resp.status !== STATUS_MORE_PROCESSING) throw new Error(`SESSION_SETUP step 1 failed: ${ntStatusName(ss1Resp?.status ?? 0)}`);

    const challenge = parseNtlmChallenge(parseSessionSetupBody(ss1Resp.body).securityBlob);
    if (!challenge) throw new Error('Could not parse NTLM challenge');

    // SESSION SETUP round 2
    const ntlmAuth = buildNtlmAuthenticate(username, password, domain || challenge.targetName, 'PORTOFCALL', challenge);
    await writer.write(buildSessionSetup(spnegoWrapAuthenticate(ntlmAuth), getMsgId(), ss1Resp.sessionId as Uint8Array<ArrayBuffer>));
    const ss2Raw = await readSmb2Msg(reader, deadline);
    const ss2Resp = parseSmb2Response(ss2Raw);
    if (!ss2Resp || ss2Resp.status !== STATUS_SUCCESS) throw new Error(`Authentication failed: ${ntStatusName(ss2Resp?.status ?? 0)}`);

    const sessionId = ss2Resp.sessionId;

    // TREE CONNECT
    const sharePath = `\\\\${host}\\${share}`;
    await writer.write(buildTreeConnect(sharePath, getMsgId(), sessionId));
    const tcRaw = await readSmb2Msg(reader, deadline);
    const tcResp = parseSmb2Response(tcRaw);
    if (!tcResp || tcResp.status !== STATUS_SUCCESS) throw new Error(`TREE_CONNECT to ${sharePath} failed: ${ntStatusName(tcResp?.status ?? 0)}`);
    const treeId = tcResp.treeId;

    try {
      const result = await work(writer, reader, sessionId, treeId, getMsgId, deadline);

      // TREE_DISCONNECT + LOGOFF
      try {
        await writer.write(buildTreeDisconnect(getMsgId(), sessionId, treeId));
        await readSmb2Msg(reader, Math.min(deadline, Date.now() + 2000));
        await writer.write(buildLogoff(getMsgId(), sessionId));
        await readSmb2Msg(reader, Math.min(deadline, Date.now() + 2000));
      } catch { /* ignore */ }

      writer.releaseLock(); reader.releaseLock();
      socket.close();
      return result;

    } catch (err) {
      try {
        await writer.write(buildTreeDisconnect(getMsgId(), sessionId, treeId));
        await writer.write(buildLogoff(getMsgId(), sessionId));
      } catch { /* ignore */ }
      writer.releaseLock(); reader.releaseLock();
      socket.close();
      throw err;
    }
  } catch (err) {
    try { socket.close(); } catch { /* ignore */ }
    throw err;
  }
}

// ─── POST /api/cifs/ls ────────────────────────────────────────────────────────

/**
 * List directory contents in an SMB2 share.
 * Body: { host, port?, username?, password?, domain?, share, path? }
 */
export async function handleCIFSList(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as CifsFsRequest;
    const host     = (body.host  ?? '').trim();
    const port     = body.port   ?? 445;
    const timeout  = body.timeout ?? 20000;
    const username = body.username ?? '';
    const password = body.password ?? '';
    const domain   = body.domain   ?? '';
    const share    = (body.share ?? '').trim();
    const path     = (body.path  ?? '').replace(/\//g, '\\').replace(/^\\+/, '');

    const hostErr = validateHost(host);
    if (hostErr) return new Response(JSON.stringify({ success: false, error: hostErr }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    const portErr = validatePort(port);
    if (portErr) return new Response(JSON.stringify({ success: false, error: portErr }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (!share) return new Response(JSON.stringify({ success: false, error: 'Share name is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const entries = await withSmbShare(host, port, timeout, username, password, domain, share,
      async (writer, reader, sessionId, treeId, getMsgId, deadline) => {
        // CREATE (open directory)
        await writer.write(buildCreate(path, getMsgId(), sessionId, treeId, true));
        const crRaw = await readSmb2Msg(reader, deadline);
        const crResp = parseSmb2Response(crRaw);
        if (!crResp || crResp.status !== STATUS_SUCCESS) throw new Error(`CREATE failed: ${ntStatusName(crResp?.status ?? 0)}`);
        const crInfo = parseCreateBody(crResp.body);
        if (!crInfo) throw new Error('Could not parse CREATE response');

        // QUERY_DIRECTORY
        await writer.write(buildQueryDirectory(crInfo.fileId, '*', getMsgId(), sessionId, treeId));
        const qdRaw = await readSmb2Msg(reader, deadline);
        const qdResp = parseSmb2Response(qdRaw);

        let allEntries: DirEntry[] = [];
        if (qdResp && (qdResp.status === STATUS_SUCCESS || qdResp.status === STATUS_NO_MORE_FILES)) {
          if (qdResp.status === STATUS_SUCCESS) {
            allEntries = parseQueryDirectoryBody(qdResp.body);
          }
        }

        // CLOSE
        await writer.write(buildClose(crInfo.fileId, getMsgId(), sessionId, treeId));
        await readSmb2Msg(reader, Math.min(deadline, Date.now() + 2000));

        return allEntries;
      });

    return new Response(JSON.stringify({
      success: true,
      host, share,
      path: path || '\\',
      entryCount: entries.length,
      entries,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ─── POST /api/cifs/read ──────────────────────────────────────────────────────

/**
 * Read a file from an SMB2 share (first 64 KB).
 * Body: { host, port?, username?, password?, domain?, share, path }
 */
export async function handleCIFSRead(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as CifsFsRequest;
    const host     = (body.host  ?? '').trim();
    const port     = body.port   ?? 445;
    const timeout  = body.timeout ?? 20000;
    const username = body.username ?? '';
    const password = body.password ?? '';
    const domain   = body.domain   ?? '';
    const share    = (body.share ?? '').trim();
    const filePath = (body.path  ?? '').replace(/\//g, '\\').replace(/^\\+/, '');

    const hostErr = validateHost(host);
    if (hostErr) return new Response(JSON.stringify({ success: false, error: hostErr }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    const portErr = validatePort(port);
    if (portErr) return new Response(JSON.stringify({ success: false, error: portErr }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (!share)    return new Response(JSON.stringify({ success: false, error: 'Share name is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (!filePath) return new Response(JSON.stringify({ success: false, error: 'File path is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const MAX_READ = 65536;

    const result = await withSmbShare(host, port, timeout, username, password, domain, share,
      async (writer, reader, sessionId, treeId, getMsgId, deadline) => {
        // CREATE (open file for reading)
        await writer.write(buildCreate(filePath, getMsgId(), sessionId, treeId, false));
        const crRaw = await readSmb2Msg(reader, deadline);
        const crResp = parseSmb2Response(crRaw);
        if (!crResp || crResp.status !== STATUS_SUCCESS) throw new Error(`CREATE failed: ${ntStatusName(crResp?.status ?? 0)}`);
        const crInfo = parseCreateBody(crResp.body);
        if (!crInfo) throw new Error('Could not parse CREATE response');

        const fileSize = crInfo.endOfFile;
        const readLen  = Math.min(fileSize, MAX_READ);

        let content = new Uint8Array(0);
        if (readLen > 0) {
          // READ
          await writer.write(buildRead(crInfo.fileId, 0, readLen, getMsgId(), sessionId, treeId));
          const rdRaw = await readSmb2Msg(reader, deadline);
          const rdResp = parseSmb2Response(rdRaw);
          if (rdResp && rdResp.status === STATUS_SUCCESS && rdResp.body.length >= 16) {
            const dv = new DataView(rdResp.body.buffer, rdResp.body.byteOffset);
            const dataOff = dv.getUint16(2, true) - 64;
            const dataLen = dv.getUint32(4, true);
            if (dataOff >= 0 && dataOff + dataLen <= rdResp.body.length) {
              content = rdResp.body.slice(dataOff, dataOff + dataLen);
            }
          }
        }

        // CLOSE
        await writer.write(buildClose(crInfo.fileId, getMsgId(), sessionId, treeId));
        await readSmb2Msg(reader, Math.min(deadline, Date.now() + 2000));

        // Decode content: try UTF-8 text, fall back to base64
        let textContent: string | undefined;
        let isBinary = false;
        try {
          textContent = new TextDecoder('utf-8', { fatal: true }).decode(content);
        } catch {
          isBinary = true;
        }

        return {
          fileSize,
          bytesRead: content.length,
          truncated: fileSize > MAX_READ,
          isBinary,
          content: isBinary
            ? btoa(String.fromCharCode(...Array.from(content.slice(0, 1024))))
            : textContent ?? '',
          fileAttributes: crInfo.fileAttributes,
        };
      });

    return new Response(JSON.stringify({
      success: true,
      host, share, path: filePath,
      ...result,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ─── POST /api/cifs/stat ──────────────────────────────────────────────────────

/**
 * Get metadata for a file or directory in an SMB2 share.
 * Body: { host, port?, username?, password?, domain?, share, path? }
 */
export async function handleCIFSStat(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as CifsFsRequest;
    const host     = (body.host  ?? '').trim();
    const port     = body.port   ?? 445;
    const timeout  = body.timeout ?? 15000;
    const username = body.username ?? '';
    const password = body.password ?? '';
    const domain   = body.domain   ?? '';
    const share    = (body.share ?? '').trim();
    const path     = (body.path  ?? '').replace(/\//g, '\\').replace(/^\\+/, '');

    const hostErr = validateHost(host);
    if (hostErr) return new Response(JSON.stringify({ success: false, error: hostErr }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    const portErr = validatePort(port);
    if (portErr) return new Response(JSON.stringify({ success: false, error: portErr }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (!share) return new Response(JSON.stringify({ success: false, error: 'Share name is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const info = await withSmbShare(host, port, timeout, username, password, domain, share,
      async (writer, reader, sessionId, treeId, getMsgId, deadline) => {
        // Try as file first, then directory
        for (const isDir of [false, true]) {
          await writer.write(buildCreate(path, getMsgId(), sessionId, treeId, isDir));
          const crRaw = await readSmb2Msg(reader, deadline);
          const crResp = parseSmb2Response(crRaw);
          if (!crResp || crResp.status !== STATUS_SUCCESS) {
            if (isDir) throw new Error(`Could not open path: ${ntStatusName(crResp?.status ?? 0)}`);
            continue;
          }
          const crInfo = parseCreateBody(crResp.body);
          if (!crInfo) continue;

          // CLOSE
          await writer.write(buildClose(crInfo.fileId, getMsgId(), sessionId, treeId));
          await readSmb2Msg(reader, Math.min(deadline, Date.now() + 2000));

          const attrs: string[] = [];
          if (crInfo.fileAttributes & 0x01) attrs.push('READ_ONLY');
          if (crInfo.fileAttributes & 0x02) attrs.push('HIDDEN');
          if (crInfo.fileAttributes & 0x04) attrs.push('SYSTEM');
          if (crInfo.fileAttributes & 0x10) attrs.push('DIRECTORY');
          if (crInfo.fileAttributes & 0x20) attrs.push('ARCHIVE');

          return {
            path: path || '\\',
            isDirectory: !!(crInfo.fileAttributes & 0x10),
            size: crInfo.endOfFile,
            attributes: attrs,
            rawAttributes: crInfo.fileAttributes,
          };
        }
        throw new Error('Could not stat path');
      });

    return new Response(JSON.stringify({
      success: true, host, share, ...info,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ─── POST /api/cifs/write ─────────────────────────────────────────────────────

interface CifsWriteRequest extends CifsFsRequest {
  content?: string;    // UTF-8 text content
  base64?: string;     // base64-encoded binary content (overrides content)
}

/**
 * Write a file to an SMB2 share.
 * Body: { host, port?, username?, password?, domain?, share, path, content?, base64? }
 * Use `content` for text, `base64` for binary.
 */
export async function handleCIFSWrite(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as CifsWriteRequest;
    const host     = (body.host  ?? '').trim();
    const port     = body.port   ?? 445;
    const timeout  = body.timeout ?? 20000;
    const username = body.username ?? '';
    const password = body.password ?? '';
    const domain   = body.domain   ?? '';
    const share    = (body.share ?? '').trim();
    const filePath = (body.path  ?? '').replace(/\//g, '\\').replace(/^\\+/, '');

    const hostErr = validateHost(host);
    if (hostErr) return new Response(JSON.stringify({ success: false, error: hostErr }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    const portErr = validatePort(port);
    if (portErr) return new Response(JSON.stringify({ success: false, error: portErr }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (!share)    return new Response(JSON.stringify({ success: false, error: 'Share name is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (!filePath) return new Response(JSON.stringify({ success: false, error: 'File path is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    let data: Uint8Array;
    if (body.base64) {
      const bin = atob(body.base64);
      data = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    } else {
      data = new TextEncoder().encode(body.content ?? '');
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const result = await withSmbShare(host, port, timeout, username, password, domain, share,
      async (writer, reader, sessionId, treeId, getMsgId, deadline) => {
        // CREATE (open/create file for writing, FILE_OVERWRITE_IF)
        await writer.write(buildCreateForWrite(filePath, getMsgId(), sessionId, treeId));
        const crRaw = await readSmb2Msg(reader, deadline);
        const crResp = parseSmb2Response(crRaw);
        if (!crResp || crResp.status !== STATUS_SUCCESS) throw new Error(`CREATE failed: ${ntStatusName(crResp?.status ?? 0)}`);
        const crInfo = parseCreateBody(crResp.body);
        if (!crInfo) throw new Error('Could not parse CREATE response');

        // WRITE
        await writer.write(buildWrite(crInfo.fileId, data, getMsgId(), sessionId, treeId));
        const wrRaw = await readSmb2Msg(reader, deadline);
        const wrResp = parseSmb2Response(wrRaw);
        if (!wrResp || wrResp.status !== STATUS_SUCCESS) throw new Error(`WRITE failed: ${ntStatusName(wrResp?.status ?? 0)}`);
        const wrDv = new DataView(wrResp.body.buffer, wrResp.body.byteOffset);
        const bytesWritten = wrResp.body.length >= 8 ? wrDv.getUint32(4, true) : data.length;

        // CLOSE
        await writer.write(buildClose(crInfo.fileId, getMsgId(), sessionId, treeId));
        await readSmb2Msg(reader, Math.min(deadline, Date.now() + 2000));

        return { bytesWritten };
      });

    return new Response(JSON.stringify({
      success: true, host, share, path: filePath, ...result,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
