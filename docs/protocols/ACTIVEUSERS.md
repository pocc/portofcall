# Active Users Protocol (RFC 866) — Power User Documentation

## Protocol Overview

The Active Users protocol (RFC 866, May 1983) is an Internet Standard for querying the list of currently logged-in users on networked hosts. Designed as a debugging and measurement tool, it returns ASCII text listing active users without regard to input.

**Standard Port:** 11 (TCP and UDP)
**RFC Status:** Internet Standard (STD 24)
**Published:** May 1983, J. Postel (ISI)

## RFC 866 Specification Summary

### TCP Implementation (Port 11)
1. Client connects to server on TCP port 11
2. Server ignores any incoming data
3. Server transmits list of active users (ASCII text, one user per line)
4. Server closes connection after transmission completes

### UDP Implementation (Port 11)
1. Client sends UDP datagram to port 11
2. Server ignores datagram contents
3. Server responds with one or more UDP datagrams containing user list
4. If list exceeds one datagram, server may send multiple datagrams
5. User entries must not be fragmented across datagrams
6. Clients should implement timeout logic to collect all responses

### Response Format
- **Character Set:** ASCII printing characters, space, carriage return (CR), line feed (LF)
- **Structure:** One user per line (separated by CR, LF, or CRLF)
- **No Strict Syntax:** Implementations vary widely in output format
- **User Definition:** "An active user is one logged in" (similar to Unix `who` or `systat` output)

### Common Response Formats

**Minimal count:**
```
42
```

**Count with units:**
```
42 users
```

**Descriptive:**
```
There are 42 users logged in
```

**Unix-style per-user list:**
```
root     tty1     2026-02-18 09:15
alice    pts/0    2026-02-18 10:23
bob      pts/1    2026-02-18 11:47
```

**BSD-style with idle time:**
```
alice    tty1     Feb 18 10:23   0:05
bob      pts/0    Feb 18 11:47   .
root     pts/1    Feb 18 09:15   old
```

## Implementation Details

This implementation provides **three API endpoints** for different use cases:

### 1. `/api/activeusers/test` — Simple User Count Extraction

**Purpose:** Quick check for number of active users with automatic parsing.

**Request:**
```json
{
  "host": "example.com",
  "port": 11,
  "timeout": 10000
}
```

**Response:**
```json
{
  "success": true,
  "response": "42 users logged in",
  "userCount": 42,
  "rtt": 127
}
```

**Fields:**
- `success` (boolean) — Query succeeded
- `response` (string) — Raw server response (trimmed)
- `userCount` (number | undefined) — Extracted user count (regex `/\d+/`), or `undefined` if no number found
- `rtt` (number) — Round-trip time in milliseconds
- `error` (string, on failure) — Error message

**Use Case:** Monitoring dashboards, uptime checks, quick user count retrieval.

### 2. `/api/activeusers/query` — Structured User Parsing

**Purpose:** Parse multi-line user lists into structured data (Unix `who`-style output).

**Request:**
```json
{
  "host": "legacy.example.com",
  "port": 11,
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "users": [
    {
      "username": "root",
      "tty": "tty1",
      "loginTime": "2026-02-18 09:15"
    },
    {
      "username": "alice",
      "tty": "pts/0",
      "loginTime": "2026-02-18 10:23",
      "idle": "0:05"
    }
  ],
  "rawCount": 2,
  "raw": "root     tty1     2026-02-18 09:15\nalice    pts/0    2026-02-18 10:23   0:05\n",
  "latencyMs": 142
}
```

**Fields:**
- `success` (boolean) — Query succeeded
- `users` (array) — Parsed user objects (see below)
- `rawCount` (number) — Number of non-empty lines in response
- `raw` (string) — Complete server response (unparsed)
- `latencyMs` (number) — Round-trip time in milliseconds
- `error` (string, on failure) — Error message

**User Object:**
- `username` (string) — Login name
- `tty` (string) — Terminal/console identifier
- `loginTime` (string) — Login timestamp (format varies by server)
- `idle` (string, optional) — Idle time (`"0:05"`, `"."` = active, `"old"` = >24h)

**Parsing Logic:**
1. Split response into lines (CR, LF, or CRLF)
2. For each line: split by whitespace, extract `username`, `tty`, login time fields
3. Detect idle time if last field matches `/^(\d+:\d+|\.|old)$/`
4. Return null for lines with fewer than 2 fields
5. Filter out null entries

