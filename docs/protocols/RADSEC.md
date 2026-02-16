# RADSEC Protocol Implementation

## Overview

**Protocol:** RADSEC (RADIUS over TLS)
**Port:** 2083
**RFC:** [RFC 6614](https://tools.ietf.org/html/rfc6614) (RADSEC), [RFC 2865](https://tools.ietf.org/html/rfc2865) (RADIUS)
**Complexity:** Medium
**Purpose:** Secure AAA (Authentication, Authorization, Accounting) for networks

RADSEC provides secure transport for RADIUS protocol by running it over TLS. This eliminates the need for shared secrets and MD5-based security, providing strong encryption and authentication for AAA traffic.

### Use Cases
- Secure wireless authentication (WPA2-Enterprise, eduroam)
- VPN authentication
- Network access control (802.1X)
- Enterprise authentication proxying
- Roaming authentication between organizations
- Healthcare and government secure networks

## Protocol Specification

### Wire Format

RADSEC uses standard RADIUS packet format over TLS:

```
Byte 0: Code (1 byte) - Packet type
Byte 1: Identifier (1 byte) - Matches requests with responses
Bytes 2-3: Length (2 bytes, big-endian) - Total packet length
Bytes 4-19: Authenticator (16 bytes) - Request/Response authenticator
Bytes 20+: Attributes (variable) - TLV-encoded attributes
```

### RADIUS Packet Codes
- **1**: Access-Request
- **2**: Access-Accept (authentication succeeded)
- **3**: Access-Reject (authentication failed)
- **4**: Accounting-Request
- **5**: Accounting-Response
- **11**: Access-Challenge (additional authentication needed)

### Common Attributes

| Type | Name | Description |
|------|------|-------------|
| 1 | User-Name | Username for authentication |
| 2 | User-Password | User password (encrypted in RADIUS, cleartext in RADSEC/TLS) |
| 4 | NAS-IP-Address | IP address of NAS (Network Access Server) |
| 5 | NAS-Port | Physical port number of NAS |
| 31 | Calling-Station-Id | MAC address or phone number of user |
| 32 | NAS-Identifier | Name of NAS |
| 80 | Message-Authenticator | HMAC-MD5 integrity check |

### Example Access-Request

```
Code: 1 (Access-Request)
Identifier: 157
Length: 76
Authenticator: [16 random bytes]

Attributes:
  Type 1 (User-Name): "alice@example.com"
  Type 2 (User-Password): "secret123"
  Type 32 (NAS-Identifier): "ap-building-a"
  Type 4 (NAS-IP-Address): 192.168.1.1
```

### Example Access-Accept Response

```
Code: 2 (Access-Accept)
Identifier: 157
Length: 20
Authenticator: [16 bytes calculated from request + shared secret]
```

## Worker Implementation

### Endpoints

- **POST /api/radsec/auth** - Send RADSEC authentication request
- **POST /api/radsec/connect** - Test RADSEC server connectivity

### RADSEC Auth Request

```json
{
  "host": "radius.example.com",
  "port": 2083,
  "username": "alice@example.com",
  "password": "secret123",
  "nasIdentifier": "ap-building-a",
  "nasIpAddress": "192.168.1.1",
  "timeout": 15000
}
```

### RADSEC Auth Response

```json
{
  "success": true,
  "host": "radius.example.com",
  "port": 2083,
  "code": 2,
  "codeText": "Access-Accept",
  "identifier": 157,
  "attributes": {
    "1": "alice@example.com"
  },
  "rtt": 245
}
```

## Key Features

### TLS Encryption
- All RADIUS traffic encrypted with TLS
- No shared secret needed (unlike traditional RADIUS)
- Certificate-based server authentication
- Port 2083 standard for RADSEC
- Strong cryptography vs. MD5 in traditional RADIUS

### RADIUS Attributes
- **Type-Length-Value (TLV) encoding**
- Variable-length attributes
- Extensible attribute space
- Standard and vendor-specific attributes supported

### Identifier Matching
- Request identifier copied to response
- Used to match responses with requests
- Random 8-bit value (0-255)
- Prevents replay attacks

## Security Considerations

### TLS Security
- RADSEC mandates TLS 1.2 or higher
- Certificate validation ensures server identity
- Perfect Forward Secrecy (PFS) recommended
- No shared secrets in packet (unlike RADIUS)

### Password Handling
- In traditional RADIUS, password is obfuscated with MD5(shared-secret + authenticator)
- In RADSEC, password can be sent cleartext in attribute because TLS encrypts entire packet
- TLS provides stronger encryption than RADIUS obfuscation
- Still recommended to use EAP methods instead of cleartext passwords

### Authentication Methods
- **PAP**: Password Authentication Protocol (simple username/password)
- **CHAP**: Challenge Handshake Authentication Protocol
- **EAP**: Extensible Authentication Protocol (most secure)
  - EAP-TLS: Certificate-based
  - EAP-TTLS: Tunneled TLS
  - PEAP: Protected EAP
  - EAP-MSCHAPv2: Microsoft CHAP

## Differences from RADIUS

| Feature | RADIUS (UDP) | RADSEC (TCP/TLS) |
|---------|-------------|------------------|
| Transport | UDP | TCP with TLS |
| Port | 1812 (auth), 1813 (acct) | 2083 |
| Encryption | MD5 obfuscation | TLS encryption |
| Shared Secret | Required | Not required |
| Reliability | Best-effort (UDP) | Guaranteed (TCP) |
| Security | Weak (MD5) | Strong (TLS) |

## Testing

### Test Endpoints
- **FreeRADIUS** with RADSEC enabled
- **eduroam** infrastructure (requires credentials)
- Local FreeRADIUS server with TLS configuration
- Test RADSEC servers (rare in public)

### FreeRADIUS Configuration

```conf
# clients.conf
client radsec {
    ipaddr = 0.0.0.0/0
    proto = tls
    secret = radsec
}

# sites-enabled/tls
listen {
    type = auth
    ipaddr = *
    port = 2083
    proto = tcp

    tls {
        private_key_password = whatever
        private_key_file = ${certdir}/server.key
        certificate_file = ${certdir}/server.pem
        ca_file = ${cadir}/ca.pem
        dh_file = ${certdir}/dh
        random_file = /dev/urandom
    }
}
```

### Example cURL Request

```bash
curl -X POST http://localhost:8787/api/radsec/auth \
  -H "Content-Type: application/json" \
  -d '{
    "host": "radius.example.com",
    "port": 2083,
    "username": "alice@example.com",
    "password": "secret123",
    "nasIdentifier": "test-ap-01"
  }'
```

## References

- **RFC 6614**: [RADSEC Protocol Specification](https://tools.ietf.org/html/rfc6614)
- **RFC 2865**: [RADIUS Protocol](https://tools.ietf.org/html/rfc2865)
- **RFC 2866**: [RADIUS Accounting](https://tools.ietf.org/html/rfc2866)
- **RFC 3579**: [RADIUS Support for EAP](https://tools.ietf.org/html/rfc3579)
- **RFC 5176**: [Dynamic Authorization Extensions to RADIUS](https://tools.ietf.org/html/rfc5176)
- **FreeRADIUS**: [Documentation](https://freeradius.org/documentation/)
- **eduroam**: [Global Research and Education Network](https://eduroam.org/)

## Implementation Notes

- Uses TLS via `secureTransport: 'on'` option in Cloudflare Workers
- Identifier is randomly generated (0-255)
- Request Authenticator is 16 random bytes
- Password sent as cleartext attribute (TLS encrypts it)
- Attributes use Type-Length-Value encoding
- Big-endian byte order for packet length
- Identifier matching validates response
- Response code 2 (Access-Accept) indicates success
- Response code 3 (Access-Reject) indicates failure

## eduroam Example

eduroam (education roaming) is a global RADSEC network for research and education:

```json
{
  "host": "radius.eduroam.org",
  "port": 2083,
  "username": "alice@university.edu",
  "password": "userpassword",
  "nasIdentifier": "campus-wifi"
}
```

## Future Enhancements

- EAP method support (EAP-TLS, PEAP, EAP-TTLS)
- Accounting packet support (Accounting-Request/Response)
- Dynamic Authorization (CoA, Disconnect-Request)
- Message-Authenticator attribute (HMAC-MD5)
- Vendor-Specific Attributes (VSAs)
- RADIUS proxy/relay functionality
- Client certificate support for mutual TLS
- Connection pooling for persistent sessions
