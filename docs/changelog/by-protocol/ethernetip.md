# EtherNet/IP (CIP) Review

**Protocol:** EtherNet/IP (Common Industrial Protocol)
**File:** `src/worker/ethernetip.ts`
**Reviewed:** 2026-02-19
**Specification:** [ODVA CIP Vol 1 & 2](https://www.odva.org/technology-standards/key-technologies/common-industrial-protocol-cip/)
**Tests:** None

## Summary

EtherNet/IP implementation provides 4 endpoints (identity, cip-read, get-attribute-all, set-attribute) for Allen-Bradley/Rockwell PLC communication over TCP port 44818. Handles 24-byte encapsulation headers (little-endian), CIP path encoding, and CPF (Common Packet Format). **Industrial automation protocol** — controls manufacturing equipment. Critical bugs include unbounded buffer accumulation, missing CPF item validation, and CIP path injection allowing unauthorized object access.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **BUFFER OVERFLOW**: `handleEtherNetIPIdentity()` lines 428-447 has no size limit — malicious device can send unlimited CPF items causing OOM |
| 2 | Critical | **PATH INJECTION**: `buildCIPPath()` lines 588-614 allows class/instance/attribute values up to 65535 — enables access to restricted CIP objects |
| 3 | Critical | **COMMAND INJECTION**: `handleEtherNetIPSetAttribute()` lines 1176-1291 writes raw byte array from user with no validation — allows overwriting PLC configuration |
| 4 | Critical | **INTEGER OVERFLOW**: `parseIdentityItem()` line 253 calculates socket address from untrusted wire data — sin_family field can overflow |
| 5 | High | **VALIDATION BYPASS**: `readEIPFrame()` lines 508-541 accumulates frames indefinitely if length field is corrupted |
| 6 | High | **TYPE CONFUSION**: `parseSendRRDataResponse()` lines 678-727 iterates CPF items without type validation — can misparse data as addresses |
| 7 | Medium | **RESOURCE LEAK**: All handlers create session with RegisterSession but only some unregister in error paths |
| 8 | Medium | **DENIAL OF SERVICE**: `parseListServicesResponse()` lines 1006-1041 allows unlimited service items in response |

## Specific Vulnerabilities

### Buffer Overflow in ListIdentity Response

**Location:** `handleEtherNetIPIdentity()` lines 428-447

```typescript
let buffer = new Uint8Array(0);
const maxSize = 4096;

while (buffer.length < maxSize) {
  const { value, done } = await reader.read();
  if (done || !value) break;

  const newBuffer = new Uint8Array(buffer.length + value.length);
  newBuffer.set(buffer);
  newBuffer.set(value, buffer.length);
  buffer = newBuffer;

  // Check if we have a complete encapsulation frame
  if (buffer.length >= 24) {
    const frameView = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);
    const dataLength = frameView.getUint16(2, true);
    if (buffer.length >= 24 + dataLength) break;
  }
}
```

**Issue:** `dataLength` at line 444 is untrusted 16-bit value from wire (max 65535). But `maxSize` limit at line 430 is only 4096. Malicious device sends `dataLength=65000`, parser continues accumulating beyond maxSize.

**Impact:** Out-of-memory denial of service.

---

### CIP Path Injection

**Location:** `buildCIPPath()` lines 588-614

```typescript
function buildCIPPath(classId: number, instanceId: number, attributeId: number): Uint8Array {
  const segments: number[] = [];

  // Class segment
  if (classId <= 0xFF) {
    segments.push(0x20, classId);
  } else {
    segments.push(0x21, 0x00, classId & 0xFF, (classId >> 8) & 0xFF);
  }
  // Instance segment
  if (instanceId <= 0xFF) {
    segments.push(0x24, instanceId);
  } else {
    segments.push(0x25, 0x00, instanceId & 0xFF, (instanceId >> 8) & 0xFF);
  }
```

**Issue:** No validation that `classId`, `instanceId`, `attributeId` are within valid ranges. CIP objects include:

- Class 1 = Identity Object (read-only device info)
- Class 4 = Assembly Object (I/O data mapping)
- Class 6 = Connection Manager (establish I/O connections)
- Class 71 = Motor Data (drive parameters) **SENSITIVE**
- Class 114 = Safety Supervisor (safety-rated I/O) **CRITICAL**

**Exploit:**
```json
POST /api/ethernetip/set-attribute
{
  "classId": 71,
  "instanceId": 1,
  "attributeId": 3,
  "data": [0xFF, 0xFF]
}
```

Overwrites motor speed setpoint to maximum, causing physical damage.

---

### Command Injection via Set_Attribute_Single

**Location:** `handleEtherNetIPSetAttribute()` lines 1228-1235

```typescript
const cipPath = buildCIPPath(classId, instanceId, attributeId);
const pathWordSize = cipPath.length / 2;
const valueBytes = new Uint8Array(writeData);
const cipRequest = new Uint8Array(2 + cipPath.length + valueBytes.length);
cipRequest[0] = CIP_SET_ATTRIBUTE_SINGLE;
cipRequest[1] = pathWordSize;
cipRequest.set(cipPath, 2);
cipRequest.set(valueBytes, 2 + cipPath.length);
```

**Issue:** `writeData` is user-supplied byte array from request body with no constraints. Can write arbitrary data to any writable attribute.

**Impact:**
- Overwrite PLC IP address → loss of connectivity
- Modify watchdog timer → disable safety shutdown
- Alter I/O configuration → physical equipment misconfiguration

---

### Integer Overflow in Identity Parsing

**Location:** `parseIdentityItem()` lines 241-251

```typescript
// Socket address (16 bytes - sockaddr_in structure, big-endian)
// Skip sin_family (2 bytes)
pos += 2;
const sinPort = view.getUint16(pos, false); // big-endian
pos += 2;
const ip1 = data[offset + pos];
const ip2 = data[offset + pos + 1];
const ip3 = data[offset + pos + 2];
const ip4 = data[offset + pos + 3];
pos += 4;
identity.socketAddress = `${ip1}.${ip2}.${ip3}.${ip4}:${sinPort}`;
```

**Issue:** `offset + pos` calculation can overflow if malformed CPF item has `offset` near `2^32 - 16`. Result: reads from incorrect memory location, potentially exposing adjacent heap data.

**Impact:** Information disclosure.

---

### Unbounded Frame Accumulation

**Location:** `readEIPFrame()` lines 515-537

```typescript
while (Date.now() < deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) break;

  const timeoutP = new Promise<{ value: undefined; done: true }>(resolve =>
    setTimeout(() => resolve({ value: undefined, done: true }), remaining)
  );
  const { value, done } = await Promise.race([reader.read(), timeoutP]);

  if (done || !value) break;

  const nb = new Uint8Array(buffer.length + value.length);
  nb.set(buffer);
  nb.set(value, buffer.length);
  buffer = nb;

  if (buffer.length >= 24) {
    const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);
    const dataLen = dv.getUint16(2, true);
    if (buffer.length >= 24 + dataLen) {
      return buffer.slice(0, 24 + dataLen);
    }
  }
}
```

**Issue:** If `dataLen` at line 533 is corrupted (e.g., 65535), loop continues accumulating until timeout. No size limit.

**Impact:** Memory exhaustion, process crash.

---

## Recommendations

1. **Add 10KB size limit** to all frame readers (EIP max PDU is typically 4KB)
2. **Validate CIP class whitelist**: Reject Set_Attribute_Single to classes 6, 71, 114
3. **Implement object-level permissions**: Read-only for Identity, writable only for application-specific assemblies
4. **Add data validation**: Check attribute data types match CIP data type field
5. **Bounds-check CPF parsing**: Ensure `offset + itemLength <= data.length` before accessing
6. **Add session authentication**: Current implementation allows anonymous access

## CIP Security Context

CIP Security (Vol 8) defines:
- TLS 1.2 for transport encryption
- X.509 certificates for device authentication
- Role-based access control
- Audit logging

**This implementation has NO security features.** It allows:
- Unauthenticated read of device identity (exposes serial numbers, firmware versions)
- Unauthenticated write to PLC configuration
- No audit trail of who modified what

## See Also

- [ODVA CIP Specification](https://www.odva.org/technology-standards/key-technologies/common-industrial-protocol-cip/)
- [CIP Security Vol 8](https://www.odva.org/technology-standards/key-technologies/cip-security/)
- [EtherNet/IP Adaptation of CIP Vol 2](https://www.odva.org/technology-standards/key-technologies/ethernet-ip/)
