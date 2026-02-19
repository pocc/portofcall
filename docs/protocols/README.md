# Protocol Implementation Plans

This directory contains detailed implementation plans for protocols that can be accessed through Port of Call's web UI.

## ⚠️ Important: TCP vs Non-TCP Protocols

**Cloudflare Workers Sockets API** (`connect()`) **only supports TCP connections**. Protocols have been organized as follows:

- **`docs/protocols/`** - TCP-based protocols (✅ Compatible with Cloudflare Workers)
- **`docs/protocols/non-tcp/`** - UDP and raw IP protocols (❌ Not compatible with Cloudflare Workers)

Non-TCP protocols are documented for reference but require alternative implementation approaches (native sockets, specialized gateways, or protocol translation).

## Organization

Plans are organized by category and numbered by priority.

### ✅ Implemented Plans (Ready to Build)

**Quick Wins (Start Here)**:
- [ECHO.md](./ECHO.md) - TCP echo test (simplest protocol)
- [WHOIS.md](./WHOIS.md) - Domain lookup (simple request/response)
- [DNS.md](./DNS.md) - DNS queries over TCP (debugging tool)
- [MEMCACHED.md](./MEMCACHED.md) - Distributed caching (text protocol)

**Newly Added Docs (2026-02-19):**
- [SUBMISSION.md](./SUBMISSION.md) - SMTP Submission (port 587, STARTTLS workflow)
- [TCP.md](./TCP.md) - Raw TCP send/receive diagnostics endpoint
- [TFTP.md](./TFTP.md) - TFTP-over-TCP experimental implementation (Worker-compatible, non-standard)
- [TORCONTROL.md](./TORCONTROL.md) - Tor control protocol (probe/getinfo/signal)
- [UWSGI.md](./UWSGI.md) - uWSGI binary wire protocol
- [VARNISH.md](./VARNISH.md) - Varnish CLI administration protocol
- [YMSG.md](./YMSG.md) - Yahoo Messenger legacy protocol tooling


**Databases (High Priority)**:
- [REDIS.md](./REDIS.md) - Redis database client (text protocol, high value)
- [MYSQL.md](./MYSQL.md) - MySQL database client (binary protocol, popular)
- [TDS.md](./TDS.md) - Tabular Data Stream (Microsoft SQL Server, port 1433)
- [POSTGRESQL.md](./POSTGRESQL.md) - PostgreSQL database client (advanced features)
- [MONGODB.md](./MONGODB.md) - MongoDB NoSQL client (document database)
- [CASSANDRA.md](./CASSANDRA.md) - Cassandra NoSQL client (CQL binary protocol)
- [NEO4J.md](./NEO4J.md) - Neo4j graph database (Bolt protocol)
- [INFLUXDB.md](./INFLUXDB.md) - InfluxDB time-series database (Line Protocol)

**Terminal Access & Remote Desktop**:
- [SSH.md](./SSH.md) - Secure Shell (complex, flagship feature)
- [MOSH.md](./non-tcp/MOSH.md) ⚠️ UDP - Mobile Shell (roaming-capable SSH alternative, UDP 60000-61000)
- [TELNET.md](./TELNET.md) - Legacy remote terminal (educational)
- [RDP.md](./RDP.md) - Remote Desktop Protocol (Windows remote access)
- [X11.md](./X11.md) - X Window System (Unix/Linux graphical applications)

**Email Protocols**:
- [SMTP.md](./SMTP.md) - Email sending (transactional email)
- [POP3.md](./POP3.md) - Email reading (simple, legacy)
- [IMAP.md](./IMAP.md) - Email reading (modern, complex, multi-device)

**Streaming & VoIP**:
- [RTSP.md](./RTSP.md) - Real Time Streaming Protocol (IP cameras, media servers)
- [RTCP.md](./non-tcp/RTCP.md) ⚠️ UDP - RTP Control Protocol (RTP quality feedback, port RTP+1)
- [SAP.md](./non-tcp/SAP.md) ⚠️ UDP - Session Announcement Protocol (multicast session discovery, UDP 9875)
- [SIP.md](./non-tcp/SIP.md) ⚠️ UDP - Session Initiation Protocol (VoIP signaling)
- [RTMP.md](./RTMP.md) - Real-Time Messaging Protocol (live video streaming)
- [H323.md](./H323.md) - H.323 multimedia communications (legacy VoIP/video conferencing)
- [SCCP.md](./SCCP.md) - Skinny Client Control Protocol (Cisco IP phones)
- [MGCP.md](./MGCP.md) - Media Gateway Control Protocol (carrier VoIP call control)

