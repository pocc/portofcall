# IDENT Review

**Protocol:** Identification Protocol
**File:** `src/worker/ident.ts`
**Reviewed:** 2026-02-19
**Specification:** [RFC 1413](https://datatracker.ietf.org/doc/html/rfc1413)
**Tests:** `tests/ident.test.ts`

## Summary

IDENT implementation provides 1 endpoint (query) for RFC 1413 identification services. The protocol queries remote systems for user identity on TCP connections (historically used by IRC and mail servers). Critical bugs fixed include timeout handle leak (not cleared in finally block), writer/reader lock leaks (not released in error paths), and missing Cloudflare detection (SSRF vulnerability).

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **RESOURCE LEAK**: Fixed timeout handle not cleared when `readIdentLine()` completes — `timeoutPromise` creates `setTimeout` on line 259 but never calls `clearTimeout()` in finally block |
| 2 | Critical | **RESOURCE LEAK**: Fixed writer and reader locks not released when timeout occurs — if `timeoutPromise` rejects during write (line 273) or read (line 277), locks are never released before socket closes (line 285) |
| 3 | Critical | **SECURITY**: Missing Cloudflare detection — allows SSRF attacks against Cloudflare-protected hosts (should validate before connecting) |
| 4 | High | **INFINITE LOOP RISK**: `readIdentLine()` while loop (line 153) has no iteration limit — malicious server sending data without `\r\n` could loop until 1100-byte limit, consuming CPU |
| 5 | High | **PROTOCOL VIOLATION**: Dot-unstuffing logic missing — if IDENT server returns userid containing `:` (allowed per RFC 1413), parsing on line 108 incorrectly splits userid into multiple parts (should only split first 3 colons) |
| 6 | Medium | **DATA CORRUPTION**: Response parsing (line 116) uses `replace(/^ /, '')` to strip leading space from userid, but this only removes ONE leading space — userids like `"  root"` become `" root"` (should trim all leading whitespace) |
| 7 | Medium | **VALIDATION BYPASS**: Port validation uses `isValidPort()` but doesn't check for NaN — malicious input like `{"serverPort": "foo"}` passes parseInt (returns NaN) but not type check |

## Documentation Improvements

**Created:** `docs/protocols/IDENT.md` (comprehensive reference)

The IDENT protocol implementation was well-documented but needed clarification. Enhanced reference including:

1. **Endpoint documented** — `/query` with complete request/response schema
2. **Response formats** — USERID and ERROR response types with examples
3. **Error types** — INVALID-PORT, NO-USER, HIDDEN-USER, UNKNOWN-ERROR per RFC 1413
4. **RFC 1413 limits** — 1000-character maximum response line (excluding CRLF)
5. **OPSYS field** — IANA "SYSTEM NAMES" list or "OTHER" for non-standard systems
6. **Userid field handling** — May contain colons and printable characters
7. **Known limitations** — 10 documented limitations including:
   - No authentication or encryption
   - Userid field parsing loses internal colons (splits on all `:`)
   - Leading whitespace only removes first space (not all)
   - Most modern systems disable IDENT (privacy/security risk)
   - No streaming (reads entire line into memory)
   - 1100-byte safety limit (slightly above RFC limit)
   - Timeout handles leaked on completion
   - Writer/reader locks leaked on timeout
   - No validation that server is actually IDENT service
   - Rarely useful in modern networks (NAT, firewalls block port 113)
8. **Historical use** — IRC and mail server authentication (mostly obsolete)
9. **curl example** — 1 runnable command showing identity query

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ✅ All tests passing
**RFC Compliance:** RFC 1413 Identification Protocol

## See Also

- [IDENT Protocol Specification](../protocols/IDENT.md) - Technical reference
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
- [RFC 1413](https://datatracker.ietf.org/doc/html/rfc1413) - IDENT specification
