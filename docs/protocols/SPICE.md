# SPICE (Port 5900)

Simple Protocol for Independent Computing Environments — remote display protocol for KVM/QEMU virtual machines. Developed by Red Hat.

Implementation: `src/worker/spice.ts`

## Endpoints

| # | Method | Path | Purpose | Default timeout |
|---|--------|------|---------|-----------------|
| 1 | POST | `/api/spice/connect` | Full SPICE link exchange: handshake + auth negotiation + channel enumeration | 15 000 ms |
| 2 | POST | `/api/spice/channels` | **Alias** for `/connect` — calls `handleSPICEConnect(request)` directly | 15 000 ms |

Both endpoints enforce `POST`-only (405 on GET). `/channels` is literally `return handleSPICEConnect(request)` — it exists as a convenience alias but returns exactly the same response.

---

## `/api/spice/connect`

Performs the SPICE link exchange: sends a `SpiceLinkMess` for the MAIN channel, reads the `SpiceLinkReply`, sends an auth mechanism selection, reads the auth result, and attempts to parse the post-auth `SpiceMainInit` or `SpiceMsgMainChannelsList` data.

### Request

```json
{
  "host": "10.0.0.1",
  "port": 5900,
  "timeout": 15000,
  "password": "my-vm-password"
}
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `host` | Yes | — | Truthiness check only |
| `port` | No | `5900` | Validated 1–65535. Same default as VNC (collision risk) |
| `timeout` | No | `15000` | ms; outer `Promise.race` + per-read deadlines |
| `password` | No | — | Triggers SPICE password auth mechanism selection, but **password is never actually encrypted or sent** (see Quirks) |

### Wire exchange

```
Client                              Server
  |                                    |
  |─── SpiceLinkHeader + Mess ────────>|  Magic: "REDQ", v2.2, MAIN channel
  |    caps: auth-selection,           |  connection_id=0 (new)
  |    auth-spice, auth-sasl           |
  |                                    |
  |<── SpiceLinkReply ─────────────────|  Magic: "REQD"
  |    error, RSA pubkey (162 B),      |  capabilities, auth methods
  |    num_common/channel_caps         |
  |                                    |
  |─── Auth Mechanism (4 bytes LE) ───>|  0=SPICE, 0xFFFFFFFF=no-auth
  |                                    |
  |<── Auth Result (4 bytes LE) ───────|  0=OK
  |                                    |
  |<── SpiceMainInit / ChannelsList ───|  (if auth succeeded)
  |                                    |
