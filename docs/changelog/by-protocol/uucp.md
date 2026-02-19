# UUCP (Unix-to-Unix Copy Protocol) Review

**Protocol:** UUCP (Unix-to-Unix Copy Protocol)
**File:** `src/worker/uucp.ts`
**Reviewed:** 2026-02-18

## Summary

UUCP (Unix-to-Unix Copy) is a historical store-and-forward network protocol from the 1970s-1990s used for file transfer, email routing, and Usenet news distribution before widespread Internet adoption. Port 540/TCP (`uucpd` daemon). The protocol is completely obsolete, replaced by SSH, SFTP, SMTP, and NNTP. **Two API endpoints:** 1. `/api/uucp/probe` — Full UUCP handshake (wakeup → greeting → identity → accept/reject)

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **RESOURCE LEAK**: Fixed timeout handles not cleared in both endpoints — replaced `timeoutPromise` with `timeoutHandle` and added `clearTimeout()` in finally blocks |
| 2 | Critical | **RESOURCE LEAK**: Fixed reader/writer locks not released in error paths — wrapped all cleanup in try/finally with exception suppression |
| 3 | Critical | **BUG**: Fixed duplicate `socket.close()` calls — moved to finally block only |
| 4 | Critical | **INPUT VALIDATION**: Added timeout bounds validation (1000-300000ms) to both endpoints |
| 5 | Critical | **INPUT VALIDATION**: Added port validation (1-65535) to `/api/uucp/handshake` (was missing) |
| 6 | Critical | **PROTOCOL VIOLATION**: Fixed system name character validation — removed underscore from allowed chars (traditional UUCP uses alphanumeric + hyphen only) |
| 7 | Critical | **SECURITY**: Fixed unsafe regex on binary data — run login detection on sanitized `displayBanner` instead of raw `rawText` |
| 8 | Critical | **BUG**: Fixed DLE+S protocol detection buffer overrun — added length check (`rawBytes.length >= 2`) before accessing second byte |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/UUCP.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
