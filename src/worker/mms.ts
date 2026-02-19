/**
 * MMS (Manufacturing Message Specification) — ISO 9506
 *
 * MMS is an international standard (ISO 9506-1/2) for transferring real-time
 * process data and supervisory control information between networked devices
 * in industrial automation. It sits on top of the OSI stack:
 *
 *   Application:  MMS PDU (ASN.1 BER encoded, ISO 9506-2)
 *   Presentation: ISO 8823 (implicit in COTP class 0)
 *   Session:      ISO 8327 (implicit in COTP class 0)
 *   Transport:    ISO 8073 COTP (Connection-Oriented Transport Protocol)
 *   Network:      RFC 1006 TPKT (ISO transport over TCP)
 *   TCP:          Port 102
 *
 * In practice (and as implemented by libIEC61850, MMS-EASE, etc.), MMS-over-TCP
 * uses the simplified "TPKT + COTP + MMS-PDU" stack defined by RFC 1006.
 *
 * TPKT Header (RFC 1006, 4 bytes):
 *   [0]    Version = 0x03
 *   [1]    Reserved = 0x00
 *   [2-3]  Packet length (big-endian, including this header)
 *
 * COTP (ISO 8073):
 *   Connection Request (CR) — TPDU code 0xE0:
 *     [0]    Length indicator (bytes following, excluding this byte)
 *     [1]    TPDU code: 0xE0 (CR)
 *     [2-3]  Destination reference (0x0000)
 *     [4-5]  Source reference (caller-chosen)
 *     [6]    Class + options: 0x00 (class 0, no extensions)
 *     [7..]  Variable part: parameter code + length + value
 *       0xC0: TPDU size (1 byte: 0x0A = 1024 bytes)
 *       0xC1: Calling TSAP
 *       0xC2: Called TSAP
 *
 *   Connection Confirm (CC) — TPDU code 0xD0:
 *     Same structure as CR; confirms the transport connection.
 *
 *   Data Transfer (DT) — TPDU code 0xF0:
 *     [0]    Length indicator = 0x02
 *     [1]    TPDU code: 0xF0
 *     [2]    TPDU-NR + EOT: 0x80 (last data unit)
 *     [3..]  MMS PDU payload
 *
 * MMS PDU (ISO 9506-2, ASN.1 BER):
 *   Initiate-Request  — context tag [0] IMPLICIT SEQUENCE
 *   Initiate-Response — context tag [1] IMPLICIT SEQUENCE
 *   Confirmed-Request — context tag [0] within [1] for Read, Write, GetNameList, etc.
 *
 *   Initiate-Request ::= SEQUENCE {
 *     localDetailCalling   [0] IMPLICIT INTEGER OPTIONAL,
 *     proposedMaxServOutstandingCalling  [1] IMPLICIT INTEGER,
 *     proposedMaxServOutstandingCalled   [2] IMPLICIT INTEGER,
 *     proposedDataStructureNestingLevel  [3] IMPLICIT INTEGER OPTIONAL,
 *     mmsInitRequestDetail [4] IMPLICIT SEQUENCE {
 *       proposedVersionNumber    [0] IMPLICIT INTEGER,
 *       proposedParameterCBB     [1] IMPLICIT BIT STRING,
 *       servicesSupportedCalling [2] IMPLICIT BIT STRING
 *     }
 *   }
 *
 * Default port: 102 (ISO-TSAP / RFC 1006)
 *
 * This implementation supports:
 *   - TPKT/COTP connection establishment (CR/CC)
 *   - MMS Initiate-Request/Response exchange
 *   - MMS Identify (VMD) request to get server vendor/model/revision
 *   - MMS GetNameList to enumerate VMD-scope named variables and domains
 *   - Read of named variables
 *
 * Endpoints:
 *   POST /api/mms/probe     — COTP connect + MMS Initiate + Identify (VMD)
 *   POST /api/mms/namelist  — GetNameList (domains or named-variables)
 *   POST /api/mms/read      — Read a named variable
 *   POST /api/mms/describe  — full discovery: Initiate + Identify + GetNameList
 *
 * References:
 *   ISO 9506-1:2003, ISO 9506-2:2003
 *   RFC 1006 (ISO transport over TCP)
 *   IEC 61850 (uses MMS as its communication layer)
 *   libIEC61850 open-source implementation
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MMSRequest {
  host: string;
  port?: number;
  timeout?: number;
  callingTSAP?: string;
  calledTSAP?: string;
}

interface MMSNameListRequest extends MMSRequest {
  objectClass?: 'namedVariable' | 'domain';
  domainId?: string;
  continueAfter?: string;
}

interface MMSReadRequest extends MMSRequest {
  domainId?: string;
  variableName: string;
}

interface MMSProbeResponse {
  success: boolean;
  host: string;
  port: number;
  rtt?: number;
  cotpConnected?: boolean;
  mmsInitiated?: boolean;
  mmsVersion?: number;
  maxPduSize?: number;
  maxServOutstandingCalling?: number;
  maxServOutstandingCalled?: number;
  servicesSupportedCalled?: string[];
  vendorName?: string;
  modelName?: string;
  revision?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// ASN.1 BER helpers
// ---------------------------------------------------------------------------

/** Encode an ASN.1 length field (BER definite form). */
function berLength(len: number): Uint8Array {
  if (len < 0x80) return new Uint8Array([len]);
  if (len <= 0xFF) return new Uint8Array([0x81, len]);
  return new Uint8Array([0x82, (len >> 8) & 0xFF, len & 0xFF]);
}

/** Encode a BER TLV (tag + length + value). */
function berTLV(tag: number, value: Uint8Array): Uint8Array {
  const len = berLength(value.length);
  const tlv = new Uint8Array(1 + len.length + value.length);
  tlv[0] = tag;
  tlv.set(len, 1);
  tlv.set(value, 1 + len.length);
  return tlv;
}

/** Encode a non-negative integer as BER INTEGER value bytes. */
function berIntegerValue(n: number): Uint8Array {
  if (n < 0) throw new Error('Negative integers not supported');
  if (n === 0) return new Uint8Array([0]);
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xFF);
    v = v >> 8;
  }
  // If high bit set, prepend a 0x00 to keep it positive
  if (bytes[0] & 0x80) bytes.unshift(0);
  return new Uint8Array(bytes);
}

/** Encode a BER INTEGER TLV (universal tag 0x02). */
function berInteger(n: number): Uint8Array {
  return berTLV(0x02, berIntegerValue(n));
}

