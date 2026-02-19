# Sonic Search Backend — Power-User Reference

**Port:** 1491 (default)
**Transport:** TCP (Cloudflare Workers `connect()`)
**Implementation:** `src/worker/sonic.ts`
**Routes:**
- `POST /api/sonic/probe` (index.ts)
- `POST /api/sonic/query` (index.ts)
- `POST /api/sonic/push` (index.ts)
- `POST /api/sonic/suggest` (index.ts)
- `POST /api/sonic/ping` (index.ts)

Sonic is a lightweight, fast, full-text search backend written in Rust. It uses a simple text-based protocol over TCP with three operational modes: search (query), ingest (index), and control (admin). Each connection starts a session in one mode and requires authentication if configured.

---

## Endpoints

### `POST /api/sonic/probe`

Comprehensive Sonic server inspection. Tests all three modes (control, search, ingest), retrieves server stats via INFO command, validates PING/PONG, and measures RTT. Returns protocol version, buffer size, mode availability, and server statistics.

**Request:**
```json
{
  "host": "sonic.example.com",
  "port": 1491,
  "timeout": 10000,
  "password": "SecretPassword"
}
```

| Field     | Required | Default | Notes |
|-----------|----------|---------|-------|
| `host`    | Yes      | —       | Hostname or IP. Cloudflare IPs rejected (403). |
| `port`    | No       | `1491`  | Validated 1–65535. |
| `timeout` | No       | `10000` | Validated 1–60000 ms. Shared across all mode tests. |
| `password`| No       | `null`  | Sent in `START <mode> <password>` if provided. |

**Success response:**
```json
{
  "success": true,
  "host": "sonic.example.com",
  "port": 1491,
  "rtt": 125,
  "instanceId": "sonic-7f8a9b2c",
  "protocol": 1,
  "bufferSize": 20000,
  "modes": {
    "control": true,
    "search": true,
    "ingest": true
  },
  "stats": {
    "uptime": "3600",
    "clients_connected": "5",
    "commands_total": "12345",
    "command_latency_best": "0.1",
    "kv_open_count": "2",
    "fst_open_count": "2",
    "fst_consolidate_count": "10"
  }
}
```

| Field        | Type   | Notes |
|--------------|--------|-------|
| `instanceId` | string | From `CONNECTED <id>` banner. May be empty. |
| `protocol`   | number | Protocol version from `STARTED` response (typically 1). |
| `bufferSize` | number | Max command/data size in bytes. Typically 20000. |
| `modes`      | object | Boolean flags indicating successful START for each mode. |
| `stats`      | object | Key-value pairs from `INFO` response (control mode only). Empty if control failed. |

**Error responses:**

| HTTP | Condition |
|------|-----------|
| 400  | Missing host, invalid port (not 1–65535), invalid timeout (not 1–60000ms). |
| 403  | Cloudflare IP detected. |
| 500  | Connection failure, timeout, banner mismatch, authentication failure. |

---

### `POST /api/sonic/query`

Execute a full-text search query against a Sonic collection.

**Request:**
```json
{
  "host": "sonic.example.com",
  "port": 1491,
  "password": "SecretPassword",
  "timeout": 10000,
  "collection": "messages",
  "bucket": "default",
  "terms": "search query",
  "limit": 10
}
```

| Field        | Required | Default | Notes |
|--------------|----------|---------|-------|
| `host`       | Yes      | —       | Cloudflare IPs rejected (403). |
| `port`       | No       | `1491`  | Validated 1–65535. |
| `password`   | No       | `null`  | For authenticated servers. |
| `timeout`    | No       | `10000` | Validated 1–60000 ms. |
| `collection` | Yes      | —       | Alphanumeric, underscore, hyphen only. Max 64 chars. |
| `bucket`     | Yes      | —       | Alphanumeric, underscore, hyphen only. Max 64 chars. |
| `terms`      | Yes      | —       | Search query. Quotes and backslashes escaped automatically. |
| `limit`      | No       | `10`    | Max results. Sent as `LIMIT(n)` parameter. |

**Success response:**
```json
{
  "success": true,
  "host": "sonic.example.com",
  "port": 1491,
  "collection": "messages",
  "bucket": "default",
  "terms": "search query",
  "results": ["msg:1234", "msg:5678", "msg:9012"],
  "count": 3
}
```

| Field     | Type     | Notes |
|-----------|----------|-------|
| `results` | string[] | Object IDs matching the query. Empty array if no matches. |
| `count`   | number   | Length of results array. |

**Error responses:**

