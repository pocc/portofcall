# FTP Protocol Review — Pass 12

**Date:** 2026-02-23
**Reviewer:** Claude (Opus 4.6)
**Files:** `src/worker/ftp.ts`, `src/components/FTPClient.tsx`

## Summary

Twelfth review pass — fresh deep review after pass 11 marked clean. **4 issues found and fixed.**

## Issues Found

### Issue 1 — handleFTPList password validation bypass (Low)

**Bug:** `handleFTPList` had `const password = body.password || '';` which converts `undefined` to `''`. The subsequent `password == null` check evaluates `'' == null` → `false`, so missing passwords silently pass validation as empty strings. All other 11 FTP handlers use direct destructuring, correctly preserving `undefined` for the null check.

**Impact:** Calling `/api/ftp/list` without a password field would not return a 400 error but instead attempt FTP login with an empty password (likely failing at the server with "Authentication failed"). Inconsistent error messaging vs. all other FTP endpoints.

**Fix:** Changed `const password = body.password || '';` to `const password = body.password;`. TypeScript narrows `password` to `string` after the early-return guard, so `FTPClient` still receives a `string`.

### Issue 2 — Download modal double-click race condition (Low)

**Bug:** `handleDownloadFiles` delegated to `handleDownloadFile` per file, which managed its own `setLoading(true/false)`. Between sequential downloads, `loading` flickered `true→false→true`. The download modal button was only disabled on `selectedFiles.length === 0`, not on `loading`, allowing users to click "Download" again during the brief false window, starting a duplicate batch.

**Impact:** Double-clicking during multi-file downloads could trigger duplicate downloads.

**Fix:** Moved loading state management to the batch-level `handleDownloadFiles` (single `setLoading(true)` before loop, `setLoading(false)` after). Renamed per-file function to `handleDownloadSingleFile` without loading management. Added `loading` to the download button's disabled condition. Button now shows "Downloading..." during the operation.

### Issue 3 — Modal inputs don't submit on Enter (Low — Usability)

**Bug:** The "Create Directory" and "Rename" modals had bare `<input>` fields without `onKeyDown` handlers. Power users pressing Enter after typing a directory name or new filename had to reach for the mouse to click the action button.

**Fix:** Added `onKeyDown` handlers to both inputs: Enter triggers `handleMkdir()` / `handleRename()` (with the same validation guards as the button). Added `autoFocus` to both inputs so the cursor is ready on modal open.

### Issue 4 — Connection form doesn't submit on Enter (Low — Usability)

**Bug:** The connection form (host, port, username, password fields) had no Enter-key handler. Users filling in credentials had to click "Connect" manually.

**Fix:** Added `onKeyDown` to the password field: Enter triggers `handleConnect()` (guarded by `!connected && !loading && host && username`). Password field is the natural last field before submission.

## Areas Re-verified (No Issues)

- SSRF: Router-level `isBlockedHost` covers JSON-body handlers; upload has explicit check for multipart; PASV bounce guard present
- Command injection: `sanitizeFTPInput()` strips CR/LF on all user inputs
- Content-Disposition: Download filename sanitized (control chars/quotes stripped)
- Timeouts: All data read loops have deadline-based wall-clock timeouts
- Size limits: 10 MiB on uploads and downloads
- Control response limit: 64 KiB max
- Multi-line response parsing: Correct per RFC 959 (checks `lastLine[3] === ' '`)
- SITE allowlist: Only CHMOD/CHOWN/UMASK/IDLE/HELP
- MLSD cdir/pdir filter: Correctly in place (pass 10 fix verified)
- Anonymous FTP: `password == null` check in all 12 handlers (pass 10 fix verified)
- Accessibility: Modals have role=dialog/aria-modal, Escape handler, keyboard navigation

## Build Status

`npm run build` — pre-existing TS errors in `afp.ts` (unrelated to FTP). FTP changes are type-safe (verified via `tsc --noEmit | grep ftp` — zero FTP errors).
