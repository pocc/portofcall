# Sybase ASE (TDS 5.0) — Power User Reference

Port of Call implements Sybase Adaptive Server Enterprise (ASE) connectivity via the **TDS 5.0** (Tabular Data Stream) binary protocol over raw TCP using `cloudflare:sockets`.

Default port: **5000**

Implementation: `src/worker/sybase.ts`

---

## Protocol Overview

Sybase ASE uses the Tabular Data Stream (TDS) protocol — the same wire protocol that Microsoft later adopted for SQL Server, but Sybase's own version (TDS 5.0) diverges significantly from Microsoft's TDS 7.x. Key differences:

| Aspect | Sybase TDS 5.0 | Microsoft TDS 7.x |
|--------|----------------|-------------------|
| Login packet type | 0x02 (fixed 512-byte body) | 0x10 (Login7, variable-length UTF-16LE) |
| Pre-Login | Optional; type 0x12 | Mandatory; type 0x12 |
| String encoding | ASCII (fixed-width fields) | UTF-16LE (variable-width) |
| Password obfuscation | XOR each byte with 0xA5 | XOR with 0xA5, then nibble-swap |
| Integer byte order | Little-endian | Little-endian |
| Token lengths | 2-byte little-endian | 2-byte little-endian |
| Default port | 5000 | 1433 |
| Auth | Username/password only | SQL auth + Windows (NTLM/Kerberos) |

> For Microsoft SQL Server connectivity, see `src/worker/tds.ts` and `docs/protocols/TDS.md`.

---

## TDS Packet Header (8 bytes)

Every TDS packet — client and server — begins with an 8-byte header:

```
Offset  Size  Field         Notes
0       1     Type          Packet type (see below)
1       1     Status        Bit 0 = EOM (final packet in message); 0x01 = normal
2       2     Length        Total packet length including this header, big-endian
4       2     SPID          Server process ID; 0 from client
6       1     PacketID      Rolling 1-based sequence number
7       1     Window        Always 0
```

The TDS header length field is **big-endian**, unlike TDS 5.0 token stream lengths which are **little-endian**.

### Packet Types Used

| Type | Hex | Direction | Description |
|------|-----|-----------|-------------|
| SQL_BATCH | 0x01 | Client->Server | SQL language request (query/stored proc via EXECUTE) |
| LOGIN | 0x02 | Client->Server | TDS 5.0 login record (512-byte fixed body) |
| RESPONSE | 0x04 | Server->Client | Tabular result / token stream |
| PRELOGIN | 0x12 | Both | Pre-login negotiation (optional for Sybase ASE) |

---

## Endpoint 1 — Pre-Login Probe

```
POST /api/sybase/probe
Content-Type: application/json
```

**Request:**

```json
{
  "host": "sybase.example.com",
  "port": 5000,
  "timeout": 15000
}
```

| Field   | Type   | Required | Default | Notes |
|---------|--------|----------|---------|-------|
| host    | string | yes      | —       | Hostname or IP |
| port    | number | no       | 5000    | |
| timeout | number | no       | 15000   | Milliseconds |

**What happens:**

1. Opens a TCP socket to `host:port`
2. Sends a TDS Pre-Login packet (type 0x12) with VERSION and ENCRYPTION options
3. Reads the first TDS response packet header + payload (single-packet only)
4. Identifies the server by checking the response packet type

**Pre-Login packet sent (payload, 18 bytes after 8-byte header):**

```
Option table (11 bytes):
  [0x00][0x00][0x0B][0x00][0x06]  VERSION at offset 11, length 6
  [0x01][0x00][0x11][0x00][0x01]  ENCRYPTION at offset 17, length 1
  [0xFF]                           Terminator

Data section (7 bytes):
  [0x09][0x00][0x00][0x00][0x00][0x00]  VERSION: 9.0.0.0 (Sybase ASE 15.x)
  [0x00]                                 ENCRYPTION: ENCRYPT_OFF
```

> ENCRYPTION=0x00 (off) is always sent. TLS is never negotiated; servers requiring SSL/TLS will reject the connection.

