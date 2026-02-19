# NATS Review

**Protocol:** NATS
**File:** `src/worker/nats.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/NATS.md` was a planning artifact titled "NATS Protocol Implementation Plan." It contained a fictional `NatsClient` class (with `connect()`, `subscribe()`, `publish()`, `request()`, `readLoop()`, `processLine()`, and `flush()` methods), a `RequestReply` helper class, a `QueueGroup` helper class, and a React `NatsClient` component using a WebSocket stream for received messages — none of which exist in the real implementation. The actual 8 HTTP endpoints and their wire behaviors were entirely absent. Replaced the planning doc with an accurate power-user reference covering all 8 endpoints and their exact behavior. Key findings: 1. **Auth field split (critical gotcha)** — documented that `/connect`, `/publish`, and all four `/jetstream-*` endpoints use `user`/`pass`/`token` fields, while `/subscribe` and `/request` use `username`/`password` with no `token` support. Sending the wrong field names silently results in an unauthenticated connection.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Medium | Fixed JetStream publish to expect `+OK` or `-ERR` instead of JSON ack for core NATS publish; fixed `username`/`password` to `user`/`pass` per NATS protocol; fixed "responsed" typo |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/NATS.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
