# S7comm — Power User Reference

**Port:** 102 | **Protocol:** S7comm (Siemens S7 PLC) | **Transport:** TCP → TPKT → COTP → S7

Port of Call implements S7comm for communicating with Siemens S7 PLCs (S7-300, S7-400, S7-1200, S7-1500) in industrial automation and SCADA environments. All three endpoints perform a full connection handshake (COTP Connection Request → S7 Setup Communication) and close cleanly on every call.

---

## API Endpoints

### `POST /api/s7comm/connect` — Connectivity probe and PLC identification

Performs COTP connection, S7 setup communication, and optionally reads the System Status List (SZL ID 0x001C) for CPU identification.

**Request body:**

| Field      | Type   | Default  | Notes |
|------------|--------|----------|-------|
| `host`     | string | required | Hostname, IPv4, or IPv6 (max 253 chars) |
| `port`     | number | `102`    | 1-65535 |
| `rack`     | number | `0`      | 0-7 (rack number in TSAP encoding) |
| `slot`     | number | `2`      | 0-31 (slot number in TSAP encoding) |
| `timeout`  | number | `10000`  | ms |

**Success — S7 connected (200):**
```json
{
  "success": true,
  "host": "plc.example.com",
  "port": 102,
  "rack": 0,
  "slot": 2,
  "cotpConnected": true,
  "s7Connected": true,
  "pduSize": 960,
  "cpuInfo": "6ES7 315-2AH14-0AB0",
  "moduleType": "CPU 315-2 DP",
  "serialNumber": "S C-X4U421302009",
  "plantId": "",
  "copyright": "Original Siemens Equipment"
}
```

**Success — COTP connected but S7 failed (200):**
```json
{
  "success": true,
  "host": "plc.example.com",
  "port": 102,
  "rack": 0,
  "slot": 2,
  "cotpConnected": true,
  "s7Connected": false,
  "error": "S7 setup communication failed"
}
```

**Failure — COTP rejected (502):**
```json
{
  "success": false,
  "host": "plc.example.com",
  "port": 102,
  "rack": 0,
  "slot": 3,
  "cotpConnected": false,
  "error": "COTP connection rejected - check rack/slot configuration"
}
```

- `pduSize` — negotiated PDU size in bytes (240-65535, typically 240-960)
- `cpuInfo` — SZL index 1 (order number / CPU name)
- `moduleType` — SZL index 2 or 7 (module type designation)
- `serialNumber` — SZL index 5 (serial number)
- `plantId` — SZL index 3 (plant identification)
- `copyright` — SZL index 4 (copyright string)

SZL fields are populated on a best-effort basis. If the PLC doesn't support SZL reads (e.g., older S7-200 models) or returns an error, the fields are omitted.

**curl example:**
```bash
curl -X POST https://portofcall.ross.gg/api/s7comm/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10","rack":0,"slot":2}'
```

**curl example — custom timeout and port:**
```bash
curl -X POST https://portofcall.ross.gg/api/s7comm/connect \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "plc.example.com",
    "port": 102,
    "rack": 0,
    "slot": 1,
    "timeout": 15000
  }'
```

---

### `POST /api/s7comm/read` — Read from data block (DB)

Performs COTP connection, S7 setup, then reads bytes from a PLC data block using the S7 ReadVar function (0x04).

**Request body:**

| Field      | Type   | Default  | Notes |
|------------|--------|----------|-------|
| `host`     | string | required | |
| `port`     | number | `102`    | |
| `rack`     | number | `0`      | |
| `slot`     | number | `2`      | |
| `db`       | number | `1`      | Data block number |
| `start`    | number | `0`      | Starting byte offset |
| `length`   | number | `64`     | Bytes to read (max 240 per request) |
| `timeout`  | number | `10000`  | ms |

**Success (200):**
```json
{
  "success": true,
  "host": "192.168.1.10",
  "port": 102,
  "rack": 0,
  "slot": 2,
  "db": 1,
  "startByte": 0,
  "byteCount": 8,
  "hex": "01 23 45 67 89 ab cd ef",
  "bytes": [1, 35, 69, 103, 137, 171, 205, 239],
  "message": "Read 8 bytes from DB1[0..7]"
}
```

