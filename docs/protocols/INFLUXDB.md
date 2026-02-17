# InfluxDB Protocol (HTTP API v2)

## Overview

**InfluxDB** is a time-series database exposing an HTTP API on port 8086. This implementation
uses raw TCP sockets (`cloudflare:sockets`) to issue HTTP/1.1 requests directly, bypassing
`fetch()`. The API targets InfluxDB 2.x (`/api/v2/*` paths) exclusively — InfluxDB 1.x
(`/query`, `/write`) is not supported.

**Port:** 8086 (default, plaintext)
**Transport:** TCP → HTTP/1.1
**Auth:** `Authorization: Token <token>` — optional; omit for open/no-auth instances
**Query Language:** Flux only (no InfluxQL)

## Endpoints

### Health Check — `POST /api/influxdb/health`

Probes the server with two sequential HTTP requests:

1. `GET /health` — server liveness
2. `GET /api/v2/ready` — readiness (startup complete, storage ready)

**Request body:**

```json
{
  "host": "influxdb.example.com",
  "port": 8086,
  "token": "my-token",
  "timeout": 15000
}
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `host` | yes | — | Hostname or IP |
| `port` | no | `8086` | |
| `token` | no | — | Omit for unauthenticated instances |
| `timeout` | no | `15000` | Milliseconds; applies per-request |

**Response:**

```json
{
  "success": true,
  "statusCode": 200,
  "parsed": {
    "health": { "name": "influxdb", "message": "ready for queries and writes", "status": "pass", "checks": [], "version": "2.7.1", "commit": "..." },
    "ready":  { "status": "ready", "started": "2024-01-15T10:00:00Z", "up": "72h0m0s" }
  },
  "latencyMs": 42
}
```

- `success` is `true` when `GET /health` returns 2xx or 3xx
- `parsed.ready` is `null` if `/api/v2/ready` fails (e.g., older InfluxDB versions)
- `latencyMs` covers both requests combined

---

### Write — `POST /api/influxdb/write`

Writes time-series data using **InfluxDB Line Protocol**. Sends:

```
POST /api/v2/write?org=<org>&bucket=<bucket>&precision=ns
Content-Type: text/plain; charset=utf-8
```

Precision is hardcoded to `ns` (nanoseconds). Line Protocol timestamps must be in nanoseconds
or omitted (server assigns current time).

**Request body:**

```json
{
  "host": "influxdb.example.com",
  "port": 8086,
  "token": "my-token",
  "org": "myorg",
  "bucket": "mybucket",
  "lineProtocol": "cpu,host=server01,region=us-east usage_idle=92.1,usage_user=3.4 1609459200000000000",
  "timeout": 15000
}
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `host` | yes | — | |
| `port` | no | `8086` | |
| `token` | no | — | |
| `org` | yes | — | InfluxDB organization name |
| `bucket` | yes | — | Target bucket |
| `lineProtocol` | yes | — | Raw Line Protocol string — see format below |
| `timeout` | no | `15000` | |

**Line Protocol format:**

```
<measurement>[,<tag_key>=<tag_val>...] <field_key>=<field_val>[,...] [<timestamp_ns>]
```

- Tags are indexed; fields are the actual data values
- Multiple lines (batch write): separate with `\n`
- Integer fields: append `i` — e.g., `count=42i`
- String fields: double-quote — e.g., `host="server01"`
- Boolean fields: `t`, `T`, `true`, `f`, `F`, `false`
- Escape spaces in measurement/tag names with `\ `

**Response:**

```json
{
  "success": true,
  "statusCode": 204,
  "body": "",
  "parsed": null,
  "latencyMs": 18
}
```

- **204 No Content** = write accepted (normal InfluxDB success)
- On error, `parsed` may contain `{"code": "...", "message": "..."}` from InfluxDB
- `body` is typically empty on success

**Batch write example:**

```
"lineProtocol": "temp,sensor=A value=21.3 1700000000000000000\ntemp,sensor=B value=19.8 1700000000000000000"
```

---

### Query — `POST /api/influxdb/query`

Executes a **Flux** query. Sends:

```
POST /api/v2/query?org=<org>
Content-Type: application/json
Accept: application/json
Body: {"query": "<flux>", "type": "flux"}
```

**Request body:**

