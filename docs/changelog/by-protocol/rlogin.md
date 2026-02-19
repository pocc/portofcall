# RLOGIN Review

**Protocol:** RLOGIN
**File:** `src/worker/rlogin.ts`
**Reviewed:** 2026-02-18

## Summary

A general protocol overview with correct RFC 1282 flow diagram and handshake description, but inaccurate endpoint documentation. Response fields were wrong (`handshakeSuccess` instead of `serverAccepted`, `note` instead of `security`, flat `localUser`/`remoteUser` instead of nested `handshake` object). Timeouts were incorrect (claimed 5s/3s/2s vs actual 10s/5s/1s for `/connect` and 10s/4s for `/banner`). The `/banner` endpoint was mentioned in the intro table but not documented. No mention of the wire-level framing difference between `/connect` (two writes) and `/banner` (one write), no Cloudflare detection inconsistency, no error response shape divergence, no GET query param limitations. 1. **Accurate endpoint table** — All 3 handlers documented with correct HTTP methods, CF detection status, and timeout values (outer + inner). 2. **Route dispatch explained** — `/api/rlogin/connect` shared between HTTP probe and WebSocket based on `Upgrade` header, dispatched in `index.ts`.

## Bugs Found and Fixed

No critical or medium severity bugs found during review. Minor improvements and documentation updates applied.

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/RLOGIN.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
