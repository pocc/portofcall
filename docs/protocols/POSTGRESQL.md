# PostgreSQL Wire Protocol

**Port:** 5432
**Transport:** TCP
**Implementation:** `src/worker/postgres.ts`
**Routes:** `/api/postgres/connect`, `/api/postgres/query`, `/api/postgres/describe`, `/api/postgres/listen`, `/api/postgres/notify`
**Tests:** `tests/postgres.test.ts`

---

## Overview

Port of Call implements the PostgreSQL Frontend/Backend Protocol v3.0 directly over TCP. No pg driver, no libpq. All five routes share a `connectAndAuthenticate()` function that handles the startup handshake and auth, then open/close a connection per request (no connection pooling).

---

## Authentication

Three auth methods are supported. The server picks; the client responds:

| Auth type | Code | How it works |
|-----------|------|--------------|
| Trust | 0 | No password. Common for local/Unix connections; rare over TCP. |
| CleartextPassword | 3 | Password sent as-is. Only safe over TLS (not provided here). |
| MD5Password | 5 | `"md5" + md5(md5(password + username) + salt)`. Salt is 4 bytes from server. |
| SCRAM-SHA-256 | 10 | Full RFC 5802 exchange: PBKDF2-SHA-256 (Web Crypto), HMAC-SHA-256 key derivation, client proof, server signature (computed but not verified — see Limitations). |

**Not supported:** SCRAM-SHA-256-PLUS (TLS channel binding), GSS/Kerberos, SSPI, PAM, RADIUS.

If your server requires GSS or SSPI (Windows AD domains, Kerberos), you'll get `Unsupported authentication type: <N>`.

### Defaults

| Field | Default |
|-------|---------|
| `port` | `5432` |
| `username` | `postgres` |
| `password` | `""` (empty string) |
| `database` | Same as `username` |
| `timeout` | `30000` ms |

---

## Endpoints

### `POST /api/postgres/connect`

Authenticate and return the server version. No query is executed. Use this to verify credentials or check if a host is reachable.

Also accepts `GET` with query parameters.

**Request:**
```json
{
  "host": "db.example.com",
  "port": 5432,
  "username": "myuser",
  "password": "mypassword",
  "database": "mydb",
  "timeout": 10000
}
```

**Success response:**
```json
{
  "success": true,
  "message": "PostgreSQL authentication successful",
  "host": "db.example.com",
  "port": 5432,
  "username": "myuser",
  "database": "mydb",
  "serverVersion": "16.2"
}
```

`serverVersion` is extracted from the `ParameterStatus` messages sent during startup. It reflects the server's `server_version` setting (e.g., `"16.2"`, `"15.6 (Ubuntu 15.6-1.pgdg22.04+1)"`).

---

### `POST /api/postgres/query`

Authenticate, run a SQL query via the Simple Query protocol, return results.

**Request:**
```json
{
  "host": "db.example.com",
  "username": "myuser",
  "password": "mypassword",
  "database": "mydb",
  "query": "SELECT id, name, created_at FROM users LIMIT 10",
  "timeout": 30000
}
```

**Success response:**
```json
{
  "success": true,
  "host": "db.example.com",
  "port": 5432,
  "username": "myuser",
  "database": "mydb",
  "serverVersion": "16.2",
  "columns": ["id", "name", "created_at"],
  "rows": [
    ["1", "Alice", "2024-01-15 10:30:00"],
    ["2", "Bob", null]
  ],
  "commandTag": "SELECT 2",
  "rowCount": 2
}
```

**Key behaviors:**
- `rows` is `(string | null)[][]` — every value is a text string regardless of column type. `null` represents SQL `NULL`.
- `commandTag` is the server's `CommandComplete` tag (e.g., `"SELECT 5"`, `"INSERT 0 1"`, `"UPDATE 3"`, `"DELETE 0"`, `"CREATE TABLE"`).
- `rowCount` is the number of DataRow messages received. For non-SELECT commands this is 0.
- Multiple statements in one query string are supported by the Simple Query protocol, but only the last result set is surfaced (earlier results are overwritten as the loop processes each `RowDescription`/`DataRow` sequence).
- `EmptyQueryResponse` ('I') — empty string query — returns `commandTag: ""` and `rowCount: 0` without error.
- `NoticeResponse` ('N') messages (warnings, notices) are silently discarded.

