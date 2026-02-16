# Implemented Protocols

This document tracks all protocols that have been fully implemented in Port of Call.

## ✅ Implemented

### TCP Ping
- **Port**: Any
- **Status**: ✅ Complete
- **Features**: Round-trip time measurement, connectivity testing
- **UI**: Yes
- **Tests**: ✅ Passing
- **Documentation**: README.md

### SSH (Secure Shell)
- **Port**: 22 (default)
- **Status**: ✅ Complete
- **Features**:
  - Password authentication
  - Private key authentication (Ed25519, RSA, ECDSA)
  - Passphrase-protected keys
  - WebSocket tunnel for interactive sessions
  - Connectivity testing (HTTP mode)
- **UI**: Yes (full auth UI with file upload)
- **Tests**: ✅ Passing (14/14)
- **Documentation**: docs/SSH_AUTHENTICATION.md

### SFTP (SSH File Transfer Protocol)
- **Port**: 22 (SSH subsystem)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Runs over SSH connection (port 22)
  - Password authentication
  - Private key authentication (Ed25519, RSA, ECDSA)
  - WebSocket tunnel for SFTP protocol
  - Connectivity testing (HTTP mode)
  - File operations (list, download, upload, delete, mkdir, rename) via WebSocket
  - Client-side SFTP protocol implementation required
- **UI**: Yes (connection form with auth options, file browser placeholder)
- **Tests**: ⚠️ Awaiting deployment (7 integration tests)
- **Documentation**: docs/protocols/SFTP.md

### FTP (File Transfer Protocol)
- **Port**: 21 (default)
- **Status**: ✅ Complete
- **Features**:
  - PASV mode support
  - Connect & authenticate
  - List directory (LIST)
  - Upload files (STOR)
  - Download files (RETR)
  - Delete files (DELE)
  - Rename files (RNFR/RNTO)
  - Create directories (MKD)
  - File size query (SIZE)
- **UI**: Yes (full file browser with modal-based operations)
- **Tests**: ⚠️  FTP server issues (dlptest.com credentials changed)
- **Documentation**: README.md

### Telnet
- **Port**: 23 (default)
- **Status**: ✅ Complete
- **Features**:
  - HTTP connectivity test mode
  - WebSocket interactive mode
  - IAC command parsing utilities
  - Banner reading
  - Cloudflare detection
- **UI**: Yes (full terminal with command input and history)
- **Tests**: ✅ Passing (9/9)
- **Documentation**: README.md

### SMTP (Simple Mail Transfer Protocol)
- **Port**: 25/587/465
- **Status**: ✅ Complete
- **Features**:
  - Connection testing with EHLO
  - Email sending
  - AUTH LOGIN authentication
  - Multiple ports (25 SMTP, 587 Submission, 465 SMTPS)
  - Cloudflare detection
- **UI**: Yes (full email composer with server config)
- **Tests**: ✅ Passing (14/14)
- **Documentation**: README.md

### POP3 (Post Office Protocol v3)
- **Port**: 110/995
- **Status**: ✅ Complete
- **Features**:
  - Connection testing with USER/PASS
  - Message listing (LIST/STAT)
  - Message retrieval (RETR)
  - Multiple ports (110 POP3, 995 POP3S)
  - Cloudflare detection
- **UI**: Yes (mailbox viewer with message retrieval)
- **Tests**: ✅ Passing (18/18)
- **Documentation**: README.md

### IMAP (Internet Message Access Protocol)
- **Port**: 143/993
- **Status**: ✅ Complete
- **Features**:
  - Connection testing with LOGIN
  - Mailbox listing (LIST)
  - Mailbox selection (SELECT)
  - Multiple ports (143 IMAP, 993 IMAPS)
  - Cloudflare detection
- **UI**: Yes (mailbox browser with folder navigation)
- **Tests**: ✅ Passing (17/17)
- **Documentation**: README.md

### MySQL
- **Port**: 3306 (default)
- **Status**: ✅ Complete
- **Features**:
  - Server handshake reading
  - Version detection
  - Connectivity testing
  - Cloudflare detection
- **UI**: Yes (connection test with credentials)
- **Tests**: ✅ Passing (12/12)
- **Documentation**: README.md

