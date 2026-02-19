# FastCGI (9000)

Port of Call's FastCGI implementation provides two endpoints for probing FastCGI servers and sending requests through the FastCGI binary protocol. Source: `src/worker/fastcgi.ts` (602 lines).

## Endpoints

| # | Endpoint | Method | Default timeout | Purpose |
|---|----------|--------|-----------------|---------|
| 1 | `/api/fastcgi/probe` | POST | 10 000 ms | FCGI_GET_VALUES — query management variables |
| 2 | `/api/fastcgi/request` | POST | 15 000 ms | Full CGI request — BEGIN_REQUEST + PARAMS + STDIN |

Both endpoints are POST-only (405 for anything else). Both validate port 1–65535 and require a non-empty `host`. Both call `checkIfCloudflare()` before connecting (403 with `isCloudflare: true` if detected).

---

## 1. POST `/api/fastcgi/probe`

Sends `FCGI_GET_VALUES` (record type 9) with `requestId=0` (management record convention per spec §3.3) to query the server's operational limits.

### Request

```json
{
  "host": "php-fpm.example.com",
  "port": 9000,
  "timeout": 10000
}
```

All fields except `host` are optional. `port` defaults to 9000. `timeout` defaults to 10 000 ms.

### Wire exchange

```
Client → Server:  FCGI_GET_VALUES (type=9, requestId=0)
                  NVP payload: FCGI_MAX_CONNS="", FCGI_MAX_REQS="", FCGI_MPXS_CONNS=""

Server → Client:  FCGI_GET_VALUES_RESULT (type=10, requestId=0)
                  NVP payload: FCGI_MAX_CONNS="10", FCGI_MAX_REQS="50", FCGI_MPXS_CONNS="0"
```

The three management variables queried:

| Variable | Meaning |
|----------|---------|
| `FCGI_MAX_CONNS` | Max simultaneous transport connections the server accepts |
| `FCGI_MAX_REQS` | Max simultaneous requests (across all connections) |
| `FCGI_MPXS_CONNS` | `"1"` if the server supports multiplexing requests on a single connection, `"0"` otherwise |

### Response

```json
{
  "success": true,
  "host": "php-fpm.example.com",
  "port": 9000,
  "protocolVersion": 1,
  "serverValues": {
    "FCGI_MAX_CONNS": "10",
    "FCGI_MAX_REQS": "50",
    "FCGI_MPXS_CONNS": "0"
  },
  "maxConns": 10,
  "maxReqs": 50,
  "multiplexing": false,
  "records": [
    { "type": "GET_VALUES_RESULT", "typeCode": 10, "requestId": 0, "contentLength": 45,
      "pairs": [{ "name": "FCGI_MAX_CONNS", "value": "10" }, ...] }
  ],
  "connectTimeMs": 12,
  "totalTimeMs": 35
}
```

**Field notes:**
- `maxConns` / `maxReqs` are `parseInt()` of the string values, or `null` if the server omits the variable.
- `multiplexing` is `true` only if `FCGI_MPXS_CONNS === "1"` (strict string comparison).
- `serverValues` is the raw string map — always strings, even for numeric values.
- The `records` array includes `pairs` only for `GET_VALUES_RESULT` records.

### Timeout architecture

The outer `timeout` bounds the entire operation (connect + send + read) via `Promise.race`. Internally, the read phase uses a *separate* inner timeout of `Math.min(5000, timeout - elapsed)`. This means:

- The read phase is capped at **5 seconds** regardless of the outer timeout.
- If you set `timeout: 30000`, the read phase still only waits 5 s for the server to respond after connecting.

---

## 2. POST `/api/fastcgi/request`

Sends a complete FastCGI request cycle: BEGIN_REQUEST → PARAMS → empty PARAMS → empty STDIN. Collects STDOUT, STDERR, and END_REQUEST records.

### Request

```json
{
  "host": "php-fpm.example.com",
  "port": 9000,
  "scriptFilename": "/var/www/html/index.php",
  "requestUri": "/",
  "serverName": "localhost",
  "timeout": 15000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | *(required)* | |
| `port` | `9000` | |
| `scriptFilename` | `"/index.php"` | Absolute filesystem path on the FastCGI server |
| `requestUri` | `"/"` | |
| `serverName` | `"localhost"` | |
| `timeout` | `15000` | ms |

### Wire exchange

```
Client → Server:  FCGI_BEGIN_REQUEST  (type=1, requestId=1, role=RESPONDER, flags=0)
Client → Server:  FCGI_PARAMS         (type=4, requestId=1, CGI env vars)
Client → Server:  FCGI_PARAMS         (type=4, requestId=1, contentLength=0)  ← end of params
Client → Server:  FCGI_STDIN          (type=5, requestId=1, contentLength=0)  ← no body

