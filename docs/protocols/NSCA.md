# NSCA (Nagios Service Check Acceptor) — Power User Reference

**Port:** 5667 (default) | **Protocol:** Binary/TLS-like handshake | **Version:** v3 (4304-byte packets)

Nagios NSCA accepts passive check results from monitoring clients. The server sends a 132-byte initialization packet containing a random IV and timestamp, then the client submits an encrypted check result packet. Port of Call provides three endpoints: a connection probe to verify NSCA availability, a basic send operation with XOR encryption, and an advanced encrypted send supporting AES-128/256.

---

## API Endpoints

### `POST /api/nsca/probe` — Connection probe

Connects to an NSCA server, reads the 132-byte initialization packet (128-byte IV + 4-byte timestamp), and returns the parsed metadata. Does not submit any check results.

**POST body:**

| Field     | Type   | Default | Notes |
|-----------|--------|---------|-------|
| `host`    | string | —       | Required |
| `port`    | number | `5667`  | Valid range: 1-65535 |
| `timeout` | number | `10000` | Total timeout in ms |

**Success (200):**
```json
{
  "success": true,
  "host": "nagios.example.com",
  "port": 5667,
  "ivHex": "a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1...",
  "timestamp": 1708264523,
  "timestampDate": "2024-02-18T14:35:23.000Z",
  "rtt": 142
}
```

**Error (500):** `{ "success": false, "error": "Incomplete init packet: received 128 of 132 bytes" }`

**Notes:**
- The IV is displayed as the first 32 bytes in hex followed by `...` (full IV is 128 bytes).
- `timestamp` is Unix epoch seconds (big-endian uint32) from the server's init packet.
- `rtt` measures time from socket open to full init packet received.
- If the server sends the init packet in multiple TCP segments, the implementation accumulates up to 100 chunks before failing.

---

### `POST /api/nsca/send` — Submit passive check result (basic)

Connects, reads init packet, builds a check result packet, optionally encrypts with XOR (method 1), and sends. Supports encryption methods 0 (none) and 1 (XOR).

**POST body:**
```json
{
  "host": "nagios.example.com",
  "port": 5667,
  "hostName": "webserver01",
  "service": "HTTP",
  "returnCode": 0,
  "output": "HTTP OK - 200 response in 45ms",
  "encryption": 1,
  "password": "shared_secret",
  "timeout": 15000
}
```

| Field        | Type   | Default | Notes |
|--------------|--------|---------|-------|
| `host`       | string | —       | Required: NSCA server address |
| `port`       | number | `5667`  | |
| `hostName`   | string | —       | Required: Nagios host name (64 bytes max, null-terminated) |
| `service`    | string | —       | Required: Service description (128 bytes max, null-terminated) |
| `returnCode` | number | —       | Required: 0=OK, 1=WARNING, 2=CRITICAL, 3=UNKNOWN |
| `output`     | string | —       | Required: Plugin output (4096 bytes max for v3, null-terminated) |
| `encryption` | number | `1`     | 0 = None, 1 = XOR (only these two are supported) |
| `password`   | string | —       | XOR password (required for encryption=1) |
| `timeout`    | number | `15000` | Total timeout in ms |

**Success (200):**
```json
{
  "success": true,
  "host": "nagios.example.com",
  "port": 5667,
  "hostName": "webserver01",
  "service": "HTTP",
  "returnCode": 0,
  "encryption": "XOR",
  "rtt": 187
}
```

**Error (400):**
- `"Host is required"`
- `"Host name (Nagios host) is required"`
- `"Service description is required"`
- `"Return code must be 0 (OK), 1 (WARNING), 2 (CRITICAL), or 3 (UNKNOWN)"`
- `"Plugin output is required"`
- `"Only encryption methods 0 (none) and 1 (XOR) are supported"`

