# XMPP Protocol — Port of Call Reference

**RFC:** [6120](https://tools.ietf.org/html/rfc6120) (core), [6121](https://tools.ietf.org/html/rfc6121) (IM), [6122](https://tools.ietf.org/html/rfc6122) (addressing)
**Default ports:** 5222 (c2s), 5269 (s2s — see `xmpp-s2s.ts`/`xmpps2s.ts`), 5223 (legacy XMPPS — not supported)
**Source:** `src/worker/xmpp.ts`
**Routes:** `src/worker/index.ts` lines 1223–1237
**Tests:** `tests/xmpp.test.ts` (8 integration tests, connect-only — no auth tests against live servers)

---

## Endpoints

| Endpoint | Auth | Default timeout | Inner read timeout | HTTP methods |
|---|---|---|---|---|
| `POST /api/xmpp/connect` | No | 10 000 ms | 5 000 ms | POST only |
| `POST /api/xmpp/login` | SASL PLAIN | 15 000 ms | 5 000 ms | POST only |
| `POST /api/xmpp/roster` | SASL PLAIN | 20 000 ms | 5 000 ms (bind), 8 000 ms (roster fetch) | POST only |
| `POST /api/xmpp/message` | SASL PLAIN | 20 000 ms | 5 000 ms | POST only |

All endpoints return HTTP 200 for protocol-level successes **and** protocol-level failures (e.g., auth rejected). Check `success` in the response body. HTTP 400 = missing required fields. HTTP 403 = Cloudflare-protected host. HTTP 500 = unhandled exception.

### Phase tracking

The `phases` array (all endpoints except `/connect`) tracks how far the XMPP handshake progressed. It is the fastest way to pinpoint where a failure occurred.

| Phase | `/login` | `/roster` | `/message` |
|---|---|---|---|
| `stream_opened` | yes | yes | yes |
| `sasl_plain_sent` | yes | **no** | **no** |
| `authenticated` | yes | yes | yes |
| `stream_restarted` | yes | yes | yes |
| `resource_bound` | yes | yes | yes |
| `session_established` | if offered | if offered | if offered |
| `roster_received` | — | yes | — |
| `message_sent` | — | — | yes |

**Gotcha — `sasl_plain_sent`:** Only `/login` pushes this phase. `/roster` and `/message` skip straight from `stream_opened` to `authenticated` even though they send the identical `<auth>` stanza. If auth fails on those endpoints, the last phase is `stream_opened`.

**Gotcha — `resource_bound` always pushed:** The bind IQ response is not checked for `type='error'`. If the server rejects the bind request, `resource_bound` is still added to phases and a fallback JID (`username@domain/portofcall`) is used.

**Gotcha — `session_established` always pushed:** The session IQ response is `.catch(() => '')` — server rejections are silently swallowed and `session_established` is added regardless.

---

### `POST /api/xmpp/connect` — Stream probe (unauthenticated)

Opens an XML stream, reads `<stream:features>`, and closes. No credentials needed.

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
| `domain` | `host` | Value sent in `<stream:stream to='...'>`. Set this for virtual hosting where DNS host != XMPP domain. **Only available on this endpoint** — auth endpoints hardcode `domain = host`. |
| `timeout` | `10000` | Outer wall-clock timeout in ms |

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

- `tls.available` — server advertises `urn:ietf:params:xml:ns:xmpp-tls` or `<starttls`
- `saslMechanisms` — from `<mechanism>` elements inside `<mechanisms>` block
- `compressionMethods` — from `<method>` elements inside `<compression>` block
- `raw` — **only this endpoint** — first 2000 bytes of the server's raw response
- `features` — derived from namespace/element detection (see table below)

**Feature detection table:**

| Feature string | Detected by |
|---|---|
| `starttls` | `urn:ietf:params:xml:ns:xmpp-tls` or `<starttls` |
| `resource-binding` | `urn:ietf:params:xml:ns:xmpp-bind` or `<bind` |
| `session` | `urn:ietf:params:xml:ns:xmpp-session` or `<session` |
| `stream-management` | `urn:xmpp:sm:` or literal `stream-management` |
| `roster-versioning` | `rosterver` or `roster-versioning` or `urn:xmpp:features:rosterver` or `ver=` |
| `client-state-indication` | `urn:xmpp:csi:` (XEP-0352) |
| `message-carbons` | `urn:xmpp:carbons:` (XEP-0280) |

**Known bug — `tls.required` false positive:** The code checks `xml.includes('<required') && tlsAvailable`. The `<required` check is global, not scoped to the `<starttls>` block. If _any_ feature element contains `<required/>` (e.g., `<bind><required/></bind>` on some servers), `tls.required` will be `true` even when TLS is optional.

**Known bug — `roster-versioning` false positive:** The `ver=` substring check (line 126) matches the `version='1.0'` attribute on `<stream:stream>`, so `roster-versioning` may appear in `features` on servers that don't actually support it. The `Set` deduplication prevents it from appearing twice, but the detection itself is overly broad.

**Note:** STARTTLS is _detected_ but not _negotiated_. The connection is plaintext only.

---

### `POST /api/xmpp/login` — SASL PLAIN authentication + resource binding

Full login: stream open -> SASL PLAIN -> stream restart -> resource bind -> optional session.

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

**No `domain` parameter.** The XMPP domain is always `host`. If you need `host != domain` (e.g., connecting to an IP but authenticating as `user@example.com`), this endpoint cannot do it.

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

**Response field note:** `saslMechanisms` comes from the _pre-auth_ stream features (what the server initially offered). `features` comes from the _post-auth_ stream features (what the server offers after authentication — typically bind/session, no SASL mechanisms). These are from two different stream negotiations.

**Failure (auth rejected):**

```json
{
  "success": false,
  "phases": ["stream_opened", "sasl_plain_sent"],
  "error": "SASL authentication failed: not-authorized"
}
```

The error condition name is extracted via a regex matching the first `<([a-z-]+)\s*\/>` self-closing element inside the `<failure>` block. Common values: `not-authorized`, `invalid-mechanism`, `temporary-auth-failure`.

**SASL PLAIN only:** If the server does not list PLAIN in its mechanisms, the endpoint returns immediately with an error listing available mechanisms. SCRAM-SHA-1, SCRAM-SHA-256, DIGEST-MD5, GSSAPI, and EXTERNAL are not implemented.

---

### `POST /api/xmpp/roster` — Authenticated roster (contact list) fetch

Logs in via SASL PLAIN, sends `jabber:iq:roster` GET, parses contacts.

**Request:** same as `/login` with `timeout` defaulting to `20000`.

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
| `jid` | Bare JID from `jid` attribute on `<item>` |
| `name` | Display name from `name` attribute, or `null` if absent |
| `subscription` | `none`, `from`, `to`, `both`, or `remove` (RFC 6121 section 2.1.2.5); defaults to `none` |
| `groups` | Array of `<group>` text content within a 500-byte window after the `<item>` tag |

**Group parsing limitation:** For each `<item>`, the code extracts a 500-byte context window starting at the item's position (`rosterResp.substring(itemMatch.index, itemMatch.index + 500)`). The `<group>` regex runs only within this window. Contacts with many or long group names that extend past 500 bytes will have truncated group lists. Additionally, groups from the _next_ `<item>` that falls within the 500-byte window will incorrectly be attributed to the current contact.

**Inner read timeout:** The roster fetch uses an 8000 ms inner read timeout (not the 5000 ms used by all other `readUntil` calls). This accommodates large rosters that take longer to transmit.

---

### `POST /api/xmpp/message` — Send a chat message

Logs in via SASL PLAIN, sends a single `<message type='chat'>` stanza.

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
| `recipient` | **required** | Full or bare JID |
| `message` | `"Hello from PortOfCall"` | Message body text |

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

**Message ID format:** `poc_` + `Date.now()` (epoch ms). Not RFC 4122 UUID.

**XML escaping:** The message _body_ is escaped (`&` `<` `>` `"` `'`). The _recipient JID_ is **not escaped** — it is interpolated directly into the XML `to` attribute. A malicious recipient string could break the XML structure (XML injection). Sanitize upstream.

**Delivery error detection:** After sending, the worker waits up to 2000 ms (via `readUntil`) for any `<message `, `<presence `, or `<iq ` stanza containing `<error>`. If found, `deliveryError` contains the inner XML of the error block. This catches immediate server-side rejections but not deferred failures or errors from remote servers. If no error arrives within 2 s, `deliveryError` is `null`. The 2 s wait happens on every successful send regardless.

---

## Implementation Details

### Buffer limits

| Location | Limit | Behavior |
|----------|-------|----------|
| `readWithTimeout` (connect probe) | 8192 bytes | Returns partial buffer; parsing may be incomplete |
| `readUntil` (all auth endpoints) | 65536 bytes | Returns partial buffer; pattern match may never fire |

### Timeout architecture

Two competing timeout layers per handler:

1. **Outer** — `Promise.race` against a wall-clock `setTimeout` (10–20 s depending on endpoint). Fires if total operation time exceeds budget.
2. **Inner** — per-`readUntil`/`readWithTimeout` call (5 s default, 8 s for roster fetch, 2 s for delivery error wait). Fires if a single read stalls.

Worst case: 5 sequential reads at 5 s each = 25 s, but the outer timeout kills the whole operation first. If the outer timeout fires, the `connectionPromise` is abandoned but the socket may not be cleanly closed (no `finally` block on the outer race).

### SASL PLAIN encoding

```
base64("\0" + username + "\0" + password)
```

Uses `btoa()`. **ASCII-only limitation:** `btoa()` throws `InvalidCharacterError` on any character outside Latin-1 (U+0000–U+00FF). Usernames or passwords containing non-Latin characters (CJK, emoji, etc.) will cause HTTP 500. There is no `TextEncoder`-based workaround in the code.

Sent over plaintext TCP without STARTTLS. Credentials are transmitted in cleartext.

### Resource name

Hardcoded to `portofcall` for all auth endpoints. The server may override and return a different JID in the `<jid>` bind response — the returned `jid` field reflects whatever the server assigned.

### IQ stanza IDs

All hardcoded: `bind1`, `sess1`, `roster1`. Not unique across concurrent connections. On error, these IDs appear in server error stanzas.

### Stream open template

```xml
<?xml version='1.0'?><stream:stream to='{domain}'
  xmlns='jabber:client'
  xmlns:stream='http://etherx.jabber.org/streams'
  version='1.0'>
```

The `to` attribute uses single quotes. `domain` is not XML-escaped — an adversarial domain string with `'` could break the stream open element.

### Cloudflare detection

All 4 endpoints call `checkIfCloudflare(host)` before opening a socket. Returns HTTP 403 with `isCloudflare: true` if the host resolves to a Cloudflare IP.

### `parseStreamFeatures` — regex-based XML parsing

No DOM/SAX parser. All extraction is via `String.includes()` and `RegExp.exec()`. Implications:

- `streamId` extracted from `id='...'` — matches the _first_ `id` attribute in the response, which is on `<stream:stream>`. Correct in practice.
- `serverFrom` extracted from `from='...'` — matches the _first_ `from` attribute. Correct since `<stream:stream>` is the first element.
- Namespace substring checks (`includes('urn:...')`) can false-positive on server-specific extensions that contain these substrings in comments, error text, or attribute values.

---

## Quick reference — curl

```bash
# Probe server features (no auth)
curl -s -X POST https://portofcall.ross.gg/api/xmpp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"jabber.org","domain":"jabber.org"}' | jq .

# Virtual host (DNS host != XMPP domain)
curl -s -X POST https://portofcall.ross.gg/api/xmpp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.5","port":5222,"domain":"chat.example.com"}' | jq .

# Check SASL mechanisms
curl -s -X POST https://portofcall.ross.gg/api/xmpp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"jabber.org"}' | jq '.saslMechanisms'

# Raw features XML
curl -s -X POST https://portofcall.ross.gg/api/xmpp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"jabber.org"}' | jq -r '.raw'

# Login (local server with PLAIN enabled)
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

Most internet-facing XMPP servers require SCRAM-SHA-1+ and reject SASL PLAIN on unencrypted connections. Use Docker for auth testing.

**ejabberd** (`c2s_starttls: optional` in `ejabberd.yml`):

```bash
docker run -d -p 5222:5222 -p 5269:5269 --name ejabberd ejabberd/ecs
docker exec ejabberd ejabberdctl register alice localhost password123
docker exec ejabberd ejabberdctl register bob localhost password456
```

**Prosody** (`c2s_require_encryption = false`, `authentication = "internal_plain"` in `prosody.cfg.lua`):

```bash
docker run -d -p 5222:5222 -p 5269:5269 --name prosody prosody/prosody
docker exec prosody prosodyctl register alice localhost password123
```

---

## Known Bugs and Limitations

### Bugs

1. **`tls.required` false positive** — `/connect` checks `xml.includes('<required')` globally, not within `<starttls>`. Any feature with `<required/>` (common in `<bind>`) triggers a false `true`.

2. **`roster-versioning` false positive** — `ver=` substring check matches `version='1.0'` on `<stream:stream>`. Most `/connect` responses will incorrectly include `roster-versioning` in `features`.

3. **`btoa()` ASCII-only** — SASL PLAIN encoding uses `btoa()` which throws on characters > U+00FF. Non-Latin usernames/passwords cause HTTP 500.

4. **Recipient JID not escaped** — `/message` interpolates `recipient` directly into XML `to='...'` attribute. XML injection possible with crafted JIDs.

5. **Domain not escaped in stream open** — `to='${domain}'` / `to='${targetDomain}'` — single-quote in domain breaks the XML.

6. **Bind/session errors silently ignored** — `resource_bound` is pushed regardless of IQ error response. Session IQ errors are `.catch(() => '')`.

### Limitations

- **SASL PLAIN only** — No SCRAM-SHA-1, SCRAM-SHA-256, DIGEST-MD5, GSSAPI, EXTERNAL
- **No STARTTLS** — TLS is detected but never negotiated; all traffic is plaintext
- **No XMPP-over-TLS (port 5223)** — Cloudflare Workers sockets don't support direct TLS
- **No `domain` on auth endpoints** — domain is always `host`; cannot separate connection target from XMPP domain for login/roster/message
- **No message receipts** (XEP-0184), **no MUC** (XEP-0045), **no presence subscription**, **no WebSocket** (RFC 7395), **no BOSH** (XEP-0206)
- **No GET method** — all endpoints are POST-only
- **Server-to-server** — separate files: `xmpp-s2s.ts` (4 endpoints at `/api/xmpp-s2s/`), `xmpps2s.ts` (3 endpoints at `/api/xmpps2s/`)
