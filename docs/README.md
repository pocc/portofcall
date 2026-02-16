# Port of Call Documentation

Complete documentation for Port of Call - a browser-to-TCP bridge via Cloudflare Workers Sockets API.

## 📚 Documentation Index

### Getting Started
- **[Project Overview](PROJECT_OVERVIEW.md)** - What is Port of Call? Core concepts and use cases
- **[Architecture](ARCHITECTURE.md)** - Technical architecture, data flow, deployment
- **[Quick Start Guide](../README.md)** - Installation and deployment instructions

### Core Concepts
- **[Sockets API Reference](SOCKETS_API.md)** - Cloudflare Workers Sockets API guide
- **[TCP Protocols List](TCP_PROTOCOLS.md)** - Comprehensive list of implementable TCP protocols
- **[Impossible Protocols](IMPOSSIBLE.md)** - Protocols that cannot run on Workers (UDP, raw sockets)

### Implementation Status
- **[Implemented Protocols](IMPLEMENTED.md)** - Complete list of 53+ implemented protocols with test status
- **[Protocol Mutex](../node_modules/mutex.md)** - Current work in progress tracking
- **[RFC Compliance Audit](RFC_COMPLIANCE_AUDIT.md)** - Protocol standards compliance review

### Adding New Protocols
- **[ADD_PROTOCOL Guide](ADD_PROTOCOL.md)** - Step-by-step workflow for implementing new protocols
- **[Implementation Guide](protocols/IMPLEMENTATION_GUIDE.md)** - Patterns, best practices, roadmap
- **[Quick Reference](protocols/QUICK_REFERENCE.md)** - One-page cheat sheet for protocol implementation

### Protocol-Specific Documentation
- **[protocols/](protocols/)** - Individual protocol implementation plans (90+ protocols)
  - [Echo](protocols/ECHO.md), [Redis](protocols/REDIS.md), [MySQL](protocols/MYSQL.md), [SSH](protocols/SSH.md), etc.

### Security & Features
- **[SSH Authentication](SSH_AUTHENTICATION.md)** - Password and private key authentication guide
- **[Cloudflare Detection](CLOUDFLARE_DETECTION.md)** - Connection restrictions and workarounds
- **[Cross-Platform Notes](CROSS_PLATFORM.md)** - Platform compatibility considerations

### Testing & Development
- **[API Testing Guide](API_TESTING.md)** - Testing strategies and examples
- **[FTP Code Review](FTP_CODE_REVIEW.md)** - FTP implementation deep dive

### Project History
- **[Naming History](NAMING_HISTORY.md)** - How we chose "Port of Call"
- **[Retro Theme](RETRO_THEME.md)** - Design philosophy and aesthetic

## 🎯 Quick Links by Role

### For Developers
Start here to implement protocols:
1. [ADD_PROTOCOL Guide](ADD_PROTOCOL.md) - Read this first
2. [Implementation Guide](protocols/IMPLEMENTATION_GUIDE.md) - Patterns and best practices
3. [Implemented Protocols](IMPLEMENTED.md) - See what's already done
4. [TCP Protocols List](TCP_PROTOCOLS.md) - Choose what to build next

### For Architects
Understanding the system:
1. [Architecture](ARCHITECTURE.md) - System design
2. [Sockets API Reference](SOCKETS_API.md) - Core technology
3. [Impossible Protocols](IMPOSSIBLE.md) - Technical limitations
4. [Cloudflare Detection](CLOUDFLARE_DETECTION.md) - Security considerations

### For Project Managers
Planning and tracking:
1. [Project Overview](PROJECT_OVERVIEW.md) - Goals and vision
2. [Implemented Protocols](IMPLEMENTED.md) - Current status (53+ protocols)
3. [Protocol Mutex](../node_modules/mutex.md) - Active work tracker
4. [Implementation Guide](protocols/IMPLEMENTATION_GUIDE.md) - 8-week roadmap

## 📊 Current Project Status

### Implementation Progress
- **Total Protocols**: 53+ implemented
- **Deployed & Live**: 14 protocols
- **Awaiting Deployment**: 39 protocols
- **In Development**: 1 protocol (Informix - see [mutex.md](../node_modules/mutex.md))
- **Test Coverage**: 214+ integration tests

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
- [Project Repository](https://github.com/your-repo) (if applicable)

## 🛠️ Development Workflow

### Adding a New Protocol
1. Check [Protocol Mutex](../node_modules/mutex.md) to avoid duplicate work
2. Read [ADD_PROTOCOL Guide](ADD_PROTOCOL.md) for step-by-step instructions
3. Consult [TCP Protocols List](TCP_PROTOCOLS.md) and [Impossible Protocols](IMPOSSIBLE.md)
4. Follow patterns in [Implementation Guide](protocols/IMPLEMENTATION_GUIDE.md)
5. Write tests following [API Testing Guide](API_TESTING.md)
6. Update [Implemented Protocols](IMPLEMENTED.md) when complete
7. Mark as complete in [Protocol Mutex](../node_modules/mutex.md)

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
- ✅ Mark protocols in mutex.md when starting work
- ✅ Follow Markdown best practices
- ✅ Include security considerations
- ✅ Add testing strategies

## 🤝 Contributing

To contribute to documentation:
1. Read existing docs to avoid duplication
2. Follow the structure outlined in this README
3. Update the index when adding new files
4. Use clear, concise language
5. Include code examples where relevant
6. Cross-reference related documentation

## 📞 Getting Help

- **Implementation Questions**: See [Implementation Guide](protocols/IMPLEMENTATION_GUIDE.md)
- **Protocol Specs**: Check [protocols/](protocols/) directory
- **Technical Issues**: Review [Architecture](ARCHITECTURE.md) and [Sockets API](SOCKETS_API.md)
- **Security**: See [Cloudflare Detection](CLOUDFLARE_DETECTION.md) and security sections in each protocol doc

---

**Last Updated**: February 2026
**Total Documentation Files**: 100+ files
**Lines of Documentation**: 20,000+ lines