**Notes:**
- Encryption method 0 sends the packet in **plaintext** (no XOR applied, despite NSCA documentation sometimes calling this "XOR with timestamp only").
- Encryption method 1 XORs the packet with the server IV and password using `xorEncrypt(packet, iv, password)`.
- `hostName`, `service`, and `output` are truncated to fit their field sizes (64, 128, 4096 bytes respectively) and null-terminated.
- The check result packet is NSCA v3 format (4304 bytes total).

---

### `POST /api/nsca/encrypted` — Submit with AES encryption

Advanced endpoint supporting stronger ciphers: XOR (1), AES-128 (14), and AES-256 (16). Uses NSCA v3 packet format (4304 bytes).

**POST body:**
```json
{
  "host": "nagios.example.com",
  "port": 5667,
  "password": "shared_secret",
  "hostname": "webserver01",
  "service": "HTTPS",
  "state": 0,
  "message": "HTTPS OK - certificate valid for 89 days",
  "cipher": 16,
  "timeout": 15000
}
```

| Field      | Type   | Default | Notes |
|------------|--------|---------|-------|
| `host`     | string | —       | Required |
| `port`     | number | `5667`  | |
| `password` | string | —       | Required: Shared secret for encryption |
| `hostname` | string | —       | Required: Nagios host (note different field name vs `/send`) |
| `service`  | string | —       | Required |
| `state`    | number | —       | Required: 0=OK, 1=WARNING, 2=CRITICAL, 3=UNKNOWN |
| `message`  | string | —       | Required: Plugin output |
| `cipher`   | number | `14`    | 1=XOR, 14=AES-128, 16=AES-256 |
| `timeout`  | number | `15000` | Total timeout in ms |

**Success (200):**
```json
{
  "cipher": 16,
  "cipherName": "AES-256",
  "encrypted": true,
  "submitted": true,
  "host": "nagios.example.com",
  "port": 5667,
  "rtt": 203
}
```

**Error (400):**
- `"Password is required"`
- `"hostname, service, and message are required"`
- `"state must be 0 (OK), 1 (WARNING), 2 (CRITICAL), or 3 (UNKNOWN)"`
- `"3DES (cipher 8) is not supported by the Web Crypto API in Cloudflare Workers"`
- `"Unsupported cipher N. Supported: 1 (XOR), 14 (AES-128), 16 (AES-256)"`

**Cipher details:**

| Cipher | Name      | Key derivation | IV source | Algorithm |
|--------|-----------|----------------|-----------|-----------|
| 1      | XOR       | Password bytes | Server IV (full 128 bytes) | XOR each byte with `IV[i % 128] ^ password[i % len]` |
| 14     | AES-128   | MD5(password) → 16 bytes | Server IV[0..15] | AES-128-CBC |
| 16     | AES-256   | SHA-256(password) → 32 bytes | Server IV[0..15] | AES-256-CBC |

**Notes:**
- AES modes use only the first 16 bytes of the server IV for the CBC initialization vector.
- The 4304-byte packet size is a multiple of 16 (AES block size), so no padding is needed.
- 3DES (cipher 8) is **not supported** because SubtleCrypto in Cloudflare Workers does not implement it.
- The MD5 implementation is pure TypeScript (RFC 1321 compliant) because SubtleCrypto does not provide MD5.

---

## Wire Protocol

### Initialization Packet (server → client, 132 bytes)

```
Offset | Size | Field       | Type   | Notes
-------|------|-------------|--------|---------------------------
0      | 128  | IV          | bytes  | Random initialization vector
128    | 4    | timestamp   | uint32 | Unix epoch (big-endian)
```

The server sends this immediately upon connection. The timestamp is used in the check result packet and for XOR encryption in method 0 (though method 0 currently sends plaintext in this implementation).

### Check Result Packet (client → server, 4304 bytes for v3)

