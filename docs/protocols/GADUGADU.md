# Gadu-Gadu Protocol Reference

A thorough power-user reference for the Gadu-Gadu (GG) instant messaging protocol as implemented in Port of Call.

## Overview

Gadu-Gadu is a Polish instant messaging service that uses a proprietary binary protocol. It was one of the most popular messaging platforms in Poland, peaking at approximately 15 million users in the mid-2000s. The protocol operates over TCP using a simple header+payload packet structure with all multi-byte values in **little-endian** byte order.

- **Default Port:** 8074 (alternative: 443)
- **Byte Order:** Little-endian throughout
- **Character Encoding:** UTF-8 (protocol 8.0+), Windows-1250 (legacy)
- **Transport:** TCP (no TLS)
- **RFC:** None (proprietary)
- **Origin:** Poland, 2000
- **Current Status:** Still active, owned by GG Network S.A.

## Packet Format

Every GG packet follows this structure:

```
Offset  Size     Field       Description
0       4 bytes  type        Packet type identifier (uint32 LE)
4       4 bytes  length      Payload length in bytes (uint32 LE)
8       variable payload     Packet-specific data
```

The 8-byte header is always present. The `length` field specifies only the payload size (excluding the header itself). A packet with no payload has `length = 0`.

```
+--------+--------+-------------------+
| type   | length | payload           |
| 4B LE  | 4B LE  | <length> bytes    |
+--------+--------+-------------------+
```

Maximum allowed payload length in this implementation: 65,536 bytes (64 KB safety limit).

## Connection Flow

```
Client                            Server
  |                                 |
  |------- TCP Connect :8074 ------>|
  |                                 |
  |<------ GG_WELCOME (0x0001) ----|  (4-byte random seed in payload)
  |                                 |
  |------- GG_LOGIN80 (0x0031) --->|  (UIN + hash_type + hash + status + ...)
  |                                 |
  |<----- GG_LOGIN80_OK (0x0035) --|  (success, empty payload)
  |  or                             |
  |<--- GG_LOGIN80_FAILED (0x0043)-|  (bad credentials, empty payload)
  |                                 |
  |------- GG_PING (0x0008) ------>|  (keep-alive, every ~60s)
  |<------ GG_PONG (0x0007) ------|
  |                                 |
```

## Packet Types

| Hex    | Name                 | Direction      | Description                       |
|--------|----------------------|----------------|-----------------------------------|
| 0x0001 | GG_WELCOME           | Server->Client | Welcome packet with random seed   |
| 0x0007 | GG_PONG              | Server->Client | Keep-alive response               |
| 0x0008 | GG_PING              | Client->Server | Keep-alive request                |
| 0x0016 | GG_USERLIST_REQUEST  | Client->Server | Request server-side contact list  |
| 0x002D | GG_SEND_MSG80        | Client->Server | Send a message                    |
| 0x002E | GG_RECV_MSG80        | Server->Client | Receive a message                 |
| 0x0031 | GG_LOGIN80           | Client->Server | Login (protocol 8.0+)             |
| 0x0035 | GG_LOGIN80_OK        | Server->Client | Login succeeded                   |
| 0x0038 | GG_NEW_STATUS80      | Client->Server | Change user status                |
| 0x0041 | GG_USERLIST_REPLY    | Server->Client | Contact list response             |
| 0x0043 | GG_LOGIN80_FAILED    | Server->Client | Login failed                      |
| 0x004E | GG_USERLIST100_REPLY | Server->Client | Contact list response (v10.0)     |

## GG_WELCOME (0x0001)

Sent by the server immediately after TCP connection is established. Contains a random seed used for password hashing.

```
Offset  Size     Field   Description
0       4 bytes  seed    Random seed (uint32 LE)
```

The seed is a 32-bit random value that must be combined with the user's password to produce the authentication hash. This prevents replay attacks -- each session gets a unique seed.

## GG_LOGIN80 (0x0031)

Sent by the client to authenticate. The field order is critical -- the hash comes **immediately after** `hash_type`, not at the end of the packet.

