# Matrix — Power-User Reference

**Port:** 8448 (default), any
**Transport:** Raw TCP (HTTP/1.1 over unencrypted socket)
**Implementation:** `src/worker/matrix.ts`
**Spec:** [Matrix Client-Server API](https://spec.matrix.org/latest/client-server-api/), [Server-Server API](https://spec.matrix.org/latest/server-server-api/)

## Endpoints

| # | Route | Auth | Upstream HTTP | Description |
|---|-------|------|---------------|-------------|
| 1 | `POST /api/matrix/health` | none | 3 GETs | Homeserver discovery: versions + login flows + federation version |
| 2 | `POST /api/matrix/query` | optional Bearer | configurable | Arbitrary Matrix API call (GET/POST/PUT/DELETE) |
| 3 | `POST /api/matrix/login` | none | POST | Password login → access_token |
| 4 | `POST /api/matrix/rooms` | Bearer | GET + up to 5 GETs | List joined rooms with names |
| 5 | `POST /api/matrix/send` | Bearer | PUT | Send m.room.message to a room |
| 6 | `POST /api/matrix/room-create` | Bearer | POST | Create a room |
| 7 | `POST /api/matrix/room-join` | Bearer | POST | Join a room by ID or alias |

All endpoints are POST-only (no GET form).

## Shared Transport Layer

All endpoints use a single internal function `sendHttpRequest()` that:

1. Opens a raw TCP socket via `connect(host:port)` — **no TLS**
2. Writes an HTTP/1.1 request with `Connection: close`, `User-Agent: PortOfCall/1.0`
3. Reads the response up to **512 KB** (`maxSize = 512000`)
4. Parses HTTP headers, status line, and body
5. Decodes `Transfer-Encoding: chunked` if present (string-based — lossy for binary)

**No Cloudflare detection.** Unlike most other workers, `checkIfCloudflare()` is never called. Any host is reachable.

**No port validation.** Any integer is accepted without range checking.

**Default timeout:** 15,000 ms, applied as a `setTimeout` race against both `socket.opened` and every `reader.read()`. The timer is shared — a slow connection handshake eats into read time.

## Endpoint Details

### 1. `/api/matrix/health`

Discovery probe. Makes **three sequential HTTP requests** to the same host:

1. `GET /_matrix/client/versions` — required; determines `success`
2. `GET /_matrix/client/v3/login` → falls back to `/_matrix/client/r0/login` on error
3. `GET /_matrix/federation/v1/version` — may fail (federation not always on same port)

**Request:**
```json
{ "host": "matrix.org", "port": 8448, "timeout": 15000 }
```

**Response:**
```json
{
  "success": true,
  "statusCode": 200,
  "parsed": {
    "versions": { "versions": ["r0.0.1", "v1.1", "v1.12"], "unstable_features": {...} },
    "loginFlows": { "flows": [{ "type": "m.login.password" }, ...] },
    "federation": { "server": { "name": "Synapse", "version": "1.99.0" } }
  },
  "latencyMs": 742
}
```

**Quirks:**
- `success` is `true` if `/versions` returns HTTP 200–399 (2xx or 3xx). Login and federation failures are silently swallowed — `loginFlows` and `federation` will be `null`.
- `latencyMs` spans all three requests end-to-end, not just `/versions`.
- Each request opens a **separate TCP connection** (three total).
- `timeout` applies independently per request. If versions succeeds but login (v3 + r0) and federation all time out, worst case is **4× timeout** (versions time + login-v3 timeout + login-r0 timeout + federation timeout).
- If the server returns non-JSON, `versions` and `loginFlows` fall back to the **raw body string**, but `federation` falls back to **`null`** (inconsistent behavior between the three fields).

### 2. `/api/matrix/query`

Generic Matrix API proxy. Sends any HTTP request to the homeserver.

**Request:**
```json
{
  "host": "matrix.org",
  "port": 8448,
  "method": "GET",
  "path": "/_matrix/client/v3/publicRooms?limit=5",
  "body": null,
  "accessToken": "syt_...",
  "timeout": 15000
}
```

**Defaults:** `method` → `"GET"`, `path` → `"/_matrix/client/versions"`, `port` → 8448.

**Response includes raw body + parsed JSON:**
```json
{
  "success": true,
  "statusCode": 200,
  "headers": { "content-type": "application/json", ... },
  "body": "{\"chunk\":[...],\"total_room_count_estimate\":42}",
  "parsed": { "chunk": [...], "total_room_count_estimate": 42 },
  "latencyMs": 312
}
```

**Quirks:**
- `success` is `true` for HTTP 200–399.
- `parsed` is `null` if JSON.parse fails (not an error — body is still returned as string).
- Allowed methods: GET, POST, PUT, DELETE. Other methods return HTTP 400.
- `path` is auto-prefixed with `/` if missing.
- No v3/r0 fallback — you get exactly the path you request.
- `body` field (request body) is sent as-is; it must be a JSON string, not an object.
- `headers` in response are all lowercased.

### 3. `/api/matrix/login`

Password authentication via `m.login.password`.

**Request:**
```json
{
  "host": "matrix.org",
  "port": 8448,
  "username": "@user:matrix.org",
  "password": "secret",
  "timeout": 15000
}
```

**Success response:**
```json
{
  "success": true,
  "statusCode": 200,
  "latencyMs": 285,
  "accessToken": "syt_dXNlcg_AbCdEf...",
  "deviceId": "ABCDEFGHIJ",
  "userId": "@user:matrix.org",
  "homeServer": "matrix.org"
}
```

**Failure response (still HTTP 200 from PortOfCall):**
```json
{
  "success": false,
  "statusCode": 403,
  "error": "Invalid username or password",
  "errcode": "M_FORBIDDEN"
}
```

**Wire details:**
- Sends `POST /_matrix/client/v3/login` with body: `{ "type": "m.login.password", "user": username, "password": password, "initial_device_display_name": "PortOfCall" }`
- Falls back to `/_matrix/client/r0/login` on connection error (not HTTP error — a 403 from v3 does **not** trigger the r0 fallback).
- `username` and `password` are validated as required fields via falsy check — empty string `""` is rejected.

**Gotcha:** Only `m.login.password` is supported. SSO, token, and other login flows are not implemented.

### 4. `/api/matrix/rooms`

List joined rooms with names. Requires a valid access token from `/login`.

**Request:**
```json
{
  "host": "matrix.org",
  "port": 8448,
  "access_token": "syt_...",
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "statusCode": 200,
  "latencyMs": 1820,
  "totalRooms": 23,
  "joinedRooms": ["!abc:matrix.org", "!def:matrix.org", ...],
  "roomDetails": [
    { "roomId": "!abc:matrix.org", "name": "General Chat" },
    { "roomId": "!def:matrix.org", "name": "!def:matrix.org" }
  ]
}
```

**Quirks:**
- `joinedRooms` is the **full** list of room IDs.
- `roomDetails` contains names for **only the first 5 rooms** (hardcoded `joinedRooms.slice(0, 5)`). Remaining rooms have no name resolution.
- Name resolution sends `GET /_matrix/client/v3/rooms/{roomId}/state/m.room.name` per room (up to 5 sequential requests).
- If name fetch fails for a room, it falls back to using the room ID as the name (no error reported).
- Name fetch uses a **5-second timeout** (not the main `timeout` parameter).
- v3 → r0 fallback for the initial `joined_rooms` call only; name fetches are v3-only.

### 5. `/api/matrix/send`

Send a text message to a room.

**Request:**
```json
{
  "host": "matrix.org",
  "port": 8448,
  "access_token": "syt_...",
  "room_id": "!abc:matrix.org",
  "message": "Hello, world!",
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "statusCode": 200,
  "latencyMs": 156,
  "eventId": "$abc123",
  "roomId": "!abc:matrix.org",
  "txnId": "portofcall_1708123456789",
  "message": "Hello, world!"
}
```

**Wire details:**
- Sends `PUT /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}`
- Body: `{ "msgtype": "m.text", "body": message }`
- `txnId` is `portofcall_${Date.now()}` — millisecond-resolution but **not globally unique** if two sends happen in the same ms.
- Default `message` is `"Hello from PortOfCall"` if omitted.
- Only `m.text` message type — no images, files, formatted HTML, or other msgtypes.
- `success` requires strict HTTP 200 (not 2xx range).

### 6. `/api/matrix/room-create`

Create a new Matrix room.

**Request:**
```json
{
  "host": "matrix.org",
  "port": 8448,
  "access_token": "syt_...",
  "name": "My Room",
  "topic": "Discussion",
  "preset": "private_chat",
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "statusCode": 200,
  "latencyMs": 430,
  "roomId": "!new_room:matrix.org",
  "name": "My Room",
  "topic": "Discussion",
  "preset": "private_chat"
}
```

**Defaults:**
- `name` → `"PortOfCall Test Room"`
- `topic` → `"Created by PortOfCall"`
- `preset` → `"public_chat"` (options: `public_chat`, `private_chat`, `trusted_private_chat`)
- `visibility` is derived: `"public"` if preset is `public_chat`, `"private"` otherwise.

**Gotcha:** `access_token` defaults to `""` (empty string) instead of being validated as required. Since empty string is falsy in JS, `sendHttpRequest` skips the `Authorization` header entirely (the `if (authToken)` check fails). The Matrix server responds with `M_MISSING_TOKEN` — the error comes from upstream, not from PortOfCall's validation.

### 7. `/api/matrix/room-join`

Join an existing room by room ID or alias.

**Request:**
```json
{
  "host": "matrix.org",
  "port": 8448,
  "access_token": "syt_...",
  "room_id_or_alias": "#general:matrix.org",
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "statusCode": 200,
  "latencyMs": 210,
  "roomId": "!resolved_id:matrix.org",
  "room_id_or_alias": "#general:matrix.org"
}
```

**Quirks:**
- Room ID or alias is `encodeURIComponent()`-encoded in the URL path.
- `access_token` defaults to `""` (same empty-string gotcha as room-create — Authorization header omitted, not sent empty).
- Sends `POST /_matrix/client/v3/join/{roomIdOrAlias}` with body `{}`.
- `room_id_or_alias` is validated as required (empty string triggers error).

## v3 / r0 Fallback Behavior

Five of seven endpoints implement a v3-first, r0-fallback pattern:

| Endpoint | v3 → r0 fallback | Trigger |
|----------|-------------------|---------|
| `/health` (login flows) | yes | any error (catch) |
| `/login` | yes | connection error only (not HTTP error) |
| `/rooms` (joined_rooms) | yes | connection error only |
| `/rooms` (name fetch) | **no** | v3 only |
| `/send` | yes | connection error only |
| `/room-create` | yes | connection error only |
| `/room-join` | yes | connection error only |
| `/query` | **no** | exact path used |

The fallback catches **all** errors (connection timeout, DNS failure, socket reset), but does **not** catch HTTP-level errors like 404 from a server that only speaks r0.

## `success` Criteria

| Endpoint | `success: true` when |
|----------|---------------------|
| `/health` | `/versions` returns HTTP 200–399 |
| `/query` | upstream HTTP 200–399 |
| `/login` | upstream HTTP 200 exactly |
| `/rooms` | upstream HTTP 200 exactly |
| `/send` | upstream HTTP 200 exactly |
| `/room-create` | upstream HTTP 200 exactly |
| `/room-join` | upstream HTTP 200 exactly |

All endpoints return PortOfCall HTTP 200 regardless of Matrix-level success/failure (except `/health` validation errors which return 400, and connection failures which return 500).

## Auth Parameter Naming Inconsistency

| Endpoint | Auth param name | Required? | Default |
|----------|----------------|-----------|---------|
| `/health` | _(none)_ | — | — |
| `/query` | `accessToken` | optional | _(none)_ |
| `/login` | _(output only)_ | — | Returns `accessToken` in response |
| `/rooms` | `access_token` | **yes** (400 if missing) | — |
| `/send` | `access_token` | **yes** (400 if missing) | — |
| `/room-create` | `access_token` | no | `""` (empty string) |
| `/room-join` | `access_token` | no | `""` (empty string) |

`/query` uses camelCase `accessToken`; all other authenticated endpoints use snake_case `access_token`. Using the wrong casing silently drops the token.

## Known Limitations

1. **No TLS.** Raw TCP socket — most production homeservers require TLS on port 443. Port 8448 federation endpoints may accept plaintext on some servers, but this is not guaranteed. Cannot reach `matrix.org` client-server API on port 443 (needs TLS handshake).

2. **No Cloudflare detection.** `checkIfCloudflare()` is never called — connections to Cloudflare-fronted homeservers will attempt to connect and likely fail or get non-Matrix responses.

3. **512 KB response cap.** Large responses (e.g., `/publicRooms` on busy servers, `/sync`) are silently truncated, potentially producing invalid JSON that results in `parsed: null`.

4. **Single HTTP header per name.** Duplicate headers (e.g., `Set-Cookie`) overwrite; only the last value is kept.

5. **No chunked request encoding.** Only response chunked TE is handled. Request bodies are sent with `Content-Length`.

6. **No /.well-known discovery.** Matrix `.well-known` delegation (`GET /.well-known/matrix/client` and `/.well-known/matrix/server`) is not implemented. You must specify the actual homeserver host and port directly.

7. **No /sync endpoint.** The long-polling `/sync` endpoint (core of the Matrix client experience) is not implemented. You can use `/query` to call it manually, but the 512 KB cap and single-response pattern make it impractical.

8. **No E2EE.** Olm/Megolm end-to-end encryption is not implemented. Messages in encrypted rooms are unreadable.

9. **No pagination.** `/rooms` returns all joined room IDs but only resolves names for 5. No cursor/batch support for `/publicRooms` or message history via `/query`.

10. **Password auth only.** SSO (m.login.sso), token (m.login.token), and OIDC flows are not supported.

11. **m.text only.** `/send` hardcodes `msgtype: "m.text"`. No `m.notice`, `m.emote`, `m.image`, or formatted HTML (`format`/`formatted_body`).

12. **txnId collision risk.** `/send` generates `portofcall_{Date.now()}` — millisecond resolution. Two sends in the same ms produce the same txnId, and the Matrix server will deduplicate the second one (per the idempotency guarantee in the spec).

13. **No host validation.** No regex or format check on `host`. Unlike most other workers, no port range validation either.

## curl Examples

```bash
# Health/discovery probe
curl -X POST https://portofcall.ross.gg/api/matrix/health \
  -H 'Content-Type: application/json' \
  -d '{"host":"matrix.org","port":8448}'

# Query public rooms
curl -X POST https://portofcall.ross.gg/api/matrix/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"matrix.org","port":8448,"path":"/_matrix/client/v3/publicRooms?limit=3"}'

# Login
curl -X POST https://portofcall.ross.gg/api/matrix/login \
  -H 'Content-Type: application/json' \
  -d '{"host":"matrix.example.com","port":8448,"username":"@user:example.com","password":"secret"}'

# List joined rooms (requires access_token from login)
curl -X POST https://portofcall.ross.gg/api/matrix/rooms \
  -H 'Content-Type: application/json' \
  -d '{"host":"matrix.example.com","port":8448,"access_token":"syt_..."}'

# Send message
curl -X POST https://portofcall.ross.gg/api/matrix/send \
  -H 'Content-Type: application/json' \
  -d '{"host":"matrix.example.com","port":8448,"access_token":"syt_...","room_id":"!abc:example.com","message":"Hello"}'

# Create room
curl -X POST https://portofcall.ross.gg/api/matrix/room-create \
  -H 'Content-Type: application/json' \
  -d '{"host":"matrix.example.com","port":8448,"access_token":"syt_...","name":"Test Room","preset":"private_chat"}'

# Join room
curl -X POST https://portofcall.ross.gg/api/matrix/room-join \
  -H 'Content-Type: application/json' \
  -d '{"host":"matrix.example.com","port":8448,"access_token":"syt_...","room_id_or_alias":"#general:example.com"}'
```

## Local Testing

```bash
# Run a local Synapse instance (federation port 8448, client port 8008)
docker run -d --name synapse \
  -p 8008:8008 -p 8448:8448 \
  -e SYNAPSE_SERVER_NAME=localhost \
  -e SYNAPSE_REPORT_STATS=no \
  matrixdotorg/synapse:latest generate

docker start synapse

# Register a test user (requires registration enabled or admin API)
docker exec synapse register_new_matrix_user \
  -u testuser -p testpass -a -c /data/homeserver.yaml http://localhost:8008

# Test against local instance (port 8008, no TLS)
curl -X POST http://localhost:8787/api/matrix/health \
  -H 'Content-Type: application/json' \
  -d '{"host":"host.docker.internal","port":8008}'
```
