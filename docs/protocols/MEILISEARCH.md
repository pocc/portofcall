# Meilisearch — Port of Call Reference

**Protocol:** Meilisearch HTTP REST API
**Default Port:** 7700
**Transport:** Raw TCP -> HTTP/1.1 (plaintext only, no TLS)
**Implementation:** `src/worker/meilisearch.ts` (~480 lines)
**Endpoints:** 4

---

## Architecture

Port of Call implements Meilisearch as raw HTTP/1.1 over TCP using a single shared `sendHttpRequest` helper function. Every request:

1. Opens a new TCP socket via `connect()` from `cloudflare:sockets`
2. Sends a single HTTP/1.1 request with `Connection: close`
3. Reads the full response (up to 512 KB)
4. Decodes chunked transfer-encoding if present
5. Closes the socket

There is no connection pooling, keep-alive, or pipelining. Each Meilisearch API call maps to one TCP socket lifecycle.

---

## Authentication

Meilisearch uses API key authentication via the `Authorization: Bearer <key>` header. All endpoints accept an optional `apiKey` parameter. If provided, every HTTP request to the Meilisearch server includes:

```
Authorization: Bearer <apiKey>
```

Meilisearch has three key types:
- **Master key** — full access, set at server startup via `--master-key`
- **Admin API key** — full access to all API routes except `/keys` management (auto-generated from master key)
- **Search API key** — read-only access to search and document retrieval (auto-generated from master key)

If the server has no master key configured, all endpoints are accessible without authentication. If a master key is set but no valid API key is provided, Meilisearch returns HTTP 401.

**Note:** The `/health` endpoint never requires authentication, regardless of master key configuration. The implementation sends the API key to `/health` anyway, which is harmless but unnecessary.

---

## Endpoints

### POST /api/meilisearch/health

Fetches server health, version, global stats, and index listing in four sequential HTTP requests.

**Request**
```json
{
  "host": "search.example.com",
  "port": 7700,
  "apiKey": "optional-api-key",
  "timeout": 15000
}
```

**Wire sequence**
1. `GET /health` -> Health status (always unauthenticated)
2. `GET /version` -> Version info (requires auth if master key is set)
3. `GET /stats` -> Global database stats (requires auth)
4. `GET /indexes` -> Index listing (requires auth)

Steps 2-4 are best-effort: if any fails (auth error, parse error), that field is `null` in the response. Only the `/health` result determines overall `success`.

**Response**
```json
{
  "success": true,
  "statusCode": 200,
  "health": { "status": "available" },
  "version": {
    "pkgVersion": "1.11.0",
    "commitSha": "abc123def456",
    "commitDate": "2024-12-01T00:00:00Z"
  },
  "stats": {
    "databaseSize": 524288,
    "lastUpdate": "2024-12-15T10:30:00Z",
    "indexes": {
      "movies": {
        "numberOfDocuments": 19546,
        "isIndexing": false,
        "fieldDistribution": { "title": 19546, "genre": 19546 }
      }
    }
  },
  "indexes": {
    "results": [
      {
        "uid": "movies",
        "primaryKey": "id",
        "createdAt": "2024-01-15T12:00:00Z",
        "updatedAt": "2024-12-15T10:30:00Z"
      }
    ],
    "offset": 0,
    "limit": 20,
    "total": 1
  },
  "latencyMs": 45,
  "host": "search.example.com",
  "port": 7700
}
```

**Field notes:**
- `success` is true when `/health` returns HTTP 200-399. The other three requests are fire-and-forget.
- `health.status` is always `"available"` when the server is up. Meilisearch returns HTTP 200 with `{"status":"available"}` or does not respond at all.
- `version.pkgVersion` is the Meilisearch release version (e.g., `"1.11.0"`).
- `stats.databaseSize` is in bytes. The frontend converts to MB.
- `stats.indexes` is a map of index UID -> index-level stats. Each entry includes `numberOfDocuments`, `isIndexing`, and `fieldDistribution`.
- `indexes` uses the paginated list format (Meilisearch v1.x): `results` array with `offset`, `limit`, `total`. This replaced the flat array format from v0.x.
- `latencyMs` covers all four sequential requests combined, not just `/health`.

---

