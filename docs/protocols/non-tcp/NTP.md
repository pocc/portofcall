# ⚠️ NON-TCP PROTOCOL - NOT COMPATIBLE WITH CLOUDFLARE WORKERS

> **Note:** This protocol does not use TCP as its primary transport mechanism. It cannot be implemented using Cloudflare Workers' Sockets API (`connect()`), which only supports TCP connections. This protocol is documented here for reference but requires alternative implementation approaches (native UDP/IP sockets, specialized gateways, or protocol translation).


## Overview

**Protocol:** NTP (Network Time Protocol)
**Port:** 123 (UDP)
**RFC:** [RFC 5905](https://tools.ietf.org/html/rfc5905)
**Complexity:** Medium
**Purpose:** Precise time synchronization

NTP enables **microsecond-precision time synchronization** - synchronize system clocks across networks with sub-millisecond accuracy from the browser.

### Use Cases
- System clock synchronization
- Network latency measurement
- Distributed system coordination
- Timestamp validation
- Time-sensitive applications
- Security event correlation

## Protocol Specification

### NTP Packet Format (48 bytes)

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|LI | VN  |Mode |    Stratum    |     Poll      |   Precision   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                         Root Delay                            |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                         Root Dispersion                       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                          Reference ID                         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    Reference Timestamp (64)                   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    Originate Timestamp (64)                   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     Receive Timestamp (64)                    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     Transmit Timestamp (64)                   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### Field Descriptions

| Field | Bits | Description |
|-------|------|-------------|
| LI | 2 | Leap Indicator (0=no warning, 1=+1s, 2=-1s, 3=unsync) |
| VN | 3 | Version Number (3 or 4) |
| Mode | 3 | Mode (3=client, 4=server, 5=broadcast) |
| Stratum | 8 | Server stratum (0=unspec, 1=primary, 2-15=secondary) |
| Poll | 8 | Maximum interval (log2 seconds) |
| Precision | 8 | Clock precision (log2 seconds) |
| Root Delay | 32 | Round-trip delay to primary source |
| Root Dispersion | 32 | Maximum error relative to primary |
| Reference ID | 32 | Reference clock identifier |
| Reference Timestamp | 64 | Last clock update time |
| Originate Timestamp | 64 | Client's transmit time |
| Receive Timestamp | 64 | Server's receive time |
| Transmit Timestamp | 64 | Server's transmit time |

### NTP Timestamp Format

64-bit fixed-point: 32 bits seconds + 32 bits fraction

```
Epoch: January 1, 1900 00:00:00 UTC
```

### Mode Values

| Mode | Description |
|------|-------------|
| 0 | Reserved |
| 1 | Symmetric active |
| 2 | Symmetric passive |
| 3 | Client |
| 4 | Server |
| 5 | Broadcast |
| 6 | NTP control message |
| 7 | Reserved for private use |

## Worker Implementation

```typescript
// src/worker/protocols/ntp/client.ts

// Note: NTP uses UDP, not directly supported by Workers
// This implementation shows protocol logic for TCP-based proxy

export interface NTPConfig {
  host: string;
  port?: number;
}

export interface NTPResponse {
  leapIndicator: number;
  version: number;
  mode: number;
  stratum: number;
  precision: number;
  rootDelay: number;
  rootDispersion: number;
  referenceId: string;
  referenceTimestamp: Date;
  originateTimestamp: Date;
  receiveTimestamp: Date;
  transmitTimestamp: Date;
  offset: number;
  delay: number;
  dispersion: number;
}

export class NTPClient {
  private readonly NTP_EPOCH = Date.UTC(1900, 0, 1);
  private readonly UNIX_EPOCH = Date.UTC(1970, 0, 1);
  private readonly NTP_TO_UNIX = (this.UNIX_EPOCH - this.NTP_EPOCH) / 1000;

  constructor(private config: NTPConfig) {}

  async getTime(): Promise<NTPResponse> {
    const port = this.config.port || 123;

    // Build NTP request packet
    const request = this.buildRequest();

    // Record client transmit time
    const t1 = Date.now();

    // Send request (via UDP proxy in real implementation)
    const response = await this.sendRequest(request);

    // Record client receive time
    const t4 = Date.now();

    // Parse response
    return this.parseResponse(response, t1, t4);
  }

  private buildRequest(): Uint8Array {
    const packet = new Uint8Array(48);

    // LI (0) + VN (4) + Mode (3 = client)
    packet[0] = (0 << 6) | (4 << 3) | 3;

    // All other fields are zero for basic client request

    return packet;
  }

  private parseResponse(data: Uint8Array, t1: number, t4: number): NTPResponse {
    const view = new DataView(data.buffer);

    // Parse header
    const byte0 = view.getUint8(0);
    const leapIndicator = (byte0 >> 6) & 0x03;
    const version = (byte0 >> 3) & 0x07;
    const mode = byte0 & 0x07;

    const stratum = view.getUint8(1);
    const poll = view.getInt8(2);
    const precision = view.getInt8(3);

    const rootDelay = this.parseFixed32(view, 4);
    const rootDispersion = this.parseFixed32(view, 8);

    const referenceId = this.parseReferenceId(view, 12, stratum);

    // Parse timestamps
    const referenceTimestamp = this.parseTimestamp(view, 16);
    const originateTimestamp = this.parseTimestamp(view, 24);
    const receiveTimestamp = this.parseTimestamp(view, 32);
    const transmitTimestamp = this.parseTimestamp(view, 40);

    // Convert to Unix timestamps (milliseconds)
    const t2 = receiveTimestamp.getTime();
    const t3 = transmitTimestamp.getTime();

    // Calculate offset and delay
    // Offset = ((T2 - T1) + (T3 - T4)) / 2
    // Delay = (T4 - T1) - (T3 - T2)
    const offset = ((t2 - t1) + (t3 - t4)) / 2;
    const delay = (t4 - t1) - (t3 - t2);

    return {
      leapIndicator,
      version,
      mode,
      stratum,
      precision: Math.pow(2, precision),
      rootDelay,
      rootDispersion,
      referenceId,
      referenceTimestamp,
      originateTimestamp,
      receiveTimestamp,
      transmitTimestamp,
      offset,
      delay,
      dispersion: rootDispersion,
    };
  }

  private parseTimestamp(view: DataView, offset: number): Date {
    const seconds = view.getUint32(offset);
    const fraction = view.getUint32(offset + 4);

    if (seconds === 0 && fraction === 0) {
      return new Date(0);
    }

    // Convert NTP timestamp to Unix timestamp
    const unixSeconds = seconds - this.NTP_TO_UNIX;
    const milliseconds = (fraction / 0x100000000) * 1000;

    return new Date(unixSeconds * 1000 + milliseconds);
  }

  private parseFixed32(view: DataView, offset: number): number {
    const value = view.getInt32(offset);
    return value / 65536.0;
  }

  private parseReferenceId(view: DataView, offset: number, stratum: number): string {
    const bytes = new Uint8Array(view.buffer, offset, 4);

    if (stratum === 0 || stratum === 1) {
      // ASCII identifier (e.g., "GPS", "ATOM")
      return new TextDecoder().decode(bytes).replace(/\0/g, '');
    } else {
      // IPv4 address
      return Array.from(bytes).join('.');
    }
  }

  private async sendRequest(packet: Uint8Array): Promise<Uint8Array> {
    // This would require UDP support or a proxy
    // For demonstration purposes only
    throw new Error('UDP not directly supported - use proxy or HTTP-based NTP');
  }

  // Utility methods

  static formatStratum(stratum: number): string {
    if (stratum === 0) return 'Unspecified';
    if (stratum === 1) return 'Primary (e.g., GPS)';
    if (stratum >= 2 && stratum <= 15) return `Secondary (${stratum})`;
    return 'Invalid';
  }

  static formatLeapIndicator(li: number): string {
    const indicators = [
      'No warning',
      'Last minute of day has 61 seconds',
      'Last minute of day has 59 seconds',
      'Clock unsynchronized',
    ];
    return indicators[li] || 'Unknown';
  }

  static formatMode(mode: number): string {
    const modes = [
      'Reserved',
      'Symmetric active',
      'Symmetric passive',
      'Client',
      'Server',
      'Broadcast',
      'Control message',
      'Private use',
    ];
    return modes[mode] || 'Unknown';
  }
}

// HTTP-based SNTP client (simpler alternative)

export class SNTPClient {
  constructor(private config: NTPConfig) {}

  async getTime(): Promise<{ time: Date; offset: number }> {
    // Use HTTP-based time API as alternative to UDP NTP
    const response = await fetch(`https://${this.config.host}/api/time`);
    const data = await response.json();

    const serverTime = new Date(data.time);
    const localTime = new Date();
    const offset = serverTime.getTime() - localTime.getTime();

    return { time: serverTime, offset };
  }
}
```

## Web UI Design

```typescript
// src/components/NTPClient.tsx

