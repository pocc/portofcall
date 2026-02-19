# Vault — Port of Call Reference

**Protocol:** HashiCorp Vault HTTP API
**Default Port:** 8200 (HTTP, plaintext; TLS is port 8200 with HTTPS, not supported here)
**Transport:** Raw TCP → HTTP/1.1 (plaintext only — no TLS, no redirect following)
**Implementation:** `src/worker/vault.ts`
**API Endpoints:** 4

---

## Architecture

Port of Call implements Vault as raw HTTP/1.1 over TCP, directly constructing request bytes and reading the response stream. There are **two socket helpers**:

- **`sendHttpGet`** (module-level, GET only) — used by `/health`, `/query`, and `/secret/read`. Uses the top-level `import { connect } from 'cloudflare:sockets'`. Handles chunked transfer encoding, caps response at 512 KB.
- **Inline POST loop** (inside `handleVaultSecretWrite`) — manually builds the HTTP POST frame, reads response chunks into a `Uint8Array[]` accumulator, then decodes once. Uses the top-level `connect` directly (no dynamic import).

All sockets are `Connection: close` — no keep-alive, no HTTP/2, no pipelining.

### Request Headers Sent

| Header | Value |
|--------|-------|
| `Host` | `{host}:{port}` |
| `Accept` | `application/json` |
| `Connection` | `close` |
| `User-Agent` | `PortOfCall/1.0` |
| `X-Vault-Token` | `{token}` (only when token is provided) |
| `Content-Type` | `application/json` (POST requests only) |
| `Content-Length` | byte length of payload (POST requests only) |

---

## Authentication

All endpoints accept an optional `token` field (Vault token, typically `hvs.*` or `s.*` prefix). The token is sent as the `X-Vault-Token` HTTP request header.

- **`/health`** — token is optional. `/v1/sys/health` is unauthenticated by default on every Vault installation. Providing a token does no harm and is passed to the seal-status sub-request.
- **`/query`** — token is optional. Most `/v1/sys/` paths require a valid token with `sudo` policy or operator-level access. Without a token, Vault returns HTTP 403 for protected paths. `/v1/sys/health` and `/v1/sys/seal-status` are exceptions — they are always accessible.
- **`/secret/read`** — token is **required**. KV paths always need authentication.
- **`/secret/write`** — token is **required**. Write operations always need authentication.

Vault tokens are short-lived by default (TTL configurable, default 768h for root tokens). Expired tokens return HTTP 403 with `{"errors":["permission denied"]}`.

### Token Types
| Type | Prefix | Notes |
|------|--------|-------|
| Service token | `hvs.` (Vault 1.10+) or `s.` (older) | Most common |
| Batch token | `hvb.` | Cannot be renewed |
| Recovery token | `hvr.` | DR replication only |
| Root token | usually starts with `hvs.` | Created at init, avoid long-lived use |

---

## Vault Health Status Codes

`GET /v1/sys/health` deliberately returns non-200 codes for degraded states. This is by design — monitoring systems should interpret these codes, not treat them as errors:

| HTTP Status | Meaning |
|-------------|---------|
| 200 | Initialized, unsealed, active |
| 429 | Unsealed, standby (HA secondary) |
| 472 | Active node, disaster recovery mode replication secondary |
| 473 | Performance standby |
| 501 | Not initialized |
| 503 | Sealed |

The `/health` endpoint in Port of Call always returns `success: true` regardless of Vault's HTTP status code — the caller should inspect `sealed`, `initialized`, and `standby` fields directly.

The `/query` endpoint returns `success: true` only for HTTP 200–299.

---

## Endpoints

### POST /api/vault/health

Probe a Vault server and return its health, seal status, and cluster identity.

**Request**
```json
{
  "host": "vault.example.com",
  "port": 8200,
  "token": "hvs.CAESIJ...",
  "timeout": 15000
}
```

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `host` | string | yes | — | Hostname or IP |
| `port` | number | no | `8200` | 1–65535 |
| `token` | string | no | — | Vault token (`X-Vault-Token`) |
| `timeout` | number | no | `15000` | Milliseconds |

**Wire sequence**
1. `GET /v1/sys/health` → health info (unauthenticated, always succeeds if Vault is reachable)
2. `GET /v1/sys/seal-status` → seal details (best-effort; failure silently ignored; may need token)

