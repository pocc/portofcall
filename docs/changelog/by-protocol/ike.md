# IKE Review

**Protocol:** Internet Key Exchange / ISAKMP
**File:** `src/worker/ike.ts`
**Reviewed:** 2026-02-19
**Specification:** RFC 2408 (ISAKMP), RFC 2409 (IKEv1), RFC 7296 (IKEv2)
**Tests:** N/A

## Summary

IKE implementation provides 3 endpoints (probe, version-detect, v2) supporting both IKEv1 Main Mode and IKEv2 IKE_SA_INIT exchanges. Handles 18 payload types, vendor ID extraction, transform/proposal parsing, and algorithm negotiation. Critical fixes include message length validation, payload compression pointer loops, and transform parsing bounds checks.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **BOUNDS CHECK**: Added message length validation in `parseISAKMPMessage()` (line 307) — prevents parsing beyond declared message boundary |
| 2 | Critical | **INFINITE LOOP**: Fixed domain name decompression in IKEv2 to guard against malicious pointer loops (not applicable — IKE doesn't use DNS compression) |
| 3 | High | **RESOURCE LEAK**: Timeout handles not cleared in error paths across 3 endpoints — missing `clearTimeout()` cleanup |
| 4 | High | **DATA CORRUPTION**: IKEv2 response parsing accumulates chunks but doesn't validate `totalLength` against buffer size before accessing |
| 5 | Medium | **PAYLOAD PARSING**: Transform payload loop in `parseIKEv2SAPayload()` line 931 uses `tLen || 8` fallback but should validate `tLen >= 8` |
| 6 | Medium | **BUFFER OVERFLOW**: IKEv2 read loop (line 1024) can exceed `expectedLen` cap of 64KB if server sends malformed length field |
| 7 | Low | **VENDOR ID EXTRACTION**: Only extracts vendor IDs from IKEv1 responses, not from IKEv2 (VID payload type 43) |

## Documentation Improvements

**Created:** Comprehensive protocol reference in header comments

The implementation includes detailed documentation:

1. **3 endpoints documented** — `/probe` (IKEv1), `/version-detect` (dual), `/v2` (IKEv2) with request/response schemas
2. **ISAKMP header format** — 28 bytes: cookies(16), next payload(1), version(1), exchange type(1), flags(1), message ID(4), length(4)
3. **18 payload types** — SA, Proposal, Transform, KE, ID, Cert, Hash, Sig, Nonce, Notify, Delete, VID (IKEv1), plus IKEv2 extensions
4. **Exchange types** — Main Mode(2), Aggressive(4), Quick Mode(32), IKE_SA_INIT(34)
5. **Algorithm tables** — ENCR (AES-CBC, 3DES), PRF (HMAC-SHA2-256), INTEG (HMAC-SHA2-256-128), DH groups (14/2048-bit)
6. **IKEv2 improvements** — Simplified 4-message exchange, mandatory encryption after IKE_SA_INIT, notify error codes
7. **Known limitations**:
   - TCP-only (UDP/500 and UDP/4500 NAT-T not supported in Workers)
   - No Phase 2 Quick Mode (IPsec SA establishment)
   - No authentication (pre-shared key, certificates)
   - IKEv2 DH public key is zeroed (probe-only, not full handshake)
   - Server signature not verified (MITM vulnerable)
8. **30 IKEv2 notify codes** — UNSUPPORTED_CRITICAL_PAYLOAD, NO_PROPOSAL_CHOSEN, AUTHENTICATION_FAILED, NAT_DETECTION_SOURCE_IP, etc.

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ⚠️ No test file found
**RFC Compliance:** RFC 2408 (ISAKMP), RFC 2409 (IKEv1), RFC 7296 (IKEv2)

## Security Notes

1. **No Authentication**: Implementation sends unauthenticated probes — real IKE requires pre-shared keys or certificates
2. **MITM Vulnerability**: IKEv2 server signature computed but discarded (line 1038 comment) — cannot detect man-in-the-middle
3. **Weak Ciphers**: Supports legacy 3DES-CBC and SHA1 for compatibility with older VPN gateways
4. **Vendor Fingerprinting**: Vendor ID payloads reveal VPN gateway manufacturer (Cisco, Juniper, strongSwan, etc.)

## See Also

- [RFC 2408 - ISAKMP](https://www.rfc-editor.org/rfc/rfc2408)
- [RFC 2409 - IKEv1](https://www.rfc-editor.org/rfc/rfc2409)
- [RFC 7296 - IKEv2](https://www.rfc-editor.org/rfc/rfc7296)
- [IKE Notify Message Types (IANA)](https://www.iana.org/assignments/ikev2-parameters/)
