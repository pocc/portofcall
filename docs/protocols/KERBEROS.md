# Kerberos (Port 88) — Power User Reference

Implementation: `src/worker/kerberos.ts` (942 lines)
Wire format: ASN.1 DER over TCP with 4-byte big-endian length prefix (RFC 4120)

## Endpoints

| Method | Path | Purpose | Default timeout |
|--------|------|---------|-----------------|
| POST (or any) | `/api/kerberos/connect` | KDC probe via AS-REQ | 10 000 ms |
| POST only | `/api/kerberos/user-enum` | Username enumeration via AS-REQ per-user | 10 000 ms (total) |
| POST only | `/api/kerberos/spn-check` | SPN existence probe via TGS-REQ without TGT | 8 000 ms |

---

## POST `/api/kerberos/connect`

Sends a single AS-REQ without pre-authentication to probe a KDC. The expected response is a KRB-ERROR with `PREAUTH_REQUIRED` (error 25), which reveals the KDC's supported encryption types, realm name, and server time.

**Request:**
```json
{
  "host": "dc01.corp.local",
  "port": 88,
  "realm": "CORP.LOCAL",
  "principal": "user",
  "timeout": 10000
}
```

All fields except `host` are optional. Defaults: `port=88`, `realm="EXAMPLE.COM"`, `principal="user"`, `timeout=10000`.

**Response (success):**
```json
{
  "success": true,
  "host": "dc01.corp.local",
  "port": 88,
  "rtt": 47,
  "connectTime": 23,
  "response": {
    "msgType": 30,
    "msgTypeName": "KRB-ERROR",
    "pvno": 5,
    "realm": "CORP.LOCAL",
    "errorCode": 25,
    "errorName": "KDC_ERR_PREAUTH_REQUIRED",
    "errorText": null,
    "serverTime": "20260217143022Z",
    "supportedEtypes": [18, 17, 23],
    "etypeNames": ["aes256-cts-hmac-sha1-96", "aes128-cts-hmac-sha1-96", "rc4-hmac"]
  }
}
```

**Quirk — success:true with null response:** If the KDC responds to the TCP connection but doesn't send a Kerberos message before the timeout, the response is `{ "success": true, "response": null }`. This means `success:true` only confirms the TCP connection, not that the KDC spoke Kerberos.

**Quirk — no HTTP method restriction:** Unlike `/user-enum` and `/spn-check` which reject non-POST with 405, `/connect` accepts any HTTP method (GET, PUT, DELETE, etc.).

**Quirk — default realm "EXAMPLE.COM":** The `realm` parameter defaults to the literal string `"EXAMPLE.COM"`. If you omit it, the AS-REQ targets `krbtgt/EXAMPLE.COM` which will be wrong for real KDCs. Always pass realm explicitly.

```bash
curl -X POST https://portofcall.dev/api/kerberos/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"dc01.corp.local","realm":"CORP.LOCAL"}'
```

---

## POST `/api/kerberos/user-enum`

Sends one AS-REQ per username (without pre-auth) and classifies the KDC's response to determine whether each username exists. This is the technique used by tools like Kerbrute.

**Request:**
```json
{
  "host": "dc01.corp.local",
  "port": 88,
  "realm": "CORP.LOCAL",
  "usernames": ["administrator", "jsmith", "nonexistent"],
  "timeout": 10000
}
```

Required fields: `host`, `realm`, `usernames`. Defaults: `port=88`, `timeout=10000`.

**Response:**
```json
{
  "success": true,
  "host": "dc01.corp.local",
  "port": 88,
  "realm": "CORP.LOCAL",
  "checkedCount": 3,
  "results": [
    {
      "username": "administrator",
      "exists": true,
      "preauthRequired": true,
      "asrepRoastable": false,
      "errorCode": 25,
      "errorName": "KDC_ERR_PREAUTH_REQUIRED",
      "note": "User exists, pre-authentication required"
    },
    {
      "username": "jsmith",
      "exists": true,
      "preauthRequired": false,
      "asrepRoastable": true,
      "errorCode": null,
      "errorName": null,
      "note": "AS-REP received — account does not require pre-authentication"
    },
    {
      "username": "nonexistent",
      "exists": false,
      "preauthRequired": null,
      "asrepRoastable": false,
      "errorCode": 6,
      "errorName": "KDC_ERR_C_PRINCIPAL_UNKNOWN",
      "note": "User not found in directory"
    }
  ]
}
```

### Classification logic

