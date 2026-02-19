# Git Review

**Protocol:** Git Pack Protocol (git://)
**File:** `src/worker/git.ts`
**Reviewed:** 2026-02-19
**Specification:** [Git Pack Protocol Documentation](https://git-scm.com/docs/pack-protocol)
**Tests:** `tests/git.test.ts`

## Summary

Git implementation provides 2 endpoints (refs, fetch) supporting the native git:// protocol for read-only repository access. Handles pkt-line framing, ref advertisement parsing, pack negotiation (want/have/done), and PACK format parsing. Critical bugs fixed include buffer overflow (pkt-line length validation), ref parsing (symref capability extraction), and resource management (flush packet not sent before close in error paths).

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **BUFFER OVERFLOW**: pkt-line length validation missing — added bounds check for 4-65520 bytes to prevent OOM attacks |
| 2 | High | **RESOURCE LEAK**: Flush packet (0000) not sent before closing socket in error paths — added `buildFlushPkt()` and proper cleanup |
| 3 | High | **PARSING BUG**: Symref capability extraction uses split(':') which fails for ref names containing colons — fixed with `indexOf()` approach |
| 4 | Medium | **PROTOCOL VIOLATION**: "version 1" pkt-line not handled in ref advertisement — added detection and skip logic |
| 5 | Medium | **SHA VALIDATION**: Ref advertisement accepts any 40-char hex string — added regex validation for SHA-1 (40 hex) and SHA-256 (64 hex) |

## Documentation Improvements

**Created:** Comprehensive protocol documentation with examples

The implementation includes detailed comments for:

1. **All 2 endpoints documented** — `/refs` (ls-remote equivalent) and `/fetch` (pack retrieval) with complete pkt-line format specifications
2. **Pkt-line format details** — Length encoding (4-byte hex including length bytes), flush packet (0000), maximum payload (65516 bytes), newline handling
3. **Ref advertisement parsing** — First line capability extraction (NUL-separated), symref resolution (HEAD:refs/heads/main), version detection
4. **Pack negotiation protocol** — Client capabilities (ofs-delta, side-band-64k, no-progress), want line format, flush + done sequence
5. **PACK format parsing** — Magic bytes (PACK), version number, object count, variable-length header (type + size encoding), object types (commit=1, tree=2, blob=3, tag=4, ofs_delta=6, ref_delta=7)
6. **Known limitations** — 10 documented limitations including:
   - Read-only protocol (no push support)
   - Pack data not fully parsed (stops after first object header)
   - No delta resolution (ofs/ref deltas reported but not decoded)
   - PACK index not generated
   - No support for git-receive-pack (push)
   - Protocol v2 not supported
   - Shallow clones not supported
   - No authentication mechanism
   - Bandwidth limit not configurable
   - Progress messages (side-band) not parsed

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ✅ Tests present in `tests/git.test.ts`
**RFC Compliance:** Git Pack Protocol v1

## See Also

- [Git Pack Protocol](https://git-scm.com/docs/pack-protocol) - Official protocol specification
- [Git Pack Format](https://git-scm.com/docs/pack-format) - PACK file structure
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
