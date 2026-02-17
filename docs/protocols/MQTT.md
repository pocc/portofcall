# MQTT — Power User Reference

**Port:** 1883 (plaintext) | **Protocol:** MQTT 3.1.1 | **Tests:** 13/13 ✅ Deployed

Port of Call provides three MQTT endpoints: an HTTP connection probe, a one-shot publish call, and a persistent bidirectional WebSocket session. All three open a direct TCP connection from the Cloudflare Worker to your broker. TLS (port 8883) is not supported.

---

## API Endpoints

### `GET|POST /api/mqtt/connect` — Connection probe

Sends CONNECT, reads CONNACK, sends DISCONNECT, and closes.

**POST body / GET query params:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `1883` | |
| `clientId` | string | `portofcall-{7 random chars}` | Auto-generated if omitted |
| `username` | string | — | Sets Username flag in CONNECT |
| `password` | string | — | Sets Password flag in CONNECT |
| `timeout` | number (ms) | `10000` | CONNACK timeout + total |

**Success (200):**
```json
{
  "success": true,
  "message": "MQTT connection successful",
  "host": "broker.example.com",
  "port": 1883,
  "clientId": "portofcall-a3x8f2q",
  "sessionPresent": false
}
```

`sessionPresent` is bit 0 of the CONNACK variable header — `true` if the broker retained state from a previous session with this clientId.

**Error (500):** `{ "success": false, "error": "CONNACK refused: Bad username or password" }`

**Cloudflare-protected host (403):** `{ "success": false, "error": "...", "isCloudflare": true }`

**CONNACK return codes surfaced in the error message:**

| Code | Message |
|---|---|
| 1 | `Unacceptable protocol version` |
| 2 | `Identifier rejected` |
| 3 | `Server unavailable` |
| 4 | `Bad username or password` |
| 5 | `Not authorized` |

---

### `POST /api/mqtt/publish` — One-shot publish

Sends CONNECT → PUBLISH → (PUBACK if QoS 1) → DISCONNECT.

```json
{
  "host": "broker.example.com",
  "port": 1883,
  "clientId": "my-client",
  "username": "user",
  "password": "pass",
  "topic": "sensors/temperature",
  "payload": "23.5",
  "qos": 1,
  "retain": false,
  "timeout": 10000
}
```

Required fields: `host`, `topic`, `payload`.

**QoS capped at 1.** Sending `qos: 2` silently downgrades to QoS 1. QoS 2 (PUBREC/PUBREL/PUBCOMP) is not implemented.

**Success (200):**
```json
{
  "success": true,
  "message": "Published to \"sensors/temperature\"",
  "topic": "sensors/temperature",
  "payload": "23.5",
  "qos": 1,
  "retain": false,
  "messageId": 1
}
```

`messageId` is always `1` for QoS 1 publishes (fixed, not a counter — each `/publish` call opens a new connection).

---

### `GET /api/mqtt/session` — Interactive WebSocket session

Upgrades to WebSocket, maintains a persistent TCP connection to the broker, and proxies bidirectional MQTT traffic.

**Connection URL:**
```
wss://portofcall.ross.gg/api/mqtt/session?host=broker.example.com&port=1883&clientId=myid&username=u&password=p&willTopic=status/myid&willPayload=offline&cleanSession=true
```

All connection parameters are query strings.

| Query Param | Default | Notes |
|---|---|---|
| `host` | required | |
| `port` | `1883` | |
| `clientId` | `portofcall-{7 random chars}` | Broker sees this in logs |
| `username` / `password` | — | |
| `willTopic` / `willPayload` | — | LWT; QoS 0, retain=false (not configurable in session) |
| `cleanSession` | `true` | Set `cleanSession=false` for persistent session resumption |

**Note:** `username`, `password` appear in the WebSocket upgrade URL and in Cloudflare access logs. Use a read-only or short-lived credential.

---

