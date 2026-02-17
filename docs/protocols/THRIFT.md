# Apache Thrift — Port of Call Reference

Port of Call connects to Thrift servers via raw TCP (`cloudflare:sockets`) and exposes two REST endpoints. Only the **Thrift Binary Protocol** is supported. Both endpoints speak Binary Protocol over either **Framed** or **Buffered** transport. Implementation: `src/worker/thrift.ts`.

---

## Wire format

### Binary Protocol message header

All integers are **big-endian**.

```
[4 bytes]  versionAndType  = 0x80010000 | messageType
[4 bytes]  method name length
[N bytes]  method name (UTF-8)
[4 bytes]  seqId
[...    ]  args struct (see below)
```

`versionAndType` high 16 bits = `0x8001` (version 1 strict). Low 8 bits = message type:

| Value | Name      |
|-------|-----------|
| 1     | CALL      |
| 2     | REPLY     |
| 3     | EXCEPTION |
| 4     | ONEWAY    |

### Struct encoding

A struct is a sequence of typed fields terminated by a stop byte:

```
for each field:
  [1 byte]   field type
  [2 bytes]  field id (int16, big-endian)
  [N bytes]  field value (type-dependent)
[1 byte]   0x00  ← T_STOP
```

### Framed transport (default)

```
[4 bytes big-endian]  frame length (bytes that follow)
[frame length bytes]  Binary Protocol message
```

### Buffered transport

No length prefix — raw Binary Protocol message sent directly. On receive, a single `reader.read()` call is made; there is no guarantee of message completeness.

---

## Type codes

| Code | Name    | Wire size         |
|------|---------|-------------------|
| 0    | T_STOP  | (terminates struct) |
| 2    | T_BOOL  | 1 byte            |
| 3    | T_BYTE  | 1 byte            |
| 4    | T_DOUBLE| 8 bytes (IEEE 754 big-endian) |
| 6    | T_I16   | 2 bytes           |
| 8    | T_I32   | 4 bytes           |
| 10   | T_I64   | 8 bytes           |
| 11   | T_STRING| 4-byte length + UTF-8 bytes |
| 12   | T_STRUCT| nested fields + T_STOP |
| 13   | T_MAP   | 1-byte key type + 1-byte val type + 4-byte count + entries |
| 14   | T_SET   | 1-byte elem type + 4-byte count + elements |
| 15   | T_LIST  | 1-byte elem type + 4-byte count + elements |

---

## Endpoints

### POST `/api/thrift/probe`

Sends a single Thrift CALL message with an **empty args struct** (no arguments) and parses the server's response.

**Request:**
```json
{
  "host": "thrift.example.com",
  "port": 9090,
  "method": "getName",
  "transport": "framed",
  "timeout": 15000
}
```

| Field       | Default      | Notes |
|-------------|--------------|-------|
| `host`      | required     | Missing → HTTP 400 |
| `port`      | `9090`       | |
| `method`    | `"getName"`  | Method name sent in the CALL message |
| `transport` | `"framed"`   | `"framed"` or `"buffered"`. Any value that is not `"buffered"` uses framed. |
| `timeout`   | `15000`      | Applied to both connection and read (shared outer race) |

**Response (success, 200):**
```json
{
  "success": true,
  "message": "Thrift RPC call to getName() completed",
  "host": "thrift.example.com",
  "port": 9090,
  "transport": "framed",
  "protocol": "binary",
  "response": {
    "messageType": "REPLY",
    "method": "getName",
    "seqId": 1,
    "isException": false,
    "fieldCount": 1,
    "fields": [
      { "id": 0, "type": 11, "typeName": "STRING", "value": "MyThriftService" }
    ]
  }
}
```

**Response (failure, 500):**
```json
{
  "success": false,
  "error": "Connection timeout"
}
```

**Response (missing host, 400):**
```json
{ "error": "Missing required parameter: host" }
```

---

### POST `/api/thrift/call`

