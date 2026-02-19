# PCEP (Path Computation Element Protocol) Review

**Protocol:** PCEP (Path Computation Element Protocol)
**File:** `src/worker/pcep.ts`
**Reviewed:** 2026-02-18

## Summary

`src/worker/pcep.ts` was a 788-line PCEP client supporting three endpoints: - `/api/pcep/connect` — Full OPEN handshake with capability parsing - `/api/pcep/probe` — Lightweight header-only server check

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **RESOURCE LEAK**: Fixed `readExact()` timeout not cleared — replaced `timeoutPromise` with `timeoutHandle` and added `clearTimeout()` in all `finally` blocks |
| 2 | Critical | **DATA CORRUPTION**: Fixed `readExact()` buffer overshoot — now returns exactly `needed` bytes instead of all accumulated chunks |
| 3 | Critical | **PROTOCOL VIOLATION**: Fixed TLV padding calculation — was using padded value length as full offset instead of adding to 4-byte header |
| 4 | Critical | **PROTOCOL VIOLATION**: Fixed object padding in PCRep parsing — now pads to 4-byte boundary per RFC 5440 §7.2 |
| 5 | Critical | **SECURITY**: Added object length bounds check (reject objLen > 65535) to prevent buffer overread |
| 6 | Critical | **INPUT VALIDATION**: Added IPv4 octet validation (0-255 range check) |
| 7 | Critical | added port validation (1-65535) to `/probe` endpoint |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/PCEP.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
