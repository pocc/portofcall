# Grafana Loki Protocol Reference

## Overview

Grafana Loki is a horizontally-scalable, multi-tenant log aggregation system inspired by Prometheus. Unlike traditional log systems that index the full text of logs, Loki indexes only the metadata (labels) of log streams, making it extremely efficient for storage and fast for queries. It uses LogQL, a query language modeled after PromQL, for filtering and aggregating log data.

**Default port:** 3100 (HTTP API)
**Transport:** HTTP/1.1 over TCP
**Content type:** `application/json` (requests and responses)
**Push content types:** `application/json` or `application/x-protobuf` (with Snappy compression)

Official docs: https://grafana.com/docs/loki/latest/reference/loki-http-api/

---

## HTTP API Endpoints

### GET /ready

Readiness probe. Returns HTTP 200 when Loki is ready to accept traffic.

**Response:**
- `200 OK` with body `ready` -- instance is ready
- `503 Service Unavailable` -- instance is not yet ready

**Example:**
```
GET /ready HTTP/1.1
Host: loki.example.com:3100
```

---

### GET /loki/api/v1/status/buildinfo

Returns version and build metadata for the running Loki instance.

**Response (200):**
```json
{
  "version": "2.9.0",
  "revision": "abc1234",
  "branch": "main",
  "buildUser": "root@host",
  "buildDate": "2024-01-15T10:30:00Z",
  "goVersion": "go1.21.5"
}
```

---

### GET /loki/api/v1/labels

Returns the list of known label names across all streams.

**Query parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `start`   | No       | Start time (nanosecond Unix epoch, or RFC3339). Default: 6 hours ago |
| `end`     | No       | End time (nanosecond Unix epoch, or RFC3339). Default: now |

**Response (200):**
```json
{
  "status": "success",
  "data": ["__name__", "job", "instance", "level", "namespace"]
}
```

---

### GET /loki/api/v1/label/{name}/values

Returns known values for a given label name.

**Path parameter:** `{name}` -- the label name (e.g., `job`, `level`)

**Query parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `start`   | No       | Start time |
| `end`     | No       | End time |
| `query`   | No       | LogQL stream selector to filter which streams to consider |

**Response (200):**
```json
{
  "status": "success",
  "data": ["varlogs", "nginx", "prometheus"]
}
```

---

### GET /loki/api/v1/query

Instant query -- evaluates a LogQL expression at a single point in time.

**Query parameters:**
| Parameter   | Required | Description |
|-------------|----------|-------------|
| `query`     | Yes      | LogQL query string |
| `limit`     | No       | Maximum number of entries to return. Default: 100 |
| `time`      | No       | Evaluation timestamp (nanosecond Unix epoch, seconds Unix epoch, or RFC3339). Default: now |
| `direction` | No       | `forward` or `backward` (default: `backward`) |

**Response (200):**
```json
{
  "status": "success",
  "data": {
    "resultType": "streams",
    "result": [
      {
        "stream": { "job": "varlogs", "level": "error" },
        "values": [
          ["1708185600000000000", "error: something went wrong"],
          ["1708185590000000000", "error: timeout exceeded"]
        ]
      }
    ],
    "stats": { ... }
  }
}
```

**Note:** Each value in `values` is a 2-element array of `[nanosecond_timestamp_string, log_line_string]`.

---

### GET /loki/api/v1/query_range

Range query -- evaluates a LogQL expression over a time range.

**Query parameters:**
| Parameter   | Required | Description |
|-------------|----------|-------------|
| `query`     | Yes      | LogQL query string |
| `start`     | No       | Start time. Default: 1 hour ago |
| `end`       | No       | End time. Default: now |
| `limit`     | No       | Maximum number of entries. Default: 100 |
| `direction` | No       | `forward` or `backward` (default: `backward`) |
| `step`      | No       | Query resolution step width (e.g., `5m`). Used only for metric queries |

**Time formats accepted:** Nanosecond Unix epoch (string), second Unix epoch (float), or RFC3339 (`2024-02-17T12:00:00Z`).

**Response (200):**
```json
{
  "status": "success",
  "data": {
    "resultType": "streams",
    "result": [
      {
        "stream": { "job": "varlogs" },
        "values": [
          ["1708185600000000000", "log line 1"],
          ["1708185590000000000", "log line 2"]
        ]
      }
    ],
    "stats": { ... }
  }
}
```

---

### POST /loki/api/v1/push

Push log entries to Loki. This is the primary ingestion endpoint.

**Request headers:**
- `Content-Type: application/json` (required for JSON payloads)
- `X-Scope-OrgID: <tenant>` (required in multi-tenant mode)

**Request body (JSON):**
```json
{
  "streams": [
    {
      "stream": {
        "job": "myapp",
        "level": "info"
      },
      "values": [
        ["1708185600000000000", "log line 1"],
        ["1708185601000000000", "log line 2"]
      ]
    }
  ]
}
```

