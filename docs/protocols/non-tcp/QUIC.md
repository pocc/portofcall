# ⚠️ NON-TCP PROTOCOL - NOT COMPATIBLE WITH CLOUDFLARE WORKERS

> **Note:** This protocol does not use TCP as its primary transport mechanism. It cannot be implemented using Cloudflare Workers' Sockets API (`connect()`), which only supports TCP connections. This protocol is documented here for reference but requires alternative implementation approaches (native UDP/IP sockets, specialized gateways, or protocol translation).


## Overview

**QUIC** is a modern transport protocol developed by Google, now standardized by IETF. It's the foundation of HTTP/3, providing encrypted, multiplexed connections over UDP with built-in congestion control and 0-RTT connection establishment.

**Port:** 443 (typically)
**Transport:** UDP
**RFC:** 9000

## Protocol Specification

QUIC combines features of TCP, TLS, and HTTP/2:
- **UDP-based**: Avoids TCP head-of-line blocking
- **Built-in TLS 1.3**: Encryption by default
- **Multiplexing**: Multiple streams without head-of-line blocking
- **0-RTT**: Resume connections with zero round-trip time
- **Connection Migration**: Survive IP address changes

### Packet Structure

```
Header Form (1 bit) | Fixed Bit (1 bit) | Packet Type | Version | DCID Len | Destination Connection ID | SCID Len | Source Connection ID | Payload
```

## Resources

- **RFC 9000**: QUIC: A UDP-Based Multiplexed and Secure Transport
- **RFC 9001**: Using TLS to Secure QUIC
- **RFC 9002**: QUIC Loss Detection and Congestion Control
- [Chrome QUIC](https://www.chromium.org/quic/)

## Notes

- **HTTP/3**: Built on QUIC
- **0-RTT**: Faster connection resumption
- **No Head-of-Line Blocking**: Independent streams
- **Mobile-Friendly**: Survives network switches
- **Congestion Control**: Improved over TCP
- **Encrypted Headers**: Better privacy than TCP
