# ActiveMQ -- Power User Reference

**Ports:** 61616 (OpenWire), 61613 (STOMP), 8161 (Admin/Jolokia) | **Source:** `src/worker/activemq.ts`

Port of Call implements eight ActiveMQ endpoints spanning three protocols: an OpenWire binary probe on port 61616, STOMP text-frame messaging on port 61613, and Jolokia REST queries on port 8161. No TLS -- plain TCP and HTTP only.

**Compatible brokers:** ActiveMQ Classic, ActiveMQ Artemis. STOMP endpoints also work with RabbitMQ (with STOMP plugin) and any STOMP 1.0-1.2 broker, though the admin/info/durable endpoints are ActiveMQ-specific.

---

## ActiveMQ Default Ports

| Port  | Protocol                      | Used By                |
|-------|-------------------------------|------------------------|
| 61616 | OpenWire (native binary)      | `/probe`               |
| 61613 | STOMP (text)                  | `/connect`, `/send`, `/subscribe`, `/durable-subscribe`, `/durable-unsubscribe`, `/queues` |
| 8161  | HTTP (Jolokia REST API)       | `/admin`, `/info`      |
| 5672  | AMQP 0-9-1                    | Not implemented        |
| 1883  | MQTT                          | Not implemented        |
| 61614 | WebSocket/STOMP               | Not implemented        |

---

## API Endpoints

### `POST /api/activemq/probe` -- OpenWire handshake probe

Opens a TCP connection to port 61616, sends a WireFormatInfo command, and parses the broker's response to detect ActiveMQ and extract version/capability information.

**Request:**

| Field     | Type   | Default | Notes                              |
|-----------|--------|---------|------------------------------------|
| `host`    | string | required | Validated: `[a-zA-Z0-9._:-]+`    |
| `port`    | number | `61616` | OpenWire port                     |
| `timeout` | number | `10000` | ms                                |

**Success (200):**

```json
{
  "success": true,
  "host": "activemq.example.com",
  "port": 61616,
  "tcpLatency": 23,
  "isActiveMQ": true,
  "openWireVersion": 12,
  "stackTraceEnabled": true,
  "cacheEnabled": true,
  "tightEncodingEnabled": true,
  "hasBrokerInfo": true,
  "brokerName": "localhost",
  "receivedBytes": 342,
  "note": "Apache ActiveMQ broker detected. OpenWire v12.",
  "references": [
    "https://activemq.apache.org/openwire",
    "https://activemq.apache.org/configuring-transports"
  ]
}
```

**OpenWire wire format details:**

The probe sends a WireFormatInfo command (data type `0x01`) with the following binary layout:

```
[4-byte frame length (big-endian)]   -- size of everything after this prefix
[1-byte data type = 0x01]            -- WireFormatInfo command type
[8-byte magic = "ActiveMQ"]          -- literal bytes, no length prefix
[4-byte version = 1 (big-endian)]    -- protocol version requested
[4-byte properties length = 0]       -- empty marshalled options map
```

WireFormatInfo is a special command in OpenWire -- unlike regular commands (which include commandId, responseRequired, correlationId), it has its own marshalling: just magic, version, and a marshalled properties map.

**Response parsing:** The implementation scans the raw response bytes for the "ActiveMQ" magic string (8 bytes). If found, it reads the 4-byte version immediately after the magic, then parses the marshalled properties map to extract boolean flags (`StackTraceEnabled`, `CacheEnabled`, `TightEncodingEnabled`). If a second frame follows (BrokerInfo, data type `0x02`), the broker name is extracted via regex.

**Marshalled properties map format (in broker response):**

```
[4-byte map-bytes length]   -- or -1 (0xFFFFFFFF) for null
[4-byte entry count]
For each entry:
  [2-byte key length] [key UTF-8 bytes]
  [1-byte value type tag]
  [value bytes]
```

Value type tags: `0x01` = boolean (1 byte), `0x05` = int32 (4 bytes), `0x06` = long (8 bytes), `0x09` = string (2-byte length + UTF-8).

