# collectd Binary Protocol — Power User Reference

## Overview

**collectd** is a Unix daemon that collects system performance metrics (CPU, memory, disk,
network I/O, etc.) and forwards them using a compact binary protocol over the network. The
`network` plugin can operate in **server mode** (push metrics to clients) or **client mode**
(accept metric writes). This implementation speaks the collectd binary wire format over raw
TCP sockets.

**Port:** 25826 (default; IANA-registered for collectd)
**Transport:** TCP via `cloudflare:sockets connect()` (collectd natively uses UDP, but the
network plugin also supports TCP listeners)
**Auth:** None in this implementation (collectd supports HMAC-SHA256 signing and AES-256-OFB
encryption via part types 0x0200 and 0x0210, but those are not implemented here)
**Cloudflare detection:** Yes — 403 with `isCloudflare: true` before any TCP attempt

**Source reference:** collectd C source `src/network.c`, `src/network.h`
**Specification:** https://collectd.org/wiki/index.php/Binary_protocol

---

## Binary Protocol

Every collectd network packet is a sequence of **parts**. Each part uses a Type-Length-Value
(TLV) structure:

```
┌───────────────────────────────────────────────┐
│ Part Header (4 bytes)                         │
│   Part Type   (2 bytes, uint16, big-endian)   │
│   Part Length  (2 bytes, uint16, big-endian)   │
├───────────────────────────────────────────────┤
│ Part Data (Part Length - 4 bytes)              │
│   (content depends on Part Type)              │
└───────────────────────────────────────────────┘
```

The **Part Length** field includes the 4-byte header itself. A part with a 5-byte string
payload (including NUL) has Part Length = 9.

### Part Types

| Code     | Name              | Category | Description                                  |
|----------|-------------------|----------|----------------------------------------------|
| `0x0000` | HOST              | string   | Hostname of the sending machine              |
| `0x0001` | TIME              | uint64   | Timestamp in seconds since Unix epoch        |
| `0x0002` | PLUGIN            | string   | Plugin name (e.g., `cpu`, `memory`, `df`)    |
| `0x0003` | PLUGIN_INSTANCE   | string   | Plugin instance (e.g., `0`, `eth0`)          |
| `0x0004` | TYPE              | string   | Data source type (e.g., `gauge`, `derive`)   |
| `0x0005` | TYPE_INSTANCE     | string   | Type instance (e.g., `idle`, `used`)         |
| `0x0006` | VALUES            | special  | Array of metric values (see below)           |
| `0x0007` | INTERVAL          | uint64   | Collection interval in seconds               |
| `0x0008` | TIME_HR           | uint64   | High-resolution timestamp (2^-30 s units)    |
| `0x0009` | INTERVAL_HR       | uint64   | High-resolution interval (2^-30 s units)     |
| `0x0100` | MESSAGE           | string   | Notification message text                    |
| `0x0101` | SEVERITY          | uint64   | Notification severity level                  |
| `0x0200` | SIGN_SHA256       | special  | HMAC-SHA256 signature (not implemented)      |
| `0x0210` | ENCRYPT_AES256    | special  | AES-256-OFB encryption (not implemented)     |

### String Parts

```
[type: uint16 BE][length: uint16 BE][UTF-8 string bytes][0x00 NUL]
```

String parts are **NUL-terminated**. The length field includes the 4-byte header AND the
trailing NUL byte. For example, the string `"cpu"` produces:

```
00 02  00 08  63 70 75 00
│  │   │  │   │  │  │  └─ NUL terminator
│  │   │  │   └──┴──┴─── "cpu" (3 UTF-8 bytes)
│  │   └──┴────────────── length = 8 (4 header + 3 string + 1 NUL)
└──┴───────────────────── type = 0x0002 (PLUGIN)
```

### Numeric Parts (uint64)

```
[type: uint16 BE][length: uint16 BE = 12][value: uint64 BE]
```

Always 12 bytes total. Used for TIME, INTERVAL, TIME_HR, INTERVAL_HR, and SEVERITY.

### High-Resolution Time

Part types 0x0008 (TIME_HR) and 0x0009 (INTERVAL_HR) encode time in units of 2^-30 seconds
(approximately 0.93 nanoseconds). To convert to seconds:

```
seconds = raw_value >> 30      (integer division, discards sub-second)
seconds = raw_value / 2^30     (floating point, preserves sub-second)
```

Modern collectd versions (5.x+) prefer the high-resolution variants. The low-resolution
TIME (0x0001) and INTERVAL (0x0007) parts are still valid but lose sub-second precision.

### Values Part (0x0006) — The Critical One

This is the only part that carries actual metric data. Its structure is:

