# CouchDB Review

**Protocol:** HTTP REST API
**File:** `src/worker/couchdb.ts`
**Reviewed:** 2026-02-19
**Specification:** [Apache CouchDB HTTP API](https://docs.couchdb.org/en/stable/api/)
**Tests:** `tests/couchdb.test.ts`

## Summary

CouchDB implementation provides 2 endpoints (health, query) using HTTP/1.1 REST API over TCP port 5984. Supports GET/POST/PUT/DELETE/COPY methods, Basic Auth, and chunked transfer encoding. Critical bugs include credentials leaking in Authorization header (not properly encoded), HTTP request smuggling via CRLF injection in path parameter, missing response size limits causing OOM, and improper chunked encoding parser allowing cache poisoning.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **HEADER INJECTION**: handleCouchDBQuery (line 319) allows CRLF in `path` param — `path: "/_all_dbs\r\nX-Admin: true"` injects arbitrary headers |
| 2 | Critical | **AUTH LEAK**: buildAuthHeader (line 200) uses `btoa(username:password)` without validating colons in username — `username: "admin:fake"` creates invalid auth |
| 3 | Critical | **RESOURCE LEAK**: No timeout handles cleared — `setTimeout` at lines 70, 109, 181 never stored or cleared |
| 4 | High | **BUFFER OVERFLOW**: sendHttpRequest (line 59) reads unlimited response — `while (response.length < maxSize)` accumulates 512KB but malicious server can fragment to bypass limit |
| 5 | High | **CACHE POISONING**: decodeChunked (line 159) accepts chunk extensions — `a;inject=evil\r\n` parses as size 10 but header is cached by intermediaries |
| 6 | High | **METHOD CONFUSION**: handleCouchDBQuery (line 350) allows COPY method but sendHttpRequest doesn't handle Destination header — COPY silently fails |
| 7 | Medium | **MISSING VALIDATION**: validateInput (line 210) rejects `Host` with invalid chars but allows localhost, 127.0.0.1 — enables SSRF to internal services |
| 8 | Medium | **INCOMPLETE PARSING**: decodeChunked (line 159) stops on invalid size but doesn't clear buffered data — partial response leaks to next request |

## Security Analysis

### 1. CRLF Injection (Critical)

**Location:** `handleCouchDBQuery` (lines 319-417)

```typescript
const {
  host, port = 5984, path = '/', method = 'GET',
  body: queryBody, username, password, timeout = 15000,
} = reqBody;

// Line 374: Path sent raw
const normalizedPath = path.startsWith('/') ? path : `/${path}`;
const result = await sendHttpRequest(
  host, port, upperMethod, normalizedPath, queryBody, authHeader, timeout,
);
```

**Attack:**
```json
{
  "path": "/_all_dbs\r\nX-Admin: true\r\nX-Override: ",
  "method": "GET"
}
```

Becomes:
```http
GET /_all_dbs
X-Admin: true
X-Override:  HTTP/1.1
Host: example.com:5984
...
```

**Fix:** Reject paths containing CR/LF:
```typescript
if (path.includes('\r') || path.includes('\n')) {
  return new Response(JSON.stringify({
    success: false, error: 'Path contains invalid characters (CRLF)'
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });
}
```

### 2. Chunked Encoding Cache Poisoning (High)

**Location:** `decodeChunked` (lines 159-191)

```typescript
function decodeChunked(data: string): string {
  let result = '';
  let remaining = data;

  while (remaining.length > 0) {
    const lineEnd = remaining.indexOf('\r\n');
    if (lineEnd === -1) break;

    // Strip any chunk extensions (e.g., "a;ext=val" -> "a")
    let sizeStr = remaining.substring(0, lineEnd).trim();
    const semiIdx = sizeStr.indexOf(';');
    if (semiIdx !== -1) {
      sizeStr = sizeStr.substring(0, semiIdx).trim();  // Strips extensions
    }

    const chunkSize = parseInt(sizeStr, 16);
    if (isNaN(chunkSize) || chunkSize === 0) break;
    // ... continues processing
  }
  return result;
}
```

**Attack:** Malicious server sends:
```
5;name=<script>alert(1)</script>\r\n
HELLO\r\n
0\r\n
\r\n
```

The chunk extension `name=<script>` is stripped during parsing but cached by intermediate proxies (Cloudflare, nginx) that honor extensions. Later requests from other users receive the poisoned extension as part of the response.

**Fix:** Reject chunk extensions entirely:
```typescript
if (sizeStr.includes(';')) {
  throw new Error('Chunk extensions not supported (security risk)');
}
```

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ⚠️ No tests exist
**RFC Compliance:** Partial (HTTP/1.1 + CouchDB API but missing COPY, HEAD, OPTIONS)

## See Also

- [CouchDB HTTP API Docs](https://docs.couchdb.org/en/stable/api/)
- [RFC 7230 Chunked Encoding](https://tools.ietf.org/html/rfc7230#section-4.1)
- [Critical Fixes Summary](../critical-fixes.md)
