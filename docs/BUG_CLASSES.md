# Protocol Review — Bug Classes

Identified across all protocol implementations during the 2026-02-18 review campaign.
Updated 2026-02-26 to include Class 14 (14A-14G) Worker/TCP runtime edge cases.
Ordered by prevalence. Use this as a checklist when writing or reviewing new protocol handlers.

---

## Class 1 — Resource Leaks

### 1A — Timeout handle leaks *(NOT a finding in Cloudflare Workers)*
`setTimeout()` called but handle never stored or cleared with `clearTimeout()`. When
`Promise.race()` resolves via the non-timeout path, the timer keeps running.

**Workers verdict:** Platform tears down all timers at request end. File as LOW only if
there is a within-request observable effect; otherwise do not file.

### 1B — Reader/writer lock leaks
A `ReadableStreamDefaultReader` or `WritableStreamDefaultWriter` is acquired via
`.getReader()` / `.getWriter()` but `releaseLock()` is not called on every code path.
Common patterns:

- `releaseLock()` only in the happy path, not inside a `finally` block
- `reader.releaseLock()` called after `writer.close()` — if `close()` throws, the reader
  lock is never released
- Early `return` or `throw` inside a `try` block that bypasses a `releaseLock()` outside
  the `finally`

**Real finding if:** holding the lock prevents the socket from closing cleanly within the
same request, or causes an error when the same stream is reused later in the handler.
**Not a finding if:** the handler closes the socket unconditionally in `finally` regardless
of lock state.

### 1C — Socket not closed on error
A `TCPSocket` (or equivalent transport) is opened but `socket.close()` is not called on
every code path. Common patterns:

- `socket.close()` only in the success path, not in a `finally` block
- `socket.close()` inside `catch` but missing from the success path (inverted coverage)
- `connect()` called outside `try` — if the connection succeeds but the next line throws,
  the socket is never closed

**Real finding if:** the upstream server observes a half-open TCP connection and hangs,
causing the user to see a timeout or stalled response on their next call to the same
server.
**Not a finding if:** the isolate lifetime (< 30 s) makes this unobservable — file LOW
only.

---

## Class 2 — SSRF / Missing Cloudflare Detection

Handlers connect to a user-supplied `host` without calling `checkIfCloudflare()` first,
allowing requests to be routed to internal Cloudflare infrastructure.

**Prevalence:** 40+ protocols.

---

## Class 3 — Data Corruption / Encoding

### 3A — TextDecoder without `{ stream: true }`
Multi-byte UTF-8 sequences split across TCP chunks are decoded incorrectly, producing
mojibake or replacement characters.

### 3B — Endianness errors
`DataView` reads without an explicit `littleEndian` flag, or the wrong endian for the
protocol (e.g., treating a big-endian length field as little-endian).

### 3C — Bounds not checked before read
Buffer overread from trusting a length field in a packet header without validating it
fits within the actual buffer first.

### 3D — Chunk-count safety-cap after push
The overflow check fires *after* `chunks.push(value)`, so the array contains more data
than the byte counter reflects. Downstream code that trusts the counter gets a wrong
answer.

**Prevalence:** 50+ protocols.

---

## Class 4 — Feature Completeness Gaps

### 4A — Implemented method with no HTTP handler
A client method exists (e.g. `FTPClient.rmdir()`) but no route or HTTP handler was wired
up, making the feature unreachable from the API.

### 4B — Response mismatch / unsolicited messages accepted
A read loop accepts any server message as the response to a pending command, rather than
matching on a correlation ID or command type. Unsolicited server events can be mistaken
for responses.

### 4C — Anonymous / edge-case auth broken
`!password` rejects an empty string (`!""` is `true`), breaking anonymous login or any
protocol that uses an empty password. Use `password == null` instead.

### 4D — Fallback mode misreported
When a primary operation fails and falls back to an alternative, the response still
reports the primary mode (e.g. `mode: 'mlsd'` after falling back to `LIST`).

### 4E — Single-shot read silently truncates large results
A single `Tread` / `read()` call is used where the spec requires looping until EOF or an
empty response. Large directories or large payloads are silently truncated.

---

## Class 5 — Injection Vulnerabilities

### 5A — Command / SQL / Lua injection
User input passed directly into protocol commands without sanitization or
parameterization.

### 5B — Path traversal
Filenames or resource identifiers not validated — `../../../etc/passwd` passes
`encodeURIComponent` but still traverses directories on the target server.

### 5C — CRLF / header injection
User-supplied strings used in HTTP-style headers without stripping `\r\n`, enabling
request smuggling or log injection.

### 5D — Content-Disposition header injection
A filename received from the server is used unescaped in a `Content-Disposition` response
header, allowing injection into the browser's download dialog.

**Prevalence:** 40+ protocols.

---

## Class 6 — Protocol Wire Format Violations

### 6A — Wrong padding / alignment
Missing required padding bytes cause subsequent fields to land at incorrect offsets,
producing silent wrong results or parse errors on the remote end.

### 6B — Endianness (wire level)
Fields written or read with the wrong byte order for the protocol spec.

### 6C — Incorrect length framing
Off-by-one in length-prefix fields; the size word inconsistently includes or excludes
itself.

### 6D — Flow control not respected
Data written to a remote without checking the remote's advertised window or credit (e.g.
SSH channel window exhaustion drops input silently).

**Prevalence:** 30+ protocols.

---

## Class 7 — Arithmetic / Integer Overflow

### 7A — uint64 truncated to JS number
`uint64` parsed with `DataView.getUint32` pairs or plain arithmetic loses precision above
2^53. Fix: use `BigInt` and `DataView.getBigUint64`.

