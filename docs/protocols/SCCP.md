# SCCP (Skinny Client Control Protocol)

**Reviewed:** 2026-02-18
**Implementation:** `/src/worker/sccp.ts`
**Status:** Deployed with fixes

## Overview

SCCP (Skinny Client Control Protocol), also known as "Skinny", is Cisco's proprietary VoIP signaling protocol for communication between Cisco IP phones and Cisco Unified Communications Manager (CUCM). The protocol follows a client-server model where phones act as lightweight "skinny" clients and CUCM provides all call control intelligence.

**Default Port:** 2000 (TCP), 2443 (TLS/SCCPS)
**Transport:** TCP (connection-oriented, stateful)
**Alternative:** SIP (RFC 3261, open standard)

## API Endpoints

### 1. KeepAlive Probe

**Endpoint:** `POST /api/sccp/probe`

Lightweight connection test — sends a KeepAlive message (0x0000) and waits for KeepAliveAck (0x0100).

**Request:**
```json
{
  "host": "string",        // Required: CUCM hostname or IP
  "port": 2000,            // Optional: default 2000
  "timeout": 10000         // Optional: ms, default 10000
}
```

**Response (success):**
```json
{
  "success": true,
  "probe": "keepalive",
  "connected": true,
  "keepAliveAck": true,           // true if 0x0100 received
  "connectMs": 123,               // TCP handshake time
  "latencyMs": 234,               // Total round-trip time
  "responseBytes": 12,
  "messages": [
    {
      "id": "0x0100",
      "name": "KeepAliveAck",
      "dataLength": 0
    }
  ]
}
```

**Response (error):**
```json
{
  "success": false,
  "error": "Connection timeout"
}
```

### 2. Device Registration

**Endpoint:** `POST /api/sccp/register`

Full device registration flow — sends Station Register message (0x0001) with device name, type, and capabilities.

**Request:**
```json
{
  "host": "string",                    // Required
  "port": 2000,                        // Optional: default 2000
  "deviceName": "SEP001122334455",     // Optional: default SEP001122334455
  "deviceType": 8,                     // Optional: default 8 (Cisco 7960)
  "timeout": 10000                     // Optional: ms, default 10000
}
```

**Device Types:**
- `1` = Cisco 30 SP+
- `2` = Cisco 12 SP+
- `3` = Cisco 12 SP
- `4` = Cisco 12 S
- `5` = Cisco 30 VIP
- `6` = Cisco Telecaster
- `7` = Cisco 7910
- `8` = Cisco 7960 (default)
- `9` = Cisco 7940
- `12` = Cisco 7935
- `20` = Cisco 7920
- `30007` = Cisco 7961
- `30008` = Cisco 7941

**Response (registered):**
```json
{
  "success": true,
  "registration": {
    "status": "registered",           // "registered" | "rejected" | "no_response" | "unknown"
    "deviceName": "SEP001122334455",
    "deviceType": 8,
    "deviceTypeName": "Cisco 7960",
    "registered": true,
    "rejected": false,
    "capabilitiesRequested": true     // true if CUCM sent 0x0097 CapabilitiesRequest
  },
  "connectMs": 45,
  "latencyMs": 123,
  "responseBytes": 24,
  "messages": [
    {
      "id": "0x0081",
      "name": "RegisterAck",
      "dataLength": 0
    },
    {
      "id": "0x0097",
      "name": "CapabilitiesRequest",
      "dataLength": 0
    }
  ]
}
```

**Response (rejected):**
```json
{
  "success": true,
  "registration": {
    "status": "rejected",
    "deviceName": "SEP001122334455",
    "deviceType": 8,
    "deviceTypeName": "Cisco 7960",
    "registered": false,
    "rejected": true,
    "capabilitiesRequested": false
  },
  "connectMs": 45,
  "latencyMs": 89,
  "responseBytes": 12,
  "messages": [
    {
      "id": "0x0082",
      "name": "RegisterReject",
      "dataLength": 0
    }
  ]
}
```

### 3. Line State Query

**Endpoint:** `POST /api/sccp/linestate`

Query line/button configuration and codec capabilities. Performs full registration, then sends ButtonTemplateRequest (0x000E) and CapabilitiesRequest (0x0021).