**Non-ActiveMQ hosts:** If the magic is not found, `isActiveMQ: false` is returned with the number of bytes received. The note suggests trying STOMP on :61613, AMQP on :5672, or MQTT on :1883.

---

### `POST /api/activemq/connect` -- STOMP connectivity probe

Performs a STOMP CONNECT/CONNECTED handshake on port 61613, then disconnects. Used to verify credentials and retrieve broker metadata.

**Request:**

| Field      | Type   | Default | Notes                         |
|------------|--------|---------|-------------------------------|
| `host`     | string | required |                              |
| `port`     | number | `61613` | STOMP port                   |
| `username` | string | --      | Sent as `login` header       |
| `password` | string | --      | Sent as `passcode` header    |
| `vhost`    | string | --      | Defaults to `host` if omitted |
| `timeout`  | number | `10000` | ms                           |

**Success (200):**

```json
{
  "success": true,
  "host": "activemq.example.com",
  "port": 61613,
  "latency": 45,
  "stompVersion": "1.2",
  "server": "ActiveMQ/5.18.3",
  "heartBeat": "0,0",
  "session": "session-abc123"
}
```

**STOMP CONNECT frame sent:**

```
CONNECT
accept-version:1.0,1.1,1.2
host:<vhost or host>
heart-beat:0,0
login:<username>         (only if provided)
passcode:<password>      (only if provided)

\0
```

The `heart-beat:0,0` means the client requests no heartbeats. The broker's negotiated heart-beat is returned in the response.

---

### `POST /api/activemq/send` -- Send a message via STOMP

Connects via STOMP, sends one message to a queue or topic, waits for a RECEIPT frame, then disconnects.

**Request:**

| Field         | Type    | Default      | Notes                                        |
|---------------|---------|--------------|----------------------------------------------|
| `host`        | string  | required     |                                              |
| `port`        | number  | `61613`      |                                              |
| `username`    | string  | --           |                                              |
| `password`    | string  | --           |                                              |
| `vhost`       | string  | --           |                                              |
| `destination` | string  | required     | `/queue/name`, `/topic/name`, `queue://name`, or `topic://name` |
| `body`        | string  | required     | Message payload                              |
| `contentType` | string  | `text/plain` |                                              |
| `persistent`  | boolean | `true`       | Sent as `persistent` header                  |
| `priority`    | number  | `4`          | 0-9, clamped                                 |
| `ttl`         | number  | `0`          | ms, 0 = unlimited; sets `expires` header     |
| `headers`     | object  | `{}`         | Extra STOMP headers, merged last (can override defaults) |
| `timeout`     | number  | `10000`      | ms                                           |

**Destination normalisation:** Both STOMP form (`/queue/foo`) and ActiveMQ URI form (`queue://foo`) are accepted. URI form is normalised to STOMP form before sending. Destinations must match `/(queue|topic|temp-queue|temp-topic)/.+`.

**Success (200):**

```json
{
  "success": true,
  "elapsed": 120,
  "destination": "/queue/orders",
  "bodyLength": 42,
  "receiptReceived": true,
  "persistent": true,
  "priority": 4,
  "stompVersion": "1.2",
  "server": "ActiveMQ/5.18.3"
}
```

**SEND frame headers:** Always includes `destination`, `content-type`, `content-length` (UTF-8 byte count), `persistent`, `priority`, and `receipt: send-1`. If `ttl > 0`, an `expires` header is added as `Date.now() + ttl`. Extra headers from the `headers` field are spread last and CAN override any of these defaults.

**Receipt handling:** Waits up to 5 seconds for a RECEIPT frame. If the broker returns ERROR, the error message is thrown. If the receipt times out, `receiptReceived: false` is returned with `success: true` -- the message may or may not have been delivered.

---

### `POST /api/activemq/subscribe` -- Subscribe and collect messages

Connects via STOMP, subscribes to a destination, collects incoming MESSAGE frames, then unsubscribes and disconnects.

**Request:**

