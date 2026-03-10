# Code Review — 21st Pass (2026-02-23)

**Reviewer:** Claude Opus 4.6
**Scope:** Full-stack review — security infrastructure, database/network/industrial protocol handlers, React components, test suite quality
**Method:** Source code audit with cross-reference to RFCs, protocol specs, and prior review findings

---

## Executive Summary

| Severity | Count | Key Areas |
|----------|-------|-----------|
| **CRITICAL** | 8 | SQL/CQL injection in 3 DB handlers, SMTP open relay, Docker arbitrary API proxy, K8s namespace injection, SSRF bypass via IP encoding, test suite vacuous assertions |
| **HIGH** | 18 | HTTP request smuggling (ES/InfluxDB), timer leaks (20+ handlers), MongoDB OOM, FTP SITE command exec, Modbus write validation, missing SSRF test coverage |
| **MEDIUM** | 14 | SMTP dot-stuffing, DNS weak PRNG, VNC readExact desync, Kafka parser bounds, MQTT resource leak, SSH no host key verification, missing infrastructure tests |
| **LOW** | 16 | Timer hygiene, route fall-through, error sanitization scope, Cloudflare detector int arithmetic, backpressure polling unbounded, test architecture |

**New findings since 20th pass:** 56 issues (vs. 35 in pass 20)
**Prior issues still open:** 5 from pass 20 confirmed still present

**Systemic themes:**
1. **Query injection across all database handlers** — MySQL, PostgreSQL, and Cassandra all accept raw user queries with no restriction
2. **HTTP header/request injection** — Elasticsearch and InfluxDB construct raw HTTP requests from user input without CRLF sanitization
3. **Timer leaks are pervasive** — 20+ handlers create `setTimeout` without `clearTimeout`; WebSocket paths bypass `withRequestTimeoutCleanup`
4. **Test suite provides false confidence** — ~70+ tests use `toHaveProperty('success')` as their only assertion, 34+ use `expect(true).toBe(true)`, 462 conditionally guarded assertions never execute
5. **SSRF blocklist has encoding bypasses** — Decimal/hex/octal IP representations bypass the regex-based IPv4 detector

---

## Previous Issues Still Open (from Pass 20)

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| H-5 | HIGH | Origin validation bypassed when header absent (`index.ts:310-321`) | STILL OPEN |
| M-1 | MEDIUM | Checklist KV read-modify-write race condition (`index.ts:4260-4263`) | STILL OPEN |
| M-2 | MEDIUM | Checklist endpoint has no authentication (`index.ts:4245-4268`) | STILL OPEN |
| M-8 | MEDIUM | No 404 for unknown `/api/*` routes (`index.ts:4271`) | STILL OPEN |
| L-4 | LOW | Missing request method validation at router level | STILL OPEN |

---

## CRITICAL Findings

### C-1: MySQL raw SQL execution via COM_QUERY

**File:** `src/worker/mysql.ts:823, 635-639`

`handleMySQLQuery` accepts an arbitrary `query` string from user JSON and sends it as a `COM_QUERY` packet with zero sanitization. No query allowlisting, no read-only enforcement. A user can execute `DROP DATABASE`, `GRANT ALL`, or multi-statement attacks via `;`.

**Impact:** Full remote SQL execution with the authenticated user's privileges.
**Fix:** Allowlist read-only statements (`SELECT`, `SHOW`, `DESCRIBE`, `EXPLAIN`) or reject DDL/DML.

### C-2: PostgreSQL raw SQL execution via SimpleQuery

**File:** `src/worker/postgres.ts:838, 656`

Same pattern as C-1. PostgreSQL's SimpleQuery protocol explicitly supports **multi-statement execution** separated by `;`, making this more dangerous:
```
SELECT 1; DROP TABLE users; --
```

**Impact:** Full arbitrary multi-statement SQL execution.
**Fix:** Use Extended Query protocol (Parse/Bind/Execute, single-statement only) or reject queries containing unquoted `;`.

### C-3: Cassandra raw CQL execution

**File:** `src/worker/cassandra.ts:763, 819`

User-supplied `cql` parameter is passed directly to `buildQueryFrame()`. No validation. Attackers can execute `DROP KEYSPACE`, `TRUNCATE TABLE`, or `BATCH` statements.

**Impact:** Full CQL execution with the authenticated user's privileges.
**Fix:** Restrict to read-only CQL (`SELECT`, `DESCRIBE`, `USE`).

