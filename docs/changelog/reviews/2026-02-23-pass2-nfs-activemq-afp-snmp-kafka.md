# Pass 2 Protocol Review — 2026-02-23
## Protocols: NFS, ActiveMQ, AFP, SNMP, Kafka

Second pass after all Pass 1 fixes were applied.
Criteria: same as Pass 1 — power-user feature parity, spec completeness, security, accessibility, usability.

---

## NFS (`src/worker/nfs.ts`)

### BUG-NFS-P2-1 — `sendRpcCall` infinite loop on zero-length fragment (HIGH)
**Lines:** Multi-chunk TCP buffering loop
**Issue:** When a zero-length RM fragment was received (fragmentLen === 0), the loop would spin indefinitely without advancing.
**Fix:** Added `if (fragmentLen === 0) break` guard.

### BUG-NFS-P2-2 — `xdrReadUint64` loses precision for large file IDs/sizes (HIGH)
**Lines:** xdrReadUint64, parseFattr3
**Issue:** JavaScript numbers lose precision above 2^53. XDR uint64 fields (size, fsid, fileid) were combined as `(hi * 0x100000000) + lo` using float64 arithmetic, silently corrupting values for large files/IDs.
**Fix:** Returns `number` when hi===0, otherwise returns `BigInt(hi) * 0x100000000n + BigInt(lo)` as a decimal string. `parseFattr3` return type updated to `number | string` for the affected fields.

### BUG-NFS-P2-3 — READ error status message missed in IMPROVEMENT-NFS-2 fix (LOW)
**Lines:** ~line 1185 (READ handler)
**Issue:** The NFS3 symbolic status name improvement was applied to most handlers but one READ error path was missed.
**Fix:** Applied `nfs3StatusName()` to the missed READ error message.

---

## AFP (`src/worker/afp.ts`)

### BUG-AFP-P2-1 — `parseServerInfo` returns empty defaults for data.length < 11 (MEDIUM)
**Lines:** parseServerInfo
**Issue:** When the server info response was shorter than 11 bytes, the function could attempt field parsing and return garbage. The guard condition existed but was incomplete.
**Fix:** Added early return `{ serverName: '', machineType: '', afpVersions: [], uams: [], flags: 0, flagDescriptions: [] }` when `data.length < 11`.
*(Note: This fix was later refined in Pass 3 — the guard also needed to precede DataView construction.)*

---

## Kafka (`src/worker/kafka.ts`)

### BUG-KAFKA-P2-1 — No port validation in any handler (HIGH)
**Lines:** All 7 request handlers
**Issue:** Port values were not validated for integer range (1–65535). Invalid ports (e.g., -1, 99999, NaN) could reach `connect()` with undefined behavior.
**Fix:** Added `validateKafkaPort(port)` helper; called in all 7 handlers after host validation.

### BUG-KAFKA-P2-2 — `parseListGroupsResponse`/`parseDescribeGroupsResponse` array bounds unchecked (HIGH)
**Lines:** parseListGroupsResponse, parseDescribeGroupsResponse
**Issue:** `groupCount` and `memberCount` from the wire were used directly as loop bounds without checking for negative values or implausibly large values, risking infinite loops or OOM on malformed responses.
**Fix:** Added bounds check: throws if `groupCount < 0 || groupCount > 10000` (same for members).

### BUG-KAFKA-P2-3 — `buildListOffsetsRequest` off not incremented after BigInt timestamp (HIGH)
**Lines:** buildListOffsetsRequest
**Issue:** After `view.setBigInt64(off, timestamp)`, the offset `off` was not incremented by 8, causing the subsequent fields to overwrite the timestamp bytes.
**Fix:** Added `off += 8` after the BigInt timestamp write.

---

## SNMP (`src/worker/snmp.ts`)

### BUG-SNMP-P2-1 — WALK handler uses unguarded `reader.read()` (HIGH)
**Lines:** handleSNMPWalk (~line 1547)
**Issue:** `const { value } = await reader.read()` returned only the first TCP chunk; large WALK responses spanning multiple packets were silently truncated.
**Fix:** Replaced with `readSNMPResponse(reader, startTime + timeout)`.

### BUG-SNMP-P2-2 — SET and MULTI-GET handlers use unguarded `reader.read()` (HIGH)
**Lines:** handleSNMPSet (~line 1699), handleSNMPMultiGet (~line 1804)
**Issue:** Same issue as WALK — single `reader.read()` call, multi-chunk responses truncated.
**Fix:** Replaced with `readSNMPResponse(reader, Date.now() + timeout)` in both handlers.

### BUG-SNMP-P2-3 — `parseBER` long-form length loop lacks per-byte bounds check (HIGH)
**Lines:** parseBER long-form branch
**Issue:** `data[lengthOffset + 1 + i]` accessed bytes in the long-form length field without checking that each byte is within `data.length`, silently reading beyond the buffer on truncated data.
**Fix:** Added per-byte bounds check; throws `'BER parse: truncated in long-form length bytes'`.

