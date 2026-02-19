# RADSEC (RADIUS over TLS) — RFC 6614

RADSEC provides secure transport for RADIUS protocol using TLS encryption. It eliminates the need for hop-by-hop shared secrets and provides strong encryption for AAA (Authentication, Authorization, and Accounting) traffic.

## Protocol Specifications

- **RFC 6614**: Transport Layer Security (TLS) Encryption for RADIUS
- **RFC 2865**: Remote Authentication Dial In User Service (RADIUS)
- **RFC 2866**: RADIUS Accounting
- **RFC 3579**: RADIUS Support for EAP (Message-Authenticator)
- **Default Port**: 2083/TCP
- **Transport**: TLS 1.2+ over TCP

## Endpoints

### POST /api/radsec/auth

Authenticate user via RADSEC Access-Request.

**Request:**
```json
{
  "host": "radius.example.com",
  "port": 2083,
  "username": "testuser",
  "password": "testpass",
  "nasIdentifier": "nas-01",
  "nasIpAddress": "192.0.2.1",
  "timeout": 15000
}
```

**Fields:**
- `host` (required): RADSEC server hostname or IP address
- `port` (optional): Server port (default: 2083, range: 1-65535)
- `username` (required): User-Name attribute value
- `password` (required): User-Password attribute value (encrypted per RFC 2865)
- `nasIdentifier` (optional): NAS-Identifier attribute (Type 32)
- `nasIpAddress` (optional): NAS-IP-Address attribute (Type 4, IPv4 dotted-decimal)
- `timeout` (optional): Connection + response timeout in milliseconds (default: 15000)

**Response (Access-Accept):**
```json
{
  "success": true,
  "host": "radius.example.com",
  "port": 2083,
  "code": 2,
  "codeText": "Access-Accept",
  "identifier": 147,
  "attributes": {
    "1": "testuser",
    "32": "nas-01"
  },
  "rtt": 234
}
```

**Response (Access-Reject):**
```json
{
  "success": false,
  "host": "radius.example.com",
  "port": 2083,
  "code": 3,
  "codeText": "Access-Reject",
  "identifier": 147,
  "attributes": {},
  "rtt": 189
}
```

**Response (Error):**
```json
{
  "success": false,
  "host": "radius.example.com",
  "port": 2083,
  "error": "Connection timeout"
}
```

**Response Fields:**
- `success`: true if Access-Accept (code 2), false otherwise
- `host`, `port`: Echo of request parameters
- `code`: RADIUS response code (2=Accept, 3=Reject, 11=Challenge)
- `codeText`: Human-readable code name
- `identifier`: RADIUS packet identifier (matches request)
- `attributes`: Response attributes keyed by type number
  - String attributes (1, 32): Decoded as UTF-8
  - Binary attributes: Hex-encoded
- `rtt`: Round-trip time in milliseconds (TLS handshake + request + response)
- `error`: Error message (only on failure)

### POST /api/radsec/connect

Test TLS connection to RADSEC server (no RADIUS exchange).

**Request:**
```json
{
  "host": "radius.example.com",
  "port": 2083,
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "host": "radius.example.com",
  "port": 2083,
  "rtt": 156,
  "message": "RADSEC connection successful (TLS established)"
}
```

### POST /api/radsec/accounting

Send RADIUS Accounting-Request over TLS.

**Request:**
```json
{
  "host": "radius.example.com",
  "port": 2083,
  "username": "testuser",
  "nasIdentifier": "nas-01",
  "nasIpAddress": "192.0.2.1",
  "acctStatusType": 1,
  "acctSessionId": "session-12345",
  "acctInputOctets": 1024000,
  "acctOutputOctets": 2048000,
  "acctSessionTime": 3600,
  "timeout": 15000
}
```

**Fields:**
- `host` (required): RADSEC server hostname
- `port` (optional): Server port (default: 2083)
- `username` (required): User-Name attribute
- `nasIdentifier` (optional): NAS-Identifier attribute
- `nasIpAddress` (optional): NAS-IP-Address attribute (IPv4)
- `acctStatusType` (optional): Acct-Status-Type (1=Start, 2=Stop, 3=Interim-Update, default: 1)
- `acctSessionId` (optional): Acct-Session-Id attribute (Type 44)
- `acctInputOctets` (optional): Acct-Input-Octets (Type 42, default: 0)
- `acctOutputOctets` (optional): Acct-Output-Octets (Type 43, default: 0)
- `acctSessionTime` (optional): Acct-Session-Time in seconds (Type 46, default: 0)
- `timeout` (optional): Timeout in milliseconds (default: 15000)

