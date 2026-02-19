# Prometheus HTTP API — Protocol Documentation

## Overview

Prometheus is a CNCF-graduated open-source monitoring toolkit. Its primary interface is a pull-based HTTP API for querying time-series data via PromQL.

- **Default port:** 9090
- **Transport:** HTTP/1.1 over TCP
- **Auth:** None (basic auth/bearer tokens not supported by this client)
- **API prefix:** `/api/v1/`

---

## Implemented Endpoints (Worker API)

| Worker Route | Prometheus Target |
|---|---|
| `POST /api/prometheus/health` | `/-/healthy`, `/-/ready`, `/api/v1/status/buildinfo`, `/api/v1/targets` |
| `POST /api/prometheus/query` | `GET /api/v1/query` |
| `POST /api/prometheus/metrics` | `GET /metrics` |
| `POST /api/prometheus/range` | `GET /api/v1/query_range` |

---

## Request/Response Schemas

### `POST /api/prometheus/health`

```json
{ "host": "prometheus.example.com", "port": 9090, "timeout": 15000 }
```

Response:
```json
{
  "success": true,
  "host": "prometheus.example.com",
  "port": 9090,
  "healthy": true,
  "ready": true,
  "healthMessage": "Prometheus Server is Healthy.",
  "statusCode": 200,
  "latencyMs": 12,
  "version": "2.48.0",
  "revision": "de5e7a4e3da0",
  "goVersion": "go1.21.4",
  "branch": "HEAD",
  "activeTargets": 3
}
```

Notes:
- `latencyMs` measures only the `/-/healthy` round-trip; not total probe time
- `revision` truncated to 12 characters
- `activeTargets` is `null` if `/api/v1/targets` is unavailable

### `POST /api/prometheus/query`

```json
{ "host": "prometheus.example.com", "port": 9090, "query": "up", "timeout": 15000 }
```

Response:
```json
{
  "success": true,
  "query": "up",
  "status": "success",
  "resultType": "vector",
  "resultCount": 2,
  "results": [
    {
      "metric": { "__name__": "up", "instance": "localhost:9090", "job": "prometheus" },
      "value": { "timestamp": 1700000000, "value": "1" }
    }
  ],
  "warnings": null,
  "error": null,
  "errorType": null
}
```

### `POST /api/prometheus/range`

```json
{
  "host": "prometheus.example.com",
  "port": 9090,
  "query": "rate(http_requests_total[5m])",
  "start": "1700000000",
  "end": "1700003600",
  "step": "60",
  "timeout": 15000
}
```

- `start`/`end`: optional, defaults to now-3600s/now
- `step`: duration string (`5m`, `1h`) or float seconds, defaults to `"60"`

Response:
```json
{
  "success": true,
  "status": "success",
  "resultType": "matrix",
  "seriesCount": 3,
  "series": [
    {
      "metric": { "__name__": "http_requests_total", "handler": "/metrics" },
      "valueCount": 61,
      "firstValue": [1700000000, "1.2"],
      "lastValue": [1700003600, "1.5"],
      "sampleValues": [{ "ts": 1700000000, "value": "1.2" }]
    }
  ],
  "warnings": null,
  "error": null,
  "errorType": null
}
```

### `POST /api/prometheus/metrics`

```json
{ "host": "prometheus.example.com", "port": 9090, "timeout": 15000 }
```

Response includes `metricFamilyCount`, `sampleCount`, `typeCounts` (counter/gauge/histogram/summary), and `preview` of first 30 samples.

---

## Prometheus API Reference

### Health Endpoints

- `GET /-/healthy` → HTTP 200 + `"Prometheus Server is Healthy.\n"` when running
- `GET /-/ready` → HTTP 200 + `"Prometheus Server is Ready.\n"` once TSDB loaded

**Key distinction:** A server can be healthy but not ready during startup/TSDB replay.

### API Envelope

All `/api/v1/` endpoints return:
```json
{
  "status": "success" | "error",
  "data": { ... },
  "warnings": ["..."],
  "error": "message if error",
  "errorType": "bad_data" | "execution" | "canceled" | "timeout" | "internal" | "unavailable" | "not_found"
}
```

**Critical:** Prometheus returns HTTP 200 even for errors. Always check `status`, not the HTTP code.

### `/api/v1/query` Parameters

| Parameter | Required | Default | Description |
|---|---|---|---|
| `query` | yes | — | PromQL expression |
| `time` | no | server current time | Unix timestamp or RFC 3339 |
| `timeout` | no | global flag | e.g. `30s` |

### `/api/v1/query_range` Parameters

