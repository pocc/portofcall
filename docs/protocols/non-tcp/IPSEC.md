# ⚠️ NON-TCP PROTOCOL - NOT COMPATIBLE WITH CLOUDFLARE WORKERS

> **Note:** This protocol does not use TCP as its primary transport mechanism. It cannot be implemented using Cloudflare Workers' Sockets API (`connect()`), which only supports TCP connections. This protocol is documented here for reference but requires alternative implementation approaches (native UDP/IP sockets, specialized gateways, or protocol translation).


## Overview

**IPsec (Internet Protocol Security)** is a protocol suite for securing IP communications by authenticating and encrypting each IP packet in a communication session. IPsec is widely used for VPNs, providing confidentiality, integrity, and authenticity for network traffic at the IP layer.

**Port:** UDP 500 (IKE), UDP 4500 (NAT-T), IP Protocol 50 (ESP), IP Protocol 51 (AH)
**Transport:** IP layer (Layer 3)
**Status:** Active standard
**RFC:** 4301 (Security Architecture), 4303 (ESP), 4302 (AH), 7296 (IKEv2)

## Protocol Specification

### Key Features

1. **Confidentiality**: AES, 3DES encryption
2. **Integrity**: SHA-256, SHA-512 HMAC
3. **Authentication**: Pre-shared keys, certificates, EAP
4. **Anti-Replay**: Sequence number protection
5. **Perfect Forward Secrecy**: Session key independence
6. **NAT Traversal**: Encapsulation for NAT devices
7. **Transport/Tunnel Modes**: Flexible deployment options

### IPsec Components

**AH (Authentication Header - IP Protocol 51):**
- Provides integrity and authentication
- No encryption (deprecated)
- Protects entire IP packet (including header)
- Incompatible with NAT

**ESP (Encapsulating Security Payload - IP Protocol 50):**
- Provides encryption, integrity, authentication
- Most commonly used
- Can work through NAT (with NAT-T)
- Protects payload only (tunnel mode) or payload + inner IP header (transport mode)

**IKE (Internet Key Exchange - UDP 500):**
- Negotiates security associations (SAs)
- Exchanges keys
- IKEv1 (legacy), IKEv2 (current)

**NAT-T (NAT Traversal - UDP 4500):**
- Encapsulates ESP in UDP
- Allows IPsec through NAT devices

### IPsec Modes

**Transport Mode:**
- Encrypts only payload
- Original IP header unchanged
- Used for host-to-host communication
- ESP: IP Header | ESP Header | Encrypted Payload | ESP Trailer | ESP Auth

**Tunnel Mode:**
- Encrypts entire IP packet
- New IP header added
- Used for site-to-site VPNs
- ESP: New IP Header | ESP Header | Encrypted (Original IP Packet) | ESP Trailer | ESP Auth

### ESP Packet Format

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|               Security Parameters Index (SPI)                 |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                      Sequence Number                          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    Payload Data (variable)                    |
~                                                               ~
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|     Padding (0-255 bytes)     |  Pad Length   | Next Header   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|         Integrity Check Value (ICV) - variable length         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

**Fields:**
- **SPI**: Security Parameters Index (identifies SA)
- **Sequence Number**: Anti-replay protection
- **Payload**: Encrypted data
- **Padding**: Block cipher alignment
- **Next Header**: Protocol of encapsulated packet
- **ICV**: HMAC for integrity/authentication

### Security Association (SA)

**Unidirectional:**
- Each direction has separate SA
- Bidirectional communication = 2 SAs

**SA Parameters:**
- SPI (Security Parameters Index)
- Destination IP address
- Security protocol (AH or ESP)
- Encryption algorithm (AES-128, AES-256, etc.)
- Authentication algorithm (SHA-256, SHA-512)
- Lifetime (time or byte count)

**SA Database (SAD):**
- Stores active SAs
- Indexed by SPI + destination + protocol

**Security Policy Database (SPD):**
- Defines which traffic requires IPsec
- PERMIT, BYPASS, or DISCARD rules

### Encryption Algorithms

**Symmetric Ciphers:**
- **AES**: AES-128, AES-192, AES-256 (recommended)
- **3DES**: Triple DES (legacy)
- **NULL**: No encryption (integrity only)

**Cipher Modes:**
- **CBC**: Cipher Block Chaining
- **GCM**: Galois/Counter Mode (AEAD - authenticated encryption)
- **CTR**: Counter mode

### Integrity Algorithms

**HMAC:**
- **SHA-256**: 256-bit hash (recommended)
- **SHA-384**: 384-bit hash
- **SHA-512**: 512-bit hash
- **SHA-1**: 160-bit hash (deprecated)
- **MD5**: 128-bit hash (deprecated)

**AEAD:**
- **AES-GCM**: Combined encryption + authentication
- **ChaCha20-Poly1305**: Modern alternative

