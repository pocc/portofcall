# Hazelcast IMDG Protocol — Power-User Reference

## Overview

**Hazelcast** is an open-source in-memory data grid (IMDG) platform providing distributed caching, computing, and messaging. This implementation supports the **Hazelcast Open Binary Client Protocol** (frame-based protocol used in Hazelcast 4.x and 5.x) over raw TCP sockets.

**Default Port:** 5701

**Protocol Family:** Binary RPC with multi-frame message structure

**Supported Operations:**
- Cluster authentication and health checks (PING)
- Distributed Map (IMap): GET, PUT, REMOVE, SIZE
- Distributed Queue (IQueue): OFFER, POLL, SIZE
- Distributed Set (ISet): ADD, CONTAINS, REMOVE
- Publish/Subscribe Topic (ITopic): PUBLISH

---

## API Endpoints

### 1. Probe / Authentication Check

**POST** `/api/hazelcast/probe`

Connects to a Hazelcast cluster, performs authentication, and returns cluster metadata.

#### Request Body

```json
{
  "host": "hazelcast.example.com",
  "port": 5701,
  "username": "",
  "password": "",
  "clusterName": "dev",
  "timeout": 10000
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `host` | string | Yes | — | Hostname or IP address of Hazelcast node |
| `port` | number | No | 5701 | TCP port (1-65535) |
| `username` | string | No | `""` | Authentication username (empty for dev clusters) |
| `password` | string | No | `""` | Authentication password |
| `clusterName` | string | No | `"dev"` | Hazelcast cluster name |
| `timeout` | number | No | 10000 | Total timeout in milliseconds (connection + auth) |

#### Response

```json
{
  "success": true,
  "isHazelcast": true,
  "version": "5.0",
  "clusterName": "dev",
  "serverVersion": "5.0.0",
  "authStatus": 0,
  "authStatusLabel": "authenticated",
  "rtt": 87,
  "isCloudflare": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | True if authentication succeeded |
| `isHazelcast` | boolean | True if server responded with valid Hazelcast protocol frames |
| `version` | string | Client protocol version (not server version) |
| `clusterName` | string | Cluster name from server response |
| `serverVersion` | string | Hazelcast server version string (e.g., "5.0.0") |
| `authStatus` | number | Status code: 0=authenticated, 1=credentials failed, 2=serialization mismatch, 3=not allowed |
| `authStatusLabel` | string | Human-readable auth status |
| `rtt` | number | Round-trip time in milliseconds |
| `error` | string | Error message (only present on failure) |
| `isCloudflare` | boolean | True if host resolved to Cloudflare IP (connection blocked) |

**Auth Status Codes:**
- `0` — Authenticated successfully
- `1` — Credentials failed (wrong username/password)
- `2` — Serialization version mismatch
- `3` — Not allowed in cluster

---

### 2. Map Get

**POST** `/api/hazelcast/map-get`

Retrieves a value from a distributed IMap by key.

#### Request Body

```json
{
  "host": "localhost",
  "port": 5701,
  "username": "",
  "password": "",
  "clusterName": "dev",
  "timeout": 12000,
  "mapName": "my-cache",
  "key": "user:123"
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `mapName` | string | Yes | — | Name of the distributed map |
| `key` | string | Yes | — | Key to retrieve |
| (other fields) | — | — | — | Same as probe endpoint |

#### Response

```json
{
  "success": true,
  "mapName": "my-cache",
  "key": "user:123",
  "value": "John Doe",
  "size": 42,
  "isCloudflare": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | True if operation succeeded |
| `mapName` | string | Map name (echoed from request) |
| `key` | string | Key (echoed from request) |
| `value` | string \| null | Retrieved value (null if key not found) |
| `size` | number | Total number of entries in the map (from MAP_SIZE query) |
| `error` | string | Error message (only present on failure) |

**Value Encoding:**
- If value is valid UTF-8 text, it's decoded as a string
- If value is binary or decoding fails, it's returned as hex dump (max 64 bytes)
- Empty payload or zero-length value returns `null`

---

### 3. Map Set (Put)

**POST** `/api/hazelcast/map-set`

Inserts or updates a key-value pair in a distributed IMap.

#### Request Body

```json
{
  "host": "localhost",
  "port": 5701,
  "mapName": "my-cache",
  "key": "user:123",
  "value": "John Doe",
  "ttl": 300000
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `mapName` | string | Yes | — | Name of the distributed map |
| `key` | string | Yes | — | Key to set |
| `value` | string | Yes | — | Value to store (UTF-8 encoded) |
| `ttl` | number | No | 0 | Time-to-live in milliseconds (0 = no expiry) |

#### Response

```json
{
  "success": true,
  "mapName": "my-cache",
  "key": "user:123",
  "set": true,
  "previousValue": "Jane Doe",
  "rtt": 34
}
```

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | True if PUT succeeded |
| `set` | boolean | True if key was set |
| `previousValue` | string \| null | Previous value for the key (null if key was new) |
| `rtt` | number | Round-trip time in milliseconds |

---

### 4. Map Delete (Remove)

**POST** `/api/hazelcast/map-delete`

Removes a key from a distributed IMap.

#### Request Body

```json
{
  "host": "localhost",
  "port": 5701,
  "mapName": "my-cache",
  "key": "user:123"
}
```

#### Response

```json
{
  "success": true,
  "mapName": "my-cache",
  "key": "user:123",
  "deleted": true,
  "removedValue": "John Doe",
  "rtt": 28
}
```

| Field | Type | Description |
|-------|------|-------------|
| `deleted` | boolean | True if key was removed |
| `removedValue` | string \| null | Value of removed key (null if key didn't exist) |

---

### 5. Queue Offer

**POST** `/api/hazelcast/queue-offer`

Adds an item to a distributed IQueue.

#### Request Body

```json
{
  "host": "localhost",
  "port": 5701,
  "queueName": "tasks",
  "value": "process-order-456",
  "offerTimeoutMs": 5000
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `queueName` | string | Yes | — | Name of the queue |
| `value` | string | Yes | — | Item to add (UTF-8 encoded) |
| `offerTimeoutMs` | number | No | 5000 | Offer timeout in milliseconds |

#### Response

```json
{
  "success": true,
  "queueName": "tasks",
  "value": "process-order-456",
  "offered": true,
  "sizeBefore": 3,
  "sizeAfter": 4,
  "rtt": 42
}
```

| Field | Type | Description |
|-------|------|-------------|
| `offered` | boolean | True if item was added (false if queue full or timeout) |
| `sizeBefore` | number | Queue size before offer |
| `sizeAfter` | number | Queue size after offer |

---

### 6. Queue Poll

**POST** `/api/hazelcast/queue-poll`

Retrieves and removes the head of a distributed IQueue.

#### Request Body

```json
{
  "host": "localhost",
  "port": 5701,
  "queueName": "tasks",
  "pollTimeoutMs": 1000
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `queueName` | string | Yes | — | Name of the queue |
| `pollTimeoutMs` | number | No | 1000 | Poll timeout in milliseconds |

#### Response

```json
{
  "success": true,
  "queueName": "tasks",
  "value": "process-order-456",
  "rtt": 38
}
```

| Field | Type | Description |
|-------|------|-------------|
| `value` | string \| null | Retrieved item (null if queue empty or timeout) |

---

### 7. Set Add

**POST** `/api/hazelcast/set-add`

Adds a value to a distributed ISet.

#### Request Body

```json
{
  "host": "localhost",
  "port": 5701,
  "setName": "active-users",
  "value": "user:123"
}
```

#### Response

```json
{
  "success": true,
  "setName": "active-users",
  "value": "user:123",
  "result": true,
  "operation": "add",
  "rtt": 29
}
```

| Field | Type | Description |
|-------|------|-------------|
| `result` | boolean | True if value was added (false if already present) |
| `operation` | string | Operation name ("add", "contains", "remove") |

---

### 8. Set Contains

**POST** `/api/hazelcast/set-contains`

Checks if a value exists in a distributed ISet.

#### Request Body

```json
{
  "host": "localhost",
  "port": 5701,
  "setName": "active-users",
  "value": "user:123"
}
```

#### Response

```json
{
  "success": true,
  "setName": "active-users",
  "value": "user:123",
  "result": true,
  "operation": "contains",
  "rtt": 26
}
```

| Field | Type | Description |
|-------|------|-------------|
| `result` | boolean | True if value exists in set |

---

### 9. Set Remove

**POST** `/api/hazelcast/set-remove`

Removes a value from a distributed ISet.

#### Request Body

```json
{
  "host": "localhost",
  "port": 5701,
  "setName": "active-users",
  "value": "user:123"
}
```

#### Response

```json
{
  "success": true,
  "setName": "active-users",
  "value": "user:123",
  "result": true,
  "operation": "remove",
  "rtt": 31
}
```

| Field | Type | Description |
|-------|------|-------------|
| `result` | boolean | True if value was removed (false if not present) |

---

### 10. Topic Publish

**POST** `/api/hazelcast/topic-publish`

Publishes a message to a distributed ITopic (pub/sub).

#### Request Body

```json
{
  "host": "localhost",
  "port": 5701,
  "topicName": "notifications",
  "message": "System maintenance scheduled"
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `topicName` | string | Yes | — | Name of the topic |
| `message` | string | Yes | — | Message to publish (UTF-8 encoded) |

#### Response

```json
{
  "success": true,
  "topicName": "notifications",
  "message": "System maintenance scheduled",
  "rtt": 22
}
```

**Note:** Topic publish is fire-and-forget. Success only indicates the server acknowledged receipt, not that any subscribers received it.

---

## Wire Protocol Details

### Frame Structure (Frame-Based Protocol)

Hazelcast 4.x and 5.x use a **multi-frame message model**. Each frame has a 6-byte header:

```
Offset | Size | Field        | Type         | Description
-------|------|--------------|--------------|----------------------------------
0      | 4    | frame_length | int32 LE     | Total frame size (includes header)
4      | 2    | flags        | uint16 LE    | Frame control flags
6      | N    | content      | byte[]       | Frame payload
```

**Minimum frame size:** 22 bytes (6-byte header + 16-byte initial frame preamble)

### Frame Flags

Flags are a 16-bit bitmask (little-endian):

| Bit | Hex    | Name                  | Description |
|-----|--------|-----------------------|-------------|
| 15  | 0x8000 | BEGIN_FRAME           | First frame of message fragment |
| 14  | 0x4000 | END_FRAME             | Last frame of message fragment |
| 13  | 0x2000 | IS_FINAL              | Last frame of entire message |
| 12  | 0x1000 | BEGIN_DATA_STRUCTURE  | Start of nested structure |
| 11  | 0x0800 | END_DATA_STRUCTURE    | End of nested structure |
| 10  | 0x0400 | IS_NULL               | Null value indicator |
| 9   | 0x0200 | IS_EVENT              | Event message (server-initiated) |
| 8   | 0x0100 | BACKUP_AWARE          | Backup-aware operation |
| 7   | 0x0080 | BACKUP_EVENT          | Backup event |

**Unfragmented message flags:** `0xE000` (BEGIN_FRAME | END_FRAME | IS_FINAL)

All requests in this implementation use single-frame unfragmented messages.

### Initial Frame Preamble

The first 16 bytes of every initial frame's content area contain:

```
Offset | Size | Field          | Type      | Description
-------|------|----------------|-----------|---------------------------
6      | 4    | message_type   | int32 LE  | Operation identifier
10     | 8    | correlation_id | int64 LE  | Request/response pairing
18     | 4    | partition_id   | int32 LE  | Target partition (-1 = any)
```

**Total initial frame header size:** 22 bytes (6 frame + 16 preamble)

Operation-specific payload starts at byte offset 22.

### Message Types

Message types are 24-bit identifiers encoded as `(service_id << 16) | method_id`:

| Hex      | Name                  | Service | Method | Description |
|----------|-----------------------|---------|--------|-------------|
| 0x000100 | CLIENT_AUTHENTICATION | 0       | 0x01   | Authenticate client |
| 0x000D00 | CLIENT_PING           | 0       | 0x0D   | Heartbeat / connectivity check |
| 0x010100 | MAP_PUT               | 1       | 0x01   | Insert/update map entry |
| 0x010200 | MAP_GET               | 1       | 0x02   | Retrieve map entry |
| 0x010300 | MAP_REMOVE            | 1       | 0x03   | Delete map entry |
| 0x012E00 | MAP_SIZE              | 1       | 0x2E   | Get map size |
| 0x030200 | QUEUE_OFFER           | 3       | 0x02   | Add to queue |
| 0x030400 | QUEUE_POLL            | 3       | 0x04   | Remove from queue |
| 0x030800 | QUEUE_SIZE            | 3       | 0x08   | Get queue size |
| 0x040100 | TOPIC_PUBLISH         | 4       | 0x01   | Publish to topic |
| 0x060100 | SET_ADD               | 6       | 0x01   | Add to set |
| 0x060200 | SET_CONTAINS          | 6       | 0x02   | Check set membership |
| 0x060300 | SET_REMOVE            | 6       | 0x03   | Remove from set |

### Authentication Payload

**CLIENT_AUTHENTICATION (0x000100)** request payload:

```
Field                | Type        | Encoding
---------------------|-------------|----------------------------------
clusterName          | string      | uint32 LE length + UTF-8 bytes
username             | string      | uint32 LE length + UTF-8 bytes
password             | string      | uint32 LE bytes
clientUUID           | byte[16]    | 16 zero bytes (placeholder UUID)
clientType           | string      | "Hazelcast.CSharpClient"
clientVersion        | string      | "5.0.0"
serializationVersion | uint8       | 1 (binary format version)
clientName           | string      | "PortOfCall"
```

**Response payload:**

```
Offset | Field         | Type   | Description
-------|---------------|--------|----------------------------------
0      | status        | uint8  | 0=success, 1=creds fail, 2=version mismatch, 3=not allowed
1      | serverVersion | string | Hazelcast server version (if authenticated)
N      | clusterName   | string | Cluster name (if authenticated)
```

### Data Encoding

**Strings** are length-prefixed:
```
uint32 LE length (bytes) + UTF-8 encoded bytes
```

**Integers:**
- `int32`: 4 bytes, little-endian
- `int64`: 8 bytes, little-endian
- `uint32`: 4 bytes, little-endian

**Booleans:** 1 byte (0x00 = false, non-zero = true)

**Map/Queue/Set values:** Encoded as length-prefixed byte arrays (same as strings)

---

## Connection Flow

### 1. Probe / Authentication

```
Client → Server: PING frame (correlation ID 1)
Server → Client: PING response (correlation ID 1)
Client → Server: AUTH frame (correlation ID 2)
Server → Client: AUTH response (correlation ID 2, status byte)
```

**Timing:**
- `rtt` starts at TCP connection open, ends at AUTH response received
- Each operation has independent timeout (default 10s probe, 12s operations)

### 2. Map GET

```
Client → Server: AUTH frame (correlation ID 1)
Server → Client: AUTH response (correlation ID 1)
Client → Server: MAP_SIZE frame (correlation ID 2)
Server → Client: MAP_SIZE response (int32 size)
Client → Server: MAP_GET frame (correlation ID 3)
Server → Client: MAP_GET response (length-prefixed value or empty)
```

### 3. Queue OFFER

```
Client → Server: AUTH frame (correlation ID 1)
Server → Client: AUTH response (correlation ID 1)
Client → Server: QUEUE_SIZE frame (correlation ID 2)
Server → Client: QUEUE_SIZE response (int32 before size)
Client → Server: QUEUE_OFFER frame (correlation ID 3)
Server → Client: QUEUE_OFFER response (boolean success)
Client → Server: QUEUE_SIZE frame (correlation ID 4)
Server → Client: QUEUE_SIZE response (int32 after size)
```

---

## Known Limitations and Quirks

### Protocol Implementation Gaps

1. **No connection pooling / reuse** — Every API call opens a new TCP connection, authenticates, performs the operation, and closes. This contradicts Hazelcast best practices (RFC 7540-style persistent connections). Adds ~20-50ms overhead per operation.

2. **Single-frame requests only** — No support for multi-frame fragmented messages. Large values (>4MB) will fail silently or cause parsing errors.

3. **No Smart Client routing** — Client doesn't fetch partition table or cluster topology. All requests go to the single specified node (unaware routing). Partition ID is hardcoded to `-1` (random partition).

4. **No backup acknowledgment** — `BACKUP_AWARE` flag is not used. No confirmation that writes replicated to backup nodes.

5. **No event listeners** — Cannot subscribe to map/queue/set events (add/remove/update notifications). Topic publish is fire-and-forget with no subscriber feedback.

6. **No response message type validation** — Responses are parsed by correlation ID only. If server sends wrong response type, parsing may succeed with garbage data.

7. **String-only values** — All map/queue/set values are UTF-8 strings. No support for:
   - Java serialization
   - Portable serialization
   - IdentifiedDataSerializable
   - JSON / Compact serialization
   - Binary byte arrays (will be hex-dumped)

8. **No NEAR_CACHE** — All reads hit the cluster. No client-side caching.

9. **No distributed locks** — ILock operations not implemented.

10. **No distributed executors** — Cannot run server-side tasks.

11. **No SQL queries** — No support for Hazelcast SQL or Predicate queries on maps.

12. **No transaction support** — Cannot batch operations into atomic transactions.

### Frame Parsing Edge Cases

13. **Frame length sanity check: 4MB max** — Frames larger than 4MB are rejected in `readFrame()` to prevent memory exhaustion. Hazelcast protocol allows up to 2^31-1 bytes.

14. **Timeout shared across operations** — In multi-step operations (e.g., queue-offer with size checks), the total timeout is shared. If AUTH takes 5s with a 6s timeout, remaining operations have 1s.

15. **Empty response treated as null** — Zero-length payload interpreted as null/missing value. Cannot distinguish between:
    - Key not found
    - Key exists with empty string value
    - Server error returning empty payload

16. **Hex dump fallback** — If value decoding fails (invalid UTF-8), first 64 bytes are returned as hex string. Full binary value is lost.

17. **No correlation ID overflow protection** — Correlation IDs increment from 1. In long-running sessions (not applicable here due to no pooling), could theoretically overflow int64.

18. **Poll timeout is additive** — `pollTimeoutMs` is added to socket read timeout. With `timeout=12000` and `pollTimeoutMs=10000`, total wait is up to 22 seconds.

### Authentication

19. **No TLS/SSL** — All communication in plaintext over TCP. Username/password sent unencrypted.

20. **No mutual authentication** — Client doesn't verify server certificate or cluster identity.

21. **Credentials sent on every connection** — No session token or JWT reuse.

22. **Empty credentials allowed** — Many dev clusters have auth disabled. Implementation defaults to empty username/password.

### Error Handling

23. **Generic connection errors** — Cannot distinguish between:
    - Network unreachable
    - Port closed
    - TLS required but not used
    - Firewall timeout
    All return "Connection failed" or "Connection timeout".

24. **No server exception details** — If server throws Java exception, response is empty or contains raw stack trace bytes (decoded as hex).

25. **Silent TTL handling** — MAP_PUT accepts TTL in milliseconds, but no confirmation that TTL was set. Cannot query TTL of existing keys.

26. **Queue capacity not enforced** — QUEUE_OFFER may return false (queue full), but implementation doesn't surface bounded queue limits.

### Response Validation

27. **No CRC/checksum** — Frame integrity not verified. Corrupted frames may parse as valid with garbage data.

28. **Flags ignored in responses** — Response frame flags are not checked. BEGIN_FRAME/END_FRAME/IS_FINAL bits are assumed but not validated.

29. **Partition ID in responses ignored** — Responses may include partition routing info, but it's discarded.

### Cloudflare Detection

30. **Cloudflare DNS check** — If `host` resolves to Cloudflare IPs (1.1.1.1/1.0.0.1), connection is blocked with error message. Prevents accidental probes of Cloudflare services.

31. **No Cloudflare detection for queue/set/topic endpoints** — Only probe and map operations check for Cloudflare.

---

## Error Responses

### HTTP-Level Errors

| Status | Condition | Response Body |
|--------|-----------|---------------|
| 400 | Missing required field | `{"success": false, "error": "host is required"}` |
| 400 | Invalid port range | `{"success": false, "error": "Port must be between 1 and 65535"}` |
| 400 | Invalid JSON body | `{"success": false, "error": "Invalid JSON body"}` |
| 400 | Cloudflare detected | `{"success": false, "error": "...", "isCloudflare": true}` |
| 405 | Wrong HTTP method | `{"error": "Method not allowed"}` (GET/PUT/DELETE rejected) |

### Protocol-Level Errors

All protocol errors return HTTP 200 with `success: false`:

```json
{
  "success": false,
  "error": "Connection timeout",
  "rtt": 10002
}
```

**Common error messages:**
- `"Connection timeout"` — TCP connect or socket read timeout
- `"Connection failed"` — Socket closed unexpectedly or DNS resolution failed
- `"Authentication failed: credentials failed"` — Wrong username/password
- `"Authentication failed: not allowed in cluster"` — Client not whitelisted
- `"No MAP_GET response received"` — Server closed connection without response
- `"No ack received"` — Topic publish didn't get acknowledgment frame

---

## Example Usage

### Probe Hazelcast Cluster

```bash
curl -X POST https://portofcall.ross.gg/api/hazelcast/probe \
  -H "Content-Type: application/json" \
  -d '{
    "host": "hazelcast.example.com",
    "port": 5701,
    "clusterName": "production"
  }'
```

**Response:**
```json
{
  "success": true,
  "isHazelcast": true,
  "clusterName": "production",
  "serverVersion": "5.0.2",
  "authStatus": 0,
  "authStatusLabel": "authenticated",
  "rtt": 42
}
```

### Cache Operations (Map)

```bash
# Write to cache
curl -X POST https://portofcall.ross.gg/api/hazelcast/map-set \
  -H "Content-Type: application/json" \
  -d '{
    "host": "localhost",
    "port": 5701,
    "mapName": "user-sessions",
    "key": "session:abc123",
    "value": "user_id=789&expires=1640000000",
    "ttl": 3600000
  }'

# Read from cache
curl -X POST https://portofcall.ross.gg/api/hazelcast/map-get \
  -H "Content-Type": application/json" \
  -d '{
    "host": "localhost",
    "port": 5701,
    "mapName": "user-sessions",
    "key": "session:abc123"
  }'

# Delete from cache
curl -X POST https://portofcall.ross.gg/api/hazelcast/map-delete \
  -H "Content-Type: application/json" \
  -d '{
    "host": "localhost",
    "port": 5701,
    "mapName": "user-sessions",
    "key": "session:abc123"
  }'
```

### Queue Operations (Task Queue)

```bash
# Add task to queue
curl -X POST https://portofcall.ross.gg/api/hazelcast/queue-offer \
  -H "Content-Type: application/json" \
  -d '{
    "host": "localhost",
    "port": 5701,
    "queueName": "email-queue",
    "value": "send_email:user@example.com:Welcome",
    "offerTimeoutMs": 5000
  }'

# Process task from queue
curl -X POST https://portofcall.ross.gg/api/hazelcast/queue-poll \
  -H "Content-Type: application/json" \
  -d '{
    "host": "localhost",
    "port": 5701,
    "queueName": "email-queue",
    "pollTimeoutMs": 1000
  }'
```

### Set Operations (Unique Values)

```bash
# Add to set
curl -X POST https://portofcall.ross.gg/api/hazelcast/set-add \
  -H "Content-Type: application/json" \
  -d '{
    "host": "localhost",
    "port": 5701,
    "setName": "logged-in-users",
    "value": "user:456"
  }'

# Check membership
curl -X POST https://portofcall.ross.gg/api/hazelcast/set-contains \
  -H "Content-Type: application/json" \
  -d '{
    "host": "localhost",
    "port": 5701,
    "setName": "logged-in-users",
    "value": "user:456"
  }'

# Remove from set
curl -X POST https://portofcall.ross.gg/api/hazelcast/set-remove \
  -H "Content-Type: application/json" \
  -d '{
    "host": "localhost",
    "port": 5701,
    "setName": "logged-in-users",
    "value": "user:456"
  }'
```

### Pub/Sub (Topic)

```bash
curl -X POST https://portofcall.ross.gg/api/hazelcast/topic-publish \
  -H "Content-Type: application/json" \
  -d '{
    "host": "localhost",
    "port": 5701,
    "topicName": "system-alerts",
    "message": "Deployment completed successfully"
  }'
```

---

## Security Considerations

1. **No encryption** — All data transmitted in plaintext. Use VPN or SSH tunnel for sensitive data.

2. **No authentication verification** — Username/password sent unencrypted. Anyone sniffing network traffic can capture credentials.

3. **No authorization** — Once authenticated, full access to all maps/queues/sets. No per-collection ACLs.

4. **Denial of service risk** — No rate limiting. Can exhaust Hazelcast cluster with rapid requests.

5. **Data injection** — String values are not sanitized. Malicious clients can inject control characters or exploit Java deserialization (if cluster uses custom serializers).

6. **Information disclosure** — Error messages may leak server versions, cluster names, internal IPs.

7. **Cloudflare detection is not security** — Detects Cloudflare DNS IPs to prevent accidental queries, but can be bypassed by using direct IPs.

---

## Performance Notes

- **Latency:** ~20-50ms overhead per operation (TCP handshake + auth + close)
- **Throughput:** Limited by connection overhead. ~20-50 ops/sec for small values.
- **Memory:** Each operation allocates frames in memory. 4MB max frame size.
- **Concurrent requests:** Not supported. One operation per connection.

**Optimization opportunities:**
- Add connection pooling (reuse authenticated sessions)
- Implement pipelining (multiple operations on single connection)
- Use smart client routing (direct partition targeting)
- Batch operations (multi-PUT/GET)

---

## Comparison with Other Distributed Caches

| Feature | Hazelcast | Redis | Memcached | Etcd |
|---------|-----------|-------|-----------|------|
| Protocol | Binary frames | RESP2/RESP3 | Binary key-value | gRPC/HTTP |
| Default Port | 5701 | 6379 | 11211 | 2379 |
| Data Structures | Map, Queue, Set, Topic | 15+ types | Key-value only | Key-value |
| Clustering | Native | Sentinel/Cluster | Client-side | Raft consensus |
| Transactions | Yes | Yes | No | Yes (MVCC) |
| Pub/Sub | Topic | Channels | No | Watch |
| TTL Support | Per-entry | Per-key | Per-item | Lease-based |
| Query Support | SQL, Predicates | RediSearch | No | Range/prefix |
| Auth Method | Username/password | Password/ACL | SASL (optional) | mTLS |
| TLS Support | Yes (not implemented here) | Yes | No | Yes |
| Connection Pooling | Required | Required | Optional | HTTP/2 streams |

---

## Troubleshooting

### "Connection timeout" after 10 seconds

**Cause:** Hazelcast server not responding on specified port.

**Solutions:**
- Verify server is running: `nc -zv <host> 5701`
- Check firewall rules allow inbound TCP on port 5701
- Increase `timeout` parameter in request

### "Authentication failed: credentials failed"

**Cause:** Wrong username/password or cluster requires authentication.

**Solutions:**
- Check Hazelcast server config for `security` section
- Try empty credentials (`username: ""`, `password: ""`) for dev clusters
- Verify cluster name matches server config

### "No MAP_GET response received"

**Cause:** Server closed connection without sending response.

**Solutions:**
- Check Hazelcast server logs for exceptions
- Verify map name exists (case-sensitive)
- Ensure cluster is healthy (not in safe-mode or split-brain)

### Value returned as hex dump instead of string

**Cause:** Value is binary data or uses non-UTF-8 encoding (Java serialization).

**Solutions:**
- This implementation only supports UTF-8 strings
- Use Hazelcast Management Center to inspect serialized data
- Configure cluster to use Portable or JSON serialization

### "Queue offered: false" but no error

**Cause:** Queue is bounded and full, or offer timeout expired.

**Solutions:**
- Check queue capacity: `QueueConfig.setMaxSize()`
- Increase `offerTimeoutMs` parameter
- Consume items with `queue-poll` to free space

---

## References

- **Official Docs:** https://docs.hazelcast.com/hazelcast/latest/clients/java
- **Protocol Spec:** https://github.com/hazelcast/hazelcast-client-protocol
- **Frame Protocol:** https://docs.hazelcast.org/docs/protocol/1.0-developer-preview/client-protocol.html
- **Java Client (reference impl):** https://github.com/hazelcast/hazelcast/tree/master/hazelcast/src/main/java/com/hazelcast/client/impl/protocol
- **Python Client (frame format):** https://github.com/hazelcast/hazelcast-client-protocol/blob/master/binary/util.py

---

## Changelog

**2026-02-18** — Initial power-user documentation with all 10 endpoints, wire protocol details, 31 known limitations.
