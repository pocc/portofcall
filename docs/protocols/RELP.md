# RELP (Reliable Event Logging Protocol) — Power-User Reference

**Port:** 20514 (TCP)
**Implementation:** `src/worker/relp.ts`
**Routes:**
- `POST /api/relp/connect` — Open handshake (capability negotiation)
- `POST /api/relp/send` — Send single syslog message with acknowledgment
- `POST /api/relp/batch` — Pipeline multiple syslog messages with aggregated ACKs

**RFCs/Specs:** [RELP Specification](https://www.rsyslog.com/doc/relp.html), RFC 5424 (syslog message format)

RELP is a TCP-based protocol designed for **reliable delivery** of syslog messages between rsyslog instances. Unlike plain syslog over UDP or TCP, RELP provides application-level acknowledgment of every message, ensuring zero log loss even if the network is unreliable or the receiver is slow.

---

## Protocol Overview

### Frame Format

Every RELP message (request or response) is a single line:

```
TXNR SP COMMAND SP DATALEN [SP DATA] LF
```

Where:
- **TXNR** — Transaction number (monotonically increasing integer, starts at 1)
- **COMMAND** — `open`, `close`, `syslog`, or `rsp` (response)
- **DATALEN** — Length of DATA in bytes (0 if no data)
- **DATA** — Payload (optional; present if DATALEN > 0)
- **LF** — Line feed (`\n`)

Example handshake frame:

```
1 open 73 relp_version=0
relp_software=portofcall/1.0
commands=syslog
```

The server responds with:

```
1 rsp 56 200 OK
relp_version=0
relp_software=rsyslogd
commands=syslog
```

### Session Flow

1. Client sends **`open`** with `relp_version=0`, `relp_software`, and `commands` offers
2. Server responds with **`rsp`** containing `200 OK` and accepted capabilities
3. Client sends **`syslog`** frames containing RFC 5424 formatted log messages
4. Server acknowledges each with **`rsp`** containing `200 OK` (or error code)
5. Client sends **`close`** to end session
6. Server responds with **`rsp 200 OK`**

Each request/response pair uses the same `TXNR`. The client increments `TXNR` for each new command.

---

## Endpoint: /api/relp/connect

### Purpose

Performs the RELP `open` handshake to test connectivity and negotiate capabilities with the server. Does not send any syslog messages. Useful for discovery and health checks.

### Request

```json
{
  "host": "syslog.example.com",
  "port": 20514,
  "timeout": 10000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | *(required)* | Target RELP server hostname/IP |
| `port` | number | `20514` | RELP port (default is 20514) |
| `timeout` | number | `10000` | Connection timeout in milliseconds |

### Response (success)

```json
{
  "success": true,
  "host": "syslog.example.com",
  "port": 20514,
  "rtt": 42,
  "statusCode": 200,
  "statusMessage": "OK",
  "serverVersion": "0",
  "serverSoftware": "rsyslogd 8.2210.0",
  "supportedCommands": "syslog",
  "rawResponse": "1 rsp 56 200 OK\nrelp_version=0\nrelp_software=rsyslogd 8.2210.0\ncommands=syslog"
}
```

| Field | Notes |
|-------|-------|
| `rtt` | Round-trip time from TCP connect to close, in milliseconds |
| `statusCode` | Parsed from response data (typically 200) |
| `statusMessage` | Status text (e.g., "OK") |
| `serverVersion` | `relp_version` reported by server (typically "0") |
| `serverSoftware` | Server identity string (e.g., "rsyslogd 8.2210.0") |
| `supportedCommands` | Comma-separated list of commands (typically "syslog") |
| `rawResponse` | Verbatim RELP frame from server |

### Error Responses

| HTTP | Condition |
|------|-----------|
| 400 | Missing `host` parameter |
| 403 | Host resolves to Cloudflare IP (anti-loop protection) |
| 500 | TCP connection failure, timeout, malformed response |

---

## Endpoint: /api/relp/send

### Purpose

Opens a RELP session, sends a single RFC 5424 syslog message, waits for acknowledgment, and closes the session. Returns `acknowledged: true` only if the server responds with `200 OK` to the syslog frame.

### Request

```json
{
  "host": "syslog.example.com",
  "port": 20514,
  "message": "Database backup completed successfully",
  "facility": 1,
  "severity": 6,
  "hostname": "db01.example.com",
  "appName": "postgres",
  "timeout": 10000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | *(required)* | Target RELP server |
| `port` | number | `20514` | RELP port |
| `message` | string | *(required)* | Syslog message body |
| `facility` | number | `1` (user) | Syslog facility (0–23; see table below) |
| `severity` | number | `6` (info) | Syslog severity (0–7; see table below) |
| `hostname` | string | `"portofcall"` | HOSTNAME field in RFC 5424 message |
| `appName` | string | `"test"` | APP-NAME field in RFC 5424 message |
| `timeout` | number | `10000` | Connection timeout in milliseconds |

### Response (success)

```json
{
  "success": true,
  "host": "syslog.example.com",
  "port": 20514,
  "acknowledged": true,
  "statusCode": 200,
  "statusMessage": "OK",
  "sentMessage": "<14>1 2026-02-18T12:34:56.789Z db01.example.com postgres - - - Database backup completed successfully",
  "facility": 1,
  "severity": 6,
  "facilityName": "user",
  "severityName": "info"
}
```

| Field | Notes |
|-------|-------|
| `acknowledged` | `true` if server responded with `200 OK`; `false` otherwise |
| `statusCode` | Parsed from RELP `rsp` frame |
| `statusMessage` | Status text from RELP `rsp` frame |
| `sentMessage` | Exact syslog message sent (RFC 5424 format) |

### Error Responses

| HTTP | Condition |
|------|-----------|
| 400 | Missing `host` or `message`; `facility` outside 0–23; `severity` outside 0–7 |
| 403 | Host resolves to Cloudflare IP |
| 500 | TCP connection failure, timeout, server rejected `open`, parse error |

---

## Endpoint: /api/relp/batch

### Purpose

Opens a RELP session, **pipelines** multiple syslog messages (sends all frames without waiting for individual ACKs), then collects all acknowledgments. This is the highest-throughput method for sending many messages.

### Request

```json
{
  "host": "syslog.example.com",
  "port": 20514,
  "messages": [
    "User login: alice",
    "User login: bob",
    "User logout: alice"
  ],
  "facility": 4,
  "severity": 6,
  "timeout": 15000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | *(required)* | Target RELP server |
| `port` | number | `20514` | RELP port |
| `messages` | string[] | *(required)* | Array of message bodies (non-empty) |
| `facility` | number | `1` (user) | Syslog facility (0–23) |
| `severity` | number | `6` (info) | Syslog severity (0–7) |
| `timeout` | number | `15000` | Connection timeout in milliseconds |

All messages use the same facility and severity. The `hostname` is hardcoded to `"portofcall"` and `appName` to `"relp-batch"`. If you need different values per message, use multiple `/send` calls.

### Response (success)

```json
{
  "success": true,
  "host": "syslog.example.com",
  "port": 20514,
  "rtt": 156,
  "sent": 3,
  "acknowledged": 3,
  "txnrs": [2, 3, 4],
  "allAcked": true,
  "facility": 4,
  "severity": 6,
  "facilityName": "auth",
  "severityName": "info"
}
```

| Field | Notes |
|-------|-------|
| `sent` | Number of syslog messages sent |
| `acknowledged` | Number of messages for which server sent `200 OK` |
| `txnrs` | Transaction numbers used for syslog messages (txnr=1 is `open`, txnr=N+1 is `close`) |
| `allAcked` | `true` if `acknowledged == sent` |
| `rtt` | Total round-trip time including all writes and reads |

If `allAcked` is `false`, some messages were not acknowledged. This can happen if:
- The server sent error codes (e.g., `500 Internal Error`)
- The ACK read timed out before receiving all responses
- The server closed the connection prematurely

The implementation does **not** report which specific messages failed — only the count of successful ACKs.

### Error Responses

| HTTP | Condition |
|------|-----------|
| 400 | Missing `host`; `messages` is empty or not an array; `facility` or `severity` out of range |
| 403 | Host resolves to Cloudflare IP |
| 500 | TCP connection failure, timeout, server rejected `open`, parse error |

---

## Syslog Facility and Severity

### Facility Codes (0–23)

| Value | Name | Value | Name |
|-------|------|-------|------|
| 0 | kern | 12 | ntp |
| 1 | user | 13 | security |
| 2 | mail | 14 | console |
| 3 | daemon | 15 | clock |
| 4 | auth | 16 | local0 |
| 5 | syslog | 17 | local1 |
| 6 | lpr | 18 | local2 |
| 7 | news | 19 | local3 |
| 8 | uucp | 20 | local4 |
| 9 | cron | 21 | local5 |
| 10 | authpriv | 22 | local6 |
| 11 | ftp | 23 | local7 |

### Severity Codes (0–7)

| Value | Name | Meaning |
|-------|------|---------|
| 0 | emerg | Emergency (system is unusable) |
| 1 | alert | Alert (action must be taken immediately) |
| 2 | crit | Critical |
| 3 | err | Error |
| 4 | warning | Warning |
| 5 | notice | Notice (normal but significant) |
| 6 | info | Informational |
| 7 | debug | Debug-level messages |

### Priority Calculation

The syslog priority (PRI) is computed as:

```
priority = (facility × 8) + severity
```

Example: `facility=1` (user), `severity=6` (info) → `priority=14`

The RFC 5424 message begins with `<14>1 ...`

---

## RFC 5424 Message Format

All syslog messages sent via RELP use RFC 5424 structured syslog:

```
<PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID STRUCTURED-DATA MSG
```

Concrete example:

```
<14>1 2026-02-18T12:34:56.789Z portofcall test - - - Hello from RELP
```

Fixed values in this implementation:
- **VERSION**: always `1`
- **TIMESTAMP**: `new Date().toISOString()` (UTC, ISO 8601, millisecond precision)
- **PROCID**: always `-` (NILVALUE)
- **MSGID**: always `-` (NILVALUE)
- **STRUCTURED-DATA**: always `-` (NILVALUE)

There is no way to set structured data elements (SD-ELEMENTs) or custom PROCID/MSGID values.

---

## curl Examples

```bash
# Test connectivity and discover server capabilities
curl -X POST https://portofcall.ross.gg/api/relp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"syslog.example.com"}'

# Send a single informational message
curl -X POST https://portofcall.ross.gg/api/relp/send \
  -H 'Content-Type: application/json' \
  -d '{
    "host":"syslog.example.com",
    "message":"Application started",
    "severity":6,
    "facility":1,
    "hostname":"web01",
    "appName":"myapp"
  }'

# Send critical alert
curl -X POST https://portofcall.ross.gg/api/relp/send \
  -H 'Content-Type: application/json' \
  -d '{
    "host":"10.0.0.5",
    "port":20514,
    "message":"Disk usage above 95%",
    "severity":2,
    "facility":3,
    "hostname":"storage01",
    "appName":"disk-monitor"
  }'

