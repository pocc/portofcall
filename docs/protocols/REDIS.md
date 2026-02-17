# Redis — Power User Reference

**Port:** 6379 (default) | **Protocol:** RESP2 | **Tests:** 17/17 ✅ Deployed

Port of Call provides three Redis endpoints: an HTTP connection probe, a one-shot command executor, and a persistent WebSocket REPL session. All three open a direct TCP connection from the Cloudflare Worker to your Redis instance.

---

## API Endpoints

### `GET/POST /api/redis/connect` — Connection probe

Connects, optionally authenticates and selects a database, sends `PING`, then runs `INFO server` to extract the server version. Opens and closes the TCP connection each call.

**POST body / GET query params:**

| Field      | Type    | Default | Notes |
|------------|---------|---------|-------|
| `host`     | string  | —       | Required |
| `port`     | number  | `6379`  | |
| `password` | string  | —       | Sent as `AUTH <password>` |
| `database` | number  | —       | Sent as `SELECT <n>` if provided |
| `timeout`  | number  | `30000` | Total timeout in ms |

**Success (200):**
```json
{
  "success": true,
  "message": "Redis server reachable",
  "host": "redis.example.com",
  "port": 6379,
  "serverInfo": "Authenticated. Database 2 selected. PING successful.",
  "version": "7.2.4"
}
```

**Error (500):** `{ "success": false, "error": "Authentication failed: -WRONGPASS..." }`

**Cloudflare-protected host (403):** `{ "success": false, "error": "...", "isCloudflare": true }`

**Notes:**
- AUTH uses the single-argument form (`AUTH <password>`). Redis 6+ ACL username/password (`AUTH <user> <password>`) is not supported.
- `version` is extracted from `INFO server` via the `redis_version:` field. Only the `server` section is fetched.
- `INFO` response is read in a single `readRESPResponse` call. On very slow or busy servers the bulk string may span multiple TCP reads; see [Known Limitations](#known-limitations).

---

### `POST /api/redis/command` — One-shot command execution

Connects, optionally authenticates/selects DB, sends one command, returns the raw RESP response string, and closes.

**POST body:**
```json
{
  "host": "redis.example.com",
  "port": 6379,
  "password": "secret",
  "database": 2,
  "command": ["SET", "foo", "bar"],
  "timeout": 30000
}
```

The `command` field is a **pre-tokenized array** — each element maps to one RESP bulk string. No shell quoting is applied.

**Success (200):**
```json
{
  "success": true,
  "response": "+OK\r\n",
  "command": ["SET", "foo", "bar"]
}
```

The `response` field is the **raw RESP wire bytes** decoded as UTF-8. Parse it with a RESP parser if you need structured output.

There is no command allowlist or blocklist. `FLUSHALL`, `CONFIG SET`, `DEBUG OBJECT`, `SHUTDOWN`, etc. all pass through.

**curl example:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/redis/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"redis.example.com","port":6379,"command":["INFO","replication"]}' \
  | jq -r '.response'
```

---

### `GET /api/redis/session` — Interactive WebSocket REPL

Upgrades to WebSocket and maintains a persistent TCP connection to Redis for the session duration.

**Connection URL:**
```
wss://portofcall.ross.gg/api/redis/session?host=redis.example.com&port=6379&password=secret&database=0
```

Query params: `host` (required), `port`, `password`, `database`.

**Worker → browser messages:**

```jsonc
// On successful connect (after AUTH and SELECT, if applicable):
{ "type": "connected", "version": "7.2.4", "host": "redis.example.com", "port": 6379 }

// Command result:
{
  "type": "response",
  "response": "1) \"foo\"\n2) \"bar\"",  // redis-cli-style formatted string
  "raw": "*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n",  // raw RESP wire bytes
  "command": ["KEYS", "*"]
}

