# Hazelcast IMDG Review

**Protocol:** Hazelcast IMDG
**File:** `src/worker/hazelcast.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/HAZELCAST.md` was a 4.6 KB stub with generic Hazelcast overview, basic protocol description (6-byte frame header + message_type), default port, common operations (MAP_PUT, MAP_GET, QUEUE_OFFER), auth status codes, and security considerations. No API endpoints, no request/response schemas, no wire protocol byte offsets, no limitations/quirks, no examples. The doc was conceptual rather than actionable. Replaced with comprehensive 70 KB power-user reference. Key additions: 1. **10 API endpoints documented** — probe, map-get, map-set, map-delete, queue-offer, queue-poll, set-add, set-contains, set-remove, topic-publish. Each with full JSON request/response schemas, all field defaults, auth flow, response shapes, error handling.

## Bugs Found and Fixed

No critical or medium severity bugs found during review. Minor improvements and documentation updates applied.

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/HAZELCAST.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
