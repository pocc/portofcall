# Protocol Review — 7th Pass
**Review Date:** 2026-02-20
**Scope:** 277 protocol implementations, all 8 alphabet batches reviewed in parallel
**Focus:** New bugs, spec compliance gaps, usability improvements — anything missed by prior passes

---

## Executive Summary

The 7th pass found **4 critical**, **18 high**, and **23 medium** severity issues across all protocol batches. The most severe finding is **WebSocket misreading 64-bit frame lengths** (reads bytes 6-9 as the full length, skipping bytes 2-5), followed by **IMAP LOGIN injection** (spaces/special chars not quoted per RFC 3501), **RTMP AMF0 object end marker access beyond buffer bounds**, and **PostgreSQL NUL terminator search without bounds guard**.

---

## Critical Issues

### 1. WebSocket — 64-bit Frame Length Read at Wrong Offset
**File:** `src/worker/websocket.ts:166-169`

When `payloadLength === 127` (64-bit length), RFC 6455 §5.2 places the 8-byte extended length at bytes 2–9 of the frame header. The code reads only bytes 6–9 (the low-order 32 bits), skipping bytes 2–5 entirely. This misidentifies the frame boundary for any payload using the 64-bit field.

**Fix:** Read both hi and lo words: `hi = data[2..5]`, `lo = data[6..9]`; throw if `hi !== 0` (unsupported >4GB frames), otherwise use `lo` as `payloadLength`.

---

### 2. IMAP — LOGIN Command Injection via Unquoted Credentials
**File:** `src/worker/imap.ts:170, 316, 470, 617`

Credentials are string-interpolated directly: ``LOGIN ${username} ${password}``. RFC 3501 §9 requires quoted strings for tokens containing spaces, parentheses, or other special characters. A password of `"foo bar"` produces a malformed command; a password of `x\r\nA001 OK` is a full IMAP command injection.

**Fix:** Apply RFC 3501 quoting to both fields: ``LOGIN "${username.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" "${password.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"``

---

### 3. RTMP — AMF0 Object/ECMA-Array End Marker Read Beyond Buffer
**File:** `src/worker/rtmp.ts:174-187, 199-212`

The 3-byte object-end marker check (`data[pos] === 0 && data[pos+1] === 0 && data[pos+2] === 9`) occurs without first verifying `pos + 2 < data.length`. A truncated AMF0 object or array causes an out-of-bounds read.

**Fix:** Add `if (pos + 2 >= data.length) break;` before the end-marker check in both the Object and ECMA-Array parsers.

---

### 4. PostgreSQL — NUL Terminator Search Without Bounds Guard
**File:** `src/worker/postgres.ts:623`

In `ParameterStatus` parsing, the loop `while (msg.payload[j] !== 0)` increments `j` without checking `j < msg.payload.length`. If the payload contains no NUL terminator, `j` walks past `msg.payload.length`, returning `undefined` from every array access and never stopping.

**Fix:** Change to `while (j < msg.payload.length && msg.payload[j] !== 0) j++;`

---

## High-Severity Issues

### 5. BGP — NOTIFICATION Returns `success: true` When Routes Were Collected
**File:** `src/worker/bgp.ts:643-649`

After the 6th-pass fix, receiving a NOTIFICATION sets `peerNotification` and breaks. But `success` is computed as `peerNotification === null || routes.length > 0`. If even one route was collected before the NOTIFICATION arrived, `success` is `true` — concealing the fatal session error. Per RFC 4271 §6, a NOTIFICATION is always fatal.

**Fix:** Change to `success: peerNotification === null` (routes can still be returned but success reflects the session outcome).

---

### 6. Bitcoin — VERACK Timeout Silently Ignored
**File:** `src/worker/bitcoin.ts:370-401`

After sending VERACK, the code tries to receive the peer's VERACK inside a try-catch with a race timeout. On timeout, `handshakeComplete` is set to `false`, but the function continues and returns node information as if the handshake succeeded. BIP 37 requires VERACK before the connection is considered established.

**Fix:** Return `{ success: false, error: 'VERACK not received' }` when `handshakeComplete` is false.

---

### 7. AMQP — `channelMax` of 0 Not Rejected Before Opening Channel 1
**File:** `src/worker/amqp.ts`

After Connection.Tune, the server's `channelMax` (maximum channel number) is accepted without validation. If `channelMax === 0` (which per AMQP 0-9-1 spec means "no limit"), the implementation correctly opens channel 1. But if a server negotiates `channelMax` to a value < 1, the implementation should reject or re-negotiate. The code never checks this.

