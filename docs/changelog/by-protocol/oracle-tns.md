# Oracle TNS Review

**Protocol:** Oracle TNS
**File:** `src/worker/oracle-tns.ts`
**Reviewed:** 2026-02-18

## Summary

The function accumulated chunks until `totalRead >= n` but returned the unsized combined buffer. Because the loop condition is `totalRead < n` (correct for accumulation), if the OS delivers more bytes than requested in the final chunk — which is the common case for small TNS packets arriving in a single TCP segment — the function returned all of them. The callers in `doTNSConnect`, `handleOracleQuery`, and `handleOracleSQLQuery` all use a two-step pattern: ```typescript

## Bugs Found and Fixed

No critical or medium severity bugs found during review. Minor improvements and documentation updates applied.

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/ORACLE-TNS.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
