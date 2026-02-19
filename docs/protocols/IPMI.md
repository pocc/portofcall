# IPMI (Intelligent Platform Management Interface) Protocol Reference

## Overview

IPMI is an industry-standard protocol for out-of-band hardware management and monitoring. Used by Baseboard Management Controllers (BMCs) in servers to provide remote access to system health, power control, and console redirection independent of the operating system.

**Specification:** IPMI v1.5 (Intel 1999), IPMI v2.0/RMCP+ (Intel 2004, rev 1.1 2013)
**Port:** 623 (UDP/TCP, officially UDP)
**Authentication:** None (anonymous), Password, MD2, MD5, RMCP+ (RAKP-HMAC-SHA1/SHA256)
**Use cases:** Server health monitoring, remote power control, sensor data collection, BMC enumeration, security auditing

## API Endpoints

### 1. RMCP ASF Presence Ping — `/api/ipmi/connect`

Sends an RMCP (Remote Management Control Protocol) ASF (Alert Standard Format) Presence Ping to check if a BMC is reachable and supports IPMI.

**Specification:** DMTF DSP0136 (ASF 2.0 §3.2.4), DMTF DSP0154 (RMCP)

#### Request

```
POST /api/ipmi/connect
GET  /api/ipmi/connect?host=192.168.1.100&port=623&timeout=10000
```

**POST Body:**
```json
{
  "host": "192.168.1.100",
  "port": 623,
  "timeout": 10000
}
```

**GET Query Parameters:**
- `host` (required) — BMC hostname or IP address
- `port` (optional, default: 623) — TCP port to connect to
- `timeout` (optional, default: 10000) — Connection timeout in milliseconds

#### Response (Success)

```json
{
  "success": true,
  "host": "192.168.1.100",
  "port": 623,
  "tcpReachable": true,
  "rmcpResponse": true,
  "supportsIPMI": true,
  "entityIANA": 47488,
  "message": "RMCP Presence Pong received — IPMI supported: true",
  "note": "RMCP/IPMI typically uses UDP port 623. This test used TCP — full protocol interaction requires UDP."
}
```

**Fields:**
- `tcpReachable` — TCP connection to port 623 succeeded
- `rmcpResponse` — Received valid RMCP ASF Presence Pong (message type 0x40)
- `supportsIPMI` — Bit 7 of byte 19 (Supported Entities) is set
- `entityIANA` — IANA Private Enterprise Number of the managed entity (bytes 12-15 of Pong data, big-endian)
- `message` — Human-readable result description

#### Response (TCP Open, No RMCP Response)

```json
{
  "success": true,
  "host": "192.168.1.100",
  "port": 623,
  "tcpReachable": true,
  "rmcpResponse": false,
  "supportsIPMI": false,
  "entityIANA": 0,
  "message": "No response from BMC (TCP may not be supported — IPMI typically uses UDP)",
  "note": "TCP port 623 is open. RMCP/IPMI typically uses UDP — this TCP probe cannot perform full RMCP negotiation."
}
```

#### Response (Connection Failed)

```json
{
  "success": false,
  "tcpReachable": false,
  "error": "Connection timeout",
  "note": "RMCP/IPMI typically uses UDP port 623. TCP probing may not work if the BMC only listens on UDP."
}
```

#### Wire Protocol

**RMCP ASF Presence Ping (12 bytes sent):**

```
Offset  Field                   Value   Description
------  ----------------------  ------  -----------
0       RMCP Version            0x06    RMCP v1.0
1       RMCP Reserved           0x00    Must be zero
2       RMCP Sequence Number    0xFF    No ACK required (0xFF = no response expected)
3       RMCP Message Class      0x06    ASF (Alert Standard Format)
4-7     IANA Enterprise Number  0x000011BE  ASF IANA = 4542 (big-endian)
8       ASF Message Type        0x80    Presence Ping
9       ASF Message Tag         0xFF    Echoed in Pong
10      ASF Reserved            0x00    Must be zero
11      ASF Data Length         0x00    No data payload
```

**RMCP ASF Presence Pong (28 bytes expected):**

```
Offset  Field                       Value   Description
------  --------------------------  ------  -----------
0       RMCP Version                0x06    RMCP v1.0
1       RMCP Reserved               0x00    Must be zero
2       RMCP Sequence Number        (any)   Echoed or ignored
3       RMCP Message Class          0x06    ASF
4-7     IANA Enterprise Number      0x000011BE  ASF IANA = 4542 (big-endian)
8       ASF Message Type            0x40    Presence Pong
9       ASF Message Tag             0xFF    Echoed from Ping
10      ASF Reserved                0x00    Must be zero
11      ASF Data Length             0x10    16 bytes of data
12-15   Entity IANA (big-endian)    varies  Manufacturer IANA PEN (e.g. 0x47800 = Dell)
16      OEM-defined                 varies  Vendor-specific
17-18   OEM-defined                 varies  Vendor-specific
19      Supported Entities          varies  Bit 7 = IPMI supported
20      Supported Interactions      varies  Bit flags for DASH, ASF, etc.
21-27   Reserved                    0x00    Must be zero
```

**Supported Entities Flags (byte 19):**
- Bit 7 (0x80) — IPMI supported
- Bit 6 (0x40) — ASF v1.0 supported
- Bit 5 (0x20) — ASF security extensions supported
- Bit 4 (0x10) — DASH supported
- Bits 3-0 — Reserved

---

### 2. Get Channel Authentication Capabilities — `/api/ipmi/auth-caps`

Sends an IPMI LAN message (NetFn=0x06, Cmd=0x38) to query the BMC's supported authentication methods and security configuration. This is the standard first step in IPMI LAN session establishment and the most useful unauthenticated probe for security assessments.

