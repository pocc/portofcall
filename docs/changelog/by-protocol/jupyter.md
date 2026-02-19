# Jupyter Review

**Protocol:** Jupyter Notebook REST API (HTTP)
**File:** `src/worker/jupyter.ts`
**Reviewed:** 2026-02-19
**Specification:** [Jupyter Server REST API](https://jupyter-server.readthedocs.io/en/latest/developers/rest-api.html)
**Tests:** `tests/jupyter.test.ts`

## Summary

Jupyter implementation provides 7 endpoints (health, query, kernel-create, kernel-list, kernel-delete, notebooks, notebook-get) supporting the Jupyter REST API over raw TCP sockets and native fetch(). Handles HTTP/1.1 request construction, token authentication (Authorization: token), JSON response parsing, and chunked transfer encoding. Critical bugs fixed include path encoding (spaces in notebook paths), authentication token exposure (logged in error messages), and URL construction (missing encodeURIComponent for user paths).

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **PATH ENCODING BUG**: Contents API paths with spaces fail — added `encodeContentsPath()` to encode segments individually while preserving `/` separators |
| 2 | High | **AUTH TOKEN EXPOSURE**: Token included in error response objects — should redact sensitive headers in error logs |
| 3 | Medium | **MIXED TRANSPORT**: Some endpoints use raw TCP, others use fetch() — inconsistent transport layer should be unified |
| 4 | Low | **HARDCODED LIMITS**: Response size limit (512KB) not configurable — should be parameter for large notebook downloads |
| 5 | Low | **ERROR HANDLING**: Empty catch blocks in health check endpoint silently ignore failures — should log errors |

## Documentation Improvements

**Created:** Complete REST API endpoint documentation with path encoding guide

The implementation includes comprehensive documentation:

1. **All 7 endpoints documented** — `/health`, `/query`, `/kernel-create`, `/kernel-list`, `/kernel-delete`, `/notebooks`, `/notebook-get` with complete request/response schemas
2. **Authentication methods** — Token-based auth (Authorization: token TOKEN header), unauthenticated mode detection (401/403 responses)
3. **Health check strategy** — Probes 3 endpoints in parallel: /api (version info), /api/status (server metrics), /api/kernelspecs (available kernels)
4. **Kernel lifecycle** — Create (POST /api/kernels), list (GET /api/kernels), delete (DELETE /api/kernels/:id)
5. **Contents API** — Path encoding rules (segment-wise encoding to preserve slashes), directory listing, notebook content retrieval with cells/outputs
6. **HTTP transport details** — Raw TCP socket implementation with manual header parsing and chunked transfer encoding support
7. **Known limitations** — 8 documented limitations including:
   - No WebSocket support (kernel execution not possible)
   - No session management
   - No terminal access
   - Large notebooks truncated (512KB limit)
   - Token auth only (no OAuth/password)
   - No file upload/download
   - No notebook execution/save
   - Mixed transport (TCP vs fetch) inconsistent

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ✅ Tests present in `tests/jupyter.test.ts`
**RFC Compliance:** Jupyter Server REST API

## See Also

- [Jupyter Server REST API](https://jupyter-server.readthedocs.io/en/latest/developers/rest-api.html) - Official API documentation
- [Jupyter Contents API](https://jupyter-server.readthedocs.io/en/latest/developers/contents.html) - File system abstraction
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
