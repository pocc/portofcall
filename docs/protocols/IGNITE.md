# Apache Ignite Thin Client Protocol

**Default port:** 10800 (TCP)
**Implementation:** `src/worker/ignite.ts`
**Protocol version negotiated:** 1.7.0 (with fallback probe for 1.6.0, 1.4.0, 1.1.0, 1.0.0)

---

## Overview

Apache Ignite is a distributed in-memory computing platform. The **thin client** protocol (port 10800) provides lightweight, stateless binary access over a persistent TCP connection. It is distinct from the thick (node) client protocol — thin clients do not join the cluster topology, hold no data, and require no Ignite library on the connecting side.

Wire format is entirely **little-endian** binary. Every message begins with a 4-byte length prefix.

---

## 1. Connection Lifecycle

```
TCP connect
  -> Client sends Handshake request
  <- Server sends Handshake response (accept or reject)
  -> Client sends Operation request  (opcode + request_id + payload)
  <- Server sends Operation response (request_id + status + payload)
  ... (pipelined requests on same connection)
TCP close
```

This implementation opens one connection per HTTP request, sends one or two operations (create-cache + data op), then closes. No connection pooling or pipelining.

---

## 2. Message Framing

All messages — both handshake and regular operations — are length-prefixed:

```
+-----------------------------------+
| length  : int32 LE (4 bytes)      |  Number of bytes that follow
| payload : <length> bytes          |
+-----------------------------------+
```

The length field itself is **not** counted in the length value. A 7-byte handshake body has `length = 7`.

---

## 3. Handshake

### 3.1 Client -> Server (Handshake Request)

```
+----------------------------------------------------------+
| length       : int32 LE = 7                              |
| version_major: int16 LE                                  |
| version_minor: int16 LE                                  |
| version_patch: int16 LE                                  |
| client_type  : uint8    = 1 (thin client)                |
+----------------------------------------------------------+
Total: 11 bytes (4 + 7)
```

This implementation always sends `1.7.0` as the requested version. The `/probe` endpoint tests `1.7.0`, `1.6.0`, `1.4.0`, `1.1.0`, `1.0.0` sequentially (one TCP connection each).

No username/password fields are sent. Authentication is not supported.

### 3.2 Server -> Client (Handshake Response -- Accept)

```
+----------------------------------------------------------+
| length          : int32 LE                               |
| success         : uint8 = 1                              |
| node_uuid       : 16 bytes (two LE int64s, MSB then LSB) |
| features_flags  : variable (Ignite 2.7+)                 |
+----------------------------------------------------------+
```

Minimum accepted response: 5 bytes (`length` + `success`). Older Ignite nodes (pre-2.4) send no UUID. Newer nodes send 16+ bytes.

**UUID byte order:** Ignite serializes a Java `UUID` as two 64-bit little-endian values: `getMostSignificantBits()` (LE) followed by `getLeastSignificantBits()` (LE). To recover the canonical UUID string `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` from raw bytes `b[0..15]`:

```
time_low      = b[7] b[6] b[5] b[4]
time_mid      = b[3] b[2]
time_hi_ver   = b[1] b[0]
clock_seq     = b[15] b[14]
node          = b[13] b[12] b[11] b[10] b[9] b[8]

UUID = "{time_low}-{time_mid}-{time_hi_ver}-{clock_seq}-{node}"
```

**Feature flags** (Ignite 2.7+): variable-length bitset immediately after the UUID. This implementation detects their presence (`payloadLength > 17`) but does not decode individual bits.

### 3.3 Server -> Client (Handshake Response -- Reject)

```
+----------------------------------------------------------+
| length          : int32 LE                               |
| success         : uint8 = 0                              |
| server_major    : int16 LE                               |
| server_minor    : int16 LE                               |
| server_patch    : int16 LE                               |
| error_msg_length: int32 LE                               |
| error_msg       : UTF-8 bytes (error_msg_length bytes)   |
+----------------------------------------------------------+
```

The server reports its own supported version in the reject payload. The client should re-negotiate using the server's version. This implementation does not retry; it throws and returns an error JSON response. The `/probe` endpoint is specifically designed for version discovery.

---

## 4. Operation Request/Response Format

After a successful handshake, all traffic uses this framing.

### 4.1 Request

```
+-----------------------------------------------------------+
| length     : int32 LE  (= 2 + 8 + payload.length)        |
| op_code    : int16 LE                                     |
| request_id : int64 LE  (client-assigned, echoed in resp)  |
| payload    : <variable, op-specific>                      |
+-----------------------------------------------------------+
```

