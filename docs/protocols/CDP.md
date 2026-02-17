# Chrome DevTools Protocol (CDP) — Port of Call Reference

**Spec:** [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
**Default port:** 9222
**Source:** `src/worker/cdp.ts`
**Tests:** `tests/cdp.test.ts`

CDP is Chrome/Chromium's remote debugging and automation protocol. The Port of Call implementation covers both the HTTP discovery API (GET-only, raw TCP) and a bidirectional WebSocket tunnel to Chrome's CDP endpoint.

---

## Endpoints

| Method | Path | Summary |
|--------|------|---------|
| `POST` | `/api/cdp/health` | Probe browser: GET /json/version + GET /json/list |
| `POST` | `/api/cdp/query` | Arbitrary HTTP endpoint query (GET any path) |
| `WebSocket` | `/api/cdp/tunnel` | Bidirectional WebSocket tunnel to Chrome CDP |

---

## `POST /api/cdp/health` — Browser probe

Fetches `/json/version` (required) and `/json/list` (best-effort) using **two separate TCP connections**.

**Request:**

```json
{
  "host": "chrome.internal.example.com",
  "port": 9222,
  "timeout": 10000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | Hostname or IP. Returns 400 if missing. No format validation beyond "truthy". |
| `port` | `9222` | No range validation — any integer accepted |
| `timeout` | `10000` | Wall-clock timeout in ms, applied per TCP connection |

**Response — success (HTTP 200):**

```json
{
  "success": true,
  "statusCode": 200,
  "latencyMs": 42,
  "parsed": {
    "version": {
      "Browser": "Chrome/120.0.6099.129",
      "Protocol-Version": "1.3",
      "User-Agent": "Mozilla/5.0 ...",
      "V8-Version": "12.0.267.8",
      "WebKit-Version": "537.36",
      "webSocketDebuggerUrl": "ws://host:9222/devtools/browser/UUID"
    },
    "targets": [
      {
        "id": "E4F8...",
        "type": "page",
        "title": "Google",
        "url": "https://www.google.com/",
        "webSocketDebuggerUrl": "ws://host:9222/devtools/page/E4F8..."
      }
    ],
    "targetCount": 1
  }
}
```

**Response — connection error (HTTP 500):**

```json
{
  "success": false,
  "error": "Connection timeout",
  "latencyMs": 10041
}
```

**Response — Cloudflare-protected host (HTTP 403):**

```json
{
  "success": false,
  "error": "Host is behind Cloudflare: ...",
  "isCloudflare": true
}
```

**Response — missing host (HTTP 400):**

```json
{
  "success": false,
  "error": "Host is required"
}
```

**Key behaviors:**
- `success` is determined by `/json/version` status code (200–399 = `true`).
- `/json/list` failure is **silently ignored** — if the second TCP connection fails, `targets` is `null` and `targetCount` is `0` with no `error` field set and `success` still `true`.
- `latencyMs` is measured from request start to end, spanning both TCP connections.
- Has Cloudflare detection; `/api/cdp/query` does **not**.

---

## `POST /api/cdp/query` — Arbitrary endpoint query

Issues a single HTTP GET to any path on the CDP port.

**Request:**

```json
{
  "host": "chrome.internal.example.com",
  "port": 9222,
  "endpoint": "/json/list",
  "timeout": 10000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | Returns 400 if missing |
| `port` | `9222` | No range validation |
| `endpoint` | `"/json/version"` | Leading `/` prepended if absent |
| `timeout` | `10000` | ms |

**Response — success (HTTP 200):**

```json
{
  "success": true,
  "statusCode": 200,
  "body": "[{\"id\":\"E4F8...\",\"type\":\"page\",...}]",
  "parsed": [{ "id": "E4F8...", "type": "page", ... }],
  "latencyMs": 18
}
```

**Response — error (HTTP 500):**

```json
{
  "success": false,
  "error": "Connection timeout",
  "statusCode": 0,
  "latencyMs": 3041,
  "body": ""
}
```

**Key behaviors:**
- `body` is always the raw HTTP response body string (even on JSON parse failure).
- `parsed` is `null` if `body` is not valid JSON.
- **No Cloudflare detection** — unlike `/health`, this endpoint will attempt connections to Cloudflare-proxied hosts.
- Endpoint normalization: `"json/version"` → `"/json/version"`.

**Common CDP HTTP endpoints:**

| Path | Returns |
|------|---------|
| `/json/version` | Browser version, V8/WebKit versions, `webSocketDebuggerUrl` |
| `/json/list` or `/json` | Array of targets (pages, workers, extensions) |
| `/json/protocol` | Full CDP spec JSON (~5MB — **truncated to 512KB**, see gotchas) |
| `/json/new?{url}` | Opens a new tab, returns target info |
| `/json/close/{targetId}` | Closes the specified target |
| `/json/activate/{targetId}` | Brings target tab to front |

---

## `WebSocket /api/cdp/tunnel` — CDP WebSocket tunnel

Establishes a bidirectional WebSocket tunnel between the client browser and Chrome's CDP endpoint. Requires `Upgrade: websocket` header; returns `426 Upgrade Required` otherwise.

**Query parameters:**

| Parameter | Default | Notes |
|-----------|---------|-------|
| `host` | **required** | Returns 400 plain-text if missing |
| `port` | `9222` | String, parsed as-is into the connect address |
| `targetId` | none | If omitted, connects to `/devtools/browser` (browser-level target); if set, connects to `/devtools/page/{targetId}` |

**Connection sequence:**

1. Client opens WebSocket to `wss://portofcall.ross.gg/api/cdp/tunnel?host=...&port=9222&targetId=...`
2. Worker opens raw TCP to `host:port`
3. Worker sends WebSocket upgrade handshake to Chrome (random 16-byte `Sec-WebSocket-Key`)
4. Worker reads HTTP headers until `\r\n\r\n`, checks for `101 Switching Protocols`
5. On success, worker sends confirmation message to client:
   ```json
   { "type": "connected", "message": "CDP WebSocket tunnel established", "targetId": null }
   ```
6. Bidirectional proxying begins

**Client → Chrome (sending CDP commands):**

Client sends standard CDP JSON-RPC 2.0 text messages. The worker wraps each in a masked WebSocket frame (FIN=1, opcode=0x1) before forwarding.

```json
{ "id": 1, "method": "Runtime.evaluate", "params": { "expression": "document.title" } }
```

**Chrome → Client (receiving results and events):**

The worker parses WebSocket frames from Chrome (unmasked — server frames are not masked per RFC 6455), forwards text/binary payloads to the client.

```json
{ "id": 1, "result": { "result": { "type": "string", "value": "Example Domain" } } }
```

```json
{ "method": "Page.loadEventFired", "params": { "timestamp": 123456.789 } }
```

**Control frame handling:**
- Chrome sends Ping (opcode 0x9) → worker responds with masked Pong (opcode 0xA)
- Chrome sends Close (opcode 0x8) → worker calls `server.close(1000, 'CDP connection closed')`
- Client disconnects → worker closes TCP socket to Chrome

**Error handling:**

If the Chrome connection fails (host unreachable, handshake fails, etc.), worker sends:
```json
{ "type": "error", "error": "WebSocket handshake failed" }
```
then closes the client WebSocket with code 1011.

---

## Wire layer — sendHttpRequest()

Both `/health` and `/query` use the same internal HTTP helper:

- Connects via `cloudflare:sockets connect()`
- Sends `GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n...`
- Reads in a loop until `done` (EOF) or 512KB cap
- Parses headers: status line → `statusCode`, headers lowercased into object
- If `Transfer-Encoding: chunked` → runs `decodeChunked()`
- Connection: close forces server to close after response (no keep-alive)
- Single timeout promise races against all reads

**`decodeChunked()`** parses hex chunk sizes. Stops on `chunkSize === 0` (terminal chunk) or `isNaN(chunkSize)` (malformed data). Chunk extensions (`;...`) before `\r\n` will break parsing since `parseInt` of `"a; ext=val"` returns `10` correctly, but non-hex extensions would return `NaN` and stop early.

---

## Gotchas

**`/json/protocol` truncated to 512KB.** The endpoint returns ~5MB of JSON. The 512KB cap in `sendHttpRequest` cuts off the response mid-stream, resulting in invalid JSON. `parsed` will be `null` for this endpoint; `body` will be the truncated raw text.

**`/health` makes two TCP connections.** The Cloudflare check fires once, but `/json/version` and `/json/list` each open separate TCP connections. If the host is behind a rate-limiter or the connection is flaky between the two calls, `/json/list` may silently fail while `/json/version` succeeds. You won't see an error — just `targets: null, targetCount: 0`.

**No Cloudflare detection in `/query`.** Only `/health` and `/tunnel` call `checkIfCloudflare()`. You can probe Cloudflare-proxied hosts via `/query` and will get a generic connection error instead of the structured `{ isCloudflare: true }` response.

**No port validation.** Neither endpoint validates the port range. Passing `port: 0` or `port: 99999` will attempt a TCP connection to those ports without error at the validation layer.

**Tunnel path is always `/devtools/browser` or `/devtools/page/{targetId}`.** There is no support for `/devtools/worker/{targetId}` or other target types. Connect to workers and service workers by passing their ID as `targetId` — Chrome may still accept `/devtools/page/{id}` for them.

**Tunnel sec-websocket-accept not validated.** The handshake check is only `response.includes('101 Switching Protocols')`. An incorrect or absent `Sec-WebSocket-Accept` header does not cause a failure.

**CDP→Client read loop recreates reader on each iteration.** The tunnel's Chrome-to-client loop calls `cdpSocket!.readable.getReader()` inside `while (true)`, releasing and re-acquiring the lock each iteration. This is functionally correct in Cloudflare Workers (the stream is readable again after `releaseLock()`), but adds overhead and risks frame fragmentation — a WebSocket frame split across two reads will be partially dropped.

**Pong frame length uses 16-bit extended length only.** `buildWebSocketPongFrame()` handles payloads ≤ 65535 bytes (126-byte case), but ping payloads are defined to be ≤125 bytes in RFC 6455, so in practice this is never an issue.

---

## Quick reference — curl

```bash
# Health probe (browser version + target list)
curl -s -X POST https://portofcall.ross.gg/api/cdp/health \
  -H 'Content-Type: application/json' \
  -d '{"host":"chrome.internal","port":9222}' | jq '{success,statusCode,latencyMs,version:.parsed.version.Browser,targetCount:.parsed.targetCount}'

# List all targets (tabs, workers, extensions)
curl -s -X POST https://portofcall.ross.gg/api/cdp/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"chrome.internal","port":9222,"endpoint":"/json/list"}' | jq '.parsed[] | {id,type,title,url}'

# Open a new tab
curl -s -X POST https://portofcall.ross.gg/api/cdp/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"chrome.internal","port":9222,"endpoint":"/json/new?https://example.com"}' | jq '.parsed.webSocketDebuggerUrl'

# Get webSocketDebuggerUrl for tunneling
curl -s -X POST https://portofcall.ross.gg/api/cdp/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"chrome.internal","port":9222,"endpoint":"/json/version"}' | jq '.parsed.webSocketDebuggerUrl'
```

**WebSocket tunnel (wscat):**

```bash
# Connect to browser-level target (no targetId)
wscat -c 'wss://portofcall.ross.gg/api/cdp/tunnel?host=chrome.internal&port=9222'

# Connect to specific page target
wscat -c 'wss://portofcall.ross.gg/api/cdp/tunnel?host=chrome.internal&port=9222&targetId=E4F8...'

# Once connected, send CDP commands as JSON:
# > {"id":1,"method":"Runtime.evaluate","params":{"expression":"document.title"}}
# < {"id":1,"result":{"result":{"type":"string","value":"Example Domain"}}}

# Navigate a page
# > {"id":2,"method":"Page.navigate","params":{"url":"https://example.com"}}

# Take a screenshot (base64 PNG in result.data)
# > {"id":3,"method":"Page.captureScreenshot","params":{"format":"png"}}

# Execute JavaScript
# > {"id":4,"method":"Runtime.evaluate","params":{"expression":"window.location.href","returnByValue":true}}
```

---

## Local test setup

**Launch Chrome with remote debugging:**

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 --headless

# Linux
google-chrome --remote-debugging-port=9222 --headless

# Docker (headless Chrome, allows remote connections)
docker run -d -p 9222:9222 zenika/alpine-chrome:latest \
  --no-sandbox \
  --remote-debugging-address=0.0.0.0 \
  --remote-debugging-port=9222
```

**Verify Chrome is responding:**

```bash
curl http://localhost:9222/json/version
```

---

## What is NOT implemented

- **POST or PUT requests** — `sendHttpRequest` is GET-only; `/json/new` and `/json/close` require GET with query params or path params, which work; but any future CDP HTTP API needing a body is unsupported
- **Authentication** — Chrome's CDP has no built-in auth; if you proxy behind something that adds basic auth, the requests will fail (no `Authorization` header sent)
- **TLS/HTTPS CDP endpoint** — `cloudflare:sockets connect()` used without TLS; only plain HTTP TCP connections
- **WebSocket tunnel binary frame forwarding to Chrome** — only `buildWebSocketTextFrame()` exists; client binary messages would need to be sent as text frames, which Chrome will accept for JSON-RPC but may reject for binary CDP extensions
- **Fragment reassembly** — multi-frame WebSocket messages (FIN=0 fragments) are not reassembled; each read is processed independently