**Response (success)**
```json
{
  "success": true,
  "host": "vault.example.com",
  "port": 8200,
  "rtt": 14,
  "statusCode": 200,
  "version": "1.15.4",
  "initialized": true,
  "sealed": false,
  "standby": false,
  "clusterName": "vault-cluster-prod",
  "clusterId": "b4e2b5e1-3c3d-4e5f-6a7b-8c9d0e1f2a3b",
  "performanceStandby": false,
  "replicationPerfMode": "disabled",
  "replicationDrMode": "disabled",
  "sealType": "shamir",
  "sealThreshold": 3,
  "sealShares": 5,
  "sealProgress": 0,
  "protocol": "Vault",
  "message": "Vault connected in 14ms"
}
```

**Field notes:**
- `success` is always `true` if Vault responded at all — even if `sealed: true` or `initialized: false`. The HTTP status code from Vault (which uses 429/472/473/501/503 to signal state) does not affect `success`.
- `rtt` covers only the first request (`/v1/sys/health`); the seal-status round-trip is not counted.
- `statusCode` is the raw HTTP status from `/v1/sys/health` (see health status table above).
- `sealThreshold` (`t`), `sealShares` (`n`), `sealProgress` — from `/v1/sys/seal-status`. All `null` if the sub-request fails.
- `performanceStandby`, `replicationPerfMode`, `replicationDrMode` — Enterprise-only fields; `null` / `false` on OSS Vault.
- `clusterName` / `clusterId` — `null` for single-node non-HA deployments.

**Response (error)**
```json
{
  "success": false,
  "error": "Connection timeout"
}
```

---

### POST /api/vault/query

Execute an arbitrary GET request against a `/v1/sys/*` path.

**Request**
```json
{
  "host": "vault.example.com",
  "port": 8200,
  "path": "/v1/sys/mounts",
  "token": "hvs.CAESIJ...",
  "timeout": 15000
}
```

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `host` | string | yes | — | |
| `port` | number | no | `8200` | 1–65535 |
| `path` | string | yes | — | Must start with `/v1/sys/` |
| `token` | string | no | — | Required for most `/v1/sys/` endpoints |
| `timeout` | number | no | `15000` | Milliseconds |

**Path restriction:** Only paths starting with `/v1/sys/` are accepted. Any other prefix returns HTTP 400 with `"Path is not allowed"`. This prevents token-authenticated reads of secret engines (KV, PKI, etc.) through the general query endpoint — use `/secret/read` for that.

**Response (success)**
```json
{
  "success": true,
  "host": "vault.example.com",
  "port": 8200,
  "path": "/v1/sys/mounts",
  "rtt": 8,
  "statusCode": 200,
  "response": { ... },
  "message": "Query completed in 8ms"
}
```

**Field notes:**
- `success` is `true` only for HTTP 200–299 (unlike `/health` which always sets `success: true`).
- `response` is the parsed JSON object if the body is valid JSON; otherwise the raw body string.
- `statusCode` reflects the exact Vault HTTP status (200 for unsealed+active, 429 for standby, 503 for sealed, etc.).

**Common paths:**
| Path | Auth Required | Notes |
|------|--------------|-------|
| `/v1/sys/health` | no | Node state |
| `/v1/sys/seal-status` | no | Seal/unseal progress |
| `/v1/sys/mounts` | yes (operator) | Mounted secret engines |
| `/v1/sys/auth` | yes (operator) | Auth method mounts |
| `/v1/sys/policies/acl` | yes (operator) | Policy list |
| `/v1/sys/leader` | no | HA leader info |
| `/v1/sys/replication/status` | yes | Replication status (Enterprise) |

---

### POST /api/vault/secret/read

Read a secret from a KV secrets engine. Supports KV v1 and KV v2.

**Request**
```json
{
  "host": "vault.example.com",
  "port": 8200,
  "path": "myapp/database",
  "token": "hvs.CAESIJ...",
  "kv_version": 2,
  "mount": "secret",
  "timeout": 10000
}
```

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `host` | string | yes | — | |
| `port` | number | no | `8200` | 1–65535 |
| `path` | string | yes | — | Secret path within the mount (no leading `/`) |
| `token` | string | yes | — | |
| `kv_version` | `1` or `2` | no | `2` | KV engine version |
| `mount` | string | no | `"secret"` | KV mount point |
| `timeout` | number | no | `10000` | Milliseconds |

**Vault API path construction:**
- KV v2: `GET /v1/{mount}/data/{path}`
- KV v1: `GET /v1/{mount}/{path}`

**Response (success)**
```json
{
  "success": true,
  "host": "vault.example.com",
  "port": 8200,
  "path": "myapp/database",
  "mount": "secret",
  "kvVersion": 2,
  "data": {
    "username": "admin",
    "password": "s3cr3t"
  },
  "metadata": {
    "created_time": "2024-01-15T10:23:45.123456789Z",
    "custom_metadata": null,
    "deletion_time": "",
    "destroyed": false,
    "version": 3
  },
  "keys": ["username", "password"]
}
```

