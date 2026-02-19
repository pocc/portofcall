# ClickHouse Protocol Reference

Power-user reference for the ClickHouse protocol implementation in Port of Call.

## Ports

| Port | Protocol | TLS | Description |
|------|----------|-----|-------------|
| 8123 | HTTP | No | HTTP interface for queries, health checks, and management |
| 8443 | HTTPS | Yes | TLS-encrypted HTTP interface |
| 9000 | Native TCP | No | Binary native protocol used by `clickhouse-client` and native drivers |
| 9440 | Native TCP | Yes | TLS-encrypted native protocol |
| 9004 | MySQL | No | MySQL wire-compatible interface |
| 9005 | PostgreSQL | No | PostgreSQL wire-compatible interface |
| 9009 | Interserver | No | Server-to-server replication and data exchange |

## Native TCP Protocol (Port 9000)

### Wire Format Primitives

#### VarUInt (Unsigned LEB128)

All variable-length integers in the native protocol use unsigned LEB128 encoding, identical to Protocol Buffers varint encoding. Each byte stores 7 data bits in bits 0-6 and a continuation flag in bit 7 (MSB). If bit 7 is set, more bytes follow.

```
Value: 0-127         → 1 byte    (7 bits of data)
Value: 128-16383     → 2 bytes   (14 bits)
Value: 16384-2097151 → 3 bytes   (21 bits)
...up to 9 bytes for 64-bit values
```

Encoding example for value `300` (0x12C):
```
Byte 0: 0xAC (10101100) → data bits = 0101100 (0x2C), continuation = 1
Byte 1: 0x02 (00000010) → data bits = 0000010 (0x02), continuation = 0
Decode: (0x02 << 7) | 0x2C = 256 + 44 = 300
```

Encoding example for value `0`:
```
Byte 0: 0x00 (00000000) → data bits = 0000000, continuation = 0
```

#### String

Strings are encoded as a VarUInt byte length followed by raw UTF-8 bytes. The length is the **byte count** of the UTF-8 encoding, not the character count.

```
[VarUInt byte_length][UTF-8 bytes...]
```

Empty string: `0x00` (VarUInt 0, zero bytes follow).

#### Fixed-Width Integers

All fixed-width integers are little-endian:
- `UInt8` / `Int8`: 1 byte
- `UInt16` / `Int16`: 2 bytes LE
- `UInt32` / `Int32`: 4 bytes LE
- `UInt64` / `Int64`: 8 bytes LE
- `Float32`: 4 bytes LE (IEEE 754)
- `Float64`: 8 bytes LE (IEEE 754)

### Packet Types

#### Client Packet Types (Client to Server)

| Type ID | Name | Description |
|---------|------|-------------|
| 0 | ClientHello | Initial handshake with client identification |
| 1 | ClientQuery | SQL query with client info and settings |
| 2 | ClientData | Data block (empty block signals end of input for SELECT) |
| 3 | ClientCancel | Cancel running query |
| 4 | ClientPing | Keep-alive ping |

#### Server Packet Types (Server to Client)

| Type ID | Name | Description |
|---------|------|-------------|
| 0 | ServerHello | Handshake response with server identification |
| 1 | ServerData | Data block with column data |
| 2 | ServerException | Error response with code, name, message, stack trace |
| 3 | ServerProgress | Query progress (rows read, bytes read, total rows) |
| 4 | ServerPong | Response to ClientPing |
| 5 | ServerEndOfStream | All data sent, query complete |
| 6 | ServerProfileInfo | Query profiling information |
| 7 | ServerTotals | Totals row for GROUP BY WITH TOTALS |
| 8 | ServerExtremes | Min/max values for result columns |
| 9 | ServerTablesStatusResponse | Tables status for distributed queries |
| 10 | ServerLog | Server log entries |
| 11 | ServerTableColumns | Column descriptions for INSERT |
| 14 | ServerProfileEvents | Profile event counters |

### Connection Handshake

The native protocol handshake is a two-packet exchange:

