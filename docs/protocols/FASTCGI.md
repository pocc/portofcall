# FastCGI Protocol Implementation

## Overview

FastCGI is a binary protocol for communication between web servers and application servers. Unlike traditional CGI which spawns a new process per request, FastCGI keeps application processes alive in a pool, dramatically reducing overhead.

- **Port**: 9000 (default)
- **Transport**: TCP
- **Spec**: [FastCGI Specification](https://fastcgi-com.github.io/fcgi2/doc/spec.html) by Open Market, Inc. (1996)
- **Use Cases**: PHP-FPM, Python WSGI (flup), Ruby, web application backend health checks

## Protocol Structure

### Record Format

Every FastCGI message is framed as a record with an 8-byte header:

```
Offset  Size  Description
------  ----  -----------
0       1     version (always 1)
1       1     type (record type)
2-3     2     requestId (big-endian)
4-5     2     contentLength (big-endian)
6       1     paddingLength
7       1     reserved (0)
8+      var   content (contentLength bytes)
?+      var   padding (paddingLength bytes)
```

Padding aligns records to 8-byte boundaries: `paddingLength = (8 - (contentLength % 8)) % 8`.

### Record Types

| Code | Name                  | Direction       | Description                         |
|------|-----------------------|-----------------|-------------------------------------|
| 1    | FCGI_BEGIN_REQUEST    | Client → Server | Start a new request                 |
| 2    | FCGI_ABORT_REQUEST    | Client → Server | Abort an in-progress request        |
| 3    | FCGI_END_REQUEST      | Server → Client | End of request with exit status     |
| 4    | FCGI_PARAMS           | Client → Server | CGI environment variables (NVP)     |
| 5    | FCGI_STDIN            | Client → Server | Request body (empty to signal EOF)  |
| 6    | FCGI_STDOUT           | Server → Client | Response headers + body             |
| 7    | FCGI_STDERR           | Server → Client | Error output                        |
| 9    | FCGI_GET_VALUES       | Client → Server | Query management variables          |
| 10   | FCGI_GET_VALUES_RESULT| Server → Client | Management variable response        |

### Name-Value Pair Encoding

Used in FCGI_PARAMS and FCGI_GET_VALUES records:

```
if length < 128:  encode as 1 byte
else:             encode as 4 bytes with high bit set (0x80 | high 7 bits of 32-bit length)
```

## Endpoints

### POST /api/fastcgi/probe

Sends `FCGI_GET_VALUES` to query the server's management variables.

**Request:**
```json
{
  "host": "php-fpm.example.com",
  "port": 9000,
  "timeout": 10000
}
```

**Success Response:**
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
    { "type": "GET_VALUES_RESULT", "typeCode": 10, "requestId": 0, "contentLength": 45 }
  ],
  "connectTimeMs": 12,
  "totalTimeMs": 35
}
```

**Management Variables:**

| Variable        | Description                                        |
|-----------------|----------------------------------------------------|
| FCGI_MAX_CONNS  | Max simultaneous transport connections             |
| FCGI_MAX_REQS   | Max simultaneous requests                         |
| FCGI_MPXS_CONNS | 1 if connection multiplexing is supported, else 0 |

### POST /api/fastcgi/request

Sends a complete FastCGI request (BEGIN_REQUEST + PARAMS + empty STDIN) and collects the response.

**Request:**
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

**Success Response:**
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

**CGI Parameters Sent:**

| Parameter         | Value                    |
|-------------------|--------------------------|
| SCRIPT_FILENAME   | User-supplied path       |
| SCRIPT_NAME       | Same as SCRIPT_FILENAME  |
| REQUEST_URI       | User-supplied URI        |
| REQUEST_METHOD    | GET                      |
| SERVER_PROTOCOL   | HTTP/1.1                 |
| GATEWAY_INTERFACE | CGI/1.1                  |
| SERVER_SOFTWARE   | PortOfCall/1.0           |
| SERVER_NAME       | User-supplied            |
| SERVER_PORT       | 80                       |
| REMOTE_ADDR       | 127.0.0.1                |
| CONTENT_TYPE      | (empty)                  |
| CONTENT_LENGTH    | 0                        |

## Protocol Flow

### Probe (FCGI_GET_VALUES)

```
Client                          FastCGI Server
  |                                    |
  |--- FCGI_GET_VALUES (requestId=0) ->|  (query: FCGI_MAX_CONNS, FCGI_MAX_REQS, FCGI_MPXS_CONNS)
  |                                    |
  |<-- FCGI_GET_VALUES_RESULT ---------|  (answers with values)
  |                                    |
  |--- [close connection] -------------|
```

Note: `requestId=0` is the management record convention.

### Full Request

```
Client                          FastCGI Server
  |                                    |
  |--- FCGI_BEGIN_REQUEST (role=RESPONDER, flags=0) ->|
  |--- FCGI_PARAMS (CGI env vars)  --->|
  |--- FCGI_PARAMS (empty, signals end of params) --->|
  |--- FCGI_STDIN  (empty, signals no body) --------->|
  |                                    |
  |<-- FCGI_STDOUT (headers + body) ---|
  |<-- FCGI_STDERR (errors, if any) ---|
  |<-- FCGI_END_REQUEST (exitStatus, protocolStatus) -|
```

## Security Considerations

- **SSRF**: Cloudflare-protected hosts are blocked via DNS detection.
- **Input Validation**: Port must be 1–65535. Host is required.
- **Body Limit**: Response body is truncated at 10,000 bytes to prevent memory exhaustion.
- **Credentials**: No credentials are transmitted or logged.
- **Note**: FastCGI servers should never be exposed on public interfaces — they accept arbitrary script execution paths.

## Common Implementations

| Application  | Default Socket             | Notes                              |
|--------------|----------------------------|------------------------------------|
| PHP-FPM      | 127.0.0.1:9000 or UNIX     | Most common PHP deployment         |
| Python flup  | 127.0.0.1:9000             | WSGI-to-FastCGI bridge             |
| Ruby fcgi    | 127.0.0.1:9000             | Rack FastCGI adapter               |
| nginx        | proxies TO fastcgi server  | `fastcgi_pass 127.0.0.1:9000;`    |
| Apache       | `mod_fcgid` or `mod_proxy_fcgi` | Various configuration options |

## Complexity

**Medium** — Binary protocol with straightforward framing. Name-value pair encoding requires careful bit manipulation, but the overall protocol flow is simple (no authentication, no negotiation for the probe path).

## Testing

```bash
# Start PHP-FPM locally
php-fpm -F

# Or with Docker
docker run -d -p 9000:9000 php:8.2-fpm

# Test probe
curl -X POST http://localhost:8787/api/fastcgi/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"127.0.0.1","port":9000}'

# Test request
curl -X POST http://localhost:8787/api/fastcgi/request \
  -H 'Content-Type: application/json' \
  -d '{"host":"127.0.0.1","port":9000,"scriptFilename":"/var/www/html/index.php"}'
```

## References

- [FastCGI Specification](https://fastcgi-com.github.io/fcgi2/doc/spec.html) — Original Open Market spec
- [PHP-FPM Documentation](https://www.php.net/manual/en/install.fpm.php)
- [nginx FastCGI Module](https://nginx.org/en/docs/http/ngx_http_fastcgi_module.html)
