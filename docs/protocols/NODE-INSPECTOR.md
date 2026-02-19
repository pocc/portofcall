# Node Inspector Protocol — Power User Reference

## Protocol Summary

**Name:** Node.js Inspector Protocol (V8 Inspector Protocol)
**Default Port:** 9229
**Transport:** HTTP/1.1 (discovery) + WebSocket (debugging)
**Protocol Spec:** [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) / [V8 Inspector](https://chromedevtools.github.io/devtools-protocol/v8/)
**Message Format:** JSON-RPC 2.0
**Use Case:** Remote debugging, profiling, and inspection of Node.js applications

## What Is It?

The Node.js Inspector Protocol is an implementation of the Chrome DevTools Protocol (CDP) for Node.js. It enables remote debugging, profiling, heap analysis, and runtime inspection of JavaScript applications running on Node.js.

When you start Node.js with `--inspect`, it opens a WebSocket server that speaks the V8 Inspector Protocol. Debuggers (Chrome DevTools, VS Code, etc.) connect via WebSocket and send JSON-RPC 2.0 commands to control execution, evaluate code, set breakpoints, capture CPU profiles, take heap snapshots, and more.

### Key Capabilities

- **Runtime Evaluation:** Execute arbitrary JavaScript in the Node.js process
- **Debugging:** Set breakpoints, step through code, pause/resume execution
- **Profiling:** CPU profiling, heap snapshots, allocation tracking
- **Code Coverage:** Track which lines of code are executed
- **Heap Analysis:** Inspect memory usage, find memory leaks
- **Console Access:** Capture console.log output and exceptions
- **Network Inspection:** Monitor HTTP requests (limited compared to browser CDP)

### Security Implications

**CRITICAL:** Node Inspector grants **FULL CONTROL** over the Node.js process:
- Execute arbitrary code as the Node.js user
- Read/write all memory (environment variables, secrets, credentials)
- Access any file readable by the process
- Modify runtime behavior (inject code, change variables)
- Potentially escalate privileges if process runs as root

**Default Bind:** 127.0.0.1:9229 (localhost only)
**Remote Bind:** `--inspect=0.0.0.0:9229` (DANGEROUS — exposes to network without authentication)

## Protocol Flow

### 1. Discovery Phase (HTTP)

Node.js Inspector exposes HTTP JSON endpoints for discovery:

```
GET /json              → List of active debug sessions
GET /json/list         → Alias for /json
GET /json/version      → Node.js and V8 version info
GET /json/protocol     → Full protocol schema (CDP JSON)
```

**Example /json response:**
```json
[
  {
    "description": "node.js instance",
    "devtoolsFrontendUrl": "devtools://devtools/bundled/js_app.html?...",
    "devtoolsFrontendUrlCompat": "devtools://devtools/bundled/inspector.html?...",
    "faviconUrl": "https://nodejs.org/static/images/favicons/favicon.ico",
    "id": "0f2c936f-b1cd-4ac9-aab3-f63b0f33d55e",
    "title": "server.js",
    "type": "node",
    "url": "file:///home/user/app/server.js",
    "webSocketDebuggerUrl": "ws://127.0.0.1:9229/0f2c936f-b1cd-4ac9-aab3-f63b0f33d55e"
  }
]
```

**Example /json/version response:**
```json
{
  "Browser": "node.js/v20.11.0",
  "Protocol-Version": "1.3",
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "V8-Version": "11.3.244.8-node.19",
  "WebKit-Version": "537.36 (@0)"
}
```

### 2. WebSocket Connection

Extract the `webSocketDebuggerUrl` from `/json` and connect:

```
ws://127.0.0.1:9229/0f2c936f-b1cd-4ac9-aab3-f63b0f33d55e
```

**WebSocket Upgrade Request:**
```http
GET /0f2c936f-b1cd-4ac9-aab3-f63b0f33d55e HTTP/1.1
Host: 127.0.0.1:9229
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
```

**WebSocket Upgrade Response:**
```http
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

Per RFC 6455, the `Sec-WebSocket-Accept` value is computed as:
```
base64(SHA-1(Sec-WebSocket-Key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
```

### 3. JSON-RPC 2.0 Commands

All commands follow JSON-RPC 2.0 format:

**Request:**
```json
{
  "id": 1,
  "method": "Runtime.evaluate",
  "params": {
    "expression": "1 + 1"
  }
}
```

**Response:**
```json
{
  "id": 1,
  "result": {
    "result": {
      "type": "number",
      "value": 2,
      "description": "2"
    }
  }
}
```

**Error Response:**
```json
{
  "id": 1,
  "error": {
    "code": -32600,
    "message": "Invalid request"
  }
}
```

### 4. Asynchronous Events

The Inspector sends events without an `id` field:

```json
{
  "method": "Runtime.executionContextCreated",
  "params": {
    "context": {
      "id": 1,
      "origin": "",
      "name": "Node.js Main Context",
      "uniqueId": "-123456789"
    }
  }
}
```

```json
{
  "method": "Runtime.consoleAPICalled",
  "params": {
    "type": "log",
    "args": [
      {
        "type": "string",
        "value": "Hello from Node.js"
      }
    ],
    "executionContextId": 1,
    "timestamp": 1707890123456.789
  }
}
```

## CDP Domains Supported by Node.js

Node.js implements a **subset** of Chrome DevTools Protocol. It supports debugging/profiling domains but excludes browser-specific domains (Page, DOM, CSS, etc.).

### Runtime Domain

Controls JavaScript execution and evaluation.

**Common Methods:**
- `Runtime.enable` — Enable Runtime events
- `Runtime.disable` — Disable Runtime events
- `Runtime.evaluate` — Evaluate JavaScript expression
- `Runtime.callFunctionOn` — Call function with given object
- `Runtime.getProperties` — Get properties of an object
- `Runtime.getHeapUsage` — Get heap usage stats
- `Runtime.runIfWaitingForDebugger` — Resume if paused at startup (--inspect-brk)

**Example: Evaluate Expression**
```json
{
  "id": 1,
  "method": "Runtime.evaluate",
  "params": {
    "expression": "process.version"
  }
}
```

**Response:**
```json
{
  "id": 1,
  "result": {
    "result": {
      "type": "string",
      "value": "v20.11.0"
    }
  }
}
```

**Example: Get Heap Usage**
```json
{
  "id": 2,
  "method": "Runtime.getHeapUsage",
  "params": {}
}
```

**Response:**
```json
{
  "id": 2,
  "result": {
    "usedSize": 12345678,
    "totalSize": 23456789
  }
}
```

### Debugger Domain

Controls breakpoints, stepping, and execution flow.

**Common Methods:**
- `Debugger.enable` — Enable debugger
- `Debugger.disable` — Disable debugger
- `Debugger.pause` — Pause execution
- `Debugger.resume` — Resume execution
- `Debugger.stepOver` — Step to next line
- `Debugger.stepInto` — Step into function call
- `Debugger.stepOut` — Step out of current function
- `Debugger.setBreakpointByUrl` — Set breakpoint at file:line
- `Debugger.setBreakpoint` — Set breakpoint at location
- `Debugger.removeBreakpoint` — Remove breakpoint
- `Debugger.setPauseOnExceptions` — Pause on exceptions (all/uncaught/none)
- `Debugger.evaluateOnCallFrame` — Evaluate in paused context

**Example: Set Breakpoint**
```json
{
  "id": 3,
  "method": "Debugger.setBreakpointByUrl",
  "params": {
    "lineNumber": 42,
    "url": "file:///home/user/app/server.js"
  }
}
```

**Response:**
```json
{
  "id": 3,
  "result": {
    "breakpointId": "1:42:0:file:///home/user/app/server.js",
    "locations": [
      {
        "scriptId": "23",
        "lineNumber": 42,
        "columnNumber": 0
      }
    ]
  }
}
```

**Event: Paused**
```json
{
  "method": "Debugger.paused",
  "params": {
    "reason": "other",
    "callFrames": [
      {
        "callFrameId": "0",
        "functionName": "myFunction",
        "location": {
          "scriptId": "23",
          "lineNumber": 42,
          "columnNumber": 5
        },
        "url": "file:///home/user/app/server.js",
        "scopeChain": [
          {
            "type": "local",
            "object": {
              "type": "object",
              "objectId": "{\"injectedScriptId\":1,\"id\":1}"
            }
          }
        ]
      }
    ]
  }
}
```

### Profiler Domain

CPU profiling and coverage.

**Common Methods:**
- `Profiler.enable` — Enable profiler
- `Profiler.disable` — Disable profiler
- `Profiler.start` — Start CPU profiling
- `Profiler.stop` — Stop CPU profiling, return profile data
- `Profiler.startPreciseCoverage` — Start code coverage
- `Profiler.takePreciseCoverage` — Capture coverage data
- `Profiler.stopPreciseCoverage` — Stop code coverage
- `Profiler.setBySampleProfiling` — Switch to sampling mode

**Example: CPU Profile**
```json
// 1. Enable profiler
{ "id": 1, "method": "Profiler.enable", "params": {} }

// 2. Start profiling
{ "id": 2, "method": "Profiler.start", "params": {} }

// ... let app run for a while ...

// 3. Stop profiling
{ "id": 3, "method": "Profiler.stop", "params": {} }
```

**Stop Response:**
```json
{
  "id": 3,
  "result": {
    "profile": {
      "nodes": [
        {
          "id": 1,
          "callFrame": {
            "functionName": "main",
            "scriptId": "23",
            "url": "file:///home/user/app/server.js",
            "lineNumber": 10,
            "columnNumber": 0
          },
          "hitCount": 150,
          "children": [2]
        }
      ],
      "startTime": 1707890000000000,
      "endTime": 1707890010000000,
      "samples": [1, 1, 2, 2, 1],
      "timeDeltas": [100, 100, 100, 100, 100]
    }
  }
}
```

### HeapProfiler Domain

Memory profiling and heap snapshots.

**Common Methods:**
- `HeapProfiler.enable` — Enable heap profiler
- `HeapProfiler.disable` — Disable heap profiler
- `HeapProfiler.takeHeapSnapshot` — Capture heap snapshot (streamed as events)
- `HeapProfiler.startSampling` — Start sampling heap profiler
- `HeapProfiler.stopSampling` — Stop sampling, return heap profile
- `HeapProfiler.collectGarbage` — Force garbage collection (--expose-gc required)

**Example: Heap Snapshot**
```json
{ "id": 1, "method": "HeapProfiler.takeHeapSnapshot", "params": {} }
```

**Response Events (chunked):**
```json
{
  "method": "HeapProfiler.addHeapSnapshotChunk",
  "params": {
    "chunk": "{\"snapshot\":{\"meta\":{\"node_fields\":[\"type\",\"name\"..."
  }
}
```

**Final Response:**
```json
{ "id": 1, "result": {} }
```

### Schema Domain

Introspect protocol capabilities.

**Common Methods:**
- `Schema.getDomains` — List all supported domains

**Example:**
```json
{ "id": 1, "method": "Schema.getDomains", "params": {} }
```

**Response:**
```json
{
  "id": 1,
  "result": {
    "domains": [
      { "name": "Runtime", "version": "1.3" },
      { "name": "Debugger", "version": "1.3" },
      { "name": "Profiler", "version": "1.3" },
      { "name": "HeapProfiler", "version": "1.3" },
      { "name": "Schema", "version": "1.3" }
    ]
  }
}
```

### Node.js-Specific Domains

Node.js adds custom domains not in standard CDP:

**NodeRuntime Domain:**
- `NodeRuntime.notifyWhenWaitingForDisconnect` — Notify when debugger can disconnect

**NodeTracing Domain:**
- `NodeTracing.start` — Start trace event collection
- `NodeTracing.stop` — Stop trace event collection
- `NodeTracing.getCategories` — Get available trace categories

**NodeWorker Domain:**
- `NodeWorker.sendMessageToWorker` — Send message to worker thread
- `NodeWorker.enable` — Enable worker debugging
- `NodeWorker.disable` — Disable worker debugging
- `NodeWorker.detach` — Detach from worker

## Port of Call Implementation

### Worker Endpoints

#### 1. Health Check — `POST /api/node-inspector/health`

Queries the `/json` and `/json/version` HTTP endpoints.

**Request:**
```json
{
  "host": "localhost",
  "port": 9229,
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "statusCode": 200,
  "latencyMs": 12,
  "parsed": {
    "sessions": [
      {
        "id": "0f2c936f-b1cd-4ac9-aab3-f63b0f33d55e",
        "title": "server.js",
        "description": "node.js instance",
        "type": "node",
        "webSocketDebuggerUrl": "ws://127.0.0.1:9229/0f2c936f-b1cd-4ac9-aab3-f63b0f33d55e"
      }
    ],
    "sessionCount": 1,
    "version": {
      "Browser": "node.js/v20.11.0",
      "Protocol-Version": "1.3",
      "V8-Version": "11.3.244.8-node.19"
    }
  }
}
```

**Field Defaults:**
- `port`: 9229
- `timeout`: 10000ms

**Cloudflare Detection:**
- Returns 403 with `isCloudflare: true` if host resolves to Cloudflare IP range

#### 2. Query Endpoint — `POST /api/node-inspector/query`

Query arbitrary HTTP endpoint on the Inspector server (for advanced users).

**Request:**
```json
{
  "host": "localhost",
  "port": 9229,
  "endpoint": "/json/protocol",
  "timeout": 10000
}
```

**Response:**
```json
{
  "success": true,
  "statusCode": 200,
  "body": "{\"version\":{\"major\":\"1\",\"minor\":\"3\"},...}",
  "parsed": { "version": { "major": "1", "minor": "3" } },
  "latencyMs": 8
}
```

**Field Defaults:**
- `port`: 9229
- `endpoint`: "/json"
- `timeout`: 10000ms

**Endpoint Normalization:**
- `endpoint` is auto-prefixed with `/` if missing

#### 3. WebSocket Tunnel — `WebSocket /api/node-inspector/tunnel`

Bidirectional WebSocket proxy between browser and Node.js Inspector.

**Query Parameters:**
- `host` — Target host (required)
- `port` — Target port (default: 9229)
- `path` — Full WebSocket path (e.g., `/0f2c936f-b1cd-4ac9-aab3-f63b0f33d55e`)
- `sessionId` — Alternative to `path` (auto-prefixed with `/`)

**Connection Flow:**
1. Worker opens TCP connection to Node.js Inspector
2. Worker performs WebSocket handshake
3. Worker validates `Sec-WebSocket-Accept` header (RFC 6455 §4.2.2)
4. Worker sends `{"type":"connected"}` message to client
5. Bidirectional proxying begins:
   - Client → Worker → Inspector (JSON-RPC commands)
   - Inspector → Worker → Client (JSON-RPC responses + events)

**Control Messages from Worker:**
```json
{
  "type": "connected",
  "message": "Node Inspector WebSocket tunnel established",
  "path": "/0f2c936f-b1cd-4ac9-aab3-f63b0f33d55e"
}
```

```json
{
  "type": "error",
  "error": "WebSocket handshake failed"
}
```

**WebSocket Frame Handling:**
- Text frames (opcode 0x1): Forwarded as-is
- Binary frames (opcode 0x2): Forwarded as-is
- Close frames (opcode 0x8): Tunnel closes with status 1000
- Ping frames (opcode 0x9): Automatically responded with Pong (RFC 6455 §5.5.2)
- Pong frames (opcode 0xA): Silently ignored

**RFC 6455 Compliance:**
- All client→server frames are masked (per §5.1)
- All server→client frames are unmasked (per §5.1)
- Control frames (ping/pong/close) limited to 125 bytes payload (per §5.5)
- 64-bit frame lengths supported (up to 4GB in practice, 2^63 per spec)
- Incomplete frames are buffered across TCP reads

**Cloudflare Detection:**
- Returns 403 if host resolves to Cloudflare IP range

## Wire Protocol Details

### HTTP Request Format

```
GET /json HTTP/1.1\r\n
Host: localhost:9229\r\n
Accept: application/json\r\n
Connection: close\r\n
User-Agent: PortOfCall/1.0\r\n
\r\n
```

### HTTP Response Parsing

**Chunked Transfer Encoding:**
- Detected via `Transfer-Encoding: chunked` header
- Decoded per RFC 7230 §4.1:
  ```
  <chunk-size-hex>\r\n
  <chunk-data>\r\n
  <chunk-size-hex>\r\n
  <chunk-data>\r\n
  0\r\n
  \r\n
  ```

**Max Response Size:** 512 KB (512000 bytes)

### WebSocket Handshake

**Request:**
```http
GET /<session-uuid> HTTP/1.1
Host: localhost:9229
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
```

**Response:**
```http
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

**Accept Validation:**
```javascript
const magic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const expected = base64(sha1(wsKey + magic));
if (responseAccept !== expected) {
  throw new Error("WebSocket handshake failed: invalid Sec-WebSocket-Accept");
}
```

### WebSocket Frame Format (RFC 6455 §5.2)

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-------+-+-------------+-------------------------------+
|F|R|R|R| opcode|M| Payload len |    Extended payload length    |
|I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
|N|V|V|V|       |S|             |   (if payload len==126/127)   |
| |1|2|3|       |K|             |                               |
+-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - +
|     Extended payload length continued, if payload len == 127  |
+ - - - - - - - - - - - - - - - +-------------------------------+
|                               |Masking-key, if MASK set to 1  |
+-------------------------------+-------------------------------+
| Masking-key (continued)       |          Payload Data         |
+-------------------------------- - - - - - - - - - - - - - - - +
:                     Payload Data continued ...                :
+ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +
|                     Payload Data continued ...                |
+---------------------------------------------------------------+
```

**Opcode Values:**
- 0x0: Continuation frame
- 0x1: Text frame (UTF-8)
- 0x2: Binary frame
- 0x8: Close frame
- 0x9: Ping frame
- 0xA: Pong frame

**Payload Length Encoding:**
- 0-125: Value stored directly in 7-bit field
- 126: Next 2 bytes = 16-bit length
- 127: Next 8 bytes = 64-bit length (big-endian)

**Masking:**
- Client→Server: MUST mask (M=1, 4-byte mask key follows header)
- Server→Client: MUST NOT mask (M=0)
- Mask algorithm: `decoded[i] = encoded[i] XOR maskKey[i % 4]`

## Testing and Debugging

### Starting Node.js Inspector

**Standard Mode (non-blocking):**
```bash
node --inspect server.js
# Debugger listening on ws://127.0.0.1:9229/abc-def-123-456
```

**Break on Start:**
```bash
node --inspect-brk server.js
# Pauses on first line, waits for debugger
```

**Custom Port:**
```bash
node --inspect=9230 server.js
```

**Remote Access (DANGEROUS):**
```bash
node --inspect=0.0.0.0:9229 server.js
# WARNING: Exposes debugger to network without authentication!
```

**Specific Host:**
```bash
node --inspect=192.168.1.10:9229 server.js
```

### Manual Testing with curl

**List Sessions:**
```bash
curl http://localhost:9229/json
```

**Get Version:**
```bash
curl http://localhost:9229/json/version
```

**Get Protocol Schema:**
```bash
curl http://localhost:9229/json/protocol > protocol.json
```

### Manual WebSocket Testing

**Using websocat:**
```bash
# Install: cargo install websocat

# Get WebSocket URL
WS_URL=$(curl -s http://localhost:9229/json | jq -r '.[0].webSocketDebuggerUrl')

# Connect and send command
echo '{"id":1,"method":"Runtime.evaluate","params":{"expression":"1+1"}}' | websocat "$WS_URL"
```

**Using Node.js ws library:**
```javascript
const WebSocket = require('ws');

async function connect() {
  const sessions = await fetch('http://localhost:9229/json').then(r => r.json());
  const wsUrl = sessions[0].webSocketDebuggerUrl;

  const ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: 'process.version' }
    }));
  });

  ws.on('message', (data) => {
    console.log('Received:', data.toString());
  });
}

