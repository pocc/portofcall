# ADB (Android Debug Bridge) — Power User Reference

**Port:** 5037 (ADB server) | **Protocol:** Smart Socket (text-based) | **Transport:** TCP

Port of Call implements the ADB **smart socket** protocol — the text-based client-to-server protocol used by the `adb` command-line tool to communicate with the ADB server daemon on TCP port 5037. Four endpoints are provided: a generic command sender, a version probe, a device lister, and a remote shell executor.

---

## Two ADB Protocols — Know the Difference

ADB has two distinct protocol layers. This implementation covers only the first.

| Layer | Port | Protocol | Wire Format |
|-------|------|----------|-------------|
| **Smart socket** (client-to-server) | 5037 | Text-based | `[4-byte hex length][command]` |
| **Transport** (server-to-device) | 5555 | Binary | 24-byte header: command, arg0, arg1, data_length, data_crc32, magic |

The **smart socket protocol** (port 5037) is what an `adb` client sends to the local ADB server daemon. The server in turn speaks the **binary transport protocol** to the device over USB or TCP port 5555.

The binary transport protocol uses 24-byte message headers with these fields:

| Offset | Size | Field | Description |
|--------|------|-------|-------------|
| 0 | 4 | command | `CNXN`, `AUTH`, `OPEN`, `WRTE`, `CLSE`, `OKAY` (as uint32 LE) |
| 4 | 4 | arg0 | First argument (varies by command) |
| 8 | 4 | arg1 | Second argument (varies by command) |
| 12 | 4 | data_length | Length of data payload following the header |
| 16 | 4 | data_crc32 | CRC32 of the data payload (or 0 in newer versions) |
| 20 | 4 | magic | `command ^ 0xFFFFFFFF` (bitwise NOT) |

Binary transport handshake: the server sends `CNXN` (connection), device may respond with `AUTH` (requiring RSA key authentication), then `CNXN` on success. Streams are opened with `OPEN`, data is sent with `WRTE`, acknowledged with `OKAY`, and closed with `CLSE`.

**This implementation does NOT implement the binary transport protocol.** You cannot connect directly to a device on port 5555. You must connect to an ADB server on port 5037 that is already managing device transports.

---

## Smart Socket Wire Format

### Client-to-server (request)

```
[4-byte lowercase hex length][command string]
```

The length prefix is the **byte length** of the command string, encoded as 4 lowercase ASCII hex digits (`printf "%04x"` in the ADB C source). Example:

```
000chost:version
^^^^                 length prefix: 0x000c = 12 bytes
    ^^^^^^^^^^^^     command: "host:version" (12 bytes)
```

### Server-to-client (response)

```
OKAY[4-byte hex length][payload]
FAIL[4-byte hex length][error message]
```

The 4-byte status is always literal ASCII `OKAY` or `FAIL`. For data-bearing responses, a 4-byte hex length follows, then the payload. Some responses return `OKAY` with no trailing data (e.g., `host:transport`).

---

## API Endpoints

### `POST /api/adb/command` — Generic command

Connects to the ADB server, sends an arbitrary smart socket command, parses the response.

**POST body:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | -- | Required. Hostname or IP of the ADB server. |
| `port` | number | `5037` | |
| `command` | string | `"host:version"` | ADB smart socket command (e.g., `host:devices`) |
| `timeout` | number | `10000` | Total timeout in ms |

**Success (200):**
```json
{
  "success": true,
  "host": "build-server.local",
  "port": 5037,
  "command": "host:version",
  "status": "OKAY",
  "payload": "0029",
  "decodedVersion": "41 (0x0029)",
  "rtt": 23
}
```

`decodedVersion` is only present when the command is `host:version`.

**Failure:**
```json
{
  "success": false,
  "host": "build-server.local",
  "port": 5037,
  "command": "host:devices",
  "status": "FAIL",
  "payload": "device not found",
  "error": "device not found",
  "rtt": 15
}
```

---

### `POST /api/adb/version` — Version probe

Convenience endpoint that sends `host:version` and decodes the hex version number.

**POST body:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | -- | Required |
| `port` | number | `5037` | |
| `timeout` | number | `10000` | |

**Success (200):**
```json
{
  "success": true,
  "host": "build-server.local",
  "port": 5037,
  "protocolVersion": 41,
  "protocolVersionHex": "0029",
  "status": "OKAY",
  "rtt": 18
}
```

`protocolVersion` is the integer decode of the hex version string. Common values: 31 (older), 41 (modern Android SDK).

---

### `POST /api/adb/devices` — Device listing

