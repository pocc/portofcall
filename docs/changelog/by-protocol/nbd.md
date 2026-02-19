# NBD (Network Block Device) Review

**Protocol:** NBD (Network Block Device)
**File:** `src/worker/nbd.ts`
**Reviewed:** 2026-02-18

## Summary

The NBD implementation (`src/worker/nbd.ts`) provides three endpoints for interacting with NBD servers (port 10809): - `/probe` — lightweight magic byte detection (18-byte handshake only) - `/connect` — full newstyle handshake with export listing via NBD_OPT_LIST

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | Fixed `readExact()` buffer overshoot — now returns exactly `needed` bytes instead of all accumulated chunks |
| 2 | Critical | added 1MB limit on option reply data length to prevent memory exhaustion attacks |
| 3 | Critical | added handle validation in read/write responses per RFC 7143 §2.6.2 |
| 4 | Critical | added timeout cleanup with `clearTimeout()` on all code paths |
| 5 | Critical | added offset non-negative validation |
| 6 | Critical | added hex string character validation before parsing |
| 7 | Critical | fixed hex dump ASCII sidebar range (`<= 0x7e` instead of `< 0x7f`) |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/NBD.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
