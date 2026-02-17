# WHOIS — Power User Reference

**Port:** 43/tcp (RFC 3912)
**Tests:** deployed
**Source:** `src/worker/whois.ts`

Two endpoints. No persistent state. Both accept a JSON body, connect to the appropriate WHOIS server on port 43, stream the response up to 200 KB, and return the raw text plus extracted structured fields.

---

## Endpoints

### `POST /api/whois/lookup` — Domain WHOIS

Queries the registry WHOIS server for a domain, then optionally follows the referral to the registrar's WHOIS server for full registrant data.

**Request (JSON body):**

| Field | Default | Notes |
|---|---|---|
| `domain` | — | ✅ Required; e.g. `"google.com"` |
| `server` | auto-routed by TLD | Override the WHOIS server hostname |
| `port` | — | Accepted in body but **never used** — always connects on port 43 |
| `timeout` | `10000` | Wall-clock timeout per query in ms |
| `followReferral` | `true` | Follow `Registrar WHOIS Server:` / `Refer:` line to the registrar |

**Success (200):**

```json
{
  "success": true,
  "domain": "cloudflare.com",
  "server": "whois.verisign-grs.com",
  "response": "Domain Name: CLOUDFLARE.COM\nRegistrar: Cloudflare...",
  "parsed": {
    "registrar": "Cloudflare, Inc.",
    "registrarUrl": "https://www.cloudflare.com",
    "creationDate": "2009-02-17T00:00:00Z",
    "expiryDate": "2031-02-17T00:00:00Z",
    "updatedDate": "2024-01-15T12:00:00Z",
    "status": ["clientDeleteProhibited ...", "clientTransferProhibited ..."],
    "nameServers": ["NS1.CLOUDFLARE.COM", "NS2.CLOUDFLARE.COM"],
    "dnssec": "unsigned"
  },
  "queryTimeMs": 210,
  "referral": {
    "server": "whois.cloudflare.com",
    "response": "...",
    "queryTimeMs": 180
  }
}
```

**With referral failure (referral block present but `response` is null):**

```json
{
  "success": true,
  "domain": "example.com",
  "server": "whois.verisign-grs.com",
  "response": "...",
  "parsed": { ... },
  "queryTimeMs": 190,
  "referral": {
    "server": "whois.markmonitor.com",
    "response": null,
    "queryTimeMs": null
  }
}
```

If referral fails, `referral.response` is `null` and `parsed` is still populated from the registry response.

**Validation error (400):**

```json
{ "success": false, "error": "domain is required" }
```

**Cloudflare protection (403):**

```json
{
  "success": false,
  "error": "...",
  "isCloudflare": true
}
```

Returned when the target WHOIS server resolves to a Cloudflare IP. (Both endpoints run `checkIfCloudflare` before connecting.)

**Key response fields:**

| Field | Notes |
|---|---|
| `response` | Raw registry WHOIS text (up to 200 KB) |
| `parsed` | Structured fields extracted from `referral.response` if available, else `response` |
| `queryTimeMs` | ms for the registry query |
| `referral` | Present only when the registry response contained a referral; `null` on referral failure |
| `referral.response` | Raw registrar WHOIS text; `null` if referral query failed |

---

### `POST /api/whois/ip` — IP / ASN / CIDR WHOIS

Routes to the appropriate RIR WHOIS server and optionally chases the `ReferralServer:` line for the authoritative record.

**Request (JSON body):**

