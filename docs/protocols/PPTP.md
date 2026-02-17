# PPTP — Power User Reference

## Overview

**PPTP** (Point-to-Point Tunneling Protocol) is a legacy Microsoft-originated VPN protocol
(RFC 2637) that operates over TCP port 1723 for its control channel, with GRE protocol 47 carrying
the actual data tunnel. Port of Call probes the **control channel only** — it never establishes a
GRE data tunnel.

**Port:** 1723 (TCP control channel only)  
**Transport:** Raw TCP (Cloudflare Workers `cloudflare:sockets connect()`)  
**Cloudflare detection:** Yes — 403 with `isCloudflare: true` before any TCP attempt

---

## Transport

All three endpoints open a raw TCP socket to `host:port`, perform a binary handshake, then close
the connection. There is no TLS, no HTTP, and no GRE — Port of Call exercises the PPTP control
channel exclusively.

### PPTP Control Message Frame

Every PPTP control message begins with a 12-byte header:

```
Offset  Size  Field
------  ----  -----
0       2     Length (total message length in bytes, big-endian)
2       2     PPTP Message Type (always 1 = Control Message)
4       4     Magic Cookie (always 0x1A2B3C4D, big-endian)
8       2     Control Message Type (see table below)
10      2     Reserved (0x0000)
12      …     Message-specific body
```

### Control Message Types

| Value | Name                            | Direction |
|-------|---------------------------------|-----------|
| 1     | Start-Control-Connection-Request (SCCRQ) | Client → Server |
| 2     | Start-Control-Connection-Reply (SCCRP)   | Server → Client |
| 3     | Stop-Control-Connection-Request          | Either |
| 4     | Stop-Control-Connection-Reply            | Either |
| 5     | Echo-Request                             | Client → Server |
| 6     | Echo-Reply                               | Server → Client |
| 7     | Outgoing-Call-Request (OCRQ)             | Client → Server |
| 8     | Outgoing-Call-Reply (OCRP)               | Server → Client |
| 9     | Incoming-Call-Request                    | Server → Client |
| 10    | Incoming-Call-Reply                      | Client → Server |
| 11    | Incoming-Call-Connected                  | Client → Server |
| 12    | Call-Clear-Request                       | Client → Server |
| 13    | Call-Disconnect-Notify                   | Either |
| 14    | WAN-Error-Notify                         | Server → Client |
| 15    | Set-Link-Info                            | Either |

Port of Call only sends types 1 (SCCRQ) and 7 (OCRQ); it parses types 2 (SCCRP) and 8 (OCRP).

---

## Endpoints

### POST /api/pptp/connect

SCCRQ → SCCRP handshake. Discovers server version, vendor, framing/bearer capabilities, and
firmware revision. This is the primary fingerprinting endpoint.

**Request**
```json
{
  "host":    "vpn.example.com",
  "port":    1723,
  "timeout": 10000
}
```

| Field     | Type    | Default | Description                        |
|-----------|---------|---------|------------------------------------|
| `host`    | string  | —       | **Required.** PPTP server hostname or IP |
| `port`    | integer | 1723    | TCP port of the control channel    |
| `timeout` | integer | 10000   | Connection + read timeout in ms    |

**Response — success**
```json
{
  "success": true,
  "host": "vpn.example.com",
  "port": 1723,
  "connectTime": 42,
  "rtt": 98,
  "protocolVersion": "1.0",
  "resultCode": 1,
  "resultCodeName": "Successful channel establishment",
  "errorCode": 0,
  "framingCapabilities": ["Asynchronous framing", "Synchronous framing"],
  "bearerCapabilities": ["Analog access", "Digital access"],
  "maxChannels": 100,
  "firmwareRevision": "1.0",
  "hostname": "vpnserver01.example.com",
  "vendor": "Microsoft"
}
```

| Field                 | Type     | Description                                              |
|-----------------------|----------|----------------------------------------------------------|
| `connectTime`         | integer  | ms until TCP socket opened                               |
| `rtt`                 | integer  | ms from send-SCCRQ to receive-SCCRP                      |
| `protocolVersion`     | string   | `"major.minor"` from SCCRP (e.g. `"1.0"`)               |
| `resultCode`          | integer  | SCCRP result code (1 = success; see table below)         |
| `resultCodeName`      | string   | Human-readable result code name                          |
| `errorCode`           | integer  | General error code (0 = none)                            |
| `framingCapabilities` | string[] | Framing types the server supports                        |
| `bearerCapabilities`  | string[] | Bearer types the server supports                         |
| `maxChannels`         | integer  | Maximum simultaneous calls supported (0 = unspecified)   |
| `firmwareRevision`    | string   | `"major.minor"` firmware version string                  |
| `hostname`            | string   | NUL-terminated ASCII hostname from SCCRP (up to 63 chars) |
| `vendor`              | string   | NUL-terminated ASCII vendor string from SCCRP (up to 63 chars) |

