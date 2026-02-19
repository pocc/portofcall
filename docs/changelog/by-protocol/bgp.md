# BGP Review

**Protocol:** BGP
**File:** `src/worker/bgp.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/BGP.md` was a planning document titled "BGP Protocol Implementation Plan" containing: - A fictional `BGPClient` TypeScript class with `connect()`, `messageLoop()`, `handleOpen()`, `handleUpdate()`, `parsePathAttributes()`, `parseASPath()`, `parseCommunities()`, `parseNLRI()` methods — none of which match the actual code structure - A fictional `BGPClient.tsx` React component with `localAS`, `remoteAS`, `routerId`, `routes` state, connecting to `/api/bgp/connect` via WebSocket — none of this exists

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Medium | Fixed `AS_PATH` parsing for 4-byte ASNs — was reading 2-byte ASNs from 4-byte AS capability sessions |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/BGP.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
