# SSH Protocol Implementation Plan

## Overview

**Protocol:** SSH (Secure Shell)
**Port:** 22
**RFC:** [RFC 4253](https://tools.ietf.org/html/rfc4253) (SSH Transport Layer)
**Complexity:** High
**Purpose:** Remote terminal access, secure command execution

SSH is the **flagship feature** of Port of Call - a full terminal in the browser without plugins or installations.

### Use Cases
- Emergency server access from any device
- DevOps/SysAdmin tasks from tablets/Chromebooks
- Teaching SSH and Unix commands
- Secure remote administration
- Jump box/bastion host in browser

## Protocol Specification

### SSH Protocol Layers

```
┌──────────────────────────────┐
│  Application Layer (SSH)      │ ← Commands, SFTP, port forwarding
├──────────────────────────────┤
│  Connection Layer             │ ← Channels, requests
├──────────────────────────────┤
│  Authentication Layer         │ ← Password, public key
├──────────────────────────────┤
│  Transport Layer              │ ← Encryption, key exchange
├──────────────────────────────┤
│  TCP (Port 22)                │
└──────────────────────────────┘
```

### Connection Flow

1. **TCP Handshake**: Connect to port 22
2. **Protocol Version Exchange**: Both sides send `SSH-2.0-...\r\n`
3. **Key Exchange**: Algorithm negotiation + Diffie-Hellman
4. **Authentication**: Password, public key, or keyboard-interactive
5. **Channel Open**: Request PTY (pseudo-terminal)
6. **Shell Request**: Start interactive shell
7. **Data Exchange**: Encrypted I/O over channel
8. **Close**: Clean shutdown of channel and connection

### Binary Packet Format

```
uint32    packet_length
byte      padding_length
byte[n1]  payload
byte[n2]  random padding
byte[m]   mac (message authentication code)
```

All packets are encrypted after key exchange.

## Worker Implementation

### Strategy: Use SSH2 Library

**Problem**: SSH is extremely complex (crypto, packet framing, channels, etc.)

**Solution**: Use existing TypeScript SSH client library

```bash
npm install ssh2
```

### SSH Client Wrapper

```typescript
// src/worker/protocols/ssh/client.ts

import { Client, ClientChannel } from 'ssh2';
import { connect as tcpConnect } from 'cloudflare:sockets';

export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export class SSHClient {
  private client: Client;
  private channel: ClientChannel | null = null;
  private socket: Socket;

  constructor(private config: SSHConfig) {
    this.client = new Client();
  }

  async connect(): Promise<void> {
    // Open TCP socket
    this.socket = tcpConnect(`${this.config.host}:${this.config.port}`);
    await this.socket.opened;

    return new Promise((resolve, reject) => {
      this.client.on('ready', () => resolve());
      this.client.on('error', reject);

      // Connect SSH over the TCP socket
      this.client.connect({
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        password: this.config.password,
        privateKey: this.config.privateKey,
        passphrase: this.config.passphrase,
        sock: this.socket, // Use our TCP socket
      });
    });
  }

  async openShell(): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      this.client.shell((err, channel) => {
        if (err) return reject(err);
        this.channel = channel;
        resolve(channel);
      });
    });
  }

  async exec(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
      this.client.exec(command, (err, channel) => {
        if (err) return reject(err);

        let stdout = '';
        let stderr = '';

        channel.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        channel.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        channel.on('close', (code: number) => {
          resolve({ stdout, stderr, code });
        });
      });
    });
  }

  async close(): Promise<void> {
    this.client.end();
    await this.socket.close();
  }
}
```

### WebSocket Terminal Tunnel

```typescript
// src/worker/protocols/ssh/tunnel.ts

export async function sshTunnel(
  request: Request,
  config: SSHConfig
): Promise<Response> {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();

  (async () => {
    try {
      const ssh = new SSHClient(config);
      await ssh.connect();

      server.send(JSON.stringify({ type: 'connected' }));

      const channel = await ssh.openShell();

      // Terminal → SSH
      server.addEventListener('message', (event) => {
        if (typeof event.data === 'string') {
          const msg = JSON.parse(event.data);

          if (msg.type === 'input') {
            channel.write(msg.data);
          } else if (msg.type === 'resize') {
            channel.setWindow(msg.rows, msg.cols, msg.height, msg.width);
          }
        }
      });

      // SSH → Terminal
      channel.on('data', (data: Buffer) => {
        server.send(JSON.stringify({
          type: 'output',
          data: data.toString('utf-8'),
        }));
      });

      channel.stderr.on('data', (data: Buffer) => {
        server.send(JSON.stringify({
          type: 'output',
          data: data.toString('utf-8'),
        }));
      });

      channel.on('close', () => {
        server.send(JSON.stringify({ type: 'closed' }));
        server.close();
      });

      server.addEventListener('close', () => {
        ssh.close();
      });

    } catch (error) {
      server.send(JSON.stringify({
        type: 'error',
        error: error instanceof Error ? error.message : 'Connection failed',
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

### API Endpoints

```typescript
// Add to src/worker/index.ts

// Quick SSH command execution
if (url.pathname === '/api/ssh/exec' && request.method === 'POST') {
  const { host, port, username, password, command } = await request.json();

  const ssh = new SSHClient({ host, port, username, password });
  await ssh.connect();

  const result = await ssh.exec(command);
  await ssh.close();

  return Response.json(result);
}

// WebSocket terminal
if (url.pathname === '/api/ssh/connect') {
  const config = await request.json();
  return sshTunnel(request, config);
}
```

## Web UI Design

### Terminal Component

Use **xterm.js** for terminal emulation:

```bash
npm install xterm xterm-addon-fit xterm-addon-web-links
```

```typescript
// src/components/SSHTerminal.tsx

import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';

export interface SSHCredentials {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
}

export function SSHTerminal() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  // Credentials form state
  const [host, setHost] = useState('');
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!terminalRef.current) return;

    // Create terminal
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(terminalRef.current);
    fitAddon.fit();

    setTerminal(term);

    // Handle window resize
    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  }, []);

  const connect = async () => {
    if (!terminal) return;

    const socket = new WebSocket('/api/ssh/connect');

    socket.onopen = () => {
      // Send credentials
      socket.send(JSON.stringify({
        host,
        port,
        username,
        password,
      }));
    };

    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === 'connected') {
        setConnected(true);
        terminal.write('\r\n✓ Connected to SSH server\r\n\r\n');
      } else if (msg.type === 'output') {
        terminal.write(msg.data);
      } else if (msg.type === 'error') {
        terminal.write(`\r\n✗ Error: ${msg.error}\r\n`);
      } else if (msg.type === 'closed') {
        terminal.write('\r\n[Connection closed]\r\n');
        setConnected(false);
      }
    };

    socket.onclose = () => {
      setConnected(false);
    };

    // Send input to SSH
    terminal.onData((data) => {
      if (connected) {
        socket.send(JSON.stringify({
          type: 'input',
          data,
        }));
      }
    });

    // Send resize events
    terminal.onResize(({ cols, rows }) => {
      socket.send(JSON.stringify({
        type: 'resize',
        cols,
        rows,
      }));
    });

    setWs(socket);
  };

  const disconnect = () => {
    if (ws) {
      ws.close();
      setWs(null);
    }
  };

  return (
    <div className="ssh-terminal">
      {!connected ? (
        <div className="ssh-login">
          <h2>SSH Connection</h2>
          <form onSubmit={(e) => { e.preventDefault(); connect(); }}>
            <input
              type="text"
              placeholder="Host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              required
            />
            <input
              type="number"
              placeholder="Port"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              required
            />
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button type="submit">Connect</button>
          </form>
        </div>
      ) : (
        <div className="terminal-container">
          <div className="terminal-header">
            <span>
              {username}@{host}:{port}
            </span>
            <button onClick={disconnect}>Disconnect</button>
          </div>
          <div ref={terminalRef} className="terminal" />
        </div>
      )}
    </div>
  );
}
```

### Connection Manager

```typescript
// src/components/SSHConnectionManager.tsx

