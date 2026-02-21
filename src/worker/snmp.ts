/**
 * SNMP Protocol Implementation (RFC 1157, 1905, 3430)
 *
 * Simple Network Management Protocol for monitoring and managing network devices.
 * This implementation supports SNMPv1 and SNMPv2c over TCP (RFC 3430).
 *
 * Protocol Overview:
 * - Port 161 (agent queries)
 * - ASN.1/BER encoding
 * - Community-based authentication (v1/v2c)
 * - Supports GET, GETNEXT, and GETBULK operations
 *
 * Common OIDs:
 * - 1.3.6.1.2.1.1.1.0 (sysDescr)
 * - 1.3.6.1.2.1.1.3.0 (sysUpTime)
 * - 1.3.6.1.2.1.1.5.0 (sysName)
 * - 1.3.6.1.2.1.1.6.0 (sysLocation)
 */

import { connect } from 'cloudflare:sockets';
import { createHash, createHmac } from 'node:crypto';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// ASN.1 BER Type Tags
const BER_TYPE = {
  INTEGER: 0x02,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OBJECT_IDENTIFIER: 0x06,
  SEQUENCE: 0x30,

  // SNMP-specific
  IPADDRESS: 0x40,
  COUNTER32: 0x41,
  GAUGE32: 0x42,
  TIMETICKS: 0x43,
  OPAQUE: 0x44,
  COUNTER64: 0x46,

  // PDU types
  GET_REQUEST: 0xa0,
  GETNEXT_REQUEST: 0xa1,
  GET_RESPONSE: 0xa2,
  SET_REQUEST: 0xa3,
  GETBULK_REQUEST: 0xa5,
} as const;

// SNMP Versions
const SNMP_VERSION = {
  V1: 0,
  V2C: 1,
} as const;

interface SNMPRequest {
  host: string;
  port?: number;
  community?: string;
  oid: string;
  version?: 1 | 2;
  timeout?: number;
}

interface SNMPWalkRequest {
  host: string;
  port?: number;
  community?: string;
  oid: string;
  version?: 1 | 2;
  maxRepetitions?: number;
  timeout?: number;
}

interface SNMPResult {
  oid: string;
  type: string;
  value: string | number;
}

interface SNMPResponse {
  success: boolean;
  results?: SNMPResult[];
  error?: string;
  errorStatus?: string;
  errorIndex?: number;
}

/**
 * Encode an integer in ASN.1 BER format
 */
function encodeInteger(value: number): Uint8Array {
  const bytes: number[] = [];

  // Handle negative numbers (two's complement)
  let n = value;
  if (n >= 0) {
    do {
      bytes.unshift(n & 0xff);
      n >>= 8;
    } while (n > 0);

    // Add leading zero if high bit is set (to keep it positive)
    if (bytes[0] & 0x80) {
      bytes.unshift(0);
    }
  } else {
    // Negative number handling
    do {
      bytes.unshift(n & 0xff);
      n >>= 8;
    } while (n < -1 || (n === -1 && !(bytes[0] & 0x80)));
  }

  return new Uint8Array([BER_TYPE.INTEGER, bytes.length, ...bytes]);
}

/**
 * Encode a string in ASN.1 BER format
 */
function encodeOctetString(str: string): Uint8Array {
  const bytes = new TextEncoder().encode(str);
  return new Uint8Array([BER_TYPE.OCTET_STRING, bytes.length, ...bytes]);
}

/**
 * Encode an OID in ASN.1 BER format
 * Example: "1.3.6.1.2.1.1.1.0" -> encoded bytes
 */
function encodeOID(oid: string): Uint8Array {
  const parts = oid.split('.').map(Number);

  // Validate all components are non-negative integers
  if (parts.some(p => !Number.isInteger(p) || p < 0 || isNaN(p))) {
    throw new Error(`Invalid OID: ${oid}`);
  }
  // Validate root arc: first component 0-2, second component 0-39 for arcs 0 and 1
  if (parts.length < 2 || parts[0] > 2 || (parts[0] < 2 && parts[1] > 39)) {
    throw new Error(`Invalid OID root arc: ${oid}`);
  }

  const bytes: number[] = [];

  // First two components are encoded as: 40 * first + second
  if (parts.length >= 2) {
    bytes.push(40 * parts[0] + parts[1]);
  }

  // Remaining components
  for (let i = 2; i < parts.length; i++) {
    let value = parts[i];

    if (value < 128) {
      bytes.push(value);
    } else {
      // Encode as variable-length quantity
      const encoded: number[] = [];
      encoded.unshift(value & 0x7f);
      value = (value >>> 7);

      let iterations = 0;
      while (value > 0) {
        if (++iterations > 32) throw new Error('OID component too large');
        encoded.unshift((value & 0x7F) | (encoded.length > 0 ? 0x80 : 0));
        value = (value >>> 7);
      }

      bytes.push(...encoded);
    }
  }

  return new Uint8Array([BER_TYPE.OBJECT_IDENTIFIER, bytes.length, ...bytes]);
}

/**
 * Encode NULL in ASN.1 BER format
 */
function encodeNull(): Uint8Array {
  return new Uint8Array([BER_TYPE.NULL, 0]);
}

/**
 * Encode a sequence in ASN.1 BER format
 */
