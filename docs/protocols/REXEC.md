# Rexec — Port 512

BSD Remote Execution protocol. Executes a single command on a remote host with explicit username/password authentication (cleartext). The command-execution companion to Rlogin (513) and RSH (514) in the BSD r-services family. Superseded by SSH.

## Endpoints

| Route | Method | Mode | Handler |
|-------|--------|------|---------|
| `/api/rexec/execute` | POST | One-shot command execution | `handleRexecExecute` |
| `/api/rexec/execute` | GET | One-shot (query params, no password) | `handleRexecExecute` |
| `/api/rexec/execute` | WS (`Upgrade: websocket`) | Interactive tunnel | `handleRexecWebSocket` |

Single route, three modes. The router checks `Upgrade: websocket` first; if absent, falls through to the HTTP handler which branches on POST vs. any-other-method (not just GET — PUT/DELETE/PATCH all hit the GET branch).

---

## `POST /api/rexec/execute`

Execute a command and return output as JSON.

**Request:**
```json
{
  "host": "bsd-server.example.com",
  "port": 512,
  "username": "admin",
  "password": "secret",
  "command": "uname -a",
  "timeout": 10000
}
```

All fields except `host` are optional.

| Field | Default | Notes |
|-------|---------|-------|
| `port` | `512` | No range validation — 0 or 99999 are accepted without error |
| `username` | `"guest"` | |
| `password` | `""` | Sent in cleartext. Empty string means no password |
| `command` | `"id"` | Null-terminated before sending |
| `timeout` | `10000` | Outer timeout in ms — caps the entire operation |

**Success response (HTTP 200):**
```json
{
  "success": true,
  "host": "bsd-server.example.com",
  "port": 512,
  "protocol": "Rexec",
  "rtt": 45,
  "serverAccepted": true,
  "username": "admin",
  "command": "uname -a",
  "output": "FreeBSD bsd-server 13.2-RELEASE amd64",
  "note": "Rexec (port 512) is the BSD remote execution protocol...",
  "security": "NONE — Rexec transmits username and password in cleartext. Use SSH instead."
}
```

**Auth failure response (HTTP 200 — not 401):**
```json
{
  "success": true,
  "serverAccepted": false,
  "serverMessage": "Permission denied.",
  "host": "...",
  "port": 512,
  "protocol": "Rexec",
  "rtt": 52,
  "username": "admin",
  "command": "id",
  "note": "...",
  "security": "..."
}
```

`success: true` with `serverAccepted: false` means the TCP connection and protocol exchange worked, but the server rejected the credentials or command. The HTTP status is 200 in both cases — check `serverAccepted` to distinguish.

**`output` field:** Trimmed. If the command produced no output (or only whitespace), the field is `undefined` (omitted from JSON), not `""`.

**`rtt` field:** Measures wall-clock time from `connect()` call through handshake to first server response byte. This is *not* pure TCP RTT — it includes the full 4-message handshake + server processing time.

### curl examples

```bash
# Execute a command
curl -s -X POST https://portofcall.app/api/rexec/execute \
  -H 'Content-Type: application/json' \
  -d '{"host":"bsd-server.example.com","username":"admin","password":"secret","command":"uptime"}'

# Probe with default command (id)
curl -s -X POST https://portofcall.app/api/rexec/execute \
  -H 'Content-Type: application/json' \
  -d '{"host":"bsd-server.example.com","username":"admin","password":"secret"}'
```

---

## `GET /api/rexec/execute`

Same handler, but parameters come from query string.

```
GET /api/rexec/execute?host=bsd-server.example.com&username=admin&command=whoami&timeout=5000
```

**Password gap:** GET mode does not read a `password` query parameter. The password always defaults to `""`. This means GET mode is effectively probe-only — it can only authenticate against servers that accept empty passwords. Use POST to supply a password.

