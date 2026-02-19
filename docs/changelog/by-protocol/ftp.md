# FTP Review

**Protocol:** FTP
**File:** `src/worker/ftp.ts`
**Reviewed:** 2026-02-18

## Summary

- `FTPClient` class with passive-mode connect, LIST, STOR, RETR, DELE, MKD, RMD, RNFR/RNTO, SIZE, PWD, QUIT - `parseListingResponse()` parsed Unix-style LIST output for name, size, type, mtime only — discarded permissions, owner, group, link count, symlink targets; no DOS listing support - No FEAT negotiation (couldn't discover server capabilities)

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Medium | Fixed default port from 990 to 21 for explicit FTPS (AUTH TLS); kept 990 for implicit FTPS |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/FTP.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
