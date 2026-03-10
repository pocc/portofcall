# FTPS Protocol Review

**Protocol:** FTPS (FTP over TLS/SSL) - RFC 4217
**File:** `src/worker/ftps.ts`, `src/components/FTPSClient.tsx`, `src/worker/response-middleware.ts`
**Reviewed:** 2026-02-23
**Passes:** 4 (Pass 4 returned 0 issues)
**Tests:** `tests/ftps.test.ts`

## Summary

Iterative review of the FTPS protocol implementation across 4 passes. Found and fixed 9 issues spanning security (missing input validation, resource leaks, incorrect error handling), protocol correctness (wrong FTP response codes), and usability (error messages hidden by middleware).

## Bugs Found and Fixed

| # | Pass | Severity | Description | Fix |
|---|------|----------|-------------|-----|
| 1 | 1 | **Critical** | `handleFTPSDelete` missing `password` validation — requests without password would send `PASS undefined` to remote server | Added `!password` to validation check |
| 2 | 1 | **Critical** | `handleFTPSMkdir` missing `password` validation — same issue | Added `!password` to validation check |
| 3 | 1 | **Critical** | `handleFTPSRename` missing `password` validation — same issue | Added `!password` to validation check |
| 4 | 1 | **High** | `authenticateFTPSSession` did not sanitize username/password for `\r\n` before embedding in FTP commands — `sendCommand` strips it but defense-in-depth was missing | Added explicit `\r\n` stripping on credentials before use |
| 5 | 1 | **Medium** | PASV port range not validated — `p1*256+p2` could produce port 0 (both octets 0), which is invalid | Added `port < 1 || port > 65535` check matching FTP implementation |
| 6 | 1 | **Medium** | FTPS 500 errors sanitized by response-middleware — "Internal server error" replaced useful messages like "Authentication failed" | Added `/api/ftp/` and `/api/ftps/` to passthrough list in `response-middleware.ts` |
| 7 | 2 | **High** | `handleFTPSConnect` socket not closed on error after connection — if banner read throws, reader/writer/socket all leak | Wrapped post-connection logic in `try { ... } catch { cleanup(); throw; }` with a `cleanup()` helper |
| 8 | 2 | **High** | Data socket leak in `handleFTPSList` and `handleFTPSDownload` — timeout rejection in data transfer loop skips `dataReader.releaseLock()` and `dataSocket.close()` | Wrapped data transfer loops in `try { ... } finally { releaseLock(); close(); }` |
| 9 | 3 | **Medium** | Upload data socket leak — if `dataWriter.write()` throws in `handleFTPSUpload`, `releaseLock()` and `close()` are skipped | Wrapped write in `try { ... } finally { releaseLock(); close(); }` |
| 10 | 3 | **Low** | `handleFTPSDelete` accepted response code 257 for DELE/RMD — 257 is for MKD (create dir), not delete | Changed to accept only 250 |

## Known Limitations (Not Bugs)

1. **Implicit FTPS only** — No explicit FTPS (AUTH TLS on port 21) support. Explicit is more common but requires `secureTransport: 'starttls'` which may not be available in Cloudflare Sockets API.
2. **No TLS certificate validation** — Cloudflare Sockets API `secureTransport: 'on'` does not expose certificate details or allow verification. Documented in prior review.
3. **Unix LIST format only** — `parseFTPListOutput` only handles Unix `ls -l` format; Windows/IIS FTP `dir` format returns entries as `unknown` type.
4. **UI only exposes connect** — The React client component (`FTPSClient.tsx`) only exposes the `/connect` endpoint. The 7 other endpoints (login, list, download, upload, delete, mkdir, rename) are API-only with no UI.

## Files Modified

- `src/worker/ftps.ts` — All security and correctness fixes
- `src/worker/response-middleware.ts` — Error passthrough for FTP/FTPS endpoints

## Verification

- **Build:** `npm run build` passes (pre-existing `afp.ts` errors unrelated)
- **TypeScript:** 0 errors in modified files (`npx tsc --noEmit` confirms)
