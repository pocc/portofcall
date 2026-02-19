# Apache Solr — Power User Reference

**Default Port:** 8983 | **Protocol:** HTTP REST API over TCP | **Source:** `src/worker/solr.ts`

Port of Call implements four Apache Solr endpoints using raw TCP sockets for HTTP/1.1 communication. No third-party HTTP client — pure socket-level REST API calls to Solr's HTTP interface on port 8983.

**Compatible servers:** Apache Solr 4.x through 9.x, SolrCloud collections. Any Solr instance exposing the standard HTTP REST API.

---

## Apache Solr Default Ports

| Port  | Protocol           | Used By                                    |
|-------|--------------------|-------------------------------------------|
| 8983  | HTTP (REST API)    | `/health`, `/query`, `/index`, `/delete`  |
| 8984  | HTTPS (optional)   | Not implemented                           |
| 9983  | ZooKeeper          | Not implemented                           |

---

## API Endpoints

### `POST /api/solr/health` — System info and core discovery

Retrieves Solr system information and lists all available cores/collections. Makes two requests: `GET /solr/admin/info/system` for version/JVM info, then `GET /solr/admin/cores?action=STATUS` for core listing.

**Request:**

| Field      | Type   | Default | Notes                                |
|------------|--------|---------|--------------------------------------|
| `host`     | string | required| Validated: `[a-zA-Z0-9._-]+`        |
| `port`     | number | `8983` | Range: 1-65535                       |
| `username` | string | --      | Basic Auth username (optional)       |
| `password` | string | --      | Basic Auth password (optional)       |
| `timeout`  | number | `15000` | ms (shared timeout for both requests)|

**Success (200):**

```json
{
  "success": true,
  "statusCode": 200,
  "version": "9.5.0",
  "systemInfo": {
    "lucene": {
      "solr-spec-version": "9.5.0",
      "solr-impl-version": "9.5.0 abc123def - user - 2024-01-15",
      "lucene-spec-version": "9.9.1",
      "lucene-impl-version": "9.9.1 xyz789abc - user - 2024-01-15"
    },
    "jvm": {
      "version": "17.0.10 (OpenJDK 64-Bit Server VM)",
      "memory": { "free": "512M", "total": "1G", "max": "2G" }
    },
    "system": {
      "name": "Linux",
      "version": "5.15.0-91-generic",
      "arch": "amd64"
    },
    "node": "solr-node-1:8983_solr",
    "uptime": "2 days, 14:32:10"
  },
  "cores": [
    "collection1",
    "logs",
    "products",
    "search"
  ],
  "latencyMs": 67
}
```

**When cores endpoint requires auth:**

```json
{
  "success": true,
  "statusCode": 200,
  "version": "8.11.2",
  "systemInfo": { ... },
  "cores": undefined,
  "latencyMs": 45
}
```

The `cores` field is `undefined` if the cores STATUS endpoint returned non-200 or failed to parse (typically due to missing authentication).

**Error (500):**

```json
{
  "success": false,
  "error": "Connection timeout"
}
```

**Fields:**

| Field | Notes |
|-------|-------|
| `version` | Extracted from `lucene['solr-spec-version']` in system info response. Defaults to `"Unknown"` if not found. |
| `systemInfo` | Raw JSON response from `/solr/admin/info/system?wt=json`. If JSON parsing fails, contains the raw response string. |
| `cores` | Array of core names from `/solr/admin/cores?action=STATUS`. Keys from `status` object. `undefined` if endpoint fails. |
| `latencyMs` | Total time for both requests (system info + cores listing). |

**Wire protocol sequence:**

```
Client → Server: GET /solr/admin/info/system?wt=json HTTP/1.1
Server → Client: 200 OK (JSON body with version, JVM, OS info)

Client → Server: GET /solr/admin/cores?action=STATUS&wt=json HTTP/1.1
Server → Client: 200 OK (JSON body with cores map) OR 401 Unauthorized
```

---

### `POST /api/solr/query` — Execute search query

Sends a CQL-style query to a specific Solr core using the `/select` handler (or custom handler). Returns both raw response body and parsed JSON.

**Request:**

