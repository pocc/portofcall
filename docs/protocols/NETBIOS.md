# NetBIOS Session Service — Power User Reference

**Port:** 139 (TCP) | **Protocol:** NetBIOS Session Service (RFC 1001, RFC 1002) + SMB1 | **Tests:** Not deployed

Port of Call provides three NetBIOS Session Service endpoints: a basic session establishment probe, a full SMB1 negotiate fingerprinting tool, and a multi-suffix service discovery scanner. All three connect directly from the Cloudflare Worker to your NetBIOS server over TCP port 139. NetBIOS over UDP (port 137/138) and direct SMB over TCP port 445 are not supported.

---

## API Endpoints

### `POST /api/netbios/connect` — Session establishment probe

Sends a Session Request with a specified NetBIOS name and suffix, reads the Session Response (positive, negative, or retarget), and closes the connection.

**Request body:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | Target hostname or IP |
| `port` | number | `139` | TCP port (1-65535) |
| `calledName` | string | `*SMBSERVER` | NetBIOS name to call (15 chars max, padded with spaces) |
| `calledSuffix` | number | `0x20` | Service type suffix (0x00-0xFF) |
| `timeout` | number (ms) | `10000` | Total connection + response timeout |

**Success (200):**
```json
{
  "success": true,
  "host": "192.168.1.100",
  "port": 139,
  "rtt": 47,
  "calledName": "*SMBSERVER",
  "calledSuffix": 32,
  "calledSuffixName": "File Server",
  "responseType": 130,
  "responseTypeName": "Positive Session Response",
  "sessionEstablished": true,
  "message": "NetBIOS session established successfully"
}
```

**Negative response (200):**
```json
{
  "success": true,
  "host": "192.168.1.100",
  "port": 139,
  "rtt": 23,
  "calledName": "MYSERVER",
  "calledSuffix": 27,
  "calledSuffixName": "Domain Master Browser",
  "responseType": 131,
  "responseTypeName": "Negative Session Response",
  "sessionEstablished": false,
  "errorCode": "0x82",
  "errorReason": "Called name not present"
}
```

**Retarget response (200):**
```json
{
  "success": true,
  "host": "192.168.1.100",
  "port": 139,
  "rtt": 18,
  "calledName": "*SMBSERVER",
  "calledSuffix": 32,
  "calledSuffixName": "File Server",
  "responseType": 132,
  "responseTypeName": "Retarget Session Response",
  "sessionEstablished": false,
  "message": "Session retarget",
  "retargetIP": "192.168.1.50",
  "retargetPort": 139
}
```

**Error (500):** `{ "success": false, "error": "Connection timeout" }`

**Cloudflare-protected host (403):** `{ "success": false, "error": "...", "isCloudflare": true }`

---

### `POST /api/netbios/query` — SMB1 negotiate fingerprinting

Establishes a NetBIOS session with `*SMBSERVER` suffix 0x20, then sends an SMB1 NEGOTIATE REQUEST offering all standard dialects (PC NETWORK PROGRAM 1.0 through NT LM 0.12). Parses the NEGOTIATE RESPONSE to extract server metadata: supported dialect, security mode, capabilities, server time/timezone, domain name, server name, and server GUID.

**Request body:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | Target hostname or IP |
| `port` | number | `139` | TCP port (1-65535) |
| `timeout` | number (ms) | `10000` | Total connection + negotiation timeout |

