# Code Review — 20th Pass (2026-02-23)

**Reviewer:** Claude Opus 4.6
**Scope:** Full-stack review — worker infrastructure, 20+ protocol handlers, React components, security controls
**Method:** Source code audit with cross-reference to specs (RFCs, protocol documentation)

---

## Executive Summary

| Severity | Count | Key Areas |
|----------|-------|-----------|
| **CRITICAL** | 5 | IEC 104 I-frame detection, PostgreSQL SQL injection, AMQP wire format, rexec/rsh SSRF+credential exposure |
| **HIGH** | 12 | SSRF bypass via encoded IPs, FTP PASV SSRF, Redis RESP corruption, credential leaks in query params, Docker/K8s write access, Bolt version encoding |
| **MEDIUM** | 10 | Origin bypass for non-browser clients, checklist race condition, Cassandra paging, POP3 double-unstuff, IMAP race conditions |
| **LOW** | 8 | Timer leaks (systemic), missing method validation, type safety casts, minor spec deviations |

**Systemic issues** (affecting 20+ handlers):
1. `setTimeout` without `clearTimeout` in every `Promise.race` pattern
2. Socket leak on external timeout (inner socket never closed when outer race wins)
3. `readExact` implementations silently discard excess bytes (AMQP, VNC, Cassandra)

---

## CRITICAL Findings

### C-1: IEC 104 I-frame detection drops every other frame

**File:** `src/worker/iec104.ts` lines 764, 818, 1049
**Spec:** IEC 60870-5-104 §5.2

The I-frame check uses `(cf0 & 0x03) === 0` but should be `(cf0 & 0x01) === 0`. Per the spec:
- I-frame: bit 0 = 0
- S-frame: bits 1:0 = `01`
- U-frame: bits 1:0 = `11`

The current mask `0x03` requires BOTH bits 0 and 1 to be zero. When the server sends an I-frame with N(S) values where bit 1 of the first control byte is set (e.g., `cf0 = 0x02` for N(S)=1), `0x02 & 0x03 = 0x02 !== 0` — the frame is silently dropped. This means **every other I-frame is lost**, causing data loss and incorrect acknowledgment sequence numbers.

**Impact:** Industrial control data reads return incomplete/incorrect data. SCADA monitoring would miss 50% of data points.

### C-2: PostgreSQL NOTIFY payload allows SQL injection

**File:** `src/worker/postgres.ts` line 1283

```typescript
`SELECT pg_notify($$${channel}$$, $$${payload}$$)`
```

The `channel` is validated with `/^[a-zA-Z_][a-zA-Z0-9_]*$/`, but `payload` has **no validation**. If payload contains `$$`, it breaks out of dollar-quoting:

```
payload = "$$), pg_sleep(10)--"
→ SELECT pg_notify($$channel$$, $$$$), pg_sleep(10)--$$)
```

**Fix:** Use a unique tag like `$poc$` and reject payloads containing that tag, or use parameterized queries.

### C-3: AMQP Basic.Publish sends extra byte in frame

**File:** `src/worker/amqp.ts` lines 410-412

`mandatory` and `immediate` are sent as two separate bytes:
```typescript
new Uint8Array([0x00]),  // mandatory
new Uint8Array([0x00]),  // immediate
```

Per AMQP 0-9-1 spec, these are **bits packed into a single octet** (bit 0 = mandatory, bit 1 = immediate). The extra byte shifts the frame end marker by 1, causing the broker to reject the frame or misparse subsequent frames.

### C-4: rexec WebSocket handler has no per-handler SSRF check

**File:** `src/worker/rexec.ts` lines 217-302

`handleRexecWebSocket` reads `host` from query params and calls `connect()` on line 240 without calling `isBlockedHost` or `checkIfCloudflare`. While the router-level SSRF guard covers private IPs via query params, `rexec` is NOT in `ROUTER_CLOUDFLARE_GUARD_PROTOCOLS`, so the Cloudflare loop-back guard is skipped entirely.

