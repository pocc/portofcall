# etcd — Power User Reference

**Port:** 2379 (client default) | **Protocol:** etcd v3 HTTP/JSON gateway over raw TCP | **Tests:** 26/26 ✅ Deployed

Port of Call implements two endpoints. Both speak directly to etcd's v3 HTTP/JSON gateway over a raw TCP socket — because Cloudflare Workers cannot `fetch()` arbitrary HTTP on non-standard ports, only HTTPS.

---

## Transport

Raw TCP HTTP/1.1 (`cloudflare:sockets connect()`), not `fetch()`. A new connection is opened per request. Chunked transfer encoding is decoded internally. Response size is capped at **512 KB**.

Auth is HTTP Basic: `Authorization: Basic base64(username:password)`. etcd's token-based auth is not supported.

---

## Critical: base64 encoding

The etcd v3 HTTP/JSON gateway requires all keys and values to be **standard base64-encoded** in request bodies. The implementation does NOT encode for you — you must encode before sending to the query endpoint.

```
key "foo"        → "Zm9v"    (btoa("foo"))
key "/config/"   → "L2NvbmZpZy8="
value "bar"      → "YmFy"    (btoa("bar"))
```

The response decoder adds `key_decoded` and `value_decoded` alongside the raw base64 `key` / `value` fields in any `kvs` array or `prev_kv` object.

```json
{
  "kvs": [{
    "key": "Zm9v",
    "key_decoded": "foo",
    "value": "YmFy",
    "value_decoded": "bar",
    "create_revision": "12",
    "mod_revision": "14",
    "version": "3",
    "lease": "0"
  }]
}
```

`header` fields (`cluster_id`, `member_id`, `raft_term`, `revision`) are decoded from int64 strings to plain strings.

---

## API Endpoints

### `POST /api/etcd/health` — Cluster health probe

Calls three etcd paths in sequence and returns all three responses combined:

1. `GET /version` — etcd + cluster version
2. `POST /v3/maintenance/status` with `{}` — server status, leader ID, raft index
3. `GET /health` — `{"health":"true"}` style health check

**Request:**

```json
{
  "host": "etcd.example.com",
  "port": 2379,
  "username": "root",
  "password": "secret",
  "timeout": 15000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | required | |
| `port` | `2379` | |
| `username` | — | Optional; both username and password must be set for auth |
| `password` | — | |
| `timeout` | `15000` | Shared wall-clock budget for all three requests |

**Success (200):**

```json
{
  "success": true,
  "statusCode": 200,
  "parsed": {
    "version": {
      "etcdserver": "3.5.9",
      "etcdcluster": "3.5.0"
    },
    "status": {
      "header": { "cluster_id": "...", "member_id": "...", "revision": "42", "raft_term": "3" },
      "version": "3.5.9",
      "dbSize": "4096",
      "leader": "8211f1d0f64f3269",
      "raftIndex": "56",
      "raftTerm": "3",
      "raftAppliedIndex": "56",
      "dbSizeInUse": "4096"
    },
    "health": { "health": "true", "reason": "" }
  },
  "latencyMs": 38
}
```

`status` and `health` are `null` if those sub-requests fail or time out (only `version` is required for `success: true`).

**Error (500):** `{ "success": false, "error": "Connection timeout" }`

---

### `POST /api/etcd/query` — Arbitrary v3 API call

Sends a POST request to any etcd v3 HTTP/JSON gateway path. This is the general-purpose endpoint for all KV, lease, lock, maintenance, auth, and cluster operations.

**Request:**

```json
{
  "host": "etcd.example.com",
  "port": 2379,
  "username": "root",
  "password": "secret",
  "path": "/v3/kv/range",
  "body": "{\"key\":\"Zm9v\"}",
  "timeout": 15000
}
```

| Field | Notes |
|-------|-------|
| `host` | required |
| `port` | default `2379` |
| `path` | required; leading `/` added automatically if missing |
| `body` | JSON string sent as request body; defaults to `"{}"` if omitted |
| `username` / `password` | HTTP Basic Auth; both required for auth to apply |
| `timeout` | default `15000` ms |

**Important:** `body` is a **string**, not a JSON object — it's the pre-serialized JSON you want sent to etcd. Keys and values inside `body` must be base64-encoded.

**Success (200):**

```json
{
  "success": true,
  "statusCode": 200,
  "headers": { "content-type": "application/json", ... },
  "body": "{\"kvs\":[...],\"count\":\"1\"}",
  "parsed": {
    "kvs": [{ "key": "Zm9v", "key_decoded": "foo", "value": "YmFy", "value_decoded": "bar", ... }],
    "count": "1"
  },
  "latencyMs": 12
}
```

`parsed` is null if the response body is not valid JSON. `body` always contains the raw response string.

`success` is `true` for any 2xx–3xx HTTP status code from etcd. A 401 Unauthorized or 404 from etcd still returns HTTP 200 from the Port of Call endpoint — check `statusCode` in the response.

---

## v3 HTTP/JSON Gateway Reference

All operations use the query endpoint. The `body` field must be valid JSON with base64-encoded keys/values.

### KV operations

```bash
# Get a single key
path: /v3/kv/range
body: '{"key":"Zm9v"}'
# → kvs array, count

