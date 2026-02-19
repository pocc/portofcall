# Mumble Protocol — Power-User Documentation

## Overview

**Mumble** is a free, open-source, low-latency voice over IP (VoIP) application designed for group communication. The protocol uses TLS-wrapped TCP for control messages and OCB-AES128 encrypted UDP for voice data (UDP not available in Cloudflare Workers).

- **Default Port**: 64738 (both TCP and UDP)
- **Transport**: TLS/TCP for control, UDP for voice
- **Encoding**: Protocol Buffers (protobuf) for message payloads
- **Framing**: 6-byte header (2-byte type + 4-byte length) + protobuf payload

## Protocol Architecture

### Message Frame Structure

Every Mumble TCP message uses this wire format:

```
┌─────────────┬──────────────┬────────────────────┐
│ Type (BE)   │ Length (BE)  │ Protobuf Payload   │
│ 2 bytes     │ 4 bytes      │ variable length    │
└─────────────┴──────────────┴────────────────────┘
```

- **Type**: Big-endian uint16 (message type ID)
- **Length**: Big-endian uint32 (payload byte count)
- **Payload**: Protobuf-encoded message

### Message Types

| Type | Name           | Direction      | Description                                    |
|------|----------------|----------------|------------------------------------------------|
| 0    | Version        | Bidirectional  | Version exchange (initial handshake)           |
| 1    | UDPTunnel      | Bidirectional  | UDP voice data tunneled over TCP               |
| 2    | Authenticate   | Client→Server  | Username/password/token authentication         |
| 3    | Ping           | Bidirectional  | Keepalive (required every 30 seconds)          |
| 4    | Reject         | Server→Client  | Authentication rejection with reason           |
| 5    | ServerSync     | Server→Client  | Final sync message (marks auth complete)       |
| 6    | ChannelRemove  | Server→Client  | Channel deleted                                |
| 7    | ChannelState   | Bidirectional  | Channel metadata (ID, parent, name, desc)      |
| 8    | UserRemove     | Server→Client  | User disconnected                              |
| 9    | UserState      | Bidirectional  | User metadata (session, name, channel, muted)  |
| 10   | BanList        | Bidirectional  | Server ban list management                     |
| 11   | TextMessage    | Bidirectional  | Chat message (channel or private)              |
| 12   | PermissionDenied | Server→Client | Access denied with reason                      |
| 13   | ACL            | Bidirectional  | Access control list for channel                |
| 14   | QueryUsers     | Client→Server  | Request user info by username                  |
| 15   | CryptSetup     | Server→Client  | OCB-AES128 key exchange for UDP encryption     |
| 16   | ContextActionModify | Bidirectional | Custom context menu actions              |
| 17   | ContextAction  | Client→Server  | Trigger custom context action                  |
| 18   | UserList       | Bidirectional  | Registered user list management                |
| 19   | VoiceTarget    | Client→Server  | Define whisper/shout targets                   |
| 20   | PermissionQuery | Client→Server | Query permissions for channel                  |
| 21   | CodecVersion   | Bidirectional  | Audio codec negotiation (Opus, CELT)           |
| 22   | UserStats      | Bidirectional  | Detailed user statistics                       |
| 23   | RequestBlob    | Client→Server  | Request large data (texture, comment)          |
| 24   | ServerConfig   | Server→Client  | Server configuration (bandwidth, message len)  |
| 25   | SuggestConfig  | Server→Client  | Suggest client configuration                   |

## Connection Flow

```
Client                                           Server
  │                                                │
  ├─────────── TLS Handshake ───────────────────→ │
  │                                                │
  ├── Version (type 0) ──────────────────────────→ │
  │ ←──────────────────────── Version (type 0) ───┤
  │                                                │
  ├── Authenticate (type 2) ─────────────────────→ │
  │                                                │
  │ ←────────────────── CryptSetup (type 15) ─────┤
  │ ←───────────────── CodecVersion (type 21) ────┤
  │ ←──────────────── ChannelState (type 7) ──────┤  (multiple)
  │ ←────────────────── UserState (type 9) ───────┤  (multiple)
  │ ←───────────────── ServerSync (type 5) ───────┤  AUTH COMPLETE
  │                                                │
  ├── Ping (type 3) ─────────────────────────────→ │  (every 30s)
  │ ←────────────────────────── Ping (type 3) ────┤
  │                                                │
  ├── TextMessage (type 11) ─────────────────────→ │
  │                                                │
```