/** Encode a BER context-specific IMPLICIT primitive wrapping an INTEGER value. */
function berContextInteger(ctxTag: number, n: number): Uint8Array {
  return berTLV(0x80 | ctxTag, berIntegerValue(n));
}

/** Encode a BER context-specific IMPLICIT constructed wrapping content bytes. */
function berContextConstructed(ctxTag: number, content: Uint8Array): Uint8Array {
  return berTLV(0xA0 | ctxTag, content);
}

/** Encode a BER BIT STRING value (unused-bits prefix byte + data). */
function berBitString(tag: number, data: Uint8Array, unusedBits = 0): Uint8Array {
  const val = new Uint8Array(1 + data.length);
  val[0] = unusedBits;
  val.set(data, 1);
  return berTLV(tag, val);
}

/** Encode a BER UTF8/Visible string. */
function berVisibleString(tag: number, s: string): Uint8Array {
  return berTLV(tag, new TextEncoder().encode(s));
}

/** Decode a BER TLV at position `offset` in `data`. Returns tag, value slice, and next offset. */
function berDecode(data: Uint8Array, offset: number): { tag: number; value: Uint8Array; next: number } | null {
  if (offset >= data.length) return null;
  const tag = data[offset++];
  if (offset >= data.length) return null;
  let len = data[offset++];
  if (len & 0x80) {
    const numBytes = len & 0x7F;
    if (numBytes === 0 || numBytes > 4 || offset + numBytes > data.length) return null;
    len = 0;
    for (let i = 0; i < numBytes; i++) {
      len = (len << 8) | data[offset++];
    }
  }
  if (offset + len > data.length) return null;
  return { tag, value: data.subarray(offset, offset + len), next: offset + len };
}

/** Decode a BER INTEGER from its value bytes to a JS number. */
function berDecodeInteger(value: Uint8Array): number {
  if (value.length === 0) return 0;
  // Check if negative (high bit set)
  const isNegative = value[0] & 0x80;
  let n = 0;
  for (let i = 0; i < value.length; i++) {
    n = (n << 8) | value[i];
  }
  // Apply two's complement for negative values
  if (isNegative) {
    const bits = value.length * 8;
    n = n - (1 << bits);
  }
  return n;
}

/** Decode a BER VisibleString / UTF8String from value bytes. */
function berDecodeString(value: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(value);
}

/** Decode a BER BIT STRING value to a list of bit positions that are set (for services-supported). */
function berDecodeBitString(value: Uint8Array): number[] {
  if (value.length < 1) return [];
  const unusedBits = value[0];
  const setBits: number[] = [];
  // Start from index 1 (skip unusedBits prefix byte)
  for (let byteIdx = 1; byteIdx < value.length; byteIdx++) {
    const b = value[byteIdx];
    const isLastByte = (byteIdx === value.length - 1);
    const bitsInByte = isLastByte ? (8 - unusedBits) : 8;
    for (let bit = 0; bit < bitsInByte; bit++) {
      // BER bit strings use MSB-first bit ordering (bit 0 is 0x80)
      if (b & (0x80 >> bit)) {
        // Bit position = (byte_offset * 8) + bit_position
        setBits.push((byteIdx - 1) * 8 + bit);
      }
    }
  }
  return setBits;
}

// Concatenate multiple Uint8Arrays
function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

// ---------------------------------------------------------------------------
// MMS Service names (ISO 9506-2, servicesSupportedCalling/Called bit indices)
// ---------------------------------------------------------------------------

const MMS_SERVICES: Record<number, string> = {
  0: 'status',
  1: 'getNameList',
  2: 'identify',
  3: 'rename',
  4: 'read',
  5: 'write',
  6: 'getVariableAccessAttributes',
  7: 'defineNamedVariable',
  8: 'defineScatteredAccess',
  9: 'getScatteredAccessAttributes',
  10: 'deleteVariableAccess',
  11: 'defineNamedVariableList',
  12: 'getNamedVariableListAttributes',
  13: 'deleteNamedVariableList',
  14: 'defineNamedType',
  15: 'getNamedTypeAttributes',
  16: 'deleteNamedType',
  17: 'input',
  18: 'output',
  19: 'takeControl',
  20: 'relinquishControl',
  21: 'defineSemaphore',
  22: 'deleteSemaphore',
  23: 'reportSemaphoreStatus',
  24: 'reportPoolSemaphoreStatus',
  25: 'reportSemaphoreEntryStatus',
  26: 'initiateDownloadSequence',
  27: 'downloadSegment',
  28: 'terminateDownloadSequence',
  29: 'initiateUploadSequence',
  30: 'uploadSegment',
  31: 'terminateUploadSequence',
  32: 'requestDomainDownload',
  33: 'requestDomainUpload',
  34: 'loadDomainContent',
  35: 'storeDomainContent',
  36: 'deleteDomain',
  37: 'getDomainAttributes',
  38: 'createProgramInvocation',
  39: 'deleteProgramInvocation',
  40: 'start',
  41: 'stop',
  42: 'resume',
  43: 'reset',
  44: 'kill',
  45: 'getProgramInvocationAttributes',
  46: 'obtainFile',
  47: 'defineEventCondition',
  48: 'deleteEventCondition',
  49: 'getEventConditionAttributes',
  50: 'reportEventConditionStatus',
  51: 'alterEventConditionMonitoring',
  52: 'triggerEvent',
  53: 'defineEventAction',
  54: 'deleteEventAction',
  55: 'getEventActionAttributes',
  56: 'reportEventActionStatus',
  57: 'defineEventEnrollment',
  58: 'deleteEventEnrollment',
  59: 'alterEventEnrollment',
  60: 'reportEventEnrollmentStatus',
  61: 'getEventEnrollmentAttributes',
  62: 'acknowledgeEventNotification',
  63: 'getAlarmSummary',
  64: 'getAlarmEnrollmentSummary',
  65: 'readJournal',
  66: 'writeJournal',
  67: 'initializeJournal',
  68: 'reportJournalStatus',
  69: 'createJournal',
  70: 'deleteJournal',
  71: 'getCapabilityList',
  72: 'fileOpen',
  73: 'fileRead',
  74: 'fileClose',
  75: 'fileRename',
  76: 'fileDelete',
  77: 'fileDirectory',
  78: 'unsolicitedStatus',
  79: 'informationReport',
  80: 'eventNotification',
  81: 'attachToEventCondition',
  82: 'attachToSemaphore',
  83: 'conclude',
  84: 'cancel',
};

// ---------------------------------------------------------------------------
// TPKT / COTP / MMS PDU builders
// ---------------------------------------------------------------------------

