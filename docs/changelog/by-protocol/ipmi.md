# IPMI Review

**Protocol:** IPMI
**File:** `src/worker/ipmi.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/IPMI.md` was a generic protocol reference with a fictional `IPMIClient` TypeScript class, fictional handler structure with `workers/ipmi.ts` paths (actual path is `src/worker/ipmi.ts`), a complete React `IPMITester` component showing chassis control buttons that don't exist, and ipmitool examples for chassis control which the actual implementation cannot perform. The three actual Worker endpoints were entirely absent. The doc claimed full IPMI v2.0 support with authentication, chassis control, sensor readings, SEL/SDR/FRU access — none of which are implemented. Replaced the planning doc with an accurate power-user reference. Key additions: 1. **Three-endpoint structure** — documented `GET|POST /api/ipmi/connect`, `POST /api/ipmi/auth-caps`, and `POST /api/ipmi/device-id` with exact request/response JSON schemas, all field defaults, timeout behavior, and every possible response shape (success, partial success, connection failed, IPMI error).

## Bugs Found and Fixed

No critical or medium severity bugs found during review. Minor improvements and documentation updates applied.

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/IPMI.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
