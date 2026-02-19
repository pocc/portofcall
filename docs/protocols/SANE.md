# SANE (Scanner Access Now Easy) Protocol — Power-User Documentation

## Overview

**SANE** is the standard scanner access framework on Linux/Unix systems. The SANE network protocol enables remote scanner access over TCP, allowing clients to discover, configure, and control scanners connected to a SANE server (saned daemon).

- **Default Port**: 6566 (TCP)
- **Transport**: Plain TCP (no TLS/encryption)
- **Encoding**: Big-endian (network byte order) for all multi-byte integers
- **Framing**: Length-prefixed strings, fixed-size words (4 bytes)

## Protocol Architecture

### Wire Format Primitives

All SANE protocol messages use these basic data types:

```
WORD (4 bytes, big-endian):
┌─────────────────────────────────┐
│  Byte 0  │  Byte 1  │  Byte 2  │  Byte 3  │
│  (MSB)   │          │          │  (LSB)   │
└─────────────────────────────────┘

STRING (length-prefixed):
┌──────────────┬───────────────────────┬─────┐
│ Length (4B)  │ UTF-8 bytes           │ \0  │
│ (includes    │ (variable length)     │ NUL │
│  null term)  │                       │     │
└──────────────┴───────────────────────┴─────┘

FIXED (16.16 fixed-point, 4 bytes):
  Integer part: bits 31-16
  Fractional:   bits 15-0
  Value = raw / 65536.0
```

### Network Opcodes

| Opcode | Name                    | Direction      | Description                              |
|--------|-------------------------|----------------|------------------------------------------|
| 0      | SANE_NET_INIT           | Client→Server  | Version handshake and authentication     |
| 1      | SANE_NET_GET_DEVICES    | Client→Server  | Enumerate available scanners             |
| 2      | SANE_NET_OPEN           | Client→Server  | Open a specific scanner device           |
| 3      | SANE_NET_CLOSE          | Client→Server  | Close device handle                      |
| 4      | SANE_NET_GET_OPTION_DESCRIPTORS | Client→Server | Get all scanner options       |
| 5      | SANE_NET_CONTROL_OPTION | Client→Server  | Read a single option value               |
| 6      | SANE_NET_GET_PARAMETERS | Client→Server  | Get scan parameters (dimensions, depth)  |
| 7      | SANE_NET_START          | Client→Server  | Start image acquisition                  |
| 8      | SANE_NET_CANCEL         | Client→Server  | Cancel current scan operation            |
| 9      | SANE_NET_AUTHORIZE      | Client→Server  | Provide authorization credentials        |
| 10     | SANE_NET_EXIT           | Client→Server  | Terminate session                        |

### Status Codes

| Code | Name                       | Meaning                                  |
|------|----------------------------|------------------------------------------|
| 0    | SANE_STATUS_GOOD           | Operation successful                     |
| 1    | SANE_STATUS_UNSUPPORTED    | Operation not supported                  |
| 2    | SANE_STATUS_CANCELLED      | Operation was cancelled                  |
| 3    | SANE_STATUS_DEVICE_BUSY    | Device is in use                         |
| 4    | SANE_STATUS_INVAL          | Invalid argument                         |
| 5    | SANE_STATUS_EOF            | End of file/data                         |
| 6    | SANE_STATUS_JAMMED         | Document feeder jammed                   |
| 7    | SANE_STATUS_NO_DOCS        | Document feeder empty                    |
| 8    | SANE_STATUS_COVER_OPEN     | Scanner cover open                       |
| 9    | SANE_STATUS_IO_ERROR       | I/O error communicating with device      |
| 10   | SANE_STATUS_NO_MEM         | Out of memory                            |
| 11   | SANE_STATUS_ACCESS_DENIED  | Access denied (authorization required)   |

## Connection Flow

### Basic Probe (Version Check)

```
Client                                           Server
  │                                                │
  ├── SANE_NET_INIT ────────────────────────────→ │
  │   word(0) + word(version) + string(username)   │
  │                                                │
  │ ←──────────────────────────────────────────── │
  │   word(status) + word(server_version)          │
  │                                                │
```

### Device Enumeration

