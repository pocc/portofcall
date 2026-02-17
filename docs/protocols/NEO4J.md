# Neo4j — Power User Reference

**Port:** 7687 | **Protocol:** Bolt Protocol | **Deployed**

Port of Call implements the Bolt protocol from scratch — no `neo4j-driver` npm library. All five endpoints open a direct TCP connection from the Cloudflare Worker, perform the Bolt handshake, exchange PackStream-encoded messages, and return JSON.

**Authentication:** `/connect` performs an anonymous probe (no credentials needed); all other endpoints require `username` + `password`.

**No TLS.** Plain TCP only.

---

## API Endpoints

### `POST /api/neo4j/connect` — Anonymous server probe

Performs the Bolt handshake and sends a HELLO with `scheme: none` (no credentials). Succeeds even on servers that require authentication — the `authRequired` flag tells you which case you hit.

**Request:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `7687` | |
| `timeout` | number (ms) | `10000` | |

**Success (200):**
```json
{
  "success": true,
  "host": "neo4j.example.com",
  "port": 7687,
  "connectTime": 11,
  "rtt": 34,
  "boltVersion": "5.4",
  "selectedVersion": 1284,
  "helloSuccess": true,
  "serverInfo": {
    "server": "Neo4j/5.15.0",
    "connection_id": "bolt-123",
    "hints": { "connection.recv_timeout_seconds": 120 }
  }
}
```

**Auth-required server (200 — still `success: true`):**
```json
{
  "success": true,
  "host": "neo4j.example.com",
  "port": 7687,
  "boltVersion": "5.4",
  "helloSuccess": false,
  "authRequired": true,
  "errorMessage": "Authentication required"
}
```

`success: true` is returned in both cases. Check `helloSuccess` and `authRequired` to distinguish open vs. auth-protected servers. `selectedVersion` is the raw uint32 from the handshake (e.g. `0x00000504` = `1284` decimal for v5.4).

---

### `POST /api/neo4j/query` — Execute Cypher (no parameters)

Authenticates and executes a Cypher query. Parameters are not supported — use `/query-params` for parameterized queries.

**Request:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `7687` | |
| `username` | string | `"neo4j"` | |
| `password` | string | `""` | |
| `query` | string | required | Cypher query text |
| `database` | string | — | Target DB (Bolt 4+ only; uses BEGIN with `db` metadata) |
| `timeout` | number (ms) | `15000` | |

**Success (200):**
```json
{
  "success": true,
  "host": "neo4j.example.com",
  "port": 7687,
  "boltVersion": "5.4",
  "serverVersion": "Neo4j/5.15.0",
  "columns": ["n.name", "n.age"],
  "rows": [
    ["Alice", 30],
    ["Bob", 25]
  ],
  "rowCount": 2
}
```

**Query error (200, success: false):**
```json
{
  "success": false,
  "host": "neo4j.example.com",
  "port": 7687,
  "boltVersion": "5.4",
  "error": "SyntaxError: Invalid input 'SLECT': expected ..."
}
```

