# NNTP Review

**Protocol:** NNTP
**File:** `src/worker/nntp.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/NNTP.md` was a planning artifact titled "NNTP Protocol Implementation Plan." It contained a fictional `NNTPClient` TypeScript class (with `connect()`, `authenticate()`, `capabilities()`, `listNewsgroups()`, `selectGroup()`, `listArticles()`, `getArticle()`, `getHeaders()`, `getBody()`, `post()`, `next()`, `last()` methods), a React `NNTPClient` component with group browser and article viewer, and a stub `readMultilineResponse()` that buffered until `\r\n.\r\n` using `readline`-style string scan — none of which exists. The actual six HTTP endpoints, their request/response schemas, and all implementation quirks were absent. Replaced the planning doc with an accurate power-user reference. Key additions: 1. **Six-endpoint table** — documented `POST /connect`, `/group`, `/article`, `/list`, `/post`, `/auth` with complete request field tables, defaults, protocol sequences, and JSON response schemas.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | Added dot-stuffing for article bodies in POST command |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/NNTP.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
