# Internet Standards Feasibility Analysis

This document catalogs all IETF Internet Standards (IS) from the [RFC Editor](https://www.rfc-editor.org/standards#IS) and evaluates their feasibility for implementation in Cloudflare Workers with TCP Sockets.

## Analysis Date
Last reviewed: February 16, 2026
Last updated: February 16, 2026 (Active Users implementation completed)

## Constraints
Cloudflare Workers with TCP Sockets have specific limitations:
- **TCP only** - UDP is not supported
- **Layer 4+** - Cannot access Layer 2/3 protocols (Ethernet, IP, ICMP, ARP)
- **No privileged ports** - Cannot bind to ports < 1024 as a server
- **No raw sockets** - Cannot send/receive raw IP packets
- **No special network access** - Cannot perform routing, SNMP polling, or packet inspection

## Not Implemented but Feasible

These protocols are viable for implementation in Workers:

### EPP (Extensible Provisioning Protocol) ⭐ PRIORITY
- **RFCs:** 5730 (base), 5731 (domain mapping), 5732 (host mapping), 5733 (contact mapping), 5734 (transport)
- **Port:** 700/TCP
- **Purpose:** Domain name registration and management protocol
- **Use Case:** Interact with domain registrars to check availability, register domains, update nameservers, transfer domains
- **Implementation Notes:**
  - Requires TLS (RFC 5734)
  - XML-based request/response protocol
  - Stateful sessions with login/logout
  - Would be valuable for domain management automation
  - Well-documented with clear specifications

## Not Feasible

These protocols cannot be implemented in Workers due to technical constraints:

### UDP-Based Protocols
Workers do not support UDP sockets. The following cannot be implemented:

- **RTP** (Real-time Transport Protocol) - RFCs 3550, 3551
  - Used for streaming audio/video
  - Requires UDP for real-time delivery

- **TFTP** (Trivial File Transfer Protocol) - RFC 1350
  - Simple file transfer over UDP
  - Port 69/UDP

- **OSPF** (Open Shortest Path First) - RFC 2328
  - Routing protocol
  - Uses IP protocol 89 (not TCP/UDP)

- **RIP** (Routing Information Protocol) - RFC 2453
  - Distance-vector routing protocol
  - Port 520/UDP

### Layer 2/3 Protocols
Workers operate at Layer 4+ (TCP). Cannot access lower network layers:

- **IP** (Internet Protocol) - RFC 791
- **ICMP** (Internet Control Message Protocol) - RFC 792
- **ARP** (Address Resolution Protocol) - RFC 826
- **RARP** (Reverse ARP) - RFC 903
- **IS-IS** (Intermediate System to Intermediate System) - RFC 1142
- **BGP** (Border Gateway Protocol) - RFC 4271
  - While BGP uses TCP port 179, it requires privileged system access and routing table manipulation

### Protocols Requiring Special Access

- **SNMP** (Simple Network Management Protocol) - RFCs 3411-3418
  - Port 161/UDP (trap listener on 162/UDP)
  - Requires network device access and special permissions

- **RMON** (Remote Network Monitoring) - RFC 2819
  - Extension of SNMP
  - Requires network traffic visibility

- **IPFIX** (IP Flow Information Export) - RFC 7011
  - Netflow/packet analysis
  - Requires packet capture capabilities

### Other Non-Viable Protocols

- **BOOTP** (Bootstrap Protocol) - RFC 951
  - Port 67/UDP (server), 68/UDP (client)
  - DHCP predecessor

- **NTP** (Network Time Protocol) - RFC 5905
  - Port 123/UDP
  - Requires precise timing and low latency

## Already Implemented

For reference, Port of Call already implements these Internet Standards:

- **SMTP** (Simple Mail Transfer Protocol) - RFC 5321
- **HTTP** - RFCs 9110-9114
- **FTP** (File Transfer Protocol) - RFC 959
- **Telnet** - RFC 854
- **DNS** (Domain Name System) - RFC 1035
- **IMAP** (Internet Message Access Protocol) - RFC 9051
- **POP3** (Post Office Protocol v3) - RFC 1939
- **NNTP** (Network News Transfer Protocol) - RFC 3977
- **LDAP** (Lightweight Directory Access Protocol) - RFC 4511
- **IRC** (Internet Relay Chat) - RFCs 1459, 2812
- **XMPP** (Extensible Messaging and Presence Protocol) - RFC 6120
- **Finger** - RFC 1288
- **Whois** - RFC 3812
- **Echo** - RFC 862
- **Active Users** - RFC 866 *(Implemented Feb 2026 - Note: virtually no public servers exist)*
- **Discard** - RFC 863
- **Daytime** - RFC 867
- **Time** - RFC 868
- **Character Generator** - RFC 864
- **Quote of the Day** - RFC 865

## Recommendations

1. **Implement EPP** - This is the most valuable unimplemented Internet Standard. EPP would enable domain registration/management automation and has clear practical applications.

2. **Document UDP limitation** - Consider adding a note in the UI explaining why certain popular protocols (TFTP, NTP, DNS over UDP) cannot be supported.

## Implementation Notes

### Active Users Protocol (RFC 866)
**Status:** ✅ Implemented February 2026

**Availability:** While the protocol is fully implemented and functional, finding publicly accessible servers to test against is extremely difficult. The protocol is from 1983 and considered a security vulnerability (reveals system information). Most system administrators have disabled this service, and many ISPs/cloud providers block port 11.

**Testing Options:**
- Set up your own test server using netcat: `nc -l 11 <<< "42 users"`
- Run a simple Python/Node server on port 11
- The implementation is correct per RFC 866, but real-world servers are virtually extinct

## Contributing

When evaluating new protocols for implementation, check:
1. ✅ Does it use TCP (not UDP)?
2. ✅ Is it Layer 4 or above (not Layer 2/3)?
3. ✅ Can it work without privileged system access?
4. ✅ Does it have clear documentation and specifications?
5. ✅ Would it provide value to users?

If all checks pass, the protocol is likely feasible for Port of Call.
