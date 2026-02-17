# Chrome DevTools Protocol (CDP) Implementation

## Overview

**Protocol:** Chrome DevTools Protocol (CDP)
**Port:** 9222 (default remote debugging port)
**Specification:** [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
**Complexity:** High
**Purpose:** Remote browser debugging, automation, and inspection

CDP is the protocol used by Chrome/Chromium browsers for remote debugging. It provides programmatic access to browser internals, enabling automation, testing, performance monitoring, and inspection.

### Use Cases
- Browser automation and testing (Puppeteer, Playwright, Selenium)
- Remote debugging and inspection
- Screenshot and PDF generation
- Performance profiling and monitoring
- Network traffic analysis
- JavaScript execution and debugging
- DOM manipulation and inspection
- Mobile device debugging (via ADB)

## Protocol Specification

### Architecture

CDP consists of two main components:

1. **HTTP JSON API** - Discovery and metadata endpoints
2. **WebSocket JSON-RPC 2.0** - Bidirectional command/event protocol

### Launching Chrome with Remote Debugging

```bash
# Chrome/Chromium
chrome --remote-debugging-port=9222

# Headless mode
chrome --headless --remote-debugging-port=9222

# Specific user data directory
chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug

# Allow remote connections (DANGEROUS - use with caution)
chrome --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0
```

### HTTP JSON Endpoints

#### `/json/version` - Browser Version Information

**Request:**
```http
GET /json/version HTTP/1.1
Host: localhost:9222
```

**Response:**
```json
{
  "Browser": "Chrome/120.0.6099.129",
  "Protocol-Version": "1.3",
  "User-Agent": "Mozilla/5.0 ...",
  "V8-Version": "12.0.267.8",
  "WebKit-Version": "537.36",
  "webSocketDebuggerUrl": "ws://localhost:9222/devtools/browser/..."
}
```

#### `/json/list` or `/json` - Available Targets

**Request:**
```http
GET /json/list HTTP/1.1
Host: localhost:9222
```

**Response:**
```json
[
  {
    "description": "",
    "devtoolsFrontendUrl": "/devtools/inspector.html?ws=localhost:9222/devtools/page/...",
    "id": "E4F8...",
    "title": "Google",
    "type": "page",
    "url": "https://www.google.com/",
    "webSocketDebuggerUrl": "ws://localhost:9222/devtools/page/..."
  },
  {
    "description": "",
    "id": "serviceWorker1",
    "title": "Service Worker",
    "type": "service_worker",
    "url": "https://example.com/sw.js",
    "webSocketDebuggerUrl": "ws://localhost:9222/devtools/page/..."
  }
]
```

**Target Types:**
- `page` - Regular browser tab
- `iframe` - Embedded frame
- `worker` - Web Worker
- `service_worker` - Service Worker
- `other` - Extensions, background pages

#### `/json/protocol` - Full Protocol Specification

Returns the complete CDP specification with all domains, methods, and events.

```http
GET /json/protocol HTTP/1.1
Host: localhost:9222
```

Response: Large JSON document (~5MB) with all CDP domains.

#### `/json/new?{url}` - Open New Tab

```http
GET /json/new?https://example.com HTTP/1.1
Host: localhost:9222
```

Response: Target info for the newly created tab.

#### `/json/close/{targetId}` - Close Target

```http
GET /json/close/E4F8... HTTP/1.1
Host: localhost:9222
```

#### `/json/activate/{targetId}` - Bring Tab to Front

```http
GET /json/activate/E4F8... HTTP/1.1
Host: localhost:9222
```

### WebSocket JSON-RPC Protocol

Connect to the WebSocket URL from `/json/version` or a target's `webSocketDebuggerUrl`.

**Command Format:**
```json
{
  "id": 1,
  "method": "Page.navigate",
  "params": {
    "url": "https://example.com"
  }
}
```

**Response Format:**
```json
{
  "id": 1,
  "result": {
    "frameId": "...",
    "loaderId": "..."
  }
}
```

**Error Format:**
```json
{
  "id": 1,
  "error": {
    "code": -32601,
    "message": "Method not found"
  }
}
```

**Event Format:**
```json
{
  "method": "Page.loadEventFired",
  "params": {
    "timestamp": 123456.789
  }
}
```

### CDP Domains

Major CDP domains:

| Domain | Purpose |
|--------|---------|
| **Page** | Page navigation, screenshots, lifecycle |
| **DOM** | DOM tree inspection and manipulation |
| **Runtime** | JavaScript execution and evaluation |
| **Network** | Network traffic monitoring |
| **Debugger** | JavaScript debugging (breakpoints, stepping) |
| **Performance** | Performance metrics and profiling |
| **Console** | Console message handling |
| **Target** | Target (tab/worker) management |
| **Browser** | Browser-level operations |
| **Emulation** | Device emulation (viewport, user agent) |
| **Input** | Mouse, keyboard, touch input simulation |
| **Security** | Security state and certificate inspection |

### Common Commands

**Navigate to URL:**
```json
{"id": 1, "method": "Page.navigate", "params": {"url": "https://example.com"}}
```

**Take Screenshot:**
```json
{"id": 2, "method": "Page.captureScreenshot", "params": {"format": "png"}}
```

**Execute JavaScript:**
```json
{"id": 3, "method": "Runtime.evaluate", "params": {"expression": "document.title"}}
```

**Get DOM Tree:**
```json
{"id": 4, "method": "DOM.getDocument", "params": {}}
```

**Enable Network Monitoring:**
```json
{"id": 5, "method": "Network.enable", "params": {}}
```

## Implementation

### Worker Endpoints

#### 1. Health Check Endpoint

**Path:** `/api/cdp/health`
**Method:** `POST`

Request:
```json
{
  "host": "localhost",
  "port": 9222,
  "timeout": 10000
}
```

Response:
```json
{
  "success": true,
  "statusCode": 200,
  "latencyMs": 45,
  "parsed": {
    "version": {
      "Browser": "Chrome/120.0.6099.129",
      "Protocol-Version": "1.3",
      "User-Agent": "Mozilla/5.0 ...",
      "V8-Version": "12.0.267.8",
      "WebKit-Version": "537.36",
      "webSocketDebuggerUrl": "ws://localhost:9222/devtools/browser/..."
    },
    "targets": [...],
    "targetCount": 3
  }
}
```

#### 2. Query Endpoint

**Path:** `/api/cdp/query`
**Method:** `POST`

Request:
```json
{
  "host": "localhost",
  "port": 9222,
  "endpoint": "/json/list",
  "timeout": 10000
}
```

Response:
```json
{
  "success": true,
  "statusCode": 200,
  "latencyMs": 25,
  "body": "[{...}]",
  "parsed": [...]
}
```

### Implementation Details

The implementation in `src/worker/cdp.ts`:

1. **Raw TCP Socket Connection** - Uses `cloudflare:sockets` API
2. **HTTP/1.1 Request Construction** - Manually builds GET requests
3. **Chunked Transfer Encoding** - Handles chunked responses
4. **JSON Parsing** - Attempts to parse CDP JSON responses
5. **Cloudflare Detection** - Prevents accessing Cloudflare-protected hosts

#### 3. WebSocket Tunnel Endpoint

**Path:** `/api/cdp/tunnel?host={host}&port={port}&targetId={targetId}`
**Method:** WebSocket Upgrade

Establishes a bidirectional WebSocket tunnel to Chrome's CDP endpoint.

**Query Parameters:**
- `host` - Chrome instance hostname (required)
- `port` - CDP port (default: 9222)
- `targetId` - Target ID from `/json/list` (optional, defaults to browser target)

**Command Format (Client → CDP):**
```json
{
  "id": 1,
  "method": "Runtime.evaluate",
  "params": {
    "expression": "document.title"
  }
}
```

**Response Format (CDP → Client):**
```json
{
  "id": 1,
  "result": {
    "result": {
      "type": "string",
      "value": "Example Domain"
    }
  }
}
```

**Event Format (CDP → Client):**
```json
{
  "method": "Page.loadEventFired",
  "params": {
    "timestamp": 123456.789
  }
}
```

**Features:**
- ✅ HTTP JSON API for discovery
- ✅ WebSocket tunnel for CDP commands
- ✅ Bidirectional JSON-RPC 2.0 messaging
- ✅ CDP command execution (all domains)
- ✅ CDP event subscription and handling
- ✅ Automatic WebSocket framing and unmasking
- ✅ Ping/pong frame handling for keep-alive

## Web UI

### Component: CDPClient.tsx

Features:
1. **Connection Form**
   - Host input (default: localhost)
   - Port input (default: 9222)

2. **Browser Discovery**
   - Fetches browser version info
   - Lists all available targets (tabs, workers, etc.)
   - Shows WebSocket debugger URLs
   - Displays browser metadata (Chrome version, V8, WebKit)

3. **Endpoint Query Interface**
   - Endpoint path input
   - Quick query buttons for common endpoints

4. **Response Display**
   - Pretty-printed JSON output
   - HTTP status code and latency
   - Error handling with detailed messages

### Quick Query Buttons

- `GET /json/version` - Browser version
- `GET /json/list` - All targets
- `GET /json` - Short list
- `GET /json/protocol` - Full CDP spec (large!)
- `GET /json/new` - Open new tab

## Testing

### Local Testing

1. **Launch Chrome with Remote Debugging:**
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-port=9222

# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

2. **Test HTTP Endpoints:**
```bash
# Version info
curl http://localhost:9222/json/version

# List targets
curl http://localhost:9222/json/list

# Open new tab
curl http://localhost:9222/json/new?https://example.com
```

3. **Use Port of Call:**
- Host: `localhost`
- Port: `9222`
- Click "Browser Discovery"

### Docker Testing

```bash
# Chrome in Docker with remote debugging
docker run -d \
  -p 9222:9222 \
  --name chrome-debug \
  zenika/alpine-chrome:latest \
  --no-sandbox \
  --remote-debugging-address=0.0.0.0 \
  --remote-debugging-port=9222

# Access at localhost:9222
```

### Headless Chrome

```bash
# Headless mode (no UI)
chrome --headless --remote-debugging-port=9222

# With specific URL
chrome --headless --remote-debugging-port=9222 https://example.com
```

## Security Considerations

### 1. Local Access Only (Default)

By default, CDP listens on `localhost:9222` and is only accessible locally. This is SAFE.

### 2. Remote Access (DANGEROUS!)

Using `--remote-debugging-address=0.0.0.0` allows remote connections:
- **Extreme Risk**: Full browser control
- **No Authentication**: Anyone can connect
- **Arbitrary Code Execution**: Via JavaScript evaluation
- **File System Access**: Via Downloads/Uploads
- **Network Access**: Via fetch/XHR

**NEVER** expose CDP on public networks without a secure tunnel (SSH, VPN).

### 3. SSRF Protection

Port of Call validates:
- Hostnames (blocks localhost, internal IPs)
- Ports (validates range)
- Timeouts (prevents hang)
- Response size (512KB limit)

### 4. Use Cases for Remote CDP

**Acceptable:**
- Docker containers on same host
- Kubernetes pods in same cluster
- SSH tunnels: `ssh -L 9222:localhost:9222 user@remote`
- VPN-secured connections

**Not Acceptable:**
- Exposed to public internet
- Unencrypted connections
- Production environments

## Tools Using CDP

### Automation Libraries

- **Puppeteer** (Node.js) - Official Chrome automation library
- **Playwright** (Node.js, Python, C#, Java) - Cross-browser automation
- **Selenium 4+** - Uses CDP for Chrome-specific features
- **CDP4J** (Java) - Java CDP client

### Debugging Tools

- **Chrome DevTools** - Built-in browser developer tools
- **VS Code Debugger** - Debugs via CDP
- **WebStorm Debugger** - JetBrains IDE debugging
- **Remote Debugging** - Mobile device debugging via ADB

### Monitoring & Testing

- **Lighthouse** - Performance auditing
- **WebPageTest** - Performance testing
- **Speedcurve** - Synthetic monitoring
- **Checkly** - API & Browser monitoring

## Resources

- **Specification:** [chromedevtools.github.io/devtools-protocol](https://chromedevtools.github.io/devtools-protocol/)
- **Puppeteer:** [pptr.dev](https://pptr.dev/)
- **Playwright:** [playwright.dev](https://playwright.dev/)
- **CDP Viewer:** [chrome-devtools-frontend.appspot.com](https://chrome-devtools-frontend.appspot.com/)
- **GitHub:** [github.com/ChromeDevTools/devtools-protocol](https://github.com/ChromeDevTools/devtools-protocol)

## Common Issues

### "Connection Refused"

Chrome not launched with `--remote-debugging-port=9222`. Launch Chrome with the flag.

### "Empty Response"

Chrome running but port mismatch. Check Chrome was launched with correct port.

### "No Targets Available"

Chrome launched but no tabs open. Open at least one tab or website.

### "WebSocket Connection Failed"

Port of Call implements HTTP only. WebSocket tunnel not yet implemented.

## Port of Call Implementation Status

✅ **Implemented:**
- Browser version and metadata detection
- Target enumeration (pages, workers, extensions)
- Available targets listing
- WebSocket debugger URL discovery
- Protocol specification query
- HTTP/1.1 over TCP implementation
- **WebSocket tunnel for CDP commands**
- **JavaScript evaluation (Runtime.evaluate)**
- **DOM inspection (DOM.getDocument)**
- **Screenshot capture (Page.captureScreenshot)**
- **PDF generation (Page.printToPDF)**
- **Page navigation (Page.navigate)**
- **Network monitoring (Network.enable)**
- **CDP event subscriptions**
- **Bidirectional JSON-RPC 2.0**
- Quick command buttons for common operations

**Focus:** Full CDP functionality including discovery, command execution, and real-time event handling.

## Example Use Cases

### 1. Check Chrome Version
```
Endpoint: /json/version
Result: Browser version, V8 version, WebKit version
```

### 2. List Open Tabs
```
Endpoint: /json/list
Result: All pages, workers, and their URLs
```

### 3. Get WebSocket URL for Automation
```
Endpoint: /json/version
Result: webSocketDebuggerUrl for connecting automation tools
```

### 4. Verify Remote Debugging is Enabled
```
Host: target-host
Port: 9222
Result: Confirms CDP is accessible and responding
```
