# FTP Protocol Review — Pass 4

**Date:** 2026-02-23
**Reviewer:** Claude
**Files:** `src/worker/ftp.ts`

## Summary

Fourth review pass after 3 previous passes (13 fixes total). Found 2 additional issues — both fixed.

## Bugs Found and Fixed

| # | Severity | Category | Description | File |
|---|----------|----------|-------------|------|
| 1 | Critical | Security (SSRF) | `handleFTPUpload` is the only handler using `formData()` instead of JSON. The router-level SSRF guard (`parseGuardBody`) only parses JSON — it silently returns `null` for multipart bodies. This means `POST /api/ftp/upload` with `host=127.0.0.1` in multipart form data completely bypasses the `isBlockedHost()` check. The handler's `checkIfCloudflare()` only blocks Cloudflare-proxied IPs, not private/internal IPs. Fixed: added explicit `isBlockedHost(host)` check in the upload handler after extracting the host from formData. | `ftp.ts:1336` |
| 2 | Low | Bug | `enterPassiveMode()` validated PASV port octets individually (0-255) but not the resulting calculated port (`p1*256+p2`). A server returning `(1,2,3,4,0,0)` would produce port 0, which is not a valid connection target. Fixed: added `port >= 1 && port <= 65535` check after calculation. | `ftp.ts:348` |

## Areas Re-verified (No Issues)

- All 11 FTP handlers: `connect()` inside try/finally — confirmed
- FTP command injection: `sanitizeFTPInput()` on all user inputs — confirmed
- PASV SSRF: `isBlockedHost()` on PASV-returned IPs — confirmed
- Content-Disposition sanitization — confirmed
- Upload/download 10 MiB limits — confirmed
- SITE command allowlist — confirmed
- Port validation on all handlers — confirmed
- UI: keyboard navigation, ARIA, Escape key — confirmed
- Multi-line FTP response parsing — confirmed
- No other handlers use `formData()` — confirmed (grep verified: only `ftp.ts:1287`)

## Build Status

`npm run build` — pre-existing error in `ssh2-impl.ts` (unrelated). FTP changes compile cleanly.
