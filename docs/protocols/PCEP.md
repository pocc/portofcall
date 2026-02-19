# PCEP — Path Computation Element Protocol

**Port:** 4189 (TCP)
**RFC:** 5440 (PCEP), 8231 (Stateful PCE), 8281 (PCE-Initiated LSP), 8664 (Segment Routing)
**Implementation:** `src/worker/pcep.ts`
**Routes:** `POST /api/pcep/connect`, `POST /api/pcep/probe`, `POST /api/pcep/compute`

---

## Overview

PCEP (Path Computation Element Protocol) is a TCP-based protocol used in SDN, MPLS, and Segment Routing networks for requesting and computing network paths between Path Computation Clients (PCC) and Path Computation Elements (PCE). PCE servers can compute optimal paths across complex network topologies with constraints like bandwidth, QoS, and traffic engineering metrics.

**Key Use Cases:**
- PCE server detection in service provider networks
- SDN controller discovery and capability probing
- MPLS/SR-MPLS path computation infrastructure verification
- Network orchestration system health checking
- Path computation with TE constraints (bandwidth, metric preferences)

---

## Endpoints

### `POST /api/pcep/connect`

Performs full PCEP handshake: sends OPEN message, reads server OPEN response, parses capabilities (TLVs), and optionally confirms session with Keepalive exchange.

**Request**

```json
{
  "host":    "pce.example.net",  // required
  "port":    4189,                // default 4189
  "timeout": 10000                // ms, default 10000
}
```

**Response — PCEP server detected**

```json
{
  "success":          true,
  "host":             "pce.example.net",
  "port":             4189,
  "rtt":              142,
  "connectTime":      38,
  "isPCEP":           true,
  "responseType":     "Open",
  "protocolVersion":  1,
  "messageFlags":     0,
  "peerKeepalive":    30,
  "peerDeadtimer":    120,
  "peerSessionId":    42,
  "peerVersion":      1,
  "capabilities": [
    { "type": 16, "name": "STATEFUL-PCE-CAPABILITY", "length": 4 },
    { "type": 26, "name": "SR-PCE-CAPABILITY", "length": 4 },
    { "type": 34, "name": "PATH-SETUP-TYPE-CAPABILITY", "length": 4 }
  ],
  "rawBytesReceived": 36,
  "message":          "PCEP server detected (v1). Response: Open. Keepalive=30s, DeadTimer=120s, 3 TLV(s)."
}
```

**OPEN sent:** Contains OPEN object with:
- Version: 1 (3 bits)
- Keepalive: 30 seconds
- DeadTimer: 120 seconds (4x keepalive per RFC 5440 §4.1)
- Session ID: 1
- No optional parameters (no capability TLVs)

**Keepalive acknowledgment:** After receiving server OPEN, a Keepalive is sent to confirm session establishment. Write errors during this step are silently ignored.

**Response — non-PCEP server**

```json
{
  "success":        true,
  "host":           "192.0.2.1",
  "port":           4189,
  "rtt":            23,
  "connectTime":    15,
  "isPCEP":         false,
  "responseType":   "Unknown",
  "rawBytesReceived": 4,
  "message":        "Server responded but does not appear to be a PCEP server."
}
```

**Response — connection/timeout failure**

```json
{
  "success": false,
  "error":   "Connection timeout"
}
```

**Known TLV capability names:**

| Type | Name | RFC |
|------|------|-----|
| 16 | STATEFUL-PCE-CAPABILITY | RFC 8231 |
| 17 | SYMBOLIC-PATH-NAME | RFC 8231 |
| 26 | SR-PCE-CAPABILITY | RFC 8664 |
| 34 | PATH-SETUP-TYPE-CAPABILITY | RFC 8408 |
| 65505 | VENDOR-INFORMATION | RFC 7470 |

Unknown TLV types appear as `TLV-<type>`.

---

### `POST /api/pcep/probe`

Lightweight PCEP server check: sends OPEN, reads 4-byte response header only, validates version and message type. Does not parse full OPEN body or capabilities.

**Request**

```json
{
  "host":    "pce.example.net",  // required
  "port":    4189,                // default 4189
  "timeout": 10000                // ms, default 10000
}
```

**Response — PCEP detected**