| Param | Default (GET) | Default (POST) |
|-------|--------------|----------------|
| `host` | required | required |
| `port` | `512` | `512` |
| `username` | `"guest"` | `"guest"` |
| `password` | *always `""`* | `""` |
| `command` | `"id"` (via falsy default) | `"id"` |
| `timeout` | `10000` | `10000` |

Note on `command` default: GET extracts `command` as `url.searchParams.get('command') || ''` (empty string), but the shared default at line 68 is `options.command || 'id'` — since `""` is falsy, it falls through to `"id"`. So both modes effectively default to `"id"`.

---

## WebSocket `/api/rexec/execute`

Interactive tunnel. The server performs the Rexec handshake over TCP, then bridges the TCP socket to the WebSocket bidirectionally.

**Connection:**
```
ws://portofcall.app/api/rexec/execute?host=bsd-server.example.com&username=admin&password=secret&command=bash
```

| Param | Default | Notes |
|-------|---------|-------|
| `host` | required | HTTP 400 if missing |
| `port` | `512` | |
| `username` | `"guest"` | |
| `password` | `""` | **Exposed in URL** (query param) |
| `command` | `"id"` | Use `bash` or `sh` for interactive shell |

### Differences from HTTP mode

| Aspect | HTTP | WebSocket |
|--------|------|-----------|
| Cloudflare detection | Yes (HTTP 403) | **No** — connects directly |
| Timeout | Configurable (default 10s) | **None** — Workers execution limits only |
| First byte handling | Parsed (serverAccepted true/false) | **Raw** — forwarded as-is to client |
| Output format | JSON string | Raw binary (Uint8Array) |
| Stdin | Not supported | Supported (WS → TCP forwarding) |
| Password in URL | No (POST body) | **Yes** (query param, logged in access logs) |
| Host validation | None | None |
| Error response | JSON `{ success: false }` | WebSocket close or HTTP 400/426/500 |

### Wire data flow

```
Browser  ←→  WebSocket  ←→  Worker  ←→  TCP  ←→  Rexec Server
         WS frames              raw bytes
```

The worker performs the Rexec handshake (stderr port + username + password + command) over the TCP connection, then:

- **TCP → WebSocket:** Raw `Uint8Array` chunks forwarded as binary WebSocket frames. The first byte of the first chunk is the status byte (`\0` or `\1`) — the client must parse it.
- **WebSocket → TCP:** String messages are UTF-8 encoded; `ArrayBuffer` messages are forwarded as `Uint8Array`. This is stdin to the running command.

### WebSocket lifecycle bugs

- **Reader/writer lock race:** The `close` event handler calls `writer.releaseLock()` and `reader.releaseLock()`, but the TCP→WS read loop and WS→TCP message handler may still hold them. No guard against concurrent access.
- **No error propagation:** If the TCP connection fails during the handshake, `server.close()` is called but no error frame or message is sent to the WebSocket client first.

---

## Wire Protocol

```
Client → Server:
  stderrPort \0          ← ASCII port number or empty; always \0 here
  username \0            ← cleartext
  password \0            ← cleartext
  command \0             ← shell command

Server → Client:
  \0 [stdout...]         ← success: first byte 0x00, then output
  \1 [error message]     ← failure: first byte 0x01, then error text
```

### Stderr channel

The Rexec protocol supports a secondary TCP connection for stderr: the client sends a port number, and the server connects *back* to the client on that port. This implementation always sends `\0` (no stderr port) because Cloudflare Workers cannot accept inbound TCP connections. All output (stdout and stderr) arrives on the primary connection.

### Non-standard servers

The implementation handles servers that send error messages without the `\1` prefix byte (line 134-137). If the first byte is neither `\0` nor `\1`, the entire response is treated as an error message with `serverAccepted: false`.

---

## Timeout Architecture

Three timeout layers, all inside the HTTP handler only (WebSocket has none):