```
Offset  Size      Field          Description
0       4 bytes   uin            User Identification Number (uint32 LE)
4       2 bytes   language       Language code, e.g. "pl" (2 ASCII chars)
6       1 byte    hash_type      Hash algorithm: 0x01=GG32, 0x02=SHA1
7       variable  hash           Password hash (4 bytes GG32, 20 bytes SHA1)
varies  4 bytes   status         Initial status (uint32 LE)
varies  4 bytes   flags          Protocol flags (uint32 LE)
varies  4 bytes   features       Feature bitmask (uint32 LE)
varies  4 bytes   local_ip       Local IP address (uint32 LE)
varies  2 bytes   local_port     Local port (uint16 LE)
varies  4 bytes   external_ip    External/public IP address (uint32 LE)
varies  2 bytes   external_port  External port (uint16 LE)
varies  1 byte    image_size     Max avatar size (0xFF = no avatar)
varies  1 byte    unknown        Padding/unknown (typically 0x64)
varies  variable  description    Optional status description (null-terminated)
```

### Concrete Byte Offsets (SHA1, hash_type=0x02, 20-byte hash)

```
Offset  Size   Field
0       4      uin
4       2      language ("pl")
6       1      hash_type (0x02)
7       20     hash (SHA1 digest)
27      4      status
31      4      flags
35      4      features
39      4      local_ip
43      2      local_port
45      4      external_ip
49      2      external_port
51      1      image_size
52      1      unknown
53+     var    description (optional)
```

Total minimum payload size with SHA1: 53 bytes.

### Concrete Byte Offsets (GG32, hash_type=0x01, 4-byte hash)

```
Offset  Size   Field
0       4      uin
4       2      language ("pl")
6       1      hash_type (0x01)
7       4      hash (GG32 uint32 LE)
11      4      status
15      4      flags
19      4      features
23      4      local_ip
27      2      local_port
29      4      external_ip
33      2      external_port
35      1      image_size
36      1      unknown
37+     var    description (optional)
```

Total minimum payload size with GG32: 37 bytes.

### Key Differences From Common Mistakes

- **`status` is uint32 (4 bytes), NOT uint8 (1 byte).** Using a 1-byte status corrupts all subsequent fields.
- **`hash` follows `hash_type` directly.** Placing the hash at the end of the packet is a protocol violation.
- **There are two separate 4-byte fields: `flags` AND `features`.** Missing either shifts all subsequent offsets.

## Password Hashing

### GG32 (Legacy, hash_type = 0x01)

A simple iterative hash. Fast but weak -- use SHA1 when possible.

```
hash = seed
for each byte c in password:
    hash = (hash * 0x41 + c) & 0xFFFFFFFF
return hash as uint32
```

Output: 4 bytes (uint32 LE).

```javascript
function gg32Hash(password, seed) {
    let hash = seed;
    for (let i = 0; i < password.length; i++) {
        hash = ((hash * 0x41) + password.charCodeAt(i)) & 0xFFFFFFFF;
    }
    return hash >>> 0; // Ensure unsigned
}
```

### SHA1 (Modern, hash_type = 0x02)

```
hash = SHA1(password_bytes + seed_bytes_LE)
```

Where `seed_bytes_LE` is the 4-byte little-endian encoding of the seed from GG_WELCOME. The password is encoded as UTF-8.

Output: 20 bytes (raw SHA1 digest, no hex encoding).

```javascript
async function sha1Hash(password, seed) {
    const seedBytes = new Uint8Array(4);
    new DataView(seedBytes.buffer).setUint32(0, seed, true);

    const passwordBytes = new TextEncoder().encode(password);
    const combined = new Uint8Array(passwordBytes.length + seedBytes.length);
    combined.set(passwordBytes, 0);
    combined.set(seedBytes, passwordBytes.length);

    const hashBuffer = await crypto.subtle.digest('SHA-1', combined);
    return new Uint8Array(hashBuffer);
}
```

## GG_SEND_MSG80 (0x002D)

Send a message to another user. The server handles timestamping -- there is **no timestamp field** in the send packet.

```
Offset  Size      Field          Description
0       4 bytes   recipient      Target UIN (uint32 LE)
4       4 bytes   seq            Sequence number (uint32 LE, client-generated)
8       4 bytes   msgclass       Message class (uint32 LE)
12      4 bytes   offset_plain   Byte offset to plain text in message area
16      4 bytes   offset_attrs   Byte offset to attributes (0 = no rich text)
20      variable  message        UTF-8 null-terminated text
```

### Message Classes

| Value  | Name              | Description                |
|--------|-------------------|----------------------------|
| 0x0001 | MSG_CLASS_QUEUED  | Queued/offline message     |
| 0x0002 | MSG_CLASS_MSG     | Normal message             |
| 0x0004 | MSG_CLASS_CHAT    | Chat message               |
| 0x0008 | MSG_CLASS_CTCP    | CTCP message               |
| 0x0010 | MSG_CLASS_ACK     | Acknowledgment             |

