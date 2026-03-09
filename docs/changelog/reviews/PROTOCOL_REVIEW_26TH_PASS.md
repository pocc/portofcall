# Protocol Review — 26th Pass

**Date:** 2026-02-23
**Range:** fluentd.ts → zookeeper.ts (full completion of all remaining protocols)
**Reviewer:** Automated review with manual verification

## Summary

This pass focused on the following recurring bug patterns identified across all files:
- Missing `typeof port !== 'number' || isNaN(port)` before port range checks
- Unbounded response accumulation (soft cap → hard cap)
- CRLF injection via unsanitized user input in raw TCP strings
- Uncleaned timeout handles
- Single `reader.read()` without accumulation loop on fragmented TCP

## Files Reviewed & Fixed

### fluentd.ts ✓
- **Fixed:** Added tag validation in `handleFluentdBulk` — missing validation that was present in other handlers.

### ftp.ts ✓
- **Fixed:** Added 64 KiB hard limit in `readResponse()` to prevent unbounded accumulation.
- **Fixed:** Added 10 MiB hard limit in `download()` to prevent unbounded download accumulation.

### ftps.ts ✓
- No issues found.

### gadugadu.ts ✓
- **Fixed:** Added port validation (`typeof port !== 'number' || isNaN(port)`) in `handleGaduGaduSendMessage`.
- **Fixed:** Added port validation in `handleGaduGaduContacts`.

### ganglia.ts ✓
- No issues found.

### gearman.ts ✓
- No issues found.

### gelf.ts ✓
- **Fixed:** Added `success: false` to validation error responses (were inconsistently missing).
- **Fixed:** Added `typeof port !== 'number'` to port validation.

### gemini.ts ✓
- **Fixed:** Port parsing in `parseGeminiUrl` now returns null on NaN/out-of-range port.

### git.ts ✓
- **Fixed:** Port validation: added `typeof port !== 'number' || isNaN(port)` check.
- **Fixed:** Lock releases in finally block now use try/catch wrappers.

### gopher.ts ✓
- **Fixed:** Added query parameter control character validation to prevent CRLF injection.

### gpsd.ts ✓
- **Fixed:** Off-by-one in `readLines` maxBytes check — now checks AFTER adding chunk.

### grafana.ts ✓
- No issues found.

### graphite.ts ✓
- No issues found.

### h323.ts ✓
- No issues found.

### haproxy.ts ✓
- **Fixed:** All port validations updated with `typeof port !== 'number' || isNaN(port)` check.

### hazelcast.ts ✓
- **Fixed:** All port validations updated with typeof/isNaN checks.

### hl7.ts ✓
- **Fixed:** All 4 port validations updated with typeof/isNaN checks.
- **Fixed:** All 3 MLLP read loops now use per-read timeout with deadline tracking.
- **Fixed:** Size check moved to BEFORE push (`totalLength + value.length > MAX_MLLP_FRAME`).

### hsrp.ts ✓
- **Fixed:** All port validations updated with typeof/isNaN checks.

### http.ts ✓
- **Fixed:** `validateInput` now checks `typeof port !== 'number' || isNaN(port)`.
- **Fixed:** CRLF sanitization added to header keys and values in request assembly.

### httpproxy.ts ✓
- **Fixed:** URL parse failure now returns 400 error instead of silently defaulting to `example.com`.
- **Fixed:** Port and targetPort validations updated with typeof/isNaN checks.

### icecast.ts ✓
- **Fixed:** All port validations updated with typeof/isNaN checks.

### ident.ts ✓
- No issues found.

### iec104.ts ✓
- **Fixed:** All port validations updated with typeof/isNaN checks.

### ignite.ts ✓
- **Fixed:** All port validations updated with typeof/isNaN checks.

### ike.ts ✓
- **Fixed:** Port validation at all 3 call sites updated with `typeof port !== 'number' || isNaN(port)`.
- **Fixed:** IKEv2 transform payload bounds check — malformed `tLen < 8` now breaks instead of using fallback.

### imap.ts ✓
- **Fixed:** CRLF injection in `imapQuote()` — added rejection of `\r`, `\n`, `\x00` bytes.
- **Fixed:** Unbounded accumulation in `readIMAPResponse()` — added 1 MiB hard limit.

### imaps.ts ✓
- **Fixed:** Timeout handle leak in `readIMAPResponse()` — timeout now cleared in finally block.
- **Fixed:** NUL byte validation added to `quoteIMAPString()`.
- **Fixed:** Unbounded greeting accumulation — added 8 KiB max limit.

### influxdb.ts ✓
- **Fixed:** Response accumulation changed to hard cap (pre-chunk check).
- **Fixed:** Chunked encoding decoder rejects `chunkSize <= 0` and adds bounds check.

### informix.ts ✓
- **Fixed:** Port validation updated with typeof/isNaN check.

### ipfs.ts ✓
- **Fixed:** Port validation updated with typeof/isNaN check.

### ipmi.ts ✓
- **Fixed:** Added `success: false` to error response missing it.

