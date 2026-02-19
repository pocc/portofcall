# UUCP (Unix-to-Unix Copy Protocol) — Power User Documentation

## Protocol Overview

UUCP (Unix-to-Unix Copy) is a historical store-and-forward network protocol suite used extensively in the 1970s-1990s for transferring files, executing remote commands, and relaying email/news between Unix systems via serial lines, dial-up modems, and early TCP/IP networks. It formed the backbone of early Internet email routing and Usenet news distribution before being replaced by SMTP, NNTP, and SSH.

**Standard Port:** 540/TCP (uucpd daemon)
**Protocol Type:** Connection-oriented, plaintext, trust-based authentication
**Published:** 1976 (AT&T Bell Labs), standardized in various forms through 1990s
**Status:** Obsolete — replaced by SSH, SFTP, rsync, SMTP

## Historical Context

### Origins and Evolution

1. **1976 — UUCP v1:** Mike Lesk at Bell Labs creates UUCP for transferring files between PDP-11 Unix systems via 300 baud modems
2. **1978 — UUCP v2:** David Nowitz rewrites UUCP with improved reliability and job queuing
3. **1983 — HoneyDanBer UUCP:** Peter Honeyman, David Nowitz, Brian Redman create UUCP v3 with security improvements
4. **1987 — Taylor UUCP:** Ian Taylor's free software implementation adds TCP/IP support, 'g' protocol, configuration flexibility
5. **1990s — Decline:** Internet growth, SMTP adoption, SSH availability make UUCP obsolete
6. **2000s — Legacy:** Remaining use confined to legacy systems, embedded devices, amateur radio networks

### Bang Paths and Email Routing

**UUCP Email Addressing:** `site1!site2!site3!user`

Before DNS-based email (user@domain.com), UUCP used "bang paths" — explicit routing instructions listing each intermediate host separated by exclamation marks. Users had to know network topology to construct paths.

**Example:**
```
From: seismo!mcvax!cernvax!alice
To: decvax!ucbvax!stanford!bob
Subject: UUCP is hard

Bob, I had to look up 5 hosts to send this email. Can't wait for DNS.
```

**Usenet Propagation:** News articles flooded across thousands of UUCP sites, with each system maintaining neighbor lists to avoid loops. A single post could take days to reach distant sites.

## Protocol Specification

### Connection Flow

UUCP over TCP (port 540) uses a master/slave handshake:

```
┌─────────┐                              ┌─────────┐
│ Client  │                              │ Server  │
│ (Slave) │                              │(Master) │
└────┬────┘                              └────┬────┘
     │                                        │
     │  TCP SYN (port 540)                    │
     ├────────────────────────────────────────>
     │                                        │
     │  SYN-ACK                               │
     <────────────────────────────────────────┤
     │                                        │
     │  ACK                                   │
     ├────────────────────────────────────────>
     │                                        │
     │  Wakeup: \r\0                          │
     ├────────────────────────────────────────>
     │                                        │
     │  Server greeting: Shere\0              │
     │                or: Shere-hostname\0    │
     <────────────────────────────────────────┤
     │                                        │
     │  Client identity: Sclientname\0        │
     ├────────────────────────────────────────>
     │                                        │
     │  Accept/Reject: ROK\0                  │
     │              or: RLOGIN\0 (auth req)   │
     │              or: RLOCKED\0 (busy)      │
     <────────────────────────────────────────┤
     │                                        │
     │  (If accepted) Protocol negotiation    │
     │  P{protocol-list}\0                    │
     ├────────────────────────────────────────>
     │                                        │
     │  U{protocol-choice} {params}\0         │
     <────────────────────────────────────────┤
     │                                        │
     │  File transfer commands (S, R, H, Y, N)│
     │<───────────────────────────────────────>│
     │                                        │
     │  Hangup: HY\0                          │
     ├────────────────────────────────────────>
     │                                        │
     │  FIN                                   │
     <────────────────────────────────────────┤
```

### Handshake Protocol Details

#### 1. Wakeup Sequence

Client sends 2-byte sequence: `\r\0` (CR NUL, bytes `0x0D 0x00`)

**Purpose:** Signal UUCP connection (some servers also accept login prompts)

