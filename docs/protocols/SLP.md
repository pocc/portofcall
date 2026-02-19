# SLP (Service Location Protocol) — Port 427

Implementation: `src/worker/slp.ts`
Routes: `src/worker/index.ts` lines 1507–1517

SLPv2 (RFC 2608) service discovery over TCP. Three endpoints covering the three query message types: discover service types (SrvTypeRqst), find services (SrvRqst), and get service attributes (AttrRqst). TCP unicast only — no multicast, no SrvReg, no DA advertisement.

---

## Endpoints

| # | Method | Path | Required fields | Description |
|---|--------|------|-----------------|-------------|
| 1 | POST | `/api/slp/types` | `host` | Discover available service types |
| 2 | POST | `/api/slp/find` | `host`, `serviceType` | Find services of a given type |
| 3 | POST | `/api/slp/attributes` | `host`, `url` | Get attributes of a specific service URL |

All three are POST-only (GET → 405). All three validate port (1–65535). All three perform Cloudflare detection before connecting.

---

### POST /api/slp/types

Sends SrvTypeRqst (function ID 9), expects SrvTypeRply (function ID 10). Returns a list of service type strings advertised by the SLP agent.

**Request:**

```json
{
  "host": "slp-server.example.com",
  "port": 427,
  "scope": "DEFAULT",
  "namingAuthority": "*",
  "language": "en",
  "timeout": 10000
}
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `host` | yes | — | SLP agent hostname or IP |
| `port` | no | `427` | Validated 1–65535 |
| `scope` | no | `"DEFAULT"` | SLP scope string |
| `namingAuthority` | no | `"*"` | `"*"` or `""` → 0xFFFF (all naming authorities per RFC 2608 §8.1) |
| `language` | no | `"en"` | RFC 1766 language tag in the SLP header |
| `timeout` | no | `10000` | ms; used for the readResponse inner timeout |

**Response:**

```json
{
  "success": true,
  "host": "slp-server.example.com",
  "port": 427,
  "version": 2,
  "xid": 42731,
  "languageTag": "en",
  "scope": "DEFAULT",
  "serviceTypes": ["service:printer:lpr", "service:http", "service:ftp"],
  "serviceTypeCount": 3,
  "connectTimeMs": 5,
  "totalTimeMs": 18
}
```

The `serviceTypes` array is parsed by splitting the comma-separated SrvTypeRply list and trimming whitespace. Empty entries are filtered out.

**curl:**

```bash
curl -s -X POST http://localhost:8787/api/slp/types \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.1"}' | jq
```

---

### POST /api/slp/find

Sends SrvRqst (function ID 1), expects SrvRply (function ID 2). Returns service URLs with lifetimes.

**Request:**

```json
{
  "host": "slp-server.example.com",
  "port": 427,
  "serviceType": "service:printer:lpr",
  "scope": "DEFAULT",
  "predicate": "",
  "language": "en",
  "timeout": 10000
}
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `host` | yes | — | SLP agent hostname or IP |
| `port` | no | `427` | |
| `serviceType` | yes | — | e.g. `"service:printer:lpr"`, `"service:http"` |
| `scope` | no | `"DEFAULT"` | |
| `predicate` | no | `""` | LDAP filter string per RFC 2608 §8.1 |
| `language` | no | `"en"` | |
| `timeout` | no | `10000` | |

**Response:**

```json
{
  "success": true,
  "host": "slp-server.example.com",
  "port": 427,
  "version": 2,
  "xid": 15287,
  "serviceType": "service:printer:lpr",
  "scope": "DEFAULT",
  "services": [
    { "url": "service:printer:lpr://192.168.1.100/queue1", "lifetime": 10800 },
    { "url": "service:printer:lpr://192.168.1.101/default", "lifetime": 3600 }
  ],
  "serviceCount": 2,
  "connectTimeMs": 4,
  "totalTimeMs": 22
}
```

Each service entry has a `url` (the SLP service URL) and a `lifetime` in seconds (how long the registration is valid).