**Response — error (500)**
```json
{
  "success": false,
  "error": "Connection timeout"
}
```

---

### POST /api/pptp/start-control

Identical SCCRQ → SCCRP exchange to `/connect`, but with a different response schema. Exposes
`resultCode === 1` semantics directly in `success`, making it easier to distinguish tunnel
acceptance from connection success.

**Request** — same schema as `/connect`

**Response — success**
```json
{
  "success": true,
  "resultCode": 1,
  "resultText": "Successful channel establishment",
  "errorCode": 0,
  "protocolVersion": "1.0",
  "maxChannels": 100,
  "hostName": "vpnserver01.example.com",
  "vendorName": "Microsoft",
  "latencyMs": 98
}
```

**Key difference from `/connect`:**

| `/connect`            | `/start-control`   | Notes                                      |
|-----------------------|--------------------|--------------------------------------------|
| `success` = TCP OK    | `success` = `resultCode === 1` | `/start-control` fails if server rejects the request |
| `hostname`            | `hostName`         | camelCase difference                       |
| `vendor`              | `vendorName`       |                                            |
| `connectTime` + `rtt` | `latencyMs`        | different timing fields                    |
| `resultCodeName`      | `resultText`       |                                            |

Use `/start-control` when you need `success: false` to signal server rejection (result code ≠ 1).
Use `/connect` when you want to parse capabilities from any server that responds, even if it rejects.

---

### POST /api/pptp/call-setup

Full PPTP call establishment: SCCRQ → SCCRP (control tunnel), then OCRQ → OCRP (outgoing call).
This is the deepest probe — it attempts to open an actual call slot on the server.

**Request** — same schema as `/connect`

**Protocol flow:**
```
Client                          Server
  |  ---SCCRQ (156 bytes)-->       |   Start-Control-Connection-Request
  |  <--SCCRP (156 bytes)---       |   Start-Control-Connection-Reply
  |  ---OCRQ  (168 bytes)-->       |   Outgoing-Call-Request
  |  <--OCRP  ( 32 bytes)---       |   Outgoing-Call-Reply
```

**Response — success**
```json
{
  "success": true,
  "tunnelEstablished": true,
  "serverHostname": "vpnserver01.example.com",
  "serverVendor": "Microsoft",
  "protocolVersion": "1.0",
  "maxChannels": 100,
  "localCallId": 42317,
  "peerCallId": 1,
  "callResult": 1,
  "callResultText": "Connected",
  "callErrorCode": 0,
  "connectSpeed": 10000000,
  "latencyMs": 145
}
```

**Response — tunnel up but call rejected**
```json
{
  "success": false,
  "tunnelEstablished": true,
  "callResult": 4,
  "callResultText": "Busy",
  "callErrorCode": 0,
  "connectSpeed": 0,
  "latencyMs": 120,
  "note": "OCRP rejected call — server may require PPP authentication before allowing outgoing calls"
}
```

| Field               | Type    | Description                                              |
|---------------------|---------|----------------------------------------------------------|
| `success`           | boolean | `tunnelEstablished && callResult === 1`                  |
| `tunnelEstablished` | boolean | SCCRP result code was 1                                  |
| `serverHostname`    | string  | Hostname from SCCRP                                      |
| `serverVendor`      | string  | Vendor from SCCRP                                        |
| `localCallId`       | integer | Random call ID chosen by the client (1–65534)            |
| `peerCallId`        | integer | Server-assigned call ID from OCRP                        |
| `callResult`        | integer | OCRP result code (see table below)                       |
| `callResultText`    | string  | Human-readable OCRP result                               |
| `callErrorCode`     | integer | OCRP error code (non-zero on General Error)              |
| `connectSpeed`      | integer | Reported connect speed in bps from OCRP                  |
| `note`              | string? | Present when `callResult !== 1`                          |

---

## SCCRP Result Codes

