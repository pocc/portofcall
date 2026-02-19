# DoH (DNS over HTTPS) — Power-User Reference

**Port:** 443 (HTTPS)
**Transport:** HTTPS via `fetch()` (not raw TCP sockets)
**RFC:** 8484
**Implementation:** `src/worker/doh.ts`
**UI Client:** `src/components/DOHClient.tsx`
**Rating:** ★★★★★

---

## Endpoint

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/doh/query` | Send a DNS query to a DoH resolver |

There is only one endpoint. No GET support, no batch queries, no reverse lookup shorthand.

---

## Request

```json
POST /api/doh/query
Content-Type: application/json

{
  "domain": "example.com",
  "type": "A",
  "resolver": "https://cloudflare-dns.com/dns-query",
  "timeout": 10000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `domain` | string | *(required)* | Domain to query. Trailing dot stripped before encoding. |
| `type` | string | `"A"` | Record type name. Case-insensitive (uppercased internally). |
| `resolver` | string | `"https://cloudflare-dns.com/dns-query"` | Full URL of the DoH resolver endpoint. |
| `timeout` | number | `10000` | Timeout in ms for the `fetch()` call. |

### Supported record types

| Type | Code | Response parsing |
|------|------|------------------|
| A | 1 | Dotted-quad IPv4 |
| AAAA | 28 | Colon-separated hex groups (no zero-compression) |
| CNAME | 5 | Decoded domain name (with compression pointer support) |
| NS | 2 | Decoded domain name |
| PTR | 12 | Decoded domain name |
| MX | 15 | `"preference exchange.name"` (space-separated) |
| TXT | 16 | Character-string segments joined with spaces |
| SOA | 6 | **Not decoded** — raw hex bytes |
| SRV | 33 | **Not decoded** — raw hex bytes |
| ANY | 255 | Answers parsed per-type; unknown types fall through to hex |

Any unrecognized `type` string silently falls back to code `1` (A record). There is no error for unknown types.

---

## Response

### Success (RCODE 0)

```json
{
  "success": true,
  "domain": "example.com",
  "resolver": "https://cloudflare-dns.com/dns-query",
  "queryType": "A",
  "rcode": "NOERROR",
  "answers": [
    { "name": "example.com", "type": "A", "ttl": 3600, "data": "93.184.216.34" }
  ],
  "authority": [],
  "additional": [],
  "queryTimeMs": 42
}
```

### NXDOMAIN / non-zero RCODE

```json
{
  "success": false,
  "domain": "doesnotexist.example.com",
  "resolver": "https://cloudflare-dns.com/dns-query",
  "queryType": "A",
  "rcode": "NXDOMAIN",
  "answers": [],
  "authority": [
    { "name": "example.com", "type": "SOA", "ttl": 900, "data": "00 06 03 ..." }
  ],
  "additional": [],
  "queryTimeMs": 38,
  "error": "NXDOMAIN"
}
```

`success` is `true` only when RCODE = 0 (NOERROR). Any other RCODE — including NXDOMAIN (3) — returns `success: false` with an `error` field.

### HTTP errors from resolver

If the DoH resolver returns a non-2xx HTTP status, the worker returns HTTP 502:

```json
{
  "success": false,
  "error": "DoH resolver returned HTTP 403: Forbidden",
  "domain": "example.com",
  "resolver": "https://dns.example.com/dns-query",
  "queryType": "A"
}
```

### RCODE reference

| Code | Name | Meaning |
|------|------|---------|
| 0 | NOERROR | Query succeeded |
| 1 | FORMERR | Malformed query |
| 2 | SERVFAIL | Server failure |
| 3 | NXDOMAIN | Name does not exist |
| 4 | NOTIMP | Not implemented |
| 5 | REFUSED | Query refused |
| 6+ | `RCODE{n}` | Numeric fallback for codes 6-15 |

---

## Wire format details

The implementation builds a standard RFC 1035 DNS query packet (no TCP length prefix) and sends it as the HTTP body with `Content-Type: application/dns-message` / `Accept: application/dns-message`.

### Query construction

```
Header (12 bytes):
  ID:      random 16-bit (Math.random() * 65536)
  Flags:   0x0100 (RD=1, all others 0)
  QDCOUNT: 1
  ANCOUNT: 0
  NSCOUNT: 0
  ARCOUNT: 0

Question section:
  QNAME:  label-encoded domain (trailing dot stripped)
  QTYPE:  from DNS_RECORD_TYPES lookup
  QCLASS: 1 (IN)
```

No EDNS0 OPT record is appended. This means:
- No DNSSEC (DO bit not set)
- No extended RCODE
- No client subnet (ECS)
- Default 512-byte UDP response size (but DoH responses can be larger since transport is HTTPS)

### Response parsing

- Full compression pointer support (0xC0 prefix → absolute offset jump)
- Parses all three sections: ANSWER, AUTHORITY, ADDITIONAL
- For unknown record types, `data` is a space-separated hex dump of the RDATA bytes
- `type` field is the symbolic name if known (e.g., `"A"`, `"AAAA"`), otherwise `"TYPE{n}"`

---

## Quirks and limitations

### 1. SOA and SRV records are not decoded

SOA (type 6) and SRV (type 33) are supported in the query type map and can be requested, but their RDATA is returned as a hex dump rather than structured fields. For SOA, you won't get `mname`, `rname`, `serial`, `refresh`, `retry`, `expire`, `minimum` — just hex bytes.

### 2. AAAA records lack zero-compression

IPv6 addresses are rendered as full colon-separated hex groups:
`2606:4700:4700:0:0:0:0:1111` instead of the standard `2606:4700:4700::1111`.
Each group is the minimal hex representation (no leading zeros), but all 8 groups are always present.

### 3. No method restriction

The handler does not check `request.method`. Any HTTP method (GET, PUT, DELETE, etc.) will be accepted as long as the request body is valid JSON. In practice only POST makes sense since a body is required.

### 4. No resolver URL validation

The `resolver` parameter is passed directly to `fetch()` with no validation. This means:
- Non-HTTPS URLs are accepted (e.g., `http://...` — may work if the resolver supports it)
- Arbitrary URLs could be used as an SSRF vector (the Worker will POST a DNS packet to any URL)
- Empty strings or malformed URLs will produce a fetch error, returned as HTTP 500

### 5. No Cloudflare detection

Unlike most TCP-based protocol handlers, DOH does not call `checkIfCloudflare()`. Since DoH uses HTTPS `fetch()` rather than raw TCP sockets, Cloudflare detection (which checks if the target IP resolves to Cloudflare) doesn't apply — the Worker is acting as an HTTP client, not connecting to a raw socket.

### 6. Timeout does not cover response body read

The timeout wraps `fetch()` via `Promise.race`, but `response.arrayBuffer()` is called after the race resolves. A resolver that sends HTTP headers quickly but streams the body slowly could exceed the timeout. In practice, DNS responses are small enough that this is rarely an issue.

### 7. Transaction ID not verified

The query uses a random 16-bit ID (`Math.random() * 65536`), but the response's ID field is not checked against it. Over HTTPS, this is harmless — transport-layer integrity is handled by TLS.

### 8. TXT record segments joined with spaces

Multi-segment TXT records (RFC 1035 §3.3.14 character-strings) are concatenated with a space separator. If individual segments contain spaces, they're indistinguishable from the separator. Standard practice is to concatenate without a separator for DKIM/SPF/DMARC records.

### 9. Unknown type code defaults to A silently

If `type` is not in the lookup table (e.g., `"HTTPS"`, `"SVCB"`, `"CAA"`), `DNS_RECORD_TYPES[type.toUpperCase()] ?? 1` silently falls back to an A record query. No error or warning is returned.

### 10. `domain` is not validated

No regex, length check, or internationalized domain name (IDN/punycode) handling. Raw bytes of the domain string are encoded as DNS labels. Labels over 63 bytes or total names over 253 bytes will produce a malformed query, which the resolver will reject with FORMERR.

---

## Compared to `/api/dns/query`

Port of Call also has a traditional DNS-over-TCP implementation (`src/worker/dns.ts`). Key differences:

| | DoH (`/api/doh/query`) | DNS (`/api/dns/query`) |
|---|---|---|
| Transport | HTTPS `fetch()` | Raw TCP socket |
| Default server | `cloudflare-dns.com` | No default (required) |
| DNSSEC types | Not supported | DNSKEY, DS, RRSIG, NSEC, NSEC3, TLSA, SSHFP, CAA, NAPTR, SVCB, HTTPS |
| AXFR | No | Yes (`/api/dns/axfr`) |
| SOA parsing | Hex dump | Structured fields |
| SRV parsing | Hex dump | Structured fields |
| Cloudflare detection | No | Yes |
| EDNS0 | No | Yes (4096-byte payload, DO bit for DNSSEC) |

For record types that both handlers parse (A, AAAA, CNAME, NS, PTR, MX, TXT), output format is identical.

---

## curl examples

### Basic A record lookup (Cloudflare resolver)
```bash
curl -s -X POST https://your-worker.dev/api/doh/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.com"}' | jq
```

### MX records via Google's resolver
```bash
curl -s -X POST https://your-worker.dev/api/doh/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"gmail.com","type":"MX","resolver":"https://dns.google/dns-query"}' | jq
```

### AAAA via Quad9
```bash
curl -s -X POST https://your-worker.dev/api/doh/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"cloudflare.com","type":"AAAA","resolver":"https://dns.quad9.net/dns-query"}' | jq
```

### TXT record (SPF/DKIM)
```bash
curl -s -X POST https://your-worker.dev/api/doh/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"_dmarc.gmail.com","type":"TXT"}' | jq '.answers[].data'
```

### Custom resolver with tight timeout
```bash
curl -s -X POST https://your-worker.dev/api/doh/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.com","resolver":"https://doh.opendns.com/dns-query","timeout":3000}' | jq
```

### Trigger NXDOMAIN
```bash
curl -s -X POST https://your-worker.dev/api/doh/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"this.does.not.exist.example.com"}' | jq '{success,rcode,error}'
```

---

## Well-known DoH resolvers

| Provider | URL | Notes |
|----------|-----|-------|
| Cloudflare | `https://cloudflare-dns.com/dns-query` | Default. Also `https://1.1.1.1/dns-query` |
| Google | `https://dns.google/dns-query` | |
| Quad9 | `https://dns.quad9.net/dns-query` | Blocks known malicious domains |
| NextDNS | `https://dns.nextdns.io/dns-query` | Configurable filtering (needs config ID for filtering) |
| Mullvad | `https://dns.mullvad.net/dns-query` | Privacy-focused |
| AdGuard | `https://dns.adguard-dns.com/dns-query` | Ad-blocking |

The UI client (`DOHClient.tsx`) offers Cloudflare, Google, Quad9, and NextDNS as presets, plus a custom URL field.
