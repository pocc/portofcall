# AMQPS — Power User Reference

**Port:** 5671 | **Protocol:** AMQP 0-9-1 over TLS | **Transport:** TCP+TLS

AMQPS is AMQP 0-9-1 wrapped in implicit TLS — the TLS handshake happens first, and the AMQP protocol header is sent over the encrypted channel. There is no STARTTLS upgrade; the TLS layer is unconditional from the first byte of the connection.

---

## How AMQPS Differs from Plain AMQP

| Aspect | AMQP (port 5672) | AMQPS (port 5671) |
|--------|-----------------|-------------------|
| Transport | Raw TCP | TLS over TCP |
| First bytes on wire | `41 4d 51 50 00 00 09 01` (protocol header) | TLS ClientHello |
| Protocol header timing | Immediately after TCP connect | After TLS handshake completes |
| AMQP framing | Identical | Identical (inside TLS record layer) |
| SASL | PLAIN over cleartext | PLAIN over encrypted channel |
| Default port | 5672 | 5671 |
| Certificate verification | N/A | Performed by Cloudflare Workers runtime |
| SNI | N/A | Sent by Cloudflare Workers runtime using the host name |

The wire protocol above the TLS layer is byte-for-byte identical between AMQP and AMQPS. All frame types, class/method numbering, field table encoding, and SASL exchange are the same.

---

## API Endpoints

All AMQPS endpoints are identical in behaviour to their plain AMQP counterparts, but use `secureTransport: 'on'` (Cloudflare Sockets API) and default to port 5671.

### `POST /api/amqps/connect` — TLS + protocol probe

Performs TLS handshake, sends the AMQP 0-9-1 protocol header, and parses the `Connection.Start` response to extract server product, version, platform, and auth mechanisms. Closes immediately after — does not authenticate.

**Request body:**

| Field  | Type   | Default | Notes |
|--------|--------|---------|-------|
| `host` | string | required | Hostname or IP |
| `port` | number | `5671`  | Override for non-standard AMQPS ports |

**Success (200):**
```json
{
  "success": true,
  "secure": true,
  "protocol": "AMQP 0.9",
  "product": "RabbitMQ",
  "version": "3.12.0",
  "platform": "Erlang/OTP 26.0",
  "mechanisms": "PLAIN AMQPLAIN",
  "locales": "en_US",
  "serverProperties": {
    "product": "RabbitMQ",
    "version": "3.12.0",
    "platform": "Erlang/OTP 26.0",
    "copyright": "...",
    "information": "...",
    "capabilities": "{...}"
  },
  "message": "Successfully connected to AMQPS broker over TLS"
}
```

**curl example:**
```bash
curl -X POST https://portofcall.ross.gg/api/amqps/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq.example.com"}'
```

---

### `POST /api/amqps/publish` — Publish over TLS

Full AMQP handshake over TLS, optional exchange declare, then `Basic.Publish` + Content Header + Content Body. Fire-and-forget — no delivery confirmation. Use a plain `/api/amqp/confirm-publish` pattern when confirmation is needed (no AMQPS-specific confirm endpoint exists yet).

**Request body:**

| Field          | Type    | Default  | Notes |
|----------------|---------|----------|-------|
| `host`         | string  | required | |
| `port`         | number  | `5671`   | |
| `username`     | string  | `guest`  | |
| `password`     | string  | `guest`  | |
| `vhost`        | string  | `/`      | |
| `exchange`     | string  | `''`     | Empty string = default exchange (route to queue by routing key) |
| `exchangeType` | string  | `direct` | `direct`, `fanout`, `topic`, `headers` |
| `durable`      | boolean | `false`  | Whether to declare the exchange as durable |
| `routingKey`   | string  | `''`     | Queue name for default exchange; routing key for named exchanges |
| `message`      | string  | `''`     | Message body (UTF-8) |
| `timeout`      | number  | `15000`  | ms |

