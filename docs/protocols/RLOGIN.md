# Rlogin (RFC 1282) — Port 513

BSD Remote Login. Cleartext trust-based terminal protocol, predecessor to SSH. Three handlers in `src/worker/rlogin.ts`, two routes in `index.ts`.

## Endpoints

| Route | Method | Handler | CF Detection | Timeout (outer) | Timeout (inner read) |
|---|---|---|---|---|---|
| `/api/rlogin/connect` | POST / GET | `handleRloginConnect` | Yes | 10 s (configurable) | 5 s handshake + 1 s banner |
| `/api/rlogin/connect` | GET + `Upgrade: websocket` | `handleRloginWebSocket` | No | None | None |
| `/api/rlogin/banner` | POST | `handleRloginBanner` | No | 10 s (configurable) | 4 s (single read) |

### Route dispatch

`/api/rlogin/connect` is shared between two handlers. If the request has `Upgrade: websocket`, it goes to `handleRloginWebSocket`; otherwise to `handleRloginConnect`. This is done in `index.ts` at the routing level.

`/api/rlogin/banner` always goes to `handleRloginBanner`. No method check — POST body parsing will throw on non-JSON methods, returning 500.

---

## `POST /api/rlogin/connect`

Performs the Rlogin handshake and returns the server's response.

**Request:**
```json
{
  "host": "bsd-server.local",
  "port": 513,
  "localUser": "ross",
  "remoteUser": "root",
  "terminalType": "vt100",
  "terminalSpeed": "9600",
  "timeout": 5000
}
```

All fields except `host` are optional. Defaults: port=513, localUser="guest", remoteUser="guest", terminalType="xterm", terminalSpeed="38400", timeout=10000.

**Response (server accepted):**
```json
{
  "success": true,
  "host": "bsd-server.local",
  "port": 513,
  "protocol": "Rlogin",
  "rtt": 42,
  "serverAccepted": true,
  "serverMessage": "Connection accepted",
  "banner": "Last login: Sat Feb 15 from 10.0.0.1",
  "handshake": {
    "localUser": "ross",
    "remoteUser": "root",
    "terminalType": "vt100",
    "terminalSpeed": "9600"
  },
  "security": "NONE — Rlogin transmits credentials in cleartext. Use SSH instead."
}
```

**Response (server rejected):**
```json
{
  "success": true,
  "serverAccepted": false,
  "serverMessage": "Permission denied.",
  "...": "..."
}
```

Note: `success: true` with `serverAccepted: false` — the TCP connection and handshake completed, but the server rejected the login. This is not an error from Port of Call's perspective.

### `GET /api/rlogin/connect`

Same endpoint, query-param form. Parses: `host`, `port`, `localUser`, `remoteUser`, `timeout`.

**Missing from GET:** `terminalType` and `terminalSpeed` are NOT parsed from query params. They always default to `xterm` / `38400` regardless of what you pass.

```
GET /api/rlogin/connect?host=bsd.local&port=513&localUser=ross&remoteUser=root&timeout=5000
```

### Wire sequence (`/connect`)

Two separate TCP writes:

```
Client → Server:  \x00                                       (1 byte)
Client → Server:  localUser\x00remoteUser\x00term/speed\x00  (variable)
Server → Client:  \x00 [optional banner text]                (read 1, 5 s timeout)
Server → Client:  [additional banner]                        (read 2, 1 s timeout)
```

The null byte and credential string are sent as **two separate `writer.write()` calls**. Some servers may be sensitive to this framing.

---

## `POST /api/rlogin/banner`

Lighter-weight banner grab. Sends the preamble, reads one response, strips control characters, returns structured result.

**Request:** Same body shape as `/connect`.

**Response:**
```json
{
  "success": true,
  "connected": true,
  "banner": "FreeBSD 13.2 (bsd.local) (ttyp0)\n\nlogin:",
  "raw": "\u0000FreeBSD 13.2 (bsd.local) (ttyp0)\r\n\r\nlogin: ",
  "latencyMs": 38
}
```

### Differences from `/connect`

| Aspect | `/connect` | `/banner` |
|---|---|---|
| HTTP methods | POST + GET | POST only |
| CF detection | Yes (403 if Cloudflare) | No |
| Preamble framing | 2 writes (null byte, then creds) | 1 write (null byte + creds concatenated) |
| Server response | 2 reads (5 s + 1 s) | 1 read (4 s) |
| Control char stripping | None (raw `TextDecoder`) | Regex strips `\x00-\x08`, `\x0b`, `\x0c`, `\x0e-\x1f`, `\x7f`; keeps `\n` and `\t` |
| Response shape | `serverAccepted`, `serverMessage`, `banner`, `handshake`, `security`, `rtt` | `connected`, `banner`, `raw`, `latencyMs` |
| Empty banner | `serverMessage` = "Connection accepted" | `banner` = "(no banner)" |

The **single-write preamble** in `/banner` means the null byte and credential string arrive in the same TCP segment. This is a valid Rlogin preamble per RFC 1282, but differs from the two-write approach in `/connect`. Most servers accept both.

---

## WebSocket `/api/rlogin/connect`

Interactive terminal tunnel. Performs the Rlogin handshake over TCP, then bridges bidirectional data between the WebSocket and the TCP socket.

**Query params:** `host` (required), `port`, `localUser`, `remoteUser`, `terminalType`, `terminalSpeed`. All optional params have the same defaults as `/connect`.

```
wscat -c "wss://portofcall.ross.gg/api/rlogin/connect?host=bsd.local&remoteUser=root"
```

### WebSocket wire sequence

