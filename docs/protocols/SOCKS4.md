# SOCKS4 — Port 1080

TCP proxy protocol (Ying-Da Lee, ~1994). Two endpoints with different parameter names and capabilities.

Implementation: `src/worker/socks4.ts` — 557 lines, no external dependencies.

## Endpoints

| # | Endpoint | Method | Default timeout | Purpose |
|---|----------|--------|-----------------|---------|
| 1 | `/api/socks4/connect` | any | 10 000 ms | Basic SOCKS4/4a CONNECT — grant/reject only |
| 2 | `/api/socks4/relay` | any | 15 000 ms | Enhanced CONNECT with HTTP tunnel verification |

Neither endpoint enforces POST-only — any HTTP method is accepted (no 405).
Neither endpoint calls `checkIfCloudflare()` — Cloudflare-protected hosts are **not** blocked.

---

## 1. `/api/socks4/connect`

Basic SOCKS4/4a CONNECT. Sends the connection request to the proxy server, reads the 8-byte reply, and reports grant/reject.

### Request

```json
{
  "proxyHost": "proxy.example.com",
  "proxyPort": 1080,
  "destHost": "httpbin.org",
  "destPort": 80,
  "userId": "",
  "useSocks4a": true,
  "timeout": 10000
}
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `proxyHost` | yes | — | No Cloudflare detection |
| `proxyPort` | no | 1080 | Validated 1–65535 |
| `destHost` | yes | — | Target behind the proxy |
| `destPort` | yes | — | Validated 1–65535; falsy values (0, undefined) rejected |
| `userId` | no | `""` | Null-terminated in wire format |
| `useSocks4a` | no | `true` | Append hostname after userId for proxy-side DNS |
| `timeout` | no | 10000 | Outer timeout (ms) wrapping connect + write + read |

### Response

```json
{
  "success": true,
  "granted": true,
  "responseCode": 90,
  "responseMessage": "Request granted",
  "boundAddress": "0.0.0.0",
  "boundPort": 0
}
```

**`success` is always `true` when the proxy responds** — even if `granted` is `false`. The only way `success` is `false` is if the connection itself fails (timeout, TCP RST, parse error).

### Wire exchange

```
Client → Proxy:  VN=0x04, CD=0x01, DSTPORT(2), DSTIP(4), USERID, 0x00 [, HOSTNAME, 0x00]
Proxy → Client:  VN=0x00, CD(1), DSTPORT(2), DSTIP(4)
                 [connection closed by client]
```

### Quirks

**`useSocks4a=false` with hostname `destHost` sends invalid IP 0.0.0.1.** The `hostnameToIP()` function always returns `[0, 0, 0, 1]` for non-IP strings. When `useSocks4a=false`, this sentinel IP is sent without the appended hostname — the proxy receives a SOCKS4 request to connect to `0.0.0.1`, which is nonsensical. The proxy will typically reject it (0x5B).

**Single `reader.read()` may return excess bytes.** The response parser expects exactly 8 bytes, but `reader.read()` can return more (e.g., if the proxy starts forwarding data immediately after the grant). The parser only looks at the first 8 bytes; excess bytes are silently discarded. This is fine for the connect test but means you cannot use the tunnel data.

**No IP octet validation.** `hostnameToIP()` uses `parseInt()` on regex-matched octets without range checking. An input like `300.1.2.3` matches the IPv4 regex and produces `Uint8Array([44, 1, 2, 3])` (300 truncated to 44 via Uint8Array clamping).

---

## 2. `/api/socks4/relay`

Enhanced handler: after obtaining a CONNECT grant, sends an HTTP `HEAD / HTTP/1.0` request through the tunnel and checks for an `HTTP/` response prefix to verify the tunnel is live.

### Request

```json
{
  "host": "proxy.example.com",
  "port": 1080,
  "targetHost": "httpbin.org",
  "targetPort": 80,
  "userId": "",
  "timeout": 15000
}
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `host` | yes | — | Proxy host; validated non-empty + trimmed |
| `port` | no | 1080 | Validated 1–65535 |
| `targetHost` | yes | — | Validated non-empty + trimmed |
| `targetPort` | yes | — | Validated 1–65535; falsy values rejected |
| `userId` | no | `""` | |
| `timeout` | no | 15000 | Outer timeout (ms) |

**No `useSocks4a` parameter.** SOCKS4a is auto-detected: if `targetHost` is not a dotted-decimal IPv4 address (per `/^(\d{1,3}\.){3}\d{1,3}$/`), the handler uses the `0.0.0.1` sentinel IP and appends the hostname.