### C-5: rexec credentials and commands exposed in URL query parameters

**File:** `src/worker/rexec.ts` lines 220-224

```typescript
const username = url.searchParams.get('username') || 'guest';
const password = url.searchParams.get('password') || '';
const command = url.searchParams.get('command') || 'id';
```

Unix login credentials AND shell commands appear in:
- Server access logs / Cloudflare analytics
- Browser history and referrer headers
- Any CDN/proxy logs

Same issue in `src/worker/rsh.ts` lines 346-350.

---

## HIGH Findings

### H-1: SSRF bypass via alternative IP representations

**File:** `src/worker/host-validator.ts` lines 119-121

`isBlockedHost` only recognizes dotted-decimal IPv4. These bypass the check:
- Hex: `0x7f000001` (= 127.0.0.1)
- Decimal: `2130706433` (= 127.0.0.1)
- Octal: `0177.0.0.1` (parsed as 177.0.0.1 by parseInt base-10)

If `cloudflare:sockets` `connect()` resolves these formats internally, this is a live SSRF bypass to loopback/private addresses.

### H-2: FTP PASV response enables SSRF to arbitrary internal hosts

**File:** `src/worker/ftp.ts` lines 329-338

`enterPassiveMode()` connects to the IP returned in the server's PASV response without validation. A malicious FTP server can return `127,0,0,1,p1,p2` to redirect the data connection to localhost or any internal IP. The Cloudflare check only guards the initial control connection.

**Fix:** Validate PASV IP matches the original control connection host, or run `isBlockedHost` on the PASV IP.

### H-3: Redis RESP binary safety bug

**File:** `src/worker/redis.ts` lines 21-28

```typescript
resp += `$${bytes.length}\r\n${arg}\r\n`;
```

`bytes.length` is the UTF-8 byte count, but `arg` is the JavaScript string (character count). For multi-byte UTF-8 characters, the `$N` prefix declares N bytes but the string template produces a different number of bytes. This corrupts the RESP frame.

**Fix:** Build the entire RESP frame as a byte buffer, not mixed string/byte operations.

### H-4: Neo4j Bolt version encoding is reversed

**File:** `src/worker/neo4j.ts` lines 354-358

```typescript
view.setUint32(4, 0x00000504);  // claims v5.4
```

The Bolt version format is `{padding, range, minor, major}` as 4 bytes big-endian. `setUint32(4, 0x00000504, false)` writes bytes `0x00, 0x00, 0x05, 0x04` which the server reads as padding=0, range=0, minor=5, major=4 — i.e., **version 4.5, not 5.4**. All four version entries are affected.

### H-5: Origin validation bypassed when header is absent

**File:** `src/worker/index.ts` lines 310-321

```typescript
if (origin) {
  // validation only runs if Origin is present
}
```

Non-browser clients (curl, scripts, custom tools) can omit the `Origin` header entirely and bypass origin validation. This means programmatic SSRF attacks are not mitigated by the origin check.

### H-6: IRC WebSocket credentials in URL query parameters

**File:** `src/worker/irc.ts` lines 306-315

```typescript
const password = url.searchParams.get('password') || '';
const saslUsername = url.searchParams.get('saslUsername') || '';
const saslPassword = url.searchParams.get('saslPassword') || '';
```

Same pattern in MQTT (`src/worker/mqtt.ts` lines 492-493), IMAP (`src/worker/imap.ts` lines 570-573), and rlogin (`src/worker/rlogin.ts`). The Redis handler correctly avoids this by using first-message auth — all WebSocket handlers should follow that pattern.

### H-7: Docker handler enables arbitrary container operations

**File:** `src/worker/docker.ts`

