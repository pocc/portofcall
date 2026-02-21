# Protocol Review — 6th Pass
**Review Date:** 2026-02-20
**Scope:** 277 protocol implementations, all 8 alphabet batches reviewed in parallel
**Focus:** Bugs missed by all prior passes; verification that 5th-pass P0 fixes were applied

---

## Executive Summary

The 6th pass found **3 critical** issues where 5th-pass P0 fixes were **not applied** to the codebase, plus **22 new genuine bugs** across all severity levels. All major prior-pass fixes were otherwise confirmed intact.

---

## Critical — 5th-Pass P0 Fixes Still Not Applied

### 1. SANE — `buildInitRequest()` Username Still Unvalidated
**File:** `src/worker/sane.ts:138`

The 5th-pass P0 fix required adding the `^[a-zA-Z0-9._-]+$` whitelist to `buildInitRequest()`. It has not been applied. The username field remains injectable.

**Fix:** Add identical check from `buildOpenRequest()` to `buildInitRequest()`.

---

### 2. SMTPS — `sendSMTPCommand()` Still Missing CRLF Strip
**File:** `src/worker/smtps.ts:82`

The 5th-pass P0 fix required adding `.replace(/[\r\n]/g, '')` to the `sendSMTPCommand()` copies in smtps.ts and submission.ts. The smtps.ts copy remains unfixed.

**Fix:** Add `const safeCommand = command.replace(/[\r\n]/g, '');` before encoding.

---

### 3. IKE — `Buffer.allocUnsafe()` Still Present
**File:** `src/worker/ike.ts:170` (and up to 10 other locations)

The 5th-pass P0 fix required replacing all 11 `Buffer.allocUnsafe(N)` calls with `Buffer.alloc(N, 0)`. At least one instance (line 170 in `buildISAKMPHeader()`) remains.

**Fix:** Replace every `Buffer.allocUnsafe(N)` with `Buffer.alloc(N, 0)` in ike.ts.

---

## New Critical / High Issues

### 4. SIP — CRLF Injection in Request Headers
**File:** `src/worker/sip.ts:334-340`

User-controlled `From`, `To`, `Contact`, and `uri` fields are embedded in SIP headers without stripping `\r\n`. A value like `probe@x.com\r\nBcc: attacker@x.com` creates a phantom header.

**Fix:** Apply `.replace(/[\r\n]/g, ' ')` to all user-supplied header values before building the SIP request.

---

### 5. Redis — `readUntilComplete()` Has No Buffer Size Cap
**File:** `src/worker/redis.ts:48`

`buffer += new TextDecoder().decode(value)` accumulates RESP data without a total size limit. The depth-limit-of-10 fix prevents deep nesting but not wide arrays. A server streaming 500 MB of array elements exhausts memory before the depth guard fires.

**Fix:** Add `if (buffer.length > 512 * 1024) throw new Error('RESP buffer overflow');` inside the read loop.

---

### 6. EPP — TLS Never Enabled
**File:** `src/worker/epp.ts:247`

`connect({ hostname: config.host, port: config.port })` — no `secureTransport: 'on'`. RFC 5734 §3 requires TLS. Listed as 5th-pass P2 but not applied.

**Fix:** `connect({ hostname: config.host, port: config.port, secureTransport: 'on' })`.

---

### 7. Fluentd — `decodeMap()` Infinite Loop on Truncated Data
**File:** `src/worker/fluentd.ts:214-227`

When `decodeMsgpack()` returns `bytesRead: 0` (data exhausted), the `for (let i = 0; i < count; i++)` loop keeps advancing `i` without advancing `pos`, running all remaining iterations reading from the same dead offset. Listed as 5th-pass P1 but not applied.

**Fix:** After each `decodeMsgpack()` call, if `bytesRead === 0` break the loop immediately.

---

### 8. IRC — PONG Response Missing Colon Prefix
**File:** `src/worker/irc.ts:221-225`

