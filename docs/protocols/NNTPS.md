# NNTPS Reference

**Port:** 563 (default)
**RFCs:** [3977](https://tools.ietf.org/html/rfc3977) (NNTP), [4642](https://tools.ietf.org/html/rfc4642) (NNTP over TLS), [4643](https://tools.ietf.org/html/rfc4643) (AUTHINFO), [5536](https://tools.ietf.org/html/rfc5536) (Article Format), [5537](https://tools.ietf.org/html/rfc5537) (Netnews Architecture)
**Implementation:** `src/worker/nntps.ts`
**Related:** `src/worker/nntp.ts` (plaintext NNTP on port 119)

---

## What NNTPS Is

NNTPS is NNTP with **implicit TLS** from the first byte of the connection. It is not NNTP with STARTTLS (which upgrades a plaintext connection mid-stream via the `STARTTLS` command on port 119). NNTPS uses a dedicated port (563) and the TLS handshake happens before any NNTP bytes are exchanged.

RFC 4642 describes both the STARTTLS extension (port 119) and the implicit-TLS convention (port 563). This implementation exclusively uses implicit TLS via Cloudflare Workers' `secureTransport: 'on'` option.

### TLS vs STARTTLS: why it matters

| Aspect | NNTPS (port 563) | STARTTLS (port 119) |
|--------|-----------------|---------------------|
| TLS initiation | Immediately on connect | After `STARTTLS` command exchange |
| Welcome banner | Inside TLS tunnel | Sent in plaintext before upgrade |
| Auth credentials | Always encrypted | Encrypted only after upgrade |
| Implementation | `secureTransport: 'on'` | Not supported (no mid-stream upgrade in Workers sockets) |

---

## Endpoints

All endpoints are `POST`-only with JSON bodies.

| Path | Description |
|------|-------------|
| `POST /api/nntps/connect` | TLS handshake + welcome banner + CAPABILITIES + MODE READER |
| `POST /api/nntps/group` | Select newsgroup, fetch up to 20 recent article overviews via OVER |
| `POST /api/nntps/article` | Retrieve full article (headers + body) by number |
| `POST /api/nntps/list` | List newsgroups: ACTIVE / NEWSGROUPS / OVERVIEW.FMT |
| `POST /api/nntps/post` | Post an article (requires posting permission, optional auth) |
| `POST /api/nntps/auth` | Test AUTHINFO USER/PASS credentials |

Every endpoint opens a **fresh TLS connection** per request. There is no persistent session or article pointer state between calls.

---

## Shared Internals

### Connection setup

All handlers call `connect(host:port, { secureTransport: 'on', allowHalfOpen: false })`. The `secureTransport: 'on'` flag causes the Cloudflare Workers socket layer to perform a TLS handshake before making the readable/writable streams available. `allowHalfOpen: false` tells the socket to close fully when the write side is done.

`socket.opened` is awaited (raced against `timeoutPromise`) to confirm the TLS handshake succeeded before any I/O begins.

### Cloudflare-origin protection

Every handler calls `checkIfCloudflare(host)` before connecting. If the target host resolves to a Cloudflare IP address, the request is rejected with HTTP 403 and `isCloudflare: true`. This prevents loopback attacks through Cloudflare's own infrastructure.

### I/O helpers (module-level, identical to `nntp.ts`)

**`readLine(reader, decoder, buffer, timeoutPromise)`**
Reads from `buffer.data` until `\r\n` appears, fetching more chunks from the reader as needed. Returns the line without the `\r\n` terminator. Throws `'Connection closed unexpectedly'` on EOF.

**`readMultiline(reader, decoder, buffer, timeoutPromise, maxSize=500000)`**
Reads lines via `readLine` until a lone `.` appears on its own line (the NNTP end-of-datablock marker). Applies RFC 3977 §3.1.1 **dot-unstuffing**: lines starting with `..` have the leading dot removed before being added to the result array. Throws `'Response too large (max 500KB)'` if cumulative size exceeds 500,000 bytes.

**`sendCommand(writer, encoder, command)`**
Appends `\r\n` and writes the encoded bytes to the socket. All NNTP commands must be terminated with `\r\n`.

### Timeout architecture

Each handler creates a single `timeoutPromise` at handler entry:

```typescript
const timeoutPromise = new Promise<never>((_, reject) => {
  setTimeout(() => reject(new Error('Connection timeout')), timeout);
});
```

This same promise is passed to every `readLine` and `readMultiline` call and is also raced against `socket.opened`. The timeout is **wall-clock from handler start** and is never reset between protocol steps. On a slow TLS handshake, budget is consumed before any NNTP commands are sent.

### Private auth helper

```typescript
async function nntpsAuth(
  writer, reader, decoder, encoder, buffer,
  username: string, password: string,
  timeoutPromise: Promise<never>
): Promise<void>
```

Sends `AUTHINFO USER <username>`, asserts `381`, then `AUTHINFO PASS <password>`, asserts `281`. Any unexpected response throws, causing the calling handler to return HTTP 500. Used by `/list` and `/post` when credentials are provided.

---

## `/api/nntps/connect`

Probes the server: TLS handshake + welcome banner + optional CAPABILITIES + optional MODE READER.

### Request

```json
{ "host": "news.eternal-september.org", "port": 563, "timeout": 15000 }
```

| Field | Type | Default |
|-------|------|---------|
| `host` | string | required |
| `port` | number | `563` |
| `timeout` | number | `15000` ms |

### Protocol sequence

```
[TLS handshake]
<- 200 Welcome message (or 201 = no posting)
-> CAPABILITIES
<- 101 Capability list follows
  VERSION 2
  READER
  OVER
  POST
  AUTHINFO USER PASS
  STARTTLS
  .
-> MODE READER
<- 200 Posting allowed (or 201)
-> QUIT
```

CAPABILITIES and MODE READER are each wrapped in a separate `try/catch`. If either fails (e.g., server does not support the command), the failure is silently ignored and the response field is left empty.

### RTT measurement

RTT is captured **after** the complete application-layer handshake (welcome + CAPABILITIES exchange + MODE READER) — just before QUIT. This makes `rtt` a full protocol round-trip time, not just the TLS handshake duration.

### Response

```json
{
  "success": true,
  "host": "news.eternal-september.org",
  "port": 563,
  "protocol": "NNTPS",
  "tls": true,
  "rtt": 312,
  "welcome": "200 news.eternal-september.org InterNetNews NNRP server ready (posting ok)",
  "postingAllowed": true,
  "capabilities": ["VERSION 2", "READER", "OVER", "POST", "AUTHINFO USER PASS", "STARTTLS"],
  "modeReader": "200 Posting allowed"
}
```

- `tls: true` — always present, signals that the connection used implicit TLS
- `protocol: "NNTPS"` — always present (plaintext NNTP `/connect` response omits this)
- `postingAllowed` — `true` if welcome code was `200`, `false` if `201`
- `capabilities` — raw capability strings from CAPABILITIES; `[]` if not supported
- `modeReader` — raw MODE READER response line; `''` if MODE READER failed
- `rtt` — milliseconds from handler start to after MODE READER response received

**400** if `host` empty or `port` out of `1-65535`.
**403** if target resolves to Cloudflare IP (`isCloudflare: true` in body).
**502** if welcome code is not 200 or 201.
**500** on TCP/TLS error or timeout.

---

## `/api/nntps/group`

Selects a newsgroup over TLS and fetches overviews for up to 20 recent articles.

### Request

```json
{
  "host": "news.eternal-september.org",
  "port": 563,
  "group": "comp.lang.python",
  "timeout": 15000
}
```

| Field | Type | Default |
|-------|------|---------|
| `host` | string | required |
| `port` | number | `563` |
| `group` | string | required |
| `timeout` | number | `15000` ms |

**Group name validation:** `/^[a-zA-Z0-9][a-zA-Z0-9.+-]*$/` — letters, digits, dots, hyphens, `+` only. Underscores are rejected with HTTP 400. Note: some real Usenet hierarchies use underscores (e.g., `alt.fan_fiction`); those will fail this check.

### Protocol sequence

```
[TLS handshake]
<- 200 Welcome
-> MODE READER
<- 200
-> GROUP comp.lang.python
<- 211 <count> <first> <last> comp.lang.python
-> OVER <last-19>-<last>         (only if count > 0)
<- 224 Overview information follows
  <number>\t<subject>\t<from>\t<date>\t<message-id>\t<references>\t<bytes>\t<lines>
  .
-> QUIT
```

MODE READER is sent unconditionally without error handling. A server that rejects MODE READER will cause the handler to return HTTP 500 because the response is consumed but not validated before proceeding to GROUP.

`OVER` (RFC 3977 §8.4) is used, not `XOVER` (RFC 2980). Older servers that only understand `XOVER` will return a non-224 response; the articles array will be silently empty.

### Response

```json
{
  "success": true,
  "group": "comp.lang.python",
  "count": 8421,
  "first": 1000,
  "last": 9420,
  "articles": [
    {
      "number": 9420,
      "subject": "Re: asyncio question",
      "from": "alice@example.com",
      "date": "Mon, 17 Feb 2026 10:00:00 +0000",
      "messageId": "<abc123@example.com>",
      "lines": 42
    }
  ],
  "rtt": 840
}
```

- `articles` is returned **newest first** (reversed after OVER parsing)
- `lines` comes from OVER field index 7 (1-based field 8); `bytes` (field 7) is not returned
- OVER entries with fewer than 6 tab-separated fields are silently dropped
- `count` / `first` / `last` come directly from the 211 response

**400** if group name fails regex or `host`/`port` invalid.
**403** if Cloudflare-origin target.
**404** if GROUP returns 411 (no such newsgroup).
**500** on TCP/TLS error, timeout, or unexpected server response.

---

## `/api/nntps/article`

Retrieves a full article over TLS by article number, with header and body parsing.

### Request

```json
{
  "host": "news.eternal-september.org",
  "port": 563,
  "group": "comp.lang.python",
  "articleNumber": 9420,
  "timeout": 15000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | |
| `port` | number | `563` | |
| `group` | string | required | same regex as /group |
| `articleNumber` | number | required | must be >= 1 |
| `timeout` | number | `15000` ms | |

### Protocol sequence

```
[TLS handshake]
<- 200 Welcome
-> MODE READER
<- 200
-> GROUP comp.lang.python
<- 211 <count> <first> <last> comp.lang.python
-> ARTICLE 9420
<- 220 9420 <abc123@example.com> Article follows
  From: alice@example.com
  Subject: Re: asyncio
  Date: Mon, 17 Feb 2026 10:00:00 +0000
  Message-ID: <abc123@example.com>
  X-Long-Header: first part of a very long header that
   continues on the next line with a leading space
  
  Body text here.
  .
-> QUIT
```

### Header parsing

Headers are parsed from the article content returned by `readMultiline`. The first blank line separates headers from body.

**Folded header support (RFC 5536 §3.2.7 / RFC 5322 §2.2.3):** Continuation lines (beginning with a space or horizontal tab) are detected and appended to the previous header value with a single space as separator. Multi-line headers are fully unfolded.

**Duplicate header names:** The last occurrence wins — earlier values are overwritten.

**`messageId`:** Extracted from the `220` status line's `<...>` pattern, NOT from the `Message-ID:` header field. Returned without angle brackets. Returns empty string if no angle-bracket token on the response line.

### Response

```json
{
  "success": true,
  "articleNumber": 9420,
  "messageId": "abc123@example.com",
  "headers": {
    "From": "alice@example.com",
    "Subject": "Re: asyncio",
    "Date": "Mon, 17 Feb 2026 10:00:00 +0000",
    "Message-ID": "<abc123@example.com>",
    "X-Long-Header": "first part of a very long header that continues on the next line with a leading space"
  },
  "body": "Body text here.\n"
}
```

**400** if inputs invalid.
**403** if Cloudflare-origin target.
**404** if ARTICLE returns 423 (no article with that number).
**500** on TCP/TLS error, timeout, or if group not found.

---

## `/api/nntps/list`

Lists newsgroups over TLS using one of three LIST variants.

### Request

```json
{
  "host": "news.eternal-september.org",
  "port": 563,
  "username": "user",
  "password": "pass",
  "variant": "ACTIVE",
  "timeout": 15000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | |
| `port` | number | `563` | |
| `username` | string | optional | triggers AUTHINFO if both provided |
| `password` | string | optional | |
| `variant` | `"ACTIVE"` or `"NEWSGROUPS"` or `"OVERVIEW.FMT"` | `"ACTIVE"` | |
| `timeout` | number | `15000` ms | |

### Protocol sequence

```
[TLS handshake]
<- 200 Welcome
-> AUTHINFO USER user           (only if username+password both provided)
<- 381 Password required
-> AUTHINFO PASS pass
<- 281 Authentication accepted
-> LIST ACTIVE                  (or NEWSGROUPS, OVERVIEW.FMT)
<- 215 Information follows
  ...lines...
  .
-> QUIT
```

**Note:** MODE READER is NOT sent before LIST. Some servers require MODE READER before accepting LIST and will return a non-215 response, causing a 502 error. This is a known limitation shared with the plaintext NNTP `/list` endpoint.

### Response

```json
{
  "success": true,
  "host": "news.eternal-september.org",
  "port": 563,
  "variant": "ACTIVE",
  "groupCount": 500,
  "groups": [
    { "name": "comp.lang.python", "last": 9420, "first": 1000, "flag": "y" },
    { "name": "alt.test",         "last": 50,   "first": 1,    "flag": "y" }
  ],
  "truncated": true,
  "rtt": 1240
}
```

Results are capped at **500 groups**. If the server returns more, `truncated: true`.

**ACTIVE format** (RFC 3977 §7.6.3): `<name> <last> <first> <flag>` — note `last` comes before `first` (opposite of the GROUP 211 response).

| flag | Meaning |
|------|---------|
| `y` | Posting allowed |
| `n` | Posting not allowed |
| `m` | Moderated |
| `=foo.bar` | Alias for another group |
| `x` | No local posting, transit only |

**NEWSGROUPS format:** `<name> <description>` — produces `{ name, description }` entries.

**OVERVIEW.FMT format:** Field name lines only — produces `{ name: "<field name>" }` entries. Use this to discover the tab-column layout expected by OVER responses on a specific server.

**502** if LIST returns non-215.

---

## `/api/nntps/post`

Posts a new article over TLS.

### Request

```json
{
  "host": "news.eternal-september.org",
  "port": 563,
  "username": "user",
  "password": "pass",
  "from": "user@example.com",
  "newsgroups": "alt.test",
  "subject": "Test post",
  "body": "Hello Usenet.",
  "timeout": 15000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | |
| `port` | number | `563` | |
| `username` | string | optional | |
| `password` | string | optional | |
| `from` | string | required | |
| `newsgroups` | string | required | comma-separated for crossposting |
| `subject` | string | required | |
| `body` | string | required | |
| `timeout` | number | `15000` ms | |

### Article wire format

```
From: <from>\r\n
Newsgroups: <newsgroups>\r\n
Subject: <subject>\r\n
\r\n
<dot-stuffed body>\r\n
.\r\n
```

**Dot-stuffing (RFC 3977 §3.1.1):** Lines in the body starting with `.` are prefixed with an additional `.` via `articleBody.replace(/^\./gm, '..')`. This prevents the server from interpreting body content as the end-of-article marker.

**Missing RFC 5536 required headers:** `Date:` and `Message-ID:` are not generated. Most well-configured servers inject these automatically, but strict servers will reject articles missing them with a 441 response.

**No crosspost validation:** The `newsgroups` field is passed verbatim. Cross-posting limits are enforced server-side.

### Protocol sequence

```
[TLS handshake]
<- 200 Welcome
-> AUTHINFO USER / PASS         (if credentials provided)
-> POST
<- 340 Send article to be posted
-> From: ...\r\nNewsgroups: ...\r\nSubject: ...\r\n\r\n<body>\r\n.\r\n
<- 240 Article posted
-> QUIT
```

### Response

```json
{
  "success": true,
  "host": "news.eternal-september.org",
  "port": 563,
  "articleId": "abc123@news.eternal-september.org",
  "message": "240 Article posted",
  "rtt": 820
}
```

`articleId` is extracted from the `240` response line's `<...>` pattern; `undefined` if the server does not return a message-ID on the 240 line.

**403** if server returns 440 (posting not allowed).
**502** if POST returns non-340 or article submission returns non-240.

---

## `/api/nntps/auth`

Tests AUTHINFO USER/PASS credentials without performing any other action.

### Request

```json
{
  "host": "news.eternal-september.org",
  "port": 563,
  "username": "myuser",
  "password": "mypass",
  "timeout": 10000
}
```

| Field | Type | Default |
|-------|------|---------|
| `host` | string | required |
| `port` | number | `563` |
| `username` | string | required |
| `password` | string | required |
| `timeout` | number | `10000` ms |

### Protocol sequence

```
[TLS handshake]
<- 200 Welcome
-> AUTHINFO USER myuser
<- 381 Password required
-> AUTHINFO PASS mypass
<- 281 Authentication accepted    (or 481 failed)
-> QUIT
```

### Response -- authenticated

```json
{
  "success": true,
  "host": "news.eternal-september.org",
  "port": 563,
  "authenticated": true,
  "message": "281 Authentication accepted",
  "rtt": 310
}
```

### Response -- wrong password (HTTP 200)

```json
{
  "success": true,
  "host": "news.eternal-september.org",
  "port": 563,
  "authenticated": false,
  "message": "481 Authentication failed",
  "rtt": 420
}
```

If AUTHINFO USER returns something other than `381`, the endpoint returns HTTP 200 with `authenticated: false` and the server's full response as `message`. This differs from the private `nntpsAuth()` helper used by `/list` and `/post`, which **throws** on non-381, causing those endpoints to return HTTP 500.

`authenticated: true` iff AUTHINFO PASS response starts with `281`.

---

## Authentication Details

### AUTHINFO USER/PASS (RFC 4643)

The only supported mechanism. SASL (`AUTHINFO SASL`) and `AUTHINFO GENERIC` are not implemented.

Over NNTPS (implicit TLS), credentials are always transmitted inside the TLS tunnel. This is the key security advantage of NNTPS over plaintext NNTP, where credentials travel unencrypted.

### Behaviour differences: `/auth` vs `/list` + `/post`

| Scenario | `/auth` | `/list` and `/post` |
|----------|---------|---------------------|
| AUTHINFO USER returns non-381 | HTTP 200, `authenticated: false` | HTTP 500 (exception thrown by `nntpsAuth()`) |
| AUTHINFO PASS returns non-281 | HTTP 200, `authenticated: false` | HTTP 500 (exception thrown by `nntpsAuth()`) |

---

## RFC 4642 Compliance Notes

| RFC requirement | Status |
|----------------|--------|
| TLS MUST be negotiated before any NNTP data | Compliant -- `secureTransport: 'on'` performs TLS before streams are accessible |
| Server certificate MUST be validated | Compliant -- Cloudflare Workers validate TLS certs by default |
| AUTHINFO credentials protected by TLS | Compliant -- all AUTHINFO bytes are inside TLS tunnel |
| STARTTLS command not needed for port 563 | Compliant -- STARTTLS not sent; not needed for implicit-TLS port |

---

## Response Code Reference

| Code | Command | Meaning |
|------|---------|---------|
| 101 | CAPABILITIES | Capability list follows |
| 200 | Connect / MODE READER | Posting allowed |
| 201 | Connect / MODE READER | No posting |
| 211 | GROUP | Group selected: count first last name |
| 215 | LIST | Information follows |
| 220 | ARTICLE | Article follows: number message-id |
| 224 | OVER | Overview follows |
| 240 | POST data | Article received |
| 281 | AUTHINFO PASS | Auth accepted |
| 340 | POST | Send article |
| 381 | AUTHINFO USER | Password required |
| 411 | GROUP | No such newsgroup |
| 423 | ARTICLE | No article with that number |
| 430 | ARTICLE | No article with that message-id |
| 440 | POST | Posting not allowed |
| 480 | any | Auth required before this command |
| 481 | AUTHINFO PASS | Auth failed |
| 502 | Connect | No permission / service unavailable |

---

## Known Limitations

| Limitation | Affected endpoint(s) | Detail |
|---|---|---|
| No MODE READER in /list, /post, /auth | `/list`, `/post`, `/auth` | These skip MODE READER; servers requiring it first will fail |
| 20-article cap | `/group` | Only last 20 articles fetched via OVER |
| OVER not XOVER | `/group` | Servers that only support RFC 2980 `XOVER` return silent empty result |
| Missing Date + Message-ID headers | `/post` | RFC 5536 §3.3 requires both; some strict servers reject |
| No crosspost validation | `/post` | `newsgroups` field sent verbatim |
| Duplicate header clobber | `/article` | Last `Header: value` for same field name wins |
| 500-group cap | `/list` | Results truncated at 500; `truncated: true` in response |
| 500KB multiline cap | `/group`, `/article`, `/list` | Very large responses throw `'Response too large'` |
| Underscore in group names | `/group`, `/article` | Regex rejects `_`; affects some alt.* groups |
| Single shared timeout | all | Wall-clock from handler start; slow TLS handshake eats into I/O budget |
| AUTHINFO throw vs return | `/list`, `/post` vs `/auth` | `/auth` returns HTTP 200 + `authenticated: false`; `/list`+`/post` return HTTP 500 on auth failure |
| STARTTLS not supported | all | Can only probe servers that use implicit TLS on a dedicated port |

---

## NNTPS vs NNTP Differences

| Aspect | `/api/nntp/*` | `/api/nntps/*` |
|--------|--------------|---------------|
| Transport | Plaintext TCP | Implicit TLS (`secureTransport: 'on'`) |
| Default port | `119` | `563` |
| TLS field in response | Absent | `tls: true` |
| Protocol field in /connect | Absent | `protocol: "NNTPS"` |
| Cloudflare check | No | Yes (all handlers) |
| Auth credentials security | Plaintext on wire | Always inside TLS tunnel |
| RTT in /connect | Not returned | Returned (measured after full app handshake) |

The NNTPS implementation is functionally identical to NNTP beyond the transport layer and the Cloudflare-origin guard.

---

## Test Servers

| Server | Port | Auth | Notes |
|--------|------|------|-------|
| `news.eternal-september.org` | 563 | Required (free registration) | Large group list, good retention |
| `ssl-news.free.fr` | 563 | None | French public server |
| `nntp.aioe.org` | 563 | None | International public server |

Note: NNTPS availability on public servers varies. Many still only offer plaintext port 119. Verify TLS support before testing.

---

## Quick Reference

```bash
# Connect and check TLS handshake + capabilities
curl -s -X POST https://portofcall.ross.gg/api/nntps/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"news.eternal-september.org","port":563}'

# Browse a group (newest 20 articles)
curl -s -X POST https://portofcall.ross.gg/api/nntps/group \
  -H 'Content-Type: application/json' \
  -d '{"host":"news.eternal-september.org","group":"comp.lang.python"}'

# Retrieve an article
curl -s -X POST https://portofcall.ross.gg/api/nntps/article \
  -H 'Content-Type: application/json' \
  -d '{"host":"news.eternal-september.org","group":"comp.lang.python","articleNumber":9420}'

# List newsgroups (ACTIVE, first 500)
curl -s -X POST https://portofcall.ross.gg/api/nntps/list \
  -H 'Content-Type: application/json' \
  -d '{"host":"news.eternal-september.org","variant":"ACTIVE"}'

# List with descriptions
curl -s -X POST https://portofcall.ross.gg/api/nntps/list \
  -H 'Content-Type: application/json' \
  -d '{"host":"news.eternal-september.org","variant":"NEWSGROUPS"}'

# Discover OVER field layout
curl -s -X POST https://portofcall.ross.gg/api/nntps/list \
  -H 'Content-Type: application/json' \
  -d '{"host":"news.eternal-september.org","variant":"OVERVIEW.FMT"}'

# Test authentication
curl -s -X POST https://portofcall.ross.gg/api/nntps/auth \
  -H 'Content-Type: application/json' \
  -d '{"host":"news.eternal-september.org","username":"myuser","password":"mypass"}'

# Post an article (requires auth + posting permission)
curl -s -X POST https://portofcall.ross.gg/api/nntps/post \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "news.eternal-september.org",
    "username": "myuser",
    "password": "mypass",
    "from": "myuser@example.com",
    "newsgroups": "alt.test",
    "subject": "Test post via NNTPS",
    "body": "Hello encrypted Usenet."
  }'
```

---

## Resources

- **RFC 3977** -- [Network News Transfer Protocol (NNTP)](https://tools.ietf.org/html/rfc3977)
- **RFC 4642** -- [Using Transport Layer Security (TLS) with Network News Transfer Protocol (NNTP)](https://tools.ietf.org/html/rfc4642)
- **RFC 4643** -- [Network News Transfer Protocol (NNTP) Extension for Authentication](https://tools.ietf.org/html/rfc4643)
- **RFC 5536** -- [Netnews Article Format](https://tools.ietf.org/html/rfc5536)
- **RFC 5537** -- [Netnews Architecture and Protocols](https://tools.ietf.org/html/rfc5537)
- **RFC 2980** -- [Common NNTP Extensions](https://tools.ietf.org/html/rfc2980) -- deprecated but XOVER still widely used