```

### Success response

```json
{
  "success": true,
  "host": "10.0.0.1",
  "port": 5900,
  "protocolVersion": "2.2",
  "serverMajor": 2,
  "serverMinor": 2,
  "linkError": 0,
  "linkErrorName": "OK",
  "hasPubKey": true,
  "pubKeyPrefix": "3082009e300d0609...",
  "numCommonCaps": 1,
  "numChannelCaps": 0,
  "capabilities": ["auth-selection", "auth-spice", "auth-sasl"],
  "supportsAuthSelection": true,
  "supportsSpiceAuth": true,
  "supportsSASL": false,
  "authRequired": false,
  "authResult": 0,
  "authResultOk": true,
  "channels": [
    { "type": 1, "name": "main", "id": 0 },
    { "type": 2, "name": "display", "id": 0 },
    { "type": 3, "name": "inputs", "id": 0 },
    { "type": 4, "name": "cursor", "id": 0 },
    { "type": 5, "name": "playback", "id": 0 },
    { "type": 6, "name": "record", "id": 0 }
  ],
  "serverInfo": { "sessionId": 12345, "displayHints": 0 },
  "message": "SPICE server reachable. Auth: not required. Capabilities: auth-selection, auth-spice, auth-sasl"
}
```

### Failure response (link error)

If the server returns a non-zero error in SpiceLinkReply, the response is `success: false` with HTTP 200 (not 500):

```json
{
  "success": false,
  "host": "10.0.0.1",
  "port": 5900,
  "protocolVersion": "2.2",
  "linkError": 5,
  "linkErrorName": "NEED_SECURED",
  "hasPubKey": true,
  "capabilities": ["auth-selection", "auth-spice"],
  "message": "SPICE server returned error: NEED_SECURED"
}
```

### Failure response (parse error)

If the response can't be parsed as a SpiceLinkReply, returns HTTP 200 with raw bytes for debugging:

```json
{
  "success": false,
  "host": "10.0.0.1",
  "port": 5900,
  "error": "Invalid SPICE magic: expected 'REQD', got 'HTTP'",
  "rawBytesReceived": 256,
  "rawHex": "48 54 54 50 2f 31 2e 31 20 34 30 30 20 42 61 64 ..."
}
```

---

## SpiceLinkReply Error Codes

| Code | Name | Meaning |
|------|------|---------|
| 0 | OK | Link successful |
| 1 | ERROR | Generic error |
| 2 | INVALID_MAGIC | Client sent wrong magic bytes |
| 3 | INVALID_DATA | Malformed link message |
| 4 | VERSION_MISMATCH | Incompatible protocol version |
| 5 | NEED_SECURED | Server requires TLS (SPICE-over-TLS) |
| 6 | NEED_UNSECURED | Server requires plaintext (rare) |
| 7 | PERMISSION_DENIED | Auth/access denied |
| 8 | BAD_CA_CERT | TLS certificate issue |
| 9 | SERVER_BUSY | Server at capacity |

---

## Channel Types

Parsed from SpiceMsgMainChannelsList. Each entry is 2 bytes: type(1) + id(1).

| Type | Name | Purpose |
|------|------|---------|
| 1 | main | Control, synchronization, channel listing |
| 2 | display | Video frame updates (QXL/VGA) |
| 3 | inputs | Keyboard and mouse events |
| 4 | cursor | Cursor shape and position |
| 5 | playback | Audio: VM to client |
| 6 | record | Audio: client to VM |
| 7 | tunnel | Deprecated |
| 8 | smartcard | Smartcard device redirection |
| 9 | usbredir | USB device redirection |
| 10 | port | Virtual serial/parallel ports |
| 11 | webdav | Folder sharing via WebDAV |

Types not in this table are rendered as `unknown-N`.

---

## Common Capabilities

Parsed from SpiceLinkReply capability bitmask. Only the first 4 bits are decoded:

| Bit | Name | Meaning |
|-----|------|---------|
| 0 | `auth-selection` | Client can choose auth mechanism |
| 1 | `auth-spice` | Server supports SPICE password auth (RSA-encrypted) |
| 2 | `auth-sasl` | Server supports SASL auth |
| 3 | `mini-header` | Compressed 6-byte message headers (vs 18-byte full) |

Only common capabilities are decoded. Channel-specific capabilities are counted (`numChannelCaps`) but not parsed.

---

## Auth Mechanism Selection

After receiving SpiceLinkReply, the client sends a 4-byte LE auth mechanism:

| Condition | Mechanism sent | Value |
|-----------|---------------|-------|
| `supportsSpiceAuth && password` present | SPICE password | `0x00000000` |
| Otherwise | No auth | `0xFFFFFFFF` |

**Critical limitation:** Even when SPICE password auth (mechanism 0) is selected, the implementation **never encrypts or sends the actual password**. The server's RSA public key is extracted from SpiceLinkReply (162 bytes PKCS#8 DER) but not used. Password-protected SPICE servers will return auth failure.

---

## Quirks and Limitations

### Password auth is not implemented

The `password` field in the request body is accepted and triggers mechanism selection (SPICE=0 instead of no-auth=0xFFFFFFFF), but after sending the auth mechanism, the code immediately tries to read the auth result without encrypting and sending the password with the server's RSA public key. Connecting to a password-protected VM will fail.

### protocolVersion is the client's version, not the server's

`protocolVersion`, `serverMajor`, and `serverMinor` in the response are always `"2.2"`, `2`, `2` — these are the **client's** hardcoded version constants, not values parsed from the server's SpiceLinkReply header. The server's actual version is in the SpiceLinkReply header bytes but is not extracted.

### /channels is an alias, not a separate implementation

`handleSPICEChannels` delegates entirely to `handleSPICEConnect`. The channel enumeration depends on the server sending SpiceMainInit or SpiceMsgMainChannelsList after auth — if auth fails or times out, `channels` will be an empty array.

### Connection errors return HTTP 200

Connection failures (refused, timeout during `socket.opened`) return HTTP 200 with `success: false`, not HTTP 500 or 502. Only unexpected exceptions from the outer try/catch return 500.

### readAtLeast may return fewer bytes than requested

`readAtLeast` reads chunks in a loop with a per-read timeout via `Promise.race`. If the timer wins a race, the function returns whatever bytes it has so far — even if fewer than `needed`. This means the SpiceLinkReply parser may receive an incomplete response and throw a parse error, which is caught and returned as a diagnostic with `rawHex`.

### SpiceLinkReply caps_offset interpretation

The parser computes the capabilities data position as `capsHeaderOffset + capsOffset` where `capsHeaderOffset = 166` (= error + pubkey size) and `capsOffset` is the server's declared offset. If the server declares `caps_offset` as an absolute offset from the body start (per SPICE spec: 178 for data immediately following the fixed fields), the computed position would be 166 + 178 = 344 — past the end of data. In practice, servers that work with this code likely set `caps_offset = 12` (relative to the caps header at offset 166).

### No display or input session

This is a probe/enumerate tool only. After reading SpiceMainInit, the connection is closed. No framebuffer decoding, input injection, or actual remote display occurs.

### RSA public key truncated in response

The server's RSA public key (162 bytes) is included in the response as `pubKeyPrefix` — only the first 16 bytes as hex, followed by `"..."`. The full key is not exposed. If the key is all zeros (server has no key configured), `pubKeyPrefix` is omitted.

### Port 5900 default collides with VNC

SPICE and VNC both conventionally use port 5900. If a host runs VNC instead of SPICE, the SpiceLinkReply parse will fail with an invalid magic error (VNC sends `RFB ...` not `REQD`). The `rawHex` in the error response will show the VNC banner.

### Mini-header parsing

Post-auth data is parsed using the 6-byte mini-header format (type:2 + size:4, LE). If the server uses full 18-byte headers (when mini-header capability is not negotiated), the message type/size will be misread. The code does not check whether mini-header was mutually negotiated before assuming the mini format.

### SpiceMainInit limited parsing

Only `sessionId` (4 bytes) and `displayHints` (4 bytes) are extracted from SpiceMainInit (type 101). The full SpiceMainInit structure contains many more fields (supported_mouse_modes, current_mouse_mode, agent_connected, agent_tokens, multi_media_time, ram_hint) — these are not parsed.

---

## Packet Format Reference

### SpiceLinkHeader (16 bytes)

```
Offset  Size  Field         Value
0       4     Magic         "REDQ" (0x52 0x45 0x44 0x51) for client
                            "REQD" (0x52 0x45 0x51 0x44) for server
