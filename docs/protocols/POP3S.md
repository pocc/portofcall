# POP3S — Power User Reference

**Port:** 995 (implicit TLS)
**RFC:** 1939 (core POP3), 2449 (CAPA/extensions), 8314 (implicit TLS)
**Source:** `src/worker/pop3s.ts`
**Related:** `src/worker/pop3.ts` (plaintext POP3 on port 110, documented in `docs/protocols/POP3.md`)

POP3S is POP3 with the entire TCP stream wrapped in TLS from the first byte — implicit TLS, also called POP3 over TLS or POPS. This is distinct from STARTTLS/STLS (RFC 2595), which upgrades a plaintext connection after a negotiation step. On POP3S, the TLS handshake completes before the server sends its greeting.

Seven endpoints mirroring the plaintext `/api/pop3/` family. All responses include `"tls": true`. Each call opens a fresh TCP+TLS connection.

---

## Endpoints

### `GET|POST /api/pop3s/connect` — Greeting probe + optional auth

Tests reachability, reads the server greeting, optionally authenticates, and if authenticated, fetches mailbox stats via STAT.

**Request fields:**

| Field | Type | Default | Required | Notes |
|---|---|---|---|---|
| `host` | string | — | Yes | Hostname or IP |
| `port` | integer | `995` | No | |
| `username` | string | — | No | Omit to test greeting only |
| `password` | string | — | No | Required if `username` set |
| `timeout` | integer | `30000` | No | Wall-clock timeout in ms |

GET form: all fields as query params.

**Success (no auth):**
```json
{
  "success": true,
  "host": "pop.example.com",
  "port": 995,
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

`rtt` is wall-clock milliseconds from the `connect()` call to `socket.opened` resolution — TLS handshake included.

`messageCount` and `mailboxSize` come from STAT (`+OK count octets`) and are `null` when not authenticated.

Wire exchange (with auth):
```
→ (TLS connect to :995)
← +OK Dovecot ready.\r\n
→ USER alice\r\n
← +OK\r\n
→ PASS s3cr3t\r\n
← +OK Logged in.\r\n
→ STAT\r\n
← +OK 5 81920\r\n
→ QUIT\r\n
← +OK Logging out.\r\n
```

---

### `POST /api/pop3s/list` — Authenticate + STAT + LIST

Authenticates and retrieves the full message list with per-message sizes.

**Required:** `host`, `username`, `password`
**Optional:** `port` (default `995`), `timeout`

**Success:**
```json
{
  "success": true,
  "host": "pop.example.com",
  "port": 995,
  "tls": true,
  "messages": [
    { "id": 1, "size": 4210 },
    { "id": 2, "size": 12048 }
  ],
  "totalMessages": 2,
  "totalSize": 16258,
  "message": "2 message(s), 16258 bytes total"
}
```

- `totalMessages` and `totalSize` come from STAT
- `messages` is the per-message breakdown from LIST (multi-line response)
- `id` in each message is the session-local ordinal (can change between sessions)
- For stable cross-session identifiers, use `/uidl`

Wire exchange:
```
← +OK Dovecot ready.\r\n
→ USER alice\r\n  → PASS s3cr3t\r\n
→ STAT\r\n
← +OK 2 16258\r\n
→ LIST\r\n
← +OK 2 messages:\r\n
   1 4210\r\n
   2 12048\r\n
   .\r\n
→ QUIT\r\n
```

---

### `POST /api/pop3s/retrieve` — Authenticate + RETR

Retrieves a full RFC 5322 message by ordinal number.

**Required:** `host`, `username`, `password`, `messageId` (integer)

> Note: this endpoint uses `messageId`; `/dele` and `/top` use `msgnum`. Both refer to the session-local ordinal. See [Parameter name inconsistency](#parameter-name-inconsistency).

**Success:**
```json
{
  "success": true,
  "messageId": 1,
  "message": "From: sender@example.com\r\nTo: alice@example.com\r\nSubject: Hello\r\n\r\nBody text.",
  "tls": true
}
```

- `message` is the full RFC 5322 payload — headers + body — with the `+OK` first line and the terminating `.` stripped
- Inner read timeout is 30 seconds (separate from the outer wall-clock `timeout`)
- Dot-unstuffing IS applied: `..` at the start of a line (server byte-stuffing) is decoded to `.`

Wire exchange:
```
→ RETR 1\r\n
← +OK 4210 octets\r\n
   From: sender@example.com\r\n
   ...
   .\r\n          ← terminator (stripped from `message`)