/**
 * Wrap payload in a TPKT header (RFC 1006).
 * TPKT: version(1)=0x03, reserved(1)=0x00, length(2 BE)
 */
function wrapTPKT(payload: Uint8Array): Uint8Array {
  const total = 4 + payload.length;
  const pkt = new Uint8Array(total);
  pkt[0] = 0x03; // version
  pkt[1] = 0x00; // reserved
  pkt[2] = (total >> 8) & 0xFF;
  pkt[3] = total & 0xFF;
  pkt.set(payload, 4);
  return pkt;
}

/**
 * Build a COTP Connection Request (CR) TPDU.
 * TPDU code 0xE0, class 0, with optional TSAP parameters.
 */
function buildCOTPConnectionRequest(
  srcRef: number,
  callingTSAP?: Uint8Array,
  calledTSAP?: Uint8Array,
): Uint8Array {
  // Fixed part: LI(1) + code(1) + dst-ref(2) + src-ref(2) + class(1) = 7 bytes
  const variableParts: Uint8Array[] = [];

  // TPDU size parameter: code 0xC0, length 1, value 0x0A (1024 bytes)
  variableParts.push(new Uint8Array([0xC0, 0x01, 0x0A]));

  // Calling TSAP (optional)
  if (callingTSAP && callingTSAP.length > 0) {
    const p = new Uint8Array(2 + callingTSAP.length);
    p[0] = 0xC1;
    p[1] = callingTSAP.length;
    p.set(callingTSAP, 2);
    variableParts.push(p);
  }

  // Called TSAP (optional)
  if (calledTSAP && calledTSAP.length > 0) {
    const p = new Uint8Array(2 + calledTSAP.length);
    p[0] = 0xC2;
    p[1] = calledTSAP.length;
    p.set(calledTSAP, 2);
    variableParts.push(p);
  }

  const varLen = variableParts.reduce((s, p) => s + p.length, 0);
  const li = 6 + varLen; // everything after LI byte
  const tpdu = new Uint8Array(1 + li);
  tpdu[0] = li;
  tpdu[1] = 0xE0;                    // CR code
  tpdu[2] = 0x00; tpdu[3] = 0x00;    // Destination reference
  tpdu[4] = (srcRef >> 8) & 0xFF;
  tpdu[5] = srcRef & 0xFF;           // Source reference
  tpdu[6] = 0x00;                    // Class 0, no extended formats

  let off = 7;
  for (const p of variableParts) {
    tpdu.set(p, off);
    off += p.length;
  }

  return tpdu;
}

/**
 * Build a COTP Data Transfer (DT) TPDU wrapping an MMS PDU.
 * DT: LI=0x02, code=0xF0, TPDU-NR+EOT=0x80
 */
function buildCOTPData(mmsPdu: Uint8Array): Uint8Array {
  const dt = new Uint8Array(3 + mmsPdu.length);
  dt[0] = 0x02; // LI
  dt[1] = 0xF0; // DT code
  dt[2] = 0x80; // TPDU-NR=0 + EOT=1 (last data unit)
  dt.set(mmsPdu, 3);
  return dt;
}

/**
 * Build MMS Initiate-Request PDU (ASN.1 BER).
 *
 * Initiate-Request is context tag [0] IMPLICIT SEQUENCE at the
 * confirmed-RequestPDU level. The outer wrapper uses the
 * initiate-RequestPDU choice tag = 0xA8 (context class, constructed, tag 8).
 *
 * Structure:
 *   [0] localDetailCalling       INTEGER (proposed max PDU size, e.g. 65000)
 *   [1] proposedMaxServOutstandingCalling  INTEGER (e.g. 5)
 *   [2] proposedMaxServOutstandingCalled   INTEGER (e.g. 5)
 *   [3] proposedDataStructureNestingLevel  INTEGER (e.g. 10)
 *   [4] mmsInitRequestDetail SEQUENCE {
 *         [0] proposedVersionNumber  INTEGER (1 for MMS edition 1)
 *         [1] proposedParameterCBB   BIT STRING
 *         [2] servicesSupportedCalling BIT STRING (11 bytes)
 *       }
 */
function buildMMSInitiateRequest(): Uint8Array {
  // Services we claim to support (bit positions per ISO 9506-2, Annex A)
  // We advertise: status(0), getNameList(1), identify(2), read(4), write(5),
  // getVariableAccessAttributes(6), getNamedVariableListAttributes(12),
  // getCapabilityList(71), conclude(83)
  const servicesBits = new Uint8Array(11); // 85 services = 11 bytes (85/8 rounded up)
  function setBit(byteArr: Uint8Array, bitIndex: number) {
    const byteIdx = Math.floor(bitIndex / 8);
    const bitPos = 7 - (bitIndex % 8);
    if (byteIdx < byteArr.length) byteArr[byteIdx] |= (1 << bitPos);
  }
  [0, 1, 2, 4, 5, 6, 12, 71, 83].forEach(b => setBit(servicesBits, b));

  // mmsInitRequestDetail [4]
  const versionNumber = berContextInteger(0, 1);         // MMS version 1
  const parameterCBB = berBitString(0x81, new Uint8Array([0xF1, 0x00]), 0); // str1+str2+vnam+valt
  const servicesSupported = berBitString(0x82, servicesBits, 3); // 11*8 - 85 = 3 unused

  const initDetailContent = concat(versionNumber, parameterCBB, servicesSupported);
  const initDetail = berContextConstructed(4, initDetailContent);

  // Initiate-Request body
  const localDetail = berContextInteger(0, 65000);   // max PDU size
  const maxOutCalling = berContextInteger(1, 5);
  const maxOutCalled = berContextInteger(2, 5);
  const nestingLevel = berContextInteger(3, 10);

  const body = concat(localDetail, maxOutCalling, maxOutCalled, nestingLevel, initDetail);

  // Wrap in initiate-RequestPDU tag: 0xA8 (context 8, constructed)
  return berTLV(0xA8, body);
}

/**
 * Build an MMS Confirmed-Request PDU for Identify (service tag [82]).
 *
 * Confirmed-RequestPDU: tag 0xA0 (context 0, constructed)
 *   invokeID: INTEGER
 *   confirmedServiceRequest: CHOICE { identify [82] IMPLICIT NULL }
 */
