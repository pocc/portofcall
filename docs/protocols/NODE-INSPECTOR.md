# Node Inspector (V8 Inspector Protocol) Implementation

## Overview

**Protocol:** V8 Inspector Protocol (Chrome DevTools Protocol for Node.js)
**Port:** 9229 (default)
**Specification:** [V8 Inspector Protocol](https://chromedevtools.github.io/devtools-protocol/)
**Complexity:** Medium-High
**Purpose:** Remote debugging and profiling of Node.js applications

Node Inspector uses the **V8 Inspector Protocol**, which is the same protocol used by Chrome DevTools (CDP). It enables remote debugging, profiling, and inspection of Node.js applications via WebSocket connections.

### Use Cases
- Remote debugging of Node.js applications
- JavaScript runtime evaluation
- CPU profiling and performance analysis
- Memory heap snapshots and analysis
- Breakpoint debugging
- Live code inspection
- Production troubleshooting
- DevTools integration

## Protocol Specification

### V8 Inspector Protocol

The V8 Inspector Protocol is identical to Chrome DevTools Protocol but tailored for Node.js:
- **JSON-RPC 2.0** for all commands
- **WebSocket** for bidirectional communication
- **HTTP endpoints** for discovery

### Key API Endpoints

#### Discovery & Health

**Session List:**
```http
GET /json HTTP/1.1
Host: localhost:9229
Connection: close
```

Response:
```json
[
  {
    "description": "node.js instance",
    "devtoolsFrontendUrl": "devtools://devtools/bundled/js_app.html?experiments=true&v8only=true&ws=127.0.0.1:9229/0f2c936f-b1cd-4ac9-aab3-f63b0f33d55e",
    "devtoolsFrontendUrlCompat": "devtools://devtools/bundled/inspector.html?experiments=true&v8only=true&ws=127.0.0.1:9229/0f2c936f-b1cd-4ac9-aab3-f63b0f33d55e",
    "faviconUrl": "https://nodejs.org/static/images/favicons/favicon.ico",
    "id": "0f2c936f-b1cd-4ac9-aab3-f63b0f33d55e",
    "title": "server.js",
    "type": "node",
    "url": "file:///home/user/app/server.js",
    "webSocketDebuggerUrl": "ws://127.0.0.1:9229/0f2c936f-b1cd-4ac9-aab3-f63b0f33d55e"
  }
]
```

**Version Detection:**
```http
GET /json/version HTTP/1.1
Host: localhost:9229
```

Response:
```json
{
  "Browser": "node.js/v20.11.0",
  "Protocol-Version": "1.3",
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "V8-Version": "11.3.244.8-node.19",
  "WebKit-Version": "537.36 (@0)"
}
```

#### WebSocket Commands

**Connect to Session:**
```javascript
ws://localhost:9229/0f2c936f-b1cd-4ac9-aab3-f63b0f33d55e
```

**Evaluate JavaScript:**
```json
{
  "id": 1,
  "method": "Runtime.evaluate",
  "params": {
    "expression": "1 + 1"
  }
}
```

Response:
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

**Get Heap Usage:**
```json
{
  "id": 2,
  "method": "Runtime.getHeapUsage",
  "params": {}
}
```

**Enable Debugger:**
```json
{
  "id": 3,
  "method": "Debugger.enable",
  "params": {}
}
```

**Start Profiler:**
```json
{
  "id": 4,
  "method": "Profiler.enable",
  "params": {}
}
```

```json
{
  "id": 5,
  "method": "Profiler.start",
  "params": {}
}
```

## Implementation

### Worker Endpoints

#### 1. Health Check Endpoint

**Path:** `/api/node-inspector/health`
**Method:** `POST`

Request:
```json
{
  "host": "localhost",
  "port": 9229,
  "timeout": 15000
}
```

Response:
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
    "version": {
      "Browser": "node.js/v20.11.0",
      "Protocol-Version": "1.3",
      "V8-Version": "11.3.244.8-node.19"
    }
  }
}
```

#### 2. WebSocket Tunnel Endpoint

**Path:** `/api/node-inspector/tunnel`
**Method:** `WebSocket Upgrade`

Query Parameters:
- `host`: Target host (e.g., "localhost")
- `port`: Target port (e.g., 9229)
- `path`: WebSocket path (e.g., "/0f2c936f-b1cd-4ac9-aab3-f63b0f33d55e")

The tunnel provides bidirectional proxying between the browser and Node.js Inspector:
- Client → Worker → Node.js Inspector (commands)
- Node.js Inspector → Worker → Client (responses and events)

### Common Commands

#### Runtime Domain
```json
// Evaluate expression
{ "id": 1, "method": "Runtime.evaluate", "params": { "expression": "process.version" } }

// Get heap usage
{ "id": 2, "method": "Runtime.getHeapUsage", "params": {} }

// Get properties of an object
{ "id": 3, "method": "Runtime.getProperties", "params": { "objectId": "..." } }
```

#### Debugger Domain
```json
// Enable debugger
{ "id": 1, "method": "Debugger.enable", "params": {} }

// Set breakpoint
{ "id": 2, "method": "Debugger.setBreakpointByUrl", "params": { "lineNumber": 10, "url": "file:///path/to/file.js" } }

// Pause execution
{ "id": 3, "method": "Debugger.pause", "params": {} }

