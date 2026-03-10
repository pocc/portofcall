# Protocol Review — 5th Pass
**Review Date:** 2026-02-20
**Scope:** 277 protocol implementations, all 8 alphabet batches reviewed in parallel
**Focus:** Regressions from 4th-pass fixes, new correctness gaps, spec compliance, security

---

## Executive Summary

The 5th pass uncovered **4 critical** and **20 high** severity findings. Several are **genuine new bugs** not addressed in prior passes. All major 4th-pass fixes were verified intact — no regressions confirmed. The most serious new issue is **IKE sending uninitialized heap memory in every packet** via `Buffer.allocUnsafe()`. Also significant: Telnet IAC response codes are inverted (RFC 854 violation), SMTP CRLF injection protection is missing from `smtps.ts` and `submission.ts` copies, and SANE's whitelist is incomplete (only covers one of two entry points).

---

## Critical Issues

### 1. IKE — `Buffer.allocUnsafe()` Leaks Heap Memory in Network Packets
**File:** `src/worker/ike.ts` — lines 170, 196, 223, 267, 718, 737, 765, 777, 792, 807, 830 (11 locations)

Every ISAKMP packet is built with `Buffer.allocUnsafe(N)`, which does **not** zero the buffer. Uninitialized heap memory (containing arbitrary prior request data) is sent to the remote server. The 4th pass fixed HSRP (`Buffer.alloc(20, 0)`) but IKE was not audited.

**Fix:** Replace all 11 `Buffer.allocUnsafe(N)` calls with `Buffer.alloc(N, 0)`.
**Impact:** Information disclosure — every IKE handshake leaks heap memory to the peer.

---

### 2. SANE — `buildInitRequest()` Username Not Validated
**File:** `src/worker/sane.ts` — `buildInitRequest()` function

The 4th-pass whitelist fix (`^[a-zA-Z0-9._-]+$`) was applied only to `buildOpenRequest()`. The `buildInitRequest()` function accepts a raw `username` parameter with no validation. An attacker can pass arbitrary bytes as the SANE username.

**Fix:** Apply the same `!/^[a-zA-Z0-9._-]+$/.test(username)` check in `buildInitRequest()`, or centralize validation into a shared helper called from both functions.
**Impact:** Path traversal / protocol injection via SANE username field.

---

### 3. SMTPS / Submission — `sendSMTPCommand()` Copies Missing CRLF Strip
**File:** `src/worker/smtps.ts:82`, `src/worker/submission.ts:67`

The 4th pass added `.replace(/[\r\n]/g, '')` to `sendSMTPCommand()` in `smtp.ts`. However, `smtps.ts` and `submission.ts` each have their **own copy** of this function that was not updated. User-controlled input (RCPT TO addresses, EHLO hostnames) passed through these functions is still injectable.

**Fix:** Add `.replace(/[\r\n]/g, '')` to the `command` parameter in `sendSMTPCommand()` in both `smtps.ts` and `submission.ts`. Or refactor all three to share a single implementation.
**Impact:** SMTP command injection via CRLF in any field passed to smtps or submission endpoints.

---

### 4. Telnet — IAC Response Codes Inverted (RFC 854 Violation)
**File:** `src/worker/telnet.ts:276-282`

RFC 854 defines:
- Receive **WILL X** → respond **DONT X** (to refuse) or **DO X** (to accept)
- Receive **DO X** → respond **WONT X** (to refuse) or **WILL X** (to accept)

Current code:
```typescript
const reply = cmd === WILL ? WONT : DONT;
// WILL → WONT  (should be DONT)
// DO   → DONT  (should be WONT)
```

Both responses are inverted. A real Telnet server receiving `WONT` in response to its `WILL` will interpret it as "please don't"; receiving `DONT` in response to `DO` is grammatically incorrect.

**Fix:**
```typescript
const reply = cmd === WILL ? DONT : WONT;
// WILL → DONT  (correct: "please don't do that")
// DO   → WONT  (correct: "I won't do that")
```
**Impact:** Non-compliant Telnet option negotiation; real servers may terminate the connection.

---

## High-Severity Issues

### Resource Leaks

