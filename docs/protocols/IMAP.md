# IMAP — Power User Reference

**Ports:** 143 (plain TCP) · 993 (IMAPS — implicit TLS)
**RFC:** 3501 (IMAP4rev1), 8314 (IMAPS)
**Tests:** 17/17 ✅ Deployed
**Source:** `src/worker/imap.ts` (plain), `src/worker/imaps.ts` (TLS)

Eight endpoints across two parallel families. All open a fresh TCP connection per call — no persistent sessions in HTTP mode. The WebSocket session endpoint (`/session`) is the exception: it stays connected until the browser closes it.

---

## Transport

**`/api/imap/*`** — Plain TCP, port 143 default. `connect()` from `cloudflare:sockets`.

**`/api/imaps/*`** — Implicit TLS from byte 0. `connect(..., { secureTransport: 'on' })`, port 993 default. The server sends the `* OK` greeting over TLS immediately — no STARTTLS negotiation needed or supported.

**No STARTTLS.** Neither family supports upgrading a plain connection to TLS mid-session. If a server requires STARTTLS on port 143, the plain IMAP endpoints will succeed at greeting but will fail when the server rejects commands (typically returning `[ALERT] TLS required`).

---

## Authentication

**LOGIN command only.** Both families use `A001 LOGIN {username} {password}\r\n`.

Username and password are sent **in plain text** on the wire for plain IMAP. Use IMAPS endpoints for any production use.

Not supported:
- `AUTHENTICATE PLAIN` (SASL)
- `AUTHENTICATE LOGIN` (SASL)
- `AUTHENTICATE XOAUTH2` (Gmail/Google Workspace requires this)
- `AUTHENTICATE GSSAPI`, `NTLM`, `DIGEST-MD5`
- `AUTHENTICATE SCRAM-SHA-*` (RFC 7677)

Gmail, Outlook.com, Yahoo, and most modern providers have disabled plain-password LOGIN. They require OAuth 2.0 (`AUTHENTICATE XOAUTH2`) or app-specific passwords in combination with SSL/TLS. These endpoints work with Dovecot, Courier, and other self-hosted servers configured for LOGIN authentication.

---

## Tag Format

Tags are hardcoded as `A` + zero-padded 3-digit counter: `A001`, `A002`, `A003`, ... `A999`, `A1000` (no limit).

Every HTTP endpoint uses the same tag sequence:
- `A001` — LOGIN
- `A002` — the protocol command (CAPABILITY, LIST, SELECT)
- `A003` — LOGOUT

The WebSocket session starts at `A003` (A001=LOGIN, A002=CAPABILITY during setup), then `A003`, `A004`, ... for browser-issued commands.

---

## Endpoints

### `GET|POST /api/imap/connect` · `GET|POST /api/imaps/connect`

Reads the `* OK` greeting, optionally authenticates, retrieves CAPABILITY, then sends LOGOUT.

**Fields:**

| Field | Default | Required | Notes |
|---|---|---|---|
| `host` | — | ✅ | |
| `port` | `143` (IMAP) / `993` (IMAPS) | | |
| `username` | — | | If omitted, only the greeting is read; no LOGIN is sent |
| `password` | — | | Required if `username` is set |
| `timeout` | `30000` | | Wall-clock timeout in ms |

**Success (no auth):**
```json
{
  "success": true,
  "message": "IMAP server reachable",
  "host": "imap.example.com",
  "port": 143,
  "greeting": "* OK Dovecot ready.",
  "authenticated": false,
  "note": "Connection test only (no authentication)"
}
```

**Success (with auth):**
```json
{
  "success": true,
  "message": "IMAP server reachable",
  "host": "imap.example.com",
  "port": 143,
  "greeting": "* OK Dovecot ready.",
  "authenticated": true,
  "capabilities": "* CAPABILITY IMAP4rev1 SASL-IR LOGIN-REFERRALS ID ENABLE IDLE SORT UIDPLUS MOVE\r\nA002 OK Capability completed.",
  "note": "Successfully authenticated"
}
```

> **`capabilities` is the raw CAPABILITY response** — everything from `* CAPABILITY ...` through the `A002 OK` completion line, as a raw string. It is not parsed into an array. Use the session endpoint to run `CAPABILITY` and parse the result yourself.

**Greeting timeout:** The greeting read has a hardcoded 5 s inner timeout (`Greeting timeout` error message). The outer `timeout` field governs the full connection cycle.

**GET form:** all fields accepted as query params, identical behavior.

