# Redis Sentinel — Power User Reference

**Port:** 26379 (default) | **Protocol:** RESP (same as Redis) | **Tests:** Not yet deployed

Port of Call provides four Redis Sentinel endpoints for high availability monitoring, service discovery, and cluster health inspection. All endpoints open a direct TCP connection from the Cloudflare Worker to your Sentinel instance.

---

## API Endpoints

### `POST /api/sentinel/probe` — Connection and topology probe

Connects to a Sentinel, optionally authenticates, sends `PING`, runs `INFO sentinel` and `INFO server` to extract version, then queries `SENTINEL masters` to list all monitored master groups. Opens and closes the TCP connection each call.

**POST body:**

| Field      | Type    | Default | Notes |
|------------|---------|---------|-------|
| `host`     | string  | —       | Required. Must match `[a-zA-Z0-9._:-]+` |
| `port`     | number  | `26379` | Range: 1-65535 |
| `password` | string  | —       | Sent as `AUTH <password>` if provided (including empty string) |
| `timeout`  | number  | `10000` | Total timeout in ms (max 30000) |

**Success (200):**
```json
{
  "success": true,
  "host": "sentinel.example.com",
  "port": 26379,
  "version": "7.2.4",
  "sentinelInfo": {
    "sentinel_masters": "2",
    "sentinel_tilt": "0",
    "sentinel_running_scripts": "0",
    "sentinel_scripts_queue_length": "0",
    "sentinel_simulate_failure_flags": "0"
  },
  "masters": [
    {
      "name": "mymaster",
      "ip": "127.0.0.1",
      "port": "6379",
      "runid": "abc123...",
      "flags": "master",
      "link-pending-commands": "0",
      "link-refcount": "1",
      "last-ping-sent": "0",
      "last-ok-ping-reply": "123",
      "last-ping-reply": "123",
      "down-after-milliseconds": "30000",
      "info-refresh": "5000",
      "role-reported": "master",
      "role-reported-time": "1234567",
      "config-epoch": "0",
      "num-slaves": "2",
      "num-other-sentinels": "2",
      "quorum": "2",
      "failover-timeout": "180000",
      "parallel-syncs": "1"
    }
  ],
  "rtt": 45
}
```

**Error (500):** `{ "success": false, "host": "...", "port": 26379, "error": "Connection closed by server" }`

**Cloudflare-protected host (403):** `{ "success": false, "error": "Cannot connect to Cloudflare-protected hosts", "isCloudflare": true }`

**Notes:**
- `version` extracted from `INFO server` via `redis_version:` field (Sentinel runs on Redis core)
- `sentinelInfo` is the parsed `INFO sentinel` section
- `masters` is the result of `SENTINEL masters` — each master is a flat key-value array converted to an object
- All monitored masters are returned in a single call

---

### `POST /api/sentinel/query` — Arbitrary read-only command execution