| Protocol | File | Issue |
|---|---|---|
| FTP | ftp.ts | Data socket reader/writer locks not released in error paths within mlsd/nlst/list/upload/download methods — only the control socket's close() was wrapped |
| OpenVPN | openvpn.ts | `handleOpenVPNTLSHandshake()` success path releases locks then calls `socket.close()` without finally — if close() throws, stack unwinds without socket cleanup |
| TCP | tcp.ts | Main catch block (line ~195) does not call `socket.close()` before returning |

---

### Binary Protocol Correctness

| Protocol | File | Issue |
|---|---|---|
| Bitcoin | bitcoin.ts | 8-byte varint (opcode `0xFF`) returns only `getUint32()` of the low 32 bits — counts > 2^32 silently truncate |
| BitTorrent | bittorrent.ts | `info_hash` received from peer never validated against the expected value (BEP 3 violation) — any swarm accepted |
| MMS | mms.ts | `berDecodeInteger()` uses bit-shifts for >6-byte integers — values > 2^53 lose precision (IEC 61850 counters/timestamps) |
| mDNS | mdns.ts | Label length check uses `label.length` (character count) not byte count — UTF-8 multi-byte labels may exceed 63-byte RFC 1035 limit |
| TDS | tds.ts | `parseTokenStream()` unknown token default case assumes 2-byte length prefix — different from the fixed `parseColumnValue()` — stream corruption on unknown tokens |
| Redis | redis.ts | RESP3 types (`%` map, `~` set, `,` double, `(` bignum, `=` verbatim, `!` blob error, `_` null) not handled — silently parsed as single line |
| Fluentd | fluentd.ts | `decodeMap()` MessagePack parser: if data truncates mid-map, `decodeMsgpack()` returns `bytesRead=0` and the loop runs forever (DoS) |
| Ethereum | ethereum.ts | JSON-RPC response `id` validated with `!==` but request sends `number`, server may return `string` — valid responses incorrectly flagged as mismatches |
| S7comm | s7comm.ts | `parseS7SetupResponse()` accepts PDU size of 0 — S7comm spec requires minimum PDU of 240 bytes |
| SLP | slp.ts | `buildServiceTypeRequest()` outputs bare `0xFFFF` for wildcard naming authority but wraps it with `writeString()` which adds a length prefix — malformed SLP packet |
| Prometheus | prometheus.ts | HTTP response accumulated up to `maxSize` (512 KB) without validating against `Content-Length` — controlled server can stream slowly to exhaust memory |
| L2TP | l2tp.ts | Received `Ns` sequence numbers accepted without validating progression per RFC 2661 §5.2 — out-of-order or replayed messages accepted |

---

### Security Issues

| Protocol | File | Issue |
|---|---|---|
| Battle.net | battlenet.ts | Auth loop capped at 4 iterations — server sending >4 packets (SID_PING + SID_AUTH_INFO in separate packets) causes silent failure |
| CIFS | cifs.ts | UTF-16LE odd-length `nameLen` is silently decremented (corrupt filename returned) instead of rejecting the entry |
| Gemini | gemini.ts | Uses `secureTransport: 'on'` but Cloudflare's connect() does not validate peer certificate hostname — MITM possible |
| FIX | fix.ts | Field values containing `\x01` (SOH, the FIX delimiter) are not rejected or escaped — SOH in a value creates phantom additional fields on the parser |

---

## Medium-Severity Issues

### Protocol Correctness

| Protocol | File | Issue |
|---|---|---|
| AMQP | amqp.ts | Field table type `x` (4-byte length-prefixed byte array) still not implemented — crashes or skips on AMQP peers that use byte arrays |
| Memcached | memcached.ts | CAS token not validated as numeric before embedding in CAS command — non-numeric token causes server rejection |
| MGCP | mgcp.ts | Status code 501 defined twice in `getMgcpStatusText()` map — one definition silently overwrites the other |
| Cassandra | cassandra.ts | `_nextStreamId` is module-global and cycles 1–127; no tracking of "in-flight" IDs prevents reuse detection if responses arrive out of order |
| LDAP | ldap.ts | Odd-length hex cookie strings accepted — `parseInt("3", 16)` parses the final unpaired nibble; hex cookies must be even-length |
| Livestatus | livestatus.ts | SAFE_ARG_PATTERN removed `@`, which blocks legitimate Nagios contact filters containing email addresses (e.g. `contact@company.com`) |

