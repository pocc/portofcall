# PJLink — Power-User Reference

**Port:** 4352 (default) | **Protocol:** Text-based TCP | **Standard:** JBMiA PJLink Class 1
**Implementation:** `src/worker/pjlink.ts` | **Routes:** Two endpoints for probe and power control

PJLink is a unified standard for controlling projectors and displays over IP, defined by JBMiA (Japan Business Machine and Information System Industries Association). Port of Call implements the telnet-style text protocol for device discovery, status monitoring, and power control.

---

## API Endpoints

### `POST /api/pjlink/probe` — Full device probe

Connects to a PJLink device, handles authentication if required, and queries all available information: device identity (name, manufacturer, product), power status, lamp hours, error status, available inputs, current input, and AV mute state.

**Request:**
```json
{
  "host": "projector.example.com",
  "port": 4352,
  "timeout": 10000,
  "password": "secret123"
}
```

| Field     | Required | Default | Notes |
|-----------|----------|---------|-------|
| `host`    | Yes      | —       | Hostname or IP address. Trimmed, cannot be empty. |
| `port`    | No       | `4352`  | Port number. Valid range: 1-65535. |
| `timeout` | No       | `10000` | Total timeout in milliseconds. Valid range: 1-300000. |
| `password`| No       | `""`    | MD5-hashed password for PJLink Class 1 authentication. |

**Success response (no auth):**
```json
{
  "success": true,
  "host": "projector.example.com",
  "port": 4352,
  "rtt": 142,
  "authRequired": false,
  "authenticated": true,
  "projectorInfo": {
    "name": "Conference Room A",
    "manufacturer": "Epson",
    "productName": "EB-2250U",
    "otherInfo": "v1.2.3",
    "class": "1",
    "powerStatus": "Power On",
    "lampHours": [
      { "hours": 1234, "on": true },
      { "hours": 567, "on": false }
    ],
    "errorStatus": {
      "fan": "OK",
      "lamp": "OK",
      "temperature": "OK",
      "coverOpen": "OK",
      "filter": "Warning",
      "other": "OK"
    },
    "inputs": ["11", "21", "31", "32"],
    "currentInput": "11",
    "avMute": "Video & audio mute off"
  }
}
```

**Success response (auth required, password provided):**
```json
{
  "success": true,
  "host": "projector.example.com",
  "port": 4352,
  "rtt": 187,
  "authRequired": true,
  "authenticated": true,
  "projectorInfo": { ... }
}
```

**Success response (auth required, no password):**
```json
{
  "success": true,
  "host": "projector.example.com",
  "port": 4352,
  "rtt": 95,
  "authRequired": true,
  "authenticated": false,
  "error": "Authentication required but no password provided"
}
```

**Error responses:**

| HTTP | Condition |
|------|-----------|
| 400  | `"Host is required"` — host missing or empty string |
| 400  | `"Port must be between 1 and 65535"` |
| 400  | `"Timeout must be between 1 and 300000 milliseconds"` |
| 403  | Cloudflare IP detected (includes `isCloudflare: true`) |
| 500  | `"Connection timeout"` or network error |
| 500  | `"Unexpected greeting: ..."` — server sent non-PJLink response |

**Notes:**
- `authenticated` is initially false when auth is required. It becomes true after the first successful command response.
- If authentication fails (server returns ERRA), `authenticated` remains false but the probe continues querying other commands.
- Queries are sent sequentially, not in parallel. RTT includes time for all queries.
- If a query fails (returns ERR1/ERR2/ERR3/ERR4), that field is omitted from `projectorInfo`.

---

### `POST /api/pjlink/power` — Power control

Sends a power command (on/off/query) to a PJLink device. This is a lightweight alternative to `/probe` when you only need power status or want to control power state.

**Request:**
```json
{
  "host": "projector.example.com",
  "port": 4352,
  "timeout": 10000,
  "password": "secret123",
  "action": "query"
}
```

| Field     | Required | Default   | Notes |
|-----------|----------|-----------|-------|
| `host`    | Yes      | —         | Hostname or IP address. |
| `port`    | No       | `4352`    | Port number. Valid range: 1-65535. |
| `timeout` | No       | `10000`   | Total timeout in milliseconds. Valid range: 1-300000. |
| `password`| No       | `""`      | MD5-hashed password for authentication. |
| `action`  | No       | `"query"` | One of: `"on"`, `"off"`, `"query"` |

