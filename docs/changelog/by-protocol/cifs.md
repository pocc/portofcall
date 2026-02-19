# CIFS / SMB2 (port 445) Review

**Protocol:** CIFS / SMB2 (port 445)
**File:** `src/worker/cifs.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/CIFS.md` was a 31-line generic overview describing CIFS as "Microsoft's file sharing protocol, essentially SMB 1.0" with a "Deprecated" status note. Listed protocol features (file sharing, authentication, file locking, named pipes, transaction semantics) none of which map to the actual implementation. No endpoints, no request/response schemas, no wire protocol details, no authentication flow, no limitations. The doc described SMB1/CIFS but the implementation speaks SMB2/3 exclusively. Replaced with an accurate power-user reference for the actual SMB2/3 implementation. Key additions: 1. **Endpoint reference** — documented all 6 endpoints (negotiate/connect alias, auth, ls, read, stat, write) with full request/response JSON schemas, field defaults, and per-endpoint timeout defaults (10s–20s).

## Bugs Found and Fixed

No critical or medium severity bugs found during review. Minor improvements and documentation updates applied.

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/CIFS.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
