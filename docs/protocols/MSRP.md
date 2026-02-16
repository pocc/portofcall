# MSRP Protocol Implementation

## Overview

**Protocol:** Message Session Relay Protocol
**Port:** 2855
**RFC:** [RFC 4975](https://tools.ietf.org/html/rfc4975)
**Complexity:** Medium
**Purpose:** Real-time instant messaging and file transfer in SIP sessions

MSRP is a text-based protocol for transmitting instant messages and file transfers in SIP-based communication sessions. It provides reliable, ordered delivery of messages with support for chunking large content.

### Use Cases
- SIP-based instant messaging
- WebRTC data channel messaging
- Real-time chat applications
- File transfer in communication apps
- Session-based IM in voice/video calls

## Protocol Specification

### Wire Format

MSRP uses a text-based request/response format similar to HTTP:

```
MSRP <transaction-id> <method>
To-Path: <msrp-uri>
From-Path: <msrp-uri>
Message-ID: <message-id>
Byte-Range: <start>-<end>/<total>
Content-Type: <mime-type>

<content>
-------<transaction-id><flag>
```

### Request Methods
- **SEND**: Transmit a message or chunk
- **REPORT**: Status reports for message delivery
- **NICKNAME**: (Extension) Nickname negotiation

### Response Codes
- **200**: OK (success)
- **400**: Bad Request
- **403**: Forbidden
- **408**: Request Timeout
- **413**: Message Too Large
- **415**: Unsupported Media Type
- **481**: No Such Session
- **501**: Not Implemented

### Example Session

```
MSRP a786hjs2 SEND
To-Path: msrp://relay.example.com:2855/session456;tcp
From-Path: msrp://client.example.com:2855/session123;tcp
Message-ID: 87652491
Byte-Range: 1-25/25
Content-Type: text/plain

Hello from MSRP client!
-------a786hjs2$
```

Response:
```
MSRP a786hjs2 200 OK
To-Path: msrp://client.example.com:2855/session123;tcp
From-Path: msrp://relay.example.com:2855/session456;tcp
-------a786hjs2$
```

## Worker Implementation

### Endpoints

- **POST /api/msrp/send** - Send a single MSRP message
- **POST /api/msrp/connect** - Test MSRP relay connectivity

### MSRP Send Request

```json
{
  "host": "relay.example.com",
  "port": 2855,
  "fromPath": "msrp://client.example.com:2855/session123;tcp",
  "toPath": "msrp://relay.example.com:2855/session456;tcp",
  "content": "Hello, world!",
  "contentType": "text/plain",
  "messageId": "optional-message-id",
  "timeout": 15000
}
```

### MSRP Send Response

```json
{
  "success": true,
  "host": "relay.example.com",
  "port": 2855,
  "statusCode": 200,
  "statusText": "OK",
  "transactionId": "abc123xyz",
  "messageId": "1234567890",
  "byteRange": "1-13/13",
  "rtt": 245
}
```

## Key Features

### Transaction IDs
- Random alphanumeric strings (8-32 characters)
- Used to match requests with responses
- Unique per message send operation

### Message Chunking
- Large messages can be split into chunks
- Byte-Range header indicates chunk position
- Continuation flags: `$` (complete), `+` (more chunks), `#` (abort)

### Path-Based Routing
- MSRP URIs identify endpoints: `msrp://host:port/session-id;tcp`
- To-Path: Destination relay/endpoint
- From-Path: Originating client/relay
- Supports multi-hop relay chains

### Content Types
- text/plain
- text/html
- application/octet-stream
- image/jpeg, image/png
- Custom MIME types

## Security Considerations

### Authentication
- MSRP typically relies on SIP session setup for authentication
- TLS can be used for encryption (MSRPS)
- Digest authentication may be required by some relays

### Input Validation
- Validate MSRP URI format
- Limit message size (default: reasonable limits)
- Sanitize content based on content-type
- Prevent relay loop attacks

### Privacy
- MSRP messages are typically part of SIP sessions
- End-to-end encryption should be handled at application layer
- Relay servers can see message content unless encrypted

## Testing

### Test Endpoints
- Public MSRP relays are rare (requires SIP session setup)
- Testing typically done with local MSRP server
- Can test with SIP clients that support MSRP

### Example cURL Request

```bash
curl -X POST http://localhost:8787/api/msrp/send \
  -H "Content-Type: application/json" \
  -d '{
    "host": "relay.example.com",
    "port": 2855,
    "fromPath": "msrp://client.example.com:2855/abc123;tcp",
    "toPath": "msrp://relay.example.com:2855/def456;tcp",
    "content": "Test message",
    "contentType": "text/plain"
  }'
```

## References

- **RFC 4975**: [MSRP Protocol Specification](https://tools.ietf.org/html/rfc4975)
- **RFC 4976**: [MSRP Relay Extensions](https://tools.ietf.org/html/rfc4976)
- **RFC 5547**: [MSRP File Transfer](https://tools.ietf.org/html/rfc5547)
- **RFC 6135**: [MSRP Alternative Connection Model](https://tools.ietf.org/html/rfc6135)
- **RFC 6714**: [MSRP Connection Establishment for Media Anchoring](https://tools.ietf.org/html/rfc6714)

## Implementation Notes

- Transaction IDs are randomly generated for each request
- Message-IDs can be provided or auto-generated
- Default content-type is `text/plain`
- Connection timeout default is 15 seconds
- Supports both complete messages and chunked transfer
- Response parsing handles multi-line headers
- End-line format: `-------<transaction-id><flag>`

## Future Enhancements

- WebSocket tunnel for persistent MSRP sessions
- Message chunking for large content
- REPORT method support for delivery reports
- MSRPS (MSRP over TLS) support
- Session management with Durable Objects
- Multi-hop relay path support
