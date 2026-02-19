# SMB Review

**Protocol:** SMB
**File:** `src/worker/smb.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/SMB.md` was titled "SMB Protocol Implementation Plan" and contained aspirational pseudocode: an `SMBClient` TypeScript class, `SMBConfig`/`SMBShare`/`FileInfo` interfaces, a React `SMBClient` component with file browser UI, and stub packet builders (`buildNegotiateRequest`, `buildSessionSetupRequest`, `buildTreeConnectRequest`, etc.) with placeholder `return new Uint8Array(32)` bodies — none of which exist. The actual five Worker endpoints were entirely absent. Replaced the planning doc with an accurate endpoint reference. Key additions: 1. **Five-endpoint structure** — documented `GET|POST /api/smb/connect`, `POST /api/smb/negotiate`, `POST /api/smb/session`, `POST /api/smb/tree`, and `POST /api/smb/stat` with exact request/response JSON, field tables, and defaults.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Medium | Changed SessionId handling to 64-bit using BigInt to prevent truncation of high 32 bits |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/SMB.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