#### Worker → browser messages

```jsonc
// After CONNACK:
{ "type": "connected", "host": "broker.example.com", "port": 1883, "clientId": "myid", "sessionPresent": false }

// After SUBACK arrives:
{ "type": "subscribed", "messageId": 1, "grantedQoS": [1, 0] }
// grantedQoS: one entry per subscribed topic; 0x80 = subscription refused

// After UNSUBACK arrives:
{ "type": "unsubscribed", "messageId": 2 }

// Incoming PUBLISH from broker:
{ "type": "message", "topic": "sensors/temp", "payload": "23.5", "qos": 0, "retain": false, "dup": false }

// Confirmation that a browser-initiated PUBLISH was sent:
{ "type": "published", "topic": "sensors/temp", "qos": 0, "messageId": null }
// messageId is present (integer) for QoS 1; absent/null for QoS 0

// PUBACK received for a QoS 1 publish:
{ "type": "puback", "messageId": 3 }

// PINGRESP received:
{ "type": "pong" }

// Fatal error (session closes after this):
{ "type": "error", "message": "CONNACK timeout" }
```

#### Browser → worker messages

```jsonc
// Publish to a topic:
{ "type": "publish", "topic": "cmd/device1", "payload": "reboot", "qos": 0, "retain": false }
// qos: 0 or 1 (2 is silently downgraded to 1)

// Subscribe (topics can be object array or string array):
{ "type": "subscribe", "topics": [{ "topic": "sensors/#", "qos": 1 }, { "topic": "status/+", "qos": 0 }] }
// String form also accepted: { "topics": ["sensors/#", "status/+"] } — QoS defaults to 0

// Unsubscribe:
{ "type": "unsubscribe", "topics": ["sensors/#"] }

// Send PINGREQ (useful to test broker keepalive without publishing):
{ "type": "ping" }

// Graceful close — sends DISCONNECT and closes the WebSocket:
{ "type": "disconnect" }
```

**Message ID counter:** starts at 1, increments per QoS 1 publish/subscribe/unsubscribe, wraps at 0xFFFF (skips 0).

---

## QoS Handling

| QoS | Publish (outgoing) | Incoming messages |
|---|---|---|
| 0 | Fire and forget — no ACK | Delivered to browser; no PUBACK sent |
| 1 | Waits for PUBACK from broker | Worker sends PUBACK to broker automatically; browser receives `message` event |
| 2 | **Not supported** — silently downgraded to QoS 1 | PUBREC/PUBREL/PUBCOMP packets received but not acted on |

---

## LWT (Last Will and Testament)

LWT is configurable only in the session endpoint (via `willTopic` / `willPayload` query params). The HTTP connect probe does not support LWT. Will QoS is always 0 and will retain is always false in the session endpoint — these are not exposed as params.

LWT payload is encoded as a UTF-8 string. Binary LWT payloads are not supported.

---

## Retained Messages

- `/api/mqtt/publish`: Set `"retain": true` to publish a retained message.
- `/api/mqtt/session`: Set `"retain": true` in the `publish` message.
- Subscribing to a topic with a retained message: the broker sends the retained message immediately on SUBACK. The session delivers it as a normal `message` event with `retain: true`.

---

## Wire Format Quick Reference

All MQTT 3.1.1 packets: `[fixed header byte] [remaining length, variable-length] [variable header] [payload]`.

Remaining length uses a 7-bit continuation encoding (MSB = more bytes follow):
```
0–127:         1 byte
128–16383:     2 bytes
16384–2097151: 3 bytes
```

CONNECT flags byte (bit positions):
```
7: Username present
6: Password present
5: Will retain
4-3: Will QoS (00, 01, 10)
2: Will present
1: Clean session
0: Reserved (must be 0)
```

PUBLISH fixed header flags (lower nibble):
```
3: DUP
2-1: QoS (00, 01, 10)
0: RETAIN
```

