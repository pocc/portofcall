# Cloudflare Workers Sockets API

Technical reference for the Cloudflare Workers Sockets API, the foundation of Port of Call.

## History & Timeline

### Release Date
**May 16, 2023** - Announced during Cloudflare Developer Week

### Evolution
- **Before 2021**: Workers limited to HTTP only
- **2021**: WebSocket support added
- **May 2023**: Raw outbound TCP via Sockets API (breakthrough moment)
- **January 2026**: Placement Hints introduced for regional control

This was a major milestone because it opened Workers to database connections, SSH, and other TCP protocols that were previously impossible.

## API Basics

### Import
```typescript
import { connect } from 'cloudflare:sockets';
```

### Basic Usage
```typescript
const socket = connect('example.com:22');
await socket.opened;  // Wait for TCP handshake
// ... use socket.readable and socket.writable
await socket.close();
```

## TCP Ping Example

A "TCP ping" is NOT an ICMP ping - it's a TCP handshake check.

```typescript
async function tcpPing(host: string, port: number): Promise<number> {
  const start = Date.now();
  const socket = connect(`${host}:${port}`);

  await socket.opened;  // Wait for TCP three-way handshake
  const rtt = Date.now() - start;

  await socket.close();
  return rtt;  // Round-trip time in milliseconds
}
```

### ICMP vs TCP Ping

| Feature | ICMP Ping | TCP Ping (Sockets API) |
|---------|-----------|------------------------|
| Protocol | ICMP | TCP |
| Worker Support | ❌ No | ✅ Yes |
| Requirement | Target IP/Host | Target IP/Host + Port |
| Use Case | Network reachability | Service/Application availability |
| What it Tests | Can reach host? | Is service listening on port? |

## WebSocket-to-TCP Tunneling

The primary use case for browser-based protocols:

```typescript
export default {
  async fetch(request: Request): Promise<Response> {
    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();

    // Connect to TCP destination
    const socket = connect('ssh-server.com:22');

    // Pipe WebSocket ↔ TCP Socket
    pipeWebSocketToSocket(server, socket);
    pipeSocketToWebSocket(socket, server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
};
```

## Placement Control

### Smart Placement (Automatic)

```toml
[placement]
mode = "smart"
```

**How it works:**
1. Worker initially runs at edge closest to user
2. If multiple TCP requests go to same destination IP
3. Worker automatically "hot-migrates" closer to backend
4. Reduces "middle" latency between Worker and backend

### Cloud Region Hints

If you know your backend is in a specific cloud region:

```toml
[placement]
region = "aws:us-east-1"
# OR
region = "gcp:europe-west1"
# OR
region = "azure:eastus"
```

Cloudflare will run the Worker in the datacenter with lowest latency to that region.

### Hostname Probes

For servers not in major clouds:

```toml
[placement]
hostname = "your-server.com"
```

Cloudflare will probe the host and place the Worker optimally.

### Durable Objects (Stateful)

For session persistence with location control:

```typescript
const stub = env.SSH_SESSIONS.get(id, {
  locationHint: 'wnam',  // Western North America
});
```

Available jurisdictions:
- `eu` - European Union
- `fedramp` - US FedRAMP compliance

## Capabilities & Limitations

### ✅ What You CAN Do

- **TCP Connections**: Connect to any TCP service on any port
- **Bidirectional Streaming**: Full duplex communication
- **Latency Measurement**: Measure TCP handshake time
- **Smart Routing**: Automatic placement optimization
- **WebSocket Tunneling**: Bridge browser WebSockets to TCP
- **Multiple Connections**: Handle many simultaneous sockets

### ❌ What You CANNOT Do

- **ICMP Pings**: No raw socket access for ICMP protocol
- **UDP**: Only TCP is supported (no UDP as of Feb 2026)
- **Exact Colo Control**: Can't pin to specific datacenter (ORD, LHR, etc.)
- **Inbound Connections**: Only outbound TCP from Worker
- **Port Forwarding**: Can't expose services via Workers

## Why TCP Only?

Cloudflare restricts the Sockets API to Layer 4 (TCP) for:

1. **Security**: Prevents abuse of raw packet generation
2. **Architecture**: Fits Worker execution model
3. **Control**: Allows quality and abuse controls
4. **Performance**: Optimizations possible with known protocol

## Comparison to Alternatives

| Method | Protocol | Latency | Setup Complexity |
|--------|----------|---------|------------------|
| Direct TCP | TCP | Lowest | Not possible from browser |
| WebSocket | WebSocket | Low | Requires WebSocket server |
| HTTP Polling | HTTP | High | Simple but inefficient |
| **Sockets API** | **TCP** | **Low** | **Medium** |

## Best Practices

### 1. Error Handling
Always wrap socket operations in try-catch:

```typescript
try {
  const socket = connect(`${host}:${port}`);
  await socket.opened;
} catch (error) {
  // Handle connection failures
}
```

### 2. Timeout Management
Set reasonable timeouts for connections:

```typescript
const timeout = setTimeout(() => {
  socket.close();
}, 5000);

await socket.opened;
clearTimeout(timeout);
```

### 3. Resource Cleanup
Always close sockets when done:

```typescript
try {
  // ... use socket
} finally {
  await socket.close();
}
```

### 4. Stream Handling
Use async iteration for reading:

```typescript
const reader = socket.readable.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  // Process value
}
```

## Future Possibilities

Potential future additions to Sockets API:

- UDP support
- Multicast
- Raw socket access (ICMP)
- Server-side listening (inbound)
- More granular placement control

## Resources

- [Cloudflare Sockets API Docs](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
- [Smart Placement Announcement](https://blog.cloudflare.com/smart-placement-for-workers/)
- [Workers Developer Week 2023](https://blog.cloudflare.com/developer-week-2023/)
