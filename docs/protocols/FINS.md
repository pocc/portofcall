# Omron FINS/TCP — Power User Reference

## Overview

**FINS** (Factory Interface Network Service) is Omron's proprietary protocol for communication with
CJ, CS, CP, and NX-series PLCs. The FINS/TCP variant wraps FINS command frames inside a TCP
transport layer with a 16-byte header and a mandatory node address handshake before any FINS
commands can be sent.

**Port:** 9600 (default)
**Transport:** Raw TCP (Cloudflare Workers `cloudflare:sockets connect()`)
**Cloudflare detection:** Yes — 403 with `isCloudflare: true` before any TCP attempt
**Safety:** FINS has **no authentication and no encryption**. Write operations directly modify PLC
memory — which controls physical outputs, motor drives, valve positions, and safety interlocks.
Always obtain authorization before writing.

---

## Transport

### FINS/TCP Frame

Every message on the wire (both directions) uses this framing:

```
┌──────────────────────────────────────────────────┐
│ FINS/TCP Header (16 bytes, all big-endian)       │
│   Magic      (4 bytes)  "FINS" = 0x46494E53      │
│   Length     (4 bytes)  bytes from Command onward │
│   Command    (4 bytes)  FINS/TCP command code     │
│   Error Code (4 bytes)  0x00000000 = success      │
├──────────────────────────────────────────────────┤
│ Payload (variable)                               │
│   Depends on FINS/TCP command                    │
└──────────────────────────────────────────────────┘
```

**Length field:** The Length field at offset 4 counts bytes from the **Command field onward**, not
the total frame size. To get total frame size: `Length + 8` (add the 4-byte magic and 4-byte length
field itself). For example, a header-only frame with no payload has Length = 8 (command + error code)
and total wire size = 16 bytes.

### FINS/TCP Commands

| Command      | Value        | Direction       | Description                        |
|--------------|--------------|-----------------|------------------------------------|
| Client Node  | `0x00000000` | Client -> Server | Node address request (handshake)  |
| Server Node  | `0x00000001` | Server -> Client | Node address response (handshake) |
| FINS Frame   | `0x00000002` | Both            | Carries a FINS command/response    |

### FINS/TCP Error Codes

The Error Code field in the FINS/TCP header is a transport-level error indicator. Common values:

| Code           | Meaning                                          |
|----------------|--------------------------------------------------|
| `0x00000000`   | Normal (success)                                 |
| `0x00000001`   | Header is not "FINS"                             |
| `0x00000002`   | Data length too long                             |
| `0x00000003`   | Command not supported                            |
| `0x00000020`   | All connections are in use                       |
| `0x00000021`   | Specified node is already connected              |
| `0x00000022`   | Attempt to access a protected node               |
| `0x00000023`   | Client node address out of range                 |
| `0x00000024`   | Client node address already in use               |
| `0x00000025`   | Server node address out of range                 |

---

## Node Address Handshake

Before sending any FINS commands, the client **must** complete a node address exchange. This assigns
FINS node addresses that will be used in all subsequent FINS command headers.

### Step 1: Client sends Node Address Request

```
FINS/TCP Header:
  Magic:      "FINS"
  Length:      12 (= 4 command + 4 error + 4 payload)
  Command:    0x00000000
  Error Code: 0x00000000

Payload (4 bytes):
  Client Node (4, big-endian): desired node address, or 0 for auto-assign
```

Sending `0x00000000` for the client node asks the PLC to automatically assign a node address.

### Step 2: Server responds with Node Address

```
FINS/TCP Header:
  Magic:      "FINS"
  Length:      16 (= 4 command + 4 error + 8 payload)
  Command:    0x00000001
  Error Code: 0x00000000

Payload (8 bytes):
  Client Node (4, big-endian): assigned client node address
  Server Node (4, big-endian): server's node address
```

Both values are used as DA1/SA1 in all subsequent FINS command frames.

---

## FINS Command Frame