function encodeSequence(items: Uint8Array[]): Uint8Array {
  const totalLength = items.reduce((sum, item) => sum + item.length, 0);
  const length = encodeLength(totalLength);

  const result = new Uint8Array(1 + length.length + totalLength);
  result[0] = BER_TYPE.SEQUENCE;
  result.set(length, 1);

  let offset = 1 + length.length;
  for (const item of items) {
    result.set(item, offset);
    offset += item.length;
  }

  return result;
}

/**
 * Encode length in ASN.1 BER format
 */
function encodeLength(length: number): Uint8Array {
  if (length < 128) {
    return new Uint8Array([length]);
  } else {
    const bytes: number[] = [];
    let n = length;
    while (n > 0) {
      bytes.unshift(n & 0xff);
      n >>= 8;
    }
    return new Uint8Array([0x80 | bytes.length, ...bytes]);
  }
}

/**
 * Encode a PDU (Protocol Data Unit)
 */
function encodePDU(type: number, requestId: number, varbinds: Uint8Array[]): Uint8Array {
  const pduContent = [
    encodeInteger(requestId),
    encodeInteger(0), // error-status
    encodeInteger(0), // error-index
    encodeSequence(varbinds), // variable bindings
  ];

  const pduSequence = encodeSequence(pduContent);

  // Replace SEQUENCE tag with PDU type tag
  const result = new Uint8Array(pduSequence);
  result[0] = type;

  return result;
}

/**
 * Encode a GETBULK PDU (SNMPv2c only)
 */
function encodeBulkPDU(requestId: number, maxRepetitions: number, varbinds: Uint8Array[]): Uint8Array {
  const pduContent = [
    encodeInteger(requestId),
    encodeInteger(0), // non-repeaters
    encodeInteger(maxRepetitions), // max-repetitions
    encodeSequence(varbinds), // variable bindings
  ];

  const pduSequence = encodeSequence(pduContent);

  // Replace SEQUENCE tag with GETBULK type tag
  const result = new Uint8Array(pduSequence);
  result[0] = BER_TYPE.GETBULK_REQUEST;

  return result;
}

/**
 * Build a complete SNMP GET request message
 */
function buildGetRequest(community: string, oid: string, version: number): Uint8Array {
  const requestId = Math.floor(Math.random() * 0x7fffffff);

  // Build varbind: [OID, NULL]
  const varbind = encodeSequence([
    encodeOID(oid),
    encodeNull(),
  ]);

  const pdu = encodePDU(BER_TYPE.GET_REQUEST, requestId, [varbind]);

  const message = encodeSequence([
    encodeInteger(version === 1 ? SNMP_VERSION.V1 : SNMP_VERSION.V2C),
    encodeOctetString(community),
    pdu,
  ]);

  return message;
}

/**
 * Build a complete SNMP GETNEXT request message
 */
function buildGetNextRequest(community: string, oid: string, version: number): Uint8Array {
  const requestId = Math.floor(Math.random() * 0x7fffffff);

  const varbind = encodeSequence([
    encodeOID(oid),
    encodeNull(),
  ]);

  const pdu = encodePDU(BER_TYPE.GETNEXT_REQUEST, requestId, [varbind]);

  const message = encodeSequence([
    encodeInteger(version === 1 ? SNMP_VERSION.V1 : SNMP_VERSION.V2C),
    encodeOctetString(community),
    pdu,
  ]);

  return message;
}

/**
 * Build a complete SNMP GETBULK request message (SNMPv2c only)
 */
function buildGetBulkRequest(community: string, oid: string, maxRepetitions: number): Uint8Array {
  const requestId = Math.floor(Math.random() * 0x7fffffff);

  const varbind = encodeSequence([
    encodeOID(oid),
    encodeNull(),
  ]);

  const pdu = encodeBulkPDU(requestId, maxRepetitions, [varbind]);

  const message = encodeSequence([
    encodeInteger(SNMP_VERSION.V2C),
    encodeOctetString(community),
    pdu,
  ]);

  return message;
}

/**
 * Parse ASN.1 BER encoded data
 */
function parseBER(data: Uint8Array, offset = 0): { type: number; length: number; value: Uint8Array; nextOffset: number } {
  const type = data[offset];
  let lengthOffset = offset + 1;
  let length = data[lengthOffset];

  if (length & 0x80) {
    // Long form length
    const numLengthBytes = length & 0x7f;
    length = 0;
    for (let i = 0; i < numLengthBytes; i++) {
      length = (length << 8) | data[lengthOffset + 1 + i];
    }
    lengthOffset += numLengthBytes;
  }

  const valueOffset = lengthOffset + 1;
  const value = data.slice(valueOffset, valueOffset + length);

  return {
    type,
    length,
    value,
    nextOffset: valueOffset + length,
  };
}

/**
 * Parse an integer from BER
 */
function parseInteger(data: Uint8Array): number {
  let value = 0;
  const isNegative = data[0] & 0x80;

  for (let i = 0; i < data.length; i++) {
    value = (value << 8) | data[i];
  }

  // Handle negative numbers
  if (isNegative) {
    value -= Math.pow(2, data.length * 8);
  }

  return value;
}

/**
 * Parse an OID from BER
 */
function parseOID(data: Uint8Array): string {
  const parts: number[] = [];

  // First byte encodes first two components
  if (data.length > 0) {
    const first = Math.floor(data[0] / 40);
    const second = data[0] % 40;
    parts.push(first, second);
  }

  // Parse remaining components
  let i = 1;
  while (i < data.length) {
    let value = 0;

    while (i < data.length && (data[i] & 0x80)) {
      value = (value << 7) | (data[i] & 0x7f);
      i++;
    }

    if (i < data.length) {
      value = (value << 7) | data[i];
      i++;
    }

    parts.push(value);
  }

  return parts.join('.');
}

