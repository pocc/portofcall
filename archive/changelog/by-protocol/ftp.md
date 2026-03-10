# FTP Review

**Protocol:** FTP / FTPS
**Files:** `src/worker/ftp.ts`, `src/worker/ftps.ts`, `src/components/FTPClient.tsx`
**Last Reviewed:** 2026-02-23 (11 passes)

## Summary

- `FTPClient` class with passive-mode connect, LIST, MLSD, NLST, STOR, RETR, DELE, MKD, RMD, RNFR/RNTO, SIZE, PWD, FEAT, MDTM, SITE, QUIT
- `parseListingResponse()` handles both Unix-style and DOS-style LIST output with full metadata (permissions, owner, group, links, symlink targets)
- `parseMlsdResponse()` handles RFC 3659 machine-readable listings
- FEAT negotiation (RFC 2389) for server capability discovery
- FTPS (implicit TLS, port 990) with full session management via `FTPSSession` class

## Bugs Found and Fixed

| # | Severity | Description | Date |
|---|---|---|---|
| 1 | Medium | Fixed default port from 990 to 21 for explicit FTPS (AUTH TLS); kept 990 for implicit FTPS | 2026-02-18 |
| 2 | High | `stat()` sent SIZE + MDTM concurrently via `Promise.all` on single control socket — race condition. Fixed: sequential execution | 2026-02-23 |
| 3 | High | Content-Disposition header injection via unsanitized filename in download response. Fixed: strip control chars/quotes | 2026-02-23 |
| 4 | High | All 11 FTP handlers called `client.connect()` outside try/finally — socket leaked on auth failure/timeout. Fixed: moved connect inside try | 2026-02-23 |
| 5 | Medium | FTP upload had no file size limit (OOM risk). Fixed: 10 MiB hard limit | 2026-02-23 |
| 6 | Medium | FTPS download had no file size limit (OOM risk). Fixed: 10 MiB hard limit | 2026-02-23 |
| 7 | Medium | FTPS upload had no file size limit (OOM risk). Fixed: 10 MiB hard limit | 2026-02-23 |
| 8 | Medium | FTPS LIST data read loop had no timeout — could hang indefinitely. Fixed: deadline-based timeout | 2026-02-23 |
| 9 | Medium | FTPS RETR data read loop had no timeout. Fixed: deadline-based timeout | 2026-02-23 |
| 10 | Medium | No parent directory navigation in UI. Fixed: added "Up" button | 2026-02-23 |
| 11 | Low | Path double-slash bug from root (`//dirname`). Fixed: `buildPath()` helper | 2026-02-23 |
| 12 | Low | File browser not keyboard-accessible. Fixed: added roles, tabIndex, keyboard handlers | 2026-02-23 |
| 13 | Low | FTPFile type mismatch — component missed `link`/`other` types. Fixed: expanded union | 2026-02-23 |
| 14 | Low | Modals lacked Escape key handler and ARIA dialog attributes. Fixed: keydown listener + role/aria-modal | 2026-02-23 |
| 15 | Critical | SSRF bypass on FTP upload: `handleFTPUpload` uses `formData()` but router-level SSRF guard only parses JSON. Private IPs in multipart body bypassed `isBlockedHost()`. Fixed: explicit check in handler | 2026-02-23 |
| 16 | Low | PASV port 0 not rejected: octets validated individually (0-255) but calculated port could be 0. Fixed: added `port >= 1` check | 2026-02-23 |
| 17 | Medium | Missing rmdir API endpoint: `FTPClient.rmdir()` existed but no handler, route, or UI. Fixed: added `handleFTPRmdir`, `/api/ftp/rmdir` route, and UI modal | 2026-02-23 |
| 18 | Low | Logs panel didn't auto-scroll to newest entries. Fixed: `logsEndRef` + `scrollIntoView` on log updates | 2026-02-23 |
| 19 | Low | Misleading test "GET request with query parameters" silently passed via early return. Fixed: asserts 405 status | 2026-02-23 |
| 20 | Medium | MLSD fallback mode misreported: when MLSD fails and falls back to LIST, API response still said `mode: 'mlsd'`. Fixed: `list()` returns `actualMode` | 2026-02-23 |
| 21 | Medium | Anonymous FTP login broken (RFC 959): `connect()` only accepted 331 after USER, but 230 (no password needed) is valid for anonymous FTP. Fixed: handle 230 by skipping PASS | 2026-02-23 |
| 22 | Low | Rename modal restricted to files only — directories not renameable from UI despite RNFR/RNTO supporting them. Fixed: show files, dirs, and symlinks | 2026-02-23 |
| 23 | Low | Download/delete modals excluded symlinks — `RETR`/`DELE` work on symlinks but UI filtered them out. Fixed: include symlinks in both modals | 2026-02-23 |
| 24 | Medium | Anonymous FTP broken at handler level: all 12 handlers checked `!password` which rejects empty strings (`!""` is `true`). Bug #21 fix (protocol-level 230 handling) was dead code. Fixed: `password == null` | 2026-02-23 |
| 25 | Low | MLSD `cdir`/`pdir` entries (`.` and `..`) not filtered in `parseMlsdResponse()`. Would produce broken paths if used in UI. Fixed: skip cdir/pdir entries | 2026-02-23 |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/FTP.md)
- [Pass 1 Review Details](../reviews/2026-02-23-ftp-pass1-review.md)
- [Pass 2 Review Details](../reviews/2026-02-23-ftp-pass2-review.md)
- [Pass 3 Review Details](../reviews/2026-02-23-ftp-pass3-review.md)
- [Pass 4 Review Details](../reviews/2026-02-23-ftp-pass4-review.md)
- [Pass 5 Review Details](../reviews/2026-02-23-ftp-pass5-review.md)
- [Pass 6 Review Details](../reviews/2026-02-23-ftp-pass6-review.md)
- [Pass 7 Review Details](../reviews/2026-02-23-ftp-pass7-review.md)
- [Pass 8 Review Details](../reviews/2026-02-23-ftp-pass8-review.md)
- [Pass 9 Review Details](../reviews/2026-02-23-ftp-pass9-review.md)
- [Pass 10 Review Details](../reviews/2026-02-23-ftp-pass10-review.md)
- [Pass 11 Review Details](../reviews/2026-02-23-ftp-pass11-review.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)


## 1B/1C Sweep (2026-02-24)

Pass: 0 findings (1B/1C sweep)
