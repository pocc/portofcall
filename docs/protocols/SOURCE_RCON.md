# Source RCON Protocol — Port of Call Reference

**Spec:** [Valve Developer Wiki — Source RCON Protocol](https://developer.valvesoftware.com/wiki/Source_RCON_Protocol)
**Default port:** 27015 (Source engine) — **implementation default: 25575** (see gotcha below)
**Source:** `src/worker/rcon.ts`
**Tests:** `tests/source-rcon.test.ts`, `tests/rcon.test.ts`

Source RCON is a simple binary protocol for remote administration of Valve Source engine game servers (CS:GO, TF2, L4D2, GMod, etc.) and Minecraft Java Edition. Both games use the identical wire format; only the default port differs.

---

## Endpoints

| Method | Path | Summary |
|--------|------|---------|
| `POST` | `/api/rcon/connect` | Authenticate to an RCON server — returns auth result only |
| `POST` | `/api/rcon/command` | Authenticate + execute one command — returns command output |

There is no persistent session. **Every request opens a new TCP connection, authenticates, and closes.** `/api/rcon/command` performs a full authenticate-then-execute exchange in a single HTTP call.

---

## `POST /api/rcon/connect` — Authentication probe

Opens a TCP connection, sends `SERVERDATA_AUTH`, and reports whether the password was accepted.

**Request:**

```json
{
  "host": "gameserver.example.com",
  "port": 27015,
  "password": "my_rcon_password",
  "timeout": 10000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | Hostname or IPv4 address. Validated against `^[a-zA-Z0-9.-]+$` — no underscores, no IPv6, no embedded port |
| `port` | **`25575`** | See port gotcha below — always specify explicitly for Source servers |
| `password` | **required** | 1–512 characters |
| `timeout` | `10000` | Wall-clock race timeout in ms |

**Response — auth success (HTTP 200):**

```json
{
  "success": true,
  "authenticated": true
}
```

**Response — wrong password (HTTP 200):**

```json
{
  "success": true,
  "authenticated": false,
  "error": "Authentication failed - incorrect RCON password"
}
```

> **Critical gotcha:** When authentication fails due to a wrong password, the response is `success: true` with `authenticated: false`. `success: true` means only that the TCP connection and RCON exchange completed without a system error — it does **not** mean the password was accepted. Always check `authenticated`.

**Response — validation error (HTTP 400):**

```json
{
  "success": false,
  "error": "Host is required"
}
```

**Response — connection error (HTTP 500):**

```json
{
  "success": false,
  "error": "Connection timeout"
}
```

Validation error messages:

| Condition | Error message |
|-----------|---------------|
| Empty host | `"Host is required"` |
| Host with invalid chars | `"Host contains invalid characters"` |
| Port < 1 or > 65535 | `"Port must be between 1 and 65535"` |
| Empty password | `"Password is required for RCON authentication"` |
| Password > 512 chars | `"Password too long (max 512 characters)"` |

---

## `POST /api/rcon/command` — Execute command

Authenticates (same as `/connect`), then sends `SERVERDATA_EXECCOMMAND` and returns the server's output.

**Request:**

```json
{
  "host": "gameserver.example.com",
  "port": 27015,
  "password": "my_rcon_password",
  "command": "status",
  "timeout": 10000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `command` | **required** | 1–1446 bytes. Limit enforced before connection. |
| Other fields | same as `/connect` | |

**Response — success (HTTP 200):**

```json
{
  "success": true,
  "authenticated": true,
  "response": "hostname: My CS:GO Server\nversion : 1.38.0.0/13800 ...\nmap     : de_dust2\nplayers : 5 humans, 0 bots (16/0 max)\n..."
}
```

`response` is the concatenation of all `SERVERDATA_RESPONSE_VALUE` (type 0) packet bodies received after the command. It is `"(No output)"` if the server returned no data.

**Response — wrong password (HTTP 401):**

```json
{
  "success": false,
  "authenticated": false,
  "error": "Authentication failed - incorrect RCON password"
}
```

**Response — command too long (HTTP 400):**

```json
{
  "success": false,
  "error": "Command too long (max 1446 characters, RCON body limit)"
}
```

---

## Wire format

All integers are **little-endian signed 32-bit** (`int32LE`). A packet consists of:

```
Offset  Size  Field
------  ----  -----
0       4     Size — length of the rest of the packet (excludes this field)
4       4     Request ID — client-assigned; server echoes in response; -1 = auth failure
8       4     Type — see table below
12      N     Body — UTF-8 string
12+N    1     Null terminator for body
12+N+1  1     Null pad byte (always 0x00)
```

`Size = 4 (id) + 4 (type) + N (body) + 2 (nulls)` — i.e. excludes the 4 bytes of the Size field itself.

**Packet types:**

| Value | Direction | Name | Meaning |
|-------|-----------|------|---------|
| `3` | client → server | `SERVERDATA_AUTH` | Authentication request (body = password) |
| `2` | server → client | `SERVERDATA_AUTH_RESPONSE` | Auth result; id=-1 means failure |
| `2` | client → server | `SERVERDATA_EXECCOMMAND` | Execute command (body = command string) |
| `0` | server → client | `SERVERDATA_RESPONSE_VALUE` | Command output fragment |

Note that type `2` is used for **both** `SERVERDATA_AUTH_RESPONSE` (server→client) and `SERVERDATA_EXECCOMMAND` (client→server). Distinguish by direction and request ID.

**Auth exchange:**

```
Client → Server:  [type=3, id=1, body="password"]
Server → Client:  [type=0, id=1, body=""]        ← empty RESPONSE_VALUE first
Server → Client:  [type=2, id=1, body=""]        ← AUTH_RESPONSE; id==-1 if wrong password
```

**Command exchange (after auth):**

```
Client → Server:  [type=2, id=2, body="status"]
Server → Client:  [type=0, id=2, body="hostname: ...\nmap: ...\n"]
```

**Hardcoded request IDs:** The implementation always uses `id=1` for auth and `id=2` for commands. If a server ever sends a response with a different ID, it is still processed — the parser does not validate ID matching.

---

## Multi-packet response handling

The `readFromSocket` function uses a **two-phase read**:

1. **First read** — blocks until the first TCP chunk arrives (or timeout)
2. **200ms drain** — after the first chunk, reads any additional chunks that arrive within 200ms, then stops

This handles the common case where a server sends the auth response as two packets (the empty `RESPONSE_VALUE` followed by `AUTH_RESPONSE`), and where long command outputs (like `cvarlist`) span multiple TCP segments.

**Truncation risk:** If a command produces a very large response (e.g., `cvarlist` returns thousands of lines) that the server sends in bursts with inter-burst gaps > 200ms, only the first burst is captured. The 200ms window is hardcoded and not configurable.

---

## Gotchas

**Default port is 25575 (Minecraft), not 27015 (Source).** Both `handleRCONConnect` and `handleRCONCommand` default to `port: 25575`. Source engine servers use port 27015 by default. Always specify the port explicitly:

```json
{ "host": "cs2server.example.com", "port": 27015, "password": "..." }
```

**`success: true` does not mean authenticated.** In `/api/rcon/connect`, a successful TCP exchange + wrong password returns `{ "success": true, "authenticated": false }`. In `/api/rcon/command`, a wrong password returns `{ "success": false, "authenticated": false }` with HTTP 401 — more intuitive, but different from `/connect`.

**Host validation rejects underscores.** The regex `^[a-zA-Z0-9.-]+$` rejects hosts like `game_server.example.com` or `192.168.1.1:27015`. Use only hostnames with hyphens or pure IP addresses.

**No persistent session.** Every `/api/rcon/command` call re-authenticates. On busy servers or those with `sv_rcon_maxfailures` set low, rapid consecutive calls may trigger the source engine's ban penalty.

**Empty command output.** Some Source commands produce no output (e.g., `say`, `changelevel`). The response body in those cases is `"(No output)"`, not `""`.

**No Cloudflare detection.** Unlike most other Port of Call endpoints, there is no `checkIfCloudflare()` call. Connecting to a Cloudflare-proxied host on port 27015 will result in a generic timeout or connection error, not the structured `{ isCloudflare: true }` response.

**`cvarlist` truncation.** The `cvarlist` command returns hundreds of lines. Due to the 200ms drain window, you may receive a partial result. There is no multi-packet sentinel or end-of-data signaling in Source RCON.

**Command byte limit.** The 1446-byte limit on command bodies is enforced at the HTTP request layer. It is not derived from any protocol field limit — the RCON body field is actually limited by the `size` field (int32, ~2GB), but Valve's server-side parser has historically rejected longer commands.

---

## Auth failure response asymmetry

The two endpoints behave differently when authentication fails:

| Endpoint | Auth failure HTTP status | `success` | `authenticated` |
|----------|--------------------------|-----------|-----------------|
| `/connect` | 200 | `true` | `false` |
| `/command` | 401 | `false` | `false` |

In `/connect`, auth failure is a "successful probe result" (you learned the password is wrong). In `/command`, auth failure is treated as an error that prevents command execution.

---

## Quick reference — curl

```bash
# Test authentication (check if RCON password is correct)
curl -s -X POST https://portofcall.ross.gg/api/rcon/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10","port":27015,"password":"mypassword"}' | jq '{authenticated,error}'

# Execute a command
curl -s -X POST https://portofcall.ross.gg/api/rcon/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10","port":27015,"password":"mypassword","command":"status"}' | jq -r '.response'

# List all connected players
curl -s -X POST https://portofcall.ross.gg/api/rcon/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10","port":27015,"password":"mypassword","command":"users"}' | jq -r '.response'

# Get server hostname
curl -s -X POST https://portofcall.ross.gg/api/rcon/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10","port":27015,"password":"mypassword","command":"hostname"}' | jq -r '.response'

# Minecraft RCON (default port 25575, can omit port)
curl -s -X POST https://portofcall.ross.gg/api/rcon/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"mc.example.com","password":"mypassword","command":"list"}' | jq -r '.response'
```

---

## Local test server

**Source Dedicated Server** (srcds):

```bash
./srcds_run -game csgo +map de_dust2 +rcon_password "testpass" -port 27015
```

Useful Source cvars for RCON:

```
sv_rcon_maxfailures 5     # auth failures before temporary ban
sv_rcon_banpenalty 60     # ban duration in seconds
sv_rcon_minfailures 5
sv_rcon_minfailuretime 30
```

**Minecraft** (server.properties):

```
enable-rcon=true
rcon.password=testpass
rcon.port=25575
```

---

## What is NOT implemented

- **Persistent sessions** — no session caching; each call re-authenticates
- **Multi-packet sentinel** — the standard technique to detect end-of-response (send a second empty command with a unique ID and wait for its response) is not implemented; 200ms drain is used instead
- **SCRAM or TLS** — RCON is plaintext TCP; credentials are transmitted in cleartext
- **Cloudflare detection** — no `isCloudflare` check
- **Long-polling or streaming** — commands that produce continuous output (e.g., `log on`) are not supported; only the first 200ms burst is captured
