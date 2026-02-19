# SIP (Session Initiation Protocol) — Power User Reference

**Port:** 5060 (default) | **Protocol:** RFC 3261 | **Transport:** TCP | **Status:** Deployed

Port of Call provides four SIP endpoints: OPTIONS (capability probe), REGISTER (auth probe), INVITE (session initiation), and Digest Auth (authenticated registration). All use TCP transport with HTTP-like text-based request/response format.

---

## API Endpoints

### `POST /api/sip/options` — Server capability probe

Sends an OPTIONS request to query server capabilities. This is the recommended first probe for SIP servers — it's non-invasive and reveals supported methods and extensions without triggering authentication challenges.

**POST body:**
```json
{
  "host": "sip.example.com",
  "port": 5060,
  "uri": "sip:sip.example.com",
  "timeout": 10000
}
```

| Field     | Type   | Default | Notes |
|-----------|--------|---------|-------|
| `host`    | string | —       | Required. Hostname or IP (alphanumeric, dots, colons, hyphens) |
| `port`    | number | `5060`  | Port range: 1-65535 |
| `uri`     | string | `sip:{host}` | Request-URI (e.g. `sip:asterisk.local`) |
| `timeout` | number | `10000` | Total timeout in ms (1000-300000) |

**Success (200):**
```json
{
  "success": true,
  "server": "sip.example.com:5060",
  "statusCode": 200,
  "statusText": "OK",
  "allowedMethods": ["INVITE", "ACK", "BYE", "CANCEL", "OPTIONS", "REGISTER"],
  "supportedExtensions": ["replaces", "timer"],
  "serverAgent": "Asterisk PBX 18.12.0",
  "contentTypes": ["application/sdp"],
  "headers": [
    { "name": "Via", "value": "SIP/2.0/TCP sip.example.com:5060;branch=z9hG4bKabc123" },
    { "name": "Allow", "value": "INVITE, ACK, BYE, CANCEL, OPTIONS, REGISTER" }
  ],
  "raw": "SIP/2.0 200 OK\r\nVia: SIP/2.0/TCP..."
}
```

**Error (500):** `{ "success": false, "server": "", "error": "Connection timeout" }`

**Parse failure (200):** `{ "success": false, "server": "sip.example.com:5060", "raw": "...", "error": "Failed to parse SIP response" }`

**Field notes:**
- `allowedMethods` — parsed from `Allow` header (comma-separated). Common methods: INVITE, ACK, BYE, CANCEL, OPTIONS, REGISTER, INFO, SUBSCRIBE, NOTIFY, REFER, MESSAGE, UPDATE, PRACK.
- `supportedExtensions` — parsed from `Supported` header (comma-separated). Common extensions: replaces, timer, path, gruu, outbound, 100rel.
- `serverAgent` — extracted from `Server` or `User-Agent` header.
- `contentTypes` — parsed from `Accept` header (comma-separated).
- `raw` — truncated to 5000 characters.

**Request wire format:**
```
OPTIONS sip:sip.example.com SIP/2.0
Via: SIP/2.0/TCP sip.example.com:5060;branch=z9hG4bKabc123;rport
Max-Forwards: 70
From: <sip:probe@portofcall.workers.dev>;tag=abc123
To: <sip:sip.example.com>
Contact: <sip:probe@portofcall.workers.dev>
Call-ID: abc123@sip.example.com
CSeq: 1 OPTIONS
Accept: application/sdp
User-Agent: PortOfCall/1.0
Content-Length: 0

```

**curl example:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/sip/options \
  -H 'Content-Type: application/json' \
  -d '{"host":"sip.example.com","port":5060}' | jq
