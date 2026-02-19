# Firebird SQL Database Wire Protocol

**Port:** 3050
**Transport:** TCP
**Implementation:** `src/worker/firebird.ts`
**Routes:** `/api/firebird/probe`, `/api/firebird/version`, `/api/firebird/auth`, `/api/firebird/query`
**Default credentials:** `SYSDBA` / `masterkey`

---

## Overview

Firebird uses a bespoke binary wire protocol descended from the InterBase protocol of the 1980s.
All integers are big-endian (XDR-style). Strings and opaque byte buffers are XDR-encoded:
a 32-bit length prefix followed by the data, padded with zero bytes to the next 4-byte
boundary. There is no framing layer and no native TLS support (stunnel is the conventional
workaround for encrypted Firebird traffic).

Port of Call implements three protocol operations directly in TypeScript with no native
Firebird client library:

| Operation | Opcode sequence |
|-----------|----------------|
| Probe     | op_connect -> op_accept |
| Auth      | op_connect -> op_accept -> op_attach -> op_response |
| Query     | op_connect -> op_attach -> op_transaction -> op_allocate_statement -> op_prepare_statement -> op_execute -> op_fetch |

---
## Protocol Constants

### Opcodes (from Firebird src/remote/protocol.h)

| Constant | Value | Direction | Description |
|----------|-------|-----------|-------------|
| op_connect | 1 | C->S | Initiate connection, offer protocol versions |
| op_accept | 2 | S->C | Server agrees to a protocol version |
| op_reject | 3 | S->C | Server rejects connection outright |
| op_response | 9 | S->C | Generic response to most client ops |
| op_attach | 19 | C->S | Attach to a database with credentials |
| op_detach | 21 | C->S | Detach from database (graceful close) |
| op_transaction | 29 | C->S | Begin a transaction |
| op_commit | 31 | C->S | Commit a transaction |
| op_allocate_statement | 62 | C->S | Allocate a statement handle |
| op_execute | 63 | C->S | Execute a prepared statement |
| op_prepare_statement | 64 | C->S | Prepare a SQL string |
| op_fetch | 65 | C->S | Fetch rows from an executed statement |
| op_fetch_response | 66 | S->C | Server response to op_fetch |

### DPB Item Codes (Database Parameter Block)

| Constant | Value | Meaning |
|----------|-------|---------|
| isc_dpb_version1 | 1 | DPB format version (must be first byte) |
| isc_dpb_user_name | 28 | Username string |
| isc_dpb_password | 29 | Plaintext password |
| isc_dpb_lc_ctype | 48 | Client character set (e.g., UTF8) |

DPB item lengths are single bytes (u8), limiting each value to 255 bytes. Passwords
longer than 255 bytes are silently truncated by the client-side encoding.

Firebird 3.0+ uses SRP (Secure Remote Password) by default. The isc_dpb_password
approach (Legacy_Auth) works on Firebird 1.x/2.x and on Firebird 3.0+ servers
explicitly configured with AuthServer = Legacy_Auth in firebird.conf.

### TPB Item Codes (Transaction Parameter Block)

| Constant | Value | Meaning |
|----------|-------|---------|
| isc_tpb_version3 | 3 | TPB format version |
| isc_tpb_read | 9 | Read-only transaction |
| isc_tpb_concurrency | 5 | SNAPSHOT isolation level |
| isc_tpb_wait | 6 | Wait on lock conflicts (vs. no_wait) |

### Connection Version Constants

| Constant | Value | Meaning |
|----------|-------|---------|
| CONNECT_VERSION3 | 3 | Used with protocol 13+; CONNECT_VERSION2 (2) for protocol 10-12 |
| PROTOCOL_VERSION13 | 13 | Current widely-supported wire protocol version |
| ARCHITECTURE_GENERIC | 1 | arch_generic / XDR encoding (big-endian) |
| PTYPE_RPC | 2 | Remote procedure call connection type |
| PTYPE_LAZY_SEND | 4 | Lazy-send pipelining (protocol 11+) |

---

## Connection Handshake

### op_connect (client -> server)

The client sends a single op_connect packet offering a list of supported protocol
versions. This implementation offers exactly one version (13):

