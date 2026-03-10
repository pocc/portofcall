# Additional TCP Worker Bug Classes to Audit

Date: 2026-02-26
Scope: Follow-up to `2026-02-24-full-protocol-review-summary.md` and current `src/worker/*` implementation patterns.

This document proposes additional bug classes that were not explicitly captured in the original 1A–13B taxonomy and are realistic for TCP protocol handlers running on Cloudflare Workers. These classes are now included in `docs/BUG_CLASSES.md` as Class 14 (14A-14G).

## Priority Summary

| Class | Priority | Why it matters |
|---|---|---|
| 14A. WebSocket Upgrade Case-Sensitivity | High | Causes real client/proxy interoperability failures (false 426/failed session setup) |
| 14B. Backpressure Byte-Accounting Mismatch | High | Under-counts queued bytes for UTF-8 text and weakens memory pressure controls |
| 14C. Absolute Timeout Used as Idle Timeout | Medium | Truncates valid long-lived responses despite ongoing traffic |
| 14D. Second-Hop Host Trust (Protocol-Provided Endpoints) | Medium | Multi-step protocols can connect to unvalidated internal hosts on step 2 |
| 14E. Cloudflare Detection Resolution Blind Spots | Medium | A-only/first-record logic can misclassify IPv6/CNAME-backed domains |
| 14F. DNS TOCTOU Between Guard and `connect()` | Watchlist | Known limitation; requires PoC to elevate from theoretical to actionable |
| 14G. WebSocket Handshake Contract Mismatch | Low/Medium | Standard browser WS cannot send JSON body; endpoint contracts can silently drift |

## 14A. WebSocket Upgrade Case-Sensitivity

### Pattern
Checking `Upgrade` header with exact string equality (`'websocket'`) instead of case-insensitive comparison.

### Evidence
- `/Users/rj/gd/code/portofcall/src/worker/index.ts:414`
- `/Users/rj/gd/code/portofcall/src/worker/index.ts:523`
- `/Users/rj/gd/code/portofcall/src/worker/index.ts:532`
- `/Users/rj/gd/code/portofcall/src/worker/memcached.ts:316`
- `/Users/rj/gd/code/portofcall/src/worker/imap.ts:569`
- `/Users/rj/gd/code/portofcall/src/worker/imaps.ts:608`
- `/Users/rj/gd/code/portofcall/src/worker/mqtt.ts:486`
- `/Users/rj/gd/code/portofcall/src/worker/redis.ts:388`
- `/Users/rj/gd/code/portofcall/src/worker/ssh2-impl.ts:1319`

Note: `handleSocketConnection` already does this correctly (`toLowerCase()`), showing inconsistency:
- `/Users/rj/gd/code/portofcall/src/worker/websocket-pipe.ts:98-101`

### Audit heuristic
Search for:
```bash
rg -n "request\.headers\.get\('Upgrade'\) !== 'websocket'|upgradeHeader === 'websocket'" src/worker
```

### Repro
Send a valid WS handshake with `Upgrade: WebSocket` (different casing) to WS routes and verify unexpected 426/HTTP fallback behavior.

## 14B. Backpressure Byte-Accounting Mismatch (Text vs Bytes)

### Pattern
Backpressure queue accounting uses JS string length (UTF-16 code units) but writes UTF-8 encoded bytes.

### Evidence
- Size accounting: `/Users/rj/gd/code/portofcall/src/worker/websocket-pipe.ts:165`
- Actual write encoding: `/Users/rj/gd/code/portofcall/src/worker/websocket-pipe.ts:181`

### Why this is a bug class
For non-ASCII traffic, `event.data.length` can be materially smaller than UTF-8 byte length. This underestimates queued bytes and weakens `INBOUND_HIGH_WATER_MARK` enforcement.

### Audit heuristic
Look for:
- queue counters that add `string.length`
- writes that use `new TextEncoder().encode(...)`

### Repro
Push large WS text messages with high-byte Unicode content and confirm queue control triggers later than expected by true byte volume.

## 14C. Absolute Timeout Reused in Read Loop (Idle Timeout Bug)

### Pattern
A single timeout promise is created once and raced against every `reader.read()` in a loop.

### Evidence
- `/Users/rj/gd/code/portofcall/src/worker/tcp.ts:145-155`

### Why this is a bug class
This behaves like a fixed wall-clock deadline from first read, not an inactivity timeout. Streams that are healthy but longer than `timeout` can be cut off.

