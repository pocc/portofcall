# WebSocket -- Power User Reference

**Port:** 80 (ws://), 443 (wss://)
**Transport:** TCP (HTTP upgrade)
**RFC:** [RFC 6455](https://tools.ietf.org/html/rfc6455)
**Source:** `src/worker/websocket.ts`

One endpoint. No persistent connection. Performs a one-shot TCP WebSocket handshake probe.

---

## Endpoint

### `POST /api/websocket/probe` -- Test WebSocket upgrade handshake

Connects via raw TCP, sends an HTTP/1.1 Upgrade request, validates the 101 response and `Sec-WebSocket-Accept` header, and optionally sends a ping frame to verify the connection is alive.

**Request (JSON body -- POST only):**

| Field | Default | Notes |
|---|---|---|
| `host` | -- | Required |
| `port` | `80` | Target port |
| `path` | `"/"` | Request path for the GET upgrade |
| `protocols` | -- | Optional `Sec-WebSocket-Protocol` value |
| `sendPing` | `false` | If true, sends a masked ping frame after successful upgrade and checks for pong |
| `timeout` | `10000` | Wall-clock timeout in ms; clamped to 1000-30000 |

**Success (200):**

```json
{
  "success": true,
  "host": "echo.websocket.org",
  "port": 80,
  "path": "/",
  "statusCode": 101,
  "statusText": "Switching Protocols",
  "websocketUpgrade": true,
  "acceptKeyValid": true,
  "serverHeaders": {
    "upgrade": "websocket",
    "connection": "Upgrade",
    "sec-websocket-accept": "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
  },
  "negotiatedProtocol": null,
  "negotiatedExtensions": null,
  "server": "nginx",
  "connectTimeMs": 42,
  "totalTimeMs": 87
}
```

**With `sendPing: true` (appended to success response):**

```json
{
  "pingResponse": {
    "received": true,
    "opcode": 10,
    "opcodeName": "Pong",
    "fin": true,
    "payloadLength": 15,
    "isPong": true
  }
}
```

**Failure (400 validation / 403 Cloudflare / 500 connection error):**

```json
{
  "success": false,
  "error": "Connection timeout"
}
```

**Validation errors (HTTP 400):**
- Missing or empty `host` -> `"Host is required"`
- Port outside 1-65535 -> `"Port must be between 1 and 65535"`

**Key fields:**

| Field | Notes |
|---|---|
| `websocketUpgrade` | `true` only if status is 101, `Upgrade: websocket` header present, and `Connection` includes `upgrade` |
| `acceptKeyValid` | Whether `Sec-WebSocket-Accept` matches the expected SHA-1 hash of the client key + RFC 6455 GUID |
| `negotiatedProtocol` | Value of `Sec-WebSocket-Protocol` response header, or `null` |
| `negotiatedExtensions` | Value of `Sec-WebSocket-Extensions` response header (e.g., `permessage-deflate`), or `null` |
| `connectTimeMs` | TCP connect latency in ms |
| `totalTimeMs` | Total probe duration including handshake and optional ping |

---

## Wire Exchange

```
-> (TCP connect to host:port)
-> GET <path> HTTP/1.1\r\n
   Host: <host[:port]>\r\n
   Upgrade: websocket\r\n
   Connection: Upgrade\r\n
   Sec-WebSocket-Key: <random 16-byte base64>\r\n
   Sec-WebSocket-Version: 13\r\n
   Origin: http://<host>\r\n
   [Sec-WebSocket-Protocol: <protocols>\r\n]
   \r\n

<- HTTP/1.1 101 Switching Protocols\r\n
   Upgrade: websocket\r\n
   Connection: Upgrade\r\n
   Sec-WebSocket-Accept: <SHA-1 hash>\r\n
   \r\n

   (if sendPing)
-> [masked ping frame, opcode 0x9, payload "portofcall-ping"]
<- [pong frame, opcode 0xA]

-> (TCP close)
```

### Sec-WebSocket-Accept Computation (RFC 6455 Section 4.2.2)

The server proves it understands WebSocket by concatenating the client's `Sec-WebSocket-Key` with the magic GUID `258EAFA5-E914-47DA-95CA-C5AB0DC85B11`, taking the SHA-1 hash, and base64-encoding the result. The implementation verifies this value and reports `acceptKeyValid`.

### Frame Format

WebSocket messages are sent as frames:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-------+-+-------------+-------------------------------+
|F|R|R|R| opcode|M| Payload len |    Extended payload length    |
|I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
|N|V|V|V|       |S|             |   (if payload len==126/127)   |
| |1|2|3|       |K|             |                               |
+-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - +
```

### Opcodes

| Code | Name |
|---|---|
| `0x0` | Continuation |
| `0x1` | Text (UTF-8) |
| `0x2` | Binary |
| `0x8` | Close |
| `0x9` | Ping |
| `0xA` | Pong |

### Masking

Client-to-server frames MUST be masked (RFC 6455 Section 5.3). The implementation generates a random 4-byte masking key for the ping frame. Server-to-client frames MUST NOT be masked.

### Close Codes

| Code | Meaning |
|---|---|
| `1000` | Normal Closure |
| `1001` | Going Away |
| `1002` | Protocol Error |
| `1003` | Unsupported Data |
| `1007` | Invalid Frame Payload Data |
| `1008` | Policy Violation |
| `1009` | Message Too Big |
| `1011` | Internal Server Error |

---

## curl Examples

```bash
# Basic WebSocket handshake probe
curl -s -X POST https://l4.fyi/api/websocket/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"echo.websocket.org"}' | jq .

# Probe with ping
curl -s -X POST https://l4.fyi/api/websocket/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"echo.websocket.org","sendPing":true}' | jq .

# Custom port and path
curl -s -X POST https://l4.fyi/api/websocket/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"myserver.example.com","port":8080,"path":"/ws"}' | jq .

# With subprotocol negotiation
curl -s -X POST https://l4.fyi/api/websocket/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"myserver.example.com","protocols":"graphql-ws"}' | jq .

# Short timeout
curl -s -X POST https://l4.fyi/api/websocket/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"slow-server.example.com","timeout":3000}' | jq .
```

---

## Implementation Notes

### Raw TCP, not the WebSocket API

The probe uses Cloudflare's `connect()` Sockets API for raw TCP -- it does **not** use the browser/Worker `WebSocket` class. This allows inspecting the HTTP upgrade handshake at the byte level and reporting on individual headers.

### CRLF injection prevention

The `host`, `path`, and `protocols` values are sanitized by stripping `\r` and `\n` characters before being interpolated into the HTTP request.

### Shared timeout

The same timeout budget covers TCP connect, HTTP upgrade, and the optional ping/pong. If the connection takes most of the budget, little time remains for the ping phase.

### Cloudflare detection

The handler calls `checkIfCloudflare` before connecting. If the target host is behind Cloudflare, the request returns HTTP 403.

### Ping payload

When `sendPing` is true, the probe sends a masked ping frame with the payload `"portofcall-ping"` and waits up to 5 seconds for a response frame. The response frame is parsed and reported regardless of opcode (the probe checks whether it is a pong but reports whatever it receives).

---

## Known Limitations

- **Probe only** -- this is a one-shot handshake test, not a persistent WebSocket connection; no message sending/receiving beyond the optional ping
- **No TLS** -- connections are plaintext TCP via `connect()`; `wss://` targets on port 443 require TLS which is not provided
- **No streaming** -- the probe reads a single TCP segment for the HTTP response; if the server's 101 response spans multiple segments, parsing may fail
- **No close frame** -- the connection is terminated by closing the TCP socket, not by sending a WebSocket close frame (opcode 0x8)
- **Single-segment pong** -- the pong response must arrive in a single TCP read; fragmented pong frames are not reassembled
- **Cloudflare detection** -- connections to Cloudflare-protected hosts are blocked (HTTP 403)
