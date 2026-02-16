# HTTP Proxy Protocol (Port 3128/8080/8888)

## Overview
HTTP proxies operate at the application layer, forwarding HTTP requests and establishing TCP tunnels via the CONNECT method. Unlike SOCKS proxies which operate at the transport layer, HTTP proxies understand HTTP semantics and can cache, filter, and modify traffic.

- **Default Ports:** 3128 (Squid), 8080, 8888
- **Transport:** TCP (HTTP over TCP)
- **RFCs:** RFC 9110 (HTTP Semantics), RFC 7230 (HTTP/1.1 Message Syntax)
- **Status:** Active — widely deployed for enterprise, ISP, and CDN use

## Proxy Modes

### 1. Forward Proxy (GET/HEAD with absolute-URI)
```
Client                          HTTP Proxy                       Target Server
  |                                |                                    |
  | GET http://example.com/ HTTP/1.1                                    |
  | Host: example.com              |                                    |
  | --------------------------->   |                                    |
  |                                | GET / HTTP/1.1                     |
  |                                | Host: example.com                  |
  |                                | -------------------------------->  |
  |                                |                                    |
  |                                | <--- 200 OK + body -----------    |
  | <-- 200 OK + body ----------   |                                    |
```

### 2. CONNECT Tunnel (for HTTPS and other protocols)
```
Client                          HTTP Proxy                       Target Server
  |                                |                                    |
  | CONNECT example.com:443 HTTP/1.1                                    |
  | Host: example.com:443          |                                    |
  | --------------------------->   |                                    |
  |                                | --- TCP connect to :443 -------->  |
  |                                |                                    |
  | <-- 200 Connection established |                                    |
  |                                |                                    |
  | ============== TLS/raw TCP tunnel ==============>                   |
```

## Implementation Details

### Worker Endpoints

#### `POST /api/httpproxy/probe` (or `GET` with query params)
Test if a host is an HTTP proxy by sending a forward proxy GET request.

**Request Body:**
```json
{
  "host": "proxy.example.com",
  "port": 3128,
  "targetUrl": "http://example.com/",
  "proxyAuth": "username:password",
  "timeout": 10000
}
```

**Response:**
```json
{
  "success": true,
  "host": "proxy.example.com",
  "port": 3128,
  "protocol": "HTTP Proxy",
  "rtt": 85,
  "isProxy": true,
  "proxyType": "Squid",
  "requiresAuth": false,
  "statusCode": 200,
  "statusText": "OK",
  "targetUrl": "http://example.com/",
  "proxyHeaders": ["Via: 1.1 squid (squid/6.6)"],
  "server": "squid/6.6"
}
```

#### `POST /api/httpproxy/connect`
Test CONNECT tunnel capability.

**Request Body:**
```json
{
  "host": "proxy.example.com",
  "port": 3128,
  "targetHost": "example.com",
  "targetPort": 443,
  "proxyAuth": "username:password",
  "timeout": 10000
}
```

**Response:**
```json
{
  "success": true,
  "host": "proxy.example.com",
  "port": 3128,
  "protocol": "HTTP Proxy (CONNECT)",
  "rtt": 120,
  "tunnelEstablished": true,
  "statusCode": 200,
  "statusText": "Connection established",
  "target": "example.com:443"
}
```

### Proxy Detection
The probe identifies proxy type from response headers:
- **Via** header (e.g., `Via: 1.1 squid`)
- **Proxy-Agent** header
- **Server** header strings (Squid, Nginx, Apache, HAProxy, Varnish, Tinyproxy, Privoxy)

### Authentication
- **407 Proxy Authentication Required** — proxy needs credentials
- **Proxy-Authenticate** header reveals auth method (Basic, Digest, NTLM)
- Credentials sent via `Proxy-Authorization: Basic <base64(user:pass)>`

### Timeouts
- Connection timeout: 10 seconds (configurable)
- Response read timeout: 5 seconds
- Workers execution time limits apply

## Proxy Comparison

| Type | Layer | Protocols | Auth | Caching |
|------|-------|-----------|------|---------|
| **HTTP Proxy** | Application (L7) | HTTP/HTTPS | Basic, Digest, NTLM | Yes |
| SOCKS4 | Transport (L4) | Any TCP | None | No |
| SOCKS5 | Transport (L4) | TCP + UDP | Username/password | No |
| Transparent Proxy | L3/L7 | HTTP | None (invisible) | Yes |

## Common HTTP Proxy Software
- **Squid** — Most popular open-source HTTP proxy (port 3128)
- **Nginx** — Reverse proxy / forward proxy via stream module
- **Apache** — mod_proxy for forward/reverse proxying
- **HAProxy** — High-performance TCP/HTTP load balancer
- **Tinyproxy** — Lightweight HTTP proxy for Unix
- **Privoxy** — Privacy-focused non-caching proxy
- **CCProxy** — Windows proxy server
- **mitmproxy** — Interactive HTTPS proxy for debugging
