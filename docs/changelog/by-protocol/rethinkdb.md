# RethinkDB Review

**Protocol:** RethinkDB
**File:** `src/worker/rethinkdb.ts`
**Reviewed:** 2026-02-18

## Summary

1. **RESOURCE LEAK**: Timeout not cleared — all 7 handlers created `new Promise<never>()` for timeouts but never called `clearTimeout()`, leaking timers on every successful request. Fixed by using `timeoutHandle` and calling `clearTimeout()` in `finally` blocks on all code paths. 2. **DATA CORRUPTION**: `readExact()` buffer overshoot — when `result.value.length > (length - off)`, the function would copy only `n` bytes but accumulate the full chunk, causing the buffer to contain extra bytes beyond the requested length. Fixed by collecting chunks properly and returning exactly the requested byte count.

## Bugs Found and Fixed

No critical or medium severity bugs found during review. Minor improvements and documentation updates applied.

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/RETHINKDB.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
