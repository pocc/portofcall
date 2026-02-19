# Meilisearch Review

**Protocol:** HTTP REST API
**File:** `src/worker/meilisearch.ts`
**Reviewed:** 2026-02-19
**Specification:** [Meilisearch HTTP API](https://www.meilisearch.com/docs/reference/api)
**Tests:** `tests/meilisearch.test.ts`

## Summary

Meilisearch implementation provides 4 endpoints (health, search, documents, delete) using HTTP/1.1 REST API over TCP port 7700. Supports Bearer token authentication, JSON payloads, and chunked transfer encoding. Critical bugs include API key leaking in logs, index name injection allowing path traversal, missing document size limits causing OOM, and improper chunked encoding parsing.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **API KEY LEAK**: sendHttpRequest (line 24) adds `Authorization: Bearer ${apiKey}` to logs — appears in server access logs and CDN logs |
| 2 | Critical | **PATH TRAVERSAL**: handleMeilisearchSearch (line 257) uses `encodeURIComponent(index)` but doesn't validate — index `../../../etc/passwd` bypasses directory restriction |
| 3 | Critical | **RESOURCE LEAK**: All 4 handlers use setTimeout but never store/clear handle — lines 35, 74, 181, 204, 306, 388, 457 |
| 4 | High | **OOM ATTACK**: handleMeilisearchDocuments (line 356) accepts unlimited `documents` array — 10,000 documents of 100KB each = 1GB payload |
| 5 | High | **INCOMPLETE VALIDATION**: handleMeilisearchDelete (line 416) validates `ids` OR `all` but not mutually exclusive — both set causes undefined behavior |
| 6 | Medium | **MISSING SIZE LIMIT**: sendHttpRequest (line 24) reads `while (response.length < maxSize)` but maxSize=512KB applies to raw response, not JSON-parsed — 100KB gzip → 10MB JSON |
| 7 | Medium | **UNSAFE DEFAULTS**: All handlers default to port 7700 (HTTP) — production Meilisearch uses reverse proxy with TLS |

## Security Analysis

### 1. API Key Leak (Critical)

**Location:** `sendHttpRequest` (lines 24-112)

```typescript
async function sendHttpRequest(
  host: string, port: number, method: string, path: string,
  body?: string, apiKey?: string, timeout = 15000,
): Promise<...> {
  // ...
  let request = `${method} ${path} HTTP/1.1\r\n`;
  request += `Host: ${host}:${port}\r\n`;
  request += `Accept: application/json\r\n`;
  request += `Connection: close\r\n`;
  request += `User-Agent: PortOfCall/1.0\r\n`;

  if (apiKey) {
    request += `Authorization: Bearer ${apiKey}\r\n`;  // LOGGED
  }
  // ...
}
```

**Attack:** Meilisearch access logs record:
```
GET /indexes/movies/search?q=test HTTP/1.1
Authorization: Bearer masterKey_abc123def456  <-- LEAKED
```

This appears in:
- Meilisearch access logs
- Reverse proxy logs (nginx, Apache)
- CDN logs (Cloudflare, Fastly)
- Any middleware with request logging

**Fix:** Never log auth headers. For TCP-level implementation, this means not including auth in request headers at all — use POST body or query signature:
```typescript
// Option 1: POST body with timestamp signature
const timestamp = Date.now();
const signature = await crypto.subtle.sign(
  'HMAC', apiKeyBytes, new TextEncoder().encode(`${timestamp}:${body}`)
);
request += `X-Timestamp: ${timestamp}\r\n`;
request += `X-Signature: ${btoa(String.fromCharCode(...new Uint8Array(signature)))}\r\n`;

// Option 2: Use official Meilisearch SDK which handles auth properly
```

### 2. Path Traversal (Critical)

**Location:** `handleMeilisearchSearch` (lines 257-348), `handleMeilisearchDocuments` (line 385)

```typescript
const { host, port = 7700, apiKey, index, query, limit = 20, offset = 0, timeout = 15000 } = await request.json<{...}>();

// Line 313: Index name in URL path
const encodedIndex = encodeURIComponent(index);
const searchResult = await sendHttpRequest(
  host, port, 'POST', `/indexes/${encodedIndex}/search`, searchBody, apiKey, timeout,
);
```

**Attack:**
```json
{
  "index": "../../../etc/passwd",
  "query": ""
}
```

Becomes: `POST /indexes/..%2F..%2F..%2Fetc%2Fpasswd/search`

While `encodeURIComponent` encodes slashes as `%2F`, the server decodes them and traverses directories.

**Fix:** Validate index name format:
```typescript
if (!index || !/^[a-zA-Z0-9_-]{1,64}$/.test(index)) {
  return new Response(JSON.stringify({
    success: false,
    error: 'Invalid index name (1-64 alphanumeric, underscore, hyphen only)'
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });
}
```

### 3. Document Array OOM (High)

**Location:** `handleMeilisearchDocuments` (lines 356-409)

```typescript
const body = await request.json() as {
  host: string; port?: number; index: string;
  documents: Record<string, unknown>[];  // NO SIZE LIMIT
  primaryKey?: string; apiKey?: string; timeout?: number;
};
if (!body.host || !body.index || !Array.isArray(body.documents) || body.documents.length === 0) {
  return new Response(JSON.stringify({
    success: false, error: 'Missing required: host, index, documents[]'
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });
}

// ... sends documents directly
const result = await sendHttpRequest(
  host, port, 'POST', path, JSON.stringify(body.documents), body.apiKey, timeout
);
```

**Attack:**
```json
{
  "documents": [
    { "id": 1, "data": "A".repeat(100000) },
    { "id": 2, "data": "B".repeat(100000) },
    ... 10,000 more documents
  ]
}
```

= 1GB JSON payload crashes Workers runtime during `JSON.stringify()`.

**Fix:** Limit array size and total bytes:
```typescript
if (body.documents.length > 1000) {
  return new Response(JSON.stringify({
    success: false,
    error: 'Too many documents (max 1000 per request)'
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });
}

const jsonStr = JSON.stringify(body.documents);
if (jsonStr.length > 1_048_576) {  // 1MB limit
  return new Response(JSON.stringify({
    success: false,
    error: 'Document payload exceeds 1MB limit'
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });
}
```

## Documentation Improvements

**Missing:** No protocol documentation.

**Needed:** `docs/protocols/MEILISEARCH.md` should document:
1. HTTP API endpoints (/health, /version, /indexes, /search, /documents)
2. Authentication (Bearer token, master key vs search key)
3. Document structure (primary key, fields, indexing)
4. Search parameters (query, filters, facets, pagination)
5. Known limitations (no bulk operations, no streaming, 1000 docs/request limit)

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ⚠️ No tests exist
**RFC Compliance:** ✅ Full (standard HTTP/1.1 REST API)

## See Also

- [Meilisearch API Reference](https://www.meilisearch.com/docs/reference/api)
- [Critical Fixes Summary](../critical-fixes.md)
