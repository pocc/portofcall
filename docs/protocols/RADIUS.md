# RADIUS — Power-User Reference

**Port:** 1812 (authentication), 1813 (accounting)
**Transport:** TCP (RFC 6613 — RADIUS over TCP, since Cloudflare Workers only provide TCP sockets)
**Implementation:** `src/worker/radius.ts`
**Routes:** `src/worker/index.ts` lines 2128–2139

Standard RADIUS uses UDP. This implementation uses **RADIUS over TCP** (RFC 6613), which means only servers that accept TCP connections on the RADIUS port will respond. FreeRADIUS supports this via `listen { type = auth; proto = tcp; ... }` in `radiusd.conf`. Many production NAS appliances do not.

---

## Endpoints

| Endpoint | Method | Default Port | Default Timeout | Purpose |
|---|---|---|---|---|
| `/api/radius/probe` | POST | 1812 | 10 000 ms | Status-Server detection |
| `/api/radius/auth` | POST | 1812 | 15 000 ms | Access-Request (PAP) |
| `/api/radius/accounting` | POST | 1813 | 10 000 ms | Accounting-Request |

All three endpoints check `checkIfCloudflare()` before connecting and return HTTP 403 with `isCloudflare: true` if the target resolves to a Cloudflare IP.

---

## `/api/radius/probe`

Sends a **Status-Server** packet (code 12, RFC 5997) to detect whether a RADIUS server is listening.

### Request

```json
{
  "host": "radius.example.com",
  "port": 1812,
  "secret": "testing123",
  "timeout": 10000
}
```

| Field | Required | Default | Notes |
|---|---|---|---|
| `host` | yes | — | |
| `port` | no | `1812` | |
| `secret` | no | `"testing123"` | Shared secret. `testing123` is the FreeRADIUS test default |
| `timeout` | no | `10000` | ms |

### Wire exchange

```
→  Status-Server (code 12)
     NAS-Identifier = "portofcall-probe"   (hardcoded, not configurable)
     Message-Authenticator = HMAC-MD5(secret, packet)
←  Access-Accept (code 2)  or  Access-Reject (code 3)
```

The NAS-Identifier is always `"portofcall-probe"` — there is no request field to override it (unlike `/auth` and `/accounting` where `nasIdentifier` is configurable).

### Response

```json
{
  "success": true,
  "host": "radius.example.com",
  "port": 1812,
  "responseCode": 2,
  "responseCodeName": "Access-Accept",
  "identifier": 42,
  "authenticator": "a1b2c3d4e5f6...",
  "attributes": [
    {
      "type": 18,
      "typeName": "Reply-Message",
      "length": 22,
      "stringValue": "FreeRADIUS up 3 days",
      "intValue": null,
      "hex": "46 72 65 65 52 ..."
    }
  ],
  "replyMessages": ["FreeRADIUS up 3 days"],
  "connectTimeMs": 45,
  "totalTimeMs": 112
}
```

- `authenticator` is the 16-byte Response-Authenticator as a hex string (no spaces).
- `attributes[].hex` has space-separated hex bytes.
- `replyMessages` is a convenience extraction of all Reply-Message (type 18) string values.

---

## `/api/radius/auth`

Sends an **Access-Request** (code 1) using **PAP** (User-Password attribute, RFC 2865 §5.2).

### Request

```json
{
  "host": "radius.example.com",
  "port": 1812,
  "secret": "testing123",
  "username": "alice",
  "password": "s3cret",
  "nasIdentifier": "portofcall",
  "timeout": 15000
}
```

| Field | Required | Default | Notes |
|---|---|---|---|
| `host` | yes | — | |
| `port` | no | `1812` | |
| `secret` | no | `"testing123"` | |
| `username` | yes | — | Returns 400 if missing |
| `password` | no | `""` | Empty string is valid; encrypts as a zero-padded 16-byte block |
| `nasIdentifier` | no | `"portofcall"` | |
| `timeout` | no | `15000` | ms — 5 s longer than probe/accounting |

### Wire exchange