### POST /api/meilisearch/search

Searches a specific index using Meilisearch's full-text search.

**Request**
```json
{
  "host": "search.example.com",
  "port": 7700,
  "apiKey": "search-api-key",
  "index": "movies",
  "query": "batman dark",
  "limit": 20,
  "offset": 0,
  "timeout": 15000
}
```

**Wire:** `POST /indexes/{encodeURIComponent(index)}/search` with JSON body:
```json
{ "q": "batman dark", "limit": 20, "offset": 0 }
```

**Response**
```json
{
  "success": true,
  "statusCode": 200,
  "results": {
    "hits": [
      { "id": 155, "title": "The Dark Knight", "genre": "Action" }
    ],
    "query": "batman dark",
    "processingTimeMs": 2,
    "limit": 20,
    "offset": 0,
    "estimatedTotalHits": 3
  },
  "latencyMs": 28,
  "host": "search.example.com",
  "port": 7700,
  "index": "movies",
  "query": "batman dark"
}
```

**Field notes:**
- `results` is the raw parsed JSON from Meilisearch's search response.
- `results.hits` contains the matching documents. Each hit is the full stored document.
- `results.processingTimeMs` is Meilisearch's internal processing time (server-side only, excludes network).
- `results.estimatedTotalHits` is Meilisearch's estimate of total matches. For exact counts, use `hitsPerPage`/`page` pagination mode (not implemented here).
- `query` can be empty string `""` to return all documents (up to `limit`).
- The index name is URL-encoded in the path. Index names in Meilisearch may contain alphanumeric characters, hyphens, and underscores.
- Only `q`, `limit`, and `offset` are sent in the search body. Meilisearch supports many more search parameters (filter, sort, facets, attributesToRetrieve, attributesToHighlight, etc.) that are not exposed.

---

### POST /api/meilisearch/documents

Adds or updates documents in a Meilisearch index. Documents are upserted by primary key.

**Request**
```json
{
  "host": "search.example.com",
  "port": 7700,
  "apiKey": "admin-api-key",
  "index": "movies",
  "documents": [
    { "id": 1, "title": "The Matrix", "genre": "Sci-Fi" },
    { "id": 2, "title": "Inception", "genre": "Thriller" }
  ],
  "primaryKey": "id",
  "timeout": 15000
}
```

**Wire:** `POST /indexes/{encodeURIComponent(index)}/documents[?primaryKey={encodeURIComponent(primaryKey)}]` with JSON array body.

**Response (success)**
```json
{
  "success": true,
  "host": "search.example.com",
  "port": 7700,
  "index": "movies",
  "documentsSubmitted": 2,
  "httpStatus": 202,
  "taskUid": 42,
  "status": "enqueued",
  "message": "2 document(s) submitted (task 42)"
}
```

**Response (error)**
```json
{
  "success": false,
  "host": "search.example.com",
  "port": 7700,
  "index": "movies",
  "documentsSubmitted": 2,
  "httpStatus": 401,
  "error": "The Authorization header is missing."
}
```

**Field notes:**
- Meilisearch document operations are **asynchronous**. A successful response (HTTP 202) means the task was enqueued, not that documents are immediately searchable. Use `GET /tasks/{taskUid}` to check completion (not implemented in Port of Call).
- `primaryKey` is optional. If omitted, Meilisearch infers the primary key from the first document's fields (looks for `id` by default). Once set for an index, it cannot be changed.
- `status` will be `"enqueued"` on success. After processing, it becomes `"succeeded"` or `"failed"`.
- `taskUid` is a monotonically increasing integer identifying the enqueued task.
- Documents are upserted: if a document with the same primary key exists, it is replaced entirely. There is no partial update via this endpoint (use `PUT /indexes/{uid}/documents` for replace or `PATCH` for partial — neither exposed here).
- The success check uses `statusCode >= 200 && statusCode < 300`. Meilisearch returns HTTP 202 (Accepted) for document operations, which correctly falls in this range.

---

### POST /api/meilisearch/delete

Deletes documents from a Meilisearch index, either by ID list or all documents.

**Request (delete by IDs)**
```json
{
  "host": "search.example.com",
  "port": 7700,
  "apiKey": "admin-api-key",
  "index": "movies",
  "ids": [1, 2, 155]
}
```

