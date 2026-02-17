# FTP / FTPS Protocol — Port of Call Reference

**RFC:** [959](https://tools.ietf.org/html/rfc959) (FTP), [4217](https://tools.ietf.org/html/rfc4217) (FTPS)
**Default ports:** 21 (FTP), 990 (FTPS implicit TLS)
**Sources:** `src/worker/ftp.ts`, `src/worker/ftps.ts`
**Tests:** `tests/ftp.test.ts`, `tests/ftps.test.ts`

---

## Two implementations, very different APIs

FTP and FTPS are not mirrors of each other. They differ in:

| Feature | FTP (`/api/ftp/*`) | FTPS (`/api/ftps/*`) |
|---------|---------------------|----------------------|
| Transport | Plain TCP (`connect()`) | Implicit TLS (`secureTransport: 'on'`) |
| Default port | `21` | `990` |
| Data channels | Plain TCP | TLS-encrypted |
| Connect probe | Requires credentials | No credentials needed |
| Upload body | `multipart/form-data` | JSON with base64 `content` |
| Download response | `application/octet-stream` binary | JSON with base64 `content` |
| Rename params | `fromPath`, `toPath` | `from`, `to` |
| List response key | `files` | `entries` |
| List entry shape | `{name, size, type, modified}` | `{name, type, size?, permissions?, raw}` |
| List path default | `/` | `.` |
| Delete file | DELE only | DELE or RMD via `type: 'file'|'dir'` |

Both use PASV (passive mode) exclusively. Active mode (PORT) is not supported.

---

## FTP Endpoints

### `GET|POST /api/ftp/connect` — Authenticate and get PWD

**GET:**
```
GET /api/ftp/connect?host=ftp.example.com&port=21&username=alice&password=hunter2
```

**POST:**
```json
{ "host": "ftp.example.com", "port": 21, "username": "alice", "password": "hunter2" }
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | |
| `username` | **required** | Use `anonymous` for anonymous FTP |
| `password` | **required** | For anonymous FTP, use an email address |
| `port` | `21` | |

**Wire sequence:**
```
Server → Client: 220 Welcome to FTP server
Client → Server: USER alice
Server → Client: 331 Password required
Client → Server: PASS hunter2
Server → Client: 230 Login successful
Client → Server: TYPE I
Server → Client: 200 Switching to Binary mode
Client → Server: PWD
Server → Client: 257 "/home/alice" is the current directory
Client → Server: QUIT
```

`TYPE I` (binary mode) is always sent after login. There is no option for `TYPE A` (ASCII mode).

**Response:**
```json
{
  "success": true,
  "message": "Connected successfully",
  "currentDirectory": "/home/alice"
}
```

**Failure:** If USER returns anything other than 331 (including 230 for no-password servers), or PASS returns anything other than 230, the error message includes the raw server response.

---

### `GET|POST /api/ftp/list` — List directory

```json
{ "host": "ftp.example.com", "port": 21, "username": "alice", "password": "hunter2", "path": "/" }
```

| Field | Default | Notes |
|-------|---------|-------|
| `path` | `/` | If not `/`, CWD is sent before PASV |

**Wire sequence:**

```
[auth + TYPE I]
Client → Server: CWD /pub                   (skipped if path is /)
Server → Client: 250 Directory successfully changed
Client → Server: PASV
Server → Client: 227 Entering Passive Mode (10,0,0,1,200,150)
[open data socket to 10.0.0.1:51350]
Client → Server: LIST
Server → Client: 150 Here comes the directory listing
[read data channel until closed]
Server → Client: 226 Directory send OK
```

**Critical data channel timing:** The data socket is opened *before* sending LIST (not after the 150 response). Both the LIST send and `socket.opened` are awaited in parallel via `Promise.all`. This avoids a race where the server closes the data channel before the client connects. The 30 s data transfer timeout is separate from the control channel response timeout (10 s).

**LIST parser limitations:** The response is split by newline and parsed with a 9-field whitespace split. Only Unix-style `ls -l` output is handled:

```
drwxr-xr-x 2 user group 4096 Jan 01 12:00 dirname
```

- Windows FTP servers (IIS, FileZilla) returning DOS-format `DIR` output (e.g., `01-01-24  12:00PM <DIR> dirname`) are parsed as `unknown` entries with `size: 0`.
- The parser looks for 9+ fields; lines with fewer are skipped entirely.
- `total N` summary lines are skipped.
- `modified` is a three-token join: `Jan 01 12:00` — not ISO 8601.

**Response:**
```json
{
  "success": true,
  "path": "/pub",
  "files": [
    { "name": "readme.txt", "size": 1234, "type": "file", "modified": "Jan 01 12:00" },
    { "name": "docs", "size": 4096, "type": "directory", "modified": "Dec 15 2023" }
  ]
}
```

`type` is `"file"` for `-` permission prefix, `"directory"` for `d`. No symlink detection in the FTP parser (unlike FTPS).

---

### `POST /api/ftp/upload` — Upload file

**This is the only endpoint that uses `multipart/form-data`, not JSON.**

```
POST /api/ftp/upload
Content-Type: multipart/form-data; boundary=...

--boundary
Content-Disposition: form-data; name="host"
ftp.example.com
--boundary
Content-Disposition: form-data; name="username"
alice
--boundary
Content-Disposition: form-data; name="password"
hunter2
--boundary
Content-Disposition: form-data; name="remotePath"
/upload/myfile.txt
--boundary
Content-Disposition: form-data; name="file"; filename="myfile.txt"
Content-Type: application/octet-stream
[binary data]
--boundary--
```

| Form field | Notes |
|------------|-------|
| `host` | Required |
| `username` | Required |
| `password` | Required |
| `remotePath` | Required — full path including filename |
| `port` | Optional, defaults to `21` |
| `file` | Required — `File` object (blob with filename) |

**Wire sequence:** `[auth + TYPE I]` → PASV → open data socket → STOR → write bytes → close data socket → read 226.

**Response:**
```json
{
  "success": true,
  "message": "Uploaded myfile.txt to /upload/myfile.txt",
  "size": 45678
}
```

---

### `GET|POST /api/ftp/download` — Download file

**This is the only FTP endpoint that returns binary, not JSON.**

```json
{ "host": "ftp.example.com", "username": "alice", "password": "hunter2", "remotePath": "/pub/file.tar.gz" }
```

| Field | Default | Notes |
|-------|---------|-------|
| `remotePath` | **required** | Full path to the remote file |

**Response:** `200 application/octet-stream` with headers:
```
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="file.tar.gz"
Content-Length: <bytes>
```

The filename in `Content-Disposition` is the last path component from `remotePath`. The 60 s data transfer timeout is longer than for LIST (30 s).

On failure (RETR returns 4xx/5xx), returns JSON `{ "success": false, "error": "..." }` with HTTP 500.

---

### `POST /api/ftp/delete` — Delete file

```json
{ "host": "ftp.example.com", "username": "alice", "password": "hunter2", "remotePath": "/pub/old.txt" }
```

Sends `DELE /pub/old.txt`. Expects 250. No directory deletion — use FTPS `/api/ftps/delete` with `type: 'dir'` for RMD.

**Response:**
```json
{ "success": true, "message": "Deleted /pub/old.txt" }
```

---

### `POST /api/ftp/mkdir` — Create directory

```json
{ "host": "ftp.example.com", "username": "alice", "password": "hunter2", "dirPath": "/pub/newdir" }
```

Sends `MKD /pub/newdir`. Expects 257. No equivalent `rmdir` endpoint — use FTPS `/api/ftps/delete` with `type: 'dir'`.

**Response:**
```json
{ "success": true, "message": "Created directory /pub/newdir" }
```

---

### `POST /api/ftp/rename` — Rename or move

```json
{
  "host": "ftp.example.com",
  "username": "alice",
  "password": "hunter2",
  "fromPath": "/pub/old.txt",
  "toPath": "/pub/new.txt"
}
```

Sends RNFR then RNTO. Expects 350 after RNFR, 250 after RNTO. Works for both files and directories. Can move across directories on the same server.

**Response:**
```json
{ "success": true, "message": "Renamed /pub/old.txt to /pub/new.txt" }
```

---

## FTPS Endpoints

FTPS uses implicit TLS (TLS from the first byte, before any FTP command). The `connect()` call uses `{ secureTransport: 'on' }`. Data channels also use `{ secureTransport: 'on' }` — both control and data connections are encrypted.

### `POST /api/ftps/connect` — Server probe (no credentials needed)

Unlike the FTP connect endpoint, FTPS connect does **not** require credentials. It reads the 220 banner, sends FEAT and SYST, then quits.

```json
{ "host": "ftps.example.com", "port": 990, "timeout": 10000 }
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | |
| `port` | `990` | |
| `timeout` | `10000` | Wall-clock timeout for the entire probe |

**Response:**
```json
{
  "success": true,
  "host": "ftps.example.com",
  "port": 990,
  "rtt": 145,
  "connectTime": 98,
  "encrypted": true,
  "protocol": "FTPS (Implicit TLS)",
  "banner": {
    "code": 220,
    "message": "ProFTPD 1.3.7 Server ready",
    "raw": "220 ProFTPD 1.3.7 Server ready\r\n"
  },
  "systemType": "UNIX Type: L8",
  "features": [
    "MLST Type*;Size*;Modify*;Perm*;Unique*;",
    "MLSD",
    "AUTH TLS",
    "PBSZ",
    "PROT",
    "UTF8",
    "EPSV"
  ],
  "tlsFeatures": {
    "authTls": true,
    "pbsz": true,
    "prot": true,
    "utf8": true,
    "mlst": true,
    "epsv": true
  }
}
```

`tlsFeatures` is derived by case-insensitive substring matching against the FEAT lines. `features` contains the raw FEAT lines (minus the `211-` and `211 End` wrapper).

`rtt` = total elapsed time. `connectTime` = time until TLS socket was `opened`.

FEAT returning 211 is required for `features` to be populated. If the server returns 500/502 (FEAT not supported), `features` and `tlsFeatures` are omitted.

---

### `POST /api/ftps/login` — Authenticate and get CWD + system type

```json
{
  "host": "ftps.example.com",
  "port": 990,
  "username": "alice",
  "password": "hunter2",
  "timeout": 15000
}
```

Authenticates, sends PWD and SYST, then quits.

**Response:**
```json
{
  "success": true,
  "host": "ftps.example.com",
  "port": 990,
  "cwd": "/home/alice",
  "systemType": "UNIX Type: L8"
}
```

`systemType` is omitted if SYST returns non-215. `cwd` is empty string if PWD returns non-257 (unusual).

---

### `POST /api/ftps/list` — List directory

```json
{
  "host": "ftps.example.com",
  "port": 990,
  "username": "alice",
  "password": "hunter2",
  "path": ".",
  "timeout": 15000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `path` | `.` | Default is current directory, not `/` |

CWD is skipped if `path` is `.`. Data channel is TLS-encrypted.

**FTPS list parser** uses a regex that matches Unix `ls -l` output and additionally detects symlinks (`l` prefix):

```
/^([dlrwxstST\-]{10})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+\S+\s+(.+)$/
```

Entries that don't match fall through as `{ name: line, type: 'unknown', raw: line }`.

**Response:**
```json
{
  "success": true,
  "path": ".",
  "entries": [
    {
      "name": "readme.txt",
      "type": "file",
      "size": 1234,
      "permissions": "-rw-r--r--",
      "raw": "-rw-r--r-- 1 alice users 1234 Jan 01 12:00 readme.txt"
    },
    {
      "name": "link -> /etc/passwd",
      "type": "symlink",
      "size": 4096,
      "permissions": "lrwxrwxrwx",
      "raw": "lrwxrwxrwx 1 alice users 4096 Jan 01 12:00 link -> /etc/passwd"
    }
  ],
  "count": 2
}
```

Note: `name` for symlinks includes the ` -> target` portion from the `ls -l` output — it is not parsed out.

---

### `POST /api/ftps/download` — Download file (returns base64 JSON)

**Unlike FTP download, FTPS download returns JSON with base64-encoded content, not a binary body.**

```json
{
  "host": "ftps.example.com",
  "port": 990,
  "username": "alice",
  "password": "hunter2",
  "path": "/pub/archive.tar.gz",
  "timeout": 30000
}
```

**Response:**
```json
{
  "success": true,
  "path": "/pub/archive.tar.gz",
  "size": 45678,
  "content": "H4sIAAAAAAAA...",
  "encoding": "base64"
}
```

Base64 encoding is done via `btoa(String.fromCharCode(...))`. This works for binary data but is memory-inefficient for large files — the entire file is buffered in memory before encoding. Workers memory limits apply.

---

### `POST /api/ftps/upload` — Upload file (JSON with base64 content)

**Unlike FTP upload, FTPS upload uses JSON body with base64-encoded content, not multipart/form-data.**

```json
{
  "host": "ftps.example.com",
  "port": 990,
  "username": "alice",
  "password": "hunter2",
  "path": "/upload/myfile.txt",
  "content": "SGVsbG8gV29ybGQ=",
  "timeout": 30000
}
```

Content is decoded from base64 via `atob()` then converted to bytes. Accepts 226 or 250 as a successful transfer complete response (some servers return 250).

**Response:**
```json
{ "success": true, "path": "/upload/myfile.txt", "bytesUploaded": 11 }
```

---

### `POST /api/ftps/delete` — Delete file or directory

```json
{
  "host": "ftps.example.com",
  "username": "alice",
  "password": "hunter2",
  "path": "/pub/old.txt",
  "type": "file"
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `type` | `"file"` | `"file"` → DELE; `"dir"` → RMD |

**Port default bug:** `handleFTPSDelete` defaults to `port = 21`, not `990`. Pass `port: 990` explicitly.

**Response:**
```json
{ "success": true, "path": "/pub/old.txt", "type": "file", "message": "Remove successful." }
```

---

### `POST /api/ftps/mkdir` — Create directory

```json
{ "host": "ftps.example.com", "username": "alice", "password": "hunter2", "path": "/pub/newdir" }
```

**Port default bug:** Defaults to `port = 21`. Pass `port: 990` explicitly.

The `path` in the response is extracted from the 257 reply's quoted string (RFC 959 convention). If the server omits quotes, `path` echoes the input.

**Response:**
```json
{ "success": true, "path": "/pub/newdir", "message": "/pub/newdir\" created" }
```

---

### `POST /api/ftps/rename` — Rename or move

```json
{
  "host": "ftps.example.com",
  "username": "alice",
  "password": "hunter2",
  "from": "/pub/old.txt",
  "to": "/pub/new.txt"
}
```

**Note:** FTPS rename uses `from`/`to`; FTP rename uses `fromPath`/`toPath`.

**Port default bug:** Defaults to `port = 21`. Pass `port: 990` explicitly.

**Response:**
```json
{ "success": true, "from": "/pub/old.txt", "to": "/pub/new.txt", "message": "Rename successful." }
```

---

## Implementation notes

### Passive mode data socket timing

Both FTP and FTPS open the data socket and send the data command (LIST/RETR/STOR) in parallel, then await both. This is required because some servers close the data port very quickly after PASV, and connecting *after* the command can result in a "connection refused" on the data port.

FTP:
```typescript
const dataSocket = connect(`${host}:${port}`);
const dataOpened = dataSocket.opened;
await this.sendCommand('LIST');
const [listResponse] = await Promise.all([this.readResponse(), dataOpened]);
```

FTPS:
```typescript
const dataSocket = session.openDataSocket(dataHost, dataPort);
await session.sendCommand('LIST');
const [listResp] = await Promise.all([session.readResponse(timeout), dataSocket.opened]);
```

### Multi-line response parsing

**FTP (FTPClient.readResponse):** Appends chunks until the accumulated string ends with `\r\n` *and* the last line's 4th character is a space (single-line terminal line per RFC 959). This is fragile against servers that send responses where `\r\n` arrives split from the response code line.

**FTPS (FTPSSession.readResponse):** Loops reading chunks until `isComplete()` returns true. `isComplete()` checks that the *last* line of the buffer matches `/^\d{3} /` (terminal line). Also has a `timedOut` flag that causes the loop to exit without a complete response — downstream code receives a partial buffer.

### Response timeout (FTP)

`readResponse` in the FTPClient defaults to a 10 s timeout. The data transfer loops for LIST and RETR/STOR use separate 30 s and 60 s timeouts respectively. There is no outer wall-clock timeout on FTP HTTP endpoints — only the inner per-read limits apply.

### FTPS connect response completeness check

The `readResponse` helper in `handleFTPSConnect` uses a different regex pattern than `FTPSSession.readResponse`:

```javascript
// handleFTPSConnect
if (/^\d{3} .+\r?\n$/m.test(responseText)) break;
if (/^\d{3}-.+\r?\n\d{3} .+\r?\n$/ms.test(responseText)) break;
```

This detects one-line and two-line patterns. For three-or-more-line multi-line responses, the loop continues reading until the per-read timeout resolves with `{ done: true }`. Long FEAT responses with many features may be truncated on slow connections.

### No STARTTLS / Explicit TLS

Explicit TLS (AUTH TLS / STARTTLS on port 21) is not implemented. The FTPS handler only does implicit TLS. If you need to test a server that requires `AUTH TLS`, the `/api/ftps/connect` FEAT response will show `AUTH TLS` in its features list, but no actual upgrade occurs.

---

## Cross-implementation comparison

| Endpoint | FTP | FTPS |
|----------|-----|------|
| Connect (probe) | `GET\|POST /api/ftp/connect` — requires auth | `POST /api/ftps/connect` — no auth |
| Login | *(same endpoint)* | `POST /api/ftps/login` — returns cwd + systemType |
| List | `GET\|POST /api/ftp/list` | `POST /api/ftps/list` |
| Download | `GET\|POST /api/ftp/download` → binary body | `POST /api/ftps/download` → JSON+base64 |
| Upload | `POST /api/ftp/upload` → form-data | `POST /api/ftps/upload` → JSON+base64 |
| Delete | `POST /api/ftp/delete` → DELE only | `POST /api/ftps/delete` → DELE or RMD |
| Mkdir | `POST /api/ftp/mkdir` | `POST /api/ftps/mkdir` |
| Rename | `POST /api/ftp/rename` (fromPath/toPath) | `POST /api/ftps/rename` (from/to) |
| Rmdir | ❌ not available | ✅ via `type: 'dir'` in delete |

---

## What is NOT implemented

| Feature | Notes |
|---------|-------|
| Active mode (PORT) | PASV only; firewalled servers requiring PORT will fail |
| EPSV | No IPv6 data connections |
| AUTH TLS / STARTTLS | No explicit FTPS; implicit FTPS only |
| MLSD / MLST | Structured directory listing not exposed |
| NLST | Bare filename list not exposed |
| SIZE / MDTM | File size / modification time not exposed |
| RETR partial (REST) | No resume download |
| APPE | No append mode upload |
| SITE commands | Server-specific commands not exposed |
| Directory rmdir (FTP) | Use FTPS delete with `type: 'dir'` |
| Anonymous FTP shortcut | Works: pass `username: 'anonymous'`, `password: 'guest@example.com'` |
| DOS-format LIST | Only Unix `ls -l` output is parsed; Windows FTP servers return garbled results |

---

## curl quick reference

```bash
# FTP: connect test
curl -s "https://portofcall.ross.gg/api/ftp/connect?host=ftp.example.com&username=alice&password=hunter2" | jq .

# FTP: list directory
curl -s -X POST https://portofcall.ross.gg/api/ftp/list \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftp.example.com","username":"alice","password":"hunter2","path":"/pub"}' | jq '.files[].name'

# FTP: upload (multipart/form-data)
curl -s -X POST https://portofcall.ross.gg/api/ftp/upload \
  -F host=ftp.example.com \
  -F username=alice \
  -F password=hunter2 \
  -F remotePath=/upload/test.txt \
  -F file=@local_file.txt | jq .

# FTP: download binary
curl -s "https://portofcall.ross.gg/api/ftp/download?host=ftp.example.com&username=alice&password=hunter2&remotePath=/pub/file.tar.gz" \
  --output file.tar.gz

# FTP: delete
curl -s -X POST https://portofcall.ross.gg/api/ftp/delete \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftp.example.com","username":"alice","password":"hunter2","remotePath":"/pub/old.txt"}' | jq .

# FTP: rename/move
curl -s -X POST https://portofcall.ross.gg/api/ftp/rename \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftp.example.com","username":"alice","password":"hunter2","fromPath":"/pub/a.txt","toPath":"/pub/b.txt"}' | jq .

# FTPS: server probe (no auth)
curl -s -X POST https://portofcall.ross.gg/api/ftps/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftps.example.com"}' | jq '{rtt, systemType, tlsFeatures}'

# FTPS: login
curl -s -X POST https://portofcall.ross.gg/api/ftps/login \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftps.example.com","username":"alice","password":"hunter2"}' | jq .

# FTPS: list
curl -s -X POST https://portofcall.ross.gg/api/ftps/list \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftps.example.com","username":"alice","password":"hunter2","path":"/pub"}' | jq '.entries[] | {name,type,size}'

# FTPS: download (returns base64)
curl -s -X POST https://portofcall.ross.gg/api/ftps/download \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftps.example.com","username":"alice","password":"hunter2","path":"/pub/file.txt"}' | \
  jq -r '.content' | base64 -d > file.txt

# FTPS: upload (send base64)
curl -s -X POST https://portofcall.ross.gg/api/ftps/upload \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"ftps.example.com\",\"username\":\"alice\",\"password\":\"hunter2\",\"path\":\"/upload/test.txt\",\"content\":\"$(base64 < local_file.txt)\"}" | jq .

# FTPS: delete directory (port must be explicit due to default=21 bug)
curl -s -X POST https://portofcall.ross.gg/api/ftps/delete \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftps.example.com","port":990,"username":"alice","password":"hunter2","path":"/old_dir","type":"dir"}' | jq .
```

---

## Local test servers

**Pure-FTPd (plain FTP):**
```bash
docker run -d -p 21:21 -p 30000-30009:30000-30009 \
  -e "PUBLICHOST=localhost" \
  --name pure-ftpd stilliard/pure-ftpd

# Create user
docker exec pure-ftpd pure-pw useradd alice -u ftpuser -d /home/alice/ftp -m
docker exec pure-ftpd pure-pw mkdb
```

**vsftpd (supports both FTP and FTPS):**
```bash
# Generate self-signed cert for FTPS
openssl req -x509 -newkey rsa:2048 -keyout vsftpd.key -out vsftpd.crt -days 365 -nodes -subj '/CN=localhost'

docker run -d -p 21:21 -p 990:990 -p 21000-21010:21000-21010 \
  --name vsftpd fauria/vsftpd
```

**FileZilla Server** (Windows, for testing DOS-format LIST output — currently returns entries parsed as `unknown` by this implementation).