```
Client                                           Server
  │                                                │
  ├── SANE_NET_INIT ────────────────────────────→ │
  │ ←────────── word(status=0) + word(version) ── │
  │                                                │
  ├── SANE_NET_GET_DEVICES ─────────────────────→ │
  │   word(1)                                      │
  │                                                │
  │ ←──────────────────────────────────────────── │
  │   word(status) + pointer-array of devices      │
  │   Each device: 4 strings (name, vendor,        │
  │                model, type)                    │
  │                                                │
```

### Full Scan Workflow

```
Client                                           Server
  │                                                │
  ├── SANE_NET_INIT ────────────────────────────→ │
  ├── SANE_NET_OPEN ────────────────────────────→ │
  │   word(2) + string(deviceName)                 │
  │ ←───── word(status) + word(handle) + string ── │
  │                                                │
  ├── SANE_NET_GET_OPTION_DESCRIPTORS ──────────→ │
  │   word(4) + word(handle)                       │
  │ ←─────── pointer-array of option descriptors ─ │
  │                                                │
  ├── SANE_NET_CONTROL_OPTION (SET) ────────────→ │
  │   word(5) + word(handle) + word(option) +      │
  │   word(action=0) + word(type) + value          │
  │ ←──────────────────── word(status) + ... ───── │
  │                                                │
  ├── SANE_NET_GET_PARAMETERS ──────────────────→ │
  │   word(6) + word(handle)                       │
  │ ←─────── word(status) + scan parameters ────── │
  │                                                │
  ├── SANE_NET_START ───────────────────────────→ │
  │   word(7) + word(handle)                       │
  │ ←─ word(status) + word(dataPort) ───────────── │
  │                                                │
  ├──── Connect to dataPort ────────────────────→ │
  │ ←──────── Raw image bytes (PNM/TIFF) ───────── │
  │                                                │
  ├── SANE_NET_CLOSE ───────────────────────────→ │
  │   word(3) + word(handle)                       │
  │                                                │
```

## Message Formats

### SANE_NET_INIT (opcode 0)

**Request**:
```
word(0)             — Opcode
word(version_code)  — SANE protocol version (major << 24 | minor << 16 | build)
string(username)    — Username for authentication/logging
```

**Response**:
```
word(status)        — SANE_STATUS_* code
word(version_code)  — Server SANE version
```

**Example**: Version 1.0.3 = `(1 << 24) | (0 << 16) | 3` = `0x01000003` = 16777219

**Common versions**:
- `1.0.0` (16777216): SANE 1.0 baseline
- `1.0.3` (16777219): SANE 1.0.3 with network protocol extensions
- `1.1.0` (16842752): SANE 1.1 development version

### SANE_NET_GET_DEVICES (opcode 1)

**Request**:
```
word(1)             — Opcode
```

**Response**:
```
word(status)        — SANE_STATUS_GOOD (0) on success
[pointer-array]     — Array of device pointers
  word(pointer)     — Non-zero = device present, 0 = array terminator
  [if pointer != 0:]
    string(name)    — Device name (e.g., "epson2:libusb:001:003")
    string(vendor)  — Vendor (e.g., "Epson")
    string(model)   — Model (e.g., "Perfection V370")
    string(type)    — Type (e.g., "flatbed scanner")
```

**Device name format**: Usually `backend:bus:device` (e.g., `epson2:libusb:001:003`, `hpaio:/usb/HP_LaserJet_1020`)

### SANE_NET_OPEN (opcode 2)

**Request**:
```
word(2)             — Opcode
string(deviceName)  — Device name from GET_DEVICES
```

**Response**:
```
word(status)        — SANE_STATUS_GOOD (0) on success
word(handle)        — Device handle for subsequent operations
string(resource)    — Resource string (empty if no auth required)
```

**Notes**:
- `handle` is used in all subsequent operations (GET_OPTION_DESCRIPTORS, START, etc.)
- If `resource` is non-empty, client must send SANE_NET_AUTHORIZE before proceeding
- `status` may be `SANE_STATUS_ACCESS_DENIED` (11) if authentication required

### SANE_NET_GET_OPTION_DESCRIPTORS (opcode 4)

**Request**:
```
word(4)             — Opcode
word(handle)        — Device handle from OPEN
```

