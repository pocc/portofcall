# Informix SQLI Protocol — Power-User Reference

## Overview

IBM Informix Dynamic Server (IDS) uses the **SQLI** (SQL Interface) wire protocol
for client-server communication. SQLI is a proprietary binary protocol that
predates DRDA; modern Informix also supports DRDA on a separate port (typically
50000 for Informix DRDA), but native clients (dbaccess, ESQL/C, Informix JDBC
type-4) speak SQLI.

SQLI is **not standardized**. This documentation is reverse-engineered from
packet captures, JDBC driver traces, and observed server behavior.

---

## Well-Known Ports

| Port | Service       | Description                                    |
|------|---------------|------------------------------------------------|
| 9088 | onsoctcp      | Standard TCP listener (SQLI protocol)          |
| 9089 | onsoctcp_ssl  | TLS-wrapped SQLI                               |
| 1526 | sqlexec       | Legacy listener (Informix < 7.x, rarely used)  |
| 50000| DRDA          | Informix DRDA listener (IBM DB2-compatible)    |

**Default:** Port 9088 (onsoctcp)

---

## Wire Format

Every SQLI message is framed as:

```
[4 bytes: payload length, big-endian][payload]
```

- **Length field**: 32-bit unsigned integer (big-endian), **excludes** the 4-byte
  header itself (i.e., length of payload only).
- **Payload**: Variable-length binary data. The first message from the client is
  a connection string; subsequent messages are command/response packets.

### Example

```
00 00 00 2A    <- 42 bytes of payload follow
[42 bytes of data]
```

---

## Connection Flow (SQLI over onsoctcp)

1. **TCP connect** to the onsoctcp listener (default port 9088)
2. **Client → Server**: Connection parameters (4-byte length-prefixed, null-delimited key-value pairs)
3. **Server → Client**: Server identification / challenge (banner + protocol version)
4. **Client → Server**: Authentication response (password or challenge-response, 4-byte length-prefixed)
5. **Server → Client**: Authentication result
   - **SQ_EOT** (0x00) on success
   - **SQ_ERR** (0x02) on failure
6. **Client → Server**: SQ_PREPARE / SQ_EXECUTE / SQ_COMMAND / etc.
7. **Server → Client**: SQ_DESCRIBE (column metadata), SQ_DATA (row data), SQ_EOT

---

## Layer 1 — Connection Packet

The SQLI handshake begins with a length-prefixed block of **null-terminated
key-value fields**. The server uses these to:

- Identify the client application
- Locate the requested database
- Determine the protocol level

### Field Order (Observed from JDBC driver traces)

```
"ol_<servername>\0"      — Service name hint (can be blank)
"<username>\0"           — OS/database user
"<password_placeholder>\0" — Placeholder (actual auth is a later exchange)
"<database>\0"           — Database name (e.g. "sysmaster")
"SQLI\0"                 — Protocol identifier (literal string)
"7.31\0"                 — Protocol version (client-advertised)
"<client_app>\0"         — Client application name (e.g. "portofcall")
```

The entire payload is prefixed by a 4-byte big-endian length (of just the
payload, not including the 4-byte length field itself).

### Example Connection Packet

```
Offset  Hex                                       ASCII / Description
  0     00 00 00 50                               Length = 80 bytes
  4     6F 6C 5F 70 6F 72 74 6F 66 63 61 6C 6C   "ol_portofcall\0"
        00
 18     70 72 6F 62 65 00                         "probe\0"         (username)
 24     00                                         "\0"             (password placeholder)
 25     73 79 73 6D 61 73 74 65 72 00             "sysmaster\0"     (database)
 35     53 51 4C 49 00                             "SQLI\0"
 40     37 2E 33 31 00                             "7.31\0"
 45     70 6F 72 74 6F 66 63 61 6C 6C 00         "portofcall\0"
```

---

## Layer 2 — Protocol Version Negotiation (SQ_PROTOCOLS)

During the initial handshake the client advertises its supported SQLI protocol
version (e.g. "SQLI 7.31") and the server responds with the version it will use.

The protocol version controls:

- Available message types
- Data-type encodings
- Features like scrollable cursors, large objects, and Unicode support

### Common Protocol Versions

| Version | Era       | Key Features                                      |
|---------|-----------|---------------------------------------------------|
| 6.0     | ~1996     | Basic SQLI, no Unicode                            |
| 7.0     | ~2000     | Scrollable cursors, BLOB/CLOB support             |
| 7.31    | ~2005     | UTF-8 support, stored procedures                  |
| 9.x     | ~2010+    | Enhanced large object streaming                   |