### PostgreSQL
- **Port**: 5432 (default)
- **Status**: ✅ Complete
- **Features**:
  - Startup message protocol
  - Server response parsing
  - Connectivity testing
  - Cloudflare detection
  - Custom port support
- **UI**: Yes (connection test with credentials)
- **Tests**: ✅ Passing (9/9)
- **Documentation**: README.md

### Redis
- **Port**: 6379 (default)
- **Status**: ✅ Complete
- **Features**:
  - RESP (Redis Serialization Protocol)
  - Command execution (PING, SET, GET, etc.)
  - AUTH authentication
  - Database selection (SELECT)
  - Connectivity testing
  - Cloudflare detection
- **UI**: Yes (connection test + command execution interface)
- **Tests**: ✅ Passing (17/17)
- **Documentation**: README.md

### MQTT
- **Port**: 1883 (default), 8883 (TLS)
- **Status**: ✅ Complete
- **Features**:
  - MQTT 3.1.1 protocol
  - CONNECT/CONNACK packets
  - Username/password authentication
  - Auto-generated client IDs
  - Connectivity testing
  - Cloudflare detection
- **UI**: Yes (connection test with authentication)
- **Tests**: ✅ Passing (13/13)
- **Documentation**: README.md

### LDAP
- **Port**: 389 (default), 636 (LDAPS)
- **Status**: ✅ Complete
- **Features**:
  - LDAP BIND operation
  - Anonymous bind support
  - Authenticated bind (simple auth)
  - ASN.1/BER encoding/decoding
  - Distinguished Name (DN) support
  - Connectivity testing
  - Cloudflare detection
- **UI**: Yes (connection test with bind options)
- **Tests**: ✅ Passing (13/13)
- **Documentation**: README.md

### SMB
- **Port**: 445 (default), 139 (NetBIOS)
- **Status**: ✅ Complete
- **Features**:
  - SMB2/SMB3 protocol negotiation
  - Dialect detection (SMB 2.0.2, 2.1, 3.0, 3.0.2, 3.1.1)
  - NetBIOS session support
  - Connectivity testing
  - Cloudflare detection
- **UI**: Yes (connection test)
- **Tests**: ✅ Passing (10/10)
- **Documentation**: README.md

### Echo
- **Port**: Any (commonly 7 or 4242 for tcpbin.com)
- **Status**: ✅ Complete
- **Features**:
  - Send/receive echo test
  - WebSocket interactive echo mode
  - Match verification
  - Connectivity testing
- **UI**: Yes
- **Tests**: ✅ Passing (9/9)
- **Documentation**: README.md

### WHOIS (RFC 3912)
- **Port**: 43 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Domain registration lookup
  - Auto-select WHOIS server by TLD (20 TLD mappings)
  - Manual server override
  - Domain format validation
  - 100KB response size limit
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (8 unit + 8 real-world)
- **Documentation**: README.md

### Syslog (RFC 5424 / RFC 3164)
- **Port**: 514 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - RFC 5424 (modern) message formatting
  - RFC 3164 (legacy BSD) message formatting
  - Priority calculation (Facility × 8 + Severity)
  - All 8 severity levels (Emergency–Debug)
  - All 24 facility codes (Kernel–Local7)
  - Fire-and-forget TCP send
  - Input validation
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (11 unit + 11 real-world)
- **Documentation**: README.md

### SOCKS4 / SOCKS4a
- **Port**: 1080 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - SOCKS4 CONNECT command
  - SOCKS4a hostname resolution (special IP 0.0.0.1)
  - User ID support
  - Response code parsing (0x5A–0x5D)
  - Bound address/port reporting
  - Input validation
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (10 unit + 7 real-world)
- **Documentation**: README.md

### Daytime (RFC 867)
- **Port**: 13 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Human-readable time from remote server
  - Local/remote timestamp comparison
  - Clock offset calculation
  - Simplest network protocol — just connect and read
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (4 real-world)
- **Documentation**: README.md

### Finger (RFC 1288)
- **Port**: 79 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - User information lookup
  - Remote host forwarding (user@host)
  - Username/hostname validation (injection prevention)
  - 100KB response size limit
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (6 real-world)
- **Documentation**: README.md

