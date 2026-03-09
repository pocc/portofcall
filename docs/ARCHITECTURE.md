# Architecture

Technical architecture of Port of Call — a browser-to-TCP bridge deployed as a Cloudflare Worker.

## Stack Overview

```
┌──────────────────────────────────────────────────┐
│              Browser                             │
│  ┌────────────────────────────────────────────┐  │
│  │  React 19 UI (TypeScript)                  │  │
│  │  - Vite 7 dev/build                        │  │
│  │  - 244 protocol clients                    │  │
│  │  - WebSocket connections                   │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
                      ↕ HTTPS / WebSocket
┌──────────────────────────────────────────────────┐
│         Cloudflare Worker (Edge)                 │
│  ┌────────────────────────────────────────────┐  │
│  │  Worker Runtime (128 MiB isolate)          │  │
│  │  - Serves static React build               │  │
│  │  - 244 protocol handler endpoints          │  │
│  │  - WebSocket upgrades → TCP tunnels        │  │
│  │  - SSRF host validation                    │  │
│  │  - Backpressure-aware data plane           │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
                      ↕ TCP (cloudflare:sockets)
┌──────────────────────────────────────────────────┐
│         Backend Services                         │
│  - SSH servers, databases, message queues        │
│  - Any TCP-accessible service (ports 1-65535)    │
└──────────────────────────────────────────────────┘
```

## Directory Structure

```
portofcall/
├── src/
│   ├── worker/
│   │   ├── index.ts              # Worker entry: router, pipe functions, TCP ping
│   │   ├── host-validator.ts     # SSRF prevention (IP/hostname blocklist)
│   │   ├── cloudflare-detector.ts # Cloudflare IP detection
│   │   ├── ssh.ts                # SSH protocol (banner, kex, auth)
│   │   ├── ssh2-impl.ts          # SSH2 client library
│   │   ├── tcp.ts                # Raw TCP send/receive
│   │   ├── websocket.ts          # WebSocket probe
│   │   └── [240+ protocol handlers]
│   ├── components/               # React UI components (240+ protocol clients)
│   ├── App.tsx                   # React root
│   └── main.tsx                  # React entry
├── docs/
│   ├── ARCHITECTURE.md           # This file
│   ├── PROTOCOL_REGISTRY.md      # Protocol status and scaling limits
│   ├── GETTING_STARTED.md        # Quick start guide
│   ├── PROJECT_OVERVIEW.md       # High-level overview
│   ├── protocols/                # 319 protocol specification files
│   ├── reference/                # Technical references (Sockets API, TCP list, etc.)
│   ├── guides/                   # Implementation and testing guides
│   └── changelog/                # Bug fixes by protocol + audit pass reports
├── dist/                         # Built React app
├── wrangler.toml                 # Cloudflare Workers config
└── package.json
```

## Data Plane

The core tunnel connects a browser WebSocket to a backend TCP socket through two pipe functions. These were hardened across audit passes 13-19 (see `docs/changelog/reviews/` for full history).

### WebSocket Tunnel Flow

```
Browser                  Worker                      Backend
   │                        │                            │
   │──WS Upgrade───────────→│                            │
   │                        │──connect(host:port)───────→│
   │                        │←──TCP Connected────────────│
   │←──101 Switching────────│                            │
   │                        │                            │
   │──WS msg──────────────→│──writer.write()───────────→│  (serialized via writeChain)
   │                        │                            │
   │←──WS msg───────────────│←──reader.read()────────────│  (gated by bufferedAmount)
```

### `pipeSocketToWebSocket` — Backend → Browser

**Source:** `src/worker/websocket-pipe.ts` (function `pipeSocketToWebSocket`)

Reads from the TCP socket and forwards to the WebSocket. Implements two safety mechanisms:

**Backpressure (1 MiB High-Water Mark):**
```
while (ws.bufferedAmount > 1 MiB) {
  yield 50ms               ← Worker pauses reading
}                           ← TCP receive buffer fills
                            ← Kernel withholds ACKs
reader.read()               ← Backend's TCP window closes
ws.send(chunk)              ← Throughput = client consumption rate
```

The Worker never buffers more than ~1.1 MiB **outbound** per connection (1 MiB HWM + ~64 KB in-flight read). Inbound (browser → backend) uses a separate 4 MiB high-water mark. Worst-case bidirectional memory per connection is ~5.1 MiB.

**Payload Chunking (1 MiB WebSocket Limit):**

If a TCP read returns >1 MiB (unlikely but not guaranteed), the payload is split into <=1 MiB slices via zero-copy `subarray()` before sending. Standard chunks (<=64 KB) take a fast path with no overhead.

### `pipeWebSocketToSocket` — Browser → Backend

**Source:** `src/worker/websocket-pipe.ts` (function `pipeWebSocketToSocket`)

Receives WebSocket messages and writes to the TCP socket. Implements:

**Promise-Chain Serialization:**

The `message` event handler is synchronous and appends each write to a `writeChain` promise queue. This guarantees strict FIFO ordering of TCP writes regardless of V8 event loop timing.

**Drain-Before-Close:**

The `close` handler chains cleanup off `writeChain` via `.then(cleanup, cleanup)`, ensuring all queued writes flush to TCP before the writer is closed. The two-argument form handles both fulfilled and rejected chain states.

**Error Bypass:**

The `error` handler calls `writer.close()` directly (not chained) for immediate teardown — queued writes are moot when the WebSocket is dead.

### TCP Ping

**Source:** `src/worker/index.ts` (function `handleTcpPing`)