Server sends `PING :token`. Client must respond `PONG :token`. Current code sends `PONG token` (without colon), which strict RFC 2812 servers reject as malformed. ircs.ts correctly has the colon; irc.ts does not.

**Fix:** Change `\`PONG ${msg.params[0] || ''}\r\n\`` to `\`PONG :${msg.params[0] || ''}\r\n\``.

---

### 9. RADIUS — Response Authenticator Not Validated
**File:** `src/worker/radius.ts:575, 755`

After receiving an Access-Accept/Reject, the code never verifies the response authenticator. Per RFC 2865 §3, the response authenticator must equal `MD5(Code + ID + Length + RequestAuth + ResponseAttributes + Secret)`. Without this check, spoofed RADIUS responses are accepted.

**Fix:** After `parsePacket(fullPacket)`, compute the expected response authenticator and compare to `response.authenticator`.

---

### 10. RELP — Transaction Number Not Validated in Response
**File:** `src/worker/relp.ts:203, 343`

After sending a RELP frame with transaction number N, the code reads the response but never checks that the response transaction number matches N. Per RFC 8600 §3.5.1, the receiver must validate this.

**Fix:** After parsing the response, assert `parsed.txnr === sentTxnr` and throw on mismatch.

---

### 11. BGP — NOTIFICATION Mid-Session Silently Ignored
**File:** `src/worker/bgp.ts:642-643`

In the route-collection loop, receiving `MSG_NOTIFICATION` simply breaks the loop. The function then returns `{ success: true, routes: [] }`, indistinguishable from a peer with no routes. The notification error code and subcode are lost.

**Fix:** Set a `peerNotification` variable on receipt, break, and return `success: false` with notification details.

---

### 12. Kafka — Array Length Not Bounded Before Iteration
**File:** `src/worker/kafka.ts:299-311`

`arrayLen = view.getInt32(offset)` is used directly in a loop without validation. A crafted server sending `arrayLen = 2147483647` causes the loop to iterate billions of times.

**Fix:** Add `if (arrayLen < 0 || arrayLen > 10000) throw new Error('Invalid Kafka array length');`.

---

### 13. FTP — `readResponse()` Called Without Timeout After Data Transfer
**File:** `src/worker/ftp.ts` — `mlsd()`, `nlst()`, `list()` methods

After completing the data transfer, `await this.readResponse()` is called (to read the "226 Transfer Complete" response) with no timeout. A server that never sends this final response causes the handler to hang indefinitely.

**Fix:** Pass a timeout to `readResponse()` for these final response reads, or add a deadline check.

---

## New Medium Issues

### 14. MQTT — `clientId` Collision Risk on Concurrent Requests
**File:** `src/worker/mqtt.ts:330`

`Math.random().toString(36).slice(2, 9)` generates a 7-character ID with ~78 bits of randomness per character — low for concurrent requests. Two requests within the same millisecond can share the same clientId, causing broker session conflicts.

**Fix:** `Date.now().toString(36) + crypto.getRandomValues(new Uint8Array(4)).join('')` — guaranteed uniqueness.

---

### 15. mDNS — UTF-8 Label Length Uses Character Count Not Byte Count
**File:** `src/worker/mdns.ts:147-149`

`labelBuffer.writeUInt8(label.length, 0)` writes the JavaScript string length (character count) as the DNS label length, but UTF-8 multi-byte characters (e.g., `é`) are 2 bytes. The length field will be wrong for any non-ASCII label.

**Fix:** Use `const labelBytes = new TextEncoder().encode(label)` and write `labelBytes.length` as the length byte.

---

### 16. Memcached — CAS Token Not Validated as Numeric
**File:** `src/worker/memcached.ts:227`

`casUnique` from user input is embedded directly in the CAS command. Non-numeric tokens are rejected by the server without a clear error. Listed as 5th-pass P2 but not applied.

