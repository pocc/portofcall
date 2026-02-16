# Beats Protocol Implementation

## Overview

**Protocol:** Beats (Lumberjack v2)
**Port:** 5044
**Specification:** Elastic Beats Protocol (Lumberjack v2)
**Complexity:** Medium
**Purpose:** Log shipping, metrics collection, monitoring data transmission

The Beats protocol (also known as Lumberjack) is a binary framing protocol used by Elastic Beats (Filebeat, Metricbeat, Winlogbeat, Packetbeat, Auditbeat, Heartbeat, etc.) to efficiently send logs, metrics, and monitoring data to Logstash or Elasticsearch.

### Use Cases
- Centralized log aggregation
- Metrics collection and forwarding
- Security event monitoring
- Application performance monitoring
- Infrastructure monitoring
- Network packet analysis
- System audit logging

## Protocol Specification

### Wire Format

Beats uses a binary framing protocol with the following frame types:

#### WINDOW Frame (`2W`)
Announces protocol version and window size (max events before ACK needed):
```
Byte 0: '2' (version)
Byte 1: 'W' (window frame type)
Bytes 2-5: Window size (32-bit big-endian unsigned integer)
```

#### JSON Frame (`2J`)
Sends a single JSON event with sequence number:
```
Byte 0: '2' (version)
Byte 1: 'J' (JSON frame type)
Bytes 2-5: Sequence number (32-bit big-endian)
Bytes 6-9: Payload length (32-bit big-endian)
Bytes 10+: JSON payload
```

#### ACK Frame (`2A`)
Server acknowledgment with sequence number:
```
Byte 0: '2' (version)
Byte 1: 'A' (ACK frame type)
Bytes 2-5: Sequence number acknowledged (32-bit big-endian)
```

#### COMPRESSED Frame (`2C`)
Zlib-compressed batch of events (not implemented in basic version):
```
Byte 0: '2' (version)
Byte 1: 'C' (compressed frame type)
Bytes 2-5: Payload length (32-bit big-endian)
Bytes 6+: Zlib-compressed payload
```

### Example Session

**Client → Server: WINDOW Frame**
```
32 57 00 00 03 E8
'2' 'W' (window size: 1000)
```

**Client → Server: JSON Frame**
```
32 4A 00 00 00 01 00 00 00 2D
'2' 'J' (seq: 1) (length: 45)

{"message":"Server started","level":"info","timestamp":"2024-02-16T10:30:00Z"}
```

**Server → Client: ACK Frame**
```
32 41 00 00 00 01
'2' 'A' (acknowledged seq: 1)
```

## Worker Implementation

### Endpoints

- **POST /api/beats/send** - Send events using Beats protocol
- **POST /api/beats/connect** - Test Beats/Logstash connectivity

### Beats Send Request

```json
{
  "host": "logstash.example.com",
  "port": 5044,
  "events": [
    {
      "message": "User logged in",
      "level": "info",
      "user": "alice",
      "timestamp": "2024-02-16T10:30:00Z"
    },
    {
      "message": "Failed login attempt",
      "level": "warning",
      "user": "bob",
      "timestamp": "2024-02-16T10:31:00Z"
    }
  ],
  "windowSize": 1000,
  "timeout": 15000
}
```

### Beats Send Response

```json
{
  "success": true,
  "host": "logstash.example.com",
  "port": 5044,
  "acknowledged": 2,
  "eventsSent": 2,
  "rtt": 245
}
```

## Key Features

### Window-Based Flow Control
- Client announces window size (max unacknowledged events)
- Server sends ACK after processing batch
- Prevents overwhelming receiver
- Default window size: 1000 events

### Sequence Numbering
- Each event gets a sequence number (starts at 1)
- ACK frame indicates highest sequence number processed
- Allows detection of lost events
- Supports reliable delivery

### Binary Efficiency
- Compact binary framing
- Less overhead than JSON-only protocols
- Efficient for high-volume log shipping
- Big-endian byte order (network byte order)

### Event Format
- JSON payloads for flexibility
- Common fields: message, timestamp, level, host
- Custom fields supported
- Structured logging friendly

