# AFP (Apple Filing Protocol) — Power-User Reference

**Port:** 548 (TCP)
**Transport:** DSI (Data Stream Interface) over TCP
**Implementation:** `src/worker/afp.ts`
**Rating:** ★★★★★

---

## Endpoints

13 endpoints, all `POST`-only (return 405 for other methods). Every authenticated endpoint establishes a full session (DSIOpenSession → FPLogin → operation → FPLogout → DSICloseSession) per request — no persistent sessions.

### Unauthenticated

| Endpoint | Description |
|----------|-------------|
| `/api/afp/connect` | DSIGetStatus probe — server name, AFP versions, UAMs, capability flags |
| `/api/afp/server-info` | Same as `/connect` but different response shape (returns `latencyMs` instead of `rtt`/`connectTime`) |
| `/api/afp/open-session` | DSIOpenSession only — returns server option data as hex "sessionToken" |

### Authenticated

| Endpoint | Description |
|----------|-------------|
| `/api/afp/login` | FPLogin + FPGetSrvrParms — returns volume list |
| `/api/afp/list-dir` | FPEnumerateExt2 — list directory entries |
| `/api/afp/get-info` | FPGetFileDirParms — file/dir metadata |
| `/api/afp/create-dir` | FPCreateDir — returns new dir ID |
| `/api/afp/create-file` | FPCreateFile (HardCreate, not SoftCreate) |
| `/api/afp/delete` | FPDelete — file or empty directory |
| `/api/afp/rename` | FPRename — same-parent rename only |
| `/api/afp/read-file` | FPOpenFork + FPReadExt — data fork, base64 response |
| `/api/afp/write-file` | FPCreateFile + FPOpenForkEx + FPWriteExt — base64 input |
| `/api/afp/resource-fork` | FPOpenForkEx(forkType=1) + FPReadExt — resource fork, base64 response |

---

## Common Request Fields

All endpoints accept:

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | — | Required. Trimmed; empty string rejected. No regex validation (unlike Gopher/WHOIS). |
| `port` | number | `548` | 1–65535 |
| `timeout` | number | `15000` | Capped at `Math.min(timeout, 30000)` — max 30s regardless of input |

Authenticated endpoints additionally accept:

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `username` | string | `""` | Empty string for anonymous |
| `password` | string | `""` | Truncated to 8 bytes for Cleartext UAM |
| `uam` | string | `"No User Authent"` | See UAM section below |
| `volumeName` | string | — | Required for all file operations |
| `dirId` | number | `2` | Directory ID; 2 = volume root |

---

## Authentication (UAMs)

Two UAMs are implemented:

### `"No User Authent"` (guest)
- Wire: `FP_LOGIN(18)` + AFP version pascal string + UAM pascal string
- No username/password fields sent
- Default when `uam` is omitted

### `"Cleartxt Passwrd"` (cleartext password)
- Wire: `FP_LOGIN(18)` + AFP version + UAM + 8-byte username + 8-byte password (null-padded)
- **Username and password are both silently truncated to 8 bytes** — `username.substring(0, 8)`
- Password sent in cleartext over TCP — no TLS

### Not implemented
- **DHCAST128** — listed in POWER_USERS_HAPPY.md but not actually in the code. `buildFPLogin()` throws `"Unsupported UAM"` for anything besides the two above.
- **DHX2** (Diffie-Hellman Exchange 2)
- **Kerberos**
- **Randnum Exchange**

The POWER_USERS_HAPPY.md description incorrectly claims "DHCAST128 auth" support.

---

## DSI Wire Protocol

Every request is framed in a 16-byte DSI header:

```
Byte 0:     Flags      (0x00=request, 0x01=reply)
Byte 1:     Command    (see table below)
Byte 2-3:   Request ID (uint16 BE, incremented per request)
Byte 4-7:   Error Code / Data Offset (int32 BE)
Byte 8-11:  Total Data Length (uint32 BE)
Byte 12-15: Reserved (zeros)
```

### DSI Commands

| Code | Name | Used |
|------|------|------|
| `0x01` | DSICloseSession | Yes — session teardown |
| `0x02` | DSICommand | Yes — wraps all AFP commands |
| `0x03` | DSIGetStatus | Yes — unauthenticated server info |
| `0x04` | DSIOpenSession | Yes — session establishment |
| `0x05` | DSITickle | Received only — drained silently |
| `0x08` | DSIAttention | Received only — drained silently |