Server → Client:  FCGI_STDOUT         (type=6, response headers + body)
Server → Client:  FCGI_STDERR         (type=7, errors, if any)
Server → Client:  FCGI_END_REQUEST    (type=3, appStatus + protocolStatus)
```

### CGI parameters sent

| Parameter | Value | Notes |
|-----------|-------|-------|
| `SCRIPT_FILENAME` | user-supplied (default `"/index.php"`) | |
| `SCRIPT_NAME` | same as SCRIPT_FILENAME | |
| `REQUEST_URI` | user-supplied (default `"/"`) | |
| `DOCUMENT_URI` | same as REQUEST_URI | Not in the doc's original table |
| `QUERY_STRING` | `""` (always empty) | No way to pass query params |
| `REQUEST_METHOD` | `"GET"` (hardcoded) | |
| `SERVER_SOFTWARE` | `"PortOfCall/1.0"` | |
| `SERVER_NAME` | user-supplied (default `"localhost"`) | |
| `SERVER_PORT` | `"80"` (hardcoded) | |
| `SERVER_PROTOCOL` | `"HTTP/1.1"` | |
| `GATEWAY_INTERFACE` | `"CGI/1.1"` | |
| `REMOTE_ADDR` | `"127.0.0.1"` (hardcoded) | |
| `REMOTE_PORT` | `"0"` (hardcoded) | |
| `CONTENT_TYPE` | `""` (empty) | |
| `CONTENT_LENGTH` | `"0"` | |

### Response

```json
{
  "success": true,
  "host": "php-fpm.example.com",
  "port": 9000,
  "scriptFilename": "/var/www/html/index.php",
  "requestUri": "/",
  "exitStatus": 0,
  "protocolStatus": "Request Complete",
  "headers": {
    "Content-Type": "text/html; charset=UTF-8",
    "X-Powered-By": "PHP/8.2.0"
  },
  "body": "<!DOCTYPE html>...",
  "stderr": null,
  "records": [
    { "type": "STDOUT", "contentLength": 512 },
    { "type": "END_REQUEST", "contentLength": 8 }
  ],
  "connectTimeMs": 8,
  "totalTimeMs": 120
}
```

**Field notes:**
- `exitStatus` is the 32-bit unsigned app status from the END_REQUEST record. 0 = success.
- `protocolStatus` is one of: `"Request Complete"`, `"Cannot Multiplex"`, `"Overloaded"`, `"Unknown Role"`, or `"Unknown(N)"`. `null` if no END_REQUEST was received.
- `headers` is a flat `Record<string, string>` — **duplicate headers are lost** (e.g., multiple `Set-Cookie` headers: only the last survives).
- `body` is truncated to **10 000 characters** (JS string length, not bytes — matters for multi-byte UTF-8 content).
- `stderr` is `null` if no STDERR records were received, otherwise concatenated as string.
- `records` in the /request response do NOT include `pairs` or `requestId` (simpler shape than /probe records).

### Header parsing

STDOUT output is split on `\r\n\r\n` to separate headers from body. **Only `\r\n\r\n` is recognized** — if a FastCGI app emits `\n\n` without carriage returns (uncommon but possible), the entire STDOUT is treated as body and `headers` is `{}`.

### Timeout architecture

Same outer `Promise.race` pattern. The read-phase inner timeout is `Math.min(10000, timeout - elapsed)` — capped at **10 seconds** (vs 5 s for /probe).

---

## Shared implementation details

### Record format

Every FastCGI message uses an 8-byte header:

```
Offset  Size  Field
------  ----  -----
0       1     version (always 1)
1       1     type
2–3     2     requestId (big-endian)
4–5     2     contentLength (big-endian)
6       1     paddingLength
7       1     reserved (0)
8+      var   content (contentLength bytes)
?+      var   padding (paddingLength bytes, zeros)
```

Padding aligns total record length to 8-byte boundary: `paddingLength = (8 - (contentLength % 8)) % 8`.

### Name-value pair encoding

Used in FCGI_PARAMS and FCGI_GET_VALUES records:

```
Length < 128:   1 byte   (the length itself)
Length ≥ 128:   4 bytes  (high bit set: 0x80 | bits 30–24, then bytes 23–16, 15–8, 7–0)
```

The implementation encodes and decodes both forms correctly. Decoder stops silently (no error) if data is truncated mid-pair.

### `readAllRecords` behavior

Both endpoints use the same `readAllRecords()` function which collects socket data in a loop using `Promise.race` between `reader.read()` and a per-iteration timeout. Key behavior:

- There is **no explicit wait for END_REQUEST**. The function just reads until the inner timeout fires or the stream ends.
- If the server is slow to produce output, the inner timeout may fire before all records arrive, producing a partial result (stdout truncated, no END_REQUEST → `protocolStatus: null`, `exitStatus: -1`).
- Each successful read resets the race — the timeout applies to each individual chunk, not the total read phase.

### Error HTTP status codes

| Code | Condition |
|------|-----------|
| 400 | Missing host, invalid port |
| 403 | Cloudflare-detected host |
| 405 | Non-POST method |
| 500 | Connection failure, timeout, parse error, or any unhandled exception |

---

## Known limitations

1. **GET-only**: REQUEST_METHOD is hardcoded to `"GET"`. STDIN is always empty. No way to send POST bodies, file uploads, or custom HTTP methods.

2. **No custom CGI parameters**: The 15 CGI variables are hardcoded. Can't pass `HTTP_HOST`, `HTTP_ACCEPT`, `PHP_VALUE`, or any additional environment variables.

3. **No HTTP_* header forwarding**: Real web servers (nginx, Apache) forward HTTP request headers as `HTTP_HOST`, `HTTP_ACCEPT`, etc. This implementation doesn't.

4. **QUERY_STRING always empty**: Even if `requestUri` contains `?foo=bar`, the QUERY_STRING CGI variable is always `""`.

5. **Duplicate response headers lost**: `headers` is `Record<string, string>`. Multiple `Set-Cookie` or other multi-value headers: only last value survives.

6. **No FCGI_ABORT_REQUEST**: Can't cancel a running request. The only abort mechanism is the outer timeout.

7. **requestId hardcoded to 1**: No connection multiplexing. `flags=0` in BEGIN_REQUEST means `FCGI_KEEP_CONN` is not set — the server should close the connection after the request.

8. **Read-phase inner timeout caps**: /probe caps reads at 5 s, /request at 10 s, regardless of how large the outer `timeout` is. A slow-starting FastCGI script may timeout on the read phase even with a generous outer timeout.

9. **Body truncation is character-based**: `.substring(0, 10000)` truncates at 10 000 JS string characters, not bytes. For pure ASCII this is the same; for multi-byte UTF-8 the byte limit is effectively higher.

10. **Record version not validated**: `parseRecord()` reads the version byte but doesn't verify it's 1. Malformed or non-FastCGI data is parsed without complaint.

11. **No host regex validation**: Unlike some other Port of Call protocols, there's no regex check on the host parameter — only a truthiness check. Whitespace-only strings pass validation.

12. **SERVER_PORT hardcoded to 80**: Even when the actual FastCGI connection is on port 9000, the CGI variable says port 80. This can confuse PHP scripts that generate absolute URLs.

---

## Record type reference

| Code | Name | Direction | Used in |
|------|------|-----------|---------|
| 1 | `FCGI_BEGIN_REQUEST` | Client → Server | /request |
| 3 | `FCGI_END_REQUEST` | Server → Client | /request |
| 4 | `FCGI_PARAMS` | Client → Server | /request |
| 5 | `FCGI_STDIN` | Client → Server | /request |
| 6 | `FCGI_STDOUT` | Server → Client | /request |
| 7 | `FCGI_STDERR` | Server → Client | /request |
| 9 | `FCGI_GET_VALUES` | Client → Server | /probe |
| 10 | `FCGI_GET_VALUES_RESULT` | Server → Client | /probe |

Not used: type 2 (FCGI_ABORT_REQUEST), type 8 (FCGI_DATA), type 11 (FCGI_UNKNOWN_TYPE).

### Protocol status codes (END_REQUEST)

| Code | Name | Meaning |
|------|------|---------|
| 0 | `FCGI_REQUEST_COMPLETE` | Normal completion |
| 1 | `FCGI_CANT_MPX_CONN` | Server rejected multiplexing |
| 2 | `FCGI_OVERLOADED` | Server too busy |
| 3 | `FCGI_UNKNOWN_ROLE` | Requested role not supported |

---

## curl examples

```bash
# Probe a PHP-FPM server
curl -s -X POST http://localhost:8787/api/fastcgi/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"127.0.0.1","port":9000}' | jq .

# Send a request to execute a PHP script
curl -s -X POST http://localhost:8787/api/fastcgi/request \
  -H 'Content-Type: application/json' \
  -d '{"host":"127.0.0.1","port":9000,"scriptFilename":"/var/www/html/info.php","requestUri":"/info.php"}' | jq .

# Probe with custom timeout
curl -s -X POST http://localhost:8787/api/fastcgi/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","port":9000,"timeout":3000}' | jq .
```

## Local testing

```bash
# Start PHP-FPM with Docker
docker run -d -p 9000:9000 --name php-fpm php:8.2-fpm

# Create a test script inside the container
docker exec php-fpm bash -c 'echo "<?php phpinfo();" > /var/www/html/info.php'

# Probe
curl -s -X POST http://localhost:8787/api/fastcgi/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"host.docker.internal","port":9000}' | jq .

# Request
curl -s -X POST http://localhost:8787/api/fastcgi/request \
  -H 'Content-Type: application/json' \
  -d '{"host":"host.docker.internal","port":9000,"scriptFilename":"/var/www/html/info.php","requestUri":"/info.php"}' | jq .
```
