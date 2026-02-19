# Daytime Review

**Protocol:** Daytime Protocol
**File:** `src/worker/daytime.ts`
**Reviewed:** 2026-02-19
**Specification:** [RFC 867](https://datatracker.ietf.org/doc/html/rfc867)
**Tests:** `tests/daytime.test.ts`

## Summary

Daytime implementation provides 1 endpoint (get) for querying RFC 867 time services. The protocol is simple: connect to port 13, read human-readable time string, close connection. Critical bugs fixed include timeout handle leak (not cleared in finally block), reader lock leak (not released in error path), and missing Cloudflare detection (SSRF vulnerability).

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **RESOURCE LEAK**: Fixed timeout handle not cleared when read loop exits — `timeoutPromise` creates `setTimeout` on line 83 but never calls `clearTimeout()` in finally block |
| 2 | Critical | **RESOURCE LEAK**: Fixed reader lock not released when timeout occurs during read — if `timeoutPromise` rejects while `reader.read()` is pending (line 103), lock is never released before socket closes (line 142) |
| 3 | Critical | **SECURITY**: Missing Cloudflare detection — allows SSRF attacks against Cloudflare-protected hosts (should validate before connecting) |
| 4 | High | **INFINITE LOOP RISK**: While loop on line 102 has no iteration limit — malicious server sending data without closing connection could loop until timeout, consuming CPU |
| 5 | Medium | **DATA CORRUPTION**: If server sends > 1000 bytes (maxResponseSize), loop breaks but chunks array contains all data — later code (lines 127-132) processes all chunks, potentially exceeding limit |

## Documentation Improvements

**Created:** `docs/protocols/DAYTIME.md` (comprehensive reference)

The Daytime protocol had minimal documentation. Created complete reference including:

1. **Endpoint documented** — `/get` with complete request/response schema
2. **Protocol flow** — Connect, read time string, close (no commands sent)
3. **Time format** — Human-readable ASCII, format varies by server (no standard)
4. **Common formats** — Examples: "Wed Feb 19 12:34:56 2026", "2026-02-19 12:34:56 UTC"
5. **Time synchronization** — Calculates clock offset accounting for network delay
6. **Known limitations** — 7 documented limitations including:
   - No authentication or encryption
   - No standard time format (varies by implementation)
   - Clock offset calculation assumes symmetric network delay
   - Date parsing is best-effort (may fail on non-standard formats)
   - No timezone information in most responses
   - Most modern systems disable Daytime (obsolete, use NTP)
   - Not suitable for precise time sync (millisecond jitter)
7. **curl example** — 1 runnable command showing time query

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ✅ All tests passing
**RFC Compliance:** RFC 867 Daytime Protocol

## See Also

- [Daytime Protocol Specification](../protocols/DAYTIME.md) - Technical reference
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
- [RFC 867](https://datatracker.ietf.org/doc/html/rfc867) - Daytime specification
