# BGP — Border Gateway Protocol

**Port:** 179 (TCP)
**RFC:** 4271 (BGP-4), 6793 (4-Octet AS), 4760 (Multiprotocol Extensions), 2385 (TCP MD5)
**Implementation:** `src/worker/bgp.ts`
**Routes:** `POST /api/bgp/connect`, `POST /api/bgp/announce`, `POST /api/bgp/route-table`

---

## Endpoints

### `POST /api/bgp/connect`

Sends a BGP OPEN (without capability optional parameters), then reads the peer's response and optionally confirms the session with a KEEPALIVE exchange.

**Request**

```json
{
  "host":     "192.0.2.1",     // required
  "port":     179,              // default 179
  "localAS":  65000,           // default 65000; must be 1–65535
  "routerId": "10.0.0.1",      // default "10.0.0.1"; dotted-decimal IPv4
  "holdTime": 90,              // default 90 seconds
  "timeout":  10000            // ms, default 10000
}
```

**`localAS` validation:** rejected if > 65535. Use `/api/bgp/announce` or `/api/bgp/route-table` for 4-byte ASNs.

**Response — peer sent OPEN**

```json
{
  "success":            true,
  "host":               "192.0.2.1",
  "port":               179,
  "rtt":                142,
  "connectTime":        38,
  "peerOpen": {
    "version":          4,
    "peerAS":           65001,
    "holdTime":         90,
    "routerId":         "192.0.2.1",
    "capabilities":     ["Multiprotocol Extensions", "Route Refresh", "4-Octet AS Number"]
  },
  "sessionEstablished": true
}
```

`sessionEstablished` is `true` only if the peer sent a KEEPALIVE after we replied with our KEEPALIVE. The KEEPALIVE read uses a hardcoded 3 s timeout — a slow peer gets `sessionEstablished: false` even if the session is actually valid.

**Response — peer sent NOTIFICATION**

```json
{
  "success":            true,
  "host":               "192.0.2.1",
  "port":               179,
  "rtt":                55,
  "connectTime":        12,
  "peerOpen":           null,
  "sessionEstablished": false,
  "notification": {
    "errorCode":    2,
    "errorSubcode": 2,
    "errorName":    "OPEN Message Error",
    "errorDetail":  "Bad Peer AS"
  }
}
```

**`success: true` even for NOTIFICATION:** The connect endpoint returns `success: true` whenever TCP connects — regardless of whether a NOTIFICATION was received. Check `peerOpen !== null` to confirm the session was accepted, and check `notification` to understand why it was rejected.

**Response — TCP connected but no BGP message**

```json
{
  "success": true,
  "peerOpen": null,
  "sessionEstablished": false,
  "notification": null
}
```

This can happen if the peer's BGP process is not running (port open by firewall) or if the first read times out.

**OPEN sent:** Without capability parameters — bare OPEN with version=4, My AS (2 bytes), Hold Time, Router ID, OptParamLen=0. Many modern peers advertise capabilities in their OPEN but do not require them in ours.

**Single read:** The handler calls `reader.read()` once. If the peer's OPEN spans two TCP segments (uncommon but possible on high-latency paths), the response is truncated and `parseBGPMessage` returns null.

---

### `POST /api/bgp/announce`

Sends a minimal BGP OPEN and returns the peer's raw response — focused on peer identification (AS number, router ID, capabilities) rather than session establishment.

**Request**

```json
{
  "host":     "192.0.2.1",   // required
  "port":     179,            // default 179
  "localAS":  64512,         // default 64512; 1–4294967295 accepted
  "holdTime": 180,           // default 180 seconds
  "timeout":  10000          // ms, default 10000
}
```

Note: `routerId` is not accepted — hardcoded to `10.0.0.1`.

**4-byte AS behaviour:** accepts full 32-bit ASNs in validation (`1–4294967295`), but only the low 16 bits are placed in the My AS field of the OPEN. No capability 65 (4-Octet AS) is advertised. A peer configured for AS 131072 would receive `AS 0` (131072 & 0xFFFF = 0), which is invalid — use `/api/bgp/route-table` for 4-byte AS peering.

**Response — OPEN received**

