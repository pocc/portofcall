# Jabber Component Protocol (XEP-0114) -- Port of Call Reference

**Specification:** [XEP-0114](https://xmpp.org/extensions/xep-0114.html) (Jabber Component Protocol)
**Default port:** 5275
**Source:** `src/worker/jabber-component.ts`
**Routes:** `src/worker/index.ts` (lines registering `/api/jabber-component/*`)

---

## Protocol Overview

XEP-0114 defines how external components connect to an XMPP server. A component registers as a subdomain (e.g., `gateway.example.com` under `example.com`) and can then send and receive stanzas on behalf of that subdomain. Common use cases include IRC/MSN/AIM transport gateways, bots, MUC services, and custom XMPP services.

### Connection Flow (per XEP-0114)

```
Component                          Server
   |                                  |
   |--- TCP connect to port 5275 --->|
   |                                  |
   |--- <stream:stream              |
   |     xmlns='jabber:component:    |
   |           accept'               |
   |     xmlns:stream='http://       |
   |       etherx.jabber.org/        |
   |       streams'                  |
   |     to='component.domain'> ---->|
   |                                  |
   |<-- <stream:stream               |
   |      xmlns='jabber:component:   |
   |            accept'              |
   |      xmlns:stream='http://      |
   |        etherx.jabber.org/       |
   |        streams'                 |
   |      from='component.domain'    |
   |      id='STREAM_ID'> ----------|
   |                                  |
   |--- <handshake>                  |
   |      SHA1(STREAM_ID + SECRET)   |
   |    </handshake> --------------->|
   |                                  |
   |<-- <handshake/> (success)       |
   |    or                            |
   |<-- <stream:error>               |
   |      <not-authorized/>          |
   |    </stream:error>              |
   |    </stream:stream> -----------|
   |                                  |
   | [stanza exchange begins]        |
```

### Handshake Hash Computation

1. Concatenate: `streamId + sharedSecret` (raw string concatenation, no separator)
2. Compute: `SHA-1(concatenated_string)`
3. Encode: lowercase hexadecimal (40 characters)
4. Send: `<handshake>hexhash</handshake>`

**Example:**
- Stream ID: `abc123`
- Secret: `mysecret`
- Input: `abc123mysecret`
- SHA-1 hex: `3c5b...` (40 hex chars)
- Sent: `<handshake>3c5b...</handshake>`

### Key Protocol Details

| Property | Value |
|----------|-------|
| Default port | 5275 |
| Stream namespace | `jabber:component:accept` |
| Stream prefix namespace | `http://etherx.jabber.org/streams` |
| Auth mechanism | SHA-1 hash of (stream ID + shared secret) |
| Success response | `<handshake/>` (empty element) |
| Stanza namespace | Inherited from stream (`jabber:component:accept`) |

### Stanza Routing After Handshake

Once authenticated, the component can send `<message>`, `<presence>`, and `<iq>` stanzas. These stanzas inherit the `jabber:component:accept` namespace from the stream -- they do NOT carry an explicit `xmlns` attribute. The `from` attribute on stanzas MUST be within the component's subdomain. The server routes stanzas addressed to the component's subdomain to the component.

---

## Endpoints

| Endpoint | Purpose | Auth | Default timeout |
|----------|---------|------|-----------------|
| `POST /api/jabber-component/probe` | Open stream, extract stream ID | No auth (stream only) | 15 000 ms |
| `POST /api/jabber-component/handshake` | Full SHA-1 handshake | Shared secret | 15 000 ms |
| `POST /api/jabber-component/send` | Authenticate + send message or IQ ping | Shared secret | 15 000 ms |
| `POST /api/jabber-component/roster` | Authenticate + query roster IQ | Shared secret | 15 000 ms |

All endpoints return HTTP 200 for protocol-level successes AND protocol-level failures. Check the `success` or `handshake` field in the response body. HTTP 400 = missing required fields. HTTP 500 = unhandled exception.

---

### `POST /api/jabber-component/probe` -- Stream probe (no auth)

Opens a TCP connection, sends the component stream opening, reads the server's stream response to extract the stream ID. Does NOT send a handshake. Useful for checking if a server accepts component connections on a given port.

**Request:**

```json
{
  "host": "xmpp.example.com",
  "port": 5275,
  "timeout": 15000,
  "componentName": "gateway.example.com"
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | IP or hostname to connect to |
| `port` | `5275` | TCP port |
| `timeout` | `15000` | Wall-clock timeout in ms |
| `componentName` | `component.localhost` | Value sent in `<stream:stream to='...'>` -- should be the component's subdomain |

**Response (success -- stream opened):**

```json
{
  "success": true,
  "host": "xmpp.example.com",
  "port": 5275,
  "streamId": "s2s_abc123def456",
  "serverResponse": "<stream:stream xmlns='jabber:component:accept' ... id='s2s_abc123def456'>",
  "rtt": 87
}
```

**Response (error -- stream rejected):**

```json
{
  "success": false,
  "host": "xmpp.example.com",
  "port": 5275,
  "serverResponse": "<stream:error><host-unknown .../></stream:error></stream:stream>",
  "error": "Stream error: host-unknown",
  "rtt": 92
}
```

**Response fields:**

| Field | Type | Notes |
|-------|------|-------|
| `success` | boolean | `true` if a stream ID was received |
| `host` | string | Echo of request host |
| `port` | number | Echo of request port |
| `streamId` | string? | Server-assigned stream ID (present on success) |
| `serverResponse` | string? | Raw XML from server (trimmed) |
| `rtt` | number? | Round-trip time in ms |
| `error` | string? | Error description (present on failure) |

---

### `POST /api/jabber-component/handshake` -- Full handshake

Opens stream, extracts stream ID, computes `SHA-1(streamId + secret)`, sends `<handshake>hash</handshake>`, reads server confirmation.

**Request:**

```json
{
  "host": "xmpp.example.com",
  "port": 5275,
  "timeout": 15000,
  "componentName": "gateway.example.com",
  "secret": "shared-secret-configured-on-server"
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | IP or hostname |
| `port` | `5275` | TCP port |
| `timeout` | `15000` | Wall-clock timeout in ms |
| `componentName` | `component.localhost` | Component subdomain |
| `secret` | **required** | Shared secret (configured on the XMPP server for this component) |

**Response (authenticated):**

```json
{
  "success": true,
  "host": "xmpp.example.com",
  "port": 5275,
  "authenticated": true,
  "streamId": "s2s_abc123def456",
  "serverResponse": "<handshake/>"
}
```

**Response (auth failed):**

```json
{
  "success": false,
  "host": "xmpp.example.com",
  "port": 5275,
  "authenticated": false,
  "streamId": "s2s_abc123def456",
  "serverResponse": "<stream:error><not-authorized xmlns='urn:ietf:params:xml:ns:xmpp-streams'/></stream:error></stream:stream>",
  "error": "Authentication failed: not-authorized"
}
```

---

### `POST /api/jabber-component/send` -- Authenticate + send stanza

Performs the full handshake, then sends either a `<message>` stanza (if `body` is provided) or an `<iq>` ping stanza.

**Request:**

```json
{
  "host": "xmpp.example.com",
  "port": 5275,
  "timeout": 15000,
  "componentDomain": "gateway.example.com",
  "secret": "shared-secret",
  "from": "bot@gateway.example.com",
  "to": "alice@example.com",
  "body": "Hello from the gateway component"
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | IP or hostname |
| `port` | `5275` | TCP port |
| `timeout` | `15000` | Wall-clock timeout in ms |
| `componentDomain` | **required** | Component subdomain (used in stream `to=` and stanza routing) |
| `secret` | **required** | Shared secret |
| `from` | **required** | Sender JID (must be within the component's subdomain) |
| `to` | **required** | Recipient JID |
| `body` | optional | If provided, sends `<message>`. If omitted, sends IQ ping |

**Response (message sent):**

```json
{
  "handshake": "ok",
  "streamId": "s2s_abc123",
  "messageSent": true,
  "iqPong": false,
  "serverResponse": "",
  "rtt": 145
}
```

**Response (IQ ping -- no body):**

```json
{
  "handshake": "ok",
  "streamId": "s2s_abc123",
  "messageSent": false,
  "iqPong": true,
  "serverResponse": "<iq type='result' id='ping1' .../>",
  "rtt": 112
}
```

**Response (handshake failed):**

```json
{
  "handshake": "failed",
  "streamId": "s2s_abc123",
  "serverResponse": "<stream:error>...",
  "error": "Authentication failed: not-authorized",
  "rtt": 95
}
```

**`handshake` field values:**

| Value | Meaning |
|-------|---------|
| `ok` | Handshake succeeded, stanza was sent |
| `failed` | Stream opened but handshake was rejected |
| `error` | Connection or validation error before handshake |

---

### `POST /api/jabber-component/roster` -- Authenticate + roster query

Performs the full handshake, then sends an `<iq type='get'>` with `<query xmlns='jabber:iq:roster'/>` to retrieve the server's roster.

**Request:**

```json
{
  "host": "xmpp.example.com",
  "port": 5275,
  "timeout": 15000,
  "componentDomain": "gateway.example.com",
  "secret": "shared-secret",
  "serverDomain": "example.com"
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | IP or hostname |
| `port` | `5275` | TCP port |
| `timeout` | `15000` | Wall-clock timeout in ms |
| `componentDomain` | **required** | Component subdomain |
| `secret` | **required** | Shared secret |
| `serverDomain` | `host` | Target domain for the IQ roster query. Set this if the XMPP server domain differs from the connection host |

**Response (success):**

```json
{
  "success": true,
  "authenticated": true,
  "streamId": "s2s_abc123",
  "iqType": "result",
  "items": [
    {
      "jid": "alice@example.com",
      "name": "Alice",
      "subscription": "both",
      "groups": ["Friends"]
    }
  ],
  "itemCount": 1,
  "rtt": 234,
  "rawResponse": "<iq type='result' ...>...</iq>"
}
```

**Roster item fields:**

| Field | Notes |
|-------|-------|
| `jid` | Bare JID from the `jid` attribute |
| `name` | Display name from `name` attribute, or undefined if absent |
| `subscription` | `none`, `from`, `to`, `both`, or `remove` |
| `groups` | Array of group names from `<group>` child elements |

**Note:** Most XMPP servers will return `<iq type='error'>` for a roster query from a component, since roster queries are normally a client-to-server operation (RFC 6121). The roster endpoint is primarily useful with servers that have been specially configured to allow component-initiated roster queries.

---

## Implementation Details

### SHA-1 Handshake

Uses Web Crypto API (`crypto.subtle.digest('SHA-1', data)`) to compute the SHA-1 hash. The hash is encoded as lowercase hexadecimal, per XEP-0114 section 2.

```typescript
const input = streamId + secret;
const hashBuffer = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
const hashHex = Array.from(new Uint8Array(hashBuffer))
  .map(b => b.toString(16).padStart(2, '0')).join('');
// Result: <handshake>hashHex</handshake>
```

### XML Parsing

No DOM/SAX parser. All extraction is via `String.includes()` and `RegExp.exec()`. Implications:

- **Stream ID** extracted from first `id='...'` attribute match. Correct in practice since `<stream:stream>` is the first element in the server response.
- **Handshake success** detected by `<handshake/>`, `<handshake />`, or `<handshake></handshake>` substring match.
- **Stream errors** detected by `<stream:error>` or `</error>` substring. The `</error>` check is intentionally broad to catch non-prefixed error closing tags.
- **Error conditions** detected by substring: `<not-authorized`, `<host-unknown`, `<invalid-namespace`, `<invalid-xml`, `<connection-timeout`, `<system-shutdown`, `<conflict`.

### XML Escaping

The `xmlEscape()` function escapes `& < > " '` in attribute values and text content. Applied to:
- `componentName` / `componentDomain` in stream `to=` attribute
- `from` and `to` JIDs in stanzas
- Message body text content

### Socket Read Strategy

Two different read strategies are used:

1. **Probe/Handshake handlers** (`handleJabberComponentProbe`, `handleJabberComponentHandshake`): Single `reader.read()` call, raced against timeout. Returns the first chunk from the server.

2. **Send/Roster handlers** (`handleJabberComponentSend`, `handleJabberComponentRoster`): `readWithDeadline(reader, ms)` -- reads in a loop until a deadline timer fires. Accumulates all data received within the deadline window. Better for multi-chunk responses but introduces a fixed minimum wait time.

### Timeout Architecture

- **Outer timeout**: `Promise.race` against a wall-clock `setTimeout(timeout)`. Kills the entire operation if it exceeds the budget.
- **Inner read deadline**: `readWithDeadline` uses `Math.min(timeout, 5000)` for stream/handshake reads, `Math.min(timeout, 3000)` for post-message reads.
- The `readWithDeadline` function creates a single deadline promise. Once it fires, all subsequent `Promise.race` iterations in the loop resolve immediately, ending the loop. This means reads that arrive just before the deadline fires are captured, but reads arriving after are not.

---

## Quick Reference -- curl

```bash
# Probe component port (no auth)
curl -s -X POST https://portofcall.ross.gg/api/jabber-component/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"xmpp.example.com","componentName":"gateway.example.com"}' | jq .

# Probe non-standard port
curl -s -X POST https://portofcall.ross.gg/api/jabber-component/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"xmpp.example.com","port":5347,"componentName":"bot.example.com"}' | jq .

# Full handshake (shared secret)
curl -s -X POST https://portofcall.ross.gg/api/jabber-component/handshake \
  -H 'Content-Type: application/json' \
  -d '{"host":"xmpp.example.com","componentName":"gateway.example.com","secret":"mysecret"}' | jq .

# Send a message through the component
curl -s -X POST https://portofcall.ross.gg/api/jabber-component/send \
  -H 'Content-Type: application/json' \
  -d '{
    "host":"xmpp.example.com",
    "componentDomain":"gateway.example.com",
    "secret":"mysecret",
    "from":"bot@gateway.example.com",
    "to":"alice@example.com",
    "body":"Hello from the gateway"
  }' | jq .

# IQ ping through the component (omit body)
curl -s -X POST https://portofcall.ross.gg/api/jabber-component/send \
  -H 'Content-Type: application/json' \
  -d '{
    "host":"xmpp.example.com",
    "componentDomain":"gateway.example.com",
    "secret":"mysecret",
    "from":"gateway.example.com",
    "to":"example.com"
  }' | jq .

# Roster query through the component
curl -s -X POST https://portofcall.ross.gg/api/jabber-component/roster \
  -H 'Content-Type: application/json' \
  -d '{
    "host":"xmpp.example.com",
    "componentDomain":"gateway.example.com",
    "secret":"mysecret",
    "serverDomain":"example.com"
  }' | jq .
```

---

## Local Test Servers

### ejabberd with component support

```bash
docker run -d -p 5222:5222 -p 5275:5275 --name ejabberd ejabberd/ecs

# Edit ejabberd.yml to add component listener:
# listen:
#   -
#     port: 5275
#     module: ejabberd_service
#     access: all
#     hosts:
#       "gateway.localhost":
#         password: "componentpass"

# Restart after config change
docker restart ejabberd

# Test probe
curl -s -X POST http://localhost:8787/api/jabber-component/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","componentName":"gateway.localhost"}' | jq .

# Test handshake
curl -s -X POST http://localhost:8787/api/jabber-component/handshake \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","componentName":"gateway.localhost","secret":"componentpass"}' | jq .
```

### Prosody with component support

```bash
docker run -d -p 5222:5222 -p 5275:5275 --name prosody prosody/prosody

# Edit /etc/prosody/prosody.cfg.lua:
# Component "gateway.localhost"
#   component_secret = "componentpass"

# Restart after config change
docker restart prosody
```

**Note:** Port 5275 is the IANA-assigned port for `jabber-component` connections. Some servers use port 5347 instead (common in Prosody configurations). Always check server configuration.

---

## Known Bugs and Limitations

### Bugs (fixed in this review)

1. **Stanzas incorrectly used `xmlns='jabber:client'`** -- The `/send` endpoint's message and IQ ping stanzas included `xmlns='jabber:client'`, which is wrong for a component stream operating under `jabber:component:accept`. Many XMPP servers reject or misroute stanzas with the wrong namespace. **Fixed:** Removed the explicit xmlns attribute; stanzas now inherit from the stream.

2. **`buildComponentStreamInit` did not XML-escape `componentName`** -- A component name containing `'` or XML special characters could break the stream opening element. **Fixed:** Applied `xmlEscape()`.

3. **Handshake success detection missed `<handshake></handshake>`** -- XML allows both `<handshake/>` (self-closing) and `<handshake></handshake>` (empty element with closing tag) as equivalent forms. Only the self-closing forms were detected. **Fixed:** Added `<handshake></handshake>` check.

### Remaining Limitations

- **No stream closure** -- The implementation calls `socket.close()` without sending `</stream:stream>`. Per RFC 6120 section 4.4, the closing entity SHOULD send `</stream:stream>` before closing the TCP connection. Most servers handle abrupt disconnects gracefully, but this is technically non-compliant.

- **No `<stream:features>` parsing** -- XEP-0114 does not define stream features, but some modern servers (e.g., ejabberd) may send features after the stream open. The implementation ignores these, which is fine per the spec.

- **Single-read for probe/handshake** -- The probe and handshake handlers read a single chunk from the socket. If the server's response spans multiple TCP segments, only the first segment is processed. This could miss the stream ID or handshake confirmation on slow or fragmented connections.

- **`readWithDeadline` orphaned reads** -- When the deadline fires mid-loop, a pending `reader.read()` promise is abandoned but never cancelled. The orphaned read resolves later into the void. This is harmless for the current single-use-per-connection pattern but would be problematic if the reader were reused.

- **`</error>` false positive in `parseStreamResponse`** -- The error detection checks for `</error>` substring which could match stanza-level `<error>` elements (from IQ errors) during the post-handshake stanza exchange phase. In practice, this only affects `readWithDeadline` calls in the send/roster handlers, not the initial stream/handshake parsing.

- **Roster query behavior** -- Components normally do not query rosters (that is a client-to-server operation per RFC 6121). Most servers will return `<iq type='error'>` with `<forbidden/>` or `<not-allowed/>`. The roster endpoint is useful only with servers specifically configured to allow component roster queries.

- **No TLS** -- Cloudflare Workers sockets do not support direct TLS connections. Component connections are plaintext only. The shared secret (and the SHA-1 hash of it) are transmitted in the clear.

- **SHA-1 weakness** -- XEP-0114 uses SHA-1, which is cryptographically deprecated. The hash is of `streamId + secret`, meaning anyone who can observe the handshake and knows/guesses the stream ID (which is sent in plaintext) could attempt to brute-force the secret. This is a fundamental limitation of XEP-0114, not the implementation.

- **No reconnection** -- Each API call opens a fresh TCP connection, performs the operation, and closes. There is no persistent component connection or reconnection logic.

- **IQ stanza ID is hardcoded** -- The ping stanza uses `id='ping1'` and the roster query uses `id='roster{timestamp}'`. The ping ID is not unique across concurrent connections.

---

## Differences from XMPP C2S and S2S

| Property | Component (XEP-0114) | C2S (RFC 6120) | S2S (RFC 6120) |
|----------|---------------------|-----------------|-----------------|
| Port | 5275 | 5222 | 5269 |
| Stream namespace | `jabber:component:accept` | `jabber:client` | `jabber:server` |
| Authentication | SHA-1(streamId + secret) | SASL (PLAIN, SCRAM, etc.) | Dialback, SASL EXTERNAL |
| Stream features | Not defined | Yes (TLS, SASL, bind) | Yes (TLS, SASL, dialback) |
| Resource binding | No | Yes | No |
| `version='1.0'` | Not required | Required | Required |
| STARTTLS | Not defined | Supported | Supported |
| Post-auth stanza namespace | `jabber:component:accept` | `jabber:client` | `jabber:server` |

---

## References

- **XEP-0114**: Jabber Component Protocol -- https://xmpp.org/extensions/xep-0114.html
- **RFC 6120**: XMPP Core -- https://tools.ietf.org/html/rfc6120
- **RFC 6121**: XMPP IM (roster management) -- https://tools.ietf.org/html/rfc6121
- **XEP-0199**: XMPP Ping -- https://xmpp.org/extensions/xep-0199.html
- **IANA port 5275**: jabber-component -- https://www.iana.org/assignments/service-names-port-numbers
