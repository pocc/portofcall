# TDS (Tabular Data Stream) — SQL Server / Sybase

Port of Call implements TDS 7.4 (the protocol underlying Microsoft SQL Server and Sybase ASE) via raw TCP using `cloudflare:sockets`. Three endpoints are provided: a Pre-Login probe, a login-only auth check, and a full query execution.

Default port: **1433**

---

## Packet Format

Every TDS exchange uses the same 8-byte packet header:

| Offset | Size | Field       | Notes |
|--------|------|-------------|-------|
| 0      | 1    | Type        | 0x01=SQL_BATCH, 0x04=Tabular Result, 0x10=LOGIN7, 0x12=PRELOGIN |
| 1      | 1    | Status      | Bit 0 = EOM (final packet in message); 0x01 usual for single-packet |
| 2      | 2    | Length      | Total packet length including header, big-endian |
| 4      | 2    | SPID        | Server process ID (0 from client) |
| 6      | 1    | PacketID    | Rolling sequence number (1 from client) |
| 7      | 1    | Window      | Always 0 |

Payloads for a single TDS message may span multiple packets. `readTDSMessage` concatenates payloads until the EOM bit (0x01) is set in Status.

---

## Buffer Handling

`readExact(reader, buf, n)` maintains a shared `buf: {data: Uint8Array}` object across calls on the same connection. Unconsumed bytes from a previous read are prepended to the next chunk before slicing. This pattern is used throughout login and query parsing to avoid dropping data at packet boundaries.

---

## Endpoint 1 — Pre-Login Probe

```
POST /api/tds/connect
Content-Type: application/json
```

**Request:**

```json
{
  "host": "sqlserver.example.com",
  "port": 1433
}
```

| Field  | Type   | Required | Default | Notes |
|--------|--------|----------|---------|-------|
| host   | string | yes      | —       | Hostname or IP |
| port   | number | no       | 1433    | |

**What happens:** Opens a TCP socket, sends a PRELOGIN packet (type 0x12), and reads the server's Pre-Login response directly (via `readTDSPacket`, not `readTDSMessage`). No credentials are sent. The response is parsed for version info, encryption capability, instance name, thread ID, and MARS support.

**Pre-Login packet structure:**

The client sends 5 options followed by a terminator. Each option header is 5 bytes (type=1B, offset=2B BE, length=2B BE); the data section follows the option headers.

| Option | Token | Data |
|--------|-------|------|
| VERSION | 0x00 | 6 bytes: major.minor.build(2BE).subBuild(2BE) — sent as zeros |
| ENCRYPTION | 0x01 | 1 byte: **always 0x00 (ENCRYPT_OFF)** |
| INSTOPT | 0x02 | 1 byte: 0x00 |
| THREADID | 0x03 | 4 bytes: 0x00000000 |
| MARS | 0x04 | 1 byte: 0x00 (disabled) |
| TERMINATOR | 0xFF | (no data) |

> **Critical:** `ENCRYPT_OFF` is always sent regardless of server configuration. TLS is **never negotiated** in this implementation. Connecting to a server that requires encryption will fail (the server will reject the PRELOGIN or LOGIN7).

**Successful response:**

```json
{
  "success": true,
  "host": "sqlserver.example.com",
  "port": 1433,
  "protocol": "TDS",
  "responseType": "04",
  "version": "15.0.2000.5",
  "tdsVersion": "7.4",
  "encryption": "ENCRYPT_OFF",
  "encryptionValue": "00",
  "instanceName": "",
  "threadId": "00000000",
  "mars": "00",
  "message": "Pre-Login successful"
}
```

| Field           | Notes |
|-----------------|-------|
| responseType    | First byte of Pre-Login response as hex string (0x04 = tabular result) |
| version         | `major.minor.build.subBuild` parsed from VERSION option |
| tdsVersion      | Mapped from Pre-Login version bytes: "7.4", "7.3", etc. |
| encryption      | Human-readable: ENCRYPT_OFF / ENCRYPT_ON / ENCRYPT_REQ / ENCRYPT_NOT_SUP |
| encryptionValue | Raw hex byte of ENCRYPTION option |
| instanceName    | Null-terminated ASCII from INSTOPT payload; often empty |
| threadId        | 4 bytes as hex string |
| mars            | 1 byte as hex string; 0x00=disabled, 0x01=enabled |

