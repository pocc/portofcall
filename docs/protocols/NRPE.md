# NRPE (Nagios Remote Plugin Executor) — Power User Reference

> Port of Call implementation: [`src/worker/nrpe.ts`](../../src/worker/nrpe.ts)

**Port:** 5666 | **Protocol:** Binary packet-based over TCP | **RFC:** None (Nagios project spec)

NRPE allows remote execution of Nagios monitoring plugins on Unix/Linux hosts. The protocol uses a fixed-size binary packet format (1036 bytes) with CRC32 integrity checking. Most production deployments use TLS encryption (the daemon default).

---

## Endpoints

| # | Route | Method | Handler | Default Port | Description |
|---|-------|--------|---------|-------------|-------------|
| 1 | `/api/nrpe/query` | POST | `handleNRPEQuery` | 5666 | Execute check command (plaintext TCP) |
| 2 | `/api/nrpe/tls` | POST | `handleNRPETLS` | 5666 | Execute check command (TLS-encrypted) |
| 3 | `/api/nrpe/version` | POST | `handleNRPEVersion` | 5666 | Get NRPE version via `_NRPE_CHECK` (plaintext) |

All endpoints are POST-only with JSON body. GET requests return HTTP 405. All endpoints include Cloudflare detection (HTTP 403 if target is behind Cloudflare).

---

## Wire Protocol

NRPE uses a fixed 1036-byte packet format for both query and response:

```
Offset  Size  Type     Field
──────  ────  ───────  ─────────────────────────────────
0       2     uint16   Protocol version (2 or 3)
2       2     uint16   Packet type (1=query, 2=response)
4       4     uint32   CRC32 checksum
8       2     uint16   Result code (0=OK, 1=WARNING, 2=CRITICAL, 3=UNKNOWN)
10      1024  bytes    Buffer (command or output, null-terminated UTF-8)
1034    2     uint16   Padding (always 0)
```

All multi-byte integers are **big-endian** (network byte order).

### CRC32 Computation

The CRC32 is computed over the entire 1036-byte packet with the CRC field itself set to 0. Algorithm matches standard CRC32 (polynomial 0xEDB88320):

```javascript
crc = 0xFFFFFFFF
for each byte:
  crc ^= byte
  for 8 bits:
    if (crc & 1): crc = (crc >>> 1) ^ 0xEDB88320
    else:         crc = (crc >>> 1)
crc = (crc ^ 0xFFFFFFFF) >>> 0
```

Responses with CRC mismatch are flagged with `error: "Response CRC32 mismatch..."` but still return `success: true` with the output (allowing inspection of corrupted data).

### Protocol Versions

- **Version 2:** Standard NRPE packet format (all implementations)
- **Version 3:** Same packet format, adds support for larger buffers in NRPE 3.x daemons (not used by this implementation — buffer remains 1024 bytes)

Both versions use identical wire format. Version 3 is backward-compatible with version 2.

---

## Endpoint Details

### 1. `/api/nrpe/query` — Execute check command (plaintext)

Sends a check command to an NRPE daemon over plaintext TCP. Use this for daemons configured with `ssl=no` (non-standard).

