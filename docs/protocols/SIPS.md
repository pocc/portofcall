# SIP / SIPS Protocol — Power-User Reference

Two workers: `src/worker/sip.ts` (plain TCP, port 5060) and `src/worker/sips.ts` (TLS, port 5061). Same four operations on each: OPTIONS probe, REGISTER probe, INVITE session initiation, and Digest authentication. Eight endpoints total.

## Endpoints

| Endpoint | Transport | Method | Purpose |
|----------|-----------|--------|---------|
| `POST /api/sip/options` | TCP | OPTIONS | Enumerate server capabilities |
| `POST /api/sip/register` | TCP | REGISTER | Discover auth requirements |
| `POST /api/sip/invite` | TCP | INVITE | Initiate session, observe response |
| `POST /api/sip/digest-auth` | TCP | REGISTER×2 | Full RFC 2617 Digest login |
| `POST /api/sips/options` | TLS | OPTIONS | Enumerate server capabilities |
| `POST /api/sips/register` | TLS | REGISTER | Discover auth requirements |
| `POST /api/sips/invite` | TLS | INVITE | Initiate session, observe response |
| `POST /api/sips/digest-auth` | TLS | REGISTER×2 | Full RFC 2617 Digest login |

No GET variants. No Cloudflare detection on any endpoint.

---

## SIP (Plain TCP) — `/api/sip/*`

### POST /api/sip/options

Sends an OPTIONS request to enumerate allowed methods, extensions, and server identity.

