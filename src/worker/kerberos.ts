/**
 * Kerberos Protocol Implementation
 *
 * Implements Kerberos KDC connectivity testing via the Kerberos v5
 * protocol (port 88, RFC 4120). Sends a minimal AS-REQ to probe the
 * KDC and parse the response (typically KRB-ERROR with pre-auth required)
 * to discover supported encryption types, realm info, and server version.
 *
 * Protocol Flow:
 * 1. Client connects to port 88 (TCP)
 * 2. Client sends AS-REQ (4-byte length prefix + ASN.1 DER-encoded)
 * 3. KDC responds with AS-REP or KRB-ERROR
 * 4. Parse response to extract encryption types, realm, error info
 *
 * TCP Framing:
 * - 4-byte big-endian length prefix followed by the Kerberos message
 *
 * Use Cases:
 * - KDC connectivity testing
 * - Encryption type discovery
 * - Realm verification
 * - Active Directory KDC probing
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// Kerberos message types
const KRB_AS_REQ = 10;
const KRB_AS_REP = 11;
const KRB_ERROR = 30;

// Encryption type names
const ETYPE_NAMES: Record<number, string> = {
  1: 'des-cbc-crc',
  2: 'des-cbc-md4',
  3: 'des-cbc-md5',
  16: 'des3-cbc-sha1',
  17: 'aes128-cts-hmac-sha1-96',
  18: 'aes256-cts-hmac-sha1-96',
  23: 'rc4-hmac',
  24: 'rc4-hmac-exp',
};

// Kerberos error code names (RFC 4120 §7.5.9)
const ERROR_NAMES: Record<number, string> = {
  0: 'KDC_ERR_NONE',
  6: 'KDC_ERR_C_PRINCIPAL_UNKNOWN',
  7: 'KDC_ERR_S_PRINCIPAL_UNKNOWN',
  12: 'KDC_ERR_POLICY',
  14: 'KDC_ERR_ETYPE_NOSUPP',
  16: 'KDC_ERR_PADATA_TYPE_NOSUPP',
  18: 'KDC_ERR_PREAUTH_FAILED',
  24: 'KDC_ERR_PREAUTH_REQUIRED',
  25: 'KDC_ERR_SERVER_NOMATCH',
  31: 'KDC_ERR_KEY_EXPIRED',
  41: 'KDC_ERR_PREAUTH_EXPIRED',
  60: 'KRB_AP_ERR_INAPP_CKSUM',
  68: 'KDC_ERR_CLIENT_REVOKED',
};

// ASN.1 DER encoding helpers

function encodeLength(length: number): Uint8Array {
  if (length < 128) {
    return new Uint8Array([length]);
  } else if (length < 256) {
    return new Uint8Array([0x81, length]);
  } else {
    return new Uint8Array([0x82, (length >> 8) & 0xFF, length & 0xFF]);
  }
}

function encodeTLV(tag: number, value: Uint8Array): Uint8Array {
  const len = encodeLength(value.length);
  const result = new Uint8Array(1 + len.length + value.length);
  result[0] = tag;
  result.set(len, 1);
  result.set(value, 1 + len.length);
  return result;
}

function encodeInteger(value: number): Uint8Array {
  const bytes: number[] = [];
  if (value === 0) {
    bytes.push(0);
  } else {
    let v = value;
    while (v > 0) {
      bytes.unshift(v & 0xFF);
      v >>= 8;
    }
    // Add leading zero if high bit set (to keep positive)
    if (bytes[0] & 0x80) {
      bytes.unshift(0);
    }
  }
  return encodeTLV(0x02, new Uint8Array(bytes));
}

function encodeString(str: string, tag: number = 0x1B): Uint8Array {
  const bytes = new TextEncoder().encode(str);
  return encodeTLV(tag, bytes);
}

function encodeSequence(items: Uint8Array[]): Uint8Array {
  const totalLen = items.reduce((s, i) => s + i.length, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const item of items) {
    combined.set(item, offset);
    offset += item.length;
  }
  return encodeTLV(0x30, combined);
}

function encodeContextTag(tagNum: number, value: Uint8Array): Uint8Array {
  return encodeTLV(0xA0 | tagNum, value);
}

function encodeApplicationTag(tagNum: number, value: Uint8Array): Uint8Array {
  // Application constructed tag
  const tag = 0x60 | tagNum;
  if (tagNum > 30) {
    // Long form tag
    const len = encodeLength(value.length);
    const result = new Uint8Array(2 + len.length + value.length);
    result[0] = 0x7F; // Application constructed, long form
    result[1] = tagNum;
    result.set(len, 2);
    result.set(value, 2 + len.length);
    return result;
  }
  return encodeTLV(tag, value);
}

function encodeBitString(value: Uint8Array): Uint8Array {
  // Bit string with 0 unused bits
  const data = new Uint8Array(1 + value.length);
  data[0] = 0; // unused bits
  data.set(value, 1);
  return encodeTLV(0x03, data);
}

function encodeGeneralizedTime(date: Date): Uint8Array {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return encodeString(`${y}${m}${d}${h}${min}${s}Z`, 0x18);
}

/**
 * Build a minimal Kerberos AS-REQ message
 * This sends a request without pre-authentication, which will typically
 * result in a KRB-ERROR (PREAUTH_REQUIRED) that reveals server info.
 */