| Field | Default | Notes |
|---|---|---|
| `query` | — | ✅ Required; IPv4, IPv6, CIDR, or ASN |
| `server` | auto-routed by type | Override the initial WHOIS server |
| `timeout` | `15000` | Per-query timeout in ms (different from `/lookup`'s 10000) |
| `followReferral` | `true` | Follow `ReferralServer:` lines from ARIN to authoritative RIR |

**Accepted query formats:**

| Format | Example | `queryType` returned |
|---|---|---|
| IPv4 address | `"8.8.8.8"` | `"ipv4"` |
| IPv4 CIDR | `"192.0.2.0/24"` | `"cidr"` |
| IPv6 address | `"2001:db8::1"` | `"ipv6"` |
| IPv6 CIDR | `"2001:db8::/32"` | `"cidr6"` |
| ASN with prefix | `"AS15169"` | `"asn"` |
| Bare integer ASN | `"15169"` | `"asn"` |

**ASN detection quirk:** bare integers less than 400,000 are treated as ASNs. A plain number like `"8080"` becomes `"AS8080"` and queries ARIN.

**Success (200):**

```json
{
  "success": true,
  "query": "8.8.8.8",
  "queryType": "ipv4",
  "server": "whois.arin.net",
  "response": "NetRange: 8.8.8.0 - 8.8.8.255\nCIDR: 8.8.8.0/24\nNetName: LVLT-GOGL-8-8-8\n...",
  "parsed": {
    "netRange": "8.8.8.0 - 8.8.8.255",
    "cidr": "8.8.8.0/24",
    "netName": "LVLT-GOGL-8-8-8",
    "orgName": "Google LLC",
    "country": "US",
    "asnNumber": ["AS15169"]
  },
  "queryTimeMs": 95,
  "referral": {
    "server": "whois.ripe.net",
    "response": "...",
    "queryTimeMs": 130
  }
}
```

**Unrecognized query (400):**

```json
{
  "success": false,
  "error": "Cannot parse query \"notanip\" — expected IPv4, IPv6, CIDR, or ASN (AS12345)"
}
```

---

## TLD Routing Table

`getWhoisServer()` tries the 2-part TLD first (e.g. `co.uk` → `whois.nic.uk`), then the 1-part TLD. Falls back to `whois.iana.org` for unknown TLDs.

| TLD(s) | WHOIS Server |
|---|---|
| `com`, `net` | `whois.verisign-grs.com` |
| `org` | `whois.pir.org` |
| `edu` | `whois.educause.edu` |
| `gov` | `whois.dotgov.gov` |
| `mil` | `whois.nic.mil` |
| `int` | `whois.iana.org` |
| `info` | `whois.afilias.net` |
| `biz` | `whois.biz` |
| `us` | `whois.nic.us` |
| `uk` | `whois.nic.uk` |
| `co` | `whois.iana.org` |
| `io` | `whois.nic.io` |
| `ai` | `whois.nic.ai` |
| `app`, `dev` | `whois.nic.google` |
| `ca` | `whois.cira.ca` |
| `au` | `whois.auda.org.au` |
| `de` | `whois.denic.de` |
| `fr` | `whois.nic.fr` |
| `jp` | `whois.jprs.jp` |
| `cn` | `whois.cnnic.cn` |
| `ru` | `whois.tcinet.ru` |
| `br` | `whois.registro.br` |
| `in` | `whois.registry.in` |
| `nl` | `whois.domain-registry.nl` |
| `it` | `whois.nic.it` |
| `es` | `whois.nic.es` |
| `pl` | `whois.dns.pl` |
| `ch` | `whois.nic.ch` |
| `se` | `whois.iis.se` |
| `no` | `whois.norid.no` |
| `fi` | `whois.fi` |
| `dk` | `whois.dk-hostmaster.dk` |
| `eu` | `whois.eu` |
| `asia` | `whois.nic.asia` |
| `mobi` | `whois.dotmobiregistry.net` |
| `tel` | `whois.nic.tel` |
| `name` | `whois.nic.name` |
| `pro` | `whois.registrypro.pro` |
| *(unknown)* | `whois.iana.org` |

---

## RIR Routing (IP/ASN)

`getRIRServer()` uses first-octet heuristics for IPv4 and `2001:` block parsing for IPv6. ARIN is the default — it will include a `ReferralServer:` in its response for non-ARIN resources, and `/ip` will follow it automatically.

**IPv4 first-octet ranges (rough heuristics):**

| First octet(s) | RIR |
|---|---|
| 77–95 | RIPE |
| 151–185 | RIPE |
| 193–212 | RIPE |
| 213–217 | RIPE |
| 1, 27, 36, 42, 49, 58–61, 101, 103, 110–126, 150, 153, 163, 175, 180, 182–183, 202–203, 210–211, 218–223 | APNIC |
| 177–191 (except 185) | LACNIC |
| 41, 102, 105, 154, 196–198 | AFRINIC |
| *(all others)* | ARIN (default; issues `ReferralServer:` for non-ARIN blocks) |

**IPv6:**

| Prefix | RIR |
|---|---|
| `2001:04xx` | ARIN |
| `2001:06xx`–`07xx` | APNIC |
| `2001:08xx`–`09xx` | RIPE |
| `2a0x` or `2001` prefix | RIPE |
| *(default)* | ARIN |

**ASN queries:** always sent to `whois.arin.net` first, which redirects via `ReferralServer:` for non-ARIN ASNs.

---

## Referral Chasing

`extractReferralServer()` searches the raw WHOIS response for these patterns **in order**, stopping at the first match:

1. `^Registrar WHOIS Server:\s*(.+)$` — Verisign/ARIN registry response
2. `^WHOIS Server:\s*(.+)$` — common gTLD format
3. `^Refer:\s*(.+)$` — IANA style
4. `^ReferralServer:\s*whois://(.+)$` — ARIN IP format with `whois://` prefix (stripped)
5. `^ReferralServer:\s*(.+)$` — ARIN fallback

The extracted server is rejected (treated as no referral) if it:
- Starts with `http` (URL, not a hostname)
- Contains no `.` (not a valid hostname)
- Is identical to the current server (self-referral loop prevention)

**Timeout independence:** the registry query and the referral query each get the **full `timeout` budget** independently. For `/lookup`, both can take up to 10 s each (20 s worst case). For `/ip`, both can take up to 15 s each.

---

## Parsed Fields

`parseWhoisFields()` scans every line of the WHOIS text for 24 well-known field names. Fields accumulate all matching lines; then:

- **Multi-value fields** (`status`, `nameServers`, `asnNumber`): always returned as arrays, deduplicated via `Set`
- **All other fields**: returned as a string if only one value found, or as an array if multiple distinct values match
- Values equal to `"REDACTED FOR PRIVACY"` are dropped
- Values starting with `"https://icann.org"` are dropped

**Domain-specific fields:**

| Key | Source prefixes |
|---|---|
| `registrar` | `Registrar:`, `Registrar Name:`, `registrar:` |
| `registrarUrl` | `Registrar URL:`, `Registrar Website:` |
| `creationDate` | `Creation Date:`, `Created Date:`, `Domain Registration Date:`, `created:`, `registered:` |
| `updatedDate` | `Updated Date:`, `Last Updated:`, `last-modified:`, `changed:`, `Last Modified:` |
| `expiryDate` | `Registry Expiry Date:`, `Expiration Date:`, `Expiry Date:`, `expires:`, `paid-till:` |
| `status` | `Domain Status:`, `Status:`, `status:` |
| `registrant` | `Registrant Name:`, `Registrant Organization:`, `Registrant:`, `holder:` |
| `registrantEmail` | `Registrant Email:`, `Registrant Contact Email:` |
| `adminEmail` | `Admin Email:` |
| `techEmail` | `Tech Email:` |
| `abuseEmail` | `Abuse Contact Email:` |
| `abusePhone` | `Abuse Contact Phone:` |
| `nameServers` | `Name Server:`, `Nameserver:`, `nserver:` |
| `dnssec` | `DNSSEC:`, `dnssec:` |

**IP/ASN-specific fields:**

| Key | Source prefixes |
|---|---|
| `netRange` | `NetRange:`, `inetnum:`, `inet6num:` |
| `cidr` | `CIDR:`, `route:`, `route6:` |
| `netName` | `NetName:`, `netname:`, `net-name:` |
| `orgName` | `OrgName:`, `org-name:`, `Organization:` |
| `country` | `Country:`, `country:` |
| `rir` | `WhoisServer:`, `source:` |
| `asnNumber` | `OriginAS:`, `origin:` |
| `asnName` | `ASName:`, `as-name:` |
| `asnRange` | `ASNumber:`, `aut-num:` |

Prefix matching is **case-insensitive** and **left-anchored** per line. Fields absent from the response are omitted from `parsed` entirely (no `null` placeholders).

---

## Wire Exchange

```
→ (TCP connect to server:43)
→ google.com\r\n
← Domain Name: GOOGLE.COM\r\n
← Registrar: MarkMonitor Inc.\r\n
← Registrar WHOIS Server: whois.markmonitor.com\r\n
← ... (more fields)
← (connection close)

→ (TCP connect to whois.markmonitor.com:43)   ← referral
→ google.com\r\n
← Domain Name: google.com\r\n
← Registrant Name: ...\r\n
← ... (full registrant data)
← (connection close)
```

RFC 3912 is a one-shot protocol: send `query\r\n`, read until the server closes. No commands, no authentication, no framing.

---

## Implementation Notes

### Port field is a no-op

`/lookup` accepts `port` in its request body type but `doWhoisQuery` **always** connects to port 43:

```typescript
const socket = connect(`${server}:43`);
```

There is no way to change the port via the API. Use the `server` field to override the hostname only.

### 200 KB response cap

`doWhoisQuery` accumulates chunks up to `200_000` bytes then stops reading (does not close the connection immediately — it just breaks the read loop and cleans up). The `IMPLEMENTED.md` description of "100KB" is incorrect; the actual limit is 200 KB.

### UTF-8 with replacement

Responses are decoded with `new TextDecoder('utf-8', { fatal: false })`. Malformed byte sequences (common in older WHOIS servers with Latin-1 text) produce U+FFFD replacement characters rather than throwing.

### Timeout scope

Each call to `doWhoisQuery` creates its own `setTimeout`. For `/lookup` with `followReferral: true`, the registry query gets the full `timeout` budget, and if a referral is found, the referral query also gets the full `timeout` budget independently. Maximum wall-clock time for a single `/lookup` request is `2 × timeout` (default: 20 s). Same for `/ip`.

### `parsed` prefers referral data

```typescript
const primaryText = referralResponse || registryResponse;
const parsed = parseWhoisFields(primaryText);
```

If the referral query succeeded, `parsed` is extracted from the referral response. If the referral failed or `followReferral: false`, `parsed` comes from the registry response. The raw registry text is always in `response`; the raw referral text (if any) is in `referral.response`.

### Cloudflare detection

Both endpoints call `checkIfCloudflare(server)` before opening the TCP connection. If the resolved IP belongs to Cloudflare's ranges, the request is rejected with HTTP 403 and `{ isCloudflare: true }`. This prevents accidentally probing Cloudflare-protected hosts.

---

## curl Examples

```bash
# Domain lookup — follow referral (default)
curl -s -X POST https://portofcall.ross.gg/api/whois/lookup \
  -H 'Content-Type: application/json' \
  -d '{"domain":"cloudflare.com"}' | jq '{registrar:.parsed.registrar,expires:.parsed.expiryDate,ns:.parsed.nameServers}'

# Domain lookup — registry only, no referral
curl -s -X POST https://portofcall.ross.gg/api/whois/lookup \
  -H 'Content-Type: application/json' \
  -d '{"domain":"github.com","followReferral":false}' | jq '{server,queryTimeMs,parsed}'

# Override WHOIS server (e.g. use IANA for any domain)
curl -s -X POST https://portofcall.ross.gg/api/whois/lookup \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.co.uk","server":"whois.iana.org"}' | jq .

# IP lookup — auto-routes to appropriate RIR
curl -s -X POST https://portofcall.ross.gg/api/whois/ip \
  -H 'Content-Type: application/json' \
  -d '{"query":"8.8.8.8"}' | jq '{queryType,server,orgName:.parsed.orgName,country:.parsed.country}'

# CIDR lookup
curl -s -X POST https://portofcall.ross.gg/api/whois/ip \
  -H 'Content-Type: application/json' \
  -d '{"query":"192.0.2.0/24"}' | jq '{queryType,server,netName:.parsed.netName}'

# ASN lookup with prefix
curl -s -X POST https://portofcall.ross.gg/api/whois/ip \
  -H 'Content-Type: application/json' \
  -d '{"query":"AS15169"}' | jq '{queryType,server,parsed}'

# Bare ASN number (integers < 400000 auto-detected)
curl -s -X POST https://portofcall.ross.gg/api/whois/ip \
  -H 'Content-Type: application/json' \
  -d '{"query":"15169"}' | jq '{queryType,parsed}'

# IPv6 lookup
curl -s -X POST https://portofcall.ross.gg/api/whois/ip \
  -H 'Content-Type: application/json' \
  -d '{"query":"2001:db8::1"}' | jq '{queryType,server}'

# Longer timeout for slow registries
curl -s -X POST https://portofcall.ross.gg/api/whois/lookup \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.de","timeout":20000}' | jq .
```

---

## Known Limitations

- **`port` field is ignored** — `/lookup` accepts it in the body type but always connects on port 43
- **Single-hop referral** — only one level of referral chasing; registrar responses that themselves contain a referral are not followed further
- **Heuristic RIR routing** — IPv4 first-octet rules are approximate; ARIN's `ReferralServer:` is the source of truth and is followed when it appears
- **200 KB cap** — very long WHOIS records (bulk IP allocations, large ASN tables) are silently truncated at 200,000 bytes
- **No caching** — each request opens fresh TCP connections; WHOIS servers rate-limit aggressive querying
- **No rate limiting** — the worker does not throttle requests; callers should implement their own backoff
- **UTF-8 with replacement** — non-UTF-8 bytes produce U+FFFD in `response` and `parsed` values
- **Parsed field coverage** — `parseWhoisFields` covers 24 common fields; registrar-specific or RIR-specific fields not in the mapping appear only in `response`