export function NTPClient() {
  const [server, setServer] = useState('time.nist.gov');
  const [port, setPort] = useState(123);
  const [response, setResponse] = useState<NTPResponse | null>(null);
  const [syncing, setSyncing] = useState(false);

  const syncTime = async () => {
    setSyncing(true);

    try {
      const res = await fetch('/api/ntp/query', {
        method: 'POST',
        body: JSON.stringify({ server, port }),
      });

      const data = await response.json();
      setResponse(data);
    } catch (error) {
      alert(`Error: ${error.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const formatTime = (date: Date): string => {
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
      hour12: false,
    });
  };

  const formatOffset = (ms: number): string => {
    const sign = ms >= 0 ? '+' : '-';
    const abs = Math.abs(ms);

    if (abs < 1) {
      return `${sign}${abs.toFixed(3)}ms`;
    } else if (abs < 1000) {
      return `${sign}${abs.toFixed(0)}ms`;
    } else {
      return `${sign}${(abs / 1000).toFixed(3)}s`;
    }
  };

  return (
    <div className="ntp-client">
      <h2>NTP Time Synchronization</h2>

      <div className="config">
        <input
          type="text"
          placeholder="NTP Server"
          value={server}
          onChange={(e) => setServer(e.target.value)}
        />
        <input
          type="number"
          placeholder="Port"
          value={port}
          onChange={(e) => setPort(Number(e.target.value))}
        />
        <button onClick={syncTime} disabled={syncing}>
          {syncing ? 'Syncing...' : 'Query Time'}
        </button>
      </div>

      {response && (
        <div className="results">
          <div className="time-info">
            <h3>Server Time</h3>
            <div className="time-display">
              {formatTime(response.transmitTimestamp)}
            </div>
          </div>

          <div className="sync-info">
            <div className="metric">
              <label>Offset:</label>
              <span className={Math.abs(response.offset) > 100 ? 'warning' : 'good'}>
                {formatOffset(response.offset)}
              </span>
            </div>

            <div className="metric">
              <label>Round-Trip Delay:</label>
              <span>{formatOffset(response.delay)}</span>
            </div>

            <div className="metric">
              <label>Stratum:</label>
              <span>{response.stratum} - {NTPClient.formatStratum(response.stratum)}</span>
            </div>

            <div className="metric">
              <label>Precision:</label>
              <span>{(response.precision * 1000).toFixed(3)}ms</span>
            </div>

            <div className="metric">
              <label>Reference ID:</label>
              <span>{response.referenceId}</span>
            </div>

            <div className="metric">
              <label>Leap Indicator:</label>
              <span>{NTPClient.formatLeapIndicator(response.leapIndicator)}</span>
            </div>
          </div>

          <div className="timestamps">
            <h3>Timestamps</h3>
            <table>
              <tbody>
                <tr>
                  <td>Reference:</td>
                  <td>{formatTime(response.referenceTimestamp)}</td>
                </tr>
                <tr>
                  <td>Originate (T1):</td>
                  <td>{formatTime(response.originateTimestamp)}</td>
                </tr>
                <tr>
                  <td>Receive (T2):</td>
                  <td>{formatTime(response.receiveTimestamp)}</td>
                </tr>
                <tr>
                  <td>Transmit (T3):</td>
                  <td>{formatTime(response.transmitTimestamp)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="public-servers">
        <h3>Public NTP Servers</h3>
        <ul>
          <li onClick={() => setServer('time.nist.gov')}>time.nist.gov (NIST)</li>
          <li onClick={() => setServer('time.google.com')}>time.google.com (Google)</li>
          <li onClick={() => setServer('pool.ntp.org')}>pool.ntp.org (NTP Pool)</li>
          <li onClick={() => setServer('time.cloudflare.com')}>time.cloudflare.com (Cloudflare)</li>
        </ul>
      </div>

      <div className="info">
        <h3>About NTP</h3>
        <ul>
          <li><strong>Accuracy:</strong> Sub-millisecond on LAN, milliseconds on WAN</li>
          <li><strong>Stratum 0:</strong> Reference clocks (GPS, atomic)</li>
          <li><strong>Stratum 1:</strong> Primary servers (directly connected to stratum 0)</li>
          <li><strong>Stratum 2-15:</strong> Secondary servers</li>
          <li><strong>Algorithm:</strong> Marzullo's algorithm for clock selection</li>
        </ul>
      </div>
    </div>
  );
}
```

## Security

### Authentication

```typescript
// NTP supports symmetric key authentication (not widely used)
// Most deployments use unsigned packets

// For secure time: use NTS (Network Time Security)
```

### Rate Limiting

```bash
# Configure server rate limits
restrict default kod nomodify notrap nopeer noquery
restrict 127.0.0.1
restrict ::1
```

## Testing

### ntpdate (Legacy)

```bash
# Query NTP server
ntpdate -q time.nist.gov

# Output:
# server 132.163.96.1, stratum 1, offset -0.000123, delay 0.02345
```

### ntpq (Query Tool)

```bash
# Query server
ntpq -p time.nist.gov

# Show associations
ntpq -c associations

# Show system status
ntpq -c sysinfo
```

### chrony (Modern Alternative)

```bash
# Install chrony
apt-get install chrony

# Query server
chronyc tracking

# Manual sync
chronyc makestep
```

### Docker NTP Server

```bash
# Run NTP server
docker run -d \
  -p 123:123/udp \
  --name ntp \
  cturra/ntp

# Configure pool servers
docker run -d \
  -p 123:123/udp \
  -e NTP_SERVERS="time.nist.gov,time.google.com" \
  cturra/ntp
```

## Resources

- **RFC 5905**: [Network Time Protocol v4](https://tools.ietf.org/html/rfc5905)
- **NTP.org**: [Official NTP documentation](https://www.ntp.org/)
- **NTP Pool**: [Public NTP servers](https://www.ntppool.org/)
- **Cloudflare Time**: [time.cloudflare.com](https://www.cloudflare.com/time/)

## Time Calculation

### Offset Calculation

```
Offset = ((T2 - T1) + (T3 - T4)) / 2

Where:
T1 = Client transmit timestamp
T2 = Server receive timestamp
T3 = Server transmit timestamp
T4 = Client receive timestamp
```

### Delay Calculation

```
Delay = (T4 - T1) - (T3 - T2)
```

### Example

```
T1 = 1000ms (client sends)
T2 = 1020ms (server receives) → 20ms network delay
T3 = 1021ms (server sends)     → 1ms processing
T4 = 1041ms (client receives)  → 20ms network delay

Offset = ((1020 - 1000) + (1021 - 1041)) / 2
       = (20 + (-20)) / 2
       = 0ms (clocks synchronized)

Delay = (1041 - 1000) - (1021 - 1020)
      = 41 - 1
      = 40ms (round-trip)
```

## Notes

- **UDP-based** (port 123) - requires proxy for Workers
- **Microsecond precision** possible with PTP on LAN
- **Stratum hierarchy** - lower is better (1 is best)
- **NTP Pool Project** provides free public servers
- **Leap seconds** handled via leap indicator
- **Security**: Use NTS (Network Time Security) when available
- **Alternative**: Use HTTP-based time APIs for simple use cases
- **Marzullo's algorithm** selects best time source
- Not suitable for **high-frequency trading** (use PTP instead)