**Request:**
```json
{
  "host": "string",                    // Required
  "port": 2000,                        // Optional: default 2000
  "timeout": 10000,                    // Optional: ms, default 10000
  "deviceName": "SEP001122334455",     // Optional: default SEP001122334455
  "lineNumber": 1                      // Optional: filter to specific line
}
```

**Response:**
```json
{
  "success": true,
  "registered": true,
  "capabilitiesRequested": true,
  "lines": [
    {
      "number": 1,
      "buttonType": "Line",
      "label": "Main Line",            // Optional: 40-byte label if present
      "ringMode": "Off"                // "Off" | "Inside" | "Outside" | "Feature"
    },
    {
      "number": 2,
      "buttonType": "SpeedDial",
      "ringMode": "Off"
    }
  ],
  "capabilities": [
    "G.711 u-law",
    "G.711 a-law",
    "G.729 Annex A"
  ],
  "connectMs": 45,
  "latencyMs": 234
}
```

**Button Types:**
- `0x00` = Unused
- `0x09` = Line
- `0x15` = SpeedDial
- `0x21` = FeatureButton
- `0x26` = Conference
- `0x27` = ForwardAll
- `0x28` = ForwardBusy
- `0x29` = ForwardNoAnswer
- `0x2A` = Display
- `0x2B` = Line (alternate)
- `0xFF` = Unknown

**Supported Codecs:**
- G.711 u-law (codec 1)
- G.711 a-law (codec 2)
- G.722 (codec 3)
- G.723.1 (codec 4)
- G.728 (codec 6)
- G.729 (codec 7)
- G.729 Annex A (codec 8)
- G.729 Annex B (codec 9)
- G.729 Annex A+B (codec 10)
- GSM Full Rate (codec 11)
- GSM Half Rate (codec 12)
- Wideband 256k (codec 16)
- G.722.1 (codec 20)
- iSAC (codec 25)
- ILBC (codec 40)
- H.261 (codec 82)
- H.263 (codec 86)
- Transparent (codec 100)

### 4. Call Setup

**Endpoint:** `POST /api/sccp/call-setup`

Simulate outbound call placement. Registers device, goes off-hook (0x0006), sends dial digits via KeypadButton messages (0x0003), and collects call state changes.

**Request:**
```json
{
  "host": "string",                    // Required
  "port": 2000,                        // Optional: default 2000
  "timeout": 15000,                    // Optional: ms, default 15000
  "deviceName": "SEP001122334455",     // Optional: default SEP001122334455
  "dialNumber": "1000"                 // Optional: default "1000" (digits only: 0-9, *, #)
}
```

**Response:**
```json
{
  "success": true,
  "registered": true,
  "capabilitiesRequested": true,
  "offHookSent": true,
  "digitsSent": "1000",
  "toneStarted": true,                 // true if StartTone (0x0113) received
  "callState": "RingOut",              // Call state if CallState message received
  "displayText": "Calling 1000",       // Display text if DisplayText message received
  "openReceiveChannel": false,         // true if OpenReceiveChannel (0x0110) received
  "serverMessages": [
    { "id": "0x0081", "name": "RegisterAck" },
    { "id": "0x0097", "name": "CapabilitiesRequest" },
    { "id": "0x0113", "name": "StartTone" },
    { "id": "0x008F", "name": "CallState" },
    { "id": "0x0091", "name": "DisplayText" }
  ],
  "latencyMs": 1234,
  "note": "Server did not send RegisterAck — may require authorized device name/MAC"
}
```

**Call States:**
- `1` = OffHook
- `2` = OnHook
- `3` = RingOut
- `4` = RingIn
- `5` = Connected
- `6` = Busy
- `7` = Congestion
- `8` = Hold
- `9` = CallWaiting
- `10` = CallTransfer
- `12` = Park

## Protocol Specification

### Message Format

All SCCP messages use a 12-byte fixed header followed by variable-length payload:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    Message Length (LE uint32)                 |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                  Reserved (LE uint32, 0x00000000)             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     Message ID (LE uint32)                    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     Message Data (variable)                   |
~                                                               ~
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

**Message Length:** Total bytes of Reserved (4) + Message ID (4) + Data (N). Does NOT include the length field itself.

