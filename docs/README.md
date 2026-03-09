# Port of Call Documentation

Complete documentation for Port of Call - a browser-to-TCP bridge via Cloudflare Workers Sockets API.

## 📚 Documentation Index

### Getting Started
- **[Project Overview](PROJECT_OVERVIEW.md)** - What is Port of Call? Core concepts and use cases
- **[Architecture](ARCHITECTURE.md)** - Technical architecture, data plane, security, scaling limits
- **[Protocol Registry](PROTOCOL_REGISTRY.md)** - Protocol coverage, known gaps, certification status
- **[Quick Start Guide](../README.md)** - Installation and deployment instructions

### Development Guides
- **[ADD_PROTOCOL Guide](guides/ADD_PROTOCOL.md)** - Step-by-step workflow for implementing new protocols
- **[Implementation Guide](guides/IMPLEMENTATION_GUIDE.md)** - Patterns, best practices, common pitfalls
- **[Local Testing](guides/LOCAL_TESTING.md)** - Testing strategies and local development setup
- **[Cross-Platform Notes](guides/CROSS_PLATFORM.md)** - Platform compatibility considerations
- **[API Examples Validation](guides/API_EXAMPLES_VALIDATION.md)** - API testing and validation procedures

### CLI & curl Interface
- **[curl-Friendly Interface](../README.md#curl-friendly-interface)** - Short URL routes with plain text output
- **[CLI Tool (`poc`)](../README.md#cli-tool-poc)** - Downloadable bash script with protocol auto-detection
- Source: [`src/worker/cli-routes.ts`](../src/worker/cli-routes.ts), [`src/worker/formatters.ts`](../src/worker/formatters.ts), [`src/worker/content-negotiation.ts`](../src/worker/content-negotiation.ts)

### Technical References
- **[Sockets API Reference](reference/SOCKETS_API.md)** - Cloudflare Workers Sockets API guide
- **[TCP Protocols List](reference/TCP_PROTOCOLS.md)** - Comprehensive list of implementable TCP protocols
- **[Impossible Protocols](reference/IMPOSSIBLE.md)** - Protocols that cannot run on Workers (UDP, raw sockets)
- **[Implemented Protocols](reference/IMPLEMENTED.md)** - Complete list of 244 implemented protocols with test status
- **[Internet Standards Analysis](reference/INTERNET_STANDARDS.md)** - RFC Internet Standards feasibility analysis
- **[RFC Compliance Audit](reference/RFC_COMPLIANCE_AUDIT.md)** - Protocol standards compliance review
- **[Cloudflare Detection](reference/CLOUDFLARE_DETECTION.md)** - Connection restrictions and workarounds
- **[SSH Authentication](reference/SSH_AUTHENTICATION.md)** - Password and private key authentication deep dive
- **[Documentation Summary](reference/DOCUMENTATION_SUMMARY.md)** - Overview of all documentation files
- **[Power Users Guide](reference/POWER_USERS_HAPPY.md)** - Advanced features and usage patterns
- **[Naming History](reference/NAMING_HISTORY.md)** - How we chose "Port of Call"

### Protocol Specifications
- **[protocols/](protocols/)** - Individual protocol specs (244 protocols)
  - [SSH](protocols/SSH.md), [Shadowsocks](protocols/SHADOWSOCKS.md), [TURN](protocols/TURN.md), [Redis](protocols/REDIS.md), [MySQL](protocols/MYSQL.md), etc.
- **[protocols/QUICK_REFERENCE.md](protocols/QUICK_REFERENCE.md)** - One-page cheat sheet for protocol implementation
- **[protocols/non-tcp/](protocols/non-tcp/)** - Non-TCP protocol specs (27 protocols)

### Changelog & Bug Fixes
- **[Protocol Registry](PROTOCOL_REGISTRY.md)** - Protocol status, known gaps, data plane certification
- **[changelog/](changelog/)** - Historical bug fixes and protocol reviews
  - [Critical Fixes Summary](changelog/critical-fixes.md) - All high-severity bugs (24 protocols)
  - [Medium Fixes Summary](changelog/medium-fixes.md) - All medium-severity bugs (31 protocols)
  - [2026-02-18 Protocol Review](changelog/2026-02-18-protocol-review.md) - Comprehensive audit overview
  - [By Protocol Changelogs](changelog/by-protocol/) - Individual protocol bug reports (86 protocols)
- **[reviews/](changelog/reviews/)** - Audit pass reports (Passes 3-27, findings, review indexes)

## 🎯 Quick Links by Role

### For Developers
Start here to implement protocols:
1. [ADD_PROTOCOL Guide](guides/ADD_PROTOCOL.md) - Read this first
2. [Implementation Guide](guides/IMPLEMENTATION_GUIDE.md) - Patterns and best practices
3. [Implemented Protocols](reference/IMPLEMENTED.md) - See what's already done
4. [TCP Protocols List](reference/TCP_PROTOCOLS.md) - Choose what to build next
5. [Local Testing](guides/LOCAL_TESTING.md) - Set up your development environment

### For Architects
Understanding the system:
1. [Architecture](ARCHITECTURE.md) - System design, data plane, scaling limits
2. [Protocol Registry](PROTOCOL_REGISTRY.md) - Coverage, certification, known gaps
3. [Sockets API Reference](reference/SOCKETS_API.md) - Core technology
4. [Impossible Protocols](reference/IMPOSSIBLE.md) - Technical limitations
5. [RFC Compliance Audit](reference/RFC_COMPLIANCE_AUDIT.md) - Standards compliance

### For Security Reviewers
Security and bug fixes:
1. [Architecture — Security](ARCHITECTURE.md#security) - SSRF prevention, Cloudflare IP detection, resource lifecycle
2. [Protocol Registry — Certification](PROTOCOL_REGISTRY.md#data-plane-certification) - 27-pass audit trail
3. [Critical Fixes Summary](changelog/critical-fixes.md) - 200+ security/data corruption bugs fixed
4. [SSH Authentication](reference/SSH_AUTHENTICATION.md) - Auth security deep dive

### For Project Managers
Planning and tracking:
1. [Project Overview](PROJECT_OVERVIEW.md) - Goals and vision
2. [Implemented Protocols](reference/IMPLEMENTED.md) - Current status (244 protocols)
3. [Implementation Guide](guides/IMPLEMENTATION_GUIDE.md) - Implementation roadmap
4. [Documentation Summary](reference/DOCUMENTATION_SUMMARY.md) - Documentation inventory

## 📊 Current Project Status

### Implementation Progress
- **Total Protocols**: 244 implemented
- **Internet Standards**: 24 IETF Internet Standards (IS) implemented
- **Latest Review**: February 2026 — 27 audit passes, 200+ critical bugs fixed
- **Data Plane**: Certified "Industrial Grade" — backpressure, chunking, serialization, resource safety
- **Test Coverage**: 92% (214+ integration tests)

### Recent Updates (February 2026)
- **Data Plane Certification**: 27-pass audit: backpressure, zero-copy chunking, promise-chain serialization, SSRF prevention
- **Security Fixes**: 200+ critical bugs fixed (resource leaks, injection vulnerabilities, data corruption, SSRF)
- **RFC Compliance**: 30+ medium-severity bugs fixed for protocol compliance
- **Documentation Consolidation**: Architecture and registry docs unified; audit history archived

### Protocol Categories
- **Databases**: MySQL, PostgreSQL, Redis, MongoDB, Memcached, Cassandra, Neo4j, InfluxDB, Elasticsearch, TDS, etc.
- **Email**: SMTP, POP3, IMAP
- **Messaging**: MQTT, NATS, XMPP, IRC, STOMP, AMQP, Kafka
- **Remote Access**: SSH, Telnet, VNC, RDP
- **File Transfer**: FTP, SFTP
- **Network Tools**: Whois, DNS, Echo, Ping, Syslog
- **Legacy/Retro**: Gopher, Finger, Daytime, Time, Chargen
- **DevOps**: Docker, Git, ZooKeeper, etcd, Consul, Rsync
- **Industrial**: Modbus, LPD, JetDirect
- **Gaming**: Minecraft RCON
- **Streaming**: RTSP, RTMP
- **Security**: SOCKS4, SOCKS5, TACACS+
- **Misc**: SMB, LDAP, 9P, Memcached, Beanstalkd, Graphite, etc.

## 🔗 External Resources

- [Live Demo](https://l4.fyi)
- [Cloudflare Sockets API Docs](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)

## 🛠️ Development Workflow

### Adding a New Protocol
1. Read [ADD_PROTOCOL Guide](guides/ADD_PROTOCOL.md) for step-by-step instructions
2. Consult [TCP Protocols List](reference/TCP_PROTOCOLS.md) and [Impossible Protocols](reference/IMPOSSIBLE.md)
3. Follow patterns in [Implementation Guide](guides/IMPLEMENTATION_GUIDE.md)
4. Review [Protocol Review Changelog](changelog/by-protocol/) for common bug patterns to avoid
5. Write tests following [Local Testing](guides/LOCAL_TESTING.md)
6. Update [Implemented Protocols](reference/IMPLEMENTED.md) when complete

### Testing Before Deployment
```bash
# Run tests
npm test

# Test locally with Wrangler
npm run worker:dev

# Deploy to production
npm run worker:deploy
```

## 📝 Documentation Standards

When updating documentation:
- ✅ Keep README.md (this file) as the central index
- ✅ Use relative links for internal documentation
- ✅ Include practical code examples
- ✅ Update IMPLEMENTED.md when protocols are completed
- ✅ Follow Markdown best practices
- ✅ Include security considerations
- ✅ Add testing strategies
- ✅ Document all known bugs and limitations
- ✅ Review [Critical Fixes](changelog/critical-fixes.md) to avoid common bugs

## 🗂️ Documentation Structure

```
docs/
├── README.md                    # This file (navigation hub)
├── ARCHITECTURE.md              # System design, data plane, security, scaling
├── PROTOCOL_REGISTRY.md         # Protocol coverage, gaps, certification status
├── PROJECT_OVERVIEW.md          # High-level overview
├── GETTING_STARTED.md           # Quick start guide
│
├── guides/                      # Development guides
│   ├── ADD_PROTOCOL.md
│   ├── IMPLEMENTATION_GUIDE.md
│   ├── LOCAL_TESTING.md
│   ├── CROSS_PLATFORM.md
│   └── API_EXAMPLES_VALIDATION.md
│
├── reference/                   # Technical references
│   ├── SOCKETS_API.md
│   ├── TCP_PROTOCOLS.md
│   ├── IMPLEMENTED.md
│   ├── IMPOSSIBLE.md
│   ├── RFC_COMPLIANCE_AUDIT.md
│   ├── CLOUDFLARE_DETECTION.md
│   ├── SSH_AUTHENTICATION.md
│   └── ...
│
├── changelog/                   # Bug fixes and reviews
│   ├── critical-fixes.md        # Critical bugs (24 protocols)
│   ├── medium-fixes.md          # Medium bugs (31 protocols)
│   ├── by-protocol/             # Individual changelogs (248 protocols)
│   └── reviews/                 # Audit pass reports (Passes 3-27)
│
└── protocols/                   # Protocol specifications
    ├── QUICK_REFERENCE.md       # Cheat sheet
    ├── SSH.md ... (244 protocol specs)
    └── non-tcp/                 # Non-TCP protocols (27 files)
```

## 📋 TODO: Documentation Cleanup & Protocol Reviews

### ✅ Priority 1: Fix Alternate Spec Files (142 files) - COMPLETE

**Issue:** All uppercase protocol spec files (e.g., `POSTGRES.md`) were duplicates of lowercase reviewed protocols (e.g., `postgres`). These needed to be converted to redirect stubs.

**Status:** ✅ **COMPLETED** - 142 files converted to redirect stubs
- **Lines removed:** 78,077 lines of duplicate content
- **Lines added:** 554 lines (minimal stubs)
- **Net reduction:** 77,523 lines
- **Result:** Each uppercase file now redirects to `../changelog/by-protocol/[lowercase-name].md`

<details>
<summary>Original action plan (click to expand)</summary>

**Action Required:** Convert these uppercase files to stubs that redirect to the canonical lowercase version:

<details>
<summary>Click to expand full list of 140 alternate spec files to convert</summary>

Each file should be replaced with a stub like:
```markdown
# [Protocol Name]

This is an alternate spelling/casing of the protocol specification.

**Canonical specification:** See [protocol-name](PROTOCOL-NAME.md) (lowercase)

This file is kept for backwards compatibility with existing links.
```

**Files to convert:**
- 9P.md → redirect to protocols/9p.md
- AFP.md → redirect to protocols/afp.md
- AJP.md → redirect to protocols/ajp.md
- AMQP.md → redirect to protocols/amqp.md
- AMQPS.md → redirect to protocols/amqps.md
- BEATS.md → redirect to protocols/beats.md
- BGP.md → redirect to protocols/bgp.md
- BITCOIN.md → redirect to protocols/bitcoin.md
- BITTORRENT.md → redirect to protocols/bittorrent.md
- CASSANDRA.md → redirect to protocols/cassandra.md
- CIFS.md → redirect to protocols/cifs.md
- COAP.md → redirect to protocols/coap.md
- DIAMETER.md → redirect to protocols/diameter.md
- DICOM.md → redirect to protocols/dicom.md
- DNS.md → redirect to protocols/dns.md
- DOCKER.md → redirect to protocols/docker.md
- DOH.md → redirect to protocols/doh.md
- DOT.md → redirect to protocols/dot.md
- DRDA.md → redirect to protocols/drda.md
- ECHO.md → redirect to protocols/echo.md
- ELASTICSEARCH.md → redirect to protocols/elasticsearch.md
- ETCD.md → redirect to protocols/etcd.md
- FASTCGI.md → redirect to protocols/fastcgi.md
- FINGER.md → redirect to protocols/finger.md
- FLUENTD.md → redirect to protocols/fluentd.md
- FTP.md → redirect to protocols/ftp.md
- GOPHER.md → redirect to protocols/gopher.md
- GRAPHITE.md → redirect to protocols/graphite.md
- H323.md → redirect to protocols/h323.md
- HAZELCAST.md → redirect to protocols/hazelcast.md
- IMAP.md → redirect to protocols/imap.md
- INFLUXDB.md → redirect to protocols/influxdb.md
- IPMI.md → redirect to protocols/ipmi.md
- IRC.md → redirect to protocols/irc.md
- IRCS.md → redirect to protocols/ircs.md
- ISCSI.md → redirect to protocols/iscsi.md
- JETDIRECT.md → redirect to protocols/jetdirect.md
- KAFKA.md → redirect to protocols/kafka.md
- KERBEROS.md → redirect to protocols/kerberos.md
- KIBANA.md → redirect to protocols/kibana.md
- KUBERNETES.md → redirect to protocols/kubernetes.md
- LDAP.md → redirect to protocols/ldap.md
- LDAPS.md → redirect to protocols/ldaps.md
- LIVESTATUS.md → redirect to protocols/livestatus.md
- LMTP.md → redirect to protocols/lmtp.md
- MANAGESIEVE.md → redirect to protocols/managesieve.md
- MATRIX.md → redirect to protocols/matrix.md
- MDNS.md → redirect to protocols/mdns.md
- MEMCACHED.md → redirect to protocols/memcached.md
- MINECRAFT.md → redirect to protocols/minecraft.md
- MONGODB.md → redirect to protocols/mongodb.md
- MPD.md → redirect to protocols/mpd.md
- MQTT.md → redirect to protocols/mqtt.md
- MSN.md → redirect to protocols/msn.md
- MSRP.md → redirect to protocols/msrp.md
- MUMBLE.md → redirect to protocols/mumble.md
- MYSQL.md → redirect to protocols/mysql.md
- NAPSTER.md → redirect to protocols/napster.md
- NATS.md → redirect to protocols/nats.md
- NBD.md → redirect to protocols/nbd.md
- NEO4J.md → redirect to protocols/neo4j.md
- NETBIOS.md → redirect to protocols/netbios.md
- NFS.md → redirect to protocols/nfs.md
- NNTP.md → redirect to protocols/nntp.md
- NODE-INSPECTOR.md → redirect to protocols/node-inspector.md
- NRPE.md → redirect to protocols/nrpe.md
- NSCA.md → redirect to protocols/nsca.md
- NTP.md → redirect to protocols/ntp.md
- Nomad.md → redirect to protocols/nomad.md
- OPCUA.md → redirect to protocols/opcua.md
- OPENFLOW.md → redirect to protocols/openflow.md
- OPENTSDB.md → redirect to protocols/opentsdb.md
- OPENVPN.md → redirect to protocols/openvpn.md
- ORACLE-TNS.md → redirect to protocols/oracle-tns.md
- OSCAR.md → redirect to protocols/oscar.md
- PCEP.md → redirect to protocols/pcep.md
- PERFORCE.md → redirect to protocols/perforce.md
- PJLINK.md → redirect to protocols/pjlink.md
- POP3.md → redirect to protocols/pop3.md
- POP3S.md → redirect to protocols/pop3s.md
- PORTMAPPER.md → redirect to protocols/portmapper.md
- POSTGRES.md → redirect to protocols/postgres.md
- PPTP.md → redirect to protocols/pptp.md
- QOTD.md → redirect to protocols/qotd.md
- QUAKE3.md → redirect to protocols/quake3.md
- RABBITMQ.md → redirect to protocols/rabbitmq.md
- RADIUS.md → redirect to protocols/radius.md
- RADSEC.md → redirect to protocols/radsec.md
- RCON.md → redirect to protocols/rcon.md
- RDP.md → redirect to protocols/rdp.md
- REALAUDIO.md → redirect to protocols/realaudio.md
- REDIS.md → redirect to protocols/redis.md
- RELP.md → redirect to protocols/relp.md
- RETHINKDB.md → redirect to protocols/rethinkdb.md
- REXEC.md → redirect to protocols/rexec.md
- RIAK.md → redirect to protocols/riak.md
- RIP.md → redirect to protocols/rip.md
- RLOGIN.md → redirect to protocols/rlogin.md
- RMI.md → redirect to protocols/rmi.md
- RSERVE.md → redirect to protocols/rserve.md
- RSH.md → redirect to protocols/rsh.md
- RSYNC.md → redirect to protocols/rsync.md
- RTMP.md → redirect to protocols/rtmp.md
- RTSP.md → redirect to protocols/rtsp.md
- SANE.md → redirect to protocols/sane.md
- SCCP.md → redirect to protocols/sccp.md
- SCP.md → redirect to protocols/scp.md
- SENTINEL.md → redirect to protocols/sentinel.md
- SFTP.md → redirect to protocols/sftp.md
- SHADOWSOCKS.md → redirect to protocols/shadowsocks.md
- SIP.md → redirect to protocols/sip.md
- SLP.md → redirect to protocols/slp.md
- SMB.md → redirect to protocols/smb.md
- SMTP.md → redirect to protocols/smtp.md
- SNMP.md → redirect to protocols/snmp.md
- SNPP.md → redirect to protocols/snpp.md
- SOCKS4.md → redirect to protocols/socks4.md
- SOCKS5.md → redirect to protocols/socks5.md
- SOLR.md → redirect to protocols/solr.md
- SONIC.md → redirect to protocols/sonic.md
- SPAMD.md → redirect to protocols/spamd.md
- SPDY.md → redirect to protocols/spdy.md
- SPICE.md → redirect to protocols/spice.md
- SSH.md → redirect to protocols/ssh.md
- STOMP.md → redirect to protocols/stomp.md
- SVN.md → redirect to protocols/svn.md
- SYBASE.md → redirect to protocols/sybase.md
- SYSLOG.md → redirect to protocols/syslog.md
- TACACS.md → redirect to protocols/tacacs.md
- TDS.md → redirect to protocols/tds.md
- TEAMSPEAK.md → redirect to protocols/teamspeak.md
- TELNET.md → redirect to protocols/telnet.md
- THRIFT.md → redirect to protocols/thrift.md
- TURN.md → redirect to protocols/turn.md
- UUCP.md → redirect to protocols/uucp.md
- VAULT.md → redirect to protocols/vault.md
- VNC.md → redirect to protocols/vnc.md
- WHOIS.md → redirect to protocols/whois.md
- WINRM.md → redirect to protocols/winrm.md
- X11.md → redirect to protocols/x11.md
- XMPP.md → redirect to protocols/xmpp.md
- ZABBIX.md → redirect to protocols/zabbix.md
- ZOOKEEPER.md → redirect to protocols/zookeeper.md

</details>

**Estimated effort:** 2-3 hours with script automation

---

### ✅ Priority 2: Resolve Alternate Spec Naming (4 protocols) - COMPLETE

**Issue:** Some protocols had multiple specs with different names. Needed to consolidate and create redirects.

**Status:** ✅ **COMPLETED** - All 4 conflicts resolved

**Results:**
1. ✅ **NINEP.md** → Redirect to `9p.md` (no unique content to merge)
2. ✅ **POSTGRESQL.md** → Redirect to `postgres.md` (no unique content to merge)
3. ✅ **TACACS+.md** → Redirect to `tacacs.md` (no unique content to merge)
4. ✅ **ORACLE.md** → Redirect to `oracle-tns.md` (unique content merged successfully)

<details>
<summary>Original action plan (click to expand)</summary>

**Action Required:**

1. **NINEP.md vs 9P**
   - ✅ Canonical: Use `9p.md` (already reviewed in changelog/by-protocol/9p.md)
   - ❌ Make NINEP.md a redirect stub to 9p.md
   - Merge any unique content from NINEP.md into 9p.md

2. **POSTGRESQL.md vs POSTGRES.md**
   - ✅ Canonical: Use `postgres.md` (already reviewed in changelog/by-protocol/postgres.md)
   - ❌ Make POSTGRESQL.md a redirect stub to postgres.md
   - Merge any unique content from POSTGRESQL.md into postgres.md

3. **TACACS+.md vs TACACS.md**
   - ✅ Canonical: Use `tacacs.md` (already reviewed in changelog/by-protocol/tacacs.md)
   - ❌ Make TACACS+.md a redirect stub to tacacs.md
   - Note: TACACS+ is the modern version, but we use lowercase filename

4. **ORACLE.md vs ORACLE-TNS.md**
   - ✅ Canonical: Use `oracle-tns.md` (already reviewed in changelog/by-protocol/oracle-tns.md)
   - ❌ Make ORACLE.md a redirect stub to oracle-tns.md
   - Oracle TNS is the wire protocol name

**Estimated effort:** 30 minutes

---

### Priority 3A: Implemented but Not Reviewed (87 protocols)

**Issue:** These protocols are **already implemented** in `src/worker/` but do not have changelog entries in `changelog/by-protocol/`. They need code review and documentation following the February 2026 audit template.

**Action Required:** Create code reviews following the template in [postgres.md](changelog/by-protocol/postgres.md). Extract bugs found, document fixes, and create comprehensive protocol specifications.

**Status:** 240 protocols implemented, 153 reviewed, **87 remaining for review**

<details>
<summary>Click to expand full list of 87 implemented-but-not-reviewed protocols</summary>

**Messaging & Queues:**
- [ ] ACTIVEMQ - Apache ActiveMQ messaging broker
- [ ] BEANSTALKD - Beanstalkd work queue
- [ ] GEARMAN - Gearman job server
- [ ] NSQ - NSQ messaging platform

**Databases:**
- [ ] AEROSPIKE - Aerospike NoSQL database
- [ ] CLICKHOUSE - ClickHouse database
- [ ] COUCHBASE - Couchbase NoSQL database
- [ ] COUCHDB - Apache CouchDB database
- [ ] FIREBIRD - Firebird SQL database
- [ ] INFORMIX - Informix database
- [ ] MAXDB - SAP MaxDB database
- [ ] MEILISEARCH - Meilisearch search engine
- [ ] ORACLE - Oracle Database TNS protocol
- [ ] TARANTOOL - Tarantool in-memory database

**Monitoring & Observability:**
- [ ] COLLECTD - Collectd monitoring daemon
- [ ] GANGLIA - Ganglia monitoring system
- [ ] GRAFANA - Grafana monitoring platform
- [ ] LOKI - Grafana Loki log aggregation
- [ ] MUNIN - Munin monitoring system
- [ ] PROMETHEUS - Prometheus monitoring

**DevOps & Infrastructure:**
- [ ] CONSUL - HashiCorp Consul service discovery
- [ ] CEPH - Ceph distributed storage
- [ ] GIT - Git version control protocol
- [ ] HAPROXY - HAProxy stats protocol
- [ ] IGNITE - Apache Ignite in-memory computing
- [ ] JUPYTER - Jupyter notebook protocol

**Industrial/SCADA:**
- [ ] CDP - Cisco Discovery Protocol
- [ ] DNP3 - Distributed Network Protocol 3 (SCADA)
- [ ] ETHERNETIP - EtherNet/IP industrial protocol
- [ ] FINS - Omron FINS factory automation
- [ ] IEC104 - IEC 60870-5-104 SCADA protocol
- [ ] MODBUS - Modbus industrial protocol
- [ ] MMS - Manufacturing Message Specification
- [ ] S7COMM - Siemens S7 PLC protocol

**Legacy/Simple Protocols:**
- [ ] ACTIVEUSERS - RFC 866 Active Users Protocol (implemented in `src/worker/activeusers.ts`)
- [ ] CHARGEN - RFC 864 Character Generator Protocol (implemented in `src/worker/chargen.ts`)
- [ ] DAYTIME - RFC 867 Daytime Protocol (implemented in `src/worker/daytime.ts`)
- [ ] DICT - Dictionary Server Protocol RFC 2229 (implemented in `src/worker/dict.ts`)
- [ ] DISCARD - RFC 863 Discard Protocol (implemented in `src/worker/discard.ts`)
- [ ] IDENT - Identification Protocol RFC 1413 (implemented in `src/worker/ident.ts`)
- [ ] TIME - RFC 868 Time Protocol (implemented in `src/worker/time.ts`)

**Secure Protocol Variants:**
- [ ] FTPS - FTP over TLS (explicit FTPS)
- [ ] IMAPS - IMAP over TLS (implicit, port 993)
- [ ] NNTPS - NNTP over TLS (implicit)
- [ ] SIPS - SIP over TLS (secure SIP)
- [ ] SMPP - Short Message Peer-to-Peer
- [ ] SMTPS - SMTP over TLS (implicit, port 465)

**Web & HTTP:**
- [ ] HTTP - Hypertext Transfer Protocol
- [ ] HTTPPROXY - HTTP proxy protocol
- [ ] SOAP - Simple Object Access Protocol
- [ ] WEBSOCKET - WebSocket Protocol

**Voice/Video/Streaming:**
- [ ] ICECAST - Icecast streaming server
- [ ] MGCP - Media Gateway Control Protocol
- [ ] VENTRILO - Ventrilo voice chat

**Network Protocols:**
- [ ] HSRP - Hot Standby Router Protocol
- [ ] IKE - Internet Key Exchange (IPsec)
- [ ] L2TP - Layer 2 Tunneling Protocol
- [ ] LDP - Label Distribution Protocol
- [ ] LLMNR - Link-Local Multicast Name Resolution
- [ ] SSDP - Simple Service Discovery Protocol
- [ ] STUN - Session Traversal Utilities for NAT

**Specialized Protocols:**
- [ ] ADB - Android Debug Bridge
- [ ] AMI - Asterisk Manager Interface
- [ ] BATTLENET - Battle.net gaming protocol
- [ ] CLAMAV - ClamAV antivirus daemon
- [ ] CVS - Concurrent Versions System
- [ ] DAP - Data Access Protocol
- [ ] DCERPC - Distributed Computing Environment RPC
- [ ] EPP - Extensible Provisioning Protocol
- [ ] EPMD - Erlang Port Mapper Daemon
- [ ] ETHEREUM - Ethereum blockchain protocol
- [ ] GADUGADU - Gadu-Gadu instant messaging
- [ ] GEMINI - Gemini protocol (alternative to HTTP)
- [ ] GPSD - GPS daemon protocol
- [ ] HL7 - Health Level 7 healthcare protocol
- [ ] IPFS - InterPlanetary File System
- [ ] IPP - Internet Printing Protocol
- [ ] JABBER-COMPONENT - Jabber/XMPP component protocol
- [ ] JDWP - Java Debug Wire Protocol
- [ ] JSONRPC - JSON-RPC
- [ ] LPD - Line Printer Daemon (RFC 1179)
- [ ] LSP - Language Server Protocol
- [ ] NINEP - Plan 9 Filesystem Protocol (9P)
- [ ] ZMTP - ZeroMQ Message Transport Protocol

</details>

**Review Priority:**
1. **High-traffic protocols:** HTTP, WEBSOCKET, PROMETHEUS, GRAFANA
2. **Legacy/Simple RFCs:** CHARGEN, DAYTIME, DISCARD, TIME, IDENT, DICT, ACTIVEUSERS (quick wins)
3. **Security-critical TLS variants:** FTPS, IMAPS, SMTPS, NNTPS, SIPS
4. **Industrial protocols:** MODBUS, DNP3, S7COMM, IEC104 (high-value niche)
5. **Modern databases:** CLICKHOUSE, COUCHBASE, MEILISEARCH, TARANTOOL

---

### Priority 3B: Cannot Be Implemented (3 protocol specs)

**Issue:** These protocol specification files exist in `docs/protocols/` but cannot be implemented on Cloudflare Workers due to technical limitations documented in [reference/IMPOSSIBLE.md](reference/IMPOSSIBLE.md).

**Status:** ❌ Impossible / ⚠️ Impractical / 📄 Duplicate

**Protocols:**
- [ ] ❌ **GRPC** - gRPC requires HTTP/2 as transport, blocked by same ALPN limitation (see IMPOSSIBLE.md lines 99-108)
- [ ] ❌ **HTTP2** (h2 over TLS) - Requires TLS ALPN negotiation (`h2` token), which Workers Sockets API doesn't expose (see IMPOSSIBLE.md lines 88-91)
  - ⚠️ **HTTP2** (h2c cleartext) - Technically possible but impractical; requires full HTTP/2 binary framing implementation from scratch (HPACK, multiplexing, flow control) with no suitable library for Workers runtime (see IMPOSSIBLE.md lines 93-97)
- [ ] 📄 **POSTGRESQL** - Duplicate spec file; PostgreSQL wire protocol is already implemented in `src/worker/postgres.ts` and reviewed in [changelog/by-protocol/postgres.md](changelog/by-protocol/postgres.md)

**Action Required:**
1. Move `docs/protocols/GRPC.md` → `docs/protocols/non-tcp/GRPC.md` (document as impossible due to ALPN)
2. Move `docs/protocols/HTTP2.md` → `docs/protocols/non-tcp/HTTP2.md` (document as impossible/impractical)
3. Delete `docs/protocols/POSTGRESQL.md` (duplicate of existing postgres spec)

**See:** [reference/IMPOSSIBLE.md](reference/IMPOSSIBLE.md) for detailed technical explanations

---

### ✅ Priority 4: Documentation-Only Files (5 files) - COMPLETE

**Issue:** Non-protocol files were mixed in with protocol specifications.

**Status:** ✅ **COMPLETED** - All 5 files handled appropriately

**Actions Taken:**
- ✅ **IMPLEMENTATION_GUIDE.md** - Moved to `guides/IMPLEMENTATION_GUIDE.md` (matches README links)
- ✅ **QUICK_REFERENCE.md** - Kept in protocols/ (useful cheat sheet)
- ✅ **README.md** - Kept in protocols/ (directory index)
- ✅ **SUMMARY.md** - Deleted (redundant historical meta-documentation)
- ✅ **SHOUTCAST_REVIEW.md** - Moved to `changelog/by-protocol/shoutcast.md`

**Result:** protocols/ directory now contains only protocol specifications, plus README and QUICK_REFERENCE

<details>
<summary>Original action plan (click to expand)</summary>

**Action Required:** Remove or relocate these non-protocol files from `protocols/`:

- [x] IMPLEMENTATION_GUIDE.md - Moved to `guides/IMPLEMENTATION_GUIDE.md`
- [x] QUICK_REFERENCE.md - Kept in protocols/ as it's a useful cheat sheet
- [x] README.md - Kept as protocols/ directory index
- [x] SUMMARY.md - Deleted (redundant)
- [x] SHOUTCAST_REVIEW.md - Moved to `changelog/by-protocol/shoutcast.md`

**Time taken:** 15 minutes

---

## 🤝 Contributing

To contribute to documentation:
1. Read existing docs to avoid duplication
2. Follow the structure outlined in this README
3. Update the index when adding new files
4. Use clear, concise language
5. Include code examples where relevant
6. Cross-reference related documentation
7. Review [changelog/](changelog/) for common bugs to avoid

## 📞 Getting Help

- **Implementation Questions**: See [Implementation Guide](guides/IMPLEMENTATION_GUIDE.md)
- **Protocol Specs**: Check [protocols/](protocols/) directory
- **Technical Issues**: Review [Architecture](ARCHITECTURE.md) and [Sockets API](reference/SOCKETS_API.md)
- **Security**: See [Cloudflare Detection](reference/CLOUDFLARE_DETECTION.md) and [Critical Fixes](changelog/critical-fixes.md)
- **Bug Reports**: Check [changelog/by-protocol/](changelog/by-protocol/) for known issues

---

**Last Updated**: February 2026
**Total Documentation Files**: 300+ files
**Lines of Documentation**: 100,000+ lines
**Protocols Documented**: 244 protocol specifications
**Bug Fixes Documented**: 200+ critical, 30+ medium severity
