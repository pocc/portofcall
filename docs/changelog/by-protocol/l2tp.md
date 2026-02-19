# L2TP Review

**Protocol:** Layer 2 Tunneling Protocol
**File:** `src/worker/l2tp.ts`
**Reviewed:** 2026-02-19
**Specification:** RFC 2661 (L2TPv2)
**Tests:** N/A

## Summary

L2TP implementation provides 4 endpoints (connect, hello, session, start-control) supporting full tunnel and session establishment (SCCRQ→SCCRP→SCCCN→ICRQ→ICRP→ICCN). Handles AVP parsing, sequence number tracking, and PPP session layer setup. Critical fixes include Bearer Capabilities AVP (MUST-level RFC violation), session ID randomization, and ZLB ACK handling.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **RFC VIOLATION**: Added missing Bearer Capabilities AVP in SCCRQ (line 284-287) — RFC 2661 §4.1 requires this MUST-level AVP |
| 2 | High | **COLLISION RISK**: Session/tunnel IDs use `Math.random() * 65535 + 1` but don't exclude reserved value 0 — changed to `65534 + 1` (line 669) |
| 3 | High | **RESOURCE LEAK**: Timeout handles not cleared in 4 endpoints across error/success paths |
| 4 | Medium | **SEQUENCE TRACKING**: `handleL2TPSession()` increments `peerNs` after ZLB ACK but doesn't validate Nr field matches our last Ns |
| 5 | Medium | **AVP PARSING**: `parseL2TPMessage()` trusts `avpLength` from network without bounds check before `data.subarray(offset, offset + avpLength)` |
| 6 | Low | **PROTOCOL LAYERING**: Code comments mention PPP LCP negotiation would follow (line 751) but implementation stops at ICCN — no PPP framing |

## Documentation Improvements

**Created:** Comprehensive L2TP reference in header comments

The implementation includes detailed documentation:

1. **4 endpoints documented** — `/connect` (SCCRQ→SCCRP), `/hello` (keepalive), `/session` (full 6-message handshake), `/start-control` (robust SCCRQ with retry logic)
2. **Message types** — SCCRQ(1), SCCRP(2), SCCCN(3), StopCCN(4), Hello(6), ICRQ(10), ICRP(11), ICCN(12), ZLB ACK
3. **AVP types** — MessageType(0), ProtocolVersion(2), FramingCapabilities(3), BearerCapabilities(4), HostName(7), VendorName(8), AssignedTunnelID(9), ReceiveWindowSize(10), AssignedConnectionID(14)
4. **L2TP header flags** — T(control), L(length present), S(sequence), Ver(2)
5. **AVP header format** — M(mandatory) bit, H(hidden) bit, length(10 bits), vendor ID(2), attribute type(2), value(variable)
6. **Handshake flow** — Dual-mode: connect (tunnel only) vs session (tunnel + PPP session)
7. **Known limitations**:
   - TCP-only (L2TP normally uses UDP/1701)
   - No PPP LCP/IPCP negotiation after ICCN
   - No data channel support (only control channel)
   - No L2TP/IPsec (pure L2TP)
   - Sequence number window size fixed at 4

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ⚠️ No test file found
**RFC Compliance:** RFC 2661 (L2TPv2)

## Security Notes

1. **No Encryption**: Pure L2TP has no confidentiality — typically paired with IPsec (L2TP/IPsec)
2. **No Authentication**: No challenge/response mechanism implemented — AVPs accepted at face value
3. **DoS Vector**: No rate limiting on SCCRQ — can establish many tunnels rapidly
4. **Plaintext Hostnames**: HostName AVP reveals client/server identity without protection

## See Also

- [RFC 2661 - Layer Two Tunneling Protocol](https://www.rfc-editor.org/rfc/rfc2661)
- [RFC 3931 - Layer Two Tunneling Protocol (L2TPv3)](https://www.rfc-editor.org/rfc/rfc3931)