**Success response:**
```json
{
  "success": true,
  "host": "projector.example.com",
  "port": 4352,
  "rtt": 78,
  "action": "query",
  "powerStatus": "Power On"
}
```

**Error response (PJLink error):**
```json
{
  "success": false,
  "host": "projector.example.com",
  "port": 4352,
  "rtt": 82,
  "error": "PJLink error: ERR3"
}
```

**Error codes:**

| Code  | Meaning |
|-------|---------|
| ERR1  | Undefined command |
| ERR2  | Out of parameter (invalid parameter value) |
| ERR3  | Unavailable time (command cannot be executed now, e.g., powering on while cooling) |
| ERR4  | Projector/display failure |
| ERRA  | Authentication error (wrong password or missing auth) |

**Power states:**

| Value | State        | Notes |
|-------|--------------|-------|
| 0     | Standby      | Device is off |
| 1     | Power On     | Device is fully on |
| 2     | Cooling Down | Device is shutting down (lamp cooling) |
| 3     | Warming Up   | Device is starting up (lamp warming) |

---

## Wire Protocol

### Greeting Exchange

**Connection flow:**
```
Client                          PJLink Device (:4352)
  │                                    │
  │──── TCP SYN ──────────────────────▶│
  │◀─── SYN-ACK ──────────────────────│
  │──── ACK ───────────────────────────▶│
  │                                    │
  │◀─── "PJLINK 0\r" ─────────────────│  (no auth)
  │                                    │
  │──── "%1POWR ?\r" ──────────────────▶│
  │◀─── "%1POWR=1\r" ──────────────────│
  │                                    │
  │──── close ─────────────────────────▶│
```

**With authentication:**
```
Client                          PJLink Device (:4352)
  │                                    │
  │◀─── "PJLINK 1 a3f8b2c1\r" ────────│  (auth required)
  │                                    │
  │ Compute: MD5("a3f8b2c1" + "password")
  │         = "5d41402abc4b2a76b9719d911017c592"
  │                                    │
  │──── "5d41402abc4b2a76b9719d911017c592%1POWR ?\r" ─▶│
  │◀─── "%1POWR=1\r" ──────────────────│
```

### Greeting Format

**No authentication (PJLINK 0):**
```
PJLINK 0\r
```

**Authentication required (PJLINK 1):**
```
PJLINK 1 <random>\r
```
- `<random>`: 8 random bytes (16 hex characters), used as salt for MD5 hash

### Command Format

**Class 1 query command:**
```
[<auth_hash>]%1<CMD> ?<CR>
```

**Class 1 set command:**
```
[<auth_hash>]%1<CMD> <param><CR>
```

**Where:**
- `<auth_hash>`: 32-character MD5 hash (only if PJLINK 1 greeting received)
- `%1`: Class 1 prefix
- `<CMD>`: 4-character command name (e.g., POWR, NAME, INPT)
- `?`: Query parameter (retrieves current value)
- `<param>`: Set parameter (changes value)
- `<CR>`: Carriage return (`\r`)

### Response Format

**Success:**
```
%1<CMD>=<value>\r
```

**Error:**
```
%1<CMD>=ERR<n>\r
```

---

## PJLink Commands (Class 1)

| Command | Type    | Description | Query Response | Set Parameters |
|---------|---------|-------------|----------------|----------------|
| `POWR`  | Query/Set | Power status | `0`, `1`, `2`, `3` | `0` (off), `1` (on) |
| `INPT`  | Query/Set | Input selection | `11`, `21`, `31`, etc. | Input code (e.g., `31`) |
| `AVMT`  | Query/Set | AV mute | `10`-`31` (see below) | Mute code |
| `ERST`  | Query | Error status | 6-character string | — |
| `LAMP`  | Query | Lamp hours | `<hours> <on> ...` | — |
| `INST`  | Query | Input list | Space-separated codes | — |
| `NAME`  | Query | Projector name | Free text | — |
| `INF1`  | Query | Manufacturer | Free text | — |
| `INF2`  | Query | Product name | Free text | — |
| `INFO`  | Query | Other info | Free text | — |
| `CLSS`  | Query | Class info | `1` or `2` | — |

