# DNP3 (Distributed Network Protocol 3)

IEEE 1815-2012 | Default TCP port: **20000**

DNP3 is a SCADA/ICS protocol used by electric utilities, water/wastewater systems, and oil & gas pipelines. It was designed for reliable communication between master stations (control centers) and outstations (RTUs, IEDs) over noisy serial links. The TCP transport (IEEE 1815) wraps the same layered protocol in a TCP stream.

Implementation: [`src/worker/dnp3.ts`](../../src/worker/dnp3.ts)

---

## Protocol Layers

DNP3 has three layers, each carried inside the one above:

```
TCP stream
  +-- Data Link Layer frame(s)
        +-- Transport Layer segment(s)
              +-- Application Layer message
```

### Data Link Layer

Every frame on the wire begins with a fixed 10-byte header followed by zero or more 18-byte data blocks (16 payload + 2 CRC).

#### Frame Layout

```
Offset  Bytes  Field
------  -----  ------------------------------------------
 0       2     Start bytes: 0x05 0x64 (always)
 2       1     Length (see below)
 3       1     Control byte
 4       2     Destination address (little-endian, 16-bit)
 6       2     Source address (little-endian, 16-bit)
 8       2     Header CRC-16 (over bytes 0-7)
10+      var   User data blocks (up to 250 bytes of payload)
```

**Length field** = number of bytes from the Control byte through the end of user data, *excluding* CRC bytes. Minimum value is 5 (Control + Dest + Src, no user data). Maximum is 255.

```
Length = 5 + userDataLength
```

**User data blocks**: after the 10-byte header, user data is broken into blocks of up to 16 bytes. Each block is followed by its own 2-byte CRC-16. This means the wire representation of N user data bytes is:

```
ceil(N / 16) blocks, each: min(16, remaining) data bytes + 2-byte CRC
Total wire size = 10 + N + ceil(N / 16) * 2
```

#### Control Byte

```
Bit 7    DIR   Direction: 1 = from master, 0 = from outstation
Bit 6    PRM   Primary: 1 = primary (request), 0 = secondary (response)
Bit 5    FCV/DFC
               Primary: FCV (Frame Count Valid)
               Secondary: DFC (Data Flow Control — outstation buffer full)
Bit 4    FCB   Frame Count Bit (primary messages with FCV=1)
Bits 3-0       Function code (see tables below)
```

**Primary function codes** (master to outstation, PRM=1):

| Code | Name                      | Description                        |
|------|---------------------------|------------------------------------|
| 0x00 | RESET_LINK                | Reset the link state machine       |
| 0x02 | TEST_LINK                 | Test if link is operational        |
| 0x03 | CONFIRMED_USER_DATA       | User data, expects DL ACK          |
| 0x04 | UNCONFIRMED_USER_DATA     | User data, no DL ACK needed        |
| 0x09 | REQUEST_LINK_STATUS       | Ask outstation for link status     |

**Secondary function codes** (outstation to master, PRM=0):

| Code | Name           | Description                      |
|------|----------------|----------------------------------|
| 0x00 | ACK            | Positive acknowledgement         |
| 0x01 | NACK           | Negative acknowledgement         |
| 0x0B | LINK_STATUS    | Response to REQUEST_LINK_STATUS  |
| 0x0F | NOT_SUPPORTED  | Function not supported           |

#### Addresses

- 16-bit little-endian
- Address 0 = default outstation
- Address 1 = typical outstation address
- Address 3 = typical master address
- Address 0xFFFC = self-address (outstation replies with its real address)
- Address 0xFFFE = reserved
- Address 0xFFFF = broadcast (all outstations)

---

### CRC-16 Calculation

DNP3 uses a specific CRC-16 that is **not** the same as CRC-16/CCITT or CRC-16/Modbus.

