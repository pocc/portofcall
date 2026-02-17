# NATS — Neural Autonomic Transport System

**Port:** 4222 (client), 6222 (cluster routing), 8222 (HTTP monitoring)
**Transport:** TCP, text-based (newline-delimited `\r\n`)
**Protocol Spec:** [NATS Protocol](https://docs.nats.io/reference/reference-protocols/nats-protocol)
**Implementation:** `src/worker/nats.ts`
**Routes:** `/api/nats/connect`, `/api/nats/publish`, `/api/nats/subscribe`, `/api/nats/request`, `/api/nats/jetstream-info`, `/api/nats/jetstream-stream`, `/api/nats/jetstream-publish`, `/api/nats/jetstream-pull`

---

## Auth Field Inconsistency — Read This First

The 8 endpoints split into two incompatible auth schemas:

| Endpoint group | user/pass fields | token support |
|---|---|---|
| `/connect`, `/publish`, all `/jetstream-*` | `user` + `pass` | `token` ✓ |
| `/subscribe`, `/request` | `username` + `password` | `token` ✗ |

There is no normalization. Sending `user`/`pass` to `/subscribe` silently ignores them and connects unauthenticated. Sending `username`/`password` to `/publish` does the same.

---

## Wire Protocol

NATS is a text protocol. Every command ends with `\r\n`.

```
Server → Client: INFO {json}\r\n
Client → Server: CONNECT {json}\r\n
Server → Client: +OK\r\n          (only when verbose:true)
Client → Server: PUB subject [reply-to] #bytes\r\npayload\r\n
Client → Server: SUB subject [queue] sid\r\n
Server → Client: MSG subject sid [reply-to] #bytes\r\npayload\r\n
Client ↔ Server: PING\r\n / PONG\r\n
Server → Client: -ERR 'message'\r\n
```

HPUB (headers extension):
```
Client → Server: HPUB subject [reply-to] #header-bytes #total-bytes\r\n
                 NATS/1.0\r\nHeader-Name: value\r\n\r\n
                 payload\r\n
```

JetStream API access uses request-reply over `$JS.API.*` subjects.

---

## Endpoints

### `GET|POST /api/nats/connect`

Performs full handshake only. Does **not** publish or subscribe anything.

**Request**

```json
{
  "host":       "localhost",   // required
  "port":       4222,          // default 4222
  "user":       "admin",       // optional
  "pass":       "secret",      // optional
  "token":      "mytoken",     // optional, mutually exclusive with user/pass
  "name":       "my-client",   // optional, client name in INFO
  "timeout_ms": 5000           // optional, default varies
}
```

**Wire exchange**

```
TCP connect
Server → Client: INFO {json}\r\n
Client → Server: CONNECT {"verbose":true,"pedantic":false,"tls_required":false,
                           "name":"...", "lang":"javascript","version":"1.0.0",
                           "protocol":1, [user+pass | auth_token]}\r\n
Server → Client: +OK\r\n
Client → Server: PING\r\n
Server → Client: PONG\r\n
```

`verbose:true` is sent **only** in `/connect`. All other endpoints use `verbose:false` and do not wait for `+OK`.

**Response**

```json
{
  "success":      true,
  "host":         "localhost",
  "port":         4222,
  "serverInfo": {
    "server_id":    "NABC123",
    "server_name":  "nats-server",
    "version":      "2.10.4",
    "go":           "go1.21.5",
    "host":         "0.0.0.0",
    "port":         4222,
    "max_payload":  1048576,
    "proto":        1,
    "headers":      true,
    "auth_required": false,
    "tls_available": false,
    "connect_urls": ["10.0.0.1:4222"],
    "nonce":        "abc123",
    "cluster":      "my-cluster"
  }
}
```

Fields reflect what the server sends in its INFO line. `nonce` is present only on servers requiring token auth. `tls_available` indicates TLS capability; the implementation never upgrades to TLS regardless of this value.

---

### `POST /api/nats/publish`

Connects (verbose:false), sends PUB, then sends PING to flush and verify connectivity.

**Request**

```json
{
  "host":       "localhost",
  "port":       4222,
  "user":       "admin",       // auth: use user/pass/token (NOT username/password)
  "pass":       "secret",
  "token":      "mytoken",
  "subject":    "orders.new",  // required
  "payload":    "hello world", // required, string
  "replyTo":    "_INBOX.abc",  // optional, sets reply-to on PUB line
  "timeout_ms": 5000
}
```

**Wire exchange**

```
CONNECT {"verbose":false,...}\r\n   ← no +OK read
PUB orders.new [_INBOX.abc] 11\r\n
hello world\r\n
PING\r\n
Server → Client: PONG\r\n
```

PONG after PING confirms the server received all prior data.

**Response**

```json
{
  "success":      true,
  "subject":      "orders.new",
  "payloadBytes": 11,
  "bytesSent":    42,
  "serverInfo":   { "version": "2.10.4", ... }
}
```

`bytesSent` is total bytes written to the socket (CONNECT + PUB + PING frames combined).

---

### `POST /api/nats/subscribe`

Connects, subscribes, collects messages for `timeout_ms`, then closes.

**⚠ Auth fields:** uses `username`/`password` — **not** `user`/`pass`. No `token` support.

**Request**

```json
{
  "host":        "localhost",
  "port":        4222,
  "username":    "admin",        // NOTE: username (not user)
  "password":    "secret",       // NOTE: password (not pass)
  "subject":     "orders.*",     // required; wildcards * and > work
  "queue_group": "workers",      // optional, enables queue subscription
  "max_msgs":    5,              // default 5
  "timeout_ms":  5000            // default 5000
}
```

**Wire exchange**

```
CONNECT {"verbose":false,...}\r\n
SUB orders.* [workers] 1\r\n
[collect MSG frames for timeout_ms]
```

The connection closes after `timeout_ms` regardless of whether `max_msgs` was reached.

`queue_group` triggers: `SUB subject queue_group sid` — the NATS server delivers each message to exactly one subscriber in the group (load balancing).

**Response**

```json
{
  "success": true,
  "subject": "orders.*",
  "messages": [
    {
      "subject":      "orders.new",
      "replyTo":      "_INBOX.xyz",
      "payload":      "order data",
      "payloadBytes": 10
    }
  ],
  "messageCount": 1,
  "serverInfo": { ... }
}
```

`replyTo` is present only when the publisher included a reply-to subject (request-reply pattern). `payload` is decoded as UTF-8 string.

---

### `POST /api/nats/request`

Pub/sub request-reply: publishes to `subject` with a generated inbox as reply-to, waits for exactly one MSG response.

**⚠ Auth fields:** uses `username`/`password` — **not** `user`/`pass`. No `token` support.

**⚠ Typo:** response contains `responsed` field (misspelled — should be `responded`).

**Request**

```json
{
  "host":       "localhost",
  "port":       4222,
  "username":   "admin",        // NOTE: username (not user)
  "password":   "secret",
  "subject":    "grpc.add",     // service subject
  "payload":    "{\"a\":1}",    // request body
  "timeout_ms": 5000
}
```

**Wire exchange**

```
CONNECT {"verbose":false,...}\r\n
SUB _INBOX.<random> 1\r\n
PUB grpc.add _INBOX.<random> 9\r\n
{"a":1}\r\n
PING\r\n
Server → Client: PONG\r\n
[wait for MSG _INBOX.<random> 1 ... within timeout_ms]
```

The inbox is `_INBOX.` + `Math.random().toString(36).slice(2)` (short hex string).

**Response**

```json
{
  "success":         true,
  "subject":         "grpc.add",
  "reply":           "_INBOX.abc123",
  "requestPayload":  "{\"a\":1}",
  "responsePayload": "{\"result\":42}",
  "responsed":       true,
  "serverInfo":      { ... }
}
```

`responsed` (with the typo) is `true` if a MSG was received within `timeout_ms`. If the timeout fires with no reply, the response has `success:false` and `responsed:false`.

---

## JetStream Endpoints

JetStream is the persistence layer built on NATS core. All JetStream endpoints share the `withNATSSession` helper which:

1. Connects and reads INFO
2. Sends CONNECT (verbose:false)
3. Subscribes to a generated inbox (`_INBOX_JS_.<random>`) for API replies
4. Provides `jsRequest(apiSubject, body)` which publishes to `$JS.API.<subject>` with the inbox as reply-to and reads the MSG reply

All JetStream endpoints use `user`/`pass`/`token` (consistent with `/connect` and `/publish`).

---

### `POST /api/nats/jetstream-info`

Returns JetStream server info and stream list.

**Request**

```json
{
  "host":       "localhost",
  "port":       4222,
  "user":       "admin",
  "pass":       "secret",
  "token":      "mytoken",
  "timeout_ms": 10000
}
```

**Response**

```json
{
  "success": true,
  "jetstream": {
    "memory":    0,
    "storage":   0,
    "streams":   2,
    "consumers": 3,
    "limits": {
      "max_memory_store": -1,
      "max_file_store":   -1
    },
    "max_memory_store": -1,
    "max_file_store":   -1
  },
  "streams": ["ORDERS", "EVENTS"],
  "serverInfo": { ... }
}
```

`jetstream` comes from `$JS.API.INFO`. `streams` is the `streams` array from `$JS.API.STREAM.NAMES`. Both API calls are fired in parallel via `Promise.allSettled`; a failure in either is surfaced as the field being `null` in the response.

---

### `POST /api/nats/jetstream-stream`

Manage streams: list, info, create, delete.

**Request**

```json
{
  "host":        "localhost",
  "port":        4222,
  "user":        "admin",
  "pass":        "secret",
  "action":      "create",     // required: list | info | create | delete
  "stream":      "ORDERS",     // required for info/create/delete
  "subjects":    ["orders.>"], // required for create
  "retention":   "limits",     // optional: limits (default) | interest | workqueue
  "storage":     "file",       // optional: file (default) | memory
  "max_msgs":    -1,           // optional, -1 = unlimited
  "max_bytes":   -1,           // optional, -1 = unlimited
  "max_age":     0,            // optional, ms; 0 = unlimited
  "timeout_ms":  10000
}
```

**⚠ `num_replicas` hardcoded:** CREATE always sends `num_replicas: 1`. There is no way to override this.

**JetStream API calls by action:**

| action | API subject |
|--------|-------------|
| `list` | `$JS.API.STREAM.NAMES` |
| `info` | `$JS.API.STREAM.INFO.{stream}` |
| `create` | `$JS.API.STREAM.CREATE.{stream}` |
| `delete` | `$JS.API.STREAM.DELETE.{stream}` |

**Response**

```json
{
  "success": true,
  "action":  "create",
  "result": {
    "config": {
      "name":        "ORDERS",
      "subjects":    ["orders.>"],
      "retention":   "limits",
      "storage":     "file",
      "num_replicas": 1
    },
    "state": {
      "messages": 0,
      "bytes":    0,
      "first_seq": 1,
      "last_seq":  0
    }
  }
}
```

`result` is the raw JetStream API JSON response — field shape varies by action.

---

### `POST /api/nats/jetstream-publish`

Publish a message to a JetStream stream.

**⚠ PubAck is broken:** The implementation publishes the message but then calls `$JS.API.STREAM.NAMES` as a dummy API call rather than reading the actual PubAck from the ack inbox. The `ack` field in the response contains STREAM.NAMES data, not the publish acknowledgment.

**Request**

```json
{
  "host":       "localhost",
  "port":       4222,
  "user":       "admin",
  "pass":       "secret",
  "subject":    "ORDERS.new",  // must match stream's subjects
  "payload":    "order body",
  "stream":     "ORDERS",
  "msgId":      "order-001",   // optional: deduplication ID
  "timeout_ms": 10000
}
```

**Wire exchange without `msgId`:**

```
PUB ORDERS.new _INBOX_JS_.<ack-inbox> 10\r\n
order body\r\n
```

**Wire exchange with `msgId` (HPUB):**

```
HPUB ORDERS.new _INBOX_JS_.<ack-inbox> 36 46\r\n
NATS/1.0\r\nNats-Msg-Id: order-001\r\n\r\n
order body\r\n
```

HPUB header format: first number is header-only bytes (including `NATS/1.0\r\n...` + double CRLF), second is total bytes (headers + payload).

**Response**

```json
{
  "success":   true,
  "subject":   "ORDERS.new",
  "stream":    "ORDERS",
  "msgId":     "order-001",
  "published": true,
  "ack": {
    "streams": ["ORDERS", "EVENTS"]
  }
}
```

**`ack` contains STREAM.NAMES output, not the PubAck.** A real PubAck from JetStream looks like `{"stream":"ORDERS","seq":42,"duplicate":false}`. To verify publication, use `/api/nats/jetstream-stream` with `action:info` and check the stream's `last_seq`.

---

### `POST /api/nats/jetstream-pull`

Pull messages from a JetStream consumer.

**⚠ Partial implementation:** Creates the consumer and sends the pull request, but the actual message retrieval is replaced by a fallback that returns stream info. Response always includes a `note` field explicitly flagging this limitation.

**⚠ Durable name on ephemeral consumer:** The implementation sends `durable_name` in the consumer create request, making the consumer durable (persists across connections) even though the design intent is ephemeral.

**Request**

```json
{
  "host":           "localhost",
  "port":           4222,
  "user":           "admin",
  "pass":           "secret",
  "stream":         "ORDERS",
  "consumer":       "my-consumer",   // durable name
  "filter_subject": "ORDERS.new",    // optional
  "batch_size":     1,               // optional, default 1
  "timeout_ms":     10000
}
```

**Wire exchange**

```
jsRequest("$JS.API.CONSUMER.CREATE.ORDERS.my-consumer", {
  stream_name: "ORDERS",
  config: {
    durable_name: "my-consumer",
    filter_subject: "ORDERS.new",
    ack_policy: "explicit",
    deliver_policy: "new"
  }
})
→ consumer create response

jsRequest("$JS.API.CONSUMER.MSG.NEXT.ORDERS.my-consumer", {
  batch: 1,
  no_wait: true
})
→ intended to deliver messages, but falls back to:

jsRequest("$JS.API.STREAM.INFO.ORDERS", {})
→ returns stream info instead of messages
```

**Response**

```json
{
  "success":  true,
  "stream":   "ORDERS",
  "consumer": "my-consumer",
  "messages": [],
  "streamInfo": {
    "config": { "name": "ORDERS", ... },
    "state":  { "messages": 42, "bytes": 1234, ... }
  },
  "note": "Use a NATS client library in production for reliable message consumption"
}
```

`messages` is always an empty array. Actual pulled messages never appear. Use `streamInfo.state` to verify messages exist and check sequence numbers.

---

## `withNATSSession` Helper

All JetStream endpoints share this session wrapper:

```
connect TCP
read INFO
send CONNECT (verbose:false, no +OK)
subscribe _INBOX_JS_.<random> → sid 1
for each jsRequest(apiSubject, body):
  PUB $JS.API.<apiSubject> _INBOX_JS_.<random> <len>\r\n<json>\r\n
  PING\r\n
  read until PONG (discard) and MSG (parse JSON from payload)
  return parsed JSON
close TCP
```

The inbox is reused across all `jsRequest` calls in a session. Each `jsRequest` sends PING after PUB and reads responses until it finds the PONG and the MSG reply.

---

## Known Limitations

1. **Auth field split** — `/subscribe` and `/request` use `username`/`password`; all others use `user`/`pass`. No `token` support in `/subscribe` or `/request`.

2. **JetStream publish ack broken** — `/jetstream-publish` returns `$JS.API.STREAM.NAMES` output in the `ack` field instead of the actual PubAck. Cannot confirm sequence number or detect duplicates via this endpoint.

3. **JetStream pull returns stream info** — `/jetstream-pull` never delivers pulled messages. The `messages` array is always empty. `streamInfo` contains stream metadata only.

4. **Durable consumer created as ephemeral intent** — `/jetstream-pull` creates consumers with `durable_name`, meaning the consumer persists on the server. Repeated calls with the same `consumer` name reuse the existing consumer rather than creating fresh ones. The server will return an error if consumer config changes between calls.

5. **`responsed` typo** — `/request` response has field `responsed` (not `responded`).

6. **No TLS** — connects plaintext only. Even if the server advertises `tls_available: true` in INFO, the implementation never upgrades.

7. **Single-read connection** — each endpoint opens a new TCP connection. There is no connection pooling or long-lived session for core pub/sub.

8. **No wildcard subscription in `/request`** — the inbox subject is a fixed string; the implementation subscribes `_INBOX.<random>` and expects the responder to address exactly that subject.

9. **`verbose:true` only in `/connect`** — all other endpoints send `verbose:false` and do not wait for `+OK` after CONNECT. If CONNECT is rejected by the server (bad auth, `auth_required`), the subsequent PUB/SUB will receive `-ERR` which surfaces as a connection error.

10. **No JetStream consumer ack** — there is no `/ack` endpoint. After pulling messages (if the pull implementation were fixed), messages would not be ACKed and would be redelivered.

---

## NATS Protocol Reference

### CONNECT fields

| Field | Type | Notes |
|-------|------|-------|
| `verbose` | bool | `true` → server sends `+OK` after each command |
| `pedantic` | bool | Strict subject validation |
| `tls_required` | bool | Request TLS upgrade |
| `user` | string | Username auth |
| `pass` | string | Password auth |
| `auth_token` | string | Token auth (mutually exclusive with user/pass) |
| `name` | string | Client name reported in server logs |
| `lang` | string | Client language (e.g., `javascript`) |
| `version` | string | Client version |
| `protocol` | int | Protocol version (1 for headers support) |
| `headers` | bool | Enable NATS message headers |

### INFO fields (server → client)

| Field | Notes |
|-------|-------|
| `server_id` | Unique server identifier |
| `version` | NATS server version |
| `proto` | Protocol version (1 = supports headers) |
| `max_payload` | Max bytes per message (default 1 MB) |
| `auth_required` | If true, CONNECT must include credentials |
| `tls_required` | If true, TLS upgrade is mandatory |
| `nonce` | Present for NKey/token auth challenge |
| `connect_urls` | Cluster route URLs for client reconnect |

### Subject wildcards

| Pattern | Matches | Does not match |
|---------|---------|----------------|
| `foo.*` | `foo.bar` | `foo.bar.baz` |
| `foo.>` | `foo.bar`, `foo.bar.baz` | `bar.foo` |
| `>` | everything | — |

---

## curl Examples

```bash
# Handshake + server info
curl -s -X POST https://portofcall.ross.gg/api/nats/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":4222}' | jq .serverInfo

# Publish a message
curl -s -X POST https://portofcall.ross.gg/api/nats/publish \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":4222,"subject":"orders.new","payload":"{\"id\":1}"}' | jq .

# Subscribe (collect 3 messages, 3 second window)
curl -s -X POST https://portofcall.ross.gg/api/nats/subscribe \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":4222,"subject":"orders.*","max_msgs":3,"timeout_ms":3000}' | jq .messages

# Queue subscription (load-balanced across multiple workers)
curl -s -X POST https://portofcall.ross.gg/api/nats/subscribe \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":4222,"subject":"work.>","queue_group":"workers","max_msgs":5}' | jq .

# Request-reply
curl -s -X POST https://portofcall.ross.gg/api/nats/request \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":4222,"subject":"math.add","payload":"{\"a\":1,\"b\":2}"}' | jq .responsePayload

# JetStream info
curl -s -X POST https://portofcall.ross.gg/api/nats/jetstream-info \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":4222}' | jq '{streams:.streams,consumers:.jetstream.consumers}'

# Create a stream
curl -s -X POST https://portofcall.ross.gg/api/nats/jetstream-stream \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":4222,"action":"create","stream":"ORDERS","subjects":["orders.>"]}' | jq .result.config

# Publish to JetStream (ack field is STREAM.NAMES, not PubAck — verify via stream info)
curl -s -X POST https://portofcall.ross.gg/api/nats/jetstream-publish \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":4222,"subject":"orders.new","payload":"test","stream":"ORDERS"}' | jq .

# Verify publish via stream info
curl -s -X POST https://portofcall.ross.gg/api/nats/jetstream-stream \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":4222,"action":"info","stream":"ORDERS"}' | jq .result.state
```

---

## Local Testing

```bash
# NATS server (plaintext, no auth)
docker run -d -p 4222:4222 -p 8222:8222 nats:latest

# NATS server with JetStream
docker run -d -p 4222:4222 -p 8222:8222 nats:latest -js

# NATS server with auth
docker run -d -p 4222:4222 nats:latest --user admin --pass secret

# Monitor via HTTP
curl http://localhost:8222/varz         # server info
curl http://localhost:8222/subsz        # subscriptions
curl http://localhost:8222/jsz          # JetStream info

# nats CLI (brew install nats-io/nats-tools/nats)
nats pub orders.new "hello" --server localhost:4222
nats sub orders.* --server localhost:4222
nats stream info ORDERS --server localhost:4222
```