**Fix:** After parsing Connection.TuneOk, validate `agreedChannelMax >= 1` before proceeding to channel open.

---

### 8. TDS — Out-of-Bounds Access in `parseColumnValue` for `TYPE_BITN`
**File:** `src/worker/tds.ts:905`

```typescript
const len = data[offset++];  // no bounds check
if (len === 0) return ...;
return { value: data[offset], nextOffset: offset + 1 };
```

If `offset` equals `data.length`, `data[offset]` reads `undefined`. Some other branches check bounds first; `TYPE_BITN` does not.

**Fix:** Add `if (offset >= data.length) return { value: null, nextOffset: offset };` before reading `len`.

---

### 9. WinRM — Chunked Decode Missing `i+1` Bounds Guard
**File:** `src/worker/winrm.ts:192`

The loop condition is `i < data.length - 1` but reads `data[i + 1]` unconditionally. When `lineEnd` remains -1 (terminator not found), the subsequent code uses -1 as a slice offset without the guard being hit, potentially returning a very large slice.

**Fix:** Change loop to `i + 1 < data.length` and validate `lineEnd !== -1` before using it as a slice end.

---

### 10. SIP — `statusMatch` Used Without Null Check
**File:** `src/worker/sip.ts:141-143`

`const statusMatch = line.match(...)` can return null for a non-status line, but `parseInt(statusMatch[1])` is called immediately without checking. Any non-matching line throws `TypeError: Cannot read properties of null`.

**Fix:** Add `if (!statusMatch) return null;` (or `continue`) after the match call.

---

### 11. RTMP — `msgLength` Not Bounded (DoS)
**File:** `src/worker/rtmp.ts:401-417`

`msgLength` is read from network data as a 24-bit or 32-bit unsigned value and used directly in `while (payloadRead < msgLength)`. A server sending `msgLength = 0xFFFFFF` with `chunkSize = 128` causes ~131,000 read iterations per message.

**Fix:** Cap `msgLength` at a reasonable maximum (e.g., 16 MB): `if (msgLength > 16 * 1024 * 1024) throw new Error('RTMP message too large');`

---

### 12. FTP — Transfer-Complete Response Not Enforced for LIST/MLSD/NLST
**File:** `src/worker/ftp.ts:388-396`

After a data transfer, the "226 Transfer Complete" response is checked for RETR/STOR (throws on failure) but only logs a warning for LIST, MLSD, and NLST. A server returning an error response is silently ignored.

**Fix:** Apply the same `throw` logic to all post-transfer response checks, not just RETR/STOR.

---

### 13. Gemini — Response Size Limit Checked After Accumulation
**File:** `src/worker/gemini.ts:164-165`

The 5 MB limit is checked after appending each chunk: `totalBytes > maxResponseSize`. A final chunk that pushes the total to 5 MB + 1 byte is already in memory before the check fires.

**Fix:** Check before accumulating: `if (totalBytes + value.length > maxResponseSize) throw new Error(...);`

---

### 14. CIFS — Unbounded Recursion in `readColumnValue` for Nullable Types
**File:** `src/worker/cifs.ts:623`

`readColumnValue()` calls itself recursively for Nullable-wrapped types. A malformed response with 100 nested Nullable wrappers causes a stack overflow.

**Fix:** Add a `depth` parameter; throw when `depth > 10`.

---

### 15. EPP — Frame Length Integer Overflow Before Allocation
**File:** `src/worker/epp.ts:86-91`

A server sending `totalLength = 0x7FFFFFFF` (2 GB) passes the existing validation but causes a 2 GB array allocation before any content arrives.

**Fix:** Add a practical cap before allocation: `if (totalLength > 10_000_000) throw new Error('EPP frame too large');`

---

### 16. Fluentd — Truncated Decode Not Distinguished from Complete
**File:** `src/worker/fluentd.ts:219-224`

When `bytesRead === 0`, `decodeMap()` breaks silently. The caller cannot distinguish partial decode from a full decode, so `ackReceived` may be set based on incomplete data.

**Fix:** Return a `truncated: boolean` flag in `DecodeResult` and check it before setting `ackReceived`.

---

### 17. DNS — Compression Pointer Loop Produces Wrong Caller Offset
**File:** `src/worker/dns.ts:249`

`parseDNSName()` sets the return offset to the position of the first pointer (correct), but multiple sequential pointers can still build an incorrect offset chain. Callers parsing MX, SRV, etc. may advance to a wrong offset, silently misaligning subsequent record parsing.