**Failure (200):**
```json
{
  "success": false,
  "host": "192.168.1.10",
  "port": 102,
  "rack": 0,
  "slot": 2,
  "db": 999,
  "startByte": 0,
  "byteCount": 0,
  "hex": null,
  "bytes": null,
  "error": "Read failed — check DB number and permissions",
  "message": "DB read failed"
}
```

- `hex` — space-separated hex dump of the read data
- `bytes` — array of byte values (0-255)
- `length` capped at 240 bytes — S7 protocol max per single read varies by PLC model and PDU size

**curl example — read 16 bytes from DB5 starting at offset 100:**
```bash
curl -X POST https://portofcall.ross.gg/api/s7comm/read \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "192.168.1.10",
    "db": 5,
    "start": 100,
    "length": 16
  }'
```

**curl example — read with custom rack/slot:**
```bash
curl -X POST https://portofcall.ross.gg/api/s7comm/read \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "plc.factory.local",
    "rack": 0,
    "slot": 1,
    "db": 10,
    "start": 0,
    "length": 64
  }'
```

---

### `POST /api/s7comm/write` — Write to data block (DB)

Performs COTP connection, S7 setup, then writes bytes to a PLC data block using the S7 WriteVar function (0x05).

**Request body:**

| Field       | Type     | Default  | Notes |
|------------|----------|----------|-------|
| `host`     | string   | required | |
| `port`     | number   | `102`    | |
| `rack`     | number   | `0`      | |
| `slot`     | number   | `2`      | |
| `db`       | number   | required | Data block number |
| `startByte`| number   | `0`      | Starting byte offset |
| `data`     | number[] | required | Array of bytes to write (max 200) |
| `timeout`  | number   | `10000`  | ms |

**Success (200):**
```json
{
  "success": true,
  "host": "192.168.1.10",
  "port": 102,
  "rack": 0,
  "slot": 2,
  "db": 1,
  "startByte": 10,
  "bytesWritten": 4,
  "message": "Wrote 4 bytes to DB1[10..13]"
}
```

**Failure (200):**
```json
{
  "success": false,
  "host": "192.168.1.10",
  "port": 102,
  "rack": 0,
  "slot": 2,
  "db": 1,
  "startByte": 10,
  "bytesWritten": 0,
  "error": "Write failed — check DB number, address, and write permissions",
  "message": "DB write failed"
}
```

- `data` must be an array of integers 0-255
- Max 200 bytes per write (protocol limit varies by PLC model)

**curl example — write 4 bytes to DB1 at offset 10:**
```bash
curl -X POST https://portofcall.ross.gg/api/s7comm/write \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "192.168.1.10",
    "db": 1,
    "startByte": 10,
    "data": [0x01, 0x23, 0x45, 0x67]
  }'
```

**curl example — zero out 8 bytes:**
```bash
curl -X POST https://portofcall.ross.gg/api/s7comm/write \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "plc.factory.local",
    "rack": 0,
    "slot": 1,
    "db": 20,
    "startByte": 0,
    "data": [0, 0, 0, 0, 0, 0, 0, 0]
  }'
```

---

## Wire Protocol Detail

### Protocol Stack

```
TCP (port 102)
  ↓
TPKT (RFC 1006) — 4-byte header with version and length
  ↓
COTP (ISO 8073) — Transport layer (connection-oriented)
  ↓
S7comm — Application layer (Siemens proprietary)
```

### TPKT Header (4 bytes)

```
[Version=3][Reserved=0][Total Length:uint16_be]
```

- Version is always `0x03`
- Total Length includes the 4-byte TPKT header itself

### COTP Connection Request (CR)

```
[Length Indicator][PDU Type=0xE0][Dst Ref:2][Src Ref:2][Class][Parameters...]
```

PDU Type `0xE0` = Connection Request (CR)
PDU Type `0xD0` = Connection Confirm (CC)

**TSAP (Transport Service Access Point) encoding for rack/slot:**

```
Source TSAP: 0x01, 0x00 (client)
Destination TSAP: 0x01, (rack << 5) | slot
```

Example: rack=0, slot=2 → Destination TSAP = `0x01, 0x02`
Example: rack=1, slot=3 → Destination TSAP = `0x01, 0x23` (0x20 + 0x03)

**Full COTP CR packet structure:**