```
Offset | Size | Field               | Type     | Notes
-------|------|---------------------|----------|------------------------
0      | 2    | packet_version      | int16    | Always 3 (big-endian)
2      | 2    | padding             | bytes    | Alignment padding
4      | 4    | crc32               | uint32   | CRC-32/ISO-HDLC (big-endian)
8      | 4    | timestamp           | uint32   | From init packet (big-endian)
12     | 2    | return_code         | int16    | 0=OK, 1=WARNING, 2=CRITICAL, 3=UNKNOWN (big-endian)
14     | 2    | padding             | bytes    | Alignment padding
16     | 64   | host_name           | char[]   | Null-terminated string
80     | 128  | service_description | char[]   | Null-terminated string
208    | 4096 | plugin_output       | char[]   | Null-terminated string
```

**CRC32 calculation:**
1. Set `crc32` field to 0
2. Fill all other fields
3. Compute CRC-32/ISO-HDLC checksum (polynomial 0xEDB88320) over entire 4304-byte packet
4. Write checksum into `crc32` field at offset 4

**Encryption:**
- **Method 0 (None):** Packet sent in plaintext (no encryption applied)
- **Method 1 (XOR):** `encrypted[i] = packet[i] ^ IV[i % 128] ^ password[i % len(password)]`
- **Method 14 (AES-128):** AES-128-CBC with key=MD5(password), IV=serverIV[0..15]
- **Method 16 (AES-256):** AES-256-CBC with key=SHA-256(password), IV=serverIV[0..15]

---

## Protocol Flow Diagram

```
Client                                    NSCA Server (port 5667)
  |                                              |
  |--- TCP SYN --------------------------------->|
  |<-- SYN-ACK ----------------------------------|
  |--- ACK ------------------------------------>|
  |                                              |
  |<-- Initialization packet (132 bytes) -------|
  |    [128-byte IV + 4-byte timestamp]          |
  |                                              |
  | Build check packet (4304 bytes)             |
  | Set CRC32 field to 0                         |
  | Fill version, timestamp, return_code,        |
  | host_name, service_description, output       |
  | Calculate CRC32 over entire packet           |
  | Write CRC32 to offset 4                      |
  | Encrypt packet (XOR/AES-128/AES-256)        |
  |                                              |
  |--- Encrypted check result packet (4304) --->|
  |                                              |
  |<-- (connection closed by server) ------------|
  |                                              |
```

**RTT measurement points:**
- **Start:** Socket opened
- **End:** Full init packet received (probe) or check result sent (send/encrypted)

---

## Known Limitations and Quirks

### 1. No server response parsing
After sending the check result, NSCA servers typically close the connection immediately without sending a success/failure response. The implementation assumes submission succeeded if the write completes without error. There is no way to confirm the server accepted the packet or whether CRC32 validation passed.

### 2. Hardcoded NSCA v3 packet size
The implementation uses 4304-byte packets (v3 format with 4096-byte plugin output). NSCA v2 uses 720-byte packets (512-byte output). There is no auto-detection or configuration option — only v3 is supported.

### 3. Encryption method 0 sends plaintext
Despite NSCA documentation sometimes describing method 0 as "XOR with timestamp only," this implementation sends the packet **without any encryption** when `encryption=0`. Only method 1 applies XOR.

### 4. Timeout shared across all I/O
The `timeout` parameter starts when the socket opens and expires after both the TLS-like handshake (reading init packet) and sending the check result. A slow init packet read reduces time available for the send operation.

### 5. No timeout cleanup in some error paths (FIXED)
**BUG FIX APPLIED:** Original code created `setTimeout` timers that were never cleared on timeout or error, causing resource leaks. Now all code paths properly call `clearTimeout()` in finally blocks.

### 6. Missing 2-byte padding after return_code (FIXED)
**BUG FIX APPLIED:** Original packet structure omitted 2 bytes of padding after the `return_code` field, resulting in a 14-byte header instead of 16 bytes. The correct layout now includes padding at offset 14-15 to align `host_name` at offset 16.

### 7. CRC32 field byte order
All integer fields use **big-endian** (network byte order). The `getUint32/setUint32` calls now explicitly pass `false` as the second parameter to enforce big-endian. Default DataView behavior is big-endian, but explicit is better.

