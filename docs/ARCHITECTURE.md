# Architecture

Technical architecture of Port of Call, a React + Vite + TypeScript application deployed as a Cloudflare Worker.

## Stack Overview

```
┌──────────────────────────────────────────────────┐
│              Browser                             │
│  ┌────────────────────────────────────────────┐  │
│  │  React 19 UI (TypeScript)                  │  │
│  │  - Vite 7 dev/build                        │  │
│  │  - WebSocket connections                   │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
                      ↕ HTTPS/WebSocket
┌──────────────────────────────────────────────────┐
│         Cloudflare Worker (Edge)                 │
│  ┌────────────────────────────────────────────┐  │
│  │  Worker Runtime                            │  │
│  │  - Serves static React build               │  │
│  │  - API endpoints (/api/*)                  │  │
│  │  - WebSocket upgrades                      │  │
│  │  - Sockets API connections                 │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
                      ↕ TCP (connect API)
┌──────────────────────────────────────────────────┐
│         Backend Services                         │
│  - SSH servers (port 22)                         │
│  - Databases (port 3306, 5432, etc.)             │
│  - Custom TCP services                           │
└──────────────────────────────────────────────────┘
```

## Directory Structure

```
portofcall/
├── src/
│   ├── worker/
│   │   └── index.ts          # Cloudflare Worker entry point
│   ├── App.tsx               # React root component
│   ├── App.css               # Component styles
│   ├── main.tsx              # React entry point
│   └── index.css             # Global styles
├── public/
│   └── anchor.svg            # Favicon (nautical theme)
├── docs/
│   ├── PROJECT_OVERVIEW.md   # High-level overview
│   ├── NAMING_HISTORY.md     # Name brainstorming
│   ├── SOCKETS_API.md        # Sockets API reference
│   └── ARCHITECTURE.md       # This file
├── dist/                     # Built React app (generated)
├── package.json
├── tsconfig.json             # TypeScript config
├── vite.config.ts            # Vite build config
├── wrangler.toml             # Cloudflare Workers config
└── README.md
```

## Component Details

### 1. React Frontend (Vite + TypeScript)

**Purpose**: User interface for TCP connectivity testing

**Technology**:
- React 19 (latest)
- TypeScript (strict mode)
- Vite 7 (dev server + build)
- CSS (no framework)

**Build Process**:
```bash
npm run build  # TypeScript → JavaScript, bundled to dist/
```

**Output**: Static assets in `dist/` directory

### 2. Cloudflare Worker

**Purpose**: Edge runtime that serves the app and handles TCP connections

**Entry Point**: `src/worker/index.ts`

**Responsibilities**:
1. **Static Asset Serving**: Serves built React app from `dist/`
2. **API Endpoints**: Handles `/api/ping` and `/api/connect`
3. **WebSocket Upgrades**: Converts HTTP to WebSocket for tunneling
4. **TCP Connections**: Uses `cloudflare:sockets` to connect to backends
5. **Data Proxying**: Pipes data between WebSocket and TCP socket

**Configuration**: `wrangler.toml`
- Enables Sockets API
- Configures Smart Placement
- Binds assets from `dist/`

### 3. Sockets API Integration

**Import**:
```typescript
import { connect } from 'cloudflare:sockets';
```

**Connection Flow**:
1. Browser sends request to `/api/ping` or `/api/connect`
2. Worker parses host and port from request
3. Worker calls `connect('host:port')`
4. TCP three-way handshake occurs
5. For pings: measure time, close socket, return RTT
6. For tunnels: pipe WebSocket ↔ TCP bidirectionally

## Data Flow Diagrams

### TCP Ping Flow

```
Browser                Worker                 Backend
   │                      │                      │
   │──POST /api/ping─────→│                      │
   │  {host, port}        │                      │
   │                      │──connect(host:port)→│
   │                      │←──TCP SYN/ACK───────│
   │                      │  (handshake done)    │
   │                      │──close()────────────→│
   │←──{success, rtt}─────│                      │
```

### WebSocket Tunnel Flow

```
Browser                Worker                 Backend
   │                      │                      │
   │──WS Upgrade─────────→│                      │
   │                      │──connect(host:port)→│
   │                      │←──TCP Connected─────│
   │←──WS Accept──────────│                      │
   │                      │                      │
   │──WS: data───────────→│──TCP: data─────────→│
   │                      │                      │
   │←──WS: response───────│←──TCP: response─────│
   │                      │                      │
```

## Smart Placement

### How It Works

1. **Initial Request**: User in San Francisco connects
2. **Edge Start**: Worker runs in SFO datacenter
3. **Backend Connection**: Worker connects to SSH server in Virginia
4. **Detection**: Worker detects repeated connections to Virginia
5. **Migration**: Worker "hot-migrates" to Ashburn datacenter
6. **Result**: Latency from Worker→SSH drops from 70ms to 2ms

### Configuration

```toml
[placement]
mode = "smart"  # Enable automatic migration
```

## Development Workflow

### Local Development

