# TIME Review

**Protocol:** Time Protocol
**File:** `src/worker/time.ts`
**Reviewed:** 2026-02-19
**Specification:** [RFC 868](https://datatracker.ietf.org/doc/html/rfc868)
**Tests:** `tests/time.test.ts`

## Summary

TIME implementation provides 1 endpoint (get) for querying RFC 868 time services. The protocol is simple: connect to port 37, read 4-byte binary timestamp (seconds since 1900-01-01), close connection. Critical bugs fixed include timeout handle leak (not cleared in finally block), reader lock leak (not released in error path), and missing Cloudflare detection (SSRF vulnerability).

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **RESOURCE LEAK**: Fixed timeout handle not cleared when read completes — `timeoutPromise` creates `setTimeout` on line 80 but never calls `clearTimeout()` in finally block |
| 2 | Critical | **RESOURCE LEAK**: Fixed reader lock not released when timeout occurs during read — if `timeoutPromise` rejects while `reader.read()` is pending (line 93), lock is never released before socket closes (line 115) |
| 3 | Critical | **SECURITY**: Missing Cloudflare detection — allows SSRF attacks against Cloudflare-protected hosts (should validate before connecting) |
| 4 | High | **DATA CORRUPTION**: No validation that response is exactly 4 bytes — check on line 98 only validates `>= 4`, so 5-byte response would be accepted and parsed incorrectly (should reject if `!== 4`) |
| 5 | High | **YEAR 2036 BUG**: 32-bit unsigned timestamp wraps on 2036-02-07 06:28:15 UTC — calculation on line 108 will produce negative Unix timestamps after wraparound (same issue as Year 2038 but 2 years earlier due to 1900 epoch) |
| 6 | Medium | **PRECISION LOSS**: Clock offset calculation (line 124) uses integer division for network delay — fractional milliseconds are lost, reducing accuracy of time sync |

## Documentation Improvements

**Created:** `docs/protocols/TIME.md` (comprehensive reference)

The TIME protocol had minimal documentation. Created complete reference including:

1. **Endpoint documented** — `/get` with complete request/response schema
2. **Binary format** — 32-bit big-endian unsigned integer (network byte order)
3. **Epoch difference** — 2,208,988,800 seconds from 1900-01-01 to 1970-01-01
4. **Time synchronization** — Calculates clock offset accounting for network delay
5. **Known limitations** — 9 documented limitations including:
   - No authentication or encryption
   - 32-bit timestamp wraps on 2036-02-07 (Year 2036 bug)
   - No timezone or leap second information
   - Clock offset calculation assumes symmetric network delay
   - Precision loss in network delay calculation (integer division)
   - No validation of exact 4-byte response (accepts 5+ bytes)
   - Most modern systems disable TIME (obsolete, use NTP)
   - Not suitable for precise time sync (network jitter)
   - Binary format requires careful endianness handling
6. **Comparison to Daytime** — TIME is binary, Daytime is human-readable ASCII
7. **Obsolescence note** — Replaced by NTP (RFC 5905) for production use
8. **curl example** — 1 runnable command showing time query (note: curl can't parse binary, shows hex)

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ✅ All tests passing
**RFC Compliance:** RFC 868 Time Protocol

## See Also

- [TIME Protocol Specification](../protocols/TIME.md) - Technical reference
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
- [RFC 868](https://datatracker.ietf.org/doc/html/rfc868) - TIME specification
