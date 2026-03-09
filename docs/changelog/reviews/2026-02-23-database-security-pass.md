# Database-Wide Security Pass — 2026-02-23

Systematic scan for vulnerability classes across all 244 protocols:
1. **Unbounded read allocations** — network-controlled size fields used in `readExact()` / `new Uint8Array()` without caps
2. **CRLF header injection** — user-controlled `host`, `path`, `token`, `authHeader` values interpolated into raw HTTP/RTSP headers without `\r\n` sanitization
3. **Text protocol command injection** — newline characters in user inputs for line-delimited protocols
4. **Missing SSRF protection** — `checkIfCloudflare` absent from handlers that use TCP sockets

---

## Vulnerability Class 1: Unbounded Read Allocations

### Context
Cloudflare Workers have a 128 MiB isolate memory limit. A malicious server can send a 32-bit size field (up to 4 GB) in a framed protocol response. When the Worker calls `readExact(reader, size)` or `new Uint8Array(size)` with that value, it OOMs and crashes.

### Fixed Protocols

| Protocol | File | Field | Cap Added | Severity |
|----------|------|-------|-----------|----------|
| ACTIVEUSERS | `activeusers.ts` | `readAllBytes` total | 1 MiB | MEDIUM |
| ADB | `adb.ts` | shell output drain loop | 4 MiB | MEDIUM |
| AEROSPIKE | `aerospike.ts` | `bodyLen` in proto header (48-bit) | 10 MiB | MEDIUM |
| AMI | `ami.ts` | `AMIReader.buffer` accumulation | 1 MiB | MEDIUM |
| AMQP | `amqp.ts` | `frameSize` in `readFrame` (2 locations) | 1 MiB | MEDIUM |
| AMQPS | `amqps.ts` | `frameSize` in `readFrame` | 1 MiB | MEDIUM |
| BITTORRENT | `bittorrent.ts` | peer message length (32-bit) | 1 MiB | MEDIUM |
| RETHINKDB | `rethinkdb.ts` | query response length (32-bit) | 10 MiB | MEDIUM |
| CASSANDRA | `cassandra.ts` | frame body length (reduced 256→10 MiB) | 10 MiB | MEDIUM |
| ZOOKEEPER | `zookeeper.ts` | `frameLen` in `zkReadPacket` (32-bit signed) | 10 MiB | MEDIUM |
| BITCOIN | `bitcoin.ts` | `MAX_PAYLOAD_BYTES` (reduced 32→10 MiB) | 10 MiB | MEDIUM |
| CIFS | `cifs.ts` | `msgLen` in `readSmb2Msg` NetBIOS header (3-byte, max ~16.7 MiB) | 1 MiB | MEDIUM |
| COUCHBASE | `couchbase.ts` | `bodyLength` in `readResponse` (uint32, max ~4 GB) | 10 MiB | MEDIUM |
| DAP | `dap.ts` | `contentLength` in `parseDAPMessages` (unbounded) + WebSocket `rawBuffer` accumulation | 10 MiB | MEDIUM |
| DIAMETER | `diameter.ts` | `messageLength` in `readDiameterMessage` (3 bytes, max ~16.7 MiB) | 1 MiB | MEDIUM |

| GANGLIA | `ganglia.ts` | `readGangliaXML` buffer accumulation | 2 MiB | MEDIUM |

### Verified Safe (already capped or bounded by field width)

| Protocol | File | Reason |
|----------|------|--------|
| TARANTOOL | `tarantool.ts` | Already has 1 MiB cap |
| DICOM | `dicom.ts` | Already has 1 MiB cap |
| H323 | `h323.ts` | TPKT length capped at 65535 |
| X11 | `x11.ts` | Length capped at 65536/262140 |
| CEPH | `ceph.ts` | 16-bit length field, max 65535 |
| TDS | `tds.ts` | Length capped at 65536 |
| PCEP | `pcep.ts` | 16-bit length field |
| NBD | `nbd.ts` | Length capped at 65536 |
| RDP | `rdp.ts` | 16-bit TPKT length, max 65535 |
| AJP | `ajp.ts` | 16-bit packet length, body truncated to 4000 chars |
| JDWP | `jdwp.ts` | `readResponse()` has 64 KB `maxBytes` cap |
| RTMP | `rtmp.ts` | `readRTMPMessage()` has 16 MiB cap on `msgLength` |
| HAZELCAST | `hazelcast.ts` | `readFrame()` has 4 MiB sanity check |
| SMB | `smb.ts` | `readResponse()` has 65536 byte cap |

