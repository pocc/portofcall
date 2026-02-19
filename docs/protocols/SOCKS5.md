# SOCKS5 Proxy Protocol — Port of Call Reference

**RFC:** [1928](https://tools.ietf.org/html/rfc1928) (SOCKS5), [1929](https://tools.ietf.org/html/rfc1929) (Username/Password auth)
**Default port:** 1080
**Source:** `src/worker/socks5.ts`

---

## Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/socks5/connect` | POST | Handshake + CONNECT through proxy; reports auth method, reply code, bound address |
| `/api/socks5/relay` | POST | Full tunnel: SOCKS5 handshake + HTTP/1.0 GET through the tunnel; verifies end-to-end |

Both endpoints return `405 Method Not Allowed` for non-POST requests.

---

### `POST /api/socks5/connect` — Proxy handshake + CONNECT

Connects to a SOCKS5 proxy, negotiates authentication, sends a CONNECT request for a destination host:port, and reports the result. The tunnel is **not used** — this endpoint only tests whether the proxy will grant the connection.

**Request:**

```json
{
  "proxyHost": "proxy.example.com",
  "proxyPort": 1080,
  "destHost": "target.example.com",
  "destPort": 80,
  "username": "user",
  "password": "pass",
  "timeout": 15000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `proxyHost` | **required** | SOCKS5 proxy hostname or IP |
| `proxyPort` | `1080` | Proxy port |
| `destHost` | **required** | Target hostname the proxy should CONNECT to |
| `destPort` | **required** | Target port (validated: 1–65535) |
| `username` | — | Optional; enables username/password auth method offer |
| `password` | — | Optional; required if proxy selects username/password |
| `timeout` | `15000` | Wall-clock timeout in ms |

**Response (success):**

```json
{
  "success": true,
  "granted": true,
  "proxyHost": "proxy.example.com",
  "proxyPort": 1080,
  "destHost": "target.example.com",
  "destPort": 80,
  "authMethod": "No authentication",
  "authSuccess": null,
  "replyCode": 0,
  "replyMessage": "Succeeded",
  "boundAddress": "10.0.0.1",
  "boundPort": 45678,
  "connectTimeMs": 42,
  "totalTimeMs": 156
}
```

**Key fields:**

| Field | Type | Notes |
|-------|------|-------|
| `success` | boolean | Always `true` if the proxy responded — even if CONNECT was denied |
| `granted` | boolean | `true` only when `replyCode === 0x00` (Succeeded) |
| `authMethod` | string | Human-readable: `"No authentication"`, `"Username/password"`, or `"No acceptable methods"` |
| `authSuccess` | boolean \| null | `null` if no auth was used; `true`/`false` if username/password was negotiated |
| `replyCode` | number | Raw SOCKS5 reply byte (0x00–0x08) |
| `replyMessage` | string | Human-readable reply name from RFC 1928 §6 |
| `boundAddress` | string | BND.ADDR from the CONNECT reply; often `0.0.0.0` |
| `boundPort` | number | BND.PORT from the CONNECT reply |
| `connectTimeMs` | number | Time to establish TCP connection to proxy |
| `totalTimeMs` | number | Total wall-clock time including handshake + CONNECT |

**Reply codes (RFC 1928 §6):**

| Code | Meaning |
|------|---------|
| `0x00` | Succeeded |
| `0x01` | General SOCKS server failure |
| `0x02` | Connection not allowed by ruleset |
| `0x03` | Network unreachable |
| `0x04` | Host unreachable |
| `0x05` | Connection refused |
| `0x06` | TTL expired |
| `0x07` | Command not supported |
| `0x08` | Address type not supported |

**Gotcha — `success: true` with `granted: false`:** The proxy communicated successfully but denied the CONNECT. Always check `granted`, not just `success`. A `success: false` response means the proxy itself was unreachable or the handshake failed at the protocol level.

---

### `POST /api/socks5/relay` — Tunnel + HTTP GET

Establishes a full SOCKS5 tunnel and sends an HTTP/1.0 GET request through it. Verifies end-to-end connectivity by returning the HTTP response status and a preview of the body.

**Request:**

```json
{
  "proxyHost": "proxy.example.com",
  "proxyPort": 1080,
  "destHost": "example.com",
  "destPort": 80,
  "path": "/",
  "username": "user",
  "password": "pass",
  "timeout": 15000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `proxyHost` | **required** | SOCKS5 proxy hostname or IP |
| `proxyPort` | `1080` | Proxy port |
| `destHost` | **required** | Target HTTP server hostname |
| `destPort` | `80` | Target port (no validation — unlike `/connect`) |
| `path` | `"/"` | HTTP request path |
| `username` | — | Optional SOCKS5 auth |
| `password` | — | Optional SOCKS5 auth |
| `timeout` | `15000` | Wall-clock timeout in ms |

**Response (success):**

```json
{
  "success": true,
  "proxyHost": "proxy.example.com",
  "proxyPort": 1080,
  "destHost": "example.com",
  "destPort": 80,
  "authMethod": "No authentication",
  "tunnelTimeMs": 87,
  "totalTimeMs": 234,
  "httpStatus": 200,
  "httpStatusText": "OK",
  "responsePreview": "HTTP/1.0 200 OK\r\nContent-Type: text/html\r\n..."
}
```

| Field | Type | Notes |
|-------|------|-------|
| `tunnelTimeMs` | number | Time to establish SOCKS5 tunnel (before HTTP request) |
| `totalTimeMs` | number | Total including HTTP round-trip |
| `httpStatus` | number | Parsed HTTP status code; `0` if unparseable |
| `httpStatusText` | string | Status text (e.g., `"OK"`, `"Not Found"`) |
| `responsePreview` | string | First 500 bytes of the raw HTTP response (headers + body) |

**HTTP request sent through tunnel:**

```
GET {path} HTTP/1.0\r\n
Host: {destHost}\r\n
Connection: close\r\n
\r\n
```

HTTP/1.0 is used deliberately — it implies connection close, which makes response collection straightforward through the tunnel.

---

## Implementation Details

### Wire exchange — `/connect`

```
Client              SOCKS5 Proxy           Destination
  |                      |                      |
  |  TCP connect ------> |                      |
  |  [0x05, N, methods]  |                      |
  |  <--- [0x05, method] |                      |
  |                      |                      |
  |  (if method=0x02)    |                      |
  |  [0x01, ulen, user,  |                      |
  |   plen, pass]        |                      |
  |  <--- [0x01, status] |                      |
  |                      |                      |
  |  CONNECT request --> |  TCP connect ------> |
  |  <--- CONNECT reply  |  <--- connected      |
  |                      |                      |
  |  (tunnel established — /connect closes here) |
```

### Auth method negotiation

When credentials are provided, the greeting offers both methods: `[AUTH_NONE (0x00), AUTH_USERPASS (0x02)]`. The proxy picks whichever it prefers — if the proxy supports both, it typically selects `AUTH_NONE`. To force authentication testing, the proxy must be configured to require it.

When no credentials are provided, only `AUTH_NONE` is offered.

### readBytes vs reader.read()

`/connect` uses bare `reader.read()` calls — a single read per protocol step. This works because SOCKS5 responses are small and typically arrive in a single TCP segment. However, if the proxy sends a fragmented response, the single read may return incomplete data.

`/relay` uses a precise `readBytes(n)` function that accumulates exactly `n` bytes across multiple reads. **Caveat:** if a `reader.read()` returns more bytes than needed, the excess is silently discarded. In practice this means: if the proxy packs the CONNECT reply and the start of the HTTP response into a single TCP segment, the HTTP response bytes will be lost. This is unlikely with most proxies but possible.

### Address types

CONNECT requests always use `ATYP_DOMAIN (0x03)` — the destination hostname is sent as-is to the proxy for DNS resolution. IPv4/IPv6 address types are only parsed in the CONNECT reply's BND.ADDR field, not sent.

**Bound address parsing supports:**

| ATYP | Format | Notes |
|------|--------|-------|
| `0x01` (IPv4) | `a.b.c.d` | 4 bytes |
| `0x03` (Domain) | Length-prefixed string | Variable |
| `0x04` (IPv6) | Colon-separated hex groups | 16 bytes; no zero-compression (`0:0:0:0:0:0:0:1` not `::1`) |

Bound address parsing is best-effort; failures are silently ignored and return empty strings.

### Cloudflare detection

Both endpoints check `proxyHost` against Cloudflare's IP ranges before connecting. `destHost` is **not** checked — Cloudflare detection only applies to the proxy server, not the tunnel destination.

### Timeout architecture

Both endpoints use a single outer `Promise.race` against a `timeout`-ms wall-clock deadline. There are no per-step inner timeouts.

`/relay` adds an HTTP read deadline: `Math.min(8000, timeout - elapsed)` — the HTTP response collection phase gets at most 8 seconds, regardless of the overall timeout.

### Response size limits

`/relay` reads up to 4096 bytes of HTTP response data. `responsePreview` is further truncated to 500 bytes. For large responses, you only see the beginning.

### destPort validation asymmetry

`/connect` validates `destPort` (1–65535, returns 400 on invalid). `/relay` does **not** validate `destPort` — a port of 0 or >65535 will be sent to the proxy as-is and likely fail at the CONNECT step.

---

## Quick reference — curl

```bash
# Test proxy handshake (no auth, just check if proxy grants CONNECT)
curl -s -X POST https://portofcall.ross.gg/api/socks5/connect \
  -H 'Content-Type: application/json' \
  -d '{"proxyHost":"proxy.example.com","destHost":"example.com","destPort":80}' | jq .

# Test with authentication
curl -s -X POST https://portofcall.ross.gg/api/socks5/connect \
  -H 'Content-Type: application/json' \
  -d '{"proxyHost":"proxy.example.com","destHost":"example.com","destPort":443,"username":"user","password":"pass"}' | jq .

# Check which auth method the proxy selected
curl -s -X POST https://portofcall.ross.gg/api/socks5/connect \
  -H 'Content-Type: application/json' \
  -d '{"proxyHost":"proxy.example.com","destHost":"httpbin.org","destPort":80}' | jq '.authMethod,.granted'

# Full relay: tunnel HTTP GET through proxy
curl -s -X POST https://portofcall.ross.gg/api/socks5/relay \
  -H 'Content-Type: application/json' \
  -d '{"proxyHost":"proxy.example.com","destHost":"httpbin.org","destPort":80,"path":"/ip"}' | jq .

# Relay with custom path
curl -s -X POST https://portofcall.ross.gg/api/socks5/relay \
  -H 'Content-Type: application/json' \
  -d '{"proxyHost":"proxy.example.com","destHost":"example.com","destPort":80,"path":"/robots.txt"}' | jq '.httpStatus,.responsePreview'
```

---

## Local testing

**SSH SOCKS5 proxy** (quickest way to get a test proxy):

```bash
ssh -D 1080 -N user@some-server.com
# -D 1080 = SOCKS5 proxy on localhost:1080
# -N = no remote command
```

**Dante SOCKS5 server** (Docker, supports auth):

```bash
docker run -d -p 1080:1080 --name dante wernight/dante
```

**microsocks** (minimal, no auth):

```bash
docker run -d -p 1080:1080 --name microsocks vimagick/microsocks
```

Verify with curl: `curl --socks5 localhost:1080 http://httpbin.org/ip`

---

## What is NOT implemented

- **UDP ASSOCIATE** (CMD 0x03) — Only CONNECT (CMD 0x01) is supported
- **BIND** (CMD 0x02) — Server-side listen for inbound connections
- **GSSAPI authentication** (method 0x01) — Only no-auth and username/password
- **IPv4/IPv6 literal CONNECT** — Destinations are always sent as domain names (ATYP 0x03), even if an IP address is provided; the proxy resolves them
- **HTTPS relay** — `/relay` sends plaintext HTTP/1.0; no TLS through the tunnel
- **Proxy chaining** — No support for connecting through multiple SOCKS5 proxies in sequence
- **SOCKS4 fallback** — If pointed at a SOCKS4-only proxy, the version check fails with "Not a SOCKS5 proxy"