```json
{
  "success":      true,
  "type":         "OPEN",
  "peerAS":       65001,
  "holdTime":     90,
  "bgpId":        "192.0.2.1",
  "capabilities": ["Route Refresh", "4-Octet AS Number", "ADD-PATH"],
  "raw":          "ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff 00 2d 01 ...",
  "latencyMs":    87
}
```

Note: field is `bgpId` here (vs `routerId` in `/connect` — inconsistency).

**Response — NOTIFICATION received**

```json
{
  "success":     false,
  "type":        "NOTIFICATION",
  "errorCode":   2,
  "errorSubCode": 2,
  "errorName":   "OPEN Message Error",
  "errorDetail": "Bad Peer AS",
  "raw":         "ff ff ... 00 15 03 02 02",
  "latencyMs":   43
}
```

Note: field is `errorSubCode` (capital C) here vs `errorSubcode` (lowercase c) in `/connect` — inconsistency.

**Response — no BGP message**

```json
{
  "success":   false,
  "type":      "NONE",
  "raw":       "ff ff ... (sent OPEN hex)",
  "latencyMs": 10001,
  "error":     "No response received from peer within timeout"
}
```

When `type: "NONE"`, `raw` contains the hex of what we *sent* (the OPEN), not what we received.

**Single read:** Same limitation as `/connect` — one `reader.read()` call, no buffering. Split responses produce `type: "NONE"`.

---

### `POST /api/bgp/route-table`

Establishes a full BGP session with capabilities, then collects UPDATE messages for a configurable window to build a route snapshot.

**Request**

```json
{
  "host":       "192.0.2.1",   // required
  "port":       179,            // default 179
  "localAS":    65000,         // default 65000
  "routerId":   "10.0.0.1",   // default "10.0.0.1"
  "holdTime":   90,            // default 90; seconds
  "collectMs":  5000,          // ms to collect routes after session open; max 30000
  "maxRoutes":  1000,          // stop collecting at this many routes; max 10000
  "timeout":    30000          // overall timeout ms; default 30000
}
```

**`collectMs` and `maxRoutes` caps:** values above 30000 ms / 10000 routes are silently capped. A full Internet routing table (≈1 million prefixes) requires much longer; plan for multiple calls or route server access.

**Session flow:**

```
→ OPEN (with caps: Multiprotocol IPv4/Unicast, Route Refresh, 4-Octet AS)
← OPEN (peer)
→ KEEPALIVE
← KEEPALIVE  (session Established)
← UPDATE … UPDATE … KEEPALIVE … UPDATE …  (collectMs window)
  (during window: each peer KEEPALIVE is echoed)
← socket.close()
```

**Fixed 10 s window for session open:** the time between sending our OPEN and receiving the peer's OPEN is capped at 10 s regardless of `timeout`. If the peer is slow to respond, the session fails with `"No BGP OPEN received from peer"`.

**4-byte AS support in OPEN:** for `localAS > 65535`, places AS_TRANS (23456) in the My AS field and the full 32-bit ASN in capability 65.

**Response (success)**

```json
{
  "success":    true,
  "latencyMs":  8423,
  "peerOpen": {
    "peerAS":       65001,
    "holdTime":     90,
    "routerId":     "192.0.2.1",
    "capabilities": ["Multiprotocol Extensions", "Route Refresh", "4-Octet AS Number"]
  },
  "session": {
    "keepaliveCount":    3,
    "updateCount":       212,
    "collectDurationMs": 5000
  },
  "routes": [
    {
      "prefix":    "10.0.0.0/8",
      "withdrawn": false,
      "origin":    "IGP",
      "asPath":    "65001 65100",
      "asList":    [65001, 65100],
      "nextHop":   "192.0.2.1",
      "med":       0,
      "localPref": 100
    }
  ],
  "withdrawnRoutes": [
    { "prefix": "10.1.0.0/24", "withdrawn": true }
  ],
  "routeCount":    847,
  "withdrawnCount": 12
}
```

**Response (failure — peer sent NOTIFICATION)**

```json
{
  "success":   false,
  "latencyMs": 34,
  "error":     "Peer sent NOTIFICATION: OPEN Message Error — Bad Peer AS"
}
```

---

## BGP Message Reference

| Type | Code | Direction | Notes |
|------|------|-----------|-------|
| OPEN | 1 | → ← | Connection setup; version, AS, hold time, router ID, optional params |
| UPDATE | 2 | ← | Route advertisements and withdrawals |
| NOTIFICATION | 3 | ← | Error — peer closes session |
| KEEPALIVE | 4 | → ← | Heartbeat; must be exchanged within hold time |

