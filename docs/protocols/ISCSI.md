# iSCSI — Internet Small Computer System Interface (port 3260)

Implementation: `src/worker/iscsi.ts` (988 lines)
Routes: `src/worker/index.ts` lines 1652–1658
Tests: `tests/iscsi.test.ts` (validation only — `/discover` endpoint, no live-target tests)

Two endpoints: `/discover` (no-auth discovery) and `/login` (CHAP-capable login + optional discovery). Both perform the iSCSI Login phase over raw TCP via `cloudflare:sockets`, followed by a SendTargets Text Request. The `/login` endpoint additionally supports CHAP authentication with a pure-JS MD5 implementation.

---

## Endpoints

### POST /api/iscsi/discover

No-auth discovery session: Login (AuthMethod=None) + SendTargets=All.

**Request:**

```json
{
  "host": "nas.example.com",
  "port": 3260,
  "timeout": 10000,
  "initiatorName": "iqn.2024-01.com.example:my-initiator"
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | *required* | Truthiness check only (no regex, no port validation). |
| `port` | `3260` | No range validation. |
| `timeout` | `10000` | ms. Wraps the entire operation. |
| `initiatorName` | `"iqn.2024-01.gg.ross.portofcall:initiator"` | Sent in the Login Request's `InitiatorName` key. |

**Success response (200):**

```json
{
  "success": true,
  "host": "nas.example.com",
  "port": 3260,
  "rtt": 42,
  "isISCSI": true,
  "loginStatus": "Success — Login successful",
  "versionMax": 0,
  "versionActive": 0,
  "tsih": 1,
  "negotiatedParams": {
    "HeaderDigest": "None",
    "DataDigest": "None",
    "MaxRecvDataSegmentLength": "262144",
    "TargetPortalGroupTag": "1"
  },
  "targets": [
    {
      "name": "iqn.2024-01.com.example:storage.disk1",
      "addresses": ["192.168.1.100:3260,1", "192.168.2.100:3260,2"]
    }
  ],
  "targetCount": 1,
  "rawKvPairs": {
    "TargetName": "iqn.2024-01.com.example:storage.disk1",
    "TargetAddress": "192.168.2.100:3260,2"
  }
}
```

| Field | Notes |
|-------|-------|
| `isISCSI` | `true` if the server responded with opcode 0x23 (Login Response). Only on `/discover`. |
| `loginStatus` | Human-readable status string (class + detail). Only on `/discover`. |
| `versionMax` / `versionActive` | iSCSI protocol version. 0 = RFC 7143. Only on `/discover`. |
| `tsih` | Target Session Identifying Handle (assigned by target). |
| `negotiatedParams` | Key-value pairs from the Login Response data segment. |
| `targets` | Structured array of discovered targets with addresses. |
| `targetCount` | Convenience field — `targets.length`. |
| `rawKvPairs` | Raw key-value pairs from the Text Response. **Bug: only preserves the last value per key** — if multiple targets exist, only the last `TargetName` and last `TargetAddress` are kept. Use `targets` instead. |

**Login failure response (502):**

```json
{
  "success": false,
  "host": "...",
  "port": 3260,
  "rtt": 42,
  "isISCSI": true,
  "loginStatus": "Initiator Error — Authentication failure",
  "loginStatusClass": 2,
  "loginStatusDetail": 1,
  "negotiatedParams": { "AuthMethod": "CHAP" },
  "error": "Login failed: Initiator Error — Authentication failure"
}
```

Non-iSCSI service response (502): `{ "isISCSI": false, "error": "Not an iSCSI target: unexpected opcode 0x..." }`

**HTTP status codes:**
- 200: success
- 400: missing host
- 403: Cloudflare-proxied host
- 502: login failure, incomplete response, or non-iSCSI service
- 504: timeout
- 500: unexpected error

---

### POST /api/iscsi/login

CHAP-capable login + optional SendTargets discovery. Superset of `/discover` with authentication support.

**Request:**

```json
{
  "host": "nas.example.com",
  "port": 3260,
  "timeout": 10000,
  "initiatorName": "iqn.2024-01.com.example:my-initiator",
  "targetName": "iqn.2024-01.com.example:storage.disk1",
  "username": "initiator_user",
  "password": "secret"
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | *required* | |
| `port` | `3260` | No range validation. |
| `timeout` | `10000` | ms. |
| `initiatorName` | `"iqn.2024-01.gg.ross.portofcall:initiator"` | |
| `targetName` | omit | Presence triggers SendTargets after login. **Does not filter** — always sends `SendTargets=All`. Acts as a boolean flag. |
| `username` | omit | Triggers CHAP authentication if both username and password are set. |
| `password` | omit | Required with `username`. |

**Success response (200):**

```json
{
  "success": true,
  "host": "nas.example.com",
  "port": 3260,
  "rtt": 185,
  "authenticated": true,
  "sessionId": "00023d000001",
  "tsih": 1,
  "chap": true,
  "targets": [
    { "name": "iqn.2024-01.com.example:storage.disk1", "addresses": ["192.168.1.100:3260,1"] }
  ],
  "negotiatedParams": { "HeaderDigest": "None", "DataDigest": "None" }
}
```

| Field | Notes |
|-------|-------|
| `authenticated` | `true` on successful login (with or without CHAP). |
| `sessionId` | Hex string of the 6-byte ISID from the Login Response (bytes 8–13). Always `"00023d000001"` because the ISID is hardcoded. |
| `chap` | `true` if CHAP was used, `false` for no-auth. |
| `targets` | Present only if `targetName` was set or the login response had T=1 (transit). |

**Failure response (502):** `{ "success": false, "authenticated": false, "chap": true, "error": "Login failed: ..." }`

**Response shape differences from `/discover`:**

| Field | `/discover` | `/login` |
|-------|-------------|----------|
| `isISCSI` | yes | no |
| `loginStatus` (string) | yes | no |
| `loginStatusClass` / `loginStatusDetail` | yes (on failure) | no |
| `versionMax` / `versionActive` | yes | no |
| `targetCount` | yes | no |
| `rawKvPairs` | yes | no |
| `sessionId` | no | yes |
| `chap` | no | yes |
| `authenticated` | no | yes |

---

## Wire Exchange — /discover

```
Client                                    Target
  │                                          │
  │─── Login Request (opcode 0x43) ─────────→│  CSG=1(LoginOp), NSG=3(FullFeature), T=1
  │    InitiatorName=iqn.xxx                 │  AuthMethod=None
  │    SessionType=Discovery                 │  HeaderDigest=None, DataDigest=None
  │    MaxRecvDataSegmentLength=65536        │
  │                                          │
  │←── Login Response (opcode 0x23) ────────│  statusClass=0, T=1
  │    negotiated params                     │
  │                                          │
  │─── Text Request (opcode 0x44) ──────────→│  SendTargets=All
  │                                          │
  │←── Text Response (opcode 0x24) ─────────│  TargetName=iqn.xxx
  │    TargetAddress=ip:port,tpgt            │
  │                                          │
  │─── [socket close, no Logout] ───────────→│
```

## Wire Exchange — /login with CHAP

```
Client                                    Target
  │                                          │
  │─── Login Request (opcode 0x43) ─────────→│  CSG=0(SecurityNeg), NSG=1(LoginOp), T=0
  │    InitiatorName=iqn.xxx                 │  AuthMethod=CHAP,None
  │    SessionType=Discovery                 │
  │                                          │
  │←── Login Response ──────────────────────│  AuthMethod=CHAP
  │    CHAP_A=5 (MD5)                        │  CHAP_I=<id>
  │    CHAP_C=0x<challenge>                  │
  │                                          │
  │─── Login Request ───────────────────────→│  CSG=0, NSG=1, T=1
  │    CHAP_N=<username>                     │  CHAP_R=0x<MD5(id|pass|challenge)>
  │                                          │
  │←── Login Response ──────────────────────│  statusClass=0 (auth success)
  │                                          │
  │─── Login Request ───────────────────────→│  CSG=1(LoginOp), NSG=3(FullFeature), T=1
  │    (empty body — transition to FFP)      │  [only if not already in FFP]
  │                                          │
  │←── Login Response ──────────────────────│  statusClass=0 (FFP reached)
  │                                          │
  │─── Text Request ────────────────────────→│  SendTargets=All
  │←── Text Response ───────────────────────│  target list
  │                                          │
  │─── [socket close, no Logout] ───────────→│
```

---

## CHAP Authentication Details

CHAP (Challenge-Handshake Authentication Protocol, algorithm 5 = MD5) is the only supported auth method.

**CHAP response computation:**

```
CHAP_R = MD5(CHAP_I_byte || password_bytes || CHAP_C_decoded)
```

1. `CHAP_I` — identifier byte, received as decimal string (e.g., `"42"`), parsed with `parseInt(id, 10) & 0xFF`
2. `password` — UTF-8 encoded via `TextEncoder`
3. `CHAP_C` — challenge bytes, received as hex string with `0x` prefix (e.g., `"0x1a2b3c..."`). The `0x` prefix is stripped and remaining hex is parsed in pairs.
4. Result is hex-encoded with `0x` prefix: `CHAP_R = "0x" + hex(md5_digest)`

**MD5 implementation:** Pure JavaScript RFC 1321 (`md5Bytes` function, ~55 lines). Uses `Uint8Array` and `DataView` — no Node.js `Buffer` or WebCrypto dependency.

**Limitations:**
- **MD5 only** — if the target offers `CHAP_A` != `"5"`, the request fails with an explicit error.
- **No mutual CHAP** — only one-way authentication (target authenticates initiator). The target's identity is not verified.
- **Hex-only challenge** — assumes `CHAP_C` is hex-encoded with optional `0x` prefix. Base64-encoded challenges would produce wrong results.

---

## Login PDU Format

48-byte Basic Header Segment (BHS):

| Offset | Size | Field | Value in implementation |
|--------|------|-------|------------------------|
| 0 | 1 | Opcode | `0x43` (Immediate + Login Request) |
| 1 | 1 | Flags | T, C, CSG, NSG — varies per stage |
| 2 | 1 | Version-max | `0x00` |
| 3 | 1 | Version-min | `0x00` |
| 4 | 1 | TotalAHSLength | `0x00` |
| 5–7 | 3 | DataSegmentLength | actual data length (big-endian) |
| 8–13 | 6 | ISID | `00 02 3d 00 00 01` (hardcoded) |
| 14–15 | 2 | TSIH | `0x0000` (new session) |
| 16–19 | 4 | Initiator Task Tag | `0x00000001` (hardcoded) |
| 20–21 | 2 | CID | `0x0000` |
| 24–27 | 4 | CmdSN | incremented manually per PDU |
| 28–31 | 4 | ExpStatSN | `0x00000000` (hardcoded — **see bug below**) |
| 32–47 | 16 | Reserved | zeros |

Data segment: null-terminated key=value pairs, padded to 4-byte boundary.

---

## Known Limitations and Bugs

### ExpStatSN always 0 in Login Requests (RFC violation)

`buildLoginRequestAuth` hardcodes `ExpStatSN = 0x00000000` for all login PDUs. Per RFC 7143 section 11.12.3, only the **first** Login Request in a phase may use ExpStatSN=0. Subsequent login requests (CHAP response, LoginOperational transition) must echo the `StatSN` from the most recent Login Response. Most targets tolerate this, but strictly conforming implementations may reject the login.

### ISID is hardcoded

All connections use ISID `00 02 3d 00 00 01`. Per RFC 7143 section 10.12.5, the ISID should uniquely identify the initiator node. With a fixed ISID, multiple concurrent discovery sessions from the same Worker isolate to the same target could collide (same ISID + TSIH=0 = same session).

### No Logout PDU

Neither endpoint sends an iSCSI Logout (opcode 0x06) before closing the TCP socket. The connection is terminated abruptly via `socket.close()`. Some targets may log connection-reset errors or hold session state until an internal timeout expires.

### Two different PDU reading strategies

`/discover` uses manual `while` loop byte accumulation (reads until it has the BHS, then parses DataSegmentLength, then reads until it has the full PDU). `/login` uses the dedicated `readISCSIPDU()` helper function which does the same thing more cleanly. Both have the same excess-byte-discard behavior: if `reader.read()` returns bytes spanning two PDUs, the extra bytes from the second PDU are silently lost.

### Single Text Response PDU

Both endpoints read exactly one Text Response PDU after SendTargets. If the target responds with continuation text responses (F=0 in flags, Target Transfer Tag != 0xFFFFFFFF), the additional PDUs are never read. Targets with many LUNs (hundreds) may split the response.

### `rawKvPairs` overwrites duplicate keys

The `/discover` response includes `rawKvPairs` as a `Record<string, string>`. With multiple targets, each `TargetName=` and `TargetAddress=` key overwrites the previous. Only the last target's data appears. The structured `targets` array handles this correctly — always use `targets` instead.

### `targetName` parameter is misleading

In `/login`, the `targetName` field does not filter or specify a target. It acts as a boolean flag — when truthy, SendTargets is sent after login. The Text Request always sends `SendTargets=All` regardless of the value. There is no way to query a specific target by name.

### No port validation

Neither endpoint validates the port range (1–65535). Invalid ports fail at the TCP level.

### No Reject PDU handling

If the target sends a Reject PDU (opcode 0x3f), `/discover` returns `"Not an iSCSI target"` (incorrect — the target IS iSCSI, it just rejected the request). `/login` via `readISCSIPDU` would read the PDU successfully but `parseLoginResponse` would misinterpret the Reject fields.

### Initiator Task Tag never changes

All Login Request PDUs use tag `0x00000001`. Text Requests use `0x00000002`. Per-PDU tags aren't tracked; this works for sequential request-response but would break if the implementation ever pipelined.

### No SCSI commands

This is a Login/Discovery-only implementation. No SCSI Command PDUs (opcode 0x01), no Read/Write/Inquiry/ReportLUNs. You cannot access block storage through these endpoints.

### No Normal sessions

Both endpoints only create Discovery sessions (`SessionType=Discovery`). Normal sessions (required for SCSI commands) are not implemented.

---

## Login Status Reference

| Class | Detail | Description |
|-------|--------|-------------|
| 0 | 0 | Login successful |
| 1 | 1 | Target moved temporarily |
| 1 | 2 | Target moved permanently |
| 2 | 0 | Initiator error (miscellaneous) |
| 2 | 1 | Authentication failure |
| 2 | 2 | Authorization failure |
| 2 | 3 | Target not found |
| 2 | 4 | Target removed |
| 2 | 5 | Unsupported version |
| 2 | 6 | Too many connections |
| 2 | 7 | Missing parameter |
| 2 | 8 | Cannot include in session |
| 2 | 9 | Session type not supported |
| 2 | 10 | Session does not exist |
| 2 | 11 | Invalid during login |
| 3 | 0 | Target error (miscellaneous) |
| 3 | 1 | Service unavailable |
| 3 | 2 | Out of resources |

---

## Quick Reference

| Endpoint | CHAP | SendTargets | Unique response fields | Timeout |
|----------|------|-------------|----------------------|---------|
| `/api/iscsi/discover` | No | Always | `isISCSI`, `loginStatus`, `versionMax/Active`, `targetCount`, `rawKvPairs` | 10s |
| `/api/iscsi/login` | Yes (username+password) | If `targetName` set or T=1 | `authenticated`, `sessionId`, `chap` | 10s |

## PDU Opcodes Used

| Opcode | Direction | Name | Used in |
|--------|-----------|------|---------|
| `0x43` | I→T | Login Request (Immediate) | Both endpoints |
| `0x23` | T→I | Login Response | Both endpoints |
| `0x44` | I→T | Text Request (Immediate) | Both endpoints (SendTargets) |
| `0x24` | T→I | Text Response | Both endpoints |

---

## curl Examples

```bash
# Discover targets (no auth)
curl -s -X POST https://portofcall.ross.gg/api/iscsi/discover \
  -H 'Content-Type: application/json' \
  -d '{"host":"nas.example.com"}' | jq

# Discover with custom initiator name
curl -s -X POST https://portofcall.ross.gg/api/iscsi/discover \
  -H 'Content-Type: application/json' \
  -d '{"host":"nas.example.com","initiatorName":"iqn.2024-01.com.myorg:server01"}' | jq

# Login with CHAP + target discovery
curl -s -X POST https://portofcall.ross.gg/api/iscsi/login \
  -H 'Content-Type: application/json' \
  -d '{"host":"nas.example.com","username":"iscsi_user","password":"secret","targetName":"any"}' | jq

# Login without CHAP (no-auth target)
curl -s -X POST https://portofcall.ross.gg/api/iscsi/login \
  -H 'Content-Type: application/json' \
  -d '{"host":"nas.example.com","targetName":"discover"}' | jq
```

---

## Local Testing

```bash
# TrueNAS or targetcli in Docker/VM
# Create an iSCSI target with targetcli (Linux):
targetcli /backstores/fileio create disk0 /tmp/iscsi_disk0.img 100M
targetcli /iscsi create iqn.2024-01.com.example:storage
targetcli /iscsi/iqn.2024-01.com.example:storage/tpg1/luns create /backstores/fileio/disk0
targetcli /iscsi/iqn.2024-01.com.example:storage/tpg1 set attribute authentication=0 demo_mode_write_protect=0 generate_node_acls=1
targetcli saveconfig

# Test discovery via wrangler dev
curl -s localhost:8787/api/iscsi/discover \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","port":3260}' | jq

# To test CHAP, configure targetcli with authentication:
# targetcli /iscsi/iqn.2024-01.com.example:storage/tpg1 set attribute authentication=1
# targetcli /iscsi/iqn.2024-01.com.example:storage/tpg1/acls/iqn.2024-01.gg.ross.portofcall:initiator set auth userid=myuser password=mypass
curl -s localhost:8787/api/iscsi/login \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","username":"myuser","password":"mypass","targetName":"discover"}' | jq
```