**Key requirements:**
- `stream`: Object of label key-value pairs identifying the stream. Labels are indexed.
- `values`: Array of `[timestamp, line]` tuples.
  - Timestamps MUST be nanosecond-precision Unix epoch as **strings**.
  - Entries within a stream MUST be in chronological order.
  - Entries MUST NOT have timestamps older than the configured `reject_old_samples_max_age`.
- All labels (keys and values) must match the regex `[a-zA-Z_][a-zA-Z0-9_]*` for keys.
- Label values can contain any UTF-8 characters.

**Response:**
- `204 No Content` -- success (empty body)
- `200 OK` -- also acceptable (some versions)
- `400 Bad Request` -- malformed payload, out-of-order entries
- `429 Too Many Requests` -- rate limited
- `500 Internal Server Error` -- server-side failure

**Protobuf alternative:** Send `Content-Type: application/x-protobuf` with Snappy-compressed protobuf payload for better performance. The protobuf schema is defined in `logproto.proto`.

---

### GET /metrics

Exposes Prometheus-format metrics for the Loki process itself (not log data). Useful for monitoring Loki's own health and performance.

**Response:** Prometheus exposition format (text/plain):
```
# HELP loki_ingester_streams_created_total Total number of streams created
# TYPE loki_ingester_streams_created_total counter
loki_ingester_streams_created_total{} 1234
```

---

## Authentication

### No Auth (Default)

Loki ships with no authentication by default. The HTTP API is open on port 3100.

### Multi-Tenancy

In multi-tenant mode, every request must include the `X-Scope-OrgID` header:

```
X-Scope-OrgID: tenant1
```

This header determines which tenant's data is accessed or written. Without it in multi-tenant mode, requests are rejected.

### Reverse Proxy Auth

