# Ventrilo Protocol - Power User Documentation

## Overview

**Ventrilo** is a proprietary VoIP (Voice over IP) software designed for gaming voice chat. It was extremely popular in the early-to-mid 2000s among gaming clans and guilds, particularly in MMORPGs like World of Warcraft and competitive shooters. Ventrilo uses a client-server architecture with TCP for control/status communication and UDP for voice transmission.

**Protocol Type:** Proprietary, binary
**Default Port:** 3784 (TCP for control, UDP for voice)
**Transport:** TCP for status queries, UDP for voice data
**Use Case:** Gaming voice chat server monitoring, server browser implementations

---

## Protocol Architecture

### Transport Layers

1. **TCP Control Channel (Port 3784)**
   - Server status queries
   - User authentication
   - Channel management
   - Server configuration requests

2. **UDP Voice Channel (Port 3784)**
   - Real-time voice transmission
   - Low-latency audio streaming
   - Codec-negotiated audio packets

This implementation focuses on the **TCP control protocol** for server monitoring and status queries.

---

## Protocol Versions

Ventrilo has evolved through multiple versions with different binary formats:

- **v2.1** - Early version with basic features
- **v2.2** - Enhanced codec support
- **v2.3** - Improved authentication
- **v3.0** - Major rewrite with new packet structure (most common)
- **v4.0** - Modern version with updated UI (less common in wild)

**Note:** The protocol is **not publicly documented**. This implementation is based on community reverse engineering and observed behavior from public servers.

---

## Packet Structure

### Status Request Packet (v3.0 Simplified)

```
Offset | Size | Field       | Description
-------|------|-------------|----------------------------------
0x00   | 2    | Request Type| 0x0001 (status query)
0x02   | 2    | Flags       | 0x0000 (no special flags)
```

**Hex representation:**
```
01 00 00 00
```

This is a **simplified** request format that triggers status responses on many Ventrilo servers. The actual protocol may include additional fields such as:
- Protocol version negotiation
- Compression flags
- Authentication tokens (for authenticated queries)

### Status Response Packet (Variable Length)

Response format varies significantly by server version and configuration. Common elements include:

```
Offset | Size     | Field         | Description
-------|----------|---------------|----------------------------------
0x00   | 2        | Response Type | Indicates status response
0x02   | 2        | Data Length   | Length of following data
0x04   | 2 (BE)   | User Count    | Current users (big-endian)
0x06   | 2 (BE)   | Max Users     | Maximum capacity (big-endian)
0x08   | Variable | Server Name   | Null-terminated string
...    | Variable | Additional    | Version, platform, channels, etc.
```

**Key observations:**
- Multi-byte integers use **big-endian (network byte order)**
- Strings are typically **null-terminated ASCII/UTF-8**
- Response size typically ranges from 50-500 bytes
- Unprintable bytes separate structured data fields

---

## Implementation Details

### Connection Flow

1. **TCP Connect** to `host:3784`
2. **Send** 4-byte status request packet
3. **Receive** variable-length response (typically 50-500 bytes)
4. **Parse** binary response for server information
5. **Close** connection

### Timeout Strategy

- **Connection timeout:** 15 seconds (default)
- **Response timeout:** 15 seconds (default)
- **Initial response delay:** 500ms wait after sending request (allows server processing time)
- **Read completion timeout:** 200ms (assumes all data received if no new data within window)

The implementation uses a two-phase read approach:
1. Wait 500ms for server to process request
2. Read available data in chunks
3. After each chunk, wait 200ms to see if more data arrives
4. Stop reading when no new data appears or max size (4KB) reached

### Response Parsing Heuristics

Since the protocol is proprietary and version-dependent, parsing uses **best-effort heuristics**:

#### String Extraction
- Scan byte array for sequences of printable ASCII (bytes 32-126)
- Treat null bytes (0x00) as string terminators
- First extracted string is usually the server name
- Additional strings may include platform, version info

#### User Count Extraction
- Attempt to read 16-bit big-endian integers at offsets 4-7
- Validate that values are reasonable (≤ 999 users)
- Discard if values seem corrupted or out of range

