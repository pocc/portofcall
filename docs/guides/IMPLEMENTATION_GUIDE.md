# Protocol Implementation Guide

Quick-start guide for implementing TCP protocols in Port of Call.

## Overview

This guide provides patterns and best practices for implementing TCP protocols with Cloudflare Workers' Sockets API. Each protocol implementation follows a consistent architecture to enable browser-based access.

## Implementation Roadmap

### Phase 1: Foundation (Week 1)
**Goal**: Establish core patterns and infrastructure

1. **ECHO** (1 day)
   - Simplest protocol
   - Validates entire architecture
   - Tests WebSocket tunneling
   - **Start here!**

2. **WHOIS** (1 day)
   - Simple request/response pattern
   - Real-world utility
   - Demonstrates parsing

3. **Core Infrastructure** (3 days)
   - Reusable connection manager
   - Error handling patterns
   - Rate limiting framework
   - UI component library

### Phase 2: High-Value Protocols (Week 2-3)
**Goal**: Deliver immediately useful features

4. **REDIS** (3 days)
   - Text-based protocol (easy to debug)
   - High demand from developers
   - RESP parser is reusable
   - Pub/sub demonstrates real-time

5. **MySQL** (4 days)
   - Binary protocol (more complex)
   - Very high user demand
   - Database explorer UI patterns
   - Query result visualization

### Phase 3: Real-Time & Messaging (Week 4)
**Goal**: Demonstrate protocol versatility

6. **IRC** (3 days)
   - Classic chat protocol
   - Real-time messaging
   - Channel/room patterns
   - Community appeal

7. **MQTT** (4 days)
   - IoT pub/sub messaging
   - Real-time dashboards
   - Topic hierarchy visualization
   - Growing industry importance

### Phase 4: Flagship Feature (Week 5-6)
**Goal**: Complex, high-impact implementation

8. **SSH** (10 days)
   - Most complex protocol
   - Highest value feature
   - Terminal emulation
   - Session persistence
   - **Showcase feature**

## Common Patterns

### 1. Worker Socket Handler

Every protocol follows this pattern:

```typescript
// src/worker/protocols/{protocol}/client.ts

import { connect } from 'cloudflare:sockets';

export interface ProtocolConfig {
  host: string;
  port: number;
  // Protocol-specific auth/config
}

export class ProtocolClient {
  private socket: Socket;

  async connect(): Promise<void> {
    this.socket = connect(`${this.config.host}:${this.config.port}`);
    await this.socket.opened;

    // Protocol-specific handshake
    await this.performHandshake();
  }

  async sendCommand(cmd: string): Promise<Response> {
    // Protocol-specific command encoding
    const encoded = this.encodeCommand(cmd);

    const writer = this.socket.writable.getWriter();
    await writer.write(encoded);
    writer.releaseLock();

    // Read response
    return this.readResponse();
  }

  async close(): Promise<void> {
    await this.socket.close();
  }
}
```

### 2. WebSocket Tunnel

For interactive sessions:

```typescript
// src/worker/protocols/{protocol}/tunnel.ts

export async function protocolTunnel(
  request: Request,
  config: ProtocolConfig
): Promise<Response> {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();

  (async () => {
    try {
      const protocol = new ProtocolClient(config);
      await protocol.connect();

      server.send(JSON.stringify({ type: 'connected' }));

      // Browser → Protocol
      server.addEventListener('message', async (event) => {
        const msg = JSON.parse(event.data);
        const result = await protocol.handleMessage(msg);
        server.send(JSON.stringify(result));
      });

      // Protocol → Browser (if needed)
      // Some protocols push data without request

      server.addEventListener('close', () => {
        protocol.close();
      });

    } catch (error) {
      server.send(JSON.stringify({
        type: 'error',
        error: error.message,
      }));
      server.close();
    }
  })();

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}
```

### 3. API Endpoints

```typescript
// src/worker/index.ts

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Quick command (no persistent connection)
    if (url.pathname === '/api/{protocol}/exec') {
      const { host, port, command } = await request.json();

      const client = new ProtocolClient({ host, port });
      await client.connect();
      const result = await client.sendCommand(command);
      await client.close();

      return Response.json(result);
    }

    // WebSocket tunnel (persistent)
    if (url.pathname === '/api/{protocol}/connect') {
      const config = await request.json();
      return protocolTunnel(request, config);
    }

    // ... other routes
  }
};
```