function buildMMSIdentifyRequest(invokeId: number): Uint8Array {
  const invokeID = berInteger(invokeId);
  // Identify is context tag [82] IMPLICIT primitive (no parameters)
  // For high tags (>=31), BER uses multi-byte tag encoding.
  // Context [82] primitive: class=context(10), primitive(0), tag=82
  // Since 82 >= 31, use long form: first byte = 0x9F (10 0 11111), second byte = 0x52 (82)
  // Identify takes no arguments, so length is 0
  const identifyTag = new Uint8Array([0x9F, 0x52, 0x00]); // context [82] primitive, length 0

  const body = concat(invokeID, identifyTag);
  return berTLV(0xA0, body); // confirmedRequestPDU
}

/**
 * Build an MMS Confirmed-Request PDU for GetNameList (service tag [1]).
 *
 * GetNameList-Request: context tag [1] IMPLICIT SEQUENCE {
 *   objectClass   [0] CHOICE { ... }  -- 0=namedVariable, 9=domain
 *   objectScope   [1] CHOICE { vmdSpecific [0] NULL | domainSpecific [1] Identifier }
 *   continueAfter [2] Identifier OPTIONAL
 * }
 */
function buildMMSGetNameListRequest(
  invokeId: number,
  objectClass: 'namedVariable' | 'domain' = 'namedVariable',
  domainId?: string,
  continueAfter?: string,
): Uint8Array {
  const invokeID = berInteger(invokeId);

  // objectClass [0]: basicObjectClass CHOICE encoded as context [0]
  // namedVariable = 0, domain = 9
  const classValue = objectClass === 'domain' ? 9 : 0;
  const objectClassInner = berContextInteger(0, classValue);
  const objectClassField = berContextConstructed(0, objectClassInner);

  // objectScope [1]: vmdSpecific [0] NULL or domainSpecific [1] Identifier
  let objectScopeInner: Uint8Array;
  if (domainId) {
    objectScopeInner = berVisibleString(0x81, domainId); // domainSpecific [1] VisibleString
  } else {
    objectScopeInner = new Uint8Array([0x80, 0x00]); // vmdSpecific [0] NULL
  }
  const objectScopeField = berContextConstructed(1, objectScopeInner);

  let gnlContent = concat(objectClassField, objectScopeField);

  if (continueAfter) {
    gnlContent = concat(gnlContent, berVisibleString(0x82, continueAfter));
  }

  // GetNameList-Request is context [1] IMPLICIT SEQUENCE in confirmedServiceRequest
  const gnlRequest = berContextConstructed(1, gnlContent);

  const body = concat(invokeID, gnlRequest);
  return berTLV(0xA0, body); // confirmedRequestPDU
}

/**
 * Build an MMS Confirmed-Request PDU for Read (service tag [4]).
 *
 * Read-Request: context [4] IMPLICIT SEQUENCE {
 *   specificationWithResult [0] IMPLICIT BOOLEAN DEFAULT FALSE,
 *   variableAccessSpecification CHOICE {
 *     listOfVariable [0] IMPLICIT SEQUENCE OF SEQUENCE {
 *       variableSpecification CHOICE {
 *         name [0] ObjectName
 *       }
 *     }
 *   }
 * }
 *
 * ObjectName ::= CHOICE {
 *   vmd-specific     [0] Identifier,
 *   domain-specific  [1] SEQUENCE { domainId Identifier, itemId Identifier },
 *   aa-specific      [2] Identifier
 * }
 */
function buildMMSReadRequest(invokeId: number, variableName: string, domainId?: string): Uint8Array {
  const invokeID = berInteger(invokeId);

  // Build ObjectName
  let objectName: Uint8Array;
  if (domainId) {
    // domain-specific [1] SEQUENCE { domainId, itemId }
    const domIdStr = berVisibleString(0x1A, domainId); // VisibleString tag=0x1A
    const itemIdStr = berVisibleString(0x1A, variableName);
    objectName = berContextConstructed(1, concat(domIdStr, itemIdStr));
  } else {
    // vmd-specific [0] VisibleString
    objectName = berVisibleString(0x80, variableName);
  }

  // variableSpecification: name [0]
  const varSpec = berContextConstructed(0, objectName);

  // SEQUENCE { variableSpecification }
  const varEntry = berTLV(0x30, varSpec);

  // listOfVariable [0] IMPLICIT SEQUENCE OF
  const listOfVar = berContextConstructed(0, varEntry);

  // Read-Request: context [4] IMPLICIT SEQUENCE
  const readContent = listOfVar; // specificationWithResult defaults to FALSE, omitted
  const readRequest = berContextConstructed(4, readContent);

  const body = concat(invokeID, readRequest);
  return berTLV(0xA0, body); // confirmedRequestPDU
}

// ---------------------------------------------------------------------------
// MMS PDU parsers
// ---------------------------------------------------------------------------

interface MMSInitiateResponse {
  version?: number;
  maxPduSize?: number;
  maxServOutstandingCalling?: number;
  maxServOutstandingCalled?: number;
  servicesSupportedCalled?: string[];
}

/** Parse MMS Initiate-Response PDU (tag 0xA9). */
function parseMMSInitiateResponse(data: Uint8Array): MMSInitiateResponse | null {
  const outer = berDecode(data, 0);
  if (!outer || outer.tag !== 0xA9) return null; // Not an Initiate-Response

  const result: MMSInitiateResponse = {};
  let off = 0;
  const buf = outer.value;

  while (off < buf.length) {
    const tlv = berDecode(buf, off);
    if (!tlv) break;
    off = tlv.next;

    switch (tlv.tag) {
      case 0x80: // [0] localDetailCalled — max PDU size
        result.maxPduSize = berDecodeInteger(tlv.value);
        break;
      case 0x81: // [1] maxServOutstandingCalling
        result.maxServOutstandingCalling = berDecodeInteger(tlv.value);
        break;
      case 0x82: // [2] maxServOutstandingCalled
        result.maxServOutstandingCalled = berDecodeInteger(tlv.value);
        break;
      case 0xA4: { // [4] mmsInitResponseDetail
        let dOff = 0;
        while (dOff < tlv.value.length) {
          const inner = berDecode(tlv.value, dOff);
          if (!inner) break;
          dOff = inner.next;
          switch (inner.tag) {
            case 0x80: // [0] negotiatedVersionNumber
              result.version = berDecodeInteger(inner.value);
              break;
            case 0x82: { // [2] servicesSupportedCalled BIT STRING
              const bits = berDecodeBitString(inner.value);
              result.servicesSupportedCalled = bits
                .map(b => MMS_SERVICES[b] || `service-${b}`)
                .filter(Boolean);
              break;
            }
          }
        }
        break;
      }
    }
  }

  return result;
}

interface MMSIdentifyResponse {
  vendorName?: string;
  modelName?: string;
  revision?: string;
}