---

## Endpoint 2 — Login (Auth Check)

```
POST /api/tds/login
Content-Type: application/json
```

**Request:**

```json
{
  "host": "sqlserver.example.com",
  "port": 1433,
  "username": "sa",
  "password": "YourPassword",
  "database": "master"
}
```

| Field    | Type   | Required | Default  | Notes |
|----------|--------|----------|----------|-------|
| host     | string | yes      | —        | |
| port     | number | no       | 1433     | |
| username | string | yes      | —        | SQL Server login name |
| password | string | yes      | —        | Plaintext; obfuscated before send |
| database | string | no       | (omitted)| Initial catalog; empty string if not set |

**What happens:** Pre-Login → LOGIN7 → reads token stream until DONE. No SQL is sent. The login token stream is parsed for LOGINACK, INFO/ERROR, and ENVCHANGE tokens to extract server info and verify authentication.

**LOGIN7 packet internals:**

- Fixed 94-byte header + 7 UTF-16LE variable-length string fields (hostname, username, password, appname, servername, unused, libraryname, database)
- TDS version: `0x04000074` (little-endian for TDS 7.4) — hardcoded
- Client program version: `0x07000000` — hardcoded
- Packet size: 4096 — hardcoded
- LCID: `0x0409` (en-US) — hardcoded
- App name, host name, library name: all sent as `"portofcall"` — hardcoded
- Capability flags: `0x00E0` (ODBC, READ_ONLY_INTENT bits set) — hardcoded
- Auth type: SQL Server authentication only. **No Windows auth (NTLM/Kerberos) is implemented.**

**Password obfuscation** (LOGIN7 requirement):

1. XOR each byte with `0xA5`
2. Swap the high nibble and low nibble of each byte

This is reversible and is **not encryption** — it is a trivial wire encoding required by the TDS spec.

**Successful response:**

```json
{
  "success": true,
  "serverName": "SQLSERVER01",
  "serverVersion": "15.00.2000",
  "tdsVersion": "7.4",
  "database": "master"
}
```

| Field         | Notes |
|---------------|-------|
| serverName    | From LOGINACK ProgName field (B_VARCHAR) |
| serverVersion | From LOGINACK ProgVersion bytes: `major.minor.patch` |
| tdsVersion    | From LOGINACK TDSVersion field (4 bytes BE) |
| database      | From ENVCHANGE type 1 (database change) NewValue field |

**Error response:**

```json
{
  "success": false,
  "error": "Login failed for user 'sa'. (severity: 14)"
}
```

INFO tokens with severity >= 14 are treated as errors. The message comes from the INFO/ERROR token's message field (US_VARCHAR: 2-byte length prefix + UTF-16LE).

---

## Endpoint 3 — Query

```
POST /api/tds/query
Content-Type: application/json
```

**Request:**

```json
{
  "host": "sqlserver.example.com",
  "port": 1433,
  "username": "sa",
  "password": "YourPassword",
  "database": "master",
  "sql": "SELECT name, create_date FROM sys.databases ORDER BY name"
}
```

| Field    | Type   | Required | Notes |
|----------|--------|----------|-------|
| host     | string | yes      | |
| port     | number | no       | Defaults to 1433 |
| username | string | yes      | |
| password | string | yes      | |
| database | string | no       | Initial catalog |
| sql      | string | yes      | Arbitrary T-SQL; UTF-16LE encoded on the wire |

**What happens:** Pre-Login → LOGIN7 → SQL_BATCH (type 0x01, SQL as UTF-16LE) → parses token stream for COLMETADATA and ROW tokens.

**Successful response:**

```json
{
  "success": true,
  "columns": ["name", "create_date"],
  "rows": [
    ["master", "temporal:8bytes"],
    ["model", "temporal:8bytes"],
    ["msdb", "temporal:8bytes"]
  ],
  "rowCount": 3,
  "database": "master",
  "serverVersion": "15.00.2000"
}
```

| Field         | Notes |
|---------------|-------|
| columns       | Array of column name strings only (no type metadata exposed) |
| rows          | Array of arrays; values are strings, numbers, or null |
| rowCount      | Count of ROW tokens parsed |
| database      | From ENVCHANGE type 1 |
| serverVersion | From LOGINACK ProgVersion |

