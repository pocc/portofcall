# Riak KV — Power User Reference

**Port:** 8087 (default) | **Protocol:** Protocol Buffers Binary | **RFC:** None (proprietary)

Port of Call provides four Riak KV endpoints: connection ping, server info retrieval, key-value GET, and key-value PUT. All endpoints open a direct TCP connection from the Cloudflare Worker to your Riak node using the Protocol Buffers Client (PBC) binary protocol.

---

## API Endpoints

### `POST /api/riak/ping` — Ping probe

Sends an `RpbPingReq` message (code 1) and expects an `RpbPingResp` (code 2). Opens and closes the TCP connection each call.

**POST body:**

| Field     | Type   | Default | Notes |
|-----------|--------|---------|-------|
| `host`    | string | —       | Required |
| `port`    | number | `8087`  | Riak PBC port |
| `timeout` | number | `10000` | Total timeout in ms (max 600000) |

**Success (200):**
```json
{
  "success": true,
  "host": "riak.example.com",
  "port": 8087,
  "message": "Riak node is alive (pong)",
  "rtt": 23
}
```

**Error response (200):**
```json
{
  "success": false,
  "host": "riak.example.com",
  "port": 8087,
  "error": "Riak error response",
  "errorCode": 42,
  "rtt": 15
}
```

**Connection timeout (500):** `{ "success": false, "error": "Connection timeout" }`

**Cloudflare-protected host (403):** `{ "success": false, "error": "...", "isCloudflare": true }`

**Notes:**
- The ping command has no payload — just a 5-byte message (4-byte length + 1-byte code).
- RTT includes connection setup, message send, and response read time.
- Riak may respond with `RpbErrorResp` (code 0) if the node is in a degraded state.

---

### `POST /api/riak/info` — Server info retrieval

Sends an `RpbGetServerInfoReq` message (code 7) and parses the `RpbGetServerInfoResp` (code 8) protobuf to extract node name and server version.

**POST body:**

| Field     | Type   | Default | Notes |
|-----------|--------|---------|-------|
| `host`    | string | —       | Required |
| `port`    | number | `8087`  | Riak PBC port |
| `timeout` | number | `10000` | Total timeout in ms (max 600000) |

**Success (200):**
```json
{
  "success": true,
  "host": "riak.example.com",
  "port": 8087,
  "node": "riak@127.0.0.1",
  "serverVersion": "2.2.3",
  "rtt": 18
}
```

**No response (200):**
```json
{
  "success": false,
  "host": "riak.example.com",
  "port": 8087,
  "error": "No response — Riak PBC port may not be accessible",
  "rtt": 5
}
```

**Unexpected response code (200):**
```json
{
  "success": false,
  "host": "riak.example.com",
  "port": 8087,
  "error": "Unexpected response code: 42",
  "responseCode": 42,
  "rtt": 12
}
```

**Notes:**
- The `node` field contains the Erlang node name (e.g., `riak@127.0.0.1`).
- The `serverVersion` field is the Riak KV version string (e.g., `2.2.3`).
- If the server sends empty node/version fields, they will be empty strings in the response.
- The protobuf parser is hand-written and minimal — it handles field 1 (node) and field 2 (serverVersion) only.

---

### `POST /api/riak/get` — Get key-value

Sends an `RpbGetReq` message (code 9) and parses the `RpbGetResp` (code 10) to extract the value, content type, and existence status.

**POST body:**

| Field        | Type   | Default | Notes |
|--------------|--------|---------|-------|
| `host`       | string | —       | Required |
| `port`       | number | `8087`  | Riak PBC port |
| `bucket`     | string | —       | Required |
| `key`        | string | —       | Required |
| `bucketType` | string | —       | Optional bucket type (Riak 2.0+) |
| `timeout`    | number | `8000`  | Total timeout in ms (max 600000) |

**Success (200) — key found:**
```json
{
  "success": true,
  "host": "riak.example.com",
  "port": 8087,
  "bucket": "users",
  "key": "alice",
  "found": true,
  "value": "{\"name\":\"Alice\",\"email\":\"alice@example.com\"}",
  "contentType": "application/json",
  "rtt": 14,
  "message": "Key 'alice' found in bucket 'users'"
}
```

