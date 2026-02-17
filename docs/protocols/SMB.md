# SMB — Power User Reference

**Ports:** 445 (TCP direct, SMB2/3) · 139 (SMB over NetBIOS, not implemented here)  
**Protocol:** SMB2/SMB3 (MS-SMB2), with SMB1 fallback banner grab  
**Tests:** 10/10 ✅ Deployed  
**Source:** `src/worker/smb.ts`

All four endpoints are **anonymous-only** — no credentials are sent or accepted. They probe the SMB control channel using the NTLMSSP null-session mechanism. No file read/write operations are available.

---

## Endpoint Summary

| Endpoint | Protocol flow | Returns |
|---|---|---|
| `POST /api/smb/connect` | NEGOTIATE | Negotiated dialect |
| `POST /api/smb/negotiate` | NEGOTIATE (rich) | GUID, capabilities, system time, SMB1 fallback |
| `POST /api/smb/session` | NEGOTIATE → SESSION_SETUP × 2 (anonymous) | Session ID, session flags |
| `POST /api/smb/tree` | NEGOTIATE → SESSION_SETUP × 2 → TREE_CONNECT | Share type, share flags, maximal access |
| `POST /api/smb/stat` | NEGOTIATE → SESSION_SETUP × 2 → TREE_CONNECT → CREATE → QUERY_INFO → CLOSE | File timestamps, attributes |

---

## Wire framing

Every TCP message uses a **4-byte NetBIOS Session Service header** (required even on direct port 445):

```
Offset  Size  Field
------  ----  -----
0       1     Type (always 0x00 = SESSION MESSAGE)
1       3     Length of the following SMB payload, big-endian
4       …     SMB2 message (64-byte header + body)
```

The SMB2 header is 64 bytes, all integers little-endian. The protocol ID is `\xFE SMB` (`0xFE 0x53 0x4D 0x42`). SMB1 uses `\xFF SMB` (`0xFF 0x53 0x4D 0x42`).

---

## `POST /api/smb/connect` — Basic negotiate

Sends one SMB2 NEGOTIATE request and reads the server's dialect selection.

**Request:**
```json
{ "host": "192.168.1.10", "port": 445, "timeout": 30000 }
```

| Field | Default | Notes |
|---|---|---|
| `host` | required | |
| `port` | `445` | No validation — any port accepted |
| `timeout` | `30000` | Outer race timeout (ms). The inner read has a hardcoded 5-second timeout. |

**Success (200):**
```json
{
  "success": true,
  "message": "SMB connection successful",
  "host": "192.168.1.10",
  "port": 445,
  "dialect": "SMB 3.1.1",
  "serverResponse": "SMB2 negotiate successful — dialect: SMB 3.1.1"
}
```

**Failure (500):**
```json
{
  "success": false,
  "message": "SMB connection failed",
  "host": "192.168.1.10",
  "port": 445,
  "dialect": "Unknown (0xXXXX)",
  "serverResponse": "SMB error status: 0xC0000XXX"
}
```

**Notes:**
- Returns HTTP 500 when `success` is false (unlike `/negotiate` which always returns 200).
- The hardcoded 5-second inner read timeout means that even with `timeout: 30000`, the server has only 5s to respond to the NEGOTIATE.
- Does not parse GUID, capabilities, or system time — use `/negotiate` for those.

---

## `POST /api/smb/negotiate` — Full negotiate

Same NEGOTIATE exchange as `/connect` but parses the full response including server GUID, security mode, capabilities, and system time. Also attempts an SMB1 banner grab if the server doesn't respond with SMB2.

**Request:** same as `/connect`

**SMB2 success (200):**
```json
{
  "success": true,
  "latencyMs": 8,
  "dialect": "SMB 3.1.1",
  "dialectCode": 785,
  "dialectName": "SMB 3.1.1",
  "serverGuid": "12345678-abcd-ef01-2345-6789abcdef01",
  "securityMode": 3,
  "securityModeFlags": ["SigningEnabled", "SigningRequired"],
  "capabilities": ["DFS", "Leasing", "LargeMTU", "MultiChannel", "PersistentHandles", "DirectoryLeasing", "Encryption"],
  "capabilitiesRaw": 127,
  "systemTime": "2024-01-15T10:30:00.000Z"
}
```

