# Source RCON Review

**Protocol:** Source RCON
**File:** `src/worker/rcon.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/SOURCE_RCON.md` was titled "Source RCON (Steam/Valve) Protocol Implementation" and was primarily a game administration guide: lists of game-specific commands for CS:GO, TF2, GMod, server.cfg snippets, rcon-cli testing instructions, "Future Enhancements" lists, and a Protocol History section. The actual API request/response JSON was entirely absent. The doc mentioned "reuses the existing RCON protocol handler at `src/worker/rcon.ts`" but never documented the endpoint paths or response shapes. Replaced with an accurate endpoint reference. Key additions: 1. **Correct endpoint paths** — `/api/rcon/connect` and `/api/rcon/command` (not game-specific paths). Tests hit these paths; the doc was silent on actual route names.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Medium | Changed default Source RCON port from 25575 (Minecraft) to 27015 (Source Engine) |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/RCON.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
