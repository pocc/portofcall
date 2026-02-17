# Modbus TCP — Power User Reference

## Overview

**Modbus TCP** wraps the classic Modbus application layer (originally RS-232/RS-485) inside a TCP
stream using a 7-byte MBAP header. It is the dominant protocol for industrial PLCs, SCADA systems,
sensors, and building automation controllers.

**Port:** 502 (default); embedded systems often use non-standard ports  
**Transport:** Raw TCP (Cloudflare Workers `cloudflare:sockets connect()`)  
**Cloudflare detection:** Yes — 403 with `isCloudflare: true` before any TCP attempt  
**Safety:** Modbus has **no authentication and no encryption**. Write operations directly actuate
physical devices. Always obtain authorization before writing.

---

## Transport

All four endpoints open a raw TCP socket, send one Modbus TCP request frame, read one response
frame, then close the connection. There is no persistent connection or session.

### Modbus TCP Frame

```
┌──────────────────────────────────────────────────┐
│ MBAP Header (7 bytes)                            │
│   Transaction ID (2, big-endian)                 │
│   Protocol ID   (2, big-endian, always 0x0000)   │
│   Length        (2, big-endian) = PDU length     │
│   Unit ID       (1)                              │
├──────────────────────────────────────────────────┤
│ PDU (Protocol Data Unit)                         │
│   Function Code (1 byte)                         │
│   Data          (variable)                       │
└──────────────────────────────────────────────────┘
```

The Length field in the MBAP header counts bytes from Unit ID through end of PDU (i.e.
`1 + 1 + len(data)` = unitId byte + function code + data). The total frame is `7 + pduLength`.

### Transaction ID

The implementation uses a **module-level counter** (`transactionCounter`) that increments by 1 on
every request and wraps at 0xFFFF. This counter is shared across all concurrent requests — if you
need to correlate a response to a specific request, check that the response Transaction ID matches
what was sent. The server echoes the Transaction ID back verbatim.

### Exception Responses

Any server-side error is returned as a Modbus exception. The exception frame sets the high bit of
the Function Code:

```
Byte 7: Function Code | 0x80   (e.g. 0x81 for FC 0x01 exception)
Byte 8: Exception Code
```

| Exception Code | Name                | Meaning                                      |
|----------------|---------------------|----------------------------------------------|
| 0x01           | Illegal Function    | FC not supported by this device              |
| 0x02           | Illegal Data Address| Address out of range for this device         |
| 0x03           | Illegal Data Value  | Value rejected (range/format error)          |
| 0x04           | Server Device Failure | PLC internal error                         |
| 0x05           | Acknowledge         | Long operation in progress; retry later      |
| 0x06           | Server Device Busy  | Device cannot accept request right now       |

---

## Endpoints

### POST /api/modbus/connect

Connectivity probe. Sends FC 0x03 (Read Holding Registers) for address 0, quantity 1. Returns
`success: true` even if the server responds with a Modbus exception — a Modbus exception means
the server is reachable and speaking Modbus. Only a TCP-level failure returns `success: false`.

**Request**
```json
{
  "host":    "plc.factory.local",
  "port":    502,
  "unitId":  1,
  "timeout": 10000
}
```

| Field     | Type    | Default | Description                                    |
|-----------|---------|---------|------------------------------------------------|
| `host`    | string  | —       | **Required.** PLC/device hostname or IP        |
| `port`    | integer | 502     | TCP port                                       |
| `unitId`  | integer | 1       | Modbus Unit ID (slave address, 1–247)          |
| `timeout` | integer | 10000   | Outer connection timeout in ms                 |

**Response — server reachable, register readable**
```json
{
  "success": true,
  "message": "Modbus server reachable",
  "host": "plc.factory.local",
  "port": 502,
  "unitId": 1,
  "testRegister": 42
}
```

**Response — server reachable, but returned exception**
```json
{
  "success": true,
  "message": "Modbus server reachable (responded with exception)",
  "host": "plc.factory.local",
  "port": 502,
  "unitId": 1,
  "exception": "Illegal Data Address"
}
```

**Response — TCP connection failed (500)**
```json
{
  "success": false,
  "error": "Connection timeout"
}
```

> **Note:** An `"Illegal Data Address"` exception just means address 0 doesn't exist on this
> device. The device is still reachable. Use `/api/modbus/read` to probe specific addresses.

---

### POST /api/modbus/read

Sends any **read-only** Modbus function code (0x01–0x04). Write function codes are rejected with
HTTP 400 before any TCP connection is made.

**Request**
```json
{
  "host":         "plc.factory.local",
  "port":         502,
  "unitId":       1,
  "functionCode": 3,
  "address":      0,
  "quantity":     10,
  "timeout":      10000
}
```