/** Parse MMS Confirmed-Response PDU containing an Identify response. */
function parseMMSConfirmedResponse(data: Uint8Array): {
  invokeId: number;
  serviceTag: number;
  serviceValue: Uint8Array;
} | null {
  const outer = berDecode(data, 0);
  if (!outer || outer.tag !== 0xA1) return null; // Not confirmed-ResponsePDU

  let invokeId = 0;
  let serviceTag = 0;
  let serviceValue = new Uint8Array(0);

  let off = 0;
  while (off < outer.value.length) {
    const tlv = berDecode(outer.value, off);
    if (!tlv) break;
    off = tlv.next;

    if (tlv.tag === 0x02) {
      // invokeID INTEGER
      invokeId = berDecodeInteger(tlv.value);
    } else if (tlv.tag >= 0x80) {
      // confirmedServiceResponse CHOICE — the tag tells us which service
      serviceTag = tlv.tag;
      serviceValue = tlv.value as Uint8Array<ArrayBuffer>;
    }
  }

  return { invokeId, serviceTag, serviceValue };
}

/** Parse an Identify response (service [82]). Tag = 0xBF52 or context-constructed. */
function parseMMSIdentifyResponse(pdu: Uint8Array): MMSIdentifyResponse | null {
  const resp = parseMMSConfirmedResponse(pdu);
  if (!resp) return null;

  // Identify response tag: could be various encodings depending on the implementation
  // For high-tag context [82]: 0xBF 0x52 in the outer, but we already decoded it
  // in parseMMSConfirmedResponse. The serviceValue is the SEQUENCE content.

  const result: MMSIdentifyResponse = {};
  let off = 0;
  const buf = resp.serviceValue;

  // Identify-Response ::= SEQUENCE { vendorName, modelName, revision }
  // These are VisibleStrings in order
  const fields: Array<keyof MMSIdentifyResponse> = ['vendorName', 'modelName', 'revision'];
  for (const field of fields) {
    const tlv = berDecode(buf, off);
    if (!tlv) break;
    off = tlv.next;
    result[field] = berDecodeString(tlv.value);
  }

  return result;
}

interface MMSGetNameListResponse {
  names: string[];
  moreFollows: boolean;
}

/** Parse a GetNameList response. */
function parseMMSGetNameListResponse(pdu: Uint8Array): MMSGetNameListResponse | null {
  const resp = parseMMSConfirmedResponse(pdu);
  if (!resp) return null;

  const result: MMSGetNameListResponse = { names: [], moreFollows: false };
  let off = 0;
  const buf = resp.serviceValue;

  while (off < buf.length) {
    const tlv = berDecode(buf, off);
    if (!tlv) break;
    off = tlv.next;

    if (tlv.tag === 0xA0) {
      // [0] listOfIdentifier — SEQUENCE OF Identifier
      let innerOff = 0;
      while (innerOff < tlv.value.length) {
        const nameTlv = berDecode(tlv.value, innerOff);
        if (!nameTlv) break;
        innerOff = nameTlv.next;
        result.names.push(berDecodeString(nameTlv.value));
      }
    } else if (tlv.tag === 0x81) {
      // [1] moreFollows BOOLEAN
      result.moreFollows = tlv.value.length > 0 && tlv.value[0] !== 0;
    }
  }

  return result;
}

/** Parse an MMS Read response to extract data values. */
function parseMMSReadResponse(pdu: Uint8Array): {
  success: boolean;
  values: Array<{ type: string; value: string | number | boolean | null; raw: string }>;
  error?: string;
} | null {
  const resp = parseMMSConfirmedResponse(pdu);
  if (!resp) return null;

  const values: Array<{ type: string; value: string | number | boolean | null; raw: string }> = [];
  let off = 0;
  const buf = resp.serviceValue;

  // Read-Response: [0] listOfAccessResult SEQUENCE OF AccessResult
  while (off < buf.length) {
    const tlv = berDecode(buf, off);
    if (!tlv) break;
    off = tlv.next;

    if (tlv.tag === 0xA0) {
      // listOfAccessResult
      let innerOff = 0;
      while (innerOff < tlv.value.length) {
        const accessResult = berDecode(tlv.value, innerOff);
        if (!accessResult) break;
        innerOff = accessResult.next;

        if (accessResult.tag === 0xA1) {
          // success: Data CHOICE
          const dataItem = berDecode(accessResult.value, 0);
          if (dataItem) {
            const rawHex = Array.from(dataItem.value).map(b => b.toString(16).padStart(2, '0')).join(' ');
            const entry = parseMMSDataValue(dataItem.tag, dataItem.value);
            entry.raw = rawHex;
            values.push(entry);
          }
        } else if (accessResult.tag === 0x80) {
          // failure: DataAccessError
          values.push({
            type: 'error',
            value: `DataAccessError(${berDecodeInteger(accessResult.value)})`,
            raw: Array.from(accessResult.value).map(b => b.toString(16).padStart(2, '0')).join(' '),
          });
        }
      }
    }
  }

  return { success: values.length > 0, values };
}

/** Parse an MMS Data value (from Read response). */
function parseMMSDataValue(tag: number, value: Uint8Array): { type: string; value: string | number | boolean | null; raw: string } {
  switch (tag) {
    case 0x83: // boolean [3]
      return { type: 'boolean', value: value.length > 0 && value[0] !== 0, raw: '' };
    case 0x84: // bit-string [4]
      return { type: 'bit-string', value: Array.from(value).map(b => b.toString(2).padStart(8, '0')).join(''), raw: '' };
    case 0x85: // integer [5]
      return { type: 'integer', value: berDecodeInteger(value), raw: '' };
    case 0x86: // unsigned [6]
      return { type: 'unsigned', value: berDecodeInteger(value), raw: '' };
    case 0x87: { // floating-point [7] — IEEE 754
      if (value.length >= 5) {
        // First byte is exponent width, remaining 4 bytes are the float
        const buf = new ArrayBuffer(4);
        const view = new DataView(buf);
        for (let i = 0; i < 4; i++) view.setUint8(i, value[1 + i]);
        return { type: 'float', value: view.getFloat32(0, false), raw: '' };
      }
      return { type: 'float', value: null, raw: '' };
    }
    case 0x89: // octet-string [9]
      return { type: 'octet-string', value: Array.from(value).map(b => b.toString(16).padStart(2, '0')).join(' '), raw: '' };
    case 0x8A: // visible-string [10]
      return { type: 'visible-string', value: berDecodeString(value), raw: '' };
    case 0x8C: // utc-time [12]
      return { type: 'utc-time', value: parseMMSUtcTime(value), raw: '' };
    case 0x91: // mms-string [17] (UTF-8)
      return { type: 'mms-string', value: berDecodeString(value), raw: '' };
    case 0xA2: // structure [2] constructed
      return { type: 'structure', value: `{${value.length} bytes}`, raw: '' };
    case 0xA1: // array [1] constructed
      return { type: 'array', value: `[${value.length} bytes]`, raw: '' };
    default:
      return { type: `tag-0x${tag.toString(16)}`, value: null, raw: '' };
  }
}