| KDC response | `exists` | `preauthRequired` | `asrepRoastable` | Meaning |
|---|---|---|---|---|
| AS-REP (msg type 11) | `true` | `false` | `true` | `DONT_REQUIRE_PREAUTH` flag set — AS-REP Roastable |
| Error 25 `PREAUTH_REQUIRED` | `true` | `true` | `false` | Normal account, pre-auth enforced |
| Error 24 `PREAUTH_FAILED` | `true` | `true` | `false` | Account exists (pre-auth failed without creds) |
| Error 18 `CLIENT_REVOKED` | `true` | `null` | `false` | Account disabled or revoked |
| Error 31 `KEY_EXPIRED` | `true` | `true` | `false` | Password expired |
| Error 6 `C_PRINCIPAL_UNKNOWN` | `false` | `null` | `false` | User not in directory |
| Error 68 `WRONG_REALM` | `null` | `null` | `false` | Wrong realm — user may exist elsewhere |
| Any other error | `true` | `null` | `false` | Likely exists (catch-all) |
| No response | `null` | `null` | `false` | Timeout |

### Limits and timing

- **50-user cap:** `usernames.slice(0, 50)` — any usernames beyond index 49 are silently dropped.
- **Per-user timeout:** `min(floor(timeout / count) + 500, 8000)` ms. With the default 10 000 ms total timeout and 50 users, each user gets ~700 ms. With 3 users, each gets ~3833 ms. The +500 ms buffer and 8 000 ms cap are hardcoded.
- **Sequential execution:** Users are checked one at a time in a `for` loop, not in parallel. Total wall time is roughly `count × perUserTimeout`.
- **Realm auto-uppercased:** `realm.toUpperCase()` is applied to the request body.

```bash
curl -X POST https://portofcall.dev/api/kerberos/user-enum \
  -H 'Content-Type: application/json' \
  -d '{"host":"dc01.corp.local","realm":"CORP.LOCAL","usernames":["administrator","guest","krbtgt"]}'
```

---

## POST `/api/kerberos/spn-check`

Sends a TGS-REQ without a TGT to probe whether a Service Principal Name (SPN) exists in the KDC. The KDC's error code reveals SPN existence without requiring authentication. This is the enumeration step before Kerberoasting.

**Request:**
```json
{
  "host": "dc01.corp.local",
  "port": 88,
  "realm": "CORP.LOCAL",
  "spn": "MSSQLSvc/sql01.corp.local:1433",
  "timeout": 8000
}
```

Required fields: `host`, `realm`, `spn`. Defaults: `port=88`, `timeout=8000`.

**Response:**
```json
{
  "success": true,
  "host": "dc01.corp.local",
  "port": 88,
  "realm": "CORP.LOCAL",
  "spn": "MSSQLSvc/sql01.corp.local:1433",
  "latencyMs": 34,
  "spnExists": true,
  "note": "SPN exists (TGS-REQ rejected: missing PA-TGS-REQ)",
  "response": {
    "msgType": 30,
    "msgTypeName": "KRB-ERROR",
    "errorCode": 16,
    "errorName": null,
    "errorText": null,
    "realm": "CORP.LOCAL"
  }
}
```

### SPN classification logic

| KDC response | `spnExists` | Meaning |
|---|---|---|
| Error 7 `S_PRINCIPAL_UNKNOWN` | `false` | SPN not registered |
| Error 16 `PADATA_TYPE_NOSUPP` | `true` | SPN exists, rejected for missing PA-TGS-REQ |
| Error 12 `POLICY` or 14 `ETYPE_NOSUPP` | `true` | SPN exists, policy/etype mismatch |
| Any other KRB-ERROR | `true` | Likely exists (catch-all) |
| TGS-REP (msg type 13) | `true` | Ticket issued without TGT — unexpected |
| No response | n/a | `success: false` |

### SPN name parsing

The `spn` string is split on `/` to determine the PrincipalName type:
- `"service/host"` → NT-SRV-HST (type 3), two name components
- `"service"` → NT-PRINCIPAL (type 1), single component

Note: SPNs with instance ports like `MSSQLSvc/sql01:1433` include the port in the second component. The slash split means `MSSQLSvc` is component 1 and `sql01:1433` is component 2.

**Quirk — error 16 not in ERROR_NAMES table:** `PADATA_TYPE_NOSUPP` (error 16) is the most common positive signal but is not in the `ERROR_NAMES` lookup table. The response will show `"errorName": null` even though the code correctly identifies `spnExists: true`. Similarly, TGS-REP (msg type 13) is not in the message type name table and would show `"msgTypeName": "UNKNOWN"`.

