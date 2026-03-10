# FTP Protocol Review — Pass 7

**Date:** 2026-02-23
**Reviewer:** Claude
**Files:** `src/worker/ftp.ts`, `src/worker/index.ts`, `src/components/FTPClient.tsx`, `tests/ftp.test.ts`

## Summary

Seventh review pass after fixing 3 issues in Pass 6 (missing rmdir endpoint, logs auto-scroll, misleading test). **0 new issues found.** Protocol is clean.

## Areas Verified

- **New `handleFTPRmdir` handler:** method guard (POST/405), param validation, port validation (1-65535), Cloudflare check, SSRF via router-level JSON body guard, command injection prevented via `sanitizeFTPInput`, socket cleanup via try/finally — all confirmed
- **New rmdir UI modal:** `role="dialog" aria-modal="true"`, Escape key dismiss, multi-select checkboxes for `dirsOnly` filter, destructive red button, `aria-hidden` on icons, Cancel resets state — all confirmed
- **Logs auto-scroll:** `logsEndRef` sentinel div inside scroll container, `useEffect` on `[logs]` calls `scrollIntoView({ behavior: 'smooth' })` — confirmed
- **Fixed test:** "should reject GET requests with 405" now asserts `status === 405` and `data.success === false` — confirmed
- **All 12 FTP handlers:** `connect()` inside try/finally — confirmed
- **FTP command injection:** `sanitizeFTPInput()` on all user inputs including new rmdir path — confirmed
- **PASV SSRF:** `isBlockedHost()` on PASV-returned IPs — confirmed
- **Upload SSRF:** explicit `isBlockedHost(host)` in formData handler — confirmed
- **Content-Disposition:** filename sanitized — confirmed
- **Upload/download limits:** 10 MiB — confirmed
- **SITE command allowlist:** CHMOD, CHOWN, UMASK, IDLE, HELP only — confirmed
- **Port validation:** 1-65535 on all 12 handlers — confirmed
- **Cloudflare detection:** all 12 handlers — confirmed
- **UI accessibility:** keyboard nav, ARIA roles, Escape key dismiss, parent nav — confirmed
- **Multi-line FTP response parsing:** RFC 959 compliant (terminates on `NNN ` pattern) — confirmed

## Status

**PASS** — No remaining issues. Protocol review complete.

## Build Status

`npm run build` — **PASS**.