**Request (delete all)**
```json
{
  "host": "search.example.com",
  "port": 7700,
  "apiKey": "admin-api-key",
  "index": "movies",
  "all": true
}
```

**Wire (delete by IDs):** `POST /indexes/{encodeURIComponent(index)}/documents/delete` with JSON array body `[1, 2, 155]`

**Wire (delete all):** `DELETE /indexes/{encodeURIComponent(index)}/documents`

**Response**
```json
{
  "success": true,
  "host": "search.example.com",
  "port": 7700,
  "index": "movies",
  "mode": "by-ids",
  "count": 3,
  "httpStatus": 202,
  "taskUid": 43,
  "message": "3 document(s) deleted"
}
```

**Field notes:**
- Like document addition, deletion is asynchronous. HTTP 202 means the task was enqueued.
- `mode` is `"all"` or `"by-ids"` depending on which mode was used.
- `count` is the number of IDs submitted for deletion (only present in `by-ids` mode). It does not indicate how many documents were actually deleted — IDs that don't exist are silently ignored.
- `ids` can contain strings or numbers. Meilisearch accepts both types as document identifiers.
- The `all` mode uses `DELETE /indexes/{uid}/documents` which removes every document from the index but preserves the index settings and configuration.
- Default timeout is 10 seconds (vs. 15 seconds for other endpoints).

---

## Common Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `host` | string | required | Meilisearch server hostname or IP |
| `port` | number | `7700` | Meilisearch HTTP port |
| `apiKey` | string | -- | API key (`Authorization: Bearer` header) |
| `timeout` | number | `15000` | TCP connection + read timeout in ms |
| `index` | string | varies | Index UID (required for search, documents, delete) |

---

## Wire Protocol Details

All communication is HTTP/1.1 over a raw TCP socket (`cloudflare:sockets`). Every request:

1. Opens a new TCP socket to `{host}:{port}`
2. Sends a single HTTP request with `Connection: close`
3. Reads the full response (up to 512 KB)
4. Closes the socket

**Headers sent on every request:**
```
GET /health HTTP/1.1
Host: {host}:{port}
Accept: application/json
Connection: close
User-Agent: PortOfCall/1.0
Authorization: Bearer {apiKey}   <- only if apiKey provided
```

For POST/PUT/DELETE with a body:
```
POST /indexes/movies/search HTTP/1.1
Host: {host}:{port}
Accept: application/json
Connection: close
User-Agent: PortOfCall/1.0
Authorization: Bearer {apiKey}
Content-Type: application/json
Content-Length: {bodyBytes.length}

{"q":"batman","limit":20,"offset":0}
```

**Content-Length is byte-accurate.** The implementation encodes the body to bytes first, then measures `bodyBytes.length` for the `Content-Length` header. This correctly handles multi-byte UTF-8 characters.

**Chunked encoding:** The TCP reader decodes chunked transfer-encoding, so Meilisearch's chunked responses are handled transparently.

**No TLS.** HTTPS is not supported. If the Meilisearch server is behind TLS (common in production with reverse proxies), all connections will fail. Use a non-TLS endpoint or connect directly to the Meilisearch port.

---

## Meilisearch API Coverage

| Meilisearch Endpoint | Implemented | Notes |
|---|---|---|
| `GET /health` | Yes | Via `/api/meilisearch/health` |
| `GET /version` | Yes | Via `/api/meilisearch/health` |
| `GET /stats` | Yes | Via `/api/meilisearch/health` |
| `GET /indexes` | Yes | Via `/api/meilisearch/health` |
| `POST /indexes/{uid}/search` | Yes | Via `/api/meilisearch/search` |
| `POST /indexes/{uid}/documents` | Yes | Via `/api/meilisearch/documents` |
| `POST /indexes/{uid}/documents/delete` | Yes | Via `/api/meilisearch/delete` |
| `DELETE /indexes/{uid}/documents` | Yes | Via `/api/meilisearch/delete` (all mode) |
| `GET /indexes/{uid}/documents` | No | List/get documents by ID |
| `PUT /indexes/{uid}/documents` | No | Replace documents |
| `PATCH /indexes/{uid}/documents` | No | Partial document update |
| `POST /indexes` | No | Create index |
| `PATCH /indexes/{uid}` | No | Update index |
| `DELETE /indexes/{uid}` | No | Delete index |
| `GET /tasks` | No | List tasks |
| `GET /tasks/{uid}` | No | Get task status |
| `DELETE /tasks` | No | Cancel/delete tasks |
| `GET /keys` | No | List API keys |
| `POST /keys` | No | Create API key |
| `GET /indexes/{uid}/settings` | No | Get index settings |
| `PATCH /indexes/{uid}/settings` | No | Update settings (synonyms, stop words, ranking rules, etc.) |
| `POST /swap-indexes` | No | Swap two indexes atomically |
| `POST /multi-search` | No | Search multiple indexes in one request |
| `POST /dumps` | No | Create database dump |
| `POST /snapshots` | No | Create database snapshot |