**Predicate examples** (LDAP filter syntax):

```
(printer-name=HP*)                     — printers with names starting with "HP"
(&(color=true)(resolution>=600))       — color printers with ≥600 DPI
(location=building-a)                  — services in building-a
```

---

### POST /api/slp/attributes

Sends AttrRqst (function ID 6), expects AttrRply (function ID 7). Returns parsed key-value attributes and the raw attribute list string.

**Request:**

```json
{
  "host": "slp-server.example.com",
  "port": 427,
  "url": "service:printer:lpr://192.168.1.100/queue1",
  "scope": "DEFAULT",
  "tags": "",
  "language": "en",
  "timeout": 10000
}
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `host` | yes | — | |
| `port` | no | `427` | |
| `url` | yes | — | Full service URL to query attributes for |
| `scope` | no | `"DEFAULT"` | |
| `tags` | no | `""` | Comma-separated tag list to request; empty = all attributes |
| `language` | no | `"en"` | |
| `timeout` | no | `10000` | |

**Response:**

```json
{
  "success": true,
  "host": "slp-server.example.com",
  "port": 427,
  "version": 2,
  "xid": 50012,
  "serviceUrl": "service:printer:lpr://192.168.1.100/queue1",
  "scope": "DEFAULT",
  "attributes": {
    "printer-name": "HP LaserJet",
    "color": "true",
    "resolution": "600",
    "duplex": "true"
  },
  "attributeCount": 4,
  "rawAttributeList": "(printer-name=HP LaserJet),(color=true),(resolution=600),(duplex)",
  "connectTimeMs": 3,
  "totalTimeMs": 15
}
```

Both `attributes` (parsed key-value map) and `rawAttributeList` (unparsed string) are returned.

---

## Wire Protocol Details

### SLPv2 header (16 + langTag bytes)

```
Byte 0:     Version (always 2)
Byte 1:     Function-ID
Bytes 2-4:  Length (3 bytes BE, includes header)
Bytes 5-6:  Flags (O=Overflow, F=Fresh, R=Request Multicast)
Bytes 7-9:  Next Extension Offset (3 bytes, always 0 — no extensions used)
Bytes 10-11: XID (transaction ID)
Bytes 12-13: Language Tag Length (2 bytes BE)
Bytes 14+:  Language Tag (UTF-8)
```

All strings in the protocol use 2-byte big-endian length prefix followed by UTF-8 bytes (no null terminator, unlike AJP).

### Message types used

| Function ID | Name | Direction | Used? |
|-------------|------|-----------|-------|
| 1 | SrvRqst | Client → Server | Yes (`/find`) |
| 2 | SrvRply | Server → Client | Yes (parsed) |
| 3 | SrvReg | Client → DA | No |
| 4 | SrvDeReg | Client → DA | No |
| 5 | SrvAck | DA → Client | No |
| 6 | AttrRqst | Client → Server | Yes (`/attributes`) |
| 7 | AttrRply | Server → Client | Yes (parsed) |
| 8 | DAAdvert | DA → All | No |
| 9 | SrvTypeRqst | Client → Server | Yes (`/types`) |
| 10 | SrvTypeRply | Server → Client | Yes (parsed) |
| 11 | SAAdvert | SA → All | No |

### SrvRply URL entry format

```
[Reserved 1B][Lifetime 2B BE][URL-Length 2B BE][URL string][Auth-Count 1B][Auth blocks...]
```

Auth blocks: `[BSD 2B][Auth-Block-Length 2B][data...]`. The parser reads `blockLen` from offset+2 (the Auth-Block-Length) and skips `2 + blockLen` bytes — see auth block parsing note below.

### Error codes

| Code | Name |
|------|------|
| 0 | OK |
| 1 | LANGUAGE_NOT_SUPPORTED |
| 2 | PARSE_ERROR |
| 3 | INVALID_REGISTRATION |
| 4 | SCOPE_NOT_SUPPORTED |
| 5 | AUTHENTICATION_UNKNOWN |
| 6 | AUTHENTICATION_ABSENT |
| 7 | AUTHENTICATION_FAILED |
| 9 | VERSION_NOT_SUPPORTED |
| 10 | INTERNAL_ERROR |
| 11 | DA_BUSY |
| 12 | OPTION_NOT_UNDERSTOOD |
| 13 | INVALID_UPDATE |
| 15 | REFRESH_REJECTED |

Codes 8 and 14 are undefined in RFC 2608. Unlisted codes in responses appear as `code <N>`.

---

## Quirks and Limitations

### TCP unicast only

SLP's primary discovery mode is multicast (239.255.255.253:427). This implementation uses TCP unicast only, since Cloudflare Workers can only do TCP. You must specify the IP/hostname of an SLP agent or Directory Agent directly. Peer-to-peer multicast discovery is not possible.

### No registration or deregistration

Only the three query message types are implemented (SrvTypeRqst, SrvRqst, AttrRqst). SrvReg, SrvDeReg, and SrvAck are not implemented, so you cannot register or remove services. This is a read-only client.

### No SLP SPI / authentication

All requests send an empty SLP SPI (Security Parameters Index) string. The implementation cannot authenticate to SLP agents that require authentication. Auth blocks in SrvRply URL entries are skipped during parsing.

### Previous Responder List always empty

All three message types send an empty Previous Responder List. Per RFC 2608, this list is used in multicast to prevent duplicate responses from agents that already responded. Since this uses TCP unicast, the list is irrelevant — but it means the implementation cannot do iterative multicast convergence.

### No Overflow flag checking

The SLP header Overflow flag (bit 0x80 in the flags field, bytes 5-6) is parsed but never checked. If the server response was too large for a single message and the Overflow flag is set, the client has no indication that data was truncated.

### XID is random per request

Each endpoint generates a random XID: `Math.floor(Math.random() * 65536)`. This is fine for one-shot TCP queries but means you can't correlate requests across calls.

### readResponse timeout scope

The `readResponse` function creates a single timeout promise at its start. All subsequent reads race against this same timer. This means:
- If the first chunk takes 8s out of a 10s timeout, only 2s remain for all subsequent reads
- A slow response that arrives in many small chunks could time out partway through
- The timeout starts when readResponse is called, not when the socket was opened — so connect time is not counted against this timer

### readResponse timeout resolves to null (not reject)

When the read timeout expires, it resolves to `null` rather than rejecting. The code checks `if (!firstRead || ...)` which treats both null (timeout) and undefined (error) the same way, throwing "Connection closed before response". This is functionally correct but the error message is misleading for a timeout.

### Attribute list parsing is best-effort

The attribute list parser uses the regex `/,(?=\()|,(?=[^)]*$)/` to split on commas outside parentheses. SLP attributes use the format `(tag=value),(tag=value)` where values can contain commas inside parentheses. The regex handles simple cases but may misparse:
- Nested parentheses: `(desc=model (color, duplex))` — the inner comma would split
- Multi-valued attributes: `(lang=en,fr,de)` — comma-separated values within one tag may split
- Unparenthesized attributes: bare `tag=value` with commas

Boolean/keyword attributes (no `=` sign, e.g., `(duplex)`) are stored with value `"true"`.

Both the parsed `attributes` map and the `rawAttributeList` string are returned, so you can implement your own parser if needed.

### Auth block skip may be incorrect for certain servers

In `parseServiceReply`, auth blocks are skipped with:
```javascript
const blockLen = view.getUint16(offset + 2, false);
offset += 2 + blockLen;
```
This reads the Authentication Block Length from the 2nd 16-bit field (after the Block Structure Descriptor). If `blockLen` represents the total block length including the BSD, this over-reads by 2 bytes. If it represents just the auth data after the BSD, it under-reads by 2 bytes (missing the length field itself). In practice, most SLP deployments don't use authentication, so this code path rarely executes.

### Port validation present (unlike many other workers)

All three endpoints validate `port` in the 1-65535 range and return HTTP 400 for invalid values. This is stricter than many other protocol workers in this codebase.

### No connection reuse

Each API call creates a new TCP socket, sends one message, reads one response, and closes the socket. There is no session state or connection pooling. For discovering types → finding services → getting attributes, you make three separate connections.

### Flags always zero

Outgoing messages always set flags to `0x0000` (no Overflow, no Fresh, no Request Multicast). The `R` (Request Multicast) flag is irrelevant for TCP. The `F` (Fresh) flag is only used in SrvReg (not implemented).

---

## Per-Endpoint Comparison

| | `/types` | `/find` | `/attributes` |
|---|---|---|---|
| SLP function | SrvTypeRqst (9) | SrvRqst (1) | AttrRqst (6) |
| Expected reply | SrvTypeRply (10) | SrvRply (2) | AttrRply (7) |
| Required fields | `host` | `host`, `serviceType` | `host`, `url` |
| Default port | 427 | 427 | 427 |
| Default timeout | 10,000 ms | 10,000 ms | 10,000 ms |
| Default scope | `"DEFAULT"` | `"DEFAULT"` | `"DEFAULT"` |
| Port validation | yes (1-65535) | yes (1-65535) | yes (1-65535) |
| CF detection | yes | yes | yes |
| Method restriction | POST only (405) | POST only (405) | POST only (405) |
| Extra fields | `namingAuthority` | `predicate` | `tags` |

---

## curl Examples

```bash
# Discover all service types
curl -s -X POST http://localhost:8787/api/slp/types \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.1"}' | jq

