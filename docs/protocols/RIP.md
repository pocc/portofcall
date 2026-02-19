# RIP — Routing Information Protocol

**Port:** 520 (UDP standard, TCP supported)
**RFC:** 1058 (RIPv1), 2453 (RIPv2), 2082 (RIPv2 Cryptographic Authentication)
**Implementation:** `src/worker/rip.ts`
**Routes:** `POST /api/rip/request`, `POST /api/rip/probe`, `POST /api/rip/update`, `POST /api/rip/send`, `POST /api/rip/auth-update`, `POST /api/rip/md5-update`

---

## Protocol Overview

RIP is a distance-vector routing protocol that uses hop count as its metric. Maximum hop count is 15; a metric of 16 (RIP_INFINITY) indicates an unreachable network. RIP routers exchange routing tables every 30 seconds via multicast (224.0.0.9 for RIPv2) or broadcast (255.255.255.255 for RIPv1).

**Critical limitation:** RIP uses UDP port 520 in production. Cloudflare Workers' `connect()` API only supports TCP, so this implementation attempts TCP connections to port 520. Most RIP routers will not respond over TCP — you will typically see `connected: false` with "router likely requires UDP" in the response. The implementation still provides value for:
- Testing RIP implementations that support TCP
- Inspecting the properly-formatted request packets (via `raw` hex field)
- Understanding RIP protocol structure
- Debugging custom RIP implementations

### RIPv1 vs RIPv2

| Feature | RIPv1 (RFC 1058) | RIPv2 (RFC 2453) |
|---------|------------------|------------------|
| Addressing | Classful (no subnet masks) | Classless (CIDR support) |
| Authentication | None | Simple password or MD5 |
| Multicast | No (broadcast 255.255.255.255) | Yes (224.0.0.9) |
| Route tags | No | Yes (for external routes) |
| Next hop | Implicit (sender) | Explicit (can differ from sender) |
| Subnet mask | Not sent | Included in route entry |

---

## Endpoints

### `POST /api/rip/request`

Legacy endpoint using Node.js Buffer-based parsing. Sends a RIP request (whole table or specific network) and parses the response.

**Request**

```json
{
  "host":           "192.0.2.1",     // required
  "port":           520,              // default 520
  "timeout":        15000,            // ms, default 15000
  "version":        2,                // 1 or 2, default 2
  "networkAddress": "10.0.0.0"       // optional; omit for whole table request
}
```

**Whole table request:** When `networkAddress` is omitted, sends AFI=0, metric=16 per RFC 2453 §3.9.1.

**Specific network request:** When `networkAddress` is provided (e.g., `"10.0.0.0"`), sends AFI=2, IP address, metric=16.

**Response — success**

```json
{
  "success":    true,
  "host":       "192.0.2.1",
  "port":       520,
  "version":    2,
  "command":    "Response",
  "routes": [
    {
      "addressFamily": 2,
      "routeTag":      100,
      "ipAddress":     "10.0.0.0",
      "subnetMask":    "255.255.0.0",
      "nextHop":       "192.0.2.1",
      "metric":        5
    }
  ],
  "routeCount": 47,
  "rtt":        83
}
```

**RIPv1 response:** `routeTag`, `subnetMask`, and `nextHop` are `undefined` (v1 packets omit these fields).

**Response — no response**

```json
{
  "success": false,
  "host":    "192.0.2.1",
  "port":    520,
  "error":   "No response from RIP router"
}
```

**Response — invalid format**

```json
{
  "success": false,
  "host":    "192.0.2.1",
  "port":    520,
  "error":   "Invalid RIP response format"
}
```

**Response — unexpected command**

```json
{
  "success": false,
  "host":    "192.0.2.1",
  "port":    520,
  "version": 2,
  "command":  "Request",
  "error":   "Unexpected RIP command: Request (expected Response)",
  "rtt":     42
}
```

If the peer echoes our request instead of responding with a routing table, `success: false` with the unexpected command name.

---

### `POST /api/rip/probe`

Alias for `/api/rip/request` with shorter default timeout (10 s instead of 15 s). Used for quick connectivity checks.

**Request**

```json
{
  "host":    "192.0.2.1",   // required
  "port":    520,            // default 520
  "timeout": 10000,          // ms, default 10000
  "version": 2               // 1 or 2, default 2
}
```