```
[17]              Length indicator (17 bytes follow)
[E0]              PDU type: CR
[00 00]           Destination reference (0 for CR)
[00 01]           Source reference (client-chosen)
[00]              Class 0 (no error recovery)
[C0 01 0A]        Parameter: TPDU size = 1024 (code 0xC0, length 1, value 0x0A)
[C1 02 01 00]     Parameter: Source TSAP (code 0xC1, length 2, value 0x01 0x00)
[C2 02 01 XX]     Parameter: Destination TSAP (code 0xC2, length 2, value 0x01 rack_slot)
```

### COTP Data Transfer (DT)

```
[02]              Length indicator (2 bytes follow)
[F0]              PDU type: DT (Data)
[80]              TPDU number (0) + EOT bit set
```

All S7 messages are wrapped in a COTP DT header.

### S7 Header (10 bytes)

```
[Protocol ID=0x32]          Magic byte (always 0x32)
[Message Type]              0x01=Job, 0x03=Ack_Data, 0x07=Userdata
[Reserved:2]                0x00 0x00
[PDU Reference:2]           Request ID (echoed in response)
[Parameter Length:2]        Length of parameter section
[Data Length:2]             Length of data section
[Error Class]               0x00=no error (in Ack_Data only)
[Error Code]                0x00=no error (in Ack_Data only)
```

### S7 Setup Communication

**Request (Job, Function 0xF0):**

```
[0x32]            Protocol ID
[0x01]            Message type: Job
[0x00 0x00]       Reserved
[0x00 0x00]       PDU reference
[0x00 0x08]       Parameter length (8 bytes)
[0x00 0x00]       Data length (0)
[0xF0]            Function: Setup Communication
[0x00]            Reserved
[0x00 0x01]       Max AmQ calling (concurrent jobs)
[0x00 0x01]       Max AmQ called
[0x03 0xC0]       PDU length: 960 bytes (0x03C0)
```

**Response (Ack_Data):**

```
[0x32]            Protocol ID
[0x03]            Message type: Ack_Data
[0x00 0x00]       Reserved
[0x00 0x00]       PDU reference (echoed)
[0x00 0x08]       Parameter length
[0x00 0x00]       Data length
[0x00]            Error class (0=success)
[0x00]            Error code (0=success)
[0xF0]            Function: Setup Communication
[0x00]            Reserved
[0x00 0x01]       Max AmQ calling (echoed or negotiated)
[0x00 0x01]       Max AmQ called
[0x03 0xC0]       PDU length (negotiated, max 960)
```

The negotiated PDU size is the minimum of client and server proposals. Typical values: 240 (S7-200), 480 (S7-300), 960 (S7-400/1200/1500).

### S7 Read SZL (System Status List)

**Request (Userdata, SZL ID 0x001C = Component Identification):**

```
[0x32]            Protocol ID
[0x07]            Message type: Userdata
[0x00 0x00]       Reserved
[0x00 0x01]       PDU reference
[0x00 0x08]       Parameter length
[0x00 0x08]       Data length
[0x00 0x01 0x12]  Parameter head (Userdata header)
[0x04]            Parameter length
[0x11]            Type: Request
[0x44]            Subfunction group: SZL
[0x01]            Sequence number
[0x00]            Data unit reference
[0xFF]            Return code (0xFF in request)
[0x09]            Transport size: Octet string
[0x00 0x04]       Data length (4 bytes)
[0x00 0x1C]       SZL ID: Component Identification
[0x00 0x00]       SZL Index: All
```

**Response structure:**

```
TPKT + COTP DT + S7 Header (Userdata response) + Parameter + Data
Data section:
  [Return code]
  [Transport size]
  [Length:2]
  [SZL ID:2]
  [SZL Index:2]
  [Record size:2]      Typically 34 bytes
  [Record count:2]     Number of records
  [Records...]         Each record: [Index:2][Text:32 bytes]
```

SZL index meanings for ID 0x001C:
- 1 = Order number / CPU name (e.g., "6ES7 315-2AH14-0AB0")
- 2 = Module type designation (e.g., "CPU 315-2 DP")
- 3 = Plant identification
- 4 = Copyright string
- 5 = Serial number (e.g., "S C-X4U421302009")
- 7 = Module type name

### S7 ReadVar (Read from DB)

