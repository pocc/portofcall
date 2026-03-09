# C Protocols Review — 2026-02-24

All 13 C protocols verified. No new findings beyond the database security pass (2026-02-23).

## Results

| Protocol | Status | Notes |
|----------|--------|-------|
| CASSANDRA | ✅ Clean | checkIfCloudflare ×4, 10 MiB frame cap, read-only CQL regex `/^\s*(SELECT|DESCRIBE|USE|SHOW)\b/i` is sufficient (Cassandra doesn't allow multi-statement in a single QUERY frame) |
| CDP | ✅ Clean | checkIfCloudflare ×4, CRLF sanitized, 512 KB response cap |
| CEPH | ✅ Clean | checkIfCloudflare ×7, binary protocol uses `readExact` with bounded sizes, REST handlers use `fetch()` |
| CHARGEN | ✅ Clean | checkIfCloudflare ×2, 1 MiB cap on safeMaxBytes |
| CIFS | ✅ Clean | checkIfCloudflare ×7, `readSmb2Msg` 1 MiB cap, correct NetBIOS header parsing, NTLMv2 auth |
| CLAMAV | ✅ Clean | checkIfCloudflare ×5, 65 KB response cap, 10 MiB scan data limit, hardcoded commands |
| CLICKHOUSE | ✅ Clean | checkIfCloudflare ×4, CRLF sanitized, HTTP 512 KB cap, native protocol 256–512 KB caps |
| COAP | ✅ Clean | checkIfCloudflare ×4, `maxBlocks` caps block-wise transfer (default 64), `szx` clamped to 0–6 |
| COLLECTD | ✅ Clean | checkIfCloudflare ×5, part lengths bounded by uint16, 15s/500-metrics receive cap |
| CONSUL | ✅ Clean | checkIfCloudflare ×9, CRLF sanitized, 512 KB response cap, key/path URL-encoded |
| COUCHBASE | ✅ Clean | checkIfCloudflare ×8, 10 MiB cap on readResponse bodyLength, stats loop capped at 500 |
| COUCHDB | ✅ Clean | checkIfCloudflare ×3, CRLF sanitized (`safeHost`/`safePath`), method allowlist |
| CVS | ✅ Clean | checkIfCloudflare ×5, newline rejection on cvsroot/username/module, readLines capped |
