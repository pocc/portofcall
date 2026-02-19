# LDAPS — Power User Reference

**Port:** 636 (IANA assigned, RFC 4513 §5 / RFC 8314 §3.3)
**Protocol:** LDAP v3 over TLS — RFC 4511 (LDAP), RFC 4513 (Auth/Security), RFC 8314 (implicit TLS)
**Source:** `src/worker/ldaps.ts`
**Related:** `docs/protocols/LDAP.md`, `src/worker/ldap.ts`

---

## What LDAPS Is (and Is Not)

LDAPS is **not** a different protocol — it is LDAP wrapped in a TLS session. The BER/ASN.1 wire encoding of every operation (Bind, Search, Add, Modify, Delete, Unbind) is identical to plaintext LDAP. The only differences are:

1. The client opens a TCP connection to port 636 instead of 389.
2. Immediately after TCP handshake, a TLS handshake occurs — no plaintext bytes are exchanged first.
3. All subsequent LDAP PDUs flow inside the encrypted TLS record layer.

This is **distinct from STARTTLS** (RFC 4511 §4.14 / RFC 4513 §3), where the client connects on port 389, sends a plaintext `ExtendedRequest` with OID `1.3.6.1.4.1.1466.20037`, and upgrades to TLS mid-connection. This implementation does not support STARTTLS; it is not needed for standard LDAPS (port 636).

### Cloudflare Workers Implementation

Cloudflare Workers exposes raw TLS sockets via:

```typescript
import { connect } from 'cloudflare:sockets';
const socket = connect(`${host}:${port}`, { secureTransport: 'on', allowHalfOpen: false });
await socket.opened;
```

The `secureTransport: 'on'` flag causes Cloudflare to perform the TLS handshake before handing the application its readable/writable streams. The application never sees TLS record framing — it reads and writes plaintext LDAP PDUs as if TLS were transparent.

---

## Wire Format

LDAP messages are ASN.1 structures encoded with BER (Basic Encoding Rules), defined in RFC 4511 Appendix B. Every message follows this outer envelope:

```
LDAPMessage ::= SEQUENCE {
     messageID       MessageID,       -- INTEGER (1..2147483647)
     protocolOp      CHOICE { ... },  -- tag depends on operation
     controls        [0] Controls OPTIONAL
}
```

BER encoding:
```
30 <length> <messageID INTEGER> <protocolOp> [<controls A0 ...>]
```

**Length encoding (BER definite-length):**
- 0–127 bytes: single byte `0x00`–`0x7F`
- 128+ bytes: `0x80 | numBytes` followed by numBytes of big-endian length

All BER tags used in LDAP:

| Tag | Type |
|-----|------|
| `0x02` | INTEGER |
| `0x04` | OCTET STRING |
| `0x0A` | ENUMERATED (resultCode, scope, opCode) |
| `0x01` | BOOLEAN |
| `0x30` | SEQUENCE (constructed) |
| `0x31` | SET (constructed, attribute values) |
| `0x60` | APPLICATION 0 — BindRequest |
| `0x61` | APPLICATION 1 — BindResponse |
| `0x42` | APPLICATION 2 — UnbindRequest (primitive, empty body) |
| `0x63` | APPLICATION 3 — SearchRequest |
| `0x64` | APPLICATION 4 — SearchResultEntry |
| `0x65` | APPLICATION 5 — SearchResultDone |
| `0x66` | APPLICATION 6 — ModifyRequest |
| `0x67` | APPLICATION 7 — ModifyResponse |
| `0x68` | APPLICATION 8 — AddRequest |
| `0x69` | APPLICATION 9 — AddResponse |
| `0x4A` | APPLICATION 10 — DelRequest (primitive) |
| `0x6B` | APPLICATION 11 — DelResponse |
| `0x80` | Context [0] IMPLICIT — simple auth password in BindRequest |
| `0x87` | Context [7] PRIMITIVE — presence filter |
| `0xA0` | Context [0] CONSTRUCTED — Controls wrapper |
| `0xA3` | Context [3] CONSTRUCTED — equality filter |

