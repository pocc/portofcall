# Cassandra CQL Native Protocol — Port of Call Reference

**RFC / Spec:** [CQL Native Protocol v4](https://github.com/apache/cassandra/blob/trunk/doc/native_protocol_v4.spec)
**Default port:** 9042
**Source:** `src/worker/cassandra.ts`
**Tests:** `tests/cassandra.test.ts`

---

## Overview

Port of Call implements the Cassandra CQL Binary Protocol v4 from scratch over a plain TCP socket. No Cassandra driver, no connection pooling. Each HTTP request opens a new connection, handshakes, executes its operation, and closes.

---

## Frame format

All communication uses 9-byte frames:

```
 0         1         2    3    4         5    6    7    8
 +---------+---------+----+----+---------+----+----+----+----+
 | version | flags   |   stream (BE)     |opcode|    length (BE)   |
 +---------+---------+----+----+---------+----+----+----+----+
 | body bytes (length bytes follow)                              |
```

| Byte | Field | Notes |
|------|-------|-------|
| 0 | `version` | Client→Server: `0x04` (v4). Server→Client: `0x84` (bit 7 set indicates response). |
| 1 | `flags` | `0x00` always — no compression, no tracing, no custom payload. |
| 2–3 | `stream` | Big-endian signed int16. Hardcoded per operation (see below). |
| 4 | `opcode` | Operation type. |
| 5–8 | `length` | Big-endian int32. Body length in bytes. |

**Stream IDs used by this implementation:**

| Operation | Stream ID |
|-----------|-----------|
| OPTIONS | `0` |
| STARTUP | `0` |
| AUTH_RESPONSE | `2` |
| QUERY | `3` |
| PREPARE | `3` |
| EXECUTE | `4` |

Stream IDs are hardcoded. No response multiplexing — one request/response at a time per connection.

**Opcode reference:**

| Opcode | Name | Direction |
|--------|------|-----------|
| `0x00` | ERROR | Server→Client |
| `0x01` | STARTUP | Client→Server |
| `0x02` | READY | Server→Client |
| `0x03` | AUTHENTICATE | Server→Client |
| `0x05` | OPTIONS | Client→Server |
| `0x06` | SUPPORTED | Server→Client |
| `0x07` | QUERY | Client→Server |
| `0x08` | RESULT | Server→Client |
| `0x09` | PREPARE | Client→Server |
| `0x0A` | EXECUTE | Client→Server |
| `0x0F` | AUTH_RESPONSE | Client→Server |
| `0x10` | AUTH_SUCCESS | Server→Client |

BATCH (0x0D), REGISTER (0x0B), EVENT (0x0C), AUTH_CHALLENGE (0x0E) are received but not handled as distinct response types.

---

## Connection handshake sequence

All three endpoints begin with OPTIONS + STARTUP:

```
Client → Server: OPTIONS (stream 0, no body)
Server → Client: SUPPORTED (string multimap: CQL_VERSION → [...], COMPRESSION → [...])

Client → Server: STARTUP (stream 0, string map: { "CQL_VERSION": "3.0.0" })
Server → Client: READY                         ← no auth required
             OR: AUTHENTICATE (authenticator class name)  ← auth needed
             OR: ERROR
```

`CQL_VERSION` is hardcoded to `"3.0.0"` regardless of what SUPPORTED advertised. This works because servers accept `3.0.0` for any v3+ native protocol.

---

## Endpoints

### `POST /api/cassandra/connect` — Capabilities probe

Discovers server capabilities without querying data. Does not require credentials.

**Request:**
```json
{ "host": "cassandra.example.com", "port": 9042, "timeout": 10000 }
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | |
| `port` | `9042` | |
| `timeout` | `10000` | Wall-clock timeout in ms |

**Response:**
```json
{
  "success": true,
  "host": "cassandra.example.com",
  "port": 9042,
  "connectTime": 12,
  "rtt": 45,
  "protocolVersion": 4,
  "cqlVersions": ["3.4.6"],
  "compression": ["snappy", "lz4"],
  "authRequired": false,
  "startupResponse": "READY"
}
```

**When auth is required:**
```json
{
  "success": true,
  "authRequired": true,
  "authenticator": "org.apache.cassandra.auth.PasswordAuthenticator",
  "startupResponse": "AUTHENTICATE"
}
```

**Fields:**

| Field | Notes |
|-------|-------|
| `connectTime` | ms from `connect()` call to `socket.opened` |
| `rtt` | ms from start to final frame received |
| `protocolVersion` | Response version byte masked with `0x7F` (strips the response bit). Should be `4` for v4 servers. |
| `cqlVersions` | Array from `SUPPORTED['CQL_VERSION']`. Typically `["3.4.6"]`. |
| `compression` | Array from `SUPPORTED['COMPRESSION']`. Compression is never negotiated — this is informational only. |
| `authRequired` | `true` if STARTUP response was AUTHENTICATE. |
| `authenticator` | Fully-qualified Java class name from AUTHENTICATE body. Present only when `authRequired: true`. |
| `startupError` | Present if STARTUP returned an ERROR frame. Note: `success` remains `true` even in this case — check `startupError`. |
| `startupResponse` | String opcode name of the STARTUP response frame (`"READY"`, `"AUTHENTICATE"`, `"ERROR"`, or `"UNKNOWN(0xNN)"`). |

No authentication is attempted by this endpoint. If `authRequired` is `true`, use `/api/cassandra/query` or `/api/cassandra/prepare` with credentials.

---

### `POST /api/cassandra/query` — Execute CQL query

Authenticates (if needed) and executes a raw CQL string. Returns structured rows.

**Request:**
```json
{
  "host": "cassandra.example.com",
  "port": 9042,
  "timeout": 15000,
  "cql": "SELECT keyspace_name, table_name FROM system_schema.tables LIMIT 10",
  "username": "cassandra",
  "password": "cassandra"
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | |
| `cql` | **required** | CQL string |
| `username` | `""` | Sent in AUTH_RESPONSE even if empty |
| `password` | `""` | Sent in AUTH_RESPONSE even if empty |
| `port` | `9042` | |
| `timeout` | `15000` | |

**Authentication:** SASL PLAIN encoding: `\0username\0password`. Sent as `AUTH_RESPONSE` frame with a 4-byte length prefix before the SASL token.

**QUERY frame parameters (hardcoded):**

| Parameter | Value | Implication |
|-----------|-------|-------------|
| Consistency | `ONE` (0x0001) | Cannot be changed to QUORUM, LOCAL_QUORUM, ALL, etc. |
| Flags | `0x00` | No values, no skip metadata, no page size in flags byte |
| Page size | `100` | Always sent regardless of flags. Responses with > 100 rows are truncated at 100; no `paging_state` is captured or returned. |

**Response (success):**
```json
{
  "success": true,
  "host": "cassandra.example.com",
  "port": 9042,
  "rtt": 23,
  "cqlVersions": ["3.4.6"],
  "columns": [
    { "keyspace": "system_schema", "table": "tables", "name": "keyspace_name", "type": "varchar" },
    { "keyspace": "system_schema", "table": "tables", "name": "table_name", "type": "varchar" }
  ],
  "rows": [
    { "keyspace_name": "system", "table_name": "peers" },
    { "keyspace_name": "system", "table_name": "local" }
  ],
  "rowCount": 2
}
```

**Response (query error):**
```json
{
  "success": false,
  "host": "cassandra.example.com",
  "port": 9042,
  "rtt": 18,
  "error": "Query error: unconfigured table nonexistent (code 8704)",
  "cqlVersions": ["3.4.6"]
}
```

**Column type mapping:**

| CQL type | Hex | Decoded as |
|----------|-----|-----------|
| ascii | 0x0001 | Text (correct) |
| bigint | 0x0002 | Raw 8-byte BE int decoded as UTF-8 (garbled!) |
| blob | 0x0003 | Raw bytes decoded as UTF-8 (garbled) |
| boolean | 0x0004 | Single byte decoded as UTF-8 — `"\x01"` or `""` (empty for false) |
| counter | 0x0005 | Raw 8-byte BE int (garbled) |
| double | 0x0007 | Raw 8-byte IEEE 754 (garbled) |
| float | 0x0008 | Raw 4-byte IEEE 754 (garbled) |
| int | 0x0009 | Raw 4-byte BE int (garbled) |
| text / varchar | 0x000A / 0x000D | Text (correct) |
| timestamp | 0x000B | Raw 8-byte ms-since-epoch (garbled) |
| uuid / timeuuid | 0x000C / 0x000F | Raw 16-byte UUID (garbled) |
| inet | 0x0010 | Raw 4 or 16 bytes (garbled) |
| date | 0x0011 | Raw 4-byte day-since-epoch (garbled) |
| time | 0x0012 | Raw 8-byte ns-since-midnight (garbled) |
| smallint | 0x0013 | Raw 2-byte BE int (garbled) |
| tinyint | 0x0014 | Raw 1-byte int (garbled) |
| list / set | 0x0020 / 0x0022 | Element type code consumed (2 bytes), but values TextDecoded as-is (garbled) |
| map | 0x0021 | Key+value type codes consumed (4 bytes), values TextDecoded as-is (garbled) |
| udt | 0x0030 | Type code consumed but field subtypes NOT consumed → parser likely crashes on UDT columns |
| tuple | 0x0031 | Same as UDT — subtypes not consumed |

**Null cells** (wire length = `-1`) are returned as `null` in the row object.

**Practical implication:** `/api/cassandra/query` is reliable for queries against `system_schema`, `system`, and `system_auth` keyspaces (which use text/varchar/uuid columns) and for `SELECT` on user tables with text columns. Do not rely on `int`, `boolean`, `timestamp`, `uuid`, `list`, `map`, `set`, or binary columns returning readable values.

**USE keyspace:** There is no USE statement between connection and query. All tables must be fully qualified: `SELECT * FROM mykeyspace.mytable` — not `SELECT * FROM mytable`. A bare table name returns error code 8704.

---

### `POST /api/cassandra/prepare` — Prepare and execute a parameterized statement

PREPARE a CQL template, then EXECUTE it with bound string values. Uses two network round-trips on the same connection.

**Request:**
```json
{
  "host": "cassandra.example.com",
  "port": 9042,
  "timeout": 15000,
  "cql": "SELECT * FROM system.peers WHERE peer = ?",
  "values": ["127.0.0.2"],
  "username": "cassandra",
  "password": "cassandra"
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `cql` | **required** | CQL with `?` placeholders |
| `values` | `[]` | Positional bound values (all must be strings) |

**Wire sequence:**
```
OPTIONS (stream 0) → SUPPORTED
STARTUP (stream 0) → READY / AUTHENTICATE
[AUTH_RESPONSE (stream 2) → AUTH_SUCCESS]   ← only if auth required
PREPARE (stream 3, body: long-string query) → RESULT (kind=PREPARED)
EXECUTE (stream 4, body: preparedId + consistency ONE + values) → RESULT (kind=Rows) or ERROR
```

**PREPARE body:** `[4-byte big-endian length][query UTF-8 bytes]`

**PREPARED result body:** `kind(4)=0x0004 + preparedId_len(2) + preparedId_bytes + (metadata follows but is not parsed)`

**EXECUTE body:**
```
[2-byte preparedId length][preparedId bytes]
[2-byte consistency = ONE (0x0001)]
[1-byte flags = 0x01 if values present, 0x00 if no values]
[if flags=0x01: 2-byte value count + [4-byte len + bytes per value]]
```

All values are serialized as UTF-8 bytes. This is correct only for `text`, `varchar`, and `ascii` parameters. For `int`, `bigint`, `boolean`, `uuid`, `inet`, `timestamp`, etc., the Cassandra server will reject EXECUTE with a deserialization error because the bytes don't match the expected binary format.

**Response:**
```json
{
  "success": true,
  "host": "cassandra.example.com",
  "port": 9042,
  "rtt": 31,
  "preparedIdHex": "a1b2c3d4e5f60011",
  "cqlVersions": ["3.4.6"],
  "columns": [...],
  "rows": [...],
  "rowCount": 1
}
```

`preparedIdHex` is the prepared statement identifier as a hex string. It is scoped to this connection and is discarded after the response — there is no prepared statement cache across HTTP requests.

The same column type decoding limitations from `/query` apply here.

---

## Stream reading: `readExact`

All frame reads use `readExact(reader, length)`, which loops calling `reader.read()` until exactly `length` bytes are accumulated. This handles TCP segment fragmentation correctly. However, if the connection closes before `length` bytes arrive, it throws `"Connection closed while reading"`.

There is no per-read timeout inside `readExact`. The outer `timeout` promise races the entire connection promise — if any `readExact` call hangs indefinitely, the outer timeout will fire. The inner reads themselves have no independent deadline.

---

## Error codes

| Code (hex) | Code (dec) | Name |
|------------|-----------|------|
| 0x0000 | 0 | ServerError |
| 0x000A | 10 | ProtocolError |
| 0x0100 | 256 | AuthenticationError |
| 0x1000 | 4096 | Unavailable |
| 0x1001 | 4097 | Overloaded |
| 0x1002 | 4098 | IsBootstrapping |
| 0x1003 | 4099 | TruncateError |
| 0x1100 | 4352 | WriteTimeout |
| 0x1200 | 4608 | ReadTimeout |
| 0x2000 | 8192 | SyntaxError |
| 0x2100 | 8448 | Unauthorized |
| 0x2200 | 8704 | Invalid (e.g., table not found, not fully qualified) |
| 0x2300 | 8960 | ConfigError |
| 0x2400 | 9216 | AlreadyExists |
| 0x2500 | 9472 | Unprepared |

Error codes appear in the `error` field as `"... (code N)"` using the decimal form.

---

## What is NOT implemented

| Feature | Notes |
|---------|-------|
| TLS / SSL | Plain TCP only; Cassandra TLS port 9142 will fail |
| SASL mechanisms beyond PLAIN | No Kerberos, no GSSAPI |
| Compression | SNAPPY and LZ4 are advertised by the server; neither is negotiated |
| Configurable consistency | Hardcoded to ONE; QUORUM, LOCAL_QUORUM, ALL are not available |
| Pagination | Page size fixed at 100; no paging_state tracking |
| Non-string bound values | Only UTF-8 strings work as EXECUTE values |
| Non-text column decoding | int, boolean, float, uuid, timestamp, list, map, set return garbled or null |
| USE keyspace | No USE between connect and query; fully-qualify all table names |
| BATCH | No batch statement support |
| EVENT / REGISTER | No server-side push events |
| Schema changes | DDL (CREATE TABLE, DROP, ALTER) returns RESULT_SCHEMA_CHANGE (0x0005); `columns` and `rows` will be empty and the schema change is not surfaced |
| Prepared statement caching | preparedId is scoped to one connection; not reusable across requests |
| Cluster topology | No round-robin across replica nodes |

---

## curl quick reference

```bash
# Connect probe (no credentials needed)
curl -s -X POST https://portofcall.ross.gg/api/cassandra/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"cassandra.example.com"}' | jq '{protocolVersion,cqlVersions,compression,authRequired}'

# Check if auth is required
curl -s -X POST https://portofcall.ross.gg/api/cassandra/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"cassandra.example.com"}' | jq '{authRequired,authenticator}'

# List keyspaces (system_schema — no auth on many setups)
curl -s -X POST https://portofcall.ross.gg/api/cassandra/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"cassandra.example.com","cql":"SELECT keyspace_name FROM system_schema.keyspaces"}' | jq '.rows[].keyspace_name'

# List tables in a keyspace
curl -s -X POST https://portofcall.ross.gg/api/cassandra/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"cassandra.example.com","cql":"SELECT table_name FROM system_schema.tables WHERE keyspace_name = '"'"'system'"'"'"}' | jq '.rows[].table_name'

# Query with auth
curl -s -X POST https://portofcall.ross.gg/api/cassandra/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"cassandra.example.com","username":"cassandra","password":"cassandra","cql":"SELECT peer, data_center, rack FROM system.peers"}' | jq '.rows'

# Prepared statement with ? placeholder (string params only)
curl -s -X POST https://portofcall.ross.gg/api/cassandra/prepare \
  -H 'Content-Type: application/json' \
  -d '{"host":"cassandra.example.com","cql":"SELECT * FROM system_schema.tables WHERE keyspace_name = ?","values":["system"]}' | jq '{preparedIdHex,rowCount,rows}'

# Peer topology check
curl -s -X POST https://portofcall.ross.gg/api/cassandra/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"cassandra.example.com","cql":"SELECT peer, data_center, rack, release_version FROM system.peers"}' | jq '.rows'

# Check local node info
curl -s -X POST https://portofcall.ross.gg/api/cassandra/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"cassandra.example.com","cql":"SELECT cluster_name, data_center, rack, release_version, cql_version FROM system.local"}' | jq '.rows[0]'
```

---

## Local test server

```bash
# Single-node Cassandra (no auth)
docker run -d -p 9042:9042 --name cassandra cassandra:4.1

# Wait for startup
docker exec cassandra nodetool status 2>/dev/null | grep -q UN && echo ready || echo not ready

# With PasswordAuthenticator (requires username/password)
docker run -d -p 9042:9042 \
  -e CASSANDRA_AUTHENTICATOR=PasswordAuthenticator \
  -e CASSANDRA_AUTHORIZER=CassandraAuthorizer \
  --name cassandra-auth cassandra:4.1
```

Default credentials when `PasswordAuthenticator` is enabled: `cassandra` / `cassandra`.

For testing text-column queries, the `system_schema` and `system` keyspaces work well without needing to create your own schema — they contain only `varchar` / `text` / `uuid` columns. Avoid `system.local.tokens` (a `set<varchar>` which currently returns garbled data from the list/set parser).
