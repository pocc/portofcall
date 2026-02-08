# ⚠️ NON-TCP PROTOCOL - NOT COMPATIBLE WITH CLOUDFLARE WORKERS

> **Note:** This protocol does not use TCP as its primary transport mechanism. It cannot be implemented using Cloudflare Workers' Sockets API (`connect()`), which only supports TCP connections. This protocol is documented here for reference but requires alternative implementation approaches (native UDP/IP sockets, specialized gateways, or protocol translation).


## Overview

**SAP (Session Announcement Protocol)** is a protocol for advertising multicast session information on a local network or the Internet. It's used to announce multimedia conferences, IPTV channels, and other multicast sessions, allowing clients to discover and join sessions automatically.

**Port:** 9875 (UDP)
**Transport:** UDP multicast
**Status:** Active standard  
**RFC:** 2974

## Protocol Specification

### Key Features

1. **Multicast Announcements**: Advertise sessions via multicast
2. **SDP Payload**: Uses SDP to describe sessions
3. **Periodic Updates**: Regular announcement intervals
4. **Session Discovery**: Clients discover available sessions
5. **Deletion Messages**: Announce session termination
6. **IPv4/IPv6 Support**: Works with both protocols
7. **Authentication**: Optional digital signatures
8. **Compression**: Optional payload compression

### SAP Packet Structure

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| V=1 |A|R|T|E|C|   auth len    |         msg id hash           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
:                    originating source (32/128 bits)           :
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    optional authentication data               |
:                              ....                             :
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                      optional payload type                    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
:                           payload                             :
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

**Header Fields:**
- **V**: Version (1)
- **A**: Address type (0=IPv4, 1=IPv6)
- **R**: Reserved (0)
- **T**: Message type (0=announcement, 1=deletion)
- **E**: Encrypted (1 if payload is encrypted)
- **C**: Compressed (1 if payload is compressed)
- **auth len**: Authentication data length
- **msg id hash**: 16-bit hash of message identifier
- **originating source**: IPv4 or IPv6 address of sender

### Multicast Addresses

**IPv4:**
- Global scope: `224.2.127.254`
- Organization scope: `239.195.255.255`
- Link-local scope: `224.0.0.255`

**IPv6:**
- Global scope: `FF0E::2:7FFE`
- Organization scope: `FF08::2:7FFE`
- Link-local scope: `FF02::2:7FFE`

### SDP Payload

SAP packets contain SDP (Session Description Protocol) payloads:

```
v=0
o=alice 2890844526 2890842807 IN IP4 192.168.1.100
s=VoIP Conference
i=Weekly team meeting
u=http://www.example.com/meetings/
e=alice@example.com
c=IN IP4 239.1.2.3/127
t=2873397496 2873404696
m=audio 49170 RTP/AVP 0
a=rtpmap:0 PCMU/8000
```

**SDP Fields:**
- `v=` Version
- `o=` Origin (username, session ID, version, address)
- `s=` Session name
- `i=` Session information (optional)
- `u=` URI (optional)
- `e=` Email (optional)
- `c=` Connection (multicast address)
- `t=` Time (start/stop in NTP format)
- `m=` Media description (type, port, protocol, format)
- `a=` Attributes

### Announcement Intervals

**Bandwidth Calculation:**
```
interval = size / bandwidth
interval = max(interval, 300 seconds)
```

**Default:**
- 5 minutes minimum interval
- Randomized to prevent bursts
- Scaled by session count

**Example:**
- Payload size: 512 bytes
- Target bandwidth: 4000 bps
- Interval: 512 × 8 / 4000 = 1.024 seconds
- Actual: max(1.024, 300) = 300 seconds (5 minutes)

### Message Types

**Announcement (T=0):**
- Advertise new or updated session
- Contains SDP description
- Sent periodically

**Deletion (T=1):**
- Remove session announcement
- Sent when session ends
- Same msg id hash as original announcement

### Authentication

**Optional PGP/MIME:**
- Digital signature of payload
- Verifies announcer identity
- Prevents spoofing

**Auth Data:**
- Variable length
- Follows originating source field
- Contains signature data

## Usage Examples

**Send SAP Announcement:**
```python
import socket
import struct

# SAP header
version_flags = 0x20  # V=1, A=0 (IPv4), R=0, T=0 (announcement)
auth_len = 0
msg_id_hash = 0x1234
originating_source = socket.inet_aton('192.168.1.100')

# SDP payload
sdp = b"""v=0
o=alice 123456 123456 IN IP4 192.168.1.100
s=Test Stream
c=IN IP4 239.1.2.3/127
t=0 0
m=audio 5004 RTP/AVP 0
a=rtpmap:0 PCMU/8000
"""

# Build SAP packet
sap_packet = struct.pack('!BBH4s', version_flags, auth_len, msg_id_hash, originating_source)
sap_packet += b'application/sdp\x00' + sdp

# Send to SAP multicast group
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 127)
sock.sendto(sap_packet, ('224.2.127.254', 9875))
```

**Receive SAP Announcements:**
```python
import socket
import struct

# Join SAP multicast group
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(('', 9875))

mreq = struct.pack('4sl', socket.inet_aton('224.2.127.254'), socket.INADDR_ANY)
sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)

while True:
    data, addr = sock.recvfrom(8192)
    
    # Parse SAP header
    version_flags = data[0]
    msg_type = (version_flags >> 2) & 1  # T bit
    
    if msg_type == 0:
        print("Session announcement received")
        # Parse SDP payload (skip SAP header)
        # ...
    else:
        print("Session deletion received")
```

## Resources

- **RFC 2974**: Session Announcement Protocol
- **RFC 4566**: SDP: Session Description Protocol  
- **RFC 3550**: RTP: A Transport Protocol for Real-Time Applications
- [VLC Media Player](https://www.videolan.org/) - Supports SAP discovery
- [SDPng](https://www.ietf.org/proceedings/50/slides/mmusic-4/sld001.htm)

## Notes

- **vs SDP**: SAP is transport, SDP is payload format
- **vs SIP**: SIP is signaling, SAP is announcement
- **Multicast Discovery**: Automatic session discovery on network
- **IPTV**: Used for channel lineup announcements
- **VLC**: Built-in SAP listener for discovering streams
- **Bandwidth Limits**: Self-regulating to prevent floods
- **Scope**: Link-local, organization, or global announcements
- **TTL**: Multicast TTL controls announcement reach
- **Compression**: zlib compression for large SDP payloads
- **Encryption**: Can encrypt SDP for privacy
- **Legacy**: Less common with modern streaming (RTSP/HLS)
- **MBone**: Originally designed for Multicast Backbone
- **Session Directory**: Early GUI tools for browsing SAP sessions
- **Deletion**: Announce session end with T=1 flag
- **Hash Collision**: 16-bit hash may collide for different sessions
- **Periodic**: Announcements repeat every ~5 minutes
- **Stateless**: No connection setup, fire-and-forget
- **Port 9875**: Well-known SAP port