**Request:**
```json
{
  "host": "pbx.example.com",
  "port": 5060,
  "uri": "sip:pbx.example.com",
  "timeout": 10000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | Target hostname/IP. Regex: `/^[a-zA-Z0-9._:-]+$/` |
| `port` | number | `5060` | 1–65535 |
| `uri` | string | `sip:${host}` | Request-URI in the OPTIONS line |
| `timeout` | number | `10000` | ms; applies to both connect and read |

**Response:**
```json
{
  "success": true,
  "server": "pbx.example.com:5060",
  "statusCode": 200,
  "statusText": "OK",
  "allowedMethods": ["INVITE", "ACK", "CANCEL", "OPTIONS", "BYE", "REGISTER"],
  "supportedExtensions": ["replaces", "timer"],
  "serverAgent": "Asterisk PBX 18.12.0",
  "contentTypes": ["application/sdp"],
  "headers": [{"name": "Via", "value": "..."}, ...],
  "raw": "SIP/2.0 200 OK\r\n..."
}
```

Key fields:
- `allowedMethods` — parsed from `Allow:` header (comma-split, trimmed). `undefined` if header absent.
- `supportedExtensions` — from `Supported:` header. `undefined` if absent.
- `serverAgent` — first non-empty of `Server:` or `User-Agent:` headers.
- `contentTypes` — from `Accept:` header.
- `headers` — array of `{name, value}` objects (preserves order, allows duplicates).
- `raw` — first 5000 chars of the raw response.

**Wire exchange:**
```
OPTIONS sip:pbx.example.com SIP/2.0
Via: SIP/2.0/TCP pbx.example.com:5060;branch=z9hG4bK...
Max-Forwards: 70
From: <sip:probe@portofcall.workers.dev>;tag=...
To: <sip:pbx.example.com>
Call-ID: ...@pbx.example.com
CSeq: 1 OPTIONS
Accept: application/sdp
User-Agent: PortOfCall/1.0
Content-Length: 0
```

**Quirk — Via header uses target host:** The Via contains `${host}:${port}`, the *target* server address. Per RFC 3261, Via should contain the *sending* address. Most SIP servers ignore this for OPTIONS probes, but strict proxies may reject it.

**Quirk — From is hardcoded:** Always `sip:probe@portofcall.workers.dev`. Not configurable.

---

### POST /api/sip/register

Sends a REGISTER with `Expires: 0` (deregistration probe) to discover whether the server requires authentication without creating server-side state.

**Request:**
```json
{
  "host": "pbx.example.com",
  "port": 5060,
  "uri": "sip:example.com",
  "username": "alice",
  "domain": "example.com",
  "timeout": 10000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | TCP target. Regex: `/^[a-zA-Z0-9._:-]+$/` |
| `port` | number | `5060` | |
| `uri` | string | `sip:${domain\|host}` | Request-URI |
| `username` | string | `"probe"` | Regex: `/^[a-zA-Z0-9._@+-]+$/` |
| `domain` | string | `host` | SIP domain (From/To/Contact headers) |
| `timeout` | number | `10000` | ms |

**Response:**
```json
{
  "success": true,
  "server": "pbx.example.com:5060",
  "statusCode": 401,
  "statusText": "Unauthorized",
  "requiresAuth": true,
  "authScheme": "Digest",
  "authRealm": "asterisk",
  "serverAgent": "Asterisk PBX 18.12.0",
  "contactExpires": null,
  "headers": [{"name": "Via", "value": "..."}, ...],
  "raw": "SIP/2.0 401 Unauthorized\r\n..."
}
```

Key fields:
- `requiresAuth` — `true` if status is 401 or 407.
- `authScheme` — first word of `WWW-Authenticate` or `Proxy-Authenticate` (typically `"Digest"`).
- `authRealm` — `realm="..."` value from the challenge.
- `contactExpires` — parsed from `Contact:` header `expires=` param, or `Expires:` header. `undefined` if absent.

**Quirk — Expires: 0:** This REGISTER is a deregistration. A 200 OK means the server accepted it (possibly nothing to deregister). A 401/407 means the server requires auth even for deregistration, confirming auth is enforced.

**Quirk — raw truncation:** First 5000 chars.

---

### POST /api/sip/invite

Sends an INVITE with a minimal SDP offer (audio-only, port 0, G.711 μ-law). Collects provisional responses (1xx) until a final response (≥200), then sends CANCEL to clean up.

**Request:**
```json
{
  "host": "pbx.example.com",
  "port": 5060,
  "from": "alice",
  "to": "bob",
  "timeout": 10000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | TCP target |
| `port` | number | `5060` | |
| `from` | string | `"probe"` | From user (becomes `sip:${from}@${host}`) |
| `to` | string | `"probe"` | To user (becomes `sip:${to}@${host}`) |
| `timeout` | number | `10000` | ms, overall deadline |

**Response:**
```json
{
  "success": true,
  "server": "pbx.example.com:5060",
  "statusCode": 401,
  "statusText": "Unauthorized",
  "requiresAuth": true,
  "authScheme": "Digest",
  "serverAgent": "Asterisk PBX 18.12.0",
  "allow": "INVITE, ACK, CANCEL, OPTIONS, BYE",
  "rtt": 142,
  "raw": "SIP/2.0 401 Unauthorized\r\n...",
  "message": "INVITE 401 Unauthorized in 142ms"
}
```

**SDP offer sent:**
```
v=0
o=portofcall 0 0 IN IP4 0.0.0.0
s=Port of Call probe
c=IN IP4 0.0.0.0
t=0 0
m=audio 0 RTP/AVP 0
a=sendrecv
```

The `m=audio 0` means port 0 — no actual media will flow. Servers that validate SDP may reject this.

**Response collection:** Reads in a loop with 3s per-read sub-timeouts. Scans every line for `SIP/2.0 <code>` where code ≥ 200. Stops when a final response is found or the overall timeout expires.

**Cleanup — always CANCEL:** After collecting, the handler sends CANCEL regardless of the final status code. Per RFC 3261, CANCEL is only valid for non-final responses; for a 200 OK, the correct cleanup is ACK then BYE. This means the CANCEL may be ignored by a server that already sent 200 OK, potentially leaving a phantom dialog on the server side.

**Quirk — Via has `rport`:** The INVITE Via includes `;rport` (RFC 3581 symmetric response routing). The OPTIONS Via does not.

**Quirk — raw truncation:** First 2000 chars only (vs 5000 for OPTIONS/REGISTER).

---

### POST /api/sip/digest-auth

Full two-step RFC 2617 Digest Authentication via REGISTER:
1. Send REGISTER without credentials → 401/407 with `WWW-Authenticate: Digest ...`
2. Parse challenge (realm, nonce, algorithm, qop)
3. Compute `HA1=MD5(user:realm:pass)`, `HA2=MD5("REGISTER":uri)`, response digest
4. Send REGISTER with `Authorization:` header, CSeq incremented to 2
5. Return final status

**Request:**
```json
{
  "host": "pbx.example.com",
  "port": 5060,
  "username": "alice",
  "password": "secret123",
  "domain": "example.com",
  "timeout": 10000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | TCP target. Regex: `/^[a-zA-Z0-9._:-]+$/` |
| `port` | number | `5060` | |
| `username` | string | required | |
| `password` | string | required | Can be empty string |
| `domain` | string | `host` | SIP domain for URIs |
| `timeout` | number | `10000` | ms per step |

**Response (successful auth):**
```json
{
  "success": true,
  "authenticated": true,
  "statusCode": 200,
  "statusText": "OK",
  "challengeCode": 401,
  "realm": "asterisk",
  "nonce": "1708123456abcdef...",
  "algorithm": "MD5",
  "qop": "auth",
  "serverAgent": "Asterisk PBX 18.12.0",
  "rtt": 245
}
```

**Response (no auth required — server returns 200 to bare REGISTER):**
```json
{
  "success": true,
  "authenticated": true,
  "noAuthRequired": true,
  "statusCode": 200,
  "statusText": "OK",
  "rtt": 120
}
```

Key fields:
- `authenticated` — `true` only if final status is 200.
- `challengeCode` — 401 or 407 from the first REGISTER.
- `nonce` — truncated to 16 chars + `"..."` in output.
- `qop` — `"auth"` if server offered it, `null` otherwise.

**Digest computation details:**
- `digestUri` = `sip:${domain}` (no port, no path).
- `HA1` = `MD5(username:realm:password)`.
- `HA2` = `MD5("REGISTER":digestUri)`.
- With qop=auth: `response = MD5(HA1:nonce:00000001:cnonce:auth:HA2)`.
- Without qop: `response = MD5(HA1:nonce:HA2)`.
- `nc` hardcoded to `"00000001"`.
- `cnonce` is random 8-char base36.
- Custom pure-JS MD5 implementation (no crypto imports).

**Limitation — MD5 only.** `algorithm` field is parsed but only MD5 is computed. If the server requires MD5-sess or SHA-256 (RFC 7616), auth will fail.

**Limitation — qop=auth-int not supported.** Only `auth` is detected from the offered qop list.

**Quirk — 401 vs 407:** If challenge is 407 (Proxy-Authenticate), the response uses `Proxy-Authorization:` header. Otherwise `Authorization:`.

**Quirk — Call-ID reused:** Both REGISTER messages use the same Call-ID (correct per RFC 3261 §10.2 — same registration dialog).

**Quirk — `Expires: 60`:** Unlike the REGISTER probe endpoint which sends `Expires: 0`, digest-auth sends `Expires: 60` (1 minute). A successful auth will create a 60-second registration.

---

## SIPS (TLS) — `/api/sips/*`

Same four operations as SIP but over TLS (`secureTransport: 'on'`). The API interfaces differ from SIP in several important ways.

### POST /api/sips/options

**Request:**
```json
{
  "host": "sip.example.com",
  "port": 5061,
  "method": "OPTIONS",
  "fromUri": "sips:alice@example.com",
  "toUri": "sips:bob@example.com",
  "timeout": 15000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | No regex validation (unlike SIP) |
| `port` | number | `5061` | |
| `fromUri` | string | **required** | Full SIP URI (e.g., `sips:alice@example.com`) |
| `toUri` | string | `sips:${host}` | Request-URI and To header |
| `timeout` | number | `15000` | ms (5s longer default than SIP) |

**Response:**
```json
{
  "success": true,
  "host": "sip.example.com",
  "port": 5061,
  "statusCode": 200,
  "statusText": "OK",
  "headers": {
    "Via": "SIP/2.0/TLS ...",
    "Allow": "INVITE, ACK, CANCEL, OPTIONS, BYE",
    "Server": "Kamailio 5.7.0"
  },
  "callId": "abc123def456@portofcall",
  "rtt": 312
}
```

**Differences from SIP OPTIONS:**

| | SIP `/api/sip/options` | SIPS `/api/sips/options` |
|---|---|---|
| `fromUri` | Not accepted; hardcoded to `probe@portofcall.workers.dev` | **Required** |
| Headers format | `SipHeader[]` array of `{name, value}` | `Record<string, string>` — **duplicate headers overwrite** |
| Success criteria | Any parseable response | Status 2xx only |
| Parsed fields | `allowedMethods`, `supportedExtensions`, `serverAgent`, `contentTypes` | None — raw headers object only |
| `callId` in response | Not returned | Returned |
| `raw` in response | First 5000 chars | Not returned |
| Response cap | 100 KB | 16 KB |
| Via local address | `${host}:${port}` (target address) | `portofcall.invalid:5061` |

**Quirk — `method` field:** The request body type declares `method: 'OPTIONS' | 'REGISTER' | 'INVITE'` but the handler ignores it — always sends OPTIONS.

**Quirk — duplicate header loss:** SIPS uses `Record<string, string>` for headers. If the server sends multiple `Via:` headers (common in SIP), only the last one appears.

---

### POST /api/sips/register

**Request:**
```json
{
  "host": "sip.example.com",
  "port": 5061,
  "method": "REGISTER",
  "fromUri": "sips:alice@example.com",
  "timeout": 15000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | |
| `fromUri` | string | required | Used for From, To, and Contact |
| `port` | number | `5061` | |
| `timeout` | number | `15000` | ms |

**Response:** Same shape as SIPS OPTIONS (headers as `Record<string, string>`).

**Quirk — `username` and `password` ignored:** The request type includes these fields, but the handler destructures them as `_username` and `_password` (prefixed with underscore — explicitly unused). Only the initial unauthenticated REGISTER is sent.

**Quirk — `Expires: 3600`:** SIPS REGISTER sends `Expires: 3600` (1 hour). This is a real registration attempt, unlike SIP's `Expires: 0` deregistration probe. A 200 OK from the server means you are registered for 1 hour.

**Quirk — no auth detection:** Unlike SIP REGISTER which parses `requiresAuth`, `authScheme`, `authRealm`, and `contactExpires`, SIPS REGISTER returns only `success`, `statusCode`, `headers`, and `callId`. You must inspect `headers["WWW-Authenticate"]` yourself.

**Quirk — Content-Length body reading:** SIPS REGISTER stops reading at `\r\n\r\n` without checking `Content-Length`. If the server sends a response body, it will be silently dropped.

---

### POST /api/sips/invite

**Request:**
```json
{
  "host": "sip.example.com",
  "port": 5061,
  "method": "INVITE",
  "fromUri": "sips:alice@example.com",
  "toUri": "sips:bob@example.com",
  "timeout": 15000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | |
| `fromUri` | string | required | |
| `toUri` | string | `sips:${host}` | |
| `timeout` | number | `15000` | ms |

**Response:**
```json
{
  "success": true,
  "host": "sip.example.com",
  "port": 5061,
  "statusCode": 401,
  "statusText": "Unauthorized",
  "requiresAuth": true,
  "rtt": 290,
  "message": "INVITE 401 Unauthorized in 290ms",
  "raw": "SIP/2.0 401 Unauthorized\r\n..."
}
```

**Sends same minimal SDP** as SIP INVITE (audio port 0, G.711 μ-law, sendrecv).

**Cleanup — CANCEL via `encodeSipsRequest`:** The CANCEL is built using the generic helper, which doesn't include `Content-Type`, `Contact`, or SDP body. This is correct for CANCEL.

**Quirk — different from SIP INVITE interface:** SIP uses `from`/`to` (plain usernames). SIPS uses `fromUri`/`toUri` (full SIP URIs). They are not interchangeable.

---

### POST /api/sips/digest-auth

Identical two-step Digest flow as SIP, but over TLS.

**Request:**
```json
{
  "host": "sip.example.com",
  "port": 5061,
  "username": "alice",
  "password": "secret123",
  "domain": "example.com",
  "timeout": 15000
}
```

Same fields as SIP digest-auth. Same defaults except `port=5061` and `timeout=15000`.

**Response:** Same shape as SIP digest-auth.

**Quirk — digestUri uses `sip:` not `sips:`:** The HA2 computation uses `REGISTER:sip:${domain}` (note: `sip:` scheme, not `sips:`). Strict servers that expect the SIPS URI in the digest computation will reject the auth.

**Quirk — WWW-Authenticate header lookup:** SIPS headers are stored as `Record<string, string>`, so the handler looks up both `www-authenticate` (lowercase) and `WWW-Authenticate` (original case). If the server sends it in mixed case (e.g., `Www-Authenticate`), neither match and the challenge is missed.

---

## API Differences Summary

| Aspect | SIP (`sip.ts`) | SIPS (`sips.ts`) |
|--------|---------------|-----------------|
| Default port | 5060 | 5061 |
| Default timeout | 10,000 ms | 15,000 ms |
| Transport | Plain TCP | TLS (`secureTransport: 'on'`) |
| Via transport | `SIP/2.0/TCP` | `SIP/2.0/TLS` |
| Via local address | `${host}:${port}` (target) | `portofcall.invalid:5061` |
| OPTIONS `fromUri` | Hardcoded (not configurable) | **Required** param |
| Headers format | `{name, value}[]` array | `Record<string, string>` |
| Response size cap | 100 KB | 16 KB |
| REGISTER Expires | `0` (deregistration) | `3600` (1-hour registration) |
| REGISTER auth fields | Parsed (`requiresAuth`, `authScheme`, etc.) | Not parsed (raw headers only) |
| Host validation | Regex enforced | No regex |
| Call-ID domain | `@${host}` | `@portofcall` |
| Tag length | 8 chars | 9 chars |

---

## Transaction Identifiers

Both workers generate RFC 3261-compliant transaction identifiers:

- **Branch:** `z9hG4bK` magic cookie + random base36. RFC 3261 §8.1.1.7 requires this prefix for compliant implementations.
- **Call-ID:** Random base36 + `@` + domain. SIP uses target host, SIPS uses `portofcall`.
- **Tag:** Random base36. SIP: 8 chars. SIPS: 9 chars.
- **CSeq:** Always starts at 1. Digest-auth increments to 2 for the authenticated REGISTER.

---

## Known Limitations

1. **MD5 only** — Digest auth implements only MD5. No MD5-sess, no SHA-256/SHA-512-256 (RFC 7616).
2. **qop=auth only** — `auth-int` (integrity protection over message body) is not supported.
3. **No STARTTLS** — SIP has no TLS upgrade; SIPS starts with TLS. There is no way to upgrade a SIP connection.
4. **No UDP** — Both workers use TCP only. SIP is commonly deployed over UDP (port 5060) which is not supported by Cloudflare Workers' `connect()`.
5. **No host key / cert verification control** — TLS certificate validation is entirely handled by the Workers runtime. No way to accept self-signed certs.
6. **INVITE cleanup is always CANCEL** — Should be ACK+BYE for 200 OK responses (RFC 3261 §13.2.2.4).
7. **Single-read response for most endpoints** — OPTIONS and REGISTER read until `\r\n\r\n` then stop. Multi-part responses or pipelined messages will be truncated.
8. **SIPS headers lose duplicates** — `Record<string, string>` silently discards earlier values when a header appears multiple times (common for Via, Record-Route).
9. **No compact header form** — The parser doesn't recognize RFC 3261 compact forms (e.g., `v:` for `Via:`, `f:` for `From:`, `t:` for `To:`).
10. **No Cloudflare detection** — Neither SIP nor SIPS checks if the target resolves to Cloudflare.

---

## curl Examples

```bash
# SIP OPTIONS probe
curl -s -X POST https://portofcall.ross.gg/api/sip/options \
  -H 'Content-Type: application/json' \
  -d '{"host":"pbx.example.com"}' | jq .

# SIP REGISTER auth probe
curl -s -X POST https://portofcall.ross.gg/api/sip/register \
  -H 'Content-Type: application/json' \
  -d '{"host":"pbx.example.com","username":"alice","domain":"example.com"}' | jq .

# SIP INVITE session probe
curl -s -X POST https://portofcall.ross.gg/api/sip/invite \
  -H 'Content-Type: application/json' \
  -d '{"host":"pbx.example.com","from":"alice","to":"bob"}' | jq .

# SIP Digest Authentication
curl -s -X POST https://portofcall.ross.gg/api/sip/digest-auth \
  -H 'Content-Type: application/json' \
  -d '{"host":"pbx.example.com","username":"alice","password":"secret","domain":"example.com"}' | jq .

# SIPS OPTIONS (TLS) — note: fromUri is required
curl -s -X POST https://portofcall.ross.gg/api/sips/options \
  -H 'Content-Type: application/json' \
  -d '{"host":"sip.example.com","fromUri":"sips:probe@example.com"}' | jq .

# SIPS Digest Auth (TLS)
curl -s -X POST https://portofcall.ross.gg/api/sips/digest-auth \
  -H 'Content-Type: application/json' \
  -d '{"host":"sip.example.com","username":"alice","password":"secret"}' | jq .
```

---

## Wire Format Reference

```
Request:  <METHOD> <Request-URI> SIP/2.0\r\n<headers>\r\n\r\n[body]
Response: SIP/2.0 <status-code> <reason>\r\n<headers>\r\n\r\n[body]
```

Common status codes encountered:
| Code | Meaning | When |
|------|---------|------|
| 100 | Trying | Server received INVITE, processing |
| 180 | Ringing | Remote endpoint is ringing |
| 200 | OK | Success (capabilities, registered, call answered) |
| 401 | Unauthorized | Server requires Digest auth (WWW-Authenticate) |
| 403 | Forbidden | Auth credentials rejected or registration denied |
| 404 | Not Found | Unknown user or domain |
| 407 | Proxy Auth Required | Proxy requires Digest auth (Proxy-Authenticate) |
| 408 | Request Timeout | Server gave up waiting |
| 486 | Busy Here | Callee is busy |
| 503 | Service Unavailable | Server overloaded or maintenance |