### IKE Phase 1 (ISAKMP SA)

**Establishes secure IKE channel:**
- Authenticate peers
- Negotiate encryption/hash algorithms
- Perform Diffie-Hellman key exchange
- Create IKE SA (bidirectional)

**Modes (IKEv1):**
- **Main Mode**: 6 messages, identity protection
- **Aggressive Mode**: 3 messages, faster but less secure

### IKE Phase 2 (IPsec SA)

**Creates IPsec SAs:**
- Negotiates ESP/AH parameters
- Derives session keys
- Establishes SAs for data traffic

**Quick Mode (IKEv1):**
- 3 messages
- Uses IKE SA for protection
- Can create multiple IPsec SAs

### IKEv2 Advantages

- **Fewer Messages**: 4 messages vs 9 in IKEv1
- **Built-in NAT-T**: Automatic NAT traversal detection
- **MOBIKE**: Mobility support for roaming
- **Reliability**: Acknowledgments, retransmission
- **Simplified**: Single mode vs Main/Aggressive
- **EAP**: Extensible Authentication Protocol support

## Configuration Examples

**Linux - strongSwan:**
```
# /etc/ipsec.conf
conn myvpn
    type=tunnel
    authby=secret
    left=192.168.1.1
    leftsubnet=10.1.0.0/24
    right=203.0.113.1
    rightsubnet=10.2.0.0/24
    ike=aes256-sha256-modp2048!
    esp=aes256-sha256!
    keyexchange=ikev2
    auto=start

# /etc/ipsec.secrets
192.168.1.1 203.0.113.1 : PSK "MySecretPreSharedKey"
```

**Cisco IOS:**
```
# ISAKMP Phase 1
crypto isakmp policy 10
 encr aes 256
 hash sha256
 authentication pre-share
 group 14
 lifetime 86400

crypto isakmp key MySecretKey address 203.0.113.1

# IPsec Phase 2
crypto ipsec transform-set MYSET esp-aes 256 esp-sha256-hmac
 mode tunnel

# Crypto map
crypto map MYMAP 10 ipsec-isakmp
 set peer 203.0.113.1
 set transform-set MYSET
 match address VPN-TRAFFIC

# Apply to interface
interface GigabitEthernet0/0
 crypto map MYMAP

# Access list
ip access-list extended VPN-TRAFFIC
 permit ip 10.1.0.0 0.0.255.255 10.2.0.0 0.0.255.255
```

**Windows - PowerShell:**
```powershell
# Add VPN connection
Add-VpnConnection -Name "MyVPN" `
  -ServerAddress "vpn.example.com" `
  -TunnelType IKEv2 `
  -AuthenticationMethod MachineCertificate `
  -EncryptionLevel Required

# Set IPsec configuration
Set-VpnConnectionIPsecConfiguration -ConnectionName "MyVPN" `
  -AuthenticationTransformConstants SHA256128 `
  -CipherTransformConstants AES256 `
  -EncryptionMethod AES256 `
  -IntegrityCheckMethod SHA256 `
  -DHGroup Group14 `
  -PfsGroup PFS2048
```

## Resources

- **RFC 4301**: Security Architecture for the Internet Protocol
- **RFC 4303**: IP Encapsulating Security Payload (ESP)
- **RFC 4302**: IP Authentication Header (AH)
- **RFC 7296**: Internet Key Exchange Protocol Version 2 (IKEv2)
- [strongSwan](https://www.strongswan.org/) - Open-source IPsec
- [Libreswan](https://libreswan.org/) - IPsec implementation

## Notes

- **vs TLS/SSL**: IPsec works at IP layer, TLS at application layer
- **vs OpenVPN**: IPsec is standard, OpenVPN is not; IPsec faster
- **vs WireGuard**: WireGuard simpler, faster, more modern
- **Layer 3**: Operates at network layer (transparent to applications)
- **ESP vs AH**: ESP is standard, AH rarely used
- **Transport vs Tunnel**: Transport for host-to-host, tunnel for site-to-site
- **NAT Traversal**: UDP encapsulation required for NAT
- **Perfect Forward Secrecy**: DH exchange ensures key independence
- **Rekeying**: Periodic SA renewal for security
- **Dead Peer Detection**: DPD detects failed peers
- **Certificate Support**: X.509 certificates for authentication
- **Pre-Shared Keys**: Simpler but less scalable
- **Site-to-Site**: Connect entire networks
- **Road Warrior**: Mobile users to fixed gateway
- **Overhead**: ~50-70 bytes per packet (ESP tunnel mode)
- **Performance**: Hardware acceleration available in modern CPUs
- **IKEv2**: Preferred over IKEv1 for all new deployments
- **MOBIKE**: Allows VPN to survive IP address changes