**Request (Job, Function 0x04):**

```
[0x32 0x01]       Protocol ID + Job
[0x00 0x00]       Reserved
[0x00 0x02]       PDU reference
[0x00 0x0E]       Parameter length (14 bytes)
[0x00 0x00]       Data length (0)
[0x04]            Function: Read
[0x01]            Item count: 1
[0x12]            Variable specification type
[0x0A]            Specification length (10 bytes)
[0x10]            Syntax ID: S7ANY
[0x02]            Transport size: BYTE
[XX XX]           Length in bytes (uint16_be)
[YY YY]           DB number (uint16_be)
[0x84]            Area code: DB (Data Block)
[ZZ ZZ ZZ]        Start address in bits (uint24_be = byteOffset * 8)
```

**Response (Ack_Data):**

```
S7 Header (0x03 Ack_Data) + Parameter + Data
Parameter section:
  [0x04]          Function: Read
  [0x01]          Item count
Data section:
  [0xFF]          Return code (0xFF=success, 0x0A=object does not exist)
  [0x04]          Transport size: BYTE
  [LL LL]         Data length in bits (uint16_be)
  [Data bytes...] Actual data
```

Return codes:
- `0xFF` = Success
- `0x0A` = Object does not exist (wrong DB number)
- `0x05` = Address out of range
- `0x06` = Data type not supported
- `0x07` = Data type inconsistent

### S7 WriteVar (Write to DB)

**Request (Job, Function 0x05):**

```
[0x32 0x01]       Protocol ID + Job
[0x00 0x00]       Reserved
[0x00 0x04]       PDU reference
[0x00 0x0E]       Parameter length (14 bytes)
[LL LL]           Data length (4 + data bytes, padded to even)
[0x05]            Function: Write
[0x01]            Item count: 1
[Variable spec...] (same as Read: 0x12 0x0A 0x10 ...)
[0xFF]            Return code (0xFF in request)
[0x04]            Transport size: BYTE
[BB BB]           Data length in bits (byteCount * 8)
[Data bytes...]   Actual data (padded to even byte count)
```

**Response (Ack_Data):**

```
S7 Header (0x03 Ack_Data)
Data section:
  [0x05]          Function: Write
  [0x01]          Item count
  [0xFF]          Return code (0xFF=success)
```

---

## Handshake Sequence

```
Client → Server: TPKT + COTP CR (rack/slot in TSAP)
Server → Client: TPKT + COTP CC (connection confirmed)
Client → Server: TPKT + COTP DT + S7 Setup Communication (PDU size proposal)
Server → Client: TPKT + COTP DT + S7 Setup Communication Response (negotiated PDU size)
Client → Server: TPKT + COTP DT + S7 Read SZL (optional, for CPU info)
Server → Client: TPKT + COTP DT + S7 SZL Response (CPU name, serial, etc.)
[Additional read/write operations...]
Client closes TCP connection
```

---

## Endpoint Summary

| Endpoint | Method | Description |
|---|---|---|
| /api/s7comm/connect | POST | Connectivity probe + CPU identification (SZL) |
| /api/s7comm/read | POST | Read bytes from data block (ReadVar) |
| /api/s7comm/write | POST | Write bytes to data block (WriteVar) |

---

## Known Limitations

### No persistent connection

All endpoints open a new TCP connection, perform the operation, and close. There is no connection pooling or session reuse. For high-frequency reads/writes this adds latency (COTP + Setup Communication handshake ~50-100ms per request).

### Read/Write size limits

- **Read:** max 240 bytes per request (hardcoded limit)
- **Write:** max 200 bytes per request (hardcoded limit)

Actual limits depend on the negotiated PDU size (typically 240-960 bytes). The PDU size includes headers, so usable data is smaller. For S7-1200/1500 with PDU=960, you can theoretically read ~900 bytes per request, but the implementation caps reads at 240 bytes to ensure compatibility across all PLC models.

### DB (data block) access only

The `area` field is hardcoded to `0x84` (DB). Other areas are not supported:
- `0x81` = Inputs (I)
- `0x82` = Outputs (Q)
- `0x83` = Flags/Merkers (M)
- `0x1C` = Counters (C)
- `0x1D` = Timers (T)

