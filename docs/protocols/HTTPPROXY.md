# HTTP Proxy / CONNECT (RFC 9110 §9.3.6)

## Overview

**HTTP Proxy** is an application-layer proxy protocol that allows clients to route HTTP (and HTTPS via CONNECT tunneling) traffic through an intermediary server. HTTP proxies are widely deployed for caching, content filtering, access control, and anonymization.

**Port:** 3128 (Squid default), 8080, 8888 (common alternatives)
**Transport:** TCP
**RFCs:** RFC 9110 (HTTP Semantics), RFC 7231, RFC 7235 (proxy authentication)

## Protocol Modes

### 1. Forward Proxy (GET http://...)

The client sends an absolute-URI request to the proxy:

```
GET http://example.com/ HTTP/1.1
Host: example.com
User-Agent: ...
Connection: close

```

The proxy fetches the resource on behalf of the client and returns the response.

**Use cases:** HTTP traffic proxying, caching, content filtering

### 2. CONNECT Tunnel (RFC 9110 §9.3.6)

The client sends a CONNECT request asking the proxy to establish a raw TCP tunnel:

```
CONNECT example.com:443 HTTP/1.1
Host: example.com:443
User-Agent: ...

```

On success, the proxy responds with `HTTP/1.1 200 Connection Established` and then relays raw bytes bidirectionally between the client and the target. This is the standard mechanism for HTTPS-over-proxy.

**Use cases:** HTTPS proxying, tunneling any TCP protocol through an HTTP proxy

## Status Codes

| Code | Meaning |
|------|---------|
| 200 | Connection established (CONNECT success) |
| 407 | Proxy Authentication Required |
| 403 | Forbidden (proxy policy blocks request) |
| 404 | Not Found |
| 502 | Bad Gateway (proxy cannot reach target) |
| 503 | Service Unavailable |

## Authentication

Proxies that require authentication respond with `407 Proxy Authentication Required` and a `Proxy-Authenticate` header specifying the method (usually `Basic` or `Digest`). The client retries with a `Proxy-Authorization` header:

```
Proxy-Authorization: Basic dXNlcjpwYXNz
```

## Proxy Identification

Many proxies reveal their identity via response headers:

| Header | Example |
|--------|---------|
| `Via` | `1.1 squid/4.15` |
| `Proxy-Agent` | `Squid/4.15` |
| `Server` | `nginx/1.18.0` |
| `X-Cache` | `HIT from squid` |

## Implementation Details

### Worker Handler

- **`handleHTTPProxyProbe`** — Sends `GET http://... HTTP/1.1` to the proxy and reads the response. Reports proxy type, status code, and proxy-specific headers.
- **`handleHTTPProxyConnect`** — Sends `CONNECT host:port HTTP/1.1` and reads until `\r\n\r\n`. Reports whether the tunnel was established (200) or authentication is required (407).

### Routes

```
POST /api/httpproxy/probe   — Forward proxy test
GET  /api/httpproxy/probe   — Forward proxy test (query params)
POST /api/httpproxy/connect — CONNECT tunnel test
```

### Security

- Cloudflare detection runs before any connection attempt
- Input validation on host and port
- Proxy-Authorization credentials are base64-encoded (Basic auth) — never logged

## Common Proxy Software

| Software | Default Port | Notes |
|----------|-------------|-------|
| Squid | 3128 | Most common; full feature set |
| Nginx | 8080 | `ngx_http_proxy_module` |
| Apache | 8080 | `mod_proxy` |
| HAProxy | 3128/8080 | Load balancer with proxy support |
| Tinyproxy | 8888 | Lightweight; minimal config |
| Privoxy | 8118 | Privacy-focused; ad blocking |
| 3proxy | 3128 | Multi-protocol proxy |

## Comparison with SOCKS Proxies

| Feature | HTTP Proxy | SOCKS4 | SOCKS5 |
|---------|-----------|--------|--------|
| Layer | Application (HTTP) | Transport | Transport |
| Protocols | HTTP + CONNECT tunnel | TCP only | TCP + UDP |
| Authentication | Basic/Digest | User ID only | Username/password |
| DNS resolution | At proxy | At client | At proxy (SOCKS5a) |
| Content filtering | Yes | No | No |
| Caching | Yes | No | No |

## Resources

- [RFC 9110 §9.3.6 — CONNECT](https://www.rfc-editor.org/rfc/rfc9110#section-9.3.6)
- [RFC 7235 — HTTP Authentication](https://www.rfc-editor.org/rfc/rfc7235)
- [Squid Proxy Documentation](http://www.squid-cache.org/Doc/)