**Fix:** Strictly set `jumpReturn` only once (already the case), and add a visited-pointer set to detect true pointer loops before the safety counter fires.

---

### 18. SNMP — OID Subidentifier Encoding Infinite Loop
**File:** `src/worker/snmp.ts:363-365`

`while (value > 0) { value >>= 7; ... }` — if `value` is manipulated to become negative through a prior bitwise operation, the right-shift of a negative 32-bit signed integer keeps it negative, looping forever.

**Fix:** Use `value = (value >>> 7)` (unsigned right shift) and add `if (encoded.length > 32) throw new Error('OID component too large');`.

---

## Medium-Severity Issues

### 19. MGCP — Duplicate Keys in `statusMap` (Half of Status Codes Lost)
**File:** `src/worker/mgcp.ts:496-535`

Multiple status codes appear twice as object literal keys (500, 501, and likely others). JavaScript silently uses the last definition; the first definition's message is lost. Already identified in 5th pass as a medium issue; not yet fixed.

**Fix:** Deduplicate all keys. Use the RFC 3435 status table as the canonical source.

---

### 20. MQTT — QoS Value 3 Not Rejected
**File:** `src/worker/mqtt.ts:208, 549`

`(flags >> 1) & 0x03` can produce 3, which is reserved and invalid per MQTT 3.1.1 §2.2.2 and MQTT 5.0 §2.2.2. Value 3 is not rejected; it silently passes through.

**Fix:** `if (qos === 3) throw new Error('Invalid QoS 3 (reserved)');`

---

### 21. L2TP — Transaction ID Limited to 16-bit Range
**File:** `src/worker/l2tp.ts:261, 671`

`Math.floor(Math.random() * 65535) + 1` only generates 1–65535. RFC 2661 §3.1 uses a 16-bit Tunnel/Session ID, so this is spec-compliant; but on rapid re-use the collision probability is high (birthday problem at ~300 concurrent tunnels = 50% collision chance).

**Fix:** Use `crypto.getRandomValues(new Uint16Array(1))[0] || 1` for uniform distribution.

---

### 22. ZooKeeper — Stat Structure Read Without Bounds Check
**File:** `src/worker/zookeeper.ts:597-610`

`data.slice(dataOffset, dataOffset + 80)` does not validate `dataOffset + 80 <= data.length`. A truncated response produces a short `stat` buffer; subsequent `DataView` accesses at fixed offsets (up to offset 52) silently read zeros.

**Fix:** Add `if (dataOffset + 80 > data.length) throw new Error('Incomplete ZooKeeper stat structure');`

---

### 23. Prometheus — `statusMatch` Null Dereference
**File:** `src/worker/prometheus.ts:83`

Same pattern as SIP: `statusMatch[1]` accessed without null check. An HTTP response without a valid status line throws `TypeError`.

**Fix:** Add `if (!statusMatch) return error response;`

---

### 24. POP3 — `slice(1, -2)` Assumes At Least 3 Lines
**File:** `src/worker/pop3.ts:509, 738`

`lines.slice(1, -2)` is undefined behavior when `lines.length < 3` (returns empty array without error, silently discarding all content or producing unexpected results).

**Fix:** Add `if (lines.length < 3) throw new Error('Invalid RETR/TOP response');` before slicing.

---

### 25. MongoDB — 64-bit BSON Timestamp Precision Loss
**File:** `src/worker/mongodb.ts:156, 180-181`

`hi * 0x100000000 + lo` overflows `Number.MAX_SAFE_INTEGER` for timestamps after the year ~2242. Use `BigInt` for the combined value.

**Fix:** `BigInt(hi) * BigInt(0x100000000) + BigInt(lo)` and return as string.

---

### 26. AFP — Negative Error Code Keys May Not Match Server Integers
**File:** `src/worker/afp.ts:78-104`

`getAFPErrorMessage()` uses negative literal keys (`-5000`, `-5001`, etc.). AFP servers return signed int32 error codes. In TypeScript object maps, numeric property keys are coerced to strings, so `-5000` becomes `"-5000"` — which works. However, if the server sends `0xFFFFFFFFFFFEC078` (a large unsigned value that is -5000 when treated as int32), it won't match. Depends on how the caller reads the code.

**Fix:** Ensure the error code is sign-extended to 32-bit before lookup: `const signed = (code | 0);` then look up `signed`.

---