### Input Codes

Format: `<type><number>`

**Input types:**
- `1x`: RGB (VGA, component)
- `2x`: Video (composite, S-video)
- `3x`: Digital (DVI, HDMI, DisplayPort)
- `4x`: Storage (USB, SD card)
- `5x`: Network

**Examples:**
- `11`: RGB 1 (VGA input 1)
- `21`: Video 1 (Composite)
- `31`: Digital 1 (HDMI 1)
- `32`: Digital 2 (HDMI 2)

### AV Mute Codes

| Code | Meaning |
|------|---------|
| `10` | Video mute off |
| `11` | Video mute on |
| `20` | Audio mute off |
| `21` | Audio mute on |
| `30` | Video & audio mute off |
| `31` | Video & audio mute on |

### Error Status Format

6-character string, one digit per error category:

```
Position: 0      1      2         3        4       5
Category: Fan    Lamp   Temp      Cover    Filter  Other
Value:    0/1/2  0/1/2  0/1/2     0/1/2    0/1/2   0/1/2
```

**Values:**
- `0`: OK
- `1`: Warning
- `2`: Error

**Example:** `000010` = Fan OK, Lamp OK, Temp OK, Cover OK, Filter Warning, Other OK

### Lamp Hours Format

Space-separated pairs: `<hours> <on_status> [<hours> <on_status> ...]`

**Example:** `1234 1 567 0`
- Lamp 1: 1234 hours, currently on (`1`)
- Lamp 2: 567 hours, currently off (`0`)

---

## Known Quirks and Limitations

### 1. Duplicate timeout logic (FIXED)

**BUG FIX APPLIED:** Original code created two timeout timers per request — one inside the connection promise (`timeoutPromise`) and one at the outer level (`globalTimeout`). This was redundant and caused both timers to race. Now both timers are properly managed with handles and cleared on completion or error.

### 2. Resource leak — timeouts not cleared (FIXED)

**SECURITY FIX APPLIED:** Original code never called `clearTimeout()`, causing timeout callbacks to accumulate in the event loop. Now all timeouts are cleared in both success and error paths using try-catch wrappers to prevent exceptions during cleanup.

### 3. Authentication status set prematurely (FIXED)

**BUG FIX APPLIED:** Original code set `authenticated = true` immediately after computing the MD5 hash, before actually testing if the authentication worked. Now authentication status is determined by the first command response — if the server returns ERRA, `authenticated` remains false.

### 4. Lock release on early return (FIXED)

**BUG FIX APPLIED:** When authentication is required but no password is provided, the code released locks and closed the socket, then returned early. This was inside the try block, causing the catch block to attempt double-release. Now all lock releases are wrapped in try-catch.

### 5. Command format inconsistency (FIXED)

**BUG FIX APPLIED:** Original code appended `\r` to the command string, then immediately removed it with `.replace(/\r$/, '')`. This was confusing and error-prone. Now commands are constructed without trailing `\r`, and `sendCommand()` adds it consistently.

### 6. MD5 hash computation inefficiency (FIXED)

**BUG FIX APPLIED:** Original code created an unnecessary Uint8Array wrapper: `new Uint8Array(data)` where `data` was already a Uint8Array from TextEncoder. Removed redundant wrapper.

### 7. Input validation gaps (FIXED)

**BUG FIX APPLIED:** Original code did not validate that host is non-empty after trimming, and did not validate timeout bounds. Now validates:
- Host is not empty string (after trim)
- Port is 1-65535
- Timeout is 1-300000 milliseconds

### 8. No Cloudflare detection bypass

Unlike some other protocols, PJLink has no option to bypass Cloudflare detection. If the target host resolves to a Cloudflare IP, the request is rejected with HTTP 403.

### 9. Sequential queries

All queries in `/probe` are sent sequentially, not in parallel. This increases RTT but avoids overwhelming the device with simultaneous requests. Some projectors have slow response times (200-500ms per command).

### 10. No Class 2 support

