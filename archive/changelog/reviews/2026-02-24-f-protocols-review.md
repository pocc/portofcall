# F Protocols Review — 2026-02-24

All 8 F protocols verified. No new findings.

## Results

| Protocol | Status | Notes |
|----------|--------|-------|
| FASTCGI | ✅ Clean | checkIfCloudflare ×2, 5 MiB MAX_FASTCGI_RESPONSE_BYTES cap, binary protocol |
| FINGER | ✅ Clean | checkIfCloudflare ×1, 100 KB maxResponseSize, query validation regex |
| FINS | ✅ Clean | checkIfCloudflare ×3, readFINSFrame 4096 max, binary protocol, memory area allowlist |
| FIREBIRD | ✅ Clean | checkIfCloudflare ×3, binary Firebird wire protocol, recvBytes with timeout |
| FIX | ✅ Clean | checkIfCloudflare ×3, 64 KB readResponse cap, FIX checksum correct |
| FLUENTD | ✅ Clean | checkIfCloudflare ×3, 8192 byte read cap, MessagePack binary, tag regex, 8 KB record limit, 100 event bulk cap |
| FTP | ⏭️ Skipped | 13+ previous review passes — skip per guidelines |
| FTPS | ⏭️ Skipped | Previously reviewed — skip per guidelines |
