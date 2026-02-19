# Graphite (2003) — Power-User Reference

Port of Call implementation: `src/worker/graphite.ts`

## Endpoints

| # | Route | Method | Transport | Input | Cloudflare check |
|---|-------|--------|-----------|-------|------------------|
| 1 | `/api/graphite/send` | POST | TCP socket (plaintext) | JSON body | Yes |
| 2 | `/api/graphite/query` | GET | HTTP fetch → Graphite render API | Query params | No |
| 3 | `/api/graphite/find` | GET | HTTP fetch → Graphite metrics/find API | Query params | No |
| 4 | `/api/graphite/info` | GET | HTTP fetch → Graphite web root + render | Query params | No |

Two distinct transports: endpoint 1 opens a raw TCP socket to Carbon's line receiver (port 2003). Endpoints 2-4 issue HTTP `fetch()` requests to Graphite-web's render API (default port 80). This means `/send` targets Carbon while `/query`, `/find`, `/info` target Graphite-web — often different ports, sometimes different hosts.

---

## 1. POST `/api/graphite/send`

Sends metrics to a Graphite Carbon receiver using the plaintext protocol. Fire-and-forget: Carbon does not send a response, so success means "TCP connection established and data written without error".

### Request

```json
{
  "host": "graphite.example.com",
  "port": 2003,
  "metrics": [
    { "name": "app.requests.total", "value": 1234 },
    { "name": "app.response.p95", "value": 45.2, "timestamp": 1700000000 }
  ],
  "timeout": 10000
}
```

| Field | Type | Default | Required | Notes |
|-------|------|---------|----------|-------|
| `host` | string | — | Yes | Carbon receiver hostname |
| `port` | number | `2003` | No | **Not validated** — negative/zero/65536+ accepted |
| `metrics` | array | — | Yes | 1-100 metrics |
| `metrics[].name` | string | — | Yes | `/^[a-zA-Z0-9._-]+$/`, max 512 chars |
| `metrics[].value` | number | — | Yes | Must be finite (`NaN`/`Infinity` rejected) |
| `metrics[].timestamp` | number | `now` | No | Unix epoch seconds. **Uses `\|\|` not `??`** — timestamp `0` is replaced with current time |
| `timeout` | number | `10000` | No | Connection + write timeout in ms |

### Response (success)

```json
{
  "success": true,
  "message": "Sent 2 metric(s) to Graphite",
  "host": "graphite.example.com",
  "port": 2003,
  "metricsCount": 2,
  "payload": "app.requests.total 1234 1700000000\napp.response.p95 45.2 1700000000"
}
```

The `payload` field contains the exact plaintext sent over the wire (trailing newline trimmed in the response). Useful for debugging.

### Wire format

```
metric.name value timestamp\n
```

Each metric is one line, space-separated: name, value, Unix timestamp. Terminated with `\n`. Multiple metrics are newline-separated. The final line also ends with `\n`.

### Validation

- Metric name: alphanumeric, dots, underscores, hyphens. Max 512 chars. Empty string rejected.
- Metric value: `isNaN()` and `isFinite()` checks. `undefined` rejected.
- Batch size: max 100 metrics. Returns HTTP 400 if exceeded.
- Host: required (empty string check only). No hostname regex.
- Port: no validation at all.

### curl

```bash
curl -X POST https://portofcall.example/api/graphite/send \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "graphite.example.com",
    "metrics": [
      {"name": "test.metric", "value": 42},
      {"name": "test.gauge", "value": 99.9}
    ]
  }'
```

---

## 2. GET `/api/graphite/query`

Queries Graphite-web's `/render` API for time-series data.

### Request (query params)

