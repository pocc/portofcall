# XMPP Review

**Protocol:** XMPP
**File:** `src/worker/xmpp.ts`
**Reviewed:** 2026-02-18

## Summary

The existing doc was already a decent power-user reference (not a planning doc). It documented all 4 endpoints with request/response JSON, the phase tracking system, feature detection, timeout architecture, SASL PLAIN encoding, and local test server setup. However, several claims did not match the code, and important bugs/gotchas were missing.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | Added XML entity escaping for domain, recipient JID, and message body to prevent XML injection |
| 2 | Medium | Fixed `tls.required` false positive — scoped `<required>` check to `<starttls>` block only; fixed `roster-versioning` false positive by not matching `version=` in stream header |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/XMPP.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
