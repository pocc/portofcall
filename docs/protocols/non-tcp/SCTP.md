# ⚠️ NON-TCP PROTOCOL - NOT COMPATIBLE WITH CLOUDFLARE WORKERS

> **Note:** This protocol does not use TCP as its primary transport mechanism. It cannot be implemented using Cloudflare Workers' Sockets API (`connect()`), which only supports TCP connections. This protocol is documented here for reference but requires alternative implementation approaches (native UDP/IP sockets, specialized gateways, or protocol translation).


## Overview

**SCTP** is a transport-layer protocol providing features of both TCP and UDP. It offers reliable, message-oriented delivery with multi-homing and multi-streaming capabilities. Used in telecom (SS7 over IP), WebRTC data channels, and high-availability systems.

**Port:** Variable (application-specific)
**Transport:** IP Protocol 132
**RFC:** 4960

## Protocol Specification

SCTP provides:
- **Multi-streaming**: Multiple independent streams in one association
- **Multi-homing**: Multiple IP addresses per endpoint
- **Message-oriented**: Preserves message boundaries (unlike TCP)
- **Heartbeat**: Built-in keepalive mechanism
- **Selective ACK**: Like TCP SACK

## Resources

- **RFC 4960**: Stream Control Transmission Protocol
- [Linux SCTP](https://www.kernel.org/doc/html/latest/networking/sctp.html)

## Notes

- **Telecom**: Replaces SS7 in modern networks
- **WebRTC**: Used for data channels
- **vs TCP**: Multi-streaming prevents head-of-line blocking
- **vs UDP**: Reliable delivery with congestion control
- **Multi-homing**: Automatic failover between network paths
