# EtherNet/IP (CIP over Ethernet) -- Power User Reference

## Overview

**EtherNet/IP** (Ethernet Industrial Protocol) carries the Common Industrial Protocol (CIP) over
standard TCP/IP and UDP/IP. It is the dominant protocol for Allen-Bradley / Rockwell Automation PLCs
and is widely supported by drives, HMIs, I/O modules, and other industrial automation devices. CIP
provides an object-oriented application layer; EtherNet/IP provides the encapsulation transport.

**Port:** 44818 (TCP, default); UDP 44818 for implicit I/O messaging (not implemented here)
**Transport:** Raw TCP (Cloudflare Workers `cloudflare:sockets connect()`)
**Cloudflare detection:** Yes -- 403 with `isCloudflare: true` before any TCP attempt
**Authentication:** EtherNet/IP has **no built-in authentication or encryption**. CIP Security
(TLS-based) exists but is rarely deployed. Treat all write operations with extreme caution.

---

## Encapsulation Layer

Every EtherNet/IP message on TCP is wrapped in a 24-byte encapsulation header. All multi-byte
fields are **little-endian**.

```
Offset  Size  Field
------  ----  -----
 0       2    Command           (UINT, LE)
 2       2    Length            (UINT, LE) -- byte count of data following this header
 4       4    Session Handle    (UDINT, LE) -- 0 for session-less commands
 8       4    Status            (UDINT, LE) -- 0 = success
12       8    Sender Context    (8 bytes, opaque, echoed back by target)
20       4    Options           (UDINT, LE) -- shall be 0
```

Total frame size = 24 + Length.

### Encapsulation Commands

| Code     | Name              | Session Required | Direction        |
|----------|-------------------|------------------|------------------|
| `0x0004` | ListServices      | No               | Client -> Target |
| `0x0063` | ListIdentity      | No               | Client -> Target |
| `0x0065` | RegisterSession   | No (creates one) | Client -> Target |
| `0x0066` | UnregisterSession | Yes              | Client -> Target |
| `0x006F` | SendRRData        | Yes              | Client -> Target |
| `0x0070` | SendUnitData      | Yes              | Client -> Target |

### Encapsulation Status Codes

| Code         | Meaning                                    |
|--------------|--------------------------------------------|
| `0x00000000` | Success                                    |
| `0x00000001` | Invalid/Unsupported Encapsulation Command  |
| `0x00000002` | Insufficient Memory                        |
| `0x00000003` | Incorrectly Formed Data                    |
| `0x00000064` | Invalid Session Handle                     |
| `0x00000065` | Invalid Length                              |
| `0x00000069` | Unsupported Encapsulation Protocol Version |

---

## Session Management

### RegisterSession (0x0065)

Opens a CIP session. The request data is 4 bytes:

```
Offset  Size  Field
------  ----  -----
 0       2    Protocol Version  (UINT, LE) -- must be 1
 2       2    Options Flags     (UINT, LE) -- must be 0
```

The response echoes the same 4 bytes of data. The **Session Handle** field in the encapsulation
header of the response contains the assigned handle. All subsequent session-based commands must
include this handle.

A target shall support at most one session per TCP connection. A session persists until the
connection is closed or an UnregisterSession is sent.

### UnregisterSession (0x0066)

Closes a session. No data payload (Length = 0). The Session Handle in the header identifies which
session to close. No response is sent; the target closes the TCP connection.

---

## Session-less Commands

### ListIdentity (0x0063)

Discovers device identity without establishing a session. No data payload (Length = 0). The
Session Handle should be 0.

The response data contains CPF (Common Packet Format) items:

```
Offset  Size  Field
------  ----  -----
 0       2    Item Count (UINT, LE) -- typically 1
 2       2    Item Type ID (UINT, LE) -- 0x000C for CIP Identity
 4       2    Item Length (UINT, LE)
 6       N    Item Data (Identity Object attributes)
```

#### Identity Item Data Layout