---

## Persistent Sessions (`cleanSession=false`)

When `cleanSession=false` and you supply a stable `clientId`, the broker stores your subscriptions and queues QoS 1/2 messages while you're disconnected. On reconnect with the same clientId, `sessionPresent: true` in the `connected` event means your prior subscriptions are active and queued messages will be delivered immediately.

Broker-side limits vary: many brokers cap the queue at a few hundred messages. Subscriptions are not resumed by Port of Call automatically — if `sessionPresent` is `false` after reconnect, re-send your `subscribe` messages.

---

## Known Limitations

**No TLS:** plain TCP only. Port 8883 (MQTT over TLS) is not supported. Credentials sent via MQTT over plaintext are exposed in transit.

**No MQTT 5.0:** protocol level 4 (MQTT 3.1.1) only. MQTT 5.0 features (message expiry, user properties, reason codes, shared subscriptions) are not available.

**No QoS 2:** QoS 2 (PUBREC → PUBREL → PUBCOMP two-phase commit) is silently downgraded to QoS 1. PUBREC/PUBREL/PUBCOMP packets from the broker are received but not processed.

**Binary payloads:** `TextDecoder` is used throughout. Binary MQTT payloads (e.g., compressed sensor data, protobuf, raw bytes with values > 127) are corrupted on decode. Encode binary data as base64 before publishing.

**CONNACK single read:** `mqttConnect` calls `reader.read()` exactly once to read the CONNACK. On high-latency connections where CONNACK doesn't arrive in the first TCP segment, the parse returns null and the caller throws "Expected CONNACK". In practice, CONNACK is small (~4 bytes) and arrives in the first segment.

**Will QoS/Retain not configurable in session:** The WebSocket session only accepts `willTopic` and `willPayload`. Will QoS is 0 and will retain is false, with no way to override them.

**Credentials in WebSocket URL:** `username` and `password` appear as query parameters, visible in Cloudflare access logs and browser history. Use a dedicated, scoped credential (e.g., a broker ACL user with publish-only access to a single topic prefix).

**`published` event is pre-PUBACK:** For QoS 1 in the session, the `published` event fires immediately after the PUBLISH packet is written to the socket — not after the PUBACK arrives. Watch for the separate `puback` event to confirm broker delivery.

---

## curl Examples

```bash
# Probe (no auth)
curl -s -X POST https://portofcall.ross.gg/api/mqtt/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"broker.example.com","port":1883,"timeout":5000}' | jq .

# Probe with credentials
curl -s -X POST https://portofcall.ross.gg/api/mqtt/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"broker.example.com","username":"user","password":"pass"}' | jq .sessionPresent

# QoS 0 publish (fire and forget)
curl -s -X POST https://portofcall.ross.gg/api/mqtt/publish \
  -H 'Content-Type: application/json' \
  -d '{"host":"broker.example.com","topic":"test/hello","payload":"world","qos":0}' | jq .

# QoS 1 publish with retain
curl -s -X POST https://portofcall.ross.gg/api/mqtt/publish \
  -H 'Content-Type: application/json' \
  -d '{"host":"broker.example.com","topic":"status/device1","payload":"online","qos":1,"retain":true}' | jq .

# Publish to public test broker (test.mosquitto.org)
curl -s -X POST https://portofcall.ross.gg/api/mqtt/publish \
  -H 'Content-Type: application/json' \
  -d '{"host":"test.mosquitto.org","topic":"portofcall/test","payload":"hello","qos":0}' | jq .
```

---

## WebSocket Session — JavaScript

