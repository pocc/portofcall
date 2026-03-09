# E Protocols Review — 2026-02-24

All 7 E protocols verified. No new findings.

## Results

| Protocol | Status | Notes |
|----------|--------|-------|
| ECHO | ✅ Clean | checkIfCloudflare ×3 (2 handlers + 1 WS), single-read response |
| ELASTICSEARCH | ✅ Clean | checkIfCloudflare ×7, CRLF sanitized (`safeHost`/`safePath`/authHeader), 512 KB response cap, method allowlist |
| EPMD | ✅ Clean | checkIfCloudflare ×3, pure binary, 65 KB/4 KB response caps |
| EPP | ✅ Clean | checkIfCloudflare ×9, `escapeXml()` applied to all user values in XML stanzas, 10 MiB frame cap in `readEPPFrame`, TLS via secureTransport |
| ETCD | ✅ Clean | checkIfCloudflare ×3, CRLF sanitized, 512 KB response cap, base64 key/value decoding |
| ETHEREUM | ✅ Clean | checkIfCloudflare ×5, probe uses single `reader.read()` (Ethereum handshake is small), RPC/Info use `fetch()` with AbortSignal |
| ETHERNETIP | ✅ Clean | checkIfCloudflare ×6, pure binary, encapsulation frame bounded by 16-bit length field, 4 KB identity response cap |
