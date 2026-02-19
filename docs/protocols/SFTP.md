# SFTP — SSH File Transfer Protocol

**Port:** 22 (over SSH)
**Spec:** [draft-ietf-secsh-filexfer-02](https://datatracker.ietf.org/doc/html/draft-ietf-secsh-filexfer-02) (version 3)
**Implementation:** `src/worker/sftp.ts`
**SSH layer:** `src/worker/ssh2-impl.ts` (`openSSHSubsystem`)
**Tests:** `tests/sftp.test.ts` (outdated — see Known Issues)

---

## Endpoints

| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 1 | POST/GET | `/api/sftp/connect` | None | SSH banner grab |
| 2 | POST | `/api/sftp/list` | Yes | List directory |
| 3 | POST | `/api/sftp/download` | Yes | Download file (≤4 MB) |
| 4 | POST | `/api/sftp/upload` | Yes | Upload file |
| 5 | POST | `/api/sftp/delete` | Yes | Delete file (NOT directories) |
| 6 | POST | `/api/sftp/mkdir` | Yes | Create directory |
| 7 | POST | `/api/sftp/rename` | Yes | Rename/move file or directory |
| 8 | POST | `/api/sftp/stat` | Yes | Get file/directory metadata |

All authenticated endpoints require `host`, `username`, and either `password` or `privateKey`.

### Auth method selection

If `privateKey` is present in the body, `authMethod` is set to `'privateKey'`. Otherwise `'password'`. The SSH layer (`ssh2-impl.ts`) supports **Ed25519 keys only** — RSA/ECDSA keys will fail. Optional `passphrase` for encrypted keys (but `chacha20-poly1305` cipher is not supported by the key decryption code).

---

## Endpoint Details

### 1. `/api/sftp/connect` — SSH banner grab

No credentials needed. Opens a raw TCP socket, reads the SSH banner, and closes.

**GET form:** `GET /api/sftp/connect?host=example.com` — only `host` is read from query params; `port` and `username` are ignored in GET mode.

**POST body:**
```json
{ "host": "example.com", "port": 22 }
```

**Response:**
```json
{
  "success": true,
  "host": "example.com",
  "port": 22,
  "banner": "SSH-2.0-OpenSSH_9.6",
  "sshVersion": "2.0",
  "software": "OpenSSH_9.6",
  "sftpAvailable": true,
  "note": "SFTP subsystem typically available on all OpenSSH servers..."
}
```

**Quirk:** `sftpAvailable` is `true` if the banner starts with `SSH-`. This is a heuristic — some SSH servers disable the SFTP subsystem. No actual subsystem negotiation is performed.

### 2. `/api/sftp/list` — List directory

**Body:**
```json
{
  "host": "example.com",
  "username": "user",
  "password": "pass",
  "path": "/home/user"
}
```

**Response:**
```json
{
  "success": true,
  "path": "/home/user",
  "count": 3,
  "entries": [
    { "name": "docs", "isDirectory": true, "isSymlink": false, "size": 4096, "permissions": "drwxr-xr-x", "mtime": "2026-01-15T12:00:00.000Z" },
    { "name": "file.txt", "isDirectory": false, "isSymlink": false, "size": 1024, "permissions": "-rw-r--r--", "mtime": "2026-02-10T09:30:00.000Z" }
  ]
}
```

**Notes:**
- `.` and `..` are filtered out.
- Entries are sorted: directories first, then alphabetically by name.
- `path` defaults to `"."` (server's default directory for the user) if omitted.
- Uses `SSH_FXP_OPENDIR` → `SSH_FXP_READDIR` loop → `SSH_FXP_CLOSE`.
- The `longname` field from READDIR responses is discarded — all metadata comes from parsed ATTRS.

### 3. `/api/sftp/download` — Download file

**Body:**
```json
{
  "host": "example.com",
  "username": "user",
  "password": "pass",
  "path": "/home/user/file.txt"
}
```

**Response (text file):**
```json
{
  "success": true,
  "path": "/home/user/file.txt",
  "size": 1024,
  "truncated": false,
  "isBinary": false,
  "content": "file contents here...",
  "encoding": "utf-8"
}
```

**Response (binary file):**
```json
{
  "success": true,
  "path": "/home/user/image.png",
  "size": 50000,
  "truncated": false,
  "isBinary": true,
  "content": "iVBORw0KGgo...",
  "encoding": "base64"
}
```

**Notes:**
- **4 MB cap** — `MAX_DOWNLOAD = 4 * 1024 * 1024`. If the file exceeds this, download stops and `truncated: true`.
- Text/binary detection uses `TextDecoder('utf-8', { fatal: true })` — if decoding throws, it's treated as binary.
- **Binary base64 encoding bug** — uses `btoa(String.fromCharCode(...Array.from(content)))`. The spread operator can cause a stack overflow for large arrays (engine-dependent, typically >64K elements). For a 4MB binary file this **will** fail. Text files are unaffected.
- Reads in 32 KB chunks (`MAX_READ_SIZE = 32768`).
- Uses `SSH_FXP_OPEN` (read flag) → `SSH_FXP_READ` loop → `SSH_FXP_CLOSE`.

### 4. `/api/sftp/upload` — Upload file

**Body:**
```json
{
  "host": "example.com",
  "username": "user",
  "password": "pass",
  "path": "/home/user/new-file.txt",
  "content": "file content or base64 string",
  "encoding": "base64"
}
```

**Response:**
```json
{
  "success": true,
  "path": "/home/user/new-file.txt",
  "bytesWritten": 1024
}
```

**Notes:**
- `encoding` defaults to `"base64"`. Pass `"utf-8"` (or any non-`"base64"` value) for plain text.
- Open flags: `WRITE | CREAT | TRUNC` — creates the file if it doesn't exist, truncates if it does.
- No `APPEND` flag support — cannot append to existing files.
- Writes in 32 KB chunks.
- No upload size limit in the SFTP layer (limited by Worker request body size and execution time).
- Created file permissions are server-determined (empty ATTRS sent with OPEN).

### 5. `/api/sftp/delete` — Delete file

**Body:**
```json
{
  "host": "example.com",
  "username": "user",
  "password": "pass",
  "path": "/home/user/file.txt"
}
```

**Response:**
```json
{ "success": true, "path": "/home/user/file.txt" }
```

**Limitation:** Uses `SSH_FXP_REMOVE` which only deletes **files**. Attempting to delete a directory returns `FAILURE` or `PERMISSION_DENIED`. There is no `/api/sftp/rmdir` endpoint — directory removal is not supported.

### 6. `/api/sftp/mkdir` — Create directory

**Body:**
```json
{
  "host": "example.com",
  "username": "user",
  "password": "pass",
  "path": "/home/user/new-dir"
}
```

**Response:**
```json
{ "success": true, "path": "/home/user/new-dir" }
```

**Notes:**
- Sends `emptyAttrs()` (flags=0) — no way to specify permissions. The server applies its default umask.
- Non-recursive — parent directory must exist.

### 7. `/api/sftp/rename` — Rename/move

**Body:**
```json
{
  "host": "example.com",
  "username": "user",
  "password": "pass",
  "oldPath": "/home/user/old-name.txt",
  "newPath": "/home/user/new-name.txt"
}
```

**Response:**
```json
{ "success": true, "oldPath": "/home/user/old-name.txt", "newPath": "/home/user/new-name.txt" }
```

**Notes:**
- Uses `SSH_FXP_RENAME` — behavior is server-dependent. OpenSSH uses POSIX `rename()` which is atomic but will fail if `newPath` already exists on some servers.
- Works for both files and directories.

### 8. `/api/sftp/stat` — File/directory metadata

**Body:**
```json
{
  "host": "example.com",
  "username": "user",
  "password": "pass",
  "path": "/home/user/file.txt"
}
```

**Response:**
```json
{
  "success": true,
  "path": "/home/user/file.txt",
  "isDirectory": false,
  "isSymlink": false,
  "size": 1024,
  "permissions": 33188,
  "permissionString": "-rw-r--r--",
  "uid": 1000,
  "gid": 1000,
  "atime": "2026-02-10T09:30:00.000Z",
  "mtime": "2026-02-10T09:30:00.000Z"
}
```

**Notes:**
- Uses `SSH_FXP_STAT` which **follows symlinks**. There is no `SSH_FXP_LSTAT` endpoint, so you cannot stat a symlink itself without following it.
- `permissions` is the raw numeric mode (e.g. `33188` = `0o100644`).
- `permissionString` decodes the lower 9 bits as `rwxrwxrwx` with a type prefix (`d`/`l`/`-`). Special bits (setuid, setgid, sticky) are **not** decoded.
- Fields (`size`, `uid`, `gid`, `atime`, `mtime`) are only present if the server includes them in the ATTRS response (controlled by attribute flags).

---

## Wire Protocol

All SFTP communication uses framed packets over an SSH channel:

```
┌─────────────────────────────────┐
│ length (uint32 BE)              │  ← excludes itself
│ type   (uint8)                  │
│ id     (uint32 BE)              │  ← absent for INIT/VERSION
│ ... payload ...                 │
└─────────────────────────────────┘
```

### Packet types used

| Constant | Value | Direction | Used by |
|----------|-------|-----------|---------|
| `SSH_FXP_INIT` | 1 | Client→Server | `openSFTP` (version 3) |
| `SSH_FXP_VERSION` | 2 | Server→Client | `openSFTP` |
| `SSH_FXP_OPEN` | 3 | Client→Server | `/download`, `/upload` |
| `SSH_FXP_CLOSE` | 4 | Client→Server | All file/dir operations |
| `SSH_FXP_READ` | 5 | Client→Server | `/download` |
| `SSH_FXP_WRITE` | 6 | Client→Server | `/upload` |
| `SSH_FXP_OPENDIR` | 11 | Client→Server | `/list` |
| `SSH_FXP_READDIR` | 12 | Client→Server | `/list` |
| `SSH_FXP_REMOVE` | 13 | Client→Server | `/delete` |
| `SSH_FXP_MKDIR` | 14 | Client→Server | `/mkdir` |
| `SSH_FXP_STAT` | 17 | Client→Server | `/stat` |
| `SSH_FXP_RENAME` | 18 | Client→Server | `/rename` |
| `SSH_FXP_STATUS` | 101 | Server→Client | All (error/success) |
| `SSH_FXP_HANDLE` | 102 | Server→Client | OPEN/OPENDIR responses |
| `SSH_FXP_DATA` | 103 | Server→Client | READ responses |
| `SSH_FXP_NAME` | 104 | Server→Client | READDIR responses |
| `SSH_FXP_ATTRS` | 105 | Server→Client | STAT responses |

### ATTRS flags

| Flag | Value | Fields |
|------|-------|--------|
| `SIZE` | `0x00000001` | uint64 (two uint32s) |
| `UIDGID` | `0x00000002` | uid (uint32), gid (uint32) |
| `PERMISSIONS` | `0x00000004` | mode (uint32) |
| `ACMODTIME` | `0x00000008` | atime (uint32), mtime (uint32) |
| `EXTENDED` | `0x80000000` | count + (key,value) string pairs |

### Status codes

| Code | Name | Meaning |
|------|------|---------|
| 0 | `OK` | Success |
| 1 | `EOF` | End of file/directory |
| 2 | `NO_SUCH_FILE` | Path doesn't exist |
| 3 | `PERMISSION_DENIED` | Insufficient permissions |
| 4 | `FAILURE` | Generic failure |
| 5 | `BAD_MESSAGE` | Malformed packet |
| 6 | `NO_CONNECTION` | No connection |
| 7 | `CONNECTION_LOST` | Connection dropped |
| 8 | `OP_UNSUPPORTED` | Operation not supported |

---

## Architecture

### Session lifecycle

Every authenticated request follows this pattern:

1. Cloudflare detection (`checkIfCloudflare`) — returns 403 if host resolves to CF IP
2. TCP connect via `cloudflare:sockets`
3. Full SSH handshake via `openSSHSubsystem(socket, opts, 'sftp')` — version exchange, key exchange, encryption, authentication, channel open, subsystem request
4. SFTP handshake — `SSH_FXP_INIT` (version 3) → `SSH_FXP_VERSION`
5. SFTP operation(s)
6. `io.close()` — closes SSH session and TCP socket

**No connection pooling.** Every HTTP request opens a new SSH+SFTP session and closes it when done.

### SFTPSession class

Internal buffered reader/writer:
- `recv()` — reads channel data until a complete SFTP packet is assembled
- `send()` — sends a framed SFTP packet
- `rpc()` — sends and waits for matching response (by request ID)
- `id()` — auto-incrementing request ID counter (starts at 1)
- Sequential mode — only one outstanding request at a time

### SFTP handle encoding

SFTP handles are opaque binary blobs, but this implementation reads/writes them with `sftpReadStr`/`sftpStr` (UTF-8 string encoding). Since the same encoder is used for both directions, this works — but non-UTF-8 handle bytes could theoretically get corrupted through `TextDecoder`/`TextEncoder` round-trip. In practice, OpenSSH uses short numeric handles.

---

## Known Issues

### ~~1. Binary download stack overflow~~ — FIXED

~~`btoa(String.fromCharCode(...Array.from(content)))` used the spread operator to convert a `Uint8Array` to a string, causing RangeError for files >~64KB.~~ Fixed: base64 encoding now uses chunked 32KB `String.fromCharCode` calls.

### 2. No directory removal

`/delete` uses `SSH_FXP_REMOVE` (file-only). `SSH_FXP_RMDIR` (type 15) is defined in the spec but not exposed. No `/api/sftp/rmdir` endpoint exists.

### 3. `requireFields` falsy check

`requireFields` rejects fields with falsy values (`!body[f]`). This means `port: 0` or `path: ""` would trigger a "Missing required field" error. In practice, `port` is never in the required fields list and `path` is always a non-empty string when required.

### 4. `/connect` GET ignores port/username

The GET form only reads `host` from query params: `body = { host: url.searchParams.get('host') ?? '' }`. Even if you pass `?port=2222`, it defaults to 22.

### 5. isCloudflare inconsistency in error responses

`/list`, `/download`, `/upload` propagate `isCloudflare: true` in error responses. `/delete`, `/mkdir`, `/rename`, `/stat` do not, even though they go through `openSFTP()` which does the same Cloudflare check. The check still happens and returns 500, but without the `isCloudflare` field.

### 6. Tests outdated

`tests/sftp.test.ts` expects response fields (`sshBanner`, `message`, `requiresAuth`) that don't exist in the current implementation. It also expects 501 status codes for authenticated endpoints — the implementation returns 400/500, not 501. The tests were written for an older version.

### 7. u64BE limited to 32 bits

`u64BE()` always sets the high 4 bytes to zero. Files larger than 4 GB cannot be correctly addressed for reads or writes. The function comment acknowledges this.

### 8. `/stat` follows symlinks

Uses `SSH_FXP_STAT` (type 17) which follows symlinks. `SSH_FXP_LSTAT` (type 7) is in the spec but not used. No way to inspect symlink metadata without following.

### 9. No method enforcement

Routes in `index.ts` match by pathname only. A GET to `/api/sftp/list` would reach `handleSFTPList`, which calls `request.json()` and fails with a JSON parse error (500), not a 405 Method Not Allowed.

### 10. No timeout parameter

None of the endpoints accept a `timeout` parameter. Timeouts are determined by the SSH layer in `ssh2-impl.ts` and the Cloudflare Worker execution limit.

### 11. `/mkdir` and `/upload` cannot set permissions

`emptyAttrs()` (flags=0) is sent with `SSH_FXP_MKDIR` and `SSH_FXP_OPEN` for upload. Server applies its own defaults. No way to specify mode.

### ~~12. Permission string had 'r' and 'x' swapped~~ — FIXED

~~`parseAttrs()` used `chars = 'xwrxwrxwr'` producing `xwr` triads instead of `rwx`. For 0o755, the output was `-xwrx-rx-r` instead of `-rwxr-xr-x`.~~ Fixed: chars corrected to `'rwxrwxrwx'`.

---

## curl Examples

```bash
# Banner grab
curl -X POST https://portofcall.ross.gg/api/sftp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"test.rebex.net"}'

# List directory
curl -X POST https://portofcall.ross.gg/api/sftp/list \
  -H 'Content-Type: application/json' \
  -d '{"host":"test.rebex.net","username":"demo","password":"password","path":"/"}'

# Download file
curl -X POST https://portofcall.ross.gg/api/sftp/download \
  -H 'Content-Type: application/json' \
  -d '{"host":"test.rebex.net","username":"demo","password":"password","path":"/readme.txt"}'

# Stat file
curl -X POST https://portofcall.ross.gg/api/sftp/stat \
  -H 'Content-Type: application/json' \
  -d '{"host":"test.rebex.net","username":"demo","password":"password","path":"/readme.txt"}'

# Upload (UTF-8)
curl -X POST https://portofcall.ross.gg/api/sftp/upload \
  -H 'Content-Type: application/json' \
  -d '{"host":"example.com","username":"user","password":"pass","path":"/tmp/test.txt","content":"hello world","encoding":"utf-8"}'

# Upload (base64 — default)
curl -X POST https://portofcall.ross.gg/api/sftp/upload \
  -H 'Content-Type: application/json' \
  -d '{"host":"example.com","username":"user","password":"pass","path":"/tmp/test.bin","content":"aGVsbG8gd29ybGQ="}'

# Delete file
curl -X POST https://portofcall.ross.gg/api/sftp/delete \
  -H 'Content-Type: application/json' \
  -d '{"host":"example.com","username":"user","password":"pass","path":"/tmp/test.txt"}'

# Create directory
curl -X POST https://portofcall.ross.gg/api/sftp/mkdir \
  -H 'Content-Type: application/json' \
  -d '{"host":"example.com","username":"user","password":"pass","path":"/tmp/new-dir"}'

# Rename/move
curl -X POST https://portofcall.ross.gg/api/sftp/rename \
  -H 'Content-Type: application/json' \
  -d '{"host":"example.com","username":"user","password":"pass","oldPath":"/tmp/old.txt","newPath":"/tmp/new.txt"}'
```

---

## Local Testing

```bash
# Start OpenSSH SFTP server via Docker
docker run -d -p 2222:22 \
  -e USER_NAME=testuser \
  -e USER_PASSWORD=testpass \
  atmoz/sftp testuser:testpass:::upload

# Test against local server
curl -X POST http://localhost:8787/api/sftp/list \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":2222,"username":"testuser","password":"testpass","path":"/upload"}'
```