```json
{
  "success":      true,
  "host":         "pce.example.net",
  "port":         4189,
  "rtt":          45,
  "isPCEP":       true,
  "responseType": "Open",
  "message":      "PCEP server detected (response: Open)."
}
```

**Response — not PCEP**

```json
{
  "success":      true,
  "host":         "192.0.2.1",
  "port":         4189,
  "rtt":          18,
  "isPCEP":       false,
  "responseType": "Unknown",
  "message":      "Not a PCEP server."
}
```

**Use case:** Faster than `/connect` when you only need to verify PCEP protocol presence without parsing capabilities.

---

### `POST /api/pcep/compute`

Performs full PCEP session establishment (OPEN + Keepalive handshake), then sends a PCReq (Path Computation Request) message and parses the PCRep (Path Computation Reply) to extract computed path, hops, metrics, and attributes.

**Request**

```json
{
  "host":      "pce.example.net",   // required
  "port":      4189,                 // default 4189
  "timeout":   15000,                // ms, default 15000
  "requestId": 12345,                // optional; random if omitted
  "srcAddr":   "10.0.1.1",          // required; IPv4 source
  "dstAddr":   "10.0.2.1",          // required; IPv4 destination
  "bandwidth": 1000000000            // optional; bytes/sec (float32)
}
```

**IPv4 validation:** Both `srcAddr` and `dstAddr` must be valid IPv4 dotted-decimal addresses (e.g., "10.0.1.1"). Each octet must be 0-255. Invalid addresses like "999.999.999.999" or "10.0.0.256" are rejected.

**Bandwidth encoding:** Encoded as IEEE 754 float32 in BANDWIDTH object (class 5, type 1) per RFC 5440 §7.7. Value is in bytes per second.

**Session flow:**

```
→ OPEN (client)
← OPEN (server, with capabilities)
→ Keepalive (confirm session)
→ PCReq (RP object + END-POINTS object + optional BANDWIDTH object)
← PCRep (with ERO, METRIC, LSPA objects) or NO-PATH
```

**Response — path found**

```json
{
  "success":         true,
  "host":            "pce.example.net",
  "port":            4189,
  "rtt":             234,
  "requestId":       12345,
  "pathFound":       true,
  "hops": [
    { "type": 1, "addr": "10.0.1.1", "prefix": 32, "loose": false },
    { "type": 1, "addr": "10.1.0.1", "prefix": 32, "loose": false },
    { "type": 1, "addr": "10.0.2.1", "prefix": 32, "loose": false }
  ],
  "igpCost":         100.0,
  "teCost":          50.0,
  "setupPriority":   3,
  "holdingPriority": 3,
  "message":         "Path computed: 3 hop(s)"
}
```

**ERO hop types:**

| Type | Description | Format |
|------|-------------|--------|
| 1 | IPv4 prefix | 4-byte address + 1-byte prefix length + loose bit |
| 2 | IPv6 prefix | 16-byte address + 1-byte prefix length + loose bit |
| 3 | Label (MPLS) | 32-bit label |
| 4 | Unnumbered Interface ID | Router ID + Interface ID |

Only type 1 (IPv4 prefix) is decoded by the current implementation. Other types are skipped.

**Loose vs strict hop:** The high bit of the subobject type indicates loose (bit 7 = 1) or strict (bit 7 = 0). Loose hops allow the route to include additional nodes; strict hops must be traversed directly.

**METRIC types:**

| Type | Name | Field |
|------|------|-------|
| 1 | IGP Metric | `igpCost` |
| 2 | TE Metric | `teCost` |
| 3 | Hop Counts | not decoded |

Metric values are IEEE 754 float32. Unknown metric types are silently ignored.

**Response — no path found**

```json
{
  "success":      true,
  "host":         "pce.example.net",
  "port":         4189,
  "rtt":          89,
  "requestId":    12345,
  "pathFound":    false,
  "hops":         [],
  "igpCost":      null,
  "teCost":       null,
  "noPathReason": 1,
  "message":      "No path found (reason: 1)"
}
```

**NO-PATH reasons (RFC 5440 §7.5):**

| Code | Meaning |
|------|---------|
| 0 | No path satisfying constraints |
| 1 | PCE chain broken |
| 2 | Unknown destination |
| 3 | Unknown source |

**Response — no PCRep received**

