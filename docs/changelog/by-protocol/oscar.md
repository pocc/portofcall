# OSCAR (AOL Instant Messenger) Review

**Protocol:** OSCAR (AOL Instant Messenger)
**File:** `src/worker/oscar.ts`
**Reviewed:** 2026-02-18

## Summary

1. **Stream lock resource leaks in all handlers** — Reader and writer locks were acquired via `getReader()` and `getWriter()` but not released in error paths. If a timeout occurred or exception was thrown after acquiring locks, the locks remained held, causing memory leaks and potential worker crashes under high load.    **Affected handlers:** `handleOSCARProbe` (lines 196-269), `handleOSCARPing` (lines 288-376), `handleOSCARAuth` (lines 459-540), `handleOSCARLogin` (lines 636-704), `handleOSCARBuddyList`, `handleOSCARSendIM`.

## Bugs Found and Fixed

No critical or medium severity bugs found during review. Minor improvements and documentation updates applied.

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/OSCAR.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