```bash
curl -X POST https://portofcall.dev/api/kerberos/spn-check \
  -H 'Content-Type: application/json' \
  -d '{"host":"dc01.corp.local","realm":"CORP.LOCAL","spn":"HTTP/web01.corp.local"}'
```

---

## AS-REQ wire format

The implementation builds a correct RFC 4120 AS-REQ. Key details:

```
APPLICATION 10 [AS-REQ]
  SEQUENCE
    [1] pvno = 5
    [2] msg-type = 10 (AS-REQ)
    [4] req-body SEQUENCE
      [0] kdc-options = 0x40810010
          bit 1  (forwardable)
          bit 8  (renewable)
          bit 15 (canonicalize, RFC 6806)
          bit 27 (renewable-ok)
      [1] cname: NT-PRINCIPAL(1) / principal string
      [2] realm: GeneralString (uppercased)
      [3] sname: NT-SRV-INST(2) / "krbtgt" + realm
      [5] till: 2037-09-13T02:48:05Z (hardcoded far future)
      [7] nonce: random 31-bit integer
      [8] etype: [18, 17, 23, 3]
```

No `[3] padata` field — this deliberately omits pre-authentication data, which is the technique that makes user enumeration and KDC probing work.

Encryption types offered in the AS-REQ:
| Code | Name | Notes |
|------|------|-------|
| 18 | aes256-cts-hmac-sha1-96 | Preferred |
| 17 | aes128-cts-hmac-sha1-96 | |
| 23 | rc4-hmac | Legacy, common in older AD |
| 3 | des-cbc-md5 | Deprecated, included for compatibility |

The TGS-REQ (`/spn-check`) offers only codes 18, 17, 23 (no DES).

## TGS-REQ wire format (for /spn-check)

```
APPLICATION 12 [TGS-REQ]
  SEQUENCE
    [1] pvno = 5
    [2] msg-type = 12 (TGS-REQ)
    — no [3] padata (deliberately omitted — no TGT)
    [4] req-body SEQUENCE
      [0] kdc-options = 0x40810010 (same as AS-REQ)
      [2] realm: uppercased
      [3] sname: parsed from SPN string
      [5] till: 2037-09-13T02:48:05Z
      [7] nonce: random 31-bit integer
      [8] etype: [18, 17, 23]
```

Note: The TGS-REQ body has `[2] realm` and `[3] sname` but no `[1] cname` — the client principal would normally be embedded in the PA-TGS-REQ authenticator.

## KRB-ERROR response parsing

The parser extracts these context-tagged fields from the KRB-ERROR SEQUENCE:

| Tag | Field | Parsed as |
|-----|-------|-----------|
| [0] | pvno | integer |
| [4] | stime | GeneralizedTime string |
| [6] | error-code | integer → mapped via ERROR_NAMES |
| [7] | crealm | GeneralString |
| [9] | realm | GeneralString |
| [11] | e-data | PA-DATA sequence → PA-ETYPE-INFO2 (type 19) |
| [12] | e-text | GeneralString |

Tags [1] (msg-type), [2] (cusec), [3] (ctime), [5] (susec), [8] (cname), [10] (sname) are not parsed.

### PA-ETYPE-INFO2 extraction

When the KDC returns `PREAUTH_REQUIRED`, the e-data field contains a SEQUENCE of PA-DATA entries. The parser looks for PA-ETYPE-INFO2 (padata-type 19), which is a SEQUENCE of ETYPE-INFO2-ENTRY. Each entry's first field is the encryption type integer. These are collected into `supportedEtypes[]` and mapped to names via `etypeNames[]`.

The parser ignores PA-ENC-TIMESTAMP (type 2), PA-PK-AS-REQ (type 16), and all other PA-DATA types.

## Error code reference

Codes recognized in the ERROR_NAMES table:

| Code | Name | Used by |
|------|------|---------|
| 6 | `KDC_ERR_C_PRINCIPAL_UNKNOWN` | `/user-enum` (user not found) |
| 7 | `KDC_ERR_S_PRINCIPAL_UNKNOWN` | `/spn-check` (SPN not found) |
| 12 | `KDC_ERR_POLICY` | `/spn-check` (SPN exists, policy) |
| 14 | `KDC_ERR_ETYPE_NOSUPP` | `/spn-check` (SPN exists) |
| 18 | `KDC_ERR_CLIENT_REVOKED` | `/user-enum` (account disabled) |
| 24 | `KDC_ERR_PREAUTH_FAILED` | `/user-enum` (user exists) |
| 25 | `KDC_ERR_PREAUTH_REQUIRED` | `/connect`, `/user-enum` (normal) |
| 31 | `KDC_ERR_KEY_EXPIRED` | `/user-enum` (password expired) |
| 41 | `KDC_ERR_PREAUTH_EXPIRED` | (in table but not specifically handled) |
| 60 | `KRB_AP_ERR_INAPP_CKSUM` | (in table but not specifically handled) |
| 68 | `KDC_ERR_WRONG_REALM` | `/user-enum` (referral) |