Port of Call implements PJLink Class 1 only. Class 2 features (serial number query, input terminal names, advanced error reporting) are not supported.

### 11. No notification/status polling

PJLink Class 2 includes a notification feature where the device pushes status updates to the client. This implementation does not support notifications — it only handles request/response queries.

### 12. Lamp hours parsing assumes pairs

The `parseLampHours()` function assumes lamp data comes in pairs (hours, on_status). If the server sends an odd number of tokens, the last token is silently dropped. This matches standard PJLink behavior but could cause confusion if a device sends malformed data.

### 13. Error status parsing requires exactly 6 characters

If the ERST response contains fewer than 6 characters, the function returns `undefined` rather than partial status. This prevents misinterpreting truncated responses but loses any partial data.

### 14. No connection reuse

Each API call opens a fresh TCP connection. High-frequency polling (e.g., checking power status every second) creates connection overhead. PJLink devices may throttle or reject rapid connections.

### 15. Shared timeout across all operations

The `timeout` parameter covers TCP handshake, greeting exchange, authentication, and all queries. A slow handshake reduces time available for queries. For `/probe`, which sends 10+ queries, a 10-second timeout may be insufficient on slow networks.

### 16. No retry logic

If a single query fails (returns ERR3 — unavailable time), the implementation does not retry. The projector may be in a transient state (warming up, cooling down) where the command is temporarily unavailable.

### 17. Password sent in request body

The password is transmitted from the client to Port of Call in the JSON request body over HTTPS. This is secure (HTTPS encrypts the body), but the password is visible in the Worker's memory and logs. The actual PJLink wire protocol never transmits the password in plaintext — only the MD5 hash is sent.

### 18. No password storage or caching

Each request requires the password to be provided. Port of Call does not cache passwords or session tokens. This increases security (no password leakage between requests) but requires the client to store the password.

### 19. Input list parsing assumes space-separated

The `INST` response is split on spaces. If the server uses a different delimiter (comma, semicolon), parsing will fail silently, returning a single-element array.

### 20. Power state transitions not verified

When sending `action: "on"` or `action: "off"`, the implementation does not wait for the power state to change. The response returns immediately after the command is acknowledged. The projector may take 30-60 seconds to fully power on or cool down.

---

## Practical Examples

### curl

**Probe a projector (no auth):**
```bash
curl -s -X POST https://portofcall.ross.gg/api/pjlink/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100"}' | jq
```

**Probe with authentication:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/pjlink/probe \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "projector.example.com",
    "password": "JBMIAlink"
  }' | jq
```

**Check power status:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/pjlink/power \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "192.168.1.100",
    "action": "query"
  }' | jq -r '.powerStatus'
```

**Turn projector on:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/pjlink/power \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "192.168.1.100",
    "action": "on",
    "password": "secret"
  }' | jq
```

**Turn projector off:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/pjlink/power \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "192.168.1.100",
    "action": "off",
    "password": "secret"
  }' | jq
```

**Probe with custom timeout (30 seconds):**
```bash
curl -s -X POST https://portofcall.ross.gg/api/pjlink/probe \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "slow-projector.local",
    "timeout": 30000
  }' | jq
```

**Check if authentication is required (no password):**
```bash
curl -s -X POST https://portofcall.ross.gg/api/pjlink/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100"}' \
  | jq '{authRequired, authenticated, error}'
```

**Extract lamp hours:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/pjlink/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100"}' \
  | jq '.projectorInfo.lampHours'
```

**Extract error status:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/pjlink/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100"}' \
  | jq '.projectorInfo.errorStatus'
```

**Batch check multiple projectors:**
```bash
for ip in 192.168.1.{100..110}; do
  echo -n "$ip: "
  curl -s -X POST https://portofcall.ross.gg/api/pjlink/power \
    -H 'Content-Type: application/json' \
    -d "{\"host\":\"$ip\",\"action\":\"query\",\"timeout\":3000}" \
    | jq -r '.powerStatus // "offline"'
done
```

---

## JavaScript Example