---

## Endpoints

| Endpoint | Operation |
|----------|-----------|
| `GET|POST /api/ldaps/connect` | BindRequest + BindResponse over TLS |
| `POST /api/ldaps/search` | Bind → SearchRequest → entries → Unbind over TLS |
| `POST /api/ldaps/add` | Bind → AddRequest → AddResponse → Unbind over TLS |
| `POST /api/ldaps/modify` | Bind → ModifyRequest → ModifyResponse → Unbind over TLS |
| `POST /api/ldaps/delete` | Bind → DelRequest → DelResponse → Unbind over TLS |
| `POST /api/ldaps/paged-search` | RFC 2696 paged search with cookie over TLS |

All endpoints include `"tls": true` in their JSON response, which the LDAP plaintext equivalents omit.

---

## `GET|POST /api/ldaps/connect` — TLS Bind Probe

Connects on port 636, completes TLS handshake, sends BindRequest, reads BindResponse. Sends UnbindRequest (only on successful bind) and closes.

**POST body / GET query params:**

| Field | Default | Notes |
|-------|---------|-------|
| `host` | required | |
| `port` | `636` | |
| `bindDN` or `bindDn` | `""` | Both casings accepted |
| `password` | `""` | |
| `timeout` | `30000` | Milliseconds; governs both read timeout and outer race |

**Success (200):**
```json
{
  "success": true,
  "host": "ldap.example.com",
  "port": 636,
  "protocol": "LDAPS",
  "tls": true,
  "rtt": 42,
  "bindDN": "cn=admin,dc=example,dc=com",
  "bindType": "authenticated",
  "resultCode": 0,
  "serverResponse": "Success",
  "note": "LDAPS authenticated bind successful over TLS"
}
```

**Bind failure (401):**
```json
{
  "success": false,
  "host": "ldap.example.com",
  "port": 636,
  "protocol": "LDAPS",
  "tls": true,
  "rtt": 38,
  "bindDN": "cn=admin,dc=example,dc=com",
  "bindType": "authenticated",
  "resultCode": 49,
  "serverResponse": "Invalid credentials",
  "note": "LDAPS authenticated bind failed: Invalid credentials"
}
```

**Notes:**

- `bindDN` (capital N) is canonical; `bindDn` is also accepted and normalized internally via `resolveBindDN()`.
- When bind fails (resultCode ≠ 0), the server may close the TLS connection immediately. UnbindRequest is **not** sent in this case — sending a write on a closed TLS session would throw and mask the actual error details.
- The `rtt` field includes TLS handshake time (typically 10–50 ms on LAN, 100–300 ms on WAN).

---

## `POST /api/ldaps/search` — TLS Directory Search

**Request body:**

| Field | Default | Notes |
|-------|---------|-------|
| `host` | required | |
| `port` | `636` | |
| `bindDN` or `bindDn` | `""` | Omit for anonymous |
| `password` | `""` | |
| `baseDN` or `baseDn` | required | |
| `filter` | `"(objectClass=*)"` | See filter support below |
| `scope` | `2` | 0=baseObject, 1=singleLevel, 2=wholeSubtree |
| `attributes` | `[]` | Empty = return all user attributes |
| `sizeLimit` | `100` | Server may enforce a lower cap |
| `timeout` | `30000` | |

**Success (200):**
```json
{
  "success": true,
  "host": "ldap.example.com",
  "port": 636,
  "tls": true,
  "baseDN": "dc=example,dc=com",
  "scope": 2,
  "filter": "(objectClass=person)",
  "entries": [
    {
      "dn": "cn=Alice,dc=example,dc=com",
      "attributes": [
        { "type": "cn", "values": ["Alice"] },
        { "type": "mail", "values": ["alice@example.com"] }
      ]
    }
  ],
  "entryCount": 1,
  "resultCode": 0,
  "rtt": 87
}
```

**Filter support:**
- Presence: `(attr=*)` — encoded as Context [7] tag `0x87`
- Equality: `(attr=value)` — encoded as Context [3] tag `0xA3`
- Anything else falls back to `(objectClass=*)` presence

