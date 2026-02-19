# DRDA Protocol — Power-User Reference

## Overview

DRDA (Distributed Relational Database Architecture) is IBM's open standard wire
protocol for distributed database access, originally published as an Open Group
standard. DB2, Apache Derby, and IBM Informix all speak it natively. Port 50000
is the well-known default for DB2 and Derby.

The protocol is layered: **DDM** (Distributed Data Management Architecture) is
the wire format; **DRDA** is the higher-level command vocabulary built on top of
it. Every byte on the wire is big-endian.

---

## Layer 1 — DSS (Data Stream Structure)

Every DRDA exchange is carried inside one or more DSS envelopes. The DSS header
is exactly **6 bytes**:

```
Offset  Size  Field
  0      2    Total DSS length (includes these 6 bytes)
  2      1    Magic byte — always 0xD0
  3      1    Format byte: upper nibble = DSS type, bit 6 = chain flag
  4      2    Correlation ID (unsigned, big-endian)
```

### DSS Type nibble (upper 4 bits of byte 3)

| Value | Constant         | Meaning                          |
|-------|------------------|----------------------------------|
| 0x01  | RQSDSS           | Request DSS (client→server)      |
| 0x02  | RPYDSS           | Reply DSS (server→client)        |
| 0x03  | OBJDSS           | Object DSS (second DSS in chain) |

### Chain flag (bit 6 of byte 3)

When the chain flag (`0x40`) is set, another DSS of the **same correlation ID**
immediately follows. Used to attach the SQLSTT OBJDSS to an EXCSQLIMM/OPNQRY
RQSDSS. The last DSS in a chain clears this bit.

### DSS Length

Minimum valid DSS length is 6 (header only, no DDM payload).
Maximum is 32767 bytes per DSS (server-side limit varies).

---

## Layer 2 — DDM Object

Immediately after the DSS header comes a **DDM object** header (4 bytes):

```
Offset  Size  Field
  0      2    DDM object length (includes these 4 bytes)
  2      2    DDM code point (identifies the command or parameter)
  4+     ...  Payload (sub-parameters or scalar data)
```

Parameters are **nested recursively**: a DDM object's payload can itself contain
smaller DDM objects. This is how complex structures like `PKGNAMCSN` embed
`RDBNAM`, `RDBCOLID`, `PKGNAM`, etc.

A single DSS can contain multiple sequential DDM objects (at the same nesting
level) only within the OBJDSS case; the primary DDM object is one per DSS.

---

## Full Codepoint Table

### DDM Attribute Exchange

| Constant      | Hex    | Description                            |
|---------------|--------|----------------------------------------|
| CP_EXCSAT     | 0x1041 | Exchange Server Attributes (request)   |
| CP_EXCSATRD   | 0x1443 | Exchange Server Attributes Reply       |
| CP_EXTNAM     | 0x115E | External Name (client app name)        |
| CP_SRVCLSNM   | 0x1147 | Server Class Name                      |
| CP_SRVRLSLV   | 0x115A | Server Product Release Level           |
| CP_SRVNAM     | 0x116D | Server Name                            |
| CP_MGRLVLLS   | 0x1404 | Manager Level List                     |
| CP_AGENT      | 0x1403 | Agent manager code point               |
| CP_SQLAM      | 0x2407 | SQL Application Manager                |
| CP_RDB        | 0x240F | Relational Database manager            |
| CP_SECMGR     | 0x1440 | Security Manager                       |
| CP_CMNTCPIP   | 0x1474 | Commitment control manager (TCP/IP)    |

### Authentication