connect();
```

## Common Use Cases

### 1. Production Debugging

**Connect to running app:**
```bash
# App running with: node --inspect server.js
curl http://localhost:9229/json | jq '.[0].webSocketDebuggerUrl'
# Connect via Port of Call WebSocket tunnel
```

**Evaluate expressions:**
```json
// Check memory usage
{ "id": 1, "method": "Runtime.evaluate", "params": { "expression": "process.memoryUsage()" } }

// Check uptime
{ "id": 2, "method": "Runtime.evaluate", "params": { "expression": "process.uptime()" } }

// Inspect environment
{ "id": 3, "method": "Runtime.evaluate", "params": { "expression": "Object.keys(process.env)" } }

// Force garbage collection (requires --expose-gc)
{ "id": 4, "method": "Runtime.evaluate", "params": { "expression": "global.gc()" } }
```

### 2. Memory Leak Investigation

**Take heap snapshot:**
```json
// 1. Enable heap profiler
{ "id": 1, "method": "HeapProfiler.enable", "params": {} }

// 2. Take snapshot (returns chunked events)
{ "id": 2, "method": "HeapProfiler.takeHeapSnapshot", "params": {} }

// 3. Download chunks via HeapProfiler.addHeapSnapshotChunk events
// 4. Load in Chrome DevTools Memory panel
```

**Sampling heap profiler:**
```json
// 1. Start sampling
{ "id": 1, "method": "HeapProfiler.startSampling", "params": { "samplingInterval": 32768 } }

