# MongoDB — Power User Reference

**Port:** 27017 | **Protocol:** MongoDB Wire Protocol (OP_MSG) | **Deployed**

Port of Call implements the MongoDB wire protocol from scratch — no `mongodb` npm library. All six endpoints open a direct TCP connection from the Cloudflare Worker, speak OP_MSG binary framing with hand-rolled BSON encoding/decoding, and return JSON.

**No authentication support.** Unauthenticated connections only. **No TLS.** Plain TCP only.

---

## API Endpoints

### `POST /api/mongodb/connect` — Server probe

Sends `hello` + `buildInfo` commands. Returns server version and replica set metadata without touching any user data.

**Request:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `27017` | |
| `timeout` | number (ms) | `10000` | |

**Success (200):**
```json
{
  "success": true,
  "host": "mongo.example.com",
  "port": 27017,
  "connectTime": 12,
  "rtt": 28,
  "serverInfo": {
    "version": "7.0.5",
    "gitVersion": "cf00f57f43de95a79c23e7d01b9c99e48dbe1dfe",
    "isWritablePrimary": true,
    "maxBsonObjectSize": 16777216,
    "maxMessageSizeBytes": 48000000,
    "maxWriteBatchSize": 100000,
    "minWireVersion": 0,
    "maxWireVersion": 21,
    "readOnly": null,
    "localTime": "2024-02-15T12:34:56.789Z",
    "ok": 1
  }
}
```

`connectTime` is TCP open latency; `rtt` is total time including both hello + buildInfo round trips.

`isWritablePrimary` falls back to the legacy `ismaster` field on older servers. `readOnly` is `null` unless the server sets it explicitly (e.g. secondary in a replica set with `slaveOk=false`).

---

### `POST /api/mongodb/ping` — Latency check

Sends the `ping` command. Faster than `/connect` — one round trip, no `buildInfo`.

**Request:** `{ "host", "port"?, "timeout"? }`

**Success (200):**
```json
{
  "success": true,
  "host": "mongo.example.com",
  "port": 27017,
  "rtt": 14,
  "ok": 1
}
```

---

### `POST /api/mongodb/find` — Query documents

**Request:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `27017` | |
| `database` | string | required | |
| `collection` | string | required | |
| `filter` | object | `{}` | BSON filter document |
| `projection` | object | — | Field inclusion/exclusion |
| `limit` | number | `20` | Capped at 100 |
| `skip` | number | `0` | |
| `timeout` | number (ms) | `10000` | |

**Success (200):**
```json
{
  "success": true,
  "host": "mongo.example.com",
  "port": 27017,
  "rtt": 35,
  "database": "myapp",
  "collection": "users",
  "documentCount": 2,
  "documents": [
    { "_id": "65c8f1a2b3d4e5f6a7b8c9d0", "name": "Alice", "age": 30 },
    { "_id": "65c8f1a2b3d4e5f6a7b8c9d1", "name": "Bob",   "age": 25 }
  ],
  "hasMore": false
}
```

**`hasMore` and cursor paging:** `hasMore: true` when the server returns a non-zero cursor ID — indicating more documents exist. There is no `/getMore` endpoint; you cannot page through results. If `hasMore` is true, increase `limit` (max 100) or add a more specific `filter`.

**`limit` cap:** Requests with `limit > 100` are silently clamped to 100 (not rejected). The default when `limit` is omitted is 20.

**`_id` field:** BSON ObjectId values are decoded as 24-character lowercase hex strings.

---

### `POST /api/mongodb/insert` — Insert documents

**Request:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `27017` | |
| `database` | string | required | |
| `collection` | string | required | |
| `documents` | array | required | Non-empty; max 100 |
| `ordered` | boolean | `true` | Stop on first error (`true`) or continue (`false`) |
| `timeout` | number (ms) | `10000` | |

**Success (200):**
```json
{
  "success": true,
  "host": "mongo.example.com",
  "port": 27017,
  "rtt": 22,
  "database": "myapp",
  "collection": "users",
  "inserted": 3,
  "message": "3 document(s) inserted"
}
```