---

## Column Type Decoding Reference

Only a subset of SQL Server types return usable values. Many types return placeholder strings indicating the raw byte size.

| Type token | SQL type(s) | Returned value |
|------------|-------------|----------------|
| 0x30 | TINYINT | JavaScript number |
| 0x34 | SMALLINT | JavaScript number |
| 0x38 | INT | JavaScript number |
| 0x7F | BIGINT | number if hi word = 0; `"hi*4294967296+lo"` string if > 2^32-1 |
| 0x3A | SMALLDATETIME | `"datetime:4bytes"` |
| 0x3B | REAL | JavaScript number (float32) |
| 0x3D | DATETIME | `"datetime:8bytes"` |
| 0x3E | FLOAT (8B) | JavaScript number (float64) |
| 0x68 | BIT (nullable) | `1` or `0` |
| 0x6A | DECIMAL(n) | Decoded magnitude only (scale is **lost** — effectively an integer) |
| 0x6C | NUMERIC(n) | Same as DECIMAL |
| 0x6D | FLOAT (nullable) | number or null |
| 0x6E | MONEY, SMALLMONEY | number |
| 0x6F | DATETIMEN | `"datetime:Nbytes"` (N=4 or 8) |
| 0x24 | UNIQUEIDENTIFIER | 32-char hex string **without dashes** (not standard UUID) |
| 0xA7 | VARCHAR(n) | UTF-8 decoded string or null |
| 0xAD | BINARY(n) | `"binary:Nbytes"` |
| 0xAF | CHAR(n) | UTF-8 decoded string or null |
| 0xE7 | NVARCHAR(n) | UTF-16LE decoded string or null |
| 0xEF | NCHAR(n) | UTF-16LE decoded string or null |
| 0x63 | SYSNAME | UTF-16LE decoded string or null |
| 0x22 | TEXT | `"text:Nbytes"` |
| 0x23 | NTEXT | `"text:Nbytes"` |
| 0x62 | IMAGE | `"binary:Nbytes"` |
| 0xF1 | XML | `"xml:Nbytes"` (XMLTYPE with metadata) |
| 0x29 | TIME(n) | `"temporal:Nbytes"` |
| 0x2A | DATETIME2(n) | `"temporal:Nbytes"` |
| 0x2B | DATETIMEOFFSET(n) | `"temporal:Nbytes"` |
| 0x28 | DATE | `"date:N"` (N = days since SQL Server epoch 0001-01-01; **not decoded to calendar date**) |
| 0xA5 | VARBINARY(n) | `"binary:Nbytes"` |
| 0xF0 | UDT | `"udt:Nbytes"` |

**Key caveats:**
- UNIQUEIDENTIFIER bytes are concatenated as hex without standard UUID byte-order swapping or dash insertion. The 16 bytes are output as `aabbccdd...` not `ddccbbaa-...`.
- DECIMAL/NUMERIC: the implementation accumulates byte values into a magnitude but discards the scale exponent. A `DECIMAL(10,4)` value of `12.3456` may be returned as `123456` or similar.
- DATE is returned as an integer (days since epoch), not converted to a date string.
- All temporal types (DATETIMEN, DATETIME, SMALLDATETIME, TIME, DATETIME2, DATETIMEOFFSET) return placeholder strings.
- Unknown token types: the parser attempts to skip by reading a 2-byte little-endian length and consuming that many bytes. If an unknown token doesn't follow the 2-byte-length-prefixed pattern, the entire token stream parse will misalign.

---

## Token Stream Reference

Tokens appear in the TDS response payload after LOGIN7 and after SQL_BATCH.

| Token | Hex | Consumed by parser | Produces |
|-------|-----|-------------------|---------|
| COLMETADATA | 0x81 | yes | Column metadata array |
| ROW | 0xD1 | yes | One row array per token |
| LOGINACK | 0xAD | yes | serverName, serverVersion, tdsVersion |
| INFO | 0xAB | yes | message (logged; severity<14 ignored) |
| ERROR | 0xAE | yes | message; severity>=14 throws |
| ENVCHANGE | 0xE3 | yes (types 1-6, 13) | database name from type 1 |
| DONE | 0xFD | yes | rowCount (lower 32 bits of 8-byte field) |
| DONEPROC | 0xFE | yes | (same as DONE) |
| DONEINPROC | 0xFF | yes | (same as DONE) |
| RETURNSTATUS | 0x79 | partial | skipped via 4-byte read |
| ORDER | 0xA9 | partial | skipped via column count * 2 bytes |
| unknown | — | fragile | 2LE length skip (may misalign) |