**Success (200):**
```json
{
  "success": true,
  "host": "rabbitmq.example.com",
  "port": 5671,
  "exchange": "",
  "routingKey": "my-queue",
  "messageSize": 11,
  "message": "Message published successfully"
}
```

**curl example — publish to default exchange over TLS:**
```bash
curl -X POST https://portofcall.ross.gg/api/amqps/publish \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "rabbitmq.example.com",
    "routingKey": "my-queue",
    "message": "hello from AMQPS"
  }'
```

**curl example — topic exchange, durable, over TLS:**
```bash
curl -X POST https://portofcall.ross.gg/api/amqps/publish \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "rabbitmq.example.com",
    "username": "admin",
    "password": "secret",
    "vhost": "production",
    "exchange": "events",
    "exchangeType": "topic",
    "durable": true,
    "routingKey": "order.created",
    "message": "{\"orderId\":42}"
  }'
```

---

### `POST /api/amqps/consume` — Push consumer over TLS

Full AMQP handshake over TLS, `Queue.Declare`, `Basic.Consume`, collect pushed `Basic.Deliver` frames for up to `timeoutMs` ms or `maxMessages` messages, then closes.

**Request body:**

| Field          | Type   | Default | Notes |
|----------------|--------|---------|-------|
| `host`         | string | required | |
| `port`         | number | `5671`  | |
| `username`     | string | `guest` | |
| `password`     | string | `guest` | |
| `vhost`        | string | `/`     | |
| `queue`        | string | required | |
| `maxMessages`  | number | `10`    | Stop after collecting this many messages |
| `timeoutMs`    | number | `3000`  | Stop after this many ms |

**Success (200):**
```json
{
  "success": true,
  "secure": true,
  "host": "rabbitmq.example.com",
  "port": 5671,
  "queue": "my-queue",
  "messageCount": 2,
  "messages": [
    { "exchange": "", "routing_key": "my-queue", "body_text": "first message" },
    { "exchange": "", "routing_key": "my-queue", "body_text": "second message" }
  ]
}
```

Note: the `secure: true` field is added by the AMQPS consume handler on top of the base `doAMQPConsume` result.

**curl example:**
```bash
curl -X POST https://portofcall.ross.gg/api/amqps/consume \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq.example.com","queue":"my-queue","maxMessages":5,"timeoutMs":2000}'
```

---

## Wire Protocol

### TLS Layer

The Cloudflare Workers runtime handles TLS automatically when `secureTransport: 'on'` is set on the socket. SNI is sent using the target hostname. Certificate verification is performed by the runtime — self-signed certificates will cause the connection to fail unless the broker's certificate is signed by a trusted CA.

There is no way to disable certificate verification or pin a specific certificate from within a Cloudflare Worker.

### TLS + AMQP Handshake Sequence

```
TCP connect to host:5671
  → TLS ClientHello (SNI=host)
  ← TLS ServerHello + Certificate + ServerHelloDone
  → TLS ClientKeyExchange + ChangeCipherSpec + Finished
  ← TLS ChangeCipherSpec + Finished
  [all subsequent bytes are TLS-encrypted Application Data records]
→ 41 4d 51 50 00 00 09 01        AMQP protocol header (8 bytes)
← METHOD frame: Connection.Start (class 10, method 10)
→ METHOD frame: Connection.StartOk (class 10, method 11)  [SASL PLAIN]
← METHOD frame: Connection.Tune (class 10, method 30)
→ METHOD frame: Connection.TuneOk (class 10, method 31)
→ METHOD frame: Connection.Open (class 10, method 40)
← METHOD frame: Connection.OpenOk (class 10, method 41)
→ METHOD frame: Channel.Open (class 20, method 10)
← METHOD frame: Channel.OpenOk (class 20, method 11)
  [... exchange declare, publish, consume, get, etc. ...]
→ METHOD frame: Channel.Close (class 20, method 40)
← METHOD frame: Channel.CloseOk (class 20, method 41)
→ METHOD frame: Connection.Close (class 10, method 50)
← METHOD frame: Connection.CloseOk (class 10, method 51)
TCP FIN
```