**Error with write errors (200, success: false):**
```json
{
  "success": false,
  "error": "Insert failed",
  "code": 11000,
  "writeErrors": [
    { "index": 1, "code": 11000, "errmsg": "E11000 duplicate key error..." }
  ]
}
```

With `ordered: true` (default), a write error stops processing immediately. With `ordered: false`, all documents are attempted and all write errors are collected and returned.

**Inserting without `_id`:** If documents omit `_id`, MongoDB generates ObjectIds server-side. The response does not return the generated IDs — run a find with a unique field to retrieve them.

---

### `POST /api/mongodb/update` — Update documents

**Request:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `27017` | |
| `database` | string | required | |
| `collection` | string | required | |
| `filter` | object | required | Query filter |
| `update` | object | required | Update operators (e.g. `{ "$set": { ... } }`) |
| `multi` | boolean | `false` | `false` → updateOne; `true` → updateMany |
| `upsert` | boolean | `false` | Insert if no match |
| `timeout` | number (ms) | `10000` | |

**Success (200):**
```json
{
  "success": true,
  "host": "mongo.example.com",
  "port": 27017,
  "rtt": 18,
  "database": "myapp",
  "collection": "users",
  "matched": 1,
  "modified": 1,
  "upsertedId": null,
  "message": "1 document(s) modified"
}
```

**Upsert response (200):**
```json
{
  "success": true,
  "matched": 0,
  "modified": 0,
  "upsertedId": "65c8f1a2b3d4e5f6a7b8c9d2",
  "message": "0 document(s) modified"
}
```

**Wire format:** The update command uses the array form:
```
{ update: collection, updates: [{ q: filter, u: update, multi, upsert }], $db: database }
```

This means only a single update specification per request. Multiple filter/update pairs require multiple API calls.

**Replacement vs. operator updates:** Sending a document without update operators (e.g. `{ "name": "Alice" }`) replaces the matched document entirely (no `_id` change). Always use operators like `$set`, `$inc`, `$push` when you want partial updates.

---

### `POST /api/mongodb/delete` — Delete documents

**Request:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `27017` | |
| `database` | string | required | |
| `collection` | string | required | |
| `filter` | object | required | Query filter |
| `many` | boolean | `false` | `false` → deleteOne; `true` → deleteMany |
| `timeout` | number (ms) | `10000` | |

**Success (200):**
```json
{
  "success": true,
  "host": "mongo.example.com",
  "port": 27017,
  "rtt": 16,
  "database": "myapp",
  "collection": "users",
  "deleted": 1,
  "message": "1 document(s) deleted"
}
```

**Wire format:** `limit=1` for deleteOne, `limit=0` for deleteMany (MongoDB convention, not document count).

---

## Wire Protocol Details

### OP_MSG frame layout

```
[messageLength 4B LE] [requestID 4B LE] [responseTo 4B LE] [opCode 4B LE = 2013]
[flagBits 4B LE = 0x00000000]
[sectionKind 1B = 0x00]   (kind 0 = body section)
[BSON document]
```

Total header overhead: 21 bytes before the BSON payload.

OP_REPLY (opcode 1) is also parsed for backward compatibility: body begins at offset 36 (after header + responseFlags + cursorID + startingFrom + numberReturned). All modern MongoDB (3.6+) servers respond with OP_MSG.

### Response accumulation

`readFullResponse` reads the 4-byte `messageLength` from the first TCP chunk and accumulates additional chunks until the full message is received. This correctly handles TCP fragmentation on large result sets.

### BSON encoder (two variants)

The implementation uses two BSON encoders:

**`encodeBSON`** (simple) — used for internal command documents (hello, ping, buildInfo, find/insert/update/delete command frames). Supports: `int32`, `double`, `string`, `boolean`.

