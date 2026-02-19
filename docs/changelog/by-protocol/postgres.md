# PostgreSQL Review

**Protocol:** PostgreSQL Wire Protocol
**File:** `src/worker/postgres.ts`
**Reviewed:** 2026-02-17
**Specification:** [PostgreSQL Frontend/Backend Protocol](https://www.postgresql.org/docs/current/protocol.html)
**Tests:** `tests/postgres.test.ts`

## Summary

PostgreSQL implementation provides 5 endpoints (connect, query, describe, listen, notify) supporting 3 authentication methods (MD5, SCRAM-SHA-256, cleartext). Handles 18 wire protocol message types. Critical bugs fixed include resource leaks (timeout handles not cleared in all 5 endpoints), security vulnerabilities (SQL injection in NOTIFY, missing SCRAM verification), and data corruption (ParameterStatus parsing).

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **RESOURCE LEAK**: Fixed timeout handles not cleared in 5 endpoints (connect, query, describe, listen, notify) — added `clearTimeout()` in finally blocks |
| 2 | Critical | **SECURITY**: Added message length validation (4 bytes to 1GB) to prevent OOM attacks |
| 3 | Critical | **DATA CORRUPTION**: Fixed ParameterStatus parsing to validate NUL terminators exist before slicing (was accessing out-of-bounds on malformed messages) |
| 4 | Critical | **SECURITY**: Replaced SQL string interpolation with dollar-quoted strings in NOTIFY handler to prevent SQL injection |
| 5 | Critical | **RFC VIOLATION**: Added SCRAM-SHA-256 mechanism verification — now checks server advertises SCRAM-SHA-256 before proceeding (was assuming support) |

## Documentation Improvements

**Created:** `docs/protocols/POSTGRESQL.md` (comprehensive power-user reference)

The original doc was an implementation plan with fictional library usage. Replaced with accurate reference including:

1. **All 5 endpoints documented** — `/connect`, `/query`, `/describe`, `/listen`, `/notify` with complete request/response schemas
2. **Auth methods table** — trust (0), cleartext (3), MD5 (5), SCRAM-SHA-256 (10)
3. **SCRAM-SHA-256 implementation details** — step-by-step: nonce generation, PBKDF2-SHA-256, HMAC, client proof calculation
4. **18 wire protocol message types** — complete table with direction, name, and notes
5. **Type OID reference** — 20 common PostgreSQL types with OID numbers
6. **Known limitations** — 15 documented limitations including:
   - All values returned as text strings (no binary format)
   - COPY protocol not handled (queries hang until timeout)
   - Multiple statements in Simple Query return only last result
   - Server signature in SCRAM-SHA-256 computed but discarded (MITM vulnerable)
7. **ErrorResponse field codes** — S, V, C, M, D, H, P documented
8. **SQLSTATE codes** — 10 common error codes (28P01 invalid_password, 42P01 undefined_table, etc.)
9. **LISTEN/NOTIFY limitations** — channel name regex restrictions, 15s timeout
10. **curl examples** — 6 runnable commands including admin queries

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ✅ 17/17 tests passing
**RFC Compliance:** PostgreSQL Frontend/Backend Protocol v3.0

## See Also

- [PostgreSQL Protocol Specification](../protocols/POSTGRESQL.md) - Technical wire format reference
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
- [SCRAM-SHA-256 RFC 7677](https://datatracker.ietf.org/doc/html/rfc7677) - SCRAM-SHA-256 specification