After the handshake, FINS commands are sent inside FINS/TCP frames with command `0x00000002`. The
payload of the FINS/TCP frame is a FINS command frame:

```
┌──────────────────────────────────────────────────┐
│ FINS Command Header (10 bytes)                   │
│   ICF (1)  Information Control Field             │
│   RSV (1)  Reserved (always 0x00)                │
│   GCT (1)  Gateway Count (0x02 = default)        │
│   DNA (1)  Destination Network Address           │
│   DA1 (1)  Destination Node Address              │
│   DA2 (1)  Destination Unit Address              │
│   SNA (1)  Source Network Address                │
│   SA1 (1)  Source Node Address                   │
│   SA2 (1)  Source Unit Address                   │
│   SID (1)  Service ID                            │
├──────────────────────────────────────────────────┤
│ Command Code (2 bytes)                           │
│   MRC (1)  Main Request Code                     │
│   SRC (1)  Sub Request Code                      │
├──────────────────────────────────────────────────┤
│ Command Data (variable)                          │
└──────────────────────────────────────────────────┘
```

### ICF (Information Control Field)

| Bit | Value | Meaning                              |
|-----|-------|--------------------------------------|
| 7   | 1     | Command (0 = response)               |
| 6   | 0     | Response required (1 = not required) |
| 5-0 | 0     | Reserved                             |

Port of Call always sends `0x80` (command, response required).

### GCT (Gateway Count)

Decremented by each gateway hop. Default value is `0x02`, meaning the frame can traverse at most
2 gateways. For local network communication this is sufficient.

### DNA / DA1 / DA2 (Destination Address)

| Field | Description                                                     |
|-------|-----------------------------------------------------------------|
| DNA   | Destination network (0x00 = local network)                      |
| DA1   | Destination node (from handshake `serverNode`)                  |
| DA2   | Destination unit (0x00 = CPU unit, 0xFE = inner board)          |

### SNA / SA1 / SA2 (Source Address)

| Field | Description                                                     |
|-------|-----------------------------------------------------------------|
| SNA   | Source network (0x00 = local network)                           |
| SA1   | Source node (from handshake `clientNode`)                        |
| SA2   | Source unit (0x00 = CPU unit)                                   |

### SID (Service ID)

An arbitrary 1-byte identifier that the server echoes back. Port of Call uses incrementing SIDs
(0x01 for controller reads, 0x02 for memory reads, 0x03 for memory writes).

### FINS Response Frame

The response frame mirrors the command frame but with:
- ICF bit 7 = 0 (response frame)
- After MRC/SRC: two **end code** bytes (MRES/SRES)
- Followed by response data (if any)

```
[10-byte FINS header] [MRC(1)] [SRC(1)] [MRES(1)] [SRES(1)] [Response Data...]
```

---

## FINS Command Codes Used

| MRC  | SRC  | Name                     | Description                            |
|------|------|--------------------------|----------------------------------------|
| 0x01 | 0x01 | Memory Area Read         | Read words from a memory area          |
| 0x01 | 0x02 | Memory Area Write        | Write words to a memory area           |
| 0x05 | 0x01 | Controller Data Read     | Read controller model (ASCII string)   |
| 0x05 | 0x02 | Controller Status Read   | Read run mode, error flags             |

### FINS End Codes (MRES/SRES)

| Code   | Meaning                                              |
|--------|------------------------------------------------------|
| `0000` | Normal completion                                    |
| `0001` | Service was canceled                                 |
| `0101` | Local node not in network                            |
| `0102` | Token timeout                                        |
| `0103` | Retries failed                                       |
| `0104` | Too many send frames                                 |
| `0105` | Node address range error                             |
| `0106` | Node address duplication                             |
| `0401` | Destination address setting error                    |
| `0501` | The command is too long                              |
| `0502` | The command is too short                             |
| `1001` | Area read-only or write-protected                    |
| `1101` | Access right not obtained                            |
| `2002` | Memory area does not exist                           |
| `2003` | No access right                                      |
| `2101` | PLC is in RUN mode (write rejected)                  |
| `2502` | Read-only area                                       |

