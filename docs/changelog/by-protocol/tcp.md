# TCP Review

**Protocol:** Raw TCP Send/Receive
**File:** `src/worker/tcp.ts`
**Reviewed:** 2026-02-19

## Summary

Implementation provides a generic TCP probe endpoint that can connect, optionally send payload bytes, and return captured response bytes in UTF-8 or hex. It is suitable for diagnostics, banner grabbing, and ad-hoc protocol testing.

## Expected Feature Set vs Implementation

- `POST /api/tcp/send` implemented.
- Input validation for host, port, encoding, and `maxBytes` range implemented.
- Optional payload send path implemented for both UTF-8 and hex modes.
- Response includes timing (`connectMs`, total `rtt`) and both hex/text output forms.

## Bugs Found and Fixed

No critical or medium-severity bugs were fixed in this documentation pass.

## Notable Limitations

- Single request/response style utility, not a long-lived session tool.
- Hex payload parsing accepts loosely formatted input; caller should provide canonical even-length hex.

## Documentation Improvements

Created canonical review/spec document for the TCP utility endpoint and request/response semantics.

## See Also

- [Protocol Stub](../../protocols/TCP.md)
- [Worker Implementation](../../../src/worker/tcp.ts)