→ QUIT\r\n
```

---

### `POST /api/pop3s/dele` — Authenticate + DELE + QUIT

Marks a message for deletion and commits the deletion by sending QUIT.

**Required:** `host`, `username`, `password`, `msgnum` (integer)

**Success:**
```json
{
  "success": true,
  "msgnum": 3,
  "message": "+OK Message 3 deleted.",
  "tls": true
}
```

Per RFC 1939 §8: deletion is committed when the server enters UPDATE state via a successful QUIT. This endpoint sends QUIT immediately after DELE, so a `success: true` response means both DELE and QUIT succeeded — the deletion is committed. If the connection drops before QUIT (e.g., timeout), the server will NOT delete the message.

RSET is not exposed; once DELE returns `success: true`, the deletion cannot be rolled back.

---

### `POST /api/pop3s/uidl` — Authenticate + UIDL

Retrieves unique IDs for all messages. UIDs are stable across sessions.

**Required:** `host`, `username`, `password`

**Success:**
```json
{
  "success": true,
  "messages": [
    { "msgnum": 1, "uid": "whqtswO00WBw418f9t5JxYwZ" },
    { "msgnum": 2, "uid": "oaFTRwFoJyA4gl3tptycPAtT" }
  ],
  "count": 2,
  "tls": true
}
```

- `uid` is an opaque server-assigned string, guaranteed unique per mailbox (RFC 1939 §7)
- `msgnum` is the session-local ordinal for this login session
- Match `msgnum` values from `/uidl` and `/list` to get both stable IDs and sizes

---

### `POST /api/pop3s/top` — Authenticate + TOP

Retrieves headers plus the first N lines of the message body. Use `lines: 0` for headers only.

**Required:** `host`, `username`, `password`, `msgnum`
**Optional:** `lines` (default `0`)

```json
{ "host": "pop.example.com", "username": "alice", "password": "s3cr3t", "msgnum": 1, "lines": 5 }
```

**Success:**
```json
{
  "success": true,
  "msgnum": 1,
  "lines": 5,
  "content": "From: sender@example.com\r\nSubject: Hello\r\n\r\nFirst line of body",
  "tls": true
}
```

Per RFC 1939 §11: the server MUST return all headers regardless of `lines`. `lines: 0` returns the full header block with an empty body section (the blank separator line between headers and body is included).

---

### `GET|POST /api/pop3s/capa` — Server capabilities (no auth)

Sends CAPA immediately after the greeting, before USER/PASS. No credentials needed.

**Required:** `host` only
**Optional:** `port` (default `995`)

GET form: `host` and `port` as query params.

**Success (CAPA supported):**
```json
{
  "success": true,
  "host": "pop.example.com",
  "port": 995,
  "capabilities": ["TOP", "USER", "SASL PLAIN", "UIDL", "STLS", "PIPELINING"],
  "tls": true
}
```

**Success (CAPA not supported):**
```json
{
  "success": true,
  "host": "pop.example.com",
  "port": 995,
  "capabilities": [],
  "tls": true,
  "note": "Server returned -ERR to CAPA — CAPA not supported"
}
```

CAPA is defined in RFC 2449 and is optional. Older servers return `-ERR` and the endpoint returns an empty `capabilities` array with a `note` rather than failing. The `success: false` / HTTP 500 path is reserved for connection failures.

Common capabilities:

| Capability | RFC | Meaning |
|---|---|---|
| `TOP` | 1939 | TOP command available |
| `UIDL` | 1939 | UIDL command available |
| `USER` | 1939 | USER/PASS authentication |
| `SASL` | 5034 | SASL mechanisms (e.g., `SASL PLAIN GSSAPI`) |
| `STLS` | 2595 | STARTTLS available (not relevant on POP3S — already TLS) |
| `PIPELINING` | 2449 | Multiple commands may be batched without waiting for responses |
| `RESP-CODES` | 2449 | Extended response codes in -ERR lines |
| `AUTH-RESP-CODE` | 3206 | [AUTH] and [SYS] codes in auth failures |
| `EXPIRE` | 2449 | Message expiry policy |
| `LOGIN-DELAY` | 2449 | Minimum seconds between logins |
| `IMPLEMENTATION` | 2449 | Server software name/version |

Note: `STLS` in the CAPA response of a POP3S server means the server is also advertising STLS for its plaintext port — it is not meaningful in an already-TLS session.

---

## TLS Details

TLS is established using Cloudflare Workers' `connect()` socket API with `secureTransport: 'on'`. This is implicit TLS — the TLS handshake occurs before any application-layer data is exchanged. The server sends its greeting only after the TLS handshake completes.

```typescript
const socket = connect(`${host}:${port}`, {
  secureTransport: 'on',
  allowHalfOpen: false,
});
await socket.opened;
```

`socket.opened` resolves after the TLS handshake. The `rtt` field in `/connect` measures wall-clock time from `connect()` to `socket.opened`, which includes DNS resolution, TCP three-way handshake, and TLS handshake.

Certificate validation is performed by Cloudflare Workers' TLS stack. Self-signed certificates will cause `socket.opened` to reject. There is no option to skip certificate validation in the current API.

---

## Differences from `/api/pop3/`

| Aspect | `/api/pop3/` | `/api/pop3s/` |
|---|---|---|
| Default port | `110` | `995` |
| Transport | Plaintext TCP | Implicit TLS |
| `connect` response | No `rtt`, no `messageCount`/`mailboxSize` | Has `rtt`, `messageCount`, `mailboxSize`, `protocol` |
| All responses | No `tls` field | `"tls": true` |
| `connect` no-auth | `messageCount`/`mailboxSize` absent | `messageCount: null`, `mailboxSize: null` |

Field names, semantics, and error behavior are otherwise identical between the two families.

---

## Known Limitations

### Parameter name inconsistency

The message number field is named inconsistently across endpoints:

| Endpoint | Field name |
|---|---|
| `/retrieve` | `messageId` |
| `/dele` | `msgnum` |
| `/top` | `msgnum` |
| `/uidl` response `messages[]` | `msgnum` |
| `/list` response `messages[]` | `id` |

All refer to the same session-local ordinal number. This inconsistency is shared with the `/api/pop3/` family.

### Only USER/PASS authentication

Only USER/PASS is implemented. APOP (challenge-response MD5 using the greeting timestamp), SASL (via AUTH command — including PLAIN, LOGIN, GSSAPI, OAUTHBEARER), and any server-side EXTERNAL mechanism are not supported.

Many modern servers that advertise SASL OAUTHBEARER will reject USER/PASS credentials at `/pop3s/retrieve` and friends. These servers will succeed at `/pop3s/capa` but fail at all auth endpoints.

### Single-message UIDL and LIST not supported

Only the bulk forms (`UIDL` with no argument, `LIST` with no argument) are implemented. `UIDL n` and `LIST n` (returning a single-message entry) are not exposed.

### RSET not available

There is no endpoint for RSET. Once `/dele` returns `success: true`, the deletion is committed and cannot be undone through this API.

### Large messages buffered in Worker memory

`readPOP3MultiLine` accumulates the entire RETR response in a JavaScript string before returning. For large messages (multi-megabyte attachments), the entire message is held in Worker memory before the JSON response is sent. Cloudflare Workers have a 128 MB memory limit per request.

### Single-line reader stops at first `\r\n`

`readPOP3Response` terminates as soon as `\r\n` appears anywhere in the accumulated buffer. If a server sends multiple lines in a single TCP segment (e.g., greeting + banner), only up to the first CRLF is captured. In practice POP3 servers are strictly sequential, but this is a structural constraint.

### No NOOP or RSET endpoints

NOOP (keep-alive / no-op, RFC 1939 §9) and RSET (undelete all marked messages, RFC 1939 §9) are not exposed. Each endpoint opens a fresh connection, so NOOP is meaningless. RSET would require a connection to remain open across requests, which is not the model here.

### Self-signed certificates rejected

Cloudflare Workers' TLS stack performs full certificate validation. POP3S servers using self-signed certificates (common in local/dev setups like GreenMail) will cause `socket.opened` to reject with a TLS error. There is no `insecure` or `skipVerify` option. Use the plaintext `/api/pop3/` endpoints for local testing against self-signed-cert servers.

---

## Error Responses

All endpoints return HTTP 400 for missing required parameters, 403 if the target host is detected as a Cloudflare-protected host, and 500 for connection or protocol errors. The body is always JSON.

```json
{ "success": false, "error": "Authentication failed: -ERR [AUTH] Invalid credentials." }
```

Timeout errors return HTTP 500:
```json
{ "success": false, "error": "Connection timeout" }
```

---

## curl Examples

```bash
# Greeting probe, no auth (returns rtt + greeting)
curl -s -X POST https://portofcall.ross.gg/api/pop3s/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"pop.gmail.com"}' | jq '{authenticated,rtt,greeting}'

