# Impossible to Implement on Cloudflare Workers

This document tracks protocols that **cannot** be implemented on Cloudflare Workers due to technical limitations.

## ❌ Impossible Protocols

### UDP-Based Protocols

Cloudflare Workers Sockets API only supports **TCP connections**. All UDP-based protocols are impossible:

#### NTP (Network Time Protocol)
- **Port**: 123/UDP
- **Reason**: UDP only, no TCP equivalent
- **Alternative**: Use browser's `Date()` or HTTP-based time APIs

#### SNMP (Simple Network Management Protocol)
- **Port**: 161/UDP, 162/UDP
- **Reason**: Primarily UDP-based
- **Alternative**: Use SNMP over TCP gateways (rare)

#### DNS (Domain Name System)
- **Port**: 53/UDP (53/TCP for zone transfers)
- **Reason**: Standard queries use UDP, TCP rarely used
- **Alternative**: Use DoH (DNS over HTTPS) via fetch API
- **Note**: We use DNS for Cloudflare detection via DoH

#### TFTP (Trivial File Transfer Protocol)
- **Port**: 69/UDP
- **Reason**: UDP only
- **Alternative**: Use FTP (already implemented)

#### BACnet/IP (Building Automation and Control Networks)
- **Port**: 47808/UDP
- **Reason**: UDP only (ASHRAE 135 BACnet/IP standard)
- **Alternative**: BACnet/WS uses HTTPS/WebSockets but is rarely deployed

#### DHCP (Dynamic Host Configuration Protocol)
- **Port**: 67/UDP (server), 68/UDP (client)
- **Reason**: UDP only
- **Alternative**: Not applicable for browser context

#### RTP/RTCP (Real-time Transport Protocol)
- **Port**: Variable/UDP
- **Reason**: UDP only, requires low latency
- **Alternative**: WebRTC for browser-based real-time media

#### SIP (Session Initiation Protocol)
- **Port**: 5060/UDP (primary), 5060/TCP (fallback)
- **Reason**: Primarily UDP, requires bidirectional communication
- **Alternative**: WebRTC for VoIP

#### SSDP (Simple Service Discovery Protocol / UPnP)
- **Port**: 1900/UDP (multicast 239.255.255.250)
- **Reason**: UDP-only protocol; there is no TCP mode for SSDP
- **Note**: The device description XML (LOCATION header) is fetched over HTTP/TCP, but the discovery protocol itself is UDP multicast only
- **Alternative**: Fetch device description XML directly via HTTP if the LOCATION URL is known

#### LLMNR (Link-Local Multicast Name Resolution)
- **Port**: 5355/UDP (multicast 224.0.0.252 / FF02::1:3)
- **Reason**: Primarily UDP multicast; TCP is theoretically defined in RFC 4795 as a truncation fallback but no real implementation uses it
- **Note**: Even if TCP LLMNR worked, the protocol is link-local — it only functions on the same network segment. Connecting from Cloudflare's edge would never reach a link-local LLMNR responder
- **Alternative**: Use DNS or mDNS for local name resolution

#### Mosh (Mobile Shell)
- **Port**: 60000+/UDP
- **Reason**: UDP only — Mosh uses SSH only for initial authentication, then switches to its own UDP-based protocol (SSP) for the actual session
- **Alternative**: SSH (already implemented) for remote terminal access

#### StatsD
- **Port**: 8125/UDP
- **Reason**: UDP only — StatsD's fire-and-forget design is intentionally UDP-based
- **Alternative**: Use Graphite (plaintext TCP, already implemented) or Prometheus (HTTP) for metrics ingestion

### Raw Socket Protocols

#### ICMP (Internet Control Message Protocol)
- **Reason**: Requires raw sockets, not available in Workers
- **Note**: TCP Ping implemented as alternative
- **Alternative**: Use TCP handshake for connectivity testing

#### RAW IP
- **Reason**: No raw socket access in Workers runtime
- **Alternative**: Use TCP/HTTP proxies


### Protocol Negotiation Limitations

#### HTTP/2 (h2 over TLS)
- **Port**: 443
- **Reason**: Requires TLS ALPN negotiation (`h2` token). When using `connect()` with `secureTransport: 'on'`, the TLS handshake is handled opaquely by the Workers runtime — there is no API to set ALPN extensions or read what was negotiated. Without ALPN, a TLS server will fall back to HTTP/1.1.
- **Alternative**: `fetch()` uses HTTP/2 transparently at the Cloudflare infrastructure level

#### HTTP/2 cleartext (h2c over TCP)
- **Port**: 80
- **Status**: ⚠️ Technically possible to send the bytes, but impractical
- **Reason**: h2c requires no ALPN — the connection preface (`PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n`) is sent over plain TCP, which Workers can do. However, implementing HTTP/2 binary framing (HPACK header compression, multiplexed streams, flow control, SETTINGS negotiation) in Workers JS from scratch is an enormous undertaking, and no suitable library exists for the Workers runtime. Additionally, h2c is almost never enabled on production servers.
- **Alternative**: `fetch()` for any real HTTP/2 use case

#### gRPC (over TLS)
- **Port**: 50051 (convention, any port)
- **Reason**: gRPC requires HTTP/2 as its transport. Over TLS, this hits the same ALPN limitation as h2 above.
- **Alternative**: `fetch()` with `Content-Type: application/grpc-web` for gRPC-Web endpoints

