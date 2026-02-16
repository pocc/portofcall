# Battle.net BNCS Protocol

## Overview

Battle.net is Blizzard Entertainment's online gaming service. The BNCS (Battle.net Chat Server) protocol is used by classic Blizzard games to communicate with Battle.net servers.

- **Port**: 6112 (TCP)
- **Protocol**: Binary protocol with little-endian encoding
- **Games**: Diablo, StarCraft, Warcraft II/III, Diablo II
- **Status**: Legacy protocol (replaced by modern Battle.net for newer games)

## Games Using BNCS

### Classic Blizzard Titles
- **Diablo** (1996) - Original hack-and-slash dungeon crawler
- **StarCraft** (1998) - Real-time strategy game
- **Warcraft II: Battle.net Edition** (1999) - RTS game
- **Diablo II** (2000) - Action RPG
- **Warcraft III: Reign of Chaos** (2002) - RTS with hero units

## Protocol Structure

### Message Format

All BNCS messages follow this structure:

```
[0xFF] - Header byte (1 byte)
[Message ID] - SID_* identifier (1 byte)
[Length] - Total message length in bytes (2 bytes, little-endian)
[Data] - Variable-length message payload
```

### Connection Handshake

1. **Client connects** to server on TCP port 6112
2. **Protocol selector** byte is sent by client:
   - `0x01`: Game protocol (Diablo, StarCraft, etc.)
   - `0x02`: BNFTP (Battle.net File Transfer Protocol)
   - `0x03`: Telnet/Chat protocol
3. **BNCS messages** exchanged using SID_* packet types
4. **Authentication** and game-specific communication

### Common Message IDs (SID_*)

| ID | Name | Purpose |
|----|------|---------|
| 0x00 | SID_NULL | Keepalive/ping message |
| 0x25 | SID_PING | Server ping request with timestamp |
| 0x50 | SID_AUTH_INFO | Authentication information request |
| 0x51 | SID_AUTH_CHECK | CD key verification |
| 0x0A | SID_ENTERCHAT | Enter chat channel |
| 0x0F | SID_JOINCHANNEL | Join specific chat channel |

## Battle.net Realms

### Official Server Addresses

- **US East**: useast.battle.net
- **US West**: uswest.battle.net
- **Asia**: asia.battle.net
- **Europe**: europe.battle.net

### Port Information
- **Main Port**: 6112 (TCP) - BNCS protocol
- **File Transfer**: 6112 (TCP) - BNFTP (using protocol selector 0x02)
- **Game Traffic**: Varies by game, often UDP

## Protocol Implementation

### Detection Strategy

The implementation sends:
1. Protocol selector byte (0x01 for Game protocol)
2. SID_NULL message (0x00) to test connectivity
3. Parses response to verify BNCS server

### Response Validation

A valid BNCS server will:
- Respond with messages starting with 0xFF header byte
- Include proper message ID and length
- Follow little-endian encoding for multi-byte values

## Security Considerations

### Protocol Security
- **Plaintext**: Original BNCS protocol is not encrypted
- **CD Key Hashing**: Uses SHA-1 and other hashing for authentication
- **IP Bans**: Server enforces protocol compliance, violations result in bans

### Modern Security
Modern Battle.net (used by newer games) uses:
- HTTPS for web services
- OAuth 2.0 for authentication
- Encrypted game traffic

## Historical Context

### Legacy Status
The BNCS protocol is considered **legacy** and is used only by classic Blizzard games. Modern Blizzard games (World of Warcraft, Overwatch, Diablo III/IV, etc.) use entirely different protocols and authentication systems.

### Preservation
The protocol remains important for:
- Game preservation projects
- Private servers
- Reverse engineering efforts
- Gaming history research

## Testing

### Test Cases
```bash
# Test US East server
curl -X POST http://localhost:8787/api/battlenet/connect \
  -H "Content-Type: application/json" \
  -d '{
    "host": "useast.battle.net",
    "port": 6112,
    "protocolId": 1,
    "timeout": 15000
  }'
```

### Expected Response
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

## References

- [BNETDocs](https://bnetdocs.org/) - Community-maintained Battle.net protocol documentation
- [Protocol Overview](https://bnetdocs.org/document/10/battle-net-chat-server-protocol-overview) - BNCS protocol overview
- [Protocol Headers](https://bnetdocs.org/document/16/protocol-headers) - Message header specifications
- [Battle.net on Wikipedia](https://en.wikipedia.org/wiki/Battle.net) - Service history and overview

## Related Protocols

- **BNFTP**: Battle.net File Transfer Protocol (same port, different protocol selector)
- **Telnet/Chat**: Text-based chat protocol (protocol selector 0x03)
- **Modern Battle.net**: HTTPS/OAuth-based system for new games

## Performance Notes

- **Latency**: Low-latency protocol designed for real-time gaming
- **Keepalive**: SID_NULL messages keep connections alive
- **Efficiency**: Binary format minimizes overhead

## Compatibility

### Supported
- Classic Blizzard games (1996-2002 era)
- StarCraft: Remastered (maintains BNCS compatibility)
- Warcraft III: Reforged (maintains BNCS compatibility)

### Not Supported
- World of Warcraft
- Diablo III/IV
- Overwatch/Overwatch 2
- Hearthstone
- Heroes of the Storm

## Notes

- The protocol is **aggressively enforced** by Battle.net servers
- Invalid protocol messages can result in **IP bans**
- Port 6112 is often blocked by corporate firewalls
- Modern games use completely different protocols (not BNCS)
