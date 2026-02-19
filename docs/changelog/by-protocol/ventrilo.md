# Ventrilo Review

**Protocol:** Ventrilo VoIP Protocol (Proprietary)
**File:** `src/worker/ventrilo.ts`
**Reviewed:** 2026-02-19
**Specification:** None (reverse-engineered protocol)
**Tests:** `tests/ventrilo.test.ts`

## Summary

Ventrilo implementation provides 2 endpoints (connect, status) supporting the proprietary TCP-based VoIP server control protocol. Handles status query packets, response parsing (server name, version, user/channel counts), and string extraction from binary responses. Critical bugs fixed include timeout handling (response read loops), null-terminator parsing (string extraction logic), and reader lock cleanup (infinite read loops on closed connections).

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **INFINITE LOOP**: Status endpoint read loop can hang indefinitely — added explicit `setTimeout()` and `reader.cancel()` on timeout |
| 2 | High | **RESOURCE LEAK**: Reader lock not released if read loop breaks early — added proper `reader.releaseLock()` in finally block |
| 3 | Medium | **USER COUNT PARSING**: Hardcoded byte offsets (4,5,6,7) for user/max user counts assume specific protocol version — parser is best-effort for unknown protocol |
| 4 | Low | **STRING EXTRACTION**: Null-terminated string parser doesn't handle consecutive nulls correctly — fixed with empty string check before push |
| 5 | Low | **PROTOCOL DETECTION**: No validation that response is actually Ventrilo — should check for known response patterns |

## Documentation Improvements

**Created:** Reverse-engineering notes and protocol observations

The implementation includes documentation based on community knowledge:

1. **All 2 endpoints documented** — `/connect` (simple TCP handshake), `/status` (server query) with binary packet format notes
2. **Status request format** — Simplified v3.0 request packet (0x01 0x00 0x00 0x00, 4 bytes), varies by server version
3. **Response parsing strategy** — Extract null-terminated ASCII strings, parse version regex (v?\\d+\\.\\d+), heuristic user count extraction (16-bit BE at offsets 4-7)
4. **Protocol variations** — v2.1, v2.2, v2.3, v3.0 formats differ (not publicly documented), best-effort parsing
5. **String extraction algorithm** — Scan for printable ASCII (32-126), extract on null bytes or non-printable, first string = server name
6. **Known limitations** — 8 documented limitations including:
   - Protocol is proprietary and reverse-engineered
   - Status response format varies by server version
   - User/channel counts are heuristic (may be incorrect)
   - No authentication support
   - No channel listing
   - No user enumeration
   - UDP voice protocol not implemented
   - No codec information available

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ✅ Tests present in `tests/ventrilo.test.ts`
**RFC Compliance:** N/A (proprietary protocol)

## See Also

- [Ventrilo Server Setup](http://www.ventrilo.com/) - Official server downloads
- [Ventrilo Protocol Notes](https://github.com/topics/ventrilo) - Community reverse-engineering efforts
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