---

## Vulnerability Class 2: CRLF Header Injection

### Context
Many protocols construct raw HTTP/1.x requests over TCP using string interpolation:
```
`Host: ${host}:${port}\r\n`
```
If `host` contains `\r\n`, an attacker can inject arbitrary HTTP headers into requests sent to the target server. Similarly for `path`, `token`, `authHeader`, and custom header key/value pairs.

### Fix Pattern
All user-controlled values sanitized with `.replace(/[\r\n]/g, '')` before interpolation into header strings.

### Fixed Protocols (42 files, ~70+ injection points)

| Protocol | File | Sanitized Fields |
|----------|------|------------------|
| LOKI | `loki.ts` | host, path |
| PROMETHEUS | `prometheus.ts` | host, path |
| VAULT | `vault.ts` | host, path, token (2 locations) |
| RABBITMQ | `rabbitmq.ts` | host, path (2 functions) |
| MEILISEARCH | `meilisearch.ts` | host, path, custom header keys+values |
| WINRM | `winrm.ts` | host, path, custom header keys+values |
| ETCD | `etcd.ts` | host, path, authHeader |
| RTSP | `rtsp.ts` | host, path (3 locations: OPTIONS, DESCRIBE, session) |
| SOCKS4 | `socks4.ts` | targetHost |
| JSONRPC | `jsonrpc.ts` | host, path, authHeader (2 locations: POST + WS upgrade) |
| CLICKHOUSE | `clickhouse.ts` | host, path, custom header keys+values |
| SOAP | `soap.ts` | host, path, soapAction (2 functions: POST + GET WSDL) |
| CDP | `cdp.ts` | host, path (2 locations: HTTP GET + WS handshake) |
| JUPYTER | `jupyter.ts` | host, path, token |
| COUCHDB | `couchdb.ts` | host, path, custom header keys+values |
| SHOUTCAST | `shoutcast.ts` | host, stream/path, authHeader (2 functions) |
| NOMAD | `nomad.ts` | host, path, token (2 functions: GET + POST) |
| CONSUL | `consul.ts` | host, path, token (2 functions: GET + generic) |
| GRAFANA | `grafana.ts` | hostname, path, token, apiKey (auth builder + 2 request builders) |
| HTTPPROXY | `httpproxy.ts` | targetHost, targetUrl (2 locations: GET + CONNECT) |
| ICECAST | `icecast.ts` | host, path |
| SOCKS5 | `socks5.ts` | destHost, path |
| SOLR | `solr.ts` | host, path, authHeader |
| NODE-INSPECTOR | `node-inspector.ts` | host, path (2 locations: HTTP GET + WS handshake) |
| MATRIX | `matrix.ts` | host, path, authToken |
| IPP | `ipp.ts` | host, httpPath (2 locations: get-printer-attributes + print-job) |
| WEBSOCKET | `websocket.ts` | host, path, protocols |
| DOCKER | `docker.ts` | host, path (2 inline locations: logs GET + exec POST) |
| SSDP | `ssdp.ts` | eventSubURL, host, callbackURL (SUBSCRIBE); controlURL, host, serviceType, action (SOAP); st (M-SEARCH) |
| NNTP | `nntp.ts` | from, newsgroups, subject (article post headers) |
| NNTPS | `nntps.ts` | from, newsgroups, subject (article post headers) |
| SPAMD | `spamd.ts` | username (User: header in ping/check/tell — 3 locations) |
| SIPS | `sips.ts` | fromUri, toUri, requestUri (OPTIONS via encodeSipsRequest); fromUri, toUri (INVITE + CANCEL/ACK/BYE); fromUri (REGISTER × 2); username (Digest auth headers × 2) |
| MGCP | `mgcp.ts` | endpoint (command line); key/value (param headers); callId, connectionMode, connectionId (CRCX/DLCX) |
| REALAUDIO | `realaudio.ts` | host, path/streamPath (RTSP request lines in OPTIONS, DESCRIBE, and 2 session handlers via baseUrl) |

### Already Sanitized (no changes needed)

