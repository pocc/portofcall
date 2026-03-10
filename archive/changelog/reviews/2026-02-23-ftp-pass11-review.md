# FTP Protocol Review — Pass 11

**Date:** 2026-02-23
**Reviewer:** Claude (Opus 4.6)
**Files:** `src/worker/ftp.ts`, `src/components/FTPClient.tsx`

## Summary

Eleventh review pass verifying the 2 fixes from Pass 10. **0 new issues found.** Protocol is clean.

## Fixes Verified

- **Anonymous FTP handler validation:** All 12 handlers now use `password == null` instead of `!password`. Edge cases confirmed:
  - `password: ""` (anonymous) — `"" == null` is `false` — passes validation, reaches `FTPClient.connect()` which handles 230/331 correctly
  - `password: undefined` (field omitted) — `undefined == null` is `true` — rejected with 400 (correct: missing field should be explicit error)
  - `password: "secret"` (normal auth) — passes validation as before
- **MLSD cdir/pdir filter:** `parseMlsdResponse()` now has `continue` guard for `cdir`/`pdir` entries. Only `dir` type remains for actual subdirectories. Filter placed before type mapping, so no wasted processing on skipped entries.

## Areas Re-verified

- UI `handleConnect` does not validate password (line 78) — allows empty password to be sent, which now works with the backend fix
- `FTPConnectionParams.password` is `string` type — constructor accepts empty strings
- `sanitizeFTPInput("")` returns `""` — no corruption of empty password
- `PASS ""` is valid FTP command — server handles it per RFC 959
- Pre-existing `TYPE I` response not validated after `connect()` — acceptable, as virtually all FTP servers support binary mode
- No regressions in SSRF, timeout, size limit, or accessibility protections

## Status

**PASS** — No remaining issues. Protocol review complete.

## Build Status

`npm run build` — pre-existing TS error in `hl7.ts` (unrelated to FTP). FTP changes are type-safe.