/**
 * Parse SNMP response message
 */
function parseResponse(data: Uint8Array): SNMPResponse {
  try {
    // Parse outer SEQUENCE
    const message = parseBER(data);
    if (message.type !== BER_TYPE.SEQUENCE) {
      throw new Error('Invalid SNMP message: not a SEQUENCE');
    }

    let offset = 0;

    // Parse version
    const version = parseBER(message.value, offset);
    offset = version.nextOffset;

    // Parse community
    const community = parseBER(message.value, offset);
    offset = community.nextOffset;

    // Parse PDU
    const pdu = parseBER(message.value, offset);

    let pduOffset = 0;

    // Parse request-id
    const requestId = parseBER(pdu.value, pduOffset);
    pduOffset = requestId.nextOffset;

    // Parse error-status
    const errorStatus = parseBER(pdu.value, pduOffset);
    const errorStatusValue = parseInteger(errorStatus.value);
    pduOffset = errorStatus.nextOffset;

    // Parse error-index
    const errorIndex = parseBER(pdu.value, pduOffset);
    const errorIndexValue = parseInteger(errorIndex.value);
    pduOffset = errorIndex.nextOffset;

    // Check for errors
    if (errorStatusValue !== 0) {
      const errorMessages = [
        'noError',
        'tooBig',
        'noSuchName',
        'badValue',
        'readOnly',
        'genErr',
      ];

      return {
        success: false,
        errorStatus: errorMessages[errorStatusValue] || `Error ${errorStatusValue}`,
        errorIndex: errorIndexValue,
      };
    }

    // Parse variable bindings
    const varbinds = parseBER(pdu.value, pduOffset);

    const results: SNMPResult[] = [];
    let vbOffset = 0;

    while (vbOffset < varbinds.value.length) {
      const varbind = parseBER(varbinds.value, vbOffset);

      // Parse OID
      const oidData = parseBER(varbind.value, 0);
      const oid = parseOID(oidData.value);

      // Parse value
      const valueData = parseBER(varbind.value, oidData.nextOffset);
      let value: string | number;
      let type: string;

      switch (valueData.type) {
        case BER_TYPE.INTEGER:
          value = parseInteger(valueData.value);
          type = 'INTEGER';
          break;
        case BER_TYPE.OCTET_STRING:
          // Decode as text if printable; hex for binary (MAC addr, interface IDs, etc.)
          value = decodeOctetString(valueData.value);
          type = 'STRING';
          break;
        case BER_TYPE.OBJECT_IDENTIFIER:
          value = parseOID(valueData.value);
          type = 'OID';
          break;
        case BER_TYPE.IPADDRESS:
          value = Array.from(valueData.value).join('.');
          type = 'IPADDRESS';
          break;
        case BER_TYPE.COUNTER32:
          value = parseInteger(valueData.value);
          type = 'COUNTER32';
          break;
        case BER_TYPE.GAUGE32:
          value = parseInteger(valueData.value);
          type = 'GAUGE32';
          break;
        case BER_TYPE.TIMETICKS: {
          const raw = parseInteger(valueData.value);
          // Return both raw hundredths and human-readable form
          value = `${raw} (${formatTimeTicks(raw)})`;
          type = 'TIMETICKS';
          break;
        }
        case BER_TYPE.COUNTER64:
          // 64-bit counter — common on modern interfaces; was silently dropped before
          value = parseCounter64(valueData.value) as string | number;
          type = 'COUNTER64';
          break;
        case BER_TYPE.NULL:
          value = 'null';
          type = 'NULL';
          break;
        // SNMPv2c exception types (RFC 1905 §3.2) — these appear in varbinds,
        // not in errorStatus. Missing handling causes silent data loss on walk.
        case 0x80:
          value = 'noSuchObject';
          type = 'EXCEPTION';
          break;
        case 0x81:
          value = 'noSuchInstance';
          type = 'EXCEPTION';
          break;
        case 0x82:
          value = 'endOfMibView';
          type = 'EXCEPTION';
          break;
        default:
          value = `0x${Array.from(valueData.value).map(b => b.toString(16).padStart(2, '0')).join('')}`;
          type = `UNKNOWN(0x${valueData.type.toString(16)})`;
      }

      results.push({ oid, type, value });

      vbOffset = varbind.nextOffset;
    }

    return {
      success: true,
      results,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Parse error',
    };
  }
}

// SNMPv3 USM security level flags
const SNMP_V3_FLAGS = {
  AUTH: 0x01,
  PRIV: 0x02,
  REPORTABLE: 0x04,
} as const;

// SNMPv3 message PDU types
const SNMP_V3_PDU = {
  GET_REQUEST: 0xa0,
  GET_RESPONSE: 0xa2,
  REPORT: 0xa8,
} as const;

/**
 * Encode an octet string from raw bytes (not a UTF-8 string)
 */
function encodeOctetBytes(bytes: Uint8Array): Uint8Array {
  const length = encodeLength(bytes.length);
  const result = new Uint8Array(1 + length.length + bytes.length);
  result[0] = BER_TYPE.OCTET_STRING;
  result.set(length, 1);
  result.set(bytes, 1 + length.length);
  return result;
}

/**
 * Encode a tagged context value (e.g. PDU with a specific type tag)
 */
