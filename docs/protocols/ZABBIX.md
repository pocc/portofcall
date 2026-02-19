# Zabbix Protocol — Power User Reference

> Port of Call implementation: [`src/worker/zabbix.ts`](../../src/worker/zabbix.ts)

## Endpoints

| # | Route | Method | Handler | Default Port | Description |
|---|-------|--------|---------|-------------|-------------|
| 1 | `/api/zabbix/connect` | POST | `handleZabbixConnect` | 10051 | Probe Zabbix server — sends "active checks" request |
| 2 | `/api/zabbix/agent` | POST | `handleZabbixAgent` | 10050 | Query Zabbix agent — passive item check |
| 3 | `/api/zabbix/discovery` | POST | `handleZabbixDiscovery` | 10051 | Two-step probe — active checks + sender data |

All endpoints are POST-only (call `request.json()`). GET requests fail with HTTP 500 (JSON parse error), not 405.

No Cloudflare detection on any endpoint.

---

## Wire Protocol

All three endpoints use ZBXD framing:

```
Offset  Size  Field
──────  ────  ─────────────────────────────────
0       4     Magic: 0x5A 0x42 0x58 0x44 ("ZBXD")
4       1     Flags: 0x01 = standard
5       8     Payload length (LE uint64, only low 32 bits read)
13      N     JSON payload (UTF-8)
```

Flag 0x03 (zlib compression) is **not supported**. The encoder always sends 0x01. The decoder does not check the flag byte — a compressed response would be treated as raw UTF-8, producing garbage.

Responses without the `ZBXD` magic are handled as legacy plain-text (pre-Zabbix 1.4 agents). In this case only the first TCP segment is read — large plain-text responses are truncated at segment boundaries.

---

## Endpoint Details

### 1. `/api/zabbix/connect`

Sends an "active checks" request to a Zabbix server/proxy, mimicking agent registration.

**Request:**
```json
{ "host": "zabbix-server.example.com", "port": 10051, "timeout": 10000 }
```

**Wire exchange:**
```
→ ZBXD 0x01 [len] {"request":"active checks","host":"portofcall-probe"}
← ZBXD 0x01 [len] {"response":"success","data":[...],"info":"..."}
```

**Response:**
```json
{
  "success": true,
  "host": "zabbix-server.example.com",
  "port": 10051,
  "response": "success",
  "data": "{\n  \"response\": \"success\",\n  \"data\": [...]\n}",
  "version": "processed: 0; failed: 0; total: 0",
  "rtt": 42
}
```

**Quirks:**

- **Hardcoded agent hostname** — The request always sends `"host": "portofcall-probe"` (line 235). The `host` field in the request body is the server's TCP address, not the agent name. The server returns items configured for "portofcall-probe" — typically empty unless that host exists in Zabbix. Unlike `/discovery`, there is no `agentHost` parameter to customize this.

- **`version` is not a version** — The `version` field is populated from the response's `info` key (line 273). For active checks responses, `info` contains a processing summary like `"processed: 0; failed: 0; total: 0"`, not a Zabbix version string. The field name is misleading.

- **`data` is pretty-printed JSON** — The raw response payload is re-serialized with 2-space indentation (`JSON.stringify(parsed, null, 2)`). If the response isn't valid JSON, the raw decoded string is used.

- **`response` fallback** — If the parsed JSON has no `response` key, the field defaults to the literal string `"connected"`.

---

### 2. `/api/zabbix/agent`

Queries a Zabbix agent for a single item value (passive check).

**Request:**
```json
{ "host": "agent.example.com", "port": 10050, "key": "agent.ping", "timeout": 10000 }
```

**Wire exchange:**
```
→ ZBXD 0x01 [len] agent.ping
← ZBXD 0x01 [len] 1
```

Note: the agent request payload is the raw item key string (not JSON). The agent responds with the raw value string.

**Response (success):**
```json
{ "success": true, "host": "agent.example.com", "port": 10050, "key": "agent.ping", "value": "1", "rtt": 15 }
```

**Response (unsupported item):**
```json
{ "success": true, "host": "...", "key": "bad.key", "value": "ZBX_NOTSUPPORTED\x00Item is not supported." }
```

