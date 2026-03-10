# H Protocols Review — 2026-02-24

All 7 H protocols verified. No new findings.

## Results

| Protocol | Status | Notes |
|----------|--------|-------|
| H323 | ✅ Clean | checkIfCloudflare ×4 (register, info, connect, capabilities), TPKT 65535 byte frame cap, phone regex validation, binary Q.931 protocol |
| HAPROXY | ✅ Clean | checkIfCloudflare in sendCommand (shared by all 7 handlers), CRLF stripped, 1 MB readAll cap, read-only command allowlist, state allowlist for write endpoints |
| HAZELCAST | ✅ Clean | checkIfCloudflare in all 8 handlers, 4 MB frame sanity cap, binary Hazelcast open protocol v2 |
| HL7 | ✅ Clean | checkIfCloudflare ×4 (connect, send, query, ADT_A08), 1 MB MAX_MLLP_FRAME cap in all read loops, rawMessage size validation |
| HSRP | ✅ Clean | checkIfCloudflare ×3 (probe, coup, v2-probe), binary protocol with fixed-size 20/36 byte packets, single-read responses |
| HTTP | ✅ Clean | checkIfCloudflare ×1 (shared by request/head/options), host regex, CRLF rejection on all headers, 64 KiB body cap, method allowlist |
| HTTPPROXY | ✅ Clean | checkIfCloudflare ×2 (probe, connect), isBlockedHost on target, CRLF sanitized on targetUrl/targetHost/proxyAuth, 1 MiB response cap |
