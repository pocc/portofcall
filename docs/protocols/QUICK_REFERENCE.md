# Protocol Implementation Quick Reference

One-page reference for implementing TCP protocols in Port of Call.

## File Structure

```
portofcall/
├── src/
│   ├── worker/
│   │   ├── protocols/
│   │   │   └── {protocol}/
│   │   │       ├── client.ts       # Protocol client class
│   │   │       ├── tunnel.ts       # WebSocket tunnel
│   │   │       └── parser.ts       # Protocol parsing (if needed)
│   │   └── index.ts                # Main Worker entry (add routes here)
│   └── components/
│       └── {Protocol}Client.tsx    # React UI component
└── tests/
    └── protocols/
        └── {protocol}.test.ts      # Unit tests
```

## Implementation Checklist

### 1. Worker Client Class

```typescript
// src/worker/protocols/{protocol}/client.ts

import { connect } from 'cloudflare:sockets';

export interface ProtocolConfig {
  host: string;
  port: number;
  // Add protocol-specific fields
}

export class ProtocolClient {
  private socket: Socket;

  constructor(private config: ProtocolConfig) {}

  async connect(): Promise<void> {
    this.socket = connect(`${this.config.host}:${this.config.port}`);
    await this.socket.opened;
  }

  async close(): Promise<void> {
    await this.socket.close();
  }
}
```

### 2. WebSocket Tunnel

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

      server.addEventListener('message', async (event) => {
        // Handle messages
      });

      server.addEventListener('close', () => {
        protocol.close();
      });
    } catch (error) {
      server.send(JSON.stringify({ type: 'error', error: error.message }));
      server.close();
    }
  })();

  return new Response(null, { status: 101, webSocket: client });
}
```

### 3. Add API Routes

```typescript
// src/worker/index.ts

import { protocolTunnel } from './protocols/{protocol}/tunnel';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/{protocol}/connect') {
      const config = await request.json();
      return protocolTunnel(request, config);
    }

    // ... existing routes
  }
};
```

### 4. React Component

```typescript
// src/components/{Protocol}Client.tsx

export function ProtocolClient() {
  const [connected, setConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);

  const connect = () => {
    ws.current = new WebSocket('/api/{protocol}/connect');
    ws.current.onopen = () => {
      ws.current?.send(JSON.stringify({ /* config */ }));
    };
    ws.current.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'connected') setConnected(true);
    };
    ws.current.onclose = () => setConnected(false);
  };

  return <div>{/* UI */}</div>;
}
```

### 5. Add to App Routes

```typescript
// src/App.tsx

import { ProtocolClient } from './components/ProtocolClient';

function App() {
  return (
    <Router>
      <Route path="/{protocol}" element={<ProtocolClient />} />
    </Router>
  );
}
```

## Common Code Patterns

### Reading from Socket

```typescript
async function readUntilDelimiter(
  socket: Socket,
  delimiter: string = '\r\n'
): Promise<string> {
  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const index = buffer.indexOf(delimiter);
    if (index !== -1) {
      const line = buffer.substring(0, index);
      buffer = buffer.substring(index + delimiter.length);
      reader.releaseLock();
      return line;
    }
  }

  reader.releaseLock();
  return buffer;
}
```

### Writing to Socket

```typescript
async function send(socket: Socket, data: string | Uint8Array): Promise<void> {
  const writer = socket.writable.getWriter();

  if (typeof data === 'string') {
    const encoder = new TextEncoder();
    await writer.write(encoder.encode(data));
  } else {
    await writer.write(data);
  }

  writer.releaseLock();
}
```

### Binary Packet Parsing

```typescript
function parsePacket(buffer: Uint8Array): { header: any; payload: Uint8Array } {
  const view = new DataView(buffer.buffer);

  const header = {
    length: view.getUint32(0, true), // Little-endian
    type: view.getUint8(4),
    sequenceId: view.getUint8(5),
  };

  const payload = buffer.slice(6);

  return { header, payload };
}
```

### Building Binary Packets

```typescript
function buildPacket(type: number, payload: Uint8Array): Uint8Array {
  const header = new Uint8Array(6);
  const view = new DataView(header.buffer);

  view.setUint32(0, payload.length, true); // Length (little-endian)
  view.setUint8(4, type); // Packet type
  view.setUint8(5, 0); // Sequence ID

  return new Uint8Array([...header, ...payload]);
}
```

## Security Patterns

### Input Validation

```typescript
function validateConfig(config: ProtocolConfig): boolean {
  // Port range
  if (config.port < 1 || config.port > 65535) return false;

  // No localhost
  const blocked = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];
  if (blocked.some(b => config.host.includes(b))) return false;

  // No private networks
  if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(config.host)) {
    return false;
  }

  return true;
}
```

### Rate Limiting (Durable Objects)

```typescript
// src/worker/rate-limiter.ts