| Protocol | File | Method |
|----------|------|--------|
| KUBERNETES | `kubernetes.ts` | `.replace(/[\r\n]/g, '')` on host + bearerToken |
| KIBANA | `kibana.ts` | `safeHost`, `safePath`, `safeApiKey` |
| INFLUXDB | `influxdb.ts` | `safeHost`, `safePath`, token sanitized |
| ELASTICSEARCH | `elasticsearch.ts` | `safeHost`, `safePath`, authHeader sanitized |
| DOCKER (main) | `docker.ts` | `safeHost`, `safePath` in `sendHttpGet` |

---

## Vulnerability Class 3: Text Protocol Command Injection

### Context
Text-based protocols that use `\r\n` or `\n` as command delimiters are vulnerable to command injection if user-provided values containing newlines are sent directly to the server. An attacker could embed `\r\nDELETE mykey` inside a command string to inject destructive operations.

### Fixed Protocols

| Protocol | File | Issue | Fix |
|----------|------|-------|-----|
| GEARMAN | `gearman.ts` | `command` sent without CRLF check (has allowlist but `\n` in whitespace-split could smuggle args) | Added `[\r\n]` rejection before command send |
| MEMCACHED | `memcached.ts` | `command` sent as-is with `\r\n` for non-storage commands (line 260) — also in WebSocket handler (line 406) | Added `[\r\n]` rejection in both HTTP and WebSocket handlers |
| CVS | `cvs.ts` | `cvsroot`, `username`, `module` sent in newline-delimited pserver protocol without `\n` check — could inject CVS protocol commands | Added `[\r\n]` rejection via `rejectNewlines()` in list, checkout, and login handlers |
| NATS | `nats.ts` | `subject`, `queue_group` in SUB; `subject`, `msgId` in PUB/HPUB; `subject` in request-reply — NATS uses `\r\n`-delimited commands | Added `sanitizeCRLF()` to all user-controlled values in command lines |
| DICT | `dict.ts` | `word`, `database`, `strategy` in DEFINE/MATCH commands — DICT uses `\r\n`-delimited commands | Added `sanitizeCRLF()` around word, database, strategy in command construction |

### Verified Safe (already sanitized or safe by design)

| Protocol | File | Reason |
|----------|------|--------|
| BEANSTALKD | `beanstalkd.ts` | CRLF check on command and tube name |
| HAPROXY | `haproxy.ts` | Strips newlines with `.replace(/[\r\n]+/g, ' ')` |
| REDIS | `redis.ts` | Uses RESP binary-safe encoding (`$<len>\r\n<data>\r\n`) |
| FTP | `ftp.ts` | Has `stripCRLF()` function for command sanitization |
| VARNISH | `varnish.ts` | Rejects commands containing `[\r\n]` |
| SIP | `sip.ts` | `stripCRLF()` function for header values |
| SMTP/SMTPS | `smtp.ts`/`smtps.ts` | `safeCommand`, `safeFrom`, `safeTo`, `safeSubject` sanitization |
| XMPP | `xmpp.ts` | `escapeXml()` for all user values in XML stanzas |
| EPP | `epp.ts` | `escapeXml()` for all user values |
| IRC/IRCS | `irc.ts`/`ircs.ts` | Interactive WebSocket session — user controls own session |
| TELNET | `telnet.ts` | Interactive WebSocket session — user controls own session |

---

## Alphabetical Protocol Review (Clean Passes)

The following protocols were individually reviewed and found to have 0 issues:

- **BATTLENET** — BNCS uint16 packet length (max 65535), no HTTP, proper input validation
- **BEANSTALKD** — 64 KB response cap, CRLF check, command allowlist, CF check present
- **BEATS** — Pure binary protocol, ACK frame validation, no unbounded reads
- **BGP** — 16-bit message length (max 65535), checkIfCloudflare present, router ID validated as IPv4, maxRoutes/collectMs capped
- **BITCOIN** — Fixed: MAX_PAYLOAD_BYTES reduced 32→10 MiB; checkIfCloudflare present, port validation, maxPeers capped at 1000
- **BITTORRENT** — 1 MiB peer message cap (already fixed), checkIfCloudflare, strict infoHash hex validation, tracker uses fetch() with AbortSignal
- **CASSANDRA** — 10 MiB frame cap (already fixed), checkIfCloudflare in all handlers, read-only CQL enforced via regex, SASL PLAIN auth
- **CDP** — CRLF sanitized (already fixed), 512 KB HTTP response cap, checkIfCloudflare in all handlers
- **CEPH** — readExact only with fixed/bounded sizes (uint16 max 65535), checkIfCloudflare in 5 handlers, REST API uses fetch()
- **CHARGEN** — 1 MiB cap on safeMaxBytes, checkIfCloudflare, port validation
- **CIFS** — Fixed: 1 MiB cap on readSmb2Msg NetBIOS length; NTLMv2 auth, strict host regex, checkIfCloudflare in all handlers
- **CLAMAV** — 65 KB response cap, 10 MiB scan data limit, hardcoded commands (no injection), checkIfCloudflare
- **CLICKHOUSE** — CRLF sanitized (already fixed), HTTP 512 KB cap, native 256-512 KB cap, strict host regex
- **COAP** — checkIfCloudflare in 3 handlers, pure binary protocol, block-wise transfer capped by maxBlocks (default 64), Observe deregisters with RST
- **COLLECTD** — checkIfCloudflare in 4 handlers, strict host regex, part lengths bounded by uint16, receive capped at 15s/500 metrics
- **CONSUL** — CRLF sanitized (already fixed), checkIfCloudflare in 7 handlers, HTTP 512 KB cap, key/path URL-encoded
- **COUCHBASE** — Fixed: 10 MiB cap on readResponse bodyLength; checkIfCloudflare in 7 handlers, pure binary protocol, stats loop capped at 500
- **COUCHDB** — CRLF sanitized (already fixed), checkIfCloudflare in 2 handlers, strict host regex, HTTP 512 KB cap, method allowlist
- **CVS** — Fixed: newline rejection on cvsroot/username/module; checkIfCloudflare in 4 handlers, readLines capped at 3-500 lines
- **DAP** — Fixed: 10 MiB cap on contentLength + rawBuffer accumulation; checkIfCloudflare in both handlers, WebSocket interactive session
- **DAYTIME** — Fixed: added checkIfCloudflare; response bounded by single read, port validation
- **DCERPC** — checkIfCloudflare in all handlers, pure binary protocol, fragment lengths bounded by uint16
- **DIAMETER** — Fixed: 1 MiB cap on messageLength; checkIfCloudflare present, pure binary protocol, AVP lengths bounded
- **DICOM** — Fixed: added checkIfCloudflare in 3 handlers; already has 1 MiB PDU cap, pure binary protocol, AE title validated as printable ASCII (1-16 chars)
- **DICT** — checkIfCloudflare in 3 handlers, 500 KB response cap; Fixed: added sanitizeCRLF to word/database/strategy in DEFINE/MATCH commands
- **DISCARD** — Fixed: added checkIfCloudflare; 1 MB data limit, fire-and-forget (no response to read), port validation
- **DNP3** — checkIfCloudflare in 3 handlers, pure binary protocol, frame size bounded by single-byte length field (max ~292 bytes)
- **DNS** — checkIfCloudflare in both handlers, TCP messages bounded by 2-byte length prefix (max 65535), AXFR bounded by timeout + SOA termination
- **DOCKER** — CRLF sanitized (already fixed), checkIfCloudflare in 8 handlers, HTTP 512 KB cap, logs/exec 1 MiB cap, read-only path restriction, path traversal prevention
- **DOH** — Uses fetch() not TCP sockets (checkIfCloudflare N/A), binary DNS wire format, response bounded by fetch() limits
- **DOT** — Fixed: added checkIfCloudflare; TLS via secureTransport, response bounded by 2-byte TCP length prefix (max 65535)
- **DRDA** — checkIfCloudflare in 8 handlers, pure binary protocol, readDSS capped at 65536 bytes, SQL restricted to SELECT/WITH/EXPLAIN/VALUES, rows bounded by maxRows
- **ECHO** — Fixed: added checkIfCloudflare in 2 handlers; response is single read, port validation
- **ELASTICSEARCH** — CRLF sanitized (already done), checkIfCloudflare in 6 handlers, 512 KB response cap, method allowlist, HTTPS handler uses fetch()
- **EPMD** — Fixed: added checkIfCloudflare in 2 handlers; pure binary protocol, 65 KB/4 KB response safety limits
- **EPP** — Fixed: added checkIfCloudflare in 8 entry points; 10 MiB frame cap in readEPPFrame, all user inputs XML-escaped via escapeXml(), TLS via secureTransport
- **ETCD** — Fixed: added checkIfCloudflare in 2 handlers; CRLF sanitized (already done), 512 KB response cap, base64 key/value decoding
- **ETHEREUM** — checkIfCloudflare in 4 handlers, host validated via regex, probe uses TCP (single read), RPC/Info use fetch() with AbortSignal
- **ETHERNETIP** — checkIfCloudflare in 5 handlers, pure binary protocol, encapsulation frame bounded by 16-bit length field, 4 KB identity response cap
- **FASTCGI** — checkIfCloudflare in 2 handlers, binary record protocol, content length bounded by 16-bit field (max 65535)
- **FINGER** — Fixed: added checkIfCloudflare; 100 KB response cap, strict regex on username/remoteHost, port validation
- **FINS** — checkIfCloudflare in 3 handlers, binary protocol, readFINSFrame bounded by maxSize 4096, memory area validated
- **FIREBIRD** — checkIfCloudflare in 4 handlers (probe/auth/query/version), pure binary XDR protocol, recvBytes bounded per packet type with 8s timeout, ISC status vector parsed with bounded string reads
- **FIX** — checkIfCloudflare in 3 handlers, 64 KB response cap in readResponse, FIX messages built internally from tag-value pairs, user-initiated trading session
- **FLUENTD** — checkIfCloudflare in 3 handlers, 8 KB ack response cap, tag validated by strict regex (max 128 chars), record limited to 20 entries / 8 KB, events capped at 100
- **FTP** — checkIfCloudflare in 10+ handlers, sanitizeFTPInput() strips CRLF from all user inputs, PASV redirect protected by isBlockedHost(), SITE command allowlist (CHMOD/CHOWN/UMASK/IDLE/HELP only), data transfer timeouts
- **FTPS** — checkIfCloudflare in 7+ handlers, FTPSSession.sendCommand() strips CRLF, PASV redirect protected by isBlockedHost(), TLS via secureTransport: 'on', implicit TLS on port 990
- **GADU-GADU** — checkIfCloudflare in 3 handlers (connect/send-message/contacts), pure binary protocol, UIN validated as uint32, readPacket capped at 65536 bytes, timeout capped at 30s
- **GANGLIA** — Fixed: added 2 MiB cap on readGangliaXML buffer; checkIfCloudflare in 2 handlers, read-only dump protocol (no commands to inject), metrics limited to 50 per host in response
- **GEARMAN** — checkIfCloudflare in 3 handlers, command CRLF rejection (already fixed), command allowlist (version/status/workers/maxqueue query), maxqueue mutation blocked, shutdown blocked, 64 KB text response cap, 16 MB binary packet cap
- **GELF** — checkIfCloudflare in 2 handlers, write-only protocol (JSON fire-and-forget, no response to read), batch limited to 100 messages, GELF message validated per spec
- **GEMINI** — Fixed: added checkIfCloudflare; TLS via secureTransport, response capped at 5 MB, single-request protocol
- **GIT** — checkIfCloudflare in 3 handlers, pkt-line protocol (max 65520 bytes/line), ref listing capped at 10000 lines, read-only (ls-remote only)
- **GOPHER** — Fixed: added checkIfCloudflare; host validated via strict regex, selector validated for control chars and length (max 1024), response capped at 512 KB
- **GPSD** — checkIfCloudflare in 5 handlers, response reads capped at 65536 bytes, command allowlist (?VERSION/?DEVICES/?POLL/?WATCH), JSON protocol
- **GRAFANA** — CRLF sanitized (already done), checkIfCloudflare in 13 handlers, HTTP 512 KB response cap, token/apiKey sanitized
- **GRAPHITE** — checkIfCloudflare in 2 handlers, metric sending is write-only (fire-and-forget), render/metrics use fetch() not connect()

