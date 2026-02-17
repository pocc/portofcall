# Consul — Port of Call Reference

**Protocol:** Consul HTTP API
**Default Port:** 8500 (HTTP)
**Transport:** Raw TCP → HTTP/1.1 (plaintext only, no TLS)
**Implementation:** `src/worker/consul.ts` (685 lines)
**Endpoints:** 8

---

## Architecture

Port of Call implements Consul as raw HTTP/1.1 over TCP. There are **two internal socket helper functions**:

- `sendHttpGet` — used by `/health` and `/services`. Top-level `import { connect } from 'cloudflare:sockets'`.
- `sendConsulHttpRequest` — used by all KV, service health, and session endpoints. Uses `await import('cloudflare:sockets' as string)` (dynamic import workaround). Supports GET, PUT, and DELETE methods with an optional request body.

Both implementations:
- Open a new TCP socket per request
- Set `Connection: close` (no keep-alive, no pipelining)
- Decode chunked transfer encoding
- Cap response bodies at 512 KB (silently truncated if larger)
- Use `X-Consul-Token: {token}` for auth

---

## Authentication

All endpoints accept an optional `token` parameter. If provided it is sent as the `X-Consul-Token` HTTP header on every request. If the Consul cluster has ACL enabled and no valid token is supplied, Consul returns HTTP 403. If ACL is in `permissive` mode, the request succeeds with minimal access.

---

## Endpoints

### POST /api/consul/health

Fetches agent info and the service catalog in two serial HTTP requests.

**Request**
```json
{
  "host": "consul.example.com",
  "port": 8500,
  "token": "optional-acl-token",
  "timeout": 15000
}
```

**Wire sequence**
1. `GET /v1/agent/self` → agent configuration and member info
2. `GET /v1/catalog/services` → service names (best-effort, failure silently ignored)

**Response**
```json
{
  "success": true,
  "host": "consul.example.com",
  "port": 8500,
  "statusCode": 200,
  "latencyMs": 12,
  "version": "1.17.0",
  "datacenter": "dc1",
  "nodeName": "consul-server-1",
  "server": true,
  "services": ["consul", "redis", "web"],
  "serviceCount": 3
}
```

**Field notes:**
- `success` is derived from `/v1/agent/self` status code only (200–399 = true). The catalog request is fire-and-forget.
- `version` → `Config.Version` then `DebugConfig.Version` (fallback chain).
- `datacenter` → `Config.Datacenter` then `DebugConfig.Datacenter`.
- `nodeName` → `Config.NodeName` then `Member.Name`.
- `server` → `Config.Server` (boolean, true if this is a server node vs. client agent). Returns `null` if absent.
- `services` is the key set of the catalog response — service names only, no tags or ports.
- If `/v1/catalog/services` fails or returns invalid JSON, `services: null` and `serviceCount: 0`.
- `latencyMs` only covers the first request (`/v1/agent/self`).

---

### POST /api/consul/services

Lists all registered services with their tags.

**Request**
```json
{
  "host": "consul.example.com",
  "port": 8500,
  "token": "optional-acl-token",
  "timeout": 15000
}
```

**Wire:** `GET /v1/catalog/services`

**Response**
```json
{
  "success": true,
  "host": "consul.example.com",
  "port": 8500,
  "statusCode": 200,
  "latencyMs": 8,
  "services": {
    "consul": [],
    "redis": ["primary", "v7"],
    "web": ["http", "production"]
  }
}
```

**Field notes:**
- `services` is the raw parsed JSON from Consul: an object where keys are service names and values are string arrays of tags.
- If JSON parsing fails, `services: null`.
- success = statusCode 200–399.

---

### GET /api/consul/kv/{key}

Reads a single key from the Consul KV store.

**Important routing note:** The URL path after `/api/consul/kv/` is ignored by the worker. The actual key is read from the JSON request body. Any path suffix works (`/api/consul/kv/anything`).

**HTTP method:** This endpoint dispatches on `request.method === 'GET'`. The request body must be JSON — non-standard for GET, but required.

**Request body**
```json
{
  "host": "consul.example.com",
  "port": 8500,
  "key": "config/database/host",
  "token": "optional-acl-token",
  "dc": "dc2",
  "timeout": 15000
}
```

**Wire:** `GET /v1/kv/{encodeURIComponent(key)}[?dc={dc}]`

