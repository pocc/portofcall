# OpenTSDB — Power-User Reference

**Port:** 4242 (default)
**Transport:** TCP for telnet protocol, HTTP for query API
**Implementation:** `src/worker/opentsdb.ts`
**Routes:** Five endpoints covering telnet commands and HTTP query API

OpenTSDB is a distributed, scalable Time Series Database built on HBase. This implementation supports both the telnet-style text protocol (commands via raw TCP socket) and the HTTP JSON query API.

---

## Endpoints

### `POST /api/opentsdb/version`

Connects to an OpenTSDB server and sends the `version` command to retrieve the server version string.

**Request:**
```json
{
  "host": "opentsdb.example.com",
  "port": 4242,
  "timeout": 10000
}
```

| Field     | Required | Default | Notes |
|-----------|----------|---------|-------|
| `host`    | Yes      | —       | Hostname or IP address. No format validation. |
| `port`    | No       | `4242`  | Port number. |
| `timeout` | No       | `10000` | Total timeout in milliseconds for connection + response. |

**Success response:**
```json
{
  "success": true,
  "message": "OpenTSDB version retrieved",
  "host": "opentsdb.example.com",
  "port": 4242,
  "rtt": 45,
  "connectTime": 32,
  "version": "net.opentsdb 2.4.1"
}
```

**Error responses:**

| HTTP | Shape | Condition |
|------|-------|-----------|
| 400  | `{ error: "Missing required parameter: host" }` | Missing host. |
| 403  | `{ success: false, error: "...", isCloudflare: true }` | Cloudflare IP detected. |
| 500  | `{ success: false, error: "Connection timeout" }` | Timeout or connection failure. |

---

### `POST /api/opentsdb/stats`

Sends the `stats` command to retrieve server statistics. Each stat line follows the OpenTSDB format: `metric timestamp value tag=val`.

**Request:**
```json
{
  "host": "opentsdb.example.com",
  "port": 4242,
  "timeout": 10000
}
```

Parameters same as `/version`.

**Success response:**
```json
{
  "success": true,
  "message": "Retrieved 42 statistics",
  "host": "opentsdb.example.com",
  "port": 4242,
  "rtt": 56,
  "connectTime": 28,
  "statCount": 42,
  "stats": [
    {
      "metric": "tsd.rpc.received",
      "value": "12345",
      "tags": "type=put host=tsd1"
    },
    {
      "metric": "tsd.hbase.rpcs",
      "value": "98765",
      "tags": "type=put host=tsd1"
    }
  ],
  "raw": "tsd.rpc.received 1708300800 12345 type=put host=tsd1\ntsd.hbase.rpcs 1708300800 98765 type=put host=tsd1\n..."
}
```

**Notes:**
- Response includes both parsed stats (array of objects) and raw response text.
- Each stat object extracts metric name, value, and tags but discards the timestamp.
- Stats with fewer than 3 space-separated fields are silently skipped.

---

### `POST /api/opentsdb/suggest`

Sends the `suggest` command to discover metric names, tag keys, or tag values. The telnet interface uses positional arguments: `suggest <type> [<query>] [<max>]`.

**Request:**
```json
{
  "host": "opentsdb.example.com",
  "port": 4242,
  "type": "metrics",
  "query": "sys.cpu",
  "max": 25,
  "timeout": 10000
}
```

| Field     | Required | Default     | Notes |
|-----------|----------|-------------|-------|
| `host`    | Yes      | —           | Hostname or IP address. |
| `port`    | No       | `4242`      | Port number. |
| `type`    | No       | `"metrics"` | One of: `metrics`, `tagk` (tag keys), `tagv` (tag values). Case-sensitive. |
| `query`   | No       | `""`        | Prefix filter. Empty means return all. |
| `max`     | No       | `25`        | Maximum number of suggestions. Validated 1-25000. |
| `timeout` | No       | `10000`     | Total timeout in milliseconds. |

