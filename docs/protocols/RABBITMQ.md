# RabbitMQ Management API — Power User Reference

**Port:** 15672/tcp (HTTP Management API)
**Source:** `src/worker/rabbitmq.ts`

Three endpoints. All use raw TCP sockets to send HTTP/1.1 requests with Basic Auth to the RabbitMQ Management HTTP API. This is **not** the AMQP 0-9-1 binary protocol on port 5672 — it's the HTTP REST interface exposed by the `rabbitmq_management` plugin.

---

## Endpoints

### `POST /api/rabbitmq/health` — Cluster overview + node info

Connects to `GET /api/overview` on the Management API, then optionally fetches `GET /api/nodes` for the first node's resource stats.

**Request (JSON body — POST only):**

| Field | Default | Notes |
|---|---|---|
| `host` | — | Required |
| `port` | `15672` | Management API port (not 5672) |
| `username` | `guest` | HTTP Basic Auth |
| `password` | `guest` | |
| `timeout` | `15000` | Wall-clock timeout in ms per HTTP request (not shared — overview and nodes each get the full budget) |

**Success (200):**

```json
{
  "success": true,
  "host": "rabbitmq.example.com",
  "port": 15672,
  "rtt": 142,
  "statusCode": 200,
  "protocol": "RabbitMQ",
  "version": "3.12.4",
  "erlangVersion": "26.1",
  "clusterName": "rabbit@rabbitmq",
  "managementVersion": "3.12.4",
  "messageStats": { "publish": 1042, "deliver_get": 988, ... },
  "queueTotals": { "messages": 15, "messages_ready": 12, "messages_unacknowledged": 3 },
  "objectTotals": { "queues": 8, "exchanges": 12, "connections": 3, "channels": 6, "consumers": 4 },
  "listeners": [ { "node": "rabbit@host", "protocol": "amqp", "port": 5672 }, ... ],
  "node": {
    "name": "rabbit@host",
    "type": "disc",
    "running": true,
    "memUsed": 104857600,
    "memLimit": 838860800,
    "diskFree": 42949672960,
    "diskFreeLimit": 50000000,
    "fdUsed": 34,
    "fdTotal": 1048576,
    "socketsUsed": 3,
    "socketsTotal": 943626,
    "procUsed": 456,
    "procTotal": 1048576,
    "uptime": 86400000
  },
  "message": "RabbitMQ connected in 142ms"
}
```

**Auth failure (401):**

```json
{
  "success": false,
  "error": "Authentication failed (401). Check username and password.",
  "host": "rabbitmq.example.com",
  "port": 15672,
  "rtt": 45
}
```

**Key details:**

| Behavior | Notes |
|---|---|
| `rtt` timing | Measured from before the `/api/overview` request to after its response — does **not** include the `/api/nodes` fetch |
| `/api/nodes` failure | Silently swallowed; `node` is `null` if it fails (e.g., guest user has no access to node info) |
| `node` contents | Only the **first** node is returned, even in a multi-node cluster |
| 401 detection | Only checked on the `/api/overview` response. A 401 on `/api/nodes` is silently ignored |
| `success` | `true` iff `/api/overview` returns HTTP 200 |

---

### `POST /api/rabbitmq/query` — Generic management API GET

Executes a read-only `GET` request against any `/api/*` management endpoint and returns the parsed JSON.

**Request (JSON body — POST only):**

| Field | Default | Notes |
|---|---|---|
| `host` | — | Required |
| `port` | `15672` | |
| `path` | — | Required; must start with `/api/` |
| `username` | `guest` | |
| `password` | `guest` | |
| `timeout` | `15000` | |

**Success (200):**

```json
{
  "success": true,
  "host": "rabbitmq.example.com",
  "port": 15672,
  "path": "/api/queues/%2F",
  "rtt": 87,
  "statusCode": 200,
  "response": [ { "name": "my-queue", "messages": 5, ... } ],
  "message": "Query completed in 87ms"
}
```

**Key details:**