---

## Known Limitations

| Limitation | Detail |
|-----------|--------|
| **No TLS** | Plaintext HTTP/1.1 only. No HTTPS/TLS support. |
| **512 KB response cap** | Large search results or document listings are silently truncated. |
| **No task polling** | Document add/delete are async but there is no way to check task completion. |
| **No index management** | Cannot create, update, or delete indexes. |
| **No settings management** | Cannot configure synonyms, stop words, ranking rules, filterable/sortable attributes, etc. |
| **No advanced search params** | Only `q`, `limit`, `offset` are sent. No `filter`, `sort`, `facets`, `attributesToRetrieve`, `attributesToHighlight`, `attributesToCrop`, `showMatchesPosition`, `matchingStrategy`. |
| **No multi-search** | Cannot search multiple indexes in a single request. |
| **No pagination modes** | Only `offset`/`limit` pagination. No `page`/`hitsPerPage` mode (which returns exact `totalHits` instead of `estimatedTotalHits`). |
| **No partial updates** | `PATCH /indexes/{uid}/documents` is not implemented. Only full document replacement via POST. |
| **No key management** | Cannot list, create, update, or delete API keys. |
| **No tenant tokens** | Multi-tenant token generation is not supported. |
| **No dump/snapshot** | Cannot trigger database dumps or snapshots. |
| **Sequential health requests** | The health endpoint makes 4 sequential HTTP requests. Could be parallelized for lower latency. |

---

## Error Responses

When the TCP connection fails or times out:
```json
{ "success": false, "error": "Connection timeout" }
```
HTTP status 500.

When a required parameter is missing:
```json
{ "success": false, "error": "Missing required parameter: host" }
```
HTTP status 400.

When targeting a Cloudflare IP:
```json
{ "success": false, "error": "...", "isCloudflare": true }
```
HTTP status 403.

When Meilisearch returns an error (e.g., auth failure):
```json
{
  "success": false,
  "statusCode": 401,
  "health": { "message": "The Authorization header is missing.", "code": "missing_authorization_header", "type": "auth", "link": "https://docs.meilisearch.com/errors#missing_authorization_header" }
}
```
HTTP status 200 (the proxy succeeded, but `success: false` indicates Meilisearch rejected the request).

---

## curl Examples

```bash
# Health check (no auth)
curl -s -X POST https://portofcall.ross.gg/api/meilisearch/health \
  -H 'Content-Type: application/json' \
  -d '{"host":"search.example.com","port":7700}'

# Health check with API key
curl -s -X POST https://portofcall.ross.gg/api/meilisearch/health \
  -H 'Content-Type: application/json' \
  -d '{"host":"search.example.com","apiKey":"your-master-or-admin-key"}'

# Search an index
curl -s -X POST https://portofcall.ross.gg/api/meilisearch/search \
  -H 'Content-Type: application/json' \
  -d '{"host":"search.example.com","apiKey":"your-search-key","index":"movies","query":"batman","limit":5}' \
  | jq '.results.hits'

# Search with empty query (returns all docs up to limit)
curl -s -X POST https://portofcall.ross.gg/api/meilisearch/search \
  -H 'Content-Type: application/json' \
  -d '{"host":"search.example.com","apiKey":"your-search-key","index":"movies","query":"","limit":100}'

# Add documents
curl -s -X POST https://portofcall.ross.gg/api/meilisearch/documents \
  -H 'Content-Type: application/json' \
  -d '{
    "host":"search.example.com",
    "apiKey":"your-admin-key",
    "index":"movies",
    "documents":[
      {"id":1,"title":"The Matrix","year":1999},
      {"id":2,"title":"Inception","year":2010}
    ],
    "primaryKey":"id"
  }'

# Delete specific documents by ID
curl -s -X POST https://portofcall.ross.gg/api/meilisearch/delete \
  -H 'Content-Type: application/json' \
  -d '{"host":"search.example.com","apiKey":"your-admin-key","index":"movies","ids":[1,2]}'

# Delete ALL documents in an index
curl -s -X POST https://portofcall.ross.gg/api/meilisearch/delete \
  -H 'Content-Type: application/json' \
  -d '{"host":"search.example.com","apiKey":"your-admin-key","index":"movies","all":true}'
```

