# SIPS Protocol Implementation

## Overview

**Protocol:** SIP Secure (SIP over TLS)
**Port:** 5061
**RFC:** [RFC 3261](https://tools.ietf.org/html/rfc3261) (SIP), [RFC 5630](https://tools.ietf.org/html/rfc5630) (SIPS URI), [RFC 5246](https://tools.ietf.org/html/rfc5246) (TLS)
**Complexity:** Medium-High
**Purpose:** Secure VoIP signaling and session management

SIPS is the secure variant of the Session Initiation Protocol, using TLS (Transport Layer Security) to encrypt all signaling messages. It provides confidentiality and integrity for VoIP calls, video conferences, and instant messaging sessions.

### Use Cases
- Secure VoIP signaling
- Private video conferencing
- Enterprise communication systems
- Encrypted instant messaging setup
- Session management with privacy guarantees
- Regulatory compliance (HIPAA, financial services)

## Protocol Specification

### Wire Format

SIPS uses the same text-based format as SIP, but over a TLS-encrypted connection:

```
<METHOD> <Request-URI> SIP/2.0
Via: SIP/2.0/TLS <client-address>;branch=<branch-id>
From: <from-uri>;tag=<from-tag>
To: <to-uri>
Call-ID: <call-id>
CSeq: <sequence> <METHOD>
Max-Forwards: 70
User-Agent: <agent-string>
Content-Length: 0
```

### Request Methods
- **OPTIONS**: Capability query
- **REGISTER**: Register a SIP URI with a server
- **INVITE**: Initiate a session (call)
- **ACK**: Acknowledge INVITE
- **BYE**: Terminate session
- **CANCEL**: Cancel pending request
- **INFO**, **UPDATE**, **REFER**, etc.

### Response Codes
- **1xx**: Informational (100 Trying, 180 Ringing)
- **2xx**: Success (200 OK)
- **3xx**: Redirection (301 Moved Permanently, 302 Moved Temporarily)
- **4xx**: Client Error (401 Unauthorized, 404 Not Found, 407 Proxy Authentication Required)
- **5xx**: Server Error (500 Internal Server Error, 503 Service Unavailable)
- **6xx**: Global Failure (600 Busy Everywhere, 603 Decline)

### Example Session

**OPTIONS Request:**
```
OPTIONS sips:bob@example.com SIP/2.0
Via: SIP/2.0/TLS client.example.com:5061;branch=z9hG4bKnashds8
From: <sips:alice@example.com>;tag=1928301774
To: <sips:bob@example.com>
Call-ID: a84b4c76e66710
CSeq: 63104 OPTIONS
Max-Forwards: 70
User-Agent: PortOfCall/1.0
Content-Length: 0
```

**Response:**
```
SIP/2.0 200 OK
Via: SIP/2.0/TLS client.example.com:5061;branch=z9hG4bKnashds8
From: <sips:alice@example.com>;tag=1928301774
To: <sips:bob@example.com>;tag=a6c85cf
Call-ID: a84b4c76e66710
CSeq: 63104 OPTIONS
Contact: <sips:bob@192.0.2.4>
Accept: application/sdp
Allow: INVITE, ACK, CANCEL, OPTIONS, BYE
Content-Length: 0
```

## Worker Implementation

### Endpoints

- **POST /api/sips/options** - Send SIPS OPTIONS request to query capabilities
- **POST /api/sips/register** - Send SIPS REGISTER request for user registration

### SIPS OPTIONS Request

```json
{
  "host": "sip.example.com",
  "port": 5061,
  "fromUri": "sips:alice@example.com",
  "toUri": "sips:bob@example.com",
  "timeout": 15000
}
```

### SIPS OPTIONS Response

```json
{
  "success": true,
  "host": "sip.example.com",
  "port": 5061,
  "statusCode": 200,
  "statusText": "OK",
  "headers": {
    "Via": "SIP/2.0/TLS ...",
    "From": "<sips:alice@example.com>;tag=...",
    "To": "<sips:bob@example.com>;tag=...",
    "Call-ID": "...",
    "CSeq": "1 OPTIONS",
    "Accept": "application/sdp",
    "Allow": "INVITE, ACK, CANCEL, OPTIONS, BYE"
  },
  "callId": "a84b4c76e66710@portofcall",
  "rtt": 245
}
```

### SIPS REGISTER Request

```json
{
  "host": "sip.example.com",
  "port": 5061,
  "fromUri": "sips:alice@example.com",
  "username": "alice",
  "password": "secret123",
  "timeout": 15000
}
```

## Key Features

### TLS Encryption
- All signaling encrypted with TLS
- Uses `secureTransport: 'on'` option in Cloudflare Workers
- Port 5061 standard for SIPS
- Certificate validation by underlying TLS stack

### SIP Headers
- **Via**: Route taken by request (includes transport=TLS)
- **From**: Originating SIP URI with tag
- **To**: Destination SIP URI
- **Call-ID**: Unique identifier for call/transaction
- **CSeq**: Command sequence number + method
- **Contact**: Where to reach the user
- **Expires**: Registration expiration (for REGISTER)

### Transaction Identifiers
- **Call-ID**: Generated randomly, unique per session
- **Branch**: Generated for Via header (RFC 3261 magic cookie: `z9hG4bK...`)
- **Tags**: Generated for From/To headers to identify dialogs

## Security Considerations

### TLS/SSL
- SIPS requires TLS 1.2 or higher
- Certificate validation ensures server identity
- Prevents eavesdropping on signaling data
- Does not encrypt media (use SRTP for that)

### Authentication
- Digest authentication (HTTP-style challenges)
- 401 Unauthorized with WWW-Authenticate header
- Client responds with Authorization header
- Credentials never sent in plain text

### Privacy
- SIP URIs may contain privacy-sensitive information
- P-Asserted-Identity header for authenticated identity
- Privacy header for anonymity requests
- TLS ensures signaling confidentiality

## Differences from SIP

| Feature | SIP (Port 5060) | SIPS (Port 5061) |
|---------|----------------|------------------|
| Transport | TCP/UDP | TLS/TCP only |
| Encryption | None | TLS required |
| Via header | SIP/2.0/TCP | SIP/2.0/TLS |
| URI scheme | sip: | sips: |
| Security | Optional | Mandatory |
| Use case | Internal networks | Public internet |

## Testing

### Test Endpoints
- Public SIPS servers are rare (most require authentication)
- Testing typically done with:
  - Asterisk PBX with TLS enabled
  - FreeSWITCH with TLS
  - Kamailio with TLS module
  - Local test servers

### Example cURL Request

```bash
curl -X POST http://localhost:8787/api/sips/options \
  -H "Content-Type: application/json" \
  -d '{
    "host": "sip.example.com",
    "port": 5061,
    "fromUri": "sips:alice@example.com",
    "toUri": "sips:bob@example.com"
  }'
```

## References

- **RFC 3261**: [SIP Protocol Specification](https://tools.ietf.org/html/rfc3261)
- **RFC 5630**: [SIPS URI Scheme](https://tools.ietf.org/html/rfc5630)
- **RFC 5246**: [TLS 1.2](https://tools.ietf.org/html/rfc5246)
- **RFC 2617**: [HTTP Digest Authentication](https://tools.ietf.org/html/rfc2617) (used by SIP)
- **RFC 3665**: [SIP Basic Call Flow Examples](https://tools.ietf.org/html/rfc3665)
- **RFC 3764**: [enumservice Registration for SIP](https://tools.ietf.org/html/rfc3764)

## Implementation Notes

- Uses TLS via Cloudflare Workers `secureTransport: 'on'` option
- Call-ID includes `@portofcall` domain for uniqueness
- Branch IDs start with RFC 3261 magic cookie `z9hG4bK`
- Tags are random 9-character alphanumeric strings
- Max-Forwards default is 70 (RFC recommendation)
- Content-Length always included (even for 0-length bodies)
- Responses parsed using text-based line-by-line parser
- TLS certificate validation handled by Workers runtime

## Future Enhancements

- Digest authentication support (401/407 challenges)
- INVITE method for call initiation
- WebSocket tunnel for persistent SIP sessions
- SDP parsing for media negotiation
- SUBSCRIBE/NOTIFY for presence
- Message waiting indication (MWI)
- Session management with Durable Objects
