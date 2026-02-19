# TeamSpeak (TS3 ServerQuery) Review

**Protocol:** TeamSpeak (TS3 ServerQuery)
**File:** `src/worker/teamspeak.ts`
**Reviewed:** 2026-02-18

## Summary

Created comprehensive power-user documentation at `docs/protocols/TEAMSPEAK.md` with 482 lines covering: **Protocol Overview:** - Text-based TCP protocol on port 10011

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **RESOURCE LEAK**: Fixed timeout handles never cleared — `setTimeout()` in `readTSResponse()`, `readTSBanner()`, `tsSession()`, and all handler functions now use `timeoutHandle` variable with `clearTimeout()` in finally blocks |
| 2 | Critical | **DATA CORRUPTION**: Fixed unescape order — `\\` now processed last to prevent false matches (e.g., `\\s` → `\s` instead of space) |
| 3 | Critical | **SECURITY**: Fixed `serverAdminToken` sent unescaped on line 636 — now uses `tsEscape()` to prevent command injection from tokens containing spaces/pipes/backslashes |
| 4 | Critical | **PROTOCOL VIOLATION**: Fixed line terminator regex from `/\n\r\n$/` to `/\r\n$/` (TeamSpeak uses CR LF, not LF CR LF) |
| 5 | Critical | **INPUT VALIDATION**: Added timeout bounds check (1-300000ms) to all 6 endpoints |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/TEAMSPEAK.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