### Response

```json
{
  "success": true,
  "host": "proxy.example.com",
  "port": 1080,
  "targetHost": "httpbin.org",
  "targetPort": 80,
  "isSocks4a": true,
  "grantCode": 90,
  "grantText": "Request granted",
  "granted": true,
  "boundAddress": "0.0.0.0",
  "boundPort": 0,
  "tunnelVerified": true,
  "rtt": 145
}
```

**`success` is always `true` when the proxy replies** — same gotcha as `/connect`. `granted` indicates whether the proxy accepted the CONNECT.

### Tunnel verification

After a grant (`0x5A`), the handler:

1. Sends `HEAD / HTTP/1.0\r\nHost: {targetHost}\r\nConnection: close\r\n\r\n` through the tunnel.
2. Reads up to 512 bytes, looking for a response starting with `HTTP/`.
3. If found, `tunnelVerified: true`. If not (timeout or non-HTTP target), `tunnelVerified: false`.

Verification timeout: `min(5000, max(1000, timeout - elapsed - 200))` ms. This is best-effort — non-HTTP targets (SSH, SMTP, etc.) will return `tunnelVerified: false` even though the tunnel is functional.

### Wire exchange

```
Client → Proxy:  SOCKS4/4a CONNECT request
Proxy → Client:  8-byte reply (VN=0x00, CD, DSTPORT, DSTIP)

  [if granted:]
Client → Target: HEAD / HTTP/1.0\r\nHost: targetHost\r\nConnection: close\r\n\r\n
Target → Client: HTTP/1.0 200 OK\r\n... (or HTTP/1.1...)
                 [connection closed]
```

### Quirks

**`isIPv4` regex matches invalid IPs.** The regex `/^(\d{1,3}\.){3}\d{1,3}$/` matches `999.999.999.999` or `256.0.0.1`. If these pass the regex, they're split and used as octet bytes (Uint8Array clamps 256→0, 999→231). In practice, users don't send these.

**`readExactly` may over-read.** `readExactly(reader, 8, ...)` reads until `total >= 8`, then does `combined.slice(0, 8)`. If a single `reader.read()` returns 100 bytes (the SOCKS reply plus forwarded data), only the first 8 are used. The extra bytes are lost — the tunnel data that arrived early is consumed and discarded.

**Tunnel verification mutates the connection.** The HTTP HEAD request is sent through the proxy tunnel. After verification, the socket is closed. You cannot reuse the tunnel for additional requests.

---

## Parameter naming differences

The two endpoints use inconsistent field names for the same concepts:

| Concept | `/connect` | `/relay` |
|---------|-----------|---------|
| Proxy host | `proxyHost` | `host` |
| Proxy port | `proxyPort` | `port` |
| Target host | `destHost` | `targetHost` |
| Target port | `destPort` | `targetPort` |
| SOCKS4a mode | `useSocks4a` (manual, default `true`) | auto-detect (no field) |
| Default timeout | 10 000 ms | 15 000 ms |

Response field naming also differs:

| Concept | `/connect` | `/relay` |
|---------|-----------|---------|
| Reply code | `responseCode` | `grantCode` |
| Reply text | `responseMessage` | `grantText` |
| Grant boolean | `granted` | `granted` |
| Bound address | `boundAddress` | `boundAddress` |
| Bound port | `boundPort` | `boundPort` |
| Timing | — | `rtt` |
| SOCKS4a used | — | `isSocks4a` |
| Tunnel test | — | `tunnelVerified` |

---

## SOCKS4 reply codes

| Code | Hex | Name |
|------|-----|------|
| 90 | 0x5A | Request granted |
| 91 | 0x5B | Request rejected or failed |
| 92 | 0x5C | Request failed (client not reachable — identd) |
| 93 | 0x5D | Request failed (userid mismatch — identd) |

Reply byte 0 (VN) must be `0x00` (not `0x04`). Both handlers validate this and throw on mismatch.

---

## SOCKS4 packet format

### Client → Proxy (CONNECT request)

```
Byte 0:     VN = 0x04
Byte 1:     CD = 0x01 (CONNECT)
Byte 2-3:   DSTPORT (big-endian)
Byte 4-7:   DSTIP (4 bytes; 0.0.0.x for SOCKS4a)
Byte 8+:    USERID (variable, may be empty)
Next:       0x00 (null terminator for USERID)
[SOCKS4a:]  HOSTNAME (variable)
            0x00 (null terminator for HOSTNAME)
```

