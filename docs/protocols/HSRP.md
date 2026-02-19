# HSRP -- Hot Standby Router Protocol

**Port:** 1985 (UDP multicast to 224.0.0.2 per spec; this implementation uses TCP)
**RFC:** 2281 (HSRPv1), Cisco proprietary extension (HSRPv2)
**Implementation:** `src/worker/hsrp.ts`
**Routes:** `POST /api/hsrp/probe`, `POST /api/hsrp/listen`, `POST /api/hsrp/coup`, `POST /api/hsrp/v2-probe`

---

## Protocol Overview

HSRP is a Cisco proprietary First Hop Redundancy Protocol (FHRP). Multiple physical routers share a single virtual IP and virtual MAC address. One router is elected Active (forwards traffic), one is Standby (next in line), and the rest Listen. If the Active router fails, the Standby takes over transparently to hosts using the virtual IP as their default gateway.

**Key facts:**
- Virtual MAC format: `0000.0c07.acXX` (XX = group number in hex, HSRPv1)
- HSRPv2 virtual MAC: `0000.0c9f.fXXX` (XXX = group number in hex, 0-4095)
- Default hello interval: 3 seconds
- Default hold time: 10 seconds (3x hello)
- Default priority: 100 (range 0-255; highest wins election)
- Default authentication: `cisco` (8-byte plaintext field, NUL-padded)
- Multicast group: 224.0.0.2 (HSRPv1), 224.0.0.102 (HSRPv2 IPv4)

---

## Endpoints

### `POST /api/hsrp/probe`

Sends an HSRPv1 Hello packet and parses the response. Uses group 0, priority 50, virtual IP 0.0.0.0, and default authentication "cisco".

**Request**

```json
{
  "host":    "192.168.1.1",  // required -- target router IP
  "port":    1985,            // default 1985
  "timeout": 15000            // ms, default 15000
}
```

**Response -- HSRP router responded**

```json
{
  "success":        true,
  "host":           "192.168.1.1",
  "port":           1985,
  "version":        0,
  "opCode":         "Hello",
  "state":          "Active",
  "helloTime":      3,
  "holdTime":       10,
  "priority":       100,
  "group":          0,
  "virtualIP":      "192.168.1.254",
  "authentication": "cisco",
  "rtt":            42
}
```

**Response -- no response**

```json
{
  "success": false,
  "host":    "192.168.1.1",
  "port":    1985,
  "error":   "No response from HSRP router"
}
```

**Note:** This probe sends from state Listen with low priority (50), which is safe -- it will not disrupt an existing HSRP group.

---

### `POST /api/hsrp/listen`

Alias for `/api/hsrp/probe`. Intended for passive discovery but delegates to the probe handler since true passive UDP multicast listening is not possible in Cloudflare Workers.

**Request/Response:** Identical to `/api/hsrp/probe`.

---

### `POST /api/hsrp/coup`

Sends an HSRPv1 Coup message (opcode 1) to attempt Active router election. Useful for testing preemption behavior, discovering authentication requirements, and identifying the current Active router's priority and virtual IP.

**Request**

```json
{
  "host":           "192.168.1.1",  // required
  "port":           1985,            // default 1985
  "group":          0,               // default 0 (HSRP group number, 0-255)
  "priority":       255,             // default 255 (maximum)
  "authentication": "cisco",         // default "cisco"
  "timeout":        10000            // ms, default 10000
}
```

**Response -- response received**

```json
{
  "success":      true,
  "host":         "192.168.1.1",
  "port":         1985,
  "group":        0,
  "priority":     255,
  "tcpConnected": true,
  "coupSent":     true,
  "response": {
    "opCode":         "Resign",
    "state":          "Active",
    "priority":       100,
    "group":          0,
    "virtualIP":      "192.168.1.254",
    "authentication": "cisco"
  },
  "note":      "Our Coup priority exceeds Active router -- election would succeed if preemption is enabled",
  "latencyMs": 38
}
```

**Response -- no response (typical for TCP probing)**

```json
{
  "success":      true,
  "host":         "192.168.1.1",
  "port":         1985,
  "group":        0,
  "priority":     255,
  "tcpConnected": true,
  "coupSent":     true,
  "response":     null,
  "note":         "Coup sent -- no response (HSRP is UDP multicast; TCP responses uncommon). Router received packet if reachable on TCP 1985.",
  "latencyMs":    12
}
```

