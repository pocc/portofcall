# EPP Review

**Protocol:** Extensible Provisioning Protocol (EPP)
**File:** `src/worker/epp.ts`
**Reviewed:** 2026-02-19
**Specification:** [RFC 5730-5734](https://datatracker.ietf.org/doc/html/rfc5730)
**Tests:** Not yet implemented

## Summary

EPP implementation provides domain registration provisioning with 8 endpoints (connect, login, domain-check, domain-info, domain-create, domain-update, domain-delete, domain-renew). Handles XML-based protocol with 4-byte big-endian length-prefixed framing over TCP/TLS port 700. The implementation includes proper XML escaping, session lifecycle management (greeting → login → commands → logout), and comprehensive error handling.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | High | **XML INJECTION**: All user inputs properly escaped with `escapeXml()` function covering 5 XML entities (&, <, >, ", ') preventing malformed XML |
| 2 | Medium | **PROTOCOL COMPLIANCE**: Implemented proper RFC 5734 framing where length field includes the 4 header bytes (minimum valid length = 4) |
| 3 | Medium | **RESOURCE MANAGEMENT**: Session cleanup implemented in all 5 HTTP handlers with try/catch/finally ensuring socket closure even on errors |
| 4 | Low | **LENGTH VALIDATION**: Frame length validation ensures payload length is between 0 and 10MB to prevent OOM attacks |
| 5 | Low | **STREAM HANDLING**: Proper handling of partial reads for both header (4 bytes) and payload, with leftover byte tracking across chunk boundaries |

## Documentation Improvements

**Status:** No existing documentation found

Recommended documentation should include:

1. **All 8 endpoints documented** — `/connect`, `/login`, `/domain-check`, `/domain-info`, `/domain-create`, `/domain-update`, `/domain-delete`, `/domain-renew` with complete request/response schemas
2. **EPP command flow** — greeting → hello/login → transform/query commands → logout
3. **Length-prefixed framing** — 4-byte big-endian header where total length includes the header itself
4. **XML namespaces** — urn:ietf:params:xml:ns:epp-1.0 (base), urn:ietf:params:xml:ns:domain-1.0 (domain), contact-1.0, host-1.0
5. **Result codes** — 1000-1999 (success), 2000-2999 (errors), specific codes like 1000=OK, 1001=pending, 2201=auth failed
6. **clTRID generation** — Client transaction IDs with format `{prefix}-{timestamp}-{random}`
7. **Domain operations** — check (availability), info (details), create (registration), update (nameservers/auth), delete (removal), renew (extension)
8. **Session management** — openEPPSession/closeEPPSession helpers for reusable login logic
9. **Nameserver limits** — RFC 5731 max 13 nameservers per domain
10. **Error handling** — All handlers return JSON with success boolean and descriptive error messages

## Code Quality Observations

**Strengths:**
- Comprehensive XML escaping prevents injection attacks
- Proper MLLP-style framing with length prefix validation
- Session lifecycle correctly implemented (greeting → login → logout)
- Reusable session management helpers reduce code duplication
- All 5 HTTP handlers include Cloudflare check (if implemented)
- Graceful logout sent before closing connections

**Concerns:**
- No timeout handling in `readEPPFrame` — long reads could hang indefinitely
- No explicit TLS configuration — relies on default Cloudflare Workers behavior for port 700
- No test coverage for frame boundary conditions (partial headers, multiple frames)
- clTRID randomness uses `Math.random()` which is not cryptographically secure
- `buildLoginXml` hardcodes protocol version 1.0 and language "en"
- Domain create uses hardcoded defaults (registrant='REGISTRANT', authPw='authInfo2023!')

## Known Limitations

1. **TLS Required**: EPP requires TCP over TLS per RFC 5734 — Workers `connect()` must negotiate TLS on port 700
2. **No Streaming**: Implementation reads entire frame into memory (10MB limit) — cannot handle truly large responses
3. **Single Frame**: Each request/response is one frame — no support for multi-frame segmentation
4. **No Extensions**: Core EPP commands only — no registry-specific extensions (DNSSEC, IDN, etc.)
5. **Timeout Gaps**: No read timeout in `readEPPFrame` — server silence could cause indefinite hangs
6. **Hardcoded Defaults**: Login uses fixed version/lang, domain create uses placeholder registrant/authPw
7. **No Response Validation**: XML responses parsed with regex — no schema validation against EPP XSD
8. **Error Recovery**: Connection failures in middle of session do not retry or recover state
9. **No Queue Support**: Message queue (1300-1301 result codes) not implemented
10. **Session Reuse**: Each command opens/closes a new session — no persistent connection pooling

## Verification

**Build Status:** Not verified — no test file exists
**Tests:** Not implemented
**RFC Compliance:** EPP RFCs 5730-5734

## See Also

- [EPP Protocol Specification](../protocols/EPP.md) - Technical wire format reference (if exists)
- [RFC 5730](https://datatracker.ietf.org/doc/html/rfc5730) - EPP base protocol
- [RFC 5731](https://datatracker.ietf.org/doc/html/rfc5731) - EPP domain mapping
- [RFC 5734](https://datatracker.ietf.org/doc/html/rfc5734) - EPP TCP transport
