# Telnet Protocol Implementation Plan

## Overview

**Protocol:** Telnet
**Port:** 23
**RFC:** [RFC 854](https://tools.ietf.org/html/rfc854)
**Complexity:** Low-Medium
**Purpose:** Remote terminal access (unencrypted)

Telnet is SSH's **unencrypted predecessor**. While insecure for production use, it's valuable for educational purposes, legacy systems, and local network administration.

### Use Cases
- Legacy system access (routers, switches)
- Educational - learn terminal protocols
- Local network administration
- Serial console connections
- Retro computing
- MUD/MOO games (still active!)

## Protocol Specification

### Basic Operation

```
Client connects → Server sends WILL/WONT/DO/DONT options → Data exchange
```

### Command Structure

Every command starts with IAC (Interpret As Command) = 255 (0xFF):

| Code | Name | Description |
|------|------|-------------|
| 255 | IAC | Interpret as command |
| 251 | WILL | Offer to enable option |
| 252 | WONT | Refuse to enable option |
| 253 | DO | Request other side enable |
| 254 | DONT | Request other side disable |
| 250 | SB | Subnegotiation begin |
| 240 | SE | Subnegotiation end |

### Telnet Options

| Option | Code | Purpose |
|--------|------|---------|
| ECHO | 1 | Server echoes characters |
| SUPPRESS GO AHEAD | 3 | Full-duplex mode |
| TERMINAL TYPE | 24 | Terminal identification |
| WINDOW SIZE | 31 | Terminal dimensions |

### Example Session

```
Server → Client: IAC WILL ECHO (255 251 1)
Server → Client: IAC WILL SUPPRESS_GO_AHEAD (255 251 3)

Client → Server: IAC DO ECHO (255 253 1)
Client → Server: IAC DO SUPPRESS_GO_AHEAD (255 253 3)

Server → Client: login:
Client → Server: alice\r\n
Server → Client: Password:
Client → Server: secret\r\n

[Normal data exchange]
```

## Worker Implementation

### Telnet Client

```typescript
// src/worker/protocols/telnet/client.ts

import { connect } from 'cloudflare:sockets';

// Telnet commands
const IAC = 255;   // Interpret As Command
const WILL = 251;  // I will use option
const WONT = 252;  // I won't use option
const DO = 253;    // Please use option
const DONT = 254;  // Don't use option
const SB = 250;    // Subnegotiation begin
const SE = 240;    // Subnegotiation end

// Telnet options
const OPT_ECHO = 1;
const OPT_SUPPRESS_GO_AHEAD = 3;
const OPT_TERMINAL_TYPE = 24;
const OPT_WINDOW_SIZE = 31;

export interface TelnetConfig {
  host: string;
  port: number;
  terminalType?: string;
  rows?: number;
  cols?: number;
}

export class TelnetClient {
  private socket: Socket;
  private buffer: Uint8Array = new Uint8Array(0);

  constructor(private config: TelnetConfig) {}

  async connect(): Promise<void> {
    this.socket = connect(`${this.config.host}:${this.config.port}`);
    await this.socket.opened;

    // Start reading
    this.readData();
  }

  private async readData(): Promise<void> {
    const reader = this.socket.readable.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Append to buffer
        const newBuffer = new Uint8Array(this.buffer.length + value.length);
        newBuffer.set(this.buffer);
        newBuffer.set(value, this.buffer.length);
        this.buffer = newBuffer;

        // Process telnet commands
        this.processBuffer();
      }
    } catch (error) {
      console.error('Telnet read error:', error);
    }
  }

  private processBuffer(): void {
    let i = 0;

    while (i < this.buffer.length) {
      if (this.buffer[i] === IAC) {
        if (i + 1 >= this.buffer.length) break; // Need more data

        const command = this.buffer[i + 1];

        if (command === IAC) {
          // Escaped IAC (255 255 = literal 255)
          i += 2;
          continue;
        }

        if (command === WILL || command === WONT || command === DO || command === DONT) {
          if (i + 2 >= this.buffer.length) break; // Need more data

          const option = this.buffer[i + 2];
          this.handleCommand(command, option);

          // Remove from buffer
          this.buffer = new Uint8Array([
            ...this.buffer.slice(0, i),
            ...this.buffer.slice(i + 3)
          ]);
          continue;
        }

        if (command === SB) {
          // Subnegotiation
          const seIndex = this.findSubnegEnd(i);
          if (seIndex === -1) break; // Need more data

          const subData = this.buffer.slice(i + 3, seIndex);
          this.handleSubnegotiation(this.buffer[i + 2], subData);

          this.buffer = new Uint8Array([
            ...this.buffer.slice(0, i),
            ...this.buffer.slice(seIndex + 2)
          ]);
          continue;
        }
      }

      i++;
    }
  }

  private findSubnegEnd(start: number): number {
    for (let i = start + 2; i < this.buffer.length - 1; i++) {
      if (this.buffer[i] === IAC && this.buffer[i + 1] === SE) {
        return i;
      }
    }
    return -1;
  }

  private handleCommand(command: number, option: number): void {
    switch (command) {
      case WILL:
        // Server will use option
        if (option === OPT_ECHO || option === OPT_SUPPRESS_GO_AHEAD) {
          this.send(new Uint8Array([IAC, DO, option]));
        } else {
          this.send(new Uint8Array([IAC, DONT, option]));
        }
        break;

      case DO:
        // Server wants us to use option
        if (option === OPT_TERMINAL_TYPE || option === OPT_WINDOW_SIZE) {
          this.send(new Uint8Array([IAC, WILL, option]));
        } else {
          this.send(new Uint8Array([IAC, WONT, option]));
        }
        break;

      case WONT:
      case DONT:
        // Acknowledgment
        break;
    }
  }

  private handleSubnegotiation(option: number, data: Uint8Array): void {
    if (option === OPT_TERMINAL_TYPE && data[0] === 1) {
      // Server requesting terminal type (SEND command)
      const termType = this.config.terminalType || 'xterm-256color';
      const response = new TextEncoder().encode(termType);

      this.send(new Uint8Array([
        IAC, SB, OPT_TERMINAL_TYPE, 0, // IS command
        ...response,
        IAC, SE
      ]));
    }
  }

  async send(data: Uint8Array | string): Promise<void> {
    const writer = this.socket.writable.getWriter();

    if (typeof data === 'string') {
      const encoder = new TextEncoder();
      await writer.write(encoder.encode(data));
    } else {
      await writer.write(data);
    }

    writer.releaseLock();
  }

  async sendWindowSize(rows: number, cols: number): Promise<void> {
    await this.send(new Uint8Array([
      IAC, SB, OPT_WINDOW_SIZE,
      (cols >> 8) & 0xff, cols & 0xff,
      (rows >> 8) & 0xff, rows & 0xff,
      IAC, SE
    ]));
  }

  getData(): Uint8Array {
    const data = this.buffer;
    this.buffer = new Uint8Array(0);
    return data;
  }

  async close(): Promise<void> {
    await this.socket.close();
  }
}
```

### WebSocket Tunnel

```typescript
// src/worker/protocols/telnet/tunnel.ts

export async function telnetTunnel(
  request: Request,
  config: TelnetConfig
): Promise<Response> {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();

  (async () => {
    try {
      const telnet = new TelnetClient(config);
      await telnet.connect();

      server.send(JSON.stringify({ type: 'connected' }));

      // Browser → Telnet
      server.addEventListener('message', async (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === 'input') {
          await telnet.send(msg.data);
        } else if (msg.type === 'resize') {
          await telnet.sendWindowSize(msg.rows, msg.cols);
        }
      });

      // Telnet → Browser (poll for data)
      const interval = setInterval(() => {
        const data = telnet.getData();
        if (data.length > 0) {
          const decoder = new TextDecoder();
          server.send(JSON.stringify({
            type: 'output',
            data: decoder.decode(data),
          }));
        }
      }, 50);

      server.addEventListener('close', () => {
        clearInterval(interval);
        telnet.close();
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

## Web UI Design

### Terminal Component

Reuse xterm.js from SSH implementation:

```typescript
// src/components/TelnetTerminal.tsx

import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';

export function TelnetTerminal() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [connected, setConnected] = useState(false);

  const [host, setHost] = useState('');
  const [port, setPort] = useState(23);

  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      theme: {
        background: '#000',
        foreground: '#0f0', // Classic green terminal
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    setTerminal(term);

    return () => term.dispose();
  }, []);

  const connect = () => {
    if (!terminal) return;

    ws.current = new WebSocket('/api/telnet/connect');

    ws.current.onopen = () => {
      ws.current?.send(JSON.stringify({
        host,
        port,
        terminalType: 'xterm-256color',
        rows: terminal.rows,
        cols: terminal.cols,
      }));
    };

    ws.current.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === 'connected') {
        setConnected(true);
      } else if (msg.type === 'output') {
        terminal.write(msg.data);
      }
    };

    ws.current.onclose = () => {
      setConnected(false);
    };

    // Send input
    terminal.onData((data) => {
      ws.current?.send(JSON.stringify({
        type: 'input',
        data,
      }));
    });

    // Send resize
    terminal.onResize(({ cols, rows }) => {
      ws.current?.send(JSON.stringify({
        type: 'resize',
        cols,
        rows,
      }));
    });
  };

  return (
    <div className="telnet-terminal">
      {!connected ? (
        <div className="connection-form">
          <h2>Telnet Connection</h2>
          <div className="warning">
            ⚠️ Warning: Telnet is unencrypted. Use only on trusted networks.
          </div>
          <input
            type="text"
            placeholder="Host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
          <input
            type="number"
            placeholder="Port"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
          />
          <button onClick={connect}>Connect</button>
        </div>
      ) : (
        <div className="terminal-container">
          <div className="terminal-header">
            Telnet: {host}:{port}
          </div>
          <div ref={terminalRef} className="terminal" />
        </div>
      )}
    </div>
  );
}
```

## Security

### Warning Banner

```typescript
// Always show security warning
<div className="security-warning">
  <strong>⚠️ Security Notice</strong>
  <p>
    Telnet transmits ALL data (including passwords) in plaintext.
    Only use on trusted networks or for educational purposes.
  </p>
