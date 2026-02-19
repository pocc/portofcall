# TFTP Review

**Protocol:** TFTP over TCP (Experimental)
**File:** `src/worker/tftp.ts`
**Reviewed:** 2026-02-19

## Summary

Implementation models TFTP packet formats (`RRQ`, `WRQ`, `DATA`, `ACK`, `ERROR`) over TCP as a Worker-compatible experimental mode. This is intentionally non-standard because RFC 1350 TFTP transport is UDP.

## Expected Feature Set vs Implementation

Implemented endpoints:
- `POST /api/tftp/connect`
- `POST /api/tftp/read`
- `POST /api/tftp/write`
- `POST /api/tftp/options`
- `POST /api/tftp/get`

Packet parsing/building and block sequencing are implemented for diagnostic and constrained transfer workflows.

## Bugs Found and Fixed

No critical or medium-severity bugs were fixed in this documentation pass.

## Notable Limitations

- Not interoperable with many standard UDP-only TFTP servers.
- Option negotiation behavior is best treated as diagnostic in TCP mode.
- No protocol-local Cloudflare detector guard in this module.

## Documentation Improvements

Created canonical review/spec document clarifying that this module is a TCP-compatible approximation for Worker constraints, not RFC-transport-compliant TFTP.

## See Also

- [Protocol Stub](../../protocols/TFTP.md)
- [Worker Implementation](../../../src/worker/tftp.ts)
