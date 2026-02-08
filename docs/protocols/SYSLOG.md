# Syslog Protocol Implementation Plan

## Overview

**Protocol:** Syslog
**Port:** 514 (UDP), 6514 (TCP/TLS)
**RFC:** [RFC 5424](https://tools.ietf.org/html/rfc5424) (New), [RFC 3164](https://tools.ietf.org/html/rfc3164) (Legacy)
**Complexity:** Low
**Purpose:** System logging and event forwarding

Syslog enables **centralized logging** - send application logs, system events, and security alerts to remote log servers from the browser.

### Use Cases
- Centralized log aggregation
- Security information and event management (SIEM)
- Application monitoring
- Audit trails
- Network device logging
- Cloud application logging

## Protocol Specification

### Message Format (RFC 5424)

```
<PRIORITY>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID [STRUCTURED-DATA] MSG
```

### Priority Calculation

```
Priority = (Facility * 8) + Severity
```

### Facilities (0-23)

| Value | Facility |
|-------|----------|
| 0 | kernel messages |
| 1 | user-level messages |
| 2 | mail system |
| 3 | system daemons |
| 4 | security/authorization |
| 16 | local use 0 (local0) |
| 17 | local use 1 (local1) |
| ... | ... |
| 23 | local use 7 (local7) |

### Severities (0-7)

| Value | Severity | Description |
|-------|----------|-------------|
| 0 | Emergency | System is unusable |
| 1 | Alert | Action must be taken immediately |
| 2 | Critical | Critical conditions |
| 3 | Error | Error conditions |
| 4 | Warning | Warning conditions |
| 5 | Notice | Normal but significant condition |
| 6 | Informational | Informational messages |
| 7 | Debug | Debug-level messages |

### Example Messages

#### RFC 5424 (New)
```
<34>1 2024-01-15T14:30:45.123Z myhost myapp 12345 ID47 - An error occurred
```

#### RFC 3164 (Legacy/BSD)
```
<34>Jan 15 14:30:45 myhost myapp[12345]: An error occurred
```

## Worker Implementation

```typescript
// src/worker/protocols/syslog/client.ts

import { connect } from 'cloudflare:sockets';

export interface SyslogConfig {
  host: string;
  port?: number;
  protocol?: 'tcp' | 'udp';
  facility?: number;
  hostname?: string;
  appName?: string;
  format?: 'rfc5424' | 'rfc3164';
}

export enum Severity {
  Emergency = 0,
  Alert = 1,
  Critical = 2,
  Error = 3,
  Warning = 4,
  Notice = 5,
  Informational = 6,
  Debug = 7,
}

export enum Facility {
  Kernel = 0,
  User = 1,
  Mail = 2,
  Daemon = 3,
  Auth = 4,
  Syslog = 5,
  Lpr = 6,
  News = 7,
  Uucp = 8,
  Cron = 9,
  Authpriv = 10,
  Ftp = 11,
  Ntp = 12,
  Security = 13,
  Console = 14,
  Clock = 15,
  Local0 = 16,
  Local1 = 17,
  Local2 = 18,
  Local3 = 19,
  Local4 = 20,
  Local5 = 21,
  Local6 = 22,
  Local7 = 23,
}

export interface SyslogMessage {
  severity: Severity;
  message: string;
  facility?: number;
  timestamp?: Date;
  hostname?: string;
  appName?: string;
  procId?: string;
  msgId?: string;
  structuredData?: Record<string, Record<string, string>>;
}

export class SyslogClient {
  private socket: any;
  private facility: number;
  private hostname: string;
  private appName: string;
  private format: 'rfc5424' | 'rfc3164';

  constructor(private config: SyslogConfig) {
    this.facility = config.facility ?? Facility.Local0;
    this.hostname = config.hostname ?? 'localhost';
    this.appName = config.appName ?? 'app';
    this.format = config.format ?? 'rfc5424';
  }

  async connect(): Promise<void> {
    const port = this.config.port ?? 514;

    // Note: UDP is more common for syslog, but TCP is more reliable
    // Workers primarily support TCP via connect()
    this.socket = connect(`${this.config.host}:${port}`);
    await this.socket.opened;
  }

  async log(severity: Severity, message: string, options: {
    facility?: number;
    procId?: string;
    msgId?: string;
    structuredData?: Record<string, Record<string, string>>;
  } = {}): Promise<void> {
    const msg: SyslogMessage = {
      severity,
      message,
      facility: options.facility ?? this.facility,
      timestamp: new Date(),
      hostname: this.hostname,
      appName: this.appName,
      procId: options.procId,
      msgId: options.msgId,
      structuredData: options.structuredData,
    };

    const formatted = this.format === 'rfc5424'
      ? this.formatRFC5424(msg)
      : this.formatRFC3164(msg);

    await this.send(formatted);
  }

  // Convenience methods

  async emergency(message: string): Promise<void> {
    await this.log(Severity.Emergency, message);
  }

  async alert(message: string): Promise<void> {
    await this.log(Severity.Alert, message);
  }

  async critical(message: string): Promise<void> {
    await this.log(Severity.Critical, message);
  }

  async error(message: string): Promise<void> {
    await this.log(Severity.Error, message);
  }

  async warning(message: string): Promise<void> {
    await this.log(Severity.Warning, message);
  }

  async notice(message: string): Promise<void> {
    await this.log(Severity.Notice, message);
  }

  async info(message: string): Promise<void> {
    await this.log(Severity.Informational, message);
  }

  async debug(message: string): Promise<void> {
    await this.log(Severity.Debug, message);
  }

  private formatRFC5424(msg: SyslogMessage): string {
    const priority = this.calculatePriority(msg.facility!, msg.severity);
    const version = 1;
    const timestamp = this.formatTimestamp(msg.timestamp!);
    const hostname = msg.hostname || '-';
    const appName = msg.appName || '-';
    const procId = msg.procId || '-';
    const msgId = msg.msgId || '-';
    const structuredData = this.formatStructuredData(msg.structuredData);
    const message = msg.message;

    return `<${priority}>${version} ${timestamp} ${hostname} ${appName} ${procId} ${msgId} ${structuredData} ${message}\n`;
  }

  private formatRFC3164(msg: SyslogMessage): string {
    const priority = this.calculatePriority(msg.facility!, msg.severity);
    const timestamp = this.formatLegacyTimestamp(msg.timestamp!);
    const hostname = msg.hostname || 'localhost';
    const tag = msg.appName || 'app';
    const pid = msg.procId ? `[${msg.procId}]` : '';
    const message = msg.message;

    return `<${priority}>${timestamp} ${hostname} ${tag}${pid}: ${message}\n`;
  }

  private calculatePriority(facility: number, severity: Severity): number {
    return (facility * 8) + severity;
  }

  private formatTimestamp(date: Date): string {
    // RFC 3339 format: 2024-01-15T14:30:45.123Z
    return date.toISOString();
  }

  private formatLegacyTimestamp(date: Date): string {
    // BSD syslog format: Jan 15 14:30:45
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const month = months[date.getMonth()];
    const day = String(date.getDate()).padStart(2, ' ');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${month} ${day} ${hours}:${minutes}:${seconds}`;
  }

  private formatStructuredData(data?: Record<string, Record<string, string>>): string {
    if (!data || Object.keys(data).length === 0) {
      return '-';
    }

    let result = '';

    for (const [id, params] of Object.entries(data)) {
      result += `[${id}`;
      for (const [key, value] of Object.entries(params)) {
        const escapedValue = value
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/]/g, '\\]');
        result += ` ${key}="${escapedValue}"`;
      }
      result += ']';
    }

    return result;
  }

  private async send(message: string): Promise<void> {
    const writer = this.socket.writable.getWriter();
    const encoder = new TextEncoder();
    await writer.write(encoder.encode(message));
    writer.releaseLock();
  }

  async close(): Promise<void> {
    if (this.socket) {
      await this.socket.close();
    }
  }
}