**Reserved:** Always 0x00000000 in SCCP versions ≤17. In SCCP v18+, this field contains a version number (e.g., 0x00000012 for v18).

**Endianness:** All multi-byte fields are **little-endian**.

### Station Register Message (0x0001)

Payload layout (36 bytes):

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    Device Name (16 bytes)                     |
|                    (null-terminated string)                   |
|                    e.g., "SEP001122334455"                    |
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                      User ID (LE uint32)                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    Instance (LE uint32)                       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                   IP Address (LE uint32)                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                   Device Type (LE uint32)                     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                   Max Streams (LE uint32)                     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

**Device Name:** Typically `SEP<MAC>` (Selsius Ethernet Phone) or `ATA<MAC>` for analog adapters. MAC is 12 hex digits uppercase.

**User ID:** Usually 0.

**Instance:** Device instance number, typically 1.

**IP Address:** Device IP in network byte order (LE uint32). Set to 0 for auto-detect.

**Device Type:** See device type table above.

**Max Streams:** Maximum concurrent RTP streams. Set to 0 for default.

### CapabilitiesResponse Message (0x0020)

Payload layout:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                   Codec Count (LE uint32)                     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                   Codec ID (LE uint32)                        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|              Max Frames Per Packet (LE uint32)                |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
~              (repeat for each codec)                          ~
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

Each codec entry is 8 bytes (codec ID + max frames).

### ButtonTemplateResponse (0x0086 or 0x0097)

Payload layout:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                 Button Offset (LE uint32)                     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                 Button Count (LE uint32)                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|              Total Button Count (LE uint32)                   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  Instance # |  Button Def |    Label (40 bytes, optional)    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
~              (repeat for each button)                         ~
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

**Instance Number:** Line/button number (1-based).

**Button Definition:** See button types table above.

**Label:** 40-byte null-terminated ASCII string (optional, implementation-dependent).

### KeypadButton Message (0x0003)

Payload layout (4 bytes):

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|    Button   | Line Instance | Call Reference|    Reserved   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

**Button:** ASCII code of digit (0x30-0x39 for '0'-'9', 0x2A for '*', 0x23 for '#').

**Line Instance:** Line number (0-based).

**Call Reference:** Active call ID (0 for new call).

### Message Flow Examples

#### 1. KeepAlive Flow
```
Client → Server: KeepAlive (0x0000, no data)
Server → Client: KeepAliveAck (0x0100, no data)
```

#### 2. Registration Flow
```
Client → Server: Register (0x0001, 36 bytes)
Server → Client: RegisterAck (0x0081) OR RegisterReject (0x0082)
Server → Client: CapabilitiesRequest (0x0097, optional)
Client → Server: CapabilitiesResponse (0x0020, codec list)
```

#### 3. Call Setup Flow
```
Client → Server: OffHook (0x0006)
Server → Client: StartTone (0x0113, dial tone)
Client → Server: KeypadButton (0x0003, digit '1')
Client → Server: KeypadButton (0x0003, digit '0')
Client → Server: KeypadButton (0x0003, digit '0')
Client → Server: KeypadButton (0x0003, digit '0')
Server → Client: CallState (0x008F, RingOut)
Server → Client: DisplayText (0x0091, "Calling 1000")
Server → Client: OpenReceiveChannel (0x0110)
Client → Server: IpPort (0x0002, RTP port)
Server → Client: StartMediaTransmission (0x0105)
```

## Known Issues and Limitations

### 1. Register Message Format Corrected (Fixed 2026-02-18)
**Previous bug:** `buildRegister()` created 28-byte payload missing IP Address and Max Streams fields.

**Fix:** Added IP Address (offset 24-27, value 0 for auto) and Max Streams (offset 32-35, value 0 for default). Total payload now 36 bytes per SCCP specification.

**Impact:** Registration may have failed on strict CUCM servers expecting full 36-byte payload.

### 2. Codec ID Error in CapabilitiesResponse (Fixed 2026-02-18)
**Previous bug:** Codec ID 4 advertised as "G.711 u-law" (line 739).

**Actual:** Codec 4 = G.723.1, Codec 1 = G.711 u-law per SCCP codec table.

