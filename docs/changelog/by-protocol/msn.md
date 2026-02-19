# MSN Messenger / MSNP Review

**Protocol:** MSN Messenger / MSNP
**File:** `src/worker/msn.ts`
**Reviewed:** 2026-02-18

## Summary

MSNP (Microsoft Notification Protocol) is the proprietary text-based protocol used by MSN Messenger / Windows Live Messenger (1999-2013). Line-oriented, CRLF-terminated commands with transaction IDs. Supports version negotiation (VER), client version reporting (CVR), Tweener/Passport auth (USR TWN), and legacy MD5 auth (USR MD5). Official servers shut down 2013; revival servers (Escargot) still active. | Issue | Line(s) | Fix | Severity |

## Bugs Found and Fixed

No critical or medium severity bugs found during review. Minor improvements and documentation updates applied.

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/MSN.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