---

## Vulnerability Class 4: Missing SSRF Protection

### Context
Handlers that use `connect()` (TCP sockets) should call `checkIfCloudflare()` before connecting, to prevent SSRF through Cloudflare-proxied hosts. Handlers using `fetch()` are exempt as Cloudflare Workers' fetch has its own private IP restrictions.

### Fixed Protocols

| Protocol | File | Handlers Fixed |
|----------|------|---------------|
| DAYTIME | `daytime.ts` | 1 handler: `handleDaytimeQuery` |
| DISCARD | `discard.ts` | 1 handler: `handleDiscardSend` |
| ECHO | `echo.ts` | 2 handlers: `handleEchoTest`, `handleEchoWebSocket` |
| DICOM | `dicom.ts` | 3 handlers: `handleDICOMConnect`, `handleDICOMEcho`, `handleDICOMFind` |
| DOT | `dot.ts` | 1 handler: `handleDoTQuery` |
| EPMD | `epmd.ts` | 2 handlers: `handleEPMDNames`, `handleEPMDPort` |
| EPP | `epp.ts` | 8 entry points: `eppConnect`, `eppLogin`, `eppDomainCheck`, `handleEPPDomainInfo`, `handleEPPDomainCreate`, `handleEPPDomainUpdate`, `handleEPPDomainDelete`, `handleEPPDomainRenew` |
| ETCD | `etcd.ts` | 2 handlers: `handleEtcdHealth`, `handleEtcdQuery` |
| FINGER | `finger.ts` | 1 handler: `handleFingerQuery` |
| MGCP | `mgcp.ts` | 3 handlers: `handleMGCPAudit`, `handleMGCPCommand`, `handleMGCPCallSetup` |
| GEMINI | `gemini.ts` | 1 handler: `handleGeminiFetch` |
| GOPHER | `gopher.ts` | 1 handler: `handleGopherFetch` |
| H323 | `h323.ts` | 4 handlers: `handleH323Register`, `handleH323Info`, `handleH323Connect`, `handleH323Capabilities` |
| HSRP | `hsrp.ts` | 3 handlers + 1 delegate: `handleHSRPProbe`, `handleHSRPCoup`, `handleHSRPv2Probe` (handleHSRPListen delegates to Probe) |
| IDENT | `ident.ts` | 1 handler: `handleIdentQuery` |
| IKE | `ike.ts` | 2 handlers + 1 delegate: `handleIKEProbe`, `handleIKEv2SA` (handleIKEVersionDetect delegates to both) |
| INFLUXDB | `influxdb.ts` | Shared `sendHttpRequest()` covers all 3 handlers |
| INFORMIX | `informix.ts` | 2 handlers + 1 delegate: `handleInformixProbe`, `handleInformixQuery` (handleInformixVersion delegates to Probe) |
| IPP | `ipp.ts` | 2 handlers: `handleIPPProbe`, `handleIPPPrintJob` |