function buildASReq(realm: string, cname: string): Uint8Array {
  // KDC-Options (forwardable, renewable, canonicalize)
  const kdcOptions = new Uint8Array([0x40, 0x81, 0x00, 0x10]);

  // Client principal name (NT-PRINCIPAL = 1)
  const cnameType = encodeContextTag(0, encodeInteger(1));
  const cnameString = encodeContextTag(1, encodeSequence([
    encodeString(cname, 0x1B),
  ]));
  const principalName = encodeSequence([cnameType, cnameString]);

  // Service name: krbtgt/REALM (NT-SRV-INST = 2)
  const snameType = encodeContextTag(0, encodeInteger(2));
  const snameStrings = encodeContextTag(1, encodeSequence([
    encodeString('krbtgt', 0x1B),
    encodeString(realm, 0x1B),
  ]));
  const sname = encodeSequence([snameType, snameStrings]);

  // Till time (far future)
  const till = new Date('2037-09-13T02:48:05Z');

  // Random nonce
  const nonce = Math.floor(Math.random() * 0x7FFFFFFF);

  // Supported encryption types
  const etypes = encodeSequence([
    encodeInteger(18), // aes256-cts-hmac-sha1-96
    encodeInteger(17), // aes128-cts-hmac-sha1-96
    encodeInteger(23), // rc4-hmac
    encodeInteger(3),  // des-cbc-md5
  ]);

  // Build KDC-REQ-BODY
  const reqBody = encodeSequence([
    encodeContextTag(0, encodeBitString(kdcOptions)),
    encodeContextTag(1, principalName),
    encodeContextTag(2, encodeString(realm, 0x1B)),
    encodeContextTag(3, sname),
    encodeContextTag(5, encodeGeneralizedTime(till)),
    encodeContextTag(7, encodeInteger(nonce)),
    encodeContextTag(8, etypes),
  ]);

  // Build KDC-REQ
  const kdcReq = encodeSequence([
    encodeContextTag(1, encodeInteger(5)),              // pvno = 5
    encodeContextTag(2, encodeInteger(KRB_AS_REQ)),     // msg-type = 10
    encodeContextTag(4, reqBody),                        // req-body
  ]);

  // Wrap in APPLICATION 10 tag
  return encodeApplicationTag(KRB_AS_REQ, kdcReq);
}

// ASN.1 DER decoding helpers

interface ASN1Element {
  tag: number;
  constructed: boolean;
  tagClass: number;
  length: number;
  value: Uint8Array;
  headerLength: number;
}

function decodeASN1(data: Uint8Array, offset: number): ASN1Element | null {
  if (offset >= data.length) return null;

  const firstByte = data[offset];
  const tagClass = (firstByte >> 6) & 0x03;
  const constructed = !!(firstByte & 0x20);
  let tag = firstByte & 0x1F;
  let pos = offset + 1;

  // Long form tag
  if (tag === 0x1F) {
    tag = 0;
    while (pos < data.length) {
      const b = data[pos++];
      tag = (tag << 7) | (b & 0x7F);
      if (!(b & 0x80)) break;
    }
  }

  if (pos >= data.length) return null;

  // Length
  let length = data[pos++];
  if (length === 0x80) {
    // BER indefinite length — scan for end-of-contents marker (0x00 0x00)
    // Not used in valid DER-encoded Kerberos messages; treat as a parse error.
    throw new Error('BER indefinite length encoding not supported in Kerberos response');
  }
  if (length & 0x80) {
    const numBytes = length & 0x7F;
    length = 0;
    for (let i = 0; i < numBytes && pos < data.length; i++) {
      length = (length << 8) | data[pos++];
    }
  }

  const headerLength = pos - offset;
  const value = data.slice(pos, pos + length);

  return { tag, constructed, tagClass, length, value, headerLength };
}