### C-4: SMTP open relay proxy

**File:** `src/worker/smtp.ts:205-387`

`handleSMTPSend` accepts any `from`/`to` addresses and forwards them to any SMTP server. Authentication is optional (lines 269-288). Any unauthenticated port-25 server becomes an open relay through this endpoint, enabling spam, phishing, and spoofing at scale.

**Impact:** Abuse of the service as a spam/phishing relay.
**Fix:** Require authentication credentials for all send operations. Consider restricting target SMTP servers.

### C-5: SMTP command injection via MAIL FROM/RCPT TO

**File:** `src/worker/smtp.ts:291-306`

The `from` and `to` email addresses are interpolated into `MAIL FROM:<...>` and `RCPT TO:<...>` without sanitizing `>` characters. While `sendSMTPCommand` strips `\r\n`, the `>` character can close the angle-bracket context and inject additional SMTP parameters.

**Fix:** Validate `from`/`to` against a strict email regex; reject `<`, `>`, `\r`, `\n`.

### C-6: Docker arbitrary API proxy with RCE

**File:** `src/worker/docker.ts:309-390, 933-1069`

`handleDockerQuery` allows any HTTP method to any Docker API path — far beyond read-only. `handleDockerExec` provides full arbitrary command execution inside containers. `handleDockerContainerCreate` (line 500) creates containers with arbitrary `cmd`, `env`, and image.

**Impact:** Full container escape potential via Docker socket access.
**Fix:** Implement an allowlist of safe read-only paths (`/version`, `/info`, `/_ping`, `/containers/json`, `/images/json`). Gate destructive operations.

### C-7: Kubernetes path traversal via namespace/pod injection

**File:** `src/worker/kubernetes.ts:583, 706, 829`

`namespace` and `pod` parameters are interpolated into API paths without validation. The `safePath` sanitizer allows `/`, `.`, and `%`, enabling path traversal:
```
namespace = "default/pods/victim/exec?command=rm+-rf+/&namespace="
```
`handleKubernetesApply` (line 829) accepts any manifest `kind` including `Secret`, `ClusterRole`, `ClusterRoleBinding`.

**Fix:** Validate namespace/pod against K8s naming regex `^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$`. Allowlist permitted resource kinds for apply.

### C-8: SSRF bypass via alternate IP representations

**File:** `src/worker/host-validator.ts:119`

The IPv4 regex `/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/` only matches dotted-decimal. These bypass the blocklist entirely:
- Decimal: `2130706433` (= 127.0.0.1)
- Hex: `0x7f000001` (= 127.0.0.1)
- Shortened: `127.1` (= 127.0.0.1 on most systems)

Whether `cloudflare:sockets` resolves these depends on the platform resolver, but the validator is the **sole SSRF defense** for non-browser clients (which skip Origin validation per H-5).

**Fix:** Block numeric-only strings, hex notation, and shortened dotted-decimal before the hostname fallback path.

---

## HIGH Findings

### H-1: Elasticsearch HTTP request smuggling via CRLF injection

**File:** `src/worker/elasticsearch.ts:68, 307`

User-supplied `path` is interpolated directly into the HTTP request line:
```typescript
let request = `${method} ${path} HTTP/1.1\r\n`;
```
A path containing `\r\n` enables header injection and request smuggling. The `host` parameter (line 69) has the same issue in the `Host:` header.

**Fix:** Strip `\r` and `\n` from `path`, `host`, and all user values in raw HTTP construction.

### H-2: InfluxDB HTTP request smuggling and auth token injection

**File:** `src/worker/influxdb.ts:85-92`

Same CRLF injection as H-1, plus the `authToken` (line 92) is interpolated into the `Authorization` header without sanitization.

**Fix:** Strip CRLF from all user-supplied values interpolated into HTTP headers/request lines.

### H-3: Missing IPv4 special-use ranges in SSRF blocklist

**File:** `src/worker/host-validator.ts:12-22`

Missing IANA special-use ranges: `0.0.0.0/8` (only /32 blocked — `0.x.x.x` can reach localhost on some systems), `198.18.0.0/15` (benchmarking), `240.0.0.0/4` (reserved/Class E), and TEST-NET ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24).

### H-4: Missing IPv6 6to4 and NAT64 checks

**File:** `src/worker/host-validator.ts:72-101`