- `handleDockerQuery` (line 309) is an open HTTP proxy accepting arbitrary method/path/body
- `handleDockerContainerCreate` (line 500) creates containers
- `handleDockerExec` (line 933) enables remote code execution inside containers
- Only `handleDockerHealth` calls `checkIfCloudflare`; others rely solely on router guard

### H-8: Kubernetes handler allows resource creation via server-side apply

**File:** `src/worker/kubernetes.ts` line 829

`handleKubernetesApply` sends PATCH requests to the K8s API server. Only `handleKubernetesProbe` and `handleKubernetesQuery` call `checkIfCloudflare`.

### H-9: LDAP filter injection

**File:** `src/worker/ldap.ts` lines 634-638

Equality filter values are not escaped for LDAP special characters (`*`, `(`, `)`, `\`, NUL). User-controlled filter input can inject arbitrary LDAP filter logic.

### H-10: SSH authentication sent without completing key exchange

**File:** `src/worker/ssh.ts` lines 960-1001

`handleSSHAuth` sends `SSH_MSG_SERVICE_REQUEST` and `SSH_MSG_USERAUTH_REQUEST` without completing key exchange. Per RFC 4253, all messages after `SSH_MSG_KEXINIT` must be encrypted. Spec-compliant servers will disconnect.

### H-11: Legacy LDAP BER encoding fails for values > 127 bytes

**File:** `src/worker/ldap.ts` lines 398-446

`encodeLDAPBindRequest` uses single-byte BER length encoding. Bind DNs longer than 127 bytes produce malformed LDAP messages (BER long form not used).

### H-12: rsh trust-scan enables automated credential enumeration

**File:** `src/worker/rsh.ts` lines 456-615

`handleRshTrustScan` tests up to 25 username combinations in parallel against a target host. While it calls `checkIfCloudflare`, it does NOT call `isBlockedHost` per-handler. This is essentially an automated .rhosts brute-force tool.

---

## MEDIUM Findings

### M-1: Checklist KV race condition (root cause of "save failed" bug)

**Files:** `src/worker/index.ts` lines 4260-4263, `src/components/ChecklistTab.tsx` lines 35-61

The checklist stores all state in a single KV key `"state"`. Every save does read-modify-write without locking. Concurrent saves silently overwrite each other. The optimistic UI update + revert on failure creates additional race conditions with rapid toggling.

### M-2: Checklist endpoint has no authentication

**File:** `src/worker/index.ts` lines 4244-4268

Any visitor to the site can read and write all checklist state. There is no session, API key, or any authentication on GET or POST.

### M-3: Cassandra result parsing ignores paging flag

**File:** `src/worker/cassandra.ts` lines 700-701

`parseResultRows` does not check the `Has_more_pages` flag (0x0002). When paging is enabled, a `<bytes>` paging state appears between flags and column count. Unpaged responses parse correctly; paged responses produce garbled column counts.

### M-4: POP3 double dot-unstuffing

**File:** `src/worker/pop3.ts` line 731

`handlePOP3Top` performs dot-unstuffing on content that was already unstuffed by `readPOP3MultiLine` (lines 93-100). A line originally `..hello` → `.hello` (first unstuff) → `hello` (second unstuff, incorrect).

### M-5: POP3 RETRIEVE slices already-processed content

**File:** `src/worker/pop3.ts` lines 498-501

`handlePOP3Retrieve` strips the first and last two lines of content that was already processed by `readPOP3MultiLine` (which removes `+OK` prefix and `.` terminator). This truncates the actual message body.

### M-6: IMAP SELECT mailbox name not quoted

**File:** `src/worker/imap.ts` line 480

```typescript
`SELECT ${mailbox}`
```

Per RFC 3501, mailbox names with spaces/special chars must be quoted. An `imapQuote` function exists but is not used here.

### M-7: IMAP WebSocket concurrent write race condition

**File:** `src/worker/imap.ts` lines 637-653

Multiple WebSocket messages arriving quickly trigger concurrent `sendIMAPCommand` calls that interleave reads/writes on the same reader/writer, corrupting IMAP protocol state.

### M-8: No 404 for unknown API routes

**File:** `src/worker/index.ts` line 4271

Any `/api/unknown-path` falls through to `env.ASSETS.fetch(request)`, returning 200 with the SPA HTML. API consumers see misleading responses.

### M-9: Cassandra global mutable stream IDs

**File:** `src/worker/cassandra.ts` lines 664-669

`_nextStreamId` is module-level global state shared across concurrent requests in the same isolate. Concurrent Cassandra connections get sequential IDs from a shared counter, potentially causing stream ID conflicts.

### M-10: Modbus global mutable transaction counter

**File:** `src/worker/modbus.ts` line 37

Same pattern as Cassandra — `transactionCounter` is shared across requests.

---

## LOW Findings

### L-1: Systemic `setTimeout` without `clearTimeout`

**Affects:** All 20+ protocol handlers reviewed

Every `Promise.race([workPromise, timeoutPromise])` pattern creates a timer that is never cleared when the work promise resolves first. The `withRequestTimeoutCleanup` wrapper in `timers.ts` handles cleanup at the request level, but individual handler timeouts still fire unnecessarily.

### L-2: Systemic socket leak on external timeout

**Affects:** FTP, Redis, IMAP, POP3, Telnet, AMQP, Cassandra, Modbus, IEC 104, FINS

When the outer `Promise.race` resolves with the timeout, the inner async function containing the socket continues executing. The socket is never closed because the error path only runs on internal errors, not race cancellation.

### L-3: `readExact` discards excess bytes

**Affects:** AMQP (`amqp.ts:154`), VNC (`vnc.ts:58`), Cassandra (`cassandra.ts:178`)

When TCP delivers more bytes than requested, excess bytes are silently discarded. If protocol frames are coalesced into a single TCP segment, subsequent reads get corrupted data.

### L-4: Missing request method validation (router level)

**File:** `src/worker/index.ts`

~70% of API routes have no method validation at the router level. They accept GET, PUT, DELETE, etc. Some handler functions check internally, but the pattern is deeply inconsistent.

### L-5: S7comm timing-based read instead of TPKT length

**File:** `src/worker/s7comm.ts` lines 219-242

`readTPKTPacket` uses a 500ms timeout to detect packet boundaries instead of using the TPKT length field (bytes 2-3). Slow TCP segments cause truncated reads.

### L-6: MongoDB BSON_DATETIME/INT64 signed reconstruction bug

**File:** `src/worker/mongodb.ts` lines 154-158, 180-184

Signed 64-bit values reconstructed from unsigned `lo` and signed `hi` produce incorrect results for negative values (dates before 1970). Should use `DataView.getBigInt64()`.

### L-7: SSH banner length unbounded

**File:** `src/worker/ssh.ts` lines 786-818

`readSSHBanner` has no maximum banner length check. A malicious server that never sends CRLF causes `bannerBytes` to grow until the request timeout fires. RFC 4253 limits banners to 255 characters.

### L-8: `App.tsx` hash-to-Protocol unsafe cast

**File:** `src/App.tsx` line 534

`hash as Protocol` on user-controlled URL input defeats TypeScript type safety. Not exploitable (React auto-escapes, switch has default), but indicates a pattern gap.

---

## Known Critical Gaps (Incomplete Implementations)

These were documented in previous reviews and remain unchanged:

| Protocol | File | Gap |
|----------|------|-----|
| SFTP | `sftp.ts:484-570` | All file operations (list, download, upload, delete, mkdir, rename) return HTTP 501 |
| MySQL | `mysql.ts` | Query execution works but has no prepared statement support |
| LDAP | `ldap.ts:628-643` | Filter parser only supports equality and presence; AND/OR/NOT/substring unsupported |
| Neo4j | `neo4j.ts` | Missing PackStream types: String32, Map16/32, List16/32, Bytes8/16/32 |

---

## Positive Findings

- **XSS:** Zero uses of `dangerouslySetInnerHTML` or `innerHTML` in the entire frontend. React auto-escaping handles all rendering.
- **SSRF defense-in-depth:** Router-level guard + per-handler Cloudflare checks + host-validator provide layered protection (despite the gaps noted above).
- **Backpressure control:** `websocket-pipe.ts` correctly implements backpressure with 1 MiB high-water mark and 50ms drain polling.
- **Write serialization:** `pipeWebSocketToSocket` correctly uses promise-chain serialization for FIFO ordering.
- **Timer cleanup:** `withRequestTimeoutCleanup` in `timers.ts` is a solid global safety net via `AsyncLocalStorage`.
- **Security headers:** Response middleware adds X-Frame-Options, X-Content-Type-Options, HSTS, and Cache-Control: no-store for all API routes.
- **SSH credential handling:** SSHClient.tsx sends credentials via first WebSocket message (not URL) and clears state on unmount.
- **Error boundary:** App.tsx wraps all protocol components in Suspense + ErrorBoundary with proper recovery.

---

## Recommended Remediation Priority

### Immediate (security impact)
1. Fix IEC 104 I-frame mask: `(cf0 & 0x01) === 0` (C-1)
2. Sanitize PostgreSQL NOTIFY payload against `$$` (C-2)
3. Fix AMQP mandatory/immediate to single octet (C-3)
4. Move rexec/rsh/IRC/MQTT/IMAP WebSocket credentials to first-message pattern (C-4, C-5, H-6)
5. Add encoded IP normalization to `isBlockedHost` (H-1)
6. Validate FTP PASV IP against control connection host (H-2)

### Short-term (correctness)
7. Fix Redis RESP binary safety (H-3)
8. Fix Neo4j Bolt version byte order (H-4)
9. Fix POP3 double-unstuffing and retrieve slicing (M-4, M-5)
10. Quote IMAP SELECT mailbox names (M-6)
11. Serialize IMAP WebSocket commands (M-7)
12. Fix Cassandra paging flag handling (M-3)

### Medium-term (robustness)
13. Add buffered reader to AMQP/VNC/Cassandra to fix `readExact` data loss (L-3)
14. Add per-handler `isBlockedHost` as defense-in-depth for rexec, rsh, Docker, K8s (H-7, H-8, H-12)
15. Fix checklist race condition (use KV compare-and-swap or per-item keys) (M-1)
16. Return 404 JSON for unknown `/api/*` routes (M-8)
17. Fix S7comm to use TPKT length field instead of timing (L-5)

---

## Comparison to Previous Reviews

| Review | Date | Focus | Critical Bugs |
|--------|------|-------|---------------|
| Passes 3-12 | Various | Protocol handler correctness | N/A (initial review) |
| Pass 13 | Various | SSRF, deadlocks, socket leaks | 2 CRITICAL, 2 HIGH |
| Pass 14-15 | Various | Remediation + verification | All 5 fixed |
| Pass 16-17 | Various | Data plane: backpressure, chunking | 4 fixed |
| Pass 18-19 | Various | Certification audit | All PASS |
| GPT Review | 2026-02-19 | 238 protocol modules | 87 critical/high |
| **Pass 20** | **2026-02-23** | **Full-stack + security + spec compliance** | **5 CRITICAL, 12 HIGH** |

New findings not in previous reviews:
- IEC 104 I-frame mask bug (C-1)
- PostgreSQL NOTIFY injection (C-2)
- AMQP wire format bug (C-3)
- Neo4j Bolt version encoding (H-4)
- Encoded IP SSRF bypass (H-1)
- FTP PASV SSRF (H-2)
- Redis RESP binary safety (H-3)
- POP3 double-unstuffing (M-4, M-5)
- Cassandra paging flag (M-3)
- Checklist race condition root cause (M-1)
