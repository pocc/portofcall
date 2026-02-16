# XMPP Server-to-Server Protocol Implementation

## Overview

**Protocol:** XMPP S2S (Extensible Messaging and Presence Protocol - Server-to-Server)
**Port:** 5269
**Specification:** RFC 6120 (XMPP Core), RFC 7590 (TLS for XMPP)
**Complexity:** High
**Purpose:** Federated instant messaging, presence, and real-time communication

XMPP Server-to-Server (S2S) is the federation protocol that enables XMPP servers to communicate with each other, allowing users on different servers to exchange messages, presence updates, and other XML stanzas.

### Use Cases
- Federated instant messaging (user@domain1.com → user@domain2.com)
- Multi-organization XMPP networks
- Corporate XMPP federation with public servers
- IoT device communication via XMPP
- Real-time collaboration platforms
- Gaming chat systems
- WebRTC signaling over XMPP

## Protocol Specification

### Wire Format

XMPP S2S uses XML streaming over TCP, optionally secured with TLS.

#### Stream Initialization

**Client → Server:**
```xml
<?xml version='1.0'?>
<stream:stream
  xmlns='jabber:server'
  xmlns:stream='http://etherx.jabber.org/streams'
  from='example.com'
  to='jabber.org'
  version='1.0'>
```

**Server → Client:**
```xml
<?xml version='1.0'?>
<stream:stream
  xmlns='jabber:server'
  xmlns:stream='http://etherx.jabber.org/streams'
  from='jabber.org'
  to='example.com'
  id='s2s-stream-abc123'
  version='1.0'>

<stream:features>
  <starttls xmlns='urn:ietf:params:xml:ns:xmpp-tls'>
    <required/>
  </starttls>
  <mechanisms xmlns='urn:ietf:params:xml:ns:xmpp-sasl'>
    <mechanism>EXTERNAL</mechanism>
    <mechanism>SCRAM-SHA-1</mechanism>
  </mechanisms>
  <dialback xmlns='urn:xmpp:features:dialback'/>
</stream:features>
```

#### STARTTLS Negotiation

**Client → Server:**
```xml
<starttls xmlns='urn:ietf:params:xml:ns:xmpp-tls'/>
```

**Server → Client:**
```xml
<proceed xmlns='urn:ietf:params:xml:ns:xmpp-tls'/>
```

*[TLS handshake occurs]*

**Client → Server (new stream after TLS):**
```xml
<?xml version='1.0'?>
<stream:stream
  xmlns='jabber:server'
  xmlns:stream='http://etherx.jabber.org/streams'
  from='example.com'
  to='jabber.org'
  version='1.0'>
```

#### IQ Ping

**Client → Server:**
```xml
<iq type='get' id='ping1' to='jabber.org' from='example.com'>
  <ping xmlns='urn:xmpp:ping'/>
</iq>
```

**Server → Client:**
```xml
<iq type='result' id='ping1' from='jabber.org' to='example.com'/>
```

#### Stream Closure

**Client → Server:**
```xml
</stream:stream>
```

**Server → Client:**
```xml
</stream:stream>
```

## Worker Implementation

### Endpoints

- **POST /api/xmpp-s2s/connect** - Establish S2S stream and retrieve features
- **POST /api/xmpp-s2s/ping** - Send IQ ping to remote server

### Connect Request

```json
{
  "host": "jabber.org",
  "port": 5269,
  "fromDomain": "example.com",
  "toDomain": "jabber.org",
  "useTLS": true,
  "timeout": 15000
}
```

### Connect Response

```json
{
  "success": true,
  "host": "jabber.org",
  "port": 5269,
  "streamId": "s2s-stream-abc123",
  "features": [
    "STARTTLS",
    "SASL-EXTERNAL",
    "SASL-SCRAM-SHA-1",
    "DIALBACK"
  ],
  "rtt": 342
}
```

### Ping Request

```json
{
  "host": "jabber.org",
  "port": 5269,
  "fromDomain": "example.com",
  "toDomain": "jabber.org",
  "useTLS": true,
  "timeout": 15000
}
```

### Ping Response

```json
{
  "success": true,
  "host": "jabber.org",
  "port": 5269,
  "streamId": "s2s-stream-xyz789",
  "features": ["STARTTLS", "DIALBACK"],
  "stanzas": [
    "<iq type='result' id='ping1' from='jabber.org' to='example.com'/>"
  ],
  "rtt": 287
}
```

## Key Features

### XML Streaming
- Long-lived TCP connection with continuous XML stream
- Opening `<stream:stream>` element without closing tag
- Multiple stanzas (`<message>`, `<presence>`, `<iq>`) exchanged
- Stream closed with `</stream:stream>` element

### TLS Security
- **Direct TLS:** Connect on port 5269 with TLS from start
- **STARTTLS:** Upgrade plaintext connection to TLS mid-stream
- **Certificate verification:** Mutual TLS with server certificates
- Most modern servers require TLS for S2S

### Authentication Methods

#### Server Dialback (RFC 6120)
- DNS-based authentication mechanism
- Server A connects to Server B, Server B verifies via Server A's authoritative server
- No shared secrets needed
- Default authentication for most public XMPP servers