| Constant      | Hex    | Description                            |
|---------------|--------|----------------------------------------|
| CP_ACCSEC     | 0x106D | Access Security (request)              |
| CP_ACCSECRD   | 0x14AC | Access Security Reply                  |
| CP_SECCHK     | 0x106E | Security Check (request)               |
| CP_SECCHKRM   | 0x1219 | Security Check Reply Message           |
| CP_SECMEC     | 0x11A2 | Security Mechanism                     |
| CP_USRID      | 0x11A0 | User ID                                |
| CP_PASSWORD   | 0x11A1 | Password                               |
| CP_SVRCOD     | 0x1149 | Severity Code                          |
| CP_SECCHKCD   | 0x11A4 | Security Check Code                    |

### Database Access

| Constant       | Hex    | Description                            |
|----------------|--------|----------------------------------------|
| CP_ACCRDB      | 0x2001 | Access Relational Database (request)   |
| CP_RDBNAM      | 0x2110 | Relational Database Name               |
| CP_RDBCOLID    | 0x2111 | RDB Collection Identifier              |
| CP_PKGNAM      | 0x2112 | Package Name                           |
| CP_PKGCNSTKN   | 0x2125 | Package Consistency Token (8 bytes)    |
| CP_PKGSN       | 0x2124 | Package Section Number                 |
| CP_PKGNAMCSN   | 0x2026 | Package Name, Collection, Section Num  |
| CP_RDBACCCL    | 0x210F | RDB Access Class                       |
| CP_TYPDEFNAM   | 0x002F | Data Type Definition Name              |
| CP_TYPDEFOVR   | 0x0035 | Data Type Definition Override          |
| CP_CRRTKN      | 0x0012 | Correlation Token (8 bytes)            |
| CP_PRDID       | 0x112E | Product-specific ID                    |
| CP_RDBALWUPD   | 0x211A | RDB Allow Updates                      |
| CP_CCSIDSBC    | 0x119C | CCSID for single-byte chars            |
| CP_CCSIDDBC    | 0x119D | CCSID for double-byte chars            |
| CP_CCSIDMBC    | 0x119E | CCSID for mixed-byte chars             |

### SQL Execution

| Constant       | Hex    | Description                            |
|----------------|--------|----------------------------------------|
| CP_EXCSQLIMM   | 0x200A | Execute Immediate SQL                  |
| CP_OPNQRY      | 0x200C | Open Query (SELECT)                    |
| CP_OPNQRYRM    | 0x2205 | Open Query Reply Message               |
| CP_QRYDSC      | 0x241A | Query Descriptor (column metadata)     |
| CP_QRYDTA      | 0x241B | Query Data (row data)                  |
| CP_FETCH       | 0x200F | Fetch next block of rows               |
| CP_CLSQRY      | 0x2006 | Close Query (cursor)                   |
| CP_RDBCMM      | 0x200E | Relational Database Commit             |
| CP_RDBRLLBCK   | 0x200D | Relational Database Rollback           |
| CP_SQLSTT      | 0x2414 | SQL Statement text                     |
| CP_SQLCARD     | 0x2245 | SQL Communications Area Reply Data     |
| CP_SQLDARD     | 0x227D | SQL Descriptor Area Reply Data         |
| CP_ENDUOWRM    | 0x220C | End Unit of Work Reply Message         |
| CP_RDBUPDRM    | 0x2218 | RDB Update Reply Message               |
| CP_QRYBLKSZ    | 0x2114 | Query Block Size                       |
| CP_QRYROWSET   | 0x2132 | Query Row Set size                     |
| RDBCMTOK       | 0x211C | RDB Commit Token (auto-commit flag)    |

### Prepared Statements & Result Sets

| Constant       | Hex    | Description                            |
|----------------|--------|----------------------------------------|
| CP_PRPSQLSTT   | 0x200B | Prepare SQL Statement                  |
| CP_EXCSQLSTT   | 0x2012 | Execute Prepared SQL Statement         |
| CP_SQLDTA      | 0x2412 | SQL Data (parameter values)            |
| CP_SQLDTARD    | 0x2413 | SQL Data Descriptor (parameter types)  |
| CP_RSLSETRM    | 0x220E | Result Set Reply Message               |
| CP_NBRROW      | 0x2116 | Number of Rows affected                |
| CP_QRYTOKN     | 0x2135 | Query Result Set Token                 |

