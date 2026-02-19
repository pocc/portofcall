# Portmapper / rpcbind Review

**Protocol:** Portmapper / rpcbind
**File:** `src/worker/portmapper.ts`
**Reviewed:** 2026-02-18

## Summary

1. **RESOURCE LEAK** — Timeout promises created but never cleaned up in all three endpoints (`handlePortmapperProbe`, `handlePortmapperDump`, `handlePortmapperGetPort`). Replaced promise-based timeouts with `setTimeout()` handles stored in variables, added `clearTimeout()` in `finally` blocks to prevent memory leaks on slow connections. 2. **DATA CORRUPTION** — `readRpcResponse()` could read more bytes than `fragmentLength` if TCP chunks arrived larger than needed. Fixed to slice chunks to exact needed byte count and return exactly `fragmentLength` bytes instead of all accumulated data.

## Bugs Found and Fixed

No critical or medium severity bugs found during review. Minor improvements and documentation updates applied.

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/PORTMAPPER.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