# Get all keys with prefix /config/
path: /v3/kv/range
body: '{"key":"L2NvbmZpZy8=","range_end":"L2NvbmZpZzA="}'
# range_end is prefix with last byte incremented — see Prefix Queries below

# Keys only (no values) — faster for large prefix scans
path: /v3/kv/range
body: '{"key":"L2NvbmZpZy8=","range_end":"L2NvbmZpZzA=","keys_only":true}'

# Limit results
path: /v3/kv/range
body: '{"key":"Yg==","range_end":"Yw==","limit":20}'

# Get all keys in keyspace (empty range, use \x00 = "AA==" as range_end)
path: /v3/kv/range
body: '{"key":"AA==","range_end":"AA=="}'
```

```bash
# Put
path: /v3/kv/put
body: '{"key":"Zm9v","value":"YmFy"}'
# → header only (no prevKv unless prev_kv: true)

# Put with previous value returned
body: '{"key":"Zm9v","value":"bmV3","prev_kv":true}'
# → { header, prev_kv: { key, key_decoded, value, value_decoded, ... } }

# Put with lease (key expires when lease expires)
body: '{"key":"Zm9v","value":"YmFy","lease":"7587854612027467777"}'
```

```bash
# Delete one key
path: /v3/kv/deleterange
body: '{"key":"Zm9v"}'
# → { header, deleted: "1" }

# Delete all keys with prefix
path: /v3/kv/deleterange
body: '{"key":"L2NvbmZpZy8=","range_end":"L2NvbmZpZzA="}'
# → { header, deleted: "N" }

# Delete with prev_kv
body: '{"key":"Zm9v","prev_kv":true}'
# → { header, deleted: "1", prev_kvs: [...] }
```

### Transactions (CAS)

```bash
path: /v3/kv/txn
body: '{
  "compare": [{
    "target": "VALUE",
    "key": "bG9jaw==",
    "value": "dW5sb2NrZWQ="
  }],
  "success": [{"requestPut":{"key":"bG9jaw==","value":"bG9ja2Vk"}}],
  "failure": []
}'
# → { header, succeeded: true/false, responses: [...] }
```

Target values: `"VERSION"`, `"CREATE"`, `"MOD"`, `"VALUE"`, `"LEASE"`
Result values: `"EQUAL"`, `"GREATER"`, `"LESS"`, `"NOT_EQUAL"`

The compare field that's tested depends on `target`:

| `target` | Field in compare body | Common use |
|----------|----------------------|------------|
| `VERSION` | `"version": "N"` | Check per-key write count; `"0"` means key doesn't exist |
| `CREATE` | `"create_revision": "N"` | Key was created at this global revision |
| `MOD` | `"mod_revision": "N"` | Key last modified at this global revision (optimistic lock) |
| `VALUE` | `"value": "<base64>"` | Atomic compare-and-swap on value |
| `LEASE` | `"lease": "N"` | Key attached to this lease ID |

**Common compare patterns:**

```json
// Key does not exist (version 0 = never written or was deleted)
{"target":"VERSION","key":"...","result":"EQUAL","version":"0"}