**`encodeBSONFull`** (full, recursive) — used for user-supplied data (filter, projection, update operators, insert documents). Supports everything above plus: `null`/`undefined`, nested objects (`DOCUMENT`), arrays (`ARRAY`). Integers in `[-2147483648, 2147483647]` encode as `INT32`; outside that range or non-integer numbers encode as `DOUBLE`. There is no `INT64` / `Long` encoding — 64-bit integers in filter documents will be encoded as `DOUBLE` (lossy for values > 2⁵³).

### BSON decoder type mapping

| BSON Type | Code | Decoded as |
|---|---|---|
| `DOUBLE` | 0x01 | JS number (float64) |
| `STRING` | 0x02 | JS string |
| `DOCUMENT` | 0x03 | Nested object |
| `ARRAY` | 0x04 | JS array |
| `OBJECTID` | 0x07 | 24-char lowercase hex string |
| `BOOLEAN` | 0x08 | JS boolean |
| `DATETIME` | 0x09 | ISO 8601 string (ms → `new Date().toISOString()`) |
| `NULL` | 0x0A | `null` |
| `INT32` | 0x10 | JS number |
| `TIMESTAMP` | 0x11 | `{ timestamp: uint32, increment: uint32 }` |
| `INT64` | 0x12 | JS number (hi * 0x100000000 + lo — loses precision > 2⁵³) |
| Unknown | — | Field is silently dropped; parsing stops at that point |

**`DATETIME` vs `TIMESTAMP`:** BSON DATETIME (0x09) is UTC milliseconds and decodes to ISO strings — this is the type used for `Date` fields in user documents. BSON TIMESTAMP (0x11) is MongoDB's internal replication timestamp (`{timestamp, increment}`) and is not a wall-clock date.

### Hello handshake on every data request

All data endpoints (find, insert, update, delete) open a fresh TCP connection and send `{ hello: 1, $db: <database> }` before the actual command. This doubles the round trips per request: one hello + one command = two OP_MSG exchanges. There is no connection pooling.

---

## Known Limitations

**No authentication.** The implementation does not implement SCRAM-SHA-1, SCRAM-SHA-256, MONGODB-CR, or X.509. Servers with `--auth` will return an `Unauthorized` error on the data commands.

**No TLS.** `cloudflare:sockets` `connect()` is called without `secureTransport`. Servers requiring TLS will reject the connection.

**No cursor paging.** When `hasMore: true`, there is no `/getMore` endpoint. You can only retrieve the first page (up to 100 documents). Workaround: use a more selective `filter` or use `skip` in combination with a fixed `limit`.

**INT64 precision loss.** BSON INT64 values larger than 2⁵³ (9007199254740992) will lose precision when decoded to a JavaScript number. This affects large ObjectId counters, timestamps stored as int64, and Decimal128 fields (which are not decoded at all — the parser will stop at the first unknown type in a document).

**No aggregation pipeline.** Only `find` (simple queries) is supported. `$group`, `$lookup`, `$unwind`, etc. require the `/find` command to accept a pipeline, which is not implemented.

**No collection/database listing.** There is no `listDatabases` or `listCollections` endpoint. Use `/find` with `filter: {}` on `system.namespaces` (MongoDB 3.x) or send a raw `listCollections` command via the session (not available).

**Inconsistent Cloudflare detection.** The `/connect`, `/update`, and `/delete` handlers check for Cloudflare-hosted targets and return HTTP 403. The `/find` and `/insert` handlers do not perform this check.

**`readOnly` field.** The `readOnly` field in the `/connect` response is only set when the server explicitly includes it in the hello response. It is `null` in most standalone deployments.

---

## curl Examples