| Parameter | Required | Default (worker) | Description |
|---|---|---|---|
| `query` | yes | — | PromQL expression |
| `start` | no | now - 3600s | Unix timestamp or RFC 3339 |
| `end` | no | now | Unix timestamp or RFC 3339 |
| `step` | no | `60` | Resolution step |

**Max data points:** `(end - start) / step <= 11000`. Exceeding returns `errorType: "bad_data"`.

### Result Types

| Type | Description | `result` element |
|---|---|---|
| `vector` | One value per series (instant query) | `{ metric, value: [ts, v] }` |
| `matrix` | Value range per series (range query) | `{ metric, values: [[ts, v], ...] }` |
| `scalar` | Single numeric value | `[ts, v]` |
| `string` | String literal | `[ts, "string"]` |

**Sample values are always strings** — not numbers — to allow `"NaN"`, `"+Inf"`, `"-Inf"`.

---

## Metric Types

| Type | Description |
|---|---|
| `counter` | Monotonically increasing, name ends in `_total` |
| `gauge` | Arbitrary value, can go up or down |
| `histogram` | Bucketed observations: `_bucket{le=...}`, `_sum`, `_count` |
| `summary` | Client-side quantiles: `{quantile=...}`, `_sum`, `_count` |
| `untyped` | Unknown type, treated as gauge |

---

## PromQL Quick Reference

| Expression | Description |
|---|---|
| `up` | 1 if target up, 0 if down |
| `rate(metric[5m])` | Per-second rate over 5 minutes (counters) |
| `irate(metric[5m])` | Instantaneous rate (last two samples) |
| `increase(metric[5m])` | Total increase over 5 minutes |
| `histogram_quantile(0.95, rate(hist_bucket[5m]))` | 95th percentile |
| `avg_over_time(gauge[1h])` | Average over 1 hour |
| `sum by (label)(metric)` | Aggregate by label |

Label matchers: `=` `!=` `=~` `!~`

Duration strings: `ms` `s` `m` `h` `d` `w` `y`

---

## Edge Cases and Known Limitations

1. **No authentication.** No `Authorization` header sent. Protected instances return 401/403.
2. **No HTTPS.** Plain TCP only. TLS instances (common behind proxies) unreachable.
3. **HTTP 200 on error.** Must check `status` field, not HTTP status code.
4. **Latency measures only `/-/healthy`.** Health handler makes 4 sequential requests; `latencyMs` covers only the first.
5. **512 KB response cap.** Large `/metrics` payloads truncated mid-stream; sample counts will be incomplete.
6. **No redirect following.** 301/302 from a trailing-slash redirect on `/-/healthy` causes `healthy: false`.
7. **`step=0` rejected.** Prometheus returns `errorType: "bad_data"` for zero or negative step.
8. **`time` not sent for instant queries.** Queries always execute at server's current time.
9. **Stale markers.** When a target disappears, Prometheus writes `NaN` stale markers — indistinguishable from genuine NaN.
10. **Subquery result type.** Instant query with `metric[5m:1m]` subquery syntax returns `resultType: "matrix"`, not `"vector"`.

---

## Curl Examples

```bash
# Health
curl http://prometheus:9090/-/healthy
curl http://prometheus:9090/-/ready

# Build info
curl -s http://prometheus:9090/api/v1/status/buildinfo | jq .data.version

# Instant query — all up targets
curl -s 'http://prometheus:9090/api/v1/query?query=up' | \
  jq '.data.result[] | {instance: .metric.instance, value: .value[1]}'

# 95th percentile request duration
curl -s 'http://prometheus:9090/api/v1/query?query=histogram_quantile(0.95,rate(prometheus_http_request_duration_seconds_bucket[5m]))' | jq .

# Range query — last hour, 1-minute steps
START=$(date -u -v-1H +%s 2>/dev/null || date -u --date='1 hour ago' +%s)
END=$(date -u +%s)
curl -s "http://prometheus:9090/api/v1/query_range?query=rate(process_cpu_seconds_total[5m])&start=${START}&end=${END}&step=60" | \
  jq '.data.result[0].values[-1]'

# Active targets
curl -s 'http://prometheus:9090/api/v1/targets?state=active' | \
  jq '.data.activeTargets[] | {job: .labels.job, instance: .labels.instance, health: .health}'

# Count down targets
curl -s 'http://prometheus:9090/api/v1/targets' | \
  jq '[.data.activeTargets[] | select(.health != "up")] | length'

# Via worker
curl -s -X POST http://localhost:8787/api/prometheus/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"prometheus.example.com","query":"up"}' | jq .
```