```js
const params = new URLSearchParams({
  host: 'broker.example.com',
  port: '1883',
  clientId: 'my-dashboard',
  username: 'viewer',
  password: 'readonly',
  willTopic: 'status/my-dashboard',
  willPayload: 'offline',
  cleanSession: 'true',
});

const ws = new WebSocket(`wss://portofcall.ross.gg/api/mqtt/session?${params}`);

ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);

  switch (msg.type) {
    case 'connected':
      console.log(`Connected to ${msg.host}:${msg.port} as ${msg.clientId}`);
      console.log('Session resumed:', msg.sessionPresent);
      // Subscribe after connect
      ws.send(JSON.stringify({
        type: 'subscribe',
        topics: [
          { topic: 'sensors/#', qos: 1 },
          { topic: 'status/+', qos: 0 },
        ],
      }));
      break;

    case 'subscribed':
      // msg.grantedQoS[i] === 0x80 means subscription i was refused
      console.log('Subscribed, granted QoS:', msg.grantedQoS);
      break;

    case 'message':
      console.log(`[${msg.topic}] ${msg.payload} (QoS ${msg.qos}${msg.retain ? ', retained' : ''}${msg.dup ? ', dup' : ''})`);
      break;

    case 'published':
      console.log(`Published to ${msg.topic} (QoS ${msg.qos}, msgId ${msg.messageId})`);
      break;

    case 'puback':
      console.log('PUBACK received for messageId', msg.messageId);
      break;

    case 'pong':
      console.log('Broker alive (PINGRESP received)');
      break;

    case 'error':
      console.error('Error:', msg.message);
      ws.close();
      break;
  }
};

// Publish a message
ws.send(JSON.stringify({ type: 'publish', topic: 'cmd/device1', payload: 'reboot', qos: 1 }));

// Keepalive ping
setInterval(() => ws.send(JSON.stringify({ type: 'ping' })), 30000);

// Graceful close
ws.send(JSON.stringify({ type: 'disconnect' }));
```

---

## Public Test Brokers

| Broker | Host | Port | Auth | Notes |
|---|---|---|---|---|
| Mosquitto public | `test.mosquitto.org` | `1883` | No | Shared, no privacy |
| HiveMQ public | `broker.hivemq.com` | `1883` | No | Shared, no privacy |
| EMQX public | `broker.emqx.io` | `1883` | No | Shared, no privacy |

**Warning:** all public brokers are shared. Do not publish sensitive data. Topics are visible to anyone subscribed with `#`.

---

## MQTT 3.1.1 Packet Type Reference

| Type | Decimal | Hex | Direction |
|---|---|---|---|
| CONNECT | 1 | `0x10` | C→S |
| CONNACK | 2 | `0x20` | S→C |
| PUBLISH | 3 | `0x30` | C↔S |
| PUBACK | 4 | `0x40` | C↔S (QoS 1) |
| PUBREC | 5 | `0x50` | C↔S (QoS 2, not handled) |
| PUBREL | 6 | `0x62` | C↔S (QoS 2, not handled) |
| PUBCOMP | 7 | `0x70` | C↔S (QoS 2, not handled) |
| SUBSCRIBE | 8 | `0x82` | C→S |
| SUBACK | 9 | `0x90` | S→C |
| UNSUBSCRIBE | 10 | `0xa2` | C→S |
| UNSUBACK | 11 | `0xb0` | S→C |
| PINGREQ | 12 | `0xc0` | C→S |
| PINGRESP | 13 | `0xd0` | S→C |
| DISCONNECT | 14 | `0xe0` | C→S |

SUBSCRIBE, UNSUBSCRIBE, and PUBREL have reserved flag bits set (0b0010) in the fixed header. The implementation encodes `0x82`, `0xa2` accordingly.

---

## Resources

- [MQTT 3.1.1 Spec](http://docs.oasis-open.org/mqtt/mqtt/v3.1.1/mqtt-v3.1.1.html)
- [MQTT 5.0 Spec](https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html) (not implemented)
- [MQTT Topic Wildcards](https://www.hivemq.com/blog/mqtt-essentials-part-5-mqtt-topics-best-practices/)
- [test.mosquitto.org](https://test.mosquitto.org/)
