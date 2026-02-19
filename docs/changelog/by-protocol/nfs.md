# NFS Review

**Protocol:** NFS
**File:** `src/worker/nfs.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/NFS.md` was a generic NFS overview document covering NFSv2/v3/v4/v4.1/v4.2 features, Linux NFS server `/etc/exports` configuration examples, client mount commands, FreeBSD exports syntax, security flavors (AUTH_SYS, RPCSEC_GSS/Kerberos), delegation, compound operations, and comparison notes (vs SMB, iSCSI, 9P). None of the 7 actual API endpoints were mentioned. No request/response JSON schemas. No curl examples. Replaced with an accurate power-user reference for all 7 endpoints: 1. **All 7 endpoints documented** — `/probe`, `/exports`, `/lookup`, `/getattr`, `/read`, `/readdir`, `/write` with exact request/response JSON, field descriptions, and defaults.

## Bugs Found and Fixed

No critical or medium severity bugs found during review. Minor improvements and documentation updates applied.

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/NFS.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