### OPEN Optional Parameters

Capability optional parameter (type 2) decoded by `parseCapabilities()`:

| Cap code | Name |
|----------|------|
| 1 | Multiprotocol Extensions |
| 2 | Route Refresh |
| 64 | Graceful Restart |
| 65 | 4-Octet AS Number |
| 69 | ADD-PATH |
| 70 | Enhanced Route Refresh |
| 71 | Long-Lived Graceful Restart |
| 73 | FQDN Capability |
| 128 | Route Refresh (old Cisco) |

Other codes appear as `Capability(<code>)`.

### NOTIFICATION Error Codes

| Code | Name | Common subcodes |
|------|------|----------------|
| 1 | Message Header Error | 1=Connection Not Synchronized, 2=Bad Message Length, 3=Bad Message Type |
| 2 | OPEN Message Error | 1=Unsupported Version, 2=Bad Peer AS, 3=Bad BGP Identifier, 4=Unsupported Optional Parameter, 6=Unacceptable Hold Time, 7=Unsupported Capability |
| 3 | UPDATE Message Error | 1=Malformed Attribute List, 2=Unrecognized Well-known Attribute, 3=Missing Well-known Attribute, … |
| 4 | Hold Timer Expired | — |
| 5 | Finite State Machine Error | — |
| 6 | Cease | 1=Maximum Prefixes Reached, 2=Administrative Shutdown, 6=Other Config Change, 8=Hard Reset |

---

## Path Attribute Reference

Decoded by `parseUpdateMessage()` from UPDATE messages:

| Code | Name | Decoded field | Format |
|------|------|---------------|--------|
| 1 | ORIGIN | `origin` | `"IGP"`, `"EGP"`, or `"INCOMPLETE"` |
| 2 | AS_PATH | `asPath`, `asList` | String of ASNs; sets `{...}` for AS_SET segments |
| 3 | NEXT_HOP | `nextHop` | Dotted-decimal IPv4 |
| 4 | MULTI_EXIT_DISC | `med` | uint32 |
| 5 | LOCAL_PREF | `localPref` | uint32 |
| 6 | ATOMIC_AGGREGATE | — | Sets `attributes.atomicAggregate: true` |
| 7 | AGGREGATOR | — | `attributes.aggregator: {as, ip}` |
| 8 | COMMUNITY | — | **Not decoded** — missing from switch |

Attributes not in this table (MP_REACH_NLRI, MP_UNREACH_NLRI, AS4_PATH, LARGE_COMMUNITY, etc.) are silently skipped.

---

## Known Limitations

### 1. AS_PATH parsed as 2-byte ASNs

The UPDATE parser reads AS_PATH segments assuming 2-byte per-AS entries (`avView.getUint16(sp, false); sp += 2`). When `/route-table` advertises capability 65 (4-Octet AS) and the peer responds in kind, AS_PATH entries are 4-byte. The parser misreads them as pairs of 2-byte ASNs, producing garbled AS paths.

Workaround: set `localAS` to a 2-byte ASN value and don't rely on the peer sending 4-byte AS_PATH encoding. Use `raw` hex inspection for authoritative AS path data (not exposed in `/route-table`).

### 2. COMMUNITY attribute not decoded

Path attribute type 8 (COMMUNITY, RFC 1997) is absent from the `parseUpdateMessage` switch. Community values are dropped silently. Routes with no-export or no-advertise communities are not identifiable from the JSON output.

### 3. No TCP MD5 authentication

BGP peering between ISPs and route servers typically requires TCP MD5 signatures (RFC 2385), implemented via the `TCP_MD5SIG` socket option. This is an OS-level feature unavailable in Cloudflare Workers. Any peer requiring MD5 will drop the TCP SYN silently (it arrives without the MD5 signature).

### 4. `success: true` for NOTIFICATION and empty responses in `/connect`

`/connect` returns `success: true` as long as TCP connected. A NOTIFICATION (peer rejected the session) and a completely empty response both return `success: true`. Use `peerOpen !== null` to test for a positive OPEN and `notification` to inspect rejections.

### 5. `/announce` truncates 4-byte ASNs