Sends a single Thrift CALL message with **user-supplied typed arguments** and parses the server's response.

**Request:**
```json
{
  "host": "thrift.example.com",
  "port": 9090,
  "method": "getUser",
  "args": [
    { "id": 1, "type": "i32", "value": "42" },
    { "id": 2, "type": "string", "value": "alice" }
  ],
  "transport": "framed",
  "timeout": 15000
}
```

| Field       | Default    | Notes |
|-------------|------------|-------|
| `host`      | required   | Missing → HTTP 400 |
| `method`    | required   | Missing → HTTP 400 |
| `port`      | `9090`     | |
| `args`      | `[]`       | Array of `{id, type, value}` objects. Omit for zero-arg calls. |
| `transport` | `"framed"` | `"framed"` or `"buffered"` |
| `timeout`   | `15000`    | |

**Arg `type` values accepted:**

| JSON type string | Thrift type | Notes |
|-----------------|-------------|-------|
| `"bool"`        | T_BOOL      | `"true"` or `"1"` → true, anything else → false |
| `"byte"` / `"i8"` | T_BYTE    | `parseInt(value) & 0xFF` |
| `"i16"`         | T_I16       | `parseInt(value)` |
| `"i32"`         | T_I32       | `parseInt(value)` |
| `"i64"`         | T_I64       | `BigInt(value)` |
| `"double"`      | T_DOUBLE    | `parseFloat(value)` |
| `"string"`      | T_STRING    | UTF-8 encoded |
| anything else   | T_STRING    | Fallback — arg treated as string |

Complex container types (T_LIST, T_MAP, T_SET, T_STRUCT) **cannot be sent** via REST args — only scalar and string types are supported by `encodeValue`.

**Response (success, 200):**
```json
{
  "success": true,
  "message": "Thrift RPC: getUser() returned REPLY",
  "host": "thrift.example.com",
  "port": 9090,
  "response": {
    "messageType": "REPLY",
    "method": "getUser",
    "seqId": 1,
    "isException": false,
    "fieldCount": 3,
    "fields": [
      { "id": 1, "type": 8, "typeName": "I32",    "value": "42" },
      { "id": 2, "type": 11, "typeName": "STRING", "value": "alice" },
      { "id": 3, "type": 2,  "typeName": "BOOL",   "value": "true" }
    ]
  }
}
```

Note: `/call` response omits `transport` and `protocol` fields (present in `/probe` but not `/call`).

**Thrift application exception response:**
```json
{
  "success": true,
  "response": {
    "messageType": "EXCEPTION",
    "isException": true,
    "exceptionMessage": "Unknown method: getUser",
    "fields": [
      { "id": 1, "type": 11, "typeName": "STRING", "value": "Unknown method: getUser" },
      { "id": 2, "type": 8,  "typeName": "I32",    "value": "1" }
    ]
  }
}
```

An application-level EXCEPTION is still returned as HTTP 200 with `success: true`. The error is indicated by `isException: true` and `exceptionMessage`.

---

## Response parsing details

### Field values are always strings

`readFieldValue` returns all values as strings regardless of type. Numeric fields are stringified: `"42"`, `"3.14"`, `"true"`. No JSON numbers or booleans in the `fields` array.

### Nested T_STRUCT parsing

When a field has type T_STRUCT (12), the parser recursively reads nested fields and formats them as `"fieldId:value, fieldId:value"` inside `{}`. However, the offset after parsing a nested struct is computed as `offset + 100` (hardcoded), not the actual consumed bytes. **Any nested struct longer than 100 bytes will cause incorrect parsing of subsequent fields.**

### Container truncation

T_LIST, T_MAP, and T_SET elements are capped at **20 items** during response parsing. Elements beyond 20 are silently dropped.

### T_VOID not recognized

Type code 1 (T_VOID) has no case in `readFieldValue` and returns `<unknown type 1>`.

### seqId not validated