In production, Loki is typically deployed behind a reverse proxy (nginx, Traefik, or Grafana's built-in auth proxy) that handles authentication and injects the `X-Scope-OrgID` header.

### Basic Auth

When deployed behind Grafana Cloud or a proxy:
```
Authorization: Basic <base64(user:api_key)>
```

---

## LogQL Quick Reference

LogQL is Loki's query language, structured similarly to PromQL.

### Stream Selectors

```logql
{job="myapp"}                         # Exact match
{job="myapp", level="error"}          # Multiple labels (AND)
{job=~"myapp|otherapp"}               # Regex match
{job!="myapp"}                        # Not equal
{job!~"test.*"}                       # Negative regex
```

### Log Pipeline (Filters)

```logql
{job="myapp"} |= "error"             # Line contains "error"
{job="myapp"} != "debug"             # Line does NOT contain "debug"
{job="myapp"} |~ "err(or|fail)"      # Line matches regex
{job="myapp"} !~ "health(check)?"    # Line does NOT match regex
```

### Parsers

```logql
{job="myapp"} | json                  # Parse JSON log lines
{job="myapp"} | logfmt                # Parse logfmt key=value lines
{job="myapp"} | pattern "<ip> - <_> [<timestamp>] <method> <path>"
{job="myapp"} | regexp "(?P<ip>\\d+\\.\\d+\\.\\d+\\.\\d+)"
```

### Label Filters (Post-Parse)

```logql
{job="myapp"} | json | status >= 400
{job="myapp"} | logfmt | duration > 10s
{job="myapp"} | json | level="error"
```

### Metric Queries

```logql
count_over_time({job="myapp"}[5m])                    # Count of log lines
rate({job="myapp"}[5m])                               # Lines per second
bytes_over_time({job="myapp"}[5m])                    # Bytes throughput
sum by (level) (count_over_time({job="myapp"}[1h]))   # Aggregation
```

---

## Timestamp Precision

Loki uses **nanosecond-precision Unix epoch timestamps** throughout its API:

| Unit         | Example Value            | Digits |
|--------------|--------------------------|--------|
| Seconds      | `1708185600`             | 10     |
| Milliseconds | `1708185600000`          | 13     |
| Nanoseconds  | `1708185600000000000`    | 19     |

The push API and query responses use nanosecond strings. The `start`/`end` query parameters accept seconds (float), nanoseconds (integer string), or RFC3339.

**JavaScript precision warning:** Nanosecond timestamps (~1.7e18) exceed `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991 or ~9e15). Always use string operations rather than arithmetic when constructing nanosecond timestamps in JavaScript:

```typescript
// WRONG: precision loss due to floating point
const tsNs = Date.now() * 1_000_000;           // loses precision

// CORRECT: string concatenation preserves all digits
const tsNs = String(Date.now()) + '000000';    // ms -> ns via string
```

---

## PortOfCall Implementation

### Proxy Endpoints

PortOfCall exposes these endpoints that proxy to a target Loki instance:

| PortOfCall Endpoint    | Method | Upstream Loki Endpoint              |
|------------------------|--------|-------------------------------------|
| `/api/loki/health`     | POST   | `/ready`, `/loki/api/v1/status/buildinfo`, `/loki/api/v1/labels` |
| `/api/loki/query`      | POST   | `/loki/api/v1/query`                |
| `/api/loki/metrics`    | POST   | `/metrics`                          |
| `/api/loki/push`       | POST   | `/loki/api/v1/push`                 |
| `/api/loki/range`      | POST   | `/loki/api/v1/query_range`          |

All PortOfCall endpoints accept POST with a JSON body containing `host` (required) and `port` (optional, default 3100).

### Request/Response Examples

**Health check:**
```json
// Request: POST /api/loki/health
{ "host": "loki.example.com", "port": 3100 }

// Response
{
  "success": true,
  "host": "loki.example.com",
  "port": 3100,
  "results": {
    "ready": { "statusCode": 200, "healthy": true, "body": "ready" },
    "buildInfo": { "version": "2.9.0", ... },
    "labels": { "status": "success", "data": ["job", "level"], "count": 2 }
  },
  "responseTime": 142
}
```

**Instant query:**
```json
// Request: POST /api/loki/query
{ "host": "loki.example.com", "query": "{job=\"myapp\"} |= \"error\"", "limit": 50 }

// Response
{
  "success": true,
  "host": "loki.example.com",
  "port": 3100,
  "query": "{job=\"myapp\"} |= \"error\"",
  "statusCode": 200,
  "result": { "status": "success", "data": { ... } },
  "responseTime": 89
}
```

**Push logs:**
```json
// Request: POST /api/loki/push
{
  "host": "loki.example.com",
  "labels": { "job": "myapp", "level": "info" },
  "lines": ["application started", "listening on port 8080"]
}

// Response
{
  "success": true,
  "host": "loki.example.com",
  "port": 3100,
  "rtt": 34,
  "httpStatus": 204,
  "linesSubmitted": 2,
  "labels": "{job=\"myapp\", level=\"info\"}",
  "message": "2 log line(s) pushed successfully"
}
```

**Range query:**
```json
// Request: POST /api/loki/range
{
  "host": "loki.example.com",
  "query": "{job=\"myapp\"}",
  "start": "1708185600000000000",
  "end": "1708189200000000000",
  "limit": 200,
  "direction": "backward"
}

// Response
{
  "success": true,
  "host": "loki.example.com",
  "port": 3100,
  "query": "{job=\"myapp\"}",
  "streamCount": 3,
  "totalEntries": 187,
  "streams": [
    {
      "stream": { "job": "myapp", "level": "error" },
      "entryCount": 42,
      "entries": [
        { "timestamp": "2024-02-17T12:00:00.000Z", "line": "error: connection refused" }
      ]
    }
  ]
}
```

**Metrics scrape:**
```json
// Request: POST /api/loki/metrics
{ "host": "loki.example.com" }

// Response
{
  "success": true,
  "host": "loki.example.com",
  "port": 3100,
  "totalMetrics": 245,
  "totalSamples": 1832,
  "typeDistribution": { "counter": 89, "gauge": 67, "histogram": 54, "summary": 35 },
  "metrics": [
    { "name": "loki_ingester_streams_created_total", "type": "counter", "help": "...", "samples": 4 }
  ],
  "responseTime": 210
}
```

### Implementation Notes

- **Transport:** GET endpoints (`/ready`, `/loki/api/v1/labels`, `/loki/api/v1/query`, `/loki/api/v1/query_range`, `/metrics`) use raw TCP sockets via `cloudflare:sockets` with hand-built HTTP/1.1 requests. The push endpoint uses the Fetch API since it requires POST.
- **Chunked encoding:** The raw TCP HTTP parser handles `Transfer-Encoding: chunked` responses, which Loki commonly uses.
- **Cloudflare detection:** All handlers check whether the target host is behind Cloudflare (which would prevent connection from a Cloudflare Worker) and return a 403 with an explanatory message.
- **Timeouts:** Default 15 seconds for queries, 10 seconds for push. Configurable per-request.
- **Response size limit:** Raw socket reads are capped at 512 KB to prevent memory issues.

### Common Errors

| Error | Cause |
|-------|-------|
| `Connection timeout` | Target host unreachable or port closed |
| `Invalid HTTP response` | Non-HTTP service on target port, or connection reset |
| `This domain is protected by Cloudflare` | Cannot connect from a Cloudflare Worker to a Cloudflare-proxied host |
| `HTTP 400` on push | Malformed JSON, out-of-order timestamps, or invalid labels |
| `HTTP 429` on push | Rate limited by Loki ingestion limits |