**Use Case:** Auditing, session tracking, detailed user activity monitoring.

### 3. `/api/activeusers/raw` — Unmodified Server Output

**Purpose:** Retrieve exact server response for debugging or custom parsing.

**Request:**
```json
{
  "host": "obscure-system.example.com",
  "port": 11,
  "timeout": 20000
}
```

**Response:**
```json
{
  "success": true,
  "raw": "System has 7 active sessions:\nuser1 (console), user2 (remote), user3 (ssh)...\n",
  "latencyMs": 89
}
```

**Fields:**
- `success` (boolean) — Query succeeded
- `raw` (string) — Complete unmodified server response
- `latencyMs` (number) — Round-trip time in milliseconds
- `error` (string, on failure) — Error message

**Use Case:** Troubleshooting, analyzing non-standard implementations, forensic analysis.

## Protocol Implementation Details

### Connection Flow

```
┌─────────┐                          ┌─────────┐
│ Client  │                          │ Server  │
└────┬────┘                          └────┬────┘
     │                                    │
     │  TCP SYN (port 11)                 │
     ├────────────────────────────────────>
     │                                    │
     │  SYN-ACK                           │
     <────────────────────────────────────┤
     │                                    │
     │  ACK                               │
     ├────────────────────────────────────>
     │                                    │
     │  (optional: client sends data)     │
     │  (server ignores input)            │
     │                                    │
     │  User list (ASCII text)            │
     <────────────────────────────────────┤
     │                                    │
     │  FIN (server closes)               │
     <────────────────────────────────────┤
     │                                    │
     │  ACK                               │
     ├────────────────────────────────────>
     │                                    │
```

### Reading Strategy

RFC 866 does not specify whether the response arrives in a single packet or multiple chunks. This implementation uses `readAllBytes()` to accumulate all data until:
1. Server closes connection (stream `done: true`)
2. Timeout expires
3. Read error occurs

**Why not read a single chunk?**
Early implementation only read first chunk (`reader.read()` once), which works for small responses but fails when:
- Response exceeds TCP window size (~64KB typical)
- Server uses small write buffers
- Network conditions cause fragmentation
- Long user lists span multiple TCP segments

**Fixed implementation:**
All three endpoints now call `readAllBytes(reader, remainingTimeout)` to collect complete response before parsing.

### Timeout Handling

**Three-phase timeout calculation:**

1. **Connection timeout:** Full `timeout` value for `socket.opened`
2. **Read timeout:** `remainingTimeout = timeout - (Date.now() - startTime)`
3. **Minimum fallback:** If `remainingTimeout <= 0`, use 1000ms floor to prevent immediate timeout

**Cleanup on timeout:**
- `timeoutId` tracked and cleared in all code paths (success, error, timeout)
- Socket explicitly closed in timeout promise rejection handler
- Prevents orphaned connections and timer leaks

### Resource Management

**Fixed resource leaks:**

1. **Timer cleanup:** All endpoints now track `timeoutId` and call `clearTimeout()` in try/finally paths
2. **Socket cleanup:** Timeout promise rejection handler calls `socket.close()` before rejecting
3. **Reader lock release:** Always released before socket close (prevents "reader locked" errors)

**Cleanup order (success path):**
```javascript
clearTimeout(timeoutId);    // Stop timeout timer
reader.releaseLock();       // Release stream lock
socket.close();             // Close TCP connection
```

**Cleanup order (error path):**
```javascript
clearTimeout(timeoutId);    // Stop timeout timer
socket.close();             // Close connection (releases reader implicitly)
throw error;                // Propagate error
```

### Input Validation

All endpoints validate:
- `host` (required, non-empty string)
- `port` (optional, defaults to 11, must be 1-65535)
- `timeout` (optional, defaults to 10000ms)

**Error responses:**
```json
{ "success": false, "error": "Host is required", ... }
{ "success": false, "error": "Port must be between 1 and 65535", ... }
{ "success": false, "error": "Connection timeout", ... }
```

## Security Considerations

### Information Disclosure
Active Users protocol leaks system information without authentication:
- **Usernames:** Real login names (potential enumeration targets)
- **Session details:** Login times, idle status, terminal types
- **System type:** Response format often reveals OS (Linux, BSD, Solaris, etc.)
- **Activity patterns:** Correlate user presence with business hours, shifts