```
Offset  Size  Field                  Value / Notes
------  ----  ---------------------  -----------------------------------------------
0       4     opcode                 0x00000001  (op_connect)
4       4     p_cnct_operation       0x00000013  (op_attach = 19, intended next op)
8       4     p_cnct_cversion        0x00000003  (CONNECT_VERSION3)
12      4     p_cnct_client          0x00000001  (arch_generic)
16      *     p_cnct_file            XDR string  database path
16+n    4     p_cnct_count           0x00000001  (1 protocol version offered)
20+n    *     p_cnct_user_id         XDR opaque  user identification tags
20+n+m  4     p_cnct_version         0x0000000D  (13)
24+n+m  4     p_cnct_architecture    0x00000001  (arch_generic)
28+n+m  4     p_cnct_min_type        0x00000002  (PTYPE_RPC)
32+n+m  4     p_cnct_max_type        0x00000004  (PTYPE_LAZY_SEND)
36+n+m  4     p_cnct_weight          0x00000002  (preference weight)
```

The p_cnct_user_id opaque buffer encodes tag-length-value triples (single-byte tags
and lengths, not XDR u32):

```
[CNCT_user=1][len_byte][username bytes]
[CNCT_host=4][len_byte][hostname bytes]
```

The database path is the absolute filesystem path on the server:
  - Linux/macOS: /opt/firebird/data/employee.fdb
  - Windows:     C:\Firebird\DATA\EMPLOYEE.FDB
Relative paths are resolved relative to the server working directory.
The path is validated only during op_attach, not op_connect.

### op_accept (server -> client)

The server responds with 16 bytes (opcode + 3 fields):

```
Offset  Size  Field                Value / Notes
------  ----  -------------------  ----------------------------------
0       4     opcode               0x00000002  (op_accept)
4       4     p_acpt_version       agreed protocol version (e.g., 13)
8       4     p_acpt_architecture  agreed architecture (1 = generic)
12      4     p_acpt_type          agreed connection type (ptype)
```

If the server rejects the connection it sends op_reject (opcode 3, no body).

---

## Authentication

### op_attach (client -> server)

Immediately after op_accept, the client sends op_attach to open a database attachment.
The wire format is:

```
Offset  Size  Field        Value / Notes
------  ----  -----------  -----------------------------------------------
0       4     opcode       0x00000013  (op_attach = 19)
4       *     p_atch_file  XDR string  absolute path to database file
4+n     *     p_atch_dpb   XDR opaque  Database Parameter Block
```

IMPORTANT: The opcode is immediately followed by the XDR-encoded database path.
There is no intermediate field between the opcode and the path string.
(A previous version of this code had a spurious u32(0) here -- see Bug History.)

### DPB Wire Format

The DPB is a flat byte sequence (not XDR integers -- item lengths are u8):

```
[0x01]                              isc_dpb_version1
[0x1C][len_byte][username bytes]    isc_dpb_user_name (code 28)
[0x1D][len_byte][password bytes]    isc_dpb_password  (code 29)
[0x30][len_byte][charset bytes]     isc_dpb_lc_ctype  (code 48)
```

### op_response for op_attach (server -> client)

```
Offset  Size  Field             Value / Notes
------  ----  ----------------  -----------------------------------------------
0       4     opcode            0x00000009  (op_response)
4       4     p_resp_object     database handle (non-zero on success, 0 on error)
8       8     p_resp_blob_id    blob ID u64 (typically 0 for non-blob ops)
16      4     data_length       length of p_resp_data
20      *     data              response data bytes (+ padding to 4-byte boundary)
var     *     status_vector     ISC status vector (terminated by isc_arg_end=0)
```

A non-zero p_resp_object is the database handle for subsequent ops.
An empty status vector (first u32 == 0) indicates success.

### ISC Status Vector

Variable-length sequence of typed u32 entries:

| Arg type | Value | Followed by |
|----------|-------|-------------|
| isc_arg_end | 0 | nothing -- terminates the vector |
| isc_arg_gds | 1 | u32 ISC error code |
| isc_arg_string | 2 | XDR string -- variable text message |
| isc_arg_number | 4 | u32 numeric argument |
| isc_arg_interpreted | 5 | XDR string -- human-readable error message |
| isc_arg_sql_state | 19 | XDR string -- 5-char SQLSTATE code |

Typical auth failure vector:
```
[isc_arg_gds=1][code=335544424]    isc_login: Your user name and password are not defined
[isc_arg_sql_state=19][28000]    SQLSTATE: Invalid authorization specification
[isc_arg_end=0]
```

---

## Query Execution

Full query execution requires five additional ops after op_attach:

### 1. op_transaction (29)

```
[op_transaction=29 u32][db_handle u32][tpb XDR-opaque]
```
Server responds with op_response; p_resp_object is the transaction handle.

