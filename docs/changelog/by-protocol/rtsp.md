# RTSP Review

**Protocol:** RTSP
**File:** `src/worker/rtsp.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/RTSP.md` was a 35-line stub: an overview, a Resources section with RFC links, and a Notes section with generic protocol facts. Zero endpoint documentation. Replaced the stub with a complete power-user reference. Key findings from reading `src/worker/rtsp.ts`: 1. **Three-endpoint structure** — documented `POST /api/rtsp/options`, `POST /api/rtsp/describe`, and `POST /api/rtsp/session` with exact request/response JSON, field tables, defaults, and behavioral notes.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Medium | Fixed `controlUrl` resolution — relative URLs now properly joined with Content-Base/session URL instead of overwriting |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/RTSP.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