// Key exists
{"target":"VERSION","key":"...","result":"GREATER","version":"0"}

// Optimistic lock: succeed only if key hasn't changed since you read it
{"target":"MOD","key":"...","result":"EQUAL","mod_revision":"<revision you read>"}

// CAS on expected value
{"target":"VALUE","key":"...","result":"EQUAL","value":"<base64 expected>"}
```

Multiple compare conditions are AND'd together. The `success` and `failure` branches support `request_put`, `request_delete_range`, and `request_range` operations. Responses are in `responses[n].response_put`, `responses[n].response_delete_range`, or `responses[n].response_range`.

---

## Revision Semantics

Every KV object returned by range/get/txn carries three separate "version" concepts:

| Field | Scope | Resets on delete? | Use case |
|-------|-------|-------------------|----------|
| `version` | Per-key write count | Yes (resets to `"1"` on re-create) | Check if a key has been modified at all; detect first write |
| `create_revision` | Global cluster revision at first create | — | Track when a key was born; anchor for history queries |
| `mod_revision` | Global cluster revision at last write | No | Optimistic locking; `range` with `min_mod_revision` / `max_mod_revision` filters |

The global `revision` in response headers increases monotonically for every successful write across the entire cluster. Compare `mod_revision` against the current header `revision` to compute "how many cluster writes have happened since you last saw this key."

### Leases

```bash
# Grant a lease with 60-second TTL
path: /v3/lease/grant
body: '{"TTL":60}'
# → { header, ID: "7587854612027467777", TTL: "60" }

# Revoke a lease (all keys attached to it are deleted)
path: /v3/lease/revoke
body: '{"ID":"7587854612027467777"}'

# Keepalive (reset TTL; call before expiry)
path: /v3/lease/keepalive
body: '{"ID":"7587854612027467777"}'
# → { result: { header, ID, TTL } }

# Query remaining TTL
path: /v3/lease/timetolive
body: '{"ID":"7587854612027467777","keys":true}'
# → { header, ID, TTL, grantedTTL, keys: [...] }

# List all leases
path: /v3/lease/leases
body: '{}'
# → { header, leases: [{ ID }, ...] }
```

### Maintenance

```bash
# Server status (leader, raft index, DB size)
path: /v3/maintenance/status
body: '{}'

# Compact revision history up to revision N
path: /v3/maintenance/compact
body: '{"revision":"40"}'

# Defragment (reclaim free space; use carefully — blocks etcd)
path: /v3/maintenance/defragment
body: '{}'

# Alarm list
path: /v3/maintenance/alarm
body: '{"action":"GET"}'
```

### Cluster

```bash
# List cluster members
path: /v3/cluster/member/list
body: '{}'
# → { header, members: [{ ID, name, peerURLs, clientURLs, isLearner }] }
```

### Auth

```bash
# List roles
path: /v3/auth/role/list
body: '{}'

# List users
path: /v3/auth/user/list
body: '{}'

# Get role permissions
path: /v3/auth/role/get
body: '{"role":"root"}'

# Enable auth (requires root user)
path: /v3/auth/enable
body: '{}'
```

### Watch (not supported)

`/v3/watch` is a long-running streaming endpoint that sends newline-delimited JSON events. The query endpoint opens and closes a single request/response cycle — the connection is closed after reading the full body. Watch events will not be delivered. Use `etcdctl watch` or a native etcd client for watch operations.

---

## Prefix Queries

The v3 range API uses `range_end` to express prefix queries. The etcd convention is to increment the last byte of the prefix string (before base64 encoding):

```js
// JavaScript: compute range_end for a prefix
function prefixRangeEnd(prefix) {
  const bytes = new TextEncoder().encode(prefix);
  const end = new Uint8Array(bytes);
  end[end.length - 1]++;
  return btoa(String.fromCharCode(...end));
}