4       4     Major         uint32 LE (2)
8       4     Minor         uint32 LE (2)
12      4     Size          uint32 LE (length of SpiceLinkMess body)
```

### SpiceLinkMess body (22 bytes as built)

```
Offset  Size  Field            Value (as built)
0       4     connection_id    0 (new connection)
4       1     channel_type     1 (MAIN)
5       1     channel_id       0
6       4     num_common_caps  1
10      4     num_channel_caps 0
14      4     caps_offset      18
18      4     common_caps      0x00000007 (bits 0,1,2 = auth-selection + auth-spice + auth-sasl)
```

### SpiceLinkReply body

```
Offset  Size  Field
0       4     error             uint32 LE (0=OK)
4       162   pub_key           RSA PKCS#8 DER public key
166     4     num_common_caps   uint32 LE
170     4     num_channel_caps  uint32 LE
174     4     caps_offset       uint32 LE (offset from body start to caps data)
178+    var   capabilities      uint32 LE bitmasks
```

### SpiceLinkAuthMechanism (4 bytes)

```
Offset  Size  Field
0       4     mechanism  uint32 LE: 0=SPICE, 1=SASL, 0xFFFFFFFF=none
```

### SpiceLinkAuthResult (4 bytes)

```
Offset  Size  Field
0       4     result  uint32 LE: 0=OK
```

### Mini data header (6 bytes)

```
Offset  Size  Field
0       2     type  uint16 LE (101=MainInit, 102=ChannelsList)
2       4     size  uint32 LE
```

---

## Cloudflare Detection

Calls `checkIfCloudflare(host)` before connecting. Returns HTTP 403 with `isCloudflare: true` if the host resolves to a Cloudflare IP.

---

## Error Handling

| Condition | HTTP status | Response shape |
|-----------|-------------|----------------|
| Missing host | 400 | `{ success: false, error: "Missing required parameter: host" }` |
| Port out of range | 400 | `{ success: false, error: "Port must be between 1 and 65535" }` |
| Cloudflare host | 403 | `{ success: false, isCloudflare: true }` |
| Connection failed | 200 | `{ success: false, host, port, error: "..." }` |
| Parse failed | 200 | `{ success: false, error: "...", rawBytesReceived, rawHex }` |
| Link error (non-zero) | 200 | `{ success: false, linkError, linkErrorName, capabilities }` |
| Unexpected exception | 500 | `{ success: false, error: "..." }` |

Note: connection failures and protocol errors use HTTP 200, not 500. Only unhandled exceptions bubble to 500.

---

## curl Examples

### Basic probe (no auth)

```bash
curl -s http://localhost:8787/api/spice/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.1","port":5900}' | jq .
```

### With password (auth mechanism selected but password not sent)

```bash
curl -s http://localhost:8787/api/spice/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.1","port":5900,"password":"secret"}' | jq .
```

### Channel enumeration (alias for /connect)

```bash
curl -s http://localhost:8787/api/spice/channels \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.1","port":5900}' | jq .channels
```

---

## Local Testing

### QEMU with SPICE (no auth)

```bash
qemu-system-x86_64 \
  -spice port=5900,addr=0.0.0.0,disable-ticketing=on \
  -device qxl-vga \
  -m 1024 \
  -cdrom /path/to/iso
```

### QEMU with SPICE password

```bash
qemu-system-x86_64 \
  -spice port=5900,addr=0.0.0.0,password=secret \
  -device qxl-vga \
  -m 1024
```

Note: password-protected VMs won't complete auth with this tool (see Quirks).

### virt-viewer verification

```bash
# Verify SPICE works with a real client first
remote-viewer spice://localhost:5900
```