#### 2. Server Greeting

Server responds with system name: `Shere\0` or `Shere-{hostname}\0`

**Format:** `S` + optional `here` keyword + optional `-` + hostname + NUL terminator

**Examples:**
- `Shere\0` — Minimal response (just "here")
- `Shere-myhost\0` — Common Taylor UUCP format
- `Smyhost\0` — Some implementations omit "here"

#### 3. Client Identification

Client sends: `S{clientname}\0`

**System Name Rules:**
- Alphanumeric and hyphen only (no underscores per traditional UUCP)
- Max 32 characters (de facto limit, not standardized)
- Must match authorized site list on server (trust-based security)

**Example:** `Sprobe\0`

#### 4. Server Response

**Accept:** `ROK\0` — "Receive OK, proceed"

**Reject (login required):** `RLOGIN\0` — "Require login authentication"

**Reject (busy):** `RLOCKED\0` — "Resource locked, try later"

**Reject (unknown):** `RYou are unknown to me\0` — Descriptive error

#### 5. Protocol Negotiation (if accepted)

**Client proposes:** `Pg\0` — "I support protocol 'g'"

**Server chooses:** `Ug -Q512\0` — "Use protocol 'g' with 512-byte packets"

**Common protocols:**
- `g` — Greg Chesson's protocol (windowed, error-correcting, most efficient)
- `e` — Even parity, 7-bit ASCII
- `f` — File transfer protocol (basic, no error correction)
- `t` — TCP-based (assumes reliable transport)

### UUCP 'g' Protocol (DLE+S Variant)

Some servers use DLE+S framing instead of plain text:

**Server greeting:** `0x10 0x53` + `here-hostname\0` (DLE + 'S' byte prefix)

**Packet framing:** All packets prefixed with DLE (0x10), followed by packet type

**Types:**
- `0x10 0x53` — System name (S)
- `0x10 0x52` — Response (R)
- `0x10 0x50` — Protocol negotiation (P)

**This implementation detects DLE+S in `/api/uucp/handshake` endpoint.**

## Implementation Details

This implementation provides **two API endpoints** for UUCP service detection:

### 1. `/api/uucp/probe` — Standard UUCP Handshake

**Purpose:** Perform full UUCP handshake (wakeup, greeting, identity exchange, accept/reject).

**Request:**
```json
{
  "host": "uucp.example.com",
  "port": 540,
  "systemName": "probe",
  "timeout": 10000
}
```

**Parameters:**
- `host` (required) — Target hostname or IP address
- `port` (optional, default 540) — TCP port number (1-65535)
- `systemName` (optional, default "probe") — Client system name (alphanumeric + hyphen, max 32 chars)
- `timeout` (optional, default 10000) — Connection timeout in milliseconds (1000-300000)

**Response (success):**
```json
{
  "success": true,
  "host": "uucp.example.com",
  "port": 540,
  "tcpLatency": 142,
  "isUUCPServer": true,
  "serverSystem": "oldhost",
  "serverGreeting": "Shere-oldhost\u0000",
  "handshakeResult": "ROK",
  "note": "UUCP (Unix-to-Unix Copy) is a historical file transfer protocol from the pre-internet era (1970s–1990s).",
  "security": "NONE — UUCP transmits in plaintext with trust-based authentication. Use SFTP or SCP instead."
}
```

**Response Fields:**
- `success` (boolean) — Handshake succeeded
- `host` (string) — Queried hostname
- `port` (number) — Queried port
- `tcpLatency` (number) — TCP handshake time in milliseconds
- `isUUCPServer` (boolean) — Server sent valid UUCP greeting (starts with 'S')
- `serverSystem` (string, optional) — Extracted server system name (with "here" prefix stripped)
- `serverGreeting` (string, optional) — Raw server greeting (control chars shown as `\x00`)
- `handshakeResult` (string, optional) — Server accept/reject response (`ROK`, `RLOGIN`, `RLOCKED`, etc.)
- `note` (string) — Educational context
- `security` (string) — Security warning

**Response (error):**
```json
{
  "success": false,
  "error": "Connection timeout"
}
```

**Use Case:** Detect legacy UUCP servers, verify trust configuration, test network connectivity to port 540.

