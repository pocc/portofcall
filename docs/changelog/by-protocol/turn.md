
---

## TURN (Traversal Using Relays around NAT)

**File:** `src/worker/turn.ts`
**Reviewed:** 2026-02-18
**RFC:** 5766 (obsoleted by RFC 8656)
**Documentation:** `docs/protocols/TURN.md` (created)

### Bugs Found

| # | Severity | Location | Bug | Impact |
|---|---|---|---|---|
| 1 | **CRITICAL** | Lines 291-294, 590-591, 758-759, 854-855 | Transaction IDs generated using `Math.random()` instead of `crypto.getRandomValues()` — RFC 5389 §6 requires cryptographically random transaction IDs | Predictable transaction IDs allow attackers to inject forged TURN responses; birthday paradox suggests ~1% collision rate after 7750 transactions |
| 2 | Low | Line 78, `TURNAttributeType` enum | Missing enum values `XorPeerAddress = 0x0012` and `Data = 0x0013` — code uses magic constant `0x0012` at line 858 | Readability only; code works but uses magic constants instead of named enums |
| 3 | Low | Line 878 | CreatePermission success response uses magic constant `0x0108` instead of enum value | Readability only; should add `CreatePermissionResponse = 0x0108` to `TURNMessageType` enum |
| 4 | Low | Lines 847-848 | XOR-PEER-ADDRESS port hardcoded to 0 for CreatePermission requests | Acceptable — RFC 5766 §2.3 states permissions are IP-only, servers ignore port field; using 0 is unconventional but correct |

### Code Status

**CRITICAL BUG REQUIRES FIX:** Transaction ID generation must use `crypto.getRandomValues()` before production deployment.

Example fix for lines 291-294:
```typescript
// OLD (INSECURE):
const transactionId = Buffer.allocUnsafe(12);
for (let i = 0; i < 12; i++) {
  transactionId[i] = Math.floor(Math.random() * 256);
}

// NEW (SECURE):
const txIdArray = new Uint8Array(12);
crypto.getRandomValues(txIdArray);
const transactionId = Buffer.from(txIdArray);
```

This same fix must be applied to all four transaction ID generation sites (allocate request in both handlers, authenticated allocate, and CreatePermission request).

### RFC 5766 Compliance

| Feature | RFC 5766 § | Status | Notes |
|---------|-----------|--------|-------|
| Allocate Request (0x0003) | §6.1 | ✅ Implemented | TCP transport only |
| Allocate Success/Error Response | §6.2 | ✅ Implemented | Correct parsing of XOR-RELAYED-ADDRESS, LIFETIME, error codes |
| CreatePermission Request (0x0008) | §9 | ✅ Implemented | IPv4 only; uses port 0 in XOR-PEER-ADDRESS (acceptable) |
| CreatePermission Success Response | §9 | ✅ Implemented | Correctly detects 0x0108 response type |
| Long-term credential auth (MD5 key derivation) | §17, RFC 5389 §10.2 | ✅ Implemented | Pure-JS MD5 implementation (lines 660-741) correctly implements RFC 1321 |
| MESSAGE-INTEGRITY (HMAC-SHA1) | RFC 5389 §15.4 | ✅ Implemented | Correct length field adjustment before HMAC computation |
| XOR-RELAYED-ADDRESS decoding | §14.5, RFC 5389 §15.2 | ✅ Implemented | IPv4 and IPv6 support; correct XOR with magic cookie/transaction ID |
| XOR-PEER-ADDRESS encoding | §14.3 | ✅ Implemented | IPv4 only; port set to 0 (acceptable per §2.3) |
| REQUESTED-TRANSPORT attribute | §14.7 | ✅ Implemented | UDP (17) default; RFFU bytes correctly set to 0 |
| 401 Unauthorized challenge/response | RFC 5389 §10.2 | ✅ Implemented | Extracts realm/nonce from error response; retries with auth |
| ERROR-CODE parsing | RFC 5389 §15.6 | ✅ Implemented | Correctly extracts class (hundreds digit) and number (units/tens) |
| Refresh Request (0x0004) | §7 | ❌ Not implemented | Would require persistent allocation beyond Workers request lifetime |
| Send/Data Indications (0x0006/0x0007) | §10 | ❌ Not implemented | Requires persistent socket for relay |
| ChannelBind (0x0009) | §11 | ❌ Not implemented | Requires persistent allocation |
| FINGERPRINT attribute (CRC-32) | RFC 5389 §15.5 | ❌ Not implemented | Optional; not needed for single-protocol TCP |

