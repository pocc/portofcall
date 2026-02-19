# NSCA (Nagios Service Check Acceptor) Review

**Protocol:** NSCA (Nagios Service Check Acceptor)
**File:** `src/worker/nsca.ts`
**Reviewed:** 2026-02-18

## Summary

No documentation existed for NSCA. The implementation had three endpoints: 1. **`/probe`** — reads 132-byte init packet (128-byte IV + 4-byte timestamp), returns parsed metadata 2. **`/send`** — basic passive check submission with encryption methods 0 (none) and 1 (XOR)

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **PROTOCOL VIOLATION**: Added 2-byte padding after return_code field (offset 14-16) to align host_name at offset 16 per NSCA v3 spec |
| 2 | Critical | **SECURITY**: Added timeout cleanup with clearTimeout() in all code paths to prevent resource leaks |
| 3 | Critical | **SECURITY**: Added MAX_CHUNKS=100 limit to prevent memory exhaustion from malicious servers |
| 4 | Critical | **DATA CORRUPTION**: Made all DataView byte order explicit (big-endian) with false parameter |
| 5 | Critical | **BUG**: Fixed reader/writer lock cleanup in early return paths using try/finally |
| 6 | Critical | **BUG**: Fixed DataView timestamp parsing to use byteOffset for correct subarray handling |
| 7 | Critical | **BUG**: Fixed error response cipher mismatch in /encrypted endpoint to extract actual cipher from request |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/NSCA.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