**Response**:
```
word(status)        — SANE_STATUS_GOOD (0) on success
[pointer-array]     — Array of option descriptors
  word(pointer)     — Non-zero = option present, 0 = array terminator
  [if pointer != 0:]
    string(name)    — Option name (e.g., "resolution", "mode")
    string(title)   — Human-readable title
    string(desc)    — Description
    word(type)      — Option type (see Option Types below)
    word(unit)      — Unit (see Units below)
    word(size)      — Size in bytes
    word(cap)       — Capability flags (see Capabilities below)
    word(constraint) — Constraint type (0=none, 1=range, 2=word-list, 3=string-list)
    [constraint data] — Depends on constraint type
```

### Option Types

| Type | Name         | Description                                    |
|------|--------------|------------------------------------------------|
| 0    | BOOL         | Boolean (0 = false, 1 = true)                  |
| 1    | INT          | Signed 32-bit integer                          |
| 2    | FIXED        | 16.16 fixed-point (divide by 65536 for float)  |
| 3    | STRING       | Null-terminated UTF-8 string                   |
| 4    | BUTTON       | Action button (no value)                       |
| 5    | GROUP        | Option group header (no value)                 |

### Units

| Unit | Name        | Description                |
|------|-------------|----------------------------|
| 0    | NONE        | Unitless                   |
| 1    | PIXEL       | Pixels                     |
| 2    | BIT         | Bits                       |
| 3    | MM          | Millimeters                |
| 4    | DPI         | Dots per inch              |
| 5    | PERCENT     | Percentage (0-100)         |
| 6    | MICROSECOND | Microseconds               |

### Capability Flags (bitmask)

| Bit  | Flag          | Meaning                                              |
|------|---------------|------------------------------------------------------|
| 0x01 | SOFT_SELECT   | Option can be set by software                        |
| 0x02 | HARD_SELECT   | Option can be set by hardware (scanner buttons)      |
| 0x04 | SOFT_DETECT   | Option value can be read by software                 |
| 0x08 | EMULATED      | Option is emulated by backend                        |
| 0x10 | AUTOMATIC     | Option has automatic mode                            |
| 0x20 | INACTIVE      | Option is currently inactive (grayed out)            |
| 0x40 | ADVANCED      | Advanced option (hide by default in UI)              |

**Settable check**: `(cap & 0x01) != 0` (SOFT_SELECT bit)
**Active check**: `(cap & 0x20) == 0` (INACTIVE bit clear)

### Constraint Types

**RANGE (type 1)**:
```
word(min)           — Minimum value (signed, FIXED if type=2)
word(max)           — Maximum value (signed, FIXED if type=2)
word(quant)         — Quantization step (0 = continuous)
```

**WORD_LIST (type 2)**:
```
word(count)         — Number of allowed values
word(value1)        — First allowed value (signed, FIXED if type=2)
word(value2)        — Second allowed value
...
```

**STRING_LIST (type 3)**:
```
[pointer-array]
  word(pointer)     — Non-zero = string present, 0 = array terminator
  string(value)     — Allowed string value
```

### SANE_NET_CONTROL_OPTION (opcode 5)

**Request** (SET_VALUE action):
```
word(5)             — Opcode
word(handle)        — Device handle
word(option_index)  — Option index (from GET_OPTION_DESCRIPTORS)
word(action)        — 0=SET_VALUE, 1=GET_VALUE, 2=SET_AUTO
word(value_type)    — Option type (0=BOOL, 1=INT, 2=FIXED, 3=STRING)
word(value_size)    — Size of value in bytes
[value bytes]       — Value data
```

**Response**:
```
word(status)        — SANE_STATUS_GOOD (0) on success
word(info)          — Info flags (see Info Flags below)
word(value_type)    — Echo of request type
word(value_size)    — Size of returned value
[value bytes]       — Current value (after SET or from GET)
```

### Info Flags (returned from CONTROL_OPTION)

| Bit  | Flag              | Meaning                                      |
|------|-------------------|----------------------------------------------|
| 0x01 | INEXACT           | Value was rounded/clamped                    |
| 0x02 | RELOAD_OPTIONS    | Option descriptors changed, re-read them     |
| 0x04 | RELOAD_PARAMS     | Scan parameters changed, re-read them        |

### SANE_NET_GET_PARAMETERS (opcode 6)

**Request**:
```
word(6)             — Opcode
word(handle)        — Device handle
```