Measures TCP handshake RTT using `performance.now()` (monotonic, sub-millisecond). Results are rounded to 2 decimal places. Reported RTT includes ~0.5-5ms of Worker scheduling overhead, which is inherent to the execution model.

### Scaling Limits

| Metric | Value |
|--------|-------|
| Memory per bulk-transfer connection | ~5.1 MiB worst case (1 MiB outbound HWM + 4 MiB inbound HWM + ~64 KB in-flight) |
| Memory per interactive connection | ~67 KB (typical) |
| Max concurrent bulk transfers | ~25 (in 128 MiB isolate, bidirectional worst case) |
| Max concurrent interactive sessions | ~1,700 |
| Worker CPU time limit | 30s per request (Paid plan) |
| WebSocket message size limit | 1 MiB |
| Backpressure drain interval | 50ms |
| TCP connect timeout | 10s |

## Security

### SSRF Prevention

**Source:** `src/worker/host-validator.ts`

All connections pass through `isBlockedHost()` at the router level before any protocol handler runs.

**Blocked IPv4 Ranges:**

| CIDR | Purpose |
|------|---------|
| `127.0.0.0/8` | Loopback |
| `10.0.0.0/8` | RFC 1918 private |
| `172.16.0.0/12` | RFC 1918 private |
| `192.168.0.0/16` | RFC 1918 private |
| `169.254.0.0/16` | Link-local (includes AWS/GCP/Azure metadata at `169.254.169.254`) |
| `0.0.0.0/8` | "This network" (RFC 1122) |
| `255.255.255.255/32` | Broadcast |
| `192.0.0.0/29` | IANA special |
| `100.64.0.0/10` | CGN / shared address space |
| `192.0.2.0/24` | TEST-NET-1 (RFC 5737) |
| `198.18.0.0/15` | Benchmarking (RFC 2544) |
| `198.51.100.0/24` | TEST-NET-2 (RFC 5737) |
| `203.0.113.0/24` | TEST-NET-3 (RFC 5737) |
| `240.0.0.0/4` | Reserved / Class E |

Also blocks alternate IP representations: decimal integers, hex notation, octal/mixed-radix, and shortened dotted-decimal forms.

**Blocked IPv6:**

| Range | Purpose |
|-------|---------|
| `::1` | Loopback |
| `::` | Unspecified |
| `fc00::/7` (fc, fd prefixes) | Unique Local Address (ULA) |
| `fe80::/10` | Link-local |
| `::ffff:x.x.x.x` | IPv4-mapped — extracted and checked against IPv4 blocklist |
| `::x.x.x.x` | IPv4-compatible — extracted and checked against IPv4 blocklist |
| `2002::/16` | 6to4 tunneling (RFC 3056) — embedded IPv4 checked |
| `64:ff9b::/96` | NAT64 well-known prefix (RFC 6052) — embedded IPv4 checked |

**Blocked Hostnames:**

`localhost`, `*.internal`, `*.local`, `*.localhost`

**Known Limitation:** DNS rebinding (a hostname that resolves to a private IP) cannot be fully prevented because `cloudflare:sockets` `connect()` resolves hostnames internally. The hostname blocklist is a partial mitigation.

### Rate Limiting

Rate limiting is implemented at the infrastructure level, not in the Worker code. See `SECURITY.md` and the `docker/` configs for details:
- **nginx:** Connection rate limits per IP
- **fail2ban:** Automatic IP blocking on repeated failed auth attempts

Do not add application-level rate limiting to the Worker — it is handled externally.

### Cloudflare IP Detection

Connections to Cloudflare-proxied IPs are blocked by `cloudflare-detector.ts` to prevent loop-back attacks through the CDN.

### Resource Lifecycle

All stream readers and writers are released in `finally` blocks. Socket connections are closed in all exit paths (success, error, close). The SSH banner reader in `ssh.ts` releases the reader lock in a `finally` block with a nested `try/catch` to handle the "already released" edge case.

## API Endpoints

### POST /api/ping

TCP connectivity test. Returns `{ success, host, port, rtt, message }`.

### POST /api/connect

WebSocket-to-TCP tunnel. Returns `101 Switching Protocols`. Data flows bidirectionally as binary/text WebSocket messages.

### Protocol Handlers

244 protocol-specific endpoints (e.g., `/api/ssh/connect`, `/api/redis/send`, `/api/mysql/query`). Each validates input, connects to the target, and returns protocol-specific responses.

## Deployment

```bash
npm run build       # TypeScript + Vite → dist/
npx wrangler deploy # Deploy Worker + static assets
```

### Smart Placement

```toml
[placement]
mode = "smart"
```

The Worker automatically migrates to the datacenter closest to the backend, reducing Worker→backend latency from ~70ms to ~2ms for repeated connections.

## Development

```bash
npm run dev          # Vite dev server (React hot reload)
npx wrangler dev     # Worker dev server (API endpoints)
npm run build        # Validate TypeScript + build
```

## Certification Status

The data plane was certified as "Industrial Grade" after 19 audit passes (February 2026):

- **Backpressure:** `bufferedAmount` gating prevents OOM on slow clients
- **Chunking:** Zero-copy `subarray()` prevents `RangeError` on oversized payloads
- **Serialization:** Promise-chain FIFO prevents out-of-order TCP writes
- **Resource safety:** All reader/writer locks released in `finally` blocks
- **SSRF:** Comprehensive IPv4/IPv6/hostname blocklist with IPv4-mapped IPv6 delegation

Full audit trail: `docs/changelog/reviews/PROTOCOL_REVIEW_*_PASS.md` (Passes 3-19)