```js
async function controlProjector(host, action, password = '') {
  const res = await fetch('https://portofcall.ross.gg/api/pjlink/power', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host, action, password }),
  });

  const result = await res.json();
  if (!result.success) {
    throw new Error(`PJLink error: ${result.error}`);
  }

  return result.powerStatus;
}

// Usage
const status = await controlProjector('192.168.1.100', 'query');
console.log(`Projector is: ${status}`);

// Turn on
await controlProjector('192.168.1.100', 'on', 'JBMIAlink');

// Turn off
await controlProjector('192.168.1.100', 'off', 'JBMIAlink');
```

**Full probe example:**
```js
async function probeProjector(host, password = '') {
  const res = await fetch('https://portofcall.ross.gg/api/pjlink/probe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host, password, timeout: 15000 }),
  });

  const result = await res.json();
  if (!result.success) {
    throw new Error(`Probe failed: ${result.error}`);
  }

  if (result.authRequired && !result.authenticated) {
    throw new Error('Authentication required but failed');
  }

  return result.projectorInfo;
}

// Usage
const info = await probeProjector('projector.example.com', 'secret');
console.log(`Device: ${info.manufacturer} ${info.productName}`);
console.log(`Power: ${info.powerStatus}`);
console.log(`Lamp hours: ${info.lampHours?.map(l => l.hours).join(', ')}`);
console.log(`Current input: ${info.currentInput}`);
console.log(`Filter status: ${info.errorStatus?.filter}`);
```

---

## Authentication

### Password Format

PJLink uses MD5 hashing for authentication. The server sends a random string (salt) in the greeting. The client concatenates the salt with the password and computes the MD5 hash:

```
auth_hash = MD5(random + password)
```

**Example:**
- Server greeting: `PJLINK 1 a3f8b2c1\r`
- Password: `JBMIAlink`
- Concatenate: `a3f8b2c1JBMIAlink`
- MD5 hash: `5d41402abc4b2a76b9719d911017c592`
- Command: `5d41402abc4b2a76b9719d911017c592%1POWR ?\r`

### Default Passwords

Many projectors ship with default PJLink passwords. Common defaults:

| Manufacturer | Default Password |
|--------------|------------------|
| Generic      | `JBMIAlink` |
| Epson        | (blank) or `admin` |
| Sony         | `sony` |
| Panasonic    | `panasonic` |
| NEC          | (blank) |
| BenQ         | (blank) or `0000` |

**Security note:** Always change default passwords in production environments.

### Disabling Authentication

Some projectors allow PJLink authentication to be disabled via the web UI or OSD menu. When disabled, the device sends `PJLINK 0\r` greeting (no authentication required).

---

## Well-Known Devices

PJLink is supported by most modern projectors and large displays from major manufacturers:

**Projector manufacturers:**
- Epson (EB, EH, EF series)
- Sony (VPL series)
- Panasonic (PT series)
- NEC (NP series)
- BenQ (MW, MH, LH series)
- Hitachi (CP series)
- Sharp (AN, XG series)

**Display manufacturers:**
- NEC MultiSync
- Sharp Aquos Board
- Panasonic LinkRay
- Sony Bravia Professional

**No public test devices are available.** Use a local projector or simulator for development.

### PJLink Simulator

For testing without hardware, use a PJLink simulator:

**Simple netcat simulator (no auth):**
```bash
# Terminal 1 — Listen on port 4352
while true; do
  (
    echo "PJLINK 0"
    while read -r line; do
      case "$line" in
        *POWR*) echo "%1POWR=1" ;;
        *NAME*) echo "%1NAME=Test Projector" ;;
        *INF1*) echo "%1INF1=Generic" ;;
        *INF2*) echo "%1INF2=Model XYZ" ;;
        *CLSS*) echo "%1CLSS=1" ;;
        *LAMP*) echo "%1LAMP=1234 1" ;;
        *ERST*) echo "%1ERST=000000" ;;
        *INST*) echo "%1INST=11 21 31 32" ;;
        *INPT*) echo "%1INPT=11" ;;
        *AVMT*) echo "%1AVMT=30" ;;
        *INFO*) echo "%1INFO=v1.0.0" ;;
        *) echo "%1XXXX=ERR1" ;;
      esac
    done
  ) | nc -l 4352
done
```

**Test:**
```bash
curl -s -X POST http://localhost:8787/api/pjlink/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"127.0.0.1","port":4352}' | jq
```

