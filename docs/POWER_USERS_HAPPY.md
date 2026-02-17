# Port of Call — Power User Happiness Assessment

A candid evaluation of each protocol implementation from the perspective of someone who uses that protocol professionally day-to-day. Ratings reflect how much real work you can accomplish versus a native client.

## Rating Scale

| Rating | Meaning |
|--------|---------|
| ★★★★★ | **Excellent** — Covers primary use cases; a power user can accomplish real work |
| ★★★★☆ | **Good** — Handles common operations; a few key features missing |
| ★★★☆☆ | **Partial** — Useful for discovery/diagnostics; missing core operations |
| ★★☆☆☆ | **Detection only** — Handshake or version fingerprinting; cannot do real work |
| ★☆☆☆☆ | **Port probe** — Minimal implementation; little practical value |

## Summary

- **Total protocols:** 236
- ★★★★★ Excellent: 45
- ★★★★☆ Good: 103
- ★★★☆☆ Partial: 56
- ★★☆☆☆ Detection: 24
- ★☆☆☆☆ Probe: 8

## Full Assessment Table

| Protocol | Port | Description | Rating | Power User Notes |
|----------|------|-------------|--------|-----------------|
| ActiveMQ | 61616 | Apache ActiveMQ message broker (OpenWire protocol) | ★★☆☆☆ | Parses WireFormatInfo and BrokerInfo — version + capability detection. No message send/receive. |
| Active Users | 11 | RFC 866 — reports current active user count | ★★★☆☆ | Complete: connect and read user count. That's all the protocol does. |
| ADB | 5037 | Android Debug Bridge — Android device management | ★★★★☆ | host:version, host:devices-l, and arbitrary host: commands — covers the primary ADB server use cases. |
| Aerospike | 3000 | Aerospike distributed NoSQL database | ★★★★☆ | Full Info protocol: build, status, namespaces, stats, sets/bins/indexes. No KV data-plane operations. |
| AFP | 548 | Apple Filing Protocol — macOS file sharing | ★★☆☆☆ | DSIGetStatus gives server name, AFP versions, and UAMs. No authentication or file operations. |
| AJP | 8009 | Apache JServ Protocol — Tomcat/Jetty connector | ★★★★☆ | CPing/CPong + full FORWARD_REQUEST with method, URI, headers, and body. Parses SEND_HEADERS/SEND_BODY_CHUNK/END_RESPONSE. /api/ajp/request. |
| AMI | 5038 | Asterisk Manager Interface — PBX monitoring and control | ★★★★☆ | Authenticated login + read-only actions (CoreShowChannels, SIPpeers, QueueStatus, etc.) with parsed event lists. |
| AMQP | 5672 | Advanced Message Queuing Protocol | ★★★★☆ | Full 0-9-1 flow: StartOk → Tune/TuneOk → Open/OpenOk → Channel.Open → Exchange.Declare → Basic.Publish. /api/amqp/publish. |
| AMQPS | 5671 | AMQP over TLS | ★★★★☆ | Same full 0-9-1 publish flow as AMQP but over TLS. /api/amqps/publish. |
| Battle.net | 6112 | Battle.net Classic gaming service (BNCS) | ★★★★☆ | SID_AUTH_INFO (0x50) exchange: logon type, server token, MPQ info. Gateway realm status checked in parallel. /api/battlenet/*. |
| Beanstalkd | 11300 | Beanstalkd work queue | ★★★★★ | Stats, list-tubes, stats-tube, peek + job produce (put with tube/priority/delay/ttr) and consume (reserve-with-timeout). /api/beanstalkd/put + /reserve. |
| Beats | 5044 | Elastic Beats/Lumberjack log shipping protocol | ★★★★☆ | Sends real Lumberjack v2 JSON event batches and gets sequence ACKs. Missing TLS and compression frames. |
| BGP | 179 | Border Gateway Protocol — internet routing | ★★★☆☆ | OPEN exchange gives AS number, router ID, hold time, and capabilities. Cannot exchange routing tables. |
| Bitcoin | 8333 | Bitcoin P2P network protocol | ★★★★☆ | Full version/verack handshake + getaddr. Gets user agent, block height, services, peer list. No blockchain queries. |
| BitTorrent | 6881 | BitTorrent peer wire protocol | ★★★☆☆ | Handshake gives client identity (peer_id decode) and supported extensions (DHT, Fast, LTEP). No piece exchange. |
| Cassandra | 9042 | Apache Cassandra CQL binary protocol | ★★★★☆ | OPTIONS + STARTUP + SASL PLAIN auth + QUERY execution with full result set parsing (25 CQL types, column metadata). /api/cassandra/query. |
| CDP | 9222 | Chrome DevTools Protocol — browser automation | ★★★★★ | Full WebSocket tunnel for arbitrary CDP commands — navigate, screenshot, JS execution, network capture. Complete. |
| Ceph | 6789 | Ceph distributed storage monitor protocol | ★★☆☆☆ | Reads MSGR banner, distinguishes v1 vs v2, parses feature flags. No cluster health or OSD queries. |
| CHARGEN | 19 | Character Generator Protocol (RFC 864) | ★★★★★ | Receives full rotating ASCII stream with configurable byte limit, bandwidth, and duration stats. Complete. |
| CIFS | 445 | Common Internet File System (SMB1) | ★★☆☆☆ | SMB1 dialect negotiation or SMB2/3 redirect detection. No authentication or file system access. |
| ClamAV | 3310 | ClamAV antivirus daemon (clamd) | ★★★★★ | PING + VERSION + STATS for health monitoring + INSTREAM scan (base64 data, up to 10MB, virus name extraction). /api/clamav/scan. |
| ClickHouse | 8123 | ClickHouse OLAP database (HTTP interface) | ★★★★★ | Arbitrary SQL via HTTP with format control — SELECT, INSERT, SHOW, DESCRIBE. Health and version info included. |
| CoAP | 5683 | Constrained Application Protocol — IoT messaging | ★★★★☆ | All four methods (GET/POST/PUT/DELETE) with proper option encoding + .well-known/core resource discovery. No DTLS. |
| collectd | 25826 | collectd binary protocol — metrics collection | ★★★☆☆ | Can send a properly formatted binary gauge metric. Write-only — no way to read back collected metrics. |
| Consul | 8500 | HashiCorp Consul — service discovery and KV store | ★★★★☆ | Agent info + service catalog + full KV operations: get (base64-decoded), put, list keys, delete with X-Consul-Token auth. /api/consul/kv/*. |
| Couchbase | 11210 | Couchbase KV node (memcached binary protocol) | ★★★★☆ | NOOP + VERSION + STAT + GET (opcode 0x00) + SET (opcode 0x01) with 8-byte extras. Binary protocol encode/decode. /api/couchbase/get + /set. |
| CouchDB | 5984 | Apache CouchDB — document database (HTTP) | ★★★★★ | Arbitrary HTTP GET/POST/PUT/DELETE with auth — create/read/update/delete documents, query views, run Mango. |
| CVS | 2401 | CVS pserver — Concurrent Versions System | ★★★☆☆ | Correct password scrambling + auth test. No repository operations after login. |
| DAP | 4711 | Debug Adapter Protocol — IDE debugger protocol | ★★★★☆ | Health check gives real capability negotiation; WebSocket tunnel allows arbitrary DAP command sequences. |
| Daytime | 13 | Daytime Protocol (RFC 867) | ★★★★★ | Connect, read time string, calculate clock offset. The entire protocol. |
| DCE/RPC | 135 | Distributed Computing Environment RPC | ★★★☆☆ | Bind PDU to eight well-known Windows interfaces — confirms availability. No actual RPC calls or EPM enumeration. |
| Diameter | 3868 | Diameter AAA protocol (successor to RADIUS) | ★★★☆☆ | CER/CEA + optional DWR/DWA gives peer identity and supported application IDs. No application-layer messages. |
| DICOM | 104 | Digital Imaging and Communications in Medicine | ★★★★☆ | A-ASSOCIATE handshake + C-ECHO-RQ (DICOM ping). Covers the two most common PACS connectivity checks. |
| DICT | 2628 | Dictionary Server Protocol (RFC 2229) | ★★★★★ | DEFINE, MATCH (with strategy), SHOW DB — full practical surface of the DICT protocol. |
| Discard | 9 | Discard Protocol (RFC 863) | ★★★★★ | Sends configurable data, reports bytes sent, duration, and throughput. The complete protocol. |
| DNP3 | 20000 | DNP3 — SCADA/ICS data acquisition protocol | ★★★☆☆ | Link status probe + Class 0/1/2/3 READ with IIN flag decoding. No SELECT/OPERATE or time sync. |
| DNS | 53 | Domain Name System (TCP transport) | ★★★★★ | All major record types (A, AAAA, CNAME, MX, TXT, NS, SOA, PTR, SRV, ANY) with full response parsing. |
| Docker | 2375 | Docker daemon REST API | ★★★★☆ | Health endpoint (/_ping, /version, /info) + arbitrary API path queries. No TLS (port 2376) support. |
| DoH | 443 | DNS-over-HTTPS (RFC 8484) | ★★★★★ | Any DoH server, any record type, binary DNS wire format, full response parsing including authority section. |
| DoT | 853 | DNS-over-TLS (RFC 7858) | ★★★★★ | Encrypted DNS to any DoT server, all record types, TTFB breakdown. Complete. |
| DRDA | 446 | Distributed Relational Database Architecture (DB2) | ★★☆☆☆ | EXCSAT/EXCSATRD gives server class, release level, manager capabilities. No SQL execution. |
| Echo | 7 | Echo Protocol (RFC 862) | ★★★★★ | One-shot send/verify with RTT measurement + persistent WebSocket tunnel. Complete. |
| Elasticsearch | 9200 | Elasticsearch — distributed search (HTTP) | ★★★★☆ | Health check + arbitrary API query with Basic Auth. Covers all Query DSL operations. No TLS support. |
| EPMD | 4369 | Erlang Port Mapper Daemon | ★★★★★ | NAMES_REQ (list all nodes) + PORT_PLEASE2_REQ (look up specific node) with type, port, version. Full protocol. |
| EPP | 700 | Extensible Provisioning Protocol — domain registration | ★★★☆☆ | Login + domain availability check. Missing info, create, renew, transfer, delete commands. |
| etcd | 2380 | etcd distributed key-value store (v3 HTTP gateway) | ★★★★☆ | Health + arbitrary /v3/kv queries with base64 decode. Covers kv/range, put, delete, leases. No gRPC or watches. |
| Ethereum | 30303 | Ethereum P2P network (RLPx/devp2p) | ★☆☆☆☆ | RLPx packet-shape detection only — secp256k1 unavailable in Workers. No handshake completion possible. |
| EtherNet/IP | 44818 | EtherNet/IP — industrial automation (CIP over TCP) | ★★★☆☆ | ListIdentity gives vendor ID, device type, product name, firmware revision. No CIP session or I/O operations. |
| FastCGI | 9000 | FastCGI — PHP-FPM and other application servers | ★★★★☆ | FCGI_GET_VALUES (concurrency limits) + full FCGI_BEGIN_REQUEST/PARAMS/STDIN execution with custom params. |
| Finger | 79 | Finger Protocol (RFC 1288) | ★★★★★ | User lookup, blank query (all users), and @host forwarding — the entire Finger protocol. |
| FINS | 9600 | FINS — Omron PLC communication protocol | ★★★☆☆ | TCP handshake + Controller Data Read (model, mode, fault flags). No memory area read/write. |
| Firebird | 3050 | Firebird SQL database | ★★☆☆☆ | op_connect with protocol version negotiation — accepted version or reject. No authentication or queries. |
| FIX | varies | Financial Information eXchange — trading protocol | ★★★☆☆ | Sends Logon (MsgType=A) with correct BodyLength/CheckSum. Tests session connectivity; no order or market data. |
| Fluentd | 24224 | Fluentd/Fluent Bit — log forwarding (Forward mode) | ★★★☆☆ | Sends a single MessagePack event batch and gets ACK. No bulk/multi-event send or server metric queries. |
| FTP | 21 | File Transfer Protocol (RFC 959) | ★★★★★ | Auth, passive mode LIST, STOR (upload), RETR (download) — the core FTP operations. Complete. |
| FTPS | 990 | FTP over TLS (implicit mode) | ★★★★☆ | Full file operations over implicit TLS: login, LIST, download, upload with encrypted data channels (PROT P). /api/ftps/*. |
| Gadu-Gadu | 8074 | Gadu-Gadu instant messaging protocol | ★★★★☆ | Full login: GG_WELCOME seed, GG32/SHA-1 hash, GG_LOGIN80, auth result. No messaging or contact list. |
| Ganglia | 8649 | Ganglia gmond — cluster monitoring | ★★★★★ | Connects, reads complete XML cluster state, parses all host and metric data. That's the full protocol. |
| Gearman | 4730 | Gearman job queue | ★★★★★ | Admin: version, status, workers + binary job submission (foreground/background, arbitrary payload). /api/gearman/submit. |
| Gemini | 1965 | Gemini protocol — lightweight hypermedia | ★★★★★ | Full TLS request/response for any Gemini URL including redirects and body retrieval. Complete. |
| Git | 9418 | Git daemon protocol | ★★★☆☆ | git-upload-pack ref advertisement: all branches, tags, HEAD SHA, server capabilities. No object transfer. |
| Gopher | 70 | Gopher protocol (RFC 1436) | ★★★★★ | Any selector — parsed menus with item types and metadata, or raw file/search content. Complete. |
| GPSD | 2947 | GPSD — GPS daemon | ★★★★☆ | VERSION, DEVICES, POLL — GPS fix with lat/lon/alt/speed/track. No ?WATCH stream for live updates. |
| Grafana | 3000 | Grafana monitoring platform (HTTP API) | ★★★★☆ | Auth support added; dashboards, datasources, folders, alert rules, and org info endpoints. /api/grafana/*. |
| Graphite | 2003 | Graphite Carbon — time-series metrics (plaintext) | ★★★★☆ | Batched metric send in plaintext format with validated names and custom timestamps. No pickle protocol or query API. |
| H.323 | 1720 | H.323 VoIP signaling protocol | ★★★☆☆ | Q.931 SETUP + UUIE, parses Proceeding/Alerting/Connect/Release Complete with cause codes. No H.245 negotiation. |
| HAProxy | 9999 | HAProxy Runtime API (stats socket) | ★★★★☆ | show info (version, uptime, process), show stat with full CSV parsing, arbitrary read-only commands. |
| Hazelcast | 5701 | Hazelcast in-memory data grid | ★★★☆☆ | Map get operations added (handleHazelcastMapGet). Version/cluster detection + basic map reads. |
| HL7 | 2575 | HL7 v2 — healthcare messaging (MLLP) | ★★★☆☆ | Correct MLLP framing, ADT^A01 + ORU^R01 + rawMessage support, ACK parsing. Limited message type coverage. |
| HSRP | 1985 | Hot Standby Router Protocol (virtual router) | ★★☆☆☆ | HSRPv1 Hello probe — state, priority, virtual IP. HSRP is UDP; TCP probing is non-standard. |
| HTTP | 80 | Hypertext Transfer Protocol / 1.1 | ★★★★★ | All methods, custom headers, TLS, chunked decoding, TTFB measurement, redirect detection. Complete. |
| HTTP Proxy | 3128 | HTTP forward proxy + CONNECT tunnel | ★★★☆☆ | Forward proxy GET and CONNECT tunnel validation with proxy-type header detection. No proxy authentication. |
| Icecast | 8000 | Icecast streaming media server | ★★★★☆ | /status-json.xsl gives mount points, listeners, stream metadata; admin stats with auth. No source management. |
| Ident | 113 | Ident Protocol (RFC 1413) | ★★★☆☆ | Sends server/client port pair, parses USERID or ERROR response. Full protocol; rarely enabled in practice. |
| IEC 60870-5-104 | 2404 | IEC 104 — SCADA/ICS telecontrol protocol | ★★★☆☆ | STARTDT/TESTFR/STOPDT U-frame exchange. No ASDU data object reading for actual telemetry. |
| Apache Ignite | 10800 | Apache Ignite — in-memory computing platform | ★★★★☆ | OP_CACHE_GET_NAMES (list caches) + cache get operations. /api/ignite/caches + /api/ignite/cache/get. |
| IKE | 500 | Internet Key Exchange — IPsec VPN negotiation | ★★★☆☆ | IKEv1 SA proposal with transforms and vendor ID extraction (Cisco, Juniper, strongSwan, etc.). IKEv2 not implemented. |
| IMAP | 143 | Internet Message Access Protocol (IMAP4) | ★★★★★ | LOGIN, LIST, SELECT with message count, plus interactive WebSocket session with full IMAP command set. |
| IMAPS | 993 | IMAP over TLS (implicit SSL) | ★★★★☆ | TLS + LOGIN + LIST + SELECT. Same as IMAP minus the interactive WebSocket session. |
| InfluxDB | 8086 | InfluxDB v2 — time-series database | ★★★★★ | /health + /ready, line protocol write, Flux query, bucket create/list/delete, org listing. /api/influxdb/buckets. |
| Informix | 9088 | IBM Informix database | ★☆☆☆☆ | Sends a dummy packet and checks for text patterns. Not a real protocol implementation. |
| IPFS | 4001 | IPFS — distributed filesystem (libp2p) | ★★★☆☆ | libp2p multistream-select + ls + /ipfs/kad/1.0.0 negotiation. Detection only; no add/get/pin operations. |
| IPMI | 623 | Intelligent Platform Management Interface | ★★☆☆☆ | RMCP ASF Presence Ping over TCP. IPMI is UDP-based; TCP probing works on very few BMCs. |
| IPP | 631 | Internet Printing Protocol | ★★★★☆ | Get-Printer-Attributes with correct binary IPP encoding/decoding — printer state, formats, capabilities. No job submission. |
| IRC | 6667 | Internet Relay Chat | ★★★★★ | Full registration, PING/PONG, MOTD, WebSocket session with JOIN/PART/PRIVMSG/NICK/QUIT/TOPIC/NAMES/LIST/WHOIS/MODE. |
| IRCS | 6697 | IRC over TLS | ★★★★★ | TLS + full IRC implementation with complete WebSocket command set. No functionality lost from plain IRC. |
| iSCSI | 3260 | iSCSI — SCSI over TCP (target discovery) | ★★★★☆ | Login PDU + SendTargets text discovery — parses all target names and addresses. No SCSI commands or CHAP. |
| Jabber Component | 5275 | XMPP component protocol (XEP-0114) | ★★★☆☆ | XML stream opening + SHA-1 handshake — verifies component port availability. No IQ/message routing. |
| JDWP | 5005 | Java Debug Wire Protocol | ★★★★☆ | Handshake + VirtualMachine.Version + VirtualMachine.IDSizes with correct binary framing. No breakpoints or thread ops. |
| JetDirect | 9100 | HP JetDirect / AppSocket — raw printing | ★★★☆☆ | PJL INFO ID (model) + PJL INFO STATUS — printer identification and status. No raw print job submission. |
| JSON-RPC | varies | JSON-RPC 2.0 over HTTP | ★★★★☆ | Single and batch calls with correct error parsing and Basic Auth. Works with any JSON-RPC server. |
| Jupyter | 8888 | Jupyter Notebook/Lab REST API | ★★★★☆ | /api, /api/status, /api/kernelspecs + arbitrary API queries with token auth. No kernel lifecycle or WebSocket messages. |
| Apache Kafka | 9092 | Apache Kafka — distributed event streaming | ★★★★☆ | ApiVersions (full API list) + Metadata (brokers, topics, partitions, leaders) with correct binary framing. No produce/consume. |
| Kerberos | 88 | Kerberos authentication protocol (KDC) | ★★★★☆ | Full ASN.1 DER AS-REQ + KRB-ERROR parsing with encryption type enumeration. No AS-REP or TGS-REQ. |
| Kibana | 5601 | Kibana — Elasticsearch visualization platform | ★★★★☆ | Status + saved objects + index patterns (v7/v8 API) + alerting rules + ES query proxy via /api/console/proxy. Basic/ApiKey auth. /api/kibana/*. |
| Kubernetes | 6443 | Kubernetes API server | ★★★★☆ | Health endpoints (/healthz, /livez, /readyz), /version, arbitrary API path queries with bearer token. No watch streams. |
| L2TP | 1701 | Layer 2 Tunneling Protocol (RFC 2661) | ★★★☆☆ | Full SCCRQ/SCCRP/SCCCN handshake — tunnel ID, peer hostname, vendor name, protocol version. L2TP is UDP-primary; TCP non-standard. |
| LDAP | 389 | Lightweight Directory Access Protocol | ★★★★☆ | ASN.1/BER bind (anonymous + authenticated) + search with filter and attribute selection. No modify/add/delete. |
| LDAPS | 636 | LDAP over TLS | ★★★★☆ | TLS + same bind and search operations as plaintext LDAP. More common in production environments. |
| LDP | 646 | Label Distribution Protocol — MPLS signaling | ★★★★☆ | Initialization + KeepAlive handshake — LSR-ID, label space, keepalive time, max PDU, receiver LDP ID. |
| Livestatus | 6557 | MK Livestatus — Nagios/Checkmk query interface | ★★★★☆ | fixed16 response header, status query, hosts query, custom LQL. Full monitoring engine read access. |
| LLMNR | 5355 | Link-Local Multicast Name Resolution | ★★☆☆☆ | Correct DNS-format A/AAAA queries with label encoding, but LLMNR is UDP multicast — TCP rarely works in practice. |
| LMTP | 24 | Local Mail Transfer Protocol | ★★★★☆ | LHLO, capability parsing, MAIL FROM + RCPT TO + DATA with per-recipient status codes — LMTP's key differentiator. |
| Loki | 3100 | Grafana Loki — log aggregation | ★★★★★ | Ready, build info, labels, LogQL instant + range queries, log push (streams), Prometheus scrape. /api/loki/push + /range. |
| LPD | 515 | Line Printer Daemon (RFC 1179) | ★★★☆☆ | Queue state query (0x03) with response parsing. No job submission, removal, or printer status beyond queue. |
| LSP | varies | Language Server Protocol (JSON over stdio/TCP) | ★★★☆☆ | Content-Length framing + initialize request + capability list parsing. Missing initialized notification and actual LSP ops. |
| ManageSieve | 4190 | ManageSieve — Sieve script management | ★★★★☆ | Capabilities, PLAIN/LOGIN SASL auth, LISTSCRIPTS. Missing PUTSCRIPT, DELETESCRIPT, CHECKSCRIPT, ACTIVESCRIPT. |
| Matrix | 8448 | Matrix federated messaging protocol | ★★★★☆ | Discovery + login (m.login.password) + joined rooms list + message send. Full client-server API flow. /api/matrix/login, /rooms, /send. |
| MaxDB | 7210 | SAP MaxDB database | ★☆☆☆☆ | TCP connection + basic response check. No actual MaxDB protocol handshake. |
| mDNS | 5353 | Multicast DNS — local service discovery | ★★★★☆ | Full DNS packet building (A/AAAA/PTR/SRV/TXT) with compression pointer parsing. mDNS is UDP multicast; TCP is a fallback. |
| Meilisearch | 7700 | Meilisearch — fast search engine (HTTP API) | ★★★★★ | Health, version, stats, indexes, search, document add/update (batch), document delete (by IDs or all). /api/meilisearch/documents + /delete. |
| Memcached | 11211 | Memcached — distributed memory cache | ★★★★★ | VERSION, arbitrary commands (including storage ops with two-line format), WebSocket session, parsed STATS. Complete. |
| MGCP | 2427 | Media Gateway Control Protocol | ★★★☆☆ | AUEP (endpoint query) + arbitrary MGCP commands. No CRCX/DLCX/RQNT — the actual call control commands. |
| Minecraft | 25565 | Minecraft Java Edition — server status ping | ★★★★★ | Full SLP: VarInt/VarLong codec, Handshake, Status Request, JSON response parsing, Ping/Pong latency. Complete. |
| MMS | 1755 | Microsoft Media Streaming protocol | ★☆☆☆☆ | Simplified binary detection heuristic. Not a real MMST implementation; no connect/open/play sequence. |
| Modbus | 502 | Modbus TCP — industrial device protocol | ★★★★☆ | Read coils, discrete inputs, holding registers, input registers with MBAP framing and exception handling. No write functions. |
| MongoDB | 27017 | MongoDB — document database (OP_MSG/BSON) | ★★★★★ | hello + buildInfo + ping + find (filter/limit/skip) + insertMany with full recursive BSON encoder. /api/mongodb/find + /insert. |
| MPD | 6600 | Music Player Daemon | ★★★★☆ | status, stats, currentsong, arbitrary read-only commands with ACK/OK parsing. No playback control by design. |
| MSN | 1863 | MSN Messenger Protocol (MSNP) | ★★☆☆☆ | VER + CVR version negotiation. Service shut down in 2013; only useful for private/revival servers. |
| MSRP | varies | Message Session Relay Protocol (SIP messaging) | ★★★☆☆ | Full SEND request encoding with headers and boundary format + response parsing. No persistent session. |
| Mumble | 64738 | Mumble VoIP server | ★★☆☆☆ | Version message with binary framing — server version detection only. Voice requires UDP (unavailable). |
| Munin | 4949 | Munin node — performance monitoring | ★★★★☆ | Banner, version, cap, list, and per-plugin value fetch with dot-terminator handling. Full munin-node protocol. |
| MySQL | 3306 | MySQL/MariaDB database | ★★★★☆ | mysql_native_password auth (SHA-1/Web Crypto), COM_QUERY execution, result set parsing. /api/mysql/connect + /api/mysql/query. |
| Napster | 8875 | OpenNap — Napster-compatible P2P network | ★★★☆☆ | Login + server stats (user count, file count, GB). Search and browse endpoints are not implemented. |
| NATS | 4222 | NATS — cloud-native messaging | ★★★★☆ | INFO/CONNECT + publish + subscribe (SUB/MSG collection) + request-reply via inbox subject. Core messaging workflows covered. /api/nats/*. |
| NBD | 10809 | Network Block Device protocol | ★★★★☆ | Full newstyle negotiation + NBD_OPT_EXPORT_NAME + READ command at configurable offset with hex dump output. /api/nbd/read. |
| Neo4j | 7687 | Neo4j graph database (Bolt protocol) | ★★★★☆ | Full Bolt RUN + PULL Cypher execution, RECORD parsing. /api/neo4j/query. |
| NetBIOS | 139 | NetBIOS Session Service | ★★★☆☆ | Session layer connection to named resources. No NBSTAT name queries or name registration. |
| NFS | 2049 | Network File System | ★★★☆☆ | NULL RPC probe (version detection) + MOUNT protocol export listing. No actual mount, read, or write. |
| 9P | 564 | Plan 9 Filesystem Protocol (9P/Styx) | ★★☆☆☆ | Tversion/Rattach handshake only. No Twalk/Topen/Tread/Tstat — cannot browse or access files. |
| NNTP | 119 | Network News Transfer Protocol | ★★★★☆ | CAPABILITIES, MODE READER, GROUP, OVER for headers, ARTICLE retrieval — solid read path. No LIST, POST, AUTHINFO. |
| NNTPS | 563 | NNTP over TLS | ★★★★☆ | TLS + same read-path coverage as NNTP. Same gaps in posting and group listing. |
| Node Inspector | 9229 | Node.js V8 Inspector debugging protocol | ★★★★☆ | HTTP session list + WebSocket CDP tunnel for arbitrary debug commands. Covers the primary debug-access workflow. |
| Nomad | 4646 | HashiCorp Nomad — workload orchestration (HTTP API) | ★★★★☆ | Health, leader, jobs list, nodes list. Missing allocations, deployments, and namespace scoping. |
| NRPE | 5666 | Nagios Remote Plugin Executor | ★★★★☆ | Arbitrary check_commands with v2 and v3 protocol support. No SSL/TLS (common in production configs). |
| NSCA | 5667 | Nagios Service Check Acceptor | ★★★★☆ | IV + timestamp read, XOR-encrypted passive check submission (cipher 1). Stronger ciphers (AES, 3DES) not supported. |
| NSQ | 4150 | NSQ — real-time distributed messaging | ★★★★☆ | IDENTIFY + PUB (single) + MPUB (atomic multi-publish) + SUB with RDY/FIN message collection. Core messaging covered. /api/nsq/*. |
| NTP | 123 | Network Time Protocol v4 | ★★★★☆ | Full NTPv4 response: stratum, precision, root delay/dispersion, reference ID, all timestamps. No mode 6/7 control. |
| OPC UA | 4840 | OPC Unified Architecture — industrial automation | ★★★★☆ | Hello→ACK→OPN (OpenSecureChannel)→GetEndpoints MSG with full endpoint list parsing: URL, securityMode, securityPolicy, securityLevel. /api/opcua/read. |
| OpenFlow | 6633 | OpenFlow — SDN controller protocol | ★★★★☆ | Version negotiation + FEATURES_REQUEST (datapath ID, tables, ports) + GET_CONFIG. No flow_mod or stats requests. |
| OpenTSDB | 4242 | OpenTSDB — time-series database (telnet API) | ★★★★☆ | version + stats + suggest + telnet PUT command + HTTP /api/query with aggregator and tag filtering. Full read/write coverage. /api/opentsdb/*. |
| OpenVPN | 1194 | OpenVPN VPN protocol (TCP mode) | ★★☆☆☆ | Sends P_CONTROL_HARD_RESET_CLIENT_V2, detects server reset response — handshake probe only. |
| Oracle TNS | 1521 | Oracle TNS Listener — full version detection | ★★★☆☆ | TNS Connect + Accept/Refuse/Redirect parsing with version negotiation. No SQL execution or service enumeration. |
| Oracle | 1521 | Oracle database (TNS detection wrapper) | ★★☆☆☆ | Thin TNS connect + Oracle-like response detection. No real handshake, auth, or query execution. |
| OSCAR | 5190 | OSCAR — AIM/ICQ messaging protocol | ★★☆☆☆ | FLAP signon frame detection. Service defunct since 2017/2024; no practical use. |
| PCEP | 4189 | Path Computation Element Communication Protocol | ★★★☆☆ | OPEN message with keepalive timer negotiation. Session establishment only; no path computation requests. |
| Perforce | 1666 | Perforce Helix Core VCS protocol | ★★★☆☆ | Tagged wire protocol handshake + info command — server version fingerprinting. No auth or depot operations. |
| PJLink | 4352 | PJLink — projector control protocol | ★★★★★ | All Class 1 commands (name, power, input, errors, lamp hours, AV mute) + MD5 auth + power on/off control. |
| POP3 | 110 | Post Office Protocol 3 | ★★★★☆ | USER/PASS auth, STAT + LIST, RETR — the core read workflow. No DELE, UIDL, TOP, APOP, or CAPA. |
| POP3S | 995 | POP3 over TLS | ★★★★☆ | TLS + same connect/list/retrieve as POP3. Same gaps in delete and advanced commands. |
| Portmapper | 111 | ONC RPC Portmapper / rpcbind | ★★★★☆ | NULL probe (liveness) + DUMP to enumerate all registered program-to-port mappings. |
| PostgreSQL | 5432 | PostgreSQL database | ★★★★☆ | MD5 auth (pure-JS MD5 inline), Simple Query execution. /api/postgres/query. |
| PPTP | 1723 | Point-to-Point Tunneling Protocol | ★★★☆☆ | SCCRQ/SCCRP handshake — server version, firmware, hostname. No call setup or GRE/PPP tunnel. |
| Prometheus | 9090 | Prometheus — metrics and monitoring (HTTP API) | ★★★★★ | Health/readiness, build info, instant + range PromQL queries (with step/start/end), /metrics scrape. /api/prometheus/range. |
| QOTD | 17 | Quote of the Day Protocol (RFC 865) | ★★★★☆ | Connect and receive the quote. That is the complete protocol. |
| Quake 3 | 27960 | Quake 3 / Source engine server query | ★★★★☆ | getstatus + getinfo with server cvars and player list. UDP primary transport — some strict servers may not respond via TCP. |
| RabbitMQ | 15672 | RabbitMQ management HTTP API | ★★★★☆ | Overview, nodes, queues, exchanges, connections, channels with Basic Auth. No AMQP binary protocol support. |
| RADIUS | 1812 | Remote Authentication Dial-In User Service | ★★★★☆ | Full RFC 2865 Access-Request with MD5 PAP encryption over TCP (RFC 6613). No EAP, MSCHAP, or Accounting. |
| RadSec | 2083 | RADIUS over TLS (RadSec, RFC 6614) | ★★★★☆ | TLS + RADIUS Access-Request with PAP credentials. Same EAP/MSCHAP gaps as plain RADIUS. |
| RCON | 27015 | Source Engine / Minecraft RCON — server console | ★★★★★ | Full authentication + arbitrary command execution + response parsing. Complete RCON workflow. |
| RDP | 3389 | Remote Desktop Protocol | ★★★☆☆ | X.224 Connection Request — detects security protocol support (Standard/TLS/NLA/RDSTLS). No credential exchange. |
| RealAudio | 554 | RealMedia streaming (RTSP-based) | ★★★☆☆ | RTSP OPTIONS + DESCRIBE — server identity and SDP stream metadata. No SETUP/PLAY; largely historical. |
| Redis | 6379 | Redis in-memory data store | ★★★★★ | AUTH + SELECT, INFO, WebSocket interactive session, arbitrary RESP command execution. Complete. |
| RELP | 20514 | Reliable Event Logging Protocol | ★★★★☆ | Session open with capability exchange + syslog message send with ACK verification. No batch or compression. |
| RethinkDB | 28015 | RethinkDB — realtime database (Bolt/SCRAM) | ★★★☆☆ | V1.0 SCRAM auth complete + ReQL query execution. Connectivity and basic queries now work. |
| rexec | 512 | Remote Execute (BSD rexec) | ★★★★☆ | Full command execution: auth, stdout capture, stderr secondary channel, WebSocket streaming. |
| Riak | 8087 | Riak KV — distributed key-value store (PBC) | ★★★★★ | PBC ping + server info + KV get (bucket/key/type, content-type extraction) + KV put (upsert with content type). /api/riak/get + /put. |
| RIP | 520 | Routing Information Protocol | ★★★☆☆ | RIPv1/v2 route table request + response parsing. RIP is UDP — most routers won't respond via TCP. |
| rlogin | 513 | Remote Login (BSD rlogin) | ★★★☆☆ | Handshake (local user, remote user, terminal type) + WebSocket streaming. Protocol obsolete; replaced by SSH. |
| RMI | 1099 | Java Remote Method Invocation | ★★★☆☆ | JRMI handshake + registry list() — bound remote object names. No method invocation on registered objects. |
| Rserve | 6311 | Rserve — R statistical server | ★★★★☆ | QAP1 ID header parsing + arbitrary R expression evaluation returning string results. Limited to string output and 256-char commands. |
| RSH | 514 | Remote Shell (BSD rsh) | ★★★★☆ | Full command execution with WebSocket streaming. Note: privileged source port requirement not met in Workers. |
| rsync | 873 | rsync daemon | ★★★★☆ | Module listing with descriptions + per-module greeting and MOTD. No file transfer or auth for protected modules. |
| RTMP | 1935 | Real-Time Messaging Protocol — video streaming | ★★★☆☆ | AMF0 connect command + _result response parsing added. Handshake + connect negotiation complete. |
| RTSP | 554 | Real Time Streaming Protocol | ★★★★☆ | Full session: OPTIONS→DESCRIBE→SETUP (TCP interleaved)→PLAY→RTP frame collection→TEARDOWN. SDP track parsing, session ID. /api/rtsp/session. |
| S7comm | 102 | Siemens S7 — industrial PLC protocol | ★★★☆☆ | COTP + S7 setup + SZL read for CPU identification (model, serial, plant ID). No data block read/write. |
| SANE | 6566 | SANE Network Scanning protocol | ★★☆☆☆ | SANE_NET_INIT only — version and status. No device enumeration or scanning capability. |
| SCCP | 2000 | Skinny Client Control Protocol — Cisco VoIP | ★★★☆☆ | KeepAlive + RegisterMessage — tests device registration with CUCM. No call setup or line state queries. |
| SCP | 22 | Secure Copy Protocol (SSH subsystem) | ★☆☆☆☆ | SSH banner grab only. No file transfer or authentication attempt. Port reachability check only. |
| Redis Sentinel | 26379 | Redis Sentinel — high-availability monitoring | ★★★★☆ | PING, INFO (all key-value pairs), SENTINEL masters (name, IP, port, status, flags, replica count). |
| SFTP | 22 | SSH File Transfer Protocol | ★★☆☆☆ | HTTP mode: SSH banner grab. WebSocket mode: TCP tunnel but all SFTP endpoints return 501 Not Implemented. |
| Shadowsocks | 8388 | Shadowsocks — encrypted censorship-circumvention proxy | ★☆☆☆☆ | TCP probe + 500ms silence detection heuristic. Without the encryption key, no meaningful interaction is possible. |
| SHOUTcast | 8000 | SHOUTcast — internet radio streaming (ICY protocol) | ★★★☆☆ | ICY headers: station name, genre, bitrate, sample rate, URL, content-type. No listener counts or metadata updates. |
| SIP | 5060 | Session Initiation Protocol — VoIP signaling | ★★★☆☆ | OPTIONS (capability probe) + REGISTER with proper SIP headers. No INVITE, media negotiation, or auth challenge. |
| SIPS | 5061 | SIP over TLS | ★★★☆☆ | TLS + same OPTIONS and REGISTER as SIP. Same limitations: no INVITE or auth challenge handling. |
| SLP | 427 | Service Location Protocol | ★★★★☆ | ServiceTypeRequest, ServiceRequest (by type), AttributeRequest — covers the primary service discovery use cases. |
| SMB | 445 | Server Message Block v2/v3 | ★★☆☆☆ | SMB2 NEGOTIATE — dialect, security mode (signing required/enabled), capabilities, server GUID. No authentication. |
| SMPP | 2775 | Short Message Peer-to-Peer — SMS gateway protocol | ★★★★☆ | bind_transceiver + submit_sm PDU (source addr, dest addr, message, data coding, registered_delivery). Returns SMSC-assigned message_id. /api/smpp/submit. |
| SMTP | 25 | Simple Mail Transfer Protocol | ★★★★★ | EHLO with extension parsing, AUTH LOGIN, MAIL FROM, RCPT TO, DATA with headers and body, QUIT. Complete. |
| SMTPS | 465 | SMTP over TLS (implicit SSL) | ★★★★★ | TLS + identical full send flow as SMTP. AUTH + full email delivery over encrypted channel. |
| SNMP | 161 | Simple Network Management Protocol v1/v2c | ★★★★☆ | Full ASN.1/BER GET and WALK (GetNextRequest loop). Covers primary monitoring use cases. No SNMPv3. |
| SNPP | 444 | Simple Network Paging Protocol | ★★★★☆ | PAGER, MESSAGE, SEND + optional HOLD and ALERT — can actually deliver pages to a paging gateway. |
| SOAP | 80 | Simple Object Access Protocol (XML web services) | ★★★★☆ | WSDL discovery (service/operations/endpoints) + full SOAP envelope invocation with typed parameters. |
| SOCKS4 | 1080 | SOCKS4/4a proxy protocol | ★★★☆☆ | CONNECT request with domain support + 8-byte reply parsing. No BIND; no data relay after connection. |
| SOCKS5 | 1080 | SOCKS5 proxy protocol | ★★★★☆ | Method negotiation, username/password auth (RFC 1929), CONNECT with IPv4/IPv6/domain + reply parsing. No UDP ASSOCIATE. |
| Solr | 8983 | Apache Solr — enterprise search | ★★★★★ | Health, /admin/info, /admin/cores + full query + document index (add/update, commit control) + delete (by ID or query). /api/solr/index + /delete. |
| Sonic | 1491 | Sonic — lightweight search backend | ★★★★☆ | START control auth, INFO, PING, custom control channel commands. No QUERY/PUSH/SUGGEST data operations. |
| SpamAssassin | 783 | SpamAssassin spamd — spam filtering | ★★★★☆ | PING, CHECK (score + is_spam), SYMBOLS (rule names), REPORT (full analysis). No TELL (train) or REVOKE. |
| SPDY | 443 | SPDY — deprecated HTTP/2 precursor | ★★☆☆☆ | SETTINGS frame send + server protocol detection (SPDY/HTTP2/HTTP1). Deprecated since 2016; ALPN not settable. |
| SPICE | 5900 | SPICE — VM remote display protocol | ★★☆☆☆ | RedLinkMess/RedLinkReply — server version and channel count. No channel enumeration, auth, or display session. |
| SSDP | 1900 | Simple Service Discovery Protocol (UPnP) | ★★☆☆☆ | M-SEARCH over TCP + device response parsing. SSDP is UDP multicast — most devices won't respond via TCP. |
| SSH | 22 | Secure Shell | ★★☆☆☆ | Banner grab + TCP tunnel for browser-side SSH. Worker does no protocol negotiation; depends on client-side ssh2. |
| STOMP | 61613 | Simple Text Oriented Messaging Protocol | ★★★★★ | CONNECT + SEND + SUBSCRIBE (collect N messages with timeout) + UNSUBSCRIBE + DISCONNECT. Auth and vhost support. /api/stomp/subscribe. |
| STUN | 3478 | Session Traversal Utilities for NAT (RFC 5389) | ★★★★☆ | Full Binding Request with FINGERPRINT CRC32 + all attribute parsing (XOR-MAPPED-ADDRESS, ERROR-CODE, etc.). |
| SMTP Submission | 587 | SMTP email client submission (port 587) | ★★★☆☆ | EHLO + STARTTLS detection; STARTTLS upgrade not completed (socket API limitation). Extension discovery only. |
| SVN | 3690 | Subversion VCS protocol | ★★☆☆☆ | Greeting parsing: min/max protocol versions, repo UUID, server capabilities. No checkout, commit, or file ops. |
| Sybase ASE | 5000 | Sybase Adaptive Server Enterprise (TDS-based) | ★★★★☆ | Full TDS 5.0 login (XOR-0xA5 password, fixed-field layout) + SQL batch query with column/row result parsing. /api/sybase/login + /query. |
| Syslog | 514 | Syslog protocol (RFC 5424 and RFC 3164) | ★★★★☆ | Both RFC 5424 (structured-data) and RFC 3164 (BSD syslog) formats with configurable facility and severity. |
| TACACS+ | 49 | TACACS+ AAA protocol | ★★★★★ | Complete auth exchange: START→REPLY→CONTINUE→REPLY with MD5 XOR encryption. Real credential testing. |
| Tarantool | 3301 | Tarantool — in-memory database (IProto/MessagePack) | ★★★★☆ | Greeting + auth + IPROTO_EVAL (Lua expression) + IPROTO_EXECUTE (SQL). Full MessagePack encode/decode. /api/tarantool/eval + /sql. |
| TCP | varies | Raw TCP connection probe | ★★★★☆ | Connect + optional send (utf8 or hex) + receive up to 65536 bytes + RTT + hex/text output. Versatile banner-grabber. |
| TDS | 1433 | Tabular Data Stream — SQL Server (pre-login) | ★★★☆☆ | TDS Pre-Login fully parsed: server version, TDS version string, encryption mode, MARS. No login or SQL execution. |
| TeamSpeak 3 | 10011 | TeamSpeak 3 ServerQuery interface | ★★★★☆ | serverinfo, whoami, + 20 read-only ServerQuery commands with TS3 key=value response parsing. |
| Telnet | 23 | Telnet protocol | ★★★☆☆ | Banner grab with IAC byte stripping + TCP tunnel for interactive sessions. No IAC option negotiation. |
| TFTP | 69 | Trivial File Transfer Protocol | ★☆☆☆☆ | Non-standard TCP implementation explicitly documented as incompatible with standard TFTP servers. |
| Apache Thrift | 9090 | Apache Thrift — cross-language RPC framework | ★★★★☆ | Full Thrift Binary Protocol: probe (any method, empty args) + custom calls with typed parameters. Framed and buffered. |
| Time | 37 | Time Protocol (RFC 868) | ★★★★★ | 4-byte response → Unix epoch → ISO 8601 + clock offset calculation. The complete protocol. |
| Tor Control | 9051 | Tor Control Protocol | ★★★★☆ | PROTOCOLINFO probe (auth methods, Tor version) + authenticated GETINFO with configurable keys. |
| TURN | 3478 | Traversal Using Relays around NAT (RFC 5766) | ★★★☆☆ | Allocate Request with XOR-RELAYED-ADDRESS parsing. Tests reachability; no permissions, channels, or data relay. |
| UUCP | 540 | UNIX-to-UNIX Copy protocol | ★★★☆☆ | Wakeup sequence + Shere greeting + system name exchange + ROK/reject. Complete for this obsolete protocol. |
| uWSGI | 3031 | uWSGI application server protocol | ★★★★☆ | Binary packet with WSGI environment vars + HTTP response parsing. Custom request endpoint for any path/method. |
| Varnish | 6082 | Varnish Cache management CLI (VCLI) | ★★★★☆ | SHA-256 auth + read-only commands: ping, status, backend.list, vcl.list, param.show, storage.list. |
| HashiCorp Vault | 8200 | Vault — secrets management (HTTP API) | ★★★★★ | Health, seal-status, arbitrary sys queries + KV secret read (v1/v2 auto-detect, versioned) + secret write. /api/vault/secret/read + /write. |
| Ventrilo | 3784 | Ventrilo VoIP — proprietary protocol | ★☆☆☆☆ | Pure port probe + best-effort parse of undocumented binary. Superseded by Discord; no useful output. |
| VNC | 5900 | VNC — Remote Framebuffer Protocol | ★★★★☆ | Full RFB version negotiation (3.3/3.7/3.8) + complete security type enumeration with human-readable names. |
| WebSocket | 80 | WebSocket protocol (RFC 6455) | ★★★★★ | Full handshake with Sec-WebSocket-Accept SHA-1 validation, subprotocol/extension negotiation, optional masked ping. |
| WHOIS | 43 | WHOIS protocol (RFC 3912) | ★★★★★ | Automatic TLD-to-server routing (20+ registries) + full response. Works for any domain without knowing the server. |
| WinRM | 5985 | Windows Remote Management (WS-Management/SOAP) | ★★★★☆ | Identify (ProductVendor, ProtocolVersion, SecurityProfiles) + auth probe (WWW-Authenticate header parsing). |
| X11 | 6000 | X Window System (X11) | ★★★★☆ | Full Setup + Success response: vendor, release, resource IDs, screens with dimensions and pixel formats. |
| XMPP | 5222 | XMPP client protocol (Jabber) | ★★★★★ | SASL PLAIN auth + stream restart + resource bind + roster fetch + message stanza send. Full client workflow. /api/xmpp/login, /roster, /message. |
| XMPP S2S | 5269 | XMPP server-to-server federation | ★★★☆☆ | S2S stream features (STARTTLS, SASL EXTERNAL, dialback) + IQ ping RTT. No dialback verification or message routing. |
| XMPP S2S (TLS) | 5269 | XMPP S2S with TLS — same as S2S with encrypted transport | ★★★☆☆ | TLS variant of XMPP S2S — stream features detection over encrypted channel. Same functional limitations. |
| YMSG | 5050 | Yahoo Messenger Protocol | ★★☆☆☆ | PING packet with version detection (9–16). Service shut down July 2018; no live servers exist. |
| Zabbix | 10050 | Zabbix monitoring — agent and server protocol | ★★★★☆ | Active agent check request (server side) + passive item key query (agent side) with ZBXD framing. |
| ZMTP | 5555 | ZeroMQ Message Transport Protocol 3.1 | ★★★★☆ | Greeting + READY exchange: mechanism, socket type (DEALER/ROUTER/PUB/SUB/etc.), identity parsing. No message send/receive. |
| ZooKeeper | 2181 | Apache ZooKeeper — distributed coordination | ★★★★☆ | ruok + srvr (fully parsed) + arbitrary 4LW commands (ruok, srvr, stat, conf, envi, mntr, etc.). No znode operations. |