```

---

### `POST /api/sip/register` — Registration and auth probe

Sends a REGISTER request with `Expires: 0` (unregister). This probes authentication requirements without actually registering a binding. Most SIP servers respond with 401/407 challenges.

**POST body:**
```json
{
  "host": "sip.example.com",
  "port": 5060,
  "username": "1001",
  "domain": "example.com",
  "uri": "sip:example.com",
  "timeout": 10000
}
```

| Field      | Type   | Default | Notes |
|------------|--------|---------|-------|
| `host`     | string | —       | Required. TCP connection target |
| `port`     | number | `5060`  | Port range: 1-65535 |
| `username` | string | `"probe"` | Alphanumeric + `._@+-` |
| `domain`   | string | `host`  | SIP domain for From/To URIs |
| `uri`      | string | `sip:{domain}` | Request-URI |
| `timeout`  | number | `10000` | Total timeout in ms (1000-300000) |

**Success with auth challenge (200):**
```json
{
  "success": true,
  "server": "sip.example.com:5060",
  "statusCode": 401,
  "statusText": "Unauthorized",
  "requiresAuth": true,
  "authScheme": "Digest",
  "authRealm": "asterisk",
  "serverAgent": "Asterisk PBX 18.12.0",
  "contactExpires": 3600,
  "headers": [...],
  "raw": "SIP/2.0 401 Unauthorized\r\n..."
}
```

**Success without auth (200):**
```json
{
  "success": true,
  "server": "sip.example.com:5060",
  "statusCode": 200,
  "statusText": "OK",
  "requiresAuth": false,
  "contactExpires": 0,
  ...
}
```

**Field notes:**
- `requiresAuth` — `true` if statusCode is 401 or 407.
- `authScheme` — extracted from `WWW-Authenticate` or `Proxy-Authenticate` header (typically `Digest`).
- `authRealm` — realm parameter from auth header.
- `contactExpires` — parsed from `Contact` header `expires=` parameter or `Expires` header.

**Request wire format:**
```
REGISTER sip:example.com SIP/2.0
Via: SIP/2.0/TCP sip.example.com:5060;branch=z9hG4bKabc123;rport
Max-Forwards: 70
From: <sip:1001@example.com>;tag=abc123
To: <sip:1001@example.com>
Call-ID: abc123@sip.example.com
CSeq: 1 REGISTER
Contact: <sip:1001@portofcall.workers.dev>
Expires: 0
User-Agent: PortOfCall/1.0
Content-Length: 0

