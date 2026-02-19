# WinRM Review

**Protocol:** WinRM
**File:** `src/worker/winrm.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/WINRM.md` was a generic overview document. It covered the protocol's purpose, default ports, authentication methods, and listed only 2 of 3 API endpoints (`/identify` and `/auth`). The entire `/api/winrm/exec` endpoint — the most important one, providing remote command execution — was undocumented. The doc included a reference to `WinRMClient.tsx` and PowerShell setup commands but lacked any wire format details, request/response JSON schemas, quirks, or limitations. Replaced with a comprehensive power-user reference. Key additions: 1. **Full 3-endpoint coverage** — Documented all endpoints including the previously missing `/api/winrm/exec` with its 4-step SOAP flow (Create Shell → Execute Command → Receive Output → Signal + Delete Shell).

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | Added XML entity escaping for username, password, command, and shell ID; replaced string-based chunked TE decoder with byte-level `decodeChunkedBytes()` for correct multi-byte character handling |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/WINRM.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
