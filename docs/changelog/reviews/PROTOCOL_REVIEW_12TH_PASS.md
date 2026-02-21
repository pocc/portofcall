# Protocol Review — 12th Pass
**Review Date:** 2026-02-20
**Scope:** 277 protocol implementations
**Focus:** Usability — crashes, confusing errors, and unexpected behavior from a power user's perspective

---

## Executive Summary

The 12th pass focused on **usability and user-facing correctness** — bugs that cause the API to crash unexpectedly or produce confusing responses that a protocol-savvy user would not expect. Five parallel review agents inspected all 277 protocols, producing ~49 candidate findings. After manual verification against the actual source code, **2 genuine issues** were confirmed:

1. **`btoa()` DOMException on non-ASCII HTTP Basic Auth credentials** — 12 files (19 call sites) pass `btoa(\`${username}:${password}\`)` which throws when credentials contain characters with code points > 255. RFC 7617 specifies UTF-8 encoding before base64 for HTTP Basic Auth.

2. **H.323 returns `success: true` with an error message** — When a Q.931 response cannot be parsed, the API responds with `success: true` and `error: 'Could not parse Q.931 response'`, which is contradictory and confusing.

Over **47 agent-reported findings were verified as false positives**, continuing the pattern of diminishing returns on a codebase refined through 11 prior passes.

---

## High-Severity Issues

### 1. HTTP Basic Auth — `btoa()` Fails on Non-ASCII Credentials (12 files, 19 locations)

**Pattern:** `btoa(\`${username}:${password}\`)` or `btoa(\`${u}:${p}\`)`

`btoa()` only accepts Latin-1 input. If a user enters a password with characters outside code points 0–255 (e.g., accented characters, CJK scripts, Cyrillic), the call throws `DOMException: The string to be encoded contains characters outside of the Latin1 range`. RFC 7617 (HTTP Basic Authentication) specifies that the user-id and password should be encoded as UTF-8 before base64 encoding.

**Affected files:**

| File | Line(s) | Context |
|---|---|---|
| activemq.ts | 979, 1176 | STOMP and REST auth |
| ceph.ts | 700, 703, 870, 872 | REST API auth |
| couchdb.ts | 202 | CouchDB auth |
| elasticsearch.ts | 178, 407, 533, 635, 741 | Elasticsearch REST auth |
| etcd.ts | 185 | etcd auth |
| grafana.ts | 65 | Grafana auth |
| icecast.ts | 53 | Icecast status auth |
| jsonrpc.ts | 182 | JSON-RPC auth |
| kibana.ts | 322 | Kibana auth |
| rtsp.ts | 89 | RTSP Basic auth (buildBasicAuth helper) |
| solr.ts | 234 | Solr auth |
| winrm.ts | 615 | WinRM Basic auth |

**Fix:** Apply the UTF-8-safe base64 pattern (already in `managesieve.ts:71–78`):
```typescript
function safeBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
```

---

## Medium-Severity Issues

### 2. H.323 — `success: true` with Error Message on Unparseable Response
**File:** `src/worker/h323.ts:540–549`

When the server responds but the Q.931 message cannot be parsed, the handler returns:
```json
{
  "success": true,
  "messageTypeName": "UNPARSEABLE",
  "error": "Could not parse Q.931 response"
}
```

A user sees `success: true` but there's an error. This is contradictory — a power user checking `result.success` would believe the operation succeeded.

**Fix:** Change `success: true` to `success: false`:
```typescript
return {
  success: false,
  messageType: responseData[0] ?? 0,
  ...
};
```

---

## Verified Non-Issues (False Positives Filtered: 47+)

### Lock/Resource Leak Claims

| Reported Finding | Reason Rejected |
|---|---|
| activemq.ts lock not released on error | `socket.close()` in catch block releases locks implicitly |
| fastcgi.ts reader/writer lock leak | Success path releases at lines 358–359; catch path closes socket |
| http.ts writer lock on timeout | `socket.close()` handles cleanup |
| ike.ts writer lock on timeout | `socket.close()` handles cleanup |
| netbios.ts writer lock not released | Socket close handles cleanup |
| realaudio.ts reader lock not released | Socket close handles cleanup |
| rdp.ts silent failure in lock cleanup | Socket close handles cleanup |
| fins.ts socket not closed on timeout | Global Promise.race timeout catches and returns error |

### Error Handling / Crash Claims

| Reported Finding | Reason Rejected |
|---|---|
| ami.ts JSON parse crash at line 429 | `request.json()` is inside try-catch at line 428 |
| neo4j.ts unhandled exception in error handler | Has try-catch at lines 828–834 |
| fluentd.ts uncaught msgpack decode | Has try-catch at line 316 |
| telnet.ts unhandled promise in WebSocket handler | Standard async event listener with try-catch |

### Logic / Validation Claims

| Reported Finding | Reason Rejected |
|---|---|
| beanstalkd.ts NaN from parseInt | Falls to single-line response path (byteCount < 0) — degrades gracefully |
| bgp.ts OOB read in capability parsing | Bounds check at `offset + capOffset + 2 <= data.length` prevents OOB |
| amqp.ts incomplete frame parsing | Documented as "acceptable for one-shot handshake" |
| afp.ts timeout miscalculation | `remaining <= 0` check exists at line 640 |
| gearman.ts missing pre-check on dataSize | Check exists at line 209 (`> 16MB`) |
| hazelcast.ts silent success on auth failure | Intentional — probe succeeded in identifying server |
| nbd.ts status 200 with success: false | Design choice — HTTP succeeded, protocol op failed |
| doh.ts ambiguous success on truncated data | Returns `success: false` with error message |
| nats.ts buffered data not consumed | NATS servers send INFO then wait for CONNECT |
| socks5.ts missing bound address validation | try-catch with "best-effort" is correct |
| realaudio.ts NaN content-length | Regex `\d+` guarantees numeric input |
| influxdb.ts missing port validation | Connection failure gives clear error |

### Timeout / Cleanup Claims

| Reported Finding | Reason Rejected |
|---|---|
| radsec.ts timeout handle not cleared | Harmless — rejected promise is ignored after race |
| radius.ts timeout handle not cleaned | Same — harmless timer |
| smtp.ts misleading success on send timeout | Throws error (`code !== 250`) — properly propagated |
| redis.ts incomplete RESP parsing | RESP parser correctly accumulates until complete |

---

## Priority Fix List

### P0 — High Severity
1. **HTTP Basic Auth btoa** — Add `safeBase64()` helper in 12 files, update 19 call sites

### P1 — Medium Severity
2. **H.323** — Change `success: true` to `success: false` for unparseable responses

---

## Metrics

| Category | Count |
|---|---|
| High | 1 (systemic: 12 files, 19 locations) |
| Medium | 1 |
| Verified non-issues | 47+ |

**Previous report:** [PROTOCOL_REVIEW_11TH_PASS.md](PROTOCOL_REVIEW_11TH_PASS.md)