**Mitigation:** Block port 11 at firewall unless explicitly needed for legacy monitoring.

### Denial of Service
- **No rate limiting:** This implementation allows rapid queries (potential for abuse)
- **No response size limits:** Malicious server could send gigabytes of data
- **Timeout-based DoS:** Setting very long timeouts ties up worker resources

**Mitigation:** Deploy behind rate-limiting proxy, set reasonable timeout caps (e.g., 30s max).

### Privacy Violations
- **GDPR/CCPA implications:** User lists may constitute personal data
- **Session tracking:** Persistent monitoring reveals attendance patterns
- **Correlation attacks:** Cross-reference with other services (SMTP, HTTP logs)

**Mitigation:** Log queries, implement access controls, notify users of monitoring.

### Network Reconnaissance
- **Port scanning:** Open port 11 signals legacy Unix system
- **Fingerprinting:** Response format reveals OS version
- **Credential stuffing:** Enumerated usernames feed into brute-force attacks

**Mitigation:** Use host-based firewalls, IDS/IPS to detect scanning.

## Historical Context and Modern Relevance

### 1983 Design Assumptions
RFC 866 predates:
- Firewalls (first commercial firewall: 1988)
- NAT (RFC 1631, 1994)
- Widespread Internet encryption (SSL 1.0, 1995)
- Privacy regulations (GDPR, CCPA)

Original use case: Transparent monitoring of shared timesharing systems (VAX, PDP-11) where all users were trusted colleagues.

### Modern Usage
**Virtually extinct.** Survey data:
- **2019 Shodan scan:** ~200 hosts worldwide with port 11 open
- **2023 scan:** ~50 hosts (mostly honeypots, legacy academic systems)
- **Production systems:** Nearly zero (replaced by SSH/LDAP/Active Directory monitoring)

**Why still implemented?**
1. **Protocol testing:** Validate TCP socket implementations
2. **Historical demonstration:** Educational/museum value
3. **RFC compliance:** Completeness in protocol suite implementations
4. **Honeypot bait:** Detect reconnaissance activity

### Obsolescence Factors
1. **Security:** No authentication, plaintext usernames
2. **Privacy:** Violates modern data protection standards
3. **Functionality:** SSH, SNMP, WMI provide richer session data
4. **Standardization:** No updates since 1983 (42+ years)

## Testing and Validation

### Test Servers

**Note:** Virtually no public Active Users servers exist. Testing requires:

1. **Local netcat server:**
```bash
# Terminal 1: Start simple server
echo "alice pts/0 2026-02-18 10:23" | nc -l -p 11

# Terminal 2: Test with curl
curl -X POST http://localhost:8787/api/activeusers/test \
  -H "Content-Type: application/json" \
  -d '{"host":"127.0.0.1","port":11,"timeout":5000}'
```

2. **Custom Python server:**
```python
#!/usr/bin/env python3
import socket, time

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('0.0.0.0', 11))
s.listen(5)
print("RFC 866 server listening on port 11...")

while True:
    conn, addr = s.accept()
    print(f"Connection from {addr}")
    users = [
        "root     tty1     Feb 18 09:15",
        "alice    pts/0    Feb 18 10:23   0:05",
        "bob      pts/1    Feb 18 11:47   ."
    ]
    response = "\r\n".join(users) + "\r\n"
    conn.sendall(response.encode('ascii'))
    time.sleep(0.1)  # Simulate network delay
    conn.close()
```

3. **Docker container:**
```dockerfile
FROM alpine:latest
RUN apk add --no-cache socat
CMD ["socat", "TCP-LISTEN:11,fork", "EXEC:'echo 5 users logged in'"]
```

### Expected Behavior

**Successful query (`/api/activeusers/test`):**
```bash
curl -X POST https://worker.example.com/api/activeusers/test \
  -H "Content-Type: application/json" \
  -d '{"host":"test.example.com","port":11,"timeout":10000}'
```
Response:
```json
{
  "success": true,
  "response": "5 users logged in",
  "userCount": 5,
  "rtt": 142
}
```

