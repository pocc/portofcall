# PostgreSQL — Power User Reference

**Port:** 5432 (default) | **Protocol:** PostgreSQL Frontend/Backend Protocol 3.0 | **Tests:** Deployed

Port of Call implements the PostgreSQL wire protocol from scratch with full authentication support (cleartext, MD5, SCRAM-SHA-256) and query execution via the Simple Query protocol. All endpoints open a direct TCP connection from the Cloudflare Worker to your PostgreSQL instance.

**No TLS support.** Plain TCP only; servers with `ssl=on` and `ssl_mode=require` will reject connections.

---

## API Endpoints

### `GET|POST /api/postgres/connect` — Connection probe with full authentication

Connects, authenticates (if credentials provided), reads server version from ParameterStatus messages, and disconnects. Tests the full authentication handshake without executing queries.

**Probe (no credentials):**
```json
{ "host": "db.example.com", "port": 5432, "timeout": 30000 }
```
Or as GET: `?host=db.example.com&port=5432`

**Full auth (with credentials):**
```json
{
  "host": "db.example.com",
  "port": 5432,
  "username": "myuser",
  "password": "mypass",
  "database": "mydb",
  "timeout": 30000
}
```

**Success (200):**
```json
{
  "success": true,
  "message": "PostgreSQL authentication successful",
  "host": "db.example.com",
  "port": 5432,
  "username": "myuser",
  "database": "mydb",
  "serverVersion": "16.1 (Ubuntu 16.1-1.pgdg22.04+1)"
}
```

**Error (500):** `{ "success": false, "error": "Auth failed: password authentication failed for user \"myuser\"" }`

**Cloudflare-protected host (403):** `{ "success": false, "error": "...", "isCloudflare": true }`

**Notes:**
- Default `username`: `"postgres"` if omitted
- Default `database`: same as `username` if omitted (PostgreSQL default behavior)
- Default `port`: `5432`
- Default `timeout`: `30000` ms
- Server version is extracted from the `server_version` ParameterStatus message during startup

---

### `POST /api/postgres/query` — Execute SQL query

Connects, authenticates, sends a Simple Query (`Q` message), parses the result set, and disconnects. Works for any query returning rows (SELECT, SHOW, table-returning functions).

**Request:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `5432` | |
| `username` | string | `"postgres"` | |
| `password` | string | `""` | |
| `database` | string | `username` | Defaults to username per PostgreSQL convention |
| `query` | string | required | Raw SQL text |
| `timeout` | number (ms) | `30000` | Total timeout including connect + auth + query |

**Success (200) — SELECT:**
```json
{
  "success": true,
  "host": "db.example.com",
  "port": 5432,
  "username": "myuser",
  "database": "mydb",
  "serverVersion": "16.1",
  "columns": ["id", "name", "created_at"],
  "rows": [
    ["1", "Alice", "2024-01-15 09:23:11"],
    ["2", "Bob", "2024-01-16 14:08:44"]
  ],
  "commandTag": "SELECT 2",
  "rowCount": 2
}
```

All field values are returned as **strings** (or `null` for SQL NULL). No type conversion is performed.

**DML statements** (INSERT/UPDATE/DELETE) without `RETURNING` clause return no result set. The implementation returns `{ "success": true, "columns": [], "rows": [], "commandTag": "INSERT 0 1", "rowCount": 0 }`.

**Command tag reference:**

| Query type | Example commandTag |
|---|---|
| SELECT | `SELECT 42` (row count) |
| INSERT | `INSERT 0 1` (OID 0, row count) |
| UPDATE | `UPDATE 5` (row count) |
| DELETE | `DELETE 3` (row count) |
| CREATE TABLE | `CREATE TABLE` |
| DROP TABLE | `DROP TABLE` |
| BEGIN | `BEGIN` |
| COMMIT | `COMMIT` |
| ROLLBACK | `ROLLBACK` |

---