### Critical Protocol Requirements

1. **TLS Required**: All control traffic must use TLS (port 64738)
2. **Version Exchange**: Must be first message sent by client
3. **Ping Keepalive**: Client must send Ping every 30 seconds or will be disconnected
4. **ServerSync Marker**: Authentication is complete only after receiving ServerSync (type 5)
5. **Byte Order**: All multi-byte integers in frame header use big-endian (network byte order)

## Protobuf Message Definitions

### Version (type 0)

```protobuf
message Version {
  optional uint32 version_v1 = 1;     // Version: (major << 16) | (minor << 8) | patch
  optional string release = 2;        // Human-readable version string (e.g., "1.5.0")
  optional string os = 3;             // Operating system (e.g., "Linux", "Windows")
  optional string os_version = 4;     // OS version string
  optional uint64 version_v2 = 5;     // Extended version (future use)
}
```

**Example**: Version 1.5.0 = `(1 << 16) | (5 << 8) | 0` = `0x010500` = 66816

### Authenticate (type 2)

```protobuf
message Authenticate {
  optional string username = 1;       // Username (required for authentication)
  optional string password = 2;       // Password (required if server/account protected)
  repeated string tokens = 3;         // Access tokens (for privileged channel access)
  repeated int32 celt_versions = 4;   // Supported CELT codec versions (deprecated)
  optional bool opus = 5 [default = false];  // Opus codec support (recommended: true)
  optional int32 client_type = 6 [default = 0];  // 0=normal, 1=bot
}
```

**Notes**:
- `username` is required
- `password` only needed if server requires authentication
- `opus = true` is recommended for modern servers (better quality than CELT)
- Empty `tokens` array is valid for guest access

### Ping (type 3)

```protobuf
message Ping {
  optional uint64 timestamp = 1;      // Client timestamp (milliseconds) for RTT measurement
  optional uint32 good = 2;           // UDP packets received successfully
  optional uint32 late = 3;           // UDP packets received out of order
  optional uint32 lost = 4;           // UDP packets lost
  optional uint32 resync = 5;         // UDP resync count
  optional uint32 udp_packets = 6;    // Total UDP packets sent
  optional uint32 tcp_packets = 7;    // Total TCP packets sent
  optional float udp_ping_avg = 8;    // Average UDP ping (ms)
  optional float udp_ping_var = 9;    // UDP ping variance (ms²)
  optional float tcp_ping_avg = 10;   // Average TCP ping (ms)
  optional float tcp_ping_var = 11;   // TCP ping variance (ms²)
}
```

**RTT Calculation**:
1. Client sends Ping with `timestamp = Date.now()`
2. Server echoes Ping back
3. Client calculates RTT: `Date.now() - timestamp`

### Reject (type 4)

```protobuf
enum RejectType {
  None = 0;
  WrongVersion = 1;        // Client version incompatible
  InvalidUsername = 2;     // Username format invalid
  WrongUserPW = 3;         // Incorrect password
  WrongServerPW = 4;       // Incorrect server password
  UsernameInUse = 5;       // Username already connected
  ServerFull = 6;          // Max users reached
  NoCertificate = 7;       // Client certificate required
  AuthenticatorFail = 8;   // External authenticator rejected
}

message Reject {
  optional RejectType type = 1;
  optional string reason = 2;          // Human-readable rejection reason
}
```

### ServerSync (type 5)

```protobuf
message ServerSync {
  optional uint32 session = 1;         // Client's session ID (unique per connection)
  optional uint32 max_bandwidth = 2;   // Max bandwidth (bytes/s) client should use
  optional string welcome_text = 3;    // Server welcome message (may contain HTML)
  optional uint64 permissions = 4;     // User permissions in root channel
}
```

**Authentication Complete**: Client is fully authenticated when ServerSync is received.

### ChannelState (type 7)

