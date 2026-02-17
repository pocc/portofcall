# MySQL — Power User Reference

**Port:** 3306 | **Protocol:** MySQL Client/Server Protocol v10 | **Deployed**

Port of Call implements the MySQL wire protocol from scratch — no `mysql2` library. All four endpoints open a direct TCP connection from the Cloudflare Worker, handle packet framing, authenticate using the server-advertised auth plugin, and return JSON.

**No TLS support.** Plain TCP only; `ssl_mode=REQUIRE` servers will reject auth.

---

## API Endpoints

### `GET|POST /api/mysql/connect` — Server probe or full auth

Without credentials: parses the Initial Handshake (server version, auth plugin) without authenticating.
With credentials: performs full auth and disconnects.

**Probe (no credentials):**
```json
{ "host": "db.example.com", "port": 3306, "timeout": 10000 }
```
Or as GET: `?host=db.example.com&port=3306`

**Probe response (200):**
```json
{
  "success": true,
  "message": "MySQL server reachable",
  "host": "db.example.com",
  "port": 3306,
  "protocolVersion": 10,
  "serverVersion": "8.0.36",
  "connectionId": 12345,
  "authPlugin": "caching_sha2_password",
  "note": "Probe mode (no credentials). Use credentials for full auth."
}
```

**Full auth (with credentials):**
```json
{
  "host": "db.example.com",
  "username": "myuser",
  "password": "mypass",
  "database": "mydb",
  "timeout": 10000
}
```

**Full auth response (200):**
```json
{
  "success": true,
  "message": "MySQL authentication successful",
  "host": "db.example.com",
  "port": 3306,
  "protocolVersion": 10,
  "serverVersion": "8.0.36",
  "connectionId": 12345,
  "authPlugin": "caching_sha2_password",
  "database": "mydb"
}
```

The probe reads only the Initial Handshake packet without completing auth — it will succeed even if credentials are wrong, and even on servers that block external auth.

---

### `POST /api/mysql/query` — Execute SQL (COM_QUERY)

Full auth → `COM_QUERY` → parse result set. Works for any query returning a result set (SELECT, SHOW, DESCRIBE, EXPLAIN).

**Request:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `3306` | |
| `username` | string | `"root"` | |
| `password` | string | `""` | |
| `database` | string | — | Sent as `CLIENT_CONNECT_WITH_DB`; required for unqualified table references |
| `query` | string | required | Raw SQL text |
| `timeout` | number (ms) | `30000` | |

**Success (200) — SELECT:**
```json
{
  "success": true,
  "host": "db.example.com",
  "port": 3306,
  "database": "mydb",
  "serverVersion": "8.0.36",
  "query": "SELECT ...",
  "columns": [
    { "name": "id",         "type": 3   },
    { "name": "name",       "type": 253 },
    { "name": "created_at", "type": 12  }
  ],
  "rows": [
    { "id": "1", "name": "Alice", "created_at": "2024-01-15 09:23:11" },
    { "id": "2", "name": "Bob",   "created_at": "2024-01-16 14:08:44" }
  ],
  "rowCount": 2
}
```

All field values are returned as **strings** (or `null` for SQL NULL). No type conversion is performed.

**DML statements** (INSERT/UPDATE/DELETE) return an OK packet, not a result set. The query endpoint returns `{ "success": false, "error": "No result set returned" }`. Use `SELECT ROW_COUNT()` as a follow-up query or use SHOW STATUS.

**Column type byte reference:**

| Type | Decimal | Common usage |
|---|---|---|
| `DECIMAL` | 0 | DECIMAL/NUMERIC |
| `TINY` | 1 | TINYINT, BOOL |
| `SHORT` | 2 | SMALLINT |
| `LONG` | 3 | INT |
| `FLOAT` | 4 | FLOAT |
| `DOUBLE` | 5 | DOUBLE |
| `LONGLONG` | 8 | BIGINT |
| `DATE` | 10 | DATE |
| `DATETIME` | 12 | DATETIME, TIMESTAMP |
| `VARCHAR` | 15 | VARCHAR (text charset) |
| `BLOB` | 252 | TEXT, BLOB |
| `VAR_STRING` | 253 | VARCHAR (binary/text) |
| `STRING` | 254 | CHAR, ENUM, SET |

---

### `POST /api/mysql/databases` — List databases

Runs `SHOW DATABASES`. Returns databases visible to the authenticated user.

**Request:** `{ "host", "port"?, "username"?, "password"?, "timeout"? }`