---

## Protocol Command Flow

### Phase 1 — Attribute Exchange (EXCSAT)

Client sends `EXCSAT` (RQSDSS, correlId=1) containing:
- `EXTNAM` — client application name (string)
- `SRVCLSNM` — protocol class name (e.g. "DRDA/TCP")
- `SRVRLSLV` — release level string (e.g. "01.00.0000")
- `SRVNAM` — client-side server name hint
- `MGRLVLLS` — list of `(manager_cp, level)` pairs (4 bytes each)

Server replies with `EXCSATRD` (RPYDSS, correlId=1) containing the same
parameter types filled with the server's values.

**Identification:** The reply DSS magic byte is `0xD0` and the DDM code point at
offset `[8..9]` (big-endian uint16) is `0x1443` (CP_EXCSATRD). Any response
without this codepoint at that offset is not a DRDA server.

### Phase 2 — Security Negotiation (ACCSEC / ACCSECRD)

Client sends `ACCSEC` (RQSDSS, correlId=1) with:
- `SECMEC` = `0x0003` (USRID+PASSWORD plaintext)
- `RDBNAM` — target database name

Server replies `ACCSECRD` confirming the mechanism, or an error object.

**Supported mechanism:** Only `SECMEC_USRIDPWD = 0x0003` is implemented. DRDA
also defines Kerberos (0x0009) and encrypted password schemes, which are not
supported here.

### Phase 3 — Authentication (SECCHK / SECCHKRM)

Client sends `SECCHK` (RQSDSS, correlId=2) with:
- `SECMEC` = `0x0003`
- `RDBNAM` — database name
- `USRID` — username (string)
- `PASSWORD` — password (string, cleartext)

Server replies `SECCHKRM`. If `SECCHKCD` is present and non-zero, auth failed.

**SECCHKCD values:**

| Code | Meaning                                 |
|------|-----------------------------------------|
| 0x00 | Auth succeeded                          |
| 0x01 | Security violation (generic)            |
| 0x04 | Invalid user ID or password             |
| 0x0A | New password required                   |
| 0x0E | Auth failed (generic)                   |

### Phase 4 — Database Open (ACCRDB / ACCRDBRM)

Client sends `ACCRDB` (RQSDSS, correlId=2) with:
- `RDBNAM` — database name
- `RDBACCCL` = CP_SQLAM (0x2407) — access class
- `TYPDEFNAM` = "QTDSQLXVSS" — type definition name
- `TYPDEFOVR` — CCSID overrides (SBC/DBC/MBC all = 1208 for UTF-8)
- `PRDID` = "CSS01070" — product ID
- `CRRTKN` — 8-byte correlation token (zeros)
- `RDBALWUPD` = 0x01 — allow updates

Server replies `ACCRDBRM`.

After ACCRDBRM the database session is fully open and SQL can be executed.

---

## SQL Execution Flows

### Immediate DML (EXCSQLIMM)

Used for INSERT/UPDATE/DELETE/DDL that does not return a result set.

```
Client -> EXCSQLIMM RQSDSS (chained, correlId=3)
              PKGNAMCSN: rdbnam + colid + pkgnam + cnstkn + pkgsn
              RDBCMTOK: 0x00 (FALSE — use explicit RDBCMM)
       -> SQLSTT OBJDSS (correlId=3, end of chain)
              raw SQL text bytes

Server -> SQLCARD (SQLCODE, SQLSTATE, message)

Client -> RDBCMM (correlId=6)
Server -> ENDUOWRM (commit acknowledged)
```

**RDBCMTOK:** Setting this to `0x01` (TRUE) triggers auto-commit per statement.
Setting it to `0x00` (FALSE) requires an explicit `RDBCMM` to commit. The
implementation uses `0x00` to allow the caller to control transaction boundaries.

