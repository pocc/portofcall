# STUN Protocol Implementation

**File:** `src/worker/stun.ts`
**Reviewed:** 2026-02-18
**Documentation:** `docs/protocols/non-tcp/STUN.md` (reference implementation, NOT deployed)

## Overview

STUN (Session Traversal Utilities for NAT) is a standardized protocol (RFC 5389/8489) that enables clients behind NAT to discover their public IP address and port as seen by external servers. This implementation provides STUN Binding Request/Response over TCP using Cloudflare Workers' Sockets API.

**Port:** 3478 (standard STUN), 5349 (STUN-TLS)
**Transport:** TCP (this implementation), UDP (not supported in Workers)
**RFCs:** RFC 5389 (original), RFC 8489 (current)

## Bugs Found and Fixed

### Bug 1: RESPONSE-ORIGIN and OTHER-ADDRESS incorrectly XOR'd (lines 294-310)

**Severity:** High
**RFC Violation:** RFC 5389 §15.5 (RESPONSE-ORIGIN) and §15.6 (OTHER-ADDRESS)

**Problem:**
Both `ATTR_RESPONSE_ORIGIN` (0x802b) and `ATTR_OTHER_ADDRESS` (0x802c) were decoded using XOR mode:
```typescript
case ATTR_RESPONSE_ORIGIN: {
  const addr = decodeAddress(attrValue, true, transactionId);  // ❌ Wrong
  ...
}
case ATTR_OTHER_ADDRESS: {
  const addr = decodeAddress(attrValue, true, transactionId);  // ❌ Wrong
  ...
}
```

