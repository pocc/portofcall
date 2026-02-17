# XMPP Protocol — Port of Call Reference

**RFC:** [6120](https://tools.ietf.org/html/rfc6120) (core), [6121](https://tools.ietf.org/html/rfc6121) (IM), [6122](https://tools.ietf.org/html/rfc6122) (addressing)
**Default ports:** 5222 (c2s), 5269 (s2s), 5223 (legacy XMPPS)
**Source:** `src/worker/xmpp.ts`
**Tests:** `tests/xmpp.test.ts`

---

## Endpoints

### Phases per endpoint

The `phases` array tracks how far the handshake got. It's the fastest way to pinpoint a failure without reading raw XML.

| Phase | `/connect` | `/login` | `/roster` | `/message` |
|---|---|---|---|---|
| `stream_opened` | — | ✅ | ✅ | ✅ |
| `sasl_plain_sent` | — | ✅ | ❌ | ❌ |
| `authenticated` | — | ✅ | ✅ | ✅ |
| `stream_restarted` | — | ✅ | ✅ | ✅ |
| `resource_bound` | — | ✅ | ✅ | ✅ |
| `session_established` | — | if offered | if offered | if offered |
| `roster_received` | — | — | ✅ | — |
| `message_sent` | — | — | — | ✅ |

> `/connect` returns no `phases` field. `/roster` and `/message` omit `sasl_plain_sent` even though the `<auth>` stanza is sent — if those endpoints fail at auth, the last phase will be `stream_opened`.

---

### `POST /api/xmpp/connect` — Stream probe (unauthenticated)

Opens an XML stream, reads `<stream:features>`, and closes. No credentials required.

**Request:**

```json
{
  "host": "jabber.org",
  "port": 5222,
  "domain": "jabber.org",
  "timeout": 10000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | IP or hostname to connect to |
| `port` | `5222` | TCP port |
| `domain` | `host` | Value sent in `<stream:stream to='...'>`. Set this for virtual hosting where DNS host ≠ XMPP domain. |
| `timeout` | `10000` | Total wall-clock timeout in ms |

**Response (success):**

```json
{
  "success": true,
  "message": "XMPP server reachable",
  "host": "jabber.org",
  "port": 5222,
  "domain": "jabber.org",
  "streamId": "abc123",
  "serverFrom": "jabber.org",
  "xmppVersion": "1.0",
  "tls": {
    "available": true,
    "required": false
  },
  "saslMechanisms": ["PLAIN", "SCRAM-SHA-1", "SCRAM-SHA-256"],
  "compressionMethods": ["zlib"],
  "features": ["starttls", "resource-binding", "session", "stream-management"],
  "raw": "<stream:stream ...><stream:features>...</stream:features>"
}
```

**Key fields:**

- `tls.available` — server advertises `urn:ietf:params:xml:ns:xmpp-tls` or `<starttls>`
- `tls.required` — `<required/>` is present inside `<starttls>` block
- `saslMechanisms` — from `<mechanism>` elements inside `<mechanisms>` block
- `compressionMethods` — from `<method>` elements inside `<compression>` block
- `raw` — **only returned by this endpoint** — first 2000 bytes of the server's raw response; use it to extract data the parser missed or to see exactly what the server sent before `</stream:features>`
- `features` — derived from namespace URI presence in the features block:

| Feature string | Detected by namespace / element |
|---|---|
| `starttls` | `urn:ietf:params:xml:ns:xmpp-tls` or `<starttls` |
| `resource-binding` | `urn:ietf:params:xml:ns:xmpp-bind` or `<bind` |
| `session` | `urn:ietf:params:xml:ns:xmpp-session` or `<session` |
| `stream-management` | `urn:xmpp:sm:` (XEP-0198) |
| `roster-versioning` | `rosterver` attribute or `urn:xmpp:features:rosterver` |
| `client-state-indication` | `urn:xmpp:csi:` (XEP-0352) |
| `message-carbons` | `urn:xmpp:carbons:` (XEP-0280) |

**Note:** STARTTLS is *detected* but not *negotiated*. The connection probes plaintext stream features only, then closes. To test an XMPP-over-TLS (port 5223) server, use `port: 5223` — the worker will attempt a raw TCP connection but the TLS handshake will fail at the socket layer.

---

### `POST /api/xmpp/login` — SASL PLAIN authentication + resource binding

Performs the full XMPP login sequence: stream open → SASL PLAIN → stream restart → resource bind → optional session.

**Request:**

```json
{
  "host": "jabber.org",
  "port": 5222,
  "username": "alice",
  "password": "hunter2",
  "timeout": 15000
}
```

The domain for the stream and JID is derived from `host`. There is no separate `domain` parameter on auth endpoints.

**Response (success):**

```json
{
  "success": true,
  "host": "jabber.org",
  "port": 5222,
  "jid": "alice@jabber.org/portofcall",
  "domain": "jabber.org",
  "phases": ["stream_opened", "sasl_plain_sent", "authenticated", "stream_restarted", "resource_bound", "session_established"],
  "features": ["resource-binding", "stream-management"],
  "saslMechanisms": ["PLAIN", "SCRAM-SHA-1"],
  "message": "XMPP login successful"
}
```

**Phases** (in order):

| Phase | Meaning |
|-------|---------|
| `stream_opened` | First stream + features received |
| `sasl_plain_sent` | `<auth mechanism='PLAIN'>` sent |
| `authenticated` | `<success/>` received |
| `stream_restarted` | Second stream opened post-auth |
| `resource_bound` | `<bind>` IQ result received; full JID known |
| `session_established` | `<session>` IQ sent and acknowledged (only if server advertises the feature; many RFC 6121-compliant servers omit it) |

**Failure response:**

```json
{
  "success": false,
  "phases": ["stream_opened", "sasl_plain_sent"],
  "error": "SASL authentication failed: not-authorized"
}
```

**Limitation:** Only SASL PLAIN is supported. If the server does not list PLAIN in its mechanisms (e.g., requires SCRAM-SHA-1 only), the endpoint returns immediately with an error listing the available mechanisms. DIGEST-MD5, SCRAM-SHA-*, GSSAPI, and EXTERNAL are not implemented.

**Public server caveat:** Most internet-facing XMPP servers (jabber.org, conversations.im, etc.) disable SASL PLAIN on unencrypted connections as a security policy. The `/connect` probe works against any server; auth endpoints (`/login`, `/roster`, `/message`) require either a server that allows PLAIN or a local test instance with TLS disabled.

---

### `POST /api/xmpp/roster` — Authenticated roster (contact list) fetch

Logs in via SASL PLAIN and issues a `jabber:iq:roster` GET request.

**Request:** same fields as `/api/xmpp/login`, with `timeout` defaulting to `20000`.

**Response (success):**

```json
{
  "success": true,
  "host": "jabber.org",
  "port": 5222,
  "jid": "alice@jabber.org/portofcall",
  "phases": ["stream_opened", "authenticated", "stream_restarted", "resource_bound", "roster_received"],
  "roster": {
    "total": 3,
    "contacts": [
      {
        "jid": "bob@jabber.org",
        "name": "Bob",
        "subscription": "both",
        "groups": ["Friends"]
      }
    ]
  }
}
```

**Roster contact fields:**

| Field | Notes |
|-------|-------|
| `jid` | Bare JID of contact |
| `name` | Display name from `name` attribute, or `null` |
| `subscription` | `none`, `from`, `to`, `both`, or `remove` (RFC 6121 §2.1.2.5) |
| `groups` | Array of group names from `<group>` children within ~500 bytes of the `<item>` tag |

**Gotcha:** Group parsing uses a bounded context window (500 bytes after each `<item>` tag) to avoid regex catastrophe on large rosters. Contacts with many group elements beyond this window may show truncated groups.

---

### `POST /api/xmpp/message` — Send a chat message

Logs in via SASL PLAIN and sends a single `<message type='chat'>` stanza.

**Request:**

```json
{
  "host": "jabber.org",
  "port": 5222,
  "username": "alice",
  "password": "hunter2",
  "recipient": "bob@jabber.org",
  "message": "Hello from Port of Call",
  "timeout": 20000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `recipient` | **required** | Full or bare JID of recipient |
| `message` | `"Hello from PortOfCall"` | Message body (XML-escaped automatically) |

**Response (success):**

```json
{
  "success": true,
  "jid": "alice@jabber.org/portofcall",
  "phases": ["stream_opened", "authenticated", "stream_restarted", "resource_bound", "message_sent"],
  "message": {
    "to": "bob@jabber.org",
    "body": "Hello from Port of Call",
    "id": "poc_1708123456789"
  },
  "deliveryError": null
}
```

**Delivery error detection:** After sending the message stanza, the worker waits 2 seconds for a `<message>`, `<presence>`, or `<iq>` stanza that contains an `<error>` block. If one arrives, its inner XML is captured in `deliveryError`. This catches immediate server-side rejections (e.g., recipient not found, policy violations) but will *not* catch deferred delivery failures or errors from remote servers.

**XML escaping:** The message body is escaped (`&`, `<`, `>`, `"`, `'`) before being placed in `<body>`. Recipient JID is not escaped — do not pass attacker-controlled JIDs without sanitization upstream.

---

## Implementation Notes

### Buffer limits

| Location | Limit | Behavior on overflow |
|----------|-------|---------------------|
| `readWithTimeout` (connect probe) | 8192 bytes | Returns partial buffer |
| `readUntil` (login/roster/message) | 65536 bytes | Returns partial buffer |

If a server sends an unusually large features block or roster before the termination pattern is seen, the buffer is returned as-is. Downstream parsing may be incomplete but won't hang.

### Nested timeout architecture

Each handler has two competing timeouts:
1. An outer `Promise.race` against a `timeout`-ms wall-clock limit (default: 10–20 s depending on endpoint)
2. An inner 5 s timeout per individual `readWithTimeout` / `readUntil` call

The inner per-read timeout fires first if a specific step stalls (e.g., server sends stream header but delays features). The outer timeout catches cases where multiple steps each approach 5 s and total time exceeds the budget.

### SASL PLAIN encoding

```
base64("\0" + username + "\0" + password)
```

This is sent without STARTTLS negotiation — the connection is plaintext TCP. Credentials are transmitted in cleartext. Only use against servers where you control the network path, or a local test instance.

### Resource name

The resource is hardcoded to `portofcall` for all authenticated operations. The server may override this and return a different full JID in the `<jid>` bind response — the returned `jid` field reflects whatever the server assigned.

### IQ stanza IDs

All IQ stanza IDs are hardcoded: `bind1`, `sess1`, `roster1`. On error, these IDs will appear in server error stanzas and can be cross-referenced with the phase where the failure occurred.

---

## Quick reference — curl

```bash
# Probe server features (no auth)
curl -s -X POST https://portofcall.ross.gg/api/xmpp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"jabber.org","domain":"jabber.org"}' | jq .

# Probe with virtual host (DNS host differs from XMPP domain)
curl -s -X POST https://portofcall.ross.gg/api/xmpp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.5","port":5222,"domain":"chat.example.com"}' | jq .

# Check which SASL mechanisms a server offers
curl -s -X POST https://portofcall.ross.gg/api/xmpp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"jabber.org"}' | jq '.saslMechanisms'

# Inspect raw server features response
curl -s -X POST https://portofcall.ross.gg/api/xmpp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"jabber.org"}' | jq -r '.raw'

# Full login test (use local server with PLAIN enabled)
curl -s -X POST https://portofcall.ross.gg/api/xmpp/login \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","username":"alice","password":"hunter2"}' | jq '.phases,.jid'

# Fetch roster
curl -s -X POST https://portofcall.ross.gg/api/xmpp/roster \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","username":"alice","password":"hunter2"}' | jq '.roster'

# Send message
curl -s -X POST https://portofcall.ross.gg/api/xmpp/message \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","username":"alice","password":"hunter2","recipient":"bob@localhost","message":"test"}' | jq .
```

---

## Local test servers

Most internet-facing XMPP servers require SCRAM-SHA-1 or better and will reject SASL PLAIN on unencrypted connections. Use a local Docker instance for auth endpoint testing.

**ejabberd** (disable TLS requirement: set `c2s_starttls: optional` in `ejabberd.yml`):

```bash
docker run -d -p 5222:5222 -p 5269:5269 --name ejabberd ejabberd/ecs
docker exec ejabberd ejabberdctl register alice localhost password123
docker exec ejabberd ejabberdctl register bob localhost password456
```

**Prosody** (set `c2s_require_encryption = false` and `authentication = "internal_plain"` in `prosody.cfg.lua`):

```bash
docker run -d -p 5222:5222 -p 5269:5269 --name prosody prosody/prosody
docker exec prosody prosodyctl register alice localhost password123
```

---

## What is NOT implemented

- **STARTTLS negotiation** — TLS availability is detected from features, but the handshake is not performed
- **SCRAM-SHA-1 / SCRAM-SHA-256** — Only SASL PLAIN is supported; most modern servers require SCRAM on unencrypted ports, making auth endpoints primarily useful with local test servers
- **XMPP-over-TLS (port 5223)** — Direct TLS connections are not supported via Cloudflare Workers sockets
- **Message receipt / read confirmations** (XEP-0184)
- **Multi-User Chat** (XEP-0045)
- **Roster push / presence subscription** — Subscribe/unsubscribe flows
- **WebSocket transport** (RFC 7395)
- **BOSH** (XEP-0206)
- **Server-to-server (s2s)** — see `src/worker/xmpp-s2s.ts` for s2s probing