| Param | Default | Required | Notes |
|-------|---------|----------|-------|
| `host` | — | Yes | Graphite-web hostname |
| `target` | — | Yes | Graphite target expression (e.g. `servers.web01.cpu.*`, `summarize(app.requests,"1h","sum")`) |
| `from` | `-1h` | No | Graphite relative time string or epoch |
| `until` | `now` | No | Graphite relative time string or epoch |
| `format` | `json` | No | Response format (`json`, `csv`, `raw`, etc.) |
| `renderPort` | `80` | No | Graphite-web HTTP port. **Parsed with `parseInt`** — non-numeric strings become `NaN` |

### Response

```json
{
  "success": true,
  "host": "graphite.example.com",
  "renderPort": 80,
  "target": "servers.web01.cpu.*",
  "from": "-1h",
  "until": "now",
  "seriesCount": 3,
  "series": [
    {
      "target": "servers.web01.cpu.user",
      "datapoints": [[45.2, 1700000000], [null, 1700000060], [50.1, 1700000120]]
    }
  ],
  "latencyMs": 234
}
```

Datapoints are `[value | null, timestamp]` pairs. `null` values indicate missing data.

### Graphite error handling

If Graphite returns a non-200 status, the response is still **HTTP 200** with `success: false`, the Graphite status code in `statusCode`, and the first 256 chars of the error body in `error`. Only internal exceptions produce HTTP 500.

### curl

```bash
curl "https://portofcall.example/api/graphite/query?host=graphite.local&target=app.requests.total&from=-24h&until=now"
```

---

## 3. GET `/api/graphite/find`

Searches for metrics matching a query pattern via Graphite-web's `/metrics/find` API.

### Request (query params)

| Param | Default | Required | Notes |
|-------|---------|----------|-------|
| `host` | — | Yes | Graphite-web hostname |
| `query` | — | Yes | Metric path pattern. Supports `*` (wildcard) and `{a,b}` (alternatives) |
| `renderPort` | `80` | No | Graphite-web HTTP port |

### Response

```json
{
  "success": true,
  "host": "graphite.example.com",
  "renderPort": 80,
  "query": "servers.web01.*",
  "count": 4,
  "metrics": [
    { "id": "servers.web01.cpu", "text": "cpu", "leaf": 0, "expandable": 1 },
    { "id": "servers.web01.memory", "text": "memory", "leaf": 0, "expandable": 1 },
    { "id": "servers.web01.disk", "text": "disk", "leaf": 0, "expandable": 1 },
    { "id": "servers.web01.uptime", "text": "uptime", "leaf": 1, "expandable": 0 }
  ],
  "latencyMs": 45
}
```

- `leaf: 1` = this is a metric (has data). `leaf: 0` = this is a branch (has children).
- `expandable: 1` = can be drilled into with `query=servers.web01.cpu.*`.

### curl

```bash
curl "https://portofcall.example/api/graphite/find?host=graphite.local&query=servers.*"
```

---

## 4. GET `/api/graphite/info`

Health check against Graphite-web. Makes two sequential HTTP requests to probe the web interface.

### Request (query params)

| Param | Default | Required | Notes |
|-------|---------|----------|-------|
| `host` | — | Yes | Graphite-web hostname |
| `renderPort` | `80` | No | Graphite-web HTTP port |

### Probe sequence

