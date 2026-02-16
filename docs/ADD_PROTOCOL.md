# Adding a New Protocol to Port of Call

Complete step-by-step guide for implementing TCP protocols in Port of Call.

## Prerequisites

Before starting, **ALWAYS**:
1. ✅ Check [node_modules/mutex.md](node_modules/mutex.md) - Avoid duplicate work
2. ✅ Verify protocol is TCP-based (consult [docs/IMPOSSIBLE.md](docs/IMPOSSIBLE.md))
3. ✅ Review implemented protocols in [docs/IMPLEMENTED.md](docs/IMPLEMENTED.md)
4. ✅ Read the full documentation in [docs/](docs/)

## Quick Start Checklist

### 1. Protocol Selection
- [ ] Protocol uses TCP (not UDP, ICMP, or raw sockets)
- [ ] Not listed as "Currently Implementing" in [node_modules/mutex.md](node_modules/mutex.md)
- [ ] Not listed as "Impossible" in [docs/IMPOSSIBLE.md](docs/IMPOSSIBLE.md)
- [ ] Not already completed in [docs/IMPLEMENTED.md](docs/IMPLEMENTED.md)

### 2. Mark as In Progress
**IMPORTANT**: Update [node_modules/mutex.md](node_modules/mutex.md):
```markdown
## Currently Implementing:
- YourProtocol (Port XXXX) - Brief description
```

### 3. Research Phase
- [ ] Read RFC or official protocol specification
- [ ] Study [docs/TCP_PROTOCOLS.md](docs/TCP_PROTOCOLS.md) for protocol details
- [ ] Check if protocol-specific docs exist in [docs/protocols/](docs/protocols/)
- [ ] Review implementation patterns in [docs/protocols/IMPLEMENTATION_GUIDE.md](docs/protocols/IMPLEMENTATION_GUIDE.md)

## Implementation Process

### Phase 1: Architectural Review

**Analyze how the protocol fits into the existing architecture:**

```typescript
// Consider these questions:
// 1. Is this request/response or persistent session?
// 2. Text-based or binary protocol?
// 3. Does it need authentication?
// 4. Are there special security concerns?
// 5. Does it push data to client (pub/sub)?
```

**Check for conflicts with existing protocols:**
- Similar ports (e.g., HTTP on 80, HTTPS on 443)
- Overlapping functionality (e.g., FTP vs SFTP)
- Shared dependencies or patterns

### Phase 2: Implementation Plan

Create a brief outline covering:

#### A. Worker Logic
- Protocol handshake sequence
- Message encoding/decoding
- Command parsing
- Response handling
- Error handling

#### B. Client Logic
- WebSocket connection management
- UI components needed
- User input handling
- Response visualization

#### C. State Management
- Does this need Durable Objects?
- Session persistence requirements
- Connection pooling considerations

### Phase 3: Execute Implementation

Follow this file structure:

```
src/worker/protocols/{protocol}/
├── client.ts           # TCP socket handler
├── tunnel.ts           # WebSocket tunnel
├── types.ts            # TypeScript interfaces
└── utils.ts            # Helper functions

src/components/{Protocol}/
├── {Protocol}Client.tsx    # Main UI component
├── ConnectionForm.tsx      # Connection inputs
└── {Protocol}Interface.tsx # Protocol-specific UI

tests/protocols/
├── {protocol}.test.ts      # Unit tests
└── {protocol}.integration.test.ts  # Integration tests

docs/protocols/
└── {PROTOCOL}.md           # Implementation documentation
```

#### Worker Implementation Template

```typescript
// src/worker/protocols/{protocol}/client.ts
import { connect } from 'cloudflare:sockets';

export interface ProtocolConfig {
  host: string;
  port: number;
  // Add protocol-specific config
}

export class ProtocolClient {
  private socket: Socket;
  private config: ProtocolConfig;

  constructor(config: ProtocolConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    this.socket = connect(`${this.config.host}:${this.config.port}`);
    await this.socket.opened;

    // Perform protocol-specific handshake
    await this.handshake();
  }

  private async handshake(): Promise<void> {
    // Protocol-specific initialization
  }

  async sendCommand(command: string): Promise<Response> {
    // Encode and send command
    // Read and parse response
  }

  async close(): Promise<void> {
    await this.socket.close();
  }
}
```

#### WebSocket Tunnel Template

