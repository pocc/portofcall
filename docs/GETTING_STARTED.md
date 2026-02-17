# Getting Started with Port of Call

Quick start guide for developers joining the Port of Call project.

## What is Port of Call?

Port of Call enables **browser-based access to TCP protocols** using Cloudflare Workers' Sockets API. You can run SSH, connect to databases, and access any TCP service directly from your browser—no local tools required.

```
Browser ←WebSocket→ Cloudflare Worker ←TCP→ Backend Service
```

## 5-Minute Quick Start

### 1. Clone and Install

```bash
git clone <repo-url>
cd portofcall
npm install
```

### 2. Start Development Servers

```bash
# Terminal 1: React UI (Vite)
npm run dev

# Terminal 2: Worker (Wrangler)
npm run worker:dev
```

### 3. Test It Out

Visit `http://localhost:5173` and try:
- **TCP Ping**: Connect to `example.com:80`
- **Redis**: Connect to a local Redis instance
- **SSH**: Connect to an SSH server

## Project Structure

```
portofcall/
├── src/
│   ├── worker/
│   │   ├── index.ts              # Worker entry point
│   │   └── protocols/            # Protocol implementations
│   │       ├── ssh/
│   │       ├── redis/
│   │       ├── mysql/
│   │       └── ...
│   ├── components/               # React UI components
│   └── pages/                    # React pages
├── docs/
│   ├── README.md                 # Documentation index
│   ├── ARCHITECTURE.md           # System design
│   ├── IMPLEMENTED.md            # Status tracker
│   └── protocols/                # Protocol-specific docs
├── tests/                        # Test files
├── node_modules/
│   └── mutex.md                  # Work-in-progress tracker
└── wrangler.toml                 # Cloudflare config
```

## Understanding the Architecture

### The Three Layers

1. **React UI** (Browser)
   - User interface for protocol interactions
   - WebSocket connections to Worker
   - Built with React 19 + TypeScript + Vite 7

2. **Cloudflare Worker** (Edge)
   - Serves static React build
   - Handles API endpoints
   - Uses Sockets API for TCP connections
   - WebSocket-to-TCP tunneling

3. **Backend Services** (Remote)
   - SSH servers, databases, etc.
   - Standard TCP services
   - No modifications needed

### Data Flow

```
1. User enters connection details (host, port, credentials)
2. Browser sends WebSocket connection to Worker
3. Worker opens TCP socket to backend service
4. Data flows bidirectionally:
   Browser ←WebSocket→ Worker ←TCP→ Backend
5. Worker handles protocol encoding/decoding
6. Browser displays results in UI
```

## Current Status

### 📊 Implementation Stats
- **53+ protocols implemented**
- **14 protocols deployed and live**
- **39 protocols awaiting deployment**
- **214+ integration tests**

### 🔥 Live Protocols
SSH, FTP, Telnet, SMTP, POP3, IMAP, MySQL, PostgreSQL, Redis, MQTT, LDAP, SMB, Echo, Memcached, and more!

### 🚧 In Progress
Check [node_modules/mutex.md](../node_modules/mutex.md) for currently implementing protocols.

## Your First Contribution

### Option 1: Add a New Protocol

1. **Choose a protocol** from [docs/TCP_PROTOCOLS.md](TCP_PROTOCOLS.md)
2. **Check availability**:
   - Not in [docs/IMPOSSIBLE.md](IMPOSSIBLE.md)
   - Not in [node_modules/mutex.md](../node_modules/mutex.md) "Currently Implementing"
   - Not in [docs/IMPLEMENTED.md](IMPLEMENTED.md)
3. **Follow the guide**: [ADD_PROTOCOL.md](ADD_PROTOCOL.md)
4. **Study examples**: Start with simple protocols like Echo or Whois

### Option 2: Improve Existing Protocols

1. Review [docs/IMPLEMENTED.md](IMPLEMENTED.md)
2. Find protocols marked "Awaiting Deployment"
3. Add features, improve UI, or fix bugs
4. Write additional tests

### Option 3: Enhance Documentation

1. Improve protocol documentation in [docs/protocols/](protocols/)
2. Add examples and tutorials
3. Fix typos or unclear sections
4. Create video walkthroughs