```protobuf
message ChannelState {
  optional uint32 channel_id = 1;      // Unique channel ID
  optional uint32 parent = 2;          // Parent channel ID (omitted for root channel)
  optional string name = 3;            // Channel name
  repeated uint32 links = 4;           // IDs of linked channels
  optional string description = 5;     // Channel description (may contain HTML)
  repeated uint32 links_add = 6;       // Add links to these channels
  repeated uint32 links_remove = 7;    // Remove links to these channels
  optional bool temporary = 8 [default = false];  // Temporary channel (deleted when empty)
  optional int32 position = 9 [default = 0];      // Sort position
  optional bytes description_hash = 10;           // SHA1 hash of description
  optional uint32 max_users = 11;                 // Max users allowed (0 = unlimited)
  optional bool is_enter_restricted = 12;         // Enter permission required
  optional bool can_enter = 13;                   // Current user can enter
}
```

**Notes**:
- Channel ID 0 is the root channel
- `parent` field absent for root channel
- `temporary = true` channels are deleted when last user leaves

### UserState (type 9)

```protobuf
message UserState {
  optional uint32 session = 1;         // Unique session ID (assigned by server)
  optional uint32 actor = 2;           // Session ID of user who caused this state change
  optional string name = 3;            // Username
  optional uint32 user_id = 4;         // Registered user ID (omitted for guests)
  optional uint32 channel_id = 5;      // Current channel ID
  optional bool mute = 6;              // Server-muted
  optional bool deaf = 7;              // Server-deafened (implies mute)
  optional bool suppress = 8;          // Voice suppressed by server
  optional bool self_mute = 9;         // Self-muted by user
  optional bool self_deaf = 10;        // Self-deafened by user (implies self_mute)
  optional bytes texture = 11;         // User avatar image (JPEG/PNG)
  optional bytes plugin_context = 12;  // Positional audio plugin context
  optional string plugin_identity = 13; // Positional audio identity
  optional string comment = 14;        // User comment (may contain HTML)
  optional string hash = 15;           // Certificate hash
  optional bytes comment_hash = 16;    // SHA1 hash of comment
  optional bytes texture_hash = 17;    // SHA1 hash of texture
  optional bool priority_speaker = 18; // Priority speaker status
  optional bool recording = 19;        // User is recording
  repeated string temporary_access_tokens = 20;  // Temporary access tokens
  repeated uint32 listening_channel_add = 21;    // Add listening to these channels
  repeated uint32 listening_channel_remove = 22; // Stop listening to these channels
}
```

**Notes**:
- `session` is unique per connection (not persistent across reconnects)
- `user_id` only present for registered users (guests have no user_id)
- `deaf = true` automatically implies `mute = true`
- `self_deaf = true` automatically implies `self_mute = true`

### TextMessage (type 11)

```protobuf
message TextMessage {
  optional uint32 actor = 1;           // Session ID of sender
  repeated uint32 session = 2;         // Target user session IDs (private message)
  repeated uint32 channel_id = 3;      // Target channel IDs (channel message)
  repeated uint32 tree_id = 4;         // Target channel trees (recursive send)
  required string message = 5;         // Message content (may contain HTML)
}
```

**Routing**:
- **Private message**: Set `session` (one or more recipients)
- **Channel message**: Set `channel_id` (current channel)
- **Tree message**: Set `tree_id` (channel and all subchannels)

### CryptSetup (type 15)

```protobuf
message CryptSetup {
  optional bytes key = 1;              // AES-128 key (16 bytes)
  optional bytes client_nonce = 2;     // Client nonce (16 bytes)
  optional bytes server_nonce = 3;     // Server nonce (16 bytes)
}
```

**Purpose**: Establish OCB-AES128 encryption for UDP voice packets (not used for TCP).

### CodecVersion (type 21)

```protobuf
message CodecVersion {
  required int32 alpha = 1;            // Preferred codec version (negative for Opus)
  required int32 beta = 2;             // Alternate codec version
  required bool prefer_alpha = 3 [default = true];
  optional bool opus = 4 [default = false];  // Opus support
}
```

**Notes**:
- Modern servers use Opus (better quality, lower latency)
- CELT is legacy codec (alpha/beta refer to CELT version IDs)
- `alpha = -2147483637` typically indicates Opus