# Auth test (returns messageCount, mailboxSize)
curl -s -X POST https://portofcall.ross.gg/api/pop3s/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"pop.example.com","username":"alice","password":"s3cr3t"}' \
  | jq '{authenticated,rtt,messageCount,mailboxSize}'

# GET form — quick probe
curl -s 'https://portofcall.ross.gg/api/pop3s/connect?host=pop.example.com' | jq .

# Server capabilities (no auth needed)
curl -s -X POST https://portofcall.ross.gg/api/pop3s/capa \
  -H 'Content-Type: application/json' \
  -d '{"host":"pop.example.com"}' | jq '.capabilities'

# GET form for capa
curl -s 'https://portofcall.ross.gg/api/pop3s/capa?host=pop.example.com' | jq .

# List all messages
curl -s -X POST https://portofcall.ross.gg/api/pop3s/list \
  -H 'Content-Type: application/json' \
  -d '{"host":"pop.example.com","username":"alice","password":"s3cr3t"}' \
  | jq '{totalMessages,totalSize,messages}'

# Get stable UIDs
curl -s -X POST https://portofcall.ross.gg/api/pop3s/uidl \
  -H 'Content-Type: application/json' \
  -d '{"host":"pop.example.com","username":"alice","password":"s3cr3t"}' \
  | jq '.messages'