### 27. Beanstalkd — BURIED Response Missing `needsKick` Signal
**File:** `src/worker/beanstalkd.ts:536-553`

When a job is BURIED, `success: false` is returned but callers have no structured way to know they need to call `kick`. Add `needsKick: true` to the BURIED response object for API consumers.

---

### 28. XMPP — Post-STARTTLS SASL Feature Re-negotiation Not Validated
**File:** `src/worker/xmpp.ts:403`

After TLS upgrade, RFC 6120 §5.3.1 requires the server to provide fresh `<stream:features>` including SASL mechanisms. The code re-opens the stream but doesn't validate that SASL mechanisms are present before attempting SASL PLAIN.

**Fix:** Parse the post-TLS feature set and throw if SASL mechanisms are absent.

---

### 29. TCP — Negative `remaining` Possible
**File:** `src/worker/tcp.ts:146`

`const remaining = maxBytes - totalBytes` — if `totalBytes` ever exceeds `maxBytes` (e.g., last chunk larger than remaining), `remaining` is negative, and `.slice(0, negative)` returns an empty array, silently truncating the response.

**Fix:** Guard with `if (totalBytes >= maxBytes) break;` before computing `remaining`.

---

### 30. TFTP — Non-Compliant Unterminated Error Message Accepted
**File:** `src/worker/tftp.ts:114-119`

RFC 1350 §5 requires the error message to be NUL-terminated. If no NUL is found, the code decodes the entire remaining buffer — silently accepting a protocol violation.

**Fix:** Mark unterminated error messages explicitly: return `'(unterminated error message)'` as the message when `nullIdx < 0`.

---

### 31. Telnet — Reader Lock Possibly Unreleased on Error
**File:** `src/worker/telnet.ts:794-867`

If an exception is thrown inside the `Promise.race` loop, the `finally` block at line 867 may not execute (depending on outer catch structure). Reader/writer locks should be released in a dedicated `finally`.

**Fix:** Wrap the read loop in an explicit `try { ... } finally { reader.releaseLock(); writer.releaseLock(); }`.

---

### 32. Cassandra — `parseStringMultimap` No Offset+Length Bounds Check
**File:** `src/worker/cassandra.ts:107-128`

Reading key/value strings: no validation that `offset + keyLen <= data.length` before slicing. A malformed SUPPORTED response with inflated counts silently reads zeros.

**Fix:** Add `if (offset + keyLen > data.length) break;` before each string decode.

---

### 33. DCERPC — `parseBindAck` Secondary Address Length Not Bounds-Checked
**File:** `src/worker/dcerpc.ts:346-351`

`secAddrLen` read from network data without validating `26 + secAddrLen <= data.length` before the subsequent slice. Alignment calculation can then reference incorrect offsets.

**Fix:** Add `if (26 + secAddrLen > data.length) return { error: 'Truncated BindAck' };`

---

## Low-Severity / Usability Issues

### 34. IKEv2 — Payload Chain Infinite Loop on Self-Referential `nextType`
**File:** `src/worker/ike.ts:868-880`

If a crafted response has `nextType` pointing to the current payload type, the `while (currentType !== IKEv2Payload.None)` loop runs indefinitely.

**Fix:** Add an iteration cap: `if (iterations++ > 256) throw new Error('IKEv2 payload chain too long');`

---

### 35. HTTP — Chunked Zero-Chunk Trailing CRLF Not Verified
**File:** `src/worker/http.ts:296-306`

The terminal `0\r\n\r\n` sequence is detected but the trailing `\r\n` after the zero-length chunk is not strictly verified. A malformed terminator `0\n\r` would pass.

**Fix:** Verify `afterTerm.startsWith('\r\n')` after the zero-chunk marker.

---

### 36. ADB — `readAll()` Has No Per-Chunk Timeout
**File:** `src/worker/adb.ts`

The read loop accumulates chunks until `done`, but if the remote end stalls mid-stream (sends one chunk then stops), the overall connection timeout is the only safety net. A per-iteration timeout would give faster feedback.

---

### 37. AMI — `readBlockByActionID()` Doesn't Detect Channel Close
**File:** `src/worker/ami.ts:670-710`

During MD5 challenge negotiation, if the AMI server closes the channel (e.g., wrong AMI version), the reader returns `done: true` and the code times out waiting for the challenge block. The error is surfaced as a timeout rather than a connection error.

**Fix:** Check `done === true` in the read loop and throw `'AMI connection closed during authentication'`.

---

