# Tor Control Review

**Protocol:** Tor Control Protocol
**File:** `src/worker/torcontrol.ts`
**Reviewed:** 2026-02-19

## Summary

Implementation supports Tor control-plane probing and administration: `PROTOCOLINFO`, authenticated `GETINFO`, and authenticated `SIGNAL`. Parsing handles line-based response patterns and basic multiline semantics expected by the control port.

## Expected Feature Set vs Implementation

Implemented endpoints:
- `POST /api/torcontrol/probe`
- `POST /api/torcontrol/getinfo`
- `POST /api/torcontrol/signal`

Signal endpoint includes allowlist validation and optional NEWNYM-related circuit/stream state snapshots.

## Bugs Found and Fixed

No critical or medium-severity bugs were fixed in this documentation pass.

## Notable Limitations

- Cookie-file auth workflow is not implemented.
- No event subscription stream (`SETEVENTS`) endpoint.

## Documentation Improvements

Created canonical review/spec document with endpoint coverage, auth behavior, and control-command scope.

## See Also

- [Protocol Stub](../../protocols/TORCONTROL.md)
- [Worker Implementation](../../../src/worker/torcontrol.ts)