---

## Comparison to Other Protocols

| Feature | PJLink | AMX | Crestron | SNMP |
|---------|--------|-----|----------|------|
| Standard | Open (JBMiA) | Proprietary | Proprietary | Open (IETF) |
| Protocol | TCP text | TCP binary | TCP text/binary | UDP |
| Authentication | MD5 hash | Varies | Varies | Community strings |
| Device support | Wide (projectors) | Wide (all AV) | Wide (all AV) | Universal (network) |
| Complexity | Low | Medium | Medium | Medium |
| Real-time status | Polling | Push/poll | Push/poll | Polling |

**PJLink advantages:**
- Open standard, no licensing fees
- Simple text-based protocol
- Wide manufacturer support
- Easy to implement and debug

**PJLink disadvantages:**
- Limited to Class 1/2 commands (no vendor extensions in standard)
- No real-time push notifications (Class 2 adds this but not widely implemented)
- MD5 authentication is weak by modern standards

---

## Security Considerations

### 1. MD5 hash weakness

PJLink uses MD5 for authentication. MD5 is cryptographically broken — collisions can be generated in seconds. However, for PJLink's use case (preventing accidental control, not protecting against determined attackers), MD5 is considered acceptable.

### 2. No encryption

PJLink operates over plain TCP — commands and responses are sent in cleartext. An attacker on the network can:
- Sniff passwords (MD5 hash + random string)
- Replay commands
- Modify responses

**Mitigation:** Use a VPN, IPsec, or tunnel PJLink over SSH if confidentiality is required.

### 3. Password storage

Port of Call receives passwords in the JSON request body over HTTPS. The password is visible in:
- Client code (JavaScript, curl scripts)
- HTTP request logs (if logging is enabled)
- Worker memory during execution

**Mitigation:** Use environment variables or secret managers for passwords. Avoid hardcoding in scripts.

### 4. No rate limiting

Port of Call does not rate-limit PJLink requests. A malicious client could:
- Spam power on/off commands, causing rapid power cycling (reduces lamp life)
- Flood the projector with queries, causing unresponsiveness

**Mitigation:** Implement rate limiting in the Worker or use Cloudflare Rate Limiting rules.

### 5. Device discovery / reconnaissance

An attacker can use `/probe` to identify all PJLink devices on a network segment. The response reveals:
- Manufacturer and model (useful for exploit targeting)
- Current power status
- Lamp hours (indicates usage patterns)

**Mitigation:** Restrict PJLink port 4352 to trusted networks via firewall rules.

---

## Troubleshooting

### Error: "Unexpected greeting: ..."

**Cause:** Server sent non-PJLink response (e.g., HTTP 400, SSH banner, binary junk).

**Solution:** Verify the server is a PJLink device listening on port 4352. Check with telnet:
```bash
telnet projector.example.com 4352
```
Expected: `PJLINK 0\r` or `PJLINK 1 <random>\r`

### Error: "Connection timeout"

**Cause:** No response from server within timeout period.

**Solutions:**
1. Increase timeout: `"timeout": 30000`
2. Verify network connectivity: `ping projector.example.com`
3. Check firewall rules (port 4352 may be blocked)
4. Verify PJLink is enabled in projector settings

### Error: "Authentication required but no password provided"

**Cause:** Projector requires authentication (`PJLINK 1` greeting) but no password was provided.

**Solution:** Add password to request: `"password": "JBMIAlink"`

### Authenticated is false but no error

**Cause:** The projector accepted the connection but returned ERRA (authentication error) on the first command.

**Possible causes:**
1. Wrong password
2. Password contains special characters not handled correctly
3. Projector firmware bug

**Solution:** Try default passwords, check projector manual, or disable authentication in projector settings.

### Probe succeeds but some fields are missing

**Cause:** Some projectors do not implement all PJLink commands. For example, cheap projectors may not support `INF1` (manufacturer) or `INFO` (other info).

**Solution:** This is expected behavior. The missing fields simply mean the projector returned an error for those queries.

### Power command returns ERR3 (Unavailable time)

