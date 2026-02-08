# ⚠️ NON-TCP PROTOCOL - NOT COMPATIBLE WITH CLOUDFLARE WORKERS

> **Note:** This protocol does not use TCP as its primary transport mechanism. It cannot be implemented using Cloudflare Workers' Sockets API (`connect()`), which only supports TCP connections. This protocol is documented here for reference but requires alternative implementation approaches (native UDP/IP sockets, specialized gateways, or protocol translation).


## Overview

**RSVP (Resource Reservation Protocol)** is a signaling protocol used to reserve network resources along a path for quality of service (QoS). It enables applications to request specific bandwidth, latency, and jitter characteristics from the network, commonly used for VoIP, video conferencing, and MPLS traffic engineering.

**Port:** IP Protocol 46 (not TCP/UDP)
**Transport:** Raw IP packets
**Status:** Active standard
**RFC:** 2205 (base), 3209 (MPLS extensions)

## Protocol Specification

### Key Features

1. **Resource Reservation**: Reserve bandwidth, buffer space along path
2. **Receiver-Initiated**: Receivers request reservations (not senders)
3. **Soft State**: Periodic refresh required, state times out
4. **Path Coupling**: Follows routing protocol's path decisions
5. **MPLS Integration**: RSVP-TE for MPLS label distribution
6. **Multicast Support**: Supports both unicast and multicast
7. **Admission Control**: Routers accept/reject based on resources

### RSVP Message Types

**Path Messages (Sender → Receiver):**
- `PATH` - Describes sender's traffic characteristics
- `PATH_TEAR` - Tear down path state
- `PATH_ERR` - Report path errors

**Reservation Messages (Receiver → Sender):**
- `RESV` - Request resource reservation
- `RESV_TEAR` - Tear down reservation state
- `RESV_ERR` - Report reservation errors
- `RESV_CONF` - Confirm reservation

**Refresh/Keepalive:**
- Soft state requires periodic refresh (default 30 seconds)

### Message Structure

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Vers  | Flags |  Msg Type     |        RSVP Checksum          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  Send_TTL     | (Reserved)    |        RSVP Length            |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
//                        Object List                          //
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

**Message Types:**
- `1` - PATH
- `2` - RESV
- `3` - PATH_ERR
- `4` - RESV_ERR
- `5` - PATH_TEAR
- `6` - RESV_TEAR
- `7` - RESV_CONF

### RSVP Objects

**SESSION:**
- Destination address
- Protocol ID
- Destination port
- Uniquely identifies session

**SENDER_TEMPLATE:**
- Sender IP address
- Sender port
- Identifies specific sender

**SENDER_TSPEC (Traffic Specification):**
- Token bucket parameters
- Peak rate (p)
- Bucket size (b)
- Minimum policed unit (m)
- Maximum packet size (M)

**FLOWSPEC (Flow Specification):**
- Requested service level
- Includes TSPEC + RSPEC (reservation spec)
- Bandwidth, delay, jitter requirements

**FILTER_SPEC:**
- Selects subset of sender traffic
- Used with FLOWSPEC in RESV

**ADSPEC (Advertisement Specification):**
- Path characteristics
- Available bandwidth
- Latency, MTU

**ERROR_SPEC:**
- Error code and value
- Node address where error occurred

### Service Classes

**Guaranteed Service:**
- Provides firm delay bound
- No queuing loss
- Token bucket rate enforced
- Use case: Interactive video, VoIP

**Controlled Load:**
- Approximates best-effort under light load
- No specific guarantees
- Use case: Adaptive applications

**Best Effort:**
- No QoS guarantees
- Default IP service

### Reservation Styles

**Fixed Filter (FF):**
- Separate reservation per sender
- Explicit sender selection
- Most bandwidth-intensive

**Wildcard Filter (WF):**
- Single shared reservation
- Any sender can use
- Bandwidth-efficient for multicast

**Shared Explicit (SE):**
- Shared reservation
- Explicit sender list
- Middle ground

### Token Bucket Parameters

```
Token Bucket Rate (r): bytes/second
Token Bucket Size (b): bytes
Peak Rate (p): bytes/second
Minimum Policed Unit (m): bytes
Maximum Packet Size (M): bytes
```

**Example:**
```
r = 1,000,000 bps (1 Mbps sustained)
b = 10,000 bytes (burst)
p = 5,000,000 bps (5 Mbps peak)
m = 512 bytes (min packet)
M = 1500 bytes (MTU)
```

### Operation Flow

**Setup:**
1. Sender sends PATH message with SENDER_TSPEC
2. PATH travels toward receiver, installing path state
3. Receiver sends RESV message with FLOWSPEC
4. RESV travels toward sender, installing reservation state
5. Each router performs admission control
6. If successful, RESV_CONF sent to receiver

**Refresh:**
- PATH/RESV refreshed every 30 seconds (default)
- State times out after 3 refresh periods (90 seconds)
- Prevents stale reservations

**Teardown:**
- Explicit: PATH_TEAR or RESV_TEAR
- Implicit: Refresh timeout

## RSVP-TE (Traffic Engineering)

**MPLS Extensions (RFC 3209):**
- Label distribution for MPLS
- Explicit routing (ERO - Explicit Route Object)
- Fast reroute for protection
- Bandwidth reservation for LSPs

**LSP Setup:**
1. Ingress sends PATH with ERO (explicit path)
2. PATH includes LABEL_REQUEST
3. Each hop allocates label
4. RESV carries labels back to ingress
5. LSP established

## Configuration Examples

**Cisco IOS - RSVP:**
```
# Enable RSVP on interface
interface GigabitEthernet0/0
 ip rsvp bandwidth 10000 5000

# RSVP neighbor
ip rsvp neighbor 192.168.1.2

# RSVP authentication
ip rsvp authentication key-chain MY_KEY
```

**Linux - RSVP (rsvpd):**
```bash
# Start RSVP daemon
rsvpd -d

# Reserve bandwidth
rsvp_reserve -d 192.168.1.100 -p 5004 -b 1000000
```

## Resources

- **RFC 2205**: Resource Reservation Protocol (RSVP) -- Version 1
- **RFC 2210**: The Use of RSVP with IETF Integrated Services
- **RFC 3209**: RSVP-TE: Extensions to RSVP for LSP Tunnels
- **RFC 2961**: RSVP Refresh Overhead Reduction Extensions
- [RSVP-TE Configuration Guide](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/mp_te_rsvp/configuration/xe-16/mp-te-rsvp-xe-16-book.html)

## Notes

- **vs DiffServ**: RSVP is per-flow, DiffServ is per-class
- **vs IntServ**: IntServ is QoS architecture, RSVP is signaling
- **Receiver-Initiated**: Unusual design, receivers request reservations
- **Soft State**: Requires periodic refresh (every 30s default)
- **Scalability**: Per-flow state limits scalability
- **MPLS**: RSVP-TE widely used for MPLS label distribution
- **Admission Control**: Routers can reject if resources unavailable
- **Path Coupling**: Follows IP routing, doesn't set routes
- **Multicast**: Supports multicast reservations (complex)
- **IPv6**: RSVP works with IPv6
- **TTL**: Send_TTL detects non-RSVP routers
- **Priority**: Preemption possible for higher-priority flows
- **Policing**: Token bucket enforces traffic limits
- **Latency**: Can request specific delay bounds
- **Jitter**: Can request jitter limits
- **Enterprise**: Limited deployment in enterprises
- **MPLS Core**: Widely deployed for MPLS-TE in service providers
- **VoIP**: Can provide QoS for voice traffic
- **Video**: Interactive video benefits from guaranteed service