| HTTP | Condition |
|------|-----------|
| 400  | Missing required fields, invalid port/timeout, invalid collection/bucket format. |
| 403  | Cloudflare IP detected. |
| 500  | Connection failure, authentication failure, server returned ERR. |

**Protocol flow:**
```
Client                    Sonic (:1491)
  │                            │
  ├──── CONNECTED banner ─────┤
  ├──── START search [pass] ──▶│
  │◀─── STARTED search... ─────┤
  ├──── QUERY coll bkt "..." ─▶│
  │◀─── PENDING <query_id> ────┤
  │◀─── EVENT QUERY <id> r1 r2 │
  ├──── QUIT ─────────────────▶│
  │◀─── ENDED quit ────────────┤
```

---

### `POST /api/sonic/push`

Index text into a Sonic collection for full-text search.

**Request:**
```json
{
  "host": "sonic.example.com",
  "port": 1491,
  "password": "SecretPassword",
  "timeout": 10000,
  "collection": "messages",
  "bucket": "default",
  "objectId": "msg:1234",
  "text": "This is the full text of the message to index."
}
```

| Field        | Required | Default | Notes |
|--------------|----------|---------|-------|
| `host`       | Yes      | —       | Cloudflare IPs rejected (403). |
| `port`       | No       | `1491`  | Validated 1–65535. |
| `password`   | No       | `null`  | For authenticated servers. |
| `timeout`    | No       | `10000` | Validated 1–60000 ms. |
| `collection` | Yes      | —       | Alphanumeric, underscore, hyphen only. Max 64 chars. |
| `bucket`     | Yes      | —       | Alphanumeric, underscore, hyphen only. Max 64 chars. |
| `objectId`   | Yes      | —       | Unique object identifier. Alphanumeric, underscore, hyphen only. Max 64 chars. |
| `text`       | Yes      | —       | Text to index. Quotes and backslashes escaped automatically. |

**Success response:**
```json
{
  "success": true,
  "host": "sonic.example.com",
  "port": 1491,
  "collection": "messages",
  "bucket": "default",
  "objectId": "msg:1234",
  "response": "OK"
}
```

**Error responses:**

| HTTP | Condition |
|------|-----------|
| 400  | Missing required fields, invalid port/timeout, invalid collection/bucket/objectId format. |
| 403  | Cloudflare IP detected. |
| 500  | Connection failure, authentication failure, server returned non-OK response. |

**Protocol flow:**
```
Client                    Sonic (:1491)
  │                            │
  ├──── CONNECTED banner ─────┤
  ├──── START ingest [pass] ─▶│
  │◀─── STARTED ingest... ────┤
  ├──── PUSH coll bkt id "..." │
  │◀─── OK ────────────────────┤
  ├──── QUIT ─────────────────▶│
  │◀─── ENDED quit ────────────┤
```

---

### `POST /api/sonic/suggest`

Get auto-complete suggestions for a partial word.

**Request:**
```json
{
  "host": "sonic.example.com",
  "port": 1491,
  "password": "SecretPassword",
  "timeout": 10000,
  "collection": "messages",
  "bucket": "default",
  "word": "hel",
  "limit": 5
}
```

| Field        | Required | Default | Notes |
|--------------|----------|---------|-------|
| `host`       | Yes      | —       | Cloudflare IPs rejected (403). |
| `port`       | No       | `1491`  | Validated 1–65535. |
| `password`   | No       | `null`  | For authenticated servers. |
| `timeout`    | No       | `10000` | Validated 1–60000 ms. |
| `collection` | Yes      | —       | Alphanumeric, underscore, hyphen only. Max 64 chars. |
| `bucket`     | Yes      | —       | Alphanumeric, underscore, hyphen only. Max 64 chars. |
| `word`       | Yes      | —       | Partial word prefix. Quotes and backslashes escaped automatically. |
| `limit`      | No       | `5`     | Max suggestions. Sent as `LIMIT(n)` parameter. |

**Success response:**
```json
{
  "success": true,
  "host": "sonic.example.com",
  "port": 1491,
  "collection": "messages",
  "bucket": "default",
  "word": "hel",
  "suggestions": ["hello", "help", "helmet"]
}
```

**Error responses:**

| HTTP | Condition |
|------|-----------|
| 400  | Missing required fields, invalid port/timeout, invalid collection/bucket format. |
| 403  | Cloudflare IP detected. |
| 500  | Connection failure, authentication failure, server returned ERR. |

