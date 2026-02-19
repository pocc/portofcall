# HSRP Review

**Protocol:** Hot Standby Router Protocol (Cisco Proprietary)
**File:** `src/worker/hsrp.ts`
**Reviewed:** 2026-02-19
**Specification:** RFC 2281 (HSRPv1), Cisco HSRPv2
**Tests:** N/A

## Summary

HSRP implementation provides 4 endpoints (probe, listen, coup, v2-probe) supporting HSRPv1 and HSRPv2. Handles Active/Standby router discovery, virtual IP detection, and router priority/state fingerprinting. Critical fixes include timeout resource leaks, state validation, and HSRPv2 version byte correction.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **RESOURCE LEAK**: Fixed timeout handles not cleared in 4 endpoints (probe, listen, coup, v2-probe) — missing `clearTimeout()` in error paths |
| 2 | High | **RFC VIOLATION**: Corrected HSRPv2 version byte from 1 to 2 in `buildHSRPv2Hello()` (line 403) — was sending 0x01 instead of 0x02 |
| 3 | Medium | **BOUNDS CHECK**: Added validation that `ipParts` array has 4 elements before accessing indices in `buildHSRPHello()` |
| 4 | Medium | **STATE VALIDATION**: HSRPv1 state field uses non-sequential values (0,1,2,4,8,16) but code assumes contiguous enum — potential misinterpretation |
| 5 | Low | **AUTHENTICATION**: Authentication field is plaintext (8 bytes) but no warning about security implications — default "cisco" password well-known |

## Documentation Improvements

**Created:** Protocol header documentation is comprehensive

The implementation includes detailed comments covering:

1. **4 endpoints documented** — `/probe`, `/listen`, `/coup`, `/v2-probe` with protocol-specific behavior
2. **HSRPv1 packet format** — 20-byte structure with version, op code, state, timers, priority, group, auth, virtual IP
3. **HSRPv2 TLV format** — 36-byte Group State TLV with millisecond timers and extended group range (0-4095)
4. **State machine** — 6 states: Initial(0), Learn(1), Listen(2), Speak(4), Standby(8), Active(16)
5. **Op codes** — Hello(0), Coup(1), Resign(2) documented with use cases
6. **Known limitations**:
   - TCP probe non-standard (HSRP is UDP multicast to 224.0.0.2:1985)
   - No Active router preemption beyond Coup probe
   - HSRPv2 supports IPv6 virtual IPs (not implemented)
   - Authentication is plaintext only (no MD5 support)
7. **Coup attack semantics** — High-priority Coup (255) reveals Active router state, priority, and virtual IP
8. **HSRPv2 improvements** — Millisecond timers, 4095 groups vs 255, identifier (MAC) field

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ⚠️ No test file found
**RFC Compliance:** RFC 2281 (HSRPv1), Cisco HSRPv2 proprietary

## Security Notes

1. **Plaintext Authentication**: Default "cisco" password is well-known and easily spoofed
2. **Coup Attack Surface**: Sending Coup with priority=255 can trigger failover on misconfigured routers
3. **No HMAC Support**: HSRPv1 MD5 authentication (RFC 2281 §7.1) not implemented
4. **Network Fingerprinting**: Virtual MAC (0000.0c07.acXX) reveals HSRP group number

## See Also

- [Cisco HSRP Configuration Guide](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/ipapp_fhrp/configuration/xe-16/fhp-xe-16-book/fhp-hsrp.html)
- [RFC 2281 - Cisco Hot Standby Router Protocol](https://www.rfc-editor.org/rfc/rfc2281)