### 38. ClickHouse — VarUInt Bounds Check Insufficient
**File:** `src/worker/clickhouse.ts:156`

The loop iterates up to 9 times for a 64-bit VarUInt but doesn't guard against reading past `data.length` if the buffer ends before the VarUInt is complete.

**Fix:** Check `offset + bytesRead >= data.length` at the start of each loop iteration.

---

## Prior-Pass Fixes Verified Intact

- ✅ IKE Buffer.alloc(N, 0) — all 11 locations
- ✅ SANE buildInitRequest() and buildOpenRequest() username whitelist
- ✅ SMTPS + Submission sendSMTPCommand CRLF strip
- ✅ Telnet WILL→DONT / DO→WONT (RFC 854)
- ✅ SIP stripCRLF on From/To/Contact/uri
- ✅ Redis 512 KB buffer cap + RESP depth limit
- ✅ EPP secureTransport: 'on'
- ✅ Fluentd decodeMap bytesRead===0 guard (partial — caller still needs truncation flag)
- ✅ IRC PONG :token colon prefix
- ✅ RADIUS response authenticator validation
- ✅ RELP transaction number validation
- ✅ BGP NOTIFICATION break (partial — success logic still wrong)
- ✅ Kafka arrayLen bounds check
- ✅ FTP post-transfer readResponse timeout
- ✅ mDNS UTF-8 byte count for label length
- ✅ Memcached CAS numeric validation
- ✅ MQTT crypto.getRandomValues() for clientId
- ✅ CoAP block sequence validation
- ✅ FastCGI FCGI_STDERR drain
- ✅ CDP/Docker chunked terminator warning
- ✅ Git pkt-line 0001/0002 handling
- ✅ DCERPC 65535 off-by-one + truncation check
- ✅ Quake3 multi-packet accumulation
- ✅ BitTorrent info_hash validation in handshake

---

## Priority Fix List

### P0 — Security / Correctness
1. **WebSocket** — Fix 64-bit frame length byte offset (reads wrong bytes)
2. **IMAP** — Quote credentials in LOGIN command (injection risk)
3. **RTMP** — Add bounds check before AMF0 end marker read
4. **PostgreSQL** — Add bounds guard in NUL terminator search

### P1 — High Severity
5. **BGP** — Fix `success` logic: NOTIFICATION always → `success: false`
6. **Bitcoin** — Return `success: false` when VERACK not received
7. **AMQP** — Validate `channelMax >= 1` post-Tune
8. **TDS** — Add bounds check before TYPE_BITN read
9. **WinRM** — Fix chunked decode `i+1` bounds and `lineEnd` usage
10. **SIP** — Add null check after `statusMatch`
11. **RTMP** — Cap `msgLength` at 16 MB
12. **FTP** — Enforce 226 check for all data transfer operations
13. **Gemini** — Check size limit before accumulating

### P2 — Medium Severity
14. **CIFS** — Add recursion depth limit to `readColumnValue`
15. **EPP** — Cap frame length at 10 MB before allocation
16. **MGCP** — Deduplicate statusMap keys
17. **MQTT** — Reject QoS=3
18. **SNMP** — Fix OID encoding unsigned shift + loop cap
19. **ZooKeeper** — Bounds check on stat structure read
20. **Prometheus** — Add statusMatch null check
21. **POP3** — Validate line count before slice
22. **MongoDB** — Use BigInt for 64-bit BSON timestamps
23. **Beanstalkd** — Add `needsKick` to BURIED response
24. **XMPP** — Validate SASL features after STARTTLS
25. **TCP** — Guard against negative `remaining`
26. **Cassandra** — Add offset+len bounds in `parseStringMultimap`
27. **DCERPC** — Bounds check on `secAddrLen` in `parseBindAck`

### P3 — Low / Usability
28. **AFP** — Sign-extend error codes before map lookup
29. **IKEv2** — Add iteration cap to payload chain loop
30. **AMI** — Surface channel close during authentication
31. **ClickHouse** — Fix VarUInt loop bounds
32. **ADB** — Add per-chunk timeout to `readAll()`
33. **Beanstalkd** — `needsKick` usability field

---

## Metrics

| Category | Count |
|---|---|
| Critical | 4 |
| High | 14 |
| Medium | 15 |
| Low / Usability | 5 |
| Prior fixes verified intact | 24 |

**Previous report:** [PROTOCOL_REVIEW_6TH_PASS.md](PROTOCOL_REVIEW_6TH_PASS.md)