**Response**:
```
word(status)        — SANE_STATUS_GOOD (0) on success
word(format)        — Frame format (see Frame Formats below)
word(last_frame)    — 1 if last frame, 0 if more frames follow
word(bytes_per_line) — Bytes per scan line
word(pixels_per_line) — Pixels per scan line
word(lines)         — Number of lines (-1 if unknown)
word(depth)         — Bits per sample
```

### Frame Formats

| Format | Name  | Description                              |
|--------|-------|------------------------------------------|
| 0      | GRAY  | Grayscale                                |
| 1      | RGB   | Red/Green/Blue interleaved               |
| 2      | RED   | Red channel only (multi-frame)           |
| 3      | GREEN | Green channel only (multi-frame)         |
| 4      | BLUE  | Blue channel only (multi-frame)          |

**Estimated data size**: `bytes_per_line * lines` (if `lines >= 0`)

### SANE_NET_START (opcode 7)

**Request**:
```
word(7)             — Opcode
word(handle)        — Device handle
```

**Response**:
```
word(status)        — SANE_STATUS_GOOD (0) on success
word(port)          — TCP port for data connection (0 if data follows on control socket)
word(byte_order)    — Byte order for image data (0x1234 = little-endian, 0x4321 = big-endian)
string(resource)    — Resource string (usually empty)
```

**Data retrieval**:
1. If `port != 0`: Connect to `server:port` and read raw image bytes
2. If `port == 0`: Image data follows on control socket (implementation-dependent)

**Image format**: Usually PNM (P4=bitmap, P5=grayscale, P6=RGB) or TIFF, depending on backend

## Common Scanner Options

These option names are standardized across SANE backends:

| Option Name       | Type   | Unit | Description                              |
|-------------------|--------|------|------------------------------------------|
| `resolution`      | INT    | DPI  | Scan resolution (e.g., 75, 150, 300, 600)|
| `mode`            | STRING | NONE | Color mode ("Lineart", "Gray", "Color")  |
| `depth`           | INT    | BIT  | Bits per channel (8, 16)                 |
| `source`          | STRING | NONE | Scan source ("Flatbed", "ADF", "Duplex") |
| `tl-x`, `tl-y`    | FIXED  | MM   | Top-left corner of scan area             |
| `br-x`, `br-y`    | FIXED  | MM   | Bottom-right corner of scan area         |
| `brightness`      | FIXED  | NONE | Brightness adjustment (-100 to 100)      |
| `contrast`        | FIXED  | NONE | Contrast adjustment (-100 to 100)        |
| `gamma`           | FIXED  | NONE | Gamma correction (0.1 to 5.0)            |
| `page-width`      | FIXED  | MM   | ADF page width                           |
| `page-height`     | FIXED  | MM   | ADF page height                          |
| `batch-scan`      | BOOL   | NONE | Enable multi-page ADF scanning           |

## API Endpoints

### POST /api/sane/probe

**Description**: TLS connect + SANE_NET_INIT handshake (minimal probe)

**Request Body**:
```json
{
  "host": "scanner.example.com",
  "port": 6566,
  "username": "anonymous",
  "timeout": 10000
}
```

**Response**:
```json
{
  "success": true,
  "host": "scanner.example.com",
  "port": 6566,
  "latencyMs": 42,
  "statusCode": 0,
  "statusMessage": "SANE_STATUS_GOOD",
  "versionCode": 16777219,
  "version": "1.0.3"
}
```

**Failure (INIT rejected)**:
```json
{
  "success": false,
  "host": "scanner.example.com",
  "port": 6566,
  "latencyMs": 38,
  "error": "INIT failed: SANE_STATUS_ACCESS_DENIED"
}
```

### POST /api/sane/devices

**Description**: INIT + GET_DEVICES to enumerate available scanners

**Request Body**:
```json
{
  "host": "scanner.example.com",
  "port": 6566,
  "username": "scanuser",
  "timeout": 10000
}
```

**Response**:
```json
{
  "success": true,
  "latencyMs": 156,
  "status": 0,
  "statusMessage": "SANE_STATUS_GOOD",
  "version": "1.0.3",
  "initStatus": 0,
  "initStatusMessage": "SANE_STATUS_GOOD",
  "devices": [
    {
      "name": "epson2:libusb:001:003",
      "vendor": "Epson",
      "model": "Perfection V370",
      "type": "flatbed scanner"
    },
    {
      "name": "hpaio:/usb/HP_LaserJet_1020?serial=12345",
      "vendor": "HP",
      "model": "LaserJet 1020",
      "type": "multi-function peripheral"
    }
  ],
  "deviceCount": 2
}
```

