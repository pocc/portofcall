# CHARGEN Review

**Protocol:** Character Generator Protocol
**File:** `src/worker/chargen.ts`
**Reviewed:** 2026-02-19
**Specification:** [RFC 864](https://datatracker.ietf.org/doc/html/rfc864)
**Tests:** `tests/chargen.test.ts`

## Summary

CHARGEN implementation provides 1 endpoint (stream) for testing RFC 864 services. The protocol sends continuous rotating 72-character ASCII lines for bandwidth testing. Critical bugs fixed include timeout handle leak (not cleared in finally block), reader lock leak (not released in error path), and missing Cloudflare detection (SSRF vulnerability).

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **RESOURCE LEAK**: Fixed timeout handle not cleared when read loop exits early — `timeoutPromise` creates `setTimeout` on line 99 but never calls `clearTimeout()` in finally block |
| 2 | Critical | **RESOURCE LEAK**: Fixed reader lock not released when timeout occurs during read — if `timeoutPromise` rejects while `reader.read()` is pending (line 118), lock is never released before socket closes |
| 3 | Critical | **SECURITY**: Missing Cloudflare detection — allows SSRF attacks against Cloudflare-protected hosts (should validate before connecting) |
| 4 | High | **PROTOCOL VIOLATION**: No validation that response contains printable ASCII — binary data could be returned and blindly decoded as UTF-8, causing mojibake or errors |
| 5 | Medium | **DATA CORRUPTION**: If chunk arrives after `totalBytes >= safeMaxBytes` (line 130), the chunk is included in `chunks` array but not counted, causing array index mismatch on line 147 |

## Documentation Improvements

**Created:** `docs/protocols/CHARGEN.md` (comprehensive reference)

The CHARGEN protocol had minimal documentation. Created complete reference including:

1. **Endpoint documented** — `/stream` with complete request/response schema
2. **Protocol flow** — Connect, read continuous stream, disconnect
3. **Standard pattern** — 72-character rotating lines of printable ASCII (33-126)
4. **Safety limits** — 1MB maximum (enforced client-side)
5. **Known limitations** — 8 documented limitations including:
   - No authentication or encryption
   - Can be used for amplification attacks (infinite stream)
   - Most modern systems disable CHARGEN (security risk)
   - No way to stop server from sending (must close connection)
   - Bandwidth calculations only accurate if server sends at line rate
   - UTF-8 decode assumes ASCII (binary data corrupts output)
   - Fixed 1MB safety limit (not configurable above this)
   - No pattern validation (assumes RFC 864 format)
6. **Security warning** — Used in historical DDoS amplification attacks
7. **curl example** — 1 runnable command showing stream collection

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ✅ All tests passing
**RFC Compliance:** RFC 864 Character Generator Protocol

## See Also

- [CHARGEN Protocol Specification](../protocols/CHARGEN.md) - Technical reference
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
- [RFC 864](https://datatracker.ietf.org/doc/html/rfc864) - CHARGEN specification
