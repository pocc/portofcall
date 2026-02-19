# RethinkDB — Power-User Reference

**Port:** 28015 (default driver port)
**Transport:** TCP (Cloudflare Workers `connect()`)
**Implementation:** `src/worker/rethinkdb.ts`
**Routes:** 7 endpoints (connect, probe, query, list-tables, server-info, table-create, insert)

Complete RethinkDB wire protocol implementation supporting both legacy V0.4 (auth key) and modern V1.0 (SCRAM-SHA-256) authentication. Sends ReQL queries as JSON over binary protocol frames. No connection pooling — each request opens a fresh TCP connection.

---

## Endpoints

### `POST /api/rethinkdb/connect`

Test V0.4 legacy protocol connectivity with optional auth key. Sends magic number + auth key + protocol version, reads null-terminated response.

**Request:**
```json
{
  "host": "localhost",
  "port": 28015,
  "authKey": "",
  "timeout": 10000
}
```

| Field     | Required | Default  | Notes |
|-----------|----------|----------|-------|
| `host`    | Yes      | —        | Hostname or IP. No format validation. |
| `port`    | No       | `28015`  | Validated 1–65535. |
| `authKey` | No       | `""`     | Legacy auth key (cleartext). Modern RethinkDB ignores this. |
| `timeout` | No       | `10000`  | Milliseconds. Single timer covers connect + handshake + response. |

**Success response:**
```json
{
  "success": true,
  "host": "localhost",
  "port": 28015,
  "rtt": 23,
  "connectTime": 12,
  "protocolVersion": "V0.4",
  "isRethinkDB": true,
  "authenticated": false,
  "serverVersion": "V1.0 (SCRAM-SHA-256)",
  "rawResponse": "{\"success\":false,\"error_code\":16,\"error\":\"Client provided protocol version 1883532903, but this server only supports protocol version 0.\"}",
  "message": "RethinkDB server detected. {\"success\":false,\"error_code\":16,\"error\":\"Client provided protocol version 1883532903...\"}"
}
```

**Notes:**
- Modern RethinkDB (≥2.0) rejects V0.4 handshake with error — still detectable as RethinkDB
- `authenticated: true` only if server responds `"SUCCESS"` (very old versions)
- `serverVersion` is protocol version detected from response shape, not actual RethinkDB version string

---

### `POST /api/rethinkdb/probe`

Detect RethinkDB V1.0 (modern) without completing full authentication. Sends V1.0 magic + SCRAM init, reads server capabilities.

**Request:**
```json
{
  "host": "localhost",
  "port": 28015,
  "timeout": 10000
}
```

| Field     | Required | Default  | Notes |
|-----------|----------|----------|-------|
| `host`    | Yes      | —        | No format validation. |
| `port`    | No       | `28015`  | Validated 1–65535. |
| `timeout` | No       | `10000`  | Milliseconds. |

**Success response:**
```json
{
  "success": true,
  "host": "localhost",
  "port": 28015,
  "rtt": 18,
  "isRethinkDB": true,
  "serverVersion": "V1.0 (SCRAM-SHA-256)",
  "rawResponse": "{\"success\":false,\"error_code\":12,\"error\":\"Server authentication required.\"}",
  "message": "RethinkDB server detected. {\"success\":false,\"error_code\":12,\"error\":\"Server authentication required.\"}"
}
```

**Notes:**
- Does not send password — server rejects with error code 12 (auth required)
- Faster than `/connect` for detection (no auth round-trips)
- Response JSON includes `min_protocol_version` and `max_protocol_version` fields in some cases

---

### `POST /api/rethinkdb/query`

Execute arbitrary ReQL JSON query after SCRAM-SHA-256 authentication. Full wire protocol: magic + SCRAM handshake → query packet → response packet.

**Request:**
```json
{
  "host": "localhost",
  "port": 28015,
  "password": "",
  "query": "[1,[39],{}]",
  "timeout": 15000
}
```

| Field      | Required | Default  | Notes |
|------------|----------|----------|-------|
| `host`     | Yes      | —        | No format validation. |
| `port`     | No       | `28015`  | Validated 1–65535. |
| `password` | No       | `""`     | SCRAM-SHA-256 password. Empty string for no-auth mode. |
| `query`    | Yes      | —        | Raw ReQL JSON string (see query format below). |
| `timeout`  | No       | `15000`  | Milliseconds. Covers auth + query + response. |

