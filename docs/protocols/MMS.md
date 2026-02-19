# MMS (Manufacturing Message Specification) Protocol

## Overview

**MMS** (Manufacturing Message Specification) is an international standard (**ISO 9506-1/2**) for transferring real-time process data and supervisory control information between networked devices in industrial automation systems. It is the application-layer protocol used by **IEC 61850** substations, power grid equipment, and SCADA systems.

**Default Port:** 102 (TCP)
**Protocol Stack:** TPKT (RFC 1006) → COTP (ISO 8073) → MMS PDU (ASN.1 BER)
**Standards:** ISO 9506-1:2003, ISO 9506-2:2003, RFC 1006, IEC 61850

---

## Protocol Architecture

MMS sits atop the OSI stack, using a simplified TPKT/COTP/MMS stack over TCP:

```
┌──────────────────────────────────────┐
│  Application: MMS PDU (ASN.1 BER)    │
├──────────────────────────────────────┤
│  Presentation: ISO 8823 (implicit)   │
├──────────────────────────────────────┤
│  Session: ISO 8327 (implicit)        │
├──────────────────────────────────────┤
│  Transport: ISO 8073 COTP Class 0    │
├──────────────────────────────────────┤
│  Network: RFC 1006 TPKT over TCP     │
├──────────────────────────────────────┤
│  TCP: Port 102                       │
└──────────────────────────────────────┘
```

### TPKT (RFC 1006)

**TPKT** (ISO Transport Protocol over TCP) wraps each COTP message with a 4-byte header:

```
 0               1               2               3
 0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Version (0x03)|  Reserved(0x00)| Packet Length (big-endian)  |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       COTP TPDU Payload                       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

- **Version:** Always `0x03`
- **Reserved:** Always `0x00`
- **Packet Length:** 16-bit big-endian, includes TPKT header (min: 7, max: 65535)

### COTP (ISO 8073)

**COTP** (Connection-Oriented Transport Protocol) Class 0 provides connection establishment and data transfer:

#### Connection Request (CR) - TPDU Code `0xE0`

```
Byte 0:    Length Indicator (LI) - bytes following this byte
Byte 1:    TPDU Code = 0xE0 (CR)
Byte 2-3:  Destination Reference (0x0000)
Byte 4-5:  Source Reference (client-chosen, e.g., 0x0001)
Byte 6:    Class + Options = 0x00 (Class 0, no extended formats)
Byte 7+:   Variable Part (parameters):
             0xC0 01 0A         TPDU Size (1024 bytes = 0x0A)
             0xC1 <len> <data>  Calling TSAP
             0xC2 <len> <data>  Called TSAP
```

**TSAP** (Transport Service Access Point) identifies the application endpoint. Common values:
- IEC 61850 servers: `0x0001` (both calling and called)
- Some implementations use `0x0000` or custom values

#### Connection Confirm (CC) - TPDU Code `0xD0`

Same structure as CR. Server echoes parameters and confirms connection.

#### Data Transfer (DT) - TPDU Code `0xF0`

```
Byte 0:    Length Indicator = 0x02
Byte 1:    TPDU Code = 0xF0 (DT)
Byte 2:    TPDU-NR + EOT = 0x80 (TPDU-NR=0, EOT=1 for last data unit)
Byte 3+:   MMS PDU Payload
```

---

## MMS PDU Structure (ASN.1 BER)

MMS messages are encoded using **ASN.1 BER** (Basic Encoding Rules) in **TLV** (Tag-Length-Value) format.

### ASN.1 BER Encoding

#### Tag Encoding

- **Universal class tags:** `0x02` (INTEGER), `0x30` (SEQUENCE), `0x1A` (VisibleString)
- **Context-specific tags:** `0x80 | tag` (primitive), `0xA0 | tag` (constructed)
- **High tags (≥31):** Multi-byte encoding (e.g., `[82]` = `0x9F 0x52`)

#### Length Encoding

- **Short form (≤127 bytes):** Single byte `0x00`-`0x7F`
- **Long form (>127 bytes):**
  - First byte: `0x80 | num_length_bytes` (e.g., `0x81` = 1 byte follows, `0x82` = 2 bytes)
  - Following bytes: length value in big-endian

Example: Length 300 = `0x82 0x01 0x2C` (2 bytes: 0x012C)

#### Integer Encoding

- **Positive integers:** Minimal bytes, prepend `0x00` if high bit set
  - `5` → `0x05`
  - `200` → `0x00 0xC8` (prepend 0x00 because 0xC8 has high bit set)
- **Negative integers:** Two's complement
  - `-5` → `0xFB`

---

## MMS Protocol Flow

### Phase 1: COTP Connection

**Client → Server: COTP CR (Connection Request)**

```
TPKT Header:    03 00 00 16  (version 3, length 22 bytes)
COTP CR:        11 E0 00 00 00 01 00 C0 01 0A C1 02 00 01 C2 02 00 01
  LI=0x11 (17 bytes follow)
  Code=0xE0 (CR)
  Dst Ref=0x0000
  Src Ref=0x0001
  Class=0x00
  TPDU Size: C0 01 0A (1024 bytes)
  Calling TSAP: C1 02 00 01
  Called TSAP: C2 02 00 01