**Specification:** IPMI v2.0 spec §22.13 Table 22-15

#### Request

```
POST /api/ipmi/auth-caps
```

**Body:**
```json
{
  "host": "192.168.1.100",
  "port": 623,
  "channel": 14,
  "privilege": 4,
  "timeout": 10000
}
```

**Parameters:**
- `host` (required) — BMC hostname or IP address
- `port` (optional, default: 623) — TCP port
- `channel` (optional, default: 0x0E = 14) — LAN channel number (0x0E = "present channel" / auto-detect)
- `privilege` (optional, default: 0x04) — Requested privilege level (1=Callback, 2=User, 3=Operator, 4=Administrator, 5=OEM)
- `timeout` (optional, default: 10000) — Connection timeout in milliseconds

#### Response (Success)

```json
{
  "success": true,
  "host": "192.168.1.100",
  "port": 623,
  "tcpReachable": true,
  "ipmiResponse": true,
  "command": "GetChannelAuthenticationCapabilities",
  "channel": 14,
  "authTypes": ["none", "MD5", "straight-password"],
  "ipmiV2ExtendedData": true,
  "anonymousLoginEnabled": false,
  "nullUsernamesEnabled": false,
  "nonNullUsernamesEnabled": true,
  "userLevelAuthDisabled": false,
  "perMessageAuthDisabled": false,
  "kgNonDefault": false,
  "ipmiV15Supported": true,
  "ipmiV20Supported": true,
  "oemIana": 47488,
  "note": "GetChannelAuthenticationCapabilities succeeded — BMC auth methods enumerated",
  "latencyMs": 45
}
```

**Auth-Related Fields:**
- `authTypes` — Array of supported authentication types: `"none"`, `"MD2"`, `"MD5"`, `"straight-password"` (plaintext key), `"OEM"`
- `ipmiV2ExtendedData` — Bit 7 of authentication type byte is set (IPMI v2.0+ extended data present)
- `anonymousLoginEnabled` — Bit 0 of auth status (anonymous login without username allowed)
- `nullUsernamesEnabled` — Bit 1 of auth status (null/empty username allowed)
- `nonNullUsernamesEnabled` — Bit 2 of auth status (non-null usernames required)
- `userLevelAuthDisabled` — Bit 3 of auth status (user-level authentication is disabled — dangerous!)
- `perMessageAuthDisabled` — Bit 4 of auth status (per-message authentication is disabled)
- `kgNonDefault` — Bit 5 of auth status (KG key has been set to a non-default value)
- `ipmiV15Supported` — Bit 0 of extended capabilities (IPMI v1.5 sessions supported)
- `ipmiV20Supported` — Bit 1 of extended capabilities (IPMI v2.0/RMCP+ sessions supported)
- `oemIana` — OEM IANA Private Enterprise Number (3 bytes LS-first, bytes 4-6 of response data)

**Security Interpretation:**

- `authTypes: ["none"]` + `anonymousLoginEnabled: true` = **CRITICAL RISK** — BMC allows unauthenticated access
- `authTypes: ["straight-password"]` = **HIGH RISK** — Password sent in cleartext over the network
- `authTypes: ["MD2", "MD5"]` without `"none"` = **MEDIUM RISK** — Weak hash functions vulnerable to collision attacks
- `ipmiV20Supported: true` + `authTypes: ["none", "MD5", "straight-password"]` = **BEST PRACTICE** — RMCP+ provides strong crypto, but older methods still enabled
- `userLevelAuthDisabled: true` = **CRITICAL RISK** — No authentication required at all
- `kgNonDefault: false` = **MEDIUM RISK** — KG key (BMC session key) is still default (usually all zeros)

#### Response (IPMI Error)

If the BMC returns a non-zero completion code:

```json
{
  "success": true,
  "host": "192.168.1.100",
  "port": 623,
  "tcpReachable": true,
  "ipmiResponse": true,
  "command": "GetChannelAuthenticationCapabilities",
  "channel": 0,
  "authTypes": [],
  "ipmiV2ExtendedData": false,
  "anonymousLoginEnabled": false,
  "nullUsernamesEnabled": false,
  "nonNullUsernamesEnabled": false,
  "userLevelAuthDisabled": false,
  "perMessageAuthDisabled": false,
  "kgNonDefault": false,
  "ipmiV15Supported": false,
  "ipmiV20Supported": false,
  "completionCode": 204,
  "errorMessage": "IPMI completion code 0xcc",
  "note": "GetChannelAuthenticationCapabilities succeeded — BMC auth methods enumerated",
  "latencyMs": 32
}
```