### Time (RFC 868)
- **Port**: 37 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Binary 32-bit time synchronization
  - Epoch conversion (1900 → 1970 Unix)
  - ISO 8601 date output
  - Clock offset calculation
  - Network delay compensation
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (4 real-world)
- **Documentation**: README.md

### Memcached
- **Port**: 11211 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Connection test via VERSION command
  - Command execution (get, set, add, replace, delete, incr, decr, flush_all)
  - Automatic byte count calculation for storage commands
  - Stats retrieval with parsed key-value output
  - Cloudflare detection
- **UI**: Yes (connection test + stats + command execution)
- **Tests**: ⚠️ Awaiting deployment (13 integration tests)
- **Documentation**: README.md

### WebSocket Tunnel
- **Port**: Any
- **Status**: ✅ Complete
- **Features**: Generic WebSocket-to-TCP tunnel for any protocol
- **UI**: Via protocol-specific clients (SSH, FTP, Telnet)
- **Tests**: ✅ Passing (via SSH/Telnet tests)
- **Documentation**: README.md, docs/SOCKETS_API.md

### NATS
- **Port**: 4222 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Connection test via INFO/CONNECT/PING/PONG handshake
  - Server info retrieval (version, ID, JetStream, auth/TLS requirements)
  - Message publishing (PUB command with subject and payload)
  - Token authentication
  - Username/password authentication
  - Cloudflare detection
- **UI**: Yes (connection test + publish interface with subject/payload)
- **Tests**: ⚠️ Awaiting deployment (20 integration tests)
- **Documentation**: docs/protocols/NATS.md

### XMPP (RFC 6120)
- **Port**: 5222 (default), 5269 (server-to-server)
- **Status**: ✅ Complete
- **Features**:
  - XML stream opening and server probe
  - TLS (STARTTLS) availability and requirement detection
  - SASL authentication mechanism discovery (PLAIN, SCRAM-SHA-1, etc.)
  - Compression method detection
  - Server feature enumeration
  - Custom domain parameter for virtual hosting
- **UI**: Yes (host, port, domain fields with feature display)
- **Tests**: ✅ 10 integration tests
- **Documentation**: docs/protocols/xmpp.md

### Matrix
- **Port**: 8448 (default federation), 443 (client-server), 8008 (alternative)
- **Status**: ✅ Complete
- **Features**:
  - Homeserver discovery and health checking
  - Supported spec versions detection (/_matrix/client/versions)
  - Login flow enumeration (password, SSO, token methods)
  - Federation server version detection (/_matrix/federation/v1/version)
  - Well-known server/client discovery
  - Public rooms directory query
  - Capabilities detection
  - Arbitrary Matrix API endpoint queries (GET/POST/PUT/DELETE)
  - Bearer token authentication support
  - HTTP/1.1 over raw TCP socket implementation
  - Quick query buttons for common endpoints
- **UI**: Yes (connection form with API query interface)
- **Tests**: ⚠️ Awaiting deployment
- **Documentation**: docs/protocols/MATRIX.md

### Minecraft RCON (Source RCON Protocol)
- **Port**: 25575 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Source RCON binary protocol (little-endian)
  - Password authentication (SERVERDATA_AUTH)
  - Command execution (SERVERDATA_EXECCOMMAND)
  - Multi-packet response parsing
  - Input validation (host, port, password, command length)
  - Quick command buttons for common Minecraft commands
  - Command history with re-execution
- **UI**: Yes (connection + command execution with history)
- **Tests**: ⚠️ Awaiting deployment (11 integration tests)
- **Documentation**: docs/protocols/MINECRAFT_RCON.md

### PPTP (RFC 2637)
- **Port**: 1723 (default)
- **Status**: ✅ Complete
- **Features**:
  - Start-Control-Connection-Request/Reply handshake
  - Protocol version detection
  - Framing capabilities (async/sync) discovery
  - Bearer capabilities (analog/digital) discovery
  - Server hostname and vendor fingerprinting
  - Firmware revision detection
  - Max channels reporting
  - Result code and error handling
- **UI**: Yes (host, port fields with capability display)
- **Tests**: ✅ 9 integration tests
- **Documentation**: docs/protocols/PPTP.md