1. `GET http://{host}:{renderPort}/` — checks if the web interface is up. Body truncated to 512 chars.
2. `GET http://{host}:{renderPort}/render?format=json&target=test&from=-1min` — checks if the render API is responding. Status 200 **or 400** both count as healthy (400 means the API is responding but the metric doesn't exist).

### Response

```json
{
  "success": true,
  "host": "graphite.example.com",
  "renderPort": 80,
  "rootStatus": 200,
  "rootBodyPreview": "<!DOCTYPE html>...",
  "renderStatus": 200,
  "renderHealthy": true,
  "latencyMs": 123
}
```

`success` = `rootStatus` in range 200-499 (anything except 5xx or connection failure).

### curl

```bash
curl "https://portofcall.example/api/graphite/info?host=graphite.local"
```

---

## Cross-endpoint comparison

| | `/send` | `/query` | `/find` | `/info` |
|---|---------|---------|--------|---------|
| Method | POST | GET | GET | GET |
| Transport | TCP socket | HTTP fetch | HTTP fetch | HTTP fetch |
| Target service | Carbon (2003) | Graphite-web (80) | Graphite-web (80) | Graphite-web (80) |
| Port param | `port` (body) | `renderPort` (query) | `renderPort` (query) | `renderPort` (query) |
| Default port | 2003 | 80 | 80 | 80 |
| CF detection | Yes | No | No | No |
| Timeout | Configurable | None | None | None |
| Host validation | Required + regex-free | Required + regex-free | Required + regex-free | Required + regex-free |
| Port validation | None | None | None | None |
| Error HTTP status | 400/403/500 | 200 (with `success: false`) or 500 | 200 (with `success: false`) or 500 | 200 or 500 |

---

## Known quirks and limitations

1. **Timestamp `0` replaced with current time** — `/send` uses `m.timestamp || now` (JavaScript `||` operator). Since `0` is falsy, `timestamp: 0` (Unix epoch) is silently replaced with the current time. Use `timestamp: 1` as the minimum if you need near-epoch timestamps.

2. **No port validation on `/send`** — the `port` field is not range-checked. Values like `0`, `-1`, or `99999` are passed directly to `connect()`. This will fail at the socket level, not with a helpful validation error.

3. **HTTP only for render API** — endpoints 2-4 construct URLs with `http://` hardcoded. No HTTPS option for communicating with Graphite-web. If your Graphite-web is HTTPS-only, these endpoints won't reach it.

4. **No timeout on HTTP endpoints** — only `/send` has a configurable timeout (default 10s). The HTTP `fetch()` calls in `/query`, `/find`, and `/info` have no timeout and rely on Cloudflare's default request timeout.

5. **No Cloudflare detection on HTTP endpoints** — only `/send` (TCP) runs `checkIfCloudflare()`. The HTTP endpoints use `fetch()` which routes through Cloudflare's network differently and doesn't need the same check, but the inconsistency is notable.

6. **`renderPort` `parseInt` edge case** — `parseInt('abc', 10)` returns `NaN`, which gets embedded in the URL as `http://host:NaN/render?...`. This will cause a `fetch()` error, not a clean validation message.

7. **`rootBodyPreview` truncation** — `/info` truncates the root page body to 512 chars. HTML content may be cut mid-tag, producing invalid markup in the response.

8. **`renderHealthy` treats 400 as healthy** — in `/info`, HTTP 400 from the render endpoint is considered healthy. This is intentional: a 400 means the API is responding (the `target=test` metric just doesn't exist). But it could mask a misconfigured Graphite-web that always returns 400.

9. **No method restriction** — none of the 4 endpoints check `request.method`. `/send` effectively requires POST (since `request.json()` needs a body), but `/query`, `/find`, `/info` work with any HTTP method (GET, POST, PUT, etc.).

10. **SSRF potential in HTTP endpoints** — the `host` and `renderPort` params in `/query`, `/find`, `/info` are not restricted. They construct URLs like `http://{host}:{renderPort}/render?...` and issue `fetch()` calls. There's no hostname allowlist or private-IP blocking beyond what Cloudflare Workers enforce at the platform level.

---

## Local testing

```bash
# Start Graphite + StatsD in Docker
docker run -d --name graphite \
  -p 2003:2003 -p 80:80 \
  graphiteapp/graphite-statsd

# Send a metric via the API
curl -X POST http://localhost:8787/api/graphite/send \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","metrics":[{"name":"test.metric","value":42}]}'

# Query the metric
curl "http://localhost:8787/api/graphite/query?host=localhost&target=test.metric&from=-5min"

# Browse metrics
curl "http://localhost:8787/api/graphite/find?host=localhost&query=test.*"

# Health check
curl "http://localhost:8787/api/graphite/info?host=localhost"
```
