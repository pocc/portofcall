# D Protocols Review — 2026-02-24

All 13 D protocols verified. No new findings.

## Results

| Protocol | Status | Notes |
|----------|--------|-------|
| DAP | ✅ Clean | checkIfCloudflare ×3, 10 MiB cap on `contentLength` in `parseDAPMessages` and `rawBuffer` in WS handler |
| DAYTIME | ✅ Clean | checkIfCloudflare ×2, single-read response, bounded by port validation |
| DCERPC | ✅ Clean | checkIfCloudflare ×4, pure binary, fragment lengths bounded by uint16 |
| DIAMETER | ✅ Clean | checkIfCloudflare ×6, 1 MiB cap on `messageLength`, binary AVP parsing with bounds guards |
| DICOM | ✅ Clean | checkIfCloudflare ×4, 1 MiB PDU cap, AE title validated as printable ASCII |
| DICT | ✅ Clean | checkIfCloudflare ×4, CRLF sanitized, 500 KB response cap |
| DISCARD | ✅ Clean | checkIfCloudflare ×2, write-only (no response to read), 1 MB data limit |
| DNP3 | ✅ Clean | checkIfCloudflare ×4, pure binary, frame size bounded by single-byte length field (max ~292 bytes) |
| DNS | ✅ Clean | checkIfCloudflare ×3, TCP messages bounded by 2-byte length prefix (max 65535) |
| DOCKER | ✅ Clean | checkIfCloudflare ×8 (all handlers verified), CRLF sanitized, read-only path restriction, `handleDockerExec` CF guard confirmed before `connect()` at line 1122 |
| DOH | ✅ Clean | Uses `fetch()` not TCP sockets — SSRF N/A; binary DNS wire format |
| DOT | ✅ Clean | checkIfCloudflare ×2, TLS via secureTransport, 2-byte length prefix |
| DRDA | ✅ Clean | checkIfCloudflare ×8, `/query` restricted to SELECT/WITH/EXPLAIN/VALUES, `/execute` is intentional DML endpoint, rows bounded by maxRows |
