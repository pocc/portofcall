# AJP (Apache JServ Protocol) — Power-User Reference

**Port:** 8009 (TCP)
**Spec:** [AJP/1.3](https://tomcat.apache.org/connectors-doc/ajp/ajpv13a.html)
**Implementation:** `src/worker/ajp.ts`
**Endpoints:** 2 (`/api/ajp/connect`, `/api/ajp/request`)

---

## Endpoints

### `POST /api/ajp/connect` — CPing/CPong probe

Sends a CPing packet and validates the CPong response. Confirms an AJP connector (Tomcat, Jetty) is listening.

**Request:**

```json
{
  "host": "tomcat.example.com",
  "port": 8009,
  "timeout": 10000
}
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `host` | yes | — | Target hostname or IP |
| `port` | no | `8009` | Target port |
| `timeout` | no | `10000` | Milliseconds |

**Success response:**

```json
{
  "success": true,
  "host": "tomcat.example.com",
  "port": 8009,
  "protocol": "AJP/1.3",
  "rtt": 12,
  "cpong": true,
  "message": "AJP connector responded with valid CPong in 12ms"
}
```

**Invalid-CPong response** (success: false, HTTP 200 — not 500):

```json
{
  "success": false,
  "host": "...",
  "port": 8009,
  "rtt": 5,
  "error": "Unexpected response: magic=0x0000, length=0, type=0x00",
  "rawHex": "00 00 00 00 00"
}
```

**Wire exchange:**

```
Client → Server:  12 34 00 01 0A                     (CPing: magic 0x1234, length 1, type 0x0A)
Server → Client:  41 42 00 01 09                     (CPong: magic "AB", length 1, type 0x09)
```

The probe reads exactly 5 bytes via `readExact()`. If the server sends something other than CPong (e.g. an HTTP error page), only the first 5 bytes are captured in `rawHex`.

---

### `POST /api/ajp/request` — Forward HTTP request via AJP13

Sends an AJP13 Forward Request (type 0x02) and parses the multi-packet response (SEND_HEADERS + SEND_BODY_CHUNK + END_RESPONSE).

**Request:**

```json
{
  "host": "tomcat.example.com",
  "port": 8009,
  "method": "GET",
  "path": "/",
  "headers": { "Accept": "text/html" },
  "body": null,
  "timeout": 15000
}
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `host` | yes | — | Target hostname or IP |
| `port` | no | `8009` | Target port |
| `method` | no | `"GET"` | HTTP method (see method code table below) |
| `path` | no | `"/"` | Request URI |
| `headers` | no | `{}` | Additional headers (Host is auto-set to `host`) |
| `body` | no | — | Request body string. Auto-sets Content-Length if present |
| `timeout` | no | `15000` | Milliseconds for entire operation |

**Success response:**

```json
{
  "success": true,
  "host": "tomcat.example.com",
  "port": 8009,
  "method": "GET",
  "path": "/",
  "rtt": 45,
  "statusCode": 200,
  "statusMessage": "OK",
  "responseHeaders": {
    "content-type": "text/html;charset=UTF-8",
    "content-length": "1234"
  },
  "body": "<!DOCTYPE html>...",
  "bytesReceived": 1456,
  "packetCount": 3,
  "protocol": "AJP/1.3",
  "message": "AJP forward request completed: HTTP 200 OK"
}
```

**`success` criteria:** `statusCode >= 200 && statusCode < 500`. A 404 or 302 is `success: true`. A 500+ is `success: false`.

---

## Wire Protocol Details

### Packet framing

| Direction | Magic bytes | Meaning |
|-----------|-------------|---------|
| Client → Server | `0x12 0x34` | Forward Request / CPing / body data |
| Server → Client | `0x41 0x42` ("AB") | Response packets |

After magic: 2-byte big-endian length, then payload.

### AJP string encoding

All strings in AJP packets use: `[2-byte big-endian length][UTF-8 bytes][0x00 null terminator]`. The length field does NOT include the null terminator.

### Forward Request packet layout

```
[0x12][0x34][body-length 2B]
  [0x02]                          -- message type: FORWARD_REQUEST
  [method-code 1B]                -- see method code table
  [protocol AJP-string]           -- "HTTP/1.1"
  [request-URI AJP-string]
  [remote-addr AJP-string]        -- hardcoded "127.0.0.1"
  [remote-host AJP-string]        -- hardcoded "localhost"
  [server-name AJP-string]        -- set to `host`
  [server-port 2B]                -- see port logic below
  [is-ssl 1B]                     -- 0x01 if port==443, else 0x00
  [num-headers 2B]
  [headers...]                    -- common headers use 0xA0xx codes
  [0xFF]                          -- attribute terminator
```

### Method code table

| Method | Code | Method | Code |
|--------|------|--------|------|
| GET | 2 | PUT | 5 |
| HEAD | 3 | DELETE | 7 |
| POST | 4 | OPTIONS | 8 |
| | | TRACE | 9 |

Unknown methods default to code `2` (GET) via `AJP_METHODS[method.toUpperCase()] ?? 2`.

**Spec divergence:** The AJP/1.3 spec defines DELETE as code 6 and OPTIONS as code 1, but this implementation uses DELETE=7 and OPTIONS=8. The PROPFIND/PROPPATCH/MKCOL/COPY/MOVE/LOCK/UNLOCK WebDAV codes (8-14 in the spec) are not mapped.

### Common request header codes (0xA0xx)

When a header name matches one of 14 well-known names, its name is encoded as a 2-byte code instead of an AJP string:

| Code | Header | Code | Header |
|------|--------|------|--------|
| 0xA001 | accept | 0xA008 | content-length |
| 0xA002 | accept-charset | 0xA009 | cookie |
| 0xA003 | accept-encoding | 0xA00A | cookie2 |
| 0xA004 | accept-language | 0xA00B | host |
| 0xA005 | authorization | 0xA00C | pragma |
| 0xA006 | connection | 0xA00D | referer |
| 0xA007 | content-type | 0xA00E | user-agent |

Headers not in this table are sent as full AJP strings.

### Response header codes (0xA0xx)

| Code | Header | Code | Header |
|------|--------|------|--------|
| 0xA001 | Content-Type | 0xA007 | Set-Cookie |
| 0xA002 | Content-Language | 0xA008 | Set-Cookie2 |
| 0xA003 | Content-Length | 0xA009 | Servlet-Engine |
| 0xA004 | Date | 0xA00A | Status |
| 0xA005 | Last-Modified | 0xA00B | WWW-Authenticate |
| 0xA006 | Location | | |

Unrecognized response header codes become `header-0x{code}`.

### Response packet types

| Code | Name | Meaning |
|------|------|---------|
| 0x03 | SEND_HEADERS | Status code + status message + response headers |
| 0x04 | SEND_BODY_CHUNK | Body data chunk: [chunk-length 2B][data] |
| 0x05 | END_RESPONSE | End of response. Byte 0 of data = reuse flag (1 = keep connection) |
| 0x06 | GET_BODY_CHUNK | Server requests more body data (currently a no-op — no data sent) |

---

## Quirks and Limitations

### Port/SSL logic in `/request`

The implementation derives `serverPort` and `isSsl` from the `port` parameter:

```
port == 443  → serverPort=443, isSsl=true
port == 8009 → serverPort=80,  isSsl=false
other        → serverPort=port, isSsl=false
```

This means if you're probing Tomcat on port 8080, the AJP packet will report `serverPort=8080, isSsl=false`, which is correct. But there's no way to manually set `isSsl=true` for a non-443 port or override `serverPort` independently.

### Hardcoded remote address fields

`remote_addr` is always `"127.0.0.1"` and `remote_host` is always `"localhost"` in the Forward Request. These are not configurable. This means Tomcat's `request.getRemoteAddr()` will always see `127.0.0.1`, which may bypass IP-based access controls on the backend.

### Host header auto-injection

The `Host` header is always set to the `host` value from the request body, even if a different `Host` header is provided in `headers`. User-supplied headers are merged after, so a custom `host` (lowercase) in `headers` will override.

### Body handling

When `body` is provided:
1. A body data packet is sent: `[0x12][0x34][length+2 2B][chunk-length 2B][data]`
2. An empty terminator packet follows: `[0x12][0x34][0x00][0x02][0x00][0x00]`
3. Content-Length is auto-set if not already in `headers`

**GET_BODY_CHUNK (0x06) is not handled** — if the server requests additional body chunks (e.g. for chunked transfer), no response is sent. This can cause the server to hang until timeout for large POST bodies that exceed the initial chunk.

### Response body truncation

`readAJPResponse()` assembles all SEND_BODY_CHUNK packets but truncates the decoded body string to **4,000 characters** (`substring(0, 4000)`). The `bytesReceived` field reflects total wire bytes, not the truncated body length.

### No method validation

Any HTTP method string is accepted. Unknown methods silently map to GET (code 2). No warning is returned.

### No port validation

Neither endpoint validates that `port` is in the 1-65535 range.

### No attributes

The Forward Request always ends with a bare `0xFF` terminator — no AJP request attributes (e.g. `?context`, `?servlet_path`, `?remote_user`, `?auth_type`, `?route`, `?ssl_cert`, `?ssl_cipher`, `?ssl_session`, `?ssl_key_size`) are ever sent.

### Response timeout arithmetic

In `/request`, the response read timeout is `max(timeout - connectRtt, 3000)` ms. This means at least 3 seconds is always available for reading the response, even if the overall timeout has nearly expired.

### Cloudflare detection

Both endpoints check `checkIfCloudflare(host)` before connecting. Returns HTTP 403 with `isCloudflare: true` if the host resolves to a Cloudflare IP.

### readExact excess-byte discard

The `readExact()` function in `/connect` reads exactly N bytes but silently discards any excess bytes in the last TCP read. Since CPong is exactly 5 bytes, this is harmless — but if a server sends additional data after CPong, it is lost.

### Response header casing

All response header names are lowercased before storage (`responseHeaders[headerName.toLowerCase()]`). Common headers from the 0xA0xx table are initially mixed-case (e.g. `Content-Type`) but get lowercased. Duplicate header names overwrite — only the last value is kept.

---

## curl Examples

```bash
# CPing/CPong probe
curl -s -X POST http://localhost:8787/api/ajp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"tomcat.example.com"}' | jq

# Forward GET request
curl -s -X POST http://localhost:8787/api/ajp/request \
  -H 'Content-Type: application/json' \
  -d '{"host":"tomcat.example.com","path":"/status"}' | jq

# Forward POST with body
curl -s -X POST http://localhost:8787/api/ajp/request \
  -H 'Content-Type: application/json' \
  -d '{"host":"tomcat.example.com","method":"POST","path":"/api/login","headers":{"content-type":"application/x-www-form-urlencoded"},"body":"user=admin&pass=secret"}' | jq

# Ghostcat-style path traversal test (CVE-2020-1938)
# Tomcat AJP connectors before 9.0.31 / 8.5.51 / 7.0.100 allow
# reading arbitrary files via request attributes. This implementation
# cannot exploit Ghostcat because it sends no AJP attributes (0xFF terminator only).
```

## Local Testing

```bash
# Run Tomcat with AJP connector (default port 8009)
docker run -d --name tomcat -p 8009:8009 -p 8080:8080 tomcat:9

# Verify AJP is listening
curl -s -X POST http://localhost:8787/api/ajp/connect \
  -d '{"host":"host.docker.internal","port":8009}' | jq

# Forward a request through AJP
curl -s -X POST http://localhost:8787/api/ajp/request \
  -d '{"host":"host.docker.internal","path":"/"}' | jq
```

## Per-Endpoint Quick Reference

| | `/connect` | `/request` |
|---|---|---|
| Method | POST only | POST only |
| Default port | 8009 | 8009 |
| Default timeout | 10,000 ms | 15,000 ms |
| CF detection | yes | yes |
| Port validation | no | no |
| success criteria | exact CPong match | statusCode 200-499 |
| Response body | — | truncated to 4,000 chars |
