# Zabbix Protocol Implementation

## Overview

**Protocol**: Zabbix Server/Agent Protocol (ZBXD)
**Ports**: 10051 (server/proxy), 10050 (agent)
**Transport**: TCP with binary header
**Status**: Active, widely deployed

Zabbix is an enterprise-grade open-source network monitoring solution. Communication between Zabbix components (server, proxy, agent) uses a proprietary binary protocol with a ZBXD header followed by JSON payloads.

## Protocol Format

### ZBXD Header (13 bytes)

```
Offset  Size  Description
------  ----  -----------
0       4     Magic: "ZBXD" (0x5A 0x42 0x58 0x44)
4       1     Flags: 0x01 (standard), 0x03 (compressed)
5       8     Data length (little-endian uint64)
13      N     JSON payload (UTF-8)
```

### Communication Model

```
┌──────────┐    Port 10050    ┌──────────┐
│  Zabbix  │ ──── Query ───> │  Zabbix  │
│  Server  │ <── Response ── │  Agent   │
│ (:10051) │                 │ (:10050) │
└──────────┘                 └──────────┘
     ▲
     │ Port 10051
     │ Active Check Data
     │
┌──────────┐
│  Zabbix  │  (Agent connects to server
│  Agent   │   for active checks)
│ (active) │
└──────────┘
```

## Implementation

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/zabbix/connect` | POST | Probe Zabbix server for active checks |
| `/api/zabbix/agent` | POST | Query Zabbix agent for item values |

### Server Probe (`/api/zabbix/connect`)

Sends an "active checks" request to a Zabbix server/proxy on port 10051. This mimics the request a Zabbix agent makes to retrieve its monitoring configuration.

**Request Body:**
```json
{
  "host": "zabbix.example.com",
  "port": 10051,
  "timeout": 10000
}
```

**Response:**
```json
{
  "success": true,
  "host": "zabbix.example.com",
  "port": 10051,
  "response": "success",
  "data": "{\"response\":\"success\",\"data\":[...]}",
  "version": "...",
  "rtt": 42
}
```

### Agent Query (`/api/zabbix/agent`)

Queries a Zabbix agent on port 10050 for a specific monitoring item value. This is a "passive check" where the server requests data from the agent.

**Request Body:**
```json
{
  "host": "monitored-host.example.com",
  "port": 10050,
  "key": "agent.ping",
  "timeout": 10000
}
```

**Response:**
```json
{
  "success": true,
  "host": "monitored-host.example.com",
  "port": 10050,
  "key": "agent.ping",
  "value": "1",
  "rtt": 15
}
```

### Common Agent Item Keys

| Key | Description |
|-----|-------------|
| `agent.ping` | Agent availability (returns 1 if alive) |
| `agent.version` | Agent version string |
| `agent.hostname` | Configured hostname |
| `system.uptime` | System uptime in seconds |
| `system.hostname` | OS hostname |
| `system.uname` | OS kernel/arch info |
| `system.cpu.num` | Number of CPUs |
| `vm.memory.size[total]` | Total physical memory |
| `vfs.fs.discovery` | Filesystem discovery |
| `net.if.discovery` | Network interface discovery |

## Authentication

- **Agent (10050)**: No authentication by default. Relies on IP allowlisting (`Server=` in agent config).
- **Server (10051)**: Agents authenticate via hostname matching. Server verifies the host is configured.

Modern Zabbix (5.0+) supports TLS/PSK encryption between components.

## Timeouts & Keep-alives

- Default connection timeout: 10 seconds
- Zabbix agent default timeout: 3 seconds per item
- Server responds promptly; no keep-alive needed for single queries
- Worker connection is stateless (connect, send, receive, close)

## Binary vs. Text Encoding

- **Header**: Binary (13-byte ZBXD header with little-endian length)
- **Payload**: UTF-8 JSON text
- **Legacy agents**: May respond with plain text without ZBXD header (handled transparently)

## Edge Cases

1. **No ZBXD header**: Older agents (pre-1.4) respond with plain text. Implementation detects this and handles it.
2. **ZBX_NOTSUPPORTED**: Agent returns this for unsupported or disabled items.
3. **Compressed responses**: Flag 0x03 indicates zlib compression. Not implemented (uncommon for small responses).
4. **Large responses**: Discovery items can return large JSON. Capped at 64KB.

## Security Considerations

- Zabbix agent default config allows queries from any source unless `Server=` is configured
- No encryption by default (TLS/PSK optional)
- Item key injection prevented by control character validation
- Key length limited to 255 characters
- Read-only operations only (no data submission to agents)

## References

- [Zabbix Protocol Documentation](https://www.zabbix.com/documentation/current/en/manual/appendix/protocols)
- [Zabbix Agent Items](https://www.zabbix.com/documentation/current/en/manual/config/items/itemtypes/zabbix_agent)
- [Zabbix Active Checks](https://www.zabbix.com/documentation/current/en/manual/appendix/protocols/active_checks)