**Success (200) — key not found:**
```json
{
  "success": true,
  "host": "riak.example.com",
  "port": 8087,
  "bucket": "users",
  "key": "bob",
  "found": false,
  "rtt": 9,
  "message": "Key 'bob' not found"
}
```

**Riak error (200):**
```json
{
  "success": false,
  "host": "riak.example.com",
  "port": 8087,
  "bucket": "users",
  "key": "alice",
  "error": "Bucket type 'invalid' does not exist",
  "errorCode": 1,
  "rtt": 11
}
```

**Notes:**
- The `value` field is always a UTF-8 decoded string, even if the content type is binary.
- The `contentType` field is extracted from the protobuf `RpbContent` field 2.
- The `found` field is `true` if the response contains a content field, `false` otherwise.
- The `bucketType` field is optional and should only be used with Riak 2.0+ bucket types.
- If the value is binary data (e.g., image, protobuf), the UTF-8 decoding may produce garbage. Use a binary-safe client for non-text values.
- The GET request does not include vclock, siblings are not returned.

**curl example:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/riak/get \
  -H 'Content-Type: application/json' \
  -d '{"host":"riak.example.com","port":8087,"bucket":"users","key":"alice"}' \
  | jq .
```

---

### `POST /api/riak/put` — Put key-value

Sends an `RpbPutReq` message (code 11) with the key, value, and content type, and expects an `RpbPutResp` (code 12).

**POST body:**

| Field         | Type   | Default      | Notes |
|---------------|--------|--------------|-------|
| `host`        | string | —            | Required |
| `port`        | number | `8087`       | Riak PBC port |
| `bucket`      | string | —            | Required |
| `key`         | string | —            | Required |
| `value`       | string | —            | Required |
| `contentType` | string | `text/plain` | Content-Type header |
| `bucketType`  | string | —            | Optional bucket type (Riak 2.0+) |
| `timeout`     | number | `8000`       | Total timeout in ms (max 600000) |

**Success (200):**
```json
{
  "success": true,
  "host": "riak.example.com",
  "port": 8087,
  "bucket": "users",
  "key": "alice",
  "contentType": "application/json",
  "valueSize": 45,
  "rtt": 21,
  "message": "Value stored at 'users/alice'"
}
```

**Riak error (200):**
```json
{
  "success": false,
  "host": "riak.example.com",
  "port": 8087,
  "bucket": "users",
  "key": "alice",
  "error": "Permission denied",
  "errorCode": 2,
  "rtt": 13
}
```

**Notes:**
- The `value` field is always sent as a UTF-8 encoded string. Binary data must be base64-encoded first.
- The `contentType` defaults to `text/plain` if not provided.
- The `valueSize` field is the byte length of the UTF-8 encoded value.
- The PUT request does not include vclock, so concurrent writes may be silently overwritten depending on Riak bucket settings (`allow_mult`).
- The PUT request does not wait for quorum by default — Riak uses the bucket's default `w` value.
- The `RpbPutResp` does not return the stored value or vclock — it's an empty message with code 12.

**curl example:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/riak/put \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "riak.example.com",
    "port": 8087,
    "bucket": "users",
    "key": "alice",
    "value": "{\"name\":\"Alice\",\"email\":\"alice@example.com\"}",
    "contentType": "application/json"
  }' \
  | jq .
```

---

## Protocol Details

### Wire Format

Riak PBC uses a simple length-prefixed binary protocol:

```
+----------------+----------+------------------+
| Length (4B BE) | Code (1B)| Payload (0-N B) |
+----------------+----------+------------------+
```

- **Length (4 bytes, big-endian uint32):** Total message length **excluding** the 4-byte length field itself. Includes the message code and payload.
- **Code (1 byte):** Message type code (see table below).
- **Payload (variable):** Protocol Buffers encoded message, or empty for ping/pong.

**Message Codes:**

| Code | Name                    | Direction       | Payload |
|------|-------------------------|-----------------|---------|
| 0    | `RpbErrorResp`          | Server → Client | Protobuf |
| 1    | `RpbPingReq`            | Client → Server | None |
| 2    | `RpbPingResp`           | Server → Client | None |
| 7    | `RpbGetServerInfoReq`   | Client → Server | None |
| 8    | `RpbGetServerInfoResp`  | Server → Client | Protobuf |
| 9    | `RpbGetReq`             | Client → Server | Protobuf |
| 10   | `RpbGetResp`            | Server → Client | Protobuf |
| 11   | `RpbPutReq`             | Client → Server | Protobuf |
| 12   | `RpbPutResp`            | Server → Client | Protobuf |