| Field         | Type   | Default | Notes                                    |
|---------------|--------|---------|------------------------------------------|
| `host`        | string | required |                                         |
| `port`        | number | `61613` |                                         |
| `username`    | string | --      |                                         |
| `password`    | string | --      |                                         |
| `vhost`       | string | --      |                                         |
| `destination` | string | required | Same normalisation as `/send`           |
| `ackMode`     | string | `auto`  | `auto`, `client`, or `client-individual` |
| `maxMessages` | number | `10`    | Capped at 100                           |
| `selector`    | string | --      | JMS selector expression                  |
| `timeout`     | number | `10000` | ms                                      |

**Success (200):**

```json
{
  "success": true,
  "elapsed": 2300,
  "destination": "/queue/orders",
  "messageCount": 3,
  "messages": [
    {
      "messageId": "ID:broker-host-1234-1234567890",
      "destination": "/queue/orders",
      "contentType": "text/plain",
      "body": "Order #1001",
      "headers": { "message-id": "...", "destination": "/queue/orders", ... }
    }
  ],
  "stompVersion": "1.2",
  "server": "ActiveMQ/5.18.3"
}
```

**Collection deadline:** `max(timeout - 1000ms, 2000ms)`. Stops when `maxMessages` is reached or the deadline expires.

**ACK modes:**
- `auto` (default) -- broker auto-acknowledges delivery; no ACK frame sent
- `client` -- client must ACK; each MESSAGE frame is ACKed immediately using the `ack` header (or `message-id` as fallback)
- `client-individual` -- same as `client` but ACKs are per-message, not cumulative

**JMS selectors:** If `selector` is provided, it is sent as the `selector` STOMP header. ActiveMQ evaluates it as a JMS SQL92 selector expression (e.g. `priority > 5 AND type = 'alert'`).

**Subscription lifecycle:** SUBSCRIBE with hardcoded `id: sub-0` at start, UNSUBSCRIBE with same ID at end, DISCONNECT with `receipt: disc-1`.

---

### `POST /api/activemq/admin` -- Jolokia REST API queries

Queries the ActiveMQ Jolokia REST API (HTTP on port 8161) for broker stats, queue/topic listings, and per-queue details.

**Request:**

| Field        | Type   | Default      | Notes                                 |
|--------------|--------|--------------|---------------------------------------|
| `host`       | string | required     |                                       |
| `port`       | number | `8161`       | Admin console port                    |
| `username`   | string | `admin`      | HTTP Basic Auth                       |
| `password`   | string | `admin`      |                                       |
| `brokerName` | string | `localhost`  | JMX broker name                       |
| `action`     | string | `brokerInfo` | `brokerInfo`, `listQueues`, `listTopics`, `queueStats` |
| `queueName`  | string | --           | Required for `queueStats`             |
| `timeout`    | number | `10000`      | ms                                    |

**Actions:**

- `brokerInfo` -- Returns broker version, uptime, memory/store/temp usage, total enqueue/dequeue/consumer/producer counts, transport connectors
- `listQueues` -- Lists all queues with size, consumer/producer counts, enqueue/dequeue/expired counts, memory usage
- `listTopics` -- Same fields as `listQueues` but for topics
- `queueStats` -- Detailed stats for a single queue (requires `queueName`)

**Jolokia URL format:** `http://{host}:{port}/api/jolokia/read/org.apache.activemq:type=Broker,brokerName={brokerName}[,destinationType=Queue,destinationName=*]`

**Authentication:** HTTP Basic Auth with `btoa(username:password)`. Default credentials for ActiveMQ Classic are admin/admin. A 401 response includes a hint about checking credentials.

---

### `POST /api/activemq/info` -- Auto-detect broker info

Similar to `/admin` with `action=brokerInfo`, but uses a wildcard broker name (`%2A` = `*`) so it works without knowing the broker name. Useful as a first probe.

**Request:**

| Field      | Type   | Default | Notes            |
|------------|--------|---------|------------------|
| `host`     | string | required |                 |
| `port`     | number | `8161`  |                 |
| `username` | string | `admin` |                 |
| `password` | string | `admin` |                 |
| `timeout`  | number | `10000` | ms              |

