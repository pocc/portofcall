# Memcached — Implementation Reference

**Protocol:** Memcached text protocol (RFC-informal, [protocol.txt](https://github.com/memcached/memcached/blob/master/doc/protocol.txt))
**Implementation:** `src/worker/memcached.ts`
**Port:** 11211 (plaintext TCP, no TLS)
**Routes:**
- `POST /api/memcached/connect` — version probe
- `POST /api/memcached/command` — raw command dispatch
- `POST /api/memcached/gets` — multi-get with CAS tokens (structured)
- `POST /api/memcached/stats` — server statistics
- `GET /api/memcached/session` (WebSocket upgrade) — interactive session

---

## Connection Probe

### Request

```
POST /api/memcached/connect
Content-Type: application/json
```

```json
{ "host": "127.0.0.1", "port": 11211, "timeout": 10000 }
```

`port` defaults to `11211`. `timeout` (ms) defaults to `10000`.

### Response

```json
{
  "success": true,
  "message": "Memcached server reachable",
  "host": "127.0.0.1",
  "port": 11211,
  "version": "1.6.23"
}
```

The probe sends `version\r\n` and parses the `VERSION x.y.z` response. No auth is performed; if the server is protected by SASL, the probe still succeeds (SASL is only required for storage/retrieval commands on SASL-enabled servers).

---

## Command Endpoint

### Request

```
POST /api/memcached/command
Content-Type: application/json
```

```json
{ "host": "127.0.0.1", "port": 11211, "command": "get mykey", "timeout": 10000 }
```

The `command` string is the raw Memcached text protocol command, **without** the trailing `\r\n`.

### Storage commands (set / add / replace / append / prepend)

For storage commands, the worker calculates `<bytes>` automatically from the data — you do **not** include it:

```
set <key> <flags> <exptime> <value>
```

Example:
```json
{ "host": "cache.example.com", "command": "set session:abc 0 3600 {\"user\":42}" }
```

The worker rewrites this to the two-frame wire format:
```
set session:abc 0 3600 10\r\n
{"user":42}\r\n
```

Values containing spaces are fine — everything after `<exptime>` is joined and used as the data block.

### CAS (Check-And-Set)

CAS requires a unique token obtained from a prior `gets` response:

```
cas <key> <flags> <exptime> <cas_unique> <value>
```

Example:
```json
{ "host": "cache.example.com", "command": "cas session:abc 0 3600 12345678 {\"user\":42}" }
```

`cas_unique` is position 4 (0-indexed from key). Everything from position 5 onward is the data value.

**Common CAS responses:**
- `STORED` — written, CAS matched
- `EXISTS` — not written, another writer changed the key since your `gets`
- `NOT_FOUND` — key expired or was deleted between your `gets` and `cas`

### Retrieval and other commands

All non-storage commands are sent verbatim:

```json
{ "command": "get key1 key2 key3" }
{ "command": "gets key1" }
{ "command": "delete session:abc" }
{ "command": "incr counter 5" }
{ "command": "decr counter 1" }
{ "command": "touch key1 600" }
{ "command": "flush_all" }
{ "command": "flush_all 300" }
{ "command": "version" }
```

### Response

```json
{
  "success": true,
  "command": "get mykey",
  "response": "VALUE mykey 0 5\r\nhello\r\nEND"
}
```

`response` is the raw server reply with trailing whitespace trimmed. The `\r\n` characters are present in the string.

### Response termination conditions

The response reader terminates when the buffer ends with any of:
`STORED`, `NOT_STORED`, `EXISTS`, `NOT_FOUND`, `DELETED`, `TOUCHED`, `OK`, `END`, `ERROR`, `CLIENT_ERROR …`, `SERVER_ERROR …`, `VERSION …`, or matches `/^\d+\r\n$/` (incr/decr result).

Responses that do not match any of these (e.g., custom server error strings) will wait until `timeout` ms elapses. This is a known limitation.

---

## Gets — Multi-get with CAS Tokens

### Request

```
POST /api/memcached/gets
Content-Type: application/json
```

```json
{
  "host": "127.0.0.1",
  "port": 11211,
  "keys": ["session:abc", "session:def", "config:flags"],
  "timeout": 10000
}
```

Up to 100 keys per request.

### Response

```json
{
  "success": true,
  "host": "127.0.0.1",
  "port": 11211,
  "requested": 3,
  "found": 2,
  "missing": ["config:flags"],
  "items": [
    {
      "key": "session:abc",
      "flags": 0,
      "bytes": 10,
      "value": "{\"user\":42}",
      "cas": "12345678"
    },
    {
      "key": "session:def",
      "flags": 0,
      "bytes": 5,
      "value": "hello",
      "cas": "87654321"
    }
  ]
}
```

`missing` lists keys the server did not return (expired, evicted, or never set). `cas` is the unique token for use with the `cas` command — it reflects the current modification count for the key. Use it to implement optimistic locking:

```bash
# Read with CAS token
curl -s localhost:8787/api/memcached/gets \
  -d '{"host":"127.0.0.1","keys":["lock:resource"]}' | jq '.items[0].cas'

# Write only if unchanged
curl -s localhost:8787/api/memcached/command \
  -d '{"host":"127.0.0.1","command":"cas lock:resource 0 30 <cas> owner:worker-1"}'
```

`EXISTS` means another process modified the key between your `gets` and `cas` — re-read and retry.

---

## Stats

### Request

```
POST /api/memcached/stats
Content-Type: application/json
```

```json
{ "host": "127.0.0.1", "port": 11211, "subcommand": "items", "timeout": 10000 }
```

`subcommand` defaults to `""` (general stats). Allowed values:

| subcommand | What it returns |
|------------|----------------|
| *(omit)* | General server statistics: uptime, bytes used, hit/miss counters, connection counts, etc. |
| `items` | Per-slab-class item counts, ages, eviction counts. Use to identify which slab classes are under pressure. |
| `slabs` | Per-slab-class memory allocation: chunk size, pages, used chunks, free chunks, memory requested. |
| `sizes` | Item size histogram. Buckets in 32-byte increments. Temporarily disables the server while computing — avoid on production under load. |
| `conns` | Per-connection details: file descriptor, address, state, read/write buffers, pending events. |
| `reset` | Resets all `get_hits`, `get_misses`, `cmd_get`, `cmd_set` counters to 0. Returns `RESET\r\n`. Stats object will be empty. |

### Response

```json
{
  "success": true,
  "host": "127.0.0.1",
  "port": 11211,
  "subcommand": "general",
  "stats": {
    "pid": "1234",
    "uptime": "86400",
    "time": "1708123456",
    "version": "1.6.23",
    "curr_connections": "12",
    "total_connections": "4892",
    "cmd_get": "1048576",
    "cmd_set": "131072",
    "get_hits": "1040000",
    "get_misses": "8576",
    "bytes": "104857600",
    "limit_maxbytes": "536870912",
    "evictions": "0"
  },
  "raw": "STAT pid 1234\r\nSTAT uptime 86400\r\n..."
}
```

All stat values are returned as strings (Memcached's text protocol does not type them).

### Key stats for power users

| Stat | Formula | Meaning |
|------|---------|---------|
| Hit rate | `get_hits / (get_hits + get_misses)` | Cache effectiveness; < 95% warrants investigation |
| Fill ratio | `bytes / limit_maxbytes` | Memory pressure; > 90% causes evictions |
| Eviction rate | `evictions / uptime` | Evictions/second; non-zero means the cache is full |
| Connection pressure | `curr_connections / max_connections` | > 80% risks `SERVER_ERROR out of connections` |
| Slab inefficiency | `stats slabs` → `mem_requested / total_malloced` | Low ratio = wasted slab space; trigger `automove` or resize |

---

## WebSocket Session

### Connecting

```
GET /api/memcached/session?host=127.0.0.1&port=11211
Upgrade: websocket
```

Parameters: `host` (required), `port` (default 11211).

### Events

**Worker → Browser:**

| Event | Fields | When sent |
|-------|--------|-----------|
| `connected` | `version`, `host`, `port` | After the `version` probe succeeds |
| `response` | `response`, `command` | After each command completes |
| `error` | `message` | On socket error or invalid command format |

**Browser → Worker:**

```json
{ "type": "command", "command": "get session:abc" }
```

Storage commands use the same auto-byte-count format as the HTTP endpoint. CAS uses position 4 as the unique token.

### Session example

```javascript
const ws = new WebSocket('wss://portofcall.example/api/memcached/session?host=127.0.0.1');

ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  switch (msg.type) {
    case 'connected':
      console.log('Memcached', msg.version, 'at', msg.host);
      ws.send(JSON.stringify({ type: 'command', command: 'gets hot:counter' }));
      break;
    case 'response':
      // Parse VALUE blocks manually if needed
      const lines = msg.response.split('\r\n');
      console.log(lines);
      break;
    case 'error':
      console.error(msg.message);
      break;
  }
};
```

---

## Wire Format

### Text protocol framing

All commands end with `\r\n`. Storage commands have a two-frame structure:

```
<command_header>\r\n
<data_block>\r\n
```

### Storage command header

```
set <key> <flags> <exptime> <bytes> [noreply]\r\n
<data>\r\n
```

| Field | Notes |
|-------|-------|
| `flags` | Arbitrary 32-bit integer; Memcached stores and returns it unchanged. Clients use it to encode serialization format (e.g., 0=raw string, 1=JSON, 2=compressed). |
| `exptime` | Seconds until expiry. `0` = no expiry. Values ≥ 30 days (2592000 s) are interpreted as a Unix timestamp. |
| `bytes` | Exact byte count of the data block; auto-calculated by the worker. |
| `noreply` | If present, server sends no response. Not supported by the worker endpoints (the response reader would time out). |

### CAS command header

```
cas <key> <flags> <exptime> <cas_unique> <bytes> [noreply]\r\n
<data>\r\n
```

### Response reference

| Response | Command | Meaning |
|----------|---------|---------|
| `STORED` | set/add/replace/append/prepend/cas | Written successfully |
| `NOT_STORED` | add/replace | Key existed (add) or didn't exist (replace) |
| `EXISTS` | cas | Key was modified since your gets — retry |
| `NOT_FOUND` | cas/delete/incr/decr/touch | Key absent |
| `DELETED` | delete | Key removed |
| `TOUCHED` | touch | Expiry updated |
| `<number>` | incr/decr | New value after arithmetic |
| `END` | get/gets/stats | End of multi-line response |
| `OK` | flush_all/stats reset | Success |
| `VERSION x.y.z` | version | Server version string |
| `CLIENT_ERROR …` | any | Malformed command |
| `SERVER_ERROR …` | any | Server-side failure |
| `ERROR` | unknown command | Unrecognized command name |

---

## curl Quick Reference

```bash
BASE='https://portofcall.example.com'

# Probe
curl -s $BASE/api/memcached/connect -d '{"host":"127.0.0.1"}'

# Set a key (TTL 1 hour)
curl -s $BASE/api/memcached/command \
  -d '{"host":"127.0.0.1","command":"set mykey 0 3600 hello"}'

# Get a key
curl -s $BASE/api/memcached/command \
  -d '{"host":"127.0.0.1","command":"get mykey"}'

# Multi-get with CAS tokens (structured)
curl -s $BASE/api/memcached/gets \
  -d '{"host":"127.0.0.1","keys":["key1","key2","key3"]}' | jq .

# CAS update (use cas token from gets response)
curl -s $BASE/api/memcached/command \
  -d '{"host":"127.0.0.1","command":"cas mykey 0 3600 <cas_unique> new_value"}'

# Atomic counter
curl -s $BASE/api/memcached/command -d '{"host":"127.0.0.1","command":"set hits 0 0 0"}'
curl -s $BASE/api/memcached/command -d '{"host":"127.0.0.1","command":"incr hits 1"}'
curl -s $BASE/api/memcached/command -d '{"host":"127.0.0.1","command":"incr hits 1"}'

# Extend TTL without fetching value
curl -s $BASE/api/memcached/command \
  -d '{"host":"127.0.0.1","command":"touch session:abc 7200"}'

# Delete
curl -s $BASE/api/memcached/command -d '{"host":"127.0.0.1","command":"delete mykey"}'

# Flush all (immediate)
curl -s $BASE/api/memcached/command -d '{"host":"127.0.0.1","command":"flush_all"}'

# Flush all with 60s delay (drains gracefully)
curl -s $BASE/api/memcached/command -d '{"host":"127.0.0.1","command":"flush_all 60"}'

# General stats
curl -s $BASE/api/memcached/stats -d '{"host":"127.0.0.1"}' | jq .stats

# Per-slab stats (inspect which size classes are under memory pressure)
curl -s $BASE/api/memcached/stats -d '{"host":"127.0.0.1","subcommand":"slabs"}' | jq .

# Per-slab item counts (find cold or hot item size classes)
curl -s $BASE/api/memcached/stats -d '{"host":"127.0.0.1","subcommand":"items"}' | jq .

# Reset hit/miss counters
curl -s $BASE/api/memcached/stats -d '{"host":"127.0.0.1","subcommand":"reset"}'
```

---

## Local Testing

```bash
# Docker — Memcached with default 64 MB cache
docker run -d --name mc -p 11211:11211 memcached

# Verify
curl -s localhost:8787/api/memcached/connect -d '{"host":"localhost"}'

# Custom cache size (512 MB) and connection limit
docker run -d --name mc -p 11211:11211 memcached -m 512 -c 1024

# SASL-enabled Memcached (for testing auth; not supported by this implementation)
docker run -d --name mc-sasl -p 11211:11211 memcached -S
```

---

## Known Limitations

- **No SASL authentication** — `SASL LIST MECHS` / `SASL AUTH` handshake is not implemented. Servers configured with `-S` will reject all commands after the handshake step fails.
- **No binary protocol** — Only the text protocol is implemented. The Memcached binary protocol (magic byte `0x80`/`0x81`) is more efficient and required for SASL; not supported.
- **No TLS** — Port 11211 is plaintext. There is no `memcacheds` TLS equivalent in this implementation. Credentials (SASL, if it were supported) would travel in cleartext.
- **Single-read response** — `readMemcachedResponse` reads in a loop until a terminal pattern matches, but only within the scope of the pattern list. A server that returns an unrecognized response line will wait until timeout.
- **`stats sizes` is disruptive** — Running `stats sizes` takes a global lock on the Memcached server while it walks all items. Do not run it on production servers under sustained load; use `stats items` + `stats slabs` instead.
- **Binary values corrupted** — `TextDecoder` is used throughout. Values stored as binary (e.g., MessagePack, protobuf, compressed blobs) will be corrupted. Encode binary values as base64 before storing.
- **`noreply` will time out** — If you send a storage command with `noreply` via the `/command` endpoint, the response reader has no terminal pattern to match and will wait until `timeout` ms elapses.
- **`stats cachedump` not available via `/stats`** — `stats cachedump <slab_id> <limit>` takes additional arguments; use the `/command` endpoint: `{"command": "stats cachedump 3 100"}`.
