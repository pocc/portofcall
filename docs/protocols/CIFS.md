# CIFS / SMB2 — Power-User Reference

**Port:** 445 (TCP, direct SMB)
**Transport:** NetBIOS-framed SMB2 over TCP (4-byte length prefix + SMB2 PDU)
**Authentication:** NTLMv2 via SPNEGO (GSS-API wrapping)
**Implementation:** `src/worker/cifs.ts`
**Rating:** ★★★★★

**Important:** Despite the "CIFS" name, this implementation speaks **SMB2/3 only** — no SMB1/CIFS fallback. The naming is a legacy holdover. The negotiate offers dialects SMB 2.0.2 through SMB 3.1.1.

---

## Endpoints

6 endpoints (5 unique + 1 alias), all `POST`-only (return 405 for other methods). Every authenticated endpoint establishes a full session per request (Negotiate → Session Setup × 2 → Tree Connect → work → Tree Disconnect → Logoff).

### Unauthenticated

| Endpoint | Description |
|----------|-------------|
| `/api/cifs/negotiate` | SMB2 Negotiate — dialect, server GUID, capabilities, timestamps |
| `/api/cifs/connect` | Alias for `/negotiate` (backward compatibility) |

### Authenticated

| Endpoint | Description |
|----------|-------------|
| `/api/cifs/auth` | NTLMv2 session setup — test credentials, returns session info |
| `/api/cifs/ls` | List directory contents (QUERY_DIRECTORY with `*` pattern) |
| `/api/cifs/read` | Read a file (first 64 KB; auto-detects text vs binary) |
| `/api/cifs/stat` | File/directory metadata via CREATE (tries file first, then dir) |
| `/api/cifs/write` | Write/overwrite a file (FILE_OVERWRITE_IF disposition) |

---

## Common Request Fields

All endpoints accept:

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | — | Required. Trimmed; validated against `/^[a-zA-Z0-9._:-]+$/`. Allows colons (IPv6), underscores, dots. |
| `port` | number | `445` | 1–65535 |
| `timeout` | number | varies | Wall-clock deadline from TCP connect start. See per-endpoint defaults. |

