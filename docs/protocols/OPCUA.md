# OPC UA — Power User Reference

## Overview

**OPC UA (OPC Unified Architecture)** is the successor to OPC Classic, designed for Industrial IoT communication in manufacturing, energy, building automation, and process control. It provides platform-independent, service-oriented architecture with built-in security.

**Default Port:** 4840
**Transport:** Raw TCP (Cloudflare Workers `cloudflare:sockets connect()`)
**Cloudflare detection:** Yes — 403 with `isCloudflare: true` before any TCP attempt
**Safety:** OPC UA can control industrial equipment. This implementation supports **PROBE and READ-ONLY** operations only. Always obtain authorization before connecting to industrial systems.

---

## Transport

All three endpoints (`/hello`, `/endpoints`, `/read`) open a raw TCP socket, exchange OPC UA messages, then close the connection. OPC UA uses a stateful secure channel, but Port of Call endpoints are stateless — each request creates a new channel with `SecurityPolicy#None` and `MessageSecurityMode_None` (no encryption).

### OPC UA Binary Protocol Stack

Port of Call implements **OPC UA over TCP Binary** (OPC 10000-6):

```
┌──────────────────────────────────────┐
│ Service Layer (GetEndpoints)         │
├──────────────────────────────────────┤
│ Secure Channel (OPN/MSG/CLO)         │
├──────────────────────────────────────┤
│ Transport (HEL/ACK/ERR)              │
├──────────────────────────────────────┤
│ TCP Socket (port 4840)               │
└──────────────────────────────────────┘
```

### Message Types

| Type | Meaning | Direction | When Used |
|------|---------|-----------|-----------|
| `HEL` | Hello | Client → Server | Initial connection handshake |
| `ACK` | Acknowledge | Server → Client | Accepting Hello |
| `ERR` | Error | Server → Client | Rejecting Hello (protocol version, endpoint URL) |
| `OPN` | OpenSecureChannel | Both | Establish or renew secure channel |
| `MSG` | Message | Both | Service requests/responses (GetEndpoints, Read, etc.) |
| `CLO` | CloseSecureChannel | Both | Graceful channel teardown |

Port of Call uses `HEL` → `ACK` → `OPN` → `MSG` sequences. `CLO` is not sent; sockets are simply closed after reading the response.

### Message Header Format

All OPC UA messages share a common 8-byte header:

```
Offset  Size  Field
0       3     MessageType (ASCII: "HEL", "ACK", "OPN", "MSG", "ERR")
3       1     ChunkType ('F' = Final, 'C' = Intermediate, 'A' = Abort)
4       4     MessageSize (uint32 little-endian, includes this header)
```

The implementation validates that `MessageSize` is between 8 and 1,000,000 bytes to prevent buffer overflows.

---

## Endpoints

### POST /api/opcua/hello

Connectivity probe. Sends an OPC UA `Hello` message and expects an `ACK` (or `ERR`) response. This confirms the server speaks OPC UA but does not establish a secure channel.

**Request**
```json
{
  "host": "opcua.factory.local",
  "port": 4840,
  "endpointUrl": "opc.tcp://opcua.factory.local:4840",
  "timeout": 10000
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `host` | string | — | **Required.** OPC UA server hostname or IP |
| `port` | integer | 4840 | TCP port |
| `endpointUrl` | string | `opc.tcp://{host}:{port}` | OPC UA endpoint URL (sent in Hello message) |
| `timeout` | integer | 10000 | Outer connection timeout in ms |

