# SMTP Review

**Protocol:** SMTP
**File:** `src/worker/smtp.ts`
**Reviewed:** 2026-02-18

## Summary

The original `SMTP.md` covered only one of the three actual implementations, and even that coverage was fictitious: - Described a single `SMTPClient` TypeScript class, `SMTPConfig`/`EmailMessage` interfaces, and a React `SMTPEmailComposer` component — none of which exist in the codebase - Showed a STARTTLS flow with a `// TODO: Upgrade to TLS` comment — STARTTLS is fully implemented in `submission.ts` using `socket.startTls()`, but the doc was never updated

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | Added dot-stuffing in `DATA` payload — lines starting with `.` are escaped to `..` per RFC 5321 §4.5.2 |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/SMTP.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