Sends `host:devices-l` and parses the device list into structured JSON.

**POST body:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | -- | Required |
| `port` | number | `5037` | |
| `timeout` | number | `10000` | |

**Success (200):**
```json
{
  "success": true,
  "host": "build-server.local",
  "port": 5037,
  "deviceCount": 2,
  "devices": [
    {
      "serial": "emulator-5554",
      "state": "device",
      "properties": {
        "product": "sdk_gphone64_x86_64",
        "model": "sdk_gphone64_x86_64",
        "device": "emu64x",
        "transport_id": "1"
      }
    },
    {
      "serial": "192.168.1.100:5555",
      "state": "device",
      "properties": {
        "product": "flame",
        "model": "Pixel_4",
        "device": "flame",
        "transport_id": "3"
      }
    }
  ],
  "raw": "emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64x transport_id:1\n192.168.1.100:5555     device product:flame model:Pixel_4 device:flame transport_id:3\n",
  "rtt": 12
}
```

Device states: `device` (online), `offline`, `unauthorized` (needs USB debugging confirmation), `authorizing`, `no permissions`.

---

### `POST /api/adb/shell` — Remote shell command

Selects a device transport, then sends a `shell:` command and collects stdout.

**POST body:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | -- | Required. The ADB server host, not the device. |
| `port` | number | `5037` | |
| `serial` | string | `""` | Device serial. Empty = `host:transport-any` (first available). |
| `command` | string | -- | Required. Shell command (e.g., `getprop ro.build.version.release`). |
| `timeout` | number | `15000` | |

**Success (200):**
```json
{
  "success": true,
  "host": "build-server.local",
  "port": 5037,
  "serial": "emulator-5554",
  "command": "getprop ro.build.version.release",
  "stdout": "14\n",
  "rtt": 45
}
```

**Shell execution flow on the wire:**

```
1. Client → Server:  "001ahost:transport:emulator-5554"
2. Server → Client:  "OKAY"
3. Client → Server:  "0027shell:getprop ro.build.version.release"
4. Server → Client:  "OKAY"
5. Server → Client:  "14\n"          ← stdout stream
6. Server closes connection           ← shell exited
```

If `serial` is omitted or empty, step 1 uses `host:transport-any` instead.

---

## Smart Socket Command Reference

### Host commands (no device selection required)

| Command | Description |
|---------|-------------|
| `host:version` | Protocol version as 4-byte hex (e.g., `0029` = 41) |
| `host:devices` | List devices: `serial\tstate\n` per device |
| `host:devices-l` | Extended list: `serial\tstate\tprop:val ...` per device |
| `host:track-devices` | Long-lived: streams device connect/disconnect events |
| `host:kill` | Kills the ADB server process (destructive!) |
| `host:transport:<serial>` | Bind connection to a specific device |
| `host:transport-any` | Bind to any connected device |
| `host:transport-usb` | Bind to any USB-connected device |
| `host:transport-local` | Bind to any emulator/TCP device |
| `host:connect:<host>:<port>` | Connect to a device over TCP/IP |
| `host:disconnect:<host>:<port>` | Disconnect a TCP/IP device |
| `host-serial:<serial>:get-state` | Get state of a specific device |
| `host-serial:<serial>:get-devpath` | Get device path |
| `host-serial:<serial>:get-serialno` | Get serial number |
| `host:features` | List host features |
| `host:host-features` | List server features |
| `host:mdns:check` | Check mDNS status |
| `host:mdns:services` | List mDNS services |

### Device commands (after transport selection)

After sending `host:transport:<serial>` and receiving `OKAY`, the connection is bound to that device. These commands can then be sent:

| Command | Description |
|---------|-------------|
| `shell:<command>` | Run a shell command, stream stdout until exit |
| `shell:` | Open an interactive shell (stdin/stdout) |
| `sync:` | Enter file sync mode (push/pull files) |
| `reboot:` | Reboot the device |
| `reboot:bootloader` | Reboot into bootloader |
| `reboot:recovery` | Reboot into recovery |
| `remount:` | Remount /system as read-write |
| `root:` | Restart adbd with root permissions |
| `unroot:` | Restart adbd without root permissions |
| `tcp:<port>` | Forward a TCP connection to the device |
| `local:<path>` | Open a Unix domain socket on the device |
| `localfilesystem:<path>` | Open a file on the device |
| `framebuffer:` | Capture a screenshot (raw framebuffer) |
| `jdwp:<pid>` | Connect to a Java debug wire protocol port |
| `track-jdwp` | Track JDWP process list changes |

---

## Protocol Version History

