# HTTP Proxy — `src/worker/httpproxy.ts`

Port 3128 (default) / 8080 / 8888 — RFC 9110 §9.3.6

Two endpoints. Forward proxy probe (absolute-URI GET through proxy) and CONNECT tunnel establishment.

---

## Endpoints

| # | Method | Path | Purpose |
|---|--------|------|---------|
| 1 | POST / GET | `/api/httpproxy/probe` | Forward proxy test — sends `GET <targetUrl> HTTP/1.1` through the proxy |
| 2 | POST | `/api/httpproxy/connect` | CONNECT tunnel test — sends `CONNECT <targetHost>:<targetPort> HTTP/1.1` |

---

## 1. `/api/httpproxy/probe`

Forward proxy detection. Connects to `host:port`, sends a full HTTP/1.1 GET request with the target URL as an absolute-URI, reads the response, and classifies the server.

### Request

**POST** body or **GET** query params.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | *(required)* | Proxy server address |
| `port` | number | `3128` | Proxy server port |
| `targetUrl` | string | `"http://example.com/"` | Absolute URI to fetch through the proxy |
| `proxyAuth` | string | `""` | `user:password` for Proxy-Authorization Basic |
| `timeout` | number | `10000` | Outer timeout (ms) — see timeout note below |

GET form: `?host=proxy.example.com&port=3128&targetUrl=http://example.com/&timeout=10000`

### Wire exchange

```
→  GET http://example.com/ HTTP/1.1\r\n
   Host: example.com\r\n
   User-Agent: PortOfCall/1.0 (Proxy Probe)\r\n
   Accept: */*\r\n
   Connection: close\r\n
   [Proxy-Authorization: Basic <btoa(proxyAuth)>\r\n]
   \r\n
←  HTTP/1.1 200 OK\r\n
   Via: 1.1 squid\r\n
   ...
```

### Response (success)

```json
{
  "success": true,
  "host": "proxy.example.com",
  "port": 3128,
  "protocol": "HTTP Proxy",
  "rtt": 142,
  "isProxy": true,
  "proxyType": "Squid",
  "requiresAuth": false,
  "statusCode": 200,
  "statusText": "OK",
  "targetUrl": "http://example.com/",
  "proxyHeaders": ["Via: 1.1 squid/4.15"],
  "server": "squid/4.15",
  "note": "HTTP proxy detected on proxy.example.com:3128. Proxy forwarded the request successfully."
}
```

### `isProxy` classification logic

`isProxy` is `true` when **any** of:
- `statusCode === 200`
- `statusCode === 407`
- `Via` or `Proxy-Agent` headers are present

**Gotcha:** A regular (non-proxy) HTTP server returning 200 will be classified as `isProxy: true`. The `proxyType` and `proxyHeaders` fields provide stronger signals. If `proxyType` is `"Unknown"` and `proxyHeaders` is absent, it's likely a direct HTTP server, not a proxy.

### `proxyType` detection

All response headers are JSON-stringified and searched case-insensitively for these keywords, in order (first match wins):

| Keyword | `proxyType` |
|---------|-------------|
| `squid` | `"Squid"` |
| `nginx` | `"Nginx"` |
| `apache` | `"Apache"` |
| `haproxy` | `"HAProxy"` |
| `varnish` | `"Varnish"` |
| `tinyproxy` | `"Tinyproxy"` |
| `privoxy` | `"Privoxy"` |
| `ccproxy` | `"CCProxy"` |
| *(Via or Proxy-Agent present)* | `"HTTP Proxy (detected via headers)"` |
| *(none)* | `"Unknown"` |

Detection uses `JSON.stringify(headers).toLowerCase()`, so the keyword can match inside any header key or value — including the target page's `body` content if it leaks into headers. In practice this is unlikely since responses are truncated early.

### Response body truncation

The response read loop runs up to **20 iterations**, stopping early once `\r\n\r\n` is found **and** `responseData.length > 500`. This means the body is partially read (roughly the first ~500 bytes after headers). The `body` field from `parseHTTPResponse` is not returned in the API response.

---

## 2. `/api/httpproxy/connect`

CONNECT tunnel test. Connects to `host:port`, sends `CONNECT targetHost:targetPort HTTP/1.1`, reads the proxy's response, and reports whether the tunnel was established.