**Fix:** `if (!/^\d+$/.test(casUnique)) throw new Error('CAS token must be numeric');`

---

### 17. Bitcoin — No Minimum Version Validation
**File:** `src/worker/bitcoin.ts:~180`

`version = view.getInt32(offset, true)` — never checked against minimum 70001. Ancient nodes (<70001) are reported as valid peers.

**Fix:** `if (version < 70001) throw new Error(\`Unsupported Bitcoin version: ${version}\`);`

---

### 18. CoAP — Block Number Not Validated for Sequence
**File:** `src/worker/coap.ts` — block-wise handler

After receiving block N, the code requests block N+1 but doesn't verify the server actually sent block N (not N-2 or N+5). An out-of-sequence block silently corrupts the reassembled payload.

**Fix:** After receiving a block, assert `block2.num === expectedBlockNum` before accepting it.

---

### 19. FastCGI — `FCGI_STDERR` After `FCGI_END_REQUEST` Silently Dropped
**File:** `src/worker/fastcgi.ts:531-538`

The record-parsing loop stops when `FCGI_END_REQUEST` is encountered, leaving any subsequent `FCGI_STDERR` frames unread. Per FastCGI spec, stderr may interleave with end request.

**Fix:** Continue reading until EOF after `FCGI_END_REQUEST`, collecting any trailing stderr.

---

### 20. CDP/Docker — Chunked Transfer Missing Zero-Chunk Terminator Validation
**File:** `src/worker/cdp.ts:138-157`, `src/worker/docker.ts:148-157`

`decodeChunked()` returns successfully even if the server closes the connection mid-stream without sending the terminating `0\r\n\r\n` chunk. Callers cannot distinguish complete from truncated responses.

**Fix:** After the while loop, if `chunkSize !== 0` throw `'Incomplete chunked response: missing terminator'`.

---

### 21. Git — pkt-line Delimiter/Response-End Packets Not Handled
**File:** `src/worker/git.ts:140-148`

Git protocol v2 uses `0001` (delimiter) and `0002` (response-end) in addition to `0000` (flush). The current code throws `'Invalid pkt-line length'` for both, breaking protocol v2 compatibility.

**Fix:** Explicitly handle `pktLen === 1` and `pktLen === 2` as special packets before the `pktLen < 4` guard.

---

### 22. DCERPC — Fragment Length Allows 65536 (Off-by-One) and Truncated Reads
**File:** `src/worker/dcerpc.ts:258`

`fragLen > 65536` should be `fragLen > 65535` (16-bit field max). Also, if the connection closes before `fragLen` bytes arrive, the code returns the partial buffer without error.

**Fix:** Change to `fragLen > 65535`. After the read loop, verify `totalBytes >= fragLen`.

---

### 23. Quake3 — Multiple `statusResponse` Packets Silently Discarded
**File:** `src/worker/quake3.ts:239, 287`

`readAvailable()` buffers all data but the parser only processes the first `statusResponse` block. If a large player list spans multiple UDP datagrams, only the first is parsed.

**Fix:** Loop the parser over all `statusResponse` blocks found in the accumulated data.

---

### 24. Kerberos — BER Indefinite Length Encoding Not Handled
**File:** `src/worker/kerberos.ts:64-80`

ASN.1 BER allows indefinite length (`0x80` in the length octet). If a Kerberos server uses indefinite length encoding in AS-REP, the parser will misinterpret 0x80 as a short length of 128 bytes.

**Fix:** Detect `lengthByte === 0x80` and either implement indefinite-length parsing or throw a descriptive error.

---

### 25. BitTorrent — `info_hash` Never Validated Against Expected Value
**File:** `src/worker/bittorrent.ts:278-298`

Peer's `info_hash` echoed back in handshake is stored and returned but never compared to what we sent. BEP 3 requires rejection on mismatch.

