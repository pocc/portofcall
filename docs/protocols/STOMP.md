# STOMP — Power User Reference

**Port:** 61613 | **Protocol:** STOMP 1.2 | **Deployed**

Port of Call implements the STOMP text-frame protocol directly over TCP — no STOMP client library. All three endpoints open a fresh TCP connection, exchange text frames delimited by NULL bytes, and return JSON.

**Compatible brokers:** RabbitMQ, ActiveMQ, Apollo, Artemis. **No TLS** — plain TCP only. STOMP over WebSocket (port 15674) is not supported.

---

## API Endpoints

### `POST /api/stomp/connect` — Broker probe

Sends a CONNECT frame and returns the broker's CONNECTED (or ERROR) response, then disconnects.

**Request:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | Validated: `[a-zA-Z0-9.-]+` only |
| `port` | number | `61613` | |
| `username` | string | — | Sent as `login` header |
| `password` | string | — | Sent as `passcode` header |
| `vhost` | string | — | Sent as STOMP `host` header; defaults to `host` if omitted |
| `timeout` | number (ms) | `10000` | |

**Success (200):**
```json
{
  "success": true,
  "version": "1.2",
  "server": "RabbitMQ/3.12.0",
  "heartBeat": "0,0",
  "sessionId": "session-abc123",
  "headers": {
    "version": "1.2",
    "server": "RabbitMQ/3.12.0",
    "heart-beat": "0,0",
    "session": "session-abc123"
  }
}
```

`headers` contains the full CONNECTED frame header map. `heartBeat` is the broker's negotiated heart-beat value (always `"0,0"` since the client requests `0,0` in the CONNECT frame).

**STOMP ERROR (200, success: false):**
```json
{
  "success": false,
  "error": "Bad CONNECT",
  "headers": { "message": "Bad CONNECT", "content-type": "text/plain" }
}
```

**Response accumulation:** The reader loops until a NULL byte (`\x00`) appears in any received chunk, or 16 KB is accumulated. The NULL byte check is on the most recently read chunk only — if the frame-terminating NULL arrives as a standalone TCP packet after the frame data, the loop will continue reading one more chunk and will capture it correctly. If 16 KB arrives without a NULL byte (unlikely in normal brokers), a "Response too large" error is thrown.

**After reading CONNECTED:** A DISCONNECT frame with `receipt: disconnect-receipt` is sent (broker may not respond before the socket closes).

---

### `POST /api/stomp/send` — Send a message

Authenticates, sends one message to a destination, waits for a RECEIPT frame, then disconnects.

**Request:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `61613` | |
| `username` | string | — | |
| `password` | string | — | |
| `vhost` | string | — | |
| `destination` | string | required | Must match `/^\/[a-zA-Z0-9/_.-]+$/` |
| `body` | string | required | Message payload (string only) |
| `contentType` | string | `"text/plain"` | Sent as `content-type` header |
| `headers` | object | `{}` | Additional STOMP headers merged into SEND frame |
| `timeout` | number (ms) | `10000` | |

**Success (200):**
```json
{
  "success": true,
  "destination": "/queue/orders",
  "bodyLength": 42,
  "receiptReceived": true,
  "brokerVersion": "1.2",
  "brokerServer": "RabbitMQ/3.12.0"
}
```

**`receiptReceived: false` with `success: true`:** If the RECEIPT doesn't arrive before the timeout, the timeout catch block is silently swallowed. The response returns `success: true, receiptReceived: false` — the message may or may not have been delivered. This is expected behavior when sending to high-latency brokers; it is NOT a send failure.

**`bodyLength` vs actual bytes:** `bodyLength` is `messageBody.length` — the JavaScript string character count. The `content-length` header sent to the broker is the UTF-8 byte count. For ASCII bodies these are equal; for multi-byte characters (emoji, CJK) `bodyLength` will be smaller than the actual content-length.

**Destination validation:** Only applies to `/send`, not `/subscribe`. Must start with `/` and contain only `[a-zA-Z0-9/_.-]`. Destinations with `#`, `*`, spaces, or special characters are rejected with HTTP 400. RabbitMQ's exchange destinations (e.g. `/exchange/amq.topic/routing.key`) and ActiveMQ virtual topics (e.g. `VirtualTopic.>`) that use special characters will be rejected.

**SEND frame headers:** The implementation always adds `receipt: send-receipt` to the SEND headers. If you pass `receipt` in your `headers` object, it will be merged (and your value takes precedence over the default since custom headers are spread after the initial headers — actually wait, let me check this). Looking at the code: `const sendHeaders = { destination, 'content-type': contentType, 'content-length': ..., receipt: 'send-receipt', ...customHeaders }` — custom headers are spread last, so they CAN override `receipt`, `destination`, and `content-type`.

