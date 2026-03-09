# FTP Protocol Review — Pass 13

**Date:** 2026-02-23
**Reviewer:** Claude (Opus 4.6)
**Files:** `src/worker/ftp.ts`, `src/components/FTPClient.tsx`

## Summary

Thirteenth review pass verifying the 4 fixes from Pass 12. **0 new issues found.** Protocol is clean.

## Fixes Verified

- **handleFTPList password validation:** `body.password` is now used directly (no `|| ''`), so `undefined` is preserved and caught by `password == null`. TypeScript narrows correctly after the early return. Consistent with all other 11 handlers.
- **Download batch loading state:** `handleDownloadFiles` now owns `setLoading(true/false)` around the loop. Per-file `handleDownloadSingleFile` has no loading management. Download button disables on `loading || selectedFiles.length === 0`. Shows "Downloading..." during operation.
- **Modal Enter key:** mkdir input has `onKeyDown` for Enter (guarded by `dirName`), rename input has `onKeyDown` for Enter (guarded by `selectedFile && newName && newName !== selectedFile`). Both have `autoFocus`.
- **Connection form Enter key:** Password field has `onKeyDown` for Enter (guarded by `!connected && !loading && host && username`).

## Areas Re-verified

- All 12 FTP handlers: password validation consistent (`password == null` after direct destructuring or assignment without `|| ''`)
- SSRF: Router-level + per-handler Cloudflare checks + PASV bounce guard + explicit upload multipart guard
- Command injection: `sanitizeFTPInput()` strips CR/LF
- Content-Disposition: filename sanitized
- Timeouts: deadline-based wall-clock timeouts on all data loops
- Size limits: 10 MiB upload/download
- Control response: 64 KiB max
- SITE: allowlisted to CHMOD/CHOWN/UMASK/IDLE/HELP
- Multi-line FTP response parsing: correct per RFC 959
- MLSD cdir/pdir filter: in place
- Accessibility: role=dialog, aria-modal, Escape, keyboard nav, autoFocus on modal inputs
- Resource cleanup: reader/writer released in finally blocks, socket closed on all paths

## Status

**PASS** — No remaining issues. Protocol review complete.

## Build Status

`npm run build` — pre-existing TS errors in `afp.ts` (unrelated to FTP). FTP changes are type-safe (verified via `tsc --noEmit | grep ftp` — zero errors).