**Recommendation:** Use 7.31 for maximum compatibility with Informix 11.x and later.

---

## Layer 3 — Authentication Packet

After the server responds to the connection string, the client sends the actual
password in a 4-byte length-prefixed frame.

For **native** (non-PAM, non-challenge-response) auth, this is simply:

```
[4 bytes: length][password][0x00]
```

### Example

Password: `mypassword`

```
00 00 00 0B             <- Length = 11 bytes
6D 79 70 61 73 73 77 6F  <- "mypassword\0"
72 64 00
```

### Authentication Methods

Informix supports multiple authentication mechanisms:

| SECMEC | Name                          | Notes                                    |
|--------|-------------------------------|------------------------------------------|
| 0      | None (trust-based)            | Server-side configuration only           |
| 1      | Cleartext password            | Default for local connections            |
| 3      | Challenge-response (DES)      | Deprecated, rarely used                  |
| 7      | PAM                           | Unix PAM integration                     |
| 9      | GSSAPI (Kerberos)             | Enterprise deployments                   |

**This implementation uses SECMEC 1** (cleartext password over TCP). For
production use over untrusted networks, use TLS (port 9089) or DRDA with SECMEC 7.

---

## Layer 4 — Command Packet

SQLI command messages (SQ_COMMAND / SQ_PREPARE) carry a **2-byte command type**
after the 4-byte length prefix, followed by the SQL text (null-terminated).

```
[4 bytes: payload length][2 bytes: command type][SQL text][0x00]
```

### Command Type Codes

| Code | Constant   | Description                                     |
|------|------------|-------------------------------------------------|
| 0x01 | SQ_COMMAND | Immediate execution ("direct" statement)        |
| 0x02 | SQ_PREPARE | Prepare a statement (returns a statement ID)    |
| 0x03 | SQ_EXECUTE | Execute a prepared statement (by statement ID)  |
| 0x04 | SQ_DESCRIBE| Describe columns (metadata request)             |
| 0x05 | SQ_FETCH   | Fetch next row from cursor                      |
| 0x06 | SQ_CLOSE   | Close cursor / free statement                   |
| 0x07 | SQ_INFO    | Get session/server info                         |

### Example SQ_COMMAND

SQL: `SELECT tabname FROM systables WHERE tabid < 10`

```
Offset  Hex                                       Description
  0     00 00 00 31                               Length = 49 bytes
  4     00 01                                     SQ_COMMAND
  6     53 45 4C 45 43 54 20 74 61 62 6E 61 6D   "SELECT tabname FROM"
        65 20 46 52 4F 4D 20 73 79 73 74 61 62
        6C 65 73 20 57 48 45 52 45 20 74 61 62
        69 64 20 3C 20 31 30 00                   " systables WHERE tabid < 10\0"
```

---

## Layer 5 — Response Messages

The server responds to commands with a sequence of messages:

1. **SQ_DESCRIBE** (0x04): Column metadata (FDOCA descriptors)
2. **SQ_DATA** (0x03): Row data (binary-encoded, one message per row)
3. **SQ_EOT** (0x00): End of transaction / success
4. **SQ_ERR** (0x02): Error (includes error code + message)

### Message Type Byte

After the 4-byte length header, the first byte of the payload indicates the
message type:

```
[4 bytes: length][1 byte: message type][payload]
```

### SQ_DESCRIBE Structure (Simplified)

SQLI uses **FDOCA** (Formatted Data Object Content Architecture) to encode
column descriptors. A full FDOCA parser is beyond the scope of this reference.

Key fields in SQ_DESCRIBE:

- Column count
- For each column:
  - Column name (null-terminated string)
  - Data type code (SQLTYPE)
  - Length / precision
  - Nullable flag

### SQ_DATA Structure

Row data is encoded according to the data types declared in SQ_DESCRIBE. Each
column value is prefixed by a null indicator (1 byte):

- `0x00`: Column is NULL
- `0x01`: Column has a value (followed by the encoded data)

**Common SQLTYPE Encodings:**

| Type Code | SQL Type       | Wire Encoding                              |
|-----------|----------------|--------------------------------------------|
| 0         | CHAR           | Fixed-length, space-padded                 |
| 1         | SMALLINT       | 2 bytes, big-endian                        |
| 2         | INTEGER        | 4 bytes, big-endian                        |
| 3         | FLOAT          | 4 bytes, IEEE 754 single-precision         |
| 4         | SMALLFLOAT     | 8 bytes, IEEE 754 double-precision         |
| 5         | DECIMAL        | Packed decimal (variable length)           |
| 13        | VARCHAR        | 2-byte length prefix + data                |
| 41        | DATETIME       | Encoded as 10-byte qualifier + data        |
| 43        | LVARCHAR       | 4-byte length prefix + data                |
| 52        | BIGINT         | 8 bytes, big-endian                        |