To read/write I/Q/M areas you need to modify `buildS7ReadDB` / `buildS7WriteDB` to accept an area parameter.

### Byte-level addressing only

S7 supports bit-level addressing (e.g., DB1.DBX0.3 = bit 3 of byte 0). The current implementation only supports byte offsets. Bit manipulation must be done client-side.

### No symbolic addressing

S7 PLCs support symbolic tags (e.g., "MotorSpeed") via the symbol table. This implementation uses absolute addressing only (DB number + byte offset). You must know the PLC memory layout.

### SZL read is best-effort

The `/api/s7comm/connect` endpoint attempts to read SZL ID 0x001C but does not fail if it's unsupported. Older S7-200 PLCs and some S7-1200 configurations reject SZL reads. The endpoint still returns `success: true` with `s7Connected: true` but omits the `cpuInfo` fields.

### No password/authentication

S7comm does not support authentication in the base protocol. Some PLCs have "protection levels" (1-3) that restrict write access, but this is enforced by the PLC firmware, not the protocol. Port of Call sends no authentication tokens.

### No ISO-on-TCP mode

Some PLCs support "ISO-on-TCP" (RFC 1006 with a different COTP negotiation). This implementation assumes standard S7 over TPKT/COTP.

### Error messages are generic

When a read/write fails (return code != 0xFF), the implementation returns a generic "check DB number and permissions" message. The actual S7 error code (0x05 = address out of range, 0x0A = object does not exist) is not parsed or returned to the client.

### No multi-item read/write

The item count is hardcoded to 1. S7 supports batching multiple read/write requests in a single PDU (e.g., read from DB1, DB2, DB3 in one request). This is not implemented.

### Rack/slot validation is strict

Rack must be 0-7, slot must be 0-31. This matches the TSAP encoding (rack << 5 | slot fits in 1 byte). Some PLCs use virtual slot numbers outside this range — not supported.

### No Cloudflare edge case handling for write

While `/api/s7comm/connect` and `/api/s7comm/read` include Cloudflare detection, the `/api/s7comm/write` endpoint also includes it (good). However, the error message is the same for all endpoints.

### TPKT length validation may break fragmented responses

The fix validates that the TPKT length field matches `data.length`. If Cloudflare Workers receive a fragmented TCP stream (unlikely but possible), the validation could reject a partial packet before the full response arrives. This is mitigated by `readTPKTPacket` accumulating chunks with a 500ms timeout.

---

## Resources

- [Siemens S7 Protocol (Wikipedia)](https://en.wikipedia.org/wiki/S7_communication)
- [RFC 1006 — ISO Transport Service on TCP](https://tools.ietf.org/html/rfc1006)
- [ISO 8073 — COTP (Connection-Oriented Transport Protocol)](https://www.iso.org/standard/15269.html)
- [Snap7 Library](http://snap7.sourceforge.net/) — open-source S7 client/server
- [Wireshark S7comm Dissector](https://wiki.wireshark.org/S7comm) — protocol analysis

---

## Security Considerations

### Industrial control system access

S7comm is used in critical infrastructure (power plants, water treatment, manufacturing). Unauthorized access can cause physical damage or safety hazards. Always:
- Use VPNs or firewalls to restrict PLC access
- Enable PLC write protection (protection level 2-3)
- Audit all write operations

### No encryption

S7comm has no built-in encryption or authentication. All traffic is plaintext, including read/write commands. An attacker with network access can:
- Sniff PLC data (sensor readings, setpoints)
- Replay commands (toggle outputs, change timers)
- Modify data in transit (MITM attacks)

Use TLS VPNs or dedicated industrial networks (air-gapped or DMZ).

### TSAP guessing

The TSAP encoding (rack/slot) is public knowledge. An attacker can brute-force rack/slot combinations (8 × 32 = 256 possibilities) to discover active PLCs on port 102. Consider:
- Changing the default port from 102
- Restricting port 102 to known IPs
- Using port knocking or VPN access

### Write operations are irreversible

The `/api/s7comm/write` endpoint has no confirmation dialog or undo. A typo in the `db` or `startByte` parameter can overwrite critical memory (e.g., safety interlocks, setpoints). Always:
- Validate inputs client-side
- Use read-only accounts for monitoring dashboards
- Test write commands against a staging PLC before production
