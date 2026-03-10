# MQTT Review

**Protocol:** MQTT
**File:** `src/worker/mqtt.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/MQTT.md` was an **implementation plan** document headed "MQTT Protocol Implementation Plan". It described the MQTT pub/sub model with tutorial-level diagrams and a full theoretical `MQTTClient` class and React component that don't exist in the codebase. None of the three actual Worker endpoints were documented. Replaced the planning doc with an accurate power-user API reference: 1. **Three-endpoint structure** — documented `GET|POST /api/mqtt/connect`, `POST /api/mqtt/publish`, and `GET /api/mqtt/session` (WebSocket) with exact request/response shapes, field tables, and defaults.

## Bugs Found and Fixed

| # | Class | Severity | Description |
|---|-------|----------|-------------|
| 1 | 1B | HIGH | `handleMQTTConnect` discarded the `writer` returned by `mqttConnect` then called `socket.writable.getWriter()` again on the same still-locked stream, throwing `TypeError: WritableStream is already locked` on every connect probe. Fixed by destructuring `writer` from the `mqttConnect` result and using it directly. |

### 1B sweep (2026-02-24)

**Finding:** `handleMQTTConnect` (`src/worker/mqtt.ts` line 342) destructured only `{ socket, sessionPresent }` from the `mqttConnect` result, discarding the `writer` that `mqttConnect` had already acquired via `socket.writable.getWriter()`. The very next statement (line 348) called `socket.writable.getWriter()` again on the same `WritableStream`, which was still locked. This throws `TypeError: WritableStream is already locked` unconditionally — every call to `POST /api/mqtt/connect` failed at that point regardless of server reachability.

**Trigger:** User opens Port of Call, enters any valid MQTT host/port, clicks "Test Connection". The handler always reaches line 342 and always fails at line 348.

**Fix:** Changed the destructuring at line 342 to `{ socket, writer, sessionPresent }` so the writer acquired inside `mqttConnect` is reused. Removed the redundant `getWriter()` call at the original line 348.

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/MQTT.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
