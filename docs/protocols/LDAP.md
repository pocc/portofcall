# LDAP — Power User Reference

**Ports:** 389 (plaintext) · 636 (TLS via LDAPS endpoints)
**Protocol:** LDAP v3, RFC 4511
**Tests:** 13/13 ✅ Deployed
**Source:** `src/worker/ldap.ts`, `src/worker/ldaps.ts`

Two parallel endpoint families: `/api/ldap/*` (plain TCP, port 389) and `/api/ldaps/*` (TLS, port 636). Both expose identical request/response schemas.

---

## Endpoint Summary

| Endpoint | Purpose | LDAP operation |
|---|---|---|
| `GET\|POST /api/ldap/connect` | Bind probe | BindRequest → BindResponse |
| `POST /api/ldap/search` | Directory search | Bind → SearchRequest → entries → Unbind |
| `POST /api/ldap/add` | Create entry | Bind → AddRequest → AddResponse → Unbind |
| `POST /api/ldap/modify` | Modify entry attributes | Bind → ModifyRequest → ModifyResponse → Unbind |
| `POST /api/ldap/delete` | Delete entry | Bind → DelRequest → DelResponse → Unbind |
| `GET\|POST /api/ldaps/connect` | Same as above, TLS | — |
| `POST /api/ldaps/search` | — | — |
| `POST /api/ldaps/add` | — | — |
| `POST /api/ldaps/modify` | — | — |
| `POST /api/ldaps/delete` | — | — |

---

## `GET|POST /api/ldap/connect` — Bind probe

Sends BindRequest and reads BindResponse. Does not Unbind — the connection is closed immediately after.

**POST body / GET query params:**

| Field | Default | Notes |
|---|---|---|
| `host` | required | |
| `port` | `389` | |
| `bindDN` | `""` | Omit for anonymous bind |
| `password` | `""` | |
| `timeout` | `30000` | |

**Anonymous bind:** omit `bindDN` and `password`. Many servers permit anonymous bind for the rootDSE and public attributes.

**Success (200):**
```json
{
  "success": true,
  "message": "LDAP authenticated bind successful",
  "host": "ldap.example.com",
  "port": 389,
  "bindDN": "cn=admin,dc=example,dc=com",
  "resultCode": 0,
  "serverResponse": "Success"
}
```

**Bind failure (401):**
```json
{
  "success": false,
  "message": "LDAP bind failed",
  "resultCode": 49,
  "serverResponse": "Invalid credentials"
}
```

**Notes:**

- **`bindDN` field name (uppercase N):** This endpoint reads the field `bindDN` (capital N). All other endpoints (`/search`, `/add`, `/modify`, `/delete`) read `bindDn` (lowercase n). Sending `bindDn` to `/connect` silently falls through to anonymous bind. This is a source-level inconsistency — double-check casing when switching between endpoints.
- This endpoint uses a legacy single-`read()` implementation. If the BindResponse is split across multiple TCP segments (unusual but possible on high-latency connections), the response will be empty and the call fails with "Invalid LDAP response". All other endpoints (`/search`, `/add`, etc.) use a length-aware accumulator that does not have this issue.
- The legacy parser also assumes single-byte BER lengths in the BindResponse. This is correct for all standard BindResponse payloads — the diagnostic message would need to exceed 127 bytes to trigger long-form lengths.
- Cloudflare-protected hosts return HTTP 403 with `{ "isCloudflare": true }`.

---

## `POST /api/ldap/search` — Directory search

Binds, sends SearchRequest, reads all SearchResultEntry messages until SearchResultDone, then Unbinds.

```json
{
  "host": "ldap.example.com",
  "port": 389,
  "bindDn": "cn=admin,dc=example,dc=com",
  "password": "secret",
  "baseDn": "ou=users,dc=example,dc=com",
  "filter": "(objectClass=*)",
  "scope": 2,
  "attributes": ["cn", "mail", "memberOf"],
  "sizeLimit": 100,
  "timeout": 15000
}
```