**Timeout:**
```bash
curl -X POST https://worker.example.com/api/activeusers/test \
  -H "Content-Type: application/json" \
  -d '{"host":"unreachable.example.com","port":11,"timeout":2000}'
```
Response (after 2 seconds):
```json
{
  "success": false,
  "error": "Connection timeout",
  "response": "",
  "rtt": 0
}
```

**Connection refused:**
```json
{
  "success": false,
  "error": "Connection refused",
  "response": "",
  "rtt": 0
}
```

**Invalid port:**
```bash
curl -X POST https://worker.example.com/api/activeusers/query \
  -H "Content-Type: application/json" \
  -d '{"host":"example.com","port":999999}'
```
Response:
```json
{
  "success": false,
  "users": [],
  "rawCount": 0,
  "raw": "",
  "latencyMs": 0,
  "error": "Port must be between 1 and 65535"
}
```

## Performance Characteristics

### Latency Breakdown

Typical RTT components for successful query:
```
Total RTT: 150ms
  ├─ DNS resolution: 20ms      (not measured by implementation)
  ├─ TCP handshake: 40ms       (SYN, SYN-ACK, ACK)
  ├─ Server processing: 5ms    (read user DB, format response)
  ├─ Data transfer: 10ms       (transmit ASCII text)
  └─ Connection teardown: 75ms (FIN, ACK, FIN, ACK + TIME_WAIT)
```

**Measured RTT:** `Date.now() - startTime` includes everything except DNS.

### Timeout Tuning

**Default: 10000ms (10 seconds)**

Recommended adjustments:
- **LAN servers:** 2000ms (fast local networks)
- **Internet servers:** 10000ms (default, handles packet loss)
- **Satellite/high-latency:** 30000ms (300-600ms RTT links)
- **Production monitoring:** 5000ms (fail fast for alerting)

**Warning:** Cloudflare Workers have 50-second CPU time limit. Setting timeout >45s risks worker termination.

### Concurrency and Rate Limits

**No built-in rate limiting.** Each request:
- Opens 1 TCP connection
- Allocates 1 ReadableStream reader
- Runs 1 setTimeout timer
- Holds resources until timeout or completion

**Recommended limits:**
- **Per-IP rate limit:** 10 requests/minute (prevent scanning)
- **Global rate limit:** 100 requests/minute (protect worker CPU)
- **Concurrent connections:** 50 max (prevent resource exhaustion)

Implement via Cloudflare Rate Limiting rules or Worker KV-based throttling.

## Troubleshooting

### "Connection timeout" (Common)

**Causes:**
1. Host down or unreachable
2. Firewall blocks port 11
3. No Active Users service running
4. Network latency exceeds timeout

**Diagnosis:**
```bash
# Test raw TCP connectivity
nc -zv example.com 11

# Test with telnet
telnet example.com 11

# Check firewall rules
nmap -p 11 example.com
```

**Fix:** Increase timeout or verify service is running.

### "No response received from server" (Rare)

**Causes:**
1. Server accepts connection but sends no data
2. Server sends binary data (TextDecoder fails silently)
3. Network drops packets after handshake

**Diagnosis:** Use `/api/activeusers/raw` and inspect `raw` field for zero-length string or unexpected bytes.

**Fix:** Check server logs, verify protocol implementation.

### Empty `users` array but `rawCount > 0` (Parsing Issue)

**Cause:** Server response doesn't match expected format (space-separated fields).

**Example:**
```
Response: "5 users currently logged in\n"
Expected: "alice pts/0 2026-02-18 10:23\n"
```

**Fix:** Use `/api/activeusers/raw` to see actual format, write custom parser.

### Negative `remainingTimeout` (Fixed in v2)

**Old bug:** If connection took longer than timeout, `readAllBytes()` received negative timeout.

**Example:**
```javascript
// timeout = 5000ms, connection took 6000ms
remainingTimeout = 5000 - 6000 = -1000
readAllBytes(reader, -1000)  // Instant timeout!
```

**Fix:** Added fallback: `remainingTimeout > 0 ? remainingTimeout : 1000`.

### Resource Leak (Fixed in v2)

**Old bug:** Timeout firing after success caused double-close or orphaned timers.

**Symptoms:**
- Worker memory growth over time
- "Socket already closed" errors in logs
- Timeouts firing after response received

**Fix:** All endpoints now:
1. Track `timeoutId` variable
2. Call `clearTimeout(timeoutId)` in success and error paths
3. Close socket in timeout promise rejection handler