export class RateLimiter {
  state: DurableObjectState;

  async checkLimit(ip: string, limit: number): Promise<boolean> {
    const key = `rate:${ip}`;
    const count = (await this.state.storage.get(key)) || 0;

    if (count >= limit) return false;

    await this.state.storage.put(key, count + 1, {
      expirationTtl: 60, // 1 minute
    });

    return true;
  }
}
```

## Testing Patterns

### Unit Test Template

```typescript
// tests/protocols/{protocol}.test.ts

import { ProtocolClient } from '../src/worker/protocols/{protocol}/client';

describe('Protocol Client', () => {
  const config = {
    host: 'localhost',
    port: 9999,
  };

  it('should connect', async () => {
    const client = new ProtocolClient(config);
    await client.connect();
    await client.close();
  });

  it('should handle errors', async () => {
    const client = new ProtocolClient({
      host: 'invalid.local',
      port: 9999,
    });

    await expect(client.connect()).rejects.toThrow();
  });
});
```

### Docker Test Server

```bash
# Add to docker-compose.yml

version: '3'
services:
  {protocol}:
    image: {protocol-image}
    ports:
      - "{port}:{port}"
    environment:
      - TEST_MODE=true
```

## Debugging Commands

### Worker Development

```bash
# Start Vite (React UI)
npm run dev

# Start Wrangler (Worker)
npm run worker:dev

# Deploy to production
npm run worker:deploy

# View logs
wrangler tail
```

### Network Debugging

```bash
# Test TCP connection
nc -v hostname port

# Capture packets
tcpdump -i any -n port {port}

# Wireshark filter
tcp.port == {port}

# Test with curl (HTTP)
curl -v http://hostname:port
```

### Protocol-Specific Testing

```bash
# Redis
redis-cli -h localhost -p 6379

# MySQL
mysql -h localhost -P 3306 -u root -p

# SSH
ssh -p 22 user@hostname

# MQTT
mosquitto_pub -h localhost -t test/topic -m "message"
mosquitto_sub -h localhost -t test/#

# IRC
nc irc.libera.chat 6667
```

## Performance Tips

1. **Connection Pooling**: Reuse connections when possible
2. **Caching**: Use KV for frequently accessed data
3. **Batch Operations**: Combine multiple commands
4. **Streaming**: Use readable streams for large data
5. **Smart Placement**: Let Worker migrate closer to backend

## Error Handling

```typescript
try {
  const socket = connect(`${host}:${port}`);
  await socket.opened;
} catch (error) {
  if (error.message.includes('timeout')) {
    // Connection timeout
  } else if (error.message.includes('refused')) {
    // Connection refused
  } else if (error.message.includes('host')) {
    // DNS/host error
  } else {
    // Unknown error
  }
}
```

## Common Pitfalls

1. **Forgetting to close sockets** → Use try/finally blocks
2. **Not handling partial reads** → Buffer incomplete data
3. **Blocking WebSocket thread** → Use async/await properly
4. **Hardcoding buffers sizes** → Make them configurable
5. **Ignoring protocol versions** → Check version compatibility
6. **Not validating inputs** → Always sanitize user data
7. **Leaking credentials** → Never log passwords
8. **Missing error handlers** → Add .catch() to all promises

## Quick Protocol Reference

| Protocol | Port | Pattern | Complexity |
|----------|------|---------|------------|
| ECHO | 7 | Mirror input | Trivial |
| WHOIS | 43 | Request/Response | Low |
| DNS | 53 | Query/Response | Low |
| IRC | 6667 | Line-based chat | Medium |
| REDIS | 6379 | Text protocol (RESP) | Medium |
| MQTT | 1883 | Pub/Sub binary | Medium |
| MySQL | 3306 | Binary protocol | High |
| SSH | 22 | Encrypted shell | Very High |

## Useful Links

- [Cloudflare Sockets API](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
- [RFC Editor](https://www.rfc-editor.org/)
- [Wireshark Protocol Docs](https://www.wireshark.org/docs/dfref/)
- [TCP/IP Guide](http://www.tcpipguide.com/)

## Support

- Documentation: [docs/](../)
- Implementation Plans: [protocols/](.)
- TCP Protocols List: [TCP_PROTOCOLS.md](../TCP_PROTOCOLS.md)
- Architecture: [ARCHITECTURE.md](../ARCHITECTURE.md)

---

**Quick Start**: Read [ECHO.md](./ECHO.md) → Implement → Test → Move to [WHOIS.md](./WHOIS.md)