Always sends a whole table request (AFI=0, metric=16). Response format identical to `/request`.

---

### `POST /api/rip/update`

Modern endpoint using Uint8Array parsing. Sends a RIPv2 whole-table request and attempts to read a routing table response. Returns detailed connection diagnostics even when TCP connection fails.

**Request**

```json
{
  "host":    "192.0.2.1",   // required
  "port":    520,            // default 520
  "version": 2,              // 1 or 2, default 2
  "timeout": 10000           // ms, default 10000
}
```

**Response — received RIP response over TCP**

```json
{
  "success":          true,
  "version":          2,
  "command":          "request",
  "connected":        true,
  "responseReceived": true,
  "routes": [
    {
      "family":  2,
      "tag":     0,
      "address": "10.0.0.0",
      "mask":    "255.255.0.0",
      "nextHop": "192.0.2.1",
      "metric":  3
    }
  ],
  "raw":       "01 02 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 10",
  "latencyMs": 67
}
```

**Response — TCP connected but no RIP response**

```json
{
  "success":          false,
  "version":          2,
  "command":          "request",
  "connected":        true,
  "responseReceived": false,
  "routes":           [],
  "raw":              "01 02 00 00 ...",
  "latencyMs":        10004,
  "note":             "TCP connection succeeded but no RIP response (router may require UDP)"
}
```

This is the typical result for a real RIP router — TCP port 520 is open but the router expects UDP.

**Response — TCP connection refused**

```json
{
  "success":          false,
  "version":          2,
  "command":          "request",
  "connected":        false,
  "responseReceived": false,
  "routes":           [],
  "raw":              "01 02 00 00 ...",
  "latencyMs":        42,
  "note":             "TCP connection to port 520 failed — router likely requires UDP: Connection refused"
}
```

**`raw` field:** Always contains the hex dump of the RIP request packet sent. Use this to verify protocol compliance or manually send the packet via UDP using another tool.

**`routes` field:** Array of `RouteEntry` objects with fields: `family` (AFI), `tag`, `address`, `mask`, `nextHop`, `metric`. Empty array if no response received or response was not a valid RIP Response command.

---

### `POST /api/rip/send`

Send a RIPv1 request. Identical to `/api/rip/update` but uses version 1 (no subnet masks, route tags, or next-hop fields).

**Request**

```json
{
  "host":    "192.0.2.1",   // required
  "port":    520,            // default 520
  "timeout": 10000           // ms, default 10000
}
```

Version is hardcoded to 1 (not configurable).

**Response format:** Same as `/api/rip/update` with `version: 1`. Route entries will have `mask: "0.0.0.0"`, `nextHop: "0.0.0.0"`, `tag: 0` (RIPv1 omits these fields; parser fills them with zeros).

---

### `POST /api/rip/auth-update`

Send a RIPv2 authenticated route update using simple password authentication (RFC 2082 §2).

**SECURITY WARNING:** Simple password authentication sends the password in cleartext in the packet. This is visible to anyone who can sniff the network. Use MD5 authentication (`/api/rip/md5-update`) for production.

**Request**

```json
{
  "host":     "192.0.2.1",     // required
  "port":     520,              // default 520
  "password": "secretpass",     // default "rip"; max 16 bytes
  "routes": [
    {
      "address": "10.0.0.0",
      "mask":    "255.255.0.0",
      "nextHop": "192.0.2.1",
      "metric":  5,
      "tag":     100
    }
  ],
  "timeout":  10000             // ms, default 10000
}
```

**`password` truncation:** Passwords longer than 16 bytes are truncated. Shorter passwords are zero-padded to 16 bytes.

**`routes` defaults:** If omitted, sends a single default route: `0.0.0.0/0` via `0.0.0.0` with metric 1.

**`mask`, `nextHop`, `tag` defaults:** Missing fields use `mask: "255.255.255.0"`, `nextHop: "0.0.0.0"`, `tag: 0`.

**Packet layout:**
```
[Header: cmd=2, ver=2, zero(2)]       4 bytes
[Auth entry: AFI=0xFFFF, type=2, pw]  20 bytes  ← authentication
[Route entry: AFI=2, ...]             20 bytes × N
```

**Response — router accepted update**

