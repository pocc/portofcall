# ⚠️ NON-TCP PROTOCOL - NOT COMPATIBLE WITH CLOUDFLARE WORKERS

> **Note:** This protocol does not use TCP as its primary transport mechanism. It cannot be implemented using Cloudflare Workers' Sockets API (`connect()`), which only supports TCP connections. This protocol is documented here for reference but requires alternative implementation approaches (native UDP/IP sockets, specialized gateways, or protocol translation).


## Overview

**VRRP (Virtual Router Redundancy Protocol)** provides automatic failover of gateway routers through the assignment of a virtual IP address to multiple routers. When the master router fails, a backup automatically takes over, ensuring network availability without manual intervention.

**Port:** IP Protocol 112 (not TCP/UDP)
**Transport:** Raw IP packets
**Status:** Active standard
**RFC:** 5798 (VRRPv3), 3768 (VRRPv2)

## Protocol Specification

### Key Features

1. **Automatic Failover**: Seamless master router replacement
2. **Virtual IP**: Shared IP address among router group
3. **Priority-Based**: Highest priority becomes master
4. **Preemption**: Higher priority router can reclaim master role
5. **IPv4 and IPv6**: VRRPv3 supports both (VRRPv2 IPv4 only)
6. **Sub-Second Failover**: Typically 1-3 seconds
7. **No Configuration on Hosts**: Hosts use virtual IP as gateway

### VRRP Roles

**Master Router:**
- Owns the virtual IP address
- Sends VRRP advertisements
- Forwards packets for virtual IP
- Highest priority (or highest IP if tied)

**Backup Router:**
- Listens for master advertisements
- Takes over if master fails
- Does not forward packets (standby)

### Packet Format

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|Version| Type  | Virtual Rtr ID|   Priority    |Count IPvX Addr|
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|(rsvd) |     Max Adver Int     |          Checksum             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                   IPvX Address(es)                            |
+                                                               +
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

**Fields:**
- **Version**: Protocol version (2 or 3)
- **Type**: Packet type (1 = ADVERTISEMENT)
- **Virtual Rtr ID**: Virtual router identifier (1-255)
- **Priority**: Election priority (1-255, 255 = IP address owner)
- **Count IPvX Addr**: Number of IP addresses
- **Max Adver Int**: Advertisement interval (centiseconds)
- **Checksum**: IP checksum
- **IPvX Address(es)**: Virtual IP addresses

### Advertisement Timing

**Default:**
- Advertisement Interval: 1 second
- Master_Down_Interval: (3 × Advert_Interval) + Skew_Time
- Skew_Time: ((256 - Priority) / 256)

**Typical Failover:**
- ~3 seconds with default settings
- Can be tuned to sub-second (not recommended for WAN)

### Priority

- **255**: IP address owner (router with configured IP)
- **100**: Default priority
- **1-254**: Configurable priorities
- **0**: Master releasing role (immediate failover)

### State Machine

**States:**
- **Initialize**: Startup state
- **Backup**: Listening for advertisements
- **Master**: Sending advertisements, forwarding traffic

**Transitions:**
- Initialize → Backup (on startup)
- Backup → Master (master timeout or higher priority)
- Master → Backup (higher priority advertisement received)

### Virtual MAC Address

VRRPv2 (IPv4):
- `00-00-5E-00-01-{VRID}`

VRRPv3 (IPv4):
- `00-00-5E-00-02-{VRID}`

VRRPv3 (IPv6):
- `00-00-5E-00-02-{VRID}`

### Multicast Addresses

**VRRPv2 (IPv4):**
- `224.0.0.18`

**VRRPv3 (IPv4):**
- `224.0.0.18`

**VRRPv3 (IPv6):**
- `FF02::12`

## Configuration Examples

**Cisco:**
```
interface GigabitEthernet0/0
 ip address 192.168.1.1 255.255.255.0
 vrrp 1 ip 192.168.1.254
 vrrp 1 priority 150
 vrrp 1 preempt
```

**Keepalived (Linux):**
```
vrrp_instance VI_1 {
    state MASTER
    interface eth0
    virtual_router_id 51
    priority 150
    advert_int 1
    authentication {
        auth_type PASS
        auth_pass secret123
    }
    virtual_ipaddress {
        192.168.1.254
    }
}
```

## Resources

- **RFC 5798**: Virtual Router Redundancy Protocol (VRRPv3)
- **RFC 3768**: Virtual Router Redundancy Protocol (VRRPv2)
- [Keepalived](https://www.keepalived.org/) - Linux VRRP implementation
- [FRRouting](https://frrouting.org/) - Open source routing suite with VRRP

## Notes

- **vs HSRP**: Cisco proprietary, similar concept
- **vs GLBP**: Cisco proprietary, load balancing variant
- **vs CARP**: BSD-specific, similar concept
- **IP Protocol 112**: Not TCP or UDP, raw IP packets
- **Multicast**: Uses multicast for advertisements
- **Virtual MAC**: ARP resolved to virtual MAC address
- **Preemption**: Configurable (higher priority takes over)
- **Authentication**: VRRPv2 supports simple password auth (insecure)
- **No Auth in VRRPv3**: Authentication removed in VRRPv3
- **IPv6 Support**: VRRPv3 only (VRRPv2 is IPv4 only)
- **Gratuitous ARP**: Master sends GARP on takeover
- **Multiple VRIDs**: Can run multiple VRRP instances per interface
- **Load Balancing**: Not built-in (use multiple VRIDs)
- **Tracking**: Can track interface status to adjust priority
- **Failback**: Preemption causes failback when master returns
- **Vendor Interop**: Standard protocol, works across vendors
- **Use Cases**: Gateway redundancy, load balancer HA, firewall HA