Returned in `resultCode` / `resultText` by `/connect` and `/start-control`, and implicit in
`tunnelEstablished` by `/call-setup`.

| Code | Name                              | Meaning                                       |
|------|-----------------------------------|-----------------------------------------------|
| 1    | Successful channel establishment  | Server accepted the control connection         |
| 2    | General error                     | See `errorCode` for detail                     |
| 3    | Command channel already exists    | Duplicate connection from same IP             |
| 4    | Requester is not authorized       | ACL or IP restriction                         |
| 5    | Protocol version not supported    | Server requires a different PPTP version      |

---

## OCRP Result Codes

Returned in `callResult` / `callResultText` by `/call-setup`.

| Code | Name           | Typical cause                                      |
|------|----------------|----------------------------------------------------|
| 1    | Connected       | Call established successfully                      |
| 2    | General error   | Server-side error; see `callErrorCode`             |
| 3    | No carrier      | Modem pool exhausted or unavailable                |
| 4    | Busy            | All call slots in use                              |
| 5    | No dial tone    | Server not ready to accept calls                   |
| 6    | Time out        | Dial or negotiation timeout                        |
| 7    | Do not accept   | Server policy refuses outgoing calls from client   |

---

## Wire Format Details

### SCCRQ (Client → Server, 156 bytes)

```
Offset  Size  Value        Field
------  ----  -----        -----
0       2     0x009C       Length (156)
2       2     0x0001       PPTP Message Type (Control)
4       4     0x1A2B3C4D   Magic Cookie
8       2     0x0001       Control Type (SCCRQ = 1)
10      2     0x0000       Reserved0
--- body ---
12      2     0x0100       Protocol Version (1.0, big-endian: major=1 minor=0)
14      2     0x0000       Reserved1
16      4     0x00000003   Framing Capabilities (async | sync)
20      4     0x00000003   Bearer Capabilities (analog | digital)
24      2     0x0000       Maximum Channels (client doesn't specify)
26      2     0x0000       Firmware Revision
28      64    ASCII        Hostname ("PortOfCall-Probe\0…")
92      64    ASCII        Vendor Name ("PortOfCall\0…")
```

### SCCRP (Server → Client, 156 bytes)

Same frame structure. Body differences from SCCRQ:

```
Offset  Size  Field
------  ----  -----
12      2     Protocol Version (server's version)
14      1     Result Code (1 = success; SCCRQ has 2-byte reserved here instead)
15      1     Error Code
16      4     Framing Capabilities
20      4     Bearer Capabilities
24      2     Maximum Channels
26      2     Firmware Revision
28      64    Server Hostname (NUL-padded)
92      64    Server Vendor (NUL-padded)
```

### OCRQ (Client → Server, 168 bytes)

```
Offset  Size  Value        Field
------  ----  -----        -----
0       2     0x00A8       Length (168)
2       2     0x0001       PPTP Message Type
4       4     0x1A2B3C4D   Magic Cookie
8       2     0x0007       Control Type (OCRQ = 7)
10      2     0x0000       Reserved
--- body ---
12      2     callId       Call ID (random 1–65534)
14      2     0x0001       Call Serial Number
16      4     0x0000012C   Minimum BPS (300)
20      4     0x05F5E100   Maximum BPS (100,000,000)
24      4     0x00000001   Bearer Type (analog)
28      4     0x00000001   Framing Type (async)
32      2     0x0040       Receive Window Size (64)
34      2     0x0000       Processing Delay
36      2     0x0000       Phone Number Length (0 = no number)
38      2     0x0000       Reserved
40      64    0x00…        Phone Number (empty)
104     64    0x00…        Subaddress (empty)
```

### OCRP (Server → Client, 32 bytes)

```
Offset  Size  Field
------  ----  -----
0       2     Length (32)
2       2     PPTP Message Type (1)
4       4     Magic Cookie (0x1A2B3C4D)
8       2     Control Type (OCRP = 8)
10      2     Reserved
--- body (20 bytes) ---
12      2     Peer Call ID
14      1     Reserved
15      1     Result Code (1 = Connected)
16      1     Error Code
17      2     Cause Code
19      4     Connect Speed (bps)
23      2     Receive Window Size
25      2     Processing Delay
27      4     Physical Channel ID
```

---

## Framing & Bearer Capability Flags

### Framing Capabilities (bits)

| Bit  | Mask       | Meaning               |
|------|------------|-----------------------|
| 0    | 0x00000001 | Asynchronous framing  |
| 1    | 0x00000002 | Synchronous framing   |

