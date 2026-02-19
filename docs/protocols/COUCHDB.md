# Apache CouchDB HTTP API Protocol Reference

A power-user reference for the CouchDB HTTP REST API as implemented in Port of Call.

## Overview

CouchDB is a NoSQL document database that uses **HTTP as its native protocol**. Every operation -- CRUD, replication, views, administration -- is a standard HTTP request with a JSON body. This makes CouchDB unique among databases: you can interact with it using curl, a browser, or any HTTP client without a special driver.

## Connection Details

| Parameter     | Value                     |
|---------------|---------------------------|
| Default Port  | **5984** (HTTP)           |
| HTTPS Port    | **6984** (when configured)|
| Transport     | HTTP/1.1 over TCP         |
| Content-Type  | `application/json`        |
| Auth          | Basic Auth, Cookie, JWT, Proxy |

## Authentication

### Basic Auth

Standard HTTP Basic Authentication. The `Authorization` header carries base64-encoded `username:password`.

```
Authorization: Basic YWRtaW46cGFzc3dvcmQ=
```

CouchDB accepts empty passwords (username-only auth), where the credential is `username:` (with trailing colon).

### Cookie Auth (/_session)

Cookie-based session authentication is CouchDB's recommended auth method for browser clients.

**Create a session:**
```
POST /_session
Content-Type: application/json

{"name": "admin", "password": "secret"}
```

Response (200 OK):
```json
{"ok": true, "name": "admin", "roles": ["_admin"]}
```

The response includes a `Set-Cookie: AuthSession=...` header. Subsequent requests send this cookie:
```
Cookie: AuthSession=YWRtaW46NjQ...
```

**Check current session:**
```
GET /_session
```

Response:
```json
{
  "ok": true,
  "userCtx": {"name": "admin", "roles": ["_admin"]},
  "info": {
    "authentication_db": "_users",
    "authentication_handlers": ["cookie", "default"],
    "authenticated": "cookie"
  }
}
```

**Delete session (logout):**
```
DELETE /_session
```

### JWT Auth

CouchDB 3.x supports JWT tokens via the `Authorization: Bearer <token>` header. Requires server-side configuration of the JWT secret/keys.

### Proxy Auth

For reverse-proxy setups. The proxy sends `X-Auth-CouchDB-UserName` and `X-Auth-CouchDB-Roles` headers.

## Server-Level Endpoints

### GET / -- Server Info

Returns CouchDB welcome message, version, and features.

```
GET / HTTP/1.1
Host: localhost:5984
Accept: application/json
```

Response (200 OK):
```json
{
  "couchdb": "Welcome",
  "version": "3.3.3",
  "git_sha": "abc1234",
  "uuid": "f8a0e520f4...",
  "features": ["access-ready", "partitioned", "pluggable-storage-engines", "reshard", "scheduler"],
  "vendor": {
    "name": "The Apache Software Foundation"
  }
}
```

**Version Detection:** The `version` field provides the CouchDB version. The `features` array indicates available capabilities. The `uuid` is the server instance UUID.

### GET /_up -- Health Check

Lightweight health probe. Returns 200 if the node is running and ready.

```
GET /_up HTTP/1.1
```

Response (200 OK):
```json
{"status": "ok"}
```

Returns **404** if the node is not yet ready (e.g., during startup).

### GET /_all_dbs -- List All Databases

Returns a JSON array of all database names on the server.

```
GET /_all_dbs HTTP/1.1
```

Response (200 OK):
```json
["_replicator", "_users", "mydb", "testdb"]
```

Query parameters:
- `descending=true` -- Reverse the listing order
- `startkey="prefix"` -- Start listing from this database name
- `endkey="prefix\ufff0"` -- End listing at this name
- `limit=10` -- Maximum number of databases to return
- `skip=5` -- Skip the first N databases

**Note:** Requires admin privileges in CouchDB 3.x by default (controlled by `[chttpd] admin_only_all_dbs`).

### POST /_dbs_info -- Bulk Database Info

Get info for multiple databases in a single request.

```
POST /_dbs_info HTTP/1.1
Content-Type: application/json

{"keys": ["mydb", "testdb"]}
```

