# G Protocols Review — 2026-02-24

All 10 G protocols verified. No new findings.

## Results

| Protocol | Status | Notes |
|----------|--------|-------|
| GADUGADU | ✅ Clean | checkIfCloudflare ×3, binary GG protocol with imported utils |
| GANGLIA | ✅ Clean | checkIfCloudflare ×2, 2 MiB MAX_XML_SIZE, 50 metrics/host cap |
| GEARMAN | ✅ Clean | checkIfCloudflare ×3, 64 KB text cap, 16 MB binary cap, command allowlist, CRLF rejection |
| GELF | ✅ Clean | checkIfCloudflare ×2, 100 message batch limit, 256 KB/message |
| GEMINI | ✅ Clean | checkIfCloudflare ×1, 5 MB maxResponseSize, TLS via secureTransport |
| GIT | ✅ Clean | checkIfCloudflare ×2, 10 MB buffer cap, 10K pkt-line max, 4 MB pack cap, path traversal check |
| GOPHER | ✅ Clean | checkIfCloudflare ×1, 512 KB maxResponseSize, control char validation |
| GPSD | ✅ Clean | checkIfCloudflare ×4, 65536 byte read cap, '?' prefix required, CRLF/null stripped, 30s watch max |
| GRAFANA | ✅ Clean | checkIfCloudflare ×11+, 10 MB response cap, CRLF sanitized on hostname/path/auth, chunked decode with 10 MB cap |
| GRAPHITE | ✅ Clean | checkIfCloudflare ×1 (send), metric name regex, 100 batch cap, HTTP endpoints use fetch() |