| Field      | Type                  | Default    | Notes                                          |
|------------|-----------------------|------------|------------------------------------------------|
| `host`     | string                | required   | Validated: `[a-zA-Z0-9._-]+`                  |
| `port`     | number                | `8983`     | Range: 1-65535                                 |
| `core`     | string                | required   | Core/collection name. Validated: `[a-zA-Z0-9._-]+`, no `..`, `/`, `\` |
| `query`    | string                | `"*:*"`    | Solr query string (e.g., `title:apache`, `name:solr AND status:active`) |
| `handler`  | string                | `"/select"`| Request handler path. Validated: no `..` path traversal |
| `params`   | Record<string,string> | `{}`       | Additional query parameters (e.g., `{"rows": "10", "fl": "id,title"}`) |
| `username` | string                | --         | Basic Auth username                            |
| `password` | string                | --         | Basic Auth password                            |
| `timeout`  | number                | `15000`    | ms                                             |

**Success (200):**

```json
{
  "success": true,
  "statusCode": 200,
  "body": "{\"responseHeader\":{\"status\":0,\"QTime\":3},\"response\":{\"numFound\":42,\"start\":0,\"docs\":[{\"id\":\"1\",\"title\":\"Apache Solr\"}]}}",
  "parsed": {
    "responseHeader": {
      "status": 0,
      "QTime": 3
    },
    "response": {
      "numFound": 42,
      "start": 0,
      "docs": [
        {
          "id": "1",
          "title": "Apache Solr",
          "description": "Open source search platform"
        }
      ]
    }
  },
  "latencyMs": 12
}
```

**Error (400) — Invalid core name:**

```json
{
  "success": false,
  "error": "Core name contains invalid path characters"
}
```

**Error (500) — Query execution failed:**

```json
{
  "success": false,
  "error": "Connection timeout"
}
```

**Fields:**

| Field | Notes |
|-------|-------|
| `body` | Raw HTTP response body as string. May be JSON, XML, CSV depending on `wt` parameter. |
| `parsed` | Parsed JSON object if body is valid JSON. `null` if parsing fails. |
| `latencyMs` | Query execution time in ms. |

**Common query parameters:**

| Param | Default | Notes |
|-------|---------|-------|
| `q` | `*:*` | Query string. Always set by implementation. |
| `wt` | `json` | Response format. Always set to `json` by implementation. |
| `rows` | `10` | Number of results. Set via `params`. |
| `start` | `0` | Pagination offset. Set via `params`. |
| `fl` | `*` | Field list (comma-separated). Set via `params`. |
| `fq` | -- | Filter query. Set via `params` (can be array via multiple `fq` keys). |
| `sort` | -- | Sort order (e.g., `score desc`, `date asc`). Set via `params`. |

**Example request — paginated search with field filtering:**

```json
{
  "host": "solr.example.com",
  "core": "products",
  "query": "category:electronics AND price:[100 TO 500]",
  "params": {
    "rows": "20",
    "start": "40",
    "fl": "id,name,price,category",
    "sort": "price asc"
  }
}
```

**Wire protocol:**

```
Client → Server: GET /solr/products/select?q=category%3Aelectronics+AND+price%3A%5B100+TO+500%5D&wt=json&rows=20&start=40&fl=id%2Cname%2Cprice%2Ccategory&sort=price+asc HTTP/1.1
Server → Client: 200 OK (JSON body with responseHeader, response.numFound, response.docs[])
```

The `core` name is URL-encoded using `encodeURIComponent()`. Query parameters are assembled using `URLSearchParams` for proper encoding.

---

### `POST /api/solr/index` — Add/update documents

Adds or updates documents in a Solr core using the `/update/json/docs` endpoint. Sends a JSON array of documents. Optionally commits the transaction immediately.

**Request:**

| Field       | Type                       | Default | Notes                                        |
|-------------|----------------------------|---------|----------------------------------------------|
| `host`      | string                     | required| Validated: `[a-zA-Z0-9._-]+`                |
| `port`      | number                     | `8983`  | Range: 1-65535                               |
| `core`      | string                     | required| Validated: `[a-zA-Z0-9._-]+`, no path chars |
| `documents` | Array<Record<string,any>>  | required| At least one document required              |
| `commit`    | boolean                    | `true`  | Whether to commit immediately               |
| `username`  | string                     | --      | Basic Auth username                         |
| `password`  | string                     | --      | Basic Auth password                         |
| `timeout`   | number                     | `15000` | ms                                          |

**Success (200):**

```json
{
  "success": true,
  "host": "solr.example.com",
  "port": 8983,
  "core": "products",
  "documentsIndexed": 3,
  "committed": true,
  "status": 0,
  "qtime": 12,
  "httpStatus": 200,
  "message": "3 document(s) indexed successfully"
}
```

**Error (400) — No documents:**

```json
{
  "success": false,
  "error": "Missing required: host, core, documents[]"
}
```

**Error (500) — Index failed:**

```json
{
  "success": false,
  "host": "solr.example.com",
  "port": 8983,
  "core": "products",
  "documentsIndexed": 2,
  "committed": true,
  "status": 400,
  "qtime": 5,
  "httpStatus": 200,
  "error": "Document [null] missing required field: id"
}
```

**Fields:**

| Field | Notes |
|-------|-------|
| `status` | Solr status code from `responseHeader.status`. `0` = success, non-zero = error. |
| `qtime` | Solr query time in ms from `responseHeader.QTime`. |
| `httpStatus` | HTTP response status code (200, 400, 401, 500, etc.). |
| `committed` | Whether documents were committed to index (`commit=true` or `commit=false` in URL). |

**Example request — index product documents:**

```json
{
  "host": "solr.example.com",
  "core": "products",
  "documents": [
    {
      "id": "prod-123",
      "name": "Wireless Mouse",
      "category": "electronics",
      "price": 29.99,
      "in_stock": true
    },
    {
      "id": "prod-124",
      "name": "USB Keyboard",
      "category": "electronics",
      "price": 49.99,
      "in_stock": false
    }
  ],
  "commit": true
}
```

**Wire protocol:**

```
Client → Server: POST /solr/products/update/json/docs?commit=true HTTP/1.1
                  Content-Type: application/json
                  Content-Length: 234

                  [{"id":"prod-123","name":"Wireless Mouse",...},{"id":"prod-124",...}]