### Proxy → Client (reply)

```
Byte 0:     VN = 0x00
Byte 1:     CD (reply code: 0x5A–0x5D)
Byte 2-3:   DSTPORT (bound port, big-endian)
Byte 4-7:   DSTIP (bound address)
```

---

## Known limitations

1. **CONNECT only.** BIND (command 0x02) is not implemented. FTP PORT-mode through SOCKS4 is not supported.

2. **IPv4 only.** SOCKS4 has no IPv6 support by design. Use SOCKS5 (`/api/socks5/`) for IPv6.

3. **No Cloudflare detection.** Unlike most other Port of Call protocols, neither endpoint checks whether the proxy host resolves to Cloudflare IPs.

4. **No HTTP method restriction.** Both endpoints accept GET, POST, PUT, DELETE, etc. No 405 response.

5. **No encryption.** SOCKS4 is plaintext. Credentials in `userId` are sent in the clear. Use SSH tunneling for secure proxy access.

6. **No authentication.** The `userId` field is an identifier, not a password. SOCKS4 servers may use it for ident-based access control (RFC 1413), but most modern proxies ignore it.

7. **`success:true` with `granted:false`.** Both endpoints return `success: true` when the proxy responds, regardless of whether the CONNECT was granted. Always check the `granted` field.

8. **Tunnel data lost after verification.** In `/relay`, any data the target sends alongside or after the HTTP response is consumed and discarded when the socket is closed.

9. **`/relay` always sends HTTP HEAD.** Even for non-HTTP targets (e.g., SSH on port 22), the handler sends an HTTP request through the tunnel. This pollutes the target's input stream but is harmless since the socket is immediately closed.

10. **No UDP support.** SOCKS4 is TCP-only by protocol design.

---

## Error HTTP status codes

| Code | Condition |
|------|-----------|
| 400 | Missing required field, invalid port |
| 500 | Connection failure, timeout, invalid SOCKS reply, any unhandled error |

---

## curl examples

```bash
# Basic SOCKS4 connect test
curl -s -X POST http://localhost:8787/api/socks4/connect \
  -H 'Content-Type: application/json' \
  -d '{"proxyHost":"proxy.example.com","proxyPort":1080,"destHost":"httpbin.org","destPort":80}' | jq .

# Relay with tunnel verification (HTTP target)
curl -s -X POST http://localhost:8787/api/socks4/relay \
  -H 'Content-Type: application/json' \
  -d '{"host":"proxy.example.com","port":1080,"targetHost":"httpbin.org","targetPort":80}' | jq .

# Relay to non-HTTP target (tunnelVerified will be false)
curl -s -X POST http://localhost:8787/api/socks4/relay \
  -H 'Content-Type: application/json' \
  -d '{"host":"proxy.example.com","port":1080,"targetHost":"mail.example.com","targetPort":25}' | jq .

# SOCKS4 (no 4a) with explicit IP
curl -s -X POST http://localhost:8787/api/socks4/connect \
  -H 'Content-Type: application/json' \
  -d '{"proxyHost":"proxy.example.com","proxyPort":1080,"destHost":"93.184.216.34","destPort":80,"useSocks4a":false}' | jq .

# With custom userId
curl -s -X POST http://localhost:8787/api/socks4/connect \
  -H 'Content-Type: application/json' \
  -d '{"proxyHost":"proxy.example.com","destHost":"httpbin.org","destPort":80,"userId":"testuser"}' | jq .
```

## Local testing

```bash
# Start a SOCKS4 proxy with Dante or microsocks
docker run -d -p 1080:1080 serjs/go-socks5-proxy

# Or use SSH as a SOCKS proxy
ssh -D 1080 -N user@remote-host

# Test connect
curl -s -X POST http://localhost:8787/api/socks4/connect \
  -H 'Content-Type: application/json' \
  -d '{"proxyHost":"127.0.0.1","proxyPort":1080,"destHost":"httpbin.org","destPort":80}' | jq .
```

Note: Many modern SOCKS proxies are SOCKS5-only. Verify your proxy supports SOCKS4/4a before testing.

## References

- [SOCKS4 Protocol](https://www.openssh.com/txt/socks4.protocol) — Ying-Da Lee, NEC
- [SOCKS4a Extension](https://www.openssh.com/txt/socks4a.protocol) — Ying-Da Lee, NEC
