# FTP Protocol Review — Pass 5

**Date:** 2026-02-23
**Reviewer:** Claude
**Files:** `src/worker/ftp.ts`, `src/components/FTPClient.tsx`

## Summary

Fifth and final review pass after fixing 2 issues in Pass 4 (SSRF bypass + PASV port validation). **0 new issues found.** Protocol is clean.

## Areas Re-verified

- **SSRF on upload endpoint:** `isBlockedHost(host)` now called explicitly in `handleFTPUpload` after extracting host from formData — confirmed
- **PASV port validation:** `port >= 1 && port <= 65535` check added after `p1*256+p2` calculation — confirmed
- **All 11 FTP handlers:** `connect()` inside try/finally — confirmed (grep verified)
- **FTP command injection:** `sanitizeFTPInput()` on all user inputs — confirmed
- **PASV SSRF:** `isBlockedHost()` on PASV-returned IPs — confirmed
- **Content-Disposition:** filename sanitized for control chars/quotes/backslashes — confirmed
- **Upload/download limits:** 10 MiB on both endpoints — confirmed
- **SITE command allowlist:** CHMOD, CHOWN, UMASK, IDLE, HELP only — confirmed
- **Port validation:** 1-65535 on all handlers — confirmed
- **Cloudflare detection:** all handlers check `checkIfCloudflare()` — confirmed
- **UI accessibility:** keyboard nav, ARIA roles, Escape key dismiss, parent nav — confirmed
- **Multi-line FTP response parsing:** RFC 959 compliant — confirmed
- **formData body consumption:** router-level `parseGuardBody` uses `.clone()`, so original body remains readable for upload handler — confirmed
- **No other handlers use formData:** grep verified only `ftp.ts:1287` — confirmed

## Status

**PASS** — No remaining issues. Protocol review complete.

## Build Status

`npm run build` — pre-existing error in `ssh2-impl.ts` (unrelated). FTP changes compile cleanly.