**Success response:**
```json
{
  "success": true,
  "message": "Found 3 suggestion(s)",
  "host": "opentsdb.example.com",
  "port": 4242,
  "rtt": 38,
  "connectTime": 25,
  "type": "metrics",
  "query": "sys.cpu",
  "count": 3,
  "suggestions": [
    "sys.cpu.user",
    "sys.cpu.system",
    "sys.cpu.idle"
  ]
}
```

**Error responses:**

| HTTP | Condition |
|------|-----------|
| 400  | Invalid type (not `metrics`, `tagk`, or `tagv`). |
| 400  | Invalid max parameter (< 1 or > 25000). |
| 403  | Cloudflare IP detected. |
| 500  | Connection timeout or error. |

---

### `POST /api/opentsdb/put`

Writes a single data point to OpenTSDB using the `put` command. Format: `put <metric> <timestamp> <value> <tag>=<val> [...]`.

**Request:**
```json
{
  "host": "opentsdb.example.com",
  "port": 4242,
  "metric": "sys.cpu.user",
  "value": 42.5,
  "timestamp": 1708300800,
  "tags": {
    "host": "web01",
    "dc": "us-east-1"
  },
  "timeout": 10000
}
```

| Field       | Required | Default              | Notes |
|-------------|----------|----------------------|-------|
| `host`      | Yes      | —                    | Hostname or IP. |
| `metric`    | Yes      | —                    | Metric name. Allowed: `[a-zA-Z0-9._\-/]`. Max 255 bytes. |
| `value`     | Yes      | —                    | Must be a finite number. |
| `port`      | No       | `4242`               | Port number. |
| `timestamp` | No       | Current Unix seconds | Unix timestamp (seconds or milliseconds). Validated as safe integer ≥ 0. |
| `tags`      | No       | `{ host: "portofcall" }` | At least one tag required. Max 8 tags. Keys/values: `[a-zA-Z0-9._\-/]`, max 255 bytes each. |
| `timeout`   | No       | `10000`              | Total timeout in milliseconds. |

**Success response:**
```json
{
  "success": true,
  "message": "Data point written: sys.cpu.user = 42.5",
  "host": "opentsdb.example.com",
  "port": 4242,
  "rtt": 18,
  "metric": "sys.cpu.user",
  "timestamp": 1708300800,
  "value": 42.5,
  "tags": {
    "host": "web01",
    "dc": "us-east-1"
  },
  "command": "put sys.cpu.user 1708300800 42.5 host=web01 dc=us-east-1"
}
```

**Error responses:**

| HTTP | Condition |
|------|-----------|
| 400  | Missing host or metric. |
| 400  | Value not a finite number. |
| 400  | Invalid metric name (disallowed characters or > 255 bytes). |
| 400  | Invalid timestamp (not safe integer or negative). |
| 400  | Too many tags (> 8). |
| 400  | Invalid tag key/value (disallowed characters or > 255 bytes). |
| 403  | Cloudflare IP detected. |
| 500  | Connection timeout or server returned error line. |

**Notes:**
- OpenTSDB `put` is fire-and-forget on success (no response). The server only sends error lines on failure.
- The implementation waits 500ms for a potential error response. Empty response = success.
- If tags are omitted or empty, a default tag `host=portofcall` is added (OpenTSDB requires at least one tag).

---

### `POST /api/opentsdb/query`

Queries time series data using the OpenTSDB HTTP JSON API (`/api/query`). This uses HTTP fetch, not the telnet protocol.

**Request:**
```json
{
  "host": "opentsdb.example.com",
  "port": 4242,
  "metric": "sys.cpu.user",
  "start": "1h-ago",
  "end": "now",
  "aggregator": "sum",
  "tags": {
    "host": "web01"
  },
  "timeout": 10000
}
```

