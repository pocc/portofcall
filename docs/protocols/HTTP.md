# HTTP/1.1 — Power User Reference

**Port:** 80/TCP (443/TCP with TLS) | **Protocol:** HTTP/1.1 (RFC 9110 / RFC 9112) | Deployed

Port of Call provides three HTTP endpoints: a general-purpose request executor, a HEAD-only probe, and an OPTIONS capability discovery probe. All three open a raw TCP socket from the Cloudflare Worker to the target, write the HTTP/1.1 request bytes by hand, and parse the response off the wire — no `fetch()` abstraction involved.

---

## API Endpoints

### `POST /api/http/request` — General-purpose HTTP request

Connects over TCP (or TLS), sends a raw HTTP/1.1 request, reads the full response, and returns the status line, headers, decoded body, and timing information.

**POST body:**

| Field           | Type                     | Default                        | Notes |
|-----------------|--------------------------|--------------------------------|-------|
| `host`          | string                   | —                              | Required. Hostname or IP address. |
| `port`          | number                   | `80` (or `443` if `tls: true`) | |
| `tls`           | boolean                  | `false`                        | Use TLS (HTTPS) via `secureTransport` on the socket. |
| `method`        | string                   | `"GET"`                        | One of: GET, POST, HEAD, PUT, DELETE, OPTIONS, PATCH, TRACE. |
| `path`          | string                   | `"/"`                          | Request-target. Must start with `/`, or `"*"` for OPTIONS asterisk-form. |
| `headers`       | `Record<string, string>` | `{}`                           | Additional headers. Override defaults (Host, User-Agent, Accept, Connection). |
| `body`          | string                   | —                              | Request body. Ignored for GET, HEAD, DELETE, TRACE. |
| `timeout`       | number                   | `15000`                        | Total timeout in ms (covers connect + response). |
| `maxBodyBytes`  | number                   | `65536`                        | Cap on response body size before truncation. |

**Success (200):**
```json
{
  "success": true,
  "host": "example.com",
  "port": 80,
  "tls": false,
  "tcpLatency": 12,
  "ttfb": 45,
  "totalTime": 48,
  "requestLine": "GET / HTTP/1.1",
  "requestHeaders": {
    "Host": "example.com",
    "User-Agent": "portofcall/1.0 (HTTP/1.1 TCP explorer)",
    "Accept": "*/*",
    "Connection": "close"
  },
  "httpVersion": "HTTP/1.1",
  "statusCode": 200,
  "statusText": "OK",
  "responseHeaders": {
    "content-type": "text/html; charset=UTF-8",
    "content-length": "1256",
    "server": "ECS (dce/26CD)"
  },
  "body": "<!doctype html>...",
  "bodyBytes": 1256,
  "bodyTruncated": false
}
```

**Error — bad input (400):**
```json
{ "success": false, "error": "Host is required" }
```

**Error — Cloudflare-protected host (403):**
```json
{ "success": false, "error": "Cannot connect to example.com (104.16.x.x): ...", "isCloudflare": true }
```

**Error — connection/network failure (500):**
```json
{ "success": false, "error": "Connection timeout" }
```

---

### `POST /api/http/head` — HEAD request shortcut

Sends an HTTP HEAD request. Identical to `/api/http/request` with `method: "HEAD"` forced. The response body is always `undefined` because HEAD responses carry no body per RFC 9110 Section 9.3.2.

**POST body:**

| Field     | Type                     | Default  | Notes |
|-----------|--------------------------|----------|-------|
| `host`    | string                   | —        | Required |
| `port`    | number                   | `80`/`443` | |
| `tls`     | boolean                  | `false`  | |
| `path`    | string                   | `"/"`    | |
| `headers` | `Record<string, string>` | `{}`     | |
| `timeout` | number                   | `15000`  | |

The response includes full headers (including `Content-Length` and `Content-Type`) but `body` is omitted.

---

### `POST /api/http/options` — OPTIONS capability probe

Sends `OPTIONS * HTTP/1.1` (or a custom path). Many servers respond with an `Allow` header listing supported methods.

**POST body:**

| Field     | Type                     | Default | Notes |
|-----------|--------------------------|---------|-------|
| `host`    | string                   | —       | Required |
| `port`    | number                   | `80`/`443` | |
| `tls`     | boolean                  | `false` | |
| `path`    | string                   | `"*"`   | Asterisk-form by default (RFC 9112 Section 3.2.4). |
| `timeout` | number                   | `15000` | |

