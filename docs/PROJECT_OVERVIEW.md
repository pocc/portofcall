# Port of Call - Project Overview

## Name & Concept

**Port of Call** is a Cloudflare Worker application that leverages the Sockets API to enable browser-based access to TCP protocols like SSH, databases, and other services.

### Why "Port of Call"?

The name works on multiple levels:

1. **Literal Pun**: You're literally calling a port (like port 22 for SSH, 3306 for MySQL) from the browser
2. **Nautical Metaphor**: A "port of call" is a transitional stop where ships dock - here, it's where data transitions between the browser and backend services
3. **Ecosystem Fit**: Aligns perfectly with Cloudflare's nautical naming theme (Workers, Pages, Streams, Currents)
4. **Retro Appeal**: Evokes the "Golden Age of Sail" while bringing 80s/90s networking protocols into the modern browser

## Core Technology

### Cloudflare Workers Sockets API

- **Released**: May 16, 2023 (Cloudflare Developer Week)
- **Protocol Support**: TCP (Layer 4) - not ICMP
- **Capability**: Raw outbound TCP connections from Cloudflare's edge network
- **Evolution**: Before this, Workers were limited to HTTP and WebSockets

### What's Possible

With the Sockets API, you can:

- **SSH from Browser**: Terminal access via browser without plugins
- **Database Connections**: Direct TCP connections to databases
- **TCP Pings**: Measure round-trip time via TCP handshake (not ICMP)
- **Custom Protocols**: Any TCP-based protocol can run through the browser

## Architecture

```
┌─────────────┐          ┌──────────────────┐          ┌─────────────┐
│   Browser   │          │  Cloudflare      │          │   Backend   │
│             │◄────────►│  Worker          │◄────────►│   Service   │
│  (React UI) │ WebSocket│  (Sockets API)   │   TCP    │ (SSH/DB/etc)│
└─────────────┘          └──────────────────┘          └─────────────┘
```

### Flow

1. **Browser**: Initiates request (usually via WebSocket or API call)
2. **Worker**: Intercepts and uses `connect()` to open TCP socket to destination
3. **Remote Server**: Receives standard TCP connection from Cloudflare IP
4. **Data Flow**: WebSocket tunnel pipes data between browser and TCP socket

## Smart Placement

The Worker uses Cloudflare's Smart Placement feature:

- **Initial Location**: Worker starts at edge closest to user
- **Auto-Migration**: If multiple TCP requests go to same destination, Worker automatically migrates closer to backend
- **Result**: Minimizes latency for backend connections

### Placement Options

```toml
# wrangler.toml

[placement]
mode = "smart"  # Automatic migration

# OR specify a region hint:
region = "aws:us-east-1"  # Run near specific cloud region

# OR use hostname probe:
hostname = "your-server.com"  # Run near specific server
```

## Use Cases

1. **Development Tools**: Browser-based SSH terminals, database clients
2. **Emergency Access**: Terminal access from anywhere without local tools
3. **Educational**: Teaching networking protocols through interactive browser demos
4. **Monitoring**: TCP connectivity testing and latency measurement
5. **Protocol Bridges**: Connecting legacy TCP services to modern web apps

## Technical Constraints

### What You CAN Do

- ✅ TCP connections (any port)
- ✅ Measure TCP handshake latency (RTT)
- ✅ WebSocket-to-TCP tunneling
- ✅ Smart placement near backend services

### What You CANNOT Do

- ❌ ICMP pings (no raw socket access)
- ❌ Pin to specific datacenter/colo (only region hints)
- ❌ UDP connections (TCP only as of Feb 2026)

## Project Goals

1. **Demonstrate Sockets API**: Showcase the power of Cloudflare's TCP capabilities
2. **Retro-Modern Fusion**: Bring 80s/90s protocols to 2026 browsers
3. **Educational**: Help developers understand Workers and networking
4. **Practical**: Provide actual utility for browser-based TCP access

## Future Features

- SSH terminal emulation
- Database query interface
- Network diagnostics dashboard
- Custom protocol handlers
- Multi-hop connections
- Session persistence with Durable Objects
