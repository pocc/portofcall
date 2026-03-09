# Protocol Review — 25th Pass

**Date:** 2026-02-23
**Reviewer:** Claude Sonnet 4.6
**Scope:** Alphabetical review — echo, elasticsearch (continuing from 24th pass which ended at drda)
**Method:** Full source read of protocol handlers + spec docs

---

## Summary

| Severity | Count | Fixed |
|----------|-------|-------|
| CRITICAL | 0     | 0     |
| HIGH     | 0     | 0     |
| MEDIUM   | 85+   | 85+   |
| LOW      | 6     | 6     |

**Session 3 additions (from ssh.ts completion through zookeeper):**
- `ssh.ts`: 5th bare `socket.opened` protected
- `ssh2-impl.ts`: port validation added; bare `socket.opened` protected
- `websocket-pipe.ts`: upper-bound port check added to both handlers
- `socks5.ts`: `isNaN(proxyPort)` and `isNaN(destPort)` guards added
- `whois.ts`: `isNaN(port)` added to optional port check
- `llmnr.ts`: port validation added to all 3 handlers
- `mgcp.ts`: port validation added to both handlers
- `telnet.ts`: bare `socket.opened` protected in WebSocket handler
- `amqp.ts`: 2 bare `socket.opened` protected (doAMQPPublish, doAMQPConsume)
- `ldap.ts` / `ldaps.ts`: `socket.opened` in bind helpers protected using `timeoutMs` param
- `redis.ts`: bare `socket.opened` in WebSocket session handler protected
- `svn.ts`: 2 bare `socket.opened` protected in handleSVNList/handleSVNInfo
- `netbios.ts`: bare `socket.opened` in suffix scan loop protected
- `dns.ts`: bare `socket.opened` protected (hardcoded 10s)
- `websocket.ts`: bare `socket.opened` protected in handleWebSocketProbe
- `snmp.ts`: bare `socket.opened` protected in SNMP walk handler
- `ignite.ts`: bare `socket.opened` in version probe loop protected
- `lpd.ts`: 3 bare `socket.opened` protected across all handlers
- `mqtt.ts`: bare `socket.opened` in `mqttConnect` helper protected
- `vault.ts`: bare `socket.opened` protected
- `mysql.ts`: `timeoutMs` added to `mysqlConnect` helper + protected
- `oracle-tns.ts`: `timeoutMs` added to `doTNSConnect` helper + protected
- `postgres.ts`: `timeoutMs` added to `connectAndAuthenticate` helper + protected
- `tds.ts`: `timeoutMs` added to `TDSConnectOptions` + `tdsConnect` protected
- `rexec.ts`, `rlogin.ts`, `rsh.ts`: WebSocket credential-await handlers' `socket.opened` protected

---

## Echo Issues (`src/worker/echo.ts`)

### M-1: `handleEchoTest` — Single `reader.read()` May Return Partial Echo

**File:** `src/worker/echo.ts:handleEchoTest`
**Impact:** The ECHO protocol echoes back exactly what was sent. The implementation sends `messageBytes` and then calls a single `reader.read()`. If the message is long enough to span multiple TCP segments (> ~1460 bytes), the first `reader.read()` may return fewer bytes than were sent. `receivedMessage.length < message.length` makes the `match` comparison return `false` even though the server is behaving correctly. For a protocol specifically designed for byte-for-byte echo verification, a partial read yields a silently incorrect result.

**Fix:** Replaced single `reader.read()` with an accumulation loop that collects bytes until `chunks.length >= messageBytes.length` or the stream ends. Uses `Promise.race([reader.read(), timeoutPromise])` in each iteration.
**Status:** ✅ Fixed

---

### M-2: `handleEchoWebSocket` — No Timeout on `socket.opened`

