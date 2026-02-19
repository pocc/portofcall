# Redis Sentinel Review

**Protocol:** Redis Sentinel
**File:** `src/worker/sentinel.ts`
**Reviewed:** 2026-02-18

## Summary

1. **RESOURCE LEAK — Timeout handles never cleared**: `setTimeout()` in `readRESPFull()` created handles but never called `clearTimeout()`. Every call leaked a timeout handle. Fixed by storing handle in `timeoutHandle` variable and clearing in `finally` block. 2. **RESOURCE LEAK — Reader/writer locks not released in error paths**: `reader.releaseLock()` and `writer.releaseLock()` only called in catch blocks via `socket.close()`. If `socket.close()` threw, locks remained held. Fixed by wrapping cleanup in try-catch in `finally` blocks for all 4 endpoints (`handleSentinelProbe`, `handleSentinelQuery`, `handleSentinelGet`, `handleSentinelGetMasterAddr`) and the `sentinelWriteCommand` helper.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **RESOURCE LEAK**: Fixed timeout handles never cleared in `readRESPFull()` — replaced `timeoutPromise` with `timeoutHandle` and added `clearTimeout()` in finally block |
| 2 | Critical | **RESOURCE LEAK**: Fixed reader/writer locks not released in error paths — wrapped cleanup in try/finally with exception suppression for all 4 endpoints plus `sentinelWriteCommand` helper |
| 3 | Critical | **DATA CORRUPTION**: Fixed TextDecoder stream never finalized — now calls `decoder.decode(new Uint8Array(0), { stream: false })` before returning to flush multi-byte UTF-8 sequences |
| 4 | Critical | **PROTOCOL VIOLATION**: Fixed integer parsing without NaN validation in `parseRESP()` and `readRESPFull()` — now validates all `parseInt()` results |
| 5 | Critical | **PROTOCOL VIOLATION**: Fixed missing RESP type validation — now checks first character against `[+\-:$*]` and throws on invalid input |
| 6 | Critical | **SECURITY**: Added masterName validation against `[a-zA-Z0-9_-]+` pattern in all endpoints accepting masterName |
| 7 | Critical | **SECURITY**: Added Cloudflare detection (`.workers.dev` or `cloudflare` in hostname) returning 403 with `isCloudflare: true` |
| 8 | Critical | **BUG**: Fixed empty password treated as "no password" — changed `if (password)` to `if (password !== undefined)` |
| 9 | Critical | **EDGE CASE**: Added warning when `flatArrayToObject()` receives odd-length array (last element dropped) |
| 10 | Critical | **PROTOCOL VIOLATION**: Improved array completion heuristic from `buffer.length > 4096` early return to conservative line-count check (`1 + count * 4` for nested arrays) |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/SENTINEL.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