### 2. `/api/uucp/handshake` — Advanced Protocol Detection

**Purpose:** Detect UUCP protocol variant (DLE+S framing vs plaintext) and distinguish from login-gated services.

**Request:**
```json
{
  "host": "legacy.example.com",
  "port": 540,
  "timeout": 15000
}
```

**Parameters:**
- `host` (required) — Target hostname or IP address
- `port` (optional, default 540) — TCP port number (1-65535)
- `timeout` (optional, default 10000) — Connection timeout in milliseconds (1000-300000)

**Response (UUCP 'g' protocol with DLE framing):**
```json
{
  "success": true,
  "banner": "<0x10>Shere-oldhost<0x00> → ROK",
  "loginRequired": false,
  "latencyMs": 156,
  "remoteSite": "oldhost",
  "protocolVersion": "UUCP-g"
}
```

**Response (plaintext UUCP):**
```json
{
  "success": true,
  "banner": "Shere-myhost<0x00>",
  "loginRequired": false,
  "latencyMs": 98
}
```

**Response (login required):**
```json
{
  "success": true,
  "banner": "login: → Password:",
  "loginRequired": true,
  "latencyMs": 203
}
```

**Response Fields:**
- `success` (boolean) — Connection succeeded
- `banner` (string) — Server response with control chars shown as `<0xNN>`
- `loginRequired` (boolean) — Server requires login authentication (not raw UUCP)
- `latencyMs` (number) — Round-trip time in milliseconds
- `remoteSite` (string, optional) — Extracted system name from DLE+S greeting
- `protocolVersion` (string, optional) — Protocol variant detected (`"UUCP-g"`)

**Use Case:** Fingerprint UUCP implementation (Taylor UUCP with 'g' protocol, HoneyDanBer, login wrapper), distinguish UUCP from generic telnet/SSH on port 540.

## Protocol Detection Logic

### DLE+S Detection

```typescript
if (rawBytes.length >= 2 && rawBytes[0] === 0x10 && rawBytes[1] === 0x53) {
  // UUCP 'g' protocol with DLE framing
  protocolVersion = 'UUCP-g';
  // Extract system name from DLE+S{name}\0
  // Send DLE+Sprobe\0 response
}
```

**Why check length >= 2?** Prevent buffer overrun on single-byte responses.

**Why check both bytes?** DLE alone (0x10) could be noise; DLE+S (0x10 0x53) is UUCP-specific.

### Login Prompt Detection

```typescript
if (/login:/i.test(displayBanner) || /password:/i.test(displayBanner)) {
  loginRequired = true;
  // Send "uucp\n" username, read password prompt
}
```

**Regex runs on displayBanner (sanitized) instead of rawText to avoid false positives from binary data.**

### System Name Extraction

```typescript
const nullIdx = rawText.indexOf('\0');
const nameField = nullIdx > 1 ? rawText.slice(2, nullIdx) : rawText.slice(2);
serverSystem = nameField.replace(/^here-?/, '') || nameField;
```

**Examples:**
- `Shere-oldhost\0` → `oldhost`
- `Shere\0` → `` (empty string)
- `Smyhost\0` → `myhost`

## Security Considerations

### 1. No Encryption

**Risk:** All data (filenames, content, passwords if used) transmitted in plaintext.

**Attack:** Man-in-the-middle can read/modify any UUCP traffic.

**Mitigation:** Never use UUCP over untrusted networks. Use SSH/SFTP instead.

### 2. Trust-Based Authentication

**Risk:** Server accepts connections from any client claiming to be an authorized system name.

**Attack:** Attacker can impersonate legitimate UUCP site by sending `S{trustedname}\0`.

**Example:**
```
# Legitimate: Sstandford\0 → ROK
# Attacker:  Sstandford\0 → ROK (same result!)
```

**Mitigation:** UUCP security relies on IP-based ACLs (`/etc/uucp/Systems` file). Port 540 should be firewalled to trusted IPs only.

### 3. Command Execution

**Risk:** UUCP protocol includes `X` command for remote execution (e.g., `rmail`, `rnews`).

**Attack:** If server allows arbitrary commands, attacker can execute shell code.

