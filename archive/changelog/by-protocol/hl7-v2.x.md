# HL7 v2.x Review

**Protocol:** HL7 v2.x
**File:** `src/worker/hl7.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/HL7.md` was titled "HL7 Protocol Implementation Plan" and contained a fictional `HL7Client` TypeScript class at a nonexistent path (`src/worker/protocols/hl7/client.ts`) with `connect()`, `sendMessage()`, `sendADT_A01()`, `sendORU_R01()`, `parseMessage()`, `wrapMLLP()`, `receiveMLLP()` methods, `HL7Config`/`HL7Segment`/`HL7Message` interfaces, a `generateACK()` function, and a React `HL7Client` component with `sendADT` and `sendORU` handlers calling fictional routes `/api/hl7/send-adt` and `/api/hl7/send-oru` — none of which exist. The four actual Worker endpoints were entirely absent. Replaced the planning doc with an accurate endpoint reference. Key additions: 1. **Four-endpoint structure** — documented `POST /api/hl7/connect`, `POST /api/hl7/send`, `POST /api/hl7/query`, and `POST /api/hl7/adt-a08` with exact request/response JSON, field tables, and defaults.

## Bugs Found and Fixed

No critical or medium severity bugs found during review. Minor improvements and documentation updates applied.

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/HL7-V2.X.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