### AMQP Frame Format (inside TLS records)

```
[type: 1 byte][channel: 2 bytes BE][size: 4 bytes BE][payload: size bytes][0xCE]
```

Frame types:
- `1` = METHOD
- `2` = HEADER (content header)
- `3` = BODY (content body)
- `8` = HEARTBEAT

Frame-end sentinel is always `0xCE` (206). A mismatch is a protocol error.

### AMQP Protocol Header

```
Offset  Length  Value       Meaning
0       4       41 4d 51 50 "AMQP" literal
4       1       00          Protocol ID (always 0 for AMQP 0-9-1)
5       1       00          Major version (0)
6       1       09          Minor version (9)
7       1       01          Revision (1)
```

If the server does not support AMQP 0-9-1, it may respond with its own protocol header (different version bytes) and close the connection.

### SASL Authentication

AMQPS uses SASL PLAIN in `Connection.StartOk`. The response is encoded as an AMQP long string (4-byte big-endian length prefix):

```
\x00{username}\x00{password}
```

Over AMQPS, this travels inside TLS records and is therefore encrypted. Over plain AMQP (port 5672), the credentials are in cleartext.

Only SASL PLAIN is implemented. AMQPLAIN, EXTERNAL, and SCRAM-SHA-256 are not supported.

### Connection.Start — Server Properties Field Table

The `Connection.Start` method carries a field table (`server-properties`) containing broker identity information. Common fields:

| Field name    | AMQP type | Typical value |
|---------------|-----------|---------------|
| `product`     | S         | `"RabbitMQ"` |
| `version`     | S         | `"3.12.0"` |
| `platform`    | S         | `"Erlang/OTP 26.0"` |
| `copyright`   | S         | License text |
| `information` | S         | RabbitMQ URL |
| `capabilities`| F         | Nested table of broker capabilities |

The `capabilities` nested table typically contains boolean fields such as `publisher_confirms`, `exchange_exchange_bindings`, `basic.nack`, `consumer_cancel_notify`, `connection.blocked`, `consumer_priorities`, `authentication_failure_close`, `per_consumer_qos`, `direct_reply_to`.

The `readFieldTable` implementation in `amqps.ts` handles all standard AMQP field types: `S` (long string), `s` (short string), `F` (nested table), `I` (int32), `t` (boolean), `l` (int64), `d` (double), `T` (timestamp/uint64), `D` (decimal), `A` (array), `b`/`B` (byte), `u` (unsigned short).

---

## SASL Edge Cases

### SASL PLAIN null-byte framing

The PLAIN response is `\x00username\x00password` encoded as an AMQP long string. The null bytes are literal NUL characters (0x00), not escape sequences. The 4-byte length prefix counts the NUL bytes:

```
00 00 00 0D          length = 13 (for "guest" / "guest")
00                   NUL separator
67 75 65 73 74       "guest" (username)
00                   NUL separator
67 75 65 73 74       "guest" (password)
```

### Username or password containing NUL bytes

Not handled. If a username or password contains a NUL byte (0x00), the PLAIN framing is ambiguous. The `TextEncoder` will encode any NUL in the username/password string as 0x00, corrupting the framing. Usernames and passwords with embedded NUL bytes are not supported.

### AMQPLAIN

Some older brokers (e.g., Qpid, ActiveMQ) prefer `AMQPLAIN` over `PLAIN`. The `AMQPLAIN` response is a field table: `{"LOGIN": "user", "PASSWORD": "pass"}`. This is not implemented; if the server advertises only `AMQPLAIN` in `mechanisms`, authentication will fail.

---

## Known Limitations

### TLS certificate verification

Cloudflare Workers perform full certificate verification. Self-signed certificates, expired certificates, and certificates with hostname mismatches will cause the connection to fail. There is no way to disable this from the Worker.

### SASL PLAIN only

Only SASL PLAIN is implemented. Brokers that disable PLAIN and require AMQPLAIN, EXTERNAL, or SCRAM-SHA-256 are not supported.