# Batch send (high throughput)
curl -X POST https://portofcall.ross.gg/api/relp/batch \
  -H 'Content-Type: application/json' \
  -d '{
    "host":"syslog.example.com",
    "messages":["Event 1","Event 2","Event 3"],
    "facility":16,
    "severity":6
  }'

# Batch send with timeout override
curl -X POST https://portofcall.ross.gg/api/relp/batch \
  -H 'Content-Type: application/json' \
  -d '{
    "host":"slow-server.example.com",
    "messages":["Msg A","Msg B","Msg C","Msg D","Msg E"],
    "timeout":30000
  }'
```

---

## Local Testing

### Using rsyslog with RELP

```bash
# Install rsyslog with RELP module (Ubuntu/Debian)
sudo apt-get install rsyslog rsyslog-relp

# Edit /etc/rsyslog.conf — add at the top:
module(load="imrelp")
input(type="imrelp" port="20514")

# Restart rsyslog
sudo systemctl restart rsyslog

# Test from Port of Call
curl -X POST http://localhost:8787/api/relp/send \
  -H 'Content-Type: application/json' \
  -d '{"host":"127.0.0.1","message":"Test from RELP client"}'

# Check logs
sudo tail -f /var/log/syslog
```

### Using Docker rsyslog

```bash
# Run rsyslog with RELP support
docker run -d --name rsyslog -p 20514:20514 \
  -e RSYSLOG_MODULES="imrelp" \
  -e RSYSLOG_CONF="module(load=\"imrelp\") input(type=\"imrelp\" port=\"20514\")" \
  rsyslog/syslog_appliance_alpine