prefixRangeEnd("/config/")   // → "L2NvbmZpZzA=" (incremented '/' to '0')
prefixRangeEnd("/services/") // → "L3NlcnZpY2VzMA=="
```

To get all keys in the keyspace: use `key: "AA=="` (the null byte `\x00`) and `range_end: "AA=="` — etcd interprets the all-zeroes range end as unbounded.

---

## Practical curl Examples

```bash
BASE=https://portofcall.ross.gg/api

# Health probe (no auth)
curl -s $BASE/etcd/health \
  -H 'Content-Type: application/json' \
  -d '{"host":"etcd.example.com","port":2379}'

# Health probe (with auth)
curl -s $BASE/etcd/health \
  -H 'Content-Type: application/json' \
  -d '{"host":"etcd.example.com","username":"root","password":"secret"}'

# Get a key (base64-encode the key yourself)
curl -s $BASE/etcd/query \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"etcd.example.com\",\"path\":\"/v3/kv/range\",\"body\":\"{\\\"key\\\":\\\"$(echo -n /config/db/url | base64)\\\"}\"}" \
  | jq '.parsed'

# Put a key
KEY=$(echo -n /config/db/url | base64)
VAL=$(echo -n postgres://localhost/mydb | base64)
curl -s $BASE/etcd/query \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"etcd.example.com\",\"path\":\"/v3/kv/put\",\"body\":\"{\\\"key\\\":\\\"$KEY\\\",\\\"value\\\":\\\"$VAL\\\"}\"}"

# List cluster members
curl -s $BASE/etcd/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"etcd.example.com","path":"/v3/cluster/member/list","body":"{}"}'

# Get all keys with prefix /services/ (keys only)
PREFIX=$(echo -n /services/ | base64)
RANGE_END="L3NlcnZpY2VzMA=="   # /services/ with last byte incremented
curl -s $BASE/etcd/query \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"etcd.example.com\",\"path\":\"/v3/kv/range\",\"body\":\"{\\\"key\\\":\\\"$PREFIX\\\",\\\"range_end\\\":\\\"$RANGE_END\\\",\\\"keys_only\\\":true}\"}" \
  | jq '.parsed.kvs[].key_decoded'

# Grant a 60s lease
curl -s $BASE/etcd/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"etcd.example.com","path":"/v3/lease/grant","body":"{\"TTL\":60}"}' \
  | jq '.parsed.ID'
```

---

## Known Limitations

**No Watch streaming.** `/v3/watch` delivers events via a long-lived streaming response — not compatible with the single-request/response model. POST to `/v3/watch` returns `{"result":{}}` with no events.

**No gRPC.** Only the HTTP/JSON gateway (port 2379 by default). The gRPC endpoint on the same port requires HTTP/2 with binary protobuf — not supported.

**No Cloudflare detection.** Unlike Redis, the etcd implementation does not check Cloudflare before connecting. Connecting to a CF-protected host will fail at the TCP or HTTP layer with a generic 500 error.

**512 KB response cap.** Responses are truncated at 512 KB. Large keyspace dumps (`key: "AA=="`, `range_end: "AA=="`) or large values may return truncated JSON that cannot be parsed (the `parsed` field will be null; `body` contains the raw truncated string).

**Base64 not validated.** Invalid base64 in a request body is sent verbatim to etcd, which returns a gRPC error like `{"error":"etcdserver: requested lease not found","code":5}`.

**HTTP Basic Auth only.** Token-based auth (`/v3/auth/authenticate` for a token, then `Authorization: Bearer TOKEN`) is not supported. Basic Auth sends credentials on every request.

**Revision integers as strings.** The v3 HTTP/JSON gateway returns int64 values as JSON strings (`"revision": "42"`, `"deleted": "3"`). This is correct per the etcd API; parse them explicitly.

---

## Resources

- [etcd v3 API reference](https://etcd.io/docs/v3.5/learning/api/)
- [etcd v3 HTTP/JSON gateway](https://etcd.io/docs/v3.5/dev-guide/api_grpc_gateway/)
- [etcdctl reference](https://etcd.io/docs/v3.5/op-guide/etcdctl/)
- [Kubernetes etcd operations](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/)