**Request:**
```json
{
  "host": "nrpe-host.example.com",
  "port": 5666,
  "command": "_NRPE_CHECK",
  "version": 2,
  "timeout": 10000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | Hostname or IP address |
| `port` | number | `5666` | Must be 1–65535 |
| `command` | string | `"_NRPE_CHECK"` | Check command configured in `nrpe.cfg` |
| `version` | number | `2` | Protocol version (2 or 3) |
| `timeout` | number (ms) | `10000` | Connection + read timeout |

**Success (200):**
```json
{
  "success": true,
  "host": "nrpe-host.example.com",
  "port": 5666,
  "command": "_NRPE_CHECK",
  "protocolVersion": 2,
  "resultCode": 0,
  "resultCodeName": "OK",
  "output": "NRPE v4.1.0",
  "rtt": 42
}
```

**No response received (200):**
```json
{
  "success": false,
  "host": "nrpe-host.example.com",
  "port": 5666,
  "command": "_NRPE_CHECK",
  "error": "No response received — NRPE daemon may require TLS (check_nrpe -n for non-TLS)",
  "rtt": 10003
}
```

**Validation error (400):**
```json
{
  "success": false,
  "error": "Port must be between 1 and 65535"
}
```

**Cloudflare detected (403):**
```json
{
  "success": false,
  "error": "Cannot query nrpe-host.example.com (resolves to 104.26.x.x, a Cloudflare IP). NRPE requires direct access to the origin server. Update DNS or use the origin IP directly.",
  "isCloudflare": true
}
```

**Connection error (500):**
```json
{
  "success": false,
  "error": "Connection timeout"
}
```

---

### 2. `/api/nrpe/tls` — Execute check command (TLS-encrypted)

Same as `/query` but establishes a TLS connection before sending the NRPE packet. Use this for production NRPE daemons (default `ssl=yes` configuration).

**Request:**
```json
{
  "host": "nrpe-host.example.com",
  "port": 5666,
  "command": "check_load",
  "version": 2,
  "timeout": 10000
}
```

Fields are identical to `/query`.

**Success (200):**
```json
{
  "success": true,
  "tls": true,
  "host": "nrpe-host.example.com",
  "port": 5666,
  "command": "check_load",
  "protocolVersion": 2,
  "resultCode": 1,
  "resultCodeName": "WARNING",
  "output": "LOAD WARNING - load average: 2.54, 2.21, 1.98",
  "rtt": 156
}
```

The only difference from `/query` responses is the presence of the `"tls": true` field.

**No response (200):**
```json
{
  "success": false,
  "host": "nrpe-host.example.com",
  "port": 5666,
  "command": "check_load",
  "tls": true,
  "error": "No response received from NRPE daemon over TLS",
  "rtt": 10002
}
```

---

### 3. `/api/nrpe/version` — Get NRPE version

Convenience endpoint that sends the built-in `_NRPE_CHECK` command and extracts the version string from the output. Uses plaintext TCP (no TLS).

**Request:**
```json
{
  "host": "nrpe-host.example.com",
  "port": 5666,
  "timeout": 10000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | |
| `port` | number | `5666` | |
| `timeout` | number (ms) | `10000` | |

No `command` or `version` parameters — always uses `_NRPE_CHECK` with protocol version 2.

**Success (200):**
```json
{
  "success": true,
  "host": "nrpe-host.example.com",
  "port": 5666,
  "nrpeVersion": "4.1.0",
  "output": "NRPE v4.1.0",
  "protocolVersion": 2,
  "resultCode": 0,
  "resultCodeName": "OK",
  "valid": true,
  "rtt": 38
}
```

| Field | Type | Notes |
|-------|------|-------|
| `nrpeVersion` | string \| null | Extracted version number (e.g. `"4.1.0"`) or `null` if parsing failed |
| `valid` | boolean | `true` if CRC32 matched and packet type was 2 (response) |

**No response (200):**
```json
{
  "success": false,
  "host": "nrpe-host.example.com",
  "port": 5666,
  "error": "No response — NRPE daemon may require TLS",
  "rtt": 10001
}
```

---

## Result Codes

NRPE uses standard Nagios plugin exit codes:

| Code | Name | Meaning |
|------|------|---------|
| 0 | `OK` | Check succeeded, all values within acceptable range |
| 1 | `WARNING` | Check succeeded, values approaching threshold |
| 2 | `CRITICAL` | Check failed, values exceeded threshold |
| 3 | `UNKNOWN` | Check could not complete (missing data, plugin error) |

The `resultCodeName` field maps codes 0–3 to these strings. Unknown codes are returned as `UNKNOWN(N)` where N is the numeric value.

**Important:** NRPE returns `resultCode: 2` (CRITICAL) for command not found, permission denied, or plugin execution failure. Check the `output` field for the specific error message.

---

## Common Check Commands

The `command` parameter refers to commands configured in `/etc/nagios/nrpe.cfg` on the remote host. The daemon only executes commands explicitly allowed in this file.

### Built-in Commands

| Command | Description | Always Available |
|---------|-------------|------------------|
| `_NRPE_CHECK` | Returns NRPE daemon version | Yes (built-in) |

All other commands must be defined in `nrpe.cfg`. Example daemon configuration:

```ini
# /etc/nagios/nrpe.cfg
command[check_users]=/usr/lib/nagios/plugins/check_users -w 5 -c 10
command[check_load]=/usr/lib/nagios/plugins/check_load -w 15,10,5 -c 30,25,20
command[check_disk]=/usr/lib/nagios/plugins/check_disk -w 20% -c 10% -p /
command[check_zombie_procs]=/usr/lib/nagios/plugins/check_procs -w 5 -c 10 -s Z
command[check_total_procs]=/usr/lib/nagios/plugins/check_procs -w 150 -c 200
```

### Standard Nagios Plugins

These plugins are typically installed at `/usr/lib/nagios/plugins/` or `/usr/local/nagios/libexec/`:

| Plugin | Example Command | Checks |
|--------|-----------------|--------|
| `check_load` | `check_load -w 15,10,5 -c 30,25,20` | System load (1m, 5m, 15m averages) |
| `check_disk` | `check_disk -w 20% -c 10% -p /` | Disk usage on specified partition |
| `check_procs` | `check_procs -w 150 -c 200` | Total process count |
| `check_users` | `check_users -w 5 -c 10` | Logged-in user count |
| `check_swap` | `check_swap -w 20% -c 10%` | Swap space usage |
| `check_http` | `check_http -H localhost -p 80` | HTTP service on local host |
| `check_ssh` | `check_ssh -H localhost` | SSH service availability |
| `check_ntp_time` | `check_ntp_time -H pool.ntp.org` | Time sync with NTP server |

To use any of these, the NRPE daemon must have a corresponding `command[...]` entry in `nrpe.cfg`.

### Argument Restrictions

**CRITICAL SECURITY NOTE:** Most production NRPE deployments disable command arguments for security reasons:

```ini
# nrpe.cfg
dont_blame_nrpe=0   # Default: arguments disabled
```

With this setting (the secure default), you cannot pass arguments in the command string. All thresholds and options must be hardcoded in `nrpe.cfg`. Sending `"command": "check_disk -w 20%"` will fail with `CRITICAL: Command not found`.

To enable arguments (insecure, allows arbitrary plugin execution):

```ini
dont_blame_nrpe=1
```

Use this only in trusted environments. Port of Call sends the command string exactly as provided — no validation or sanitization.

---

## Protocol Flow

### Standard Query/Response

```
Client                              NRPE Daemon
  |                                     |
  | -----[TCP SYN]-------------------> |  Port 5666
  | <----[SYN-ACK]-------------------- |
  | -----[ACK]-----------------------> |
  |                                     |
  | -----[NRPE Query Packet]---------> |  1036 bytes
  |      version=2, type=1, crc=...    |  Buffer contains command
  |                                     |
  |                                     |  Execute plugin
  |                                     |  (reads output, exit code)
  |                                     |
  | <----[NRPE Response Packet]------- |  1036 bytes
  |      version=2, type=2, crc=...    |  Buffer contains output
  |      resultCode=0/1/2/3            |
  |                                     |
  | -----[FIN]-----------------------> |
  | <----[FIN-ACK]-------------------- |
```

### TLS-Encrypted Flow

When using `/api/nrpe/tls` (or connecting to a daemon with `ssl=yes`):

```
Client                              NRPE Daemon
  |                                     |
  | -----[TCP SYN]-------------------> |
  | <----[SYN-ACK]-------------------- |
  | -----[ACK]-----------------------> |
  |                                     |
  | -----[TLS ClientHello]-----------> |  Start TLS handshake
  | <----[TLS ServerHello]------------ |
  | <----[Certificate]---------------- |  Server cert (self-signed typical)
  | <----[ServerHelloDone]------------ |
  | -----[ClientKeyExchange]---------> |
  | -----[ChangeCipherSpec]----------> |
  | -----[Finished]-------------------> |
  | <----[ChangeCipherSpec]----------- |
  | <----[Finished]------------------- |  TLS established
  |                                     |
  | -----[NRPE Query (encrypted)]----> |  Same 1036-byte packet
  | <----[NRPE Response (encrypted)]-- |  Inside TLS tunnel
  |                                     |
  | -----[TLS close_notify]----------> |
  | <----[TLS close_notify]----------- |
  | -----[FIN]-----------------------> |
```

The NRPE packet format is identical whether plaintext or TLS-encrypted — TLS is applied at the transport layer, transparent to the NRPE protocol.

---

## RTT Measurement

The `rtt` field (round-trip time in milliseconds) measures total elapsed time from socket creation to response parsing completion:

```
startTime = Date.now()
  ↓
  socket.connect()
  socket.write(query)
  socket.read(response)
  parse response
  ↓
rtt = Date.now() - startTime
```

For TLS endpoints, `rtt` includes:
- TCP handshake time
- TLS handshake time (ClientHello → Finished)
- NRPE query transmission
- Plugin execution time on remote host
- NRPE response transmission

Typical values:
- LAN (plaintext): 5–50ms
- LAN (TLS): 20–100ms
- WAN (TLS): 50–300ms

High RTT (>500ms) may indicate:
- Network latency
- Slow plugin execution (disk checks, database queries)
- CPU contention on monitored host
- TLS handshake overhead on slow embedded systems

---

## Known Limitations and Quirks

### 1. No TLS certificate validation

The `/api/nrpe/tls` endpoint establishes TLS but does not verify the server certificate. NRPE daemons typically use self-signed certificates, and Cloudflare Workers do not support custom certificate validation.

**Security impact:** Vulnerable to man-in-the-middle attacks. Use `/tls` only when querying trusted hosts on isolated networks.

### 2. Timeout applies to entire operation

The `timeout` parameter is a single timer covering:
- TCP connection establishment
- TLS handshake (if `/tls`)
- NRPE query transmission
- Plugin execution
- Response transmission

If a plugin takes 8 seconds to execute and `timeout: 10000`, you have only 2 seconds for network operations. Increase timeout for slow plugins (database checks, SNMP walks).

### 3. No connection reuse

Each request opens a new TCP connection. NRPE is designed for one-shot queries (unlike HTTP keepalive or database connection pools). Polling the same host every minute opens 60 connections/hour.

### 4. Single read for response

The implementation reads the response in a loop until 1036 bytes are accumulated. If the remote host sends the response in multiple small TCP segments (unusual but possible over high-latency links), reading may time out prematurely.

**Observed in practice:** Rare. NRPE responses are small (1036 bytes) and typically fit in a single TCP segment (MTU 1500).

### 5. Command validation is daemon-side only

Port of Call performs **no validation** on the `command` field — it sends exactly what you provide, up to 1023 bytes (1024-byte buffer, null-terminated). The NRPE daemon validates against its `nrpe.cfg` allowed commands.

Sending `"command": "check_malicious; rm -rf /"` will **not** execute arbitrary code (NRPE does not use shell expansion unless the plugin itself is a shell script invoking `sh -c`). However, with `dont_blame_nrpe=1`, you can pass arguments to plugins, which may introduce injection risks if plugins are poorly written.

### 6. Output truncation at 1024 bytes

Plugin output is truncated to 1023 bytes (1024-byte buffer minus null terminator). Long outputs (e.g. `check_disk` with many filesystems, verbose error messages) are silently cut off.

The truncated output is still valid — the NRPE daemon performs truncation before CRC computation, so the checksum remains correct.

### 7. UTF-8 decoding of output

The output buffer is decoded as UTF-8. Plugins outputting binary data or non-UTF-8 encodings (legacy Latin-1 plugins) may display replacement characters (�) or corruption.

**Standard Nagios plugins output ASCII + common Unicode characters.** This is rarely an issue in practice.

### 8. Protocol version validation added (bugfix)

Earlier versions of this implementation did not validate that the response version matched the request version. If a client sends v2 and the daemon responds with v3 (or vice versa due to corruption), the implementation now returns an error:

```json
{
  "success": false,
  "error": "Protocol version mismatch: sent v2, received v3"
}
```

This prevents silent misinterpretation of packet fields.

### 9. CRC mismatch still returns output

If CRC32 validation fails (corrupted packet, transmission error), the response includes:

```json
{
  "success": true,
  "error": "Response CRC32 mismatch or unexpected packet type — response may be corrupted",
  "output": "...",
  ...
}
```

`success: true` allows inspection of potentially corrupted data. Check the `error` field presence to detect CRC failures.

### 10. No support for NRPE payload encryption (obsolete feature)

NRPE v2 had an optional XOR-based "encryption" mode (not real cryptography, just obfuscation). NRPE v3 removed this in favor of TLS. This implementation assumes:
- Plaintext NRPE packets on `/query`
- TLS-encrypted transport on `/tls`

No support for the legacy XOR obfuscation.

### 11. Cloudflare detection only checks A/AAAA records

The Cloudflare detection resolves the target hostname and checks if the IP belongs to Cloudflare's ranges. If the host uses a CNAME pointing to Cloudflare, but the final A record is not in Cloudflare ranges (e.g. direct AWS origin), the check may not detect it.

**Limitation:** Does not detect Cloudflare Spectrum or Magic Transit which may proxy arbitrary TCP ports.

### 12. GET requests return 405 before Cloudflare check

If you send `GET /api/nrpe/query`, the handler returns HTTP 405 Method Not Allowed immediately, before checking if the target is behind Cloudflare. This is correct per HTTP semantics (method validation comes first).

---

## curl Examples

**Query NRPE version (plaintext):**
```bash
curl -X POST https://portofcall.example.com/api/nrpe/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"nrpe-host.example.com","command":"_NRPE_CHECK"}'
```

**Query NRPE version via dedicated endpoint:**
```bash
curl -X POST https://portofcall.example.com/api/nrpe/version \
  -H 'Content-Type: application/json' \
  -d '{"host":"nrpe-host.example.com"}' | jq .nrpeVersion
```

**Check disk usage (TLS):**
```bash
curl -X POST https://portofcall.example.com/api/nrpe/tls \
  -H 'Content-Type: application/json' \
  -d '{"host":"nrpe-host.example.com","command":"check_disk"}'
```

**Check load with custom timeout:**
```bash
curl -X POST https://portofcall.example.com/api/nrpe/tls \
  -H 'Content-Type: application/json' \
  -d '{"host":"nrpe-host.example.com","command":"check_load","timeout":30000}'
```

**Check processes (protocol v3):**
```bash
curl -X POST https://portofcall.example.com/api/nrpe/tls \
  -H 'Content-Type: application/json' \
  -d '{"host":"nrpe-host.example.com","command":"check_total_procs","version":3}'
```

**Query with explicit port:**
```bash
curl -X POST https://portofcall.example.com/api/nrpe/tls \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.1.50","port":5666,"command":"check_users"}'
```

**Extract just the output:**
```bash
curl -s -X POST https://portofcall.example.com/api/nrpe/tls \
  -H 'Content-Type: application/json' \
  -d '{"host":"nrpe-host.example.com","command":"_NRPE_CHECK"}' \
  | jq -r .output
```

---

## Local Testing

### Install NRPE daemon (Ubuntu/Debian)

```bash
# Install NRPE server and Nagios plugins
sudo apt update
sudo apt install nagios-nrpe-server nagios-plugins-basic nagios-plugins-standard

# Edit configuration
sudo vim /etc/nagios/nrpe.cfg
```

### Configure NRPE daemon

Edit `/etc/nagios/nrpe.cfg`:

```ini
# Listen on all interfaces (default: 127.0.0.1 only)
server_address=0.0.0.0

# Allow connections from any host (default: localhost only)
allowed_hosts=0.0.0.0/0

# Enable/disable SSL (most production setups use ssl=1)
ssl=1  # Use /api/nrpe/tls
# ssl=0  # Use /api/nrpe/query

# Security: disable command arguments (recommended)
dont_blame_nrpe=0

# Define allowed commands
command[check_users]=/usr/lib/nagios/plugins/check_users -w 5 -c 10
command[check_load]=/usr/lib/nagios/plugins/check_load -w 15,10,5 -c 30,25,20
command[check_disk]=/usr/lib/nagios/plugins/check_disk -w 20% -c 10% -p /
command[check_zombie_procs]=/usr/lib/nagios/plugins/check_procs -w 5 -c 10 -s Z
command[check_total_procs]=/usr/lib/nagios/plugins/check_procs -w 150 -c 200
```

Restart the daemon:

```bash
sudo systemctl restart nagios-nrpe-server
sudo systemctl status nagios-nrpe-server
```

### Test with check_nrpe (Nagios client)

```bash
# Install client
sudo apt install nagios-nrpe-plugin

# Test with TLS
/usr/lib/nagios/plugins/check_nrpe -H 127.0.0.1 -c _NRPE_CHECK
# Output: NRPE v4.0.3

# Test without TLS (if ssl=0)
/usr/lib/nagios/plugins/check_nrpe -H 127.0.0.1 -c _NRPE_CHECK -n

# Execute a configured check
/usr/lib/nagios/plugins/check_nrpe -H 127.0.0.1 -c check_load
# Output: LOAD OK - load average: 0.52, 0.58, 0.59|load1=0.520;15.000;30.000;0; load5=0.580;10.000;25.000;0; load15=0.590;5.000;20.000;0;
```

### Docker setup (for isolated testing)

```bash
# Run NRPE daemon in Docker
docker run -d \
  --name nrpe-test \
  -p 5666:5666 \
  -v $(pwd)/nrpe.cfg:/etc/nagios/nrpe.cfg:ro \
  kaysond/nrpe
```

Create `nrpe.cfg` with the configuration above, then test:

```bash
# From host machine
curl -X POST http://localhost:8787/api/nrpe/tls \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","command":"_NRPE_CHECK"}' | jq
```

---

## Security Considerations

### 1. Allowed commands whitelist

NRPE is secure by design: only commands listed in `nrpe.cfg` can execute. An attacker querying your NRPE daemon can:
- Execute any whitelisted command (read-only plugins typically)
- See output of those commands (may leak system info: uptime, disk usage, running processes)

They **cannot** (with default settings):
- Execute arbitrary commands (`dont_blame_nrpe=0`)
- Write files or modify system state (Nagios plugins are read-only)
- Bypass the whitelist

### 2. Argument injection risk

With `dont_blame_nrpe=1`, clients can pass arguments to plugins:

```bash
command[check_disk]=/usr/lib/nagios/plugins/check_disk $ARG1$
```

Requesting `"command": "check_disk -w 99% -c 98%"` passes `-w 99% -c 98%` as `$ARG1$`.

**Risk:** If a plugin uses `sh -c` or `system()` with unsanitized arguments, injection is possible. Standard Nagios plugins use `execv()` (safe), but custom shell script plugins may be vulnerable.

**Recommendation:** Always use `dont_blame_nrpe=0` unless you trust all clients and plugins.

### 3. TLS certificate validation

`/api/nrpe/tls` does not validate certificates. A MITM attacker can intercept the TLS connection and:
- See the command being executed
- Modify the response output
- Return fake monitoring data

**Mitigation:** Use NRPE only on trusted networks (internal monitoring systems, VPNs). For external monitoring, use authenticated protocols (SSH + remote command execution).

### 4. Allowed hosts IP whitelist

NRPE daemons typically restrict clients by IP:

```ini
allowed_hosts=10.0.1.5,192.168.1.0/24
```

Port of Call workers originate from Cloudflare IP ranges. If your NRPE daemon restricts by IP, add Cloudflare ranges or use a dedicated monitoring host with a static IP.

### 5. Command output information disclosure

NRPE responses may include sensitive data:
- Running processes (`check_procs` with full command lines)
- Filesystem paths (`check_disk` output)
- Database connection strings (custom plugin output)
- Internal hostnames and IP addresses

**Recommendation:** Review plugin output before exposing NRPE to untrusted networks. Sanitize custom plugin output.

---

## Comparison: NRPE vs. Alternatives

| Feature | NRPE | SNMP | SSH + Command | Zabbix Agent |
|---------|------|------|---------------|--------------|
| Default port | 5666 | 161 (UDP) | 22 | 10050 |
| Transport | TCP | UDP (or TCP) | TCP (encrypted) | TCP |
| Encryption | TLS (optional) | SNMPv3 USM | SSH (always) | Optional TLS |
| Authentication | IP whitelist | Community / USM user | SSH keys / password | None (IP whitelist) |
| Command execution | Whitelisted plugins | No (read-only OIDs) | Any command | Whitelisted items |
| Output format | Text (plugin output) | ASN.1 BER | Text (command stdout) | JSON or text |
| Binary protocol | Yes (1036-byte packets) | Yes (ASN.1) | No (text-based) | Yes (custom framing) |
| Firewall friendliness | Good (single port) | Poor (UDP blocked often) | Excellent (SSH common) | Good (single port) |
| Ease of setup | Medium (config file) | High (SNMP daemon built-in) | Low (SSH already running) | Medium (agent install) |
| Use case | Nagios/Icinga monitoring | Multi-vendor SNMP devices | Ad-hoc remote commands | Zabbix monitoring |

**When to use NRPE:**
- You run Nagios, Icinga, or compatible monitoring systems
- You need standardized plugin ecosystem (thousands of plugins available)
- You want simple text output (no complex parsing)
- Your monitoring targets are Linux/Unix servers

**When not to use NRPE:**
- Your devices support SNMP only (network switches, UPS, storage arrays)
- You need agent-initiated push metrics (Zabbix active checks, Prometheus exporters)
- You require strong authentication (use SSH or SNMPv3 authPriv)
- You want cross-platform agents (NRPE is primarily Unix/Linux; NSClient++ for Windows)

---

## NRPE Version History

| Version | Released | Changes |
|---------|----------|---------|
| 2.x | 2006–2013 | Standard NRPE protocol, 1024-byte buffers, optional XOR obfuscation |
| 3.x | 2013–present | Removed XOR obfuscation, added support for larger buffers (16384 bytes), TLS 1.2+ required, protocol version field (same packet format as v2) |
| 4.x | 2021–present | Updated TLS defaults, removed obsolete OpenSSL versions, no protocol changes |

This implementation supports both version 2 and 3 wire protocol (identical format). The buffer remains 1024 bytes regardless of version parameter — NRPE 3.x daemons accept v2 queries.

---

## Resources

- [NRPE Documentation (Nagios)](https://github.com/NagiosEnterprises/nrpe/blob/master/README.md) — Official NRPE project README
- [NRPE Protocol Specification](https://github.com/NagiosEnterprises/nrpe/blob/master/docs/NRPE.pdf) — Binary packet format details
- [Nagios Plugins](https://www.monitoring-plugins.org/) — Standard plugin collection
- [Nagios Plugin Development Guidelines](https://nagios-plugins.org/doc/guidelines.html) — Exit codes, output format, performance data
- [NRPE Configuration Reference](https://assets.nagios.com/downloads/nagioscore/docs/nrpe/NRPE.pdf) — nrpe.cfg options

## No Formal RFC

NRPE has no IETF RFC. The protocol is defined by the Nagios project and documented in the official GitHub repository. The packet format has remained stable since NRPE v2 (2006).
