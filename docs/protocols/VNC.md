# VNC (RFB) Protocol Reference

**Port:** 5900 (default; 5901 = display :1, etc.)
**RFC:** [6143](https://tools.ietf.org/html/rfc6143)
**Implementation:** `src/worker/vnc.ts`
**Tests:** `tests/vnc.test.ts` (5/5 passing, `/connect` only)

---

## Endpoints

| Method | Path | Behavior |
|--------|------|----------|
| `POST` | `/api/vnc/connect` | RFB handshake — enumerate security types, no auth |
| `POST` | `/api/vnc/auth` | VNC Authentication (type 2) — DES challenge-response |

No WebSocket tunnel exists. The planning doc described a noVNC proxy — it is not implemented.

---

## `/api/vnc/connect` — Security Type Discovery

Performs the RFB version exchange and reads the server's offered security types. Does **not** select a security type or proceed to authentication. Closes the socket after reading the security type list.

### Request

```json
{ "host": "vnc.example.com", "port": 5900, "timeout": 10000 }
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | |
| `port` | number | `5900` | validated 1–65535 |
| `timeout` | number | `10000` ms | covers TCP connect + entire RFB handshake |

### Response — success

```json
{
  "success": true,
  "host": "vnc.example.com",
  "port": 5900,
  "connectTime": 12,
  "rtt": 87,
  "serverVersion": "RFB 003.008",
  "serverMajor": 3,
  "serverMinor": 8,
  "negotiatedVersion": "RFB 003.008",
  "securityTypes": [
    { "id": 1, "name": "None" },
    { "id": 2, "name": "VNC Authentication" }
  ],
  "authRequired": false
}
```

| Field | Notes |
|-------|-------|
| `connectTime` | ms from call start to `socket.opened` |
| `rtt` | ms from call start to receipt of security type list |
| `serverVersion` | raw version string with `\n` trimmed |
| `negotiatedVersion` | version we sent: min of server's and `3.8` |
| `authRequired` | `true` if type `1` (None) is **not** in `securityTypes` |
| `securityError` | set (and `success` still `true`) if server refused — see below |

### Response — server-refused (quirk)

When the server refuses with count `0` (RFB 3.7+) or security type `0` (RFB 3.3), the response is:

```json
{
  "success": true,
  "securityError": "Too many authentication failures",
  "securityTypes": [],
  "authRequired": true
}
```

`success: true` even though the server refused. Check `securityError` to detect this case. The error string is truncated to 256 bytes.

### Response — error (400/403/500)

```json
{ "success": false, "error": "Host is required" }          // 400
{ "success": false, "error": "...", "isCloudflare": true }  // 403
{ "success": false, "error": "Connection timeout" }         // 500
```

---

## `/api/vnc/auth` — VNC Authentication (Type 2)

Performs the full RFB handshake up to and including VNC Authentication (security type 2). Sends credentials as a DES-encrypted challenge response.

### Request

```json
{
  "host": "vnc.example.com",
  "port": 5900,
  "timeout": 10000,
  "password": "secret"
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | |
| `port` | number | `5900` | validated 1–65535 |
| `timeout` | number | `10000` ms | |
| `password` | string | required | `null`/`undefined` → 400; empty string `""` is valid for servers with no password |

### Response — authentication attempted

```json
{
  "success": true,
  "host": "vnc.example.com",
  "port": 5900,
  "serverVersion": "RFB 003.008",
  "negotiatedVersion": "RFB 003.008",
  "securityTypes": [
    { "id": 2, "name": "VNC Authentication" }
  ],
  "challenge": "a1b2c3d4e5f60708090a0b0c0d0e0f10",
  "authResult": "ok",
  "desAvailable": true,
  "rtt": 142
}
```

| Field | Notes |
|-------|-------|
| `success` | `true` only when `authResult === 'ok'` |
| `authResult` | `"ok"` / `"failed"` / `"tooMany"` |
| `reason` | present on `"failed"` — from server's 3.8+ reason string (may be absent) |
| `challenge` | 16-byte server challenge as lowercase hex |
| `desAvailable` | always `true` (hardcoded — DES is always implemented) |

### `authResult` values

| Value | SecurityResult code | Meaning |
|-------|---------------------|---------|
| `"ok"` | `0` | Authentication successful |
| `"failed"` | `1` | Wrong password (RFB 3.8+ sends `reason` string) |
| `"tooMany"` | `2` | Too many failures — server locked out client |
| `"failed"` + `reason: "Unknown result code: N"` | other | Non-standard result |

### When server does not offer type 2

If the server's security type list does not include `2`, the call fails with HTTP 500:

```json
{
  "success": false,
  "error": "VNC Authentication (type 2) not offered. Available types: 1"
}
```

No `securityTypes` array is returned in the error response. Use `/connect` first to check what types are available.

### Password encoding

VNC Authentication uses DES ECB with a **bit-reversed key** (LSB-first, per the RFB spec):

1. Password is UTF-8 encoded, then padded with `\0` or truncated to 8 bytes
2. Each key byte's bits are reversed (bit 7 becomes bit 0, etc.)
3. DES ECB encrypts the two 8-byte halves of the 16-byte server challenge separately
4. 16-byte response is sent to server

Passwords longer than 8 bytes are silently truncated at byte 8. Empty password uses an all-zero key.

`crypto.subtle` does not support DES; the implementation includes a full manual DES in TypeScript (S-boxes, key schedule, Feistel network).

---

## RFB Protocol Flow

### Version Exchange

```
Server → Client:  "RFB 003.008\n"   (12 bytes, always)
Client → Server:  "RFB 003.008\n"   (12 bytes, negotiated)
```

Worker supports up to RFB 3.8. Negotiated version = `min(server, 3.8)`.

```
clientMajor = min(serverMajor, 3)
clientMinor = (serverMajor >= 3) ? min(serverMinor, 8) : serverMinor
```

### Security Negotiation (RFB 3.7+)

```
Server → Client:  [count: 1 byte] [type₁, type₂, ...count bytes]
Client → Server:  [chosen type: 1 byte]   (only in /auth)
```

If count is `0`, server follows with a reason string:
```
[reason length: uint32 BE] [reason: UTF-8 string]
```

### Security Negotiation (RFB 3.3 — legacy)

```
Server → Client:  [type: uint32 BE]   (server decides, not client)
```

Type `0` = failure (server sends reason string). Worker handles both paths.

In `/auth`: for RFB 3.3, if server already chose type 2, no client selection byte is sent.

### VNC Authentication (type 2) wire

```
Server → Client:  [challenge: 16 bytes]
Client → Server:  [DES(challenge[0:8], key) ++ DES(challenge[8:16], key)]  (16 bytes)
Server → Client:  [result: uint32 BE]  0=OK, 1=failed, 2=tooMany
```

RFB 3.8+ on failure:
```
Server → Client:  [reason length: uint32 BE] [reason: UTF-8]
```

---

## Security Type Reference

| ID | Name | Notes |
|----|------|-------|
| 0 | Invalid | Server refusing (RFB 3.3 error code) |
| 1 | None | No authentication |
| 2 | VNC Authentication | DES challenge-response (implemented in `/auth`) |
| 5 | RA2 | RealVNC proprietary |
| 6 | RA2ne | RealVNC proprietary (no encryption) |
| 16 | Tight | TightVNC |
| 17 | Ultra | UltraVNC |
| 18 | TLS | TLS wrapping |
| 19 | VeNCrypt | VeNCrypt (FOSS TLS/x509 variant) |
| 20 | GTK-VNC SASL | GTK-VNC with SASL |
| 21 | MD5 hash | |
| 22 | Colin Dean xvp | |
| 30 | Apple Remote Desktop (ARD30) | |
| 35 | Apple Remote Desktop (ARD35) | |
| other | `Unknown(N)` | Not in name table |

Types 7–15 (between RA2ne and Tight) are not named — they appear as `Unknown(N)`. The source comment says "5-16 = RealVNC extensions" but only 5, 6, 16 are mapped.

---

## Timeout Behavior

Unlike most other worker protocols that use per-step inner timeouts, VNC uses a single outer `Promise.race` for the **entire call** including TCP connect, version exchange, and security negotiation.

The timeout starts at the beginning of the function, before the Cloudflare detection check. Cloudflare detection runs first; if that exceeds the timeout, the race fires.

Default timeout: **10000 ms** (other protocols typically use 15000 ms or 30000 ms).

---

## Known Limitations

| Limitation | Affected endpoint(s) | Detail |
|---|---|---|
| No WebSocket tunnel | all | Planning doc's noVNC proxy is not implemented |
| Auth type 2 only | `/auth` | Only VNC Authentication; None/TLS/VeNCrypt not supported |
| 8-byte password max | `/auth` | Password truncated to 8 bytes; longer passwords silently truncated |
| Server-refused returns `success:true` | `/connect` | `count=0` path sets `securityError` but not `success:false` |
| No reason on 500 for missing type 2 | `/auth` | Error response lacks `securityTypes` to show what was offered |
| `desAvailable` always true | `/auth` | Hardcoded; not a capability probe |
| Reason string silently dropped | `/auth` | Read errors on RFB 3.8 failure reason are caught and ignored |
| 256-byte reason cap | `/connect` | `securityError` truncated to 256 bytes |
| 1024-byte reason cap | `/auth` | Failure reason string limited to 1024 bytes |
| Cloudflare detection | all | Cloudflare-fronted hosts rejected with HTTP 403 |
| No TLS | all | VNC over TLS (type 18/19) requires TCP layer TLS; `connect()` uses `secureTransport:'off'` |

---

## Test Coverage

Tests in `tests/vnc.test.ts` cover `/connect` only:

- Missing `host` → HTTP 400
- Invalid `port` (99999) → HTTP 400
- Non-existent host → HTTP 500, `success: false`
- Default port 5900 (implicit in failed connection)
- Custom `timeout` — verifies call completes within 15s

No automated tests for `/auth`, successful RFB handshakes, or server-refused paths.

---

## Testing Locally

```bash
# Check what security types a server offers
curl -s -X POST https://portofcall.ross.gg/api/vnc/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"vnc.example.com","port":5900}' | jq .

# Attempt VNC Authentication
curl -s -X POST https://portofcall.ross.gg/api/vnc/auth \
  -H 'Content-Type: application/json' \
  -d '{"host":"vnc.example.com","port":5900,"password":"secret"}' | jq .

# Test with no password (empty string)
curl -s -X POST https://portofcall.ross.gg/api/vnc/auth \
  -H 'Content-Type: application/json' \
  -d '{"host":"vnc.example.com","port":5900,"password":""}' | jq .

# Local VNC server (Docker)
docker run -d -p 5900:5900 -e VNC_PASSWORD=test123 consol/ubuntu-xfce-vnc
curl -s -X POST https://portofcall.ross.gg/api/vnc/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"<your-ip>","port":5900}' | jq .
```

---

## Resources

- **RFC 6143** — [The Remote Framebuffer Protocol](https://tools.ietf.org/html/rfc6143)
- **RFB 3.3/3.7/3.8** — RFC 6143 §7 covers version-specific behavior differences
- **IANA VNC Security Types** — [Registered type numbers](https://www.iana.org/assignments/rfb/rfb.xhtml)