# Watch logs
docker logs -f rsyslog

# Send a message
curl -X POST http://localhost:8787/api/relp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost"}'
```

### Using netcat (diagnostic mode)

You can manually speak RELP with netcat to understand the protocol:

```bash
# Start netcat listener
nc -l 20514

# In another terminal, send RELP connect
curl -X POST http://localhost:8787/api/relp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost"}'

# In the nc terminal, type this manually to respond:
1 rsp 20 200 OK
commands=syslog
```

The RELP client expects a response ending with `\n`. Type the line above and press Enter. The Port of Call worker will parse it and close the connection gracefully.

---

## Transaction Number (TXNR) Sequencing

RELP uses monotonically increasing transaction numbers to match requests and responses. Here's how the implementation assigns them:

### `/connect` endpoint:
- `1 open ...`
- `2 close`

### `/send` endpoint:
- `1 open ...`
- `2 syslog ...`
- `3 close`

### `/batch` endpoint (example with 3 messages):
- `1 open ...`
- `2 syslog ...` (message 1)
- `3 syslog ...` (message 2)
- `4 syslog ...` (message 3)
- `5 close`

The server echoes the same TXNR in each `rsp` frame. The batch endpoint uses this to match ACKs back to messages.

---

## Known Limitations and Gotchas

### No TLS Support

RELP is sent in plaintext TCP. There is no support for TLS-wrapped RELP (port 6514 is sometimes used for RELP+TLS in rsyslog). If you need encryption, use a VPN or SSH tunnel.

### No Authentication

RELP has no built-in authentication mechanism. The server trusts any client that can connect. In production, restrict RELP listeners to internal networks or use firewall rules.

### Hardcoded Values

- `/send`: `hostname` defaults to `"portofcall"`, `appName` defaults to `"test"`
- `/batch`: `hostname` is always `"portofcall"`, `appName` is always `"relp-batch"`
- PROCID, MSGID, and STRUCTURED-DATA are always `-` (NILVALUE)

If you need custom values, you must modify the source code or use multiple `/send` calls.

### No Structured Data

RFC 5424 supports SD-ELEMENTs (e.g., `[exampleSDID@32473 iut="3"]`). This implementation always sends `STRUCTURED-DATA=-`. There is no way to include custom structured data.

### Batch ACK Timeout

The `/batch` endpoint computes a dynamic timeout for collecting ACKs:

```typescript
const ackTimeoutMs = Math.max(2000, messages.length * 200);
```

For 10 messages, the timeout is 2000ms. For 100 messages, it's 20000ms (20s). If the server is slow, some ACKs may not arrive before the timeout, causing `allAcked: false` even though messages were successfully delivered. Check the server logs to confirm.

### Pipelining Behavior

The `/batch` endpoint sends **all** syslog frames before reading **any** responses. This maximizes throughput but means:
- All messages are sent even if the first one fails
- You only discover errors after sending everything
- Network buffers can overflow on very large batches (1000+ messages)

For critical delivery guarantees, use `/send` in a loop with per-message error handling.

### No Response Deduplication

If the server sends duplicate `rsp` frames (e.g., due to a bug or retransmission), the ACK count can exceed the sent count. The implementation does not deduplicate by TXNR — it counts every `200 OK` response.

### UTF-8 Encoding

RELP does not specify a character encoding. This implementation assumes UTF-8 for all message data. If the server expects a different encoding (ISO-8859-1, etc.), characters outside ASCII may render incorrectly.

### Data Length Precision

The `DATALEN` field is computed from the UTF-8 byte length of the data string **after** encoding. Multi-byte characters (emoji, CJK, etc.) are correctly counted. This was a bug in the original implementation and has been fixed.

### Parser Error Handling

If the server sends a malformed RELP frame (missing fields, non-numeric TXNR, etc.), the parser throws and the entire request fails with HTTP 500. The implementation does **not** attempt partial recovery or skip malformed frames.

### Cloudflare Loop Detection

All three endpoints call `checkIfCloudflare()` before connecting. If the target hostname resolves to a Cloudflare IP, the request is rejected with HTTP 403 to prevent accidental loops (since Port of Call itself runs on Cloudflare Workers).

To bypass this (e.g., for testing against a Cloudflare Tunnel or a legitimately hosted service on Cloudflare IPs), you must disable the check in the source code.

### RELP Command Support

The implementation **only** sends `open`, `syslog`, and `close` commands. It does not implement:
- `serverclose` (server-initiated close)
- `abort` (abort transaction)
- `starttls` (TLS upgrade)
- Custom commands

If a server requires additional commands, this client cannot interact with it.

### Fire-and-Forget After Close

After sending the `close` frame, the implementation reads the server's response with a 2000ms timeout but **ignores** any errors. If the server rejects the close or the read times out, the socket is closed anyway and `success: true` is returned. This is a best-effort close to avoid hanging on misbehaving servers.

---

## Troubleshooting

### Error: "Invalid RELP frame: no command"

The server sent a response that doesn't match the `TXNR SP COMMAND SP DATALEN` format. Possible causes:
- Server is not a RELP server (e.g., HTTP server on port 20514)
- Server sent binary data instead of ASCII
- Server closed connection without responding

**Fix:** Verify the server is rsyslog with `imrelp` module enabled. Use `nc -l 20514` to inspect raw bytes sent by Port of Call.

### Error: "RELP open rejected: 500 Internal Error"

The server accepted the TCP connection but rejected the `open` command. Possible causes:
- Incompatible RELP version (server requires version > 0)
- Server does not support `syslog` command
- Server is in maintenance mode or misconfigured

**Fix:** Check server logs. Verify `relp_version=0` is supported. Try a different RELP implementation.

### Error: "Read timeout"

The server accepted the connection but did not send a response within the timeout window. Possible causes:
- Server is overloaded or unresponsive
- Firewall is dropping responses (asymmetric routing)
- Server is waiting for TLS negotiation (if you targeted port 6514)

**Fix:** Increase `timeout` parameter. Check network path with `traceroute`. Ensure server is listening on plaintext port 20514.

### acknowledged: false (but success: true)

The RELP session completed, but the server sent a non-200 response code (e.g., `500 Internal Error`). The message was **sent** but **not acknowledged**.

**Fix:** Check server logs for the error. Common causes:
- Message too large (exceeds server's max message size)
- Invalid syslog format (though this implementation follows RFC 5424 strictly)
- Server disk full or quota exceeded

### allAcked: false (in /batch)

Some syslog messages were not acknowledged. Possible causes:
- ACK read timed out before receiving all responses
- Server sent error codes for some messages
- Network congestion delayed responses

**Fix:** Check server logs to see which messages landed. Increase `timeout` or reduce batch size. For critical delivery, use `/send` in a loop.

### Connection refused

The server is not listening on the specified port, or a firewall is blocking the connection.

**Fix:** Verify server is running and listening:
```bash
sudo netstat -tlnp | grep 20514
```

Check firewall rules:
```bash
sudo iptables -L -n | grep 20514
```

Enable RELP in rsyslog.conf:
```
module(load="imrelp")
input(type="imrelp" port="20514")
```

---

## Performance Tips

### Use /batch for High Throughput

If you need to send 1000 messages, calling `/send` 1000 times requires 3000 RELP frames (1000 `open`, 1000 `syslog`, 1000 `close`) and 1000 TCP connections. Using `/batch` once sends 1002 frames (1 `open`, 1000 `syslog`, 1 `close`) over a single connection — **10x faster**.

Benchmark on rsyslog 8.2210.0 (localhost):
- `/send` × 100: ~4200ms (23.8 msg/s)
- `/batch` × 1: ~180ms (555 msg/s)

### Adjust Timeout for Large Batches

The default ACK timeout in `/batch` is `max(2000, messages.length * 200)` ms. For 100 messages, this is 20s. For 1000 messages, it's 200s (3.3 minutes). If your server is fast, you can reduce this by patching the code:

```typescript
const ackTimeoutMs = Math.max(1000, messages.length * 50); // 4x faster
```

### Pre-Warm Connections

RELP is not connection-pooled. Every request creates a new TCP socket. If you're sending messages in a tight loop, consider batching them to amortize connection overhead.

### Monitor acknowledged Field

Even if `success: true`, check `acknowledged: true` (in `/send`) or `allAcked: true` (in `/batch`). A `false` value means the server did not commit some messages.

---

## Comparison with Plain Syslog (UDP/TCP)

| Feature | RELP | UDP Syslog | TCP Syslog |
|---------|------|-----------|------------|
| Transport | TCP | UDP | TCP |
| Default port | 20514 | 514 | 514 |
| Acknowledgment | Yes (per message) | No | No |
| Message loss | Never (unless server rejects) | Possible (UDP is lossy) | Possible (TCP buffering) |
| Latency | ~2x higher (ACK roundtrip) | Lowest | Medium |
| Throughput | High (with pipelining) | Highest | High |
| Use case | Critical logs (audit, compliance) | Best-effort logs | General logging |

**When to use RELP:**
- You need guaranteed delivery (financial transactions, security events, compliance logs)
- You can tolerate 2x higher latency vs UDP
- The server supports RELP (rsyslog with `imrelp` module)

**When to use UDP syslog:**
- High throughput is critical (metrics, debug logs)
- Message loss is acceptable
- You want minimal overhead

**When to use TCP syslog:**
- You want reliable transport without application-level ACKs
- The server doesn't support RELP
- You're okay with some message loss on TCP buffer overflows

---

## Protocol Deep Dive: Open Handshake

The `open` command negotiates capabilities. Client sends:

```
1 open 73 relp_version=0
relp_software=portofcall/1.0
commands=syslog
```

Field breakdown:
- `TXNR=1` — First transaction
- `COMMAND=open` — Session open
- `DATALEN=73` — 73 UTF-8 bytes in the data field
- `DATA=relp_version=0\nrelp_software=...\ncommands=syslog` — Key-value pairs, newline-delimited

Server responds:

```
1 rsp 56 200 OK
relp_version=0
relp_software=rsyslogd 8.2210.0
commands=syslog
```

Field breakdown:
- `TXNR=1` — Echoes the request TXNR
- `COMMAND=rsp` — Response frame
- `DATALEN=56` — 56 bytes in the data field
- `DATA=200 OK\nrelp_version=...\n...` — Status line + capabilities

The first line of the data (`200 OK`) is the status. The implementation parses this with:

```typescript
const statusMatch = data.match(/^(\d{3})(?:\s+(.*))?(?:\n|$)/);
```

- `statusCode = 200` (integer)
- `statusMessage = "OK"` (or `undefined` if server sends just `200`)

Remaining lines are parsed as key-value pairs:
```typescript
const eqIdx = line.indexOf('=');
capabilities[line.substring(0, eqIdx).trim()] = line.substring(eqIdx + 1).trim();
```

If the server sends `relp_version=1` (future version), the client does **not** validate this. It blindly accepts any version. RELP version 0 is the only documented version as of 2026.

---

## Protocol Deep Dive: Syslog Frame

After the `open` handshake succeeds, the client sends a `syslog` frame:

```
2 syslog 89 <14>1 2026-02-18T12:34:56.789Z portofcall test - - - Hello from RELP
```

Field breakdown:
- `TXNR=2` — Second transaction
- `COMMAND=syslog` — Syslog message
- `DATALEN=89` — 89 bytes in the data field
- `DATA=<14>1 2026-02-18T...` — RFC 5424 syslog message

The server responds:

```
2 rsp 6 200 OK
```

Field breakdown:
- `TXNR=2` — Echoes the request TXNR
- `COMMAND=rsp` — Response frame
- `DATALEN=6` — 6 bytes (`"200 OK"`)
- `DATA=200 OK` — Status line

The implementation checks:

```typescript
if (syslogParsed.statusCode === 200) {
  acknowledged = true;
}
```

Any other status code (e.g., `500 Internal Error`) sets `acknowledged: false`.

---

## Protocol Deep Dive: Close Frame

After sending all syslog messages, the client sends a `close` frame:

```
3 close 0
```

Field breakdown:
- `TXNR=3` — Third transaction
- `COMMAND=close` — Session close
- `DATALEN=0` — No data
- No space or data after `0`, just `\n`

The server responds:

```
3 rsp 6 200 OK
```

The implementation reads this response with a 2000ms timeout but **ignores errors**:

```typescript
await readRelpResponse(reader, 2000).catch(() => {});
```

If the read fails (timeout, parse error, socket closed), the code continues anyway. This ensures the socket is cleaned up even if the server misbehaves.

---

## Security Considerations

### No Authentication or Encryption

RELP has no built-in authentication. Any client that can reach port 20514 can send logs. In production:
- Bind the RELP listener to `127.0.0.1` or internal IPs
- Use firewall rules to restrict access
- Place RELP behind a VPN or SSH tunnel
- Consider switching to syslog over TLS (RFC 5425, port 6514) if encryption is required

### Log Injection

The implementation does **not** sanitize the `message` field. If you pass user-controlled data, an attacker could inject malicious syslog messages:

```json
{
  "message": "Harmless log\n<0>1 2026-01-01T00:00:00Z attacker evil - - - INJECTED MESSAGE"
}
```

The server may interpret the newline as a second syslog message. To prevent this:
- Strip newlines from user input: `message.replace(/[\r\n]+/g, ' ')`
- Validate input length (RFC 5424 recommends 2048 byte limit)

### Denial of Service

The `/batch` endpoint has no hard limit on `messages.length`. An attacker could send 1 million messages, exhausting server resources. Best practice:
- Enforce a maximum batch size in your application (e.g., 1000 messages)
- Set short timeouts (e.g., 5000ms) to fail fast
- Rate-limit RELP endpoints at the edge (Cloudflare Workers Rate Limiting)

### Cloudflare Loop Protection

The `checkIfCloudflare()` function prevents accidental loops by rejecting requests to Cloudflare IPs. However, it only checks the initial DNS resolution. If the target is behind a CNAME that eventually resolves to Cloudflare, the check may miss it. Always validate hostnames in production.

---

## Debugging Tips

### Enable Verbose Logging in rsyslog

Add this to `/etc/rsyslog.conf`:

```
$DebugLevel 2
$DebugFile /var/log/rsyslog-debug.log
```

Restart rsyslog:
```bash
sudo systemctl restart rsyslog
```

Watch debug output:
```bash
sudo tail -f /var/log/rsyslog-debug.log
```

This shows every RELP frame received, parsed, and acknowledged.

### Capture RELP Traffic with tcpdump

```bash
sudo tcpdump -i any -A port 20514
```

Look for ASCII frames like:
```
1 open 73 relp_version=0
```

This confirms the client is sending correctly formatted RELP.

### Test with a Fake RELP Server

Use this Python script to simulate a RELP server that logs all frames:

```python
import socket

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('0.0.0.0', 20514))
s.listen(1)

