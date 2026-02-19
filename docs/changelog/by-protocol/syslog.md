# Syslog Review

**Protocol:** Syslog
**File:** `src/worker/syslog.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/SYSLOG.md` was a pre-implementation planning document titled "Syslog Protocol Implementation Plan". It contained a fictional `SyslogClient` class at `src/worker/protocols/syslog/client.ts` (path doesn't exist), a fictional `SyslogLogger` wrapper class, a fictional `SyslogClient.tsx` React component, convenience methods (`emergency()`, `alert()`, etc.), structured data support (`formatStructuredData()`), procId/msgId parameters, and a `protocol: 'tcp' | 'udp'` option. None of this exists. The single actual endpoint `POST /api/syslog/send` was not documented. Replaced with an accurate power-user reference for the single endpoint. Key additions: 1. **Single endpoint documented** — `POST /api/syslog/send` with complete request/response JSON schemas, all field defaults, and validation error table.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Medium | Fixed severity calculation — was using `Math.floor(priority % 8)` which returns `NaN` on non-numeric input; added input validation |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/SYSLOG.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