| Field | Default | Notes |
|---|---|---|
| `bindDn` | `""` | Anonymous bind if omitted |
| `password` | `""` | |
| `baseDn` | required | Search root DN |
| `filter` | `(objectClass=*)` | See [Filter Limitations](#filter-limitations) |
| `scope` | `2` | 0=baseObject, 1=singleLevel, 2=wholeSubtree |
| `attributes` | `[]` | Empty = return all user attributes. `["1.1"]` = return no attributes (entry list only). |
| `sizeLimit` | `100` | Sent to server; server may apply a lower limit. |
| `timeout` | `15000` | In milliseconds. Converted to seconds (`Math.floor(timeout / 1000)`) before being sent as the LDAP SearchRequest `timeLimit` field. The server uses this as a hard query deadline on its side. |

**rootDSE bug:** `baseDn` is a required field and the implementation rejects an empty string `""` with HTTP 400 "baseDn is required" (the validation is `if (!baseDn)`). This means rootDSE enumeration via `/search` is currently broken — passing `"baseDn":""` returns HTTP 400, not a rootDSE entry. To probe server capabilities, use `/connect` (anonymous bind probe) or query a known naming context directly.

**Success (200):**
```json
{
  "success": true,
  "host": "ldap.example.com",
  "port": 389,
  "baseDn": "ou=users,dc=example,dc=com",
  "scope": 2,
  "entries": [
    {
      "dn": "cn=alice,ou=users,dc=example,dc=com",
      "attributes": [
        { "type": "cn", "values": ["alice"] },
        { "type": "mail", "values": ["alice@example.com"] },
        { "type": "memberOf", "values": ["cn=devs,ou=groups,dc=example,dc=com"] }
      ]
    }
  ],
  "resultCode": 0,
  "rtt": 18
}
```

**Notes:**

- Multi-valued attributes return all values in the `values` array.
- The maximum response size is **128 KB**. Searches returning large result sets are truncated at that boundary. The SearchResultDone scanner stops at the first `0x65` tag — if the cap is hit before that tag appears, `resultCode` will be `-1` and `message` will be `""` in the response (the uninitialized defaults from the parser). HTTP status is still 200.
- `derefAliases` is hardcoded to `neverDerefAliases` (0). Alias dereferencing cannot be changed.
- `typesOnly` is always `false` — values are always returned alongside types.

---

## `POST /api/ldap/add` — Create entry

```json
{
  "host": "ldap.example.com",
  "port": 389,
  "bindDn": "cn=admin,dc=example,dc=com",
  "password": "secret",
  "entry": {
    "dn": "cn=bob,ou=users,dc=example,dc=com",
    "attributes": {
      "objectClass": ["inetOrgPerson", "organizationalPerson", "person", "top"],
      "cn": "bob",
      "sn": "Smith",
      "mail": "bob@example.com",
      "userPassword": "{SSHA}..."
    }
  },
  "timeout": 10000
}
```

Required: `host`, `bindDn`, `entry.dn`. `password` defaults to `""`.

Attribute values can be a string (single-valued) or an array (multi-valued).

**Success (200):**
```json
{ "success": true, "host": "ldap.example.com", "port": 389, "dn": "cn=bob,...", "resultCode": 0, "message": "Success", "rtt": 12 }
```

**Error (500):**
```json
{ "success": false, "error": "Bind failed (code 49): Invalid credentials" }
```
or
```json
{ "success": false, "error": "Add failed" }
```

Note: a successful bind but failed AddResponse (e.g., `resultCode: 68` Entry Already Exists) returns HTTP 200 with `success: false` and the resultCode/message in the body.

---

## `POST /api/ldap/modify` — Modify entry attributes

```json
{
  "host": "ldap.example.com",
  "port": 389,
  "bindDn": "cn=admin,dc=example,dc=com",
  "password": "secret",
  "dn": "cn=bob,ou=users,dc=example,dc=com",
  "changes": [
    { "operation": "replace", "attribute": "mail", "values": ["bob.smith@example.com"] },
    { "operation": "add", "attribute": "telephoneNumber", "values": ["+1-555-0100"] },
    { "operation": "delete", "attribute": "description", "values": [] }
  ],
  "timeout": 10000
}
```

Required: `host`, `bindDn`, `dn`, `changes`.

**`operation` values:**

| Value | LDAP op code | Effect |
|---|---|---|
| `"add"` | 0 | Add values to attribute (error if already present) |
| `"replace"` | 2 | Replace all values; empty `values` array deletes the attribute |
| `"delete"` | 1 | Remove specific values; empty `values` array deletes entire attribute |

**To delete an entire attribute:** `{ "operation": "delete", "attribute": "description", "values": [] }`

**To clear and set a single-valued attribute:** `{ "operation": "replace", "attribute": "mail", "values": ["new@example.com"] }`

**Success (200):** `{ "success": true, "dn": "...", "resultCode": 0, "message": "Success", "rtt": 9 }`

---

## `POST /api/ldap/delete` — Delete entry

```json
{
  "host": "ldap.example.com",
  "port": 389,
  "bindDn": "cn=admin,dc=example,dc=com",
  "password": "secret",
  "dn": "cn=bob,ou=users,dc=example,dc=com",
  "timeout": 10000
}
```

Required: `host`, `bindDn`, `dn`. Only deletes leaf entries — entries with subordinates return `resultCode: 66` (Not Allowed On Non-leaf).

**Success (200):** `{ "success": true, "dn": "...", "resultCode": 0, "message": "Success", "rtt": 7 }`

---

## Filter Limitations

The filter encoder handles exactly two filter types:

| Pattern | BER tag | Example |
|---|---|---|
| `(attr=*)` | `0x87` ContextSpecific[7] — presence | `(objectClass=*)`, `(mail=*)` |
| `(attr=value)` | `0xA3` ContextSpecific[3] — equalityMatch | `(uid=alice)`, `(cn=Bob Smith)` |

**Anything else falls back to `(objectClass=*)`** — silently. This includes:

- AND filters: `(&(objectClass=person)(uid=alice))` → treated as `(objectClass=*)`
- OR filters: `(|(cn=alice)(cn=bob))` → treated as `(objectClass=*)`
- NOT filters: `(!(objectClass=computer))` → treated as `(objectClass=*)`
- Substring filters: `(cn=ali*)`, `(cn=*ice)`, `(cn=a*e)` → treated as `(objectClass=*)`
- ApproxMatch: `(cn~=alice)` → treated as `(objectClass=*)`
- Greater/less-equal: `(uidNumber>=1000)` → treated as `(objectClass=*)`

**Workaround for complex filters:** Use the single-level scope (`scope: 1`) with a precise `baseDn` and narrow the equality filter to a specific attribute. For multi-condition queries, make multiple calls and intersect results client-side.

---

## LDAP Result Codes

| Code | Constant | Meaning |
|---|---|---|
| 0 | `success` | |
| 1 | `operationsError` | |
| 2 | `protocolError` | |
| 7 | `authMethodNotSupported` | Server doesn't support simple auth (requires SASL) |
| 8 | `strongerAuthRequired` | TLS or SASL required; try `/api/ldaps/*` |
| 16 | `noSuchAttribute` | Attribute doesn't exist on entry |
| 17 | `undefinedAttributeType` | Schema doesn't define this attribute |
| 20 | `attributeOrValueExists` | Value already present on attribute |
| 21 | `invalidAttributeSyntax` | Value doesn't match attribute syntax |
| 32 | `noSuchObject` | DN doesn't exist |
| 34 | `invalidDNSyntax` | Malformed DN |
| 48 | `inappropriateAuthentication` | Anonymous bind not allowed |
| 49 | `invalidCredentials` | Wrong password |
| 50 | `insufficientAccessRights` | Bind DN lacks permission |
| 53 | `unwillingToPerform` | Server-side policy refusal |
| 64 | `namingViolation` | RDN doesn't match mandatory naming attribute |
| 65 | `objectClassViolation` | Missing required attribute for objectClass |
| 66 | `notAllowedOnNonLeaf` | Cannot delete a non-leaf entry |
| 68 | `entryAlreadyExists` | DN already in directory |
| 69 | `objectClassModsProhibited` | Cannot modify objectClass attribute |

---

## BER/ASN.1 Wire Format

LDAP messages are BER-encoded with this structure:

```
SEQUENCE {
  messageID   INTEGER,
  protocolOp  CHOICE { BindRequest [APPLICATION 0], BindResponse [APPLICATION 1], ... },
  controls    [0] Controls OPTIONAL
}
```

Application tags used by the implementation:

| Hex | Application tag | PDU |
|---|---|---|
| `0x60` | [0] | BindRequest |
| `0x61` | [1] | BindResponse |
| `0x63` | [3] | SearchRequest |
| `0x64` | [4] | SearchResultEntry |
| `0x65` | [5] | SearchResultDone |
| `0x66` | [6] | ModifyRequest |
| `0x67` | [7] | ModifyResponse |
| `0x68` | [8] | AddRequest |
| `0x69` | [9] | AddResponse |
| `0x4a` | [10] primitive | DelRequest (contains DN bytes directly) |
| `0x6b` | [11] | DelResponse |
| `0x42` | [2] primitive | UnbindRequest (0 length) |

The simple authentication credential in BindRequest is `[0] CONTEXT-SPECIFIC PRIMITIVE` (`0x80`).

Filter tags for reference (context-specific):
- `0x87` presence
- `0xA3` equalityMatch
- `0xA0` and, `0xA1` or, `0xA2` not (not implemented)
- `0xA4` substrings (not implemented)

---

## Known Limitations

**`bindDN`/`bindDn` casing inconsistency:** `/connect` reads the bind DN from the field `bindDN` (uppercase N). Every other endpoint reads `bindDn` (lowercase n). Sending the wrong casing silently falls back to anonymous bind — no error is returned.

**rootDSE search broken:** `/search` rejects `baseDn: ""` with HTTP 400 because the validation uses `if (!baseDn)`, which is truthy for an empty string. There is no workaround via the API — rootDSE enumeration is unavailable until this is fixed.

**Filter:** Only presence (`attr=*`) and equality (`attr=value`) filters are supported. All other filter expressions fall back to `(objectClass=*)` without error or warning. See [Filter Limitations](#filter-limitations).

**No SASL:** Only simple (password) authentication is implemented. SASL mechanisms (GSSAPI/Kerberos, DIGEST-MD5, EXTERNAL) are not supported. Many Active Directory environments require Kerberos — use `/api/ldaps/connect` which at least provides TLS transport.

**No STARTTLS:** The plaintext endpoints (`/api/ldap/*`) do not upgrade to TLS mid-connection. Use `/api/ldaps/*` for TLS from the first byte.

**No paging:** The `Simple Paged Results` control (RFC 2696) is not sent. Servers enforcing a hard `sizeLimit` (common on AD: 1000 entries) will truncate results. Increase `sizeLimit` up to the server's administrative limit and split searches using more specific base DNs.

**No referral chasing:** If the server returns a referral (`resultCode: 10`), it is treated as an error string, not followed.

**No controls:** LDAP controls (`[0] Controls` in the message envelope) are not supported. This includes sort control, VLV, server-side sort, and persistent search.

**`/connect` single-read bind:** The bind probe uses `reader.read()` once. On split TCP delivery, the bind may fail spuriously. Use `/api/ldap/search` with `sizeLimit: 0` as a more robust connectivity test.

**128 KB response cap:** `readLDAPData` and `readLDAPSearchData` both cap at 131,072 bytes. Searches returning more data are truncated mid-stream. If the cap is hit before SearchResultDone (`0x65`) is seen, the response will have `resultCode: -1` and `message: ""` with HTTP 200 — not an error response.

**Binary attribute values:** `TextDecoder` is used to decode all attribute values. Binary attributes (`userCertificate`, `jpegPhoto`, `objectGUID`, `objectSid`) will be corrupted. Request only text-safe attributes in `attributes` when probing AD/OpenLDAP.

---

## curl Examples

```bash
# Anonymous bind probe
curl -s -X POST https://portofcall.ross.gg/api/ldap/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"ldap.example.com","port":389}' | jq .

# Authenticated bind probe
curl -s -X POST https://portofcall.ross.gg/api/ldap/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"ldap.example.com","bindDN":"cn=admin,dc=example,dc=com","password":"secret"}' | jq .resultCode

# Enumerate rootDSE — NOTE: baseDn:"" returns HTTP 400 (bug: !baseDn rejects empty string)
# Workaround: use /connect for a bind probe, or query a known naming context directly.
# The rootDSE search below will NOT work until the baseDn validation is fixed:
# curl -s -X POST https://portofcall.ross.gg/api/ldap/search \
#   -H 'Content-Type: application/json' \
#   -d '{"host":"ldap.example.com","baseDn":"","scope":0,"filter":"(objectClass=*)","attributes":["namingContexts","supportedSASLMechanisms","supportedLDAPVersion","vendorName","supportedControl"]}' \
#   | jq '.entries[0].attributes'

# List top-level OUs (singleLevel scope)
curl -s -X POST https://portofcall.ross.gg/api/ldap/search \
  -H 'Content-Type: application/json' \
  -d '{"host":"ldap.example.com","bindDn":"cn=admin,dc=example,dc=com","password":"secret","baseDn":"dc=example,dc=com","scope":1,"filter":"(objectClass=organizationalUnit)","attributes":["ou","description"]}' \
  | jq '[.entries[].dn]'

# Find a specific user by uid
curl -s -X POST https://portofcall.ross.gg/api/ldap/search \
  -H 'Content-Type: application/json' \
  -d '{"host":"ldap.example.com","bindDn":"cn=admin,dc=example,dc=com","password":"secret","baseDn":"ou=users,dc=example,dc=com","scope":2,"filter":"(uid=alice)","attributes":["cn","mail","memberOf","uidNumber"]}' \
  | jq '.entries[0]'

# Check group membership (presence filter)
curl -s -X POST https://portofcall.ross.gg/api/ldap/search \
  -H 'Content-Type: application/json' \
  -d '{"host":"ldap.example.com","bindDn":"cn=admin,dc=example,dc=com","password":"secret","baseDn":"cn=devs,ou=groups,dc=example,dc=com","scope":0,"filter":"(member=*)","attributes":["member","cn"]}' \
  | jq '.entries[0].attributes'

# Create a user
curl -s -X POST https://portofcall.ross.gg/api/ldap/add \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "ldap.example.com",
    "bindDn": "cn=admin,dc=example,dc=com",
    "password": "secret",
    "entry": {
      "dn": "uid=newuser,ou=users,dc=example,dc=com",
      "attributes": {
        "objectClass": ["inetOrgPerson", "posixAccount", "shadowAccount"],
        "uid": "newuser",
        "cn": "New User",
        "sn": "User",
        "mail": "newuser@example.com",
        "uidNumber": "10001",
        "gidNumber": "10000",
        "homeDirectory": "/home/newuser"
      }
    }
  }' | jq .

# Reset password
curl -s -X POST https://portofcall.ross.gg/api/ldap/modify \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "ldap.example.com",
    "bindDn": "cn=admin,dc=example,dc=com",
    "password": "secret",
    "dn": "uid=newuser,ou=users,dc=example,dc=com",
    "changes": [
      { "operation": "replace", "attribute": "userPassword", "values": ["{SSHA}newhashedpassword"] }
    ]
  }' | jq .

# Add to group (add member value)
curl -s -X POST https://portofcall.ross.gg/api/ldap/modify \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "ldap.example.com",
    "bindDn": "cn=admin,dc=example,dc=com",
    "password": "secret",
    "dn": "cn=devs,ou=groups,dc=example,dc=com",
    "changes": [
      { "operation": "add", "attribute": "member", "values": ["uid=newuser,ou=users,dc=example,dc=com"] }
    ]
  }' | jq .

# Delete a user
curl -s -X POST https://portofcall.ross.gg/api/ldap/delete \
  -H 'Content-Type: application/json' \
  -d '{"host":"ldap.example.com","bindDn":"cn=admin,dc=example,dc=com","password":"secret","dn":"uid=newuser,ou=users,dc=example,dc=com"}' | jq .

# TLS (LDAPS) — same shape, different endpoint prefix
curl -s -X POST https://portofcall.ross.gg/api/ldaps/search \
  -H 'Content-Type: application/json' \
  -d '{"host":"ldap.example.com","port":636,"bindDn":"cn=admin,dc=example,dc=com","password":"secret","baseDn":"dc=example,dc=com","scope":1,"filter":"(objectClass=*)","attributes":["ou"]}' \
  | jq '[.entries[].dn]'
```

---

## Active Directory Notes

AD-specific quirks when using these endpoints against a Windows DC:

- **Port:** AD LDAP is on port 389; AD LDAPS (with TLS cert) is on port 636. Use `/api/ldaps/*` for 636.
- **Bind DN format:** AD accepts either `user@domain.com` (UPN) or `DOMAIN\user` (SAM) or the full `cn=user,cn=Users,dc=domain,dc=com` distinguished name.
- **RootDSE attributes:** `defaultNamingContext` gives the base DN; `configurationNamingContext`, `schemaNamingContext`, `rootDomainNamingContext` give other partitions.
- **`objectGUID` and `objectSid`:** Binary attributes — requesting them will return corrupted values. Exclude from `attributes`.
- **`memberOf`:** Multi-valued, returns DNs. Requesting it with scope 2 and `(uid=alice)` equality gives group membership for a specific user.
- **AD sizeLimit:** AD enforces a 1000-entry hard limit per search. Use `sizeLimit: 1000` and narrow the baseDn or scope to stay within it.
- **Anonymous bind on AD:** Disabled by default. Use authenticated bind.
- **SASL/Kerberos:** Not supported. Simple bind over LDAPS is the only option here.

---

## Testing Locally

```bash
# Start OpenLDAP with slapd
docker run -d \
  --name openldap \
  -p 389:389 \
  -e LDAP_ORGANISATION="Example Corp" \
  -e LDAP_DOMAIN="example.com" \
  -e LDAP_ADMIN_PASSWORD="secret" \
  osixia/openldap:1.5.0

# Probe
curl -s -X POST https://portofcall.ross.gg/api/ldap/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"YOUR_HOST","port":389,"bindDN":"cn=admin,dc=example,dc=com","password":"secret"}' | jq .

# Read rootDSE — NOTE: baseDn:"" returns HTTP 400 (validation bug, see rootDSE note above)
# Use /connect for a bind probe instead:
curl -s -X POST https://portofcall.ross.gg/api/ldap/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"YOUR_HOST","port":389}' | jq .
```

---

## Resources

- [RFC 4511 — LDAP: The Protocol](https://www.rfc-editor.org/rfc/rfc4511)
- [RFC 4512 — LDAP: Directory Information Models](https://www.rfc-editor.org/rfc/rfc4512)
- [RFC 4519 — LDAP: Schema for User Applications](https://www.rfc-editor.org/rfc/rfc4519)
- [LDAP Result Codes](https://ldap.com/ldap-result-code-reference/)
- [AD LDAP attributes reference](https://learn.microsoft.com/en-us/windows/win32/adschema/attributes-all)
