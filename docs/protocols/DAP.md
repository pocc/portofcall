# Debug Adapter Protocol (DAP) — Port of Call Reference

**Spec:** [Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/specification)
**Default port:** 5678 (debugpy), 4711 (netcoredbg), 38697 (delve/dlv)
**Source:** `src/worker/dap.ts`

DAP is Microsoft's open standard for communication between IDEs/editors and language-specific debug adapters. Unlike CDP (which is HTTP + WebSocket JSON-RPC), DAP uses **Content-Length-framed JSON over raw TCP** — the same base protocol as LSP (Language Server Protocol). The Port of Call implementation provides a health probe (initialize handshake) and a bidirectional WebSocket tunnel.

---

## Endpoints

| Method | Path | Summary |
|--------|------|---------|
| `POST` | `/api/dap/health` | Connect, send `initialize` request, return adapter capabilities |
| `WebSocket` | `/api/dap/tunnel` | Bidirectional WebSocket tunnel to a DAP server |

---

## DAP Wire Format

Every DAP message is framed with an HTTP-style header, followed by a UTF-8 JSON body:

```
Content-Length: 119\r\n
\r\n
{"seq":1,"type":"request","command":"initialize","arguments":{"clientID":"portofcall","adapterID":"probe"}}
```

**Critical:** `Content-Length` is the **byte length** of the JSON body in UTF-8, not the character count. A JSON body containing multi-byte characters (accented file paths, emoji in variable values) will have a byte length larger than its character count. The implementation operates on `Uint8Array` (raw bytes) for correct framing.

There is no `Content-Type` header — unlike HTTP, the header block contains only `Content-Length`. Additional headers may be present (the spec allows them) but none are defined or required.

---

## DAP Message Types

All messages share a base `ProtocolMessage`:

```typescript
interface ProtocolMessage {
  seq: number;   // Sequence number — unique per sender, monotonically increasing
  type: string;  // "request" | "response" | "event"
}
```

### Request (client -> adapter)

