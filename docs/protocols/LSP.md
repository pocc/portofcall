# Language Server Protocol (LSP) Implementation Guide

## Overview

The Language Server Protocol (LSP) enables communication between code editors and language servers for features like autocomplete, go-to-definition, diagnostics, and refactoring. This document covers the LSP implementation in PortOfCall.

**Specification**: [LSP 3.17](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/)

## Architecture

### Wire Protocol

LSP uses JSON-RPC 2.0 over TCP with a custom framing format:

```
Content-Length: <byte-count>\r\n
\r\n
<JSON-RPC message>
```

**Critical Details**:
- `Content-Length` counts **bytes**, not characters (important for UTF-8 multi-byte sequences)
- Headers are ASCII, terminated by `\r\n`
- Header section ends with `\r\n\r\n` (blank line)
- Body is UTF-8 encoded JSON

### Implementation Files

- **`src/worker/lsp.ts`** — Core LSP client implementation
- **Endpoints**:
  - `POST /api/protocol/lsp/connect` — Quick capability check
  - `POST /api/protocol/lsp/session` — Full lifecycle test

## Message Framing

### Encoding Messages

```typescript
function encodeLspMessage(message: unknown): Uint8Array {
  const json = JSON.stringify(message);
  const encoder = new TextEncoder();
  const body = encoder.encode(json);
  const header = encoder.encode(`Content-Length: ${body.byteLength}\r\n\r\n`);
  const result = new Uint8Array(header.byteLength + body.byteLength);
  result.set(header, 0);
  result.set(body, header.byteLength);
  return result;
}
```

**Why byte-level encoding?**
- `Content-Length` is in bytes, not characters
- Multi-byte UTF-8 characters (e.g., emoji, Chinese) would be miscounted if we measured string length
- Example: "Hello 世界" is 11 characters but 13 bytes in UTF-8

### Parsing Messages

```typescript
function parseLspMessage(buffer: Uint8Array): { message: unknown; remaining: Uint8Array } | null {
  const headerEnd = findHeaderEnd(buffer);
  if (headerEnd === -1) return null;

  const decoder = new TextDecoder();
  const headerSection = decoder.decode(buffer.subarray(0, headerEnd));
  const contentLengthMatch = headerSection.match(/Content-Length:\s*(\d+)/i);
  if (!contentLengthMatch) return null;

  const contentLength = parseInt(contentLengthMatch[1], 10);
  const bodyStart = headerEnd + 4; // skip \r\n\r\n

  if (buffer.byteLength < bodyStart + contentLength) return null;

  const bodyBytes = buffer.subarray(bodyStart, bodyStart + contentLength);
  const bodyStr = decoder.decode(bodyBytes);
  const remaining = buffer.subarray(bodyStart + contentLength);

  try {
    const message = JSON.parse(bodyStr);
    return { message, remaining: new Uint8Array(remaining) };
  } catch {
    return null;
  }
}
```

**Key Techniques**:
1. **Byte-level buffering** — Accumulate raw bytes until we have a complete message
2. **Header scanning** — Search for `\r\n\r\n` (0x0D 0x0A 0x0D 0x0A) in raw bytes
3. **Exact byte extraction** — Use `Content-Length` to slice exactly N bytes from the buffer
4. **Remainder tracking** — Return leftover bytes for the next message

## JSON-RPC 2.0 Requirements

All LSP messages MUST conform to JSON-RPC 2.0:

### Requests (expect a response)
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": { ... }
}
```

**Required fields**:
- `jsonrpc`: Must be `"2.0"`
- `id`: Number or string (unique per request)
- `method`: String method name
- `params`: Object, array, or `null` (REQUIRED, even for void methods)

### Notifications (no response expected)
```json
{
  "jsonrpc": "2.0",
  "method": "initialized",
  "params": {}
}
```

**Required fields**:
- `jsonrpc`: Must be `"2.0"`
- `method`: String method name
- `params`: Object, array, or `null` (REQUIRED)
- **NO `id` field** (presence of `id` makes it a request)

### Responses
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { ... }
}
```

