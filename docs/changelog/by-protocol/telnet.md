# Telnet Review

**Protocol:** Telnet
**File:** `src/worker/telnet.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/TELNET.md` was a planning artifact titled "Telnet Protocol Implementation Plan." It contained an aspirational `TelnetClient` TypeScript class (with `connect()`, `processBuffer()`, `handleCommand()`, `handleSubnegotiation()`, `sendWindowSize()`, and `getData()` methods), a `telnetTunnel()` WebSocket wrapper, a React `TelnetTerminal` component polling data every 50ms via `setInterval`, and a `isTelnetAllowed()` IP prefix filter that only allowed private network connections — none of which exists in the actual implementation. The real four handlers and their exact behaviors were entirely absent. Replaced the planning doc with an accurate power-user reference. Key additions: 1. **Dual-behavior `/connect` path** — documented that `GET/POST /api/telnet/connect` and `WebSocket /api/telnet/connect` are the same path, disambiguated by the `Upgrade: websocket` header check in the router, with separate request/response schemas for each.

## Bugs Found and Fixed

No critical or medium severity bugs found during review. Minor improvements and documentation updates applied.

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/TELNET.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