/** Parse MMS UTC time (12 bytes: seconds since epoch + fraction + quality). */
function parseMMSUtcTime(value: Uint8Array): string {
  if (value.length < 8) return 'invalid';
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  const seconds = view.getUint32(0, false); // big-endian
  const fraction = view.getUint32(4, false);
  const ms = Math.floor((fraction / 0xFFFFFFFF) * 1000);
  const d = new Date(seconds * 1000 + ms);
  return d.toISOString();
}

/** Check if a PDU is an MMS error/reject response. */
function parseMMSError(data: Uint8Array): string | null {
  const outer = berDecode(data, 0);
  if (!outer) return null;

  // confirmed-ErrorPDU [2] or reject-PDU [4]
  if (outer.tag === 0xA2) {
    // Try to extract error class and code
    let off = 0;
    while (off < outer.value.length) {
      const tlv = berDecode(outer.value, off);
      if (!tlv) break;
      off = tlv.next;
      if (tlv.tag === 0x02) continue; // invokeId
      // serviceError
      return `MMS confirmed error (${outer.value.length} bytes)`;
    }
    return 'MMS confirmed error';
  }
  if (outer.tag === 0xA4) {
    return 'MMS reject PDU';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Socket I/O helpers
// ---------------------------------------------------------------------------

/**
 * Read a complete TPKT packet from the stream.
 * TPKT: [version(1)][reserved(1)][length(2 BE)]
 * Returns the complete packet including TPKT header.
 */
async function readTPKT(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<Uint8Array> {
  let buffer = new Uint8Array(0);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // Need at least 4 bytes for TPKT header
    if (buffer.length >= 4) {
      // TPKT length is big-endian 16-bit unsigned
      const pktLen = ((buffer[2] & 0xFF) << 8) | (buffer[3] & 0xFF);
      if (pktLen >= 4 && buffer.length >= pktLen) {
        return buffer.subarray(0, pktLen);
      }
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    const result = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), remaining),
      ),
    ]);

    if (result.done || !result.value) break;
    const newBuf = new Uint8Array(buffer.length + result.value.length);
    newBuf.set(buffer);
    newBuf.set(result.value, buffer.length);
    buffer = newBuf;
  }

  return buffer;
}

/**
 * Extract the COTP payload from a TPKT packet.
 * Returns the COTP TPDU starting after the TPKT header.
 */
function extractCOTP(tpkt: Uint8Array): { code: number; payload: Uint8Array } | null {
  if (tpkt.length < 5) return null;
  // TPKT header is 4 bytes, then COTP starts
  const cotpStart = 4;
  const li = tpkt[cotpStart]; // length indicator
  if (cotpStart + 1 + li > tpkt.length) return null;
  const code = tpkt[cotpStart + 1] & 0xF0; // High nibble is TPDU code
  // Payload (MMS PDU) follows the COTP header
  const payloadStart = cotpStart + 1 + li;
  const payload = tpkt.subarray(payloadStart);
  return { code, payload };
}

/**
 * Parse TSAP parameters from a COTP CC (Connection Confirm) variable part.
 * Returns the source and destination references from the COTP CC.
 */
function parseCOTPCC(tpkt: Uint8Array): { dstRef: number; srcRef: number; tpduCode: number } | null {
  if (tpkt.length < 11) return null;
  const cotpStart = 4;
  const code = tpkt[cotpStart + 1] & 0xF0;
  if (code !== 0xD0) return null; // Not a CC

  const dstRef = (tpkt[cotpStart + 2] << 8) | tpkt[cotpStart + 3];
  const srcRef = (tpkt[cotpStart + 4] << 8) | tpkt[cotpStart + 5];
  return { dstRef, srcRef, tpduCode: code };
}