function decodeASN1Integer(data: Uint8Array): number {
  let value = 0;
  const negative = data.length > 0 && (data[0] & 0x80);
  for (const b of data) {
    value = (value << 8) | b;
  }
  if (negative) {
    value = value - (1 << (data.length * 8));
  }
  return value;
}

function decodeASN1String(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

/**
 * Parse a Kerberos response (AS-REP or KRB-ERROR)
 */
function parseKerberosResponse(data: Uint8Array): {
  msgType: number;
  msgTypeName: string;
  // Common fields
  pvno?: number;
  realm?: string;
  // AS-REP fields
  cname?: string;
  ticket?: { realm?: string; sname?: string };
  // KRB-ERROR fields
  errorCode?: number;
  errorName?: string;
  etext?: string;
  stime?: string;
  crealm?: string;
  cname2?: string;
  // Pre-auth data (from KRB-ERROR)
  supportedEtypes?: number[];
  etypeNames?: string[];
} {
  const result: ReturnType<typeof parseKerberosResponse> = {
    msgType: 0,
    msgTypeName: 'UNKNOWN',
  };

  // Parse outermost APPLICATION tag
  const outer = decodeASN1(data, 0);
  if (!outer) return result;

  // Determine message type from APPLICATION tag
  const fullTag = data[0];
  if ((fullTag & 0x40) && (fullTag & 0x20)) {
    // Application constructed
    result.msgType = fullTag & 0x1F;
  } else if (data[0] === 0x7F && data.length > 1) {
    result.msgType = data[1];
  }

  if (result.msgType === KRB_AS_REP) {
    result.msgTypeName = 'AS-REP';
  } else if (result.msgType === KRB_ERROR) {
    result.msgTypeName = 'KRB-ERROR';
  } else if (result.msgType === KRB_AS_REQ) {
    result.msgTypeName = 'AS-REQ';
  }

  // Parse inner SEQUENCE
  const innerSeq = decodeASN1(outer.value, 0);
  if (!innerSeq || !innerSeq.constructed) return result;

  // Iterate context-tagged fields
  let pos = 0;
  while (pos < innerSeq.value.length) {
    const field = decodeASN1(innerSeq.value, pos);
    if (!field) break;
    pos += field.headerLength + field.length;

    const contextTag = field.tag;

    if (result.msgType === KRB_ERROR) {
      // KRB-ERROR fields
      const inner = decodeASN1(field.value, 0);
      if (!inner) continue;

      switch (contextTag) {
        case 0: // pvno
          result.pvno = decodeASN1Integer(inner.value);
          break;
        case 1: // msg-type (already have it)
          break;
        case 4: // stime
          result.stime = decodeASN1String(inner.value);
          break;
        case 6: // error-code
          result.errorCode = decodeASN1Integer(inner.value);
          result.errorName = ERROR_NAMES[result.errorCode] || `UNKNOWN(${result.errorCode})`;
          break;
        case 7: // crealm
          result.crealm = decodeASN1String(inner.value);
          break;
        case 9: // realm
          result.realm = decodeASN1String(inner.value);
          break;
        case 12: // e-text
          result.etext = decodeASN1String(inner.value);
          break;
        case 11: // e-data (contains PA-DATA with supported etypes)
          parseEData(inner.value, result);
          break;
      }
    } else if (result.msgType === KRB_AS_REP) {
      const inner = decodeASN1(field.value, 0);
      if (!inner) continue;

      switch (contextTag) {
        case 0: // pvno
          result.pvno = decodeASN1Integer(inner.value);
          break;
        case 3: // crealm
          result.realm = decodeASN1String(inner.value);
          break;
      }
    }
  }

  return result;
}

/**
 * Parse e-data from KRB-ERROR to extract supported encryption types
 */
function parseEData(data: Uint8Array, result: ReturnType<typeof parseKerberosResponse>): void {
  // e-data contains a SEQUENCE of PA-DATA
  // PA-DATA for ETYPE-INFO2 (19) contains supported etypes
  try {
    const seq = decodeASN1(data, 0);
    if (!seq) return;

    let pos = 0;
    const etypes: number[] = [];

    while (pos < seq.value.length) {
      const paData = decodeASN1(seq.value, pos);
      if (!paData) break;
      pos += paData.headerLength + paData.length;

      // Parse PA-DATA sequence
      let innerPos = 0;
      let paType = 0;
      let paValue: Uint8Array | null = null;

      while (innerPos < paData.value.length) {
        const field = decodeASN1(paData.value, innerPos);
        if (!field) break;
        innerPos += field.headerLength + field.length;

        const inner = decodeASN1(field.value, 0);
        if (!inner) continue;

        if (field.tag === 1) { // padata-type
          paType = decodeASN1Integer(inner.value);
        } else if (field.tag === 2) { // padata-value
          paValue = inner.value;
        }
      }

      // PA-ETYPE-INFO2 (type 19)
      if (paType === 19 && paValue) {
        const etypeSeq = decodeASN1(paValue, 0);
        if (etypeSeq) {
          let ePos = 0;
          while (ePos < etypeSeq.value.length) {
            const entry = decodeASN1(etypeSeq.value, ePos);
            if (!entry) break;
            ePos += entry.headerLength + entry.length;

            // First field in each entry is the etype
            const etypeField = decodeASN1(entry.value, 0);
            if (etypeField) {
              const etypeInner = decodeASN1(etypeField.value, 0);
              if (etypeInner) {
                etypes.push(decodeASN1Integer(etypeInner.value));
              }
            }
          }
        }
      }
    }

    if (etypes.length > 0) {
      result.supportedEtypes = etypes;
      result.etypeNames = etypes.map(e => ETYPE_NAMES[e] || `unknown(${e})`);
    }
  } catch {
    // e-data parsing is best-effort
  }
}

// ─── TGS-REQ builder ─────────────────────────────────────────────────────────

const KRB_TGS_REQ = 12;

/**
 * Build a minimal TGS-REQ without PA-TGS-REQ (no TGT).
 *
 * The KDC will reject this but the specific error code reveals SPN existence:
 *   KDC_ERR_S_PRINCIPAL_UNKNOWN (7) → SPN not in the database
 *   Any other error                  → SPN exists (auth/policy issue)
 */
function buildTGSReqNoAuth(realm: string, sname: string): Uint8Array {
  // sname: "service/host" → NT-SRV-HST(3) with two parts; bare "service" → NT-PRINCIPAL(1)
  const snameParts = sname.split('/');
  const snameType  = encodeContextTag(0, encodeInteger(snameParts.length > 1 ? 3 : 1));
  const snameStr   = encodeContextTag(1, encodeSequence(snameParts.map(p => encodeString(p, 0x1B))));

  const nonce    = Math.floor(Math.random() * 0x7FFFFFFF);
  const till     = new Date('2037-09-13T02:48:05Z');

  const reqBody = encodeSequence([
    encodeContextTag(0, encodeBitString(new Uint8Array([0x40, 0x81, 0x00, 0x10]))),
    encodeContextTag(2, encodeString(realm.toUpperCase(), 0x1B)),
    encodeContextTag(3, encodeSequence([snameType, snameStr])),
    encodeContextTag(5, encodeGeneralizedTime(till)),
    encodeContextTag(7, encodeInteger(nonce)),
    encodeContextTag(8, encodeSequence([
      encodeInteger(18), encodeInteger(17), encodeInteger(23),
    ])),
  ]);

  const kdcReq = encodeSequence([
    encodeContextTag(1, encodeInteger(5)),
    encodeContextTag(2, encodeInteger(KRB_TGS_REQ)),
    // No [3] padata — deliberately omitted to probe SPN existence
    encodeContextTag(4, reqBody),
  ]);

  return encodeApplicationTag(KRB_TGS_REQ, kdcReq);
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function sendKerberosRequest(
  host: string,
  port: number,
  msg: Uint8Array,
  timeoutMs: number,
): Promise<Uint8Array | null> {
  const framed = new Uint8Array(4 + msg.length);
  new DataView(framed.buffer).setUint32(0, msg.length, false);
  framed.set(msg, 4);

  const socket = connect(`${host}:${port}`);
  await socket.opened;
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  await writer.write(framed);

  let responseData: Uint8Array | null = null;
  try {
    const timer = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs));
    const result = await Promise.race([reader.read(), timer]);
    if (result.value && result.value.length > 4) {
      responseData = result.value.slice(4);
    }
  } catch { /* timeout */ }

  writer.releaseLock();
  reader.releaseLock();
  socket.close();
  return responseData;
}

