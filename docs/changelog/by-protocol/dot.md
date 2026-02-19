# DoT (DNS over TLS) Review

**Protocol:** DoT (DNS over TLS)
**File:** `src/worker/dot.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/DOT.md` was a 42-line generic protocol overview. It described the DoT spec (RFC 7858, RFC 8310) with bullet points about TLS requirements (ALPN "dot", SNI, TLS 1.2+), privacy benefits, and well-known servers. No API endpoints, no request/response schemas, no quirks or limitations documented. The doc claimed "Reuse connection for multiple queries" which the implementation does not do. Replaced with an accurate power-user reference. Key additions: 1. **Endpoint reference** — documented `POST /api/dot/query` with full request/response JSON schemas, all field defaults, timeout behavior, and port validation range.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Medium | Added transaction ID verification — response ID checked against query ID |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/DOT.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
