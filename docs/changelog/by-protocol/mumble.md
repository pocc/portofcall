# Mumble Review

**Protocol:** Mumble
**File:** `src/worker/mumble.ts`
**Reviewed:** 2026-02-18

## Summary

1. **Varint decoding integer overflow** — Lines 195-201, 207-213, 217-222    - **Bug**: Protobuf varint parsing used signed bitwise OR (`val |= (b & 0x7f) << shift`) which produces negative values when bit 31 is set.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | Fixed protobuf varint parsing integer overflow (signed bitwise OR → unsigned `>>> 0`); fixed frame header parsing overflow; fixed varint encoding for values > 2³² (`>>>= 7` → `Math.floor(value/128)`);... |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/MUMBLE.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