```

**Common response codes:**
- 200 OK — registration accepted (rare without auth)
- 401 Unauthorized — requires `Authorization` header with Digest credentials
- 407 Proxy Authentication Required — requires `Proxy-Authorization` header
- 403 Forbidden — registration not allowed
- 404 Not Found — domain not served
- 423 Interval Too Brief — Expires value too small

---

### `POST /api/sip/invite` — Session initiation probe

Sends an INVITE with minimal SDP offer, waits for response(s), and performs proper RFC 3261 cleanup (ACK + BYE for 2xx, ACK for non-2xx, CANCEL for timeout). If credentials are provided and a 401/407 challenge is received, automatically sends authenticated re-INVITE.

**POST body:**
```json
{
  "host": "sip.example.com",
  "port": 5060,
  "from": "probe",
  "to": "1001",
  "username": "probe",
  "password": "secret",
  "timeout": 10000
}
```

| Field      | Type   | Default | Notes |
|------------|--------|---------|-------|
| `host`     | string | —       | Required |
| `port`     | number | `5060`  | |
| `from`     | string | `"probe"` | From user part (e.g. `sip:probe@example.com`) |
| `to`       | string | `"probe"` | To user part (e.g. `sip:1001@example.com`) |
| `username` | string | —       | Optional. For Digest auth if 401/407 received |
| `password` | string | —       | Optional. For Digest auth |
| `timeout`  | number | `10000` | Total timeout in ms |

**Success response (200):**
```json
{
  "success": true,
  "server": "sip.example.com:5060",
  "statusCode": 200,
  "statusText": "OK",
  "requiresAuth": false,
  "serverAgent": "Asterisk PBX 18.12.0",
  "allow": "INVITE, ACK, BYE, CANCEL, OPTIONS",
  "rtt": 245,
  "message": "INVITE 200 OK in 245ms",
  "raw": "SIP/2.0 100 Trying\r\n...\r\nSIP/2.0 200 OK\r\n..."
}
```

**Auth challenge with re-INVITE (200):**
```json
{
  "success": true,
  "server": "sip.example.com:5060",
  "statusCode": 401,
  "statusText": "Unauthorized",
  "requiresAuth": true,
  "authScheme": "Digest",
  "auth": {
    "authenticated": true,
    "authStatusCode": 200,
    "authStatusText": "OK",
    "realm": "asterisk",
    "algorithm": "MD5"
  },
  "rtt": 512,
  "message": "INVITE 401 Unauthorized in 512ms"
}
```

**Provisional responses:**
The implementation collects all responses until a final (>=200) response is received. Common flow:
1. `100 Trying`
2. `180 Ringing`
3. `200 OK` (final)

The `raw` field contains all concatenated responses. The `statusCode` reflects the final response.

**Cleanup behavior (RFC 3261 compliance):**
- **No final response** (timeout after 1xx only): sends `CANCEL` to abort pending transaction
- **2xx response**: sends `ACK` to establish dialog, then `BYE` to tear it down
- **Non-2xx final** (3xx-6xx): sends `ACK` with same branch ID to complete transaction
- **401/407 with credentials**: sends `ACK`, then authenticated re-INVITE with Digest header

**SDP offer included:**
```
v=0
o=portofcall 0 0 IN IP4 0.0.0.0
s=Port of Call probe
c=IN IP4 0.0.0.0
t=0 0
m=audio 0 RTP/AVP 0
a=sendrecv
```

This is a minimal valid SDP (Session Description Protocol) offer with a single audio media line using PCMU codec (RTP payload type 0). The port is 0 (no media expected).

---

### `POST /api/sip/digest-auth` — Authenticated REGISTER

Two-step flow: sends unauthenticated REGISTER → receives 401/407 challenge → computes MD5 digest response → sends authenticated REGISTER.

**POST body:**
```json
{
  "host": "sip.example.com",
  "port": 5060,
  "username": "1001",
  "password": "secret",
  "domain": "example.com",
  "timeout": 10000
}
```

| Field      | Type   | Default | Notes |
|------------|--------|---------|-------|
| `host`     | string | —       | Required |
| `port`     | number | `5060`  | |
| `username` | string | —       | Required |
| `password` | string | —       | Required (can be empty string) |
| `domain`   | string | `host`  | SIP domain |
| `timeout`  | number | `10000` | Total timeout in ms (1000-300000) |

**Success (200):**
```json
{
  "success": true,
  "authenticated": true,
  "statusCode": 200,
  "statusText": "OK",
  "challengeCode": 401,
  "realm": "asterisk",
  "nonce": "a1b2c3d4e5f6g7h8...",
  "algorithm": "MD5",
  "qop": "auth",
  "serverAgent": "Asterisk PBX 18.12.0",
  "rtt": 189
}
```

**Auth failure (200):**
```json
{
  "success": true,
  "authenticated": false,
  "statusCode": 403,
  "statusText": "Forbidden",
  "challengeCode": 401,
  "realm": "asterisk",
  "algorithm": "MD5",
  "qop": null,
  "rtt": 156
}
```

**No auth required (200):**
```json
{
  "success": true,
  "authenticated": true,
  "noAuthRequired": true,
  "statusCode": 200,
  "statusText": "OK",
  "rtt": 78
}
```

**Field notes:**
- `challengeCode` — status code of initial challenge (401 or 407).
- `nonce` — truncated to 16 characters with `...` suffix if longer.
- `algorithm` — defaults to MD5 if not specified in challenge. Supports MD5 only.
- `qop` — Quality of Protection. If server offers `qop="auth"`, the implementation uses it. Otherwise, legacy digest (no qop).

**Digest computation (RFC 2617):**
```
HA1 = MD5(username:realm:password)
HA2 = MD5(REGISTER:sip:domain)

if qop == 'auth':
  response = MD5(HA1:nonce:00000001:cnonce:auth:HA2)
else:
  response = MD5(HA1:nonce:HA2)
```

The `nc` (nonce count) is hardcoded to `00000001` (first use of nonce).

**Authorization header example:**
```
Authorization: Digest username="1001", realm="asterisk", nonce="abc123", uri="sip:example.com", algorithm=MD5, response="a1b2c3d4...", qop=auth, nc=00000001, cnonce="xyz789"
```

**curl example:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/sip/digest-auth \
  -H 'Content-Type: application/json' \
  -d '{"host":"sip.example.com","username":"1001","password":"secret"}' | jq
```

---

## Wire Protocol Reference

### Request Format

All SIP requests follow this structure:
```
<METHOD> <Request-URI> SIP/2.0
<Header>: <Value>
...
Content-Length: <N>

[Message Body (N bytes)]
```

**Required headers (RFC 3261 §8.1.1):**
- `Via` — transport info with branch parameter (RFC 3261 §20.42). Format: `SIP/2.0/TCP host:port;branch=z9hG4bK{random};rport`
- `From` — caller URI with tag parameter. Format: `<sip:user@domain>;tag={random}`
- `To` — callee URI. Format: `<sip:user@domain>` (no tag in requests; server adds tag in responses)
- `Call-ID` — unique dialog identifier. Format: `{random}@{host}`
- `CSeq` — sequence number + method. Format: `1 OPTIONS` (increments for each transaction)
- `Max-Forwards` — hop limit (70 is standard initial value)
- `Content-Length` — byte count of message body (0 for most probes)

