# ⚠️ NON-TCP PROTOCOL - NOT COMPATIBLE WITH CLOUDFLARE WORKERS

> **Note:** This protocol does not use TCP as its primary transport mechanism. It cannot be implemented using Cloudflare Workers' Sockets API (`connect()`), which only supports TCP connections. This protocol is documented here for reference but requires alternative implementation approaches (native UDP/IP sockets, specialized gateways, or protocol translation).


## Overview

**L2TP** is a tunneling protocol used to support VPNs. Often combined with IPsec (L2TP/IPsec) for encryption. It creates a tunnel between L2TP Access Concentrator (LAC) and L2TP Network Server (LNS).

**Port:** 1701 (UDP)
**Transport:** UDP
**RFC:** 2661 (L2TPv2), 3931 (L2TPv3)

## Protocol Specification

L2TP packets consist of control and data messages encapsulated in UDP datagrams.

## Resources

- **RFC 2661**: Layer Two Tunneling Protocol "L2TP"
- **RFC 3931**: Layer Two Tunneling Protocol - Version 3 (L2TPv3)

## Notes

- **L2TP/IPsec**: Common VPN combination
- **No Encryption**: L2TP alone doesn't encrypt; use with IPsec
- **NAT Traversal**: Requires special handling
- **Port**: UDP 1701
- **Windows VPN**: Built-in Windows VPN client supports L2TP/IPsec
