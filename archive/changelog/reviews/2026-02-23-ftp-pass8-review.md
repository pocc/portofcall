# FTP Protocol Review — Pass 8

**Date:** 2026-02-23
**Reviewer:** Claude (Opus 4.6)
**Files:** `src/worker/ftp.ts`, `src/components/FTPClient.tsx`

## Summary

Eighth review pass (fresh independent review after 7 prior passes marked clean). **4 issues found and fixed.**

## Issues Found

### 1. Medium — MLSD fallback mode misreported in API response

**File:** `src/worker/ftp.ts` — `handleFTPList` + `FTPClient.list()`

When `mlsd=true` is passed and MLSD fails (server doesn't support it), the code falls back to LIST but the response still reports `mode: 'mlsd'`. A power user relying on this field to determine the listing format (e.g., to know whether MLSD facts are available) gets wrong information.

**Fix:** Changed `list()` return type from `FTPFile[]` to `{ files: FTPFile[], actualMode: 'mlsd' | 'list' }`. Handler now uses `result.actualMode` in the response.

### 2. Medium — Anonymous FTP login broken (RFC 959 violation)

**File:** `src/worker/ftp.ts` — `FTPClient.connect()`

Per RFC 959, after `USER`, the server may respond with:
- `230` — User logged in (no password needed, e.g. anonymous FTP)
- `331` — Password required

The code only accepted `331`, throwing "Username rejected by server" for `230`. This breaks anonymous FTP (`USER anonymous` → `230`) which is a very common use case.

**Fix:** After USER, check for 230 (skip PASS) or 331 (send PASS as before). Any other code throws the existing error.

### 3. Low — Rename modal restricted to files only

**File:** `src/components/FTPClient.tsx`

The rename modal used `filesOnly` (type === 'file'), but FTP `RNFR`/`RNTO` works on both files and directories. Power users couldn't rename directories from the UI.

**Fix:** Created `renameable` list (all types except 'other'). Rename modal now shows files, directories, and symlinks with appropriate icons. Updated modal title from "Rename File" to "Rename".

### 4. Low — Download/delete modals excluded symlinks

**File:** `src/components/FTPClient.tsx`

`filesOnly` (type === 'file') excluded symlinks (type === 'link'), but `RETR` and `DELE` work on symlinks. Power users with symlinked files couldn't download or delete them.

**Fix:** Created `downloadable` and `deletable` lists (type === 'file' || type === 'link'). Both modals now show symlinks with the 🔗 icon.

## Areas Verified (no issues)

- Command injection prevention via `sanitizeFTPInput()` on all user inputs — confirmed
- SSRF via PASV IP — `isBlockedHost()` check confirmed
- SSRF via upload multipart — explicit `isBlockedHost(host)` confirmed
- All 12 handlers: method guard, param validation, port 1-65535, Cloudflare check, `connect()` inside try/finally — confirmed
- Content-Disposition header injection prevention — confirmed
- Upload/download 10 MiB limits — confirmed
- SITE command allowlist (CHMOD, CHOWN, UMASK, IDLE, HELP) — confirmed
- Multi-line FTP response parsing (RFC 959 `NNN ` termination) — confirmed
- 64KB control response size limit — confirmed
- Deadline-based data transfer timeouts — confirmed
- UI: keyboard nav, ARIA roles, Escape dismiss, logs auto-scroll — confirmed
- PASV port validation (octets 0-255, port 1-65535) — confirmed

## Build Status

`npm run build` — **PASS**
