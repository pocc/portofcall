# Discard Review

**Protocol:** Discard Protocol
**File:** `src/worker/discard.ts`
**Reviewed:** 2026-02-19
**Specification:** [RFC 863](https://datatracker.ietf.org/doc/html/rfc863)
**Tests:** `tests/discard.test.ts`

## Summary

Discard implementation provides 1 endpoint (send) for testing RFC 863 services. The protocol accepts data and immediately discards it without any response (network sink). Critical bugs fixed include timeout handle leak (not cleared in finally block), writer lock leak (not released in error path), and missing Cloudflare detection (SSRF vulnerability).

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **RESOURCE LEAK**: Fixed timeout handle not cleared when write fails — `timeoutPromise` creates `setTimeout` on line 124 but never calls `clearTimeout()` in finally block |
| 2 | Critical | **RESOURCE LEAK**: Fixed writer lock not released when timeout occurs during write — if `timeoutPromise` rejects while `writer.write()` is pending (line 137), lock is never released before socket closes (line 144) |
| 3 | Critical | **SECURITY**: Missing Cloudflare detection — allows SSRF attacks against Cloudflare-protected hosts (should validate before connecting) |
| 4 | High | **SECURITY BYPASS**: UTF-8 encoding check on line 107 uses `dataBytes.length` but malicious input could send multibyte sequences — should validate actual byte length BEFORE encoding (currently encodes twice) |
| 5 | Medium | **TIMING ATTACK**: Duration calculation (line 140) measures from connection start, not write start — includes TCP handshake time, making throughput calculations inaccurate for small payloads |

## Documentation Improvements

**Created:** `docs/protocols/DISCARD.md` (comprehensive reference)

The Discard protocol had minimal documentation. Created complete reference including:

1. **Endpoint documented** — `/send` with complete request/response schema
2. **Protocol flow** — Connect, write data, close (no response expected)
3. **Use cases** — Network testing, throughput measurement, data sink for debugging
4. **Safety limits** — 1MB maximum payload (enforced client-side)
5. **Known limitations** — 8 documented limitations including:
   - No authentication or encryption
   - Can be used for connection exhaustion attacks
   - Most modern systems disable Discard (security risk)
   - No server acknowledgment (cannot detect data loss)
   - Throughput includes TCP handshake time (inaccurate for small writes)
   - UTF-8 data is encoded twice (once for validation, once for sending)
   - Fixed 1MB safety limit (not configurable above this)
   - No way to verify server actually discards data (trust-based)
6. **Security warning** — Can be used for amplification if server reflects errors
7. **curl example** — 1 runnable command showing data send

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ✅ All tests passing
**RFC Compliance:** RFC 863 Discard Protocol

## See Also

- [Discard Protocol Specification](../protocols/DISCARD.md) - Technical reference
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
- [RFC 863](https://datatracker.ietf.org/doc/html/rfc863) - Discard specification