### 8. Chunk accumulation limit (ADDED)
**SECURITY FIX APPLIED:** Added `MAX_CHUNKS = 100` limit to prevent malicious servers from sending infinite tiny TCP segments that cause memory exhaustion. If 100 chunks are received without reaching 132 bytes, the connection is aborted with `"Too many chunks received"`.

### 9. Reader/writer lock cleanup (FIXED)
**BUG FIX APPLIED:** Early return paths in init packet reading left the reader/writer locked, preventing socket cleanup. Now all paths use try/finally to guarantee `releaseLock()` is called.

### 10. DataView byteOffset handling (FIXED)
**BUG FIX APPLIED:** When creating DataView for timestamp parsing, the original code used `new DataView(initPacket.buffer, NSCA_IV_SIZE)` which could point to the wrong offset if `initPacket` was a subarray. Now uses `timestampBytes.byteOffset` to calculate the correct absolute offset.

### 11. No host validation
The `host` parameter is passed directly to `connect()` without validation. Malformed hostnames, IPv6 addresses without brackets, or invalid characters are not checked. The Cloudflare sockets API may reject them, but error messages will be generic connection failures.

### 12. Error response cipher mismatch (FIXED)
**BUG FIX APPLIED:** The `/api/nsca/encrypted` catch-all error handler hardcoded `cipher: 14, cipherName: 'AES-128'` in the response, even if the request used a different cipher. Now extracts the actual cipher from the request body (or defaults to 14 if body is unparsable).

### 13. No Cloudflare detection
Unlike most other protocol handlers in Port of Call, NSCA does not detect or warn when connecting to Cloudflare-protected hosts. Attempting to connect to a Cloudflare IP will result in a generic connection timeout or protocol mismatch error.

### 14. Binary values in fields
All string fields (`host_name`, `service_description`, `plugin_output`) are encoded with `TextEncoder` (UTF-8). Binary plugin output (e.g., performance data with null bytes, non-UTF-8 encodings) will be corrupted or truncated at the first null byte.

### 15. No field length validation
If `hostName`, `service`, or `output` contain multi-byte UTF-8 characters, `substring(0, N-1)` operates on **character count**, not **byte count**. A 64-character hostname with emoji could exceed 64 bytes when encoded, causing the field to overflow into the next field.

### 16. CRC32 polynomial standard
The implementation uses CRC-32/ISO-HDLC (polynomial 0xEDB88320, same as gzip, Ethernet, PNG). This matches standard NSCA behavior. Some custom NSCA forks may use different polynomials — those are not supported.

### 17. No connection reuse
Each `/api/nsca/send` or `/api/nsca/encrypted` call opens a new TCP connection, reads the init packet, sends one check result, and closes. NSCA servers may throttle or reject rapid connections from the same IP. Use a local NSCA client or aggregator for high-frequency submissions.

### 18. AES packet size assumption
AES-CBC requires input to be a multiple of 16 bytes. The v3 packet size (4304 bytes) is exactly 269 × 16, so no padding is needed. If the packet structure changes in future NSCA versions, AES encryption will fail unless padding is added.

---

## Practical Examples

### curl

**Probe to verify NSCA availability:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/nsca/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"nagios.example.com","port":5667}' | jq
```

**Submit OK check result with XOR encryption:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/nsca/send \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "nagios.example.com",
    "port": 5667,
    "hostName": "webserver01",
    "service": "HTTP",
    "returnCode": 0,
    "output": "HTTP OK - 200 response in 45ms | time=0.045s;;;0",
    "encryption": 1,
    "password": "shared_secret"
  }' | jq
```

**Submit CRITICAL check with AES-256 encryption:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/nsca/encrypted \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "nagios.example.com",
    "password": "strong_password",
    "hostname": "dbserver02",
    "service": "PostgreSQL",
    "state": 2,
    "message": "CRITICAL - connection refused on port 5432",
    "cipher": 16
  }' | jq