/** Convert a hex TSAP string like "0001" to bytes. */
function tsapHexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s/g, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Format bytes as hex string for diagnostics. */
function toHex(data: Uint8Array, maxBytes = 64): string {
  const hex = Array.from(data.subarray(0, maxBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ');
  return data.length > maxBytes ? hex + '...' : hex;
}

// ---------------------------------------------------------------------------
// API handler: POST /api/mms/probe
// ---------------------------------------------------------------------------

/**
 * Probe an MMS server: COTP connect + MMS Initiate + Identify (VMD).
 *
 * POST /api/mms/probe
 * Body: { host, port?, timeout?, callingTSAP?, calledTSAP? }
 *
 * Default TSAPs: callingTSAP=0001, calledTSAP=0001 (common for IEC 61850 servers)
 */
export async function handleMMSProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as MMSRequest;
    const { host, port = 102, timeout = 15000 } = body;
    const callingTSAP = body.callingTSAP || '0001';
    const calledTSAP = body.calledTSAP || '0001';

    if (!host) {
      return Response.json(
        { success: false, host: '', port, error: 'Host is required' } satisfies MMSProbeResponse,
        { status: 400 },
      );
    }
    if (port < 1 || port > 65535) {
      return Response.json(
        { success: false, host, port, error: 'Port must be between 1 and 65535' } satisfies MMSProbeResponse,
        { status: 400 },
      );
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return Response.json(
        { success: false, host, port, error: getCloudflareErrorMessage(host, cfCheck.ip) },
        { status: 403 },
      );
    }

    const start = Date.now();
    const socket = connect(`${host}:${port}`);
    const tp = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout));

    try {
      await Promise.race([socket.opened, tp]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Phase 1: COTP Connection Request (CR)
      const crTPDU = buildCOTPConnectionRequest(
        0x0001,
        tsapHexToBytes(callingTSAP),
        tsapHexToBytes(calledTSAP),
      );
      await writer.write(wrapTPKT(crTPDU));

      // Read COTP Connection Confirm (CC)
      const ccPkt = await Promise.race([readTPKT(reader, Math.min(timeout, 8000)), tp]);
      const cc = parseCOTPCC(ccPkt);
      if (!cc) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        const cotp = extractCOTP(ccPkt);
        return Response.json({
          success: false, host, port,
          error: cotp ? `COTP rejected (code 0x${cotp.code.toString(16)})` : 'No COTP Connection Confirm received',
          rtt: Date.now() - start,
          rawHex: toHex(ccPkt),
        } as MMSProbeResponse);
      }

      // Phase 2: MMS Initiate-Request (over COTP DT)
      const initReq = buildMMSInitiateRequest();
      await writer.write(wrapTPKT(buildCOTPData(initReq)));

      // Read MMS Initiate-Response
      const initPkt = await Promise.race([readTPKT(reader, Math.min(timeout, 8000)), tp]);
      const initCOTP = extractCOTP(initPkt);
      let initResp: MMSInitiateResponse | null = null;

      if (initCOTP && initCOTP.code === 0xF0 && initCOTP.payload.length > 0) {
        initResp = parseMMSInitiateResponse(initCOTP.payload);
      }

      if (!initResp) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return Response.json({
          success: false, host, port,
          cotpConnected: true,
          error: 'MMS Initiate failed (no valid Initiate-Response)',
          rtt: Date.now() - start,
          rawHex: toHex(initPkt),
        } as MMSProbeResponse);
      }

      // Phase 3: MMS Identify (VMD support)
      const identReq = buildMMSIdentifyRequest(1);
      await writer.write(wrapTPKT(buildCOTPData(identReq)));

      const identPkt = await Promise.race([readTPKT(reader, Math.min(timeout, 8000)), tp]);
      const identCOTP = extractCOTP(identPkt);
      let identResp: MMSIdentifyResponse | null = null;

      if (identCOTP && identCOTP.code === 0xF0 && identCOTP.payload.length > 0) {
        identResp = parseMMSIdentifyResponse(identCOTP.payload);
      }

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const rtt = Date.now() - start;

      return Response.json({
        success: true,
        host,
        port,
        rtt,
        cotpConnected: true,
        mmsInitiated: true,
        mmsVersion: initResp.version,
        maxPduSize: initResp.maxPduSize,
        maxServOutstandingCalling: initResp.maxServOutstandingCalling,
        maxServOutstandingCalled: initResp.maxServOutstandingCalled,
        servicesSupportedCalled: initResp.servicesSupportedCalled,
        vendorName: identResp?.vendorName,
        modelName: identResp?.modelName,
        revision: identResp?.revision,
      } satisfies MMSProbeResponse);

    } catch (error) {
      socket.close();
      throw error;
    }

  } catch (error) {
    return Response.json({
      success: false, host: '', port: 102,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies MMSProbeResponse, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// API handler: POST /api/mms/namelist
// ---------------------------------------------------------------------------

/**
 * Retrieve named variables or domains from an MMS server via GetNameList.
 *
 * POST /api/mms/namelist
 * Body: { host, port?, timeout?, callingTSAP?, calledTSAP?, objectClass?, domainId?, continueAfter? }
 */
export async function handleMMSNameList(request: Request): Promise<Response> {
  try {
    const body = await request.json() as MMSNameListRequest;
    const { host, port = 102, timeout = 15000 } = body;
    const callingTSAP = body.callingTSAP || '0001';
    const calledTSAP = body.calledTSAP || '0001';
    const objectClass = body.objectClass || 'namedVariable';
    const { domainId, continueAfter } = body;

    if (!host) {
      return Response.json({ success: false, error: 'Host is required' }, { status: 400 });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return Response.json(
        { success: false, error: getCloudflareErrorMessage(host, cfCheck.ip) },
        { status: 403 },
      );
    }

    const start = Date.now();
    const socket = connect(`${host}:${port}`);
    const tp = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout));

    try {
      await Promise.race([socket.opened, tp]);
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // COTP Connect
      const crTPDU = buildCOTPConnectionRequest(0x0002, tsapHexToBytes(callingTSAP), tsapHexToBytes(calledTSAP));
      await writer.write(wrapTPKT(crTPDU));
      const ccPkt = await Promise.race([readTPKT(reader, 8000), tp]);
      if (!parseCOTPCC(ccPkt)) {
        writer.releaseLock(); reader.releaseLock(); socket.close();
        return Response.json({ success: false, host, port, error: 'COTP connection failed' });
      }

      // MMS Initiate
      await writer.write(wrapTPKT(buildCOTPData(buildMMSInitiateRequest())));
      const initPkt = await Promise.race([readTPKT(reader, 8000), tp]);
      const initCOTP = extractCOTP(initPkt);
      if (!initCOTP || initCOTP.code !== 0xF0 || !parseMMSInitiateResponse(initCOTP.payload)) {
        writer.releaseLock(); reader.releaseLock(); socket.close();
        return Response.json({ success: false, host, port, error: 'MMS Initiate failed' });
      }

      // MMS GetNameList
      const gnlReq = buildMMSGetNameListRequest(1, objectClass, domainId, continueAfter);
      await writer.write(wrapTPKT(buildCOTPData(gnlReq)));

      const gnlPkt = await Promise.race([readTPKT(reader, 8000), tp]);
      const gnlCOTP = extractCOTP(gnlPkt);

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const rtt = Date.now() - start;

      if (gnlCOTP && gnlCOTP.code === 0xF0 && gnlCOTP.payload.length > 0) {
        // Check for MMS error
        const mmsError = parseMMSError(gnlCOTP.payload);
        if (mmsError) {
          return Response.json({
            success: false, host, port, rtt, error: mmsError,
            rawHex: toHex(gnlCOTP.payload),
          });
        }

        const gnlResp = parseMMSGetNameListResponse(gnlCOTP.payload);
        if (gnlResp) {
          return Response.json({
            success: true, host, port, rtt, objectClass, domainId,
            names: gnlResp.names,
            count: gnlResp.names.length,
            moreFollows: gnlResp.moreFollows,
          });
        }
      }

      return Response.json({
        success: false, host, port, rtt,
        error: 'No valid GetNameList response received',
        rawHex: gnlCOTP ? toHex(gnlCOTP.payload) : undefined,
      });

    } catch (error) {
      socket.close();
      throw error;
    }

  } catch (error) {
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// API handler: POST /api/mms/read
// ---------------------------------------------------------------------------

/**
 * Read a named variable from an MMS server.
 *
 * POST /api/mms/read
 * Body: { host, port?, timeout?, callingTSAP?, calledTSAP?, domainId?, variableName }
 */
export async function handleMMSRead(request: Request): Promise<Response> {
  try {
    const body = await request.json() as MMSReadRequest;
    const { host, port = 102, timeout = 15000, variableName } = body;
    const callingTSAP = body.callingTSAP || '0001';
    const calledTSAP = body.calledTSAP || '0001';
    const { domainId } = body;

    if (!host) {
      return Response.json({ success: false, error: 'Host is required' }, { status: 400 });
    }
    if (!variableName) {
      return Response.json({ success: false, error: 'variableName is required' }, { status: 400 });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return Response.json(
        { success: false, error: getCloudflareErrorMessage(host, cfCheck.ip) },
        { status: 403 },
      );
    }

    const start = Date.now();
    const socket = connect(`${host}:${port}`);
    const tp = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout));

    try {
      await Promise.race([socket.opened, tp]);
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // COTP Connect
      const crTPDU = buildCOTPConnectionRequest(0x0003, tsapHexToBytes(callingTSAP), tsapHexToBytes(calledTSAP));
      await writer.write(wrapTPKT(crTPDU));
      const ccPkt = await Promise.race([readTPKT(reader, 8000), tp]);
      if (!parseCOTPCC(ccPkt)) {
        writer.releaseLock(); reader.releaseLock(); socket.close();
        return Response.json({ success: false, host, port, error: 'COTP connection failed' });
      }

      // MMS Initiate
      await writer.write(wrapTPKT(buildCOTPData(buildMMSInitiateRequest())));
      const initPkt = await Promise.race([readTPKT(reader, 8000), tp]);
      const initCOTP = extractCOTP(initPkt);
      if (!initCOTP || initCOTP.code !== 0xF0 || !parseMMSInitiateResponse(initCOTP.payload)) {
        writer.releaseLock(); reader.releaseLock(); socket.close();
        return Response.json({ success: false, host, port, error: 'MMS Initiate failed' });
      }

      // MMS Read
      const readReq = buildMMSReadRequest(1, variableName, domainId);
      await writer.write(wrapTPKT(buildCOTPData(readReq)));

      const readPkt = await Promise.race([readTPKT(reader, 8000), tp]);
      const readCOTP = extractCOTP(readPkt);

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const rtt = Date.now() - start;

      if (readCOTP && readCOTP.code === 0xF0 && readCOTP.payload.length > 0) {
        const mmsError = parseMMSError(readCOTP.payload);
        if (mmsError) {
          return Response.json({
            success: false, host, port, rtt, error: mmsError,
            rawHex: toHex(readCOTP.payload),
          });
        }

        const readResp = parseMMSReadResponse(readCOTP.payload);
        if (readResp) {
          return Response.json({
            success: readResp.success,
            host, port, rtt, domainId, variableName,
            values: readResp.values,
          });
        }
      }

      return Response.json({
        success: false, host, port, rtt,
        error: 'No valid Read response received',
        rawHex: readCOTP ? toHex(readCOTP.payload) : undefined,
      });

    } catch (error) {
      socket.close();
      throw error;
    }

  } catch (error) {
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// API handler: POST /api/mms/describe
// ---------------------------------------------------------------------------

/**
 * Full MMS server discovery: COTP connect + MMS Initiate + Identify + GetNameList (domains).
 *
 * POST /api/mms/describe
 * Body: { host, port?, timeout?, callingTSAP?, calledTSAP? }
 */
export async function handleMMSDescribe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as MMSRequest;
    const { host, port = 102, timeout = 15000 } = body;
    const callingTSAP = body.callingTSAP || '0001';
    const calledTSAP = body.calledTSAP || '0001';

    if (!host) {
      return Response.json({ success: false, error: 'Host is required' }, { status: 400 });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return Response.json(
        { success: false, error: getCloudflareErrorMessage(host, cfCheck.ip) },
        { status: 403 },
      );
    }

    const start = Date.now();
    const socket = connect(`${host}:${port}`);
    const tp = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout));

    try {
      await Promise.race([socket.opened, tp]);
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // COTP Connect
      const crTPDU = buildCOTPConnectionRequest(0x0004, tsapHexToBytes(callingTSAP), tsapHexToBytes(calledTSAP));
      await writer.write(wrapTPKT(crTPDU));
      const ccPkt = await Promise.race([readTPKT(reader, 8000), tp]);
      const cc = parseCOTPCC(ccPkt);
      if (!cc) {
        writer.releaseLock(); reader.releaseLock(); socket.close();
        return Response.json({
          success: false, host, port, error: 'COTP connection failed',
          rtt: Date.now() - start,
        });
      }

      // MMS Initiate
      await writer.write(wrapTPKT(buildCOTPData(buildMMSInitiateRequest())));
      const initPkt = await Promise.race([readTPKT(reader, 8000), tp]);
      const initCOTP = extractCOTP(initPkt);
      const initResp = initCOTP && initCOTP.code === 0xF0
        ? parseMMSInitiateResponse(initCOTP.payload) : null;

      if (!initResp) {
        writer.releaseLock(); reader.releaseLock(); socket.close();
        return Response.json({
          success: false, host, port, cotpConnected: true,
          error: 'MMS Initiate failed',
          rtt: Date.now() - start,
        });
      }

      // MMS Identify
      await writer.write(wrapTPKT(buildCOTPData(buildMMSIdentifyRequest(1))));
      const identPkt = await Promise.race([readTPKT(reader, 8000), tp]);
      const identCOTP = extractCOTP(identPkt);
      const identResp = identCOTP && identCOTP.code === 0xF0
        ? parseMMSIdentifyResponse(identCOTP.payload) : null;

      // MMS GetNameList (domains at VMD scope)
      await writer.write(wrapTPKT(buildCOTPData(buildMMSGetNameListRequest(2, 'domain'))));
      const gnlPkt = await Promise.race([readTPKT(reader, 8000), tp]);
      const gnlCOTP = extractCOTP(gnlPkt);
      const gnlResp = gnlCOTP && gnlCOTP.code === 0xF0
        ? parseMMSGetNameListResponse(gnlCOTP.payload) : null;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const rtt = Date.now() - start;

      return Response.json({
        success: true,
        host,
        port,
        rtt,
        cotpConnected: true,
        mmsInitiated: true,
        mmsVersion: initResp.version,
        maxPduSize: initResp.maxPduSize,
        servicesSupportedCalled: initResp.servicesSupportedCalled,
        vendorName: identResp?.vendorName,
        modelName: identResp?.modelName,
        revision: identResp?.revision,
        domains: gnlResp?.names || [],
        domainCount: gnlResp?.names.length || 0,
        moreDomainsAvailable: gnlResp?.moreFollows || false,
      });

    } catch (error) {
      socket.close();
      throw error;
    }

  } catch (error) {
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