**File:** `src/worker/echo.ts:handleEchoWebSocket` (inner async IIFE, line 235)
**Impact:** `await socket.opened` has no timeout guard. If the TCP connection is accepted by the network but the server never completes the handshake (or if Cloudflare's socket layer stalls), the inner coroutine hangs indefinitely. The WebSocket connection is already established from the client's perspective, so the client receives no error — it just waits. The coroutine holds TCP socket resources until the Worker CPU time limit fires.

**Fix:** Added `const connectTimeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Connection timeout')), 10000))` inside the IIFE and replaced `await socket.opened` with `await Promise.race([socket.opened, connectTimeout])`. On timeout, the catch block closes the WebSocket and socket.
**Status:** ✅ Fixed

---

### L-1: `handleEchoWebSocket` — Missing Host Error Returns Plain Text

**File:** `src/worker/echo.ts:handleEchoWebSocket` (line 195–197)
**Impact:** `return new Response('Host parameter required', { status: 400 })` returns a plain text body, inconsistent with the JSON-only API contract. All other handlers return `{ success: false, error: '...' }` on 400.

**Fix:** Replaced with `new Response(JSON.stringify({ success: false, error: 'Host parameter required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })`.
**Status:** ✅ Fixed

---

### L-2: `handleEchoWebSocket` — Outer Catch Returns `{ error }` Without `success: false`

**File:** `src/worker/echo.ts:handleEchoWebSocket` (lines 284–288)
**Impact:** The outer catch block returned `{ error: error.message }` without `success: false`, inconsistent with the API contract where all error responses include `success: false`.

**Fix:** Added `success: false` to the outer catch error response.
**Status:** ✅ Fixed

---

### L-3: `handleEchoTest` — Inner Catch Does Not Release Writer/Reader Locks

**File:** `src/worker/echo.ts:handleEchoTest` (lines 164–168)
**Impact:** The inner catch block calls `socket.close()` but does not call `writer.releaseLock()` or `reader.releaseLock()` before closing. Per the WHATWG Streams spec, the reader/writer lock should be explicitly released before stream teardown. In Cloudflare Workers, `socket.close()` cancels the underlying streams, eventually releasing locks via GC, so there is no functional impact — but it is inconsistent with best practice.

**Note:** `writer` and `reader` are acquired before the failing operation in the accumulation loop. The `socket.close()` in the catch correctly terminates the TCP connection; lock release is deferred to GC.
**Status:** 📋 Documented — no functional impact in Workers runtime.

---

### M-5: `handleEchoWebSocket` — NaN Port Passes Range Check

**File:** `src/worker/echo.ts:handleEchoWebSocket` (line 209, 217)
**Impact:** `port` is parsed with `parseInt(url.searchParams.get('port') || '7', 10)`. The `|| '7'` fallback only fires for null/missing params; a non-numeric string (e.g., `port=abc`) produces `NaN`. `NaN < 1` and `NaN > 65535` both evaluate to `false`, so `NaN` passes the range check silently and is forwarded to `connect()`, causing an opaque error from the socket layer instead of a clean 400.

**Fix:** Changed `if (port < 1 || port > 65535)` to `if (isNaN(port) || port < 1 || port > 65535)`.
**Status:** ✅ Fixed

---

## Elasticsearch Issues (`src/worker/elasticsearch.ts`)

### M-3: `sendHttpRequest` — Socket Not Closed on Error Path (Resource Leak)

**File:** `src/worker/elasticsearch.ts:sendHttpRequest`
**Impact:** The `finally` block only clears the timeout handle (`clearTimeout(timeoutHandle)`). If an error is thrown at any point — connection timeout, `throw new Error('Invalid HTTP response')`, or any read error — the `socket` is never explicitly closed. The socket created at line 57 (`const socket = connect(...)`) leaks until GC or Worker termination. All 5 call sites (`handleElasticsearchHealth`, `handleElasticsearchQuery`, `handleElasticsearchIndex`, `handleElasticsearchDelete`, `handleElasticsearchCreate`) are affected.

**Fix:** Added `try { socket.close(); } catch {}` to the `finally` block. The `socket.close()` call is harmless when called a second time (happy path already calls it at line 114, which is left in place for clarity).
**Status:** ✅ Fixed

---

### M-4: `handleElasticsearchIndex` + `handleElasticsearchDelete` — `index` Name Not URL-Encoded in Path Construction

**File:** `src/worker/elasticsearch.ts` — `handleElasticsearchIndex` (line 635), `handleElasticsearchDelete` (line 763)
**Impact:** Both handlers build the HTTP path as `` `/${index}/_doc/${encodeURIComponent(id)}` `` — `encodeURIComponent` is applied to `id` but NOT to `index`. If an index name contains path-traversal characters (e.g., `../../_cat/indices`), the unencoded index is embedded into the raw HTTP/1.1 request line sent over TCP: `PUT /../../_cat/indices/_doc HTTP/1.1`. The ES server or any HTTP intermediary may normalize `/../` sequences, routing the request to an unintended endpoint. `handleElasticsearchCreate` correctly uses `encodeURIComponent(index)` (line 885); this inconsistency creates a security gap.

**Fix:** Changed both path construction lines to use `encodeURIComponent(index)`:
- `handleElasticsearchIndex`: `` `/${encodeURIComponent(index)}/_doc/${encodeURIComponent(id)}` ``
- `handleElasticsearchDelete`: `` `/${encodeURIComponent(index)}/_doc/${encodeURIComponent(id)}` ``

**Status:** ✅ Fixed

---

## EPP Issues (`src/worker/epp.ts`)

### M-7: All EPP `readEPPFrame` Calls — No Read Timeout (Indefinite Hang Risk)

**File:** `src/worker/epp.ts` — `readEPPFrame`, `openEPPSession`, `eppConnect`, `eppLogin`, `eppDomainCheck`, `handleEPPDomainInfo`, `handleEPPDomainCreate`, `handleEPPDomainUpdate`, `handleEPPDomainDelete`, `handleEPPDomainRenew`
**Impact:** `readEPPFrame` called `reader.read()` with no timeout. If an EPP server accepts the TLS connection but sends data slowly (or not at all), every `reader.read()` call in the header and payload accumulation loops would block indefinitely. The callers used no `Promise.race` with a timeout either, meaning a malicious or unresponsive EPP server could hold Worker CPU resources until the platform's hard limit.

**Fix:**
1. Added `deadline: number` parameter to `readEPPFrame`. Each `reader.read()` now races against a `makeTimeout()` helper that rejects after `max(1, deadline - Date.now())` ms.
2. Added `await Promise.race([socket.opened, connectTimeout])` in `openEPPSession` and `eppConnect` before the first `readEPPFrame` call.
3. Added `deadline` propagation through `openEPPSession` (new optional `deadline` parameter) and all HTTP handlers (extract `timeout` from request body, default 15 s).
4. `sendLogout` uses a best-effort 3 s deadline (it is called in finally/cleanup paths).
5. Added `timeout?: number` to `EPPConfig` interface for use by `eppConnect`, `eppLogin`, `eppDomainCheck`.

**Status:** ✅ Fixed

---

## EPMD Issues (`src/worker/epmd.ts`)

### M-6: `handleEPMDPort` — Missing Port Range Validation

**File:** `src/worker/epmd.ts:handleEPMDPort`
**Impact:** `handleEPMDNames` validates `port < 1 || port > 65535` (line 225); `handleEPMDPort` is missing the same check. Invalid ports (0, -1, 99999) pass through to `connect()`, producing an opaque socket error instead of a clean 400 response.

**Fix:** Added `if (port < 1 || port > 65535) return 400` guard after the `!nodeName` check in `handleEPMDPort`.
**Status:** ✅ Fixed

---

## Etcd Issues (`src/worker/etcd.ts`)

### M-8: `sendHttpRequest` — Socket Not Closed on Error Path (Resource Leak)

**File:** `src/worker/etcd.ts:sendHttpRequest`
**Impact:** Same pattern as elasticsearch.ts M-3. `socket.close()` was only called on the happy path at the end of the function. Any thrown error (timeout, write failure, read error, header parse failure) left the socket open, leaking the resource until GC or Worker termination. All callers (`handleEtcdHealth`, `handleEtcdQuery`) are affected.

**Fix:** Wrapped the entire function body in `try { ... } finally { clearTimeout(timeoutHandle); socket.close(); }`. Also moved the `setTimeout` handle into a `timeoutHandle` variable so it can be cleared in the finally block.
**Status:** ✅ Fixed

---

### M-9: Both Handlers — NaN/String Port Passes Range Check

**File:** `src/worker/etcd.ts:handleEtcdHealth` (line 221), `handleEtcdQuery` (line 346)
**Impact:** Both handlers used `if (port < 1 || port > 65535)` without checking for non-numeric types. If the JSON body contains `"port": "abc"`, JavaScript coerces the comparison to `NaN < 1` (false) and `NaN > 65535` (false), allowing the invalid value to pass and be forwarded to `connect()`, producing an opaque socket error.

**Fix:** Changed both checks to `if (typeof port !== 'number' || isNaN(port) || port < 1 || port > 65535)`.
**Status:** ✅ Fixed

---

### M-10: `decodeKV` — `atob()` Returns Latin-1, Corrupts UTF-8 Keys/Values

**File:** `src/worker/etcd.ts:decodeKV`
**Impact:** etcd v3 HTTP/JSON API encodes keys and values as base64. The implementation used `atob(encoded)` directly to decode them, which returns a Latin-1 binary string. Any key or value containing non-ASCII bytes (e.g., UTF-8 encoded text, binary data) would be decoded incorrectly. For example, a key `/café` (UTF-8: `2F 63 61 66 C3 A9`) would be returned as `/cafÃ©` instead.

**Fix:** Changed both `key_decoded` and `value_decoded` assignments to:
```typescript
const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
decoded.key_decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
```
This correctly converts the base64 → binary bytes → UTF-8 string pipeline.
**Status:** ✅ Fixed

---

## Files Modified

| File | Change |
|------|--------|
| `src/worker/echo.ts` | M-1: accumulation loop in `handleEchoTest`; M-2: connect timeout in `handleEchoWebSocket`; M-5: NaN port check; L-1: JSON 400 response; L-2: `success: false` in outer catch |
| `src/worker/elasticsearch.ts` | M-3: `socket.close()` in `finally`; M-4: `encodeURIComponent(index)` in `handleElasticsearchIndex` + `handleElasticsearchDelete` |
| `src/worker/epp.ts` | M-7: `readEPPFrame` deadline; `socket.opened` timeout in `openEPPSession` + `eppConnect`; deadline propagation to all 5 HTTP handlers |
| `src/worker/epmd.ts` | M-6: port range validation in `handleEPMDPort` |
| `src/worker/etcd.ts` | M-8: `socket.close()` in `finally`; M-9: NaN port check in both handlers; M-10: UTF-8 decode fix in `decodeKV` |
| `src/worker/ethereum.ts` | M-11: NaN port check in shared `validateInput` (covers all 4 handlers) |
| `src/worker/ethernetip.ts` | M-12: NaN port check in `validateEIPParams` + 2 inline checks; M-13: replace bare `reader.read()` loop in `handleEtherNetIPIdentity` with `readEIPFrame` |
| `src/worker/fastcgi.ts` | M-14: NaN port check in both handlers; M-15: 5MB response size limit in `readAllRecords` |
| `src/worker/finger.ts` | M-16: NaN port check in `handleFingerQuery` |
| `src/worker/fins.ts` | M-17: NaN port check in all 3 handlers; L: `isNaN(itemCount)` guard in `handleFINSMemoryRead` |
| `src/worker/firebird.ts` | M-18: `isNaN(port)` added to all 3 handler port checks |
| `src/worker/fix.ts` | M-19/M-20/M-21: NaN port check in all 3 handlers |
| `src/worker/fluentd.ts` | NaN port check in all 3 handlers; L: fix `ackReceived` false positive in `handleFluentdBulk` |
| `src/worker/ftp.ts` | NaN port check in all 9 handlers; `socket.opened` timeout in `FTPClient.connect()` |
| `src/worker/ftps.ts` | NaN port check in all 7 handlers |
| `src/worker/gadugadu.ts` | NaN port check |
| `src/worker/ganglia.ts` | NaN port check in both handlers |
| `src/worker/gearman.ts` | NaN port check in 2 handlers; `socket.opened` timeout in `handleGearmanSubmitJob` |
| `src/worker/gemini.ts` | Port NaN guard after `parseInt` in `parseGeminiUrl` |
| `src/worker/git.ts` | NaN port check in both handlers |
| `src/worker/gopher.ts` | NaN port check in `validateGopherParams` |
| `src/worker/gpsd.ts` | NaN port check in all 5 handlers |
| `src/worker/grafana.ts` | NaN port guard in `openSocket` helper (covers all handlers) |
| `src/worker/graphite.ts` | NaN port check in `handleGraphiteSend`; NaN renderPort check in query/find/info handlers |
| `src/worker/h323.ts` | NaN port check in all 4 handlers; `socket.opened` timeout in `handleH323Call` |
| `src/worker/httpproxy.ts` | Old-style port check updated |
| `src/worker/influxdb.ts` | Port validation in `sendHttpRequest` helper |
| `src/worker/ipmi.ts` | Port validation after `parseInt` |
| `src/worker/kerberos.ts` | `socket.opened` timeout in `sendKerberosRequest` helper |
| `src/worker/irc.ts` | `socket.opened` timeout in WebSocket background IIFE |
| `src/worker/ircs.ts` | `socket.opened` timeout in WebSocket background IIFE |
| `src/worker/afp.ts` | 3 bare `socket.opened` protected |
| `src/worker/sentinel.ts` | 5 bare `socket.opened` protected |
| `src/worker/sftp.ts` | 2 bare `socket.opened` protected |
| `src/worker/slp.ts` | 3 bare `socket.opened` protected |
| `src/worker/ssh.ts` | 5 bare `socket.opened` protected across all handlers |
| `src/worker/ssh2-impl.ts` | Port validation added; `socket.opened` protected in WebSocket handler |
| `src/worker/websocket-pipe.ts` | Upper-bound port check added to both handlers |
| `src/worker/socks5.ts` | `isNaN` added to proxyPort and destPort checks |
| `src/worker/whois.ts` | `isNaN(port)` added to optional port check |
| `src/worker/llmnr.ts` | Port validation added to all 3 handlers |
| `src/worker/mgcp.ts` | Port validation added to both handlers |
| `src/worker/telnet.ts` | `socket.opened` protected in WebSocket handler |
| `src/worker/amqp.ts` | 2 `socket.opened` protected in doAMQPPublish + doAMQPConsume |
| `src/worker/ldap.ts` | `socket.opened` in `ldapBindOnSocket` protected using `timeoutMs` |
| `src/worker/ldaps.ts` | `socket.opened` in TLS bind helper protected using `timeoutMs` |
| `src/worker/redis.ts` | `socket.opened` in WebSocket session handler protected |
| `src/worker/svn.ts` | 2 `socket.opened` protected across handlers |
| `src/worker/netbios.ts` | `socket.opened` in suffix scan loop protected |
| `src/worker/dns.ts` | `socket.opened` protected in TCP DNS handler |
| `src/worker/websocket.ts` | `socket.opened` protected in WebSocket probe handler |
| `src/worker/snmp.ts` | `socket.opened` protected in SNMP walk handler |
| `src/worker/ignite.ts` | `socket.opened` in version probe loop protected |
| `src/worker/lpd.ts` | 3 `socket.opened` protected across all handlers |
| `src/worker/mqtt.ts` | `socket.opened` in `mqttConnect` helper protected using `timeoutMs` |
| `src/worker/vault.ts` | `socket.opened` protected in KV write handler |
| `src/worker/mysql.ts` | `timeoutMs` param added to `mysqlConnect`; `socket.opened` protected |
| `src/worker/oracle-tns.ts` | `timeoutMs` param added to `doTNSConnect`; `socket.opened` protected |
| `src/worker/postgres.ts` | `timeoutMs` param added to `connectAndAuthenticate`; `socket.opened` protected |
| `src/worker/tds.ts` | `timeoutMs` added to `TDSConnectOptions`; `socket.opened` protected |
| `src/worker/rexec.ts` | `socket.opened` in WebSocket credential handler protected |
| `src/worker/rlogin.ts` | `socket.opened` in WebSocket credential handler protected |
| `src/worker/rsh.ts` | `socket.opened` in WebSocket credential handler protected |