```bash
# Terminal 1: Vite dev server (React hot reload)
npm run dev
# Visit: http://localhost:5173

# Terminal 2: Wrangler dev (Worker emulation)
npm run worker:dev
# Visit: http://localhost:8787
```

**Note**: In local dev, use Vite server for UI work, Wrangler for Worker testing.

### Build for Production

```bash
# 1. Build React app
npm run build
# Output: dist/

# 2. Deploy to Cloudflare
npm run worker:deploy
# Worker serves dist/ via ASSETS binding
```

## Environment Variables

### Worker Environment

Defined in `wrangler.toml`:

```toml
[env.dev]
vars = { ENVIRONMENT = "development" }

[env.production]
vars = { ENVIRONMENT = "production" }
```

Access in Worker:
```typescript
export interface Env {
  ENVIRONMENT: string;
  ASSETS: Fetcher;  // Static asset binding
}
```

## API Endpoints

### POST /api/ping

**Purpose**: TCP connectivity test

**Request**:
```json
{
  "host": "example.com",
  "port": 22
}
```

**Response (Success)**:
```json
{
  "success": true,
  "host": "example.com",
  "port": 22,
  "rtt": 42,
  "message": "TCP Ping Success: 42ms"
}
```

**Response (Failure)**:
```json
{
  "success": false,
  "error": "Connection refused"
}
```

### POST /api/connect

**Purpose**: WebSocket-to-TCP tunnel establishment

**Request**: WebSocket upgrade with host/port in body

**Response**: 101 Switching Protocols (WebSocket established)

**Data Flow**: Bidirectional binary/text streaming

## Security Considerations

### 1. CORS

Worker should implement CORS headers for API endpoints:

```typescript
headers: {
  'Access-Control-Allow-Origin': '*',  // Or specific origin
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
```

### 2. Rate Limiting

Prevent abuse of socket connections:

```typescript
// TODO: Implement rate limiting
// - Per IP address
// - Per host:port combination
// - Global connection count
```

### 3. Allowlists

Consider restricting connectable hosts:

```typescript
const ALLOWED_HOSTS = ['example.com', 'trusted-server.net'];
if (!ALLOWED_HOSTS.includes(host)) {
  return new Response('Host not allowed', { status: 403 });
}
```

### 4. Input Validation

Always validate and sanitize:

```typescript
if (!host || !port || port < 1 || port > 65535) {
  return new Response('Invalid input', { status: 400 });
}
```

## Deployment

### Cloudflare Workers Deployment

```bash
wrangler deploy
```

**What happens**:
1. Code in `src/worker/index.ts` is bundled
2. Assets in `dist/` are uploaded
3. Worker is deployed to Cloudflare's global network
4. Available at `portofcall.workers.dev` (or custom domain)

### Custom Domain

In `wrangler.toml`:
```toml
routes = [
  { pattern = "portofcall.example.com", custom_domain = true }
]
```

## Performance Characteristics

### Latency Breakdown

For a user in NYC connecting to SSH server in London:

| Segment | Latency | Notes |
|---------|---------|-------|
| User → Edge | ~10ms | Cloudflare's global network |
| Edge → Backend | ~70ms | Smart Placement can reduce this |
| TCP Handshake | ~3ms | Three-way handshake |
| **Total** | **~83ms** | For initial connection |

### With Smart Placement

After migration:

| Segment | Latency | Notes |
|---------|---------|-------|
| User → Edge | ~10ms | Still in NYC |
| Edge → Backend | ~5ms | Worker moved to London |
| **Total** | **~15ms** | 5.5x improvement |

## Scaling

Cloudflare Workers automatically scale:

- **Requests**: Handle millions of requests/day
- **Connections**: Limited by Worker CPU time (50ms per request)
- **Concurrency**: Workers are isolated but stateless
- **Global**: Deployed to 300+ locations worldwide

## Future Architecture Enhancements

### 1. Durable Objects (Session State)

```typescript
export class SSHSession {
  constructor(state: DurableObjectState) {}

  async fetch(request: Request) {
    // Persistent SSH session state
  }
}
```

### 2. R2 Storage (Logs/Recordings)

```typescript
await env.BUCKET.put(`sessions/${id}.log`, data);
```

### 3. Queue (Background Processing)

```typescript
await env.QUEUE.send({ type: 'connection-log', host, port });
```

### 4. Analytics Engine (Metrics)

```typescript
env.ANALYTICS.writeDataPoint({
  blobs: [host],
  doubles: [rtt],
  indexes: [port],
});
```

## Testing Strategy

### Unit Tests
- Utility functions
- Data parsing/validation
- Error handling

### Integration Tests
- API endpoints
- WebSocket connections
- Socket API mocking

### End-to-End Tests
- Full browser → Worker → backend flow
- Real TCP connections (test servers)
- Performance/latency measurements

## Monitoring

Recommended metrics to track:

- **Connection Success Rate**: % of successful `connect()` calls
- **Average RTT**: Mean TCP handshake time
- **Error Rates**: By error type (timeout, refused, etc.)
- **Geographic Distribution**: Where users/workers are
- **Top Destinations**: Most-connected hosts/ports