### 2. op_allocate_statement (62)

```
[op_allocate_statement=62 u32][db_handle u32]
```
Server responds with op_response; p_resp_object is the statement handle.

### 3. op_prepare_statement (64)

```
[op_prepare_statement=64 u32]
[tr_handle u32]
[stmt_handle u32]
[sql_dialect u32]          3 = SQL dialect 3 (current standard)
[sql_text XDR-string]
[describe_items XDR-opaque]  empty = no describe request
[buffer_length u32]        max describe response buffer (65535)
```

SQL dialect 3 is required for all modern Firebird features (BIGINT, BOOLEAN,
TIMESTAMP WITH TIME ZONE, double-quoted identifiers). Dialect 1 is the legacy
InterBase compatibility mode.

### 4. op_execute (63)

```
[op_execute=63 u32]
[stmt_handle u32]              NOTE: stmt_handle before tr_handle (reversed vs. prepare)
[tr_handle u32]
[blr_descriptor XDR-opaque]    BLR encoding of input params; empty = no input params
[message_number u32]           0
[message_count u32]            0 = no input message follows
```

The field order stmt_handle/tr_handle in op_execute is the reverse of
op_prepare_statement (tr_handle/stmt_handle). This is intentional in the protocol.

### 5. op_fetch (65)

```
[op_fetch=65 u32]
[stmt_handle u32]
[blr_descriptor XDR-opaque]    BLR output format; empty in this implementation
[message_number u32]           0
[fetch_count u32]              rows to retrieve per call (200 in this implementation)
```

### op_fetch_response (66)

```
[op_fetch_response=66 u32]
[fetch_status u32]    0 = rows follow, 100 = no more rows (EOF), other = error code
[count u32]           number of rows in this response
[row data...]         BLR-described message blocks, one per row
```

With an empty BLR descriptor in op_fetch, the server still returns row data but
its layout is undefined without the BLR. This implementation decodes the raw bytes
as UTF-8 and splits on NUL bytes for a best-effort text extraction.

### Cleanup ops

```
[op_commit=31 u32][tr_handle u32]     commit the transaction
[op_detach=21 u32][db_handle u32]     detach from the database
```

Both generate op_response from the server. This implementation sends them
fire-and-forget (responses are not read).

---

## Response Parsing

### Stream buffering (recvBytes)

TCP is a stream protocol with no guaranteed message boundaries. The implementation
maintains a buf: Uint8Array on the socket object. recvBytes(s, n) accumulates data
from the ReadableStream until n bytes are available, consumes exactly n bytes, and
leaves the remainder in buf for the next call. Accumulated data is merged via:

```typescript
const merged = new Uint8Array(s.buf.length + chunk.length);
merged.set(s.buf);
merged.set(chunk, s.buf.length);
s.buf = merged;
```

The slice operation (s.buf.slice(0, n)) creates a copy with byteOffset = 0,
which is safe. However, other Uint8Array operations like subarray() return views
into the parent buffer with non-zero byteOffset.

### DataView and byteOffset

A Uint8Array view with non-zero byteOffset must be wrapped in a DataView using
the three-argument form:

```typescript
// CORRECT: respects the view offset
new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0)

// WRONG: reads from start of underlying ArrayBuffer, ignoring offset
new DataView(buf.buffer).getUint32(0)
```

This was a bug in three locations (see Bug History). All DataView calls now use
the three-argument form consistently, matching the existing readU32() helper.

### XDR String / Opaque decoding pattern

```typescript
const lenBuf = await recvBytes(s, 4);
const len = readU32(lenBuf, 0);              // correct: uses byteOffset-aware helper
const pad = (4 - (len % 4)) % 4;
const data = await recvBytes(s, len + pad); // read data + padding in one call
const str = decoder.decode(data.subarray(0, len)); // strip padding bytes
```

---

## Endpoints

### POST /api/firebird/probe

Sends op_connect only. No credentials required. Reports whether the server responds
with op_accept and the negotiated protocol version. /api/firebird/version is an alias.

**Request:**
```json
{
  "host": "db.example.com",
  "port": 3050,
  "database": "/tmp/test.fdb"
}
```

**Success:**
```json
{
  "success": true,
  "accepted": true,
  "protocol": 13,
  "architecture": 1,
  "version": "Firebird (protocol 13, arch 1)"
}
```

**Notes:**
- The database path is not validated at this stage. Any path string will elicit
  op_accept if the server is running Firebird.