```
→  Access-Request (code 1)
     User-Name = "alice"
     User-Password = encrypted(password, secret, authenticator)   [RFC 2865 §5.2]
     NAS-Identifier = "portofcall"
     NAS-Port-Type = Virtual (5)
     Service-Type = Login (1)
     Message-Authenticator = HMAC-MD5(secret, packet)
←  Access-Accept (code 2)  |  Access-Reject (code 3)  |  Access-Challenge (code 11)
```

### Password encryption (RFC 2865 §5.2)

```
b1 = MD5(secret || Request-Authenticator)
c1 = p1 XOR b1
b2 = MD5(secret || c1)
c2 = p2 XOR b2
...
```

Password is zero-padded to the next multiple of 16 bytes (minimum 16). Each 16-byte block is XORed with `MD5(secret || previous_ciphertext_block)`, where the first block uses the Request-Authenticator.

### Response

```json
{
  "success": true,
  "authenticated": true,
  "host": "radius.example.com",
  "port": 1812,
  "username": "alice",
  "responseCode": 2,
  "responseCodeName": "Access-Accept",
  "replyMessages": ["Welcome, alice"],
  "hasChallenge": false,
  "hasState": false,
  "attributes": [
    { "type": 18, "typeName": "Reply-Message", "length": 16, "stringValue": "Welcome, alice", "intValue": null }
  ],
  "connectTimeMs": 38,
  "totalTimeMs": 95
}
```

| Field | Meaning |
|---|---|
| `success` | Always `true` if the TCP exchange completed without error — even for Access-Reject |
| `authenticated` | `true` only when `responseCode === 2` (Access-Accept) |
| `hasChallenge` | `true` when `responseCode === 11` (Access-Challenge) — multi-factor or EAP step |
| `hasState` | `true` when a State attribute (type 24) is present in the response |

**Gotcha:** `success: true` + `authenticated: false` is normal for rejected credentials. Check `authenticated`, not `success`, to determine whether the user was accepted.

---

## `/api/radius/accounting`

Sends an **Accounting-Request** (code 4) per RFC 2866. Used to record session start, stop, and interim usage.

### Request

```json
{
  "host": "radius.example.com",
  "port": 1813,
  "secret": "mysecret",
  "username": "alice",
  "sessionId": "sess-a1b2c3",
  "statusType": "Start",
  "nasIdentifier": "portofcall",
  "sessionTime": 3600,
  "inputOctets": 1048576,
  "outputOctets": 524288,
  "terminateCause": 1,
  "timeout": 10000
}
```

| Field | Required | Default | Notes |
|---|---|---|---|
| `host` | yes | — | |
| `port` | no | `1813` | Note: different from auth/probe's 1812 |
| `secret` | **yes** | — | No default — returns 400 if missing (unlike probe/auth which default to `"testing123"`) |
| `username` | no | `"test"` | |
| `sessionId` | no | `"sess-{random 6-char hex}"` | Auto-generated if omitted |
| `statusType` | no | `"Start"` | One of: `"Start"`, `"Stop"`, `"Interim-Update"` |
| `nasIdentifier` | no | `"portofcall"` | |
| `sessionTime` | no | — | Seconds; only included if provided |
| `inputOctets` | no | — | Bytes received; only included if provided |
| `outputOctets` | no | — | Bytes sent; only included if provided |
| `terminateCause` | no | — | Only included when `statusType === "Stop"` |
| `timeout` | no | `10000` | ms |

### Acct-Status-Type values

| Name | Code | When to use |
|---|---|---|
| `Start` | 1 | Session begins |
| `Stop` | 2 | Session ends |
| `Interim-Update` | 3 | Periodic usage report during session |

### Wire exchange

```
→  Accounting-Request (code 4)
     User-Name, NAS-Identifier, Acct-Status-Type, Acct-Session-Id,
     NAS-Port-Type=Virtual(5), Service-Type=Login(1),
     [Acct-Session-Time], [Acct-Input-Octets], [Acct-Output-Octets],
     [Acct-Terminate-Cause (Stop only)]
     Authenticator = MD5(Code+ID+Length+16*0x00+Attributes+Secret)   [RFC 2866 §3]
←  Accounting-Response (code 5)
```

