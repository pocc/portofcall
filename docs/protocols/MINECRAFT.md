# Minecraft Server List Ping (SLP) Protocol

**Status:** Deployed
**Implementation:** `/src/worker/minecraft.ts`
**Protocol Reference:** [wiki.vg/Server_List_Ping](https://wiki.vg/Server_List_Ping)
**Default Port:** 25565 (Java Edition), 19132 (Bedrock Edition, not supported)

## Overview

The Minecraft Server List Ping protocol is used by Minecraft clients to query a server's status without joining the game. It returns version information, MOTD (Message of the Day), player counts, and an optional favicon. This is the same protocol used by the multiplayer server browser in Minecraft Java Edition.

This implementation supports:
- Server status queries (version, MOTD, player count, favicon)
- Ping/pong latency measurement
- Protocol versions 47+ (Minecraft 1.8+)
- TCP fragmentation handling with proper length-prefixed packet reading

This implementation does NOT support:
- Bedrock Edition servers (use Raknet/UDP protocol)
- Legacy ping protocol (pre-1.7, `0xFE` handshake)
- RCON (admin commands, port 25575)
- Query protocol (detailed server info, port 25565 UDP)

## API Endpoints

### 1. Server Status Query

**Endpoint:** `POST /api/minecraft/status`

Performs a full Server List Ping to retrieve server metadata.

**Request Schema:**
```json
{
  "host": "mc.hypixel.net",
  "port": 25565,
  "timeout": 10000,
  "protocolVersion": 769
}
```

**Request Fields:**
- `host` (required, string): Server hostname or IP address. Validated against `/^[a-zA-Z0-9._-]+$/`.
- `port` (optional, number): Server port. Default: `25565`. Range: 1-65535.
- `timeout` (optional, number): Connection + query timeout in milliseconds. Default: `10000` (10s).
- `protocolVersion` (optional, number): Protocol version to send in handshake. Default: `769` (Minecraft 1.21.4). Servers respond to status requests regardless of version mismatch.

**Success Response (200):**
```json
{
  "success": true,
  "host": "mc.hypixel.net",
  "port": 25565,
  "version": {
    "name": "Requires MC 1.8 / 1.21",
    "protocol": 47
  },
  "players": {
    "max": 200000,
    "online": 95432,
    "sample": [
      { "name": "Player1", "id": "00000000-0000-0000-0000-000000000000" }
    ]
  },
  "description": "Hypixel Network [1.8-1.21]",
  "favicon": "data:image/png;base64,iVBORw0KGgoAAAANS...",
  "latency": 23,
  "rawJson": "{\"version\":{\"name\":\"Requires MC 1.8 / 1.21\",\"protocol\":47},...}"
}
```

**Response Fields:**
- `success` (boolean): Always `true` on success.
- `host` (string): Echoed from request.
- `port` (number): Echoed from request.
- `version` (object): Server version information.
  - `name` (string): Version string (e.g., "1.21.4", "Paper 1.20.1").
  - `protocol` (number): Protocol version number (e.g., 769 for 1.21.4).
- `players` (object): Player count information.
  - `max` (number): Maximum player slots.
  - `online` (number): Current player count.
  - `sample` (array, optional): Sample of online players. Server may omit or hide this.
- `description` (string): Server MOTD (Message of the Day). Converted from JSON Chat Component to plain text.
- `favicon` (string, optional): Server icon as data URI (`data:image/png;base64,...`). 64x64 PNG.
- `latency` (number, optional): Round-trip ping/pong latency in milliseconds. Only present if ping/pong succeeds.
- `rawJson` (string): Raw JSON response from server (for debugging).

**Error Response (400 - Validation Error):**
```json
{
  "success": false,
  "error": "Host is required"
}
```

**Error Response (403 - Cloudflare Detected):**
```json
{
  "success": false,
  "error": "...",
  "isCloudflare": true
}
```

**Error Response (500 - Connection/Protocol Error):**
```json
{
  "success": false,
  "error": "Connection timeout"
}
```

**Error Response (502 - Unexpected Packet):**
```json
{
  "success": false,
  "error": "Unexpected packet ID: 0xff"
}
```

### 2. Ping Latency Measurement

**Endpoint:** `POST /api/minecraft/ping`

Measures TCP handshake latency and Minecraft ping/pong latency without returning full server info.

**Request Schema:**
```json
{
  "host": "mc.hypixel.net",
  "port": 25565,
  "timeout": 10000,
  "protocolVersion": 769
}
```

Request fields are identical to `/status`.

**Success Response (200):**
```json
{
  "success": true,
  "host": "mc.hypixel.net",
  "port": 25565,
  "tcpLatency": 12,
  "pingLatency": 23,
  "pongValid": true
}
```

**Response Fields:**
- `success` (boolean): Always `true` on success.
- `host` (string): Echoed from request.
- `port` (number): Echoed from request.
- `tcpLatency` (number): Time to establish TCP connection in milliseconds.
- `pingLatency` (number): Round-trip time for Minecraft ping/pong packet in milliseconds.
- `pongValid` (boolean): Whether the server echoed the correct payload. `false` indicates protocol violation.

**Error Responses:**
Same as `/status` endpoint (400, 403, 500).

## Protocol Flow

```
Client                                    Server
  |                                         |
  |--- TCP Handshake (SYN/SYN-ACK/ACK) ---->|  <-- tcpLatency measured here
  |                                         |
  |--- Handshake Packet (0x00) ------------>|
  |    [Protocol Ver, Host, Port, State=1]  |
  |                                         |
  |--- Status Request (0x00) -------------->|
  |    [Empty payload]                      |
  |                                         |
  |<-- Status Response (0x00) --------------|
  |    [JSON string: version, players, MOTD]|
  |                                         |
  |--- Ping (0x01) ------------------------>|
  |    [int64 payload]                      |
  |                                         |
  |<-- Pong (0x01) -------------------------|  <-- pingLatency measured here
  |    [echoed int64 payload]               |
  |                                         |
  |--- TCP Close (FIN) -------------------->|
  |                                         |
```

### Packet Structure

All packets use the same framing:

```
[VarInt Length][VarInt PacketID][Payload...]
```

- **VarInt Length**: Length of `PacketID + Payload` in bytes (1-5 bytes).
- **VarInt PacketID**: Packet type identifier (1-5 bytes).
- **Payload**: Packet-specific data (variable length).

### VarInt Encoding

Variable-length integer encoding (1-5 bytes), identical to Protocol Buffers varints:

- Each byte stores 7 bits of data + 1 continuation bit (MSB).
- If MSB is set (`byte & 0x80`), read the next byte.
- Maximum value: 2^32-1 (5 bytes).

**Example:** Value `300` (0x012C)
```
Byte 1: 0xAC (10101100) → bits 0-6 = 0x2C (44), MSB set
Byte 2: 0x02 (00000010) → bits 7-13 = 0x02 (2), MSB clear
Result: 44 + (2 << 7) = 44 + 256 = 300
```

### Handshake Packet (0x00)

Sent first to indicate protocol version and target server.

**Payload:**
```
[VarInt ProtocolVersion]  // e.g., 769 for 1.21.4
[String ServerAddress]    // [VarInt Length][UTF-8 bytes]
[Unsigned Short Port]     // 2 bytes, big-endian
[VarInt NextState]        // 1 = Status, 2 = Login
```

**Example (mc.hypixel.net:25565, protocol 769):**
```
Length: 0x15 (21 bytes)
PacketID: 0x00
ProtocolVersion: 0x81 0x06 (769 as VarInt)
ServerAddress: 0x0E "mc.hypixel.net" (14 bytes string)
Port: 0x63DD (25565 as big-endian short)
NextState: 0x01 (Status)
```

### Status Request Packet (0x00)

Requests server status. No payload.

**Payload:** Empty (0 bytes)

**Full Packet:**
```
Length: 0x01 (1 byte: PacketID only)
PacketID: 0x00
```

### Status Response Packet (0x00)

Server's JSON response with metadata.

**Payload:**
```
[VarInt JSONLength][UTF-8 JSON string]
```

**JSON Schema:**
```json
{
  "version": {
    "name": "1.21.4",
    "protocol": 769
  },
  "players": {
    "max": 100,
    "online": 50,
    "sample": [
      { "name": "Player1", "id": "uuid-here" }
    ]
  },
  "description": {
    "text": "A Minecraft Server"
  },
  "favicon": "data:image/png;base64,..."
}
```

**JSON Fields:**
- `version` (object, required): Server version.
- `players` (object, required): Player counts.
- `description` (string | object, required): MOTD (plain string or Chat Component).
- `favicon` (string, optional): Data URI with base64-encoded 64x64 PNG.
- `enforcesSecureChat` (boolean, optional): 1.19+ chat signing requirement.
- `previewsChat` (boolean, optional): 1.19+ chat preview feature.

### Ping Packet (0x01)

Measures latency. Payload is typically current timestamp.

**Payload:**
```
[int64 payload]  // 8 bytes, big-endian
```

**Example (payload = 1234567890):**
```
Length: 0x09 (9 bytes: 1 byte PacketID + 8 bytes payload)
PacketID: 0x01
Payload: 0x00 0x00 0x00 0x49 0x96 0x02 0xD2 (1234567890 as big-endian int64)
```

### Pong Packet (0x01)

Server echoes the same payload received in the Ping packet.

**Payload:**
```
[int64 echoed_payload]  // Must match Ping payload exactly
```

## Chat Component Format

The `description` field uses Minecraft's JSON Chat Component format.

**Simple String:**
```json
"A Minecraft Server"
```

**Text Object:**
```json
{
  "text": "Welcome to ",
  "extra": [
    { "text": "My Server", "bold": true, "color": "gold" }
  ]
}
```

**Translation Key:**
```json
{
  "translate": "multiplayer.disconnect.kicked"
}
```

The implementation extracts plain text by:
1. Using `text` field if present.
2. Using `translate` field as fallback.
3. Concatenating `extra` array elements.
4. Stripping all formatting codes.

**Reference:** [wiki.vg/Chat](https://wiki.vg/Chat)

## Protocol Version History

| Version | Protocol | Release Date |
|---------|----------|--------------|
| 1.21.4 | 769 | Dec 2024 |
| 1.21.1 | 767 | Jun 2024 |
| 1.20.4 | 765 | Dec 2023 |
| 1.20 | 763 | Jun 2023 |
| 1.19.4 | 762 | Mar 2023 |
| 1.19 | 759 | Jun 2022 |
| 1.18.2 | 758 | Feb 2022 |
| 1.17 | 755 | Jun 2021 |
| 1.16.5 | 754 | Jan 2021 |
| 1.15 | 573 | Dec 2019 |
| 1.14 | 477 | Apr 2019 |
| 1.13 | 393 | Jul 2018 |
| 1.12 | 335 | Jun 2017 |
| 1.11 | 315 | Nov 2016 |
| 1.10 | 210 | Jun 2016 |
| 1.9 | 107 | Feb 2016 |
| 1.8 | 47 | Sep 2014 |

**Full list:** [wiki.vg/Protocol_version_numbers](https://wiki.vg/Protocol_version_numbers)

## Known Quirks and Limitations

### 1. VarInt Overflow Protection (Fixed)

**Issue:** JavaScript's bitwise operations are limited to 32 bits. The protocol allows VarInts up to 5 bytes (2^35-1), but values above 2^31-1 would overflow.

**Fix:** Shift limit reduced from 35 to 32 bits, rejecting VarInts that require more than 5 bytes.

**Impact:** Prevents overflow on malformed packets. Legitimate Minecraft packets never exceed 2^31-1 in length.

### 2. Packet Length Validation (Added)

**Issue:** Original implementation didn't validate packet length VarInt, allowing a malicious server to claim a 2GB packet and cause memory exhaustion.

**Fix:** Added `MAX_PACKET_LENGTH = 2MB` validation. Minecraft SLP packets are typically <10KB (largest: status response with favicon ~10KB).

**Impact:** Prevents DoS attacks from malicious servers.

### 3. Pong Payload Verification (Fixed)

**Issue:** Original implementation checked `pongId === 0x01` but never verified the echoed int64 payload matched the ping.

**Fix:** Added payload verification using `DataView.getBigInt64()` to compare sent vs received int64.

**Impact:** Detects servers that violate the protocol by not echoing the payload correctly.

### 4. Method Validation Consistency (Fixed)

**Issue:** Non-POST requests returned plain text `"Method not allowed"` instead of JSON with `success: false`.

**Fix:** Both endpoints now return JSON error responses for all failure cases.

**Impact:** API clients can reliably parse errors as JSON.

### 5. No Legacy Protocol Support

The implementation does NOT support pre-1.7 servers that use the legacy ping protocol (starting with `0xFE 0x01`).

**Workaround:** Use protocol version 47+ (Minecraft 1.8+). Modern servers (1.8-1.21) all support the current SLP protocol.

### 6. No SRV Record Resolution

The implementation does NOT perform DNS SRV record lookups (e.g., `_minecraft._tcp.example.com`).

**Workaround:** Resolve SRV records client-side and pass the resolved hostname + port.

**Example:**
```bash
# Resolve SRV record
dig +short SRV _minecraft._tcp.example.com
# Output: 0 5 25565 mc.example.com.

# Query resolved hostname
curl -X POST https://portofcall.ross.gg/api/minecraft/status \
  -H "Content-Type: application/json" \
  -d '{"host":"mc.example.com","port":25565}'
```

### 7. No Bedrock Edition Support

Bedrock Edition servers use the Raknet protocol (UDP port 19132), which is incompatible with Java Edition SLP.

**Detection:** Bedrock servers don't respond to TCP connections on port 25565.

### 8. No Query Protocol Support

The Query protocol (UDP port 25565, enabled with `enable-query=true` in `server.properties`) provides more detailed information (plugins, world name, game mode) but is not implemented.

**Reference:** [wiki.vg/Query](https://wiki.vg/Query)

### 9. Cloudflare Detection Behavior

The implementation checks if the hostname resolves to a Cloudflare IP and rejects the request with a 403 error.

**Rationale:** Cloudflare proxies HTTP/HTTPS traffic but does NOT proxy arbitrary TCP connections (like Minecraft SLP).

**Impact:** Servers behind Cloudflare must be queried using the origin IP, not the Cloudflare proxy hostname.

### 10. Favicon Size Not Validated

The protocol doesn't enforce a favicon size limit. Large favicons (>10KB base64) can inflate response size.

**Mitigation:** Implementation limits total packet size to 2MB, which includes the favicon.

### 11. Player Sample Privacy

Servers may omit the `players.sample` array to hide online player names. This is a server-side privacy feature.

**Detection:** Check if `players.sample` is `undefined` or an empty array.

### 12. MOTD Formatting Loss

The implementation strips all formatting codes (colors, bold, italic, etc.) from Chat Components and returns plain text.

**Workaround:** Use `rawJson` field to parse the full Chat Component with formatting.

### 13. Protocol Version Ignored

The `protocolVersion` parameter is sent in the handshake but doesn't affect the status response. Servers return status regardless of version mismatch.

**Behavior:** Version mismatch is indicated in the response's `version.protocol` field, not as an error.

### 14. No Connection Pooling

Each request opens a new TCP connection. The protocol supports persistent connections, but the implementation doesn't reuse them.

**Impact:** Higher latency for repeated queries to the same server (additional TCP handshake per request).

### 15. Timeout Shared Between TLS and Query

The `timeout` parameter applies to the entire request (TCP connect + handshake + status + ping). Slow connections may timeout before completing ping/pong.

**Workaround:** Increase timeout for slow/distant servers (e.g., `"timeout": 20000` for 20s).

## Example Usage

### Query a Public Server

```bash
curl -X POST https://portofcall.ross.gg/api/minecraft/status \
  -H "Content-Type: application/json" \
  -d '{
    "host": "mc.hypixel.net",
    "port": 25565,
    "timeout": 10000
  }' | jq
```

**Response:**
```json
{
  "success": true,
  "host": "mc.hypixel.net",
  "port": 25565,
  "version": {
    "name": "Requires MC 1.8 / 1.21",
    "protocol": 47
  },
  "players": {
    "max": 200000,
    "online": 95432
  },
  "description": "Hypixel Network [1.8-1.21]",
  "latency": 23
}
```

### Measure Ping Latency

```bash
curl -X POST https://portofcall.ross.gg/api/minecraft/ping \
  -H "Content-Type: application/json" \
  -d '{
    "host": "mc.hypixel.net",
    "port": 25565
  }' | jq
```

**Response:**
```json
{
  "success": true,
  "host": "mc.hypixel.net",
  "port": 25565,
  "tcpLatency": 12,
  "pingLatency": 23,
  "pongValid": true
}
```

### Query with Custom Protocol Version

```bash
curl -X POST https://portofcall.ross.gg/api/minecraft/status \
  -H "Content-Type: application/json" \
  -d '{
    "host": "play.example.com",
    "port": 25565,
    "protocolVersion": 47
  }' | jq
```

### Extract Player Count

```bash
curl -s -X POST https://portofcall.ross.gg/api/minecraft/status \
  -H "Content-Type: application/json" \
  -d '{"host":"mc.hypixel.net"}' | jq '.players.online'
```

**Output:**
```
95432
```

### Monitor Server Uptime

```bash
while true; do
  STATUS=$(curl -s -X POST https://portofcall.ross.gg/api/minecraft/status \
    -H "Content-Type: application/json" \
    -d '{"host":"mc.example.com","timeout":5000}')

  if echo "$STATUS" | jq -e '.success' > /dev/null; then
    echo "[$(date)] Server online: $(echo "$STATUS" | jq -r '.players.online') players"
  else
    echo "[$(date)] Server offline: $(echo "$STATUS" | jq -r '.error')"
  fi

  sleep 60
done
```

### Check Version Compatibility

```bash
curl -s -X POST https://portofcall.ross.gg/api/minecraft/status \
  -H "Content-Type: application/json" \
  -d '{"host":"mc.example.com"}' | \
jq 'if .version.protocol >= 763 then "1.20+ compatible" else "1.19 or older" end'
```

### Download Server Favicon

```bash
RESPONSE=$(curl -s -X POST https://portofcall.ross.gg/api/minecraft/status \
  -H "Content-Type: application/json" \
  -d '{"host":"mc.hypixel.net"}')

echo "$RESPONSE" | jq -r '.favicon' | \
  sed 's/data:image\/png;base64,//' | \
  base64 -d > favicon.png
```

## Comparison: SLP vs RCON vs Query

| Feature | Server List Ping (SLP) | RCON | Query |
|---------|------------------------|------|-------|
| **Protocol** | TCP, port 25565 | TCP, port 25575 | UDP, port 25565 |
| **Purpose** | Server status, player count | Admin commands | Detailed server info |
| **Authentication** | None (public) | Password required | None (if enabled) |
| **Returns** | Version, MOTD, players, favicon | Command output | Plugins, world, game mode |
| **Client** | Multiplayer browser | Admin tools | Third-party tools |
| **Enable Setting** | Always on | `enable-rcon=true` | `enable-query=true` |
| **Security** | Public, read-only | Password-protected | Public, read-only |
| **Implementation** | `minecraft.ts` (this) | `minecraft_rcon.ts` | Not implemented |

**Use Cases:**
- **SLP**: Server lists, uptime monitoring, player count graphs.
- **RCON**: Server administration, command execution, mod management.
- **Query**: Plugin lists, world seed, game rules (if enabled).

## Security Considerations

### 1. Hostname Validation

The implementation validates hostnames against `/^[a-zA-Z0-9._-]+$/` to prevent command injection.

**Blocked:** `host; rm -rf /`, `192.168.1.1; DROP TABLE users`

### 2. Port Range Validation

Ports are validated to 1-65535 to prevent invalid socket connections.

### 3. Cloudflare Detection

The implementation detects Cloudflare-proxied hostnames and rejects them to prevent wasted requests (Cloudflare doesn't proxy TCP connections).

### 4. Memory Exhaustion Protection

Packet length is limited to 2MB to prevent malicious servers from causing OOM errors.

### 5. VarInt Overflow Protection

VarInt decoding limits shifts to 32 bits to prevent integer overflow.

### 6. Timeout Enforcement

All socket operations are wrapped in a timeout promise to prevent indefinite hangs.

### 7. No Server Trust

The implementation doesn't trust server responses. Malformed packets result in errors, not crashes.

## Troubleshooting

### Error: "Connection timeout"

**Cause:** Server is offline, firewall is blocking port 25565, or network latency exceeds timeout.

**Fix:**
- Verify server is online using `nc -zv <host> 25565` or `telnet <host> 25565`.
- Increase timeout: `"timeout": 20000` (20 seconds).
- Check firewall rules on server.

### Error: "Host is required"

**Cause:** Missing or empty `host` field in request.

**Fix:** Provide a valid hostname or IP address.

### Error: "Port must be between 1 and 65535"

**Cause:** Invalid port number (e.g., 0, 99999, negative).

**Fix:** Use a valid port (typically 25565).

### Error: "Host contains invalid characters"

**Cause:** Hostname contains characters outside `[a-zA-Z0-9._-]` (e.g., spaces, semicolons).

**Fix:** Use a valid hostname or IP address.

### Error: "Unexpected packet ID: 0x02"

**Cause:** Server sent a login packet instead of status response. This happens if `NextState` is set to 2 (Login) instead of 1 (Status).

**Fix:** This is a bug in the implementation (not present in current code). Verify handshake sends `NextState=1`.

### Error: "VarInt too large"

**Cause:** Server sent a malformed VarInt with >5 bytes or MSB set on all 5 bytes.

**Fix:** Server is likely malicious or buggy. Try a different server.

### Error: "Packet length X exceeds maximum 2097152 bytes"

**Cause:** Server claimed a packet length >2MB, which is abnormal for Minecraft SLP.

**Fix:** Server is likely malicious. Legitimate packets are <10KB.

### Success: false, latency: undefined

**Cause:** Ping/pong exchange failed (server didn't respond, timeout, or payload mismatch).

**Impact:** Status response is still valid, but latency measurement is unavailable.

**Fix:** Not critical. Latency is optional. If latency is required, use `/ping` endpoint.

### Success: false, isCloudflare: true

**Cause:** Hostname resolves to a Cloudflare IP. Cloudflare doesn't proxy Minecraft traffic.

**Fix:** Use the server's origin IP instead of the Cloudflare-proxied hostname.

**Example:**
```bash
# Query Cloudflare-proxied hostname (will fail)
curl -X POST .../minecraft/status -d '{"host":"mc.example.com"}'

# Query origin IP (will succeed)
curl -X POST .../minecraft/status -d '{"host":"123.45.67.89"}'
```

## References

- **Protocol Spec:** [wiki.vg/Server_List_Ping](https://wiki.vg/Server_List_Ping)
- **Protocol Version Numbers:** [wiki.vg/Protocol_version_numbers](https://wiki.vg/Protocol_version_numbers)
- **Chat Component Format:** [wiki.vg/Chat](https://wiki.vg/Chat)
- **Data Types:** [wiki.vg/Protocol#Data_types](https://wiki.vg/Protocol#Data_types)
- **Query Protocol:** [wiki.vg/Query](https://wiki.vg/Query)
- **RCON Protocol:** [wiki.vg/RCON](https://wiki.vg/RCON)
- **Raknet (Bedrock):** [wiki.vg/Raknet_Protocol](https://wiki.vg/Raknet_Protocol)