```json
{
  "success":   true,
  "host":      "pce.example.net",
  "port":      4189,
  "rtt":       15001,
  "requestId": 12345,
  "pathFound": false,
  "hops":      [],
  "igpCost":   null,
  "teCost":    null,
  "message":   "No PCRep received from server"
}
```

This occurs when the server does not send a PCRep within 4 read attempts (skipping intervening Keepalives).

**Response — session establishment failure**

```json
{
  "success": false,
  "error":   "Server did not respond with a valid PCEP OPEN"
}
```

---

## PCEP Message Reference

| Type | Code | Name | Direction | Usage |
|------|------|------|-----------|-------|
| Open | 1 | OPEN | → ← | Session establishment; version, keepalive, deadtimer, SID, capabilities |
| Keepalive | 2 | Keepalive | → ← | Heartbeat; confirms session; no body (4-byte header only) |
| PCReq | 3 | PCReq | → | Path computation request; RP + END-POINTS + constraints |
| PCRep | 4 | PCRep | ← | Path computation reply; ERO (path) or NO-PATH |
| PCNtf | 5 | PCNtf | ← | Notification; informational |
| PCErr | 6 | PCErr | ← | Error; protocol violations |
| Close | 7 | Close | → ← | Session teardown |
| PCMonReq | 10 | PCMonReq | → | Monitoring request (RFC 5886) |
| PCMonRep | 11 | PCMonRep | ← | Monitoring reply |
| StartTLS | 12 | StartTLS | → ← | TLS upgrade (RFC 8253) |

**Common Header (4 bytes):**

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Ver |  Flags  |  Message Type |       Message Length          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

- **Ver** (3 bits): Protocol version (currently 1)
- **Flags** (5 bits): Reserved (must be 0)
- **Message Type** (1 byte): See table above
- **Message Length** (2 bytes, big-endian): Total including header (min 4)

---

## PCEP Object Reference

| Class | Name | Usage |
|-------|------|-------|
| 1 | OPEN | Session parameters, capabilities (TLVs) |
| 2 | RP (Request Parameters) | Request ID, flags, priority |
| 3 | NO-PATH | Reason code when no path can be computed |
| 4 | END-POINTS | Source and destination addresses (IPv4/IPv6) |
| 5 | BANDWIDTH | Requested bandwidth (IEEE 754 float32) |
| 6 | METRIC | IGP cost, TE cost, hop count |
| 7 | ERO (Explicit Route Object) | Computed path as list of hops |
| 9 | LSPA (LSP Attributes) | Setup/holding priority, local protection |

**Object Header (4 bytes):**

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Object-Class  |   OT  |Res|P|I|   Object Length               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

- **Object-Class** (1 byte): See table above
- **OT** (Object Type, 4 bits): Variant (e.g., IPv4 vs IPv6 for END-POINTS)
- **Res** (Reserved, 2 bits): Must be 0
- **P** (Processing-Rule, 1 bit): 1 = must understand, 0 = optional
- **I** (Ignore, 1 bit): 1 = ignore if unknown
- **Object Length** (2 bytes, big-endian): Total including header (min 4)

**Padding:** Objects are padded to 4-byte boundaries per RFC 5440 §7.2.

---

## Wire Protocol Flow

### `/connect` — Full handshake with capabilities

```
[TCP connect] → connectTime measured
→ OPEN (ver=1, keepalive=30s, deadtimer=120s, sid=1, no TLVs)
← OPEN (server version, parameters, capability TLVs)
→ Keepalive (acknowledge)
[close]
← rtt measured from start
```

**Capabilities parsed:** TLV type/length extracted from OPEN object optional parameters. TLV values are not decoded, only type codes are matched against known names.

### `/probe` — Header-only check

```
[TCP connect]
→ OPEN
← first 4 bytes (common header)
[validate version=1 and message type]
[close]
← rtt measured
```

**No body parsing:** OPEN object body and TLVs are not read. Faster but provides no capability information.

### `/compute` — Path computation

```
[TCP connect]
→ OPEN (client)
← OPEN (server)
→ Keepalive
→ PCReq (RP + END-POINTS + optional BANDWIDTH)
← [Keepalive skipped] … ← PCRep (RP + ERO/NO-PATH + METRIC + LSPA)
[close]
← rtt measured
```

**PCReq structure:**

