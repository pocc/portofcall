# ⚠️ NON-TCP PROTOCOL - NOT COMPATIBLE WITH CLOUDFLARE WORKERS

> **Note:** This protocol does not use TCP as its primary transport mechanism. It cannot be implemented using Cloudflare Workers' Sockets API (`connect()`), which only supports TCP connections. This protocol is documented here for reference but requires alternative implementation approaches (native UDP/IP sockets, specialized gateways, or protocol translation).


## Overview

**IKE (Internet Key Exchange)** is a protocol used to establish security associations (SAs) for IPsec VPNs. It provides mutual authentication and establishes shared session keys. IKEv2 is the current standard, offering improved security and reliability over IKEv1.

**Port:** 500 (UDP), 4500 (UDP, NAT-T)
**Transport:** UDP
**Status:** Active standard
**RFC:** 7296 (IKEv2), 2409 (IKEv1, obsolete)

## Protocol Specification

### Key Features

1. **Mutual Authentication**: Both peers authenticate each other
2. **Key Exchange**: Secure Diffie-Hellman key exchange
3. **Perfect Forward Secrecy**: Session keys not derived from long-term keys
4. **NAT Traversal**: Handles NAT devices (port 4500)
5. **Dead Peer Detection**: Detects failed peers
6. **Mobility Support**: MOBIKE for mobile devices (IKEv2)

### IKE Versions

**IKEv1 (RFC 2409):**
- Two phases (Phase 1: IKE SA, Phase 2: IPsec SA)
- Multiple modes (Main Mode, Aggressive Mode, Quick Mode)
- More complex, verbose protocol

**IKEv2 (RFC 7296):**
- Simplified exchange (4 messages for initial setup)
- Built-in NAT traversal
- Fewer round trips, more efficient
- Improved reliability and security

### IKEv2 Exchange

**Initial Exchange (4 messages):**

```
Initiator                     Responder
---------                     ---------
IKE_SA_INIT request    --->
                       <---   IKE_SA_INIT response

IKE_AUTH request       --->
                       <---   IKE_AUTH response
```

**IKE_SA_INIT:**
- Negotiate cryptographic algorithms
- Exchange nonces
- Perform Diffie-Hellman exchange

**IKE_AUTH:**
- Authenticate peers (certificates, PSK, EAP)
- Create first CHILD_SA (IPsec tunnel)
- Optionally exchange configuration data

### Message Structure

```
IKE Header:
+---+---+---+---+---+---+---+---+
| Initiator SPI (8 bytes)       |
+---+---+---+---+---+---+---+---+
| Responder SPI (8 bytes)       |
+---+---+---+---+---+---+---+---+
| Next Payload | Version | Flags |
+---+---+---+---+---+---+---+---+
| Message ID (4 bytes)          |
+---+---+---+---+---+---+---+---+
| Length (4 bytes)              |
+---+---+---+---+---+---+---+---+
| Payloads...                   |
```

### Payload Types

- **SA** (Security Association proposal)
- **KE** (Key Exchange data)
- **IDi/IDr** (Identification - Initiator/Responder)
- **CERT** (Certificate)
- **CERTREQ** (Certificate Request)
- **AUTH** (Authentication)
- **Ni/Nr** (Nonce - Initiator/Responder)
- **N** (Notify - errors, status)
- **D** (Delete)
- **TSi/TSr** (Traffic Selector - Initiator/Responder)
- **SK** (Encrypted and Authenticated payload)

### Authentication Methods

- **Pre-Shared Key (PSK)**: Shared secret
- **RSA Signatures**: X.509 certificates
- **DSA Signatures**: X.509 certificates with DSA
- **EAP**: Extensible Authentication Protocol (IKEv2)

### NAT Traversal (NAT-T)

- Detected during IKE_SA_INIT
- Switches from UDP port 500 to 4500
- Encapsulates ESP in UDP to traverse NAT
- Keepalive packets maintain NAT mapping

## Resources

- **RFC 7296**: IKEv2 Protocol
- **RFC 2409**: IKEv1 (obsolete)
- **RFC 3948**: UDP Encapsulation of IPsec ESP Packets
- **RFC 4306**: IKEv2 (superseded by 7296)
- [StrongSwan](https://www.strongswan.org/) - IKEv2 VPN implementation
- [Libreswan](https://libreswan.org/) - IKE/IPsec implementation

## Notes

- **IPsec Requirement**: IKE is used to establish IPsec tunnels
- **vs L2TP**: IKE/IPsec is more secure, L2TP often uses IPsec too
- **vs OpenVPN**: IKE is standardized, OpenVPN is not
- **vs WireGuard**: WireGuard is simpler, faster, more modern
- **Two Ports**: UDP 500 (normal), UDP 4500 (NAT traversal)
- **Perfect Forward Secrecy**: Compromise of long-term keys doesn't expose past sessions
- **Dead Peer Detection**: DPD detects failed peers (RFC 3706)
- **MOBIKE**: Mobility support for roaming devices (RFC 4555)
- **Cookie**: DoS protection mechanism
- **Rekeying**: Periodic SA renewal for security
- **CHILD_SA**: IPsec tunnel created by IKE
- **IKE_SA**: IKE control channel
- **Phase 1/2**: IKEv1 terminology (not used in IKEv2)
- **Aggressive Mode**: Faster but less secure (IKEv1)
- **Main Mode**: Secure but slower (IKEv1)
- **Site-to-Site**: VPN between two networks
- **Road Warrior**: Mobile client to fixed gateway