**Protocol flow:**
```
Client                    Sonic (:1491)
  │                            │
  ├──── CONNECTED banner ─────┤
  ├──── START search [pass] ──▶│
  │◀─── STARTED search... ─────┤
  ├──── SUGGEST coll bkt "..." │
  │◀─── PENDING <suggest_id> ──┤
  │◀─── EVENT SUGGEST <id> w1 w2 │
  ├──── QUIT ─────────────────▶│
  │◀─── ENDED quit ────────────┤
```

---

### `POST /api/sonic/ping`

Lightweight health check. Starts search mode session, sends PING, expects PONG.

**Request:**
```json
{
  "host": "sonic.example.com",
  "port": 1491,
  "timeout": 10000,
  "password": "SecretPassword"
}
```

| Field     | Required | Default | Notes |
|-----------|----------|---------|-------|
| `host`    | Yes      | —       | Cloudflare IPs rejected (403). |
| `port`    | No       | `1491`  | Validated 1–65535. |
| `timeout` | No       | `10000` | Validated 1–60000 ms. |
| `password`| No       | `null`  | For authenticated servers. |

**Success response:**
```json
{
  "success": true,
  "host": "sonic.example.com",
  "port": 1491,
  "rtt": 45,
  "alive": true,
  "response": "PONG"
}
```

| Field      | Type    | Notes |
|------------|---------|-------|
| `alive`    | boolean | `true` if response was exactly `PONG`, otherwise `false`. |
| `response` | string  | Raw server response to PING command. |

**Error responses:**

| HTTP | Condition |
|------|-----------|
| 400  | Missing host, invalid port/timeout. |
| 403  | Cloudflare IP detected. |
| 500  | Connection failure, timeout, authentication failure. |

---

## Sonic Protocol Details

### Session Lifecycle

Every Sonic connection follows this pattern:

1. **Client connects** to `host:port` (default 1491)
2. **Server sends banner:** `CONNECTED <instance_id>\r\n`
3. **Client starts mode:** `START <mode> [<password>]\r\n`
   - Modes: `search`, `ingest`, `control`
4. **Server confirms:** `STARTED <mode> protocol(<version>) buffer(<size>)\r\n`
5. **Commands exchanged** (specific to mode)
6. **Client quits:** `QUIT\r\n`
7. **Server ends:** `ENDED quit\r\n`

### Command Reference by Mode

**All modes:**
- `PING` → `PONG`
- `QUIT` → `ENDED quit`

**Control mode only:**
- `INFO` → `RESULT uptime(3600) clients_connected(5) ...`

**Search mode only:**
- `QUERY <collection> <bucket> "<terms>" [LIMIT(<n>)]` → `PENDING <id>` then `EVENT QUERY <id> <oid1> <oid2> ...`
- `SUGGEST <collection> <bucket> "<word>" [LIMIT(<n>)]` → `PENDING <id>` then `EVENT SUGGEST <id> <word1> <word2> ...`

**Ingest mode only:**
- `PUSH <collection> <bucket> <object> "<text>"` → `OK`
- `POP <collection> <bucket> <object> "<text>"` → `OK` (delete specific text)
- `COUNT <collection> [<bucket> [<object>]]` → `RESULT <count>`
- `FLUSHC <collection>` → `RESULT <count>` (clear collection)
- `FLUSHB <collection> <bucket>` → `RESULT <count>` (clear bucket)
- `FLUSHO <collection> <bucket> <object>` → `RESULT <count>` (clear object)

### Text Escaping

All text passed in quotes (`"..."`) must escape:
1. Backslashes: `\` → `\\`
2. Quotes: `"` → `\"`

Example: `He said "hello"` → `He said \"hello\"`
Example: `Path: C:\Users` → `Path: C:\\Users`

This implementation handles escaping automatically via `escapeSonicText()`.

### Identifier Validation

Collection, bucket, and objectId fields are validated as:
- Alphanumeric characters, underscore, hyphen only: `/^[a-zA-Z0-9_-]+$/`
- Maximum 64 characters

Invalid identifiers return HTTP 400 with descriptive error.

### Buffer Size

The `buffer(<size>)` value in the `STARTED` response (typically 20000 bytes) is the maximum size for:
- Command line (including `PUSH` text)
- Query terms
- Response data

This implementation does not enforce buffer size limits client-side. Exceeding the buffer causes server to return `ERR`.

---

## Known Quirks and Limitations

### No buffer size enforcement
The server advertises `buffer(<size>)` in the `STARTED` response (typically 20000 bytes) but this implementation never validates that PUSH text or QUERY terms fit within that limit. Oversized commands fail with `ERR` response at server side.

