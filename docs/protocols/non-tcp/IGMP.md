# ⚠️ NON-TCP PROTOCOL - NOT COMPATIBLE WITH CLOUDFLARE WORKERS

> **Note:** This protocol does not use TCP as its primary transport mechanism. It cannot be implemented using Cloudflare Workers' Sockets API (`connect()`), which only supports TCP connections. This protocol is documented here for reference but requires alternative implementation approaches (native UDP/IP sockets, specialized gateways, or protocol translation).


## Overview

**IGMP** is used by hosts and routers to establish multicast group memberships. Essential for IP multicast, used in IPTV, video conferencing, and multicast content delivery.

**Port:** N/A (IP Protocol 2)
**Transport:** IP protocol (not TCP/UDP)
**Version:** IGMPv3 (current)

## Protocol Specification

### Message Types

- **Membership Query**: Router asks "who wants this group?"
- **Membership Report**: Host says "I want this group"
- **Leave Group**: Host says "I'm leaving this group"

### Multicast Addresses

- **224.0.0.0/4**: IPv4 multicast range
- **224.0.0.1**: All hosts on subnet
- **224.0.0.2**: All routers on subnet
- **239.0.0.0/8**: Organization-local scope

## Resources

- **RFC 3376**: Internet Group Management Protocol, Version 3
- **RFC 4604**: Using IGMP and MLD

## Notes

- **IP Multicast**: Foundation for multicast routing
- **IPTV**: Used for multicast TV delivery
- **PIM**: Protocol Independent Multicast (routing protocol)
- **Source-Specific Multicast (SSM)**: IGMPv3 feature
- **MLD**: IPv6 equivalent (Multicast Listener Discovery)
- **Snooping**: Switch feature to optimize multicast
