# SOCKS5 Protocol Implementation Plan

## Overview

**Protocol:** SOCKS5 (SOCKet Secure v5)
**Port:** 1080
**RFC:** [RFC 1928](https://tools.ietf.org/html/rfc1928)
**Complexity:** Medium
**Purpose:** Generic proxy protocol

SOCKS5 is a **protocol-agnostic proxy** that can tunnel any TCP connection. In Port of Call, it enables proxying other protocol connections through a SOCKS5 server.

### Use Cases
- Proxy TCP connections through remote server
- Bypass network restrictions
- Test services through different network paths
- Educational - learn proxy protocols
- Connect to services behind firewall

## Protocol Specification

### SOCKS5 Handshake

```
1. Client → Server: Authentication methods
   +----+----------+----------+
   |VER | NMETHODS | METHODS  |
   +----+----------+----------+
   | 1  |    1     | 1 to 255 |
   +----+----------+----------+

2. Server → Client: Selected method
   +----+--------+
   |VER | METHOD |
   +----+--------+
   | 1  |   1    |
   +----+--------+

3. Client → Server: Connection request
   +----+-----+-------+------+----------+----------+
   |VER | CMD |  RSV  | ATYP | DST.ADDR | DST.PORT |
   +----+-----+-------+------+----------+----------+
   | 1  |  1  | X'00' |  1   | Variable |    2     |
   +----+-----+-------+------+----------+----------+

4. Server → Client: Connection response
   +----+-----+-------+------+----------+----------+
   |VER | REP |  RSV  | ATYP | BND.ADDR | BND.PORT |
   +----+-----+-------+------+----------+----------+
   | 1  |  1  | X'00' |  1   | Variable |    2     |
   +----+-----+-------+------+----------+----------+

5. Data exchange
```

### Authentication Methods

| Code | Method |
|------|--------|
| 0x00 | No authentication |
| 0x02 | Username/password |
| 0xFF | No acceptable methods |

### Commands

| Code | Command |
|------|---------|
| 0x01 | CONNECT |
| 0x02 | BIND |
| 0x03 | UDP ASSOCIATE |

## Worker Implementation

### SOCKS5 Client

```typescript
// src/worker/protocols/socks5/client.ts

import { connect } from 'cloudflare:sockets';

export interface SOCKS5Config {
  proxyHost: string;
  proxyPort: number;
  username?: string;
  password?: string;
}

export class SOCKS5Client {
  private socket: Socket;

  constructor(private config: SOCKS5Config) {}

  async connectThrough(targetHost: string, targetPort: number): Promise<Socket> {
    // Connect to SOCKS5 proxy
    this.socket = connect(`${this.config.proxyHost}:${this.config.proxyPort}`);
    await this.socket.opened;

    // Handshake
    await this.sendGreeting();
    const method = await this.readMethod();

    if (method === 0x02) {
      // Username/password auth
      await this.authenticate();
    }

    // Send connection request
    await this.sendConnectRequest(targetHost, targetPort);
    await this.readConnectResponse();

    // Return socket for direct use
    return this.socket;
  }

  private async sendGreeting(): Promise<void> {
    const methods = [0x00]; // No auth
    if (this.config.username && this.config.password) {
      methods.push(0x02); // Username/password
    }

    const greeting = new Uint8Array([
      0x05, // SOCKS version
      methods.length,
      ...methods,
    ]);

    const writer = this.socket.writable.getWriter();
    await writer.write(greeting);
    writer.releaseLock();
  }

  private async readMethod(): Promise<number> {
    const reader = this.socket.readable.getReader();
    const { value } = await reader.read();
    reader.releaseLock();

    // Response: [version, method]
    return value[1];
  }

  private async authenticate(): Promise<void> {
    const username = this.config.username!;
    const password = this.config.password!;

    const usernameBytes = new TextEncoder().encode(username);
    const passwordBytes = new TextEncoder().encode(password);

    const auth = new Uint8Array([
      0x01, // Auth version
      usernameBytes.length,
      ...usernameBytes,
      passwordBytes.length,
      ...passwordBytes,
    ]);

    const writer = this.socket.writable.getWriter();
    await writer.write(auth);
    writer.releaseLock();

    // Read auth response
    const reader = this.socket.readable.getReader();
    const { value } = await reader.read();
    reader.releaseLock();

    if (value[1] !== 0x00) {
      throw new Error('Authentication failed');
    }
  }

  private async sendConnectRequest(host: string, port: number): Promise<void> {
    const hostBytes = new TextEncoder().encode(host);

    const request = new Uint8Array([
      0x05, // SOCKS version
      0x01, // CONNECT command
      0x00, // Reserved
      0x03, // Domain name
      hostBytes.length,
      ...hostBytes,
      (port >> 8) & 0xff,
      port & 0xff,
    ]);

    const writer = this.socket.writable.getWriter();
    await writer.write(request);
    writer.releaseLock();
  }

  private async readConnectResponse(): Promise<void> {
    const reader = this.socket.readable.getReader();
    const { value } = await reader.read();
    reader.releaseLock();

    // Response: [version, reply, reserved, atyp, bind_addr, bind_port]
    if (value[1] !== 0x00) {
      const errors = [
        'General SOCKS server failure',
        'Connection not allowed by ruleset',
        'Network unreachable',
        'Host unreachable',
        'Connection refused',
        'TTL expired',
        'Command not supported',
        'Address type not supported',
      ];

      throw new Error(errors[value[1] - 1] || 'Unknown SOCKS error');
    }
  }
}
```

## Use Case: Proxy Other Protocols

```typescript
// Example: Connect to Redis through SOCKS5 proxy

const socks5 = new SOCKS5Client({
  proxyHost: 'proxy.example.com',
  proxyPort: 1080,
  username: 'user',
  password: 'pass',
});

// Establish tunnel through proxy
const socket = await socks5.connectThrough('redis.server.com', 6379);

// Now use socket for Redis protocol
const redis = new RedisClient({ socket });
await redis.query('PING');
```

## Web UI Design

```typescript
// src/components/SOCKS5Config.tsx

export function SOCKS5Config() {
  const [proxyHost, setProxyHost] = useState('');
  const [proxyPort, setProxyPort] = useState(1080);
  const [targetHost, setTargetHost] = useState('');
  const [targetPort, setTargetPort] = useState(80);

  const testConnection = async () => {
    const response = await fetch('/api/socks5/test', {
      method: 'POST',
      body: JSON.stringify({
        proxyHost,
        proxyPort,
        targetHost,
        targetPort,
      }),
    });

    const data = await response.json();
    alert(data.success ? 'Connected!' : `Failed: ${data.error}`);
  };

  return (
    <div className="socks5-config">
      <h2>SOCKS5 Proxy Configuration</h2>

      <div className="proxy-settings">
        <h3>Proxy Server</h3>
        <input
          type="text"
          placeholder="Proxy Host"
          value={proxyHost}
          onChange={(e) => setProxyHost(e.target.value)}
        />
        <input
          type="number"
          placeholder="Proxy Port"
          value={proxyPort}
          onChange={(e) => setProxyPort(Number(e.target.value))}
        />
      </div>

      <div className="target-settings">
        <h3>Target Server</h3>
        <input
          type="text"
          placeholder="Target Host"
          value={targetHost}
          onChange={(e) => setTargetHost(e.target.value)}
        />
        <input
          type="number"
          placeholder="Target Port"
          value={targetPort}
          onChange={(e) => setTargetPort(Number(e.target.value))}
        />
      </div>

      <button onClick={testConnection}>Test Connection</button>
    </div>
  );
}
```

## Testing

```bash
# SSH SOCKS5 tunnel
ssh -D 1080 user@proxy-server.com

# Test with curl
curl --socks5 localhost:1080 http://example.com
```

## Resources

- **RFC 1928**: [SOCKS5 Protocol](https://tools.ietf.org/html/rfc1928)
- **RFC 1929**: [Username/Password Auth](https://tools.ietf.org/html/rfc1929)

## Notes

- SOCKS5 is **protocol-agnostic** - works with any TCP protocol
- Commonly used for **VPN-like** functionality
- Can chain multiple SOCKS proxies
- Consider security implications of proxying user traffic
