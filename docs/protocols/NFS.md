# NFS — Port of Call Power-User Reference

**Port:** 2049 (default, TCP)
**Implementation:** `src/worker/nfs.ts`
**Protocol version:** NFSv3 operations over ONC-RPC with TCP Record Marking. Probe detects v2/v3/v4 but all data operations are NFSv3 only.
**Auth:** AUTH_NULL — no credentials sent. Only works with exports permitting anonymous/world access.
**No tests.**

---

## Endpoints

| # | Endpoint | What it does | Key params |
|---|----------|-------------|------------|
| 1 | `POST /api/nfs/probe` | NULL call on NFS program for v4, v3, v2 | `host`, `port?`, `timeout?` |
| 2 | `POST /api/nfs/exports` | MOUNT EXPORT — list exported paths + allowed groups | `host`, `port?`, `mountPort?`, `timeout?` |
| 3 | `POST /api/nfs/lookup` | MOUNT + single-name NFSv3 LOOKUP → file handle + attrs | `host`, `exportPath`, `path`, `port?`, `timeout?` |
| 4 | `POST /api/nfs/getattr` | MOUNT + NFSv3 GETATTR on export root → fattr3 | `host`, `exportPath`, `port?`, `timeout?` |
| 5 | `POST /api/nfs/read` | MOUNT + multi-component LOOKUP chain + NFSv3 READ | `host`, `exportPath`, `path`, `offset?`, `count?`, `port?`, `timeout?` |
| 6 | `POST /api/nfs/readdir` | MOUNT + optional path resolve + NFSv3 READDIR | `host`, `exportPath`, `path?`, `count?`, `port?`, `mountPort?`, `timeout?` |
| 7 | `POST /api/nfs/write` | MOUNT + multi-component LOOKUP chain + NFSv3 WRITE | `host`, `exportPath`, `path`, `data` (base64), `offset?`, `port?`, `mountPort?`, `timeout?` |

All endpoints are POST-only (body parsed via `request.json()`). GET requests will fail with a JSON parse error.

---

## 1. `/api/nfs/probe`

Send RPC NULL (procedure 0) to NFS program 100003 for versions 4, 3, 2 in sequence. Each version opens a separate TCP connection.

**Request:**
```json
{ "host": "10.0.0.5", "port": 2049, "timeout": 10000 }
```

**Response:**
```json
{
  "success": true,
  "host": "10.0.0.5",
  "port": 2049,
  "rtt": 47,
  "versions": {
    "v4": { "supported": true, "rtt": 12 },
    "v3": { "supported": true, "rtt": 15 },
    "v2": { "supported": false, "error": "PROG_MISMATCH", "mismatch": { "low": 3, "high": 4 }, "rtt": 20 }
  }
}
```

- `mismatch.low` / `mismatch.high` — server-reported supported version range (only present on PROG_MISMATCH).
- Per-version `rtt` is per-connection round-trip. Top-level `rtt` is total wall time for all three checks (sequential, not parallel).

---

## 2. `/api/nfs/exports`

Calls MOUNT program (100005) EXPORT procedure (5) to list exported paths. Tries MOUNT v3 first, then v1.

**Request:**
```json
{ "host": "10.0.0.5", "mountPort": 2049, "timeout": 10000 }
```

- `port` — default 2049. Used as fallback if `mountPort` not set.
- `mountPort` — explicit mount daemon port. If omitted, uses `port`.
- **Port resolution:** `targetPort = mountPort || port`. The implementation does NOT use portmapper (port 111) to discover the mount daemon — you must know the port.

**Response:**
```json
{
  "success": true,
  "host": "10.0.0.5",
  "port": 2049,
  "rtt": 23,
  "mountVersion": 3,
  "exports": [
    { "path": "/data", "groups": ["10.0.0.0/24"] },
    { "path": "/public", "groups": ["*"] }
  ]
}
```

- `mountVersion` — which MOUNT protocol version succeeded (3 or 1), or `null` if both failed.
- `groups` — allowed client hosts/networks from the server's export table. `"*"` = world-readable.
- If no exports found, `success` is still `true` but `exports` is `[]` and an `error` string is set.

---

## 3. `/api/nfs/lookup`

MOUNT the export path to get a root file handle, then send a single NFSv3 LOOKUP (procedure 3) with that handle + the filename.

**Request:**
```json
{ "host": "10.0.0.5", "exportPath": "/data", "path": "readme.txt" }
```

**Response:**
```json
{
  "success": true,
  "host": "10.0.0.5",
  "port": 2049,
  "exportPath": "/data",
  "path": "readme.txt",
  "fileHandle": "01000700000100000a00000064f4c1ec...",
  "type": "REG",
  "mode": "0644",
  "size": 1234,
  "uid": 1000,
  "gid": 1000,
  "mtime": 1700000000,
  "rtt": 35
}
```