```
1. Client opens WebSocket
2. Worker opens TCP to host:port
3. Worker sends: \x00 (separate write)
4. Worker sends: localUser\x00remoteUser\x00term/speed\x00
5. TCP→WS forwarding loop starts (binary frames)
6. WS→TCP forwarding via message event listener
```

### Known issues

- **No Cloudflare detection** — connects directly without checking. If the target resolves to Cloudflare, you get a TCP error instead of a clean 403.
- **No timeout** — neither an outer connection timeout nor a per-read timeout. If the server never responds, the WebSocket hangs until the Workers execution time limit kills it.
- **No window resize** — RFC 1282 defines a 12-byte TCP urgent data message for terminal resize (`0xFF 0xFF s s rr cc xpixel ypixel`). Cloudflare Workers sockets don't support TCP urgent data, so `SIGWINCH` is silently lost.
- **Reader lock on close** — the `close` event handler calls `reader.releaseLock()`, but if the TCP→WS forwarding loop is mid-read, this races. The forwarding loop's `catch {}` swallows the error, so it degrades silently.
- **String vs binary** — WS→TCP path handles both `string` (TextEncoder) and `ArrayBuffer` (Uint8Array). TC→WS path sends raw `Uint8Array`. This means the WebSocket may receive binary frames even if you send text frames.

---

## Quirks and Limitations

### 1. `success: true` + `serverAccepted: false`
`/connect` returns `success: true` whenever the TCP handshake completes, even if the server rejects the login. Check `serverAccepted` to know if you actually got a shell.

### 2. No host regex validation
None of the three handlers validate the `host` parameter against a regex. They only check for empty/falsy. You can pass IP addresses, hostnames with underscores, IPv6 literals — anything `connect()` will attempt.

### 3. No port validation
No range check on `port`. `/connect` and `/banner` default to 513 via `|| 513`. `/websocket` uses `parseInt(... || '513')` which returns `NaN` for non-numeric strings, then `connect()` gets `host:NaN` which fails at the TCP level.

### 4. Cloudflare detection inconsistency
Only `/connect` checks Cloudflare before connecting. `/banner` and `/websocket` skip the check. If you need CF detection, use `/connect` first, then `/banner` or WebSocket.

### 5. Timeout architecture
```
/connect:
  └─ outer: configurable (default 10 s)
     ├─ inner handshake read: hardcoded 5 s
     └─ inner banner read: hardcoded 1 s

/banner:
  └─ outer: configurable (default 10 s)
     └─ inner read: hardcoded 4 s

/websocket:
  └─ (none)
```

The inner timeouts in `/connect` cap at 6 s total (5 + 1), so the outer timeout only matters for TCP connection establishment. If the TCP connect takes >4 s and the inner read takes the full 5 s, the outer 10 s timeout fires first.

### 6. Error response shape divergence
- `/connect` errors: `{ success: false, error: "..." }` — HTTP 400 for missing host, 403 for Cloudflare, 500 for everything else.
- `/banner` errors: `{ success: false, connected: false, banner: "", raw: "", latencyMs: 0, error: "..." }` — full `RloginBannerResult` shape always, HTTP 400 or 500.
- `/websocket` errors: `{ error: "..." }` (no `success` field) — HTTP 400 for missing host, 426 for missing Upgrade header, 500 for other errors.

### 7. Privileged port
RFC 1282 requires the client to connect from a privileged port (<1024) for `.rhosts` trust to work. Cloudflare Workers cannot bind to specific source ports. Servers that enforce this (most rlogind implementations) will reject the connection even if `.rhosts` allows it. You'll see `serverAccepted: false` with a "Permission denied" message.

### 8. `rtt` vs `latencyMs`
`/connect` returns `rtt` (includes TCP connect + handshake + first read). `/banner` returns `latencyMs` (includes TCP connect + handshake + first read). Same measurement, different field name.

---

## curl Examples

```bash
# Basic probe
curl -s https://portofcall.ross.gg/api/rlogin/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"bsd.local"}' | jq .

# Probe with custom credentials
curl -s https://portofcall.ross.gg/api/rlogin/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"bsd.local","remoteUser":"root","localUser":"admin","timeout":5000}' | jq .

# GET form (no terminalType/Speed control)
curl -s 'https://portofcall.ross.gg/api/rlogin/connect?host=bsd.local&remoteUser=root&timeout=5000' | jq .

# Banner grab
curl -s https://portofcall.ross.gg/api/rlogin/banner \
  -H 'Content-Type: application/json' \
  -d '{"host":"bsd.local","remoteUser":"root"}' | jq .

# WebSocket interactive session
wscat -c 'wss://portofcall.ross.gg/api/rlogin/connect?host=bsd.local&remoteUser=root'
```

## Local Testing

```bash
# Docker with rlogind (requires privileged for port 513)
docker run --rm -p 513:513 --name rlogind alpine sh -c \
  'apk add busybox-extras && rlogind -f -n'

# Or use xinetd with rlogin service
# /etc/xinetd.d/rlogin:
#   service login { socket_type = stream; protocol = tcp; wait = no;
#     user = root; server = /usr/sbin/in.rlogind; }
```

## RFC 1282 Reference

| Section | Topic |
|---|---|
| §1 | Overview: automatic login without password exchange |
| §2 | Protocol: null byte, credential string, terminal type/speed |
| §3 | Window size: 12-byte urgent data structure (not implemented) |
| §4 | Flow control: `\x80` flag byte signals start-flow/stop-flow (not implemented) |
| §5 | Security: `.rhosts`, `/etc/hosts.equiv`, privileged port requirement |