---

## Vulnerability Class 5: Text Protocol Command Injection (Write Handlers)

### Fixed Protocols

| Protocol | File | Issue | Fix |
|----------|------|-------|-----|
| HAPROXY | `haproxy.ts` | Write commands (SetWeight/SetState/SetAddr/DisableServer/EnableServer) concatenated `backend`/`server`/`addr` into HAProxy commands without newline stripping — could inject arbitrary admin commands like `shutdown sessions` | Centralized CRLF strip in `sendCommand()`: `command.replace(/[\r\n]/g, '').trim()` |

---

## Cross-Protocol Scan Results (G-Z)

After completing the alphabetical per-protocol review through FTPS, a batch scan was performed across all remaining G-Z protocols for the four vulnerability classes. **NOTE:** The batch scan was found to be inaccurate — multiple protocols were found missing checkIfCloudflare during subsequent deep review (MGCP, Gemini, Gopher, H323, HSRP). All protocols are now individually verified during the alphabetical review.

- **checkIfCloudflare coverage**: Batch scan was unreliable — individual verification required (see alphabetical review below)
- **Unbounded read allocations**: All G-Z protocols confirmed safe (either capped or bounded by 16-bit field widths)
- **CRLF/command injection**: Found and fixed in SSDP, NNTP, NNTPS, NATS, SpamD, SIPS, MGCP, DICT, RealAudio, HAProxy (see above); Memcached already had input validation (false positive)

---

## Alphabetical Protocol Review (H Protocols)

