# SCP (Secure Copy Protocol) Review

**Protocol:** SCP (Secure Copy Protocol)
**File:** `src/worker/scp.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/SCP.md` was a minimal 51-line protocol overview. It described SCP as running over SSH port 22, mentioned the `-r` recursive flag and `-p` timestamp preservation, listed `/api/scp/connect`, `/api/scp/list`, and `/api/scp/get` endpoints without schemas, and included a generic "Security Considerations" section with no implementation-specific details. The wire protocol was documented incorrectly (claimed client sends `\0` first in download mode). No mention of `/api/scp/put` upload endpoint. No quirks or limitations section. Replaced with a comprehensive power-user reference. Key additions: 1. **Corrected wire protocol documentation** — fixed download flow to show server sends initial `\0` ready signal first (not client); added optional `T` timestamp message handling; documented all control bytes (`\x00`, `\x01`, `\x02`) and control messages (`C`, `D`, `T`, `E`) with exact formats and examples.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | Fixed command injection in shell paths |
| 2 | Critical | fixed base64 encoding corruption |
| 3 | Critical | fixed protocol flow (server sends ready first) |
| 4 | Critical | added filename path traversal protection |
| 5 | Critical | added timestamp handling |
| 6 | Critical | fixed file content reading to exact byte count |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/SCP.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
