# XMPP Server-to-Server (S2S) Protocol - Power User Documentation

## Overview

**Protocol:** XMPP S2S (Extensible Messaging and Presence Protocol - Server-to-Server)
**Default Port:** 5269 (TCP)
**Specifications:**
- RFC 6120 (XMPP Core) - [https://www.rfc-editor.org/rfc/rfc6120.html](https://www.rfc-editor.org/rfc/rfc6120.html)
- RFC 7590 (Use of TLS for XMPP) - [https://www.rfc-editor.org/rfc/rfc7590.html](https://www.rfc-editor.org/rfc/rfc7590.html)
- XEP-0220 (Server Dialback) - [https://xmpp.org/extensions/xep-0220.html](https://xmpp.org/extensions/xep-0220.html)
- XEP-0199 (XMPP Ping) - [https://xmpp.org/extensions/xep-0199.html](https://xmpp.org/extensions/xep-0199.html)

**Purpose:** Federation protocol enabling XMPP servers to communicate with each other, allowing users on different domains to exchange instant messages, presence information, and other XML stanzas.

**Complexity:** High - XML streaming protocol with bidirectional communication, multiple authentication methods, TLS negotiation, and complex state management.

---

## Protocol Architecture

### Content Namespaces

XMPP uses two distinct content namespaces:

- **`jabber:client`** - Used for client-to-server (C2S) communication on port 5222
- **`jabber:server`** - Used for server-to-server (S2S) communication on port 5269

Per RFC 6120, clients MUST NOT send stanzas qualified by the `jabber:server` namespace. Servers MUST support both namespaces depending on connection type.

### Stream Namespace

All XMPP streams use the stream namespace: `http://etherx.jabber.org/streams`

The root `<stream:stream>` element is qualified by this namespace, while child elements (stanzas) are qualified by either `jabber:client` or `jabber:server`.

---

## Connection Flow

### Basic S2S Connection Sequence

```
1. Initiating server opens TCP connection to port 5269
2. Initiating server sends <stream:stream> opening tag
3. Receiving server responds with <stream:stream> opening tag (includes stream ID)
4. Receiving server sends <stream:features> element
5. TLS negotiation (STARTTLS or direct TLS)
6. Authentication (Dialback or SASL)
7. XML stanzas exchanged over authenticated stream
8. Stream closed with </stream:stream> closing tag
```

### Stream Opening (RFC 6120 Section 4.7)

**Initiating Server → Receiving Server:**

```xml
<?xml version='1.0'?>
<stream:stream
  xmlns='jabber:server'
  xmlns:stream='http://etherx.jabber.org/streams'
  from='example.com'
  to='jabber.org'
  version='1.0'>
```

**Required Attributes:**
- `xmlns='jabber:server'` - Content namespace for S2S
- `xmlns:stream='http://etherx.jabber.org/streams'` - Stream namespace
- `from` - Sending domain (FQDN)
- `to` - Receiving domain (FQDN)
- `version='1.0'` - Protocol version (MUST be 1.0 per RFC 6120)

**Receiving Server → Initiating Server:**

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

**Important:** The receiving server MUST include the `id` attribute containing a unique stream identifier. This stream ID is critical for dialback authentication.

### Stream Closure

**Graceful Closure:**

```xml
</stream:stream>
```

Both parties send the closing tag to terminate the stream. The TCP connection is then closed.

**Stream Errors:**

```xml
<stream:error>
  <host-unknown xmlns='urn:ietf:params:xml:ns:xmpp-streams'/>
  <text xmlns='urn:ietf:params:xml:ns:xmpp-streams'>
    Domain 'example.com' is not served by this server
  </text>
</stream:error>
</stream:stream>
```

---

## Transport Security (RFC 7590)

### STARTTLS Upgrade

**Step 1: Server advertises STARTTLS in stream features**

```xml
<stream:features>
  <starttls xmlns='urn:ietf:params:xml:ns:xmpp-tls'>
    <required/>
  </starttls>
</stream:features>
```

The `<required/>` child element indicates that TLS is mandatory.

**Step 2: Client initiates STARTTLS**

```xml
<starttls xmlns='urn:ietf:params:xml:ns:xmpp-tls'/>
```

**Step 3: Server responds with proceed or failure**

Success:
```xml
<proceed xmlns='urn:ietf:params:xml:ns:xmpp-tls'/>
```

Failure:
```xml
<failure xmlns='urn:ietf:params:xml:ns:xmpp-tls'/>
</stream:stream>
```

**Step 4: TLS handshake occurs**

Both parties perform TLS negotiation at the socket level.

**Step 5: Stream restart**

After successful TLS upgrade, the initiating server MUST send a new stream opening. The stream ID changes, and new features are advertised.

### Direct TLS (Preferred)

Modern servers support direct TLS on port 5269, eliminating the STARTTLS upgrade step. This is more secure as it prevents downgrade attacks.

**Connection with Direct TLS:**

```
1. TCP connect with TLS enabled from start
2. TLS handshake completes
3. Send <stream:stream> over encrypted connection
4. Receive <stream:stream> response
5. Proceed with authentication
```

---

## Authentication Methods

### Server Dialback (XEP-0220)

Server Dialback is a DNS-based weak identity verification mechanism. It's widely supported but vulnerable to DNS spoofing.

**Protocol Flow:**

```
Initiating Server (IS): example.com
Receiving Server (RS): jabber.org
Authoritative Server (AS): example.com (DNS authority)
```

**Step 1: IS → RS - Send Dialback Request**

```xml
<db:result xmlns:db='jabber:server:dialback'
           from='example.com'
           to='jabber.org'>
  a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0
</db:result>
```

The dialback key is a random hexadecimal string (128-256 bits).

**Step 2: RS → AS - Verify Dialback Key**

The receiving server opens a connection to the authoritative server for `example.com` and sends:

```xml
<db:verify xmlns:db='jabber:server:dialback'
           from='jabber.org'
           to='example.com'
           id='s2s-stream-abc123'>
  a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0
</db:verify>
```

**Step 3: AS → RS - Confirm or Deny**

```xml
<db:verify xmlns:db='jabber:server:dialback'
           from='example.com'
           to='jabber.org'
           type='valid'
           id='s2s-stream-abc123'/>
```

Or on failure:

```xml
<db:verify xmlns:db='jabber:server:dialback'
           from='example.com'
           to='jabber.org'
           type='invalid'
           id='s2s-stream-abc123'/>
```

**Step 4: RS → IS - Send Result**

```xml
<db:result xmlns:db='jabber:server:dialback'
           from='jabber.org'
           to='example.com'
           type='valid'/>
```

**Important Implementation Notes:**

- The `xmlns:db` namespace declaration can be in the stream header OR in each `<db:result>` element
- The dialback key MUST be cryptographically random (128+ bits entropy)
- Stream ID from the receiving server is critical for verification
- Dialback provides weak authentication - it only proves DNS control, not cryptographic identity

### SASL EXTERNAL (Certificate-Based Auth)

SASL EXTERNAL uses X.509 certificates presented during TLS handshake for authentication. This is the strongest authentication method for S2S.

**Requirements:**

- Both servers have valid TLS certificates
- Certificate CN or SAN matches the domain name (e.g., CN=example.com)
- Certificate is signed by a trusted CA or uses DANE/DNSSEC verification

**Protocol Flow:**

**Step 1: TLS handshake with client certificate**

During TLS negotiation, both servers exchange certificates.

**Step 2: Server advertises SASL EXTERNAL**

```xml
<stream:features>
  <mechanisms xmlns='urn:ietf:params:xml:ns:xmpp-sasl'>
    <mechanism>EXTERNAL</mechanism>
  </mechanisms>
</stream:features>
```

**Step 3: Client initiates EXTERNAL auth**

```xml
<auth xmlns='urn:ietf:params:xml:ns:xmpp-sasl' mechanism='EXTERNAL'>
  ZXhhbXBsZS5jb20=
</auth>
```

The base64-encoded value is the initiating server's domain (authorization identity).

**Step 4: Server responds with success or failure**

Success:
```xml
<success xmlns='urn:ietf:params:xml:ns:xmpp-sasl'/>
```

Failure:
```xml
<failure xmlns='urn:ietf:params:xml:ns:xmpp-sasl'>
  <not-authorized/>
</failure>
```

---

## Stanza Types

### Message Stanza

```xml
<message type='chat'
         from='user@example.com'
         to='user@jabber.org'
         id='msg1'>
  <body>Hello from example.com!</body>
  <thread>thread-12345</thread>
</message>
```

**Message Types:**
- `chat` - One-to-one conversation
- `groupchat` - Multi-user chat
- `headline` - Alert or notification
- `normal` - Default type
- `error` - Error response

### Presence Stanza

```xml
<presence from='user@example.com'
          to='user@jabber.org'>
  <show>chat</show>
  <status>Available for chat</status>
  <priority>10</priority>
</presence>
```

**Presence Types:**
- `subscribe` - Request subscription to presence
- `subscribed` - Approve subscription
- `unsubscribe` - Remove subscription
- `unsubscribed` - Deny subscription
- `probe` - Request current presence
- `error` - Error response
- (no type) - Broadcast presence

**Show Values:**
- `away` - Away from computer
- `chat` - Available for chat
- `dnd` - Do not disturb
- `xa` - Extended away

### IQ Stanza (Info/Query)

```xml
<iq type='get'
    from='example.com'
    to='jabber.org'
    id='disco1'>
  <query xmlns='http://jabber.org/protocol/disco#info'/>
</iq>
```

**IQ Types:**
- `get` - Request information
- `set` - Modify data
- `result` - Successful response
- `error` - Error response

**Important:** IQ stanzas MUST include an `id` attribute for request/response correlation.

**IQ Ping (XEP-0199):**

Request:
```xml
<iq type='get' id='ping1' to='jabber.org' from='example.com'>
  <ping xmlns='urn:xmpp:ping'/>
</iq>
```

Response:
```xml
<iq type='result' id='ping1' from='jabber.org' to='example.com'/>
```

---

## Implementation Details

### Worker Endpoints

This implementation provides three endpoints:

#### 1. `/api/xmpp-s2s/connect` - Stream Negotiation

Opens an XMPP S2S stream, retrieves features, and parses stream ID.

**Request:**
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

**Parameters:**
- `host` (required) - Target server hostname or IP
- `port` (optional) - Port number (default: 5269)
- `fromDomain` (required) - Initiating domain
- `toDomain` (optional) - Target domain (defaults to host)
- `useTLS` (optional) - Use direct TLS (default: true)
- `timeout` (optional) - Connection timeout in ms (default: 15000)

**Response:**
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

#### 2. `/api/xmpp-s2s/ping` - IQ Ping

Opens stream, sends IQ ping (XEP-0199), and waits for response.

**Request:**
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

**Response:**
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

#### 3. `/api/xmpps2s/dialback` - Full Dialback Auth

Performs complete STARTTLS + Server Dialback authentication flow.

**Request:**
```json
{
  "host": "jabber.org",
  "port": 5269,
  "fromDomain": "example.com",
  "toDomain": "jabber.org",
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "host": "jabber.org",
  "port": 5269,
  "fromDomain": "example.com",
  "toDomain": "jabber.org",
  "starttlsOffered": true,
  "tlsUpgraded": true,
  "dialbackOffered": true,
  "dialbackResult": "valid",
  "saslMechanisms": ["EXTERNAL", "SCRAM-SHA-1"],
  "streamId": "s2s-stream-def456",
  "latencyMs": 1247
}
```

**Dialback Results:**
- `valid` - Dialback authentication succeeded
- `invalid` - Dialback authentication failed
- `error` - Server sent stream error
- `pending` - No response received (timeout)

---

## XML Escaping

All attribute values and text content MUST be XML-escaped:

```
& → &amp;
< → &lt;
> → &gt;
" → &quot;
' → &apos;
```

**Example:**

```javascript
function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
```

Failure to escape XML will result in malformed streams or XML injection vulnerabilities.

---

## Error Handling

### Stream Errors

Stream errors are fatal and require closing the stream.

**Common Stream Errors:**

- `<bad-format/>` - XML not well-formed
- `<bad-namespace-prefix/>` - Invalid namespace prefix
- `<host-unknown/>` - Server doesn't serve target domain
- `<not-authorized/>` - Authentication failed
- `<policy-violation/>` - Policy restriction
- `<remote-connection-failed/>` - Could not connect to remote server
- `<system-shutdown/>` - Server shutting down
- `<unsupported-version/>` - Version 1.0 not supported

**Example:**

```xml
<stream:error>
  <host-unknown xmlns='urn:ietf:params:xml:ns:xmpp-streams'/>
  <text xmlns='urn:ietf:params:xml:ns:xmpp-streams' xml:lang='en'>
    The domain 'example.com' is not hosted by this server
  </text>
</stream:error>
</stream:stream>
```

### Stanza Errors

Stanza errors are non-fatal and scoped to individual stanzas.

**Error Structure:**

```xml
<iq type='error' id='disco1' from='jabber.org' to='example.com'>
  <query xmlns='http://jabber.org/protocol/disco#info'/>
  <error type='cancel'>
    <service-unavailable xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/>
    <text xmlns='urn:ietf:params:xml:ns:xmpp-stanzas' xml:lang='en'>
      Service discovery not available
    </text>
  </error>
</iq>
```

**Error Types:**
- `auth` - Authorization/authentication error
- `cancel` - Permanent error, don't retry
- `continue` - Temporary error, continue
- `modify` - Request needs modification
- `wait` - Temporary error, retry later

---

## Testing

### Public XMPP Servers

**Warning:** Most public XMPP servers reject S2S connections from unknown domains or require:
- Valid DNS SRV records (`_xmpp-server._tcp.example.com`)
- Reverse DNS matching
- Valid TLS certificates
- Domain ownership verification

**Public Servers (May Accept Limited Testing):**
- `jabber.org` - Historical public server
- `xmpp.jp` - Japanese public XMPP server
- `404.city` - European public server

### Testing with Local Prosody Server

**Install Prosody:**

```bash
apt-get install prosody
```

**Configure `/etc/prosody/prosody.cfg.lua`:**

```lua
VirtualHost "localhost"

-- Disable security for testing (DO NOT USE IN PRODUCTION!)
s2s_secure_auth = false
allow_unencrypted_plain_auth = true
c2s_require_encryption = false
s2s_require_encryption = false

modules_enabled = {
  "roster"; "saslauth"; "tls"; "dialback";
  "disco"; "ping"; "time"; "version";
}

log = {
  { levels = { "debug" }, to = "console" };
}
```

**Start Prosody:**

```bash
prosodyctl start
```

**Test S2S Connection:**

```bash
curl -X POST http://localhost:8787/api/xmpp-s2s/connect \
  -H "Content-Type: application/json" \
  -d '{
    "host": "localhost",
    "fromDomain": "test.local",
    "toDomain": "localhost",
    "useTLS": false,
    "timeout": 10000
  }'
```

---

## Security Considerations

### Transport Security

- **TLS is mandatory** for production S2S connections (RFC 7590)
- **Direct TLS preferred** over STARTTLS (prevents downgrade attacks)
- **Minimum TLS 1.2**, prefer TLS 1.3
- **Strong cipher suites only** (avoid RC4, 3DES, export ciphers)
- **Certificate validation** - verify CN/SAN matches domain

### Authentication Security

**Dialback Weaknesses:**
- Vulnerable to DNS spoofing/hijacking
- Relies on DNS as trust anchor
- No cryptographic proof of identity
- Should only be used with DNSSEC

**SASL EXTERNAL Strengths:**
- Cryptographic proof via certificates
- Stronger than Dialback
- Requires PKI infrastructure
- Can use DANE (DNS-based authentication)

### Attack Vectors

1. **DNS Spoofing** - Attacker controls DNS for target domain, can intercept Dialback
2. **Man-in-the-Middle** - Without TLS or with invalid certificates
3. **Domain Hijacking** - Attacker gains control of domain registration
4. **Certificate Authority Compromise** - Attacker obtains fraudulent certificate
5. **XML Injection** - Improper XML escaping allows injection attacks
6. **Denial of Service** - Flood server with connection requests

---

## Protocol Differences: S2S vs C2S

| Feature | S2S (Server-to-Server) | C2S (Client-to-Server) |
|---------|------------------------|------------------------|
| **Port** | 5269 | 5222 |
| **Namespace** | `jabber:server` | `jabber:client` |
| **Authentication** | Dialback, SASL EXTERNAL | SASL PLAIN, SCRAM-SHA-1, SCRAM-SHA-256 |
| **Resource Binding** | No | Yes (required) |
| **Roster Management** | No | Yes |
| **Session Establishment** | No (deprecated in RFC 6120) | No (deprecated in RFC 6120) |
| **Primary Use Case** | Server federation | User connections |
| **Stream Direction** | Bidirectional (peer-to-peer) | Client-initiated |
| **Certificate Requirements** | Server certificate for domain | Server certificate for host |

---

## DNS SRV Records

Production XMPP S2S requires DNS SRV records for server discovery:

```
_xmpp-server._tcp.example.com. 86400 IN SRV 0 5 5269 xmpp.example.com.
```

**SRV Record Format:**
```
_service._proto.domain. TTL IN SRV priority weight port target.
```

**Example:**
```
_xmpp-server._tcp.jabber.org. 300 IN SRV 5 0 5269 hermes.jabber.org.
_xmpp-server._tcp.jabber.org. 300 IN SRV 10 0 5269 apollo.jabber.org.
```

**Priority:** Lower value = higher priority
**Weight:** Load balancing weight (higher = more traffic)
**Port:** Target port (usually 5269)
**Target:** Hostname of XMPP server

---

## Advanced Topics

### Stream Management (XEP-0198)

Provides stream resumption after network disconnections. Not covered in this implementation.

### Stream Compression (XEP-0138)

Enables DEFLATE compression of XML stream. Deprecated in favor of TLS compression.

### BOSH (Bidirectional-streams Over Synchronous HTTP) - XEP-0206

HTTP-based XMPP transport for web clients. Not applicable to S2S.

### WebSocket Binding (RFC 7395)

XMPP over WebSocket for browser-based clients. Not applicable to S2S.

---

## Bugs Fixed in This Implementation

### Critical Fixes

1. **Missing Dialback Namespace Declaration**
   - **Bug:** `xmlns:db='jabber:server:dialback'` was declared in stream header, but per XEP-0220, should be declared in `<db:result>` element
   - **Fix:** Removed from stream header, added to each `<db:result>` element
   - **Impact:** Some servers may reject dialback requests with incorrect namespace handling

2. **Type Safety in readS2SUntil()**
   - **Bug:** Promise.race with timeout returned `{ done: true }` but TypeScript expected `{ value: undefined; done: boolean }`
   - **Fix:** Changed timeout promise to resolve with `{ value: undefined, done: false }`
   - **Impact:** Prevented TypeScript compilation errors and potential runtime issues

3. **Inefficient Byte Array Concatenation**
   - **Bug:** Used `reduce()` to concatenate byte arrays on every read iteration
   - **Fix:** Pre-allocate `Uint8Array` and copy chunks with offsets
   - **Impact:** Improved performance for large responses

4. **Overly Broad Error Detection**
   - **Bug:** Checked for `"<error"` string which could false-positive on error descriptions in text
   - **Fix:** Check for `'<error'` AND `type='error'` attribute
   - **Impact:** Prevented false positives on legitimate stanzas containing the word "error"

5. **Race Condition in Extra Read**
   - **Bug:** Extra read after stream opening used inconsistent promise typing
   - **Fix:** Properly typed timeout promise in extra read
   - **Impact:** Fixed potential type mismatches

### RFC Compliance Notes

- **RFC 6120 Section 4.7:** Stream attributes properly set (from, to, version)
- **RFC 6120 Section 4.7.3:** Stream ID correctly parsed from server response
- **XEP-0220 Section 2.1:** Dialback key uses proper namespace declaration
- **RFC 6120 Section 5.4:** XML escaping applied to all attribute values

---

## References

- **RFC 6120** - XMPP Core: [https://www.rfc-editor.org/rfc/rfc6120.html](https://www.rfc-editor.org/rfc/rfc6120.html)
- **RFC 7590** - Use of TLS for XMPP: [https://www.rfc-editor.org/rfc/rfc7590.html](https://www.rfc-editor.org/rfc/rfc7590.html)
- **RFC 3920** - XMPP Core (obsoleted by RFC 6120): [https://www.rfc-editor.org/rfc/rfc3920.html](https://www.rfc-editor.org/rfc/rfc3920.html)
- **XEP-0220** - Server Dialback: [https://xmpp.org/extensions/xep-0220.html](https://xmpp.org/extensions/xep-0220.html)
- **XEP-0199** - XMPP Ping: [https://xmpp.org/extensions/xep-0199.html](https://xmpp.org/extensions/xep-0199.html)
- **XEP-0198** - Stream Management: [https://xmpp.org/extensions/xep-0198.html](https://xmpp.org/extensions/xep-0198.html)

---

## Example Usage

### Basic Connection Test

```bash
curl -X POST https://portofcall.ross.gg/api/xmpp-s2s/connect \
  -H "Content-Type: application/json" \
  -d '{
    "host": "jabber.org",
    "fromDomain": "example.com",
    "useTLS": true
  }'
```

### IQ Ping Test

```bash
curl -X POST https://portofcall.ross.gg/api/xmpp-s2s/ping \
  -H "Content-Type: application/json" \
  -d '{
    "host": "jabber.org",
    "fromDomain": "example.com",
    "toDomain": "jabber.org",
    "useTLS": true,
    "timeout": 10000
  }'
```

### Full Dialback Authentication

```bash
curl -X POST https://portofcall.ross.gg/api/xmpps2s/dialback \
  -H "Content-Type: application/json" \
  -d '{
    "host": "jabber.org",
    "fromDomain": "example.com",
    "toDomain": "jabber.org",
    "timeout": 15000
  }'
```

---

## Troubleshooting

### Connection Refused

**Symptoms:** `Connection timeout` or `Connection refused`

**Causes:**
- Target server not running XMPP S2S on port 5269
- Firewall blocking outbound connections
- Server requires DNS SRV records for domain

**Solution:**
- Verify server is listening: `telnet jabber.org 5269`
- Check DNS SRV records: `dig _xmpp-server._tcp.jabber.org SRV`
- Test with known public server

### Stream Error: host-unknown

**Symptoms:** Server responds with `<host-unknown/>` stream error

**Causes:**
- Server doesn't host the target domain
- Virtual host configuration missing
- Domain not in allowed list

**Solution:**
- Verify domain is served by target server
- Check server configuration
- Use correct toDomain parameter

### TLS Handshake Failure

**Symptoms:** Connection drops after STARTTLS

**Causes:**
- Certificate validation failure
- TLS version mismatch
- Unsupported cipher suites

**Solution:**
- Use `useTLS: false` to test without TLS
- Check server certificate validity
- Verify TLS 1.2+ support

### Dialback Invalid

**Symptoms:** `dialbackResult: "invalid"`

**Causes:**
- DNS not properly configured
- Authoritative server unreachable
- Domain doesn't match DNS records

**Solution:**
- Verify DNS SRV records exist
- Check reverse DNS configuration
- Use valid, registered domain

---

## Limitations

1. **No Full Authentication:** Implementation only tests stream negotiation, does not maintain authenticated sessions
2. **No Stanza Routing:** Cannot send/receive actual messages or presence
3. **No Stream Management:** Does not support XEP-0198 stream resumption
4. **No Certificate Validation:** Direct TLS mode doesn't validate certificates
5. **No DNS SRV Lookup:** Connects directly to specified host/port
6. **Read-Only:** Cannot modify server state or send arbitrary stanzas

---

## Future Enhancements

- Full Dialback authentication with verification server
- SASL EXTERNAL implementation with certificate auth
- DNS SRV record resolution
- Message and Presence stanza support
- Stream Management (XEP-0198)
- Multi-user chat (XEP-0045)
- Service discovery (XEP-0030)
- Entity capabilities (XEP-0115)
- In-band registration (XEP-0077)

---

**Document Version:** 1.0
**Last Updated:** 2026-02-18
**Protocol Implementation:** `/Users/rj/gd/code/portofcall/src/worker/xmpp-s2s.ts`, `/Users/rj/gd/code/portofcall/src/worker/xmpps2s.ts`