**Coup behavior per RFC 2281:** A router in Speak or Standby state that sees its own priority is higher than the current Active router's priority sends a Coup to force an election. The Active router should respond with a Resign if it acknowledges defeat. If authentication does not match, the packet is silently dropped.

---

### `POST /api/hsrp/v2-probe`

Sends an HSRPv2 Hello using TLV encoding and parses the response. HSRPv2 adds support for group numbers 0-4095 (vs 0-255 in v1), millisecond-precision timers, and IPv6 virtual addresses.

**Request**

```json
{
  "host":     "192.168.1.1",  // required
  "port":     1985,            // default 1985
  "group":    0,               // default 0 (0-4095 for HSRPv2)
  "priority": 50,              // default 50
  "timeout":  10000            // ms, default 10000
}
```

**Response -- HSRPv2 response received**

```json
{
  "success":      true,
  "host":         "192.168.1.1",
  "port":         1985,
  "group":        0,
  "priority":     50,
  "version":      "HSRPv2",
  "tcpConnected": true,
  "helloSent":    true,
  "response": {
    "tlvType":      1,
    "tlvLen":       34,
    "hsrpVersion":  2,
    "opCode":       "Hello",
    "state":        "Active",
    "ipVersion":    "IPv4",
    "helloTimeMs":  3000,
    "holdTimeMs":   10000,
    "priority":     100,
    "group":        0,
    "virtualIP":    "192.168.1.254"
  },
  "latencyMs": 55
}
```

---

## HSRPv1 Packet Format (RFC 2281)

20 bytes total, carried in UDP to 224.0.0.2:1985:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|   Version     |   Op Code     |     State     |   Hellotime   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|   Holdtime    |   Priority    |     Group     |   Reserved    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
+                   Authentication Data (8 bytes)               +
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    Virtual IP Address (4 bytes)               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

| Offset | Field | Size | Values |
|--------|-------|------|--------|
| 0 | Version | 1 | `0` = HSRPv1 |
| 1 | Op Code | 1 | `0`=Hello, `1`=Coup, `2`=Resign |
| 2 | State | 1 | See state table below |
| 3 | Hellotime | 1 | Seconds between Hellos (default 3) |
| 4 | Holdtime | 1 | Seconds before Active declared down (default 10) |
| 5 | Priority | 1 | 0-255, highest wins (default 100) |
| 6 | Group | 1 | HSRP group number (0-255) |
| 7 | Reserved | 1 | Must be 0x00 |
| 8-15 | Authentication | 8 | Plaintext password, NUL-padded (default "cisco") |
| 16-19 | Virtual IP | 4 | Shared virtual IPv4 address |

---

## HSRPv2 Group State TLV Format

HSRPv2 uses TLV (Type-Length-Value) encoding. The Group State TLV for IPv4:

| Offset | Field | Size | Notes |
|--------|-------|------|-------|
| 0 | TLV Type | 1 | `1` = Group State |
| 1 | TLV Length | 1 | `34` (data bytes following this field) |
| 2 | Version | 1 | `2` = HSRPv2 |
| 3 | Op Code | 1 | `0`=Hello, `1`=Coup, `2`=Resign |
| 4 | State | 1 | Same values as HSRPv1 |
| 5 | IP Version | 1 | `4`=IPv4, `6`=IPv6 |
| 6-7 | Group Number | 2 | Big-endian, 0-4095 |
| 8-13 | Identifier | 6 | Sender MAC address |
| 14 | Priority | 1 | 0-255 (bytes 15-17 reserved) |
| 18-21 | Hello Time | 4 | Milliseconds, big-endian (default 3000) |
| 22-25 | Hold Time | 4 | Milliseconds, big-endian (default 10000) |
| 26-29 | Virtual IP | 4 | IPv4 address |

Total: 30 bytes (2 header + 28 data, plus 6-byte MAC = 36 bytes).

**Key differences from HSRPv1:**
- Group numbers 0-4095 (vs 0-255)
- Millisecond timer resolution (vs seconds)
- TLV encoding (extensible)
- Different multicast address: 224.0.0.102 (vs 224.0.0.2)
- Different virtual MAC prefix: `0000.0c9f.f` (vs `0000.0c07.ac`)
- No plaintext auth field (uses MD5 Authentication TLV instead)