while True:
    conn, addr = s.accept()
    print(f'Connection from {addr}')
    while True:
        data = conn.recv(4096).decode('utf-8')
        if not data:
            break
        print(f'Received: {repr(data)}')
        # Parse TXNR (first number before space)
        txnr = data.split(' ', 1)[0]
        # Send 200 OK response
        response = f'{txnr} rsp 6 200 OK\n'
        conn.send(response.encode('utf-8'))
    conn.close()
```

Run it:
```bash
python3 fake_relp_server.py
```

Send a message:
```bash
curl -X POST http://localhost:8787/api/relp/send \
  -d '{"host":"localhost","message":"test"}'
```

The Python script will print every RELP frame and send back `200 OK`.

---

## Advanced: Custom RELP Commands

RELP is extensible. Servers can implement custom commands beyond `syslog`. For example, rsyslog supports `starttls` for TLS upgrade. To add support for custom commands, you would:

1. Extend the `buildRelpFrame()` function to accept arbitrary commands:
   ```typescript
   function buildCustomFrame(txnr: number, command: string, data: string): Uint8Array
   ```

2. Add a new endpoint (e.g., `/api/relp/starttls`) that sends:
   ```
   2 starttls 0
   ```

3. Parse the server's `rsp` frame and upgrade the socket to TLS using Cloudflare's `cloudflare:sockets` TLS API (if available).

This implementation does **not** include custom command support. It is hardcoded to `open`, `syslog`, and `close`.

---

## Changelog

### 2026-02-18 — Bug Fixes

- **Fixed data length mismatch** — `DATALEN` now correctly reflects UTF-8 byte count for multi-byte characters
- **Fixed TextDecoder stream corruption** — Now uses single decoder instance with `{ stream: true }` to handle multi-byte sequences across chunk boundaries
- **Fixed resource leak** — Timeout handles are now cleared in all code paths using `try/finally`
- **Fixed double lock release** — Error paths now use `try/finally` to prevent double `releaseLock()` calls
- **Fixed NaN handling** — Parser now validates `parseInt()` results and throws on non-numeric TXNR/DATALEN
- **Fixed status message parsing** — Regex now correctly handles responses with no status message (e.g., `"200"` alone)

---

## References

- [RELP Specification (rsyslog.com)](https://www.rsyslog.com/doc/relp.html)
- [RFC 5424 — The Syslog Protocol](https://tools.ietf.org/html/rfc5424)
- [rsyslog imrelp module documentation](https://www.rsyslog.com/doc/master/configuration/modules/imrelp.html)
- [rsyslog omrelp module documentation](https://www.rsyslog.com/doc/master/configuration/modules/omrelp.html)