## GG_RECV_MSG80 (0x002E)

Receive a message from another user (server->client). Unlike the send packet, the receive packet **does** include a server-assigned timestamp.

```
Offset  Size      Field          Description
0       4 bytes   sender         Sender UIN (uint32 LE)
4       4 bytes   seq            Sequence number (uint32 LE)
8       4 bytes   time           Timestamp (uint32 LE, Unix epoch seconds)
12      4 bytes   msgclass       Message class (uint32 LE)
16      4 bytes   offset_plain   Byte offset to plain text
20      4 bytes   offset_attrs   Byte offset to attributes
24      variable  message        UTF-8 null-terminated text
```

## Status Codes

| Value  | Constant    | Description               |
|--------|-------------|---------------------------|
| 0x0001 | OFFLINE     | User is offline           |
| 0x0002 | AVAILABLE   | Online and available      |
| 0x0003 | BUSY        | Do not disturb            |
| 0x0004 | AWAY        | Away from keyboard        |
| 0x0014 | INVISIBLE   | Invisible to others       |

## User Identification Number (UIN)

- UINs are unsigned 32-bit integers (1 through 4,294,967,295)
- Stored as uint32 LE in all packets
- Production UINs commonly have 6-9 digits (values up to hundreds of millions)
- UIN 0 is reserved/invalid

## GG_USERLIST_REQUEST (0x0016)

Request the server-side contact list.

```
Offset  Size    Field    Description
0       1 byte  type     Request type: 0x01 = GET_LIST
```

## GG_USERLIST_REPLY (0x0041)

Server response containing the contact list. First byte is type/flags, followed by newline-separated contact records. Each record is tab-separated:

```
uin<TAB>visible_name<TAB>first_name<TAB>last_name<TAB>phone<TAB>group
```

Note: Many users store contacts locally rather than on the server. An empty response is normal.

## Keep-Alive

- Client sends GG_PING (0x0008) periodically (every ~60 seconds recommended)
- Server responds with GG_PONG (0x0007)
- Both are header-only packets (length = 0, no payload)
- Server will disconnect idle clients that don't ping

## Implementation Notes

### Buffered Reading

TCP may deliver GG packet data across arbitrary chunk boundaries. A single `read()` call may return the 8-byte header plus the payload in one chunk, or may split them across multiple chunks. The implementation uses a `BufferedReader` class that preserves excess bytes from one read for use in the next. Without this, data can be silently lost when a server sends the GG_WELCOME header and payload in a single TCP segment.

### DataView Byte Offset Safety

When creating a `DataView` from a `Uint8Array` that might be a subarray, always pass `byteOffset` and `byteLength`:

```typescript
const dv = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
```

Omitting these parameters when the Uint8Array is a subarray of a larger buffer will create a DataView over the wrong byte range.

### Timeout Architecture

Each socket operation (connect, read welcome, read login response) has its own timeout. An overall deadline ensures the entire authentication flow completes within the configured timeout (default 30 seconds, capped at 30 seconds).

## API Endpoints

### POST /api/gadugadu/connect

Test connectivity and authentication against a GG server.

**Request:**
```json
{
    "host": "91.214.237.10",
    "port": 8074,
    "uin": 12345678,
    "password": "mypassword",
    "hashType": "sha1",
    "timeout": 15000
}
```

| Field    | Type            | Required | Default | Description                       |
|----------|-----------------|----------|---------|-----------------------------------|
| host     | string          | Yes      | --      | GG server hostname or IP          |
| port     | number          | No       | 8074    | Server port                       |
| uin      | number / string | Yes      | --      | User Identification Number        |
| password | string          | Yes      | --      | Account password                  |
| hashType | "gg32" / "sha1" | No       | "sha1"  | Hash algorithm                    |
| timeout  | number          | No       | 30000   | Timeout in milliseconds           |

**Success Response (200):**
```json
{
    "success": true,
    "uin": 12345678,
    "message": "Login successful",
    "seed": 3847291056,
    "hashType": "sha1",
    "serverResponse": "GG_LOGIN80_OK",
    "timing": {
        "connect": 45,
        "welcome": 12,
        "login": 89,
        "total": 146
    }
}
```

**Failure Response (500):**
```json
{
    "success": false,
    "message": "Login failed - invalid credentials",
    "seed": 3847291056,
    "hashType": "sha1",
    "serverResponse": "GG_LOGIN80_FAILED",
    "error": "Authentication failed",
    "timing": { "connect": 45, "welcome": 12, "login": 89, "total": 146 }
}
```