```json
{
  "host": "influxdb.example.com",
  "port": 8086,
  "token": "my-token",
  "org": "myorg",
  "query": "from(bucket:\"mybucket\") |> range(start: -1h) |> filter(fn: (r) => r._measurement == \"cpu\")",
  "timeout": 15000
}
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `host` | yes | — | |
| `port` | no | `8086` | |
| `token` | no | — | |
| `org` | yes | — | |
| `query` | yes | — | Flux query string |
| `timeout` | no | `15000` | |

**Response:**

```json
{
  "success": true,
  "statusCode": 200,
  "body": "#datatype,string,...\n#group,false,...\n#default,...\n,result,table,...\n,_result,0,...",
  "parsed": null,
  "latencyMs": 67
}
```

**Critical:** InfluxDB returns Flux results as **annotated CSV**, not JSON. `parsed` is always
`null` for successful queries — the actual data is in `body` as CSV text.

**Annotated CSV format:**

```csv
#datatype,string,long,dateTime:RFC3339,dateTime:RFC3339,dateTime:RFC3339,double,string,string,string
#group,false,false,true,true,false,false,true,true,true
#default,_result,,,,,,,
,result,table,_start,_stop,_time,_value,_field,_measurement,host
,_result,0,2024-01-01T00:00:00Z,2024-01-01T01:00:00Z,2024-01-01T00:30:00Z,92.1,usage_idle,cpu,server01
```

Parse CSV client-side. The `#datatype` annotation row indicates column types.
Multiple tables in a result set are delimited by blank lines.

## Flux Quick Reference

```flux
// Basic range query
from(bucket: "mybucket")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "cpu" and r.host == "server01")

// Aggregate: mean per 5m window
from(bucket: "mybucket")
  |> range(start: -24h)
  |> filter(fn: (r) => r._measurement == "temperature")
  |> aggregateWindow(every: 5m, fn: mean, createEmpty: false)

// Last value per tag group
from(bucket: "mybucket")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "metrics")
  |> last()

// Group by tag, pivot fields to columns
from(bucket: "mybucket")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "cpu")
  |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")

// Join two measurements
a = from(bucket: "b") |> range(start: -1h) |> filter(fn: (r) => r._measurement == "m1")
b = from(bucket: "b") |> range(start: -1h) |> filter(fn: (r) => r._measurement == "m2")
join(tables: {a: a, b: b}, on: ["_time", "host"])
```

## Transport Details

All three handlers use `cloudflare:sockets` `connect()` to open a raw TCP connection and
issue HTTP/1.1 requests manually (not `fetch()`). Implications:

- **No TLS** — connections are plaintext only; do not send tokens to untrusted networks
- **No HTTP/2** — HTTP/1.1 with `Connection: close`; one request per TCP connection
- **512 KB response cap** — responses truncated at 512,000 bytes; large Flux result sets will be cut off
- **Chunked Transfer-Encoding** — decoded transparently via `decodeChunked()`
- **org/bucket URL-encoded** — special characters in org or bucket names are percent-encoded automatically

## Authentication

Token auth only — InfluxDB 2.x all-access or scoped tokens:

```
Authorization: Token glx_xxxxxxxxxxxxxxxxxxxxxxxx
```

- Token is optional; omit for open instances (`token` field absent or empty)
- No Basic Auth support
- No API key auth (unlike InfluxDB Cloud UI)
- Tokens are scoped per org; a token from org A cannot write to org B

## Known Limitations

| Limitation | Detail |
|------------|--------|
| No TLS | Raw TCP only — use a TLS-terminating proxy (e.g., nginx, Cloudflare Tunnel) |
| No InfluxQL | Only Flux queries supported |
| Precision fixed | Write path always uses `precision=ns`; supply nanosecond timestamps |
| No delete endpoint | `/api/v2/delete` not implemented |
| 512 KB cap | Large query results are truncated; use `limit()` or `aggregateWindow()` in Flux |
| Single-org token | Token must match the `org` parameter |
| No streaming | Entire response buffered before returning |

## Resources

- [InfluxDB 2.x API Reference](https://docs.influxdata.com/influxdb/v2/api/)
- [Line Protocol Reference](https://docs.influxdata.com/influxdb/v2/reference/syntax/line-protocol/)
- [Flux Language Reference](https://docs.influxdata.com/flux/v0/)
- [Annotated CSV Specification](https://docs.influxdata.com/influxdb/v2/reference/syntax/annotated-csv/)