```
RP object (class 2, type 1):
  - Flags (4 bytes): all zero
  - Request ID (4 bytes): uint32

END-POINTS object (class 4, type 1 = IPv4):
  - Source IPv4 (4 bytes)
  - Destination IPv4 (4 bytes)

BANDWIDTH object (class 5, type 1) [optional]:
  - Bandwidth (4 bytes): IEEE 754 float32
```

**PCRep parsing loop:** Reads up to 4 messages, skipping Keepalives, until a PCRep (type 4) is found. Objects within PCRep are parsed sequentially:
- RP → extract request ID
- NO-PATH → set `pathFound = false`, extract reason code
- ERO → set `pathFound = true`, parse subobjects (IPv4 prefix hops)
- LSPA → extract setup/holding priority
- METRIC → extract IGP cost (type 1) or TE cost (type 2)

---

## Known Limitations and Quirks

### 1. No capability TLVs sent in client OPEN

Client OPEN contains no optional parameters (`OptParamLen = 0`). Server capabilities are parsed, but the client does not advertise support for stateful PCE, segment routing, or other extensions. Some PCE servers may refuse to compute SR-TE paths if the client doesn't advertise SR capability.

**Workaround:** For capability-sensitive PCEs, use a full PCEP client library (e.g., Cisco pyPCEP, OpenDaylight PCEP).

### 2. Only IPv4 END-POINTS and ERO hops decoded

END-POINTS object uses type 1 (IPv4) only. IPv6 (type 2) is not supported. ERO subobject parsing extracts only type 1 (IPv4 prefix). Types 2 (IPv6), 3 (Label), 4 (Unnumbered Interface), and SR-specific subobjects are silently skipped.

### 3. TLV value padding calculation was incorrect (FIXED)

**Bug (line 226):** TLV offset increment used `Math.ceil(tlvLength / 4) * 4` as the full offset, but the correct increment is `4 + paddedValueLength`. This caused TLV parsing to fail when multiple TLVs were present, often reading garbage data as the next TLV type.

**Fixed:** Changed to `const paddedValueLen = Math.ceil(tlvLength / 4) * 4; tlvOffset += 4 + paddedValueLen;` to properly account for the 4-byte TLV header.

### 4. Object padding not applied in PCRep parsing (FIXED)

**Bug (line 610):** `parsePCRepBody` advanced offset by raw object length instead of padded length. For objects with length not divisible by 4, the next object header was read at the wrong offset, causing parse failures.

**Fixed:** Added `const paddedObjLen = Math.ceil(objLen / 4) * 4; offset += paddedObjLen;` per RFC 5440 §7.2.

### 5. `readExact()` could return more data than requested (FIXED)

**Bug (lines 140-158):** Accumulated chunks until `total >= needed`, then returned all `total` bytes. If the last chunk pushed `total` beyond `needed`, extra data was included, causing protocol desynchronization.

**Fixed:** Changed to `combined.set(chunk.subarray(0, toCopy), offset)` to copy exactly `needed` bytes.

### 6. Timeout not cleared on early success (FIXED)

**Bug:** `setTimeout()` callback was never cleared. When reads succeeded before timeout, the timer remained scheduled and would fire later, potentially causing spurious errors.

**Fixed:** Replaced `timeoutPromise` with `timeoutHandle = { id: setTimeout(...) }` and added `if (timeoutHandle.id) clearTimeout(timeoutHandle.id)` in `finally` blocks.

### 7. Missing port validation in `/probe` (FIXED)

**Bug:** `/connect` and `/compute` validated `port` range (1-65535), but `/probe` did not. Invalid ports like 0 or 99999 were passed to `connect()`, causing unclear errors.

**Fixed:** Added port range check to `/probe` handler.

### 8. No IPv4 address octet validation (FIXED)

**Bug (line 492):** `ipToBytes()` split on "." and called `Number()` but didn't validate octets. Addresses like "999.999.999.999" or "10.0.0.256" were converted to bytes, producing out-of-range values (truncated to uint8 via `Uint8Array` constructor).

**Fixed:** Added `if (parts.some(p => p < 0 || p > 255 || !Number.isInteger(p))) throw new Error(...)`.

### 9. Missing object length bounds check (FIXED)

**Bug (line 575):** Checked `offset + 4 <= data.length` (header fits) but then accessed `offset + objLen` without verifying `objLen` itself is valid. Corrupted or malicious PCRep with `objLen = 65535` could read beyond buffer.

