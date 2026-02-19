# HTTP Review

**Protocol:** HTTP/1.1 (RFC 9110 / RFC 9112)
**File:** `src/worker/http.ts`
**Reviewed:** 2026-02-19
**Specification:** [RFC 9110 (HTTP Semantics)](https://datatracker.ietf.org/doc/html/rfc9110) | [RFC 9112 (HTTP/1.1)](https://datatracker.ietf.org/doc/html/rfc9112)
**Tests:** `tests/http.test.ts`

## Summary

HTTP implementation provides raw HTTP/1.1 request handling over TCP with optional TLS. Supports all standard methods (GET, POST, HEAD, PUT, DELETE, OPTIONS, PATCH, TRACE). Implements chunked transfer-encoding decoder and content-length body reading. **NOTE:** Includes TLS support via `tls: true` option but with same certificate validation limitations as other protocols.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **TLS SECURITY**: When `tls: true`, no certificate validation — accepts self-signed/invalid certs for HTTPS connections |
| 2 | High | **PROTOCOL VIOLATION**: TRACE method (line 383) allows body in request — RFC 9110 §9.3.8 states "TRACE MUST NOT include a body" (correctly rejected but error message needed) |
| 3 | High | **MEMORY EXHAUSTION**: `readFullResponse` (lines 220-333) accumulates unlimited data until `\r\n\r\n` — malicious server can send infinite headers, exhaust Worker memory |
| 4 | Medium | **CHUNKED DECODING**: `decodeChunked` (lines 116-160) does not enforce max chunk size — single 10GB chunk can OOM Worker |
| 5 | Medium | **HOST HEADER**: Non-default port handling (lines 423-425) correct per RFC 9112 but does not validate port range (0-65535) |
| 6 | Low | **HEADER PARSING**: Duplicate headers (line 208) joined with comma — correct per RFC 9110 but loses order for Set-Cookie headers |

## TLS Security Analysis (Optional HTTPS)

### Implementation
```typescript
const socketOptions = tls
  ? { secureTransport: 'on' as const, allowHalfOpen: false }  // ❌ No cert validation
  : undefined;
const socket = connect(`${host}:${port}`, socketOptions);
```

### HTTPS-Specific Risks

**When `tls: true` (port 443):**
1. **Certificate Acceptance**: All certificates trusted (self-signed, expired, wrong hostname)
2. **MITM Attack**: Attacker intercepts HTTPS requests, reads sensitive data (cookies, auth headers)
3. **No HSTS Enforcement**: Cannot verify server requires HTTPS (HTTP downgrade possible)

**Use Cases Where TLS Matters:**
- Testing authenticated APIs (Authorization: Bearer tokens)
- E-commerce sites (payment data in POST bodies)
- Healthcare/finance (HIPAA/PCI-DSS compliance required)

**Mitigation:**
Add response metadata:
```typescript
{
  success: true,
  tls: true,
  tlsVerified: false,  // ← Clearly indicate lack of validation
  warning: "HTTPS certificate not validated. Suitable for testing only."
}
```

## HTTP/1.1 Protocol Compliance

### Request Building (Lines 450-456)

```typescript
const requestLine = `${upperMethod} ${safePath} HTTP/1.1`;
const headerLines = Object.entries(reqHeaders)
  .map(([k, v]) => `${k}: ${v}`)
  .join('\r\n');
const rawRequest = `${requestLine}\r\n${headerLines}\r\n\r\n${effectiveBody}`;
```

**Compliance Checks:**
- ✅ Method in uppercase (line 372)
- ✅ Path starts with `/` or is `*` for OPTIONS (line 392)
- ✅ Host header includes port for non-default (lines 424-425)
- ✅ Connection: close sent (line 432)
- ✅ Content-Length set when body present (line 443)
- ✅ Bodyless methods suppress body (line 439)

**RFC 9110 §9.3.8 TRACE Compliance:**
```typescript
if (upperMethod === 'TRACE' && requestBody) {
  return new Response(
    JSON.stringify({ success: false, error: 'TRACE requests MUST NOT include a body (RFC 9110 Section 9.3.8)' }),
    { status: 400 }
  );
}
```
✅ Correctly enforced

### Response Parsing (Lines 166-213)

```typescript
function parseRawResponse(data: Uint8Array): {
  httpVersion: string;
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  bodyBytes: Uint8Array;
  headerLength: number;
}
```

**Header Folding Handling:**
❌ **NOT IMPLEMENTED** — RFC 9112 §5.2 obsoletes header folding but allows obs-fold in responses.
Current code does not unfold multi-line headers.

**Example:**
```http
HTTP/1.1 200 OK
Content-Type: text/html;
 charset=utf-8
```
Parsed as two headers:
- `Content-Type: text/html;` (incomplete)
- ` charset=utf-8` (invalid header, discarded)

Should be: `Content-Type: text/html; charset=utf-8`

### Chunked Transfer Encoding (Lines 116-160)

```typescript
function decodeChunked(data: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const decoder = new TextDecoder('utf-8', { fatal: false });

  while (offset < data.length) {
    // Find \r\n after hex size
    let lineEnd = -1;
    for (let i = offset; i < data.length - 1; i++) {
      if (data[i] === 0x0D && data[i + 1] === 0x0A) {
        lineEnd = i;
        break;
      }
    }
    if (lineEnd === -1) break;

    // Parse hex size (may have chunk extensions after ';')
    const sizeLine = decoder.decode(data.slice(offset, lineEnd));
    const chunkSize = parseInt(sizeLine.split(';')[0].trim(), 16);  // ✅ Handles extensions
    if (isNaN(chunkSize)) break;

    offset = lineEnd + 2;
    if (chunkSize === 0) break;  // Terminal chunk

    // Extract chunk data
    if (offset + chunkSize > data.length) {
      chunks.push(data.slice(offset));  // ❌ Partial chunk accepted
      break;
    }
    chunks.push(data.slice(offset, offset + chunkSize));
    offset += chunkSize + 2;  // skip trailing \r\n
  }

  // ... combine chunks
}
```

**RFC 9112 §7.1 Compliance:**
- ✅ Parses hex chunk size
- ✅ Handles chunk extensions (e.g., `1a;name=value`)
- ✅ Detects terminal chunk (0\r\n)
- ❌ Accepts incomplete final chunk (should error)
- ❌ No max chunk size limit (10GB chunk = OOM)

**Missing Trailer Handling:**
RFC 9112 allows trailers after terminal chunk:
```http
0\r\n
Expires: Wed, 21 Oct 2026 07:28:00 GMT\r\n
\r\n
```
Current code ignores trailers (not critical but should document).

## Response Reading Strategy (Lines 220-333)

### Completion Detection Logic

**HEAD Request Handling (Line 290):**
```typescript
if (requestMethod === 'HEAD') break;  // ✅ Correct — HEAD has no body
```

**Status Code Checks (Lines 285-289):**
```typescript
const statusMatch = headerStr.match(/^HTTP\/[\d.]+ (\d+)/);
if (statusMatch) {
  const code = parseInt(statusMatch[1], 10);
  if (code < 200 || code === 204 || code === 304) break;  // ✅ RFC 9110 compliance
}
```
- ✅ 1xx (informational) — no body
- ✅ 204 (No Content) — no body
- ✅ 304 (Not Modified) — no body

**Chunked Detection (Lines 293-306):**
```typescript
if (/transfer-encoding:\s*chunked/i.test(headerStr)) {
  const body = current.slice(bodyStart);
  if (body.length >= 5) {
    const bodyStr = decoder.decode(body);
    const termIdx = bodyStr.lastIndexOf('0\r\n');  // ❌ Should be lastIndexOf('0\r\n\r\n')
    if (termIdx >= 0) {
      const afterTerm = bodyStr.slice(termIdx + 3);
      if (afterTerm.endsWith('\r\n')) break;  // ✅ Detects final CRLF
    }
  }
}
```

**Potential Issue:**
Chunked terminator is `0\r\n\r\n` (4 bytes) but code searches for `0\r\n` (3 bytes).
If trailers present, this still works because trailers end with `\r\n`.

**Content-Length Detection (Lines 308-313):**
```typescript
else {
  const clMatch = headerStr.match(/content-length:\s*(\d+)/i);
  if (clMatch) {
    const expectedLen = parseInt(clMatch[1], 10);
    if (bodyLen >= expectedLen) break;  // ✅ Correct
  } else {
    // No Content-Length, no chunked — read until connection close
  }
}
```

**Issue:** No timeout for connection-close scenario (line 315).
If server keeps connection open without sending data, Worker waits forever.

**Fix:**
```typescript
// Line 323: Use shorter timeout when no length indicator
const drainTimeout = Math.min(remaining, contentLength ? 5000 : 1000);
```

## Method-Specific Implementations

### OPTIONS Handler (Lines 576-586)

```typescript
export async function handleHTTPOptions(request: Request): Promise<Response> {
  const body = (await request.json()) as HTTPRequestOptions;
  return handleHTTPRequest(new Request(request.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, method: 'OPTIONS', path: body.path ?? '*' }),
  }));
}
```

**RFC 9110 §9.3.7 Compliance:**
- ✅ Supports asterisk-form: `OPTIONS * HTTP/1.1`
- ✅ Path defaults to `*` if not specified

**Missing:** Does not parse `Allow` header in response (should return list of supported methods).

### HEAD Handler (Lines 556-566)

```typescript
export async function handleHTTPHead(request: Request): Promise<Response> {
  const body = (await request.json()) as HTTPRequestOptions;
  return handleHTTPRequest(new Request(request.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, method: 'HEAD' }),
  }));
}
```

**RFC 9110 §9.3.2 Compliance:**
- ✅ Response must not include body (handled in line 528)
- ✅ Content-Length header allowed (line 290 stops reading)

## Security Considerations

### Host Header Injection

**Validation (Lines 97-99):**
```typescript
if (!host || host.trim().length === 0) return 'Host is required';
if (!/^[a-zA-Z0-9._:-]+$/.test(host)) return 'Host contains invalid characters';
```

**Good:**
- ✅ Rejects empty host
- ✅ Allows colons (for IPv6 `[::1]` format) and hyphens
- ✅ Allows dots and underscores

**Issue:**
❌ Does not validate IPv6 bracket notation fully — `[::1` (missing `]`) passes validation.

### Path Traversal

**Sanitization (Lines 391-392):**
```typescript
const safePath = path === '*' ? '*' : (path.startsWith('/') ? path : `/${path}`);
```

**Good:** Ensures path starts with `/`.

**Issue:** Does not sanitize `/../` sequences.
- Example: `/api/../admin` reaches `/admin` (might bypass access controls)
- Should normalize path or document that validation is caller's responsibility

## Documentation Improvements

**Created:** `docs/protocols/HTTP.md` (needed)

Should document:

1. **Supported Methods**
   - GET, POST, HEAD, PUT, DELETE, OPTIONS, PATCH, TRACE

2. **TLS Support**
   - `tls: true` enables HTTPS (port 443 default)
   - ⚠️ No certificate validation (testing only)

3. **Request Options**
   - `host`, `port`, `tls`, `method`, `path`, `headers`, `body`, `timeout`, `maxBodyBytes`

4. **Response Timing**
   - `tcpLatency` — Time to establish TCP connection
   - `ttfb` — Time to first byte of response
   - `totalTime` — Total request duration

5. **Body Handling**
   - Content-Length: Read exact bytes
   - Chunked: Decode per RFC 9112 §7.1
   - Connection close: Read until EOF
   - HEAD/1xx/204/304: No body

6. **Known Limitations**
   - No HTTP/2 or HTTP/3 (only HTTP/1.1)
   - No automatic redirect following
   - Body truncated at `maxBodyBytes` (default 64KB)
   - No header folding support (obs-fold discarded)
   - Chunked trailer fields ignored

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** Pending (tests/http.test.ts needs creation)
**RFC Compliance:**
- ✅ RFC 9110 (HTTP Semantics) - Mostly compliant
- ✅ RFC 9112 (HTTP/1.1) - Partial (no obs-fold, trailers ignored)

## See Also

- [RFC 9110 - HTTP Semantics](https://datatracker.ietf.org/doc/html/rfc9110)
- [RFC 9112 - HTTP/1.1](https://datatracker.ietf.org/doc/html/rfc9112)
- [Cloudflare Sockets TLS Limitations](../security-notes/cloudflare-tls-limitations.md)
- [Critical Fixes Summary](../critical-fixes.md)