#### Version Detection
- Search for patterns like `v3.0.1` or `3.0.1` in text representation
- Extract via regex: `/v?(\d+\.\d+(\.\d+)?)/i`

#### Raw Response Logging
- First 100 bytes of response converted to hex for debugging
- Format: `01 2a 3f 00 ...` (space-separated hex bytes)
- Useful for analyzing unsupported server versions

---

## API Endpoints

### POST /api/ventrilo/connect

**Test TCP connectivity** to a Ventrilo server without querying status.

**Request:**
```json
{
  "host": "vent.example.com",
  "port": 3784,
  "timeout": 15000
}
```

**Response (Success):**
```json
{
  "success": true,
  "host": "vent.example.com",
  "port": 3784,
  "rtt": 45
}
```

**Response (Failure):**
```json
{
  "success": false,
  "host": "vent.example.com",
  "port": 3784,
  "error": "Connection timeout"
}
```

**Use cases:**
- Quick connectivity check
- Port scanning for Ventrilo servers
- Latency measurement
- Server uptime monitoring

---

### POST /api/ventrilo/status

**Query server status** including name, version, user count, etc.

**Request:**
```json
{
  "host": "vent.example.com",
  "port": 3784,
  "timeout": 15000
}
```

**Response (Success - Full Parse):**
```json
{
  "success": true,
  "host": "vent.example.com",
  "port": 3784,
  "serverName": "My Gaming Clan Vent",
  "version": "3.0.5",
  "platform": "WIN32",
  "users": 8,
  "maxUsers": 50,
  "channels": 12,
  "rawResponse": "01 2a 3f 00 4d 79 20 47 61 6d 69 6e 67 ...",
  "rtt": 52
}
```

**Response (Empty Response):**
```json
{
  "success": false,
  "host": "vent.example.com",
  "port": 3784,
  "error": "Empty response from server (server may not support TCP status queries)",
  "rtt": 67
}
```

**Response (Parse Failure):**
```json
{
  "success": false,
  "host": "vent.example.com",
  "port": 3784,
  "error": "Could not parse server response (unsupported version or format)",
  "rawResponse": "ff ff ff ff 00 00 00 00 ...",
  "rtt": 45
}
```

**Response (Connection Failure):**
```json
{
  "success": false,
  "host": "vent.example.com",
  "port": 3784,
  "error": "Connection timeout"
}
```

**Fields:**
- `serverName` - Human-readable server name
- `version` - Server software version (e.g., "3.0.5")
- `platform` - OS platform (WIN32, LINUX, etc.)
- `users` - Current connected user count
- `maxUsers` - Maximum server capacity
- `channels` - Number of voice channels configured
- `rawResponse` - Hex dump of first 100 bytes (for debugging)
- `rtt` - Round-trip time in milliseconds

---

## Known Limitations

### Protocol Documentation
- **No official specification** - Protocol is proprietary and undocumented
- **Reverse-engineered** - Implementation based on community knowledge and observed behavior
- **Version-dependent** - Different Ventrilo versions use different packet formats

### Status Query Support
- Some servers **do not respond** to TCP status queries
- Some servers require **authentication** before status disclosure
- Some servers use **UDP-only status queries** (not implemented here)
- Some servers have **custom/modified protocol** that doesn't match known patterns

### Parsing Reliability
- Response parsing uses **heuristics** and may fail on:
  - Heavily customized servers
  - Non-standard protocol implementations
  - Servers with binary data in names/descriptions
  - Servers with non-ASCII character encoding

### Voice Communication
- This implementation does **not support voice transmission**
- Only TCP control protocol is implemented
- UDP voice protocol is significantly more complex and requires:
  - Audio codec negotiation (Speex, GSM, etc.)
  - Real-time audio streaming
  - Jitter buffering and packet loss handling

---

## Error Handling

### Common Errors

| Error Message | Cause | Solution |
|--------------|-------|----------|
| `Host is required` | Missing `host` parameter | Provide valid hostname or IP |
| `Port must be between 1 and 65535` | Invalid port number | Use port in valid range (typically 3784) |
| `Connection timeout` | Server unreachable or not listening | Verify host/port, check firewall |
| `Empty response from server` | Server doesn't support TCP status | Server may be UDP-only or require auth |
| `Could not parse server response` | Unsupported protocol version | Check `rawResponse` for debugging |
| `Response timeout` | Server accepted connection but didn't respond | Increase timeout or check server health |