**Common IPMI Completion Codes:**
- `0x00` — Success
- `0xC1` — Invalid command (BMC doesn't support GetChannelAuthenticationCapabilities)
- `0xCC` — Invalid data field in request (bad channel or privilege level)
- `0xD4` — Insufficient privilege for command
- `0xFF` — Unspecified error

#### Wire Protocol

**RMCP IPMI LAN Request Packet (22 bytes sent):**

```
Offset  Field                   Value       Description
------  ----------------------  ----------  -----------
0-3     RMCP Header
  0       RMCP Version          0x06        RMCP v1.0
  1       RMCP Reserved         0x00        Must be zero
  2       RMCP Sequence Number  0xFF        No ACK required
  3       RMCP Message Class    0x07        IPMI (not ASF)

4-13    IPMI Session Header (unauthenticated)
  4       Auth Type             0x00        No authentication
  5-8     Session Sequence      0x00000000  Zero for null session
  9-12    Session ID            0x00000000  Zero for null session
  13      Message Length        0x08        8 bytes of IPMI message

14-21   IPMI Message
  14      RS Addr               0x20        BMC slave address
  15      NetFn/RsLUN           0x18        NetFn=0x06 (App), RsLUN=0
  16      Header Checksum       varies      -(RS Addr + NetFn/RsLUN) & 0xFF
  17      RQ Addr               0x81        Software ID (bit 0 set)
  18      RQ Seq/RqLUN          0x00        Sequence 0, RqLUN 0
  19      Command               0x38        GetChannelAuthenticationCapabilities
  20      Channel | 0x80        0x8E        Channel 14 with bit 7 set (request IPMI v2.0 extended data)
  21      Privilege Level       0x04        Administrator
  22      Data Checksum         varies      -(RQ Addr + RQ Seq + Cmd + Data) & 0xFF
```

**RMCP IPMI LAN Response Packet (32+ bytes expected):**

```
Offset  Field                   Description
------  ----------------------  -----------
0-3     RMCP Header             Same format as request
4-13    IPMI Session Header     Same format as request
14      RS Addr                 0x81 (Software ID, response direction)
15      NetFn/RsLUN             0x1C (NetFn=0x07, response to 0x06)
16      Header Checksum         Checksum of bytes 14-15
17      RQ Addr                 0x20 (BMC address)
18      RQ Seq/RqLUN            0x00 (echoed from request)
19      Command                 0x38 (echoed from request)
20      Completion Code         0x00 (success) or error code
21+     Response Data           Variable length (see below)
Last    Data Checksum           Checksum of bytes 17 through second-to-last

Response Data Fields (starts at offset 21):
  +0    Channel Number          Bits 3:0 = channel, bits 7:4 reserved
  +1    Auth Type Support       Bitmask (see table below)
  +2    Auth Status             Bitmask (see table below)
  +3    Extended Capabilities   Present only if Auth Type Support bit 7 = 1
  +4-6  OEM IANA PEN            3 bytes LS-first (optional)
  +7    OEM Auxiliary Data      1 byte (optional)
```

**Auth Type Support Bitmask (Response Data byte 1):**
- Bit 7 (0x80) — IPMI v2.0+ extended data present (if set, byte 3 is valid)
- Bit 6 (0x40) — Reserved
- Bit 5 (0x20) — OEM proprietary authentication
- Bit 4 (0x10) — Straight password/key (cleartext)
- Bit 3 (0x08) — Reserved
- Bit 2 (0x04) — MD5 authentication
- Bit 1 (0x02) — MD2 authentication
- Bit 0 (0x01) — No authentication (anonymous)

**Auth Status Bitmask (Response Data byte 2):**
- Bit 7 (0x80) — Reserved
- Bit 6 (0x40) — Reserved
- Bit 5 (0x20) — KG status (1 = non-default KG key set, 0 = default/all-zeros)
- Bit 4 (0x10) — Per-message authentication disabled
- Bit 3 (0x08) — User-level authentication disabled
- Bit 2 (0x04) — Non-null usernames enabled
- Bit 1 (0x02) — Null usernames enabled
- Bit 0 (0x01) — Anonymous login enabled

**Extended Capabilities Bitmask (Response Data byte 3, only if byte 1 bit 7 = 1):**
- Bit 7-2 — Reserved
- Bit 1 (0x02) — IPMI v2.0/RMCP+ connections supported
- Bit 0 (0x01) — IPMI v1.5 connections supported

---

### 3. Get Device ID — `/api/ipmi/device-id`

Sends an IPMI GetDeviceID command (NetFn=0x06, Cmd=0x01) to identify the BMC manufacturer, product ID, and firmware version. This is the standard IPMI device enumeration command.

**Specification:** IPMI v2.0 spec §20.1 Table 20-1

#### Request

```
POST /api/ipmi/device-id
```

**Body:**
```json
{
  "host": "192.168.1.100",
  "port": 623,
  "timeout": 10000
}
```

**Parameters:**
- `host` (required) — BMC hostname or IP address
- `port` (optional, default: 623) — TCP port
- `timeout` (optional, default: 10000) — Connection timeout in milliseconds

#### Response (Success)

```json
{
  "success": true,
  "host": "192.168.1.100",
  "port": 623,
  "portOpen": true,
  "deviceInfo": {
    "deviceId": 32,
    "deviceRevision": 1,
    "sdrPresent": true,
    "firmwareVersion": "2.92",
    "ipmiVersion": "2.0",
    "manufacturerId": "0x0002a2",
    "manufacturerName": "Dell",
    "productId": "0x0100"
  },
  "responseHex": "06 00 ff 07 00 00 00 00 00 00 00 00 00 07 81 1c 62 20 00 01 00 20 01 81 02 92 20 02 a2 00 00 01 00 66",
  "packetHex": "06 00 ff 07 00 00 00 00 00 00 00 00 00 07 20 18 c8 81 00 01 7e",
  "latencyMs": 42,
  "note": "IPMI GetDeviceID (netFn=0x06, cmd=0x01) via unauthenticated RMCP session over TCP. Full IPMI auth (RAKP/RMCP+) requires UDP/623 which is not available in Cloudflare Workers."
}
```

**Device Info Fields:**
- `deviceId` — Device ID byte (vendor-specific, often identifies BMC chip model)
- `deviceRevision` — Device revision (bits 3:0 of byte 1)
- `sdrPresent` — Sensor Data Repository present (bit 7 of byte 1)
- `firmwareVersion` — Firmware version string (major.minor, minor is BCD)
- `ipmiVersion` — IPMI message version string (e.g. "2.0" for 0x20)
- `manufacturerId` — IANA Private Enterprise Number (3 bytes LS-first) as hex string
- `manufacturerName` — Human-readable manufacturer name (mapped from known IANAs)
- `productId` — Product ID (2 bytes LS-first) as hex string

**Known Manufacturer IANAs:**
- `0x00000B` — Hewlett-Packard (HP/HPE)
- `0x000002` — IBM
- `0x0002A2` — Dell
- `0x002A7C` — Supermicro
- `0x000157` — Intel
- `0x003A98` — Kontron
- `0x00B980` — Supermicro (alternate)
- `0x00A2B5` — Lenovo
- `0x000BD3` — ASUS
- `0x000763` — American Megatrends (AMI)

#### Response (Connection Failed / No IPMI Response)

```json
{
  "success": false,
  "host": "192.168.1.100",
  "port": 623,
  "portOpen": false,
  "deviceInfo": null,
  "responseHex": null,
  "packetHex": "06 00 ff 07 00 00 00 00 00 00 00 00 00 07 20 18 c8 81 00 01 7e",
  "latencyMs": 10005,
  "error": "Connection timeout",
  "note": "IPMI GetDeviceID (netFn=0x06, cmd=0x01) via unauthenticated RMCP session over TCP. Full IPMI auth (RAKP/RMCP+) requires UDP/623 which is not available in Cloudflare Workers."
}
```

#### Wire Protocol

**RMCP IPMI LAN Request Packet (21 bytes sent):**

```
Offset  Field                   Value       Description
------  ----------------------  ----------  -----------
0-3     RMCP Header
  0       RMCP Version          0x06        RMCP v1.0
  1       RMCP Reserved         0x00        Must be zero
  2       RMCP Sequence Number  0xFF        No ACK required
  3       RMCP Message Class    0x07        IPMI

4-13    IPMI Session Header (unauthenticated)
  4       Auth Type             0x00        No authentication
  5-8     Session Sequence      0x00000000  Zero for null session
  9-12    Session ID            0x00000000  Zero for null session
  13      Message Length        0x07        7 bytes of IPMI message

14-20   IPMI Message
  14      RS Addr               0x20        BMC slave address
  15      NetFn/RsLUN           0x18        NetFn=0x06 (App), RsLUN=0
  16      Header Checksum       0xC8        -(0x20 + 0x18) & 0xFF
  17      RQ Addr               0x81        Software ID
  18      RQ Seq/RqLUN          0x00        Sequence 0, RqLUN 0
  19      Command               0x01        GetDeviceID
  20      Data Checksum         0x7E        -(0x81 + 0x00 + 0x01) & 0xFF
```

**RMCP IPMI LAN Response Packet (14 + 7 + 16 = 37+ bytes expected):**

```
Offset  Field                   Description
------  ----------------------  -----------
0-13    RMCP + Session Header   Same as request format
14-20   IPMI Response Header
  14      RS Addr               0x81 (Software ID)
  15      NetFn/RsLUN           0x1C (NetFn=0x07, response to 0x06)
  16      Header Checksum       Checksum
  17      RQ Addr               0x20 (BMC)
  18      RQ Seq/RqLUN          0x00
  19      Command               0x01 (GetDeviceID)
  20      Completion Code       0x00 (success)
21+     Response Data (16 bytes minimum)
  +0      Device ID             Vendor-specific device ID byte
  +1      Device Revision       Bit 7 = SDR present, bits 3:0 = revision
  +2      Firmware Rev (Major)  Bit 7 = update mode, bits 6:0 = major version
  +3      Firmware Rev (Minor)  BCD encoded (0x92 = 92 decimal)
  +4      IPMI Msg Version      BCD encoded (0x20 = IPMI 2.0)
  +5      Additional Support    Bitmask of additional device support
  +6-8    Manufacturer ID       3 bytes LS-first (IANA PEN)
  +9-10   Product ID            2 bytes LS-first
  +11-14  Aux Firmware Rev      4 bytes (optional, vendor-specific)
Last    Data Checksum           Checksum
```

---

## Protocol Mechanics

### RMCP (Remote Management Control Protocol)

RMCP is the transport layer for IPMI LAN communication. It runs on UDP port 623 (and sometimes TCP port 623 for BMCs that support it).

**RMCP Packet Structure (4-byte header + payload):**

```
Byte  Field               Description
----  ------------------  -----------
0     Version             0x06 (RMCP v1.0)
1     Reserved            0x00 (must be zero)
2     Sequence Number     0x00-0xFE (requires ACK), 0xFF (no ACK)
3     Message Class       0x06 = ASF, 0x07 = IPMI, 0x08 = OEM
4+    Payload             Variable (ASF or IPMI message)
```

### IPMI LAN Session Layer (IPMI v1.5)

For unauthenticated sessions (auth type 0x00), the session header is 10 bytes:

```
Byte  Field               Value       Description
----  ------------------  ----------  -----------
0     Auth Type           0x00        No authentication
1-4   Sequence Number     0x00000000  32-bit session sequence (0 for null session)
5-8   Session ID          0x00000000  32-bit session ID (0 for null session)
9     Message Length      varies      Length of IPMI message in bytes
10+   IPMI Message        varies      See below
```

### IPMI Message Format

IPMI messages use a request/response structure with two checksums:

**Request:**
```
Byte  Field               Description
----  ------------------  -----------
0     RS Addr             Responder address (0x20 = BMC)
1     NetFn/RsLUN         Network Function (6 bits) + Responder LUN (2 bits)
2     Header Checksum     -(RS Addr + NetFn/RsLUN) & 0xFF
3     RQ Addr             Requester address (0x81 = software, bit 0 set)
4     RQ Seq/RqLUN        Sequence number (6 bits) + Requester LUN (2 bits)
5     Command             IPMI command byte
6+    Request Data        Variable (command-specific)
Last  Data Checksum       -(RQ Addr + RQ Seq + Cmd + Data...) & 0xFF
```

**Response:**
```
Byte  Field               Description
----  ------------------  -----------
0     RQ Addr             Original requester address (0x81)
1     NetFn/RqLUN         Response NetFn (original + 1) + original RqLUN
2     Header Checksum     -(RQ Addr + NetFn/RqLUN) & 0xFF
3     RS Addr             Original responder address (0x20)
4     RQ Seq/RsLUN        Original sequence + original RsLUN
5     Command             Original command byte (echoed)
6     Completion Code     0x00 = success, non-zero = error
7+    Response Data       Variable (command-specific)
Last  Data Checksum       -(RS Addr + RQ Seq + Cmd + CC + Data...) & 0xFF
```

### Network Functions (NetFn)

Network Functions group related IPMI commands. Request NetFn is even, response NetFn is request + 1.

| NetFn (Req) | NetFn (Resp) | Category                  | Example Commands |
|-------------|--------------|---------------------------|------------------|
| 0x00        | 0x01         | Chassis                   | Power control, chassis status |
| 0x02        | 0x03         | Chassis (control)         | Identify LED, boot options |
| 0x04        | 0x05         | Sensor/Event              | Get sensor reading, event log |
| 0x06        | 0x07         | App (application)         | GetDeviceID, GetAuthCaps, session mgmt |
| 0x08        | 0x09         | Firmware                  | Firmware update, validation |
| 0x0A        | 0x0B         | Storage                   | SDR, SEL, FRU access |
| 0x0C        | 0x0D         | Transport                 | LAN configuration, serial/modem |
| 0x2C-0x2F   | 0x2D-0x30    | OEM/Group Extension       | Vendor-specific extensions |

### Common IPMI Commands

| NetFn | Cmd  | Name                                  | Auth Required | Description |
|-------|------|---------------------------------------|---------------|-------------|
| 0x06  | 0x01 | Get Device ID                         | No            | BMC device identification (mfr, product, firmware) |
| 0x06  | 0x38 | Get Channel Authentication Caps       | No            | Query supported auth types and security config |
| 0x06  | 0x3F | Get Session Challenge                 | No            | Initiate IPMI v1.5 session (MD2/MD5 auth) |
| 0x06  | 0x3A | Activate Session                      | No            | Complete IPMI v1.5 session establishment |
| 0x06  | 0x3B | Set Session Privilege Level           | Yes           | Escalate session privilege (User → Admin) |
| 0x06  | 0x3C | Close Session                         | Yes           | Terminate authenticated session |
| 0x00  | 0x01 | Get Chassis Status                    | Yes           | Power state, faults, boot flags |
| 0x00  | 0x02 | Chassis Control                       | Yes           | Power on/off/cycle/reset |
| 0x04  | 0x2D | Get Sensor Reading                    | Yes           | Read temperature, voltage, fan speed, etc. |
| 0x0A  | 0x10 | Get FRU Inventory Area Info           | Yes           | Read field-replaceable unit data |
| 0x0A  | 0x20 | Get SDR Repository Info               | Yes           | Sensor Data Repository metadata |
| 0x0A  | 0x40 | Get SEL Info                          | Yes           | System Event Log metadata |

### IPMI v2.0 / RMCP+ (Authenticated Sessions)

IPMI v2.0 introduces RMCP+ with strong cryptography (RAKP — Remote Authenticated Key-Exchange Protocol) using HMAC-SHA1 or HMAC-SHA256. This requires a multi-step handshake:

1. **Open Session Request** (Cmd 0x10, NetFn 0x06) — Client proposes cipher suite
2. **Open Session Response** — BMC accepts and provides managed system session ID
3. **RAKP Message 1** (Cmd 0x12, NetFn 0x06) — Client sends random number and username
4. **RAKP Message 2** — BMC sends random number and HMAC of session data
5. **RAKP Message 3** (Cmd 0x14, NetFn 0x06) — Client proves knowledge of password via HMAC
6. **RAKP Message 4** — BMC confirms session establishment

**Note:** This implementation does **NOT** support RMCP+ or IPMI v2.0 authenticated sessions because Cloudflare Workers do not support UDP. The above endpoints use unauthenticated IPMI v1.5-style sessions over TCP, which only works on BMCs that accept IPMI over TCP (e.g., HP iLO, Dell iDRAC, Supermicro).

---

## Implementation Quirks & Limitations

### 1. TCP transport instead of UDP (fundamental limitation)

**Issue:** IPMI/RMCP is designed for UDP port 623. This implementation uses TCP port 623 because Cloudflare Workers do not support UDP sockets.

**Impact:**
- Many BMCs reject or ignore TCP connections to port 623 (UDP-only)
- TCP connections to port 623 may appear successful (`tcpReachable: true`) but the BMC may not respond to IPMI packets
- RMCP+ (IPMI v2.0 authenticated sessions) **cannot** be implemented over TCP in this environment

**Mitigation:** None. This is a platform limitation. Use this tool for recon only on BMCs known to accept IPMI over TCP (HP iLO, Dell iDRAC, Supermicro X10/X11 generation).

### 2. No IPMI v2.0 / RMCP+ session support

**Issue:** The implementation only supports unauthenticated IPMI v1.5-style sessions (auth type 0x00, session ID 0x00000000). It cannot perform RAKP key exchange or send authenticated/encrypted IPMI v2.0 messages.

**Impact:**
- Cannot access commands that require authentication (chassis control, sensor readings, SEL, SDR, FRU)
- Cannot test strength of configured passwords
- Enumeration is limited to unauthenticated commands: GetDeviceID (0x01), GetChannelAuthenticationCapabilities (0x38), and a few others

**Mitigation:** For full IPMI access, use `ipmitool` over UDP with credentials:
```bash
ipmitool -I lanplus -H 192.168.1.100 -U admin -P password chassis status
```

### 3. No timeout cleanup in handleIPMIGetDeviceID (FIXED)

**Issue (pre-fix):** The timeout promise created was never cleaned up. If the connection succeeded quickly, the timeout timer would still fire after function return, potentially causing unhandled promise rejections.

**Fix:** Added `timeoutId` tracking and `clearTimeout()` in a `finally` block to ensure the timer is always cancelled.

### 4. Missing lock cleanup in error paths (FIXED)

**Issue (pre-fix):** In `handleIPMIConnect`, if an error occurred after `socket.opened` but before reading a response, the code attempted to close the socket without releasing reader/writer locks. This could cause resource leaks.

**Fix:** Added proper lock release in both success and error paths. Error path now does:
```typescript
try { writer.releaseLock(); } catch (_) { /* ignore */ }
try { reader.releaseLock(); } catch (_) { /* ignore */ }
try { await socket.close(); } catch (_) { /* ignore */ }
```

### 5. Inconsistent lock release in handleIPMIGetAuthCaps (FIXED)

**Issue (pre-fix):** The success path released locks, but the catch block also tried to release locks. If an error occurred after locks were already released, the catch block would throw trying to double-release.

**Fix:** Added `locksReleased` flag to track lock state and only release in catch block if not already released.

### 6. parseAuthCapsResponse missing RMCP header validation (FIXED)

**Issue (pre-fix):** The function accessed offset 14 directly without validating the RMCP header (bytes 0-3). A malformed response could be misinterpreted.

**Fix:** Added RMCP header validation:
```typescript
if (buf[0] !== 0x06) return null; // RMCP version must be 0x06
if (buf[3] !== 0x07) return null; // RMCP class must be 0x07 (IPMI)
```

### 7. No completion code reporting in parseAuthCapsResponse (FIXED)

**Issue (pre-fix):** When the BMC returned a non-zero completion code (error), the function returned `null` without providing the actual error code to the caller. This made debugging impossible.

**Fix:** Modified return type to include `completionCode` and `errorMessage` fields. Now returns structured error:
```typescript
return {
  channel: 0,
  authTypes: [],
  // ... all other fields false/empty ...
  completionCode: ccode,
  errorMessage: `IPMI completion code 0x${ccode.toString(16).padStart(2, '0')}`,
};
```

### 8. Hardcoded sequence number instead of named constant (FIXED)

**Issue (pre-fix):** Lines in `buildIPMILANPacket` hardcoded `0x00` for sequence/LUN field with inconsistent comments.

**Fix:** Introduced named constant `seqLun` to make intent clear:
```typescript
const seqLun = 0x00; // sequence number 0, LUN 0
let dataSum = rqAddr + seqLun + cmd;
// ...
ipmi[4] = seqLun;
```

### 9. No Cloudflare detection bypass option

**Issue:** If a user wants to test an internal BMC behind Cloudflare (e.g., for authorized internal security testing), there is no way to bypass the Cloudflare check.

**Impact:** Cannot test BMCs behind Cloudflare proxy (403 response with `isCloudflare: true`).

**Mitigation:** None currently implemented. Would require adding a `bypassCloudflareCheck: true` parameter (with appropriate authorization).

### 10. No rate limiting

**Issue:** No rate limiting on IPMI probe endpoints. An attacker could use this worker to scan/enumerate BMCs at scale.

**Impact:** Potential abuse for reconnaissance against third-party networks.

**Mitigation:** Implement Cloudflare rate limiting rules at the worker or zone level.

### 11. No response size limits

**Issue:** The implementations read responses in a loop until a timeout or enough data is collected. A malicious BMC could send gigabytes of data to exhaust worker memory/CPU.

**Impact:** Potential DoS if worker connects to a malicious endpoint.

**Mitigation:** Add explicit response size limits (e.g., max 2KB for IPMI LAN responses).

### 12. RMCP sequence number always 0xFF

**Issue:** All RMCP packets use sequence number 0xFF ("no ACK required"). This is correct for one-shot probes but prevents implementing reliable RMCP transport.

**Impact:** Cannot implement RMCP ACK/retransmission for lossy networks. Not an issue for TCP (reliable transport), but would matter for UDP.

**Mitigation:** None needed for current use case (one-shot probes over TCP).

### 13. Missing IPMI command implementations

**Issue:** Only 3 commands implemented: ASF Presence Ping, GetChannelAuthenticationCapabilities, GetDeviceID. Missing ~50 common IPMI commands.

**Impact:** Cannot perform comprehensive IPMI enumeration or security testing.

**Mitigation:** Extend with additional commands as needed. Authenticated commands require RMCP+ support (not possible over TCP without UDP).

### 14. No IPMI cipher suite enumeration

**Issue:** IPMI v2.0 supports multiple cipher suites (3 = RAKP-HMAC-SHA1 + AES-CBC-128, 17 = RAKP-HMAC-SHA256 + AES-CBC-128, etc.). No command to enumerate which cipher suites a BMC supports.

**Impact:** Cannot determine if BMC supports strong crypto (HMAC-SHA256) or only weak crypto (HMAC-SHA1).

**Mitigation:** Would require implementing "Get Cipher Suites" command (NetFn 0x06, Cmd 0x54) — requires authenticated session for some BMCs.

---

## Security Considerations

### Unauthenticated Information Disclosure

**GetDeviceID** and **GetChannelAuthenticationCapabilities** are intentionally unauthenticated commands per the IPMI spec. They leak:
- Manufacturer name and product ID (hardware identification)
- Firmware version (vulnerability scanning fingerprint)
- Supported authentication methods (attack surface enumeration)
- Whether anonymous login is enabled (critical security finding)

**Defense:** Network-level access control. IPMI should never be exposed to the public internet. Use isolated management VLANs with firewall rules restricting access to trusted jump hosts.

### Weak Authentication Methods

If `authTypes` includes `"none"` or `"straight-password"`:
- **None:** Attacker can establish a session without any credentials
- **Straight-password:** Password/key sent in cleartext (trivial network sniffing)
- **MD2/MD5:** Vulnerable to collision attacks, rainbow tables, and offline brute-force

**Defense:** Configure BMCs to require IPMI v2.0/RMCP+ only (cipher suite 3+ for HMAC-SHA1, 17+ for HMAC-SHA256). Disable IPMI v1.5 and all weak auth types.

### Default Credentials

Many BMCs ship with default credentials (e.g., `ADMIN`/`ADMIN` on Supermicro, `Administrator`/`password` on Dell). Attackers commonly scan for IPMI and attempt default logins.

**Defense:** Change default credentials immediately. Enforce strong password policies. Monitor for failed login attempts.

### BMC Vulnerabilities

BMCs are notoriously under-patched. Known vulnerabilities include:
- **CVE-2019-6260** — Supermicro BMC authentication bypass
- **CVE-2013-4786** — HP iLO4 authentication bypass
- **CVE-2018-1207** — Dell iDRAC7/8 remote code execution
- **iLOBleed (CVE-2017-12542)** — HP iLO4 buffer overflow
- **Pantsdown** — Supermicro virtual media directory traversal

**Defense:** Keep BMC firmware updated. Subscribe to vendor security bulletins. Isolate BMC network from production networks.

### IPMI Cipher Zero Attack

On some BMCs, requesting cipher suite 0 in RMCP+ Open Session bypasses authentication entirely. Fixed in modern firmware, but widespread in older deployments.

**Testing:** Use `ipmitool -C 0` to attempt cipher zero login. If successful without password, BMC is vulnerable.

**Defense:** Update firmware. Disable IPMI v2.0 cipher suite 0 in BMC configuration (if option available).

---

## Example Queries

### 1. Basic RMCP ASF Presence Ping

Check if a BMC is reachable and supports IPMI:

```bash
curl -X POST https://api.portofcall.dev/api/ipmi/connect \
  -H "Content-Type: application/json" \
  -d '{"host": "192.168.1.100"}'
```

Expected output (BMC supports IPMI):
```json
{
  "success": true,
  "tcpReachable": true,
  "rmcpResponse": true,
  "supportsIPMI": true,
  "entityIANA": 674,
  "message": "RMCP Presence Pong received — IPMI supported: true"
}
```

### 2. Enumerate BMC Authentication Methods

Determine which auth methods a BMC accepts:

```bash
curl -X POST https://api.portofcall.dev/api/ipmi/auth-caps \
  -H "Content-Type: application/json" \
  -d '{
    "host": "192.168.1.100",
    "channel": 14,
    "privilege": 4
  }'
```

Expected output (insecure BMC):
```json
{
  "success": true,
  "authTypes": ["none", "MD5", "straight-password"],
  "anonymousLoginEnabled": true,
  "ipmiV15Supported": true,
  "ipmiV20Supported": false,
  "note": "GetChannelAuthenticationCapabilities succeeded — BMC auth methods enumerated"
}
```

**Security interpretation:** This BMC allows anonymous login (`authTypes: ["none"]`, `anonymousLoginEnabled: true`) and only supports IPMI v1.5 (no RMCP+). **CRITICAL RISK.**

### 3. Identify BMC Manufacturer and Firmware

Fingerprint the BMC hardware and firmware version:

```bash
curl -X POST https://api.portofcall.dev/api/ipmi/device-id \
  -H "Content-Type: application/json" \
  -d '{"host": "192.168.1.100"}'
```

Expected output (Dell iDRAC):
```json
{
  "success": true,
  "deviceInfo": {
    "deviceId": 32,
    "deviceRevision": 1,
    "sdrPresent": true,
    "firmwareVersion": "2.92",
    "ipmiVersion": "2.0",
    "manufacturerId": "0x0002a2",
    "manufacturerName": "Dell",
    "productId": "0x0100"
  },
  "latencyMs": 42
}
```

**Use case:** Vulnerability scanning. Search CVE databases for "Dell iDRAC firmware 2.92" to find known exploits.

### 4. Scan Subnet for IPMI-Enabled Devices

Enumerate all BMCs on a /24 network:

```bash
for i in {1..254}; do
  curl -s -X POST https://api.portofcall.dev/api/ipmi/connect \
    -H "Content-Type: application/json" \
    -d "{\"host\": \"192.168.1.$i\", \"timeout\": 2000}" \
    | jq -r "select(.supportsIPMI == true) | .host"
done
```

**Note:** This is a slow scan (TCP-based, no parallelization). For production use, use `nmap` with UDP:
```bash
nmap -sU -p 623 --script ipmi-version 192.168.1.0/24
```

### 5. Test for Anonymous Login Vulnerability

Check if a BMC allows unauthenticated access:

```bash
curl -X POST https://api.portofcall.dev/api/ipmi/auth-caps \
  -H "Content-Type: application/json" \
  -d '{"host": "192.168.1.100"}' \
  | jq '{
      anonymousLoginAllowed: .anonymousLoginEnabled,
      allowsNullUsername: .nullUsernamesEnabled,
      weakAuthMethods: ([.authTypes[] | select(. == "none" or . == "straight-password")] | length > 0)
    }'
```

Expected output (vulnerable BMC):
```json
{
  "anonymousLoginAllowed": true,
  "allowsNullUsername": true,
  "weakAuthMethods": true
}
```

### 6. Check IPMI v2.0 Support

Determine if a BMC supports modern RMCP+:

```bash
curl -X POST https://api.portofcall.dev/api/ipmi/auth-caps \
  -H "Content-Type: application/json" \
  -d '{"host": "192.168.1.100"}' \
  | jq '{
      ipmiV20Supported: .ipmiV20Supported,
      ipmiV15Supported: .ipmiV15Supported,
      recommendation: (if .ipmiV20Supported then "Configure BMC to disable IPMI v1.5" else "Firmware update required for IPMI v2.0 support" end)
    }'
```

### 7. Custom Timeout for Slow Networks

Increase timeout to 30 seconds for high-latency connections:

```bash
curl -X POST https://api.portofcall.dev/api/ipmi/device-id \
  -H "Content-Type: application/json" \
  -d '{
    "host": "remote-datacenter.example.com",
    "timeout": 30000
  }'
```

---

## Comparison to Other Tools

| Feature | This Worker | ipmitool | Metasploit ipmi_* modules | nmap ipmi-version script |
|---------|-------------|----------|---------------------------|--------------------------|
| **Transport** | TCP only | UDP (default), TCP (lanplus), Serial | UDP | UDP |
| **Auth support** | None (null session only) | IPMI v1.5 + v2.0/RMCP+ | IPMI v1.5 + v2.0 | None (passive fingerprint) |
| **Commands** | 3 (Presence Ping, GetAuthCaps, GetDeviceID) | ~50 (full spec) | 10+ (exploits + enum) | 1 (GetChannelAuthCaps) |
| **Platform** | Cloudflare Workers (serverless) | Linux/BSD/macOS CLI | Metasploit Framework | Nmap NSE script |
| **Use case** | Web-based recon, API integration | Full BMC management | Penetration testing | Network discovery |
| **Rate limiting** | None (abuse risk) | Client-side | Client-side | Client-side |
| **Cloudflare detection** | Yes (blocks proxied IPs) | N/A | N/A | N/A |

**When to use this tool:**
- Web-based IPMI reconnaissance (no local tools)
- API integration for automated security scanning
- Testing BMCs known to support IPMI over TCP (HP iLO, Dell iDRAC)

**When NOT to use this tool:**
- Production BMC management (use `ipmitool` or vendor tools)
- Authenticated sessions (platform limitation: no UDP)
- Penetration testing (Metasploit or nmap provide better exploit coverage)
- Scanning BMCs that only listen on UDP port 623 (most bare-metal servers)

---

## References

**IPMI Specifications:**
- IPMI v1.5 — [Intel 1999 spec](https://www.intel.com/content/dam/www/public/us/en/documents/product-briefs/ipmi-second-gen-interface-spec-v2-rev1-1.pdf)
- IPMI v2.0 / RMCP+ — [Intel 2004 spec rev 1.1 (2013)](https://www.intel.com/content/dam/www/public/us/en/documents/specification-updates/ipmi-intelligent-platform-mgt-interface-spec-2nd-gen-v2-0-spec-update.pdf)

**Related Protocols:**
- DMTF DSP0136 — [ASF 2.0 (Alert Standard Format)](https://www.dmtf.org/sites/default/files/standards/documents/DSP0136.pdf)
- DMTF DSP0154 — [RMCP (Remote Management Control Protocol)](https://www.dmtf.org/sites/default/files/standards/documents/DSP0154.pdf)

**Security Research:**
- [Rapid7 IPMI 2.0 RAKP Auth Bypass (HD Moore, 2013)](https://blog.rapid7.com/2013/07/02/a-penetration-testers-guide-to-ipmi/)
- [Cipher Zero Attack (Dan Farmer, 2013)](http://fish2.com/ipmi/cipherzero.html)
- [Pantsdown vulnerability (Supermicro, 2014)](https://www.rapid7.com/db/modules/auxiliary/scanner/http/supermicro_ipmi_traversal/)
- [iLOBleed (CVE-2017-12542, Fabien Perigaud, 2017)](https://github.com/airbus-seclab/ilo4_toolbox)

**Tools:**
- [ipmitool](https://github.com/ipmitool/ipmitool) — Industry-standard CLI for IPMI management
- [OpenIPMI](https://github.com/cminyard/openipmi) — Linux kernel IPMI driver and userspace library
- [FreeIPMI](https://www.gnu.org/software/freeipmi/) — GNU IPMI implementation with security tools (`ipmipower`, `ipmi-sensors`)
- [Metasploit ipmi_* modules](https://www.rapid7.com/db/modules/auxiliary/scanner/ipmi/) — Penetration testing modules for IPMI enumeration and exploitation

**Vendor Documentation:**
- [Dell iDRAC IPMI Configuration Guide](https://www.dell.com/support/manuals/en-us/idrac9-lifecycle-controller-v3.x-series/idrac9_3.00.00.00_ug/)
- [HPE iLO IPMI User Guide](https://support.hpe.com/hpesc/public/docDisplay?docId=emr_na-c04484747)
- [Supermicro IPMI User Guide](https://www.supermicro.com/manuals/other/IPMI_Users_Guide.pdf)

---

**Last updated:** 2026-02-18
**Protocol status:** Deployed, production-ready (TCP-based recon only)
**Implementation:** `/Users/rj/gd/code/portofcall/src/worker/ipmi.ts`