| Hex | Decimal | Android SDK | Notes |
|-----|---------|-------------|-------|
| `001f` | 31 | SDK 24-25 | Older protocol |
| `0020` | 32 | SDK 26 | |
| `0029` | 41 | SDK 30+ | Modern protocol, feature negotiation |

The version number tracks the ADB protocol feature level, not the Android OS version. Use `host:features` to check specific feature support.

---

## curl Examples

```bash
# Check ADB server version
curl -s -X POST https://portofcall.ross.gg/api/adb/version \
  -H 'Content-Type: application/json' \
  -d '{"host":"build-server.local"}' | jq .

# List connected devices
curl -s -X POST https://portofcall.ross.gg/api/adb/devices \
  -H 'Content-Type: application/json' \
  -d '{"host":"build-server.local"}' | jq .

# Send arbitrary command
curl -s -X POST https://portofcall.ross.gg/api/adb/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"build-server.local","command":"host:features"}' | jq .

# Run a shell command on the first available device
curl -s -X POST https://portofcall.ross.gg/api/adb/shell \
  -H 'Content-Type: application/json' \
  -d '{"host":"build-server.local","command":"getprop ro.build.version.release"}' | jq .

# Run shell on a specific device
curl -s -X POST https://portofcall.ross.gg/api/adb/shell \
  -H 'Content-Type: application/json' \
  -d '{"host":"build-server.local","serial":"emulator-5554","command":"pm list packages -s"}' \
  | jq -r '.stdout'

# Connect a device over TCP/IP (device must have adb tcpip 5555 enabled)
curl -s -X POST https://portofcall.ross.gg/api/adb/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"build-server.local","command":"host:connect:192.168.1.100:5555"}' | jq .
```

---

## Useful Shell Commands

Commands that work well with the `/api/adb/shell` endpoint (short-lived, text output):

```
# Device info
getprop ro.build.version.release         # Android version (e.g., "14")
getprop ro.build.version.sdk             # API level (e.g., "34")
getprop ro.product.model                 # Device model
getprop ro.product.manufacturer          # Manufacturer
getprop ro.serialno                      # Hardware serial number
getprop ro.build.display.id              # Build ID

# Battery and power
dumpsys battery                          # Battery level, status, temperature
dumpsys power | head -20                 # Power manager state

# Network
ip addr show                             # Network interfaces
ip route show                            # Routing table
getprop dhcp.wlan0.dns1                  # DNS server
ping -c 3 8.8.8.8                        # Connectivity check (runs 3 pings)

# Storage
df -h                                    # Disk usage
du -sh /data/data/*                      # App data sizes (root required)

# Package management
pm list packages -s                      # System packages
pm list packages -3                      # Third-party packages
pm path com.example.app                  # APK path

# Process info
ps -A                                    # All processes
top -n 1                                 # Process snapshot
cat /proc/meminfo                        # Memory info
cat /proc/cpuinfo                        # CPU info

# Logging
logcat -d -t 50                          # Last 50 log lines (non-blocking)
logcat -d -s MyTag:V                     # Filter by tag (non-blocking)

# Display
dumpsys display | grep mBaseDisplayInfo  # Screen resolution and density
wm size                                  # Window manager display size
wm density                               # Display density

# Settings
settings get system screen_brightness    # Screen brightness
settings get secure android_id           # Android ID
settings get global airplane_mode_on     # Airplane mode state

# Activity
dumpsys activity activities | grep mResumedActivity  # Current foreground app
am start -n com.android.settings/.Settings           # Launch Settings app
input keyevent KEYCODE_HOME                          # Press Home button
```

Commands that **will not work** as expected:
- `logcat` (without `-d`): blocking/streaming -- will hit the timeout
- `top` (without `-n 1`): interactive/streaming -- will hit the timeout
- `shell:` (empty): interactive shell requires stdin, which is not provided

---

## Known Limitations

**Smart socket only (no direct device connection):** This implementation connects to the ADB server on port 5037. It cannot connect directly to a device on port 5555 using the binary transport protocol (CNXN/AUTH/OPEN/WRTE/CLSE). You must have an ADB server running and reachable on the target host.

**No authentication:** The ADB smart socket protocol on port 5037 has no authentication. Anyone who can reach the port can list devices, execute shell commands, install apps, and reboot devices. ADB servers are typically bound to localhost. If you expose one to the network, treat it as a root shell to all attached devices.

**`host:track-devices` will timeout:** This command opens a long-lived connection that streams device events. The `/api/adb/command` endpoint reads until the connection closes or the timeout expires, then returns whatever data was collected. It does not provide real-time streaming.