#### SASL EXTERNAL (RFC 6120)
- Certificate-based authentication
- Server identity verified via TLS certificate
- Requires valid certificates with correct domain names
- More secure than Dialback

### Stream Features
- **STARTTLS:** TLS upgrade capability
- **SASL mechanisms:** Authentication methods (EXTERNAL, SCRAM-SHA-1, etc.)
- **Dialback:** Server Dialback support
- **Session:** Session establishment
- **Bind:** Resource binding

### Stanza Types

#### Message
```xml
<message type='chat' to='user@jabber.org' from='user@example.com'>
  <body>Hello from example.com!</body>
</message>
```

#### Presence
```xml
<presence to='user@jabber.org' from='user@example.com'>
  <show>chat</show>
  <status>Available</status>
</presence>
```

#### IQ (Info/Query)
```xml
<iq type='get' id='disco1' to='jabber.org' from='example.com'>
  <query xmlns='http://jabber.org/protocol/disco#info'/>
</iq>
```

## Security Considerations

### Transport Security
- **TLS mandatory:** Modern XMPP servers require TLS for S2S
- **Direct TLS preferred:** More secure than STARTTLS upgrade
- **Certificate validation:** Both servers verify each other's certificates
- **Cipher suites:** Use strong ciphers (TLS 1.2+, avoid SSLv3)

### Authentication
- **Dialback limitations:** Relies on DNS, vulnerable to DNS spoofing
- **SASL EXTERNAL preferred:** Certificate-based auth more secure
- **Domain verification:** Ensure certificate CN/SAN matches domain
- **Mutual authentication:** Both servers authenticate each other

### Attack Vectors
- **DNS spoofing:** Can compromise Dialback authentication
- **Man-in-the-middle:** Requires valid TLS certificates to prevent
- **Domain hijacking:** Attacker controls DNS for target domain
- **Certificate spoofing:** Requires CA compromise or DNS validation attack

## Testing

### Public XMPP S2S Servers
- **jabber.org** - Historical public XMPP server
- **xmpp.jp** - Japanese public XMPP server
- **404.city** - European public XMPP server

Note: Most public servers may reject S2S connections from unknown domains or require valid DNS SRV records.

### Example cURL Request

```bash
curl -X POST http://localhost:8787/api/xmpp-s2s/connect \
  -H "Content-Type: application/json" \
  -d '{
    "host": "jabber.org",
    "fromDomain": "example.com",
    "useTLS": true
  }'
```

### Local Testing with Prosody

```bash
# Install Prosody XMPP server
apt-get install prosody

# Configure /etc/prosody/prosody.cfg.lua
VirtualHost "localhost"
s2s_secure_auth = false  # For testing only!
allow_unencrypted_plain_auth = true

# Start Prosody
prosodyctl start

# Test S2S connection
curl -X POST http://localhost:8787/api/xmpp-s2s/connect \
  -H "Content-Type: application/json" \
  -d '{
    "host": "localhost",
    "fromDomain": "test.local",
    "useTLS": false
  }'
```

## References

- **RFC 6120**: XMPP Core [https://tools.ietf.org/html/rfc6120](https://tools.ietf.org/html/rfc6120)
- **RFC 7590**: Use of TLS for XMPP [https://tools.ietf.org/html/rfc7590](https://tools.ietf.org/html/rfc7590)
- **RFC 3920**: XMPP Core (obsolete) [https://tools.ietf.org/html/rfc3920](https://tools.ietf.org/html/rfc3920)
- **XEP-0199**: XMPP Ping [https://xmpp.org/extensions/xep-0199.html](https://xmpp.org/extensions/xep-0199.html)
- **XEP-0220**: Server Dialback [https://xmpp.org/extensions/xep-0220.html](https://xmpp.org/extensions/xep-0220.html)

## Implementation Notes

- Stream ID is server-generated, not client-specified
- XML namespace for S2S is `jabber:server` (not `jabber:client`)
- Stream opening element is never closed (remains open for session)
- Features advertised after stream opening
- TLS handshake resets stream (new stream opening after STARTTLS)
- IQ stanzas use `id` for request/response matching
- Timeout default is 15 seconds
- Direct TLS on port 5269 is preferred over STARTTLS

## Differences from XMPP C2S

| Feature | S2S (Server-to-Server) | C2S (Client-to-Server) |
|---------|------------------------|------------------------|
| Port | 5269 | 5222 |
| Namespace | jabber:server | jabber:client |
| Authentication | Dialback, SASL EXTERNAL | SASL PLAIN, SCRAM-SHA-1 |
| Resource binding | No | Yes |
| Roster management | No | Yes |
| Sessions | No (deprecated) | No (deprecated) |
| Use case | Server federation | User connections |

## Future Enhancements

- Full Dialback authentication implementation
- SASL EXTERNAL certificate authentication
- DNS SRV record lookup (_xmpp-server._tcp.domain)
- Message stanza support
- Presence stanza support
- Stream Management (XEP-0198)
- WebSocket XMPP binding (RFC 7395)
- XMPP over BOSH (XEP-0206)