**Gotcha — single-level only:** The `path` is sent as a single LOOKUP filename against the export root handle. A path like `"subdir/file.txt"` is sent literally as one name — this will fail because NFS LOOKUP operates on a single directory entry, not a slash-separated path. Use `/api/nfs/read` or `/api/nfs/readdir` for multi-component paths (they use `resolveNFSFilePath` which chains LOOKUPs per component).

- `fileHandle` — hex-encoded opaque NFSv3 file handle.
- `type` — one of: `REG`, `DIR`, `BLK`, `CHR`, `LNK`, `SOCK`, `FIFO`, or `UNKNOWN(n)`.
- `mode` — octal string (e.g., `"0755"`). No ls-style mode string here (contrast with `/getattr`).
- `mtime` — Unix epoch seconds (integer, no nanoseconds).
- Attributes are from `post_op_attr` in the LOOKUP reply — only present if the server includes them (most do).
- **No `mountPort` parameter** — always mounts on `port` (default 2049).

---

## 4. `/api/nfs/getattr`

MOUNT the export path, then NFSv3 GETATTR (procedure 1) on the root file handle.

**Request:**
```json
{ "host": "10.0.0.5", "exportPath": "/data" }
```

**Response:**
```json
{
  "success": true,
  "host": "10.0.0.5",
  "port": 2049,
  "exportPath": "/data",
  "type": "DIR",
  "mode": "0755",
  "modeStr": "drwxr-xr-x",
  "nlink": 5,
  "uid": 0,
  "gid": 0,
  "size": 4096,
  "atime": 1700000000,
  "mtime": 1700000000,
  "ctime": 1700000000,
  "rtt": 28
}
```

- **Export root only** — no `path` parameter. To get attributes of a nested file, use `/lookup` first.
- `modeStr` — ls-style permission string (e.g., `drwxr-xr-x`). Only this endpoint provides it.
- `atime`, `mtime`, `ctime` — Unix epoch seconds (nanosecond component is skipped in parsing).
- **No `mountPort` parameter** — always mounts on `port`.
- Internally parses fattr3 (84 bytes): ftype, mode, nlink, uid, gid, size(u64), used(u64 skipped), rdev(u64 skipped, hardcoded to 0), fsid(u64), fileid(u64), atime(8), mtime(8), ctime(8). `blocksize` is hardcoded to 4096 and `blocks` to 0 (not returned in the response, but present internally).

---

## 5. `/api/nfs/read`

Full file-read pipeline: MOUNT → chain LOOKUPs for each path component → NFSv3 READ (procedure 6).

**Request:**
```json
{
  "host": "10.0.0.5",
  "exportPath": "/data",
  "path": "subdir/config.yml",
  "offset": 0,
  "count": 8192
}
```

**Response:**
```json
{
  "success": true,
  "host": "10.0.0.5",
  "port": 2049,
  "exportPath": "/data",
  "path": "subdir/config.yml",
  "offset": 0,
  "bytesRead": 1523,
  "eof": true,
  "encoding": "utf-8",
  "data": "server:\n  port: 8080\n  ...",
  "rtt": 52
}
```

- `count` default: 4096. Capped at 65536 internally via `Math.min(count, 65536)`.
- `offset` — byte offset (uint64 on wire, but JavaScript number — precision loss above 2^53).
- `encoding` — `"utf-8"` if data decodes cleanly, otherwise `"base64"` (binary data).
- `eof` — `true` if the server says this is the end of the file.
- **Path resolution:** Splits `path` on `/`, filters empty segments, chains LOOKUP per component. Leading slashes are harmless.
- **No `mountPort` parameter** — always mounts on `port`.
- **Single TCP read per RPC** — if the READ response is large enough to fragment across TCP segments, only the first segment is returned. In practice, with `count` capped at 65536, this is usually fine.

---

## 6. `/api/nfs/readdir`

MOUNT → optional path resolve → NFSv3 READDIR (procedure 16). Returns `{fileid, name}` pairs.

**Request:**
```json
{
  "host": "10.0.0.5",
  "exportPath": "/data",
  "path": "subdir",
  "count": 8192,
  "mountPort": 2049
}
```

**Response:**
```json
{
  "success": true,
  "host": "10.0.0.5",
  "port": 2049,
  "exportPath": "/data",
  "path": "subdir",
  "count": 14,
  "eof": true,
  "entries": [
    { "fileid": 1234, "name": "." },
    { "fileid": 1000, "name": ".." },
    { "fileid": 1235, "name": "file1.txt" },
    { "fileid": 1236, "name": "file2.txt" }
  ],
  "rtt": 41
}
```