**Fixed:** Added `objLen > 65535` check to reject obviously invalid lengths before using.

### 10. No COMMUNITY, BANDWIDTH, or AS_PATH attribute decoding

LSPA and METRIC objects are parsed, but many common path attributes are missing:
- COMMUNITY (class 8) — not defined in PCEP spec
- Returned bandwidth (only requested bandwidth is sent)
- AS_PATH — not part of PCEP (BGP concept)

### 11. Hard-coded 4-message read limit for PCRep

The loop in `handlePCEPCompute` reads at most 4 messages (lines 741-759). If the server sends more than 3 Keepalives before the PCRep, the response is `"No PCRep received from server"` even though the PCRep may arrive later.

**Workaround:** Increase timeout or modify loop limit for slow PCE servers.

### 12. No PCEP error code decoding

If the server sends a PCErr message (type 6), it is not parsed. The endpoint returns a generic error or timeout. Error types and values (RFC 5440 §7.15) are not exposed.

### 13. No session persistence

Each endpoint establishes a new TCP connection and PCEP session. Sessions are not reused across requests. For production PCE clients, persistent sessions with keepalive timers are standard.

### 14. Keepalive write errors silently ignored

Line 354: `catch { /* Ignore write errors during handshake completion */ }`. If the Keepalive write fails (e.g., peer closed connection), the error is swallowed and the endpoint returns `success: true` with partial data.

### 15. No TLS support (StartTLS message type 12)

RFC 8253 defines PCEP over TLS using the StartTLS message. This is not implemented. All connections are plaintext TCP.

### 16. No stateful PCE operations (PCUpd, PCRpt, PCInitiate)

RFC 8231 defines PCUpd (type 11), PCRpt (type 10), and PCInitiate (type 12) for stateful path management. These are not supported.

### 17. `requestId` range unchecked

User-provided `requestId` is not validated. RFC 5440 §7.4 specifies RP Request-ID-number as 32-bit uint. Values > `2^32 - 1` wrap or cause encoding errors.

### 18. No OPEN object version mismatch handling

If server OPEN has `version != 1`, the error is generic `"Server did not respond with a valid PCEP OPEN"`. RFC 5440 §7.11 defines error type 1, value 1 (Unsupported PCEP Version) for this case.

### 19. Message length not validated against header claim

`parsePCEPHeader` extracts `messageLength` but doesn't verify that subsequent reads match. If server sends header claiming 100 bytes but provides only 20, `readExact` times out instead of detecting truncation early.

### 20. No Cloudflare detection in `/probe`

`/connect` and `/compute` call `checkIfCloudflare()` (line 284, 656), but `/probe` does not. Probing Cloudflare-proxied hosts on port 4189 may yield false positives or unclear errors.

---

## curl Examples

```bash
# Quick PCEP server check (header only)
curl -X POST https://portofcall.ross.gg/api/pcep/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"pce.example.net"}' | jq .

# Full handshake with capability discovery
curl -X POST https://portofcall.ross.gg/api/pcep/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"pce.example.net","port":4189}' \
  | jq '{isPCEP,responseType,peerKeepalive,peerDeadtimer,capabilities}'

# Compute path from 10.0.1.1 to 10.0.2.1
curl -X POST https://portofcall.ross.gg/api/pcep/compute \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "pce.example.net",
    "srcAddr": "10.0.1.1",
    "dstAddr": "10.0.2.1"
  }' | jq '{pathFound,hops,igpCost,teCost}'

# Path computation with bandwidth constraint (1 Gbps)
curl -X POST https://portofcall.ross.gg/api/pcep/compute \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "pce.example.net",
    "srcAddr": "10.0.1.1",
    "dstAddr": "10.0.2.1",
    "bandwidth": 1000000000,
    "timeout": 20000
  }' | jq .

# Custom request ID for correlation
curl -X POST https://portofcall.ross.gg/api/pcep/compute \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "pce.example.net",
    "srcAddr": "192.0.2.1",
    "dstAddr": "192.0.2.100",
    "requestId": 42
  }' | jq '{requestId,pathFound,message}'
```

---

## Local Testing

**Cisco NSO with PCE module (recommended for production-grade testing)**

