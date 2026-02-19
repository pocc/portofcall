# GELF (Graylog Extended Log Format) TCP

**Port:** 12201 (default, configurable)
**Transport:** TCP
**Format:** Null-byte delimited JSON messages
**Specification:** [GELF Payload Specification](https://go2docs.graylog.org/5-0/getting_in_log_data/gelf.html)
**Implementation:** `/src/worker/gelf.ts`

## Overview

GELF (Graylog Extended Log Format) is a structured logging format designed for centralized log aggregation. Port of Call implements the **GELF TCP transport**, which sends JSON log messages over TCP connections, with each message terminated by a null byte (`\0`).

GELF messages are simple JSON objects with required and optional fields, plus support for custom fields prefixed with underscore (`_`).

## Protocol Details

### Transport Layer

- **Connection:** TCP socket to port 12201 (default)
- **Encoding:** UTF-8 encoded JSON
- **Framing:** Each message terminated by null byte (`\0`)
- **Direction:** Client → Server (fire-and-forget, no response expected)

### Message Structure

```json
{
  "version": "1.1",
  "host": "example.org",
  "short_message": "Application error occurred",
  "full_message": "Stack trace:\n  at foo.bar(file.js:42)\n  ...",
  "timestamp": 1385053862.3072,
  "level": 3,
  "facility": "webapp",
  "file": "/path/to/file.js",
  "line": 42,
  "_user_id": 12345,
  "_environment": "production",
  "_request_id": "abc-123"
}
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `version` | string | GELF spec version, always `"1.1"` |
| `host` | string | Originating host/application (max 255 chars) |
| `short_message` | string | Short descriptive message |

### Optional Standard Fields

| Field | Type | Description |
|-------|------|-------------|
| `full_message` | string | Full log message with details (backtraces, etc.) |
| `timestamp` | number | Unix timestamp with decimal precision (seconds since epoch) |
| `level` | number | Syslog severity level (0-7, default: 1=ALERT) |
| `facility` | string | Syslog facility (e.g., "auth", "daemon") |
| `file` | string | File name where log originated |
| `line` | number | Line number where log originated |

### Severity Levels (Syslog Compatible)

| Level | Name | Description |
|-------|------|-------------|
| 0 | EMERGENCY | System is unusable |
| 1 | ALERT | Action must be taken immediately |
| 2 | CRITICAL | Critical conditions |
| 3 | ERROR | Error conditions |
| 4 | WARNING | Warning conditions |
| 5 | NOTICE | Normal but significant |
| 6 | INFO | Informational messages |
| 7 | DEBUG | Debug-level messages |

### Custom Fields

- **Prefix:** Must start with underscore (`_`)
- **Reserved:** Cannot use `_id` (reserved by Graylog)
- **Types:** String, number, boolean, or null
- **Examples:** `_user_id`, `_environment`, `_request_id`, `_http_status`

## API Endpoints

### POST `/api/gelf/send`

Send one or more GELF log messages to a Graylog server.

**Request Body:**
```json
{
  "host": "graylog.example.com",
  "port": 12201,
  "messages": [
    {
      "version": "1.1",
      "host": "webserver-01",
      "short_message": "User login failed",
      "level": 4,
      "_user_ip": "192.0.2.1",
      "_username": "alice"
    }
  ],
  "timeout": 10000
}
```

**Parameters:**
- `host` (string, required) - Graylog server hostname/IP
- `port` (number, optional) - GELF TCP port (default: 12201)
- `messages` (array, required) - Array of GELF message objects (max 100)
- `timeout` (number, optional) - Connection timeout in milliseconds (default: 10000)

**Auto-Population:**
- If `timestamp` is missing, uses current time (`Date.now() / 1000`)
- If `version` is missing, sets to `"1.1"`

**Response (Success):**
```json
{
  "success": true,
  "message": "Sent 1 GELF message(s)",
  "host": "graylog.example.com",
  "port": 12201,
  "messagesCount": 1
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Invalid GELF message at index 0. Required: version='1.1', host (string), short_message (string). Custom fields must start with '_'.",
  "message": { ... }
}
```

### GET `/api/gelf/probe`

Test connectivity to a GELF TCP server.

**Query Parameters:**
- `host` (string, required) - Graylog server hostname/IP
- `port` (number, optional) - GELF TCP port (default: 12201)
- `timeout` (number, optional) - Timeout in milliseconds (default: 5000)

**Example:**
```
GET /api/gelf/probe?host=graylog.example.com&port=12201
```

**Response:**
```json
{
  "success": true,
  "host": "graylog.example.com",
  "port": 12201,
  "connectTimeMs": 45,
  "sendTimeMs": 12,
  "totalTimeMs": 57,
  "message": "GELF server is reachable"
}
```

## Usage Examples

### cURL Examples

**Send a single log message:**
```bash
curl -X POST https://portofcall.example.com/api/gelf/send \
  -H "Content-Type: application/json" \
  -d '{
    "host": "graylog.company.com",
    "port": 12201,
    "messages": [{
      "version": "1.1",
      "host": "app-server-01",
      "short_message": "Database connection failed",
      "full_message": "Could not connect to PostgreSQL at db.example.com:5432\nError: ECONNREFUSED",
      "level": 3,
      "_database": "users",
      "_retry_count": 3
    }]
  }'
