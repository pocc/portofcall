# Gemini — Power User Reference

## Overview

**Gemini** (RFC-adjacent, spec at gemini.circumlunar.space) is a minimalist application-layer
protocol that sits between Gopher and HTTP in complexity. Its defining traits: TLS is mandatory,
the client sends exactly one line, the server responds with a two-character status + meta header
and an optional body, then closes the connection. No persistent connections, no cookies, no
JavaScript, no inline images.

**Port:** 1965 (default)  
**Transport:** TLS over TCP (`cloudflare:sockets connect()` with `secureTransport: "on"`)  
**Cloudflare detection:** None — requests go directly to TLS TCP  
**Body size limit:** 5 MB (`5242880` bytes)

---

## Transport

Port of Call opens a TLS socket to `host:port`, writes the Gemini request URL terminated with
`\r\n`, reads the full response until the server closes the connection, then closes the socket.
There is no keep-alive and no pipelining — one connection per request.

### Gemini Protocol Flow

```
Client                              Server (port 1965, TLS)
  |  ---- TLS ClientHello ------>    |
  |  <--- TLS ServerHello + Cert --  |
  |  ---- TLS Finished ---------->   |
  |                                  |
  |  ---- "gemini://host/path\r\n" > |   Request line (max ~1024 chars per spec)
  |                                  |
  |  <--- "20 text/gemini\r\n" ----  |   Response header line
  |  <--- [body bytes] ------------  |   Body (only for 2x responses)
  |  <--- [TCP FIN] ---------------  |   Server closes
```

The client never sends request headers, cookies, or a body. The server never sends chunked
encoding or content-length — it just streams until close.

---

## Endpoint

### POST /api/gemini/fetch

**Request**
```json
{
  "url":     "gemini://gemini.circumlunar.space/",
  "timeout": 10000
}
```

| Field     | Type    | Default | Description                                              |
|-----------|---------|---------|----------------------------------------------------------|
| `url`     | string  | —       | **Required.** Gemini URL. `gemini://` prefix optional.   |
| `timeout` | integer | 10000   | Socket + read deadline in ms                             |

**Response — success**
```json
{
  "success": true,
  "status":  20,
  "meta":    "text/gemini; charset=utf-8",
  "body":    "# Welcome\n\nThis is a Gemini capsule.\n..."
}
```

| Field     | Type    | Description                                                           |
|-----------|---------|-----------------------------------------------------------------------|
| `status`  | integer | Gemini status code (two-digit integer, e.g. `20`, `31`, `51`)        |
| `meta`    | string  | Content-Type for 2x; redirect URL for 3x; error message for 4x/5x/6x |
| `body`    | string  | Response body decoded as UTF-8 (empty for non-2x responses)           |

**Response — error (400)**
```json
{ "success": false, "error": "URL is required" }
```

**Response — error (500)**
```json
{ "success": false, "error": "Connection timeout" }
```

---

## URL Parsing

The implementation's `parseGeminiUrl()` accepts:

| Input format                      | Result                        |
|-----------------------------------|-------------------------------|
| `gemini://example.com/path`       | host=example.com, port=1965, path=/path |
| `example.com/path`                | host=example.com, port=1965, path=/path |
| `gemini://example.com:1234/path`  | host=example.com, port=1234, path=/path |
| `gemini://example.com`            | host=example.com, port=1965, path=/ |
| `example.com`                     | host=example.com, port=1965, path=/ |

**Important:** When `url` contains a non-default port (e.g. `:1234`), the port is used for the
TCP connection but is **dropped** from the Gemini request line sent to the server. The server
receives `gemini://example.com/path\r\n`, not `gemini://example.com:1234/path\r\n`.

Per the Gemini spec, servers should treat the two as equivalent on the correct port — but if a
server is strict about URL matching (e.g. for virtual hosting), this omission may cause unexpected
behavior. To avoid ambiguity, always use the canonical URL without a port.

---

## Status Codes

Gemini uses two-digit status codes. The first digit is the class; the second refines it.

| Code | Name                        | `meta` content                  | Body? |
|------|-----------------------------|---------------------------------|-------|
| 10   | INPUT                       | Prompt text for the user        | No    |
| 11   | SENSITIVE INPUT             | Prompt text (hide input)        | No    |
| 20   | SUCCESS                     | MIME type (e.g. `text/gemini`)  | Yes   |
| 30   | REDIRECT (temporary)        | New URL                         | No    |
| 31   | REDIRECT (permanent)        | New URL                         | No    |
| 40   | TEMPORARY FAILURE           | Human-readable error message    | No    |
| 41   | SERVER UNAVAILABLE          | Human-readable error message    | No    |
| 42   | CGI ERROR                   | Human-readable error message    | No    |
| 43   | PROXY ERROR                 | Human-readable error message    | No    |
| 44   | SLOW DOWN                   | Wait time in seconds            | No    |
| 50   | PERMANENT FAILURE           | Human-readable error message    | No    |
| 51   | NOT FOUND                   | Human-readable error message    | No    |
| 52   | GONE                        | Human-readable error message    | No    |
| 53   | PROXY REQUEST REFUSED       | Human-readable error message    | No    |
| 59   | BAD REQUEST                 | Human-readable error message    | No    |
| 60   | CLIENT CERTIFICATE REQUIRED | Human-readable error message    | No    |
| 61   | CERTIFICATE NOT AUTHORISED  | Human-readable error message    | No    |
| 62   | CERTIFICATE NOT VALID       | Human-readable error message    | No    |