---

## Memory Areas

Port of Call supports word-level access to these Omron PLC memory areas:

| Name | Code   | Description                                            |
|------|--------|--------------------------------------------------------|
| DM   | `0x82` | Data Memory — general-purpose storage                  |
| CIO  | `0xB0` | Core I/O — physical I/O mapped area                    |
| W    | `0xB1` | Work Area — internal relay area                        |
| H    | `0xB2` | Holding Area — retains state across power cycles       |
| AR   | `0xB3` | Auxiliary Relay — system flags and status               |

All access is **word-level** (16-bit). The `bitPosition` parameter (default `0x00`) is reserved
for bit-level access to individual bits within a word, but the typical use case is word reads/writes
with `bitPosition: 0`.

### Memory Area Read Command Data (after MRC/SRC)

```
Memory Area Code (1 byte)
Begin Address    (2 bytes, big-endian)
Bit Position     (1 byte, 0x00 for word access)
Item Count       (2 bytes, big-endian, 1-500)
```

### Memory Area Read Response Data (after MRES/SRES)

```
Word 0 (2 bytes, big-endian)
Word 1 (2 bytes, big-endian)
...
Word N (2 bytes, big-endian)
```

### Memory Area Write Command Data (after MRC/SRC)

```
Memory Area Code (1 byte)
Begin Address    (2 bytes, big-endian)
Bit Position     (1 byte, 0x00 for word access)
Item Count       (2 bytes, big-endian, 1-500)
Word 0           (2 bytes, big-endian)
Word 1           (2 bytes, big-endian)
...
Word N           (2 bytes, big-endian)
```

### Memory Area Write Response Data (after MRES/SRES)

No additional data beyond the end codes.

---

## Endpoints

### POST /api/fins/connect

Connectivity probe. Performs the FINS/TCP node address handshake, then attempts to read the
controller model (command 0501) and controller status (command 0502). Returns `success: true` if
the handshake completes even if the controller read commands fail.

**Request**
```json
{
  "host":       "192.168.1.10",
  "port":       9600,
  "timeout":    10000,
  "clientNode": 0
}
```

| Field        | Type    | Default | Description                                    |
|--------------|---------|---------|------------------------------------------------|
| `host`       | string  | --      | **Required.** PLC hostname or IP address       |
| `port`       | integer | 9600    | TCP port                                       |
| `timeout`    | integer | 10000   | Connection + command timeout in ms             |
| `clientNode` | integer | 0       | Desired client node (0 = auto-assign)          |

**Response -- handshake succeeded, controller read succeeded**
```json
{
  "success": true,
  "host": "192.168.1.10",
  "port": 9600,
  "rtt": 45,
  "connectTime": 12,
  "serverNode": 1,
  "clientNode": 10,
  "controllerInfo": {
    "model": "CJ2M-CPU31",
    "mode": "Run",
    "fatalError": false,
    "nonFatalError": false
  }
}
```

**Response -- handshake succeeded, controller read failed**
```json
{
  "success": true,
  "host": "192.168.1.10",
  "port": 9600,
  "rtt": 30,
  "connectTime": 8,
  "serverNode": 1,
  "clientNode": 10
}
```

| Field            | Type    | Description                                              |
|------------------|---------|----------------------------------------------------------|
| `connectTime`    | integer | TCP connection time in ms (before FINS handshake)        |
| `rtt`            | integer | Total round-trip time from connection start to last response |
| `serverNode`     | integer | FINS node address assigned to the PLC                    |
| `clientNode`     | integer | FINS node address assigned to this client                |
| `controllerInfo` | object  | Present only if controller data read succeeded           |

**Controller Info fields:**

| Field           | Type    | Description                                         |
|-----------------|---------|-----------------------------------------------------|
| `model`         | string  | ASCII model string (e.g., "CJ2M-CPU31")            |
| `mode`          | string  | "Program", "Monitor", "Run", or "Unknown (0xNN)"   |
| `fatalError`    | boolean | PLC has a fatal error flag set                      |
| `nonFatalError` | boolean | PLC has a non-fatal error flag set                  |