#### gRPC (over h2c / plaintext)
- **Port**: 50051 (convention, any port)
- **Status**: ⚠️ Technically possible to send the bytes, but impractical
- **Reason**: Same as h2c above — no ALPN needed, but requires a full HTTP/2 framing implementation in JS. Some internal/service-mesh deployments do use gRPC over h2c, so the use case is more realistic than h2c for general HTTP, but the implementation barrier is the same.
- **Alternative**: `fetch()` with `Content-Type: application/grpc-web` if the server supports gRPC-Web

## Cloudflare Containers

Cloudflare Containers run Docker images inside isolated VMs alongside Workers. They remove several Workers limitations:

- **Full TLS control**: Containers can use Node.js `tls.connect()` with `ALPNProtocols: ['h2']`, enabling HTTP/2 and gRPC over TLS.
- **h2c with libraries**: Node.js ships a full HTTP/2 implementation; no need to implement framing from scratch.
- **Long-lived streaming**: Containers are not subject to the Workers 30s request duration limit, making long-lived streaming protocols viable.
- **No CPU time limit**: Workers have a 30s request duration limit; containers have no such constraint.

### UDP in Containers: unverified

Containers likely have broader networking than Workers, but **whether Cloudflare Containers support arbitrary outbound UDP is not documented**. The docs only mention `enableInternet` to toggle internet access on/off, without specifying protocol support. It is possible that:

- Outbound UDP is fully supported (containers need UDP DNS to resolve hostnames themselves)
- Or UDP is restricted/tunneled through Cloudflare's network in a way that blocks arbitrary user UDP

Until this is confirmed, UDP-based protocols (NTP, SNMP, TFTP, BACnet, SIP, etc.) should not be assumed to work in Containers.

### Still impossible even with Containers

These remain blocked regardless of Worker vs. Container:

- **SSDP, LLMNR**: Link-local multicast — requires being on the same LAN segment. Unreachable from any cloud provider.
- **ICMP / RAW IP**: Require `CAP_NET_RAW` kernel capability, which is not granted to unprivileged containers by default.

## Protocols Stuck at ★★★★☆

These protocols have solid, useful implementations but are blocked from reaching ★★★★★ by a specific Workers runtime constraint or missing open specification. They are not impossible — they work — but can't go all the way.

### RDP (3389) — Mid-stream TLS upgrade

**Current**: X.224 Connection Request/Confirm → detects security support (Standard/TLS/NLA/RDSTLS).
**Missing**: Credential exchange (NLA / CredSSP).
**Why stuck**: RDP starts as a cleartext TCP connection, then the server issues a `Server Security Data` PDU requesting a TLS upgrade. Workers' `connect()` requires `secureTransport` to be set at connection time — there is no API to upgrade a plain TCP `Socket` to TLS mid-stream. Starting with `secureTransport: 'on'` doesn't work either, because the RDP server expects a cleartext X.224 handshake before any TLS negotiation begins.

### RSH (514) — Privileged source port

**Current**: Full command execution with stdout/stderr separation and exit-code detection.
**Missing**: Accepted by most real rshd daemons.
**Why stuck**: BSD `rshd` requires the client to connect from a **source port < 1024** (a "trusted" port) as a minimal authentication mechanism (RFC 1282). Cloudflare Workers have no API to choose the outbound source port — the runtime assigns an ephemeral port (typically 32768–60999). Real rshd servers will reject the connection with "Rcmd: socket: Permission denied" unless the source port is privileged. The implementation is correct; the runtime simply can't satisfy the server-side precondition.

### mDNS (5353) — UDP multicast

**Current**: Full DNS packet encoding (A/AAAA/PTR/SRV/TXT records) with compression pointer parsing.
**Missing**: Real server responses.
**Why stuck**: mDNS is a UDP multicast protocol (224.0.0.251 / FF02::FB). It has no TCP mode. The implementation sends correctly-formed mDNS queries over TCP to port 5353 as a best-effort probe, but no production mDNS responder listens on TCP — they exclusively use UDP multicast. Additionally, mDNS is link-local; even if TCP worked, Cloudflare's edge is not on the same LAN segment as the target device.

### RIP (520) — UDP-only routing protocol

**Current**: RIPv1/v2 request and response packet parsing + route update generation.
**Missing**: Real router interaction.
**Why stuck**: RIP uses UDP exclusively (RFC 2453 §3). Routers listen on UDP port 520 for RIP messages; no production router implements TCP/520. The implementation correctly encodes RIP packets but cannot elicit a response from a real router over TCP.

### TFTP (69) — UDP only

**Current**: Full RRQ/WRQ/DATA/ACK/ERROR packet encoding with block sequencing.
**Missing**: Real server transfers.
**Why stuck**: TFTP is defined over UDP only (RFC 1350). There is no TCP mode. Like RIP and mDNS, the implementation is protocol-correct but the transport mismatch means no real TFTP server will respond.

---

## Summary

- **UDP Protocols**: 12 (impossible - no UDP support: NTP, SNMP, DNS, TFTP, BACnet/IP, DHCP, RTP/RTCP, SIP, SSDP, LLMNR, Mosh, StatsD)
- **Raw Socket Protocols**: 2 (impossible - no raw socket access: ICMP, RAW IP)
- **TLS ALPN limitation**: 2 (h2 over TLS, gRPC over TLS - ALPN not exposed by sockets API)
- **Impractical (h2c)**: 2 (h2c, gRPC over h2c - TCP bytes sendable but HTTP/2 framing requires full implementation)
- **Stuck at ★★★★☆**: 5 (RDP, RSH, mDNS, RIP, TFTP — each blocked by a specific runtime constraint detailed above)

**Total Impossible/Impractical**: 18 protocols
**Total implementation-ceiling limited**: 5 protocols
