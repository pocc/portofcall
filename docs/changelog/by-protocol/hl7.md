# HL7 Review

**Protocol:** Health Level Seven v2.x (HL7 v2)
**File:** `src/worker/hl7.ts`
**Reviewed:** 2026-02-19
**Specification:** [HL7 v2.x Standard](https://www.hl7.org/implement/standards/product_brief.cfm?product_id=185)
**Tests:** Not yet implemented

## Summary

HL7 v2.x implementation provides healthcare data exchange protocol with 4 endpoints (connect, send, query, ADT_A08). Uses MLLP (Minimal Lower Layer Protocol) framing: `<VT>message<FS><CR>` (0x0B, 0x1C, 0x0D). Supports multiple message types: ADT^A01 (admission), ORU^R01 (lab results), QRY^Q01 (patient query), ADT^A08 (update patient). Messages are pipe-delimited segment-based text with MSH header, parsed using regex for field extraction. Proper MLLP wrapping/unwrapping with validation.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | High | **RESOURCE CLEANUP**: All 4 handlers properly release socket in try/catch/finally blocks preventing connection leaks |
| 2 | Medium | **MLLP FRAMING**: Correct 3-byte framing (VT + message + FS + CR) with proper extraction handling missing delimiters |
| 3 | Medium | **TIMEOUT HANDLING**: Promise.race pattern properly handles connection/read timeouts with descriptive errors |
| 4 | Low | **MSH PARSING**: Field index mapping correctly accounts for encoding characters at position 0 after MSH| |
| 5 | Low | **TIMESTAMP FORMAT**: `hl7Timestamp()` generates proper YYYYMMDDHHmmss format in UTC as per HL7 spec |

## Documentation Improvements

**Status:** No existing documentation found

Recommended documentation should include:

1. **MLLP Framing** — VT (0x0B) + message + FS (0x1C) + CR (0x0D), 3-byte wrapper for TCP transport
2. **Message Structure** — Pipe-delimited segments, each starting with 3-char segment ID (MSH, PID, EVN, OBR, OBX, etc.)
3. **MSH Header** — Field separator (|), encoding chars (^~\&), sending/receiving app/facility, timestamp, message type, control ID, processing ID, version
4. **Message Types** — ADT^A01 (admit), ADT^A08 (update), ORU^R01 (lab results), QRY^Q01 (query), ACK (acknowledgment)
5. **Segment Details** — PID (patient demographics), PV1 (visit), OBR (observation request), OBX (observation result), DG1 (diagnosis)
6. **Field Encoding** — Component separator (^), repetition separator (~), escape char (\), subcomponent separator (&)
7. **ACK Response** — MSA segment with ack code (AA=accept, AE=error, AR=reject) and original control ID
8. **Use Cases** — Hospital ADT feeds, lab result interfaces, EHR integration, patient query systems
9. **Timestamp Rules** — Client does NOT send event timestamp in ADT^A08 diagnosis field — server assigns timestamps
10. **Typical Ports** — 2575 (common HL7 MLLP port), 2576 (backup), varies by institution

## Code Quality Observations

**Strengths:**
- Proper MLLP framing with 3-byte wrapper (VT, FS, CR) per spec
- MSH field parsing correctly accounts for encoding chars at position 0
- HL7 timestamp generation in correct format (YYYYMMDDHHmmss UTC)
- Multiple message type builders (ADT^A01, ORU^R01, QRY^Q01, ADT^A08)
- Resource cleanup in all handlers with try/catch/finally
- Cloudflare protection integrated in all handlers

**Concerns:**
- `parseHL7Message()` uses regex for field extraction — brittle if segment contains embedded pipes
- No validation that segments start with valid 3-char IDs
- `unwrapMLLP()` linear scan for start/end markers — inefficient for large messages
- No support for field repetition (~) or component extraction (^)
- Diagnosis field in ADT^A08 builder silently truncated if too long
- No character set encoding specification (assumes UTF-8)

## Known Limitations

1. **No Batch Support**: Each message sent individually — no FHS/BHS batch headers
2. **Single ACK**: Reads one MLLP frame then closes — multi-segment responses not collected
3. **Field Access**: Only MSH/MSA fields parsed — segment-specific parsing not implemented
4. **No Validation**: No schema validation against HL7 v2.x XSD or message profiles
5. **Encoding Limited**: Only handles basic pipe-delimited — no support for component/repetition parsing
6. **Version Hardcoded**: All messages use "2.5" — no v2.1/2.3/2.4/2.6/2.7/2.8 support
7. **No Acknowledgment Config**: Cannot disable auto-ACK or customize ACK text
8. **Segment Limits**: No enforcement of segment count limits or message size caps
9. **No Z-Segments**: Custom Z-segments (vendor extensions) not recognized
10. **Character Set**: Assumes UTF-8 — no MSH.18 character set declaration

## Verification

**Build Status:** Not verified — no test file exists
**Tests:** Not implemented
**RFC Compliance:** HL7 v2.x Standard (no formal RFC)

## See Also

- [HL7 Protocol Specification](../protocols/HL7.md) - Technical wire format reference (if exists)
- [HL7 v2.x Standard](https://www.hl7.org/implement/standards/product_brief.cfm?product_id=185) - Official HL7 v2 docs
- [MLLP Specification](https://www.hl7.org/documentcenter/public/wg/inm/mllp_transport_specification.PDF) - TCP transport framing
- [HL7 v2 Messaging](https://hl7-definition.caristix.com/v2/hl7v2.5/Messages) - Message type reference
- [Healthcare Integration](https://en.wikipedia.org/wiki/Health_Level_7) - HL7 background
