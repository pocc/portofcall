# Sonic (Search Backend) Review

**Protocol:** Sonic (Search Backend)
**File:** `src/worker/sonic.ts`
**Reviewed:** 2026-02-18

## Summary

No documentation existed for Sonic before this review. Created comprehensive power-user reference from scratch. Key sections: 1. **Five endpoint references** — Full request/response schemas for probe, query, push, suggest, and ping with all field defaults, validation rules, and error conditions.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **RESOURCE LEAK**: Fixed timeout handles not cleared in 5 endpoints (probe, query, push, suggest, ping) — replaced `timeoutPromise` with `timeoutHandle` and added `clearTimeout()` in finally blocks |
| 2 | Critical | **DUPLICATE TIMEOUT**: Removed dual racing timeouts in probe/ping — was creating two `setTimeout()` calls per request |
| 3 | Critical | **RESOURCE LEAK**: Fixed reader/writer locks not released in error paths — wrapped all cleanup in try/finally with exception suppression |
| 4 | Critical | **DATA CORRUPTION**: Fixed `readLine()` buffer overflow — was accumulating chunks beyond `maxBytes` before checking terminator |
| 5 | Critical | **PROTOCOL VIOLATION**: Fixed INFO response parsing to strip `RESULT ` prefix before extracting `key(value)` pairs |
| 6 | Critical | **PROTOCOL VIOLATION**: Added QUIT response validation (`ENDED quit` expected) |
| 7 | Critical | **BUG**: Fixed modes detection in probe — now tests all three modes (control, search, ingest) via separate connections and populates `modes` object |
| 8 | Critical | **INPUT VALIDATION**: Added timeout bounds (1-60000ms) to all endpoints |
| 9 | Critical | **INPUT VALIDATION**: Added collection/bucket/objectId validation (alphanumeric/underscore/hyphen only, max 64 chars) |
| 10 | Critical | **SECURITY**: Added Cloudflare detection to query/push/suggest endpoints (was missing) |
| 11 | Critical | **INPUT VALIDATION**: Added port validation (1-65535) to query/push/suggest |
| 12 | Critical | **BUG**: Fixed quote escaping to escape backslashes first (`replace(/\/g, '\\').replace(/"/g, '\"')`) — was allowing `\"` to become `\"` which unescapes to `\` |
| 13 | Critical | **BUG**: Added ERR response handling in query/suggest to throw descriptive error instead of returning empty results |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/SONIC.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