```bash
# Probe: server version
curl -s -X POST https://portofcall.ross.gg/api/mongodb/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"mongo.example.com"}' | jq '.serverInfo | {version, isWritablePrimary, maxWireVersion}'

# Latency check
curl -s -X POST https://portofcall.ross.gg/api/mongodb/ping \
  -H 'Content-Type: application/json' \
  -d '{"host":"mongo.example.com"}' | jq '.rtt'

# Find all active users
curl -s -X POST https://portofcall.ross.gg/api/mongodb/find \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "mongo.example.com",
    "database": "myapp",
    "collection": "users",
    "filter": {"status": "active"},
    "projection": {"name": 1, "email": 1, "_id": 0},
    "limit": 50
  }' | jq '.documents[]'

# Find with nested field filter
curl -s -X POST https://portofcall.ross.gg/api/mongodb/find \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "mongo.example.com",
    "database": "myapp",
    "collection": "orders",
    "filter": {"address.city": "Seattle", "total": {"$gt": 100}},
    "limit": 20
  }' | jq '.documents'

# Insert documents
curl -s -X POST https://portofcall.ross.gg/api/mongodb/insert \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "mongo.example.com",
    "database": "myapp",
    "collection": "events",
    "documents": [
      {"type": "login", "userId": "u123", "ts": "2024-02-15T12:00:00Z"},
      {"type": "logout", "userId": "u123", "ts": "2024-02-15T12:30:00Z"}
    ]
  }' | jq '{inserted, message}'

# Update: set field on matching document
curl -s -X POST https://portofcall.ross.gg/api/mongodb/update \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "mongo.example.com",
    "database": "myapp",
    "collection": "users",
    "filter": {"email": "alice@example.com"},
    "update": {"$set": {"plan": "pro"}, "$inc": {"loginCount": 1}}
  }' | jq '{matched, modified}'

# Update: set on all matching (updateMany)
curl -s -X POST https://portofcall.ross.gg/api/mongodb/update \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "mongo.example.com",
    "database": "myapp",
    "collection": "users",
    "filter": {"trialExpired": true},
    "update": {"$set": {"status": "inactive"}},
    "multi": true
  }' | jq '{matched, modified}'

# Update: upsert
curl -s -X POST https://portofcall.ross.gg/api/mongodb/update \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "mongo.example.com",
    "database": "myapp",
    "collection": "counters",
    "filter": {"_id": "page_views"},
    "update": {"$inc": {"count": 1}},
    "upsert": true
  }' | jq '{matched, modified, upsertedId}'

# Delete one document
curl -s -X POST https://portofcall.ross.gg/api/mongodb/delete \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "mongo.example.com",
    "database": "myapp",
    "collection": "sessions",
    "filter": {"token": "abc123"}
  }' | jq '.deleted'

# Delete many (purge expired sessions)
curl -s -X POST https://portofcall.ross.gg/api/mongodb/delete \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "mongo.example.com",
    "database": "myapp",
    "collection": "sessions",
    "filter": {"expiresAt": {"$lt": "2024-01-01T00:00:00Z"}},
    "many": true
  }' | jq '.deleted'
```

---

## Local Testing

```bash
# MongoDB 7 — no auth (unauthenticated connections work)
docker run -d --name mongo-test -p 27017:27017 mongo:7

# MongoDB 7 — with auth (connections will fail on data commands)
docker run -d --name mongo-auth -p 27017:27017 \
  -e MONGO_INITDB_ROOT_USERNAME=admin \
  -e MONGO_INITDB_ROOT_PASSWORD=secret \
  mongo:7

# MongoDB 4.4 — uses OP_REPLY for some responses (supported)
docker run -d --name mongo44 -p 27017:27017 mongo:4.4

# Seed test data
mongosh --eval 'db.users.insertMany([
  {name:"Alice", age:30, status:"active"},
  {name:"Bob",   age:25, status:"inactive"}
])' myapp
```

---

## Resources

- [MongoDB Wire Protocol](https://www.mongodb.com/docs/manual/reference/mongodb-wire-protocol/)
- [OP_MSG specification](https://www.mongodb.com/docs/manual/reference/mongodb-wire-protocol/#op-msg)
- [BSON specification](http://bsonspec.org/)
- [MongoDB CRUD commands](https://www.mongodb.com/docs/manual/reference/command/nav-crud/)
- [Update operators reference](https://www.mongodb.com/docs/manual/reference/operator/update/)
