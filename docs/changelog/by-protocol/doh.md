# DoH (DNS over HTTPS) Review

**Protocol:** DoH (DNS over HTTPS)
**File:** `src/worker/doh.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/DOH.md` was a 61-line generic overview describing the DoH protocol spec (RFC 8484 GET and POST methods, well-known resolver URLs, privacy/censorship bullet points). No endpoints were documented. The GET method was described even though the implementation only supports POST. No request/response schemas, no quirks, no curl examples. Replaced with a complete power-user reference covering: 1. **Single endpoint documented** — `POST /api/doh/query` with full request schema (domain, type, resolver, timeout) and all defaults.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Medium | Added SOA and SRV record type parsing |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/DOH.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