// Resume execution
{ "id": 4, "method": "Debugger.resume", "params": {} }

// Step over
{ "id": 5, "method": "Debugger.stepOver", "params": {} }
```

#### Profiler Domain
```json
// Enable profiler
{ "id": 1, "method": "Profiler.enable", "params": {} }

// Start profiling
{ "id": 2, "method": "Profiler.start", "params": {} }

// Stop profiling
{ "id": 3, "method": "Profiler.stop", "params": {} }

// Take heap snapshot
{ "id": 4, "method": "HeapProfiler.takeHeapSnapshot", "params": {} }
```

## Testing

### Starting Node.js with Inspector

**Standard Mode:**
```bash
node --inspect server.js
# Debugger listening on ws://127.0.0.1:9229/...
```

**Break on Start:**
```bash
node --inspect-brk server.js
# Pauses on first line of code
```

**Custom Port:**
```bash
node --inspect=9230 server.js
```

**Remote Access (⚠️ Security Risk):**
```bash
node --inspect=0.0.0.0:9229 server.js
# Allows remote connections - use with caution!
```

### Test Queries

**1. List Sessions:**
```bash
curl http://localhost:9229/json
```

**2. Get Version:**
```bash
curl http://localhost:9229/json/version
```

**3. WebSocket Connection:**
```javascript
// Extract webSocketDebuggerUrl from /json endpoint
const ws = new WebSocket('ws://localhost:9229/0f2c936f-b1cd-4ac9-aab3-f63b0f33d55e');
ws.onopen = () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { expression: '1 + 1' }
  }));
};
```

## Security Considerations

### Network Access

By default, Node Inspector binds to `127.0.0.1` (localhost only):
- ✅ Safe for local development
- ❌ Not accessible remotely

To allow remote access:
```bash
node --inspect=0.0.0.0:9229 server.js
```

**⚠️ Warning:** This exposes full debugging capabilities to anyone who can reach the port. Use only in trusted networks or with proper firewall rules.

### Capabilities

Node Inspector grants **full control** over the Node.js process:
- Execute arbitrary JavaScript code
- Read/modify variables and memory
- Access environment variables (secrets!)
- Read files accessible to the process
- Potentially escalate privileges

### Best Practices

1. **Never expose Inspector publicly** without authentication
2. **Use SSH tunnels** for remote debugging:
   ```bash
   ssh -L 9229:localhost:9229 user@remote-server
   ```
3. **Firewall the port** (9229) in production
4. **Disable Inspector** in production unless needed
5. **Monitor connections** - Inspector logs connections
6. **Use --inspect-brk** only during development

## Resources

- **V8 Inspector Protocol:** [chromedevtools.github.io/devtools-protocol](https://chromedevtools.github.io/devtools-protocol/)
- **Node.js Debugging Guide:** [nodejs.org/en/docs/guides/debugging-getting-started](https://nodejs.org/en/docs/guides/debugging-getting-started/)
- **Chrome DevTools:** [developer.chrome.com/docs/devtools](https://developer.chrome.com/docs/devtools/)
- **V8 Documentation:** [v8.dev](https://v8.dev/)

## Port of Call Implementation Status

✅ **Implemented:**
- Session discovery via /json endpoint
- Node.js and V8 version detection
- WebSocket URL extraction (UUID-based paths)
- HTTP/1.1 over TCP implementation
- WebSocket tunnel with bidirectional proxying
- JSON-RPC 2.0 command execution
- All V8 Inspector Protocol domains supported
- Quick command buttons for common operations:
  - JavaScript evaluation
  - Heap usage inspection
  - Debugger control (enable/pause/resume)
  - Profiler control (enable/start/stop)
- Real-time event subscriptions
- WebSocket frame parsing and masking

**Focus:** Debugging, profiling, and runtime inspection of Node.js applications via the V8 Inspector Protocol.

## Differences from Chrome DevTools Protocol (CDP)

While Node Inspector uses the same protocol as CDP, there are some differences:

### Similarities
- Same JSON-RPC 2.0 structure
- Same WebSocket communication
- Same Runtime, Debugger, Profiler domains
- Same command/event format

### Differences
1. **Session Paths**: Node uses UUID-based paths, CDP uses numeric IDs
2. **Available Domains**: Node doesn't support browser-specific domains (Page, DOM, CSS, etc.)
3. **Default Port**: Node uses 9229, CDP uses 9222
4. **Version Info**: Different Browser field (node.js vs Chrome)
5. **Target Types**: Node sessions are type "node", CDP has various types (page, service_worker, etc.)

## Example Use Cases

### 1. Production Debugging
```bash
# Start app with Inspector
node --inspect server.js

# Port of Call: Connect to localhost:9229
# Evaluate: process.memoryUsage()
# Evaluate: require('os').uptime()
```

### 2. Memory Leak Investigation
```bash
# Take heap snapshot
{ "method": "HeapProfiler.takeHeapSnapshot" }

# Enable heap profiler
{ "method": "HeapProfiler.enable" }

# Start sampling
{ "method": "HeapProfiler.startSampling" }
```

### 3. Performance Profiling
```bash
# Enable profiler
{ "method": "Profiler.enable" }

# Start CPU profiling
{ "method": "Profiler.start" }

# ... let app run ...

# Stop and get profile
{ "method": "Profiler.stop" }
```