**Historical Exploit:** `uux` command allowed users to run commands on remote systems, often abused for privilege escalation.

**Mitigation:** Modern UUCP implementations restrict execution to whitelisted commands. Legacy systems should be isolated.

### 4. Information Disclosure

**Risk:** Server greeting reveals system name, UUCP version, sometimes OS details.

**Reconnaissance:** Attacker can fingerprint system without authentication.

**Example:**
```
Shere-sun4-solaris8\0  → SunOS 4.x or Solaris 8
Shere-linux-taylor\0   → Taylor UUCP on Linux
```

**Mitigation:** Disable UUCP daemon (`uucpd`) on internet-facing systems. Block port 540 at firewall.

### 5. Denial of Service

**Risk:** UUCP servers often allow unlimited connection attempts, large file transfers.

**Attack:** Flood server with connections, exhaust disk space with fake jobs.

**Mitigation:** Rate limiting, connection limits, disk quotas.

### 6. Relay Abuse

**Risk:** UUCP's store-and-forward model allows using intermediate sites as relays.

**Historical Issue:** Open UUCP relays used for spam in 1980s-1990s (similar to open SMTP relays).

**Example:**
```
alice!bob!spammer!victim  (alice and bob unwittingly relay spam)
```

**Mitigation:** Configure UUCP to only accept mail for local users, block relay paths.

## Resource Management and Bug Fixes

### Fixed Bugs (2026-02-18)

#### 1. Timeout Handle Leaks

**Bug:** Timeout promises created with `setTimeout()` but never cleared with `clearTimeout()`.

**Impact:** Worker holds orphaned timers, potential memory leak, timeouts firing after completion.

**Old Code:**
```typescript
const timeoutPromise = new Promise<never>((_, reject) =>
  setTimeout(() => reject(new Error('Connection timeout')), timeout)
);
// No clearTimeout() — timer runs forever or until Worker restart
```

**Fix:**
```typescript
let timeoutHandle: number | undefined;
const timeoutPromise = new Promise<never>((_, reject) => {
  timeoutHandle = setTimeout(() => {
    socket.close();
    reject(new Error('Connection timeout'));
  }, timeout) as unknown as number;
});

try {
  // ... work ...
} finally {
  if (timeoutHandle !== undefined) {
    clearTimeout(timeoutHandle);
  }
}
```

**Now clears timeout in all code paths (success, error, timeout).**

#### 2. Reader/Writer Lock Cleanup

**Bug:** Locks acquired but not released in error paths (throws "ReadableStream locked" on retry).

**Old Code:**
```typescript
const writer = socket.writable.getWriter();
const reader = socket.readable.getReader();
// ... error occurs ...
throw error;  // Locks never released!
```

**Fix:**
```typescript
try {
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  // ... work ...
} catch (error) {
  try { writer.releaseLock(); } catch { /* ignore */ }
  try { reader.releaseLock(); } catch { /* ignore */ }
  throw error;
}
```

**Wrapped all lock releases in try-catch to suppress "already released" exceptions.**

#### 3. Duplicate Socket Close

**Bug:** `socket.close()` called in both try block and catch block, causing "Socket already closed" error.

**Old Code:**
```typescript
try {
  // ... work ...
  socket.close();
} catch (error) {
  socket.close();  // Called again!
  throw error;
}
```

**Fix:**
```typescript
try {
  // ... work ...
} finally {
  socket.close();  // Called exactly once
}
```

**Moved socket.close() to finally block for single execution point.**

#### 4. Input Validation Gaps

**Bug:** No validation for `timeout` parameter (could be negative or excessively large).

**Risk:** Negative timeout causes instant rejection, huge timeout ties up worker for hours.

**Fix:**
```typescript
if (timeout < 1000 || timeout > 300000) {
  return new Response(
    JSON.stringify({ success: false, error: 'Timeout must be between 1000 and 300000 ms' }),
    { status: 400, headers: { 'Content-Type': 'application/json' } }
  );
}
```

**Added bounds: 1-300 seconds (Workers have 50s CPU limit, 300s wall-clock limit).**

#### 5. Missing Port Validation in `/api/uucp/handshake`