### ipp.ts ✓
- **Fixed:** Port validation updated with typeof/isNaN check.

### irc.ts ✓
- **Fixed:** CRLF injection — all IRC command inputs (nick, username, realname, password) sanitized before use.
- **Fixed:** Port validation updated with typeof/isNaN checks.
- **Fixed:** Added `success: false` to 4 error responses that were missing it.

### ircs.ts ✓
- **Fixed:** Same fixes as irc.ts (CRLF injection sanitization, port validation, success field).

### iscsi.ts ✓
- **Fixed:** Port validation updated with typeof/isNaN check.
- **Fixed:** Data length field capped at 65536 bytes to prevent massive allocations.

### jabber-component.ts ✓
- **Fixed:** Port validation updated with typeof/isNaN checks at all 4 handler sites.
- **Fixed:** `readWithDeadline` accumulation cap reduced to 100 KiB (was 5 MiB).

### jdwp.ts ✓
- **Fixed:** Port validation updated with typeof/isNaN checks.
- **Fixed:** `readJDWPString()` now rejects strings larger than 10 MiB to prevent OOM.

### jetdirect.ts ✓
- **Fixed:** Port validation updated with typeof/isNaN checks.

### jsonrpc.ts ✓
- **Fixed:** Port validation updated with typeof/isNaN checks at all 3 endpoints.
- **Fixed:** Socket resource leak in `sendHttpPost()` — socket now closed in finally block.
- **Fixed:** Response accumulation changed to hard cap (pre-chunk check).

### jupyter.ts ✓
- **Fixed:** Port validation updated with typeof/isNaN checks at all 7 endpoints.
- **Fixed:** Socket resource leak in `sendHttpRequest()` — socket now closed in finally block.
- **Fixed:** CRLF injection in HTTP method parameter — sanitized with `safeMethod`.
- **Fixed:** Response accumulation changed to hard cap (pre-chunk check).

### kafka.ts ✓
- No issues found (already uses `!Number.isInteger(port)` which is equivalent).

### kerberos.ts ✓
- **Fixed:** Port validation updated with typeof/isNaN checks.
- **Fixed:** `sendKerberosRequest()` single `reader.read()` replaced with multi-chunk accumulation loop.

### kibana.ts ✓
- **Fixed:** Port validation updated with typeof/isNaN checks.
- **Fixed:** Response accumulation changed to hard cap (pre-chunk check) at both accumulation sites.

### kubernetes.ts ✓
- **Fixed:** Port validation in `validateInput()` updated with typeof/isNaN check.
- **Fixed:** `readHTTPResponse()` now enforces a 10 MiB maximum response size.

### l2tp.ts through ldp.ts ✓
- No issues found.

### livestatus.ts ✓
- No issues found (uses `BufferedReader.readExact()` pattern, inherently bounded).

### llmnr.ts, lmtp.ts, loki.ts ✓
- **loki.ts Fixed:** Response accumulation changed to hard cap (pre-chunk check).

### lpd.ts, lsp.ts ✓
- No issues found.

### managesieve.ts ✓
- No issues found.

### matrix.ts ✓
- **Fixed:** Response accumulation changed to hard cap (pre-chunk check).

### maxdb.ts, mdns.ts ✓
- No issues found.

### meilisearch.ts ✓
- **Fixed:** Response accumulation changed to hard cap (pre-chunk check).

### memcached.ts ✓
- **Fixed:** Added `success: false` to 4 error responses that were missing it.

### mgcp.ts, minecraft.ts ✓
- No issues found.

### mms.ts ✓
- **Fixed:** Added bounds check for TPKT packet length > 65535.

### modbus.ts, mongodb.ts, mpd.ts, mqtt.ts ✓
- No issues found.

### msn.ts ✓
- No issues found (success:false already present).

### msrp.ts, mumble.ts, munin.ts, mysql.ts ✓
- No issues found.

### napster.ts, nats.ts, nbd.ts, neo4j.ts, netbios.ts, nfs.ts ✓
- No issues found.

### ninep.ts ✓
- **Fixed:** `read9PMessage()` now rejects messages > 65600 bytes before allocation.

### nntp.ts ✓
- **Fixed:** `readLine()` now rejects lines > 10000 chars before accumulation.

### nntps.ts ✓
- **Fixed:** Same `readLine()` fix as nntp.ts.

### node-inspector.ts ✓
- **Fixed:** WebSocket `frameBuffer` accumulation now capped at 10 MiB hard limit.
- **Fixed:** Response accumulation changed to hard cap.

### nomad.ts ✓
- **Fixed:** Both response accumulation loops changed to hard cap.

### nrpe.ts, nsca.ts, nsq.ts, ntp.ts ✓
- No issues found.

### opcua.ts ✓
- **Fixed:** `readOPCUAResponse()` buffer now throws when exceeding 1 MiB.

### openflow.ts ✓
- **Fixed:** `readMessage()` now rejects buffers > 1 MiB before accumulation.

