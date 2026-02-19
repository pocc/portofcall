# Consul Review

**Protocol:** Consul HTTP API
**File:** `src/worker/consul.ts`
**Reviewed:** 2026-02-19
**Specification:** [Consul HTTP API Documentation](https://www.consul.io/api-docs)
**Tests:** `tests/consul.test.ts`

## Summary

Consul implementation provides 8 endpoints (health, services, KV get/put/list/delete, service health, session create) supporting Consul's HTTP/1.1 RESTful API over raw TCP sockets. Handles HTTP response parsing including chunked transfer encoding, query parameters, and datacenter routing. Critical bugs fixed include resource leaks (timeout handles not cleared), HTTP parsing vulnerabilities (missing Content-Length validation), and injection risks (URL parameter encoding).

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **RESOURCE LEAK**: Timeout promises created but never cleared in all 8 endpoints — added proper timeout handle management |
| 2 | High | **HTTP PARSING**: Missing validation for response body size in `readAll()` — hardcoded 512KB limit prevents OOM attacks |
| 3 | Medium | **INJECTION RISK**: URL parameters in KV operations not properly escaped — added `encodeURIComponent()` for all user-supplied path segments |
| 4 | Low | **ERROR HANDLING**: Empty JSON.parse() catch blocks silently fail — should log parse errors for debugging |
| 5 | Low | **CODE DUPLICATION**: `sendHttpGet()` and `sendConsulHttpRequest()` have overlapping logic — can be unified with method parameter |

## Documentation Improvements

**Created:** Comprehensive inline documentation covering all endpoints

The implementation includes detailed comments for:

1. **All 8 endpoints documented** — `/health`, `/services`, `/kv-get`, `/kv-put`, `/kv-list`, `/kv-delete`, `/service-health`, `/session-create` with complete request/response schemas
2. **HTTP/1.1 implementation details** — Manual TCP socket usage with proper header parsing and chunked transfer encoding support
3. **KV store operations** — Complete CRUD operations with datacenter routing and consistency options
4. **Service discovery features** — Health check integration and service catalog querying
5. **Session management** — Distributed locking support with configurable TTL and behavior
6. **Known limitations** — 6 documented limitations including:
   - HTTP/1.0 only (no keep-alive)
   - 512KB response size limit
   - No streaming support for large responses
   - Basic auth not implemented
   - No TLS support over raw sockets
   - ACL token passed in headers (not encrypted without TLS)

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ✅ Tests present in `tests/consul.test.ts`
**RFC Compliance:** Consul HTTP API v1

## See Also

- [Consul API Documentation](https://www.consul.io/api-docs) - Official API reference
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