Compound filters (`& | ! ...`), substring filters, and extensible match are not supported.

---

## `POST /api/ldaps/paged-search` — RFC 2696 Paged Search over TLS

Implements the Simple Paged Results Control (OID `1.2.840.113556.1.4.319`). Required for Active Directory searches that return more than 1000 entries — AD enforces its own server-side size limit regardless of the `sizeLimit` field in the SearchRequest.

**Request body:**

| Field | Default | Notes |
|-------|---------|-------|
| `host` | required | |
| `port` | `636` | |
| `bindDN` or `bindDn` | `""` | |
| `password` | `""` | |
| `baseDN` or `baseDn` | required | |
| `filter` | `"(objectClass=*)"` | |
| `scope` | `2` | |
| `attributes` | `[]` | |
| `pageSize` | `100` | Entries per page |
| `cookie` | `""` | Empty for first page; hex string from prior response |
| `timeout` | `30000` | |

**Success response:**
```json
{
  "success": true,
  "entries": ["..."],
  "entryCount": 100,
  "resultCode": 0,
  "cookie": "3a7f1b9e",
  "hasMore": true,
  "rtt": 142
}
```

When `hasMore` is `false`, `cookie` will be an empty string and there are no further pages.

**Paged search loop (shell):**
```bash
cookie=""
while true; do
  resp=$(curl -s -X POST https://worker.example.com/api/ldaps/paged-search \
    -H 'Content-Type: application/json' \
    -d "{\"host\":\"ad.corp.local\",\"baseDN\":\"DC=corp,DC=local\",\"pageSize\":500,\"cookie\":\"$cookie\"}")
  echo "$resp" | jq '.entries'
  cookie=$(echo "$resp" | jq -r '.cookie')
  hasMore=$(echo "$resp" | jq -r '.hasMore')
  [ "$hasMore" = "false" ] && break
done
```

**Control wire format (RFC 2696):**
```
Controls [0] CONSTRUCTED:
  Control SEQUENCE:
    controlType: "1.2.840.113556.1.4.319"  (OCTET STRING)
    controlValue: OCTET STRING containing:
      SEQUENCE:
        size    INTEGER       -- pageSize requested
        cookie  OCTET STRING  -- empty on first page
```

**Note on sizeLimit:** This handler sends `sizeLimit=0` (server decides). Setting a non-zero `sizeLimit` while using paged results can cause servers to return `sizeLimitExceeded` (code 4) on pages after the first.

---

## `POST /api/ldaps/add` — TLS Add Entry

```json
{
  "host": "ldap.example.com",
  "bindDN": "cn=admin,dc=example,dc=com",
  "password": "secret",
  "entry": {
    "dn": "cn=bob,ou=people,dc=example,dc=com",
    "attributes": {
      "objectClass": ["top", "person", "organizationalPerson", "inetOrgPerson"],
      "cn": "bob",
      "sn": "Smith",
      "mail": "bob@example.com"
    }
  }
}
```

AddRequest (APPLICATION 8 = `0x68`) encodes `entry.dn` as an OCTET STRING followed by a SEQUENCE OF attribute SEQUENCE items. Each item contains the attribute type as OCTET STRING and a SET OF OCTET STRING values.

---

## `POST /api/ldaps/modify` — TLS Modify Entry

```json
{
  "host": "ldap.example.com",
  "bindDN": "cn=admin,dc=example,dc=com",
  "password": "secret",
  "dn": "cn=bob,ou=people,dc=example,dc=com",
  "changes": [
    { "operation": "replace", "attribute": "mail",            "values": ["bob2@example.com"] },
    { "operation": "add",     "attribute": "telephoneNumber", "values": ["+1-555-0100"]      },
    { "operation": "delete",  "attribute": "description",     "values": []                   }
  ]
}
```

**ModifyRequest operation codes (RFC 4511 §4.6):**

| `operation` | ENUMERATED value |
|--------------|-----------------|
| `add`      | 0 |
| `delete`   | 1 |
| `replace`  | 2 |