### 4. React Component Structure

```typescript
// src/components/ProtocolClient.tsx

export function ProtocolClient() {
  const [connected, setConnected] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState(0);

  const ws = useRef<WebSocket | null>(null);

  const connect = () => {
    ws.current = new WebSocket(`/api/{protocol}/connect`);

    ws.current.onopen = () => {
      ws.current?.send(JSON.stringify({ host, port }));
    };

    ws.current.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      handleProtocolMessage(msg);
    };

    ws.current.onclose = () => {
      setConnected(false);
    };
  };

  return (
    <div className="protocol-client">
      {!connected ? (
        <ConnectionForm onConnect={connect} />
      ) : (
        <ProtocolInterface ws={ws.current} />
      )}
    </div>
  );
}
```

## Protocol Complexity Matrix

| Protocol | Lines of Code | Complexity | Value | Priority |
|----------|---------------|------------|-------|----------|
| ECHO | ~200 | Low | Low | 1st (foundation) |
| WHOIS | ~400 | Low | Medium | 2nd (foundation) |
| REDIS | ~800 | Medium | High | 3rd (quick win) |
| IRC | ~600 | Medium | Medium | 4th (real-time) |
| MQTT | ~1000 | Medium | High | 5th (IoT) |
| MySQL | ~1200 | High | High | 6th (databases) |
| SSH | ~2000+ | Very High | Very High | 7th (flagship) |

## Key Implementation Decisions

### When to Use External Libraries

| Protocol | Library | Rationale |
|----------|---------|-----------|
| ECHO | None | Too simple |
| WHOIS | None | Simple parsing |
| REDIS | None | RESP is simple enough |
| MySQL | `mysql2` | Binary protocol is complex |
| SSH | `ssh2` | Crypto/terminal too complex |
| MQTT | `mqtt.js` | Save time on tested code |
| IRC | None | Line-based, easy to parse |

**Rule of thumb**: Use library if protocol involves:
- Binary framing (MySQL, PostgreSQL)
- Cryptography (SSH, TLS)
- Complex state machines (FTP, SMTP)

### Text vs Binary Protocols

**Text Protocols** (easier):
- ECHO, WHOIS, IRC, REDIS, SMTP, POP3, FTP
- Human-readable during development
- Easy to debug with Wireshark/tcpdump
- Simple string manipulation

**Binary Protocols** (harder):
- MySQL, PostgreSQL, MongoDB, MQTT (header)
- Require byte-level parsing
- More efficient on wire
- Need good test coverage

### Connection Patterns

**Request/Response**:
- WHOIS, ECHO
- Single TCP connection per request
- Close after response
- Simple to implement

**Persistent Session**:
- Redis, MySQL, SSH
- Keep connection open
- Multiple commands
- Need WebSocket tunnel

**Pub/Sub**:
- MQTT, Redis Pub/Sub
- Server pushes data
- Requires event handling
- Real-time UI updates

## Security Checklist

For every protocol implementation:

- [ ] **Input Validation**
  - [ ] Host/port validation
  - [ ] Command/query sanitization
  - [ ] Length limits

- [ ] **Rate Limiting**
  - [ ] Per-IP connection limits
  - [ ] Per-user command rate limits
  - [ ] Global resource quotas

- [ ] **Authentication**
  - [ ] Never log passwords
  - [ ] Don't cache credentials
  - [ ] Support secure auth methods

- [ ] **Network Safety**
  - [ ] Block localhost/internal IPs
  - [ ] Block cloud metadata endpoints
  - [ ] Validate DNS responses

- [ ] **Error Handling**
  - [ ] Don't leak internal details
  - [ ] Log security events
  - [ ] Graceful degradation

## Testing Strategy

### Unit Tests

```typescript
// tests/protocols/{protocol}.test.ts

describe('Protocol Client', () => {
  it('should connect successfully', async () => {
    const client = new ProtocolClient({ host, port });
    await client.connect();
    await client.close();
  });

  it('should handle commands', async () => {
    const client = new ProtocolClient({ host, port });
    await client.connect();

    const result = await client.sendCommand('TEST');
    expect(result).toBeDefined();

    await client.close();
  });

  it('should handle connection errors', async () => {
    const client = new ProtocolClient({
      host: 'invalid-host.local',
      port: 9999,
    });

    await expect(client.connect()).rejects.toThrow();
  });
});
```

### Integration Tests