| Field       | Required | Default   | Notes |
|-------------|----------|-----------|-------|
| `host`      | Yes      | —         | Hostname or IP. Validated as alphanumeric + dots/hyphens. |
| `metric`    | Yes      | —         | Metric name to query. |
| `port`      | No       | `4242`    | HTTP port. Validated 1-65535. |
| `start`     | No       | `"1h-ago"` | Start time (OpenTSDB relative or absolute format). |
| `end`       | No       | (omitted) | End time. Defaults to "now" if omitted. |
| `aggregator`| No       | `"sum"`   | Aggregation function (sum, avg, min, max, etc.). |
| `tags`      | No       | `{}`      | Tag filters (exact match). Empty = no filter. |
| `timeout`   | No       | `10000`   | HTTP fetch timeout in milliseconds. |

**Success response:**
```json
{
  "success": true,
  "message": "Query returned 1 time series",
  "host": "opentsdb.example.com",
  "port": 4242,
  "rtt": 125,
  "metric": "sys.cpu.user",
  "start": "1h-ago",
  "aggregator": "sum",
  "seriesCount": 1,
  "results": [
    {
      "metric": "sys.cpu.user",
      "tags": {
        "host": "web01",
        "dc": "us-east-1"
      },
      "dataPoints": 3600,
      "sample": [
        { "ts": 1708297200, "val": 42.5 },
        { "ts": 1708297201, "val": 43.2 },
        { "ts": 1708297202, "val": 41.8 },
        { "ts": 1708297203, "val": 44.1 },
        { "ts": 1708297204, "val": 42.9 }
      ]
    }
  ]
}
```

**Notes:**
- Results include `dataPoints` count and a `sample` of first 5 timestamp/value pairs.
- Full data point map is not returned to avoid large responses.
- The query body sent to OpenTSDB follows the `/api/query` JSON format.

**Error responses:**

| HTTP | Condition |
|------|-----------|
| 400  | Missing host or metric. |
| 400  | Invalid host format (not alphanumeric + `.` + `-`). |
| 400  | Invalid port (< 1 or > 65535). |
| 403  | Cloudflare IP detected. |
| 200  | OpenTSDB returned HTTP error (e.g. 400/404). Response includes `httpStatus` and error message. |
| 500  | Fetch timeout or network error. |

---

## Wire Protocol (Telnet)

The telnet-style protocol operates over raw TCP sockets on port 4242. Each command is a newline-terminated text line.

```
Client                       OpenTSDB (:4242)
  │                               │
  │──── TCP connect ─────────────▶│
  │                               │  ← connectTime measured here
  │──── "version\n" ─────────────▶│
  │◀─── "net.opentsdb 2.4.1\n" ──│
  │──── close ───────────────────▶│  ← rtt measured here
```

### Command Formats

**version:**
```
version\n
```
Response: Single line with version string.

**stats:**
```
stats\n
```
Response: Multiple lines, each: `<metric> <timestamp> <value> <tag>=<val> [...]`

**suggest:**
```
suggest <type> [<query>] [<max>]\n
```
- `<type>`: `metrics`, `tagk`, or `tagv`
- `[<query>]`: Optional prefix filter
- `[<max>]`: Optional max results (positional, not named)

Response: One suggestion per line.

**put:**
```
put <metric> <timestamp> <value> <tag>=<val> [...]\n
```
- At least one tag is **required** (OpenTSDB protocol constraint).
- Response: Silent on success. Error lines start with "put:" if validation fails.

---

## Wire Protocol (HTTP Query)

The `/api/opentsdb/query` endpoint uses the standard OpenTSDB HTTP API at `/api/query`:

```
Client                       OpenTSDB (:4242)
  │                               │
  │──── POST /api/query ─────────▶│
  │     Content-Type: application/json
  │     {"start":"1h-ago","queries":[...]}
  │                               │
  │◀─── 200 OK ──────────────────│
  │     [{"metric":"...","dps":{...}}]
```

---

## Known Quirks and Limitations

### No response validation for version/stats
The `version` and `stats` commands trust whatever the server sends. Malformed responses (e.g. binary junk, partial lines) are passed through to the response without validation. A rogue server could return misleading data.

