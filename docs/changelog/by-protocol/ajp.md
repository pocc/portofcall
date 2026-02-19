# AJP Review

**Protocol:** AJP
**File:** `src/worker/ajp.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/AJP.md` was a generic protocol overview with no API endpoint documentation. It described the AJP/1.3 packet structure, message types, method codes, and general features (connection pooling, SSL termination, load balancing), but did not document either of the two actual endpoints, their request/response schemas, or any implementation details. No curl examples, no quirks documented. Replaced with an accurate power-user reference covering both endpoints. Key additions: 1. **Both endpoints documented** — `POST /api/ajp/connect` (CPing/CPong probe) and `POST /api/ajp/request` (Forward Request), with full request/response JSON schemas, field defaults, and success criteria.

## Bugs Found and Fixed

No critical or medium severity bugs found during review. Minor improvements and documentation updates applied.

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/AJP.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
