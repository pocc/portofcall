# FTP Protocol Review — Pass 6

**Date:** 2026-02-23
**Reviewer:** Claude
**Files:** `src/worker/ftp.ts`, `src/worker/index.ts`, `src/components/FTPClient.tsx`, `tests/ftp.test.ts`

## Summary

Sixth review pass after Pass 5 declared 0 remaining issues. **3 issues found and fixed, 2 documented as design notes.**

## Issues Found and Fixed

### F-1: Missing rmdir API endpoint (Medium — Feature Completeness)

`FTPClient.rmdir()` method existed on the class but had no `handleFTPRmdir` handler function, no route in `index.ts`, and no UI control. Users could create directories via `/api/ftp/mkdir` but had no way to remove them.

**Fix:**
- Added `handleFTPRmdir` handler in `src/worker/ftp.ts` (mirrors `handleFTPMkdir` pattern with full validation, CF check, port check)
- Added route `/api/ftp/rmdir` in `src/worker/index.ts`
- Added "Remove Directory" button in UI commands dropdown (disabled when no directories in listing)
- Added rmdir modal with multi-select checkboxes (directories only) and red "Remove" button
- Added `handleRmdir` function in UI component
- Added `dirsOnly` filter alongside existing `filesOnly`

### F-2: Logs panel doesn't auto-scroll (Low — Usability)

After many FTP operations, users had to manually scroll the log panel to see recent entries. No `scrollIntoView` or scroll management existed.

**Fix:**
- Added `logsEndRef` ref targeting a sentinel `<div>` at the bottom of the logs container
- Added `useEffect` on `[logs]` that calls `scrollIntoView({ behavior: 'smooth' })`

### F-3: Misleading test silently passes (Low — Test Quality)

Test "should support GET request with query parameters" (ftp.test.ts line 96) sent a GET request but the handler only accepts POST (returns 405). The `if (!response.ok) return;` early-return made the test silently pass without asserting anything.

**Fix:** Changed test to "should reject GET requests with 405" — now asserts `response.status === 405` and `data.success === false`.

## Design Notes (Not Fixed — Documented)

### D-1: Anonymous FTP blocked (Low)

The `!password` check in all handlers rejects empty passwords, preventing anonymous FTP access (user `anonymous` with empty password). This is a deliberate security choice — anonymous FTP introduces open relay risk for a public-facing tool.

### D-2: No EPSV for IPv6 (Low)

Only PASV (IPv4 passive mode) is supported. EPSV (RFC 2428) is required for IPv6-only FTP servers. The Cloudflare Workers Sockets API supports IPv6, but FTP data connections via EPSV would need implementation. Low priority — IPv6-only FTP servers are rare.

## Build Status

`npm run build` — **PASS**. All changes compile cleanly.

## Status

**3 issues fixed.** Restarting review loop for Pass 7.
