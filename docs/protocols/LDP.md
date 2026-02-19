# LDP -- Label Distribution Protocol

**Port:** 646 (TCP)
**RFC:** 5036 (LDP Specification), 3031 (MPLS Architecture), 3032 (MPLS Label Stack Encoding)
**Implementation:** `src/worker/ldp.ts`
**Routes:** `POST /api/ldp/connect`, `POST /api/ldp/probe`, `POST /api/ldp/label-map`

---

## Protocol Overview

LDP is used in MPLS networks for distributing label-to-FEC (Forwarding Equivalence Class) bindings between Label Switching Routers (LSRs). An LSR uses LDP to inform peers which labels it has assigned to specific FECs, enabling MPLS label-switched path (LSP) establishment.

LDP operates in two phases:

1. **Discovery** -- LSRs send Hello messages (usually via UDP multicast 224.0.0.2:646) to discover neighbors.
2. **Session** -- After discovery, TCP connections are established on port 646 for Initialization, KeepAlive, and label distribution.

This implementation handles the TCP session phase only: it connects to port 646, sends an Initialization message, and parses the peer's response.

---

## Endpoints

### `POST /api/ldp/connect`

Sends an LDP Initialization message, reads the peer's response, and if the peer replies with its own Initialization, sends a KeepAlive to complete the three-way handshake.

**Request**

```json
{
  "host":    "192.0.2.1",     // required
  "port":    646,              // default 646
  "timeout": 10000            // ms, default 10000
}
```

**Response -- peer sent Initialization**

```json
{
  "success":          true,
  "host":             "192.0.2.1",
  "port":             646,
  "rtt":              142,
  "connectTime":      38,
  "isLDP":            true,
  "version":          1,
  "lsrId":            "10.0.0.1",
  "labelSpace":       0,
  "messages": [
    {
      "type":       512,
      "typeName":   "Initialization",
      "length":     22,
      "messageId":  1
    }
  ],
  "sessionParams": {
    "protocolVersion":    1,
    "keepaliveTime":      30,
    "maxPduLength":       4096,
    "receiverLsrId":      "10.0.0.1",
    "receiverLabelSpace": 0
  },
  "rawBytesReceived": 36,
  "message":          "LDP peer detected. LSR-ID: 10.0.0.1:0. 1 message(s): Initialization. Keepalive=30s, MaxPDU=4096."
}
```

`isLDP` is `true` when the response starts with LDP version 1. If the peer sends something that does not parse as LDP, `isLDP` is `false` and the remaining fields are empty/default.

`sessionParams` is present only when the peer's response contains an Initialization message with a Common Session Parameters TLV (type 0x0500).

**Response -- non-LDP peer**

```json
{
  "success":          true,
  "host":             "192.0.2.1",
  "port":             646,
  "rtt":              55,
  "connectTime":      12,
  "isLDP":            false,
  "version":          0,
  "lsrId":            "",
  "labelSpace":       0,
  "messages":         [],
  "rawBytesReceived": 128,
  "message":          "Server responded but does not appear to be an LDP peer."
}
```

**Handshake:** When the peer responds with an Initialization message, the handler automatically sends a KeepAlive to complete the handshake. Write errors during KeepAlive are silently ignored.