**Response:**
```json
{
  "success": true,
  "host": "radius.example.com",
  "port": 2083,
  "code": 5,
  "codeText": "Accounting-Response",
  "acctStatusType": 1,
  "acctStatusLabel": "Start",
  "rtt": 201
}
```

## RADIUS Packet Format

All RADIUS packets follow RFC 2865 structure:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|     Code      |  Identifier   |            Length             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
|                     Authenticator (16 bytes)                  |
|                                                               |
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  Attributes ...
+-+-+-+-+-+-+-+-+-+-+-+-+-
```

**Header Fields:**
- **Code** (1 byte): Packet type
  - 1 = Access-Request
  - 2 = Access-Accept
  - 3 = Access-Reject
  - 4 = Accounting-Request
  - 5 = Accounting-Response
  - 11 = Access-Challenge
- **Identifier** (1 byte): Matches requests with responses (0-255, random)
- **Length** (2 bytes): Total packet length including header (20-4096 bytes)
- **Authenticator** (16 bytes): Request or Response Authenticator

**Attribute Format (TLV):**
```
 0                   1                   2
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|     Type      |    Length     |  Value ...
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

- **Type** (1 byte): Attribute type number
- **Length** (1 byte): Attribute length including Type+Length (2-255)
- **Value** (variable): Attribute value

## Supported RADIUS Attributes

### Access-Request Attributes (Sent)

| Type | Name | Format | Description |
|------|------|--------|-------------|
| 1 | User-Name | String | Username for authentication |
| 2 | User-Password | Encrypted | Password encrypted with shared secret "radsec" |
| 4 | NAS-IP-Address | IPv4 (4 bytes) | NAS IPv4 address |
| 32 | NAS-Identifier | String | NAS identifier string |
| 80 | Message-Authenticator | Binary (16 bytes) | HMAC-MD5 integrity check (RFC 3579) |

### Accounting-Request Attributes (Sent)

| Type | Name | Format | Description |
|------|------|--------|-------------|
| 1 | User-Name | String | Username |
| 4 | NAS-IP-Address | IPv4 (4 bytes) | NAS IPv4 address |
| 32 | NAS-Identifier | String | NAS identifier |
| 40 | Acct-Status-Type | Integer (4 bytes) | 1=Start, 2=Stop, 3=Interim-Update |
| 42 | Acct-Input-Octets | Integer (4 bytes) | Bytes received from user |
| 43 | Acct-Output-Octets | Integer (4 bytes) | Bytes sent to user |
| 44 | Acct-Session-Id | String | Session identifier |
| 46 | Acct-Session-Time | Integer (4 bytes) | Session duration in seconds |

### Response Attributes (Received)

All attribute types are parsed. String attributes (1, 32) are UTF-8 decoded. Other types are hex-encoded in response.

## Cryptographic Details

### Shared Secret (RFC 6614 §2.3)

**CRITICAL**: RADSEC mandates the shared secret **"radsec"** for all RADIUS packet encryption and integrity checks. This is fixed by RFC 6614 and cannot be changed.

The shared secret is used for:
1. User-Password encryption (RFC 2865 §5.2)
2. Response Authenticator validation (RFC 2865 §3)
3. Message-Authenticator HMAC-MD5 (RFC 3579 §3.2)
4. Accounting-Request Authenticator (RFC 2866 §3)

### User-Password Encryption (RFC 2865 §5.2)

User-Password is encrypted before transmission:

1. **Pad password** to multiple of 16 bytes (null-padded)
2. **Compute encryption key**: `MD5(secret + Request Authenticator)`
3. **XOR first 16 bytes** of padded password with encryption key
4. For passwords >16 bytes:
   - Compute next key: `MD5(secret + previous ciphertext block)`
   - XOR next 16 bytes with new key
   - Repeat until all blocks encrypted

**Example (password "secret"):**
```
Padded password: "secret" + 10 nulls = [73 65 63 72 65 74 00 00 00 00 00 00 00 00 00 00]
Shared secret: "radsec" = [72 61 64 73 65 63]
Request Auth: [a1 b2 c3 ... (16 random bytes)]
Encryption key: MD5([72 61 64 73 65 63 a1 b2 c3 ...])
Encrypted: padded_password XOR encryption_key
```

### Message-Authenticator (RFC 3579 §3.2)