```json
{
  "seq": 1,
  "type": "request",
  "command": "initialize",
  "arguments": { ... }
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `seq` | yes | Monotonically increasing per sender |
| `type` | yes | Always `"request"` |
| `command` | yes | The request type: `initialize`, `launch`, `attach`, `threads`, `stackTrace`, etc. |
| `arguments` | no | Command-specific arguments object. Some commands have no arguments. |

### Response (adapter -> client)

```json
{
  "seq": 1,
  "type": "response",
  "request_seq": 1,
  "command": "initialize",
  "success": true,
  "body": { ... }
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `seq` | yes | Adapter's own sequence counter |
| `type` | yes | Always `"response"` |
| `request_seq` | yes | The `seq` of the request this responds to — essential for correlating responses |
| `command` | yes | Echoes the request's `command` |
| `success` | yes | `true` or `false` |
| `body` | no | Command-specific result data (e.g., capabilities for `initialize`) |
| `message` | no | Short error description when `success` is `false`. Can be a predefined enum like `"cancelled"` or a freeform string. |

### Event (adapter -> client)

```json
{
  "seq": 2,
  "type": "event",
  "event": "initialized",
  "body": { ... }
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `seq` | yes | Adapter's own sequence counter |
| `type` | yes | Always `"event"` |
| `event` | yes | Event name: `initialized`, `stopped`, `output`, `terminated`, `thread`, `breakpoint`, etc. |
| `body` | no | Event-specific payload |

---

## Initialize Handshake

The correct initialization sequence per the spec:

```
Client                                          Adapter
  |                                                |
  |  1. initialize request (capabilities, IDs)     |
  |----------------------------------------------->|
  |                                                |
  |  2. initialize response (adapter capabilities) |
  |<-----------------------------------------------|
  |                                                |
  |  3. initialized event                          |
  |<-----------------------------------------------|
  |                                                |
  |  4. setBreakpoints, configurationDone, etc.    |
  |----------------------------------------------->|
  |                                                |
  |  5. launch or attach request                   |
  |----------------------------------------------->|
  |                                                |
  |  6. Debug session active (events, requests)    |
  |<----------------------------------------------->|
```

**Order matters:** The adapter sends the `initialize` **response** first (with its capabilities), then sends the `initialized` **event**. The `initialized` event signals to the client that the adapter is ready to accept configuration requests like `setBreakpoints` and `configurationDone`. Sending `launch`/`attach` before configuration is done will fail on most adapters.

### Initialize Request Arguments

The health probe sends:

```json
{
  "clientID": "portofcall",
  "clientName": "Port of Call",
  "adapterID": "probe",
  "locale": "en-US",
  "linesStartAt1": true,
  "columnsStartAt1": true,
  "pathFormat": "path",
  "supportsVariableType": true,
  "supportsVariablePaging": false,
  "supportsRunInTerminalRequest": false,
  "supportsMemoryReferences": false
}
```

| Argument | Spec requirement | Notes |
|----------|-----------------|-------|
| `clientID` | optional | Short ID for the client tool |
| `clientName` | optional | Human-readable client name |
| `adapterID` | **required** | The debug adapter type being connected to |
| `locale` | optional | Locale for adapter messages |
| `linesStartAt1` | optional (default: true) | Whether the client uses 1-based line numbers |
| `columnsStartAt1` | optional (default: true) | Whether the client uses 1-based column numbers |
| `pathFormat` | optional (default: "path") | `"path"` or `"uri"` |
| `supportsVariableType` | optional | Client can show variable types |
| `supportsVariablePaging` | optional | Client supports paging variables |
| `supportsRunInTerminalRequest` | optional | Client supports `runInTerminal` reverse request |
| `supportsMemoryReferences` | optional | Client supports memory references |

### Initialize Response — Adapter Capabilities

The response `body` contains the adapter's `Capabilities` object. Common fields:

| Capability | Type | Meaning |
|-----------|------|---------|
| `supportsConfigurationDoneRequest` | boolean | Adapter expects `configurationDone` after breakpoints are set |
| `supportsFunctionBreakpoints` | boolean | Adapter supports function breakpoints |
| `supportsConditionalBreakpoints` | boolean | Adapter supports conditional breakpoints |
| `supportsEvaluateForHovers` | boolean | Adapter supports `evaluate` for hover tooltips |
| `supportsSetVariable` | boolean | Adapter supports modifying variables |
| `supportsStepBack` | boolean | Adapter supports reverse/step-back debugging |
| `supportsRestartRequest` | boolean | Adapter supports restart without reconnecting |
| `supportsModulesRequest` | boolean | Adapter supports module listing |
| `supportsCompletionsRequest` | boolean | Adapter supports code completions in the debug console |
| `supportsExceptionInfoRequest` | boolean | Adapter can provide detailed exception info |
| `supportsTerminateRequest` | boolean | Adapter supports terminating the debuggee |
| `supportsDelayedStackTraceLoading` | boolean | Adapter supports lazy loading of stack frames |
| `exceptionBreakpointFilters` | array | Available exception breakpoint types |

---

## `POST /api/dap/health` — Adapter probe

Connects to a DAP server, performs the `initialize` handshake, and returns the adapter's capabilities.

**Request:**

```json
{
  "host": "debugpy.internal.example.com",
  "port": 5678,
  "timeout": 10000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | Hostname or IP. Returns 400 if missing. |
| `port` | `5678` | No range validation |
| `timeout` | `10000` | Wall-clock timeout in ms for connection + read |

**Response -- success (HTTP 200):**

```json
{
  "success": true,
  "latencyMs": 85,
  "parsed": {
    "capabilities": {
      "supportsConfigurationDoneRequest": true,
      "supportsConditionalBreakpoints": true,
      "supportsSetVariable": true,
      "supportsEvaluateForHovers": true,
      "supportsModulesRequest": true,
      "exceptionBreakpointFilters": [
        { "filter": "raised", "label": "Raised Exceptions" },
        { "filter": "uncaught", "label": "Uncaught Exceptions" }
      ]
    },
    "events": ["initialized"],
    "messageCount": 2,
    "allMessages": [
      { "seq": 1, "type": "response", "request_seq": 1, "command": "initialize", "success": true, "body": { "..." } },
      { "seq": 2, "type": "event", "event": "initialized" }
    ]
  }
}
```

**Response -- no response from adapter (HTTP 200, success: false):**

```json
{
  "success": false,
  "latencyMs": 10041,
  "parsed": {
    "capabilities": null,
    "events": [],
    "messageCount": 0,
    "allMessages": []
  },
  "error": "No initialize response received from adapter"
}
```

**Response -- connection error (HTTP 500):**

```json
{
  "success": false,
  "error": "Connection timeout",
  "latencyMs": 10041
}
```

**Response -- Cloudflare-protected host (HTTP 403):**

```json
{
  "success": false,
  "error": "Cannot connect to host (IP): This domain is protected by Cloudflare...",
  "isCloudflare": true
}
```

**Response -- missing host (HTTP 400):**

```json
{
  "success": false,
  "error": "Host is required"
}
```

**Key behaviors:**
- `success` is `true` only if an `initialize` response is received from the adapter.
- The probe reads up to 3 messages before stopping (typically: `initialize` response + `initialized` event).
- The read loop uses a 2-second sub-timeout per chunk read, racing against the overall deadline.
- `allMessages` contains all raw DAP messages received, including the `initialize` response and any events.
- `capabilities` is extracted from the `initialize` response's `body` field.
- The `events` array contains just the event names (e.g., `["initialized"]`).
- Cloudflare detection runs before connection attempt.

---

## `WebSocket /api/dap/tunnel` — DAP WebSocket tunnel

Establishes a bidirectional tunnel between the browser and a DAP server. The worker handles Content-Length framing translation: the browser sends/receives raw JSON objects; the worker adds/strips the `Content-Length` header framing on the TCP side. Requires `Upgrade: websocket` header; returns `426 Upgrade Required` otherwise.

**Query parameters:**

| Parameter | Default | Notes |
|-----------|---------|-------|
| `host` | **required** | Returns 400 plain-text if missing |
| `port` | `5678` | String, used as-is in the TCP address |

**Connection sequence:**

1. Client opens WebSocket to `wss://portofcall.ross.gg/api/dap/tunnel?host=...&port=5678`
2. Worker opens TCP connection to `host:port`
3. Worker sends confirmation to client:
   ```json
   { "type": "connected", "message": "DAP tunnel connected to host:5678" }
   ```
4. Bidirectional proxying begins

**Client -> DAP adapter (sending requests):**

Client sends DAP messages as JSON text (no Content-Length framing). The worker parses the JSON, re-encodes with proper `Content-Length` framing, and forwards over TCP.

```json
{"seq":1,"type":"request","command":"initialize","arguments":{"clientID":"portofcall","adapterID":"generic","linesStartAt1":true,"columnsStartAt1":true}}
```

**DAP adapter -> Client (receiving responses and events):**

The worker reads raw TCP bytes, parses Content-Length framing, extracts JSON bodies, and forwards them to the client as unframed JSON text.

```json
{"seq":1,"type":"response","request_seq":1,"command":"initialize","success":true,"body":{"supportsConfigurationDoneRequest":true}}
```

```json
{"seq":2,"type":"event","event":"initialized"}
```

**Error handling:**

If the TCP connection to the adapter fails:
```json
{ "type": "error", "error": "DAP tunnel failed" }
```
Then the WebSocket is closed with code 1011.

If a message fails to send to the adapter:
```json
{ "type": "error", "error": "Failed to send message: ..." }
```

If the TCP read stream errors, the WebSocket is closed with code 1011 and reason `"DAP read error"`.

**Tunnel messages (`type: "connected"` and `type: "error"`)** are Port of Call control messages, not DAP messages. They do not have `seq` numbers or follow DAP structure.

---

## Common DAP Commands

| Command | Direction | Purpose |
|---------|-----------|---------|
| `initialize` | client -> adapter | Negotiate capabilities |
| `configurationDone` | client -> adapter | Signal that all configuration (breakpoints, etc.) is complete |
| `launch` | client -> adapter | Start a new debug session |
| `attach` | client -> adapter | Attach to an already-running process |
| `disconnect` | client -> adapter | End the debug session |
| `threads` | client -> adapter | List all threads |
| `stackTrace` | client -> adapter | Get stack frames for a thread |
| `scopes` | client -> adapter | Get scopes for a stack frame |
| `variables` | client -> adapter | Get variables for a scope |
| `evaluate` | client -> adapter | Evaluate an expression (REPL, hover, watch) |
| `setBreakpoints` | client -> adapter | Set breakpoints in a source file |
| `setExceptionBreakpoints` | client -> adapter | Set exception breakpoint filters |
| `continue` | client -> adapter | Resume execution |
| `next` | client -> adapter | Step over |
| `stepIn` | client -> adapter | Step into |
| `stepOut` | client -> adapter | Step out |
| `pause` | client -> adapter | Pause execution |
| `terminate` | client -> adapter | Terminate the debuggee |

## Common DAP Events

| Event | Direction | Purpose |
|-------|-----------|---------|
| `initialized` | adapter -> client | Adapter ready for configuration |
| `stopped` | adapter -> client | Execution stopped (breakpoint, step, pause, exception) |
| `continued` | adapter -> client | Execution resumed |
| `exited` | adapter -> client | Debuggee process exited |
| `terminated` | adapter -> client | Debug session ended |
| `thread` | adapter -> client | Thread started or exited |
| `output` | adapter -> client | Console/stdout/stderr output from debuggee |
| `breakpoint` | adapter -> client | Breakpoint state changed |
| `module` | adapter -> client | Module loaded/unloaded |
| `process` | adapter -> client | Process information |

---

## Common Debug Adapters

| Adapter | Language | Default Port | Launch Command |
|---------|----------|-------------|----------------|
| debugpy | Python | 5678 | `python -m debugpy --listen 0.0.0.0:5678 --wait-for-client script.py` |
| netcoredbg | .NET Core | 4711 | `netcoredbg --server --interpreter=vscode -- dotnet run` |
| delve (dlv) | Go | 38697 | `dlv dap --listen=:38697` |
| lldb-vscode | C/C++ | 4711 | `lldb-vscode --port 4711` |
| debugserver | Ruby | 1234 | `rdbg --open --port 1234 script.rb` |
| xdebug | PHP | 9003 | Configure in php.ini; PHP connects to client (reverse) |
| codelldb | C/C++/Rust | 13000 | Via VS Code extension or standalone |

Note: Xdebug is unusual — it uses a **reverse** connection model where the PHP runtime connects to the IDE, not the other way around. Port of Call's probe model (client initiates) will not work with Xdebug.

---

## Gotchas

**No standard default port.** Unlike HTTP (80), SMTP (25), or SSH (22), DAP has no IANA-assigned port. Each debug adapter picks its own convention. The implementation defaults to 5678 (debugpy's convention) which is the most common for Python debugging.

**Initialize vs. initialized.** The `initialize` **response** contains adapter capabilities. The `initialized` **event** signals readiness for configuration. These are different messages with confusingly similar names. The response comes first; the event comes after.

**Content-Length is byte length, not character length.** The spec is explicit: `Content-Length` counts UTF-8 bytes. A body like `{"path":"/tmp/cafe\u0301.py"}` has a different byte length than character count due to the accented character. The implementation correctly operates on `Uint8Array` for parsing.

**Sequence numbers are per-sender.** The client and adapter each maintain their own `seq` counter starting at 1. Responses include both the adapter's `seq` and the `request_seq` matching the original request. This is how out-of-order or concurrent responses are correlated.

**No port validation.** The port parameter accepts any value without range checking. Invalid ports will produce a TCP connection error rather than a validation error.

**Tunnel control messages are not DAP.** The `{ "type": "connected" }` and `{ "type": "error" }` messages sent over the WebSocket tunnel are Port of Call's own control messages. They do not conform to DAP's `ProtocolMessage` structure (no `seq` field). Client code must distinguish these from real DAP messages.

**No TLS support.** DAP over TCP is unencrypted. The `cloudflare:sockets connect()` call is plain TCP. If the debug adapter requires TLS, the connection will fail. Most debug adapters do not use TLS — they rely on network-level security (VPN, SSH tunnel, etc.).

**No authentication.** DAP has no built-in authentication mechanism. Anyone who can reach the TCP port can control the debugger. This is by design — debug adapters are meant to run in trusted environments.

---

## Typical Debug Session Flow (via tunnel)

```
1. Connect WebSocket tunnel
2. Send: {"seq":1,"type":"request","command":"initialize","arguments":{...}}
3. Recv: {"seq":1,"type":"response","request_seq":1,"command":"initialize","success":true,"body":{...}}
4. Recv: {"seq":2,"type":"event","event":"initialized"}
5. Send: {"seq":2,"type":"request","command":"setBreakpoints","arguments":{"source":{"path":"/app/main.py"},"breakpoints":[{"line":10}]}}
6. Recv: {"seq":3,"type":"response","request_seq":2,"command":"setBreakpoints","success":true,"body":{...}}
7. Send: {"seq":3,"type":"request","command":"configurationDone"}
8. Recv: {"seq":4,"type":"response","request_seq":3,"command":"configurationDone","success":true}
9. Send: {"seq":4,"type":"request","command":"attach","arguments":{"justMyCode":true}}
   — or —
   Send: {"seq":4,"type":"request","command":"launch","arguments":{"program":"/app/main.py"}}
10. Recv: {"seq":5,"type":"event","event":"stopped","body":{"reason":"breakpoint","threadId":1}}
11. Send: {"seq":5,"type":"request","command":"threads"}
12. Send: {"seq":6,"type":"request","command":"stackTrace","arguments":{"threadId":1}}
13. Send: {"seq":7,"type":"request","command":"scopes","arguments":{"frameId":0}}
14. Send: {"seq":8,"type":"request","command":"variables","arguments":{"variablesReference":1}}
15. Send: {"seq":9,"type":"request","command":"continue","arguments":{"threadId":1}}
16. Send: {"seq":10,"type":"request","command":"disconnect","arguments":{"restart":false}}
```

---

## Quick reference -- curl

```bash
# Health probe (initialize handshake + capabilities)
curl -s -X POST https://portofcall.ross.gg/api/dap/health \
  -H 'Content-Type: application/json' \
  -d '{"host":"debugpy.internal","port":5678}' | jq '{success,latencyMs,capabilities:.parsed.capabilities,events:.parsed.events}'

# Health probe with custom timeout
curl -s -X POST https://portofcall.ross.gg/api/dap/health \
  -H 'Content-Type: application/json' \
  -d '{"host":"dlv-server.internal","port":38697,"timeout":5000}' | jq .

# Check netcoredbg
curl -s -X POST https://portofcall.ross.gg/api/dap/health \
  -H 'Content-Type: application/json' \
  -d '{"host":"dotnet-debug.internal","port":4711}' | jq '.parsed.capabilities | keys'
```

**WebSocket tunnel (wscat):**

```bash
# Connect to debugpy
wscat -c 'wss://portofcall.ross.gg/api/dap/tunnel?host=debugpy.internal&port=5678'

# Connect to delve
wscat -c 'wss://portofcall.ross.gg/api/dap/tunnel?host=dlv-server.internal&port=38697'

# Once connected, send DAP requests as JSON:
# > {"seq":1,"type":"request","command":"initialize","arguments":{"clientID":"wscat","adapterID":"debugpy","linesStartAt1":true,"columnsStartAt1":true}}
# < {"seq":1,"type":"response","request_seq":1,"command":"initialize","success":true,"body":{"supportsConfigurationDoneRequest":true,...}}
# < {"seq":2,"type":"event","event":"initialized"}
# > {"seq":2,"type":"request","command":"threads"}
# < {"seq":3,"type":"response","request_seq":2,"command":"threads","success":true,"body":{"threads":[{"id":1,"name":"MainThread"}]}}
# > {"seq":3,"type":"request","command":"disconnect","arguments":{"restart":false}}
```

---

## Local test setup

**Python (debugpy):**

```bash
pip install debugpy
python -m debugpy --listen 0.0.0.0:5678 --wait-for-client your_script.py
```

**Go (delve):**

```bash
go install github.com/go-delve/delve/cmd/dlv@latest
dlv dap --listen=:38697
```

**.NET (netcoredbg):**

```bash
# Install netcoredbg, then:
netcoredbg --server --interpreter=vscode -- dotnet run --project /app
```

**Docker (debugpy):**

```bash
docker run -it -p 5678:5678 python:3.12-slim bash -c \
  "pip install debugpy && python -m debugpy --listen 0.0.0.0:5678 --wait-for-client -c 'import time; time.sleep(3600)'"
```

---

## What is NOT implemented

- **Launch/attach orchestration** -- the probe only performs the `initialize` handshake; it does not send `launch` or `attach` requests
- **Breakpoint management** -- no built-in UI for setting breakpoints (use the tunnel with manual JSON)
- **Variable inspection UI** -- capabilities are reported but no structured variable viewer
- **Reverse requests** -- DAP allows the adapter to send requests to the client (e.g., `runInTerminal`); the tunnel passes these through but the client UI does not handle them
- **Cancel request** -- DAP supports `cancel` requests to abort long-running operations; not explicitly supported in the UI
- **Progress reporting** -- DAP adapters can send `progressStart`/`progressUpdate`/`progressEnd` events; these pass through the tunnel but are not rendered specially
- **TLS connections** -- plain TCP only
- **Multiple simultaneous debug sessions** -- each tunnel is a single session; no multiplexing
