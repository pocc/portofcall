# AMQP — Power User Reference

**Port:** 5672 | **Protocol:** AMQP 0-9-1 | **Transport:** TCP

Port of Call implements AMQP 0-9-1 as used by RabbitMQ. All six endpoints perform a full AMQP handshake (protocol header → Start/StartOk → Tune/TuneOk → Open/OpenOk → Channel.Open/OpenOk) and close cleanly (Channel.Close/CloseOk → Connection.Close/CloseOk) on every call.

---

## API Endpoints

### `POST /api/amqp/connect` — Connectivity probe

Performs the full handshake through Connection.OpenOk, reads server capabilities from the Connection.Start properties table, then closes.

**Request body:**

| Field      | Type   | Default  | Notes |
|------------|--------|----------|-------|
| `host`     | string | required | |
| `port`     | number | `5672`   | |
| `username` | string | `guest`  | |
| `password` | string | `guest`  | |
| `vhost`    | string | `/`      | |
| `timeout`  | number | `10000`  | ms |

**Success (200):**
```json
{
  "success": true,
  "host": "rabbitmq.example.com",
  "port": 5672,
  "serverVersion": "3.12.0",
  "platform": "Erlang/OTP 26.0",
  "mechanisms": "PLAIN AMQPLAIN",
  "locales": "en_US",
  "latencyMs": 42
}
```

---

### `POST /api/amqp/publish` — Publish a message

Declares an optional exchange, then publishes a message using `Basic.Publish` + Content Header + Content Body frames. Fire-and-forget — no delivery confirmation. Use `/api/amqp/confirm-publish` for guaranteed delivery.

**Request body:**

| Field          | Type    | Default    | Notes |
|----------------|---------|------------|-------|
| `host`         | string  | required   | |
| `port`         | number  | `5672`     | |
| `username`     | string  | `guest`    | |
| `password`     | string  | `guest`    | |
| `vhost`        | string  | `/`        | |
| `exchange`     | string  | `''`       | Default exchange: routes directly to queue named by routingKey |
| `exchangeType` | string  | `direct`   | `direct`, `fanout`, `topic`, `headers` |
| `durable`      | boolean | `false`    | Whether to declare the exchange as durable |
| `routingKey`   | string  | `''`       | Queue name for default exchange; routing key for named exchanges |
| `message`      | string  | `''`       | Message body (UTF-8) |
| `timeout`      | number  | `10000`    | ms |

**Success (200):**
```json
{
  "success": true,
  "host": "rabbitmq.example.com",
  "port": 5672,
  "exchange": "",
  "routingKey": "my-queue",
  "messageSize": 12,
  "latencyMs": 18
}
```

**curl example — publish to default exchange:**
```bash
curl -X POST https://portofcall.ross.gg/api/amqp/publish \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq.example.com","routingKey":"my-queue","message":"hello world"}'
```

**curl example — publish to topic exchange:**
```bash
curl -X POST https://portofcall.ross.gg/api/amqp/publish \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "rabbitmq.example.com",
    "exchange": "events",
    "exchangeType": "topic",
    "durable": true,
    "routingKey": "order.created",
    "message": "{\"orderId\":42}"
  }'
```

---

### `POST /api/amqp/confirm-publish` — Publish with broker acknowledgement

Activates RabbitMQ publisher confirms (`Confirm.Select`, class 85), publishes a message, then waits for `Basic.Ack` (method 29) or `Basic.Nack` (method 120) from the broker. Broker ACKs only after the message is durably stored (when the queue is durable and the message is persistent). Use this instead of `/api/amqp/publish` when you need guaranteed delivery guarantees.

**Request body:** identical to `/api/amqp/publish`, with:

| Additional field | Type   | Default | Notes |
|-----------------|--------|---------|-------|
| `timeout`       | number | `15000` | ms — longer default because ack can lag persist writes |

**Success (200):**
```json
{
  "success": true,
  "host": "rabbitmq.example.com",
  "port": 5672,
  "exchange": "",
  "routingKey": "my-queue",
  "messageSize": 11,
  "acked": true,
  "deliveryTag": "1",
  "multiple": false,
  "latencyMs": 31
}
```

- `acked: true` → `Basic.Ack` received; message is durably stored
- `acked: false` → `Basic.Nack` received; broker rejected the message (queue full, resource alarm, etc.)
- `deliveryTag` — broker's sequence number for this message (string, serialised bigint)
- `multiple` — if `true`, the ack/nack covers all messages up to `deliveryTag`

**curl example:**
```bash
curl -X POST https://portofcall.ross.gg/api/amqp/confirm-publish \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "rabbitmq.example.com",
    "exchange": "orders",
    "exchangeType": "direct",
    "durable": true,
    "routingKey": "priority",
    "message": "critical task",
    "timeout": 20000
  }'
```

---

### `POST /api/amqp/bind` — Bind a queue to an exchange

