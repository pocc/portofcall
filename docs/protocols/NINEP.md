# 9P (Plan 9 Filesystem Protocol) — Power User Reference

**Port:** 564 (default) | **Protocol:** 9P2000 (binary, little-endian) | **RFC:** N/A (Plan 9 spec)

Port of Call provides four 9P endpoints for probing and interacting with 9P2000 filesystem servers. These are commonly found in QEMU (virtio-9p), WSL2, Plan 9 systems, and various Linux/BSD systems using v9fs or diod.

---

## API Endpoints

### `POST /api/9p/connect` — Version negotiation probe

Performs a full 9P2000 handshake: Tversion/Rversion negotiation with msize=8192, then optionally Tattach to mount the root filesystem and retrieve the root QID.

**POST body:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | — | Required. Alphanumeric + dots/hyphens only |
| `port` | number | `564` | Standard 9P port. Range: 1-65535 |
| `timeout` | number | `10000` | Total timeout in ms (max: no enforced limit) |

**Success (200):**
```json
{
  "success": true,
  "version": "9P2000",
  "msize": 8192,
  "serverVersion": "9P2000",
  "rootQid": {
    "type": 128,
    "version": 0,
    "path": "0x0000000000000001"
  }
}
```

**Response fields:**
- `version` — client-requested version string (always `"9P2000"`)
- `msize` — negotiated max message size (server's choice, ≤ 8192)
- `serverVersion` — server's version string (usually `"9P2000"`, `"9P2000.u"`, or `"9P2000.L"`)
- `rootQid` — QID of the root directory (only present if Tattach succeeds)
  - `type` — QID type byte (bit 7 = directory, bit 0 = append-only, etc.)
  - `version` — version number for cache coherency
  - `path` — 64-bit unique file identifier (hex string)

**Error (200 with success=false):**
```json
{
  "success": false,
  "error": "9P server error: authentication required"
}
```

**Validation error (400):**
```json
{
  "success": false,
  "error": "Host contains invalid characters"
}
```

**Fatal error (500):**
```json
{
  "success": false,
  "error": "Connection timeout"
}
```

**Notes:**
- The Tattach uses `fid=0`, `afid=NOFID` (0xffffffff = no auth), `uname="anonymous"`, `aname=""` (default export)
- If the server returns `Rerror` to Tattach (e.g. auth required), the response still reports `success: true` with the version info but includes `error: "Attach failed: ..."`
- `serverVersion` is extracted from the Rversion body. If it's `"unknown"`, the Tattach step is skipped.

---

### `POST /api/9p/stat` — Walk and stat a file or directory

Walks to a given path (relative to root) and retrieves its stat structure. Performs: Tversion → Tattach (fid=1) → Twalk (if path is non-root) → Tstat → Tclunk.

**POST body:**
```json
{
  "host": "9p.example.com",
  "port": 564,
  "path": "usr/local/bin",
  "timeout": 10000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | — | Required |
| `port` | number | `564` | |
| `path` | string | `""` | Slash-separated path. Empty or `/` = root. Leading/trailing slashes stripped |
| `timeout` | number | `10000` | Max: 30000 ms |

**Success (200):**
```json
{
  "success": true,
  "host": "9p.example.com",
  "port": 564,
  "path": "/usr/local/bin",
  "stat": {
    "type": 0,
    "dev": 0,
    "qid": { "type": 128, "version": 0, "path": "0x00000000000003e8" },
    "mode": 2147484141,
    "atime": 1707955200,
    "mtime": 1707955200,
    "length": "4096",
    "name": "bin",
    "uid": "root",
    "gid": "wheel",
    "muid": "root"
  }
}
```

**Stat structure fields:**
- `type` — server type (for kernel use; typically 0)
- `dev` — device number (typically 0)
- `qid` — unique file identifier
- `mode` — permission bits + file type (Plan 9 format: high bits = directory/append/exclusive)
- `atime` — last access time (Unix timestamp, seconds)
- `mtime` — last modification time
- `length` — file size in bytes (string to support >2^53)
- `name` — basename (final path component)
- `uid` — owner username
- `gid` — group name
- `muid` — last modifier username

**Mode bits (Plan 9 format):**
| Bit | Hex | Meaning |
|-----|-----|---------|
| 31 | 0x80000000 | Directory (DMDIR) |
| 30 | 0x40000000 | Append-only (DMAPPEND) |
| 29 | 0x20000000 | Exclusive use (DMEXCL) |
| 27 | 0x08000000 | Auth file (DMAUTH) |
| 26 | 0x04000000 | Temporary (DMTMP) |
| 0-8 | 0x1FF | Unix permission bits (rwxrwxrwx) |

Example: `mode=2147484141` (0x80000FED) = directory (bit 31) + 0755 permissions

**Walk error:**
```json
{
  "success": false,
  "error": "Walk failed: file not found"
}
```

**curl example:**
```bash
# Stat the root
curl -s -X POST https://portofcall.ross.gg/api/9p/stat \
  -H 'Content-Type: application/json' \
  -d '{"host":"9p.example.com","port":564,"path":""}' | jq .

# Stat a nested path
curl -s -X POST https://portofcall.ross.gg/api/9p/stat \
  -H 'Content-Type: application/json' \
  -d '{"host":"9p.example.com","path":"home/user/.profile"}' | jq '.stat'
```

---

### `POST /api/9p/read` — Read file contents

Walks to a file, opens it for reading (mode 0), reads up to `count` bytes at `offset`, and clunks the fid. Returns data as base64.

**POST body:**
```json
{
  "host": "9p.example.com",
  "port": 564,
  "path": "etc/motd",
  "offset": 0,
  "count": 4096,
  "timeout": 15000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | — | Required |
| `port` | number | `564` | |
| `path` | string | — | **Required**. Cannot be empty (use `/api/9p/ls` for directories) |
| `offset` | number | `0` | Byte offset to start reading. Min: 0 |
| `count` | number | `4096` | Max bytes to read. Range: 1-65536 |
| `timeout` | number | `15000` | Max: 30000 ms |

**Success (200):**
```json
{
  "success": true,
  "host": "9p.example.com",
  "port": 564,
  "path": "/etc/motd",
  "offset": 0,
  "bytesRead": 42,
  "data": "V2VsY29tZSB0byBQbGFuIDkhCg==",
  "encoding": "base64"
}
```

**Response:**
- `bytesRead` — actual bytes returned (may be less than `count` if EOF reached)
- `data` — file contents encoded as base64
- `encoding` — always `"base64"`

**Decode in shell:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/9p/read \
  -H 'Content-Type: application/json' \
  -d '{"host":"9p.example.com","path":"etc/motd"}' \
  | jq -r '.data' | base64 -d
```

**Reading large files:**
The `count` parameter is capped at 65536 bytes. To read larger files, issue multiple requests with increasing `offset`:
```bash
# Read first 64KB
curl ... -d '{"host":"...","path":"bigfile","offset":0,"count":65536}'
# Read next 64KB
curl ... -d '{"host":"...","path":"bigfile","offset":65536,"count":65536}'
```

**Error: directory opened for read:**
```json
{
  "success": false,
  "error": "Read failed: is a directory"
}
```

---

### `POST /api/9p/ls` — List directory contents

Opens a directory for reading and retrieves the stat records for all entries. In 9P, reading a directory returns concatenated stat structures.

**POST body:**
```json
{
  "host": "9p.example.com",
  "port": 564,
  "path": "usr/local",
  "timeout": 15000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | — | Required |
| `port` | number | `564` | |
| `path` | string | `""` | Directory path. Empty = root. Leading/trailing slashes stripped |
| `timeout` | number | `15000` | Max: 30000 ms |

**Success (200):**
```json
{
  "success": true,
  "host": "9p.example.com",
  "port": 564,
  "path": "/usr/local",
  "count": 3,
  "entries": [
    {
      "type": 0,
      "dev": 0,
      "qid": { "type": 128, "version": 0, "path": "0x00000000000003e8" },
      "mode": 2147484141,
      "atime": 1707955200,
      "mtime": 1707955200,
      "length": "4096",
      "name": "bin",
      "uid": "root",
      "gid": "wheel",
      "muid": "root"
    },
    {
      "type": 0,
      "dev": 0,
      "qid": { "type": 128, "version": 0, "path": "0x00000000000003e9" },
      "mode": 2147484141,
      "atime": 1707955200,
      "mtime": 1707955200,
      "length": "4096",
      "name": "lib",
      "uid": "root",
      "gid": "wheel",
      "muid": "root"
    },
    {
      "type": 0,
      "dev": 0,
      "qid": { "type": 128, "version": 0, "path": "0x00000000000003ea" },
      "mode": 2147484141,
      "atime": 1707955200,
      "mtime": 1707955200,
      "length": "4096",
      "name": "share",
      "uid": "root",
      "gid": "wheel",
      "muid": "root"
    }
  ]
}
```

**Response:**
- `count` — number of entries returned
- `entries` — array of stat structures (same format as `/api/9p/stat`)

**Filter directories:**
```bash
curl -s https://portofcall.ross.gg/api/9p/ls \
  -H 'Content-Type: application/json' \
  -d '{"host":"9p.example.com","path":"usr"}' \
  | jq '.entries[] | select((.mode | tonumber) >= 2147483648) | .name'
# Filters for mode bit 31 set (DMDIR = 0x80000000 = 2147483648)
```

**Limitations:**
- The directory read is a single Tread request with `count = msize - 11` (typically ~8181 bytes). Large directories may be truncated. The 9P protocol supports pagination via multiple Tread calls at increasing offsets, but this implementation reads offset 0 only.
- Stat structures in the response are parsed until the buffer is exhausted. Partial stat structures at the end are silently dropped.

---

## 9P2000 Wire Protocol Reference

### Message Framing

All messages follow this structure:
```
[size:uint32LE][type:uint8][tag:uint16LE][body...]
```

- `size` — total message size including the 4-byte size field itself (minimum: 7 bytes)
- `type` — message type (see table below)
- `tag` — client-chosen identifier to match requests with responses (0xFFFF = NOTAG for version negotiation)
- `body` — type-specific payload

### Message Types

| Type | Name | Direction | Description |
|------|------|-----------|-------------|
| 100 | Tversion | → | Request version negotiation |
| 101 | Rversion | ← | Version response |
| 102 | Tauth | → | Start authentication |
| 103 | Rauth | ← | Auth response |
| 104 | Tattach | → | Attach to filesystem root |
| 105 | Rattach | ← | Attach response with root QID |
| 106 | Terror | — | **Illegal** (no Terror message exists in 9P) |
| 107 | Rerror | ← | Error response |
| 110 | Twalk | → | Walk path components |
| 111 | Rwalk | ← | Walk response with QIDs |
| 112 | Topen | → | Open file |
| 113 | Ropen | ← | Open response with QID and iounit |
| 116 | Tread | → | Read file or directory |
| 117 | Rread | ← | Read response with data |
| 120 | Tclunk | → | Close fid |
| 121 | Rclunk | ← | Clunk response |
| 124 | Tstat | → | Get file metadata |
| 125 | Rstat | ← | Stat response |

Port of Call implements: Tversion, Tattach, Twalk, Topen, Tread, Tstat, Tclunk.

**Not implemented:** Tauth/Rauth (authentication), Twrite/Rwrite, Tcreate/Rcreate, Tremove/Rremove, Twstat/Rwstat.

### String Encoding

9P strings are length-prefixed UTF-8:
```
[length:uint16LE][bytes...]
```

Max string length: 65535 bytes.

### QID Structure (13 bytes)

```
[type:uint8][version:uint32LE][path:uint64LE]
```

- `type` — file type bitfield:
  - 0x80 (bit 7) = directory (QTDIR)
  - 0x40 (bit 6) = append-only (QTAPPEND)
  - 0x20 (bit 5) = exclusive use (QTEXCL)
  - 0x04 (bit 2) = auth file (QTAUTH)
  - 0x01 (bit 0) = temporary file (QTTMP)
- `version` — modification version for cache validation (0 = no cache)
- `path` — unique 64-bit identifier (typically inode number)

### Stat Structure

A 9P stat is a complex nested structure:
```
[size:uint16LE]  ← stat size (not including this field)
  [type:uint16LE]
  [dev:uint32LE]
  [qid:13 bytes]
  [mode:uint32LE]
  [atime:uint32LE]
  [mtime:uint32LE]
  [length:uint64LE]
  [name:string]
  [uid:string]
  [gid:string]
  [muid:string]
```

Rstat and directory reads prepend a total byte count:
```
[nstat:uint16LE][stat_bytes...]
```

---

## Connection Flow

### Typical handshake (used by `/api/9p/connect`):

```
Client → Server: Tversion { msize: 8192, version: "9P2000" }
Client ← Server: Rversion { msize: 8192, version: "9P2000" }

Client → Server: Tattach { fid: 0, afid: NOFID, uname: "anonymous", aname: "" }
Client ← Server: Rattach { qid: {...} }
```

### Read file example (used by `/api/9p/read`):

```
[Tversion/Rversion handshake]
[Tattach/Rattach to get root fid=1]

Client → Server: Twalk { fid: 1, newfid: 2, nwname: 2, wname: ["etc", "motd"] }
Client ← Server: Rwalk { nwqid: 2, wqid: [qid1, qid2] }

Client → Server: Topen { fid: 2, mode: 0 }  ← mode 0 = OREAD
Client ← Server: Ropen { qid: {...}, iounit: 0 }

Client → Server: Tread { fid: 2, offset: 0, count: 4096 }
Client ← Server: Rread { count: 42, data: [...] }

Client → Server: Tclunk { fid: 2 }
Client ← Server: Rclunk {}
```

### Open modes:

| Mode | Name | Value | Description |
|------|------|-------|-------------|
| OREAD | Read | 0 | Read-only |
| OWRITE | Write | 1 | Write-only |
| ORDWR | Read/Write | 2 | Read and write |
| OEXEC | Execute | 3 | Execute (Plan 9 specific) |

Additional flags (OR'd with mode):
- 0x10 (OTRUNC) — truncate file on open
- 0x40 (ORCLOSE) — remove file on clunk

---

## Known Limitations and Quirks

### Security and Validation

**Path traversal protection (FIXED):**
- buildTwalk now validates path components to reject `""`, `"."`, `".."`, paths with `/` or null bytes, and components >255 bytes
- Maximum path depth: 16 components (matches typical 9P server limits)
- Invalid paths throw errors before being sent to the server

**No authentication:**
- All Tattach requests use `afid=NOFID` (0xffffffff) with `uname="anonymous"` and `aname=""` (default export)
- Servers requiring Tauth will reject Tattach with Rerror
- No mechanism to provide credentials or handle auth challenges

**No host validation in original code:**
- Fixed: Host is now validated against `/^[a-zA-Z0-9.-]+$/` to prevent injection attacks
- Port range validated: 1-65535

### Protocol Compliance

**Read-only implementation:**
- Only implements read operations (Tread, Tstat, Twalk)
- No support for: Twrite, Tcreate, Tremove, Twstat
- Cannot create, modify, or delete files

**No 9P2000.u or 9P2000.L extensions:**
- Client always requests `"9P2000"` (base protocol)
- 9P2000.u extensions (Unix permissions, symlinks): not supported
- 9P2000.L (Linux kernel 9p): not supported
- If server responds with `"9P2000.u"` or `"9P2000.L"`, the version is accepted but extended features are not used

**Fixed msize:**
- Client always requests `msize=8192` (DEFAULT_MSIZE)
- Server may respond with a lower value; client respects it for directory reads
- Cannot configure msize per request

**Single-fid pattern:**
- Each endpoint opens a fresh connection and allocates fids starting from 1
- No fid caching or connection reuse between API calls
- Tclunk is always sent (unless an error occurs mid-operation)

**No iounit handling:**
- Ropen returns `iounit` (optimal I/O size), but the implementation ignores it
- Read requests use the user-provided `count` (capped at 65536) regardless of iounit

### Parsing and Data Handling

**64-bit file sizes (FIXED):**
- File lengths are now parsed using BigInt to avoid precision loss for files >2^53 bytes
- Lengths are returned as strings (e.g. `"18446744073709551615"`)

**Base64 encoding for reads (FIXED):**
- File data is returned as base64 to safely transport binary data over JSON
- Original code used spread operator (`...dataBytes`) which fails in some TS targets
- Fixed to use explicit loop: `for (let i = 0; i < dataBytes.length; i++)`

**Stat parsing offset bug (FIXED):**
- Original code called `parseStat(rs.body, 0)` for walked paths, causing incorrect offset
- Rstat body format: `[nstat:2][stat_size:2][stat_data...]`
- Fixed: both root and non-root stat calls now use `parseStat(rs.body, 2)` to skip the nstat prefix

**Buffer bounds validation (FIXED):**
- Added bounds checks to `parse9PString()` and `parseQID()` to prevent out-of-bounds reads
- Invalid responses now throw errors instead of silently corrupting data

**Timeout calculation bug (FIXED):**
- Original `timeLeft()` in `ninePHandshake` could return negative values
- Fixed to track elapsed time from handshake start: `Math.max(timeoutMs - (Date.now() - startTime), 1000)`

### Directory Reads

**Single-read pagination:**
- `/api/9p/ls` issues a single Tread with `offset=0` and `count=msize-11`
- Large directories (>8181 bytes of stat structures) are silently truncated
- Workaround: not possible via this API (would require client-side pagination loop)

**Partial stat structures dropped:**
- If the Rread buffer ends mid-stat, the partial structure is silently ignored
- No warning or indication that the listing is incomplete

**No sorting:**
- Entries are returned in the order the server provides (typically inode order)
- Clients must sort by name/mtime if needed

### Error Handling

**Rerror format:**
- Rerror body: `[ename:string]`
- Error string is UTF-8 decoded and returned in the `error` field
- No error codes (9P2000 has only string errors; 9P2000.u added numeric errno)

**Socket cleanup:**
- All endpoints use try/catch with `reader.releaseLock()`, `writer.releaseLock()`, `socket.close()`
- Errors during cleanup are caught and ignored to prevent masking the original error

**Cloudflare detection:**
- **Missing**: Unlike other protocol handlers, 9P does not check for Cloudflare protection
- Connecting to a Cloudflare-protected host will result in a connection timeout or TLS handshake error

### Response Consistency

**405 responses:**
- `/api/9p/stat`, `/api/9p/read`, `/api/9p/ls` return `'Method not allowed'` (plain text) for non-POST
- Missing `{ success: false, error: ... }` JSON structure (inconsistent with other endpoints)

---

## Practical Examples

### Check if a 9P server is reachable

```bash
curl -s -X POST https://portofcall.ross.gg/api/9p/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","port":564}' | jq .
```

**Sample output:**
```json
{
  "success": true,
  "version": "9P2000",
  "msize": 8192,
  "serverVersion": "9P2000",
  "rootQid": {
    "type": 128,
    "version": 0,
    "path": "0x0000000000000001"
  }
}
```

### List files in a directory

```bash
curl -s -X POST https://portofcall.ross.gg/api/9p/ls \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","path":"bin"}' \
  | jq -r '.entries[] | "\(.name) \(.length) \(.mtime)"'
```

### Read a configuration file

```bash
curl -s -X POST https://portofcall.ross.gg/api/9p/read \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","path":"etc/hostname","count":256}' \
  | jq -r '.data' | base64 -d
```

### Get file metadata

```bash
curl -s -X POST https://portofcall.ross.gg/api/9p/stat \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","path":"var/log/messages"}' \
  | jq '.stat | {name, length, mtime, mode}'
```

**Decode mode bits:**
```bash
# Extract permission bits (low 9 bits)
mode=2147484141  # example from stat response
perms=$((mode & 0x1FF))
printf "Permissions: %o\n" $perms
# Output: Permissions: 755

# Check if directory
if (( mode & 0x80000000 )); then
  echo "Directory"
else
  echo "File"
fi
```

### Check file modification time

```bash
curl -s -X POST https://portofcall.ross.gg/api/9p/stat \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","path":"etc/passwd"}' \
  | jq -r '.stat.mtime' \
  | xargs -I {} date -r {} '+%Y-%m-%d %H:%M:%S'
```

---

## Power User Tips

### Detect file type from mode

```bash
mode=$(curl -s ... | jq -r '.stat.mode')

if (( mode & 0x80000000 )); then echo "Directory"
elif (( mode & 0x40000000 )); then echo "Append-only"
elif (( mode & 0x20000000 )); then echo "Exclusive"
elif (( mode & 0x04000000 )); then echo "Temporary"
else echo "Regular file"
fi
```

### Find large files

```bash
curl -s https://portofcall.ross.gg/api/9p/ls \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","path":"var/log"}' \
  | jq '.entries[] | select((.length | tonumber) > 1048576) | {name, length}'
```

### Recursive listing workaround

The API does not support recursion, but you can implement it client-side:
```bash
function list_recursive() {
  local path=$1
  local response=$(curl -s https://portofcall.ross.gg/api/9p/ls \
    -H 'Content-Type: application/json' \
    -d "{\"host\":\"192.168.1.100\",\"path\":\"$path\"}")

  echo "$response" | jq -r '.entries[] | .name'

  # Recurse into directories
  echo "$response" | jq -r '.entries[] | select((.mode | tonumber) >= 2147483648) | .name' | while read dir; do
    list_recursive "$path/$dir"
  done
}

list_recursive "usr/local"
```

### Reading large files in chunks

```bash
HOST="192.168.1.100"
PATH="var/log/syslog"
CHUNK=65536

# Get file size
SIZE=$(curl -s https://portofcall.ross.gg/api/9p/stat \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"$HOST\",\"path\":\"$PATH\"}" | jq -r '.stat.length')

offset=0
while (( offset < SIZE )); do
  curl -s https://portofcall.ross.gg/api/9p/read \
    -H 'Content-Type: application/json' \
    -d "{\"host\":\"$HOST\",\"path\":\"$PATH\",\"offset\":$offset,\"count\":$CHUNK}" \
    | jq -r '.data' | base64 -d
  offset=$((offset + CHUNK))
done
```

---

## Resources

- [Plan 9 Manual Section 5: intro](http://man.cat-v.org/plan_9/5/intro) — 9P2000 protocol specification
- [9P Protocol Wiki](https://9p.io/wiki/plan9/plan_9_wiki/) — Plan 9 documentation
- [Linux v9fs documentation](https://www.kernel.org/doc/Documentation/filesystems/9p.txt)
- [QEMU virtio-9p](https://wiki.qemu.org/Documentation/9psetup) — Using 9P with QEMU/KVM
- [diod](https://github.com/chaos/diod) — Distributed I/O Daemon (9P server for Linux)
- [9P2000.u spec](http://ericvh.github.io/9p-rfc/rfc9p2000.u.html) — Unix extensions
- [9P2000.L spec](https://github.com/chaos/diod/blob/master/protocol.md) — Linux extensions

---

## Common Use Cases

### QEMU/KVM VM file access

QEMU supports 9P passthrough for host-to-guest filesystem sharing:

```bash
qemu-system-x86_64 \
  -fsdev local,id=fsdev0,path=/host/share,security_model=passthrough \
  -device virtfs-9p,fsdev=fsdev0,mount_tag=hostshare
```

Inside the VM (Linux):
```bash
mount -t 9p -o trans=virtio,version=9p2000.L hostshare /mnt
```

To probe from Port of Call, the VM must expose 9P on a network-reachable port (not the default virtio transport).

### WSL2 9P server

WSL2 uses 9P to mount Windows drives. It's not directly network-accessible, but can be exposed via a 9P proxy like diod:

```bash
# On WSL2
sudo diod -f -n -p 564 -e /mnt/c
```

Then probe from Port of Call:
```bash
curl -s https://portofcall.ross.gg/api/9p/ls \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":564}'
```

### Plan 9 cpu/file server

Plan 9 systems natively export filesystems via 9P. Typical exports:
- Port 564: main file server
- Port 17007: cpu server (authentication required)

---

## Security Considerations

**No authentication:** The implementation always uses `afid=NOFID` and `uname="anonymous"`. Do not expose production 9P servers without network-level access control (firewall, VPN, stunnel).

**Path traversal:** buildTwalk validates against `".."`, `"."`, null bytes, and slashes in path components. However, symlinks are resolved server-side—a malicious server could redirect walks outside the intended export.

**Resource exhaustion:** No limit on the number of concurrent requests. An attacker could open many connections to exhaust worker resources or backend 9P server fids.

**Timeout bypass:** The `timeout` parameter is capped at 30000ms for `/api/9p/stat`, `/api/9p/read`, `/api/9p/ls`, but `/api/9p/connect` has no enforced maximum. A malicious client could set an extremely high timeout to hold worker resources.

**Cloudflare detection missing:** Unlike other handlers, 9P does not detect Cloudflare-protected hosts. This could lead to confusing timeout errors instead of clear "Cloudflare detected" messages.
