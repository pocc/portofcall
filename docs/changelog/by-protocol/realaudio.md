# RealAudio Review

**Protocol:** RealAudio
**File:** `src/worker/realaudio.ts`
**Reviewed:** 2026-02-18

## Summary

RealAudio/RealMedia is a legacy streaming protocol from the 1990s-2000s, developed by RealNetworks (formerly Progressive Networks). Uses RTSP for session control and RDT (Real Data Transport) or RTP for media delivery on ports 7070 (default), 554 (alternative), 6970-7170 (RTP/RDT data). The implementation provides four endpoints: `/api/realaudio/probe` (OPTIONS), `/api/realaudio/describe` (DESCRIBE), `/api/realaudio/setup` (OPTIONS→DESCRIBE→SETUP), and `/api/realaudio/session` (full session with PLAY and interleaved RTP frame collection). Modern status: discontinued in 2018, rarely used, superseded by HLS/DASH/WebRTC.

## Bugs Found and Fixed

No critical or medium severity bugs found during review. Minor improvements and documentation updates applied.

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/REALAUDIO.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
