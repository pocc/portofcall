# Telnet Protocol Reference

**Port:** 23 (default)
**RFC:** [854](https://tools.ietf.org/html/rfc854), [855](https://tools.ietf.org/html/rfc855)
**Implementation:** `src/worker/telnet.ts`
**Tests:** `tests/telnet.test.ts` (9/9 passing)

---

## Endpoints

Three URL paths, four behaviors (one path is method-dispatched):

| Method | Path | Behavior |
|--------|------|----------|
| `GET` or `POST` | `/api/telnet/connect` | HTTP banner probe — connect, read one chunk, disconnect |
| `GET` (Upgrade: websocket) | `/api/telnet/connect` | WebSocket raw TCP tunnel |
| `POST` | `/api/telnet/negotiate` | IAC negotiation — connect, exchange IAC, return parsed results |
| `POST` | `/api/telnet/login` | Automated credential submission |

The WebSocket upgrade check happens in the router (`src/worker/index.ts`):

```
if (url.pathname === '/api/telnet/connect') {
  if (request.headers.get('Upgrade') === 'websocket') {
    return handleTelnetWebSocket(request);
  }
  return handleTelnetConnect(request);
}
```

---

## `/api/telnet/connect` — Banner Probe (HTTP)

Quick connectivity check. Connects, reads the first TCP segment with a 5-second inner deadline, then closes. Does **not** perform IAC negotiation.

### Request

**GET** — query parameters:
```
GET /api/telnet/connect?host=telehack.com&port=23&timeout=30000
```

**POST** — JSON body:
```json
{ "host": "telehack.com", "port": 23, "timeout": 30000 }
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | hostname or IP |
| `port` | number | `23` | |
| `timeout` | number | `30000` ms | outer connection timeout |

### Response

**200 OK — reachable with banner:**
```json
{
  "success": true,
  "message": "Telnet server reachable",
  "host": "telehack.com",
  "port": 23,
  "banner": "\xff\xfb\x01\xff\xfb\x03...\r\ntelehack.com\r\n",
  "note": "This is a connectivity test. For interactive sessions, use WebSocket mode."
}
```

**200 OK — reachable, silent (5s banner timeout expired):**
```json
{
  "success": true,
  "message": "Telnet server reachable (no banner)",
  "host": "example.com",
  "port": 23,
  "banner": "",
  "note": "Server connected but did not send initial banner."
}
```

**400 — missing host:**
```json
{ "error": "Missing required parameter: host" }
```

**403 — Cloudflare-protected host:**
```json
{ "success": false, "error": "...", "isCloudflare": true }
```

**500 — unreachable or timeout:**
```json
{ "success": false, "error": "Connection timeout" }
```

### IAC bytes in `banner`

The banner is decoded with `TextDecoder` from the raw first TCP segment **without stripping IAC bytes**. If the server sends negotiation sequences before text, those bytes appear verbatim as binary garbage in the response string. Use `/negotiate` if you need clean banner text with IAC parsed out.

---

## `/api/telnet/connect` — WebSocket Raw Tunnel

Upgrade to WebSocket at the same `/api/telnet/connect` path. Creates a bidirectional raw TCP↔WebSocket pipe with **no server-side IAC processing in either direction**.

### Upgrade handshake

```
GET /api/telnet/connect?host=telehack.com&port=23 HTTP/1.1
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: ...
```

Parameters come from query string only (not body — WebSocket upgrades have no body).

| Field | Type | Default |
|-------|------|---------|
| `host` | string | required |
| `port` | number | `23` |

### Message protocol

**Server → client (first message after connect):**
```json
{ "type": "telnet-connected", "host": "telehack.com", "port": 23, "message": "Connected to Telnet server" }
```

After that, all server→client frames are **raw binary** (`Uint8Array` from the TCP socket, sent directly with `ws.send(value)`). The browser receives raw Telnet bytes including any IAC sequences — no JSON wrapping, no stripping.

**Client → server:**
The browser can send either:
- `string` — encoded to UTF-8 bytes and written to the TCP socket
- `ArrayBuffer` — written directly as bytes

There is no message envelope; whatever bytes the browser sends go straight to the server.

### IAC handling in WebSocket mode

There is **no IAC handling on either side**:

- `pipeTelnetToWebSocket`: `"For now, pass data through as-is"` — comment in source
- `pipeWebSocketToTelnet`: string input → `TextEncoder` → socket; ArrayBuffer → socket directly

If you need IAC negotiation, run it before establishing the WebSocket session using `/negotiate`, or handle it in your browser code. The browser can send raw IAC bytes via `ArrayBuffer` frames.

### Connection lifecycle

1. Worker calls `socket.opened`, then sends the `telnet-connected` JSON frame.
2. Two async loops start concurrently: `pipeWebSocketToTelnet` (event-driven) and `pipeTelnetToWebSocket` (reader loop).
3. Either side closing tears down the other:
   - WebSocket `close` → `writer.close()` on the TCP socket
   - TCP `done` → `ws.close()`

No ping/keepalive is implemented; the Cloudflare Worker timeout applies.

---

## `/api/telnet/negotiate` — IAC Negotiation

Connects, collects up to 3 TCP chunks over 3 seconds, parses all IAC sequences, sends responses, then closes. Returns structured negotiation results plus the clean (IAC-stripped) banner text.

### Request

```json
{
  "host": "telehack.com",
  "port": 23,
  "timeout": 15000
}
```

| Field | Type | Default |
|-------|------|---------|
| `host` | string | required |
| `port` | number | `23` |
| `timeout` | number | `15000` ms |

### Response

```json
{
  "success": true,
  "host": "telehack.com",
  "port": 23,
  "banner": "telehack.com\r\n\r\nlogin: ",
  "negotiations": [
    { "direction": "server-will", "option": 1, "optionName": "ECHO", "ourResponse": "DO ECHO" },
    { "direction": "server-will", "option": 3, "optionName": "SUPPRESS-GO-AHEAD", "ourResponse": "DO SUPPRESS-GO-AHEAD" },
    { "direction": "server-do",   "option": 24, "optionName": "TERMINAL-TYPE", "ourResponse": "WILL TERMINAL-TYPE" },
    { "direction": "server-do",   "option": 31, "optionName": "NAWS", "ourResponse": "WILL NAWS" }
  ],
  "negotiatedOptions": ["ECHO", "SUPPRESS-GO-AHEAD", "TERMINAL-TYPE", "NAWS"],
  "rtt": 312
}
```

`rtt` is measured from the start of the call (includes DNS + TCP + negotiation round-trip).

### Negotiation policy

| Server sends | Option | Worker responds |
|---|---|---|
| `WILL` | ECHO (1) | `DO` — accepted |
| `WILL` | SUPPRESS-GO-AHEAD (3) | `DO` — accepted |
| `WILL` | anything else | `DONT` — rejected |
| `DO` | TERMINAL-TYPE (24) | `WILL` + `SB TERMINAL-TYPE IS "VT100" SE` |
| `DO` | NAWS (31) | `WILL` + `SB NAWS 0 80 0 24 SE` (80 cols × 24 rows) |
| `DO` | anything else | `WONT` — rejected |
| `WONT` | any | no response (RFC 855 §1) |
| `DONT` | any | no response (RFC 855 §1) |

All responses are batched into a single `writer.write()` call after parsing completes.

### Collection limit

The worker reads in a loop until whichever comes first:
- 3 chunks received (`rawChunks.length >= 3`)
- 3-second wall-clock deadline elapsed
- Read returns `done: true` (server closed)

Servers that dribble IAC sequences across many TCP segments (uncommon but possible) may have their later options missed. In practice most servers send all negotiation in the first 1–2 segments.

### Subnegotiation in input

If the server sends `SB ... IAC SE` blocks before the worker has a chance to send WILL TERMINAL-TYPE, those are silently consumed (skipped). The worker does not initiate SB from client side unless responding to `DO TERMINAL-TYPE` or `DO NAWS`.

---

## `/api/telnet/login` — Credential Submission

Automated login over Telnet. Submits username and password, then heuristically detects whether authentication succeeded.

### Request

```json
{
  "host": "192.168.1.1",
  "port": 23,
  "username": "admin",
  "password": "admin",
  "timeout": 15000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | |
| `port` | number | `23` | |
| `username` | string | required | |
| `password` | string | required | |
| `timeout` | number | `15000` ms | outer deadline |

### Response — success path

```json
{
  "success": true,
  "authenticated": true,
  "host": "192.168.1.1",
  "port": 23,
  "banner": "BusyBox v1.26.2\r\nlogin: ",
  "postAuthResponse": "admin@router:~# ",
  "messages": [
    "Banner/prompt received (42 chars)",
    "Sent username: admin",
    "Password prompt received",
    "Sent password",
    "Post-auth response received (17 chars)"
  ],
  "rtt": 1843
}
```

`banner` and `postAuthResponse` are each truncated to 500 characters. `messages` is a step-by-step trace.

### Response — auth failure

```json
{
  "success": true,
  "authenticated": false,
  "banner": "...",
  "postAuthResponse": "Login incorrect",
  ...
}
```

Note: `success: true` means the HTTP flow completed; `authenticated: false` means the heuristic detected a failure.

**500** is returned only if a network error or timeout prevents the flow from reaching the post-auth step.

### Authentication detection heuristic

```
authenticated =
  (postAuth.includes('$') || postAuth.includes('#') || postAuth.includes('>'))
  AND NOT lower.includes('incorrect')
  AND NOT lower.includes('invalid')
  AND NOT lower.includes('failed')
  AND NOT lower.includes('denied')
```

This is fragile. Known failure modes:

- A shell that uses `>` in an error message (e.g. `Error > try again`) would register as `authenticated: true`
- A successful login to a router that prints `Connection denied by peer` as MOTD would register as `authenticated: false`
- Prompts that don't contain `$`, `#`, or `>` (some embedded systems use `%`, custom strings, or immediate command output) register as `authenticated: false` even when login succeeded

### IAC handling in login

The `processIAC` helper responds to **all** negotiation options with refusal:

```
DO option  → DONT option
WILL option → WONT option
DONT/WONT   → silently ignored
SB ... SE   → silently consumed
```

This prevents echo suppression from being negotiated, so password bytes are echoed back by servers that require `DO ECHO`. If you need to test a server that requires ECHO negotiation, use the WebSocket tunnel and handle IAC in the browser.

### Sub-timeout arithmetic

The three `readUntilPrompt` calls use `Math.min(N, timeout)` where `timeout` is the user-supplied outer deadline (default 15000 ms):

| Step | Sub-timeout |
|------|-------------|
| Banner + login prompt | `min(8000, timeout)` |
| Password prompt | `min(6000, timeout)` |
| Post-auth response | `min(6000, timeout)` |

These sub-timeouts are applied sequentially, not against a shared remaining budget. At `timeout=15000` the worst-case elapsed time before the outer `socket.opened` timeout fires is: 8000 + 6000 + 6000 = **20 seconds** — longer than the default `timeout`. The outer `socket.opened` timeout only protects the initial TCP connect. Once connected, only the sub-timeouts bound elapsed time.

### Socket options

```typescript
connect({ hostname: host, port }, { secureTransport: 'off', allowHalfOpen: false })
```

`allowHalfOpen: false` means the socket closes when the server closes its write side, preventing the reader from hanging after logout.

---

## IAC Quick Reference

### Command bytes

| Decimal | Hex | Name | Meaning |
|---------|-----|------|---------|
| 240 | 0xF0 | SE | Subnegotiation end |
| 250 | 0xFA | SB | Subnegotiation begin |
| 251 | 0xFB | WILL | Sender will perform option |
| 252 | 0xFC | WONT | Sender refuses to perform option |
| 253 | 0xFD | DO | Request other side perform option |
| 254 | 0xFE | DONT | Request other side stop/not perform |
| 255 | 0xFF | IAC | Interpret as Command (escape byte) |

A literal 0xFF byte in data is represented as `IAC IAC` (0xFF 0xFF).

### Option codes (from `TELNET_OPTION_NAMES`)

| Code | Name |
|------|------|
| 1 | ECHO |
| 3 | SUPPRESS-GO-AHEAD |
| 5 | STATUS |
| 6 | TIMING-MARK |
| 24 | TERMINAL-TYPE |
| 31 | NAWS |
| 32 | TERMINAL-SPEED |
| 33 | REMOTE-FLOW-CONTROL |
| 34 | LINEMODE |
| 35 | X-DISPLAY-LOCATION |
| 36 | ENVIRONMENT |
| 37 | AUTHENTICATION |
| 38 | ENCRYPTION |
| 39 | NEW-ENVIRON |

Options not in this table appear as `"OPTION-<N>"` in negotiate output.

### Wire format

**Simple option negotiation (3 bytes):**
```
IAC  <WILL|WONT|DO|DONT>  <option>
FF   FB                   01       → WILL ECHO
FF   FD                   18       → DO TERMINAL-TYPE
```

**Subnegotiation (variable length):**
```
IAC  SB  <option>  <data bytes>  IAC  SE
FF   FA  18        00 56 54 31 30 30  FF F0
                   ^IS  V  T  1  0  0
                   (TERMINAL-TYPE IS "VT100")
```

**NAWS subnegotiation (9 bytes total):**
```
IAC  SB  1F  00 50  00 18  IAC  SE
FF   FA  31  00 80  00 24  FF   F0
             cols↑  rows↑
             (80 cols, 24 rows)
```

---

## `parseTelnetIAC` Utility

Exported from `src/worker/telnet.ts` for use by other modules:

```typescript
export function parseTelnetIAC(buffer: Uint8Array): {
  data: Uint8Array;   // non-IAC bytes
  commands: number[][]; // each IAC sequence as byte array
}
```

Correctly handles:
- Simple 3-byte commands: `[IAC, cmd, option]`
- Subnegotiations: `[IAC, SB, option, ...data, IAC, SE]`
- Single-byte IAC commands (NOP, DM, etc.): `[IAC, cmd]`

Not used by any HTTP endpoint internally — the negotiate and login handlers inline their own IAC parsers with different response logic.

---

## Cloudflare Detection

All four handlers call `checkIfCloudflare(host)` before opening the TCP socket. If the target resolves to a Cloudflare IP, the request is rejected with HTTP 403 and `isCloudflare: true`. This prevents accidental Telnet connections to Cloudflare-fronted hosts (which would never serve Telnet anyway).

---

## Known Limitations

| Limitation | Affected endpoint(s) | Detail |
|---|---|---|
| Raw IAC in banner | `/connect` (HTTP) | First TCP chunk decoded as-is; IAC bytes appear verbatim |
| No IAC processing server→browser | `/connect` (WebSocket) | `pipeTelnetToWebSocket` has explicit `"pass data through as-is"` comment |
| 3-chunk/3s collection cap | `/negotiate` | May miss IAC options in servers that send them across >3 TCP segments |
| Hardcoded terminal type | `/negotiate` | Always reports VT100 (80×24), not configurable |
| All IAC refused | `/login` | `DO`/`WILL` → `DONT`/`WONT` for every option, including ECHO |
| Fragile auth detection | `/login` | Shell prompt heuristic (`$`, `#`, `>`) can produce false positives/negatives |
| Sub-timeout overflow | `/login` | 8s+6s+6s = 20s worst case exceeds default 15s `timeout` |
| No STARTTLS | all | No upgrade to encrypted transport (Telnet has no TLS negotiation) |
| POST-only `/login` | `/login` | Returns 405 for non-POST; other endpoints accept GET |

---

## Test Coverage

Tests in `tests/telnet.test.ts` cover the `/connect` HTTP endpoint only:

- `telehack.com:23` — successful banner (GET and POST)
- Non-existent host — `success: false`
- Missing `host` — HTTP 400
- Custom `timeout` parameter
- Multiple servers (`aa.org`)
- Cloudflare-protected host — HTTP 403

No automated tests exist for `/negotiate`, `/login`, or the WebSocket tunnel.

---

## Resources

- **RFC 854** — [Telnet Protocol Specification](https://tools.ietf.org/html/rfc854)
- **RFC 855** — [Telnet Option Specifications](https://tools.ietf.org/html/rfc855)
- **RFC 856** — [ECHO option](https://tools.ietf.org/html/rfc856)
- **RFC 858** — [SUPPRESS-GO-AHEAD option](https://tools.ietf.org/html/rfc858)
- **RFC 1091** — [TERMINAL-TYPE option](https://tools.ietf.org/html/rfc1091)
- **RFC 1073** — [NAWS option](https://tools.ietf.org/html/rfc1073)
- **IANA Telnet Options** — [Registry](https://www.iana.org/assignments/telnet-options/)