---

### `POST /api/postgres/describe`

Use the Extended Query protocol — Parse + Describe + Sync — to inspect a query's result shape without executing it. Returns column names, their type OIDs, and the number of bind parameters.

**Request:**
```json
{
  "host": "db.example.com",
  "username": "myuser",
  "password": "mypassword",
  "database": "mydb",
  "query": "SELECT id, name FROM users WHERE created_at > $1"
}
```

**Success response:**
```json
{
  "success": true,
  "host": "db.example.com",
  "port": 5432,
  "database": "mydb",
  "query": "SELECT id, name FROM users WHERE created_at > $1",
  "columns": [
    { "name": "id",   "typeOid": 23 },
    { "name": "name", "typeOid": 25 }
  ],
  "paramCount": 1
}
```

**Type OID reference (common values):**

| OID | Type | OID | Type |
|-----|------|-----|------|
| 16 | bool | 1114 | timestamp |
| 17 | bytea | 1184 | timestamptz |
| 20 | int8 | 1082 | date |
| 21 | int2 | 1083 | time |
| 23 | int4 | 1700 | numeric |
| 25 | text | 2950 | uuid |
| 700 | float4 | 3802 | jsonb |
| 701 | float8 | 114 | json |
| 1043 | varchar | 1007 | int4[] |
| 26 | oid | 16 | boolean |

Type OIDs above the builtin range belong to user-defined types (enums, domains, composite types). Query `pg_type` to resolve them:
```sql
SELECT oid, typname FROM pg_type WHERE oid = ANY(ARRAY[<oid1>,<oid2>,...])
```

**For DML without RETURNING** — Parse+Describe returns `NoData` ('n') and `columns` will be `[]` with `paramCount` matching the number of `$N` placeholders.

---

### `POST /api/postgres/listen`

Subscribe to a `LISTEN` channel and collect `NotificationResponse` messages ('A') that arrive within a configurable window.

**Request:**
```json
{
  "host": "db.example.com",
  "username": "myuser",
  "password": "mypassword",
  "database": "mydb",
  "channel": "job_queue",
  "waitMs": 5000,
  "timeout": 15000
}
```

**Success response:**
```json
{
  "success": true,
  "host": "db.example.com",
  "port": 5432,
  "channel": "job_queue",
  "listenConfirmed": true,
  "notifications": [
    {
      "pid": 12345,
      "channel": "job_queue",
      "payload": "{\"job_id\": 42}",
      "receivedAt": "2024-03-01T14:22:00.123Z"
    }
  ],
  "notificationCount": 1,
  "waitMs": 5000,
  "rtt": 5043
}
```

**Key behaviors:**
- `channel` must match `/^[a-zA-Z_][a-zA-Z0-9_]*$/`. Names with hyphens, spaces, or mixed case beyond this pattern are rejected with a 400 error. PostgreSQL allows quoted identifiers as channel names, but this endpoint does not.
- `waitMs` (default 5000): how long to wait for notifications after `LISTEN` confirms. The connection is held open for this duration.
- `timeout` (default 15000): overall deadline including auth + LISTEN + wait window. Must be > `waitMs`.
- `listenConfirmed`: true if `CommandComplete` was received before the wait window. A false value indicates the `LISTEN` command did not complete in time.
- `pid` is the backend process ID of the session that sent the `pg_notify()` / `NOTIFY` command — useful for tracing which connection triggered the notification.
- The connection is closed after `waitMs` expires; PostgreSQL automatically removes the listener when the connection drops (no explicit `UNLISTEN` needed).
- **Long-polling limitation**: The maximum useful `waitMs` is constrained by Cloudflare Worker CPU limits and the `timeout` setting. You cannot hold a connection open indefinitely. For real-time notification consumers, use a persistent backend process with a native pg driver.