---

## Local Testing

```bash
# Run Meilisearch in development mode (no auth, data in /meili_data)
docker run -d --name meilisearch \
  -p 7700:7700 \
  -v meili_data:/meili_data \
  getmeili/meilisearch:v1.11

# Run with a master key (enables auth)
docker run -d --name meilisearch \
  -p 7700:7700 \
  -v meili_data:/meili_data \
  -e MEILI_MASTER_KEY=my-secret-key \
  getmeili/meilisearch:v1.11

# Verify it's up
curl http://localhost:7700/health
# {"status":"available"}

# Get version (with auth)
curl -H 'Authorization: Bearer my-secret-key' http://localhost:7700/version
# {"pkgVersion":"1.11.0","commitSha":"...","commitDate":"..."}

# Create a test index and add documents
curl -X POST http://localhost:7700/indexes/movies/documents \
  -H 'Authorization: Bearer my-secret-key' \
  -H 'Content-Type: application/json' \
  --data-binary '[
    {"id":1,"title":"The Matrix","genre":"Sci-Fi","year":1999},
    {"id":2,"title":"The Dark Knight","genre":"Action","year":2008},
    {"id":3,"title":"Inception","genre":"Thriller","year":2010}
  ]'

# Search
curl -X POST http://localhost:7700/indexes/movies/search \
  -H 'Authorization: Bearer my-secret-key' \
  -H 'Content-Type: application/json' \
  -d '{"q":"dark","limit":10}'
```

---

## Meilisearch API Key Types

When a master key is set, Meilisearch auto-generates two default keys accessible via `GET /keys`:

| Key Type | Permissions | Use Case |
|----------|------------|----------|
| Default Admin API Key | All actions except `/keys` management | Server-side operations, indexing, settings |
| Default Search API Key | `search` action only on all indexes | Client-side search, safe to expose in frontend |

Custom keys can be created with fine-grained permissions (specific indexes, specific actions, expiration dates) via `POST /keys` -- not implemented in Port of Call.

---

## Meilisearch Error Codes

Common error codes returned by Meilisearch in the response body:

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `missing_authorization_header` | 401 | No `Authorization` header when master key is set |
| `invalid_api_key` | 403 | API key is invalid or expired |
| `index_not_found` | 404 | Index UID does not exist |
| `index_already_exists` | 409 | Index UID already taken |
| `invalid_document_id` | 400 | Document primary key value is invalid |
| `missing_document_id` | 400 | Document has no primary key field |
| `primary_key_inference_failed` | 400 | Could not infer primary key from document |
| `max_fields_limit_exceeded` | 400 | Document exceeds max field count (default: 65535) |
| `document_fields_limit_reached` | 400 | Too many fields across all documents |
| `payload_too_large` | 413 | Request body exceeds payload size limit |

---

## Resources

- [Meilisearch API Reference](https://www.meilisearch.com/docs/reference/api/overview)
- [Meilisearch Search Parameters](https://www.meilisearch.com/docs/reference/api/search)
- [Meilisearch Authentication](https://www.meilisearch.com/docs/learn/security/basic_security)
- [Meilisearch Docker Hub](https://hub.docker.com/r/getmeili/meilisearch)
- [Meilisearch GitHub](https://github.com/meilisearch/meilisearch)