**Successful response:**

```json
{
  "success": true,
  "host": "sybase.example.com",
  "port": 5000,
  "packetType": 4,
  "packetTypeName": "Response",
  "status": 1,
  "length": 84,
  "isSybase": true,
  "rtt": 12
}
```

| Field          | Notes |
|----------------|-------|
| packetType     | Raw TDS packet type byte from response |
| packetTypeName | Human-readable label for packet type |
| status         | TDS Status byte from response header (1=EOM) |
| length         | Total packet length including header |
| isSybase       | `true` if response type is 0x04 (Tabular Result — the definitive Sybase response type) |
| rtt            | Round-trip time in ms from socket open to first response byte |

> `isSybase=true` indicates a TDS-speaking server responded. Sybase ASE responds to Pre-Login with a Tabular Result packet (type 0x04). A `false` value means the server sent an unexpected packet type.

---

## Endpoint 2 — Login (Auth Check)

```
POST /api/sybase/login
Content-Type: application/json
```

**Request:**

```json
{
  "host": "sybase.example.com",
  "port": 5000,
  "username": "sa",
  "password": "your-password",
  "database": "master",
  "timeout": 15000
}
```

| Field    | Type   | Required | Default | Notes |
|----------|--------|----------|---------|-------|
| host     | string | yes      | —       | |
| port     | number | no       | 5000    | |
| username | string | yes      | —       | SQL login name (max 30 chars, truncated) |
| password | string | yes      | —       | Plaintext; obfuscated on wire (max 30 chars, truncated) |
| database | string | no       | master  | Not used in TDS 5.0 login packet — USE is required separately |
| timeout  | number | no       | 15000   | Milliseconds |

**What happens:**

1. Opens TCP socket
2. Sends TDS 5.0 Login packet (type 0x02)
3. Reads up to 5 response packets, accumulating the token stream
4. Returns whether LOGINACK was received with interface byte = 5

**TDS 5.0 Login packet internals (type 0x02, 520 bytes total: 8-byte header + 512-byte body):**

```
Body layout (space-padded with 0x20):
  Offset   Size  Field
  0        30    hostname (space-padded)
  30       1     hostnameLen
  31       30    username (space-padded)
  61       1     usernameLen
  62       30    password (XOR 0xA5 obfuscated, space-padded)
  92       1     passwordLen
  93       30    hostprocess (space-padded, "1")
  123      1     hostprocessLen
  124      9     bulk copy flags (int2type, int4type, float types, datetime, money, capability)
  133      30    appname ("portofcall", space-padded)
  163      1     appnameLen
  164      30    servername (hostname, space-padded)
  194      1     servernameLen
  195      256   remotepwd (unused, zero-filled)
  451      4     tds_version: [0x05, 0x00, 0x00, 0x00] = TDS 5.0
  455      10    progname ("portofcall", space-padded)
  465      1     prognameLen
  466      4     progversion: [0x01, 0x00, 0x00, 0x00]
  470      3     noshort, flt4type, date4type
  473      30    language ("us_english", space-padded)
  503      1     languageLen
  504      1     notchangelanguage (0x01)
  505      30    charset ("iso_1", space-padded)
  535      1     charsetLen
  536      1     charconvert (0x00)
  537      6     packetsize ("512   ", space-padded)
  543      8     dummy (zero-filled)
```

**Password obfuscation (TDS 5.0 Sybase):**

Each byte of the ASCII password is XOR'd with `0xA5` before writing into the 30-byte password field. This is reversible wire encoding — not encryption. The space padding bytes (0x20) for unused positions are NOT obfuscated.

```
wire_byte[i] = password_ascii[i] ^ 0xA5
```

Note: This differs from Microsoft TDS 7.x which additionally nibble-swaps after XOR.

**Successful response:**

```json
{
  "success": true,
  "host": "sybase.example.com",
  "port": 5000,
  "rtt": 23,
  "loginAccepted": true,
  "serverName": "SYBASE01",
  "tdsVersion": "5.0",
  "errors": [],
  "message": "Login succeeded for user 'sa'"
}
```