```json
{
  "success":          true,
  "version":          2,
  "command":          "response",
  "authType":         "simple-password (RFC 2082 §2)",
  "passwordLength":   11,
  "routeCount":       1,
  "connected":        true,
  "responseReceived": true,
  "routes": [
    {
      "family":  2,
      "tag":     0,
      "address": "10.0.0.0",
      "mask":    "255.255.0.0",
      "nextHop": "192.0.2.1",
      "metric":  5
    }
  ],
  "raw":       "02 02 00 00 ff ff 00 02 73 65 63 72 65 74 70 61 73 73 00 00 00 00 00 00 ...",
  "latencyMs": 234,
  "note":      "Router accepted the RIPv2 authenticated update and responded."
}
```

**Response — router did not respond (typical for UDP-only routers)**

```json
{
  "success":          false,
  "version":          2,
  "command":          "response",
  "authType":         "simple-password (RFC 2082 §2)",
  "passwordLength":   11,
  "routeCount":       1,
  "connected":        true,
  "responseReceived": false,
  "routes":           [],
  "raw":              "02 02 00 00 ff ff 00 02 ...",
  "latencyMs":        10003,
  "note":             "TCP connected; no RIPv2 response (router may require UDP, or auth was rejected)."
}
```

**Response — TCP connection failed**

```json
{
  "success":          false,
  "version":          2,
  "command":          "response",
  "authType":         "simple-password (RFC 2082 §2)",
  "passwordLength":   11,
  "routeCount":       1,
  "connected":        false,
  "responseReceived": false,
  "routes":           [],
  "raw":              "02 02 00 00 ...",
  "latencyMs":        28,
  "note":             "TCP connection to port 520 failed — router likely requires UDP: Connection refused."
}
```

---

### `POST /api/rip/md5-update`

Send a RIPv2 Keyed MD5 authenticated route update (RFC 2082 §4). This is the strongest authentication method supported by RIPv2.

**Request**

```json
{
  "host":           "192.0.2.1",     // required
  "port":           520,              // default 520
  "password":       "secretkey",      // default "rip"; used as MD5 key
  "keyId":          1,                // 1-255, default 1
  "sequenceNumber": 1234567890,       // anti-replay counter, default Unix timestamp
  "routes": [
    {
      "address": "10.0.0.0",
      "mask":    "255.255.0.0",
      "nextHop": "192.0.2.1",
      "metric":  5,
      "tag":     100
    }
  ],
  "timeout":        10000             // ms, default 10000
}
```

**`keyId`:** Router key slot (1-255). Routers can be configured with multiple keys; keyId selects which one to use. Values < 1 are clamped to 1; values > 255 are clamped to 255.

**`sequenceNumber`:** Anti-replay counter. Must be monotonically increasing. Defaults to current Unix timestamp (seconds since epoch). Routers may reject packets with sequence numbers lower than the last received value.

**`password` handling:** Truncated or zero-padded to exactly 16 bytes before MD5 hashing.

**MD5 computation (RFC 2082 §4.1):**
```
1. Build packet with trailing auth data = zeros (16 bytes)
2. Pad password to 16 bytes → key[16]
3. Digest = MD5(key[16] || packet[...] || key[16])
4. Insert digest into trailing auth entry bytes 4..19
```

**Packet layout:**
```
[Header: cmd=2, ver=2, zero(2)]                                4 bytes
[Auth entry: AFI=0xFFFF, type=3, pktlen, keyId, dataLen, seq] 20 bytes
[Route entries: AFI=2, tag, ip, mask, nexthop, metric]        N × 20 bytes
[Trailing auth data: AFI=0xFFFF, 0x0001, MD5[16]]            20 bytes
```

**Response — router accepted MD5 update**

```json
{
  "success":          true,
  "version":          2,
  "command":          "response",
  "authType":         "Keyed MD5 (RFC 2082 §4)",
  "keyId":            1,
  "keyLength":        9,
  "sequenceNumber":   1234567890,
  "packetLen":        44,
  "totalBytes":       64,
  "routeCount":       1,
  "connected":        true,
  "responseReceived": true,
  "routes": [
    {
      "family":  2,
      "tag":     100,
      "address": "10.0.0.0",
      "mask":    "255.255.0.0",
      "nextHop": "192.0.2.1",
      "metric":  5
    }
  ],
  "raw":       "02 02 00 00 ff ff 00 03 00 2c 01 10 49 96 02 d2 00 00 00 00 ...",
  "latencyMs": 178,
  "note":      "Router accepted the RIPv2 Keyed MD5 authenticated update and responded."
}
```