**Quirks:**

- **`success: true` with `ZBX_NOTSUPPORTED`** — When the agent doesn't support the requested key, it returns `ZBX_NOTSUPPORTED` followed by a NUL byte and a reason string. The endpoint still reports `success: true`. Check the `value` field with `value.startsWith('ZBX_NOTSUPPORTED')` to detect this.

- **Key validation** — Keys are limited to 255 characters and control characters (`\x00`–`\x1f`) are rejected (HTTP 400). No further key format validation.

- **No JSON wrapping** — Unlike `/connect` and `/discovery` which send JSON payloads, `/agent` sends the raw key string inside the ZBXD frame. This matches the real Zabbix agent protocol for passive checks.

**Common item keys:**

| Key | Returns |
|-----|---------|
| `agent.ping` | `1` if alive |
| `agent.version` | Version string (e.g. `6.4.0`) |
| `agent.hostname` | Configured hostname |
| `system.uptime` | Seconds since boot |
| `system.hostname` | OS hostname |
| `system.uname` | Kernel/arch string |
| `system.cpu.num` | CPU count |
| `vm.memory.size[total]` | Total RAM in bytes |
| `vfs.fs.discovery` | JSON filesystem discovery data |
| `net.if.discovery` | JSON network interface discovery data |

---

### 3. `/api/zabbix/discovery`

Two-step server probe: (1) active checks, then (2) sender data submission. Opens two separate TCP connections, matching real agent behavior.

**Request:**
```json
{
  "host": "zabbix-server.example.com",
  "port": 10051,
  "timeout": 10000,
  "agentHost": "my-monitored-host"
}
```

**Step 1 — Active checks (connection 1):**
```
→ ZBXD 0x01 [len] {"request":"active checks","host":"my-monitored-host","ip":"my-monitored-host"}
← ZBXD 0x01 [len] {"response":"success","data":[{"key":"agent.ping","delay":"60"},...],"info":"..."}
```

**Step 2 — Sender data (connection 2):**
```
→ ZBXD 0x01 [len] {"request":"sender data","data":[{"host":"my-monitored-host","key":"system.hostname","value":"my-monitored-host","clock":1739836800}]}
← ZBXD 0x01 [len] {"response":"success","info":"processed: 1; failed: 0; total: 1; seconds spent: 0.000123"}
```

**Response:**
```json
{
  "success": true,
  "host": "zabbix-server.example.com",
  "port": 10051,
  "agentHost": "my-monitored-host",
  "activeChecks": [
    { "key": "agent.ping", "delay": "60" },
    { "key": "system.cpu.util[,idle]", "delay": "30" }
  ],
  "senderResponse": "processed: 1; failed: 0; total: 1; seconds spent: 0.000123",
  "rtt": 85
}
```

**Quirks:**

- **`agentHost` is the killer feature** — Unlike `/connect` which hardcodes `"portofcall-probe"`, `/discovery` lets you specify `agentHost` to impersonate any configured host. This returns the actual monitoring items configured for that host and lets you submit sender data as that host.

- **`ip` field is set to `agentHost`** — The active checks request sets `"ip": agentHost` (line 493). Per the Zabbix protocol, this should be an IP address, not a hostname. Depending on the Zabbix server version, this may be ignored, used for logging, or cause the request to be rejected by strict IP-based allowlists.

- **Step 1 failure is non-fatal** — If the active checks request fails (connection refused, timeout, parse error), the endpoint continues to the sender data step. `activeChecks` will be an empty array and `success` will still be `true`.

- **Sender data is hardcoded** — Always sends a single item: `key: "system.hostname"` with `value: agentHost`. The `clock` field is `Math.floor(Date.now() / 1000)`. A power user cannot customize which data items are submitted.

- **`rtt` spans both connections** — The returned `rtt` measures total time across both TCP connections (active checks + sender data), not per-request.

- **`senderResponse` on error** — If the sender data step fails, `senderResponse` contains the error message prefixed with `"sender error: "` (e.g. `"sender error: Connection timeout"`).

---

## Cross-Endpoint Comparison

