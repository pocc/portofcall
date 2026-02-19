# L2TP (Layer 2 Tunneling Protocol)

**Default Port:** 1701/UDP (this implementation uses TCP via Cloudflare Workers Sockets API)
**RFCs:** [RFC 2661](https://www.rfc-editor.org/rfc/rfc2661) (L2TPv2), [RFC 3931](https://www.rfc-editor.org/rfc/rfc3931) (L2TPv3)
**Implementation:** `src/worker/l2tp.ts`

---

## Overview

L2TP is a tunneling protocol used to create Virtual Private Networks (VPNs). It encapsulates PPP frames inside IP packets, allowing Layer 2 connectivity across an IP network. L2TP itself provides no encryption; it is almost always paired with IPsec (L2TP/IPsec) for confidentiality in production deployments.

This implementation targets **L2TPv2** (RFC 2661). L2TPv3 (RFC 3931) generalizes the protocol beyond PPP but shares the same control message architecture.

### Key Terminology

| Term | Meaning |
|------|---------|
| **LAC** | L2TP Access Concentrator -- initiates tunnels on behalf of remote users |
| **LNS** | L2TP Network Server -- terminates tunnels and provides network access |
| **Tunnel** | A control connection between LAC and LNS, identified by Tunnel IDs |
| **Session** | A logical PPP connection multiplexed within a tunnel, identified by Session IDs |
| **AVP** | Attribute-Value Pair -- the TLV encoding used inside control messages |
| **ZLB** | Zero-Length Body -- an ACK-only control message with no AVP payload |

---

## L2TP Header Format (RFC 2661 Section 3.1)

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|T|L|x|x|S|x|O|P|x|x|x|x|  Ver  |          Length (opt)        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|           Tunnel ID           |          Session ID           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|             Ns (opt)          |             Nr (opt)          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|      Offset Size (opt)        |    Offset Pad (opt) ...       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### Flag Bits

| Bit | Name | Meaning |
|-----|------|---------|
| **T** | Type | 1 = control message, 0 = data message |
| **L** | Length | 1 = Length field present. MUST be 1 for control messages |
| **S** | Sequence | 1 = Ns/Nr fields present. MUST be 1 for control messages |
| **O** | Offset | 1 = Offset Size field present. MUST be 0 for control messages |
| **P** | Priority | 1 = preferential treatment for this data message. Only for data messages |
| **x** | Reserved | MUST be 0 |
| **Ver** | Version | MUST be 2 for L2TPv2 |

### Control Message Constraints (RFC 2661 Section 3.1)

For control messages (T=1), the following MUST hold:
- L=1 (Length field always present)
- S=1 (Sequence numbers always present)
- O=0 (Offset not used)
- P=0 (Priority not used)
- Tunnel ID = 0 until the peer assigns one via Assigned Tunnel ID AVP
- Session ID = 0 for tunnel-level control messages

The implementation uses flags word `0xC802`:
```
Binary: 1100 1000 0000 0010
        T L x x  S x O P  x x x x  V V V V
        1 1 0 0  1 0 0 0  0 0 0 0  0 0 1 0
```
This correctly encodes T=1, L=1, S=1, O=0, P=0, Ver=2.

### Sequence Numbers (Ns / Nr)

- **Ns**: Sequence number of the current message being sent (16-bit, wraps at 65536)
- **Nr**: Sequence number of the next message expected from the peer (i.e., peer's Ns + 1)
- Control messages are reliably delivered -- the sender retransmits if no ACK (Nr advancement or ZLB) arrives
- A ZLB (Zero-Length Body) is a control message with T=1, L=1, S=1 and no AVP payload, used purely as an acknowledgment

---

## AVP Format (RFC 2661 Section 4.1)

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|M|H| rsvd  |      Length       |         Vendor ID             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|       Attribute Type          |       Attribute Value ...     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

| Field | Bits | Description |
|-------|------|-------------|
| **M** (Mandatory) | 1 | 1 = this AVP MUST be understood; if unknown, abort the tunnel |
| **H** (Hidden) | 1 | 1 = value is hidden (encrypted with shared secret) |
| **Reserved** | 4 | MUST be 0 |
| **Length** | 10 | Total AVP length in bytes (header + value), minimum 6 |
| **Vendor ID** | 16 | 0 = IETF standard AVP; nonzero = vendor-specific |
| **Attribute Type** | 16 | AVP type number (scoped to vendor) |
| **Value** | variable | AVP payload |

### IETF AVP Types Used in This Implementation

| Type | Name | Size | SCCRQ | SCCRP | SCCCN | Notes |
|------|------|------|:-----:|:-----:|:-----:|-------|
| 0 | Message Type | 2 | M | M | M | Identifies the control message |
| 1 | Result Code | variable | | | | Present in StopCCN, CDN |
| 2 | Protocol Version | 2 | M | M | | `0x01 0x00` = L2TPv2 rev 0 |
| 3 | Framing Capabilities | 4 | M | M | | Bit 0=async, Bit 1=sync |
| 4 | Bearer Capabilities | 4 | M | M | | Bit 0=digital, Bit 1=analog |
| 7 | Host Name | variable | M | M | | Identifies the LAC/LNS |
| 8 | Vendor Name | variable | | O | | Human-readable vendor string |
| 9 | Assigned Tunnel ID | 2 | M | M | | Local tunnel ID for the peer to use |
| 10 | Receive Window Size | 2 | O | O | | Control message sliding window (default 4) |
| 14 | Assigned Session ID | 2 | | | | Used in ICRQ/ICRP/OCRQ/OCRP |
| 15 | Call Serial Number | 4 | | | | Unique call identifier in ICRQ |
| 19 | Framing Type | 4 | | | | Used in ICCN/OCCN |
| 24 | Tx Connect Speed BPS | 4 | | | | Used in ICCN/OCCN |

**M** = Mandatory, **O** = Optional

---

## Control Connection Establishment

### Tunnel Setup: SCCRQ / SCCRP / SCCCN

```
   LAC (Client)                         LNS (Server)
       |                                     |
       |  SCCRQ (Tunnel ID=0, Ns=0, Nr=0)   |
       | ----------------------------------> |
       |                                     |
       |  SCCRP (Tunnel ID=X, Ns=0, Nr=1)   |
       | <---------------------------------- |
       |                                     |
       |  SCCCN (Tunnel ID=Y, Ns=1, Nr=1)   |
       | ----------------------------------> |
       |                                     |
       |  [ZLB ACK] (optional)               |
       | <---------------------------------- |
       |                                     |
       |     ~~~ Tunnel Established ~~~      |
```

1. **SCCRQ** (Start-Control-Connection-Request, type 1): Sent by the LAC to the LNS with Tunnel ID = 0 (since no tunnel exists yet). Includes Protocol Version, Host Name, Framing/Bearer Capabilities, and Assigned Tunnel ID.

2. **SCCRP** (Start-Control-Connection-Reply, type 2): The LNS responds with its own Assigned Tunnel ID. From this point, the LAC must use the LNS's Assigned Tunnel ID in the header of subsequent messages.

3. **SCCCN** (Start-Control-Connection-Connected, type 3): The LAC confirms the tunnel is established. The LNS may respond with a ZLB ACK.

### Session Setup: ICRQ / ICRP / ICCN

Once the tunnel is established, sessions (PPP connections) are created within it:

```
   LAC (Client)                         LNS (Server)
       |                                     |
       |  ICRQ (Session ID=0, type=10)      |
       | ----------------------------------> |
       |                                     |
       |  ICRP (Assigned Session ID, type=11)|
       | <---------------------------------- |
       |                                     |
       |  ICCN (type=12)                    |
       | ----------------------------------> |
       |                                     |
       |   ~~~ PPP Session Ready ~~~         |
```

4. **ICRQ** (Incoming-Call-Request, type 10): LAC requests a new session. Includes Assigned Session ID, Call Serial Number, BPS range, Bearer/Framing type.

5. **ICRP** (Incoming-Call-Reply, type 11): LNS accepts and assigns its own Session ID.

6. **ICCN** (Incoming-Call-Connected, type 12): LAC confirms the session is connected. PPP LCP negotiation would follow over L2TP data messages.

---

## Keepalive: Hello

**Hello** (type 6) is a control message sent periodically to verify the tunnel is still alive. The peer responds with a ZLB ACK. If no response arrives after retransmission attempts, the tunnel is torn down.

## Tunnel Teardown: StopCCN

**StopCCN** (type 4) terminates the entire tunnel and all sessions within it. It includes a Result Code AVP explaining the reason.

---

## API Endpoints

### POST /api/l2tp/connect

Performs a basic SCCRQ and waits for SCCRP. Quick probe to test if an L2TP server is reachable.

**Request:**
```json
{
  "host": "vpn.example.com",
  "port": 1701,
  "timeout": 15000,
  "hostname": "portofcall-worker"
}
```

**Response:**
```json
{
  "success": true,
  "host": "vpn.example.com",
  "port": 1701,
  "tunnelId": 42317,
  "assignedTunnelId": 1,
  "peerHostname": "vpn-gateway",
  "vendorName": "Linux",
  "protocolVersion": "1.0",
  "rtt": 45
}
```

### POST /api/l2tp/session

Full tunnel + session establishment: SCCRQ -> SCCRP -> SCCCN -> ICRQ -> ICRP -> ICCN.

**Request:**
```json
{
  "host": "vpn.example.com",
  "port": 1701,
  "hostname": "portofcall",
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "host": "vpn.example.com",
  "port": 1701,
  "localTunnelId": 29341,
  "peerTunnelId": 1,
  "localSessionId": 8472,
  "peerSessionId": 1,
  "peerHostname": "vpn-gateway",
  "protocolVersion": "1.0",
  "latencyMs": 120,
  "note": "L2TP tunnel + session established. PPP LCP negotiation would follow."
}
```

### POST /api/l2tp/start-control

Sends SCCRQ with full AVP set and parses the SCCRP. Similar to `/connect` but includes Bearer Capabilities and Result Code parsing.

**Request:**
```json
{
  "host": "vpn.example.com",
  "port": 1701,
  "timeout": 10000
}
```

### POST /api/l2tp/hello

Sends a Hello keepalive to an existing tunnel. Note: because Cloudflare Workers are stateless, this opens a new TCP connection -- the peer may not recognize the tunnel ID.

**Request:**
```json
{
  "host": "vpn.example.com",
  "port": 1701,
  "timeout": 10000,
  "tunnelId": 1
}
```

---

## Implementation Notes

### Transport: TCP vs UDP

L2TP normally runs over UDP port 1701. This implementation uses **TCP** because the Cloudflare Workers Sockets API (`cloudflare:sockets`) only supports TCP. This means:

- The L2TP framing is identical (same header format, AVPs, sequence numbers)
- TCP provides its own reliability, making the L2TP control message retransmission mechanism redundant
- Some L2TP servers may not accept TCP connections on port 1701
- NAT traversal behavior differs from standard UDP-based L2TP

### Two Build Approaches

The file contains two parallel implementations:

1. **Buffer-based** (`buildL2TPMessage` / `parseL2TPMessage`): Used by `handleL2TPConnect`, `handleL2TPHello`, and `handleL2TPStartControl`. Uses Node.js `Buffer` API.

2. **Uint8Array-based** (`buildControl` / `parseControl`): Used by `handleL2TPSession`. Uses pure `DataView`/`Uint8Array` with no Node.js dependencies.

Both produce identical wire formats.

### Stateless Design Limitation

Each API call opens a fresh TCP connection. L2TP tunnels are inherently stateful, so:

- The Hello endpoint cannot maintain a real tunnel keepalive
- Session data cannot persist beyond a single request
- This implementation is best suited for **probing and diagnostics**, not sustained VPN tunneling

---

## Wire Examples

### SCCRQ Packet (hex)

```
C8 02        Flags: T=1, L=1, S=1, Ver=2
00 3E        Length: 62 bytes
00 00        Tunnel ID: 0 (not yet assigned)
00 00        Session ID: 0 (control connection)
00 00        Ns: 0
00 00        Nr: 0
-- AVPs --
80 08 00 00 00 00 00 01   Message Type = SCCRQ (1)
80 08 00 00 00 02 01 00   Protocol Version = 1.0
80 0F 00 00 00 07 ...     Host Name (variable)
80 0A 00 00 00 03 00 00 00 03  Framing Capabilities (sync+async)
80 0A 00 00 00 04 00 00 00 03  Bearer Capabilities (analog+digital)
80 08 00 00 00 09 XX XX   Assigned Tunnel ID
80 08 00 00 00 0A 00 04   Receive Window Size = 4
```

### ZLB ACK Packet (12 bytes, no AVPs)

```
C8 02        Flags: T=1, L=1, S=1, Ver=2
00 0C        Length: 12 bytes
XX XX        Tunnel ID
00 00        Session ID: 0
XX XX        Ns
XX XX        Nr
```

---

## RFC Compliance Checklist

| Requirement | RFC Section | Status |
|-------------|-------------|--------|
| Control messages: T=1, L=1, S=1 | 3.1 | Compliant |
| Version field = 2 | 3.1 | Compliant |
| O bit = 0 for control | 3.1 | Compliant |
| P bit = 0 for control | 3.1 | Compliant |
| Reserved bits = 0 | 3.1 | Compliant |
| Tunnel ID = 0 in SCCRQ | 3.1 | Compliant |
| Session ID = 0 for tunnel control | 3.1 | Compliant |
| Message Type AVP first in payload | 4.1 | Compliant |
| Message Type AVP M-bit = 1 | 4.1 | Compliant |
| Protocol Version AVP in SCCRQ | 4.1 | Compliant |
| Host Name AVP in SCCRQ | 4.1 | Compliant |
| Framing Capabilities in SCCRQ | 4.1 | Compliant |
| Bearer Capabilities in SCCRQ | 4.1 | Compliant |
| Assigned Tunnel ID in SCCRQ | 4.1 | Compliant |
| Ns/Nr sequence tracking | 5.8 | Compliant |
| Tunnel ID 0 is reserved | 3.1 | Compliant |
| AVP vendor ID = 0 for IETF | 4.1 | Compliant |
| Transport is UDP/1701 | 2 | Deviation (TCP) |

---

## Differences from L2TPv3 (RFC 3931)

L2TPv3 generalizes L2TPv2 for non-PPP payloads (Ethernet, VLAN, Frame Relay, ATM, etc.):

- **Session ID** expanded from 16-bit to 32-bit
- **Tunnel ID** replaced by 32-bit **Control Connection ID** in the header
- **Cookie** field added for anti-spoofing
- Can run directly over IP (protocol 115) without UDP encapsulation
- AVP encoding is the same; new AVP types added for L2-specific parameters
- Control connection setup is the same three-way handshake (SCCRQ/SCCRP/SCCCN)

This implementation targets L2TPv2 only.

---

## Common L2TP Servers for Testing

| Software | Notes |
|----------|-------|
| **xl2tpd** | Standard Linux L2TP daemon |
| **strongSwan** | IPsec + L2TP, widely deployed |
| **SoftEther VPN** | Multi-protocol VPN server |
| **Mikrotik RouterOS** | Common in ISP/enterprise networks |
| **Windows RRAS** | Built-in Windows Server L2TP |

---

## References

- [RFC 2661 - Layer Two Tunneling Protocol "L2TP"](https://www.rfc-editor.org/rfc/rfc2661) (L2TPv2, August 1999)
- [RFC 3931 - Layer Two Tunneling Protocol - Version 3 (L2TPv3)](https://www.rfc-editor.org/rfc/rfc3931) (March 2005)
- [RFC 2865 - RADIUS](https://www.rfc-editor.org/rfc/rfc2865) (L2TP often used with RADIUS authentication)
- [RFC 3193 - Securing L2TP using IPsec](https://www.rfc-editor.org/rfc/rfc3193)