function encodeTagged(tag: number, items: Uint8Array[]): Uint8Array {
  const totalLength = items.reduce((sum, item) => sum + item.length, 0);
  const length = encodeLength(totalLength);
  const result = new Uint8Array(1 + length.length + totalLength);
  result[0] = tag;
  result.set(length, 1);
  let offset = 1 + length.length;
  for (const item of items) {
    result.set(item, offset);
    offset += item.length;
  }
  return result;
}

/**
 * Concatenate multiple Uint8Arrays
 */
function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

/**
 * Format TIMETICKS (hundredths of seconds) as a human-readable duration.
 * TIMETICKS is one of the most common SNMP types; raw numbers are useless.
 * Example: 47759600 → "5 days, 12:39:56"
 */
function formatTimeTicks(hundredths: number): string {
  const total = Math.floor(hundredths / 100);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const hms = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  return days > 0 ? `${days} day${days !== 1 ? 's' : ''}, ${hms}` : hms;
}

/**
 * Decode an OCTET STRING intelligently:
 * - Printable ASCII → return as text
 * - Binary bytes (MAC addr, interface ID, etc.) → colon-separated hex
 * TextDecoder silently mangles binary values; this preserves them.
 */
function decodeOctetString(data: Uint8Array): string {
  const isPrintable = data.every(b => b >= 0x20 && b < 0x7f);
  return isPrintable
    ? new TextDecoder().decode(data)
    : Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(':');
}

/**
 * Parse COUNTER64 from BER bytes.
 * Values ≤ 2^53 are returned as numbers; larger values as decimal strings.
 * JS bitwise operators truncate to 32 bits, so we must use arithmetic.
 */
function parseCounter64(data: Uint8Array): number | string {
  let hi = 0;
  let lo = 0;
  for (let i = 0; i < data.length; i++) {
    if (i < data.length - 4) {
      hi = hi * 256 + data[i];
    } else {
      lo = lo * 256 + data[i];
    }
  }
  // Combine: hi * 2^32 + lo
  const value = hi * 4294967296 + lo;
  // If within safe integer range, return a number
  if (value <= Number.MAX_SAFE_INTEGER) return value;
  // Otherwise return a decimal string to avoid precision loss
  return `${BigInt(hi) * BigInt(4294967296) + BigInt(lo)}`;
}

/**
 * Encode a typed value for an SNMP SET varbind.
 * Supports the types most commonly used in SET operations.
 */
function encodeTypedValue(type: string, value: string | number): Uint8Array {
  switch (type.toUpperCase()) {
    case 'INTEGER':
      return encodeInteger(Number(value));
    case 'STRING':
      return encodeOctetString(String(value));
    case 'OID':
      return encodeOID(String(value));
    case 'IPADDRESS': {
      const parts = String(value).split('.').map(Number);
      if (parts.length !== 4 || parts.some(p => p < 0 || p > 255)) {
        throw new Error(`Invalid IP address for SET: ${value}`);
      }
      return new Uint8Array([BER_TYPE.IPADDRESS, 4, ...parts]);
    }
    case 'COUNTER32':
    case 'GAUGE32':
    case 'TIMETICKS': {
      // These types have the same BER encoding as INTEGER but with a different tag
      const tagMap: Record<string, number> = {
        COUNTER32: BER_TYPE.COUNTER32, GAUGE32: BER_TYPE.GAUGE32, TIMETICKS: BER_TYPE.TIMETICKS,
      };
      const encoded = encodeInteger(Number(value));
      const result = new Uint8Array(encoded);
      result[0] = tagMap[type.toUpperCase()];
      return result;
    }
    default:
      throw new Error(`Unsupported SET value type: ${type}. Use: INTEGER, STRING, OID, IPADDRESS, COUNTER32, GAUGE32, TIMETICKS`);
  }
}

/**
 * Build an SNMP SET request for a single OID.
 */
function buildSetRequest(community: string, oid: string, valueType: string, value: string | number, version: number): Uint8Array {
  const requestId = Math.floor(Math.random() * 0x7fffffff);
  const typedValue = encodeTypedValue(valueType, value);
  const varbind = encodeSequence([encodeOID(oid), typedValue]);
  const pdu = encodePDU(BER_TYPE.SET_REQUEST, requestId, [varbind]);
  return encodeSequence([
    encodeInteger(version === 1 ? SNMP_VERSION.V1 : SNMP_VERSION.V2C),
    encodeOctetString(community),
    pdu,
  ]);
}

/**
 * Build a multi-OID GET request (single request, multiple varbinds).
 * More efficient than N individual GET requests.
 */
function buildMultiGetRequest(community: string, oids: string[], version: number): Uint8Array {
  const requestId = Math.floor(Math.random() * 0x7fffffff);
  const varbinds = oids.map(oid => encodeSequence([encodeOID(oid), encodeNull()]));
  const pdu = encodePDU(BER_TYPE.GET_REQUEST, requestId, varbinds);
  return encodeSequence([
    encodeInteger(version === 1 ? SNMP_VERSION.V1 : SNMP_VERSION.V2C),
    encodeOctetString(community),
    pdu,
  ]);
}

/**
 * HMAC using node:crypto (MD5) or WebCrypto (SHA-1/SHA-256).
 * SNMPv3 RFC 3414 mandates HMAC-MD5-96 or HMAC-SHA-96 for authentication.
 * WebCrypto doesn't support MD5, so MD5 paths use node:crypto createHmac.
 */