---

## HTTP/1.1 Wire Format

### Request Format (RFC 9112 Section 3)

```
{METHOD} {request-target} HTTP/1.1\r\n
Host: {host}[:{port}]\r\n
{header-field}: {header-value}\r\n
...
\r\n
{optional message body}
```

**Request-line:** The method token, a single SP, the request-target, a single SP, and the HTTP version, terminated by CRLF.

**Request-target forms:**
- **Origin-form:** `GET /path/to/resource HTTP/1.1` (most common)
- **Asterisk-form:** `OPTIONS * HTTP/1.1` (server-wide capability query)
- **Absolute-form:** `GET http://example.com/path HTTP/1.1` (used with proxies)

**Host header:** Required in HTTP/1.1 (RFC 9112 Section 3.2). MUST include the port if it differs from the scheme default (80 for HTTP, 443 for HTTPS). Port of Call handles this automatically:
- `Host: example.com` when connecting to port 80 (HTTP) or 443 (HTTPS)
- `Host: example.com:8080` when connecting to a non-default port

### Response Format (RFC 9112 Section 4)

```
HTTP/1.1 {status-code} {reason-phrase}\r\n
{header-field}: {header-value}\r\n
...
\r\n
{message body}
```

**Status-line:** HTTP version, SP, 3-digit status code, SP, optional reason phrase, CRLF. The reason phrase is informational; only the numeric code is semantically meaningful.

### Header Field Parsing

Per RFC 9110 Section 5.1-5.3:
- Field names are case-insensitive. Port of Call normalizes all response header names to lowercase.
- Field values have leading/trailing whitespace stripped.
- Duplicate headers with the same name are combined with `, ` (comma-space), which is correct for all standard headers except `Set-Cookie`.
- No whitespace is allowed between the field name and the colon in conformant responses, but the parser accepts it (robustness principle).

---

## Message Body Determination (RFC 9110 Section 6.4)

The presence and length of a response body depends on the status code and request method:

| Condition | Body present? | How length is determined |
|-----------|---------------|------------------------|
| Response to HEAD | No | Headers may include Content-Length but no body follows |
| 1xx (Informational) | No | |
| 204 (No Content) | No | |
| 304 (Not Modified) | No | |
| Transfer-Encoding: chunked | Yes | Chunked framing (see below) |
| Content-Length present | Yes | Exactly N octets after headers |
| Neither CL nor TE | Yes | Read until connection close |

Port of Call checks these conditions in the correct order: no-body statuses and HEAD first, then Transfer-Encoding, then Content-Length, then connection-close fallback.

---

## Transfer-Encoding: chunked (RFC 9112 Section 7.1)

Chunked encoding allows the server to send the body in pieces without knowing the total size upfront.

### Wire format

```
{chunk-size-hex}[;chunk-ext]\r\n
{chunk-data}\r\n
...
0\r\n
{optional trailer headers}\r\n
```

**Chunk-size** is the number of octets in the chunk data, expressed as hexadecimal (case-insensitive). The last chunk has size `0` (the "terminal chunk").

**Chunk extensions** (`;name=value` after the hex size) are parsed and ignored.

**Trailers** after the terminal chunk are currently discarded.

### Decoding behavior

