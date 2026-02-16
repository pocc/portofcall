# Ventrilo Protocol Implementation

## Overview

**Protocol:** Ventrilo VoIP Control Protocol
**Port:** 3784 (TCP control), 3785 (UDP voice)
**Specification:** Proprietary (reverse engineered)
**Complexity:** Medium
**Purpose:** Gaming voice chat server status and control

Ventrilo is a proprietary Voice over IP (VoIP) software designed for gaming communities. It provides low-latency voice communication with a server-client architecture. This implementation focuses on the TCP control protocol used for server status queries and connection management.

### Use Cases
- Gaming clan server monitoring
- Ventrilo server browser applications
- Server status dashboards
- Retro gaming community management
- Historical gaming infrastructure research

## Protocol Specification

### Wire Format

Ventrilo uses different packet formats across versions (v2.1, v2.2, v2.3, v3.0). The protocol is proprietary and not publicly documented, with implementations based on reverse engineering.

#### Protocol Versions

**Ventrilo 2.x:**
- Simpler packet format
- Basic status queries
- Text-based authentication

**Ventrilo 3.x:**
- Enhanced binary protocol
- Improved encryption
- Extended server information

### Status Query Protocol

#### Request Packet (Simplified)

```
Offset  Size  Field
------  ----  -----
0x00    2     Request Type (0x01 0x00)
0x02    2     Flags (0x00 0x00)
```

**Total Length:** 4 bytes minimum

#### Response Packet Format

The server response contains:
- Server name (null-terminated string)
- Server version
- Platform information
- Current user count
- Maximum user count
- Channel count
- Uptime
- Additional metadata

**Note:** Response format varies significantly between versions and is not standardized.

### Example Session

**Client → Server (Status Request):**
```
01 00 00 00
```

**Server → Client (Status Response):**
```
[Binary data containing:]
- Server name: "My Gaming Server"
- Version: "3.0.5"
- Users: 12 / 50
- Channels: 5
- Uptime: 86400 seconds
```

## Worker Implementation

### Endpoints

- **POST /api/ventrilo/status** - Query server status
- **POST /api/ventrilo/connect** - Test TCP connectivity

### Status Request

```json
{
  "host": "vent.example.com",
  "port": 3784,
  "timeout": 15000
}
```

### Status Response

```json
{
  "success": true,
  "host": "vent.example.com",
  "port": 3784,
  "serverName": "Elite Gaming Server",
  "version": "3.0.5",
  "platform": "Windows",
  "users": 12,
  "maxUsers": 50,
  "channels": 5,
  "uptime": 86400,
  "rawResponse": "01 00 45 6c 69 74 65...",
  "rtt": 245
}
```

## Key Features

### Server Status Queries
- Server name and description
- Version information
- Current and maximum user counts
- Channel count
- Server uptime

### Connection Management
- TCP connectivity testing
- Latency measurement (RTT)
- Server availability checking

### Protocol Challenges

#### Proprietary Format
- No official specification
- Reverse engineered implementations
- Version-specific packet structures

#### Binary Parsing
- Variable-length fields
- Null-terminated strings
- Mixed text and binary data

#### Version Detection
- Different v2.x and v3.x formats
- Backward compatibility issues
- Server-dependent responses

## Security Considerations

### Unencrypted Status Queries
- Status requests typically unencrypted
- Server information publicly accessible
- No authentication required for basic queries

### Voice Data Security
- Voice uses UDP (not implemented here)
- Ventrilo v3 uses proprietary encryption
- Control channel may use SSL/TLS

### Network Exposure
- Gaming servers often publicly accessible
- Server status used for server browsers
- DDoS protection typically required

## Testing

### Public Servers
Public Ventrilo servers are increasingly rare as the gaming community has moved to Discord and other modern platforms. Testing may require:
- Private server setup
- Emulated server responses
- Community-run retro gaming servers

### Example cURL Request

```bash
curl -X POST http://localhost:8787/api/ventrilo/status \
  -H "Content-Type: application/json" \
  -d '{
    "host": "vent.example.com",
    "port": 3784
  }'
```

### Local Testing

```bash
# Install Ventrilo server (Windows)
# Download from: https://www.ventrilo.com/

# Start server on port 3784

# Test status query
curl -X POST http://localhost:8787/api/ventrilo/status \
  -H "Content-Type: application/json" \
  -d '{
    "host": "localhost",
    "port": 3784
  }'
```

## References

- **Ventrilo Official Site**: [ventrilo.com](https://www.ventrilo.com/)
- **Community Protocol Docs**: Reverse engineered specifications on gaming forums
- **Wireshark Dissectors**: Community-created packet analyzers

## Implementation Notes

- Protocol version is auto-detected from response
- Status queries work over TCP (voice uses UDP)
- Response parsing is best-effort (proprietary format)
- Timeout default is 15 seconds
- Server may not respond if not configured for TCP queries
- Some servers only respond to UDP status queries

## Differences from Other VoIP Protocols

| Feature | Ventrilo | TeamSpeak | Discord | Mumble |
|---------|----------|-----------|---------|--------|
| Protocol | Proprietary | Proprietary | WebRTC | Open |
| Port (TCP) | 3784 | 10011 | 443 | 64738 |
| Port (UDP) | 3785 | 9987 | Various | 64738 |
| Status Query | Binary | Text | HTTP API | Protobuf |
| Encryption | Proprietary | Custom | WebRTC/TLS | TLS |
| Era | 2000s | 2000s | 2015+ | 2005+ |

## Historical Context

Ventrilo was one of the dominant gaming VoIP platforms in the 2000s and early 2010s, particularly popular in:
- World of Warcraft raiding guilds
- Counter-Strike clans
- EVE Online corporations
- League of Legends teams

The platform has largely been superseded by:
- Discord (modern, browser-based, free)
- TeamSpeak 3 (still used in some communities)
- Mumble (open-source alternative)

## Limitations

### TCP-Only Implementation
- Voice data requires UDP (not implemented)
- Only status queries and control channel supported
- Full client functionality not possible

### Proprietary Protocol
- No official documentation
- Version-specific implementations
- Parsing may fail with unknown formats

### Server Availability
- Few public servers remain active
- Requires private server for testing
- Historical protocol (legacy)

## Future Enhancements

- Full v2.x and v3.x packet parsing
- User list retrieval
- Channel tree parsing
- Authentication handshake (for admin functions)
- Voice packet inspection (UDP, if Workers add UDP support)
- Server admin commands
- User kick/ban operations (admin auth required)