Note the non-intuitive ordering: `delete=1`, `replace=2`.

---

## `POST /api/ldaps/delete` — TLS Delete Entry

```json
{
  "host": "ldap.example.com",
  "bindDN": "cn=admin,dc=example,dc=com",
  "password": "secret",
  "dn": "cn=bob,ou=people,dc=example,dc=com"
}
```

DelRequest (APPLICATION 10 = `0x4A`) is **primitive** — the content is the raw UTF-8 bytes of the DN, not wrapped in an OCTET STRING TLV. This is unlike Add and Modify where the DN is an explicit OCTET STRING.

---

## LDAP Result Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Operations error |
| 2 | Protocol error |
| 3 | Time limit exceeded |
| 4 | Size limit exceeded |
| 7 | Auth method not supported |
| 8 | Stronger auth required |
| 16 | No such attribute |
| 17 | Undefined attribute type |
| 20 | Attribute or value exists |
| 21 | Invalid attribute syntax |
| 32 | No such object |
| 34 | Invalid DN syntax |
| 48 | Inappropriate authentication |
| 49 | Invalid credentials |
| 50 | Insufficient access rights |
| 53 | Unwilling to perform |
| 64 | Naming violation |
| 65 | Object class violation |
| 68 | Entry already exists |
| 69 | Object class mods prohibited |

---

## TLS Specifics and Edge Cases

### Certificate Verification

Cloudflare Workers validates the server TLS certificate against the system trust store. Self-signed certificates will cause `connect()` or `socket.opened` to throw. There is no option to disable certificate validation from the worker — this is a platform-level constraint.

To use LDAPS against a server with a self-signed cert (common in test environments), the server must be fronted by a TLS-terminating proxy with a valid public certificate, or the cert must be enrolled in a public CA.

### TLS Version

Cloudflare Workers negotiates TLS 1.2 or 1.3. Legacy servers that only support TLS 1.0 or SSL 3.0 will fail to connect. The negotiated version is not exposed to the application.

### Active Directory Specifics

AD enforces a server-side size limit of 1000 entries per SearchRequest by default (configurable via `MaxPageSize` on the DC). Use `/api/ldaps/paged-search` for large directories.

AD typically requires authenticated bind for write operations. Anonymous bind succeeds (code 0) but grants access only to the rootDSE and a limited set of attributes.

### OpenLDAP Specifics

OpenLDAP with `olcSecurity: ssf=128` enforces a minimum TLS cipher security factor. Connections failing with code 8 (Stronger auth required) usually indicate the negotiated cipher is below the configured threshold, not an authentication problem.

### ReadLDAPSearchData Termination

The search reader accumulates chunks until it finds a message whose protocol op tag is `0x65` (SearchResultDone). It scans each complete LDAP SEQUENCE, skips the messageID INTEGER, and checks the next tag byte. If SearchResultDone arrives split across two TCP reads, the scanner correctly waits for the full outer SEQUENCE length before deciding.

The maximum accumulation buffer is 131,072 bytes (128 KiB). Searches returning more raw BER data will be silently truncated and may parse incompletely.

---

## ldapsearch Examples

Anonymous bind and rootDSE probe:
```bash
ldapsearch -H ldaps://ldap.example.com -x -b "" -s base "(objectClass=*)"
```

Authenticated bind and subtree search:
```bash
ldapsearch -H ldaps://ldap.example.com \
  -D "cn=admin,dc=example,dc=com" -w "secret" \
  -b "dc=example,dc=com" -s sub \
  "(objectClass=person)" cn mail
```

Disable cert verification (test environments only — never in production):
```bash
LDAPTLS_REQCERT=never ldapsearch -H ldaps://ldap.example.com -x -b "" -s base
```

Paged search (500 per page):
```bash
ldapsearch -H ldaps://ldap.example.com \
  -D "cn=admin,dc=example,dc=com" -w "secret" \
  -b "dc=example,dc=com" -s sub \
  -E pr=500/noprompt \
  "(objectClass=*)" dn
```