**Success (200):**
```json
{
  "success": true,
  "host": "192.168.1.100",
  "port": 139,
  "rtt": 62,
  "sessionEstablished": true,
  "isSMB": true,
  "dialect": "NT LM 0.12",
  "dialectIndex": 5,
  "securityMode": "0x03",
  "securityModeDescription": "User-Level Auth, Challenge/Response",
  "capabilities": "0x8000f3fd",
  "capabilityFlags": [
    "Raw Mode",
    "MPX Mode",
    "Unicode",
    "Large Files",
    "NT SMBs",
    "RPC Remote APIs",
    "NT Status Codes",
    "Level II Oplocks",
    "Lock and Read",
    "NT Find",
    "DFS",
    "Large WriteX",
    "Extended Security"
  ],
  "serverTime": "2026-02-18T21:34:52.123Z",
  "serverTimezone": "UTC-5",
  "serverGuid": "a3f2b4c1-5d6e-7a8b-9c0d-1e2f3a4b5c6d",
  "domainName": "WORKGROUP",
  "serverName": "FILESERVER01",
  "message": "SMB1 negotiate OK: NT LM 0.12 (62ms)"
}
```

**No SMB support (200):**
```json
{
  "success": true,
  "host": "192.168.1.100",
  "port": 139,
  "rtt": 31,
  "sessionEstablished": true,
  "isSMB": false,
  "message": "NetBIOS session OK but unexpected message type 0x85"
}
```

**Error (500):** `{ "success": false, "error": "NetBIOS session rejected: Called name not present" }`

**Fields in detail:**

- `dialect`: String name from the dialect table (see below), or `"none (no dialects accepted)"` if server rejected all
- `dialectIndex`: 0-based index into the offered dialect list; -1 if none accepted
- `securityMode`: Hex byte, bit flags:
  - `0x01`: User-level authentication (vs. share-level)
  - `0x02`: Challenge/response (vs. plaintext password)
  - `0x08`: SMB signing enabled