**DISCONNECT at end:** Sent without a `receipt` header. No wait for broker DISCONNECT acknowledgment.

---

### `POST /api/stomp/subscribe` — Consume messages

Authenticates, subscribes to a destination, collects incoming MESSAGE frames up to `maxMessages`, then unsubscribes and disconnects.

**Request:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `61613` | |
| `username` | string | — | |
| `password` | string | — | |
| `vhost` | string | — | |
| `destination` | string | required | No format validation (unlike `/send`) |
| `maxMessages` | number | `10` | Capped at 50 |
| `timeout` | number (ms) | `10000` | |

**Success (200):**
```json
{
  "success": true,
  "destination": "/queue/orders",
  "messageCount": 3,
  "messages": [
    {
      "destination": "/queue/orders",
      "body": "Order #1001 placed",
      "headers": {
        "message-id": "T_001",
        "subscription": "sub-0",
        "destination": "/queue/orders",
        "content-type": "text/plain",
        "content-length": "18"
      }
    }
  ],
  "brokerVersion": "1.2",
  "brokerServer": "RabbitMQ/3.12.0"
}
```

**Collection deadline:** Message collection stops at `min(timeout - 500ms, 8000ms)`. Even with `timeout: 60000`, collection stops after 8 seconds. This is a hardcoded cap in the implementation.

**Subscription ID:** Hardcoded to `"sub-0"`. `ack` mode is `auto` — the broker automatically acks messages without waiting for an explicit ACK frame. No explicit ACK/NACK is sent.

**No destination validation:** Unlike `/send`, `/subscribe` does not validate the destination format. Any string is sent as-is in the SUBSCRIBE frame.

**Buffer carryover:** Any data received in the same TCP read as the CONNECTED frame (common with brokers that queue messages immediately after SUBSCRIBE) is preserved and parsed as MESSAGE frames before the next `reader.read()` call. This avoids a race condition where early messages would be lost.

**Empty queue behavior:** If the queue is empty, the endpoint returns `success: true, messageCount: 0, messages: []` after the collect deadline expires.

**UNSUBSCRIBE + DISCONNECT at end:** UNSUBSCRIBE is sent with the subscription ID `sub-0`. DISCONNECT includes `receipt: disc-1` but no wait for the RECEIPT.

---

## Frame Format

STOMP uses a plain-text frame format:

```
COMMAND\n
header1:value1\n
header2:value2\n
\n
Body (optional)\0
```

The frame terminator is a single NULL byte (`\x00`, `0x00`). Carriage returns (`\r`) are not stripped — the implementation splits on `\n` only, so `\r\n` line endings will leave `\r` on header values. Standard brokers use `\n` only.

**Header parsing:** `line.indexOf(':')` finds the first colon — header values containing colons (e.g. `content-type: application/json; charset=utf-8`) are parsed correctly. Header names are preserved as-is (not lowercased).

**Frame building (`buildFrame`):** Header values are written as-is with no escaping. STOMP 1.1+ requires that `\r`, `\n`, and `:` be escaped in header values (`\r`, `\n`, `\c`). The implementation does not escape these, so header values containing newlines or colons will produce malformed frames.

---

## STOMP Frame Reference

| Command | Direction | Used by |
|---|---|---|
| `CONNECT` | Client→Broker | `/connect`, `/send`, `/subscribe` |
| `SEND` | Client→Broker | `/send` |
| `SUBSCRIBE` | Client→Broker | `/subscribe` |
| `UNSUBSCRIBE` | Client→Broker | `/subscribe` |
| `DISCONNECT` | Client→Broker | All endpoints |
| `CONNECTED` | Broker→Client | All endpoints |
| `MESSAGE` | Broker→Client | `/subscribe` |
| `RECEIPT` | Broker→Client | `/send` |
| `ERROR` | Broker→Client | All endpoints (on failure) |

### CONNECT Frame (sent by all endpoints)

```
CONNECT
accept-version:1.0,1.1,1.2
host:<vhost or host>
heart-beat:0,0
login:<username>         ← only if username provided
passcode:<password>      ← only if password provided

\0
```

### SEND Frame

```
SEND
destination:<destination>
content-type:<contentType>
content-length:<utf8 byte count>
receipt:send-receipt
[custom headers...]

<body>\0
```

---

## Known Limitations

**No TLS.** Plain TCP only. STOMP over SSL/TLS (port 61614 on RabbitMQ) will fail.

**No WebSocket STOMP.** RabbitMQ's WebSocket STOMP plugin (port 15674) requires an HTTP Upgrade — not supported.