### POST /api/sane/open

**Description**: INIT + OPEN a specific device, return handle

**Request Body**:
```json
{
  "host": "scanner.example.com",
  "port": 6566,
  "deviceName": "epson2:libusb:001:003",
  "username": "anonymous",
  "timeout": 10000
}
```

**Success Response**:
```json
{
  "success": true,
  "latencyMs": 89,
  "status": 0,
  "statusMessage": "SANE_STATUS_GOOD",
  "version": "1.0.3",
  "handle": 1,
  "resource": "",
  "deviceName": "epson2:libusb:001:003"
}
```

**Authorization Required**:
```json
{
  "success": false,
  "latencyMs": 76,
  "error": "OPEN failed: SANE_STATUS_ACCESS_DENIED"
}
```

### POST /api/sane/options

**Description**: INIT + OPEN + GET_OPTION_DESCRIPTORS to discover scanner capabilities

**Request Body**:
```json
{
  "host": "scanner.example.com",
  "port": 6566,
  "deviceName": "epson2:libusb:001:003",
  "username": "anonymous",
  "timeout": 15000
}
```

**Response**:
```json
{
  "success": true,
  "latencyMs": 234,
  "version": "1.0.3",
  "deviceName": "epson2:libusb:001:003",
  "handle": 1,
  "optionCount": 42,
  "options": [
    {
      "index": 0,
      "name": "",
      "title": "Number of options",
      "desc": "Read-only option that specifies how many options a specific device supports.",
      "type": 1,
      "typeName": "INT",
      "unit": 0,
      "unitName": "NONE",
      "size": 4,
      "cap": 4,
      "capFlags": ["SOFT_DETECT"],
      "active": true,
      "settable": false,
      "constraintType": 0
    },
    {
      "index": 1,
      "name": "mode",
      "title": "Scan mode",
      "desc": "Selects the scan mode (e.g., lineart, gray, or color).",
      "type": 3,
      "typeName": "STRING",
      "unit": 0,
      "unitName": "NONE",
      "size": 32,
      "cap": 5,
      "capFlags": ["SOFT_SELECT", "SOFT_DETECT"],
      "active": true,
      "settable": true,
      "constraintType": 3,
      "stringList": ["Lineart", "Gray", "Color"]
    },
    {
      "index": 2,
      "name": "resolution",
      "title": "Scan resolution",
      "desc": "Sets the resolution of the scanned image in DPI.",
      "type": 1,
      "typeName": "INT",
      "unit": 4,
      "unitName": "DPI",
      "size": 4,
      "cap": 5,
      "capFlags": ["SOFT_SELECT", "SOFT_DETECT"],
      "active": true,
      "settable": true,
      "constraintType": 2,
      "wordList": [75, 150, 300, 600, 1200, 2400, 4800]
    },
    {
      "index": 3,
      "name": "tl-x",
      "title": "Top-left x",
      "desc": "Top-left x position of scan area in millimeters.",
      "type": 2,
      "typeName": "FIXED",
      "unit": 3,
      "unitName": "MM",
      "size": 4,
      "cap": 5,
      "capFlags": ["SOFT_SELECT", "SOFT_DETECT"],
      "active": true,
      "settable": true,
      "constraintType": 1,
      "range": { "min": 0, "max": 215.9, "quant": 0 }
    }
  ]
}
```

### POST /api/sane/scan

**Description**: Full scan workflow — INIT + OPEN + SET_OPTION(s) + GET_PARAMETERS + START + read image data

**Request Body**:
```json
{
  "host": "scanner.example.com",
  "port": 6566,
  "deviceName": "epson2:libusb:001:003",
  "username": "anonymous",
  "timeout": 30000,
  "maxDataBytes": 65536,
  "setOptions": [
    { "index": 1, "valueType": 3, "value": "Gray" },
    { "index": 2, "valueType": 1, "value": 300 },
    { "index": 3, "valueType": 2, "value": 10.5 },
    { "index": 4, "valueType": 2, "value": 15.2 }
  ]
}
```