**Bug:** Port validation only in `/api/uucp/probe`, not `/api/uucp/handshake`.

**Risk:** Port 0 or 70000 passed through, causes connection error instead of validation error.

**Fix:** Added port range check (1-65535) to both endpoints.

#### 6. System Name Character Validation

**Bug:** Accepted underscores in system names (`/[^a-zA-Z0-9_-]/g`).

**Issue:** Traditional UUCP system names only allow alphanumeric and hyphen (no underscore).

**Impact:** Some legacy servers reject names with underscores, causing handshake failure.

**Fix:**
```typescript
// Old: systemName.replace(/[^a-zA-Z0-9_-]/g, '')
// New: systemName.replace(/[^a-zA-Z0-9-]/g, '')
```

#### 7. Unsafe Regex on Binary Data

**Bug:** `/login:/i.test(rawText)` regex on binary data could match random bytes (e.g., `0x6C 0x6F 0x67 0x69 0x6E` in binary stream).

**Fix:** Run regex on `displayBanner` (sanitized with control chars escaped) instead of `rawText`.

**Before:**
```typescript
if (/login:/i.test(rawText)) { ... }  // rawText may contain binary garbage
```

**After:**
```typescript
const displayBanner = rawText.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, c => `<0x${...}>`);
if (/login:/i.test(displayBanner)) { ... }  // Safe — control chars escaped
```

## Performance Characteristics

### Latency Breakdown

Typical RTT for successful UUCP handshake over Internet:

```
Total RTT: 250ms
  ├─ DNS resolution: 30ms        (not measured)
  ├─ TCP handshake: 80ms         (SYN → SYN-ACK → ACK)
  ├─ Wakeup send: 40ms           (client → server)
  ├─ Server greeting: 50ms       (server → client)
  ├─ Client identity: 40ms       (client → server)
  └─ Accept/reject: 10ms         (server → client)
```

**Measured `tcpLatency`:** TCP handshake only (`socket.opened` time).

**Measured `latencyMs`:** Full handshake (wakeup through final response).

### Timeout Tuning

**Default:** 10000ms (10 seconds)

**Recommended adjustments:**
- **LAN:** 2000ms (low latency, fast failure detection)
- **Internet:** 10000ms (handles packet loss, retransmissions)
- **Dial-up/satellite:** 30000ms (high latency links)
- **Security scanning:** 5000ms (fail fast, move to next host)

**Worker limits:**
- CPU time: 50 seconds (script execution timeout)
- Wall-clock time: 300 seconds (connection timeout)
- Setting timeout >50s risks CPU limit hit before network timeout

### Concurrency

**No built-in rate limiting.** Each request consumes:
- 1 TCP socket (connects to external host)
- 1 ReadableStream reader
- 1 WritableStream writer
- 3-5 `setTimeout` timers (connection + multiple read phases)

**Recommended limits:**
- Per-IP rate limit: 20 requests/minute
- Global rate limit: 200 requests/minute
- Concurrent connections: 100 max

Implement via Cloudflare Rate Limiting rules or Worker KV-based throttling.

## Testing and Validation

### Test Servers

**No public UUCP servers exist.** Must create local test environment.

#### 1. Netcat Simple Server

```bash
# Terminal 1: Listen on port 540, send UUCP greeting
while true; do
  echo -ne 'Shere-testhost\0ROK\0' | nc -l -p 540
done

# Terminal 2: Test probe endpoint
curl -X POST http://localhost:8787/api/uucp/probe \
  -H "Content-Type: application/json" \
  -d '{"host":"127.0.0.1","port":540,"timeout":5000}'
```

**Expected response:**
```json
{
  "success": true,
  "tcpLatency": 5,
  "isUUCPServer": true,
  "serverSystem": "testhost",
  "serverGreeting": "Shere-testhost\u0000",
  "handshakeResult": "ROK"
}
```

#### 2. Python UUCP Server Simulator