---

## HSRP States

| Value | State | Description |
|-------|-------|-------------|
| 0 | Initial | Starting state; interface just came up or HSRP was just configured |
| 1 | Learn | Router has not determined the virtual IP address and has not yet seen an authenticated Hello from the Active router |
| 2 | Listen | Router knows the virtual IP but is neither Active nor Standby; listens for Hellos from both |
| 4 | Speak | Router sends periodic Hellos and is actively participating in the election; candidate for Active or Standby |
| 8 | Standby | Router is next in line to become Active; sends periodic Hellos |
| 16 | Active | Router is currently forwarding packets sent to the virtual IP/MAC; sends periodic Hellos |

**State progression:** Initial -> Learn -> Listen -> Speak -> Standby -> Active

**Note:** State values are not sequential (0, 1, 2, 4, 8, 16). They use power-of-two encoding. A router seeing state=8 in a Hello knows that sender is the Standby router.

---

## Op Codes

| Value | Name | Purpose |
|-------|------|---------|
| 0 | Hello | Periodic heartbeat; conveys state, priority, group, virtual IP, auth |
| 1 | Coup | Sent by a router with higher priority to preempt the current Active router |
| 2 | Resign | Sent by Active router when relinquishing the active role (shutting down, lost election, or lower priority detected with preemption) |

---

## Election Rules

1. **Highest priority wins.** Default priority is 100 (range 0-255).
2. **Tie-breaker:** If priorities are equal, the router with the highest IP address on the HSRP interface wins.
3. **Preemption:** By default, preemption is disabled. A higher-priority router joining the group will NOT take over from a lower-priority Active router unless `standby preempt` is configured on the higher-priority router.
4. **Coup message:** A router sends a Coup when it has higher priority and preemption is enabled. The Active router responds with a Resign.
5. **Hold time expiry:** If a router does not receive a Hello from the Active router within the hold time (default 10s), it transitions to Speak state and initiates an election.

---

## Authentication

**HSRPv1 (RFC 2281):**
- 8-byte plaintext password in every packet
- Default value: `cisco` (NUL-padded to 8 bytes: `63 69 73 63 6f 00 00 00`)
- Packets with mismatched authentication are silently dropped
- Provides no real security -- visible in packet captures

**HSRPv2:**
- No plaintext auth field in the Group State TLV
- Optional MD5 Authentication TLV (type=4) with key chain support
- Key ID + MD5 digest appended as separate TLV

---

## Known Limitations

### 1. TCP transport instead of UDP multicast

HSRP operates over UDP port 1985 with multicast destination 224.0.0.2 (v1) or 224.0.0.102 (v2). Cloudflare Workers only support TCP sockets via the Sockets API; UDP and multicast are unavailable. This implementation connects via TCP to port 1985, which most routers will not listen on. Responses are unlikely unless the target has been specifically configured for TCP on that port.

### 2. Probe-only, no state machine

The implementation sends individual packets (Hello, Coup) and reads one response. It does not maintain the full HSRP state machine (Initial -> Learn -> Listen -> Speak -> Standby -> Active). There is no continuous Hello sending, no hold timer tracking, and no automatic failover participation.

### 3. HSRPv2 TLV is IPv4-only

The `buildHSRPv2Hello` function generates an IPv4 Group State TLV (ip_version=4, 4-byte virtual IP). HSRPv2's IPv6 support (16-byte virtual IP, different TLV layout) is not implemented.

### 4. No MD5 authentication for HSRPv2

HSRPv2 MD5 authentication uses a separate Authentication TLV (type=4) appended after the Group State TLV. This is not implemented. Probes against HSRPv2 groups with MD5 auth configured will be silently dropped by the router.

### 5. Single `reader.read()` call

All handlers read the response with a single `reader.read()`. If the response spans multiple TCP segments, only the first chunk is parsed. This is unlikely for HSRP's small 20-36 byte packets but is a theoretical limitation.

### 6. No preemption delay or tracking

The Coup endpoint sends a single Coup packet but does not track whether the target actually resigned. In a real HSRP deployment, there is a preemption delay (configurable, default 0) and the Coup sender should monitor for a Resign response before transitioning to Active.

---

## curl Examples