// ... let app run for a while ...

// 2. Stop and get profile
{ "id": 2, "method": "HeapProfiler.stopSampling", "params": {} }
```

### 3. CPU Profiling

**Record CPU profile:**
```json
// 1. Enable profiler
{ "id": 1, "method": "Profiler.enable", "params": {} }

// 2. Start profiling
{ "id": 2, "method": "Profiler.start", "params": {} }

// ... let app run under load ...

// 3. Stop and get profile
{ "id": 3, "method": "Profiler.stop", "params": {} }

// Result includes call tree with hitCounts and timing data
// Load in Chrome DevTools Performance panel
```

### 4. Code Coverage

**Collect coverage data:**
```json
// 1. Enable precise coverage
{ "id": 1, "method": "Profiler.startPreciseCoverage", "params": { "callCount": true, "detailed": true } }

// ... run tests or exercise code paths ...

// 2. Capture coverage
{ "id": 2, "method": "Profiler.takePreciseCoverage", "params": {} }

// 3. Stop coverage
{ "id": 3, "method": "Profiler.stopPreciseCoverage", "params": {} }
```

**Response format:**
```json
{
  "id": 2,
  "result": {
    "result": [
      {
        "scriptId": "23",
        "url": "file:///home/user/app/server.js",
        "functions": [
          {
            "functionName": "handleRequest",
            "ranges": [
              {
                "startOffset": 0,
                "endOffset": 245,
                "count": 150
              }
            ],
            "isBlockCoverage": true
          }
        ]
      }
    ]
  }
}
```

### 5. Breakpoint Debugging

**Set breakpoint and inspect:**
```json
// 1. Enable debugger
{ "id": 1, "method": "Debugger.enable", "params": {} }