Sends `Queue.Bind` (class 50, method 20) and awaits `Queue.BindOk`. Use this to wire routing: after declaring both the exchange and queue independently, bind them so messages published to the exchange with a matching routing key are delivered to the queue.

For **fanout** exchanges the `routingKey` is ignored by the broker but must be present in the wire frame; pass `""`.

**Request body:**

| Field        | Type   | Default  | Notes |
|-------------|--------|----------|-------|
| `host`      | string | required | |
| `port`      | number | `5672`   | |
| `username`  | string | `guest`  | |
| `password`  | string | `guest`  | |
| `vhost`     | string | `/`      | |
| `queue`     | string | required | |
| `exchange`  | string | required | |
| `routingKey`| string | `''`     | Exact key (direct), pattern (topic), or ignored (fanout) |
| `timeout`   | number | `10000`  | ms |

**Success (200):**
```json
{
  "success": true,
  "queue": "my-queue",
  "exchange": "events",
  "routingKey": "order.*",
  "vhost": "/",
  "latencyMs": 22
}
```

**curl example — bind a queue to a topic exchange:**
```bash
curl -X POST https://portofcall.ross.gg/api/amqp/bind \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "rabbitmq.example.com",
    "queue": "order-processor",
    "exchange": "events",
    "routingKey": "order.*"
  }'
```

---

### `POST /api/amqp/get` — Synchronous pull (Basic.Get)

Sends `Basic.Get` (class 60, method 70) for a single message. Returns immediately with either a message (`Basic.GetOk`, method 71) or an empty response (`Basic.GetEmpty`, method 72). This is the pull model — the broker does not push; you poll.

Compare to `/api/amqp/consume` which uses `Basic.Consume` and collects multiple pushed messages.

**Request body:**

| Field    | Type    | Default  | Notes |
|---------|---------|----------|-------|
| `host`  | string  | required | |
| `port`  | number  | `5672`   | |
| `username` | string | `guest` | |
| `password` | string | `guest` | |
| `vhost` | string  | `/`      | |
| `queue` | string  | required | |
| `noAck` | boolean | `false`  | If `true`, broker removes message immediately; if `false`, you must ack |
| `ack`   | boolean | `false`  | When `noAck=false`, send `Basic.Ack` after receiving the message |
| `timeout` | number | `10000` | ms |

**Success — message available (200):**
```json
{
  "success": true,
  "empty": false,
  "message": {
    "deliveryTag": "1",
    "redelivered": false,
    "exchange": "",
    "routingKey": "my-queue",
    "messageCount": 3,
    "body": "hello world",
    "bodySize": 11
  },
  "latencyMs": 19
}
```

**Success — queue empty (200):**
```json
{
  "success": true,
  "empty": true,
  "latencyMs": 12
}
```

- `messageCount` — messages remaining in the queue after this get (from `Basic.GetOk` field)
- `redelivered` — `true` if the message was previously delivered and not acknowledged
- When `noAck=false` and `ack=false`, the message is re-queued on connection close

**curl example — pull and ack:**
```bash
curl -X POST https://portofcall.ross.gg/api/amqp/get \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq.example.com","queue":"my-queue","noAck":false,"ack":true}'
```

**curl example — peek without consuming:**
```bash
# noAck=false, ack=false: message is requeued on close
curl -X POST https://portofcall.ross.gg/api/amqp/get \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq.example.com","queue":"my-queue"}'
```

---

### `POST /api/amqp/consume` — Push-based consumer (Basic.Consume)

Sends `Basic.Consume` (class 60, method 20), collects pushed `Basic.Deliver` frames for up to `timeoutMs` ms or until `maxMessages` messages are received, then closes.

**Request body:**

| Field         | Type   | Default | Notes |
|--------------|--------|---------|-------|
| `host`       | string | required | |
| `port`       | number | `5672`  | |
| `username`   | string | `guest` | |
| `password`   | string | `guest` | |
| `vhost`      | string | `/`     | |
| `queue`      | string | required | |
| `maxMessages`| number | `10`    | Stop after collecting this many |
| `timeoutMs`  | number | `3000`  | Stop after this many ms |

**Success (200):**
```json
{
  "success": true,
  "queue": "my-queue",
  "messageCount": 2,
  "messages": [
    {
      "deliveryTag": 1,
      "exchange": "",
      "routingKey": "my-queue",
      "body": "first message"
    },
    {
      "deliveryTag": 2,
      "exchange": "",
      "routingKey": "my-queue",
      "body": "second message"
    }
  ],
  "latencyMs": 3012
}
```

**curl example:**
```bash
curl -X POST https://portofcall.ross.gg/api/amqp/consume \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq.example.com","queue":"my-queue","maxMessages":5,"timeoutMs":2000}'
```

---

## Wire Protocol Detail

### Protocol Header

```
41 4d 51 50   "AMQP"
00            Protocol ID
00            Major 0
09            Minor 9
01            Revision 1
```

### Frame Format

