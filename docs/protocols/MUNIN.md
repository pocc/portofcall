# Munin Node Protocol — Power-User Reference

**Port:** 4949 (munin-node)
**Source:** `src/worker/munin.ts`
**Routes:** `src/worker/index.ts` (2 endpoints)
**Spec:** Munin node text protocol (unofficial, reverse-engineered from munin-node implementations)

This implementation covers the Munin monitoring system's text-based node protocol: banner exchange, capability negotiation, plugin listing, plugin configuration retrieval, and metric fetching. Think of it as the "agent" side of Munin — the part that exposes system metrics to a central Munin master server. The protocol is line-oriented, with multi-line responses terminated by a single dot (`.`) on its own line.

---

## Endpoints

### 1. `POST /api/munin/connect`

Full node discovery — banner, version, capabilities, virtual nodes, and plugin list. Equivalent to the sequence a Munin master performs on first contact.

**Request:**
```json
{ "host": "monitoring.example.com", "port": 4949, "timeout": 10000 }
```

| Field | Type | Default | Required | Notes |
|-------|------|---------|----------|-------|
| `host` | string | — | yes | Hostname or IP |
| `port` | number | 4949 | no | Validated 1–65535 |
| `timeout` | number | 10000 | no | ms; applies to entire operation |

**Response (200):**
```json
{
  "success": true,
  "host": "monitoring.example.com",
  "port": 4949,
  "connectTime": 45,
  "banner": "# munin node at monitoring.example.com",
  "nodeName": "monitoring.example.com",
  "version": "munin node on monitoring.example.com version: 2.0.75",
  "capabilities": ["multigraph", "dirtyconfig"],
  "nodes": [],
  "pluginCount": 12,
  "plugins": ["cpu", "memory", "disk_usage", "network_eth0", "..."]
}
```

**Wire exchange:**
```
Server → Client: # munin node at monitoring.example.com\n
Client → Server: version\n
Server → Client: munin node on monitoring.example.com version: 2.0.75\n
Client → Server: cap multigraph\n
Server → Client: cap multigraph dirtyconfig\n
Client → Server: nodes\n
Server → Client: .\n                          (empty = no virtual nodes)
Client → Server: list\n
Server → Client: cpu memory disk_usage network_eth0 ...\n
Client → Server: quit\n
```

**Cloudflare detection:** Yes (returns 403 with `isCloudflare: true`).

**Conditional response fields:**
- `nodeName` — extracted from banner via regex `/# munin node at (.+)/`; falls back to full banner if no match
- `nodes` — array of virtual node names, empty if server has no virtual nodes
- `capabilities` — array of capability tokens from `cap` response (stripped of leading `cap `)

**curl:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/munin/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"munin-node.example.com"}' | jq .
```

---

### 2. `POST /api/munin/fetch`

Fetch current metric values from a specific plugin. Equivalent to a Munin master's data collection cycle for one plugin.

**Request:**
```json
{
  "host": "monitoring.example.com",
  "port": 4949,
  "plugin": "cpu",
  "timeout": 10000
}
```

| Field | Type | Default | Required | Notes |
|-------|------|---------|----------|-------|
| `host` | string | — | yes | |
| `port` | number | 4949 | no | Validated 1–65535 |
| `plugin` | string | — | yes | Plugin name (alphanumeric, dots, underscores, hyphens only) |
| `timeout` | number | 10000 | no | ms; applies to entire operation |

**Response (200, success):**
```json
{
  "success": true,
  "message": "Fetched 8 value(s) from cpu",
  "host": "monitoring.example.com",
  "port": 4949,
  "plugin": "cpu",
  "rtt": 38,
  "connectTime": 12,
  "valueCount": 8,
  "values": [
    { "field": "user", "value": "12345" },
    { "field": "system", "value": "5678" },
    { "field": "idle", "value": "98765" }
  ],
  "raw": "user.value 12345\nsystem.value 5678\nidle.value 98765\n."
}
```

**Response (200, plugin error):**
```json
{
  "success": false,
  "message": "Plugin error: # Unknown service",
  "host": "monitoring.example.com",
  "port": 4949,
  "plugin": "nonexistent",
  "rtt": 22,
  "connectTime": 11,
  "valueCount": 0,
  "values": [],
  "raw": "# Unknown service\n."
}
```

**Wire exchange:**
```
Server → Client: # munin node at monitoring.example.com\n
Client → Server: fetch cpu\n
Server → Client: user.value 12345\n
Server → Client: system.value 5678\n
Server → Client: idle.value 98765\n
Server → Client: .\n
Client → Server: quit\n
```

**Plugin name validation:** Regex `/^[a-zA-Z0-9._-]+$/` — alphanumeric, dots, underscores, hyphens only. Rejects plugin names containing spaces, slashes, or special characters (protects against command injection).

**Error detection:** Lines starting with `# Unknown`, `# Bad`, `# Error`, `# Timeout`, or `# Not` are treated as plugin errors. `success` is `false` and the error line is returned in `message`.