| Field          | Type    | Default | Description                                          |
|----------------|---------|---------|------------------------------------------------------|
| `host`         | string  | —       | **Required.**                                        |
| `port`         | integer | 502     |                                                      |
| `unitId`       | integer | 1       | Modbus Unit ID / slave address                       |
| `functionCode` | integer | —       | **Required.** 1, 2, 3, or 4 (see table below)       |
| `address`      | integer | —       | **Required.** Starting register/coil address (0-based) |
| `quantity`     | integer | 1       | Number of items to read (see limits below)           |
| `timeout`      | integer | 10000   | Outer timeout in ms                                  |

**Allowed function codes for /read:**

| FC   | Name                     | Data type | `format`    | Max quantity |
|------|--------------------------|-----------|-------------|--------------|
| 0x01 | Read Coils               | Outputs   | `"coils"`   | 2000         |
| 0x02 | Read Discrete Inputs     | Inputs    | `"coils"`   | 2000         |
| 0x03 | Read Holding Registers   | Outputs   | `"registers"` | 125        |
| 0x04 | Read Input Registers     | Inputs    | `"registers"` | 125        |

Passing FC 0x05, 0x06, or 0x10 returns HTTP 400 with
`"Invalid read function code: …"`.

**Response — success (coils)**
```json
{
  "success": true,
  "host": "plc.factory.local",
  "port": 502,
  "unitId": 1,
  "functionCode": 1,
  "functionName": "READ_COILS",
  "address": 0,
  "quantity": 16,
  "format": "coils",
  "values": [true, false, true, true, false, false, false, false,
             false, false, false, false, false, false, false, false]
}
```

**Response — success (registers)**
```json
{
  "success": true,
  "host": "plc.factory.local",
  "port": 502,
  "unitId": 1,
  "functionCode": 3,
  "functionName": "READ_HOLDING_REGISTERS",
  "address": 100,
  "quantity": 5,
  "format": "registers",
  "values": [1234, 0, 65535, 42, 7]
}
```

**Response — Modbus exception**
```json
{
  "success": false,
  "error": "Modbus exception: Illegal Data Address (code 0x2)",
  "functionCode": 3,
  "address": 9999,
  "quantity": 1
}
```

| Field          | Type     | Description                                              |
|----------------|----------|----------------------------------------------------------|
| `functionName` | string   | Human-readable FC name from the FC lookup table          |
| `format`       | string   | `"coils"` (boolean[]) or `"registers"` (number[])        |
| `values`       | array    | Boolean array for coils; unsigned 16-bit integers for registers |

**Coil wire encoding:** The response data byte count is in byte 8; coils follow LSB-first within
each byte. Bit 0 of byte 9 = coil at `address`, bit 1 = `address+1`, etc.

**Register wire encoding:** Big-endian 16-bit unsigned integers. Each register is 2 bytes. The
`values` array contains the interpreted decimal values (0–65535).

---

### POST /api/modbus/write/coil

Writes a single coil (discrete output) using FC 0x05. The server echoes back the address and
coil value to confirm the write.

**Request**
```json
{
  "host":    "plc.factory.local",
  "port":    502,
  "unitId":  1,
  "address": 17,
  "value":   true,
  "timeout": 5000
}
```

| Field     | Type             | Default | Description                                       |
|-----------|------------------|---------|---------------------------------------------------|
| `host`    | string           | —       | **Required.**                                     |
| `port`    | integer          | 502     |                                                   |
| `unitId`  | integer          | 1       |                                                   |
| `address` | integer          | —       | **Required.** Coil address (0-based)              |
| `value`   | boolean \| 0 \| 1 | —     | **Required.** `true`/`1` = ON, `false`/`0` = OFF |
| `timeout` | integer          | 5000    | Outer timeout in ms (note: default is 5 s, not 10 s) |

**Wire encoding of value:** `true` or `1` → `0xFF00`; `false` or `0` → `0x0000`. These are the
only two valid values per the Modbus spec; any other value is an Illegal Data Value.

**Response — success**
```json
{
  "success": true,
  "host": "plc.factory.local",
  "port": 502,
  "unitId": 1,
  "address": 17,
  "coilValue": 65280,
  "written": true,
  "rtt": 12
}
```

| Field       | Type    | Description                                                   |
|-------------|---------|---------------------------------------------------------------|
| `address`   | integer | Echo of the coil address from the server response             |
| `coilValue` | integer | Raw 16-bit echo: 65280 (0xFF00) = ON, 0 = OFF                |
| `written`   | boolean | `true` if `coilValue === 0xFF00` (coil set ON)               |
| `rtt`       | integer | Round-trip time from socket open to response received (ms)    |