## Implementation Quirks and Limitations

### 1. TCP-Only (No UDP Support)

**RFC 866 defines both TCP and UDP.** This implementation only supports TCP.

**Reason:** Cloudflare Workers `connect()` API does not support UDP sockets (as of 2026-02).

**Impact:** Cannot query UDP-only Active Users servers (very rare, <1% of implementations).

**Workaround:** None. Use external tool like `nc -u` for UDP queries.

### 2. No Multi-Datagram UDP Handling

**RFC 866 UDP:** Server may send multiple datagrams if user list exceeds MTU (~1500 bytes).

**Impact:** N/A (no UDP support).

**Note:** If UDP support added, must implement:
- Datagram reassembly
- Timeout-based completion detection
- Duplicate datagram filtering

### 3. Parsing Heuristics (Not Standards-Based)

**RFC 866:** "No specific syntax for the user list."

**Implementation:** Assumes whitespace-separated fields (`username tty loginTime [idle]`).

**Limitations:**
- Fails on custom formats (e.g., JSON, XML, proprietary binary)
- Misparses usernames with spaces (rare but possible)
- Cannot detect truncated responses

**Fix:** Use `/api/activeusers/raw` and implement custom parser for non-standard servers.

### 4. No Response Size Limit

**Risk:** Malicious server sends 10GB of data, exhausts worker memory.

**Mitigation:** Cloudflare Workers enforce ~128MB memory limit (process terminates).

**Recommendation:** Add `maxBytes` parameter to `readAllBytes()`:
```javascript
if (total > maxBytes) throw new Error('Response too large');
```

### 5. Timeout Floor of 1000ms

When remaining timeout goes negative (connection slower than expected), implementation uses 1000ms floor.

**Rationale:** Prevent instant timeout on slow networks.

**Side effect:** Total operation time can exceed requested timeout by up to 1000ms.

**Example:**
```
Requested timeout: 5000ms
Connection time: 6000ms
Read timeout: max(5000-6000, 1000) = 1000ms
Total time: 6000 + 1000 = 7000ms (exceeds 5000ms request)
```

### 6. No Cloudflare Detection Bypass

Many systems behind Cloudflare proxy don't expose port 11 (Cloudflare only proxies HTTP/HTTPS).

**Error:** "Connection refused" even if server runs Active Users on origin.

**Workaround:** Query origin IP directly (if known), or use Cloudflare Spectrum (paid feature).

### 7. TextDecoder Assumes UTF-8

RFC 866 specifies ASCII, but `TextDecoder().decode()` uses UTF-8 by default.

**Impact:** Minimal (ASCII is subset of UTF-8). May misinterpret high bytes (>127) if server sends Latin-1/ISO-8859-1.

**Fix:** Use `new TextDecoder('ascii', {fatal: false})` for strict ASCII handling.

### 8. No Server Fingerprinting

Implementation doesn't attempt to identify OS/version from response format.

**Fingerprinting techniques:**
- Date format (`"Feb 18 10:23"` = BSD, `"2026-02-18 10:23"` = Linux)
- Field order (`username tty time` vs `tty username time`)
- Idle time notation (`"."` = BSD, `"0:05"` = System V)

**Use case:** Security auditing, asset inventory.

**Implementation:** Future enhancement, low priority (protocol rarely used).

## Advanced Usage

### Monitoring Multiple Hosts

**Parallel queries with `Promise.all()`:**
```javascript
const hosts = ['server1.example.com', 'server2.example.com', 'server3.example.com'];

const results = await Promise.all(
  hosts.map(host =>
    fetch('https://worker.example.com/api/activeusers/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port: 11, timeout: 5000 })
    }).then(r => r.json())
  )
);

results.forEach((result, i) => {
  console.log(`${hosts[i]}: ${result.userCount ?? 'error'} users (${result.rtt}ms)`);
});
```

### Custom Parsing for Non-Standard Formats

**Scenario:** Server returns `"Total: 42 sessions\nDetails: ..."` instead of count.

**Solution:**
```javascript
const response = await fetch('https://worker.example.com/api/activeusers/raw', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ host: 'weird-server.example.com', port: 11 })
}).then(r => r.json());

const match = response.raw.match(/Total:\s*(\d+)\s*sessions/);
const userCount = match ? parseInt(match[1], 10) : null;
console.log(`Extracted user count: ${userCount}`);
```