**Conditional response fields:**
- `values` — empty array when plugin returns an error or no data
- `raw` — always present, contains full response including dot terminator

**Cloudflare detection:** Yes (returns 403 with `isCloudflare: true`).

**curl:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/munin/fetch \
  -H 'Content-Type: application/json' \
  -d '{"host":"munin-node.example.com","plugin":"cpu"}' | jq .
```

---

## Cross-Endpoint Comparison

| Aspect | `/connect` | `/fetch` |
|--------|-----------|----------|
| Purpose | Discover node + list plugins | Get plugin values |
| CF detection | Yes | Yes |
| Port validation | 1–65535 | 1–65535 |
| Commands sent | `version`, `cap multigraph`, `nodes`, `list`, `quit` | `fetch <plugin>`, `quit` |
| Banner read | Yes (single-line) | Yes (single-line, discarded) |
| Multi-line responses | `nodes` (dot-terminated) | `fetch` (dot-terminated) |
| Single-line responses | `version`, `cap`, `list` | None |
| HTTP status on error | 400 (missing host), 403 (CF), 500 (other) | 400 (missing/invalid), 403 (CF), 500 (other) |
| `success` meaning | Connection worked | Plugin data retrieved (no error lines) |

---

## Protocol Commands Reference

| Command | Response Type | Terminator | Description |
|---------|--------------|------------|-------------|
| (none — banner) | Single line | `\n` | Server sends on connect: `# munin node at <hostname>` |
| `version` | Single line | `\n` | Returns node version string |
| `cap <capabilities>` | Single line | `\n` | Negotiate capabilities; server echoes supported caps |
| `nodes` | Multi-line | `.\n` | List virtual node names (one per line); empty = no virtual nodes |
| `list [node]` | Single line | `\n` | Space-separated plugin names; optional node argument for virtual nodes |
| `config <plugin>` | Multi-line | `.\n` | Plugin configuration / graph metadata (not implemented in Port of Call) |
| `fetch <plugin>` | Multi-line | `.\n` | Current metric values in `field.value VALUE` format |
| `quit` | None | — | Close connection gracefully |

---

## Munin Response Formats

### Banner (auto-sent on connect)
```
# munin node at hostname.example.com
```

### Version
```
munin node on hostname.example.com version: 2.0.75
```

### Capabilities
Request: `cap multigraph`
Response: `cap multigraph dirtyconfig` (server echoes supported caps from request + adds its own)

Common capabilities:
- `multigraph` — plugin can return multiple graphs in one fetch
- `dirtyconfig` — plugin can output config and fetch data in one call
- `spoolfetch` — node supports asynchronous data collection

### Nodes (virtual nodes)
```
node1.example.com
node2.example.com
.
```

Empty response (no virtual nodes):
```
.
```

### List (plugins)
```
cpu memory disk_usage network_eth0 load processes
```

### Fetch (metric values)
```
user.value 12345
nice.value 0
system.value 5678
idle.value 98765
iowait.value 234
irq.value 12
softirq.value 89
.
```

### Fetch (plugin error)
```
# Unknown service
.
```

Common error prefixes:
- `# Unknown service` — plugin does not exist
- `# Bad exit` — plugin script returned non-zero exit code
- `# Error` — generic plugin error
- `# Timeout` — plugin execution timed out
- `# Not allowed` — access denied (e.g., firewall rule)

---

## Dot Terminator Parsing

Multi-line responses (`nodes`, `config`, `fetch`) are terminated by a line containing only `.` (dot). The implementation detects these patterns:

| Pattern | Meaning | Example |
|---------|---------|---------|
| `\n.\n` | Dot line in middle of response | `data\n.\nmore` (invalid, breaks on first) |
| `\n.\r\n` | Dot line with CRLF | `data\n.\r\n` |
| `\n.` | Dot at end, no trailing newline yet | `data\n.` (incomplete read) |
| `\r\n.` | Dot after CRLF, no trailing newline | `data\r\n.` |
| `.\n` | Entire response is just terminator | `.\n` (empty result) |
| `.\r\n` | Terminator with CRLF | `.\r\n` |