```

**Submit WARNING check with no encryption (plaintext):**
```bash
curl -s -X POST https://portofcall.ross.gg/api/nsca/send \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "nagios.example.com",
    "hostName": "diskserver",
    "service": "Disk /var",
    "returnCode": 1,
    "output": "WARNING - 85% full (4.2 GB free) | /var=85%;80;90;0;100",
    "encryption": 0
  }' | jq
```

**Latency test with custom timeout:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/nsca/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"nagios.example.com","port":5667,"timeout":5000}' \
  | jq '.rtt'
```

**Batch submission via shell loop (not recommended — NSCA servers may throttle):**
```bash
for service in HTTP HTTPS DNS; do
  curl -s -X POST https://portofcall.ross.gg/api/nsca/send \
    -H 'Content-Type: application/json' \
    -d "{
      \"host\": \"nagios.example.com\",
      \"hostName\": \"webserver01\",
      \"service\": \"$service\",
      \"returnCode\": 0,
      \"output\": \"$service OK\",
      \"encryption\": 1,
      \"password\": \"secret\"
    }"
  sleep 0.5  # Avoid rapid connection spam
done
```

---

## JavaScript Example

```js
async function submitNSCACheck({
  host,
  nagiosHost,
  service,
  status,
  output,
  encryption = 'aes256',
  password,
}) {
  const cipherMap = { none: 0, xor: 1, aes128: 14, aes256: 16 };
  const cipher = cipherMap[encryption] ?? 16;

  const res = await fetch('https://portofcall.ross.gg/api/nsca/encrypted', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      host,
      password,
      hostname: nagiosHost,
      service,
      state: status,
      message: output,
      cipher,
    }),
  });

  const result = await res.json();
  if (!result.submitted) {
    throw new Error(`NSCA submission failed: ${result.error}`);
  }
  return result;
}

// Usage
await submitNSCACheck({
  host: 'nagios.example.com',
  nagiosHost: 'webserver01',
  service: 'HTTPS',
  status: 0, // OK
  output: 'HTTPS OK - certificate expires in 89 days',
  encryption: 'aes256',
  password: 'shared_secret',
});
```

---

## Return Code Reference

| Code | Status   | Meaning |
|------|----------|---------|
| 0    | OK       | Service is functioning normally |
| 1    | WARNING  | Service is degraded but still operational |
| 2    | CRITICAL | Service is down or severely impacted |
| 3    | UNKNOWN  | Unable to determine service status |

Nagios uses these codes for alerting thresholds and escalation policies. Passive checks submitted via NSCA override the last check result for the specified host/service pair.

---

## Encryption Method Comparison

| Method | Name      | Security | Performance | Key size | IV size | Notes |
|--------|-----------|----------|-------------|----------|---------|-------|
| 0      | None      | ❌ Plaintext | Fastest | N/A | N/A | No encryption — anyone on network can read check results |
| 1      | XOR       | ⚠️ Weak | Fast | Variable | 128 bytes | Simple XOR — vulnerable to known-plaintext attacks |
| 14     | AES-128   | ✅ Strong | Medium | 128 bits | 16 bytes | Industry-standard AES-128-CBC |
| 16     | AES-256   | ✅ Strongest | Slower | 256 bits | 16 bytes | Recommended for sensitive environments |
| 8      | 3DES      | ❌ Not supported | — | — | — | SubtleCrypto in Workers doesn't implement 3DES |

**Recommendation:** Use cipher 16 (AES-256) for production. Use XOR (1) only if the NSCA server does not support AES. Avoid plaintext (0) unless on a trusted internal network.

---

## Differences from Standard NSCA Tools