Authenticated endpoints additionally accept:

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `username` | string | `""` | Empty for guest/anonymous |
| `password` | string | `""` | No length truncation (unlike AFP's 8-byte limit) |
| `domain` | string | `""` | NTLM domain; falls back to server's `targetName` from Type 2 challenge |
| `share` | string | — | Required for fs operations. Just the share name (e.g. `"Documents"`), not a UNC path |
| `path` | string | `""` | Relative path within share. Forward slashes converted to `\`. Leading `\` stripped. |

---

## Timeout Defaults

| Endpoint | Default Timeout |
|----------|----------------|
| `/negotiate`, `/connect` | 10,000 ms |
| `/auth` | 15,000 ms |
| `/stat` | 15,000 ms |
| `/ls`, `/read`, `/write` | 20,000 ms |

All timeouts are wall-clock — the budget is shared across every SMB2 round-trip in the session (Negotiate, 2× Session Setup, Tree Connect, operation, cleanup). Complex operations like `/write` use 8+ round-trips.

---

## Authentication (NTLMv2)

Full NTLMv2 implementation with custom MD4, MD5, and HMAC-MD5 (no Node.js `crypto` — runs in Cloudflare Workers which lacks it).

### Session Setup Flow

1. **NEGOTIATE** — offers 5 dialects: SMB 2.0.2, 2.1, 3.0, 3.0.2, 3.1.1
2. **SESSION_SETUP round 1** — sends NTLM Type 1 (Negotiate) wrapped in SPNEGO NegTokenInit
3. Server returns Type 2 (Challenge) in SPNEGO blob → `STATUS_MORE_PROCESSING_REQUIRED`
4. **SESSION_SETUP round 2** — sends NTLM Type 3 (Authenticate) wrapped in SPNEGO NegTokenResp
5. Server returns `STATUS_SUCCESS` or `STATUS_LOGON_FAILURE`

### NTLM Details

- **Type 1 Negotiate flags:** `0xA0880205` — UNICODE, REQUEST_TARGET, NTLM, EXTENDED_SESSIONSECURITY, TARGET_INFO, 128, KEY_EXCHANGE, 56
- **Version spoofing:** Claims Windows 10.0 build 19041, NTLM revision 15
- **Workstation:** Hardcoded `"PORTOFCALL"` for all sessions
- **NT hash:** `MD4(UTF-16LE(password))` — standard NT password hash
- **NTLMv2 key:** `HMAC-MD5(NT_hash, UTF-16LE(UPPER(username) + UPPER(domain)))`
- **NTProofStr:** `HMAC-MD5(NTLMv2_key, server_challenge + blob)`
- **LM response:** All zeros (24 bytes) — LMv2 computation is skipped
- **Session key:** All zeros (16 bytes) — no message signing or encryption
- **Client challenge:** 8 cryptographically random bytes via `crypto.getRandomValues()`
- **Timestamp:** Current FILETIME (100-ns intervals since 1601-01-01)

### SPNEGO Wrapping

NTLM messages are wrapped in SPNEGO (RFC 4178) tokens using DER/ASN.1 encoding:
- Type 1 → NegTokenInit (`0x60` APPLICATION tag) with NTLMSSP OID `1.3.6.1.4.1.311.2.2.10`
- Type 3 → NegTokenResp (`0xa1` context tag)

### Not Implemented

- **NTLMv1** — not supported
- **Kerberos** — no SPNEGO mechType for Kerberos
- **Message signing** — signature field is all zeros
- **SMB3 encryption** — despite negotiating SMB 3.x dialects
- **Channel binding** — no Extended Protection for Authentication

---

## SMB2 Wire Protocol

Every message is framed in a 4-byte NetBIOS session header:

```
Byte 0:     0x00 (session message type)
Byte 1-3:   Length of SMB2 PDU (24-bit big-endian)
```

Followed by a 64-byte SMB2 header:

```
Byte 0-3:   Magic: 0xFE 'S' 'M' 'B'
Byte 4-5:   StructureSize (always 64)
Byte 6-7:   CreditCharge
Byte 8-11:  NT Status (response) / Channel Sequence (request)
Byte 12-13: Command
Byte 14-15: CreditRequest/CreditResponse
Byte 16-19: Flags
Byte 20-23: NextCommand
Byte 24-31: MessageId (uint64 LE)
Byte 32-35: Reserved / AsyncId(lo)
Byte 36-39: TreeId
Byte 40-47: SessionId (8 bytes)
Byte 48-63: Signature (16 zeros — no signing)
```

### SMB2 Commands Used

| Code | Name | Endpoint(s) |
|------|------|-------------|
| `0x0000` | NEGOTIATE | All endpoints (first step) |
| `0x0001` | SESSION_SETUP | All authenticated (NTLMv2 handshake) |
| `0x0002` | LOGOFF | All (cleanup) |
| `0x0003` | TREE_CONNECT | /ls, /read, /stat, /write |
| `0x0004` | TREE_DISCONNECT | /ls, /read, /stat, /write (cleanup) |
| `0x0005` | CREATE | /ls, /read, /stat, /write (open file/dir handle) |
| `0x0006` | CLOSE | /ls, /read, /stat, /write (release handle) |
| `0x0008` | READ | /read |
| `0x0009` | WRITE | /write |
| `0x000E` | QUERY_DIRECTORY | /ls |

**Not used:** `0x0010` (QUERY_INFO) is defined as a constant but unused (`void _SMB2_CMD_QUERY_INFO` suppresses the TS warning).

### SMB2 Negotiate Dialects

5 dialects offered (in order): `0x0202` (SMB 2.0.2), `0x0210` (SMB 2.1), `0x0300` (SMB 3.0), `0x0302` (SMB 3.0.2), `0x0311` (SMB 3.1.1).

No negotiate contexts are sent (even for SMB 3.1.1, which technically requires them). The implementation relies on the server falling back gracefully.

### Fixed Client Identity

- **ClientGUID:** `"OrtCallSMB2Clien"` (16 ASCII bytes: `4f 72 74 43 61 6c 6c 53 4d 42 32 43 6c 69 65 6e`)
- **SecurityMode:** `SIGNING_ENABLED` (0x0001) — but signing is never actually performed
- **Capabilities:** `0x7F` (DFS, LEASING, LARGE_MTU, MULTI_CHANNEL, PERSISTENT_HANDLES, DIR_LEASING, ENCRYPTION) — claims all capabilities but doesn't implement most

---

## Endpoint Details

### `/api/cifs/negotiate` (also `/api/cifs/connect`)

Sends a single SMB2 NEGOTIATE and parses the response. No authentication.

**Response:**
```json
{
  "success": true,
  "host": "192.168.1.100",
  "port": 445,
  "tcpLatency": 12,
  "dialect": "SMB 3.0.2",
  "serverGuid": "a1b2c3d4e5f6...",
  "capabilities": ["DFS", "LEASING", "LARGE_MTU"],
  "maxTransactSize": 8388608,
  "maxReadSize": 8388608,
  "maxWriteSize": 8388608,
  "serverTime": "2025-01-15T10:30:00.000Z"
}
```

Server capabilities decoded as strings: DFS (`0x01`), LEASING (`0x02`), LARGE_MTU (`0x04`), MULTI_CHANNEL (`0x08`), PERSISTENT_HANDLES (`0x10`), DIR_LEASING (`0x20`), ENCRYPTION (`0x40`).

**Quirk:** Dead code path — the handler checks `request.method !== 'POST'` at line 890 (returns 405), then at line 894 checks `request.method === 'POST'` again with an `else body = {}` branch that is unreachable.

### `/api/cifs/auth`

Full NTLMv2 handshake (3 SMB2 messages: Negotiate + 2× Session Setup). Returns session info on success, then immediately sends LOGOFF.

**Response (success):**
```json
{
  "success": true,
  "host": "192.168.1.100",
  "port": 445,
  "dialect": "SMB 3.0.2",
  "serverGuid": "a1b2c3d4...",
  "serverTime": "2025-01-15T10:30:00.000Z",
  "targetDomain": "WORKGROUP",
  "sessionId": "0100000000001000",
  "sessionFlags": "NORMAL",
  "maxReadSize": 8388608,
  "maxWriteSize": 8388608
}
```

**sessionFlags mapping:** `1` → `"GUEST"`, `2` → `"ENCRYPT"`, anything else → `"NORMAL"`. Note: `0` (no flags) also maps to `"NORMAL"`.

### `/api/cifs/ls`

Lists directory contents. Uses `withSmbShare()` for the full session lifecycle (5 round-trips for session + 3 for the operation).

**Session round-trips:** NEGOTIATE → SESSION_SETUP ×2 → TREE_CONNECT → CREATE (dir) → QUERY_DIRECTORY → CLOSE → TREE_DISCONNECT → LOGOFF

**Response:**
```json
{
  "success": true,
  "host": "192.168.1.100",
  "share": "Documents",
  "path": "\\",
  "entryCount": 5,
  "entries": [
    {
      "name": "Reports",
      "isDir": true,
      "size": 0,
      "created": "2024-06-15 14:30:00",
      "modified": "2025-01-10 09:15:22",
      "attributes": 16
    }
  ]
}
```

- Uses `FileDirectoryInformation` class (0x01) for QUERY_DIRECTORY
- Pattern: `*` (all entries)
- Output buffer: 65,536 bytes
- Filters out `.` and `..` entries
- Timestamps formatted as `"YYYY-MM-DD HH:MM:SS"` (FILETIME → Date → ISO → sliced)
- **isDir:** Derived from `FILE_ATTRIBUTE_DIRECTORY` (0x10)
- **size:** Low 32 bits of EndOfFile for files; 0 for directories

### `/api/cifs/read`

Reads the first 64 KB of a file. Auto-detects text vs binary.

**Session round-trips:** ...session setup... → CREATE (file) → READ → CLOSE → ...cleanup...

**Binary detection:** Attempts `new TextDecoder('utf-8', { fatal: true }).decode()`. If it throws, the content is binary.

**Response (text):**
```json
{
  "success": true,
  "host": "192.168.1.100",
  "share": "Documents",
  "path": "readme.txt",
  "fileSize": 1234,
  "bytesRead": 1234,
  "truncated": false,
  "isBinary": false,
  "content": "Hello world...",
  "fileAttributes": 32
}
```

**Binary truncation bug:** For binary files, the base64 output is truncated to 1,024 bytes of the original data: `btoa(String.fromCharCode(...Array.from(content.slice(0, 1024))))`. This means even though 64 KB was read from the server, only the first 1 KB is returned as base64. Text files return the full 64 KB.

**DesiredAccess for reads:** `0x00120089` = FILE_READ_DATA | FILE_READ_EA | FILE_READ_ATTRIBUTES | READ_CONTROL | SYNCHRONIZE

### `/api/cifs/stat`

Gets file or directory metadata via CREATE (opens a handle, reads the CREATE response metadata, then CLOSEs).

**Dual-attempt strategy:** Tries `buildCreate(path, ..., isDir=false)` first. If that fails (non-`STATUS_SUCCESS`), tries `buildCreate(path, ..., isDir=true)`. This is because the CREATE options differ for files vs directories (`FILE_SYNCHRONOUS_IO_NONALERT` vs `FILE_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT`).

**File attributes decoded:**
| Bit | Name |
|-----|------|
| `0x01` | READ_ONLY |
| `0x02` | HIDDEN |
| `0x04` | SYSTEM |
| `0x10` | DIRECTORY |
| `0x20` | ARCHIVE |

**Response:**
```json
{
  "success": true,
  "host": "192.168.1.100",
  "share": "Documents",
  "path": "readme.txt",
  "isDirectory": false,
  "size": 1234,
  "attributes": ["ARCHIVE"],
  "rawAttributes": 32
}
```

**Limitation:** Only returns attributes available from the CREATE response — no timestamps, no owner, no ACL. Would need QUERY_INFO (not implemented) for richer metadata.

### `/api/cifs/write`

Writes (or overwrites) a file. Accepts text via `content` or binary via `base64`.

**Input priority:** `base64` field takes precedence over `content`. If neither is provided, writes an empty file (`new TextEncoder().encode('')`).

**CreateDisposition:** `FILE_OVERWRITE_IF` (5) — creates the file if it doesn't exist, or truncates and overwrites if it does. **This is destructive** — existing content is replaced, not appended.

**DesiredAccess for writes:** `0x40120116` = WRITE_DATA | APPEND_DATA | WRITE_EA | WRITE_ATTRIBUTES | READ_CONTROL | SYNCHRONIZE | DELETE

**ShareAccess:** `FILE_SHARE_READ` (1) — other processes can read the file while writing.

**Write offset:** Always 0 (beginning of file). No append mode.

---

## Shared Session Lifecycle (`withSmbShare`)

All filesystem endpoints (ls, read, stat, write) use `withSmbShare()`, which handles:

1. TCP connect (with timeout race)
2. NEGOTIATE
3. SESSION_SETUP round 1 (NTLM Type 1)
4. Parse NTLM Type 2 challenge
5. SESSION_SETUP round 2 (NTLM Type 3)
6. TREE_CONNECT to `\\host\share`
7. **Execute the work callback** (endpoint-specific operations)
8. TREE_DISCONNECT (best-effort, 2s sub-timeout)
9. LOGOFF (best-effort, 2s sub-timeout)
10. Socket close

On error during the work callback, cleanup still sends TREE_DISCONNECT and LOGOFF (best-effort, errors swallowed).

---

## NT Status Codes

13 named status codes in the lookup table:

| Code | Name |
|------|------|
| `0x00000000` | SUCCESS |
| `0xC0000016` | STATUS_MORE_PROCESSING_REQUIRED |
| `0xC000006D` | STATUS_LOGON_FAILURE (bad credentials) |
| `0xC000006E` | STATUS_ACCOUNT_RESTRICTION |
| `0xC000006F` | STATUS_INVALID_LOGON_HOURS |
| `0xC0000022` | STATUS_ACCESS_DENIED |
| `0xC0000034` | STATUS_OBJECT_NAME_NOT_FOUND |
| `0xC0000035` | STATUS_OBJECT_NAME_COLLISION |
| `0xC000003A` | STATUS_OBJECT_PATH_NOT_FOUND |
| `0xC0000056` | STATUS_DELETE_PENDING |
| `0xC00000BA` | STATUS_FILE_IS_A_DIRECTORY |
| `0xC0000101` | STATUS_NOT_EMPTY (directory not empty) |
| `0x80000006` | STATUS_NO_MORE_FILES |
| `0xC0000185` | STATUS_IO_DEVICE_ERROR |

Unknown status codes are rendered as hex: `"0x00000103"`.

---

## Known Limitations and Quirks

1. **Not actually CIFS** — The implementation speaks SMB2/3, not SMB1/CIFS. No SMB1 fallback. Legacy systems that only support SMB1 will fail at NEGOTIATE.

2. **No message signing** — Despite advertising `SIGNING_ENABLED` in SecurityMode and having all the capability flags set, signatures are all zeros. Servers requiring mandatory signing will reject the session.

3. **No SMB3 encryption** — Advertises the ENCRYPTION capability (`0x40`) and negotiates SMB 3.x dialects, but never encrypts messages. Servers requiring encryption will fail.

4. **No negotiate contexts** — SMB 3.1.1 requires negotiate contexts (preauth integrity, encryption capabilities). None are sent. Servers strict about 3.1.1 compliance may downgrade the dialect or reject.

5. **Binary read truncation** — `/api/cifs/read` reads 64 KB from the server but only returns the first 1,024 bytes as base64 for binary files (`content.slice(0, 1024)`). Text files return the full 64 KB. The `bytesRead` field reports the full read length, misleadingly suggesting more data was returned.

6. **32-bit file size** — `parseCreateBody()` reads only the low 32 bits of EndOfFile (`dv.getUint32(56, true)`). Files larger than 4 GB report an incorrect (wrapped) size.

7. **No directory pagination** — QUERY_DIRECTORY is called once with `*` pattern and 65,536-byte output buffer. Directories with many entries that exceed this buffer are silently truncated. No follow-up queries are made.

8. **No delete or rename** — Unlike the AFP handler, there are no delete or rename endpoints. Only read, write, list, and stat.

9. **No append mode** — `/api/cifs/write` always uses `FILE_OVERWRITE_IF` with offset 0. There is no way to append to an existing file.

10. **Dual-attempt stat** — `/api/cifs/stat` always attempts `CREATE` as a file first, then as a directory. For directories, this wastes one SMB2 round-trip and may cause a spurious `STATUS_FILE_IS_A_DIRECTORY` error on the first attempt.

11. **UTF-16LE BMP only** — `utf16le()` and `fromUtf16le()` encode/decode one `charCodeAt()` at a time with no surrogate pair handling. Characters above U+FFFF (emoji, CJK Extension B, etc.) will produce garbled output.

12. **Wall-clock timeout budget** — The single timeout is shared across all round-trips. A `/write` operation goes through 8+ round-trips (negotiate, 2× session setup, tree connect, create, write, close, tree disconnect, logoff). Each step eats into the same 20s budget.

13. **LM response is all zeros** — The 24-byte LM response is `new Uint8Array(24)` (zeros). Servers expecting a valid LMv2 response alongside NTLMv2 may reject authentication.

14. **Session key is all zeros** — `new Uint8Array(16)`. This means no session-level encryption, no message integrity checks, and no derived key material. The `EncryptedRandomSessionKey` field in Type 3 is meaningless.

15. **Capabilities overclaim** — The client advertises capabilities `0x7F` (all 7 flags) including DFS, MULTI_CHANNEL, PERSISTENT_HANDLES, and ENCRYPTION, none of which are actually implemented.

16. **Dead code in negotiate handler** — `handleCIFSNegotiate` checks `request.method !== 'POST'` (returns 405), then has an unreachable `else body = {}` branch for non-POST requests at line 894.

17. **Cloudflare detection enabled** — Unlike AFP and Gopher, all CIFS endpoints call `checkIfCloudflare(host)` and return a 403 if the host resolves to a Cloudflare IP.

18. **`readSmb2Msg` excess data discard** — When `reader.read()` returns more bytes than the NetBIOS-framed message needs, `combineBuffers(chunks).slice(0, needed)` silently discards the excess. If the server pipelines responses (unusual for SMB2), data loss is possible.

19. **No QUERY_INFO** — The constant `_SMB2_CMD_QUERY_INFO` is defined but unused. This means no way to retrieve extended attributes, security descriptors, or alternative data streams.

20. **Host validation allows IPv6 colons** — The regex `/^[a-zA-Z0-9._:-]+$/` permits colons, so bare IPv6 addresses like `::1` pass validation. However, the TCP connect (`connect(\`${host}:${port}\`)`) would parse this ambiguously.

---

## Curl Examples

**Server probe (unauthenticated):**
```bash
curl -X POST https://portofcall.dev/api/cifs/negotiate \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100"}'
```

**Test credentials:**
```bash
curl -X POST https://portofcall.dev/api/cifs/auth \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100", "username":"admin", "password":"secret", "domain":"WORKGROUP"}'
```

**Guest authentication (empty credentials):**
```bash
curl -X POST https://portofcall.dev/api/cifs/auth \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100"}'
```

**List share root:**
```bash
curl -X POST https://portofcall.dev/api/cifs/ls \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100", "share":"Documents", "username":"admin", "password":"secret"}'
```

**List subdirectory:**
```bash
curl -X POST https://portofcall.dev/api/cifs/ls \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100", "share":"Documents", "path":"Reports/2025", "username":"admin", "password":"secret"}'
```

**Read a file:**
```bash
curl -X POST https://portofcall.dev/api/cifs/read \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100", "share":"Documents", "path":"readme.txt", "username":"admin", "password":"secret"}'
```

**Get file metadata:**
```bash
curl -X POST https://portofcall.dev/api/cifs/stat \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100", "share":"Documents", "path":"readme.txt", "username":"admin", "password":"secret"}'
```

**Write a text file:**
```bash
curl -X POST https://portofcall.dev/api/cifs/write \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100", "share":"Documents", "path":"test.txt", "content":"Hello World", "username":"admin", "password":"secret"}'
```

**Write binary (base64):**
```bash
curl -X POST https://portofcall.dev/api/cifs/write \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100", "share":"Documents", "path":"data.bin", "base64":"SGVsbG8gV29ybGQ=", "username":"admin", "password":"secret"}'
```

---

## Testing

SMB2 servers for testing:
- **Samba** — `apt install samba` (configure `smb.conf` with a share)
- **Windows** — File Explorer → right-click folder → Properties → Sharing
- Docker: `docker run -d -p 445:445 dperson/samba -s "share;/data;yes;no;yes"`
- **macOS** — System Settings → General → Sharing → File Sharing (SMB enabled by default)
