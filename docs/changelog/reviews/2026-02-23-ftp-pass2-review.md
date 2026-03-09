# FTP Protocol Review — Pass 2

**Date:** 2026-02-23
**Reviewer:** Claude
**Files:** `src/worker/ftp.ts`, `src/worker/ftps.ts`, `src/components/FTPClient.tsx`

## Summary

Second review pass after fixing 9 issues in Pass 1. Found 4 additional issues — all fixed.

## Bugs Found and Fixed

| # | Severity | Category | Description | File |
|---|----------|----------|-------------|------|
| 1 | High | Resource Leak | All 11 FTP request handlers called `client.connect()` outside the `try/finally` block. If `connect()` threw after opening the socket (timeout during handshake, auth failure), the socket was never closed. Fixed: moved `connect()` inside `try` for all handlers. | `ftp.ts` (11 handlers) |
| 2 | Medium | Resource Leak | FTPS `handleFTPSList` data read loop had no timeout — a stalled server could hang the Worker isolate indefinitely. Fixed: deadline-based timeout matching the `timeout` parameter. | `ftps.ts:608` |
| 3 | Medium | Resource Leak | FTPS `handleFTPSDownload` data read loop had no timeout. Fixed: deadline-based timeout with clean socket teardown. | `ftps.ts:716` |
| 4 | Low | Accessibility | Modals lacked Escape key handler and `role="dialog"` / `aria-modal="true"` attributes. Keyboard users couldn't dismiss modals. Fixed: global keydown listener + ARIA attributes on all 5 modals. | `FTPClient.tsx` |

## Build Status

`npm run build` — PASS (no TypeScript errors)