| Parameter       | Value      |
|-----------------|------------|
| Polynomial      | 0x3D65     |
| Reflected poly  | 0xA6BC     |
| Initial value   | 0x0000     |
| Final XOR       | 0xFFFF (one's complement) |
| Input reflected | Yes (LSB first) |
| Output reflected| Yes        |

The implementation uses a 256-entry lookup table with the reflected polynomial 0xA6BC for speed:

```
table[i] = reflect(poly, i)  for i in 0..255
crc = 0x0000
for each byte b:
    crc = (crc >> 8) ^ table[(crc ^ b) & 0xFF]
return ~crc & 0xFFFF
```

The CRC is stored **little-endian** on the wire (low byte first).

CRC is computed:
1. Over the 8-byte header (bytes 0-7) => stored in bytes 8-9
2. Over each user data block (up to 16 bytes) => appended as 2 bytes after the block

---

### Transport Layer

The transport layer reassembles application-layer messages that span multiple data link frames. Each frame's user data begins with a 1-byte transport header:

```
Bit 7    FIN   Final segment of message
Bit 6    FIR   First segment of message
Bits 5-0 SEQ   Sequence number (0-63, wraps)
```

Single-fragment messages (the common case) have FIR=1, FIN=1 (`0xC0 | seq`).

Multi-fragment reassembly:
1. Wait for FIR=1 segment, note its SEQ
2. Accumulate payload bytes (skip the transport header byte)
3. Expect SEQ to increment by 1 for each subsequent segment
4. FIN=1 marks the last segment

---

### Application Layer

Immediately after the transport header byte, the application layer message begins:

```
Offset  Bytes  Field
------  -----  ------------------------------------------
 0       1     Application Control byte
 1       1     Function Code
 2       2     Internal Indications (IIN) — response only
 4+      var   Object headers + data
```

#### Application Control Byte

```
Bit 7    FIR   First fragment of multi-fragment response
Bit 6    FIN   Final fragment
Bit 5    CON   Confirmation requested
Bit 4    UNS   Unsolicited response
Bits 3-0 SEQ   Sequence number (0-15)
```

Requests typically have FIR=1, FIN=1, CON=0, UNS=0, SEQ=0 (`0xC0`).

#### Function Codes

**Request function codes** (master to outstation):

| Code | Name             | Description                          |
|------|------------------|--------------------------------------|
| 0x00 | CONFIRM          | Application layer confirm            |
| 0x01 | READ             | Read data objects                    |
| 0x02 | WRITE            | Write data objects                   |
| 0x03 | SELECT           | Select control point (SBO step 1)    |
| 0x04 | OPERATE          | Operate control point (SBO step 2)   |
| 0x05 | DIRECT_OPERATE   | Operate without SELECT (no SBO)      |
| 0x06 | DIRECT_OP_NO_ACK | Direct operate, no app-layer ACK     |
| 0x07 | IMMEDIATE_FREEZE | Freeze counters immediately          |
| 0x08 | IMMEDIATE_FREEZE_NO_ACK | Freeze counters, no ACK       |
| 0x09 | FREEZE_CLEAR     | Freeze and clear counters            |
| 0x0D | COLD_RESTART     | Cold restart the outstation          |
| 0x0E | WARM_RESTART     | Warm restart the outstation          |
| 0x14 | ENABLE_UNSOLICITED  | Enable unsolicited responses      |
| 0x15 | DISABLE_UNSOLICITED | Disable unsolicited responses     |
| 0x17 | RECORD_CURRENT_TIME | Record current time               |
| 0x18 | OPEN_FILE        | Open a file                          |
| 0x19 | CLOSE_FILE       | Close a file                         |
| 0x1A | DELETE_FILE      | Delete a file                        |

**Response function codes** (outstation to master):

| Code | Name                    | Description                    |
|------|-------------------------|--------------------------------|
| 0x81 | RESPONSE                | Normal response                |
| 0x82 | UNSOLICITED_RESPONSE    | Unsolicited event data         |
| 0x83 | AUTHENTICATE_RESPONSE   | Secure authentication response |

#### Internal Indications (IIN) -- 2 Bytes

Present only in responses. Two bytes, little-endian, with the following bit meanings:

**IIN1 (first byte, bits 0-7):**

| Bit | Mask   | Name            | Description                          |
|-----|--------|-----------------|--------------------------------------|
| 0   | 0x0001 | All Stations    | Broadcast message received           |
| 1   | 0x0002 | Class 1 Events  | Class 1 event data available         |
| 2   | 0x0004 | Class 2 Events  | Class 2 event data available         |
| 3   | 0x0008 | Class 3 Events  | Class 3 event data available         |
| 4   | 0x0010 | Need Time       | Outstation needs time sync           |
| 5   | 0x0020 | Local Control   | Some points in local/override mode   |
| 6   | 0x0040 | Device Trouble  | Abnormal condition in outstation     |
| 7   | 0x0080 | Device Restart  | Outstation has restarted             |

**IIN2 (second byte, bits 8-15):**

| Bit | Mask   | Name                 | Description                     |
|-----|--------|----------------------|---------------------------------|
| 0   | 0x0100 | No Function Code Sup | Function code not supported     |
| 1   | 0x0200 | Object Unknown       | Requested object is unknown     |
| 2   | 0x0400 | Parameter Error      | Invalid parameter in request    |
| 3   | 0x0800 | Event Buffer Overflow| Event buffer has overflowed     |
| 4   | 0x1000 | Already Executing    | Operation already in progress   |
| 5   | 0x2000 | Config Corrupt       | Outstation configuration error  |
| 6   | 0x4000 | Reserved             |                                 |
| 7   | 0x8000 | Reserved             |                                 |

Error bits (checked after SELECT/OPERATE): 0x0100, 0x0200, 0x0400, 0x1000, 0x2000 (mask `0x3700`).

---

### Object Headers

After the function code (and IIN in responses), the message contains one or more object headers. Each object header is:

```
Offset  Bytes  Field
------  -----  --------------------------------
 0       1     Object Group
 1       1     Object Variation
 2       1     Qualifier byte
 3+      var   Range/count + object data
```

#### Qualifier Byte

```
Bit 7      Reserved (0)
Bits 6-4   Index prefix code
Bits 3-0   Range specifier code
```

**Index prefix codes:**

| Code | Meaning                |
|------|------------------------|
| 0    | No prefix              |
| 1    | 1-byte unsigned index  |
| 2    | 2-byte unsigned index  |
| 3    | 4-byte unsigned index  |

**Range specifier codes:**

| Code | Meaning                                 |
|------|-----------------------------------------|
| 0x00 | 1-byte start/stop range                 |
| 0x01 | 2-byte start/stop range                 |
| 0x02 | 4-byte start/stop range                 |
| 0x06 | All points, no range field (no count)   |
| 0x07 | 1-byte count of objects (with prefix)   |
| 0x08 | 2-byte count of objects (with prefix)   |
| 0x09 | 4-byte count of objects (with prefix)   |
| 0x0B | Variable-length (1-byte count)          |

Common qualifiers:
- `0x06` — All points, used in Class data reads
- `0x17` — 1-byte index prefix, 1-byte count (used for CROB with small index values)
- `0x28` — 2-byte index prefix, 2-byte count (common for CROB operations)

---

## Common Operations

### Class 0 Integrity Poll (Read Static Data)

A Class 0 read retrieves the current (static) state of all data points.

**Request:**

```
Data Link: DIR=1, PRM=1, FC=0x04 (UNCONFIRMED_USER_DATA)
Transport: FIR=1, FIN=1, SEQ=0  (0xC0)
App Control: FIR=1, FIN=1, SEQ=0 (0xC0)
Function Code: 0x01 (READ)
Object Header: Group 60, Var 1, Qualifier 0x06
```

Wire bytes (user data portion, before DL framing):

```
C0 C0 01 3C 01 06
|  |  |  |  |  +-- Qualifier: all points
|  |  |  |  +-- Variation 1 (Class 0)
|  |  |  +-- Group 60 (Class Data)
|  |  +-- Function: READ
|  +-- App Control: FIR+FIN, SEQ=0
+-- Transport: FIR+FIN, SEQ=0
```

**Event class reads** use the same Group 60 with different variations:
- Class 0 (static): Group 60, Variation 1
- Class 1 (events): Group 60, Variation 2
- Class 2 (events): Group 60, Variation 3
- Class 3 (events): Group 60, Variation 4

### Link Status Probe

The safest way to check if an outstation is reachable. Sends a data-link-layer-only frame (no transport or application data).

**Request:**

```
Data Link: DIR=1, PRM=1, FC=0x09 (REQUEST_LINK_STATUS)
Length: 5 (no user data)
```

**Expected response:**

```
Data Link: DIR=0, PRM=0, FC=0x0B (LINK_STATUS)
```

### Select-Before-Operate (SBO)

The two-step control sequence ensures safety by requiring explicit confirmation:

1. **SELECT** (FC 0x03): Master sends the intended control action. Outstation validates and "arms" the point but does not execute.
2. **OPERATE** (FC 0x04): Master sends the same control object. Outstation executes if SELECT was valid and within the timeout.

Both messages must contain identical object data. The application sequence number increments between SELECT and OPERATE.

#### CROB (Control Relay Output Block) -- Group 12, Variation 1

```
Object data (11 bytes per point):
  Control Code  (1 byte)
  Trip/Close Count (1 byte)
  On Time        (4 bytes, LE, milliseconds)
  Off Time       (4 bytes, LE, milliseconds)
  Status         (1 byte, 0 in request, filled by outstation in response)
```

Common control codes:
- `0x01` — Pulse ON
- `0x02` — Pulse OFF
- `0x03` — Latch ON
- `0x04` — Latch OFF
- `0x41` — Pulse ON, close
- `0x81` — Pulse ON, trip

#### Analog Output -- Group 41, Variation 2

16-bit signed integer analog output:

```
Object data (3 bytes per point):
  Value   (2 bytes, LE, int16)
  Status  (1 byte)
```

---

## API Endpoints

### POST `/api/dnp3/connect`

Sends a REQUEST_LINK_STATUS to probe outstation reachability.

**Request body:**

```json
{
  "host": "10.0.1.50",
  "port": 20000,
  "destination": 1,
  "source": 3,
  "timeout": 10000
}
```

All fields except `host` are optional (defaults shown above).

**Response:**

```json
{
  "success": true,
  "message": "DNP3 outstation reachable at 10.0.1.50:20000",
  "host": "10.0.1.50",
  "port": 20000,
  "dataLink": {
    "valid": true,
    "headerCrcValid": true,
    "dataBlockCrcsValid": true,
    "direction": "From Outstation",
    "primary": false,
    "functionCode": 11,
    "functionName": "LINK_STATUS",
    "sourceAddress": 1,
    "destinationAddress": 3,
    "length": 5
  },
  "rawHex": "05 64 05 00 03 00 01 00 ..."
}
```

### POST `/api/dnp3/read`

Sends a READ request for Class 0-3 data.

**Request body:**

```json
{
  "host": "10.0.1.50",
  "port": 20000,
  "destination": 1,
  "source": 3,
  "classNum": 0,
  "timeout": 10000
}
```

`classNum`: 0 = static data, 1-3 = event classes.

**Response** includes `dataLink` and `application` objects with parsed IIN flags and object data hex.

### POST `/api/dnp3/select-operate`

Performs the two-step SBO sequence.

**Request body:**

```json
{
  "host": "10.0.1.50",
  "port": 20000,
  "destination": 1,
  "source": 3,
  "objectGroup": 12,
  "objectVariation": 1,
  "objectIndex": 0,
  "controlCode": 3,
  "timeout": 15000
}
```

Supported object types:
- Group 12, Var 1 -- CROB (binary output control)
- Group 41, Var 2 -- Analog output (16-bit integer)

**Response:**

```json
{
  "success": true,
  "selected": true,
  "operated": true,
  "host": "10.0.1.50",
  "port": 20000,
  "dnpAddress": { "destination": 1, "source": 3 },
  "objectGroup": 12,
  "objectVariation": 1,
  "objectIndex": 0,
  "controlCode": 3,
  "selectResponse": { "functionName": "RESPONSE", "iin": "0x0080", "iinFlags": ["Device Restart"] },
  "operateResponse": { "functionName": "RESPONSE", "iin": "0x0080", "iinFlags": ["Device Restart"] },
  "rtt": 142
}
```

---

## Wire Examples

### Minimal Link Status Request (10 bytes)

```
05 64 05 C9 01 00 03 00 xx xx
|  |  |  |  |     |     |
|  |  |  |  |     |     +-- Header CRC (2 bytes, LE)
|  |  |  |  |     +-- Source: 3
|  |  |  |  +-- Destination: 1
|  |  |  +-- Control: DIR=1, PRM=1, FC=9 (REQUEST_LINK_STATUS)
|  |  +-- Length: 5
|  +-- Start byte 2
+-- Start byte 1
```

### Class 0 Read Request (28 bytes on wire)

```
Header (10 bytes):
  05 64 0B C4 01 00 03 00 xx xx
  Length = 11 (5 + 6 bytes user data)
  Control = 0xC4 = DIR=1, PRM=1, FC=4 (UNCONFIRMED_USER_DATA)

Data block 1 (6 bytes + 2 CRC):
  C0 C0 01 3C 01 06 xx xx
  Transport: 0xC0 (FIR=1, FIN=1, SEQ=0)
  App Control: 0xC0 (FIR=1, FIN=1, SEQ=0)
  Function: 0x01 (READ)
  Group: 60, Var: 1, Qualifier: 0x06
```

---

## Implementation Notes

- The implementation scans for start bytes (0x05 0x64) in the TCP stream to handle leading noise or partial frames.
- Both header and data block CRCs are validated on received frames.
- The `valid` field in responses is `true` only when all CRCs (header and every data block) pass.
- Multi-fragment transport reassembly is not yet implemented; only single-fragment responses are fully parsed.
- The Cloudflare detector prevents connections to Cloudflare-proxied IPs (which would never be real SCADA endpoints).

## References

- IEEE 1815-2012: "IEEE Standard for Electric Power Systems Communications -- Distributed Network Protocol (DNP3)"
- DNP3 Application Note AN2013-004: DNP3 Secure Authentication
- NIST SP 800-82: "Guide to Industrial Control Systems (ICS) Security"