**Common optional headers:**
- `Contact` — URI for future requests (used in REGISTER, INVITE). Format: `<sip:user@host>`
- `User-Agent` — client identifier. Port of Call uses `PortOfCall/1.0`
- `Accept` — supported content types (e.g. `application/sdp`)
- `Expires` — registration duration in seconds (0 = unregister)

### Response Format

```
SIP/2.0 <Status-Code> <Reason-Phrase>
<Header>: <Value>
...
Content-Length: <N>

[Message Body]
```

**Status code classes:**
- **1xx** — Provisional (non-final). Examples: 100 Trying, 180 Ringing, 183 Session Progress
- **2xx** — Success. Example: 200 OK
- **3xx** — Redirection. Examples: 301 Moved Permanently, 302 Moved Temporarily
- **4xx** — Client error. Examples: 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 407 Proxy Authentication Required, 408 Request Timeout, 486 Busy Here, 487 Request Terminated
- **5xx** — Server error. Examples: 500 Server Internal Error, 503 Service Unavailable, 504 Server Timeout
- **6xx** — Global failure. Examples: 600 Busy Everywhere, 603 Decline, 604 Does Not Exist Anywhere

### Branch Parameter (RFC 3261 §8.1.1.7)

The `branch` parameter in the `Via` header uniquely identifies a transaction. Port of Call uses the magic cookie prefix `z9hG4bK` (required by RFC 3261) followed by a random string:
```
Via: SIP/2.0/TCP sip.example.com:5060;branch=z9hG4bKabc123;rport
```

The `rport` parameter (RFC 3581) enables symmetric response routing through NATs.

### Tag Parameters

Tags identify dialogs and prevent request forgery:
- **From tag** — generated by UAC (User Agent Client) and included in all requests
- **To tag** — generated by UAS (User Agent Server) in responses, must be echoed in subsequent requests

Example flow:
```
Request:  From: <sip:alice@example.com>;tag=abc123
          To: <sip:bob@example.com>

Response: From: <sip:alice@example.com>;tag=abc123
          To: <sip:bob@example.com>;tag=def456

Followup: From: <sip:alice@example.com>;tag=abc123
          To: <sip:bob@example.com>;tag=def456
```

---

## Known Limitations and Quirks

### 1. TCP-only transport

The implementation uses `SIP/2.0/TCP` exclusively. UDP (more common for SIP) and TLS (SIPS) are not supported. Most modern SIP servers support TCP on port 5060.

**Impact:** Cannot probe UDP-only SIP servers (rare in 2026 but still exist in legacy VoIP deployments).

### 2. No multi-byte UTF-8 in response body byte counting

The `readSipResponse()` function converts accumulated bytes to text on each chunk, then compares `fullText.length - headerEnd` against `Content-Length`. This works correctly because:
- Header end position is calculated in the decoded string
- Byte count comparison uses `totalBytes - headerBytes` where `headerBytes` is re-encoded

This was fixed in the current review. Previously, the comparison was `bodyReceived = fullText.length - headerEnd` which would fail if the SDP body contained multi-byte UTF-8 characters (rare but legal per RFC 3261 §20.3).

### 3. No INVITE media handling

The INVITE endpoint sends a minimal SDP offer with `m=audio 0 RTP/AVP 0` (port 0 means no media). It immediately tears down the session with BYE after receiving 200 OK. No RTP media is sent or received.

**Impact:** Cannot test actual audio/video media flow. Only tests SIP signaling layer.

### 4. No DNS SRV lookup

The implementation connects directly to `host:port`. It does not perform DNS SRV lookups for `_sip._tcp.example.com` records per RFC 3263.

**Impact:** Cannot auto-discover SIP servers from domain names. Users must provide explicit host/port.

### 5. Hardcoded User-Agent and From domain

All requests use:
- `User-Agent: PortOfCall/1.0`
- `From: <sip:probe@portofcall.workers.dev>`
- `Contact: <sip:{username}@portofcall.workers.dev>`

**Impact:** Some SIP servers may reject or challenge requests from unknown domains. Most accept any From domain for OPTIONS/REGISTER probes.

### 6. No TLS/SIPS support