- Protocol 10 = Firebird 1.5+, 12 = Firebird 2.x, 13 = Firebird 3.0+.
  Protocol 13 in the response confirms the server understands the protocol,
  not necessarily that it is exactly version 3.0.

### POST /api/firebird/auth

Tests credentials via op_connect + op_attach with DPB.

**Request:**
```json
{
  "host": "db.example.com",
  "port": 3050,
  "database": "/var/lib/firebird/data/mydb.fdb",
  "username": "SYSDBA",
  "password": "masterkey"
}
```

**Success:**
```json
{
  "success": true,
  "authenticated": true,
  "dbHandle": 1,
  "protocol": 13,
  "architecture": 1
}
```

**Auth failure:**
```json
{
  "success": false,
  "authenticated": false,
  "protocol": 13,
  "error": "Your user name and password are not defined. Ask your database administrator to set up a Firebird login.; SQLSTATE 28000"
}
```

**Notes:**
- Firebird usernames are case-insensitive (stored uppercase). SYSDBA, sysdba,
  and Sysdba all refer to the same user.
- Firebird 3.0 with WireCrypt = Required rejects plaintext connections before
  op_attach is processed. Use WireCrypt = Enabled (not Required) for compatibility.
- A wrong database path returns an I/O error, not an auth error.

### POST /api/firebird/query

Full pipeline: attach -> transaction -> allocate -> prepare -> execute -> fetch.

**Request:**
```json
{
  "host": "db.example.com",
  "port": 3050,
  "database": "/var/lib/firebird/data/employee.fdb",
  "username": "SYSDBA",
  "password": "masterkey",
  "query": "SELECT RDB$RELATION_NAME FROM RDB$RELATIONS WHERE RDB$SYSTEM_FLAG = 1"
}
```

**Default query:** SELECT RDB$RELATION_NAME FROM RDB$RELATIONS WHERE RDB$SYSTEM_FLAG = 1
(lists Firebird system tables -- always succeeds on any Firebird database)

**Success:**
```json
{
  "success": true,
  "protocol": 13,
  "architecture": 1,
  "query": "SELECT RDB$RELATION_NAME FROM RDB$RELATIONS WHERE RDB$SYSTEM_FLAG = 1",
  "rows": ["RDB$PAGES", "RDB$DATABASE", "RDB$RELATIONS", "..."]
}
```

**Notes:**
- Row data is best-effort: raw fetch bytes are decoded as UTF-8, split on NUL,
  and trimmed. Works for VARCHAR columns; incorrect for numeric, DATE, BLOB.
- Only one op_fetch call is issued (up to 200 rows). Larger result sets are
  silently truncated.
- op_commit and op_detach are sent fire-and-forget; cleanup errors are invisible.

---

## Defaults

| Field | Default |
|-------|---------|
| port | 3050 |
| database | /tmp/test.fdb |
| username | SYSDBA |
| password | masterkey |
| timeout | 8000 ms |
| fetch_count | 200 rows |

---

## Edge Cases

### Wrong database path
op_accept is returned regardless of path. The path is validated only at op_attach.
A non-existent path produces ISC error 335544344 (isc_io_error):
```
I/O error during "open" operation for file "/bad/path.fdb"
Error while trying to open file
```

### Firebird 3.0 SRP authentication
Firebird 3.0 introduced SRP-based wire authentication and optional wire encryption.
With WireCrypt = Required (default in some builds), the server demands op_crypt
(opcode 110) negotiation before accepting op_attach. With AuthServer = Legacy_Auth
disabled, plaintext DPB passwords are rejected regardless of WireCrypt. This
implementation does not handle op_crypt or SRP negotiation. Required server config:
```
# firebird.conf
AuthServer = Legacy_Auth
WireCrypt = Enabled        # not Required
```

### Windows server paths
Firebird on Windows uses backslash paths and may use the server:path format:
```
database = "C:\Firebird\DATA\EMPLOYEE.FDB"   # absolute Windows path
database = "EMPLOYEE"                         # alias from databases.conf
```
The wire protocol is identical; only the path string differs.

### Aliases (databases.conf)
Firebird 3.0+ supports aliases in databases.conf. The alias name is valid in
p_cnct_file and p_atch_file, e.g., database = "employee" resolves server-side.

### TCP read timeout
The default 8-second timeout applies per recvBytes call. A slow or overloaded
server may require a larger timeout. There is no per-operation timeout override;
the same 8s limit applies to every individual packet read in the pipeline.

### Embedded Firebird
Firebird Embedded does not listen on any TCP port. If port 3050 is open it is
a Classic Server or SuperServer process, not Embedded.

