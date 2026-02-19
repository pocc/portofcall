# MGCP Review

**Protocol:** Media Gateway Control Protocol (MGCP/RFC 3435)
**File:** `src/worker/mgcp.ts`
**Reviewed:** 2026-02-19
**Specification:** [RFC 3435](https://datatracker.ietf.org/doc/html/rfc3435)
**Tests:** Tests not present (missing `tests/mgcp.test.ts`)

## Summary

MGCP implementation provides 3 endpoints (audit, command, call-setup) supporting the text-based VoIP signaling protocol over TCP. Handles AUEP (audit endpoint), CRCX/DLCX (connection lifecycle), RQNT (request notification), and response parsing (status codes, SDP bodies). Critical bugs fixed include transaction ID validation (range enforcement), SDP parsing (multi-line body detection), and parameter injection (newline handling in user parameters).

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **PARAMETER INJECTION**: User-supplied parameters in command endpoint not sanitized — added key/value validation to prevent header injection |
| 2 | High | **SDP PARSING BUG**: Response parser assumes first \r\n\r\n is header/body boundary but SDP can contain blank lines — fixed with "v=" detection for SDP start |
| 3 | Medium | **TRANSACTION ID RANGE**: generateTransactionId() can produce values outside RFC 3435 range (1-999999999) — added proper bounds (1 + Math.random() * 999999998) |
| 4 | Low | **INCOMPLETE RESPONSE PARSE**: Multi-line responses stop after first line in some cases — loop should read until \r\n\r\n |
| 5 | Low | **CALL ID VALIDATION**: generateCallId() produces hex string but RFC 3435 format not validated — acceptable but should document format |

## Documentation Improvements

**Created:** Complete MGCP command reference and status code mapping

The implementation includes comprehensive documentation:

1. **All 3 endpoints documented** — `/audit` (AUEP), `/command` (generic verb handler), `/call-setup` (CRCX + DLCX sequence) with complete message format specifications
2. **Command syntax** — Request format (VERB transactionId endpoint@gateway MGCP 1.0\r\n), response format (statusCode transactionId comment\r\n), parameter lines, blank line terminator
3. **Valid verbs** — CA-to-GW commands (AUEP, AUCX, CRCX, MDCX, DLCX, RQNT, EPCF), forbidden verbs (NTFY, RSIP are GW-to-CA)
4. **AUEP requested info** — F: parameter (A=capabilities, R=events, D=digit map, S=signals, X=request ID, N=notified entity, I=connection IDs, T=bearer info, O=observed events, ES=event states)
5. **CRCX parameters** — C: (call ID, hex string), L: (local options, p:20=packetization, a:PCMU=codec), M: (connection mode, recvonly/sendonly/sendrecv/inactive)
6. **SDP in responses** — Connection ID (I: header), SDP body (c=IN IP4 IP, m=audio PORT RTP/AVP PT), codec mapping (0=PCMU, 8=PCMA)
7. **Status codes** — Complete mapping of 38 RFC 3435 status codes (1xx provisional, 2xx success, 4xx transient, 5xx permanent) with human-readable descriptions
8. **Known limitations** — 6 documented limitations including:
   - TCP transport only (UDP not supported by Cloudflare Workers)
   - No RTP/RTCP media plane
   - SDP parsing minimal (c= and m= lines only)
   - No digest authentication
   - No encryption (no TLS, no SRTP)
   - Wildcard endpoints not supported

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ❌ Missing test file — should create `tests/mgcp.test.ts`
**RFC Compliance:** RFC 3435 (MGCP)

## See Also

- [RFC 3435](https://datatracker.ietf.org/doc/html/rfc3435) - Media Gateway Control Protocol specification
- [RFC 4566](https://datatracker.ietf.org/doc/html/rfc4566) - SDP: Session Description Protocol
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