Response (200 OK):
```json
[
  {"key": "mydb", "info": {"db_name": "mydb", "doc_count": 42, ...}},
  {"key": "testdb", "info": {"db_name": "testdb", "doc_count": 7, ...}}
]
```

### GET /_active_tasks -- Running Tasks

Lists all active tasks such as replication, compaction, and indexing.

```
GET /_active_tasks HTTP/1.1
```

Response (200 OK):
```json
[
  {
    "type": "replication",
    "pid": "<0.567.0>",
    "source": "http://source:5984/mydb/",
    "target": "http://target:5984/mydb/",
    "progress": 72,
    "started_on": 1708000000
  }
]
```

### GET /_membership -- Cluster Nodes

Returns all known nodes and the nodes in the current cluster.

```
GET /_membership HTTP/1.1
```

Response (200 OK):
```json
{
  "all_nodes": ["couchdb@node1.example.com", "couchdb@node2.example.com"],
  "cluster_nodes": ["couchdb@node1.example.com", "couchdb@node2.example.com"]
}
```

### GET /_node/_local/_stats -- Node Statistics

Returns detailed statistics for the local node (request counts, sizes, etc.).

```
GET /_node/_local/_stats HTTP/1.1
```

**Requires admin auth.** Response contains nested objects with `value`, `type`, and `desc` fields for each metric.

### GET /_node/_local/_system -- System Info

Returns Erlang VM and OS-level metrics (memory, CPU, uptime).

```
GET /_node/_local/_system HTTP/1.1
```

### GET /_scheduler/docs -- Replication Status

Lists all replication documents and their states.

```
GET /_scheduler/docs HTTP/1.1
```

## Database-Level Endpoints

### GET /dbname -- Database Info

```
GET /mydb HTTP/1.1
```

Response (200 OK):
```json
{
  "db_name": "mydb",
  "doc_count": 42,
  "doc_del_count": 3,
  "update_seq": "45-g1AAAA...",
  "purge_seq": "0-g1AAAA...",
  "compact_running": false,
  "disk_size": 1048576,
  "data_size": 524288,
  "instance_start_time": "0",
  "disk_format_version": 8,
  "committed_update_seq": 45,
  "compacted_seq": 0,
  "uuid": "abc123...",
  "sizes": {
    "file": 1048576,
    "external": 524288,
    "active": 262144
  },
  "props": {},
  "cluster": {
    "q": 2,
    "n": 3,
    "w": 2,
    "r": 2
  }
}
```

### PUT /dbname -- Create Database

```
PUT /newdb HTTP/1.1
```

Response (201 Created):
```json
{"ok": true}
```

Query parameters:
- `q=8` -- Number of shards (default: 2 in CouchDB 3.x)
- `n=3` -- Number of replicas

### DELETE /dbname -- Delete Database

```
DELETE /mydb HTTP/1.1
```

Response (200 OK):
```json
{"ok": true}
```

### POST /dbname -- Create Document (server-generated ID)

```
POST /mydb HTTP/1.1
Content-Type: application/json

{"name": "Alice", "age": 30}
```

Response (201 Created):
```json
{"ok": true, "id": "abc123...", "rev": "1-xyz789..."}
```

## Document-Level Endpoints

### GET /dbname/docid -- Read Document

```
GET /mydb/mydoc HTTP/1.1
```

Response (200 OK):
```json
{
  "_id": "mydoc",
  "_rev": "1-abc123",
  "name": "Alice",
  "age": 30
}
```

Query parameters:
- `rev=1-abc123` -- Specific revision
- `revs=true` -- Include revision history
- `attachments=true` -- Include inline attachments
- `conflicts=true` -- Include conflict information

### PUT /dbname/docid -- Create/Update Document

```
PUT /mydb/mydoc HTTP/1.1
Content-Type: application/json

{"_rev": "1-abc123", "name": "Alice", "age": 31}
```

The `_rev` field is **required for updates** (optimistic concurrency). Omit it only when creating a new document with a specific ID.

Response (201 Created):
```json
{"ok": true, "id": "mydoc", "rev": "2-def456"}
```

**409 Conflict** is returned if the `_rev` does not match the current revision.