### SELECT Query (OPNQRY + FETCH + CLSQRY)

```
Client -> OPNQRY RQSDSS (chained, correlId=3)
              PKGNAMCSN, QRYBLKSZ=32767, QRYROWSET=100
       -> SQLSTT OBJDSS (correlId=3)
              raw SQL text

Server -> OPNQRYRM (8-byte query token in data field)
          QRYDSC or SQLDARD (column descriptors)
          QRYDTA (first block of rows)

Client -> FETCH (correlId=4)
              PKGNAMCSN, QRYTOKN=<8-byte token from OPNQRYRM>

Server -> QRYDTA (next block)
          [SQLCARD with SQLCODE=100 signals end of data]

Client -> CLSQRY (correlId=5)
              PKGNAMCSN, QRYTOKN
Server -> CLSQRYRM

Client -> RDBCMM (correlId=6)
Server -> ENDUOWRM
```

**QRYTOKN (0x2135):** The 8-byte query token is extracted from the first 8 bytes
of the `OPNQRYRM` DDM object data. It must be sent verbatim on FETCH and CLSQRY.

**End of cursor detection:** SQLCODE=100 in a SQLCARD response means no more
rows (like SQL NOT FOUND). An empty QRYDTA block also signals end of data.

### Prepared Statement Flow

```
Client -> PRPSQLSTT RQSDSS (chained, correlId=3)
              PKGNAMCSN
              RTNSQLDA (0x2104) = 0x0000
       -> SQLSTT OBJDSS (correlId=3)

Server -> SQLDARD (column descriptors for output)
          SQLDTARD (parameter descriptors for input)
          SQLCARD (SQLCODE=0 on success)

Client -> EXCSQLSTT RQSDSS (chained, correlId=4)  [for DML]
              PKGNAMCSN
       -> SQLDTA OBJDSS (correlId=4)
              parameter bytes (see Parameter Encoding below)

  OR:

Client -> OPNQRY RQSDSS (chained, correlId=4)    [for SELECT]
              PKGNAMCSN, QRYBLKSZ, QRYROWSET
       -> SQLDTA OBJDSS (correlId=4)
              parameter bytes
```

---

## FDOCA Column Types (QRYDSC / SQLDARD)

Each column descriptor in SQLDARD/QRYDSC contains:
- 2 bytes: SQL type code (bit 0 = nullable flag)
- 2 bytes: column length
- 1 byte:  precision
- 1 byte:  scale
- 2 bytes: name length
- n bytes: column name

`type & 0xFFFE` gives the base type; `type & 1` is the nullable flag.

| Constant          | Hex  | Description                        | Wire Size      |
|-------------------|------|------------------------------------|----------------|
| FDOCA_VARCHAR     | 0x30 | Variable-length char               | 2-byte len + n |
| FDOCA_CHAR        | 0x2C | Fixed-length char                  | col.length     |
| FDOCA_LONGVARCHAR | 0x34 | Long varchar                       | 2-byte len + n |
| FDOCA_INTEGER     | 0x50 | 32-bit signed integer              | 4              |
| FDOCA_SMALLINT    | 0x52 | 16-bit signed integer              | 2              |
| FDOCA_REAL        | 0x44 | 32-bit IEEE float                  | 4              |
| FDOCA_DOUBLE      | 0x46 | 64-bit IEEE double                 | 8              |
| FDOCA_DECIMAL     | 0x3E | Packed BCD decimal                 | ceil((P+1)/2)  |
| FDOCA_DATE        | 0x90 | Date string "YYYY-MM-DD"           | 10             |
| FDOCA_TIME        | 0x92 | Time string "HH:MM:SS"             | 8              |
| FDOCA_TIMESTAMP   | 0x94 | Timestamp "YYYY-MM-DD HH:MM:SS.n"  | 26             |
| FDOCA_BIGINT      | 0x16 | 64-bit signed integer              | 8              |
| FDOCA_BLOB        | 0x58 | Binary large object                | 4-byte len + n |
| FDOCA_CLOB        | 0x5C | Character large object             | 4-byte len + n |