### BUG-SNMP-P2-4 — `parseBER` does not validate value does not extend beyond data (HIGH)
**Lines:** parseBER value extraction
**Issue:** `data.slice(valueOffset, valueOffset + length)` could produce a shorter-than-expected slice if `valueOffset + length > data.length`, silently corrupting the parsed value.
**Fix:** Added `if (valueOffset + length > data.length) throw new Error(...)`.

### BUG-SNMP-P2-5 — `readSNMPResponse` numLenBytes not validated (MEDIUM)
**Lines:** readSNMPResponse long-form detection
**Issue:** `numLenBytes = lenByte & 0x7f` could be 0 or >4 (e.g. 127 for a malformed frame), causing incorrect header size calculation and potential OOM or incorrect parsing.
**Fix:** Added `if (numLenBytes === 0 || numLenBytes > 4) throw new Error(...)`.

---

## ActiveMQ (`src/worker/activemq.ts`)

### BUG-AMQ-P2-1 — `readNextFrame` CRLF separator not detected (HIGH)
**Lines:** readNextFrame in withStompSession
**Issue:** `indexOf('\n\n')` never matches `\r\n\r\n`, so STOMP frames from Windows or spec-strict brokers using CRLF line endings would never be parsed — the loop would spin until timeout.
**Fix:** Added `\r\n\r\n` detection before `\n\n`; `sepLen` tracks actual separator length (4 vs 2).

### BUG-AMQ-P2-2 — RECEIPT frame `receipt-id` not validated in `handleActiveMQSend` (MEDIUM)
**Lines:** handleActiveMQSend receipt wait
**Issue:** Any RECEIPT frame set `receiptReceived = true` regardless of `receipt-id` header, allowing a mismatched or replayed receipt to appear as a successful send acknowledgment.
**Fix:** Strict check: `f.command === 'RECEIPT' && f.headers['receipt-id'] === 'send-1'`.

### BUG-AMQ-P2-3 — `queueName` not validated before Jolokia URL construction (MEDIUM/SECURITY)
**Lines:** handleActiveMQAdmin queueStats case
**Issue:** `brokerName` was validated against `[A-Za-z0-9_.-]+` but `queueName` was passed directly to `encodeURIComponent()` without any format restriction, allowing JMX ObjectName injection.
**Fix:** Added regex validation for `queueName`: `/^[A-Za-z0-9_.\-/]+$/`.

### BUG-AMQ-P2-4 — `handleActiveMQQueues` missing Cloudflare check (MEDIUM)
**Lines:** handleActiveMQQueues
**Issue:** Every other STOMP handler called `checkIfCloudflare()` before opening a connection; this handler did not, allowing it to be used for SSRF probing of Cloudflare-protected hosts.
**Fix:** Added CF check immediately after input validation.

### BUG-AMQ-P2-5 — Durable subscribe `readNextFrame` ignores `content-length` (HIGH)
**Lines:** handleActiveMQDurableSubscribe, local readNextFrame
**Issue:** The local `readNextFrame` inside the durable subscribe handler only scanned for NULL bytes, ignoring the `content-length` header. Binary message bodies with embedded null bytes (0x00) were silently truncated at the first null.
**Fix:** Replaced with a full content-length-aware + CRLF-aware implementation matching the one in `withStompSession`.

---

## Fix Status

| ID | Protocol | Severity | Fixed |
|----|----------|----------|-------|
| BUG-NFS-P2-1 | NFS | HIGH | ✅ |
| BUG-NFS-P2-2 | NFS | HIGH | ✅ |
| BUG-NFS-P2-3 | NFS | LOW | ✅ |
| BUG-AFP-P2-1 | AFP | MEDIUM | ✅ |
| BUG-KAFKA-P2-1 | Kafka | HIGH | ✅ |
| BUG-KAFKA-P2-2 | Kafka | HIGH | ✅ |
| BUG-KAFKA-P2-3 | Kafka | HIGH | ✅ |
| BUG-SNMP-P2-1 | SNMP | HIGH | ✅ |
| BUG-SNMP-P2-2 | SNMP | HIGH | ✅ |
| BUG-SNMP-P2-3 | SNMP | HIGH | ✅ |
| BUG-SNMP-P2-4 | SNMP | HIGH | ✅ |
| BUG-SNMP-P2-5 | SNMP | MEDIUM | ✅ |
| BUG-AMQ-P2-1 | ActiveMQ | HIGH | ✅ |
| BUG-AMQ-P2-2 | ActiveMQ | MEDIUM | ✅ |
| BUG-AMQ-P2-3 | ActiveMQ | MEDIUM | ✅ |
| BUG-AMQ-P2-4 | ActiveMQ | MEDIUM | ✅ |
| BUG-AMQ-P2-5 | ActiveMQ | HIGH | ✅ |