`2002::/16` (6to4) encodes IPv4 addresses — `2002:7f00:0001::` maps to 127.0.0.1. `64:ff9b::/96` (NAT64) does the same. Neither is checked.

**Fix:** Extract embedded IPv4 from 6to4/NAT64 addresses and check against `isBlockedIPv4`.

### H-5: MongoDB unchecked message length enables OOM

**File:** `src/worker/mongodb.ts:320-321`

`readFullResponse` reads `expectedLength` from the server with no upper bound. A malicious server can send a 2GB length field, causing OOM. Compare with PostgreSQL which validates `length < 1073741824`.

**Fix:** Add bounds check: `if (expectedLength < 16 || expectedLength > 48 * 1024 * 1024) throw new Error(...)`.

### H-6: FTP SITE command allows OS command execution

**File:** `src/worker/ftp.ts:1112-1156`

`handleFTPSite` passes user-supplied `command` to FTP `SITE` directly. Many FTP servers support `SITE EXEC` for OS-level command execution. Only CRLF is stripped by `sanitizeFTPInput`.

**Fix:** Allowlist permitted SITE subcommands (`CHMOD`, `CHOWN`, `UMASK`). Block `EXEC`.

### H-7: Modbus write operations lack address/value validation

**File:** `src/worker/modbus.ts:440-696`

`handleModbusWriteCoil` and `handleModbusWriteRegisters` accept arbitrary `address` values and `values` arrays without range validation. Values > 65535 or negative numbers silently overflow in bit-shift operations, sending corrupted data to industrial equipment.

**Fix:** Validate `address` in [0, 65535] and each `values` entry in [0, 65535].

### H-8: Timer leaks across 20+ handlers (MySQL, MongoDB, Cassandra, Redis, Elasticsearch, InfluxDB)

**Files:** `mysql.ts:750,854,946,1048`, `mongodb.ts:414,528,617,702,795,890`, `cassandra.ts:264,776,938`, `redis.ts:38,274,569`, `elasticsearch.ts:58`, `influxdb.ts:75`

All create `setTimeout` in `Promise.race` without storing the handle or calling `clearTimeout`. PostgreSQL does this correctly (lines 777-796). Every other database handler leaks timers.

**Fix:** Store timeout handle, `clearTimeout` in `finally` block.

### H-9: Cassandra `readExact` discards excess bytes causing protocol desync

**File:** `src/worker/cassandra.ts:178-195`

When TCP delivers more bytes than requested, excess bytes are silently lost. When `readFrame` calls `readExact(9)` for the header and TCP coalesces header+body into one chunk, the body bytes are discarded. Next `readExact` for the body gets the NEXT frame's data.

**Fix:** Implement a buffered reader (like `PGReader` in postgres.ts) that retains unconsumed bytes.

### H-10: Cassandra frame body length enables OOM

**File:** `src/worker/cassandra.ts:210-212`

The `length` field from the 9-byte header is used without upper bound. A malicious server can send `length = 2147483647` causing OOM.

**Fix:** Add maximum length check.

### H-11: MQTT WebSocket session resource leak on error

**File:** `src/worker/mqtt.ts:511-632`

If the read loop throws after `mqttConnect` succeeds, reader/writer locks are never released. The catch block only calls `mqttSocket?.close()`. The `readLoop` promise runs indefinitely with no cancellation mechanism.

**Fix:** Release reader/writer locks in catch block. Add abort flag for read loop on WS close.

### H-12: Kubernetes apply allows arbitrary resource mutation

**File:** `src/worker/kubernetes.ts:829-996`

`handleKubernetesApply` accepts any manifest `kind` with `force=true`. Creates/modifies Secrets, ClusterRoles, DaemonSets — full cluster compromise with a leaked bearer token.

**Fix:** Allowlist permitted resource kinds.

### H-13: Docker container create accepts arbitrary env/cmd

**File:** `src/worker/docker.ts:500-587`

`handleDockerContainerCreate` accepts arbitrary `env` arrays and `cmd` parameters. Enables running any command in any image with any environment variables.

**Fix:** Restrict to pre-approved images; remove or gate `cmd`/`env`.

### H-14: Redis WebSocket registers duplicate message handlers

**File:** `src/worker/redis.ts:397, 450`

After auth succeeds, a new inner `message` handler is registered without removing the outer handler. Every subsequent message is JSON-parsed twice.

**Fix:** Remove the outer event listener after initialization.