or

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32600,
    "message": "Invalid request"
  }
}
```

## LSP Lifecycle

### Minimal Session

```
Client                          Server
  |                               |
  |------- initialize --------->  |  (request, id=1)
  |<------ InitializeResult ----  |  (response, id=1)
  |                               |
  |------- initialized -------->  |  (notification)
  |                               |
  |  (normal LSP operations)      |
  |                               |
  |------- shutdown ---------->   |  (request, id=N)
  |<------ null --------------    |  (response, id=N)
  |                               |
  |------- exit -------------->   |  (notification)
  |                               |
  (connection closes)
```

### Step-by-Step

#### 1. Initialize Request

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "processId": null,
    "clientInfo": {
      "name": "PortOfCall",
      "version": "1.0.0"
    },
    "capabilities": {
      "textDocument": {
        "synchronization": {},
        "completion": {},
        "hover": {},
        "definition": {},
        "references": {},
        "formatting": {}
      },
      "workspace": {
        "workspaceFolders": true,
        "configuration": true
      }
    },
    "rootUri": null,
    "workspaceFolders": null
  }
}
```

**Response**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "capabilities": {
      "completionProvider": {},
      "hoverProvider": true,
      "definitionProvider": true,
      ...
    },
    "serverInfo": {
      "name": "rust-analyzer",
      "version": "0.3.1828"
    }
  }
}
```

#### 2. Initialized Notification

**MUST** be sent after receiving `InitializeResult`:

```json
{
  "jsonrpc": "2.0",
  "method": "initialized",
  "params": {}
}
```

This signals the client is ready to receive notifications and requests from the server.

#### 3. Text Document Operations

**didOpen** (open a file):
```json
{
  "jsonrpc": "2.0",
  "method": "textDocument/didOpen",
  "params": {
    "textDocument": {
      "uri": "file:///path/to/file.rs",
      "languageId": "rust",
      "version": 1,
      "text": "fn main() {\n    println!(\"Hello\");\n}\n"
    }
  }
}
```

**hover** (get documentation):
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "textDocument/hover",
  "params": {
    "textDocument": { "uri": "file:///path/to/file.rs" },
    "position": { "line": 1, "character": 4 }
  }
}
```

**completion** (autocomplete):
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "textDocument/completion",
  "params": {
    "textDocument": { "uri": "file:///path/to/file.rs" },
    "position": { "line": 1, "character": 12 }
  }
}
```

#### 4. Shutdown Request

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "shutdown",
  "params": null
}
```

**Response**:
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": null
}
```

The server should stop processing requests but stay alive to receive the exit notification.

#### 5. Exit Notification

```json
{
  "jsonrpc": "2.0",
  "method": "exit",
  "params": null
}
```

The server terminates its process:
- Exit code **0** if shutdown was received first (clean exit)
- Exit code **1** otherwise (abnormal termination)

## Common Capabilities

The `capabilities` object in the `InitializeResult` declares what features the server supports:

| Capability | Feature |
|------------|---------|
| `completionProvider` | Code completion (autocomplete) |
| `hoverProvider` | Hover documentation |
| `definitionProvider` | Go to definition |
| `referencesProvider` | Find all references |
| `documentFormattingProvider` | Format entire document |
| `documentRangeFormattingProvider` | Format selection |
| `codeActionProvider` | Quick fixes, refactorings |
| `renameProvider` | Rename symbol |
| `foldingRangeProvider` | Code folding regions |
| `semanticTokensProvider` | Semantic syntax highlighting |
| `inlayHintProvider` | Inline type hints |
| `diagnosticProvider` | Error/warning diagnostics |
| `workspaceSymbolProvider` | Global symbol search |
| `executeCommandProvider` | Custom commands |

### Capability Detection

```typescript
function extractCapabilityList(caps: LspCapabilities): string[] {
  const list: string[] = [];

  const check = (key: string, label: string) => {
    const val = caps[key];
    if (val === true || (val !== undefined && val !== null && val !== false)) {
      list.push(label);
    }
  };

  check('completionProvider', 'Code Completion');
  check('hoverProvider', 'Hover Information');
  check('definitionProvider', 'Go to Definition');
  // ... etc
}
```

**Why this logic?**
- `true` — Boolean capability
- `{}` or `{ ... }` — Object-based capability with configuration
- `undefined`, `null`, `false` — Not supported

## Position and Range

LSP uses zero-based line/character indexing:

```typescript
interface Position {
  line: number;      // 0-based line number
  character: number; // 0-based UTF-16 code unit offset
}