**Response — TCP connected but no response**

```json
{
  "success":          false,
  "version":          2,
  "command":          "response",
  "authType":         "Keyed MD5 (RFC 2082 §4)",
  "keyId":            1,
  "keyLength":        9,
  "sequenceNumber":   1234567890,
  "packetLen":        44,
  "totalBytes":       64,
  "routeCount":       1,
  "connected":        true,
  "responseReceived": false,
  "routes":           [],
  "raw":              "02 02 00 00 ff ff 00 03 ...",
  "latencyMs":        10002,
  "note":             "TCP connected; no RIPv2 response (router may require UDP, or MD5 auth was rejected)."
}
```

**`packetLen`:** Byte offset from RIP header to start of trailing auth entry (excludes the trailing 20-byte auth entry per RFC 2082).

**`totalBytes`:** Full packet size including trailing auth entry.

---

## RIP Message Format

### Header (4 bytes)

| Offset | Length | Field | Description |
|--------|--------|-------|-------------|
| 0 | 1 | Command | 1 = Request, 2 = Response |
| 1 | 1 | Version | 1 = RIPv1, 2 = RIPv2 |
| 2 | 2 | Reserved | Must be zero |

### Route Entry (20 bytes) — RIPv1

| Offset | Length | Field | Description |
|--------|--------|-------|-------------|
| 0 | 2 | Address Family | 2 = IP (always) |
| 2 | 2 | Reserved | Must be zero |
| 4 | 4 | IP Address | Network address |
| 8 | 8 | Reserved | Must be zero |
| 16 | 4 | Metric | Hop count (1-16) |

### Route Entry (20 bytes) — RIPv2

| Offset | Length | Field | Description |
|--------|--------|-------|-------------|
| 0 | 2 | Address Family | 2 = IP, 0 = whole table request, 0xFFFF = auth |
| 2 | 2 | Route Tag | External route attribute |
| 4 | 4 | IP Address | Network address |
| 8 | 4 | Subnet Mask | Network mask |
| 12 | 4 | Next Hop | Next hop router (0.0.0.0 = sender) |
| 16 | 4 | Metric | Hop count (1-16) |

### Authentication Entry (20 bytes) — Simple Password (RFC 2082 §2)

| Offset | Length | Field | Value |
|--------|--------|-------|-------|
| 0 | 2 | Address Family | 0xFFFF |
| 2 | 2 | Auth Type | 2 = Simple Password |
| 4 | 16 | Password | Cleartext password (zero-padded) |

### Authentication Entry (20 bytes) — Keyed MD5 (RFC 2082 §4)

| Offset | Length | Field | Description |
|--------|--------|-------|-------------|
| 0 | 2 | Address Family | 0xFFFF |
| 2 | 2 | Auth Type | 3 = Keyed MD5 |
| 4 | 2 | Packet Length | Offset to trailing auth entry |
| 6 | 1 | Key ID | Router key slot (1-255) |
| 7 | 1 | Auth Data Len | 16 (MD5 digest size) |
| 8 | 4 | Sequence Number | Anti-replay counter |
| 12 | 4 | Reserved | Must be zero |

### Trailing Auth Data (20 bytes) — Keyed MD5

| Offset | Length | Field | Value |
|--------|--------|-------|-------|
| 0 | 2 | Address Family | 0xFFFF |
| 2 | 2 | Subtype | 0x0001 |
| 4 | 16 | MD5 Digest | MD5(key || packet || key) |

---

## Known Limitations

### 1. TCP instead of UDP

**Critical:** RIP uses UDP port 520 in production. Cloudflare Workers' `connect()` API does not support UDP sockets. All endpoints attempt TCP connections to port 520. Real RIP routers will not respond over TCP — typical result is `connected: false` with "router likely requires UDP" error.

**Workarounds:**
- Use the `raw` hex field to extract the properly-formatted packet, then send it via UDP using a different tool (e.g., `nc -u`, `scapy`, or a local UDP client)
- Test against custom RIP implementations that support TCP
- Use these endpoints as protocol reference / packet generators

### 2. Single read() call

All endpoints call `reader.read()` exactly once. If the RIP response spans multiple TCP segments (rare but possible on lossy/slow networks), only the first chunk is parsed. Subsequent chunks are discarded.