### 9P (Plan 9 Filesystem Protocol)
- **Port**: 564 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - 9P2000 version negotiation (Tversion/Rversion)
  - Filesystem attach with anonymous auth (Tattach/Rattach)
  - Root QID reporting (type, version, path)
  - Little-endian binary message encoding/parsing
  - Server max message size detection
  - Input validation
- **UI**: Yes (connection probe with server info display)
- **Tests**: ⚠️ Awaiting deployment (7 integration tests)
- **Documentation**: docs/protocols/9P.md

### DNS (RFC 1035)
- **Port**: 53 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - A, AAAA, MX, TXT, NS, CNAME, SOA, SRV, PTR, ANY record types
  - Configurable upstream resolver (default: 8.8.8.8)
  - Binary DNS protocol over TCP with proper header/question encoding
  - Response parsing with answer extraction
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (7 real-world tests)

### Gopher (RFC 1436)
- **Port**: 70 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Selector-based resource fetching
  - Search query support
  - Host character validation
  - 100KB response limit
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (4 real-world tests)

### Gemini
- **Port**: 1965 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - TLS-only protocol with gemini:// URL scheme
  - Status code and meta header parsing
  - Content fetching with size limits
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (3 real-world tests)

### IRC (RFC 2812)
- **Port**: 6667 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - NICK/USER registration handshake
  - MOTD and server response reading
  - Channel joining support
  - Nickname validation
  - Password authentication
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (4 real-world tests)

### NNTP (RFC 3977)
- **Port**: 119 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Connection with banner reading
  - GROUP selection with article count/range
  - Article retrieval by number
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (3 real-world tests)

### STOMP (Simple Text Oriented Messaging Protocol)
- **Port**: 61613 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - CONNECT with optional login/passcode and virtual host
  - SEND with destination and body
  - STOMP frame parsing (CONNECTED/ERROR/RECEIPT)
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (2 real-world tests)

### SOCKS5 (RFC 1928)
- **Port**: 1080 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Method negotiation (no auth, username/password)
  - CONNECT command with domain name support
  - Username/password authentication (RFC 1929)
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (3 real-world tests)

### Modbus (ICS/SCADA)
- **Port**: 502 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Connection test via read holding registers
  - Function codes 1-4 (read coils, discrete inputs, holding registers, input registers)
  - Unit ID support
  - Read-only (no write functions exposed)
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (5 real-world tests)

### MongoDB (Wire Protocol)
- **Port**: 27017 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - OP_MSG wire protocol with BSON encoding
  - Connection test via isMaster command
  - Ping command for health check
  - Server version and feature detection
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (4 real-world tests)

### Graphite (Carbon)
- **Port**: 2003 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Plaintext protocol metric submission
  - Batch metric sending
  - Metric name validation (alphanumeric, dots, underscores, hyphens)
  - Automatic timestamp generation
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (4 real-world tests)

### Git Protocol (pack protocol v1)
- **Port**: 9418 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - git-upload-pack reference listing
  - pkt-line format parsing
  - Repository ref enumeration (branches, tags, HEAD)
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (4 real-world tests)

### ZooKeeper (Four Letter Words)
- **Port**: 2181 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - ruok health check (connect endpoint)
  - Four-letter word commands: ruok, srvr, stat, conf, envi, mntr, cons, dump, wchs, dirs, isro
  - Command validation against allowed list
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (4 real-world tests)

### Cassandra (CQL Binary Protocol v4)
- **Port**: 9042 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - CQL native protocol v4 OPTIONS/SUPPORTED handshake
  - Server version and feature detection
  - Compression and CQL version discovery
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (3 real-world tests)

### AMQP 0-9-1 (RabbitMQ)
- **Port**: 5672 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - AMQP 0-9-1 protocol handshake
  - Connection.Start/Start-OK exchange
  - Virtual host support
  - Server property detection (product, version, platform)
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (3 real-world tests)

### Kafka (Binary Protocol)
- **Port**: 9092 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - ApiVersions request for supported API detection
  - Metadata request with topic listing
  - Broker information (ID, host, port)
  - Custom client ID
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (3 real-world tests)

### RTSP (RFC 2326)
- **Port**: 554 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - OPTIONS method for capability detection
  - DESCRIBE method for media stream discovery
  - Header parsing (CSeq, Public, Server, Content-Type)
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (3 real-world tests)