The implementation does not support SIPS (SIP over TLS) on port 5061. This would require the `cloudflare:sockets` `secureTransport: 'starttls'` option, which SIP does not use (SIPS is implicit TLS, not STARTTLS).

**Impact:** Cannot probe encrypted SIP servers. Credentials sent via Digest auth are hashed but not encrypted on the wire.

### 7. Single timeout for entire transaction

The `timeout` parameter applies to the entire transaction (connect + send + receive), not per-operation. For INVITE, this includes waiting for provisional responses (100, 180) before a final response.

**Impact:** Long-ringing INVITEs may timeout even if the server is responding with 180 Ringing every few seconds.

### 8. No automatic re-transmission

SIP over UDP requires client-side retransmission of requests (RFC 3261 §17.1.1). TCP does not require this, but the implementation also doesn't handle ICMP/TCP-level retries. The socket connect and read operations rely on Cloudflare Workers' default TCP behavior.

**Impact:** Transient network issues may cause false negatives.

### 9. Minimal SDP validation

The INVITE endpoint includes a hardcoded SDP offer with:
- Version 0
- Origin `o=portofcall 0 0 IN IP4 0.0.0.0` (invalid IP per RFC 4566, but widely accepted)
- Connection `c=IN IP4 0.0.0.0`
- Media `m=audio 0 RTP/AVP 0` (port 0)

Some strict SIP servers may reject this as malformed.

### 10. No PRACK or UPDATE support

The implementation does not send PRACK (RFC 3262) to acknowledge reliable provisional responses (e.g. `183 Session Progress` with `Require: 100rel`). It also doesn't send UPDATE (RFC 3311) to modify sessions.

**Impact:** Cannot fully probe servers that require 100rel or UPDATE.

### 11. No SIP-ISUP or SIP-I interworking

The implementation does not handle ISUP (ISDN User Part) encapsulation in SIP for PSTN gateway scenarios.

### 12. OPTIONS lacks Supported header

The OPTIONS request does not include a `Supported:` header listing client-supported extensions. Servers may assume minimal capability.

**Impact:** Server may not advertise certain extensions in `Supported:` response header.

### 13. INVITE cleanup uses best-effort

The ACK and BYE cleanup requests are wrapped in `try { ... } catch { /* ignore */ }` blocks. If these fail (network error, server closed socket), the error is silently ignored.

**Impact:** May leave server-side dialog state lingering (but most servers have dialog timeout timers that will clean up after 30-60 seconds).

### 14. No early-media or forking support

The implementation assumes a single final response per INVITE. It does not handle:
- **Early media** — 183 Session Progress with SDP answer
- **Forking** — multiple 2xx responses from different endpoints

**Impact:** In forking scenarios, the implementation ACKs only the first 2xx and BYEs it. Other 2xx responses are ignored, leaving dialogs half-open.

### 15. No realm-specific HA1 caching

Each call to `handleSIPDigestAuth` or INVITE re-INVITE computes HA1 from scratch. For repeated probes with the same credentials, this is redundant.

**Impact:** Minor performance overhead (MD5 is fast). No security impact.

### 16. Via header uses received host:port

The Via header sent is:
```
Via: SIP/2.0/TCP {host}:{port};branch=z9hG4bK{random};rport
```

RFC 3261 §18.1.1 says the Via should contain the client's own IP/port, not the server's. However, in a Cloudflare Worker context, the client IP is ephemeral and unknown. Using the server's address is non-standard but works in practice because `rport` triggers symmetric response routing.

**Impact:** Some strict SIP proxies may reject or warn about Via header mismatch.

### 17. No Retry-After handling

If the server responds with 503 Service Unavailable with a `Retry-After` header, the implementation does not parse or expose this.

### 18. No Record-Route / Route handling

For mid-dialog requests (ACK, BYE after INVITE 200), the implementation does not copy `Record-Route` headers into `Route` headers per RFC 3261 §12.1.2.

**Impact:** In proxy scenarios, the BYE may not reach the UAS (User Agent Server) if the route set is required.

### 19. Content-Length validation is basic

The response parser validates `Content-Length >= 0 && <= MAX_RESPONSE_SIZE` but does not check for negative values encoded as large unsigned integers (e.g. `Content-Length: -1` parsed as 4294967295).

**Fixed in this review:** Added explicit check for `contentLength < 0`.

### 20. No multipart MIME support

If a response has `Content-Type: multipart/mixed` with multiple SDP or ISUP parts, the body is read as a single blob. No MIME boundary parsing.