**Cause:** The command cannot be executed in the current state. Common scenarios:
- Trying to power on while cooling down (wait 60-90 seconds)
- Trying to power off while warming up (wait 30-60 seconds)
- Cover is open (close cover)
- Lamp error (replace lamp)

**Solution:** Wait for the transient state to resolve, then retry.

### Lamp hours are zero or incorrect

**Cause:** Some projectors reset lamp hours when the lamp is replaced. Others have multiple lamp modes (eco, bright) that increment different counters.

**Solution:** Check the projector's OSD menu for detailed lamp statistics.

---

## Resources

- **PJLink Specification:** [jbmia.or.jp/english](https://pjlink.jbmia.or.jp/english/)
- **PJLink Class 1 Command Reference:** [jbmia.or.jp/english/data_download.html](https://pjlink.jbmia.or.jp/english/data_download.html)
- **PJLink Compatible Devices:** [jbmia.or.jp/english/list.html](https://pjlink.jbmia.or.jp/english/list.html)
- **MD5 Hash Calculator:** [md5hashgenerator.com](https://www.md5hashgenerator.com/)

---

## Power-User Tips

### Testing authentication without a password

Probe the device without a password to check if authentication is required:
```bash
curl -s -X POST https://portofcall.ross.gg/api/pjlink/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100"}' \
  | jq '{authRequired, authenticated, error}'
```

If `authRequired: true` and `authenticated: false`, try default passwords.

### Monitoring lamp hours

Set up a cron job to log lamp hours daily:
```bash
#!/bin/bash
# Save as /etc/cron.daily/pjlink-lamp-check
PROJECTOR="192.168.1.100"
LOG="/var/log/projector-lamp.log"

HOURS=$(curl -s -X POST https://portofcall.ross.gg/api/pjlink/probe \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"$PROJECTOR\"}" \
  | jq -r '.projectorInfo.lampHours[0].hours // "unknown"')

echo "$(date -I) Lamp hours: $HOURS" >> "$LOG"
```

### Detecting projector failures

Monitor error status and alert on non-OK values:
```bash
ERROR_STATUS=$(curl -s -X POST https://portofcall.ross.gg/api/pjlink/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100"}' \
  | jq -r '.projectorInfo.errorStatus | to_entries[] | select(.value != "OK") | "\(.key): \(.value)"')

if [ -n "$ERROR_STATUS" ]; then
  echo "Projector errors detected:"
  echo "$ERROR_STATUS"
  # Send alert via email, Slack, etc.
fi
```

### Auto-discovery on a subnet

Scan a subnet for PJLink devices:
```bash
#!/bin/bash
for ip in 192.168.1.{1..254}; do
  timeout 2 bash -c "echo -n | nc $ip 4352 2>/dev/null | grep -q PJLINK" && {
    echo "$ip: PJLink device detected"
    curl -s -X POST https://portofcall.ross.gg/api/pjlink/probe \
      -H 'Content-Type: application/json' \
      -d "{\"host\":\"$ip\",\"timeout\":3000}" \
      | jq -r '.projectorInfo | "\(.manufacturer) \(.productName)"'
  }
done
```

### Scheduled power on/off

**Morning power-on (8 AM):**
```bash
0 8 * * 1-5 curl -s -X POST https://portofcall.ross.gg/api/pjlink/power \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","action":"on","password":"secret"}' > /dev/null
```

**Evening power-off (6 PM):**
```bash
0 18 * * 1-5 curl -s -X POST https://portofcall.ross.gg/api/pjlink/power \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","action":"off","password":"secret"}' > /dev/null
```

### Extracting input code from input list

Find HDMI 1 input code:
```bash
curl -s -X POST https://portofcall.ross.gg/api/pjlink/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100"}' \
  | jq -r '.projectorInfo.inputs[] | select(startswith("31"))'
```

### Verifying power state change

After sending power on command, wait 30 seconds and verify:
```bash
curl -s -X POST https://portofcall.ross.gg/api/pjlink/power \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","action":"on","password":"secret"}'

sleep 30

STATUS=$(curl -s -X POST https://portofcall.ross.gg/api/pjlink/power \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","action":"query","password":"secret"}' \
  | jq -r '.powerStatus')

echo "Power status: $STATUS"
```