| | `/connect` | `/agent` | `/discovery` |
|---|---|---|---|
| Default port | 10051 | 10050 | 10051 |
| Target | Server/Proxy | Agent | Server/Proxy |
| TCP connections | 1 | 1 | 2 (sequential) |
| Payload format | JSON | Raw key string | JSON |
| Agent hostname | Hardcoded `"portofcall-probe"` | N/A | Configurable `agentHost` |
| Port validation | 1–65535 | 1–65535 | 1–65535 |
| Host validation | Truthy check only | Truthy check only | Truthy check only |
| Key validation | N/A | ≤255 chars, no control chars | N/A |
| Cloudflare detection | No | No | No |
| Method restriction | No | No | No |

---

## Response Reading

`readZabbixResponse` accumulates TCP chunks with length-aware completion:

1. For ZBXD-framed responses: reads until `totalBytes >= header.dataLength + 13`
2. For plain-text responses (no ZBXD magic): reads only the first chunk, then stops
3. Hard cap: **64 KB** (`maxBytes = 65536`) — responses beyond this are silently truncated
4. Timeout: per-endpoint `timeout` parameter (default 10s) applies to the read loop

If the timeout fires after some data has been received, the partial data is returned (not an error). Only if zero chunks have been read does the timeout propagate as an exception.

---

## Known Limitations

1. **No compressed response support** — Flag 0x03 (zlib) not handled; compressed payloads parsed as raw text
2. **No TLS/PSK encryption** — All connections are plaintext TCP
3. **No GET support** — POST with JSON body only; other methods return HTTP 500
4. **No host format validation** — Any truthy string is accepted as `host`; no IP/hostname regex
5. **No method restriction** — Endpoints don't check `request.method`
6. **Plain-text truncation** — Legacy agent responses limited to first TCP segment
7. **64-bit length truncation** — Only low 32 bits of the ZBXD length field are read (theoretical; capped at 64 KB anyway)
8. **Timeout promises not cancelled** — `setTimeout` callbacks run after socket completion (harmless but wasteful)
9. **No sender data customization** — `/discovery` always sends `system.hostname`; cannot submit arbitrary items
10. **`version` field misleading** — Contains processing summary, not Zabbix version

---

## curl Examples

**Probe a Zabbix server:**
```bash
curl -X POST https://portofcall.example.com/api/zabbix/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"zabbix.example.com"}'
```

**Query an agent for uptime:**
```bash
curl -X POST https://portofcall.example.com/api/zabbix/agent \
  -H 'Content-Type: application/json' \
  -d '{"host":"agent.example.com","port":10050,"key":"system.uptime"}'
```

**Discovery with custom agent host:**
```bash
curl -X POST https://portofcall.example.com/api/zabbix/discovery \
  -H 'Content-Type: application/json' \
  -d '{"host":"zabbix.example.com","agentHost":"web-server-01"}'
```

**Agent filesystem discovery:**
```bash
curl -X POST https://portofcall.example.com/api/zabbix/agent \
  -H 'Content-Type: application/json' \
  -d '{"host":"agent.example.com","key":"vfs.fs.discovery"}'
```

---

## Local Testing

Run a Zabbix stack with Docker:

```bash
# Server + agent (agent connects back to server)
docker run -d --name zabbix-server \
  -e DB_SERVER_HOST=localhost \
  -p 10051:10051 \
  zabbix/zabbix-server-sqlite3:latest

docker run -d --name zabbix-agent \
  -e ZBX_SERVER_HOST=host.docker.internal \
  -e ZBX_HOSTNAME=test-agent \
  -p 10050:10050 \
  zabbix/zabbix-agent2:latest
```

Then query:
```bash
# Agent passive check
curl -s localhost:8787/api/zabbix/agent \
  -d '{"host":"localhost","key":"agent.ping"}' | jq

# Server probe (requires "test-agent" or "portofcall-probe" host in Zabbix config)
curl -s localhost:8787/api/zabbix/connect \
  -d '{"host":"localhost"}' | jq

# Discovery as the configured agent
curl -s localhost:8787/api/zabbix/discovery \
  -d '{"host":"localhost","agentHost":"test-agent"}' | jq
```