**Row values:** Each element of `rows` is an array corresponding to `columns`. Values are raw PackStream-decoded types (see [PackStream Decoding](#packstream-decoding)). Bolt graph types (Node, Relationship, Path) are returned as `{ "_tag": <hex>, "_fields": [...] }` objects — not as typed documents.

---

### `POST /api/neo4j/query-params` — Cypher with parameters

Same as `/query` but accepts a `params` map that is PackStream-encoded and passed as the second argument to the Bolt `RUN` message. Use this for all queries with user-supplied data.

**Request:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `7687` | |
| `username` | string | `"neo4j"` | |
| `password` | string | `""` | |
| `query` | string | required | Cypher with `$param` placeholders |
| `params` | object | `{}` | Parameter map |
| `database` | string | — | Target DB (Bolt 4+ only) |
| `timeout` | number (ms) | `15000` | |

**Success (200):** Same shape as `/query`.

**`params` type encoding:** Sent as a PackStream map. Supported value types:

| JS type | PackStream encoding |
|---|---|
| `null`/`undefined` | `0xC0` |
| `boolean` | `0xC2`/`0xC3` |
| Integer in [-16, 127] | Tiny int (1 byte) |
| Integer [-128, -17] | Int8 `0xC8` |
| Integer [-32768, -129] or [128, 32767] | Int16 `0xC9` |
| Integer outside int16 range | Int32 `0xCA` |
| Non-integer number | Float64 `0xC1` (big-endian) |
| String | Tiny string or String8 |
| Array (< 16 elements) | Tiny list `0x9n` |
| Array (≥ 16 elements) | `0xD4, count` (not in decoder; round-trip not tested) |
| Object | Tiny map or Map8 |

**No int64 support.** Integer parameters outside `[-2147483648, 2147483647]` will be truncated by the Int32 encoder (the `packInteger` function uses bitwise ops which truncate to 32 bits).

---

### `GET /api/neo4j/schema` — Graph schema discovery

**Note: This is a GET request with query string parameters, not a POST with a JSON body.**

Authenticates and runs three schema procedures sequentially on the same connection:
- `CALL db.labels()`
- `CALL db.relationshipTypes()`
- `CALL db.propertyKeys()`

Returns empty arrays for any procedure that fails (e.g., insufficient privileges) — not an error.

**Request (query parameters):**

| Parameter | Default | Notes |
|---|---|---|
| `host` | required | |
| `port` | `7687` | |
| `username` | `"neo4j"` | |
| `password` | `""` | |

No `database` parameter. No configurable timeout (hardcoded to 15s).

**Success (200):**
```json
{
  "success": true,
  "host": "neo4j.example.com",
  "port": 7687,
  "boltVersion": "5.4",
  "schema": {
    "labels": ["Person", "Movie", "Genre"],
    "relationshipTypes": ["ACTED_IN", "DIRECTED", "FOLLOWS"],
    "propertyKeys": ["name", "born", "title", "released", "tagline"]
  }
}
```

**Community Edition Note:** `CALL db.labels()` returns labels visible in the current database only. On Neo4j 5.x you may need `SHOW LABELS` instead if `db.labels()` is deprecated.

---

### `POST /api/neo4j/create` — Create a node

Creates a single node with a label and properties. Validates the label against `/^[A-Za-z_][A-Za-z0-9_]*$/` before sending.

**Request:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `7687` | |
| `username` | string | `"neo4j"` | |
| `password` | string | `""` | |
| `label` | string | required | Node label (validated identifier) |
| `properties` | object | `{}` | Node properties |
| `database` | string | — | Target DB (Bolt 4+ only) |
| `timeout` | number (ms) | `15000` | |

**Success (200):**
```json
{
  "success": true,
  "host": "neo4j.example.com",
  "port": 7687,
  "boltVersion": "5.4",
  "label": "Person",
  "node": { "_tag": 78, "_fields": [1234, ["Person"], {"name": "Alice", "age": 30}] }
}
```

`node` is the raw PackStream struct from the RECORD response. Tag `78` = `0x4E` = Bolt Node. Fields are `[nodeId, labels[], properties{}]`.

**Invalid label (400):**
```json
{ "success": false, "error": "Label must be a valid identifier" }
```

Labels with spaces, hyphens, or special characters are rejected by the HTTP layer before reaching Neo4j. The Cypher uses backtick-escaping: `CREATE (n:\`${label}\` $props) RETURN n`.

---

## Wire Protocol Details

### Bolt Handshake

```
Client → [0x60 0x60 0xB0 0x17]   magic (4 bytes)
         [0x00 0x00 0x05 0x04]   offer v5.4
         [0x00 0x00 0x05 0x03]   offer v5.3
         [0x00 0x00 0x04 0x04]   offer v4.4
         [0x00 0x00 0x04 0x03]   offer v4.3
Server → [uint32 big-endian]     selected version (0 = none supported)
```

Version format: `(uint32 >> 8) & 0xFF` = major, `uint32 & 0xFF` = minor. Example: `0x00000504` → major=5, minor=4 → `"5.4"`.

If the server returns `0x00000000`, the connection closes with "Server does not support any offered Bolt protocol versions".

### Chunked Message Framing

All Bolt messages use chunked framing:
```
[chunk_size 2B big-endian] [chunk_data ...]   (repeated for large messages)
[0x00 0x00]                                   end-of-message marker
```

The implementation always sends messages as a single chunk (not multi-chunk). The end-of-message marker (`0x00 0x00`) is appended by `buildChunkedMessage`.

### Message Sequence (data endpoints)

```
Client → HELLO  { user_agent, scheme: "basic", principal, credentials }
Server → SUCCESS(serverInfo) | FAILURE(message)

[If Bolt 4+ and database specified:]
Client → BEGIN  { db: database }
Server → SUCCESS

Client → RUN    { query, params, [runMeta] }
Client → PULL   { [n: -1] }      ← pipelined (both sent before reading)
Server → SUCCESS { fields: ["col1", "col2", ...] }   ← RUN response
Server → RECORD { values: [...] }                     ← 0 or more
Server → SUCCESS { type, server }                     ← PULL summary
  OR
Server → FAILURE { message, code }
```

RUN and PULL are pipelined — both are written before reading any response. This is valid per the Bolt protocol and reduces round trips.

**Bolt 3 vs. Bolt 4+ RUN format:**

| Version | RUN struct fields |
|---|---|
| Bolt 3 | `[query_string, params_map]` |
| Bolt 4+ | `[query_string, params_map, run_metadata_map]` |

`run_metadata_map` contains `db` for database routing if specified; otherwise an empty map.

**Bolt 3 vs. Bolt 4+ PULL format:**

| Version | PULL struct |
|---|---|
| Bolt 3 | `packStruct(0x3F, [])` — zero fields |
| Bolt 4+ | `packStruct(0x3F, [{ n: -1 }])` — `n=-1` means fetch all |

### PackStream Encoding

PackStream is a type-length-value format similar to MessagePack.

**Marker byte ranges:**

| Range | Type |
|---|---|
| `0x00`–`0x7F` | Tiny integer (0–127) |
| `0x80`–`0x8F` | Tiny string (0–15 UTF-8 bytes) |
| `0x90`–`0x9F` | Tiny list (0–15 elements) |
| `0xA0`–`0xAF` | Tiny map (0–15 entries) |
| `0xB0`–`0xBF` | Tiny struct (0–15 fields) |
| `0xC0` | Null |
| `0xC1` | Float64 (8 bytes, big-endian) |
| `0xC2` | Boolean false |
| `0xC3` | Boolean true |
| `0xC8` | Int8 (1 byte) |
| `0xC9` | Int16 (2 bytes, big-endian) |
| `0xCA` | Int32 (4 bytes, big-endian) |
| `0xD0` | String8 (1-byte length prefix) |
| `0xD1` | String16 (2-byte big-endian length prefix) |
| `0xD8` | Map8 (1-byte count) |
| `0xF0`–`0xFF` | Tiny integer (−16 to −1) |

**Unknown markers:** The decoder advances by 1 byte and returns `null`, which stops parsing at that field. On a response with Int64 fields (0xCB), the entire message will be truncated — all remaining fields after the Int64 become null.

### PackStream Decoding

The `unpackValue` decoder maps PackStream types to JS values:

| Type | Result |
|---|---|
| Tiny int / Int8/16/32 | JS number |
| Float64 | JS number |
| String (all forms) | JS string |
| Boolean | JS boolean |
| Null | `null` |
| Tiny list | `unknown[]` |
| Tiny/Map8 map | `Record<string, unknown>` |
| Tiny struct | `{ _tag: number, _fields: unknown[] }` |
| Unknown marker | `null` (stops parsing at that field) |

**Graph type structs from RECORD responses:**

| Tag | Type | `_fields` layout |
|---|---|---|
| `0x4E` (78) | Node | `[nodeId, [labels...], {properties}]` |
| `0x52` (82) | Relationship | `[id, startNodeId, endNodeId, "TYPE", {properties}]` |
| `0x50` (80) | Path | `[nodes[], rels[], sequence[]]` |

These structs are not unpacked further — `MATCH (n) RETURN n` returns each node as `{ "_tag": 78, "_fields": [id, ["Label"], {key: val}] }`. Parse `_fields[2]` to get the properties map.

### Response Accumulator

`readBoltMessages` accumulates raw bytes across multiple TCP reads using a deadline loop. It parses chunk headers, skips `0x0000` end-of-message markers, and stops reading when a terminal message (`SUCCESS=0x70` or `FAILURE=0x7F`) is found. This correctly handles:
- Pipelined responses where RUN SUCCESS arrives before RECORD chunks
- Large result sets fragmented across TCP reads

The `/connect` endpoint uses the older single-read `parseResponse` function instead, which reads only the first TCP chunk. This is sufficient for the HELLO response but would truncate oversized server responses.

---

## Known Limitations

**No TLS.** `cloudflare:sockets` `connect()` is plain TCP. Neo4j AuraDB and cloud instances require TLS — connections will fail or be rejected.

**No Int64 encoding.** `packInteger` uses bitwise operations that truncate to 32 bits. Parameters with integer values outside `[-2147483648, 2147483647]` are silently truncated. Use strings for large IDs.

**No Int64 decoding.** The decoder does not handle `0xCB` (Int64). A response containing Int64 fields (e.g., node IDs on large databases, timestamps) will have those fields decoded as `null`, and any subsequent fields in the same map will also be lost.

**Struct encoding limited to 15 fields.** `packStruct` uses the tiny struct format (`0xB0|fieldCount`). Commands with 16+ fields are not supported — this is not a practical limitation for the current endpoints.

**No multi-chunk send.** Messages are always sent as a single chunk. Very long Cypher queries (>65535 bytes) would overflow the 2-byte chunk size field, though no validation catches this.

**`/schema` is GET, not POST.** Unlike all other endpoints, query parameters are used instead of a JSON body. No `database` routing is available.

**`/create` returns raw Node struct.** The created node is in `{ _tag: 78, _fields: [...] }` form. The properties are in `_fields[2]`.

**BEGIN only on Bolt 4+ with `database` set.** If you omit `database`, no BEGIN is sent and no explicit database selection occurs — the server uses its configured default database.

**Bolt 3 auth branch is identical to Bolt 4+.** Both branches of `openBoltSession` send auth in HELLO. No functional difference; just dead code.

---

## curl Examples

```bash
# Probe: detect server version and whether auth is required
curl -s -X POST https://portofcall.ross.gg/api/neo4j/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"neo4j.example.com"}' | jq '{boltVersion, helloSuccess, authRequired, server: .serverInfo.server}'

# Count all nodes
curl -s -X POST https://portofcall.ross.gg/api/neo4j/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "neo4j.example.com",
    "username": "neo4j",
    "password": "secret",
    "query": "MATCH (n) RETURN count(n) AS total"
  }' | jq '.rows[0][0]'

# Find nodes with relationship depth
curl -s -X POST https://portofcall.ross.gg/api/neo4j/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "neo4j.example.com",
    "username": "neo4j",
    "password": "secret",
    "query": "MATCH (a:Person)-[:KNOWS*1..2]-(b:Person) WHERE a.name = '\''Alice'\'' RETURN DISTINCT b.name AS name, b.age AS age ORDER BY b.name"
  }' | jq '.rows[] | {name: .[0], age: .[1]}'

# Parameterized query (safe for user input)
curl -s -X POST https://portofcall.ross.gg/api/neo4j/query-params \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "neo4j.example.com",
    "username": "neo4j",
    "password": "secret",
    "query": "MATCH (n:Person {name: $name}) RETURN n.age AS age",
    "params": {"name": "Alice"}
  }' | jq '.rows[0][0]'

# Create node with properties
curl -s -X POST https://portofcall.ross.gg/api/neo4j/create \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "neo4j.example.com",
    "username": "neo4j",
    "password": "secret",
    "label": "Movie",
    "properties": {"title": "The Matrix", "released": 1999}
  }' | jq '.node._fields | {id: .[0], labels: .[1], props: .[2]}'

# Graph schema discovery
curl -s "https://portofcall.ross.gg/api/neo4j/schema?host=neo4j.example.com&username=neo4j&password=secret" \
  | jq '.schema | {labels: (.labels | length), relTypes: (.relationshipTypes | length), propKeys: (.propertyKeys | length)}'

# Multi-hop path query
curl -s -X POST https://portofcall.ross.gg/api/neo4j/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "neo4j.example.com",
    "username": "neo4j",
    "password": "secret",
    "query": "MATCH (a:Person)-[r:ACTED_IN]->(m:Movie) RETURN a.name AS actor, m.title AS movie, r.roles AS roles LIMIT 10"
  }' | jq '.rows[] | {actor: .[0], movie: .[1], roles: .[2]}'

# Database selection (Bolt 4+, named database)
curl -s -X POST https://portofcall.ross.gg/api/neo4j/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "neo4j.example.com",
    "username": "neo4j",
    "password": "secret",
    "query": "RETURN db.info().name AS db",
    "database": "movies"
  }' | jq '.rows[0][0]'
```

---

## Local Testing

```bash
# Neo4j 5 — default auth (neo4j/neo4j, must change on first login)
docker run -d --name neo4j5 \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/testpassword \
  neo4j:5

# Neo4j 5 — no auth
docker run -d --name neo4j5-open \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=none \
  neo4j:5

# Load the movies dataset (from Neo4j browser at localhost:7474)
:play movies
# Or via cypher-shell:
cypher-shell -u neo4j -p testpassword \
  "CALL apoc.import.json('https://data.neo4j.com/bulk-importer/movies-with-ids.json')"
```

---

## Bolt Message Type Reference

| Tag | Name | Direction | Notes |
|---|---|---|---|
| `0x01` | HELLO | Client→Server | Auth + user_agent |
| `0x10` | RUN | Client→Server | Cypher query |
| `0x11` | BEGIN | Client→Server | Start explicit transaction |
| `0x12` | COMMIT | Client→Server | Not used by implementation |
| `0x13` | ROLLBACK | Client→Server | Not used by implementation |
| `0x3F` | PULL | Client→Server | Fetch result rows |
| `0x70` | SUCCESS | Server→Client | Terminal or intermediate success |
| `0x71` | RECORD | Server→Client | One result row |
| `0x7E` | IGNORED | Server→Client | Not handled by decoder |
| `0x7F` | FAILURE | Server→Client | Error with `message` + `code` |

---

## Resources

- [Bolt Protocol specification](https://neo4j.com/docs/bolt/current/)
- [PackStream specification](https://neo4j.com/docs/bolt/current/packstream/)
- [Cypher query language](https://neo4j.com/docs/cypher-manual/current/)
- [Neo4j graph types in Bolt](https://neo4j.com/docs/bolt/current/bolt/structure-semantics/)