Connects, optionally authenticates, sends one Sentinel command, returns raw and parsed RESP response, and closes. Only safe read-only commands are allowed (see [Safe Commands](#safe-commands)).

**POST body:**
```json
{
  "host": "sentinel.example.com",
  "port": 26379,
  "password": "secret",
  "command": "SENTINEL master",
  "masterName": "mymaster",
  "timeout": 10000
}
```

| Field        | Type    | Default | Notes |
|--------------|---------|---------|-------|
| `host`       | string  | —       | Required. Must match `[a-zA-Z0-9._:-]+` |
| `port`       | number  | `26379` | Range: 1-65535 |
| `password`   | string  | —       | Sent as `AUTH <password>` if provided |
| `command`    | string  | —       | Required. E.g. `"SENTINEL master"`, `"INFO"`, `"PING"` |
| `masterName` | string  | —       | Optional. Appended to command if provided. Must match `[a-zA-Z0-9_-]+` |
| `timeout`    | number  | `10000` | Total timeout in ms (max 30000) |

The `command` and `masterName` fields are split on whitespace and combined into a RESP array. For example:
- `command: "SENTINEL master", masterName: "mymaster"` → `["SENTINEL", "master", "mymaster"]`
- `command: "PING"` → `["PING"]`

**Success (200):**
```json
{
  "success": true,
  "host": "sentinel.example.com",
  "port": 26379,
  "command": "SENTINEL master mymaster",
  "masterName": "mymaster",
  "result": ["name", "mymaster", "ip", "127.0.0.1", "port", "6379", ...],
  "parsed": {
    "name": "mymaster",
    "ip": "127.0.0.1",
    "port": "6379",
    "flags": "master",
    "quorum": "2",
    "num-slaves": "2"
  },
  "transcript": [
    "Connected to sentinel.example.com:26379",
    "AUTH: OK",
    "> SENTINEL master mymaster",
    "< [\"name\",\"mymaster\",\"ip\",\"127.0.0.1\",...]"
  ],
  "rtt": 42
}
```

**Fields:**
- `result`: Raw parsed RESP response (array, string, integer, or `{ error: "..." }`)
- `parsed`: Structured version of `result` if it's a flat key-value array or array of arrays
- `transcript`: Array of strings showing connection flow and commands sent/received (useful for debugging)

**Error (400) — unsafe command:**
```json
{
  "success": false,
  "transcript": [],
  "error": "Command \"SENTINEL set\" is not allowed. Only read-only Sentinel commands are permitted."
}
```

---

### `POST /api/sentinel/get` — Get replicas and sentinels for a master

Specialized endpoint that queries `SENTINEL replicas <masterName>` and `SENTINEL sentinels <masterName>` in a single connection, returning structured replica and Sentinel peer info. Useful for assessing cluster health without needing to parse the full `SENTINEL masters` response.

**POST body:**
```json
{
  "host": "sentinel.example.com",
  "port": 26379,
  "masterName": "mymaster",
  "timeout": 10000
}
```

| Field        | Type    | Default | Notes |
|--------------|---------|---------|-------|
| `host`       | string  | —       | Required. Must match `[a-zA-Z0-9._:-]+` |
| `port`       | number  | `26379` | Range: 1-65535 |
| `masterName` | string  | —       | Required. Must match `[a-zA-Z0-9_-]+` |
| `timeout`    | number  | `10000` | Total timeout in ms (max 30000) |

**Success (200):**
```json
{
  "success": true,
  "host": "sentinel.example.com",
  "port": 26379,
  "masterName": "mymaster",
  "replicas": [
    {
      "ip": "10.0.1.2",
      "port": "6379",
      "flags": "slave",
      "lag": "12345",
      "linkStatus": "ok"
    },
    {
      "ip": "10.0.1.3",
      "port": "6379",
      "flags": "slave,s_down",
      "lag": "99999",
      "linkStatus": "err"
    }
  ],
  "sentinels": [
    {
      "ip": "10.0.2.1",
      "port": "26379",
      "flags": "sentinel"
    },
    {
      "ip": "10.0.2.2",
      "port": "26379",
      "flags": "sentinel"
    }
  ],
  "rtt": 38
}
```

**Replica fields:**
- `ip`: Replica IP address (from `ip` or `addr` field)
- `port`: Replica port
- `flags`: Comma-separated flags (e.g. `slave`, `s_down`, `o_down`, `disconnected`)
- `lag`: Replication lag offset (from `slave-repl-offset` or `lag` field)
- `linkStatus`: Master link status (from `master-link-status` field, typically `ok` or `err`)

**Sentinel fields:**
- `ip`: Sentinel IP address
- `port`: Sentinel port
- `flags`: Flags (typically `sentinel`)

**Error (400):** Invalid `masterName` format

**Error (500):** Sentinel not monitoring the named master (returns RESP error)

---

### `POST /api/sentinel/get-master-addr` — Resolve master address and check quorum

Resolves the current master address for a Sentinel-monitored group and verifies quorum health. Sends `SENTINEL get-master-addr-by-name <masterName>` and `SENTINEL ckquorum <masterName>` in a single connection.

**POST body:**
```json
{
  "host": "sentinel.example.com",
  "port": 26379,
  "masterName": "mymaster",
  "timeout": 10000
}
```

| Field        | Type    | Default | Notes |
|--------------|---------|---------|-------|
| `host`       | string  | —       | Required. Must match `[a-zA-Z0-9._:-]+` |
| `port`       | number  | `26379` | Range: 1-65535 |
| `masterName` | string  | —       | Required. Must match `[a-zA-Z0-9_-]+` |
| `timeout`    | number  | `10000` | Total timeout in ms (max 30000) |

**Success (200):**
```json
{
  "success": true,
  "host": "sentinel.example.com",
  "port": 26379,
  "masterName": "mymaster",
  "masterAddr": {
    "ip": "10.0.1.1",
    "port": "6379"
  },
  "quorumOk": true,
  "quorumMessage": "OK 3 usable Sentinels. Quorum and failover authorization can be reached",
  "rtt": 32
}
```

**Fields:**
- `masterAddr`: Current master IP and port (null if master not found or down)
- `quorumOk`: `true` if `SENTINEL ckquorum` returned `+OK`, `false` if error
- `quorumMessage`: Full `ckquorum` response string (e.g. `"OK 3 usable Sentinels..."` or error message)

**Use case:** Service discovery clients that need to know which Redis instance is currently the master and whether a failover would succeed.

**Error (500):** Master not found, or quorum check failed

---

### `POST /api/sentinel/failover` — Force a Sentinel failover

**⚠️ DESTRUCTIVE OPERATION**

Initiates a manual failover for the named master, even if the master is reachable. Sends `SENTINEL failover <masterName>`.

**POST body:**
```json
{
  "host": "sentinel.example.com",
  "port": 26379,
  "password": "secret",
  "masterName": "mymaster",
  "timeout": 15000
}
```

| Field        | Type    | Default | Notes |
|--------------|---------|---------|-------|
| `host`       | string  | —       | Required |
| `port`       | number  | `26379` | Range: 1-65535 |
| `password`   | string  | —       | Authenticate if required |
| `masterName` | string  | —       | Required. Must match `[a-zA-Z0-9_-]+` |
| `timeout`    | number  | `15000` | Total timeout in ms (max 30000) |

**Success (200):**
```json
{
  "success": true,
  "host": "sentinel.example.com",
  "port": 26379,
  "command": "SENTINEL failover mymaster",
  "masterName": "mymaster",
  "result": "OK",
  "rtt": 67
}
```

**Notes:**
- Failover is asynchronous. `+OK` response means "failover initiated", not "failover complete"
- Monitor `SENTINEL masters` or `INFO sentinel` to track failover progress
- Requires quorum agreement from other Sentinels

---

### `POST /api/sentinel/reset` — Reset Sentinel state for a master

**⚠️ DESTRUCTIVE OPERATION**

Resets the state of all masters matching the pattern (glob). Each Sentinel re-discovers replicas and other Sentinels from scratch. Sends `SENTINEL reset <pattern>`.

**POST body:**
```json
{
  "host": "sentinel.example.com",
  "port": 26379,
  "password": "secret",
  "masterName": "mymaster",
  "timeout": 10000
}
```

| Field        | Type    | Default | Notes |
|--------------|---------|---------|-------|
| `host`       | string  | —       | Required |
| `port`       | number  | `26379` | Range: 1-65535 |
| `password`   | string  | —       | Authenticate if required |
| `masterName` | string  | —       | Required. Pattern (e.g. `mymaster`, `*`, `prod-*`) |
| `timeout`    | number  | `10000` | Total timeout in ms (max 30000) |

**Success (200):**
```json
{
  "success": true,
  "host": "sentinel.example.com",
  "port": 26379,
  "command": "SENTINEL reset mymaster",
  "masterName": "mymaster",
  "result": 1,
  "rtt": 28
}
```

**Notes:**
- `result` is an integer — number of masters reset
- Pattern supports globs: `*`, `?`, `[abc]` (standard Redis glob syntax)

---

### `POST /api/sentinel/set` — Set configuration parameter on a master

**⚠️ CONFIGURATION CHANGE**

Sets a runtime configuration parameter on a Sentinel-monitored master. Sends `SENTINEL set <masterName> <key> <value>`.

**POST body:**
```json
{
  "host": "sentinel.example.com",
  "port": 26379,
  "password": "secret",
  "masterName": "mymaster",
  "key": "down-after-milliseconds",
  "value": "5000",
  "timeout": 10000
}
```

| Field        | Type    | Default | Notes |
|--------------|---------|---------|-------|
| `host`       | string  | —       | Required |
| `port`       | number  | `26379` | Range: 1-65535 |
| `password`   | string  | —       | Authenticate if required |
| `masterName` | string  | —       | Required. Must match `[a-zA-Z0-9_-]+` |
| `key`        | string  | —       | Required. Config key to set |
| `value`      | string  | —       | Required. Config value |
| `timeout`    | number  | `10000` | Total timeout in ms (max 30000) |

**Success (200):**
```json
{
  "success": true,
  "host": "sentinel.example.com",
  "port": 26379,
  "command": "SENTINEL set mymaster down-after-milliseconds 5000",
  "masterName": "mymaster",
  "result": "OK",
  "rtt": 22
}
```

**Common configuration keys:**
- `down-after-milliseconds`: How long master must be unreachable to be considered down
- `failover-timeout`: Max time for failover completion
- `parallel-syncs`: How many replicas can sync from new master simultaneously
- `quorum`: Number of Sentinels that must agree on master down state
- `notification-script`: Path to script called on events
- `client-reconfig-script`: Path to script called on master address change

**Notes:**
- Changes are runtime-only (not persisted to Sentinel config file unless `SENTINEL FLUSHCONFIG` called)
- Invalid keys return RESP error (status 500)

---

## RESP Wire Format

Sentinel uses the same RESP (Redis Serialization Protocol) as Redis. Commands are sent as RESP arrays of bulk strings:

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
| `:` | Integer | `:3\r\n` |
| `$` | Bulk string | `$5\r\nhello\r\n` |
| `$-1` | Null bulk string | `$-1\r\n` |
| `*` | Array | `*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n` |

RESP3 (`HELLO 3`) is not used.

---

## Safe Commands

The `/api/sentinel/query` endpoint enforces a whitelist of read-only commands:

```
ping
info
sentinel masters
sentinel master
sentinel replicas
sentinel slaves          ← alias for replicas
sentinel sentinels
sentinel get-master-addr-by-name
sentinel ckquorum
sentinel pending-scripts
sentinel myid
```

Write/destructive commands (`SENTINEL set`, `SENTINEL failover`, `SENTINEL reset`, `SENTINEL remove`, `SENTINEL monitor`, `SHUTDOWN`, `CONFIG SET`, etc.) are rejected with HTTP 400.

Use the dedicated write endpoints (`/api/sentinel/failover`, `/api/sentinel/reset`, `/api/sentinel/set`) for these operations.

---

## Sentinel Topology Example

Typical high-availability setup:

```
┌─────────────────┐
│   Application   │
│                 │
│  (connects via  │
│   service       │
│   discovery)    │
└────────┬────────┘
         │
         │ 1. Query SENTINEL get-master-addr-by-name
         │ 2. Connect to returned master IP:port
         │
    ┌────▼────┐
    │Sentinel │
    │ :26379  │
    └─────────┘
         │
         │ monitors
         │
    ┌────▼─────────────┬──────────┐
    │                  │          │
┌───▼────┐      ┌──────▼──┐  ┌───▼─────┐
│ Master │◄─────┤Replica 1│  │Replica 2│
│ :6379  │ repl │  :6379  │  │  :6379  │
└────────┘      └─────────┘  └─────────┘
```

**Failover flow:**
1. Master becomes unreachable
2. Sentinels detect down state (`down-after-milliseconds` threshold)
3. Quorum of Sentinels agree master is down (`SDOWN` → `ODOWN`)
4. Sentinel leader initiates failover
5. One replica promoted to master
6. Other replicas reconfigured to replicate from new master
7. Applications query `SENTINEL get-master-addr-by-name` and get new master address

---

## Known Limitations

**No connection pooling:** Each API call opens and closes a new TCP connection. For frequent queries, consider caching results or using a local Sentinel client library.

**No pub/sub monitoring:** Sentinel supports `PSUBSCRIBE +switch-master`, `+sdown`, etc. for real-time event monitoring. Port of Call endpoints are request/response only — no persistent connections for event streaming.

**No TLS:** Uses plain TCP (`connect()` only). Sentinel TLS (Redis 6+) is not supported. Use a TLS-terminating proxy (stunnel, HAProxy) if needed.

**Binary values:** `TextDecoder` used throughout. Binary Sentinel responses (if any) may be corrupted on decode.

**Multi-byte UTF-8 sequences:** Now properly finalized after all reads (decoder flushed with `stream: false`). Prior to bugfix, split multi-byte characters could corrupt output.

**Nested array parsing heuristic:** For `SENTINEL masters` responses (array of arrays), `readRESPFull` uses a conservative line-count heuristic to determine when the response is complete. For very large responses (hundreds of masters), this may wait longer than necessary. Works reliably for typical deployments (< 50 masters).

**Password in URL:** Query parameters appear in Cloudflare access logs. Use short-lived or read-only credentials.

**Empty password distinction:** Empty string (`""`) is now correctly treated as a password (sends `AUTH ""`). Prior to bugfix, empty strings were treated as "no password" due to falsy check.

**Timeout granularity:** Timeout is shared across entire request (connect + auth + all commands). For multi-command endpoints (`/api/sentinel/probe`, `/api/sentinel/get`), timeout applies to the cumulative duration, not per-command.

**No RESP type validation (fixed):** Prior to bugfix, `parseRESP` assumed first character was a valid type marker. Now validates against `[+\-:$*]` and throws on invalid input.

**Integer parsing (fixed):** Prior to bugfix, `parseInt()` results were not checked for `NaN`. Now validates all length/count fields and throws on malformed input.

**flatArrayToObject odd-length arrays:** Flat key-value arrays with odd element count silently drop the last element. Now logs a warning to console, but still returns the truncated object.

**Reader/writer lock leaks (fixed):** Prior to bugfix, `reader.releaseLock()` and `writer.releaseLock()` were only called in error paths via `socket.close()`. If `socket.close()` threw, locks remained held. Now wrapped in try-catch in `finally` blocks.

---

## Practical Examples

### curl

```bash
# Probe a Sentinel — list all monitored masters
curl -s https://portofcall.ross.gg/api/sentinel/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"sentinel.example.com","port":26379}' \
  | jq

# Get current master address
curl -s https://portofcall.ross.gg/api/sentinel/get-master-addr \
  -H 'Content-Type: application/json' \
  -d '{"host":"sentinel.example.com","masterName":"mymaster"}' \
  | jq '.masterAddr'

# Get replica health
curl -s https://portofcall.ross.gg/api/sentinel/get \
  -H 'Content-Type: application/json' \
  -d '{"host":"sentinel.example.com","masterName":"mymaster"}' \
  | jq '.replicas[] | select(.linkStatus == "err")'

# Query arbitrary Sentinel command
curl -s https://portofcall.ross.gg/api/sentinel/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"sentinel.example.com","command":"SENTINEL master","masterName":"mymaster"}' \
  | jq '.parsed.flags'

# Check quorum health
curl -s https://portofcall.ross.gg/api/sentinel/get-master-addr \
  -H 'Content-Type: application/json' \
  -d '{"host":"sentinel.example.com","masterName":"mymaster"}' \
  | jq '.quorumOk'

# Force failover (destructive!)
curl -s https://portofcall.ross.gg/api/sentinel/failover \
  -H 'Content-Type: application/json' \
  -d '{"host":"sentinel.example.com","masterName":"mymaster","password":"secret"}'

# Adjust down-after-milliseconds
curl -s https://portofcall.ross.gg/api/sentinel/set \
  -H 'Content-Type: application/json' \
  -d '{"host":"sentinel.example.com","masterName":"mymaster","key":"down-after-milliseconds","value":"5000","password":"secret"}'
```

### Service discovery pattern

```javascript
// Resolve current master for "mymaster" group
const response = await fetch('https://portofcall.ross.gg/api/sentinel/get-master-addr', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    host: 'sentinel.example.com',
    masterName: 'mymaster'
  })
});

const data = await response.json();

if (data.success && data.masterAddr) {
  const masterHost = data.masterAddr.ip;
  const masterPort = data.masterAddr.port;
  console.log(`Connecting to master: ${masterHost}:${masterPort}`);
  // Connect your Redis client to masterHost:masterPort
}
```

### Monitoring script

```bash
#!/bin/bash
# Check if any replicas have link errors

SENTINEL="sentinel.example.com"
MASTER="mymaster"

curl -s "https://portofcall.ross.gg/api/sentinel/get" \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"$SENTINEL\",\"masterName\":\"$MASTER\"}" \
  | jq -e '.replicas[] | select(.linkStatus == "err")' > /dev/null

if [ $? -eq 0 ]; then
  echo "⚠️  Replica link error detected!"
  exit 1
else
  echo "✅ All replicas healthy"
  exit 0
fi
```

---

## Power User Tips

### SENTINEL masters vs SENTINEL master

- `SENTINEL masters` (plural) — returns array of all monitored masters (each master is a flat key-value array)
- `SENTINEL master <name>` (singular) — returns info about one master (flat key-value array)

The `/api/sentinel/probe` endpoint calls `SENTINEL masters` to populate the `masters` array in the response.

### Flags field interpretation

Flags are comma-separated tokens indicating replica/master state:

| Flag | Meaning |
|------|---------|
| `master` | Instance is a master |
| `slave` | Instance is a replica |
| `sentinel` | Instance is a Sentinel |
| `s_down` | Subjectively down (this Sentinel thinks it's down) |
| `o_down` | Objectively down (quorum agrees it's down) |
| `disconnected` | Link to instance is down |
| `master_down` | Master is down (from replica perspective) |

For replicas, check `linkStatus == "ok"` and absence of `s_down`/`o_down` flags for health.

### Replication lag monitoring

The `lag` field in replica info is the `slave-repl-offset` value — number of bytes behind the master. Compare to master's `master_repl_offset` to compute actual lag:

```javascript
const masterInfo = await fetch('...', { body: JSON.stringify({ command: 'SENTINEL master', masterName: 'mymaster' }) });
const masterOffset = parseInt(masterInfo.parsed['master-repl-offset']);

const replicas = await fetch('...', { body: JSON.stringify({ host: '...', masterName: 'mymaster' }) });
replicas.replicas.forEach(r => {
  const lagBytes = masterOffset - parseInt(r.lag);
  console.log(`${r.ip}:${r.port} lag: ${lagBytes} bytes`);
});
```

### Quorum calculation

The `quorum` field is the number of Sentinels that must agree on `ODOWN` state before failover can proceed. Formula:

```
quorum = floor(num_sentinels / 2) + 1    # for majority quorum
```

Use `SENTINEL ckquorum <masterName>` to verify that quorum can be reached.

### Failover timeout

Default `failover-timeout` is 180000ms (3 minutes). If failover takes longer, it's aborted. Adjust with:

```bash
curl -s https://portofcall.ross.gg/api/sentinel/set \
  -H 'Content-Type: application/json' \
  -d '{"host":"sentinel.example.com","masterName":"mymaster","key":"failover-timeout","value":"300000"}'
```

### Sentinel myid

Each Sentinel has a unique 40-character hex ID. Query with:

```bash
curl -s https://portofcall.ross.gg/api/sentinel/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"sentinel.example.com","command":"SENTINEL myid"}' \
  | jq -r '.result'
```

### Pending scripts

Check for queued notification scripts:

```bash
curl -s https://portofcall.ross.gg/api/sentinel/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"sentinel.example.com","command":"SENTINEL pending-scripts"}' \
  | jq
```

---

## Resources

- [Redis Sentinel documentation](https://redis.io/docs/management/sentinel/)
- [RESP protocol spec](https://redis.io/docs/reference/protocol-spec/)
- [Sentinel command reference](https://redis.io/commands/?group=sentinel)
- [Sentinel API reference](https://redis.io/docs/management/sentinel/#sentinel-api)
- [Sentinel deployment guide](https://redis.io/docs/management/sentinel/#deploying-sentinel)

---

## Security Considerations

**No authentication by default:** Redis Sentinel does not require authentication by default. In production, configure `requirepass` in the Sentinel config file and use the `password` field in API calls.

**Write operations:** The `/api/sentinel/failover`, `/api/sentinel/reset`, and `/api/sentinel/set` endpoints perform destructive operations. Restrict access via application-level auth, firewall rules, or Cloudflare Access.

**Master name validation:** Master names are validated against `[a-zA-Z0-9_-]+` to prevent command injection. Do not bypass this validation.

**Cloudflare detection:** Hosts ending in `.workers.dev` or containing `cloudflare` are rejected to prevent recursive calls. This is a heuristic, not a security boundary.

**Timeout bounds:** Maximum timeout is capped at 30000ms (30 seconds) to prevent resource exhaustion.

---

## Bugs Fixed in This Review

1. **RESOURCE LEAK — Timeout handles never cleared**: `setTimeout()` in `readRESPFull` created handles but never called `clearTimeout()`. Now uses `timeoutHandle` variable and clears in `finally` block.

2. **RESOURCE LEAK — Reader/writer locks not released in error paths**: `reader.releaseLock()` and `writer.releaseLock()` only called via `socket.close()` in catch blocks. If `socket.close()` threw, locks remained held. Now wrapped in try-catch in `finally` blocks for all endpoints.

3. **SECURITY — No Cloudflare detection**: All endpoints now check for `.workers.dev` or `cloudflare` in hostname and return 403 with `isCloudflare: true`.

4. **DATA CORRUPTION — TextDecoder stream never finalized**: `decoder.decode(value, { stream: true })` never got final call with `stream: false`, corrupting multi-byte UTF-8 split across chunks. Now finalized after reads complete.

5. **PROTOCOL VIOLATION — Integer parsing without error handling**: `parseInt()` results not checked for `NaN`. Now validates all length/count fields in `parseRESP` and `readRESPFull`.

6. **PROTOCOL VIOLATION — No RESP type validation**: `parseRESP` assumed first character was valid type marker. Now validates against `[+\-:$*]` and throws on invalid input.

7. **BUG — Empty password treated as "no password"**: `if (password)` failed on empty string. Changed to `if (password !== undefined)` to allow empty string as valid password.

8. **BUG — Port validation after use in error responses**: Port assigned from `rawPort` before validation, so error responses used potentially invalid port. Reordered validation to occur before assignment where possible.

9. **SECURITY — No masterName validation**: `masterName` passed directly to RESP commands without validation. Now validates against `[a-zA-Z0-9_-]+` pattern.

10. **EDGE CASE — flatArrayToObject loses odd final element**: Loop `i < arr.length - 1` silently drops last element if array has odd length. Now logs warning to console.

11. **PROTOCOL VIOLATION — Array completion heuristic unreliable**: Nested array parsing used `buffer.length > 4096` early return regardless of completeness. Changed to more conservative line-count heuristic (`1 + count * 4` for nested arrays).

All fixes validated with TypeScript compilation.
