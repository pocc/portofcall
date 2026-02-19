# GPSD -- Power User Reference

**Port:** 2947 (default) | **Protocol:** JSON over TCP | **Transport:** Newline-delimited JSON

Port of Call provides five GPSD endpoints: a version probe, a device lister, a position poll, a timed watch stream, and a raw command executor. All open a direct TCP connection from the Cloudflare Worker to the target gpsd daemon.

---

## Protocol Overview

gpsd (GPS Service Daemon) runs on Linux/BSD systems and monitors GPS receivers attached via serial or USB. It provides a text-based JSON protocol over TCP port 2947.

**Connection behavior:**
1. Client connects to TCP port 2947
2. Server immediately sends a VERSION banner (no command needed)
3. Client sends commands prefixed with `?`, terminated by `;` or newline
4. Server responds with newline-delimited JSON objects, each containing a `"class"` field

**Command syntax:**
```
?COMMAND[=JSON_PARAMS];
```

The `?` prefix is mandatory. The `;` terminator is optional (newline also terminates). Parameters, when required, are passed as an inline JSON object after `=`.

---

## API Endpoints

### `POST /api/gpsd/version` -- Connection probe

Connects to gpsd and reads the VERSION banner that the daemon sends automatically on connect. No command is sent.

**POST body:**

| Field     | Type   | Default | Notes |
|-----------|--------|---------|-------|
| `host`    | string | --      | Required |
| `port`    | number | `2947`  | |
| `timeout` | number | `10000` | Total timeout in ms |

**Success (200):**
```json
{
  "success": true,
  "host": "gps.example.com",
  "port": 2947,
  "version": {
    "release": "3.25",
    "rev": "3.25",
    "proto_major": 3,
    "proto_minor": 15
  },
  "raw": ["{\"class\":\"VERSION\",\"release\":\"3.25\",...}"],
  "rtt": 42
}
```

**No VERSION banner (200):** `{ "success": false, "error": "No VERSION banner received -- may not be a gpsd server", "raw": [...] }`

**curl example:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/gpsd/version \
  -H 'Content-Type: application/json' \
  -d '{"host":"gps.example.com"}' | jq .