Both endpoints always send `seqId = 1` in the CALL message. The response `seqId` is parsed and returned but never compared against the request.

### Frame size limit

`readFramedResponse` rejects frames with `frameLen < 0 || frameLen > 1048576` (1 MB). Frames exceeding 1 MB cause a thrown error and HTTP 500.

---

## Common gotchas

**Both endpoints are POST-only.** There is no GET form for either endpoint. A GET request will fail at JSON parsing.

**`transport` detection is not-`"buffered"`.** Any transport value other than the exact string `"buffered"` enables framed transport. `"Framed"`, `"FRAMED"`, `""`, `undefined` all use framed.

**Buffered read is single-chunk.** Non-framed transport does one `reader.read()` call. If the server's REPLY spans multiple TCP segments, only the first chunk is received. This is safe for small responses on local networks but unreliable otherwise.

**No Compact or JSON Protocol.** The wire format is always Thrift Binary Protocol version 1 (`0x80010000`). Servers configured for Compact Protocol will cause a parse error (`Unsupported Thrift protocol version: 0x...`).

**No multiplexed transport.** The multiplexed protocol wraps method names as `"ServiceName:methodName"`. The server may need this if it hosts multiple services under one port.

**Args struct encoding.** The request `args` array is encoded into a Thrift struct with each `{id, type, value}` becoming a field. Field order in the struct follows array order. Field IDs must match the server's IDL definition.

**HTTP 500 vs 400.** Missing `host` or missing `method` (in `/call`) → HTTP 400. All connection/parse errors → HTTP 500.

---

## Thrift exception type codes

Application exceptions (messageType=EXCEPTION) encode `field 2` as an i32 exception type:

| Value | Name                 |
|-------|----------------------|
| 0     | UNKNOWN              |
| 1     | UNKNOWN_METHOD       |
| 2     | INVALID_MESSAGE_TYPE |
| 3     | WRONG_METHOD_NAME    |
| 4     | BAD_SEQUENCE_ID      |
| 5     | MISSING_RESULT       |
| 6     | INTERNAL_ERROR       |
| 7     | PROTOCOL_ERROR       |

---

## curl examples

```bash
# Probe a Thrift server (calls getName() with no args)
curl -s https://portofcall.ross.gg/api/thrift/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"thrift.example.com","port":9090}' | jq .

# Probe with a specific method name and short timeout
curl -s https://portofcall.ross.gg/api/thrift/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"thrift.example.com","method":"getVersion","timeout":5000}' | jq .

# Probe using buffered (non-framed) transport
curl -s https://portofcall.ross.gg/api/thrift/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"thrift.example.com","transport":"buffered"}' | jq .

# Call with a single i32 argument
curl -s https://portofcall.ross.gg/api/thrift/call \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "thrift.example.com",
    "method": "getUser",
    "args": [{"id": 1, "type": "i32", "value": "42"}]
  }' | jq .response

# Call with mixed argument types
curl -s https://portofcall.ross.gg/api/thrift/call \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "thrift.example.com",
    "method": "createEntry",
    "args": [
      {"id": 1, "type": "string", "value": "mykey"},
      {"id": 2, "type": "i64",    "value": "1708819200000"},
      {"id": 3, "type": "bool",   "value": "true"}
    ]
  }' | jq .

# Check if exception was returned
curl -s https://portofcall.ross.gg/api/thrift/call \
  -H 'Content-Type: application/json' \
  -d '{"host":"thrift.example.com","method":"bogusMethod","args":[]}' \
  | jq '{isException: .response.isException, msg: .response.exceptionMessage}'
```

---

## Local testing

```bash
# Python simple Thrift server (requires thrift package)
pip install thrift

# Or use Docker for a known Thrift service (e.g. HBase Thrift gateway)
docker run -d -p 9090:9090 harisekhon/hbase

# Probe it
curl -s https://portofcall.ross.gg/api/thrift/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"YOUR_HOST","port":9090,"method":"getTableNames"}' | jq .
```