**Fix:** Changed codec ID from 4 to 1 in `buildCapabilitiesResponse()`.

**Impact:** CUCM would receive wrong codec advertisement, possibly causing call setup failures or incorrect codec selection.

### 3. START_TONE Message ID Mismatch (Fixed 2026-02-18)
**Previous bug:** `CALL_MSG.START_TONE = 0x0082` (line 718), but `MSG_NAMES[0x0113] = 'StartTone'`.

**Actual:** StartTone is 0x0113, not 0x0082 (0x0082 is RegisterReject in Station→CM direction).

**Fix:** Changed `START_TONE` from 0x0082 to 0x0113.

**Impact:** Call setup endpoint would not detect tone start events, reporting `toneStarted: false` even when dial tone was sent.

### 4. parseMessages Bounds Validation Missing (Fixed 2026-02-18)
**Previous bug:** `totalSize` used to slice data before checking if `offset + totalSize <= data.length`.

**Risk:** Malformed or malicious `messageLength` field could cause out-of-bounds read or infinite loop.

**Fix:** Added bounds check `if (offset + totalSize > data.length || totalSize < 12) break;` before slicing.

**Impact:** Improved robustness against malformed SCCP messages.

### 5. No SCCP Version Field Support
**Limitation:** Implementation assumes SCCP v17 or earlier (Reserved field = 0x00000000).

**SCCP v18+ behavior:** Reserved field contains version number (e.g., 0x00000012). This implementation does NOT check or set version field.

**Impact:** May fail to communicate with SCCP v18+ servers expecting version negotiation. Wireshark dissector also fails on v18.

**Workaround:** None in current implementation.

### 6. No TLS/SCCPS Support
**Limitation:** Only plaintext SCCP on port 2000. No support for encrypted SCCPS (port 2443, TLS 1.2+).

**Security risk:** Signaling and credentials transmitted in cleartext.

**Workaround:** Use external TLS proxy or upgrade to SIP with TLS.

### 7. No Connection Reuse
**Limitation:** Each API call opens fresh TCP connection, performs operation, then closes. No persistent connection or session pooling.

**Impact:** Higher latency (3× TCP handshakes for register → linestate → call-setup). CUCM may rate-limit frequent connections from same IP.

**Workaround:** Use /probe endpoint for lightweight checks instead of full registration.

### 8. No Multi-Message TCP Segment Reassembly
**Limitation:** `readWithTimeout()` reads up to 3 chunks then stops. If SCCP response is fragmented across >3 TCP segments, later segments are dropped.

**Impact:** Large responses (e.g., ButtonTemplate with many lines, CapabilitiesAck with many codecs) may be truncated.

**Workaround:** Increase timeout or use lower MTU to avoid fragmentation.

### 9. ButtonTemplateResponse Label Detection Heuristic
**Issue:** Label field is optional and implementation-dependent. Code uses heuristic "check if next 40 bytes contain printable ASCII" to detect label presence (line 498-505).

**Risk:** Binary button data with coincidentally printable bytes may be misinterpreted as label, corrupting offset tracking.

**Workaround:** None. This is inherent ambiguity in SCCP protocol.

### 10. No Media (RTP) Handling
**Limitation:** Implementation handles signaling only. Does not open RTP ports, handle OpenReceiveChannel responses, or establish media streams.

**Impact:** Call setup endpoint reports `openReceiveChannel: true` but does not actually open UDP port or send IpPort response.

**Use case:** Signaling validation and device enumeration only, not full call testing.

### 11. No Authentication
**Limitation:** SCCP has no built-in authentication. Device authorization is MAC-based (device name must be pre-configured in CUCM).

**Impact:** Registration will fail with RegisterReject (0x0082) if device name not in CUCM database.

**Workaround:** Use authorized device name or configure CUCM to accept test devices.

### 12. No CallManager Redundancy
**Limitation:** Single CUCM hostname/IP. No support for alternate CallManager list or failover.

**Impact:** If primary CUCM is down, probe/registration will timeout (no automatic retry to backup).

**Workaround:** Call endpoint multiple times with different CUCM IPs.