---

### `POST /api/imap/list` · `POST /api/imaps/list`

Authenticates and runs `LIST "" "*"` to enumerate all mailboxes visible from the root.

**Required:** `host`, `username`, `password`
**Optional:** `port`, `timeout`

**Success:**
```json
{
  "success": true,
  "mailboxes": ["INBOX", "Drafts", "Sent", "Spam", "Trash"],
  "count": 5
}
```

**Mailbox name parsing — important limitation.** The response is parsed with this regex:

```
/\* LIST \([^)]*\) "([^"]*)" "([^"]*)"/
```

This only matches when:
1. The hierarchy delimiter is **double-quoted** (fails for `NIL`, which is valid per RFC 3501 when there's no hierarchy)
2. The mailbox name is **double-quoted** — RFC 3501 allows servers to send unquoted atoms for safe names; some servers omit quotes for `INBOX`

Mailboxes with spaces, international characters, or special characters that force the server to use literal strings (`{N}\r\nname`) are silently dropped from the result. A mailbox named `Sent Items` (common on Exchange/Outlook) must be double-quoted by the server to appear.

`match[1]` = hierarchy delimiter (discarded), `match[2]` = mailbox name (returned).

**Greeting timeout:** Unlike `/connect`, the greeting read in `/list` and `/select` has **no inner timeout** — it runs until the outer `timeout` fires. If the server accepts the TCP connection but doesn't send a greeting, the request hangs for the full `timeout` duration.

---

### `POST /api/imap/select` · `POST /api/imaps/select`

Authenticates and runs `SELECT {mailbox}`, parsing only EXISTS and RECENT counts.

**Required:** `host`, `username`, `password`, `mailbox`
**Optional:** `port`, `timeout`

```json
{ "host": "imap.example.com", "username": "alice", "password": "s3cr3t", "mailbox": "INBOX" }
```

**Success:**
```json
{
  "success": true,
  "mailbox": "INBOX",
  "exists": 42,
  "recent": 3,
  "message": "Selected mailbox \"INBOX\" with 42 message(s)"
}
```

**What is parsed from SELECT:**
- `* N EXISTS` → `exists`
- `* N RECENT` → `recent`

**What is NOT parsed** (silently dropped):
- `* [UIDVALIDITY N]` — required for UID-based client synchronization
- `* [UIDNEXT N]` — next expected UID
- `* [UNSEEN N]` — sequence number of first unseen message
- `* FLAGS (...)` — flags defined in this mailbox
- `* [PERMANENTFLAGS (...)]` — flags that can be permanently set
- `* [READ-WRITE]` or `[READ-ONLY]` — mailbox access mode

**SELECT vs EXAMINE.** This endpoint always uses `SELECT`, which opens the mailbox read-write. `SELECT` resets the `\Recent` flag (marks messages as "seen this session") on servers that track per-session `\Recent`. To open read-only without resetting `\Recent`, use `EXAMINE` via the session WebSocket.

**Mailbox name quoting.** The `mailbox` value is sent verbatim in the IMAP command. Names with spaces must be pre-quoted in the JSON string:
```json
{ "mailbox": "\"Sent Items\"" }
```

---

### `GET /api/imap/session` · `GET /api/imaps/session`

WebSocket endpoint. Connects, authenticates via LOGIN, retrieves CAPABILITY, then relays arbitrary IMAP commands from the browser until the WebSocket closes.

**Query params (required):** `host`, `username`, `password`
**Query params (optional):** `port` (default 143/993)

**Upgrade:** Must send `Connection: Upgrade` and `Upgrade: websocket`. Returns HTTP 426 otherwise.

> **Credentials in URL:** `username` and `password` appear as query parameters, visible in access logs and browser DevTools network tab. Use app-specific or scoped credentials.

---

#### WebSocket Message Protocol

**Worker → browser:**

| `type` | Fields | When sent |
|---|---|---|
| `connected` | `greeting`, `capabilities`, `host`, `port`, `username` | After LOGIN + CAPABILITY succeed |
| `response` | `tag`, `response`, `command` | After each browser command completes |
| `error` | `message` | Login failure, TCP error, or command timeout |

**Browser → worker:**

| `type` | Required fields | Notes |
|---|---|---|
| `command` | `command: string` | Raw IMAP command without tag (worker adds tag) |

**`connected` event:**
```json
{
  "type": "connected",
  "greeting": "* OK Dovecot ready.",
  "capabilities": "IMAP4rev1 SASL-IR LOGIN-REFERRALS ID ENABLE IDLE SORT UIDPLUS MOVE",
  "host": "imap.example.com",
  "port": 143,
  "username": "alice"
}
```

`capabilities` is the `* CAPABILITY` line content with the `* CAPABILITY ` prefix stripped — a space-separated string, not an array.

**`response` event:**
```json
{
  "type": "response",
  "tag": "A004",
  "response": "* 42 EXISTS\r\n* 3 RECENT\r\n* OK [UNSEEN 15] Message 15 is first unseen\r\n* OK [UIDVALIDITY 1234567890] UIDs valid\r\n* OK [UIDNEXT 500] Predicted next UID\r\nA004 OK [READ-WRITE] Select completed",
  "command": "SELECT INBOX"
}
```

The full accumulated response including all untagged lines is in `response`.

**JavaScript session example:**
```js
const ws = new WebSocket(
  'wss://portofcall.ross.gg/api/imaps/session?host=imap.example.com&username=alice&password=secret'
);

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === 'connected') {
    console.log('Capabilities:', msg.capabilities.split(' '));
    ws.send(JSON.stringify({ type: 'command', command: 'SELECT INBOX' }));

  } else if (msg.type === 'response') {
    const response = msg.response;
    // Parse EXISTS
    const exists = response.match(/\* (\d+) EXISTS/)?.[1];
    console.log(`[${msg.tag}] ${msg.command}: ${exists} messages`);

    // Fetch first 10 envelopes
    if (msg.command.startsWith('SELECT')) {
      ws.send(JSON.stringify({ type: 'command', command: 'FETCH 1:10 (FLAGS ENVELOPE)' }));
    }

  } else if (msg.type === 'error') {
    console.error('Error:', msg.message);
  }
};
```

**Common commands via session:**
```json
{ "type": "command", "command": "LIST \"\" \"*\"" }
{ "type": "command", "command": "SELECT INBOX" }
{ "type": "command", "command": "EXAMINE INBOX" }
{ "type": "command", "command": "FETCH 1:10 (FLAGS ENVELOPE)" }
{ "type": "command", "command": "FETCH 5 BODY[]" }
{ "type": "command", "command": "UID FETCH 100:200 (FLAGS RFC822.SIZE)" }
{ "type": "command", "command": "SEARCH UNSEEN" }
{ "type": "command", "command": "SEARCH FROM \"boss@example.com\"" }
{ "type": "command", "command": "STORE 5 +FLAGS (\\Seen \\Flagged)" }
{ "type": "command", "command": "MOVE 5 Trash" }
{ "type": "command", "command": "CREATE \"Archive/2024\"" }
{ "type": "command", "command": "NAMESPACE" }
```

---

## Implementation Notes

### readIMAPResponse — Termination Logic

```typescript
if (response.includes(`${tag} OK`) || response.includes(`${tag} NO`) || response.includes(`${tag} BAD`)) {
  break;
}
```

- **Accumulates all untagged responses.** All `* EXISTS`, `* FETCH`, `* FLAGS`, continuation lines are accumulated before breaking.
- **No size limit.** A `FETCH 1:1000 BODY[]` on a mailbox with large messages will buffer the entire response in Worker memory. Workers have a ~128 MB memory limit.
- **Tag substring safety.** The `A001`/`A002`/`A003` format avoids false matches. In the session, `A004` through `A999` are safe too. Above `A999`, tags become `A1000`, `A1001`, etc. (no zero-padding at 4+ digits). `A1000` appearing in `A10000 OK` would match `A1000 ` check if the server ever reaches that range.
- **NO and BAD responses** are returned as successful function calls (no exception thrown). Callers check for `OK` in the string and throw if absent.

### LIST Mailbox Parsing

Regex: `\* LIST \([^)]*\) "([^"]*)" "([^"]*)"`

**What breaks it:**
- `NIL` hierarchy delimiter: `* LIST (\Noselect) NIL ""` — not matched
- Literal mailbox names: `* LIST (\HasChildren) "/" {12}\r\nSent Messages` — not matched
- Unquoted atoms: `* LIST () "/" INBOX` — not matched (some servers omit quotes)
- Nested quotes in names — not matched

**What `match[1]` and `match[2]` contain:** group 1 = hierarchy delimiter (e.g., `/`), group 2 = mailbox name. Only `match[2]` is pushed to the result array.

**Modified UTF-7:** International names from RFC 3501 §5.1.3 (e.g., `&BB4EQgQ,BBoEMA-`) are returned as-is. Use a modified UTF-7 decoder library client-side to get display names.

### SELECT Returns Only EXISTS and RECENT

The full SELECT response (UIDVALIDITY, UIDNEXT, FLAGS, PERMANENTFLAGS, UNSEEN, READ-WRITE/READ-ONLY) is available in the raw `response` field from the session endpoint. The `/select` HTTP endpoint only extracts two numeric fields.

### No Greeting Timeout in /list and /select

The greeting reader in `handleIMAPList` and `handleIMAPSelect` has no inner timeout — only the outer `timeout` wraps it. If a server accepts the TCP connection but delays the greeting (e.g., throttling), the request hangs until `timeout` fires (default 30 s).

### Session LOGOUT on WebSocket Close

The `close` event handler sends LOGOUT with a 3 s timeout; errors are ignored. This cleanly terminates the IMAP session server-side when the browser disconnects, which matters for servers with per-user connection limits.

### IDLE Not Fully Functional

IDLE requires sending `IDLE\r\n` (tagged) to start, then `DONE\r\n` **without a tag** to stop. The session endpoint prefixes all commands with a tag: `A004 DONE\r\n`. Servers will reject or misinterpret this. IDLE can be started via the session but cannot be correctly terminated through it.

---

## curl Examples

```bash
BASE=https://portofcall.ross.gg/api

# Probe (no auth)
curl -s $BASE/imap/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"imap.example.com"}' | jq '{greeting,authenticated}'

# Test credentials (plain)
curl -s $BASE/imap/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"imap.example.com","username":"alice","password":"s3cr3t"}' | jq '.authenticated'

# Test credentials (TLS)
curl -s $BASE/imaps/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"imap.example.com","username":"alice","password":"s3cr3t"}' | jq '.authenticated'

# GET form probe
curl -s "$BASE/imap/connect?host=imap.example.com" | jq .

# List mailboxes
curl -s $BASE/imap/list \
  -H 'Content-Type: application/json' \
  -d '{"host":"imap.example.com","username":"alice","password":"s3cr3t"}' | jq '.mailboxes'

# Select INBOX
curl -s $BASE/imap/select \
  -H 'Content-Type: application/json' \
  -d '{"host":"imap.example.com","username":"alice","password":"s3cr3t","mailbox":"INBOX"}' | jq '{exists,recent}'

# Select a folder with spaces (pre-quote in JSON)
curl -s $BASE/imap/select \
  -H 'Content-Type: application/json' \
  -d '{"host":"imap.example.com","username":"alice","password":"s3cr3t","mailbox":"\"Sent Items\""}' | jq .

# IMAPS list
curl -s $BASE/imaps/list \
  -H 'Content-Type: application/json' \
  -d '{"host":"imap.example.com","port":993,"username":"alice","password":"s3cr3t"}' | jq '.mailboxes'
```

---

## Local Test Server

**Dovecot (Docker):**
```bash
docker run -d --name dovecot -p 143:143 -p 993:993 dovecot/dovecot
```

**GreenMail (in-memory, test-ready):**
```bash
docker run -d -p 3143:3143 -p 3993:3993 greenmail/standalone
# Pre-configured: user1/user1 on port 3143/3993
```

---

## What is NOT Implemented

- **STARTTLS** — no mid-session TLS upgrade; use `/api/imaps/*` on port 993
- **AUTHENTICATE** — no SASL; `LOGIN` command only (plain text)
- **IDLE** — can start but cannot correctly terminate through session (DONE must be untagged)
- **NAMESPACE** — `LIST "" "*"` only; no NAMESPACE command to discover personal/shared/public hierarchies
- **EXAMINE** — no dedicated HTTP endpoint; use session WebSocket
- **SEARCH / FETCH / STORE / COPY / MOVE** — no dedicated HTTP endpoints; use session
- **APPEND** — no endpoint to upload messages to the server
- **Literal mailbox names** — `LIST` parser drops mailboxes returned as literals `{N}\r\nname`
- **NIL hierarchy delimiter** — silently skipped by the LIST regex
- **Modified UTF-7 decoding** — international mailbox names returned in raw RFC 3501 encoding
- **SELECT metadata** — UIDVALIDITY, UIDNEXT, FLAGS, PERMANENTFLAGS, UNSEEN, READ-WRITE/READ-ONLY not extracted by `/select`
- **Connection pooling** — each HTTP request opens a fresh TCP+TLS connection