**`host:kill` is destructive:** Sends a kill signal to the ADB server process. The server will stop, all device transports will drop, and USB debugging sessions will disconnect. The server must be restarted (`adb start-server`).

**Shell commands are one-shot:** The `/api/adb/shell` endpoint sends a command, collects stdout until the connection closes, then returns. There is no stdin. Interactive commands (vi, top without -n, logcat without -d) will hang until the timeout fires.

**No stderr separation:** ADB shell over the smart socket protocol merges stdout and stderr into a single stream. The `stdout` field in the response contains both.

**No exit code:** The ADB smart socket shell protocol does not convey the exit code of the command. If you need the exit code, append `; echo $?` to the command and parse the last line.

**Binary output corrupted:** All output is decoded with `TextDecoder` (UTF-8). Shell commands that produce binary output (e.g., `screencap -p`) will be corrupted. Use `base64` encoding on-device if you need binary data: `screencap -p | base64`.

**No TLS:** Connections are plain TCP. ADB has no built-in encryption for the smart socket protocol.

**Single-connection-per-request:** Each API call opens and closes a TCP connection. There is no connection pooling.

---

## Security Considerations

ADB servers exposed to the network are a critical security risk:

- **No authentication** on the smart socket protocol (port 5037)
- Any connected device can be fully controlled (shell, install, reboot, data exfiltration)
- `adb tcpip 5555` on a device exposes it to the network (the binary transport protocol has RSA key auth, but keys are often auto-accepted)
- Port 5037 should **never** be exposed to the public internet

Port of Call's Cloudflare detection blocks connections to Cloudflare-proxied hosts, but cannot prevent connections to publicly exposed ADB servers on direct IPs.

---

## ADB Binary Transport Protocol Reference

For completeness, here is the binary transport protocol (port 5555) that this implementation does **not** support:

### Message format (24 bytes)

```
struct adb_message {
    uint32_t command;       // A_CNXN, A_AUTH, A_OPEN, A_WRTE, A_CLSE, A_OKAY
    uint32_t arg0;          // first argument
    uint32_t arg1;          // second argument
    uint32_t data_length;   // length of data payload
    uint32_t data_crc32;    // CRC32 of data payload (0 in v2+)
    uint32_t magic;         // command ^ 0xFFFFFFFF
};
```

All fields are little-endian uint32.

### Command constants

| Command | Hex | Magic | Description |
|---------|-----|-------|-------------|
| `CNXN` | `0x4e584e43` | `0xb1a7b1bc` | Connection request/response |
| `AUTH` | `0x48545541` | `0xb7abaaae` | Authentication challenge/response |
| `OPEN` | `0x4e45504f` | `0xb1bab1b0` | Open a new stream |
| `OKAY` | `0x59414b4f` | `0xa6beb4b0` | Stream ready / data acknowledged |
| `WRTE` | `0x45545257` | `0xbaabad8a` | Write data to stream |
| `CLSE` | `0x45534c43` | `0xbaacb3bc` | Close a stream |

### Connection handshake

```
Host → Device:  CNXN(version=0x01000001, max_payload=256*1024, "host::features=...")
Device → Host:  AUTH(type=TOKEN, data=<20-byte random token>)
Host → Device:  AUTH(type=SIGNATURE, data=<RSA signature of token>)
Device → Host:  CNXN(version=0x01000001, max_payload=..., "device::...")   # success
```

If the device has not seen this host's RSA public key before, it shows a "Allow USB debugging?" dialog. The host sends `AUTH(type=RSAPUBLICKEY, data=<public key>)` and waits for user confirmation.

### Shell command (binary protocol)

```
Host → Device:  OPEN(local_id=1, remote_id=0, "shell:ls /sdcard")
Device → Host:  OKAY(remote_id=1, local_id=42)
Device → Host:  WRTE(remote_id=1, local_id=42, data="file1.txt\nfile2.jpg\n")
Host → Device:  OKAY(remote_id=42, local_id=1)
Device → Host:  CLSE(remote_id=1, local_id=42)
Host → Device:  CLSE(remote_id=42, local_id=1)
```

---

## Resources

- [ADB protocol overview (AOSP)](https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/OVERVIEW.TXT)
- [ADB transport protocol spec (AOSP)](https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/protocol.txt)
- [ADB smart socket protocol (AOSP services.txt)](https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/SERVICES.TXT)
- [ADB source code](https://android.googlesource.com/platform/packages/modules/adb/)
- [Android developer ADB docs](https://developer.android.com/tools/adb)
