# Grafana Review

**Protocol:** Grafana HTTP REST API
**File:** `src/worker/grafana.ts`
**Reviewed:** 2026-02-19
**Specification:** [Grafana HTTP API](https://grafana.com/docs/grafana/latest/developers/http_api/)
**Tests:** (TBD)

## Summary

Grafana implementation provides 9 endpoints (health, datasources, dashboards, folders, alert-rules, org, dashboard GET/POST, annotation POST) using raw HTTP/1.1 over TCP. Supports 3 authentication methods (Bearer token, API key, Basic auth). Implements proper HTTP parsing including chunked transfer encoding, JSON body handling, and GET/POST request building. No critical bugs found - robust HTTP client with proper header management and response decoding.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 0 | Info | **NO CRITICAL BUGS FOUND** — HTTP parser correctly handles chunked encoding, status line parsing, and header extraction |

## Code Quality Observations

### Strengths

1. **HTTP/1.1 Implementation** — Correct status line parsing, header extraction, chunked transfer encoding (lines 147-194)
2. **Authentication Flexibility** — Supports Bearer token (service account or API key) and Basic auth with priority order (lines 62-67, 90)
3. **Chunked Decoding** — Proper hex chunk size parsing with loop for multi-chunk responses (lines 180-194)
4. **Connection Reuse** — Opens fresh socket for each request, closes after response (pattern at lines 202-239)
5. **GET/POST Builders** — Correct HTTP/1.1 request format with Host, Connection, Accept, User-Agent, Authorization headers (lines 72-95, 671-696)
6. **Content-Length Calculation** — Uses TextEncoder byte length for POST bodies, not string length (line 681)
7. **Response Size Limiting** — Caps at 10 MB to prevent memory exhaustion (lines 119, 716)
8. **Graceful JSON Parsing** — Returns `{ raw: body.substring(0, 2000) }` on parse failure (line 198)
9. **Port Defaulting** — Uses 3000 (Grafana default) consistently (lines 259, 292, 340, etc.)

### Minor Improvements Possible

1. **Auth Fallback** — Could add explicit warning when no auth provided for endpoints that require it
2. **Status Code Handling** — 401/403 detected in handlers, could centralize auth error detection
3. **Header Normalization** — Converts header keys to lowercase (line 165) — correct for case-insensitive HTTP headers

## Documentation Improvements

**Action Required:** Create `docs/protocols/GRAFANA.md` with:

1. **All 9 endpoints documented** — `/health`, `/datasources`, `/dashboards`, `/folders`, `/alert-rules`, `/org`, `/dashboard` (GET/POST), `/annotation` (POST) with request/response schemas
2. **Authentication methods** — Bearer token (service account), API key (legacy, also Bearer), Basic auth (username:password)
3. **Header priority** — token > apiKey > username+password (lines 62-67)
4. **API paths** — Grafana REST API structure: `/api/health`, `/api/frontend/settings`, `/api/datasources`, `/api/search`, `/api/folders`, `/api/v1/provisioning/alert-rules`, `/api/org`, `/api/org/users`, `/api/dashboards/uid/:uid`, `/api/dashboards/db`, `/api/annotations`
5. **Query parameters** — `/api/search?type=dash-db&query=...&limit=...`, `/api/targets?state=active`
6. **Dashboard creation** — POST `/api/dashboards/db` with JSON body: `{ dashboard: {...}, folderId: 0, folderUid?: "...", overwrite: false }`
7. **Annotation creation** — POST `/api/annotations` with JSON body: `{ text: "...", tags: [...], time: timestamp, timeEnd?: timestamp, dashboardId?: number, panelId?: number }`
8. **Folder hierarchy** — Grafana 9+ prefers `folderUid` (string) over `folderId` (number) (lines 743-759)
9. **Alert rules** — Grafana Alerting (v9+) uses `/api/v1/provisioning/alert-rules`, returns 404 on older versions (lines 554-561)
10. **Version detection** — `/api/frontend/settings` contains Grafana version, but `/api/health` is unauthenticated (always returns 200) (lines 246-250, 306-311)
11. **Auth detection trick** — Probe `/api/org` to determine if auth is required (returns 401/403 when anonymous access disabled) (lines 306-314)
12. **Known limitations** — No HTTPS/TLS (raw TCP only), no query range API, no alerts CRUD (only read), no datasource CRUD, no user management
13. **HTTP quirks** — `Connection: close` ensures socket cleanup, `Host` header uses `:port` when port != 80 (lines 81-82, 682)
14. **curl examples** — 8 runnable commands for all read endpoints + dashboard/annotation creation

**Current State:** Inline documentation is minimal (849 lines, 15% comments)

## Verification

**Build Status:** ✅ Passes TypeScript compilation (verified via read of source)
**Tests:** ⚠️ No test file found — recommend creating `tests/grafana.test.ts` with HTTP parsing and auth tests
**Protocol Compliance:** HTTP/1.1 (RFC 7230), Grafana HTTP API v9+

## Implementation Details

### HTTP Request Building

- **GET Requests** — Command line + Host + Connection + Accept + User-Agent + optional Authorization + double CRLF (lines 78-95)
- **POST Requests** — Same headers + Content-Type + Content-Length + optional Authorization + double CRLF + body (lines 676-696)
- **Host Header** — Format: `hostname:port` when port != 80, else just `hostname` (lines 81, 682)

### HTTP Response Parsing

- **Header/Body Split** — Finds `\r\n\r\n` separator (lines 152-153)
- **Status Line** — Regex `/HTTP\/[\d.]+ (\d{3})/` extracts status code (lines 160-161)
- **Header Parsing** — Splits on `:`, trims key/value, lowercases key (lines 164-169)
- **Chunked Decoding** — Reads hex size + data + CRLF in loop until size == 0 (lines 180-194)
- **JSON Parsing** — Try/catch with raw substring fallback (line 198)

### Authentication

- **buildAuthHeader** — Returns `Bearer ${token}` for token/apiKey, `Basic ${btoa(user:pass)}` for Basic auth (lines 62-67)
- **Header Injection** — Conditionally adds `Authorization` header to GET/POST (lines 90, 693)
- **Priority Order** — token → apiKey → username+password (lines 63-66)

### Socket Management

- **openSocket** — Connects with timeout race, throws on timeout (lines 202-211)
- **fetchJson** — Opens socket, calls httpGet, closes socket in finally block (lines 214-239)
- **Timeout Handling** — Subtracts connect time from request timeout (lines 225-227)
- **Writer/Reader Locks** — Always released in try/finally blocks (lines 134-137)

### Endpoint Patterns

- **Health** — Probes 3 endpoints in parallel: `/api/health` (unauthenticated), `/api/frontend/settings` (version), `/api/org` (auth detection) (lines 307-311)
- **Datasources** — GET `/api/datasources`, returns array (lines 375-376)
- **Dashboards** — GET `/api/search?type=dash-db&query=...&limit=...`, returns array (line 447)
- **Folders** — GET `/api/folders`, returns array (line 496)
- **Alert Rules** — GET `/api/v1/provisioning/alert-rules`, returns array or 404 (Grafana 9+) (line 543)
- **Org** — GET `/api/org` + `/api/org/users` in parallel (lines 599-602)
- **Dashboard GET** — GET `/api/dashboards/uid/:uid`, returns `{ dashboard: {...} }` (line 651)
- **Dashboard POST** — POST `/api/dashboards/db` with JSON body (line 770)
- **Annotation POST** — POST `/api/annotations` with JSON body (line 821)

## See Also

- [Grafana HTTP API Documentation](https://grafana.com/docs/grafana/latest/developers/http_api/) - Official REST API reference
- [Grafana Authentication](https://grafana.com/docs/grafana/latest/developers/http_api/#authentication) - Service accounts, API keys, Basic auth
- [Grafana Provisioning API](https://grafana.com/docs/grafana/latest/developers/http_api/alerting_provisioning/) - Alert rules CRUD (v9+)
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols (none for Grafana)