**ReQL JSON query format:**
```
[query_type, query_term, options]
```

Common query types:
- `1` = START (execute query)
- `2` = CONTINUE (fetch next batch for partial results)
- `3` = STOP (cancel query)
- `5` = SERVER_INFO (no term needed)

**Example queries:**

| ReQL Expression          | JSON Query                              |
|--------------------------|----------------------------------------|
| `r.tableList()`          | `[1,[39],{}]`                          |
| `r.db("test").tableList()` | `[1,[15,[[14,[["test"]]]]],{}]`      |
| `r.serverInfo()`         | `[5]`                                  |

Term opcodes (partial list):
- `14` = DB
- `15` = TABLE_LIST
- `39` = TABLE_LIST (alternate)
- `56` = INSERT
- `60` = TABLE_CREATE

**Success response:**
```json
{
  "success": true,
  "host": "localhost",
  "port": 28015,
  "rtt": 42,
  "responseType": "SUCCESS_SEQUENCE",
  "results": ["users", "posts", "comments"],
  "rawResponse": "{\"t\":2,\"r\":[\"users\",\"posts\",\"comments\"]}"
}
```

**Error response (auth failure):**
```json
{
  "success": false,
  "error": "Authentication failed: Server nonce does not start with client nonce"
}
```

**Error response (query error):**
```json
{
  "success": false,
  "host": "localhost",
  "port": 28015,
  "rtt": 38,
  "responseType": "RUNTIME_ERROR",
  "results": ["Database `nosuchdb` does not exist."],
  "error": "Database `nosuchdb` does not exist.",
  "rawResponse": "{\"t\":19,\"r\":[\"Database `nosuchdb` does not exist.\"]}"
}
```

**Response types:**

| Code | Name               | Meaning |
|------|--------------------|---------|
| 1    | SUCCESS_ATOM       | Single value result |
| 2    | SUCCESS_SEQUENCE   | Array of results (complete) |
| 3    | SUCCESS_PARTIAL    | Partial results (use CONTINUE to fetch more) |
| 4    | WAIT_COMPLETE      | NOREPLY_WAIT finished |
| 16   | SERVER_INFO        | Server metadata |
| 17   | CLIENT_ERROR       | Malformed query |
| 18   | COMPILE_ERROR      | Query doesn't compile |
| 19   | RUNTIME_ERROR      | Query execution failed |

---

### `POST /api/rethinkdb/list-tables`

List all tables in a database. Convenience wrapper around `r.db(db).tableList()`.

**Request:**
```json
{
  "host": "localhost",
  "port": 28015,
  "password": "",
  "db": "test",
  "timeout": 15000
}
```

| Field      | Required | Default      | Notes |
|------------|----------|--------------|-------|
| `host`     | Yes      | —            | No format validation. |
| `port`     | No       | `28015`      | Validated 1–65535. |
| `password` | No       | `""`         | SCRAM-SHA-256 password. |
| `db`       | No       | `"rethinkdb"` | Database name. System db is `"rethinkdb"`. |
| `timeout`  | No       | `15000`      | Milliseconds. |

**Success response:**
```json
{
  "success": true,
  "host": "localhost",
  "port": 28015,
  "db": "test",
  "rtt": 35,
  "tables": ["users", "posts"],
  "responseType": "SUCCESS_SEQUENCE"
}
```