**SMB1 fallback (200):**
```json
{
  "success": true,
  "latencyMs": 12,
  "dialect": "SMB 1.x (CIFS)",
  "dialectCode": 1,
  "dialectName": "SMB 1.x (CIFS)",
  "serverGuid": "",
  "securityMode": 0,
  "securityModeFlags": [],
  "capabilities": [],
  "systemTime": null,
  "note": "Server responded with SMB1 — limited information available"
}
```

**Non-SMB response (200):**
```json
{
  "success": false,
  "latencyMs": 5,
  "error": "Response is not an SMB2 or SMB1 packet",
  "rawHex": "48 54 54 50 2f 31 2e 31 20 34 30 34 20 4e 6f 74"
}
```

| Field | Notes |
|---|---|
| `dialectCode` | Numeric dialect (e.g. 0x0311 = 785 = SMB 3.1.1) |
| `serverGuid` | 128-bit server identifier, formatted as standard GUID `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `securityMode` | Bitmask: `0x01` = SigningEnabled, `0x02` = SigningRequired |
| `securityModeFlags` | Decoded array of security mode flag names |
| `capabilities` | Decoded array from capability bitmask (see table below) |
| `capabilitiesRaw` | Raw 32-bit capability bitmask |
| `systemTime` | Server clock as ISO-8601 string, or `null` if zero/invalid |
| `note` | Present only on SMB1 fallback response |
| `rawHex` | First 16 bytes as hex, present only when response is not SMB |

**Notes:**
- Always returns HTTP 200 regardless of `success`.
- Inner read timeout: 6 seconds (hardcoded).
- `systemTime` is converted from Windows FILETIME: 100-ns intervals since 1601-01-01, adjusted by 11,644,473,600 seconds. Precision is limited by floating-point arithmetic in this endpoint (see `/stat` for the integer-safe conversion).
- The SMB1 fallback **does not send an SMB1 NEGOTIATE request** — it detects the `\xFF SMB` signature in whatever the server sent in response to the SMB2 NEGOTIATE. This works on servers that send an SMB1-style error response rather than an SMB2 response.

---

## `POST /api/smb/session` — Anonymous null session

Performs a complete 3-round anonymous session establishment:
1. SMB2 NEGOTIATE
2. SESSION_SETUP round 1: SPNEGO-wrapped NTLMSSP_NEGOTIATE
3. SESSION_SETUP round 2: SPNEGO-wrapped NTLMSSP_AUTHENTICATE (anonymous — all credential fields empty)

**Request:** same schema as `/connect`

**Success (200):**
```json
{
  "success": true,
  "latencyMs": 22,
  "sessionId": 137438953984,
  "sessionFlags": 2,
  "anonymous": true,
  "guest": false,
  "encrypted": false
}
```

**Anonymous session rejected (200, success=false):**
```json
{
  "success": false,
  "latencyMs": 15,
  "error": "Anonymous session rejected: 0xc0000022",
  "sessionId": 0
}
```

| Field | Notes |
|---|---|
| `sessionId` | Server-assigned session ID (low 32 bits of the 64-bit SMB2 SessionId field) |
| `sessionFlags` | Raw 16-bit bitmask from SESSION_SETUP response. `0x0001` = Guest, `0x0002` = null session (anonymous), `0x0004` = session is encrypted |
| `anonymous` | Always `true` in successful responses (the request always uses anonymous auth) |
| `guest` | `true` if server granted a guest token instead of a full session |
| `encrypted` | `true` if the session will be encrypted (rare without full authentication) |

**NTLM flags sent:** `0x60088215` — Unicode, OEM, NTLM, AlwaysSign, 56-bit, 128-bit

**Notes:**
- `sessionId` is only the **low 32 bits** of the 64-bit SMB2 SessionId field (the implementation reads `getUint32(40, true)` rather than `getBigUint64`). For most servers, SessionIds fit in 32 bits during early anonymous sessions.
- Some servers grant the session in a single round (SESSION_SETUP returns STATUS_SUCCESS immediately on round 1). This case is handled and returns `rounds: 1`.
- `0xC0000022` (ACCESS_DENIED) and `0xC000006D` (STATUS_LOGON_FAILURE) are common rejection codes on hardened servers with null sessions disabled.
- IPC$ shares are almost always accessible to null sessions on domain controllers; administrative shares (C$, ADMIN$) require credentials.

---

## `POST /api/smb/tree` — TREE_CONNECT to a named share

Performs the full anonymous session flow (NEGOTIATE → SESSION_SETUP × 2) then sends TREE_CONNECT to probe a specific share.

**Request:**
```json
{ "host": "192.168.1.10", "port": 445, "share": "IPC$", "timeout": 10000 }
```

| Field | Default | Notes |
|---|---|---|
| `share` | `"IPC$"` | Share name without UNC prefix. `IPC$`, `SYSVOL`, `NETLOGON`, `C$`, `ADMIN$`, `PRINT$` are common targets. |

**Success (200):**
```json
{
  "success": true,
  "latencyMs": 35,
  "sessionId": 137438953984,
  "treeId": 5,
  "share": "IPC$",
  "shareType": "PIPE",
  "shareFlags": 2048,
  "capabilities": 0,
  "maximalAccess": "0x001f01ff"
}
```

**TREE_CONNECT rejected (200, success=false):**
```json
{
  "success": false,
  "latencyMs": 28,
  "error": "TREE_CONNECT failed: 0xc0000022",
  "sessionId": 137438953984,
  "share": "C$"
}
```

| Field | Notes |
|---|---|
| `shareType` | `"DISK"`, `"PIPE"`, `"PRINT"`, or `"Unknown (N)"` |
| `shareFlags` | Raw 32-bit flag word. Bit 11 (`0x800`) = `DFS`. Bit 12 (`0x1000`) = `DFS root`. |
| `capabilities` | Server capabilities for this tree. `0x40` = DFS available. |
| `maximalAccess` | Hex string of the maximal access mask the session has on this tree. `"0x001f01ff"` = full access. |

**Share type reference:**

| Code | Name | Description |
|---|---|---|
| 0x01 | DISK | File system share |
| 0x02 | PIPE | Named pipe share (IPC$) |
| 0x03 | PRINT | Print queue share (PRINT$) |

**The UNC path sent:** `\\{host}\{share}` — the host portion is UTF-16LE encoded.

---

## `POST /api/smb/stat` — File attribute query

Full SMB2 flow: NEGOTIATE → SESSION_SETUP × 2 → TREE_CONNECT → CREATE → QUERY_INFO (FileBasicInformation) → CLOSE.

Queries file timestamps and attributes without reading file data.

**Request:**
```json
{
  "host": "192.168.1.10",
  "port": 445,
  "share": "C$",
  "path": "Windows\\System32\\ntoskrnl.exe",
  "timeout": 10000
}
```

| Field | Default | Notes |
|---|---|---|
| `share` | `"C$"` | Share to connect to |
| `path` | `""` | Relative path within the share, using backslash separators. Empty string = root of share. |

**Success (200):**
```json
{
  "success": true,
  "latencyMs": 52,
  "sessionId": 137438953984,
  "treeId": 5,
  "share": "C$",
  "path": "Windows\\System32\\ntoskrnl.exe",
  "creationTime": "2021-10-14T18:57:11.284Z",
  "lastAccessTime": "2024-01-15T09:00:00.000Z",
  "lastWriteTime": "2023-12-14T11:20:33.000Z",
  "changeTime": "2023-12-14T11:20:33.000Z",
  "fileAttributes": "0x0020"
}
```

**Common errors:**
- CREATE fails with `0xC0000022` (ACCESS_DENIED): anonymous session cannot access the file or share
- CREATE fails with `0xC0000034` (OBJECT_NAME_NOT_FOUND): path does not exist
- CREATE fails with `0xC0000039` (OBJECT_PATH_INVALID): malformed path

| Field | Notes |
|---|---|
| `creationTime` | ISO-8601, null if Windows FILETIME is zero |
| `lastAccessTime` | ISO-8601, null if zero |
| `lastWriteTime` | ISO-8601, null if zero |
| `changeTime` | Last metadata change time, ISO-8601 |
| `fileAttributes` | Hex string. See attribute table below. |

**File attribute bitmask:**

| Hex | Constant | Meaning |
|---|---|---|
| `0x0001` | READONLY | |
| `0x0002` | HIDDEN | |
| `0x0004` | SYSTEM | |
| `0x0010` | DIRECTORY | |
| `0x0020` | ARCHIVE | Normal file (most files) |
| `0x0080` | NORMAL | No attributes set |
| `0x0100` | TEMPORARY | |
| `0x0400` | REPARSE_POINT | Junction / symlink |
| `0x0800` | COMPRESSED | |
| `0x4000` | ENCRYPTED | EFS-encrypted |

**Notes:**
- The CREATE request uses `DesiredAccess = 0x00120080` (READ_ATTRIBUTES | SYNCHRONIZE) and `CreateDisposition = FILE_OPEN` — it never creates or modifies files.
- The file ID is extracted from the CREATE response body at offset 132 from the packet start (NetBIOS 4 + SMB2 header 64 + CREATE body 64 = 132).
- Windows FILETIME conversion: `(hi * 4294967296 + lo) / 10000 - 11644473600000` — uses integer math (no floating-point precision loss).
- Anonymous sessions typically only have access to IPC$ (type PIPE), SYSVOL, and NETLOGON on domain controllers. C$ and ADMIN$ require administrator credentials.

---

## Dialect codes and server mapping

| Dialect code | Name | Windows server |
|---|---|---|
| `0x0202` | SMB 2.0.2 | Windows Vista / Server 2008 |
| `0x0210` | SMB 2.1 | Windows 7 / Server 2008 R2 |
| `0x0300` | SMB 3.0 | Windows 8 / Server 2012 |
| `0x0302` | SMB 3.0.2 | Windows 8.1 / Server 2012 R2 |
| `0x0311` | SMB 3.1.1 | Windows 10 / Server 2016+ |

The client NEGOTIATE request advertises all five dialects. The server picks the highest it supports.

---

## Capability flags (from /negotiate)

| Bit | Mask | Constant |
|---|---|---|
| 0 | `0x0001` | DFS — Distributed File System |
| 1 | `0x0002` | Leasing — client-side caching via leases |
| 2 | `0x0004` | LargeMTU — negotiated MTU up to 16MB |
| 3 | `0x0008` | MultiChannel — multiple TCP connections |
| 4 | `0x0010` | PersistentHandles — survive temporary disconnection |
| 5 | `0x0020` | DirectoryLeasing — directory-level caching |
| 6 | `0x0040` | Encryption — AES-128-CCM or AES-128-GCM |

The client NEGOTIATE sends `Capabilities = 0x7F` (all 7 bits set) to maximize information returned.

---

## SMB2 NTSTATUS error codes

| Code | Constant | Common cause |
|---|---|---|
| `0x00000000` | STATUS_SUCCESS | |
| `0xC0000016` | STATUS_MORE_PROCESSING_REQUIRED | Normal mid-session-setup status (not an error) |
| `0xC0000022` | STATUS_ACCESS_DENIED | Share or file inaccessible to anonymous session |
| `0xC000006D` | STATUS_LOGON_FAILURE | Authentication rejected |
| `0xC0000034` | STATUS_OBJECT_NAME_NOT_FOUND | File/path does not exist |
| `0xC0000039` | STATUS_OBJECT_PATH_INVALID | Malformed path |
| `0xC000003A` | STATUS_OBJECT_PATH_NOT_FOUND | Path component missing |
| `0xC00000CC` | STATUS_BAD_NETWORK_NAME | Share name does not exist |

---

## curl Examples

```bash
# Detect SMB version quickly
curl -s -X POST https://portofcall.ross.gg/api/smb/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10"}' | jq .dialect