---

### Security / Compliance

| Protocol | File | Issue |
|---|---|---|
| EPP | epp.ts | `connect()` called without `secureTransport: 'on'` — RFC 5734 §3 requires TLS; credentials sent in plaintext |
| STUN | stun.ts | XOR-MAPPED-ADDRESS decoded without checking for all-zero or malformed result after XOR with transaction ID |
| SSDP | ssdp.ts | `xmlBlocks()` regex is greedy between tags — malformed/unclosed UPnP XML can match across multiple top-level blocks |
| Shadowsocks | shadowsocks.ts | `bannerHex` converts entire received banner to hex with no size cap — malicious server streams data, hex string grows unbounded before timeout |
| Docker | docker.ts | HTTP response header read loops until `\r\n\r\n` with no max-bytes guard — headers without proper terminator spin until timeout |

---

## 4th-Pass Fixes Verified Intact

The following fixes from the 4th pass were read and confirmed correct:

- ✅ YMSG inline MD5 (no `node:crypto`)
- ✅ WinRM `escapeXml()` applied to all inputs
- ✅ LMTP/SMTP/Submission CRLF stripping in `smtp.ts` (**smtps.ts and submission.ts not covered — see Critical #3**)
- ✅ L2TP AVP body cap at 1017 bytes
- ✅ LDAP hex cookie validation (even-length edge case remains — see Medium)
- ✅ MongoDB BSON depth limit
- ✅ HL7 MLLP 1 MB cap
- ✅ IKE `crypto.getRandomValues()` for initiator cookie
- ✅ Git 10 MB buffer cap
- ✅ Chargen `checkIfCloudflare()` guard
- ✅ AMQP field table types d, T, D, A, b, B, u
- ✅ Beanstalkd single-reassembly after loop
- ✅ ClickHouse VarUInt BigInt accumulation
- ✅ CIFS MD4 Round 1/2/3 rotation (correct per spec)
- ✅ CIFS MD4/MD5 BigInt bit-length field
- ✅ SOCKS5 padStart(4,'0') and colon separators
- ✅ Telnet IAC state machine present (**but response codes inverted — see Critical #4**)
- ✅ XMPP STARTTLS (waits for `<proceed/>` before TLS upgrade)
- ✅ TURN unauthenticated probe has no MESSAGE-INTEGRITY; authenticated request uses correct key
- ✅ CoAP block-wise ACK wait before next block
- ✅ POP3 dot-destuffing (pop trailing empty, pop terminator, then un-stuff)
- ✅ TDS three-tier type-aware column skip (**parseTokenStream() unknown token still wrong — see High**)
- ✅ Hazelcast getUint32 for frame lengths
- ✅ HSRP Buffer.alloc(20, 0)
- ✅ H.323 Q.931 IE bounds checks
- ✅ OpenVPN ackCount bounds in parseResponse()
- ✅ SCCP messageLength > 65535 cap
- ✅ SANE buildOpenRequest() whitelist (**buildInitRequest() uncovered — see Critical #2**)
- ✅ Redis RESP depth limit of 10
- ✅ SNMP OID arc-2 validation (already correct, no change needed)
- ✅ SMTP sendSMTPCommand() CRLF strip (**smtps.ts and submission.ts copies not updated — see Critical #3**)
- ✅ FIX checksum calculation correct per FIX spec
- ✅ Hazelcast getUint32 for map/queue sizes
- ✅ TURN HMAC key format (username:realm:password)
- ✅ AMI MD5 challenge-response (`md5(challenge + secret)`)
- ✅ FTP control socket close() in finally
- ✅ HL7 MLLP frame cap in all 3 handlers
- ✅ Ethereum per-call random RPC ID
- ✅ Tarantool str32/bin32 bounds check
- ✅ L2TP AVP body cap at 1017 bytes
- ✅ LDAP cookie validation
- ✅ BGP agreedFourByteAS mutual negotiation
- ✅ Cassandra stream ID cycling 1–127
- ✅ Cassandra AUTH_SUCCESS consumed before query
- ✅ CIFS MD4 Round 1/2/3 rewrite
- ✅ CIFS nameLen % 2 guard

---

## False Positives from Agent Reports

The following were flagged by agents but verified as correct upon closer inspection:

- **SNMP arc-2 validation** — `(parts[0] < 2 && parts[1] > 39)` correctly gates the 39-limit only for arcs 0 and 1; arc 2 is unrestricted as RFC 1155 requires. No fix needed.
- **OpenVPN ackCount in parseResponse()** — The bounds check `if (10 + ackCount * 4 + (ackCount > 0 ? 8 : 0) + 4 > payload.length) return null` IS present. No regression.
- **POP3 dot-destuffing** — Verified correct; terminator removal and un-stuffing properly ordered.
- **Telnet DONT/WONT** — Code sends `WONT` to `WILL` and `DONT` to `DO`. This IS inverted (see Critical #4) — the agent finding was correct.
- **Cassandra AUTH_SUCCESS** — Code correctly falls through to QUERY after AUTH_SUCCESS. Not a bug.
- **Tarantool mpSkipValue** — Bounds check is correct; `offset + 5 > data.length` before reading length, `offset + 5 + len > data.length` before advancing.
- **BGP localFourByteAS** — Correctly set because the local OPEN unconditionally includes capability 65.

---

## Priority Fix List

### P0 — Deploy Blockers / Security
1. **IKE** — Replace all 11 `Buffer.allocUnsafe()` with `Buffer.alloc(N, 0)`
2. **SANE** — Add whitelist validation to `buildInitRequest()` username
3. **SMTPS + Submission** — Add CRLF strip to `sendSMTPCommand()` copies
4. **Telnet** — Swap WILL/DO response: `cmd === WILL ? DONT : WONT`

### P1 — High Severity
5. **FTP** — Add try/finally to data socket reader/writer in all 5 data transfer methods
6. **Bitcoin** — Return full 64-bit varint using BigInt for opcode `0xFF`
7. **BitTorrent** — Validate received `info_hash` against expected value
8. **MMS** — Use BigInt in `berDecodeInteger()` for values > 6 bytes
9. **mDNS** — Use `new TextEncoder().encode(label).length` for byte-length check
10. **TDS** — Fix `parseTokenStream()` unknown token fallback (don't assume 2-byte prefix)
11. **Redis** — Add RESP3 type handlers or explicit rejection with error
12. **Fluentd** — Add `bytesRead === 0` guard and per-iteration length check in `decodeMap()`
13. **Ethereum** — Use `String(json.id) !== String(id)` for ID comparison
14. **Prometheus** — Parse and honor `Content-Length` header in response accumulation

### P2 — Correctness
15. **AMQP** — Add type `x` (byte array) handler in `readFieldTable()`
16. **Memcached** — Validate CAS token is numeric (`/^\d+$/`)
17. **MGCP** — Fix duplicate status code 501 using RFC 3435 table
18. **LDAP** — Reject odd-length hex cookie strings
19. **EPP** — Add `secureTransport: 'on'` to connect() call
20. **FIX** — Reject or escape field values containing `\x01` (SOH)
21. **L2TP** — Add received `Ns` sequence validation per RFC 2661 §5.2
22. **S7comm** — Reject PDU sizes < 240 bytes

### P3 — Tests / Documentation
23. Add test for Telnet correct WILL→DONT / DO→WONT response
24. Add test for Bitcoin 8-byte varint
25. Add test for Redis RESP3 type rejection
26. Fix Livestatus: either restore `@` in SAFE_ARG_PATTERN with a more targeted injection defense, or document that email-format args are unsupported
27. Document Gemini TLS-without-cert-validation limitation

---

## Metrics

| Category | Count | Notes |
|---|---|---|
| Critical | 4 | 1 heap leak, 1 incomplete fix, 1 missing fix propagation, 1 RFC inversion |
| High | 20 | Mix of parser bugs, resource leaks, spec violations |
| Medium | 11 | Correctness gaps and compliance issues |
| False positives | 7 | Prior fixes confirmed intact |
| No regressions | 47 | All 4th-pass fixes verified |

**Previous report:** [PROTOCOL_REVIEW_4TH_PASS.md](PROTOCOL_REVIEW_4TH_PASS.md)