The reader accumulates data until one of these patterns appears, then returns the full buffer (including the terminator). The caller is responsible for stripping the final `.\n` or `.\r\n` if needed.

**Known limitation:** The pattern `buffer.endsWith('\r\n.')` does not detect a dot that arrives in a separate TCP segment after `\r\n`. This is extremely rare in practice (Munin nodes buffer responses before sending), but could cause a timeout on pathological network conditions.

---

## Quirks and Known Limitations

### 1. No `config` endpoint
Port of Call does not implement a `/munin/config` endpoint. To retrieve plugin metadata (graph title, field labels, thresholds, etc.), you must implement your own handler or use the native `munin-run` tool on the target host.

### 2. Plugin name validation is strict
`/fetch` rejects plugin names containing anything other than `[a-zA-Z0-9._-]`. This blocks legitimate plugins with unconventional names (e.g., `if_eth0:0` for aliased interfaces) but prevents command injection attacks. The regex matches standard Munin plugin naming conventions.

### 3. `cap` always requests `multigraph`
The `cap` command in `/connect` is hardcoded to `cap multigraph`. The server may support other capabilities (e.g., `dirtyconfig`, `spoolfetch`) and will return them in the response, but the client does not request them explicitly. This is fine for discovery but limits negotiation flexibility.

### 4. No virtual node support in `/fetch`
The `fetch` command does not accept a node argument. To query a virtual node's plugin, you must connect directly to that virtual node's munin-node instance (different port or host).

### 5. Timeout architecture
```
/connect:
  └─ outer: configurable (default 10 s)
     ├─ banner: 3 s
     ├─ version: 3 s
     ├─ cap: 3 s
     ├─ nodes: 3 s
     └─ list: 3 s

/fetch:
  └─ outer: configurable (default 10 s)
     ├─ banner: 3 s
     └─ fetch: 3 s
```

Each individual command has a 3-second timeout. If a slow server takes 2.9 s per command, `/connect` could take up to 14.5 s (5 commands × 2.9 s) and exceed the default 10 s outer timeout. The outer timeout fires first, returning a 500 error.

Inner timeouts are **not configurable** — they are hardcoded to 3 s in each `sendCommand()` call and `readBanner()` call.

### 6. `list` response parsing
The `list` command returns a space-separated list of plugin names on a single line. The implementation:
1. Strips leading `list: ` if present (some munin-node versions echo the command)
2. Splits on whitespace (`/\s+/`)
3. Filters out empty strings

This works for standard plugin names but fails on plugins with spaces in their names (non-standard, but theoretically possible if a plugin author is masochistic).

### 7. Writer flush on `quit`
After sending `quit\n`, the implementation calls `writer.close()` to flush the socket before releasing locks and closing. This ensures the quit command actually reaches the server instead of being lost in a buffer when the socket closes.

Previous behavior (pre-fix): `writer.write('quit\n')` immediately followed by `socket.close()` could drop the quit command if the write buffer hadn't flushed.

### 8. Resource leak fixes (Feb 2026)
Three timeout-related resource leaks were fixed:
- `readMuninResponse()` — `setTimeout()` IDs are now tracked and cleared when the read completes early
- `/connect` outer timeout — cleared on successful completion
- `/fetch` outer timeout — cleared on successful completion

Before these fixes, every successful connection leaked one `setTimeout` handle per command (5 per `/connect`, 2 per `/fetch`). Cloudflare Workers have a limit on active timers; high-volume usage could exhaust this limit.

### 9. Lock release error handling
The `catch` blocks in both handlers now wrap `reader.releaseLock()`, `writer.releaseLock()`, and `socket.close()` in individual `try/catch` blocks. This prevents "Cannot release lock: already released" errors from propagating and masking the original error.

Previous behavior: If an error occurred after the happy path released locks (e.g., during JSON serialization), the catch block would throw a lock-release error instead of reporting the original error.

### 10. No authentication support
Munin-node can be configured to require authentication (e.g., via `allow` / `deny` directives in `munin-node.conf`). This implementation does not support authentication — it assumes the target node accepts connections from the Workers IP range. Use a firewall or `allow` directive to restrict access.

### 11. No TLS support
Munin supports TLS via the `tls` directive in `munin-node.conf`. Port of Call does not implement TLS for Munin (no `tls.connect()` wrapper). For encrypted monitoring, tunnel munin-node through SSH or use a Cloudflare Tunnel.

---

## Failure Modes