### Suggest type is case-sensitive
The telnet protocol expects lowercase `metrics`, `tagk`, `tagv`. The API accepts them case-insensitively (uppercases internally) but the wire command is sent as-is. Servers may reject uppercase variants.

### put response timeout is fixed at 500ms
The `put` command waits 500ms for error responses via `readTelnetResponse(reader, 500)`. This is hardcoded — not configurable via the `timeout` parameter. Fast networks may miss slow error responses.

### Timestamp defaults to seconds
If `timestamp` is omitted in `/put`, it defaults to `Math.floor(Date.now() / 1000)` (Unix seconds). OpenTSDB also accepts milliseconds (13-digit timestamps), but the API doesn't auto-detect or convert.

### Tags are silently defaulted
If `tags` is omitted or empty in `/put`, the implementation adds `{ host: "portofcall" }` to satisfy OpenTSDB's "at least one tag" requirement. Users unaware of this may write data points with unexpected tags.

### Query endpoint returns HTTP errors as 200 OK
If the OpenTSDB server returns HTTP 400/404/500, the `/api/opentsdb/query` endpoint returns `200 OK` with `{ success: false, httpStatus: 400, error: "..." }`. The HTTP status is embedded in the JSON, not the response code.

### No connection reuse
Every command opens a fresh TCP connection and closes it immediately. High-frequency use (e.g. bulk puts) pays connection overhead repeatedly. OpenTSDB supports persistent connections but this implementation doesn't use them.

### Shared timeout timer
For telnet commands, the `timeout` parameter covers both `socket.opened` (TCP handshake) and the command response. If handshake takes 9.5s of a 10s timeout, only 0.5s remains for the response.

### readTelnetResponse may truncate on slow links
The `readTelnetResponse` function races a timeout against reading the stream to completion. On slow connections, a large `stats` response may be cut off mid-stream when the timeout fires. The partial response is returned as-is.

### Stats parsing skips malformed lines
Lines with fewer than 3 space-separated fields are silently dropped. No warning or error count is returned.

### Query endpoint uses fetch() timeout via AbortController
The HTTP query uses `AbortController` + `setTimeout` to enforce timeouts. If the abort fires mid-response, the error message is generic (`AbortError`) with no hint about timeout duration.

### No HTTPS support for query endpoint
The query endpoint hardcodes `http://${host}:${port}/api/query`. Secure OpenTSDB instances (HTTPS) require a reverse proxy or are unsupported.

### Host validation only in query endpoint
Telnet endpoints (`/version`, `/stats`, `/suggest`, `/put`) pass `host` directly to `connect()` without validation. Query endpoint validates host format (`/^[a-zA-Z0-9.-]+$/`). Inconsistent.

### No rate limiting or backpressure
A malicious client can spam `/put` requests. The worker has no rate limiting, connection pooling, or queue depth control. All requests hit the target OpenTSDB server directly.

### Error response shape inconsistencies
Cloudflare detection errors return `{ success: false, error: "...", isCloudflare: true }`. Other errors return `{ success: false, error: "..." }` (no `isCloudflare` field). The 403 status is used for Cloudflare detection but not documented in error tables for all endpoints.

### Resource leak protection in catch blocks
Catch blocks use try-catch wrappers around `reader.releaseLock()`, `writer.releaseLock()`, and `socket.close()` to prevent exceptions if locks are already released or socket is already closed. This is defensive but masks potential double-release bugs.

---

## Character Validation Rules

OpenTSDB metric names and tags must match the pattern: `[a-zA-Z0-9._\-/]+`

**Allowed:** alphanumerics, period (`.`), underscore (`_`), hyphen (`-`), forward slash (`/`)

**Forbidden:** spaces, colons, equals signs, Unicode, control characters

**Length limits:**
- Metric names: max 255 bytes
- Tag keys: max 255 bytes
- Tag values: max 255 bytes
- Tag count: max 8 per data point

Validation is enforced in `/put`. The query endpoint does not validate metric names (assumes server will reject invalid queries).

---