### H-15: Test suite SSRF bypass vectors completely untested

**File:** `tests/host-validator.test.ts`

Zero tests for hex IPs, decimal IPs, octal IPs, shortened IPs, 6to4 addresses, or NAT64 addresses. The test suite cannot detect if SSRF bypass mitigations are ever added or regress.

**Fix:** Add tests for all alternate IP representations.

### H-16: ~70+ tests use `toHaveProperty('success')` as sole assertion

**Files:** Across 134 test files

Tests assert that the response has a `success` key but never check its value. These tests pass regardless of whether the feature works. Combined with the conditional-guard pattern (462 instances of assertions behind `if (data.success)` that never execute), the test suite provides deeply misleading coverage metrics.

### H-17: No timeout upper bound validation

**Files:** `src/worker/tcp.ts:60`, `src/worker/websocket.ts:233`

User-supplied `timeout` has no maximum. A client can send `timeout: 999999999` to hold connections open up to the platform limit.

**Fix:** Clamp to `Math.min(body.timeout || 10000, 30000)`.

### H-18: 34+ tests use `expect(true).toBe(true)`

**Files:** STUN, TURN, LDAPS, Submission, Radius, IRCs, POP3s, EPP test files

Placeholder assertions that always pass regardless of implementation state. These count toward coverage metrics without testing anything.

---

## MEDIUM Findings

### M-1: SMTP dot-stuffing fails on Unix line endings

**File:** `src/worker/smtp.ts:334`

The regex `/(^|\r\n)\./g` only handles `\r\n` line endings. If `options.body` uses `\n` (Unix-style), lines starting with `.` are not stuffed. A body line of just `.` + `\n` terminates the DATA phase early, potentially injecting SMTP commands.

**Fix:** Normalize body to `\r\n` before dot-stuffing: `options.body.replace(/\r?\n/g, '\r\n')`.

### M-2: DNS query ID uses `Math.random()` instead of crypto PRNG

**Files:** `src/worker/dns.ts:208`, `src/worker/doh.ts:84`

DNS query IDs generated with `Math.random()` are predictable. Weakens defense against response injection in TCP DNS.

**Fix:** Use `crypto.getRandomValues(new Uint8Array(2))`.

### M-3: VNC `readExact` discards excess bytes

**File:** `src/worker/vnc.ts:58-75`

Same pattern as Cassandra H-9. During VNC auth, if challenge bytes arrive in the same TCP segment as security types, the challenge is misread, causing guaranteed auth failure.

**Fix:** Implement buffered reader.

### M-4: Kafka binary parser lacks bounds checks

**File:** `src/worker/kafka.ts:363-366`

`view.getInt16(offset)` for `hostLen` can return negative values from a malicious broker, causing `RangeError` on `new Uint8Array(...)`.

**Fix:** Handle negative lengths as null/empty strings.

### M-5: SSH host key verification skipped

**File:** `src/worker/ssh2-impl.ts:509`

KEXECDH_REPLY host key signature is never read or verified. MITM attacker can substitute their own ephemeral key and decrypt all traffic.

### M-6: MySQL `readLengthEncodedInt` missing bounds checks

**File:** `src/worker/mysql.ts:124-142`

Multi-byte length markers (0xfc, 0xfd, 0xfe) read beyond buffer without checking `offset + N < data.length`. Malformed packets produce corrupted length values.

### M-7: MySQL `buildPacket` silently truncates payloads > 16MB

**File:** `src/worker/mysql.ts:104-113`

3-byte length field wraps silently for large payloads. No multi-packet splitting implemented.

### M-8: MySQL signed shift produces negative connection IDs

**File:** `src/worker/mysql.ts:238-242`

`<< 24` treats result as signed int32. Connection IDs with bit 31 set display as negative.

**Fix:** Add `>>> 0` for unsigned interpretation.

### M-9: MongoDB `decodeBSON` doesn't validate `docLength`

**File:** `src/worker/mongodb.ts:90-93`

No check that `startOffset + docLength <= data.length`. Malformed BSON causes RangeError.

### M-10: Elasticsearch auth skipped for empty passwords

**File:** `src/worker/elasticsearch.ts:176-184`

`if (username && password)` skips auth when password is empty string (valid in some ES configs).

### M-11: Missing test files for critical infrastructure

**Files:** No tests for `websocket-pipe.ts`, `timers.ts`, `response-middleware.ts`, `router-guards.ts`

