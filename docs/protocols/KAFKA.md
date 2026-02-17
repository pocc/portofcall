# Apache Kafka — Implementation Reference

**Protocol:** Kafka Wire Protocol (binary, TCP)
**Implementation:** `src/worker/kafka.ts`
**Ports:** 9092 (plaintext), 9093 (SSL — not supported; see Limitations)
**Routes:**
- `POST /api/kafka/versions` — ApiVersions probe (discover broker capabilities)
- `POST /api/kafka/metadata` — Metadata (cluster topology + topic/partition info)
- `POST /api/kafka/produce` — Produce (publish a message to a topic partition)
- `POST /api/kafka/fetch` — Fetch (consume messages from a topic partition)
- `POST /api/kafka/offsets` — ListOffsets (get earliest/latest/timestamp offset)
- `POST /api/kafka/groups` — ListGroups (enumerate consumer groups)
- `POST /api/kafka/group-describe` — DescribeGroups (group state + member list)

---

## Wire Protocol Framing

Every request and response is size-prefixed:

```
Request:  SIZE(4B BE) | API_KEY(2B) | API_VERSION(2B) | CORRELATION_ID(4B) | CLIENT_ID(2B+data) | PAYLOAD
Response: SIZE(4B BE) | CORRELATION_ID(4B) | RESPONSE_BODY
```

All integers are big-endian. Strings are 2-byte length-prefixed (`INT16 len + bytes`); `len=-1` = null. Each endpoint opens a new TCP connection, makes one request/response exchange, and closes.

---

## ApiVersions — Version Probe

### Request

```json
{ "host": "kafka.example.com", "port": 9092, "timeout": 15000, "clientId": "portofcall" }
```

All fields except `host` are optional. Sends ApiVersions v0 (API key 18).

### Response

```json
{
  "success": true,
  "host": "kafka.example.com",
  "port": 9092,
  "errorCode": 0,
  "errorName": "NONE",
  "apiVersions": [
    { "apiKey": 0, "apiName": "Produce", "minVersion": 0, "maxVersion": 9 },
    { "apiKey": 1, "apiName": "Fetch", "minVersion": 0, "maxVersion": 13 },
    { "apiKey": 2, "apiName": "ListOffsets", "minVersion": 0, "maxVersion": 7 },
    { "apiKey": 3, "apiName": "Metadata", "minVersion": 0, "maxVersion": 12 },
    { "apiKey": 18, "apiName": "ApiVersions", "minVersion": 0, "maxVersion": 3 }
  ],
  "apiCount": 52,
  "connectTimeMs": 12,
  "totalTimeMs": 38
}
```

`apiVersions` maps every API key the broker supports to its supported version range. Use `maxVersion` to determine feature availability:
- `Produce maxVersion ≥ 3` → RecordBatch magic=2 (Kafka 0.11+) — this implementation requires it
- `Fetch maxVersion ≥ 4` → `isolation_level` field supported — used here
- `ListOffsets maxVersion ≥ 1` → returns single (timestamp, offset) pair — used here
- `ApiVersions maxVersion ≥ 3` → SASL negotiation extended form

If `errorCode = 35` (`UNSUPPORTED_VERSION`), the broker is older than Kafka 0.10 and not compatible with this implementation.

---

## Metadata — Cluster Topology

### Request

```json
{
  "host": "kafka.example.com",
  "port": 9092,
  "topics": ["my-topic", "other-topic"],
  "timeout": 15000,
  "clientId": "portofcall"
}
```

`topics` is optional. Omit (or send `[]`) to request metadata for ALL topics on the cluster.

### Response

```json
{
  "success": true,
  "brokers": [
    { "nodeId": 0, "host": "kafka-0.internal", "port": 9092 },
    { "nodeId": 1, "host": "kafka-1.internal", "port": 9092 }
  ],
  "brokerCount": 2,
  "topics": [
    {
      "errorCode": 0,
      "name": "my-topic",
      "partitions": [
        {
          "errorCode": 0,
          "partitionId": 0,
          "leader": 1,
          "replicas": [1, 0],
          "isr": [1, 0]
        }
      ]
    }
  ],
  "topicCount": 1,
  "connectTimeMs": 11,
  "totalTimeMs": 42
}
```