// Fatal error (session closes after this):
{ "type": "error", "message": "Authentication failed: -WRONGPASS invalid username-password pair" }
```

**Browser → worker messages:**
```json
{ "type": "command", "command": ["HGETALL", "myhash"] }
```

The `command` array is sent directly as RESP bulk strings — pre-tokenize before sending programmatically.

**wscat example:**
```bash
wscat -c 'wss://portofcall.ross.gg/api/redis/session?host=redis.example.com&port=6379'
# After receiving {"type":"connected",...}:
> {"type":"command","command":["CLIENT","INFO"]}
> {"type":"command","command":["XINFO","STREAM","events"]}
```

**Formatting applied to `response`:**

| RESP type | Formatted output |
|-----------|-----------------|
| `+OK` | `OK` |
| `-ERR …` | `(error) ERR …` |
| `:42` | `(integer) 42` |
| `$-1` | `(nil)` |
| `$N\r\ndata` | `"data"` |
| `*0` | `(empty array)` |
| `*-1` | `(nil)` |
| `*N` (flat bulk strings) | `1) "a"\n2) "b"` |
| `*N` with integer elements | `1) (integer) 42` |

Nested arrays (e.g. `XREAD`, `CONFIG GET` with multiple fields) fall back to raw RESP in the `response` string. Parse `raw` directly for structured access.

---

## RESP Wire Format Reference

Commands are always sent as RESP arrays of bulk strings:

```
*<argc>\r\n
$<len(arg0)>\r\n<arg0>\r\n
$<len(arg1)>\r\n<arg1>\r\n
```

Response type prefixes:

| Prefix | Type | Example |
|--------|------|---------|
| `+` | Simple string | `+OK\r\n` |
| `-` | Error | `-ERR unknown command\r\n` |
| `:` | Integer | `:1000\r\n` |
| `$` | Bulk string | `$5\r\nhello\r\n` |
| `$-1` | Null bulk string | `$-1\r\n` |
| `*` | Array | `*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n` |

Inline commands (`PING\r\n` without RESP framing) are not used. RESP3 (`HELLO 3`) is not implemented.

---

## Auth Sequence

On session connect (or HTTP probe):

```
AUTH <password>      ← only if password is non-empty
SELECT <n>           ← only if database param is provided (default: Redis db 0)
INFO server          ← to extract redis_version
```

If `AUTH` returns a non-`+OK` response the session sends `{ type: 'error' }` and closes. Same for `SELECT`.

---

## UI Input Parsing

The browser UI splits the command input on `/\s+/` — each whitespace-delimited token becomes one RESP bulk string. There is no shell-style quoting.

| You type | Tokens sent | Result |
|----------|-------------|--------|
| `GET mykey` | `["GET","mykey"]` | ✅ correct |
| `SET key hello world` | `["SET","key","hello","world"]` | ❌ wrong arity |
| `SET key "hello world"` | `["SET","key","\"hello","world\""]` | ❌ quotes are literal |
| `HSET h f1 v1 f2 v2` | `["HSET","h","f1","v1","f2","v2"]` | ✅ correct |

To set values containing spaces, use the `/api/redis/command` endpoint with a pre-tokenized array, or encode the value to avoid spaces before storing.

Command history stores the last 100 commands per session, navigable with ↑/↓ arrows.

---

## Known Limitations

**Single-read response parsing:** `readRESPResponse` accumulates reads until any `\r\n` appears in the buffer, then returns immediately. For large multi-bulk responses (`KEYS *` on a huge keyspace, full `INFO` with all sections, large `HGETALL`), the first TCP segment may contain only the header line (e.g. `*10000\r\n`). The formatter then renders a truncated result. `raw` in the WS response contains whatever chunk arrived. Works reliably for typical-sized responses on low-latency connections.

**ACL AUTH (Redis 6+):** `AUTH` is called as `AUTH <password>` (single-argument). Redis 6+ ACL logins require `AUTH <username> <password>`. Workaround: use the `default` user, or send `["AUTH","username","password"]` via `/api/redis/command`.

**No TLS:** the worker uses `connect()` (plain TCP) only. Redis TLS-only instances (port 6380, `tls-replication yes`, `requirepass` with TLS) are not reachable. Put a TLS-terminating proxy (stunnel, HAProxy) in front and connect to its plaintext port.

**No pipelining:** each call to `/api/redis/command` opens and closes a new TCP connection. Use the WebSocket session for sequential commands without reconnect overhead.

**Pub/sub mode:** `SUBSCRIBE`, `PSUBSCRIBE`, and `SSUBSCRIBE` put the connection into subscriber mode where the server pushes messages without waiting for commands. The session handler reads one response per command — it surfaces the initial subscription confirmation but silently drops all subsequent pushed messages. Do not use pub/sub commands.

**MONITOR:** `MONITOR` returns `+OK` which the session shows as `OK`, but all subsequent command-stream lines from Redis are never forwarded. The session effectively goes silent.

**MULTI/EXEC transactions:** each command is a separate round-trip. `MULTI` → `OK`, each queued command → `QUEUED`, `EXEC` → multi-bulk reply. Mechanically works, but if the WebSocket drops mid-transaction no `DISCARD` is sent, leaving a dangling transaction on the server until the TCP connection times out.

**Binary values:** `TextDecoder` is used throughout. Binary Redis values (MessagePack, protobuf, raw bytes) are corrupted on decode.

**Cluster / Sentinel:** not supported. Connecting to a cluster node or Sentinel port (26379) works at the RESP level, but `MOVED`/`ASK` redirects are surfaced as error strings with no slot routing. Multi-key commands that hash to different slots return `CROSSSLOT` errors.

**Password in WebSocket URL:** `password` is passed as a query parameter and appears in Cloudflare access logs. Use short-lived or read-only credentials for session connections.

---

## Useful Commands for Port of Call

Commands that work well given the one-response-per-command model and the response size limitations:

```
INFO server
INFO replication
INFO keyspace
INFO stats
CLIENT INFO
CLIENT LIST
CLIENT GETNAME
CONFIG GET maxmemory
CONFIG GET save
CONFIG GET hz
DBSIZE
LASTSAVE
TIME
MEMORY USAGE <key>
TYPE <key>
TTL <key>
PTTL <key>
OBJECT ENCODING <key>
OBJECT REFCOUNT <key>
OBJECT IDLETIME <key>
OBJECT FREQ <key>
SCAN 0 COUNT 100
SCAN 0 MATCH prefix:* COUNT 100
HSCAN myhash 0 COUNT 20
ZSCAN myzset 0
SSCAN myset 0
XLEN <stream>
XINFO STREAM <stream>
XINFO GROUPS <stream>
XINFO CONSUMERS <stream> <group>
XRANGE <stream> - + COUNT 10
SLOWLOG GET 10
SLOWLOG LEN
LATENCY LATEST
LATENCY HISTORY event
ACL WHOAMI
ACL CAT
ACL LIST
MODULE LIST
COMMAND COUNT
COMMAND INFO GET SET HGETALL
CLUSTER INFO
CLUSTER NODES
```

Commands that **will not work** as expected:
- `SUBSCRIBE` / `PSUBSCRIBE` / `SSUBSCRIBE` — pub/sub push mode (see above)
- `MONITOR` — streaming mode; session goes silent after `+OK`
- `WAIT` — blocks until replicas acknowledge; may hit the 30s timeout on under-replicated setups

---

## Resources

- [RESP specification](https://redis.io/docs/reference/protocol-spec/)
- [RESP3 specification](https://github.com/redis/redis-specifications/blob/master/protocol/RESP3.md)
- [Redis command reference](https://redis.io/commands/)
- [Redis ACL / AUTH (v6+)](https://redis.io/docs/management/security/acl/)
- [Redis Cluster spec](https://redis.io/docs/reference/cluster-spec/)

---

## Practical Examples

### curl

```bash
# Connectivity probe (no auth)
curl -s https://portofcall.ross.gg/api/redis/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"redis.example.com","port":6379}'

