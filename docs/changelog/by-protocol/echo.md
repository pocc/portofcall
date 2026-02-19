# Echo Review

**Protocol:** Echo
**File:** `src/worker/echo.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/ECHO.md` was titled "Echo Protocol Implementation Plan" and contained planning pseudocode: a fake `echoTest()` function at a nonexistent path `src/worker/protocols/echo.ts`, a fake `validateEchoRequest()` SSRF-blocking function, fake rate-limiting stubs, a React `EchoClient` component, and a "Next Steps" list. None of this exists. The actual routes (`POST /api/echo/test`, `GET /api/echo/connect`) were absent. 1. **Both endpoints documented** — `POST /api/echo/test` (HTTP one-shot) and `GET /api/echo/connect` (WebSocket tunnel) with exact request/response JSON schemas, all validated fields, HTTP status codes per validation path. 2. **Single-read limitation documented** — `/test` issues exactly one `reader.read()` after sending. Multi-segment responses produce `match: false` even when the server is behaving correctly. This is the most common source of confusion for users testing large messages.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | Fixed `ExpStatSN` to echo received `StatSN` from responses instead of staying at 0 |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/ECHO.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