**Success (200):**

```json
{
  "success": true,
  "latencyMs": 89,
  "brokerId": "ID:host-12345-1234567890-0:1",
  "brokerName": "localhost",
  "brokerVersion": "5.18.3",
  "uptime": "2 days 14 hours",
  "memoryUsage": 12,
  "storeUsage": 0,
  "tempUsage": 0,
  "totalEnqueueCount": 4521,
  "totalDequeueCount": 4500,
  "totalConsumerCount": 3,
  "totalProducerCount": 1,
  "totalMessages": 21,
  "dataDirectory": "/opt/activemq/data"
}
```

**Wildcard query:** The Jolokia URL uses `brokerName=%2A` (URL-encoded `*`). The response is a map keyed by broker name; the first entry is extracted.

---

### `POST /api/activemq/durable-subscribe` -- Durable topic subscription

Creates a durable topic subscription via STOMP. Unlike ephemeral subscriptions, the broker persists messages for the named subscriber even while the client is offline.

**Request:**

| Field              | Type   | Default | Notes                                  |
|--------------------|--------|---------|----------------------------------------|
| `host`             | string | required |                                       |
| `port`             | number | `61613` |                                       |
| `username`         | string | --      |                                       |
| `password`         | string | --      |                                       |
| `vhost`            | string | --      |                                       |
| `destination`      | string | required | Must be a topic (`/topic/...`)        |
| `clientId`         | string | required | Uniquely identifies this durable client |
| `subscriptionName` | string | required | Subscription name, persists on broker  |
| `maxMessages`      | number | `10`    | Capped at 100                         |
| `selector`         | string | --      | JMS selector                          |
| `timeout`          | number | `15000` | ms                                    |

**STOMP headers used:**
- CONNECT includes `client-id: <clientId>` (ActiveMQ extension)
- SUBSCRIBE includes `durable: true`, `activemq.subscriptionName: <subscriptionName>`, `ack: client-individual`

**Queue vs Topic:** Only topic destinations are accepted. Queues are rejected with HTTP 400 -- durable subscriptions are a JMS concept that only applies to topics.

**Message ACK:** Each received message is individually ACKed using the `ack` header from the MESSAGE frame (falling back to `message-id`).

**After disconnect:** The subscription persists on the broker. Messages published to the topic while the client is offline will queue up and be delivered on the next connect.

---

### `POST /api/activemq/durable-unsubscribe` -- Remove durable subscription

Connects with the same `clientId`, sends UNSUBSCRIBE with the durable headers, and disconnects. This removes the subscription and any queued messages from the broker.

**Request:**

| Field              | Type   | Default | Notes    |
|--------------------|--------|---------|----------|
| `host`             | string | required |         |
| `port`             | number | `61613` |         |
| `username`         | string | --      |         |
| `password`         | string | --      |         |
| `vhost`            | string | --      |         |
| `clientId`         | string | required |         |
| `subscriptionName` | string | required |         |
| `timeout`          | number | `10000` | ms      |

**STOMP UNSUBSCRIBE frame:**

```
UNSUBSCRIBE
id:durable-sub-0
activemq.subscriptionName:<subscriptionName>
durable:true
receipt:unsub-durable

\0
```

The CONNECT frame includes `client-id` to identify the durable subscription owner.

---

### `POST /api/activemq/queues` -- Round-trip queue test

Subscribes to a queue, sends a test message, and attempts to receive it. Used to verify end-to-end messaging. Defaults to admin/admin credentials.

**Request:**

| Field         | Type   | Default        | Notes |
|---------------|--------|----------------|-------|
| `host`        | string | required       |       |
| `port`        | number | `61613`        |       |
| `username`    | string | `admin`        |       |
| `password`    | string | `admin`        |       |
| `destination` | string | `/queue/TEST`  |       |
| `message`     | string | `hello`        |       |
| `timeout`     | number | `10000`        | ms    |

**Flow:** CONNECT, SUBSCRIBE (with receipt), SEND, wait for up to 3 frames (RECEIPT and/or MESSAGE), DISCONNECT.