```

**Server → Client: COTP CC (Connection Confirm)**

```
TPKT Header:    03 00 00 0B  (version 3, length 11 bytes)
COTP CC:        06 D0 00 01 00 00 00
  LI=0x06
  Code=0xD0 (CC)
  Dst Ref=0x0001 (echoes client's Src Ref)
  Src Ref=0x0000
  Class=0x00
```

### Phase 2: MMS Initiate

**Client → Server: MMS Initiate-Request**

```
TPKT + COTP DT:  03 00 00 ... 02 F0 80 <MMS PDU>
MMS PDU Tag:     A8 ... (initiate-RequestPDU)
  [0] localDetailCalling: INTEGER (65000 - max PDU size)
  [1] proposedMaxServOutstandingCalling: INTEGER (5)
  [2] proposedMaxServOutstandingCalled: INTEGER (5)
  [3] proposedDataStructureNestingLevel: INTEGER (10)
  [4] mmsInitRequestDetail: SEQUENCE {
        [0] proposedVersionNumber: INTEGER (1)
        [1] proposedParameterCBB: BIT STRING
        [2] servicesSupportedCalling: BIT STRING (11 bytes, 85 services)
      }
```

**Server → Client: MMS Initiate-Response**

```
MMS PDU Tag:     A9 ... (initiate-ResponsePDU)
  [0] localDetailCalled: INTEGER (negotiated max PDU size)
  [1] maxServOutstandingCalling: INTEGER
  [2] maxServOutstandingCalled: INTEGER
  [4] mmsInitResponseDetail: SEQUENCE {
        [0] negotiatedVersionNumber: INTEGER (1)
        [1] negotiatedParameterCBB: BIT STRING
        [2] servicesSupportedCalled: BIT STRING (server's supported services)
      }
```

### Phase 3: MMS Services

#### Identify (Service [82])

Retrieves server vendor/model/revision (VMD identity).

**Request:**
```
Confirmed-RequestPDU: A0 ... (tag 0xA0)
  invokeID: 02 01 01  (INTEGER 1)
  identify [82]: 9F 52 00  (context [82] primitive, length 0)
```

**Response:**
```
Confirmed-ResponsePDU: A1 ... (tag 0xA1)
  invokeID: 02 01 01
  identify [82]: BF 52 ... (context [82] constructed)
    vendorName: 1A ... (VisibleString)
    modelName: 1A ...
    revision: 1A ...
```

#### GetNameList (Service [1])

Enumerates named variables or domains.

**Request:**
```
Confirmed-RequestPDU: A0 ...
  invokeID: 02 01 01
  getNameList [1]: A1 ... (context [1] constructed)
    objectClass [0]: A0 03 80 01 00  (namedVariable=0, domain=9)
    objectScope [1]: A1 02 80 00  (vmdSpecific [0] NULL)
      or: A1 ... 81 <len> <domainId>  (domainSpecific [1] Identifier)
    continueAfter [2]: 82 <len> <name>  (optional pagination)
```

**Response:**
```
Confirmed-ResponsePDU: A1 ...
  invokeID: 02 01 01
  getNameList [1]: A1 ...
    listOfIdentifier [0]: A0 ... (SEQUENCE OF Identifier)
      1A <len> <name1>
      1A <len> <name2>
      ...
    moreFollows [1]: 81 01 00  (BOOLEAN, 0x00=false)
```

#### Read (Service [4])

Reads the value of a named variable.

**Request:**
```
Confirmed-RequestPDU: A0 ...
  invokeID: 02 01 01
  read [4]: A4 ... (context [4] constructed)
    variableAccessSpecification:
      listOfVariable [0]: A0 ...
        SEQUENCE {
          variableSpecification:
            name [0]: A0 ...
              vmd-specific [0]: 80 <len> <varName>
              or domain-specific [1]: A1 ... 30 ... (SEQUENCE)
                domainId: 1A <len> <domainId>
                itemId: 1A <len> <itemId>
        }
```

**Response:**
```
Confirmed-ResponsePDU: A1 ...
  invokeID: 02 01 01
  read [4]: A4 ...
    listOfAccessResult [0]: A0 ...
      success [1]: A1 ... (Data CHOICE)
        boolean [3]: 83 01 00/01
        integer [5]: 85 <len> <value>
        unsigned [6]: 86 <len> <value>
        floating-point [7]: 87 05 08 <4-byte IEEE 754>
        visible-string [10]: 8A <len> <string>
        octet-string [9]: 89 <len> <bytes>
        utc-time [12]: 8C 08 <8-byte timestamp>
      or failure [0]: 80 <len> <DataAccessError>
```

---

## MMS Services (ISO 9506-2)

The `servicesSupportedCalled` BIT STRING indicates which services the server supports. Bit positions:

| Bit | Service | Description |
|-----|---------|-------------|
| 0 | status | Server status |
| 1 | getNameList | Enumerate variables/domains |
| 2 | identify | Get server vendor/model/revision |
| 4 | read | Read variable value |
| 5 | write | Write variable value |
| 6 | getVariableAccessAttributes | Get variable metadata |
| 12 | getNamedVariableListAttributes | Get variable list metadata |
| 26-31 | Download/Upload | Firmware transfer |
| 32-36 | Domain management | Domain CRUD |
| 47-62 | Event management | Event condition/action/enrollment |
| 71 | getCapabilityList | Get server capabilities |
| 72-77 | File services | File open/read/close/rename/delete/directory |
| 83 | conclude | Terminate MMS association |

---

## Data Types

MMS defines these data types (context-specific tags):

| Tag | Type | Encoding | Example |
|-----|------|----------|---------|
| `[3]` | boolean | `83 01 <0x00/0x01>` | `83 01 01` = true |
| `[4]` | bit-string | `84 <len> <unused> <bytes>` | `84 02 03 A0` = 10100 (3 unused bits) |
| `[5]` | integer | `85 <len> <value>` (signed) | `85 02 00 C8` = 200 |
| `[6]` | unsigned | `86 <len> <value>` | `86 01 FF` = 255 |
| `[7]` | floating-point | `87 05 08 <4-byte IEEE 754>` | `87 05 08 42 48 00 00` = 50.0 |
| `[9]` | octet-string | `89 <len> <bytes>` | `89 04 DE AD BE EF` |
| `[10]` | visible-string | `8A <len> <ASCII>` | `8A 05 48 65 6C 6C 6F` = "Hello" |
| `[12]` | utc-time | `8C 08 <sec> <frac> <qual>` | 8 bytes: 4-byte Unix time + 4-byte fraction |
| `[17]` | mms-string | `91 <len> <UTF-8>` | UTF-8 string |
| `[1]` | array | `A1 ... (constructed)` | Array of Data values |
| `[2]` | structure | `A2 ... (constructed)` | Struct of Data values |

### UTC Time Encoding

```
Bytes 0-3:  Seconds since Unix epoch (big-endian)
Bytes 4-7:  Fraction of second (0xFFFFFFFF = 1.0)
Bytes 8-9:  Quality (bit flags, optional)
Bytes 10-11: Reserved (optional)
```

Example: `0x65 0xAB 0xCD 0xEF 0x80 0x00 0x00 0x00` = 2024-07-20 12:34:55 + 0.5s

---

## Error Handling

### Confirmed-ErrorPDU (Tag `0xA2`)

```
A2 ... (confirmed-ErrorPDU)
  invokeID: 02 01 01
  serviceError: A0 ... (CHOICE)
    errorClass: 80 01 <class>
    additionalCode: 81 01 <code>
```

**Error Classes:**
- `0` - vmd-state
- `1` - application-reference
- `2` - definition
- `3` - resource
- `4` - service
- `5` - service-preempt
- `6` - time-resolution
- `7` - access
- `8` - initiate
- `9` - conclude
- `10` - cancel

### Reject-PDU (Tag `0xA4`)

```
A4 ... (rejectPDU)
  invokeID: 02 01 01 (or NULL if unknown)
  rejectReason: 80 01 <reason>
```

**Common reject reasons:**
- `0` - confirmed-requestPDU
- `1` - confirmed-responsePDU
- `2` - confirmed-errorPDU
- `3` - unconfirmed-PDU
- `4` - pdu-error
- `5` - cancel-requestPDU
- `6` - cancel-responsePDU
- `7` - cancel-errorPDU

---

## Common Issues and Troubleshooting

### Connection Failures

1. **COTP CR rejected:**
   - Check TSAP values (try `0x0001`, `0x0000`, or device-specific)
   - Verify port 102 is open (not 502/Modbus)
   - Ensure firewall allows TCP 102

2. **MMS Initiate failed:**
   - Server may require specific service bits in `servicesSupportedCalling`
   - Try reducing `localDetailCalling` (max PDU size) to 65000 or 16384
   - Some servers reject version >1

3. **GetNameList returns empty:**
   - Use `objectScope=vmdSpecific` for top-level variables
   - For domain variables, enumerate domains first, then query each domain
   - Check `moreFollows` - may need pagination with `continueAfter`

4. **Read returns DataAccessError:**
   - Error code meanings (context-specific):
     - `0` - object-invalidated
     - `1` - hardware-fault
     - `2` - temporarily-unavailable
     - `3` - object-access-denied
     - `4` - object-undefined
     - `5` - invalid-address
     - `6` - type-unsupported
     - `7` - type-inconsistent
     - `8` - object-attribute-inconsistent
     - `9` - object-access-unsupported
     - `10` - object-non-existent

### Parsing Issues

1. **BER length errors:**
   - Check for long-form lengths (`0x81`, `0x82`)
   - Verify buffer has enough bytes before reading value

2. **High-tag decoding:**
   - Tags ≥31 use multi-byte encoding
   - Service [82] = `0x9F 0x52` (primitive) or `0xBF 0x52` (constructed)

3. **Bit string bit ordering:**
   - BER uses MSB-first: bit 0 = `0x80`, bit 1 = `0x40`, etc.
   - Unused bits in last byte must be 0

---

## Security Considerations

1. **No built-in authentication:** MMS has no username/password mechanism. Access control relies on network-level security (VPN, firewall).

2. **No encryption:** MMS PDUs are cleartext. Use TLS wrapper or VPN tunnel for confidentiality.

3. **Write access:** If server supports `write` service, unauthorized clients can modify variable values (e.g., trip breakers, change setpoints).

4. **DoS vectors:**
   - Large `GetNameList` queries can exhaust server resources
   - Rapid `Read` requests can saturate network
   - Malformed BER can crash parsers

5. **IEC 61850 specifics:**
   - MMS is the SCADA control layer for power substations
   - Unauthorized writes can cause power outages, equipment damage
   - Always restrict port 102 to trusted management networks

---

## IEC 61850 Integration

**IEC 61850** uses MMS as its communication protocol. Key mappings:

| IEC 61850 Concept | MMS Equivalent |
|-------------------|----------------|
| Logical Device (LD) | MMS Domain |
| Data Object (DO) | MMS Named Variable |
| Data Attribute (DA) | MMS Variable component |
| Data Set | MMS Named Variable List |
| Report Control Block | MMS Journal |
| GOOSE/SV | Not MMS (direct Ethernet) |

### Example: Reading an IEC 61850 Variable

To read `IED1LD0/MMXU1.TotW.mag.f` (total watts, float):

1. **Domain:** `IED1LD0`
2. **Variable:** `MMXU1$MX$TotW$mag$f` (IEC 61850 uses `$` as separator in MMS)

MMS Read request:
```
Read [4]: domain-specific [1] {
  domainId: "IED1LD0"
  itemId: "MMXU1$MX$TotW$mag$f"
}
```

Response: `floating-point [7]: 87 05 08 <IEEE 754 float>`

---

## Example Session

### 1. Probe (COTP + Initiate + Identify)

**Request:**
```bash
POST /api/mms/probe
{
  "host": "192.168.1.100",
  "port": 102,
  "timeout": 15000,
  "callingTSAP": "0001",
  "calledTSAP": "0001"
}
```

**Response:**
```json
{
  "success": true,
  "host": "192.168.1.100",
  "port": 102,
  "rtt": 234,
  "cotpConnected": true,
  "mmsInitiated": true,
  "mmsVersion": 1,
  "maxPduSize": 65000,
  "servicesSupportedCalled": [
    "status", "getNameList", "identify", "read", "write",
    "getVariableAccessAttributes", "conclude"
  ],
  "vendorName": "Siemens",
  "modelName": "SIPROTEC 5",
  "revision": "7.80"
}
```

### 2. Enumerate Domains

**Request:**
```bash
POST /api/mms/namelist
{
  "host": "192.168.1.100",
  "objectClass": "domain"
}
```

**Response:**
```json
{
  "success": true,
  "names": ["IED1LD0", "IED1LD1", "IED1LD2"],
  "count": 3,
  "moreFollows": false
}
```

### 3. Enumerate Variables in Domain

**Request:**
```bash
POST /api/mms/namelist
{
  "host": "192.168.1.100",
  "objectClass": "namedVariable",
  "domainId": "IED1LD0"
}
```

**Response:**
```json
{
  "success": true,
  "names": [
    "MMXU1$MX$TotW$mag$f",
    "MMXU1$MX$TotVAr$mag$f",
    "XCBR1$ST$Pos$stVal"
  ],
  "count": 3,
  "moreFollows": false
}
```

### 4. Read Variable

**Request:**
```bash
POST /api/mms/read
{
  "host": "192.168.1.100",
  "domainId": "IED1LD0",
  "variableName": "MMXU1$MX$TotW$mag$f"
}
```

**Response:**
```json
{
  "success": true,
  "values": [
    {
      "type": "float",
      "value": 1234.5,
      "raw": "08 44 9a 40 00"
    }
  ]
}
```

---

## Advanced Topics

### Pagination (GetNameList)

If `moreFollows=true`, use `continueAfter` to retrieve next page:

```bash
POST /api/mms/namelist
{
  "host": "192.168.1.100",
  "objectClass": "namedVariable",
  "domainId": "IED1LD0",
  "continueAfter": "MMXU1$MX$TotW$mag$f"
}
```

Server returns variables lexicographically after `continueAfter`.

### Nested Structures

When reading a structure or array, the response contains nested Data values:

```
structure [2]: A2 ... {
  Data [0]: boolean [3] ...
  Data [1]: integer [5] ...
  Data [2]: visible-string [10] ...
}
```

Parser must recursively decode each Data element.

### Write Operation

**Not implemented in this codebase**, but structure is:

```
Write-Request [5]: A5 ... {
  variableAccessSpecification: (same as Read)
  listOfData [0]: A0 ... {
    Data: <type> <len> <value>
  }
}
```

**WARNING:** Writing to IEC 61850 devices can trip breakers, change protection settings, or cause equipment damage. Always test in isolated environments.

---

## References

### Standards
- [ISO 9506-1:2003](https://cdn.standards.iteh.ai/samples/37079/0d35f397836741e09f4b87bd732c9af9/ISO-9506-1-2003.pdf) - MMS Part 1: Service Definition
- [ISO 9506-2:2003](https://www.researchgate.net/publication/243446487_The_Standard_Message_Specification_for_Industrial_Automation_Systems_ISO_9506_MMS) - MMS Part 2: Protocol Specification
- [RFC 1006](https://datatracker.ietf.org/doc/html/rfc1006) - ISO Transport Service on top of TCP
- [ITU-T X.690](https://www.itu.int/ITU-T/studygroups/com17/languages/X.690-0207.pdf) - ASN.1 BER Encoding Rules
- [IEC 61850-8-1](https://webstore.iec.ch/publication/6028) - Communication networks and systems for power utility automation

### Tools
- **libIEC61850** - Open-source MMS/IEC 61850 library (C)
- **Wireshark** - Protocol analyzer with MMS/COTP/TPKT dissectors
- **MMS-EASE Lite** - Commercial MMS test client
- **IEC 61850 Explorer** - Siemens IEC 61850 browser

### Security Research
- [Claroty: MMS Under the Microscope](https://claroty.com/team82/research/mms-under-the-microscope-examining-the-security-of-a-power-automation-standard) - Security analysis of MMS in power automation

---

## API Endpoints

### POST /api/mms/probe

Establish COTP connection, perform MMS Initiate, and retrieve server identity.

**Request:**
```json
{
  "host": "192.168.1.100",
  "port": 102,
  "timeout": 15000,
  "callingTSAP": "0001",
  "calledTSAP": "0001"
}
```

**Response:**
```json
{
  "success": true,
  "host": "192.168.1.100",
  "port": 102,
  "rtt": 234,
  "cotpConnected": true,
  "mmsInitiated": true,
  "mmsVersion": 1,
  "maxPduSize": 65000,
  "maxServOutstandingCalling": 5,
  "maxServOutstandingCalled": 5,
  "servicesSupportedCalled": ["status", "getNameList", "identify", "read"],
  "vendorName": "Siemens",
  "modelName": "SIPROTEC 5",
  "revision": "7.80"
}
```

### POST /api/mms/namelist

Enumerate domains or named variables.

**Request:**
```json
{
  "host": "192.168.1.100",
  "objectClass": "domain",
  "domainId": null,
  "continueAfter": null
}
```

**Response:**
```json
{
  "success": true,
  "host": "192.168.1.100",
  "port": 102,
  "rtt": 123,
  "objectClass": "domain",
  "names": ["IED1LD0", "IED1LD1"],
  "count": 2,
  "moreFollows": false
}
```

### POST /api/mms/read

Read a named variable's value.

**Request:**
```json
{
  "host": "192.168.1.100",
  "domainId": "IED1LD0",
  "variableName": "MMXU1$MX$TotW$mag$f"
}
```

**Response:**
```json
{
  "success": true,
  "host": "192.168.1.100",
  "port": 102,
  "rtt": 145,
  "domainId": "IED1LD0",
  "variableName": "MMXU1$MX$TotW$mag$f",
  "values": [
    {
      "type": "float",
      "value": 1234.5,
      "raw": "08 44 9a 40 00"
    }
  ]
}
```

### POST /api/mms/describe

Full server discovery: COTP + Initiate + Identify + GetNameList(domains).

**Request:**
```json
{
  "host": "192.168.1.100"
}
```

**Response:**
```json
{
  "success": true,
  "host": "192.168.1.100",
  "port": 102,
  "rtt": 345,
  "cotpConnected": true,
  "mmsInitiated": true,
  "mmsVersion": 1,
  "maxPduSize": 65000,
  "servicesSupportedCalled": ["status", "getNameList", "identify", "read", "write"],
  "vendorName": "Siemens",
  "modelName": "SIPROTEC 5",
  "revision": "7.80",
  "domains": ["IED1LD0", "IED1LD1", "IED1LD2"],
  "domainCount": 3,
  "moreDomainsAvailable": false
}
```

---

## Implementation Notes (Port of Call Codebase)

### Bugs Fixed (2026-02-18)

1. **BER Integer Sign Extension** - Fixed two's complement decoding for negative integers. Previous implementation incorrectly used bitwise OR during sign extension.

2. **BER Bit String Decoding** - Added explicit unused bits handling and clarified MSB-first bit ordering per BER spec.

3. **Identify Request Tag** - Changed from context-constructed `0xBF 0x52` to context-primitive `0x9F 0x52` since Identify service has no parameters.

4. **TPKT Length Parsing** - Added explicit `& 0xFF` masks to prevent JavaScript signed integer issues when reading 16-bit big-endian length.

### Limitations

- **Write service not implemented** - Only read-only operations (probe, namelist, read, identify) are supported
- **No TLS wrapper** - All traffic is cleartext; use VPN or network isolation
- **No authentication** - MMS has no built-in auth; relies on network security
- **No segmentation** - Assumes all responses fit in single TPKT packet (<65535 bytes)
- **Cloudflare restriction** - Cannot probe Cloudflare IPs (403 Forbidden)

### Supported Services (Client-Side)

- **status** (0)
- **getNameList** (1) - domains and named variables
- **identify** (2) - VMD vendor/model/revision
- **read** (4) - variable values
- **getVariableAccessAttributes** (6) - advertised but not implemented
- **getNamedVariableListAttributes** (12) - advertised but not implemented
- **getCapabilityList** (71) - advertised but not implemented
- **conclude** (83) - advertised but not implemented

---

## Changelog

### 2026-02-18
- Fixed BER integer decoding (two's complement for negative values)
- Fixed BER bit string decoding (explicit unused bits handling)
- Fixed Identify request tag encoding (primitive vs constructed)
- Fixed TPKT length parsing (explicit unsigned 16-bit)
- Added comprehensive protocol documentation

---

## License

This documentation is part of the Port of Call project. The MMS protocol is standardized by ISO (ISO 9506) and IEC (IEC 61850-8-1).