All codes with class 2x (20–29) have a body. All others have only the header line.
The body in Port of Call's response will be an empty string `""` for non-2x status codes.

---

## Gemtext (text/gemini)

When `meta` is `text/gemini`, the body is Gemtext — a line-oriented markup format:

| Line prefix | Meaning                               |
|-------------|---------------------------------------|
| `#`         | H1 heading                            |
| `##`        | H2 heading                            |
| `###`       | H3 heading                            |
| `=>`        | Link line: `=> URL [label]`           |
| `*`         | Unordered list item                   |
| `>`         | Blockquote                            |
| ` ``` `     | Toggle preformatted mode (triple backtick) |
| (plain)     | Paragraph text                        |

Gemtext is line-by-line — there are no inline styles, no HTML tags, no inline images. Parse it
with a simple line-splitter rather than a full parser.

---

## curl Examples

### Fetch a Gemini capsule
```bash
curl -s -X POST https://portofcall.ross.gg/api/gemini/fetch \
  -H 'Content-Type: application/json' \
  -d '{"url":"gemini://gemini.circumlunar.space/"}' | jq '{status, meta}'
```

### Extract all links from a Gemtext page
```bash
curl -s -X POST https://portofcall.ross.gg/api/gemini/fetch \
  -H 'Content-Type: application/json' \
  -d '{"url":"gemini://gemini.circumlunar.space/"}' \
  | jq -r '.body' | grep '^=>' | awk '{print $2, $3}'
```

### Check a redirect
```bash
curl -s -X POST https://portofcall.ross.gg/api/gemini/fetch \
  -H 'Content-Type: application/json' \
  -d '{"url":"gemini://example.com/old-path"}' \
  | jq '{status, meta}'
# If status=30 or 31, meta contains the redirect URL
```

### Custom port
```bash
curl -s -X POST https://portofcall.ross.gg/api/gemini/fetch \
  -H 'Content-Type: application/json' \
  -d '{"url":"gemini://localhost:1965/","timeout":5000}' | jq .
```

### Short timeout for fast probing
```bash
curl -s -X POST https://portofcall.ross.gg/api/gemini/fetch \
  -H 'Content-Type: application/json' \
  -d '{"url":"gemini://gemini.circumlunar.space/","timeout":3000}' | jq .success
```

---

## Power User Notes

### No redirect following

Port of Call does **not** follow redirects. A `3x` response returns `success: true` with the
redirect URL in `meta` and an empty `body`. If you need to follow a redirect, extract `meta` and
make a second call with that URL.

### No client certificate support

All `6x` responses (client certificate required) result in `success: true` with the server's
prompt in `meta`. There is no mechanism to supply a client certificate — the TLS handshake uses
only the server's certificate.

### TLS certificate validation

Gemini uses Trust-On-First-Use (TOFU) semantics in native clients, not CA-signed certificates.
Cloudflare Workers' TLS stack validates certificates against the system CA store. Self-signed
certificates on Gemini servers will cause the TLS handshake to fail at `socket.opened`, producing:

```json
{ "success": false, "error": "Connection timeout" }
```

or a TLS-specific error depending on the Worker runtime. Many smaller Gemini capsules use
self-signed certificates and will be unreachable via Port of Call.

### Response body for non-2x status codes

The Gemini wire protocol sends no body for non-2x responses. Port of Call sets `body` to the
decoded content after the `\r\n` — which is always an empty string for non-2x responses, since
the server closes immediately after the header line.

### 5 MB response cap

The implementation accumulates chunks until the server closes. If total bytes exceed 5242880 (5 MB)
before the server closes, the endpoint throws `'Response too large (max 5MB)'` and returns HTTP
500. Most Gemtext documents are well under this limit, but binary files (e.g. audio, images served
as Gemini capsule assets) can exceed it.

### Error handling at chunk boundary

If the server closes the connection before sending any bytes, the implementation throws
`'No response from server'` (HTTP 500). This is distinct from a timeout, which produces
`'Connection timeout'`.

### What Port of Call does NOT implement

- **Redirect following** — manual extraction of `meta` URL and re-request required
- **Client certificates** — no TOFU or cert provisioning
- **Input prompts** — `1x` responses require a second request with user input appended to the URL
  as a query string: `gemini://example.com/search?my+query`
- **Slow Down (`44`) retry** — the `meta` field contains the wait time in seconds, but Port of
  Call returns the response immediately without retrying
- **Streaming** — the entire response is accumulated in memory before returning JSON

---

## Local Testing

```bash
# Install a local Gemini server (e.g. Agate, Rust-based)
cargo install agate

# Generate a self-signed cert for localhost
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
  -keyout key.pem -out cert.pem -days 365 -nodes -subj '/CN=localhost'

# Start Agate
agate --content ./content --addr 0.0.0.0:1965 \
  --cert cert.pem --key key.pem --hostname localhost

# Note: Self-signed certs will fail TLS validation in Port of Call (see above)
```

**Public Gemini capsules for testing:**

| URL | Notes |
|-----|-------|
| `gemini://gemini.circumlunar.space/` | Original capsule; sometimes slow |
| `gemini://geminiprotocol.net/` | Official spec mirror |

---

## Resources

- [Gemini Protocol Specification](https://geminiprotocol.net/docs/specification.gmi)
- [gemini.circumlunar.space](gemini://gemini.circumlunar.space/) — original capsule
