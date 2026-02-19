# TDS (SQL Server / Sybase) Review

**Protocol:** TDS (SQL Server / Sybase)
**File:** `src/worker/tds.ts`
**Reviewed:** 2026-02-18

## Summary

TDS 7.4 implementation with 3 endpoints: Pre-Login probe (no credentials), Login7 auth check, and SQL Batch query execution. Documented the 8-byte packet header format, Pre-Login option structure (5 options + TERMINATOR), LOGIN7 fixed fields (TDS 7.4 hardcoded, LCID en-US, all client strings "portofcall"), password obfuscation (XOR 0xA5 + nibble-swap), and the full token stream parser. Produced a 26-row column type decoding table showing which SQL Server types return usable values vs placeholder strings (temporal, binary, decimal-without-scale, UNIQUEIDENTIFIER-without-dashes are all notable gaps). Documented all known limitations: no TLS (ENCRYPT_OFF always sent), no Windows auth, no prepared statements, no multiple result sets, fragile unknown-token skip behavior.

## Bugs Found and Fixed

No critical or medium severity bugs found during review. Minor improvements and documentation updates applied.

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/TDS.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