### Rsync
- **Port**: 873 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Rsync daemon connection with version negotiation
  - Module listing
  - Module detail retrieval (MOTD)
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (5 real-world tests)

### TDS (Tabular Data Stream / SQL Server)
- **Port**: 1433 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Pre-Login handshake (TDS 7.x)
  - Server version detection
  - Encryption negotiation
  - Instance name detection
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (2 real-world tests)

### VNC (RFB Protocol)
- **Port**: 5900 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - RFB protocol version negotiation
  - Security type enumeration
  - Server version detection
  - Multi-display support (port 5900+N)
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (2 real-world tests)

### CHARGEN (RFC 864)
- **Port**: 19 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Character generation stream reading
  - Configurable max bytes limit (default 10KB)
  - Input validation
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (3 real-world tests)

### Discard (RFC 863)
- **Port**: 9 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Fire-and-forget data sending
  - Throughput measurement
  - Configurable data size (max 1MB)
  - Duration and bandwidth statistics
  - Input validation
- **UI**: Yes (data input with throughput stats)
- **Tests**: ⚠️ Awaiting deployment (9 integration tests)
- **Documentation**: README.md

### Neo4j (Bolt Protocol)
- **Port**: 7687 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Bolt protocol handshake
  - PackStream binary encoding
  - Server version and connection state detection
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (2 real-world tests)

### RTMP (Real-Time Messaging Protocol)
- **Port**: 1935 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - C0/C1/S0/S1 handshake
  - Server timestamp and version detection
  - Streaming server connectivity testing
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (2 real-world tests)

### TACACS+ (RFC 8907)
- **Port**: 49 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Probe mode (connection test)
  - Authentication (START/REPLY exchange)
  - Optional shared secret encryption
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (2 real-world tests)

### HL7 v2.x (MLLP)
- **Port**: 2575 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - MLLP framing (VT/FS/CR)
  - ADT^A01 (Patient Admission) message generation
  - ORU^R01 (Lab Results) message generation
  - ACK response parsing
  - Custom raw message support
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (2 real-world tests)

### Elasticsearch (REST over TCP)
- **Port**: 9200 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Cluster health check (GET /_cluster/health)
  - Index query (GET /index/_search)
  - Raw TCP HTTP request construction
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (2 real-world tests)