### `POST /api/postgres/describe` — Describe query structure without executing

Uses the Extended Query protocol (`Parse` → `Describe` → `Sync`) to return column names and type OIDs for a query **without executing it**. No rows are returned. Useful for schema introspection and query planning.

**Request:** Same fields as `/query` endpoint.

**Success (200):**
```json
{
  "success": true,
  "host": "db.example.com",
  "port": 5432,
  "database": "mydb",
  "query": "SELECT id, name, created_at FROM users WHERE id = $1",
  "columns": [
    { "name": "id", "typeOid": 23 },
    { "name": "name", "typeOid": 25 },
    { "name": "created_at", "typeOid": 1114 }
  ],
  "paramCount": 1
}
```

**Type OID reference (common types):**

| OID | Type | Notes |
|---|---|---|
| 16 | bool | |
| 20 | int8 | BIGINT |
| 21 | int2 | SMALLINT |
| 23 | int4 | INTEGER |
| 25 | text | |
| 700 | float4 | REAL |
| 701 | float8 | DOUBLE PRECISION |
| 1043 | varchar | |
| 1082 | date | |
| 1114 | timestamp | timestamp without time zone |
| 1184 | timestamptz | timestamp with time zone |
| 2950 | uuid | |
| 3802 | jsonb | |

Full type OID mappings: [PostgreSQL pg_type catalog](https://www.postgresql.org/docs/current/catalog-pg-type.html)

**Use case:** Validate a query before executing it with user-supplied parameters, or extract result set schema for code generation.

**Notes:**
- The `paramCount` field indicates the number of `$1`, `$2`, etc. placeholders in the query
- The Describe handler uses the unnamed prepared statement (`""`)
- `NoData` response (query returns no rows, e.g., `INSERT` without `RETURNING`) returns `{ "columns": [], "paramCount": 0 }`

---

### `POST /api/postgres/listen` — Subscribe to NOTIFY channel

Executes `LISTEN <channel>`, then waits for a configurable window (`waitMs`) to collect async NOTIFY messages from other clients. Returns all notifications received during the wait window.

**Request:**
```json
{
  "host": "db.example.com",
  "port": 5432,
  "username": "postgres",
  "password": "secret",
  "database": "postgres",
  "channel": "events",
  "waitMs": 5000,
  "timeout": 15000
}
```

**Field defaults:**
- `waitMs`: `5000` ms (how long to collect notifications after `LISTEN` succeeds)
- `timeout`: `15000` ms (overall timeout including connect + auth + listen + wait)

**Success (200):**
```json
{
  "success": true,
  "host": "db.example.com",
  "port": 5432,
  "channel": "events",
  "listenConfirmed": true,
  "notifications": [
    {
      "pid": 12345,
      "channel": "events",
      "payload": "{\"event\":\"user.created\",\"id\":42}",
      "receivedAt": "2024-01-15T09:23:11.456Z"
    }
  ],
  "notificationCount": 1,
  "waitMs": 5000,
  "rtt": 5123
}
```

**Wire format:**
- Channel name must match regex `^[a-zA-Z_][a-zA-Z0-9_]*$` (SQL identifier rules)
- Notifications (`A` message type) contain: process ID (4 bytes), channel name (NUL-terminated), payload (NUL-terminated)
- The connection is automatically `UNLISTEN`ed when closed (PostgreSQL closes the TCP connection after the handler returns)

**Use case:** Long-polling alternative to pub/sub. One client runs `/listen` to wait for events, another client triggers them via `/notify` or `SELECT pg_notify()` from a trigger.

**Known limitation:** The wait window is a hard timeout. Notifications arriving after `waitMs` elapses are silently dropped when the connection closes.

---

### `POST /api/postgres/notify` — Publish message to NOTIFY channel

Executes `SELECT pg_notify('<channel>', '<payload>')` to broadcast a notification to all listeners on the channel.

**Request:**
```json
{
  "host": "db.example.com",
  "port": 5432,
  "username": "postgres",
  "password": "secret",
  "database": "postgres",
  "channel": "events",
  "payload": "{\"event\":\"user.created\",\"id\":42}",
  "timeout": 10000
}
```

**Field defaults:**
- `payload`: `""` (empty string)
- `timeout`: `10000` ms

**Success (200):**
```json
{
  "success": true,
  "host": "db.example.com",
  "port": 5432,
  "channel": "events",
  "payload": "{\"event\":\"user.created\",\"id\":42}",
  "notified": true,
  "commandTag": "SELECT 1",
  "rtt": 123
}
```

**Notes:**
- The implementation uses PostgreSQL dollar-quoted strings (`$$channel$$`, `$$payload$$`) to prevent SQL injection
- Channel name must match regex `^[a-zA-Z_][a-zA-Z0-9_]*$`
- Payload max length: 8000 bytes (PostgreSQL hardcoded limit)
- `pg_notify()` is asynchronous — the caller does not block waiting for listeners to receive the message
- Notifications are **not persisted**. If no clients are listening, the message is discarded.

---

## Authentication

The server advertises its required auth method in the `AuthenticationRequest` response (message type `R`).

### Auth type 0: Trust (no password)

```
Server → AuthenticationOk (type R, authType 0)
```

Used when `pg_hba.conf` has `trust` for the connecting user/host. No password exchange occurs.

### Auth type 3: Cleartext password

```
Client → PasswordMessage (type 'p', password + '\0')
Server → AuthenticationOk | ErrorResponse
```

Password is sent in plaintext. Only use over trusted networks or with TLS (not supported by this implementation).

### Auth type 5: MD5 password challenge

```
Server → AuthenticationMD5Password (type R, authType 5, salt 4B)
Client → PasswordMessage (type 'p', "md5" + md5(md5(password + username) + salt) + '\0')
Server → AuthenticationOk | ErrorResponse
```

**Hash construction:**
1. Compute inner hash: `md5(password + username)` → 32-character hex string
2. Concatenate inner hash (as UTF-8 bytes) with 4-byte binary salt
3. Compute outer hash: `md5(innerBytes + salt)` → 32-character hex string
4. Prepend `"md5"` literal prefix
5. Append NUL terminator (`\0`)

The implementation uses a pure-JS MD5 function (RFC 1321) since Web Crypto does not support MD5.

### Auth type 10: SASL (SCRAM-SHA-256)

```
Server → AuthenticationSASL (type R, authType 10, mechanism list)
Client → SASLInitialResponse (mechanism name, client-first-message)
Server → AuthenticationSASLContinue (server-first-message)
Client → SASLResponse (client-final-message with proof)
Server → AuthenticationSASLFinal (server signature) → AuthenticationOk
```

**SCRAM-SHA-256 flow (RFC 5802):**

1. Client generates 24-byte nonce (base64url)
2. Client-first-message: `n,,n=,r=<nonce>`
3. Server responds with combined nonce, base64-encoded salt, and iteration count
4. Client derives `SaltedPassword = PBKDF2(password, salt, iterations, 32)` using Web Crypto
5. Client computes `ClientKey = HMAC-SHA-256(SaltedPassword, "Client Key")`
6. Client computes `StoredKey = SHA-256(ClientKey)`
7. Client computes `ServerKey = HMAC-SHA-256(SaltedPassword, "Server Key")`
8. Client builds `AuthMessage = client-first-bare + "," + server-first + "," + client-final-without-proof`
9. Client computes `ClientSignature = HMAC-SHA-256(StoredKey, AuthMessage)`
10. Client computes `ClientProof = ClientKey XOR ClientSignature` (base64-encoded)
11. Client sends client-final-message: `c=biws,r=<combined-nonce>,p=<ClientProof>`
12. Server verifies proof and responds with `v=<ServerSignature>`
13. Client verifies `ServerSignature = HMAC-SHA-256(ServerKey, AuthMessage)` matches received value

**Security notes:**
- SCRAM-SHA-256 is the default auth method in PostgreSQL 14+
- The implementation validates the server's signature — if the server cannot prove knowledge of the password, auth fails with `"SCRAM auth failed: server signature mismatch"`
- Channel binding (`c=biws`) is set to "no channel binding" (base64 of `n,,`)
- The nonce is cryptographically random via `crypto.getRandomValues()`

**Known limitation:** The implementation only supports SCRAM-SHA-256. If the server advertises only other SASL mechanisms (SCRAM-SHA-256-PLUS, proprietary mechanisms), auth fails with `"SCRAM-SHA-256 not supported. Server offers: ..."`

---

## Wire Protocol Details

### Message framing

**Backend messages (server → client):**
```
[type 1B] [length 4B big-endian] [payload...]
```
Length includes the 4-byte length field itself but **not** the type byte.

**Frontend messages (client → server):**
Same format, except the Startup message which has no type byte:
```
[length 4B] [protocol version 4B] [param_name\0 param_value\0 ...] [0x00]
```

### Connection sequence

```
Client → StartupMessage (protocol 3.0, user=..., database=...)
Server → AuthenticationRequest (type R, authType 0|3|5|10)
  [auth exchange — depends on authType]
Server → AuthenticationOk (type R, authType 0)
Server → ParameterStatus* (type S, key\0 value\0) — server_version, client_encoding, etc.
Server → BackendKeyData (type K, process_id 4B, secret_key 4B)
Server → ReadyForQuery (type Z, transaction_status 1B)
```

The implementation drains all ParameterStatus messages and extracts `server_version`. Other parameters (client_encoding, TimeZone, application_name) are silently ignored.

### Simple Query protocol

```
Client → Query (type Q, query_text\0)
Server → RowDescription (type T, col_count 2B, [col_name\0 + 18B metadata]*)
Server → DataRow* (type D, col_count 2B, [col_length 4B + col_data | -1 for NULL]*)
Server → CommandComplete (type C, tag\0)
Server → ReadyForQuery (type Z)
```

**Error handling:**
```
Server → ErrorResponse (type E, [field_type 1B + value\0]*) instead of RowDescription
```
Error fields: `S` (severity), `C` (SQLSTATE), `M` (message), `D` (detail), `H` (hint), `P` (position).

The implementation parses `M` (message) and `D` (detail) and throws with `"Query error: <M> — <D>"`.

**EmptyQueryResponse:**
If the query string is empty or contains only whitespace/comments, the server sends `I` (EmptyQueryResponse) instead of `C` (CommandComplete). The implementation sets `commandTag = ""`.

### Extended Query protocol (Describe only)

```
Client → Parse (type P, stmt_name\0, query\0, num_params 2B)
Client → Describe (type D, 'S', stmt_name\0)
Client → Sync (type S)
Server → ParseComplete (type 1)
Server → ParameterDescription (type t, num_params 2B, [param_type_oid 4B]*)
Server → RowDescription (type T) | NoData (type n)
Server → ReadyForQuery (type Z)
```

The implementation uses the unnamed statement (`stmt_name = ""`) and zero parameters. Describe is only used to extract result set metadata.

**Note:** Port of Call does **not** implement `Bind` or `Execute` for the Extended Query protocol. All queries use Simple Query (`Q`).

---

## Known Limitations

**No TLS.** The implementation uses plain TCP only. Servers with `ssl=on` will send an `S` (SSL supported) or `N` (SSL not supported) byte in response to an SSL negotiation request, but this implementation does not send the SSL request. Servers with `hostssl` entries in `pg_hba.conf` will reject the connection.

**No prepared statements with parameters.** The `/query` endpoint uses Simple Query protocol only. Queries with `$1`, `$2` placeholders execute but treat them as literals (not bound parameters). Use string interpolation carefully to avoid SQL injection — **never** concatenate untrusted user input into the `query` field.

**All values are strings.** DataRow field values are returned as UTF-8 decoded strings. Binary types (bytea, binary JSON, PostGIS geometries) are corrupted. Use `encode(column, 'base64')` or `encode(column, 'hex')` for binary data.

**No binary result format.** The implementation always uses text format (format code 0). Large result sets are slower than native drivers using binary format.

**Connection-per-request.** Each API call opens a new TCP connection, performs auth, executes the operation, and closes. No connection pooling. For batch queries, use a multi-statement CTE or call from a single client that maintains state between calls.

**SCRAM-SHA-256-PLUS not supported.** Channel binding variants (e.g., `SCRAM-SHA-256-PLUS` with TLS) are not implemented. The server must offer plain `SCRAM-SHA-256`.

**Transaction state lost between calls.** Each `/query` call is a separate connection. `BEGIN` → `/query` → `COMMIT` via separate API calls will not work — each query auto-commits. Use explicit `BEGIN; ...; COMMIT;` in a single query string (note: multi-statement requires enabling `allow_multiple_statements` or using CTEs).

**COPY protocol not supported.** `COPY TO STDOUT` and `COPY FROM STDIN` are not implemented. Use `SELECT * FROM table` (limited by result set size) or `COPY TO PROGRAM 'base64'` → fetch via file.

**LISTEN wait window is hard timeout.** Notifications arriving after `waitMs` elapses are silently dropped. Use `waitMs` long enough to cover your event interval.

**NOTIFY payload size limit.** PostgreSQL enforces an 8000-byte payload limit. Larger payloads return an error: `"payload string too long"`.

**Message length limit.** The implementation validates that message length is between 4 bytes and 1GB. Messages larger than 1GB are rejected with `"Invalid PostgreSQL message length"`. This prevents OOM attacks but also limits very large result sets.

**No GSSAPI / Kerberos / LDAP auth.** Only cleartext, MD5, and SCRAM-SHA-256 are supported.

**No replication protocol.** Logical replication (`START_REPLICATION`) and physical streaming replication are not implemented.

**No cancellation.** The CancelRequest protocol (send process ID + secret key to interrupt a running query) is not exposed. Long-running queries hit the timeout and fail.

**Default timeout is 30 seconds.** Adjust `timeout` field for slow queries.

**No query progress tracking.** `COPY` progress messages, `NOTICE` responses, and async notifications (outside of `/listen` context) are silently ignored.

**ParameterStatus parsing assumes NUL terminators.** Malformed ParameterStatus messages (missing NUL bytes) are now skipped instead of crashing (fixed in this review).

---

## curl Examples

```bash
# Connection probe (no auth)
curl -s 'https://portofcall.ross.gg/api/postgres/connect?host=db.example.com' | jq .

# Full auth probe
curl -s -X POST https://portofcall.ross.gg/api/postgres/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"db.example.com","username":"myuser","password":"mypass","database":"mydb"}' | jq .

# List databases
curl -s -X POST https://portofcall.ross.gg/api/postgres/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"db.example.com","username":"postgres","password":"secret","query":"SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"}' \
  | jq '.rows[] | .[0]'

# List tables in public schema
curl -s -X POST https://portofcall.ross.gg/api/postgres/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"db.example.com","username":"myuser","password":"mypass","database":"mydb","query":"SELECT tablename FROM pg_tables WHERE schemaname = '\''public'\'' ORDER BY tablename"}' \
  | jq '.rows[] | .[0]'

# Table sizes
curl -s -X POST https://portofcall.ross.gg/api/postgres/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "db.example.com",
    "username": "postgres",
    "password": "secret",
    "database": "mydb",
    "query": "SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'\''.'\''||tablename)) AS size FROM pg_tables WHERE schemaname NOT IN ('\''pg_catalog'\'', '\''information_schema'\'') ORDER BY pg_total_relation_size(schemaname||'\''.'\''||tablename) DESC LIMIT 20"
  }' | jq '.rows[] | {schema: .[0], table: .[1], size: .[2]}'

# Column schema
curl -s -X POST https://portofcall.ross.gg/api/postgres/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "db.example.com",
    "username": "myuser",
    "password": "mypass",
    "database": "mydb",
    "query": "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = '\''public'\'' AND table_name = '\''users'\'' ORDER BY ordinal_position"
  }' | jq '.rows[] | {name: .[0], type: .[1], nullable: .[2], default: .[3]}'

# Active queries
curl -s -X POST https://portofcall.ross.gg/api/postgres/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"db.example.com","username":"postgres","password":"secret","query":"SELECT pid, usename, application_name, state, query_start, state_change, query FROM pg_stat_activity WHERE state != '\''idle'\'' AND pid != pg_backend_pid() ORDER BY query_start"}' \
  | jq '.rows[] | {pid: .[0], user: .[1], app: .[2], state: .[3], query: .[6]}'

# Describe query without executing
curl -s -X POST https://portofcall.ross.gg/api/postgres/describe \
  -H 'Content-Type: application/json' \
  -d '{"host":"db.example.com","username":"myuser","password":"mypass","database":"mydb","query":"SELECT id, name, created_at FROM users WHERE id = $1"}' \
  | jq '.columns[] | {name, typeOid}'

# LISTEN for notifications (waits 10 seconds)
curl -s -X POST https://portofcall.ross.gg/api/postgres/listen \
  -H 'Content-Type: application/json' \
  -d '{"host":"db.example.com","username":"postgres","password":"secret","database":"postgres","channel":"events","waitMs":10000}' \
  | jq .notifications

# NOTIFY (trigger notification)
curl -s -X POST https://portofcall.ross.gg/api/postgres/notify \
  -H 'Content-Type: application/json' \
  -d '{"host":"db.example.com","username":"postgres","password":"secret","database":"postgres","channel":"events","payload":"{\"event\":\"test\",\"timestamp\":\"2024-01-15T09:00:00Z\"}"}' \
  | jq .

# Index usage stats
curl -s -X POST https://portofcall.ross.gg/api/postgres/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "db.example.com",
    "username": "postgres",
    "password": "secret",
    "database": "mydb",
    "query": "SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch FROM pg_stat_user_indexes ORDER BY idx_scan DESC LIMIT 20"
  }' | jq '.rows[] | {schema: .[0], table: .[1], index: .[2], scans: .[3]}'

# Replication lag (on standby)
curl -s -X POST https://portofcall.ross.gg/api/postgres/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"standby.example.com","username":"postgres","password":"secret","query":"SELECT CASE WHEN pg_last_wal_receive_lsn() = pg_last_wal_replay_lsn() THEN 0 ELSE EXTRACT(EPOCH FROM now() - pg_last_xact_replay_timestamp()) END AS lag_seconds"}' \
  | jq '.rows[0][0]'

# Vacuum stats
curl -s -X POST https://portofcall.ross.gg/api/postgres/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"db.example.com","username":"postgres","password":"secret","database":"mydb","query":"SELECT schemaname, relname, last_vacuum, last_autovacuum, n_dead_tup FROM pg_stat_user_tables WHERE n_dead_tup > 1000 ORDER BY n_dead_tup DESC"}' \
  | jq '.rows[] | {table: .[1], dead_tuples: .[4], last_vacuum: .[2]}'
```

---

## Local Testing

```bash
# PostgreSQL 16 with SCRAM-SHA-256 (default)
docker run -d --name postgres16 -p 5432:5432 \
  -e POSTGRES_PASSWORD=testpass \
  -e POSTGRES_DB=testdb \
  postgres:16

# PostgreSQL 16 with MD5 auth
docker run -d --name postgres-md5 -p 5433:5432 \
  -e POSTGRES_PASSWORD=testpass \
  -e POSTGRES_DB=testdb \
  -e POSTGRES_HOST_AUTH_METHOD=md5 \
  postgres:16

# PostgreSQL 12 (default: MD5)
docker run -d --name postgres12 -p 5434:5432 \
  -e POSTGRES_PASSWORD=testpass \
  -e POSTGRES_DB=testdb \
  postgres:12

# Trust auth (no password)
docker run -d --name postgres-trust -p 5435:5432 \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  postgres:16
```

Connect via Port of Call:
```bash
# SCRAM-SHA-256
curl -s -X POST https://portofcall.ross.gg/api/postgres/connect \
  -d '{"host":"localhost","port":5432,"username":"postgres","password":"testpass","database":"testdb"}' \
  -H 'Content-Type: application/json' | jq .

# MD5
curl -s -X POST https://portofcall.ross.gg/api/postgres/connect \
  -d '{"host":"localhost","port":5433,"username":"postgres","password":"testpass","database":"testdb"}' \
  -H 'Content-Type: application/json' | jq .

# Trust
curl -s 'https://portofcall.ross.gg/api/postgres/connect?host=localhost&port=5435&username=postgres&database=testdb' | jq .
```

---

## Power User Tips

### Use CTEs instead of multi-statement queries

Since `CLIENT_MULTI_STATEMENTS` is not set, you cannot send `SELECT 1; SELECT 2;`. Use CTEs:

```sql
WITH inserted AS (
  INSERT INTO events (name) VALUES ('test') RETURNING id
)
SELECT * FROM inserted;
```

### Avoid SQL injection with dollar-quoting

When building dynamic queries (e.g., for the `/notify` endpoint), use PostgreSQL dollar-quoted strings to avoid escaping nightmares:

```sql
-- Safe: no escaping needed
SELECT pg_notify($$channel$$, $${"key":"value"}$$);

-- Unsafe: requires careful escaping
SELECT pg_notify('channel', '{"key":"value"}');
```

The `/notify` endpoint now uses dollar-quoting internally after this review.

### Extract binary data as base64

```sql
SELECT encode(binary_column, 'base64') FROM my_table;
```

### Use `EXPLAIN` to introspect query plans

```sql
EXPLAIN (FORMAT JSON) SELECT * FROM large_table WHERE indexed_col = 123;
```

Returns JSON plan. Parse `rows[0][0]` (the full JSON plan is in a single text field).

### Monitor lock contention

```sql
SELECT
  blocked.pid AS blocked_pid,
  blocking.pid AS blocking_pid,
  blocked.query AS blocked_query,
  blocking.query AS blocking_query
FROM pg_stat_activity blocked
JOIN pg_locks blocked_lock ON blocked.pid = blocked_lock.pid
JOIN pg_locks blocking_lock ON blocked_lock.locktype = blocking_lock.locktype
  AND blocked_lock.database IS NOT DISTINCT FROM blocking_lock.database
  AND blocked_lock.relation IS NOT DISTINCT FROM blocking_lock.relation
  AND blocked_lock.page IS NOT DISTINCT FROM blocking_lock.page
  AND blocked_lock.tuple IS NOT DISTINCT FROM blocking_lock.tuple
  AND blocked_lock.virtualxid IS NOT DISTINCT FROM blocking_lock.virtualxid
  AND blocked_lock.transactionid IS NOT DISTINCT FROM blocking_lock.transactionid
  AND blocked_lock.classid IS NOT DISTINCT FROM blocking_lock.classid
  AND blocked_lock.objid IS NOT DISTINCT FROM blocking_lock.objid
  AND blocked_lock.objsubid IS NOT DISTINCT FROM blocking_lock.objsubid
  AND blocked_lock.pid != blocking_lock.pid
JOIN pg_stat_activity blocking ON blocking.pid = blocking_lock.pid
WHERE NOT blocked_lock.granted;
```

### Use `pg_stat_statements` for slow query analysis

Requires `shared_preload_libraries = 'pg_stat_statements'` in `postgresql.conf`.

```sql
SELECT
  query,
  calls,
  total_exec_time,
  mean_exec_time,
  max_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;
```

### Check connection limits

```sql
SELECT
  max_conn,
  used,
  res_for_super,
  max_conn - used - res_for_super AS available
FROM (
  SELECT count(*) used FROM pg_stat_activity
) t1, (
  SELECT setting::int res_for_super FROM pg_settings WHERE name = 'superuser_reserved_connections'
) t2, (
  SELECT setting::int max_conn FROM pg_settings WHERE name = 'max_connections'
) t3;
```

### Force index usage

```sql
SET enable_seqscan = off;
SELECT * FROM large_table WHERE indexed_col = 123;
```

Note: `SET` persists only for the current session. Since Port of Call opens a new connection per request, this only affects the single query in that request.

---

## Resources

- [PostgreSQL Frontend/Backend Protocol](https://www.postgresql.org/docs/current/protocol.html)
- [SCRAM-SHA-256 (RFC 5802)](https://datatracker.ietf.org/doc/html/rfc5802)
- [MD5 authentication algorithm](https://www.postgresql.org/docs/current/auth-password.html)
- [Simple Query protocol flow](https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-SIMPLE-QUERY)
- [Extended Query protocol flow](https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-EXT-QUERY)
- [LISTEN / NOTIFY reference](https://www.postgresql.org/docs/current/sql-notify.html)
- [pg_stat_activity documentation](https://www.postgresql.org/docs/current/monitoring-stats.html#MONITORING-PG-STAT-ACTIVITY-VIEW)
- [Type OID catalog (pg_type)](https://www.postgresql.org/docs/current/catalog-pg-type.html)

---

## Common Errors and Solutions

### `"caching_sha2_password full RSA auth required"`
**MySQL error message, not PostgreSQL.** If you see this, you're connecting to a MySQL server, not PostgreSQL.

### `"SCRAM-SHA-256 not supported. Server offers: ..."`
**Cause:** Server requires SCRAM-SHA-256-PLUS (channel binding) or another SASL mechanism.
**Solution:** Configure server to accept plain SCRAM-SHA-256, or use MD5/cleartext auth (via `pg_hba.conf`).

### `"password authentication failed for user"`
**Cause:** Wrong password, or user does not exist.
**Solution:** Check credentials. Verify user exists: `SELECT usename FROM pg_user;`

### `"SSL is required"`
**Cause:** Server's `pg_hba.conf` has `hostssl` entry (requires TLS).
**Solution:** Change to `host` (allows plaintext TCP) or use a different client with TLS support.

### `"Invalid PostgreSQL message length: <huge number>"`
**Cause:** Message length field is corrupted or malicious server.
**Solution:** Check network integrity. This is a new validation added in this review to prevent OOM attacks.

### `"Connection closed unexpectedly"`
**Cause:** Server closed the connection mid-stream (OOM, crash, `pg_terminate_backend()`).
**Solution:** Check server logs. Increase server `work_mem` or `maintenance_work_mem` if query is memory-intensive.

### `"Connection timeout"`
**Cause:** Network unreachable, firewall blocking port 5432, or query took longer than `timeout` ms.
**Solution:** Increase `timeout` field, check network/firewall, or optimize query.

### `"Query error: syntax error at or near ..."`
**Cause:** Invalid SQL syntax.
**Solution:** Test query in `psql` first. Check for PostgreSQL-specific syntax (e.g., `RETURNING`, `LATERAL`, `DISTINCT ON`).

### `"Database does not exist"`
**Cause:** The `database` field references a non-existent database.
**Solution:** List databases first: `SELECT datname FROM pg_database;`

### Empty result set for `LISTEN` endpoint
**Cause:** No notifications were sent during the `waitMs` window.
**Solution:** Use a separate client to call `/notify` or `SELECT pg_notify()` while `/listen` is waiting.
