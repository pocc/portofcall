# ⚓ Port of Call

Browser-to-TCP bridge via Cloudflare Workers Sockets API. Run SSH, connect to databases, and access any TCP service directly from your browser.

**Live Demo**: [portofcall.ross.gg](https://portofcall.ross.gg)

## What is Port of Call?

Port of Call leverages [Cloudflare Workers' Sockets API](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/) (released May 16, 2023) to enable browser-based access to TCP protocols that were previously impossible to reach from the web.

### The Name

**Port of Call** works on multiple levels:
- 🎯 **Literal**: You're calling a port (like 22 for SSH) from the browser
- ⚓ **Nautical**: A transitional stop where data moves between worlds
- 🌊 **Ecosystem**: Fits Cloudflare's naming theme (Workers, Pages, Streams)

## Features

- ✅ **TCP Connections**: Connect to any TCP service from the browser
- ✅ **SSH Authentication**: Password & private key (Ed25519, RSA, ECDSA) support
- ✅ **FTP Operations**: Upload, download, rename, delete, list, mkdir
- ✅ **TCP Ping**: Measure round-trip time via TCP handshake
- ✅ **WebSocket Tunneling**: Bridge browser WebSockets to TCP sockets
- ✅ **Smart Placement**: Automatic Worker migration closer to backends
- ✅ **Cloudflare Detection**: Automatic blocking of Cloudflare-protected hosts
- ✅ **React UI**: Modern TypeScript interface for testing connections
- ✅ **Zero Configuration**: Works out of the box

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Cloudflare account (for deployment)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)

### Installation

```bash
# Clone or download this repo
cd portofcall

# Install dependencies
npm install

# Start Vite dev server (React UI)
npm run dev

# In another terminal, start Wrangler (Worker)
npm run worker:dev
```

Visit `http://localhost:5173` to see the React UI, or `http://localhost:8787` for the Worker.

### Build & Deploy

This project is deployed as a **Cloudflare Worker** (not Pages) that serves static assets via the Workers Assets API.

```bash
# Build React app
npm run build

# Deploy to Cloudflare Workers
npm run worker:deploy
# or
npx wrangler deploy
```

The Worker serves the built React app from the `dist/` directory while providing TCP connectivity APIs.

## Usage

### TCP Ping Example

Test if a service is reachable:

```typescript
const response = await fetch('/api/ping', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ host: 'example.com', port: 22 }),
});

const { success, rtt } = await response.json();
// rtt = round-trip time in milliseconds
```

### SSH Authentication Examples

**Password Authentication:**
```bash
curl -X POST /api/ssh/connect \
  -H "Content-Type: application/json" \
  -d '{
    "host": "ssh.example.com",
    "username": "admin",
    "password": "secret",
    "authMethod": "password"
  }'
```

**Private Key Authentication:**
```typescript
const privateKey = `-----BEGIN OPENSSH PRIVATE KEY-----
...
-----END OPENSSH PRIVATE KEY-----`;

const ws = new WebSocket('wss://portofcall.ross.gg/api/ssh/connect?' + new URLSearchParams({
  host: 'ssh.example.com',
  username: 'admin',
  privateKey: privateKey,
  authMethod: 'publickey'
}));

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'ssh-options') {
    // Use data.options with browser SSH client (ssh2.js, xterm.js)
  }
};
```

See [SSH Authentication Guide](docs/SSH_AUTHENTICATION.md) for complete examples with Ed25519, RSA, ECDSA keys.

## Architecture

Port of Call is deployed as a **single Cloudflare Worker** that:
1. Serves the built React UI as static assets (via Workers Assets API)
2. Provides TCP connectivity APIs (via Workers Sockets API)
3. Uses Smart Placement to minimize latency to backend services

```
┌─────────────┐          ┌──────────────────────────────┐          ┌─────────────┐
│   Browser   │          │  Cloudflare Worker           │          │   Backend   │
│             │◄────────►│  ┌────────────────────────┐  │◄────────►│   Service   │
│  (React UI) │ WebSocket│  │ Sockets API + Assets   │  │   TCP    │ (SSH/DB/etc)│
│             │   HTTP   │  │ (Single Worker)        │  │          │             │
└─────────────┘          │  └────────────────────────┘  │          └─────────────┘
                         └──────────────────────────────┘
```

**Note**: This is a Workers deployment, not Cloudflare Pages. The Worker handles both static asset serving and TCP proxy functionality.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture.

## What Can You Build?

- 🖥️ **Browser SSH Client**: Terminal access from any web browser
- 🗄️ **Database Explorer**: Query databases without local clients
- 📊 **Network Diagnostics**: TCP connectivity testing and monitoring
- 🔌 **Protocol Bridges**: Connect legacy services to modern web apps
- 🎓 **Educational Tools**: Interactive networking protocol demos

## Documentation

- [📖 Project Overview](docs/PROJECT_OVERVIEW.md) - Concept and goals
- [🏗️ Architecture](docs/ARCHITECTURE.md) - Technical architecture
- [🔌 Sockets API Reference](docs/SOCKETS_API.md) - API details and examples
- [🔐 SSH Authentication](docs/SSH_AUTHENTICATION.md) - Password & private key authentication
- [☁️ Cloudflare Detection](docs/CLOUDFLARE_DETECTION.md) - Connection restrictions
- [📝 Naming History](docs/NAMING_HISTORY.md) - How we chose the name

## Tech Stack

- **Frontend**: React 19 + TypeScript + Vite 7
- **Backend**: Cloudflare Workers + Sockets API
- **Static Assets**: Workers Assets API (serves built React app)
- **Build**: Vite for bundling, Wrangler for deployment
- **Deployment**: Cloudflare Workers (not Pages)
- **Domain**: portofcall.ross.gg

## Smart Placement

Port of Call uses Cloudflare's Smart Placement to automatically migrate Worker execution closer to your backend services:

```toml
[placement]
mode = "smart"  # Automatic migration for low latency
```

This means if you repeatedly connect to an SSH server in Virginia, the Worker will migrate from the edge to a datacenter near Virginia, reducing backend latency from 70ms to ~2ms.

## API Endpoints

### POST /api/ping

Test TCP connectivity and measure round-trip time.

**Request**:
```json
{
  "host": "example.com",
  "port": 22
}
```

**Response**:
```json
{
  "success": true,
  "host": "example.com",
  "port": 22,
  "rtt": 42,
  "message": "TCP Ping Success: 42ms"
}
```

### POST /api/connect

Establish WebSocket-to-TCP tunnel.

**Request**: WebSocket upgrade with host/port
**Response**: 101 Switching Protocols

## Limitations

### What You CAN Do

- ✅ TCP connections (any port)
- ✅ Measure TCP handshake latency
- ✅ WebSocket-to-TCP tunneling
- ✅ Smart placement near backends

### What You CANNOT Do

- ❌ ICMP pings (TCP only, not raw sockets)
- ❌ UDP connections (TCP only as of Feb 2026)
- ❌ Pin to specific datacenter (only region hints)
- ❌ **Connect to Cloudflare-protected domains** (security restriction)

### Cloudflare Detection

Port of Call **automatically blocks connections to Cloudflare-protected hosts**. This is a security limitation imposed by Cloudflare's architecture to prevent Workers from being used as proxies.

**Example blocked domains:**
- Any site with orange cloud in Cloudflare DNS
- discord.com, stackoverflow.com, npmjs.com (all use Cloudflare)

**Workarounds:**
- Use the origin server's IP address directly
- Disable Cloudflare proxy (orange cloud → gray)
- Deploy Port of Call on a non-Cloudflare platform

See [docs/CLOUDFLARE_DETECTION.md](docs/CLOUDFLARE_DETECTION.md) for complete details.

See [docs/SOCKETS_API.md](docs/SOCKETS_API.md) for more API details.

## Contributing

Contributions welcome! Areas for improvement:

- SSH terminal emulator component
- Database query interface
- Network diagnostics dashboard
- Custom protocol handlers
- Tests and documentation

## Security Notes

⚠️ **Important Security Considerations**:

1. **Public Workers**: Anyone can call your Worker's API
2. **Rate Limiting**: Implement rate limiting to prevent abuse
3. **Allowlists**: Consider restricting connectable hosts
4. **Authentication**: Add auth for production deployments
5. **Input Validation**: Always validate host/port inputs

See [docs/ARCHITECTURE.md#security](docs/ARCHITECTURE.md#security-considerations) for details.

## License

MIT License - See LICENSE file for details

## Resources

- [Cloudflare Sockets API Docs](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Smart Placement](https://blog.cloudflare.com/smart-placement-for-workers/)
- [React Documentation](https://react.dev/)
- [Vite Documentation](https://vite.dev/)

## Acknowledgments

Built with inspiration from:
- 80s/90s networking protocols (Gopher, Telnet, SLIP)
- Cloudflare's nautical naming theme
- The power of bringing "bare-metal" protocols to the browser

---

Made with ⚓ using Cloudflare Workers Sockets API