**POST only** — returns 405 on any other method.

### Request

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | *(required)* | Proxy server address |
| `port` | number | `3128` | Proxy server port |
| `targetHost` | string | `"example.com"` | Target for the CONNECT tunnel |
| `targetPort` | number | `443` | Target port for the CONNECT tunnel |
| `proxyAuth` | string | `""` | `user:password` for Proxy-Authorization Basic |
| `timeout` | number | `10000` | Outer timeout (ms) — see timeout note below |

### Wire exchange

```
→  CONNECT example.com:443 HTTP/1.1\r\n
   Host: example.com:443\r\n
   User-Agent: PortOfCall/1.0\r\n
   [Proxy-Authorization: Basic <btoa(proxyAuth)>\r\n]
   \r\n
←  HTTP/1.1 200 Connection Established\r\n
   \r\n
```

Note: No `Accept`, no `Connection: close` — unlike `/probe`.

### Response (success)

```json
{
  "success": true,
  "host": "proxy.example.com",
  "port": 3128,
  "protocol": "HTTP Proxy (CONNECT)",
  "rtt": 87,
  "tunnelEstablished": true,
  "requiresAuth": false,
  "statusCode": 200,
  "statusText": "Connection Established",
  "target": "example.com:443",
  "note": "CONNECT tunnel to example.com:443 established through proxy.example.com:3128. The proxy supports HTTP tunneling."
}
```

### `tunnelEstablished` vs `success`

- `success: true` means the proxy responded (even with 403 or 407)
- `tunnelEstablished: true` means `statusCode === 200`
- `requiresAuth: true` means `statusCode === 407`
- `authMethod` is present only when the `Proxy-Authenticate` header is set

### Response read loop

Up to **10 iterations** (vs 20 in `/probe`), stopping as soon as `\r\n\r\n` is found. No body is read — the tunnel is immediately torn down after the status response.

---

## Cross-endpoint comparison

| Aspect | `/probe` | `/connect` |
|--------|----------|------------|
| HTTP methods | GET + POST | POST only |
| Default port | 3128 | 3128 |
| User-Agent | `PortOfCall/1.0 (Proxy Probe)` | `PortOfCall/1.0` |
| `Connection: close` | Sent | Not sent |
| `Accept: */*` | Sent | Not sent |
| Read iterations | 20 | 10 |
| Read stop condition | `\r\n\r\n` found AND length > 500 | `\r\n\r\n` found |
| Inner read timeout | 5000 ms (hardcoded) | 5000 ms (hardcoded) |
| Response body | Partially read (not returned) | Not read |
| Cloudflare detection | Proxy host only | Proxy host only |
| Port validation | None | None |

---

## Timeout architecture

Two independent timers per endpoint:

1. **Outer timeout** (`timeout` field, default 10000 ms) — `Promise.race` between the full connection promise and a rejection timer. This is the one you control.

2. **Inner read timeout** (5000 ms, hardcoded) — each `reader.read()` call races against a 5-second deadline. If the proxy sends headers slowly in multiple chunks, each chunk gets a fresh 5 s window, but total read time is bounded by the outer timeout.

The inner timeout resolves with `{ value: undefined, done: true }` (simulates end-of-stream) rather than rejecting, so a slow reader gracefully stops reading and proceeds to parse whatever data has been collected.

---

## Authentication

Both endpoints accept `proxyAuth` as a `user:password` string. It's base64-encoded using `btoa()`:

```
Proxy-Authorization: Basic <btoa("user:password")>
```

**Limitation:** `btoa()` only handles ASCII (Latin-1). UTF-8 usernames/passwords with characters above U+00FF will throw.

Only **Basic** auth is supported for sending credentials. The `authMethod` field in the response reports what the proxy requested (could be `Basic`, `Digest`, `NTLM`, `Negotiate`, etc.), but only Basic credentials can be sent.

---

## Cloudflare detection

Both endpoints check only the **proxy host** (`host`) against Cloudflare IP ranges before connecting. The target (`targetUrl` / `targetHost`) is not checked — Cloudflare detection applies to whether the proxy server itself is behind Cloudflare, not whether the target website is.

