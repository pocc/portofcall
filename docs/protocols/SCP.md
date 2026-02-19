# SCP (Secure Copy Protocol) — Power User Documentation

## Overview

SCP (Secure Copy Protocol) is a file transfer mechanism that operates over SSH (Secure Shell). Unlike SFTP, which is a fully-featured file system protocol, SCP is a simple command-line protocol designed for copying files between hosts. It has no formal RFC specification and is implemented based on the behavior of OpenSSH's `scp` command.

**Key characteristics:**
- Wire protocol runs inside an SSH exec channel
- No formal specification — implementations vary
- Simple control message format with binary acknowledgments
- Supports file transfers, timestamp preservation, and recursive directory copying
- Considered legacy — OpenSSH 9.0+ uses SFTP internally by default

**Port:** 22 (TCP) — standard SSH port

**Security:** All data is encrypted via SSH transport. Authentication supports password and public key methods.

## Implementation Status

This implementation provides:
- ✅ SSH banner detection (`/api/scp/connect`)
- ✅ Directory listing via `ls -la` (`/api/scp/list`)
- ✅ Single file download with timestamp support (`/api/scp/get`)
- ✅ Single file upload (`/api/scp/put`)
- ✅ Shell command injection protection (all paths are shell-escaped)
- ✅ Filename path traversal protection (paths with `/`, `\`, `.`, `..` are rejected)
- ❌ Recursive directory transfers (not implemented)
- ❌ `scp -p` timestamp preservation on upload (not implemented)

## API Endpoints

### 1. Connect (Banner Detection)

Test if an SSH server is reachable and retrieve its banner.

**Endpoint:** `POST /api/scp/connect`

**Request:**
```json
{
  "host": "example.com",
  "port": 22,
  "timeout": 10000
}
```

**Parameters:**
- `host` (required): Hostname or IP address
- `port` (optional): TCP port, default 22
- `timeout` (optional): Connection timeout in milliseconds, default 10000

**Response (success):**
```json
{
  "success": true,
  "host": "example.com",
  "port": 22,
  "banner": "SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.1",
  "protoVersion": "2.0",
  "softwareVersion": "OpenSSH_8.9p1",
  "comments": "Ubuntu-3ubuntu0.1",
  "message": "SSH server reachable — SCP is available. Use /api/scp/list or /api/scp/get with credentials."
}
```

**Response (not SSH):**
```json
{
  "success": false,
  "host": "example.com",
  "port": 22,
  "banner": "HTTP/1.1 400 Bad Request",
  "message": "Server did not send an SSH banner — SCP requires an SSH server on this port"
}
```

**No authentication required** for this endpoint.

---

### 2. List Directory

List files in a directory using `ls -la` command via SSH exec.

**Endpoint:** `POST /api/scp/list`

**Request:**
```json
{
  "host": "example.com",
  "port": 22,
  "username": "user",
  "password": "pass",
  "path": "/home/user",
  "timeout": 20000
}
```

**Parameters:**
- `host` (required): Hostname or IP
- `port` (optional): TCP port, default 22
- `username` (required): SSH username
- `password` (optional): Password authentication
- `privateKey` (optional): Ed25519 private key (OpenSSH or PEM format)
- `passphrase` (optional): Private key passphrase if encrypted
- `path` (optional): Directory path to list, default `.` (current directory)
- `timeout` (optional): Operation timeout in milliseconds, default 20000

**Response:**
```json
{
  "success": true,
  "host": "example.com",
  "port": 22,
  "path": "/home/user",
  "count": 3,
  "entries": [
    {
      "permissions": "-rw-r--r--",
      "links": 1,
      "owner": "user",
      "group": "user",
      "size": 1234,
      "date": "Jan 15 10:30",
      "name": "file.txt",
      "type": "file"
    },
    {
      "permissions": "drwxr-xr-x",
      "links": 2,
      "owner": "user",
      "group": "user",
      "size": 4096,
      "date": "Jan 14 09:20",
      "name": "subdir",
      "type": "directory"
    }
  ],
  "rawOutput": "total 12\ndrwxr-xr-x 3 user user 4096 Jan 15 10:30 .\n...",
  "rtt": 842
}
```

**Entry types:** `file`, `directory`, `symlink`, `other`

**Note:** The `.` and `..` entries are filtered out.

---

### 3. Download File (SCP -f mode)

Download a single file using the SCP wire protocol.

**Endpoint:** `POST /api/scp/get`

**Request:**
```json
{
  "host": "example.com",
  "port": 22,
  "username": "user",
  "password": "pass",
  "path": "/home/user/document.pdf",
  "maxBytes": 4194304,
  "timeout": 30000
}
```

**Parameters:**
- `host` (required): Hostname or IP
- `port` (optional): TCP port, default 22
- `username` (required): SSH username
- `password` (optional): Password authentication
- `privateKey` (optional): Ed25519 private key
- `passphrase` (optional): Private key passphrase
- `path` (required): Full path to the file on the remote server
- `maxBytes` (optional): Maximum file size in bytes, default 4MB, max 16MB
- `timeout` (optional): Operation timeout in milliseconds, default 30000

**Response:**
```json
{
  "success": true,
  "host": "example.com",
  "port": 22,
  "path": "/home/user/document.pdf",
  "filename": "document.pdf",
  "mode": "0644",
  "size": 12345,
  "timestamp": "T1705320600 0 1705320600 0",
  "data": "JVBERi0xLjQKJeLjz9...",
  "rtt": 1234
}
```

**Response fields:**
- `filename`: Basename extracted from server's C control message
- `mode`: Unix file permissions (octal, e.g., `0644`)
- `size`: File size in bytes
- `timestamp`: Optional timestamp message from server (if server uses `scp -p`)
- `data`: File content encoded as base64
- `rtt`: Round-trip time in milliseconds

**Security notes:**
- Filename is validated to reject path separators (`/`, `\`) and special names (`.`, `..`)
- If the server sends a filename with path components, the download will fail with error `"Filename contains path separators or special names"`
- File size is checked against `maxBytes` before download begins

**Protocol flow:**
1. Server sends `\0` (ready signal)
2. Client sends `\0` (ready)
3. Server optionally sends `T<mtime> 0 <atime> 0\n` (timestamp)
4. Client sends `\0` (ACK timestamp)
5. Server sends `C<mode> <size> <filename>\n` (file metadata)
6. Client sends `\0` (ACK)
7. Server sends exactly `<size>` bytes of file content
8. Server sends `\0` (EOF marker)
9. Client sends `\0` (final ACK)

---

### 4. Upload File (SCP -t mode)

Upload a single file using the SCP wire protocol.

**Endpoint:** `POST /api/scp/put`

**Request:**
```json
{
  "host": "example.com",
  "port": 22,
  "username": "user",
  "password": "pass",
  "remotePath": "/home/user/upload.txt",
  "filename": "upload.txt",
  "mode": "0644",
  "data": "SGVsbG8sIHdvcmxkIQ==",
  "timeout": 30000
}
```

**Parameters:**
- `host` (required): Hostname or IP
- `port` (optional): TCP port, default 22
- `username` (required): SSH username
- `password` (optional): Password authentication
- `privateKey` (optional): Ed25519 private key
- `passphrase` (optional): Private key passphrase
- `remotePath` (required): Destination path on remote server (can be a directory or full file path)
- `filename` (optional): Filename to use, default is basename of `remotePath`
- `mode` (optional): Unix permissions as 4-digit octal string, default `0644`
- `data` (required): File content as base64-encoded string
- `timeout` (optional): Operation timeout in milliseconds, default 30000

**Response:**
```json
{
  "success": true,
  "host": "example.com",
  "port": 22,
  "remotePath": "/home/user/upload.txt",
  "filename": "upload.txt",
  "bytesUploaded": 13,
  "rtt": 987
}
```

**Validation:**
- `mode` must be exactly 4 octal digits (e.g., `0644`, `0755`)
- `filename` must not contain path separators or special names
- `data` must be valid base64

**Protocol flow:**
1. Client sends `C<mode> <size> <filename>\n`
2. Server sends `\0` (ACK)
3. Client sends file content (exactly `<size>` bytes)
4. Client sends `\0` (EOF marker)
5. Server sends `\0` (final ACK)

---

## SCP Wire Protocol Details

### Control Bytes

The SCP protocol uses three control bytes for acknowledgment and error signaling:

- **`\x00` (0x00)**: Success/OK acknowledgment
- **`\x01` (0x01)**: Non-fatal warning, followed by message text and `\n`
- **`\x02` (0x02)**: Fatal error, followed by message text and `\n`, connection terminates

### Control Messages

All control messages are newline-terminated ASCII.

#### C — File Transfer
**Format:** `C<mode> <size> <filename>\n`

**Example:** `C0644 1234 document.txt\n`

- `mode`: 4-digit octal permissions (e.g., `0644`, `0755`)
- `size`: File size in bytes (decimal)
- `filename`: Basename only, no directory separators

#### D — Directory Transfer
**Format:** `D<mode> 0 <dirname>\n`

**Example:** `D0755 0 mydir\n`

- Used for recursive directory transfers
- Size is always `0` for directories
- **Not implemented in this server**

#### T — Timestamp Preservation
**Format:** `T<mtime> 0 <atime> 0\n`

**Example:** `T1705320600 0 1705320600 0\n`

- `mtime`: Modification time (Unix timestamp, seconds)
- `atime`: Access time (Unix timestamp, seconds)
- The `0` values are reserved for future microsecond precision
- Sent before the `C` or `D` message when using `scp -p`

#### E — End of Directory
**Format:** `E\n`

- Signals the end of a directory transfer
- **Not implemented in this server**

---

## SSH Authentication

### Password Authentication

```json
{
  "username": "myuser",
  "password": "mypassword"
}
```

### Public Key Authentication (Ed25519)

**OpenSSH format:**
```json
{
  "username": "myuser",
  "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAACmFlczI1Ni1jdHIAAAAGYmNyeXB0AAAAGAAAABB...\n-----END OPENSSH PRIVATE KEY-----\n",
  "passphrase": "keypassphrase"
}
```

**PEM format (legacy):**
```json
{
  "username": "myuser",
  "privateKey": "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIE...\n-----END PRIVATE KEY-----\n"
}
```

**Note:** Only Ed25519 keys are supported. RSA, ECDSA, and other key types will fail.

---

## Known Limitations and Quirks

### 1. No Recursive Directory Transfers
This implementation rejects `D` (directory) messages with error `\x02` and message `"Directory transfers not supported"`. To transfer directories, use `/api/scp/list` to enumerate files and transfer them individually.

### 2. No Timestamp Preservation on Upload
The `/api/scp/put` endpoint does not send `T` messages. Uploaded files will have the server's current timestamp. The server may preserve the original timestamps using `touch` via a separate SSH command if needed.

### 3. Directory Listing is Not Native SCP
The `/api/scp/list` endpoint uses `ls -la` via SSH exec, not the SCP protocol. This is a convenience feature and may behave differently on non-Unix systems.

### 4. No Connection Reuse
Each API call opens a new SSH connection. For bulk transfers, this adds significant overhead compared to persistent connections.

### 5. No Progress Callbacks
File transfers are atomic — the entire file is downloaded before the response is returned. Large files may time out or exceed memory limits.

### 6. Shell Command Injection Protection
All path parameters are shell-escaped using single-quote wrapping with embedded quote escaping:
```javascript
path = "/tmp/file'; rm -rf /";
// Becomes: '/tmp/file'\'''; rm -rf /'
```

This prevents command injection but may cause issues with unusual filenames.

### 7. Filename Path Traversal Protection
Filenames returned by the server are validated to reject:
- Paths containing `/` or `\`
- Special names `.` and `..`

If the server sends a filename like `../../etc/passwd`, the transfer will fail.

### 8. Base64 Encoding Overhead
File data is base64-encoded for JSON transport, adding 33% size overhead. A 3 MB file becomes 4 MB in the response.

### 9. Maximum File Size
Download: 16 MB hard limit (configurable via `maxBytes`, default 4 MB)
Upload: Limited by request body size (typically 100 MB in Workers)

### 10. No SFTP Compatibility
This is SCP protocol only. SFTP is a completely different protocol and requires separate implementation.

### 11. Timeout Behavior
- Timeouts apply to the entire operation, not individual reads
- If a transfer is slow but progressing, it may still time out
- Deadline tracking is based on wall-clock time, not idle time

### 12. Error Message Format Inconsistency
SCP protocol errors (starting with `\x01` or `\x02`) are thrown as JavaScript errors and return HTTP 500. A future improvement would return structured error responses with HTTP 400 for protocol errors.

### 13. EOF Marker Handling
The implementation reads the EOF marker (`\0`) with a short timeout (1 second) and continues even if it's not received. Some SCP servers may not send this byte, so the implementation is lenient.

### 14. No Server Version Detection
The implementation does not detect the SCP server version or capabilities. It assumes OpenSSH-compatible behavior.

---

## Wire Protocol Diagram

### Download (scp -f)

```
Client                          Server
  |                                |
  |<-------- \0 (ready) ----------|  (1) Server signals ready
  |                                |
  |---------- \0 (ready) --------->|  (2) Client signals ready
  |                                |
  |<-- T1705320600 0 1705320600 0\n|  (3) Optional: timestamp
  |                                |
  |---------- \0 (ACK) ----------->|  (4) ACK timestamp
  |                                |
  |<---- C0644 1234 file.txt\n ----|  (5) File metadata
  |                                |
  |---------- \0 (ACK) ----------->|  (6) ACK metadata
  |                                |
  |<------- [1234 bytes] ----------|  (7) File content
  |                                |
  |<-------- \0 (EOF) -------------|  (8) End-of-file marker
  |                                |
  |---------- \0 (ACK) ----------->|  (9) Final ACK
  |                                |
```

### Upload (scp -t)

```
Client                          Server
  |                                |
  |---- C0644 1234 file.txt\n ---->|  (1) Client sends metadata
  |                                |
  |<---------- \0 (ACK) -----------|  (2) Server ACKs
  |                                |
  |------- [1234 bytes] ---------->|  (3) Client sends content
  |                                |
  |---------- \0 (EOF) ----------->|  (4) Client sends EOF
  |                                |
  |<---------- \0 (ACK) -----------|  (5) Server final ACK
  |                                |
```

---

## Example Usage

### Download a File

```bash
curl -X POST https://portofcall.example.com/api/scp/get \
  -H "Content-Type: application/json" \
  -d '{
    "host": "ssh.example.com",
    "port": 22,
    "username": "user",
    "password": "secret",
    "path": "/home/user/report.pdf",
    "maxBytes": 10485760
  }' | jq -r '.data' | base64 -d > report.pdf