| Timer | Duration | Scope | Behavior |
|-------|----------|-------|----------|
| Outer timeout | `timeout` param (default 10s) | Entire operation | `Promise.race` → HTTP 500 |
| Handshake read | 5s (hardcoded) | First server response | `Promise.race` → throws, caught by outer |
| Output collect | 2s (hardcoded) | Post-handshake output | Resolves `{ done: true }`, stops reading |

**Worst case:** The outer timeout is the cap. The 5s handshake + 2s output windows are both racing against it. With the default 10s outer timeout, a slow server could spend 5s on handshake + 2s on output = 7s total, well within the 10s limit.

**Output collection window:** The 2s timeout Promise is created once (not per-chunk). After 2s from the start of output reading, all subsequent `reader.read()` calls immediately lose the race. Up to 10 read iterations are attempted, but in practice the 2s window is the real limit. This means: if a command produces output slowly (one line per second), you get at most ~2 seconds worth.

**Timer cleanup:** Neither the 5s nor the 2s timeout Promises use `clearTimeout`. The Promises and their timers are GC'd when the function scope exits, but technically the timers fire after the response is already sent.

---

## Known Limitations

1. **No stderr separation** — Workers can't accept inbound connections, so stderr is always merged with stdout on the primary channel.
2. **No port validation** — Port is `parseInt()` with no range check. Port 0, negative numbers, or values > 65535 are passed to `connect()` as-is.
3. **No host regex validation** — Unlike some other protocol handlers, there's no hostname format check. Any string is passed to `connect()`.
4. **No method restriction** — Any HTTP method (PUT, DELETE, PATCH) hits the GET code path. Only POST is explicitly handled.
5. **GET mode can't send passwords** — The GET handler omits `password` from query param extraction. POST is required for authenticated execution.
6. **Single TCP read for output** — Max 10 chunks within a 2-second window. Long-running commands will have their output truncated.
7. **No TLS** — Raw TCP only. The protocol itself has no encryption mechanism.
8. **`success: true` with `serverAccepted: false`** — Auth failures return HTTP 200 with `success: true`. Check `serverAccepted` for the actual result.
9. **WebSocket: no Cloudflare detection** — The HTTP endpoint checks `checkIfCloudflare()` and returns 403; the WebSocket endpoint skips this entirely.
10. **WebSocket: password in URL** — The `password` query parameter appears in server access logs, browser history, and any proxy logs.
11. **No `Content-Type` validation** — POST body is parsed as JSON unconditionally. Sending non-JSON produces a 500, not a 400.

---

## Cloudflare Detection

HTTP mode only. Calls `checkIfCloudflare(host)` before connecting. Returns HTTP 403:

```json
{
  "success": false,
  "error": "...",
  "isCloudflare": true
}
```

WebSocket mode does not perform this check.

---

## Local Testing

Start a Rexec daemon (most modern systems don't have one installed by default):

```bash
# On a FreeBSD or old Linux system with inetd:
# /etc/inetd.conf should have:
# exec stream tcp nowait root /usr/sbin/rexecd rexecd

# Or via Docker with a BSD image:
docker run -it --rm -p 512:512 freebsd/freebsd:13.2

# Test with the traditional rexec client:
rexec bsd-server id
```

---

## BSD R-Services Family

| Protocol | Port | Auth | Purpose | Stderr | Interactive |
|----------|------|------|---------|--------|-------------|
| **Rexec** | **512** | **Password (cleartext)** | **Execute one command** | **Optional (callback port)** | **No** |
| Rlogin | 513 | .rhosts trust | Interactive shell | Via terminal | Yes |
| RSH | 514/tcp | .rhosts trust | Execute one command | Callback port | No |
| SSH | 22 | Keys/passwords/certs | All of the above | Multiplexed channels | Yes |

Rexec is the only BSD r-service that requires a password (the others use host-based `.rhosts` trust). Ironically, this makes it "more secure" in concept but the cleartext transmission negates any advantage.