**Response (Vault error, e.g. path not found)**
```json
{
  "success": false,
  "host": "vault.example.com",
  "port": 8200,
  "httpStatus": 404,
  "path": "myapp/database",
  "error": "{\"errors\":[]}"
}
```

**Field notes:**
- `data` — for KV v2, extracted from `response.data.data`; for KV v1, from `response.data`. Returns `{}` on parse failure.
- `metadata` — KV v2 only (`response.data.metadata`); always `{}` for KV v1.
- `keys` — convenience array of key names in `data`.
- Vault returns HTTP 404 for non-existent paths and HTTP 403 for permission denied. Both surface as `success: false` with `httpStatus` set. The outer response HTTP status is always 200 (the worker always returns 200 for Vault-level errors; only worker/transport errors return 500).
- `path` field in the request must not include the mount prefix (e.g., use `"myapp/db"`, not `"secret/myapp/db"`).

**KV v2 versioning note:** KV v2 stores multiple versions per secret. This endpoint always reads the **latest version**. To read a specific version, use `/query` with path `/v1/{mount}/data/{path}?version={n}` — the `version` query parameter is passed through as part of the URL.

---

### POST /api/vault/secret/write

Write (create or update) a secret in a KV secrets engine.

**Request**
```json
{
  "host": "vault.example.com",
  "port": 8200,
  "path": "myapp/database",
  "token": "hvs.CAESIJ...",
  "data": {
    "username": "admin",
    "password": "newpassword"
  },
  "kv_version": 2,
  "mount": "secret",
  "timeout": 10000
}
```

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `host` | string | yes | — | |
| `port` | number | no | `8200` | 1–65535 |
| `path` | string | yes | — | Secret path within the mount |
| `token` | string | yes | — | |
| `data` | object | yes | — | Key-value pairs to write |
| `kv_version` | `1` or `2` | no | `2` | KV engine version |
| `mount` | string | no | `"secret"` | KV mount point |
| `timeout` | number | no | `10000` | Milliseconds |

**Vault API path and payload construction:**
- KV v2: `POST /v1/{mount}/data/{path}` with body `{"data": {your data}}`
- KV v1: `POST /v1/{mount}/{path}` with body `{your data}` directly

**KV v2 write semantics:** Each write creates a new version, incrementing the version counter. Existing versions are retained (up to the `max_versions` setting on the engine, default 0 = unlimited). **This is not destructive to previous versions** — roll back with a Vault CLI `vault kv rollback` or API call.

**KV v1 write semantics:** Overwrites the entire secret at the path. Previous value is gone with no version history.

**Response (success)**
```json
{
  "success": true,
  "host": "vault.example.com",
  "port": 8200,
  "path": "myapp/database",
  "mount": "secret",
  "kvVersion": 2,
  "rtt": 22,
  "httpStatus": 200,
  "version": 4,
  "keys": ["username", "password"]
}
```

**Response (Vault error)**
```json
{
  "success": false,
  "host": "vault.example.com",
  "port": 8200,
  "path": "myapp/database",
  "mount": "secret",
  "kvVersion": 2,
  "rtt": 11,
  "httpStatus": 403,
  "error": "permission denied"
}
```

**Field notes:**
- `version` — KV v2 only; the new version number after the write. `undefined` for KV v1 writes.
- `keys` — key names from the `data` object sent in the request (not read back from Vault).
- `error` — for Vault errors, extracted from `response.errors[0]`. Falls back to `"HTTP {statusCode}"` if `errors` is absent.
- `rtt` — round-trip time for the HTTP POST including response read.
- **Write is not idempotent for KV v2** — each call creates a new version even if data is identical.

---

## Chunked Transfer Encoding

The `decodeChunked` function handles HTTP/1.1 chunked responses from Vault. Vault uses chunked encoding for large responses (policy lists, mount dumps, etc.).

The decoder:
1. Reads the hex chunk-size line
2. Extracts exactly that many bytes
3. Repeats until a `0\r\n` terminal chunk
4. Handles truncated final chunks (partial data returned without error)

**Known limitation:** The decoder does not handle chunk extensions (e.g., `a; name="value"\r\n`). Vault does not use chunk extensions in practice, so this is safe.

---

## Error Handling and Edge Cases

### Connection Errors
If the TCP connection fails (refused, timeout, DNS failure), the outer `try/catch` in each handler returns:
```json
{"success": false, "error": "Connection timeout"}
```
HTTP status of the worker response is 500.