```
Offset  Size  Field
------  ----  -----
 0       2    Protocol Version (UINT, LE)
 2      16    Socket Address (sockaddr_in, big-endian):
                sin_family (2), sin_port (2), sin_addr (4), sin_zero (8)
18       2    Vendor ID (UINT, LE)
20       2    Device Type (UINT, LE)
22       2    Product Code (UINT, LE)
24       2    Revision: Major (USINT) + Minor (USINT)
26       2    Status (UINT, LE) -- see Status Word below
28       4    Serial Number (UDINT, LE)
32       1    Product Name Length (USINT)
33       N    Product Name (ASCII, not null-terminated)
33+N     1    State (USINT)
```

#### Identity Status Word (CIP Vol 1, Table 5A-2.11)

| Bit(s) | Meaning                           |
|--------|-----------------------------------|
| 0      | Owned (1 = claimed by controller) |
| 1      | Reserved                          |
| 2      | Configured                        |
| 3      | Reserved                          |
| 4-7    | Extended Device Status (4-bit field, see below) |
| 8      | Minor Recoverable Fault           |
| 9      | Minor Unrecoverable Fault         |
| 10     | Major Recoverable Fault           |
| 11     | Major Unrecoverable Fault         |
| 12-15  | Reserved                          |

**Extended Device Status values (bits 4-7):**

| Value | Meaning                                    |
|-------|--------------------------------------------|
| 0     | Unknown                                    |
| 1     | Firmware Update In Progress                |
| 2     | At Least One Faulted I/O Connection        |
| 3     | No I/O Connections Established             |
| 4     | Non-Volatile Configuration Bad             |
| 5     | Major Fault                                |
| 6     | At Least One I/O Connection In Run Mode    |
| 7     | At Least One I/O Connection In Idle Mode   |

#### Device State Values

| Value | State                      |
|-------|----------------------------|
| 0     | Nonexistent                |
| 1     | Device Self Testing        |
| 2     | Standby                    |
| 3     | Operational                |
| 4     | Major Recoverable Fault    |
| 5     | Major Unrecoverable Fault  |
| 255   | Default                    |

### ListServices (0x0004)

Discovers which CIP transport services a device supports (e.g., CIP over TCP, CIP over UDP). No
session required. No data payload.

Response data contains CPF items, typically one item with Type ID `0x0100` (Communications):

```
Offset  Size  Field
------  ----  -----
 0       2    Protocol Version (UINT, LE)
 2       2    Capability Flags (UINT, LE)
 4      16    Service Name (null-padded ASCII, e.g., "Communications")
```

**Capability Flags:**

| Bit | Meaning                           |
|-----|-----------------------------------|
| 5   | Supports CIP encapsulation via TCP |
| 8   | Supports CIP transport via UDP     |

---

## CIP Object Model

CIP uses a hierarchical addressing scheme: **Class / Instance / Attribute**. Every CIP device
contains a set of object classes, each with instances, each with attributes.

### Common CIP Object Classes

| Class ID | Name                    | Description                              |
|----------|-------------------------|------------------------------------------|
| `0x01`   | Identity                | Device name, vendor, type, serial, etc.  |
| `0x02`   | Message Router          | Routes explicit messages to objects       |
| `0x04`   | Assembly                | Groups I/O data into assemblies           |
| `0x06`   | Connection Manager      | Manages CIP connections                   |
| `0xF5`   | TCP/IP Interface        | IP address, subnet, gateway, DNS          |
| `0xF6`   | Ethernet Link           | MAC address, link speed, counters         |
| `0xAC`   | Port                    | Physical port information                 |

### CIP Services

| Code   | Service                  | Description                            |
|--------|--------------------------|----------------------------------------|
| `0x01` | Get_Attributes_All       | Read all attributes of an instance     |
| `0x0E` | Get_Attribute_Single     | Read one attribute                     |
| `0x10` | Set_Attribute_Single     | Write one attribute                    |

### CIP Logical Path Encoding

Paths address Class/Instance/Attribute using **logical segments**:

```
8-bit segment:  [segment_type] [value]          (2 bytes)
16-bit segment: [segment_type] [0x00] [lo] [hi] (4 bytes)
```

| Segment Type | Size    | Meaning    |
|-------------|---------|------------|
| `0x20`      | 8-bit   | Class ID   |
| `0x21`      | 16-bit  | Class ID   |
| `0x24`      | 8-bit   | Instance ID|
| `0x25`      | 16-bit  | Instance ID|
| `0x30`      | 8-bit   | Attribute ID|
| `0x31`      | 16-bit  | Attribute ID|

The path is measured in 16-bit **words** (Path Size field = byte count / 2). 8-bit segments are
always 2 bytes (1 word). 16-bit segments are always 4 bytes (2 words). The total path length is
padded to an even byte count if necessary.

### CIP Response Format

```
Offset  Size  Field
------  ----  -----
 0       1    Reply Service (request service code | 0x80)
 1       1    Reserved (0x00)
 2       1    General Status (0x00 = success)
 3       1    Additional Status Size (in 16-bit words)
 4      2*N   Additional Status words (if any)
4+2*N    M    Response Data
```

### CIP General Status Codes

| Code   | Meaning                                        |
|--------|------------------------------------------------|
| `0x00` | Success                                        |
| `0x01` | Connection Failure                             |
| `0x04` | Path Segment Error                             |
| `0x05` | Path Destination Unknown                       |
| `0x08` | Service Not Supported                          |
| `0x0E` | Attribute Not Settable                         |
| `0x0F` | Privilege Violation                            |
| `0x14` | Attribute Not Supported                        |
| `0x16` | Object Does Not Exist                          |

(Full table in implementation: 30+ codes from CIP Volume 1.)

---

## SendRRData (0x006F)

Carries CIP explicit messaging (request/reply) within a session. This is the primary mechanism for
reading and writing CIP attributes via UCMM (Unconnected Message Manager).

### Request Structure

```
Offset  Size  Field
------  ----  -----
 0       4    Interface Handle (UDINT, LE) -- 0x00000000 for CIP
 4       2    Timeout (UINT, LE) -- seconds
 6       2    Item Count (UINT, LE) -- always 2 for UCMM
 8       4    Item 0: Null Address (Type 0x0000, Length 0)
12       2    Item 1: Type (0x00B2 = Unconnected Data)
14       2    Item 1: Length (UINT, LE)
16       N    CIP Request (service + path_size + path [+ data])
```

### Response Structure

Same layout. Item 1 contains the CIP response (reply service, status, data).

---

## Endpoints

### POST /api/ethernetip/identity

Sends a ListIdentity command (no session). Returns device identity information including vendor,
device type, product name, serial number, firmware revision, and socket address.

**Request**
```json
{
  "host":    "192.168.1.10",
  "port":    44818,
  "timeout": 10000
}
```

| Field     | Type   | Default | Description                    |
|-----------|--------|---------|--------------------------------|
| `host`    | string | --      | Target hostname or IP (required) |
| `port`    | number | 44818   | TCP port                       |
| `timeout` | number | 10000   | Overall timeout in ms          |

**Response**
```json
{
  "success": true,
  "host": "192.168.1.10",
  "port": 44818,
  "rtt": 42,
  "encapsulationCommand": 99,
  "encapsulationStatus": 0,
  "identity": {
    "protocolVersion": 1,
    "socketAddress": "192.168.1.10:44818",
    "vendorId": 1,
    "deviceType": 14,
    "deviceTypeName": "Programmable Logic Controller",
    "productCode": 55,
    "revisionMajor": 20,
    "revisionMinor": 19,
    "status": 0,
    "statusDescription": "OK",
    "serialNumber": "0x0040CAFE",
    "productName": "1756-L71/B LOGIX5571",
    "state": 3,
    "stateName": "Operational"
  }
}
```

### POST /api/ethernetip/cip-read

Reads a single CIP attribute via RegisterSession + SendRRData + Get_Attribute_Single (0x0E).