These implement the WebSocket-to-TCP tunnel, timer cleanup, security headers, and router-level SSRF guards. Zero dedicated tests.

### M-12: Kafka varint decoder has no maximum shift guard

**File:** `src/worker/kafka.ts:1002-1016`

`decodeVarint` increments `shift` by 7 without bounding. Malformed records with all continuation bits set cause excessive CPU.

### M-13: MongoDB missing Cloudflare check on find/insert

**File:** `src/worker/mongodb.ts:610, 690`

`handleMongoDBUpdate`/`Delete` call `checkIfCloudflare`, but `Find`/`Insert` skip it.

### M-14: FTP/Docker download has no file size limit

**Files:** `src/worker/ftp.ts:474-530`, `src/worker/docker.ts:694-722`

Downloads accumulate all data in memory with no size limit. 128MB Worker memory limit is the only protection.

---

## LOW Findings

### L-1: Consul/Checklist routes fall through on unhandled methods

**Files:** `src/worker/index.ts:1449-1453, 4245-4268`

PUT/PATCH/OPTIONS requests to `/api/consul/kv/*` and `/api/checklist` fall through to the SPA handler returning 200 HTML instead of 405.

### L-2: WebSocket upgrade header comparison case inconsistency

**File:** `src/worker/index.ts:306 vs 413+`

Top-level check uses `toLowerCase()`, per-route checks use case-sensitive `=== 'websocket'`. Clients sending `Upgrade: WebSocket` would be treated as WS at the middleware level but HTTP at the route level.

### L-3: Error sanitization bypass uses overly broad prefix matching

**File:** `src/worker/response-middleware.ts:30`

`pathname.startsWith('/api/connect')` and `/api/tcp` match hypothetical future routes like `/api/connection-manager` or `/api/tcp-stats`.

### L-4: Checklist POST has no length/content validation for string keys

**File:** `src/worker/index.ts:4253-4263`

No length limit on `protocolId` and `item` strings. An attacker can fill the single KV key with arbitrary entries.

### L-5: Body size limit only applies to POST

**File:** `src/worker/index.ts:328`

PUT/PATCH/DELETE with bodies bypass the 1MB size check.

### L-6: Cloudflare detector `ipv4ToInt` uses signed shift (fragile)

**File:** `src/worker/cloudflare-detector.ts:42-50`

`<< 24` produces negative numbers for octets >= 128. Works due to consistent signedness but is fragile if anyone adds `>>> 0` to one side.

### L-7: Backpressure polling loop has no maximum wait time

**File:** `src/worker/websocket-pipe.ts:221-223`

`while (ws.bufferedAmount > HIGH_WATER_MARK)` with 50ms polling has no upper bound. A stalled client holds resources indefinitely.

### L-8: Router-level Cloudflare guard is allowlist-based

**File:** `src/worker/router-guards.ts:11-81`

New protocols added without being registered in `ROUTER_CLOUDFLARE_GUARD_PROTOCOLS` silently lack Cloudflare loop-back protection.

### L-9: WebSocket upgrades skip timer cleanup wrapper

**File:** `src/worker/index.ts:4274-4276`

WebSocket upgrade paths call `executeRequest()` directly, bypassing `withRequestTimeoutCleanup`.

### L-10: MySQL `parseHandshake` has no bounds checking

**File:** `src/worker/mysql.ts:222-299`

Position incremented without checking `pos < payload.length`. Truncated handshake packets produce silently corrupted data.

### L-11: Redis `formatRESPResponse` trim may misidentify value types

**File:** `src/worker/redis.ts:306-347`

`resp.trim()` strips all whitespace before type detection. Bulk strings starting with `+` or `-` after trimming could be misidentified.

### L-12: Elasticsearch/InfluxDB chunked decoding doesn't handle chunk extensions

**Files:** `src/worker/elasticsearch.ts:146-171`, `src/worker/influxdb.ts:163-187`

`parseInt(sizeStr, 16)` works by accident (stops at `;`), but is spec-noncompliant.

### L-13: Kubernetes `safePath` allows percent-encoded path traversal

**File:** `src/worker/kubernetes.ts:456, 599, 727, 924`

`safePath` allows `%` and digits. `%2F` (/) and `%2E%2E` (..) pass through.

### L-14: Duplicate test files

**Files:** `tests/cloudflare-detector.test.ts` and `tests/cloudflare-detection.test.ts`

Overlapping tests for the same functionality.