---

### POST /api/fins/memory-read

Reads consecutive words from a PLC memory area. Performs the FINS/TCP handshake, then sends a
Memory Area Read command (MRC=0x01, SRC=0x01).

**Request**
```json
{
  "host":        "192.168.1.10",
  "port":        9600,
  "timeout":     10000,
  "memoryArea":  "DM",
  "address":     100,
  "bitPosition": 0,
  "itemCount":   10
}
```

| Field         | Type    | Default | Description                                       |
|---------------|---------|---------|---------------------------------------------------|
| `host`        | string  | --      | **Required.** PLC hostname or IP                  |
| `port`        | integer | 9600    | TCP port                                          |
| `timeout`     | integer | 10000   | Timeout in ms                                     |
| `memoryArea`  | string  | --      | **Required.** One of: `DM`, `CIO`, `W`, `H`, `AR` |
| `address`     | integer | --      | **Required.** Starting word address (0--65535)     |
| `bitPosition` | integer | 0       | Bit position within word (0x00 for word access)   |
| `itemCount`   | integer | 1       | Number of words to read (1--500)                  |

**Response -- success**
```json
{
  "success": true,
  "host": "192.168.1.10",
  "port": 9600,
  "memoryArea": "DM",
  "memoryAreaCode": "0x82",
  "address": 100,
  "bitPosition": 0,
  "itemCount": 10,
  "data": [0, 1234, 5678, 0, 0, 42, 0, 0, 0, 100],
  "hex": ["0x0000", "0x04D2", "0x162E", "0x0000", "0x0000", "0x002A", "0x0000", "0x0000", "0x0000", "0x0064"],
  "rtt": 35
}
```

| Field            | Type     | Description                                           |
|------------------|----------|-------------------------------------------------------|
| `memoryArea`     | string   | Echoed back, uppercase                                |
| `memoryAreaCode` | string   | Hex code for the memory area (e.g., `"0x82"`)         |
| `data`           | number[] | Array of 16-bit unsigned integers (decimal)           |
| `hex`            | string[] | Same values in hex notation (e.g., `"0x04D2"`)        |
| `rtt`            | integer  | Total round-trip time in ms                           |

**Response -- FINS end code error**
```json
{
  "success": false,
  "host": "192.168.1.10",
  "port": 9600,
  "memoryArea": "DM",
  "address": 99999,
  "itemCount": 1,
  "rtt": 28,
  "endCode": "2002",
  "error": "FINS end code error: 2002"
}
```

---

### POST /api/fins/memory-write

Writes consecutive words to a PLC memory area. Performs the FINS/TCP handshake, then sends a
Memory Area Write command (MRC=0x01, SRC=0x02).

**Request**
```json
{
  "host":        "192.168.1.10",
  "port":        9600,
  "timeout":     10000,
  "memoryArea":  "DM",
  "address":     100,
  "bitPosition": 0,
  "words":       [1234, 5678, 42]
}
```

| Field         | Type     | Default | Description                                      |
|---------------|----------|---------|--------------------------------------------------|
| `host`        | string   | --      | **Required.** PLC hostname or IP                 |
| `port`        | integer  | 9600    | TCP port                                         |
| `timeout`     | integer  | 10000   | Timeout in ms                                    |
| `memoryArea`  | string   | --      | **Required.** One of: `DM`, `CIO`, `W`, `H`, `AR` |
| `address`     | integer  | --      | **Required.** Starting word address (0--65535)    |
| `bitPosition` | integer  | 0       | Bit position (0x00 for word access)              |
| `words`       | number[] | --      | **Required.** 16-bit values to write (1--500)     |

Each word must be 0--65535. Values outside this range are rejected with HTTP 400.

**Response -- success**
```json
{
  "success": true,
  "host": "192.168.1.10",
  "port": 9600,
  "memoryArea": "DM",
  "memoryAreaCode": "0x82",
  "address": 100,
  "bitPosition": 0,
  "wordCount": 3,
  "words": ["0x04D2", "0x162E", "0x002A"],
  "endCode": "0000",
  "rtt": 38
}
```