## Essential Reading

Before implementing protocols, read these **in order**:

### 1. Core Concepts (30 minutes)
- [Project Overview](PROJECT_OVERVIEW.md) - Why Port of Call exists
- [Architecture](ARCHITECTURE.md) - How it works technically
- [Sockets API Reference](SOCKETS_API.md) - The underlying technology

### 2. Implementation Guide (1 hour)
- [ADD_PROTOCOL Guide](ADD_PROTOCOL.md) - Step-by-step process
- [Implementation Guide](protocols/IMPLEMENTATION_GUIDE.md) - Patterns and best practices
- [Quick Reference](protocols/QUICK_REFERENCE.md) - Code templates

### 3. Study Examples (2 hours)
Pick protocols by complexity:
- **Beginner**: [Echo](protocols/ECHO.md), [Whois](protocols/WHOIS.md)
- **Intermediate**: [Redis](protocols/REDIS.md), [MQTT](protocols/MQTT.md)
- **Advanced**: [SSH](protocols/SSH.md), [MySQL](protocols/MYSQL.md)

### 4. Security & Best Practices (30 minutes)
- [Cloudflare Detection](CLOUDFLARE_DETECTION.md) - Connection restrictions
- [SSH Authentication](SSH_AUTHENTICATION.md) - Secure credential handling
- [API Testing Guide](API_TESTING.md) - Testing strategies

## Development Workflow

### Day-to-Day Development

```bash
# Start development
npm run dev              # Vite dev server
npm run worker:dev       # Wrangler dev server

# Run tests
npm test                 # All tests
npm test -- ssh          # Specific protocol tests

# Build for production
npm run build            # Build React app
npm run worker:deploy    # Deploy to Cloudflare
```

### Adding a Protocol (Simplified)

```bash
# 1. Mark as in progress
echo "- MyProtocol (Port 1234)" >> node_modules/mutex.md

# 2. Create implementation files
mkdir -p src/worker/protocols/myprotocol
touch src/worker/protocols/myprotocol/client.ts
touch src/worker/protocols/myprotocol/tunnel.ts

# 3. Create UI component
mkdir -p src/components/MyProtocol
touch src/components/MyProtocol/MyProtocolClient.tsx

# 4. Write tests
touch tests/protocols/myprotocol.test.ts

# 5. Document
touch docs/protocols/MYPROTOCOL.md

# 6. Test locally
npm run worker:dev
npm test

# 7. Update status when complete
# - Add to docs/IMPLEMENTED.md
# - Move to "Completed" in node_modules/mutex.md
```

## Common Development Tasks

### Testing a Protocol Locally

```bash
# Start the local Worker
npx wrangler dev --port 8787

# Start a test server (example: Redis)
docker run -d -p 6379:6379 redis:latest

# Run tests against local Worker
API_BASE=http://localhost:8787/api npm test -- tests/redis.test.ts

# Test in browser
open http://localhost:8787
```

> **Important:** The production Worker at `portofcall.ross.gg` runs on Cloudflare's edge and cannot reach `localhost`. Always use `npx wrangler dev` for tests that require local Docker servers (FTP, Redis, databases, etc.).
>
> See [docs/LOCAL_TESTING.md](LOCAL_TESTING.md) for the full Docker setup guide.

### Debugging WebSocket Connections

```typescript
// In browser console
const ws = new WebSocket('ws://localhost:8787/api/protocol/connect');

ws.onopen = () => console.log('Connected');
ws.onmessage = (e) => console.log('Message:', e.data);
ws.onerror = (e) => console.error('Error:', e);
ws.onclose = () => console.log('Closed');

ws.send(JSON.stringify({ command: 'TEST' }));
```

### Viewing Worker Logs

```bash
# Local development
npm run worker:dev
# Logs appear in terminal

# Production
npx wrangler tail
```

## Key Technologies

### Frontend
- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite 7** - Build tool
- **Tailwind CSS** - Styling

### Backend
- **Cloudflare Workers** - Edge runtime
- **Sockets API** - TCP connections
- **WebSockets** - Browser communication

### Development
- **Wrangler** - Cloudflare CLI
- **Vitest** - Testing framework
- **ESLint** - Code linting

