# SOCKS4 Protocol

## Overview

**SOCKS4** is a protocol for proxying TCP connections through a firewall. It's the original version of SOCKS, providing basic connection proxying without authentication. SOCKS4a extended it with hostname resolution support.

**Port:** 1080 (default)
**Transport:** TCP
**Status:** Legacy (superseded by SOCKS5)
**RFC:** Not standardized (de facto standard)

## Protocol Specification

### Key Features

1. **TCP Proxying**: Proxy TCP connections through firewall
2. **Simple Protocol**: Minimal overhead, easy to implement
3. **No Authentication**: No built-in authentication (major limitation)
4. **IPv4 Only**: Does not support IPv6
5. **SOCKS4a Extension**: Adds hostname resolution support
6. **Firewall Traversal**: Allows clients behind firewall to connect

### Connection Request

Client sends connection request to SOCKS server:

```
+----+----+----+----+----+----+----+----+----+----+....+----+
| VN | CD | DSTPORT |      DSTIP        | USERID       |NULL|
+----+----+----+----+----+----+----+----+----+----+....+----+
  1    1      2              4           variable       1
```

**Fields:**
- `VN` (1 byte): SOCKS version (0x04)
- `CD` (1 byte): Command code
  - `0x01` - CONNECT (establish TCP connection)
  - `0x02` - BIND (bind port for incoming connection)
- `DSTPORT` (2 bytes): Destination port (network byte order)
- `DSTIP` (4 bytes): Destination IP address
- `USERID` (variable): User ID string (optional)
- `NULL` (1 byte): Null terminator (0x00)

### SOCKS4a Extension

For hostname resolution, use special IP format:

```
DSTIP: 0.0.0.x (where x is non-zero)
```

Followed by:
```
+----+----+....+----+----+----+....+----+
| USERID       |NULL| HOSTNAME    |NULL|
+----+----+....+----+----+----+....+----+
  variable       1    variable      1
```

### Server Response

```
+----+----+----+----+----+----+----+----+
| VN | CD | DSTPORT |      DSTIP        |
+----+----+----+----+----+----+----+----+
  1    1      2              4
```

**Response Codes:**
- `0x5A` (90) - Request granted
- `0x5B` (91) - Request rejected or failed
- `0x5C` (92) - Request failed (client not reachable)
- `0x5D` (93) - Request failed (userid mismatch)

### Command Codes

- `0x01` - **CONNECT**: Establish TCP connection
- `0x02` - **BIND**: Set up port binding for incoming connection

## Resources

- [SOCKS4 Protocol](https://www.openssh.com/txt/socks4.protocol)
- [SOCKS4a Extension](https://www.openssh.com/txt/socks4a.protocol)
- [SOCKS Wikipedia](https://en.wikipedia.org/wiki/SOCKS)
- [Dante SOCKS Server](https://www.inet.no/dante/)

## Notes

- **No Authentication**: Major security weakness vs SOCKS5
- **IPv4 Only**: Cannot handle IPv6 addresses
- **SOCKS4a**: Adds hostname support via special IP encoding
- **vs SOCKS5**: SOCKS5 adds authentication, UDP, IPv6
- **Firewall Traversal**: Original use case in 1990s
- **SSH Tunneling**: SSH can act as SOCKS4 proxy (`ssh -D`)
- **Browser Support**: Older browsers supported SOCKS4
- **No UDP**: TCP connections only (no UDP proxying)
- **Port Binding**: BIND command for FTP PORT mode (rarely used)
- **User ID**: Optional field, not used for authentication
- **Legacy Status**: SOCKS5 preferred for all new implementations
- **Performance**: Minimal overhead due to simple protocol
- **Security**: No encryption (use SSH tunnel for security)
- **Tor**: Early Tor versions used SOCKS4a
- **Common Ports**: 1080 (standard), 1081, 9050 (Tor)