```python
#!/usr/bin/env python3
import socket, time

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('0.0.0.0', 540))
s.listen(5)
print("UUCP server listening on port 540...")

while True:
    conn, addr = s.accept()
    print(f"Connection from {addr}")

    # Read wakeup sequence
    wakeup = conn.recv(2)
    print(f"Received wakeup: {wakeup.hex()}")

    # Send server greeting
    conn.sendall(b'Shere-pythonhost\0')
    time.sleep(0.1)

    # Read client identity
    ident = conn.recv(64)
    print(f"Received identity: {ident}")

    # Send accept
    conn.sendall(b'ROK\0')
    time.sleep(0.1)

    conn.close()
```

**Run:**
```bash
sudo python3 uucp_server.py  # Requires root for port 540
```

#### 3. UUCP 'g' Protocol Server (DLE+S)

```python
#!/usr/bin/env python3
import socket

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('0.0.0.0', 540))
s.listen(5)
print("UUCP 'g' protocol server listening on port 540...")

while True:
    conn, addr = s.accept()
    print(f"Connection from {addr}")

    # Read wakeup
    conn.recv(2)

    # Send DLE+S greeting
    conn.sendall(b'\x10Shere-gproto\0')

    # Read DLE+S response
    resp = conn.recv(64)
    print(f"Received: {resp.hex()}")

    # Send ROK with DLE prefix
    conn.sendall(b'\x10ROK\0')

    conn.close()
```

**Test:**
```bash
curl -X POST http://localhost:8787/api/uucp/handshake \
  -H "Content-Type: application/json" \
  -d '{"host":"127.0.0.1","port":540}'
```

**Expected:**
```json
{
  "success": true,
  "banner": "<0x10>Shere-gproto<0x00> → <0x10>ROK<0x00>",
  "loginRequired": false,
  "remoteSite": "gproto",
  "protocolVersion": "UUCP-g"
}
```

#### 4. Login-Gated Server

```bash
# Use telnetd or custom Python server
while true; do
  echo -ne 'login: ' | nc -l -p 540
done
```

**Test:**
```bash
curl -X POST http://localhost:8787/api/uucp/handshake \
  -H "Content-Type: application/json" \
  -d '{"host":"127.0.0.1","port":540}'
```

**Expected:**
```json
{
  "success": true,
  "banner": "login: → Password:",
  "loginRequired": true
}
```

### Error Cases

#### Connection Timeout
```bash
curl -X POST http://localhost:8787/api/uucp/probe \
  -H "Content-Type: application/json" \
  -d '{"host":"192.0.2.1","port":540,"timeout":2000}'
```
**Response (after 2s):**
```json
{
  "success": false,
  "error": "Connection timeout"
}
```

#### Connection Refused
```json
{
  "success": false,
  "error": "Connection refused"
}
```

#### Invalid Port
```bash
curl -X POST http://localhost:8787/api/uucp/probe \
  -H "Content-Type: application/json" \
  -d '{"host":"example.com","port":99999}'
```
**Response:**
```json
{
  "success": false,
  "error": "Port must be between 1 and 65535"
}
```

#### Invalid Timeout
```json
{
  "success": false,
  "error": "Timeout must be between 1000 and 300000 ms"
}
```

## Troubleshooting

### "Connection timeout" on Known UUCP Server

**Causes:**
1. Firewall blocks port 540
2. Server behind NAT/proxy without port forwarding
3. Server hostname resolves but host down
4. Network latency exceeds timeout

**Diagnosis:**
```bash
# Test raw TCP connectivity
nc -zv uucp.example.com 540

# Test with telnet
telnet uucp.example.com 540

# Check if port open from external network
nmap -p 540 uucp.example.com

# Increase timeout
curl -X POST ... -d '{"host":"...","timeout":30000}'
```

### "isUUCPServer: false" but Connection Succeeds

**Causes:**
1. Server sends data not starting with 'S' (e.g., login prompt, banner)
2. Server expects different wakeup sequence
3. Server uses non-standard UUCP variant

**Diagnosis:** Use `/api/uucp/handshake` to see raw banner:
```bash
curl -X POST http://localhost:8787/api/uucp/handshake \
  -H "Content-Type: application/json" \
  -d '{"host":"mystery.example.com","port":540}'
```

**If banner shows login prompt:**
```json
{ "banner": "login: ", "loginRequired": true }
```
Server requires authentication, not direct UUCP.