// 2. Set breakpoint
{
  "id": 2,
  "method": "Debugger.setBreakpointByUrl",
  "params": {
    "lineNumber": 42,
    "url": "file:///home/user/app/server.js"
  }
}

// ... code executes and hits breakpoint ...

// Event: Debugger.paused received with callFrames

// 3. Evaluate in paused context
{
  "id": 3,
  "method": "Debugger.evaluateOnCallFrame",
  "params": {
    "callFrameId": "0",
    "expression": "localVariable"
  }
}

// 4. Resume execution
{ "id": 4, "method": "Debugger.resume", "params": {} }
```

### 6. Console Monitoring

**Subscribe to console output:**
```json
// 1. Enable Runtime events
{ "id": 1, "method": "Runtime.enable", "params": {} }

// Events received for all console.log/error/warn calls:
{
  "method": "Runtime.consoleAPICalled",
  "params": {
    "type": "log",
    "args": [
      { "type": "string", "value": "User logged in" }
    ],
    "executionContextId": 1,
    "timestamp": 1707890123456.789
  }
}
```

## Known Limitations and Quirks

### 1. No Sec-WebSocket-Protocol Header

The implementation does not send the `Sec-WebSocket-Protocol` header during WebSocket handshake. While not required by RFC 6455, some strict Inspector implementations may expect it for protocol negotiation.

**Workaround:** Node.js Inspector accepts connections without this header.

### 2. No Connection Reuse

Each health check and query opens a new TCP connection and immediately closes it (Connection: close header). This is inefficient for high-frequency polling.

**RFC Reference:** RFC 7230 §6.3 recommends persistent connections for performance.

**Workaround:** Use WebSocket tunnel for long-lived sessions instead of repeated HTTP queries.

### 3. Single Timeout for TLS + Query

The `timeout` parameter covers both TCP connection establishment and the entire HTTP request/response cycle. A slow TLS handshake can consume the entire timeout, leaving no time for the actual query.

**Workaround:** Increase timeout when debugging remote or high-latency targets.

### 4. Incomplete Chunked Encoding on Partial Reads

If a chunked HTTP response is split across multiple TCP reads in the middle of a chunk size line, the decoder will stop prematurely and return incomplete data.

**Affected:** Large `/json/protocol` responses on slow/lossy connections.

**Workaround:** Increase socket buffer or retry on truncated responses.

### 5. No SNI in TLS ClientHello

If connecting to an Inspector over TLS (custom proxy scenario), the implementation does not include Server Name Indication (SNI) in the TLS ClientHello.

**Impact:** Name-based virtual hosting on TLS-wrapped Inspectors will fail.

**Workaround:** Use IP-based TLS or add SNI support.

### 6. No Host Validation

The `host` parameter is not validated (no regex, no DNS resolution check). Malformed hosts fail at TCP connect time.

**Security Note:** Cloudflare detection mitigates SSRF to Cloudflare IPs, but other internal network ranges are not blocked.

### 7. No Authentication Support

Node.js Inspector protocol has **no built-in authentication**. Anyone who can connect to the port has full control.

**Best Practice:**
- Bind to 127.0.0.1 only (default)
- Use SSH tunnels for remote debugging: `ssh -L 9229:localhost:9229 user@remote`
- Firewall port 9229 in production
- Never expose Inspector publicly without authentication proxy

### 8. Max Response Size Limited to 512 KB

HTTP responses are capped at 512000 bytes. Large protocol schemas or session lists may be truncated.

**Affected:** `/json/protocol` endpoint (can be 200-300 KB)

**Workaround:** Use incremental parsing or streaming for large responses.

### 9. WebSocket Close from Client Not Forwarded

The message event handler (lines 387-407) only forwards text and binary frames. If the browser sends a WebSocket close frame (opcode 0x8), it is not forwarded to the Inspector. The close event handler (lines 420-423) only closes the Inspector socket but doesn't send a close frame.

**Impact:** Ungraceful disconnect — Inspector sees TCP FIN instead of WebSocket close.

**RFC Violation:** RFC 6455 §5.5.1 requires close frames for graceful shutdown.

**Status:** Fixed in latest code — close events now properly handled.

### 10. Partial WebSocket Frames Could Be Dropped

Before the fix, if a WebSocket frame header or payload was split across multiple TCP reads, the parser would silently drop the incomplete frame.

**Impact:** Large heap snapshot chunks, CPU profiles, or long console messages could be lost.

**Status:** Fixed — implemented frame buffering with `parseWebSocketFramesWithBuffer`.

### 11. 64-bit Frame Length Bug (Fixed)

Original code only read lower 4 bytes of 64-bit payload length, limiting frames to 4 GB instead of 2^63 bytes.

**Impact:** Theoretical — no real-world Inspector frames exceed 4 GB.

**RFC Violation:** RFC 6455 §5.2 specifies 64-bit length for large payloads.

**Status:** Fixed — now reads full 8 bytes, throws error if high 4 bytes are non-zero.

### 12. Oversized Ping Frame Vulnerability (Fixed)

Before the fix, if the Inspector sent a ping frame with >125 byte payload (violating RFC 6455 §5.5), the pong response would be malformed.

**Impact:** Connection corruption, inspector disconnect.

**Status:** Fixed — ping payloads >125 bytes are now rejected with a warning.

### 13. Binary WebSocket Frame Data Corruption (Fixed)

Original `readHandshakeResponse()` decoded HTTP headers as UTF-8, then re-encoded remainder back to bytes. This corrupted any binary WebSocket frames that arrived immediately after the handshake.

**Impact:** Binary protocol extensions, non-UTF8 payloads, or raw ping/pong frames would be mangled.

**Status:** Fixed — headers are searched at byte level, remainder preserved as raw bytes.

## Security Best Practices

### 1. Never Expose Inspector Publicly

**Bad:**
```bash
node --inspect=0.0.0.0:9229 server.js  # DANGEROUS
```

**Good:**
```bash
node --inspect=127.0.0.1:9229 server.js  # Localhost only
```

### 2. Use SSH Tunnels for Remote Debugging

```bash
# On remote server
node --inspect server.js