### Accounting authenticator (RFC 2866 §3)

Unlike Access-Request (which uses a random 16-byte authenticator), Accounting-Request builds the packet with 16 zero bytes at offset 4, then computes:

```
MD5(entire_packet_with_zero_auth || secret)
```

and overwrites bytes 4–19 with the digest.

### Response

```json
{
  "success": true,
  "host": "radius.example.com",
  "port": 1813,
  "username": "alice",
  "sessionId": "sess-a1b2c3",
  "statusType": "Start",
  "responseCode": 5,
  "responseCodeName": "Accounting-Response",
  "attributes": [],
  "connectTimeMs": 42,
  "totalTimeMs": 98
}
```

`success` is `true` only when `responseCode === 5` (Accounting-Response).

---

## Attribute Decoding

The parser recognizes 13 attribute types by name:

| Type | Name | Decoding |
|---|---|---|
| 1 | User-Name | string |
| 2 | User-Password | (raw hex, not decoded) |
| 4 | NAS-IP-Address | dotted-quad IPv4 (e.g., `"192.168.1.1"`) |
| 5 | NAS-Port | 32-bit integer |
| 6 | Service-Type | 32-bit integer |
| 18 | Reply-Message | string |
| 24 | State | (raw hex) |
| 26 | Vendor-Specific | (raw hex — VSA sub-fields not decoded) |
| 30 | Called-Station-Id | string |
| 31 | Calling-Station-Id | string |
| 32 | NAS-Identifier | string |
| 61 | NAS-Port-Type | 32-bit integer |
| 80 | Message-Authenticator | (raw hex) |

Unknown attribute types appear as `"Unknown(N)"` in `typeName`.

Vendor-Specific Attributes (type 26) are **not** sub-decoded — the vendor ID and vendor-type are returned as raw hex. This means attributes from vendors like Cisco (vendor 9), Microsoft (vendor 311), or Juniper (vendor 2636) are opaque.

---

## Differences Between Endpoints

| Behavior | `/probe` | `/auth` | `/accounting` |
|---|---|---|---|
| Default port | 1812 | 1812 | **1813** |
| Default timeout | 10 000 ms | **15 000 ms** | 10 000 ms |
| Default secret | `"testing123"` | `"testing123"` | **none (required)** |
| NAS-Identifier | `"portofcall-probe"` (hardcoded) | configurable (`"portofcall"`) | configurable (`"portofcall"`) |
| Message-Authenticator | yes (HMAC-MD5) | yes (HMAC-MD5) | **no** |
| Authenticator type | random 16 bytes | random 16 bytes | **computed MD5** |
| `success` means | TCP exchange ok | TCP exchange ok | **code === 5** |

---

## Crypto Internals

- **MD5**: Custom pure-JavaScript implementation (no Web Crypto API, no Node.js `crypto`). Runs synchronously in the worker.
- **HMAC-MD5**: Standard HMAC construction (RFC 2104) using the custom MD5. Used for the Message-Authenticator attribute (RFC 3579 §3.2).
- **Request Authenticator**: Generated via `Math.random()` — not cryptographically secure. Sufficient for probing; not ideal for production auth.
- **Response Authenticator**: **Not verified** by any endpoint. The code does not check `MD5(Code+ID+Length+RequestAuth+Attributes+Secret)` against the response authenticator. A man-in-the-middle could forge responses.

---

## Known Limitations

1. **TCP only** — Most RADIUS deployments use UDP. Only servers with RADIUS-over-TCP (RFC 6613) enabled will respond. This excludes most appliance-based NAS devices.

2. **PAP only** — Only User-Password (PAP) authentication. No CHAP (type 3), MS-CHAPv2, or EAP (type 79) support.

3. **No EAP** — Despite the original planning doc mentioning EAP/802.1X, there is no EAP-Message attribute handling. WPA2-Enterprise authentication (802.1X → EAP-TLS/PEAP/TTLS) is not possible.

4. **No response authenticator verification** — The client does not verify the Response-Authenticator, meaning forged responses are accepted.

5. **No CHAP** — CHAP-Password (type 3) and CHAP-Challenge (type 60) are not implemented.

