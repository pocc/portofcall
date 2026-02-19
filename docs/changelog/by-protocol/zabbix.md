# Zabbix Review

**Protocol:** Zabbix
**File:** `src/worker/zabbix.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/ZABBIX.md` was a partial implementation overview. It documented the ZBXD wire format correctly and listed 2 of the 3 actual endpoints (`/connect` and `/agent`), but was missing the `/discovery` endpoint entirely. It included generic protocol background (communication model diagrams, authentication notes, references) and a common item keys table, but lacked implementation-specific quirks, response field gotchas, or curl examples. No mention of the hardcoded `"portofcall-probe"` hostname in `/connect`, the `version` field misnomer, or the `ZBX_NOTSUPPORTED` success/failure ambiguity. Replaced with accurate power-user reference. Key additions: 1. **Three-endpoint structure** — documented all 3 endpoints: `/connect` (server probe), `/agent` (passive item check), `/discovery` (two-step active checks + sender data). The original doc was missing `/discovery` entirely — the most powerful endpoint, which lets you impersonate any configured host via `agentHost`.

## Bugs Found and Fixed

No critical or medium severity bugs found during review. Minor improvements and documentation updates applied.

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/ZABBIX.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