---

## Common SIP Server Behaviors

### Asterisk (Open Source PBX)

**Default port:** 5060 TCP+UDP
**User-Agent:** `Asterisk PBX {version}`

OPTIONS response:
```
SIP/2.0 200 OK
Via: SIP/2.0/TCP asterisk.local:5060;branch=z9hG4bKabc123;rport
From: <sip:probe@portofcall.workers.dev>;tag=abc123
To: <sip:asterisk.local>;tag=as7f8a9b0c
Call-ID: abc123@asterisk.local
CSeq: 1 OPTIONS
Server: Asterisk PBX 18.12.0
Allow: INVITE, ACK, CANCEL, OPTIONS, BYE, REFER, SUBSCRIBE, NOTIFY, INFO, PUBLISH, MESSAGE
Supported: replaces, timer
Accept: application/sdp
Content-Length: 0
```

REGISTER challenge:
```
SIP/2.0 401 Unauthorized
WWW-Authenticate: Digest algorithm=MD5, realm="asterisk", nonce="abc123"
```

**Notes:**
- Asterisk always challenges REGISTER with 401, even for `Expires: 0` unregistrations
- Supports `qop=auth` in most versions
- Accepts TCP on port 5060 by default (configurable in `sip.conf`)

### FreeSWITCH

**Default port:** 5060 TCP+UDP, 5061 TLS
**User-Agent:** `FreeSWITCH-mod_sofia/{version}`

OPTIONS response:
```
Allow: INVITE, ACK, BYE, CANCEL, OPTIONS, MESSAGE, INFO, UPDATE, REGISTER, REFER, NOTIFY, PUBLISH, SUBSCRIBE
Supported: timer, path, replaces
```

REGISTER challenge:
```
WWW-Authenticate: Digest realm="freeswitch", nonce="abc123", algorithm=MD5, qop="auth"
```

**Notes:**
- FreeSWITCH includes `qop="auth"` by default
- Supports path extension for registrar forwarding
- May respond to OPTIONS from unknown IPs based on ACL rules

### Kamailio (SIP Proxy)

**Default port:** 5060 TCP+UDP
**Server:** `kamailio ({version})`

OPTIONS response:
```
SIP/2.0 200 OK
Allow: INVITE, ACK, CANCEL, OPTIONS, BYE, REFER, SUBSCRIBE, NOTIFY, INFO, PUBLISH, MESSAGE
Accept: application/sdp, application/isup, application/dtmf, application/dtmf-relay, multipart/mixed
```

**Notes:**
- Kamailio is a proxy, not a B2BUA (Back-to-Back User Agent), so it forwards most requests rather than terminating them
- OPTIONS may return 404 if no registered endpoints exist for the domain

### OpenSIPS

Similar to Kamailio (both forked from SER - SIP Express Router).

**User-Agent:** `OpenSIPS ({version})`

### 3CX Phone System

**User-Agent:** `3CXPhoneSystem {version}`

REGISTER challenge:
```
WWW-Authenticate: Digest realm="3cxphonesystem", nonce="abc123", algorithm=MD5
```

**Notes:**
- 3CX uses a Windows-based SIP server
- Often requires specific From domain matching the tenant domain

---

## SIP Digest Authentication Deep Dive

### Digest Scheme (RFC 2617)

SIP reuses HTTP Digest authentication with minor differences (realm as SIP domain instead of HTTP host).

**Challenge (401 or 407):**
```
WWW-Authenticate: Digest realm="asterisk", nonce="abc123", algorithm=MD5, qop="auth"
```

**Response (Authorization or Proxy-Authorization):**
```
Authorization: Digest username="1001", realm="asterisk", nonce="abc123", uri="sip:example.com", response="a1b2c3d4...", algorithm=MD5, qop=auth, nc=00000001, cnonce="xyz789"
```

### Fields

- **realm** — protection space identifier (usually SIP domain)
- **nonce** — server-generated unique string (prevents replay attacks; typically includes timestamp + HMAC)
- **algorithm** — hash function (MD5, MD5-sess, SHA-256, SHA-512-256). Port of Call supports MD5 only.
- **qop** — quality of protection (`auth` = authentication only, `auth-int` = authentication + integrity). Port of Call uses `auth` if offered, else legacy digest.
- **uri** — digest-uri (Request-URI of the request being authenticated). For REGISTER: `sip:domain`. For INVITE: `sip:user@domain`.
- **response** — MD5 hex digest of HA1, nonce, nc, cnonce, qop, HA2
- **nc** — nonce count (8-digit hex). Increments for each request using the same nonce. Port of Call uses `00000001`.
- **cnonce** — client nonce (required when qop is present). Port of Call generates random 8-character alphanumeric string.