### SQ_EOT

Indicates successful completion. Usually just 5 bytes:

```
00 00 00 01   <- Length = 1 byte
00            <- SQ_EOT
```

### SQ_ERR

Error message structure:

```
[4 bytes: length][0x02][error code (variable)][error message (null-terminated)]
```

Error codes are Informix-specific. Common codes:

| Code | Constant          | Description                                 |
|------|-------------------|---------------------------------------------|
| -201 | IX_NOTFOUND       | Table/column not found                      |
| -206 | IX_AMBIG          | Ambiguous column reference                  |
| -217 | IX_NOINDEX        | No index for this operation                 |
| -243 | IX_LOCKED         | Record/table locked                         |
| -329 | IX_DEADLOCK       | Deadlock detected                           |
| -761 | IX_NOTGRANTED     | Permission denied                           |
| -951 | IX_NOTCONNECTED   | Not connected to database                   |
| -23101| IX_NETWORKERR     | Network error                               |

---

## Security Considerations

### 1. Cleartext Password Transmission

SQLI SECMEC 1 sends passwords in cleartext over TCP. Mitigations:

- Use **port 9089** (onsoctcp_ssl) for TLS encryption
- Use SECMEC 7 (PAM) or SECMEC 9 (GSSAPI) for challenge-response auth
- Restrict network access (firewall rules, VPN)

### 2. SQL Injection

Always use parameterized queries (SQ_PREPARE + SQ_EXECUTE) instead of
concatenating user input into SQL strings for SQ_COMMAND.

### 3. Connection Hijacking

SQLI has no built-in session integrity protection. Use TLS or IPsec to prevent
man-in-the-middle attacks.

---

## Debugging Tips

### Wireshark SQLI Dissection

Wireshark does not have a native SQLI dissector. Use:

1. **Follow TCP Stream** (Analyze → Follow → TCP Stream)
2. Look for the 4-byte big-endian length headers
3. Search for ASCII strings like "SQLI", "ol_", database names

### Common Connection Failures

| Symptom                          | Cause / Fix                                     |
|----------------------------------|-------------------------------------------------|
| Connection refused               | onsoctcp not running; check `onstat -`          |
| Server sends empty response      | Wrong service name (ol_); try blank or "ol_ids" |
| Auth failure despite correct pwd | User not in database; `GRANT CONNECT TO user`   |
| Timeout after connection string  | Database offline; `onstat -d`                   |

### Informix Admin Commands

- **Check server status**: `onstat -`
- **List databases**: `onstat -d`
- **Check onsoctcp listener**: `onstat -g ntt` (look for SOCTCP)
- **View connections**: `onstat -g ses`

---

## Comparison with DRDA

IBM Informix supports both SQLI (native) and DRDA (DB2-compatible). Key differences:

| Feature               | SQLI (port 9088)              | DRDA (port 50000)                  |
|-----------------------|-------------------------------|------------------------------------|
| **Standard**          | Proprietary (Informix-only)   | Open Group standard (DB2, Derby)   |
| **Complexity**        | Simpler framing, fewer layers | Layered DSS/DDM architecture       |
| **Client Support**    | dbaccess, ESQL/C, Informix JDBC| DB2 CLI, Apache Derby, DRDA drivers|
| **Auth Methods**      | SECMEC 1/3/7/9                | SECMEC 3/4/7/9 (subset of DRDA)    |
| **Unicode**           | Version-dependent (7.31+)     | Full UTF-8 support                 |
| **Cursor Types**      | Forward-only, scrollable      | Forward-only, scrollable           |

**Recommendation:** For new projects, prefer **DRDA** (drda.ts) for standards
compliance and broader tooling support. Use SQLI only when interfacing with
legacy Informix applications that require it.

---

## Reference Implementation Notes

The `informix.ts` implementation in this codebase is a **probe-level client**.
It constructs a connection packet that is close enough to trigger an Informix
server response, then fingerprints the reply. It does **not** implement:

- Full FDOCA descriptor parsing (SQ_DESCRIBE)
- Typed column decoding (SQ_DATA)
- Prepared statements (SQ_PREPARE + SQ_EXECUTE)
- Transaction management (COMMIT/ROLLBACK)
- Cursor scrolling (SQ_FETCH with positioning)