### Nullable Column Wire Format

For nullable columns, each value is preceded by a **2-byte null indicator**:
- `-1` (0xFFFF as int16) → column is NULL, no value bytes follow
- `0` → column is non-null, value bytes follow immediately

### Packed Decimal Decoding

For `FDOCA_DECIMAL` with precision `P` and scale `S`:
- Byte count = `ceil((P+1)/2)`
- Each byte holds two BCD digits (high nibble = leading digit)
- The final byte's low nibble is the sign: `0xC` or `0xF` = positive; `0xD` or `0xB` = negative
- Digits after the decimal point: last `S` digits

---

## Parameter Encoding (SQLDTA)

When sending parameters to a prepared statement (EXCSQLSTT or parameterized
OPNQRY), parameters are encoded sequentially with no header count:

```
For each parameter:
  [2 bytes: null indicator]  — 0x0000 for non-null, 0xFFFF for null
  [value bytes if non-null]:
    null/undefined → (only the 0xFFFF null indicator, no value)
    string         → uint16 length + UTF-8 bytes
    bigint         → int64 big-endian (8 bytes)
    boolean        → int16 (0 or 1, 2 bytes)
    integer        → int32 big-endian (4 bytes)  [if -2147483648 ≤ n ≤ 2147483647]
    float/number   → float64 big-endian (8 bytes)
```

This encoding assumes the server knows the target column types from the prepared
statement. The client does not send explicit type codes — the server maps
positions to types from the cached SQLDARD.

---

## SVRCOD Error Codes

`SVRCOD` (CP_SVRCOD = 0x1149) is a 2-byte severity code carried in error reply
messages. Common values:

| Value | Meaning                                    |
|-------|--------------------------------------------|
| 0     | Information only                           |
| 4     | Warning                                    |
| 8     | Error — command rejected                   |
| 16    | Error — object damaged                     |
| 32    | Severe error — conversation terminated     |

---

## SQLCARD / SQLCODE

`SQLCARD` (CP_SQLCARD = 0x2245) is the SQL error/status object:

```
Offset  Size  Field
  0      4    SQLCODE (signed int32) — 0 = success, >0 = warning, <0 = error
  4      5    SQLSTATE (5 ASCII chars, e.g. "00000", "23505")
  9      2    Message length
 11      n    Message text
```

Notable SQLCODE values:

| Code | Meaning                                    |
|------|--------------------------------------------|
| 0    | Success                                    |
| 100  | No data (end of cursor)                    |
| -104 | Illegal symbol in SQL syntax               |
| -204 | Object not found                           |
| -305 | NULL value not allowed (constraint)        |
| -407 | NULL inserted into NOT NULL column         |
| -911 | Deadlock or timeout; transaction rolled back |
| -952 | Processing cancelled (interrupt)           |

---

## Manager Level List (MGRLVLLS)

The `MGRLVLLS` DDM object (0x1404) carries a list of supported managers as
4-byte pairs: `(manager_codepoint, level)` both as uint16 big-endian.

This implementation advertises level 7 for all five managers:

| Manager   | CP     | Purpose                            |
|-----------|--------|------------------------------------|
| AGENT     | 0x1403 | Core DDM agent                     |
| SQLAM     | 0x2407 | SQL application manager            |
| RDB       | 0x240F | Relational database manager        |
| SECMGR    | 0x1440 | Security manager                   |
| CMNTCPIP  | 0x1474 | Commitment control over TCP/IP     |

---

## PKGNAMCSN Structure

`PKGNAMCSN` (0x2026) is a compound parameter embedding the package reference
needed on every SQL command:

```
PKGNAMCSN:
  RDBNAM  (database name string)
  RDBCOLID = "NULLID"     (collection ID — Derby's default schema)
  PKGNAM  = "SYSSH200"   (system package name for Derby)
  PKGCNSTKN = 8 zero bytes (package consistency token)
  PKGSN   (uint16, section/statement number — incremented per prepared stmt)
```