| Feature | `send_nsca` (C client) | Port of Call |
|---------|------------------------|--------------|
| Packet version | v2 (720 bytes) or v3 (4304 bytes) | v3 only (4304 bytes) |
| Encryption methods | 0-16 (includes DES, 3DES, Blowfish, etc.) | 0, 1, 14, 16 only |
| Config file | `/etc/send_nsca.cfg` (password, encryption) | JSON request body |
| Batch submission | Reads from stdin, one check per line | One HTTP request per check |
| Connection reuse | Single connection for multiple checks | New connection per request |
| Server response | None (fire-and-forget) | Same (no response parsed) |
| Performance data | Supported in plugin output field | Supported (part of `output`/`message` string) |
| Multi-byte characters | Depends on locale | UTF-8 encoded (may cause byte overflow) |

Port of Call is designed for **one-shot passive check submissions** from web applications, serverless functions, or scripts that can make HTTP requests but cannot run native NSCA binaries.

---

## Security Considerations

### 1. Password transmission
Passwords are sent in the HTTP request body over HTTPS to Port of Call, then used to derive encryption keys for NSCA. The password never appears in the NSCA wire protocol (it's used for key derivation only).

### 2. Man-in-the-middle on NSCA connection
Port of Call connects to the NSCA server over **plain TCP** — there is no TLS. If an attacker intercepts the connection:
- **Method 0 (None):** Check results are visible in plaintext
- **Method 1 (XOR):** Weak encryption, vulnerable to known-plaintext attacks
- **Method 14/16 (AES):** Strong encryption, but no authentication — attacker could replay packets

### 3. No packet authentication
NSCA packets include a CRC32 checksum for corruption detection, but this is **not cryptographic**. An attacker can modify an encrypted packet and recalculate CRC32. NSCA protocol does not provide HMAC or authenticated encryption.

### 4. Shared secrets
NSCA uses a single shared password (configured in `/etc/nsca.cfg` on the server). All clients must use the same password unless the server is configured with per-host passwords (not standard).

### 5. Firewall rules
NSCA servers should restrict connections to trusted source IPs. Port of Call's Cloudflare Worker source IP is not fixed — the NSCA server will see connections from Cloudflare's edge network.

---

## Troubleshooting

### Error: "Incomplete init packet: received 128 of 132 bytes"
**Cause:** Server sent partial init packet and closed connection.
**Solution:** Check NSCA server logs. Server may reject the connection due to source IP restrictions, or may be running a non-standard NSCA implementation.

### Error: "Too many chunks received"
**Cause:** Server sent more than 100 TCP segments before completing the 132-byte init packet.
**Solution:** This is likely a protocol mismatch or a malicious server. Verify the server is running standard NSCA on port 5667.

### Error: "Connection timeout"
**Cause:** No response from server within the timeout period.
**Solution:** Increase `timeout`, check firewall rules, verify server is listening on specified port.

### Submission succeeds but check result doesn't appear in Nagios
**Possible causes:**
1. **Wrong host/service name:** NSCA requires exact match with Nagios configuration. Check `host_name` and `service_description` in Nagios config files.
2. **Passive checks not enabled:** Service definition in Nagios must have `passive_checks_enabled 1` and `active_checks_enabled 0` (or both enabled).
3. **NSCA server not writing to command file:** Check NSCA server logs (`/var/log/nsca.log` or similar) for errors writing to Nagios command pipe.
4. **CRC32 mismatch:** If encryption method or password is wrong, server rejects the packet silently. Check NSCA server logs.
5. **Wrong packet version:** This implementation uses v3 (4304 bytes). If the NSCA server expects v2 (720 bytes), packets will be rejected.

### Performance data not graphed
Performance data (e.g., `| time=0.045s;;;0`) is passed in the `output`/`message` field. Nagios parses it if the service definition includes `process_perf_data 1`. Ensure PNP4Nagios, Graphite, or another perfdata handler is configured.

---

## Resources

- [NSCA SourceForge project](https://sourceforge.net/projects/nagios/files/nsca-2.x/) — Original C implementation
- [Nagios Core documentation](https://assets.nagios.com/downloads/nagioscore/docs/) — Passive check configuration
- [NSCA protocol documentation (unofficial)](https://github.com/NagiosEnterprises/nsca/blob/master/PROTOCOL) — Wire format details
- [RFC 1321 (MD5)](https://www.rfc-editor.org/rfc/rfc1321) — MD5 hash algorithm
- [FIPS 197 (AES)](https://csrc.nist.gov/publications/detail/fips/197/final) — AES specification

---

## Power User Tips

### Using `/api/nsca/probe` as a monitoring check
Probe the NSCA server every 60 seconds and alert if RTT exceeds 500ms or probe fails:
```bash
#!/bin/bash
RTT=$(curl -s -X POST https://portofcall.ross.gg/api/nsca/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"nagios.example.com","port":5667,"timeout":3000}' \
  | jq -r '.rtt // "error"')

if [[ "$RTT" == "error" ]]; then
  echo "CRITICAL - NSCA probe failed"
  exit 2
elif (( RTT > 500 )); then
  echo "WARNING - NSCA RTT ${RTT}ms (threshold 500ms)"
  exit 1
else
  echo "OK - NSCA RTT ${RTT}ms"
  exit 0
fi
```

### Self-submission: NSCA server monitors its own checks
Submit a passive check result about NSCA itself:
```bash
curl -s -X POST https://portofcall.ross.gg/api/nsca/encrypted \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "nagios.example.com",
    "password": "secret",
    "hostname": "nagios.example.com",
    "service": "NSCA Daemon",
    "state": 0,
    "message": "NSCA accepting connections",
    "cipher": 16
  }'
```

### Submitting from AWS Lambda or Cloudflare Workers
Port of Call's HTTP API allows serverless functions to submit passive checks without running native NSCA binaries:
```js
// Cloudflare Workers example
export default {
  async scheduled(event, env, ctx) {
    const checkResult = await fetch('https://portofcall.ross.gg/api/nsca/encrypted', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: env.NSCA_HOST,
        password: env.NSCA_PASSWORD,
        hostname: 'worker-cron',
        service: 'Scheduled Task',
        state: 0,
        message: 'Cron executed successfully at ' + new Date().toISOString(),
        cipher: 16,
      }),
    });
    const result = await checkResult.json();
    console.log('NSCA submission:', result.submitted ? 'OK' : result.error);
  },
};
```

### Extracting IV for debugging
The `/api/nsca/probe` endpoint returns `ivHex` (first 32 bytes). To see the full 128-byte IV:
```bash
# Capture raw init packet with netcat
nc nagios.example.com 5667 | xxd -l 132 > nsca_init.hex
# First 128 bytes (0x00-0x7F) = IV
# Bytes 128-131 (0x80-0x83) = timestamp (big-endian uint32)
```

### Performance data format
Nagios performance data follows the format:
```
output_message | label=value[UOM];[warn];[crit];[min];[max]
```
Example:
```
HTTP OK - 200 response in 45ms | time=0.045s;;;0;5 size=1234B
```
This can be submitted in the `output`/`message` field. Nagios parses everything after `|` as perfdata.

### Choosing encryption method based on security policy
| Environment | Recommended cipher |
|-------------|--------------------|
| Public internet, sensitive data | 16 (AES-256) |
| Internal network, moderate security | 14 (AES-128) |
| Trusted VLAN, low security | 1 (XOR) — fast but weak |
| Lab/testing only | 0 (None) — fastest, no encryption |

### Checking CRC32 manually
If debugging packet corruption, verify CRC32 with this Python snippet:
```python
import zlib
packet = open('nsca_packet.bin', 'rb').read()
# Zero out bytes 4-7 (CRC32 field)
packet_zeroed = packet[:4] + b'\x00\x00\x00\x00' + packet[8:]
crc = zlib.crc32(packet_zeroed) & 0xFFFFFFFF
print(f'CRC32: 0x{crc:08x}')
# Should match the value at packet[4:8] (big-endian)
```