interface Range {
  start: Position;
  end: Position;     // exclusive
}
```

**Example**:
```
Line 0: fn main() {
Line 1:     println!("Hello");
Line 2: }
```

Position of `println`:
```json
{ "line": 1, "character": 4 }
```

**UTF-16 Character Encoding**:
- LSP character offsets use UTF-16 code units, not Unicode code points
- Emoji and some Unicode characters are 2 UTF-16 code units
- Example: "Hello 😊 world"
  - 😊 starts at character 6 but is 2 code units wide
  - "world" starts at character 8 (not 7)

## Error Handling

### Connection Errors

```typescript
try {
  const socket = connect(`${host}:${port}`);
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });
  await Promise.race([socket.opened, timeoutPromise]);
} catch (error) {
  return { success: false, error: error.message };
}
```

### Message Timeout

```typescript
async function readLSPMessage(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  bufferRef: { value: Uint8Array },
  timeoutMs: number,
): Promise<unknown> {
  const deadline = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('LSP read timeout')), timeoutMs)
  );

  while (true) {
    const parsed = parseLspMessage(bufferRef.value);
    if (parsed) {
      bufferRef.value = parsed.remaining;
      return parsed.message;
    }

    const { value, done } = await Promise.race([reader.read(), deadline]);
    if (done) throw new Error('Connection closed while waiting for LSP message');
    if (value) {
      bufferRef.value = concatBytes(bufferRef.value, value);
    }
  }
}
```

### LSP Error Responses

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32600,
    "message": "Invalid Request"
  }
}
```

Standard JSON-RPC error codes:
- `-32700` — Parse error
- `-32600` — Invalid request
- `-32601` — Method not found
- `-32602` — Invalid params
- `-32603` — Internal error

LSP-specific codes:
- `-32802` — Request failed
- `-32803` — Server cancelled
- `-32800` — Request cancelled

## PortOfCall API Endpoints

### POST /api/protocol/lsp/connect

Quick capability check — establishes connection, sends initialize, returns capabilities.

**Request**:
```json
{
  "host": "localhost",
  "port": 2087,
  "rootUri": null,
  "timeout": 15000
}
```

**Response**:
```json
{
  "success": true,
  "serverInfo": {
    "name": "rust-analyzer",
    "version": "0.3.1828"
  },
  "capabilities": { ... },
  "capabilityList": [
    "Code Completion",
    "Hover Information",
    "Go to Definition"
  ],
  "protocolVersion": "3.17",
  "latencyMs": 234
}
```

### POST /api/protocol/lsp/session

Full LSP lifecycle test — initialize → initialized → didOpen → hover → completion → shutdown → exit.

**Request**:
```json
{
  "host": "localhost",
  "port": 2087,
  "timeout": 20000,
  "rootUri": "file:///workspace",
  "textDocumentUri": "file:///workspace/main.rs",
  "textDocumentContent": "fn main() {\n    println!(\"test\");\n}",
  "language": "rust"
}
```

**Response**:
```json
{
  "success": true,
  "initialized": true,
  "serverInfo": { ... },
  "capabilities": { ... },
  "capabilityList": [ ... ],
  "hoverResult": { ... },
  "completionItems": 42,
  "rtt": 567
}
```

## Advanced Techniques

### Buffering Strategy

LSP messages may arrive fragmented or batched:

```
Chunk 1: Content-Length: 123\r\n\r\n{"jsonrpc":"2.
Chunk 2: 0","id":1,"result":{"capabilities":{...}}}Content-Le
Chunk 3: ngth: 45\r\n\r\n{"jsonrpc":"2.0","method":"window/logMessage","params":{...}}
```

**Solution**: Maintain a rolling byte buffer:

```typescript
let buffer = new Uint8Array(0);

while (true) {
  const { value } = await reader.read();
  if (value) {
    buffer = concatBytes(buffer, value);
  }

  let parsed = parseLspMessage(buffer);
  while (parsed) {
    processMessage(parsed.message);
    buffer = parsed.remaining;
    parsed = parseLspMessage(buffer);
  }
}
```

### Handling Unsolicited Messages

Servers may send notifications at any time:

```json
{
  "jsonrpc": "2.0",
  "method": "textDocument/publishDiagnostics",
  "params": {
    "uri": "file:///workspace/main.rs",
    "diagnostics": [
      {
        "range": { "start": { "line": 1, "character": 4 }, "end": { "line": 1, "character": 12 } },
        "severity": 2,
        "message": "unused variable: `println`"
      }
    ]
  }
}
```

**Pattern**: When waiting for a specific response, skip notifications:

```typescript
while (!initResult) {
  const msg = await readLSPMessage(reader, buf, msgTimeout);
  if (msg.id === 1) {
    initResult = msg.result;
  }
  // Skip notifications (no id field)
}
```

### Resource Cleanup

Always release locks and close sockets:

```typescript
try {
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  // ... LSP session ...

} finally {
  writer.releaseLock();
  reader.releaseLock();
  socket.close();
}
```

## Protocol Violations to Avoid

1. **Missing `params` field** — JSON-RPC 2.0 requires `params` on all requests/notifications, even when null
2. **String length for Content-Length** — Must use byte count, not character count
3. **Forgetting `initialized` notification** — Server won't send messages until it receives this
4. **Skipping shutdown** — Always send shutdown before exit for clean termination
5. **Wrong header terminator** — Must be `\r\n\r\n`, not `\n\n`

## Testing LSP Servers

### Rust Analyzer (rust-analyzer)

```bash
# Install
rustup component add rust-analyzer

# Run on port 2087
rust-analyzer --tcp 2087
```

### Python (pylsp)

```bash
pip install python-lsp-server
pylsp --tcp --port 2087
```

### TypeScript (typescript-language-server)

```bash
npm install -g typescript-language-server
typescript-language-server --stdio
```

(Note: stdio mode requires different transport; use TCP adapters for testing)

## Debugging

### Enable verbose logging

Many servers support `--log-level trace`:

```bash
rust-analyzer --tcp 2087 --log-level trace
```

### Inspect raw bytes

```typescript
console.log('Sending:', new TextDecoder().decode(encodedMessage));
console.log('Received:', new TextDecoder().decode(buffer));
```

### Common Issues

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Timeout on initialize | Wrong port, server not running | Check `netstat -an \| grep 2087` |
| "Content-Length mismatch" | Byte count error (multi-byte chars) | Use `byteLength`, not `length` |
| No response after initialize | Missing `initialized` notification | Send `initialized` before other requests |
| Connection refused | Firewall, wrong host | Verify with `telnet localhost 2087` |

## References

- [LSP 3.17 Specification](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/)
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)
- [Language Server Protocol Overview](https://microsoft.github.io/language-server-protocol/overviews/lsp/overview/)
- [Cloudflare Workers Sockets API](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)

## Power User Tips

1. **Parallel capability checking** — Connect to multiple servers simultaneously to compare capabilities
2. **Custom rootUri** — Use project-specific URIs for workspace-aware features
3. **Timeout tuning** — Increase timeout for slow servers (Java, Eclipse JDT can take 5-10s to initialize)
4. **Capability filtering** — Parse `capabilities` to enable/disable UI features dynamically
5. **Diagnostic streaming** — Keep connection open to receive real-time diagnostics
6. **Performance testing** — Measure `latencyMs` and `rtt` to benchmark server responsiveness

## Known Limitations

- **PortOfCall LSP client** is a diagnostic tool, not a full-featured editor client
- Does not maintain persistent connections (each request opens a new socket)
- No support for incremental text synchronization (sends full document content)
- No workspace folder management
- No configuration or settings synchronization
- Hover and completion are tested at position (0,0) only

For production use, integrate a full LSP client library like [vscode-languageserver-node](https://github.com/microsoft/vscode-languageserver-node).