### Integration with Monitoring Systems

**Prometheus exporter:**
```javascript
// Worker endpoint: /metrics
async function handleMetrics(request) {
  const hosts = ['host1.example.com', 'host2.example.com'];
  const metrics = [];

  for (const host of hosts) {
    const response = await fetch('http://localhost:8787/api/activeusers/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port: 11, timeout: 5000 })
    }).then(r => r.json());

    const count = response.userCount ?? -1;
    metrics.push(`activeusers_count{host="${host}"} ${count}`);
    metrics.push(`activeusers_rtt_ms{host="${host}"} ${response.rtt}`);
  }

  return new Response(metrics.join('\n'), {
    headers: { 'Content-Type': 'text/plain' }
  });
}
```

**Grafana dashboard query:**
```promql
activeusers_count{host="server1.example.com"}
```

### Historical Data Collection

**Store results in Cloudflare KV:**
```javascript
// Worker binding: ACTIVEUSERS_KV
async function logActiveUsers(env) {
  const response = await fetch('http://localhost:8787/api/activeusers/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host: 'legacy.example.com', port: 11 })
  }).then(r => r.json());

  const timestamp = new Date().toISOString();
  const key = `activeusers:legacy.example.com:${timestamp}`;
  await env.ACTIVEUSERS_KV.put(key, JSON.stringify(response), {
    expirationTtl: 86400 * 30  // 30 days retention
  });
}
```

**Query historical data:**
```javascript
const keys = await env.ACTIVEUSERS_KV.list({ prefix: 'activeusers:legacy.example.com:' });
const history = await Promise.all(
  keys.keys.map(k => env.ACTIVEUSERS_KV.get(k.name, 'json'))
);
```

## References

### RFC Documents
- [RFC 866 - Active Users](https://datatracker.ietf.org/doc/html/rfc866) (May 1983, STD 24)
- [RFC 863 - Discard Protocol](https://datatracker.ietf.org/doc/html/rfc863) (contemporary debugging tool)
- [RFC 867 - Daytime Protocol](https://datatracker.ietf.org/doc/html/rfc867) (similar simple protocol)

### Historical Context
- [RFC 2555 - 30 Years of RFCs](https://datatracker.ietf.org/doc/html/rfc2555) (discusses early Internet protocols)
- [The TCP/IP Guide - Active Users Protocol](http://www.tcpipguide.com/free/t_ActiveUsersProtocolAUSP.htm)

### Modern Alternatives
- **SSH:** `ssh user@host who` (authenticated, encrypted)
- **SNMP:** `snmpwalk -v2c -c public host 1.3.6.1.4.1.2021.10.1` (standard MIB for user count)
- **WMI:** `Get-WmiObject Win32_ComputerSystem | Select-Object -ExpandProperty UserName` (Windows)
- **REST APIs:** Modern system monitoring APIs (Prometheus, Datadog, New Relic)

### Security Research
- [SANS: Unusual TCP and UDP Services](https://isc.sans.edu/forums/diary/Unusual+TCP+and+UDP+Services/26652/) (2020 survey of rare protocols)
- [Shodan Port 11 Search](https://www.shodan.io/search?query=port%3A11) (current Active Users servers online)

### Tools
- **netcat:** `nc host 11` (manual query)
- **nmap:** `nmap -p 11 -sV host` (service detection)
- **telnet:** `telnet host 11` (interactive query)
- **socat:** `socat TCP:host:11 -` (verbose logging)

## Changelog

### Version 2 (2026-02-18) — Bug Fixes
- **Fixed:** Incomplete response reading in `handleActiveUsersTest` (now uses `readAllBytes`)
- **Fixed:** Missing port validation in `handleActiveUsersQuery` and `handleActiveUsersRaw`
- **Fixed:** Negative `remainingTimeout` calculation (added 1000ms floor)
- **Fixed:** Timer resource leak (added `clearTimeout` to all paths)
- **Fixed:** Socket cleanup on timeout (timeout promise now closes socket)

### Version 1 (Initial)
- Implemented `/api/activeusers/test`, `/api/activeusers/query`, `/api/activeusers/raw`
- TCP-only Active Users protocol support
- Basic user list parsing for Unix `who`-style output
- RFC 866 compliance for TCP implementation