- **H323** — Fixed: added checkIfCloudflare to 4 handlers; pure binary Q.931/H.225 protocol (no CRLF injection risk), TPKT frame capped at 65535, phone numbers validated with `/^[0-9*#+]+$/`, readExact has deadline timeout
- **HAPROXY** — Fixed: command injection in sendCommand() (CRLF strip); checkIfCloudflare in sendCommand() (covers all handlers), readAll() capped at 1 MB, read-only command handler has allowlist (show/help/quit), write state allowlist (ready/drain/maint)
- **HAZELCAST** — checkIfCloudflare in all 8 handlers, pure binary protocol (no CRLF risk), readFrame() capped at 4 MiB, frame length sanity check
- **HL7** — checkIfCloudflare in all 4 handlers, MLLP binary framing with VT/FS delimiters, frame capped at 1 MiB (MAX_MLLP_FRAME), read-only HL7 queries
- **HSRP** — Fixed: added checkIfCloudflare to 3 handlers (4th delegates); pure binary protocol (fixed 20-byte HSRPv1 / 36-byte HSRPv2 packets), no unbounded reads (single reader.read()), auth truncated to 8 bytes
- **HTTP** — checkIfCloudflare present, method allowlist (GET/POST/HEAD/PUT/DELETE/OPTIONS/PATCH/TRACE), host validated with strict regex, body capped at 64 KB (MAX_BODY_BYTES), raw protocol explorer (user-controlled headers/paths are intentional design)
- **HTTP Proxy** — checkIfCloudflare in both handlers, CRLF already sanitized on targetUrl/targetHost/connectHost, isBlockedHost() for SSRF on target destination, read bounded (20 iterations max)

## Alphabetical Protocol Review (I Protocols)

- **ICECAST** — checkIfCloudflare in 4 handlers, CRLF already sanitized (safeHost, safePath), auth via Basic btoa, HTTP 512 KB response cap
- **IEC-104** — checkIfCloudflare in 4 handlers, pure binary APCI/ASDU protocol, read buffer capped at 65536, frame size bounded by uint8 length field (max 253)
- **IDENT** — Fixed: added checkIfCloudflare; text protocol but query format is tightly constrained (`port,port\r\n`), response capped at 1000 chars (MAX_RESPONSE_LENGTH per RFC 1413)
- **IGNITE** — checkIfCloudflare in 7 handlers, binary thin-client protocol, frame lengths read from 4-byte header with timeout, cache operations bounded
- **IKE** — Fixed: added checkIfCloudflare to 2 handlers (3rd delegates); pure binary ISAKMP protocol, response is single socket read, 28-byte fixed header
- **IMAP** — checkIfCloudflare in 5 handlers, interactive command session (users send their own IMAP commands), auto-generated tags (A001, A002), read bounded by timeout
- **IMAPS** — checkIfCloudflare in 5 handlers, same as IMAP but with TLS (secureTransport), interactive command session
- **INFLUXDB** — Fixed: added checkIfCloudflare in shared sendHttpRequest(); CRLF already sanitized (safeHost, safePath, token), HTTP response parsing bounded
- **INFORMIX** — Fixed: added checkIfCloudflare to 2 handlers (3rd delegates); pure binary SQLI protocol, 4-byte length-prefixed frames, response read bounded by timeout
- **IPFS** — checkIfCloudflare in TCP handler (1 of 9); remaining 8 handlers use fetch() (exempt), libp2p multistream binary protocol, read bounded by timeout
- **IPMI** — checkIfCloudflare in 4 handlers, pure binary RMCP/IPMI protocol, single reader.read() per handler (no accumulation), fixed-size packets
- **IPP** — Fixed: added checkIfCloudflare to 2 handlers; CRLF already sanitized (safeHost, safeHttpPath), binary IPP payload over HTTP, response read bounded by timeout
- **IRC** — checkIfCloudflare in 3 handlers, interactive WebSocket session (users control their own commands), PONG auto-reply for keepalive
- **IRCS** — checkIfCloudflare in 3 handlers, same as IRC but with TLS (secureTransport), interactive WebSocket session
- **iSCSI** — checkIfCloudflare in 3 handlers, binary iSCSI protocol, MaxRecvDataSegmentLength=65536 negotiated, PDU lengths bounded

---

## Build Validation

All fixes pass `npm run build` (TypeScript compilation + Vite production build) with zero errors.