Returns HTTP 403 with `{ success: false, error: "...", isCloudflare: true }`.

---

## Response header parsing

`parseHTTPResponse()` splits on `\r\n\r\n`, parses the status line with `/^HTTP\/[\d.]+ (\d+)\s*(.*)/`, and extracts headers as lowercase key→value pairs.

**Duplicate header loss:** If a proxy returns multiple headers with the same name (e.g., multiple `Set-Cookie`), only the last value is kept. The `Record<string, string>` type inherently discards earlier values.

**Status code 0:** If the first line doesn't match the HTTP status line regex, `statusCode` is `0` and `statusText` contains the raw first line. This can happen with non-HTTP services or garbled responses.

---

## Known quirks and limitations

1. **`method` field unused** — `HTTPProxyRequest` declares a `method?: string` field, but `/probe` always sends `GET`. The field has no effect.

2. **`isProxy` false positive** — Any server returning HTTP 200 is classified as a proxy. A direct web server (not a proxy) responding to a GET request will show `isProxy: true, proxyType: "Unknown"`.

3. **No port validation** — Both endpoints pass `host` and `port` directly to `connect()`. No regex or range check is applied (unlike many other workers in the project).

4. **`targetUrl` Host header extraction** — `/probe` parses `targetUrl` with `new URL()` to extract the `Host` header. If parsing fails (e.g., malformed URL), it silently defaults to `"example.com"` as the Host. The request still uses the original `targetUrl` in the GET line, creating a Host header mismatch.

5. **No HTTPS target in `/probe`** — The forward proxy test sends plaintext HTTP through the proxy. If `targetUrl` starts with `https://`, the request is still sent as a raw `GET https://...` line (which most proxies will reject or redirect). Use `/connect` for HTTPS targets.

6. **ASCII-only auth** — `btoa()` rejects strings with characters above U+00FF. Proxy credentials containing non-ASCII characters will cause a runtime error.

7. **Single TCP read limitation** — Responses larger than what's collected in 20 (probe) or 10 (connect) read iterations may be truncated. Headers split across many small TCP segments could be partially parsed.

8. **`proxyHeaders` only tracks two headers** — Only `Via` and `Proxy-Agent` are collected into the `proxyHeaders` array. Other proxy-revealing headers like `X-Cache`, `X-Cache-Lookup`, `X-Forwarded-For`, `X-Squid-Error` are not included (though they do contribute to `proxyType` detection via the keyword search).

9. **No Connection header in CONNECT** — RFC 9110 §9.3.6 does not require `Connection: close` on CONNECT, and the implementation omits it. However, some proxies may keep the connection alive after a rejected CONNECT, and the socket is torn down immediately regardless.

10. **`server` field only in `/probe`** — The `server` response header is returned in `/probe` responses but not in `/connect` responses, even though proxies often include `Server` in their CONNECT responses.

---

## curl examples

### Forward proxy probe
```bash
curl -X POST https://portofcall.example/api/httpproxy/probe \
  -H 'Content-Type: application/json' \
  -d '{"host": "proxy.example.com", "port": 3128}'

# With auth
curl -X POST https://portofcall.example/api/httpproxy/probe \
  -H 'Content-Type: application/json' \
  -d '{"host": "proxy.example.com", "port": 3128, "proxyAuth": "user:pass"}'

# GET form
curl 'https://portofcall.example/api/httpproxy/probe?host=proxy.example.com&port=3128'
```

### CONNECT tunnel test
```bash
curl -X POST https://portofcall.example/api/httpproxy/connect \
  -H 'Content-Type: application/json' \
  -d '{"host": "proxy.example.com", "port": 3128, "targetHost": "example.com", "targetPort": 443}'
```

### Test against local Squid
```bash
# Start Squid (default: port 3128, no auth)
docker run -d --name squid -p 3128:3128 ubuntu/squid

# Probe
curl -X POST http://localhost:8787/api/httpproxy/probe \
  -d '{"host": "host.docker.internal", "port": 3128}'

# CONNECT tunnel
curl -X POST http://localhost:8787/api/httpproxy/connect \
  -d '{"host": "host.docker.internal", "port": 3128, "targetHost": "example.com", "targetPort": 443}'
```