interface SavedConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
}

export function SSHConnectionManager() {
  const [connections, setConnections] = useState<SavedConnection[]>([]);

  useEffect(() => {
    // Load from localStorage
    const saved = localStorage.getItem('ssh-connections');
    if (saved) {
      setConnections(JSON.parse(saved));
    }
  }, []);

  const saveConnection = (conn: Omit<SavedConnection, 'id'>) => {
    const newConn = { ...conn, id: crypto.randomUUID() };
    const updated = [...connections, newConn];
    setConnections(updated);
    localStorage.setItem('ssh-connections', JSON.stringify(updated));
  };

  const deleteConnection = (id: string) => {
    const updated = connections.filter(c => c.id !== id);
    setConnections(updated);
    localStorage.setItem('ssh-connections', JSON.stringify(updated));
  };

  return (
    <div className="connection-manager">
      <h3>Saved Connections</h3>
      <ul>
        {connections.map(conn => (
          <li key={conn.id}>
            <span>{conn.name} ({conn.username}@{conn.host})</span>
            <button onClick={() => deleteConnection(conn.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

## Data Flow

```
┌─────────┐         ┌──────────┐         ┌──────────┐
│ xterm.js│         │  Worker  │         │SSH Server│
│ Browser │         │          │         │          │
└────┬────┘         └────┬─────┘         └────┬─────┘
     │                   │                     │
     │ WS: Connect + creds                     │
     ├──────────────────>│                     │
     │                   │ TCP Connect :22     │
     │                   ├────────────────────>│
     │                   │ SSH Protocol Version│
     │                   │<───────────────────>│
     │                   │ Key Exchange        │
     │                   │<───────────────────>│
     │                   │ Auth (password)     │
     │                   │<───────────────────>│
     │                   │ Open Channel (PTY)  │
     │                   │<───────────────────>│
     │ {type: "connected"}│                    │
     │<──────────────────┤                     │
     │                   │                     │
     │ {type: "input", data: "ls\n"}          │
     ├──────────────────>│ Encrypted data      │
     │                   ├────────────────────>│
     │                   │ Encrypted response  │
     │                   │<────────────────────┤
     │ {type: "output", data: "file1\nfile2"} │
     │<──────────────────┤                     │
     │                   │                     │
```

## Security

### Credential Handling

**NEVER** store passwords in Worker or browser:

```typescript
// ✗ BAD: Don't store passwords
localStorage.setItem('password', password);

// ✓ GOOD: Only keep during session
const [password, setPassword] = useState('');
// Password only lives in memory during connection
```

### Host Key Verification

```typescript
client.on('hostkey', (key, verify) => {
  // Store known hosts in KV or Durable Object
  const knownHost = await env.KV.get(`ssh:hostkey:${host}`);

  if (!knownHost) {
    // First connection - prompt user
    server.send(JSON.stringify({
      type: 'hostkey-unknown',
      fingerprint: key.toString('base64'),
    }));
    // Wait for user confirmation
  } else if (knownHost !== key.toString('base64')) {
    // Host key changed - MITM attack?
    throw new Error('Host key verification failed');
  }

  verify(); // Accept key
});
```

### Rate Limiting

```typescript
// Limit SSH connection attempts per IP
const SSH_RATE_LIMIT = 5; // per minute
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
```

### Allowlists

```typescript
// Only allow connections to specific hosts
const ALLOWED_SSH_HOSTS = [
  'myserver.com',
  '*.example.com',
  '10.0.1.*',
];
```

## Testing

### Test Server

Set up test SSH server:

```bash
# Using Docker
docker run -d \
  -p 2222:22 \
  -e SUDO_ACCESS=true \
  -e USER_NAME=testuser \
  -e USER_PASSWORD=testpass \
  linuxserver/openssh-server
```

### Unit Tests

```typescript
// tests/ssh.test.ts

describe('SSH Client', () => {
  it('should connect and authenticate', async () => {
    const ssh = new SSHClient({
      host: 'localhost',
      port: 2222,
      username: 'testuser',
      password: 'testpass',
    });

    await ssh.connect();
    await ssh.close();
  });

  it('should execute command', async () => {
    const ssh = new SSHClient({ /* ... */ });
    await ssh.connect();

    const result = await ssh.exec('echo "Hello"');

    expect(result.stdout).toBe('Hello\n');
    expect(result.code).toBe(0);

    await ssh.close();
  });
});
```

## Challenges & Solutions

### Challenge 1: Large Dependencies

**Problem**: `ssh2` library is large (~500KB)

**Solution**:
- Use code splitting
- Lazy load SSH component
- Consider WebAssembly SSH implementation

### Challenge 2: Terminal Encoding

**Problem**: Unicode, colors, control sequences

**Solution**: Use xterm.js - it handles everything

### Challenge 3: Key-Based Auth

**Problem**: Users want to use SSH keys, not passwords

**Solution**:
- Accept PEM-encoded private keys in UI
- Parse with `ssh2` library
- Never store keys - only session memory

### Challenge 4: Connection Persistence

**Problem**: WebSocket disconnect kills SSH session

**Solution**:
- Use Durable Objects to persist SSH session
- WebSocket reconnection resumes session

## Resources

- **SSH2 Library**: [mscdex/ssh2](https://github.com/mscdex/ssh2)
- **xterm.js**: [xtermjs/xterm.js](https://github.com/xtermjs/xterm.js)
- **SSH RFCs**: [RFC 4250-4254](https://tools.ietf.org/html/rfc4250)
- **Example**: [webssh](https://github.com/huashengdun/webssh)

## Next Steps

1. Set up ssh2 and xterm.js dependencies
2. Implement basic password auth connection
3. Add public key authentication
4. Build connection manager UI
5. Implement host key verification
6. Add session persistence with Durable Objects
7. Support SFTP file browser (separate protocol plan)

## Notes

- SSH is the **most complex** protocol but also **highest value**
- Consider building simpler protocols (Echo, Telnet, Redis) first
- Terminal emulation is handled by xterm.js
- SSH crypto is handled by ssh2 library
- Focus on Worker integration and WebSocket tunneling