The `decodeChunked()` function:
1. Reads the hex chunk-size line up to `\r\n`
2. Strips optional chunk extensions after `;`
3. Reads exactly `chunkSize` bytes of data
4. Skips the trailing `\r\n` after each chunk
5. Stops on the terminal `0\r\n` chunk
6. Handles incomplete chunks gracefully (takes what's available)

---

## Content-Length Handling (RFC 9112 Section 6.2)

When `Content-Length` is present and `Transfer-Encoding` is absent, the reader accumulates exactly that many body bytes after the header section, then stops. If fewer bytes arrive before the timeout, the response is returned with `bodyTruncated: true`.

When both `Transfer-Encoding` and `Content-Length` are present, `Transfer-Encoding` takes precedence per RFC 9112 Section 6.1.

---

## HTTP Methods (RFC 9110 Section 9)

| Method  | Body allowed? | Notes |
|---------|---------------|-------|
| GET     | Suppressed    | Body is silently dropped if provided. |
| HEAD    | No            | Response body is never returned. |
| POST    | Yes           | Content-Length is set automatically. |
| PUT     | Yes           | |
| DELETE  | Suppressed    | Body is silently dropped if provided. |
| OPTIONS | Yes           | Default path is `*` (asterisk-form). |
| PATCH   | Yes           | |
| TRACE   | Rejected      | Returns 400 if body is provided (RFC 9110 Section 9.3.8). |

**Content-Type default:** If a body is sent and no `Content-Type` header is provided, `application/x-www-form-urlencoded` is used as the default.

---

## Default Headers

Every request includes these headers unless overridden via the `headers` field:

| Header | Default Value | Purpose |
|--------|--------------|---------|
| `Host` | `{host}` or `{host}:{port}` | Required by HTTP/1.1 (RFC 9112 Section 3.2) |
| `User-Agent` | `portofcall/1.0 (HTTP/1.1 TCP explorer)` | Identifies the client |
| `Accept` | `*/*` | Willing to accept any media type |
| `Connection` | `close` | Request single-use connection (no keep-alive) |

All defaults can be overridden by passing the same header name in the `headers` object. Caller-supplied headers are spread after defaults, so they win.

---

## Timing Fields

| Field | Meaning |
|-------|---------|
| `tcpLatency` | Milliseconds to establish the TCP connection (TLS handshake included if `tls: true`). |
| `ttfb` | Milliseconds from sending the request to receiving the full response. This is not true TTFB (first byte) — it includes body read time. |
| `totalTime` | Milliseconds from connection start to response processing complete. |

---

## Binary Content Detection

Response bodies with these content-type patterns are not decoded as text:

```
image | audio | video | octet-stream | font | zip | gzip | pdf
```

Instead, the `body` field contains: `[binary content: {N} bytes, content-type: {type}]`

All other content types are decoded as UTF-8 with `TextDecoder({ fatal: false })` — invalid byte sequences are replaced with U+FFFD rather than throwing.

---

## Status Line Parsing (RFC 9112 Section 4)

The status line regex is:
```
/^(HTTP\/[\d.]+)\s+(\d+)\s*(.*)/
```

This accepts:
- Standard: `HTTP/1.1 200 OK`
- No reason phrase: `HTTP/1.1 200` (permitted by RFC 9112)
- HTTP/1.0: `HTTP/1.0 200 OK`
- HTTP/2 disguised: `HTTP/2 200` (some servers)

If the status line cannot be parsed, `httpVersion` defaults to `HTTP/?` and `statusCode` to `0`.

---

## Input Validation

**Host:** Must match `/^[a-zA-Z0-9._:-]+$/`. No whitespace, no path injection, no null bytes. IPv6 addresses with brackets are rejected — use the raw address without brackets.

**Port:** Integer 1-65535.

**Method:** Must be one of the eight allowed methods (case-insensitive input, uppercased before use).

**Path:** Must start with `/` (auto-prefixed if missing), or be exactly `*` for OPTIONS asterisk-form.

---

## Known Limitations

**No redirect following.** The `followRedirects` field is declared in the options interface but not implemented. 3xx responses are returned as-is. To follow redirects, read the `Location` header from the response and issue a new request.

**No HTTP/2 or HTTP/3.** The raw TCP socket speaks HTTP/1.1 only. Servers that require HTTP/2 (e.g., gRPC endpoints) will not work.

**No request body streaming.** The entire request body must fit in the `body` string field. Binary request bodies are not supported.

**Connection: close only.** Keep-alive and connection reuse are not implemented. Each request opens and closes a fresh TCP connection. Pipelining is not supported.

**Set-Cookie header folding.** Duplicate response headers are combined with `, `. This is correct per RFC 9110 Section 5.2 for all headers except `Set-Cookie` (RFC 6265), which must not be combined. If a server returns multiple `Set-Cookie` headers, they will be merged into a single comma-separated value, which may be unparseable.

**Response body size cap.** Default 64 KiB (`maxBodyBytes`). Larger responses are truncated and `bodyTruncated` is set to `true`. The read loop adds 8 KiB of slack for headers.

**Chunked encoding trailers.** Trailer headers after the terminal chunk are silently discarded. RFC 9110 Section 6.5 trailers (e.g., `Trailer: Checksum`) are not surfaced.

**No gzip/deflate decompression.** If the server returns `Content-Encoding: gzip`, the body is the raw compressed bytes. The `Accept-Encoding` header is not sent by default, so most servers will return uncompressed content unless overridden.

**Cloudflare-to-Cloudflare restriction.** Targets behind Cloudflare's proxy are rejected with a 403 before any connection is attempted. This is a Cloudflare Workers platform restriction. Use the origin IP directly if available.

**TTFB is not true TTFB.** The `ttfb` field measures time from request send to full response read, not time to first byte. The read loop processes the response in chunks but reports only the total elapsed time.

---

## Practical Examples

### curl

```bash
# Simple GET request
curl -s -X POST https://portofcall.ross.gg/api/http/request \
  -H 'Content-Type: application/json' \
  -d '{"host":"example.com"}' | jq .

# GET with custom path and headers
curl -s -X POST https://portofcall.ross.gg/api/http/request \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "httpbin.org",
    "path": "/headers",
    "headers": {"X-Custom": "test-value", "Accept": "application/json"}
  }' | jq '.body' -r

# POST with body
curl -s -X POST https://portofcall.ross.gg/api/http/request \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "httpbin.org",
    "method": "POST",
    "path": "/post",
    "headers": {"Content-Type": "application/json"},
    "body": "{\"key\": \"value\"}"
  }' | jq .

# HTTPS request
curl -s -X POST https://portofcall.ross.gg/api/http/request \
  -H 'Content-Type: application/json' \
  -d '{"host":"example.com","tls":true}' | jq .

# Non-default port
curl -s -X POST https://portofcall.ross.gg/api/http/request \
  -H 'Content-Type: application/json' \
  -d '{"host":"example.com","port":8080,"path":"/health"}' | jq .

# HEAD request — headers only, no body
curl -s -X POST https://portofcall.ross.gg/api/http/head \
  -H 'Content-Type: application/json' \
  -d '{"host":"example.com"}' | jq .responseHeaders

# OPTIONS probe — discover allowed methods
curl -s -X POST https://portofcall.ross.gg/api/http/options \
  -H 'Content-Type: application/json' \
  -d '{"host":"httpbin.org","tls":true}' \
  | jq '.responseHeaders.allow'

# TRACE request (no body allowed)
curl -s -X POST https://portofcall.ross.gg/api/http/request \
  -H 'Content-Type: application/json' \
  -d '{"host":"example.com","method":"TRACE","path":"/"}' | jq .

# Extract just timing info
curl -s -X POST https://portofcall.ross.gg/api/http/request \
  -H 'Content-Type: application/json' \
  -d '{"host":"example.com"}' \
  | jq '{tcpLatency, ttfb, totalTime}'
```

### JavaScript

```js
const response = await fetch('/api/http/request', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    host: 'example.com',
    tls: true,
    path: '/api/v1/status',
    headers: { 'Authorization': 'Bearer token123' },
    timeout: 10000,
  }),
});

const result = await response.json();
if (result.success) {
  console.log(`${result.httpVersion} ${result.statusCode} ${result.statusText}`);
  console.log(`TCP: ${result.tcpLatency}ms, Total: ${result.totalTime}ms`);
  console.log('Headers:', result.responseHeaders);
  console.log('Body:', result.body);
} else {
  console.error(result.error);
}
```

---

## What's on the Wire

For a `GET / HTTP/1.1` request to `example.com:80`, Port of Call writes these exact bytes to the TCP socket:

```
GET / HTTP/1.1\r\n
Host: example.com\r\n
User-Agent: portofcall/1.0 (HTTP/1.1 TCP explorer)\r\n
Accept: */*\r\n
Connection: close\r\n
\r\n
```

For a POST to `example.com:8080` with a JSON body:

```
POST /api/data HTTP/1.1\r\n
Host: example.com:8080\r\n
User-Agent: portofcall/1.0 (HTTP/1.1 TCP explorer)\r\n
Accept: */*\r\n
Connection: close\r\n
Content-Length: 16\r\n
Content-Type: application/json\r\n
\r\n
{"key": "value"}
```

Note the `Host: example.com:8080` — the port is included because 8080 is not the default for HTTP.

---

## Resources

- [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110)
- [RFC 9112 — HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9112)
- [RFC 9111 — HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111)
- [RFC 6265 — HTTP State Management Mechanism (Cookies)](https://www.rfc-editor.org/rfc/rfc6265)
- [MDN — HTTP](https://developer.mozilla.org/en-US/docs/Web/HTTP)
- [httpbin.org](https://httpbin.org/) — HTTP request/response testing service