**Response -- write rejected**
```json
{
  "success": false,
  "host": "192.168.1.10",
  "port": 9600,
  "memoryArea": "DM",
  "memoryAreaCode": "0x82",
  "address": 100,
  "bitPosition": 0,
  "wordCount": 3,
  "words": ["0x04D2", "0x162E", "0x002A"],
  "endCode": "2101",
  "rtt": 32,
  "error": "FINS end code error: 2101"
}
```

---

## Timeout Architecture

Each endpoint has **two** timeout layers:

| Layer | Description                                                                          |
|-------|--------------------------------------------------------------------------------------|
| Inner | Per-frame read timeout passed to `readFINSFrame()` via a `Promise.race` with timeout |
| Outer | `Promise.race` around the entire connection + handshake + command sequence            |

Both use the same `timeout` value (default 10000 ms). The outer timeout catches cases where the
inner timeout's rejection is delayed (e.g., the socket `opened` promise hangs).

---

## Connection Lifecycle

Every endpoint follows this sequence:

1. **TCP connect** to `host:port` via `cloudflare:sockets`
2. **Node address handshake** (command 0x00000000 / 0x00000001)
3. **FINS command(s)** wrapped in FINS/TCP frames (command 0x00000002)
4. **Close** the socket

There is no connection reuse or keep-alive. Each API call opens a fresh TCP connection and performs
a new handshake. This is typical for FINS/TCP -- Omron PLCs support a limited number of concurrent
FINS/TCP connections (often 8-16 depending on model).

---

## curl Examples

### Connectivity check (discover PLC model)
```bash
curl -s -X POST https://portofcall.ross.gg/api/fins/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10"}' | jq .
```

### Read 10 words from DM area starting at address 100
```bash
curl -s -X POST https://portofcall.ross.gg/api/fins/memory-read \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10","memoryArea":"DM","address":100,"itemCount":10}' | jq .
```

### Read CIO area (physical I/O status)
```bash
curl -s -X POST https://portofcall.ross.gg/api/fins/memory-read \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10","memoryArea":"CIO","address":0,"itemCount":20}' | jq .
```

### Write three words to DM area
```bash
curl -s -X POST https://portofcall.ross.gg/api/fins/memory-write \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10","memoryArea":"DM","address":100,"words":[1234,5678,42]}' | jq .
```

### Non-default port with custom timeout
```bash
curl -s -X POST https://portofcall.ross.gg/api/fins/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.50","port":9601,"timeout":5000}' | jq .
```

### Specify client node address
```bash
curl -s -X POST https://portofcall.ross.gg/api/fins/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10","clientNode":10}' | jq .
```

---

## Power User Notes

### Node address auto-assignment

Sending `clientNode: 0` (the default) asks the PLC to auto-assign a node address. The PLC
typically derives the node from the last octet of the client's IP address. If you are behind NAT or
a proxy (as Cloudflare Workers are), the auto-assigned node may not match expectations. You can
override this with `clientNode: 10` (or any value 1-254).

### Connection limits

Omron PLCs have a hard limit on concurrent FINS/TCP connections (typically 8 for CJ2M, 16 for
NJ/NX). Each Port of Call API call consumes one connection for the duration of the request. If the
PLC runs out of connections, you will see FINS/TCP error `0x00000020` ("All connections are in use").

### Memory area addressing

Omron uses 0-based word addresses. DM0 = address 0, DM100 = address 100. CX-Programmer and
Sysmac Studio display the same 0-based addresses, so there is no off-by-one confusion (unlike
Modbus).

### 32-bit values spanning two words

PLC programs often store 32-bit integers or floats across two consecutive DM words. Read with
`itemCount: 2` and reassemble:

```js
const [hi, lo] = data;
const int32 = (hi << 16) | lo;
// Or for float:
const buf = new ArrayBuffer(4);
const view = new DataView(buf);
view.setUint16(0, hi); view.setUint16(2, lo);
const float32 = view.getFloat32(0, false);
```