**Impact:** Large routing tables (hundreds of routes) may be truncated if they don't fit in the first TCP segment (typically 1460 bytes = 72 routes max).

**Workaround:** Use smaller `collectMs` values or request specific networks with `networkAddress` parameter.

### 3. No buffering / fragmentation handling

The parsers (`parseRIPMessage`, `parseRIPv2Response`) expect complete messages. Partial messages cause parse failures and return empty route arrays.

### 4. Timeout shared between connect and read

In `/api/rip/request`, a single timeout covers both TCP connection establishment and the RIP response read. A slow connection handshake (2 s) leaves only 13 s (of a 15 s timeout) for the RIP response. This has been improved in other endpoints (`/update`, `/send`, `/auth-update`, `/md5-update`) where timeouts are properly cleared and re-set.

### 5. No multicast support

RIPv2 routers send periodic updates to multicast address 224.0.0.9. This implementation only supports unicast queries to specific router IPs.

### 6. No route filtering

All received routes are included in the response. There is no filtering by prefix, metric, tag, or next-hop.

### 7. No triggered updates

RIP supports triggered updates (immediate announcements of route changes). This implementation only supports request/response exchanges.

### 8. IPv4 only

RIPng (RFC 2080) for IPv6 is not supported.

### 9. `success: true` inconsistency

`/api/rip/request` returns `success: true` even when it receives an unexpected command (e.g., peer echoes our Request instead of sending a Response). Check the `command` field and `routes` array to confirm actual success.

Other endpoints (`/update`, `/send`, `/auth-update`, `/md5-update`) use `success` based on `responseReceived` flag — more accurate but inconsistent with `/request`.

### 10. No split horizon / poison reverse

This implementation does not track learned routes or apply split horizon rules. It is receive-only and does not participate in RIP routing table maintenance.

### 11. Field naming inconsistency

| Field | `/request`, `/probe` | `/update`, `/send`, `/auth-update`, `/md5-update` |
|-------|----------------------|--------------------------------------------------|
| Address Family | `addressFamily` | `family` |
| Route Tag | `routeTag` | `tag` |
| IP Address | `ipAddress` | `address` |
| Subnet Mask | `subnetMask` | `mask` |
| Next Hop | `nextHop` | `nextHop` (same) |

This is due to dual parsing paths (Buffer-based vs Uint8Array-based).

### 12. No authentication response validation

When sending authenticated updates (`/auth-update`, `/md5-update`), the implementation does not verify if the router's response is also authenticated. An attacker could inject a fake unauthenticated response.

### 13. Simple password auth is cleartext

RFC 2082 §2 simple password authentication sends the password in cleartext. Anyone with network access can read it. Use MD5 authentication for production.

### 14. No sequence number tracking

MD5 authentication includes a sequence number for anti-replay protection. This implementation does not track the last sent sequence number — callers must manage this manually to prevent replay attacks.

### 15. KeyId clamping is silent

Invalid keyId values (< 1 or > 255) are silently clamped to valid range. No error is returned to indicate the value was modified.

---

## curl Examples

```bash
# Whole table request (RIPv2)
curl -s -X POST https://portofcall.ross.gg/api/rip/request \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.0.2.1","version":2}' | jq .

# Specific network request (RIPv1)
curl -s -X POST https://portofcall.ross.gg/api/rip/request \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.0.2.1","version":1,"networkAddress":"10.0.0.0"}' | jq .

# Quick connectivity check
curl -s -X POST https://portofcall.ross.gg/api/rip/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.0.2.1"}' | jq '{success,connected,responseReceived,note}'

# Modern RIPv2 request with diagnostics
curl -s -X POST https://portofcall.ross.gg/api/rip/update \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.0.2.1","version":2,"timeout":5000}' \
  | jq '{success,connected,responseReceived,routes,note}'

# RIPv1 request
curl -s -X POST https://portofcall.ross.gg/api/rip/send \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.0.2.1"}' | jq .

# Simple password authenticated update
curl -s -X POST https://portofcall.ross.gg/api/rip/auth-update \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "192.0.2.1",
    "password": "secretpass",
    "routes": [
      {"address": "10.0.0.0", "mask": "255.255.0.0", "metric": 5}
    ]
  }' | jq '{success,authType,passwordLength,connected,responseReceived,note}'

# MD5 authenticated update
curl -s -X POST https://portofcall.ross.gg/api/rip/md5-update \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "192.0.2.1",
    "password": "strongkey",
    "keyId": 1,
    "sequenceNumber": 1234567890,
    "routes": [
      {"address": "10.0.0.0", "mask": "255.255.0.0", "metric": 3, "tag": 100}
    ]
  }' | jq '{success,authType,keyId,sequenceNumber,connected,responseReceived,note}'

# Extract hex packet for manual UDP sending
curl -s -X POST https://portofcall.ross.gg/api/rip/update \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.0.2.1"}' | jq -r '.raw'
# Output: 01 02 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 10

# Convert hex to binary and send via UDP (bash + xxd + nc)
curl -s -X POST https://portofcall.ross.gg/api/rip/update \
  -d '{"host":"192.0.2.1"}' | jq -r '.raw' | xxd -r -p | nc -u 192.0.2.1 520
```

