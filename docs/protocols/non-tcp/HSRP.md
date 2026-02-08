# ⚠️ NON-TCP PROTOCOL - NOT COMPATIBLE WITH CLOUDFLARE WORKERS

> **Note:** This protocol does not use TCP as its primary transport mechanism. It cannot be implemented using Cloudflare Workers' Sockets API (`connect()`), which only supports TCP connections. This protocol is documented here for reference but requires alternative implementation approaches (native UDP/IP sockets, specialized gateways, or protocol translation).


## Overview

**HSRP (Hot Standby Router Protocol)** is Cisco's proprietary protocol for providing gateway redundancy. Similar to VRRP, HSRP allows multiple routers to work together to present the appearance of a single virtual router, providing automatic failover if the active router fails.

**Port:** UDP 1985
**Transport:** UDP
**Status:** Cisco proprietary (active)
**Version:** HSRPv1 (legacy), HSRPv2 (current)

## Protocol Specification

### Key Features

1. **Automatic Failover**: Active router failure triggers immediate failover
2. **Virtual IP/MAC**: Shared virtual IP and MAC address
3. **Priority-Based**: Highest priority becomes active router
4. **Preemption**: Optional preemption when higher priority router returns
5. **Object Tracking**: Monitor interfaces/routes to adjust priority
6. **Load Balancing**: Multiple HSRP groups for traffic distribution
7. **Millisecond Timers**: Sub-second failover possible

### HSRP Roles

**Active Router:**
- Forwards packets sent to virtual IP
- Sends HSRP hello messages
- Highest priority (or highest IP if tied)

**Standby Router:**
- Second-highest priority router
- Ready to take over if active fails
- Monitors active router hellos

**Other Routers:**
- Listen to hellos
- Wait for active/standby to fail

### Packet Format (HSRPv2)

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|   Version=20  |   Op Code     |     State     |   IP Ver=4/6  |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|   Group       |  Identifier   |    Priority   | Reserved      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       Hello Time (ms)                         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       Hold Time (ms)                          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    Virtual IP Address                         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### Op Codes

- `0` - Hello (periodic advertisement)
- `1` - Coup (claiming active role)
- `2` - Resign (giving up active role)

### States

- `0` - Initial
- `1` - Learn
- `2` - Listen
- `4` - Speak
- `8` - Standby
- `16` - Active

### Priority

- **255**: Reserved (cannot be configured)
- **100**: Default priority
- **1-254**: Configurable priorities
- **0**: Router relinquishing active role

### Virtual MAC Addresses

**HSRPv1:**
- `00-00-0C-07-AC-{group}` (group 0-255)

**HSRPv2:**
- `00-00-0C-9F-F{0-F}{group}` (group 0-4095)

### Multicast Addresses

**HSRPv1 (IPv4):**
- `224.0.0.2` (all routers)

**HSRPv2 (IPv4):**
- `224.0.0.102`

**HSRPv2 (IPv6):**
- `FF02::66`

### Timers

**Default:**
- Hello Interval: 3 seconds
- Hold Time: 10 seconds

**Millisecond Timers (HSRPv2):**
- Hello Interval: Can be as low as 15 ms
- Hold Time: 3 × Hello Interval
- Typical sub-second: 250ms hello, 750ms hold

## Configuration Examples

**Cisco IOS - HSRPv2:**
```
interface GigabitEthernet0/0
 ip address 192.168.1.1 255.255.255.0
 standby version 2
 standby 1 ip 192.168.1.254
 standby 1 priority 150
 standby 1 preempt
 standby 1 timers msec 250 msec 750
```

**With Object Tracking:**
```
track 1 interface GigabitEthernet0/1 line-protocol

interface GigabitEthernet0/0
 standby 1 ip 192.168.1.254
 standby 1 priority 150
 standby 1 preempt
 standby 1 track 1 decrement 60
```

**Load Balancing (Multiple Groups):**
```
interface GigabitEthernet0/0
 ip address 192.168.1.1 255.255.255.0
 standby 1 ip 192.168.1.253
 standby 1 priority 150
 standby 1 preempt
 standby 2 ip 192.168.1.254
 standby 2 priority 100
 standby 2 preempt
```

## Resources

- [Cisco HSRP Documentation](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/ipapp_fhrp/configuration/xe-16/fhp-xe-16-book/fhp-hsrp.html)
- [HSRP Configuration Guide](https://www.cisco.com/c/en/us/support/docs/ip/hot-standby-router-protocol-hsrp/9234-hsrpguidetoc.html)
- RFC 2281 (informational, not a standard)

## Notes

- **vs VRRP**: HSRP is Cisco proprietary, VRRP is standard (RFC 5798)
- **vs GLBP**: GLBP does load balancing, HSRP uses active/standby
- **Cisco Only**: Only works on Cisco devices
- **Group Numbers**: HSRPv1 0-255, HSRPv2 0-4095
- **Preemption**: Disabled by default (unlike VRRP)
- **Authentication**: HSRPv1 supports MD5 authentication
- **IPv6 Support**: HSRPv2 only
- **Object Tracking**: Can track interfaces, IP SLA, routes
- **Load Balancing**: Use multiple HSRP groups with different priorities
- **Gratuitous ARP**: Active router sends GARP on takeover
- **Interface Tracking**: Decrease priority if tracked interface fails
- **BFD Integration**: Can use Bidirectional Forwarding Detection
- **HSRP Groups**: Can run multiple groups per interface
- **Virtual Router**: Appears as single router to hosts
- **Failover Time**: Typically 3-10 seconds (default), sub-second with tuning
- **UDP Port 1985**: HSRP messages sent to this port
- **Use Cases**: Enterprise gateway redundancy, data center, campus networks