| Scenario | HTTP Status | `success` | Error field |
|----------|-------------|-----------|-------------|
| Missing `host` | 400 | N/A | `"Missing required parameter: host"` |
| Invalid port (0, >65535) | 400 | N/A | `"Port must be between 1 and 65535"` |
| Missing `plugin` (`/fetch`) | 400 | N/A | `"Missing required parameter: plugin"` |
| Invalid plugin name (`/fetch`) | 400 | N/A | `"Invalid plugin name. Use alphanumeric, dots, underscores, hyphens only."` |
| Cloudflare-protected host | 403 | `false` | Cloudflare error message + `isCloudflare: true` |
| TCP connection refused | 500 | `false` | Socket error message |
| Connection timeout | 500 | `false` | `"Connection timeout"` |
| Plugin error (`/fetch`) | 200 | **`false`** | Error line in `message` field |
| Empty plugin response (`/fetch`) | 200 | `true` | `values` is empty array, `valueCount: 0` |
| No JSON body (GET request) | 500 | `false` | JSON parse error |

---

## Local Testing

```bash
# Install munin-node (Debian/Ubuntu)
sudo apt install munin-node
sudo systemctl start munin-node

# Configure munin-node to allow external connections
# /etc/munin/munin-node.conf:
#   allow ^10\..*$           (allow private networks)
#   allow ^172\.(1[6-9]|2[0-9]|3[01])\..*$
#   allow ^192\.168\..*$

sudo systemctl restart munin-node

# Test with telnet
telnet localhost 4949
# Expected output:
#   # munin node at yourhostname
# Commands to try:
#   version
#   cap multigraph
#   nodes
#   list
#   fetch cpu
#   quit

# Or use netcat for scripted tests
{
  echo "version"
  echo "list"
  echo "fetch cpu"
  echo "quit"
} | nc localhost 4949

# Docker: munin-node with minimal config
docker run --rm -d -p 4949:4949 \
  --name munin-node \
  aheimsbakk/munin-node

# Verify from Port of Call
curl -s https://portofcall.ross.gg/api/munin/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"YOUR_SERVER_IP"}' | jq .
```

---

## Protocol Differences vs Standard Munin Master

| Aspect | Standard Munin Master | Port of Call |
|--------|----------------------|--------------|
| Banner handling | Waits indefinitely | 3 s timeout |
| Plugin discovery | `list` per virtual node | Single `list` (no virtual node arg) |
| Config retrieval | `config <plugin>` per graph | Not implemented |
| Data collection | `fetch <plugin>` per poll | `fetch <plugin>` on demand |
| Multigraph support | Full parsing of multigraph output | Returns raw response, no parsing |
| Connection reuse | Persistent connections during poll cycle | New connection per API call |
| Error handling | Retries, marks plugin as failed | Returns error immediately |

---

## Security Considerations

1. **No authentication** — anyone who can reach the munin-node port can read all metrics. Use firewall rules or munin-node's `allow` / `deny` directives.

2. **Plugin name injection** — the plugin name in `/fetch` is validated against `/^[a-zA-Z0-9._-]+$/` to prevent newline injection or command injection in the `fetch <plugin>` command.

3. **Cloudflare detection** — both endpoints check if the target host resolves to a Cloudflare IP and return 403. This prevents abuse of Port of Call as a Cloudflare bypass.

4. **Timeout limits** — inner timeouts are capped at 3 s per command, outer timeout defaults to 10 s. This prevents resource exhaustion from slow or malicious munin-node servers.

5. **No privileged operations** — the Munin protocol is read-only from the client's perspective. Port of Call cannot trigger plugin execution (that happens on the server side when `fetch` is called, but the server controls what runs).

---

## Example: Monitoring a Server Fleet

```bash
# Discovery script: connect to all nodes, get plugin lists
for host in node1 node2 node3; do
  curl -s -X POST https://portofcall.ross.gg/api/munin/connect \
    -H 'Content-Type: application/json' \
    -d "{\"host\":\"$host.example.com\"}" \
    | jq -r ".plugins[]"
done > all_plugins.txt

# Fetch all CPU metrics from all nodes
for host in node1 node2 node3; do
  curl -s -X POST https://portofcall.ross.gg/api/munin/fetch \
    -H 'Content-Type: application/json' \
    -d "{\"host\":\"$host.example.com\",\"plugin\":\"cpu\"}" \
    | jq ".values"
done
```

---

## Further Reading

- **Munin Project:** https://munin-monitoring.org/
- **Munin Node Protocol Guide (unofficial):** https://munin.readthedocs.io/en/latest/protocol/index.html
- **munin-node.conf man page:** `man munin-node.conf`
- **Plugin Development:** https://guide.munin-monitoring.org/en/latest/plugin/writing.html
