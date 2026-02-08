# Time Protocol Implementation Plan

## Overview

**Protocol:** Time Protocol
**Port:** 37 (TCP and UDP)
**RFC:** [RFC 868](https://tools.ietf.org/html/rfc868)
**Complexity:** Trivial
**Purpose:** Time synchronization (binary)

Time Protocol provides **binary time value** - returns the time as a 32-bit unsigned integer representing seconds since 1900-01-01 00:00:00 UTC.

### Use Cases
- Simple time synchronization
- Network connectivity testing
- Educational protocol demonstration
- Legacy system integration
- Clock drift detection

## Protocol Specification

### Protocol Description

The Time protocol is **extremely simple**:

**TCP Version:**
```
Client connects to server on port 37
Server sends 4-byte time value (network byte order)
Server closes connection
```

**UDP Version:**
```
Client sends empty datagram to server on port 37
Server responds with 4-byte time value
Connection closes
```

### Binary Format

```
32-bit unsigned integer (big-endian / network byte order)
Represents seconds since 1900-01-01 00:00:00 UTC
```

### Time Epoch

```
Unix epoch:  1970-01-01 00:00:00 UTC
Time epoch:  1900-01-01 00:00:00 UTC
Difference:  2,208,988,800 seconds (70 years)
```

### Conversion Formula

```
Time Protocol = Unix Timestamp + 2208988800
Unix Timestamp = Time Protocol - 2208988800
```

### Example

```
Time Protocol value: 3913056000
- 2208988800 (offset)
= 1704067200 (Unix timestamp)
= 2024-01-01 00:00:00 UTC
```

## Worker Implementation

```typescript
// src/worker/protocols/time/client.ts

import { connect } from 'cloudflare:sockets';

export interface TimeConfig {
  host: string;
  port?: number;
}

// Time protocol epoch offset (seconds from 1900 to 1970)
const TIME_OFFSET = 2208988800;

export interface TimeResponse {
  raw: number;           // Raw Time Protocol value
  unixTimestamp: number; // Unix timestamp (seconds)
  date: Date;            // JavaScript Date object
}

export class TimeClient {
  constructor(private config: TimeConfig) {}

  async getTime(): Promise<TimeResponse> {
    const port = this.config.port || 37;
    const socket = connect(`${this.config.host}:${port}`);
    await socket.opened;

    // Server sends 4 bytes immediately
    const reader = socket.readable.getReader();
    const { value } = await reader.read();
    reader.releaseLock();

    await socket.close();

    if (value.length < 4) {
      throw new Error('Invalid response: expected 4 bytes');
    }

    // Parse 32-bit big-endian unsigned integer
    const raw = new DataView(value.buffer).getUint32(0, false);

    // Convert to Unix timestamp
    const unixTimestamp = raw - TIME_OFFSET;

    // Convert to Date
    const date = new Date(unixTimestamp * 1000);

    return { raw, unixTimestamp, date };
  }

  async getTimeAsDate(): Promise<Date> {
    const response = await this.getTime();
    return response.date;
  }

  async getUnixTimestamp(): Promise<number> {
    const response = await this.getTime();
    return response.unixTimestamp;
  }

  async getOffset(): Promise<number> {
    const response = await this.getTime();
    const localTime = Math.floor(Date.now() / 1000);
    return response.unixTimestamp - localTime;
  }
}

// Time Server

export class TimeServer {
  constructor(private port: number = 37) {}

  async start(): Promise<void> {
    // This would require Durable Objects or similar for Workers
    console.log(`Time server started on port ${this.port}`);
  }

  private handleConnection(socket: any): void {
    const now = Date.now();
    const unixSeconds = Math.floor(now / 1000);
    const timeValue = unixSeconds + TIME_OFFSET;

    // Send 4-byte time value
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setUint32(0, timeValue, false); // Big-endian

    const writer = socket.writable.getWriter();
    writer.write(new Uint8Array(buffer));
    writer.releaseLock();

    socket.close();
  }
}

// Utility Functions

export function unixToTimeProtocol(unixTimestamp: number): number {
  return unixTimestamp + TIME_OFFSET;
}

export function timeProtocolToUnix(timeValue: number): number {
  return timeValue - TIME_OFFSET;
}

export function timeProtocolToDate(timeValue: number): Date {
  const unixTimestamp = timeProtocolToUnix(timeValue);
  return new Date(unixTimestamp * 1000);
}

export function dateToTimeProtocol(date: Date): number {
  const unixTimestamp = Math.floor(date.getTime() / 1000);
  return unixToTimeProtocol(unixTimestamp);
}

export function encodeTimeValue(date: Date = new Date()): Uint8Array {
  const timeValue = dateToTimeProtocol(date);
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setUint32(0, timeValue, false);
  return new Uint8Array(buffer);
}

export function decodeTimeValue(data: Uint8Array): Date {
  if (data.length < 4) {
    throw new Error('Invalid data: expected 4 bytes');
  }

  const view = new DataView(data.buffer);
  const timeValue = view.getUint32(0, false);
  return timeProtocolToDate(timeValue);
}

export function calculateClockOffset(remoteTime: Date, requestTime: Date, responseTime: Date): number {
  // Simple offset calculation (doesn't account for network delay)
  const remoteSeconds = Math.floor(remoteTime.getTime() / 1000);
  const localSeconds = Math.floor((requestTime.getTime() + responseTime.getTime()) / 2 / 1000);
  return remoteSeconds - localSeconds;
}

export function formatOffset(offsetSeconds: number): string {
  const sign = offsetSeconds >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetSeconds);

  if (absOffset < 60) {
    return `${sign}${absOffset}s`;
  } else if (absOffset < 3600) {
    const minutes = Math.floor(absOffset / 60);
    const seconds = absOffset % 60;
    return `${sign}${minutes}m ${seconds}s`;
  } else {
    const hours = Math.floor(absOffset / 3600);
    const minutes = Math.floor((absOffset % 3600) / 60);
    return `${sign}${hours}h ${minutes}m`;
  }
}
```

## Web UI Design

```typescript
// src/components/TimeClient.tsx

export function TimeClient() {
  const [host, setHost] = useState('time.nist.gov');
  const [port, setPort] = useState(37);
  const [remoteTime, setRemoteTime] = useState<string>('');
  const [localTime, setLocalTime] = useState<string>('');
  const [offset, setOffset] = useState<number>(0);
  const [raw, setRaw] = useState<number>(0);

  const getTime = async () => {
    const requestTime = new Date();

    try {
      const response = await fetch('/api/time/get', {
        method: 'POST',
        body: JSON.stringify({ host, port }),
      });

      const responseTime = new Date();
      const data = await response.json();

      setRaw(data.raw);
      setRemoteTime(data.date);

      const remote = new Date(data.date);
      const local = new Date();
      const offsetSeconds = Math.floor((remote.getTime() - local.getTime()) / 1000);

      setOffset(offsetSeconds);
      setLocalTime(local.toISOString());
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  };

  const formatOffset = (seconds: number): string => {
    const sign = seconds >= 0 ? '+' : '-';
    const abs = Math.abs(seconds);

    if (abs < 60) {
      return `${sign}${abs}s`;
    } else if (abs < 3600) {
      const m = Math.floor(abs / 60);
      const s = abs % 60;
      return `${sign}${m}m ${s}s`;
    } else {
      const h = Math.floor(abs / 3600);
      const m = Math.floor((abs % 3600) / 60);
      return `${sign}${h}h ${m}m`;
    }
  };

  return (
    <div className="time-client">
      <h2>Time Protocol Client (RFC 868)</h2>

      <div className="config">
        <input
          type="text"
          placeholder="Time Server Host"
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

      {remoteTime && (
        <div className="results">
          <div className="time-display">
            <h3>Remote Time</h3>
            <div className="time">{remoteTime}</div>
            <div className="raw">Raw value: {raw.toLocaleString()}</div>
          </div>

          <div className="time-display">
            <h3>Local Time</h3>
            <div className="time">{localTime}</div>
          </div>

          <div className="offset-display">
            <h3>Clock Offset</h3>
            <div className={`offset ${offset === 0 ? 'synced' : 'diff'}`}>
              {offset === 0 ? '✓ Synchronized' : formatOffset(offset)}
            </div>
            {offset !== 0 && (
              <p className="note">
                Your clock is {offset > 0 ? 'behind' : 'ahead'} by {formatOffset(Math.abs(offset))}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="public-servers">
        <h3>Public Time Servers</h3>
        <p className="warning">
          ⚠️ Most public time servers have disabled port 37 (Time Protocol).
          Use NTP (port 123) instead for modern time synchronization.
        </p>
        <ul>
          <li onClick={() => setHost('time.nist.gov')}>time.nist.gov (NIST)</li>
          <li onClick={() => setHost('time-a.nist.gov')}>time-a.nist.gov (NIST A)</li>
          <li onClick={() => setHost('time-b.nist.gov')}>time-b.nist.gov (NIST B)</li>
        </ul>
      </div>

      <div className="info">
        <h3>About Time Protocol</h3>
        <ul>
          <li><strong>RFC 868</strong> (1983) - Time Protocol</li>
          <li>Returns 32-bit binary time value</li>
          <li>Epoch: 1900-01-01 00:00:00 UTC</li>
          <li>Format: Big-endian unsigned integer</li>
          <li>Simple one-shot query (no commands)</li>
          <li><strong>Obsolete</strong> - replaced by NTP</li>
        </ul>
      </div>

      <div className="technical">
        <h3>Technical Details</h3>
        <table>
          <tbody>
            <tr>
              <td><strong>Protocol Epoch:</strong></td>
              <td>1900-01-01 00:00:00 UTC</td>
            </tr>
            <tr>
              <td><strong>Unix Epoch:</strong></td>
              <td>1970-01-01 00:00:00 UTC</td>
            </tr>
            <tr>
              <td><strong>Offset:</strong></td>
              <td>2,208,988,800 seconds (70 years)</td>
            </tr>
            <tr>
              <td><strong>Format:</strong></td>
              <td>32-bit big-endian unsigned integer</td>
            </tr>
            <tr>
              <td><strong>Precision:</strong></td>
              <td>1 second</td>
            </tr>
            <tr>
              <td><strong>Max Date:</strong></td>
              <td>2036-02-07 (32-bit overflow)</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

## Security

### No Security

Time Protocol has **no security features**:
- No authentication
- No encryption
- Plaintext (binary) transmission
- No protection against spoofing

**Do not use for critical time synchronization** - use NTP or PTP instead.

### Firewall Considerations

```bash
# Many firewalls block port 37
# Often disabled on modern servers
# Consider it deprecated
```

## Testing

### Netcat Test

```bash
# Test Time server (TCP)
# The response is binary, so you need to decode it

nc time.nist.gov 37 | od -An -tu4 -N4

# Or use xxd to see hex
nc time.nist.gov 37 | xxd -p | head -c 8

# Example output (hex): e9a7c640
# Convert to decimal: 3,920,873,024
# Subtract offset: 3,920,873,024 - 2,208,988,800 = 1,711,884,224
# Convert to date: 2024-03-31 12:30:24 UTC
```

### Python Client

```python
#!/usr/bin/env python3
import socket
import struct
import datetime

TIME_OFFSET = 2208988800  # Seconds from 1900 to 1970

def get_time(host='time.nist.gov', port=37):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.connect((host, port))

    # Receive 4 bytes
    data = sock.recv(4)
    sock.close()

    # Unpack big-endian unsigned int
    time_value = struct.unpack('!I', data)[0]

    # Convert to Unix timestamp
    unix_timestamp = time_value - TIME_OFFSET

    # Convert to datetime
    dt = datetime.datetime.fromtimestamp(unix_timestamp, tz=datetime.timezone.utc)

    return {
        'raw': time_value,
        'unix': unix_timestamp,
        'datetime': dt
    }

result = get_time()
print(f"Raw value: {result['raw']}")
print(f"Unix timestamp: {result['unix']}")
print(f"Date/Time: {result['datetime']}")
```

### Simple Server

```bash
# Create a simple Time server with Python
python3 << 'EOF'
import socket
import struct
import time

TIME_OFFSET = 2208988800

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(('0.0.0.0', 37))
sock.listen(1)

print("Time server listening on port 37")

while True:
    conn, addr = sock.accept()
    print(f"Connection from {addr}")

    # Get current time
    unix_time = int(time.time())
    time_value = unix_time + TIME_OFFSET

    # Send 4-byte big-endian value
    data = struct.pack('!I', time_value)
    conn.send(data)
    conn.close()
EOF
```

### Docker Test Server

```bash
# Simple Time server
docker run -d \
  -p 37:37 \
  --name time-server \
  python:3-alpine sh -c '
    python3 -c "
import socket, struct, time
TIME_OFFSET = 2208988800
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind((\"0.0.0.0\", 37))
s.listen(1)
print(\"Time server running\")
while True:
    conn, addr = s.accept()
    conn.send(struct.pack(\"!I\", int(time.time()) + TIME_OFFSET))
    conn.close()
    "
  '

# Test
nc localhost 37 | xxd
```

## Resources

- **RFC 868**: [Time Protocol](https://tools.ietf.org/html/rfc868)
- **NIST Time Servers**: [time.nist.gov](https://www.nist.gov/pml/time-and-frequency-division/time-distribution/internet-time-service-its)
- **Alternative**: Use [NTP](https://en.wikipedia.org/wiki/Network_Time_Protocol) for accurate time synchronization

## Comparison with Other Time Protocols

| Protocol | Port | Format | Accuracy | Status |
|----------|------|--------|----------|--------|
| TIME | 37 | Binary (32-bit) | Seconds | Obsolete |
| DAYTIME | 13 | ASCII text | Seconds | Obsolete |
| NTP | 123 | Binary (64-bit) | Microseconds | Active |
| PTP | - | IEEE 1588 | Nanoseconds | Active |

## Binary Format Details

### Request (TCP)

```
[Connect to port 37]
(No data sent - just connect)
```

### Response (TCP)

```
Byte 0: MSB (Most Significant Byte)
Byte 1:
Byte 2:
Byte 3: LSB (Least Significant Byte)

Example: 0xE9 0xA7 0xC6 0x40
= 3,920,873,024 (decimal)
- 2,208,988,800 (offset)
= 1,711,884,224 (Unix timestamp)
= 2024-03-31 12:30:24 UTC
```

### Y2K36 Problem

```
32-bit unsigned integer overflow:
Max value: 4,294,967,295
Overflow date: 2036-02-07 06:28:15 UTC

After this date, the Time Protocol will wrap around to 1900!
```

## Notes

- **Binary protocol** - 4 bytes only
- **Big-endian** (network byte order)
- **One-shot** - connect, receive, disconnect
- **Epoch difference** - 70 years before Unix epoch
- **Precision**: 1 second (no subsecond resolution)
- **Y2K36**: Will overflow in 2036
- **Obsolete** - replaced by NTP
- **Port 37** often blocked by firewalls
- **No commands** - server sends immediately
- **TCP and UDP** versions exist
- One of the **original Internet protocols** (1983)
- **Educational value** - demonstrates binary network protocols
- Simpler than NTP but **much less accurate**