```bash
# HSRPv1 probe -- discover HSRP routers
curl -s -X POST https://portofcall.ross.gg/api/hsrp/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.1"}' | jq .

# HSRPv1 probe with custom timeout
curl -s -X POST https://portofcall.ross.gg/api/hsrp/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.1","port":1985,"timeout":5000}' | jq .

# Send Coup with max priority to test preemption
curl -s -X POST https://portofcall.ross.gg/api/hsrp/coup \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.1","group":0,"priority":255}' | jq .

# Coup with custom authentication
curl -s -X POST https://portofcall.ross.gg/api/hsrp/coup \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.1","group":1,"priority":255,"authentication":"s3cret"}' | jq .

# HSRPv2 probe with group number > 255 (v2-only feature)
curl -s -X POST https://portofcall.ross.gg/api/hsrp/v2-probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.1","group":1000,"priority":50}' | jq .

# Passive listen (alias for probe)
curl -s -X POST https://portofcall.ross.gg/api/hsrp/listen \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.1"}' | jq .
```

---

## Cisco IOS Configuration Reference

```
! Enable HSRP on an interface
interface GigabitEthernet0/0
  ip address 192.168.1.2 255.255.255.0
  standby 0 ip 192.168.1.254        ! Virtual IP for group 0
  standby 0 priority 110             ! Higher than default 100
  standby 0 preempt                  ! Allow this router to take over
  standby 0 authentication cisco     ! Plaintext auth (default)
  standby 0 timers 3 10              ! Hello 3s, Hold 10s (defaults)

! HSRPv2 configuration
  standby version 2
  standby 1000 ip 192.168.1.254      ! Group > 255 requires v2
  standby 1000 priority 150
  standby 1000 preempt delay minimum 30

! Show commands
  show standby                       ! All HSRP groups
  show standby brief                 ! Summary table
  show standby [group] detail        ! Detailed state for a group
  debug standby                      ! Real-time HSRP events
  debug standby packets              ! Packet-level debug
```

---

## HSRPv1 vs HSRPv2 Comparison

| Feature | HSRPv1 (RFC 2281) | HSRPv2 (Cisco proprietary) |
|---------|-------------------|---------------------------|
| Version field | 0 | 2 |
| Encoding | Fixed 20-byte packet | TLV (extensible) |
| Group range | 0-255 | 0-4095 |
| Timer resolution | Seconds | Milliseconds |
| Multicast address | 224.0.0.2 | 224.0.0.102 (IPv4) / ff02::66 (IPv6) |
| Virtual MAC | 0000.0c07.acXX | 0000.0c9f.fXXX |
| Authentication | 8-byte plaintext in packet | MD5 TLV (type 4) |
| IPv6 support | No | Yes |
| Interoperability | v1 and v2 routers in the same group do NOT interoperate |

---

## HSRP State Machine (Simplified)

```
                     +----------+
                     | Initial  |
                     +----+-----+
                          |
                  interface up
                          |
                     +----v-----+
              +----->|  Learn   |<---- virtual IP unknown
              |      +----+-----+
              |           |
              |     Hello received
              |      (has virtual IP)
              |           |
              |      +----v-----+
              |      |  Listen  |<---- knows VIP, not Active/Standby
              |      +----+-----+
              |           |
              |     Active timer expired
              |     OR Standby timer expired
              |           |
              |      +----v-----+
              |      |  Speak   |<---- sending Hellos, election candidate
              |      +----+-----+
              |       /         \
              |      /           \
              | lower prio    highest prio
              |    /               \
              |   v                 v
         +----+-----+        +-----+----+
         | Standby  |------->|  Active   |
         +----------+ coup/  +----------+
                     resign
```

**Transitions that reset to Initial:** interface down, HSRP group removed, or receiving a Hello with a higher-priority router when preemption is enabled (transitions through Speak).

---

## Related Protocols

- **VRRP (RFC 5798):** Open standard alternative to HSRP; similar concept but different packet format, multicast address (224.0.0.18), and election rules (highest priority wins, protocol number 112 over IP).
- **GLBP (Cisco):** Gateway Load Balancing Protocol; like HSRP but distributes traffic across multiple Active routers using different virtual MACs.
- **BFD (RFC 5880):** Bidirectional Forwarding Detection; often paired with HSRP for sub-second failover detection.