---

## Known Limitations

| Limitation | Detail |
|-----------|--------|
| No TLS | ENCRYPT_OFF always sent. Servers requiring encryption will reject the connection. |
| No Windows auth | Only SQL Server authentication (username/password). NTLM/Kerberos not implemented. |
| No prepared statements | All SQL sent as SQL_BATCH. No `sp_prepare`/`sp_execute`. |
| No stored procedure calls | RPC packets (type 0x03) not implemented. |
| No multiple result sets | Only the first COLMETADATA block and its rows are captured. |
| No query cancellation | Attention signal (type 0x06) not implemented. |
| No transactions | BEGIN/COMMIT/ROLLBACK must be sent as SQL strings within the `sql` field. |
| Single-packet connect | `handleTDSConnect` reads the Pre-Login response via single `readTDSPacket`, not `readTDSMessage`. Multi-packet Pre-Login responses would be truncated (rare in practice). |
| Temporal placeholders | DATE, TIME, DATETIME2, DATETIMEOFFSET, DATETIMEN all return undecodable strings. |
| DECIMAL scale lost | DECIMAL/NUMERIC magnitude is returned without applying the scale exponent. |
| UUID format | UNIQUEIDENTIFIER is returned as 32 hex chars without byte-order correction or dashes. |
| Unknown token fragility | Any unrecognized token type in a result set will attempt a 2LE-length skip; if the token doesn't follow that pattern, subsequent rows will silently misparse. |

---

## curl Examples

**Pre-Login probe:**

```bash
curl -s -X POST https://portofcall.example.com/api/tds/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"sqlserver.example.com","port":1433}' | jq .
```

**Login check:**

```bash
curl -s -X POST https://portofcall.example.com/api/tds/login \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "sqlserver.example.com",
    "port": 1433,
    "username": "sa",
    "password": "YourPassword"
  }' | jq .
```

**Query with initial database:**

```bash
curl -s -X POST https://portofcall.example.com/api/tds/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "sqlserver.example.com",
    "port": 1433,
    "username": "sa",
    "password": "YourPassword",
    "database": "master",
    "sql": "SELECT name, create_date FROM sys.databases ORDER BY name"
  }' | jq '.rows[] | {name: .[0], created: .[1]}'
```

**Enumerate all databases:**

```bash
curl -s -X POST https://portofcall.example.com/api/tds/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "sqlserver.example.com",
    "username": "sa",
    "password": "YourPassword",
    "sql": "SELECT name, state_desc, recovery_model_desc FROM sys.databases"
  }' | jq -r '.rows[] | @tsv'
```

**List tables in a database:**

```bash
curl -s -X POST https://portofcall.example.com/api/tds/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "sqlserver.example.com",
    "username": "sa",
    "password": "YourPassword",
    "database": "mydb",
    "sql": "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_SCHEMA, TABLE_NAME"
  }' | jq -r '.rows[] | "\(.[0]).\(.[1]) (\(.[2]))"'
```

**Inspect column types (use to predict which columns will be decoded):**

```bash
curl -s -X POST https://portofcall.example.com/api/tds/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "sqlserver.example.com",
    "username": "sa",
    "password": "YourPassword",
    "database": "mydb",
    "sql": "SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '\''MyTable'\'' ORDER BY ORDINAL_POSITION"
  }' | jq -r '.rows[] | @tsv'
```

**Multi-statement batch (use semicolons):**

```bash
curl -s -X POST https://portofcall.example.com/api/tds/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "sqlserver.example.com",
    "username": "sa",
    "password": "YourPassword",
    "sql": "USE mydb; SELECT TOP 10 * FROM dbo.Users ORDER BY id DESC"
  }' | jq '{columns, rows}'
```

> Note: Only the **first** result set in a batch is returned. If `USE mydb` produces a result set, the `SELECT` result may be dropped. Prefer using the `database` field for database selection.