**Success (200):**
```json
{
  "success": true,
  "host": "db.example.com",
  "port": 3306,
  "serverVersion": "8.0.36",
  "databases": ["information_schema", "myapp", "mysql", "performance_schema", "sys"],
  "count": 5
}
```

Restricted users see only `information_schema` plus databases they have any privilege on.

---

### `POST /api/mysql/tables` — List tables in a database

Connects with the specified `database` selected, runs `SHOW TABLES`.

**Request:** `{ "host", "port"?, "username"?, "password"?, "database" (required), "timeout"? }`

**Success (200):**
```json
{
  "success": true,
  "host": "db.example.com",
  "port": 3306,
  "database": "myapp",
  "serverVersion": "8.0.36",
  "tables": ["events", "sessions", "users"],
  "count": 3
}
```

---

## Authentication

The auth plugin is advertised in the Initial Handshake and the implementation routes automatically.

### `mysql_native_password`

```
token = SHA1(password) XOR SHA1(scramble_20B || SHA1(SHA1(password)))
```

20-byte token. Used by default in MySQL ≤ 5.7 and MySQL 8 when configured with `--default-authentication-plugin=mysql_native_password`.

### `caching_sha2_password` (MySQL 8.0+ default)

```
token = SHA256(password) XOR SHA256(SHA256(SHA256(password)) || nonce_32B)
```

32-byte token. After sending, the server responds with one of two `auth-more-data` codes:

| Byte | Meaning | What implementation does |
|---|---|---|
| `0x03` | Fast auth — password hash cached | Reads final OK packet, succeeds |
| `0x04` | Full auth — RSA-encrypted password needed | **Throws error** (see Known Limitations) |

Full auth (`0x04`) triggers on first login or after `ALTER USER ... IDENTIFIED BY` when using a plaintext TCP connection.

**Workaround:** configure `--default-authentication-plugin=mysql_native_password` in `my.cnf`, or create a user with `mysql_native_password` plugin: `CREATE USER 'app'@'%' IDENTIFIED WITH mysql_native_password BY 'password';`

---

## Wire Protocol Details

### Packet framing

```
[length 3B little-endian] [sequence 1B] [payload...]
```

The implementation uses an accumulating buffer — it reads TCP chunks until a full packet is available (`readPacket`). This handles TCP fragmentation correctly for large result sets.

### Connection sequence

```
Server → Initial Handshake v10 (version, scramble, capabilities, auth plugin)
Client → Handshake Response (capabilities, username, auth token, db?, plugin name)
Server → OK [0x00] | ERR [0xff] | auth-more-data [0x01]
  [caching_sha2 0x03: Server → OK]
  [caching_sha2 0x04: implementation throws]
Client → COM_QUERY [0x03 + SQL text]   (if query requested)
Server → column count (length-encoded int)
Server → N × ColumnDefinition packets
Server → EOF [0xfe]
Server → N × Row Data packets (length-encoded strings, 0xfb = NULL)
Server → EOF [0xfe]
```

### Capability flags sent

```
CLIENT_LONG_PASSWORD      (0x00000001)
CLIENT_LONG_FLAG          (0x00000004)
CLIENT_CONNECT_WITH_DB    (0x00000008) — only if database field provided
CLIENT_PROTOCOL_41        (0x00000200)
CLIENT_SECURE_CONNECTION  (0x00008000)
CLIENT_PLUGIN_AUTH        (0x00080000)
```

`CLIENT_SSL` and `CLIENT_COMPRESS` are NOT set.

---

## Known Limitations

**No TLS.** `CLIENT_SSL` is never set. Servers with `require_secure_transport=ON` will accept the TCP connection but reject auth with "Access denied; SSL is required".

**`caching_sha2_password` full auth fails.** When the server responds `0x04`, the implementation requests the RSA public key but cannot encrypt the password (no RSA-OAEP in WebCrypto without a key pair). Error: `"caching_sha2_password full RSA auth required — use SSL/TLS connection"`. This is the single most common failure on MySQL 8+ servers with default config + plaintext TCP.

**DML returns `success: false`.** INSERT/UPDATE/DELETE return an OK packet (not a result set). The `/query` endpoint treats the absence of a result set as an error. Use `SELECT ROW_COUNT()` as your query text, or issue DML via a stored procedure that SELECTs the result.

**All values are strings.** Rows are `Record<string, string | null>`. Parse on the client.

**No prepared statements.** Only `COM_QUERY` (text protocol). Never interpolate untrusted user input into the `query` field.

