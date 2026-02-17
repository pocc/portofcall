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

### FTPS (FTP over TLS)
- **Port**: 990 (implicit FTPS default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Implicit FTPS: TLS from the first byte on port 990
  - Server banner reading (220 welcome)
  - FEAT command for feature enumeration
  - SYST command for OS/system type detection
  - TLS feature flags (AUTH TLS, PBSZ, PROT, UTF8, MLST, EPSV)
  - Cloudflare detection
  - RTT and connect-time reporting
- **UI**: Yes (connection test with TLS feature display)
- **Tests**: ⚠️ Awaiting deployment (8 integration tests)
- **Documentation**: docs/protocols/FTPS.md

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

### LMTP (Local Mail Transfer Protocol — RFC 2033)
- **Port**: 24 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Connection test with LHLO capability discovery
  - Full message delivery: LHLO → MAIL FROM → RCPT TO → DATA
  - Multiple recipients with per-recipient delivery status (key LMTP feature)
  - Cloudflare detection
- **UI**: Yes (connection test + message composer with multi-recipient support)
- **Tests**: ⚠️ Awaiting deployment (5 integration tests)
- **Documentation**: docs/protocols/LMTP.md

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

### Chrome DevTools Protocol (CDP)
- **Port**: 9222 (default)
- **Status**: ✅ Complete
- **Features**:
  - Browser version and metadata detection (/json/version)
  - Target enumeration (pages, workers, extensions)
  - Available targets listing (/json/list)
  - WebSocket debugger URL discovery
  - Protocol specification query (/json/protocol)
  - Browser info (Chrome version, V8, WebKit, User-Agent)
  - HTTP/1.1 over raw TCP socket implementation
  - **WebSocket tunnel for bidirectional CDP communication**
  - **JSON-RPC 2.0 command execution (all CDP domains)**
  - **JavaScript evaluation (Runtime.evaluate)**
  - **Page navigation and control (Page.navigate)**
  - **Screenshot capture (Page.captureScreenshot)**
  - **PDF generation (Page.printToPDF)**
  - **DOM inspection (DOM.getDocument)**
  - **Network monitoring (Network.enable)**
  - **CDP event subscriptions and real-time events**
  - WebSocket frame parsing and masking
  - Quick command buttons for common operations
  - Support for launching new tabs (/json/new)
- **UI**: Yes (connection form with endpoint query + WebSocket command execution)
- **Tests**: ⚠️ Awaiting deployment
- **Documentation**: docs/protocols/CDP.md
- **Note**: Requires Chrome/Chromium launched with --remote-debugging-port=9222

### Node Inspector (V8 Inspector Protocol)
- **Port**: 9229 (default)
- **Status**: ✅ Complete
- **Features**:
  - Debugging session discovery (/json, /json/list)
  - Node.js and V8 version detection (/json/version)
  - WebSocket debugger URL discovery (UUID-based session paths)
  - HTTP/1.1 over raw TCP socket implementation
  - **WebSocket tunnel for bidirectional V8 Inspector Protocol communication**
  - **JSON-RPC 2.0 command execution (all V8 Inspector domains)**
  - **JavaScript evaluation (Runtime.evaluate)**
  - **Heap usage inspection (Runtime.getHeapUsage)**
  - **Debugger control (Debugger.enable/pause/resume)**
  - **CPU profiling (Profiler.enable/start/stop)**
  - **Memory snapshots and heap profiling**
  - **Event subscriptions for debugging events**
  - WebSocket frame parsing and masking
  - Quick command buttons for common debugging operations
- **UI**: Yes (session discovery + WebSocket command execution)
- **Tests**: ⚠️ Awaiting deployment
- **Documentation**: docs/protocols/NODE-INSPECTOR.md
- **Note**: Requires Node.js launched with --inspect or --inspect-brk flag

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

### Source RCON (Steam/Valve Games)
- **Port**: 27015 (default, configurable)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Valve Source RCON binary protocol (same as Minecraft RCON)
  - Password authentication (SERVERDATA_AUTH)
  - Command execution (SERVERDATA_EXECCOMMAND)
  - Multi-packet response parsing
  - Input validation (host, port, password, command length)
  - Quick command buttons for Source Engine games (status, users, changelevel, etc.)
  - Player management commands (kick, ban, say)
  - Map control commands (changelevel, maps *, mp_restartgame)
  - Game-specific commands (CS:GO, TF2, L4D2, GMod)
  - Command history with re-execution
- **UI**: Yes (connection + command execution with Source-specific commands)
- **Tests**: ⚠️ Awaiting deployment (20 integration tests)
- **Documentation**: docs/protocols/SOURCE_RCON.md
- **Supported Games**: CS:GO, CS:Source, TF2, L4D2, HL2DM, Portal 2, Garry's Mod, DoD:S
- **Use Cases**: Game server administration, player management, map rotation, server monitoring

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

### DoT (DNS over TLS — RFC 7858)
- **Port**: 853 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - TLS-encrypted DNS queries (prevents eavesdropping)
  - A, AAAA, MX, TXT, NS, CNAME, SOA, SRV, PTR, ANY record types
  - Binary DNS protocol over TLS with 2-byte TCP length prefix
  - Response parsing with answer/authority/additional sections
  - RTT and TLS connect-time reporting
  - Pre-configured public DoT servers (Cloudflare, Google, Quad9, AdGuard)
  - Input validation (domain, port, record type)
- **UI**: Yes (domain + record type + server quick-select buttons)
- **Tests**: ⚠️ Awaiting deployment (5 integration tests)
- **Documentation**: docs/protocols/DOT.md

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

### SLP (Service Location Protocol — RFC 2608)
- **Port**: 427 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Service Type Request (SrvTypeRqst) — enumerate all available service types
  - Service Request (SrvRqst) — find services by type with optional LDAP predicate
  - Attribute Request (AttrRqst) — fetch key/value attributes for a service URL
  - Full SLP v2 binary protocol (header + length-prefixed strings)
  - SLP error code decoding (LANGUAGE_NOT_SUPPORTED, SCOPE_NOT_SUPPORTED, etc.)
  - Clickable service type → Find flow; clickable URL → Attributes flow
  - Cloudflare detection
- **UI**: Yes (three-tab interface: Service Types / Find Services / Attributes)
- **Tests**: ⚠️ Awaiting deployment (14 integration tests)
- **Documentation**: docs/protocols/SLP.md

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

### Oracle Database (TNS Protocol)
- **Port**: 1521 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - TNS (Transparent Network Substrate) protocol handshake
  - CONNECT/ACCEPT/REFUSE packet handling
  - Service Name connection (Oracle 8i+ modern method)
  - SID connection (legacy method)
  - Protocol version detection (TNS 314 / 0x013A)
  - SDU size and MTU negotiation
  - Server capability detection
  - Connection refusal reason parsing
  - Cloudflare detection
- **UI**: Yes (service name vs SID selection, connection test)
- **Tests**: ⚠️ Awaiting deployment (13 integration tests)
- **Documentation**: docs/protocols/ORACLE.md
- **Complexity**: Very High (proprietary protocol, reverse-engineered)

### Chrome DevTools Protocol (CDP)
- **Port**: 9222 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Browser version and metadata detection
  - Target enumeration (pages, workers, service workers, iframes)
  - WebSocket debugger URL discovery
  - HTTP JSON endpoint queries (/json/version, /json/list, /json/protocol)
  - CDP protocol specification retrieval
  - Browser information (Chrome version, V8, WebKit, User-Agent)
  - Raw HTTP/1.1 over TCP implementation
  - Chunked transfer encoding support
  - Cloudflare detection
- **UI**: Yes (connection discovery + query interface with quick actions)
- **Tests**: ⚠️ Awaiting deployment (15 integration tests)
- **Documentation**: docs/protocols/CDP.md
- **Use Cases**: Remote browser debugging, automation (Puppeteer/Playwright), performance monitoring
- **Complexity**: High (HTTP-based discovery, WebSocket JSON-RPC for full functionality)
- **Note**: HTTP discovery endpoints only - WebSocket command execution not yet implemented

### SAP MaxDB
- **Port**: 7200 (default X Server), 7210 (sql6)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - X Server connectivity testing
  - Binary protocol packet construction
  - Port 7200 (legacy) and 7210 (modern) support
  - Database name specification
  - Response hex dump analysis
  - MaxDB signature detection
  - Timeout handling
  - Cloudflare detection
- **UI**: Yes (connection form with port quick-select buttons)
- **Tests**: ⚠️ Awaiting deployment (13 integration tests)
- **Documentation**: docs/protocols/MAXDB.md
- **Use Cases**: SAP database connectivity testing, X Server health monitoring, network validation
- **Complexity**: Medium-High (proprietary NI/NISSL protocol)
- **Note**: Connection probing only - no authentication or SQL execution

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

### JSON-RPC 2.0 (over HTTP/TCP)
- **Port**: 8545 (Ethereum default), 8332 (Bitcoin default), configurable
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - JSON-RPC 2.0 method calls with positional or named params
  - Batch requests (multiple calls in one HTTP request)
  - Basic Auth support (Bitcoin RPC, secured endpoints)
  - Configurable HTTP path (default `/`)
  - Chunked transfer encoding support
  - Raw HTTP/1.1 over TCP socket
  - Quick call buttons for Ethereum (eth_blockNumber, eth_chainId, net_version, web3_clientVersion, eth_gasPrice, net_peerCount) and Bitcoin (getblockchaininfo, getblockcount, getnetworkinfo, getmininginfo)
- **UI**: Yes (connection form + method/params input with quick call buttons)
- **Tests**: ⚠️ Awaiting deployment (9 integration tests)
- **Documentation**: docs/protocols/JSONRPC.md
- **Use Cases**: Ethereum node interaction, Bitcoin RPC, custom JSON-RPC services
- **Spec**: https://www.jsonrpc.org/specification

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

### EPP (Extensible Provisioning Protocol)
- **Port**: 700 (default)
- **Status**: ✅ Complete (not yet deployed)
- **RFCs**: 5730 (base), 5731 (domain), 5732 (host), 5733 (contact), 5734 (TCP transport)
- **Features**:
  - XML-based protocol with 4-byte big-endian length-prefixed framing
  - Connect & Hello handshake (server greeting)
  - Login authentication (SASL PLAIN)
  - Domain availability check (check command)
  - Service name/SID support
  - Object URIs (domain, contact, host)
  - Transaction ID (clTRID) generation
  - XML response parsing (result code, messages)
  - Cloudflare detection
- **UI**: Yes (connection test + login + domain check)
- **Tests**: ⚠️ Awaiting deployment
- **Documentation**: RFCs 5730-5734
- **Use Cases**: Domain registration, registrar-registry provisioning, domain availability queries
- **Complexity**: High (XML protocol with length-prefixed framing, authenticated commands)
- **Note**: Only basic operations implemented (connect, login, domain check) - no create/transfer/update/delete

### FastCGI
- **Port**: 9000 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - FCGI_GET_VALUES probe (server capability discovery: max conns, max reqs, multiplexing)
  - Full CGI request (BEGIN_REQUEST + PARAMS + STDIN → STDOUT/STDERR/END_REQUEST)
  - Binary record format with 8-byte header and name-value pair encoding
  - Response header parsing from FCGI_STDOUT
  - Protocol status and exit code reporting
  - Cloudflare detection
- **UI**: Yes (probe tab + request tab with SCRIPT_FILENAME/REQUEST_URI fields)
- **Tests**: ⚠️ Awaiting deployment (14 integration tests)
- **Documentation**: docs/protocols/FASTCGI.md
- **Use Cases**: PHP-FPM health checks, WSGI application testing, backend connectivity validation

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

### Gadu-Gadu (GG)
- **Port**: 8074 (default), 443 (fallback)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - TCP connectivity testing
  - Binary protocol (Little-Endian)
  - GG_WELCOME packet parsing (seed extraction)
  - GG32 hash algorithm (legacy)
  - SHA-1 hash algorithm (modern)
  - GG_LOGIN80 authentication packet building
  - Login success/failure detection (GG_LOGIN80_OK/FAILED)
  - UIN (User Identification Number) validation (1-99999999)
  - Cloudflare detection
  - Timing statistics (connect, welcome, login)
  - Hash type selection (gg32 or sha1)
- **UI**: Yes (connection form with UIN, password, hash type)
- **Tests**: ⚠️ Awaiting deployment (10 integration tests)
- **Documentation**: docs/protocols/GADUGADU.md
- **Use Cases**: Polish instant messenger connectivity, protocol research, authentication testing
- **Complexity**: Medium (proprietary binary protocol with password hashing)
- **Note**: Connection and authentication only - messaging not implemented

### Rlogin (RFC 1282)
- **Port**: 513 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - TCP connectivity testing
  - Rlogin handshake (null byte + localUser\0remoteUser\0terminal/speed\0)
  - Server acceptance/rejection detection (first byte \0 = accepted)
  - Banner reading after handshake
  - WebSocket tunnel for interactive sessions
  - Terminal type and speed configuration
  - Cloudflare detection
  - RTT measurement
- **UI**: Yes (connection form with local/remote user, terminal type)
- **Tests**: ⚠️ Awaiting deployment (6 integration tests)
- **Security Note**: No encryption, no host key verification — cleartext credentials. Use SSH instead.
- **Complexity**: Low (simple binary handshake)

### Rexec (BSD Remote Execution)
- **Port**: 512 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - TCP connectivity testing
  - Full Rexec handshake (stderr port \0 + username\0 + password\0 + command\0)
  - Server acceptance/rejection detection (first byte \0 = success, \1 = error)
  - Command output reading (up to 10 chunks, 2s timeout)
  - WebSocket tunnel for interactive stdin/stdout sessions
  - Cloudflare detection
  - RTT measurement
  - GET (query params) and POST (JSON body) support
- **UI**: Yes (connection form with host/port/username/password/command, security warning)
- **Tests**: ⚠️ Awaiting deployment (5 integration tests)
- **Documentation**: docs/protocols/REXEC.md
- **Security Note**: Cleartext username and password — superseded by SSH. Use only for legacy system testing.
- **Complexity**: Low (simple null-delimited text handshake)
- **Note**: Stderr channel not implemented (Workers cannot accept inbound TCP connections for the secondary port)

### HTTP Proxy / CONNECT (RFC 9110 §9.3.6)
- **Port**: 3128 (Squid default), 8080, 8888
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Forward proxy probe: sends absolute-URI GET request (`GET http://example.com/ HTTP/1.1`)
  - CONNECT tunnel test: sends `CONNECT host:port HTTP/1.1` and reads tunnel establishment response
  - HTTP 200 (tunnel established), 407 (auth required) response parsing
  - Proxy type fingerprinting from response headers (Squid, Nginx, Apache, HAProxy, Varnish, Tinyproxy, Privoxy, CCProxy)
  - Proxy-Authorization Basic auth support (user:password)
  - Via / Proxy-Agent header detection and reporting
  - Cloudflare detection
  - RTT measurement
  - GET (query params) and POST (JSON body) support for forward proxy probe
- **UI**: Yes (proxy server config + forward proxy test + CONNECT tunnel test panels)
- **Tests**: ⚠️ Awaiting deployment (7 integration tests)
- **Documentation**: docs/protocols/HTTPPROXY.md
- **Complexity**: Low (text-based HTTP, single TCP connection per operation)
- **Comparison**: Complements SOCKS4/SOCKS5 proxy testing with HTTP-layer proxy capabilities

### BGP (Border Gateway Protocol)
- **Port**: 179 (default)
- **Status**: ✅ Complete (not yet deployed)
- **RFC**: RFC 4271 (BGP-4)
- **Features**:
  - TCP connectivity testing
  - BGP OPEN message construction (16-byte 0xFF marker, version, AS, hold time, router ID)
  - Server OPEN response parsing (peer AS, hold time, router ID)
  - Capability detection (Multiprotocol Extensions, Route Refresh, 4-Octet AS, Graceful Restart, ADD-PATH, FQDN)
  - KEEPALIVE exchange for session establishment confirmation
  - NOTIFICATION parsing (error code, subcode, human-readable names)
  - Cloudflare detection
  - RTT and connect-time measurement
- **UI**: Yes (host/port + localAS/routerID config, OPEN response with capabilities table, message type reference, AS range table)
- **Tests**: ⚠️ Awaiting deployment (6 integration tests)
- **Complexity**: Medium (binary protocol with BGP message framing)
- **Note**: Sends OPEN for capability probing only — does not advertise or withdraw routes

### Diameter Protocol
- **Port**: 3868 (default), 3869 (TLS)
- **Status**: ✅ Complete (not yet deployed)
- **RFC**: RFC 6733
- **Features**:
  - Capabilities-Exchange-Request/Answer (CER/CEA) — peer capability negotiation
  - Device-Watchdog-Request/Answer (DWR/DWA) — keepalive with RTT measurement
  - AVP parsing (Origin-Host, Origin-Realm, Product-Name, Vendor-Id, Result-Code)
  - Clean disconnect via Disconnect-Peer-Request (DPR)
  - Cloudflare detection
  - Configurable Origin-Host and Origin-Realm
- **UI**: Yes (host/port/originHost/originRealm fields, two-step CER then DWR flow, AVP output)
- **Tests**: ⚠️ Awaiting deployment (11 integration tests)
- **Complexity**: Medium (binary protocol with Diameter message framing and AVP encoding)

### SVN (Subversion)
- **Port**: 3690 (default)
- **Status**: ✅ Complete
- **Features**: SVN protocol greeting and capability detection, anonymous repository probe
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment

### Fluentd / Fluent-bit
- **Port**: 24224 (default)
- **Status**: ✅ Complete
- **Features**: MessagePack-framed log forwarding, tag + JSON record sending, ACK detection
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment

### WinRM (Windows Remote Management)
- **Port**: 5985 (HTTP), 5986 (HTTPS)
- **Status**: ✅ Complete
- **Features**: WSMAN Identify probe (anonymous), auth method detection, product vendor & version discovery
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment

### SPICE (Simple Protocol for Independent Computing Environments)
- **Port**: 5900 (default)
- **Status**: ✅ Complete
- **Features**: SPICE handshake, server capabilities detection, VM display remoting probe
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment

### Hazelcast IMDG
- **Port**: 5701 (default)
- **Status**: ✅ Complete
- **Features**: Authentication & cluster probe, version & member count detection, cluster name discovery
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment

### Zabbix
- **Port**: 10050 (agent), 10051 (server)
- **Status**: ✅ Complete
- **Features**: Zabbix protocol header detection, agent.version query, active check capability
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment

### iSCSI
- **Port**: 3260 (default)
- **Status**: ✅ Complete
- **Features**: iSCSI login negotiation, target discovery, SendTargets probe
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment

### Icecast
- **Port**: 8000 (default)
- **Status**: ✅ Complete
- **Features**: HTTP-based stream source connection, mountpoint listing, server info
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment

### DICOM (Digital Imaging and Communications in Medicine)
- **Port**: 104 (default)
- **Status**: ✅ Complete
- **Features**: DICOM Association Request (A-ASSOCIATE-RQ), SOP class negotiation, AE title detection
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment

### Apache Thrift
- **Port**: 9090 (default)
- **Status**: ✅ Complete
- **Features**: Thrift binary/compact/JSON transport detection, service introspection probe
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment

### InfluxDB
- **Port**: 8086 (default)
- **Status**: ✅ Complete
- **Features**: HTTP API version detection, health check, database listing (v1) / bucket listing (v2)
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment

### Consul
- **Port**: 8500 (default)
- **Status**: ✅ Complete
- **Features**: Agent info & version, service catalog enumeration, datacenter discovery
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment

### Nomad
- **Port**: 4646 (default)
- **Status**: ✅ Complete
- **Features**: Agent info & version, node & job listing, datacenter discovery
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment

### RADIUS (Remote Authentication Dial-In User Service)
- **Port**: 1812 (auth), 1813 (accounting)
- **Status**: ✅ Complete
- **RFC**: RFC 2865
- **Features**: Access-Request with MD5 password obfuscation, Access-Accept/Reject/Challenge detection, shared secret
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment

### Kerberos
- **Port**: 88 (default)
- **Status**: ✅ Complete
- **RFC**: RFC 4120
- **Features**: AS-REQ probe for KDC detection, realm & principal enumeration, error code parsing
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment

### NFS (Network File System)
- **Port**: 2049 (default)
- **Status**: ✅ Complete
- **RFC**: RFC 7530 (v4)
- **Features**: NFSv4 NULL procedure probe, mount path enumeration, server detection
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment

### H.323 (ITU-T Video/Voice Conferencing)
- **Port**: 1720 (default)
- **Status**: ✅ Complete
- **Features**: Q.931 SETUP message, H.225 capability exchange, endpoint type detection
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment

### SCCP (Cisco Skinny Client Control Protocol)
- **Port**: 2000 (default)
- **Status**: ✅ Complete
- **Features**: Register request, station registration detection, Cisco IP phone protocol
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment

### MGCP (Media Gateway Control Protocol)
- **Port**: 2427 (default)
- **Status**: ✅ Complete
- **RFC**: RFC 3435
- **Features**: AUEP endpoint probe, gateway capability detection, response code parsing
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment

### OpenVPN
- **Port**: 1194 (default)
- **Status**: ✅ Complete
- **Features**: P_CONTROL_HARD_RESET_CLIENT_V2 probe, TLS mode detection, server reset detection
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment

### Beats / Lumberjack v2 (Elastic)
- **Port**: 5044 (default)
- **Status**: ✅ Complete
- **Features**: Lumberjack v2 binary framing, WINDOW/DATA/ACK frames, compressed JSON event batches
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment

### CoAP (Constrained Application Protocol)
- **Port**: 5683 (default, TCP variant)
- **Status**: ✅ Complete
- **RFC**: RFC 7252 / RFC 8323 (TCP)
- **Features**: GET/POST/PUT/DELETE methods, resource discovery (/.well-known/core), TCP framing
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment

### MSRP (Message Session Relay Protocol)
- **Port**: 2855 (default)
- **Status**: ✅ Complete
- **RFC**: RFC 4975
- **Features**: SEND request with To-Path/From-Path, transaction ID matching, MIME content type support
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment

### RadSec (RADIUS over TLS)
- **Port**: 2083 (default)
- **Status**: ✅ Complete
- **RFC**: RFC 6614
- **Features**: RADIUS over TLS (no shared secret), Access-Accept/Reject detection, eduroam / 802.1X
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment

### SIPS (SIP over TLS)
- **Port**: 5061 (default)
- **Status**: ✅ Complete
- **RFC**: RFC 3261
- **Features**: OPTIONS capability probe, REGISTER auth probe (401 detection), server & Allow header parsing
- **UI**: Yes
- **Tests**: ⚠️ Awaiting deployment

### RSH (BSD Remote Shell)
- **Port**: 514/tcp
- **Status**: ✅ Complete
- **RFC**: RFC 1282
- **Features**:
  - .rhosts trust handshake (no password sent)
  - Privileged port rejection detection (Workers connect from port > 1023)
  - Command execution with output streaming
  - WebSocket tunnel for interactive use
  - Cloudflare detection
- **UI**: Yes (host/port/localUser/remoteUser/command fields, privileged port note)
- **Tests**: ✅ 6 integration tests
- **Documentation**: docs/protocols/RSH.md
- **Complexity**: Low (text protocol, similar to Rexec/Rlogin)

### Kubernetes API Server
- **Port**: 6443 (default, HTTPS/TLS)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Health probe via `/healthz` endpoint (HTTPS over TLS)
  - TCP latency measurement
  - HTTP status and server header detection
  - Auth requirement detection (401/403)
  - Arbitrary API path query with Bearer token support
  - Quick access to common endpoints (/version, /api, /apis, /api/v1/namespaces, /api/v1/nodes, /api/v1/pods)
  - Cloudflare detection
- **UI**: Yes (probe + query interface with quick path buttons)
- **Tests**: ⚠️ Awaiting deployment
- **Documentation**: https://kubernetes.io/docs/reference/using-api/
- **Complexity**: Medium (HTTPS REST, Bearer token auth)
- **Note**: Health endpoints often require no auth; all resource endpoints require a ServiceAccount token

### UUCP (Unix-to-Unix Copy Protocol)
- **Port**: 540 (uucpd)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Wakeup handshake (`\r\0`)
  - Server system name extraction from greeting (`Shere\0`)
  - System name negotiation (`S{name}\0`)
  - TCP latency measurement
  - Cloudflare detection
- **UI**: Yes (host/port/system name + probe button)
- **Tests**: ⚠️ Awaiting deployment
- **Documentation**: RFC 976
- **Complexity**: Low (legacy binary handshake)
- **Note**: UUCP is a historical protocol; modern systems rarely run it. Security warning displayed in UI.

### Perforce Helix Core (p4d)
- **Port**: 1666 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Protocol negotiation probe (binary tagged key-value pairs)
  - Server version detection
  - Server info query (address, date, license, root, case handling)
  - TCP latency measurement
  - Cloudflare detection
- **UI**: Yes (host/port + "Probe (Protocol)" and "Server Info" buttons)
- **Tests**: ⚠️ Awaiting deployment
- **Documentation**: Perforce technical notes
- **Complexity**: Medium (proprietary binary protocol, reverse-engineered)

### Quake 3 Arena / id Tech 3
- **Port**: 27960 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - `getstatus` — full server variables + player list
  - `getinfo` — summary query (no player details)
  - OOB packet format (`\xFF\xFF\xFF\xFF{command}\n`)
  - `\key\value\` server variable parsing
  - Player line parsing (score, ping, name)
  - UDP latency measurement
  - Cloudflare detection
- **UI**: Yes (host/port + getstatus/getinfo buttons + server vars + player table)
- **Tests**: ⚠️ Awaiting deployment
- **Documentation**: id Software Quake 3 networking docs
- **Complexity**: Low (UDP OOB packets, text parsing)
- **Note**: Protocol shared by Quake 3, Urban Terror, OpenArena, and many other id Tech 3 games

### collectd (Binary Protocol)
- **Port**: 25826 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - Listen for pushed metric data (server broadcast detection)
  - TLV (Type-Length-Value) part decoding
  - GAUGE metric send (plugin/type/value)
  - UDP latency measurement
  - Cloudflare detection
- **UI**: Yes (probe listen tab + metric send form with plugin/type/value fields)
- **Tests**: ⚠️ Awaiting deployment
- **Documentation**: collectd binary protocol spec
- **Complexity**: Medium (binary TLV, big-endian encoding)

### Ethereum P2P / RLPx
- **Port**: 30303 (default)
- **Status**: ✅ Complete (partial — not yet deployed)
- **Features**:
  - TCP connectivity check
  - RLPx fingerprinting (EIP-8 or legacy 307-byte auth-message detection)
  - Received bytes analysis
  - TCP latency measurement
  - Cloudflare detection
- **UI**: Yes (host/port + probe button + limitations disclosure)
- **Tests**: ⚠️ Awaiting deployment
- **Documentation**: https://github.com/ethereum/devp2p/blob/master/rlpx.md
- **Complexity**: Very High (full RLPx requires secp256k1 ECIES — unavailable in Workers)
- **Note**: Full handshake not possible in Cloudflare Workers (no secp256k1); probe confirms port open + fingerprints initial bytes

### IPFS / libp2p (Multistream-Select)
- **Port**: 4001 (default)
- **Status**: ✅ Complete (not yet deployed)
- **Features**:
  - libp2p multistream-select protocol negotiation
  - Varint-prefixed message encoding/decoding
  - `ls` command for available protocol listing
  - Protocol negotiation (/p2p/0.1.0, /ipfs/0.1.0, /ipfs/kad/1.0.0)
  - TCP latency measurement
  - Cloudflare detection
- **UI**: Yes (host/port + probe button + negotiated/unsupported protocol lists)
- **Tests**: ⚠️ Awaiting deployment
- **Documentation**: https://github.com/multiformats/multistream-select
- **Complexity**: Medium (custom varint framing + multistream protocol)

## 🔒 Security Features

### Cloudflare Detection
- **Status**: ✅ Complete
- **Features**: Automatic detection and blocking of Cloudflare-protected hosts
- **Tests**: ✅ Passing (5/5)
- **Documentation**: docs/CLOUDFLARE_DETECTION.md

## Summary

- **Total Implemented**: 109 protocols + 1 security feature
- **Deployed & Passing**: 14 protocols
- **Awaiting Deployment**: 69 protocols
- **Real-World Usage Tests**: 403 integration tests covering all protocols with realistic hosts/ports/parameters
- **Test Coverage** (by protocol):
  - Source RCON (20), POP3 (18), IMAP (17), Redis (17), CDP (15), Docker (14), SSH (14), SMTP (14), Oracle (13), MaxDB (13), MQTT (13), LDAP (13), MySQL (12), SMB (10), Gadu-Gadu (10), Discard (9), Napster (9), PPTP (9), Echo (9), PostgreSQL (9), Telnet (9), Beanstalkd (8), Syslog (11+11), SOCKS4 (10+7), WHOIS (8+8), LPD (7), 9P (7), SFTP (7), DNS (7), HTTP Proxy (7), BGP (6), Ventrilo (6), Rlogin (6), Finger (6), TCP Ping (6), Memcached (6), Cloudflare Detection (5), RCON (5), Rexec (5), DoT (5), Rsync (5), Modbus (5), LMTP (5), MongoDB (4), Graphite (4), Git (4), ZooKeeper (4), IRC (4), Gopher (4), Daytime (4), Time (4), Gemini (3), NNTP (3), AMQP (3), Kafka (3), RTSP (3), CHARGEN (3), Cassandra (3), STOMP (2), TDS (2), VNC (2), Neo4j (2), RTMP (2), TACACS+ (2), HL7 (2), Elasticsearch (2), AJP (2), XMPP (2), RDP (2), NATS (2), JetDirect (2)