**Triggering a notification from psql:**
```sql
NOTIFY job_queue, '{"job_id": 42}';
-- or equivalently:
SELECT pg_notify('job_queue', '{"job_id": 42}');
```

---

### `POST /api/postgres/notify`

Send a notification to all listeners on a channel using `SELECT pg_notify(channel, payload)`.

**Request:**
```json
{
  "host": "db.example.com",
  "username": "myuser",
  "password": "mypassword",
  "database": "mydb",
  "channel": "job_queue",
  "payload": "{\"job_id\": 99}",
  "timeout": 10000
}
```

**Success response:**
```json
{
  "success": true,
  "host": "db.example.com",
  "port": 5432,
  "channel": "job_queue",
  "payload": "{\"job_id\": 99}",
  "notified": true,
  "commandTag": "SELECT 1",
  "rtt": 23
}
```

**Key behaviors:**
- `payload` defaults to `""` (empty string). PostgreSQL allows any string up to 8000 bytes.
- `notified: true` means `pg_notify()` executed and returned `SELECT 1`. It does **not** mean any listener received the notification — `pg_notify()` succeeds even if there are zero listeners.
- The channel name is validated with the same regex as `/listen`, then single-quote-escaped (`'` → `''`) before being interpolated into the SQL. This is safe against SQL injection as long as the channel name passes validation first.
- Unlike bare `NOTIFY channel, 'payload'` (which the Simple Query protocol could also express), `pg_notify()` allows the payload to contain any characters including single quotes (because it's a string literal argument).

---

## Wire Protocol Notes

Understanding the wire format helps debug connection issues.

### Startup Message (no type byte)
```
[total length: 4B BE] [protocol: 4B = 0x00030000] [params: NUL-separated key=value pairs] [0x00]
```
Protocol `0x00030000` = major 3, minor 0. This is the only PostgreSQL 3.0 standard. (Protocol 2.0 and SSL request `0x04D2162F` are not sent.)

### Backend Message Format (all messages after startup)
```
[type: 1B] [length: 4B BE, includes itself] [payload]
```

### Message Types Reference

| Code | Name | Direction | Notes |
|------|------|-----------|-------|
| `R` | Authentication | S→C | authType int32: 0=OK, 3=cleartext, 5=MD5, 10=SASL, 11=SASLContinue, 12=SASLFinal |
| `S` | ParameterStatus | S→C | key\0value\0 — server_version, client_encoding, DateStyle, etc. |
| `K` | BackendKeyData | S→C | pid(4) + secretKey(4) — for cancel requests (not implemented) |
| `Z` | ReadyForQuery | S→C | txStatus: 'I'=idle, 'T'=in transaction, 'E'=failed txn |
| `T` | RowDescription | S→C | column metadata (name, tableOID, attrNum, typeOID, typeSize, typeMod, format) |
| `D` | DataRow | S→C | per-column: length(4) + bytes, or -1 for NULL |
| `C` | CommandComplete | S→C | NUL-terminated command tag |
| `I` | EmptyQueryResponse | S→C | Response to empty query string |
| `E` | ErrorResponse | S→C | field codes: S=severity, C=sqlstate, M=message, D=detail, H=hint, P=position |
| `N` | NoticeResponse | S→C | Same format as ErrorResponse but non-fatal |
| `A` | NotificationResponse | S→C | pid(4) + channel\0 + payload\0 |
| `1` | ParseComplete | S→C | Extended query: Parse accepted |
| `t` | ParameterDescription | S→C | Extended query: param count + type OIDs |
| `n` | NoData | S→C | Extended query: query has no result columns |
| `Q` | Query | C→S | Simple query protocol |
| `P` | Parse | C→S | Extended query: prepare statement |
| `D` | Describe | C→S | Extended query: describe statement or portal |
| `S` | Sync | C→S | Extended query: flush and return to ready state |
| `p` | PasswordMessage / SASLResponse | C→S | Auth response |
| `X` | Terminate | C→S | Graceful disconnect (not sent by Port of Call) |

### ErrorResponse Field Codes

| Code | Name | Example |
|------|------|---------|
| `S` | Severity | `ERROR`, `FATAL`, `PANIC`, `WARNING` |
| `V` | Severity (non-localized) | `ERROR` |
| `C` | SQLSTATE | `42P01` (undefined_table), `28P01` (invalid_password), `23505` (unique_violation) |
| `M` | Message | Human-readable error text (returned in `error` field) |
| `D` | Detail | Additional detail (returned in `error` field after `—`) |
| `H` | Hint | Suggestion (silently ignored) |
| `P` | Position | Character offset in query where error occurred (silently ignored) |

Only `M` and `D` are extracted; all other fields are silently ignored.

---

## SCRAM-SHA-256 Details

The implementation follows RFC 5802 exactly:

1. **Client-first-message**: `n,,n=,r=<clientNonce>` where `clientNonce` is 24 random bytes base64url-encoded (no padding, `+`→`-`, `/`→`_`).
2. **Server-first-message**: `r=<combinedNonce>,s=<saltBase64>,i=<iterations>`.
3. **Key derivation**: `SaltedPassword = PBKDF2-SHA256(password, salt, iterations, 32)`.
4. **Proof**: `ClientKey = HMAC-SHA256(SaltedPassword, "Client Key")`, `StoredKey = SHA256(ClientKey)`, `ClientSignature = HMAC-SHA256(StoredKey, authMessage)`, `ClientProof = ClientKey XOR ClientSignature`.
5. **channel-binding**: Fixed to `biws` = base64(`n,,`) — "no channel binding supported".

**The server signature is NOT verified.** After `AuthenticationSASLFinal` (type 12), the server sends `v=<serverSigBase64>`. The implementation computes the expected server signature but does `void serverSigB64` and discards it. A MITM could substitute its own SCRAM challenge without detection.

---

## Known Limitations

### No TLS
There is no SSL/TLS support. All traffic is plaintext TCP. Cleartext and MD5 passwords are sent unencrypted. SCRAM-SHA-256 credentials are cryptographically protected but the data stream is not encrypted.

### Simple Query Only for Execution
`/query` uses the Simple Query protocol ('Q' message). This means:
- No parameterized queries: SQL is sent verbatim. Callers must do their own escaping.
- No binary result encoding: all column values arrive as text (e.g., `int4` column `42` arrives as string `"42"`).
- No portal reuse: each query is a fresh parse/plan cycle.
- No pipeline: only one query per connection.

The Extended Query protocol (Parse/Bind/Execute) is used only by `/describe`, and only for the Parse+Describe+Sync sub-sequence without execution.

### COPY Not Supported
A query that generates `CopyInResponse` or `CopyOutResponse` (e.g., `COPY users FROM STDIN` or `COPY users TO STDOUT`) will cause the endpoint to hang waiting for `ReadyForQuery` and eventually timeout, because the COPY subprotocol messages are not handled.

### All Values Are Strings
`bytea`, `uuid`, `json`, `jsonb`, `xml`, arrays, composite types, geometric types, and other complex types all arrive as their text representations. There is no binary format mode.

### Multiple Statements Return Only the Last Result
`SELECT 1; SELECT 2` sends two DataRow sets. The loop overwrites `columns` on each `RowDescription`, so only the second result is returned.

### No Cancel
`BackendKeyData` (pid + secretKey) is consumed but never stored. There is no way to send a `CancelRequest` to abort a long-running query mid-flight.

### Channel Name Validation Is Strict
`/listen` and `/notify` validate the channel name as `/^[a-zA-Z_][a-zA-Z0-9_]*$/`. PostgreSQL itself accepts any string as a channel name when using `pg_notify()` or `LISTEN "quoted-name"`. Names with hyphens, spaces, dots, or starting with a digit are rejected.

### LISTEN Cannot Long-Poll
The maximum practical `waitMs` is bounded by `timeout` (default 15 s) and Cloudflare Worker CPU/wall-clock limits. For persistent event-driven consumers, use a native pg client.

### database Defaults to username
If `database` is omitted, `connectAndAuthenticate` uses the username as the database name. This matches PostgreSQL convention but surprises users who assume it defaults to `"postgres"`.

---

## Common SQLSTATE Codes

| Code | Condition | When you'll see it |
|------|-----------|-------------------|
| `28P01` | invalid_password | Wrong password |
| `28000` | invalid_authorization_specification | Wrong username, or access denied |
| `3D000` | invalid_catalog_name | Database does not exist |
| `42P01` | undefined_table | Table/view does not exist |
| `42703` | undefined_column | Column does not exist |
| `23505` | unique_violation | INSERT/UPDATE violates unique constraint |
| `23503` | foreign_key_violation | INSERT/UPDATE violates FK |
| `42601` | syntax_error | SQL syntax error |
| `08006` | connection_failure | Mid-query network drop |
| `53300` | too_many_connections | Server connection limit reached |

---

## curl Quick Reference

```bash
BASE=https://portofcall.example.com

# Test authentication
curl -s -X POST $BASE/api/postgres/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"db.example.com","username":"myuser","password":"mypassword","database":"mydb"}' | jq .

# Run a query
curl -s -X POST $BASE/api/postgres/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"db.example.com","username":"myuser","password":"mypassword","database":"mydb","query":"SELECT version()"}' | jq .rows

# Describe a query schema without executing
curl -s -X POST $BASE/api/postgres/describe \
  -H 'Content-Type: application/json' \
  -d '{"host":"db.example.com","username":"myuser","password":"mypassword","database":"mydb","query":"SELECT id, email FROM users WHERE id = $1"}' | jq .

# Listen for notifications (blocks for 5s waiting for events)
curl -s -X POST $BASE/api/postgres/listen \
  -H 'Content-Type: application/json' \
  -d '{"host":"db.example.com","username":"myuser","password":"mypassword","database":"mydb","channel":"events","waitMs":5000}' | jq .

# Trigger a notification
curl -s -X POST $BASE/api/postgres/notify \
  -H 'Content-Type: application/json' \
  -d '{"host":"db.example.com","username":"myuser","password":"mypassword","database":"mydb","channel":"events","payload":"{\"type\":\"ping\"}"}' | jq .

# Useful admin queries
curl -s -X POST $BASE/api/postgres/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"db.example.com","username":"postgres","password":"...","database":"postgres","query":"SELECT pid, usename, datname, state, query FROM pg_stat_activity WHERE state != '\''idle'\'' ORDER BY query_start"}' | jq '.rows'

# List all tables in current schema
curl -s -X POST $BASE/api/postgres/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"db.example.com","username":"myuser","password":"mypassword","database":"mydb","query":"SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'\''.'\''||tablename)) AS size FROM pg_tables WHERE schemaname NOT IN ('"'"'pg_catalog'"'"','"'"'information_schema'"'"') ORDER BY pg_total_relation_size(schemaname||'\''.'\''||tablename) DESC"}' | jq '.rows'
```

---

## Local Testing

```bash
# Minimal local PostgreSQL (trust auth, no password needed)
docker run -d --name pgtest \
  -e POSTGRES_PASSWORD=pgpassword \
  -p 5432:5432 \
  postgres:16

# Create a test user with SCRAM-SHA-256 auth
docker exec pgtest psql -U postgres -c "
  SET password_encryption = 'scram-sha-256';
  CREATE USER testuser PASSWORD 'testpass';
  CREATE DATABASE testdb OWNER testuser;
"

# Verify connectivity
curl -s -X POST https://portofcall.example.com/api/postgres/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"YOUR_NGROK_OR_PUBLIC_IP","username":"testuser","password":"testpass","database":"testdb"}' | jq .
```