### isc_arg_interpreted vs isc_arg_string
Both arg types 2 and 5 are XDR strings. Type 5 (isc_arg_interpreted) carries
pre-formatted human-readable error text. The implementation collects both into
the statusError field, prefixing SQLSTATE strings (type 19) with "SQLSTATE ".

---

## Bug History

### Bug 1 (CRITICAL) -- Spurious u32(0) in buildAttachPacket -- fixed 2026-02-18

**Symptom:** Every op_attach was silently rejected by the server. handleFirebirdAuth
and handleFirebirdQuery always returned an error or hung waiting for a response.

**Root cause:** buildAttachPacket inserted a u32(0) between the opcode and the
database path string:

```typescript
// BEFORE (wrong):
const parts = [
  ...u32BE(OP_ATTACH),
  ...u32BE(0),               // spurious -- no such field in P_ATCH
  ...xdrString(database),
  ...xdrOpaque(dpb),
];

// AFTER (correct):
const parts = [
  ...u32BE(OP_ATTACH),
  ...xdrString(database),    // directly follows opcode
  ...xdrOpaque(dpb),
];
```

The P_ATCH struct in Firebird src/remote/protocol.h has no such field:
```
// Actual P_ATCH layout:
//   opcode (u32)
//   p_atch_file (xdr_string) -- database path
//   p_atch_dpb  (xdr_opaque) -- DPB
```

The spurious 4 bytes caused the server to read the XDR length prefix of the
database path as the path string itself, then completely misparse the DPB.
The server responded with a protocol framing error and closed the connection.

**Fix:** Removed the ...u32BE(0) line. Updated doc comment to reflect correct layout.

### Bug 2 (HIGH) -- DataView missing byteOffset -- fixed 2026-02-18

**Symptom:** Intermittent incorrect opcode values, op_accept version parsing
returning garbage when TCP data arrived in specific chunk patterns.

**Root cause:** Three locations used new DataView(x.buffer) without byteOffset:

1. recvPacket -- opcode reading:
```typescript
// BEFORE (wrong when byteOffset > 0):
const opcode = new DataView(opcodeBytes.buffer).getUint32(0);
// AFTER (correct):
const opcode = new DataView(opcodeBytes.buffer, opcodeBytes.byteOffset, opcodeBytes.byteLength).getUint32(0);
```

2. recvPacket -- op_fetch_response status:
```typescript
// BEFORE: const fetchStatus = new DataView(body.buffer).getUint32(0);
// AFTER:  const fetchStatus = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0);
```

3. connectAndAccept -- op_accept fields:
```typescript
// BEFORE: const dv = new DataView(resp.data.buffer);
// AFTER:  const dv = new DataView(resp.data.buffer, resp.data.byteOffset, resp.data.byteLength);
```

While Uint8Array.slice() (used in recvBytes) produces a copy with byteOffset=0,
making these bugs latent rather than always-triggered, using the three-argument
form is required for correctness and matches the existing readU32() helper pattern.

**Fix:** All DataView construction now uses the three-argument form.

---

## Known Limitations

1. **No SRP / Firebird 3.0+ auth.** Firebird 3.0 default config requires SRP wire
   auth. This implementation only handles Legacy_Auth (plaintext DPB password).
   Required server-side: AuthServer = Legacy_Auth in firebird.conf.

2. **No wire encryption.** Firebird 3.0+ supports ChaCha20/ARC4 via op_crypt (110).
   This implementation communicates in plaintext only. Firebird servers with
   WireCrypt = Required will reject the connection entirely.

3. **BLR-less fetch -- best-effort row parsing.** op_fetch sends an empty BLR
   descriptor. Without a proper BLR, row data cannot be precisely decoded.
   Only VARCHAR/CHAR columns return useful text; numeric, DATE, TIMESTAMP,
   BLOB, and ARRAY columns produce garbage or nothing.

4. **Single fetch page (200-row limit).** Only one op_fetch is issued. Queries
   returning more than 200 rows are silently truncated at 200.

5. **Fire-and-forget cleanup.** op_commit and op_detach responses are not read.
   Server errors during cleanup are invisible to the caller.

6. **No connection pooling.** Each API call opens and tears down a full TCP+auth
   session. Server-side attachment limits apply for high-frequency probing.

7. **No BLOB, array, procedure, or event support.** BLOB segment ops (op_get_segment,
   op_put_segment), stored procedure I/O (op_execute2), and database events
   (op_que_events) are not implemented.