---

### POST /api/modbus/write/registers

Writes one or more consecutive holding registers using FC 0x10 (Write Multiple Registers).
Each register is a 16-bit unsigned integer (0–65535). Maximum 123 registers per request.

**Request**
```json
{
  "host":    "plc.factory.local",
  "port":    502,
  "unitId":  1,
  "address": 100,
  "values":  [1000, 2000, 3000],
  "timeout": 5000
}
```

| Field     | Type      | Default | Description                                             |
|-----------|-----------|---------|---------------------------------------------------------|
| `host`    | string    | —       | **Required.**                                           |
| `port`    | integer   | 502     |                                                         |
| `unitId`  | integer   | 1       |                                                         |
| `address` | integer   | —       | **Required.** Starting register address (0-based)       |
| `values`  | number[]  | —       | **Required.** 16-bit values to write (max 123 elements) |
| `timeout` | integer   | 5000    | Outer timeout in ms (default is 5 s, not 10 s)         |

**Wire encoding:** Each value is packed big-endian into 2 bytes. The frame includes a byte count
(`quantity * 2`) followed by the register values. Values outside 0–65535 will be truncated by the
bit operations.

**Response — success**
```json
{
  "success": true,
  "host": "plc.factory.local",
  "port": 502,
  "unitId": 1,
  "startAddress": 100,
  "quantity": 3,
  "rtt": 14
}
```

| Field          | Type    | Description                                          |
|----------------|---------|------------------------------------------------------|
| `startAddress` | integer | Echo of the start address from the server response   |
| `quantity`     | integer | Echo of the number of registers written              |
| `rtt`          | integer | Round-trip time (ms)                                 |

---

## Modbus Data Model

| Object type          | FC read | FC write | Max read qty | Address space |
|----------------------|---------|----------|--------------|---------------|
| Coils (digital out)  | 0x01    | 0x05     | 2000         | 0–65535       |
| Discrete Inputs (in) | 0x02    | —        | 2000         | 0–65535       |
| Holding Registers    | 0x03    | 0x06/0x10| 125          | 0–65535       |
| Input Registers      | 0x04    | —        | 125          | 0–65535       |

Port of Call does **not** implement FC 0x06 (Write Single Register). Use
`/api/modbus/write/registers` with a single-element `values` array instead:

```json
{ "address": 5, "values": [1234] }
```

---

## Timeout Architecture

Each endpoint has **two** timeout layers:

| Layer | Parameter | Default | Behavior |
|-------|-----------|---------|----------|
| Outer | `timeout` | 10 s (connect, read) / 5 s (write) | Wraps the entire TCP open + send + receive |
| Inner | Hardcoded | 5 s | Passed to `readModbusResponse(reader, 5000)` — applies to the stream read loop only |

For write operations, the outer timeout defaults to **5000 ms** (not 10000). If you set `timeout`
lower than 5000 on a write, the inner 5 s read timeout will still apply — the outer timeout would
fire first. Setting `timeout: 3000` on a write effectively applies a 3 s outer limit.

---

## curl Examples

### Connectivity check
```bash
curl -s -X POST https://portofcall.ross.gg/api/modbus/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"plc.factory.local","unitId":1}' | jq .
```

### Read 10 holding registers from address 100
```bash
curl -s -X POST https://portofcall.ross.gg/api/modbus/read \
  -H 'Content-Type: application/json' \
  -d '{"host":"plc.factory.local","functionCode":3,"address":100,"quantity":10}' | jq .
```

### Read 16 coils from address 0
```bash
curl -s -X POST https://portofcall.ross.gg/api/modbus/read \
  -H 'Content-Type: application/json' \
  -d '{"host":"plc.factory.local","functionCode":1,"address":0,"quantity":16}' | jq .values
```

### Write coil ON at address 17
```bash
curl -s -X POST https://portofcall.ross.gg/api/modbus/write/coil \
  -H 'Content-Type: application/json' \
  -d '{"host":"plc.factory.local","address":17,"value":true}' | jq .
```

### Write three registers starting at address 100
```bash
curl -s -X POST https://portofcall.ross.gg/api/modbus/write/registers \
  -H 'Content-Type: application/json' \
  -d '{"host":"plc.factory.local","address":100,"values":[1000,2000,3000]}' | jq .
```

### Non-standard port (common on embedded systems)
```bash
curl -s -X POST https://portofcall.ross.gg/api/modbus/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.50","port":5020,"unitId":3}' | jq .
```

---

## Power User Notes

### Addressing conventions

Modbus has two address conventions that cause constant confusion:

| Convention        | Register 1 | Register 100 | Description                           |
|-------------------|------------|--------------|---------------------------------------|
| **Port of Call**  | `address: 0` | `address: 99` | **0-based** (PDU addressing)         |
| Classic Modicon   | 40001      | 40100        | 1-based with type prefix (4xxxx = holding) |
| Some HMI tools    | 1          | 100          | 1-based without prefix               |

Port of Call uses **0-based PDU addressing** directly. If your device documentation shows register
40001, send `address: 0`. If it shows 40100, send `address: 99`.

### Scanning device register maps

You can binary-search for valid address ranges by exploiting exception code 0x02 (Illegal Data
Address). Start with a coarse scan to find where the device responds, then narrow:

```bash
# Check if addresses 0-9 exist (FC 0x03, qty 10)
curl -s -X POST .../api/modbus/read \
  -d '{"host":"192.168.1.50","functionCode":3,"address":0,"quantity":10}'
# If "Illegal Data Address" → try narrower ranges
curl -s -X POST .../api/modbus/read \
  -d '{"host":"192.168.1.50","functionCode":3,"address":0,"quantity":1}'
```

### Unit ID (slave address)

In Modbus TCP, the Unit ID is often ignored by TCP-native devices (they have only one slave), but
it is critical for:

- **Modbus TCP-to-RTU gateways**: gateway proxies requests to the correct serial slave device
- **Multi-drop serial behind a gateway**: Unit IDs map to physical devices on the RS-485 bus
- **Multi-tenant PLCs**: some devices implement multiple unit IDs for virtual partitions

Default is 1. Use 0 for broadcast (no response expected). Some gateways use 255 as a wildcard.

### Reading 32-bit values

Holding registers are 16-bit. A 32-bit float or integer spans two consecutive registers. Read with
`quantity: 2` and reassemble in the client:

```js
const [hi, lo] = values; // big-endian word order
const int32 = (hi << 16) | lo;
// or for float:
const buf = new ArrayBuffer(4);
const view = new DataView(buf);
view.setUint16(0, hi); view.setUint16(2, lo);
const float = view.getFloat32(0, false); // big-endian
```

Word order varies by device: some use little-endian word order (lo before hi) — check the device
manual.

### `functionName` in read responses

The `functionName` field returns the internal constant name (e.g. `"READ_HOLDING_REGISTERS"`).
This is from the `FUNCTION_CODES` lookup in the implementation and will be `undefined` if the
value is not found (shouldn't happen for the four allowed codes).

### Connection test exception vs. TCP failure

`/api/modbus/connect` returns HTTP 200 with `success: true` even when the PLC rejects the
register read. This is intentional — the goal is reachability, not data access. Only a TCP-level
failure (host unreachable, connection refused, timeout) returns HTTP 500 with `success: false`.

### What Port of Call does NOT implement

- **FC 0x06** (Write Single Register) — use `/write/registers` with a single-element array
- **FC 0x0F** (Write Multiple Coils) — no endpoint exists
- **FC 0x08** (Diagnostics) — sub-functions like echo test, counter reset
- **FC 0x11** (Report Server ID) — device identification
- **FC 0x2B** (Read Device Identification) — MEI transport extensions
- **FC 0x17** (Read/Write Multiple Registers) — combined read/write in one frame
- **Modbus RTU/ASCII** — serial framing (CRC/LRC); only TCP is supported
- **Multi-request pipelining** — one request per TCP connection
- **Persistent connections** — each endpoint opens and closes its own socket

---

## Local Testing

```bash
# Run a Modbus TCP simulator
docker run -d -p 502:502 oitc/modbus-server

# Or with diagslave (requires license for write operations)
# Or using pymodbus:
pip install pymodbus
python -c "
from pymodbus.server import StartTcpServer
from pymodbus.datastore import ModbusSlaveContext, ModbusServerContext, ModbusSequentialDataBlock
store = ModbusSlaveContext(
  di=ModbusSequentialDataBlock(0, [0]*100),
  co=ModbusSequentialDataBlock(0, [0]*100),
  hr=ModbusSequentialDataBlock(0, list(range(100))),
  ir=ModbusSequentialDataBlock(0, list(range(100))),
)
StartTcpServer(ModbusServerContext(store, single=True), address=('0.0.0.0', 502))
"
```

---

## Resources

- [Modbus Application Protocol Specification v1.1b3](http://www.modbus.org/docs/Modbus_Application_Protocol_V1_1b3.pdf)
- [Modbus Messaging on TCP/IP Implementation Guide v1.0b](http://www.modbus.org/docs/Modbus_Messaging_Implementation_Guide_V1_0b.pdf)
- [RFC 863 (Discard)](https://datatracker.ietf.org/doc/html/rfc863) — not Modbus, but Port 9 discard is a simple connectivity test if Modbus is not available