**Response (key exists)**
```json
{
  "success": true,
  "host": "consul.example.com",
  "port": 8500,
  "key": "config/database/host",
  "statusCode": 200,
  "value": "db.internal:5432",
  "metadata": {
    "createIndex": 12,
    "modifyIndex": 47,
    "lockIndex": 0,
    "flags": 0,
    "session": ""
  }
}
```

**Response (key not found)**
```json
{
  "success": false,
  "host": "consul.example.com",
  "port": 8500,
  "key": "missing/key",
  "statusCode": 404,
  "value": null,
  "metadata": null
}
```

**Field notes:**
- `value` is the base64-decoded KV value (`atob(parsed.Value)`). Always a UTF-8 string — no binary support.
- `metadata.session` is the session ID holding a lock on this key (empty string if unlocked).
- `metadata.flags` is a 64-bit Consul flag integer (returned as a JS number, safe up to 2^53).
- Consul's response is a JSON array; the implementation uses `arr[0]`.
- If the key has never been written, Consul returns 404 and `success: false`, `value: null`, `metadata: null`.

---

### POST /api/consul/kv/{key}

Writes a value to the Consul KV store.

**HTTP method:** Dispatches on `request.method === 'POST'`.

**Request body**
```json
{
  "host": "consul.example.com",
  "port": 8500,
  "key": "config/database/host",
  "value": "db.internal:5432",
  "token": "optional-acl-token",
  "dc": "dc1",
  "timeout": 15000
}
```

**Wire:** `PUT /v1/kv/{encodeURIComponent(key)}[?dc={dc}]` with `value` as the raw body.

**Content-Type caveat:** The implementation sets `Content-Type: application/json` on the PUT body even though `value` is sent as a raw string (not JSON-encoded). Consul ignores Content-Type for KV PUT and stores whatever bytes arrive. If you PUT `"hello"` the stored value is `hello`, not `"hello"`. GET will return `hello`.

**Response**
```json
{
  "success": true,
  "host": "consul.example.com",
  "port": 8500,
  "key": "config/database/host",
  "statusCode": 200,
  "message": "Key written successfully"
}
```

**Field notes:**
- `success` requires both `statusCode === 200` AND `body.trim() === 'true'`. Consul KV PUT returns the literal text `true` on success, not JSON.
- `value` defaults to `''` if omitted — writes an empty key.
- No CAS (Check-And-Set) support; `?cas=index` query parameter is not implemented.
- No session acquisition (`?acquire=session`) or release (`?release=session`) — these require separate query params not exposed here.

---

### DELETE /api/consul/kv/{key}

Deletes a key from the Consul KV store.

**HTTP method:** Dispatches on `request.method === 'DELETE'`.

**Request body**
```json
{
  "host": "consul.example.com",
  "port": 8500,
  "key": "config/database/host",
  "token": "optional-acl-token",
  "dc": "dc1",
  "timeout": 15000
}
```

**Wire:** `DELETE /v1/kv/{encodeURIComponent(key)}[?dc={dc}]`

**Response**
```json
{
  "success": true,
  "host": "consul.example.com",
  "port": 8500,
  "key": "config/database/host",
  "statusCode": 200,
  "message": "Key deleted successfully"
}
```

**Field notes:**
- `success` = statusCode 200. Consul returns `true` in the body for success, but this implementation only checks the status code (unlike KV PUT which also checks body).
- Deleting a non-existent key returns HTTP 200 (Consul idempotent delete).
- No recursive delete (`?recurse`) — not supported.

---

### POST /api/consul/kv-list

Lists key names under a prefix. Uses Consul's `?keys=true` mode — returns only the key names, never the values.

**Request**
```json
{
  "host": "consul.example.com",
  "port": 8500,
  "prefix": "config/",
  "token": "optional-acl-token",
  "dc": "dc1",
  "timeout": 15000
}
```

**Wire:** `GET /v1/kv/{encodeURIComponent(prefix)}?keys=true&separator=/`

**Response**
```json
{
  "success": true,
  "host": "consul.example.com",
  "port": 8500,
  "prefix": "config/",
  "statusCode": 200,
  "keys": ["config/database/", "config/redis/", "config/timeout"],
  "count": 3
}
```

**Field notes:**
- `prefix` defaults to `''` (empty string). `encodeURIComponent('')` = `''`, so `prefix=''` queries `/v1/kv/?keys=true&separator=/`, listing all top-level key prefixes.
- `separator=/` means the listing is hierarchical: if a key is `config/database/host`, it appears as `config/database/` (the directory node), not the full path. Keys with no further slashes appear as-is.
- To list all keys recursively, omit `separator`: not possible with this endpoint (separator is hardcoded).
- Consul returns 404 if the prefix has no keys. In that case `keys: []` and `count: 0`.