async function hmacDigest(algorithm: 'MD5' | 'SHA-1' | 'SHA-256', key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (algorithm === 'MD5') {
    return new Uint8Array(createHmac('md5', key).update(data).digest());
  }
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as Uint8Array<ArrayBuffer>,
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, data as Uint8Array<ArrayBuffer>);
  return new Uint8Array(sig);
}

/**
 * SNMPv3 key localization (RFC 3414 §2.6):
 * 1. Hash password (repeated to fill 1MB) → Ku
 * 2. hash(Ku + engineID + Ku) → Kul (localized key)
 */
async function localizeKey(password: string, engineId: Uint8Array, algorithm: 'MD5' | 'SHA-1' | 'SHA-256'): Promise<Uint8Array> {
  const passwordBytes = new TextEncoder().encode(password);
  const targetLen = 1024 * 1024; // 1MB

  // Build 1MB buffer by repeating password
  const buf = new Uint8Array(targetLen);
  let pos = 0;
  while (pos < targetLen) {
    const toCopy = Math.min(passwordBytes.length, targetLen - pos);
    buf.set(passwordBytes.subarray(0, toCopy), pos);
    pos += toCopy;
  }

  // Hash the 1MB buffer to get Ku
  let ku: Uint8Array;
  if (algorithm === 'MD5') {
    ku = new Uint8Array(createHash('md5').update(buf).digest());
  } else {
    ku = new Uint8Array(await crypto.subtle.digest(algorithm, buf as Uint8Array<ArrayBuffer>));
  }

  // Localize: hash(Ku + engineID + Ku)
  const localInput = concatBytes(ku, engineId, ku);
  if (algorithm === 'MD5') {
    return new Uint8Array(createHash('md5').update(localInput).digest());
  }
  return new Uint8Array(await crypto.subtle.digest(algorithm, localInput as Uint8Array<ArrayBuffer>));
}

/**
 * Build SNMPv3 USM security parameters (BER encoded)
 */
function buildUSMSecurityParams(
  engineId: Uint8Array,
  engineBoots: number,
  engineTime: number,
  username: string,
  authParams: Uint8Array,  // 12 zero bytes for placeholder, or actual HMAC
  privParams: Uint8Array,  // 8 zero bytes or actual priv params
): Uint8Array {
  // UsmSecurityParameters ::= SEQUENCE {
  //   msgAuthoritativeEngineID    OCTET STRING,
  //   msgAuthoritativeEngineBoots INTEGER,
  //   msgAuthoritativeEngineTime  INTEGER,
  //   msgUserName                 OCTET STRING,
  //   msgAuthenticationParameters OCTET STRING,
  //   msgPrivacyParameters        OCTET STRING
  // }
  return encodeSequence([
    encodeOctetBytes(engineId),
    encodeInteger(engineBoots),
    encodeInteger(engineTime),
    encodeOctetString(username),
    encodeOctetBytes(authParams),
    encodeOctetBytes(privParams),
  ]);
}

/**
 * Build a complete SNMPv3 message
 */
function buildSNMPv3Message(
  msgId: number,
  securityLevel: number,
  securityParams: Uint8Array,
  contextEngineId: Uint8Array,
  contextName: string,
  pdu: Uint8Array,
): Uint8Array {
  // SNMPv3 Global Header
  const globalHeader = encodeSequence([
    encodeInteger(msgId),              // msgID
    encodeInteger(65507),              // msgMaxSize
    encodeOctetBytes(new Uint8Array([securityLevel])), // msgFlags (1 byte)
    encodeInteger(3),                  // msgSecurityModel = USM (3)
  ]);

  // Scoped PDU: contextEngineID + contextName + PDU
  const scopedPdu = encodeSequence([
    encodeOctetBytes(contextEngineId),
    encodeOctetString(contextName),
    pdu,
  ]);

  // Full message: version=3, globalHeader, securityParameters, scopedPDU
  return encodeSequence([
    encodeInteger(3),                            // version SNMPv3
    globalHeader,
    encodeOctetBytes(securityParams),            // wrapped in OCTET STRING
    scopedPdu,
  ]);
}

/**
 * Parse SNMPv3 response to extract engine parameters from REPORT PDU
 */
function parseSNMPv3Discovery(data: Uint8Array): {
  engineId: Uint8Array;
  engineBoots: number;
  engineTime: number;
} {
  // Parse outer SEQUENCE
  const message = parseBER(data);
  let offset = 0;

  // Skip version
  const version = parseBER(message.value, offset);
  offset = version.nextOffset;

  // Skip global header (it's a SEQUENCE)
  const globalHeader = parseBER(message.value, offset);
  offset = globalHeader.nextOffset;

  // Security parameters (OCTET STRING wrapping a SEQUENCE)
  const secParamsOctet = parseBER(message.value, offset);

  // Parse USM security parameters
  const usmSeq = parseBER(secParamsOctet.value, 0);
  let usmOffset = 0;

  const engineIdField = parseBER(usmSeq.value, usmOffset);
  const engineId = new Uint8Array(engineIdField.value);
  usmOffset = engineIdField.nextOffset;

  const bootsField = parseBER(usmSeq.value, usmOffset);
  const engineBoots = parseInteger(bootsField.value);
  usmOffset = bootsField.nextOffset;

  const timeField = parseBER(usmSeq.value, usmOffset);
  const engineTime = parseInteger(timeField.value);

  return { engineId, engineBoots, engineTime };
}