# On local machine
ssh -L 9229:localhost:9229 user@remote-server

# Connect to localhost:9229 locally
```

### 3. Firewall Inspector Port

**iptables:**
```bash
iptables -A INPUT -p tcp --dport 9229 -s 127.0.0.1 -j ACCEPT
iptables -A INPUT -p tcp --dport 9229 -j DROP
```

**ufw:**
```bash
ufw deny 9229
```

### 4. Disable Inspector in Production

Only enable Inspector when actively debugging. Do not run production services with `--inspect` permanently.

**Conditional enable:**
```bash
if [ "$DEBUG" = "1" ]; then
  node --inspect server.js
else
  node server.js
fi
```

### 5. Monitor Inspector Connections

Node.js logs when debuggers connect:
```
Debugger listening on ws://127.0.0.1:9229/abc-def-123-456
Debugger attached.
Debugger detached.
```

Monitor these logs for unauthorized connections.

### 6. Rotate Inspector Sessions

Each Node.js process gets a unique session UUID. Restart the process periodically to invalidate old session URLs.

### 7. Use Read-Only Debugging When Possible

Restrict debugger actions to read-only operations (Runtime.evaluate with side-effect-free expressions, HeapProfiler snapshots). Avoid:
- Debugger.setBreakpoint (can hang production)
- Runtime.evaluate with writes (global.secretKey = null)
- Profiler.collectGarbage (causes GC pause)

## References

**Official Specifications:**
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) — Main CDP documentation
- [V8 Inspector Protocol](https://chromedevtools.github.io/devtools-protocol/v8/) — Node.js-specific subset
- [V8 Debugging Guide](https://v8.dev/docs/inspector) — V8 inspector internals
- [Node.js Inspector API](https://nodejs.org/api/inspector.html) — Node.js inspector module
- [Node.js Debugging Guide](https://nodejs.org/en/learn/getting-started/debugging) — Official debugging guide
- [RFC 6455 — WebSocket Protocol](https://datatracker.ietf.org/doc/html/rfc6455) — WebSocket standard
- [RFC 7230 — HTTP/1.1](https://datatracker.ietf.org/doc/html/rfc7230) — HTTP/1.1 specification
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification) — JSON-RPC standard

**Tools:**
- [Chrome DevTools](https://developer.chrome.com/docs/devtools/) — Native Inspector client
- [VS Code Node Debugger](https://code.visualstudio.com/docs/nodejs/nodejs-debugging) — IDE integration
- [node-inspect](https://github.com/nodejs/node-inspect) — CLI debugger
- [websocat](https://github.com/vi/websocat) — WebSocket CLI client

**Security Resources:**
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/) — Official security guide
- [OWASP Node.js Security Cheatsheet](https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html) — Security checklist

## Comparison: Node Inspector vs Chrome DevTools Protocol (CDP)

| Feature | Node Inspector | Chrome CDP |
|---------|----------------|------------|
| **Protocol Base** | V8 Inspector (CDP subset) | Full CDP |
| **Default Port** | 9229 | 9222 |
| **Session Path Format** | `/UUID` (36-char UUID) | `/devtools/page/TARGET_ID` |
| **Runtime Domain** | Full support | Full support |
| **Debugger Domain** | Full support | Full support |
| **Profiler Domain** | Full support | Full support |
| **HeapProfiler Domain** | Full support | Full support |
| **Page Domain** | ❌ Not supported | ✅ Supported |
| **DOM Domain** | ❌ Not supported | ✅ Supported |
| **CSS Domain** | ❌ Not supported | ✅ Supported |
| **Network Domain** | ⚠️ Limited | ✅ Full support |
| **Performance Domain** | ⚠️ Limited | ✅ Full support |
| **Security Domain** | ❌ Not supported | ✅ Supported |
| **Custom Domains** | NodeRuntime, NodeTracing, NodeWorker | Tracing, ServiceWorker, WebAudio |
| **Target Type** | `"node"` | `"page"`, `"service_worker"`, `"iframe"` |
| **Auth** | None | None (both require external proxy) |
| **TLS** | Via custom proxy | Via custom proxy |

## curl Examples

**List sessions:**
```bash
curl http://localhost:9229/json
```

**Get version:**
```bash
curl http://localhost:9229/json/version
```

**Get protocol schema:**
```bash
curl http://localhost:9229/json/protocol > protocol.json
```

**Health check via Port of Call:**
```bash
curl -X POST http://localhost:8787/api/node-inspector/health \
  -H "Content-Type: application/json" \
  -d '{"host": "localhost", "port": 9229}'
