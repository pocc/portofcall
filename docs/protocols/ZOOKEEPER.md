# ZooKeeper — Port of Call Reference

**RFC / Spec:** [ZooKeeper Programmer's Guide](https://zookeeper.apache.org/doc/current/zookeeperProgrammers.html)
**Default port:** 2181
**Source:** `src/worker/zookeeper.ts`

---

## Overview

Port of Call implements two ZooKeeper transport layers on the same port (2181):

1. **Four-Letter Words (4LW)** — simple plaintext admin commands for health checking and monitoring
2. **Jute binary protocol** — full session-based read/write operations on the znode tree

Each HTTP request opens a new TCP connection, completes its operation, and closes. There is no
persistent session reuse across requests. The Jute endpoints establish a new ZooKeeper session
per call (sessionId=0 → server assigns).

---

## Endpoints

### `POST /api/zookeeper/connect` — Health probe

Sends `ruok` and `srvr` as two separate TCP connections. Returns a structured summary.

**Request:**
```json
{ "host": "zk.example.com", "port": 2181, "timeout": 10000 }
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | |
| `port` | `2181` | |
| `timeout` | `10000` | ms; applied independently to each TCP connection |

**Response:**
```json
{
  "success": true,
  "host": "zk.example.com",
  "port": 2181,
  "rtt": 18,
  "healthy": true,
  "ruokResponse": "imok",
  "serverInfo": {
    "version": "3.8.1-74db005175a4ec545697012f9069cb9e2047e56f, built on 2023-01-25 16:31 UTC",
    "mode": "standalone",
    "connections": "1",
    "outstanding": "0",
    "nodeCount": "5",
    "latencyMin": "0/0/0",
    "received": "2",
    "sent": "2"
  }
}
```

| Field | Notes |
|-------|-------|
| `healthy` | `true` only when `ruokResponse === "imok"` |
| `ruokResponse` | Raw response from `ruok` command — any value other than `"imok"` indicates unhealthy |
| `serverInfo.version` | From `srvr` — full version string including git hash and build date |
| `serverInfo.mode` | `standalone`, `leader`, `follower`, or `observer` |
| `serverInfo.connections` | Current live client connections |
| `serverInfo.outstanding` | Requests queued but not yet processed |
| `serverInfo.nodeCount` | Total znodes in the tree (includes `/zookeeper` internals) |
| `serverInfo.latencyMin` | `min/avg/max` latency in ms |
| `serverInfo.*` | Any field is `undefined` if `srvr` is disabled or returns no data |

`rtt` covers both TCP connections (ruok + srvr) combined. If `srvr` is disabled by the server
ACL (ZooKeeper 3.5+ requires `4lw.commands.whitelist`), `serverInfo` fields will all be
`undefined` but the call still succeeds if `ruok` responds.

**Cloudflare detection:** runs before connecting; returns HTTP 403 with `isCloudflare:true` if
the target IP resolves to Cloudflare.

---

### `POST /api/zookeeper/command` — Four-Letter Word

Sends any valid 4LW command and returns the raw text response plus structured parsing for
applicable commands.

**Request:**
```json
{
  "host": "zk.example.com",
  "port": 2181,
  "command": "mntr",
  "timeout": 10000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | |
| `command` | **required** | Must be one of the 11 valid commands below |
| `port` | `2181` | |
| `timeout` | `10000` | |

**Valid commands:**

| Command | Output format | `parsed` field | Description |
|---------|--------------|----------------|-------------|
| `ruok` | Plain text | — | Liveness check; returns `"imok"` or nothing |
| `srvr` | `Key: Value` lines | `key:value` map | Server stats summary |
| `stat` | `Key: Value` lines | — | Stats + connected client list |
| `conf` | `key=value` lines | `key:value` map | Runtime configuration |
| `envi` | `key=value` lines | `key:value` map | JVM + OS environment |
| `mntr` | `key\tvalue` lines | `key:value` map (tab-delimited) | Full metrics for monitoring |
| `cons` | Plain text | — | Per-client connection detail |
| `dump` | Plain text | — | Outstanding sessions and ephemeral nodes |
| `wchs` | Plain text | — | Watch summary |
| `dirs` | Plain text | — | Data and log directory sizes |
| `isro` | Plain text | — | `"rw"` or `"ro"` — read-write vs read-only mode |

Commands are validated against the whitelist before sending. An unrecognised command returns
HTTP 400 before any TCP connection is made.

**Response:**
```json
{
  "success": true,
  "host": "zk.example.com",
  "port": 2181,
  "command": "mntr",
  "rtt": 12,
  "response": "zk_version\t3.8.1-74db005175a4...\nzk_avg_latency\t0\n...",
  "parsed": {
    "zk_version": "3.8.1-74db005175a4ec545697012f9069cb9e2047e56f",
    "zk_avg_latency": "0",
    "zk_max_latency": "0",
    "zk_outstanding_requests": "0",
    "zk_server_state": "leader",
    "zk_znode_count": "147",
    "zk_watch_count": "23",
    "zk_ephemerals_count": "8",
    "zk_approximate_data_size": "3721",
    "zk_open_file_descriptor_count": "42",
    "zk_followers": "2",
    "zk_synced_followers": "2"
  }
}
```

| Field | Notes |
|-------|-------|
| `response` | Raw text exactly as returned by ZooKeeper; server closes connection after sending |
| `parsed` | Structured key→value map; only present for `srvr`, `conf`, `envi`, `mntr` |

**Parsing rules:**
- `srvr`, `conf`, `envi`: parsed by splitting on first `:` per line
- `mntr`: parsed by splitting on first `\t` (tab) per line
- `stat`, `cons`, `dump`, `wchs`, `dirs`, `ruok`, `isro`: `parsed` is `undefined`

Response cap: 64 KB. Responses larger than 64 KB are silently truncated (rare in practice).

**No Cloudflare detection** on this endpoint — detection is only in the Jute binary endpoints
and `/connect`.

---

### `POST /api/zookeeper/get` — Read a znode (Jute binary)

Establishes a ZooKeeper session and executes a `getData` request (opcode 4). Returns the
node's data and stat metadata.

**Request:**
```json
{
  "host": "zk.example.com",
  "port": 2181,
  "path": "/myapp/config",
  "watch": false,
  "timeout": 10000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | |
| `path` | `"/"` | Absolute znode path |
| `watch` | `false` | Set watcher on the node (has no effect since connection closes immediately after) |
| `port` | `2181` | |
| `timeout` | `10000` | |

**Wire sequence:**
```
TCP connect
→ ConnectRequest (40 bytes, protocolVersion=0, timeOut=30000, sessionId=0, passwd=16×\0)
← ConnectResponse (protocolVersion + negotiatedTimeout + sessionId + passwd)
→ Request (xid=1, type=4/GET_DATA, path + watch byte)
← Response (xid + zxid + err + data_len + data_bytes + stat[80])
TCP close
```

**Response (node exists):**
```json
{
  "success": true,
  "host": "zk.example.com",
  "port": 2181,
  "path": "/myapp/config",
  "data": "jdbc:mysql://db.internal:3306/mydb",
  "version": 3,
  "dataLength": 34,
  "numChildren": 0,
  "czxid": "0x00000001000000a3",
  "mzxid": "0x0000000100000212",
  "ctime": 1700000000000,
  "mtime": 1700001234567,
  "rtt": 22
}
```

**Response (node does not exist — ZNONODE error -101):**
```json
{
  "success": true,
  "exists": false,
  "path": "/myapp/config"
}
```

Note: ZNONODE is treated as a successful non-error response (`success:true, exists:false`).
All other ZK errors return `success:false` with an `error` string from the error code table.

| Field | Notes |
|-------|-------|
| `data` | Node data decoded as UTF-8. If bytes are not valid UTF-8, falls back to base64 string |
| `version` | Data version; incremented on every `setData` |
| `dataLength` | Raw byte length from the Jute response (before UTF-8 decode). `-1` means null data |
| `numChildren` | Number of child znodes |
| `czxid` | Create ZooKeeper Transaction ID, as 16-character hex string |
| `mzxid` | Last-modified ZXID |
| `ctime` | Creation time in ms since epoch (JavaScript `Date`-compatible) |
| `mtime` | Last modification time in ms since epoch |

**Stat structure detail** — the 80-byte stat block contains:

```
czxid(8) mzxid(8) ctime(8) mtime(8) version(4) cversion(4) aversion(4)
ephemeralOwner(8) dataLength(4) numChildren(4) pzxid(8)
```

Fields parsed: `czxid`, `mzxid`, `ctime`, `mtime`, `version`, `numChildren`.
Not exposed: `cversion` (child version), `aversion` (ACL version), `ephemeralOwner`, `pzxid`.

---

### `POST /api/zookeeper/set` — Write a znode (Jute binary)

Establishes a ZooKeeper session and executes a `setData` request (opcode 5).

**Request:**
```json
{
  "host": "zk.example.com",
  "port": 2181,
  "path": "/myapp/config",
  "data": "jdbc:mysql://db.internal:3306/newdb",
  "version": 3,
  "timeout": 10000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | |
| `path` | **required** | Absolute znode path |
| `data` | **required** | String data to write (UTF-8 encoded) |
| `version` | `-1` | Expected current version; `-1` = unconditional write (skip version check) |
| `port` | `2181` | |
| `timeout` | `10000` | |

**Wire sequence:**
```
ConnectRequest → ConnectResponse
→ Request (xid=2, type=5/SET_DATA, path + data_bytes + version)
← Response (xid + zxid + err + stat[80])
```

**Response (success):**
```json
{
  "success": true,
  "host": "zk.example.com",
  "port": 2181,
  "path": "/myapp/config",
  "version": 4,
  "rtt": 19
}
```

| Field | Notes |
|-------|-------|
| `version` | New data version after the write (previous version + 1) |

**Version conflict (ZBADVERSION -103):**
```json
{
  "success": false,
  "error": "ZBADVERSION: Version conflict",
  "path": "/myapp/config"
}
```

Use `version:-1` to force-overwrite without checking. Provide the exact current version (from a
prior `/get`) for optimistic concurrency control. The version in the request must match the
server's current `version`; if another client wrote between your read and write, the server
increments the version and your write fails with ZBADVERSION.

---

### `POST /api/zookeeper/create` — Create a znode (Jute binary)

Establishes a ZooKeeper session and executes a `create` request (opcode 1).

**Request:**
```json
{
  "host": "zk.example.com",
  "port": 2181,
  "path": "/myapp/lock/candidate-001",
  "data": "node42",
  "flags": 1,
  "timeout": 10000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | |
| `path` | **required** | Absolute path for the new znode |
| `data` | `""` | Initial string data (UTF-8 encoded) |
| `flags` | `0` | Node type — see table below |
| `port` | `2181` | |
| `timeout` | `10000` | |

**`flags` values:**

| Value | Type | Description |
|-------|------|-------------|
| `0` | Persistent | Node survives client disconnect (default) |
| `1` | Ephemeral | Deleted when creating client session ends — but since each request opens a new session, ephemeral nodes are deleted almost immediately after creation |
| `2` | Persistent Sequential | Path gets a 10-digit monotonic suffix (e.g. `/lock/candidate0000000042`) |
| `3` | Ephemeral Sequential | Ephemeral + sequential — useful for temporary numbered entries |

**ACL:** All created nodes use `world:anyone` with full permissions (CREATE + DELETE + READ +
WRITE + ADMIN = 31). There is no way to specify custom ACLs through this endpoint.

**Wire sequence:**
```
ConnectRequest → ConnectResponse
→ Request (xid=3, type=1/CREATE, path + data + acl[world:anyone, perms=31] + flags)
← Response (xid + zxid + err + created-path-string)
```

**Response (success):**
```json
{
  "success": true,
  "host": "zk.example.com",
  "port": 2181,
  "path": "/myapp/lock/candidate-001",
  "createdPath": "/myapp/lock/candidate-001",
  "rtt": 24
}
```

For sequential nodes, `createdPath` will differ from `path` — it contains the server-assigned
numeric suffix. Always use `createdPath` to reference the node you just created.

**Node already exists (ZNODEEXISTS -110):**
```json
{
  "success": false,
  "error": "Node already exists",
  "path": "/myapp/lock/candidate-001"
}
```

---

## Jute Binary Protocol Details

### Session handshake (all binary endpoints)

The connect packet (40 bytes, sent with a 4-byte big-endian length prefix):

```
protocolVersion (int32 BE) = 0
lastZxidSeen    (int64 BE) = 0
timeOut         (int32 BE) = 30000   ← hardcoded; server may negotiate lower
sessionId       (int64 BE) = 0       ← 0 = new session
passwd_len      (int32 BE) = 16
passwd          (16 bytes) = 0x00×16
```

The connect response (also length-prefixed) contains the server-assigned `sessionId` (8 bytes
at offset 8) and `negotiatedTimeout` (int32 at offset 4). The sessionId is read but not
reused across requests.

### Request frame

```
[4-byte total length (BE)] [xid (4 BE)] [opcode (4 BE)] [payload...]
```

XIDs are hardcoded per endpoint: GET_DATA=1, SET_DATA=2, CREATE=3.

### Response frame

```
[4-byte total length (BE)] [xid (4 BE)] [zxid (8 BE)] [err (4 BE)] [payload...]
```

Response payload starts at byte 16 (after 4+8+4 header). Error code 0 = OK; see error table
below.

### Jute string encoding

All strings (paths, data keys) use Jute encoding: `int32 BE length` + UTF-8 bytes. A length
of -1 means null (decoded as empty string). This is distinct from the 2-byte short strings in
Cassandra or MQTT.

### Frame reader: `zkReadPacket`

The reader accumulates TCP chunks until it has received `4 + frameLen` bytes. Unlike a simple
single-read, it handles TCP fragmentation correctly. It races against a per-call timeout
promise — if no data arrives within `timeout` ms, throws `"ZooKeeper read timeout"`.

---

## Error Codes

| Code | Name | Meaning |
|------|------|---------|
| `0` | OK | Success |
| `-101` | ZNONODE | Node does not exist |
| `-102` | ZNOAUTH | Not authenticated |
| `-103` | ZBADVERSION | Version mismatch in setData |
| `-108` | ZNOCHILDRENFOREPHEMERALS | Ephemeral nodes cannot have children |
| `-110` | ZNODEEXISTS | Node already exists |
| `-111` | ZNOTEMPTY | Cannot delete a node that has children |
| `-112` | ZSESSIONEXPIRED | Session timed out (shouldn't occur here — new session per request) |
| `-113` | ZINVALIDCALLBACK | Invalid callback specification |
| `-114` | ZINVALIDACL | Invalid ACL |
| `-115` | ZAUTHFAILED | Authentication failed |
| `-116` | ZCLOSING | Server is shutting down |
| `-117` | ZNOTHING | No server responses to process |
| `-118` | ZSESSIONMOVED | Session moved to another ensemble member |

Errors appear in the response as `"error": "<NAME>: <description>"` (e.g.,
`"ZBADVERSION: Version conflict"`). Unknown error codes appear as
`"ZooKeeper error code: <N>"`.

---

## Four-Letter Word Reference

ZooKeeper 3.5+ requires 4LW commands to be whitelisted:

```
# zoo.cfg
4lw.commands.whitelist=ruok,srvr,stat,conf,envi,mntr,cons,dump,wchs,dirs,isro
# or allow all:
4lw.commands.whitelist=*
```

If a command is not whitelisted, the server returns `"<cmd> is not executed because it is not
in the whitelist."` — this is returned in `response` with `success:true`.

### `mntr` key reference (commonly monitored fields)

| Key | Meaning |
|-----|---------|
| `zk_version` | Full version string |
| `zk_avg_latency` / `zk_max_latency` | Request latency in ms |
| `zk_outstanding_requests` | Queued but unprocessed requests |
| `zk_server_state` | `leader` / `follower` / `observer` / `standalone` |
| `zk_znode_count` | Total znodes |
| `zk_watch_count` | Active client watches |
| `zk_ephemerals_count` | Ephemeral znodes |
| `zk_approximate_data_size` | Total data size in bytes (approximate) |
| `zk_open_file_descriptor_count` | OS FDs open |
| `zk_followers` | Number of followers (leader only) |
| `zk_synced_followers` | Followers fully caught up (leader only) |
| `zk_pending_syncs` | Followers not yet synced (leader only) |

---

## Patterns and Gotchas

**Ephemeral nodes are immediately deleted.** Since each `/create` call opens a new session and
closes the connection, ephemeral nodes (flags=1 or 3) are created and then deleted within
milliseconds as the session expires. Use persistent nodes (flags=0 or 2) for durable storage.

**Sequential nodes return a different path.** With flags=2 or 3, ZooKeeper appends a
10-digit zero-padded monotonic counter to the path. Always check `createdPath` in the response,
not the input `path`.

**Version check in setData.** The default `version:-1` bypasses optimistic locking. To use
optimistic concurrency: read the node with `/get` (note `version`), then write with that
`version`. If the write fails with ZBADVERSION, another client modified the node between your
read and write.

**Session timeout is 30 seconds (hardcoded).** The ConnectRequest sends `timeOut=30000` ms.
The server may negotiate a lower value. Because each request opens a new session, this value
only affects how long the server waits before cleaning up the connection if it goes silent.

**`/zookeeper` internal nodes.** `nodeCount` from `srvr` includes the `/zookeeper/quota` and
`/zookeeper/config` internal nodes. A fresh cluster shows count=5 (/, /zookeeper,
/zookeeper/quota, /zookeeper/config, /zookeeper/config/version).

**Non-UTF-8 data.** `/get` first tries `new TextDecoder('utf-8', { fatal: true })`. If decoding
fails (binary data), it falls back to base64 via `btoa(String.fromCharCode(...bytes))`. Check
`dataLength` to distinguish empty string (`dataLength=0`) from null data (`dataLength=-1`).

---

## curl Quick Reference

```bash
BASE="https://portofcall.ross.gg"
ZK="zk.example.com"

# Health check
curl -s -X POST $BASE/api/zookeeper/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"'$ZK'"}' | jq '{healthy,ruokResponse,"mode":.serverInfo.mode,"version":.serverInfo.version}'

# Server mode (standalone / leader / follower)
curl -s -X POST $BASE/api/zookeeper/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"'$ZK'","command":"srvr"}' | jq '.parsed.Mode'

# Full monitoring metrics
curl -s -X POST $BASE/api/zookeeper/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"'$ZK'","command":"mntr"}' | jq '.parsed | {state:.zk_server_state, znodes:.zk_znode_count, watches:.zk_watch_count}'

# Check if read-only mode
curl -s -X POST $BASE/api/zookeeper/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"'$ZK'","command":"isro"}' | jq '.response'

# Read a znode
curl -s -X POST $BASE/api/zookeeper/get \
  -H 'Content-Type: application/json' \
  -d '{"host":"'$ZK'","path":"/myapp/config"}' | jq '{data,version,numChildren,exists}'

# Write a znode (unconditional)
curl -s -X POST $BASE/api/zookeeper/set \
  -H 'Content-Type: application/json' \
  -d '{"host":"'$ZK'","path":"/myapp/config","data":"new-value","version":-1}' | jq '{success,version}'

# Create a persistent node
curl -s -X POST $BASE/api/zookeeper/create \
  -H 'Content-Type: application/json' \
  -d '{"host":"'$ZK'","path":"/myapp/locks/primary","data":"owner-42","flags":0}' | jq '{success,createdPath}'

# Create a sequential node (distributed election candidate)
curl -s -X POST $BASE/api/zookeeper/create \
  -H 'Content-Type: application/json' \
  -d '{"host":"'$ZK'","path":"/election/candidate","data":"node-7","flags":2}' | jq '.createdPath'
```

---

## Local Test Server

```bash
# Single-node ZooKeeper (no auth)
docker run -d -p 2181:2181 --name zookeeper zookeeper:3.8

# Verify it's up
echo ruok | nc localhost 2181

# With all 4LW commands enabled
docker run -d -p 2181:2181 \
  -e ZOO_CFG_EXTRA="4lw.commands.whitelist=*" \
  --name zookeeper zookeeper:3.8
```

---

## What Is NOT Implemented

| Feature | Notes |
|---------|-------|
| Auth/ACL enforcement | All znodes created with `world:anyone` (full perms); auth schemes (digest, ip, sasl) not supported |
| getChildren | Listing child znodes not implemented |
| delete | Deleting znodes not implemented |
| exists | Checking node existence without fetching data — use `/get` and check `exists:false` |
| Multi/batch | Atomic multi-op transactions not supported |
| Watches | `watch:true` has no effect — connection closes before any watch event arrives |
| Session resumption | Each request creates a new session (sessionId=0); ephemeral nodes vanish immediately |
| TLS (port 2281) | Encrypted ZooKeeper client port not supported |
| SASL authentication | No Kerberos or DIGEST-MD5 |
| ZooKeeper 3.4 | Tested against 3.6+; older servers may differ in stat struct layout |
