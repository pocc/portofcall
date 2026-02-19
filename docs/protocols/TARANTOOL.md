# Tarantool IPROTO Protocol

**Port:** 3301 (default)  
**Transport:** TCP  
**Encoding:** MessagePack (binary)  
**Spec:** [Tarantool IPROTO documentation](https://www.tarantool.io/en/doc/latest/dev_guide/internals/box_protocol/)

---

## Overview

Tarantool uses a binary protocol called IPROTO over a plain TCP socket. Every exchange begins with a 128-byte server-sent greeting, after which client and server communicate with self-framed MessagePack messages. There is no TLS at the protocol layer; TLS is handled at the infrastructure layer.

This implementation tests Tarantool connectivity via four endpoints:

| Endpoint | Handler | Purpose |
|---|---|---|
| `POST /api/tarantool/connect` | `handleTarantoolConnect` | Read greeting + send IPROTO_PING |
| `POST /api/tarantool/probe` | `handleTarantoolProbe` | Read greeting only, no PING |
| `POST /api/tarantool/eval` | `handleTarantoolEval` | Execute a Lua expression via IPROTO_EVAL |
| `POST /api/tarantool/sql` | `handleTarantoolSQL` | Execute SQL via IPROTO_EXECUTE |

---

## Connection Flow

```
Client                      Server
  |                           |
  |<--- TCP CONNECT ----------|
  |<--- 128-byte greeting ----|   (server speaks first)
  |                           |
  |--- IPROTO_PING (10 bytes)>|   (/connect only)
  |<--- PING response --------|
  |                           |
  |--- IPROTO_EVAL/EXECUTE -->|   (/eval and /sql only)
  |<--- response -------------|
  |--- TCP close ------------>|
```

Tarantool speaks first. The client does not need to send any bytes to receive the greeting.

---

## Greeting Format (128 bytes)

The server sends exactly 128 bytes immediately upon TCP connection establishment.

```
Bytes   0 -  63  Line 1: ASCII text, terminated by newline
                  Format: "Tarantool X.Y.Z (Binary) <instance-uuid>"
                  Example: "Tarantool 2.11.0 (Binary) 9b60bd6c-a8c6-4b09-9e46-003aa0e2b0e0"

Bytes  64 - 107  Line 2: Base64-encoded salt, terminated by newline
                  Decoded length: 44 bytes, used for CHAP-SHA1 auth

Bytes 108 - 127  Padding (zeros)
```

### Parsing notes

- The greeting salt decodes to 44 bytes. Only the first 20 bytes are used in the CHAP-SHA1 scramble step.
- The `/connect` response exposes the salt truncated to the first 20 chars + `...` to avoid logging the full value.
- If line 1 does not start with `"Tarantool "`, `isTarantool: false` is reported and no further requests are sent.

---

## IPROTO Message Format

Every IPROTO message has the same framing:

```
[size prefix] [header map] [body map]
```

### Size prefix

A MessagePack unsigned integer giving the byte length of `[header map] + [body map]`. Tarantool's `mp_decode_uint` accepts any valid msgpack uint encoding:

| Encoding | Bytes | Range |
|---|---|---|
| fixint | 1 | 0-127 |
| uint8 (0xCC) | 2 | 0-255 |
| uint16 (0xCD) | 3 | 0-65535 |
| uint32 (0xCE) | 5 | 0-4294967295 |

This implementation always writes a **5-byte uint32 size prefix** (0xCE) for outbound requests. This is conventional and avoids edge cases in strict implementations.

### Header map (required)

A MessagePack fixmap with at minimum two keys:

| Key (uint) | Name | Value |
|---|---|---|
| `0x00` | `IPROTO_REQUEST_TYPE` | Request type code (see below) |
| `0x01` | `IPROTO_SYNC` | Client-chosen request ID; echoed in response |
| `0x05` | `IPROTO_SCHEMA_VERSION` | Schema version (server response only) |

In responses, key `0x00` carries `IPROTO_STATUS`: 0 for success, non-zero for error.

### Body map (request-specific)

An empty fixmap `0x80` is valid for PING. Other request types define specific body keys.

---

## Request Types

| Code | Name | Description |
|---|---|---|
| `0x40` | `IPROTO_PING` | No-op connectivity check |
| `0x49` | `IPROTO_ID` | Capability negotiation (Tarantool 2.10+) |
| `0x29` | `IPROTO_EVAL` | Execute a Lua expression |
| `0x0b` | `IPROTO_EXECUTE` | Execute SQL |
| `0x07` | `IPROTO_AUTH` | Authenticate |
| `0x01` | `IPROTO_SELECT` | Select rows from a space |
| `0x02` | `IPROTO_INSERT` | Insert a tuple |
| `0x03` | `IPROTO_REPLACE` | Replace a tuple |
| `0x04` | `IPROTO_UPDATE` | Update fields in a tuple |
| `0x05` | `IPROTO_DELETE` | Delete a tuple |
| `0x0a` | `IPROTO_CALL` | Stored procedure call |

Note: The `IPROTO_SQL_TEXT` body field key is also `0x40`. This is not a conflict because request type codes and body field keys occupy separate namespaces.

---

## IPROTO_PING Wire Format

```
Outbound (10 bytes):
  CE 00 00 00 06   -- size prefix: uint32(6) = 6 bytes follow
  82               -- fixmap(2) header
    00 40          -- key 0x00 (REQUEST_TYPE) = 0x40 (PING)
    01 01          -- key 0x01 (SYNC) = 1
  80               -- body: empty fixmap

Inbound response (success, approx 22 bytes):
  CE 00 00 00 0B   -- size prefix: uint32(11)
  83               -- fixmap(3)
    00 00          -- IPROTO_STATUS = 0 (OK)
    01 01          -- IPROTO_SYNC = 1
    05 xx          -- IPROTO_SCHEMA_VERSION = current schema version
  80               -- body: empty fixmap
```

---

## IPROTO_EVAL Wire Format

Body keys for IPROTO_EVAL (0x29):

| Key | Name | Type | Description |
|---|---|---|---|
| `0x27` | `IPROTO_EXPR` | str | Lua expression to evaluate |
| `0x21` | `IPROTO_TUPLE` | array | Positional arguments (`...` in Lua) |

```
Request -- eval "return box.info.version":
  CE 00 00 00 1F   -- size prefix (31 bytes follow)
  82               -- fixmap(2) header
    00 29          -- REQUEST_TYPE = 0x29 (IPROTO_EVAL)
    01 01          -- SYNC = 1
  82               -- fixmap(2) body
    27 B7 ...      -- IPROTO_EXPR (0x27): fixstr(23) "return box.info.version"
    21 90          -- IPROTO_TUPLE (0x21): fixarray(0) (empty args)

Response body on success:
  Key 0x30 (IPROTO_DATA): array of return values, e.g. ["2.11.0-0-g...."]
```

The `args` array is always empty in this implementation; the `args` request field is accepted but silently dropped.

---

## IPROTO_EXECUTE Wire Format

Body keys for IPROTO_EXECUTE (0x0b):

| Key | Name | Type | Description |
|---|---|---|---|
| `0x40` | `IPROTO_SQL_TEXT` | str | SQL statement |
| `0x41` | `IPROTO_SQL_BIND` | array | Positional bind parameters |

```
Request -- "SELECT id, name FROM _space LIMIT 1":
  CE 00 00 00 ??   -- size prefix
  82               -- fixmap(2) header
    00 0B          -- REQUEST_TYPE = 0x0b (IPROTO_EXECUTE)
    01 02          -- SYNC = 2
  82               -- fixmap(2) body
    40 ??          -- IPROTO_SQL_TEXT (0x40): SQL string
    41 90          -- IPROTO_SQL_BIND (0x41): fixarray(0) (no binds)

Response body keys:
  0x30 (IPROTO_DATA):     array of rows; each row is an array of column values
  0x32 (IPROTO_METADATA): array of column descriptor maps
                          Each: {0: column_name, 1: column_type} (uint keys)
```

Column names are extracted from metadata via `c['name'] ?? c['0']`. Since `mpDecode` converts msgpack integer keys to strings, the descriptor key for column name (msgpack uint 0) becomes the string `"0"`.

---

## Authentication

Tarantool uses CHAP-SHA1 authentication. **This implementation does not authenticate.** Fields `username` and `password` in request bodies are accepted but silently ignored.

### CHAP-SHA1 algorithm (informational)

```
decoded_salt  = base64_decode(greeting_line2.trim())   // 44 bytes
salt_20       = decoded_salt.slice(0, 20)               // first 20 bytes only

step1    = SHA1(password)                               // 20 bytes
step2    = SHA1(step1)                                  // 20 bytes
step3    = SHA1(concat(salt_20, step2))                 // SHA1 of 40 bytes
scramble = XOR(step1, step3)                            // 20 bytes, byte-by-byte
```

### IPROTO_AUTH request body

```
{
  0x23 (IPROTO_USER_NAME): username_string,
  0x21 (IPROTO_TUPLE):     ["chap-sha1", scramble_as_bin8]
}
```

Without authentication, requests run as the built-in **guest** user. In default configurations guest has no execute permission; EVAL and EXECUTE return IPROTO error `0x8000000E` (ER_ACCESS_DENIED).

---

## Response Parsing

### readIprotoResponse -- size prefix handling

Always reads exactly 5 bytes from the socket first, then determines the encoding from byte 0:

| Byte 0 | Encoding | Size field | Payload bytes over-read in 5-byte read |
|---|---|---|---|
| `0xCE` | uint32 | bytes 0-4 | none |
| `0xCD` | uint16 | bytes 0-2 | bytes 3-4 (first 2 payload bytes) |
| `0x00`-`0x7F` | fixint | byte 0 | bytes 1-4 (first up to 4 payload bytes) |

The over-read payload bytes are extracted from `sizeBytes` and prepended when assembling the complete buffer; only the remaining `msgLen - N` bytes are read from the socket.

**Bug fixed 2026-02-18:** The original uint16 case read an additional `extra` byte from the socket while discarding `sizeBytes[3..4]`, then assembled `[3-byte prefix][extra][payload]`, losing the 2 over-read bytes and corrupting the entire response parse. The fixint case similarly discarded bytes 1-4 of `sizeBytes`.

### parseFullIprotoResponse -- offset table

After `readIprotoResponse` returns the assembled buffer:

```
0xCE prefix  ->  header map starts at offset 5
0xCD prefix  ->  header map starts at offset 3
fixint       ->  header map starts at offset 1
```

### Error responses

On error, `IPROTO_STATUS` (key `0x00`) in the header is non-zero. The body may contain:

| Key | Name | Notes |
|---|---|---|
| `0x31` | `IPROTO_ERROR` | Error message string, all versions |
| `0x52` | `IPROTO_ERROR_24` | Structured error, Tarantool 2.4.1+; not parsed here |

Common IPROTO status codes (`0x8000xxxx` on the wire):

| Decimal | Name | Cause |
|---|---|---|
| 10 | ER_NO_SUCH_SPACE | Space does not exist |
| 14 | ER_ACCESS_DENIED | Auth required or insufficient privilege |
| 32 | ER_UNSUPPORTED | Operation not supported by the storage engine |
| 48 | ER_STMT_NOT_PREPARED | SQL parse error |

`iprotoStatus` in error responses contains the full 32-bit value including the high bit.

---

## MessagePack Implementation Details

### Encoders

| Function | Types |
|---|---|
| `mpEncodeUint` / `mpUint` | fixint, uint8, uint16, uint32 |
| `mpEncodeString` | fixstr (0-31 B), str8 (32-255 B), str16 (256-65535 B) |
| `mpEncodeMap` | fixmap of uint key-uint value pairs |
| `mpEncodeFullMap` | fixmap of arbitrary pre-encoded key-value byte arrays |
| `mpEncodeArrayHeader` | fixarray, array16, array32 headers |
| `buildSizeHeader` | always 5-byte uint32 (0xCE) |

Note: `mpEncodeUint` and `mpUint` are separate but equivalent functions defined in different sections of the file. `mpEncodeUint` is used in the PING path; `mpUint` in the EVAL/SQL path.

### Decoders

`mpDecodeUint` -- uint types only (used in the simple PING path header parsing).

`mpDecode` -- full recursive decoder:
- nil, bool
- positive/negative fixint
- uint8, uint16, uint32, int8
- fixstr, str8, str16
- fixarray, array16
- fixmap
- bin8 (skipped, returns null)
- float32, float64

`mpSkipValue` -- advance past any single value without decoding (added 2026-02-18):
- All types in `mpDecode` plus int16, int32, int64, uint64, str32, bin16, bin32, array16, map16
- Used in `parseIprotoResponse` when skipping non-`IPROTO_ERROR` body fields

### Unhandled types

- `uint64` -- JavaScript `Number` cannot represent all uint64 values; `mpDecodeUint` returns 0
- `map16`, `map32` -- `mpDecode` returns null; `mpSkipValue` handles `map16` correctly
- Ext types -- Tarantool uses ext type 2 (decimal) and ext type 4 (UUID) in some contexts; these return null from `mpDecode` and are advanced by only 1 byte by `mpSkipValue` (incorrect skip for non-fixext variants)

---

## Known Limitations

1. **No authentication.** Requests run as guest. Auth-protected instances return ER_ACCESS_DENIED.

2. **IPROTO_AUTH not implemented.** `username`/`password` request fields are accepted but silently ignored.

3. **No IPROTO_ID capability negotiation.** Server treats this client as a legacy client with no extended capabilities (no error extension, no streams, no watchers).

4. **No IPROTO_ERROR_24 parsing.** Structured error detail (Tarantool 2.4.1+, key `0x52`) is silently skipped. If a server omits the legacy `IPROTO_ERROR` (0x31) field, the error string will be empty.

5. **PING response read is fixed at 64 bytes.** `handleTarantoolConnect` uses `readExact(reader, 64)` rather than `readIprotoResponse`. A PING response is approximately 22 bytes; 64 is safe in practice.

6. **Eval args are not forwarded.** `IPROTO_TUPLE` is always an empty array; the `args` field in the request body is silently dropped.

7. **No SQL bind parameters.** `IPROTO_SQL_BIND` is always an empty array.

8. **fixmap-only encoding.** `mpEncodeFullMap` supports at most 15 map entries. No guard or fallback.

9. **str16 overflow for strings > 65535 bytes.** `mpEncodeString` uses str16 for strings 256-65535 B; strings over 65535 B will have a silently truncated length field.

10. **No space operations.** SELECT/INSERT/REPLACE/UPDATE/DELETE require tuple-space encoders not present.

11. **No pipelining.** One request per TCP connection. SYNC is hardcoded to 1 (eval) or 2 (execute).

12. **Wall-clock timeout shared across all round trips.** A slow greeting reduces the remaining budget for PING or EVAL.

13. **No TLS.** Raw TCP only. TLS-wrapped instances will fail at the greeting step.

14. **No allocation guard.** A crafted server could send `msgLen = 0xFFFFFFFF` in the size prefix, causing a ~4 GB Uint8Array allocation attempt.

---

## Edge Cases

### Non-Tarantool service on port 3301

If the service does not send a greeting starting with `"Tarantool "`, `isTarantool: false` is returned with `success: true`. The `/connect` endpoint skips PING. The `/eval` and `/sql` endpoints return `success: false` with `error: "Server is not Tarantool"`.

### Greeting shorter than 128 bytes

`readExact` accumulates chunks until 128 bytes or EOF. If the socket closes early, the buffer is shorter than expected. `parseGreeting` runs on whatever was received (missing lines produce empty strings), and `isTarantool` will be false if line 1 is truncated.

### Schema version changes during DDL

Tarantool increments `IPROTO_SCHEMA_VERSION` in response headers after any DDL operation. The `/connect` endpoint reports the current schema version but does not act on it. This is safe for a probe tool.

### Tarantool 1.x

The greeting format and IPROTO framing are the same in Tarantool 1.x. PING behaves identically.

---

## Wire Examples

### POST /api/tarantool/connect -- success

Request:
```json
{ "host": "tarantool.example.com", "port": 3301, "timeout": 10000 }
```

Response:
```json
{
  "success": true,
  "host": "tarantool.example.com",
  "port": 3301,
  "rtt": 23,
  "connectTime": 8,
  "isTarantool": true,
  "version": "2.11.0",
  "instanceInfo": "(Binary) 9b60bd6c-a8c6-4b09-9e46-003aa0e2b0e0",
  "salt": "AbCdEfGhIjKlMnOpQrSt...",
  "pingSuccess": true,
  "pingStatus": 0,
  "schemaVersion": 42,
  "greetingLine1": "Tarantool 2.11.0 (Binary) 9b60bd6c-a8c6-4b09-9e46-003aa0e2b0e0",
  "message": "Tarantool server detected. Version: 2.11.0. IPROTO_PING succeeded -- server is responsive."
}
```

### POST /api/tarantool/eval -- success

Request:
```json
{ "host": "tarantool.example.com", "expression": "return box.info.version, box.info.uuid" }
```

Response:
```json
{
  "success": true,
  "host": "tarantool.example.com",
  "port": 3301,
  "rtt": 18,
  "version": "2.11.0",
  "expression": "return box.info.version, box.info.uuid",
  "result": ["2.11.0-0-gXXXXXX", "9b60bd6c-a8c6-4b09-9e46-003aa0e2b0e0"]
}
```

### POST /api/tarantool/eval -- auth denied

```json
{
  "success": false,
  "host": "tarantool.example.com",
  "port": 3301,
  "rtt": 15,
  "error": "Execute access to function 'dostring' is denied for user 'guest'",
  "iprotoStatus": 2147483662
}
```

### POST /api/tarantool/sql -- success

Request:
```json
{ "host": "tarantool.example.com", "sql": "SELECT id, name FROM _space LIMIT 3" }
```

Response:
```json
{
  "success": true,
  "host": "tarantool.example.com",
  "port": 3301,
  "rtt": 22,
  "version": "2.11.0",
  "sql": "SELECT id, name FROM _space LIMIT 3",
  "columns": ["id", "name"],
  "rows": [
    { "id": 272, "name": "_schema" },
    { "id": 276, "name": "_space" },
    { "id": 277, "name": "_vspace" }
  ],
  "rowCount": 3
}
```

