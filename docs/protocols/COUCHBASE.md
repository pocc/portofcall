# Couchbase — Implementation Reference

**Protocol:** Memcached binary protocol (RFC-informal, [BinaryProtocolRevamped](https://github.com/memcached/memcached/wiki/BinaryProtocolRevamped))
**Implementation:** `src/worker/couchbase.ts`
**Port:** 11210 (Couchbase KV Engine, binary protocol over TCP)
**Routes:**
- `POST /api/couchbase/ping` — NOOP health check
- `POST /api/couchbase/version` — server version probe
- `POST /api/couchbase/stats` — server statistics (multi-packet)
- `POST /api/couchbase/get` — key-value GET
- `POST /api/couchbase/set` — key-value SET
- `POST /api/couchbase/delete` — key-value DELETE
- `POST /api/couchbase/incr` — atomic INCREMENT / DECREMENT

---

## Binary Protocol Overview

Couchbase Server's data plane uses the memcached binary protocol (also called the KV Engine protocol). This is distinct from the Couchbase REST API on port 8091 and the query service on port 8093. Standard memcached servers also speak this binary protocol, typically on port 11211.

### Header Format (24 bytes)

Every request and response begins with a fixed 24-byte header.

**Request header:**

```
 Byte/     0       |       1       |       2       |       3       |
    /              |               |               |               |
   |0 1 2 3 4 5 6 7|0 1 2 3 4 5 6 7|0 1 2 3 4 5 6 7|0 1 2 3 4 5 6 7|
   +---------------+---------------+---------------+---------------+
  0| Magic (0x80)  | Opcode        | Key length                    |
   +---------------+---------------+---------------+---------------+
  4| Extras length | Data type     | vBucket ID                    |
   +---------------+---------------+---------------+---------------+
  8| Total body length                                             |
   +---------------+---------------+---------------+---------------+
 12| Opaque                                                        |
   +---------------+---------------+---------------+---------------+
 16| CAS                                                           |
   |                                                               |
   +---------------+---------------+---------------+---------------+
```

**Response header:**

Identical layout except:
- Byte 0: Magic = `0x81`
- Bytes 6-7: Status code (not vBucket ID)

### Magic Bytes

| Value  | Meaning         |
|--------|-----------------|
| `0x80` | Request packet  |
| `0x81` | Response packet |

### Body Layout

The body follows the 24-byte header and always has this structure:

```
+------------------+-------------------+-------------------+
| Extras           | Key               | Value             |
| (extrasLength B) | (keyLength B)     | (remaining B)     |
+------------------+-------------------+-------------------+
```

`Total body length = extrasLength + keyLength + valueLength`

The value length is implicit: `bodyLength - extrasLength - keyLength`.

---

## Opcodes

| Hex    | Name        | Extras (req) | Extras (resp) | Key (req) | Key (resp) | Value (req) | Value (resp) |
|--------|-------------|--------------|---------------|-----------|------------|-------------|--------------|
| `0x00` | GET         | 0 B          | 4 B (flags)   | required  | 0 B        | none        | document     |
| `0x01` | SET         | 8 B          | 0 B           | required  | 0 B        | document    | none         |
| `0x04` | DELETE      | 0 B          | 0 B           | required  | 0 B        | none        | none         |
| `0x05` | INCREMENT   | 20 B         | 0 B           | required  | 0 B        | none        | 8 B (value)  |
| `0x06` | DECREMENT   | 20 B         | 0 B           | required  | 0 B        | none        | 8 B (value)  |
| `0x07` | QUIT        | 0 B          | 0 B           | none      | none       | none        | none         |
| `0x0a` | NOOP        | 0 B          | 0 B           | none      | none       | none        | none         |
| `0x0b` | VERSION     | 0 B          | 0 B           | none      | none       | none        | version str  |
| `0x10` | STAT        | 0 B          | 0 B           | optional  | per-stat   | none        | per-stat     |
| `0x20` | SASL LIST   | 0 B          | 0 B           | none      | none       | none        | mech list    |
| `0x21` | SASL AUTH   | 0 B          | 0 B           | mechanism | none       | credentials | challenge    |
| `0x22` | SASL STEP   | 0 B          | 0 B           | mechanism | none       | response    | challenge    |

### SET Extras (8 bytes)

```
 Offset  Size   Field
 0       4      Flags  (arbitrary 32-bit integer, stored and returned unchanged)
 4       4      Expiration (seconds; 0 = no expiry; >= 30 days interpreted as Unix timestamp)
```

### INCREMENT / DECREMENT Extras (20 bytes)

```
 Offset  Size   Field
 0       8      Delta (64-bit unsigned big-endian)
 8       8      Initial value (64-bit unsigned big-endian, used if key doesn't exist)
 16      4      Expiration (seconds; 0 = no expiry)
```

### GET Response Extras (4 bytes)

```
 Offset  Size   Field
 0       4      Flags (echoed from the SET that stored this key)
```

---

## Status Codes

| Hex      | Name                     | When returned |
|----------|--------------------------|---------------|
| `0x0000` | Success                  | Operation completed |
| `0x0001` | Key not found            | GET/DELETE/INCR/DECR on missing key |
| `0x0002` | Key exists               | ADD on existing key, or CAS mismatch |
| `0x0003` | Value too large          | Value exceeds `max_item_size` (default 1 MB) |
| `0x0004` | Invalid arguments        | Malformed extras, missing required fields |
| `0x0005` | Item not stored          | REPLACE/APPEND/PREPEND on missing key |
| `0x0006` | Non-numeric value        | INCR/DECR on non-numeric string |
| `0x0007` | Wrong vBucket            | Couchbase-specific: key does not belong to this vBucket |
| `0x0020` | Authentication error     | SASL AUTH failed |
| `0x0021` | Authentication continue  | SASL multi-step: send SASL STEP next |
| `0x0081` | Unknown command          | Opcode not supported |
| `0x0082` | Out of memory            | Server cannot allocate memory |
| `0x0083` | Not supported            | Command recognized but not supported |
| `0x0084` | Internal error           | Server-side error |
| `0x0085` | Busy                     | Server is too busy |
| `0x0086` | Temporary failure        | Transient error, retry later |

---

## STAT Protocol

STAT uses a multi-packet response pattern. The server sends one response packet per stat key-value pair. The terminal packet has `keyLength = 0` and `bodyLength = 0`.

```
Client:  [STAT request, key="" (all stats)]
Server:  [STAT response, key="pid", value="1234"]
Server:  [STAT response, key="uptime", value="86400"]
Server:  [STAT response, key="version", value="7.6.1"]
...
Server:  [STAT response, key="", body=empty]     <-- terminator
```

Each individual response body has the layout `extras + key + value`. For STAT, extras is typically 0 bytes.

---

## SASL Authentication

Couchbase Server requires SASL authentication before any data operations on the KV port (11210). Standard memcached servers with `-S` also require SASL.

### Handshake Flow

```
Client:  SASL LIST MECHS  (opcode 0x20)
Server:  "PLAIN SCRAM-SHA1 SCRAM-SHA256 SCRAM-SHA512"

Client:  SASL AUTH  (opcode 0x21, key="PLAIN", value="\0username\0password")
Server:  Status 0x0000 (success) or 0x0020 (auth error)
```

### PLAIN Mechanism

The SASL PLAIN credential payload is:

```
\0<username>\0<password>
```

Three fields separated by NUL bytes: authorization identity (empty), authentication identity (username), password.

### SCRAM-SHA Mechanisms

SCRAM-SHA is a multi-step challenge-response protocol:

1. Client sends `SASL AUTH` with key `SCRAM-SHA256` and value containing the client-first-message
2. Server responds with status `0x0021` (Authentication continue) and the server-first-message
3. Client sends `SASL STEP` with key `SCRAM-SHA256` and value containing the client-final-message
4. Server responds with status `0x0000` (Success) and the server-final-message

---

## Couchbase Ports Reference

| Port  | Service                  | Protocol |
|-------|--------------------------|----------|
| 8091  | Cluster Manager REST API | HTTP     |
| 8092  | Views (CAPI)             | HTTP     |
| 8093  | Query (N1QL)             | HTTP     |
| 8094  | Search (FTS)             | HTTP     |
| 8095  | Analytics                | HTTP     |
| 8096  | Eventing                 | HTTP     |
| 11207 | KV Engine (TLS)          | Binary   |
| 11210 | KV Engine (plaintext)    | Binary   |
| 11211 | Standard memcached       | Binary/Text |
| 18091 | Cluster Manager (TLS)    | HTTPS    |
| 18092 | Views (TLS)              | HTTPS    |
| 18093 | Query (TLS)              | HTTPS    |
| 18094 | Search (TLS)             | HTTPS    |
| 18095 | Analytics (TLS)          | HTTPS    |

---

## API Endpoints

### NOOP Ping

```
POST /api/couchbase/ping
Content-Type: application/json
```

```json
{ "host": "couchbase.example.com", "port": 11210, "timeout": 10000 }
```

`port` defaults to `11210`. `timeout` (ms) defaults to `10000`.

**Success response:**

```json
{
  "success": true,
  "host": "couchbase.example.com",
  "port": 11210,
  "message": "NOOP ping successful",
  "opaque": "matched",
  "rtt": 42
}
```

The `opaque` field verifies that the server echoed the opaque value from the request (`0xDEADBEEF`). A mismatch indicates a protocol anomaly (load balancer, proxy, or out-of-order response).

---

### Version

```
POST /api/couchbase/version
Content-Type: application/json
```

```json
{ "host": "couchbase.example.com", "port": 11210, "timeout": 10000 }
```

**Success response:**

```json
{
  "success": true,
  "host": "couchbase.example.com",
  "port": 11210,
  "version": "7.6.1-enterprise",
  "rtt": 38
}
```

The `version` string is the raw value from the server. Couchbase appends `-enterprise` or `-community`. Standard memcached returns a simple version like `1.6.23`.

---

### Stats

```
POST /api/couchbase/stats
Content-Type: application/json
```

```json
{ "host": "couchbase.example.com", "port": 11210, "timeout": 10000 }
```

**Success response:**

```json
{
  "success": true,
  "host": "couchbase.example.com",
  "port": 11210,
  "stats": {
    "pid": "1234",
    "uptime": "86400",
    "version": "7.6.1",
    "curr_items": "500000",
    "total_connections": "1024",
    "cmd_get": "10000000",
    "cmd_set": "500000",
    "get_hits": "9500000",
    "get_misses": "500000",
    "bytes": "268435456",
    "ep_kv_size": "268435456",
    "vb_active_num": "1024"
  },
  "statCount": 12,
  "rtt": 85
}
```

The implementation reads up to 500 stat key-value pairs. Couchbase Server returns significantly more stats than standard memcached, including `ep_*` (eventually persistent engine) and `vb_*` (vBucket) metrics.

---

### GET

```
POST /api/couchbase/get
Content-Type: application/json
```

```json
{
  "host": "couchbase.example.com",
  "port": 11210,
  "key": "user::12345",
  "timeout": 10000
}
```

**Success response:**

```json
{
  "success": true,
  "host": "couchbase.example.com",
  "port": 11210,
  "key": "user::12345",
  "rtt": 5,
  "value": "{\"name\":\"Alice\",\"email\":\"alice@example.com\"}",
  "flags": 0
}
```

**Key not found:**

```json
{
  "success": false,
  "host": "couchbase.example.com",
  "port": 11210,
  "key": "user::99999",
  "rtt": 3,
  "error": "Key not found",
  "statusCode": 1
}
```

---

### SET

```
POST /api/couchbase/set
Content-Type: application/json
```

```json
{
  "host": "couchbase.example.com",
  "port": 11210,
  "key": "session::abc",
  "value": "{\"userId\":42,\"created\":1708123456}",
  "timeout": 10000
}
```

**Success response:**

```json
{
  "success": true,
  "host": "couchbase.example.com",
  "port": 11210,
  "key": "session::abc",
  "rtt": 6,
  "message": "Key stored successfully",
  "valueLength": 35
}
```

SET always stores unconditionally (upsert). Flags default to `0`, expiry defaults to `0` (no expiration).

---

### DELETE

```
POST /api/couchbase/delete
Content-Type: application/json
```

```json
{
  "host": "couchbase.example.com",
  "port": 11210,
  "key": "session::abc",
  "timeout": 10000
}
```

**Success response:**

```json
{
  "success": true,
  "host": "couchbase.example.com",
  "port": 11210,
  "key": "session::abc",
  "rtt": 4,
  "message": "Key deleted successfully"
}
```

Returns `statusCode: 1` (Key not found) if the key does not exist.

---

### INCREMENT / DECREMENT

```
POST /api/couchbase/incr
Content-Type: application/json
```

```json
{
  "host": "couchbase.example.com",
  "port": 11210,
  "key": "counter::page_views",
  "delta": 1,
  "initialValue": 0,
  "expiry": 0,
  "operation": "increment",
  "timeout": 10000
}
```

| Field          | Type   | Default       | Notes |
|----------------|--------|---------------|-------|
| `key`          | string | --            | Required |
| `delta`        | number | `1`           | Amount to add/subtract. Must be non-negative. |
| `initialValue` | number | `0`           | Value to set if key does not exist. |
| `expiry`       | number | `0`           | TTL in seconds. `0` = no expiry. |
| `operation`    | string | `"increment"` | `"increment"` or `"decrement"` |

**Success response:**

```json
{
  "success": true,
  "host": "couchbase.example.com",
  "port": 11210,
  "key": "counter::page_views",
  "rtt": 3,
  "operation": "increment",
  "delta": 1,
  "newValue": 42,
  "newValueStr": "42"
}
```

The response value is a 64-bit unsigned integer encoded as big-endian in the binary protocol. `newValueStr` provides the string representation for values exceeding JavaScript's `Number.MAX_SAFE_INTEGER`.

---

## curl Quick Reference

```bash
BASE='https://portofcall.example.com'

# NOOP health check
curl -s $BASE/api/couchbase/ping \
  -d '{"host":"couchbase.example.com"}'

# Server version
curl -s $BASE/api/couchbase/version \
  -d '{"host":"couchbase.example.com"}'

# Server statistics
curl -s $BASE/api/couchbase/stats \
  -d '{"host":"couchbase.example.com"}' | jq .stats

# GET a key
curl -s $BASE/api/couchbase/get \
  -d '{"host":"couchbase.example.com","key":"user::12345"}'

# SET a key
curl -s $BASE/api/couchbase/set \
  -d '{"host":"couchbase.example.com","key":"test::1","value":"hello"}'

# DELETE a key
curl -s $BASE/api/couchbase/delete \
  -d '{"host":"couchbase.example.com","key":"test::1"}'

# Atomic counter (increment by 5, starting at 0)
curl -s $BASE/api/couchbase/incr \
  -d '{"host":"couchbase.example.com","key":"hits","delta":5,"initialValue":0}'

# Decrement counter
curl -s $BASE/api/couchbase/incr \
  -d '{"host":"couchbase.example.com","key":"hits","delta":1,"operation":"decrement"}'

# Test against standard memcached (port 11211)
curl -s $BASE/api/couchbase/ping \
  -d '{"host":"memcached.example.com","port":11211}'
```

---

## Local Testing

```bash
# Couchbase Server (Community Edition)
docker run -d --name couchbase -p 8091:8091 -p 11210:11210 couchbase:community

# Initialize cluster (one-time setup via REST API on port 8091):
curl -s -X POST http://localhost:8091/pools/default \
  -d memoryQuota=256

curl -s -X POST http://localhost:8091/settings/web \
  -d port=8091 -d username=Administrator -d password=password

curl -s -X POST http://localhost:8091/pools/default/buckets \
  -d name=default -d ramQuota=128

# After cluster init, NOOP ping should work on 11210:
curl -s localhost:8787/api/couchbase/ping -d '{"host":"localhost"}'

# Standard memcached (binary protocol on 11211)
docker run -d --name mc -p 11211:11211 memcached

# Ping memcached via binary protocol
curl -s localhost:8787/api/couchbase/ping -d '{"host":"localhost","port":11211}'

# Get memcached version via binary protocol
curl -s localhost:8787/api/couchbase/version -d '{"host":"localhost","port":11211}'
```

---

## Cluster Topology (Couchbase-specific)

Couchbase distributes data across nodes using 1024 vBuckets. The cluster map (obtainable from `GET /pools/default/buckets/<name>` on the REST API port 8091) tells clients which node owns which vBuckets.

When a request is sent to the wrong node for a key's vBucket, the server returns status `0x0007` (Wrong vBucket). A production client would:

1. Fetch the cluster map from port 8091
2. Hash the key to determine its vBucket (`CRC32(key) mod 1024`)
3. Look up the owning node in the cluster map
4. Send the request to the correct node on port 11210

This implementation does not perform vBucket routing. All requests go to the specified `host:port` directly. For single-node clusters or standard memcached, this is correct. For multi-node Couchbase clusters, the caller must route to the correct node.

---

## vBucket ID

Bytes 6-7 of the request header contain the vBucket ID (big-endian uint16). In standard memcached this field is reserved (set to 0). In Couchbase, setting this correctly is required for data operations on multi-node clusters.

The current implementation sets vBucket to `0` for all requests, which works for:
- Single-node Couchbase clusters
- Standard memcached servers
- Keys that happen to map to vBucket 0

---

## Wire Format Examples

### NOOP Request (24 bytes)

```
80 0a 00 00  00 00 00 00  00 00 00 00  de ad be ef
00 00 00 00  00 00 00 00
```

- `80` = request magic
- `0a` = NOOP opcode
- `00 00` = key length 0
- `00` = extras length 0
- `00` = data type raw
- `00 00` = vBucket 0
- `00 00 00 00` = body length 0
- `de ad be ef` = opaque
- `00...00` = CAS 0

### GET Request ("user::1", 30 bytes)

```
80 00 00 07  00 00 00 00  00 00 00 07  11 11 11 11
00 00 00 00  00 00 00 00  75 73 65 72  3a 3a 31
```

- Key length = 7 (`"user::1"`)
- Extras length = 0 (GET has no extras)
- Body length = 7 (key only)
- Body = `75 73 65 72 3a 3a 31` = `"user::1"`

### SET Request ("k", "val", flags=0, expiry=3600)

```
80 01 00 01  08 00 00 00  00 00 00 0c  22 22 22 22
00 00 00 00  00 00 00 00  00 00 00 00  00 00 0e 10
6b 76 61 6c
```

- Key length = 1 (`"k"`)
- Extras length = 8 (flags + expiry)
- Body length = 12 (8 extras + 1 key + 3 value)
- Extras: `00 00 00 00` (flags=0) + `00 00 0e 10` (expiry=3600)
- Key: `6b` = `"k"`
- Value: `76 61 6c` = `"val"`

---

## Known Limitations

- **No SASL authentication** -- SASL LIST MECHS, SASL AUTH, and SASL STEP opcodes (0x20, 0x21, 0x22) are not implemented. Couchbase Server requires SASL before data operations; without it, GET/SET/DELETE/INCR will fail with status `0x0020` (Authentication error). NOOP, VERSION, and STAT may still work on some Couchbase versions without authentication.

- **No vBucket routing** -- The vBucket ID is always set to 0. On multi-node Couchbase clusters, requests for keys mapping to other vBuckets will fail with status `0x0007` (Wrong vBucket). The caller must determine the correct vBucket and target node.

- **No TLS** -- Port 11210 is plaintext. Couchbase Server listens for TLS connections on port 11207, which is not supported by this implementation.

- **No bucket selection** -- The `bucket` field in the request body is accepted but unused. On Couchbase Server, bucket selection occurs during SASL authentication (the username maps to the bucket).

- **No CAS (Check-And-Set)** -- The CAS field is always set to 0 in requests. CAS-conditional mutations (optimistic locking) are not supported.

- **64-bit value precision** -- INCREMENT/DECREMENT delta and initial values are limited to 32 bits in the current implementation (JavaScript numbers). Values exceeding 2^32-1 require BigInt support. The response parser correctly handles 64-bit results via `hi * 0x100000000 + lo`, which is precise up to `Number.MAX_SAFE_INTEGER` (2^53-1).

- **Binary values corrupted** -- `TextDecoder`/`TextEncoder` are used for key/value serialization. Binary values (MessagePack, compressed data, protobuf) will be corrupted. Encode binary values as base64 before storing.

- **Single connection per request** -- Each API call opens a new TCP connection, performs one operation, and closes. There is no connection pooling or pipelining.

- **No quiet variants** -- The implementation uses standard opcodes (GET, SET) rather than their quiet variants (GETQ 0x09, SETQ 0x11) that suppress success responses. Quiet variants would be needed for efficient multi-key pipelining.