Per RFC 5389:
- §15.5: "RESPONSE-ORIGIN... has the same format as MAPPED-ADDRESS" (non-XOR'd)
- §15.6: "OTHER-ADDRESS... has the same format as MAPPED-ADDRESS" (non-XOR'd)

Only XOR-MAPPED-ADDRESS (0x0020) should use XOR encoding. MAPPED-ADDRESS, RESPONSE-ORIGIN, and OTHER-ADDRESS use plain encoding.

**Impact:**
When a STUN server includes RESPONSE-ORIGIN or OTHER-ADDRESS attributes (used for NAT type detection in RFC 5780), the returned IP addresses and ports would be incorrectly XOR'd, producing invalid values. For example, a response origin of `203.0.113.1:3478` would be decoded as gibberish.

**Fix:**
Change both to `decodeAddress(attrValue, false, transactionId)`:
```typescript
case ATTR_RESPONSE_ORIGIN: {
  const addr = decodeAddress(attrValue, false, transactionId);  // ✓ Correct
  ...
}
case ATTR_OTHER_ADDRESS: {
  const addr = decodeAddress(attrValue, false, transactionId);  // ✓ Correct
  ...
}
```

## Implementation Review

### Message Format (RFC 5389 §6)

STUN messages consist of a 20-byte header followed by zero or more attributes:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|0 0|     STUN Message Type     |         Message Length        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                         Magic Cookie                          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
|                     Transaction ID (96 bits)                  |
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

**Implementation:** Correctly implemented in `buildBindingRequest` (lines 56-95) and `parseStunMessage` (lines 193-369).

- Magic cookie: `0x2112A442` (line 15) ✓
- Message length: excludes 20-byte header (line 79) ✓
- Transaction ID: 12 random bytes (lines 47-51) ✓
- Big-endian byte order throughout ✓

### Message Types (RFC 5389 §6)

The message type field uses a specific encoding:
- Bits 0-1: Always `00` (distinguishes STUN from other protocols)
- Bits 2-13: Method (0x001 = Binding)
- Bits 14-15: Class (00=Request, 01=Indication, 10=Success, 11=Error)

**Implementation:**
```typescript
const STUN_BINDING_REQUEST = 0x0001;        // Class 00, Method 001
const STUN_BINDING_RESPONSE = 0x0101;       // Class 10, Method 001
const STUN_BINDING_ERROR_RESPONSE = 0x0111; // Class 11, Method 001
```

All values are correct per RFC 5389 §6.

### Attribute Format (RFC 5389 §15)

Attributes are TLV (Type-Length-Value) encoded with 32-bit alignment:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|         Type                  |            Length             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                         Value (variable)                ....
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

**Padding:** Attributes are padded to 4-byte boundaries. The `Length` field contains the unpadded length, but the next attribute starts after padding.

**Implementation:** Correctly calculates padding with `Math.ceil(attrLength / 4) * 4` (line 260) and applies it during parsing (line 351).

### XOR-MAPPED-ADDRESS (RFC 5389 §15.2)

The primary address attribute, XOR'd with the magic cookie (and transaction ID for IPv6):

**IPv4 XOR:**
- X-Port = Port ⊕ (most significant 16 bits of magic cookie)
- X-Address = IPv4 address ⊕ magic cookie

**IPv6 XOR:**
- X-Port = Port ⊕ (most significant 16 bits of magic cookie)
- X-Address = IPv6 address ⊕ (magic cookie || transaction ID)

**Implementation (lines 100-166):**
✓ Port XOR: `port ^= (STUN_MAGIC_COOKIE >>> 16) & 0xffff` (line 114)
✓ IPv4 XOR: bytes XOR'd with 4-byte magic cookie (lines 123-127)
✓ IPv6 XOR: bytes XOR'd with 16-byte concatenation of magic cookie + transaction ID (lines 143-150)

### TCP Framing (RFC 5389 §7.2.2)

STUN over TCP uses implicit framing: the message length field determines message boundaries. No additional framing is needed.

**Implementation:** `readStunMessage` (lines 375-422) correctly:
1. Reads at least 20 bytes to get the header
2. Extracts the length field from bytes 2-3: `messageLength = STUN_HEADER_LENGTH + ((header[2] << 8) | header[3])`
3. Continues reading until `totalRead >= messageLength`
4. Returns exactly `messageLength` bytes

This matches RFC 5389 §7.2.2 requirements.

### Error Handling (RFC 5389 §15.6)

ERROR-CODE attribute format:
```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|           Reserved (0)        |Class|     Number              |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|      Reason Phrase (variable)                                ..
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

Error code = Class × 100 + Number (range: 300-699)

**Implementation (lines 317-327):**
```typescript
const classNum = errView.getUint8(2) & 0x07;  // Bits 0-2 of byte 2
const number = errView.getUint8(3);           // Byte 3
const code = classNum * 100 + number;
```

✓ Correct per RFC 5389 §15.6

### SOFTWARE Attribute (RFC 5389 §15.10)

UTF-8 string identifying server software, max 128 characters (per RFC, though not enforced).

**Implementation:**
- Encoding (lines 60-69): UTF-8 encoded with 4-byte padding ✓
- Decoding (lines 312-315): TextDecoder UTF-8 ✓

### Transaction ID Validation

RFC 5389 §6 requires responses to echo the transaction ID from the request.

**Implementation (lines 220-228):**
```typescript
const responseTxId = data.slice(8, 20);
let transactionIdMatch = true;
for (let i = 0; i < 12; i++) {
  if (responseTxId[i] !== transactionId[i]) {
    transactionIdMatch = false;
    break;
  }
}
```

✓ Correctly validates all 12 bytes

## API Endpoints

### 1. `POST /api/stun/binding` — STUN Binding Test

Performs a complete STUN Binding Request/Response exchange to discover public IP and port.

**Request:**
```typescript
{
  host: string;      // STUN server hostname
  port?: number;     // Default: 3478
  timeout?: number;  // Default: 10000 (ms)
}
```

**Response (success):**
```json
{
  "success": true,
  "message": "STUN Binding successful",
  "host": "stun.l.google.com",
  "port": 3478,
  "rtt": 42,
  "connectTime": 38,
  "protocol": {
    "messageType": "0x0101",
    "messageTypeName": "Binding Success Response",
    "validMagicCookie": true,
    "transactionIdMatch": true
  },
  "publicAddress": {
    "ip": "203.0.113.42",
    "port": 54321,
    "family": "IPv4"
  },
  "serverSoftware": "Coturn-4.5.2",
  "responseOrigin": {
    "ip": "198.51.100.1",
    "port": 3478
  },
  "otherAddress": {
    "ip": "198.51.100.2",
    "port": 3479
  },
  "errorCode": null,
  "attributes": [
    { "type": "XOR-MAPPED-ADDRESS", "value": "203.0.113.42:54321 (IPv4)" },
    { "type": "SOFTWARE", "value": "Coturn-4.5.2" },
    { "type": "RESPONSE-ORIGIN", "value": "198.51.100.1:3478 (IPv4)" },
    { "type": "OTHER-ADDRESS", "value": "198.51.100.2:3479 (IPv4)" }
  ]
}
```

**Response (error):**
```json
{
  "success": false,
  "error": "Connection timeout"
}
```

**Cloudflare-protected hosts:**
```json
{
  "success": false,
  "error": "Target host stun.example.com resolves to Cloudflare IP 104.18.0.1...",
  "isCloudflare": true
}
```

**Notes:**
- Prefers XOR-MAPPED-ADDRESS over deprecated MAPPED-ADDRESS
- Includes SOFTWARE attribute in request: `"PortOfCall"`
- Returns all parsed attributes for debugging
- `responseOrigin` shows which IP:port the response came from (for multi-homed servers)
- `otherAddress` is used for NAT type detection (RFC 5780)

### 2. `POST /api/stun/probe` — Lightweight STUN Health Check

Minimal check to see if a STUN server is alive. Sends a binding request without SOFTWARE attribute and validates the response.

**Request:** Same as binding endpoint

**Response:**
```json
{
  "success": true,
  "alive": true,
  "host": "stun.l.google.com",
  "port": 3478,
  "rtt": 39,
  "connectTime": 35,
  "validStun": true,
  "responseType": "Binding Success Response",
  "software": "Coturn-4.5.2",
  "hasXorMappedAddress": true,
  "hasMappedAddress": false,
  "attributeCount": 4
}
```

**Notes:**
- Lighter weight than full binding test (no SOFTWARE attribute sent)
- Returns boolean `alive` = valid STUN response received
- `validStun` = magic cookie correct AND transaction ID matches
- Useful for monitoring/health checks of STUN server pools

## Protocol Details

### Address Families

| Value | Family | Size |
|-------|--------|------|
| 0x01  | IPv4   | 4 bytes |
| 0x02  | IPv6   | 16 bytes |

### Comprehensive Attribute Types

| Code | Name | Description | XOR'd? |
|------|------|-------------|--------|
| 0x0001 | MAPPED-ADDRESS | Reflexive transport address (deprecated) | No |
| 0x0006 | USERNAME | Authentication username | N/A |
| 0x0008 | MESSAGE-INTEGRITY | HMAC-SHA1 integrity check | N/A |
| 0x0009 | ERROR-CODE | Error code and reason phrase | N/A |
| 0x000A | UNKNOWN-ATTRIBUTES | List of unknown comprehension-required attributes | N/A |
| 0x0014 | REALM | Authentication realm | N/A |
| 0x0015 | NONCE | Authentication nonce | N/A |
| 0x0020 | XOR-MAPPED-ADDRESS | Reflexive transport address (preferred) | Yes |
| 0x8022 | SOFTWARE | Server software description | N/A |
| 0x8023 | ALTERNATE-SERVER | Redirect to alternate server | No |
| 0x8028 | FINGERPRINT | CRC-32 fingerprint | N/A |
| 0x802B | RESPONSE-ORIGIN | Source address of response | No |
| 0x802C | OTHER-ADDRESS | Alternate IP/port for NAT type detection | No |

**Comprehension-required vs. optional:**
- Attributes 0x0000-0x7FFF: comprehension-required (unknown = error)
- Attributes 0x8000-0xFFFF: optional (unknown = ignore)

### Message Type Encoding

RFC 5389 uses a compound encoding to prevent false positives when sniffing mixed traffic:

```
     0                 1
     2  3  4 5 6 7 8 9 0 1 2 3 4 5
    +--+--+-+-+-+-+-+-+-+-+-+-+-+-+
    |M |M |M|M|M|C|M|M|M|C|M|M|M|M|
    |11|10|9|8|7|1|6|5|4|0|3|2|1|0|
    +--+--+-+-+-+-+-+-+-+-+-+-+-+-+
```

- M0-M11: 12-bit method (Binding = 0x001)
- C0-C1: 2-bit class (Request=0, Indication=1, Success=2, Error=3)

Examples:
- Binding Request: `0x0001` = method 0x001, class 0
- Binding Success: `0x0101` = method 0x001, class 2
- Binding Error: `0x0111` = method 0x001, class 3

### Timeout Handling

Two-phase timeout:
1. **Connection timeout:** Applied to socket open (lines 462-466, 602-606)
2. **Read timeout:** Applied to `readStunMessage` via Promise.race (line 421)

Total wall-clock time ≤ `timeout` parameter (default 10s for binding, 8s for probe).

### Cloudflare Detection

Before connecting, both endpoints call `checkIfCloudflare(host)` (lines 450-460, 590-600) to prevent abuse. Returns HTTP 403 with descriptive error if the target is Cloudflare-hosted.

## Known Limitations

1. **TCP only:** UDP not supported (Cloudflare Workers Sockets API is TCP-only)
2. **No TLS:** STUN-TLS (port 5349) not implemented
3. **No authentication:** MESSAGE-INTEGRITY, USERNAME, REALM, NONCE not implemented
4. **No FINGERPRINT:** CRC-32 fingerprint attribute not validated or generated
5. **Single request/response:** No support for long-term credentials or challenge/response
6. **No TURN:** Only STUN Binding; TURN allocate/refresh not supported
7. **No ICE:** Interactive Connectivity Establishment requires multiple STUN queries and candidate gathering
8. **IPv6 formatting:** IPv6 addresses not compressed (e.g., `2001:0db8:0000:0000:...` instead of `2001:db8::...`)
9. **No NAT type detection:** RFC 5780 STUN extensions not fully implemented (though OTHER-ADDRESS is parsed)
10. **No retransmission:** TCP provides reliability; UDP STUN requires app-level retransmit (not applicable here)
11. **Transaction ID entropy:** Uses `crypto.getRandomValues()` — secure but not verified against RFC 5389's uniqueness requirements over time
12. **SOFTWARE length:** No enforcement of 128-character maximum (RFC 5389 §15.10)
13. **Message size limit:** `readStunMessage` will read unbounded message sizes (no max enforced; attacker could specify huge length field)
14. **Error response handling:** Error responses parsed but `handleStunBinding` returns HTTP 500 instead of propagating STUN error codes to client

## Edge Cases

1. **Magic cookie mismatch:** Returns `validCookie: false` but still parses attributes
2. **Transaction ID mismatch:** Returns `transactionIdMatch: false` but still returns data
3. **Unknown attributes:** Logged as hex dump (lines 341-346), not enforced as error
4. **Multiple address attributes:** Last one wins (MAPPED-ADDRESS overwritten if both present)
5. **Truncated messages:** `readStunMessage` throws "Connection closed before complete STUN message"
6. **Oversized attributes:** No maximum size enforced; could cause memory issues
7. **Invalid address families:** Returns `null` from `decodeAddress`, attribute ignored
8. **Non-STUN responses:** Magic cookie check will fail; returns `validCookie: false`
9. **IPv4-mapped IPv6:** Not handled (would need family 0x01 inside 0x02 address)
10. **Padding violations:** Parser tolerates incorrect padding (just skips to next 4-byte boundary)

## Testing

### Public STUN Servers

```bash
# Google STUN (most reliable)
curl -X POST http://localhost:8787/api/stun/binding \
  -H "Content-Type: application/json" \
  -d '{"host": "stun.l.google.com", "port": 3478}'

# Cloudflare STUN (HTTP/3 QUIC focus, may not respond to TCP)
curl -X POST http://localhost:8787/api/stun/binding \
  -H "Content-Type: application/json" \
  -d '{"host": "stun.cloudflare.com", "port": 3478}'

# Twilio STUN (global anycast)
curl -X POST http://localhost:8787/api/stun/binding \
  -H "Content-Type: application/json" \
  -d '{"host": "global.stun.twilio.com", "port": 3478}'

# Mozilla STUN
curl -X POST http://localhost:8787/api/stun/binding \
  -H "Content-Type: application/json" \
  -d '{"host": "stun.services.mozilla.com", "port": 3478}'
```

### Probe Endpoint

```bash
# Quick health check
curl -X POST http://localhost:8787/api/stun/probe \
  -H "Content-Type: application/json" \
  -d '{"host": "stun.l.google.com", "port": 3478, "timeout": 5000}'

# Expected response
{
  "success": true,
  "alive": true,
  "validStun": true,
  "rtt": 45,
  "hasXorMappedAddress": true
}
```

### Command-Line STUN Testing

```bash
# Install stun CLI
npm install -g stun

# Test server directly
stun stun.l.google.com

# Linux: stun-client
sudo apt install stun-client
stunclient stun.l.google.com 3478

# Output shows public IP and port
STUN client version 0.97
Primary: Independent Mapping, Port Dependent Filter
Public Address: 203.0.113.42:54321
```

### NAT Type Detection (RFC 5780)

Full NAT type detection requires multiple STUN queries:
1. Binding request to primary address
2. Binding request with CHANGE-REQUEST attribute (not implemented)
3. Binding request to OTHER-ADDRESS (parsed but not used)

Current implementation only supports step 1.

## Resources

- **RFC 5389**: Session Traversal Utilities for NAT (STUN) — obsoleted by RFC 8489
- **RFC 8489**: STUN Update (current specification, 2020)
- **RFC 5780**: NAT Behavior Discovery Using STUN (NAT type detection)
- **RFC 5766**: TURN (Traversal Using Relays around NAT)
- **RFC 8445**: ICE (Interactive Connectivity Establishment) — WebRTC
- **RFC 8656**: TURN Update (current TURN spec, 2019)
- [IANA STUN Parameters](https://www.iana.org/assignments/stun-parameters/stun-parameters.xhtml) — official registry
- [WebRTC Samples](https://webrtc.github.io/samples/) — browser-based STUN/TURN/ICE
- [Public STUN Servers List](https://gist.github.com/mondain/b0ec1cf5f60ae726202e) — community-maintained

## Version Differences: RFC 5389 vs RFC 8489

RFC 8489 (2020) updates RFC 5389 (2008) with:
1. **Security improvements:** Mandates random transaction ID generation
2. **Clarifications:** Better describes TCP framing and attribute padding
3. **New attributes:** Adds PASSWORD-ALGORITHMS (0x8002), PASSWORD-ALGORITHM (0x001D), etc.
4. **DTLS support:** Defines STUN over DTLS (not applicable to this TCP-only implementation)
5. **Deprecations:** Formally deprecates MAPPED-ADDRESS in favor of XOR-MAPPED-ADDRESS

This implementation aligns with RFC 8489 requirements except for newer authentication attributes.

## Wire Format Examples

### Binding Request (20 bytes, no attributes)

```
00 01 00 00   Message Type: 0x0001 (Binding Request), Length: 0
21 12 A4 42   Magic Cookie: 0x2112A442
A3 F2 9C 81   Transaction ID (12 bytes):
7E 5A B2 C4   a3f29c817e5ab2c4
D9 E1 3F 76   d9e13f76
```

### Binding Response with XOR-MAPPED-ADDRESS (32 bytes)

```
01 01 00 0C   Message Type: 0x0101 (Success Response), Length: 12
21 12 A4 42   Magic Cookie
A3 F2 9C 81   Transaction ID (same as request)
7E 5A B2 C4
D9 E1 3F 76
00 20 00 08   Attribute: XOR-MAPPED-ADDRESS, Length: 8
00 01 D5 E6   Family: IPv4, X-Port: 0xD5E6
CB 12 91 43   X-Address: 0xCB129143
```

**Decoding XOR-MAPPED-ADDRESS:**
- X-Port: `0xD5E6 ^ 0x2112 = 0xF4F4` = 62708 (decimal)
- X-Address: `0xCB129143 ^ 0x2112A442 = 0xEA003501` = 234.0.53.1

### Error Response (420 Unknown Attribute)

```
01 11 00 14   Message Type: 0x0111 (Error Response), Length: 20
21 12 A4 42   Magic Cookie
A3 F2 9C 81   Transaction ID
7E 5A B2 C4
D9 E1 3F 76
00 09 00 10   Attribute: ERROR-CODE, Length: 16
00 00 04 14   Reserved, Class: 4, Number: 20 → 420
55 6E 6B 6E   Reason: "Unknown Attribute"
6F 77 6E 20
41 74 74 72
69 62 75 74 65
```

## Security Considerations

1. **No authentication:** Basic STUN has no client authentication; anyone can query
2. **Amplification attacks:** Open STUN servers can amplify DDoS (response > request)
3. **Privacy:** Reveals client's public IP address by design
4. **Spoofing:** UDP STUN vulnerable to response spoofing (TCP less so)
5. **MESSAGE-INTEGRITY:** Not implemented; no HMAC validation
6. **FINGERPRINT:** Not implemented; no CRC-32 validation
7. **TLS:** Not implemented; traffic is plaintext
8. **Rate limiting:** Not implemented; server could be abused for scanning
9. **Transaction ID entropy:** 96 bits from `crypto.getRandomValues()` — sufficient per RFC 5389 §6
10. **Cloudflare detection:** Mitigates abuse but not foolproof (DNS can change)

**Recommendations:**
- Use STUN-TLS (port 5349) in production (not yet implemented)
- Implement rate limiting per source IP
- Use MESSAGE-INTEGRITY for authenticated scenarios (e.g., TURN)
- Validate FINGERPRINT attribute when present
- Consider IP allowlisting for internal STUN servers

## Implementation Quality

**Strengths:**
- ✓ Correct RFC 5389/8489 message format
- ✓ Proper XOR-MAPPED-ADDRESS encoding/decoding
- ✓ IPv4 and IPv6 support
- ✓ Comprehensive attribute parsing
- ✓ TCP framing per RFC 5389 §7.2.2
- ✓ Transaction ID validation
- ✓ Two-phase timeout handling
- ✓ Cloudflare abuse prevention
- ✓ Detailed error responses

**Weaknesses (pre-fix):**
- ✗ RESPONSE-ORIGIN and OTHER-ADDRESS incorrectly XOR'd (fixed above)

**Weaknesses (design limitations):**
- No STUN-TLS support
- No authentication (MESSAGE-INTEGRITY, long-term credentials)
- No FINGERPRINT validation
- No message size limits (potential DoS vector)
- No ICE/TURN support
- IPv6 addresses not compressed
- Error responses don't propagate STUN error codes to HTTP layer

Overall: High-quality implementation for basic STUN Binding over TCP. Suitable for NAT discovery in controlled environments. Not suitable for production WebRTC (needs UDP, ICE, TURN).