```bash
# NSO includes a full PCEP server implementation
# Requires Cisco DevNet account and NSO installation
ncs-setup --package cisco-nso-nc-5.5
cd nso-run-dir
ncs
ncs_cli -C -u admin

# Enable PCEP server
config
pcep server
 address 0.0.0.0 port 4189
 commit

# Test from portofcall
curl -X POST https://portofcall.ross.gg/api/pcep/connect \
  -d '{"host":"YOUR_PUBLIC_IP","port":4189}' | jq .
```

**OpenDaylight (open source SDN controller with PCE)**

```bash
# Download and run OpenDaylight Phosphorus SR3 (or later)
wget https://nexus.opendaylight.org/content/repositories/opendaylight.release/org/opendaylight/integration/opendaylight/0.15.3/opendaylight-0.15.3.tar.gz
tar xf opendaylight-0.15.3.tar.gz
cd opendaylight-0.15.3
./bin/karaf

# In Karaf console:
feature:install odl-bgpcep-pcep-all

# PCEP server listens on 0.0.0.0:4189 by default
# Configure via RESTCONF or XML files in etc/opendaylight/karaf/

# Test:
curl -X POST https://portofcall.ross.gg/api/pcep/connect \
  -d '{"host":"YOUR_PUBLIC_IP"}' | jq .
```

**pyPCEP (Python PCEP library for custom server)**

```python
# pip install scapy
from scapy.contrib.pce import *
from scapy.layers.inet import TCP, IP
from scapy.sendrecv import send, sniff

# Minimal PCEP OPEN responder
def pcep_responder(pkt):
    if TCP in pkt and pkt[TCP].dport == 4189:
        if PCEP in pkt and pkt[PCEP].msg_type == 1:  # OPEN
            resp = IP(dst=pkt[IP].src)/TCP(dport=pkt[TCP].sport, sport=4189, flags='PA')
            resp /= PCEP(msg_type=1)/PCEPOpen(keepalive=30, deadtimer=120, sid=42)
            send(resp)

sniff(filter="tcp port 4189", prn=pcep_responder)
```

**Public PCE servers:** Some network research labs and IXPs run public PCE servers for testing. Check IETF PCEP working group mailing list or contact service provider NOCs for test access.

---

## PCEP Session State Machine (Simplified)

```
SessionUP ::=
  Idle → OpenWait: send OPEN
  OpenWait → KeepWait: receive OPEN, send Keepalive
  KeepWait → SessionUp: receive Keepalive
  SessionUp: PCReq/PCRep exchange

SessionDown ::=
  Any → Idle: receive Close or PCErr
```

The implementation does not maintain explicit state — each endpoint is a single request/response exchange. `/connect` reaches KeepWait; `/compute` reaches SessionUp and exchanges one PCReq/PCRep before closing.

---

## References

- [RFC 5440 — Path Computation Element (PCE) Communication Protocol (PCEP)](https://datatracker.ietf.org/doc/html/rfc5440)
- [RFC 8231 — Stateful PCE Extensions](https://datatracker.ietf.org/doc/html/rfc8231)
- [RFC 8281 — PCE-Initiated LSP Setup](https://datatracker.ietf.org/doc/html/rfc8281)
- [RFC 8664 — PCEP Extensions for Segment Routing](https://datatracker.ietf.org/doc/html/rfc8664)
- [RFC 8253 — PCEP over TLS](https://datatracker.ietf.org/doc/html/rfc8253)
- [RFC 8408 — Conveying Path Setup Type in PCEP](https://datatracker.ietf.org/doc/html/rfc8408)
- [OpenDaylight PCEP User Guide](https://docs.opendaylight.org/projects/bgpcep/en/latest/pcep/index.html)
- [Cisco NSO PCEP Package](https://developer.cisco.com/docs/nso/)

---

## Notes

- **Everything is Constraint-Based:** PCEP excels at computing paths with bandwidth, metric, and administrative constraints that would be infeasible with distributed IGP routing.
- **Stateless vs Stateful:** RFC 5440 defines stateless PCE (compute-and-forget). RFC 8231 adds stateful PCE where the server tracks LSP state and can update paths.
- **Segment Routing Integration:** RFC 8664 extends PCEP to request SR-TE paths with segment lists (SIDs). This is critical for modern SDN/SR networks.
- **Production Deployments:** Major service providers use PCEP for MPLS Traffic Engineering, optical networks (GMPLS), and segment routing. It's less common in enterprise networks.