---

### POST /api/consul/service/health

Returns health check status for all instances of a named service.

**Request**
```json
{
  "host": "consul.example.com",
  "port": 8500,
  "serviceName": "redis",
  "token": "optional-acl-token",
  "passing": true,
  "dc": "dc1",
  "timeout": 10000
}
```

**Wire:** `GET /v1/health/service/{encodeURIComponent(serviceName)}[?passing=true][&dc=...]`

**Response**
```json
{
  "success": true,
  "host": "consul.example.com",
  "port": 8500,
  "serviceName": "redis",
  "instanceCount": 2,
  "passing": true,
  "instances": [
    {
      "node": "node-1",
      "address": "10.0.1.5",
      "serviceId": "redis-1",
      "serviceAddress": "10.0.1.5",
      "servicePort": 6379,
      "checks": [
        {
          "name": "Service 'redis' check",
          "status": "passing",
          "output": "TCP connect 10.0.1.5:6379: Success"
        },
        {
          "name": "Serf Health Status",
          "status": "passing",
          "output": "Agent alive and reachable"
        }
      ]
    }
  ]
}
```

**Field notes:**
- `passing: true` in the request body activates Consul's server-side `?passing=true` filter, returning only healthy instances.
- `passing` is echoed back verbatim as a boolean in the response.
- Per instance: `node` and `address` are the Consul node hosting the service; `serviceAddress` and `servicePort` are the service's own address (may differ from node address for tagged addresses or virtual IPs).
- `checks[].name` uses `chk.Name` first, then `chk.CheckID` as fallback.
- `success` = statusCode 200–399. A service with no passing instances returns an empty array, not an error.
- If `serviceName` has no registered instances, Consul returns HTTP 200 with an empty array.

---

### POST /api/consul/session/create

Creates a Consul session, used as the prerequisite for distributed lock acquisition.

**Request**
```json
{
  "host": "consul.example.com",
  "port": 8500,
  "token": "optional-acl-token",
  "name": "my-lock-session",
  "ttl": "30s",
  "behavior": "release",
  "timeout": 10000
}
```

**Wire:** `PUT /v1/session/create` with JSON body:
```json
{ "Behavior": "release", "Name": "my-lock-session", "TTL": "30s" }
```

**Response**
```json
{
  "success": true,
  "host": "consul.example.com",
  "port": 8500,
  "rtt": 5,
  "sessionId": "adf4238a-882b-9ddc-4a9d-5b6758e4159e",
  "name": "my-lock-session",
  "ttl": "30s"
}
```

**Field notes:**
- `behavior` controls what happens to locks when the session expires or is destroyed: `'release'` (default) releases all held locks, `'delete'` deletes the locked keys.
- `ttl` is a duration string (`"10s"`, `"30s"`, up to `"86400s"`). If omitted, the session has no TTL and persists until explicitly destroyed.
- `name` and `ttl` are only included in the Consul request body if provided — omitting them means Consul uses its defaults (no name, no TTL).
- `sessionId` is the UUID returned by Consul's `POST /v1/session/create` in the `ID` field.
- There are **no endpoints to renew (`PUT /v1/session/renew/{id}`) or destroy (`PUT /v1/session/destroy/{id}`) sessions**. Sessions created here must be managed externally or will expire per TTL.
- There are **no lock acquisition/release endpoints**. To use a session for locking, you would need to use the KV PUT endpoint with `?acquire={sessionId}` — which is not exposed.

---

## Common Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `host` | string | required | Consul agent/server hostname |
| `port` | number | `8500` | Consul HTTP API port |
| `token` | string | — | ACL token (`X-Consul-Token` header) |
| `timeout` | number | varies | TCP connection + read timeout in ms |
| `dc` | string | — | Target datacenter (uses local if omitted) |

---

## Wire Protocol Details

All communication is HTTP/1.1 over a raw TCP socket (`cloudflare:sockets`). Every request:
1. Opens a new TCP socket
2. Sends a single HTTP request with `Connection: close`
3. Reads the full response (up to 512 KB)
4. Closes the socket

**Headers sent on every request:**
```
GET /v1/agent/self HTTP/1.1
Host: {host}:{port}
Accept: application/json
Connection: close
User-Agent: PortOfCall/1.0
X-Consul-Token: {token}   ← only if token provided
```