## curl Examples

**Get server version:**
```bash
curl -X POST https://portofcall.app/api/opentsdb/version \
  -H 'Content-Type: application/json' \
  -d '{"host":"opentsdb.example.com"}' | jq .
```

**Retrieve server statistics:**
```bash
curl -X POST https://portofcall.app/api/opentsdb/stats \
  -H 'Content-Type: application/json' \
  -d '{"host":"opentsdb.example.com","timeout":5000}' | jq .
```

**Suggest metric names starting with "sys.cpu":**
```bash
curl -X POST https://portofcall.app/api/opentsdb/suggest \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "opentsdb.example.com",
    "type": "metrics",
    "query": "sys.cpu",
    "max": 10
  }' | jq .
```

**Suggest tag keys:**
```bash
curl -X POST https://portofcall.app/api/opentsdb/suggest \
  -H 'Content-Type: application/json' \
  -d '{"host":"opentsdb.example.com","type":"tagk"}' | jq .
```

**Write a data point:**
```bash
curl -X POST https://portofcall.app/api/opentsdb/put \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "opentsdb.example.com",
    "metric": "sys.cpu.user",
    "value": 42.5,
    "timestamp": 1708300800,
    "tags": {
      "host": "web01",
      "dc": "us-east-1"
    }
  }' | jq .
```

**Write a data point with default timestamp:**
```bash
curl -X POST https://portofcall.app/api/opentsdb/put \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "opentsdb.example.com",
    "metric": "test.metric",
    "value": 123.45,
    "tags": {"env": "dev"}
  }' | jq .
```

**Query time series (last hour):**
```bash
curl -X POST https://portofcall.app/api/opentsdb/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "opentsdb.example.com",
    "metric": "sys.cpu.user",
    "start": "1h-ago",
    "aggregator": "avg",
    "tags": {"host": "web01"}
  }' | jq .
```

**Query with absolute timestamps:**
```bash
curl -X POST https://portofcall.app/api/opentsdb/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "opentsdb.example.com",
    "metric": "sys.cpu.user",
    "start": "2024/02/18-00:00:00",
    "end": "2024/02/18-23:59:59",
    "aggregator": "sum"
  }' | jq .
```

**Query without tag filters (all hosts):**
```bash
curl -X POST https://portofcall.app/api/opentsdb/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "opentsdb.example.com",
    "metric": "sys.cpu.user",
    "start": "30m-ago"
  }' | jq .
```

---

## Well-Known Public Instances

OpenTSDB is typically self-hosted. No well-known public instances are available for testing (unlike public NTP or DNS servers). Use a local Docker container or cloud-hosted instance for development.

**Docker quickstart:**
```bash
docker run -d -p 4242:4242 petergrace/opentsdb-docker
```

---

## vs Prometheus, InfluxDB, Graphite

| Aspect | OpenTSDB | Prometheus | InfluxDB | Graphite |
|--------|----------|------------|----------|----------|
| Storage backend | HBase (external) | Local TSDB | Custom engine | Whisper files |
| Query language | JSON HTTP API | PromQL | InfluxQL / Flux | Render API |
| Telnet protocol | Yes (port 4242) | No | No | Yes (plaintext) |
| Tag support | Yes (required) | Yes (labels) | Yes | Limited |
| HTTP API | Yes (`/api/query`) | Yes | Yes | Yes |
| Aggregation | Server-side | Server-side | Server-side | Server-side |
| Push vs Pull | Push (via `put`) | Pull (scrape) | Push/Pull | Push |

OpenTSDB's strength: massive scale via HBase, unlimited tag cardinality. Weakness: operational complexity (requires HBase cluster).

---

## References

- **OpenTSDB Documentation:** http://opentsdb.net/docs/
- **Telnet API:** http://opentsdb.net/docs/build/html/api_telnet/
- **HTTP API:** http://opentsdb.net/docs/build/html/api_http/
- **Data Model:** http://opentsdb.net/docs/build/html/user_guide/writing/