**Response — server reachable (ACK)**
```json
{
  "success": true,
  "message": "OPC UA server reachable at opcua.factory.local:4840",
  "host": "opcua.factory.local",
  "port": 4840,
  "endpointUrl": "opc.tcp://opcua.factory.local:4840",
  "acknowledge": {
    "protocolVersion": 0,
    "receiveBufferSize": 65536,
    "sendBufferSize": 65536,
    "maxMessageSize": 0,
    "maxChunkCount": 0
  },
  "rawHex": "41 43 4b 46 1c 00 00 00 00 00 00 00 00 00 01 00 00 00 01 00 00 00 00 00 00 00 00 00"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `protocolVersion` | integer | Always 0 for OPC UA Binary |
| `receiveBufferSize` | integer | Server's receive buffer size in bytes (typical: 65536) |
| `sendBufferSize` | integer | Server's send buffer size in bytes |
| `maxMessageSize` | integer | Max message size in bytes (0 = no limit) |
| `maxChunkCount` | integer | Max chunks per message (0 = no limit) |
| `rawHex` | string | First 64 bytes of response in hex |

**Response — server rejected Hello (ERR)**
```json
{
  "success": true,
  "message": "OPC UA server responded with error at opcua.factory.local:4840",
  "host": "opcua.factory.local",
  "port": 4840,
  "endpointUrl": "opc.tcp://opcua.factory.local:4840",
  "serverError": {
    "code": 2147876978,
    "name": "BadTcpEndpointUrlInvalid",
    "reason": "The endpoint URL does not match configured endpoints"
  },
  "rawHex": "45 52 52 46 ..."
}
```

**Response — connection failed (500)**
```json
{
  "success": false,
  "error": "Connection timeout"
}
```

---

### POST /api/opcua/endpoints

Endpoint discovery. Sends `Hello` → `OpenSecureChannel` to establish a secure channel (with `SecurityPolicy#None`). Returns the secure channel status and negotiated parameters.

This endpoint does **not** send a `GetEndpoints` service request despite the name. Use `/api/opcua/read` for full endpoint enumeration.

**Request**
```json
{
  "host": "opcua.factory.local",
  "port": 4840,
  "endpointUrl": "opc.tcp://opcua.factory.local:4840",
  "timeout": 10000
}
```

Parameters are identical to `/hello`.