**If banner shows non-UUCP data:**
```json
{ "banner": "SSH-2.0-OpenSSH_8.2" }
```
Wrong service on port 540 (SSH on unusual port).

### Empty `serverSystem` Despite UUCP Greeting

**Cause:** Server sends `Shere\0` (just "here" with no hostname).

**Example:**
```
serverGreeting: "Shere\u0000"
serverSystem: ""  (empty string)
```

**Not a bug:** Some old UUCP servers don't include hostname in greeting.

### `handshakeResult` Undefined

**Cause:** Server accepted connection but didn't send accept/reject response within 2-second timeout.

**Diagnosis:** Server may be waiting for additional input (protocol negotiation).

**Workaround:** Not an error — handshake succeeded if `isUUCPServer: true`.

### Reader/Writer Lock Errors (Fixed in v2)

**Old error:** "ReadableStream is locked to a reader"

**Cause:** Previous request threw exception without releasing locks.

**Fixed:** All lock releases wrapped in try-catch, executed in error paths.

### Double Socket Close Errors (Fixed in v2)

**Old error:** "Socket already closed"

**Cause:** `socket.close()` called in both try and catch blocks.

**Fixed:** Moved to finally block for single execution.

## Advanced Usage

### Scanning Legacy UUCP Servers

**Scenario:** Audit network for forgotten UUCP daemons.

```javascript
const subnets = ['192.168.1.', '10.0.0.'];
const results = [];

for (const subnet of subnets) {
  for (let i = 1; i < 255; i++) {
    const host = `${subnet}${i}`;
    const response = await fetch('https://worker.example.com/api/uucp/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port: 540, timeout: 2000 })
    }).then(r => r.json());

    if (response.success && response.isUUCPServer) {
      results.push({ host, system: response.serverSystem });
      console.log(`FOUND: ${host} → ${response.serverSystem}`);
    }
  }
}

console.log(`Total UUCP servers found: ${results.length}`);
```

### Fingerprinting UUCP Implementation

**Identify Taylor UUCP vs HoneyDanBer vs BNU:**

```javascript
const response = await fetch('https://worker.example.com/api/uucp/handshake', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ host: 'uucp.example.com', port: 540 })
}).then(r => r.json());

if (response.protocolVersion === 'UUCP-g') {
  console.log('Implementation: Taylor UUCP (g protocol support)');
} else if (response.banner.includes('here-')) {
  console.log('Implementation: Likely Taylor UUCP (hostname in greeting)');
} else if (response.banner === 'Shere<0x00>') {
  console.log('Implementation: HoneyDanBer or BNU (minimal greeting)');
} else if (response.loginRequired) {
  console.log('Implementation: UUCP wrapped in login (getty/uugetty)');
}
```

### Historical Data Collection

**Store UUCP server discoveries in Cloudflare KV:**

```javascript
// Worker binding: UUCP_HISTORY
async function logUUCPDiscovery(env, host, data) {
  const timestamp = new Date().toISOString();
  const key = `uucp:${host}:${timestamp}`;
  await env.UUCP_HISTORY.put(key, JSON.stringify(data), {
    expirationTtl: 86400 * 365  // 1 year retention
  });
}

// Query history
const discoveries = await env.UUCP_HISTORY.list({ prefix: 'uucp:' });
const timeline = await Promise.all(
  discoveries.keys.map(k => env.UUCP_HISTORY.get(k.name, 'json'))
);

console.log(`Historical UUCP servers tracked: ${timeline.length}`);
```

### Integration with Network Monitoring

**Prometheus exporter for UUCP service monitoring:**

```javascript
async function handleMetrics(request, env) {
  const hosts = ['uucp1.example.com', 'uucp2.example.com'];
  const metrics = [];

  for (const host of hosts) {
    const response = await fetch('http://localhost:8787/api/uucp/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port: 540, timeout: 5000 })
    }).then(r => r.json());

    const up = response.success && response.isUUCPServer ? 1 : 0;
    metrics.push(`uucp_server_up{host="${host}"} ${up}`);
    metrics.push(`uucp_tcp_latency_ms{host="${host}"} ${response.tcpLatency || 0}`);
  }

  return new Response(metrics.join('\n'), {
    headers: { 'Content-Type': 'text/plain' }
  });
}
```