---

## Local Testing

**Quagga (recommended for RIPv1/v2)**

```bash
# Install: apt-get install quagga (Debian/Ubuntu)
# /etc/quagga/ripd.conf:
hostname ripd
password zebra
router rip
  version 2
  network 10.0.0.0/8
  passive-interface eth0

# Start: systemctl start ripd
# Test: echo "show ip rip" | vtysh
```

**FRRouting (modern Quagga fork)**

```bash
# Install: https://frrouting.org/
# /etc/frr/ripd.conf:
router rip
  version 2
  network 10.0.0.0/8

# Start: systemctl start frr
# Test: vtysh -c "show ip rip"
```

**Testing authenticated RIP:**

```bash
# FRRouting ripd.conf for MD5 auth:
key chain RIPKEY
  key 1
    key-string strongkey
!
interface eth0
  ip rip authentication mode md5
  ip rip authentication key-chain RIPKEY
!
router rip
  version 2
  network 10.0.0.0/8
```

**Testing via UDP with netcat:**

Since this implementation uses TCP but RIP requires UDP, extract the hex packet and send it manually:

```bash
# Get RIPv2 request packet hex
curl -s -X POST https://portofcall.ross.gg/api/rip/update \
  -d '{"host":"192.0.2.1"}' | jq -r '.raw' > rip_request.hex

# Convert to binary
cat rip_request.hex | xxd -r -p > rip_request.bin

# Send via UDP and capture response
nc -u -w 2 192.0.2.1 520 < rip_request.bin | xxd

# Or use socat for better control:
socat - UDP4-DATAGRAM:192.0.2.1:520 < rip_request.bin | xxd
```

---

## RIP State Machine (Informational)

This implementation does not maintain RIP state — it is stateless request/response only. For reference, a full RIP router maintains:

```
Initialization: Read config, bind UDP 520, join multicast 224.0.0.9
Idle: Wait for timer (30 s) or request
Update: Send Response with full routing table to 224.0.0.9
Request Processing: Respond to unicast queries
Route Timeout: Mark routes invalid after 180 s without update
Garbage Collection: Remove invalid routes after 120 s
```

This implementation only performs "Request Processing" — sending queries and parsing responses.

---

## Security Considerations

1. **Simple password auth is cleartext** — anyone on the network path can read the password. Use MD5 auth for production.

2. **No response authentication verification** — when using auth endpoints, the implementation does not verify if responses are also authenticated. An attacker could inject fake responses.

3. **Sequence number is caller-managed** — MD5 auth requires monotonically increasing sequence numbers to prevent replay attacks. Callers must track the last sent value.

4. **No rate limiting** — sending route updates too frequently can overwhelm routers or trigger DoS protections.

5. **Metric poisoning** — RIP has no authentication of route announcements (beyond MD5 auth, which only protects integrity, not authorization). An attacker who knows the MD5 key can poison routing tables.

6. **No DNSSEC for hostname resolution** — if `host` is a hostname, it's resolved via standard DNS (no DNSSEC validation).

7. **TCP fallback reveals intent** — attempting TCP to port 520 is unusual and may trigger IDS alerts. RIP over TCP is not standard.

---

## References

- RFC 1058: Routing Information Protocol (RIPv1)
- RFC 2453: RIP Version 2 (RIPv2)
- RFC 2082: RIP-2 MD5 Authentication
- RFC 2080: RIPng for IPv6
- RFC 1724: RIP Version 2 MIB Extension