**Request**
```json
{
  "host":        "192.168.1.10",
  "port":        44818,
  "timeout":     10000,
  "classId":     1,
  "instanceId":  1,
  "attributeId": 7
}
```

| Field         | Type   | Default | Description                              |
|---------------|--------|---------|------------------------------------------|
| `host`        | string | --      | Target hostname or IP (required)         |
| `port`        | number | 44818   | TCP port                                 |
| `timeout`     | number | 10000   | Overall timeout in ms                    |
| `classId`     | number | --      | CIP class ID (required, e.g., 1=Identity)|
| `instanceId`  | number | --      | CIP instance ID (required, typically 1)  |
| `attributeId` | number | --      | CIP attribute ID (required)              |

**Response**
```json
{
  "success": true,
  "host": "192.168.1.10",
  "port": 44818,
  "sessionHandle": "0x00000001",
  "classId": "0x0001",
  "instanceId": 1,
  "attributeId": 7,
  "cipService": "0x8E",
  "status": 0,
  "statusName": "Success",
  "data": [49, 55, 53, 54, 45, 76, 55, 49],
  "hex": "31 37 35 36 2D 4C 37 31",
  "rtt": 58
}
```

**Common class/attribute combinations:**

| Class | Instance | Attribute | Returns                                  |
|-------|----------|-----------|------------------------------------------|
| 1     | 1        | 1         | Vendor ID (2 bytes LE)                   |
| 1     | 1        | 2         | Device Type (2 bytes LE)                 |
| 1     | 1        | 3         | Product Code (2 bytes LE)                |
| 1     | 1        | 4         | Revision (2 bytes: major, minor)         |
| 1     | 1        | 5         | Status (2 bytes LE)                      |
| 1     | 1        | 6         | Serial Number (4 bytes LE)               |
| 1     | 1        | 7         | Product Name (SHORT_STRING: len + ASCII) |
| 0xF5  | 1        | 5         | IP Configuration (IP, subnet, gateway)   |
| 0xF6  | 1        | 3         | MAC Address (6 bytes)                    |

### POST /api/ethernetip/get-attribute-all

Reads all attributes of a CIP object instance via Get_Attributes_All (0x01). Returns the raw
concatenated attribute data as a byte array.

**Request**
```json
{
  "host":       "192.168.1.10",
  "port":       44818,
  "timeout":    10000,
  "classId":    1,
  "instanceId": 1
}
```

| Field        | Type   | Default | Description                              |
|--------------|--------|---------|------------------------------------------|
| `host`       | string | --      | Target hostname or IP (required)         |
| `port`       | number | 44818   | TCP port                                 |
| `timeout`    | number | 10000   | Overall timeout in ms                    |
| `classId`    | number | --      | CIP class ID (required)                  |
| `instanceId` | number | --      | CIP instance ID (required)               |

**Response**
```json
{
  "success": true,
  "host": "192.168.1.10",
  "port": 44818,
  "sessionHandle": "0x00000001",
  "classId": "0x0001",
  "instanceId": 1,
  "status": 0,
  "statusName": "Success",
  "data": [1, 0, 14, 0, 55, 0, 20, 19, ...],
  "hex": "01 00 0E 00 37 00 14 13 ...",
  "rtt": 55
}
```

### POST /api/ethernetip/set-attribute

Writes a single CIP attribute via Set_Attribute_Single (0x10). **This modifies device
configuration. Use with extreme caution on live industrial systems.**

**Request**
```json
{
  "host":        "192.168.1.10",
  "port":        44818,
  "timeout":     10000,
  "classId":     1,
  "instanceId":  1,
  "attributeId": 7,
  "data":        [78, 101, 119, 78, 97, 109, 101]
}
```

| Field         | Type     | Default | Description                                   |
|---------------|----------|---------|-----------------------------------------------|
| `host`        | string   | --      | Target hostname or IP (required)              |
| `port`        | number   | 44818   | TCP port                                      |
| `timeout`     | number   | 10000   | Overall timeout in ms                         |
| `classId`     | number   | --      | CIP class ID (required)                       |
| `instanceId`  | number   | --      | CIP instance ID (required)                    |
| `attributeId` | number   | --      | CIP attribute ID (required)                   |
| `data`        | number[] | --      | Byte values to write (required, non-empty)    |

