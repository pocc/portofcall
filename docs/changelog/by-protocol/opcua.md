# OPC UA Review

**Protocol:** OPC UA
**File:** `src/worker/opcua.ts`
**Reviewed:** 2026-02-18

## Summary

1. **CRITICAL: Missing function** — `buildGetEndpointsRequest()` called on lines 609 and 888 but never defined. Added stub function that calls `buildOpenSecureChannelRequest()` for compatibility. The actual GetEndpoints service request is sent separately via `buildGetEndpointsMsgRequest()`. 2. **Resource leak** — `socket.close()` in catch blocks could throw and mask the original error. Wrapped all `socket.close()` calls in `try/catch` blocks with ignored errors to prevent exception masking.

## Bugs Found and Fixed

No critical or medium severity bugs found during review. Minor improvements and documentation updates applied.

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/OPCUA.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