### L-15: Docker log parser size field can cause memory pressure

**File:** `src/worker/docker.ts:694-722`

Malformed log header with large `size` field causes large slice operations within the 1MB read limit.

### L-16: FTP upload has no file size check

**File:** `src/worker/ftp.ts:1161-1212`

`handleFTPUpload` reads entire file into memory via `file.arrayBuffer()` without checking `file.size`.

---

## Positive Findings

- **Zero XSS vectors** — No `dangerouslySetInnerHTML` or `innerHTML` anywhere in the frontend
- **SSH credential handling is exemplary** — First-message pattern, cleared on unmount
- **Terminal output is bounded** — SSH/Telnet/Redis cap output at 500 entries
- **Error boundary with accessibility** — `componentDidUpdate` focuses error alert
- **Offline detection** — `useOnlineStatus` hook provides network interruption UX
- **Backpressure and write serialization are correct** — Certified in passes 18-19
- **PostgreSQL timer cleanup is the gold standard** — All other handlers should follow its pattern
- **Cloudflare IP ranges are current** — Verified against live Cloudflare IP pages
- **Form validation infrastructure is good** — `useFormValidation` hook with proper ARIA attributes

---

## Recommended Remediation Priority

### Immediate (security impact)
1. Fix SSRF encoding bypass — block decimal/hex/shortened IPs (C-8, H-3, H-4)
2. Add read-only enforcement to MySQL/PostgreSQL/Cassandra query endpoints (C-1, C-2, C-3)
3. Sanitize CRLF in Elasticsearch/InfluxDB raw HTTP construction (H-1, H-2)
4. Validate K8s namespace/pod against naming regex (C-7)
5. Restrict Docker API to read-only paths (C-6)
6. Require SMTP auth and validate sender addresses (C-4, C-5)

### Short-term (correctness + resource safety)
7. Fix timer leaks across all database handlers following PostgreSQL pattern (H-8)
8. Implement buffered readers for Cassandra and VNC (H-9, M-3)
9. Add message length bounds to MongoDB and Cassandra (H-5, H-10)
10. Fix MQTT WebSocket resource cleanup (H-11)
11. Allowlist FTP SITE subcommands (H-6)
12. Validate Modbus address/value ranges (H-7)

### Medium-term (test quality + robustness)
13. Add unit tests for host-validator SSRF bypass vectors (H-15)
14. Add tests for websocket-pipe, timers, response-middleware, router-guards (M-11)
15. Fix vacuous test assertions — check `success === true` not just `toHaveProperty` (H-16)
16. Add timeout upper bounds (H-17)
17. Return 404 for unknown `/api/*` routes (M-8 from pass 20)

---

## Comparison to Previous Reviews

| Review | Date | Focus | Critical | High | Medium | Low |
|--------|------|-------|----------|------|--------|-----|
| Pass 13 | 2026-02-20 | SSRF, deadlocks, socket leaks | 2 | 2 | 1 | — |
| Pass 14-15 | 2026-02-20 | Remediation + verification | All fixed | — | — | — |
| Pass 16-17 | 2026-02-20 | Data plane certification | — | 4 fixed | — | — |
| Pass 18-19 | 2026-02-20 | Certification audit | All PASS | — | — | — |
| GPT Review | 2026-02-19 | 238 protocol modules | 34 | 25 | 18 | 10 |
| **Pass 20** | **2026-02-23** | Full-stack + security | **5** | **12** | **10** | **8** |
| **Pass 21** | **2026-02-23** | Full-stack + DB injection + test quality | **8** | **18** | **14** | **16** |

**New findings not in any previous review:**
- SQL/CQL injection in MySQL, PostgreSQL, Cassandra query handlers (C-1, C-2, C-3)
- SMTP open relay and command injection (C-4, C-5)
- Docker/K8s arbitrary mutation vectors (C-6, C-7, H-12, H-13)
- HTTP request smuggling via CRLF in Elasticsearch/InfluxDB (H-1, H-2)
- Timer leak quantification: 20+ handlers with PostgreSQL as correct reference (H-8)
- MongoDB/Cassandra OOM via unchecked server lengths (H-5, H-10)
- Test suite quality analysis: vacuous assertions, tautological tests, missing infrastructure tests (H-15, H-16, H-18, M-11)
- FTP SITE EXEC, Modbus write validation, MQTT resource leak (H-6, H-7, H-11)
