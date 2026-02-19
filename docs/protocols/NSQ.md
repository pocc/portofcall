# NSQ — Implementation Reference

**Protocol:** NSQ TCP Protocol (binary framed messaging)
**Implementation:** `src/worker/nsq.ts`
**Default Port:** 4150 (TCP data), 4151 (HTTP API — not used by this implementation)
**Routes:**
- `POST /api/nsq/connect` — Health check, version probe, feature negotiation
- `POST /api/nsq/publish` — PUB (publish a single message to a topic)
- `POST /api/nsq/subscribe` — SUB (subscribe to a topic/channel and collect messages)
- `POST /api/nsq/dpub` — DPUB (deferred publish with delivery delay)
- `POST /api/nsq/mpub` — MPUB (multi-publish, atomic batch of messages)

---

## Wire Protocol Overview

NSQ is a realtime distributed messaging platform designed for operating at scale. It uses a simple framed TCP protocol with minimal handshaking. Used in production by Docker, Stripe, Segment, and other high-volume systems.

### Connection Flow

```
Client → Server: "  V2" (4-byte magic preamble, literal two spaces + "V2")
Client → Server: IDENTIFY\n[4B size BE][JSON metadata]
Server → Client: [4B size BE][4B frame_type BE][data...]
```

All integers are **big-endian**. String commands are newline-terminated. Message bodies are size-prefixed binary frames.

### Frame Types

| Type | Code | Description |
|------|------|-------------|
| FrameTypeResponse | 0 | OK, _heartbeat_, JSON IDENTIFY response |
| FrameTypeError | 1 | Error message (UTF-8 text) |
| FrameTypeMessage | 2 | Binary message frame (timestamp + attempts + ID + body) |

### Command Reference

| Command | Format | Notes |
|---------|--------|-------|
| `IDENTIFY` | `IDENTIFY\n[4B size][JSON]` | Client metadata, feature negotiation |
| `PUB` | `PUB <topic>\n[4B size][body]` | Publish a message |
| `DPUB` | `DPUB <topic> <defer_ms>\n[4B size][body]` | Deferred publish with delivery delay |
| `MPUB` | `MPUB <topic>\n[4B outer_size][4B num][msg...]` | Multi-publish (atomic batch) |
| `SUB` | `SUB <topic> <channel>\n` | Subscribe to a topic/channel |
| `RDY` | `RDY <count>\n` | Flow control: ready to receive N messages |
| `FIN` | `FIN <message_id>\n` | Finish (acknowledge) a message |
| `REQ` | `REQ <message_id> <timeout_ms>\n` | Requeue a message for retry |
| `TOUCH` | `TOUCH <message_id>\n` | Reset message timeout (extend processing time) |
| `NOP` | `NOP\n` | No-op (heartbeat response) |
| `CLS` | `CLS\n` | Close connection gracefully |

---

## Connect — Health Check and Feature Negotiation

### Request

```json
{
  "host": "nsqd.example.com",
  "port": 4150,
  "timeout": 10000
}
```

All fields except `host` are optional. Opens a connection, sends the V2 magic preamble and IDENTIFY command with `feature_negotiation: true`, reads server capabilities, and closes.

### Response

```json
{
  "success": true,
  "host": "nsqd.example.com",
  "port": 4150,
  "rtt": 24,
  "serverInfo": {
    "version": "1.2.1",
    "maxRdyCount": 2500,
    "maxMsgTimeout": 900000,
    "msgTimeout": 60000,
    "tlsRequired": false,
    "deflate": true,
    "snappy": true,
    "authRequired": false,
    "maxDeflateLevel": 6,
    "sampleRate": 0
  }
}
```

`serverInfo` fields:

| Field | Type | Meaning |
|-------|------|---------|
| `version` | string | nsqd version (e.g., "1.2.1") |
| `maxRdyCount` | number | Max value for RDY command (flow control limit) |
| `maxMsgTimeout` | number | Max message timeout (ms) — server will requeue after this |
| `msgTimeout` | number | Default message timeout (ms) if not specified |
| `tlsRequired` | boolean | Server requires TLS upgrade (not supported by this implementation) |
| `deflate` | boolean | Server supports deflate compression |
| `snappy` | boolean | Server supports snappy compression |
| `authRequired` | boolean | Server requires AUTH command (not supported) |
| `maxDeflateLevel` | number | Max deflate compression level (1-9) |
| `sampleRate` | number | Server-side message sampling rate (0-99) |

If the server returns a plain `OK` response instead of JSON, `serverInfo.response` contains the raw text. This happens on older nsqd versions or when `feature_negotiation: false`.

---

## Publish (PUB) — Single Message

### Request

```json
{
  "host": "nsqd.example.com",
  "port": 4150,
  "topic": "events",
  "message": "{\"type\":\"user.signup\",\"user_id\":12345}",
  "timeout": 10000
}
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `host` | Yes | — | nsqd hostname or IP |
| `port` | No | 4150 | nsqd TCP port |
| `topic` | Yes | — | Topic name (1-64 chars: alphanumeric, `.`, `_`, `-`) |
| `message` | No | `""` | Message body (UTF-8 string or empty) |
| `timeout` | No | 10000 | HTTP request timeout (ms) |

### Response

```json
{
  "success": true,
  "message": "Published to topic \"events\"",
  "topic": "events",
  "messageSize": 46,
  "response": "OK"
}
```

`response` contains the server's FrameTypeResponse payload (typically `"OK"`).

### Error Handling

| Error | Cause |
|-------|-------|
| `NSQ IDENTIFY error: ...` | Server rejected client IDENTIFY |
| `NSQ PUB error: E_BAD_TOPIC` | Topic name violates naming rules |
| `NSQ PUB error: E_PUB_FAILED` | Internal server error during publish |
| `Connection timeout` | Network unreachable or slow server |

---

## Deferred Publish (DPUB) — Delayed Delivery

Publishes a message to a topic with a server-side delivery delay. The message will not be delivered to subscribers until the defer time expires.

### Request

```json
{
  "host": "nsqd.example.com",
  "port": 4150,
  "topic": "reminder_queue",
  "message": "Send email reminder to user@example.com",
  "defer_time_ms": 300000,
  "timeout": 10000
}
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `defer_time_ms` | Yes | — | Delivery delay in milliseconds (clamped to 0-3600000) |

`defer_time_ms` is clamped to the range [0, 3600000] (0 to 1 hour). Values above 1 hour are reduced to 3600000 ms.

### Response

```json
{
  "success": true,
  "host": "nsqd.example.com",
  "port": 4150,
  "topic": "reminder_queue",
  "deferMs": 300000,
  "messageBytes": 40,
  "response": "OK",
  "message": "Message queued for delivery to 'reminder_queue' after 300000ms"
}
```

### Use Cases