### POST /api/gadugadu/send-message

Authenticate and send a message to another GG user.

**Request:**
```json
{
    "host": "91.214.237.10",
    "port": 8074,
    "senderUin": 12345678,
    "senderPassword": "mypassword",
    "recipientUin": 87654321,
    "message": "Hello!",
    "hashType": "sha1",
    "timeout": 15000
}
```

| Field          | Type            | Required | Default | Description                |
|----------------|-----------------|----------|---------|----------------------------|
| host           | string          | Yes      | --      | GG server hostname or IP   |
| port           | number          | No       | 8074    | Server port                |
| senderUin      | number / string | Yes      | --      | Sender UIN                 |
| senderPassword | string          | Yes      | --      | Sender password            |
| recipientUin   | number / string | Yes      | --      | Recipient UIN              |
| message        | string          | Yes      | --      | Message text               |
| hashType       | "gg32" / "sha1" | No       | "sha1"  | Hash algorithm             |
| timeout        | number          | No       | 15000   | Timeout in ms (max 30000)  |

**Success Response (200):**
```json
{
    "success": true,
    "senderUin": 12345678,
    "recipientUin": 87654321,
    "seq": 1708123456,
    "message": "Hello!",
    "latencyMs": 234,
    "serverAck": "GG_SEND_MSG_ACK",
    "note": "Message packet sent. Delivery depends on recipient being online."
}
```

### POST /api/gadugadu/contacts

Retrieve the server-side contact list after authenticating.

**Request:**
```json
{
    "host": "91.214.237.10",
    "port": 8074,
    "uin": 12345678,
    "password": "mypassword",
    "hashType": "sha1",
    "timeout": 15000
}
```

**Success Response (200):**
```json
{
    "success": true,
    "uin": 12345678,
    "contactCount": 3,
    "contacts": [
        {
            "uin": "87654321",
            "visibleName": "Jan Kowalski",
            "firstName": "Jan",
            "lastName": "Kowalski",
            "phone": "",
            "group": "Znajomi"
        }
    ],
    "latencyMs": 456
}
```

## Source Files

| File | Purpose |
|------|---------|
| `src/worker/gadugadu.ts` | HTTP handlers for all three API endpoints, `openGGSession` helper |
| `src/worker/protocols/gadugadu/types.ts` | TypeScript interfaces and protocol constants |
| `src/worker/protocols/gadugadu/client.ts` | `GaduGaduClient` class and `connectGaduGadu` function |
| `src/worker/protocols/gadugadu/utils.ts` | `BufferedReader`, packet I/O, hashing, login construction, UIN validation |
| `tests/gadugadu.test.ts` | Integration tests |

## Known GG Server Addresses

- `91.214.237.10` -- Known public GG infrastructure IP
- `appmsg.gadu-gadu.pl` -- DNS-based server discovery hostname

Note: The GG server at 91.214.237.10 may silently filter connections from certain IP ranges, causing TCP SYN to hang until OS timeout (~60 seconds). Integration tests that talk to real servers use longer timeouts.

## Security Considerations

1. **No TLS:** The GG protocol runs over plain TCP with no encryption. Credentials (hashed, not plaintext) and messages traverse the network unencrypted.
2. **GG32 is weak:** The GG32 hash algorithm is trivially reversible for short passwords. Always prefer SHA1.
3. **UIN enumeration:** UINs are sequential integers, making account scanning straightforward.
4. **MITM attacks:** No certificate pinning or TLS means man-in-the-middle attacks are trivial.
5. **Recommendation:** Use only for testing, research, and protocol education -- not for sensitive communications.

## Testing

```bash
# Run all GG tests
npm test -- gadugadu.test.ts

# Tests that talk to real GG servers are skipped in local mode
# and only run against the deployed API
```

## References

- [libgadu project](https://libgadu.net/) -- Open-source GG client library
- [libgadu protocol documentation](https://libgadu.net/protocol/) -- Official protocol specification
- [Wireshark GG dissector](https://www.wireshark.org/docs/dfref/g/gadu-gadu.html) -- Packet analysis reference
- [ekg2 project](https://github.com/ekg2/ekg2) -- Alternative GG client implementation

## Related Protocols

- **XMPP/Jabber** -- Modern open standard IM protocol
- **OSCAR (ICQ/AIM)** -- Similar proprietary binary IM protocol
- **MSN/MSNP** -- Microsoft Messenger protocol (also defunct)
- **Tlen** -- Another Polish IM protocol (XMPP-based)
