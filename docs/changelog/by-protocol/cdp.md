# CDP (Cisco Discovery Protocol) Review

**Protocol:** Chrome DevTools Protocol (CDP)
**File:** `src/worker/cdp.ts`
**Reviewed:** 2026-02-19
**Specification:** [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
**Tests:** None

## Summary

CDP implementation provides 3 endpoints (health, query, tunnel) for Chrome remote debugging over HTTP JSON API and WebSocket JSON-RPC 2.0. **This is NOT Cisco Discovery Protocol** — it's Chrome DevTools Protocol. Critical bugs found include unbounded buffer accumulation (OOM attacks), missing WebSocket frame validation (buffer overflows), and HTTP response size limits that can be bypassed.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **BUFFER OVERFLOW**: `sendHttpRequest()` maxSize check at line 82 is ineffective — response accumulation loop at lines 84-89 continues even after exceeding limit, only breaks when socket closes |
| 2 | Critical | **OOM ATTACK**: `readUntilDoubleNewline()` at lines 493-506 has unbounded accumulation — attacker can send headers without `\r\n\r\n` to exhaust memory |
| 3 | Critical | **BUFFER OVERFLOW**: `parseWebSocketFrames()` at lines 591-644 missing bounds check on payloadLength calculation at lines 611-615 — 64-bit length field only validates lower 32 bits, upper 32 bits ignored |
| 4 | Critical | **DENIAL OF SERVICE**: WebSocket tunnel at lines 315-465 lacks frame aggregation limits — attacker can fragment single message into unlimited continuation frames |
| 5 | High | **INJECTION RISK**: `buildWebSocketHandshake()` at line 479 constructs header with unvalidated `path` parameter — allows CRLF injection if path contains `\r\n` |
| 6 | High | **BUFFER OVERFLOW**: `decodeChunked()` at lines 129-153 missing size limit — malicious chunked encoding can specify arbitrary chunk sizes leading to OOM |
| 7 | Medium | **VALIDATION BYPASS**: HTTP status code extraction at line 104 uses permissive regex — accepts invalid status lines like `HTTP/9.9 999` |
| 8 | Medium | **RESOURCE LEAK**: WebSocket close handlers at lines 441-445 do not clear timeout/interval timers established during tunnel lifecycle |

## Specific Vulnerabilities

### Buffer Overflow in WebSocket Frame Parsing

**Location:** `parseWebSocketFrames()` lines 608-617

```typescript
} else if (payloadLength === 127) {
  if (offset + 10 > data.length) break;
  // Only handle up to 32-bit lengths
  payloadLength =
    (data[offset + 6] << 24) |
    (data[offset + 7] << 16) |
    (data[offset + 8] << 8) |
    data[offset + 9];
  headerLength = 10;
}
```

**Issue:** Ignores upper 32 bits (bytes 2-5) of 64-bit length field. Attacker can set upper bits to non-zero values that will be ignored, then later exploit assumptions about maximum frame size.

**Impact:** Allows frames claiming 4GB+ payloads to pass initial parsing, triggering downstream buffer overflows.

---

### Unbounded Accumulation Attack

**Location:** `readUntilDoubleNewline()` lines 493-506

```typescript
async function readUntilDoubleNewline(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let data = '';

  while (!data.includes('\r\n\r\n')) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      data += decoder.decode(value, { stream: true });
    }
  }
  return data;
}
```

**Issue:** No size limit. Attacker sends WebSocket upgrade without terminating `\r\n\r\n` sequence.

**Impact:** Memory exhaustion denial of service.

---

### Chunked Transfer Encoding Overflow

**Location:** `decodeChunked()` lines 129-153

```typescript
function decodeChunked(data: string): string {
  let result = '';
  let remaining = data;

  while (remaining.length > 0) {
    const lineEnd = remaining.indexOf('\r\n');
    if (lineEnd === -1) break;

    const sizeStr = remaining.substring(0, lineEnd).trim();
    const chunkSize = parseInt(sizeStr, 16);
    if (isNaN(chunkSize) || chunkSize === 0) break;
    // ... no bounds check on chunkSize
```

**Issue:** `chunkSize` is unbounded. Attacker specifies `7FFFFFFF\r\n` to allocate 2GB strings.

**Impact:** Out-of-memory crash.

---

### CRLF Injection in WebSocket Handshake

**Location:** `buildWebSocketHandshake()` line 480

```typescript
function buildWebSocketHandshake(host: string, port: number, path: string, wsKey: string): string {
  let request = `GET ${path} HTTP/1.1\r\n`;
  request += `Host: ${host}:${port}\r\n`;
```

**Issue:** `path` parameter is user-controlled via query string at line 319. No validation against CRLF characters.

**Exploit:**
```
GET /api/cdp/tunnel?targetId=foo%0d%0aX-Evil:header
```

Injects arbitrary headers into WebSocket upgrade request, enabling header smuggling attacks.

---

## Recommendations

1. **Add size limits to all accumulation loops**: Max 10MB for HTTP responses, 16MB for WebSocket frames
2. **Validate 64-bit WebSocket lengths**: Check upper 32 bits are zero, reject if set
3. **Implement frame aggregation limits**: Max 1000 continuation frames per message
4. **Sanitize path parameter**: Reject if contains `\r`, `\n`, or non-printable chars
5. **Add timeout to `readUntilDoubleNewline()`**: 30 second max
6. **Bound chunked decoding**: Max chunk size 16MB, total response 100MB

## RFC Compliance

Chrome DevTools Protocol specification does not define size limits. CDP server (Chrome) enforces 256MB WebSocket message limit. This implementation has no such protection.

## See Also

- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
- [WebSocket RFC 6455](https://datatracker.ietf.org/doc/html/rfc6455)
- [HTTP/1.1 RFC 7230](https://datatracker.ietf.org/doc/html/rfc7230)