**Collection capped at 8 seconds.** The `min(timeout - 500ms, 8000ms)` formula means even large timeouts won't extend message collection beyond 8s. High-throughput queues will always be truncated at 50 messages regardless of rate.

**No ACK/NACK control.** All subscriptions use `ack: auto`. Messages are auto-acknowledged and cannot be rejected or requeued via this API.

**No transaction support.** BEGIN/COMMIT/ROLLBACK are not implemented.

**Header values not escaped.** Header values with embedded newlines or colons will produce malformed frames — not detected or rejected by the implementation.

**Destination regex excludes some valid destinations.** `/send` rejects destinations containing `*`, `#`, `>`, spaces, or `@`. RabbitMQ topic wildcards (`#`, `*`), ActiveMQ wildcard subscriptions (`>`, `*`), and some exchange routing keys will fail the client-side validation.

**`bodyLength` is character count, not byte count.** For non-ASCII bodies, `bodyLength` in the response will be smaller than the actual bytes transmitted.

**Host validation excludes underscores and IPv6.** The host regex `/^[a-zA-Z0-9.-]+$/` rejects hostnames with underscores (common in internal DNS) and IPv6 literals (contain `:`). Use IP or a hostname without underscores.

---

## curl Examples

```bash
# Probe: detect broker version and server
curl -s -X POST https://portofcall.ross.gg/api/stomp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq.example.com","username":"guest","password":"guest"}' \
  | jq '{version, server: .server}'

# Probe anonymous (no-auth broker)
curl -s -X POST https://portofcall.ross.gg/api/stomp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"activemq.example.com","port":61613}' \
  | jq '.version'

# Send plain text message to a queue
curl -s -X POST https://portofcall.ross.gg/api/stomp/send \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "rabbitmq.example.com",
    "username": "guest",
    "password": "guest",
    "destination": "/queue/orders",
    "body": "Order #1001: 2x Widget"
  }' | jq '{receiptReceived, bodyLength}'

# Send JSON message
curl -s -X POST https://portofcall.ross.gg/api/stomp/send \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "rabbitmq.example.com",
    "username": "guest",
    "password": "guest",
    "destination": "/queue/events",
    "body": "{\"type\":\"order\",\"id\":1001}",
    "contentType": "application/json"
  }' | jq '.receiptReceived'

# Send with custom STOMP headers
curl -s -X POST https://portofcall.ross.gg/api/stomp/send \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "rabbitmq.example.com",
    "username": "guest",
    "password": "guest",
    "destination": "/queue/jobs",
    "body": "process-user-42",
    "headers": {
      "priority": "9",
      "expires": "60000",
      "persistent": "true"
    }
  }' | jq .

# Consume up to 5 messages from a queue
curl -s -X POST https://portofcall.ross.gg/api/stomp/subscribe \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "rabbitmq.example.com",
    "username": "guest",
    "password": "guest",
    "destination": "/queue/orders",
    "maxMessages": 5
  }' | jq '.messages[] | {body: .body, dest: .destination}'

# RabbitMQ vhost (non-default vhost requires vhost field)
curl -s -X POST https://portofcall.ross.gg/api/stomp/connect \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "rabbitmq.example.com",
    "username": "myapp",
    "password": "secret",
    "vhost": "/production"
  }' | jq .
```

---

## Local Testing

```bash
# RabbitMQ with STOMP plugin (default vhost, guest/guest)
docker run -d --name rabbit-stomp \
  -p 61613:61613 -p 5672:5672 -p 15672:15672 \
  -e RABBITMQ_DEFAULT_USER=guest \
  -e RABBITMQ_DEFAULT_PASS=guest \
  rabbitmq:3-management
# Enable STOMP plugin (may need a moment for management API to start)
docker exec rabbit-stomp rabbitmq-plugins enable rabbitmq_stomp

# ActiveMQ Classic (STOMP enabled by default on 61613)
docker run -d --name activemq \
  -p 61613:61613 -p 8161:8161 \
  apache/activemq-classic:latest

# Artemis (STOMP on 61613 by default)
docker run -d --name artemis \
  -p 61613:61613 -p 8161:8161 \
  -e ARTEMIS_USER=admin \
  -e ARTEMIS_PASSWORD=admin \
  apache/activemq-artemis:latest-alpine
```

---

## Resources

- [STOMP 1.2 specification](https://stomp.github.io/stomp-specification-1.2.html)
- [RabbitMQ STOMP plugin](https://www.rabbitmq.com/stomp.html)
- [ActiveMQ STOMP documentation](https://activemq.apache.org/stomp)
- [Artemis STOMP documentation](https://activemq.apache.org/components/artemis/documentation/latest/stomp.html)
