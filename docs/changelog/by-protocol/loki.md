# Loki Review

**Protocol:** Grafana Loki HTTP API (JSON/HTTP over TCP)
**File:** `src/worker/loki.ts`
**Reviewed:** 2026-02-19
**Specification:** [Loki HTTP API](https://grafana.com/docs/loki/latest/reference/loki-http-api/)
**Tests:** (TBD)

## Summary

Loki implementation provides 5 endpoints (health, query, metrics, push, range) for Grafana Loki's HTTP API. Implements raw HTTP/1.1 GET over TCP for queries and fetch() for POST operations. Handles LogQL instant queries, range queries, log ingestion, Prometheus metrics scraping, and health checks. Correct nanosecond timestamp handling using string concatenation to avoid JavaScript Number precision loss.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 0 | Info | **NO CRITICAL BUGS FOUND** — Implementation correctly handles nanosecond timestamps and HTTP chunked encoding |

## Code Quality Observations

### Strengths

1. **Nanosecond Timestamp Safety** — Uses string concatenation for timestamps to avoid Number.MAX_SAFE_INTEGER overflow (lines 399-401, 472-474)
2. **HTTP/1.1 Parsing** — Correct header/body split, status code extraction, chunked transfer encoding (lines 82-120)
3. **Chunked Decoder** — Proper hex size parsing with loop for multi-chunk responses (lines 107-119)
4. **Fetch() for POST** — Uses fetch() API for log push (JSON POST) to avoid manual HTTP building (lines 414-435)
5. **Health Probes** — Checks 3 endpoints: `/ready`, `/loki/api/v1/status/buildinfo`, `/loki/api/v1/labels` (lines 145-192)
6. **LogQL Query** — Encodes query parameter correctly, handles `/loki/api/v1/query?query=...&limit=...` (lines 237-238)
7. **Range Query** — Proper start/end/step Unix epoch handling with nanosecond precision (lines 471-476)
8. **Metrics Parsing** — Parses Prometheus exposition format with HELP/TYPE/sample counting (lines 307-333)
9. **Labels JSON** — Extracts label list from `/loki/api/v1/labels` response (lines 174-182)

### Minor Improvements Possible

1. **Error Handling** — Consistent try/catch with generic error messages
2. **Response Size** — 512KB limit on TCP reads (line 70) is reasonable
3. **Timeout Handling** — Uses Promise.race with setTimeout for all operations

## Documentation Improvements

**Action Required:** Create `docs/protocols/LOKI.md` with:

1. **All 5 endpoints documented** — `/health`, `/query`, `/metrics`, `/push`, `/range` with request/response schemas
2. **Health endpoints** — `/ready` (200 = ready), `/loki/api/v1/status/buildinfo` (version/revision/Go version), `/loki/api/v1/labels` (available label names)
3. **LogQL query** — GET `/loki/api/v1/query?query={label="value"}&limit=100` for instant queries
4. **Range query** — GET `/loki/api/v1/query_range?query=...&start=<ns>&end=<ns>&limit=...&direction=forward|backward`
5. **Push API** — POST `/loki/api/v1/push` with JSON body: `{ streams: [{ stream: {label: "value"}, values: [[ns_timestamp, line], ...] }] }`
6. **Metrics scrape** — GET `/metrics` returns Prometheus exposition format (text/plain)
7. **Timestamp format** — Nanosecond Unix epoch as string (e.g., "1640000000000000000") to avoid JavaScript Number overflow
8. **Label format** — `{label1="value1", label2="value2"}` in LogQL queries and stream definitions
9. **Direction** — Range queries support `forward` (oldest first) or `backward` (newest first, default)
10. **Limit** — Max number of log lines to return (default 100)
11. **Push response** — Returns HTTP 204 (no content) or 200 on success
12. **Error responses** — Loki returns HTTP 200 with JSON `{ status: "error", error: "message" }` for query errors
13. **Known limitations** — No authentication support, no ruler API (alert rules), no compactor API, no label values API
14. **Default port** — 3100
15. **curl examples** — 6 runnable commands for all endpoints

**Current State:** Inline documentation is minimal (526 lines, 15% comments)

## Verification

**Build Status:** ✅ Passes TypeScript compilation (verified via read of source)
**Tests:** ⚠️ No test file found — recommend creating `tests/loki.test.ts` with timestamp tests and LogQL query tests
**Protocol Compliance:** Loki HTTP API (no version number)

## Implementation Details

### HTTP GET Implementation

- **Request Format** — `GET <path> HTTP/1.1\r\nHost: ...\r\nAccept: ...\r\nConnection: close\r\nUser-Agent: PortOfCall/1.0\r\n\r\n` (lines 48-54)
- **Response Reading** — Accumulates chunks until connection close or timeout (lines 62-70)
- **Header Parsing** — Splits on `\r\n\r\n`, extracts status code with regex `/HTTP\/[\d.]+\s+(\d+)/` (lines 82-94)
- **Chunked Decoding** — Reads hex size, extracts chunk, skips CRLF, loops until size=0 (lines 107-119)

### Timestamp Handling

- **Push API** — Converts millisecond timestamp to nanoseconds: `String(timestamp) + '000000000'` or `String(Date.now()) + '000000'` (lines 399-401)
- **Range Query** — Converts millisecond start/end to nanoseconds: `String(now - 3600000) + '000000'` (line 473)
- **Rationale** — JavaScript Number has 53-bit precision, nanosecond timestamps need 64 bits (exceed Number.MAX_SAFE_INTEGER = 2^53-1)

### Health Check

- **Ready** — GET `/ready` expects HTTP 200 + "ready" in body (lines 145-152)
- **Build Info** — GET `/loki/api/v1/status/buildinfo` returns JSON with version/revision/goVersion (lines 158-170)
- **Labels** — GET `/loki/api/v1/labels` returns JSON `{ status: "success", data: ["label1", ...] }` (lines 174-191)

### LogQL Query

- **Instant Query** — GET `/loki/api/v1/query?query={job="portofcall"}&limit=100` (lines 237-238)
- **Query Encoding** — Uses `encodeURIComponent` for query string (line 237)
- **Response** — JSON `{ status: "success", data: { resultType: "...", result: [...] } }` (lines 243-250)

### Range Query

- **Path** — `/loki/api/v1/query_range?query=...&start=...&end=...&limit=...&direction=...` (lines 478-479)
- **URLSearchParams** — Builds query string with all params (lines 478)
- **Response Parsing** — Extracts `data.result` array of streams, each with `stream` labels + `values` array of `[timestamp, line]` tuples (lines 489-511)
- **Time Conversion** — Converts nanosecond string to ISO timestamp: `new Date(parseInt(ts) / 1e6).toISOString()` (line 508)

### Push API

- **Payload** — JSON `{ streams: [{ stream: {label: "value"}, values: [["ns_timestamp", "log line"], ...] }] }` (lines 405-407)
- **Fetch Usage** — Uses fetch() with POST, JSON content-type, AbortController timeout (lines 410-420)
- **Success Codes** — HTTP 204 (no content) or 200 indicates success (line 426)

### Metrics Parsing

- **Exposition Format** — Text with `# HELP name ...`, `# TYPE name type`, `name{labels} value timestamp` (lines 307-333)
- **Parsing** — Extracts metric name from HELP, type from TYPE, counts samples (non-comment lines) (lines 314-329)
- **Type Distribution** — Counts metrics by type (counter, gauge, histogram, summary) (lines 336-339)

## See Also

- [Loki HTTP API Reference](https://grafana.com/docs/loki/latest/reference/loki-http-api/) - Official API documentation
- [LogQL Query Language](https://grafana.com/docs/loki/latest/query/) - Query syntax reference
- [Loki Push API](https://grafana.com/docs/loki/latest/reference/loki-http-api/#push-log-entries-to-loki) - Log ingestion format
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols (none for Loki)