**NAT Traversal & VPN**:
- [STUN.md](./non-tcp/STUN.md) ⚠️ UDP - Session Traversal Utilities for NAT (NAT type detection, port 3478)
- [TURN.md](./non-tcp/TURN.md) ⚠️ UDP - Traversal Using Relays around NAT (media relay, port 3478)
- [IKE.md](./non-tcp/IKE.md) ⚠️ UDP - IKE/ISAKMP (IPsec VPN key exchange, ports 500/4500)
- [OPENVPN.md](./OPENVPN.md) - OpenVPN Protocol (SSL/TLS VPN, port 1194)
- [WIREGUARD.md](./non-tcp/WIREGUARD.md) ⚠️ UDP - WireGuard VPN (modern, fast, simple VPN, port 51820)
- [L2TP.md](./non-tcp/L2TP.md) ⚠️ UDP - Layer 2 Tunneling Protocol (VPN, port 1701)
- [PPTP.md](./PPTP.md) - Point-to-Point Tunneling Protocol (legacy VPN, port 1723)

**Modern Web & RPC**:
- [HTTP2.md](./HTTP2.md) - HTTP/2 (binary framing, multiplexing, server push, ports 80/443)
- [WEBSOCKET.md](./WEBSOCKET.md) - WebSocket Protocol (full-duplex real-time communication, ports 80/443)
- [GRPC.md](./GRPC.md) - gRPC (HTTP/2-based RPC framework, Protocol Buffers)
- [JSONRPC.md](./JSONRPC.md) - JSON-RPC (lightweight RPC using JSON, blockchain/APIs)
- [SOAP.md](./SOAP.md) - SOAP (XML-based web services, enterprise/legacy)
- [QUIC.md](./non-tcp/QUIC.md) ⚠️ UDP - QUIC (UDP-based HTTP/3 transport, RFC 9000)
- [FASTCGI.md](./FASTCGI.md) - FastCGI (web server to application protocol, port 9000)
- [AJP.md](./AJP.md) - Apache JServ Protocol (Apache to Tomcat, port 8009)

**Real-Time Messaging & Queues**:
- [MQTT.md](./MQTT.md) - IoT messaging dashboard (pub/sub pattern)
- [IRC.md](./IRC.md) - Internet Relay Chat (classic chat protocol)
- [RABBITMQ.md](./RABBITMQ.md) - RabbitMQ message broker (AMQP protocol)
- [AMQP.md](./AMQP.md) - Advanced Message Queuing Protocol (RabbitMQ foundation, port 5672)
- [KAFKA.md](./KAFKA.md) - Apache Kafka distributed streaming (port 9092)
- [NATS.md](./NATS.md) - NATS lightweight messaging (simple text protocol)
- [XMPP.md](./XMPP.md) - Jabber instant messaging (XMPP/Jabber protocol)
- [STOMP.md](./STOMP.md) - Simple Text Oriented Messaging Protocol (message broker)
- [NNTP.md](./NNTP.md) - Network News Transfer Protocol (Usenet newsgroups)
- [CoAP.md](./non-tcp/COAP.md) ⚠️ UDP - Constrained Application Protocol (IoT, port 5683)
- [THRIFT.md](./THRIFT.md) - Apache Thrift RPC (cross-language services)
- [MATRIX.md](./MATRIX.md) - Matrix Protocol (decentralized communication, federation)