### Audit heuristic
Find loops where timeout promise is created outside loop and reused inside `Promise.race` with `reader.read()`.

### Repro
Use a test server that sends chunks every 500ms for > timeout duration; verify premature truncation.

## 14D. Second-Hop Host Trust (Protocol-Provided Endpoints)

### Pattern
Protocol step 1 returns a host/port for step 2. Step 2 validates Cloudflare but does not always re-apply private/internal host guard.

### Evidence
RMI:
- Host from server data: `/Users/rj/gd/code/portofcall/src/worker/rmi.ts:498-501`
- Connect to discovered host: `/Users/rj/gd/code/portofcall/src/worker/rmi.ts:508`

OSCAR:
- BOS host parsed from server TLV: `/Users/rj/gd/code/portofcall/src/worker/oscar.ts:854-860`
- Connect to BOS host: `/Users/rj/gd/code/portofcall/src/worker/oscar.ts:871`

### Why this is a bug class
Router guards cover request inputs; second-hop hosts are runtime values from upstream servers. These need the same SSRF/private-range validation as user input.

### Audit heuristic
Find `connect()` targets derived from response payloads (TLV/registry/directory referrals), then verify `isBlockedHost` + Cloudflare checks are both applied before second-hop connect.

### Repro
Use a controlled server that returns referral host `127.0.0.1`/`169.254.169.254` and verify whether second-hop connect is attempted.

## 14E. Cloudflare Detector Resolution Blind Spots

### Pattern
Cloudflare detection queries only A records and uses only first answer.

### Evidence
- A-only query: `/Users/rj/gd/code/portofcall/src/worker/cloudflare-detector.ts:148`
- First-answer selection: `/Users/rj/gd/code/portofcall/src/worker/cloudflare-detector.ts:176-178`

### Why this is a bug class
Can misclassify domains that are IPv6-only, CNAME-heavy, or multi-answer where first A record is not representative.

### Audit heuristic
Add test cases for:
- AAAA-only domains
- mixed A/AAAA answers
- multiple A answers with differing edge behavior

### Repro
Test detection against known AAAA-centric domains and compare guard behavior to effective `connect()` outcome.

## 14F. DNS TOCTOU Between Guard and `connect()` (Watchlist)

### Pattern
Guards and actual socket connection do separate resolution steps.

### Evidence
- Explicitly documented limitation: `/Users/rj/gd/code/portofcall/src/worker/host-validator.ts:7-9`

### Why this is a bug class
This is a classic check/use split. In Workers, host resolution is internal to `connect()`, so rebinding windows can exist between pre-check and use.

### Review guideline alignment
Per current guidelines, do not file as a hard finding without a concrete PoC showing practical misrouting in this environment.

### Audit heuristic
Treat as a PoC-required class: use low-TTL controlled DNS to test whether guard and final destination diverge.

## 14G. WebSocket Handshake Contract Mismatch

### Pattern
WS upgrade endpoint expects JSON body params, but browser WS handshake is GET and cannot send JSON body.

### Evidence
- `/Users/rj/gd/code/portofcall/src/worker/websocket-pipe.ts:105`

### Why this is a bug class
Endpoint may appear implemented but is unusable for standard browser clients, creating dead or misleading API surfaces.

### Audit heuristic
For each WS endpoint, validate parameter transport contract (query string vs first WS message vs body) against actual browser behavior.

## Suggested Next Sweep Order

1. 14A + 14B (high-signal, easy to grep, minimal false positives)
2. 14D (multi-hop protocols; targeted manual audit)
3. 14C (timeout semantics in long-read flows)
4. 14E (test-matrix expansion)
5. 14F (PoC-only track)
6. 14G (endpoint contract cleanup)

## Quick Grep Pack

```bash
# 14A
rg -n "request\.headers\.get\('Upgrade'\) !== 'websocket'|upgradeHeader === 'websocket'" src/worker

# 14B (candidate text/byte mismatches)
rg -n "\.length.*queued|queuedBytes|TextEncoder\(\)\.encode" src/worker/websocket-pipe.ts src/worker

# 14C (timeout promise reused in loops)
rg -n "const readTimeout = new Promise|Promise\.race\(\[reader\.read\(\), readTimeout" src/worker

# 14D (second-hop host connects)
rg -n "remoteRef|bosHost|referral|connect\(`\$\{.*Host\}:\$\{.*Port\}`\)" src/worker

# 14E
rg -n "dns-query\?name=.*type=A|Answer\[0\]" src/worker/cloudflare-detector.ts
```
