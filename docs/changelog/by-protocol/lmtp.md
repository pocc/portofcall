# LMTP (Local Mail Transfer Protocol) Review

**Protocol:** LMTP (Local Mail Transfer Protocol)
**File:** `src/worker/lmtp.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/LMTP.md` was a 133-line basic overview. It described the protocol differences from SMTP (LHLO vs EHLO, per-recipient status after DATA), protocol flow diagram, API endpoints with request/response schemas, and a brief relationship to the email suite table. No commands reference, no advanced features, no security considerations, no debugging tips, no RFC compliance checklist. Replaced with comprehensive power-user documentation (708 lines). Key additions: 1. **Complete commands reference** — LHLO, MAIL FROM, RCPT TO, DATA, RSET, QUIT with syntax, response codes, examples, and critical rules (dot-stuffing, per-recipient status, 503 for no valid recipients).

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | Fixed dot-stuffing regex to handle first line — was using `/
\./g` which misses message bodies starting with `.` per RFC 5321 §4.5.2 |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/LMTP.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