**Error response (database doesn't exist):**
```json
{
  "success": false,
  "host": "localhost",
  "port": 28015,
  "db": "nosuchdb",
  "rtt": 28,
  "responseType": "RUNTIME_ERROR",
  "error": "Database `nosuchdb` does not exist."
}
```

---

### `POST /api/rethinkdb/server-info`

Get server metadata via SERVER_INFO query (query_type=5). Returns server ID, name, and version string.

**Request:**
```json
{
  "host": "localhost",
  "port": 28015,
  "password": "",
  "timeout": 15000
}
```

| Field      | Required | Default  | Notes |
|------------|----------|----------|-------|
| `host`     | Yes      | —        | No format validation. |
| `port`     | No       | `28015`  | Validated 1–65535. |
| `password` | No       | `""`     | SCRAM-SHA-256 password. |
| `timeout`  | No       | `15000`  | Milliseconds. |

**Success response:**
```json
{
  "success": true,
  "host": "localhost",
  "port": 28015,
  "rtt": 31,
  "serverId": "8e4c6f12-3a9b-4d5e-8f7a-1b2c3d4e5f6a",
  "serverName": "rethinkdb_master",
  "serverVersion": "2.4.1 (CLANG 11.0.0 (clang-1100.0.33.17))",
  "responseType": "SERVER_INFO"
}
```

**Notes:**
- `serverVersion` is the actual RethinkDB version string (unlike `/connect` which returns protocol version)
- Response type is 16 (SERVER_INFO), not SUCCESS_ATOM

---

### `POST /api/rethinkdb/table-create`

Create a new table in a database. Executes `r.db(db).tableCreate(name)`.

**Request:**
```json
{
  "host": "localhost",
  "port": 28015,
  "password": "",
  "db": "test",
  "name": "my_table",
  "timeout": 15000
}
```

| Field      | Required | Default               | Notes |
|------------|----------|-----------------------|-------|
| `host`     | Yes      | —                     | No format validation. |
| `port`     | No       | `28015`               | Validated 1–65535. |
| `password` | No       | `""`                  | SCRAM-SHA-256 password. |
| `db`       | No       | `"test"`              | Database name. |
| `name`     | No       | `"portofcall_{timestamp}"` | Table name. Auto-generated if omitted. |
| `timeout`  | No       | `15000`               | Milliseconds. |

**Success response:**
```json
{
  "success": true,
  "host": "localhost",
  "port": 28015,
  "rtt": 48,
  "tableName": "my_table",
  "db": "test",
  "created": 1,
  "responseType": "SUCCESS_ATOM"
}
```

**Error response (table already exists):**
```json
{
  "success": false,
  "host": "localhost",
  "port": 28015,
  "rtt": 35,
  "tableName": "my_table",
  "db": "test",
  "created": 0,
  "responseType": "RUNTIME_ERROR",
  "error": "Table `test.my_table` already exists."
}
```

---

### `POST /api/rethinkdb/insert`

Insert documents into a table. Executes `r.db(db).table(table).insert(docs)`.

**Request:**
```json
{
  "host": "localhost",
  "port": 28015,
  "password": "",
  "db": "test",
  "table": "users",
  "docs": [
    {"name": "Alice", "email": "alice@example.com"},
    {"name": "Bob", "email": "bob@example.com"}
  ],
  "timeout": 15000
}
```

| Field      | Required | Default                             | Notes |
|------------|----------|-------------------------------------|-------|
| `host`     | Yes      | —                                   | No format validation. |
| `port`     | No       | `28015`                             | Validated 1–65535. |
| `password` | No       | `""`                                | SCRAM-SHA-256 password. |
| `db`       | No       | `"test"`                            | Database name. |
| `table`    | No       | `"portofcall"`                      | Table name. |
| `docs`     | No       | `[{"source":"portofcall","ts":...}]` | Array of JSON objects. |
| `timeout`  | No       | `15000`                             | Milliseconds. |

**Success response:**
```json
{
  "success": true,
  "host": "localhost",
  "port": 28015,
  "rtt": 52,
  "db": "test",
  "table": "users",
  "inserted": 2,
  "errors": 0,
  "generatedKeys": [
    "8e4c6f12-3a9b-4d5e-8f7a-1b2c3d4e5f6a",
    "9f5d7e23-4b0c-5e6f-9a8b-2c3d4e5f6a7b"
  ],
  "responseType": "SUCCESS_ATOM"
}
```

**Notes:**
- RethinkDB auto-generates `id` field (UUID) for documents without one
- `generatedKeys` array contains the UUIDs
- `errors` count includes conflicts (duplicate primary keys)

---

## Wire Protocol Details

### V0.4 (Legacy) Handshake

```
Client                                  Server
  │─────── [magic][authKeyLen][authKey][protocol] ─────▶│
  │◀────────── null-terminated response ────────────────│
```

**Binary format:**
1. Magic number: `0xD3CCAA08` (4 bytes, little-endian)
2. Auth key length: `uint32` (4 bytes, little-endian)
3. Auth key: UTF-8 string (variable length)
4. Protocol version: `0x7E6970C7` (4 bytes, little-endian = JSON protocol)

**Response:**
- Null-terminated ASCII string
- `"SUCCESS"` = authenticated (ancient versions)
- `"ERROR: ..."` = auth failed
- JSON object = modern server rejecting V0.4

### V1.0 (Modern) SCRAM-SHA-256 Handshake

```
Client                                  Server
  │────── [magic][client-first-msg\0] ──────────────────▶│
  │◀───── [server-first-msg\0] ───────────────────────────│
  │────── [client-final-msg\0] ───────────────────────────▶│
  │◀───── [server-final-msg\0] ───────────────────────────│
  │                                                        │
  │──── authenticated, ready for query packets ────────────│
```

**Binary format (all messages):**
1. First packet: Magic `0x400C2D20` (4 bytes, little-endian) + null-terminated JSON
2. Subsequent packets: Null-terminated JSON strings only

**Client-first message:**
```json
{
  "protocol_version": 0,
  "authentication_method": "SCRAM-SHA-256",
  "authentication": "n,,n=admin,r={clientNonce}"
}
```

**Server-first response:**
```json
{
  "success": false,
  "authentication": "r={serverNonce},s={saltBase64},i={iterations}"
}
```

- `serverNonce` must start with `clientNonce` (verification)
- `saltBase64` is PBKDF2 salt (base64-encoded)
- `iterations` is PBKDF2 iteration count (typically 4096)

**Client-final message:**
```json
{
  "authentication": "c=biws,r={serverNonce},p={clientProofBase64}"
}
```

- `c=biws` = channel binding "n,," in base64 ("biws")
- `p=` client proof: `clientKey XOR clientSignature` (base64)

**Server-final response:**
```json
{
  "success": true,
  "authentication": "v={serverSignatureBase64}"
}
```

- Implementation verifies server signature to prevent MitM

**SCRAM-SHA-256 cryptographic flow:**

1. **Salted password:** `PBKDF2-HMAC-SHA-256(password, salt, iterations, 256 bits)`
2. **Client key:** `HMAC-SHA-256(saltedPassword, "Client Key")`
3. **Stored key:** `SHA-256(clientKey)`
4. **Server key:** `HMAC-SHA-256(saltedPassword, "Server Key")`
5. **Auth message:** `"{clientFirstBare},{serverFirst},{clientFinalWithoutProof}"`
6. **Client signature:** `HMAC-SHA-256(storedKey, authMessage)`
7. **Client proof:** `clientKey XOR clientSignature`
8. **Server signature:** `HMAC-SHA-256(serverKey, authMessage)`

All HMAC operations use WebCrypto (`crypto.subtle`). No external dependencies.

### Query/Response Packets (Post-Auth)

**Query packet format:**
```
[token: 8 bytes LE][length: 4 bytes LE][query_json: length bytes]
```

- `token`: 64-bit query ID (implementation always uses `1`, low-word only)
- `length`: JSON payload byte count
- `query_json`: ReQL query as JSON string (not null-terminated)

**Response packet format:**
```
[token: 8 bytes LE][length: 4 bytes LE][response_json: length bytes]
```

- `token`: Echo of query token
- `length`: JSON response byte count (max 16 MB enforced by implementation)
- `response_json`: `{"t": responseType, "r": [results...]}`

**Response JSON structure:**
```json
{
  "t": 2,
  "r": ["table1", "table2"],
  "n": [...]
}
```

- `t` = response type (1-19, see table above)
- `r` = results array
- `n` = notes (optional, not parsed by implementation)

---

## Known Quirks and Limitations

### Resource leak fixed (timeouts)
**Fixed in latest code.** All handlers now clear `setTimeout()` timers via `clearTimeout(timeoutHandle)` in `finally` blocks. Previous versions leaked timers on every successful request.

### Buffer corruption fixed (readExact)
**Fixed in latest code.** `readExact()` now correctly handles partial chunks and returns exactly the requested byte count. Previous versions could overshoot by including extra bytes from the last chunk.

### Connection pooling not implemented
Each request opens a fresh TCP connection, performs handshake (SCRAM-SHA-256 takes ~2-4 round-trips), executes query, and closes. This adds 20-80ms overhead per request. The RethinkDB driver spec recommends connection pooling for production workloads.

### No transaction support
Queries execute in auto-commit mode. Multi-statement transactions (`r.do()` blocks with intermediate writes) are not supported via this implementation.

### Token always 1
Query packets use hardcoded token `1` (8 bytes, low-word only). Concurrent queries on the same connection would collide (but implementation never reuses connections).

### Response length not validated before allocation
`readQueryResponse()` reads 4-byte `length` field and allocates buffer blindly. **Fixed:** 16 MB limit enforced in `readExact()` to prevent memory exhaustion attacks.

### No auth method negotiation
Implementation only supports SCRAM-SHA-256. If server requires different auth (e.g. certificate-based), connection fails with error code 12.

### SCRAM nonce uses Math.random()
Client nonce includes `Math.random().toString(36).slice(2)` for randomness. Not cryptographically secure but acceptable for nonce (PBKDF2 salt from server is crypto-secure).

### Password sent in cleartext during SCRAM
The password itself is not sent — only derived keys and proofs. SCRAM is MITM-resistant: attacker cannot replay client proof or derive password from observed traffic. However, traffic is **not encrypted** (plain TCP). Use TLS tunnel for production.

### Server signature verification
Implementation correctly verifies server signature (`v=` field) to prevent MitM attacks. Many client libraries skip this check.

### No CONTINUE support for partial results
Query responses with `t: 3` (SUCCESS_PARTIAL) require sending CONTINUE queries to fetch remaining batches. Implementation parses partial flag but doesn't provide helper for pagination.

### No cursor cleanup
Queries that return partial results create server-side cursors. Implementation never sends STOP (query_type=3) to close cursors, relying on server timeout (default 60s).

### Empty password = no-auth mode
Passing `password: ""` skips SCRAM proofs. Server may respond `{"success": true}` without `authentication` field, indicating no-auth mode (development servers).

### No reconnection logic
Connection errors (timeout, refused, reset) return immediately. No retry or exponential backoff.

### Shared timeout across handshake + query
Single `setTimeout()` timer covers connection open + SCRAM handshake + query execution + response read. If SCRAM takes 14s of a 15s timeout, only 1s remains for query. Worst case: total wall-clock time ≈ `timeout`.

### No Cloudflare detection in some endpoints
Early versions of `/connect`, `/probe`, `/query` lacked `checkIfCloudflare()` calls. **Fixed in latest code:** All endpoints now call `cfBlock()` which checks Cloudflare IPs.

### Port validation inconsistent
Some endpoints validated port range (1-65535), others didn't. **Fixed:** All endpoints now validate port.

### connect() signature inconsistency fixed
Early versions of `/table-create` and `/insert` used `connect({ hostname, port })` object syntax instead of `connect("host:port")` string. **Fixed:** All endpoints now use consistent string format.

### No TLS support
Implementation uses plain TCP (`connect()` without `secureTransport`). RethinkDB does not natively support TLS on port 28015 — production deployments use TLS tunnels (stunnel, SSH, WireGuard).

### No admin key support
RethinkDB <2.0 supported `admin` account with master key. Modern versions use per-user auth. Implementation hardcodes `n=admin` in SCRAM client-first but never sends an admin key.

### Database/table name injection
Query JSON is built via string concatenation:
```ts
JSON.stringify([1, [TERM_TABLE_LIST, [[TERM_DB, [[db]]]]], {}])
```
If `db` contains special characters (e.g. `test"]]`), the JSON may become malformed. However, `JSON.stringify()` handles escaping correctly — no actual injection risk.

### No changefeeds support
Changefeeds (`r.table("users").changes()`) are long-running cursors. Implementation closes socket immediately after first response, breaking changefeeds. Would require WebSocket upgrade or persistent connection.

### V0.4 detection false positives
`detectProtocolVersion()` checks for `"SUCCESS"`, `"ERROR:"`, or JSON response. A non-RethinkDB server echoing JSON could be misidentified. Not a security issue (just detection heuristic).

### No binary data support
Documents with binary fields (e.g. images stored as `r.binary()`) are not handled. ReQL wire protocol supports binary via pseudo-type JSON but implementation doesn't parse it.

### No geospatial query support
Geometric types (POINT, LINE, POLYGON) in ReQL are not parsed. Results appear as raw JSON objects.

### Array ordering preserved
ReQL guarantees array order in responses. Implementation uses standard `JSON.parse()` which preserves order per ECMA-262.

### Timestamp precision
ReQL stores timestamps as seconds since epoch (float64). JavaScript `Date.now()` returns milliseconds (integer). Conversion may lose sub-millisecond precision.

---

## curl Examples

**Probe for RethinkDB (modern):**
```bash
curl -s -X POST https://portofcall.app/api/rethinkdb/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost"}' | jq .
```

**List tables in system database:**
```bash
curl -s -X POST https://portofcall.app/api/rethinkdb/list-tables \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","db":"rethinkdb"}' | jq .tables
```

**Get server info:**
```bash
curl -s -X POST https://portofcall.app/api/rethinkdb/server-info \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost"}' | jq '{serverId,serverName,serverVersion}'
```

**Raw query (table list):**
```bash
curl -s -X POST https://portofcall.app/api/rethinkdb/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","query":"[1,[39],{}]"}' | jq .results
```

**Create table:**
```bash
curl -s -X POST https://portofcall.app/api/rethinkdb/table-create \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","db":"test","name":"users"}' | jq .
```

**Insert documents:**
```bash
curl -s -X POST https://portofcall.app/api/rethinkdb/insert \
  -H 'Content-Type: application/json' \
  -d '{
    "host":"localhost",
    "db":"test",
    "table":"users",
    "docs":[{"name":"Alice"},{"name":"Bob"}]
  }' | jq '{inserted,generatedKeys}'
```

**With password (SCRAM-SHA-256):**
```bash
curl -s -X POST https://portofcall.app/api/rethinkdb/list-tables \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","password":"secret","db":"test"}' | jq .
```

**Custom timeout (2 seconds):**
```bash
curl -s -X POST https://portofcall.app/api/rethinkdb/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","timeout":2000}' | jq '{rtt}'
```

---

## ReQL Term Reference (Common Opcodes)

Implementation supports arbitrary ReQL JSON queries. Common term opcodes:

| Code | Name         | Example ReQL          | JSON AST |
|------|--------------|-----------------------|----------|
| 14   | DB           | `r.db("test")`        | `[14, [["test"]]]` |
| 15   | TABLE_LIST   | `.tableList()`        | `[15, [[DB, ...]]]` |
| 16   | TABLE        | `.table("users")`     | `[16, [[DB, ...], ["users"]]]` |
| 39   | DB_LIST      | `r.dbList()`          | `[39, []]` |
| 56   | INSERT       | `.insert({...})`      | `[56, [[TABLE, ...], [docs]]]` |
| 60   | TABLE_CREATE | `.tableCreate("t")`   | `[60, [[DB, ...], ["t"]]]` |
| 61   | TABLE_DROP   | `.tableDrop("t")`     | `[61, [[DB, ...], ["t"]]]` |
| 62   | TABLE_INDEX  | `.indexList()`        | `[62, [[TABLE, ...]]]` |

Full term list: https://rethinkdb.com/docs/writing-drivers/

**Query type codes:**
- `1` = START (execute new query)
- `2` = CONTINUE (fetch next batch)
- `3` = STOP (close cursor)
- `4` = NOREPLY_WAIT (wait for noreply writes)
- `5` = SERVER_INFO (get server metadata)

---

## Error Codes Reference

**SCRAM authentication errors (custom):**
- `"Invalid server response: ..."` — server-first not JSON
- `"Auth rejected by server"` — `success: false` without error field
- `"Server nonce does not start with client nonce"` — MITM attack detected
- `"Authentication failed"` — `success: false` in server-final
- `"Server signature verification failed"` — MITM attack detected

**ReQL response errors (from `t` field):**

| Type | Name           | Example |
|------|----------------|---------|
| 17   | CLIENT_ERROR   | Malformed query JSON |
| 18   | COMPILE_ERROR  | `r.db("test").invalidMethod()` |
| 19   | RUNTIME_ERROR  | `Database 'nosuchdb' does not exist` |

**Common runtime errors:**
- `"Database ... does not exist"` — database name typo or not created
- `"Table ... does not exist"` — table name typo or not created
- `"Table ... already exists"` — duplicate tableCreate()
- `"Connection closed while reading"` — server closed socket mid-response

---

## Protocol Version History

| Version | Released | Auth Method      | Status |
|---------|----------|------------------|--------|
| V0.1    | 2012     | None             | Ancient (pre-1.0) |
| V0.2    | 2013     | Auth key (plain) | Legacy (1.x) |
| V0.3    | 2014     | Auth key + JSON protocol | Legacy (1.x) |
| V0.4    | 2015     | Auth key (deprecated) | Legacy (1.16) |
| V1.0    | 2016     | SCRAM-SHA-256    | Current (2.x, 3.x) |

**Modern RethinkDB (≥2.0):**
- Rejects V0.4 handshake with error code 16
- Requires V1.0 magic `0x400C2D20`
- Always uses SCRAM-SHA-256 (unless `--no-auth` flag)

**No-auth mode:**
- Development servers started with `rethinkdb --bind all --no-auth`
- SCRAM handshake succeeds without password verification
- Server responds `{"success": true}` without `authentication` field

---

## Security Considerations

### No TLS by default
RethinkDB driver port (28015) uses **plain TCP**. All traffic is cleartext:
- Passwords are hashed (SCRAM) but salts/nonces/proofs are visible
- Query payloads (including sensitive data) are readable
- Server responses (including data) are readable

**Mitigation:** Use TLS tunnel (stunnel, SSH, WireGuard) or restrict to localhost.

### SCRAM replay protection
SCRAM-SHA-256 includes nonces to prevent replay attacks. Each auth handshake uses fresh client/server nonces. Implementation correctly verifies server nonce starts with client nonce.

### Server signature verification
Implementation verifies `v=` field in server-final to detect MITM. Many RethinkDB client libraries skip this check (accepting any `success: true` response).

### No rate limiting
Implementation has no per-host rate limit. Attacker could spam connections to exhaust server connection pool. Cloudflare Workers has built-in rate limiting at the edge.

### No input sanitization for host field
`host` parameter is passed directly to `connect()` without regex validation. Worker sandbox prevents SSRF to private IPs, but hostname confusion attacks are possible (e.g. `host: "evil.com@localhost"`).

### Timeout not enforced during auth
The `timeoutPromise` is created once and reused across all SCRAM round-trips. If server stalls during SCRAM, timeout won't fire until total time exceeds limit.

### No connection pool DoS protection
Each request opens a new connection. Attacker could exhaust Cloudflare Workers concurrent connection limit (1000 per zone).

---

## Comparison with Official Drivers

| Feature | This Implementation | Official Node.js Driver |
|---------|---------------------|------------------------|
| Connection pooling | None (new conn per request) | Yes (configurable) |
| Auth method | SCRAM-SHA-256 only | SCRAM + legacy key |
| TLS support | No | Yes (via `ssl` option) |
| Changefeeds | No | Yes |
| Binary data | No | Yes (`r.binary()`) |
| Geospatial | No | Yes (POINT, LINE, POLYGON) |
| Cursor management | Manual (no helpers) | Automatic |
| Transaction support | No | Yes (`r.do()`) |
| Timeout granularity | Single (entire request) | Per-phase (connect, auth, query) |
| Server signature verify | Yes | No (most drivers skip it) |

**Why this implementation exists:**
- Portable (no Node.js dependencies, runs in Cloudflare Workers)
- Educational (demonstrates SCRAM-SHA-256 + ReQL wire protocol)
- Testing/debugging (curl-friendly HTTP API for ReQL queries)

**When to use official driver:**
- Production workloads (connection pooling, changefeeds)
- TLS required
- Complex queries (joins, aggregations)
- Binary data or geospatial queries