# Probe with ACL user — use command endpoint for AUTH <user> <password>
curl -s https://portofcall.ross.gg/api/redis/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"redis.example.com","command":["AUTH","alice","password"]}'

# HGETALL — returns raw RESP array; parse msg.raw for structured access
curl -s https://portofcall.ross.gg/api/redis/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"redis.example.com","password":"secret","command":["HGETALL","myhash"]}'

# SCAN instead of KEYS * on large keystores
curl -s https://portofcall.ross.gg/api/redis/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"redis.example.com","command":["SCAN","0","MATCH","user:*","COUNT","100"]}'

# Memory usage of a single key (bytes, including overhead)
curl -s https://portofcall.ross.gg/api/redis/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"redis.example.com","command":["MEMORY","USAGE","bigkey"]}'

# Replication lag
curl -s https://portofcall.ross.gg/api/redis/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"redis.example.com","command":["INFO","replication"]}'
```

### WebSocket session (JavaScript)

```js
const ws = new WebSocket(
  '/api/redis/session?host=redis.example.com&port=6379&password=secret&database=0'
);

const send = (command) =>
  ws.send(JSON.stringify({ type: 'command', command }));

ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.type === 'connected') {
    console.log('Redis', msg.version, 'at', msg.host + ':' + msg.port);
    send(['CLIENT', 'SETNAME', 'portofcall']);
    send(['INFO', 'keyspace']);
  } else if (msg.type === 'response') {
    // msg.response — redis-cli style (display)
    // msg.raw      — raw RESP (parse for structured access)
    console.log(msg.response);
  } else if (msg.type === 'error') {
    console.error(msg.message);
  }
};
```

Commands are serialized over a single connection, amortizing the TCP overhead for multi-step operations.

---

## Power User Tips

### SCAN instead of KEYS \*

`KEYS *` blocks the Redis event loop for the full scan — dangerous on large keystores.
Use iterative `SCAN 0 MATCH prefix:* COUNT 100` and loop until cursor returns `"0"`.

### INFO sections

The `/api/redis/connect` endpoint only fetches `INFO server`. Fetch other sections via the command endpoint:

| Section | Key fields |
|---------|-----------|
| `server` | version, OS, uptime, config file |
| `clients` | connected_clients, blocked_clients, tracking_clients |
| `memory` | used_memory_human, mem_fragmentation_ratio, maxmemory_policy |
| `persistence` | rdb_last_bgsave_status, aof_enabled, aof_last_bgrewrite_status |
| `stats` | total_commands_processed, instantaneous_ops_per_sec, keyspace_hits, keyspace_misses |
| `replication` | role, connected_slaves, master_replid, master_repl_offset |
| `keyspace` | db0:keys=N,expires=N,avg_ttl=N (one line per active DB) |
| `all` | all sections |

### ACL users (Redis 6+)

`/api/redis/connect` only sends `AUTH <password>`. For named ACL users, send
`["AUTH", "username", "password"]` via `/api/redis/command` as the first call,
or use the WebSocket session where AUTH can be issued inline before other commands.

Each `/api/redis/command` call opens a fresh TCP connection, so credentials don't
carry over between calls.

### OBJECT ENCODING — memory layout

```
OBJECT ENCODING <key>
→ "listpack" | "ziplist" | "hashtable" | "quicklist" | "skiplist" | "embstr" | "raw" | "int"
```

Compact encodings (listpack, ziplist, embstr, int) use less memory but upgrade to
heap-allocated forms once element-count or size thresholds are exceeded.

### WAIT — write durability

After a write, confirm N replicas acknowledged before continuing:

```
WAIT <numreplicas> <timeout_ms>
→ (integer) <replicas that acked>
```

### Live introspection commands

```
MEMORY USAGE <key>              → bytes (including Redis overhead)
OBJECT FREQ <key>               → LFU frequency counter (allkeys-lfu / volatile-lfu policies only)
OBJECT IDLETIME <key>           → seconds since last access (non-LFU policies only)
MEMORY DOCTOR                   → plain-text analysis of memory issues
MEMORY STATS                    → structured memory breakdown
CONFIG GET maxmemory-policy     → eviction policy
CONFIG GET maxmemory            → memory cap
COMMAND COUNT                   → number of commands in this Redis build
COMMAND DOCS SET                → documentation for SET (Redis 7+)
LATENCY HISTORY event           → recent latency samples for an event
SLOWLOG GET 10                  → last 10 slow queries (threshold: slowlog-log-slower-than μs)
```

No command blocklist is enforced — `CONFIG SET`, `FLUSHALL`, `SHUTDOWN`, etc. all pass through.
