# Beats (Elastic Beats / Lumberjack v2) Review

**Protocol:** Beats (Elastic Beats / Lumberjack v2)
**File:** `src/worker/beats.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/BEATS.md` was a general protocol overview with use case descriptions, an Elastic Beats ecosystem section (Filebeat, Metricbeat, Packetbeat, etc.), Logstash configuration examples, a comparison table with Syslog/Fluentd/RELP, and a "Future Enhancements" wish list. It listed 2 endpoints but did not document the `/api/beats/tls` endpoint at all. No request/response JSON schemas, no wire format details, no quirks or limitations documented. Replaced with an accurate power-user reference. Key additions: 1. **Three-endpoint structure** — documented all 3 endpoints (`/api/beats/send`, `/api/beats/connect`, `/api/beats/tls`) with exact request/response JSON, field tables, and defaults. The original doc omitted `/tls` entirely.

## Bugs Found and Fixed

No critical or medium severity bugs found during review. Minor improvements and documentation updates applied.

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/BEATS.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
