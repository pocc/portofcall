# SFTP Protocol Review

**Protocol:** SFTP (SSH File Transfer Protocol)
**Files:** `src/worker/sftp.ts`, `src/components/SFTPClient.tsx`, `src/data/api-examples.ts`, `tests/sftp.test.ts`
**Reviewed:** 2026-02-23
**Passes:** 3 (Pass 3 returned 0 issues)

## Summary

The SFTP protocol has 8 endpoints: `/connect` (banner grab), `/stat` (one-shot file metadata via full SSH+SFTP session), and 6 stub endpoints (`/list`, `/download`, `/upload`, `/delete`, `/mkdir`, `/rename`) that return 501 because SFTP's stateful bidirectional protocol cannot work over HTTP request/response. The architecture is well-documented in the top-of-file comment block with a clear roadmap for WebSocket-based implementation.

## Issues Found and Fixed

### Security (Medium)

1. **`/connect` accepted GET requests** — Allowed credential-adjacent data (`username`) to leak into access logs, CDN logs, and browser history via query parameters. Fixed: now POST-only, returns 405 for other methods.

2. **Redundant Cloudflare IP check in handler** — Both `handleSFTPConnect` and `openSFTP` contained `checkIfCloudflare()` calls, duplicating the router-level guard in `index.ts`. Removed handler-level checks (router guard is authoritative).

3. **Banner read had no timeout** — If an SSH server accepted TCP but never sent a banner, `reader.read()` would hang indefinitely. Added 10s `Promise.race` timeout.

4. **Banner read timeout leaked socket/reader** — On timeout, the socket reader lock was not released and the socket was not closed. Wrapped in `try/finally` with `reader.releaseLock()` and `socket.close().catch(() => {})`.

### Usability (Medium)

5. **`/connect` required `username` for banner grab** — The SSH banner is sent before auth, so `username` is not needed. Removed the requirement; endpoint now only needs `host` and optional `port`.

6. **Frontend required password/key to test connectivity** — The `SFTPClient` form required filling in auth credentials before the "Connect" button worked, but the backend `/connect` endpoint only does a banner grab. Simplified the frontend to only require host + port.

7. **Misleading "connected" file browser state** — After a successful banner grab, the UI set `connected=true` and displayed a fake file browser with a path display and disconnect button, implying an active SFTP session. Removed the connected state entirely; the UI is now a simple probe-and-log interface.

8. **API examples showed unsupported `timeout` parameter** — All curl examples in `api-examples.ts` included `"timeout":10000` but no SFTP handler reads this field. Removed from examples. Also marked 501 endpoints with `(501)` in their titles.

### Consistency (Low)

9. **`openSFTP` used 30s timeout vs `/connect`'s 10s** — Normalized to 10s across both code paths.

10. **`/stat` returned 500 for all errors** — Auth failures, missing files, and connection errors all returned HTTP 500. Added error-to-status mapping: `PERMISSION_DENIED` → 403, `NO_SUCH_FILE` → 404, `Connection timeout/refused` → 502.

### Tests

11. **Updated `sftp.test.ts`** — Removed `username` from `/connect` test payloads, added test for GET→405 rejection, added test for invalid port.

## Files Modified

| File | Changes |
|------|---------|
| `src/worker/sftp.ts` | POST-only, removed username requirement, removed redundant Cloudflare check, banner read timeout+cleanup, stat error codes, 10s timeout normalization |
| `src/components/SFTPClient.tsx` | Simplified to host+port probe UI, removed fake connected/file-browser state, removed unused state vars and refs |
| `src/data/api-examples.ts` | Removed `timeout` param, updated `/connect` example, marked 501 endpoints |
| `tests/sftp.test.ts` | Updated tests to match new API contract |

## Remaining Items

- 6 endpoints return 501 (list, download, upload, delete, mkdir, rename) — these require a WebSocket-based SFTP session architecture (documented in sftp.ts top-of-file comment)
- `parseAttrs` does not bounds-check extended attribute data (low risk: only processes data from authenticated SSH sessions)