### 13. Timeout Granularity
**Limitation:** Timeout applies to entire operation (connect + send + receive). Fast connection with slow response may timeout before receiving data.

**Workaround:** Increase timeout for slow CUCM servers.

### 14. No CUCM Feature Detection
**Limitation:** No endpoint to query CUCM capabilities, version, or feature set.

**Impact:** Cannot distinguish CUCM version (7.x, 8.x, 11.x, 12.x, 14.x) or enabled features (video, encryption, etc.).

**Workaround:** Use CUCM web admin or AXL SOAP API for feature queries.

### 15. Device Name Format Not Validated
**Limitation:** No regex validation of device name format (should be `SEP<12 hex digits>` or `ATA<12 hex digits>`).

**Impact:** Invalid device names accepted and sent to CUCM, causing RegisterReject.

**Workaround:** Client-side validation before calling endpoint.

### 16. Message ID Enumeration Incomplete
**Limitation:** Only 23 message IDs defined in `MSG_NAMES` (lines 54-74). SCCP protocol has 200+ message types.

**Impact:** Unknown messages displayed as `Unknown(0xXXXX)` in response.

**Workaround:** Add more message IDs to `MSG_NAMES` as needed.

## Testing

### 1. KeepAlive Probe
```bash
curl -X POST http://localhost:8787/api/sccp/probe \
  -H "Content-Type: application/json" \
  -d '{
    "host": "cucm.example.com",
    "port": 2000,
    "timeout": 5000
  }'
```

**Expected response (live CUCM):**
```json
{
  "success": true,
  "probe": "keepalive",
  "connected": true,
  "keepAliveAck": true,
  "connectMs": 45,
  "latencyMs": 67,
  "responseBytes": 12,
  "messages": [
    {"id": "0x0100", "name": "KeepAliveAck", "dataLength": 0}
  ]
}
```

### 2. Device Registration
```bash
curl -X POST http://localhost:8787/api/sccp/register \
  -H "Content-Type: application/json" \
  -d '{
    "host": "cucm.example.com",
    "port": 2000,
    "deviceName": "SEP001122334455",
    "deviceType": 8,
    "timeout": 10000
  }'
```

**Expected response (authorized device):**
```json
{
  "success": true,
  "registration": {
    "status": "registered",
    "deviceName": "SEP001122334455",
    "deviceType": 8,
    "deviceTypeName": "Cisco 7960",
    "registered": true,
    "rejected": false,
    "capabilitiesRequested": true
  },
  "connectMs": 45,
  "latencyMs": 123,
  "responseBytes": 24,
  "messages": [
    {"id": "0x0081", "name": "RegisterAck", "dataLength": 0},
    {"id": "0x0097", "name": "CapabilitiesRequest", "dataLength": 0}
  ]
}
```

**Expected response (unauthorized device):**
```json
{
  "success": true,
  "registration": {
    "status": "rejected",
    "deviceName": "SEP001122334455",
    "deviceType": 8,
    "deviceTypeName": "Cisco 7960",
    "registered": false,
    "rejected": true,
    "capabilitiesRequested": false
  },
  "connectMs": 45,
  "latencyMs": 78,
  "responseBytes": 12,
  "messages": [
    {"id": "0x0082", "name": "RegisterReject", "dataLength": 0}
  ]
}
```

### 3. Line State Query
```bash
curl -X POST http://localhost:8787/api/sccp/linestate \
  -H "Content-Type: application/json" \
  -d '{
    "host": "cucm.example.com",
    "port": 2000,
    "deviceName": "SEP001122334455",
    "timeout": 10000
  }'
```

**Expected response (configured device):**
```json
{
  "success": true,
  "registered": true,
  "capabilitiesRequested": true,
  "lines": [
    {"number": 1, "buttonType": "Line", "label": "Main Line", "ringMode": "Off"},
    {"number": 2, "buttonType": "Line", "label": "Shared Line", "ringMode": "Off"},
    {"number": 3, "buttonType": "SpeedDial", "ringMode": "Off"}
  ],
  "capabilities": [
    "G.711 u-law",
    "G.711 a-law",
    "G.729 Annex A"
  ],
  "connectMs": 45,
  "latencyMs": 234
}
```