This implementation uses sequential request IDs: `BigInt(1)` for the cache-create step and `BigInt(2)` for the data operation. There is no multiplexing; only one request is in-flight per connection at a time.

### 4.2 Response

```
+-----------------------------------------------------------+
| length     : int32 LE                                     |
| request_id : int64 LE  (matches the request)              |
| status     : int32 LE  (0 = success, non-zero = error)    |
| payload    : <variable, op-specific>                      |
+-----------------------------------------------------------+
```

Response payload begins at byte offset 16. `parseResponseHeader()` slices `data[16 .. 4+length]` as payload.

**Status codes (non-exhaustive):**

| Code | Meaning |
|------|---------|
| 0    | Success |
| 1    | Generic failure |
| 2001 | Cache not found |
| 2003 | Cache exists (for create-exclusive ops) |

Non-zero status: payload may contain an error message string (length-prefixed, no type byte). This implementation does not decode the error payload string; only the numeric code is returned.

---

## 5. Type System

Ignite uses a tagged union for typed values. Every value in GET/PUT/REMOVE payloads is prefixed with a 1-byte type code:

| Type Code | Type    | Wire Format After Type Byte |
|-----------|---------|----------------------------|
| 1         | byte    | 1 byte                     |
| 2         | short   | int16 LE                   |
| 3         | int     | int32 LE                   |
| 4         | long    | int64 LE                   |
| 5         | float   | float32 LE (IEEE 754)      |
| 6         | double  | float64 LE (IEEE 754)      |
| 7         | char    | uint16 LE (UTF-16 code unit)|
| 8         | bool    | 1 byte (0=false, 1=true)   |
| 9         | String  | int32 LE length + UTF-8 bytes |
| 101       | null    | (no data bytes)            |

**String encoding (type 9):**

```
+----------------------------------------------------+
| type_code : uint8 = 9                              |
| length    : int32 LE  (byte count, not char count) |
| data      : UTF-8 bytes                            |
+----------------------------------------------------+
```

**Cache name strings** (used in `OP_CACHE_GET_OR_CREATE_WITH_NAME` payload and `OP_CACHE_GET_NAMES` response) are **not type-tagged**: they use only `int32 LE length` + UTF-8 bytes, no type byte prefix.

---

## 6. Cache ID Computation

The Ignite thin client identifies caches by a 32-bit integer ID derived from the cache name using Java's `String.hashCode()` algorithm:

```typescript
function cacheNameToId(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (Math.imul(31, hash) + name.charCodeAt(i)) | 0;
  }
  return hash;
}
```