- `path` — optional, defaults to `""` (export root). Multi-component paths are resolved via chained LOOKUPs.
- `count` — clamped to 512–32768 bytes (`Math.min(Math.max(count ?? 4096, 512), 32768)`). This is the max reply size, not entry count.
- `eof` — `true` if the server says all entries have been returned.
- **No pagination** — always starts from cookie 0 with zero cookieverf. If the directory has more entries than fit in one reply, you only get the first batch and `eof` will be `false`. There is no way to pass a continuation cookie.
- **No READDIRPLUS** — uses READDIR (procedure 16), not READDIRPLUS (procedure 17). Entries only contain `fileid` and `name` — no file attributes. To get attributes, issue `/getattr` or `/lookup` for each entry.
- `mountPort` — supported here (unlike `/lookup`, `/getattr`, `/read`).
- Response `count` field is the number of entries (confusingly, request `count` is bytes).
- Default timeout: 15000ms (vs 10000ms for most other endpoints).

---

## 7. `/api/nfs/write`

MOUNT → chain LOOKUPs → NFSv3 WRITE (procedure 7) with FILE_SYNC.

**Request:**
```json
{
  "host": "10.0.0.5",
  "exportPath": "/data",
  "path": "output.txt",
  "data": "SGVsbG8gV29ybGQK",
  "offset": 0,
  "mountPort": 2049
}
```

**Response:**
```json
{
  "success": true,
  "host": "10.0.0.5",
  "port": 2049,
  "exportPath": "/data",
  "path": "output.txt",
  "offset": 0,
  "bytesWritten": 12,
  "committed": "FILE_SYNC",
  "rtt": 67
}
```

- `data` — **must be base64-encoded**. Max 65536 bytes after decoding. Invalid base64 → HTTP 400.
- `offset` — byte offset to write at (default 0). Clamped to >= 0.
- `committed` — one of `UNSTABLE`, `DATA_SYNC`, `FILE_SYNC`. Always requests `FILE_SYNC`, but server may downgrade.
- **File must already exist** — the path is resolved via LOOKUP chain. There is no CREATE operation; writing to a non-existent file will fail at the LOOKUP step.
- **Most exports are read-only** — NFS error status will be non-zero (likely 30 = EROFS or 13 = EACCES). The error message hints at this.
- `mountPort` — supported here.
- Default timeout: 15000ms.

---

## Wire Protocol Details

### ONC-RPC Framing

All NFS traffic uses ONC-RPC over TCP with Record Marking:

```
[4 bytes: 0x80000000 | fragment_length]  (bit 31 = last fragment)
[RPC message: XID(4) MSG_TYPE(4) ...]
```

The implementation always sets the last-fragment bit (single-fragment messages). On the receive side, `parseRpcReply` detects the record-marking header by checking bit 31 and skips it, but does not handle multi-fragment replies.

### RPC CALL Structure

```
XID:           4 bytes (random uint32)
MSG_TYPE:      4 bytes (0 = CALL)
RPC_VERSION:   4 bytes (2)
PROGRAM:       4 bytes (100003=NFS, 100005=MOUNT)
VERSION:       4 bytes (varies)
PROCEDURE:     4 bytes (varies)
CREDENTIAL:    8 bytes (AUTH_NULL: flavor=0, length=0)
VERIFIER:      8 bytes (AUTH_NULL: flavor=0, length=0)
[procedure-specific data]
```

### XDR Encoding

- **String:** `uint32(length) + bytes + padding to 4-byte boundary`
- **File handle (opaque):** `uint32(length) + bytes + padding`
- **uint64:** two uint32s (high, low) — read as `hi * 0x100000000 + lo` (JavaScript Number, ~53-bit precision)

### NFSv3 fattr3 Layout (84 bytes)

```
ftype:    uint32   (1=REG, 2=DIR, 3=BLK, 4=CHR, 5=LNK, 6=SOCK, 7=FIFO)
mode:     uint32   (Unix permission bits)
nlink:    uint32
uid:      uint32
gid:      uint32
size:     uint64   (file size in bytes)
used:     uint64   (disk space used — skipped)
rdev:     uint64   (specdata1 + specdata2 — skipped, hardcoded to 0)
fsid:     uint64
fileid:   uint64   (inode)
atime:    uint32 seconds + uint32 nseconds
mtime:    uint32 seconds + uint32 nseconds
ctime:    uint32 seconds + uint32 nseconds
```

### MOUNT MNT Reply Parsing

The implementation tries to parse as MNTv3 first (variable-length opaque: `uint32(fhLen) + bytes`, where fhLen must be 1–64). If that fails (fhLen=0 or >64), it falls back to MNTv1 (fixed 32-byte handle starting at the same offset — no length prefix).