Uses Metadata v0. The broker addresses returned in `brokers` are the **advertised** listener addresses — these may be internal hostnames (e.g., `kafka-0.internal`) that are unreachable from the public internet. This is why produce/fetch against cloud-hosted Kafka often fails even when metadata succeeds.

**Partition health reading:**
- `partition.errorCode = 5` (`LEADER_NOT_AVAILABLE`) — broker is electing a new leader; retry in 1–2 s
- `partition.errorCode = 3` (`UNKNOWN_TOPIC_OR_PARTITION`) — topic doesn't exist or was deleted
- `isr.length < replicas.length` — under-replicated partition; leader is serving but some replicas are lagging
- `replicas[0] !== leader` — preferred leader election is pending

---

## ListOffsets — Find Partition Offsets

The prerequisite for meaningful Fetch calls. Without knowing the current end offset, you cannot compute consumer lag or start a targeted read.

### Request

```json
{
  "host": "kafka.example.com",
  "port": 9092,
  "topic": "my-topic",
  "partition": 0,
  "timestamp": -1,
  "timeout": 15000
}
```

`timestamp` sentinel values:
- `-1` (default) → latest offset (high watermark — the next offset to be assigned)
- `-2` → earliest offset (start of the retained log)
- Unix millisecond timestamp → first offset at or after that timestamp

Uses ListOffsets v1 (available on Kafka 0.10.1+).

### Response

```json
{
  "success": true,
  "topic": "my-topic",
  "partition": 0,
  "errorCode": 0,
  "timestamp": "-1",
  "offset": "83741",
  "latencyMs": 18
}
```

`offset` and `timestamp` are strings because they are 64-bit integers (JSON numbers lose precision above 2^53).

When `timestamp=-1` (latest), the returned `offset` is the **high watermark** — the next offset to be written, not the last one written. The last committed message is at `offset - 1`.

When `timestamp=-2` (earliest), the returned `offset` is the log start offset. Messages before this offset have been deleted by retention.

### Consumer lag calculation

```bash
# Get end offset
END=$(curl -s .../api/kafka/offsets -d '{"host":"...","topic":"events","partition":0,"timestamp":-1}' | jq -r .offset)

# Fetch the most recent N records:
FETCH_FROM=$((END - 100))
curl -s .../api/kafka/fetch -d "{\"host\":\"...\",\"topic\":\"events\",\"offset\":$FETCH_FROM}"
```

---

## Produce — Publish a Message

### Request

