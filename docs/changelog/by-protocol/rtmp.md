# RTMP Review

**Protocol:** RTMP
**File:** `src/worker/rtmp.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/RTMP.md` was a pre-implementation planning document titled "RTMP Protocol Implementation Plan". It contained a fictional `RTMPClient` class at a nonexistent path (`src/worker/protocols/rtmp/client.ts`), a fictional `RTMPClient.tsx` React component with media capture and streaming UI, generic protocol spec information (handshake format, chunk types, message types, codec tables), references to OBS Studio and nginx-rtmp for testing, and RTMPS/TLS notes for features not implemented. The three actual API endpoints were not documented. A concurrent agent replaced the planning doc with an accurate endpoint reference before this review started. This review then added the following missing sections and detail: 1. **File location metadata** — Added exact line numbers for routes (index.ts lines 1154–1165), source file line count (922), and test file reference.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Medium | Fixed AMF3 command message parsing (skip leading 0x00 byte); added AMF0 Strict Array, Long String, and Undefined type handlers |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/RTMP.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