Server → Client: 200 OK

                  {"responseHeader":{"status":0,"QTime":12}}
```

**Commit behavior:**

- `commit: true` (default) — Documents immediately visible in search results. Slower, triggers fsync.
- `commit: false` — Documents staged but not searchable until manual commit. Faster for bulk indexing.

To manually commit after bulk indexing with `commit: false`, send an empty document array with `commit: true` or use `/admin/cores?action=STATUS&core=X&wt=json&commit=true`.

---

### `POST /api/solr/delete` — Delete documents

Deletes documents from a Solr core either by ID list or by query. Uses the `/update` endpoint with JSON delete command.

**Request:**

| Field      | Type      | Default | Notes                                          |
|------------|-----------|---------|------------------------------------------------|
| `host`     | string    | required| Validated: `[a-zA-Z0-9._-]+`                  |
| `port`     | number    | `8983`  | Range: 1-65535                                 |
| `core`     | string    | required| Validated: `[a-zA-Z0-9._-]+`, no path chars   |
| `ids`      | string[]  | --      | Document IDs to delete. Mutually exclusive with `query`. |
| `query`    | string    | --      | Query selecting documents to delete. Mutually exclusive with `ids`. |
| `commit`   | boolean   | `true`  | Whether to commit immediately                  |
| `username` | string    | --      | Basic Auth username                            |
| `password` | string    | --      | Basic Auth password                            |
| `timeout`  | number    | `10000` | ms (note: shorter default than other endpoints)|

**Success (200) — Delete by ID:**

```json
{
  "success": true,
  "host": "solr.example.com",
  "port": 8983,
  "core": "products",
  "deleteMode": "by-id",
  "count": 2,
  "committed": true,
  "status": 0,
  "httpStatus": 200,
  "message": "Delete successful"
}
```

**Success (200) — Delete by query:**

```json
{
  "success": true,
  "host": "solr.example.com",
  "port": 8983,
  "core": "products",
  "deleteMode": "by-query",
  "query": "category:obsolete",
  "committed": true,
  "status": 0,
  "httpStatus": 200,
  "message": "Delete successful"
}
```

**Error (400) — Missing delete criteria:**

```json
{
  "success": false,
  "error": "Missing required: host, core, and either ids[] or query"
}
```

**Fields:**

| Field | Notes |
|-------|-------|
| `deleteMode` | `"by-id"` if `ids` array provided, `"by-query"` if `query` string provided. |
| `count` | Number of IDs in `ids` array. Only present for `deleteMode: "by-id"`. |
| `query` | Query string used for deletion. Only present for `deleteMode: "by-query"`. |

**Example request — delete by ID:**

```json
{
  "host": "solr.example.com",
  "core": "products",
  "ids": ["prod-123", "prod-456", "prod-789"]
}
```

**Example request — delete by query:**

```json
{
  "host": "solr.example.com",
  "core": "logs",
  "query": "timestamp:[* TO NOW-30DAYS]",
  "commit": true
}
```

**Wire protocol — delete by ID:**

```
Client → Server: POST /solr/products/update?commit=true HTTP/1.1
                  Content-Type: application/json

                  {"delete":[{"id":"prod-123"},{"id":"prod-456"},{"id":"prod-789"}]}

