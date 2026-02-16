# Fluentd Forward Protocol Implementation

## Overview

**Protocol**: Fluentd Forward Protocol
**Port**: 24224 (default)
**Transport**: TCP with MessagePack encoding
**Status**: Active, widely deployed in cloud-native environments

Fluentd is an open-source data collector for unified logging. The Forward protocol is its native inter-node transport, used for forwarding logs between Fluentd instances, Fluent Bit agents, and compatible receivers.

## Protocol Format

### MessagePack Encoding

All Fluentd messages are encoded using [MessagePack](https://msgpack.org/), a compact binary serialization format similar to JSON but more efficient.

### Message Modes

#### Message Mode (single event)
```
[tag, time, record, options]
```
- **tag**: String, dotted namespace (e.g., `app.access`)
- **time**: Integer, Unix timestamp
- **record**: Map, key-value pairs of log data
- **options**: Map, optional settings (e.g., `{"chunk": "..."}`)

#### Forward Mode (multiple events)
```
[tag, [[time1, record1], [time2, record2], ...], options]
```

#### PackedForward Mode (binary stream)
```
[tag, msgpack-binary-stream, options]
```

### Acknowledgment

When the client includes a `chunk` option, the server responds with:
```json
{"ack": "<chunk-id>"}
```

This confirms receipt of the forwarded data.

## Implementation

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/fluentd/connect` | POST | Probe Fluentd server with test message |
| `/api/fluentd/send` | POST | Send a custom log entry |

### Server Probe (`/api/fluentd/connect`)

Sends a minimal forward message with ack request to verify Fluentd connectivity.

**Request Body:**
```json
{
  "host": "fluentd.example.com",
  "port": 24224,
  "tag": "portofcall.probe",
  "timeout": 10000
}
```

**Response:**
```json
{
  "success": true,
  "host": "fluentd.example.com",
  "port": 24224,
  "rtt": 42,
  "tag": "portofcall.probe",
  "chunkId": "abc123...",
  "ackReceived": true,
  "ackMatch": true,
  "messageSizeBytes": 87,
  "protocol": "Fluentd Forward"
}
```

### Send Log Entry (`/api/fluentd/send`)

Sends a custom log entry with user-defined tag and record fields.

**Request Body:**
```json
{
  "host": "fluentd.example.com",
  "port": 24224,
  "tag": "app.test",
  "record": {
    "message": "Hello from Port of Call",
    "level": "info",
    "source": "browser"
  },
  "timeout": 10000
}
```

**Response:**
```json
{
  "success": true,
  "host": "fluentd.example.com",
  "port": 24224,
  "rtt": 38,
  "tag": "app.test",
  "chunkId": "xyz789...",
  "ackReceived": true,
  "recordKeys": ["message", "level", "source"],
  "messageSizeBytes": 112
}
```

## MessagePack Encoding Details

| Type | Format | Bytes |
|------|--------|-------|
| fixstr | `0xa0-0xbf` + data | 1 + N |
| str 8 | `0xd9` + len(1) + data | 2 + N |
| positive fixint | `0x00-0x7f` | 1 |
| uint 8 | `0xcc` + value | 2 |
| uint 16 | `0xcd` + value | 3 |
| uint 32 | `0xce` + value | 5 |
| fixmap | `0x80-0x8f` + entries | 1 + N |
| fixarray | `0x90-0x9f` + items | 1 + N |

## Authentication

- **No built-in authentication** in the standard forward protocol
- **TLS support**: Fluentd supports TLS encryption (not implemented in probe)
- **Shared key**: Some Fluentd configurations use `shared_key` for authentication
- Security typically relies on network-level controls (firewalls, VPNs)

## Timeouts & Keep-alives

- Default connection timeout: 10 seconds
- Fluentd accepts connections immediately (no greeting)
- Ack response timeout: 5 seconds
- Connection closed after each probe (stateless)
- Fluentd supports persistent connections but not needed for probing

## Binary vs. Text Encoding

- **Entirely binary**: MessagePack encoding throughout
- **No text mode**: Unlike many protocols, no human-readable fallback
- **Compact**: MessagePack is ~30-50% smaller than equivalent JSON

## Edge Cases

1. **No ack response**: Server may not have `require_ack_response` enabled. Connection still succeeds.
2. **TLS-only servers**: Will fail on plain TCP. Not implemented (would need `connect({secureTransport: "on"})`).
3. **Shared key auth**: Server may require authentication handshake before accepting data.
4. **Large records**: Capped at ~8KB per record for safety.
5. **Invalid tag format**: Tags must be alphanumeric with dots/hyphens/underscores, max 128 chars.

## Security Considerations

- Probe sends minimal test data (no sensitive information)
- Tag validated against injection patterns
- Record size limited to prevent abuse
- Host/port validated
- Read-only operations (probe + one-shot send)

## Common Tags

| Tag Pattern | Description |
|-------------|-------------|
| `app.access` | Application access logs |
| `app.error` | Application error logs |
| `system.syslog` | System syslog forwarding |
| `docker.container` | Docker container logs |
| `kubernetes.pods` | Kubernetes pod logs |
| `nginx.access` | Nginx access logs |

## References

- [Fluentd Forward Protocol Spec](https://github.com/fluent/fluentd/wiki/Forward-Protocol-Specification-v1)
- [Fluentd Documentation](https://docs.fluentd.org/)
- [Fluent Bit](https://fluentbit.io/)
- [MessagePack Specification](https://github.com/msgpack/msgpack/blob/master/spec.md)
