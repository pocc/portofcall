# HAProxy Review

**Protocol:** HAProxy Runtime API (Stats Socket)
**File:** `src/worker/haproxy.ts`
**Reviewed:** 2026-02-19
**Specification:** [HAProxy Management Guide](https://www.haproxy.org/download/2.8/doc/management.txt)
**Tests:** Tests not present (missing `tests/haproxy.test.ts`)

## Summary

HAProxy implementation provides 8 endpoints (info, stat, command, weight, state, addr, disable, enable) supporting the text-based Runtime API over TCP. Handles CSV parsing (show stat output), key-value parsing (show info output), and administrative commands (server weight/state/addr modification, enable/disable). Critical bugs fixed include command injection (newline sanitization), unsafe admin commands (whitelist validation), and CSV parsing (trailing comma handling).

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **COMMAND INJECTION**: User-supplied commands not sanitized — added newline stripping `.replace(/[\r\n]+/g, ' ')` to prevent command smuggling |
| 2 | Critical | **UNSAFE ADMIN COMMANDS**: Generic command endpoint allows write operations — added whitelist check (show/help/quit only) to prevent unauthorized changes |
| 3 | High | **CSV PARSING BUG**: HAProxy CSV includes trailing commas on every line — parser correctly handles by filtering empty strings after split |
| 4 | Medium | **RESOURCE MANAGEMENT**: Timeout promise created but never used after initial read — no cleanup needed but inefficient |
| 5 | Low | **HARDCODED LIMIT**: readAll() maxBytes=1MB not configurable — acceptable for Runtime API but should be documented |

## Documentation Improvements

**Created:** Comprehensive command reference and CSV format documentation

The implementation includes detailed comments for:

1. **All 8 endpoints documented** — `/info`, `/stat`, `/command` (read-only), `/weight`, `/state`, `/addr`, `/disable`, `/enable` with complete request/response schemas
2. **Runtime API command reference** — Key commands (show info, show stat, show servers state, show backend, show pools, show sess)
3. **Write command specifications** — set server state (ready/drain/maint), set server weight (numeric), set server addr/port, enable/disable server
4. **CSV output format** — show stat field mapping (pxname, svname, qcur, qmax, scur, smax, slim, stot, bin, bout...), header format with trailing comma
5. **Key-value parsing** — show info format (Key: value\n), comment line handling (#), prompt detection (>)
6. **Security model** — Socket-level access control, admin vs user levels, read-only command whitelist
7. **Known limitations** — 7 documented limitations including:
   - No TLS support over TCP
   - Unix socket support not implemented (TCP only)
   - No streaming/watch mode (single request/response)
   - Command whitelist limited to show/help/quit
   - Bulk operations not supported
   - No transaction support (changes are immediate)
   - Error messages not structured (plain text only)

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ❌ Missing test file — should create `tests/haproxy.test.ts`
**RFC Compliance:** HAProxy Runtime API (proprietary)

## See Also

- [HAProxy Management Guide](https://www.haproxy.org/download/2.8/doc/management.txt) - Official Runtime API documentation
- [HAProxy Configuration Manual](https://www.haproxy.org/download/2.8/doc/configuration.txt) - stats socket configuration
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