```

---

### `POST /api/gpsd/devices` -- List GPS receivers

Sends `?DEVICES;` to list all GPS devices known to the daemon. This command does not require WATCH to be enabled.

**POST body:** Same as version endpoint.

**Success (200):**
```json
{
  "success": true,
  "host": "gps.example.com",
  "port": 2947,
  "version": { "release": "3.25", "proto_major": 3, "proto_minor": 15 },
  "devices": [
    {
      "class": "DEVICE",
      "path": "/dev/ttyUSB0",
      "driver": "u-blox",
      "activated": "2026-02-17T10:30:00.000Z",
      "flags": 1,
      "native": 0,
      "bps": 9600,
      "parity": "N",
      "stopbits": 1,
      "cycle": 1.0
    }
  ],
  "raw": [...],
  "rtt": 55
}
```

When no GPS devices are connected, `devices` is an empty array. The daemon may still be running; it simply has no receivers attached.

**DEVICES response fields:**

| Field       | Type    | Description |
|-------------|---------|-------------|
| `path`      | string  | Device path (e.g. `/dev/ttyUSB0`, `/dev/pps0`) |
| `driver`    | string  | GPS chipset driver (u-blox, SiRF, MTK3301, NMEA0183, etc.) |
| `activated` | string  | ISO 8601 timestamp when device was activated |
| `flags`     | number  | Bitmask: 1=running, 2=raw-mode |
| `native`    | number  | 0=NMEA mode, 1=native binary mode |
| `bps`       | number  | Serial baud rate |
| `parity`    | string  | `N` (none), `E` (even), `O` (odd) |
| `stopbits`  | number  | 1 or 2 |
| `cycle`     | number  | Update cycle time in seconds (typically 1.0) |
| `mincycle`  | number  | Minimum cycle time the device supports |

---

### `POST /api/gpsd/poll` -- Get latest GPS fix

Enables WATCH mode, pauses briefly for the GPS receiver to report, sends `?POLL;`, then disables WATCH and closes. This is the recommended way to get a one-shot position fix.

**Why WATCH is needed:** Per the GPSD protocol, `?POLL` returns the latest cached data collected while WATCH mode is active. Without WATCH enabled, the daemon may not be reading from the GPS device, and `?POLL` returns stale or empty data.

**POST body:** Same as version endpoint.

**Success (200):**
```json
{
  "success": true,
  "host": "gps.example.com",
  "port": 2947,
  "version": { "release": "3.25", "proto_major": 3, "proto_minor": 15 },
  "poll": {
    "class": "POLL",
    "time": "2026-02-17T10:30:01.000Z",
    "active": 1,
    "tpv": [{ "class": "TPV", "mode": 3, "lat": 37.7749, "lon": -122.4194, ... }],
    "sky": [{ "class": "SKY", "satellites": [...] }]
  },
  "tpv": { "class": "TPV", "mode": 3, "lat": 37.7749, "lon": -122.4194, "alt": 10.5 },
  "sky": { "class": "SKY", "satellites": [...] },
  "raw": [...],
  "rtt": 2400
}
```

**POLL response structure:** The POLL object contains embedded `tpv` and `sky` arrays. The endpoint extracts the first element of each for convenience. If POLL is absent, standalone TPV/SKY objects from the WATCH stream are used as fallbacks.

**Sequence on the wire:**
1. Connect, read VERSION banner
2. Send `?WATCH={"enable":true,"json":true};`
3. Read WATCH acknowledgement and any streamed TPV/SKY
4. Wait ~1.2 seconds for a GPS fix cycle
5. Send `?POLL;`
6. Read POLL response
7. Send `?WATCH={"enable":false};`
8. Close

**Note:** The RTT for poll requests is typically 2-4 seconds due to the intentional pause for data collection.

---

### `POST /api/gpsd/watch` -- Timed watch stream

Enables JSON watch mode, collects all messages for a specified duration (1-30 seconds), then disables WATCH and closes. Returns all collected objects.

**POST body:**

| Field     | Type   | Default | Notes |
|-----------|--------|---------|-------|
| `host`    | string | --      | Required |
| `port`    | number | `2947`  | |
| `seconds` | number | `5`     | Collection duration (1-30) |
| `timeout` | number | `20000` | Connection timeout in ms |

**Success (200):**
```json
{
  "success": true,
  "host": "gps.example.com",
  "port": 2947,
  "seconds": 5,
  "version": { "release": "3.25", "proto_major": 3, "proto_minor": 15 },
  "messages": [
    { "class": "WATCH", "enable": true, "json": true },
    { "class": "TPV", "mode": 3, "lat": 37.7749, "lon": -122.4194, ... },
    { "class": "SKY", "satellites": [...] },
    { "class": "TPV", "mode": 3, "lat": 37.7750, "lon": -122.4193, ... }
  ],
  "messageCount": 4,
  "raw": [...],
  "rtt": 5200
}
```

**Typical message rate:** GPS receivers report once per second. A 5-second watch typically yields ~5 TPV objects and ~5 SKY objects (10 total).

---

### `POST /api/gpsd/command` -- Raw command execution

Sends an arbitrary `?`-prefixed command and returns all response objects. Only read-only query commands (starting with `?`) are allowed.

**POST body:**

| Field     | Type   | Default | Notes |
|-----------|--------|---------|-------|
| `host`    | string | --      | Required |
| `port`    | number | `2947`  | |
| `timeout` | number | `10000` | Total timeout in ms |
| `command` | string | --      | Required, must start with `?` |

**Success (200):**
```json
{
  "success": true,
  "host": "gps.example.com",
  "port": 2947,
  "command": "?DEVICES",
  "objects": [
    { "class": "VERSION", ... },
    { "class": "DEVICES", "devices": [...] }
  ],
  "raw": [...],
  "rtt": 60
}
```

**Rejected command (403):** `{ "success": false, "error": "Commands must start with \"?\" (gpsd query format)" }`

**curl examples:**
```bash
# List devices
curl -s -X POST https://portofcall.ross.gg/api/gpsd/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"gps.example.com","command":"?DEVICES"}' | jq .