### Legacy Digest (no qop)

```
HA1 = MD5(username:realm:password)
HA2 = MD5(METHOD:uri)
response = MD5(HA1:nonce:HA2)
```

### qop=auth Digest (RFC 2617 §3.2.2.1)

```
HA1 = MD5(username:realm:password)
HA2 = MD5(METHOD:uri)
response = MD5(HA1:nonce:nc:cnonce:qop:HA2)
```

### Security Notes

- **Plaintext password never sent** — only the MD5 hash of `username:realm:password` is transmitted (inside another MD5).
- **Nonce prevents replay** — each nonce is typically valid for 60-300 seconds. Servers reject stale nonces with `401 Stale=true`.
- **No protection against MITM** — Digest auth does not encrypt the SIP message body or headers. Use SIPS (TLS) for confidentiality.
- **Username is sent in clear** — only the password is hashed.

---

## Error Scenarios

### Connection refused
```json
{
  "success": false,
  "server": "",
  "error": "Connection refused"
}
```
**Cause:** No service listening on `host:port`, or firewall blocking TCP.

### Connection timeout
```json
{
  "success": false,
  "server": "",
  "error": "Connection timeout"
}
```
**Cause:** Host unreachable, or SYN packets dropped. Default timeout is 10 seconds.

### Response timeout
```json
{
  "success": false,
  "server": "",
  "error": "Response timeout"
}
```
**Cause:** TCP connection established, request sent, but no SIP response received within timeout.

### Response too large
```json
{
  "success": false,
  "server": "",
  "error": "Response too large"
}
```
**Cause:** Response exceeds 100KB (`MAX_RESPONSE_SIZE`). This can happen if `Allow` or `Supported` headers are extremely long, or if the SDP body is oversized.

### Failed to parse SIP response
```json
{
  "success": false,
  "server": "sip.example.com:5060",
  "raw": "HTTP/1.1 400 Bad Request\r\n...",
  "error": "Failed to parse SIP response"
}
```
**Cause:** Server returned non-SIP response (e.g. HTTP proxy error, or SSH banner on wrong port).

**Example raw value:**
```
SSH-2.0-OpenSSH_8.2p1 Ubuntu-4ubuntu0.5
```

### Invalid Content-Length in response
```json
{
  "success": false,
  "server": "",
  "error": "Invalid Content-Length in response"
}
```
**Cause:** Server sent `Content-Length` < 0 or > 100KB (malformed or malicious response).

### Timeout must be between 1000 and 300000ms
```json
{
  "success": false,
  "server": "",
  "error": "Timeout must be between 1000 and 300000ms"
}
```
**Cause:** Request sent `timeout` outside valid range (1 second to 5 minutes).

---

## Performance Notes

### Timeout tuning

For LAN SIP servers, 2-3 seconds is usually sufficient:
```json
{ "host": "192.168.1.100", "timeout": 2000 }
```

For internet SIP servers or slow servers, 10-30 seconds:
```json
{ "host": "sip.example.com", "timeout": 30000 }
```

For INVITE probes that expect ringing (180) before timeout:
```json
{ "host": "sip.example.com", "timeout": 60000 }
```

### RTT measurement

The INVITE and Digest Auth endpoints include an `rtt` field (round-trip time in milliseconds). This measures the time from initial TCP connect to final response received.

For INVITE:
```json
{
  "rtt": 245,
  "message": "INVITE 200 OK in 245ms"
}
```

For Digest Auth:
```json
{
  "rtt": 189
}
```

**Note:** RTT includes TCP handshake, TLS handshake (for SIPS, but not implemented), and all SIP request/response round-trips (two for digest auth: challenge + authenticated request).

---

## Comparison with Other Tools

### vs `sipsak` (SIP Swiss Army Knife)

`sipsak` is a CLI tool for SIP testing. It supports UDP, TCP, and TLS.

**Advantages of sipsak:**
- UDP transport
- INVITE with actual media (can send/receive RTP)
- Flooding mode for load testing
- Regex-based response filtering

**Advantages of Port of Call:**
- HTTP API (no CLI needed)
- Automatic Digest auth handling
- JSON output (easier to parse than `sipsak` text)
- Runs in browser (no local install)