### 4. Call Setup Test
```bash
curl -X POST http://localhost:8787/api/sccp/call-setup \
  -H "Content-Type: application/json" \
  -d '{
    "host": "cucm.example.com",
    "port": 2000,
    "deviceName": "SEP001122334455",
    "dialNumber": "1000",
    "timeout": 15000
  }'
```

**Expected response (call placed):**
```json
{
  "success": true,
  "registered": true,
  "capabilitiesRequested": true,
  "offHookSent": true,
  "digitsSent": "1000",
  "toneStarted": true,
  "callState": "RingOut",
  "displayText": "Calling 1000",
  "openReceiveChannel": false,
  "serverMessages": [
    {"id": "0x0081", "name": "RegisterAck"},
    {"id": "0x0097", "name": "CapabilitiesRequest"},
    {"id": "0x0113", "name": "StartTone"},
    {"id": "0x008F", "name": "CallState"},
    {"id": "0x0091", "name": "DisplayText"}
  ],
  "latencyMs": 1234
}
```

### 5. Wireshark Capture
```bash
# Capture SCCP traffic on port 2000
sudo tcpdump -i any -s 0 -w sccp.pcap port 2000

# Open in Wireshark and apply display filter
skinny
```

**Wireshark filter examples:**
- `skinny.messageId == 0x0001` — Show Register messages
- `skinny.messageId == 0x0081` — Show RegisterAck
- `skinny.messageId == 0x0113` — Show StartTone
- `skinny && tcp.stream == 0` — Show first SCCP session only

### 6. Asterisk chan_skinny Testing
```bash
# Install Asterisk with chan_skinny
apt-get install asterisk

# Edit /etc/asterisk/skinny.conf
[general]
bindaddr=0.0.0.0
bindport=2000
dateformat=D/M/Y
version=1.0

[SEP001122334455]
device=SEP001122334455
context=default
line => 1000

# Reload Asterisk
asterisk -rx "skinny reload"
asterisk -rx "skinny show lines"

# Test registration against Asterisk
curl -X POST http://localhost:8787/api/sccp/register \
  -H "Content-Type: application/json" \
  -d '{"host": "localhost", "deviceName": "SEP001122334455", "deviceType": 8}'
```

## Security Considerations

### 1. Cleartext Signaling
**Risk:** All SCCP messages transmitted unencrypted on port 2000.

**Exposure:** Device names, call states, dialed digits, display text visible to network sniffers.

**Mitigation:** Use SCCPS (SCCP over TLS) on port 2443, or segment voice VLAN from untrusted networks.

### 2. No Authentication
**Risk:** SCCP has no user/password authentication. Authorization is MAC-based (device name).

**Attack:** MAC address spoofing allows unauthorized device registration if attacker knows valid device name.

**Mitigation:** Enable 802.1X port authentication, use certificate-based device authentication in CUCM, restrict SCCP port to trusted VLANs.

### 3. Denial of Service
**Risk:** CUCM tracks registered devices in memory. Mass registration attempts can exhaust CUCM resources.

**Attack:** Send Register messages with many unique device names to trigger database lookups and rejection logging.

**Mitigation:** Rate-limit SCCP connections at firewall, enable CUCM intrusion detection, monitor failed registration attempts.

### 4. Information Disclosure
**Risk:** Device type, line configuration, codec capabilities disclosed in registration flow.

**Exposure:** Attacker learns phone model, firmware version (via device type), number of lines, supported codecs.

**Mitigation:** Disable SCCP on untrusted networks, use SIP with TLS instead.

### 5. Call Hijacking
**Risk:** SCCP has no call ID authentication. Attacker on same network segment can send CallState or OnHook messages to terminate active calls.

**Attack:** Sniff SCCP traffic to learn active call reference IDs, send spoofed OnHook (0x0007) to drop call.

**Mitigation:** Use encrypted signaling (SCCPS), enable SRTP for media encryption, segment voice VLAN.

### 6. Firmware Manipulation
**Risk:** CUCM pushes firmware updates to IP phones via TFTP. Attacker with CUCM access can push malicious firmware.

**Attack:** Modify TFTP server config to serve backdoored firmware, wait for phone reboot.

**Mitigation:** Use signed firmware, enable TFTP over TLS, restrict CUCM admin access.

