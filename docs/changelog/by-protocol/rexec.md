# REXEC Review

**Protocol:** REXEC
**File:** `src/worker/rexec.ts`
**Reviewed:** 2026-02-18

## Summary

A general protocol overview with correct RFC flow diagram and handshake description. Endpoint docs were present and mostly accurate but lacked detail on edge cases. Missing: GET password gap, `success: true` with `serverAccepted: false` gotcha, WebSocket vs HTTP comparison (no CF detection in WS, password in URL, raw binary forwarding, no timeout), output collection window behavior (single 2s Promise, not per-chunk), timeout timer cleanup, non-standard server handling, no port/host validation, no method restriction, reader/writer lock race in WebSocket close handler. 1. **Per-endpoint comparison table** — All 3 modes (POST, GET, WebSocket) with differences in password support, CF detection, timeout, output format, stdin, error shape. 2. **GET password gap** — Documented that GET mode doesn't extract `password` from query params; it always defaults to `""`. POST is required for authenticated execution.

## Bugs Found and Fixed

No critical or medium severity bugs found during review. Minor improvements and documentation updates applied.

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/REXEC.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
