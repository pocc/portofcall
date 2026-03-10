# Pass 1 Protocol Review — 2026-02-23

Protocols: NFS, ActiveMQ, AFP, SNMP, Kafka
Criteria: power-user feature parity, spec completeness, security, accessibility, usability

---

## AFP (`src/worker/afp.ts`)

### BUG-AFP-1 — Wrong error code in `writeFile` (CRITICAL)
**Line:** 811
**Issue:** Checks for `-5001` (which is not a defined AFP error code) instead of `-5043` (`kFPObjectExists = "Object already exists"`). The `sendCommand` method throws `getAFPErrorMessage(code)` which returns `'Object already exists'` for code -5043. Since none of the string checks match, the error is rethrown and file writes always fail when the file already exists.
**Fix:** Change check to `-5043` and `'Object already exists'`.

### BUG-AFP-2 — DSI `writeOffset` always 0 for FPWriteExt (HIGH)
**Line:** 144 (`buildDSICommand`), 824 (`writeFile`)
**Issue:** The AFP/DSI spec requires that for `FPWriteExt`, the DSI header's `writeOffset` field (bytes 4–7) contains the byte offset within the DSI payload where the actual file data starts (i.e. the size of the FPWriteExt command header = 20 bytes). Always using 0 violates the spec and may cause server-side misinterpretation.
**Fix:** Add optional `writeOffset` parameter to `buildDSICommand`; pass `20` for FPWriteExt.

### BUG-AFP-3 — `listDir` not paginated (MEDIUM)
**Lines:** 759–763
**Issue:** `FPEnumerateExt2` is called once with `maxCount=200`. Directories with >200 entries silently return only the first page.
**Fix:** Add a `startIndex` loop that continues until `actualCount < maxCount`.

---

## Kafka (`src/worker/kafka.ts`)

### BUG-KAFKA-1 — No response size cap in `readKafkaResponse` (CRITICAL/SECURITY)
**Lines:** 248–252
**Issue:** After reading the 4-byte size prefix, there is no upper bound check. A malicious broker can send `expectedSize = 0x7fffffff` causing the Worker to buffer 2 GB of data, triggering OOM.
**Fix:** Add `if (expectedSize < 0 || expectedSize > 104_857_600) throw new Error('Kafka response too large')`.

### BUG-KAFKA-2 — Metadata request sends `count=0` instead of `-1` for "all topics" (HIGH)
**Lines:** 191–197
**Issue:** The comment acknowledges the spec requires `-1` to mean "null array = all topics", but the code sends `count=0` (empty array). Kafka brokers interpret an empty topics array differently from a null array — the null array requests metadata for all topics.
**Fix:** Change `setInt32(0, 0)` to `setInt32(0, -1)`.

---

## NFS (`src/worker/nfs.ts`)

### BUG-NFS-1 — `sendRpcCall` reads only one TCP chunk (HIGH)
**Lines:** 229–237
**Issue:** RPC responses to large operations (READDIR, READ of big files) often arrive in multiple TCP segments. A single `reader.read()` call may return only a partial response; the rest is silently discarded, causing parse failures or empty results.
**Fix:** Buffer chunks until the RM (Record Marking) header is received and we have all `fragmentLength` bytes.

### IMPROVEMENT-NFS-2 — NFSv3 error codes are numeric only (LOW)
**Multiple lines** (e.g. line 781, 924, 1242, etc.)
**Issue:** Error messages like `"NFSv3 READ error status: 13"` give no human context. The spec defines named codes (e.g. NFS3ERR_ACCES = 13, NFS3ERR_NOENT = 2).
**Fix:** Add a lookup table and include the symbolic name in error messages.

---

## SNMP (`src/worker/snmp.ts`)

### BUG-SNMP-1 — `encodeOctetString` breaks BER for strings > 127 bytes (CRITICAL)
**Lines:** 119–122
**Issue:** The length byte is set directly to `bytes.length`. For strings longer than 127 bytes, this violates BER long-form encoding (`0x81, length` for 128–255, etc.). The existing `encodeLength()` helper handles this correctly.
**Fix:** Replace the raw length byte with `encodeLength(bytes.length)`.