### No publisher confirms on AMQPS

The `/api/amqps/publish` endpoint is fire-and-forget. There is no AMQPS-specific confirm-publish endpoint. Publisher confirms (Confirm.Select / Basic.Ack) are implemented only on the plain AMQP path (`/api/amqp/confirm-publish`).

### No message persistence properties

The Content Header frame sets only `body-size`. The `delivery-mode` property (value `2` = persistent) is not set. Messages published via this endpoint are transient even on durable queues — the broker will not persist them to disk and they will be lost on broker restart.

### No per-message content-type

The Content Header frame in `doAMQPPublish` (shared with the AMQPS publish path) sends `content-type: text/plain` with `property-flags = 0x8000`. Other properties (`correlation-id`, `reply-to`, `message-id`, `expiration`, `priority`) are absent.

### No heartbeat keepalive

`Connection.TuneOk` echoes the broker's negotiated heartbeat interval, but no heartbeat frames are ever sent. For the short-lived connections used here this is not a problem. A broker with a very short heartbeat timeout (< 1 second) may close the connection before the operation completes.

### No AMQP 1.0 or AMQP 0-10

Only AMQP 0-9-1 is implemented. AMQP 1.0 (used by Azure Service Bus, ActiveMQ Artemis) and AMQP 0-10 (used by Qpid) use different protocol headers and framing and are not supported.

### Azure Service Bus AMQPS

Azure Service Bus uses AMQP 1.0, not AMQP 0-9-1. Port 5671 is open, TLS connects, but the protocol header will be rejected and the broker will close the connection.

### Single channel

All operations use channel 1. Multi-channel operations are not supported.

### Consumer no-ack mode

`/api/amqps/consume` uses `no-ack=true` (bit 1 set in the flags byte of `Basic.Consume`). Messages are removed from the queue as soon as they are delivered — there is no opportunity to nack or reject.

### `readExact` does not buffer excess bytes

When the socket delivers a chunk larger than `n` bytes in a single `reader.read()` call, the surplus bytes are discarded. For the connect probe (single handshake frame) this is acceptable because no further reads occur. For multi-frame operations (publish, consume) the shared `doAMQPPublish` / `doAMQPConsume` functions in `amqp.ts` have the same limitation — excess bytes within a single chunk are lost. In practice, Cloudflare Sockets deliver data in chunks that respect frame boundaries for small payloads, but this is not guaranteed.

### Method-not-allowed check is missing on some paths

`handleAMQPSPublish` and `handleAMQPSConsume` check `request.method !== 'POST'` and return 405. `handleAMQPSConnect` also checks. This is consistent.

---

## Comparison: AMQPS vs AMQP Endpoint Sets

| Endpoint | AMQP | AMQPS | Notes |
|----------|------|-------|-------|
| connect | `/api/amqp/connect` | `/api/amqps/connect` | Both probe only |
| publish | `/api/amqp/publish` | `/api/amqps/publish` | Both support exchangeType/durable |
| consume | `/api/amqp/consume` | `/api/amqps/consume` | Identical except secureTransport |
| confirm-publish | `/api/amqp/confirm-publish` | — | No TLS equivalent yet |
| bind | `/api/amqp/bind` | — | No TLS equivalent yet |
| get | `/api/amqp/get` | — | No TLS equivalent yet |

The three missing AMQPS endpoints (`confirm-publish`, `bind`, `get`) can be added by passing `secureTransport: 'on'` to the existing `doAMQP*` helpers, following the same pattern as `handleAMQPSConsume`.

---

## Resources

- [AMQP 0-9-1 Reference](https://www.rabbitmq.com/amqp-0-9-1-reference.html)
- [RabbitMQ TLS Guide](https://www.rabbitmq.com/ssl.html)
- [RFC 5672 — AMQP over TLS](https://datatracker.ietf.org/doc/html/rfc5672)
- [Cloudflare Workers Sockets API](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
