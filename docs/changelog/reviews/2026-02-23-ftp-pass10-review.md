# FTP Protocol Review — Pass 10

**Date:** 2026-02-23
**Reviewer:** Claude (Opus 4.6)
**Files:** `src/worker/ftp.ts`, `src/components/FTPClient.tsx`

## Summary

Tenth review pass — fresh deep review of all code after pass 9 marked clean. **2 new issues found and fixed.**

## Issues Found

### Issue 1 — Anonymous FTP broken at handler level (Medium)

**Bug:** All 12 FTP API handlers validate `!password`, but `!""` is `true` in JavaScript. Anonymous FTP (username `"anonymous"`, password `""`) is rejected at the handler's validation layer with a 400 error before `FTPClient.connect()` is reached.

**Impact:** The anonymous FTP fix from pass 8 (bug #21 — handle 230 after USER) is dead code. Users cannot connect to any anonymous FTP server via the API.

**Fix:** Changed `!password` to `password == null` in all 12 handlers. This rejects only missing/undefined passwords while allowing empty strings. Handlers affected: `handleFTPConnect`, `handleFTPList`, `handleFTPFeat`, `handleFTPStat`, `handleFTPNlst`, `handleFTPSite`, `handleFTPUpload`, `handleFTPDownload`, `handleFTPDelete`, `handleFTPMkdir`, `handleFTPRmdir`, `handleFTPRename`.

### Issue 2 — MLSD cdir/pdir entries not filtered (Low)

**Bug:** `parseMlsdResponse()` includes `.` (type=cdir) and `..` (type=pdir) entries in the listing. RFC 3659 defines these as "current directory" and "parent directory" marker entries. Most FTP clients filter them out.

**Impact:** When calling `/api/ftp/list` with `mlsd=true`, the response includes `.` and `..` entries. If surfaced in the UI, clicking these would construct malformed paths (e.g., `/path/.` or `/path/..`).

**Fix:** Added `continue` guard in `parseMlsdResponse()` to skip entries where `type` is `cdir` or `pdir`.

## Areas Verified (No Issues)

- SSRF guard: Router-level `isBlockedHost` covers JSON-body handlers; upload has explicit check for multipart
- PASV bounce: `enterPassiveMode()` checks `isBlockedHost` on PASV-returned IP
- Command injection: `sanitizeFTPInput()` strips CR/LF from all user inputs
- Content-Disposition: Download filename sanitized (control chars/quotes stripped)
- Timeouts: All data read loops have deadline-based wall-clock timeouts
- Size limits: 10 MiB hard cap on uploads and downloads
- Control response limit: 64 KiB max on `readResponse()`
- Port validation: All handlers validate 1-65535 range; PASV validates octet and computed port ranges
- SITE allowlist: Only CHMOD/CHOWN/UMASK/IDLE/HELP permitted
- Accessibility: Modals have role=dialog/aria-modal, Escape handler, keyboard navigation on file browser
- Symlinks: Correctly included in download/delete/rename modals

## Build Status

`npm run build` — pre-existing TS error in `hl7.ts` (unrelated to FTP). FTP-specific changes are type-safe.
