# DICOM Review

**Protocol:** DICOM
**File:** `src/worker/dicom.ts`
**Reviewed:** 2026-02-18

## Summary

`docs/protocols/DICOM.md` was a planning artifact titled "DICOM Protocol Implementation Plan." It contained a 488-line fictional `DICOMClient` class (with `connect()`, `echo()`, `find()`, `store()`, `sendPData()`, `receivePDU()`, etc.), a React `DICOMClient` component, and fictional TypeScript interfaces/enums (`PDUType`, `DIMSECommand`, `TransferSyntax`, `SOPClass`) — none of which exist in the actual Cloudflare Worker. The real 3 endpoints and their precise behaviors were entirely absent. Replaced the planning doc with an accurate power-user reference covering all 3 endpoints. Key findings: 1. **`success:true` on association rejection in `/connect`** — `/connect` returns HTTP 200 with `success:true` even when the server sends A-ASSOCIATE-RJ, with `associationAccepted:false` and decoded rejection fields. `/echo` and `/find` return `success:false` + HTTP 502 on association failure.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Medium | Fixed VR (Value Representation) parsing to handle both explicit and implicit VR transfer syntaxes; added 4-byte length VRs (OB, OW, OF, SQ, UC, UN, UR, UT) |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/DICOM.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