### Documentation Created

`docs/protocols/TURN.md` (comprehensive 800+ line reference) covers:

1. **Protocol specification** — STUN message format, TURN-specific attributes (XOR-RELAYED-ADDRESS, XOR-PEER-ADDRESS, REQUESTED-TRANSPORT, LIFETIME, etc.)
2. **Message types** — All request types (Allocate, Refresh, Send, CreatePermission, ChannelBind) and response types (success/error for each)
3. **Authentication flow** — 3-step diagram: unauthenticated Allocate → 401 with realm/nonce → authenticated Allocate with MESSAGE-INTEGRITY → CreatePermission
4. **Attribute reference** — All 15 TURN-specific + 10 inherited STUN attributes with type codes, value formats, RFC sections, and usage notes
5. **Error codes** — All 15 TURN/STUN error codes (300-699 range) with meanings and usage scenarios
6. **Bugs found and fixed** — Detailed analysis of 10 potential bugs; 4 confirmed bugs (1 critical security issue, 3 low-severity readability issues)
7. **Implementation architecture** — 3 endpoints (`/api/turn/allocate`, `/api/turn/permission`, `/api/turn/probe`) with request/response schemas and behavior notes
8. **Wire format examples** — 4 annotated hexdumps with field-by-field decoding (Allocate request, success response, 401 error, authenticated request with MESSAGE-INTEGRITY)
9. **Known limitations** — 15 limitations documented (no TLS, no Refresh/Send/ChannelBind, IPv4-only CreatePermission, single-shot operation, Math.random() bug, etc.)
10. **Testing** — curl examples for all 3 endpoints; local coturn server setup; Cloudflare Calls integration example
11. **Security considerations** — 10 security notes (transaction ID randomness, MESSAGE-INTEGRITY requirements, credential security, TLS recommendation, quota exhaustion, amplification attacks, etc.)
12. **Production deployment checklist** — 13-item checklist including critical transaction ID fix, TLS migration, nonce retry logic, allocation tracking, etc.
13. **Edge cases** — 10 edge cases (short allocation lifetime, symmetric NAT detection, realm/nonce reuse, transaction ID collision probability, permission lifetime, IPv6 peers, etc.)
14. **Resources** — Links to RFC 8656/5766/5389/6062/7065, coturn GitHub, IANA STUN parameters, WebRTC samples, Trickle ICE tester

### Key Findings

**What works correctly:**
- STUN message framing (20-byte header + TLV attributes with 4-byte alignment padding)
- XOR address encoding/decoding for IPv4 and IPv6 (magic cookie XOR for port, magic cookie || transaction ID XOR for IPv6 addresses)
- Long-term credential authentication (MD5 key derivation, HMAC-SHA1 MESSAGE-INTEGRITY with correct length field adjustment)
- 401 challenge/response flow (realm/nonce extraction, authenticated retry)
- Allocate and CreatePermission request/response handling
- Error code parsing (class * 100 + number = 300-699 error codes)

**What needs fixing:**
- **CRITICAL**: Replace `Math.random()` with `crypto.getRandomValues()` for transaction IDs (4 locations)
- Add missing enum values for XorPeerAddress and Data attribute types
- Add CreatePermissionResponse to TURNMessageType enum

**Acceptable trade-offs for Workers-based TURN client:**
- No Refresh/Send/ChannelBind (requires persistent allocations beyond Workers 30s CPU / 15min wall-clock limits)
- No FINGERPRINT (optional, not needed for single-protocol TCP)
- IPv4-only CreatePermission (sufficient for most WebRTC use cases)
- No TLS support (would require Workers TLS client support; production TURN uses port 5349 TLS/DTLS)

### Conclusion

The TURN implementation is a **functional proof-of-concept** for basic TURN allocation and permission management, correctly implementing core RFC 5766/5389 requirements. However, the **critical transaction ID security vulnerability** makes it unsuitable for production use without the `crypto.getRandomValues()` fix. Once fixed, it is appropriate for **testing TURN server connectivity** and **validating TURN credentials**, but not for production WebRTC relay due to lack of persistent allocation support (Refresh, Send/Data, ChannelBind).