# Find all printers
curl -s -X POST http://localhost:8787/api/slp/find \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.1","serviceType":"service:printer:lpr"}' | jq

# Find printers with LDAP predicate filter
curl -s -X POST http://localhost:8787/api/slp/find \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.1","serviceType":"service:printer:lpr","predicate":"(color=true)"}' | jq

# Get attributes for a specific service
curl -s -X POST http://localhost:8787/api/slp/attributes \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.1","url":"service:printer:lpr://192.168.1.100/queue1"}' | jq

# Use a non-default scope
curl -s -X POST http://localhost:8787/api/slp/types \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.1","scope":"engineering"}' | jq

# Query a specific naming authority
curl -s -X POST http://localhost:8787/api/slp/types \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.1","namingAuthority":"iana"}' | jq
```

## Local Testing

```bash
# Install OpenSLP
apt-get install openslp-server slptool

# Start SLP daemon
slpd

# Register test services
slptool register service:printer:lpr://192.168.1.100/queue1 "(printer-name=TestPrinter),(color=true),(resolution=600)"
slptool register service:http://192.168.1.200:8080 "(app-name=TestApp),(version=2.1)"

# Verify via slptool
slptool findsrvtypes         # → service:printer:lpr,service:http
slptool findsrvs service:printer:lpr  # → service:printer:lpr://192.168.1.100/queue1

# Query via Port of Call
curl -s -X POST http://localhost:8787/api/slp/types \
  -d '{"host":"localhost"}' | jq
curl -s -X POST http://localhost:8787/api/slp/find \
  -d '{"host":"localhost","serviceType":"service:printer:lpr"}' | jq
curl -s -X POST http://localhost:8787/api/slp/attributes \
  -d '{"host":"localhost","url":"service:printer:lpr://192.168.1.100/queue1"}' | jq
```

Docker alternative:

```bash
docker run -d --name openslp -p 427:427 openslp/openslp
```

---

## Common Service Type Strings

```
service:printer:lpr        — LPR printers
service:printer:ipp        — IPP printers
service:http               — HTTP servers
service:https              — HTTPS servers
service:ftp                — FTP servers
service:tftp               — TFTP servers
service:nfs                — NFS exports
service:smb                — SMB/CIFS shares
service:ssh                — SSH servers
service:directory-agent    — SLP Directory Agents
```
