# FTP Protocol Review — Pass 1

**Date:** 2026-02-23
**Reviewer:** Claude
**Files:** `src/worker/ftp.ts`, `src/worker/ftps.ts`, `src/components/FTPClient.tsx`

## Summary

Comprehensive review of the FTP and FTPS protocol implementations covering security, feature completeness, accessibility, and usability. Found 9 issues (2 high, 4 medium, 3 low) — all fixed in this pass.

## Bugs Found and Fixed

| # | Severity | Category | Description | File |
|---|----------|----------|-------------|------|
| 1 | High | Bug | `stat()` used `Promise.all` to send SIZE and MDTM concurrently on the same FTP control socket. FTP control connections are strictly sequential (RFC 959 §3.3) — interleaved writes/reads corrupt the protocol state machine. Fixed: sequential execution. | `ftp.ts:174` |
| 2 | High | Security | `Content-Disposition` header in download response used unsanitized filename from `remotePath`. Filenames containing `"` or control characters could inject HTTP headers. Fixed: strip control chars, quotes, and backslashes. | `ftp.ts:1401` |
| 3 | Medium | Security | FTP upload handler had no file size limit — arbitrarily large files could be uploaded, exhausting Worker isolate memory (128 MiB limit). Fixed: 10 MiB hard limit matching the existing download limit. | `ftp.ts:1331` |
| 4 | Medium | Security | FTPS download handler (`handleFTPSDownload`) collected response bytes without any size limit. Fixed: 10 MiB hard limit with clean socket teardown on overflow. | `ftps.ts:716` |
| 5 | Medium | Security | FTPS upload handler had no size limit on base64-decoded content. Fixed: 10 MiB hard limit before decoding. | `ftps.ts:815` |
| 6 | Medium | Usability | File browser had no parent directory navigation. Users who navigated into subdirectories had no way back. Fixed: added "Up" button when not at root. | `FTPClient.tsx` |
| 7 | Low | Bug | Path concatenation from root (`/`) produced double-slash (`//dirname`). Some FTP servers interpret `//` as protocol-relative or absolute, causing unexpected behavior. Fixed: `buildPath()` helper. | `FTPClient.tsx` |
| 8 | Low | Accessibility | File browser entries used `<div onClick>` without keyboard support. Screen readers and keyboard users couldn't navigate directories. Fixed: added `role`, `tabIndex`, `aria-label`, and `onKeyDown` handlers. | `FTPClient.tsx` |
| 9 | Low | Feature | `FTPFile` interface in component only had `'file' | 'directory'` but worker returns `'link' | 'other'` too. Symlinks rendered as plain files with wrong icon. Fixed: expanded type union, added link icon. | `FTPClient.tsx` |

## Verified Already Handled

- **FTP command injection:** `sanitizeFTPInput()` strips CR/LF from all user input (passwords, paths) in ftp.ts
- **FTPS command injection:** `FTPSSession.sendCommand()` strips CR/LF at the transport layer in ftps.ts
- **PASV SSRF:** Both FTP and FTPS validate PASV-returned IPs against `isBlockedHost()` blocklist
- **Port validation:** All handlers validate port range 1-65535
- **Cloudflare detection:** All handlers check `checkIfCloudflare()` before connecting
- **SITE command abuse:** Handler allowlists only CHMOD, CHOWN, UMASK, IDLE, HELP subcommands

## Build Status

`npm run build` — PASS (no TypeScript errors)