### ServerConfig (type 24)

```protobuf
message ServerConfig {
  optional uint32 max_bandwidth = 1;   // Max bandwidth per user (bytes/s)
  optional string welcome_text = 2;    // Welcome message (HTML allowed)
  optional bool allow_html = 3;        // HTML allowed in messages
  optional uint32 message_length = 4;  // Max message length (characters)
  optional uint32 image_message_length = 5;  // Max image message length (bytes)
  optional uint32 max_users = 6;       // Max users allowed on server
  optional bool recording_allowed = 7; // Recording permitted
}
```

## Implementation Notes

### Protobuf Wire Format

Mumble uses standard Protocol Buffers encoding:

**Wire Types**:
- `0`: Varint (int32, int64, uint32, uint64, bool)
- `1`: 64-bit (fixed64, double)
- `2`: Length-delimited (string, bytes, embedded messages)
- `5`: 32-bit (fixed32, float)

**Field Encoding**: `(field_number << 3) | wire_type`

**Varint Encoding**: 7 bits per byte, MSB = continuation bit
- Example: `300` → `0xAC 0x02` (10101100 00000010)

### JavaScript Integer Safety

**Issue**: JavaScript bitwise operations treat operands as signed 32-bit integers.

**Solutions**:
- Use `>>> 0` to convert to unsigned 32-bit
- Use `Math.floor(value / 128)` instead of `value >>> 7` for values > 2^32
- For big-endian multi-byte reads, use `DataView.getUint16/getUint32`

**Example Bug**:
```javascript
// WRONG: Can produce negative value if high bit set
const msgType = (buf[0] << 8) | buf[1];

// CORRECT: Force unsigned
const msgType = ((buf[0] << 8) | buf[1]) >>> 0;
```

### Timestamp Handling

**Ping Timestamp**: Use `Date.now()` (milliseconds since Unix epoch)
- Server echoes timestamp back for RTT calculation
- JavaScript `Number` safely handles timestamps up to ~287,396 years

## API Endpoints

### POST /api/mumble/probe

**Description**: TLS connect + version exchange (minimal probe)

**Request Body**:
```json
{
  "host": "mumble.example.com",
  "port": 64738,
  "timeout": 10000,
  "tls": true
}
```

**Response**:
```json
{
  "success": true,
  "host": "mumble.example.com",
  "port": 64738,
  "tls": true,
  "rtt": 145,
  "versionHex": "0x010500",
  "version": "1.5.0",
  "release": "1.5.517",
  "os": "Linux",
  "osVersion": "5.10.0-23-amd64",
  "versionV2": 16843009,
  "msgTypes": ["Version"]
}
```

### POST /api/mumble/version

**Description**: Alias for `/api/mumble/probe`

### POST /api/mumble/ping

**Description**: Send Version + Ping, measure RTT

**Request Body**:
```json
{
  "host": "mumble.example.com",
  "port": 64738,
  "timeout": 8000,
  "tls": true
}
```

**Response**:
```json
{
  "success": true,
  "host": "mumble.example.com",
  "port": 64738,
  "tls": true,
  "rtt": 152,
  "gotVersion": true,
  "gotPong": true,
  "msgTypes": ["Version", "Ping"]
}
```

### POST /api/mumble/auth

**Description**: Full authentication + channel/user enumeration

**Request Body**:
```json
{
  "host": "mumble.example.com",
  "port": 64738,
  "username": "testuser",
  "password": "secret",
  "timeout": 12000,
  "tls": true
}
```

**Success Response**:
```json
{
  "success": true,
  "host": "mumble.example.com",
  "port": 64738,
  "tls": true,
  "username": "testuser",
  "authenticated": true,
  "session": 42,
  "maxBandwidth": 72000,
  "welcomeText": "Welcome to the server!",
  "channels": [
    { "id": 0, "name": "Root" },
    { "id": 1, "parent": 0, "name": "General" },
    { "id": 2, "parent": 0, "name": "Gaming" }
  ],
  "users": [
    { "session": 42, "name": "testuser", "channel": 0, "muted": false, "deafened": false },
    { "session": 15, "name": "alice", "channel": 1, "muted": false, "deafened": false }
  ],
  "messageCount": 18
}
```