### No connection pooling
Each endpoint opens a fresh TCP connection and closes it after the command completes. Sonic supports persistent connections (send multiple commands in one session), but this is not implemented. High-frequency operations pay full TCP handshake cost per request.

### Probe endpoint tests modes sequentially
`/api/sonic/probe` opens three separate connections to test control, search, and ingest modes. If the server is slow or the timeout is tight, later mode tests may fail even if the modes are available. Total probe time can approach `3 × timeout` in worst case.

### INFO stats parsing is fragile
The `parseInfoLine` function uses regex `/(\w[\w.]+)\(([^)]*)\)/g` to extract `key(value)` pairs. Malformed responses or keys with unexpected characters may be silently dropped from the stats object.

### EVENT response parsing assumes space-separated IDs
Query and suggest results are parsed by splitting `EVENT ... <data>` on spaces: `.split(' ')`. If Sonic ever returns object IDs containing spaces (unlikely but not forbidden by protocol spec), they would be split incorrectly.

### No OFFSET support
Sonic supports `OFFSET(<n>)` parameter for pagination in QUERY/SUGGEST, but this implementation does not expose it. Only `LIMIT` is supported. Clients must implement pagination by filtering results client-side.

### Password sent in plaintext
Sonic protocol sends passwords in cleartext: `START <mode> <password>`. No encryption, hashing, or challenge-response. The password is visible to anyone who can sniff the TCP stream. Use firewall rules or VPN to secure Sonic connections.

### QUIT response not enforced
The implementation sends `QUIT` and reads the response (`ENDED quit` expected) but does not fail or retry if the response is malformed. This is treated as non-critical protocol violation.

### No LANG parameter
Sonic supports `LANG(<locale>)` parameter in QUERY/SUGGEST to control stemming (e.g. `LANG(fra)` for French). This is not exposed in the API. All queries use server-default language.

### No CONSOLIDATE command
Ingest mode supports `CONSOLIDATE` to force FST index compaction. This is not exposed. Consolidation happens automatically based on server configuration.

### Timeout is shared across all operations
A single `setTimeout` handle is created at connection time and reused for banner read, START, command, and QUIT. If the banner read takes 9s of a 10s timeout, only 1s remains for the rest of the session.

### No retry logic
Connection failures, timeouts, and server errors immediately return HTTP 500. No automatic retry or exponential backoff.

### Empty results vs. error indistinguishable in some cases
If `EVENT QUERY <id> ` has no results (empty space after ID), the implementation returns `results: []`. If the EVENT line is malformed and regex doesn't match, it also returns `results: []`. No way to distinguish legitimate empty result from parse failure.

### Control mode INFO may fail silently
If control mode starts successfully but `INFO` command returns something other than `RESULT ...`, the `stats` field is set to `undefined` rather than throwing an error.

### Reader/writer lock release wrapped in try-catch
Lock release calls (`releaseLock()`) are wrapped in empty try-catch blocks. If lock release throws (rare but possible if stream is corrupted), the exception is silently suppressed.

### No validation of server protocol version
The implementation parses `protocol(<version>)` from `STARTED` but never validates the version number. If Sonic releases a protocol v2 with breaking changes, this implementation would blindly proceed.

---

## Error Messages

### Client-side validation errors (HTTP 400)
- `Host is required`
- `Port must be between 1 and 65535`
- `Timeout must be between 1 and 60000 ms`
- `host, collection, bucket, and terms are required` (query)
- `host, collection, bucket, objectId, and text are required` (push)
- `host, collection, bucket, and word are required` (suggest)
- `collection must contain only alphanumeric, underscore, or hyphen characters`
- `collection must be 64 characters or less`
- `bucket must contain only alphanumeric, underscore, or hyphen characters`
- `bucket must be 64 characters or less`
- `objectId must contain only alphanumeric, underscore, or hyphen characters`
- `objectId must be 64 characters or less`

### Cloudflare detection (HTTP 403)
- `[host] resolves to Cloudflare IP [ip]. Probing Cloudflare infrastructure is not allowed.`