**Failed response (bad credentials):**

```json
{
  "success": false,
  "host": "sybase.example.com",
  "port": 5000,
  "rtt": 18,
  "loginAccepted": false,
  "serverName": null,
  "tdsVersion": null,
  "errors": ["Login failed for user 'sa'."],
  "message": "Login failed: Login failed for user 'sa'."
}
```

---

## Endpoint 3 — Query

```
POST /api/sybase/query
Content-Type: application/json
```

**Request:**

```json
{
  "host": "sybase.example.com",
  "port": 5000,
  "username": "sa",
  "password": "your-password",
  "database": "master",
  "query": "SELECT @@version",
  "timeout": 20000
}
```

| Field    | Type   | Required | Default          | Notes |
|----------|--------|----------|------------------|-------|
| host     | string | yes      | —                | |
| port     | number | no       | 5000             | |
| username | string | yes      | —                | |
| password | string | yes      | —                | |
| database | string | no       | master           | Prepended as `USE {database}\n` before the query |
| query    | string | no       | SELECT @@version | Sybase T-SQL (ASE dialect) |
| timeout  | number | no       | 20000            | Milliseconds |

**What happens:**

1. Opens TCP socket
2. Sends TDS 5.0 Login packet (type 0x02)
3. Reads login response token stream (up to 5 packets)
4. If login succeeds, sends SQL as a TDS SQL_BATCH packet (type 0x01, ASCII-encoded)
5. Reads query response token stream (up to 10 packets)
6. Returns column names, row count, errors, and raw hex of first 256 bytes

**Query packet (SQL_BATCH, type 0x01):**

The SQL text is ASCII-encoded and sent directly as the packet payload. If `database` is specified and not `master`, the query is prefixed with `USE {database}\n`.

```
Packet header:
  [0x01][0x01][len_hi][len_lo][0x00][0x00][0x01][0x00]

Payload:
  ASCII bytes of the SQL string
```

**Successful response:**

```json
{
  "success": true,
  "host": "sybase.example.com",
  "port": 5000,
  "rtt": 45,
  "loginAck": true,
  "serverName": "SYBASE01",
  "query": "SELECT @@version",
  "columnNames": [""],
  "rowCount": 1,
  "errors": [],
  "rawPayloadHex": "ad 0b 00 05 05 00 00 00 ...",
  "message": "Query executed. Columns: , rows: 1"
}
```

| Field         | Notes |
|---------------|-------|
| columnNames   | Array of column name strings from COLNAME (0xA5) token |
| rowCount      | Count of ROW (0xD1) tokens seen; row data is not decoded |
| rawPayloadHex | First 256 bytes of query response payload as space-separated hex |
| errors        | Array of error message strings from ERROR (0xAA) tokens |

> **Row data is not decoded.** When a ROW token (0xD1) is encountered, the parser stops consuming the stream and records a placeholder `['<row>']`. Full row decoding requires parsing the preceding COLFMT (0xA7) token for type descriptors, which is not implemented.

---

## Endpoint 4 — Stored Procedure

```
POST /api/sybase/proc
Content-Type: application/json
```

**Request:**

```json
{
  "host": "sybase.example.com",
  "port": 5000,
  "username": "sa",
  "password": "your-password",
  "database": "master",
  "procname": "sp_helpdb",
  "params": ["master"],
  "timeout": 20000
}
```

| Field    | Type                      | Required | Default | Notes |
|----------|---------------------------|----------|---------|-------|
| host     | string                    | yes      | —       | |
| port     | number                    | no       | 5000    | |
| username | string                    | yes      | —       | |
| password | string                    | yes      | —       | |
| database | string                    | no       | master  | |
| procname | string                    | yes      | —       | Stored procedure name |
| params   | (string|number|null)[]    | no       | []      | Parameter values |
| timeout  | number                    | no       | 20000   | |

**What happens:**

Builds and sends the SQL statement `EXECUTE {procname} {params...}` as a TDS SQL_BATCH (type 0x01). Stored procedures are invoked via the language packet, not TDS RPC packets (type 0x03).