# Check WATCH state
curl -s -X POST https://portofcall.ross.gg/api/gpsd/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"gps.example.com","command":"?WATCH"}' | jq .
```

---

## GPSD JSON Protocol Reference

### Commands

| Command | Parameters | Description |
|---------|-----------|-------------|
| `?VERSION` | none | Request version info (also sent as banner on connect) |
| `?DEVICES` | none | List all known GPS devices |
| `?DEVICE` | `={"path":"/dev/ttyUSB0",...}` | Query or configure a specific device |
| `?WATCH` | `={"enable":true,"json":true,...}` | Enable/disable streaming mode |
| `?POLL` | none | Get latest cached fix data (requires active WATCH) |
| `?TPV` | none | Undocumented; some versions return last TPV |
| `?SKY` | none | Undocumented; some versions return last SKY |

### ?WATCH Parameters

```json
{
  "enable": true,       // Enable or disable watch mode
  "json": true,         // Enable JSON output (vs. NMEA)
  "nmea": false,        // Enable raw NMEA output
  "raw": 0,             // Raw output mode: 0=off, 1=raw, 2=hex
  "scaled": false,      // Scale output to floats (vs. integers)
  "split24": false,     // Split AIS type 24 messages
  "pps": false,         // Enable PPS (pulse-per-second) messages
  "device": "/dev/X"    // Restrict to a specific device
}
```

The most common usage is `?WATCH={"enable":true,"json":true}` to start streaming and `?WATCH={"enable":false}` to stop.

### Response Classes

#### VERSION

Sent automatically on connection and in response to `?VERSION`.

```json
{
  "class": "VERSION",
  "release": "3.25",
  "rev": "3.25",
  "proto_major": 3,
  "proto_minor": 15,
  "remote": "gpsd://localhost:2947"
}
```

| Field         | Type   | Description |
|---------------|--------|-------------|
| `release`     | string | gpsd software release version |
| `rev`         | string | Source revision |
| `proto_major` | number | Protocol major version |
| `proto_minor` | number | Protocol minor version |
| `remote`      | string | URL of remote gpsd instance (if proxied) |

#### TPV (Time-Position-Velocity)

The primary fix report. Sent once per GPS update cycle (typically 1 Hz).

```json
{
  "class": "TPV",
  "device": "/dev/ttyUSB0",
  "mode": 3,
  "time": "2026-02-17T10:30:01.000Z",
  "ept": 0.005,
  "lat": 37.774929,
  "lon": -122.419416,
  "altHAE": 10.5,
  "altMSL": 42.3,
  "alt": 10.5,
  "epx": 3.5,
  "epy": 4.2,
  "epv": 7.8,
  "track": 125.6,
  "magtrack": 128.1,
  "speed": 0.12,
  "climb": -0.01,
  "eps": 0.5,
  "epc": 1.2,
  "ecefx": -2694892.0,
  "ecefy": -4297418.0,
  "ecefz": 3854579.0,
  "geoidSep": 31.8,
  "sep": 8.2
}
```

| Field      | Type   | Description |
|------------|--------|-------------|
| `mode`     | number | Fix type: 0=unknown, 1=no fix, 2=2D, 3=3D |
| `time`     | string | ISO 8601 UTC timestamp |
| `ept`      | number | Expected time uncertainty (seconds) |
| `lat`      | number | Latitude (degrees, WGS84) |
| `lon`      | number | Longitude (degrees, WGS84) |
| `altHAE`   | number | Altitude above ellipsoid (meters, WGS84) |
| `altMSL`   | number | Altitude above mean sea level (meters) |
| `alt`      | number | Deprecated alias for altHAE (proto < 3.20) or altMSL |
| `epx`      | number | Longitude error estimate (meters) |
| `epy`      | number | Latitude error estimate (meters) |
| `epv`      | number | Vertical error estimate (meters) |
| `track`    | number | Course over ground (degrees true north) |
| `magtrack` | number | Course over ground (degrees magnetic) |
| `speed`    | number | Speed over ground (m/s) |
| `climb`    | number | Vertical speed (m/s, positive = up) |
| `eps`      | number | Speed error estimate (m/s) |
| `epc`      | number | Climb error estimate (m/s) |
| `geoidSep` | number | Geoid separation (meters) |
| `sep`      | number | Spherical error position (3D, meters) |
| `device`   | string | Device path that sourced this report |

**Mode values:**

| Mode | Meaning |
|------|---------|
| 0    | Unknown -- mode not yet determined |
| 1    | No fix -- GPS has not acquired satellites |
| 2    | 2D fix -- latitude and longitude only (no altitude) |
| 3    | 3D fix -- latitude, longitude, and altitude |

Fields are only present when the GPS has determined their value. A mode-1 TPV may contain only `class`, `device`, `mode`, and `time`.

#### SKY (Satellite View)

Reports visible satellites and signal quality.

```json
{
  "class": "SKY",
  "device": "/dev/ttyUSB0",
  "time": "2026-02-17T10:30:01.000Z",
  "xdop": 0.8,
  "ydop": 0.9,
  "vdop": 1.2,
  "tdop": 0.7,
  "hdop": 1.0,
  "gdop": 1.8,
  "pdop": 1.5,
  "nSat": 12,
  "uSat": 8,
  "satellites": [
    {
      "PRN": 2,
      "gnssid": 0,
      "svid": 2,
      "az": 45.0,
      "el": 67.0,
      "ss": 42.0,
      "used": true,
      "health": 1
    }
  ]
}
```

| Field    | Type   | Description |
|----------|--------|-------------|
| `xdop`   | number | Longitude dilution of precision |
| `ydop`   | number | Latitude dilution of precision |
| `vdop`   | number | Vertical dilution of precision |
| `tdop`   | number | Time dilution of precision |
| `hdop`   | number | Horizontal dilution of precision |
| `gdop`   | number | Geometric dilution of precision |
| `pdop`   | number | Position (3D) dilution of precision |
| `nSat`   | number | Number of satellites visible |
| `uSat`   | number | Number of satellites used in fix |

**Satellite array fields:**

| Field    | Type    | Description |
|----------|---------|-------------|
| `PRN`    | number  | Pseudorandom noise ID (legacy; use gnssid+svid) |
| `gnssid` | number | GNSS system: 0=GPS, 1=SBAS, 2=Galileo, 3=BeiDou, 5=QZSS, 6=GLONASS |
| `svid`   | number  | Satellite vehicle ID within constellation |
| `az`     | number  | Azimuth (degrees from true north, 0-360) |
| `el`     | number  | Elevation (degrees above horizon, 0-90) |
| `ss`     | number  | Signal strength (dBHz, typically 0-55) |
| `used`   | boolean | Whether this satellite is used in the current fix |
| `health` | number  | Satellite health: 0=unknown, 1=OK, 2=unhealthy |

#### GST (Pseudorange Noise Statistics)

Error statistics from the GPS receiver's internal Kalman filter.

```json
{
  "class": "GST",
  "device": "/dev/ttyUSB0",
  "time": "2026-02-17T10:30:01.000Z",
  "rms": 1.2,
  "major": 3.5,
  "minor": 2.1,
  "orient": 45.0,
  "lat": 2.8,
  "lon": 3.1,
  "alt": 5.4
}
```

| Field    | Type   | Description |
|----------|--------|-------------|
| `rms`    | number | RMS value of the standard deviation of the range inputs |
| `major`  | number | Standard deviation of semi-major axis of error ellipse (meters) |
| `minor`  | number | Standard deviation of semi-minor axis of error ellipse (meters) |
| `orient` | number | Orientation of semi-major axis of error ellipse (degrees from true north) |
| `lat`    | number | Standard deviation of latitude error (meters) |
| `lon`    | number | Standard deviation of longitude error (meters) |
| `alt`    | number | Standard deviation of altitude error (meters) |

GST is only available when the GPS receiver supports NMEA GST sentences (u-blox with UBX-NMEA-GST enabled, some SiRF models). Many consumer receivers do not emit GST.

#### ATT (Attitude)

Vehicle attitude data from IMU, compass, or gyroscope. Rare -- only available when an attitude-capable device is connected.

```json
{
  "class": "ATT",
  "device": "/dev/ttyUSB0",
  "time": "2026-02-17T10:30:01.000Z",
  "heading": 125.6,
  "pitch": -2.1,
  "roll": 0.5,
  "yaw": 125.6,
  "mag_st": "Y",
  "pitch_st": "Y",
  "roll_st": "Y"
}
```

#### TOFF (Time Offset)

Reports the offset between GPS time and system clock. Used by NTP servers that discipline their clock from GPS.

```json
{
  "class": "TOFF",
  "device": "/dev/ttyUSB0",
  "real_sec": 1739789401,
  "real_nsec": 0,
  "clock_sec": 1739789401,
  "clock_nsec": 123456
}
```

#### PPS (Pulse Per Second)

Precision timing data from PPS-capable GPS receivers. Used for sub-microsecond time synchronization.

```json
{
  "class": "PPS",
  "device": "/dev/pps0",
  "real_sec": 1739789401,
  "real_nsec": 0,
  "clock_sec": 1739789401,
  "clock_nsec": 456,
  "precision": -20
}
```

#### WATCH (Watch Acknowledgement)

Echoed back when WATCH mode is changed.

```json
{
  "class": "WATCH",
  "enable": true,
  "json": true,
  "nmea": false,
  "raw": 0,
  "scaled": false,
  "timing": false,
  "split24": false,
  "pps": false
}
```

#### POLL (Aggregated Fix Data)

Response to `?POLL`. Contains the latest TPV and SKY data embedded as arrays.

```json
{
  "class": "POLL",
  "time": "2026-02-17T10:30:01.000Z",
  "active": 1,
  "tpv": [
    { "class": "TPV", "mode": 3, "lat": 37.7749, "lon": -122.4194, ... }
  ],
  "sky": [
    { "class": "SKY", "satellites": [...] }
  ]
}
```

The `tpv` and `sky` arrays contain one entry per active device. For single-receiver setups, each array has exactly one element.

#### ERROR

Returned when gpsd cannot process a command.

```json
{
  "class": "ERROR",
  "message": "Unrecognized request '?FOOBAR'"
}
```

---

## Wire Format Details

gpsd uses newline-delimited JSON. Each message is a single JSON object followed by `\n`. Commands are terminated by `;` or `\n`.

**Example session (telnet):**
```
$ telnet gps.example.com 2947
Connected to gps.example.com.
{"class":"VERSION","release":"3.25","rev":"3.25","proto_major":3,"proto_minor":15}
?DEVICES;
{"class":"DEVICES","devices":[{"class":"DEVICE","path":"/dev/ttyUSB0","driver":"u-blox","activated":"2026-02-17T10:30:00.000Z","flags":1,"native":0,"bps":9600}]}
?WATCH={"enable":true,"json":true};
{"class":"WATCH","enable":true,"json":true,"nmea":false,"raw":0,"scaled":false}
{"class":"TPV","device":"/dev/ttyUSB0","mode":3,"time":"2026-02-17T10:30:01.000Z","lat":37.7749,"lon":-122.4194,"alt":10.5,"speed":0.12,"track":125.6}
{"class":"SKY","device":"/dev/ttyUSB0","satellites":[...]}
?WATCH={"enable":false};
{"class":"WATCH","enable":false,"json":false}
```

---

## Known Limitations

**Short-lived connections:** Each API call opens and closes a TCP connection. The `?POLL` endpoint adds a ~1.2 second pause to collect at least one GPS fix cycle. For continuous monitoring, use the `/api/gpsd/watch` endpoint instead.

**Single read window:** The `readLines` function waits for a complete JSON line (terminated by `\n`) plus a 500ms window for additional lines. On very slow connections or when gpsd batches multiple lines, some responses may be truncated.

**WATCH via command endpoint:** Sending `?WATCH={"enable":true}` through `/api/gpsd/command` opens a connection, enables WATCH, reads one batch of responses, and immediately closes. The streaming data is lost. Use `/api/gpsd/watch` for timed streaming.

**No NMEA passthrough:** The implementation only supports JSON mode (`"json":true`). Raw NMEA sentences (`"nmea":true`) are not parsed or formatted.

**No TLS:** gpsd does not support TLS natively. The worker connects via plain TCP. If gpsd is behind a TLS-terminating proxy, connect to the proxy's plaintext port.

**No persistent connections:** There is no WebSocket session endpoint for gpsd. Each request is a one-shot connection.

**Command restrictions:** Only `?`-prefixed commands are allowed through the command endpoint. This is a safety measure -- gpsd query commands are all read-only.

**`!` control commands blocked:** gpsd supports `!` prefixed commands for device configuration (e.g., `!DEVICE={"path":"/dev/ttyUSB0","native":1}`). These are write operations that change device configuration and are intentionally blocked by the `?` prefix requirement.

---

## GPS Hardware Notes

### Common GPS Chipsets

| Chipset     | Typical Devices | NMEA Support | Notes |
|-------------|----------------|--------------|-------|
| u-blox 7/8/9/10 | Adafruit Ultimate GPS, SparkFun GPS, Pi GPS HATs | Full | Best Linux support, UBX binary protocol |
| SiRFstar IV | Older USB dongles | Full | Legacy, superseded by u-blox |
| MediaTek MT3339 | Adafruit Ultimate GPS | Full | Low power, good for battery devices |
| Broadcom BCM47755 | Smartphones, some USB | Limited | Dual-frequency L1/L5 |

### gpsd Driver Selection

gpsd auto-detects the GPS chipset and selects the appropriate driver. Common drivers:

- `u-blox` -- u-blox receivers (most common for dedicated GPS)
- `SiRF` -- SiRFstar chipsets
- `MTK-3301` -- MediaTek chipsets
- `NMEA0183` -- Generic NMEA-only devices
- `Garmin` -- Garmin USB GPS
- `GREIS` -- Javad/Topcon GNSS receivers
- `Ashtech` -- Thales/Ashtech receivers
- `PPS` -- Pulse-per-second timing only

---

## Practical Examples

### curl

```bash
# Version probe
curl -s -X POST https://portofcall.ross.gg/api/gpsd/version \
  -H 'Content-Type: application/json' \
  -d '{"host":"gps.example.com"}' | jq .