```json
{
  "host": "kafka.example.com",
  "port": 9092,
  "topic": "my-topic",
  "partition": 0,
  "key": "user-123",
  "value": "{\"event\":\"click\",\"page\":\"home\"}",
  "acks": 1,
  "timeoutMs": 5000,
  "timeout": 10000,
  "clientId": "portofcall"
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `topic` | (required) | Topic name |
| `partition` | `0` | Partition index |
| `key` | null | Routing key; null = no key |
| `value` | (required) | UTF-8 string |
| `acks` | `1` | `0`=fire-and-forget, `1`=leader ack, `-1`=all ISR ack |
| `timeoutMs` | `5000` | Broker-side produce timeout |
| `timeout` | `10000` | HTTP request timeout |

Uses Produce v3 (RecordBatch magic=2, Kafka 0.11+).

### Response

```json
{
  "success": true,
  "topic": "my-topic",
  "partition": 0,
  "errorCode": 0,
  "baseOffset": "83740",
  "throttleTimeMs": 0,
  "rtt": 21
}
```

`baseOffset` is the offset assigned to the produced message. `acks=0` skips waiting for a response — `baseOffset` is always `"0"` and `success` is always `true`.

### CRC32C = 0 — Known Limitation

The RecordBatch CRC field is set to `0`. CRC32C is not available in the Web Crypto API. Most Kafka brokers skip CRC validation on incoming produces. However, strict configurations may respond with `errorCode: 2` (`CORRUPT_MESSAGE`, code 87 is the same condition). If you receive error code 2 or 87, the message likely still landed — confirm with Fetch.

### acks = -1 (all ISR)

`acks: -1` is encoded as signed INT16 `0xFFFF`, which Kafka correctly interprets as `acks=all`. The broker waits for all in-sync replicas to acknowledge before responding.

---

## Fetch — Consume Messages

### Request

```json
{
  "host": "kafka.example.com",
  "port": 9092,
  "topic": "my-topic",
  "partition": 0,
  "offset": 0,
  "maxWaitMs": 1000,
  "maxBytes": 1048576,
  "timeout": 15000,
  "clientId": "portofcall"
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `topic` | (required) | Topic name |
| `partition` | `0` | Partition index |
| `offset` | `0` | Start offset (inclusive). Use `/api/kafka/offsets` to find earliest/latest. |
| `maxWaitMs` | `1000` | Max broker wait if fewer than `minBytes` available |
| `maxBytes` | `1048576` | Max response bytes (1 MiB) |

Uses Fetch v4 with `isolation_level=0` (READ_UNCOMMITTED). Hard limit: **100 records** per call regardless of `maxBytes`.

### Response

```json
{
  "success": true,
  "topic": "my-topic",
  "partition": 0,
  "offset": 83741,
  "errorCode": 0,
  "highWatermark": "83742",
  "lastStableOffset": "83742",
  "records": [
    {
      "offset": "83741",
      "timestampMs": "1708123456789",
      "key": "user-123",
      "value": "{\"event\":\"click\",\"page\":\"home\"}"
    }
  ],
  "recordCount": 1,
  "throttleTimeMs": 0,
  "rtt": 34
}
```

`highWatermark` is the log end offset (next-to-be-assigned offset). `lastStableOffset` equals `highWatermark` on non-transactional topics. Both are strings (64-bit integers).

`records[].timestampMs` is the `CreateTime` embedded in the RecordBatch. `"-1"` means the producer sent a null timestamp (broker log-append time applies).

**OFFSET_OUT_OF_RANGE (errorCode 1):** Fetch offset is below the log start offset (data deleted by retention). Get the earliest offset with `timestamp=-2` and retry.

### Scanning from a specific time

```bash
# Offset at timestamp (Unix ms)
OFFSET=$(curl -s .../api/kafka/offsets \
  -d "{\"host\":\"...\",\"topic\":\"events\",\"timestamp\":$(date -d '1 hour ago' +%s)000}" | jq -r .offset)

curl -s .../api/kafka/fetch -d "{\"host\":\"...\",\"topic\":\"events\",\"offset\":$OFFSET}"
```

---

## ListGroups — Consumer Group Enumeration

### Request

```json
{ "host": "kafka.example.com", "port": 9092, "timeout": 15000 }
```

### Response

```json
{
  "success": true,
  "errorCode": 0,
  "groups": [
    { "groupId": "analytics-consumer", "protocolType": "consumer" },
    { "groupId": "etl-pipeline", "protocolType": "consumer" }
  ],
  "latencyMs": 14
}
```

`protocolType` is typically `"consumer"`. Kafka Streams uses `"stream"`.

---

## DescribeGroups — Group State and Members

### Request

```json
{
  "host": "kafka.example.com",
  "port": 9092,
  "groupIds": ["analytics-consumer"],
  "timeout": 15000
}
```

`groupIds` is required and non-empty.

### Response

```json
{
  "success": true,
  "groups": [
    {
      "errorCode": 0,
      "groupId": "analytics-consumer",
      "state": "Stable",
      "protocolType": "consumer",
      "protocol": "range",
      "memberCount": 2,
      "members": [
        { "memberId": "consumer-1-abc123-...", "clientId": "analytics-app", "clientHost": "/10.0.1.5" },
        { "memberId": "consumer-2-def456-...", "clientId": "analytics-app", "clientHost": "/10.0.1.6" }
      ]
    }
  ],
  "latencyMs": 22
}
```

### Group states

| State | Meaning |
|-------|---------|
| `Empty` | No members; may have committed offsets |
| `PreparingRebalance` | Members joining; partition assignment pending |
| `CompletingRebalance` | Leader elected; waiting for SyncGroup |
| `Stable` | Normal operation; members consuming assigned partitions |
| `Dead` | Group is being cleaned up |

`protocol` is the partition assignment strategy: `range`, `roundrobin`, `sticky`, or `cooperative-sticky`.

`member.clientHost` is the consumer's IP (prefixed with `/`). `memberId` is ephemeral — it changes on each rebalance.

---

## Error Code Reference

| Code | Name | Common cause |
|------|------|-------------|
| 0 | NONE | Success |
| 1 | OFFSET_OUT_OF_RANGE | Fetch offset below log start or above HWM |
| 2 | CORRUPT_MESSAGE | CRC32C mismatch (CRC=0 on produce) |
| 3 | UNKNOWN_TOPIC_OR_PARTITION | Topic doesn't exist; wrong broker for partition |
| 5 | LEADER_NOT_AVAILABLE | Leader election in progress; retry |
| 6 | NOT_LEADER_OR_FOLLOWER | Request sent to wrong broker; use Metadata first |
| 9 | REPLICA_NOT_AVAILABLE | acks=-1 and some replicas are down |
| 35 | UNSUPPORTED_VERSION | Broker too old for the API version used |
| 87 | CORRUPT_MESSAGE | CRC mismatch (same as code 2, different BER tag) |

---

## RecordBatch Wire Format (magic=2)

```
[8B]  baseOffset (int64)
[4B]  batchLength (int32) — covers all fields below
[4B]  partitionLeaderEpoch (int32)
[1B]  magic = 2
[4B]  CRC32C (set to 0 by this implementation)
[2B]  attributes: bits 0-2=compression(0=none,1=gzip,2=snappy,3=lz4,4=zstd), bit 3=timestampType(0=CreateTime), bit 4=isTransactional, bit 5=isControl
[4B]  lastOffsetDelta (int32)
[8B]  baseTimestamp (int64, ms)
[8B]  maxTimestamp (int64, ms)
[8B]  producerId (int64; -1 = non-idempotent)
[2B]  producerEpoch (int16; -1 = non-idempotent)
[4B]  baseSequence (int32; -1 = non-idempotent)
[4B]  recordCount (int32)
[...] records (zigzag varint-length-prefixed)
```

Each record uses zigzag varint encoding for all length/delta fields (same as protobuf SINT32):

```
[varint] record length
[1B]     attributes = 0
[varint] timestampDelta (relative to baseTimestamp)
[varint] offsetDelta (relative to baseOffset)
[varint] keyLength (-1 = null key)
[N]      key bytes
[varint] valueLength
[N]      value bytes
[varint] headerCount (0 in produced messages here)
```

---

## curl Quick Reference

```bash
BASE='https://portofcall.example.com'

# Broker capabilities
curl -s $BASE/api/kafka/versions -d '{"host":"kafka.example.com"}' \
  | jq '.apiVersions[] | select(.apiName=="Fetch")'

# All topics
curl -s $BASE/api/kafka/metadata -d '{"host":"kafka.example.com"}' | jq '.topics[].name'

# Latest offset (high watermark)
curl -s $BASE/api/kafka/offsets \
  -d '{"host":"kafka.example.com","topic":"events","timestamp":-1}' | jq .offset

# Earliest retained offset
curl -s $BASE/api/kafka/offsets \
  -d '{"host":"kafka.example.com","topic":"events","timestamp":-2}' | jq .offset

# Publish a message
curl -s $BASE/api/kafka/produce \
  -d '{"host":"kafka.example.com","topic":"events","key":"u1","value":"{\"type\":\"click\"}"}'

# Consume last 100 messages
END=$(curl -s $BASE/api/kafka/offsets \
  -d '{"host":"kafka.example.com","topic":"events","timestamp":-1}' | jq -r .offset)
curl -s $BASE/api/kafka/fetch \
  -d "{\"host\":\"kafka.example.com\",\"topic\":\"events\",\"offset\":$((END-100))}" \
  | jq '.records[].value'

# List consumer groups
curl -s $BASE/api/kafka/groups -d '{"host":"kafka.example.com"}' | jq '.groups[].groupId'

# Describe a group
curl -s $BASE/api/kafka/group-describe \
  -d '{"host":"kafka.example.com","groupIds":["my-group"]}' | jq '.groups[0].state'
```

---

## Local Testing

```bash
# Single-broker Kafka with KRaft (no Zookeeper, Kafka 3.3+)
docker run -d --name kafka -p 9092:9092 \
  -e KAFKA_NODE_ID=1 \
  -e KAFKA_PROCESS_ROLES=broker,controller \
  -e KAFKA_LISTENERS='PLAINTEXT://:9092,CONTROLLER://:9093' \
  -e KAFKA_ADVERTISED_LISTENERS='PLAINTEXT://localhost:9092' \
  -e KAFKA_CONTROLLER_QUORUM_VOTERS='1@localhost:9093' \
  -e KAFKA_LISTENER_SECURITY_PROTOCOL_MAP='PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT' \
  -e KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER \
  -e KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT \
  -e KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1 \
  apache/kafka:latest

# Create a test topic
docker exec kafka /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server localhost:9092 --create \
  --topic test --partitions 3 --replication-factor 1

# Verify
curl -s localhost:8787/api/kafka/metadata -d '{"host":"localhost"}' | jq '.topics[].name'
```

---

## Known Limitations

- **No SASL authentication** — `SaslHandshake` (API key 17) + `SaslAuthenticate` (API key 36) are not implemented. Production clusters using SASL/PLAIN, SASL/SCRAM-SHA-256, or SASL/GSSAPI (Kerberos) will close the connection after the first request.
- **No TLS** — Port 9093 SSL listeners are not supported. Use plaintext port 9092 or a `SASL_PLAINTEXT` listener.
- **CRC32C = 0 on produce** — `CRC32C` is unavailable in Web Crypto. Most brokers skip CRC validation on inbound messages. Error codes 2 or 87 (`CORRUPT_MESSAGE`) indicate a strict broker that does validate.
- **Single partition per produce/fetch** — One partition per request. No key-hash-based partition routing.
- **100-record fetch hard limit** — `parseRecordBatches()` stops after 100 records regardless of `maxBytes`. To consume more, issue repeated Fetch calls advancing `offset` by `recordCount` each time.
- **Fetch offset is JS number** — `offset` in the request is parsed as a JavaScript `number`. Offsets above 2^53 lose precision. Use the string values returned by ListOffsets/Fetch for precise tracking at very high offsets.
- **Metadata v0 only** — No `allowAutoTopicCreation` (added in v4), no topic-level `isInternal` flag (added in v1). All topics including `__consumer_offsets` appear in all-topics queries.
- **No OffsetFetch** — Consumer committed offsets (API key 9) are not implemented. You cannot read where a consumer group last committed.
- **Single broker only** — Each request connects directly to the specified `host`. The broker list returned in Metadata is not used for routing. `NOT_LEADER_OR_FOLLOWER` errors require manually specifying the correct broker.
- **No compression support in fetch** — The RecordBatch parser reads records from uncompressed batches (attributes compression bits = 0). Compressed batches (GZIP, Snappy, LZ4, Zstd) are not decompressed; records from those batches will be missing.