**Chunked encoding:** Both HTTP helpers implement chunked transfer-encoding decoding, so Consul's chunked responses (common when serving dynamic content) are handled transparently.

**No TLS:** Port 8443 (Consul HTTPS) is not supported. If your cluster enforces HTTPS, all requests will fail with a connection error or an HTTP 400 (if Consul redirects to TLS).

---

## Known Limitations

| Limitation | Detail |
|-----------|--------|
| **No TLS** | Plaintext HTTP/1.1 only. No HTTPS/TLS support. |
| **512 KB response cap** | Large KV values or catalogs are silently truncated. |
| **No blocking queries** | `?wait=...&index=...` long-polling not supported. |
| **No session renew/destroy** | Sessions must be managed externally or will expire. |
| **No lock primitives** | KV `?acquire=session` and `?release=session` not exposed. |
| **No recursive KV delete** | `?recurse` not implemented. |
| **No CAS** | `?cas=modifyIndex` check-and-set not implemented. |
| **KV GET with body** | HTTP GET with JSON body (non-standard per RFC 9110). |
| **KV path ignored** | URL path after `/api/consul/kv/` is ignored; key comes from JSON body. |
| **Binary values unsupported** | KV values always decoded as UTF-8 strings via `atob()`. |
| **Content-Type mismatch** | KV PUT sends `Content-Type: application/json` with raw string body. |
| **No service registration** | `PUT /v1/agent/service/register` not implemented. |
| **No ACL management** | Token creation/listing/deletion not implemented. |
| **No Connect/service mesh** | Consul Connect intentions, certificates, and proxy endpoints not implemented. |

---

## Error Responses

When the TCP connection fails or times out:
```json
{ "success": false, "error": "Connection timeout" }
```
HTTP status 500.

When a required parameter is missing:
```json
{ "error": "Missing required parameters: host, key" }
```
HTTP status 400.

When targeting a Cloudflare IP:
```json
{ "success": false, "error": "...", "isCloudflare": true }
```
HTTP status 403.

---

## curl Examples

```bash
# Health check (agent info + service catalog)
curl -s -X POST https://portofcall.dev/api/consul/health \
  -H 'Content-Type: application/json' \
  -d '{"host":"consul.example.com","port":8500}'

# List services
curl -s -X POST https://portofcall.dev/api/consul/services \
  -H 'Content-Type: application/json' \
  -d '{"host":"consul.example.com","token":"my-acl-token"}'

# KV read (GET method with JSON body)
curl -s -X GET https://portofcall.dev/api/consul/kv/anypath \
  -H 'Content-Type: application/json' \
  -d '{"host":"consul.example.com","key":"config/db/host"}'

# KV write
curl -s -X POST https://portofcall.dev/api/consul/kv/anypath \
  -H 'Content-Type: application/json' \
  -d '{"host":"consul.example.com","key":"config/db/host","value":"db.internal:5432"}'

# KV delete
curl -s -X DELETE https://portofcall.dev/api/consul/kv/anypath \
  -H 'Content-Type: application/json' \
  -d '{"host":"consul.example.com","key":"config/db/host"}'

# List KV keys under prefix
curl -s -X POST https://portofcall.dev/api/consul/kv-list \
  -H 'Content-Type: application/json' \
  -d '{"host":"consul.example.com","prefix":"config/"}'

# Service health (passing instances only)
curl -s -X POST https://portofcall.dev/api/consul/service/health \
  -H 'Content-Type: application/json' \
  -d '{"host":"consul.example.com","serviceName":"redis","passing":true}'

# Create session for distributed locking
curl -s -X POST https://portofcall.dev/api/consul/session/create \
  -H 'Content-Type: application/json' \
  -d '{"host":"consul.example.com","name":"my-lock","ttl":"30s","behavior":"release"}'
```

---

## Local Testing

```bash
# Run Consul in dev mode (single-node, no persistence)
docker run -d --name consul \
  -p 8500:8500 \
  hashicorp/consul:1.17 agent -dev -client=0.0.0.0

# Verify it's up
curl http://localhost:8500/v1/agent/self | jq .Config.Version

# Register a test service
curl -X PUT http://localhost:8500/v1/agent/service/register \
  -H 'Content-Type: application/json' \
  -d '{"ID":"redis-test","Name":"redis","Port":6379,"Check":{"TCP":"localhost:6379","Interval":"10s"}}'

# Write a KV pair
curl -X PUT http://localhost:8500/v1/kv/test/key -d 'hello-world'
```