**Request Fields**:
- `setOptions`: Array of options to set before scanning
  - `index`: Option index from `/api/sane/options` response
  - `valueType`: 0=BOOL, 1=INT, 2=FIXED, 3=STRING
  - `value`: For FIXED, provide float (will be converted to 16.16 format)
- `maxDataBytes`: Maximum image bytes to return (default 65536, max 4194304)

**Response**:
```json
{
  "success": true,
  "latencyMs": 5432,
  "version": "1.0.3",
  "deviceName": "epson2:libusb:001:003",
  "handle": 1,
  "parameters": {
    "format": 0,
    "formatName": "GRAY",
    "lastFrame": true,
    "bytesPerLine": 2550,
    "pixelsPerLine": 2550,
    "lines": 3508,
    "depth": 8,
    "estimatedBytes": 8945400
  },
  "optionResults": [
    { "index": 1, "status": 0, "info": 0 },
    { "index": 2, "status": 0, "info": 0 },
    { "index": 3, "status": 0, "info": 1 },
    { "index": 4, "status": 0, "info": 0 }
  ],
  "scan": {
    "dataPort": 50123,
    "dataBytesRead": 65536,
    "imageDataHex": "50 35 0a 32 35 35 30 20 33 35 30 38 0a 32 35 35 0a ff ff ff ff fe fe fd fd",
    "imageDataBase64": "UDUKMjU1MCAzNTA4CjI1NQr//////////w..."
  }
}
```

**Response Fields**:
- `parameters.estimatedBytes`: Total scan size (bytes_per_line × lines)
- `optionResults[].info`: Bitmask (0x01=INEXACT, 0x02=RELOAD_OPTIONS, 0x04=RELOAD_PARAMS)
- `scan.imageDataHex`: First 32 bytes as hex (for format detection)
- `scan.imageDataBase64`: Up to `maxDataBytes` of image data, base64-encoded

**PNM Header Detection**:
```
50 35 0a ... → "P5\n" (PGM grayscale)
50 36 0a ... → "P6\n" (PPM RGB)
50 34 0a ... → "P4\n" (PBM bitmap)
```

## Debugging Tips

### Wireshark/tcpdump Capture

```bash
# Capture SANE traffic on port 6566
sudo tcpdump -i any -s 65535 -w sane.pcap port 6566

# Analyze in Wireshark
wireshark sane.pcap
```

### scanimage Command-Line Tool

```bash
# List devices
scanimage -L

# Test SANE daemon connectivity
scanimage -d 'net:scanner.example.com:epson2:libusb:001:003' --test

# Get option list
scanimage -d 'net:scanner.example.com:epson2:libusb:001:003' -A

# Perform test scan
scanimage -d 'net:scanner.example.com:epson2:libusb:001:003' \
  --resolution 150 --mode Gray > test.pnm
```

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `SANE_STATUS_ACCESS_DENIED` | Authentication required | Provide username/password via AUTHORIZE |
| `SANE_STATUS_DEVICE_BUSY` | Scanner in use by another client | Wait and retry |
| `SANE_STATUS_INVAL` | Invalid option value | Check constraint (range, word-list, string-list) |
| `SANE_STATUS_COVER_OPEN` | Scanner lid open | Close scanner cover |
| `SANE_STATUS_NO_DOCS` | ADF feeder empty | Load documents into feeder |
| Connection timeout | saned not running or firewall | Check `systemctl status saned.socket` |
| Empty device list | No scanners attached or permissions | Check `sane-find-scanner` and udev rules |

## Security Considerations

1. **No Encryption**: SANE protocol uses plain TCP with no TLS/SSL support
   - **Risk**: Credentials and image data transmitted in cleartext
   - **Mitigation**: Use SSH tunnel or VPN for remote access

2. **Authentication**: SANE_NET_AUTHORIZE uses cleartext password
   - **Risk**: Password sniffing on network
   - **Mitigation**: Limit to trusted networks, use strong passwords

3. **Device Name Injection**: Device names from GET_DEVICES can contain shell metacharacters
   - **Risk**: Command injection if device name passed to shell
   - **Mitigation**: Validate/sanitize device names (no `..`, null bytes, shell chars)

4. **Resource Exhaustion**: Malicious server can send infinite option descriptors or huge image data
   - **Risk**: Client memory exhaustion
   - **Mitigation**: Enforce maximum buffer sizes (10 MB absolute limit in implementation)