**Sent Initialization parameters:** Version=1, KeepAlive Time=30s, Max PDU Length=4096, LSR ID=10.0.0.1:0, Receiver LDP Identifier=0.0.0.0:0 (unknown before receiving peer's Init), A-bit=0 (downstream unsolicited), D-bit=0 (loop detection disabled).

---

### `POST /api/ldp/probe`

Lightweight variant of `/connect`. Sends the same Initialization message but does not send a KeepAlive, and returns a simplified response with only message type names.

**Request**

```json
{
  "host":    "192.0.2.1",     // required
  "port":    646,              // default 646
  "timeout": 10000            // ms, default 10000
}
```

**Response**

```json
{
  "success":    true,
  "host":       "192.0.2.1",
  "port":       646,
  "rtt":        87,
  "isLDP":      true,
  "lsrId":      "10.0.0.1",
  "labelSpace": 0,
  "messages":   ["Initialization", "KeepAlive"],
  "message":    "LDP peer detected. LSR-ID: 10.0.0.1:0."
}
```

Note: `messages` is an array of type name strings (not objects). No `sessionParams` are returned. No KeepAlive is sent.

---

### `POST /api/ldp/label-map`

Performs the full Initialization + KeepAlive handshake, then listens for Label Mapping, Address, Label Withdraw, and Label Release messages for up to 2 seconds (or the remaining timeout budget, whichever is shorter).

**Request**

```json
{
  "host":    "192.0.2.1",     // required
  "port":    646,              // default 646
  "timeout": 10000            // ms, default 10000
}
```

**Response**

```json
{
  "success":           true,
  "host":              "192.0.2.1",
  "port":              646,
  "rtt":               1842,
  "connectTime":       38,
  "lsrId":             "10.0.0.1",
  "labelSpace":        0,
  "labels": [
    { "prefix": "10.0.0.0", "maskLen": 8, "label": 3 },
    { "prefix": "192.168.1.0", "maskLen": 24, "label": 100016 }
  ],
  "addresses":         ["10.0.0.1", "172.16.0.1"],
  "labelCount":        2,
  "addressCount":      2,
  "messagesObserved":  ["Label Mapping", "Address", "KeepAlive"],
  "rawBytesReceived":  4096,
  "message":           "LDP peer 10.0.0.1:0. Collected 2 label mapping(s) and 2 address(es) in 1842ms."
}
```

**Collection window:** The handler waits up to `min(2000, timeout - elapsed - 500)` ms after the handshake, capped at a minimum of 500 ms. During this window, all bytes are buffered (up to 64 KB) and then parsed for Label Mapping (0x0400), Label Withdraw (0x0402), Label Release (0x0403), and Address (0x0300) messages.

**Label value decoding:** Generic Label TLV values are decoded assuming MPLS shim header format -- the label occupies bits 31:12 (top 20 bits) of the 32-bit TLV value field.

**FEC parsing:** Only Prefix FEC elements with address family IPv4 (0x0001) are decoded. Wildcard FEC elements are skipped. Non-IPv4 address families cause the FEC element to be skipped entirely.

---

## Wire Format Reference (RFC 5036)

### LDP PDU Header (10 bytes)

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  Version (2 bytes)            |  PDU Length (2 bytes)          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                  LDP Identifier (6 bytes)                     |
+                               +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

| Field | Size | Description |
|-------|------|-------------|
| Version | 2 bytes | Always 1 |
| PDU Length | 2 bytes | Length of everything after this field (LDP Identifier + all messages). Does NOT include Version or PDU Length themselves. |
| LDP Identifier | 6 bytes | LSR ID (4-byte IPv4 address) + Label Space ID (2-byte unsigned). |

**PDU Length** covers `LDP Identifier (6) + sum of all messages`. Total bytes on wire = `4 + PDU Length`.

### LDP Message Header (8+ bytes)

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|U|   Message Type (15 bits)    |  Message Length (2 bytes)     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                  Message ID (4 bytes)                         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                  Mandatory Parameters (TLVs)                  |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                  Optional Parameters (TLVs)                   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

| Field | Size | Description |
|-------|------|-------------|
| U-bit | 1 bit | Unknown message bit. If 1, the message should be silently ignored if not understood (not sent as Notification). |
| Message Type | 15 bits | Identifies the message type. |
| Message Length | 2 bytes | Length of Message ID + all parameters. Does NOT include U+Type or Message Length itself. |
| Message ID | 4 bytes | Unique identifier for this message, used to correlate Notification responses. |

**Message Length** = `4 (Message ID) + total TLV bytes`. Total message bytes on wire = `4 (U+Type + Length) + Message Length`.

### TLV Encoding (4+ bytes)

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|U|F|  Type (14 bits)           |  Length (2 bytes)             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                  Value                                        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

| Field | Size | Description |
|-------|------|-------------|
| U-bit | 1 bit | Unknown TLV bit. If 1, silently ignore unknown TLVs rather than returning an error. |
| F-bit | 1 bit | Forward unknown bit. If U=1 and F=1, the unknown TLV should be forwarded. |
| Type | 14 bits | TLV type code. |
| Length | 2 bytes | Length of the Value field only. |

**No padding.** TLVs are packed contiguously with no alignment padding between them per RFC 5036.

### Message Types

| Code | Name | Direction | Description |
|------|------|-----------|-------------|
| 0x0001 | Notification | <-> | Error or advisory notification |
| 0x0100 | Hello | -> (UDP) | Neighbor discovery (not used in this TCP implementation) |
| 0x0200 | Initialization | <-> | Session parameter negotiation |
| 0x0201 | KeepAlive | <-> | Session liveness heartbeat |
| 0x0300 | Address | <- | LSR interface address advertisement |
| 0x0301 | Address Withdraw | <- | Previously advertised address withdrawal |
| 0x0400 | Label Mapping | <- | FEC-to-label binding |
| 0x0401 | Label Request | -> | Request label binding for a FEC |
| 0x0402 | Label Withdraw | <- | Previously advertised label withdrawal |
| 0x0403 | Label Release | <- | Release a previously received label |
| 0x0404 | Label Abort Request | -> | Abort outstanding label request |

### Common Session Parameters TLV (0x0500)

Present as a mandatory parameter in Initialization messages.

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  Protocol Version (2 bytes)   |  KeepAlive Time (2 bytes)     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|A|D|  Reserved   | PVLim       |  Max PDU Length (2 bytes)      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                  Receiver LDP Identifier (6 bytes)            |
+                               +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

| Field | Size | Description |
|-------|------|-------------|
| Protocol Version | 2 bytes | Must be 1. |
| KeepAlive Time | 2 bytes | Seconds. Proposed KeepAlive timer value. Negotiated to the lower of both peers' values. |
| A-bit | 1 bit | Label advertisement discipline: 0=Downstream Unsolicited, 1=Downstream On Demand. |
| D-bit | 1 bit | Loop detection: 0=disabled, 1=enabled. |
| PVLim | 6 bits | Path Vector Limit (when D-bit=1). |
| Max PDU Length | 2 bytes | Maximum LDP PDU size this peer supports. 0 or 4096 means the default (4096 bytes). |
| Receiver LDP Identifier | 6 bytes | The LDP Identifier of the intended receiver. Set to 0.0.0.0:0 if unknown. |

TLV Value length is 14 bytes. Total TLV on wire with header = 18 bytes.

### Generic Label TLV (0x0200)

```
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|0|0| Generic Label (0x0200)    |  Length (= 4)                 |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                  Label (4 bytes)                              |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

For MPLS, the 4-byte value uses MPLS shim header encoding: bits 31:12 contain the 20-bit label value, bits 11:9 are TC/EXP (set to 0 in LDP context), bit 8 is the S (bottom-of-stack) bit, and bits 7:0 are TTL (set to 0 in LDP context).

### FEC TLV (0x0100)

Contains one or more FEC elements:

| Element Type | Code | Format |
|--------------|------|--------|
| Wildcard | 0x01 | 1 byte (just the type byte) |
| Prefix | 0x02 | Type(1) + Address Family(2) + PreLen(1) + Prefix(ceil(PreLen/8)) |
| Host Address | 0x03 | Type(1) + Address Family(2) + AddrLen(1) + Address(AddrLen) |

Address families: 0x0001 = IPv4, 0x0002 = IPv6.

### Address List TLV (0x0101)

```
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  Address Family (2 bytes)     |                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+                               +
|                  Addresses (4 bytes each for IPv4)            |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

---

## TCP Session State Machine (RFC 5036 Section 2.5.4)

```
NON EXISTENT
    |
    v  (TCP connection established)
INITIALIZED
    |
    v  (send Initialization)
OPENSENT ----> NON EXISTENT  (Initialization rejected / timeout)
    |
    v  (receive peer Initialization, send KeepAlive)
OPENREC ----> NON EXISTENT   (error)
    |
    v  (receive peer KeepAlive)
OPERATIONAL
    |
    v  (error / Notification / timeout)
NON EXISTENT
```

This implementation reaches OPENREC (sends KeepAlive after receiving peer's Initialization) in `/connect` and `/label-map`, but does not wait for the peer's KeepAlive to confirm OPERATIONAL state. For `/label-map`, the subsequent data collection implicitly confirms the session is operational if label data arrives.

---

## Known Limitations

### 1. No Hello discovery phase

The implementation skips UDP Hello discovery and connects directly to TCP port 646. Real LDP peers require Hello adjacency before accepting TCP connections. Some peers may reject or ignore connections from non-discovered neighbors.

### 2. Hardcoded LSR ID

The sender's LDP Identifier is hardcoded to `10.0.0.1:0`. A peer that validates the sender's LSR ID (e.g., checking for matching Hello adjacency or IP reachability) may reject the Initialization.

### 3. Receiver LDP Identifier set to 0.0.0.0:0

The Receiver LDP Identifier in the outgoing Common Session Parameters TLV is `0.0.0.0:0` because the peer's identity is unknown before its Initialization arrives. Per RFC 5036, this is acceptable (the field is informational), but strict implementations may flag it.

### 4. No Notification message processing

Received Notification messages (type 0x0001) are recorded in the message list but not parsed for Status TLV content. The Status Code, Fatal/Advisory bit, and error descriptions are not extracted or returned.

### 5. No IPv6 FEC support

Only IPv4 FEC Prefix elements (address family 0x0001) are decoded. IPv6 prefixes (address family 0x0002) are silently skipped. IPv6 addresses in Address List TLVs are also skipped.

### 6. Single PDU read in `/connect` and `/probe`

The response reader (`readLDPResponse`) reads exactly one PDU based on the PDU Length field. If the peer sends its Initialization and KeepAlive in separate PDUs (common behavior), only the first PDU is parsed.

### 7. Collection window cap

The `/label-map` endpoint collects post-handshake data for at most 2 seconds (or the remaining timeout minus 500 ms, whichever is less). Large MPLS networks may need significantly longer to transmit all label bindings.

### 8. 64 KB buffer limit

The `/label-map` endpoint reads at most 65536 bytes of post-handshake data. A large MPLS network advertising thousands of label bindings can easily exceed this.

### 9. Version-1-only scanning in `parseLDPLabelData`

The label data parser scans for PDUs by looking for version=1 at each byte offset, advancing one byte at a time on non-matching positions. This is robust against stream misalignment but could produce false positives if the byte `0x00 0x01` appears in non-PDU data.

### 10. `success: true` for non-LDP peers

`/connect` returns `success: true` whenever TCP connects, even if the peer does not speak LDP. Check `isLDP` to confirm LDP protocol response. `/label-map` returns `success: false` for non-LDP peers.

---

## curl Examples

```bash
# Quick LDP peer check
curl -s -X POST https://portofcall.ross.gg/api/ldp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.0.2.1"}' | jq .

# Lightweight probe (no handshake completion)
curl -s -X POST https://portofcall.ross.gg/api/ldp/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.0.2.1","timeout":5000}' | jq '{isLDP,lsrId,messages}'

# Collect label bindings and addresses
curl -s -X POST https://portofcall.ross.gg/api/ldp/label-map \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.0.2.1","timeout":15000}' \
  | jq '{lsrId,labelCount,addressCount,labels:.labels[:5],addresses}'

# Custom port
curl -s -X POST https://portofcall.ross.gg/api/ldp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.1","port":6460}' | jq .
```

---

## Local Testing

**FRRouting (recommended)**

```bash
# /etc/frr/frr.conf (or /usr/local/etc/frr/frr.conf)
router ldp
 address-family ipv4
  discovery transport-address 192.168.1.1
  interface eth0
 !

# Start FRR
systemctl start frr

# Test against it:
curl -s -X POST https://portofcall.ross.gg/api/ldp/connect \
  -d '{"host":"192.168.1.1"}' | jq .
```

**Mikrotik RouterOS**

```
/mpls ldp
set enabled=yes lsr-id=10.0.0.1 transport-address=10.0.0.1
/mpls ldp interface
add interface=ether1
```

**GNS3 / EVE-NG**

Use Cisco IOS or Junos images with MPLS LDP enabled. The LDP TCP listener starts on port 646 once `mpls ldp router-id Loopback0` (IOS) or `protocols ldp interface` (Junos) is configured.

---

## Initialization PDU Byte Layout (as sent by this implementation)

Total: 36 bytes.

```
Offset  Bytes   Field
------  -----   -----
 0- 1   00 01   Version (1)
 2- 3   00 20   PDU Length (32)
 4- 7   0a 00 00 01   LSR ID (10.0.0.1)
 8- 9   00 00   Label Space ID (0)
10-11   02 00   Message Type (0x0200 = Initialization)
12-13   00 16   Message Length (22)
14-17   00 00 00 01   Message ID (1)
18-19   05 00   TLV Type (0x0500 = Common Session Parameters)
20-21   00 0e   TLV Length (14)
22-23   00 01   Protocol Version (1)
24-25   00 1e   KeepAlive Time (30)
26      00      A=0, D=0
27      00      Path Vector Limit (0)
28-29   10 00   Max PDU Length (4096)
30-35   00 00 00 00 00 00   Receiver LDP Identifier (0.0.0.0:0)
```

## KeepAlive PDU Byte Layout (as sent by this implementation)

Total: 18 bytes.

```
Offset  Bytes   Field
------  -----   -----
 0- 1   00 01   Version (1)
 2- 3   00 0e   PDU Length (14)
 4- 7   0a 00 00 01   LSR ID (10.0.0.1)
 8- 9   00 00   Label Space ID (0)
10-11   02 01   Message Type (0x0201 = KeepAlive)
12-13   00 04   Message Length (4)
14-17   00 00 00 02   Message ID (2)
```
