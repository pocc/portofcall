# Character Generator Protocol Implementation Plan

## Overview

**Protocol:** Character Generator (CHARGEN)
**Port:** 19 (TCP and UDP)
**RFC:** [RFC 864](https://tools.ietf.org/html/rfc864)
**Complexity:** Trivial
**Purpose:** Network testing and debugging

CHARGEN provides **continuous character stream** - sends an endless stream of ASCII characters for testing network connections, bandwidth, and data handling.

### Use Cases
- Network testing and debugging
- Bandwidth testing
- Buffer overflow testing
- Educational protocol demonstration
- TCP connection testing
- Data stream testing

## Protocol Specification

### Protocol Description

The Character Generator protocol is **extremely simple**:

**TCP Version:**
```
Client connects to server on port 19
Server sends continuous stream of ASCII characters
Server never stops (until client disconnects)
```

**UDP Version:**
```
Client sends datagram to server on port 19
Server responds with one datagram of random length (0-512 bytes)
Connection closes
```

### Character Pattern

The standard pattern is a **rotating 72-character line**:

```
!"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefgh
"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghi
#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghij
...continues rotating...
```

Each line is 72 printable ASCII characters (ASCII 33-126) followed by `\r\n`.

### ASCII Character Set

```
Printable ASCII: 33 (!) to 126 (~)
Total: 94 characters
Pattern shifts by 1 character each line
Line length: 72 characters + \r\n = 74 bytes
```

## Worker Implementation

```typescript
// src/worker/protocols/chargen/client.ts

import { connect } from 'cloudflare:sockets';

export interface ChargenConfig {
  host: string;
  port?: number;
  maxBytes?: number; // Limit for safety
}

export class ChargenClient {
  private socket: any;
  private bytesReceived: number = 0;

  constructor(private config: ChargenConfig) {}

  async *stream(): AsyncGenerator<Uint8Array> {
    const port = this.config.port || 19;
    this.socket = connect(`${this.config.host}:${port}`);
    await this.socket.opened;

    const reader = this.socket.readable.getReader();
    const maxBytes = this.config.maxBytes || 1024 * 1024; // 1MB default limit

    try {
      while (this.bytesReceived < maxBytes) {
        const { value, done } = await reader.read();

        if (done) break;

        this.bytesReceived += value.length;
        yield value;

        if (this.bytesReceived >= maxBytes) {
          break;
        }
      }
    } finally {
      reader.releaseLock();
      await this.socket.close();
    }
  }

  async receive(maxBytes: number = 1024): Promise<string> {
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    for await (const chunk of this.stream()) {
      chunks.push(chunk);
      totalBytes += chunk.length;

      if (totalBytes >= maxBytes) {
        break;
      }
    }

    // Combine chunks
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    return new TextDecoder().decode(combined);
  }

  getBytesReceived(): number {
    return this.bytesReceived;
  }

  async close(): Promise<void> {
    if (this.socket) {
      await this.socket.close();
    }
  }
}

// CHARGEN Server

export class ChargenServer {
  private readonly PRINTABLE_START = 33; // '!'
  private readonly PRINTABLE_END = 126;   // '~'
  private readonly LINE_LENGTH = 72;

  constructor(private port: number = 19) {}

  private generateLine(offset: number): string {
    const chars: string[] = [];

    for (let i = 0; i < this.LINE_LENGTH; i++) {
      const charCode = this.PRINTABLE_START + ((offset + i) % 94);
      chars.push(String.fromCharCode(charCode));
    }

    return chars.join('') + '\r\n';
  }

  async *generate(): AsyncGenerator<string> {
    let lineOffset = 0;

    while (true) {
      yield this.generateLine(lineOffset);
      lineOffset = (lineOffset + 1) % 94;
    }
  }

  private handleConnection(socket: any): void {
    const writer = socket.writable.getWriter();
    const encoder = new TextEncoder();
    let lineOffset = 0;

    const sendLoop = async () => {
      try {
        while (true) {
          const line = this.generateLine(lineOffset);
          await writer.write(encoder.encode(line));
          lineOffset = (lineOffset + 1) % 94;

          // Small delay to avoid overwhelming client
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      } catch (error) {
        // Client disconnected
      } finally {
        writer.releaseLock();
        await socket.close();
      }
    };

    sendLoop();
  }

  // For testing/demo purposes
  generatePattern(lines: number = 10): string {
    const result: string[] = [];

    for (let i = 0; i < lines; i++) {
      result.push(this.generateLine(i));
    }

    return result.join('');
  }
}

// Utility Functions

export function parseChargenStream(data: string): {
  lines: number;
  bytes: number;
  valid: boolean;
} {
  const lines = data.split('\r\n').filter(line => line.length > 0);
  const bytes = data.length;

  // Validate pattern
  let valid = true;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length !== 72) {
      valid = false;
      break;
    }
  }

  return { lines: lines.length, bytes, valid };
}

export function calculateBandwidth(bytes: number, durationMs: number): string {
  const bps = (bytes * 8) / (durationMs / 1000);

  if (bps < 1024) {
    return `${bps.toFixed(2)} bps`;
  } else if (bps < 1024 * 1024) {
    return `${(bps / 1024).toFixed(2)} Kbps`;
  } else {
    return `${(bps / (1024 * 1024)).toFixed(2)} Mbps`;
  }
}
```

## Web UI Design

```typescript
// src/components/ChargenClient.tsx

export function ChargenClient() {
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState(19);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string>('');
  const [stats, setStats] = useState({
    bytes: 0,
    lines: 0,
    duration: 0,
    bandwidth: '0 bps',
  });
  const [maxBytes, setMaxBytes] = useState(10240); // 10KB default

  const start = async () => {
    setRunning(true);
    setOutput('');
    setStats({ bytes: 0, lines: 0, duration: 0, bandwidth: '0 bps' });

    const startTime = Date.now();

    try {
      const response = await fetch('/api/chargen/stream', {
        method: 'POST',
        body: JSON.stringify({ host, port, maxBytes }),
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let totalBytes = 0;
      let lines = 0;

      if (!reader) return;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        totalBytes += value.length;
        lines += text.split('\r\n').length - 1;

        setOutput(prev => (prev + text).slice(-5000)); // Keep last 5KB

        const duration = Date.now() - startTime;
        const bandwidth = calculateBandwidth(totalBytes, duration);

        setStats({
          bytes: totalBytes,
          lines,
          duration,
          bandwidth,
        });
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setRunning(false);
    }
  };

  const stop = () => {
    setRunning(false);
  };

  const calculateBandwidth = (bytes: number, durationMs: number): string => {
    const bps = (bytes * 8) / (durationMs / 1000);

    if (bps < 1024) {
      return `${bps.toFixed(2)} bps`;
    } else if (bps < 1024 * 1024) {
      return `${(bps / 1024).toFixed(2)} Kbps`;
    } else {
      return `${(bps / (1024 * 1024)).toFixed(2)} Mbps`;
    }
  };

  return (
    <div className="chargen-client">
      <h2>Character Generator (CHARGEN)</h2>

      <div className="config">
        <input
          type="text"
          placeholder="CHARGEN Server Host"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          disabled={running}
        />
        <input
          type="number"
          placeholder="Port"
          value={port}
          onChange={(e) => setPort(Number(e.target.value))}
          disabled={running}
        />
        <input
          type="number"
          placeholder="Max Bytes"
          value={maxBytes}
          onChange={(e) => setMaxBytes(Number(e.target.value))}
          disabled={running}
        />
        {!running ? (
          <button onClick={start}>Start Stream</button>
        ) : (
          <button onClick={stop}>Stop</button>
        )}
      </div>

      <div className="stats">
        <h3>Statistics</h3>
        <div className="stat-grid">
          <div>
            <strong>Bytes Received:</strong> {stats.bytes.toLocaleString()}
          </div>
          <div>
            <strong>Lines:</strong> {stats.lines.toLocaleString()}
          </div>
          <div>
            <strong>Duration:</strong> {(stats.duration / 1000).toFixed(2)}s
          </div>
          <div>
            <strong>Bandwidth:</strong> {stats.bandwidth}
          </div>
        </div>
      </div>

      <div className="output">
        <h3>Character Stream</h3>
        <pre className="chargen-stream">{output}</pre>
      </div>

      <div className="info">
        <h3>About CHARGEN</h3>
        <ul>
          <li>RFC 864 (1983) - Character Generator Protocol</li>
          <li>Sends continuous stream of ASCII characters</li>
          <li>72-character rotating pattern per line</li>
          <li>Used for network testing and debugging</li>
          <li>⚠️ Can be used for amplification attacks (often disabled)</li>
          <li>Largely obsolete - use for education only</li>
        </ul>
      </div>

      <div className="pattern-example">
        <h3>Standard Pattern (First 5 lines)</h3>
        <pre>
{`!"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_\`abcdefgh
"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_\`abcdefghi
#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_\`abcdefghij
$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_\`abcdefghijk
%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_\`abcdefghijkl`}
        </pre>
      </div>
    </div>
  );
}
```

## Security

### No Security

CHARGEN has **no security features**:
- No authentication
- No encryption
- Plaintext transmission
- **Amplification attack vector** - small UDP request → large response

### Security Concerns

```bash
# CHARGEN has been abused for DDoS amplification attacks
# Most modern systems disable it by default
# Port 19 is often filtered by firewalls
```

**DO NOT expose CHARGEN servers to the public internet.**

## Testing

### Netcat Test

```bash
# Test CHARGEN server (TCP)
nc chargen.example.com 19