```

**Query custom endpoint via Port of Call:**
```bash
curl -X POST http://localhost:8787/api/node-inspector/query \
  -H "Content-Type: application/json" \
  -d '{"host": "localhost", "port": 9229, "endpoint": "/json/protocol"}'
```

## Port of Call Implementation Status

✅ **Implemented:**
- HTTP/1.1 discovery endpoints (/json, /json/version)
- Session list parsing (UUID extraction)
- WebSocket tunnel with RFC 6455 handshake
- Sec-WebSocket-Accept validation
- JSON-RPC 2.0 message proxying (bidirectional)
- WebSocket frame parsing (text, binary, close, ping, pong)
- Automatic ping→pong responses
- Chunked transfer encoding decoder
- Cloudflare IP detection
- Timeout handling (connection + query)
- Frame buffering for partial reads (handles split frames)
- 64-bit payload length parsing (up to 4GB)
- Control frame size validation (≤125 bytes)
- Binary-safe handshake response parsing

❌ **Not Implemented:**
- Connection pooling / reuse
- SNI for TLS connections
- Sec-WebSocket-Protocol negotiation
- WebSocket compression (permessage-deflate)
- Host input validation / DNS checks
- Authentication / authorization
- Rate limiting
- Session URL caching
- Multi-session support in single tunnel
- WebSocket fragmented message assembly (FIN=0 continuations)

**Focus:** Transparent WebSocket proxy for Node.js Inspector debugging, profiling, and runtime inspection.