Server → Client: 200 OK

                  {"responseHeader":{"status":0,"QTime":8}}
```

**Wire protocol — delete by query:**

```
Client → Server: POST /solr/logs/update?commit=true HTTP/1.1
                  Content-Type: application/json

                  {"delete":{"query":"timestamp:[* TO NOW-30DAYS]"}}

Server → Client: 200 OK

                  {"responseHeader":{"status":0,"QTime":145}}
```

---

## HTTP Implementation Details

### Request format

All endpoints use raw TCP sockets to send HTTP/1.1 requests:

```
GET /solr/{core}/select?q=*:*&wt=json HTTP/1.1
Host: solr.example.com:8983
Accept: application/json
Connection: close
User-Agent: PortOfCall/1.0
Authorization: Basic dXNlcjpwYXNz

```

For POST requests with body:

```
POST /solr/{core}/update/json/docs?commit=true HTTP/1.1
Host: solr.example.com:8983
Accept: application/json
Connection: close
User-Agent: PortOfCall/1.0
Content-Type: application/json
Content-Length: 123

[{"id":"1","title":"Apache Solr"}]
```

**Host header behavior:**
- Port 80: `Host: hostname`
- Port 443: `Host: hostname`
- Other ports: `Host: hostname:port`

### Response parsing

Responses are read until socket closure (due to `Connection: close` header). Maximum response size is 512,000 bytes (512 KB). Responses exceeding this size are truncated.

**Header parsing:**
1. Split at `\r\n\r\n` to separate headers from body
2. Extract HTTP status code from first line: `HTTP/1.1 200 OK`
3. Parse headers into lowercase key-value map
4. If `Transfer-Encoding: chunked`, decode body using chunked transfer encoding

**Chunked transfer encoding:**

Implemented with chunk extension support (`;name=value` after hex size):

```
1a;charset=utf-8\r\n
{"responseHeader":{"status":0}}\r\n
0\r\n
\r\n
```

Decoder strips extensions, validates CRLF after chunk data, accumulates chunks until size `0` terminator.

### Authentication

Basic Auth only. Username and password are base64-encoded as `username:password` and sent in `Authorization: Basic <base64>` header.

**Edge case:** If username is provided without password, password defaults to empty string (`username:` encoded as base64).

### Timeout behavior

Single timeout applies to entire request lifecycle:
1. TCP connection establishment (`socket.opened`)
2. HTTP request write
3. HTTP response read (until socket closure)

If any stage exceeds timeout, request fails with `"Connection timeout"` error.

Timeout handles are properly cleared in `finally` block to prevent resource leaks.

---

## Solr Query Language Primer

Solr uses Lucene query syntax for the `q` parameter:

| Query | Meaning |
|-------|---------|
| `*:*` | Match all documents |
| `title:apache` | Field `title` contains "apache" |
| `title:"apache solr"` | Exact phrase match |
| `title:apache AND category:search` | Boolean AND |
| `title:apache OR title:lucene` | Boolean OR |
| `title:apache NOT category:database` | Boolean NOT |
| `price:[100 TO 500]` | Range query (inclusive) |
| `price:{100 TO 500}` | Range query (exclusive) |
| `date:[NOW-1DAY TO NOW]` | Date math |
| `title:apach*` | Wildcard (prefix) |
| `title:apac?e` | Wildcard (single char) |
| `title:apache~` | Fuzzy search (edit distance) |
| `"apache solr"~5` | Proximity search (within 5 words) |
| `title:apache^2 body:apache` | Boost term (title 2x more important) |

**Special characters requiring escaping:**
`+ - && || ! ( ) { } [ ] ^ " ~ * ? : \ /`