### vs `sip-tester` / `SIPp`

SIPp is an industry-standard SIP load testing tool with XML scenario files.

**Advantages of SIPp:**
- Complex call flows (INVITE → 180 → 200 → ACK → BYE with timing)
- CSV injection for parameterized tests
- RTP media generation
- Statistics and latency histograms

**Advantages of Port of Call:**
- Single-request probes (no scenario XML needed)
- HTTP API (can integrate with CI/CD)
- No local install or dependencies

### vs `nmap --script sip-methods`

Nmap's SIP scripts send OPTIONS and parse `Allow` headers.

**Advantages of nmap:**
- Multi-target scanning (CIDR ranges)
- UDP support
- Integration with nmap's OS detection

**Advantages of Port of Call:**
- Digest auth support
- INVITE flow testing
- JSON output
- No root/admin privileges needed

---

## Example Workflows

### 1. Discover SIP server capabilities

```bash
curl -s -X POST https://portofcall.ross.gg/api/sip/options \
  -H 'Content-Type: application/json' \
  -d '{"host":"sip.example.com"}' | jq -r '.allowedMethods[]'
```

Output:
```
INVITE
ACK
BYE
CANCEL
OPTIONS
REGISTER
```

### 2. Test authentication requirements

```bash
curl -s -X POST https://portofcall.ross.gg/api/sip/register \
  -H 'Content-Type: application/json' \
  -d '{"host":"sip.example.com","username":"1001"}' | jq '{requiresAuth,authScheme,authRealm}'
```

Output:
```json
{
  "requiresAuth": true,
  "authScheme": "Digest",
  "authRealm": "asterisk"
}
```

### 3. Authenticate and register

```bash
curl -s -X POST https://portofcall.ross.gg/api/sip/digest-auth \
  -H 'Content-Type: application/json' \
  -d '{"host":"sip.example.com","username":"1001","password":"secret"}' | jq '{authenticated,statusCode,realm,algorithm}'
```

Output:
```json
{
  "authenticated": true,
  "statusCode": 200,
  "realm": "asterisk",
  "algorithm": "MD5"
}
```

### 4. Test INVITE with auth

```bash
curl -s -X POST https://portofcall.ross.gg/api/sip/invite \
  -H 'Content-Type: application/json' \
  -d '{"host":"sip.example.com","to":"1001","username":"1001","password":"secret"}' | jq '{statusCode,requiresAuth,auth}'
```

Output:
```json
{
  "statusCode": 401,
  "requiresAuth": true,
  "auth": {
    "authenticated": true,
    "authStatusCode": 200,
    "authStatusText": "OK",
    "realm": "asterisk",
    "algorithm": "MD5"
  }
}
```

### 5. Monitor SIP server uptime

```bash
while true; do
  STATUS=$(curl -s -X POST https://portofcall.ross.gg/api/sip/options \
    -H 'Content-Type: application/json' \
    -d '{"host":"sip.example.com","timeout":5000}' | jq -r '.statusCode // "timeout"')
  echo "$(date): $STATUS"
  sleep 30
done
```

---

## References

- **RFC 3261** — SIP: Session Initiation Protocol (base spec)
- **RFC 2617** — HTTP Authentication: Basic and Digest Access Authentication
- **RFC 3579** — RADIUS Support for EAP (for SIP Digest)
- **RFC 3263** — SIP: Locating SIP Servers (DNS SRV)
- **RFC 3581** — SIP: Symmetric Response Routing (rport)
- **RFC 4566** — SDP: Session Description Protocol
- **RFC 3262** — Reliability of Provisional Responses (PRACK)
- **RFC 3311** — UPDATE Method
- **RFC 6026** — Correct Transaction Handling for 2xx Responses to INVITE

---

## Changelog

**2026-02-18** — Initial power-user documentation created. Code fixes applied:
- Added timeout handle cleanup in all endpoints (OPTIONS, REGISTER, INVITE, Digest Auth)
- Added reader/writer lock cleanup with try/finally guards
- Fixed Content-Length byte counting for multi-byte UTF-8 in response bodies
- Added rport parameter to Via headers for NAT traversal
- Added Contact header to OPTIONS requests per RFC 3261 recommendations
- Added timeout bounds validation (1000-300000ms)
- Fixed duplicate socket.close() calls by moving to finally blocks
- Added Content-Length validation to reject negative or oversized values