**Example ping message:**
```
00 00 00 01 01
^^^^^^^^^^^^ ^^
Length=1     Code=1 (RpbPingReq)
```

**Example pong response:**
```
00 00 00 01 02
^^^^^^^^^^^^ ^^
Length=1     Code=2 (RpbPingResp)
```

### Protobuf Schema (Minimal)

The implementation uses a minimal hand-written protobuf parser that only handles length-delimited (wire type 2) and varint (wire type 0) fields. Complex nested structures are not fully supported.

**RpbErrorResp (code 0):**
```protobuf
message RpbErrorResp {
  required bytes errmsg = 1;  // Error message string
  required uint32 errcode = 2; // Error code
}
```

**RpbGetServerInfoResp (code 8):**
```protobuf
message RpbGetServerInfoResp {
  optional bytes node = 1;           // Erlang node name
  optional bytes server_version = 2; // Riak version string
}
```

**RpbGetReq (code 9):**
```protobuf
message RpbGetReq {
  required bytes bucket = 1;      // Bucket name
  required bytes key = 2;          // Key
  optional bytes type = 5;         // Bucket type (Riak 2.0+)
  // Other fields (r, pr, if_modified, etc.) not implemented
}
```

**RpbGetResp (code 10):**
```protobuf
message RpbGetResp {
  repeated RpbContent content = 1; // List of siblings (only first parsed)
  optional bytes vclock = 3;        // Vector clock (not returned)
}

message RpbContent {
  required bytes value = 1;         // Value bytes
  optional bytes content_type = 2;  // MIME type
  // Other fields (charset, encoding, links, usermeta, etc.) not implemented
}
```

**RpbPutReq (code 11):**
```protobuf
message RpbPutReq {
  required bytes bucket = 1;        // Bucket name
  required bytes key = 2;           // Key
  required RpbContent content = 3;  // Value + metadata
  optional bytes type = 5;          // Bucket type (Riak 2.0+)
  // Other fields (vclock, w, dw, pw, return_body, etc.) not implemented
}
```

**RpbPutResp (code 12):**
```protobuf
message RpbPutResp {
  // Empty message — no fields
}
```

### Protobuf Encoding Details

**Varint encoding:**
- Used for integer fields (wire type 0).
- Each byte has a continuation bit (MSB) — if set, another byte follows.
- Values > 2³¹ are handled with unsigned right shift (`>>> 0`) to prevent signed integer overflow.

**Length-delimited encoding:**
- Used for strings/bytes (wire type 2).
- Tag byte: `(fieldNum << 3) | 2`
- Varint length
- Raw bytes

**Example:** Field 1 (bucket) = "users"
```
0A 05 75 73 65 72 73
^^-^^ ^^^^^^^^^^^^^^^^
Tag=10 Length=5  "users"
(field 1, wire type 2)
```

**Tag decoding:**
```
tag = byte value
fieldNum = tag >> 3
wireType = tag & 0x07
```

---

## Known Limitations

1. **No sibling resolution:** GET requests do not handle siblings (multiple conflicting values). Only the first `RpbContent` is returned.

2. **No vclock support:** PUT requests do not include vector clocks, so concurrent writes may be lost depending on bucket `allow_mult` and `last_write_wins` settings.

3. **No quorum parameters:** GET/PUT requests do not support `r`, `w`, `pr`, `pw`, `dw` quorum parameters. Riak uses the bucket's default values.

4. **No secondary indexes (2i):** The implementation does not support querying or setting secondary indexes.

5. **No MapReduce/search:** No support for MapReduce queries or Yokozuna search.

6. **UTF-8 only:** Values are always decoded as UTF-8 strings. Binary data (images, protobufs, etc.) may be corrupted.

7. **Single content type:** PUT requests send a single content type. Multi-value metadata (user metadata, links, indexes) is not supported.

8. **No streaming:** Large values are read into memory in a single `readRiakResponse` call. Very large values (> 10 MB) may cause memory issues or timeouts.

