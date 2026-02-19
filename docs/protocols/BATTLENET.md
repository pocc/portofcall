# Battle.net BNCS Protocol

## Overview

**Protocol:** BNCS (Battle.net Chat Server)
**Port:** 6112 (TCP)
**Encoding:** Binary, little-endian
**Specification:** [BNETDocs](https://bnetdocs.org/)
**Complexity:** Medium-High
**Status:** Legacy (classic Blizzard games only)

Battle.net is Blizzard Entertainment's online gaming service. The BNCS protocol is the binary wire protocol used by classic Blizzard titles to authenticate, chat, and matchmake on the Battle.net service. It has been fully reverse-engineered and documented by the community at BNETDocs.

### Supported Games

| Product ID | Game | Year |
|-----------|------|------|
| `DRTL` | Diablo | 1996 |
| `DSHR` | Diablo (Shareware) | 1996 |
| `STAR` | StarCraft | 1998 |
| `SSHR` | StarCraft (Shareware) | 1998 |
| `SEXP` | StarCraft: Brood War | 1998 |
| `W2BN` | Warcraft II: Battle.net Edition | 1999 |
| `D2DV` | Diablo II | 2000 |
| `D2XP` | Diablo II: Lord of Destruction | 2001 |
| `WAR3` | Warcraft III: Reign of Chaos | 2002 |
| `W3XP` | Warcraft III: The Frozen Throne | 2003 |
| `W3DM` | Warcraft III (Demo) | 2002 |

Product IDs are 4-byte ASCII FourCC codes stored as little-endian DWORDs.

## Protocol Specification

### Message Framing

Every BNCS message has a 4-byte header:

```
Offset  Size  Field
------  ----  -----
0       1     Header byte (always 0xFF)
1       1     Message ID (SID_* identifier)
2       2     Total length (uint16 LE, includes the 4-byte header)
4       n     Payload (length - 4 bytes)
```

The minimum valid packet is 4 bytes (header only, no payload). The length field counts the entire message including the header itself.

```
Example: SID_NULL (keepalive)
FF 00 04 00
^^          Header byte
   ^^       Message ID = SID_NULL (0x00)
      ^^ ^^ Length = 4 (LE) - header only, no payload
```

### FourCC Encoding

Product IDs, platform IDs, and language codes are encoded as 4-character ASCII strings stored in little-endian DWORD order. For example, "IX86" (x86 platform):

```
ASCII:       I    X    8    6
Hex:         49   58   38   36
LE DWORD:    36   38   58   49
```

The string is reversed byte-by-byte when written to the wire.

### Protocol Selector

Before any BNCS messages are exchanged, the client must send a single protocol selector byte:

| Byte | Protocol |
|------|----------|
| `0x01` | Game protocol (BNCS - standard game client) |
| `0x02` | BNFTP (Battle.net File Transfer Protocol) |
| `0x03` | Telnet/Chat (text-based chat interface) |

This byte is sent raw (not wrapped in a BNCS frame). All subsequent communication uses BNCS-framed messages.

### Connection Flow

```
Client                          Server
  |                               |
  |--- TCP connect to :6112 ---->|
  |                               |
  |--- 0x01 (protocol selector)->|
  |                               |
  |--- SID_AUTH_INFO (0x50) ---->|
  |    (platform, product, etc.) |
  |                               |
  |<-- SID_PING (0x25) ----------|  (optional, may arrive first)
  |--- SID_PING (0x25) response->|  (echo cookie back)
  |                               |
  |<-- SID_AUTH_INFO (0x50) -----|
  |    (logon type, server token,|
  |     MPQ info, version check) |
  |                               |
  |--- SID_AUTH_CHECK (0x51) --->|  (CD key hash, version check)
  |<-- SID_AUTH_CHECK (0x51) ----|  (result code)
  |                               |
  |--- SID_ENTERCHAT (0x0A) --->|  (enter chat)
  |<-- SID_ENTERCHAT (0x0A) ----|  (unique name, stats)
  |                               |
```

### Common Message IDs

| ID | Name | Direction | Purpose |
|----|------|-----------|---------|
| `0x00` | SID_NULL | Both | Keepalive (empty payload) |
| `0x25` | SID_PING | Both | Latency measurement (4-byte cookie) |
| `0x50` | SID_AUTH_INFO | Both | Client: platform/product info; Server: challenge |
| `0x51` | SID_AUTH_CHECK | Both | CD key verification and version check |
| `0x0A` | SID_ENTERCHAT | Both | Enter chat environment |
| `0x0B` | SID_GETCHANNELLIST | Both | Request/receive channel list |
| `0x0C` | SID_JOINCHANNEL | C->S | Join a specific chat channel |
| `0x0E` | SID_CHATCOMMAND | C->S | Send chat message |
| `0x0F` | SID_CHATEVENT | S->C | Receive chat events |

## SID_AUTH_INFO (0x50) - Detailed

### Client Request

The client sends platform, product, and locale information:

```
Offset  Size  Type      Field
------  ----  --------  -----
0       4     DWORD     Protocol ID (0 for classic BNCS)
4       4     DWORD     Platform ID (FourCC LE, e.g. "IX86" for x86)
8       4     DWORD     Product ID (FourCC LE, e.g. "STAR")
12      4     DWORD     Version Byte (game-specific version number)
16      4     DWORD     Product Language (FourCC LE, e.g. "USen")
20      4     DWORD     Local IP address (client's, can be zeroed)
24      4     DWORD     Timezone Bias (minutes west of UTC, e.g. 480 for UTC-8)
28      4     DWORD     Locale ID (Windows LCID, e.g. 0x0409 for en-US)
32      4     DWORD     Language ID (Windows LANGID, e.g. 0x0409 for en-US)
36      var   SZSTRING  Country abbreviation (null-terminated, e.g. "USA")
36+n    var   SZSTRING  Country name (null-terminated, e.g. "United States")
```

Total payload: 36 bytes of fixed fields + variable-length strings.

### Server Response

The server responds with authentication challenge parameters:

```
Offset  Size  Type      Field
------  ----  --------  -----
0       4     DWORD     Logon Type
4       4     DWORD     Server Token (random, used in CD key hashing)
8       4     DWORD     UDP Value (for UDP test, usually 0)
12      8     FILETIME  MPQ Filetime (Windows FILETIME, LE, low DWORD first)
20      var   SZSTRING  MPQ Filename (version check archive name)
20+n    var   SZSTRING  Server Info (version check formula string)
```

### Logon Types

| Value | Type | Used By |
|-------|------|---------|
| 0 | Broken SHA-1 (legacy) | Diablo, StarCraft original |
| 1 | NLS v1 (SRP) | Warcraft III |
| 2 | NLS v2 (SRP) | Diablo II |

NLS = "New Logon System" based on the Secure Remote Password (SRP) protocol.

### Server Token

The 4-byte server token is a random value generated per connection. It is used as part of the CD key hashing process in `SID_AUTH_CHECK`. The client combines the client token, server token, and CD key hash to prove key ownership.

### MPQ Filename and Server Info

The server sends the name of an MPQ (Mo'PaQ) archive file and a formula string. The client is expected to:

1. Open the named MPQ file from the game installation
2. Evaluate the formula against the game executable to produce a version checksum
3. Send the result back in `SID_AUTH_CHECK`

This serves as a rudimentary anti-cheat mechanism verifying the client has unmodified game files.

## SID_PING (0x25)

### Server to Client

```
Offset  Size  Type   Field
------  ----  -----  -----
0       4     DWORD  Cookie (random value, LE)
```

### Client to Server

The client must echo the exact cookie value back:

```
Offset  Size  Type   Field
------  ----  -----  -----
0       4     DWORD  Cookie (same value from server, LE)
```

The server uses the round-trip time to measure latency. Failing to respond to SID_PING in a timely manner may result in disconnection.

**Important:** The server may send SID_PING *before* the SID_AUTH_INFO response. Implementations must handle interleaved packet ordering and respond to SID_PING immediately regardless of where it appears in the message sequence.

## SID_NULL (0x00)

SID_NULL is a keepalive message with no payload (total length = 4 bytes). Either side may send it. Servers typically ignore it; clients should continue processing after receiving one.

## Multi-Packet TCP Segments

BNCS servers commonly batch multiple packets into a single TCP segment. For example, the server may send SID_PING (8 bytes) and SID_AUTH_INFO (~80+ bytes) in a single TCP write, which the client receives as one contiguous byte stream. Implementations must:

1. Parse the first packet using its declared length field
2. Check if there are remaining bytes after the first packet
3. Parse subsequent packets from the leftover bytes
4. Only read from the socket again if the buffer is incomplete

Failing to handle this correctly causes the second packet to be silently lost.

## Battle.net Gateways

### Official Realm Addresses

| Realm | Hostname | Port |
|-------|----------|------|
| US East | useast.battle.net | 6112 |
| US West | uswest.battle.net | 6112 |
| Asia | asia.battle.net | 6112 |
| Europe | europe.battle.net | 6112 |

All four realms use TCP port 6112 exclusively.

## API Endpoints

### POST /api/battlenet/connect

Basic BNCS connectivity probe. Sends the protocol selector byte and a SID_NULL keepalive, then checks if the server responds with a valid BNCS-framed packet.

**Request:**
```json
{
  "host": "useast.battle.net",
  "port": 6112,
  "timeout": 15000,
  "protocolId": 1
}
```

**Response (success):**
```json
{
  "success": true,
  "host": "useast.battle.net",
  "port": 6112,
  "protocolId": 1,
  "serverResponse": true,
  "messageId": 37,
  "messageLength": 8,
  "rawData": "00 00 00 00"
}
```

### POST /api/battlenet/authinfo

Performs the SID_AUTH_INFO handshake. Sends a full authentication info request and parses the server's challenge response, including handling any interleaved SID_PING packets.

**Request:**
```json
{
  "host": "useast.battle.net",
  "port": 6112,
  "timeout": 15000,
  "productId": "STAR"
}
```

**Response (success):**
```json
{
  "success": true,
  "host": "useast.battle.net",
  "port": 6112,
  "isBattlenet": true,
  "productId": "STAR",
  "productLabel": "StarCraft",
  "logonType": 0,
  "logonTypeLabel": "Broken SHA-1 (legacy)",
  "serverToken": "0x12345678",
  "udpValue": 0,
  "mpqFiletime": "0x01c123450000abcd",
  "mpqFilename": "ver-IX86-1.mpq",
  "serverInfo": "A=123456789 B=...",
  "pingCookie": 305419896
}
```

**Supported product IDs:** `DRTL`, `DSHR`, `STAR`, `SEXP`, `SSHR`, `W2BN`, `D2DV`, `D2XP`, `WAR3`, `W3XP`, `W3DM`

### POST /api/battlenet/status

Probes all four Battle.net gateways in parallel and reports reachability and round-trip times.

**Request:**
```json
{
  "timeout": 8000
}
```

**Response:**
```json
{
  "success": true,
  "realms": [
    {
      "name": "US East",
      "host": "useast.battle.net",
      "port": 6112,
      "reachable": true,
      "rtt": 45,
      "isBattlenet": true
    }
  ],
  "reachableCount": 4,
  "totalCount": 4
}
```

## Security Considerations

### Protocol Enforcement
- Battle.net servers **aggressively enforce** protocol compliance
- Sending malformed packets or violating the expected message sequence may result in IP-level bans
- The implementation sends only well-formed packets following the documented handshake

### No Encryption
- The original BNCS protocol transmits all data in plaintext
- CD key hashes use SHA-1 (broken) or SRP (NLS), neither of which provides transport-level encryption
- Passwords are never sent in cleartext (SRP protocol is used), but the surrounding traffic is unencrypted

### Modern Battle.net
Modern Blizzard games (WoW, Diablo III/IV, Overwatch, etc.) use entirely different protocols:
- HTTPS for web services
- OAuth 2.0 for authentication
- Encrypted proprietary game protocols

## Testing

### Basic Connectivity
```bash
# Test BNCS probe
curl -s -X POST http://localhost:8787/api/battlenet/connect \
  -H "Content-Type: application/json" \
  -d '{"host": "useast.battle.net"}' | jq .

# Test auth info handshake
curl -s -X POST http://localhost:8787/api/battlenet/authinfo \
  -H "Content-Type: application/json" \
  -d '{"host": "useast.battle.net", "productId": "STAR"}' | jq .

# Check all realms
curl -s -X POST http://localhost:8787/api/battlenet/status \
  -H "Content-Type: application/json" \
  -d '{}' | jq .
```

### Raw Protocol Testing (netcat)
```bash
# Send protocol selector + SID_NULL manually
# 01 = protocol selector, FF 00 04 00 = SID_NULL
printf '\x01\xff\x00\x04\x00' | nc useast.battle.net 6112 | xxd
```

## Implementation Notes

### Wire-Level Details

- All multi-byte integers are **little-endian**
- Strings are **null-terminated** ASCII (SZSTRING)
- FourCC codes are stored as **reversed** ASCII bytes (little-endian DWORD)
- The FILETIME in SID_AUTH_INFO response is a Windows FILETIME (100-nanosecond intervals since January 1, 1601), stored as two consecutive little-endian DWORDs (low DWORD first, then high DWORD)

### Edge Cases

- The server may send **SID_PING before SID_AUTH_INFO** -- implementations must handle this
- Multiple BNCS packets may arrive in a **single TCP segment** -- implementations must split by declared length
- SID_NULL may appear at any point -- implementations should silently skip it
- The server may not respond to SID_NULL at all (it is a keepalive, not a request/response pair)

## References

- [BNETDocs](https://bnetdocs.org/) -- Community-maintained Battle.net protocol documentation
- [SID_AUTH_INFO](https://bnetdocs.org/packet/164/sid-auth-info) -- Authentication info packet specification
- [SID_PING](https://bnetdocs.org/packet/268/sid-ping) -- Ping packet specification
- [Protocol Headers](https://bnetdocs.org/document/16/protocol-headers) -- Message header format
- [Protocol Overview](https://bnetdocs.org/document/10/battle-net-chat-server-protocol-overview) -- BNCS protocol overview
- [Battle.net on Wikipedia](https://en.wikipedia.org/wiki/Battle.net) -- Service history

## Related Protocols

- **BNFTP** -- Battle.net File Transfer Protocol (protocol selector 0x02, same port)
- **BNCS Telnet/Chat** -- Text-based chat interface (protocol selector 0x03)
- **MCP** -- Realm server protocol (Diablo II realm connections)
- **W3GS** -- Warcraft III Game Server protocol (in-game traffic)