This operates on UTF-16 code units (matching Java's `char[]`). The result is a signed 32-bit integer, written as `int32 LE` in the cache operation payload.

Note: hash collisions between different cache names are theoretically possible (though vanishingly rare in practice). A collision would cause operations to target the wrong cache.

---

## 7. Operation Codes

| Constant                           | Value | Description |
|------------------------------------|-------|-------------|
| `OP_CACHE_GET`                     | 1000  | Get a value by key |
| `OP_CACHE_PUT`                     | 1001  | Put a key-value pair |
| `OP_CACHE_REMOVE` (REMOVE_KEY)     | 1016  | Remove a key |
| `OP_CACHE_GET_NAMES`               | 1050  | List all cache names |
| `OP_CACHE_GET_OR_CREATE_WITH_NAME` | 1052  | Get or create cache by name |

---

## 8. Implemented Operations

### 8.1 OP_CACHE_GET_NAMES (1050)

**Endpoint:** `POST /api/ignite/list-caches`

**Request payload:** empty (0 bytes)

**Response payload:**

```
+----------------------------------------------------------+
| count   : int32 LE                                       |
| for each cache:                                          |
|   name_length : int32 LE                                 |
|   name        : UTF-8 bytes (no type prefix)             |
+----------------------------------------------------------+
```

### 8.2 OP_CACHE_GET_OR_CREATE_WITH_NAME (1052)

Used internally before every GET/PUT/REMOVE to ensure the named cache exists.

**Request payload:**

```
+----------------------------------------------------------+
| name_length : int32 LE                                   |
| name        : UTF-8 bytes (no type prefix)               |
+----------------------------------------------------------+
```

**Response payload:** empty on success.

**Side effect:** If the cache does not exist, Ignite creates it with default configuration (PARTITIONED, 1 backup). This is a write operation -- do not call it on read-only clusters or in environments where dynamic cache creation is disabled.

### 8.3 OP_CACHE_GET (1000)

**Endpoint:** `POST /api/ignite/cache-get`

**Request payload:**

```
+----------------------------------------------------------+
| cache_id : int32 LE  (Java String.hashCode of name)      |
| flags    : uint8 = 0                                     |
| key      : typed value (type_code + data)                |
+----------------------------------------------------------+
```

**Response payload:**

```
+----------------------------------------------------------+
| value : typed value (type_code + data)                   |
|         type_code = 101 (null) means key not found       |
+----------------------------------------------------------+
```

**Value parsing:** handles type 9 (string) and type 101 (null). Any other type code returns a hex dump of up to 64 bytes.

### 8.4 OP_CACHE_PUT (1001)

**Endpoint:** `POST /api/ignite/cache-put`

**Request payload:**

```
+----------------------------------------------------------+
| cache_id     : int32 LE                                  |
| flags        : uint8 = 0                                 |
| key          : typed value                               |
| value        : typed value                               |
+----------------------------------------------------------+
```

**Response payload:** empty on success.

### 8.5 OP_CACHE_REMOVE / REMOVE_KEY (1016)

**Endpoint:** `POST /api/ignite/cache-remove`

**Request payload:** same layout as OP_CACHE_GET (cache_id + flags + key typed value).

**Response payload:**

```
+----------------------------------------------------------+
| removed : typed bool  (type_code=8)                      |
|           1 = key existed and was removed                |
|           0 = key was not present                        |
+----------------------------------------------------------+
```

---

## 9. Endpoints Reference

### POST /api/ignite/connect

Performs the thin client handshake only; does not send any cache operations.

**Request body:**
```json
{ "host": "192.168.1.10", "port": 10800, "timeout": 10000 }
```
All fields except `host` are optional. Default port: 10800. Default timeout: 10000 ms.

**Response (accepted handshake):**
```json
{
  "success": true,
  "host": "192.168.1.10",
  "port": 10800,
  "rtt": 12,
  "handshake": "accepted",
  "requestedVersion": "1.7.0",
  "nodeId": "550e8400-e29b-41d4-a716-446655440000",
  "featuresPresent": true,
  "payloadSize": 25
}
```

`featuresPresent` and `payloadSize` are included only when `payloadLength > 17` (Ignite 2.7+ feature flags present). `nodeId` is included only when response length >= 21 bytes.

**Response (rejected handshake):**
```json
{
  "success": false,
  "host": "192.168.1.10",
  "port": 10800,
  "rtt": 8,
  "handshake": "rejected",
  "serverVersion": "1.4.0",
  "errorMessage": "Unsupported version."
}
```

**No method check:** this handler accepts any HTTP method (GET, POST, DELETE, etc.).

---

### POST /api/ignite/probe

Tests five protocol versions sequentially to discover which versions the server accepts.

**Request body:**
```json
{ "host": "192.168.1.10", "port": 10800, "timeout": 10000 }
```

**Response:**
```json
{
  "success": true,
  "host": "192.168.1.10",
  "port": 10800,
  "rtt": 280,
  "acceptedVersions": 2,
  "totalProbed": 5,
  "highestAccepted": "1.7.0",
  "nodeId": "550e8400-e29b-41d4-a716-446655440000",
  "versions": [
    { "version": "1.7.0", "accepted": true, "nodeId": "550e8400-..." },
    { "version": "1.6.0", "accepted": true },
    { "version": "1.4.0", "accepted": false, "serverVersion": "1.7.0" },
    { "version": "1.1.0", "accepted": false, "serverVersion": "1.7.0" },
    { "version": "1.0.0", "accepted": false, "serverVersion": "1.7.0" }
  ]
}
```

Versions probed in order: `1.7.0`, `1.6.0`, `1.4.0`, `1.1.0`, `1.0.0`. Each version gets a separate TCP connection with `min(3000, timeout)` ms read timeout. The outer `timeout` is a wall-clock cap for the full sequence.

**No method check:** this handler accepts any HTTP method.

---

### POST /api/ignite/list-caches

**Request body:**
```json
{ "host": "192.168.1.10", "port": 10800, "timeout": 12000 }
```

**Response:**
```json
{
  "success": true,
  "host": "192.168.1.10",
  "port": 10800,
  "caches": ["default", "myCache", "sessionCache"],
  "count": 3
}
```

Default timeout: 12000 ms. Inner readResponse cap: `min(timeout, 6000)` ms.

---

### POST /api/ignite/cache-get

**Request body:**
```json
{
  "host": "192.168.1.10",
  "port": 10800,
  "timeout": 12000,
  "cacheName": "myCache",
  "key": "user:42"
}
```

**Response (key found):**
```json
{
  "success": true,
  "host": "192.168.1.10",
  "port": 10800,
  "cacheName": "myCache",
  "cacheId": -1249261256,
  "key": "user:42",
  "value": "Alice",
  "found": true
}
```

**Response (key not found):**
```json
{
  "success": true,
  "cacheName": "myCache",
  "key": "user:42",
  "value": null,
  "found": false
}
```

**Response (non-string value):** `value` is a hex string of up to 64 bytes of raw payload, space-separated (`"09 00 00 00 07 ..."`).

**Side effect:** calls `OP_CACHE_GET_OR_CREATE_WITH_NAME` before GET. The named cache will be created if it did not exist.

---

### POST /api/ignite/cache-put

**Request body:**
```json
{
  "host": "192.168.1.10",
  "port": 10800,
  "timeout": 12000,
  "cacheName": "myCache",
  "key": "user:42",
  "value": "Alice"
}
```

**Response:**
```json
{
  "success": true,
  "host": "192.168.1.10",
  "port": 10800,
  "cacheName": "myCache",
  "cacheId": -1249261256,
  "key": "user:42",
  "value": "Alice"
}
```

**Caveat:** `key` is validated with `if (!key)`, which rejects the empty string `""`. Same for `value`. This is a known limitation (see Section 12).

---

### POST /api/ignite/cache-remove

**Request body:**
```json
{
  "host": "192.168.1.10",
  "port": 10800,
  "timeout": 12000,
  "cacheName": "myCache",
  "key": "user:42"
}
```

**Response:**
```json
{
  "success": true,
  "host": "192.168.1.10",
  "port": 10800,
  "cacheName": "myCache",
  "cacheId": -1249261256,
  "key": "user:42",
  "removed": true
}
```

`removed: false` means the key was not present; it is not an error condition.

---

## 10. Wire Exchange Example

Successful `cache-get` for key `"x"` in cache `"c"` (annotated hex):

```
--- Handshake request (11 bytes) ---
07 00 00 00          length = 7
01 00                version_major = 1
07 00                version_minor = 7
00 00                version_patch = 0
01                   client_type = THIN

--- Handshake response, accept (21 bytes) ---
11 00 00 00          length = 17
01                   success = 1
[16 bytes]           node UUID (two LE int64s)

--- OP_CACHE_GET_OR_CREATE_WITH_NAME request for cache "c" (15 bytes) ---
0B 00 00 00          length = 11 (2+8+1 name_len + 1 name)
1C 04                op_code = 1052 LE
01 00 00 00 00 00 00 00   request_id = 1
01 00 00 00          name_length = 1
63                   "c"

--- OP_CACHE_GET_OR_CREATE_WITH_NAME response (12 bytes) ---
0C 00 00 00          length = 12
01 00 00 00 00 00 00 00   request_id = 1 echoed
00 00 00 00          status = 0 (success, empty payload)

--- OP_CACHE_GET request for key "x" (24 bytes) ---
14 00 00 00          length = 20 (2+8+4+1+1+4+1)
E8 03                op_code = 1000 LE
02 00 00 00 00 00 00 00   request_id = 2
[4 bytes]            cache_id = cacheNameToId("c") LE
00                   flags = 0
09                   key type = STRING
01 00 00 00          key string length = 1
78                   "x"

--- OP_CACHE_GET response (key found, value = "hello") (23 bytes) ---
13 00 00 00          length = 19
02 00 00 00 00 00 00 00   request_id = 2 echoed
00 00 00 00          status = 0
09                   value type = STRING
05 00 00 00          value length = 5
68 65 6C 6C 6F       "hello"
```

---

## 11. readResponse Behavior and Edge Cases

```typescript
async function readResponse(reader, timeoutMs): Promise<Uint8Array>
```

- Accumulates TCP chunks until `total >= 4 + declared_length`.
- Deadline: `Date.now() + timeoutMs` computed at call entry.
- Returns **partial data** if the socket closes or the deadline expires before a complete message arrives. Callers must handle short responses.
- **Hard cap:** `declared > 1_048_576` throws `"Invalid response length: N"`. A `OP_CACHE_GET_NAMES` response near 1 MB (e.g., a cluster with many long cache names) will fail at this check.
- The returned `Uint8Array` includes the 4-byte length prefix. `parseResponseHeader` therefore reads payload starting at offset 16 (4-byte length + 8-byte request_id + 4-byte status).

---

## 12. Known Limitations

1. **String-only types.** All keys and values are hardcoded to type 9 (String). Non-string values are not writable; non-string responses are returned as hex dumps only.

2. **Empty string rejection.** `cache-put` uses `if (!key)` / `if (!value)`, which rejects `""` (falsy) with HTTP 400, even though empty strings are valid Ignite cache keys and values.

3. **No authentication.** The handshake does not send credentials. Clusters with authentication enabled will reject the handshake.

4. **No TLS.** Uses plaintext TCP only. Ignite SSL (port 10801 by convention) is not supported.

5. **Always calls GET_OR_CREATE.** Every cache-get, cache-put, and cache-remove starts by calling `OP_CACHE_GET_OR_CREATE_WITH_NAME`, which creates the cache if it does not exist. On read-only clusters or when dynamic cache creation is disabled in Ignite config, this first step will fail.

6. **One connection per request.** No connection pooling. Every HTTP call incurs a full TCP + handshake round-trip overhead.

7. **Response size cap at 1 MB.** `readResponse` hard-rejects any declared response length over 1,048,576 bytes.

8. **No error payload decoding.** When an operation returns a non-zero status, the server's error string in the response payload is not decoded or included in the API response.

9. **No pipelining.** The protocol supports concurrent in-flight requests via request IDs, but the implementation sends requests and awaits responses sequentially.

10. **Probe uses sequential connections.** Each version probe opens a new TCP connection rather than reusing one. On high-latency links this multiplies the probe duration.

11. **Cloudflare detection blocks Cloudflare-proxied hosts.** All endpoints perform a Cloudflare IP check and return HTTP 403 for Cloudflare infrastructure IPs.

12. **No method validation on /connect and /probe.** These two handlers accept any HTTP method (GET, PUT, DELETE, etc.).

13. **Shared wall-clock timeout.** For cache-get/put/remove, `timeout` covers: Cloudflare DNS check + TCP connect + handshake + create-cache op + data op. No per-phase timeout budget.

---

## 13. Protocol Version History (Thin Client)

| Version | Notable additions |
|---------|------------------|
| 1.0.0   | Initial thin client protocol |
| 1.1.0   | Batch operations |
| 1.4.0   | Cluster API, service invocation |
| 1.5.0   | Partition awareness |
| 1.6.0   | Expiry policy |
| 1.7.0   | Feature flags bitset in handshake response |
| 1.7.1   | Extended feature flags |

Node UUIDs in the handshake accept response were added in Ignite 2.4 (protocol ~1.4.0). Feature flags were added in Ignite 2.7.0 (protocol 1.7.0).

---

## 14. Bugs Fixed During Review (2026-02-18)

### Bug 1: parseUUID -- incorrect byte order

**Before:**
```typescript
return `${h(3)}${h(2)}${h(1)}${h(0)}-${h(5)}${h(4)}-${h(7)}${h(6)}-${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}`;
```

**After:**
```typescript
return `${h(7)}${h(6)}${h(5)}${h(4)}-${h(3)}${h(2)}-${h(1)}${h(0)}-${h(15)}${h(14)}-${h(13)}${h(12)}${h(11)}${h(10)}${h(9)}${h(8)}`;
```

The Ignite thin client serializes UUIDs as two consecutive little-endian int64 values (MSB long first, LSB long second). The original code applied Windows RPCUUID mixed-endian byte-swapping (reversing only the first 4, first 2, and second 2 bytes within the first half, while reading the second half straight). This produced completely wrong UUID strings. For example, UUID `550e8400-e29b-41d4-a716-446655440000` would have been rendered as `e29b41d4-0084-5500-0000-1644a7665544` -- an entirely different (and invalid) UUID. The fix reverses each 8-byte half independently to correctly reconstruct the canonical UUID representation.

### Bug 2: handleIgniteConnect -- success:true on rejected handshake

The `result` object was initialized with `{ success: true, ... }`. When the server rejected the handshake (success byte = 0), the else branch set `handshake: 'rejected'` but never updated `success` to `false`. The API therefore returned `{ "success": true, "handshake": "rejected" }` -- a self-contradictory response that would cause callers treating `success` as the authoritative status indicator to falsely conclude the connection succeeded.

Fixed by adding `result.success = false;` as the first statement in the handshake-rejected branch.
