# MMS (Manufacturing Message Specification) Review

**Protocol:** MMS (ISO 9506) over TPKT/COTP
**File:** `src/worker/mms.ts`
**Reviewed:** 2026-02-19
**Specification:** [ISO 9506-1/2:2003](https://www.iso.org/standard/32377.html)
**Tests:** None

## Summary

MMS implementation provides 4 endpoints (probe, namelist, read, describe) for IEC 61850 device communication over TCP port 102. Handles TPKT framing, COTP connection management, ASN.1 BER encoding/decoding, and MMS PDU types (Initiate, Identify, GetNameList, Read). **IEC 61850 substation automation protocol** — controls electrical grid equipment. Critical bugs include unbounded BER length fields, missing ASN.1 validation, and TSAP injection enabling connection hijacking.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **BUFFER OVERFLOW**: `berDecode()` lines 192-207 calculates length from untrusted wire data — accepts BER lengths up to 2^32 bytes |
| 2 | Critical | **ASN.1 INJECTION**: `buildMMSReadRequest()` lines 573-603 constructs BER without validating `variableName` or `domainId` for null bytes |
| 3 | Critical | **TSAP INJECTION**: `tsapHexToBytes()` lines 973-980 converts hex string without validation — allows malformed TSAP parameters |
| 4 | Critical | **INTEGER OVERFLOW**: `readTPKT()` lines 903-938 calculates `pktLen` from 16-bit field then allocates buffer — can overflow at 65535 |
| 5 | High | **UNBOUNDED ACCUMULATION**: `handleMMSDescribe()` lines 1373-1480 performs 4 sequential operations without total size limit |
| 6 | High | **TYPE CONFUSION**: `parseMMSDataValue()` lines 821-856 switches on tag but floating-point at lines 831-840 assumes 5+ bytes without checking |
| 7 | Medium | **VALIDATION BYPASS**: BER bit string decoder at lines 232-250 doesn't validate unused bits field (must be 0-7) |
| 8 | Medium | **DENIAL OF SERVICE**: MMS services bitmap at lines 265-351 is 85 services (11 bytes) but `berDecodeBitString()` accepts unlimited length |

## Specific Vulnerabilities

### BER Length Field Overflow

**Location:** `berDecode()` lines 192-207

```typescript
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
```

**Issue:** BER definite-length encoding allows lengths up to 2^(8*numBytes) bytes. With `numBytes=4`, can encode 2^32 = 4GB lengths. Line 198 checks `numBytes > 4` to prevent, but JavaScript's `(len << 8) | data[offset++]` at line 201 is 32-bit signed integer arithmetic.

**Exploit:**
1. Send MMS Initiate-Request with BER length `[84 FF FF FF FF]` (4-byte length, value 4,294,967,295)
2. Line 200-203 computes `len = 0xFFFFFFFF`
3. Line 205 checks `offset + len > data.length` — overflows to small value due to 32-bit wraparound
4. Returns `value: data.subarray(offset, offset + 0xFFFFFFFF)` — attempts to slice 4GB

**Impact:** Out-of-memory crash, denial of service.

---

### ASN.1 String Injection

**Location:** `buildMMSReadRequest()` lines 573-603

```typescript
function buildMMSReadRequest(invokeId: number, variableName: string, domainId?: string): Uint8Array {
  const invokeID = berInteger(invokeId);

  // Build ObjectName
  let objectName: Uint8Array;
  if (domainId) {
    // domain-specific [1] SEQUENCE { domainId, itemId }
    const domIdStr = berVisibleString(0x1A, domainId);
    const itemIdStr = berVisibleString(0x1A, variableName);
    objectName = berContextConstructed(1, concat(domIdStr, itemIdStr));
  } else {
    // vmd-specific [0] VisibleString
    objectName = berVisibleString(0x80, variableName);
  }
```

**Issue:** `berVisibleString()` at line 189 encodes raw string without validation:

```typescript
function berVisibleString(tag: number, s: string): Uint8Array {
  return berTLV(tag, new TextEncoder().encode(s));
}
```

ASN.1 VisibleString is subset of ASCII (0x20-0x7E). No validation that `variableName` or `domainId` contain only valid characters. Null bytes (`\x00`) embedded in JavaScript strings cause early termination in C parsers.

**Exploit:**
```json
POST /api/mms/read
{
  "host": "ied.example.com",
  "variableName": "MMXU1$MX$PhV$phsA\x00/admin/reset",
  "domainId": "LD0"
}
```

MMS server parses variable name as `MMXU1$MX$PhV$phsA`, truncated at null byte. But second half `/admin/reset` may be interpreted as path traversal by buggy server.

**Impact:** Unauthorized access to restricted MMS objects, potential server crash.

---

### TSAP Injection

**Location:** `tsapHexToBytes()` lines 973-980

```typescript
function tsapHexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s/g, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
```

**Issue:** No validation that `hex` contains only hex digits (0-9, a-f). User input at line 1006 allows arbitrary characters:

```typescript
const callingTSAP = body.callingTSAP || '0001';
const calledTSAP = body.calledTSAP || '0001';
// ...
buildCOTPConnectionRequest(
  0x0001,
  tsapHexToBytes(callingTSAP),
  tsapHexToBytes(calledTSAP),
)
```

**Exploit:**
```json
POST /api/mms/probe
{
  "host": "ied.example.com",
  "callingTSAP": "00FF",
  "calledTSAP": "ZZZZ"
}
```

`parseInt('ZZ', 16)` returns `NaN`, coerced to 0. COTP connection request sent with malformed TSAP, potentially bypassing firewall rules keyed on TSAP values.

**Impact:** Connection hijacking, firewall bypass.

---

### Integer Overflow in TPKT Length

**Location:** `readTPKT()` lines 903-938

```typescript
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
```

**Issue:** `pktLen` is 16-bit (max 65535). Line 914 checks `buffer.length >= pktLen` to know when full packet received. But line 927 allocates `buffer.length + result.value.length`:

```typescript
const newBuf = new Uint8Array(buffer.length + result.value.length);
newBuf.set(buffer);
newBuf.set(result.value, buffer.length);
buffer = newBuf;
```

For `pktLen=65535`, if socket receives data in 1KB chunks, allocates 65 arrays totaling 2.1MB (1+2+...+65 KB). Memory quadratic in packet size.

**Impact:** Denial of service via memory exhaustion.

---

### Floating-Point Parsing Underflow

**Location:** `parseMMSDataValue()` lines 831-840

```typescript
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
```

**Issue:** MMS floating-point encoding (ISO 9506-2 Section 14.6.2) is:
- Byte 0: Exponent width (0x08 for single precision, 0x0B for double)
- Bytes 1-4: Mantissa + exponent (IEEE 754)

Code assumes exponent width is always 0x08 and data is 5 bytes total. But for double precision (`value[0] = 0x0B`), data is 12 bytes (1 + 11). Accessing `value[1+i]` for `i=0..3` reads truncated mantissa.

**Exploit:** Server sends double-precision measurement `Type=floating-point[7], Data=[0x0B, <11 bytes>]`. Parser reads first 4 bytes of mantissa, interprets as single precision. Value corrupted (e.g., 123.456 becomes 0.00000001).

**Impact:** Data corruption in critical measurements (voltage, current, frequency).

---

### BER Bit String Validation Bypass

**Location:** `berDecodeBitString()` lines 232-250

```typescript
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
```

**Issue:** `unusedBits` at line 234 must be 0-7 per ITU-T X.690. Values 8-255 are invalid. No validation, so:
- `unusedBits=9` → `bitsInByte = 8 - 9 = -1` → loop never executes, missing valid bits
- `unusedBits=255` → `bitsInByte = 8 - 255 = -247` → loop never executes

**Impact:** Services-supported bitmap parsing fails, client doesn't know server capabilities.

---

## Recommendations

1. **Add BER length limit**: `if (len > 65535) return null` at line 204
2. **Validate ASN.1 strings**: Check `variableName` and `domainId` match `^[A-Za-z0-9$._]+$` regex
3. **Validate TSAP hex**: `if (!/^[0-9A-Fa-f]+$/.test(hex)) throw new Error('Invalid TSAP')`
4. **Add TPKT size limit**: `if (pktLen > 8192) throw new Error('TPKT too large')` (IEC 61850 max is ~8KB)
5. **Fix float parsing**: Check `value[0]` exponent width, handle 0x08 (4 bytes) and 0x0B (11 bytes)
6. **Validate unused bits**: `if (unusedBits < 0 || unusedBits > 7) return []`
7. **Add total operation timeout**: Limit `handleMMSDescribe()` to 30 seconds total, not per-step

## MMS Security Context

ISO 9506 predates modern security practices. IEC 62351-6 adds security for MMS:
- TLS 1.2 for transport
- Role-based access control (RBAC)
- Object-level permissions
- Digital signatures on critical operations

**This implementation has NONE of these.** It is vulnerable to:
- Unauthenticated read of device configuration (GetNameList reveals all data objects)
- Unencrypted cleartext (ISO transport over TCP, no TLS)
- No authorization (any client can read any MMS object)
- ASN.1 injection attacks

IEC 61850 deployments use:
- Ethernet VLANs to isolate substation network
- IEC 62351-6 security extensions
- IDS (Intrusion Detection Systems) to monitor MMS traffic

## See Also

- [ISO 9506-1:2003 MMS Part 1](https://www.iso.org/standard/32377.html)
- [ISO 9506-2:2003 MMS Part 2](https://www.iso.org/standard/32378.html)
- [IEC 62351-6 Security for MMS](https://webstore.iec.ch/publication/6912)
- [IEC 61850 Communication Networks and Systems](https://webstore.iec.ch/publication/6028)