Word order is big-endian (high word first) by Omron convention.

### Controller status mode values

The Controller Status Read (0502) response byte encodes the PLC run mode in the upper nibble:

| Upper nibble | Mode    |
|-------------|---------|
| 0x0         | Program |
| 0x2         | Monitor |
| 0x4         | Run     |

Lower nibble bit 0 = fatal error flag, bit 1 = non-fatal error flag.

### Item count limits

The FINS protocol allows reading or writing up to 999 words in a single command, but Port of Call
limits this to **500 words** to stay within reasonable TCP payload sizes. For larger transfers,
issue multiple sequential requests.

### What Port of Call does NOT implement

- **FINS/UDP** -- FINS over UDP with its own framing (commonly used in CJ1/CS1 series)
- **Multiple FINS commands per connection** -- only one command (plus handshake) per connection
- **FINS routing through gateways** -- DNA/SNA are hardcoded to 0x00 (local network)
- **Bit-level access** -- bitPosition is accepted but word-level access (bitPosition=0) is typical
- **Memory Area Fill** (MRC 0x01, SRC 0x03)
- **Memory Area Transfer** (MRC 0x01, SRC 0x05)
- **Run/Stop commands** (MRC 0x04, SRC 0x01/0x02)
- **File operations** (MRC 0x06)
- **Clock Read/Write** (MRC 0x07)
- **Error Read/Clear** (MRC 0x21)

---

## Local Testing

```bash
# Using fins-server (Python Omron FINS simulator)
pip install omron-fins
python -c "
from fins.server import FINSServer
server = FINSServer('0.0.0.0', 9600)
server.serve_forever()
"

# Or using a Docker-based PLC simulator if available
docker run -d -p 9600:9600 omron-fins-simulator
```

---

## Wire Examples

### Node address request (20 bytes on wire)
```
46 49 4E 53    # Magic: "FINS"
00 00 00 0C    # Length: 12 (4 cmd + 4 err + 4 payload)
00 00 00 00    # Command: Client Node Address Data Send
00 00 00 00    # Error Code: 0
00 00 00 00    # Client Node: 0 (auto-assign)
```

### Node address response (24 bytes on wire)
```
46 49 4E 53    # Magic: "FINS"
00 00 00 10    # Length: 16 (4 cmd + 4 err + 8 payload)
00 00 00 01    # Command: Server Node Address Data Send
00 00 00 00    # Error Code: 0
00 00 00 0A    # Client Node: 10
00 00 00 01    # Server Node: 1
```

### Memory Area Read command (DM100, 10 words) (34 bytes on wire)
```
46 49 4E 53    # Magic: "FINS"
00 00 00 1A    # Length: 26 (4 cmd + 4 err + 18 FINS frame)
00 00 00 02    # Command: FINS Frame Send
00 00 00 00    # Error Code: 0
80 00 02       # ICF=0x80 RSV=0x00 GCT=0x02
00 01 00       # DNA=0x00 DA1=0x01 DA2=0x00
00 0A 00       # SNA=0x00 SA1=0x0A SA2=0x00
02             # SID=0x02
01 01          # MRC=0x01 SRC=0x01 (Memory Area Read)
82             # Memory Area: DM (0x82)
00 64          # Address: 100
00             # Bit Position: 0
00 0A          # Item Count: 10
```

---

## Resources

- [Omron W342-E1-17 FINS Commands Reference Manual](https://www.fa.omron.co.jp/data_pdf/cat/w342-e1-17.pdf) -- the definitive FINS protocol specification
- [Omron W421-E1 Communications Commands Reference Manual](https://www.fa.omron.co.jp/data_pdf/cat/w421-e1.pdf) -- CJ/CS-series specific extensions
- [CX-Protocol documentation](https://www.fa.omron.co.jp/data_pdf/cat/v091-e1.pdf) -- Omron's protocol analysis tool reference