| Behavior | Notes |
|---|---|
| Path validation | Must start with `/api/` — returns HTTP 400 otherwise |
| Method | Always sends HTTP `GET` — cannot POST, PUT, or DELETE through this endpoint |
| `response` field | Parsed JSON if valid; raw string body if JSON parse fails |
| `success` | `true` iff status code is 200–399 (includes 3xx redirects, which shouldn't happen) |
| Port validation | Checked (1–65535), same as `/health`. **`/publish` does NOT validate port** (bug) |
| Response cap | 512 KB max read from socket |

**Useful management API paths:**

| Path | Returns |
|---|---|
| `/api/overview` | Cluster-wide stats (same as `/health` but raw) |
| `/api/nodes` | All nodes with resource usage |
| `/api/queues` | All queues across all vhosts |
| `/api/queues/%2F` | Queues in the default `/` vhost |
| `/api/queues/%2F/my-queue` | Single queue detail |
| `/api/exchanges` | All exchanges |
| `/api/exchanges/%2F` | Exchanges in default vhost |
| `/api/connections` | Active AMQP connections |
| `/api/channels` | Active channels |
| `/api/consumers` | Active consumers |
| `/api/bindings/%2F` | All bindings in default vhost |
| `/api/vhosts` | Virtual host list |
| `/api/users` | User list (requires administrator tag) |
| `/api/permissions` | User permissions |
| `/api/policies/%2F` | Policies in default vhost |
| `/api/aliveness-test/%2F` | Quick health check (declares/publishes/consumes a temp queue) |

Note: `%2F` is the URL-encoded form of `/` (the default vhost name). Must be encoded in the path.

---

### `POST /api/rabbitmq/publish` — Publish message via Management API

Publishes a message through the Management API's exchange publish endpoint: `POST /api/exchanges/{vhost}/{exchange}/publish`.

**Request (JSON body — POST only):**

| Field | Default | Notes |
|---|---|---|
| `host` | — | Required (empty string → 400) |
| `port` | `15672` | Management API port. **No port range validation** (unlike `/health` and `/query`) |
| `username` | `guest` | |
| `password` | `guest` | |
| `vhost` | `/` | Uses `??` (nullish coalescing): empty string `""` is preserved as a valid vhost name; only `null`/`undefined` triggers the `/` default |
| `exchange` | `amq.default` | Uses `??`: empty string `""` is preserved and valid (same as `amq.default` for routing). URL-encoded before use |
| `routing_key` | `""` | Uses `??`: for the default exchange, set this to the target queue name |
| `payload` | `""` | Message body as a string. Uses `??` |
| `payload_encoding` | `string` | `"string"` or `"base64"`. Uses `??` |
| `properties` | `{}` | AMQP properties (content_type, delivery_mode, headers, etc.). Uses `??` |
| `timeout` | `15000` | Uses `||`: falsy values (0, null) fall back to default |

**Success (200):**

```json
{
  "success": true,
  "host": "rabbitmq.example.com",
  "port": 15672,
  "vhost": "/",
  "exchange": "amq.default",
  "routing_key": "my-queue",
  "payload": "hello world",
  "routed": true,
  "rtt": 63,
  "statusCode": 200,
  "message": "Message published and routed"
}
```

**Key details:**

| Behavior | Notes |
|---|---|
| `routed` | `true` if the message reached at least one queue; `false` if no queue matched the routing key. The message is still accepted by the server in both cases |
| `message` field | `"Message published and routed"` if routed, `"Message published (no consumers)"` if not routed and status < 400, raw error body if status >= 400 |
| `success` | `true` iff HTTP status 200–299 |
| Default exchange | `amq.default` routes to a queue whose name matches `routing_key` — this is how you publish directly to a named queue |
| Response cap | 64 KB max read from socket (vs 512 KB for GET endpoints) |

---

## Cross-Endpoint Comparison

### `success` criteria

| Endpoint | `success` condition | Effect |
|---|---|---|
| `/health` | `statusCode === 200` | Strict equality; 201/204 would be `false` |
| `/query` | `statusCode >= 200 && statusCode < 400` | Most permissive; 3xx counts as success |
| `/publish` | `statusCode >= 200 && statusCode < 300` | Standard 2xx range check |

### Port validation

| Endpoint | Validates port? |
|---|---|
| `/health` | Yes (1–65535, returns 400) |
| `/query` | Yes (1–65535, returns 400) |
| `/publish` | **No** (invalid port passed to `connect()`, fails at socket level with 500) |

### Default operator

| Endpoint | `port` default | Operator |
|---|---|---|
| `/health` | `body.port \|\| 15672` | `\|\|` — falsy values (0, null, undefined) all → 15672 |
| `/query` | `body.port \|\| 15672` | `\|\|` — same |
| `/publish` | `body.port \|\| 15672` | `\|\|` — same |

The `/publish` endpoint uses `??` (nullish coalescing) for `vhost`, `exchange`, `routing_key`, `payload`, `payload_encoding`, and `properties`, but `||` for `port`, `username`, `password`, and `timeout`. This means empty-string values for vhost/exchange/payload are preserved, but `port: 0` becomes 15672.

### HTTP status of Port of Call response

All three endpoints return HTTP 200 from Port of Call itself in most cases, even when `success: false`. Exceptions:
- Validation errors (missing host, bad port, bad path) → HTTP 400
- Auth failure in `/health` → HTTP 401
- Cloudflare detection → HTTP 403
- Socket/timeout errors → HTTP 500

For all other RabbitMQ error codes (403 forbidden, 404 not found, 500 internal), Port of Call returns HTTP 200 with `success: false` and the upstream `statusCode` in the JSON body.

---

## Implementation Notes

### Raw TCP HTTP/1.1

All three endpoints use `cloudflare:sockets` `connect()` to open a raw TCP connection and construct HTTP/1.1 requests manually. They do **not** use `fetch()`. This means:

- `Connection: close` is sent on every request
- Each API call opens a new TCP connection
- The User-Agent is hardcoded to `PortOfCall/1.0`
- No keep-alive, no pipelining, no TLS

### Chunked transfer encoding

Both `sendHttpGet` and `sendHttpPost` handle `Transfer-Encoding: chunked` via `decodeChunked()`. This is important because RabbitMQ Management API may return chunked responses for large result sets (e.g., many queues/connections).

**Chunked decoder limitation:** If the last chunk straddles a TCP read boundary (chunk size header received but chunk data hasn't arrived yet), `decodeChunked` will silently truncate the response at that point. This is unlikely for normal responses under 512 KB but possible.

### Cloudflare detection

All three endpoints call `checkIfCloudflare(host)` before connecting. If the host resolves to a Cloudflare IP, the request is rejected with HTTP 403 and `isCloudflare: true`.

### No AMQP binary protocol

This implementation only speaks HTTP to the Management API (default port 15672). It does **not** implement the AMQP 0-9-1 binary protocol (port 5672). For AMQP binary protocol access, see the separate `amqp.ts` implementation.

### Authentication model

- HTTP Basic Auth with `Authorization: Basic base64(username:password)`
- Default credentials: `guest`/`guest`
- The `guest` user is typically restricted to `localhost` only on RabbitMQ >= 3.3.0. Remote access requires creating a user with appropriate permissions, or setting `loopback_users = none` in `rabbitmq.conf`

### Response size caps

| Endpoint | Read cap |
|---|---|
| `/health` (sendHttpGet) | 512 KB |
| `/query` (sendHttpGet) | 512 KB |
| `/publish` (sendHttpPost) | 64 KB |

If a management API response exceeds the cap, it's truncated. JSON.parse will fail on truncated JSON, and `response` will be the raw truncated string in `/query`, or `overview`/`nodes` will be `null` in `/health`.

### Timeout behavior

The `timeout` creates a single `setTimeout`-based promise that races against both `socket.opened` and each `reader.read()`. This means:

- `/health` makes **two** sequential HTTP requests (overview + nodes), each getting its own TCP connection and its own timeout. Total wall time can be up to 2× timeout.
- `/query` and `/publish` make one request each — timeout is straightforward.

### Port 15672 default

All three endpoints default to port 15672. This is the Management API port. If your RabbitMQ uses a non-standard management port (e.g., behind a reverse proxy on 443), pass the correct port.

---

## curl Examples

```bash
# Health check with default credentials
curl -s -X POST https://portofcall.ross.gg/api/rabbitmq/health \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq.example.com"}' | jq .

# Health check with custom credentials
curl -s -X POST https://portofcall.ross.gg/api/rabbitmq/health \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq.example.com","username":"admin","password":"s3cret"}' | jq .

# List all queues in default vhost
curl -s -X POST https://portofcall.ross.gg/api/rabbitmq/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq.example.com","path":"/api/queues/%2F","username":"admin","password":"s3cret"}' \
  | jq '.response[] | {name, messages, consumers}'

# Get single queue detail
curl -s -X POST https://portofcall.ross.gg/api/rabbitmq/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq.example.com","path":"/api/queues/%2F/my-queue","username":"admin","password":"s3cret"}' \
  | jq '.response | {messages_ready, messages_unacknowledged, consumers}'

# List exchanges
curl -s -X POST https://portofcall.ross.gg/api/rabbitmq/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq.example.com","path":"/api/exchanges/%2F","username":"admin","password":"s3cret"}' \
  | jq '.response[] | {name, type}'

# Publish to a queue (via default exchange)
curl -s -X POST https://portofcall.ross.gg/api/rabbitmq/publish \
  -H 'Content-Type: application/json' \
  -d '{
    "host":"rabbitmq.example.com",
    "username":"admin",
    "password":"s3cret",
    "exchange":"",
    "routing_key":"my-queue",
    "payload":"hello from Port of Call",
    "properties":{"delivery_mode":2,"content_type":"text/plain"}
  }' | jq .

# Publish to a topic exchange
curl -s -X POST https://portofcall.ross.gg/api/rabbitmq/publish \
  -H 'Content-Type: application/json' \
  -d '{
    "host":"rabbitmq.example.com",
    "username":"admin",
    "password":"s3cret",
    "exchange":"my-topic",
    "routing_key":"logs.error.db",
    "payload":"{\"level\":\"error\",\"msg\":\"connection lost\"}",
    "properties":{"content_type":"application/json"}
  }' | jq '{routed,rtt}'

# Quick aliveness test
curl -s -X POST https://portofcall.ross.gg/api/rabbitmq/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq.example.com","path":"/api/aliveness-test/%2F","username":"admin","password":"s3cret"}' \
  | jq '.response'

# Check cluster nodes
curl -s -X POST https://portofcall.ross.gg/api/rabbitmq/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq.example.com","path":"/api/nodes","username":"admin","password":"s3cret"}' \
  | jq '.response[] | {name, running, mem_used, disk_free, uptime}'
```

---

## Known Limitations

- **No AMQP binary protocol** — only the HTTP Management API is supported; for AMQP 0-9-1, see `amqp.ts`
- **No TLS** — connections are plaintext HTTP; no HTTPS support for management API
- **GET-only queries** — `/query` can only execute GET requests; cannot create/delete queues, exchanges, or bindings through this endpoint
- **No WebSocket** — no interactive tunnel or real-time consumer support
- **`guest` user remote access** — default `guest`/`guest` credentials won't work for remote hosts on standard RabbitMQ configurations (restricted to localhost since 3.3.0)
- **Single-node view** — `/health` only returns the first node from `/api/nodes`, even in a clustered setup
- **512 KB response cap** — large queue/connection lists may be truncated, causing JSON parse failure
- **No management API version negotiation** — assumes a compatible management plugin version
- **Host validation is minimal** — empty string `""` is caught (falsy), but whitespace-only hosts like `" "` pass validation and fail at the socket level
- **No message consumption** — you can publish and inspect queue depths, but there's no endpoint to consume/dequeue messages (the Management API's `POST /api/queues/{vhost}/{queue}/get` would require a POST-capable query endpoint)

---

## Local Testing

```bash
# Start RabbitMQ with management plugin
docker run -d --name rabbitmq \
  -p 5672:5672 \
  -p 15672:15672 \
  -e RABBITMQ_DEFAULT_USER=admin \
  -e RABBITMQ_DEFAULT_PASS=admin \
  rabbitmq:3-management

# Verify management API is up
curl -s -u admin:admin http://localhost:15672/api/overview | jq .rabbitmq_version

# Create a test queue
curl -s -u admin:admin -X PUT http://localhost:15672/api/queues/%2F/test-queue \
  -H 'Content-Type: application/json' \
  -d '{"durable":true}'

# Then test via Port of Call
curl -s -X POST http://localhost:8787/api/rabbitmq/health \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","username":"admin","password":"admin"}' | jq .
```