- Email/SMS reminders on a delay
- Rate limiting with backoff
- Scheduled job execution (poor man's cron)
- Retry queues with progressive delays (combine with REQ command)

---

## Multi-Publish (MPUB) — Atomic Batch

Publishes multiple messages to a topic in a single atomic operation. All messages succeed or all fail.

### Request

```json
{
  "host": "nsqd.example.com",
  "port": 4150,
  "topic": "events",
  "messages": [
    "{\"event\":\"page_view\",\"page\":\"/home\"}",
    "{\"event\":\"click\",\"element\":\"signup_button\"}",
    "{\"event\":\"conversion\",\"value\":29.99}"
  ],
  "timeout": 10000
}
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `messages` | Yes | — | Array of strings (max 100 messages) |

Hard limit: **100 messages** per MPUB request. Larger batches are rejected with a 400 error.

### Response

```json
{
  "success": true,
  "host": "nsqd.example.com",
  "port": 4150,
  "topic": "events",
  "messageCount": 3,
  "totalBytes": 134,
  "response": "OK"
}
```

`totalBytes` is the sum of all message body lengths (UTF-8 encoded). Useful for monitoring bandwidth.

### Wire Format

```
MPUB events\n
[4B outer_size BE]          // Total body size: 4 (num_messages) + sum(4 + msg_len)
[4B num_messages BE]        // Number of messages in batch
[4B msg_0_size BE][msg_0]   // First message
[4B msg_1_size BE][msg_1]   // Second message
...
```

---

## Subscribe (SUB) — Receive Messages

Subscribes to a topic/channel, sends RDY to enable flow control, and collects messages for a fixed duration or until max_messages is reached.

### Request

```json
{
  "host": "nsqd.example.com",
  "port": 4150,
  "topic": "events",
  "channel": "analytics",
  "max_messages": 10,
  "collect_ms": 2000,
  "timeout": 15000
}
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `topic` | Yes | — | Topic to subscribe to |
| `channel` | No | `"portofcall"` | Channel name (isolates consumer groups) |
| `max_messages` | No | 10 | Stop after collecting this many messages |
| `collect_ms` | No | 2000 | Collection window duration (ms) |
| `timeout` | No | 15000 | HTTP request timeout (ms) |

### Response

```json
{
  "success": true,
  "host": "nsqd.example.com",
  "port": 4150,
  "topic": "events",
  "channel": "analytics",
  "messageCount": 3,
  "messages": [
    {
      "messageId": "0a1b2c3d4e5f6789",
      "attempts": 1,
      "body": "{\"event\":\"page_view\",\"page\":\"/home\"}",
      "timestamp": 1708564321000
    },
    {
      "messageId": "0b2c3d4e5f67890a",
      "attempts": 1,
      "body": "{\"event\":\"click\",\"element\":\"signup_button\"}",
      "timestamp": 1708564322150
    },
    {
      "messageId": "0c3d4e5f67890a1b",
      "attempts": 2,
      "body": "{\"event\":\"conversion\",\"value\":29.99}",
      "timestamp": 1708564323450
    }
  ]
}
```

`messages` is truncated to the first 10 collected (even if more were received). This is a hard-coded limit in the implementation to prevent massive response payloads.

### Message Fields

| Field | Type | Description |
|-------|------|-------------|
| `messageId` | string | 16-byte hex message ID (used for FIN/REQ/TOUCH) |
| `attempts` | number | Delivery attempt count (1 on first delivery, increments on REQ) |
| `body` | string | Message payload (UTF-8 decoded) |
| `timestamp` | number | Message creation timestamp (milliseconds since epoch, derived from nsqd's nanosecond timestamp) |

### Channel Isolation

Channels provide **isolated consumer groups**. Each channel maintains its own queue for a topic. Example:

- Topic `events` with channel `analytics` → analytics consumer group
- Topic `events` with channel `email_sender` → email sender consumer group

Both channels receive **all** messages published to `events`, but each channel has independent consumption state. If `analytics` falls behind, it doesn't block `email_sender`.

### Flow Control (RDY)

The implementation sends `RDY <max_messages>` after subscribing. This tells nsqd "send me up to N messages before I send another RDY command." NSQ enforces this strictly — if you set `RDY 5` and receive 5 messages, the server will not send more until you send another RDY command.

This implementation auto-acknowledges all received messages with `FIN <messageId>`, so messages do not requeue.

### Heartbeats

If nsqd sends a `_heartbeat_` frame (FrameTypeResponse with body `"_heartbeat_"`), the client responds with `NOP\n`. This keeps the connection alive during idle periods. Heartbeat interval is configured server-side (default 30 seconds).

---

## Message Frame Wire Format

When nsqd sends a message (FrameTypeMessage = 2), the frame data is binary:

```
[8B timestamp BE]    // Nanoseconds since epoch (int64)
[2B attempts BE]     // Delivery attempt count (uint16)
[16B messageId]      // Hex-encoded ASCII message ID (always 16 printable chars)
[N bytes body]       // Message payload (remainder of frame)
```

Example hex dump of a message frame:

```
00 00 01 8c 9a 3f d2 b8 00  // timestamp (nanoseconds)
00 01                        // attempts = 1
30 61 31 62 32 63 33 64 34 65 35 66 36 37 38 39  // messageId "0a1b2c3d4e5f6789"
7b 22 65 76 65 6e 74 22 3a 22 63 6c 69 63 6b 22 7d  // body: {"event":"click"}
```

The `parseNSQMessage()` function decodes this binary structure. **CRITICAL:** The `rawData` bytes from `readFrame()` MUST be used for FrameTypeMessage frames. Using the text-decoded `data` field corrupts the 8-byte timestamp and 2-byte attempts fields due to invalid UTF-8 sequences.

---

## Topic and Channel Naming Rules

Both topics and channels follow the same naming constraints:

- **Length:** 1-64 characters
- **Character set:** `a-z A-Z 0-9 . _ -` (alphanumeric, dot, underscore, hyphen)
- **Regex:** `/^[a-zA-Z0-9._-]{1,64}$/`

Invalid examples:

- `my topic` (space)
- `user@events` (@ symbol)
- `very_long_topic_name_that_exceeds_the_maximum_allowed_length_limit_for_nsq` (> 64 chars)
- `événements` (non-ASCII)

---

## Error Reference

NSQ error responses (FrameTypeError = 1) contain a UTF-8 error message. Common errors:

| Error | Cause | Solution |
|-------|-------|----------|
| `E_INVALID` | Malformed command | Check command syntax |
| `E_BAD_TOPIC` | Invalid topic name | Use alphanumeric + `.`, `_`, `-` only |
| `E_BAD_CHANNEL` | Invalid channel name | Same rules as topic |
| `E_BAD_MESSAGE` | Empty message body on PUB | Send non-empty message |
| `E_PUB_FAILED` | Server-side publish error | Check nsqd logs; may be disk full or internal error |
| `E_MPUB_FAILED` | MPUB atomic batch failure | All messages rejected; check logs |
| `E_FIN_FAILED` | FIN with invalid message ID | Message already finished or timed out |
| `E_REQ_FAILED` | REQ with invalid message ID or timeout | Message already finished or invalid timeout |
| `E_TOUCH_FAILED` | TOUCH with invalid message ID | Message already finished or timed out |

---

## curl Quick Reference

```bash
BASE='https://portofcall.example.com'

# Health check + feature detection
curl -s $BASE/api/nsq/connect \
  -d '{"host":"nsqd.example.com"}' | jq .serverInfo

# Publish a message
curl -s $BASE/api/nsq/publish \
  -d '{"host":"nsqd.example.com","topic":"events","message":"Hello NSQ"}' | jq .

# Deferred publish (5 minute delay)
curl -s $BASE/api/nsq/dpub \
  -d '{"host":"nsqd.example.com","topic":"reminders","message":"Send email","defer_time_ms":300000}' \
  | jq .

# Multi-publish (atomic batch)
curl -s $BASE/api/nsq/mpub \
  -d '{"host":"nsqd.example.com","topic":"events","messages":["msg1","msg2","msg3"]}' | jq .

# Subscribe and collect messages (2 second window, max 10 messages)
curl -s $BASE/api/nsq/subscribe \
  -d '{"host":"nsqd.example.com","topic":"events","channel":"test","max_messages":10,"collect_ms":2000}' \
  | jq '.messages[].body'

# Subscribe to ephemeral channel (auto-deleted when no consumers)
curl -s $BASE/api/nsq/subscribe \
  -d '{"host":"nsqd.example.com","topic":"events","channel":"temp#ephemeral"}' \
  | jq .messageCount
```

### Ephemeral Channels

Append `#ephemeral` to a channel name to create a temporary channel that is automatically deleted when the last consumer disconnects. Useful for one-off debugging or temporary workers.

Example: `"channel": "debug#ephemeral"` creates a channel named `debug#ephemeral` that is deleted after the subscribe connection closes.

---

## Local Testing

```bash
# Start nsqd with default settings
docker run -d --name nsqd -p 4150:4150 -p 4151:4151 nsqio/nsq /nsqd

# Start nsqlookupd (optional, for distributed clusters)
docker run -d --name nsqlookupd -p 4160:4160 -p 4161:4161 nsqio/nsq /nsqlookupd

# Link nsqd to nsqlookupd
docker stop nsqd && docker rm nsqd
docker run -d --name nsqd -p 4150:4150 -p 4151:4151 \
  nsqio/nsq /nsqd --lookupd-tcp-address=nsqlookupd:4160

# Create a topic via HTTP API (port 4151)
curl -X POST http://localhost:4151/topic/create?topic=test

# Publish via HTTP API
curl -d 'hello world' http://localhost:4151/pub?topic=test

# Stats (HTTP API)
curl -s http://localhost:4151/stats?format=json | jq .topics

# Test with portofcall
curl -s localhost:8787/api/nsq/publish \
  -d '{"host":"localhost","topic":"test","message":"Hello from portofcall"}' | jq .

curl -s localhost:8787/api/nsq/subscribe \
  -d '{"host":"localhost","topic":"test","channel":"portofcall","max_messages":5}' \
  | jq '.messages[].body'
```

---

## Known Limitations

- **No TLS support** — nsqd TLS upgrade (`tls_v1` feature negotiation) is not implemented. `tlsRequired: true` servers will reject connections.
- **No AUTH support** — The AUTH command for nsqd authentication is not implemented. `authRequired: true` servers will reject un-authenticated connections.
- **No compression** — Deflate and Snappy compression (negotiated via IDENTIFY) are not supported. All messages are sent and received uncompressed.
- **No TOUCH, REQ commands** — The subscribe handler auto-FINishes all messages. There is no way to extend message timeouts (TOUCH) or requeue messages for retry (REQ) from this API.
- **Subscribe is one-shot** — The SUB endpoint opens a connection, collects messages for `collect_ms` duration or until `max_messages` is reached, then closes. It is not a long-lived streaming subscription. For continuous consumption, you must poll the endpoint repeatedly.
- **10-message response limit** — Even if `max_messages: 100` and 100 messages are FINished, only the first 10 are returned in `messages[]`. This is a hard-coded limit at line 591 (`messages.slice(0, 10)`).
- **No backpressure control** — RDY is sent once at subscribe time with the full `max_messages` count. There is no dynamic RDY adjustment based on processing latency.
- **Heartbeat NOP only** — Heartbeats are acknowledged with NOP but do not reset any local timers. Long `collect_ms` values (> 30s) combined with server heartbeat intervals may cause unexpected frame parsing if multiple heartbeats occur during collection.
- **No message metadata** — The subscribe response does not include the original nsqd nanosecond timestamp. The `timestamp` field is derived by dividing the 64-bit nanosecond value by 1,000,000 (converted to milliseconds), which may lose sub-millisecond precision.
- **No offset/replay** — NSQ does not support offset-based consumption (unlike Kafka). You cannot rewind to a specific timestamp or message ID. Once a message is FINished, it is permanently acknowledged.

---

## Comparison to Other Message Queues

| Feature | NSQ | Kafka | RabbitMQ | Redis Streams |
|---------|-----|-------|----------|---------------|
| Ordering guarantees | Per-topic (lossy across restarts) | Per-partition (strict) | Per-queue (strict) | Per-stream (strict) |
| Message replay | No | Yes (offsets) | No (ack-based) | Yes (XREAD with ID) |
| Clustering | nsqlookupd (decentralized) | Zookeeper/KRaft | HA mirrored queues | Redis Cluster |
| Delivery semantics | At-least-once | At-least-once (or exactly-once with idempotent producer) | At-least-once (or exactly-once with dedup) | At-least-once |
| Max message size | ~10 MB (configurable) | 1 MB default (configurable) | 128 MB default | 512 MB (String limit) |
| Consumer groups | Channels (isolated queues per topic) | Consumer groups (offset-based) | Competing consumers (shared queue) | Consumer groups (XREADGROUP) |
| Defer/delay | DPUB (native) | No (application-level delay topics) | TTL + dead-letter | No (application-level) |
| Atomic batch | MPUB | ProduceRequest with multiple records | No (batching is client-side) | XADD per message (pipeline for speed) |

Use NSQ when:
- You need **simple, operationally easy** message distribution
- You want **decentralized** topology (no single-point-of-failure coordinator like Zookeeper)
- You need **topic fan-out** with isolated consumer groups (channels)
- You want **built-in deferred delivery** (DPUB)

Avoid NSQ when:
- You need **strict ordering guarantees** (use Kafka partitions)
- You need **message replay** or offset-based consumption (use Kafka or Redis Streams)
- You need **exactly-once delivery** semantics (use Kafka with idempotent producer + transactional consumer)
- You need **large messages** (> 10 MB) — use object storage + message queue with metadata

---

## Performance Characteristics

Based on NSQ architecture and this implementation:

### Publish (PUB, DPUB, MPUB)

- **Latency:** Single-digit milliseconds on local networks (sub-5ms typical)
- **Throughput:** ~10,000 msg/sec per nsqd instance for small messages (< 1 KB)
- **Bottleneck:** IDENTIFY handshake on every connection (this implementation opens a new connection per request)

**Optimization opportunity:** Persistent connection pooling would eliminate IDENTIFY overhead and increase throughput 5-10x. Not implemented here due to Cloudflare Workers stateless execution model.

### Subscribe (SUB)

- **Latency:** Collect window (`collect_ms`) dominates. Minimum latency = `collect_ms`.
- **Throughput:** Limited by `max_messages` and server RDY enforcement. With `max_messages: 100`, theoretical max is 100 messages per `collect_ms` window.
- **Bottleneck:** One-shot connection model. Continuous consumption requires polling the endpoint in a loop.

**Optimization opportunity:** Long-lived WebSocket or SSE connection for streaming message delivery. Not feasible in Cloudflare Workers without Durable Objects.

### Message Size Impact

| Message Size | PUB Latency | MPUB 100-msg Latency | Subscribe Throughput |
|--------------|-------------|----------------------|---------------------|
| 100 bytes | 3-5 ms | 10-15 ms | ~50,000 msg/sec |
| 1 KB | 4-6 ms | 15-25 ms | ~20,000 msg/sec |
| 10 KB | 8-12 ms | 80-120 ms | ~5,000 msg/sec |
| 100 KB | 30-50 ms | 500-800 ms | ~500 msg/sec |
| 1 MB | 200-400 ms | 5-10 sec | ~50 msg/sec |

These are rough estimates based on NSQ's design. Actual performance depends on network latency, nsqd disk I/O (fsync settings), and payload serialization overhead.

---

## Security Considerations

### No Built-In Encryption

NSQ traffic is **plaintext** by default. Message payloads, topic names, and channel names are transmitted unencrypted. Deploy nsqd behind:

- **TLS terminating proxy** (nginx, HAProxy with `mode tcp` + TLS)
- **VPN/WireGuard tunnel** for inter-datacenter nsqd communication
- **Cloudflare Tunnel** or Tailscale for remote access

This implementation does not support nsqd's native TLS upgrade feature (`tls_v1` in IDENTIFY negotiation).

### No Authentication

NSQ has optional AUTH support via the AUTH command (token-based). This implementation does not send AUTH commands. If nsqd is configured with `--auth-http-address`, un-authenticated clients are rejected after IDENTIFY.

**Mitigation:** Deploy nsqd on a private network with firewall rules restricting port 4150 to trusted IPs.

### Topic/Channel Enumeration

There is no API endpoint in this implementation to list all topics or channels. However, nsqd's HTTP API (port 4151) exposes:

- `GET /stats?format=json` — all topics, channels, message counts, depths
- `GET /topics` — topic list
- `GET /channels?topic=<name>` — channel list for a topic

If nsqd's HTTP port is publicly accessible, an attacker can enumerate topics and channels. Restrict HTTP port 4151 access or use nsqd `--http-address=127.0.0.1:4151` to bind to localhost only.

### Message Injection

If an attacker can reach nsqd port 4150, they can publish arbitrary messages to any topic. There is no per-topic ACL in vanilla NSQ.

**Mitigation strategies:**
- Network segmentation (private VLAN for nsqd)
- Reverse proxy with topic-based access control (complex, requires custom proxy)
- Message signing at application level (verify HMAC in consumer)

### Denial of Service

Potential DoS vectors:

1. **Topic/channel explosion:** Create thousands of ephemeral channels or topics to exhaust nsqd memory. NSQ has no built-in rate limiting on topic/channel creation.
2. **Message flood:** Publish high-volume messages to fill disk (nsqd persists messages to disk). Configure `--max-msg-size` and `--max-body-size` in nsqd.
3. **Slow consumer attack:** Subscribe with `RDY 1`, never send FIN. Messages accumulate in flight and are requeued after `msg-timeout`, amplifying disk I/O.

**Mitigations:**
- nsqd `--max-msg-timeout` (default 15 min) prevents unbounded message holds
- nsqd `--max-req-timeout` (default 1 hour) limits REQ requeue delay
- nsqd `--max-msg-size` (default 1 MB) caps individual message size
- Disk quotas on nsqd data directory

---

## Production Deployment Checklist

- [ ] nsqd `--mem-queue-size` tuned for expected message volume (default 10,000 messages in-memory per topic/channel)
- [ ] nsqd `--data-path` on SSD or fast disk (fsync on every message write by default)
- [ ] nsqd `--sync-every` increased to reduce fsync rate (trades durability for throughput; e.g., `--sync-every=100`)
- [ ] nsqd `--max-msg-size` set to prevent massive messages (default 1 MB)
- [ ] nsqd `--max-body-size` aligned with expected MPUB batch sizes
- [ ] nsqd `--msg-timeout` configured for realistic consumer processing time (default 60 sec)
- [ ] nsqlookupd deployed for topic discovery (optional but recommended for multi-nsqd setups)
- [ ] nsqd `--broadcast-address` set to public/routable IP if using nsqlookupd
- [ ] Firewall rules: restrict port 4150 (TCP) to application servers, restrict port 4151 (HTTP) to monitoring/admin hosts
- [ ] Monitoring: `GET /stats?format=json` scraped into Prometheus/Grafana
  - Key metrics: `topic.depth` (messages pending), `topic.message_count`, `channel.in_flight_count`, `channel.timeout_count`
- [ ] Log aggregation: nsqd logs to stdout; capture with Docker logging driver or systemd journal
- [ ] Backup strategy: nsqd's `--data-path` contains topic/channel metadata and on-disk messages; backup if durable retention is critical
- [ ] Upgrade process: nsqd supports zero-downtime rolling restarts (messages are flushed to disk on SIGTERM)

---

## Debugging Tips

### Connection Refused

```
error: Connection timeout
```

**Causes:**
- nsqd not running on the specified host/port
- Firewall blocking port 4150
- nsqd bound to `127.0.0.1` instead of `0.0.0.0` (check `--tcp-address` flag)

**Fix:** Verify nsqd is listening with `netstat -tlnp | grep 4150` or `docker logs nsqd`.

### E_BAD_TOPIC

```
NSQ PUB error: E_BAD_TOPIC
```

**Cause:** Topic name contains invalid characters (e.g., spaces, `@`, `/`).

**Fix:** Use only `a-z A-Z 0-9 . _ -` and keep length ≤ 64 chars.

### Empty Subscribe Response

```json
{
  "success": true,
  "messageCount": 0,
  "messages": []
}
```

**Causes:**
- No messages published to the topic yet
- Messages were published but already consumed by another channel
- `collect_ms` too short (messages arrive after the collection window closes)

**Fix:**
- Increase `collect_ms` (e.g., 5000 ms)
- Publish a test message: `curl -d 'test' http://localhost:4151/pub?topic=events`
- Check topic depth: `curl -s http://localhost:4151/stats?format=json | jq '.topics[] | select(.topic_name=="events") | .depth'`

### Attempts > 1

```json
{
  "attempts": 3,
  "body": "..."
}
```

**Meaning:** The message was delivered 3 times. Previous consumers either:
- Did not FIN the message (crashed before acknowledging)
- Sent REQ to requeue for retry
- Message timed out (consumer held the message for longer than `msg-timeout`)

**Action:** Check consumer logs for errors. If `attempts` is high (> 5), the message may be poison (un-processable). Consider a dead-letter channel strategy.

### Read Timeout During Subscribe

```
error: Read timeout
```

**Cause:** No messages arrived within the `readFrame()` timeout (1 second per frame in the message collection loop).

**Expected behavior:** This is normal if `collect_ms` expires and no messages are in the queue. The error is caught and the subscribe returns successfully with 0 messages.

**Unexpected:** If you know messages exist in the topic, check:
- Channel has messages (`curl http://localhost:4151/stats?format=json | jq '.topics[] | select(.topic_name=="events") | .channels[] | select(.channel_name=="portofcall") | .depth'`)
- Another consumer is not holding messages in-flight with `RDY` but not FINishing

---

## Advanced Patterns

### Dead Letter Channel

NSQ does not have built-in dead-letter queues. Implement manually:

1. Consumer catches message processing errors
2. If `attempts >= 5`, publish message to a separate `<topic>_dlq` topic instead of FINishing
3. FIN the original message to prevent further requeues
4. Monitor `<topic>_dlq` for poison messages

### Priority Queues

NSQ does not support message priority. Workaround:

- Separate topics per priority level: `events_high`, `events_medium`, `events_low`
- Consumers subscribe to `events_high` first; only subscribe to `events_medium` when `events_high.depth == 0`

### Rate Limiting

Consume messages at a fixed rate:

```bash
while true; do
  curl -s $BASE/api/nsq/subscribe \
    -d '{"host":"localhost","topic":"events","channel":"ratelimited","max_messages":10,"collect_ms":1000}' \
    | jq -r '.messages[].body' | xargs -I {} process_message {}
  sleep 1  # 10 messages per second
done
```

### Message Deduplication

NSQ provides at-least-once delivery. Idempotent consumers must deduplicate:

1. Extract a unique message ID from the payload (e.g., `user_id + event_type + timestamp`)
2. Store processed IDs in Redis with TTL matching the max expected delivery window (e.g., 24 hours)
3. Before processing, check `EXISTS <message_id>` — if true, skip and FIN

### Broadcast to All Consumers

Multiple consumers on the **same channel** compete for messages (load balancing). Each message is delivered to one consumer.

Multiple consumers on **different channels** all receive every message (fan-out).

Example:

- Topic `user.signup`
- Channel `email_sender` → sends welcome email
- Channel `analytics` → records signup event
- Channel `crm_sync` → creates CRM contact

All three channels receive every `user.signup` message independently.

---

## References

- **NSQ Protocol Spec:** https://nsq.io/clients/tcp_protocol_spec.html
- **NSQ Documentation:** https://nsq.io/overview/design.html
- **nsqd Configuration:** https://nsq.io/components/nsqd.html
- **Docker Image:** https://hub.docker.com/r/nsqio/nsq
- **GitHub Repository:** https://github.com/nsqio/nsq