## Helpful Commands

```bash
# Development
npm run dev                    # Start Vite dev server
npm run worker:dev             # Start Wrangler dev server
npm run build                  # Build production bundle
npm run worker:deploy          # Deploy to Cloudflare

# Testing
npm test                       # Run all tests
npm test -- --watch            # Watch mode
npm test -- --coverage         # Coverage report

# Linting
npm run lint                   # Run ESLint
npm run lint -- --fix          # Auto-fix issues

# Cloudflare
npx wrangler dev              # Start Worker dev server
npx wrangler deploy           # Deploy Worker
npx wrangler tail             # View logs
npx wrangler kv:key list      # List KV keys (if using KV)
```

## Getting Help

### Documentation
- **Full docs index**: [docs/README.md](README.md)
- **Protocol catalog**: [docs/TCP_PROTOCOLS.md](TCP_PROTOCOLS.md)
- **Implementation guide**: [docs/protocols/IMPLEMENTATION_GUIDE.md](protocols/IMPLEMENTATION_GUIDE.md)

### Debugging
- Check Worker logs: `npx wrangler tail`
- Use browser DevTools Network tab for WebSocket inspection
- Review protocol RFCs for specification details
- Study existing protocol implementations

### Common Issues

**Q: "Protocol not found" error**
- Ensure protocol is registered in `src/worker/index.ts`
- Check import paths are correct

**Q: "Connection refused"**
- Verify host/port are correct
- Check if service is running
- Test with `telnet <host> <port>` first

**Q: "Cloudflare protected host" error**
- See [docs/CLOUDFLARE_DETECTION.md](CLOUDFLARE_DETECTION.md)
- Use origin IP instead of domain
- Or deploy on non-Cloudflare platform

**Q: Tests failing (infrastructure tests like FTP, Redis, MySQL)**
- Tests default to `https://portofcall.ross.gg` — they cannot reach `localhost`
- Start `npx wrangler dev --port 8787` and run with `API_BASE=http://localhost:8787/api npm test`
- Start the required Docker container (see [LOCAL_TESTING.md](LOCAL_TESTING.md))
- Check test credentials match the Docker container config

**Q: Tests failing ("Unexpected end of JSON input")**
- Check test files for double `/api/api/` URL patterns
- Ensure `API_BASE` does not already include `/api` when tests append `/api/`
- If using `vitest.config.ts` env override, use `http://localhost:8787/api` (with `/api`)

## Next Steps

### Immediate
1. ✅ Complete this guide
2. ✅ Read [Project Overview](PROJECT_OVERVIEW.md)
3. ✅ Review [Architecture](ARCHITECTURE.md)
4. ✅ Study one protocol example

### This Week
1. Choose a simple protocol (Echo, Whois, Daytime)
2. Follow [ADD_PROTOCOL Guide](ADD_PROTOCOL.md)
3. Implement your first protocol
4. Write tests and documentation
5. Submit for review

### This Month
1. Implement 2-3 more protocols
2. Help review others' implementations
3. Improve documentation
4. Contribute to core infrastructure

## Resources

### Cloudflare
- [Workers Documentation](https://developers.cloudflare.com/workers/)
- [Sockets API Guide](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
- [Workers Examples](https://developers.cloudflare.com/workers/examples/)

### Protocol Specifications
- [IETF RFC Index](https://www.rfc-editor.org/)
- [Protocol Documentation](https://www.wireshark.org/docs/dfref/)

### Tools
- [Wireshark](https://www.wireshark.org/) - Packet analysis
- [tcpdump](https://www.tcpdump.org/) - CLI packet capture
- [netcat](https://nc110.sourceforge.io/) - TCP testing

## Welcome!

Port of Call is an ambitious project bringing legacy TCP protocols to modern browsers. Your contributions help make the internet more accessible and demonstrate the power of edge computing.

**Ready to start?** Pick a protocol from [docs/TCP_PROTOCOLS.md](TCP_PROTOCOLS.md) and follow [ADD_PROTOCOL.md](ADD_PROTOCOL.md)!

---

Questions? Check [docs/README.md](README.md) for the complete documentation index.