---

## curl Examples Against This API

Anonymous bind probe (GET):
```bash
curl "https://your-worker.example.com/api/ldaps/connect?host=ldap.example.com"
```

Authenticated bind probe (POST):
```bash
curl -s -X POST https://your-worker.example.com/api/ldaps/connect \
  -H "Content-Type: application/json" \
  -d '{"host":"ldap.example.com","bindDN":"cn=admin,dc=example,dc=com","password":"secret"}'
```

Search for persons:
```bash
curl -s -X POST https://your-worker.example.com/api/ldaps/search \
  -H "Content-Type: application/json" \
  -d '{
    "host": "ldap.example.com",
    "bindDN": "cn=admin,dc=example,dc=com",
    "password": "secret",
    "baseDN": "dc=example,dc=com",
    "filter": "(objectClass=person)",
    "scope": 2,
    "attributes": ["cn", "mail", "uid"],
    "sizeLimit": 50
  }'
```

First page of paged search (Active Directory):
```bash
curl -s -X POST https://your-worker.example.com/api/ldaps/paged-search \
  -H "Content-Type: application/json" \
  -d '{
    "host": "ad.corp.local",
    "bindDN": "CN=svcacct,OU=ServiceAccounts,DC=corp,DC=local",
    "password": "secret",
    "baseDN": "DC=corp,DC=local",
    "filter": "(objectClass=user)",
    "pageSize": 500
  }'
```

Add an entry:
```bash
curl -s -X POST https://your-worker.example.com/api/ldaps/add \
  -H "Content-Type: application/json" \
  -d '{
    "host": "ldap.example.com",
    "bindDN": "cn=admin,dc=example,dc=com",
    "password": "secret",
    "entry": {
      "dn": "cn=alice,ou=people,dc=example,dc=com",
      "attributes": {
        "objectClass": ["top","person","organizationalPerson","inetOrgPerson"],
        "cn": "alice",
        "sn": "Wonderland",
        "uid": "alice",
        "userPassword": "alicepw"
      }
    }
  }'
```

---

## Differences from Plaintext LDAP Endpoints

| Aspect | `/api/ldap/*` (port 389) | `/api/ldaps/*` (port 636) |
|--------|---------------------------|------------------------------|
| TLS | No | Yes (`secureTransport: 'on'`) |
| Default port | 389 | 636 |
| `tls` field in response | Absent | `true` |
| `protocol` field in `/connect` | Absent | `"LDAPS"` |
| STARTTLS | Not supported | Not needed |
| Certificate validation | N/A | Enforced by Workers platform |
| Self-signed certs | N/A | Will fail (no override available) |
| BER wire format | Identical | Identical |
| `rtt` measurement | TCP only | TCP + TLS handshake |
| Paged search | Yes | Yes |

---

## Known Limitations

1. **Filter complexity:** Only presence (`attr=*`) and equality (`attr=value`) filters are supported. Compound, substring, and extensible filters fall back to `(objectClass=*)`.

2. **Certificate errors:** TLS certificate validation cannot be disabled from the Worker. Self-signed certs require a TLS-terminating proxy with a public cert.

3. **SASL authentication:** Only simple bind (plaintext password in context tag `[0]`) is implemented. GSSAPI/Kerberos, DIGEST-MD5, and SCRAM are not supported.

4. **Binary attribute values:** Values are decoded as UTF-8 strings. Binary attributes (`objectSid`, `objectGUID`, `userCertificate`, `jpegPhoto`) will decode incorrectly; no base64 fallback is applied.

5. **Referrals:** SearchResultReference messages (tag `0x73`) are silently skipped. Partitioned directory referrals are not followed.

6. **MaxBytes cap:** The search accumulator caps at 131,072 bytes. Large result sets may be silently truncated without error.

7. **Fixed message IDs:** Each connection uses message IDs 1 (Bind), 2 (operation), 3 (Unbind). Pipelining multiple operations per connection is not supported.

8. **Intermediate responses:** RFC 4511 §4.13 IntermediateResponse messages are not handled.