## Security Considerations

### No Built-in Encryption
- Beats protocol itself has no encryption
- Use TLS/SSL wrapper for secure transmission
- Logstash supports SSL on port 5044
- Filebeat supports `ssl.enabled` configuration

### Authentication
- No authentication in protocol itself
- Typically secured at network level (firewall, VPN)
- Logstash can be configured for client cert verification
- Elastic Stack provides additional auth layers

### Data Privacy
- Log data transmitted in clear JSON
- May contain sensitive information
- Recommend TLS for production use
- Filter sensitive data at beat source

## Elastic Beats Ecosystem

### Beat Types
- **Filebeat**: Log files and log forwarding
- **Metricbeat**: System and service metrics
- **Packetbeat**: Network packet analysis
- **Winlogbeat**: Windows event logs
- **Auditbeat**: Audit data (Linux auditd, file integrity)
- **Heartbeat**: Uptime monitoring
- **Functionbeat**: Serverless data collection

### Common Fields
```json
{
  "@timestamp": "2024-02-16T10:30:00.000Z",
  "message": "Log message text",
  "log": {
    "level": "info",
    "file": {
      "path": "/var/log/app.log"
    }
  },
  "host": {
    "name": "server-01",
    "ip": "192.168.1.10"
  },
  "service": {
    "name": "web-api"
  },
  "event": {
    "dataset": "application.logs"
  }
}
```

## Testing

### Test Endpoints
- **Logstash** with Beats input plugin on port 5044
- **Elasticsearch** with direct Beats input
- Local Logstash instance for testing
- Docker: `docker run -p 5044:5044 logstash:latest`

### Example cURL Request

```bash
curl -X POST http://localhost:8787/api/beats/send \
  -H "Content-Type: application/json" \
  -d '{
    "host": "logstash.example.com",
    "port": 5044,
    "events": [
      {
        "message": "Test log entry",
        "level": "info",
        "application": "test-app"
      }
    ]
  }'
```

### Logstash Configuration

```ruby
input {
  beats {
    port => 5044
    ssl => false
  }
}

output {
  stdout { codec => rubydebug }
  elasticsearch {
    hosts => ["localhost:9200"]
    index => "beats-%{+YYYY.MM.dd}"
  }
}
```

## References

- **Elastic Beats**: [Official Documentation](https://www.elastic.co/guide/en/beats/libbeat/current/index.html)
- **Lumberjack Protocol**: [GitHub Spec](https://github.com/elastic/logstash-forwarder/blob/master/PROTOCOL.md)
- **Filebeat**: [Reference](https://www.elastic.co/guide/en/beats/filebeat/current/index.html)
- **Metricbeat**: [Reference](https://www.elastic.co/guide/en/beats/metricbeat/current/index.html)
- **Logstash Beats Input**: [Plugin Docs](https://www.elastic.co/guide/en/logstash/current/plugins-inputs-beats.html)

## Implementation Notes

- Protocol version is always `2` (Lumberjack v2)
- Sequence numbers start at 1 (not 0)
- Big-endian byte order for all integers
- Window size default is 1000 events
- ACK frame sent after all events processed
- JSON payloads use UTF-8 encoding
- Timeout default is 15 seconds
- Each event is a separate JSON frame

## Differences from Other Log Protocols

| Feature | Beats | Syslog | Fluentd | RELP |
|---------|-------|--------|---------|------|
| Protocol | Binary frames | Text | MessagePack | Text frames |
| Port | 5044 | 514 | 24224 | 20514 |
| ACKs | Window-based | No | Optional | Per-message |
| Compression | Zlib option | No | Yes | No |
| Structure | JSON | Free-form | JSON | Syslog-like |
| Encryption | Via TLS | Via TLS | Via TLS | Via TLS |

## Future Enhancements

- Zlib compression support (COMPRESSED frames)
- TLS/SSL support for encrypted connections
- Batch mode with multiple events per request
- Compression negotiation
- Persistent connections with keep-alive
- Observe pattern for streaming logs
- Integration with Durable Objects for queuing
- Metrics aggregation before sending
