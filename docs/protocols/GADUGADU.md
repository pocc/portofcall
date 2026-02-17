# Gadu-Gadu Protocol Implementation

Polish instant messaging protocol for Port of Call.

## Protocol Overview

- **Name**: Gadu-Gadu (GG)
- **Port**: 8074 (primary), 443 (fallback)
- **Transport**: TCP
- **Encoding**: Binary (Little-Endian), UTF-8 text
- **Complexity**: Medium
- **RFC**: None (proprietary)
- **Status**: ✅ Implemented

## Quick Facts

- **Origin**: Poland, 2000
- **Peak Users**: ~15 million (mid-2000s)
- **Current Status**: Still active, owned by GG Network S.A.
- **Alternative Names**: GaduGadu, GG

## Protocol Specification

### Packet Structure

All packets use Little-Endian byte order:

```
┌─────────────────────────────────────┐
│ Type (4 bytes, uint32)              │  ← Packet type
├─────────────────────────────────────┤
│ Length (4 bytes, uint32)            │  ← Payload length
├─────────────────────────────────────┤
│ Payload (variable)                  │  ← Packet-specific data
└─────────────────────────────────────┘
```

Total header size: 8 bytes

### Authentication Flow

```
Client                            Server
  │                                 │
  ├─────── TCP Connect ────────────>│
  │                                 │
  │<────── GG_WELCOME (0x0001) ─────┤
  │        Seed: 0x12345678         │
  │                                 │
  ├─────── GG_LOGIN80 (0x0031) ────>│
  │        UIN, hash, status        │
  │                                 │
  │<──── GG_LOGIN80_OK (0x0035) ────┤
  │       OR                        │
  │<──── GG_LOGIN80_FAILED (0x0043)─┤
  │                                 │
```

### Packet Types

| Type | Value | Direction | Description |
|------|-------|-----------|-------------|
| `GG_WELCOME` | 0x0001 | S→C | Server welcome with seed |
| `GG_PING` | 0x0008 | C→S | Keep-alive ping |
| `GG_PONG` | 0x0007 | S→C | Keep-alive pong |
| `GG_SEND_MSG80` | 0x002d | C→S | Send message |
| `GG_RECV_MSG80` | 0x002e | S→C | Receive message |
| `GG_LOGIN80` | 0x0031 | C→S | Login (protocol 8.0) |
| `GG_LOGIN80_OK` | 0x0035 | S→C | Login success |
| `GG_NEW_STATUS80` | 0x0038 | C→S | Status change |
| `GG_LOGIN80_FAILED` | 0x0043 | S→C | Login failed |

### GG_WELCOME Packet (0x0001)

**Server → Client**

```c
struct {
  uint32_t seed;  // Random seed for hash
}
```

### GG_LOGIN80 Packet (0x0031)

**Client → Server**

```c
struct {
  uint32_t uin;           // User Identification Number
  uint8_t  language[2];   // "pl" for Polish
  uint8_t  hash_type;     // 0x01=GG32, 0x02=SHA1
  uint8_t  status;        // Initial status
  uint32_t features;      // Protocol features
  uint32_t local_ip;      // Client IP (optional)
  uint16_t local_port;    // Client port (optional)
  uint32_t external_ip;   // External IP (optional)
  uint16_t external_port; // External port (optional)
  uint8_t  image_size;    // Avatar size
  uint8_t  unknown1;      // Reserved
  uint8_t  hash[64];      // Password hash
  // ... additional fields
}
```

### Password Hashing

#### GG32 Hash (Legacy)
```javascript
function gg32Hash(password, seed) {
  let hash = seed;
  for (let i = 0; i < password.length; i++) {
    hash = ((hash * 0x41) + password.charCodeAt(i)) & 0xFFFFFFFF;
  }
  return hash;
}
```

#### SHA-1 Hash (Modern)
```javascript
function sha1Hash(password, seed) {
  // Convert seed to 4-byte little-endian
  const seedBytes = new Uint8Array(4);
  new DataView(seedBytes.buffer).setUint32(0, seed, true);

  // Hash: SHA-1(password + seedBytes)
  return await crypto.subtle.digest('SHA-1',
    new TextEncoder().encode(password).concat(seedBytes)
  );
}
```

### Status Codes

| Code | Status | Description |
|------|--------|-------------|
| 0x0002 | Available | Online and available |
| 0x0003 | Busy | Do not disturb |
| 0x0004 | Away | Away from keyboard |
| 0x0014 | Invisible | Invisible to others |
| 0x0001 | Offline | Not connected |

### GG_LOGIN80_OK Packet (0x0035)

**Server → Client** (Empty payload - just header)

### GG_LOGIN80_FAILED Packet (0x0043)

**Server → Client** (Empty payload - just header)

## Implementation Details

### Connection

```typescript
import { connect } from 'cloudflare:sockets';

const socket = connect('appmsg.gadu-gadu.pl:8074');
await socket.opened;
```

### Server Discovery

Modern clients query `appmsg.gadu-gadu.pl` via HTTP to get current server list. For testing, use:
- `91.214.237.10:8074` (primary)
- `91.214.237.10:443` (fallback)

### Features Implemented

- ✅ Connection test (handshake)
- ✅ GG_WELCOME packet parsing
- ✅ GG32 hash computation
- ✅ SHA-1 hash computation
- ✅ GG_LOGIN80 packet building
- ✅ Login success/failure detection
- ✅ Cloudflare detection
- ✅ Input validation (UIN format)

### Features Not Implemented

- ❌ Message sending/receiving
- ❌ Contact list management
- ❌ Status changes
- ❌ File transfers
- ❌ Conference rooms

## Usage Example

```typescript
import { GaduGaduClient } from './gadugadu/client';

const client = new GaduGaduClient({
  host: 'appmsg.gadu-gadu.pl',
  port: 8074,
  uin: 12345678,
  password: 'password123',
  hashType: 'sha1', // or 'gg32'
});

const result = await client.connect();
if (result.success) {
  console.log('Login successful!');
}
```

## Testing

```bash
# Unit tests
npm test -- gadugadu.test.ts

# Integration tests (requires valid GG account)
npm test -- gadugadu.integration.test.ts
```

## Security Considerations

1. **Password Hashing**: GG32 is weak - use SHA-1 when possible
2. **Plaintext Transport**: No TLS - credentials sent over plain TCP
3. **UIN Enumeration**: UINs are sequential, enabling account scanning
4. **MITM Attacks**: No certificate pinning or encryption
5. **Recommendation**: Only use for testing/research, not production

## References

- [libgadu Protocol Specification](http://libgadu.net/protocol/) - Official protocol docs
- [Wireshark Dissector](https://www.wireshark.org/docs/dfref/g/gadu-gadu.html) - Packet analysis
- [Port 8074 Information](https://whatportis.com/ports/8074_gadu-gadu) - Port details

## Related Protocols

- **XMPP** - Modern open IM protocol
- **OSCAR (ICQ/AIM)** - Similar proprietary IM
- **MSN/MSNP** - Microsoft Messenger

## Historical Context

Gadu-Gadu was Poland's dominant instant messenger in the early 2000s, predating Skype and Facebook Messenger. While usage has declined, it remains culturally significant and actively maintained.

---

**Status**: Implemented
**Complexity**: Medium
**Test Coverage**: 10 integration tests
**Last Updated**: 2024-02-16