8. **Fixed protocol version 13 only.** Only protocol 13 is offered in op_connect.
   In practice all Firebird servers that run version 3.0+ accept protocol 13.

9. **No Cloudflare bypass.** Cloudflare-proxied hosts are blocked at HTTP 403
   before any TCP connection is attempted.

10. **No service manager API.** Firebird's isc_service_attach / isc_service_start
    operations (server management, backup/restore, user administration) are not
    implemented. Port 3050 only; the Services Manager uses the same port but
    different attach semantics.

---

## Wire Exchange Examples

### Successful probe (op_connect -> op_accept)

```
Client -> Server:
  00 00 00 01  op_connect
  00 00 00 13  intended op: op_attach
  00 00 00 03  CONNECT_VERSION3
  00 00 00 01  arch_generic
  00 00 00 0f  XDR string len=15 "/tmp/test.fdb"
  2f 74 6d 70  "/tmp"
  2f 74 65 73  "/tes"
  74 2e 66 64  "t.fd"
  62 00 00 00  "b" + 3-byte pad
  00 00 00 01  p_cnct_count = 1
  00 00 00 14  XDR opaque len=20 (user_id: CNCT_user + CNCT_host)
  01 0a ...    CNCT_user=1, len=10, "portofcall"
  04 0a ...    CNCT_host=4, len=10, "portofcall"
  00 00 00 0d  protocol version = 13
  00 00 00 01  architecture = 1
  00 00 00 02  min_type = PTYPE_RPC
  00 00 00 04  max_type = PTYPE_LAZY_SEND
  00 00 00 02  weight = 2

Server -> Client:
  00 00 00 02  op_accept
  00 00 00 0d  agreed version = 13
  00 00 00 01  agreed architecture = 1
  00 00 00 04  agreed type = PTYPE_LAZY_SEND
```

### Auth failure (bad password)

```
Client -> Server (after op_accept):
  00 00 00 13  op_attach
  00 00 00 0f  XDR string len=15 "/tmp/test.fdb"
  2f 74 6d 70 2f 74 65 73 74 2e 66 64 62 00 00 00
  00 00 00 xx  XDR opaque len=N (DPB bytes)
  01 1c 06 53 59 44 42 41  ver1 user_name SYSDBA
  1d 09 62 61 64 70 61 73  pass "badpas"
  73 77 64 30 04 55 54 46  "swd" lc_ctype UTF
  38 ...                   "8" + padding

Server -> Client:
  00 00 00 09  op_response
  00 00 00 00  handle = 0 (failure)
  00 00 00 00 00 00 00 00  blob_id = 0
  00 00 00 00  data_length = 0
  00 00 00 01  isc_arg_gds
  14 00 04 18  ISC error code (isc_login = 335544344 or similar)
  00 00 00 13  isc_arg_sql_state
  00 00 00 05  string len=5
  32 38 30 30 30  "28000" + padding
  00 00 00 00  isc_arg_end
```

---

## Quick Reference

```bash
# Probe -- check if Firebird is running (no credentials needed)
curl -s -X POST https://portofcall.example.com/api/firebird/probe \
  -H "Content-Type: application/json" \
  -d '{"host":"db.example.com","database":"/data/mydb.fdb"}'

# Auth -- test credentials
curl -s -X POST https://portofcall.example.com/api/firebird/auth \
  -H "Content-Type: application/json" \
  -d '{"host":"db.example.com","database":"/data/mydb.fdb","username":"SYSDBA","password":"masterkey"}'

# Query -- run SQL and extract rows
curl -s -X POST https://portofcall.example.com/api/firebird/query \
  -H "Content-Type: application/json" \
  -d '{"host":"db.example.com","database":"/data/employee.fdb","username":"SYSDBA","password":"masterkey","query":"SELECT RDB$RELATION_NAME FROM RDB$RELATIONS WHERE RDB$SYSTEM_FLAG=0"}'
```

---

## References

- Firebird source tree: src/remote/protocol.h -- P_CNCT, P_ATCH, P_RESP, P_SQLDATA, P_SQLST structs
- Firebird source tree: src/jrd/ibase.h -- DPB/TPB item codes, ISC error codes, isc_arg_* types
- Firebird 3.0 release notes and migration guide -- wire auth changes (SRP, op_crypt, WireCrypt)
- RFC 1832 -- External Data Representation (XDR) standard (big-endian, 4-byte alignment)
- Firebird documentation: Firebird 3.0 Language Reference, Chapter 6 (SQL Dialects)
