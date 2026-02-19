# RDP Review

**Protocol:** RDP
**File:** `src/worker/rdp.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/RDP.md` was a pre-implementation planning document titled "Remote Desktop Protocol (RDP) Implementation Plan". It contained a fictional `RDPClient` TypeScript class at a nonexistent path (`src/worker/protocols/rdp/client.ts`) with stub methods for MCS, channel join, security exchange, licensing, capabilities, mouse/keyboard input, and screen refresh — none of which exist. A fictional `RDPClient` React component (`src/components/RDPClient.tsx`) with canvas rendering was included. The three actual endpoints (`/connect`, `/negotiate`, `/nla-probe`) were entirely absent. Replaced the planning doc with an accurate power-user reference covering all 3 endpoints. Key additions: 1. **All 3 endpoints documented** — `/api/rdp/connect`, `/api/rdp/negotiate`, `/api/rdp/nla-probe` with full request/response JSON schemas and per-field descriptions.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Medium | Fixed X.224 negotiation response offset to use fixed value 7 instead of variable `x224Length` which could be corrupted |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/RDP.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
