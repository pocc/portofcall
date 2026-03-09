# I Protocols Review — 2026-02-24

All 15 I protocols verified. No new findings.

## Results

| Protocol | Status | Notes |
|----------|--------|-------|
| ICECAST | ✅ Clean | checkIfCloudflare ×3 (status, source, admin), CRLF stripped on host/path in httpRequest, 64 KB read cap, chunked encoding decoded, burstBytes capped at 1024 |
| IDENT | ✅ Clean | checkIfCloudflare ×1, RFC 1413 1000-char max enforced, port validation via isValidPort(), CRLF-terminated line reader with 1100-byte safety cap |
| IEC104 | ✅ Clean | checkIfCloudflare ×3 (probe, read-data, write), binary APCI frame parser with bounds checks, 500 ASDU collection cap, S-frame acknowledgment, STOPDT clean disconnect |
| IGNITE | ✅ Clean | checkIfCloudflare ×6 (connect, probe, list-caches, cache-get, cache-put, cache-remove), 1 MB response length sanity cap, proper handshake version negotiation, finally blocks for cleanup |
| IKE | ✅ Clean | checkIfCloudflare ×3 (probe, v2, version-detect), CSPRNG for cookies/SPI/nonce, 64 KB response cap, 256 payload iteration limit, proper ISAKMP/IKEv2 binary parsing |
| IMAP | ✅ Clean | checkIfCloudflare ×3 (connect, list, select), imapQuote() rejects CR/LF/NUL and escapes backslash/quote per RFC 3501, 1 MB response cap, WebSocket session uses credential-first auth message |
| IMAPS | ✅ Clean | checkIfCloudflare ×3 (connect, list, select) + session, secureTransport:'on', quoteIMAPString rejects CR/LF/NUL, streaming TextDecoder, hasTaggedResponse line-anchored regex, command queue serialization |
| INFLUXDB | ✅ Clean | checkIfCloudflare in shared sendHttpRequest (covers all 3 handlers), CRLF stripped on path/host/token, 512 KB response cap, chunked encoding decoded, Content-Length uses byte length |
| INFORMIX | ✅ Clean | checkIfCloudflare ×2 (probe, query), binary SQLI protocol with 4-byte BE length framing, single-chunk read (SQLI is request-response), 10 chunk collection cap for query results |
| IPFS | ✅ Clean | checkIfCloudflare ×1 (probe), host regex validation, varint encoding/decoding with 35-bit overflow guard, HTTP API handlers use fetch() with AbortSignal.timeout |
| IPMI | ✅ Clean | checkIfCloudflare ×3 (connect, auth-caps, device-id), binary RMCP/IPMI packet construction with correct checksums, proper IANA validation in pong parser, known manufacturer ID lookup |
| IPP | ✅ Clean | checkIfCloudflare ×2 (probe, print-job), CRLF stripped on host/path, binary IPP attribute parser handles multi-valued attrs per RFC 8010 §3.1.3, 64 KB response cap, 50 attribute display limit |
| IRC | ✅ Clean | checkIfCloudflare ×2 (connect, websocket), nickname validated via regex, CRLF stripped from nick/username/realname/password, IRCv3 tag escaping, SASL PLAIN auth, WebSocket credential-first pattern |
| IRCS | ✅ Clean | checkIfCloudflare ×2 (connect, websocket), secureTransport:'on', same CRLF/nickname/SASL protections as IRC, credential-first WebSocket pattern |
| ISCSI | ✅ Clean | checkIfCloudflare ×2 (discover, login), binary iSCSI PDU construction with correct BHS layout, CHAP MD5 auth with pure-JS md5, readISCSIPDU accumulates until complete frame, 64 KB data segment cap |