**File Transfer, Storage & File Systems**:
- [FTP.md](./FTP.md) - File Transfer Protocol (legacy but common)
- [FTPS.md](./FTPS.md) - FTP over SSL/TLS (encrypted file transfer, ports 21/990)
- [SFTP.md](./SFTP.md) - SSH File Transfer Protocol (secure, modern)
- [SCP.md](./SCP.md) - Secure Copy Protocol (simple SSH-based file copy, port 22)
- [TFTP.md](./non-tcp/TFTP.md) ⚠️ UDP - Trivial File Transfer Protocol (standard RFC 1350 transport)
- [GIT.md](./GIT.md) - Git protocol client (repository browsing)
- [RSYNC.md](./RSYNC.md) - Rsync file synchronization (delta-transfer algorithm)
- [NFS.md](./NFS.md) - Network File System (Unix/Linux file sharing, port 2049)
- [SMB.md](./SMB.md) - Server Message Block (Windows file sharing)
- [CIFS.md](./CIFS.md) - Common Internet File System (SMB 1.0, deprecated)
- [AFP.md](./AFP.md) - Apple Filing Protocol (macOS file sharing, deprecated)
- [9P.md](./9P.md) - Plan 9 Filesystem Protocol (network-transparent file access)
- [ISCSI.md](./ISCSI.md) - Internet SCSI (block-level storage over IP, port 3260)
- [BITTORRENT.md](./BITTORRENT.md) - BitTorrent P2P file sharing (distributed downloads)

**DNS & Name Resolution**:
- [DNS.md](./DNS.md) - Domain Name System (name resolution)
- [DOT.md](./DOT.md) - DNS over TLS (encrypted DNS, port 853)
- [DOH.md](./DOH.md) - DNS over HTTPS (encrypted DNS over HTTPS)
- [MDNS.md](./non-tcp/MDNS.md) ⚠️ UDP - Multicast DNS / Bonjour (local network discovery, port 5353)
- [LLMNR.md](./non-tcp/LLMNR.md) ⚠️ UDP - Link-Local Multicast Name Resolution (Windows name resolution)

**Service Discovery & Multicast**:
- [UPNP.md](./non-tcp/UPNP.md) ⚠️ UDP - Universal Plug and Play (device discovery, port 1900)
- [IGMP.md](./non-tcp/IGMP.md) ⚠️ IP - Internet Group Management Protocol (multicast group management)

**Routing & QoS**:
- [OSPF.md](./non-tcp/OSPF.md) ⚠️ IP - Open Shortest Path First (link-state routing, IP protocol 89)
- [RIP.md](./non-tcp/RIP.md) ⚠️ UDP - Routing Information Protocol (distance-vector routing, UDP 520)
- [BGP.md](./BGP.md) - Border Gateway Protocol (Internet routing, port 179)
- [RSVP.md](./non-tcp/RSVP.md) ⚠️ IP - Resource Reservation Protocol (QoS signaling, IP protocol 46)

**Network & Infrastructure**:
- [SOCKS4.md](./SOCKS4.md) - SOCKS4 proxy (legacy proxy protocol, port 1080)
- [SOCKS5.md](./SOCKS5.md) - SOCKS5 proxy (tunnel other protocols)
- [VRRP.md](./non-tcp/VRRP.md) ⚠️ IP - Virtual Router Redundancy Protocol (gateway failover, IP protocol 112)
- [HSRP.md](./non-tcp/HSRP.md) ⚠️ UDP - Hot Standby Router Protocol (Cisco gateway redundancy, UDP 1985)
- [IPSEC.md](./non-tcp/IPSEC.md) ⚠️ IP - IPsec (VPN encryption/authentication, IP protocols 50/51, UDP 500/4500)
- [SCTP.md](./non-tcp/SCTP.md) ⚠️ IP - Stream Control Transmission Protocol (multi-streaming transport)
- [LDAP.md](./LDAP.md) - Directory browsing (Active Directory, user management)
- [DOCKER.md](./DOCKER.md) - Container management (Docker Engine API)
- [ELASTICSEARCH.md](./ELASTICSEARCH.md) - Search and analytics engine
- [ETCD.md](./ETCD.md) - etcd distributed key-value store (service discovery)
- [SYSLOG.md](./SYSLOG.md) - Syslog centralized logging (RFC 5424)
- [GRAPHITE.md](./GRAPHITE.md) - Graphite metrics collection (plaintext protocol)
- [NTP.md](./non-tcp/NTP.md) ⚠️ UDP - Network Time Protocol (microsecond-precision time sync)
- [SNMP.md](./non-tcp/SNMP.md) ⚠️ UDP - Simple Network Management Protocol (device monitoring)
- [CONSUL.md](./CONSUL.md) - Consul service discovery (HTTP API, KV store)
- [ZOOKEEPER.md](./ZOOKEEPER.md) - ZooKeeper distributed coordination (binary protocol)
- [RADIUS.md](./RADIUS.md) - RADIUS authentication (AAA protocol, port 1812/1813)
- [TACACS+.md](./TACACS+.md) - TACACS+ authentication (Cisco AAA, port 49)
- [DIAMETER.md](./DIAMETER.md) - Diameter AAA protocol (4G/5G mobile networks, port 3868)
- [KERBEROS.md](./KERBEROS.md) - Kerberos network authentication (port 88)
- [SLP.md](./SLP.md) - Service Location Protocol (service discovery, port 427)