```
Client                          Server
  |                                |
  |──── ClientHello (type 0) ─────>|
  |                                |
  |<─── ServerHello (type 0) ──────|  (success)
  |  or                            |
  |<─── ServerException (type 2) ──|  (auth failure / error)
```

#### ClientHello (Packet Type 0)

```
[VarUInt 0]                    ← packet type
[String client_name]           ← e.g. "PortOfCall"
[VarUInt version_major]        ← client version major
[VarUInt version_minor]        ← client version minor
[VarUInt tcp_protocol_version] ← protocol revision (e.g. 54046)
[String database]              ← database to use (e.g. "default")
[String user]                  ← username (e.g. "default")
[String password]              ← password (empty string if none)
```

The `tcp_protocol_version` (also called "revision") controls which protocol features are available. Important thresholds:
- 51302: Block info in Data packets
- 54032: Settings serialization format change
- 54372: Server display name in ServerHello
- 54406: Interserver secret field
- 54423: Server timezone in ServerHello
- 54460: Written rows/bytes in Progress packets

#### ServerHello (Packet Type 0)

```
[VarUInt 0]                    ← packet type
[String server_name]           ← e.g. "ClickHouse"
[VarUInt version_major]        ← server version major
[VarUInt version_minor]        ← server version minor
[VarUInt revision]             ← server protocol revision
[String timezone]              ← e.g. "UTC" (revision >= 54423)
[String display_name]          ← server display name (revision >= 54372)
```

#### ServerException (Packet Type 2)

```
[VarUInt 2]                    ← packet type
[UInt32 code]                  ← error code (little-endian)
[String name]                  ← exception class name
[String message]               ← human-readable error message
[String stack_trace]           ← server-side stack trace
[UInt8 has_nested]             ← 1 if a nested exception follows
```

If `has_nested` is 1, another exception structure follows immediately (recursive).

### Query Execution

After a successful handshake, queries follow this pattern:

```
Client                          Server
  |                                |
  |──── ClientQuery (type 1) ─────>|
  |──── ClientData (type 2) ──────>|  (empty block = no input data)
  |                                |
  |<─── ServerProgress (type 3) ───|  (optional, repeated)
  |<─── ServerData (type 1) ───────|  (column headers, 0 rows)
  |<─── ServerData (type 1) ───────|  (actual row data)
  |<─── ServerProfileInfo (type 6)─|  (optional)
  |<─── ServerProfileEvents (14) ──|  (optional)
  |<─── ServerEndOfStream (type 5)─|
```

#### ClientQuery (Packet Type 1)

```
[VarUInt 1]                    ← packet type
[String query_id]              ← empty for server-assigned ID

--- Client Info block ---
[UInt8 query_kind]             ← 1 = InitialQuery, 2 = SecondaryQuery
[String initial_user]          ← user who initiated (for distributed tracking)
[String initial_query_id]     ← original query ID (for distributed tracking)
[String initial_address]       ← client address (e.g. "[::ffff:127.0.0.1]:0")
[UInt8 interface]              ← 1 = TCP, 2 = HTTP
[String os_user]               ← OS username
[String client_hostname]       ← client machine hostname
[String client_name]           ← client application name
[VarUInt version_major]        ← client version
[VarUInt version_minor]
[VarUInt tcp_protocol_version]
[String quota_key]             ← empty if no quota
[VarUInt settings_count]       ← 0 = no settings (format depends on revision)
--- End Client Info ---

[String settings_end]          ← empty string marks end of settings
[String interserver_secret]    ← empty for non-cluster queries
[VarUInt stage]                ← query processing stage (0=FetchColumns, 1=WithMergeableState, 2=Complete)
[VarUInt compression]          ← 0 = None, 1 = LZ4, 2 = ZSTD
[String query_text]            ← the SQL query
```

#### ClientData (Packet Type 2)

Data blocks are used for both sending INSERT data and signaling "no more input" (empty block) for SELECT queries.