```
┌─────────────────────────────────────────────────────┐
│ Part Header                                         │
│   type:   uint16 BE = 0x0006                        │
│   length: uint16 BE                                 │
├─────────────────────────────────────────────────────┤
│ num_values: uint16 BE                               │
├─────────────────────────────────────────────────────┤
│ type_codes: num_values x uint8                      │
│   0 = COUNTER                                       │
│   1 = GAUGE                                         │
│   2 = DERIVE                                        │
│   3 = ABSOLUTE                                      │
├─────────────────────────────────────────────────────┤
│ values: num_values x 8 bytes (encoding varies!)     │
└─────────────────────────────────────────────────────┘
```

**Total length:** `4 + 2 + num_values + (num_values * 8)` bytes.

### Value Type Encoding — Beware the GAUGE Exception

This is the single most common source of bugs in collectd protocol implementations:

| Code | Name     | Wire Encoding                          | Signedness |
|------|----------|----------------------------------------|------------|
| 0    | COUNTER  | uint64, **big-endian**                 | unsigned   |
| 1    | GAUGE    | float64 (IEEE 754), **LITTLE-ENDIAN**  | N/A        |
| 2    | DERIVE   | int64, **big-endian**                  | signed     |
| 3    | ABSOLUTE | uint64, **big-endian**                 | unsigned   |

**GAUGE is the lone exception.** While every other field in the collectd binary protocol
uses network byte order (big-endian), GAUGE values are encoded in **little-endian** (x86
host byte order). This comes from the collectd C source using `memcpy()` to copy the
`double` directly into the buffer without byte-swapping — and since collectd was born on
x86 Linux, little-endian became the de facto wire format for doubles.

COUNTER, DERIVE, and ABSOLUTE are **integer** types stored as 8-byte big-endian values, not
as IEEE 754 floats. A common bug is treating all value types as big-endian float64.

### Value Type Semantics

| Type     | Meaning                           | Example Plugins            |
|----------|-----------------------------------|----------------------------|
| COUNTER  | Monotonically increasing counter; collectd computes the rate per second automatically | `if_octets`, `if_packets` |
| GAUGE    | Instantaneous measurement; stored as-is | `memory`, `temperature`, `cpu` (percent) |
| DERIVE   | Like COUNTER but signed; rate computed by collectd | `cpu` (jiffies), `swap_io` |
| ABSOLUTE | Like COUNTER but resets on each read; rate computed by collectd | Rare; some custom plugins |

---

## Packet Assembly

A complete collectd **ValueList** (one metric submission) is assembled by concatenating
parts in order. The typical sequence is:

```
HOST  →  TIME (or TIME_HR)  →  INTERVAL (or INTERVAL_HR)  →
PLUGIN  →  PLUGIN_INSTANCE  →  TYPE  →  TYPE_INSTANCE  →  VALUES
```

State **accumulates** across parts within a single network packet. If multiple ValueList
blocks share the same HOST, collectd only sends the HOST part once at the start. The
receiver must remember the last-seen value for each field and apply it to subsequent
VALUES parts. This is how collectd keeps network packets compact when forwarding hundreds
of metrics per interval.

Example: a single packet carrying CPU idle and CPU user metrics might look like:

```
HOST("server1")  TIME(1708000000)  INTERVAL(10)
PLUGIN("cpu")  PLUGIN_INSTANCE("0")  TYPE("gauge")
TYPE_INSTANCE("idle")    VALUES([GAUGE: 95.2])
TYPE_INSTANCE("user")    VALUES([GAUGE: 3.1])
```

The second VALUES block inherits HOST, TIME, INTERVAL, PLUGIN, PLUGIN_INSTANCE, and TYPE
from the earlier parts.

---

## Endpoints

### POST /api/collectd/probe

Connectivity probe. Opens a TCP connection and optionally reads any data the server pushes
(collectd in server mode will immediately start streaming metrics to connected clients).

**Request:**

```json
{
  "host": "collectd.example.com",
  "port": 25826,
  "timeout": 10000
}
```

| Field     | Required | Default | Notes                          |
|-----------|----------|---------|--------------------------------|
| `host`    | yes      | --      | Hostname or IP                 |
| `port`    | no       | `25826` | collectd network plugin port   |
| `timeout` | no       | `10000` | TCP connect timeout in ms      |

**Response (server pushes data):**

```json
{
  "success": true,
  "host": "collectd.example.com",
  "port": 25826,
  "tcpLatency": 12,
  "bytesReceived": 1024,
  "receivedParts": [
    { "type": 0, "typeName": "HOST", "length": 18 },
    { "type": 8, "typeName": "TIME_HR", "length": 12 },
    { "type": 9, "typeName": "INTERVAL_HR", "length": 12 },
    { "type": 2, "typeName": "PLUGIN", "length": 8 },
    { "type": 6, "typeName": "VALUES", "length": 15 }
  ],
  "serverPushesData": true
}
```

