# RSH Review

**Protocol:** RSH
**File:** `src/worker/rsh.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/RSH.md` was a protocol explanation doc (background, `.rhosts` auth, privileged port requirement, security context) that referenced implementation file and mentioned two endpoints by name, but had: - No request/response JSON schemas for any endpoint - No curl examples

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | Fixed `readExact()` buffer overshoot — now returns exactly `needed` bytes instead of all accumulated chunks; added 1MB limit on option reply data length to prevent memory exhaustion attacks; added han... |
| 2 | Critical | **RESOURCE LEAK**: Fixed `readExact()` timeout not cleared — replaced `timeoutPromise` with `timeoutHandle` and added `clearTimeout()` in all `finally` blocks; **DATA CORRUPTION**: Fixed `readExact()`... |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/RSH.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