### Docker API (Engine API)
- **Port**: 2375 (HTTP), 2376 (HTTPS)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Health check via /_ping endpoint
  - Version detection (GET /version)
  - System information retrieval (GET /info)
  - Container listing, inspection, start/stop (GET/POST /containers/*)
  - Image management (GET /images/json)
  - Network and volume queries
  - Arbitrary API endpoint queries (GET/POST/DELETE)
  - Raw HTTP/1.1 over TCP socket
  - Chunked transfer encoding support
  - Quick query buttons for common operations
- **UI**: Yes (connection test + API query interface with quick actions)
- **Tests**: ✅ Passing (14 integration tests)
- **Documentation**: docs/protocols/DOCKER.md
- **Security Note**: Docker API without TLS provides unrestricted daemon access - use only with trusted hosts

### etcd (Distributed Key-Value Store)
- **Port**: 2379 (client), 2380 (peer)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Health check with version/status/cluster info
  - Query endpoint for v3 HTTP/JSON Gateway API
  - Key-value operations (get/put/delete with base64 encoding)
  - Lease management (grant/revoke TTL)
  - Server status and maintenance endpoints
  - Basic Auth support
  - Base64 key/value encoding/decoding
  - Raw HTTP/1.1 over TCP socket
  - Chunked transfer encoding support
  - Quick query buttons for common operations
- **UI**: Yes (connection test + query interface with quick actions)
- **Tests**: ✅ Passing (26 integration tests)
- **Documentation**: docs/protocols/ETCD.md
- **Use Cases**: Kubernetes cluster coordination, distributed configuration, service discovery

### AJP (Apache JServ Protocol)
- **Port**: 8009 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - CPing/CPong health check
  - Binary AJP13 packet encoding
  - Tomcat/JBoss connectivity testing
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (2 real-world tests)

### RDP (Remote Desktop Protocol)
- **Port**: 3389 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - X.224 Connection Request/Confirm handshake
  - RDP Negotiation Request/Response
  - Security protocol detection (Standard RDP, TLS, CredSSP/NLA, RDSTLS)
  - TPKT header parsing
  - Connection timing
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (2 real-world tests)

### JetDirect (PJL)
- **Port**: 9100 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - PJL (Printer Job Language) queries
  - Printer information retrieval
  - Network printer connectivity testing
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment (2 real-world tests)

### LPD (Line Printer Daemon - RFC 1179)
- **Port**: 515 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Short queue state query (opcode 0x03)
  - Long queue state listing (opcode 0x04)
  - Printer queue name configuration
  - Job parsing from long-format output
  - Cloudflare detection
- **UI**: Yes (probe + queue listing with printer name presets)
- **Tests**: ⚠️ Awaiting deployment (7 integration tests)
- **Documentation**: README.md

### Beanstalkd (Work Queue Protocol)
- **Port**: 11300 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Connection test via stats command
  - Server version and uptime detection
  - Job statistics (ready, reserved, delayed, buried)
  - Tube listing and tube stats
  - Read-only command execution (stats, list-tubes, peek-*)
  - Command whitelist for safety
  - Cloudflare detection
- **UI**: Yes (connect + command execution with quick action buttons)
- **Tests**: ⚠️ Awaiting deployment (8 integration tests)
- **Documentation**: README.md

### Ventrilo (Gaming VoIP)
- **Port**: 3784 (TCP control), 3785 (UDP voice)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - TCP connectivity testing
  - Server status query (name, version, users, channels)
  - Proprietary protocol parsing (reverse-engineered)
  - Support for v2.x and v3.x server versions
  - Binary response parsing with null-terminated strings
  - User count and channel statistics
  - Raw hex dump for debugging unsupported formats
- **UI**: Yes (status query with stats display)
- **Tests**: ⚠️ Awaiting deployment (6 integration tests)
- **Documentation**: docs/protocols/VENTRILO.md

### Napster (Legacy P2P File Sharing)
- **Port**: 6699 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - TCP connectivity testing
  - LOGIN command with username/password authentication
  - Server statistics query (users, files, data size)
  - Text-based protocol (newline-terminated commands)
  - Response parsing for server info, MOTD, version
  - OpenNap server compatibility
  - Historical protocol (1999-2001 original Napster)
- **UI**: Yes (login form + stats display)
- **Tests**: ⚠️ Awaiting deployment (9 integration tests)
- **Note**: File transfers (P2P) not implemented - out of scope

## 🔒 Security Features

### Cloudflare Detection
- **Status**: ✅ Complete
- **Features**: Automatic detection and blocking of Cloudflare-protected hosts
- **Tests**: ✅ Passing (5/5)
- **Documentation**: docs/CLOUDFLARE_DETECTION.md

## Summary

- **Total Implemented**: 60 protocols + 1 security feature
- **Deployed & Passing**: 14 protocols
- **Awaiting Deployment**: 46 protocols
- **Real-World Usage Tests**: 270 integration tests covering all protocols with realistic hosts/ports/parameters
- **Test Coverage** (by protocol):
  - POP3 (18), IMAP (17), Redis (17), Docker (14), SSH (14), SMTP (14), MQTT (13), LDAP (13), MySQL (12), SMB (10), Discard (9), Echo (9), PostgreSQL (9), Telnet (9), Syslog (11+11), SOCKS4 (10+7), WHOIS (8+8), SFTP (7), TCP Ping (6), Cloudflare Detection (5), DNS (7), Memcached (6), SOCKS5 (3), Modbus (5), MongoDB (4), Graphite (4), RCON (5), Git (4), ZooKeeper (4), Rsync (5), IRC (4), Gopher (4), Gemini (3), NNTP (3), AMQP (3), Kafka (3), RTSP (3), CHARGEN (3), Cassandra (3), STOMP (2), TDS (2), VNC (2), Neo4j (2), RTMP (2), TACACS+ (2), HL7 (2), Elasticsearch (2), AJP (2), XMPP (2), RDP (2), NATS (2), JetDirect (2), Daytime (4), Time (4), Finger (6)