**Response**
```json
{
  "success": true,
  "host": "192.168.1.10",
  "port": 44818,
  "classId": "0x0001",
  "instanceId": 1,
  "attributeId": 7,
  "bytesWritten": 7,
  "status": 0,
  "statusName": "Success",
  "rtt": 63
}
```

### POST /api/ethernetip/list-services

Sends a ListServices command (no session) to discover which CIP transport services the device
supports.

**Request**
```json
{
  "host":    "192.168.1.10",
  "port":    44818,
  "timeout": 10000
}
```

**Response**
```json
{
  "success": true,
  "host": "192.168.1.10",
  "port": 44818,
  "rtt": 38,
  "serviceCount": 1,
  "services": [
    {
      "typeId": 256,
      "version": 1,
      "capabilityFlags": 288,
      "name": "Communications",
      "supportsTCP": true,
      "supportsUDP": true
    }
  ]
}
```

---

## Protocol Flow

### Discovery (no session)

```
Client                              Target
  |                                   |
  |--- ListIdentity (0x0063) -------->|   24 bytes, session=0
  |<-- ListIdentity Reply ------------|   24 + CPF items (identity data)
  |                                   |
  |--- TCP close -------------------->|
```

### Attribute Read (with session)

```
Client                              Target
  |                                   |
  |--- RegisterSession (0x0065) ----->|   24 + 4 bytes (version + options)
  |<-- RegisterSession Reply ---------|   24 + 4 bytes (session handle assigned)
  |                                   |
  |--- SendRRData (0x006F) ---------->|   24 + CPF items (CIP Get_Attribute_Single)
  |<-- SendRRData Reply --------------|   24 + CPF items (CIP response + data)
  |                                   |
  |--- UnregisterSession (0x0066) --->|   24 bytes, no data
  |                                   |   (target closes connection, no reply)
```

---

## Device Types

The implementation recognizes the following CIP device types (CIP Volume 1):

| Code   | Device Type                    |
|--------|--------------------------------|
| `0x00` | Generic Device                 |
| `0x02` | AC Drive                       |
| `0x03` | Motor Overload                 |
| `0x04` | Limit Switch                   |
| `0x05` | Inductive Proximity Switch     |
| `0x06` | Photoelectric Sensor           |
| `0x07` | General Purpose Discrete I/O   |
| `0x09` | Resolver                       |
| `0x0C` | Communications Adapter         |
| `0x0E` | Programmable Logic Controller  |
| `0x10` | Position Controller            |
| `0x13` | DC Drive                       |
| `0x15` | Contactor                      |
| `0x16` | Motor Starter                  |
| `0x17` | Soft Start                     |
| `0x18` | Human-Machine Interface        |
| `0x1A` | Mass Flow Controller           |
| `0x1B` | Pneumatic Valve                |
| `0x1C` | Vacuum Pressure Gauge          |
| `0x1D` | Process Control Value          |
| `0x1E` | Residual Gas Analyzer          |
| `0x1F` | DC Power Generator             |
| `0x20` | RF Power Generator             |
| `0x21` | Turbomolecular Vacuum Pump     |
| `0x22` | Encoder                        |
| `0x23` | Safety Discrete I/O Device     |
| `0x24` | Fluid Flow Controller          |
| `0x25` | CIP Motion Drive               |
| `0x26` | CompoNet Repeater              |
| `0x27` | CIP Modbus Device              |
| `0x28` | CIP Modbus Translator          |
| `0x29` | Safety Analog I/O Device       |
| `0x2A` | Generic Device (keyable)       |
| `0x2B` | Managed Ethernet Switch        |
| `0x2C` | CIP Motion Safety Drive        |
| `0x2D` | Safety Drive                   |
| `0x2E` | CIP Motion Encoder             |
| `0x2F` | CIP Motion Converter           |
| `0x30` | CIP Motion I/O                 |
| `0xC8` | Embedded Component             |