**Not in table:** Error 16 (`KDC_ERR_PADATA_TYPE_NOSUPP`) — the most common positive signal from `/spn-check` — returns `errorName: null`.

## Encryption type reference

Types recognized in the ETYPE_NAMES table:

| Code | Name | Security status |
|------|------|-----------------|
| 1 | des-cbc-crc | Broken — disabled in modern AD |
| 2 | des-cbc-md4 | Broken |
| 3 | des-cbc-md5 | Broken |
| 16 | des3-cbc-sha1 | Deprecated |
| 17 | aes128-cts-hmac-sha1-96 | Supported |
| 18 | aes256-cts-hmac-sha1-96 | Preferred |
| 23 | rc4-hmac | Weak — Kerberoasting target |
| 24 | rc4-hmac-exp | Export-grade, very weak |

If a KDC returns etype 23 (rc4-hmac) in its supported list, that's a signal the domain may be vulnerable to Kerberoasting (offline cracking of service ticket encrypted with RC4-HMAC).

## Known limitations

1. **No actual authentication** — No pre-authentication, no password/keytab support. All three endpoints work by analyzing KDC error responses to unauthenticated probes.

2. **No TLS/STARTTLS** — Raw TCP only. No support for FAST (RFC 6113) or TLS-wrapped Kerberos.

3. **Single TCP read** — Both `sendKerberosRequest` and `/connect` do a single `reader.read()` call. If the KDC's response spans multiple TCP segments, only the first segment is captured and the message may be incomplete or truncated.

4. **No UDP transport** — Kerberos supports both TCP and UDP (RFC 4120 §7.2). Only TCP is implemented. Some KDCs prefer UDP for small messages (< 1500 bytes) and may behave differently or refuse TCP on port 88.

5. **`/connect` duplicates TCP framing** — The `/connect` handler manually builds the 4-byte length prefix + message instead of using the shared `sendKerberosRequest` helper. Functionally identical but divergent code paths.

6. **Port validation inconsistency** — `/connect` validates `port` is 1–65535; `/user-enum` and `/spn-check` do not validate port.

7. **AS-REP minimal parsing** — When the KDC returns an AS-REP (msg type 11) instead of KRB-ERROR, only `pvno` and `realm` are extracted. The ticket, cname, and encrypted part are not parsed. This mainly affects `/user-enum` for accounts with `DONT_REQUIRE_PREAUTH` — the AS-REP hash (for offline cracking) is not returned.

8. **Cloudflare detection** — All three endpoints call `checkIfCloudflare(host)` before connecting. Returns HTTP 403 with `isCloudflare: true` if the KDC hostname resolves to a Cloudflare IP. (KDCs are never behind Cloudflare in practice, but the check runs anyway.)

## Practical usage patterns

### AD domain controller discovery
```bash
# Probe a DC to confirm Kerberos is running and get supported etypes
curl -X POST https://portofcall.dev/api/kerberos/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.1","realm":"CORP.LOCAL"}'
```

### User enumeration (pentesting)
```bash
# Check if common admin accounts exist
curl -X POST https://portofcall.dev/api/kerberos/user-enum \
  -H 'Content-Type: application/json' \
  -d '{
    "host":"dc01.corp.local",
    "realm":"CORP.LOCAL",
    "usernames":["administrator","admin","svc_sql","svc_iis","krbtgt","guest"],
    "timeout":15000
  }'
```
Look for `asrepRoastable: true` — those accounts can be attacked offline without any credentials.

### SPN enumeration (Kerberoasting recon)
```bash
# Check for common service SPNs
curl -X POST https://portofcall.dev/api/kerberos/spn-check \
  -H 'Content-Type: application/json' \
  -d '{"host":"dc01.corp.local","realm":"CORP.LOCAL","spn":"MSSQLSvc/sql01.corp.local:1433"}'
```
SPNs registered to user accounts (not computer accounts) are Kerberoasting targets.

### Clock skew detection
```bash
# The stime field in KRB-ERROR reveals the KDC's clock
# Compare against your system time — Kerberos requires < 5 min skew
curl -s -X POST https://portofcall.dev/api/kerberos/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"dc01.corp.local","realm":"CORP.LOCAL"}' | jq '.response.serverTime'
```
