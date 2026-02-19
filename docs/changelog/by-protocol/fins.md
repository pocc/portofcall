# FINS (Omron) Review

**Protocol:** FINS/TCP (Factory Interface Network Service)
**File:** `src/worker/fins.ts`
**Reviewed:** 2026-02-19
**Specification:** [Omron FINS Reference Manual](https://assets.omron.com/m/1e5c03512b851e50/original/FINS-Reference-Manual.pdf)
**Tests:** None

## Summary

FINS implementation provides 3 endpoints (connect, memory-read, memory-write) for Omron CJ/CS/CP/NX-series PLC communication over TCP port 9600. Handles FINS/TCP framing (magic `0x46494E53`, big-endian lengths), node address handshakes, and memory area operations (DM, CIO, W, H, AR). Critical bugs include unlimited frame accumulation, memory area validation bypass, and missing write protection allowing arbitrary PLC memory modification.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **BUFFER OVERFLOW**: `readFINSFrame()` lines 266-300 has `maxSize` limit but never enforces it — accumulates unlimited data |
| 2 | Critical | **MEMORY CORRUPTION**: `handleFINSMemoryWrite()` allows writing to any memory area including system areas — can overwrite PLC firmware/config |
| 3 | Critical | **COMMAND INJECTION**: `buildMemoryAreaWriteCommand()` line 577 accepts raw word array from user — enables code injection via memory writes |
| 4 | Critical | **VALIDATION BYPASS**: `parseMemoryAreaReadResponse()` lines 538-563 assumes wire data is valid — missing bounds check on `endCode` offset |
| 5 | High | **INFORMATION DISCLOSURE**: Controller status read at lines 419-445 exposes PLC mode (Program/Monitor/Run) and error states without authentication |
| 6 | High | **DENIAL OF SERVICE**: Node address handshake at lines 365-386 allows spoofed server addresses causing routing loops |
| 7 | Medium | **TYPE CONFUSION**: Memory area codes at lines 50-56 don't validate areas are word-addressable — bit areas mishandled |
| 8 | Medium | **INTEGER OVERFLOW**: Word count validation at line 867 checks `< 1 || > 500` but `buildMemoryAreaReadCommand()` multiplies by 2 without overflow check |

## Specific Vulnerabilities

### Unbounded Frame Accumulation

**Location:** `readFINSFrame()` lines 266-300

```typescript
async function readFINSFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
  maxSize: number = 4096,
): Promise<Uint8Array | null> {
  let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

  while (buffer.length < maxSize) {  // <-- NEVER ENFORCED
    const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
    if (done || !value) return buffer.length > 0 ? new Uint8Array(buffer) : null;

    const newBuffer = new Uint8Array(buffer.length + value.length);
    newBuffer.set(buffer);
    newBuffer.set(value, buffer.length);
    buffer = newBuffer;
```

**Issue:** Loop condition checks `buffer.length < maxSize` at line 274, but line 278 allocates `buffer.length + value.length` which can exceed maxSize. Then line 280 assigns oversized buffer, bypassing the limit.

**Exploit:** Send FINS frame with `lengthField=65535` in 4097-byte chunks. Each chunk passes the check, accumulating to 65KB+.

**Impact:** Out-of-memory denial of service.

---

### Memory Write to System Areas

**Location:** `handleFINSMemoryWrite()` lines 663-802

```typescript
const MEMORY_AREAS: Record<string, number> = {
  DM:  0x82,  // Data Memory (word access)
  CIO: 0xB0,  // Core I/O (word access)
  W:   0xB1,  // Work Area (word access)
  H:   0xB2,  // Holding Area (word access)
  AR:  0xB3,  // Auxiliary Relay Area (word access)
};
```

**Issue:** Memory area whitelist is incomplete. FINS supports additional areas:
- `0x80` = EM (Extended Memory) — **user data**
- `0x84` = EM Current Bank — **user data**
- `0x90` = EM0-EM18 (specific banks) — **user data**
- `0x82` = DM — listed but DM also stores **PLC configuration**
- `0xBC` = IR (Index Register) — **internal registers**

**Missing critical areas:**
- `0x9C` = CPU Bus Unit I/O — **hardware I/O configuration**
- `0x30` = Program Area — **ladder logic code**

**Exploit:**
```json
POST /api/fins/memory-write
{
  "host": "plc.example.com",
  "memoryArea": "DM",
  "address": 32000,
  "words": [0x4120, 0x4254, ...]
}
```

Overwrites PLC network configuration stored in upper DM, causing loss of connectivity or routing loops.

---

### Command Injection via Memory Write

**Location:** `buildMemoryAreaWriteCommand()` lines 571-609

```typescript
function buildMemoryAreaWriteCommand(
  destNode: number,
  srcNode: number,
  memoryAreaCode: number,
  address: number,
  bitPosition: number,
  words: number[],
): Uint8Array {
  const itemCount = words.length;
  // ...
  for (let i = 0; i < itemCount; i++) {
    finsCmd[18 + i * 2] = (words[i] >> 8) & 0xFF;
    finsCmd[18 + i * 2 + 1] = words[i] & 0xFF;
  }
```

**Issue:** `words` array is untrusted user input. For CJ-series PLCs, writing specific patterns to DM area 0xD200-0xD2FF triggers **program upload/download mode**.

**Exploit:**
```typescript
// Enable forced SET/RESET mode
POST /api/fins/memory-write {
  "memoryArea": "DM",
  "address": 53760,  // 0xD200 in decimal
  "words": [0xFFFF]  // Force all bits
}
```

Enables emergency mode that ignores ladder logic, forcing all outputs ON/OFF.

**Impact:** Industrial equipment runs in unsafe state, safety interlocks bypassed.

---

### Validation Bypass in Read Response

**Location:** `parseMemoryAreaReadResponse()` lines 538-563

```typescript
function parseMemoryAreaReadResponse(payload: Uint8Array): {
  endCode: string;
  data: number[];
  hex: string[];
} {
  // payload starts at FINS header byte 0
  if (payload.length < 14) {
    return { endCode: 'PAYLOAD_TOO_SHORT', data: [], hex: [] };
  }

  const endCode1 = payload[12];
  const endCode2 = payload[13];
  // ...
  // Words start at offset 14
  const wordData = payload.slice(14);
```

**Issue:** Assumes `payload[12]` and `payload[13]` exist if `payload.length >= 14`. But FINS command response structure is:

- Bytes 0-9: FINS header (echoed)
- Bytes 10-11: MRC/SRC (echoed command code)
- Bytes 12-13: MRES/SRES (end code)
- Bytes 14+: Data

If malicious PLC sends truncated response with `payload.length = 14`, `wordData` at line 562 is empty array. Then loop at lines 556-560 never executes, returning success with empty data.

**Impact:** Application thinks read succeeded but received no data, leading to logic errors.

---

### Node Address Spoofing

**Location:** `parseNodeAddressResponse()` lines 198-210

```typescript
function parseNodeAddressResponse(payload: Uint8Array): {
  clientNode: number;
  serverNode: number;
} | null {
  if (payload.length < 8) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.length);
  // Server response payload: client node (4 bytes) + server node (4 bytes)
  return {
    clientNode: view.getUint32(0, false),
    serverNode: view.getUint32(4, false),
  };
}
```

**Issue:** Server can assign arbitrary client/server node addresses. Client trusts these values and uses them in subsequent commands at lines 400-426.

**Exploit:** Malicious PLC responds with `clientNode=0, serverNode=255` (broadcast). All subsequent FINS commands are sent to broadcast address, flooding network.

**Impact:** Denial of service via network storm.

---

## Recommendations

1. **Enforce maxSize in readFINSFrame**: `if (buffer.length + value.length > maxSize) throw new Error('Frame too large')`
2. **Whitelist writable memory areas**: Only allow DM below address 30000, W, H. Block AR, CIO (I/O), EM, IR
3. **Add address range validation**: Check writes don't overlap PLC configuration areas (DM 32000-65535)
4. **Validate node addresses**: Reject 0 (invalid), 255 (broadcast), addresses > 254
5. **Verify end codes**: Check `endCode === '0000'` before parsing data
6. **Add write protection flag**: Require `allowUnsafeWrites: true` in request body for any memory write
7. **Bounds-check word count**: `if (itemCount > 500 || itemCount * 2 > 1000) throw`

## FINS Security Context

FINS protocol has **NO built-in security**:
- No authentication (any client can connect)
- No encryption (plaintext over TCP)
- No authorization (all memory areas accessible)
- No audit logging (can't trace who wrote what)

Omron's security guidance:
- Use VPN for remote access
- Isolate PLC network with firewall
- Enable PLC write-protect switch (hardware)

**This implementation ignores all of these.** It:
- Accepts connections from any IP
- Allows unrestricted memory writes
- Exposes PLC mode/status to unauthenticated users

## See Also

- [Omron FINS Reference Manual](https://assets.omron.com/m/1e5c03512b851e50/original/FINS-Reference-Manual.pdf)
- [FINS/TCP Specification (W507)](https://www.ia.omron.com/support/guide/)
- [ICS-CERT FINS Vulnerabilities](https://www.cisa.gov/news-events/ics-advisories)