// ─── POST /api/kerberos/user-enum ─────────────────────────────────────────────

/**
 * Check one or more usernames against a KDC to determine if they exist
 * and whether pre-authentication is required.
 *
 * Classification:
 *   AS-REP (11)                   → exists, DONT_REQ_PREAUTH set (ASREProastable)
 *   PREAUTH_REQUIRED (24)         → exists, pre-auth required (normal)
 *   SERVER_NOMATCH (25)           → exists, pre-auth required (server mismatch)
 *   PREAUTH_FAILED (18)           → exists, pre-auth failed
 *   CLIENT_REVOKED (68)           → exists, account disabled/revoked
 *   C_PRINCIPAL_UNKNOWN (6)       → user does NOT exist
 *   KEY_EXPIRED (31)              → exists, password expired
 *
 * Request body: { host, port=88, realm, usernames: string[], timeout=10000 }
 */
export async function handleKerberosUserEnum(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      realm: string;
      usernames: string[];
      timeout?: number;
    };

    const { host, port = 88, realm, timeout = 10000 } = body;
    const usernames = body.usernames ?? [];

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!realm) {
      return new Response(JSON.stringify({ success: false, error: 'Realm is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!Array.isArray(usernames) || usernames.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Provide usernames array' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const perUserTimeout = Math.min(Math.floor(timeout / usernames.length) + 500, 8000);
    const results: Array<{
      username: string;
      exists: boolean | null;
      preauthRequired: boolean | null;
      asrepRoastable: boolean;
      errorCode: number | null;
      errorName: string | null;
      note: string;
    }> = [];

    for (const username of usernames.slice(0, 50)) {
      try {
        const asReq = buildASReq(realm.toUpperCase(), username);
        const responseData = await sendKerberosRequest(host, port, asReq, perUserTimeout);

        if (!responseData) {
          results.push({
            username, exists: null, preauthRequired: null, asrepRoastable: false,
            errorCode: null, errorName: null, note: 'No response (timeout)',
          });
          continue;
        }

        const parsed = parseKerberosResponse(responseData);

        if (parsed.msgType === KRB_AS_REP) {
          results.push({
            username, exists: true, preauthRequired: false, asrepRoastable: true,
            errorCode: null, errorName: null,
            note: 'AS-REP received — account does not require pre-authentication',
          });
        } else if (parsed.msgType === KRB_ERROR) {
          const code = parsed.errorCode ?? -1;
          const name = parsed.errorName ?? `UNKNOWN(${code})`;
          let exists: boolean | null = null;
          let preauthRequired: boolean | null = null;
          let note = name;

          if (code === 24) { // KDC_ERR_PREAUTH_REQUIRED
            exists = true; preauthRequired = true;
            note = 'User exists, pre-authentication required';
          } else if (code === 6) { // KDC_ERR_C_PRINCIPAL_UNKNOWN
            exists = false; preauthRequired = null;
            note = 'User not found in directory';
          } else if (code === 18) { // KDC_ERR_PREAUTH_FAILED
            exists = true; preauthRequired = true;
            note = 'User exists (pre-auth failed without credentials)';
          } else if (code === 68) { // KDC_ERR_CLIENT_REVOKED
            exists = true; preauthRequired = null;
            note = 'Account disabled or revoked';
          } else if (code === 31) { // KDC_ERR_KEY_EXPIRED
            exists = true; preauthRequired = true;
            note = 'User exists, password expired';
          } else if (code === 25) { // KDC_ERR_SERVER_NOMATCH
            exists = null; preauthRequired = null;
            note = 'Server name mismatch — user may exist in a different realm';
          } else {
            exists = true; preauthRequired = null;
            note = `User likely exists (error: ${name})`;
          }

          results.push({
            username, exists, preauthRequired, asrepRoastable: false,
            errorCode: code, errorName: name, note,
          });
        } else {
          results.push({
            username, exists: null, preauthRequired: null, asrepRoastable: false,
            errorCode: null, errorName: null,
            note: `Unexpected message type: ${parsed.msgTypeName}`,
          });
        }
      } catch (err) {
        results.push({
          username, exists: null, preauthRequired: null, asrepRoastable: false,
          errorCode: null, errorName: null,
          note: `Error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      host, port, realm: realm.toUpperCase(),
      checkedCount: results.length,
      results,
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ─── POST /api/kerberos/spn-check ────────────────────────────────────────────

/**
 * Probe whether a Service Principal Name (SPN) exists in the KDC by sending
 * a TGS-REQ without a TGT.  The KDC's error code reveals SPN existence:
 *
 *   KDC_ERR_S_PRINCIPAL_UNKNOWN (7)  → SPN not in the database
 *   KDC_ERR_PADATA_TYPE_NOSUPP (16)  → SPN exists (missing pre-auth padata)
 *   KDC_ERR_POLICY (12)              → SPN exists (policy rejected the request)
 *   Any other error                  → SPN likely exists
 *
 * Request body: { host, port=88, realm, spn='host/server.example.com', timeout=8000 }
 */
export async function handleKerberosSPNCheck(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      realm: string;
      spn: string;
      timeout?: number;
    };

    const { host, port = 88, realm, spn, timeout = 8000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!realm || !spn) {
      return new Response(JSON.stringify({ success: false, error: 'realm and spn are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const startTime = Date.now();
    const tgsReq = buildTGSReqNoAuth(realm, spn);
    const responseData = await sendKerberosRequest(host, port, tgsReq, timeout);
    const latencyMs = Date.now() - startTime;

    if (!responseData) {
      return new Response(JSON.stringify({
        success: false, latencyMs, error: 'No response from KDC',
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    const parsed = parseKerberosResponse(responseData);
    const code = parsed.errorCode ?? -1;

    let spnExists: boolean | null = null;
    let note = '';

    if (parsed.msgType === KRB_ERROR) {
      if (code === 7) { // S_PRINCIPAL_UNKNOWN
        spnExists = false;
        note = 'SPN not found in directory';
      } else if (code === 16) { // PADATA_TYPE_NOSUPP
        spnExists = true;
        note = 'SPN exists (TGS-REQ rejected: missing PA-TGS-REQ)';
      } else if (code === 12 || code === 14) {
        spnExists = true;
        note = `SPN exists (policy/etype error: ${parsed.errorName})`;
      } else {
        spnExists = true;
        note = `SPN likely exists (error: ${parsed.errorName ?? code})`;
      }
    } else if (parsed.msgType === 13) { // TGS-REP
      spnExists = true;
      note = 'TGS-REP received — SPN exists and issued ticket (unexpected without TGT)';
    } else {
      note = `Unexpected message type ${parsed.msgTypeName}`;
    }

    return new Response(JSON.stringify({
      success: true,
      host, port, realm: realm.toUpperCase(), spn,
      latencyMs,
      spnExists,
      note,
      response: {
        msgType: parsed.msgType,
        msgTypeName: parsed.msgTypeName,
        errorCode: parsed.errorCode,
        errorName: parsed.errorName,
        errorText: parsed.etext,
        realm: parsed.realm,
      },
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ─── POST /api/kerberos/connect ───────────────────────────────────────────────

/**
 * Handle Kerberos KDC connection test
 */
export async function handleKerberosConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      realm?: string;
      principal?: string;
      timeout?: number;
    };

    const {
      host,
      port = 88,
      realm = 'EXAMPLE.COM',
      principal = 'user',
      timeout = 10000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535',
      }), {
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

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);
    const connectTime = Date.now() - startTime;

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // Build AS-REQ
    const asReq = buildASReq(realm.toUpperCase(), principal);

    // TCP framing: 4-byte big-endian length prefix
    const framed = new Uint8Array(4 + asReq.length);
    const frameView = new DataView(framed.buffer);
    frameView.setUint32(0, asReq.length);
    framed.set(asReq, 4);

    await writer.write(framed);

    // Read response
    let responseData: Uint8Array | null = null;

    try {
      const readResult = await Promise.race([reader.read(), timeoutPromise]);
      if (readResult.value && readResult.value.length > 4) {
        // Skip 4-byte length prefix
        responseData = readResult.value.slice(4);
      }
    } catch {
      // Read timeout
    }

    const rtt = Date.now() - startTime;

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    if (responseData) {
      const parsed = parseKerberosResponse(responseData);

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        rtt,
        connectTime,
        response: {
          msgType: parsed.msgType,
          msgTypeName: parsed.msgTypeName,
          pvno: parsed.pvno,
          realm: parsed.realm || parsed.crealm,
          errorCode: parsed.errorCode,
          errorName: parsed.errorName,
          errorText: parsed.etext,
          serverTime: parsed.stime,
          supportedEtypes: parsed.supportedEtypes,
          etypeNames: parsed.etypeNames,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      connectTime,
      response: null,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

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
