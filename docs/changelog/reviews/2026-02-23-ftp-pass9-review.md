# FTP Protocol Review — Pass 9

**Date:** 2026-02-23
**Reviewer:** Claude (Opus 4.6)
**Files:** `src/worker/ftp.ts`, `src/components/FTPClient.tsx`

## Summary

Ninth review pass verifying the 4 fixes from Pass 8. **0 new issues found.** Protocol is clean.

## Fixes Verified

- **MLSD fallback mode:** `list()` now returns `{ files, actualMode }`. Handler uses `result.actualMode` — when MLSD succeeds it reports 'mlsd', when falling back to LIST it reports 'list'. Confirmed correct.
- **Anonymous FTP login:** `connect()` now handles 230 after USER (skips PASS) and 331 (sends PASS). Other codes throw. Confirmed correct per RFC 959.
- **Rename modal:** Uses `renameable` list (all types except 'other'). Shows files, directories, and symlinks with per-type icons. "Directory" label for dirs. Confirmed correct.
- **Download/delete symlinks:** `downloadable` and `deletable` include type 'link'. Icons show 🔗 with `aria-hidden="true"`. Confirmed correct.

## Areas Re-verified

- No new security vulnerabilities introduced by fixes
- No accessibility regressions — `aria-hidden="true"` on new emoji icons
- MLSD return type change only affects `handleFTPList` (only caller)
- Anonymous login fix still rejects invalid responses (anything other than 230/331)
- Build passes clean

## Status

**PASS** — No remaining issues. Protocol review complete.

## Build Status

`npm run build` — **PASS**
