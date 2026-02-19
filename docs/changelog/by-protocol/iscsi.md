# iSCSI Review

**Protocol:** iSCSI
**File:** `src/worker/iscsi.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/ISCSI.md` was a generic iSCSI protocol overview document. It contained: a protocol specification section with PDU format diagrams and opcode tables, a "Key Features" list (multipath I/O, CHAP, Kerberos, SRP, jumbo frames), IQN naming convention examples, a full login phase negotiation parameter list, SendTargets/iSNS/SLP discovery method descriptions, Linux initiator (`iscsiadm`) and target (`targetcli`) configuration examples, Windows initiator PowerShell commands, and comparison notes (vs Fibre Channel, NFS/SMB, FCoE, NVMe-oF). None of the two actual API endpoints were mentioned. No request/response JSON schemas. No curl examples. Replaced with an accurate power-user reference covering both endpoints: 1. **Two-endpoint structure** — documented `POST /api/iscsi/discover` (no-auth Login + SendTargets) and `POST /api/iscsi/login` (CHAP-capable Login + optional SendTargets) with exact request/response JSON, field tables, defaults, and all response shapes (success, login failure, non-iSCSI, timeout).

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | Fixed `ExpStatSN` to echo received `StatSN` from responses instead of staying at 0 |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/ISCSI.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
