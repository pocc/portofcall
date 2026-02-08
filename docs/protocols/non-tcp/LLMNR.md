# ⚠️ NON-TCP PROTOCOL - NOT COMPATIBLE WITH CLOUDFLARE WORKERS

> **Note:** This protocol does not use TCP as its primary transport mechanism. It cannot be implemented using Cloudflare Workers' Sockets API (`connect()`), which only supports TCP connections. This protocol is documented here for reference but requires alternative implementation approaches (native UDP/IP sockets, specialized gateways, or protocol translation).


## Overview

**LLMNR** is a Microsoft protocol for name resolution on local networks when DNS is unavailable. Similar to mDNS but used primarily on Windows networks. Allows computers to resolve hostnames on the same subnet.

**Port:** 5355 (UDP/TCP)
**Transport:** UDP multicast (primary), TCP (fallback)
**Address:** 224.0.0.252 (IPv4), ff02::1:3 (IPv6)

## Protocol Specification

LLMNR uses DNS packet format for queries and responses over multicast.

**Query**: Computer sends multicast query for a name
**Response**: Computer with that name responds unicast

## Resources

- **RFC 4795**: Link-Local Multicast Name Resolution (LLMNR)

## Notes

- **Windows**: Enabled by default on Windows
- **Security Issues**: Vulnerable to spoofing and poisoning
- **NetBIOS Successor**: Replaces NetBIOS name resolution
- **vs mDNS**: Windows-specific, similar functionality
- **Disable if Unused**: Often disabled for security