```typescript
// tests/integration/{protocol}.test.ts

describe('Protocol API Endpoints', () => {
  it('should handle /api/{protocol}/exec', async () => {
    const response = await fetch('http://localhost:8787/api/{protocol}/exec', {
      method: 'POST',
      body: JSON.stringify({ host, port, command: 'TEST' }),
    });

    expect(response.ok).toBe(true);
    const result = await response.json();
    expect(result).toBeDefined();
  });
});
```

### Test Servers

Set up local test servers:

```bash
# Redis
docker run -d -p 6379:6379 redis:latest

# MySQL
docker run -d -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=testpass \
  mysql:8.0

# MQTT
docker run -d -p 1883:1883 eclipse-mosquitto

# IRC (test bot)
# Use public servers: irc.libera.chat

# SSH
docker run -d -p 2222:22 \
  -e USER_NAME=testuser \
  -e USER_PASSWORD=testpass \
  linuxserver/openssh-server
```

## Performance Considerations

### Connection Pooling

For high-traffic protocols:

```typescript
class ProtocolPool {
  private connections: Map<string, ProtocolClient[]> = new Map();

  async getConnection(host: string, port: number): Promise<ProtocolClient> {
    const key = `${host}:${port}`;
    const pool = this.connections.get(key) || [];

    if (pool.length > 0) {
      return pool.pop()!; // Reuse existing
    }

    // Create new connection
    const client = new ProtocolClient({ host, port });
    await client.connect();
    return client;
  }

  returnConnection(host: string, port: number, client: ProtocolClient) {
    const key = `${host}:${port}`;
    const pool = this.connections.get(key) || [];
    pool.push(client);
    this.connections.set(key, pool);
  }
}
```

### Caching

For read-heavy protocols (WHOIS, DNS):

```typescript
async function cachedLookup(domain: string, env: Env): Promise<Result> {
  const cacheKey = `whois:${domain}`;

  // Check KV cache
  const cached = await env.KV.get(cacheKey, 'json');
  if (cached) return cached;

  // Perform lookup
  const result = await performLookup(domain);

  // Cache for 1 hour
  await env.KV.put(cacheKey, JSON.stringify(result), {
    expirationTtl: 3600,
  });

  return result;
}
```

## Debugging Tips

### Enable Debug Logging

```typescript
const DEBUG = true;

function log(...args: any[]) {
  if (DEBUG) console.log('[Protocol]', ...args);
}

// In protocol code:
log('Sending command:', command);
log('Received response:', response);
```

### Packet Inspection

```typescript
// Log raw bytes for debugging
const writer = socket.writable.getWriter();
const data = encoder.encode(message);

console.log('Sending bytes:', Array.from(data).map(b => b.toString(16)));

await writer.write(data);
```

### Test with netcat

```bash
# Echo server
nc -l 9999

# Connect and test manually
nc localhost 9999
```

## Resources

### Cloudflare Docs
- [Sockets API](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
- [WebSockets](https://developers.cloudflare.com/workers/runtime-apis/websockets/)
- [Workers Examples](https://developers.cloudflare.com/workers/examples/)

### Protocol Specs
- [RFC Index](https://www.rfc-editor.org/)
- [Protocol Buffers](https://protobuf.dev/)
- [Wireshark Docs](https://www.wireshark.org/docs/)

### Testing Tools
- [tcpdump](https://www.tcpdump.org/)
- [Wireshark](https://www.wireshark.org/)
- [netcat](https://nc110.sourceforge.io/)
- [tcpbin.com](http://tcpbin.com/) - TCP echo service

## Getting Help

When stuck:

1. **Read the protocol spec** (RFC or official docs)
2. **Capture packets** with Wireshark
3. **Test with standard clients** (mysql CLI, redis-cli, etc.)
4. **Compare behavior** - what does the official client send?
5. **Check the implementation plans** in this directory
6. **Search for existing implementations** on GitHub

## Next Steps

1. Review [TCP_PROTOCOLS.md](../TCP_PROTOCOLS.md) for full protocol list
2. Choose a protocol from the roadmap above
3. Read the specific implementation plan
4. Set up local test server (Docker)
5. Implement Worker client class
6. Add WebSocket tunnel
7. Build React UI
8. Write tests
9. Deploy and iterate

---

**Remember**: Start simple (ECHO/WHOIS), establish patterns, then tackle complex protocols (SSH/MySQL).