- `capabilities`: Hex 32-bit flags (see Capability Flags table below)
- `serverTime`: ISO 8601 timestamp (server's system clock in UTC)
- `serverTimezone`: Minutes from UTC, formatted as `UTC+5` or `UTC-5` (positive = east of Greenwich, negative = west)
- `serverGuid`: 128-bit GUID in standard format (only present if Extended Security is negotiated)
- `domainName` / `serverName`: Null-terminated Unicode strings from the variable section (may be empty)

---

### `POST /api/netbios/probe` — Multi-suffix service discovery

Probes 6 well-known NetBIOS suffixes in sequence (Workstation, File Server, Domain Master Browser, Domain Controller, Master Browser, Messenger) to discover which services are available on the target. Each probe opens a separate TCP connection.

**Request body:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | Target hostname or IP |
| `port` | number | `139` | TCP port (1-65535) |
| `timeout` | number (ms) | `10000` | Total timeout for all probes (each probe has min(3000, timeout) sub-timeout) |

**Success (200):**
```json
{
  "success": true,
  "host": "192.168.1.100",
  "port": 139,
  "rtt": 215,
  "servicesFound": 3,
  "totalProbed": 6,
  "services": [
    {
      "suffix": "0x00",
      "suffixName": "Workstation",
      "available": true
    },
    {
      "suffix": "0x20",
      "suffixName": "File Server",
      "available": true
    },
    {
      "suffix": "0x1b",
      "suffixName": "Domain Master Browser",
      "available": false,
      "error": "Called name not present"
    },
    {
      "suffix": "0x1c",
      "suffixName": "Domain Controller",
      "available": false,
      "error": "Called name not present"
    },
    {
      "suffix": "0x1d",
      "suffixName": "Master Browser",
      "available": true
    },
    {
      "suffix": "0x03",
      "suffixName": "Messenger",
      "available": false,
      "error": "Read timeout"
    }
  ]
}
```

`rtt` is the total time for all probes. Individual probe timeouts are not reported — only success/failure and the error message (if failed).

---

## NetBIOS Name Encoding (First-Level)

NetBIOS names are 16 bytes: 15 characters + 1 suffix byte. The first-level encoding (RFC 1002 §4.1) converts each byte to two bytes:

```
For each byte B:
  High nibble: ((B >> 4) & 0x0F) + 0x41 = 'A' + (B >> 4)
  Low nibble:  (B & 0x0F) + 0x41 = 'A' + (B & 0x0F)
```

Example: `'A'` (0x41) → high nibble 4 → 'E', low nibble 1 → 'B' → `EB`

**Wire format:**
```
[1 byte: length=32] [32 bytes: encoded name] [1 byte: scope ID terminator=0x00]
Total: 34 bytes per NetBIOS name
```

Names shorter than 15 characters are padded with spaces (0x20). Names longer than 15 characters are truncated.

---

## NetBIOS Suffix Types (16th byte)

| Suffix | Hex | Service Type |
|---|---|---|
| 0 | `0x00` | Workstation |
| 3 | `0x03` | Messenger Service |
| 6 | `0x06` | RAS Server |
| 27 | `0x1b` | Domain Master Browser |
| 28 | `0x1c` | Domain Controller |
| 29 | `0x1d` | Master Browser |
| 30 | `0x1e` | Browser Service Election |
| 31 | `0x1f` | NetDDE Service |
| 32 | `0x20` | File Server Service |
| 33 | `0x21` | RAS Client |
| 190 | `0xbe` | Network Monitor Agent |
| 191 | `0xbf` | Network Monitor Application |

Port of Call uses `*SMBSERVER` (wildcard) with suffix 0x20 for SMB1 negotiation, and `PORTOFCALL` with suffix 0x00 for the calling name.

---

## Session Service Packet Types

All NetBIOS Session Service packets have a 4-byte header:

```
[1 byte: type] [1 byte: flags] [2 bytes: length (big-endian)]
```

| Type | Hex | Name | Direction |
|---|---|---|---|
| 0 | `0x00` | Session Message | C↔S |
| 129 | `0x81` | Session Request | C→S |
| 130 | `0x82` | Positive Session Response | S→C |
| 131 | `0x83` | Negative Session Response | S→C |
| 132 | `0x84` | Retarget Session Response | S→C |
| 133 | `0x85` | Session Keepalive | C↔S |

**Session Request payload:**
```
[34 bytes: called name] [34 bytes: calling name]
```

**Negative Session Response payload:**
```
[1 byte: error code]
```

**Retarget Session Response payload:**
```
[4 bytes: IP address] [2 bytes: port (big-endian)]
```

---

## Negative Session Response Error Codes

| Code | Hex | Meaning |
|---|---|---|
| 128 | `0x80` | Not listening on called name |
| 129 | `0x81` | Not listening for calling process |
| 130 | `0x82` | Called name not present |
| 131 | `0x83` | Called name present, but insufficient resources |
| 143 | `0x8f` | Unspecified error |

---

## SMB1 Dialects Offered

Port of Call sends these 6 dialects in order (index 0-5):

| Index | Dialect String |
|---|---|
| 0 | `PC NETWORK PROGRAM 1.0` |
| 1 | `LANMAN1.0` |
| 2 | `Windows for Workgroups 3.1a` |
| 3 | `LM1.2X002` |
| 4 | `LANMAN2.1` |
| 5 | `NT LM 0.12` |

The server's NEGOTIATE RESPONSE includes a `DialectIndex` (0-5 for accepted, 0xFFFF for none). Modern Windows servers choose index 5 (NT LM 0.12). Samba also supports all dialects.

---

## SMB1 Capability Flags (NT LM 0.12)

| Bit | Hex | Name | Meaning |
|---|---|---|---|
| 0 | `0x0001` | Raw Mode | Read/Write Raw (obsolete) |
| 1 | `0x0002` | MPX Mode | Multiplexed connections |
| 2 | `0x0004` | Unicode | UTF-16LE string encoding |
| 3 | `0x0008` | Large Files | 64-bit file sizes |
| 4 | `0x0010` | NT SMBs | NT-style SMB commands |
| 5 | `0x0020` | RPC Remote APIs | MSRPC over named pipes |
| 6 | `0x0040` | NT Status Codes | 32-bit NTSTATUS instead of DOS errors |
| 7 | `0x0080` | Level II Oplocks | Opportunistic locking level 2 |
| 8 | `0x0100` | Lock and Read | Combined lock+read command |
| 9 | `0x0200` | NT Find | NT-style directory queries |
| 12 | `0x1000` | DFS | Distributed File System |
| 14 | `0x4000` | Large ReadX | SMB_COM_READ_ANDX > 64KB |
| 15 | `0x8000` | Large WriteX | SMB_COM_WRITE_ANDX > 64KB |
| 31 | `0x80000000` | Extended Security | SPNEGO/NTLMSSP (not LANMAN challenge/response) |

---

## Wire Protocol Flow

### Session establishment (`/api/netbios/connect`)

```
Client                          Server
  |                               |
  | TCP SYN                       |
  |------------------------------>|
  | SYN-ACK                       |
  |<------------------------------|
  | ACK                           |
  |------------------------------>|
  |                               |
  | Session Request (0x81)        |
  | [calledName + callingName]    |
  |------------------------------>|
  |                               |
  | Positive Response (0x82)      |
  | [0 bytes payload]             |
  |<------------------------------|  ← rtt measured here
  |                               |
  | FIN (close)                   |
  |------------------------------>|
```

### SMB1 negotiate (`/api/netbios/query`)

```
Client                          Server
  |                               |
  | Session Request (0x81)        |
  | [*SMBSERVER + PORTOFCALL]     |
  |------------------------------>|
  | Positive Response (0x82)      |
  |<------------------------------|
  |                               |
  | Session Message (0x00)        |
  | [SMB1 NEGOTIATE REQUEST]      |
  | Dialects: PC NETWORK...NT LM  |
  |------------------------------>|
  |                               |
  | Session Message (0x00)        |
  | [SMB1 NEGOTIATE RESPONSE]     |
  | DialectIndex, SecurityMode,   |
  | Capabilities, ServerTime,     |
  | ServerGUID, DomainName, etc.  |
  |<------------------------------|  ← rtt measured here
  |                               |
  | FIN (close)                   |
  |------------------------------>|
```

### Multi-suffix probe (`/api/netbios/probe`)

Each suffix opens a new TCP connection, sends Session Request, reads response, and closes. The 6 probes run sequentially (not in parallel). Total `rtt` is the sum of all connection times.

---

## Known Limitations

**No NetBIOS Name Service (UDP 137):** Port of Call does not implement NetBIOS-NS for name registration, query, or release. Only Session Service (TCP 139) is supported.

**No NetBIOS Datagram Service (UDP 138):** Datagram broadcast/multicast is not implemented.

**No SMB over TCP 445:** Modern Windows prefers direct SMB over TCP 445 (no NetBIOS layer). Port of Call only supports the legacy NetBIOS Session Service on port 139.

**No SMB2/SMB3:** Only SMB1 NEGOTIATE is implemented. SMB2/SMB3 use a different wire format and are not supported.

**Timeout applies to entire operation:** For `/api/netbios/connect`, the timeout covers TCP connect + Session Request + response read. For `/api/netbios/query`, it covers connect + Session Request + Session Response + SMB1 NEGOTIATE REQUEST + response. No separate sub-timeouts.

**Packet length capped at 131072 bytes:** The `readSessionPacket` function validates that the length field does not exceed 128KB. Legitimate NetBIOS Session Messages can be larger (e.g., SMB1 Read/Write operations), but Port of Call does not need to handle them since it only sends NEGOTIATE requests.

**Calling name is always PORTOFCALL with suffix 0x00:** The calling name (source NetBIOS name) is hardcoded. Some servers may reject connections from unknown callers, though this is rare.

**No scope ID:** NetBIOS names can have a scope ID (DNS-like suffix) for network segmentation. Port of Call always uses a null scope (0x00 terminator).

**No NBSTAT (Adapter Status):** RFC 1002 defines an Adapter Status query to list all NetBIOS names registered by a node. Port of Call does not implement this.

**Single-shot operations:** All three endpoints open a fresh connection, perform one operation, and close. No connection reuse or pipelining.

**Extended Security not negotiated:** Port of Call sets the Extended Security flag in the NEGOTIATE REQUEST flags, allowing the server to respond with a GUID and SPNEGO blob. However, Port of Call does not continue the authentication handshake (SESSION SETUP & X). The NEGOTIATE RESPONSE is parsed and returned as-is.

**Server time conversion edge cases:** Windows FILETIME (100ns ticks since 1601-01-01) is converted to Unix epoch milliseconds. Dates before 1970 or far in the future may overflow or produce invalid ISO 8601 strings. Port of Call wraps the conversion in a try/catch and returns `null` on error.

**Timezone sign convention:** SMB ServerTimeZone is "minutes from UTC" where positive = west of Greenwich (e.g., +300 = EST = UTC-5). Port of Call negates this value and formats it as `UTC-5`. The sign logic was corrected in the latest version (see Bugs Fixed).

**No session keepalive:** Session Keepalive (type 0x85) is not sent. Port of Call closes the connection immediately after reading the response.

**Retarget not followed:** If the server sends a Retarget Session Response (0x84), Port of Call returns the new IP/port in the JSON response but does not automatically retry the connection to the new target.

**Probe timeout is shared across all suffixes:** `/api/netbios/probe` has a global timeout (default 10000ms) and each individual probe has `min(3000, timeout)` as its timeout. If the global timeout expires mid-probe, the remaining probes are not attempted.

**No Cloudflare detection on `/api/netbios/probe`:** Only `/api/netbios/connect` and `/api/netbios/query` check if the target is behind Cloudflare. The probe endpoint skips this check.

---

## Bugs Fixed (2026-02-18)

### Critical (Resource Leaks)

**Timeout timers not cleared after Promise.race():**

All three endpoints (`handleNetBIOSConnect`, `handleNetBIOSNameQuery`, `handleNetBIOSProbe`) use `setTimeout` with `Promise.race()` to enforce timeouts. However, if the connection promise resolves/rejects first, the timeout timer continues running until it fires (even though its rejection is ignored), wasting Worker CPU cycles.

**Fix:** Capture the timeout ID in a variable, and call `clearTimeout(timeoutId)` in both the success and error paths after the race completes. Also added `clearTimeout` in the `readSessionPacket` function.

**Lines changed:** 160-212, 267-347, 692-820

---

**Incomplete packet reading in readSessionPacket:**

After reading the 4-byte header and extracting the length field, the function loops to read `4 + length` total bytes. However, if the connection closes mid-packet (EOF before all data arrives), the loop uses `break` instead of throwing an error. This causes the function to return a truncated packet, which then causes downstream parsing to fail silently or return garbage.

**Fix:** Changed `if (done || !value) break;` to `if (done || !value) throw new Error(...)` with a descriptive message including expected vs. actual byte count.

**Lines changed:** 188-194

---

**No validation of packet length field:**

The length field is a 16-bit big-endian integer (max 65535). A malicious or buggy server could send a crafted Session Message with length 65535, causing `readSessionPacket` to wait indefinitely for 64KB of data that never arrives (consuming the Worker's timeout budget).

**Fix:** Added a length cap of 131072 bytes (128KB). Since Port of Call only sends NEGOTIATE requests and reads small responses (typically <1KB), this limit is generous and prevents resource exhaustion.

**Lines changed:** 186-189

---

### Medium (Protocol Compliance)

**ServerTimezone display sign error:**

The SMB1 NEGOTIATE RESPONSE includes a ServerTimeZone field (2-byte signed integer, minutes from UTC). Positive values indicate west of Greenwich (e.g., +300 = EST = UTC-5). The original code formatted this as:

```typescript
`UTC${negResult.serverTimezone >= 0 ? '+' : ''}${-negResult.serverTimezone / 60}`
```

For a server reporting +300 (UTC-5), this produces: `UTC+-5` (wrong).

**Fix:** Changed to compute the negated value first, then apply the sign to the result:

```typescript
`UTC${-negResult.serverTimezone / 60 >= 0 ? '+' : ''}${-negResult.serverTimezone / 60}`
```

Now: +300 → -5 → `UTC-5` (correct), -300 → +5 → `UTC+5` (correct).

**Lines changed:** 787

---

**Unused decodeNetBIOSName function:**

The function `decodeNetBIOSName` (lines 95-114) was marked with `@ts-expect-error` to suppress the "unused variable" warning. This function is valid and may be useful for future features (e.g., parsing Retarget Response called/calling names, or NBSTAT Adapter Status responses).

**Fix:** Removed the `@ts-expect-error` comment and added a type assertion to mark the function as intentionally defined:

```typescript
decodeNetBIOSName satisfies (data: Uint8Array, offset: number) => { name: string; suffix: number };
```

This keeps the function in the codebase without triggering linter warnings.

**Lines changed:** 94-118

---

## curl Examples

```bash
# Basic session test (File Server suffix 0x20)
curl -s -X POST https://portofcall.ross.gg/api/netbios/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100"}' | jq .

# Test specific suffix (Workstation 0x00)
curl -s -X POST https://portofcall.ross.gg/api/netbios/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","calledSuffix":0}' | jq .

# SMB1 negotiate fingerprinting
curl -s -X POST https://portofcall.ross.gg/api/netbios/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100"}' | jq .

# Extract server name and domain
curl -s -X POST https://portofcall.ross.gg/api/netbios/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100"}' | jq '{serverName,domainName,serverTime}'

# Service discovery probe
curl -s -X POST https://portofcall.ross.gg/api/netbios/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100"}' | jq '.services[] | select(.available)'

# Check if Extended Security is supported
curl -s -X POST https://portofcall.ross.gg/api/netbios/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100"}' | jq '.capabilityFlags[] | select(. == "Extended Security")'

# Low timeout for quick scan
curl -s -X POST https://portofcall.ross.gg/api/netbios/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","timeout":3000}' | jq .servicesFound
```

---

## JavaScript Example

```js
// SMB1 fingerprinting
async function fingerprintSMB(host) {
  const res = await fetch('https://portofcall.ross.gg/api/netbios/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host }),
  });
  const data = await res.json();

  if (!data.success) {
    console.error(`Error: ${data.error}`);
    return;
  }

  if (!data.isSMB) {
    console.log(`${host} has NetBIOS Session Service but no SMB`);
    return;
  }

  console.log(`Server: ${data.serverName || 'unknown'}`);
  console.log(`Domain: ${data.domainName || 'unknown'}`);
  console.log(`Dialect: ${data.dialect}`);
  console.log(`Security: ${data.securityModeDescription}`);
  console.log(`Capabilities: ${data.capabilityFlags?.join(', ')}`);
  console.log(`Time: ${data.serverTime} (${data.serverTimezone})`);

  if (data.serverGuid) {
    console.log(`GUID: ${data.serverGuid}`);
  }
}

fingerprintSMB('192.168.1.100');
```

---

## Resources

- [RFC 1001: NetBIOS Service Protocols](https://datatracker.ietf.org/doc/html/rfc1001) — Name Service, Datagram Service
- [RFC 1002: NetBIOS Session Service](https://datatracker.ietf.org/doc/html/rfc1002) — Session packet formats, name encoding
- [Microsoft SMB Protocol](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-smb/f210069c-7086-4dc2-885e-861d837df688) — SMB1 NEGOTIATE specification
- [Samba Protocol Guide](https://www.samba.org/samba/docs/) — Open-source SMB server documentation
- [NetBIOS Suffix List](https://en.wikipedia.org/wiki/NetBIOS#NetBIOS_Suffixes) — Common NetBIOS resource types