# List connected GPS devices
curl -s -X POST https://portofcall.ross.gg/api/gpsd/devices \
  -H 'Content-Type: application/json' \
  -d '{"host":"gps.example.com"}' | jq '.devices[]'

# Get current position fix
curl -s -X POST https://portofcall.ross.gg/api/gpsd/poll \
  -H 'Content-Type: application/json' \
  -d '{"host":"gps.example.com"}' | jq '{lat: .tpv.lat, lon: .tpv.lon, alt: .tpv.alt, speed: .tpv.speed}'

# Watch for 10 seconds
curl -s -X POST https://portofcall.ross.gg/api/gpsd/watch \
  -H 'Content-Type: application/json' \
  -d '{"host":"gps.example.com","seconds":10}' | jq '.messages[] | select(.class == "TPV") | {time, lat, lon, speed}'

# Custom command
curl -s -X POST https://portofcall.ross.gg/api/gpsd/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"gps.example.com","command":"?WATCH"}' | jq '.objects[]'

# Non-standard port
curl -s -X POST https://portofcall.ross.gg/api/gpsd/version \
  -H 'Content-Type: application/json' \
  -d '{"host":"gps.example.com","port":3000}' | jq .
```

### JavaScript

```js
// Version check
const res = await fetch('/api/gpsd/version', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ host: 'gps.example.com' }),
});
const data = await res.json();
console.log(`gpsd ${data.version.release}, protocol ${data.version.proto_major}.${data.version.proto_minor}`);

