# Daytime Protocol Implementation Plan

## Overview

**Protocol:** Daytime Protocol
**Port:** 13 (TCP and UDP)
**RFC:** [RFC 867](https://tools.ietf.org/html/rfc867)
**Complexity:** Extremely Low
**Purpose:** Time synchronization (human-readable)

Daytime provides **human-readable time** - the simplest possible network protocol for getting the current date and time from a remote server.

### Use Cases
- Educational protocol demonstration
- Simple time synchronization
- Network connectivity testing
- Legacy system integration
- Learning TCP/IP basics

## Protocol Specification

### Protocol Description

The Daytime protocol is **the simplest network protocol**:

```
Client connects to server on port 13
Server immediately sends current date/time as ASCII text
Server closes connection
```

That's it! No commands, no responses, just connect and receive.

### Example Response

```
Sunday, January 15, 2024 14:30:45-PST
```

or

```
2024-01-15 14:30:45
```

**Format is not standardized** - each server can format differently.

### TCP Version

```
Client → Server: [TCP Connection]
Server → Client: "Sunday, January 15, 2024 14:30:45-PST\r\n"
Server → Client: [Close connection]
```

### UDP Version

```
Client → Server: [Empty UDP packet]
Server → Client: "Sunday, January 15, 2024 14:30:45-PST"
```

## Worker Implementation

```typescript
// src/worker/protocols/daytime/client.ts

import { connect } from 'cloudflare:sockets';

export interface DaytimeConfig {
  host: string;
  port?: number;
}

export class DaytimeClient {
  constructor(private config: DaytimeConfig) {}

  async getTime(): Promise<string> {
    const port = this.config.port || 13;
    const socket = connect(`${this.config.host}:${port}`);
    await socket.opened;

    // Server sends time immediately upon connection
    const reader = socket.readable.getReader();
    const { value } = await reader.read();
    reader.releaseLock();

    await socket.close();

    const time = new TextDecoder().decode(value);
    return time.trim();
  }

  async getTimeAsDate(): Promise<Date> {
    const timeString = await this.getTime();

    // Try to parse the time string
    // Note: Format varies by server
    try {
      return new Date(timeString);
    } catch (error) {
      throw new Error(`Unable to parse time: ${timeString}`);
    }
  }
}

// Daytime Server

export class DaytimeServer {
  private server: any;

  constructor(private port: number = 13) {}

  async start(): Promise<void> {
    // This would require Durable Objects or similar for Workers
    // Simplified example:

    console.log(`Daytime server started on port ${this.port}`);
  }

  private handleConnection(socket: any): void {
    const now = new Date();
    const timeString = now.toString() + '\r\n';

    const writer = socket.writable.getWriter();
    const encoder = new TextEncoder();
    writer.write(encoder.encode(timeString));
    writer.releaseLock();

    socket.close();
  }
}

// Utilities

export function formatDaytime(date: Date = new Date()): string {
  // RFC 867 suggests format like:
  // "Weekday, Month DD, YYYY HH:MM:SS-TIMEZONE"

  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  const weekday = weekdays[date.getDay()];
  const month = months[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  // Get timezone offset
  const offset = -date.getTimezoneOffset();
  const offsetHours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
  const offsetMinutes = String(Math.abs(offset) % 60).padStart(2, '0');
  const offsetSign = offset >= 0 ? '+' : '-';
  const timezone = `${offsetSign}${offsetHours}${offsetMinutes}`;

  return `${weekday}, ${month} ${day}, ${year} ${hours}:${minutes}:${seconds}${timezone}`;
}

export function parseDaytime(timeString: string): Date {
  // Try multiple common formats
  const formats = [
    // "Sunday, January 15, 2024 14:30:45-PST"
    /(\w+),\s+(\w+)\s+(\d+),\s+(\d+)\s+(\d+):(\d+):(\d+)/,
    // "2024-01-15 14:30:45"
    /(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/,
  ];

  // Attempt to parse as Date
  try {
    return new Date(timeString);
  } catch {
    throw new Error(`Unable to parse daytime: ${timeString}`);
  }
}
```

## Web UI Design

```typescript
// src/components/DaytimeClient.tsx

export function DaytimeClient() {
  const [host, setHost] = useState('time.nist.gov');
  const [port, setPort] = useState(13);
  const [time, setTime] = useState<string>('');
  const [localTime, setLocalTime] = useState<string>('');
  const [offset, setOffset] = useState<number>(0);

  const getTime = async () => {
    try {
      const response = await fetch('/api/daytime/get', {
        method: 'POST',
        body: JSON.stringify({ host, port }),
      });

      const data = await response.json();
      setTime(data.time);

      // Calculate offset from local time
      const remoteDate = new Date(data.time);
      const localDate = new Date();
      const diff = remoteDate.getTime() - localDate.getTime();
      setOffset(diff);
      setLocalTime(localDate.toString());
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  };

  const formatOffset = (ms: number): string => {
    const seconds = Math.abs(ms) / 1000;
    const sign = ms >= 0 ? '+' : '-';

    if (seconds < 1) {
      return `${sign}${(seconds * 1000).toFixed(0)}ms`;
    } else {
      return `${sign}${seconds.toFixed(2)}s`;
    }
  };

  return (
    <div className="daytime-client">
      <h2>Daytime Protocol Client</h2>

      <div className="config">
        <input
          type="text"
          placeholder="Daytime Server Host"
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
        <input
          type="number"
          placeholder="Port"
          value={port}
          onChange={(e) => setPort(Number(e.target.value))}
        />
        <button onClick={getTime}>Get Time</button>
      </div>

      {time && (
        <div className="results">
          <div className="time-display">
            <h3>Remote Time</h3>
            <div className="time">{time}</div>
          </div>

          <div className="time-display">
            <h3>Local Time</h3>
            <div className="time">{localTime}</div>
          </div>

          <div className="offset">
            <h3>Time Difference</h3>
            <div className={`offset-value ${offset === 0 ? 'synced' : 'diff'}`}>
              {offset === 0 ? '✓ Synchronized' : formatOffset(offset)}
            </div>
            {offset !== 0 && (
              <p className="note">
                Your clock is {offset > 0 ? 'behind' : 'ahead'} by {formatOffset(offset)}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="public-servers">
        <h3>Public Daytime Servers</h3>
        <ul>
          <li onClick={() => setHost('time.nist.gov')}>time.nist.gov (NIST)</li>
          <li onClick={() => setHost('time-a.nist.gov')}>time-a.nist.gov (NIST A)</li>
          <li onClick={() => setHost('time-b.nist.gov')}>time-b.nist.gov (NIST B)</li>
        </ul>
        <p className="warning">
          ⚠️ Many public time servers have disabled port 13 (Daytime) in favor of NTP.
        </p>
      </div>

      <div className="info">
        <h3>About Daytime Protocol</h3>
        <ul>
          <li>Simplest network protocol (RFC 867, 1983)</li>
          <li>Connect → Receive time → Disconnect</li>
          <li>Human-readable format</li>
          <li>No commands or authentication</li>
          <li>Largely obsolete (replaced by NTP)</li>
        </ul>
      </div>
    </div>
  );
}
```

## Security

### No Security

Daytime protocol has **no security features**:
- No authentication
- No encryption
- Plaintext transmission
- Open to spoofing

**Do not use for critical time synchronization** - use NTP instead.

### Firewall Considerations

```bash
# Many firewalls block port 13
# Often disabled on modern servers
# Consider it deprecated
```

## Testing

### Netcat Test

```bash
# Test daytime server
nc time.nist.gov 13

# Should output something like:
# 60336 24-01-15 22:30:45 50 0 0 895.5 UTC(NIST) *
```

### Simple Server

```bash
# Create a simple daytime server with netcat
while true; do
  echo $(date) | nc -l 13
done
```

### Docker Test Server

```bash
# Simple daytime server
docker run -d \
  -p 13:13 \
  --name daytime \
  alpine sh -c "while true; do echo \$(date) | nc -l -p 13; done"

# Test
nc localhost 13
```

## Resources

- **RFC 867**: [Daytime Protocol](https://tools.ietf.org/html/rfc867)
- **NIST Time Servers**: [time.nist.gov](https://www.nist.gov/pml/time-and-frequency-division/time-distribution/internet-time-service-its)
- **Alternative**: Use [NTP](https://en.wikipedia.org/wiki/Network_Time_Protocol) for accurate time synchronization

## Comparison with Other Time Protocols

| Protocol | Port | Accuracy | Complexity | Status |
|----------|------|----------|------------|--------|
| Daytime | 13 | Seconds | Trivial | Obsolete |
| Time | 37 | Seconds | Very Low | Obsolete |
| NTP | 123 | Microseconds | Medium | Active |
| PTP | - | Nanoseconds | High | Active |

## Example Daytime Responses

### NIST Format
```
60336 24-01-15 22:30:45 50 0 0 895.5 UTC(NIST) *
```

### Standard Format
```
Sunday, January 15, 2024 14:30:45-PST
```

### Simple Format
```
2024-01-15 14:30:45
```

### Unix date Format
```
Sun Jan 15 14:30:45 PST 2024
```

## Notes

- **Simplest possible** network protocol
- **No standardized format** - each server differs
- **Superseded by NTP** for accurate time synchronization
- **Educational value** - perfect for learning TCP/IP
- **Port 13** often filtered by firewalls
- **No bidirectional** communication needed
- One of the **original Internet protocols** (1983)
- Both **TCP and UDP** versions exist
- Server **closes connection immediately** after sending time