### DELETE /dbname/docid -- Delete Document

```
DELETE /mydb/mydoc?rev=2-def456 HTTP/1.1
```

The `rev` parameter (or `If-Match` header) is **required**.

### COPY /dbname/docid -- Copy Document

CouchDB's non-standard HTTP method for duplicating documents.

```
COPY /mydb/mydoc HTTP/1.1
Destination: newdocid
```

Response (201 Created):
```json
{"ok": true, "id": "newdocid", "rev": "1-abc123"}
```

To overwrite an existing destination document:
```
Destination: existingdoc?rev=1-xyz789
```

## Bulk Operations

### POST /dbname/_bulk_docs -- Bulk Create/Update

```
POST /mydb/_bulk_docs HTTP/1.1
Content-Type: application/json

{
  "docs": [
    {"_id": "doc1", "name": "Alice"},
    {"_id": "doc2", "name": "Bob"},
    {"_id": "doc3", "_rev": "1-abc", "_deleted": true}
  ]
}
```

### POST /dbname/_bulk_get -- Bulk Read

```
POST /mydb/_bulk_get HTTP/1.1
Content-Type: application/json

{
  "docs": [
    {"id": "doc1"},
    {"id": "doc2", "rev": "1-abc123"}
  ]
}
```

### POST /dbname/_find -- Mango Query

```
POST /mydb/_find HTTP/1.1
Content-Type: application/json

{
  "selector": {"age": {"$gt": 25}},
  "fields": ["name", "age"],
  "sort": [{"age": "asc"}],
  "limit": 25
}
```

## View Endpoints

### GET /dbname/_design/ddoc/_view/viewname

```
GET /mydb/_design/myapp/_view/by_name?key="Alice"&include_docs=true HTTP/1.1
```

Query parameters:
- `key="value"` -- Exact key match
- `startkey="a"` / `endkey="z"` -- Key range
- `include_docs=true` -- Include full documents
- `reduce=false` -- Skip the reduce function
- `group=true` -- Group reduce results by key
- `limit=25` / `skip=0` -- Pagination
- `descending=true` -- Reverse order
- `stale=ok` -- Return potentially stale results (faster)

## Replication

### POST /_replicate -- One-Shot Replication

```
POST /_replicate HTTP/1.1
Content-Type: application/json

{
  "source": "http://source:5984/mydb",
  "target": "http://target:5984/mydb",
  "continuous": false,
  "create_target": true
}
```

### Continuous Replication

Set `"continuous": true` in the replication document, or create a document in the `_replicator` database for persistent replication.

## Changes Feed

### GET /dbname/_changes -- Stream Changes

```
GET /mydb/_changes?feed=longpoll&since=now HTTP/1.1
```

Feed types:
- `feed=normal` -- One-shot (default)
- `feed=longpoll` -- Long-polling
- `feed=continuous` -- Streaming (newline-delimited JSON)
- `feed=eventsource` -- Server-Sent Events

## HTTP Status Codes

| Code | Meaning                          |
|------|----------------------------------|
| 200  | OK -- Request completed          |
| 201  | Created -- Document/database created |
| 202  | Accepted -- Request accepted (async) |
| 304  | Not Modified -- ETag matched     |
| 400  | Bad Request -- Invalid JSON or parameters |
| 401  | Unauthorized -- Auth required    |
| 403  | Forbidden -- Insufficient privileges |
| 404  | Not Found -- Resource does not exist |
| 405  | Method Not Allowed               |
| 409  | Conflict -- Document update conflict |
| 412  | Precondition Failed -- Database already exists |
| 415  | Unsupported Media Type -- Missing Content-Type |
| 500  | Internal Server Error            |

## Important Headers

### Request Headers

| Header          | Purpose                                |
|-----------------|----------------------------------------|
| `Accept`        | `application/json` (always)           |
| `Content-Type`  | `application/json` for request bodies  |
| `Authorization` | `Basic base64(user:pass)` or `Bearer jwt` |
| `Cookie`        | `AuthSession=token` for cookie auth    |
| `If-Match`      | Document revision for conditional ops  |
| `Destination`   | Target document ID for COPY method     |
| `X-Couch-Full-Commit` | `true` to force fsync          |