# Retrieve full message 1 — note field is messageId (not msgnum)
curl -s -X POST https://portofcall.ross.gg/api/pop3s/retrieve \
  -H 'Content-Type: application/json' \
  -d '{"host":"pop.example.com","username":"alice","password":"s3cr3t","messageId":1}' \
  | jq -r '.message' | head -20

# Preview headers + 5 body lines — field is msgnum
curl -s -X POST https://portofcall.ross.gg/api/pop3s/top \
  -H 'Content-Type: application/json' \
  -d '{"host":"pop.example.com","username":"alice","password":"s3cr3t","msgnum":1,"lines":5}' \
  | jq -r '.content'

# Delete message 3 (commits on QUIT)
curl -s -X POST https://portofcall.ross.gg/api/pop3s/dele \
  -H 'Content-Type: application/json' \
  -d '{"host":"pop.example.com","username":"alice","password":"s3cr3t","msgnum":3}' | jq .
```

---

## Local Test Servers

**Dovecot (Docker):**

```bash
docker run -d -p 110:110 -p 995:995 --name dovecot dovecot/dovecot
# POP3 on 110, POP3S on 995
```

**GreenMail** (Java in-memory, good for integration tests):

```bash
docker run -d -p 3110:3110 -p 3995:3995 greenmail/standalone
# POP3 on 3110, POP3S on 3995
```

Note: GreenMail uses a self-signed certificate. Cloudflare Workers' TLS stack rejects self-signed certs, so POP3S endpoints will fail against a local GreenMail instance. Use the plaintext `/api/pop3/` endpoints with GreenMail for local development.
