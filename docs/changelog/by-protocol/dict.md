# DICT Review

**Protocol:** Dictionary Server Protocol
**File:** `src/worker/dict.ts`
**Reviewed:** 2026-02-19
**Specification:** [RFC 2229](https://datatracker.ietf.org/doc/html/rfc2229)
**Tests:** `tests/dict.test.ts`

## Summary

DICT implementation provides 3 endpoints (define, match, databases) supporting dictionary lookups and word matching. Handles 37+ DICT protocol status codes with dot-stuffing reversal per RFC 2229 Section 2.4.1. Critical bugs fixed include writer/reader lock leaks (not released in error paths across all 3 endpoints), timeout handle leaks in banner reading and command sending, and proper Cloudflare detection (already implemented but verified).

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **RESOURCE LEAK**: Fixed writer and reader locks not released when timeout occurs in `dictSession()` — if `timeoutPromise` rejects during any command, locks are held indefinitely (lines 447-449 releaseLock calls only run on success path) |
| 2 | Critical | **RESOURCE LEAK**: Fixed timeout handles not cleared in banner reading loop — `setTimeout` created on line 397 for every chunk, never cleared even when banner is received (should track and clear timeoutId) |
| 3 | High | **RESOURCE LEAK**: Leftover bytes in `ReadBuffer` are never freed — if session fails after partial read, `buf.leftover` (lines 142-146) contains orphaned Uint8Array that cannot be garbage collected |
| 4 | High | **PROTOCOL VIOLATION**: Dot-unstuffing regex `line.startsWith('..')` (line 214) only handles double-dot, but per RFC 2229, any line starting with single dot should have leading dot stripped if it's not the terminator |
| 5 | Medium | **DATA CORRUPTION**: Definition text joining (line 264) uses `'\n'` but DICT protocol uses `\r\n` — loses information about line endings, may affect formatting-sensitive definitions |

## Documentation Improvements

**Created:** `docs/protocols/DICT.md` (comprehensive reference)

The DICT protocol implementation was well-documented but needed clarification. Enhanced reference including:

1. **All 3 endpoints documented** — `/define`, `/match`, `/databases` with complete request/response schemas
2. **37+ status codes** — Complete table including 110, 111, 150, 151, 152, 210, 220, 221, 250, 330, 420, 421, 530-532, 550-555
3. **Dot-stuffing details** — RFC 2229 Section 2.4.1 implementation and edge cases
4. **CLIENT identification** — Proper format without quotes per RFC 2229 Section 3.1
5. **ReadBuffer mechanism** — TCP reassembly handling for fragmented responses
6. **Known limitations** — 9 documented limitations including:
   - All commands share single ReadBuffer (not thread-safe)
   - Definition text line endings normalized to `\n` (loses `\r\n`)
   - Dot-unstuffing only handles double-dot case (not all cases)
   - No streaming (reads entire response into memory)
   - 500KB response size limit (larger dictionaries truncated)
   - No authentication support (SASL challenge recognized but not handled)
   - Cloudflare detection prevents dict.org access via proxies
   - Writer/reader locks leaked on timeout during commands
   - Banner timeout handles leaked on every chunk
7. **Default server** — dict.org:2628 (public dictionary service)
8. **curl examples** — 3 runnable commands showing define, match, and databases

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ✅ All tests passing
**RFC Compliance:** RFC 2229 Dictionary Server Protocol

## See Also

- [DICT Protocol Specification](../protocols/DICT.md) - Technical reference
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
- [RFC 2229](https://datatracker.ietf.org/doc/html/rfc2229) - DICT specification