Protects Access-Request from insertion/deletion/modification attacks.

**Computation:**
1. Build packet with Message-Authenticator field zeroed
2. Compute: `HMAC-MD5(shared_secret, packet_with_zeroed_msg_auth)`
3. Replace zeroed field with HMAC-MD5 output (16 bytes)

**Placement**: Always last attribute in Access-Request packets.

### Response Authenticator Validation (RFC 2865 §3)

Validates Access-Accept/Reject responses:

1. **Extract** Response Authenticator from received packet (bytes 4-19)
2. **Build validation packet**: Replace Response Authenticator with Request Authenticator
3. **Append shared secret** to validation packet
4. **Compute**: `MD5(validation_packet + shared_secret)`
5. **Compare** computed hash with extracted Response Authenticator
6. **Reject** packet if mismatch (potential spoofing)

### Accounting-Request Authenticator (RFC 2866 §3)

Different from Access-Request authenticator:

1. **Build packet** with Authenticator field set to **16 zero bytes**
2. **Append shared secret**
3. **Compute**: `MD5(packet_with_zeros + shared_secret)`
4. **Replace** zeroed Authenticator field with computed hash

### Random Number Generation

- **Request Authenticator**: 16 cryptographically random bytes via `crypto.getRandomValues()`
- **Identifier**: Random 8-bit value (0-255) via `crypto.getRandomValues()`

**Security**: Uses Web Crypto API for CSPRNG (not `Math.random()`).

## Wire Protocol Flow

### Authentication Flow

```
Client                                    RADSEC Server
  |                                             |
  |--- TLS ClientHello ------------------------>|
  |<-- TLS ServerHello, Certificate, Done ------|
  |--- TLS ClientKeyExchange, Finished -------->|
  |<-- TLS Finished -----------------------------|
  |                                             |
  | [TLS 1.2+ Handshake Complete]               |
  |                                             |
  |--- Access-Request (encrypted) ------------->|
  |    Code: 1                                  |
  |    Identifier: random                       |
  |    Authenticator: 16 random bytes           |
  |    Attributes:                              |
  |      User-Name                              |
  |      User-Password (encrypted with "radsec")|
  |      NAS-Identifier (optional)              |
  |      NAS-IP-Address (optional)              |
  |      Message-Authenticator (HMAC-MD5)       |
  |                                             |
  |<-- Access-Accept/Reject ---------------------|
  |    Code: 2 or 3                             |
  |    Identifier: matches request              |
  |    Authenticator: MD5(packet+secret)        |
  |    Attributes: server-defined               |
  |                                             |
  |--- TLS Close -------------------------------->|
  |<-- TLS Close --------------------------------|
```

**RTT Measurement**: `Date.now()` delta from TLS handshake start to RADIUS response received.

### Accounting Flow

```
Client                                    RADSEC Server
  |                                             |
  |--- TLS Handshake (same as auth) ----------->|
  |<-- TLS Handshake Complete -------------------|
  |                                             |
  |--- Accounting-Request --------------------->|
  |    Code: 4                                  |
  |    Identifier: random                       |
  |    Authenticator: MD5(pkt_with_zeros+secret)|
  |    Attributes:                              |
  |      User-Name                              |
  |      Acct-Status-Type                       |
  |      Acct-Session-Id                        |
  |      Acct-Input-Octets                      |
  |      Acct-Output-Octets                     |
  |      Acct-Session-Time                      |
  |      NAS-Identifier (optional)              |
  |      NAS-IP-Address (optional)              |
  |                                             |
  |<-- Accounting-Response ----------------------|
  |    Code: 5                                  |
  |    Identifier: matches request              |
  |    Authenticator: MD5(packet+secret)        |
  |                                             |
  |--- TLS Close -------------------------------->|
```

## Implementation Notes

### TLS Configuration

- **secureTransport**: `"on"` (Cloudflare Workers TLS socket)
- **ALPN**: Not set (RFC 6614 does not mandate ALPN "dot" like DNS-over-TLS)
- **SNI**: Automatically sent by Cloudflare Workers based on hostname
- **Certificate Validation**: Performed by Workers runtime (no custom validation)
- **Cipher Suites**: Chosen by Workers runtime (TLS 1.2+ with strong ciphers)

### Connection Lifecycle