The My AS field in OPEN is 2 bytes. For `localAS > 65535`, only `localAS & 0xFFFF` is placed in the field, producing an invalid or incorrect AS number. No 4-octet AS capability is advertised. Use `/route-table` for actual 4-byte AS peering.

### 6. Single `reader.read()` in `/connect` and `/announce`

Both handlers call `reader.read()` exactly once. A BGP OPEN that arrives in two TCP segments (rare, but possible over high-latency or MTU-limited paths) causes the first chunk to fail the marker check and the endpoint returns no parsed OPEN. `/route-table` handles split packets correctly.

### 7. Hard-coded 10 s OPEN deadline in `/route-table`

The window to receive the peer's OPEN is fixed at 10 s from the source, independent of the `timeout` parameter. Slow BGP speakers (common on heavily loaded route servers) may exceed this, causing `"No BGP OPEN received from peer"` even with `timeout: 30000`.

### 8. No UPDATE sending / no prefix announcement

There is no endpoint to advertise prefixes to a peer. All three handlers are receive-only. BGP route injection (for testing or anycast) is not supported.

### 9. `collectMs` and `maxRoutes` silently capped

Values above 30 s / 10000 routes are capped without an error. A full Internet table from a public route server requires 3–5+ minutes of collection and millions of routes.

### 10. Field naming inconsistency

| Field | `/connect` | `/announce` |
|-------|-----------|-------------|
| Peer router ID | `peerOpen.routerId` | `bgpId` |
| NOTIFICATION subcode | `errorSubcode` | `errorSubCode` |

---

## curl Examples

```bash
# Quick connectivity check
curl -s -X POST https://portofcall.ross.gg/api/bgp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"route-server.example.net","localAS":65000}' | jq .

# Peer identification (capabilities, router ID)
curl -s -X POST https://portofcall.ross.gg/api/bgp/announce \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.0.2.1","localAS":64512}' | jq '{type,peerAS,bgpId,capabilities}'

# Collect up to 500 routes for 3 seconds
curl -s -X POST https://portofcall.ross.gg/api/bgp/route-table \
  -H 'Content-Type: application/json' \
  -d '{"host":"route-server.example.net","localAS":65000,"routerId":"10.0.0.1","collectMs":3000,"maxRoutes":500}' \
  | jq '{routeCount,withdrawnCount,routes:.routes[:5]}'

# Inspect peer capabilities and session open only (collectMs=0)
curl -s -X POST https://portofcall.ross.gg/api/bgp/route-table \
  -H 'Content-Type: application/json' \
  -d '{"host":"route-server.example.net","localAS":65000,"collectMs":0}' \
  | jq '{peerOpen,session}'
```

---

## Local Testing

**GoBGP (recommended — simple config file)**

```bash
# Install: go install github.com/osrg/gobgp/v3/cmd/gobgpd@latest
# gobgpd.conf:
[global.config]
  as = 65001
  router-id = "192.0.2.1"
[[neighbors]]
  [neighbors.config]
    neighbor-address = "127.0.0.1"
    peer-as = 65000

gobgpd -f gobgpd.conf

# Test against it:
curl -s -X POST https://portofcall.ross.gg/api/bgp/announce \
  -d '{"host":"YOUR_PUBLIC_IP","localAS":65000}' | jq .
```

**BIRD**

```
protocol bgp portofcall {
  local as 65001;
  neighbor 0.0.0.0 as 65000;    # accept from any peer
  ipv4 { import all; export all; };
}
```

**Public route servers (read-only, no MD5)**

Many IXPs operate BGP route servers with open peering. Check PeeringDB for route server IPs in your region. Most require your router ID to resolve to your network's IP space and may reject OPEN with "Bad BGP Identifier" if it doesn't.

---

## BGP State Machine (Simplified)

```
Idle → Connect: TCP SYN sent
Connect → OpenSent: TCP established, OPEN sent
OpenSent → OpenConfirm: peer OPEN received, KEEPALIVE sent
OpenConfirm → Established: peer KEEPALIVE received
Established: UPDATE/KEEPALIVE exchange
Any state → Idle: NOTIFICATION received or error
```

The implementation does not maintain explicit state — each endpoint is a single request/response exchange. `/connect` and `/announce` reach at most OpenConfirm; `/route-table` reaches Established and stays there for `collectMs`.