### Debugging Tips

1. **Check rawResponse hex dump** - Examine first 100 bytes of server response
2. **Test with known working server** - Verify implementation against reference
3. **Increase timeout** - Some servers take longer to respond (try 30000ms)
4. **Try UDP status query** - Some servers only respond via UDP (not implemented)
5. **Verify port** - Default is 3784, but servers can use custom ports
6. **Check authentication** - Some servers require login before status disclosure

---

## Example Usage

### Basic Connectivity Check

```bash
curl -X POST https://portofcall.example.com/api/ventrilo/connect \
  -H "Content-Type: application/json" \
  -d '{
    "host": "vent.example.com",
    "port": 3784,
    "timeout": 10000
  }'
```

### Query Server Status

```bash
curl -X POST https://portofcall.example.com/api/ventrilo/status \
  -H "Content-Type: application/json" \
  -d '{
    "host": "vent.example.com",
    "port": 3784,
    "timeout": 15000
  }'
```

### JavaScript/TypeScript Example

```typescript
async function queryVentriloServer(host: string, port = 3784) {
  const response = await fetch('/api/ventrilo/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host, port, timeout: 15000 })
  });

  const data = await response.json();

  if (data.success) {
    console.log(`Server: ${data.serverName}`);
    console.log(`Users: ${data.users}/${data.maxUsers}`);
    console.log(`Version: ${data.version}`);
    console.log(`Latency: ${data.rtt}ms`);
  } else {
    console.error(`Error: ${data.error}`);
  }
}

queryVentriloServer('vent.example.com');
```

---

## Testing

### Input Validation Tests

The implementation includes comprehensive input validation:

```typescript
// Empty host rejection
{ "host": "" }
// → 400 Bad Request: "Host is required"

// Invalid port (too high)
{ "host": "vent.example.com", "port": 99999 }
// → 400 Bad Request: "Port must be between 1 and 65535"

// Invalid port (zero)
{ "host": "vent.example.com", "port": 0 }
// → 400 Bad Request: "Port must be between 1 and 65535"
```

### Connection Tests

```typescript
// Default port inference
{ "host": "vent.example.com" }
// → Uses port 3784 automatically

// Timeout handling
{ "host": "unreachable-host.invalid", "timeout": 3000 }
// → Returns error after 3 seconds
```

### Live Server Testing

**Finding test servers:**
- Check gaming community forums for public Ventrilo servers
- Many retro/classic WoW private servers still run Ventrilo
- Some game server listing sites include Ventrilo servers

**Note:** Public Ventrilo servers are increasingly rare as Discord and TeamSpeak 3 have replaced them in most communities.

---

## Security Considerations

### Network Security
- **No encryption** - TCP status queries are plaintext
- **Server information exposure** - Anyone can query server status
- **Port scanning** - Can be used to discover Ventrilo servers
- **DDoS potential** - Rapid queries could be used for amplification attacks

### Authentication
- Status queries in this implementation are **unauthenticated**
- Some servers restrict status information to authenticated users
- Authentication requires extended protocol implementation (not included)

### Data Validation
- All user inputs (host, port) are validated
- Timeouts prevent infinite blocking
- Maximum response size (4KB) prevents memory exhaustion
- Port range validation prevents invalid socket operations

---

## Historical Context

### Ventrilo in Gaming History

**Peak Era (2004-2010):**
- Dominant voice chat solution for World of Warcraft raiding guilds
- Standard in competitive FPS games (Counter-Strike, Quake, etc.)
- Required for organized PvP and endgame content in many MMORPGs

**Decline (2010-2015):**
- Rise of in-game voice chat (e.g., WoW integrated voice)
- Competition from Mumble (open-source, lower latency)
- TeamSpeak 3 gained market share with better features

**Modern Era (2015-present):**
- Discord largely replaced Ventrilo/Mumble/TeamSpeak for gaming communities
- Ventrilo servers still exist in retro gaming and private server communities
- Nostalgia-driven usage in classic game revivals

### Why Monitor Ventrilo Servers?

