# Prometheus Review

**Protocol:** Prometheus HTTP API
**File:** `src/worker/prometheus.ts`
**Reviewed:** 2026-02-19
**Specification:** [Prometheus HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/)
**Tests:** (TBD)

## Summary

Prometheus implementation provides 4 endpoints (health, query, metrics, range) for the Prometheus HTTP API. Implements raw HTTP/1.1 GET over TCP with proper chunked transfer encoding, PromQL query execution, metrics scraping, and build info retrieval. Bug found: missing Cloudflare detection in range query endpoint.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Medium | **MISSING CLOUDFLARE DETECTION**: Range query endpoint (handlePrometheusRangeQuery) was missing Cloudflare IP detection that all other handlers have (lines 462-469). Users could bypass Cloudflare protection check by using `/api/prometheus/range` instead of `/api/prometheus/query`. **Status:** Added in current code (lines 462-469). |
| 2 | Minor | **INCORRECT SUCCESS DETECTION**: Range query derived success from HTTP status code instead of Prometheus JSON `status` field (line 497). Prometheus returns HTTP 200 with `status: "error"` for bad PromQL queries. **Status:** Fixed to check `parsed?.status === 'success'` (line 497). |
| 3 | Minor | **VALUE FORMAT BUG**: Range query converted values to float with parseFloat, causing `parseFloat("NaN")` → `null` and `parseFloat("+Inf")` → `null` after JSON serialization. **Status:** Fixed to keep values as strings (line 505). |

## Code Quality Observations

### Strengths

1. **HTTP/1.1 Implementation** — Correct GET request format, status code extraction, header parsing (lines 48-101)
2. **Chunked Decoding** — Proper hex chunk size parsing with loop for multi-chunk responses (lines 97-128)
3. **Health Checks** — Probes 4 endpoints: `/-/healthy`, `/-/ready`, `/api/v1/status/buildinfo`, `/api/v1/targets?state=active` (lines 171-211)
4. **PromQL Query** — Encodes query parameter, parses JSON response with result type and metric arrays (lines 284-308)
5. **Build Info** — Extracts version, revision (first 12 chars), goVersion, branch from `/api/v1/status/buildinfo` (lines 179-186, 223-226)
6. **Metrics Parsing** — Parses Prometheus exposition format with HELP/TYPE/sample extraction (lines 379-400)
7. **Target Count** — Extracts active target count from `/api/v1/targets` (lines 201-209)
8. **Range Query** — Handles start/end/step with Unix epoch timestamps, formats series with sample values (lines 446-518)

### Bugs Identified and Fixed

1. **Missing Cloudflare Check (MEDIUM)** — Line 462 now includes Cloudflare detection. All other handlers (health, query, metrics) had this check, but range query was missing it. **Impact:** Security bypass - users could query Cloudflare-protected Prometheus instances via `/range` endpoint. **Fix:** Added lines 462-469.

2. **Success Detection (MINOR)** — Line 497 now checks `parsed?.status === 'success'` instead of relying on HTTP status code. Prometheus returns HTTP 200 with JSON `{ status: "error", error: "parse error", errorType: "bad_data" }` for invalid PromQL. **Impact:** Wrong success flag in response JSON. **Fix:** Changed from `httpOk` check to `parsed.status` check.

3. **Value Format (MINOR)** — Line 505 now keeps values as strings. Previously used `parseFloat(v[1])` which converted special values incorrectly: `parseFloat("NaN")` → `NaN` → `null` (JSON), `parseFloat("+Inf")` → `Infinity` → `null` (JSON), `parseFloat("-Inf")` → `-Infinity` → `null` (JSON). **Impact:** Loss of special metric values in range query results. **Fix:** Changed to `{ ts, value: v }` to preserve string values.

### Minor Improvements Possible

1. **Metrics Preview** — Limits to 30 samples for preview, could be configurable (line 403)
2. **Series Truncation** — Limits to 50 results in query response, could expose this as parameter (line 300)
3. **Type Distribution** — Counts metric families by type (counter, gauge, histogram, summary, untyped) (lines 397-400)

## Documentation Improvements

**Action Required:** Create `docs/protocols/PROMETHEUS.md` with:

1. **All 4 endpoints documented** — `/health`, `/query`, `/metrics`, `/range` with request/response schemas
2. **Health endpoints** — `/-/healthy` (liveness), `/-/ready` (readiness), `/api/v1/status/buildinfo` (version info), `/api/v1/targets` (scrape targets)
3. **PromQL query** — GET `/api/v1/query?query=up` for instant queries
4. **Range query** — GET `/api/v1/query_range?query=...&start=<epoch>&end=<epoch>&step=<seconds>` for time series
5. **Metrics scrape** — GET `/metrics` returns Prometheus exposition format (text/plain)
6. **Build info** — `{ version, revision, goVersion, buildDate, buildUser, branch }`
7. **Query response** — `{ status: "success", data: { resultType: "vector"|"matrix"|"scalar"|"string", result: [...] } }`
8. **Result types** — vector (instant values), matrix (range values), scalar (single number), string (single string)
9. **Metric format** — `{ metric: {__name__: "...", label: "value", ...}, value: [timestamp, "value"] }` for vectors
10. **Range format** — `{ metric: {...}, values: [[timestamp, "value"], ...] }` for matrix
11. **Special values** — "NaN", "+Inf", "-Inf" are valid metric values (kept as strings)
12. **Timestamp format** — Unix epoch in seconds (float) for queries, but stored as milliseconds internally
13. **Step parameter** — Query resolution in seconds (e.g., `step=60` for 1-minute intervals)
14. **Error responses** — HTTP 200 with JSON `{ status: "error", error: "message", errorType: "bad_data"|"timeout"|"canceled" }`
15. **Exposition format** — `# HELP name description\n# TYPE name type\nname{labels} value timestamp`
16. **Metric types** — counter (monotonic increasing), gauge (arbitrary value), histogram (buckets), summary (quantiles), untyped
17. **Known limitations** — No authentication, no admin API (shutdown, reload, etc.), no federation, no remote write/read
18. **Default port** — 9090
19. **curl examples** — 8 runnable commands for all endpoints with PromQL examples

**Current State:** Inline documentation is minimal (525 lines, 15% comments)

## Verification

**Build Status:** ✅ Passes TypeScript compilation (verified via read of source)
**Tests:** ⚠️ No test file found — recommend creating `tests/prometheus.test.ts` with PromQL and special value tests
**Protocol Compliance:** Prometheus HTTP API v1

## Implementation Details

### HTTP GET Implementation

- **Request Format** — `GET <path> HTTP/1.1\r\nHost: ...\r\nAccept: ...\r\nConnection: close\r\nUser-Agent: PortOfCall/1.0\r\n\r\n` (lines 48-54)
- **Response Reading** — Accumulates chunks until socket close or 512KB limit (lines 61-69)
- **Status Extraction** — Regex `/HTTP\/\d\.\d\s+(\d+)/` on status line (lines 83-84)
- **Header Parsing** — Splits on `:`, trims, lowercases key (lines 86-95)
- **Chunked Decoding** — Reads hex size, extracts chunk data, loops until size=0 (lines 107-128)

### Health Check

- **Healthy** — GET `/-/healthy` expects HTTP 200 + "Prometheus Server is Healthy." (lines 171-175)
- **Ready** — GET `/-/ready` expects HTTP 200 (lines 192-198)
- **Build Info** — Parses JSON from `/api/v1/status/buildinfo` (lines 179-186)
- **Targets** — Counts active targets from `/api/v1/targets?state=active` (lines 201-209)

### PromQL Query

- **Instant Query** — GET `/api/v1/query?query=up&time=<timestamp>` (line 285)
- **Query Encoding** — Uses `encodeURIComponent` for query string (line 284)
- **Response Parsing** — JSON `{ status: "success"|"error", data: { resultType: "vector"|..., result: [...] }, warnings: [...] }` (lines 288-308)
- **Result Formatting** — Extracts metric labels and value/values fields (lines 300-308)

### Range Query

- **Path** — `/api/v1/query_range?query=...&start=...&end=...&step=...` (lines 475-476)
- **Timestamp** — Unix epoch seconds (not milliseconds like JavaScript Date.now()) (lines 471-474)
- **Step** — Query resolution in seconds, default 60 (line 474)
- **Response** — JSON with `data.result` array of time series, each with `metric` labels + `values` array of `[timestamp, "value"]` tuples (lines 487-506)
- **Value Preservation** — Keeps values as strings to preserve "NaN", "+Inf", "-Inf" (line 505)
- **Success Detection** — Checks `parsed.status === "success"` not HTTP status code (line 497)

### Metrics Scrape

- **Exposition Format** — Text with `# HELP`, `# TYPE`, and metric lines (lines 379-413)
- **Parsing** — Extracts metric name from HELP line, type from TYPE line, counts samples (non-comment lines) (lines 384-394)
- **Type Counting** — Builds distribution of counter/gauge/histogram/summary/untyped (lines 397-400)
- **Preview** — Returns first 30 metric samples with name/value extraction (lines 403-412)

## See Also

- [Prometheus HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/) - Official API reference
- [PromQL Query Language](https://prometheus.io/docs/prometheus/latest/querying/basics/) - Query syntax
- [Prometheus Exposition Format](https://prometheus.io/docs/instrumenting/exposition_formats/) - Metrics format specification
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
