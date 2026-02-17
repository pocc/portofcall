# POP3 — Power User Reference

**Ports:** 110 (plaintext) · 995 (POP3S — implicit TLS via `secureTransport: 'on'`)
**RFC:** 1939 (core), 2449 (CAPA/extensions), 2595 (STLS), 8314 (POP3S)
**Tests:** 18/18 ✅ Deployed
**Source:** `src/worker/pop3.ts` (plain) · `src/worker/pop3s.ts` (TLS)

Two endpoint families, 7 endpoints each. All open a fresh TCP connection per call; there are no persistent sessions.

---

## POP3 — Plain TCP (`/api/pop3/`)

### `GET|POST /api/pop3/connect` — Greeting probe + optional auth

Reads the greeting, optionally runs USER/PASS, sends QUIT.

**Fields:**

| Field | Default | Required | Notes |
|---|---|---|---|
| `host` | — | ✅ | |
| `port` | `110` | | |
| `username` | — | | If omitted, only the greeting is checked |
| `password` | — | | Required if `username` is set |
| `timeout` | `30000` | | Wall-clock timeout in ms |

**Success (no auth):**
```json
{
  "success": true,
  "message": "POP3 server reachable",
  "host": "pop.example.com",
  "port": 110,
  "greeting": "+OK POP3 server ready <token@host>",
  "authenticated": false,
  "note": "Connection test only (no authentication)"
}
```

**Success (with auth):**
```json
{
  "success": true,
  "greeting": "+OK POP3 server ready",
  "authenticated": true,
  "capabilities": "+OK Logged in.",
  "note": "Successfully authenticated"
}
```

> **`capabilities` field is misnamed.** When authenticated, it contains the raw `PASS` +OK response (e.g., `+OK Logged in.`), not server capability strings. Use `/api/pop3/capa` for actual CAPA output.

**GET form:** same field names as query params. `username`, `password`, `timeout` all accepted.

---

### `POST /api/pop3/list` — Authenticate + STAT + LIST

Runs USER/PASS, then STAT (for totals), then LIST (for per-message sizes).

**Required:** `host`, `username`, `password`

**Success:**
```json
{
  "success": true,
  "messages": [
    { "id": 1, "size": 4210 },
    { "id": 2, "size": 12048 }
  ],
  "totalMessages": 2,
  "totalSize": 16258
}
```

- `totalMessages` and `totalSize` come from STAT (`+OK count octets`)
- `messages` is the per-message breakdown from LIST (multi-line response)
- Message IDs are session-local ordinal numbers — they can change between sessions. Use `/api/pop3/uidl` for stable UIDs.

---

### `POST /api/pop3/retrieve` — Authenticate + RETR

**Required:** `host`, `username`, `password`, `messageId` (integer)

```json
{ "host": "pop.example.com", "username": "alice", "password": "s3cr3t", "messageId": 1 }
```

**Success:**
```json
{
  "success": true,
  "messageId": 1,
  "message": "From: sender@example.com\r\nTo: alice@example.com\r\n..."
}
```