Escape with backslash: `\+`, `\-`, `\(`, `\)`, etc.

---

## Known Limitations and Quirks

### Connection Management

1. **No connection pooling** — Each request opens a new TCP connection and closes after response. For high-throughput scenarios, this creates significant overhead. Solr recommends persistent HTTP/1.1 connections or HTTP/2.

2. **No Keep-Alive** — All requests use `Connection: close`, preventing connection reuse even for back-to-back requests to the same host/core.

3. **Shared timeout** — The timeout applies to connection + request + response reading as a single duration, not separately. A slow connection establishment consumes timeout budget for the query itself.

4. **No TLS/HTTPS support** — Only plain HTTP on port 8983. For Solr instances requiring HTTPS (port 8984), requests will fail.

### Response Handling

5. **512 KB response limit** — Hardcoded `maxSize = 512000`. Responses exceeding this are silently truncated. Large result sets (e.g., `rows=10000` with large documents) may be incomplete. Solr does not send `Content-Length` header for chunked responses, so truncation is undetectable.

6. **No streaming JSON parser** — Entire response body loaded into memory before JSON parsing. Combined with 512 KB limit, this makes large result sets impractical.

7. **Chunked transfer encoding edge case** — Decoder validates CRLF after chunk data but continues on mismatch instead of failing. Malformed chunked responses may produce corrupted output.

8. **No gzip/deflate support** — Even if Solr sends `Content-Encoding: gzip`, body is not decompressed. JSON parsing will fail.

### Input Validation

9. **Core name validation blocks valid chars** — Validation regex `^[a-zA-Z0-9._-]+$` rejects cores with colons (`:`) which are valid in SolrCloud collection names (e.g., `collection1_shard1_replica_n1`).

10. **Handler validation allows most paths** — Only checks for `..` sequences. Absolute paths (`/admin/cores`), double slashes (`//select`), and URL-encoded traversal (`%2e%2e`) are not validated.

11. **Query parameter control characters** — Validation blocks control chars (`\x00-\x1F`, `\x7F`) in param keys/values, but allows Unicode non-printable chars, NULL bytes in UTF-8 form, and CRLF injection via `\r\n` (which becomes `%0D%0A` after `URLSearchParams` encoding).

### Protocol Compliance

12. **No HTTP/2 support** — Only HTTP/1.1. Solr 9.x supports HTTP/2 but this implementation cannot use it.

13. **No Host header normalization** — Host header format is `hostname:port` for all ports except 80/443. This is correct per RFC 7230, but some proxies expect no port for default HTTP port 8983.

14. **No request retries** — Connection failures, timeouts, and 5xx errors are returned as-is. No exponential backoff or retry logic.

### Authentication

15. **Basic Auth only** — No support for:
    - Kerberos (SPNEGO)
    - PKI certificate auth
    - JWT bearer tokens
    - OAuth2

16. **Credentials in cleartext** — Basic Auth sends username/password as base64 (not encrypted). Without TLS, credentials are visible to network observers.

17. **No auth failure detection** — 401 responses are treated identically to other errors. The caller sees `success: false, statusCode: 401` but no hint that credentials are invalid.

### Solr-Specific

18. **No SolrCloud awareness** — Implementation assumes single-node Solr. No ZooKeeper integration, no collection aliases, no shard routing, no replica failover.

19. **Hardcoded `wt=json`** — Response writer is always JSON. Cannot request XML (`wt=xml`), CSV (`wt=csv`), or binary (`wt=javabin`).

20. **No cursor/pagination support** — Deep pagination via `start=10000` can cause OOM on Solr server. Cursor-based pagination (`cursorMark` param) is not implemented.

21. **No faceting/highlighting helpers** — Facet queries (`facet=true`, `facet.field=category`) and highlighting (`hl=true`) must be manually added to `params`. No structured response parsing for facets.

