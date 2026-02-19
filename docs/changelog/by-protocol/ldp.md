# LDP Review

**Protocol:** Label Distribution Protocol (MPLS)
**File:** `src/worker/ldp.ts`
**Reviewed:** 2026-02-19
**Specification:** RFC 5036
**Tests:** N/A

## Summary

LDP implementation provides 3 endpoints (connect, probe, label-map) supporting MPLS label distribution via Initialization handshake and label mapping collection. Parses 11 message types, extracts FEC-to-label bindings, and discovers LSR identities. Critical fixes include Cloudflare detection bypass, TLV U/F bit masking, and label value bit-shift correction.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **LABEL PARSING**: Fixed Generic Label extraction to shift upper 20 bits correctly (line 654) — was losing label value due to incorrect bit mask |
| 2 | High | **TLV TYPE MASKING**: Added U/F bit removal when comparing TLV types (line 312, 624, 669, 673) — `tlvType & 0x3fff` to ignore Unknown/Forward bits |
| 3 | High | **RESOURCE LEAK**: Timeout handles not cleared in 3 endpoints across error/success paths |
| 4 | Medium | **BOUNDS CHECK**: `readLDPResponse()` accumulates chunks without validating `pduLen <= maxBytes` before allocation |
| 5 | Medium | **MESSAGE TYPE**: Uses hardcoded message type values instead of enum constants in several places |
| 6 | Low | **CLOUDFLARE BYPASS**: Includes Cloudflare IP detection to prevent false positives when scanning Cloudflare-proxied hosts |

## Documentation Improvements

**Created:** Comprehensive LDP wire protocol reference

The implementation includes detailed documentation:

1. **3 endpoints documented** — `/connect` (Init handshake + KeepAlive), `/probe` (lightweight Init), `/label-map` (full label collection)
2. **PDU header format** — Version(2), PDU Length(2), LDP Identifier(6: LSR-ID 4 bytes + Label Space ID 2 bytes)
3. **11 message types** — Notification(0x0001), Hello(0x0100), Initialization(0x0200), KeepAlive(0x0201), Address(0x0300), Label Mapping(0x0400), Label Withdraw(0x0402), Label Release(0x0403), etc.
4. **Common Session Parameters TLV** — Protocol version, keepalive time, A/D bits, path vector limit, max PDU length, receiver LDP ID
5. **FEC element types** — Wildcard(1), Prefix(2) with address family (IPv4=1)
6. **TLV types** — FEC(0x0100), Generic Label(0x0200), Address List(0x0101), Common Session(0x0500)
7. **Label parsing** — 4-byte Generic Label with value in upper 20 bits (bits [31:12])
8. **Known limitations**:
   - IPv4 FEC prefixes only (no IPv6)
   - No targeted LDP sessions
   - No Loop Detection (Path Vector)
   - No MPLS Traffic Engineering extensions
   - Label collection limited to 2 seconds (configurable via timeout)

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ⚠️ No test file found
**RFC Compliance:** RFC 5036 (LDP Specification)

## Security Notes

1. **No Authentication**: LDP has no built-in authentication — relies on TCP MD5 signatures (RFC 2385) at transport layer
2. **Label Spoofing**: Without LDP authentication, attackers can inject false label mappings
3. **LSR Fingerprinting**: LSR-ID (router loopback IP) reveals MPLS network topology
4. **DoS Vector**: Label Mapping messages can be large — no rate limiting implemented

## See Also

- [RFC 5036 - LDP Specification](https://www.rfc-editor.org/rfc/rfc5036)
- [RFC 5561 - LDP Capabilities](https://www.rfc-editor.org/rfc/rfc5561)
- [MPLS Label Distribution Protocol (IANA)](https://www.iana.org/assignments/ldp-namespaces/)