### opentsdb.ts ✓
- **Fixed:** CRLF injection in `suggest` query — added `.replace(/[\r\n]/g, '')`.
- **Fixed:** CRLF injection in `put` metric name and tag values — sanitized.

### openvpn.ts ✓
- **Fixed:** Moved 4096-byte response cap to pre-accumulation check.
- **Fixed:** Moved 65536-byte packet cap to pre-accumulation check in `readPacket`.

### oracle.ts ✓
- **Fixed:** Single `reader.read()` replaced with multi-chunk accumulation loop (handles fragmented TCP).

### oracle-tns.ts ✓
- **Fixed:** `BufferedReader` internal buffer now checked before merge (128 KiB hard cap).

### oscar.ts ✓
- **Fixed:** `readFLAP()` now rejects packets > 1 MiB before accumulation.

### pcep.ts through rdp.ts ✓
- No issues found (all use exact-read patterns or have proper bounds).

### realaudio.ts, redis.ts ✓
- No issues found.

### relp.ts through rsync.ts ✓
- No issues found.

### rtmp.ts, rtsp.ts, s7comm.ts, sane.ts, sccp.ts, scp.ts, sentinel.ts, sftp.ts ✓
- No issues found.

### shadowsocks.ts, shoutcast.ts, sip.ts, sips.ts, slp.ts, smb.ts, smpp.ts ✓
- No issues found.

### smtp.ts, smtps.ts, snmp.ts, snpp.ts ✓
- No issues found.

### soap.ts ✓
- **Fixed:** Both response accumulation loops changed to hard cap.

### socks4.ts, socks5.ts ✓
- No issues found.

### solr.ts ✓
- **Fixed:** Response accumulation changed to hard cap.

### sonic.ts, spamd.ts, spdy.ts, spice.ts, ssdp.ts, ssh.ts ✓
- No issues found.

### stomp.ts ✓
- **Fixed:** Response accumulation now checks size before pushing chunk (hard cap).

### stun.ts, submission.ts, svn.ts, sybase.ts, syslog.ts ✓
- No issues found.

### tacacs.ts, tarantool.ts, tcp.ts, tds.ts, teamspeak.ts ✓
- No issues found.

### telnet.ts ✓
- **Fixed:** Single `reader.read()` for banner replaced with multi-chunk accumulation loop (3s deadline, 4096 byte cap).

### tftp.ts, thrift.ts, time.ts, torcontrol.ts, turn.ts ✓
- No issues found.

### uucp.ts, uwsgi.ts ✓
- No issues found.

### varnish.ts ✓
- No issues found.

### vault.ts ✓
- **Fixed:** Response accumulation changed to hard cap.

### ventrilo.ts, vnc.ts, websocket.ts, whois.ts, winrm.ts ✓
- No issues found.

### x11.ts, xmpp.ts, xmpp-s2s.ts, xmpps2s.ts, ymsg.ts ✓
- No issues found.

### zabbix.ts, zmtp.ts, zookeeper.ts ✓
- No issues found.

### Bulk fixes (all 173 remaining files with port validation)
- **Fixed:** Applied `typeof port !== 'number' || isNaN(port)` check to 173 protocol handler files that were missing it.

### Bulk fixes (soft-cap accumulation)
- **Fixed:** Applied hard-cap pre-check pattern to: cdp.ts, clickhouse.ts, consul.ts, couchdb.ts, docker.ts, elasticsearch.ts, etcd.ts, prometheus.ts, rabbitmq.ts (2 loops), soap.ts (2 loops), solr.ts, vault.ts.

---

## Patterns Fixed (Summary)

| Pattern | Files Fixed | Impact |
|---------|-------------|--------|
| Missing `typeof port !== 'number' \|\| isNaN(port)` | 30+ files | Prevents NaN/string ports bypassing validation |
| Soft cap → hard cap response accumulation | influxdb, imap, kibana, kubernetes, jsonrpc, jupyter, loki, matrix, meilisearch, nomad, openvpn, oracle-tns, oscar, opcua, openflow, prometheus, rabbitmq, soap, solr, vault, cdp, clickhouse, consul, couchdb, docker, elasticsearch, etcd, stomp | Prevents OOM from malicious servers |
| CRLF injection in user input | http, gopher, irc, ircs, imap, imaps, jupyter, opentsdb | Prevents header/command injection |
| Single `reader.read()` → accumulation loop | kerberos, hl7, oracle, telnet | Handles fragmented TCP responses correctly |
| Missing `success: false` in error responses | gelf, ipmi, irc, ircs | API response consistency |
| Uncleaned timeout handles | imaps | Prevents timer accumulation under load |
| Unclosed sockets on error paths | jsonrpc, jupyter | Resource leak prevention |
| Bounds checks on protocol field lengths | jdwp, iscsi, ike, ninep, nntp, nntps, node-inspector, mms, oscar, opcua, openflow, oracle-tns | OOM/overflow prevention |
| Missing `typeof port !== 'number' \|\| isNaN(port)` | 173 additional files (bulk) | Prevents NaN/string ports bypassing validation |
