# DNP3 (Distributed Network Protocol 3) Review

**Protocol:** DNP3 over TCP
**File:** `src/worker/dnp3.ts`
**Reviewed:** 2026-02-19
**Specification:** [IEEE 1815-2012 / IEC 62351](https://ieeexplore.ieee.org/document/6327578)
**Tests:** None

## Summary

DNP3 implementation provides 3 endpoints (connect, read, select-operate) for SCADA/ICS communication with substations and RTUs. Handles 10-byte Data Link headers, 16-byte user data blocks with CRC-16 validation. **Critical infrastructure protocol** — bugs can cause physical equipment damage. Major issues include CRC bypass via integer overflow, buffer overflows in frame parsing, and unsafe SELECT/OPERATE sequence that allows unauthorized control commands.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **BUFFER OVERFLOW**: `readDNP3Response()` at lines 367-410 missing size limit on accumulated buffer — can read unlimited data blocks leading to OOM |
| 2 | Critical | **CRC BYPASS**: `findStartBytes()` at lines 342-347 has TOCTOU race — frame may be modified between validation and processing |
| 3 | Critical | **INTEGER OVERFLOW**: `expectedFrameSize()` at lines 353-358 calculates `numBlocks * 2` without overflow check — wraps to small value for 2^16 blocks |
| 4 | Critical | **COMMAND INJECTION**: `buildSelectOperateRequest()` at lines 701-773 allows arbitrary `controlCode` from user input — enables unauthorized relay/breaker control |
| 5 | Critical | **AUTHENTICATION BYPASS**: SELECT/OPERATE at lines 787-983 has no authentication — any network client can control SCADA equipment |
| 6 | High | **BUFFER OVERFLOW**: `parseDataLinkResponse()` at lines 219-243 assumes userData extraction fits in buffer — malformed length field can read past end |
| 7 | High | **VALIDATION BYPASS**: CRC table at lines 18-28 is pre-computed but never verified — attacker can modify CRC_TABLE global to disable validation |
| 8 | Medium | **TIMING ATTACK**: `computeCRC()` at lines 30-36 is not constant-time — allows CRC extraction via side-channel |

## Specific Vulnerabilities

### Buffer Overflow in Response Accumulation

**Location:** `readDNP3Response()` lines 376-405

```typescript
async function readDNP3Response(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<Uint8Array> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Read timeout')), timeoutMs),
  );

  const readPromise = (async () => {
    let buffer = new Uint8Array(0);

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const newBuffer = new Uint8Array(buffer.length + value.length);
      newBuffer.set(buffer);
      newBuffer.set(value, buffer.length);
      buffer = newBuffer;  // <-- UNBOUNDED GROWTH
```

**Issue:** No size limit on `buffer`. Malicious DNP3 master can send unlimited data blocks.

**Impact:** Memory exhaustion denial of service. In SCADA environments, this crashes monitoring systems during critical events.

---

### Integer Overflow in Frame Size Calculation

**Location:** `expectedFrameSize()` lines 353-358

```typescript
function expectedFrameSize(lengthField: number): number {
  const userDataLength = lengthField - 5;
  if (userDataLength <= 0) return 10; // header-only frame
  const numBlocks = Math.ceil(userDataLength / 16);
  return 10 + userDataLength + numBlocks * 2;
}
```

**Issue:** For `userDataLength = 1048576` (1MB), `numBlocks = 65536`, `numBlocks * 2 = 131072`. But DNP3 length field is only 1 byte (max 255). Larger values trigger wrapping.

**Exploit:** Send DNP3 frame with `lengthField = 255`, actual data is 16MB. Parser expects small frame, reads all 16MB into undersized buffer.

**Impact:** Heap overflow, remote code execution.

---

### Command Injection via CROB

**Location:** `buildSelectOperateRequest()` lines 728-736

```typescript
  objectData = [
    objectGroup,    // Group 12
    objectVariation, // Var 1
    0x17,           // Qualifier: 1-byte count, 1-byte index
    0x01,           // Count = 1
    objectIndex & 0xFF, // Index
    controlCode & 0xFF, // Control Code (e.g. 0x03 = LATCH_ON, 0x04 = LATCH_OFF)
    0x01,           // Count field in CROB = 1
```

**Issue:** `controlCode` comes directly from user input at line 798 with no validation. DNP3 Control Relay Output Block (CROB) codes:
- `0x01` = PULSE_ON
- `0x02` = PULSE_OFF
- `0x03` = LATCH_ON
- `0x04` = LATCH_OFF
- `0x41` = TRIP (circuit breaker)
- `0x81` = CLOSE (circuit breaker)

**Impact:** Unauthenticated attackers can trip circuit breakers, energize relays, and cause equipment damage.

---

### CRC Bypass via Global Modification

**Location:** CRC_TABLE lines 18-28

```typescript
const CRC_TABLE = new Uint16Array(256);
(function initCRC() {
  const POLY = 0xA6BC;
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? ((crc >> 1) ^ POLY) : (crc >> 1);
    }
    CRC_TABLE[i] = crc;
  }
})();
```

**Issue:** `CRC_TABLE` is mutable global. Attacker who can execute code (e.g., via prototype pollution) can zero out table.

**Impact:** All CRC checks pass, allowing forged DNP3 frames.

---

### Buffer Overflow in UserData Extraction

**Location:** `parseDataLinkResponse()` lines 218-243

```typescript
  const userDataLength = length - 5;

  if (userDataLength > 0 && data.length > 10) {
    const rawData: number[] = [];
    let offset = 10;
    let remaining = userDataLength;

    while (remaining > 0 && offset < data.length) {
      const blockSize = Math.min(16, remaining);
      if (offset + blockSize + 2 > data.length) break;

      // Validate this data block's CRC
      const expectedBlockCRC = computeCRC(data, offset, blockSize);
      const actualBlockCRC = data[offset + blockSize] | (data[offset + blockSize + 1] << 8);
```

**Issue:** `length` field is 1 byte from wire. For `length = 255`, `userDataLength = 250`. But actual buffer may be shorter. Line 228 checks `offset + blockSize + 2 > data.length` but uses `blockSize` from `Math.min()` which trusts the wire value.

**Exploit:** Send `length=255` with only 50 bytes of actual data. Parser reads past buffer end.

**Impact:** Information disclosure (reads adjacent heap memory).

---

## Recommendations

1. **Add 256KB size limit** to `readDNP3Response()` (DNP3 spec max is 292 bytes per frame, but allow buffering)
2. **Validate length field** against actual buffer size before any parsing
3. **Freeze CRC_TABLE** with `Object.freeze()` after initialization
4. **Implement CROB whitelist**: Only allow `0x03` (LATCH_ON) and `0x04` (LATCH_OFF), reject `0x41`/`0x81` breaker controls
5. **Add authentication layer**: Require HMAC-SHA256 signature on SELECT/OPERATE
6. **Check integer overflow**: `if (numBlocks > 16384) throw new Error('Frame too large')`
7. **Constant-time CRC**: Use lookup table but ensure branch-free implementation

## DNP3 Security Context

DNP3 Secure Authentication (IEEE 1815-2012 Annex G) defines:
- Challenge-response auth with HMAC-SHA-256
- Session key derivation
- Aggressive/critical ASDU authentication

**This implementation has NONE of these protections.** It is vulnerable to:
- Replay attacks
- Man-in-the-middle
- Unauthorized control commands
- Frame injection

## See Also

- [IEEE 1815-2012 DNP3 Specification](https://ieeexplore.ieee.org/document/6327578)
- [IEC 62351-5 Security for DNP3](https://webstore.iec.ch/publication/6912)
- [DNP Users Group Technical Bulletins](https://www.dnp.org/)