```

**Send multiple messages in batch:**
```bash
curl -X POST https://portofcall.example.com/api/gelf/send \
  -H "Content-Type: application/json" \
  -d '{
    "host": "graylog.company.com",
    "messages": [
      {
        "version": "1.1",
        "host": "webserver-01",
        "short_message": "User login successful",
        "level": 6,
        "_user_id": 42,
        "_username": "alice"
      },
      {
        "version": "1.1",
        "host": "webserver-01",
        "short_message": "API request processed",
        "level": 6,
        "_endpoint": "/api/users/42",
        "_duration_ms": 145
      }
    ]
  }'
```

**Probe GELF server:**
```bash
curl "https://portofcall.example.com/api/gelf/probe?host=graylog.example.com&port=12201"
```

### JavaScript/TypeScript Example

```typescript
// Send error logs to Graylog
async function sendErrorToGraylog(error: Error, context: Record<string, any>) {
  const response = await fetch('https://portofcall.example.com/api/gelf/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      host: 'graylog.company.com',
      port: 12201,
      messages: [{
        version: '1.1',
        host: 'frontend-app',
        short_message: error.message,
        full_message: error.stack || '',
        level: 3, // ERROR
        _error_name: error.name,
        _user_id: context.userId,
        _url: window.location.href,
        _user_agent: navigator.userAgent,
      }],
    }),
  });

  const result = await response.json();
  console.log('GELF send result:', result);
}
```

## Implementation Details

### Message Validation

The implementation validates:
1. ✅ `version` is exactly `"1.1"`
2. ✅ `host` is a non-empty string ≤ 255 characters
3. ✅ `short_message` is a non-empty string
4. ✅ `full_message` is a string (if provided)
5. ✅ `timestamp` is a finite number (if provided)
6. ✅ `level` is an integer 0-7 (if provided)
7. ✅ Custom fields start with `_` and don't use reserved `_id`

### Security Features

- **Cloudflare Detection:** Blocks GELF send to Cloudflare-protected hosts to prevent SSRF attacks
- **Input Validation:** Validates all message fields before sending
- **Batch Limiting:** Maximum 100 messages per request
- **Host Validation:** Checks hostname length (max 255 chars)
- **Timeout Protection:** Enforces connection timeouts (default: 10s for send, 5s for probe)

### Wire Format

Each message is sent as:
```
<JSON string>\0
```

Example on the wire (hexdump):
```
7b 22 76 65 72 73 69 6f 6e 22 3a 22 31 2e 31 22  {"version":"1.1"
2c 22 68 6f 73 74 22 3a 22 74 65 73 74 22 2c 22  ,"host":"test","
73 68 6f 72 74 5f 6d 65 73 73 61 67 65 22 3a 22  short_message":"
68 65 6c 6c 6f 22 7d 00                          hello"}.
                                                           ^^ null byte
```

## Known Limitations

1. **No UDP Support:** Only implements TCP transport (UDP GELF not supported on Cloudflare Workers)
2. **No Chunked GELF:** Does not support chunked GELF messages (used for large messages over UDP)
3. **No Compression:** Does not support GZIP compression (not typically used with TCP GELF)
4. **Fire-and-Forget:** Server does not send responses; cannot detect if message was accepted
5. **No Acknowledgment:** Cannot verify message was processed successfully by Graylog
6. **Batch Size:** Limited to 100 messages per request
7. **No Streaming:** Each send creates a new TCP connection (no persistent connections)
8. **Timestamp Precision:** JavaScript timestamps have millisecond precision (GELF supports microseconds)
9. **No TLS Support:** Currently sends over plain TCP (many Graylog deployments accept plain TCP on 12201)
10. **Custom Field Types:** All custom fields serialized as JSON primitives (no complex objects)

## Testing with Docker

Run a local Graylog instance for testing:

```bash
# Start Graylog with Docker Compose
docker run --name graylog -p 9000:9000 -p 12201:12201 \
  -e GRAYLOG_PASSWORD_SECRET=somepasswordpepper \
  -e GRAYLOG_ROOT_PASSWORD_SHA2=8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918 \
  -e GRAYLOG_HTTP_EXTERNAL_URI=http://127.0.0.1:9000/ \
  graylog/graylog:5.0

# Configure GELF TCP input:
# 1. Open http://localhost:9000 (admin/admin)
# 2. System > Inputs
# 3. Select "GELF TCP" and click "Launch new input"
# 4. Set port to 12201 and click "Save"

# Test with Port of Call:
curl -X POST http://localhost:8787/api/gelf/send \
  -H "Content-Type: application/json" \
  -d '{
    "host": "localhost",
    "messages": [{
      "version": "1.1",
      "host": "test-app",
      "short_message": "Test message from Port of Call",
      "level": 6,
      "_test": true
    }]
  }'
```

## Differences from Syslog

| Feature | GELF | Syslog (RFC 5424) |
|---------|------|-------------------|
| Format | JSON | Structured text |
| Custom Fields | Native (`_field`) | Extensions (SD-PARAMS) |
| Message Structure | Flat JSON | Hierarchical |
| Precision | Decimal timestamp | Integer timestamp |
| Wire Format | Null-delimited | Newline or length-prefixed |
| Compression | GZIP (UDP only) | Not defined |
| Chunking | GELF chunks (UDP) | Not defined |

## See Also

- [Graylog GELF Documentation](https://go2docs.graylog.org/5-0/getting_in_log_data/gelf.html)
- [Syslog Protocol (RFC 5424)](https://datatracker.ietf.org/doc/html/rfc5424)
- [Syslog Implementation in Port of Call](SYSLOG.md)
- [Graphite Protocol](GRAPHITE.md) - Similar fire-and-forget metrics protocol