```
[type: 1 byte][channel: 2 bytes BE][size: 4 bytes BE][payload: size bytes][0xCE]
```

Frame types: `1` = METHOD, `2` = HEADER, `3` = BODY, `8` = HEARTBEAT

### Handshake Sequence

```
→ AMQP\x00\x00\x09\x01          (protocol header, 8 bytes)
← Connection.Start (10,10)       (server capabilities, mechanisms, version)
→ Connection.StartOk (10,11)     (SASL PLAIN: \x00{user}\x00{pass} as longstr)
← Connection.Tune (10,30)        (channelMax, frameMax, heartbeat)
→ Connection.TuneOk (10,31)      (echo back or propose lower values)
→ Connection.Open (10,40)        (vhost)
← Connection.OpenOk (10,41)
→ Channel.Open (20,10)
← Channel.OpenOk (20,11)
```

### Publisher Confirms

```
→ Confirm.Select (85,10)         (nowait=false)
← Confirm.SelectOk (85,11)
→ Basic.Publish + Header + Body  (delivery-tag=1)
← Basic.Ack (60,29)              (deliveryTag: uint64, multiple: bool)
   -- or --
← Basic.Nack (60,120)            (deliveryTag: uint64, multiple: bool, requeue: bool)
```

### Queue.Bind

```
→ Queue.Bind (50,20)             (reserved1, queue, exchange, routingKey, no-wait, arguments)
← Queue.BindOk (50,21)
```

### Basic.Get

```
→ Basic.Get (60,70)              (reserved1, queue, no-ack)
← Basic.GetOk (60,71)           (deliveryTag, redelivered, exchange, routingKey, messageCount)
   + HEADER frame                 (content-class=60, body-size, property-flags)
   + BODY frame(s)                (message content)
   -- or --
← Basic.GetEmpty (60,72)         (cluster-id shortstr, now always "")
```

### SASL Auth

Auth uses SASL PLAIN encoded as a long string (4-byte big-endian length prefix):

```
\x00{username}\x00{password}
```

No other SASL mechanisms (AMQPLAIN, EXTERNAL, SCRAM-SHA-256) are supported.

---

## Endpoint Summary

| Endpoint | Method | Description |
|---|---|---|
| /api/amqp/connect | POST | Protocol probe — handshake only |
| /api/amqp/publish | POST | Publish (fire-and-forget) |
| /api/amqp/confirm-publish | POST | Publish with broker ACK (publisher confirms) |
| /api/amqp/bind | POST | Bind queue to exchange |
| /api/amqp/get | POST | Synchronous pull (Basic.Get) |
| /api/amqp/consume | POST | Push consumer (Basic.Consume, multi-message) |

---

## Known Limitations

### SASL PLAIN only

Only SASL PLAIN is implemented (`\x00user\x00pass` as a long string in `Connection.StartOk`). AMQPLAIN, EXTERNAL, and SCRAM-SHA-256 are not supported.

### No message properties

The Content Header frame sends only `body-size` with no property flags set. `content-type`, `delivery-mode` (persistent=2), `priority`, `correlation-id`, `reply-to`, `expiration`, and `message-id` are all absent. To publish a persistent message you need delivery-mode=2 in the properties; without it the broker treats the message as transient even on a durable queue.

### No per-queue Queue.Declare

`/api/amqp/get` reads the queue's message count by inspecting the `Basic.GetOk` response; it does not send `Queue.Declare` with `passive=true` first. `Queue.Declare` (class 50, method 10) is implemented internally for consume only — not exposed as its own endpoint.

### Exchange types accepted but not validated

`exchangeType` is passed verbatim to `Exchange.Declare`. If you pass an invalid type (`"foo"`) the broker closes the channel with `command-invalid (503)`.

### No AMQPS (TLS)

AMQP over TLS (port 5671) is a separate worker file (`amqps.ts`). Both plain AMQP (this file, port 5672) and AMQPS (port 5671) are available as separate endpoint groups.

### No heartbeat keepalive

`Connection.TuneOk` echoes the broker's heartbeat value but the worker never sends heartbeat frames. For the short-lived connections used here this is not a problem — connections complete in milliseconds. Long-running consumers that time out at the OS level may see the broker close the connection with `heartbeat timeout`.

### Single channel

All operations use channel 1. Operations that internally require multiple channels (e.g. consuming from two queues simultaneously) are not supported.

### Consumer ack mode

`/api/amqp/consume` uses `no-ack=true` (auto-ack). Messages are removed from the queue as soon as they are delivered. There is no explicit ack flow.

---

## Resources

- [AMQP 0-9-1 Reference](https://www.rabbitmq.com/amqp-0-9-1-reference.html)
- [Publisher Confirms](https://www.rabbitmq.com/confirms.html)
- [Consumer Acknowledgements](https://www.rabbitmq.com/confirms.html#consumer-acknowledgements)
- [Routing](https://www.rabbitmq.com/tutorials/tutorial-four-javascript.html) — direct, topic, fanout, headers