**Grafana query:**
```promql
uucp_server_up{host="uucp1.example.com"}
```

## Modern Alternatives

UUCP is obsolete. Use these instead:

### File Transfer
- **SFTP/SCP:** Encrypted file transfer over SSH
- **rsync:** Efficient delta synchronization
- **HTTP(S):** Web-based file transfer
- **Cloud storage:** S3, Google Drive, Dropbox

### Email Routing
- **SMTP:** Internet standard email protocol
- **Postfix/Exim:** Modern mail transfer agents
- **Cloud email:** Gmail, Office 365, SendGrid

### Remote Execution
- **SSH:** Encrypted remote shell
- **Ansible:** Configuration management
- **Kubernetes:** Container orchestration
- **Cloud Functions:** Serverless execution

### News Distribution
- **NNTP:** Usenet protocol (still used, but declining)
- **RSS/Atom:** Web feed syndication
- **ActivityPub:** Federated social networks (Mastodon)

## References

### Historical Documents
- [UUCP Implementation Description](https://www.tuhs.org/Archive/Documentation/UUCP/) (1978)
- [HoneyDanBer UUCP Internals](http://www.kohala.com/start/uucp/) (1983)
- [Taylor UUCP Documentation](https://www.gnu.org/software/uucp/uucp.html) (1987-1995)

### Protocol Specifications
- Port 540 registered in [IANA Service Name Registry](https://www.iana.org/assignments/service-names-port-numbers/service-names-port-numbers.xhtml?search=540)
- [UUCP File Formats](http://www.kohala.com/start/uucp.html) (System, Permissions, Devices files)

### Security Research
- [CERT Advisory CA-1991-04: UUCP Vulnerability](https://www.kb.cert.org/vuls/id/867801/) (1991)
- [SANS: Obsolete Network Services](https://www.sans.org/reading-room/whitepapers/protocols/obsolete-network-services-35920) (2015)

### Modern Context
- [The Death of UUCP](https://web.archive.org/web/20070927190048/http://www.interesting-people.org/archives/interesting-people/199702/msg00036.html) (1997)
- [UUCP Nostalgia in 2020](https://www.usenix.org/publications/login/fall2020/uucp) (USENIX ;login:)

### Tools
- **cu:** Call Unix (UUCP dial-out client)
- **uucp:** File copy command
- **uux:** Remote execution command
- **uustat:** UUCP status
- **Taylor UUCP:** Last maintained UUCP implementation (GNU)

## Changelog

### Version 2 (2026-02-18) — Security and Reliability Fixes

**Critical Fixes:**
- **RESOURCE LEAK:** Fixed timeout handles not cleared — replaced `timeoutPromise` with `timeoutHandle` and added `clearTimeout()` in finally blocks for both endpoints
- **RESOURCE LEAK:** Fixed reader/writer locks not released in error paths — wrapped all cleanup in try/finally with exception suppression
- **BUG:** Fixed duplicate `socket.close()` calls — moved to finally block only
- **INPUT VALIDATION:** Added timeout bounds validation (1000-300000ms) to both endpoints
- **INPUT VALIDATION:** Added port validation (1-65535) to `/api/uucp/handshake` (was missing)
- **PROTOCOL VIOLATION:** Fixed system name character validation — removed underscore from allowed chars (traditional UUCP uses alphanumeric + hyphen only)
- **SECURITY:** Fixed unsafe regex on binary data — run login detection on sanitized `displayBanner` instead of raw `rawText`
- **BUG:** Fixed DLE+S protocol detection — added length check (`rawBytes.length >= 2`) before accessing second byte

**Improvements:**
- Consistent error handling across both endpoints
- Timeout cleanup on all code paths (success, error, timeout)
- Better protocol detection for UUCP 'g' vs plaintext variants

### Version 1 (Initial)
- Implemented `/api/uucp/probe` endpoint (full UUCP handshake)
- Implemented `/api/uucp/handshake` endpoint (protocol variant detection)
- Support for traditional UUCP (plaintext) and UUCP 'g' (DLE+S framing)
- Login prompt detection for wrapped UUCP services
- System name extraction and trust-based handshake