**Legacy/Educational/Retro**:
- [FINGER.md](./FINGER.md) - User info lookup (1977 protocol, educational)
- [GOPHER.md](./GOPHER.md) - Pre-Web internet browsing (1991, retro)
- [SPDY.md](./SPDY.md) - SPDY Protocol (HTTP/2 predecessor, deprecated 2016)
- [GEMINI.md](./GEMINI.md) - Gemini Protocol (modern alt-web, port 1965)
- [DAYTIME.md](./DAYTIME.md) - Daytime time service (1983, simplest protocol)
- [CHARGEN.md](./CHARGEN.md) - Character generator (1983, network testing)
- [TIME.md](./TIME.md) - Binary time protocol (1983, RFC 868)

**Specialized/Industrial/Gaming**:
- [MODBUS.md](./MODBUS.md) - Industrial automation (SCADA, PLCs)
- [MINECRAFT_RCON.md](./MINECRAFT_RCON.md) - Game server administration
- [VNC.md](./VNC.md) - Remote desktop / screen sharing (graphical)
- [JETDIRECT.md](./JETDIRECT.md) - HP JetDirect network printing (port 9100)
- [IPMI.md](./IPMI.md) - Intelligent Platform Management Interface (out-of-band server management, port 623)

**Healthcare/Medical**:
- [DICOM.md](./DICOM.md) - Medical imaging (PACS, CT, MRI, X-ray, port 104)
- [HL7.md](./HL7.md) - Health Level 7 messaging (ADT, ORU, clinical data)

## Implementation Plan Format

Each protocol plan follows this structure:

1. **Overview** - Protocol description, RFC references, use cases
2. **Protocol Specification** - Wire format, commands, responses
3. **Worker Implementation** - TypeScript code for Worker-side handling
4. **Web UI Design** - React components, user interface mockups
5. **Data Flow** - Sequence diagrams for browser ↔ Worker ↔ backend
6. **Security** - Authentication, validation, rate limiting
7. **Testing** - Unit tests, integration tests, test servers
8. **Resources** - Documentation, libraries, examples

## Development Roadmap

### Phase 1: Foundation (Quick Wins)
Start with simple protocols to establish patterns:
- ECHO, WHOIS, FINGER - Simple request/response
- Build reusable components for connection management

### Phase 2: High-Value Protocols
- Redis - Most requested, simple text protocol
- MySQL/PostgreSQL - Database connectivity
- SSH - Terminal emulation (complex)

### Phase 3: Specialized
- MQTT, IRC - Real-time messaging
- Git, Docker - Developer tools
- SMTP/IMAP - Email client

### Phase 4: Industrial/Niche
- Modbus, Minecraft RCON, etc.

## Common Patterns

All protocol implementations share these patterns:

### Worker Socket Handler
```typescript
async function handleProtocol(request: Request, env: Env) {
  const { host, port } = await parseRequest(request);
  const socket = connect(`${host}:${port}`);
  await socket.opened;

  // Protocol-specific handling
  const protocol = new ProtocolHandler(socket);
  return protocol.handleConnection();
}
```

### WebSocket Tunnel
```typescript
const pair = new WebSocketPair();
const [client, server] = Object.values(pair);
server.accept();

pipeWebSocketToSocket(server, socket);
pipeSocketToWebSocket(socket, server);
```

### UI Component Structure
```typescript
function ProtocolClient() {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);

  const connect = async (host: string, port: number) => {
    const ws = new WebSocket(`/api/connect/${protocol}`);
    // ... handle protocol-specific UI
  };
}
```

## Contributing

When adding a new protocol plan:

1. Copy the template from an existing protocol
2. Fill in protocol-specific details
3. Add to this README under appropriate category
4. Update the roadmap if needed
5. Consider cross-protocol patterns and reusability