# Full fingerprint: GUID, capabilities, signing, system time
curl -s -X POST https://portofcall.ross.gg/api/smb/negotiate \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10","timeout":5000}' | jq '{dialect,serverGuid,securityModeFlags,capabilities,systemTime}'

# Test if null/anonymous sessions are allowed
curl -s -X POST https://portofcall.ross.gg/api/smb/session \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10"}' | jq '{success,anonymous,guest,sessionFlags}'

# Probe IPC$ share (pipe share — usually accessible anonymously)
curl -s -X POST https://portofcall.ross.gg/api/smb/tree \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10","share":"IPC$"}' | jq '{success,shareType,maximalAccess}'

# Probe SYSVOL share (domain controller — usually accessible anonymously)
curl -s -X POST https://portofcall.ross.gg/api/smb/tree \
  -H 'Content-Type: application/json' \
  -d '{"host":"dc.example.com","share":"SYSVOL"}' | jq .

# Stat a file on IPC$ (root is a directory — creationTime/lastWriteTime reflect the pipe root)
curl -s -X POST https://portofcall.ross.gg/api/smb/stat \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10","share":"IPC$","path":""}' | jq .

# Stat a specific file (requires share access — usually fails anonymously on C$)
curl -s -X POST https://portofcall.ross.gg/api/smb/stat \
  -H 'Content-Type: application/json' \
  -d '{"host":"fileserver.example.com","share":"public","path":"readme.txt"}' | jq .