5. **Network Exposure**: saned listens on all interfaces by default
   - **Risk**: Unauthorized scanner access from internet
   - **Mitigation**: Bind to localhost or LAN IP only, use firewall rules

## Known Quirks and Limitations

### Implementation Limitations

1. **No connection reuse**: Each endpoint opens a new TCP connection
   - **Impact**: Higher latency for multi-operation workflows
   - **Workaround**: Use `/api/sane/scan` for full workflow in single request

2. **No SANE_NET_AUTHORIZE support**: Authorization not implemented
   - **Impact**: Cannot access password-protected scanners
   - **Workaround**: Configure saned for passwordless access

3. **No SANE_NET_CLOSE**: Device handles not explicitly closed
   - **Impact**: Server may hold device locks briefly after operations
   - **Workaround**: Wait for server-side timeout (usually 60 seconds)

4. **Fixed username**: Uses `"anonymous"` by default
   - **Impact**: Limited audit trail on server
   - **Workaround**: Provide custom username in request body

5. **Data port timeout**: 15-second deadline for image data retrieval
   - **Impact**: Large scans may timeout before completion
   - **Workaround**: Reduce scan area or resolution, increase timeout

6. **FIXED type range edge case**: Option descriptor parsing assumes FIXED ranges use 16.16 format
   - **Impact**: Some backends may use different fixed-point formats
   - **Workaround**: Manual integer-to-float conversion if needed

7. **No EDNS0/IPv6**: IPv4 only, no IPv6 support
   - **Impact**: Cannot connect to IPv6-only SANE servers
   - **Workaround**: Use IPv4 or dual-stack server

### Protocol Quirks

8. **Pointer array termination**: Some servers send extra null pointers in device/option arrays
   - **Impact**: Parsing must handle multiple consecutive nulls
   - **Workaround**: Stop at first null pointer (implementation does this)

9. **Option index 0 metadata**: First option is always "number of options" (read-only)
   - **Impact**: Actual options start at index 1
   - **Workaround**: Skip index 0 when setting options

10. **Multi-frame scans**: Some backends require multiple START calls for RGB (RED, GREEN, BLUE frames)
    - **Impact**: Single-frame implementation only captures first frame
    - **Workaround**: Check `last_frame` flag and loop if needed

11. **PNM vs TIFF**: Image format depends on backend (most use PNM)
    - **Impact**: Client must handle both formats
    - **Workaround**: Detect format from magic bytes (`P4`/`P5`/`P6` for PNM, `II*/MM*` for TIFF)

12. **Unknown lines**: Some backends set `lines = -1` (unknown height)
    - **Impact**: Cannot pre-allocate buffer
    - **Workaround**: Read until EOF on data socket

13. **Byte order field**: START response includes `byte_order` word (usually ignored)
    - **Impact**: No implementation uses it (PNM is ASCII header, binary is MSB-first)
    - **Workaround**: Assume big-endian for binary data

14. **Device name length**: No explicit max length in protocol
    - **Impact**: Very long device names can cause buffer issues
    - **Workaround**: Enforce 255-byte limit (implementation does this)

## References

- **SANE Standard**: http://www.sane-project.org/html/doc011.html
- **SANE Network Protocol**: http://www.sane-project.org/html/doc013.html (Chapter 4)
- **saned Man Page**: https://linux.die.net/man/8/saned
- **scanimage Man Page**: https://linux.die.net/man/1/scanimage
- **SANE Backends**: https://gitlab.com/sane-project/backends
- **PNM Format Spec**: http://netpbm.sourceforge.net/doc/pnm.html

## Changelog

- **2026-02-18**: Initial power-user documentation created
- **2026-02-18**: Fixed timeout handle leaks (added `clearTimeout()` in all endpoints)
- **2026-02-18**: Fixed `decodeString()` buffer overread validation
- **2026-02-18**: Added INIT status code validation (reject non-zero status)
- **2026-02-18**: Fixed FIXED type handling in option descriptors (16.16 conversion)
- **2026-02-18**: Fixed SET_OPTION for FIXED type values (float to 16.16 conversion)
- **2026-02-18**: Added device name validation (length, path traversal, null bytes)
- **2026-02-18**: Added absolute maximum buffer size (10 MB) to prevent memory exhaustion