### Response Headers

| Header              | Purpose                              |
|---------------------|--------------------------------------|
| `Content-Type`      | `application/json` (always)          |
| `ETag`              | Document revision (quoted)           |
| `Set-Cookie`        | Session token from `/_session`       |
| `Transfer-Encoding` | `chunked` for streaming responses    |
| `X-Couch-Request-ID`| Request tracking ID                 |
| `X-CouchDB-Body-Time` | Time spent generating response    |
| `Server`            | `CouchDB/X.Y.Z (Erlang OTP/XX)`    |

## Transfer Encoding

CouchDB frequently uses `Transfer-Encoding: chunked` for responses, especially for:
- `/_changes` feeds
- `/_all_docs` with large result sets
- View queries
- `/_bulk_get` responses

Per RFC 7230 Section 4.1, chunked encoding format:
```
<chunk-size-hex>[;chunk-ext]\r\n
<chunk-data>\r\n
...
0\r\n
\r\n
```

The implementation correctly handles chunk extensions (`;key=value`) by stripping them before parsing the chunk size.

## Port of Call Implementation Notes

### Architecture

The implementation uses raw TCP sockets via Cloudflare's `connect()` API to construct HTTP/1.1 requests, since Cloudflare Workers cannot use the Fetch API for arbitrary TCP connections to non-HTTP services on custom ports.

### Endpoints Exposed

| Route                   | Handler               | Purpose                     |
|------------------------|-----------------------|-----------------------------|
| `POST /api/couchdb/health` | `handleCouchDBHealth` | Server info + database list |
| `POST /api/couchdb/query`  | `handleCouchDBQuery`  | Arbitrary HTTP requests     |

### Health Check Flow

1. `GET /` -- Retrieves server info (version, features, uuid, vendor)
2. `GET /_all_dbs` -- Lists all databases (may fail without admin auth)

### Supported HTTP Methods

`GET`, `POST`, `PUT`, `DELETE`, `HEAD`, `COPY`

The COPY method is CouchDB-specific and used for document duplication.

### Authentication

Basic Auth is supported. The implementation sends the `Authorization: Basic` header when a username is provided. Empty passwords are handled correctly (the credential format is `username:`).

Cookie-based session auth is not directly supported by the health/query proxy endpoints, but can be achieved by sending `POST /_session` via the query endpoint and manually managing cookies.

### Limitations

- No TLS support (port 6984) -- Cloudflare sockets `connect()` would need `secureTransport` option
- No cookie session management across requests (each request is independent)
- No `_changes` feed streaming (response is buffered, max 512KB)
- No attachment upload/download (binary content not handled)
- Responses larger than 512KB are truncated

## Quick Reference: Common curl Commands

```bash
# Server info
curl http://localhost:5984/

# Health check
curl http://localhost:5984/_up

# List databases
curl http://localhost:5984/_all_dbs

# Create database
curl -X PUT http://admin:pass@localhost:5984/newdb

# Create document
curl -X POST http://localhost:5984/mydb \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","age":30}'

# Read document
curl http://localhost:5984/mydb/docid

# Update document (requires _rev)
curl -X PUT http://localhost:5984/mydb/docid \
  -H "Content-Type: application/json" \
  -d '{"_rev":"1-abc123","name":"Alice","age":31}'

# Delete document
curl -X DELETE "http://localhost:5984/mydb/docid?rev=1-abc123"

# Copy document
curl -X COPY http://localhost:5984/mydb/docid \
  -H "Destination: newdocid"

# Mango query
curl -X POST http://localhost:5984/mydb/_find \
  -H "Content-Type: application/json" \
  -d '{"selector":{"age":{"$gt":25}}}'

# Replicate
curl -X POST http://localhost:5984/_replicate \
  -H "Content-Type: application/json" \
  -d '{"source":"mydb","target":"mydb_backup"}'

# Cookie auth
curl -X POST http://localhost:5984/_session \
  -H "Content-Type: application/json" \
  -d '{"name":"admin","password":"secret"}' \
  -c cookies.txt

curl -b cookies.txt http://localhost:5984/_all_dbs
```