### 7B — Overflow in length arithmetic
48- or 64-bit length fields multiplied or added in a 32-bit or float64 context, silently
wrapping or losing the high bits.

### 7C — Zero treated as falsy
`parseInt(...) || undefined` maps `0` to `undefined`, breaking zero-valued fields such as
a listener count of 0 or a sequence number of 0.

---

## Class 8 — Unbounded Memory / OOM Risk

### 8A — No payload size limit
Upload or download handlers accept an arbitrarily large body with no cap, risking OOM
within the Worker's 128 MB ceiling.

### 8B — No chunk count limit
Read loops push chunks into an array with no iteration cap. A slow server sending many
small chunks can exhaust memory before the size cap is reached.

### 8C — Unbounded container depth
Binary container formats (MessagePack, nested TLVs) parsed recursively with no depth
limit, enabling stack overflow via deeply nested structures.

---

## Class 9 — Best-Practice Notes *(LOW — not actionable findings)*

These patterns were evaluated during the 2026-02-25 review and determined not to be
real findings per the [review guidelines](prompts/REVIEW_GUIDELINES.md), but are
documented here for awareness on future protocols.

### 9A — `Math.random()` for protocol nonces

70+ protocol files use `Math.random()` for message IDs, transaction IDs, and correlation
IDs — these are not security-relevant (they just match requests to responses).

8 files use `Math.random()` for auth-adjacent values: Kerberos nonces, RADIUS
authenticators, RethinkDB SCRAM client nonce, SIP/SIPS Digest cnonce, OSCAR cookies.

**Not a finding because:** the user is authenticating to a server they chose. Predictable
nonces only weaken the user's own session — they do not let one user affect another.
`crypto.getRandomValues()` is already used where it matters most (IKE SPI, JSONRPC
WebSocket key) and is the preferred pattern for new protocols.

### 9B — IPv6 address formatting in `connect()`

All protocols use `` connect(`${host}:${port}`) ``. For IPv6 addresses like `2001:db8::1`,
this produces the ambiguous string `2001:db8::1:9092` instead of the correct
`[2001:db8::1]:9092`.

**Not filed because:** the behavior depends on the `cloudflare:sockets` `connect()`
implementation, which may handle the ambiguity internally. Filing requires a proof-of-
concept demonstrating that a valid IPv6 address is misrouted, which was not tested.

### Evaluated and rejected (2026-02-25)

The following proposed classes were evaluated and found to be N/A for this codebase:

| Proposed | Why N/A |
|----------|---------|
| Out-of-order packet handling | Ephemeral probe connections, no long-running state machines |
| Half-open connection hangs | Covered by existing `Promise.race` + `setTimeout` on every handler |
| Premature socket reuse | No connection pooling in the codebase |
| Integer underflow in lengths | JS `new Uint8Array(-N)` throws `RangeError`; existing 3C checks reject `< 0` |
| Signed vs unsigned reads | Audited all 175 calls; all correct per protocol spec (Java protocols use signed where -1 = null) |
| TOCTOU on buffers | `Uint8Array.slice()` copies; no shared memory in CF Workers |
| TLS certificate validation | `secureTransport: 'on'` uses platform TLS; no `rejectUnauthorized` option exists |
| STARTTLS downgrade | No STARTTLS negotiation; user explicitly picks TLS vs plaintext endpoint |
| Decompression bombs | Zero decompression in the codebase |
| CPU regex DoS | All inputs bounded by 8A caps; only simple patterns used |
| Lying length fields | Covered by 3C bounds checks + readExact EOF handling |

---

## Class 14 — Worker/TCP Runtime Edge Cases

These are cross-cutting patterns discovered in Worker plumbing and protocol bridge logic
during the 2026-02-26 follow-up review. They are now part of the main bug-class
taxonomy.

### 14A — WebSocket upgrade case-sensitivity
WebSocket endpoints compare `Upgrade` to the exact lowercase literal `'websocket'`
instead of case-insensitive matching, causing valid clients/proxies with different header
casing to fail with 426/fallback behavior.

### 14B — Backpressure byte-accounting mismatch
Backpressure counters track text payload size using JS string length while writes encode to
UTF-8 bytes. Non-ASCII traffic undercounts queued bytes and can weaken memory guards.

### 14C — Absolute timeout used as idle timeout
A single timeout promise is reused for all reads in a loop, acting as a fixed wall-clock
deadline rather than an inactivity timeout. Long but healthy streams get truncated.

### 14D — Second-hop host trust
Multi-step protocols that receive referral/redirect host:port values from the upstream
server do not always re-run full host-block checks before opening a second socket.

### 14E — Cloudflare detection resolution blind spots
Cloudflare detection that only queries/uses a single A record can misclassify IPv6-only
or multi-answer domains.

### 14F — DNS TOCTOU between guard and connect
Pre-connect DNS checks and `connect()` resolution can diverge in timing/resolution path.
Treat as a PoC-required class in this codebase (do not file without repro).

### 14G — WebSocket handshake contract mismatch
A WebSocket endpoint expects JSON request body parameters even though browser WebSocket
handshakes are GET upgrades without request bodies.

**Reference audit:** `docs/changelog/reviews/2026-02-26-tcp-worker-additional-bug-classes.md`

---

## Sweep Prompts

- [Iterative full review](prompts/ITERATIVE_REVIEW.md) — full per-protocol review loop
- [1B/1C targeted sweep](prompts/SWEEP_1B_1C.md) — reader lock and socket cleanup only