**Parameter formatting:**

| Input type | Wire format |
|------------|-------------|
| `null`     | `NULL` |
| `number`   | bare integer/float string |
| `string`   | `'value'` with internal `'` escaped as `''` |

**Example generated SQL:**

```sql
EXECUTE sp_helpdb 'master'
EXECUTE sp_lock 1, NULL
EXECUTE my_proc 'O''Brien', 42
```

---

## TDS 5.0 Token Stream Reference

Tokens appear in the response payload after the 8-byte TDS packet header.

| Token     | Hex  | Body structure | Handled by parser |
|-----------|------|----------------|-------------------|
| COLNAME   | 0xA5 | length[2LE] + (nameLen[1] + name[nameLen])* | Yes — extracts column names |
| COLFMT    | 0xA7 | length[2LE] + column format info | Skip only (length consumed, not parsed) |
| LOGINACK  | 0xAD | length[2LE] + ackType[1] + tdsVer[4] + nameLen[1] + name[nameLen] | Yes — sets loginAck flag |
| ROW       | 0xD1 | variable (type-dependent per COLFMT) | Counted only, not decoded |
| ENVCHANGE | 0xE3 | length[2LE] + type[1] + newLen[1] + newVal + oldLen[1] + oldVal | Skip only |
| ERROR     | 0xAA | length[2LE] + msgNum[4] + state[1] + sev[1] + msgLen[2LE] + msg | Yes — extracts message text |
| DONE      | 0xFD | status[2LE] + curCmd[2LE] + rowCount[4LE] | Yes — captures status, ends loop |
| Unknown   | —    | — | Stop parsing (break out of loop) |

**All token length fields are 2-byte little-endian.** The TDS packet header length (bytes 2-3) is big-endian, but all token body sizes within the payload are little-endian.

### LOGINACK Token Detail

```
Offset  Size  Field
0       2     tokenLen (2LE) — total body size after this field
2       1     ackType — 5 = TDS 5.0 interface (login success); other = failure
3       4     tdsVersion — [major, minor, 0, 0]
7       1     serverNameLen
8       N     serverName — ASCII string
```

### ERROR Token Detail (0xAA)

```
Offset  Size  Field
0       2     tokenLen (2LE)
2       4     msgNumber
6       1     state
7       1     severity
8       2     msgLen (2LE) — byte length of message text
10      N     message — ASCII text
...           server name, proc name, etc. up to tokenLen
```

---

## Wire Exchange Diagrams

### Probe (no credentials)

```
Client                           Sybase ASE
  |                                  |
  |-- TCP SYN ---------------------->|
  |<- TCP SYN-ACK -------------------|
  |-- TCP ACK ---------------------->|
  |-- PRELOGIN (0x12, 26B payload) ->|  VERSION + ENCRYPTION=OFF
  |<- RESPONSE (0x04, N bytes) ------|  Token stream
  |-- TCP FIN ---------------------->|
```

### Login + Query

```
Client                           Sybase ASE
  |                                  |
  |-- TCP connect ------------------>|
  |-- LOGIN (0x02, 520B) ----------->|  Fixed TDS 5.0 login record
  |<- RESPONSE (0x04) --------------|  LOGINACK + ENVCHANGE + DONE
  |-- SQL_BATCH (0x01) ------------>|  ASCII SQL text
  |<- RESPONSE (0x04) --------------|  COLNAME + COLFMT + ROW... + DONE
  |-- TCP FIN ---------------------->|
```

---

## Known Limitations