**Response (no data — client-only server):**

```json
{
  "success": true,
  "host": "collectd.example.com",
  "port": 25826,
  "tcpLatency": 12,
  "bytesReceived": 0,
  "serverPushesData": false
}
```

---

### POST /api/collectd/send

Send a single GAUGE metric to a collectd server.

**Request:**

```json
{
  "host": "collectd.example.com",
  "port": 25826,
  "hostname": "portofcall.dev",
  "plugin": "portofcall",
  "pluginInstance": "",
  "type": "gauge",
  "typeInstance": "probe",
  "value": 42.0,
  "timeout": 10000
}
```

| Field            | Required | Default           | Notes                           |
|------------------|----------|-------------------|---------------------------------|
| `host`           | yes      | --                | Target collectd server          |
| `port`           | no       | `25826`           |                                 |
| `hostname`       | no       | `portofcall.dev`  | Hostname in the metric identity |
| `plugin`         | no       | `portofcall`      | Must match `[a-zA-Z0-9_.-]+`   |
| `pluginInstance` | no       | `""`              | Empty string if unused          |
| `type`           | no       | `gauge`           |                                 |
| `typeInstance`   | no       | `probe`           |                                 |
| `value`          | no       | `42.0`            | IEEE 754 double                 |
| `timeout`        | no       | `10000`           | TCP connect timeout in ms       |

**Response:**

```json
{
  "success": true,
  "host": "collectd.example.com",
  "port": 25826,
  "tcpLatency": 15,
  "sendLatency": 3,
  "bytesWritten": 112,
  "metric": {
    "hostname": "portofcall.dev",
    "plugin": "portofcall",
    "type": "gauge",
    "typeInstance": "probe",
    "value": 42.0,
    "timestamp": 1708000000,
    "interval": 10
  }
}
```

---

### POST /api/collectd/put

Send a single GAUGE metric and return the hex-encoded packet for diagnostics.

**Request:**

```json
{
  "host": "collectd.example.com",
  "port": 25826,
  "metricHost": "cloudflare-worker",
  "plugin": "test",
  "pluginInstance": "",
  "type": "gauge",
  "typeInstance": "value",
  "value": 42.0,
  "timeout": 5000
}
```

| Field            | Required | Default              | Notes                        |
|------------------|----------|----------------------|------------------------------|
| `host`           | yes      | --                   | Target collectd server       |
| `port`           | no       | `25826`              |                              |
| `metricHost`     | no       | `cloudflare-worker`  | HOST part in the packet      |
| `plugin`         | no       | `test`               |                              |
| `pluginInstance` | no       | `""`                 |                              |
| `type`           | no       | `gauge`              |                              |
| `typeInstance`   | no       | `value`              |                              |
| `value`          | no       | `42.0`               |                              |
| `timeout`        | no       | `5000`               | TCP connect timeout in ms    |

**Response:**

```json
{
  "success": true,
  "packet": "0000001563...",
  "bytesSent": 112,
  "latencyMs": 18
}
```

The `packet` field is the full binary payload hex-encoded for inspection (use `xxd -r -p`
to convert back to binary, or paste into a hex editor).

---

### POST /api/collectd/receive

Connect to a collectd server in server-mode and receive live metrics for a configurable
duration. Decodes the binary protocol into structured JSON.

**Request:**

```json
{
  "host": "collectd.example.com",
  "port": 25826,
  "durationMs": 5000,
  "maxMetrics": 200,
  "timeout": 10000
}
```

| Field        | Required | Default | Notes                              |
|--------------|----------|---------|------------------------------------|
| `host`       | yes      | --      | collectd server in server mode     |
| `port`       | no       | `25826` |                                    |
| `durationMs` | no       | `5000`  | Collection window; clamped 500-15000 ms |
| `maxMetrics` | no       | `200`   | Stop early after this many metrics; clamped 1-500 |
| `timeout`    | no       | `10000` | TCP connect timeout in ms          |

**Response:**

```json
{
  "success": true,
  "host": "collectd.example.com",
  "port": 25826,
  "tcpLatency": 12,
  "collectionMs": 5023,
  "bytesReceived": 8192,
  "packetsDecoded": 4,
  "metricsReceived": 87,
  "pluginsSeen": ["cpu", "df", "interface", "memory"],
  "metrics": [
    {
      "host": "server1",
      "plugin": "cpu",
      "pluginInstance": "0",
      "type": "percent",
      "typeInstance": "idle",
      "timestamp": 1708000000,
      "interval": 10,
      "values": [{ "type": "GAUGE", "value": 95.2 }]
    }
  ]
}
```

