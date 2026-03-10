# Pass 3 & Pass 4 Protocol Review — 2026-02-23

Protocols: NFS, ActiveMQ, AFP, SNMP, Kafka
Pass 3 criteria: all remaining issues after Pass 1+2 fixes
Pass 4: targeted verification that Pass 3 fixes are complete

---

## SNMP (`src/worker/snmp.ts`)

### BUG-SNMP-P3-1 — `parseInteger` 32-bit signed truncation (CRITICAL)
**Lines:** 443–453
**Issue:** `(value << 8) | data[i]` is bitwise, truncates to signed 32-bit. COUNTER32 values ≥ 2^23 wrap negative.
**Fix:** Changed to arithmetic: `value = value * 256 + data[i]`

### BUG-SNMP-P3-2 — `parseOID` truncated arc silently produces wrong value (HIGH)
**Lines:** 477–505
**Issue:** If a multi-byte arc ends with a continuation byte at the data boundary, the partial accumulated value was pushed without error.
**Fix:** Added `foundTerminator` flag; throws `'OID parse: truncated multi-byte arc'` on truncated data.

### BUG-SNMP-P3-3 — `readSNMPResponse` unbounded allocation (MEDIUM)
**Lines:** 423–426
**Issue:** `expectedSize` had no cap; a malicious agent could claim 4 GB causing Worker OOM.
**Fix:** Added `MAX_SNMP_RESPONSE = 1_048_576` (1 MB) check; throws if exceeded.

### BUG-SNMP-P3-4 — `parseCounter64` intermediate float precision (HIGH — pre-existing guard)
**Lines:** 751–764
**Issue:** `hi * 4294967296` could lose float64 precision at the boundary of MAX_SAFE_INTEGER.
**Fix:** Simplified: always return BigInt string when `hi > 0` (eliminates float arithmetic entirely).

---

## ActiveMQ (`src/worker/activemq.ts`)

### BUG-AMQ-P3-1 — `readNextFrame` CRLF separator not detected (HIGH)
**Lines:** 392–398 (withStompSession), 1474 (durable subscribe)
**Issue:** `indexOf('\n\n')` never matches `\r\n\r\n` (CRLF line endings, common on Windows brokers).
**Fix:** Added `\r\n\r\n` detection; `sepLen` is 4 for CRLF, 2 for LF. Applied in both readNextFrame instances.

### BUG-AMQ-P3-2 — `handleActiveMQSend` receipt-id not validated (MEDIUM)
**Line:** 797
**Issue:** Any RECEIPT frame would set `receiptReceived = true` regardless of `receipt-id` header.
**Fix:** Strict check: `f.command === 'RECEIPT' && f.headers['receipt-id'] === 'send-1'`

### BUG-AMQ-P3-3 — `handleActiveMQAdmin` queueName not validated (MEDIUM/SECURITY)
**Lines:** 1042–1050
**Issue:** `brokerName` was validated against `[A-Za-z0-9_.-]` but `queueName` was used raw in Jolokia URL.
**Fix:** Added regex validation for `queueName`: `/^[A-Za-z0-9_.\-/]+$/`

### BUG-AMQ-P3-4 — `handleActiveMQQueues` missing Cloudflare check (MEDIUM)
**Lines:** 1756–1766
**Issue:** This handler was the only STOMP endpoint that didn't call `checkIfCloudflare()`.
**Fix:** Added CF check before the withStompSession call.

### BUG-AMQ-P3-5 — Durable subscribe `readNextFrame` ignores content-length (HIGH)
**Lines:** 1474–1530
**Issue:** The local `readNextFrame` inside `handleActiveMQDurableSubscribe` only scanned for NULL byte, not `content-length` header. Binary bodies with embedded NULLs were truncated.
**Fix:** Replaced with full content-length-aware + CRLF-aware implementation matching the one in `withStompSession`.

---

## Kafka (`src/worker/kafka.ts`)