**Response — secure channel opened**
```json
{
  "success": true,
  "host": "opcua.factory.local",
  "port": 4840,
  "endpointUrl": "opc.tcp://opcua.factory.local:4840",
  "acknowledge": {
    "protocolVersion": 0,
    "receiveBufferSize": 65536,
    "sendBufferSize": 65536,
    "maxMessageSize": 0,
    "maxChunkCount": 0
  },
  "secureChannel": {
    "status": "opened",
    "channelId": 1234567,
    "payloadSize": 142
  },
  "secureChannelRawHex": "4f 50 4e 46 ...",
  "helloRawHex": "41 43 4b 46 ..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `secureChannel.status` | string | `"opened"`, `"rejected"`, or `"unknown"` |
| `secureChannel.channelId` | integer | Server-assigned SecureChannelId (uint32) |
| `secureChannel.payloadSize` | integer | Size of the OPN response payload in bytes |

**Response — secure channel rejected**
```json
{
  "success": true,
  "host": "opcua.factory.local",
  "port": 4840,
  "endpointUrl": "opc.tcp://opcua.factory.local:4840",
  "acknowledge": { ... },
  "secureChannel": {
    "status": "rejected",
    "error": {
      "code": 2148335616,
      "name": "BadSecurityPolicyRejected",
      "reason": "The security policy is not supported"
    }
  }
}
```

**Response — Hello failed**
```json
{
  "success": false,
  "error": "Did not receive ACK to Hello message",
  "host": "opcua.factory.local",
  "port": 4840,
  "rawHex": "45 52 52 46 ..."
}
```

---

### POST /api/opcua/read

Full endpoint discovery. Sends `Hello` → `OpenSecureChannel` → `GetEndpoints` service request. Returns a list of available endpoints with their security configurations.

**Request**
```json
{
  "host": "opcua.factory.local",
  "port": 4840,
  "endpoint_url": "opc.tcp://opcua.factory.local:4840",
  "timeout": 10000
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `host` | string | — | **Required.** OPC UA server hostname or IP |
| `port` | integer | 4840 | TCP port |
| `endpoint_url` | string | `opc.tcp://{host}:{port}` | OPC UA endpoint URL (note: underscore, not camelCase) |
| `timeout` | integer | 10000 | Outer connection timeout in ms |

**Response — success**
```json
{
  "success": true,
  "host": "opcua.factory.local",
  "port": 4840,
  "endpointUrl": "opc.tcp://opcua.factory.local:4840",
  "channelId": 1234567,
  "acknowledge": {
    "protocolVersion": 0,
    "receiveBufferSize": 65536,
    "sendBufferSize": 65536
  },
  "endpoints": [
    {
      "endpointUrl": "opc.tcp://opcua.factory.local:4840",
      "securityMode": "None",
      "securityPolicyUri": "http://opcfoundation.org/UA/SecurityPolicy#None",
      "securityLevel": 0
    },
    {
      "endpointUrl": "opc.tcp://opcua.factory.local:4840",
      "securityMode": "SignAndEncrypt",
      "securityPolicyUri": "http://opcfoundation.org/UA/SecurityPolicy#Basic256Sha256",
      "securityLevel": 3
    }
  ],
  "endpointCount": 2,
  "msgResponseType": "MSG",
  "rawHex": "4d 53 47 46 ..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `endpoints[]` | array | Parsed endpoint descriptions |
| `endpoints[].endpointUrl` | string | Endpoint URL for this configuration |
| `endpoints[].securityMode` | string | `"None"`, `"Sign"`, or `"SignAndEncrypt"` |
| `endpoints[].securityPolicyUri` | string | OPC UA security policy URI |
| `endpoints[].securityLevel` | integer | Relative security level (0-255, higher = more secure) |
| `endpointCount` | integer | Number of endpoints parsed |
| `msgResponseType` | string | Message type of the GetEndpoints response (`"MSG"`) |

**Parsing Caveats:** The `endpoints` array is parsed with **best-effort heuristics**. OPC UA binary encoding is complex (nested structures, variable-length arrays, extensible types). The parser may return fewer endpoints than the server advertises if it encounters unexpected encoding. The `rawHex` field contains the raw payload for manual inspection.

**Response — connection failed**
```json
{
  "success": false,
  "error": "Expected ACK, got ERR",
  "host": "opcua.factory.local",
  "port": 4840
}
```

---

## OPC UA Security Policies

Port of Call only supports **SecurityPolicy#None** (no encryption, no signing). This is adequate for:

- Local network discovery
- Development/testing environments
- Read-only monitoring of non-critical data

Production OPC UA servers typically require one of these policies:

| Policy | Description | Port of Call Support |
|--------|-------------|---------------------|
| `#None` | No encryption, no signing | ✅ Supported |
| `#Basic128Rsa15` | RSA 1024, AES-128-CBC, SHA-1 | ❌ Not supported |
| `#Basic256` | RSA 2048, AES-256-CBC, SHA-1 | ❌ Not supported |
| `#Basic256Sha256` | RSA 2048, AES-256-CBC, SHA-256 | ❌ Not supported |
| `#Aes128_Sha256_RsaOaep` | RSA OAEP, AES-128-CBC, SHA-256 | ❌ Not supported |
| `#Aes256_Sha256_RsaPss` | RSA-PSS, AES-256-CBC, SHA-256 | ❌ Not supported |

If the server rejects `SecurityPolicy#None`, the `/endpoints` or `/read` endpoint will return:

```json
{
  "secureChannel": {
    "status": "rejected",
    "error": {
      "code": 2148335616,
      "name": "BadSecurityPolicyRejected",
      "reason": "..."
    }
  }
}
```

---

## OPC UA Status Codes

OPC UA uses 32-bit status codes. The high bit (bit 31) indicates severity: 1 = error, 0 = success/warning.

Port of Call recognizes these common error codes:

| Code (hex) | Name | Meaning |
|------------|------|---------|
| `0x00000000` | Good | Success |
| `0x80010000` | BadUnexpectedError | Generic error |
| `0x80050000` | BadCommunicationError | Network/transport error |
| `0x800C0000` | BadTimeout | Operation timed out |
| `0x80280000` | BadSecurityChecksFailed | Authentication/authorization failed |
| `0x80340000` | BadSecureChannelIdInvalid | Invalid SecureChannelId in request |
| `0x806D0000` | BadTcpMessageTypeInvalid | Unrecognized message type |
| `0x806E0000` | BadTcpSecureChannelUnknown | SecureChannel not found |
| `0x806F0000` | BadTcpMessageTooLarge | Message exceeds buffer limits |
| `0x80700000` | BadTcpNotEnoughResources | Server out of memory/connections |
| `0x80710000` | BadTcpInternalError | Server internal error |
| `0x80720000` | BadTcpEndpointUrlInvalid | Endpoint URL doesn't match server config |
| `0x80740000` | BadRequestTimeout | Request processing timeout |
| `0x80760000` | BadSecurityPolicyRejected | SecurityPolicy not supported |
| `0x80780000` | BadTcpServerTooBusy | Server busy, retry later |

All other codes are formatted as `Unknown(0x...)`.

---

## Timeout Architecture

Each endpoint has **two** timeout layers:

| Layer | Source | Default | Scope |
|-------|--------|---------|-------|
| Outer | Request JSON `timeout` | 10000 ms | Entire operation (connect + all messages) |
| Inner | Hardcoded in `readOPCUAResponse()` | 5000 ms | Single message read |

The inner timeout applies to each `readOPCUAResponse()` call (typically 2-3 per request: ACK, OPN, MSG). The outer timeout wraps the entire connection promise.

If the outer timeout fires first, the socket is closed and the request returns HTTP 500 with `"Connection timeout"`. If an inner read timeout fires, it propagates as `"Read timeout"`.

**Timeout cleanup:** All timeouts are properly cleared with `clearTimeout()` after the promise resolves or rejects, preventing resource leaks.

---

## curl Examples

### Connectivity check (Hello/ACK)
```bash
curl -s -X POST https://portofcall.ross.gg/api/opcua/hello \
  -H 'Content-Type: application/json' \
  -d '{"host":"opcua.demo-this.com","port":4840}' | jq .
```

### Establish secure channel (Hello/ACK/OPN)
```bash
curl -s -X POST https://portofcall.ross.gg/api/opcua/endpoints \
  -H 'Content-Type: application/json' \
  -d '{"host":"opcua.demo-this.com"}' | jq .secureChannel
```

### Discover server endpoints (full sequence)
```bash
curl -s -X POST https://portofcall.ross.gg/api/opcua/read \
  -H 'Content-Type: application/json' \
  -d '{"host":"opcua.demo-this.com"}' | jq '.endpoints[]'
```

### Custom endpoint URL
```bash
curl -s -X POST https://portofcall.ross.gg/api/opcua/hello \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.50","port":4840,"endpointUrl":"opc.tcp://plc01.factory.local:4840"}' | jq .
```

### Low timeout (5 seconds)
```bash
curl -s -X POST https://portofcall.ross.gg/api/opcua/read \
  -H 'Content-Type: application/json' \
  -d '{"host":"opcua.slow-server.com","timeout":5000}' | jq .
```

---

## Power User Notes

### Endpoint URL Conventions

OPC UA endpoint URLs use the `opc.tcp://` scheme:

```
opc.tcp://hostname:port[/path]
```

The `/path` component is optional and server-specific. If omitted, Port of Call constructs:

```
opc.tcp://{host}:{port}
```

Some servers require an exact match between the `endpointUrl` in the Hello message and their configured endpoint URLs. If you receive `BadTcpEndpointUrlInvalid`, try these variations:

```json
{"endpointUrl": "opc.tcp://192.168.1.50:4840"}
{"endpointUrl": "opc.tcp://plc01:4840"}
{"endpointUrl": "opc.tcp://plc01.factory.local:4840/UA/Server"}
```

Use `/api/opcua/read` to discover the server's advertised endpoint URLs, then use one of those in subsequent requests.

### Protocol Version

OPC UA Binary Protocol Version is always **0**. The ACK message echoes this back. Non-zero versions indicate a protocol mismatch or corrupted response.

### Buffer Sizes

The implementation sends these buffer sizes in the Hello message:

| Field | Value | Meaning |
|-------|-------|---------|
| `ReceiveBufferSize` | 65536 | Client can receive up to 64 KB |
| `SendBufferSize` | 65536 | Client can send up to 64 KB |
| `MaxMessageSize` | 0 | No client-side limit (let server decide) |
| `MaxChunkCount` | 0 | No client-side limit |

The server's ACK response contains its own limits. Most servers use 65536-byte buffers. If the server sets `MaxMessageSize` to a non-zero value, messages larger than this will be rejected.

### Chunking

OPC UA supports message chunking for large payloads. The `ChunkType` field in the message header indicates:

| ChunkType | ASCII | Meaning |
|-----------|-------|---------|
| `F` | Final | Single-chunk message or last chunk |
| `C` | Intermediate | More chunks follow |
| `A` | Abort | Sender is aborting the message |

Port of Call only sends **single-chunk messages** (ChunkType = `F`). The `readOPCUAResponse()` function reads exactly one message (up to the `MessageSize` indicated in the header) and does not reassemble multi-chunk messages. If the server sends chunked responses, only the first chunk will be parsed.

### Message Size Validation

The implementation validates that `MessageSize` (from the message header) is:

- At least 8 bytes (minimum header size)
- At most 1,000,000 bytes (1 MB)

Messages outside this range trigger:

```
Error: Invalid OPC UA message size: {size}
```

This prevents buffer overflow attacks where a malicious server sends a `MessageSize` of 0xFFFFFFFF (4 GB).

### Secure Channel Lifecycle

Port of Call does **not** reuse secure channels. Each request:

1. Opens a new TCP socket
2. Sends `Hello`, receives `ACK`
3. Sends `OpenSecureChannel` (RequestType=Issue), receives `OPN`
4. Optionally sends service requests (like `GetEndpoints`), receives `MSG`
5. Closes the socket without sending `CloseSecureChannel`

The `RequestedLifetime` in `OpenSecureChannel` is 600,000 ms (10 minutes), but the channel is closed immediately after the response.

**Implications:**

- No persistent connections → higher latency per request
- No session management → cannot use stateful services (Browse, CreateSubscription)
- No authentication → only anonymous access via `SecurityPolicy#None`

For production OPC UA clients, use a proper SDK like `node-opcua` or `opcua-asyncio` (Python).

### Raw Hex Output

All responses include a `rawHex` field with the first 64 bytes (or 128 for `/read`) of the response in hex format:

```
41 43 4b 46 1c 00 00 00 00 00 00 00 00 00 01 00
```

This is useful for:

- Debugging malformed responses
- Comparing against Wireshark captures
- Manual parsing of unknown message types

### Endpoint Parsing Limitations

The `parseEndpointList()` function uses **best-effort heuristics** to extract endpoint data from the `GetEndpoints` response. It skips:

- Full `ApplicationDescription` parsing (complex nested structure)
- `UserIdentityTokens` (variable-length array of union types)
- Server certificate validation
- Localized text (only extracts UTF-8 string, ignores locale)

If the parser encounters unexpected encoding (e.g., a new ExtensionObject type introduced in OPC UA 1.05), it may return an incomplete endpoint list. The `endpointCount` field shows how many endpoints were successfully parsed.

For authoritative endpoint information, use:

```bash
# Use node-opcua (Node.js)
npx opcua-commander -e opc.tcp://server:4840

# Or use UaExpert (Windows GUI)
```

### Security Modes

Endpoints can advertise three security modes:

| Mode | Integer | Encryption | Signing | Port of Call Support |
|------|---------|------------|---------|---------------------|
| `None` | 1 | No | No | ✅ Supported |
| `Sign` | 2 | No | Yes | ❌ Not supported |
| `SignAndEncrypt` | 3 | Yes | Yes | ❌ Not supported |

The `securityMode` field in the endpoint list shows the mode as a string. If the server **only** advertises `Sign` or `SignAndEncrypt` endpoints, you will not be able to establish a secure channel with Port of Call.

### OpenSecureChannel Request Details

The `buildOpenSecureChannelRequest()` function sends these parameters:

| Field | Value | Description |
|-------|-------|-------------|
| `SecureChannelId` | 0 | 0 = request new channel |
| `SecurityPolicyUri` | `http://opcfoundation.org/UA/SecurityPolicy#None` | No encryption |
| `ClientProtocolVersion` | 0 | OPC UA Binary version |
| `RequestType` | 0 | Issue (not Renew) |
| `SecurityMode` | 1 | None |
| `ClientNonce` | null | No nonce (not needed for None policy) |
| `RequestedLifetime` | 600000 | 10 minutes in ms |

The server responds with:

- `SecureChannelId` (uint32, non-zero)
- `SecurityToken` (struct with TokenId, CreatedAt, RevisedLifetime)
- `ServerNonce` (null for None policy)

Port of Call extracts only the `SecureChannelId` from the response. The token is not validated or used.

### GetEndpoints Request Details

The `buildGetEndpointsMsgRequest()` function sends a `GetEndpoints` service request (NodeId `i=428`) with:

| Parameter | Value | Description |
|-----------|-------|-------------|
| `EndpointUrl` | From request JSON | Filter endpoints by URL (empty = all) |
| `LocaleIds` | Empty array | No locale filtering |
| `ProfileUris` | Empty array | No transport profile filtering |

The server responds with an array of `EndpointDescription` structures. Each contains:

- `EndpointUrl` (string)
- `Server` (ApplicationDescription — complex nested struct)
- `ServerCertificate` (ByteString)
- `SecurityMode` (enum)
- `SecurityPolicyUri` (string)
- `UserIdentityTokens` (array of union types)
- `TransportProfileUri` (string)
- `SecurityLevel` (byte)

Port of Call extracts only the four fields shown in the response: `endpointUrl`, `securityMode`, `securityPolicyUri`, `securityLevel`.

---

## Local Testing

### OPC UA Simulator (Docker)

```bash
# Run a simple OPC UA server with SecurityPolicy#None
docker run -d -p 4840:4840 --name opcua-server \
  mcr.microsoft.com/iotedge/opc-plc-server:latest \
  --pn=4840 --aa

# Test connectivity
curl -X POST http://localhost:8787/api/opcua/hello \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":4840}'
```

### open62541 Demo Server (Native)

```bash
# Install open62541 (macOS)
brew install open62541

# Run demo server
/usr/local/bin/open62541-server

# Test (default port 4840)
curl -X POST http://localhost:8787/api/opcua/endpoints \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost"}'
```

### Prosys OPC UA Simulation Server (Windows)

Download from [https://www.prosysopc.com/products/opc-ua-simulation-server/](https://www.prosysopc.com/products/opc-ua-simulation-server/)

1. Launch Simulation Server
2. Go to Options → Endpoints
3. Enable "None" security policy
4. Click "Start" in the main window
5. Test from Port of Call:

```bash
curl -X POST https://portofcall.ross.gg/api/opcua/read \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","port":53530}' | jq .
```

---

## Resources

- [OPC UA Specification Part 6: Mappings (Binary Protocol)](https://reference.opcfoundation.org/Core/Part6/)
- [OPC UA GitHub Samples](https://github.com/OPCFoundation/UA-.NETStandard-Samples)
- [node-opcua (Node.js SDK)](https://github.com/node-opcua/node-opcua)
- [opcua-asyncio (Python SDK)](https://github.com/FreeOpcUa/opcua-asyncio)
- [OPC UA Online Reference](https://reference.opcfoundation.org/)
- [UaExpert (Free Windows Client)](https://www.unified-automation.com/products/development-tools/uaexpert.html)

---

## Implementation Notes

**What Port of Call does NOT implement:**

- **Services:** Browse, Read (attribute), Write, Call, CreateSubscription, Publish, etc.
- **Security:** Encryption, signing, certificate validation, user authentication
- **Session management:** CreateSession, ActivateSession, CloseSession
- **Chunking:** Multi-chunk message assembly
- **Data types:** Full encoding/decoding of all OPC UA types (only basic parsing)
- **Transport profiles:** SOAP/HTTP, HTTPS, WebSocket

Port of Call is a **discovery and connectivity tool**, not a full OPC UA client. For production use, use a proper SDK.