**Rejection Response**:
```json
{
  "success": true,
  "host": "mumble.example.com",
  "port": 64738,
  "tls": true,
  "username": "testuser",
  "authenticated": false,
  "rejectionReason": "Wrong server password",
  "channels": [],
  "users": [],
  "messageCount": 2
}
```

### POST /api/mumble/text-message

**Description**: Authenticate and send a chat message to a channel

**Request Body**:
```json
{
  "host": "mumble.example.com",
  "port": 64738,
  "username": "bot",
  "password": "",
  "channelId": 0,
  "message": "Hello from Port of Call!",
  "timeout": 12000,
  "tls": true
}
```

**Response**:
```json
{
  "success": true,
  "host": "mumble.example.com",
  "port": 64738,
  "tls": true,
  "username": "bot",
  "channelId": 0,
  "messageSent": "Hello from Port of Call!"
}
```

## Debugging Tips

### Wireshark Decryption

To inspect TLS traffic in Wireshark:

1. Set environment variable: `SSLKEYLOGFILE=/tmp/ssl-keys.log`
2. Run your client (browser, custom app)
3. Load `/tmp/ssl-keys.log` in Wireshark: Edit → Preferences → Protocols → TLS → (Pre)-Master-Secret log filename

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `Rejected: Wrong server password` | Server requires password | Provide server password in `Authenticate.password` |
| `Rejected: Invalid username` | Username contains invalid characters | Use alphanumeric + underscore/hyphen only |
| Connection timeout after Version | Server doesn't support TLS | Set `tls: false` (insecure, not recommended) |
| Disconnect after 30 seconds | No Ping sent | Send Ping (type 3) every 20-30 seconds |
| `Authentication not confirmed` | No ServerSync received | Check for Reject message, verify credentials |

### Message Type Decoding

Unknown message types can be decoded by examining the type number:

```javascript
const MSG_NAMES = {
  0: 'Version', 1: 'UDPTunnel', 2: 'Authenticate', 3: 'Ping',
  4: 'Reject', 5: 'ServerSync', 6: 'ChannelRemove', 7: 'ChannelState',
  8: 'UserRemove', 9: 'UserState', 10: 'BanList', 11: 'TextMessage',
  12: 'PermissionDenied', 13: 'ACL', 14: 'QueryUsers', 15: 'CryptSetup',
  16: 'ContextActionModify', 17: 'ContextAction', 18: 'UserList',
  19: 'VoiceTarget', 20: 'PermissionQuery', 21: 'CodecVersion',
  22: 'UserStats', 23: 'RequestBlob', 24: 'ServerConfig', 25: 'SuggestConfig'
};
```

## Security Considerations

1. **TLS Certificate Validation**: Always validate server certificates in production (not implemented in Workers due to platform limitations)
2. **Password Security**: Passwords are sent in plaintext inside the TLS tunnel (TLS encryption protects them)
3. **Authentication Tokens**: Use tokens instead of passwords for bot accounts (more secure, revocable)
4. **Channel Permissions**: Verify user has permission before sending TextMessage to a channel
5. **HTML Injection**: `welcome_text` and TextMessage `message` may contain HTML — sanitize if displaying in web UI
6. **Rate Limiting**: Servers may rate-limit or ban clients that send excessive messages

## References

- **Official Protocol Documentation**: https://mumble.readthedocs.io/
- **Mumble.proto Source**: https://github.com/mumble-voip/mumble/blob/master/src/Mumble.proto
- **Protocol Buffers Encoding**: https://protobuf.dev/programming-guides/encoding/
- **Mumble Wiki**: https://wiki.mumble.info/
- **RFC 5246 (TLS 1.2)**: https://datatracker.ietf.org/doc/html/rfc5246

## Changelog

- **2026-02-18**: Initial power-user documentation created
- **2026-02-18**: Fixed bugs in protobuf varint encoding/decoding (unsigned integer overflow)
- **2026-02-18**: Added Ping timestamp support for RTT measurement
- **2026-02-18**: Added version_v2 field parsing for future compatibility