For production workloads, use:

1. **DRDA** (`drda.ts` in this codebase) — standardized, well-documented
2. **Informix JDBC driver** — full protocol implementation, vendor-supported
3. **Informix ODBC driver** — C-based, high performance

---

## Further Reading

### IBM Documentation

- [Informix Administrator's Guide](https://www.ibm.com/docs/en/informix-servers/14.10?topic=servers-administrators-guide)
- [Informix SQL Reference](https://www.ibm.com/docs/en/informix-servers/14.10?topic=servers-sql-reference)
- [Informix Wire Protocol (unofficial)](https://community.ibm.com/community/user/datamanagement/communities/community-home?CommunityKey=cf5a1f39-c21f-4bc4-9ec2-7ca108f0a365) — Community discussions

### Protocol Specifications

- **DRDA**: [Open Group DRDA Technical Standard](http://pubs.opengroup.org/onlinepubs/009609799/toc.pdf)
- **FDOCA**: Part of DRDA specification, Appendix A
- **SQLI**: No public specification; reverse-engineered from packet captures

### Tools

- **Wireshark**: TCP stream analysis (no native SQLI dissector)
- **dbaccess**: Informix interactive SQL client (ships with IDS)
- **onstat**: Informix server monitoring utility
- **JDBC driver source**: IBM SDK for Informix JDBC (proprietary, source not public)

---

## Port of Call Implementation

### Endpoints

- **POST /api/informix/probe**
  - Body: `{ host, port?, timeout? }`
  - Returns: Server banner, version, RTT
  - Use: Detect Informix server presence

- **POST /api/informix/version**
  - Alias for /api/informix/probe
  - Returns: Same as probe

- **POST /api/informix/query**
  - Body: `{ host, port?, username?, password?, database?, query?, timeout? }`
  - Returns: Query results (best-effort, see notes below)
  - Use: Basic connectivity + auth validation

### Query Endpoint Limitations

The `/api/informix/query` endpoint returns **heuristic-parsed results** only.
Full SQLI result decoding requires:

1. Parse SQ_DESCRIBE to extract column metadata (names, types, lengths)
2. Decode FDOCA row descriptors (variable-length, nested structures)
3. Apply type-specific decoding (packed decimal, datetime qualifiers, etc.)

The current implementation:

- Sends SQ_COMMAND (immediate execution)
- Collects raw binary responses
- Extracts printable ASCII strings from the payload
- Returns them as rows (best-effort)

**Expected Behavior:**

- Simple queries (e.g., `SELECT tabname FROM systables`) may work
- Complex types (DECIMAL, DATETIME, BLOB) will return garbage
- NULL values may be omitted or misinterpreted

**Recommendation:** For real query execution, use DRDA (`/api/drda/query`) or
a proper Informix JDBC/ODBC driver.

---

## Example Usage

### Probe (curl)

```bash
curl -X POST https://portofcall.example.com/api/informix/probe \
  -H "Content-Type: application/json" \
  -d '{
    "host": "informix.example.com",
    "port": 9088,
    "timeout": 10000
  }'
```

**Response:**

```json
{
  "success": true,
  "host": "informix.example.com",
  "port": 9088,
  "isInformix": true,
  "serverInfo": "IBM Informix Dynamic Server Version 14.10.FC6",
  "version": "14.10",
  "dataLength": 256,
  "rtt": 42
}
```

### Query (curl)

```bash
curl -X POST https://portofcall.example.com/api/informix/query \
  -H "Content-Type: application/json" \
  -d '{
    "host": "informix.example.com",
    "port": 9088,
    "username": "informix",
    "password": "mypassword",
    "database": "sysmaster",
    "query": "SELECT tabname FROM systables WHERE tabid < 10",
    "timeout": 15000
  }'
```

**Response:**

```json
{
  "success": true,
  "host": "informix.example.com",
  "port": 9088,
  "isInformix": true,
  "serverInfo": "IBM Informix Dynamic Server Version 14.10.FC6",
  "version": "14.10",
  "rows": [
    ["systables", "syscolumns", "sysindices"],
    ["sysusers", "sysdepend", "syssyntable"]
  ],
  "rtt": 156
}
```

---

## License & Disclaimer

This documentation is provided as-is for educational and interoperability
purposes. SQLI is a proprietary protocol owned by IBM. Use at your own risk.
For production deployments, consult IBM's official Informix documentation and
use vendor-supported drivers.

**Port of Call** is not affiliated with IBM or the Informix product team.