Each metric in the `metrics` array has:

| Field            | Description                                           |
|------------------|-------------------------------------------------------|
| `host`           | Originating hostname                                  |
| `plugin`         | collectd plugin name                                  |
| `pluginInstance`  | Plugin instance (e.g., CPU core number, interface name) |
| `type`           | Data source type from types.db                        |
| `typeInstance`    | Specific data source within the type                  |
| `timestamp`      | Unix timestamp (seconds)                              |
| `interval`       | Collection interval (seconds)                         |
| `values`         | Array of `{ type, value }` — type is COUNTER/GAUGE/DERIVE/ABSOLUTE |

---

## collectd Server Configuration

To send metrics, the remote collectd must have the network plugin in **server mode**
(listening for writes):

```xml
LoadPlugin network
<Plugin network>
  <Listen "0.0.0.0" "25826">
  </Listen>
</Plugin>
```

To receive metrics, the remote collectd must be in **server mode** pushing to clients
(less common with TCP, more typical with UDP multicast):

```xml
LoadPlugin network
<Plugin network>
  <Server "0.0.0.0" "25826">
  </Server>
</Plugin>
```

---

## Type Definitions (types.db)

collectd uses a `types.db` file to define the schema for each metric type. Common entries:

```
gauge                   value:GAUGE:U:U
counter                 value:COUNTER:U:U
derive                  value:DERIVE:0:U
absolute                value:ABSOLUTE:0:U
if_octets               rx:DERIVE:0:U, tx:DERIVE:0:U
cpu                     value:DERIVE:0:U
percent                 value:GAUGE:0:100.1
memory                  value:GAUGE:0:281474976710656
df_complex              value:GAUGE:0:U
```

Format: `type_name  ds_name:ds_type:min:max[, ds_name:ds_type:min:max ...]`

- `U` means unlimited (no bounds checking)
- Multiple data sources per type produce multiple values in a single VALUES part
- For example, `if_octets` always has 2 values per VALUES part (rx and tx)

---

## Wire Format Walkthrough

Here is a byte-level example of a complete packet sending a GAUGE value of 42.0 from
host `test` with plugin `cpu`, type `gauge`, type instance `idle`:

```
# HOST part: "test" + NUL
00 00  00 09  74 65 73 74 00

# TIME part: 1708000000 = 0x00000000 65C33C80
00 01  00 0C  00 00 00 00 65 C3 3C 80

# INTERVAL part: 10 = 0x000000000000000A
00 07  00 0C  00 00 00 00 00 00 00 0A

# PLUGIN part: "cpu" + NUL
00 02  00 08  63 70 75 00

# PLUGIN_INSTANCE part: "" + NUL
00 03  00 05  00

# TYPE part: "gauge" + NUL
00 04  00 0A  67 61 75 67 65 00

# TYPE_INSTANCE part: "idle" + NUL
00 05  00 09  69 64 6C 65 00

# VALUES part: 1 value, type GAUGE (1), value 42.0 in LE float64
00 06  00 0F  00 01  01  00 00 00 00 00 00 45 40
                     │    └──────────────────────── 42.0 as float64 LE
                     └─────── type code 1 = GAUGE
```

Note the GAUGE value `42.0`: in IEEE 754 double, 42.0 is `0x4045000000000000`. In
**little-endian** byte order that becomes `00 00 00 00 00 00 45 40`.

---

## Implementation Notes

- All three send endpoints (`/send`, `/put`, `/probe`) use TCP via Cloudflare Workers
  sockets. collectd's native transport is UDP, but the network plugin also supports TCP.
- The decoder (`/receive`) handles state accumulation across parts within a single TCP
  read, matching the behavior of collectd's C source.
- Signed/encrypted packets (part types 0x0200, 0x0210) are not supported and will be
  skipped by the decoder.
- The high-resolution timestamp conversion uses BigInt right-shift (`>> 30n`) to avoid
  floating-point precision loss on large values.

## Common Pitfalls

1. **Missing NUL terminator on strings** — collectd requires it; without it the server
   silently discards the packet or misparses subsequent parts.
2. **GAUGE byte order** — GAUGE is little-endian float64 while everything else is
   big-endian. This is the #1 interop bug.
3. **Integer vs. float for COUNTER/DERIVE/ABSOLUTE** — These are wire-encoded as
   uint64/int64, not as IEEE 754 doubles. Reading them with `getFloat64()` produces
   garbage values.
4. **UDP vs. TCP** — collectd defaults to UDP on port 25826. This implementation uses TCP
   because Cloudflare Workers sockets only support TCP. The binary protocol is identical
   on both transports.