| Limitation | Detail |
|------------|--------|
| No TLS | ENCRYPT_OFF always sent. Servers requiring SSL will reject the connection. |
| No Windows auth | Only SQL username/password. No NTLM or Kerberos. |
| Row data not decoded | ROW (0xD1) tokens are counted but not parsed. Use `rawPayloadHex` for manual inspection. |
| 30-character truncation | username, password, hostname, servername are silently truncated to 30 characters in the login packet. |
| No database in login | The TDS 5.0 login packet has no database field. `database` parameter causes `USE {db}\n` prepended to query SQL only — no effect on the login-only endpoint. |
| No capability negotiation | The capability field in the login packet is set to zeros. Wide datatypes and large identifiers may require capability bits. |
| Single-read probe | The probe reads only one TDS response packet. Multi-packet Pre-Login responses are truncated (very rare in practice). |
| Unknown tokens halt parsing | Unrecognized token types cause the parser to break out of the loop rather than skip. |
| No attention signal | Query cancellation (type 0x05) not implemented. |
| No RPC packets | Stored procs via EXECUTE language SQL only, not TDS RPC (type 0x03). Output parameters are inaccessible. |
| Sybase ASE only | This implementation uses TDS 5.0. Use `src/worker/tds.ts` for Microsoft SQL Server. |

---

## curl Examples

**Probe (detect Sybase server):**

```bash
curl -s -X POST https://portofcall.example.com/api/sybase/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"sybase.example.com","port":5000}' | jq .
```

**Login check:**

```bash
curl -s -X POST https://portofcall.example.com/api/sybase/login \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "sybase.example.com",
    "username": "sa",
    "password": "your-password"
  }' | jq '{loginAccepted, serverName, tdsVersion, errors}'
```

**Query: Sybase version:**

```bash
curl -s -X POST https://portofcall.example.com/api/sybase/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "sybase.example.com",
    "username": "sa",
    "password": "your-password",
    "query": "SELECT @@version"
  }' | jq '{columnNames, rowCount, rawPayloadHex}'
```

**Query: list databases:**

```bash
curl -s -X POST https://portofcall.example.com/api/sybase/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "sybase.example.com",
    "username": "sa",
    "password": "your-password",
    "query": "SELECT name FROM sysdatabases ORDER BY name"
  }' | jq .
```

**Stored procedure — sp_helpdb:**

```bash
curl -s -X POST https://portofcall.example.com/api/sybase/proc \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "sybase.example.com",
    "username": "sa",
    "password": "your-password",
    "procname": "sp_helpdb",
    "params": ["master"]
  }' | jq '{success, rowCount, errors}'
```

**Decode raw hex response manually:**

```bash
curl -s -X POST https://portofcall.example.com/api/sybase/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"sybase.example.com","username":"sa","password":"pw","query":"SELECT 1"}' \
| jq -r '.rawPayloadHex' \
| tr ' ' '\n' | paste - - - - - - - - - - - - - - - - | nl
```

---

## Debugging Raw Responses

The `rawPayloadHex` field contains the first 256 bytes of the accumulated query response payload as space-separated hex. Token stream starts at byte 0 of this field (TDS packet headers have already been stripped).

**Token type bytes to watch for:**

```
0xA5 = COLNAME       followed by 2LE length, then (1B nameLen + ASCII name)*
0xA7 = COLFMT        followed by 2LE length, then column format data
0xAA = ERROR         followed by 2LE length, msgNum[4], state[1], sev[1], msgLen[2LE], msg
0xAD = LOGINACK      followed by 2LE length, ackType[1], tdsVer[4], nameLen[1], name
0xD1 = ROW           variable length; cannot skip without COLFMT data
0xE3 = ENVCHANGE     followed by 2LE length
0xFD = DONE          8 bytes: status[2LE] + curCmd[2LE] + rowCount[4LE]
```

**Example: identifying end of response (DONE token):**

```
... fd 00 00 00 00 00 00 00 00
     ^  ^^^^  ^^^^  ^^^^^^^^
     FD  status  curCmd  rowCount(LE)
     
status=0x0000 = normal completion
status=0x0020 = error occurred  
status=0x0010 = more results follow
```

---

## References

- FreeTDS TDS Protocol Documentation: http://www.freetds.org/tds.html
- FreeTDS source (`src/tds/login.c`) for TDS 5.0 login packet layout reference
- Sybase ASE 15.x System Administration Guide (login, charset, language settings)
- Sybase ASE system tables: `sysdatabases`, `systables`, `syscolumns`, `syslogins`