**No multi-statement.** `CLIENT_MULTI_STATEMENTS` is not set. Two statements separated by `;` will fail.

**Default `username` is `"root"`.** If omitted from the request body.

---

## curl Examples

```bash
# Probe: server version and auth plugin, no credentials needed
curl -s 'https://portofcall.ross.gg/api/mysql/connect?host=db.example.com' | jq '{serverVersion,authPlugin}'

# Full auth probe
curl -s -X POST https://portofcall.ross.gg/api/mysql/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"db.example.com","username":"app","password":"secret","database":"myapp"}' | jq .

# List databases
curl -s -X POST https://portofcall.ross.gg/api/mysql/databases \
  -H 'Content-Type: application/json' \
  -d '{"host":"db.example.com","username":"app","password":"secret"}' | jq .databases[]

# List tables
curl -s -X POST https://portofcall.ross.gg/api/mysql/tables \
  -H 'Content-Type: application/json' \
  -d '{"host":"db.example.com","username":"app","password":"secret","database":"myapp"}' | jq .tables[]

# Table sizes
curl -s -X POST https://portofcall.ross.gg/api/mysql/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "db.example.com",
    "username": "app",
    "password": "secret",
    "query": "SELECT TABLE_NAME, TABLE_ROWS, ROUND(DATA_LENGTH/1024/1024,2) AS data_MB, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = '\''myapp'\'' ORDER BY DATA_LENGTH DESC"
  }' | jq '.rows[] | {table: .TABLE_NAME, rows: .TABLE_ROWS, data_MB, engine: .ENGINE}'

# Schema introspection
curl -s -X POST https://portofcall.ross.gg/api/mysql/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "db.example.com",
    "username": "app",
    "password": "secret",
    "query": "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='\''myapp'\'' AND TABLE_NAME='\''users'\'' ORDER BY ORDINAL_POSITION"
  }' | jq '.rows[]'

# Active processlist (exclude sleeping connections)
curl -s -X POST https://portofcall.ross.gg/api/mysql/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"db.example.com","username":"root","password":"rootpass","query":"SHOW FULL PROCESSLIST"}' \
  | jq '.rows[] | select(.Command != "Sleep") | {id: .Id, user: .User, db: .db, time: .Time, info: .Info}'

# Replication lag (MySQL 8 replica)
curl -s -X POST https://portofcall.ross.gg/api/mysql/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"replica.example.com","username":"root","password":"rootpass","query":"SHOW REPLICA STATUS"}' \
  | jq '.rows[0] | {lag: .Seconds_Behind_Source, io: .Replica_IO_Running, sql: .Replica_SQL_Running}'

# InnoDB lock waits
curl -s -X POST https://portofcall.ross.gg/api/mysql/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "db.example.com",
    "username": "root",
    "password": "rootpass",
    "query": "SELECT r.trx_id, r.trx_mysql_thread_id AS waiting, b.trx_mysql_thread_id AS blocking FROM information_schema.innodb_lock_waits w JOIN information_schema.innodb_trx b ON b.trx_id=w.blocking_trx_id JOIN information_schema.innodb_trx r ON r.trx_id=w.requesting_trx_id"
  }' | jq .rows
```

---

## Local Testing

```bash
# MySQL 8.0 — force mysql_native_password (avoids caching_sha2 full auth)
docker run -d --name mysql-test -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=testpass \
  -e MYSQL_DATABASE=testdb \
  mysql:8.0 --default-authentication-plugin=mysql_native_password

# MySQL 8.0 — default caching_sha2 (tests fast auth path after first connect)
docker run -d --name mysql8 -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=testpass \
  mysql:8.0

# MariaDB 11 — uses mysql_native_password, fully compatible wire protocol
docker run -d --name mariadb-test -p 3306:3306 \
  -e MARIADB_ROOT_PASSWORD=testpass \
  -e MARIADB_DATABASE=testdb \
  mariadb:11
```

---

## Resources

- [MySQL Client/Server Protocol](https://dev.mysql.com/doc/dev/mysql-server/latest/PAGE_PROTOCOL.html)
- [Capability flags reference](https://dev.mysql.com/doc/dev/mysql-server/latest/group__group__cs__capabilities__flags.html)
- [caching_sha2_password auth flow](https://dev.mysql.com/doc/refman/8.0/en/caching-sha2-pluggable-authentication.html)
- [Field types enum](https://dev.mysql.com/doc/dev/mysql-server/latest/field__types_8h.html)
- [RFC: mysql_native_password hash](https://dev.mysql.com/doc/internals/en/secure-password-authentication.html)