// Position fix
const fix = await fetch('/api/gpsd/poll', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ host: 'gps.example.com' }),
}).then(r => r.json());

if (fix.tpv && fix.tpv.mode >= 2) {
  console.log(`Position: ${fix.tpv.lat}, ${fix.tpv.lon}`);
  if (fix.tpv.mode === 3) console.log(`Altitude: ${fix.tpv.alt} m`);
  console.log(`Speed: ${fix.tpv.speed} m/s, Heading: ${fix.tpv.track} deg`);
}
```

### netcat / telnet (direct protocol)

```bash
# Connect and see VERSION banner
echo "" | nc gps.example.com 2947

# Send a command
echo "?DEVICES;" | nc gps.example.com 2947

# Watch for a few seconds
(echo '?WATCH={"enable":true,"json":true}'; sleep 5; echo '?WATCH={"enable":false}') | nc gps.example.com 2947
```

---

## Power User Tips

### DOP Values (Dilution of Precision)

| DOP    | Rating    | Description |
|--------|-----------|-------------|
| < 1    | Ideal     | Maximum confidence |
| 1-2    | Excellent | Position accurate to ~1-2m |
| 2-5    | Good      | Adequate for most uses |
| 5-10   | Moderate  | Acceptable for navigation |
| 10-20  | Fair      | Use with caution |
| > 20   | Poor      | Unreliable |

### Signal Strength (ss / SNR)

| dBHz  | Quality  | Notes |
|-------|----------|-------|
| > 40  | Excellent | Strong lock |
| 30-40 | Good     | Reliable tracking |
| 20-30 | Weak     | Marginal -- may drop in/out of fix |
| < 20  | Very weak | Unlikely to be used in fix |

### Fix Mode Progression

After power-on, a cold-start GPS receiver typically progresses:
1. Mode 0/1 for 30-60 seconds (searching for satellites)
2. Mode 2 once 3 satellites are locked (2D fix, no altitude)
3. Mode 3 once 4+ satellites are locked (3D fix with altitude)

Hot starts (when ephemeris data is cached) can achieve mode 3 in under 5 seconds.

### NTP/PPS Use Case

For precision timing with gpsd:
1. Enable PPS in WATCH: `?WATCH={"enable":true,"json":true,"pps":true}`
2. Look for TOFF and PPS class messages
3. TOFF gives GPS-to-system clock offset (typically microseconds)
4. PPS gives pulse-per-second timing (typically nanosecond precision)

The watch endpoint supports PPS collection -- set `seconds` to the desired sampling duration.

---

## Resources

- [gpsd JSON protocol specification](https://gpsd.gitlab.io/gpsd/gpsd_json.html)
- [gpsd client HOWTO](https://gpsd.gitlab.io/gpsd/client-howto.html)
- [gpsd compatible hardware](https://gpsd.gitlab.io/gpsd/hardware.html)
- [gpsd troubleshooting](https://gpsd.gitlab.io/gpsd/troubleshooting.html)
- [NMEA 0183 sentence reference](https://gpsd.gitlab.io/gpsd/NMEA.html)
- [u-blox protocol documentation](https://www.u-blox.com/en/product-resources)