### Connection errors (HTTP 500)
- `Connection timeout` (socket didn't open within timeout)
- `Timeout` (command didn't complete within timeout)
- `Unexpected banner: <text>` (server didn't send `CONNECTED`)
- `Not a Sonic server: <text>` (ping-specific banner check)
- `Failed to start search mode: <response>` (START didn't return STARTED)
- `Failed to start ingest mode: <response>`
- `Failed to start Sonic session` (ping: tryStartMode returned null)
- Server ERR messages (passed through from Sonic, e.g. `invalid_channel_name`)

---

## curl Examples

**Probe server capabilities:**
```bash
curl -s -X POST https://portofcall.app/api/sonic/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"127.0.0.1"}' | jq .
```

**Search with authentication:**
```bash
curl -s -X POST https://portofcall.app/api/sonic/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "127.0.0.1",
    "password": "SecretPassword",
    "collection": "messages",
    "bucket": "default",
    "terms": "hello world",
    "limit": 20
  }' | jq .
```

**Index a document:**
```bash
curl -s -X POST https://portofcall.app/api/sonic/push \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "127.0.0.1",
    "password": "SecretPassword",
    "collection": "messages",
    "bucket": "user:1234",
    "objectId": "msg:5678",
    "text": "This is the full text of the message to be indexed for search."
  }' | jq .
```

**Auto-complete suggestions:**
```bash
curl -s -X POST https://portofcall.app/api/sonic/suggest \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "127.0.0.1",
    "password": "SecretPassword",
    "collection": "messages",
    "bucket": "default",
    "word": "hel",
    "limit": 10
  }' | jq '.suggestions'
```

**Health check:**
```bash
curl -s -X POST https://portofcall.app/api/sonic/ping \
  -H 'Content-Type: application/json' \
  -d '{"host":"127.0.0.1","timeout":5000}' | jq '{alive,rtt}'
```

**Custom port and timeout:**
```bash
curl -s -X POST https://portofcall.app/api/sonic/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "sonic.example.com",
    "port": 1492,
    "timeout": 20000,
    "collection": "docs",
    "bucket": "public",
    "terms": "search terms"
  }' | jq .
```

---

## Common INFO Stats

The `INFO` command (control mode) returns server statistics as space-separated `key(value)` pairs. Common keys:

| Key | Type | Meaning |
|-----|------|---------|
| `uptime` | seconds | Time since server start |
| `clients_connected` | integer | Current client count |
| `commands_total` | integer | Total commands processed |
| `command_latency_best` | milliseconds | Fastest command ever |
| `command_latency_worst` | milliseconds | Slowest command ever |
| `kv_open_count` | integer | Open KV stores (collections × buckets) |
| `kv_total_size` | bytes | Total KV disk usage |
| `fst_open_count` | integer | Open FST indexes (full-text structures) |
| `fst_consolidate_count` | integer | FST consolidation operations performed |

Example output:
```
uptime(3600) clients_connected(5) commands_total(12345)
command_latency_best(0.1) command_latency_worst(125.3)
kv_open_count(2) fst_open_count(2) fst_consolidate_count(10)
```

---

## Comparison to Other Search Backends

| Feature | Sonic | Elasticsearch | Meilisearch |
|---------|-------|---------------|-------------|
| Protocol | Custom TCP text | HTTP REST | HTTP REST |
| Indexing | Ingest mode | Index API | POST /indexes |
| Querying | Search mode | Query DSL | GET /indexes/search |
| Footprint | ~5MB RAM/index | ~1GB+ | ~50MB+ |
| Language | Rust | Java | Rust |
| Auth | Plaintext password | API key / OAuth | API key |
| Clustering | No | Yes | No (roadmap) |

Sonic is optimized for speed and low memory usage. It trades advanced features (aggregations, clustering, highlighting) for sub-millisecond query latency and tiny resource footprint. Ideal for auto-complete, simple search, and embedded use cases.

---

## References

- [Sonic GitHub](https://github.com/valeriansaliou/sonic)
- [Protocol Specification](https://github.com/valeriansaliou/sonic/blob/master/PROTOCOL.md)
- [Sonic Configuration](https://github.com/valeriansaliou/sonic/blob/master/config.cfg)

---

## Security Considerations

1. **Plaintext passwords:** Sonic sends passwords unencrypted over TCP. Use firewall rules or VPN to restrict access.

2. **No rate limiting:** This implementation does not rate-limit requests. A malicious client can spam `/api/sonic/push` to exhaust server disk or memory.

3. **No input sanitization beyond identifier validation:** Text content is escaped for protocol safety but not sanitized for content (e.g. HTML, SQL). Caller must sanitize before display.

4. **Cloudflare detection prevents internal probes:** The Cloudflare IP check rejects any target resolving to Cloudflare ranges. This prevents probing internal Cloudflare services but also blocks legitimate Sonic instances running on Cloudflare-assigned IPs.

5. **Timeout is user-controlled:** Client can set timeout up to 60000ms. Long timeouts can tie up Worker CPU time. Production deployments should enforce lower limits.

6. **No TLS support:** Sonic protocol has no native encryption. If deployed over the internet, use SSH tunnel or VPN.