```

---

## Known Limitations

**Anonymous only.** No credentials (username/password/domain) are accepted. All four endpoints use NTLMSSP null-session authentication. Authenticated access to C$, ADMIN$, or user data is not possible.

**No file operations.** There is no read, write, list directory, or delete endpoint. `/stat` can query timestamps and attributes but not content.

**No SMB1 support on `/connect`, `/session`, `/tree`, `/stat`.** The SMB1 fallback path exists only in `/negotiate`.

**`sessionId` truncated to 32 bits.** All endpoints read only the low 32 bits of the 64-bit SMB2 SessionId. This is adequate for typical short-lived anonymous sessions.

**Duplicate `/api/smb/stat` route.** `src/worker/index.ts` registers `/api/smb/stat` twice (lines 879 and 883). Both entries dispatch to the same handler, so behavior is correct, but the second registration is a dead route entry.

**`/connect` has no port validation.** The `port` field is not range-checked (unlike `/negotiate` which validates 1–65535). Providing an invalid port value is accepted silently.

**NetBIOS port 139 not supported.** These endpoints target port 445 (direct SMB). Port 139 requires a NetBIOS Name Service session establishment exchange before the SMB NEGOTIATE, which is not implemented.

**SMB signing and encryption not enforced.** The client advertises signing-enabled (`SecurityMode = 0x01`) but does not actually sign messages. Servers with `SigningRequired` (`0x02`) will typically still complete NEGOTIATE but may reject SESSION_SETUP. If the server has `Encryption` capability, the session will not be encrypted (the client sends capabilities flags `0x7F` but doesn't implement AES-CCM/GCM).

---

## Testing Locally

```bash
# Start a Samba server with anonymous access enabled
docker run -d \
  --name samba \
  -p 445:445 \
  -e SAMBA_CONF_LOG_LEVEL=3 \
  dperson/samba \
  -s "public;/public;yes;no;yes;all"

# Test negotiate
curl -s -X POST https://portofcall.ross.gg/api/smb/negotiate \
  -H 'Content-Type: application/json' \
  -d '{"host":"YOUR_HOST","port":445}' | jq .

# Test anonymous session
curl -s -X POST https://portofcall.ross.gg/api/smb/session \
  -H 'Content-Type: application/json' \
  -d '{"host":"YOUR_HOST","port":445}' | jq .
```

---

## Resources

- [MS-SMB2 Protocol Specification](https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-smb2/)
- [MS-NLMP — NTLM Authentication Protocol](https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-nlmp/)
- [RFC 7042 — Media Access Control (MAC) Addresses / SMB FILETIME](https://tools.ietf.org/html/rfc7042)
- [SMB Security Best Practices (Microsoft)](https://docs.microsoft.com/en-us/windows-server/storage/file-server/smb-security)
