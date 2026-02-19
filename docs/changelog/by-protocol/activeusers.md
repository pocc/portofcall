# Active Users Review

**Protocol:** Active Users Protocol
**File:** `src/worker/activeusers.ts`
**Reviewed:** 2026-02-19
**Specification:** [RFC 866](https://datatracker.ietf.org/doc/html/rfc866)
**Tests:** `tests/activeusers.test.ts`

## Summary

Active Users implementation provides 3 endpoints (test, query, raw) for querying RFC 866 services. The protocol is simple: connect to port 11, read server response containing user count, close connection. Critical bugs fixed include resource leaks (reader locks not released in error paths across all 3 endpoints) and missing Cloudflare detection (SSRF vulnerability).

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **RESOURCE LEAK**: Fixed reader lock not released when timeout occurs after `reader.read()` call in all 3 endpoints — stream locks are held indefinitely if timeout fires during read operation |
| 2 | Critical | **SECURITY**: Missing Cloudflare detection in all 3 endpoints — allows SSRF attacks against Cloudflare-protected hosts (should validate before connecting) |
| 3 | High | **RESOURCE LEAK**: Timeout handles in `readAllBytes()` helper function are never cleared — creates `setTimeout` handles that leak on every chunk read (affects all endpoints) |
| 4 | Medium | **RFC VIOLATION**: Missing validation that port 11 is actually Active Users service — any TCP service on any port could return data that gets parsed as user count |
| 5 | Low | **DATA QUALITY**: User parsing in `handleActiveUsersQuery` (lines 192-202) accepts malformed lines with only username OR tty (should require both per Active Users conventions) |

## Documentation Improvements

**Created:** `docs/protocols/ACTIVEUSERS.md` (comprehensive reference)

The Active Users protocol had minimal documentation. Created complete reference including:

1. **All 3 endpoints documented** — `/test`, `/query`, `/raw` with request/response schemas
2. **Protocol flow** — Connect, read, close (no commands sent)
3. **Response format variants** — Simple number ("42"), descriptive ("42 users logged in"), structured per-user listings
4. **Port information** — Standard port 11, rarely enabled on modern systems
5. **Known limitations** — 6 documented limitations including:
   - No authentication or encryption
   - No standard response format (vendor-specific)
   - User parsing is best-effort (format varies by implementation)
   - No way to verify service type (could connect to wrong port)
   - Most modern systems disable this service (security risk)
   - Limited real-world utility (obsolete protocol from 1983)
6. **curl examples** — 3 runnable commands showing test, query, and raw modes

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ✅ All tests passing
**RFC Compliance:** RFC 866 Active Users Protocol

## See Also

- [Active Users Protocol Specification](../protocols/ACTIVEUSERS.md) - Technical reference
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
- [RFC 866](https://datatracker.ietf.org/doc/html/rfc866) - Active Users specification