6. **No multi-step challenge** — When `/auth` receives an Access-Challenge (code 11), it reports `hasChallenge: true` and `hasState: true` but does not re-send with the State attribute. The caller would need to make a second `/auth` call manually, but there is no `state` parameter to pass through.

7. **Vendor-Specific Attributes opaque** — Type 26 attributes are not decoded into vendor-id / vendor-type / vendor-value.

8. **terminateCause only on Stop** — The `terminateCause` field is silently ignored unless `statusType === "Stop"` (statusTypeCode === 2). Sending it with Start or Interim-Update has no effect.

9. **`Math.random()` authenticator** — Not cryptographically random. For probing this is fine; for real auth it weakens the password encryption since an attacker who predicts the authenticator can recover the password from the encrypted User-Password attribute.

10. **No TLS** — Plain TCP only. For encrypted transport, use the separate RadSec implementation (`/api/radsec/` endpoints, port 2083).

---

## Packet Format Reference

```
Offset  Length  Field
0       1       Code (1=Access-Request, 2=Accept, 3=Reject, 4=Acct-Request, 5=Acct-Response, 11=Challenge, 12=Status-Server)
1       1       Identifier (0–255, random)
2       2       Length (big-endian, 20 + attributes)
4       16      Authenticator (random for Access-Request; MD5-computed for Accounting-Request)
20      ...     Attributes (TLV: 1-byte type, 1-byte length, N-byte value)
```

Attribute length field includes the type and length bytes themselves (minimum value: 2).

---

## Terminate-Cause Reference (RFC 2866 §5.10)

For use with the `terminateCause` field in `/accounting` Stop requests:

| Code | Name |
|---|---|
| 1 | User-Request |
| 2 | Lost-Carrier |
| 3 | Lost-Service |
| 4 | Idle-Timeout |
| 5 | Session-Timeout |
| 6 | Admin-Reset |
| 7 | Admin-Reboot |
| 8 | Port-Error |
| 9 | NAS-Error |
| 10 | NAS-Request |
| 11 | NAS-Reboot |
| 12 | Port-Unneeded |
| 13 | Port-Preempted |
| 14 | Port-Suspended |
| 15 | Service-Unavailable |
| 16 | Callback |
| 17 | User-Error |
| 18 | Host-Request |

---

## curl Examples

### Probe a RADIUS server

```bash
curl -X POST https://portofcall.example.com/api/radius/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"radius.example.com","secret":"testing123"}'
```

### Authenticate a user (PAP)

```bash
curl -X POST https://portofcall.example.com/api/radius/auth \
  -H 'Content-Type: application/json' \
  -d '{"host":"radius.example.com","secret":"testing123","username":"alice","password":"s3cret"}'
```

### Send accounting Start

```bash
curl -X POST https://portofcall.example.com/api/radius/accounting \
  -H 'Content-Type: application/json' \
  -d '{"host":"radius.example.com","port":1813,"secret":"mysecret","username":"alice","statusType":"Start","sessionId":"sess-001"}'
```

### Send accounting Stop with stats

```bash
curl -X POST https://portofcall.example.com/api/radius/accounting \
  -H 'Content-Type: application/json' \
  -d '{"host":"radius.example.com","port":1813,"secret":"mysecret","username":"alice","statusType":"Stop","sessionId":"sess-001","sessionTime":3600,"inputOctets":1048576,"outputOctets":524288,"terminateCause":1}'
```

---

## Local Testing with FreeRADIUS

Enable TCP in `/etc/freeradius/radiusd.conf`:

```
listen {
    type = auth
    ipaddr = *
    port = 1812
    proto = tcp
}

listen {
    type = acct
    ipaddr = *
    port = 1813
    proto = tcp
}
```

Add a test user in `/etc/freeradius/users`:

```
alice  Cleartext-Password := "s3cret"
       Reply-Message := "Welcome, alice"
```

Set shared secret in `/etc/freeradius/clients.conf`:

```
client portofcall {
    ipaddr = 0.0.0.0/0
    secret = testing123
    proto = tcp
}
```

Start with debug output: `freeradius -X`