### BUG-KAFKA-P3-1 — `nameLen` RangeError crash in parse functions (HIGH)
**Lines:** 746, 1191, 1582
**Issue:** `new Uint8Array(view.buffer, ..., nameLen)` with nameLen=-1 (Kafka null string) throws RangeError, crashing the handler.
**Fix:** Added `if (nameLen >= 0 && off + nameLen <= view.byteLength)` guard in all three parse functions.

### BUG-KAFKA-P3-2 — `decodeVarint` no max-length cap (MEDIUM)
**Lines:** 1022–1036
**Issue:** Varint loop could consume > 5 bytes; shift >= 35 causes bitwise overflow beyond 32-bit.
**Fix:** Added `if (bytesRead >= 5) break` — zigzag-encoded int32 uses at most 5 bytes.

### BUG-KAFKA-P3-3 — `readKafkaString` accepts any negative length as null (MEDIUM)
**Line:** 1352
**Issue:** `if (len < 0)` treated -2, -3, etc. as null. Kafka spec only uses -1 for null.
**Fix:** Changed to strict `if (len === -1)`, throws on any other negative value.

---

## NFS (`src/worker/nfs.ts`)

### BUG-NFS-P3-1 — `sattr3` encoding missing `set_mtime` field (HIGH)
**Lines:** 1507–1514 (CREATE), 1863–1870 (MKDIR)
**Issue:** `sattr3` was 24 bytes (6 × uint32) but RFC 1813 §2.3.13 requires set_mode(4+4) + set_uid(4) + set_gid(4) + set_size(4) + set_atime(4) + set_mtime(4) = 28 bytes minimum. The `set_mtime` field was entirely absent, misaligning the RPC payload.
**Fix:** Expanded to 28 bytes; added `sattr3View.setUint32(24, 0)` for `set_mtime = DONT_CHANGE`.

---

## AFP (`src/worker/afp.ts`)

### BUG-AFP-P3-1 — `parseServerInfo` DataView reads before bounds check (MEDIUM)
**Lines:** 1344–1354
**Issue:** Four `view.getUint16()` calls (requiring ≥ 10 bytes) executed before the `if (data.length < 11)` guard, causing RangeError on short server info payloads.
**Fix:** Moved the `data.length < 11` check to before the DataView is created.

---

## Fix Status

| ID | Protocol | Severity | Fixed |
|----|----------|----------|-------|
| BUG-SNMP-P3-1 | SNMP | CRITICAL | ✅ |
| BUG-SNMP-P3-2 | SNMP | HIGH | ✅ |
| BUG-SNMP-P3-3 | SNMP | MEDIUM | ✅ |
| BUG-SNMP-P3-4 | SNMP | HIGH | ✅ |
| BUG-AMQ-P3-1 | ActiveMQ | HIGH | ✅ |
| BUG-AMQ-P3-2 | ActiveMQ | MEDIUM | ✅ |
| BUG-AMQ-P3-3 | ActiveMQ | MEDIUM | ✅ |
| BUG-AMQ-P3-4 | ActiveMQ | MEDIUM | ✅ |
| BUG-AMQ-P3-5 | ActiveMQ | HIGH | ✅ |
| BUG-KAFKA-P3-1 | Kafka | HIGH | ✅ |
| BUG-KAFKA-P3-2 | Kafka | MEDIUM | ✅ |
| BUG-KAFKA-P3-3 | Kafka | MEDIUM | ✅ |
| BUG-NFS-P3-1 | NFS | HIGH | ✅ |
| BUG-AFP-P3-1 | AFP | MEDIUM | ✅ |

## Pass 4 Results

| Protocol | Result |
|----------|--------|
| SNMP | ✅ PASS |
| ActiveMQ | ✅ PASS |
| Kafka | ✅ PASS |
| NFS | ✅ PASS |
| AFP | ✅ PASS |

**All 5 protocols pass with zero remaining issues.**