Derby and DB2 use the package concept to track prepared statement sections.
`PKGSN` is an index into the package: different values allow multiple prepared
statements in the same session without server-side conflicts.

---

## DSS Chaining

When a command requires an attached SQLSTT or SQLDTA object, two DSSs are sent
in a chain without waiting for a server response between them:

```
[RQSDSS | correlId=N | chainFlag=0x40] [PKGNAMCSN ...] ...
[OBJDSS | correlId=N | chainFlag=0x00] [SQLSTT or SQLDTA payload]
```

Both DSSs must have the same correlId. The server reads the entire chain before
processing. The implementation sets `chainNext=true` on the RQSDSS and the
OBJDSS terminates the chain.

---

## Wire Example — EXCSAT Handshake

Sent by client:
```
D0 01 00 01      -- DSS: len=?, magic=0xD0, type=RQSDSS(0x01), correlId=1
10 41            -- DDM: CP_EXCSAT
  11 5E ...      --   EXTNAM: "portofcall"
  11 47 ...      --   SRVCLSNM: "DRDA/TCP"
  11 5A ...      --   SRVRLSLV: "01.00.0000"
  11 6D ...      --   SRVNAM: "portofcall"
  14 04 ...      --   MGRLVLLS: [(0x1403,7),(0x2407,7),(0x240F,7),(0x1440,7),(0x1474,7)]
```

Server reply (EXCSATRD, RPYDSS = type 0x02):
```
D0 02 00 01      -- DSS: magic=0xD0, type=RPYDSS(0x02), correlId=1
14 43            -- DDM: CP_EXCSATRD
  11 6D ...      --   SRVNAM: "DB2/LINUX"
  11 47 ...      --   SRVCLSNM: "QDB2/JVM"
  11 5A ...      --   SRVRLSLV: "SQL09020"
  14 04 ...      --   MGRLVLLS: [(0x1403,7),(0x2407,7),...]
```

**Detection:** A server is confirmed as DRDA if bytes `[2]==0xD0` and the 16-bit
value at `[8]` equals `0x1443` (CP_EXCSATRD).

---

## Edge Cases and Known Limitations

### 1. EXCSAT Sent Without Authentication (Connect/Probe)

`/connect` and `/probe` send EXCSAT without completing the auth sequence. Many
DRDA servers respond to EXCSAT with EXCSATRD even without credentials, making
identification possible without valid login. Some hardened servers may close the
connection or send an RDBNFNRM (RDB Not Found) after EXCSAT.

### 2. cleartext Password

`SECMEC_USRIDPWD (0x0003)` sends passwords as cleartext. Use `ssl=true` to
wrap the connection in TLS. DRDA also defines encrypted schemes (EUSRIDPWD,
Kerberos) but they are not implemented.

### 3. Correlation ID Reuse

CorrelIds in this implementation are not monotonically incrementing session-wide
counters; they are role-specific constants (1 for EXCSAT/ACCSEC, 2 for
SECCHK/ACCRDB, 3 for SQL commands, etc.). This is valid because each
request-response pair completes before the next begins (no pipelining).

### 4. Package Section Numbers (PKGSN)

Derby maps PKGSN to internal statement slots. PKGSN values are reused across
separate connections since each connection establishes its own ACCRDB session.
For multiple concurrent prepared statements in one session, different PKGSN
values must be used (which the implementation does via the `pkgSn` parameter).

### 5. QRYDTA Sentinel Bytes

The QRYDTA data stream uses:
- `0x00` as the end-of-data sentinel (breaks out of row-parsing loop)
- `0xFF` as a padding/skip byte

The implementation handles both but some server implementations pad differently.

### 6. LOB Handling