**Success (200):**

```json
{
  "success": true,
  "latencyMs": 150,
  "sessionId": "session-abc123",
  "serverVersion": "1.2",
  "heartBeat": "0,0",
  "subscribeAck": true,
  "messageReceived": true,
  "destination": "/queue/TEST"
}
```

---

## OpenWire Protocol Reference

### Command Types (Data Type Byte)

| Value  | Command           | Notes                                  |
|--------|-------------------|----------------------------------------|
| `0x01` | WireFormatInfo    | First frame sent by both client and broker; special marshalling |
| `0x02` | BrokerInfo        | Broker sends after WireFormatInfo negotiation |
| `0x03` | WireFormatInfo (response) | Broker's WireFormatInfo response  |
| `0x05` | SessionInfo       |                                        |
| `0x06` | ConsumerInfo      |                                        |
| `0x07` | ProducerInfo      |                                        |
| `0x0E` | ShutdownInfo      |                                        |
| `0x15` | MessageDispatch   |                                        |
| `0x1F` | Response          |                                        |

### Connection Handshake Sequence

```
Client                          Broker
  |                               |
  |--- TCP connect -------------->|
  |                               |
  |--- WireFormatInfo (0x01) ---->|    (client sends version, options)
  |<-- WireFormatInfo (0x01) -----|    (broker responds with negotiated version/options)
  |<-- BrokerInfo (0x02) --------|    (broker name, fault-tolerant cluster info)
  |                               |
  [OpenWire session established]
```

The WireFormatInfo exchange negotiates the protocol version (min of client and broker), encoding options (tight encoding, caching), and capabilities. The implementation requests version 1 with an empty options map, accepting the broker's defaults.

### Frame Layout

OpenWire frames (with default size-prefix enabled):

```
+-------------------+------------------+
| Frame Length (4B)  | Frame Body       |
| big-endian uint32 | [length] bytes   |
+-------------------+------------------+
```

The frame body starts with a 1-byte data type, followed by command-specific marshalled data.

**WireFormatInfo body (special marshalling):**

```
[1B data type = 0x01]
[8B magic = "ActiveMQ"]
[4B version (int32 big-endian)]
[4B marshalledProperties length]
[marshalledProperties bytes...]
```

**Regular command body (BaseCommand marshalling):**

```
[1B data type]
[4B commandId (int32)]
[1B responseRequired (boolean)]
[4B correlationId (int32)]
[command-specific fields...]
```

---

## STOMP Frame Format

STOMP uses a plain-text frame format with NULL byte (`\x00`) terminator:

```
COMMAND\n
header1:value1\n
header2:value2\n
\n
Body (optional)\0
```

### Header Escaping (STOMP 1.1+)

The implementation escapes header values in non-CONNECT frames per the STOMP 1.1+ specification:

| Character | Escaped As |
|-----------|-----------|
| `\`       | `\\`      |
| `\n`      | `\n`      |
| `\r`      | `\r`      |
| `:`       | `\c`      |

CONNECT frames are exempt from escaping (per STOMP spec and broker compatibility).

### Frame Parsing

- `\r\n` line endings are normalised to `\n` before parsing
- Leading heartbeat newlines between frames are stripped
- Header name/value split on first `:` only -- values containing colons parse correctly
- Trailing NULL bytes are stripped

### STOMP Commands Used

| Command       | Direction       | Used By                    |
|---------------|-----------------|----------------------------|
| `CONNECT`     | Client -> Broker | All STOMP endpoints        |
| `SEND`        | Client -> Broker | `/send`, `/queues`         |
| `SUBSCRIBE`   | Client -> Broker | `/subscribe`, `/durable-subscribe`, `/queues` |
| `UNSUBSCRIBE` | Client -> Broker | `/subscribe`, `/durable-subscribe`, `/durable-unsubscribe` |
| `ACK`         | Client -> Broker | `/subscribe` (client modes), `/durable-subscribe` |
| `DISCONNECT`  | Client -> Broker | All STOMP endpoints        |
| `CONNECTED`   | Broker -> Client | All STOMP endpoints        |
| `MESSAGE`     | Broker -> Client | `/subscribe`, `/durable-subscribe`, `/queues` |
| `RECEIPT`     | Broker -> Client | `/send`, `/queues`         |
| `ERROR`       | Broker -> Client | All (on failure)           |

---

## Destination Naming

| Format              | Type                | Example              |
|---------------------|---------------------|----------------------|
| `/queue/name`       | Point-to-point queue | `/queue/orders`     |
| `/topic/name`       | Pub-sub topic        | `/topic/alerts`     |
| `/temp-queue/name`  | Temporary queue      | `/temp-queue/reply` |
| `/temp-topic/name`  | Temporary topic      | `/temp-topic/tmp`   |
| `queue://name`      | URI form (normalised)| `queue://orders`    |
| `topic://name`      | URI form (normalised)| `topic://alerts`    |

