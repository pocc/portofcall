# POP3S Review

**Protocol:** POP3S
**File:** `src/worker/pop3s.ts`
**Reviewed:** 2026-02-18

## Summary

In `handlePOP3SList`, STAT is sent after successful authentication but the response is not checked for `-ERR`. If STAT fails (e.g., mailbox locked by another session), the code silently sets `totalMessages: 0` and `totalSize: 0` and proceeds to send LIST. The equivalent `handlePOP3List` in `pop3.ts` correctly throws on STAT failure. Fixed by adding `if (!statResp.startsWith('+OK')) throw` before parsing the STAT response in `pop3s.ts`. Both `handlePOP3SCapa` (pop3s.ts) and `handlePOP3Capa` (pop3.ts) sent CAPA and then immediately called `readPOP3MultiLine` to read the response. `readPOP3MultiLine` waits for `

## Bugs Found and Fixed

No critical or medium severity bugs found during review. Minor improvements and documentation updates applied.

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/POP3S.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
