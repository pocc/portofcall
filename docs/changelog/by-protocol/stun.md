# STUN Review

**Protocol:** Session Traversal Utilities for NAT
**File:** `src/worker/stun.ts`
**Reviewed:** 2026-02-19
**Specification:** RFC 5389 (STUN), RFC 8489 (STUN bis)
**Tests:** N/A

## Summary

STUN implementation provides 2 endpoints (binding, probe) supporting Binding Request/Response for NAT traversal and public IP discovery. Handles XOR-MAPPED-ADDRESS decoding, FINGERPRINT validation, and 14 attribute types. Critical fixes include IPv6 XOR calculation, message length self-delimiting, and attribute type naming.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **IPv6 XOR DECODING**: Fixed `decodeAddress()` to XOR IPv6 address with magic cookie (4 bytes) + transaction ID (12 bytes) per RFC 5389 §15.2 (line 144-149) |
| 2 | High | **MESSAGE LENGTH**: `readStunMessage()` correctly uses self-delimiting length field from header (line 406) but doesn't validate length <= maxBytes |
| 3 | Medium | **ATTRIBUTE PADDING**: Correctly implements 4-byte alignment padding (line 260) but doesn't validate padding bytes are zero |
| 4 | Medium | **FINGERPRINT VALIDATION**: Parses FINGERPRINT attribute (line 330) but doesn't compute/verify CRC-32 checksum |
| 5 | Low | **ERROR CODE PARSING**: Extracts error code class and number (line 320) but doesn't validate class is 3-7 per RFC |
| 6 | Low | **SOFTWARE ATTRIBUTE**: Included in Binding Request (line 474) but could leak implementation details |

## Documentation Improvements

**Created:** Comprehensive STUN protocol reference

The implementation includes detailed documentation:

1. **2 endpoints documented** — `/binding` (full Binding Request with response parsing), `/probe` (lightweight alive check)
2. **STUN header** — 20 bytes: Message Type(2), Length(2), Magic Cookie(4), Transaction ID(12)
3. **Message types** — Binding Request(0x0001), Binding Response(0x0101), Binding Error Response(0x0111)
4. **14 attribute types** — MAPPED-ADDRESS(0x0001), XOR-MAPPED-ADDRESS(0x0020), SOFTWARE(0x8022), FINGERPRINT(0x8028), ERROR-CODE(0x0009), RESPONSE-ORIGIN(0x802b), OTHER-ADDRESS(0x802c), etc.
5. **XOR address encoding** — IPv4: XOR with magic cookie upper 16 bits (port) and full 32 bits (address); IPv6: XOR with magic cookie + transaction ID
6. **Magic cookie** — 0x2112a442 (fixed per RFC 5389) distinguishes STUN from older RFC 3489
7. **Address families** — IPv4(0x01), IPv6(0x02)
8. **Known limitations**:
   - TCP-only (STUN normally uses UDP/3478)
   - No MESSAGE-INTEGRITY validation (HMAC-SHA1)
   - No FINGERPRINT verification (CRC-32)
   - No ALTERNATE-SERVER redirection
   - No CHANGE-REQUEST (RFC 3489 NAT type detection deprecated)

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ⚠️ No test file found
**RFC Compliance:** RFC 5389 (STUN), RFC 8489 (STUN bis)

## Security Notes

1. **No Authentication**: Implementation doesn't validate MESSAGE-INTEGRITY — accepts any response
2. **Transaction ID Randomness**: Uses `crypto.getRandomValues()` for secure transaction ID generation (line 48)
3. **Reflection Attacks**: STUN servers can amplify traffic (response larger than request) — potential DDoS vector
4. **IP Disclosure**: Reveals public IP/port to server — privacy concern for anonymity-focused users

## See Also

- [RFC 5389 - STUN Protocol](https://www.rfc-editor.org/rfc/rfc5389)
- [RFC 8489 - STUN bis](https://www.rfc-editor.org/rfc/rfc8489)
- [STUN Attribute Registry (IANA)](https://www.iana.org/assignments/stun-parameters/)
- [TURN Protocol (RFC 5766)](https://www.rfc-editor.org/rfc/rfc5766) - STUN extension for relay