### Bearer Capabilities (bits)

| Bit  | Mask       | Meaning         |
|------|------------|-----------------|
| 0    | 0x00000001 | Analog access   |
| 1    | 0x00000002 | Digital access  |

A value of `0x00000003` means the server supports both types. A value of `0x00000000` is reported
as `["None"]`.

---

## curl Examples

### Probe server capabilities
```bash
curl -s -X POST https://portofcall.ross.gg/api/pptp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"vpn.example.com","timeout":5000}' | jq .
```

### Check detailed result code
```bash
curl -s -X POST https://portofcall.ross.gg/api/pptp/start-control \
  -H 'Content-Type: application/json' \
  -d '{"host":"vpn.example.com","port":1723,"timeout":8000}' \
  | jq '{success, resultCode, resultText, vendorName, protocolVersion}'
```

### Full call setup (deepest probe)
```bash
curl -s -X POST https://portofcall.ross.gg/api/pptp/call-setup \
  -H 'Content-Type: application/json' \
  -d '{"host":"vpn.example.com","timeout":10000}' \
  | jq '{success, tunnelEstablished, callResultText, connectSpeed, serverVendor}'
```

### Non-standard port
```bash
curl -s -X POST https://portofcall.ross.gg/api/pptp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"vpn.example.com","port":1724}' | jq .
```

---

## Power User Notes

### Choosing an endpoint

| Goal                                        | Endpoint           |
|---------------------------------------------|--------------------|
| Server discovery / fingerprinting           | `/connect`         |
| Check if server will accept a tunnel        | `/start-control`   |
| Enumerate call capacity / speed reporting   | `/call-setup`      |

### Vendor fingerprinting

The `vendor` / `vendorName` / `serverVendor` field is a free-form ASCII string populated by the
server. Common values observed in the wild:

| Vendor string              | Product                                  |
|----------------------------|------------------------------------------|
| `Microsoft`                | Windows Server RRAS (Routing and Remote Access) |
| `MikroTik`                 | RouterOS PPTP server                     |
| `Cisco Systems`            | Cisco IOS / router PPTP                  |
| `Fortinet`                 | FortiGate SSL-VPN (PPTP compatibility)   |
| `linux`                    | pptpd (Linux)                            |
| `` (empty)                 | Many embedded/minimalist implementations |

### Protocol version

PPTP only ever standardised version `1.0`. A server returning any other value is non-standard.
The raw wire encoding is big-endian: `0x0100` = major 1, minor 0.

### `maxChannels` interpretation

- `0` — The server did not specify a limit (treat as unconstrained)
- Any positive value — Maximum simultaneous PPTP sessions; useful for capacity estimation

### OCRP `callResult !== 1` is not always a failure

Most production PPTP servers that don't actually serve modems return result code 7 (`Do not accept`)
or 3 (`No carrier`) for OCRQ, even when the control tunnel (`tunnelEstablished: true`) succeeded.
The `/call-setup` endpoint returns `success: false` in this case, but the tunnel probe was still
successful. Check `tunnelEstablished` independently.

### Cloudflare detection

All three endpoints check whether the target IP resolves to Cloudflare's ASN before opening any
TCP connection. If detected, the response is:

```json
{
  "success": false,
  "error": "…is behind Cloudflare…",
  "isCloudflare": true
}
```
HTTP status 403.

### Security context

PPTP's MS-CHAPv2 PPP authentication (used in the data plane) is cryptographically broken and
trivially cracked offline. Port of Call never negotiates PPP or MS-CHAPv2 — it only probes the
control channel. The control channel itself is unauthenticated plaintext, making server
identification straightforward.

### What Port of Call does NOT implement

- GRE data tunnel (protocol 47) — would require kernel-level socket access
- PPP negotiation (LCP/IPCP/MS-CHAPv2) — operates inside the GRE tunnel
- Echo-Request / Echo-Reply (keep-alive, message types 5/6)
- Incoming call handling (types 9–11)
- Call-Clear-Request / Call-Disconnect-Notify (types 12–13)
- Set-Link-Info / WAN-Error-Notify (types 14–15)

---

## Resources

- [RFC 2637 — Point-to-Point Tunneling Protocol (PPTP)](https://www.rfc-editor.org/rfc/rfc2637)
- [Microsoft MS-PTPT Open Specification](https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-ptpt)