// Logger wrapper for convenient logging

export class SyslogLogger {
  private client: SyslogClient;

  constructor(config: SyslogConfig) {
    this.client = new SyslogClient(config);
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  log(level: keyof typeof Severity, message: string, metadata?: any): Promise<void> {
    const fullMessage = metadata
      ? `${message} ${JSON.stringify(metadata)}`
      : message;

    const severity = Severity[level];
    return this.client.log(severity, fullMessage);
  }

  emergency(message: string, metadata?: any): Promise<void> {
    return this.log('Emergency', message, metadata);
  }

  alert(message: string, metadata?: any): Promise<void> {
    return this.log('Alert', message, metadata);
  }

  critical(message: string, metadata?: any): Promise<void> {
    return this.log('Critical', message, metadata);
  }

  error(message: string, metadata?: any): Promise<void> {
    return this.log('Error', message, metadata);
  }

  warning(message: string, metadata?: any): Promise<void> {
    return this.log('Warning', message, metadata);
  }

  notice(message: string, metadata?: any): Promise<void> {
    return this.log('Notice', message, metadata);
  }

  info(message: string, metadata?: any): Promise<void> {
    return this.log('Informational', message, metadata);
  }

  debug(message: string, metadata?: any): Promise<void> {
    return this.log('Debug', message, metadata);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
```

## Web UI Design

```typescript
// src/components/SyslogClient.tsx

export function SyslogClient() {
  const [host, setHost] = useState('syslog.example.com');
  const [port, setPort] = useState(514);
  const [severity, setSeverity] = useState<Severity>(Severity.Informational);
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<Array<{
    severity: Severity;
    message: string;
    timestamp: Date;
  }>>([]);

  const sendLog = async () => {
    await fetch('/api/syslog/send', {
      method: 'POST',
      body: JSON.stringify({
        host,
        port,
        severity,
        message,
      }),
    });

    setHistory([
      ...history,
      { severity, message, timestamp: new Date() },
    ]);

    setMessage('');
  };

  const severityNames = [
    'Emergency',
    'Alert',
    'Critical',
    'Error',
    'Warning',
    'Notice',
    'Informational',
    'Debug',
  ];

  const getSeverityColor = (sev: Severity): string => {
    const colors = [
      '#ff0000', // Emergency - red
      '#ff3300', // Alert - red-orange
      '#ff6600', // Critical - orange
      '#ff9900', // Error - orange-yellow
      '#ffcc00', // Warning - yellow
      '#00cc00', // Notice - green
      '#0099ff', // Informational - blue
      '#999999', // Debug - gray
    ];
    return colors[sev];
  };

  return (
    <div className="syslog-client">
      <h2>Syslog Client</h2>

      <div className="config">
        <input
          type="text"
          placeholder="Syslog Server"
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
        <input
          type="number"
          placeholder="Port"
          value={port}
          onChange={(e) => setPort(Number(e.target.value))}
        />
      </div>

      <div className="log-input">
        <select
          value={severity}
          onChange={(e) => setSeverity(Number(e.target.value))}
        >
          {severityNames.map((name, i) => (
            <option key={i} value={i}>
              {name}
            </option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Log message..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && sendLog()}
        />

        <button onClick={sendLog}>Send Log</button>
      </div>

      <div className="quick-logs">
        <h3>Quick Logs</h3>
        <button onClick={() => {
          setSeverity(Severity.Error);
          setMessage('Application error occurred');
        }}>
          Error
        </button>
        <button onClick={() => {
          setSeverity(Severity.Warning);
          setMessage('High memory usage detected');
        }}>
          Warning
        </button>
        <button onClick={() => {
          setSeverity(Severity.Informational);
          setMessage('User logged in successfully');
        }}>
          Info
        </button>
      </div>

      <div className="log-history">
        <h3>Sent Logs</h3>
        <div className="logs">
          {history.slice(-20).reverse().map((log, i) => (
            <div
              key={i}
              className="log-entry"
              style={{ borderLeftColor: getSeverityColor(log.severity) }}
            >
              <span className="timestamp">
                {log.timestamp.toLocaleTimeString()}
              </span>
              <span className="severity" style={{ color: getSeverityColor(log.severity) }}>
                {severityNames[log.severity]}
              </span>
              <span className="message">{log.message}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="info">
        <h3>Severity Levels</h3>
        <table>
          <thead>
            <tr>
              <th>Level</th>
              <th>Name</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {severityNames.map((name, i) => (
              <tr key={i}>
                <td>{i}</td>
                <td style={{ color: getSeverityColor(i) }}>{name}</td>
                <td>
                  {i === 0 && 'System is unusable'}
                  {i === 1 && 'Action must be taken immediately'}
                  {i === 2 && 'Critical conditions'}
                  {i === 3 && 'Error conditions'}
                  {i === 4 && 'Warning conditions'}
                  {i === 5 && 'Normal but significant'}
                  {i === 6 && 'Informational messages'}
                  {i === 7 && 'Debug-level messages'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

## Security

### TLS Encryption

```typescript
// Use port 6514 for TLS-encrypted syslog
const config = {
  host: 'syslog.example.com',
  port: 6514,
  protocol: 'tcp',
};
```

### Authentication

```bash
# Configure syslog server to require authentication
# This varies by implementation (rsyslog, syslog-ng, etc.)
```

## Testing

### rsyslog (Docker)

```bash
# Docker rsyslog server
docker run -d \
  -p 514:514/udp \
  -p 514:514/tcp \
  --name rsyslog \
  rsyslog/syslog_appliance_alpine

# View logs
docker logs -f rsyslog

# Send test message with logger
logger -n localhost -P 514 "Test syslog message"
```

### Netcat Test

```bash
# Send syslog message via netcat
echo "<34>Jan 15 14:30:45 myhost myapp: Test message" | nc -u localhost 514
```

### Python Test

```python
import socket
import time

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

message = "<34>1 2024-01-15T14:30:45.123Z myhost myapp 12345 ID47 - Test message\n"
sock.sendto(message.encode(), ('localhost', 514))
```

## Resources

- **RFC 5424**: [Syslog Protocol](https://tools.ietf.org/html/rfc5424)
- **RFC 3164**: [BSD Syslog](https://tools.ietf.org/html/rfc3164)
- **rsyslog**: [rsyslog documentation](https://www.rsyslog.com/doc/)
- **syslog-ng**: [syslog-ng documentation](https://www.syslog-ng.com/technical-documents/)

## Common Use Cases

### Application Logging
```typescript
const logger = new SyslogLogger({
  host: 'logs.example.com',
  port: 514,
  appName: 'myapp',
});

await logger.info('User logged in', { userId: 123, ip: '192.168.1.1' });
await logger.error('Database connection failed', { error: 'timeout' });
```

### Security Events
```typescript
await logger.alert('Unauthorized access attempt', {
  ip: '10.0.0.1',
  user: 'admin',
});
```

### System Monitoring
```typescript
await logger.warning('High CPU usage', { cpu: 95, threshold: 80 });
```

## Notes

- **UDP is traditional** but unreliable (no delivery guarantee)
- **TCP is more reliable** but less common
- **TLS** provides encryption (port 6514)
- **Port 514** requires root privileges on Unix systems
- **RFC 5424** is modern format with structured data
- **RFC 3164** is legacy BSD format (still widely used)
- **Facilities** categorize message source
- **Severities** indicate message urgency
- Used by **SIEM systems** for security monitoring
- Common in **enterprise environments**