# Should start outputting characters immediately:
# !"#$%&'()*+,-./0123456789...
# (continuous stream until you disconnect)

# Limit with head
nc chargen.example.com 19 | head -n 10
```

### Simple Server

```bash
# Create CHARGEN server with Python
python3 << 'EOF'
import socket
import time

def generate_line(offset):
    chars = []
    for i in range(72):
        char_code = 33 + ((offset + i) % 94)
        chars.append(chr(char_code))
    return ''.join(chars) + '\r\n'

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.bind(('0.0.0.0', 19))
sock.listen(1)

print("CHARGEN server listening on port 19")

while True:
    conn, addr = sock.accept()
    print(f"Connection from {addr}")

    offset = 0
    try:
        while True:
            line = generate_line(offset)
            conn.send(line.encode('ascii'))
            offset = (offset + 1) % 94
            time.sleep(0.01)
    except:
        pass
    finally:
        conn.close()
EOF
```

### Docker Test Server

```bash
# Simple CHARGEN server
docker run -d \
  -p 19:19 \
  --name chargen \
  alpine sh -c 'apk add socat && socat TCP-LISTEN:19,reuseaddr,fork SYSTEM:"while true; do cat /dev/urandom | tr -dc \"[:print:]\" | fold -w 72; done"'

# Test
nc localhost 19 | head -n 10
```

### Bandwidth Testing

```bash
# Test bandwidth (receive 1MB)
time nc chargen.example.com 19 | head -c 1048576 > /dev/null