### Non-JSON Vault Responses
Vault always responds with JSON for API calls. If the body cannot be parsed as JSON:
- `/health`: `healthInfo` or `sealInfo` is set to `null`; individual fields fall back to `null`
- `/query`: `response` field contains the raw body string
- `/secret/read`: `data` and `metadata` are `{}` (empty objects)
- `/secret/write`: `parsed` is `{}`; `error` falls back to `"HTTP {statusCode}"`

### 512 KB Response Cap
`sendHttpGet` stops reading after 512 KB of response data. Vault responses larger than 512 KB are silently truncated. This can cause JSON parse failures for large policy lists or secret engine dumps. The `/query` endpoint will return the raw truncated string as `response` in this case.

### Timeout Behavior — GET requests
`sendHttpGet` uses a single `timeoutPromise` shared across both `socket.opened` and the read loop. If the timeout fires during the read loop, the `Promise.race` throws, which propagates through `sendHttpGet` and is caught by the handler's outer `try/catch`.

### Timeout Behavior — POST write
`handleVaultSecretWrite` uses a separate `Promise.race([rp, tp]).catch(() => {})` pattern. On timeout, the catch swallows the error and processing continues with whatever chunks were collected. **This means a timeout during write does not return an error** — it returns a response based on partial data, which may have `statusCode: 0` and `success: false`. Check `httpStatus` carefully.

### Cloudflare Detection
All four endpoints call `checkIfCloudflare(host)` before opening any socket. If the resolved IP belongs to Cloudflare, the request is rejected with HTTP 403:
```json
{
  "success": false,
  "error": "...",
  "isCloudflare": true
}
```

### Port Validation
All four endpoints validate `port` is in range 1–65535. Out-of-range values return HTTP 400.

### Method Enforcement
All four endpoints require HTTP `POST`. Other methods return HTTP 405 with `{"error": "Method not allowed"}`.

---

## Known Limitations

1. **No TLS/HTTPS** — Vault installations with `api_addr` on HTTPS (the vast majority of production deployments) cannot be reached. Port of Call connects with plaintext TCP only. Vault's TLS listener will close the connection immediately.

2. **No redirect following** — Vault cluster standbys (HA mode) redirect clients to the active node via HTTP 307. Port of Call does not follow redirects; you must target the active node directly, or use a load balancer that handles redirection.

3. **No token renewal** — Token TTLs are not checked and the token is never renewed. A token expiring mid-session will cause subsequent requests to return 403.

4. **GET-only for `/query`** — The Vault API uses POST, PUT, and DELETE for many `/v1/sys/` operations (sealing, unsealing, rotating, etc.). The `/query` endpoint only supports GET. Destructive/mutating sys operations cannot be performed.

5. **KV v2 version pinning not supported via `/secret/read`** — To read a specific version, append `?version={n}` to the path in `/query`, but `/query` is restricted to `/v1/sys/` — so specific-version reads are not possible through Port of Call's query endpoint. Only the latest version is accessible.

6. **No KV v2 metadata operations** — `GET /v1/{mount}/metadata/{path}` (list all versions) and `DELETE /v1/{mount}/metadata/{path}` (permanently delete all versions) are not exposed.

7. **No `X-Vault-Namespace` header** — Vault Enterprise namespaces are not supported. All requests go to the root namespace.

8. **No `X-Vault-Request` CSRF header** — Vault ≥ 1.17 may require the `X-Vault-Request: true` header for certain endpoints when CORS is configured. Port of Call does not send this header.

9. **No AWS/GCP/Azure auth methods** — Only static token auth is supported (the `X-Vault-Token` header). Dynamic auth methods (LDAP, Kubernetes, AppRole, etc.) require a login step that Port of Call does not implement.

10. **`/secret/write` timeout silently succeeds with partial data** — See Timeout Behavior section above.

11. **Response body decoded as UTF-8** — Binary-value secrets (stored with base64 encoding in Vault) are returned as the JSON string exactly as Vault sends them. No automatic base64 decoding is performed.

12. **No pagination** — Vault uses `?list=true` or `LIST` HTTP method for listing secrets. Port of Call's `/query` uses GET without list support. `/v1/sys/` list endpoints may return truncated results.

---

## curl Examples

### Health check (no auth required)
```bash
curl -s -X POST http://localhost:8787/api/vault/health \
  -H 'Content-Type: application/json' \
  -d '{"host": "vault.example.com", "port": 8200}'
```

### Health check with token (for sealed status details)
```bash
curl -s -X POST http://localhost:8787/api/vault/health \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "vault.example.com",
    "port": 8200,
    "token": "hvs.CAESIJ..."
  }'
```