22. **Delete by query success ambiguity** — Solr returns `status: 0` even if query matched zero documents. No way to distinguish "deleted 0 docs" from "deleted 1000 docs" without a separate query for `numFound` before deletion.

23. **Commit latency not measured** — When `commit=true`, the `qtime` includes commit fsync time, but this is not broken out separately. Bulk indexing performance is opaque.

### Error Handling

24. **No Cloudflare detection on `/health`** — Unlike `/query`, `/index`, and `/delete`, the `/health` endpoint performs Cloudflare detection. This inconsistency causes confusion when testing.

25. **Generic error messages** — Most exceptions return `"Connection timeout"` or `"Connection failed"`. No distinction between DNS resolution failure, connection refused, TLS handshake timeout, or read timeout.

26. **No HTTP status code propagation in errors** — If Solr returns 400 Bad Request with JSON error detail, the error response has `success: false, error: "Query failed"` instead of including the Solr error message.

---

## Security Considerations

### Input Validation Bypasses

1. **Path traversal in core name** — While `../` is blocked, URL-encoded forms like `%2e%2e%2f` are not validated before `encodeURIComponent()` encoding. This double-encoding could bypass naive WAF rules.

2. **Handler path injection** — A malicious `handler` value like `/select/../admin/cores` bypasses `..` check (since it's a valid relative path after normalization) and could access admin endpoints if Solr allows it.

3. **CRLF injection in params** — Although `URLSearchParams` encodes CRLF as `%0D%0A`, a Solr plugin parsing raw query strings could misinterpret smuggled headers/body.

### Resource Exhaustion

4. **No rate limiting** — A single client can issue unlimited concurrent requests, exhausting Solr connection pool, CPU, and memory.

5. **Large document upload** — No size limit on `documents` array in `/index` endpoint. A 1 GB JSON payload would be accepted and forwarded to Solr, consuming worker memory and Solr indexing threads.

6. **Timeout value abuse** — Caller can set `timeout: 600000` (10 minutes), holding socket/memory for extended duration.

### Authentication Weaknesses

7. **Cleartext credentials** — Basic Auth over HTTP exposes username/password to anyone on network path (ISP, proxies, routers). HTTPS is not supported.

8. **No authentication state validation** — If Solr returns 401, the endpoint returns `statusCode: 401` but does not validate that credentials are required or suggest retry with auth.

### Information Disclosure

9. **Version fingerprinting** — `/health` endpoint exposes Solr version, JVM version, OS details, and core names. Attackers can identify vulnerable versions (e.g., CVE-2021-44228 Log4Shell in Solr 8.11.0).

10. **Core enumeration** — Unauthenticated `/health` requests list all cores if Solr security is disabled, revealing index structure and naming conventions.

---

## Common Issues and Solutions

### "Connection timeout" on all requests

**Cause:** Solr not listening on port 8983, firewall blocking port, or host unreachable.

**Fix:** Verify Solr is running (`curl http://host:8983/solr/`). Check firewall rules. Try `/health` endpoint first to isolate issue.

### "Core name is required" error

**Cause:** `core` field is empty string or whitespace-only.

**Fix:** Provide a valid core name (alphanumeric, underscore, hyphen, dot). Check Solr admin UI for available cores.

### "Core name contains invalid path characters" error

**Cause:** Core name includes `/`, `\`, or `..` sequences.

**Fix:** Use only `[a-zA-Z0-9._-]` characters. For SolrCloud collections with colons (e.g., `logs_shard1_replica_n1`), this implementation cannot access them — use direct HTTP client instead.

### Query returns `success: true` but `parsed: null`

**Cause:** Solr returned non-JSON response (XML, CSV) or malformed JSON.

**Fix:** Check `body` field for actual response. Verify Solr is configured with `wt=json` support. If response is XML, Solr may have `wt` override in `solrconfig.xml`.

### Documents indexed but not searchable

**Cause:** `commit: false` was used, or Solr autoCommit interval not reached.

**Fix:** Send another `/index` request with empty `documents: []` and `commit: true`, or wait for Solr's autoCommit (check `solrconfig.xml` for `<autoCommit><maxTime>` value).

### Delete by query reports success but documents remain

**Cause:** Query syntax error (Solr returns `status: 0` but deletes nothing), or commit not performed.

**Fix:** Test query with `/query` endpoint first to verify it matches expected documents. Ensure `commit: true` is set.

### 401 Unauthorized on `/query` but `/health` succeeds

**Cause:** Solr security plugin allows unauthenticated access to `/admin/*` endpoints but requires auth for core-level queries.

**Fix:** Provide `username` and `password` in `/query` request. Verify credentials work with `curl -u user:pass http://host:8983/solr/core/select?q=*:*`.

### Response truncated at 512 KB

**Cause:** Hardcoded response size limit.

**Fix:** Reduce result set size with `rows` parameter. Use pagination (`start`/`rows`) to retrieve in chunks. For large exports, use Solr's `/export` handler (not supported by this implementation) or direct HTTP client.

### Chunked transfer encoding garbled output

**Cause:** Solr sent malformed chunked encoding (missing CRLF, invalid hex size), or intermediate proxy corrupted response.

**Fix:** Check Solr logs for errors. Test with `curl -v` to see raw response. If Solr version < 7.0, upgrade (older versions had chunked encoding bugs).

---

## Performance Tips

1. **Batch indexing with `commit: false`** — For bulk indexing, send batches of 1000 documents with `commit: false`, then one final request with `commit: true`. This avoids fsync overhead on every request.

2. **Use filter queries** — Solr caches filter query results. For repeated queries with same filter, use `params: { fq: "category:electronics" }` instead of `q: "title:laptop AND category:electronics"`.

3. **Limit field list with `fl`** — Retrieving all fields (`fl=*`) for large documents wastes bandwidth. Specify only needed fields: `params: { fl: "id,title,price" }`.

4. **Paginate with small `rows`** — Default `rows=10` is reasonable. Avoid `rows=1000` unless necessary — Solr must rank all matches, then return top N.

5. **Use `/health` sparingly** — This endpoint makes two requests (system info + cores). For monitoring, cache core list and query only system info endpoint directly.

6. **Avoid wildcard queries on large indexes** — Queries like `*:*` or `title:*` require scoring all documents. Use `fq` to prefilter: `q: "title:apache"`, `params: { fq: "category:software" }`.

7. **Set reasonable timeouts** — Default 15s is conservative. For realtime search, use 5s. For analytics queries, increase to 60s.

---

## Testing and Debugging

### Test connectivity with `/health`

```bash
curl -X POST https://portofcall.example.com/api/solr/health \
  -H "Content-Type: application/json" \
  -d '{"host": "solr.example.com", "port": 8983}'
```

Expected response includes `success: true`, `version`, `cores[]`.

### Query a core

```bash
curl -X POST https://portofcall.example.com/api/solr/query \
  -H "Content-Type: application/json" \
  -d '{
    "host": "solr.example.com",
    "core": "collection1",
    "query": "*:*",
    "params": {"rows": "5", "fl": "id,title"}
  }'
```

Expected response includes `parsed.response.docs[]` array.

### Index a document

```bash
curl -X POST https://portofcall.example.com/api/solr/index \
  -H "Content-Type: application/json" \
  -d '{
    "host": "solr.example.com",
    "core": "products",
    "documents": [
      {"id": "test-1", "title": "Test Product", "price": 9.99}
    ],
    "commit": true
  }'
```

Expected response includes `success: true`, `status: 0`, `documentsIndexed: 1`.

### Delete a document

```bash
curl -X POST https://portofcall.example.com/api/solr/delete \
  -H "Content-Type: application/json" \
  -d '{
    "host": "solr.example.com",
    "core": "products",
    "ids": ["test-1"],
    "commit": true
  }'
```

Expected response includes `success: true`, `deleteMode: "by-id"`, `count: 1`.

---

## References

- [Apache Solr Reference Guide](https://solr.apache.org/guide/)
- [Solr Query Syntax](https://solr.apache.org/guide/solr/latest/query-guide/standard-query-parser.html)
- [Solr Update Handlers](https://solr.apache.org/guide/solr/latest/indexing-guide/indexing-with-update-handlers.html)
- [Solr Authentication and Authorization](https://solr.apache.org/guide/solr/latest/deployment-guide/authentication-and-authorization-plugins.html)
- [SolrCloud Architecture](https://solr.apache.org/guide/solr/latest/deployment-guide/solrcloud.html)