URI-form destinations (`queue://foo`, `topic://foo`) are automatically normalised to STOMP form (`/queue/foo`, `/topic/foo`) before being sent.

---

## Known Limitations

**No TLS.** Plain TCP only on all ports. SSL/TLS variants (OpenWire+SSL on 61617, STOMP+SSL on 61614) will fail at the TCP connect stage.

**No heartbeats.** The client sends `heart-beat:0,0` requesting no heartbeats. Long-lived connections (e.g. `durable-subscribe` with large timeout) may be disconnected by brokers that require heartbeats.

**No transaction support.** BEGIN/COMMIT/ROLLBACK STOMP commands are not implemented. All sends and acks are immediate.

**OpenWire probe is read-only.** The probe only performs the WireFormatInfo exchange and passively reads the BrokerInfo if present. It does not send a full connection sequence (no SessionInfo, ConsumerInfo, etc.).

**Jolokia admin requires admin console.** The `/admin` and `/info` endpoints require the ActiveMQ web console to be enabled (it is by default on Classic). Artemis uses a different Jolokia URL path which may not work with these endpoints.

**Broker name must be known for `/admin`.** The `/admin` endpoint requires the `brokerName` parameter (default: `localhost`). Use `/info` (wildcard query) if you don't know the broker name.

**Host validation excludes underscores and IPv6.** The host regex `[a-zA-Z0-9._:-]+` rejects IPv6 literals without brackets and hostnames with uncommon characters.

**maxMessages capped at 100.** Both `/subscribe` and `/durable-subscribe` silently cap `maxMessages` at 100 regardless of the value provided.

**Extra headers can override send defaults.** The `headers` field in `/send` is spread last, which means user-provided headers CAN override `destination`, `content-type`, `content-length`, `persistent`, `priority`, and `receipt`.

---

## curl Examples