1. **TLS Handshake**: `socket.opened` promise resolves when TLS established
2. **Write**: Single `writer.write(radiusRequest)` for entire RADIUS packet
3. **Read**: Stream chunks until complete RADIUS packet received
   - Packet length read from bytes 2-3 (big-endian)
   - Reading stops when `totalBytes >= packetLength`
4. **Close**: `socket.close()` immediately after response parsed

**No Connection Reuse**: Each request creates new TLS connection. RFC 6614 §3.4 recommends connection reuse for performance, but implementation prioritizes simplicity.

### Packet Assembly

RADIUS packets arrive in variable-sized chunks over TCP. Complete packet detection:

```typescript
if (totalBytes >= 4) {
  const packetLength = (combined[2] << 8) | combined[3];
  if (totalBytes >= packetLength) {
    break; // Complete packet received
  }
}
```

**Max Response Size**: 4096 bytes (typical RADIUS packets are 20-500 bytes).

### Timeout Behavior

Single timeout covers entire operation:
- TLS handshake
- RADIUS request transmission
- Response read

**Default**: 15 seconds. Timeout errors return HTTP 500 with `error: "Connection timeout"`.

### Error Handling

**Validation Errors (HTTP 400):**
- Missing host
- Missing username or password
- Invalid port (not 1-65535)

**Protocol Errors (HTTP 200 with `success: false`):**
- Empty response from server
- Invalid RADIUS packet format
- Identifier mismatch
- Response Authenticator validation failure

**Connection Errors (HTTP 500):**
- TLS handshake failure
- Network unreachable
- Timeout
- Socket errors

## Security Considerations

### Strengths

1. **TLS Encryption**: All RADIUS traffic encrypted end-to-end over TLS 1.2+
2. **Cryptographic RNG**: Request Authenticator and Identifier use `crypto.getRandomValues()`
3. **Message-Authenticator**: HMAC-MD5 protects Access-Request integrity (RFC 3579)
4. **Response Validation**: Response Authenticator verified using MD5 hash (RFC 2865 §3)
5. **Password Encryption**: User-Password encrypted per RFC 2865 §5.2 (even though TLS encrypts again)
6. **Fixed Shared Secret**: Uses RFC 6614 mandated "radsec" secret

### Limitations

1. **No ALPN**: Does not negotiate ALPN "radsec" token (not required by RFC 6614)
2. **No Client Certificates**: TLS-PSK or TLS-X.509 client auth not implemented
3. **No Connection Reuse**: Each request creates new TLS connection (RFC 6614 §3.4 recommends reuse)
4. **No Dynamic Trust**: Only validates server certificate chain, no fingerprint pinning
5. **MD5 Dependency**: RADIUS protocol inherently uses MD5 (not collision-resistant, but used only for integrity not signature)
6. **No EDNS0**: RADIUS does not support extension mechanisms like DNS EDNS0

### Threat Model

**Mitigated:**
- Eavesdropping (TLS encryption)
- MITM on transport (TLS certificate validation)
- Packet modification (Message-Authenticator, Response Authenticator)
- Replay attacks (random Request Authenticator)

**Not Mitigated:**
- Compromised RADSEC server (end-to-end trust required)
- Weak passwords (protocol allows any password, application must enforce strength)
- DoS via resource exhaustion (no rate limiting in protocol)

## Known Issues and Quirks

1. **No connection reuse**: Creates new TLS connection per request instead of persistent connection pool (RFC 6614 §3.4 recommends reuse for reduced latency).

2. **Shared timeout**: TLS handshake and RADIUS exchange share single timeout value. Slow TLS negotiation reduces time available for RADIUS response.

3. **No SNI in some cases**: If `host` is IP address, SNI may not be sent by Workers runtime (server must present certificate valid for IP).

4. **Attribute decoding**: Only User-Name (1) and NAS-Identifier (32) decoded as UTF-8. All other attributes hex-encoded in response. Power users must decode attributes manually.

5. **No Access-Challenge support**: Access-Challenge (code 11) packets returned as-is but no mechanism to respond with next Access-Request for EAP/CHAP flows.

6. **No vendor-specific attributes (VSA)**: Attribute type 26 parsed as binary, not decoded into vendor-specific structure.

7. **No attribute validation**: Accepts any attribute type/length/value from server without schema validation.

8. **IPv4-only NAS-IP-Address**: Type 4 attribute only supports IPv4. No support for NAS-IPv6-Address (type 95, RFC 3162).

9. **MD5 usage**: Protocol uses MD5 for authenticators (not collision-resistant). However, MD5 used only for integrity checks, not cryptographic signatures. TLS provides strong encryption layer.