### BUG-SNMP-2 — `parseOID` mishandles arc 2.x for first byte ≥ 80 (CRITICAL)
**Lines:** 380–382
**Issue:** The formula `Math.floor(data[0] / 40)` returns `3` for first-byte ≥ 120 (e.g. 120 → `3.0` instead of `2.40`). Per RFC 1157 §8.3.4, for first-byte ≥ 80, the arcs are `2` and `(first-byte - 80)`.
**Fix:** Use the correct RFC formula: `if (data[0] < 40) → [0, data[0]]`, `else if (data[0] < 80) → [1, data[0]-40]`, `else → [2, data[0]-80]`.

### BUG-SNMP-3 — `parseBER` does not validate offset bounds (HIGH)
**Lines:** 328–330
**Issue:** If `offset >= data.length`, `data[offset]` returns `undefined`, causing silent `NaN` propagation. Malformed or truncated responses produce confusing parse failures rather than clear errors.
**Fix:** Add bounds check at entry: `if (offset >= data.length) throw new Error(...)`.

### BUG-SNMP-4 — Single `reader.read()` truncates large SNMP responses (HIGH)
**Lines:** 1316–1319 (GET), 1009 (v3 discovery), 1114 (v3 GET)
**Issue:** SNMP responses with many varbinds may span multiple TCP packets. A single `reader.read()` returns only the first chunk.
**Fix:** Implement a BER-length-aware buffering loop to accumulate the full response.

### BUG-SNMP-5 — SNMPv3 `privProtocol` silently ignored (MEDIUM)
**Lines:** 903–945
**Issue:** The request schema accepts `privPassword` and `privProtocol`, but privacy encryption (CBC-DES or AES-CFB per RFC 3414) is not implemented. No error or warning is returned. Users believe their traffic is encrypted when it is not.
**Fix:** Return HTTP 400 with a clear error when `privPassword` is supplied.

### IMPROVEMENT-SNMP-6 — Community string length not validated (LOW)
**Line:** 1256
**Fix:** Reject community strings > 255 characters.

### IMPROVEMENT-SNMP-7 — OID input not sanitized (LOW)
**Fix:** Reject OIDs with > 128 components or non-numeric parts.

---

## ActiveMQ (`src/worker/activemq.ts`)

### BUG-AMQ-1 — STOMP frame parser ignores `content-length` header (HIGH)
**Lines:** 341–354, 384–398
**Issue:** Both `readUntilNull` and `readNextFrame` scan for a NULL byte (`\x00`) to find the end of the frame, ignoring the `content-length` header. Binary message bodies containing embedded null bytes are silently truncated at the first `\x00`, corrupting the body.
**Fix:** After parsing headers, if `content-length` is present, advance exactly that many bytes for the body then skip one NULL terminator.

### BUG-AMQ-2 — `brokerName` not validated before use in Jolokia URL (MEDIUM/SECURITY)
**Lines:** 966, 996–1000
**Issue:** `brokerName` is URL-encoded with `encodeURIComponent`, but there is no format restriction. Specially-crafted broker names could manipulate the JMX ObjectName and potentially access unintended MBeans.
**Fix:** Restrict `brokerName` to `[A-Za-z0-9_.-]` with a regex check before use.

---

## Fix Status

| ID | Protocol | Severity | Fixed |
|----|----------|----------|-------|
| BUG-AFP-1 | AFP | CRITICAL | ✅ |
| BUG-AFP-2 | AFP | HIGH | ✅ |
| BUG-AFP-3 | AFP | MEDIUM | ✅ |
| BUG-KAFKA-1 | Kafka | CRITICAL | ✅ |
| BUG-KAFKA-2 | Kafka | HIGH | ✅ |
| BUG-NFS-1 | NFS | HIGH | ✅ |
| IMPROVEMENT-NFS-2 | NFS | LOW | ✅ |
| BUG-SNMP-1 | SNMP | CRITICAL | ✅ |
| BUG-SNMP-2 | SNMP | CRITICAL | ✅ |
| BUG-SNMP-3 | SNMP | HIGH | ✅ |
| BUG-SNMP-4 | SNMP | HIGH | ✅ |
| BUG-SNMP-5 | SNMP | MEDIUM | ✅ |
| IMPROVEMENT-SNMP-6 | SNMP | LOW | ✅ |
| IMPROVEMENT-SNMP-7 | SNMP | LOW | ✅ |
| BUG-AMQ-1 | ActiveMQ | HIGH | ✅ |
| BUG-AMQ-2 | ActiveMQ | MEDIUM | ✅ |
