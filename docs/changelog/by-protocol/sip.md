# SIP / SIPS Review

**Protocol:** SIP / SIPS
**File:** `src/worker/sip.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/SIPS.md` was a planning-style document that: - Listed only 2 of 8 total endpoints (`/api/sips/options` and `/api/sips/register`) - Had a "Future Enhancements" section listing Digest auth and INVITE as not yet implemented — both are fully implemented in both `sip.ts` and `sips.ts`

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | Fixed digest auth URI scheme from `sip:` to `sips:` per RFC 3261 |
| 2 | Critical | cleaned up unused credentials warning |
| 3 | Critical | fixed REGISTER error handling |
| 4 | Critical | **RESOURCE LEAK**: Fixed timeout handles not cleared in 3 endpoints (OPTIONS, REGISTER, Digest Auth) — replaced `timeoutPromise` with `timeoutHandle` and added `clearTimeout()` in finally blocks |
| 5 | Critical | **RESOURCE LEAK**: Fixed reader/writer locks not released in error paths — wrapped all cleanup in try/finally with exception suppression |
| 6 | Critical | **BUG**: Fixed duplicate socket.close() calls (was called in catch block after try block) — moved to finally block only |
| 7 | Critical | **DATA CORRUPTION**: Fixed Content-Length byte counting for multi-byte UTF-8 in response bodies — was using character length instead of byte length for body comparison |
| 8 | Critical | **PROTOCOL VIOLATION**: Added rport parameter to Via headers in all requests for NAT traversal per RFC 3581 |
| 9 | Critical | **RFC VIOLATION**: Added Contact header to OPTIONS requests per RFC 3261 §11.1 recommendations |
| 10 | Critical | **SECURITY**: Added Content-Length validation to reject negative or oversized values (was accepting any parsed integer) |
| 11 | Critical | **INPUT VALIDATION**: Added timeout bounds validation (1000-300000ms) to all endpoints |
| 12 | Critical | **BUG**: Fixed early returns in readSipResponse not clearing timeout handles |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/SIP.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