10. **No proxy support**: Cannot route through RADIUS proxy chains (direct server connection only).

11. **No failover**: Single server per request. No automatic retry to backup servers.

12. **No certificate pinning**: Trusts any valid certificate signed by system CAs. No TOFU or fingerprint validation.

13. **Accounting-Response not validated**: Accounting-Response Authenticator not validated (RFC 2866 does not specify validation algorithm, only generation).

14. **No retransmission**: TCP/TLS handles reliability, but no application-level RADIUS retransmission logic.

15. **No duplicate detection**: No duplicate request detection (RFC 2865 §2 allows duplicate Identifier within 30 seconds).

## Use Cases

### WPA2-Enterprise Authentication

```bash
curl -X POST https://portofcall.ross.gg/api/radsec/auth \
  -H "Content-Type: application/json" \
  -d '{
    "host": "radius.eduroam.org",
    "port": 2083,
    "username": "student@university.edu",
    "password": "SecurePass123",
    "nasIdentifier": "ap-building-01",
    "nasIpAddress": "10.1.2.3",
    "timeout": 10000
  }'
```

### VPN Authentication

```bash
curl -X POST https://portofcall.ross.gg/api/radsec/auth \
  -H "Content-Type: application/json" \
  -d '{
    "host": "vpn-radius.corp.example.com",
    "port": 2083,
    "username": "alice",
    "password": "correct-horse-battery-staple",
    "nasIdentifier": "vpn-gateway-01",
    "timeout": 15000
  }'
```

### 802.1X Network Access Control

```bash
curl -X POST https://portofcall.ross.gg/api/radsec/auth \
  -H "Content-Type: application/json" \
  -d '{
    "host": "nac.example.com",
    "port": 2083,
    "username": "device-mac-00:11:22:33:44:55",
    "password": "device-preshared-key",
    "nasIpAddress": "172.16.5.10",
    "timeout": 5000
  }'
```

### Accounting Start (Session Begin)

```bash
curl -X POST https://portofcall.ross.gg/api/radsec/accounting \
  -H "Content-Type: application/json" \
  -d '{
    "host": "radius.example.com",
    "port": 2083,
    "username": "alice",
    "nasIdentifier": "nas-01",
    "acctStatusType": 1,
    "acctSessionId": "session-abc123",
    "timeout": 10000
  }'
```

### Accounting Stop (Session End with Stats)

```bash
curl -X POST https://portofcall.ross.gg/api/radsec/accounting \
  -H "Content-Type: application/json" \
  -d '{
    "host": "radius.example.com",
    "port": 2083,
    "username": "alice",
    "nasIdentifier": "nas-01",
    "acctStatusType": 2,
    "acctSessionId": "session-abc123",
    "acctInputOctets": 5242880,
    "acctOutputOctets": 10485760,
    "acctSessionTime": 3600,
    "timeout": 10000
  }'
```

### Connection Test

```bash
curl -X POST https://portofcall.ross.gg/api/radsec/connect \
  -H "Content-Type: application/json" \
  -d '{
    "host": "radius.example.com",
    "port": 2083,
    "timeout": 5000
  }'
```

## Comparison: RADSEC vs Traditional RADIUS

| Feature | RADSEC (RFC 6614) | RADIUS/UDP (RFC 2865) |
|---------|-------------------|----------------------|
| **Transport** | TLS over TCP | UDP (port 1812) |
| **Encryption** | Full TLS encryption | Hop-by-hop MD5 obfuscation |
| **Shared Secret** | Fixed "radsec" (RFC 6614) | Configured per NAS |
| **Reliability** | TCP (automatic retransmission) | UDP (manual retransmission) |
| **Port** | 2083/TCP | 1812/UDP (auth), 1813/UDP (accounting) |
| **Connection** | Persistent TLS session | Stateless datagrams |
| **NAT-Friendly** | Yes (TCP) | Requires port forwarding |
| **Firewall Visibility** | TLS encrypted (opaque) | Packet inspection possible |
| **Certificate Auth** | Supported (TLS client certs) | Not supported |
| **Proxy Support** | TLS/TCP proxies | UDP NAT traversal |
| **Latency** | Higher (TLS handshake) | Lower (single UDP packet) |
| **Packet Size** | Up to 64 KB (TCP) | Limited by MTU (~1500 bytes) |
| **Use Case** | Roaming (eduroam), federated auth | LAN authentication |