---

## Error Handling

All endpoints return a consistent error shape:

```json
{
  "success": false,
  "error": "description of what went wrong",
  "host": "...",
  "port": 44818,
  "rtt": 0
}
```

| HTTP Status | Condition                             |
|-------------|---------------------------------------|
| 400         | Missing/invalid host, port, or IDs    |
| 403         | Target resolves to Cloudflare IP      |
| 500         | Connection timeout, TCP error, CIP error |

CIP-level errors (status != 0) return HTTP 200 with `success: false` and the CIP status
name in `statusName`. The `error` field contains `"CIP error: <statusName>"`.

---

## Implementation Notes

### Transport Details

- Each endpoint opens a fresh TCP connection, performs one exchange, then closes.
- Connections use `cloudflare:sockets connect()` (Cloudflare Workers TCP API).
- Frame reassembly reads until the full encapsulation frame is received (24 + declared Length).
- Overall timeout is enforced via `Promise.race` with a timer.
- The `readEIPFrame` helper has its own per-read timeout using `Promise.race` against each
  `reader.read()` call.

### Session Lifecycle

- `RegisterSession` is sent with Protocol Version 1, Options 0.
- The response Session Handle (offset 4 of the encapsulation header) is captured.
- All subsequent `SendRRData` frames include this Session Handle.
- `UnregisterSession` is sent best-effort before closing (errors ignored).
- The TCP connection is always closed after the operation regardless.

### CIP Path Construction

- Class, Instance, and Attribute IDs <= 255 use 8-bit logical segments (2 bytes each).
- IDs > 255 use 16-bit logical segments (4 bytes: type + pad + 16-bit LE value).
- The total path is padded to an even byte count.
- Path Size in the CIP request is measured in 16-bit words (path bytes / 2).

### Byte Order

- **Encapsulation header:** All fields little-endian.
- **CIP data:** Little-endian.
- **sockaddr_in in ListIdentity:** Big-endian (network byte order) -- this is the only
  big-endian structure in the protocol.

### Sender Context

The Sender Context field (8 bytes at offset 12) is opaque data echoed back by the target. The
implementation uses `"PoCall\0\0"` (ASCII) for ListIdentity/ListServices requests, and a 32-bit
numeric value `0x1234` (zero-padded to 8 bytes) for session-based requests.

---

## Vendor IDs

Vendor IDs are assigned by ODVA. Common values:

| ID  | Vendor                          |
|-----|---------------------------------|
| 1   | Rockwell Automation / Allen-Bradley |
| 5   | Honeywell                       |
| 9   | Emerson / Fisher-Rosemount      |
| 43  | Schneider Electric / Modicon    |
| 44  | Omron                           |
| 283 | Molex                           |
| 674 | Phoenix Contact                 |
| 702 | Wago                            |

---

## Security Considerations

- EtherNet/IP has **no authentication**. Any host that can reach port 44818 can read and write
  CIP attributes.
- The `set-attribute` endpoint directly modifies device configuration. Writing to safety-critical
  attributes (e.g., Assembly objects, output data) can actuate physical devices and cause
  equipment damage or injury.
- Always obtain explicit authorization before probing or writing to industrial devices.
- CIP Safety and CIP Security (IEC 62443) are optional extensions not implemented here.
- The implementation validates that the target does not resolve to a Cloudflare IP before
  connecting.

---

## References

- EtherNet/IP Specification (ODVA): [https://www.odva.org/technology-standards/key-technologies/ethernet-ip/](https://www.odva.org/technology-standards/key-technologies/ethernet-ip/)
- CIP Volume 1: Common Industrial Protocol (ODVA)
- CIP Volume 2: EtherNet/IP Adaptation of CIP (ODVA)
- IANA Port Assignment: TCP/UDP 44818
- Wireshark dissector: `enip` / `cip`
