# NNTP / NNTPS Reference

**Port:** 119 (NNTP), 563 (NNTPS/TLS)
**RFCs:** [3977](https://tools.ietf.org/html/rfc3977) (NNTP), [4642](https://tools.ietf.org/html/rfc4642) (STARTTLS), [4643](https://tools.ietf.org/html/rfc4643) (AUTHINFO), [5536](https://tools.ietf.org/html/rfc5536) (Article Format)
**Implementation:** `src/worker/nntp.ts`, `src/worker/nntps.ts`
**Tests:** `tests/nntp.test.ts` (14 tests)

---

## Endpoints

All endpoints are `POST`-only with JSON bodies. There is no GET form for any endpoint.

| Path | Description |
|------|-------------|
| `POST /api/nntp/connect` | Connect, send CAPABILITIES + MODE READER, return banner |
| `POST /api/nntp/group` | Select newsgroup, fetch up to 20 recent article overviews |
| `POST /api/nntp/article` | Retrieve full article (headers + body) by number |
| `POST /api/nntp/list` | List newsgroups (ACTIVE / NEWSGROUPS / OVERVIEW.FMT) |
| `POST /api/nntp/post` | Post a new article |
| `POST /api/nntp/auth` | Test AUTHINFO USER/PASS credentials |

NNTPS mirrors all six at `/api/nntps/*` with a TLS socket.

Every endpoint opens a **fresh TCP connection** per request. There is no persistent session, no cursor, and no article pointer state across calls.

---

## Shared Internals

### I/O helpers

Three module-level utilities are used by all handlers:

**`readLine(reader, decoder, buffer, timeoutPromise)`** — reads from `buffer.data` until `\r\n` appears, fetching more chunks as needed. Returns the line without the terminator. Throws `'Connection closed unexpectedly'` on EOF.

**`readMultiline(reader, decoder, buffer, timeoutPromise, maxSize=500000)`** — reads lines via `readLine` until a lone `.` appears. Applies RFC 3977 §3.1.1 dot-unstuffing: lines starting with `..` have the leading dot removed. Throws `'Response too large (max 500KB)'` if cumulative size exceeds 500 000 bytes.

**`sendCommand(writer, encoder, command)`** — appends `\r\n` and writes to the socket.

### Timeout architecture

Each handler creates a single `timeoutPromise` at the start:

```
const timeoutPromise = new Promise<never>((_, reject) => {
  setTimeout(() => reject(new Error('Connection timeout')), timeout);
});
```

This same promise is passed into **every** `readLine` and `readMultiline` call and is also raced against `socket.opened`. The timeout runs from the moment the handler starts and is **not** reset between protocol steps. On a slow server, if the first step (TCP connect + welcome) takes 8 of 10 seconds, only 2 seconds remain for all subsequent steps.

---

## `/api/nntp/connect`

Probes the server, retrieves capabilities, and sends `MODE READER`.

### Request

```json
{ "host": "news.aioe.org", "port": 119, "timeout": 10000 }
```

| Field | Type | Default |
|-------|------|---------|
| `host` | string | required |
| `port` | number | `119` |
| `timeout` | number | `10000` ms |

### Protocol sequence

```
← 200 Welcome message (or 201 = no posting)
→ CAPABILITIES
← 101 Capability list follows
  VERSION 2
  READER
  POST
  OVER
  .
→ MODE READER
← 200 (or 201) Reader mode active
→ QUIT
```

Both CAPABILITIES and MODE READER are wrapped in `try/catch` individually — if either fails, the field is left empty/empty-string rather than aborting. QUIT is also fire-and-forget.

### Response

```json
{
  "success": true,
  "welcome": "200 news.aioe.org InterNetNews server ready",
  "postingAllowed": true,
  "capabilities": ["VERSION 2", "READER", "POST", "OVER", "HDR", "LIST ACTIVE NEWSGROUPS OVERVIEW.FMT"],
  "modeReader": "200 Posting allowed"
}
```

- `postingAllowed` — `true` if welcome code was `200`, `false` if `201`
- `capabilities` — array of raw capability strings from CAPABILITIES response, or `[]` if CAPABILITIES not supported
- `modeReader` — raw MODE READER response line, or `''` if MODE READER failed

**400** if `host` is empty or `port` out of range `1–65535`.
**502** if welcome code is not 200 or 201 (server rejected connection).
**500** on TCP error or timeout.

---

## `/api/nntp/group`

Selects a newsgroup and fetches overviews for up to 20 recent articles via `OVER`.

### Request

```json
{ "host": "news.aioe.org", "port": 119, "group": "comp.lang.python", "timeout": 15000 }
```

| Field | Type | Default |
|-------|------|---------|
| `host` | string | required |
| `port` | number | `119` |
| `group` | string | required |
| `timeout` | number | `15000` ms |

**Group name validation:** `/^[a-zA-Z0-9][a-zA-Z0-9.+-]*$/` — letters, digits, dots, hyphens, `+` only. Underscores are rejected (returns 400). Some real hierarchies use underscores (e.g. `alt.fan_fiction`) and will fail this check.

### Protocol sequence

```
← 200 Welcome
→ MODE READER
← 200
→ GROUP comp.lang.python
← 211 <count> <first> <last> comp.lang.python
→ OVER <last-19>-<last>         (if count > 0)
← 224 Overview information follows
  <number>\t<subject>\t<from>\t<date>\t<message-id>\t<references>\t<bytes>\t<lines>
  .
→ QUIT
```

MODE READER is sent unconditionally (not in a try-catch), so servers that reject it will cause the handler to return 500.

The OVER range fetches `max(first, last-19)` through `last` — at most 20 articles. `XOVER` (RFC 2980) is not used; `OVER` (RFC 3977 §8.4) is the command. Some older servers only support XOVER and will return a non-224 response, in which case `articles` is silently returned as `[]` (no error).

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
  ]
}
```

`articles` is returned **newest first** (the array is `.reverse()`d after parsing OVER). Entries with fewer than 6 tab-separated OVER fields are silently dropped. The `lines` field comes from OVER field 8 (index 7); `bytes` (field 7) is not returned.

**404** if GROUP returns 411 (group not found).

---

## `/api/nntp/article`

Retrieves a full article by article number.

### Request

```json
{
  "host": "news.aioe.org",
  "port": 119,
  "group": "comp.lang.python",
  "articleNumber": 9420,
  "timeout": 15000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | |
| `port` | number | `119` | |
| `group` | string | required | same regex as /group |
| `articleNumber` | number | required | must be ≥ 1 |
| `timeout` | number | `15000` ms | |

### Protocol sequence

```
← 200 Welcome
→ MODE READER
← 200
→ GROUP comp.lang.python
← 211 <count> <first> <last> comp.lang.python
→ ARTICLE 9420
← 220 9420 <abc123@example.com> Article follows
  From: alice@example.com
  Subject: Re: asyncio question
  Date: ...
  Message-ID: <abc123@example.com>

  Body text here.
  .
→ QUIT
```

### Response

```json
{
  "success": true,
  "articleNumber": 9420,
  "messageId": "abc123@example.com",
  "headers": {
    "From": "alice@example.com",
    "Subject": "Re: asyncio question",
    "Date": "Mon, 17 Feb 2026 10:00:00 +0000",
    "Message-ID": "<abc123@example.com>",
    "Newsgroups": "comp.lang.python"
  },
  "body": "Body text here.\n"
}
```

**`messageId`** is extracted from the `220` response line's `<...>` pattern — NOT from the `Message-ID:` header. Returns empty string if no angle-bracket token on the response line.

**Header parsing caveats:**
- Duplicate header names: the last occurrence wins (earlier values overwritten)
- Folded headers (RFC 5536 §3.2.7 long-line continuation with leading whitespace): continuation lines have no `:`, so `colonIndex > 0` check fails — they are **silently dropped**
- Header splitting uses first `\n` after the join, not blank line detection. The blank-line separator scan breaks at the first `articleLines[i] === ''` (empty string after dot-unstuffing)

**404** if ARTICLE returns 423 (article not found).

---

## `/api/nntp/list`

Lists newsgroups using one of three LIST variants.

### Request

```json
{
  "host": "news.aioe.org",
  "port": 119,
  "username": "user",
  "password": "pass",
  "variant": "ACTIVE",
  "timeout": 15000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | |
| `port` | number | `119` | |
| `username` | string | optional | triggers AUTHINFO |
| `password` | string | optional | triggers AUTHINFO |
| `variant` | `"ACTIVE"` \| `"NEWSGROUPS"` \| `"OVERVIEW.FMT"` | `"ACTIVE"` | |
| `timeout` | number | `15000` ms | |

### Protocol sequence

```
← 200 Welcome
→ AUTHINFO USER user           (if username+password provided)
← 381 Password required
→ AUTHINFO PASS pass
← 281 Authentication accepted
→ LIST ACTIVE                  (or LIST NEWSGROUPS, LIST OVERVIEW.FMT)
← 215 Information follows
  <data lines>
  .
→ QUIT
```

**Note:** MODE READER is NOT sent before LIST. Some servers require MODE READER before accepting LIST; those will return a non-215 response causing a 502 error.

The handler checks the LIST response code `startsWith('215')`. All three variants return 215 per RFC 3977.

### Response

```json
{
  "success": true,
  "host": "news.aioe.org",
  "port": 119,
  "variant": "ACTIVE",
  "groupCount": 500,
  "groups": [
    { "name": "comp.lang.python", "last": 9420, "first": 1000, "flag": "y" },
    { "name": "alt.test",        "last": 50,   "first": 1,    "flag": "y" }
  ],
  "truncated": true,
  "rtt": 1240
}
```

Results are capped at **500 groups**. If the server returns more, `truncated: true`. The 500KB multiline cap would apply first on very large responses.

**ACTIVE format** — RFC 3977 §7.6.3: `<name> <last> <high> <flag>` — note `last` before `first` (opposite of the GROUP response):

| flag | Meaning |
|------|---------|
| `y` | Posting allowed |
| `n` | Posting not allowed |
| `m` | Moderated |
| `=foo.bar` | Alias for another group |
| `x` | No local posting |

**NEWSGROUPS format** — `<name> <description>` — `description` field in output.

**OVERVIEW.FMT format** — field names only; each line becomes `{ name: "<field name>" }`.

**502** if LIST returns non-215.

---

## `/api/nntp/post`

Posts a new article to a newsgroup.

### Request

```json
{
  "host": "news.aioe.org",
  "port": 119,
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
| `port` | number | `119` | |
| `username` | string | optional | |
| `password` | string | optional | |
| `from` | string | required | |
| `newsgroups` | string | required | comma-separated for crosspost |
| `subject` | string | required | |
| `body` | string | required | |
| `timeout` | number | `15000` ms | |

### Article wire format sent

```
From: <from>\r\n
Newsgroups: <newsgroups>\r\n
Subject: <subject>\r\n
\r\n
<body>\r\n
.\r\n
```

**Missing required headers:** RFC 5536 requires `Date:` and `Message-ID:` in every article. This implementation sends neither. Well-configured servers will inject these, but some reject articles missing them.

**Dot-stuffing is applied** (RFC 3977 §3.1.1): Lines in the body starting with `.` are prefixed with an additional `.` via `articleBody.replace(/^\./gm, '..')`. This prevents premature end-of-article detection.

**No crosspost validation:** The `newsgroups` field is sent verbatim.

### Response

```json
{
  "success": true,
  "host": "news.aioe.org",
  "port": 119,
  "articleId": "abc123@example.com",
  "message": "240 Article posted",
  "rtt": 820
}
```

`articleId` is extracted from the `240` response line's `<...>` pattern; `undefined` if not present.

**403** if server returns 440 (posting not allowed).
**502** if POST returns non-340.
**502** if article returns non-240.

---

## `/api/nntp/auth`

Tests AUTHINFO USER/PASS credentials without performing any other action.

### Request

```json
{
  "host": "news.eternal-september.org",
  "port": 119,
  "username": "myuser",
  "password": "mypass",
  "timeout": 10000
}
```

### Protocol sequence

```
← 200 Welcome
→ AUTHINFO USER myuser
← 381 Password required
→ AUTHINFO PASS mypass
← 281 Authentication accepted
→ QUIT
```

### Response — success

```json
{
  "success": true,
  "host": "news.eternal-september.org",
  "port": 119,
  "authenticated": true,
  "message": "281 Authentication accepted",
  "rtt": 310
}
```

### Response — wrong password (HTTP 200)

```json
{
  "success": true,
  "host": "news.eternal-september.org",
  "port": 119,
  "authenticated": false,
  "message": "481 Authentication failed",
  "rtt": 420
}
```

### Response — server doesn't ask for password (HTTP 200)

If AUTHINFO USER returns something other than `381`, the endpoint returns HTTP 200 with `authenticated: false` and the server's response as `message`. This differs from the private `nntpAuth()` helper (used internally by `/list` and `/post`) which **throws** on non-381, causing those endpoints to return 500.

`authenticated: true` iff the AUTHINFO PASS response starts with `281`.

---

## Authentication Details

AUTHINFO USER/PASS (RFC 4643) is the only supported auth mechanism. SASL (`AUTHINFO SASL`) and `AUTHINFO GENERIC` are not implemented.

The `nntpAuth()` private helper is used by `/list` and `/post` when `username` AND `password` are both provided. If either AUTHINFO step fails, `nntpAuth()` throws, causing the endpoint to return HTTP 500. Authentication is all-or-nothing per request — there is no session to re-use.

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
| 221 | HEAD | Headers follow |
| 222 | BODY | Body follows |
| 223 | STAT / NEXT / LAST | Article exists: number message-id |
| 224 | OVER | Overview follows |
| 240 | POST data | Article received |
| 281 | AUTHINFO PASS | Auth accepted |
| 340 | POST | Send article |
| 381 | AUTHINFO USER | Password required |
| 411 | GROUP | No such newsgroup |
| 423 | ARTICLE | No article with that number |
| 430 | ARTICLE | No article with that message-id |
| 440 | POST | Posting not allowed |
| 480 | any | Auth required |
| 481 | AUTHINFO PASS | Auth failed |
| 502 | Connect | No permission |

Commands not exposed as endpoints: `HEAD`, `BODY`, `STAT`, `NEXT`, `LAST`, `LISTGROUP`, `NEWNEWS`, `NEWGROUPS`, `XHDR`, `HDR`, `XOVER`, `STARTTLS`.

---

## Known Limitations

| Limitation | Affected endpoint(s) | Detail |
|---|---|---|
| No MODE READER | `/list`, `/post`, `/auth` | These send LIST/POST/AUTHINFO without MODE READER first |
| 20-article cap | `/group` | Only last 20 articles fetched via OVER |
| OVER not XOVER | `/group` | Older servers (RFC 2980) may need XOVER; silent empty result |
| Dot-stuffing applied | `/post` | RFC 3977 §3.1.1 compliant; lines starting with `.` are double-dotted |
| Missing Date+Message-ID | `/post` | RFC 5536 requires both; some servers reject |
| No folded header support | `/article` | RFC 5536 §3.2.7 continuation lines are silently dropped |
| Duplicate header clobber | `/article` | Last `Header: value` wins for same field name |
| 500-group cap | `/list` | Servers with >500 groups return truncated:true |
| 500KB multiline cap | `/group`, `/article`, `/list` | Very large responses throw |
| Underscore in group names | `/group`, `/article` | Regex rejects `_`; affects some alt.* groups |
| Single shared timeout | all | Timeout runs from handler start; slow TCP connect eats into I/O budget |
| AUTHINFO throw vs return | `/list`, `/post` vs `/auth` | `/auth` returns HTTP 200 + authenticated:false; `/list`+`/post` return 500 on auth failure |
| No NNTPS in /api/nntp/* | all | TLS requires separate /api/nntps/* endpoints |

---

## Test Servers

| Server | Auth | Notes |
|--------|------|-------|
| `news.aioe.org` | None | Used in tests; may throttle |
| `news.eternal-september.org` | Required | Free registration; large retention |
| `nntp.aioe.org` | None | Mirror of aioe |

---

## Quick Reference

```bash
# Connect + capabilities
curl -s -X POST https://portofcall.ross.gg/api/nntp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"news.aioe.org","port":119}'

# Browse a group (newest 20 articles)
curl -s -X POST https://portofcall.ross.gg/api/nntp/group \
  -H 'Content-Type: application/json' \
  -d '{"host":"news.aioe.org","group":"comp.lang.python"}'

# Retrieve an article
curl -s -X POST https://portofcall.ross.gg/api/nntp/article \
  -H 'Content-Type: application/json' \
  -d '{"host":"news.aioe.org","group":"comp.lang.python","articleNumber":9420}'

# List newsgroups with descriptions (first 500)
curl -s -X POST https://portofcall.ross.gg/api/nntp/list \
  -H 'Content-Type: application/json' \
  -d '{"host":"news.aioe.org","variant":"NEWSGROUPS"}'

# Test authentication
curl -s -X POST https://portofcall.ross.gg/api/nntp/auth \
  -H 'Content-Type: application/json' \
  -d '{"host":"news.eternal-september.org","username":"u","password":"p"}'

# Post an article (requires posting-allowed server + auth)
curl -s -X POST https://portofcall.ross.gg/api/nntp/post \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "news.eternal-september.org",
    "username": "u", "password": "p",
    "from": "u@example.com",
    "newsgroups": "alt.test",
    "subject": "Test",
    "body": "Hello."
  }'
```

---

## Resources

- **RFC 3977** — [Network News Transfer Protocol](https://tools.ietf.org/html/rfc3977)
- **RFC 4642** — [Using TLS with NNTP](https://tools.ietf.org/html/rfc4642)
- **RFC 4643** — [NNTP Extension for Authentication](https://tools.ietf.org/html/rfc4643)
- **RFC 5536** — [Netnews Article Format](https://tools.ietf.org/html/rfc5536)
- **RFC 2980** — [Common NNTP Extensions (XOVER, XHDR)](https://tools.ietf.org/html/rfc2980) — deprecated but servers still use
