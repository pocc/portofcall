# J-K Protocols Review — 2026-02-24

All 9 J-K protocols verified. No new findings.

## Results

| Protocol | Status | Notes |
|----------|--------|-------|
| JABBER-COMPONENT | ✅ Clean | checkIfCloudflare ×4 (probe, handshake, send, roster), xmlEscape() on all user strings in XML stanzas, SHA-1 handshake via crypto.subtle, readWithDeadline 100KB cap |
| JDWP | ✅ Clean | checkIfCloudflare ×3 (probe, version, threads), 10 MB string length rejection in readJDWPString, 64 KB response cap, read-only JVM operations (Version, IDSizes, AllThreads, ThreadReference.Name) |
| JETDIRECT | ✅ Clean | checkIfCloudflare ×2 (connect, print), 16 KB read cap (connect), 4 KB cap (print response), PJL query commands are read-only, streaming TextDecoder |
| JSONRPC | ✅ Clean | checkIfCloudflare in shared sendHttpPost (covers call, batch) + WS handler, CRLF stripped on path/host/auth, 512 KB response cap, WebSocket frames masked with CSPRNG, method allowlist via JSON serialization |
| JUPYTER | ✅ Clean | checkIfCloudflare in sendHttpRequest (covers health/query) + ×5 fetch-based handlers, CRLF stripped on host/path/method/token, 512 KB response cap, HTTP method allowlist, encodeContentsPath for safe URL encoding |
| KAFKA | ✅ Clean | checkIfCloudflare ×6 (api-versions, metadata, produce, fetch, groups, group-describe, offsets), 100 MB response size guard, 10000 array length limits on all parsed arrays, proper binary Kafka protocol encoding |
| KERBEROS | ✅ Clean | checkIfCloudflare ×1, ASN.1 DER encoding for AS-REQ, TCP 4-byte length framing, binary protocol probe only (no auth credentials sent) |
| KIBANA | ✅ Clean | checkIfCloudflare in shared sendHttpGet (covers status handler), CRLF stripped on path/host, 512 KB response cap, read-only GET requests |
| KUBERNETES | ✅ Clean | checkIfCloudflare via validateInput + dedicated checks, host regex validation, TLS via secureTransport:'on', CRLF stripped on bearer token, cluster-scoped vs namespaced kind routing |