```
[VarUInt 2]                    ← packet type
[String table_name]            ← empty for non-INSERT

--- Block Info ---
[VarUInt field_num=1]          ← is_overflows field
[UInt8 is_overflows]           ← 0 = false
[VarUInt field_num=2]          ← bucket_num field
[Int32 bucket_num]             ← -1 (0xFFFFFFFF LE)
[VarUInt field_num=0]          ← end of block info
--- End Block Info ---

[VarUInt num_columns]          ← 0 for empty block
[VarUInt num_rows]             ← 0 for empty block

--- For each column (if num_columns > 0) ---
[String column_name]
[String column_type]
[... column data (num_rows values serialized per type) ...]
--- End columns ---
```

The block info section uses a tagged field format: each field is identified by a VarUInt field number, followed by its value. Field number 0 signals end of block info. Required since protocol revision 51302.

#### ServerData (Packet Type 1)

Same structure as ClientData (type 2), but sent by the server. Column data is serialized in **columnar** format: all values for column 0, then all values for column 1, etc.

#### Data Serialization by Type

Values within data blocks are serialized in column-major order (all values for one column, then the next). Serialization format depends on the ClickHouse type:

| Type | Wire Format |
|------|-------------|
| `UInt8` | 1 byte |
| `UInt16` | 2 bytes LE |
| `UInt32` | 4 bytes LE |
| `UInt64` | 8 bytes LE |
| `Int8` | 1 byte (two's complement) |
| `Int16` | 2 bytes LE |
| `Int32` | 4 bytes LE |
| `Int64` | 8 bytes LE |
| `Float32` | 4 bytes LE (IEEE 754) |
| `Float64` | 8 bytes LE (IEEE 754) |
| `String` | VarUInt length + UTF-8 bytes |
| `FixedString(N)` | N bytes (zero-padded) |
| `Date` | UInt16 (days since 1970-01-01) |
| `DateTime` | UInt32 (unix timestamp) |
| `Nullable(T)` | For N rows: N bytes of null flags (0=value, 1=null), then N values of type T |

Note on `Nullable`: The null flag byte array comes before all values for the column, not interleaved per-row.

### Progress Packets (Server Packet Type 3)

Sent periodically during query execution:

```
[VarUInt 3]                    ← packet type
[VarUInt rows_read]
[VarUInt bytes_read]
[VarUInt total_rows_to_read]   ← 0 if unknown
[VarUInt written_rows]         ← revision >= 54460
[VarUInt written_bytes]        ← revision >= 54460
```

### ProfileInfo Packets (Server Packet Type 6)

```
[VarUInt 6]                    ← packet type
[VarUInt rows]
[VarUInt blocks]
[VarUInt bytes]
[VarUInt applied_limit]        ← boolean as VarUInt
[VarUInt rows_before_limit]
[VarUInt calculated_rows_before_limit] ← boolean as VarUInt
[UInt8 applied_aggregation]
[UInt8 applied_limit_flag]
[UInt8 applied_sorting]
```

## HTTP Interface (Port 8123)

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/ping` | Health check, returns `Ok.\n`. No auth required. |
| GET | `/replicas_status` | Replica health check |
| GET | `/?query=SQL` | Execute read query via query parameter |
| POST | `/` | Execute query with SQL in request body |
| GET | `/play` | Built-in web UI (if enabled) |

### Authentication

Three methods, checked in order:
1. **Query parameters**: `?user=default&password=secret`
2. **HTTP headers**: `X-ClickHouse-User` and `X-ClickHouse-Key`
3. **HTTP Basic Auth**: Standard `Authorization: Basic ...` header

### Query Parameters

| Parameter | Description |
|-----------|-------------|
| `query` | SQL query text |
| `database` | Target database (overrides default) |
| `default_format` | Output format (e.g. `JSONCompact`, `TabSeparated`) |
| `user` | Username |
| `password` | Password |
| `max_result_rows` | Limit result rows |
| `max_result_bytes` | Limit result bytes |
| `result_overflow_mode` | `throw` or `break` when limit exceeded |
| `buffer_size` | Buffering for output |
| `wait_end_of_query` | Buffer entire result before sending |
| `session_id` | Session identifier for stateful connections |
| `session_timeout` | Session timeout in seconds |
| `session_check` | Check session existence |

### Output Formats (Common)

| Format | Description |
|--------|-------------|
| `TabSeparated` | TSV (default) |
| `JSON` | Full JSON with metadata |
| `JSONCompact` | JSON with arrays instead of objects for rows |
| `JSONEachRow` | One JSON object per line |
| `CSV` | Comma-separated values |
| `Pretty` | Human-readable table |
| `Vertical` | Each column on its own line |
| `Native` | Binary native format (for inter-server) |
| `RowBinary` | Binary row-oriented format |
| `Null` | Discard output (useful for INSERT ... SELECT) |

### Response Headers

ClickHouse HTTP responses include useful headers:

| Header | Description |
|--------|-------------|
| `X-ClickHouse-Server-Display-Name` | Server display name |
| `X-ClickHouse-Query-Id` | Assigned query ID |
| `X-ClickHouse-Format` | Output format used |
| `X-ClickHouse-Timezone` | Server timezone |
| `X-ClickHouse-Summary` | JSON with read/written rows and bytes |

### Error Responses

HTTP errors return the error message in the response body with an appropriate HTTP status code. ClickHouse-specific error codes are included in the body text, e.g.:

```
Code: 60. DB::Exception: Table default.nonexistent doesn't exist.
```

## Implementation: Port of Call Endpoints

### POST /api/clickhouse/health

Probes a ClickHouse HTTP interface for health, version, and databases.

**Request:**
```json
{
  "host": "clickhouse.example.com",
  "port": 8123,
  "user": "default",
  "password": "",
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "statusCode": 200,
  "version": "24.3.1.123",
  "serverInfo": {
    "uptime": "86400",
    "current_db": "default",
    "hostname": "ch-node-1"
  },
  "databases": ["default", "system", "information_schema", "INFORMATION_SCHEMA"],
  "latencyMs": 42
}
```

### POST /api/clickhouse/query

Executes an arbitrary SQL query via the HTTP interface.

**Request:**
```json
{
  "host": "clickhouse.example.com",
  "port": 8123,
  "query": "SELECT * FROM system.tables LIMIT 5",
  "database": "default",
  "format": "JSONCompact",
  "user": "default",
  "password": "",
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "statusCode": 200,
  "body": "...",
  "parsed": { "meta": [...], "data": [...], "rows": 5 },
  "latencyMs": 15,
  "format": "JSONCompact"
}
```

### POST /api/clickhouse/native

Probes a ClickHouse native TCP port using the binary protocol. Performs a ClientHello/ServerHello handshake and optionally executes a query.

**Request:**
```json
{
  "host": "clickhouse.example.com",
  "port": 9000,
  "user": "default",
  "password": "",
  "database": "default",
  "query": "SELECT version()",
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "serverName": "ClickHouse",
  "serverVersion": "24.3",
  "serverRevision": 54478,
  "serverTimezone": "UTC",
  "serverDisplayName": "ch-node-1",
  "latencyMs": 28,
  "queryResult": {
    "columns": [{ "name": "version()", "type": "String" }],
    "rows": [["24.3.1.123"]],
    "rowCount": 1
  }
}
```

## Security Considerations

- The native protocol transmits credentials in **plaintext** on port 9000. Use port 9440 (TLS) in production.
- The HTTP interface transmits credentials as query parameters (visible in logs) or headers. Use port 8443 (HTTPS) in production.
- This tool sends user-supplied SQL directly to ClickHouse with no query filtering. It is a diagnostic/connectivity tool, not a production data gateway.
- ClickHouse's `default` user often has no password by default. Always configure authentication in production.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Connection timeout on 9000 | Firewall blocking native port | Check firewall rules, try HTTP on 8123 |
| `ServerException: Authentication failed` | Wrong user/password | Verify credentials, check `users.xml` |
| `Unexpected server packet type` | Not a ClickHouse native port | Verify port is 9000 (not 8123/9009) |
| `No response from server` | Port closed or wrong service | Verify ClickHouse is running on that port |
| HTTP 403 on health check | Auth required for queries | Provide user/password; `/ping` should still work |
| Chunked encoding parse error | Large response truncated | Increase timeout or use a simpler query |