</div>
```

### Network Restrictions

```typescript
// Block internet telnet by default
const ALLOWED_TELNET_NETWORKS = [
  '192.168.', // Local network
  '10.',      // Private network
  '172.16.',  // Private network (through 172.31.x.x)
];

function isTelnetAllowed(host: string): boolean {
  // Only allow local/private networks
  return ALLOWED_TELNET_NETWORKS.some(prefix => host.startsWith(prefix));
}
```

## Testing

### Test Server

```bash
# Simple telnet server (Python)
python -m telnetlib

# Or use Docker
docker run -d -p 2323:23 \
  -e TELNET_USERNAME=testuser \
  -e TELNET_PASSWORD=testpass \
  ghcr.io/linuxserver/telnet-server
```

### Test Telnet Manually

```bash
# Connect with telnet client
telnet localhost 23

# Or netcat
nc localhost 23
```

## Resources

- **RFC 854**: [Telnet Protocol](https://tools.ietf.org/html/rfc854)
- **RFC 855**: [Telnet Option Specification](https://tools.ietf.org/html/rfc855)
- **Telnet Options**: [IANA Registry](https://www.iana.org/assignments/telnet-options/)

## Next Steps

1. Implement IAC command parsing
2. Handle WILL/WONT/DO/DONT negotiation
3. Support terminal type and window size
4. Build UI with security warnings
5. Add option to save connection profiles
6. Consider read-only "view" mode

## Notes

- Telnet is **educational** - useful for learning terminal protocols before SSH
- Good stepping stone to SSH implementation
- Still used for **legacy systems** (network equipment, industrial systems)
- Some **MUD/MOO games** still use Telnet
- Consider implementing SSH first if you need secure terminal access
