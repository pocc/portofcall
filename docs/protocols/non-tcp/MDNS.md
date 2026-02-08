# ⚠️ NON-TCP PROTOCOL - NOT COMPATIBLE WITH CLOUDFLARE WORKERS

> **Note:** This protocol does not use TCP as its primary transport mechanism. It cannot be implemented using Cloudflare Workers' Sockets API (`connect()`), which only supports TCP connections. This protocol is documented here for reference but requires alternative implementation approaches (native UDP/IP sockets, specialized gateways, or protocol translation).


## Overview

**mDNS** (Multicast DNS) is a protocol that resolves hostnames to IP addresses within small networks without a DNS server. Also known as **Bonjour** (Apple), **Avahi** (Linux), or **Zero-configuration networking**. It's used for printer discovery, AirPlay, Chromecast, and local service discovery.

**Port:** 5353 (UDP)
**Transport:** UDP multicast
**Address:** 224.0.0.251 (IPv4), ff02::fb (IPv6)
**RFC:** 6762

## Protocol Specification

### Message Format

mDNS uses standard DNS packet format:

```
Header (12 bytes)
| Question Section (variable)
| Answer Section (variable)
| Authority Section (variable)
| Additional Section (variable)
```

### Multicast Addresses

- **IPv4**: 224.0.0.251:5353
- **IPv6**: [ff02::fb]:5353

### Query Types

- **PTR**: Service discovery (e.g., _http._tcp.local)
- **SRV**: Service location (hostname and port)
- **TXT**: Service metadata
- **A**: IPv4 address
- **AAAA**: IPv6 address

### Service Discovery

Services advertised as: `_service._proto.local`

**Examples:**
- `_http._tcp.local` - HTTP servers
- `_ssh._tcp.local` - SSH servers
- `_printer._tcp.local` - Printers
- `_airplay._tcp.local` - AirPlay devices
- `_googlecast._tcp.local` - Chromecast

### Example Query/Response

**Query**: "What HTTP servers are on this network?"
```
Query: _http._tcp.local PTR?
```

**Response**:
```
Answer: _http._tcp.local PTR webserver._http._tcp.local
Additional:
  webserver._http._tcp.local SRV 0 0 8080 myserver.local
  myserver.local A 192.168.1.100
  webserver._http._tcp.local TXT "path=/api" "version=1.0"
```

## Resources

- **RFC 6762**: Multicast DNS
- **RFC 6763**: DNS-Based Service Discovery
- [Apple Bonjour](https://developer.apple.com/bonjour/)
- [Avahi](https://www.avahi.org/) - Linux implementation

## Notes

- **Zero Configuration**: No DNS server required
- **Local Network Only**: Multicast doesn't route beyond local network
- **.local TLD**: Reserved for mDNS
- **Continuous Announcement**: Services periodically announce themselves
- **Cache Flush**: Bit set to flush old cached records
- **Conflict Resolution**: Handles name conflicts automatically
- **TTL**: Short time-to-live (120 seconds typical)
- **Known Answer Suppression**: Don't answer if questioner already knows
- **Apple Bonjour**: macOS/iOS implementation
- **Windows**: Not enabled by default, requires Bonjour service
- **Use Cases**: Printer discovery, AirPlay, Chromecast, file sharing, local APIs