```typescript
// src/worker/protocols/{protocol}/tunnel.ts
export async function createProtocolTunnel(
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
        const msg = JSON.parse(event.data);
        const result = await protocol.handleMessage(msg);
        server.send(JSON.stringify(result));
      });

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

### Phase 4: Verify & Edge Cases

Document how your protocol handles:

#### A. Authentication
- [ ] Password-based auth
- [ ] Key-based auth
- [ ] Token-based auth
- [ ] Anonymous connections
- [ ] Credential storage (never log passwords!)

#### B. Timeouts & Keep-alives
- [ ] Connection timeout (default: 30s)
- [ ] Read timeout
- [ ] Idle connection handling
- [ ] Keep-alive packets (if required)

#### C. Binary vs Text Encoding
- [ ] Text protocol: Use TextEncoder/TextDecoder
- [ ] Binary protocol: Use Uint8Array, DataView
- [ ] Mixed: Handle both appropriately
- [ ] Protocol framing (length-prefixed, delimited, etc.)

#### D. Security Considerations
- [ ] Input validation (host, port, commands)
- [ ] SSRF protection (block localhost, internal IPs)
- [ ] Rate limiting
- [ ] Command injection prevention
- [ ] Cloudflare detection (if applicable)

#### E. Error Handling
- [ ] Connection refused
- [ ] Timeout
- [ ] Protocol errors
- [ ] Authentication failures
- [ ] Malformed responses

## Testing Strategy

### Unit Tests

```typescript
// tests/protocols/{protocol}.test.ts
import { describe, it, expect } from 'vitest';
import { ProtocolClient } from '@/worker/protocols/{protocol}/client';

describe('Protocol Client', () => {
  it('should connect successfully', async () => {
    const client = new ProtocolClient({
      host: 'test.example.com',
      port: 1234,
    });

    await client.connect();
    await client.close();
  });

  // Add more tests...
});
```

### Integration Tests

Test with real servers:
```bash
# Use public test servers or Docker containers
docker run -d -p 6379:6379 redis:latest
```

## Documentation Requirements

Create or update:

1. **[docs/protocols/{PROTOCOL}.md](docs/protocols/)** - Implementation details
2. **[docs/IMPLEMENTED.md](docs/IMPLEMENTED.md)** - Add to implemented list
3. **[node_modules/mutex.md](node_modules/mutex.md)** - Move to "Completed This Session"
4. **[README.md](README.md)** - Update if adding major feature

## Completion Checklist

Before marking as complete:

- [ ] Protocol connects successfully
- [ ] All commands/operations work
- [ ] Error handling implemented
- [ ] Security measures in place
- [ ] Unit tests written and passing
- [ ] Integration tests passing
- [ ] Documentation updated
- [ ] Code reviewed for best practices
- [ ] Cloudflare detection handled (if applicable)
- [ ] Rate limiting considered
- [ ] Moved from "Currently Implementing" to "Completed" in mutex.md

## Deployment

```bash
# Test locally
npm run worker:dev

# Run tests
npm test

# Deploy to production
npm run worker:deploy
```

## Tech Stack Reference

**Runtime**: Cloudflare Workers (ES Modules)
**Transport**: WebSockets (for tunneling TCP)
**State**: Durable Objects (optional, for persistence)
**Client**: Browser-based React UI
**Build**: Vite + TypeScript
**Testing**: Vitest

## Protocol Implementation Examples

Study these for patterns:

### Simple Protocols (Start Here)
- **Echo** - [docs/protocols/ECHO.md](docs/protocols/ECHO.md)
- **Whois** - [docs/protocols/WHOIS.md](docs/protocols/WHOIS.md)
- **Redis** - [docs/protocols/REDIS.md](docs/protocols/REDIS.md)

### Medium Complexity
- **MQTT** - [docs/protocols/MQTT.md](docs/protocols/MQTT.md)
- **IRC** - [docs/protocols/IRC.md](docs/protocols/IRC.md)
- **MySQL** - [docs/protocols/MYSQL.md](docs/protocols/MYSQL.md)

### Advanced
- **SSH** - [docs/protocols/SSH.md](docs/protocols/SSH.md)
- **FTP** - See [docs/FTP_CODE_REVIEW.md](docs/FTP_CODE_REVIEW.md)

## Common Pitfalls

❌ **Avoid**:
- Implementing UDP-based protocols (not supported)
- Forgetting to update mutex.md
- Skipping security validation
- Not handling Cloudflare-protected hosts
- Hardcoding credentials
- Missing error handling
- Incomplete test coverage

✅ **Best Practices**:
- Always validate inputs
- Use proper TypeScript types
- Follow existing code patterns
- Write comprehensive tests
- Document edge cases
- Handle all error conditions
- Log appropriately (never log secrets)

## Getting Help

- **Patterns**: [docs/protocols/IMPLEMENTATION_GUIDE.md](docs/protocols/IMPLEMENTATION_GUIDE.md)
- **Quick Reference**: [docs/protocols/QUICK_REFERENCE.md](docs/protocols/QUICK_REFERENCE.md)
- **Security**: [docs/CLOUDFLARE_DETECTION.md](docs/CLOUDFLARE_DETECTION.md)
- **Testing**: [docs/API_TESTING.md](docs/API_TESTING.md)
- **Architecture**: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## After Completion

When you finish implementing a protocol:

1. ✅ Update [docs/IMPLEMENTED.md](docs/IMPLEMENTED.md)
2. ✅ Move to "Completed This Session" in [node_modules/mutex.md](node_modules/mutex.md)
3. ✅ Create protocol documentation in [docs/protocols/](docs/protocols/)
4. ✅ Deploy to production
5. ✅ Test live deployment
6. ✅ **Reread this guide before starting next protocol**

---

**Remember**: Quality over speed. A well-implemented protocol with proper security and testing is better than rushing through multiple protocols.