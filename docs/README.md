# Port of Call Documentation

Complete documentation for Port of Call - a browser-to-TCP bridge via Cloudflare Workers Sockets API.

## 📚 Documentation Index

### Getting Started
- **[Project Overview](PROJECT_OVERVIEW.md)** - What is Port of Call? Core concepts and use cases
- **[Architecture](ARCHITECTURE.md)** - Technical architecture, data flow, deployment
- **[Quick Start Guide](../README.md)** - Installation and deployment instructions

### Development Guides
- **[ADD_PROTOCOL Guide](guides/ADD_PROTOCOL.md)** - Step-by-step workflow for implementing new protocols
- **[Implementation Guide](guides/IMPLEMENTATION_GUIDE.md)** - Patterns, best practices, common pitfalls
- **[Local Testing](guides/LOCAL_TESTING.md)** - Testing strategies and local development setup
- **[Cross-Platform Notes](guides/CROSS_PLATFORM.md)** - Platform compatibility considerations
- **[API Examples Validation](guides/API_EXAMPLES_VALIDATION.md)** - API testing and validation procedures

### Technical References
- **[Sockets API Reference](reference/SOCKETS_API.md)** - Cloudflare Workers Sockets API guide
- **[TCP Protocols List](reference/TCP_PROTOCOLS.md)** - Comprehensive list of implementable TCP protocols
- **[Impossible Protocols](reference/IMPOSSIBLE.md)** - Protocols that cannot run on Workers (UDP, raw sockets)
- **[Implemented Protocols](reference/IMPLEMENTED.md)** - Complete list of 181 implemented protocols with test status
- **[Internet Standards Analysis](reference/INTERNET_STANDARDS.md)** - RFC Internet Standards feasibility analysis
- **[RFC Compliance Audit](reference/RFC_COMPLIANCE_AUDIT.md)** - Protocol standards compliance review
- **[Cloudflare Detection](reference/CLOUDFLARE_DETECTION.md)** - Connection restrictions and workarounds
- **[SSH Authentication](reference/SSH_AUTHENTICATION.md)** - Password and private key authentication deep dive
- **[Documentation Summary](reference/DOCUMENTATION_SUMMARY.md)** - Overview of all documentation files
- **[Power Users Guide](reference/POWER_USERS_HAPPY.md)** - Advanced features and usage patterns
- **[Naming History](reference/NAMING_HISTORY.md)** - How we chose "Port of Call"

### Protocol Specifications
- **[protocols/](protocols/)** - Individual protocol specs (242 protocols)
  - [SSH](protocols/SSH.md), [Shadowsocks](protocols/SHADOWSOCKS.md), [TURN](protocols/TURN.md), [Redis](protocols/REDIS.md), [MySQL](protocols/MYSQL.md), etc.
- **[protocols/QUICK_REFERENCE.md](protocols/QUICK_REFERENCE.md)** - One-page cheat sheet for protocol implementation
- **[protocols/non-tcp/](protocols/non-tcp/)** - Non-TCP protocol specs (27 protocols)

### Changelog & Bug Fixes
- **[REVIEWED.md](REVIEWED.md)** - Protocol review index and navigation
- **[changelog/](changelog/)** - Historical bug fixes and protocol reviews
  - [Critical Fixes Summary](changelog/critical-fixes.md) - All high-severity bugs (24 protocols)
  - [Medium Fixes Summary](changelog/medium-fixes.md) - All medium-severity bugs (31 protocols)
  - [2026-02-18 Protocol Review](changelog/2026-02-18-protocol-review.md) - Comprehensive audit overview
  - [By Protocol Changelogs](changelog/by-protocol/) - Individual protocol bug reports (86 protocols)

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
1. [Architecture](ARCHITECTURE.md) - System design
2. [Sockets API Reference](reference/SOCKETS_API.md) - Core technology
3. [Impossible Protocols](reference/IMPOSSIBLE.md) - Technical limitations
4. [Cloudflare Detection](reference/CLOUDFLARE_DETECTION.md) - Security considerations
5. [RFC Compliance Audit](reference/RFC_COMPLIANCE_AUDIT.md) - Standards compliance

### For Security Reviewers
Security and bug fixes:
1. [Critical Fixes Summary](changelog/critical-fixes.md) - 200+ security/data corruption bugs fixed
2. [2026-02-18 Protocol Review](changelog/2026-02-18-protocol-review.md) - Comprehensive audit results
3. [Cloudflare Detection](reference/CLOUDFLARE_DETECTION.md) - SSRF protection
4. [SSH Authentication](reference/SSH_AUTHENTICATION.md) - Auth security deep dive

### For Project Managers
Planning and tracking:
1. [Project Overview](PROJECT_OVERVIEW.md) - Goals and vision
2. [Implemented Protocols](reference/IMPLEMENTED.md) - Current status (181 protocols)
3. [Implementation Guide](guides/IMPLEMENTATION_GUIDE.md) - Implementation roadmap
4. [Documentation Summary](reference/DOCUMENTATION_SUMMARY.md) - Documentation inventory

## 📊 Current Project Status

### Implementation Progress
- **Total Protocols**: 181 implemented
- **Internet Standards**: 24 IETF Internet Standards (IS) implemented
- **Latest Review**: February 2026 - 86 protocols audited, 200+ critical bugs fixed
- **Test Coverage**: 214+ integration tests
- **Build Status**: ✅ 0 critical errors, 7 minor type warnings

### Recent Updates (February 2026)
- **Comprehensive Protocol Audit**: Reviewed 86 protocol implementations
- **Security Fixes**: 200+ critical bugs fixed (resource leaks, injection vulnerabilities, data corruption)
- **RFC Compliance**: 30+ medium-severity bugs fixed for protocol compliance
- **Documentation**: Created 86 comprehensive protocol specification files

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

- [Live Demo](https://portofcall.ross.gg)
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
├── PROJECT_OVERVIEW.md          # High-level overview
├── ARCHITECTURE.md              # System design
├── REVIEWED.md                  # Protocol review index
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
│   ├── INTERNET_STANDARDS.md
│   ├── DOCUMENTATION_SUMMARY.md
│   ├── POWER_USERS_HAPPY.md
│   ├── NAMING_HISTORY.md
│   ├── FTP_CODE_REVIEW.md
│   ├── WEBSERVER.md
│   └── RETRO_THEME.md
│
├── changelog/                   # Bug fixes and reviews
│   ├── README.md                # Changelog index
│   ├── critical-fixes.md        # Critical bugs (24 protocols)
│   ├── medium-fixes.md          # Medium bugs (31 protocols)
│   ├── 2026-02-18-protocol-review.md
│   └── by-protocol/             # Individual changelogs
│       ├── README.md
│       ├── ssh.md
│       ├── shadowsocks.md
│       ├── turn.md
│       └── [86 protocols]
│
└── protocols/                   # Protocol specifications
    ├── README.md                # Protocol directory index
    ├── QUICK_REFERENCE.md       # Cheat sheet
    ├── SSH.md                   # 242 protocol specs
    ├── SHADOWSOCKS.md
    └── non-tcp/                 # Non-TCP protocols (27 files)
```

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
**Protocols Documented**: 242 protocol specifications
**Bug Fixes Documented**: 200+ critical, 30+ medium severity
