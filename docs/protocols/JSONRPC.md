# JSON-RPC 2.0 — Power User Reference

## Overview

**JSON-RPC 2.0** is a stateless, transport-agnostic remote procedure call protocol encoding requests and responses as JSON objects. Port of Call provides two transports: HTTP/1.1 over raw TCP and WebSocket over raw TCP. No proxies, no `fetch()` — all connections use `cloudflare:sockets connect()`.

**Spec:** [jsonrpc.org/specification](https://www.jsonrpc.org/specification)  
**Default port (HTTP):** 8545 (Ethereum RPC convention)  
**Default port (WebSocket):** 8546 (Ethereum WebSocket convention)  
**Body size cap (HTTP):** 512 KB  
**Transport:** Raw TCP — `connect()` from `cloudflare:sockets`

---

## Endpoints

### POST /api/jsonrpc/call

Send a single JSON-RPC 2.0 request over HTTP/1.1.

**Request**
```json
{
  "host":     "mainnet.infura.io",
  "port":     8545,
  "path":     "/v3/YOUR_KEY",
  "method":   "eth_blockNumber",
  "params":   [],
  "username": "user",
  "password": "pass",
  "timeout":  15000
}
```

| Field      | Type    | Default | Description                                          |
|------------|---------|---------|------------------------------------------------------|
| `host`     | string  | —       | **Required.** Target hostname or IP                  |
| `port`     | integer | 8545    | TCP port                                             |
| `path`     | string  | `/`     | HTTP path. Leading `/` added if missing              |
| `method`   | string  | —       | **Required.** JSON-RPC method name                   |
| `params`   | any     | omitted | Positional array or named object. Omitted (not null) if not provided |
| `username` | string  | —       | HTTP Basic Auth username                             |
| `password` | string  | —       | HTTP Basic Auth password                             |
| `timeout`  | integer | 15000   | Socket + read deadline in ms                         |

**Response — success**
```json
{
  "success":    true,
  "statusCode": 200,
  "jsonrpc": {
    "jsonrpc": "2.0",
    "result":  "0x1234abc",
    "id":      1
  },
  "latencyMs": 142
}
```

**Response — JSON-RPC level error (success:true + error field)**
```json
{
  "success":    true,
  "statusCode": 200,
  "jsonrpc": {
    "jsonrpc": "2.0",
    "error":   { "code": -32601, "message": "Method not found" },
    "id":      1
  },
  "error":     "JSON-RPC Error -32601: Method not found",
  "latencyMs": 88
}
```

**Response — transport error (400/500)**
```json
{ "success": false, "error": "Connection timeout" }
```

| Field        | Type    | Description                                                              |
|--------------|---------|--------------------------------------------------------------------------|
| `success`    | boolean | `true` if HTTP status 200–399. **Not** JSON-RPC level success            |
| `statusCode` | integer | Raw HTTP status code                                                     |
| `jsonrpc`    | object  | Parsed response body (or `null` if body is not valid JSON)               |
| `error`      | string  | Set to `"JSON-RPC Error CODE: MESSAGE"` when `jsonrpc.error` exists; also the transport error string on 500 |
| `latencyMs`  | integer | Wall clock from TCP connect to last byte                                 |

**Key behaviors:**
- Request ID is hardcoded to `1`.
- HTTP wire: `POST {path} HTTP/1.1`, `Connection: close`, `User-Agent: PortOfCall/1.0`, `Content-Type: application/json`, `Accept: application/json`.
- Chunked transfer encoding is decoded. Gzip/deflate content-encoding is not decoded.
- A JSON-RPC error response (`jsonrpc.error` present) sets `response.error` but does **not** set `success: false` as long as HTTP returned 2xx.
- `jsonrpc` field is `null` when the server returns non-JSON (e.g. HTML error page, empty body).

---

### POST /api/jsonrpc/batch

Send multiple JSON-RPC 2.0 calls in a single HTTP request per the spec's batch extension.

**Request**
```json
{
  "host":  "localhost",
  "port":  8545,
  "path":  "/",
  "calls": [
    { "method": "eth_blockNumber", "params": [] },
    { "method": "eth_chainId",     "params": [] },
    { "method": "net_version",     "params": [] }
  ],
  "username": "user",
  "password": "pass",
  "timeout":  15000
}
```

| Field      | Type    | Default | Description                                          |
|------------|---------|---------|------------------------------------------------------|
| `host`     | string  | —       | **Required.**                                        |
| `port`     | integer | 8545    |                                                      |
| `path`     | string  | `/`     |                                                      |
| `calls`    | array   | —       | **Required.** Non-empty array of `{ method, params? }` |
| `username` | string  | —       |                                                      |
| `password` | string  | —       |                                                      |
| `timeout`  | integer | 15000   |                                                      |

**Response**
```json
{
  "success":   true,
  "statusCode": 200,
  "responses": [
    { "jsonrpc": "2.0", "result": "0x1234", "id": 1 },
    { "jsonrpc": "2.0", "result": "0x1",    "id": 2 },
    { "jsonrpc": "2.0", "result": "1",      "id": 3 }
  ],
  "latencyMs": 201
}
```

| Field       | Type    | Description                                                        |
|-------------|---------|--------------------------------------------------------------------|
| `success`   | boolean | `true` if HTTP status 200–399                                      |
| `statusCode`| integer | Raw HTTP status code                                               |
| `responses` | array   | Parsed JSON array of response objects (or `null` if not valid JSON)|
| `latencyMs` | integer | Round-trip time                                                    |

**Key behaviors:**
- IDs are **auto-assigned**: call at index 0 → `id: 1`, index 1 → `id: 2`, etc. Not configurable.
- Servers may return batch responses in any order. The `id` field in each response object is the only reliable correlation key — array position in `responses` may differ from request order.
- No per-call `error` extraction: individual call failures appear as `{ "jsonrpc": "2.0", "error": {...}, "id": N }` objects within `responses`. The top-level `success` only reflects HTTP status.
- Not all servers implement batch. Some return HTTP 200 with a single error object (not an array) — in that case `responses` is that error object, not an array.

---

### POST /api/jsonrpc/ws

Send a single JSON-RPC 2.0 call over WebSocket.

**Request**
```json
{
  "host":     "mainnet.infura.io",
  "port":     8546,
  "path":     "/ws/v3/YOUR_KEY",
  "method":   "eth_subscribe",
  "params":   ["newHeads"],
  "username": "user",
  "password": "pass",
  "timeout":  15000
}
```

| Field      | Type    | Default | Description                                          |
|------------|---------|---------|------------------------------------------------------|
| `host`     | string  | —       | **Required.**                                        |
| `port`     | integer | **8546**| TCP port (Ethereum WS convention — different from /call's 8545) |
| `path`     | string  | `/`     |                                                      |
| `method`   | string  | —       | **Required.**                                        |
| `params`   | any     | omitted | Omitted if not provided                              |
| `username` | string  | —       | Sent in `Authorization: Basic` upgrade header        |
| `password` | string  | —       |                                                      |
| `timeout`  | integer | 15000   | Covers connect + upgrade + read. WS read loop is additionally capped at `min(timeout, 10000)` ms |

**Response — success**
```json
{
  "success":   true,
  "transport": "websocket",
  "jsonrpc": {
    "jsonrpc": "2.0",
    "result":  "0xabc",
    "id":      1
  },
  "latencyMs": 95
}
```

**Response — upgrade failure**
```json
{
  "success": false,
  "error":   "WebSocket upgrade failed: HTTP/1.1 401 Unauthorized"
}
```

**Response — no parseable JSON received**
```json
{
  "success":      false,
  "transport":    "websocket",
  "jsonrpc":      null,
  "rawResponse":  "...(first 512 bytes)...",
  "latencyMs":    10001
}
```

| Field         | Type    | Description                                                         |
|---------------|---------|---------------------------------------------------------------------|
| `success`     | boolean | `true` if response parsed as valid JSON. **Not** HTTP-level success |
| `transport`   | string  | Always `"websocket"` on non-upgrade-failure paths                   |
| `jsonrpc`     | object  | Parsed JSON response (or `null`)                                    |
| `rawResponse` | string  | First 512 bytes of unparsed response; only present when `jsonrpc` is null |
| `latencyMs`   | integer | From WS frame write to JSON parse                                   |

**Key behaviors:**
- WebSocket handshake uses a random 16-byte `Sec-WebSocket-Key` (base64). The server's `Sec-WebSocket-Accept` is **not validated** — any `101` response is accepted.
- Client sends a **masked text frame** (opcode `0x81`, mask bit set). Frame length encoding handles all three sizes (7-bit, 16-bit, 64-bit).
- Response reader accumulates chunks until `JSON.parse()` succeeds on the concatenated text, or until the read deadline. Stops on opcode `0x8` (close frame).
- **WS read deadline is `min(timeout, 10000)` ms from the point the frame is sent** — not from the total timeout start. A `timeout` of 30000 still caps the WS read at 10 seconds.
- Server-masked response frames: the parser checks the mask bit but does not apply unmasking (servers legitimately send unmasked frames per RFC 6455 §5.1).
- Upgrade failure (non-101): HTTP status is returned as **200** with `success: false`, not 4xx/5xx.
- On upgrade failure the response body is not returned — only the first status line.

---

## Wire Format Details

### HTTP Transport (sendHttpPost)

```
POST {path} HTTP/1.1\r\n
Host: {host}:{port}\r\n
Content-Type: application/json\r\n
Content-Length: {N}\r\n
Accept: application/json\r\n
Connection: close\r\n
User-Agent: PortOfCall/1.0\r\n
[Authorization: Basic {base64}\r\n]
\r\n
{json-rpc body}
```

Read accumulates up to **512 KB** then stops. Chunked TE is decoded. Content-Encoding (gzip etc.) is not decoded.

### WebSocket Transport

**Upgrade request:**
```
GET {path} HTTP/1.1\r\n
Host: {host}:{port}\r\n
Upgrade: websocket\r\n
Connection: Upgrade\r\n
Sec-WebSocket-Key: {random16b64}\r\n
Sec-WebSocket-Version: 13\r\n
[Authorization: Basic {base64}\r\n]
\r\n
```

**Client frame (text, masked):**
```
Byte 0: 0x81 (FIN=1, opcode=1 text)
Byte 1: 0x80 | payloadLen  (if ≤125)
        0x80 | 126, then 2-byte big-endian len  (if 126–65535)
        0x80 | 127, then 8-byte big-endian len  (if >65535)
Bytes:  4-byte random mask
Bytes:  XOR-masked payload
```

---

## JSON-RPC 2.0 Error Codes

Standard error codes the server may return in `jsonrpc.error.code`:

| Code            | Meaning                  |
|-----------------|--------------------------|
| `-32700`        | Parse error              |
| `-32600`        | Invalid Request          |
| `-32601`        | Method not found         |
| `-32602`        | Invalid params           |
| `-32603`        | Internal error           |
| `-32000`–`-32099` | Server-defined errors  |

---

## curl Examples

### Single call (Ethereum block number)
```bash
curl -s -X POST https://portofcall.ross.gg/api/jsonrpc/call \
  -H 'Content-Type: application/json' \
  -d '{
    "host":   "mainnet.infura.io",
    "port":   8545,
    "path":   "/v3/YOUR_KEY",
    "method": "eth_blockNumber",
    "params": []
  }' | jq '{success, statusCode, result: .jsonrpc.result, latencyMs}'
```

### Single call with Basic Auth
```bash
curl -s -X POST https://portofcall.ross.gg/api/jsonrpc/call \
  -H 'Content-Type: application/json' \
  -d '{
    "host":     "my-node.example.com",
    "port":     8332,
    "path":     "/",
    "method":   "getblockcount",
    "params":   [],
    "username": "rpcuser",
    "password": "rpcpass"
  }' | jq .
```

### Batch call
```bash
curl -s -X POST https://portofcall.ross.gg/api/jsonrpc/batch \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "localhost",
    "port": 8545,
    "calls": [
      { "method": "eth_blockNumber", "params": [] },
      { "method": "eth_chainId",     "params": [] },
      { "method": "net_peerCount",   "params": [] }
    ]
  }' | jq '.responses[] | {id, result: .result, error: .error}'
```

### WebSocket call
```bash
curl -s -X POST https://portofcall.ross.gg/api/jsonrpc/ws \
  -H 'Content-Type: application/json' \
  -d '{
    "host":   "mainnet.infura.io",
    "port":   8546,
    "path":   "/ws/v3/YOUR_KEY",
    "method": "eth_blockNumber",
    "params": []
  }' | jq '{success, transport, result: .jsonrpc.result, latencyMs}'
```

### Probe if a server speaks JSON-RPC at all
```bash
curl -s -X POST https://portofcall.ross.gg/api/jsonrpc/call \
  -H 'Content-Type: application/json' \
  -d '{
    "host":    "my-service.example.com",
    "port":    8545,
    "method":  "rpc_modules",
    "params":  [],
    "timeout": 5000
  }' | jq '{success, statusCode, error, parsed_ok: (.jsonrpc != null)}'
```

---

## Power User Notes

### success semantics differ by endpoint

`/call` and `/batch` define `success` as **HTTP status 200–399**. A JSON-RPC error (`{"error":{...}}`) still produces `success: true` if the HTTP layer returned 2xx. `/ws` defines `success` as **parsed JSON received** — entirely independent of HTTP. These are not equivalent.

### JSON-RPC errors on /call

When the JSON-RPC response contains an `error` object, the top-level `error` field is set to `"JSON-RPC Error CODE: MESSAGE"` **in addition to** the `jsonrpc` field containing the full response. Always check `jsonrpc.error` directly for `code` and `data`; the top-level `error` string is a convenience summary only.

### params omission vs null

When `params` is not provided, it is **omitted from the wire JSON** (not sent as `null` or `[]`). Some servers require `params` to always be present; send `"params": []` explicitly when targeting strict servers.

### Batch ID assignment

IDs are `index + 1` (1-based). You cannot control them. If you need to correlate batch responses with your own identifiers, match by `responses[n].id` and subtract 1 to get the original array index.

### WS read deadline cap

The WebSocket read loop is capped at `min(timeout, 10000)` ms from when the frame is sent. Setting `timeout: 30000` does **not** give you 30 seconds of WS read time — it gives you 10. This cap exists as a hardcoded constant in the implementation. Use `/call` (HTTP) for long-running operations; use `/ws` only when the server requires WebSocket transport.

### WS Sec-WebSocket-Accept not validated

The implementation accepts any `101` upgrade response without checking the `Sec-WebSocket-Accept` HMAC. This is fine for testing/probing but means a man-in-the-middle could present any 101 response.

### 512 KB HTTP response cap

HTTP responses (both `/call` and `/batch`) stop accumulating at 512,000 bytes. If the JSON-RPC response is truncated, `JSON.parse` fails and `jsonrpc` is `null`. This can happen with methods that return large data (e.g. `eth_getLogs` with wide block ranges).

### No TLS

All three endpoints use plain TCP (`connect()` with no `secureTransport`). For TLS-wrapped JSON-RPC (e.g. HTTPS or WSS), you must terminate TLS externally (reverse proxy, Cloudflare Tunnel) before Port of Call reaches the host.

### No redirect following

HTTP 301/302 responses from the JSON-RPC server are returned as-is with the `statusCode` reflecting the redirect. `success` is `true` (3xx is in the 200–399 range). The `jsonrpc` field will be `null` if the redirect body is non-JSON (usually HTML).

### Chunked TE decoded, Content-Encoding not

`Transfer-Encoding: chunked` responses are decoded. `Content-Encoding: gzip` or `deflate` are not decoded — the raw compressed bytes are treated as text and `JSON.parse` will fail.
