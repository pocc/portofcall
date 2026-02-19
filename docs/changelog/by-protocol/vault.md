# Vault HTTP API Review

**Protocol:** Vault HTTP API
**File:** `src/worker/vault.ts`
**Reviewed:** 2026-02-18

## Summary

Created `docs/protocols/VAULT.md` (632 lines) from scratch. Key content: 1. **Architecture overview** — Two socket helpers (`sendHttpGet` vs. inline POST loop in write handler), `Connection: close` semantics, all headers sent per request type. 2. **Authentication reference** — Token types and prefixes (`hvs.`, `hvb.`, `hvr.`, `s.`), which endpoints require tokens, TTL behavior, token expiry errors.

## Bugs Found and Fixed

No critical or medium severity bugs found during review. Minor improvements and documentation updates applied.

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/VAULT.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