## RFC Compliance

### RFC 6614 (RADSEC)

- ✅ **§2.3**: Uses shared secret "radsec" for all RADIUS crypto operations
- ✅ **§2.4**: Uses TLS 1.2+ for transport encryption
- ❌ **§3.4**: Does not implement connection reuse (creates new connection per request)
- ⚠️ **§2.6**: No ALPN negotiation (not strictly required)

### RFC 2865 (RADIUS)

- ✅ **§3**: Validates Response Authenticator using MD5(Code+ID+Length+RequestAuth+Attributes+Secret)
- ✅ **§5.2**: Encrypts User-Password with MD5(secret+authenticator) XOR scheme
- ✅ **§2**: Uses cryptographically random Request Authenticator (16 bytes)
- ✅ **§2**: Matches Identifier in response with request
- ⚠️ **§2**: No duplicate request detection (allows duplicate Identifiers)

### RFC 2866 (RADIUS Accounting)

- ✅ **§3**: Computes Accounting-Request Authenticator as MD5(Code+ID+Length+16zero+Attributes+Secret)
- ✅ **§3**: Sends Acct-Status-Type attribute (Type 40)
- ⚠️ **§3**: Does not validate Accounting-Response Authenticator (RFC does not specify algorithm)

### RFC 3579 (RADIUS EAP Support)

- ✅ **§3.2**: Includes Message-Authenticator (Type 80) in Access-Request
- ✅ **§3.2**: Computes Message-Authenticator as HMAC-MD5(secret, packet)
- ❌ **EAP Flow**: No support for Access-Challenge roundtrip (EAP methods require multiple exchanges)

## Debugging

### Enable Verbose Logging

Implementation does not log to console. Debug by inspecting response fields:

- **rtt**: High values (>2000ms) indicate network/TLS slowness
- **identifier**: Should be random, not sequential
- **attributes**: Check for unexpected attributes from server
- **error**: Parse error messages for root cause

### Test TLS Handshake Only

```bash
curl -X POST https://portofcall.ross.gg/api/radsec/connect \
  -H "Content-Type: application/json" \
  -d '{"host": "radius.example.com", "timeout": 5000}'
```

If `connect` succeeds but `auth` fails, issue is RADIUS-layer not TLS.

### Verify Server Certificate

```bash
openssl s_client -connect radius.example.com:2083 -showcerts
```

Check certificate validity, expiration, and SAN/CN matching hostname.

### Decode Hex Attributes

Response attributes (except 1, 32) are hex-encoded. Decode manually:

```bash
# Attribute 4 (NAS-IP-Address): "c0000201" -> 192.0.2.1
echo "c0000201" | xxd -r -p | od -An -tu1
# Output: 192   0   2   1
```

### Wireshark Capture

RADSEC traffic is TLS-encrypted. Capture shows:
- TLS handshake (Client/Server Hello)
- Application Data (encrypted RADIUS packets)

Cannot decrypt without server private key or session keys.

## Performance Notes

- **TLS Handshake**: 100-300ms overhead per connection (varies by server distance)
- **RADIUS Processing**: Typically <50ms on server side
- **Total RTT**: Expect 200-500ms for full auth flow
- **Connection Reuse**: Not implemented (would reduce latency by ~100-300ms per request)
- **Timeout Recommendations**:
  - LAN: 5000ms
  - WAN: 15000ms
  - Intercontinental: 30000ms

## Standards References

- [RFC 6614 - Transport Layer Security (TLS) Encryption for RADIUS](https://datatracker.ietf.org/doc/html/rfc6614)
- [RFC 2865 - Remote Authentication Dial In User Service (RADIUS)](https://datatracker.ietf.org/doc/html/rfc2865)
- [RFC 2866 - RADIUS Accounting](https://datatracker.ietf.org/doc/html/rfc2866)
- [RFC 3579 - RADIUS Support for Extensible Authentication Protocol (EAP)](https://datatracker.ietf.org/doc/html/rfc3579)
- [RFC 3162 - RADIUS and IPv6](https://datatracker.ietf.org/doc/html/rfc3162)

## Implementation Source

- **File**: `/Users/rj/gd/code/portofcall/src/worker/radsec.ts`
- **Tests**: `/Users/rj/gd/code/portofcall/tests/radsec.test.ts`
- **Line Count**: ~750 lines TypeScript
- **Crypto APIs**: Web Crypto API (`crypto.subtle`, `crypto.getRandomValues()`)