9. **No connection pooling:** Each request opens and closes a new TCP connection. For high-throughput scenarios, connection reuse would improve performance.

10. **Minimal protobuf parser:** The parser only handles wire types 0 (varint) and 2 (length-delimited). Wire types 1 (64-bit), 3/4 (start/end group), and 5 (32-bit) are not implemented.

---

## Security Considerations

1. **No authentication:** Riak PBC does not support authentication. The protocol is unauthenticated TCP.

2. **Plaintext transmission:** All data is sent in plaintext. Values, bucket names, and keys are not encrypted.

3. **Cloudflare detection:** All endpoints check if the target host resolves to a Cloudflare IP and reject the request with HTTP 403.

4. **Timeout bounds:** Timeouts are limited to 0-600000 ms (10 minutes) to prevent resource exhaustion.

5. **Port validation:** Port numbers are validated to be in range 1-65535.

6. **No TLS:** Riak PBC does not support TLS. Use a VPN or SSH tunnel for encrypted connections.

7. **Resource cleanup:** All endpoints use try/finally blocks to ensure sockets are closed and timeouts are cleared, even on error.

---

## Troubleshooting

**"Connection timeout"**
- Firewall blocking port 8087.
- Riak node is down or not listening on PBC port.
- Network latency > timeout value.

**"No response — Riak PBC port may not be accessible"**
- Server accepted connection but sent no data (connection closed by server).
- Riak node is in a degraded state (shutting down, overloaded).

**"Unexpected response code: X"**
- Server sent a message code the implementation does not recognize.
- Riak version mismatch (very old or very new).
- Protocol corruption (network issue, proxy mangling data).

**"Bucket type 'X' does not exist"**
- Specified `bucketType` is not configured in Riak 2.0+.
- Remove the `bucketType` field or create the bucket type on the server.

**"Permission denied" (errorCode 2)**
- Riak security is enabled and the connection is not authenticated.
- Riak PBC does not support authentication — use HTTP API with auth instead.

**Value is corrupted or garbage**
- Value contains binary data (image, protobuf, etc.) that is not valid UTF-8.
- Use a binary-safe client or base64-encode the value before storage.

**GET returns `found: false` but value exists**
- Bucket/key mismatch (case-sensitive).
- Value is in a different bucket type (add `bucketType` parameter).
- Riak node is not fully started (vnodes not ready).

**PUT succeeds but GET returns old value**
- Eventual consistency — wait a few milliseconds and retry.
- Riak cluster is experiencing network partitions or node failures.
- Check Riak logs for vnodes down, handoffs in progress, etc.

---

## Example: Simple KV workflow

**1. Ping the server:**
```bash
curl -X POST https://portofcall.ross.gg/api/riak/ping \
  -H 'Content-Type: application/json' \
  -d '{"host":"riak.example.com","port":8087}' \
  | jq .
```

**2. Get server info:**
```bash
curl -X POST https://portofcall.ross.gg/api/riak/info \
  -H 'Content-Type: application/json' \
  -d '{"host":"riak.example.com","port":8087}' \
  | jq .
```

**3. Store a value:**
```bash
curl -X POST https://portofcall.ross.gg/api/riak/put \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "riak.example.com",
    "port": 8087,
    "bucket": "test",
    "key": "hello",
    "value": "world",
    "contentType": "text/plain"
  }' \
  | jq .
```

**4. Retrieve the value:**
```bash
curl -X POST https://portofcall.ross.gg/api/riak/get \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "riak.example.com",
    "port": 8087,
    "bucket": "test",
    "key": "hello"
  }' \
  | jq .
```

**5. Check for a non-existent key:**
```bash
curl -X POST https://portofcall.ross.gg/api/riak/get \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "riak.example.com",
    "port": 8087,
    "bucket": "test",
    "key": "nonexistent"
  }' \
  | jq .
```

---

## References

- **Riak KV Docs:** https://riak.com/
- **PBC Protocol:** https://docs.riak.com/riak/kv/latest/developing/api/protocol-buffers/
- **Protobuf Wire Format:** https://protobuf.dev/programming-guides/encoding/
- **Basho GitHub (archived):** https://github.com/basho/riak

---

**Version:** 1.0 (2026-02-18)