### Query sys/mounts
```bash
curl -s -X POST http://localhost:8787/api/vault/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "vault.example.com",
    "port": 8200,
    "path": "/v1/sys/mounts",
    "token": "hvs.CAESIJ..."
  }'
```

### Query seal status (no token needed)
```bash
curl -s -X POST http://localhost:8787/api/vault/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "vault.example.com",
    "port": 8200,
    "path": "/v1/sys/seal-status"
  }'
```

### Query HA leader
```bash
curl -s -X POST http://localhost:8787/api/vault/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "vault.example.com",
    "port": 8200,
    "path": "/v1/sys/leader",
    "token": "hvs.CAESIJ..."
  }'
```

### Read a KV v2 secret
```bash
curl -s -X POST http://localhost:8787/api/vault/secret/read \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "vault.example.com",
    "port": 8200,
    "path": "myapp/database",
    "token": "hvs.CAESIJ...",
    "kv_version": 2,
    "mount": "secret"
  }'
```

### Read a KV v1 secret from a custom mount
```bash
curl -s -X POST http://localhost:8787/api/vault/secret/read \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "vault.example.com",
    "port": 8200,
    "path": "prod/config",
    "token": "hvs.CAESIJ...",
    "kv_version": 1,
    "mount": "kv"
  }'
```

### Write a KV v2 secret
```bash
curl -s -X POST http://localhost:8787/api/vault/secret/write \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "vault.example.com",
    "port": 8200,
    "path": "myapp/database",
    "token": "hvs.CAESIJ...",
    "data": {
      "username": "admin",
      "password": "newpass123"
    },
    "kv_version": 2,
    "mount": "secret"
  }'
```

### Write a KV v1 secret
```bash
curl -s -X POST http://localhost:8787/api/vault/secret/write \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "vault.example.com",
    "port": 8200,
    "path": "legacy/credentials",
    "token": "hvs.CAESIJ...",
    "data": {"api_key": "abc123"},
    "kv_version": 1,
    "mount": "kv"
  }'
```

### Directly probing Vault via curl (for comparison)
```bash
# Health (no auth)
curl -s http://vault.example.com:8200/v1/sys/health | jq .

# Seal status (no auth)
curl -s http://vault.example.com:8200/v1/sys/seal-status | jq .

# KV v2 read
curl -s -H "X-Vault-Token: hvs.CAESIJ..." \
  http://vault.example.com:8200/v1/secret/data/myapp/database | jq .

# KV v2 write
curl -s -X POST -H "X-Vault-Token: hvs.CAESIJ..." \
  -H "Content-Type: application/json" \
  -d '{"data": {"key": "value"}}' \
  http://vault.example.com:8200/v1/secret/data/myapp/database | jq .
```

---

## Vault HTTP API Response Envelope

All Vault API responses follow a standard envelope:

```json
{
  "request_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "lease_id": "",
  "renewable": false,
  "lease_duration": 0,
  "data": { ... },
  "wrap_info": null,
  "warnings": null,
  "auth": null
}
```

- `data` — the actual payload; structure varies by endpoint
- `warnings` — non-fatal warnings from Vault (e.g., token nearing expiry)
- `auth` — populated only for login responses
- `wrap_info` — populated only when response wrapping is requested (Port of Call does not request wrapping)

Error responses:
```json
{
  "errors": ["error message 1", "error message 2"]
}
```

Port of Call extracts `errors[0]` for the `error` field in write error responses.

---

## Vault Version Compatibility

| Vault Version | KV v1 | KV v2 | `hvs.` token prefix | Notes |
|---------------|-------|-------|----------------------|-------|
| < 0.9 | yes | no | no | KV v2 not available |
| 0.9 – 1.9 | yes | yes | no | `s.` token prefix |
| 1.10+ | yes | yes | yes | `hvs.`/`hvb.`/`hvr.` prefixes |

Port of Call is compatible with all versions. Token prefix does not affect API behavior — the server validates the token regardless of prefix.

---

## Security Notes

- Port of Call sends tokens in cleartext over TCP. Use only on trusted networks or via localhost.
- Tokens are included in request logs if the Cloudflare Worker logs requests — avoid logging sensitive tokens in production environments.
- The `/query` path restriction to `/v1/sys/` prevents token-bearing callers from reading arbitrary secret engine data via the query endpoint. However, a token with broad permissions can still read any `/v1/sys/` path, including sensitive endpoints like `/v1/sys/raw/{path}` (raw storage, requires `raw_storage_endpoint` config flag).
- The `/secret/write` endpoint performs a real write on each call. There is no dry-run or preview mode.