```bash
# OpenWire probe -- detect broker on native port
curl -s -X POST https://portofcall.ross.gg/api/activemq/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"activemq.example.com"}' \
  | jq '{isActiveMQ, openWireVersion, brokerName}'

# STOMP connect -- verify credentials
curl -s -X POST https://portofcall.ross.gg/api/activemq/connect \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "activemq.example.com",
    "username": "admin",
    "password": "admin"
  }' | jq '{stompVersion, server}'

# Send a message to a queue
curl -s -X POST https://portofcall.ross.gg/api/activemq/send \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "activemq.example.com",
    "username": "admin",
    "password": "admin",
    "destination": "/queue/orders",
    "body": "Order #1001: 2x Widget",
    "persistent": true,
    "priority": 5
  }' | jq '{receiptReceived, bodyLength}'

# Send using URI-form destination
curl -s -X POST https://portofcall.ross.gg/api/activemq/send \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "activemq.example.com",
    "username": "admin",
    "password": "admin",
    "destination": "queue://orders",
    "body": "{\"type\":\"order\",\"id\":1001}",
    "contentType": "application/json"
  }' | jq .

# Send with TTL (expires in 60 seconds)
curl -s -X POST https://portofcall.ross.gg/api/activemq/send \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "activemq.example.com",
    "username": "admin",
    "password": "admin",
    "destination": "/queue/alerts",
    "body": "CPU > 90%",
    "ttl": 60000
  }' | jq .

# Consume up to 5 messages from a queue
curl -s -X POST https://portofcall.ross.gg/api/activemq/subscribe \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "activemq.example.com",
    "username": "admin",
    "password": "admin",
    "destination": "/queue/orders",
    "maxMessages": 5,
    "ackMode": "client-individual"
  }' | jq '.messages[] | {messageId, body}'

# Subscribe with JMS selector
curl -s -X POST https://portofcall.ross.gg/api/activemq/subscribe \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "activemq.example.com",
    "username": "admin",
    "password": "admin",
    "destination": "/topic/events",
    "selector": "priority > 5 AND type = '\''alert'\''",
    "maxMessages": 20
  }' | jq '.messageCount'

# Broker info (auto-detect broker name)
curl -s -X POST https://portofcall.ross.gg/api/activemq/info \
  -H 'Content-Type: application/json' \
  -d '{"host":"activemq.example.com"}' \
  | jq '{brokerName, brokerVersion, uptime, totalMessages}'

# Admin: list all queues
curl -s -X POST https://portofcall.ross.gg/api/activemq/admin \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "activemq.example.com",
    "action": "listQueues"
  }' | jq '.data[] | {name, queueSize, consumerCount}'

# Admin: get stats for a specific queue
curl -s -X POST https://portofcall.ross.gg/api/activemq/admin \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "activemq.example.com",
    "action": "queueStats",
    "queueName": "orders"
  }' | jq '.data | {queueSize, enqueueCount, dequeueCount}'

# Durable subscribe to a topic
curl -s -X POST https://portofcall.ross.gg/api/activemq/durable-subscribe \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "activemq.example.com",
    "username": "admin",
    "password": "admin",
    "destination": "/topic/alerts",
    "clientId": "monitoring-1",
    "subscriptionName": "alert-sub",
    "maxMessages": 10,
    "timeout": 15000
  }' | jq '{subscriptionName, messageCount}'

# Remove a durable subscription
curl -s -X POST https://portofcall.ross.gg/api/activemq/durable-unsubscribe \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "activemq.example.com",
    "username": "admin",
    "password": "admin",
    "clientId": "monitoring-1",
    "subscriptionName": "alert-sub"
  }' | jq .

# Round-trip queue test
curl -s -X POST https://portofcall.ross.gg/api/activemq/queues \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "activemq.example.com",
    "destination": "/queue/TEST",
    "message": "ping"
  }' | jq '{subscribeAck, messageReceived, latencyMs}'
```

---

## Local Testing

```bash
# ActiveMQ Classic (all protocols enabled by default)
docker run -d --name activemq \
  -p 61616:61616 -p 61613:61613 -p 8161:8161 \
  -e ACTIVEMQ_USERNAME=admin \
  -e ACTIVEMQ_PASSWORD=admin \
  apache/activemq-classic:latest

# ActiveMQ Artemis
docker run -d --name artemis \
  -p 61616:61616 -p 61613:61613 -p 8161:8161 \
  -e ARTEMIS_USER=admin \
  -e ARTEMIS_PASSWORD=admin \
  apache/activemq-artemis:latest-alpine

# Web admin console: http://localhost:8161/admin (admin/admin)
# Jolokia API:       http://localhost:8161/api/jolokia
```

---

## Resources

- [OpenWire protocol](https://activemq.apache.org/openwire)
- [ActiveMQ STOMP documentation](https://activemq.apache.org/stomp)
- [STOMP 1.2 specification](https://stomp.github.io/stomp-specification-1.2.html)
- [ActiveMQ REST API (Jolokia)](https://activemq.apache.org/rest)
- [ActiveMQ configuring transports](https://activemq.apache.org/configuring-transports)
- [Jolokia protocol reference](https://jolokia.org/reference/html/protocol.html)
- [JMS message selectors](https://docs.oracle.com/javaee/7/api/javax/jms/Message.html)