`FDOCA_BLOB` (0x58) and `FDOCA_CLOB` (0x5C) are partially supported: their
byte length is read and skipped in the result stream, and a placeholder string
`[LOB: N bytes]` is returned. Actual LOB data retrieval would require separate
DRDA locator-based commands not implemented here.

### 7. Multi-Result-Set Stored Procedures

For `CALL` statements returning multiple result sets, the implementation opens
each result set by re-issuing `OPNQRY` with incrementing PKGSN values (starting
at 2). The `RSLSETRM` object carries the count of result sets. If the count is
0, one OPNQRY attempt is made anyway (some servers omit RSLSETRM for single
result sets).

### 8. QRYBLKSZ Maximum

The implementation requests `QRYBLKSZ=32767` bytes per block. This is the
maximum safe value for servers that use a uint16 internally. DB2 supports larger
values with extended DRDA, but 32767 is universally safe.

### 9. TYPDEFNAM and CCSID

The implementation uses `TYPDEFNAM = "QTDSQLXVSS"` (the DB2/Derby/Informix
standard type definition) with CCSID 1208 (UTF-8) for all character types
(SBC, DBC, and MBC slots). Servers expecting EBCDIC (CCSID 37 or 500) will
produce garbled string data. Derby always speaks UTF-8 so this is correct.

### 10. No Pipelining

Each command is sent sequentially and the response read in full before the next
command. DRDA supports pipelining (multiple outstanding requests) but it is not
implemented here to keep the connection management simple.

### 11. Single-DSS Response Assumption in parseEXCSATRD

`parseEXCSATRD` hard-codes the DSS offsets (DSS header = bytes 0–5, DDM
codepoint at bytes 8–9). This is correct when the response is a single DSS, but
would fail if the server ever sent an EXCSATRD prefixed by another DSS. In
practice, EXCSATRD is always a standalone reply.

---

## API Endpoints

| Endpoint       | Description                              | Auth Required |
|----------------|------------------------------------------|---------------|
| POST /connect  | EXCSAT only — detect DRDA, no login      | No            |
| POST /probe    | Same as /connect but minimal response    | No            |
| POST /login    | Full auth (EXCSAT→ACCSEC→SECCHK→ACCRDB) | Yes           |
| POST /query    | SELECT/WITH/EXPLAIN/VALUES + row fetch   | Yes           |
| POST /execute  | INSERT/UPDATE/DELETE/DDL, returns SQLCARD| Yes           |
| POST /preparex | Prepare SQL, return SQLDARD metadata     | Yes           |
| POST /call     | CALL stored procedure, multi-result sets | Yes           |

### Common Request Body Fields

```json
{
  "host":     "db2host.example.com",
  "port":     50000,
  "database": "SAMPLE",
  "username": "db2inst1",
  "password": "secret",
  "ssl":      false,
  "timeout":  30000
}
```

### /query Additional Fields

```json
{
  "sql":     "SELECT * FROM EMPLOYEE WHERE DEPTNO = ?",
  "params":  ["A00"],
  "maxRows": 100
}
```

### /execute Additional Fields

```json
{
  "sql":    "INSERT INTO DEPT VALUES (?, ?, ?)",
  "params": ["X99", "Engineering", null]
}
```

### /call Additional Fields

```json
{
  "procedure": "CALL MYSCHEMA.GETORDERS(?, ?)",
  "params":    ["CUST001", 30],
  "maxRows":   200
}
```

---

## Default Port

Port **50000** is the well-known default for DB2 and Derby. IBM Informix
defaults to port 1526. Most Docker images for DB2 expose 50000.

---

## Security Notes

- Passwords are sent cleartext inside the DRDA `PASSWORD` DDM object. Always
  use `ssl: true` (TLS) in production.
- The `/connect` and `/probe` endpoints do not require credentials and will
  attempt to fingerprint any TCP service — limit access appropriately.
- The DRDA protocol has no built-in brute-force protection; rate limiting must
  be applied at the API layer.
