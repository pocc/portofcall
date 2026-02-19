# NTP Review

**Protocol:** NTP
**File:** `src/worker/ntp.ts`
**Reviewed:** 2026-02-18

## Summary

A 478-line general NTP educational document. Covered protocol theory (packet diagrams, timestamp format, stratum levels, time calculation formulas, security considerations) but only documented 2 of 3 endpoints. The third endpoint (`/api/ntp/poll`) was completely missing. The "Future Enhancements" section listed "Multiple server queries with best-of-N selection" even though `/poll` already implements this. Included fictional test files (`examples/ntp-test.html`) and a deployed URL that doesn't exist. The doc read more like an NTP RFC summary than an API reference. Replaced with an accurate power-user endpoint reference. Key additions: 1. **Third endpoint documented** — `/api/ntp/poll` (multi-sample query with offset/RTT statistics, jitter calculation) was completely missing from the original doc. Full request/response schema, parameter clamping ranges, and partial-failure behavior now documented.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | Added dot-stuffing for article bodies in POST command |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/NTP.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