- `message` is the full RFC 5322 message (headers + body), with the +OK line and terminating `.` stripped
- The multi-line read has a 30 s inner timeout
- Dot-unstuffing is **not** performed: `..` from the wire is left as-is (see [Known Limitations](#known-limitations))

> **Parameter inconsistency:** this endpoint uses `messageId`; `/dele` and `/top` use `msgnum`. Both refer to the session-local ordinal. See [Parameter name inconsistency](#parameter-name-inconsistency).

---

### `POST /api/pop3/dele` — Authenticate + DELE + QUIT

Marks a message for deletion and immediately commits it by sending QUIT.

**Required:** `host`, `username`, `password`, `msgnum` (integer)

**Success:**
```json
{ "success": true, "msgnum": 3, "message": "+OK Message 3 deleted." }
```

Per RFC 1939 §8: deletion is committed when the server enters UPDATE state on a successful QUIT. The endpoint sends QUIT immediately after DELE, so the deletion is committed. If QUIT fails or the connection drops before QUIT, the server will NOT delete the message. `success: true` means the DELE +OK was received, not that the deletion was committed.

---

### `POST /api/pop3/uidl` — Authenticate + UIDL

Returns unique IDs for all messages. UIDs persist across sessions (unlike ordinal message numbers).

**Required:** `host`, `username`, `password`

**Success:**
```json
{
  "success": true,
  "messages": [
    { "msgnum": 1, "uid": "whqtswO00WBw418f9t5JxYwZ" },
    { "msgnum": 2, "uid": "oaFTRwFoJyA4gl3tptycPAtT" }
  ],
  "count": 2
}
```

- `msgnum` is the session-local ordinal (same as in LIST)
- `uid` is an opaque server-assigned string, guaranteed unique per mailbox (RFC 1939 §7)
- Combine with `/list` by matching `msgnum` to get both size and UID

---

### `POST /api/pop3/top` — Authenticate + TOP

Retrieves headers plus the first N body lines. Useful for previewing without downloading the full message.

**Required:** `host`, `username`, `password`, `msgnum`
**Optional:** `lines` (default `0` = headers only)

**Success:**
```json
{ "success": true, "msgnum": 1, "lines": 10, "content": "From: ...\r\n...\r\n\r\n[first 10 body lines]" }
```

`lines: 0` returns all headers and an empty body section. The server is required to return all headers regardless of `lines`.

---

### `GET|POST /api/pop3/capa` — Server capabilities (no auth)

Sends CAPA immediately after greeting, before USER/PASS.

**Required:** `host` only (no credentials needed)

**Success:**
```json
{
  "success": true,
  "host": "pop.example.com",
  "port": 110,
  "capabilities": ["TOP", "USER", "SASL PLAIN LOGIN", "UIDL", "RESP-CODES", "PIPELINING", "STLS", "AUTH-RESP-CODE"]
}
```

Common capabilities:

| Capability | RFC | Meaning |
|---|---|---|
| `TOP` | 1939 | TOP command supported |
| `UIDL` | 1939 | UIDL command supported |
| `USER` | 1939 | USER/PASS authentication |
| `SASL` | 5034 | SASL mechanisms listed (e.g., `SASL PLAIN GSSAPI`) |
| `STLS` | 2595 | STARTTLS available (not negotiated by this implementation) |
| `PIPELINING` | 2449 | Multiple commands may be batched |
| `RESP-CODES` | 2449 | Extended response codes in -ERR lines |
| `AUTH-RESP-CODE` | 3206 | [AUTH] and [SYS] codes in auth failures |
| `EXPIRE` | 2449 | Message expiry policy |
| `LOGIN-DELAY` | 2449 | Minimum seconds between logins |
| `IMPLEMENTATION` | 2449 | Server software name/version |

---

## POP3S — Implicit TLS (`/api/pop3s/`)

Same 7 endpoints, same semantics, wrapped in TLS using `secureTransport: 'on'` (Cloudflare Workers socket option). Default port 995.

**Key differences from `/api/pop3/`:**
- `/connect` returns `rtt`, `messageCount`, `mailboxSize`, `protocol: 'POP3S'`, `tls: true`
- All responses include `tls: true`
- `/retrieve` uses `messageId` field (consistent with `/api/pop3/retrieve`)
- `/dele` and `/top` use `msgnum` field

### `GET|POST /api/pop3s/connect`

**Fields:** same as `/api/pop3/connect` except `port` defaults to `995`

**Success (with auth):**
```json
{
  "success": true,
  "host": "pop.example.com",
  "port": 995,
  "protocol": "POP3S",
  "tls": true,
  "rtt": 42,
  "greeting": "+OK Dovecot ready.",
  "authenticated": true,
  "messageCount": 5,
  "mailboxSize": 81920,
  "note": "Authenticated over TLS. 5 message(s), 81920 bytes"
}
```

**Success (no auth):**
```json
{
  "success": true,
  "protocol": "POP3S",
  "tls": true,
  "rtt": 38,
  "greeting": "+OK Dovecot ready.",
  "authenticated": false,
  "messageCount": null,
  "mailboxSize": null,
  "note": "POP3S connection test only. Provide credentials to test login."
}
```

`rtt` is wall-clock ms from `connect()` call to `socket.opened` resolution.

### `POST /api/pop3s/list`

Same as `/api/pop3/list` plus `tls: true` in the response.

### `POST /api/pop3s/retrieve`

**Required:** `host`, `username`, `password`, `messageId` (integer)

Note: uses `messageId` (unlike `/api/pop3s/dele` and `/api/pop3s/top` which use `msgnum`).

### `POST /api/pop3s/dele`

**Required:** `host`, `username`, `password`, `msgnum` (integer)

### `POST /api/pop3s/uidl`

**Required:** `host`, `username`, `password`

### `POST /api/pop3s/top`

**Required:** `host`, `username`, `password`, `msgnum`
**Optional:** `lines` (default `0`)

### `GET|POST /api/pop3s/capa`

**Required:** `host` only. Returns `{ success, host, port, capabilities, tls: true }`.

---

## Wire Exchange

### POP3 connect probe (no auth)

```
→ (TCP connect to :110)
← +OK POP3 server ready <1896.697170952@dbc.mtview.ca.us>\r\n
→ QUIT\r\n
← +OK\r\n
```

### POP3 session with auth + list

```
→ (TCP connect)
← +OK Dovecot ready.\r\n
→ USER alice\r\n
← +OK\r\n
→ PASS s3cr3t\r\n
← +OK Logged in.\r\n
→ STAT\r\n
← +OK 2 4210\r\n
→ LIST\r\n
← +OK 2 messages:\r\n
   1 2210\r\n
   2 2000\r\n
   .\r\n
→ QUIT\r\n
← +OK Logging out.\r\n
```

### RETR message

```
→ RETR 1\r\n
← +OK 2210 octets\r\n
   From: sender@example.com\r\n
   To: alice@example.com\r\n
   Subject: Hello\r\n
   \r\n
   Body here.\r\n
   .\r\n          ← terminator (stripped from `message` field)
→ QUIT\r\n
```

### DELE + QUIT

```
→ DELE 1\r\n
← +OK Marked to be deleted.\r\n
→ QUIT\r\n
← +OK Logging out, 1 messages deleted.\r\n
  (UPDATE state: deletion committed here)
```

---

## Known Limitations

### Parameter name inconsistency

| Endpoint | Message number field |
|---|---|
| `/retrieve` (both pop3 and pop3s) | `messageId` |
| `/dele` (both) | `msgnum` |
| `/top` (both) | `msgnum` |
| `/uidl` response `messages[]` | `msgnum` |
| `/list` response `messages[]` | `id` |

All refer to the session-local ordinal — the number assigned by the server for this login session.

### Dot-unstuffing not implemented

RFC 1939 §3 requires clients to un-stuff leading dots from multi-line responses: `..` at the start of a line means a literal `.`. This implementation does not perform dot-unstuffing. Messages with body lines starting with `.` (PEM certificates, unified diffs, some markdown) will arrive doubled in the `message` field from `/retrieve`.

### No APOP, SASL, or STLS (plain POP3 only)

Only USER/PASS is implemented for `/api/pop3/`. APOP (challenge-response MD5), SASL (via AUTH command), and STARTTLS (via STLS) are not supported. Most modern servers require SASL PLAIN or OAUTHBEARER over TLS — those servers will succeed at `/capa` but fail at all auth endpoints.

For TLS-secured connections, use `/api/pop3s/` which wraps the full session in implicit TLS.

### readPOP3Response stops at first `\r\n`

`readPOP3Response` terminates as soon as `\r\n` appears in the buffer. If a server delivers the greeting and a subsequent prompt in one TCP segment, only the greeting line is captured. In practice POP3 servers are strictly sequential so this doesn't occur, but it is a structural limitation.

### Single-command UIDL and LIST not supported

Only the bulk forms (UIDL without argument, LIST without argument) are implemented. `UIDL n` and `LIST n` (single-message variants) are not available via the API.

### RSET not available

No endpoint exposes RSET. Once `/dele` is called and returns success, the deletion cannot be rolled back through this API.

### Large messages buffered in Worker memory

`readPOP3MultiLine` accumulates the entire RETR response in a string before returning it. A 50 MB mailbox message will be fully buffered in the Cloudflare Worker before the JSON response is sent.

---

## curl Examples

```bash
# Probe server (greeting only, no auth)
curl -s -X POST https://portofcall.ross.gg/api/pop3/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"pop.gmail.com","port":110}' | jq .

# Test auth
curl -s -X POST https://portofcall.ross.gg/api/pop3/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"pop.example.com","username":"alice","password":"s3cr3t"}' | jq '.authenticated,.greeting'

# Check server capabilities (no auth)
curl -s -X POST https://portofcall.ross.gg/api/pop3/capa \
  -H 'Content-Type: application/json' \
  -d '{"host":"pop.example.com"}' | jq '.capabilities'

# GET form for quick probing
curl -s 'https://portofcall.ross.gg/api/pop3/connect?host=pop.example.com&port=110' | jq .

# List all messages (returns id + size for each)
curl -s -X POST https://portofcall.ross.gg/api/pop3/list \
  -H 'Content-Type: application/json' \
  -d '{"host":"pop.example.com","username":"alice","password":"s3cr3t"}' \
  | jq '.totalMessages,.messages[0]'

# Get stable UIDs (for client-side deduplication)
curl -s -X POST https://portofcall.ross.gg/api/pop3/uidl \
  -H 'Content-Type: application/json' \
  -d '{"host":"pop.example.com","username":"alice","password":"s3cr3t"}' | jq '.messages'

# Retrieve message 1 (full RFC 5322) — note: field is messageId
curl -s -X POST https://portofcall.ross.gg/api/pop3/retrieve \
  -H 'Content-Type: application/json' \
  -d '{"host":"pop.example.com","username":"alice","password":"s3cr3t","messageId":1}' \
  | jq -r '.message' | head -20

# Preview headers + 5 body lines without full download
curl -s -X POST https://portofcall.ross.gg/api/pop3/top \
  -H 'Content-Type: application/json' \
  -d '{"host":"pop.example.com","username":"alice","password":"s3cr3t","msgnum":1,"lines":5}' \
  | jq -r '.content'

# Mark message 3 for deletion (commits on QUIT)
curl -s -X POST https://portofcall.ross.gg/api/pop3/dele \
  -H 'Content-Type: application/json' \
  -d '{"host":"pop.example.com","username":"alice","password":"s3cr3t","msgnum":3}' | jq .

# POP3S — probe with TLS (port 995, returns rtt + messageCount)
curl -s -X POST https://portofcall.ross.gg/api/pop3s/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"pop.example.com","username":"alice","password":"s3cr3t"}' \
  | jq '{authenticated,rtt,messageCount,mailboxSize}'

# POP3S — list messages over TLS
curl -s -X POST https://portofcall.ross.gg/api/pop3s/list \
  -H 'Content-Type: application/json' \
  -d '{"host":"pop.example.com","username":"alice","password":"s3cr3t"}' | jq .

# POP3S capa (no auth, just host)
curl -s 'https://portofcall.ross.gg/api/pop3s/capa?host=pop.example.com' | jq '.capabilities'
```

---

## Local Test Server

**Dovecot (Docker):**

```bash
docker run -d -p 110:110 -p 995:995 --name dovecot dovecot/dovecot
# Default config serves plaintext POP3 on 110 + POP3S on 995
docker exec dovecot doveadm user alice
```

**GreenMail** (Java in-memory, supports POP3 + POP3S, good for integration tests):

```bash
docker run -d -p 3110:3110 -p 3995:3995 greenmail/standalone
# POP3 on 3110, POP3S on 3995
```