### AFP Commands

| Code | Name | Endpoint(s) |
|------|------|-------------|
| `2` | FPCloseVol | All authenticated (cleanup) |
| `4` | FPCloseFork | /read-file, /write-file, /resource-fork (cleanup) |
| `6` | FPCreateDir | /create-dir |
| `8` | FPCreateFile | /create-file, /write-file |
| `9` | FPDelete | /delete |
| `16` | FPGetSrvrParms | /login (volume enumeration) |
| `18` | FPLogin | All authenticated endpoints |
| `20` | FPLogout | All authenticated (cleanup) |
| `26` | FPOpenFork | /read-file (read-only data fork) |
| `27` | FPOpenVol | All authenticated (volume mount) |
| `28` | FPRename | /rename |
| `34` | FPGetFileDirParms | /get-info |
| `60` | FPReadExt | /read-file, /resource-fork |
| `65` | FPWriteExt | /write-file |
| `68` | FPEnumerateExt2 | /list-dir |

---

## Endpoint Details

### `/api/afp/connect` vs `/api/afp/server-info`

Both send DSIGetStatus and parse the FPGetSrvrInfo response. The differences:

| | `/connect` | `/server-info` |
|--|-----------|----------------|
| Response timing | `connectTime` (TCP only) + `rtt` (total) | `latencyMs` (total only) |
| Error DSI code handling | Returns `success:true` with `status:"error"` | Throws → 500 with `success:false` |
| Flag descriptions | Included (`flagDescriptions` array) | Not included |
| DSI close | Sends DSICloseSession | Does not send DSICloseSession |
| Timeout arithmetic | `timeout - connectTime` for read | `timeout - elapsed` for read |
| Error status code | 500 for invalid header | 200 with `success:false` for all errors |

Both parse the same 12 server capability flags:

| Bit | Description |
|-----|-------------|
| `0x0001` | CopyFile |
| `0x0002` | ChangeablePasswords |
| `0x0004` | NoSavePassword |
| `0x0008` | ServerMessages |
| `0x0010` | ServerSignature |
| `0x0020` | TCPoverIP |
| `0x0040` | ServerNotifications |
| `0x0080` | Reconnect |
| `0x0100` | DirectoryServices |
| `0x0200` | UTF8ServerName |
| `0x0400` | UUIDs |
| `0x0800` | SuperClient |

### `/api/afp/open-session`

DSIOpenSession with Attention Quantum option (type 0x00, value 4096). Returns server's option data as a hex string `sessionToken`. Note: this is NOT a reusable session — the socket is closed immediately after.

**Quirk:** Uses `buildDSIOpenSessionAFP0()` (attnQuant=4096) while `AFPSession.openSession()` uses `buildDSIOpenSession()` (different option bytes: `[0x01, 0x04, 0x00, 0x00, 0x04, 0x00]` = option type 0x01, value 1024). Two different DSIOpenSession builders exist with different option types and values.

### `/api/afp/list-dir`

Uses FPEnumerateExt2 (command 68) with fixed bitmaps:
- **File bitmap:** Attributes + ModDate + LongName + NodeID + DataForkLen = `0x034B`
- **Dir bitmap:** Attributes + ModDate + LongName + NodeID = `0x014B`
- **maxCount:** 200 entries (hardcoded)
- **maxReplySize:** 65536 bytes (hardcoded)
- **startIndex:** 1 (no pagination support)

Returns `AFPDirEntry[]`:
```json
{
  "name": "Documents",
  "isDir": true,
  "nodeId": 12345,
  "modDate": 3789234567,
  "size": 5,
  "attributes": 32768
}
```

**modDate** is AFP epoch (seconds since 2000-01-01 00:00:00 UTC). To convert to Unix timestamp: `modDate + 946684800`.

**size** for directories is offspring count (number of immediate children). For files it's data fork length in bytes (32-bit; max 4 GB).

### `/api/afp/read-file` and `/api/afp/resource-fork`

Both return base64-encoded data. Default `maxBytes` = 65536 (64 KB). No configurable `maxBytes` parameter for `/read-file` (hardcoded); `/resource-fork` accepts `maxBytes`.

**Base64 encoding:** Uses `btoa(String.fromCharCode(...))` character-by-character loop — will be slow for large files and may hit string length limits.

### `/api/afp/write-file`