# Measure throughput
pv -r < <(nc chargen.example.com 19) | head -c 10485760 > /dev/null
```

## Resources

- **RFC 864**: [Character Generator Protocol](https://tools.ietf.org/html/rfc864)
- **IANA Port 19**: [Service Registry](https://www.iana.org/assignments/service-names-port-numbers/)
- **Security Note**: [CHARGEN Amplification Attacks](https://www.us-cert.gov/ncas/alerts/TA14-017A)

## Comparison with Other Test Protocols

| Protocol | Port | Function | Status |
|----------|------|----------|--------|
| ECHO | 7 | Echo back input | Obsolete |
| DISCARD | 9 | Discard all input | Obsolete |
| CHARGEN | 19 | Generate characters | Obsolete |
| TIME | 37 | Send time | Obsolete |
| DAYTIME | 13 | Send time (text) | Obsolete |

## Example Outputs

### First 10 Lines

```
!"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefgh
"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghi
#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghij
$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijk
%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijkl
&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklm
'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklmn
()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklmno
)*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklmnop
*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklmnopq
```

### Pattern Cycle

After 94 lines, the pattern repeats (all 94 printable ASCII characters used as offsets).

## Notes

- **Simplest streaming protocol** - no commands, just connect and receive
- **Educational value** - demonstrates TCP streaming
- **Bandwidth testing** - measure network throughput
- **Buffer testing** - test application buffer handling
- **Line format**: 72 characters + `\r\n` = 74 bytes per line
- **Character set**: ASCII 33-126 (94 printable characters)
- **Pattern**: Rotates by 1 character per line
- **TCP version**: Infinite stream (until disconnect)
- **UDP version**: Single random-length datagram
- **Security risk**: Amplification attack vector
- **Status**: Disabled by default on modern systems
- **Port 19** often blocked by firewalls
- One of the **original Internet protocols** (1983)
- **No practical use today** except education and testing