---

## Known Limitations

1. **AUTH_NULL only** — no AUTH_SYS (uid/gid), no RPCSEC_GSS (Kerberos). Only works with exports that permit anonymous or world access.

2. **No portmapper** — does not query rpcbind (port 111) to discover the mount daemon port. You must know the port. Most modern servers run mountd on 2049 alongside NFS, but some use dynamic ports.

3. **`mountPort` inconsistency** — `/readdir` and `/write` accept `mountPort`. The other endpoints (`/lookup`, `/getattr`, `/read`) do NOT — they always mount on the NFS `port`. If your mount daemon is on a separate port, only `/exports`, `/readdir`, and `/write` can reach it.

4. **Single TCP read** — `sendRpcCall` does exactly one `reader.read()`. If the RPC response is fragmented across TCP segments, only the first segment is parsed. This can truncate large READDIR replies or READ data.

5. **No multi-fragment RPC** — the record-marking parser does not reassemble multi-fragment RPC replies. If a server sends the reply in multiple RM fragments (each with bit 31 clear except the last), only the first fragment is used.

6. **`/lookup` single-level** — sends `path` as a single LOOKUP name against the export root. Slash-separated paths (e.g., `"a/b/c"`) are sent as a literal filename and will fail. Use `/read` or `/readdir` for multi-component paths.

7. **`/getattr` export-root only** — no `path` parameter. Cannot get attributes of nested files directly.

8. **No READDIR pagination** — always starts from cookie 0. No way to continue listing a large directory.

9. **No READDIRPLUS** — READDIR returns `{fileid, name}` only. No file attributes per entry.

10. **No UMNT** — after MOUNT, the server tracks the client as mounted. No UMOUNT call to clean up. Could exhaust mount slots on strict servers if called repeatedly.

11. **No NFSv4 operations** — probe detects v4 support, but all data operations use NFSv3 RPC procedures.

12. **No CREATE/MKDIR/REMOVE** — write-path is WRITE-only to existing files. No file creation, directory creation, or deletion.

13. **WRITE always FILE_SYNC** — hardcoded `stable_how = 2` (FILE_SYNC). No option for UNSTABLE or DATA_SYNC writes.

14. **uint64 precision** — file sizes and offsets above 2^53 (~9 PB) lose precision due to JavaScript Number representation.

15. **Timestamps are seconds-only** — nanosecond component of atime/mtime/ctime is parsed but discarded. Returned as Unix epoch seconds (integer).

---

## Timeout Defaults

| Endpoint | Default timeout |
|----------|----------------|
| `/probe` | 10000 ms |
| `/exports` | 10000 ms |
| `/lookup` | 10000 ms |
| `/getattr` | 10000 ms |
| `/read` | 10000 ms |
| `/readdir` | 15000 ms |
| `/write` | 15000 ms |

---

## Cloudflare Detection

All 7 endpoints call `checkIfCloudflare(host)` before connecting. If the host resolves to a Cloudflare IP, returns HTTP 403 with `isCloudflare: true`.

---

## Error Handling

- **Input validation** (missing host, bad port, bad base64) → HTTP 400
- **Cloudflare detection** → HTTP 403
- **NFS-level errors** (MOUNT failed, LOOKUP failed, NFSv3 error status) → HTTP 200 with `success: false`
- **Unhandled exceptions** → HTTP 500

NFS error status codes are returned as integers (e.g., `"NFSv3 WRITE error status: 30"` where 30 = EROFS). Common codes: 1 (EPERM), 2 (ENOENT), 5 (EIO), 13 (EACCES), 20 (ENOTDIR), 30 (EROFS), 10001 (NFS3ERR_BADHANDLE).

---

## Quick Reference

```bash
# Detect NFS versions
curl -X POST https://portofcall.app/api/nfs/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.5"}'

# List exports
curl -X POST https://portofcall.app/api/nfs/exports \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.5"}'

# Get export root attributes
curl -X POST https://portofcall.app/api/nfs/getattr \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.5","exportPath":"/data"}'

# List directory contents
curl -X POST https://portofcall.app/api/nfs/readdir \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.5","exportPath":"/data","path":"subdir","count":8192}'

# Look up a single file in export root
curl -X POST https://portofcall.app/api/nfs/lookup \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.5","exportPath":"/data","path":"readme.txt"}'

# Read a file (multi-component path OK)
curl -X POST https://portofcall.app/api/nfs/read \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.5","exportPath":"/data","path":"subdir/config.yml","count":65536}'

# Write to an existing file (base64 data)
curl -X POST https://portofcall.app/api/nfs/write \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.5","exportPath":"/data","path":"output.txt","data":"SGVsbG8K"}'
```
