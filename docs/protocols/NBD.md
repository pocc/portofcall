# NBD — Network Block Device (port 10809)

Implementation: `src/worker/nbd.ts` (1089 lines)
Routes: `src/worker/index.ts` lines TBD
Tests: `tests/nbd.test.ts` (validation only — no live-target tests)

Three endpoints: `/probe` (lightweight magic detection), `/connect` (full handshake + export listing), and `/read` (block data read), `/write` (block data write). All operate over raw TCP via `cloudflare:sockets`. NBD (Network Block Device) is a Linux protocol for accessing remote block devices over TCP, commonly used by QEMU/KVM, nbd-server, and storage appliances.

---

## Endpoints

### POST /api/nbd/probe

Lightweight NBD detection: connects, reads 18-byte handshake, disconnects. Use this for fast protocol detection without negotiation overhead.

**Request:**

```json
{
  "host": "storage.example.com",
  "port": 10809,
  "timeout": 10000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | *required* | Target hostname or IP. |
| `port` | `10809` | Standard NBD port. Range validated (1-65535). |
| `timeout` | `10000` | ms. Wraps entire operation (connect + handshake read). |

**Success response (200):**

```json
{
  "success": true,
  "host": "storage.example.com",
  "port": 10809,
  "rtt": 23,
  "isNBD": true,
  "isNewstyle": true,
  "fixedNewstyle": true,
  "noZeroes": true,
  "message": "NBD server detected (newstyle)."
}
```

| Field | Notes |
|-------|-------|
| `isNBD` | `true` if magic bytes match `NBDMAGIC` (0x4e42444d41474943). |
| `isNewstyle` | `true` if server sent `IHAVEOPT` (0x49484156454f5054) — supports option negotiation. |
| `fixedNewstyle` | `true` if server set `NBD_FLAG_FIXED_NEWSTYLE` (bit 0) in handshake flags. |
| `noZeroes` | `true` if server set `NBD_FLAG_NO_ZEROES` (bit 1) — skips 124-byte zero padding after export info. |

**Non-NBD response (200):**

```json
{
  "success": true,
  "isNBD": false,
  "message": "Not an NBD server."
}
```

**HTTP status codes:**
- 200: success (NBD or non-NBD)
- 400: missing host or invalid port
- 403: Cloudflare IP blocked
- 500: connection timeout, socket error, read error

---

### POST /api/nbd/connect

Full NBD handshake with export listing. Performs newstyle negotiation, sends `NBD_OPT_LIST` to enumerate available exports (block devices), then sends `NBD_OPT_ABORT` to cleanly terminate.

**Request:**

```json
{
  "host": "storage.example.com",
  "port": 10809,
  "timeout": 10000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | *required* | Target hostname or IP. |
| `port` | `10809` | Standard NBD port. Range validated (1-65535). |
| `timeout` | `10000` | ms. Wraps entire operation (connect + handshake + list + abort). |

**Success response (200):**

```json
{
  "success": true,
  "host": "storage.example.com",
  "port": 10809,
  "rtt": 42,
  "connectTime": 18,
  "isNBD": true,
  "isNewstyle": true,
  "fixedNewstyle": true,
  "noZeroes": true,
  "handshakeFlags": 3,
  "exports": [
    "export1",
    "backup-disk",
    "(default)"
  ],
  "rawBytesReceived": 18,
  "message": "NBD server detected (newstyle, fixed). 3 export(s) found."
}
```

| Field | Notes |
|-------|-------|
| `rtt` | Total round-trip time from connect to final abort (ms). |
| `connectTime` | Time from socket.connect() to socket.opened resolution (ms). |
| `handshakeFlags` | Raw 16-bit flags from server handshake (big-endian). Bit 0 = fixed newstyle, bit 1 = no zeroes. |
| `exports` | Array of export names. `"(default)"` indicates an unnamed export. Max 100 exports returned. |
| `rawBytesReceived` | Length of handshake data (always 18 bytes for newstyle). |
| `listError` | *(optional)* Error message if `NBD_OPT_LIST` failed (e.g., "Server does not support export listing"). |

**Server error response (200):**

If the server supports listing but returns an error reply (e.g., `NBD_REP_ERR_UNSUP`), the response includes `listError`:

```json
{
  "success": true,
  "exports": [],
  "listError": "Server does not support export listing",
  "message": "NBD server detected (newstyle, fixed). "
}
```

**Non-NBD response (200):**

```json
{
  "success": true,
  "isNBD": false,
  "message": "Server responded but does not appear to be an NBD server."
}
```

**HTTP status codes:**
- 200: success (NBD or non-NBD)
- 400: missing host or invalid port
- 403: Cloudflare IP blocked
- 500: connection timeout, socket error, protocol error

---

### POST /api/nbd/read

Block-level read operation. Performs full NBD newstyle negotiation, selects an export via `NBD_OPT_EXPORT_NAME`, enters transmission mode, sends a `NBD_CMD_READ` request, reads the block data, then disconnects cleanly with `NBD_CMD_DISCONNECT`. Returns a hex dump and analysis of the block data.

**Request:**

```json
{
  "host": "storage.example.com",
  "port": 10809,
  "export_name": "disk1",
  "offset": 0,
  "read_size": 512,
  "timeout": 15000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | *required* | Target hostname or IP. |
| `port` | `10809` | Standard NBD port. |
| `export_name` | `""` (default) | Export name. Empty string selects default export. |
| `offset` | `0` | Byte offset to read from. Must be non-negative. No alignment requirement enforced by client (server may reject misaligned offsets). |
| `read_size` | `512` | Number of bytes to read. Range: 1–65536. Common values: 512 (sector), 4096 (page). |
| `length` | `512` | Alias for `read_size`. If both provided, `read_size` takes precedence. |
| `timeout` | `15000` | ms. Wraps entire operation (connect + negotiate + read + disconnect). |

**Success response (200):**

```json
{
  "success": true,
  "host": "storage.example.com",
  "port": 10809,
  "rtt": 68,
  "exportName": "disk1",
  "exportSize": "107374182400",
  "transmissionFlags": 1,
  "offset": 0,
  "readSize": 512,
  "bytesRead": 512,
  "isAllZero": false,
  "uniqueByteValues": 87,
  "hexDump": "0000  eb 63 90 10 8e d0 bc 00  |.c......|\n0008  b0 b8 00 00 8e d8 8e c0  |........|\n...",
  "rawHex": "eb 63 90 10 8e d0 bc 00 b0 b8 00 00 8e d8 8e c0 ...",
  "message": "Read 512 bytes at offset 0 from export 'disk1'"
}
```

| Field | Notes |
|-------|-------|
| `exportSize` | Total export size in bytes (64-bit unsigned, returned as string to avoid JavaScript integer overflow). |
| `transmissionFlags` | 16-bit flags from export info. Bit 0 = `NBD_FLAG_HAS_FLAGS` (always 1), bit 1 = `NBD_FLAG_READ_ONLY`, bit 2 = `NBD_FLAG_SEND_FLUSH`, bit 3 = `NBD_FLAG_SEND_FUA`, bit 4 = `NBD_FLAG_ROTATIONAL`, bit 5 = `NBD_FLAG_SEND_TRIM`, bit 6 = `NBD_FLAG_SEND_WRITE_ZEROES`, bit 7 = `NBD_FLAG_SEND_DF`, bit 8 = `NBD_FLAG_CAN_MULTI_CONN`, bit 9 = `NBD_FLAG_SEND_RESIZE`, bit 10 = `NBD_FLAG_SEND_CACHE`. |
| `isAllZero` | `true` if all bytes are 0x00 (unallocated/sparse block). |
| `uniqueByteValues` | Number of distinct byte values (0–256). Useful for entropy estimation. |
| `hexDump` | Hex dump with ASCII sidebar (max 512 bytes displayed). Format: `OFFSET  HEX BYTES  \|ASCII\|`. |
| `rawHex` | Space-separated hex bytes (max 1024 characters = first 512 bytes). |

**Read error response (200):**

If the server returns a non-zero error code in the reply:

```json
{
  "success": false,
  "error": "NBD server returned error code: 5 (errno 5)",
  "exportSize": "107374182400",
  "transmissionFlags": 1
}
```

Common NBD error codes (errno values):
- `1` (`EPERM`): Operation not permitted
- `5` (`EIO`): I/O error
- `12` (`ENOMEM`): Out of memory
- `22` (`EINVAL`): Invalid argument (e.g., misaligned offset)
- `28` (`ENOSPC`): No space left on device
- `30` (`EROFS`): Read-only file system (attempted write on read-only export)

**Protocol error responses (502):**

Magic mismatch:
```json
{
  "success": false,
  "error": "Invalid NBD reply magic: 0x12345678 (expected 0x67446698)"
}
```

Handle mismatch (RFC 7143 violation):
```json
{
  "success": false,
  "error": "Handle mismatch: received 0xabcdef1234567890, expected 0x1234567890abcdef"
}
```

Non-NBD server:
```json
{
  "success": false,
  "error": "Server does not speak the NBD protocol",
  "rawHex": "48 54 54 50 2f 31 2e 31 ..."
}
```

Unsupported server:
```json
{
  "success": false,
  "error": "NBD server does not support fixed newstyle negotiation required for export selection",
  "isNBD": true,
  "isNewstyle": false,
  "fixedNewstyle": false
}
```

**HTTP status codes:**
- 200: success (block read succeeded or server returned NBD error)
- 400: missing host, invalid port, invalid `read_size` (not 1–65536), negative `offset`
- 403: Cloudflare IP blocked
- 502: protocol violation (non-NBD server, magic mismatch, handle mismatch)
- 500: connection timeout, socket error

---

### POST /api/nbd/write

Block-level write operation. Performs full NBD newstyle negotiation, selects an export via `NBD_OPT_EXPORT_NAME`, enters transmission mode, checks for read-only flag, sends a `NBD_CMD_WRITE` request with data, then disconnects cleanly.

**Request:**

```json
{
  "host": "storage.example.com",
  "port": 10809,
  "export_name": "disk1",
  "offset": 512,
  "data": "deadbeefcafebabe",
  "timeout": 15000
}
```

Or with byte array:

```json
{
  "host": "storage.example.com",
  "port": 10809,
  "export_name": "disk1",
  "offset": 512,
  "data": [222, 173, 190, 239, 202, 254, 186, 190],
  "timeout": 15000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | *required* | Target hostname or IP. |
| `port` | `10809` | Standard NBD port. |
| `export_name` | `""` (default) | Export name. Empty string selects default export. |
| `offset` | `0` | Byte offset to write to. Must be non-negative. |
| `data` | *required* | Hex string (e.g., `"deadbeef"`) or array of byte values (0–255). Hex string may have `0x` prefix and whitespace (stripped). Length: 1–65536 bytes. |
| `timeout` | `15000` | ms. Wraps entire operation (connect + negotiate + write + disconnect). |

**Success response (200):**

```json
{
  "success": true,
  "host": "storage.example.com",
  "port": 10809,
  "rtt": 71,
  "exportName": "disk1",
  "exportSize": "107374182400",
  "transmissionFlags": 0,
  "offset": 512,
  "bytesWritten": 8,
  "message": "Successfully wrote 8 bytes at offset 512 to export 'disk1'"
}
```

| Field | Notes |
|-------|-------|
| `bytesWritten` | Number of bytes written (always equals `data.length`). |

**Read-only export response (200):**

If the export has `NBD_FLAG_READ_ONLY` set (bit 1 of `transmissionFlags`):

```json
{
  "success": false,
  "error": "NBD export is read-only (NBD_FLAG_READ_ONLY is set)",
  "exportSize": "107374182400",
  "transmissionFlags": 2
}
```

**Write error response (200):**

If the server returns a non-zero error code:

```json
{
  "success": false,
  "error": "NBD server returned write error code: 28 (errno 28)",
  "exportSize": "107374182400",
  "transmissionFlags": 0
}
```

**Invalid data format (400):**

```json
{
  "success": false,
  "error": "data hex string contains invalid characters"
}
```

```json
{
  "success": false,
  "error": "data length must be between 1 and 65536 bytes"
}
```

**HTTP status codes:**
- 200: success or NBD error (read-only, server write error)
- 400: missing host/data, invalid port, invalid `data` format, invalid `data` length, negative `offset`
- 403: Cloudflare IP blocked
- 502: protocol violation (non-NBD server, magic mismatch, handle mismatch)
- 500: connection timeout, socket error

---

## Protocol Details

### Newstyle Handshake (RFC 7143)

1. **Server sends 18 bytes:**
   - `NBDMAGIC` (8 bytes): `0x4e42444d41474943` ("NBDMAGIC")
   - `IHAVEOPT` (8 bytes): `0x49484156454f5054` ("IHAVEOPT")
   - Handshake flags (2 bytes, big-endian):
     - Bit 0: `NBD_FLAG_FIXED_NEWSTYLE` — server supports fixed newstyle negotiation
     - Bit 1: `NBD_FLAG_NO_ZEROES` — server skips 124-byte zero padding after export info

2. **Client sends 4 bytes (client flags):**
   - Bit 0: `NBD_FLAG_C_FIXED_NEWSTYLE` — client wants fixed newstyle (required for export listing)
   - Bit 1: `NBD_FLAG_C_NO_ZEROES` — client wants to skip zero padding (must match server)

3. **Option negotiation:** Client sends option requests, server sends option replies.

### Option Request Format

All option requests use this structure:

```
IHAVEOPT magic (8 bytes): 0x49484156454f5054
Option type (4 bytes, big-endian)
Data length (4 bytes, big-endian)
Data (variable)
```

Option types:
- `NBD_OPT_EXPORT_NAME` (1): Select export and enter transmission mode (no reply, transitions immediately)
- `NBD_OPT_ABORT` (2): Terminate negotiation
- `NBD_OPT_LIST` (3): Request export list

### Option Reply Format

Option replies (not sent for `NBD_OPT_EXPORT_NAME`):

```
Reply magic (8 bytes): 0x0003e889045565a9
Option type (4 bytes, big-endian): echoed from request
Reply type (4 bytes, big-endian)
Data length (4 bytes, big-endian)
Data (variable)
```

Reply types:
- `NBD_REP_ACK` (1): Success, end of list
- `NBD_REP_SERVER` (2): Export info (contains 4-byte name length + name)
- `NBD_REP_ERR_UNSUP` (0x80000001): Option not supported
- Other error codes have bit 31 set

### Transmission Phase

After `NBD_OPT_EXPORT_NAME`, server sends export info:

```
Export size (8 bytes, big-endian): total size in bytes
Transmission flags (2 bytes, big-endian): capabilities
Zero padding (124 bytes): if NBD_FLAG_NO_ZEROES not set
```

Then client can send transmission requests:

**READ request (28 bytes):**
```
Magic (4 bytes): 0x25609513 (NBD_REQUEST_MAGIC)
Flags (2 bytes): command flags
Type (2 bytes): 0x0000 (NBD_CMD_READ)
Handle (8 bytes): request identifier (client-chosen, server echoes)
Offset (8 bytes, big-endian): byte offset
Length (4 bytes, big-endian): number of bytes to read
```

**WRITE request (28 + data length bytes):**
```
Magic (4 bytes): 0x25609513
Flags (2 bytes): command flags
Type (2 bytes): 0x0001 (NBD_CMD_WRITE)
Handle (8 bytes): request identifier
Offset (8 bytes, big-endian): byte offset
Length (4 bytes, big-endian): number of bytes to write
Data (variable): payload
```

**DISCONNECT request (28 bytes):**
```
Magic (4 bytes): 0x25609513
Flags (2 bytes): 0
Type (2 bytes): 0x0002 (NBD_CMD_DISCONNECT)
Handle (8 bytes): 0
Offset (8 bytes): 0
Length (4 bytes): 0
```

**Reply header (16 + data bytes for reads):**
```
Magic (4 bytes): 0x67446698 (NBD_REPLY_MAGIC)
Error (4 bytes, big-endian): 0 for success, errno for failure
Handle (8 bytes): echoed from request
Data (variable): for READ commands only
```

**CRITICAL:** The client MUST validate the reply handle matches the request handle (RFC 7143 §2.6.2). Mismatched handles indicate response mixing or protocol desynchronization.

### Transmission Flags

Bit flags in export info (16-bit field):

- Bit 0: `NBD_FLAG_HAS_FLAGS` (always 1 in newstyle)
- Bit 1: `NBD_FLAG_READ_ONLY` — writes prohibited
- Bit 2: `NBD_FLAG_SEND_FLUSH` — server supports flush
- Bit 3: `NBD_FLAG_SEND_FUA` — server supports force unit access
- Bit 4: `NBD_FLAG_ROTATIONAL` — storage is rotational (HDD vs SSD hint)
- Bit 5: `NBD_FLAG_SEND_TRIM` — server supports trim/discard
- Bit 6: `NBD_FLAG_SEND_WRITE_ZEROES` — server supports efficient zero writes
- Bit 7: `NBD_FLAG_SEND_DF` — server supports don't fragment
- Bit 8: `NBD_FLAG_CAN_MULTI_CONN` — export supports multiple connections
- Bit 9: `NBD_FLAG_SEND_RESIZE` — server supports block device resize
- Bit 10: `NBD_FLAG_SEND_CACHE` — server supports cache control

---

## Implementation Notes

### Data Structures

All multi-byte integers use **network byte order (big-endian)** per NBD spec. The implementation uses `DataView` with `false` (big-endian) for all `setUint*/getUint*` calls.

### Resource Management

All three endpoints properly clean up resources:
- Timeouts are cleared with `clearTimeout(timeoutId)` on all code paths (success, error, early return)
- Reader/writer locks are released before socket close
- Socket is closed in all exit paths (success, protocol error, timeout)

### Buffer Handling

`readExact(reader, needed, timeoutPromise)` reads exactly `needed` bytes from the stream, trimming any overshoot from the final chunk. This prevents protocol desynchronization when TCP delivers more data than expected.

Export listing uses buffered reading with a **1MB limit** on reply data length to prevent memory exhaustion attacks. Malicious servers sending huge `dataLen` values will trigger an error instead of allocating gigabytes.

### Security

- **Input validation:** All user inputs are validated (host presence, port range 1–65535, offset non-negative, data length 1–65536, hex string format).
- **Cloudflare protection:** Requests to Cloudflare IPs are blocked with 403 (prevents recursion/abuse).
- **Handle validation:** Reply handles are verified against request handles to detect response mixing (RFC 7143 §2.6.2 compliance).
- **Hex parsing:** Write data hex strings are validated for legal characters (`[0-9a-fA-F]`) before parsing. Invalid hex triggers a 400 error instead of silent `NaN` corruption.
- **Timeout enforcement:** All socket operations are wrapped in a race against a timeout promise. The timeout is properly cleared on all paths to avoid resource leaks.

### Error Handling

- **Connection errors:** `socket.opened` timeout, DNS failure, connection refused → 500 with error message
- **Protocol errors:** Wrong magic bytes, unsupported negotiation → 502 (Bad Gateway)
- **NBD errors:** Server returns non-zero errno → 200 with `success: false` and error message (not a protocol violation, just a failed read/write)
- **Validation errors:** Missing/invalid parameters → 400
- **Cloudflare blocks:** → 403

### Limitations

- **No TLS support:** NBD has no native encryption. Use SSH tunneling or VPN for secure remote access.
- **No oldstyle support:** Only fixed newstyle negotiation is implemented. Oldstyle NBD servers (pre-2012) will fail with "does not support fixed newstyle" error.
- **No structured replies:** Structured reply extension (NBD_OPT_STRUCTURED_REPLY) is not negotiated. All reads use simple replies.
- **No metadata queries:** NBD_OPT_INFO / NBD_OPT_GO not implemented. Export size/flags are obtained via NBD_OPT_EXPORT_NAME.
- **No block status:** NBD_CMD_BLOCK_STATUS not implemented. Cannot query extent maps or hole locations.
- **No export description:** Export listing returns names only, not descriptions (NBD_REP_SERVER data is name length + name, no metadata).
- **Max 100 exports:** Export listing stops after 100 entries to prevent DoS via infinite lists.
- **Max 1MB reply data:** Individual option replies capped at 1MB to prevent memory exhaustion.
- **Max 65536 byte transfers:** Read/write operations limited to 64KB per request (common NBD client limit).
- **No request pipelining:** Only one transmission command is sent per connection (read or write, then disconnect).

### Common Use Cases

**1. Server detection:**
```bash
curl -X POST https://portofcall.gg/api/nbd/probe \
  -H "Content-Type: application/json" \
  -d '{"host":"192.168.1.100","port":10809}'
```

**2. Export discovery:**
```bash
curl -X POST https://portofcall.gg/api/nbd/connect \
  -H "Content-Type: application/json" \
  -d '{"host":"nas.local"}'
```

**3. MBR boot sector read:**
```bash
curl -X POST https://portofcall.gg/api/nbd/read \
  -H "Content-Type: application/json" \
  -d '{"host":"nas.local","export_name":"vm-disk","offset":0,"read_size":512}'
```

**4. GPT header read:**
```bash
curl -X POST https://portofcall.gg/api/nbd/read \
  -H "Content-Type: application/json" \
  -d '{"host":"nas.local","export_name":"vm-disk","offset":512,"read_size":512}'
```

**5. Forensic superblock read (ext4 at offset 1024):**
```bash
curl -X POST https://portofcall.gg/api/nbd/read \
  -H "Content-Type: application/json" \
  -d '{"host":"evidence.local","export_name":"suspect-disk","offset":1024,"read_size":1024}'
```

**6. Patch boot sector (write MBR signature):**
```bash
curl -X POST https://portofcall.gg/api/nbd/write \
  -H "Content-Type: application/json" \
  -d '{"host":"nas.local","export_name":"blank-disk","offset":510,"data":"55aa"}'
```

---

## Testing

Run validation tests:
```bash
npm test tests/nbd.test.ts
```

Tests cover:
- Request validation (missing host, invalid port)
- Cloudflare blocking
- Mock server scenarios (non-NBD service, timeout)

No live-target tests are included (requires NBD server setup).

---

## References

- **RFC 7143:** Network Block Device (NBD) Protocol
- **NBD Protocol Specification:** https://github.com/NetworkBlockDevice/nbd/blob/master/doc/proto.md
- **nbd-server:** https://nbd.sourceforge.io/
- **QEMU NBD:** https://www.qemu.org/docs/master/tools/qemu-nbd.html

---

## Changelog

### 2026-02-18: Bug Fixes
- **CRITICAL:** Fixed `readExact` buffer overshoot — now returns exactly `needed` bytes instead of all accumulated chunks
- **SECURITY:** Added 1MB limit on option reply data length to prevent memory exhaustion attacks
- **RFC VIOLATION:** Added handle validation in read/write responses per RFC 7143 §2.6.2
- **RESOURCE LEAK:** Added timeout cleanup with `clearTimeout()` on all code paths
- **VALIDATION:** Added offset non-negative check for read/write operations
- **VALIDATION:** Added hex string character validation before parsing (prevents silent `NaN` corruption)
- **BUG:** Fixed hex dump ASCII sidebar to use `<= 0x7e` instead of `< 0x7f` for correct printable range
- **COMMENT:** Added big-endian byte order comments to all `DataView` calls for clarity

### 2026-01-XX: Initial Implementation
- Implemented NBD newstyle handshake (RFC 7143)
- Added export listing via NBD_OPT_LIST
- Added block read via NBD_CMD_READ with hex dump output
- Added block write via NBD_CMD_WRITE with hex/array data support