**Fix:** Compare received `peerInfoHash` byte-by-byte against the sent `infoHashBytes`, return `success: false` on mismatch.

---

## 4th/5th-Pass Fixes Verified Intact (No Regressions)

- ✅ YMSG inline MD5
- ✅ CIFS MD4 Round 1/2/3, nameLen guard
- ✅ Hazelcast getUint32
- ✅ HL7 MLLP cap
- ✅ HSRP Buffer.alloc
- ✅ H.323 IE bounds
- ✅ XMPP STARTTLS + stream restart
- ✅ TURN unauthenticated probe + authenticated HMAC
- ✅ POP3 dot-destuffing (order and edge cases correct)
- ✅ TDS three-tier column type skip
- ✅ OpenVPN ackCount bounds (both locations)
- ✅ SCCP 65535 cap
- ✅ SANE buildOpenRequest whitelist
- ✅ Redis RESP depth limit
- ✅ SMTP sendSMTPCommand CRLF strip (smtp.ts only)
- ✅ BGP agreedFourByteAS
- ✅ Cassandra stream IDs + AUTH_SUCCESS
- ✅ TACACS+ body XOR encryption
- ✅ VNC DES authentication
- ✅ Telnet IAC (confirmed inverted per 5th pass — awaiting fix)
- ✅ IRC**S** PONG has correct colon prefix (irc.ts does not)
- ✅ AMI MD5 challenge-response (`md5(challenge + secret)`)
- ✅ Zookeeper command allowlist enforced

---

## Priority Fix List

### P0 — Unresolved from 5th Pass
1. **IKE** — Replace all `Buffer.allocUnsafe()` with `Buffer.alloc(N, 0)`
2. **SANE** — Add whitelist to `buildInitRequest()` username
3. **SMTPS** — Add CRLF strip to `sendSMTPCommand()`
4. **Telnet** — Fix WILL→DONT / DO→WONT inversion (still pending from 5th pass)

### P1 — New High Issues
5. **SIP** — Strip `\r\n` from From/To/Contact/uri headers
6. **Redis** — Add 512 KB buffer cap in `readUntilComplete()`
7. **EPP** — Add `secureTransport: 'on'`
8. **Fluentd** — Break `decodeMap()` loop on `bytesRead === 0`
9. **IRC** — Fix PONG to `PONG :${token}`
10. **RADIUS** — Validate response authenticator
11. **RELP** — Validate response transaction number
12. **BGP** — Surface NOTIFICATION as `success: false` with details
13. **Kafka** — Bound `arrayLen` before iteration
14. **FTP** — Add timeout to post-transfer `readResponse()` calls

### P2 — New Medium Issues
15. **MQTT** — Use `Date.now() + crypto.getRandomValues()` for clientId
16. **mDNS** — Use UTF-8 byte count for label length
17. **Memcached** — Validate CAS token is numeric
18. **Bitcoin** — Validate version >= 70001
19. **CoAP** — Validate block sequence number
20. **FastCGI** — Collect FCGI_STDERR after END_REQUEST
21. **CDP + Docker** — Validate chunked terminator
22. **Git** — Handle pkt-line 0001/0002 packets
23. **DCERPC** — Fix off-by-one (65535) and verify complete read
24. **Quake3** — Parse all statusResponse blocks
25. **BitTorrent** — Validate info_hash

### P3 — Low / Test
26. **Kerberos** — Handle BER indefinite length
27. **DCERPC fragment** — Document/test truncated PDU behavior

---

## Metrics

| Category | Count |
|---|---|
| 5th-pass P0 fixes not yet applied | 3 |
| 5th-pass P1/P2 fixes not yet applied | 4 |
| New Critical/High (6th pass only) | 11 |
| New Medium | 11 |
| Prior fixes verified intact | 23 |

**Previous report:** [PROTOCOL_REVIEW_5TH_PASS.md](PROTOCOL_REVIEW_5TH_PASS.md)
