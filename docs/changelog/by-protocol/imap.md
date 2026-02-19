# IMAP Review

**Protocol:** IMAP
**File:** `src/worker/imap.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/IMAP.md` was titled "IMAP Protocol Implementation Plan" and contained aspirational pseudocode: a full `IMAPClient` TypeScript class, `IMAPConfig`/`IMAPMailbox`/`IMAPMessage` interfaces, and a React `IMAPClient` component with sidebar folder tree and message viewer — none of which exist in the codebase. The four actual Worker endpoints were entirely absent. The doc ended with a "Next Steps" list. Replaced the planning doc with an accurate endpoint reference. Key additions: 1. **Four-endpoint structure** — documented `GET|POST /api/imap/connect`, `POST /api/imap/list`, `POST /api/imap/select`, and `GET /api/imap/session` (WebSocket) with exact request/response JSON, field tables, and defaults.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Medium | Fixed LIST response parser to handle NIL delimiter, unquoted mailbox names, and escaped characters; fixed line splitting to use `\r\n` |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/IMAP.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
