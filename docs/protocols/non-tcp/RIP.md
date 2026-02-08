# ⚠️ NON-TCP PROTOCOL - NOT COMPATIBLE WITH CLOUDFLARE WORKERS

> **Note:** This protocol does not use TCP as its primary transport mechanism. It cannot be implemented using Cloudflare Workers' Sockets API (`connect()`), which only supports TCP connections. This protocol is documented here for reference but requires alternative implementation approaches (native UDP/IP sockets, specialized gateways, or protocol translation).


## Overview

**RIP (Routing Information Protocol)** is one of the oldest distance-vector routing protocols, using hop count as its metric. Despite being largely superseded by more modern protocols like OSPF and EIGRP, RIP is still found in small networks due to its simplicity and ease of configuration.

**Port:** UDP 520
**Transport:** UDP
**Status:** Active but legacy
**RFC:** 1058 (RIPv1), 2453 (RIPv2), 2080 (RIPng for IPv6)

## Protocol Specification

### Key Features

1. **Distance-Vector**: Shares routing tables with neighbors
2. **Hop Count Metric**: Simple metric (max 15 hops, 16 = unreachable)
3. **Periodic Updates**: Broadcasts entire routing table every 30 seconds
4. **Split Horizon**: Prevents routing loops
5. **Route Poisoning**: Advertises failed routes with metric 16
6. **Triggered Updates**: Immediate update on topology change
7. **Hold-down Timers**: Prevents counting to infinity

### RIP Versions

**RIPv1 (1988):**
- Classful routing (no subnet masks)
- Broadcast updates (255.255.255.255)
- No authentication
- Limited scalability

**RIPv2 (1998):**
- Classless routing (CIDR/VLSM support)
- Multicast updates (224.0.0.9)
- Authentication (plain-text, MD5)
- Route tags for external routes
- Next-hop field

**RIPng (1997):**
- RIP for IPv6
- Multicast to FF02::9
- Based on RIPv2

### RIP Packet Format

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  Command (1)  |  Version (1)  |       Must Be Zero (2)        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|        Address Family Identifier (2)    |  Route Tag (2)      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                         IP Address (4)                        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                         Subnet Mask (4)                       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                         Next Hop (4)                          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                         Metric (4)                            |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

**Commands:**
- `1` - Request (ask for routing information)
- `2` - Response (routing update)

**Version:**
- `1` - RIPv1
- `2` - RIPv2

**Address Family Identifier:**
- `2` - IP (for IPv4)
- `0xFFFF` - Authentication (RIPv2 first entry)

### Timers

**Update Timer:**
- 30 seconds (default)
- Router sends entire routing table

**Invalid Timer:**
- 180 seconds (6 updates)
- Route marked invalid if not refreshed

**Hold-down Timer:**
- 180 seconds
- Prevents accepting worse routes during convergence

**Flush Timer:**
- 240 seconds (8 updates)
- Route removed from table

### Loop Prevention

**Split Horizon:**
- Don't advertise route back to interface learned from
- Prevents simple 2-router loops

**Split Horizon with Poison Reverse:**
- Advertise route back with metric 16 (unreachable)
- Faster convergence than split horizon alone

**Route Poisoning:**
- Failed route advertised with metric 16
- Informs all routers of failure

**Hold-down:**
- Ignore route updates for hold-down period after route fails
- Prevents counting to infinity

**Triggered Updates:**
- Immediate update when topology changes
- Don't wait for 30-second timer

### Metric

**Hop Count:**
- Number of routers between source and destination
- Each router adds 1 to metric
- Maximum: 15 hops (16 = unreachable)
- Simple but ignores bandwidth, delay

**Limitations:**
- Can't differentiate 10Mbps vs 10Gbps link
- Maximum network diameter: 15 hops
- Inefficient metric for modern networks

### Authentication (RIPv2)

**Plain-text:**
- First route entry contains password
- AFI = 0xFFFF
- 16-character password
- Insecure (visible in packet capture)

**MD5:**
- Cryptographic hash authentication
- Key ID for key rotation
- More secure than plain-text

## Configuration Examples

**Cisco IOS - RIPv2:**
```
# Enable RIP
router rip
 version 2
 network 10.0.0.0
 network 192.168.1.0
 no auto-summary
 passive-interface GigabitEthernet0/0

# Authentication
interface GigabitEthernet0/1
 ip rip authentication mode md5
 ip rip authentication key-chain MY_KEYS

# Key chain
key chain MY_KEYS
 key 1
  key-string MySecretKey
  accept-lifetime 00:00:00 Jan 1 2024 infinite
  send-lifetime 00:00:00 Jan 1 2024 infinite
```

**Cisco IOS - RIPng (IPv6):**
```
# Enable IPv6 routing
ipv6 unicast-routing

# Enable RIPng
ipv6 router rip RIPNG
 redistribute connected

# Interface configuration
interface GigabitEthernet0/0
 ipv6 rip RIPNG enable
```

**Linux - Quagga/FRRouting:**
```
# /etc/quagga/ripd.conf
router rip
 version 2
 network 10.0.0.0/8
 network 192.168.1.0/24
 redistribute connected
 passive-interface eth0
```

## Loop Example

**Counting to Infinity Problem:**
```
Network: R1 -- R2 -- R3
Route: 10.0.0.0/24 behind R3

Initial:
R1: 10.0.0.0/24 via R2, metric 2
R2: 10.0.0.0/24 via R3, metric 1
R3: 10.0.0.0/24 directly connected, metric 0

R3 fails:
Update 1: R2 hears 10.0.0.0/24 from R1 with metric 2
          R2 updates to metric 3 (2+1)
Update 2: R1 hears 10.0.0.0/24 from R2 with metric 3
          R1 updates to metric 4 (3+1)
Update 3: R2 hears 10.0.0.0/24 from R1 with metric 4
          R2 updates to metric 5 (4+1)
...continues until metric 16 (unreachable)

Solution: Split horizon, route poisoning, hold-down
```

## Resources

- **RFC 1058**: Routing Information Protocol (RIPv1)
- **RFC 2453**: RIP Version 2
- **RFC 2080**: RIPng for IPv6
- **RFC 2082**: RIP-2 MD5 Authentication
- [Quagga Routing Suite](https://www.quagga.net/)
- [FRRouting](https://frrouting.org/)

## Notes

- **vs OSPF**: RIP simpler but slower convergence, limited to 15 hops
- **vs EIGRP**: EIGRP faster, better metric, proprietary to Cisco
- **vs BGP**: RIP is IGP, BGP is EGP
- **Distance-Vector**: Shares routing tables, not topology
- **Bellman-Ford**: Uses Bellman-Ford algorithm
- **Hop Count Limit**: Maximum 15 hops, 16 = infinity
- **Slow Convergence**: Can take minutes to converge
- **Bandwidth Waste**: Full table every 30 seconds
- **Classful (v1)**: No VLSM/CIDR support
- **Classless (v2)**: VLSM/CIDR support
- **Auto-summary**: RIPv2 can auto-summarize at classful boundaries
- **Multicast**: RIPv2 uses 224.0.0.9 (reduces broadcast traffic)
- **Simple**: Easy to configure and troubleshoot
- **Legacy**: Declining use, replaced by OSPF/EIGRP
- **Small Networks**: Still suitable for very small, simple networks
- **Educational**: Good for learning routing concepts
- **Administrative Distance**: 120 (less preferred than OSPF 110)
- **Passive Interface**: Advertise network without sending updates