### 7. VLAN Hopping
**Risk:** Cisco IP phones support 802.1Q VLAN tagging. Attacker connected to phone PC port can tag frames to hop between voice and data VLANs.

**Attack:** Send 802.1Q-tagged frames with voice VLAN ID to bypass network segmentation.

**Mitigation:** Enable Dynamic VLAN Assignment, use MAC-based authentication, disable CDP on untrusted ports.

### 8. Eavesdropping on RTP
**Risk:** RTP media streams use UDP and are unencrypted by default.

**Exposure:** Voice conversations can be captured and replayed using tools like rtpdump, rtpmixsound.

**Mitigation:** Enable SRTP (Secure RTP) in CUCM, use AES-128 or AES-256 encryption for media.

### 9. Toll Fraud
**Risk:** Compromised phone or CUCM can place unauthorized international calls.

**Attack:** Register rogue device, dial premium-rate or international numbers, incur charges.

**Mitigation:** Implement Class of Service (CoS) restrictions, block international dialing for untrusted devices, monitor call logs for anomalies.

### 10. Configuration Tampering
**Risk:** CUCM stores phone configuration (line assignments, softkeys, speed dials) in database. Database compromise allows config manipulation.

**Attack:** SQL injection or privileged access to CUCM database, modify line assignments to intercept calls.

**Mitigation:** Harden CUCM database, use least-privilege accounts, enable audit logging, regular backups.

## Resources

- [Cisco SCCP Protocol Overview](https://aurus5.com/blog/cisco/sccp-skinny-client-control-protocol/) — High-level introduction
- [Wireshark SCCP Dissector](https://wiki.wireshark.org/SKINNY) — Protocol analysis and message decoding
- [Asterisk chan_skinny](https://wiki.asterisk.org/wiki/display/AST/Skinny) — Open-source SCCP implementation
- [Packet Guide to Voice over IP (O'Reilly)](https://www.oreilly.com/library/view/packet-guide-to/9781449339661/ch07.html) — Chapter 7: SCCP deep dive
- [Cisco Firewall SCCP Support](https://www.cisco.com/c/en/us/td/docs/routers/ios/config/17-x/sec-vpn/b-security-vpn/m_sec-data-sccp.html) — Firewall inspection and ALG
- [RFC 3261 - SIP](https://www.rfc-editor.org/rfc/rfc3261) — Open standard alternative to SCCP

## Migration Notes

### SCCP to SIP
Cisco recommends migrating from SCCP to SIP for new deployments. Benefits:

1. **Vendor neutrality** — SIP is open standard (RFC 3261), works with any SIP-compliant server
2. **Richer features** — Presence, instant messaging, video, federation
3. **Better security** — TLS for signaling, SRTP for media, digest authentication
4. **Future-proof** — Active development, broad industry support

**Migration steps:**
1. Verify phone firmware supports SIP (7960/7940 need "SIP firmware" load)
2. Configure CUCM for SIP device registration
3. Change phone load file from SCCP (e.g., `P00308010200.bin`) to SIP (e.g., `SIP41.9-4-2SR3-1S.loads`)
4. Reset phone to TFTP download new firmware
5. Test registration, call setup, transfer, hold, conference
6. Monitor for codec mismatch or feature regression

**Limitations of SIP on Cisco phones:**
- Some SCCP-only features not available (e.g., extension mobility, certain XML services)
- SIP firmware may have different bugs than SCCP firmware
- Older phone models (7905, 7912) may lack SIP support

Sources:
- [What is Skinny Client Control Protocol (SCCP)](https://aurus5.com/blog/cisco/sccp-skinny-client-control-protocol/)
- [Firewall Support of Skinny Client Control Protocol](https://www.cisco.com/c/en/us/td/docs/routers/ios/config/17-x/sec-vpn/b-security-vpn/m_sec-data-sccp.pdf)
- [Packet Guide to Voice over IP - Chapter 7: Skinny Client Control Protocol](https://www.oreilly.com/library/view/packet-guide-to/9781449339661/ch07.html)
- [Skinny Client Control Protocol - Wikipedia](https://en.wikipedia.org/wiki/Skinny_Client_Control_Protocol)