1. **Retro Gaming Communities** - Classic WoW, EverQuest, vintage FPS servers
2. **Server Browser Implementations** - Build game-agnostic server lists
3. **Uptime Monitoring** - Track availability of community voice servers
4. **Historical Archival** - Document remaining Ventrilo infrastructure
5. **Protocol Research** - Study proprietary VoIP implementations

---

## References

### Community Resources
- **Ventrilo Official Site** - https://www.ventrilo.com (historical info, downloads)
- **Ventrilo Server List** - Various community-maintained server browsers (mostly defunct)
- **Gaming Forums** - Guild/clan forums often list Ventrilo connection info

### Technical References
- **Wireshark Protocol Analysis** - Capture Ventrilo traffic for protocol study
- **Open-Source Clients** - Mangler (Linux Ventrilo client) source code
- **Server Implementations** - No known open-source servers exist

### Related Protocols
- **Mumble** - Open-source alternative with public protocol documentation
- **TeamSpeak 3** - Commercial competitor with published API
- **Discord** - Modern successor with REST API and WebSocket gateway

---

## Troubleshooting

### Server Not Responding

**Symptom:** Connection succeeds but no response data

**Possible Causes:**
1. Server only supports UDP status queries
2. Server requires authentication before status disclosure
3. Server is running but not accepting new connections
4. Firewall blocking TCP traffic on port 3784

**Solutions:**
- Try connecting with official Ventrilo client to verify server is working
- Check server configuration for status query settings
- Verify port 3784 is open in firewall
- Contact server administrator for authentication requirements

### Parse Errors

**Symptom:** Response received but parsing fails

**Possible Causes:**
1. Unsupported Ventrilo version (v2.x, v4.x, custom)
2. Modified/patched server with non-standard protocol
3. Corrupted response due to network issues
4. Server returning error message instead of status

**Solutions:**
- Examine `rawResponse` hex dump for patterns
- Compare with known working server response
- Test with official Ventrilo client to verify expected behavior
- Capture traffic with Wireshark for detailed analysis

### Connection Failures

**Symptom:** Cannot establish TCP connection

**Possible Causes:**
1. Incorrect hostname or IP address
2. Server offline or unreachable
3. Firewall blocking outbound connections
4. DNS resolution failure
5. Non-standard port configuration

**Solutions:**
- Verify host resolves: `nslookup vent.example.com`
- Test connectivity: `telnet vent.example.com 3784`
- Check firewall rules for outbound TCP/3784
- Try IP address instead of hostname
- Confirm port with server administrator

---

## Future Enhancements

### Potential Improvements

1. **UDP Status Query Support** - Implement UDP-based status requests for servers that don't respond to TCP
2. **Multi-Version Protocol Support** - Add specific parsers for v2.1, v2.2, v2.3, v4.0
3. **Authentication** - Implement login flow for authenticated status queries
4. **Channel Listing** - Parse detailed channel tree structure from responses
5. **User Enumeration** - Extract individual user names and channels
6. **Voice Codec Detection** - Identify supported codecs (Speex, GSM, etc.)
7. **Server Ping/Pong** - Implement keep-alive mechanism for persistent connections

### Protocol Research Needs

- **Official Documentation** - No public specification exists
- **Version Mapping** - Catalog packet format differences across versions
- **Codec Analysis** - Document voice data encoding schemes
- **Authentication Schemes** - Reverse-engineer login cryptography
- **Extended Commands** - Map all control protocol commands beyond status query

---

## Conclusion

The Ventrilo protocol implementation provides basic TCP status query functionality for server monitoring and connectivity testing. While limited by the proprietary nature of the protocol and lack of official documentation, it successfully handles common use cases for gaming community server browsers and uptime monitoring.

**Best suited for:**
- Retro gaming community dashboards
- Historical server archival projects
- Basic connectivity testing
- Research into VoIP protocol design

**Not suitable for:**
- Voice communication (use official Ventrilo client or Discord)
- Production-critical monitoring (too many unknown protocol variations)
- Automated scraping at scale (respect server resources)

For modern voice chat needs, consider Discord, Mumble, or TeamSpeak 3, all of which have better documentation and official APIs.