/**
 * Handle SNMPv3 GET request using USM (User Security Model)
 * POST /api/snmp/v3get
 *
 * Flow:
 *   1. Discovery: send unauthenticated message to get engineID + time
 *   2. Key localization using HMAC-SHA1 (for authProtocol=SHA or MD5)
 *   3. Build authenticated GET request
 *   4. Parse response variable bindings
 */
export async function handleSNMPv3Get(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
      username: string;
      authPassword?: string;
      privPassword?: string;
      authProtocol?: 'MD5' | 'SHA';
      privProtocol?: 'DES' | 'AES';
      oids: string[];
    };

    const {
      host,
      port = 161,
      timeout = 10000,
      username,
      authPassword,
      authProtocol = 'SHA',
      oids,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!username) {
      return new Response(JSON.stringify({ success: false, error: 'Username is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!oids || oids.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'At least one OID is required' }), {
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

    const startTime = Date.now();

    // --- Step 1: Discovery request ---
    // Empty engine ID, no auth/priv, to discover engine parameters
    const emptyEngineId = new Uint8Array(0);
    const emptyAuthParams = new Uint8Array(12); // 12 zero bytes placeholder
    const emptyPrivParams = new Uint8Array(0);

    const discoverySecParams = buildUSMSecurityParams(
      emptyEngineId, 0, 0, username, emptyAuthParams, emptyPrivParams,
    );
    const discoverySecParamBytes = discoverySecParams;

    // Build a GET request PDU for discovery (request-id=1, no auth)
    const discMsgId = Math.floor(Math.random() * 0x7fffffff);
    const discReqId = Math.floor(Math.random() * 0x7fffffff);

    // Build varbinds for the OIDs
    const varbindList = oids.map(oid => encodeSequence([encodeOID(oid), encodeNull()]));
    const discPdu = encodeTagged(SNMP_V3_PDU.GET_REQUEST, [
      encodeInteger(discReqId),
      encodeInteger(0),
      encodeInteger(0),
      encodeSequence(varbindList),
    ]);

    const discMessage = buildSNMPv3Message(
      discMsgId,
      SNMP_V3_FLAGS.REPORTABLE,  // reportable flag, no auth/priv
      discoverySecParamBytes,
      emptyEngineId,
      '',
      discPdu,
    );

    // Send discovery request
    const socket1 = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    let engineId: Uint8Array;
    let engineBoots: number;
    let engineTime: number;

    try {
      await Promise.race([socket1.opened, timeoutPromise]);
      const writer1 = socket1.writable.getWriter();
      const reader1 = socket1.readable.getReader();

      await writer1.write(discMessage);
      const { value: discResponse } = await Promise.race([reader1.read(), timeoutPromise]);

      writer1.releaseLock();
      reader1.releaseLock();
      socket1.close();

      if (!discResponse) {
        throw new Error('No response from SNMP agent during discovery');
      }

      const disc = parseSNMPv3Discovery(discResponse);
      engineId = disc.engineId;
      engineBoots = disc.engineBoots;
      engineTime = disc.engineTime;
    } catch (err) {
      socket1.close();
      throw err;
    }

    const engineIdHex = Array.from(engineId).map(b => b.toString(16).padStart(2, '0')).join('');

    // --- Step 2: Compute auth key (if authPassword provided) ---
    // MD5 uses node:crypto; SHA uses WebCrypto.  Previously both silently used SHA-1.
    const hashAlgorithm: 'MD5' | 'SHA-1' | 'SHA-256' = authProtocol === 'MD5' ? 'MD5' : 'SHA-1';
    const securityLevel = authPassword
      ? (SNMP_V3_FLAGS.AUTH | SNMP_V3_FLAGS.REPORTABLE)
      : SNMP_V3_FLAGS.REPORTABLE;

    let authKey: Uint8Array | null = null;
    if (authPassword) {
      authKey = await localizeKey(authPassword, engineId, hashAlgorithm);
    }

    // --- Step 3: Build authenticated GET request ---
    const msgId = Math.floor(Math.random() * 0x7fffffff);
    const reqId = Math.floor(Math.random() * 0x7fffffff);

    const authParamsPlaceholder = new Uint8Array(12); // 12 zero bytes for HMAC-SHA1
    const privParamsEmpty = new Uint8Array(0);

    const secParams = buildUSMSecurityParams(
      engineId,
      engineBoots,
      engineTime,
      username,
      authParamsPlaceholder,
      privParamsEmpty,
    );

    const getPdu = encodeTagged(SNMP_V3_PDU.GET_REQUEST, [
      encodeInteger(reqId),
      encodeInteger(0),
      encodeInteger(0),
      encodeSequence(varbindList),
    ]);

    let fullMessage = buildSNMPv3Message(
      msgId,
      securityLevel,
      secParams,
      engineId,
      '',
      getPdu,
    );

    // Compute HMAC over the whole message and insert at auth params offset
    if (authKey) {
      const rawHmac = await hmacDigest(hashAlgorithm, authKey, fullMessage);
      // Use first 12 bytes of HMAC as msgAuthenticationParameters
      const authParamsFilled = rawHmac.subarray(0, 12);

      // Rebuild with actual auth params
      const secParamsAuth = buildUSMSecurityParams(
        engineId,
        engineBoots,
        engineTime,
        username,
        authParamsFilled,
        privParamsEmpty,
      );

      fullMessage = buildSNMPv3Message(
        msgId,
        securityLevel,
        secParamsAuth,
        engineId,
        '',
        getPdu,
      );
    }

    // --- Step 4: Send authenticated GET and parse response ---
    const socket2 = connect(`${host}:${port}`);
    const timeoutPromise2 = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const varbinds: Array<{ oid: string; type: string; value: string | number }> = [];

    try {
      await Promise.race([socket2.opened, timeoutPromise2]);
      const writer2 = socket2.writable.getWriter();
      const reader2 = socket2.readable.getReader();

      await writer2.write(fullMessage);
      const { value: getResponse } = await Promise.race([reader2.read(), timeoutPromise2]);

      writer2.releaseLock();
      reader2.releaseLock();
      socket2.close();

      if (!getResponse) {
        throw new Error('No response from SNMP agent for GET request');
      }

      // Reuse the existing v1/v2c parseResponse but the v3 message has the PDU inside a scoped PDU
      // Parse v3 message structure to extract the inner PDU data
      const outerMsg = parseBER(getResponse);
      let v3Offset = 0;
      const v3Version = parseBER(outerMsg.value, v3Offset);
      v3Offset = v3Version.nextOffset;
      const v3GlobalHdr = parseBER(outerMsg.value, v3Offset);
      v3Offset = v3GlobalHdr.nextOffset;
      const v3SecParams = parseBER(outerMsg.value, v3Offset);
      v3Offset = v3SecParams.nextOffset;
      const v3ScopedPdu = parseBER(outerMsg.value, v3Offset);

      // Scoped PDU: SEQUENCE { contextEngineId, contextName, PDU }
      let spOffset = 0;
      const ctxEngine = parseBER(v3ScopedPdu.value, spOffset);
      spOffset = ctxEngine.nextOffset;
      const ctxName = parseBER(v3ScopedPdu.value, spOffset);
      spOffset = ctxName.nextOffset;

      // The inner PDU - parse varbinds from it directly
      const innerPdu = parseBER(v3ScopedPdu.value, spOffset);

      let pduOffset = 0;
      const pduReqId = parseBER(innerPdu.value, pduOffset);
      pduOffset = pduReqId.nextOffset;
      const errStatus = parseBER(innerPdu.value, pduOffset);
      pduOffset = errStatus.nextOffset;
      const errIdx = parseBER(innerPdu.value, pduOffset);
      pduOffset = errIdx.nextOffset;
      const vbSeq = parseBER(innerPdu.value, pduOffset);

      let vbOffset = 0;
      while (vbOffset < vbSeq.value.length) {
        const vb = parseBER(vbSeq.value, vbOffset);
        const oidPart = parseBER(vb.value, 0);
        const oidStr = parseOID(oidPart.value);
        const valPart = parseBER(vb.value, oidPart.nextOffset);

        let value: string | number;
        let type: string;

        switch (valPart.type) {
          case BER_TYPE.INTEGER:
            value = parseInteger(valPart.value);
            type = 'INTEGER';
            break;
          case BER_TYPE.OCTET_STRING:
            value = decodeOctetString(valPart.value);
            type = 'STRING';
            break;
          case BER_TYPE.OBJECT_IDENTIFIER:
            value = parseOID(valPart.value);
            type = 'OID';
            break;
          case BER_TYPE.IPADDRESS:
            value = Array.from(valPart.value).join('.');
            type = 'IPADDRESS';
            break;
          case BER_TYPE.COUNTER32:
            value = parseInteger(valPart.value);
            type = 'COUNTER32';
            break;
          case BER_TYPE.GAUGE32:
            value = parseInteger(valPart.value);
            type = 'GAUGE32';
            break;
          case BER_TYPE.TIMETICKS: {
            const raw = parseInteger(valPart.value);
            value = `${raw} (${formatTimeTicks(raw)})`;
            type = 'TIMETICKS';
            break;
          }
          case BER_TYPE.COUNTER64:
            value = parseCounter64(valPart.value) as string | number;
            type = 'COUNTER64';
            break;
          case BER_TYPE.NULL:
            value = 'null';
            type = 'NULL';
            break;
          case 0x80: value = 'noSuchObject'; type = 'EXCEPTION'; break;
          case 0x81: value = 'noSuchInstance'; type = 'EXCEPTION'; break;
          case 0x82: value = 'endOfMibView'; type = 'EXCEPTION'; break;
          default:
            value = `0x${Array.from(valPart.value).map(b => b.toString(16).padStart(2, '0')).join('')}`;
            type = `UNKNOWN(0x${valPart.type.toString(16)})`;
        }

        varbinds.push({ oid: oidStr, type, value });
        vbOffset = vb.nextOffset;
      }
    } catch (err) {
      socket2.close();
      throw err;
    }

    const rtt = Date.now() - startTime;

    return new Response(JSON.stringify({
      success: true,
      engineId: engineIdHex,
      engineBoots,
      engineTime,
      securityLevel: authPassword ? 'authNoPriv' : 'noAuthNoPriv',
      authProtocol: authPassword ? authProtocol : undefined,
      varbinds,
      rtt,
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

/**
 * Handle SNMP GET request
 */
export async function handleSNMPGet(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SNMPRequest;
    const {
      host,
      port = 161,
      community = 'public',
      oid,
      version = 2,
      timeout = 10000,
    } = body;

    // Validation
    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!oid) {
      return new Response(JSON.stringify({
        success: false,
        error: 'OID is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if behind Cloudflare
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

    // Build SNMP GET request
    const requestData = buildGetRequest(community, oid, version);

    // Connect to SNMP agent
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send request
      await writer.write(requestData);

      // Read response
      const { value: responseData } = await Promise.race([
        reader.read(),
        timeoutPromise,
      ]);

      if (!responseData) {
        throw new Error('No response from SNMP agent');
      }

      // Parse response
      const response = parseResponse(responseData);

      // Cleanup
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify(response), {
        status: response.success ? 200 : 500,
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
 * Handle SNMP WALK request (retrieves multiple OIDs under a subtree)
 */
export async function handleSNMPWalk(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SNMPWalkRequest;
    const {
      host,
      port = 161,
      community = 'public',
      oid,
      version = 2,
      maxRepetitions = 10,
      timeout = 30000,
    } = body;

    // Validation
    if (!host || !oid) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host and OID are required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if behind Cloudflare
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

    const allResults: SNMPResult[] = [];
    let currentOid = oid;
    const startTime = Date.now();

    // Connect once for the entire walk
    const socket = connect(`${host}:${port}`);

    try {
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Use GETBULK for SNMPv2c, GETNEXT for SNMPv1
      const useBulk = version === 2;

      while (Date.now() - startTime < timeout) {
        // Build request
        const requestData = useBulk
          ? buildGetBulkRequest(community, currentOid, maxRepetitions)
          : buildGetNextRequest(community, currentOid, version);

        // Send request
        await writer.write(requestData);

        // Read response
        const { value: responseData } = await reader.read();

        if (!responseData) {
          break;
        }

        // Parse response
        const response = parseResponse(responseData);

        if (!response.success || !response.results || response.results.length === 0) {
          break;
        }

        // Check if we've moved beyond the requested OID subtree
        let endOfMib = false;
        for (const result of response.results) {
          if (!result.oid.startsWith(oid)) {
            endOfMib = true;
            break;
          }
          allResults.push(result);
          currentOid = result.oid;
        }

        if (endOfMib) {
          break;
        }

        // For v1, only one result per request
        if (!useBulk) {
          if (response.results.length > 0) {
            currentOid = response.results[0].oid;
          } else {
            break;
          }
        }
      }

      // Cleanup
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: true,
        results: allResults,
        count: allResults.length,
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
 * Handle SNMP SET request
 * POST /api/snmp/set
 *
 * Sets a single OID value on the target agent. Requires write community (typically
 * not "public"). Essential for device management: rename a device (sysName),
 * bring an interface up/down (ifAdminStatus), enable traps, adjust config.
 *
 * Body: { host, port?, community?, oid, valueType, value, version? }
 * valueType: INTEGER | STRING | OID | IPADDRESS | COUNTER32 | GAUGE32 | TIMETICKS
 */
export async function handleSNMPSet(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      community?: string;
      oid: string;
      valueType: string;
      value: string | number;
      version?: 1 | 2;
      timeout?: number;
    };

    const {
      host,
      port = 161,
      community = 'private',
      oid,
      valueType,
      value,
      version = 2,
      timeout = 10000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!oid) {
      return new Response(JSON.stringify({ success: false, error: 'OID is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!valueType) {
      return new Response(JSON.stringify({ success: false, error: 'valueType is required (INTEGER, STRING, OID, IPADDRESS, COUNTER32, GAUGE32, TIMETICKS)' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (value === undefined || value === null) {
      return new Response(JSON.stringify({ success: false, error: 'value is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    let requestData: Uint8Array;
    try {
      requestData = buildSetRequest(community, oid, valueType, value, version);
    } catch (encErr) {
      return new Response(JSON.stringify({
        success: false,
        error: encErr instanceof Error ? encErr.message : 'Encoding error',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout));

    try {
      await Promise.race([socket.opened, timeoutPromise]);
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      await writer.write(requestData);

      const { value: responseData } = await Promise.race([reader.read(), timeoutPromise]);

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      if (!responseData) {
        throw new Error('No response from SNMP agent');
      }

      const response = parseResponse(responseData);

      // On success the agent echoes back the varbind with the new value
      return new Response(JSON.stringify({
        ...response,
        oid,
        setType: valueType,
        setValue: value,
      }), {
        status: response.success ? 200 : 500,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (setErr) {
      socket.close();
      throw setErr;
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
 * Handle SNMP multi-OID GET (single request, multiple varbinds)
 * POST /api/snmp/multi-get
 *
 * Retrieves up to ~60 OIDs in a single SNMP GET request, which is far more
 * efficient than N individual /api/snmp/get calls. Critical for polling
 * dashboards that need multiple metrics per device per collection cycle.
 *
 * Body: { host, port?, community?, oids: string[], version?, timeout? }
 */
export async function handleSNMPMultiGet(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      community?: string;
      oids: string[];
      version?: 1 | 2;
      timeout?: number;
    };

    const {
      host,
      port = 161,
      community = 'public',
      oids,
      version = 2,
      timeout = 10000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!oids || oids.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'oids array is required (at least one OID)' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (oids.length > 60) {
      return new Response(JSON.stringify({ success: false, error: 'Maximum 60 OIDs per request (SNMP PDU size limit)' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const requestData = buildMultiGetRequest(community, oids, version);

    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout));

    try {
      await Promise.race([socket.opened, timeoutPromise]);
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      await writer.write(requestData);

      const { value: responseData } = await Promise.race([reader.read(), timeoutPromise]);

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      if (!responseData) {
        throw new Error('No response from SNMP agent');
      }

      const response = parseResponse(responseData);

      return new Response(JSON.stringify({
        ...response,
        requestedOids: oids.length,
      }), {
        status: response.success ? 200 : 500,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (multiErr) {
      socket.close();
      throw multiErr;
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