Accepts base64-encoded `data` field. Auto-creates the file if it doesn't exist (pass `create: false` to skip). Offset is a number (converted to BigInt internally).

**Create-file error suppression bug:** The code catches create-file errors and ignores them if the message contains `'-5001'`, `'Object Exists'`, or `'ObjectExists'`. The catch logic is split across two code paths:
- If the server returns AFP error code **-5001** (the spec's `kFPObjectExists`): `getAFPErrorMessage(-5001)` returns `"AFP error -5001"` (since -5001 IS NOT in the error table), and `msg.includes('-5001')` matches — **error correctly suppressed**.
- If the server returns AFP error code **-5043** (mapped in the error table): `getAFPErrorMessage(-5043)` returns `"Object already exists"`. None of the three substring checks match (`'-5001'`, `'Object Exists'`, `'ObjectExists'` are all absent from `"Object already exists"`) — **error is NOT suppressed, write fails**.

In practice: servers returning -5001 work correctly; servers returning -5043 break the create-before-write pattern. Workaround: set `create: false` and ensure the file already exists, or delete+recreate.

---

## Known Limitations and Quirks

1. **No TLS** — All communication is plaintext TCP. Cleartext password UAM sends credentials in the clear.

2. **No Cloudflare detection** — None of the 13 endpoints call `checkIfCloudflare()`.

3. **No host validation regex** — Unlike most other handlers, AFP accepts any host string (only checks non-empty after trim). This means special characters, IPv6, and hostnames with underscores all pass validation.

4. **8-byte username/password truncation** — Cleartext UAM silently truncates both to 8 bytes. No warning in the response.

5. **DHCAST128 not implemented** — POWER_USERS_HAPPY.md claims it is; the code throws "Unsupported UAM" for anything except `"No User Authent"` and `"Cleartxt Passwrd"`.

6. **AFP version hardcoded** — `/login` accepts `afpVersion` parameter (default `"AFP3.4"`). All other authenticated endpoints hardcode `"AFP3.4"` via the `AFPSession` class default. The `/login` endpoint passes `afpVersion` through but other endpoints do not accept it.

7. **No directory pagination** — FPEnumerateExt2 uses `startIndex=1` and `maxCount=200`. Directories with >200 entries are truncated silently.

8. **Two duplicate DSIGetStatus endpoints** — `/api/afp/connect` and `/api/afp/server-info` do the same thing with slightly different response shapes.

9. **Two duplicate DSIOpenSession builders** — `buildDSIOpenSession()` (option type 0x01, attnQuant=1024) used by `AFPSession` and `buildDSIOpenSessionAFP0()` (option type 0x00, attnQuant=4096) used by `/open-session` endpoint. Different option types and values.

10. **`readExact` excess-byte discard** — When `reader.read()` returns more data than needed, the excess bytes beyond the requested `length` are silently discarded. This could lose data on pipelined responses.

11. **Error code table uses string keys** — `getAFPErrorMessage()` declares `Record<number, string>` but the literal keys are strings like `'-5019'`. This is a TypeScript type annotation mismatch, NOT a runtime bug: JavaScript coerces number keys to strings for object lookup, so `errors[-5019]` correctly finds the `'-5019'` entry. All error codes resolve to their named messages.

12. **1 MB payload cap** — `readDSIResponse()` skips payloads ≥1 MB. Large directory listings or file reads that exceed this are silently returned as empty.

13. **FPGetFileDirParms isDir detection** — `parseEnumerateEntry()` checks bit 15 of Attributes for isDir, but only if BOTH file and dir bitmaps include kFPAttributeBit. In `parseFPGetFileDirParms()`, the isDir flag from byte 4 of the reply overrides the bitmap-based detection — correct but the two paths can disagree for malformed responses.

14. **No LongName offset in enumerate** — `parseEnumerateEntry()` reads the LongName as an inline pascal string at the current offset, but FPEnumerateExt2 stores it as a **name offset** (2-byte pointer relative to entry start), not inline. This parser may return garbled names for some servers.

15. **kFPDataForkLenBit dual meaning** — Bit 0x0200 means "DataForkLen" for files (4 bytes) but "OffspringCount" for directories (2 bytes). The parser handles this correctly based on the isDir flag, but the bitmap constant name is misleading.

16. **Timeout is wall-clock scoped** — The 15s default timeout is a hard deadline from the start of the TCP connection. Each step (connect, open session, login, volume mount, operation, cleanup) shares the same budget. Complex operations (write-file with create) use 6+ DSI round-trips, leaving little time per step.

17. **No move operation** — FPMoveAndRename is not implemented. Rename only works within the same parent directory.

18. **No file locking** — FPOpenFork uses fixed access modes (read=0x0001 for read-file, write=0x0002 for write-file). No deny modes or advisory locks.

19. **DSI Tickle not echoed** — `AFPSession.sendCommand()` drains incoming DSI Tickle (0x05) and Attention (0x08) frames while waiting for replies, but never sends a Tickle response back. Per DSI spec, clients should echo Tickles to keep the session alive. Long-running operations on slow servers may trigger server-side session timeouts.

20. **Cleanup errors silently swallowed** — `logout()`, `closeVolume()`, `closeFork()`, and `close()` all catch and ignore errors. If a volume close or logout fails (e.g., locked resources), the caller gets `success:true` with no indication of the cleanup failure.

21. **No SetFileDirParms** — Cannot set file permissions, creation/modification dates, Finder info, or UNIX mode bits. All metadata is read-only.

22. **No FPGetUserInfo** — Cannot query the authenticated user's UID, GID, or group membership. No way to check permissions before attempting operations.

23. **No FPMoveAndRename** — Only same-directory rename via FPRename. Cross-directory moves are not supported. Would need to copy+delete manually.

24. **Base64 encoding uses char-by-char loop** — Both `/read-file` and `/resource-fork` build a string via `String.fromCharCode(data[i])` in a loop, then call `btoa()`. For the 64 KB default cap this is fine, but the approach doesn't scale and would OOM on very large `maxBytes` values in `/resource-fork`.

---

## AFP Error Codes

Mapped in `getAFPErrorMessage()`:

| Code | Message |
|------|---------|
| 0 | Success |
| -5019 | Access denied |
| -5023 | Authentication in progress |
| -5028 | Unsupported UAM |
| -5030 | Bitmap error |
| -5031 | Cannot move |
| -5033 | Directory not empty |
| -5034 | Disk full |
| -5035 | End of file |
| -5036 | File busy |
| -5038 | Item not found |
| -5039 | Lock error |
| -5040 | Miscellaneous error |
| -5043 | Object already exists |
| -5044 | Object not found |
| -5045 | Parameter error |
| -5046 | Range not locked |
| -5047 | Range overlap |
| -5048 | Too many sessions |
| -5050 | Too many files |
| -5051 | Volume locked |
| -5055 | Authentication failed |

Unmapped codes return `"AFP error {code}"`. Note: the spec's `kFPObjectExists` is -5001 but this table maps -5043 instead — some servers may return either code (see write-file bug above).

---

## Curl Examples

**Server info (unauthenticated):**
```bash
curl -X POST https://portofcall.dev/api/afp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100"}'
```

**Login and list volumes:**
```bash
curl -X POST https://portofcall.dev/api/afp/login \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100", "username":"admin", "password":"secret", "uam":"Cleartxt Passwrd"}'
```

**Guest login (anonymous):**
```bash
curl -X POST https://portofcall.dev/api/afp/login \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100"}'
```

**List volume root:**
```bash
curl -X POST https://portofcall.dev/api/afp/list-dir \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100", "volumeName":"SharedFiles"}'
```

**Read a file:**
```bash
curl -X POST https://portofcall.dev/api/afp/read-file \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100", "volumeName":"SharedFiles", "dirId":2, "name":"readme.txt"}'
```

**Write a file (base64 data):**
```bash
curl -X POST https://portofcall.dev/api/afp/write-file \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100", "volumeName":"SharedFiles", "name":"test.txt", "data":"SGVsbG8gV29ybGQ=", "uam":"Cleartxt Passwrd", "username":"admin", "password":"secret"}'
```

**Read resource fork:**
```bash
curl -X POST https://portofcall.dev/api/afp/resource-fork \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100", "volumeName":"SharedFiles", "name":"oldapp", "maxBytes":131072}'
```

---

## Testing

AFP servers for testing:
- **Netatalk** — open-source AFP server for Linux/FreeBSD (`apt install netatalk`)
- **macOS** — System Preferences → Sharing → File Sharing (enable AFP)
- Docker: `docker run -d -p 548:548 servercontainers/netatalk`