```

### Upload a File

```bash
base64 -i localfile.txt | jq -Rs '{
  "host": "ssh.example.com",
  "username": "user",
  "password": "secret",
  "remotePath": "/tmp/uploaded.txt",
  "data": .
}' | curl -X POST https://portofcall.example.com/api/scp/put \
  -H "Content-Type: application/json" \
  -d @-
```

### List Directory

```bash
curl -X POST https://portofcall.example.com/api/scp/list \
  -H "Content-Type: application/json" \
  -d '{
    "host": "ssh.example.com",
    "username": "user",
    "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...",
    "path": "/var/www/html"
  }' | jq '.entries[] | select(.type == "file") | .name'
```

### Check SSH Availability

```bash
curl -X POST https://portofcall.example.com/api/scp/connect \
  -H "Content-Type: application/json" \
  -d '{"host": "ssh.example.com"}' | jq .
```

---

## Security Considerations

### 1. Credential Exposure
Passwords and private keys are sent in JSON request bodies. Always use HTTPS to prevent credential interception.

### 2. Path Traversal
All filenames are validated to prevent directory traversal attacks. Paths like `../../etc/passwd` are rejected.

### 3. Command Injection
All shell arguments are escaped to prevent injection attacks. However, the implementation relies on shell escaping correctness.

### 4. File Size Limits
The `maxBytes` parameter prevents memory exhaustion attacks from malicious servers sending huge files.

### 5. Timeout Enforcement
All operations have timeout protection to prevent resource exhaustion from slow or hanging connections.

### 6. No Input Sanitization on Server Side
The remote SCP server may have its own vulnerabilities. This client does not sanitize server responses beyond basic protocol validation.

### 7. Cloudflare Detection
Connections to Cloudflare IPs are blocked to prevent abuse and unexpected behavior.

---

## Comparison: SCP vs SFTP

| Feature | SCP | SFTP |
|---------|-----|------|
| **Protocol Type** | Simple command protocol | Full file system protocol |
| **Specification** | No RFC (OpenSSH behavior) | RFC 4254, 4251 |
| **Directory Listing** | Not native (uses `ls`) | Native READDIR |
| **Resume Transfers** | Not supported | Supported |
| **Symbolic Links** | Follows by default | Can read/create |
| **Permissions** | Basic (mode only) | Full (mode, owner, group) |
| **Random Access** | No | Yes (READ with offset) |
| **Atomic Operations** | No | RENAME, etc. |
| **Modern Recommendation** | Deprecated | Preferred |

**OpenSSH note:** OpenSSH 9.0+ runs SFTP protocol internally when you use the `scp` command. Use `scp -O` to force legacy SCP protocol.

---

## Debugging

### Enable Verbose Logging

Add `verbose: true` to the request (not currently implemented, but reserved for future use).

### Common Error Messages

**"Server did not send initial ready signal"**
- Server is not sending the expected `\0` byte after `scp -f` exec
- May indicate server incompatibility or protocol violation

**"Unexpected SCP control message"**
- Server sent a control byte other than `C`, `D`, or `T`
- Check `rawOutput` or `error` field for details

**"Filename contains path separators or special names"**
- Server is trying to send a file with `/`, `\`, `.`, or `..` in the name
- This is blocked for security reasons

**"File size NNN exceeds maxBytes MMM"**
- File is larger than the `maxBytes` limit
- Increase `maxBytes` (max 16 MB) or download in chunks using a different method

**"Incomplete file transfer: expected NNN bytes, got MMM"**
- Connection dropped or server sent less data than promised
- May indicate network issue or server-side error

**"Invalid base64 data"** (upload)
- The `data` field is not valid base64
- Check encoding before sending

---

## References

- [Secure Copy Protocol - Wikipedia](https://en.wikipedia.org/wiki/Secure_copy_protocol)
- [SCP Overview: Familiar, Simple, Insecure and Slow](https://goteleport.com/blog/scp-familiar-simple-insecure-slow/)
- [OpenSSH scp source code](https://github.com/openssh/openssh-portable/blob/master/scp.c)
- [ProFTPD mod_sftp/scp.c](https://github.com/proftpd/proftpd/blob/master/contrib/mod_sftp/scp.c)
- RFC 4253: SSH Transport Layer Protocol
- RFC 4254: SSH Connection Protocol

---

## Changelog

**2026-02-18** — Initial implementation with security fixes:
- Added shell escaping for all path parameters (command injection prevention)
- Added filename validation (path traversal prevention)
- Fixed protocol flow: server sends ready signal first, not client
- Fixed base64 encoding (was corrupting data in 3-byte chunks)
- Added timestamp message (`T`) handling for `scp -p` compatibility
- Added proper error byte handling (`\x01`, `\x02`)
- Improved EOF marker handling with graceful fallback
- Added input validation for mode, filename, and base64 data
