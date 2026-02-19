# LDAP Review

**Protocol:** LDAP
**File:** `src/worker/ldap.ts`
**Reviewed:** 2026-02-18

## Summary

The original `LDAP.md` was an implementation plan predating the shipped code. Critical failures: - Described a single `/api/ldap/search` endpoint — the actual implementation has five operations (connect, search, add, modify, delete) **and a parallel TLS family** (`/api/ldaps/*`) for a total of ten routes. - Described TypeScript classes (`LDAPClient`, `LDAPConnection`, `DirectoryService`) that do not exist.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Medium | Fixed `bindDN` to use provided value instead of hardcoded empty string; added rootDSE read (search with empty baseDN); added proper BER length encoding for multi-byte lengths |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/LDAP.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
